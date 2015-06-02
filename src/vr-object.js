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

module.exports = component.register('vr-object', {
  extends: HTMLDivElement.prototype,

  created: function() {
    this.setupShadowRoot();
    this.findScene();
    this.scene.addObject(this);
    this.updateTransform();
  },

  attributeChanged: function(name, from, to) {
    this.updateTransform();
  },

  epsilon: function ( value ) {
    return Math.abs( value ) < 0.000001 ? 0 : value;
  },

  update: function() { /* NOOP */ },

  updateChildren: function() {
    var child;
    var i;
    for (i = 0; i < this.children.length; ++i) {
      child = this.children[i];
      if (typeof child.update == 'function') { child.update(); }
      if (typeof child.updateChildren == 'function') { child.updateChildren(); }
    }
  },

  getCSSMatrix: function (matrix) {
    var epsilon = this.epsilon;
    var elements = matrix.elements;

    return 'matrix3d(' +
      epsilon( elements[ 0 ] ) + ',' +
      epsilon( elements[ 1 ] ) + ',' +
      epsilon( elements[ 2 ] ) + ',' +
      epsilon( elements[ 3 ] ) + ',' +
      epsilon( elements[ 4 ] ) + ',' +
      epsilon( elements[ 5 ] ) + ',' +
      epsilon( elements[ 6 ] ) + ',' +
      epsilon( elements[ 7 ] ) + ',' +
      epsilon( elements[ 8 ] ) + ',' +
      epsilon( elements[ 9 ] ) + ',' +
      epsilon( elements[ 10 ] ) + ',' +
      epsilon( elements[ 11 ] ) + ',' +
      epsilon( elements[ 12 ] ) + ',' +
      epsilon( elements[ 13 ] ) + ',' +
      epsilon( elements[ 14 ] ) + ',' +
      epsilon( elements[ 15 ] ) +
    ')';
  },

  updateTransform: function() {
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

    this.style.transform = 'translate3d(-50%, -50%, 0) ' + this.getCSSMatrix(translation.multiply(rotationZ.multiply(rotationY.multiply(rotationX))));
    this.object3D.position.set(x, -y, -z);
    this.object3D.rotation.order = 'YXZ';
    this.object3D.rotation.set(-rotX, rotY, 0);
  },

  findScene: function() {
    var scenes = document.querySelectorAll('vr-scene');
    var perspective;
    for (var i=0; i < scenes.length; ++i) {
      this.scene = scenes[i];
    }
  },

  template: `
    <content></content>
    <style>
    :host {
      left: 50%;
      top: 50%;
      position: absolute;
      transform-style: preserve-3d;
    }
    </style>
  `
});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('VRObject',this));
