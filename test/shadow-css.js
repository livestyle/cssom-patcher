var assert = require('assert');
var cssom = require('cssom').parse;
var patcher = require('../');

describe('Shadow CSS', function() {
	function patch(css, patch) {
		if (typeof css === 'string') {
			css = cssom(css);
		}
		return patcher.patch(css, patch);
	}

	function sync(css, updates) {
		if (typeof css === 'string') {
			css = cssom(css);
		}

		updates.forEach(function(item) {
			if (item.action === 'delete') {
				css.deleteRule(item.index);
			} else if (item.action === 'insert') {
				css.insertRule(item.value, item.index);
			} else if (item.action === 'update') {
				css.deleteRule(item.index);
				css.insertRule(item.value, item.index);
			}
		});
		return str(css);
	}

	function str(css) {
		return css.toString().trim().replace(/\n/g, ' ');
	}

	function test(css, p) {
		var actual = cssom(css);
		var shadow = cssom(css);
		var updates = patch(shadow, p);
		return [sync(actual, updates), str(shadow)];
	}

	it('strict match', function() {
		var p = {
			path: [['a', 1]], 
			action: 'update',
			update: [{name: 'b', value: '2'}],
			remove: []
		};

		assert.equal.apply(assert, test('a {b: c;} d {b: f;}', p));
		assert.equal.apply(assert, test('d {b: f;} a {b: c;}', p));
		assert.equal.apply(assert, test('d {b: f;} a {}', p));
		assert.equal.apply(assert, test('d {b: f;} a {foo: bar;}', p));

		p.path = [['@media print', 1], ['a', 1]];
		assert.equal.apply(assert, test('@media print {a {foo: bar;}}', p));

		// remove property
		p.remove = [{name: 'foo', value: 'bar'}];
		assert.equal.apply(assert, test('@media print {a {foo: bar;}}', p));
	});

	it('nearest match', function() {
		var p = {
			path: [['a', 2]], 
			action: 'update',
			update: [{name: 'b', value: '2'}],
			remove: []
		};

		assert.equal.apply(assert, test('a {b: c;}', p));
	});

	it('partial match', function() {
		var p = {
			path: [['c', 1]], 
			action: 'update',
			update: [{name: 'd', value: '2'}],
			remove: []
		};

		assert.equal.apply(assert, test('a{b:1;}', p));
		
		p.path = [['@media print', 1], ['c', 1]];
		assert.equal.apply(assert, test('a{b:1;}', p));

		// remove section
		var p = {
			path: [['a', 1]], 
			action: 'remove'
		};
		assert.equal.apply(assert, test('a{b:1;}', p));
	});

	it('add missing', function() {
		var p = {
			path: [['e', 1]], 
			action: 'add',
			update: [{name: 'd', value: '1'}],
			remove: []
		};

		assert.equal.apply(assert, test('a{b:1;} c{d:1;}', p));
	});

	it('sync properties', function() {
		var p = {
			path: [['a', 1]], 
			action: 'update',
			update: [{name: 'd', value: '5'}],
			remove: [],
			all: [{name: 'b', value: '10'}, {name: 'c', value: '20'}, {name: 'd', value: '5'}]
		};

		// Node.js CSSOM doesn’t know about shorthand CSS-properties (for example,
		// `background` is a shorthand for `background-color`, `background-position` etc.)
		// so we just check if workflow with `all` patch property operated normally.

		// In this case, patcher will override all properties from rule
		assert.equal.apply(assert, test('a{b:1; c:2; d:3}', p));
	});

	// cannot test it right now: doesn’t work in current CSSOM and buggy in Chrome 
	// it('top-level properties', function() {
	// 	var p = {
	// 		path: [], 
	// 		action: 'update',
	// 		update: [{name: '@import', value: 'url("abc")'}],
	// 		remove: []
	// 	};

	// 	assert.equal.apply(assert, test('a{b:1}', p));
	// });
});