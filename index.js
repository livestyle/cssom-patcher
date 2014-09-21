/**
 * CSSOM LiveStyle patcher: maps incoming updates to browser’s 
 * CSS Object Model. This is a very fast method of applying 
 * incoming updates from LiveStyle which is also works in any
 * modern browser environment.
 */
(function (root, factory) {
	if (typeof define === 'function' && define.amd) {
		// AMD. Register as an anonymous module.
		define(['exports'], function (exports, b) {
			factory(exports);
		});
	} else if (typeof exports === 'object') {
		// CommonJS
		factory(exports);
	} else {
		// Browser globals
		factory((root.livestyleCSSOM = {}));
	}
}(this, function (exports) {
	function last(arr) {
		return arr[arr.length - 1];
	}

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
		if ('value' in patch) {
			// updating full value of section, like `@import`
			return patchRuleByValue(rule, patch);
		}

		// update properties
		rule.style.cssText += patch.update.map(function(prop) {
			return prop.name + ':' + prop.value + ';';
		}).join('');

		// remove properties
		patch.remove.forEach(function(prop) {
			rule.style.removeProperty(prop.name);
		});
	}

	function patchRuleByValue(rule, patch) {
		rule.cssText = ruleName(rule) + ' ' + patch.value;
	}

	/**
	 * Locates CSS section by given selectors in sections
	 * list
	 * @param  {Array} list Plain list of available sections
	 * @param  {String} sel  Selector to find
	 * @return {Object}
	 */
	function locate(list, sel) {
		var key = stringifyPath(sel, false);
		for (var i = 0, il = list.length, item; i < il; i++) {
			if (list[i].pathString === key) {
				return list[i];
			}
		}
	}

	/**
	 * Creates string representation of CSS path
	 * @param  {Array} path
	 * @return {String}
	 */
	function stringifyPath(path) {
		var out = '';
		for (var i = 0, il = path.length, p; i < il; i++) {
			p = path[i];
			out += (i ? '/' : '') + p[0] + (p[1] > 1 ? '|' + p[1] : '');
		}
		return out;
	}

	function guessLocation(stylesheet, path) {
		var part, rule, candidates;

		var find = function(collection, path) {
			if (!collection) {
				return false;
			}

			if (Array.isArray(path)) {
				path = path[0];
			}

			return collection.filter(function(item) {
				return item.name === path;
			});
		};

		var ctx = stylesheet;
		while (part = path.shift()) {
			rule = locate(ctx.children, [part]);
			if (!rule) {
				candidates = find(ctx.children, part);
				if (candidates.length) {
					if (path[0]) {
						// try to find last node containing
						// next child
						rule = last(candidates.filter(function(item) {
							return find(item.children, path[0]).length;
						}));
					}

					if (!rule) {
						rule = last(candidates);
					}
				}
			}

			if (!rule) { // nothing found, stop here
				path.unshift(part);
				break;
			} else {
				ctx = rule;
			}
		}

		return {
			found: ctx !== stylesheet,
			rule: ctx,
			rest: path.length ? path : null
		};
	}

	/**
	 * Tries to find best partial match of given path on CSS tree and returns
	 * target section
	 * @param  {CSSRule} rule CSS tree
	 * @param  {Array} cssPath Parsed CSS path
	 */
	function bestPartialMatch(stylesheet, cssPath, patch) {
		var loc = guessLocation(stylesheet, cssPath);
		if (loc.rule.parent) {
			var ctxName = loc.rule.name;
			if (ctxName == '@import' && patch.action == 'add') {
				// in case of added @import rule, make sure it was added,
				// not replaced existing rule
				if (!loc.rest) {
					loc.rest = [];
				}

				loc.rest.unshift([ctxName]);
				loc.rule = loc.rule.parent;
			}
		}

		ctx = loc.rule.ref;

		if (loc.rest) {
			// The `rest` property means we didn’t found exact section
			// where patch should be applied, but some of its parents.
			// In this case we have to re-create the `rest` sections
			// in best matching parent
			var accumulated = '';
			while (subrule = loc.rest.pop()) {
				accumulated = subrule[0] + '{' + accumulated + '}';
			}
			var ix = ctx.insertRule(accumulated, ctx.cssRules.length);
			ctx = ctx.cssRules[ix];
			while (ctx.cssRules && ctx.cssRules.length) {
				ctx = ctx.cssRules[0];
			}

			// var subrule, ix;
			// while (subrule = loc.rest.shift()) {
			// 	if (!ctx.insertRule) {
			// 		// can’t insert rule here, so can’t patch the source properly
			// 		return;
			// 	}
			// 	ix = ctx.insertRule(subrule[0] + ' {}', ctx.cssRules.length);
			// 	ctx = ctx.cssRules[ix];
			// }
		}

		patchRule(ctx, patch);
	}

	function makeList(ctx, out) {
		out = out || [];
		var items = ctx.children;
		if (!items.length) {
			return out;
		}

		for (var i = 0, il = items.length; i < il; i++) {
			out.push(items[i]);
			makeList(items[i], out);
		}

		return out;
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
	 * Returns plain list of all available rules in stylesheet
	 * @param  {CSSStyleSheet} stylesheet
	 * @return {Array}
	 */
	exports.toList = function(stylesheet, options) {
		if (!stylesheet.ref) {
			stylesheet = this.createIndex(stylesheet);
		}
		return makeList(stylesheet);
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
		var that = this;
		if (typeof stylesheet === 'string') {
			stylesheet = this.stylesheets()[stylesheet];
		}

		if (!stylesheet || !stylesheet.cssRules) {
			return false;
		}

		var index = this.createIndex(stylesheet);
		var ruleList = this.toList(index);

		if (!Array.isArray(patches)) {
			patches = [patches];
		}

		patches.forEach(function(patch) {
			var cssPath = patch.path;
			var match = locate(ruleList, cssPath);

			if (match) {
				if (patch.action === 'remove') {
					return parent(match.ref).deleteRule(match.ix);
				}
				patchRule(match.ref, patch);
			} else {
				bestPartialMatch(index, cssPath, patch);
			}
		});

		return stylesheet;
	};

	exports.createIndex = function(ctx, parent) {
		var lookup = {};
		var rule, name, item, path;

		if (!parent) {
			parent = {
				ix: -1,
				name: ':root',
				path: null,
				pathString: '',
				parent: null,
				children: [],
				ref: ctx
			};
		}

		var rules = ctx.cssRules;
		if (!rules) {
			return;
		}

		for (var i = 0, il = rules.length; i < il; i++) {
			rule = rules[i];
			name = ruleName(rule);
			if (name in lookup) {
				lookup[name]++;
			} else {
				lookup[name] = 1;
			}

			path = parent.path ? parent.path.slice(0) : [];
			path.push([name, lookup[name]]);

			item = {
				ix: i,
				name: name,
				path: path,
				pathString: stringifyPath(path),
				parent: parent,
				children: [],
				ref: rule
			};

			parent.children.push(item);
			this.createIndex(rule, item);
		}

		return parent;
	};

	return exports;
}));