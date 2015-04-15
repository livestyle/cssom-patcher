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
export function list(stylesheet) {
	
}

/**
 * Normalizes given stylesheet: moves all @import’s
 * into separate nodes
 * @param  {StyleSheet} styleSheet
 */
export function normalize(styleSheet) {
	var IMPORT_RULE = 3;
	var node = styleSheet.ownerNode;
	var parent = node.parentNode;

	while (styleSheet.cssRules.length) {
		let rule = styleSheet.cssRules[0];
		if (rule.type !== IMPORT_RULE || !rule.styleSheet) {
			break;
		}

		let elem = createStyleSheetElem(rule.styleSheet.href);
		elem.setAttribute('data-livestyle-parent', styleSheet.href);
		parent.insertBefore(elem, node);
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