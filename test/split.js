var assert = require('assert');
var split = require('../lib/split');

describe('String split', function() {
	it('split', function() {
		assert.deepEqual(split('foo', ';'), ['foo']);
		assert.deepEqual(split('foo;bar', ';'), ['foo', 'bar']);
		assert.deepEqual(split('foo;bar;baz', ';'), ['foo', 'bar', 'baz']);
		assert.deepEqual(split('foo;bar;', ';'), ['foo', 'bar', '']);
		assert.deepEqual(split('foo";"bar', ';'), ['foo";"bar']);
		assert.deepEqual(split('foo\';\'bar', ';'), ['foo\';\'bar']);
		assert.deepEqual(split('foo;\';\'bar', ';'), ['foo', '\';\'bar']);
	});
});