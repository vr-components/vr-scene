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
    new Terrain(noise, 1024, 4, 64, function(model) {;
      var x = self.style.getPropertyValue('--x') || 0;
      var y = self.style.getPropertyValue('--y') || 0;
      var z = self.style.getPropertyValue('--z') || 0;
      model.position.set(x, y, -z);
      self.object3D = model;
      onLoaded();
    });
  },

  generateLabels: function(noise) {
    var hud = document.querySelector('.hud');
    var label;
    var max = 20;
    for(var i = 0; i < noise.image.data.length; ++i) {
      var noiseValue = noise.image.data[i];
      var sign1 = (Math.random()*10).toFixed(0) % 2 === 0? -1: 1;
      var sign2 = (Math.random()*10).toFixed(0) % 2 === 0? -1: 1;
      if (noiseValue > 80) {
        label = document.createElement('vr-billboard');
        label.classList.add('peak-label');
        label.style.setProperty('--x',  sign1 * (Math.random() * 1024));
        label.style.setProperty('--y',  sign2 * (Math.random() * 1024));
        label.style.setProperty('--z',  -noiseValue - 50);
        label.style.setProperty('--rotX',  -90);
        label.innerHTML = "Landmark " + i;
        hud.appendChild(label);
        max-=1;
        if (max == 0) {
          return;
        }
      }
    }
  },

  template: `
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
return w[n];},m.exports,m);w[n]=m.exports;};})('VRTerrain',this));
