/**
 * CSSOM LiveStyle patcher: maps incoming updates to browser’s 
 * CSS Object Model. This is a very fast method of applying 
 * incoming updates from LiveStyle which is also works in any
 * modern browser environment.
 */
if (typeof module === 'object' && typeof define !== 'function') {
	var define = function (factory) {
		module.exports = factory(require, exports, module);
	};
}

define(function(require, exports, module) {
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

	NodePath.prototype.toString = function() {
		return this.components.map(function(c) {
			return c.toString(true);
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

	NodePathComponent.prototype.toString = function() {
		return this.name +  (this.pos > 1 ? '|' + this.pos : '');
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

	function atRuleName(rule) {
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
		switch (rule.type) {
			case 2: return '@charset';
			case 3: return '@import';
			case 4: return '@media ' + rule.media.mediaText;
			case 5: return '@font-face';
		}
	}

	/**
	 * Returns name of given rule
	 * @param  {CSSRule} rule
	 * @return {String}
	 */
	function ruleName(rule) {
		
		var sel = rule.selectorText || atRuleName(rule);
		if (sel) {
			return sel;
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
	 * Check if given @-rule equals to given patch property
	 * @param  {CSSRule} rule
	 * @param  {Object}  prop
	 * @return {Boolean}
	 */
	function atRuleEquals(rule, prop) {
		if (atRuleName(rule) !== prop.name) {
			return false;
		}

		switch (prop.name) {
			case '@charset':
				return rule.encoding === prop.value.trim().replace(/^['"]|['"]$/g, '');
			case '@import':
				return rule.href === prop.value.trim().replace(/^url\(['"]?|['"]?\)$/g, '');
		}
	}

	/**
	 * Updates given rule with data from patch
	 * @param  {CSSRule} rule
	 * @param  {Array} patch
	 */
	function patchRule(rule, patch) {
		if (!rule) {
			// not a CSSStyleRule, aborting
			console.log('aborting');
			return;
		}

		var reAt = /^@/, childRule;

		// remove properties
		patch.remove.forEach(function(prop) {
			if (reAt.test(prop)) {
				// @-properties are not properties but rules
				if (!rule.cssRules || !rule.cssRules.length) {
					return;
				}
				
				for (var i = 0, il = rule.cssRules.length; i < il; i++) {
					if (atRuleEquals(rule.cssRules[i], prop)) {
						return rule.deleteRule(i);
					}
				}
			} else if (rule.style) {
				rule.style.removeProperty(prop.name);
			}
		});

		var updateRules = {
			'@charset': [],
			'@import': []
		};

		// update properties on current rule
		var properties = patch.update.map(function(prop) {
			if (prop.name in updateRules) {
				updateRules[prop.name].push(prop);
				return '';
			}

			return prop.name + ':' + prop.value + ';';
		}).join('');

		if (rule.style) {
			rule.style.cssText += properties;
		}

		console.log('Subrules', updateRules);

		// insert @-properties as rules
		while (childRule = updateRules['@charset'].pop()) {
			rule.insertRule(childRule.name + ' ' + childRule.value, 0);
		}

		if (updateRules['@import'].length && rule.cssRules) {
			// @import’s must be inserted right after existing imports
			var childIx = 0, childName;
			for (var i = rule.cssRules.length - 1; i >= 0; i--) {
				childName = atRuleName(rule.cssRules[i]);
				if (childName === '@charset' || childName === '@import') {
					childIx = i;
					break;
				}
			}

			while (childRule = updateRules['@import'].pop()) {
				rule.insertRule(childRule.name + ' ' + childRule.value, childIx);
			}
		}
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

		for (var i = 0, il = rules.length, rule, name, item; i < il; i++) {
			rule = rules[i];
			name = ruleName(rule);
			if (name === '@charset' || name === '@import') {
				continue;
			}

			item = {
				ix: i,
				name: name,
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
});