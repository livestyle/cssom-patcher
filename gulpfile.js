var gulp = require('gulp');
var uglify = require('gulp-uglify');
var browserify = require('browserify');
var streamify = require('gulp-streamify');
var through = require('through2');
var source = require('vinyl-source-stream');

gulp.task('build', function() {
	return browserify({
		entries: './index.js',
		detectGlobals: false,
		standalone: 'livestyleCSSOM'
	})
	.bundle()
	.pipe(source('livestyle-cssom.js'))
	.pipe(streamify(uglify()))
	.pipe(gulp.dest('./out'));
});

gulp.task('default', ['build']);