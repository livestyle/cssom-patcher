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


		// console.log(patch('a {b: c;} d {b: f;}', p));

		// assert.equal(apply('a {b: c;} d {b: f;}', patch), 'a {b: 2;} d {b: f;}');
		// assert.equal(apply('d {b: f;} a {b: c;}', patch), 'd {b: f;} a {b: 2;}');
		// assert.equal(apply('d {b: f;} a {}', patch), 'd {b: f;} a {b: 2;}');
		// assert.equal(apply('d {b: f;} a {foo: bar;}', patch), 'd {b: f;} a {foo: bar; b: 2;}');

		// patch.path = [['@media print', 1], ['a', 1]];
		// assert.equal(apply('@media print {a {foo: bar;}}', patch), '@media print {a {foo: bar; b: 2;}}');

		// // remove property
		// patch.remove = [{name: 'foo', value: 'bar'}];
		// assert.equal(apply('@media print {a {foo: bar;}}', patch), '@media print {a {b: 2;}}');
	});
});