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
  extends: HTMLDivElement.prototype,

  created: function() {
    var fov = this.getAttribute('fov') || 45;
    this.findScene();
    this.setAttribute('fov', fov);
  },

  setFOV: function(fov) {
    var fov = 0.5 / Math.tan( THREE.Math.degToRad( fov * 0.5 ) ) * this.scene.clientHeight;
    this.perspective = fov;
    this.updateTransform();
  },

  attributeChanged: function(name, from, to) {
    if (name === "fov") {
      this.setFOV(to);
    }
    if (name === "style") {
      this.updateTransform();
    }
  },

  updateTransform: function() {
    var transform = "translate3d(0 , 0," + 0 + "px)";
    this.style.transform = transform;
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
    <style>

    :host {
      width: 100%;
      height: 100vh;
      position: absolute;
      transform-style: preserve-3d;
    }

    </style>`
});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('vr-camera',this));
