'use strict';
/**
 * Current Chrome (ver. 42) has a critical bug:
 * when creating a new CSS @import rule with `insertRule()`, 
 * all stylesheets on page will be destroyed.
 *
 * This module provides a high-level workaround for inserting 
 * @import’s: they will be inserted as <link rel="stylesheet"> 
 * elements instead.
 */
import path from 'path';

/**
 * Returns list of all imported stylesheets for given one
 * @param  {StyleSheet} stylesheet
 * @return {Array}
 */
export function list(styleSheet) {
	var url = styleSheetUrl(styleSheet);
	if (!url) {
		return [];
	}

	$('link[rel="stylesheet"]').filter(link => parentUrl(link) === url);
}

/**
 * Resolves path for given style sheet
 * @param  {StyleSheet} styleSheet
 * @param  {String} url
 * @return {String}
 */
export function resolvePath(styleSheet, url) {
	if (/^\w+:/.test(url)) {
		// absolute path with protocol: no need to resolve
		return url;
	}

	var parentUrl = styleSheetUrl(styleSheet) || location.href;
	var parsed = parseUrl(parentUrl);
	return parsed.origin + path.resolve(path.dirname(parsed.pathname), url);
}

/**
 * Removes given pseudo-imported node
 * @param  {Node} node
 */
export function remove(node) {
	node && node.parentNode && node.parentNode.removeChild(node);
}

/**
 * Adds pseudo-import for given stylesheet
 * @param {StyleSheet} styleSheet
 * @param {String} url
 */
export function add(styleSheet, url) {
	var elem = createStyleSheetElem(resolvePath(styleSheet, url));
	elem.setAttribute('data-livestyle-parent', styleSheetUrl(styleSheet));

	var node = styleSheet.ownerNode;
	var parent = node.parentNode;
	parent.insertBefore(elem, node);
	return elem;
}

/**
 * Normalizes given stylesheet: moves all @import’s
 * into separate nodes
 * @param  {StyleSheet} styleSheet
 */
export function normalize(styleSheet) {
	var IMPORT_RULE = 3;

	while (styleSheet.cssRules.length) {
		let rule = styleSheet.cssRules[0];
		if (rule.type !== IMPORT_RULE || !rule.styleSheet) {
			break;
		}

		add(styleSheet, rule.styleSheet.href);
		styleSheet.deleteRule(0);
	}

	return styleSheet;
}

function createStyleSheetElem(href) {
	var elem = document.createElement('link');
	elem.setAttribute('rel', 'stylesheet');
	elem.setAttribute('href', href);
	return elem;
}

function toArray(obj, ix=0) {
	return Array.prototype.slice.call(obj, ix);
}

function $(sel, context=document) {
	return toArray(context.querySelectorAll(sel));
}

function parentUrl(node) {
	return node && node.getAttribute('data-livestyle-parent');
}

function styleSheetUrl(styleSheet) {
	return styleSheet.href;
}

function parseUrl(url) {
	var a = document.createElement('a');
	a.href = url;
	return a;

}