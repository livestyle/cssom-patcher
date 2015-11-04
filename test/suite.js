var assert = require('assert');
var cssom = require('cssom').parse;
var patcher = require('../');

describe('CSSOM Patcher', function() {
	function apply(css, patch) {
		css = cssom(css);
		patcher.patch(css, patch);
		return css.toString().trim().replace(/\n/g, ' ');
	}

	it('strict match', function() {
		var patch = {
			path: [['a', 1]], 
			action: 'update',
			update: [{name: 'b', value: '2'}],
			remove: []
		};

		assert.equal(apply('a {b: c;} d {b: f;}', patch), 'a {b: 2;} d {b: f;}');
		assert.equal(apply('d {b: f;} a {b: c;}', patch), 'd {b: f;} a {b: 2;}');
		assert.equal(apply('d {b: f;} a {}', patch), 'd {b: f;} a {b: 2;}');
		assert.equal(apply('d {b: f;} a {foo: bar;}', patch), 'd {b: f;} a {foo: bar; b: 2;}');

		patch.path = [['@media print', 1], ['a', 1]];
		assert.equal(apply('@media print {a {foo: bar;}}', patch), '@media print {a {foo: bar; b: 2;}}');

		// remove property
		patch.remove = [{name: 'foo', value: 'bar'}];
		assert.equal(apply('@media print {a {foo: bar;}}', patch), '@media print {a {b: 2;}}');
	});

	it('nearest match', function() {
		var patch = {
			path: [['a', 2]], 
			action: 'update',
			update: [{name: 'b', value: '2'}],
			remove: []
		};

		assert.equal(apply('a {b: c;}', patch), 'a {b: 2;}');
	});

	it('partial match', function() {
		var patch = {
			path: [['c', 1]], 
			action: 'update',
			update: [{name: 'd', value: '2'}],
			remove: []
		};

		assert.equal(apply('a{b:1;}', patch), 'a {b: 1;} c {d: 2;}');
		
		patch.path = [['@media print', 1], ['c', 1]];
		assert.equal(apply('a{b:1;}', patch), 'a {b: 1;} @media print {c {d: 2;}}');

		// remove section
		var patch = {
			path: [['a', 1]], 
			action: 'remove'
		};
		assert.equal(apply('a{b:1;}', patch), '');
	});

	it('add missing', function() {
		var patch = {
			path: [['e', 1]], 
			action: 'add',
			update: [{name: 'd', value: '1'}],
			remove: []
		};

		assert.equal(apply('a{b:1;} c{d:1;}', patch), 'a {b: 1;} c {d: 1;} e {d: 1;}');
	});

	it('sync properties', function() {
		var patch = {
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
		assert.equal(apply('a{b:1; c:2; d:3}', patch), 'a {b: 10; c: 20; d: 5;}');
	});
});