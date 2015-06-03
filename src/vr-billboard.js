/* globals define */
(function(define){'use strict';define(function(require,exports,module){

/**
 * Dependencies
 */

var component = require('gaia-component');

/**
 * Simple logger
 * @type {Function}
 */
var debug = 0 ? console.log.bind(console) : function() {};

/**
 * Exports
 */

module.exports = component.register('vr-billboard', {
  extends: VRObject.prototype,

  created: function() {
    VRObject.prototype.created.call(this);
    this.updateTransform();
  },

  update: function() {
    this.updateTransform();
  },

  updateTransform: function() {
    var camera = document.querySelector('vr-camera');
    var matrix = new THREE.Matrix4();
    matrix.copy( matrix.getInverse(camera.object3D.matrixWorld) );
    matrix.copy( camera.object3D.matrixWorld );

    matrix.transpose();

    matrix.elements[ 3 ] = 0;
    matrix.elements[ 7 ] = 0;
    matrix.elements[ 11 ] = 0;
    matrix.elements[ 15 ] = 1;

    // Position
    var x = this.style.getPropertyValue('--x') || 0;
    var y = this.style.getPropertyValue('--y') || 0;
    var z = this.style.getPropertyValue('--z') || 0;
    var translation = new THREE.Matrix4().makeTranslation(x, y, -z);

    // Orientation
    var orientationX = this.style.getPropertyValue('--rotX') || 0;
    var orientationY = this.style.getPropertyValue('--rotY') || 0;
    var orientationZ = this.style.getPropertyValue('--rotZ') || 0;

    var rotX = THREE.Math.degToRad(orientationX);
    var rotY = THREE.Math.degToRad(orientationY);
    var rotZ = THREE.Math.degToRad(orientationZ);
    var rotationX = new THREE.Matrix4().makeRotationX(rotX);
    var rotationY = new THREE.Matrix4().makeRotationY(rotY);
    var rotationZ = new THREE.Matrix4().makeRotationX(rotZ);

    this.style.transform = 'translate3d(-50%, -50%, 0) ' + this.getCSSMatrix(translation.multiply(rotationZ.multiply(rotationY.multiply(rotationX.multiply(matrix)))));
    this.object3D.position.set(x, -y, -z);
    this.object3D.rotation.order = 'YXZ';
    this.object3D.rotation.set(-rotX, rotY, rotZ);
  }

});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('VRBillboard',this));
