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

module.exports = component.register('vr-scene', {
  extends: HTMLDivElement.prototype,

  created: function() {
    this.setupShadowRoot();
    this.setFOV(45);
    this.setupWebGLScene();
    this.animate();
  },

  addObject: function(el) {
    var obj = el.object3D = el.object3D || new THREE.Object3D();
    var objParent = el.parentNode;
    this.scene.remove(obj);
    if (objParent && objParent !== this) {
      objParent = this.addObject(el.parentNode);
      objParent.add(obj);
    } else {
      this.scene.add(obj);
    }
    return obj;
  },

  setFOV: function(fov) {
    var fov = 0.5 / Math.tan( THREE.Math.degToRad( fov * 0.5 ) ) * this.clientHeight;
    this.style.perspective = fov + "px";
    var camera = this.shadowRoot.querySelector('.camera');
    camera.style.height = this.clientHeight + 'px';
    camera.style.width = this.clientWidth + 'px';
    var transform = "translate3d(0,0," + fov + "px)";
    camera.style.transform = transform;
  },

  setupWebGLScene: function() {
    var canvas = this.canvas = this.shadowRoot.querySelector('canvas');
    this.resizeCanvas();
    var camera = this.camera = new THREE.PerspectiveCamera(45, this.canvas.width / this.canvas.height, 1, 10000 );
    camera.position.z = 0;
    var scene = this.scene = new THREE.Scene();
    var renderer = this.renderer = new THREE.WebGLRenderer( { canvas: canvas, antialias: true, alpha: true } );
    createLights();
    renderer.setSize( this.canvas.width, this.canvas.height );
    renderer.sortObjects = false;
    renderer.render(scene, camera);
    function createLights() {
      var directionalLight = new THREE.DirectionalLight(0xffffff);
      directionalLight.position.set(1, 1, 1).normalize();
      scene.add(directionalLight);
    }
    // bind the resize event
    window.addEventListener('resize', this.resizeCanvas.bind(this), false);
  },

  resizeCanvas: function(renderer, camera){
    // notify the renderer of the size change
    this.renderer.setSize( this.canvas.width, this.canvas.height );
    this.camera.aspect = this.canvas.width / this.canvas.height;
    this.camera.updateProjectionMatrix();
  },

  resizeCanvas: function () {
    var canvas = this.canvas;
    // Make it visually fill the positioned parent
    canvas.style.width ='100%';
    canvas.style.height='100%';
    // ...then set the internal size to match
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    //var ctx = this.context = canvas.getContext('2d');
    //ctx.fillStyle = "red";
    //ctx.fillRect(10, 10, 100, 100);
  },

  animate: function() {
    var self = this;
    requestAnimationFrame(function() {
      self.animate();
    });
    self.renderer.render(self.scene, self.camera);
  },

  attributeChanged: function(name, from, to) {
    if (name === "angle") {
      this.style.transform = 'rotateY( ' + this.angle + 'deg )';
    }
  },

  template: `
    <canvas width="100%" height="100%"></canvas>
    <div class="camera">
      <content></content>
    </div>
    <style>

    :host {
      position: relative;
      display: inline-block;
      box-sizing: border-box;
      transform-style: preserve-3d;
      width: 100%;
      height: 100vh;
    }

    :host vr-object, vr-model {
      position: absolute;
      transform-style: preserve-3d;
    }

    .camera, canvas {
      position: absolute;
      transform-style: preserve-3d;
    }

    </style>`
});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('vr-scene',this));
