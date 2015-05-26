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
    this.position = {
      x: 0,
      y: 0,
      z: 0
    };
    this.orientation = new VR.Euler(0, 0, 0);
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

  getCameraCSSMatrix: function (matrix) {
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
    var orientationX = this.orientation.x = this.getAttribute('lat') || 0;
    var orientationY = this.orientation.y = this.getAttribute('long') || 0;
    var x = this.position.x = this.getAttribute('x') || 0;
    var y = this.position.y = this.getAttribute('y') || 0;
    var z = this.position.z = this.getAttribute('z') || 0;

    var rotX = VR.Math.degToRad(orientationX);
    var rotY = VR.Math.degToRad(orientationY);

    var translation = new VR.Matrix4().makeTranslation(x, y, -z);
    var rotationY = new VR.Matrix4().makeRotationY(rotY);
    var rotationX = new VR.Matrix4().makeRotationX(rotX);
    var matrix = new VR.Matrix4();
    this.style.transform = 'translate3d(-50%, -50%, 0) ' + this.getCameraCSSMatrix(translation.multiply(rotationY.multiply(rotationX)));
    this.object3D.position.set(0, 0, -(this.perspective / 12 + z));
    this.object3D.rotation.set(-rotX, rotY, 0);
  },

  findScene: function() {
    var scenes = document.querySelectorAll('vr-scene');
    var perspective;
    for (var i=0; i < scenes.length; ++i) {
      this.scene = scenes[i];
      if (scenes[i] === this.parentNode) {
        perspective = window.getComputedStyle(this.scene, null).perspective;
        this.perspective = parseInt(perspective.substring(0, perspective.indexOf("px"))) - 1;
        return;
      }
    }

    this.perspective = 0;

    function isDescendant(parent, child) {
     var node = child.parentNode;
     while (node != null) {
         if (node == parent) {
             return true;
         }
         node = node.parentNode;
     }
     return false;
    }
  },

  template: `
    <content></content>
    :host {
      left: 50%;
      top: 50%;
    }
  `
});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('vr-object',this));
