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

module.exports = component.register('vr-skybox', {
  extends: VRObject.prototype,

  created: function() {
    var self = this;
    this.setupScene();
    VRObject.prototype.created.call(self);
  },

  parameters: {
    turbidity: 10,
    reileigh: 2,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.8,
    luminance: 1,
    inclination: 0.49, // elevation / inclination
    azimuth: 0.25, // Facing front,
    sun: !true
  },

  setupScene: function() {
    var sky = this.sky = new THREE.Sky();
    var parameters = this.parameters;
    var uniforms = sky.uniforms;
    uniforms.turbidity.value = parameters.turbidity;
    uniforms.reileigh.value = parameters.reileigh;
    uniforms.luminance.value = parameters.luminance;
    uniforms.mieCoefficient.value = parameters.mieCoefficient;
    uniforms.mieDirectionalG.value = parameters.mieDirectionalG;
    sky.uniforms.sunPosition.value.copy(new THREE.Vector3( -20000, 0, -70000 ));
    // Add Sky Mesh
    this.object3D = sky.mesh;
  }

});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('VRSkyBox',this));
