var gulp = require('gulp');
var gulpif = require('gulp-if');
var clean = require('gulp-clean');
var concat = require('gulp-concat');
var uglify = require('gulp-uglify');
var browserify = require('gulp-browserify');
var sourcemaps = require('gulp-sourcemaps');
var livereload = require('gulp-livereload');
var flags = require('minimist')(process.argv.slice(2));

// Gulp command line arguments
// e.g: gulp --production
// Gulp command line arguments
var production = flags.production || false;
var debug = flags.debug || !production;
var watch = flags.watch;

gulp.task('build', function() {
  return gulp.src([
    'lib/vendor/three.js',
    'lib/gaia-component.js',
    'src/vr-scene.js',
    'src/vr-object.js',
    'src/vr-camera.js',
    'src/vr-model.js'
    ])
    .pipe(gulpif(debug, sourcemaps.init()))
    .pipe(gulpif(production, uglify()))
    .pipe(concat('vr-components.js'))
    .pipe(gulpif(debug, sourcemaps.write()))
    .pipe(gulp.dest('./build/'))
    .pipe(gulpif(watch, livereload()));
});

gulp.task('clean', function() {
   return gulp.src(['./build'], {read: false})
          .pipe(clean({force: true}));
});

gulp.task('default', ['clean', 'build'])

