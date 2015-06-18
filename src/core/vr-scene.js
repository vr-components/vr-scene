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
    this.setupEventHandlers();
    this.setupShadowRoot();
    this.setupRenderer();
    this.setupScene();
    this.setupCamera();
  },

  setupEventHandlers: function() {
    var processDevices = this.processDevices.bind(this);
    var onfullscreenchange = this.onfullscreenchange.bind(this);
    document.addEventListener("webkitfullscreenchange", onfullscreenchange);
    document.addEventListener("mozfullscreenchange",    onfullscreenchange);
    document.addEventListener("fullscreenchange",       onfullscreenchange);
    this.getVRDevices().then(processDevices)['catch'](function (err) {
      console.warn(err);
    });
  },

  onfullscreenchange: function() {
    if ( !document.mozFullScreenElement && !document.webkitFullScreenElement ) {
      this.viewporTransform = this.cameraProjectionTransform;
      this.vrMode = false;
      this.vrEffect.scale = 1;
    } else {
      this.vrMode = true;
      this.viewporTransform = "translate3d(-50%, -50%, 0px)";
      this.vrEffect.scale = 2500;
    }
    this.resizeCanvas();
  },

  addObject: function(el, provided_obj) {
    var obj = el.object3D;
    var objParent = el.parentNode;
    if (obj && this.scene.getObjectById(obj.id)) {
      return obj;
    }
    obj = el.object3D = el.object3D || provided_obj || new THREE.Object3D();
    obj.scene = this;
    if (objParent && objParent !== this) {
      objParent = this.addObject(el.parentNode);
      objParent.add(obj);
    } else {
      this.scene.add(obj);
    }
    return obj;
  },

  epsilon: function ( value ) {
    return Math.abs( value ) < 0.000001 ? 0 : value;
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

  setupCamera: function() {
    var fov = parseFloat(this.style.getPropertyValue('--fov')) || 45;
    var viewport = this.viewport = this.shadowRoot.querySelector('.viewport');
    var world = this.world = this.shadowRoot.querySelector('.world');
    this.perspective = 0.5 / Math.tan( THREE.Math.degToRad( fov * 0.5 ) ) * this.offsetHeight;

    // DOM camera
    var perspectiveMatrix = this.perspectiveMatrix(THREE.Math.degToRad(fov), this.offsetWidth / this.offsetHeight, 1, 10000);
    var scaled = perspectiveMatrix.clone().scale(new THREE.Vector3(this.offsetWidth, this.offsetHeight, 1));
    var style = this.cameraProjectionTransform = this.getCSSMatrix(scaled);
    this.viewporTransform = style;

    // WebGL camera
    var camera = this.camera = new THREE.PerspectiveCamera(fov, this.offsetWidth / this.offsetHeight, 1, 10000);
    this.vrControls = new THREE.VRControls( camera );

  },

  perspectiveMatrix: function(fov, aspect, nearz, farz) {
    var matrix = new THREE.Matrix4();
    var range = Math.tan(fov * 0.5) * nearz;

    matrix.elements[0] = (2 * nearz) / ((range * aspect) - (-range * aspect));
    matrix.elements[1] = 0;
    matrix.elements[2] = 0;
    matrix.elements[3] = 0;
    matrix.elements[4] = 0;
    matrix.elements[5] = (2 * nearz) / (2 * range);
    matrix.elements[6] = 0;
    matrix.elements[7] = 0;
    matrix.elements[8] = 0;
    matrix.elements[9] = 0;
    matrix.elements[10] = -(farz + nearz) / (farz - nearz);
    matrix.elements[11] = -1;
    matrix.elements[12] = 0;
    matrix.elements[13] = 0;
    matrix.elements[14] = -(2 * farz * nearz) / (farz - nearz);
    matrix.elements[15] = 0;
    return matrix.transpose();
  },

  setupRenderer: function() {
    // All WebGL setup
    var canvas = this.canvas = this.shadowRoot.querySelector('canvas');

    this.resizeCanvas();
    window.addEventListener('resize', this.resizeCanvas.bind(this), false);

    var renderer = this.renderer = new THREE.WebGLRenderer( { canvas: canvas, antialias: true, alpha: true } );
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( this.canvas.width, this.canvas.height );
    renderer.sortObjects = false;
    this.vrEffect = new THREE.VREffect(renderer);
  },

  setupScene: function() {
    // All WebGL Setup
    var scene = this.scene = new THREE.Scene();
    createLights();
    function createLights() {
      var directionalLight = new THREE.DirectionalLight(0xffffff);
      directionalLight.position.set(1, 1, 1).normalize();
      scene.add(directionalLight);
    }
  },

  updateChildren: function() {
    var child;
    var i;
    for (i = 0; i < this.children.length; ++i) {
      child = this.children[i];
      if (typeof child.update == 'function') { child.update(); }
      if (typeof child.updateChildren == 'function') { child.updateChildren(); }
    }
  },

  resizeCanvas: function(renderer, camera){
    var canvas = this.canvas;
    // Make it visually fill the positioned parent
    canvas.style.width ='100%';
    canvas.style.height='100%';
    // ...then set the internal size to match
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    if (this.camera) {
      this.camera.aspect = canvas.width / canvas.height;
      this.camera.updateProjectionMatrix();
    }

    if (this.renderer) {
      // notify the renderer of the size change
      this.renderer.setSize( canvas.width, canvas.height );
    }

  },

  animate: function() {
    var renderer = this.vrMode? this.vrEffect : this.renderer;
    this.updateChildren();
    this.vrControls.update();
    var orientation = this.vrControls.state.orientation;
    var orientationMatrix;
    var quaternion;
    if (orientation) {
      quaternion = new THREE.Quaternion(orientation.x, -orientation.y, orientation.z, orientation.w);
      orientationMatrix = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
      this.viewport.style.transform = this.viewporTransform + ' ' + this.getCSSMatrix(orientationMatrix);
    } else {
      this.viewport.style.transform = this.viewporTransform;
      //this.viewport.style.perspective = this.perspective + 'px';
      //this.world.style.setProperty('--z', -this.perspective);
    }
    renderer.render(this.scene, this.camera);
  },

  attributeChanged: function(name, from, to) {
    if (name === "angle") {
      this.style.transform = 'rotateY( ' + this.angle + 'deg )';
    }
  },

  filterInvalidDevices: function(devices) {
    var oculusDevices = devices.filter(function (device) {
      return device.deviceName.toLowerCase().indexOf('oculus') !== -1;
    });

    if (oculusDevices.length >= 1) {
      return devices.filter(function (device) {
        return device.deviceName.toLowerCase().indexOf('cardboard') === -1;
      });
    } else {
      return devices;
    }
  },

   processDevices: function(devices) {
      devices = this.filterInvalidDevices(devices);

      var headset = undefined;
      var position = undefined;

      for (var i = 0; i < devices.length; i++) {
        var device = devices[i];
        if (device instanceof HMDVRDevice) {
          headset = device;
        }
        if (device instanceof PositionSensorVRDevice) {
          position = device;
        }
        if (position && headset) {
          this.vr = {
            headset: headset,
            position: position
          };
        }
      }
  },

  getVRDevices: function(callback) {
    return new Promise(function (resolve, reject) {
      if (navigator.getVRDevices) {
        navigator.getVRDevices().then(function (devices) {
          resolve(devices);
        }, reject);
      } else {
        reject('No VR devices found.');
      }
    });
  },

  startVR: function() {
    this.mozRequestFullScreen({
      vrDisplay: this.vr.headset
    });
  },

  resetSensor: function() {
    if (this.vr.position) {
      this.vr.position.resetSensor();
    }
  },

  template: `
    <canvas width="100%" height="100%"></canvas>
    <div class="viewport">
        <content></content>
    </div>

    <style>
      :host {
        position: absolute;
        display: inline-block;
        width: 100%;
        height: 100%;
        background-image:
          radial-gradient(
            #0B6790,
            #14364A
          );
      }

      .viewport {
        position: absolute;
        display: inline-block;
        width: 100%;
        height: 100%;
        transform-style: preserve-3d;
      }

      canvas {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
      }
    </style>`
});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('VRSCene',this));
