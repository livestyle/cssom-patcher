var gulp = require('gulp');
var js = require('js-bundler');
var rename = require('gulp-rename');

gulp.task('js', function() {
	return gulp.src('./index.js')
	.pipe(js({
		global: true,
		detectGlobals: false,
		standalone: 'livestyleCSSOM'
	}))
	.pipe(rename('livestyle-cssom.js'))
	.pipe(gulp.dest('./out'));
});

gulp.task('watch', ['default'], function() {
	gulp.watch(['./index.js', 'lib/*.js'], ['js']);
});

gulp.task('default', ['js']);