'use strict';

/**
 * CSSOM LiveStyle patcher: maps incoming updates to browser’s 
 * CSS Object Model. This is a very fast method of applying 
 * incoming updates from LiveStyle which is also works in any
 * modern browser environment.
 */
var pathfinder = require('livestyle-pathfinder');
var splitBy = require('./lib/split');

/**
 * Returns hash with available stylesheets. The keys of hash
 * are absolute urls and values are pointers to StyleSheet objects
 * @return {Object}
 */
var stylesheets = module.exports.stylesheets = function() {
	return findStyleSheets(document.styleSheets);
};

/**
 * Updates given stylesheet with patches
 * @param  {CSSStyleSheet} stylesheet
 * @param  {Array} patches
 * @returns {StyleSheet} List of `insertRule` and `deleteRule` commands
 * that can be applied to stylesheet to receive the same result
 * (used for Shadow CSS in Chrome extension)
 */
var patch = module.exports.patch = function(stylesheet, patches) {
	var self = this;
	if (typeof stylesheet === 'string') {
		stylesheet = this.stylesheets()[stylesheet];
	}

	if (!stylesheet || !stylesheet.cssRules) {
		return false;
	}

	if (!Array.isArray(patches)) {
		patches = [patches];
	}

	var result = patches.map(function(patch) {
		var path = new NodePath(patch.path);
		var hints = patch.hints ? normalizeHints(patch.hints) : null;
		var index = self.createIndex(stylesheet);
		var location = pathfinder.find(index, path, hints);

		if (location.partial && patch.action === 'remove') {
			// node is absent, do nothing
			return;
		}

		if (!location.partial) {
			// exact match on node
			if (patch.action === 'remove') {
				var node = location.node;
				deleteRuleFromMatch(location);
				return resultOfDeletePatch(node);
			}
			return patchRule(location.node.ref, patch);
		}

		var out = [];
		var rule = setupFromPartialMatch(location, out);
		return out.concat(patchRule(rule, patch));
	}).filter(Boolean);

	return flatten(result);
};

