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

module.exports = component.register('vr-camera', {
  extends: VRObject.prototype,

  updateTransform: function() {
    var elStyles = window.getComputedStyle(this);
    // Position
    var x = elStyles.getPropertyValue('--x') || 0;
    var y = elStyles.getPropertyValue('--y') || 0;
    var z = elStyles.getPropertyValue('--z') || 0;
    var translation = new VR.Matrix4().makeTranslation(x, y, -z);

    // Orientation
    var orientationX = elStyles.getPropertyValue('--rotX') || 0;
    var orientationY = elStyles.getPropertyValue('--rotY') || 0;
    var orientationZ = elStyles.getPropertyValue('--rotZ') || 0;
    var rotX = VR.Math.degToRad(orientationX);
    var rotY = VR.Math.degToRad(orientationY);
    var rotZ = VR.Math.degToRad(orientationZ);
    var rotationX = new VR.Matrix4().makeRotationX(rotX);
    var rotationY = new VR.Matrix4().makeRotationY(rotY);
    var rotationZ = new VR.Matrix4().makeRotationX(rotZ);
    var matrixCSS = rotationZ.multiply(rotationY.multiply(rotationX.multiply(translation)));

    this.style.transform = 'translate3d(-50%, -50%, 0) ' + this.getCameraCSSMatrix(matrixCSS);

    // Matrix threejs
    rotationX = new VR.Matrix4().makeRotationX(-rotX);
    rotationY = new VR.Matrix4().makeRotationY(rotY);
    rotationZ = new VR.Matrix4().makeRotationX(rotZ);
    var matrix = rotationZ.multiply(rotationY.multiply(rotationX.multiply(translation)));

    var object3D = this.object3D;
    object3D.matrixAutoUpdate = false;
    object3D.matrix = matrix;

  },

  template: `
    <content></content>
    :host {
      left: 50%;
      top: 50%;
      position: absolute;
      transform-style: preserve-3d;
    }
  `
});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('VRCamera',this));
