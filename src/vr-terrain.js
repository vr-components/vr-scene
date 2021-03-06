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

module.exports = component.register('vr-terrain', {
  extends: VRObject.prototype,

  created: function() {
    var self = this;
    this.setupScene(onLoaded);
    function onLoaded() {
      VRObject.prototype.created.call(self);
      self.generateLabels(noise);
    }
  },

  setupScene: function(onLoaded) {
    var self = this;
    this.terrainSize = 1024;
    new Terrain(noise, this.terrainSize, 2, 64, function(model) {;
      self.object3D = model;
      onLoaded();
    });
  },

  generateLabels: function(noise) {
    var label;
    var max = 15;
    for(var i = 0; i < noise.image.data.length; ++i) {
      var noiseValue = noise.image.data[i];
      var sign1 = (Math.random()*10).toFixed(0) % 2 === 0? -1: 1;
      var sign2 = (Math.random()*10).toFixed(0) % 2 === 0? -1: 1;
      if (noiseValue > 80) {
        label = document.createElement('vr-billboard');
        label.classList.add('peak-label');
        label.style.setProperty('--x',  sign1 * (Math.random() * this.terrainSize));
        label.style.setProperty('--y',  sign2 * (Math.random() * this.terrainSize));
        label.style.setProperty('--z',  -noiseValue);
        label.style.setProperty('--rotX',  -90);
        label.innerHTML = "Landmark " + i;
        this.appendChild(label);
        max-=1;
        if (max == 0) {
          return;
        }
      }
    }
  }

});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('VRTerrain',this));
