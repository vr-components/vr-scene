var gulp = require('gulp');
var gulpif = require('gulp-if');
var clean = require('gulp-clean');
var concat = require('gulp-concat');
var uglify = require('gulp-uglify');
var webserver = require('gulp-webserver');
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
    'lib/vendor/BinaryLoader.js',
    'lib/gaia-component.js',
    'src/core/vr-scene.js',
    'src/core/vr-object.js',
    'src/core/vr-camera.js',
    'src/core/vr-model.js',
    'src/vr-billboard.js',
    'src/vr-terrain.js',
    'src/vr-axis-gl.js',
    'src/vr-axis-dom.js',
    'src/vr-lambo.js',
    'src/vr-hud.js',
    'src/vr-webview.js',
    'src/vr-walle.js',
    'src/vr-skybox.js'
    ])
    .pipe(gulpif(debug, sourcemaps.init()))
    .pipe(gulpif(production, uglify()))
    .pipe(concat('vr-components.js'))
    .pipe(gulpif(debug, sourcemaps.write()))
    .pipe(gulp.dest('./build/'))
});

gulp.task('clean', function() {
   return gulp.src(['./build'], {read: false})
          .pipe(clean({force: true}));
});

gulp.task('watch', function() {
  livereload.listen();
  gulp.watch(['src/*.js','src/*/*.js', 'gulpfile.js'], ['build']);
});

gulp.task('server', function() {
  gulp.src('./')
    .pipe(webserver({
      livereload: false,
      directoryListing: true,
      open: "examples/index.html",
      port: 9000
    }));
});

gulp.task('default', ['clean', 'build'])