var createIndex = module.exports.createIndex = function(ctx, parent) {
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
			name: normalizeSelector(name),
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

function last(arr) {
	return arr[arr.length - 1];
}

function flatten(input) {
	var output = [];
	for (var i = 0, il = input.length, value; i < il; i++) {
		value = input[i];
		if (Array.isArray(value)) {
			output = output.concat(flatten(value));
		} else {
			output.push(value);
		}
	}
	return output;
}

function isTopLevel(node) {
	return node && node.parent && !node.parent.parent;
}

function resultOfDeletePatch(node) {
	if (isTopLevel(node)) {
		// matched top-level section, removed it
		return {
			action: 'delete',
			index: node.ix
		};
	}

	// matched inner node, mark top-level node as updated
	var ctx = node;
	while (ctx && !isTopLevel(ctx)) {
		ctx = ctx.parent;
	}
	
	if (ctx) {
		return {
			action: 'update',
			index: ctx.ix,
			value: ctx.ref.cssText
		};
	}
}

/**
 * Node path shim
 */
class NodePath {
	constructor(path) {
		this.components = [];
		if (Array.isArray(path)) {
			this.components = path.map(function(c) {
				return new NodePathComponent(c);
			});
		}
	}

	toString() {
		return this.components.map(function(c) {
			return c.toString(true);
		}).join('/');
	}
}

class NodePathComponent {
	constructor(name, pos) {
		if (Array.isArray(name)) {
			pos = name[1];
			name = name[0]
		}

		this.name = normalizeSelector(name);
		this.pos = pos || 1;
	}

	toString() {
		return this.name +  (this.pos > 1 ? '|' + this.pos : '');
	}
}

function normalizeSelector(sel) {
	return sel.trim().replace(/:+(before|after)$/, '::$1');
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
		// Firefox throws exception when accessing cssRules property 
		// of stylesheet from different origin
		try {
			if (item.cssRules) {
				for (var j = 0, jl = item.cssRules.length; j < jl; j++) {
					if (item.cssRules[j].type == 3) {
						findStyleSheets([item.cssRules[j].styleSheet], out);
					}
				}
			}
		} catch(e) {}
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
 * Updates properties in given CSS rule
 * @param  {CSSRule} rule
 * @param  {Array} properties
 * @param  {Patch} patch
 */
function updateProperties(rule, properties, patch) {
	if (!rule || !rule.style) {
		return;
	}

	if ('ownerNode' in rule) {
		// A stylesheet (not CSS rule) cannot have properties;
		// updating them in Chrome gives unpredictable result
		return;
	}

	if (patch && patch.all) {
		// there are few challenges when changing updated
		// properies via CSSOM:
		// 1. Updating a a short-hand property only (for example,
		// `background` or `font`) will reset subsequent
		// full properties (`background-size`, `line-height` etc.)
		// that are not changed
		// 2. Chrome has buggy implementation of `background` shorthand:
		// at least it looses `background-size` property.
		// 
		// So right now the only valid and simple solution is to
		// re-apply all exising properties from source CSS even if they
		// were not updated or they doesn’t exist in current CSSOM rule
		properties = patch.all;
	}

	var style = rule.style;
	properties.forEach(function(p) {
		var important = null;
		var value = p.value.replace(/\!important\s*$/, function() {
			important = 'important';
			return '';
		})

		nameVariations(p.name).forEach(function(name) {
			style.setProperty(name, value, important);
		});
	});
}

function nameVariations(name) {
	var out = [name];
	if (name.indexOf('-') !== -1) {
		var camelCased = name.replace(/\-([a-z])/g, function(str, l) {
			return l.toUpperCase();
		});
		out.push(camelCased);
		if (name[0] === '-') {
			out.push(camelCased[0].toLowerCase() + camelCased.slice(1));
		}
	}
	return out;
}

/**
 * Updates given rule with data from patch
 * @param  {CSSRule} rule
 * @param  {Array} patch
 */
function patchRule(rule, patch) {
	var result = [];

	if (!rule) {
		// not a CSSStyleRule, aborting
		return result;
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
	var properties = patch.update.filter(function(prop) {
		if (prop.name in updateRules) {
			updateRules[prop.name].push(prop);
			return false;
		}

		return true;
	});

	updateProperties(rule, properties, patch);

	// insert @-properties as rules
	while (childRule = updateRules['@charset'].pop()) {
		rule.insertRule(childRule.name + ' ' + childRule.value, 0);
		result.push({
			action: 'insert',
			index: 0,
			value: childRule.name + ' ' + childRule.value
		});
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
			result.push({
				action: 'insert',
				index: childIx,
				value: childRule.name + ' ' + childRule.value
			});
		}
	}

	// find parent rule
	var ctx = rule;
	while (ctx.parentRule) {
		ctx = ctx.parentRule;
	}

	var ruleIx = -1;
	var allRules = ctx.parentStyleSheet && ctx.parentStyleSheet.cssRules;
	if (allRules) {
		for (var i = 0, il = allRules.length; i < il; i++) {
			if (allRules[i] === ctx) {
				ruleIx = i;
				break;
			}
		}
	}

	if (ruleIx !== -1) {
		result.push({
			action: 'update',
			index: ruleIx,
			value: ctx.cssText
		});
	}

	return result;
}

function setupFromPartialMatch(match, result) {
	// The `rest` property means we didn’t found exact section
	// where patch should be applied, but some of its parents.
	// In this case we have to re-create the `rest` sections
	// in best matching parent
	var accumulated = match.rest.reduceRight(function(prev, cur) {
		return cur.name + ' {' + prev + '}';
	}, '');

	var parent = match.parent;
	var insertIndex = parent.ref.cssRules ? parent.ref.cssRules.length : 0;
	if (match.node) {
		insertIndex = match.node.ix;
	}

	// console.log('Insert rule at index', insertIndex, match);
	try {
		var ix = parent.ref.insertRule(accumulated, insertIndex);
		if (!parent.ref.parentStyleSheet) {
			// inserted a top-level rule
			result.push({
				action: 'insert',
				index: ix,
				value: parent.ref.cssRules[ix].cssText
			});
		}
	} catch (e) {
		console.warn('LiveStyle:', e.message);
		return;
	}

	var ctx = parent.ref.cssRules[ix];
	var indexed = exports.createIndex(ctx);
	indexed.name = ruleName(ctx);
	indexed.ix = ix;
	parent.children.splice(match.index, 0, indexed);
	for (var i = match.index + 1, il = parent.children.length; i < il; i++) {
		parent.children[i].ix++;
	}

	while (ctx.cssRules && ctx.cssRules.length) {
		ctx = ctx.cssRules[0];
	}

	return ctx;
}

function deleteRuleFromMatch(match) {
	var result = null;
	try {
		parent(match.node.ref).deleteRule(match.node.ix);
	} catch (e) {
		console.warn('LiveStyle:', e);
		console.warn(match);
	}
	// console.log('Removed rule at index', match.node.ix);
	var ix = match.parent.children.indexOf(match.node);
	if (~ix) {
		match.parent.children.splice(ix, 1);
		for (var i = ix, il = match.parent.children.length, child; i < il; i++) {
			match.parent.children[i].ix--;
		}
	}
}

function normalizeHints(hints) {
	var comp = function(c) {
		return new NodePathComponent(c);
	};
	return hints.map(function(hint) {
		if (hint.before) {
			hint.before = hint.before.map(comp);
		}
		if (hint.after) {
			hint.after = hint.after.map(comp);
		}
		return hint;
	});
}