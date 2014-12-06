/**
 * CSSOM LiveStyle patcher: maps incoming updates to browser’s 
 * CSS Object Model. This is a very fast method of applying 
 * incoming updates from LiveStyle which is also works in any
 * modern browser environment.
 */
(function (root, factory) {
	if (typeof define === 'function' && define.amd) {
		// AMD. Register as an anonymous module.
		define(['exports'], function (exports) {
			factory(require, exports);
		});
	} else if (typeof exports === 'object') {
		// CommonJS
		factory(require, exports);
	} else {
		// Browser globals
		factory(require, (root.livestyleCSSOM = {}));
	}
}(this, function(require, exports) {
	var pathfinder = require('livestyle-pathfinder');

	/**
	 * Node path shim
	 */
	function NodePath(path) {
		if (Array.isArray(path)) {
			this.components = path.map(NodePathComponent);
		} else {
			this.components = [];
		}
	}

	NodePath.prototype.toString = function(skipPos) {
		return this.components.map(function(c) {
			return c.valueOf(skipPos);
		}).join('/');
	};

	function NodePathComponent(name, pos) {
		if (!(this instanceof NodePathComponent)) {
			return new NodePathComponent(name, pos);
		}

		if (Array.isArray(name)) {
			pos = name[1];
			name = name[0];
		}

		this.name = name;
		this.pos = pos || 1;
	}

	NodePathComponent.prototype.toString = function(skipPos) {
		return this.name +  (!skipPos || this.pos > 1 ? '|' + this.pos : '');
	};

	/**
	 * Findes all stylesheets in given context, including
	 * nested `@import`s
	 * @param  {StyleSheetList} ctx List of stylesheets to scan
	 * @return {Object} Hash where key as a stylesheet URL and value
	 * is a stylesheet reference
	 */
	function findStyleSheets(ctx, out) {
		out = out || {};
		for (var i = 0, il = ctx.length, url, item; i < il; i++) {
			item = ctx[i];
			url = item.href;
			if (url in out) {
				// stylesheet already added
				continue;
			}

			out[url] = item;
			
			// find @import rules
			if (item.cssRules) {
				for (var j = 0, jl = item.cssRules.length; j < jl; j++) {
					if (item.cssRules[j].type == 3) {
						findStyleSheets([item.cssRules[j].styleSheet], out);
					}
				}
			}
		}
		
		return out;
	}

	/**
	 * Returns name of given rule
	 * @param  {CSSRule} rule
	 * @return {String}
	 */
	function ruleName(rule) {
		/*
		 * Reference:
		 * UNKNOWN_RULE: 0
		 * STYLE_RULE: 1
		 * CHARSET_RULE: 2
		 * IMPORT_RULE: 3
		 * MEDIA_RULE: 4
		 * FONT_FACE_RULE: 5
		 * PAGE_RULE: 6
		 * KEYFRAMES_RULE: 7
		 * KEYFRAME_RULE: 8
		 * SUPPORTS_RULE: 12
		 * WEBKIT_FILTER_RULE: 17
		 * HOST_RULE: 1001
		 */
		var sel = rule.selectorText;
		if (sel) {
			return sel;
		}

		switch (rule.type) {
			case 2: return '@charset';
			case 3: return '@import';
			case 4: return '@media ' + rule.media.mediaText;
			case 5: return '@font-face';
		}

		var text = rule.cssText;
		if (text) {
			return (text.split('{', 2)[0] || '').trim();
		}
	}

	/**
	 * Returns rule’s parent (stylesheet or rule)
	 * @param  {CSSRule} rule
	 * @return {CSSStyleSheet}
	 */
	function parent(rule) {
		return rule.parentRule || rule.parentStyleSheet;
	}

	/**
	 * Updates given rule with data from patch
	 * @param  {CSSRule} rule
	 * @param  {Array} patch
	 */
	function patchRule(rule, patch) {
		if (!rule || !rule.style) {
			// not a CSSStyleRule, aborting
			return;
		}

		// TODO handle @-rules

		// remove properties
		patch.remove.forEach(function(prop) {
			rule.style.removeProperty(prop.name);
		});

		// update properties
		rule.style.cssText += patch.update.map(function(prop) {
			return prop.name + ':' + prop.value + ';';
		}).join('');
	}

	function setupFromPartialMatch(match) {
		// The `rest` property means we didn’t found exact section
		// where patch should be applied, but some of its parents.
		// In this case we have to re-create the `rest` sections
		// in best matching parent
		var accumulated = match.rest.reduceRight(function(prev, cur) {
			return cur.name + ' {' + prev + '}';
		}, '');

		var parent = match.parent;
		try {
			var ix = parent.ref.insertRule(accumulated, match.index);
		} catch (e) {
			console.warn('LiveStyle:', e.message);
			return;
		}

		var ctx = parent.ref.cssRules[ix];
		var indexed = exports.createIndex(ctx);
		indexed.name = ruleName(ctx);
		indexed.ix = ix;
		parent.children.splice(ix, 0, indexed);
		for (var i = ix + 1, il = parent.children.length; i < il; i++) {
			parent.children.ix++;
		}

		while (ctx.cssRules && ctx.cssRules.length) {
			ctx = ctx.cssRules[0];
		}

		return ctx;
	}

	function deleteRuleFromMatch(match) {
		parent(match.node.ref).deleteRule(match.ix);
		var ix = match.parent.children.indexOf(match);
		match.parent.children.splice(ix, 1);
	}

	function normalizeHints(hints) {
		return hints.map(function(hint) {
			if (hint.before) {
				hint.before = hint.before.map(NodePathComponent);
			}
			if (hint.after) {
				hint.after = hint.after.map(NodePathComponent);
			}
			return hint;
		});
	}

	/**
	 * Returns hash with available stylesheets. The keys of hash
	 * are absolute urls and values are pointers to StyleSheet objects
	 * @return {Object}
	 */
	exports.stylesheets = function() {
		return findStyleSheets(document.styleSheets);
	};

	/**
	 * Updates given stylesheet with patches
	 * @param  {CSSStyleSheet} stylesheet
	 * @param  {Array} patches
	 * @returns {StyleSheet} Patched stylesheet on success,
	 * `false` if it’s impossible to apply patch on given 
	 * stylesheet.
	 */
	exports.patch = function(stylesheet, patches) {
		var self = this;
		if (typeof stylesheet === 'string') {
			stylesheet = this.stylesheets()[stylesheet];
		}

		if (!stylesheet || !stylesheet.cssRules) {
			return false;
		}


		var index = this.createIndex(stylesheet);
		if (!Array.isArray(patches)) {
			patches = [patches];
		}

		patches.forEach(function(patch) {
			var path = new NodePath(patch.path);
			var hints = hints ? normalizeHints(patch.hints) : null;
			var location = pathfinder.find(index, path, hints);
			if (location.partial && patch.action === 'remove') {
				// node is absent, do nothing
				return;
			}

			if (!location.partial) {
				// exact match on node
				if (patch.action === 'remove') {
					return deleteRuleFromMatch(location);
				}

				return patchRule(location.node.ref, patch);
			}

			patchRule(setupFromPartialMatch(location), patch);
		});

		return stylesheet;
	};

	exports.createIndex = function(ctx, parent) {
		var indexOf = function(item) {
			return this.children.indexOf(item);
		};

		if (!parent) {
			parent = {
				ix: -1,
				name: '',
				parent: null,
				children: [],
				ref: ctx,
				indexOf: indexOf
			};
		}

		var rules = ctx.cssRules;
		if (!rules) {
			return parent;
		}

		for (var i = 0, il = rules.length, rule, item; i < il; i++) {
			rule = rules[i];
			item = {
				ix: i,
				name: ruleName(rule),
				parent: parent,
				children: [],
				ref: rule,
				indexOf: indexOf
			};

			parent.children.push(item);
			this.createIndex(rule, item);
		}

		return parent;
	};

	return exports;
}));