/* globals define */
;(function(define){'use strict';define(function(require,exports,module){
/**
 * Locals
 */
var textContent = Object.getOwnPropertyDescriptor(Node.prototype,
    'textContent');
var innerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
var removeAttribute = Element.prototype.removeAttribute;
var setAttribute = Element.prototype.setAttribute;
var noop  = function() {};

/**
 * Register a new component.
 *
 * @param  {String} name
 * @param  {Object} props
 * @return {constructor}
 * @public
 */
exports.register = function(name, props) {
  var baseProto = getBaseProto(props.extends);

  // Clean up
  delete props.extends;

  // Pull out CSS that needs to be in the light-dom
  if (props.template) {
    var output = processCss(props.template, name);

    props.template = document.createElement('template');
    props.template.innerHTML = output.template;
    props.lightCss = output.lightCss;

    props.globalCss = props.globalCss || '';
    props.globalCss += output.globalCss;
  }

  // Inject global CSS into the document,
  // and delete as no longer needed
  injectGlobalCss(props.globalCss);
  delete props.globalCss;

  // Merge base getter/setter attributes with the user's,
  // then define the property descriptors on the prototype.
  var descriptors = mixin(props.attrs || {}, base.descriptors);

  // Store the orginal descriptors somewhere
  // a little more private and delete the original
  props._attrs = props.attrs;
  delete props.attrs;

  // Create the prototype, extended from base and
  // define the descriptors directly on the prototype
  var proto = createProto(baseProto, props);
  Object.defineProperties(proto, descriptors);

  // Register the custom-element and return the constructor
  try {
    return document.registerElement(name, { prototype: proto });
  } catch (e) {
    if (e.name !== 'NotSupportedError') {
      throw e;
    }
  }
};

var base = {
  properties: {
    GaiaComponent: true,
    attributeChanged: noop,
    attached: noop,
    detached: noop,
    created: noop,

    createdCallback: function() {
      if (this.rtl) { addDirObserver(); }
      injectLightCss(this);
      this.created();
    },

    /**
     * It is very common to want to keep object
     * properties in-sync with attributes,
     * for example:
     *
     *   el.value = 'foo';
     *   el.setAttribute('value', 'foo');
     *
     * So we support an object on the prototype
     * named 'attrs' to provide a consistent
     * way for component authors to define
     * these properties. When an attribute
     * changes we keep the attr[name]
     * up-to-date.
     *
     * @param  {String} name
     * @param  {String||null} from
     * @param  {String||null} to
     */
    attributeChangedCallback: function(name, from, to) {
      var prop = toCamelCase(name);
      if (this._attrs && this._attrs[prop]) { this[prop] = to; }
      this.attributeChanged(name, from, to);
    },

    attachedCallback: function() { this.attached(); },
    detachedCallback: function() { this.detached(); },

    /**
     * A convenient method for setting up
     * a shadow-root using the defined template.
     *
     * @return {ShadowRoot}
     */
    setupShadowRoot: function() {
      if (!this.template) { return; }
      var node = document.importNode(this.template.content, true);
      this.createShadowRoot().appendChild(node);
      return this.shadowRoot;
    },

    /**
     * Sets an attribute internally
     * and externally. This is so that
     * we can style internal shadow-dom
     * content.
     *
     * @param {String} name
     * @param {String} value
     */
    setAttr: function(name, value) {
      var internal = this.shadowRoot.firstElementChild;
      setAttribute.call(internal, name, value);
      setAttribute.call(this, name, value);
    },

    /**
     * Removes an attribute internally
     * and externally. This is so that
     * we can style internal shadow-dom
     * content.
     *
     * @param {String} name
     * @param {String} value
     */
    removeAttr: function(name) {
      var internal = this.shadowRoot.firstElementChild;
      removeAttribute.call(internal, name);
      removeAttribute.call(this, name);
    }
  },

  descriptors: {
    textContent: {
      set: function(value) {
        textContent.set.call(this, value);
        if (this.lightStyle) { this.appendChild(this.lightStyle); }
      },

      get: function() {
        return textContent.get();
      }
    },

    innerHTML: {
      set: function(value) {
        innerHTML.set.call(this, value);
        if (this.lightStyle) { this.appendChild(this.lightStyle); }
      },

      get: innerHTML.get
    }
  }
};

/**
 * The default base prototype to use
 * when `extends` is undefined.
 *
 * @type {Object}
 */
var defaultPrototype = createProto(HTMLElement.prototype, base.properties);

/**
 * Returns a suitable prototype based
 * on the object passed.
 *
 * @private
 * @param  {HTMLElementPrototype|undefined} proto
 * @return {HTMLElementPrototype}
 */
function getBaseProto(proto) {
  if (!proto) { return defaultPrototype; }
  proto = proto.prototype || proto;
  return !proto.GaiaComponent ?
    createProto(proto, base.properties) : proto;
}

/**
 * Extends the given proto and mixes
 * in the given properties.
 *
 * @private
 * @param  {Object} proto
 * @param  {Object} props
 * @return {Object}
 */
function createProto(proto, props) {
  return mixin(Object.create(proto), props);
}

/**
 * Detects presence of shadow-dom
 * CSS selectors.
 *
 * @private
 * @return {Boolean}
 */
var hasShadowCSS = (function() {
  var div = document.createElement('div');
  try { div.querySelector(':host'); return true; }
  catch (e) { return false; }
})();

/**
 * Regexs used to extract shadow-css
 *
 * @type {Object}
 */
var regex = {
  shadowCss: /(?:\:host|\:\:content)[^{]*\{[^}]*\}/g,
  ':host': /(?:\:host)/g,
  ':host()': /\:host\((.+)\)(?: \:\:content)?/g,
  ':host-context': /\:host-context\((.+)\)([^{,]+)?/g,
  '::content': /(?:\:\:content)/g
};

/**
 * Extracts the :host and ::content rules
 * from the shadow-dom CSS and rewrites
 * them to work from the <style scoped>
 * injected at the root of the component.
 *
 * @private
 * @return {String}
 */
function processCss(template, name) {
  var globalCss = '';
  var lightCss = '';

  if (!hasShadowCSS) {
    template = template.replace(regex.shadowCss, function(match) {
      var hostContext = regex[':host-context'].exec(match);

      if (hostContext) {
        globalCss += match
          .replace(regex['::content'], '')
          .replace(regex[':host-context'], '$1 ' + name + '$2')
          .replace(/ +/g, ' '); // excess whitespace
      } else {
        lightCss += match
          .replace(regex[':host()'], name + '$1')
          .replace(regex[':host'], name)
          .replace(regex['::content'], name);
      }

      return '';
    });
  }

  return {
    template: template,
    lightCss: lightCss,
    globalCss: globalCss
  };
}

/**
 * Some CSS rules, such as @keyframes
 * and @font-face don't work inside
 * scoped or shadow <style>. So we
 * have to put them into 'global'
 * <style> in the head of the
 * document.
 *
 * @private
 * @param  {String} css
 */
function injectGlobalCss(css) {
  if (!css) {return;}
  var style = document.createElement('style');
  style.innerHTML = css.trim();
  headReady().then(function() {
    document.head.appendChild(style);
  });
}


/**
 * Resolves a promise once document.head is ready.
 *
 * @private
 */
function headReady() {
  return new Promise(function(resolve) {
    if (document.head) { return resolve(); }
    window.addEventListener('load', function fn() {
      window.removeEventListener('load', fn);
      resolve();
    });
  });
}


/**
 * The Gecko platform doesn't yet have
 * `::content` or `:host`, selectors,
 * without these we are unable to style
 * user-content in the light-dom from
 * within our shadow-dom style-sheet.
 *
 * To workaround this, we clone the <style>
 * node into the root of the component,
 * so our selectors are able to target
 * light-dom content.
 *
 * @private
 */
function injectLightCss(el) {
  if (hasShadowCSS) { return; }
  el.lightStyle = document.createElement('style');
  el.lightStyle.setAttribute('scoped', '');
  el.lightStyle.innerHTML = el.lightCss;
  el.appendChild(el.lightStyle);
}

/**
 * Convert hyphen separated
 * string to camel-case.
 *
 * Example:
 *
 *   toCamelCase('foo-bar'); //=> 'fooBar'
 *
 * @private
 * @param  {Sring} string
 * @return {String}
 */
function toCamelCase(string) {
  return string.replace(/-(.)/g, function replacer(string, p1) {
    return p1.toUpperCase();
  });
}

/**
 * Observer (singleton)
 *
 * @type {MutationObserver|undefined}
 */
var dirObserver;

/**
 * Observes the document `dir` (direction)
 * attribute and dispatches a global event
 * when it changes.
 *
 * Components can listen to this event and
 * make internal changes if need be.
 *
 * @private
 */
function addDirObserver() {
  if (dirObserver) { return; }

  dirObserver = new MutationObserver(onChanged);
  dirObserver.observe(document.documentElement, {
    attributeFilter: ['dir'],
    attributes: true
  });

  function onChanged(mutations) {
    document.dispatchEvent(new Event('dirchanged'));
  }
}

/**
 * Copy the values of all properties from
 * source object `target` to a target object `source`.
 * It will return the target object.
 *
 * @private
 * @param   {Object} target
 * @param   {Object} source
 * @returns {Object}
 */
function mixin(target, source) {
  for (var key in source) {
    target[key] = source[key];
  }
  return target;
}

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('gaia-component',this));

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
    this.setupRenderer();
    this.setupScene();
    this.setupCamera();
  },

  addObject: function(el, provided_obj) {
    var obj = el.object3D;
    var objParent = el.parentNode;
    if (obj && this.scene.getObjectById(obj.id)) {
      return obj;
    }
    obj = el.object3D = el.object3D || provided_obj || new THREE.Object3D();
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
    var fov = this.style.getPropertyValue('--fov') || 45;
    var viewport = this.shadowRoot.querySelector('.viewport');

    // DOM camera
    var perspectiveMatrix = this.perspectiveMatrix(THREE.Math.degToRad(45), this.offsetWidth / this.offsetHeight, 1, 5000);
    var scaled = perspectiveMatrix.clone().scale(new THREE.Vector3(this.offsetWidth, this.offsetHeight, 1));
    var style = this.getCSSMatrix(scaled);
    viewport.style.transform = style;

    // WebGL camera
    this.camera = new THREE.PerspectiveCamera(45, this.offsetWidth / this.offsetHeight, 1, 50000);
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
    renderer.setSize( this.canvas.width, this.canvas.height );
    renderer.sortObjects = false;
  },

  setupScene: function() {
    /// All WebGL Setup
    var scene = this.scene = new THREE.Scene();
    createLights();
    function createLights() {
      var directionalLight = new THREE.DirectionalLight(0xffffff);
      directionalLight.position.set(1, 1, 1).normalize();
      scene.add(directionalLight);
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
    var self = this;
    self.renderer.render(self.scene, self.camera);
  },

  attributeChanged: function(name, from, to) {
    if (name === "angle") {
      this.style.transform = 'rotateY( ' + this.angle + 'deg )';
    }
  },

  template: `
    <canvas width="100%" height="100%"></canvas>
    <div class="viewport">
      <vr-camera>
          <content></content>
      </vr-camera>
    </div>

      <style>
    :host {
      display: inline-block;
      width: 100%;
      height: 100vh;
    }

    .viewport {
      position: relative;
      box-sizing: border-box;
      transform-style: preserve-3d;
      width: 100%;
      height: 100vh;
    }

    canvas {
      position: absolute;
      transform-style: preserve-3d;
      width: 100%;
      height: 100vh;
    }
    </style>`
});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('VRSCene',this));

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

    this.style.transform = 'translate3d(-50%, -50%, 0) ' + this.getCameraCSSMatrix(translation.multiply(rotationZ.multiply(rotationY.multiply(rotationX))));
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
return w[n];},m.exports,m);w[n]=m.exports;};})('VRObject',this));

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
    var translation = new THREE.Matrix4().makeTranslation(x, y, -z);

    // Orientation
    var orientationX = elStyles.getPropertyValue('--rotX') || 0;
    var orientationY = elStyles.getPropertyValue('--rotY') || 0;
    var orientationZ = elStyles.getPropertyValue('--rotZ') || 0;
    var rotX = THREE.Math.degToRad(orientationX);
    var rotY = THREE.Math.degToRad(orientationY);
    var rotZ = THREE.Math.degToRad(orientationZ);
    var rotationX = new THREE.Matrix4().makeRotationX(rotX);
    var rotationY = new THREE.Matrix4().makeRotationY(rotY);
    var rotationZ = new THREE.Matrix4().makeRotationX(rotZ);
    var matrixCSS = rotationZ.multiply(rotationY.multiply(rotationX.multiply(translation)));

    this.style.transform = 'translate3d(-50%, -50%, 0) ' + this.getCameraCSSMatrix(matrixCSS);

    // Matrix threejs
    rotationX = new THREE.Matrix4().makeRotationX(-rotX);
    rotationY = new THREE.Matrix4().makeRotationY(rotY);
    rotationZ = new THREE.Matrix4().makeRotationX(rotZ);
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

module.exports = component.register('vr-model', {
  extends: VRObject.prototype,

  created: function() {
    this.setupScene();
    VRObject.prototype.created.call(this);
  },

  setupScene: function() {
    var material = new THREE.MeshLambertMaterial({ color: 'magenta' });
    var model = this.model = new THREE.Mesh(new THREE.BoxGeometry(120, 120, 120), material);
    var x = this.style.getPropertyValue('--x') || 0;
    var y = this.style.getPropertyValue('--y') || 0;
    var z = this.style.getPropertyValue('--z');
    this.raycaster = new THREE.Raycaster();
    model.overdraw = true;
    model.position.set(x, y, -z);
    this.object3D = model;
    this.attachClickHandler();
    //this.animate();
  },

  attachClickHandler: function() {
    var self = this;
    self.mousePos = new THREE.Vector2(0, 0);
    //this.scene.addEventListener('mousemove', onMouseMoved, false);
    //document.addEventListener( 'mousedown', onDocumentMouseDown, false );

    function onMouseMoved ( e ) {
      e.preventDefault();
      self.mousePos.x = ( e.clientX / window.innerWidth ) * 2 - 1;
      self.mousePos.y = - ( e.clientY / window.innerHeight ) * 2 + 1;
    }

    function onDocumentMouseDown( e ) {
      if (self.intersected) {
        self.explode();
      }
      // e.preventDefault();
      // var mouseVector = new THREE.Vector3();
      // mouseVector.x = 2 * (e.clientX / SCREEN_WIDTH) - 1;
      // mouseVector.y = 1 - 2 * ( e.clientY / SCREEN_HEIGHT );
      // var raycaster = projector.pickingRay( mouseVector.clone(), camera );
      // var intersects = raycaster.intersectObject( TARGET );
      // for( var i = 0; i < intersects.length; i++ ) {
      //   var intersection = intersects[ i ],
      //   obj = intersection.object;
      //   cons ole.log("Intersected object", obj);
      // }
    }
  },

  explode: function() {

    var box = this.object3D;
    var scene = this.scene;
    var duration = 8000;
    this.exploding = true;

    // explode geometry into objects
    var pieces = explode( box.geometry, box.material );

    box.material.visible = false;

    // animate objects
    for ( var i = 0; i < pieces.children.length; i ++ ) {

      var object = pieces.children[ i ];

      object.geometry.computeFaceNormals();
      var normal = object.geometry.faces[0].normal.clone();
      var targetPosition = object.position.clone().add( normal.multiplyScalar( 3000 ) );
      //removeBoxFromList( box );
      new TWEEN.Tween( object.position )
        .to( targetPosition, duration )
        .onComplete( deleteBox )
        .start();

      object.material.opacity = 0;
      new TWEEN.Tween( object.material )
        .to( { opacity: 1 }, duration )
        .start();

      var rotation = 2 * Math.PI;
      var targetRotation = { x: rotation, y: rotation, z:rotation };
      new TWEEN.Tween( object.rotation )
        .to( targetRotation, duration )
        .start();

    }

    box.add( pieces );

    function removeBoxFromList( box ) {
      for (var i = 0; i < objects.length; i++) {
        if (objects[i] === box) {
          objects.splice(i, 1);
          return;
        }
      }
    }

    function deleteBox() {
      box.remove( pieces )
      //scene.remove( box );
    }

    function explode( geometry, material ) {

      var pieces = new THREE.Group();
      var material = material.clone();
      material.side = THREE.DoubleSide;

      for ( var i = 0; i < geometry.faces.length; i ++ ) {

        var face = geometry.faces[ i ];

        var vertexA = geometry.vertices[ face.a ].clone();
        var vertexB = geometry.vertices[ face.b ].clone();
        var vertexC = geometry.vertices[ face.c ].clone();

        var geometry2 = new THREE.Geometry();
        geometry2.vertices.push( vertexA, vertexB, vertexC );
        geometry2.faces.push( new THREE.Face3( 0, 1, 2 ) );

        var mesh = new THREE.Mesh( geometry2, material );
        mesh.position.sub( geometry2.center() );
        pieces.add( mesh );

      }

      //sort the pieces
      pieces.children.sort( function ( a, b ) {

        return a.position.z - b.position.z;
        //return a.position.x - b.position.x;     // sort x
        //return b.position.y - a.position.y;   // sort y

      } );

      pieces.rotation.set( 0, 0, 0 )

      return pieces;

    }

  },

  animate: function() {
    var self = this;
    var lastTime = self.lastTime || 0;
    var angularSpeed = self.angularSpeed || 0.2;
    requestAnimationFrame(function() {
      self.animate();
      TWEEN.update();
    });

    if (!this.exploding) {
      var time = (new Date()).getTime();
      var timeDiff = time - lastTime;
      var angleChange = angularSpeed * timeDiff * 2 * Math.PI / 1000;
      self.model.rotation.y += angleChange;
      self.lastTime = time;
      //this.intersectMouse();
    }
  },

  // find intersections
  intersectMouse: function intersect() {
    var raycaster = this.raycaster;
    var objects = [this.object3D];
    raycaster.setFromCamera( this.mousePos, this.scene.camera );
    var intersects = raycaster.intersectObjects( objects );

    if ( intersects.length > 0 ) {

      if ( this.object3D == intersects[ 0 ].object && !this.intersected) {

        this.intersected = this.object3D.material.emissive.getHex();
        this.object3D.material.emissive.setHex( 0xffff00 );

      }

    } else {

      if ( this.intersected ) this.object3D.material.emissive.set( 'black' );
      this.intersected = null;

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
return w[n];},m.exports,m);w[n]=m.exports;};})('VRModel',this));

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
        label = document.createElement('vr-object');
        label.classList.add('peak-label');
        label.style.setProperty('--x',  sign1 * (Math.random() * 1024));
        label.style.setProperty('--y',  sign2 * (Math.random() * 1024));
        label.style.setProperty('--z',  -noiseValue - 50);
        label.style.setProperty('--rotX',  -hud.style.getPropertyValue("--rotX"));
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

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImdhaWEtY29tcG9uZW50LmpzIiwidnItc2NlbmUuanMiLCJ2ci1vYmplY3QuanMiLCJ2ci1jYW1lcmEuanMiLCJ2ci1tb2RlbC5qcyIsInZyLXRlcnJhaW4uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FDdlpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQ3hNQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FDN0dBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQ3ZFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUNoT0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJ2ci1jb21wb25lbnRzLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLyogZ2xvYmFscyBkZWZpbmUgKi9cbjsoZnVuY3Rpb24oZGVmaW5lKXsndXNlIHN0cmljdCc7ZGVmaW5lKGZ1bmN0aW9uKHJlcXVpcmUsZXhwb3J0cyxtb2R1bGUpe1xuLyoqXG4gKiBMb2NhbHNcbiAqL1xudmFyIHRleHRDb250ZW50ID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihOb2RlLnByb3RvdHlwZSxcbiAgICAndGV4dENvbnRlbnQnKTtcbnZhciBpbm5lckhUTUwgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKEVsZW1lbnQucHJvdG90eXBlLCAnaW5uZXJIVE1MJyk7XG52YXIgcmVtb3ZlQXR0cmlidXRlID0gRWxlbWVudC5wcm90b3R5cGUucmVtb3ZlQXR0cmlidXRlO1xudmFyIHNldEF0dHJpYnV0ZSA9IEVsZW1lbnQucHJvdG90eXBlLnNldEF0dHJpYnV0ZTtcbnZhciBub29wICA9IGZ1bmN0aW9uKCkge307XG5cbi8qKlxuICogUmVnaXN0ZXIgYSBuZXcgY29tcG9uZW50LlxuICpcbiAqIEBwYXJhbSAge1N0cmluZ30gbmFtZVxuICogQHBhcmFtICB7T2JqZWN0fSBwcm9wc1xuICogQHJldHVybiB7Y29uc3RydWN0b3J9XG4gKiBAcHVibGljXG4gKi9cbmV4cG9ydHMucmVnaXN0ZXIgPSBmdW5jdGlvbihuYW1lLCBwcm9wcykge1xuICB2YXIgYmFzZVByb3RvID0gZ2V0QmFzZVByb3RvKHByb3BzLmV4dGVuZHMpO1xuXG4gIC8vIENsZWFuIHVwXG4gIGRlbGV0ZSBwcm9wcy5leHRlbmRzO1xuXG4gIC8vIFB1bGwgb3V0IENTUyB0aGF0IG5lZWRzIHRvIGJlIGluIHRoZSBsaWdodC1kb21cbiAgaWYgKHByb3BzLnRlbXBsYXRlKSB7XG4gICAgdmFyIG91dHB1dCA9IHByb2Nlc3NDc3MocHJvcHMudGVtcGxhdGUsIG5hbWUpO1xuXG4gICAgcHJvcHMudGVtcGxhdGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZW1wbGF0ZScpO1xuICAgIHByb3BzLnRlbXBsYXRlLmlubmVySFRNTCA9IG91dHB1dC50ZW1wbGF0ZTtcbiAgICBwcm9wcy5saWdodENzcyA9IG91dHB1dC5saWdodENzcztcblxuICAgIHByb3BzLmdsb2JhbENzcyA9IHByb3BzLmdsb2JhbENzcyB8fCAnJztcbiAgICBwcm9wcy5nbG9iYWxDc3MgKz0gb3V0cHV0Lmdsb2JhbENzcztcbiAgfVxuXG4gIC8vIEluamVjdCBnbG9iYWwgQ1NTIGludG8gdGhlIGRvY3VtZW50LFxuICAvLyBhbmQgZGVsZXRlIGFzIG5vIGxvbmdlciBuZWVkZWRcbiAgaW5qZWN0R2xvYmFsQ3NzKHByb3BzLmdsb2JhbENzcyk7XG4gIGRlbGV0ZSBwcm9wcy5nbG9iYWxDc3M7XG5cbiAgLy8gTWVyZ2UgYmFzZSBnZXR0ZXIvc2V0dGVyIGF0dHJpYnV0ZXMgd2l0aCB0aGUgdXNlcidzLFxuICAvLyB0aGVuIGRlZmluZSB0aGUgcHJvcGVydHkgZGVzY3JpcHRvcnMgb24gdGhlIHByb3RvdHlwZS5cbiAgdmFyIGRlc2NyaXB0b3JzID0gbWl4aW4ocHJvcHMuYXR0cnMgfHwge30sIGJhc2UuZGVzY3JpcHRvcnMpO1xuXG4gIC8vIFN0b3JlIHRoZSBvcmdpbmFsIGRlc2NyaXB0b3JzIHNvbWV3aGVyZVxuICAvLyBhIGxpdHRsZSBtb3JlIHByaXZhdGUgYW5kIGRlbGV0ZSB0aGUgb3JpZ2luYWxcbiAgcHJvcHMuX2F0dHJzID0gcHJvcHMuYXR0cnM7XG4gIGRlbGV0ZSBwcm9wcy5hdHRycztcblxuICAvLyBDcmVhdGUgdGhlIHByb3RvdHlwZSwgZXh0ZW5kZWQgZnJvbSBiYXNlIGFuZFxuICAvLyBkZWZpbmUgdGhlIGRlc2NyaXB0b3JzIGRpcmVjdGx5IG9uIHRoZSBwcm90b3R5cGVcbiAgdmFyIHByb3RvID0gY3JlYXRlUHJvdG8oYmFzZVByb3RvLCBwcm9wcyk7XG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzKHByb3RvLCBkZXNjcmlwdG9ycyk7XG5cbiAgLy8gUmVnaXN0ZXIgdGhlIGN1c3RvbS1lbGVtZW50IGFuZCByZXR1cm4gdGhlIGNvbnN0cnVjdG9yXG4gIHRyeSB7XG4gICAgcmV0dXJuIGRvY3VtZW50LnJlZ2lzdGVyRWxlbWVudChuYW1lLCB7IHByb3RvdHlwZTogcHJvdG8gfSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAoZS5uYW1lICE9PSAnTm90U3VwcG9ydGVkRXJyb3InKSB7XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgfVxufTtcblxudmFyIGJhc2UgPSB7XG4gIHByb3BlcnRpZXM6IHtcbiAgICBHYWlhQ29tcG9uZW50OiB0cnVlLFxuICAgIGF0dHJpYnV0ZUNoYW5nZWQ6IG5vb3AsXG4gICAgYXR0YWNoZWQ6IG5vb3AsXG4gICAgZGV0YWNoZWQ6IG5vb3AsXG4gICAgY3JlYXRlZDogbm9vcCxcblxuICAgIGNyZWF0ZWRDYWxsYmFjazogZnVuY3Rpb24oKSB7XG4gICAgICBpZiAodGhpcy5ydGwpIHsgYWRkRGlyT2JzZXJ2ZXIoKTsgfVxuICAgICAgaW5qZWN0TGlnaHRDc3ModGhpcyk7XG4gICAgICB0aGlzLmNyZWF0ZWQoKTtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogSXQgaXMgdmVyeSBjb21tb24gdG8gd2FudCB0byBrZWVwIG9iamVjdFxuICAgICAqIHByb3BlcnRpZXMgaW4tc3luYyB3aXRoIGF0dHJpYnV0ZXMsXG4gICAgICogZm9yIGV4YW1wbGU6XG4gICAgICpcbiAgICAgKiAgIGVsLnZhbHVlID0gJ2Zvbyc7XG4gICAgICogICBlbC5zZXRBdHRyaWJ1dGUoJ3ZhbHVlJywgJ2ZvbycpO1xuICAgICAqXG4gICAgICogU28gd2Ugc3VwcG9ydCBhbiBvYmplY3Qgb24gdGhlIHByb3RvdHlwZVxuICAgICAqIG5hbWVkICdhdHRycycgdG8gcHJvdmlkZSBhIGNvbnNpc3RlbnRcbiAgICAgKiB3YXkgZm9yIGNvbXBvbmVudCBhdXRob3JzIHRvIGRlZmluZVxuICAgICAqIHRoZXNlIHByb3BlcnRpZXMuIFdoZW4gYW4gYXR0cmlidXRlXG4gICAgICogY2hhbmdlcyB3ZSBrZWVwIHRoZSBhdHRyW25hbWVdXG4gICAgICogdXAtdG8tZGF0ZS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSAge1N0cmluZ30gbmFtZVxuICAgICAqIEBwYXJhbSAge1N0cmluZ3x8bnVsbH0gZnJvbVxuICAgICAqIEBwYXJhbSAge1N0cmluZ3x8bnVsbH0gdG9cbiAgICAgKi9cbiAgICBhdHRyaWJ1dGVDaGFuZ2VkQ2FsbGJhY2s6IGZ1bmN0aW9uKG5hbWUsIGZyb20sIHRvKSB7XG4gICAgICB2YXIgcHJvcCA9IHRvQ2FtZWxDYXNlKG5hbWUpO1xuICAgICAgaWYgKHRoaXMuX2F0dHJzICYmIHRoaXMuX2F0dHJzW3Byb3BdKSB7IHRoaXNbcHJvcF0gPSB0bzsgfVxuICAgICAgdGhpcy5hdHRyaWJ1dGVDaGFuZ2VkKG5hbWUsIGZyb20sIHRvKTtcbiAgICB9LFxuXG4gICAgYXR0YWNoZWRDYWxsYmFjazogZnVuY3Rpb24oKSB7IHRoaXMuYXR0YWNoZWQoKTsgfSxcbiAgICBkZXRhY2hlZENhbGxiYWNrOiBmdW5jdGlvbigpIHsgdGhpcy5kZXRhY2hlZCgpOyB9LFxuXG4gICAgLyoqXG4gICAgICogQSBjb252ZW5pZW50IG1ldGhvZCBmb3Igc2V0dGluZyB1cFxuICAgICAqIGEgc2hhZG93LXJvb3QgdXNpbmcgdGhlIGRlZmluZWQgdGVtcGxhdGUuXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTaGFkb3dSb290fVxuICAgICAqL1xuICAgIHNldHVwU2hhZG93Um9vdDogZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoIXRoaXMudGVtcGxhdGUpIHsgcmV0dXJuOyB9XG4gICAgICB2YXIgbm9kZSA9IGRvY3VtZW50LmltcG9ydE5vZGUodGhpcy50ZW1wbGF0ZS5jb250ZW50LCB0cnVlKTtcbiAgICAgIHRoaXMuY3JlYXRlU2hhZG93Um9vdCgpLmFwcGVuZENoaWxkKG5vZGUpO1xuICAgICAgcmV0dXJuIHRoaXMuc2hhZG93Um9vdDtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogU2V0cyBhbiBhdHRyaWJ1dGUgaW50ZXJuYWxseVxuICAgICAqIGFuZCBleHRlcm5hbGx5LiBUaGlzIGlzIHNvIHRoYXRcbiAgICAgKiB3ZSBjYW4gc3R5bGUgaW50ZXJuYWwgc2hhZG93LWRvbVxuICAgICAqIGNvbnRlbnQuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gbmFtZVxuICAgICAqIEBwYXJhbSB7U3RyaW5nfSB2YWx1ZVxuICAgICAqL1xuICAgIHNldEF0dHI6IGZ1bmN0aW9uKG5hbWUsIHZhbHVlKSB7XG4gICAgICB2YXIgaW50ZXJuYWwgPSB0aGlzLnNoYWRvd1Jvb3QuZmlyc3RFbGVtZW50Q2hpbGQ7XG4gICAgICBzZXRBdHRyaWJ1dGUuY2FsbChpbnRlcm5hbCwgbmFtZSwgdmFsdWUpO1xuICAgICAgc2V0QXR0cmlidXRlLmNhbGwodGhpcywgbmFtZSwgdmFsdWUpO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBSZW1vdmVzIGFuIGF0dHJpYnV0ZSBpbnRlcm5hbGx5XG4gICAgICogYW5kIGV4dGVybmFsbHkuIFRoaXMgaXMgc28gdGhhdFxuICAgICAqIHdlIGNhbiBzdHlsZSBpbnRlcm5hbCBzaGFkb3ctZG9tXG4gICAgICogY29udGVudC5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IHZhbHVlXG4gICAgICovXG4gICAgcmVtb3ZlQXR0cjogZnVuY3Rpb24obmFtZSkge1xuICAgICAgdmFyIGludGVybmFsID0gdGhpcy5zaGFkb3dSb290LmZpcnN0RWxlbWVudENoaWxkO1xuICAgICAgcmVtb3ZlQXR0cmlidXRlLmNhbGwoaW50ZXJuYWwsIG5hbWUpO1xuICAgICAgcmVtb3ZlQXR0cmlidXRlLmNhbGwodGhpcywgbmFtZSk7XG4gICAgfVxuICB9LFxuXG4gIGRlc2NyaXB0b3JzOiB7XG4gICAgdGV4dENvbnRlbnQ6IHtcbiAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgdGV4dENvbnRlbnQuc2V0LmNhbGwodGhpcywgdmFsdWUpO1xuICAgICAgICBpZiAodGhpcy5saWdodFN0eWxlKSB7IHRoaXMuYXBwZW5kQ2hpbGQodGhpcy5saWdodFN0eWxlKTsgfVxuICAgICAgfSxcblxuICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHRleHRDb250ZW50LmdldCgpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBpbm5lckhUTUw6IHtcbiAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgaW5uZXJIVE1MLnNldC5jYWxsKHRoaXMsIHZhbHVlKTtcbiAgICAgICAgaWYgKHRoaXMubGlnaHRTdHlsZSkgeyB0aGlzLmFwcGVuZENoaWxkKHRoaXMubGlnaHRTdHlsZSk7IH1cbiAgICAgIH0sXG5cbiAgICAgIGdldDogaW5uZXJIVE1MLmdldFxuICAgIH1cbiAgfVxufTtcblxuLyoqXG4gKiBUaGUgZGVmYXVsdCBiYXNlIHByb3RvdHlwZSB0byB1c2VcbiAqIHdoZW4gYGV4dGVuZHNgIGlzIHVuZGVmaW5lZC5cbiAqXG4gKiBAdHlwZSB7T2JqZWN0fVxuICovXG52YXIgZGVmYXVsdFByb3RvdHlwZSA9IGNyZWF0ZVByb3RvKEhUTUxFbGVtZW50LnByb3RvdHlwZSwgYmFzZS5wcm9wZXJ0aWVzKTtcblxuLyoqXG4gKiBSZXR1cm5zIGEgc3VpdGFibGUgcHJvdG90eXBlIGJhc2VkXG4gKiBvbiB0aGUgb2JqZWN0IHBhc3NlZC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtICB7SFRNTEVsZW1lbnRQcm90b3R5cGV8dW5kZWZpbmVkfSBwcm90b1xuICogQHJldHVybiB7SFRNTEVsZW1lbnRQcm90b3R5cGV9XG4gKi9cbmZ1bmN0aW9uIGdldEJhc2VQcm90byhwcm90bykge1xuICBpZiAoIXByb3RvKSB7IHJldHVybiBkZWZhdWx0UHJvdG90eXBlOyB9XG4gIHByb3RvID0gcHJvdG8ucHJvdG90eXBlIHx8IHByb3RvO1xuICByZXR1cm4gIXByb3RvLkdhaWFDb21wb25lbnQgP1xuICAgIGNyZWF0ZVByb3RvKHByb3RvLCBiYXNlLnByb3BlcnRpZXMpIDogcHJvdG87XG59XG5cbi8qKlxuICogRXh0ZW5kcyB0aGUgZ2l2ZW4gcHJvdG8gYW5kIG1peGVzXG4gKiBpbiB0aGUgZ2l2ZW4gcHJvcGVydGllcy5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtICB7T2JqZWN0fSBwcm90b1xuICogQHBhcmFtICB7T2JqZWN0fSBwcm9wc1xuICogQHJldHVybiB7T2JqZWN0fVxuICovXG5mdW5jdGlvbiBjcmVhdGVQcm90byhwcm90bywgcHJvcHMpIHtcbiAgcmV0dXJuIG1peGluKE9iamVjdC5jcmVhdGUocHJvdG8pLCBwcm9wcyk7XG59XG5cbi8qKlxuICogRGV0ZWN0cyBwcmVzZW5jZSBvZiBzaGFkb3ctZG9tXG4gKiBDU1Mgc2VsZWN0b3JzLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICovXG52YXIgaGFzU2hhZG93Q1NTID0gKGZ1bmN0aW9uKCkge1xuICB2YXIgZGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIHRyeSB7IGRpdi5xdWVyeVNlbGVjdG9yKCc6aG9zdCcpOyByZXR1cm4gdHJ1ZTsgfVxuICBjYXRjaCAoZSkgeyByZXR1cm4gZmFsc2U7IH1cbn0pKCk7XG5cbi8qKlxuICogUmVnZXhzIHVzZWQgdG8gZXh0cmFjdCBzaGFkb3ctY3NzXG4gKlxuICogQHR5cGUge09iamVjdH1cbiAqL1xudmFyIHJlZ2V4ID0ge1xuICBzaGFkb3dDc3M6IC8oPzpcXDpob3N0fFxcOlxcOmNvbnRlbnQpW157XSpcXHtbXn1dKlxcfS9nLFxuICAnOmhvc3QnOiAvKD86XFw6aG9zdCkvZyxcbiAgJzpob3N0KCknOiAvXFw6aG9zdFxcKCguKylcXCkoPzogXFw6XFw6Y29udGVudCk/L2csXG4gICc6aG9zdC1jb250ZXh0JzogL1xcOmhvc3QtY29udGV4dFxcKCguKylcXCkoW157LF0rKT8vZyxcbiAgJzo6Y29udGVudCc6IC8oPzpcXDpcXDpjb250ZW50KS9nXG59O1xuXG4vKipcbiAqIEV4dHJhY3RzIHRoZSA6aG9zdCBhbmQgOjpjb250ZW50IHJ1bGVzXG4gKiBmcm9tIHRoZSBzaGFkb3ctZG9tIENTUyBhbmQgcmV3cml0ZXNcbiAqIHRoZW0gdG8gd29yayBmcm9tIHRoZSA8c3R5bGUgc2NvcGVkPlxuICogaW5qZWN0ZWQgYXQgdGhlIHJvb3Qgb2YgdGhlIGNvbXBvbmVudC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHJldHVybiB7U3RyaW5nfVxuICovXG5mdW5jdGlvbiBwcm9jZXNzQ3NzKHRlbXBsYXRlLCBuYW1lKSB7XG4gIHZhciBnbG9iYWxDc3MgPSAnJztcbiAgdmFyIGxpZ2h0Q3NzID0gJyc7XG5cbiAgaWYgKCFoYXNTaGFkb3dDU1MpIHtcbiAgICB0ZW1wbGF0ZSA9IHRlbXBsYXRlLnJlcGxhY2UocmVnZXguc2hhZG93Q3NzLCBmdW5jdGlvbihtYXRjaCkge1xuICAgICAgdmFyIGhvc3RDb250ZXh0ID0gcmVnZXhbJzpob3N0LWNvbnRleHQnXS5leGVjKG1hdGNoKTtcblxuICAgICAgaWYgKGhvc3RDb250ZXh0KSB7XG4gICAgICAgIGdsb2JhbENzcyArPSBtYXRjaFxuICAgICAgICAgIC5yZXBsYWNlKHJlZ2V4Wyc6OmNvbnRlbnQnXSwgJycpXG4gICAgICAgICAgLnJlcGxhY2UocmVnZXhbJzpob3N0LWNvbnRleHQnXSwgJyQxICcgKyBuYW1lICsgJyQyJylcbiAgICAgICAgICAucmVwbGFjZSgvICsvZywgJyAnKTsgLy8gZXhjZXNzIHdoaXRlc3BhY2VcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxpZ2h0Q3NzICs9IG1hdGNoXG4gICAgICAgICAgLnJlcGxhY2UocmVnZXhbJzpob3N0KCknXSwgbmFtZSArICckMScpXG4gICAgICAgICAgLnJlcGxhY2UocmVnZXhbJzpob3N0J10sIG5hbWUpXG4gICAgICAgICAgLnJlcGxhY2UocmVnZXhbJzo6Y29udGVudCddLCBuYW1lKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuICcnO1xuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICB0ZW1wbGF0ZTogdGVtcGxhdGUsXG4gICAgbGlnaHRDc3M6IGxpZ2h0Q3NzLFxuICAgIGdsb2JhbENzczogZ2xvYmFsQ3NzXG4gIH07XG59XG5cbi8qKlxuICogU29tZSBDU1MgcnVsZXMsIHN1Y2ggYXMgQGtleWZyYW1lc1xuICogYW5kIEBmb250LWZhY2UgZG9uJ3Qgd29yayBpbnNpZGVcbiAqIHNjb3BlZCBvciBzaGFkb3cgPHN0eWxlPi4gU28gd2VcbiAqIGhhdmUgdG8gcHV0IHRoZW0gaW50byAnZ2xvYmFsJ1xuICogPHN0eWxlPiBpbiB0aGUgaGVhZCBvZiB0aGVcbiAqIGRvY3VtZW50LlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0gIHtTdHJpbmd9IGNzc1xuICovXG5mdW5jdGlvbiBpbmplY3RHbG9iYWxDc3MoY3NzKSB7XG4gIGlmICghY3NzKSB7cmV0dXJuO31cbiAgdmFyIHN0eWxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3R5bGUnKTtcbiAgc3R5bGUuaW5uZXJIVE1MID0gY3NzLnRyaW0oKTtcbiAgaGVhZFJlYWR5KCkudGhlbihmdW5jdGlvbigpIHtcbiAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHN0eWxlKTtcbiAgfSk7XG59XG5cblxuLyoqXG4gKiBSZXNvbHZlcyBhIHByb21pc2Ugb25jZSBkb2N1bWVudC5oZWFkIGlzIHJlYWR5LlxuICpcbiAqIEBwcml2YXRlXG4gKi9cbmZ1bmN0aW9uIGhlYWRSZWFkeSgpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUpIHtcbiAgICBpZiAoZG9jdW1lbnQuaGVhZCkgeyByZXR1cm4gcmVzb2x2ZSgpOyB9XG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ2xvYWQnLCBmdW5jdGlvbiBmbigpIHtcbiAgICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKCdsb2FkJywgZm4pO1xuICAgICAgcmVzb2x2ZSgpO1xuICAgIH0pO1xuICB9KTtcbn1cblxuXG4vKipcbiAqIFRoZSBHZWNrbyBwbGF0Zm9ybSBkb2Vzbid0IHlldCBoYXZlXG4gKiBgOjpjb250ZW50YCBvciBgOmhvc3RgLCBzZWxlY3RvcnMsXG4gKiB3aXRob3V0IHRoZXNlIHdlIGFyZSB1bmFibGUgdG8gc3R5bGVcbiAqIHVzZXItY29udGVudCBpbiB0aGUgbGlnaHQtZG9tIGZyb21cbiAqIHdpdGhpbiBvdXIgc2hhZG93LWRvbSBzdHlsZS1zaGVldC5cbiAqXG4gKiBUbyB3b3JrYXJvdW5kIHRoaXMsIHdlIGNsb25lIHRoZSA8c3R5bGU+XG4gKiBub2RlIGludG8gdGhlIHJvb3Qgb2YgdGhlIGNvbXBvbmVudCxcbiAqIHNvIG91ciBzZWxlY3RvcnMgYXJlIGFibGUgdG8gdGFyZ2V0XG4gKiBsaWdodC1kb20gY29udGVudC5cbiAqXG4gKiBAcHJpdmF0ZVxuICovXG5mdW5jdGlvbiBpbmplY3RMaWdodENzcyhlbCkge1xuICBpZiAoaGFzU2hhZG93Q1NTKSB7IHJldHVybjsgfVxuICBlbC5saWdodFN0eWxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3R5bGUnKTtcbiAgZWwubGlnaHRTdHlsZS5zZXRBdHRyaWJ1dGUoJ3Njb3BlZCcsICcnKTtcbiAgZWwubGlnaHRTdHlsZS5pbm5lckhUTUwgPSBlbC5saWdodENzcztcbiAgZWwuYXBwZW5kQ2hpbGQoZWwubGlnaHRTdHlsZSk7XG59XG5cbi8qKlxuICogQ29udmVydCBoeXBoZW4gc2VwYXJhdGVkXG4gKiBzdHJpbmcgdG8gY2FtZWwtY2FzZS5cbiAqXG4gKiBFeGFtcGxlOlxuICpcbiAqICAgdG9DYW1lbENhc2UoJ2Zvby1iYXInKTsgLy89PiAnZm9vQmFyJ1xuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0gIHtTcmluZ30gc3RyaW5nXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKi9cbmZ1bmN0aW9uIHRvQ2FtZWxDYXNlKHN0cmluZykge1xuICByZXR1cm4gc3RyaW5nLnJlcGxhY2UoLy0oLikvZywgZnVuY3Rpb24gcmVwbGFjZXIoc3RyaW5nLCBwMSkge1xuICAgIHJldHVybiBwMS50b1VwcGVyQ2FzZSgpO1xuICB9KTtcbn1cblxuLyoqXG4gKiBPYnNlcnZlciAoc2luZ2xldG9uKVxuICpcbiAqIEB0eXBlIHtNdXRhdGlvbk9ic2VydmVyfHVuZGVmaW5lZH1cbiAqL1xudmFyIGRpck9ic2VydmVyO1xuXG4vKipcbiAqIE9ic2VydmVzIHRoZSBkb2N1bWVudCBgZGlyYCAoZGlyZWN0aW9uKVxuICogYXR0cmlidXRlIGFuZCBkaXNwYXRjaGVzIGEgZ2xvYmFsIGV2ZW50XG4gKiB3aGVuIGl0IGNoYW5nZXMuXG4gKlxuICogQ29tcG9uZW50cyBjYW4gbGlzdGVuIHRvIHRoaXMgZXZlbnQgYW5kXG4gKiBtYWtlIGludGVybmFsIGNoYW5nZXMgaWYgbmVlZCBiZS5cbiAqXG4gKiBAcHJpdmF0ZVxuICovXG5mdW5jdGlvbiBhZGREaXJPYnNlcnZlcigpIHtcbiAgaWYgKGRpck9ic2VydmVyKSB7IHJldHVybjsgfVxuXG4gIGRpck9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIob25DaGFuZ2VkKTtcbiAgZGlyT2JzZXJ2ZXIub2JzZXJ2ZShkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQsIHtcbiAgICBhdHRyaWJ1dGVGaWx0ZXI6IFsnZGlyJ10sXG4gICAgYXR0cmlidXRlczogdHJ1ZVxuICB9KTtcblxuICBmdW5jdGlvbiBvbkNoYW5nZWQobXV0YXRpb25zKSB7XG4gICAgZG9jdW1lbnQuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ2RpcmNoYW5nZWQnKSk7XG4gIH1cbn1cblxuLyoqXG4gKiBDb3B5IHRoZSB2YWx1ZXMgb2YgYWxsIHByb3BlcnRpZXMgZnJvbVxuICogc291cmNlIG9iamVjdCBgdGFyZ2V0YCB0byBhIHRhcmdldCBvYmplY3QgYHNvdXJjZWAuXG4gKiBJdCB3aWxsIHJldHVybiB0aGUgdGFyZ2V0IG9iamVjdC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtICAge09iamVjdH0gdGFyZ2V0XG4gKiBAcGFyYW0gICB7T2JqZWN0fSBzb3VyY2VcbiAqIEByZXR1cm5zIHtPYmplY3R9XG4gKi9cbmZ1bmN0aW9uIG1peGluKHRhcmdldCwgc291cmNlKSB7XG4gIGZvciAodmFyIGtleSBpbiBzb3VyY2UpIHtcbiAgICB0YXJnZXRba2V5XSA9IHNvdXJjZVtrZXldO1xuICB9XG4gIHJldHVybiB0YXJnZXQ7XG59XG5cbn0pO30pKHR5cGVvZiBkZWZpbmU9PSdmdW5jdGlvbicmJmRlZmluZS5hbWQ/ZGVmaW5lXG46KGZ1bmN0aW9uKG4sdyl7J3VzZSBzdHJpY3QnO3JldHVybiB0eXBlb2YgbW9kdWxlPT0nb2JqZWN0Jz9mdW5jdGlvbihjKXtcbmMocmVxdWlyZSxleHBvcnRzLG1vZHVsZSk7fTpmdW5jdGlvbihjKXt2YXIgbT17ZXhwb3J0czp7fX07YyhmdW5jdGlvbihuKXtcbnJldHVybiB3W25dO30sbS5leHBvcnRzLG0pO3dbbl09bS5leHBvcnRzO307fSkoJ2dhaWEtY29tcG9uZW50Jyx0aGlzKSk7XG4iLCIvKiBnbG9iYWxzIGRlZmluZSAqL1xuKGZ1bmN0aW9uKGRlZmluZSl7J3VzZSBzdHJpY3QnO2RlZmluZShmdW5jdGlvbihyZXF1aXJlLGV4cG9ydHMsbW9kdWxlKXtcblxuLyoqXG4gKiBEZXBlbmRlbmNpZXNcbiAqL1xuXG52YXIgY29tcG9uZW50ID0gcmVxdWlyZSgnZ2FpYS1jb21wb25lbnQnKTtcblxuLyoqXG4gKiBTaW1wbGUgbG9nZ2VyXG4gKiBAdHlwZSB7RnVuY3Rpb259XG4gKi9cbnZhciBkZWJ1ZyA9IDAgPyBjb25zb2xlLmxvZy5iaW5kKGNvbnNvbGUpIDogZnVuY3Rpb24oKSB7fTtcblxuLyoqXG4gKiBFeHBvcnRzXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBjb21wb25lbnQucmVnaXN0ZXIoJ3ZyLXNjZW5lJywge1xuICBleHRlbmRzOiBIVE1MRGl2RWxlbWVudC5wcm90b3R5cGUsXG5cbiAgY3JlYXRlZDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5zZXR1cFNoYWRvd1Jvb3QoKTtcbiAgICB0aGlzLnNldHVwUmVuZGVyZXIoKTtcbiAgICB0aGlzLnNldHVwU2NlbmUoKTtcbiAgICB0aGlzLnNldHVwQ2FtZXJhKCk7XG4gIH0sXG5cbiAgYWRkT2JqZWN0OiBmdW5jdGlvbihlbCwgcHJvdmlkZWRfb2JqKSB7XG4gICAgdmFyIG9iaiA9IGVsLm9iamVjdDNEO1xuICAgIHZhciBvYmpQYXJlbnQgPSBlbC5wYXJlbnROb2RlO1xuICAgIGlmIChvYmogJiYgdGhpcy5zY2VuZS5nZXRPYmplY3RCeUlkKG9iai5pZCkpIHtcbiAgICAgIHJldHVybiBvYmo7XG4gICAgfVxuICAgIG9iaiA9IGVsLm9iamVjdDNEID0gZWwub2JqZWN0M0QgfHwgcHJvdmlkZWRfb2JqIHx8IG5ldyBUSFJFRS5PYmplY3QzRCgpO1xuICAgIGlmIChvYmpQYXJlbnQgJiYgb2JqUGFyZW50ICE9PSB0aGlzKSB7XG4gICAgICBvYmpQYXJlbnQgPSB0aGlzLmFkZE9iamVjdChlbC5wYXJlbnROb2RlKTtcbiAgICAgIG9ialBhcmVudC5hZGQob2JqKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5zY2VuZS5hZGQob2JqKTtcbiAgICB9XG4gICAgcmV0dXJuIG9iajtcbiAgfSxcblxuICBlcHNpbG9uOiBmdW5jdGlvbiAoIHZhbHVlICkge1xuICAgIHJldHVybiBNYXRoLmFicyggdmFsdWUgKSA8IDAuMDAwMDAxID8gMCA6IHZhbHVlO1xuICB9LFxuXG4gIGdldENTU01hdHJpeDogZnVuY3Rpb24gKG1hdHJpeCkge1xuICAgIHZhciBlcHNpbG9uID0gdGhpcy5lcHNpbG9uO1xuICAgIHZhciBlbGVtZW50cyA9IG1hdHJpeC5lbGVtZW50cztcblxuICAgIHJldHVybiAnbWF0cml4M2QoJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMCBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDEgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAyIF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMyBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDQgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyA1IF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgNiBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDcgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyA4IF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgOSBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDEwIF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMTEgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAxMiBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDEzIF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMTQgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAxNSBdICkgK1xuICAgICcpJztcbiAgfSxcblxuICBzZXR1cENhbWVyYTogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGZvdiA9IHRoaXMuc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZSgnLS1mb3YnKSB8fCA0NTtcbiAgICB2YXIgdmlld3BvcnQgPSB0aGlzLnNoYWRvd1Jvb3QucXVlcnlTZWxlY3RvcignLnZpZXdwb3J0Jyk7XG5cbiAgICAvLyBET00gY2FtZXJhXG4gICAgdmFyIHBlcnNwZWN0aXZlTWF0cml4ID0gdGhpcy5wZXJzcGVjdGl2ZU1hdHJpeChUSFJFRS5NYXRoLmRlZ1RvUmFkKDQ1KSwgdGhpcy5vZmZzZXRXaWR0aCAvIHRoaXMub2Zmc2V0SGVpZ2h0LCAxLCA1MDAwKTtcbiAgICB2YXIgc2NhbGVkID0gcGVyc3BlY3RpdmVNYXRyaXguY2xvbmUoKS5zY2FsZShuZXcgVEhSRUUuVmVjdG9yMyh0aGlzLm9mZnNldFdpZHRoLCB0aGlzLm9mZnNldEhlaWdodCwgMSkpO1xuICAgIHZhciBzdHlsZSA9IHRoaXMuZ2V0Q1NTTWF0cml4KHNjYWxlZCk7XG4gICAgdmlld3BvcnQuc3R5bGUudHJhbnNmb3JtID0gc3R5bGU7XG5cbiAgICAvLyBXZWJHTCBjYW1lcmFcbiAgICB0aGlzLmNhbWVyYSA9IG5ldyBUSFJFRS5QZXJzcGVjdGl2ZUNhbWVyYSg0NSwgdGhpcy5vZmZzZXRXaWR0aCAvIHRoaXMub2Zmc2V0SGVpZ2h0LCAxLCA1MDAwMCk7XG4gIH0sXG5cbiAgcGVyc3BlY3RpdmVNYXRyaXg6IGZ1bmN0aW9uKGZvdiwgYXNwZWN0LCBuZWFyeiwgZmFyeikge1xuICAgIHZhciBtYXRyaXggPSBuZXcgVEhSRUUuTWF0cml4NCgpO1xuICAgIHZhciByYW5nZSA9IE1hdGgudGFuKGZvdiAqIDAuNSkgKiBuZWFyejtcblxuICAgIG1hdHJpeC5lbGVtZW50c1swXSA9ICgyICogbmVhcnopIC8gKChyYW5nZSAqIGFzcGVjdCkgLSAoLXJhbmdlICogYXNwZWN0KSk7XG4gICAgbWF0cml4LmVsZW1lbnRzWzFdID0gMDtcbiAgICBtYXRyaXguZWxlbWVudHNbMl0gPSAwO1xuICAgIG1hdHJpeC5lbGVtZW50c1szXSA9IDA7XG4gICAgbWF0cml4LmVsZW1lbnRzWzRdID0gMDtcbiAgICBtYXRyaXguZWxlbWVudHNbNV0gPSAoMiAqIG5lYXJ6KSAvICgyICogcmFuZ2UpO1xuICAgIG1hdHJpeC5lbGVtZW50c1s2XSA9IDA7XG4gICAgbWF0cml4LmVsZW1lbnRzWzddID0gMDtcbiAgICBtYXRyaXguZWxlbWVudHNbOF0gPSAwO1xuICAgIG1hdHJpeC5lbGVtZW50c1s5XSA9IDA7XG4gICAgbWF0cml4LmVsZW1lbnRzWzEwXSA9IC0oZmFyeiArIG5lYXJ6KSAvIChmYXJ6IC0gbmVhcnopO1xuICAgIG1hdHJpeC5lbGVtZW50c1sxMV0gPSAtMTtcbiAgICBtYXRyaXguZWxlbWVudHNbMTJdID0gMDtcbiAgICBtYXRyaXguZWxlbWVudHNbMTNdID0gMDtcbiAgICBtYXRyaXguZWxlbWVudHNbMTRdID0gLSgyICogZmFyeiAqIG5lYXJ6KSAvIChmYXJ6IC0gbmVhcnopO1xuICAgIG1hdHJpeC5lbGVtZW50c1sxNV0gPSAwO1xuICAgIHJldHVybiBtYXRyaXgudHJhbnNwb3NlKCk7XG4gIH0sXG5cbiAgc2V0dXBSZW5kZXJlcjogZnVuY3Rpb24oKSB7XG4gICAgLy8gQWxsIFdlYkdMIHNldHVwXG4gICAgdmFyIGNhbnZhcyA9IHRoaXMuY2FudmFzID0gdGhpcy5zaGFkb3dSb290LnF1ZXJ5U2VsZWN0b3IoJ2NhbnZhcycpO1xuXG4gICAgdGhpcy5yZXNpemVDYW52YXMoKTtcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgdGhpcy5yZXNpemVDYW52YXMuYmluZCh0aGlzKSwgZmFsc2UpO1xuXG4gICAgdmFyIHJlbmRlcmVyID0gdGhpcy5yZW5kZXJlciA9IG5ldyBUSFJFRS5XZWJHTFJlbmRlcmVyKCB7IGNhbnZhczogY2FudmFzLCBhbnRpYWxpYXM6IHRydWUsIGFscGhhOiB0cnVlIH0gKTtcbiAgICByZW5kZXJlci5zZXRTaXplKCB0aGlzLmNhbnZhcy53aWR0aCwgdGhpcy5jYW52YXMuaGVpZ2h0ICk7XG4gICAgcmVuZGVyZXIuc29ydE9iamVjdHMgPSBmYWxzZTtcbiAgfSxcblxuICBzZXR1cFNjZW5lOiBmdW5jdGlvbigpIHtcbiAgICAvLy8gQWxsIFdlYkdMIFNldHVwXG4gICAgdmFyIHNjZW5lID0gdGhpcy5zY2VuZSA9IG5ldyBUSFJFRS5TY2VuZSgpO1xuICAgIGNyZWF0ZUxpZ2h0cygpO1xuICAgIGZ1bmN0aW9uIGNyZWF0ZUxpZ2h0cygpIHtcbiAgICAgIHZhciBkaXJlY3Rpb25hbExpZ2h0ID0gbmV3IFRIUkVFLkRpcmVjdGlvbmFsTGlnaHQoMHhmZmZmZmYpO1xuICAgICAgZGlyZWN0aW9uYWxMaWdodC5wb3NpdGlvbi5zZXQoMSwgMSwgMSkubm9ybWFsaXplKCk7XG4gICAgICBzY2VuZS5hZGQoZGlyZWN0aW9uYWxMaWdodCk7XG4gICAgfVxuICB9LFxuXG4gIHJlc2l6ZUNhbnZhczogZnVuY3Rpb24ocmVuZGVyZXIsIGNhbWVyYSl7XG4gICAgdmFyIGNhbnZhcyA9IHRoaXMuY2FudmFzO1xuICAgIC8vIE1ha2UgaXQgdmlzdWFsbHkgZmlsbCB0aGUgcG9zaXRpb25lZCBwYXJlbnRcbiAgICBjYW52YXMuc3R5bGUud2lkdGggPScxMDAlJztcbiAgICBjYW52YXMuc3R5bGUuaGVpZ2h0PScxMDAlJztcbiAgICAvLyAuLi50aGVuIHNldCB0aGUgaW50ZXJuYWwgc2l6ZSB0byBtYXRjaFxuICAgIGNhbnZhcy53aWR0aCAgPSBjYW52YXMub2Zmc2V0V2lkdGg7XG4gICAgY2FudmFzLmhlaWdodCA9IGNhbnZhcy5vZmZzZXRIZWlnaHQ7XG5cbiAgICBpZiAodGhpcy5jYW1lcmEpIHtcbiAgICAgIHRoaXMuY2FtZXJhLmFzcGVjdCA9IGNhbnZhcy53aWR0aCAvIGNhbnZhcy5oZWlnaHQ7XG4gICAgICB0aGlzLmNhbWVyYS51cGRhdGVQcm9qZWN0aW9uTWF0cml4KCk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMucmVuZGVyZXIpIHtcbiAgICAgIC8vIG5vdGlmeSB0aGUgcmVuZGVyZXIgb2YgdGhlIHNpemUgY2hhbmdlXG4gICAgICB0aGlzLnJlbmRlcmVyLnNldFNpemUoIGNhbnZhcy53aWR0aCwgY2FudmFzLmhlaWdodCApO1xuICAgIH1cbiAgfSxcblxuICBhbmltYXRlOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5yZW5kZXJlci5yZW5kZXIoc2VsZi5zY2VuZSwgc2VsZi5jYW1lcmEpO1xuICB9LFxuXG4gIGF0dHJpYnV0ZUNoYW5nZWQ6IGZ1bmN0aW9uKG5hbWUsIGZyb20sIHRvKSB7XG4gICAgaWYgKG5hbWUgPT09IFwiYW5nbGVcIikge1xuICAgICAgdGhpcy5zdHlsZS50cmFuc2Zvcm0gPSAncm90YXRlWSggJyArIHRoaXMuYW5nbGUgKyAnZGVnICknO1xuICAgIH1cbiAgfSxcblxuICB0ZW1wbGF0ZTogYFxuICAgIDxjYW52YXMgd2lkdGg9XCIxMDAlXCIgaGVpZ2h0PVwiMTAwJVwiPjwvY2FudmFzPlxuICAgIDxkaXYgY2xhc3M9XCJ2aWV3cG9ydFwiPlxuICAgICAgPHZyLWNhbWVyYT5cbiAgICAgICAgICA8Y29udGVudD48L2NvbnRlbnQ+XG4gICAgICA8L3ZyLWNhbWVyYT5cbiAgICA8L2Rpdj5cblxuICAgICAgPHN0eWxlPlxuICAgIDpob3N0IHtcbiAgICAgIGRpc3BsYXk6IGlubGluZS1ibG9jaztcbiAgICAgIHdpZHRoOiAxMDAlO1xuICAgICAgaGVpZ2h0OiAxMDB2aDtcbiAgICB9XG5cbiAgICAudmlld3BvcnQge1xuICAgICAgcG9zaXRpb246IHJlbGF0aXZlO1xuICAgICAgYm94LXNpemluZzogYm9yZGVyLWJveDtcbiAgICAgIHRyYW5zZm9ybS1zdHlsZTogcHJlc2VydmUtM2Q7XG4gICAgICB3aWR0aDogMTAwJTtcbiAgICAgIGhlaWdodDogMTAwdmg7XG4gICAgfVxuXG4gICAgY2FudmFzIHtcbiAgICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgICAgIHRyYW5zZm9ybS1zdHlsZTogcHJlc2VydmUtM2Q7XG4gICAgICB3aWR0aDogMTAwJTtcbiAgICAgIGhlaWdodDogMTAwdmg7XG4gICAgfVxuICAgIDwvc3R5bGU+YFxufSk7XG5cbn0pO30pKHR5cGVvZiBkZWZpbmU9PSdmdW5jdGlvbicmJmRlZmluZS5hbWQ/ZGVmaW5lXG46KGZ1bmN0aW9uKG4sdyl7J3VzZSBzdHJpY3QnO3JldHVybiB0eXBlb2YgbW9kdWxlPT0nb2JqZWN0Jz9mdW5jdGlvbihjKXtcbmMocmVxdWlyZSxleHBvcnRzLG1vZHVsZSk7fTpmdW5jdGlvbihjKXt2YXIgbT17ZXhwb3J0czp7fX07YyhmdW5jdGlvbihuKXtcbnJldHVybiB3W25dO30sbS5leHBvcnRzLG0pO3dbbl09bS5leHBvcnRzO307fSkoJ1ZSU0NlbmUnLHRoaXMpKTtcbiIsIi8qIGdsb2JhbHMgZGVmaW5lICovXG4oZnVuY3Rpb24oZGVmaW5lKXsndXNlIHN0cmljdCc7ZGVmaW5lKGZ1bmN0aW9uKHJlcXVpcmUsZXhwb3J0cyxtb2R1bGUpe1xuXG4vKipcbiAqIERlcGVuZGVuY2llc1xuICovXG5cbnZhciBjb21wb25lbnQgPSByZXF1aXJlKCdnYWlhLWNvbXBvbmVudCcpO1xuXG4vKipcbiAqIFNpbXBsZSBsb2dnZXJcbiAqIEB0eXBlIHtGdW5jdGlvbn1cbiAqL1xudmFyIGRlYnVnID0gMCA/IGNvbnNvbGUubG9nLmJpbmQoY29uc29sZSkgOiBmdW5jdGlvbigpIHt9O1xuXG4vKipcbiAqIEV4cG9ydHNcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGNvbXBvbmVudC5yZWdpc3RlcigndnItb2JqZWN0Jywge1xuICBleHRlbmRzOiBIVE1MRGl2RWxlbWVudC5wcm90b3R5cGUsXG5cbiAgY3JlYXRlZDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5zZXR1cFNoYWRvd1Jvb3QoKTtcbiAgICB0aGlzLmZpbmRTY2VuZSgpO1xuICAgIHRoaXMuc2NlbmUuYWRkT2JqZWN0KHRoaXMpO1xuICAgIHRoaXMudXBkYXRlVHJhbnNmb3JtKCk7XG4gIH0sXG5cbiAgYXR0cmlidXRlQ2hhbmdlZDogZnVuY3Rpb24obmFtZSwgZnJvbSwgdG8pIHtcbiAgICB0aGlzLnVwZGF0ZVRyYW5zZm9ybSgpO1xuICB9LFxuXG4gIGVwc2lsb246IGZ1bmN0aW9uICggdmFsdWUgKSB7XG4gICAgcmV0dXJuIE1hdGguYWJzKCB2YWx1ZSApIDwgMC4wMDAwMDEgPyAwIDogdmFsdWU7XG4gIH0sXG5cbiAgZ2V0Q2FtZXJhQ1NTTWF0cml4OiBmdW5jdGlvbiAobWF0cml4KSB7XG4gICAgdmFyIGVwc2lsb24gPSB0aGlzLmVwc2lsb247XG4gICAgdmFyIGVsZW1lbnRzID0gbWF0cml4LmVsZW1lbnRzO1xuXG4gICAgcmV0dXJuICdtYXRyaXgzZCgnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAwIF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMSBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDIgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAzIF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgNCBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDUgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyA2IF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgNyBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDggXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyA5IF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMTAgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAxMSBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDEyIF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMTMgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAxNCBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDE1IF0gKSArXG4gICAgJyknO1xuICB9LFxuXG4gIHVwZGF0ZVRyYW5zZm9ybTogZnVuY3Rpb24oKSB7XG4gICAgLy8gUG9zaXRpb25cbiAgICB2YXIgeCA9IHRoaXMuc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZSgnLS14JykgfHwgMDtcbiAgICB2YXIgeSA9IHRoaXMuc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZSgnLS15JykgfHwgMDtcbiAgICB2YXIgeiA9IHRoaXMuc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZSgnLS16JykgfHwgMDtcbiAgICB2YXIgdHJhbnNsYXRpb24gPSBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VUcmFuc2xhdGlvbih4LCB5LCAteik7XG5cbiAgICAvLyBPcmllbnRhdGlvblxuICAgIHZhciBvcmllbnRhdGlvblggPSB0aGlzLnN0eWxlLmdldFByb3BlcnR5VmFsdWUoJy0tcm90WCcpIHx8IDA7XG4gICAgdmFyIG9yaWVudGF0aW9uWSA9IHRoaXMuc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZSgnLS1yb3RZJykgfHwgMDtcbiAgICB2YXIgb3JpZW50YXRpb25aID0gdGhpcy5zdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKCctLXJvdFonKSB8fCAwO1xuXG4gICAgdmFyIHJvdFggPSBUSFJFRS5NYXRoLmRlZ1RvUmFkKG9yaWVudGF0aW9uWCk7XG4gICAgdmFyIHJvdFkgPSBUSFJFRS5NYXRoLmRlZ1RvUmFkKG9yaWVudGF0aW9uWSk7XG4gICAgdmFyIHJvdFogPSBUSFJFRS5NYXRoLmRlZ1RvUmFkKG9yaWVudGF0aW9uWik7XG4gICAgdmFyIHJvdGF0aW9uWCA9IG5ldyBUSFJFRS5NYXRyaXg0KCkubWFrZVJvdGF0aW9uWChyb3RYKTtcbiAgICB2YXIgcm90YXRpb25ZID0gbmV3IFRIUkVFLk1hdHJpeDQoKS5tYWtlUm90YXRpb25ZKHJvdFkpO1xuICAgIHZhciByb3RhdGlvblogPSBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VSb3RhdGlvblgocm90Wik7XG5cbiAgICB0aGlzLnN0eWxlLnRyYW5zZm9ybSA9ICd0cmFuc2xhdGUzZCgtNTAlLCAtNTAlLCAwKSAnICsgdGhpcy5nZXRDYW1lcmFDU1NNYXRyaXgodHJhbnNsYXRpb24ubXVsdGlwbHkocm90YXRpb25aLm11bHRpcGx5KHJvdGF0aW9uWS5tdWx0aXBseShyb3RhdGlvblgpKSkpO1xuICAgIHRoaXMub2JqZWN0M0QucG9zaXRpb24uc2V0KHgsIC15LCAteik7XG4gICAgdGhpcy5vYmplY3QzRC5yb3RhdGlvbi5vcmRlciA9ICdZWFonO1xuICAgIHRoaXMub2JqZWN0M0Qucm90YXRpb24uc2V0KC1yb3RYLCByb3RZLCAwKTtcbiAgfSxcblxuICBmaW5kU2NlbmU6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzY2VuZXMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCd2ci1zY2VuZScpO1xuICAgIHZhciBwZXJzcGVjdGl2ZTtcbiAgICBmb3IgKHZhciBpPTA7IGkgPCBzY2VuZXMubGVuZ3RoOyArK2kpIHtcbiAgICAgIHRoaXMuc2NlbmUgPSBzY2VuZXNbaV07XG4gICAgfVxuICB9LFxuXG4gIHRlbXBsYXRlOiBgXG4gICAgPGNvbnRlbnQ+PC9jb250ZW50PlxuICAgIDpob3N0IHtcbiAgICAgIGxlZnQ6IDUwJTtcbiAgICAgIHRvcDogNTAlO1xuICAgICAgcG9zaXRpb246IGFic29sdXRlO1xuICAgICAgdHJhbnNmb3JtLXN0eWxlOiBwcmVzZXJ2ZS0zZDtcbiAgICB9XG4gIGBcbn0pO1xuXG59KTt9KSh0eXBlb2YgZGVmaW5lPT0nZnVuY3Rpb24nJiZkZWZpbmUuYW1kP2RlZmluZVxuOihmdW5jdGlvbihuLHcpeyd1c2Ugc3RyaWN0JztyZXR1cm4gdHlwZW9mIG1vZHVsZT09J29iamVjdCc/ZnVuY3Rpb24oYyl7XG5jKHJlcXVpcmUsZXhwb3J0cyxtb2R1bGUpO306ZnVuY3Rpb24oYyl7dmFyIG09e2V4cG9ydHM6e319O2MoZnVuY3Rpb24obil7XG5yZXR1cm4gd1tuXTt9LG0uZXhwb3J0cyxtKTt3W25dPW0uZXhwb3J0czt9O30pKCdWUk9iamVjdCcsdGhpcykpO1xuIiwiLyogZ2xvYmFscyBkZWZpbmUgKi9cbihmdW5jdGlvbihkZWZpbmUpeyd1c2Ugc3RyaWN0JztkZWZpbmUoZnVuY3Rpb24ocmVxdWlyZSxleHBvcnRzLG1vZHVsZSl7XG5cbi8qKlxuICogRGVwZW5kZW5jaWVzXG4gKi9cblxudmFyIGNvbXBvbmVudCA9IHJlcXVpcmUoJ2dhaWEtY29tcG9uZW50Jyk7XG5cbi8qKlxuICogU2ltcGxlIGxvZ2dlclxuICogQHR5cGUge0Z1bmN0aW9ufVxuICovXG52YXIgZGVidWcgPSAwID8gY29uc29sZS5sb2cuYmluZChjb25zb2xlKSA6IGZ1bmN0aW9uKCkge307XG5cbi8qKlxuICogRXhwb3J0c1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gY29tcG9uZW50LnJlZ2lzdGVyKCd2ci1jYW1lcmEnLCB7XG4gIGV4dGVuZHM6IFZST2JqZWN0LnByb3RvdHlwZSxcblxuICB1cGRhdGVUcmFuc2Zvcm06IGZ1bmN0aW9uKCkge1xuICAgIHZhciBlbFN0eWxlcyA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKHRoaXMpO1xuICAgIC8vIFBvc2l0aW9uXG4gICAgdmFyIHggPSBlbFN0eWxlcy5nZXRQcm9wZXJ0eVZhbHVlKCctLXgnKSB8fCAwO1xuICAgIHZhciB5ID0gZWxTdHlsZXMuZ2V0UHJvcGVydHlWYWx1ZSgnLS15JykgfHwgMDtcbiAgICB2YXIgeiA9IGVsU3R5bGVzLmdldFByb3BlcnR5VmFsdWUoJy0teicpIHx8IDA7XG4gICAgdmFyIHRyYW5zbGF0aW9uID0gbmV3IFRIUkVFLk1hdHJpeDQoKS5tYWtlVHJhbnNsYXRpb24oeCwgeSwgLXopO1xuXG4gICAgLy8gT3JpZW50YXRpb25cbiAgICB2YXIgb3JpZW50YXRpb25YID0gZWxTdHlsZXMuZ2V0UHJvcGVydHlWYWx1ZSgnLS1yb3RYJykgfHwgMDtcbiAgICB2YXIgb3JpZW50YXRpb25ZID0gZWxTdHlsZXMuZ2V0UHJvcGVydHlWYWx1ZSgnLS1yb3RZJykgfHwgMDtcbiAgICB2YXIgb3JpZW50YXRpb25aID0gZWxTdHlsZXMuZ2V0UHJvcGVydHlWYWx1ZSgnLS1yb3RaJykgfHwgMDtcbiAgICB2YXIgcm90WCA9IFRIUkVFLk1hdGguZGVnVG9SYWQob3JpZW50YXRpb25YKTtcbiAgICB2YXIgcm90WSA9IFRIUkVFLk1hdGguZGVnVG9SYWQob3JpZW50YXRpb25ZKTtcbiAgICB2YXIgcm90WiA9IFRIUkVFLk1hdGguZGVnVG9SYWQob3JpZW50YXRpb25aKTtcbiAgICB2YXIgcm90YXRpb25YID0gbmV3IFRIUkVFLk1hdHJpeDQoKS5tYWtlUm90YXRpb25YKHJvdFgpO1xuICAgIHZhciByb3RhdGlvblkgPSBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VSb3RhdGlvblkocm90WSk7XG4gICAgdmFyIHJvdGF0aW9uWiA9IG5ldyBUSFJFRS5NYXRyaXg0KCkubWFrZVJvdGF0aW9uWChyb3RaKTtcbiAgICB2YXIgbWF0cml4Q1NTID0gcm90YXRpb25aLm11bHRpcGx5KHJvdGF0aW9uWS5tdWx0aXBseShyb3RhdGlvblgubXVsdGlwbHkodHJhbnNsYXRpb24pKSk7XG5cbiAgICB0aGlzLnN0eWxlLnRyYW5zZm9ybSA9ICd0cmFuc2xhdGUzZCgtNTAlLCAtNTAlLCAwKSAnICsgdGhpcy5nZXRDYW1lcmFDU1NNYXRyaXgobWF0cml4Q1NTKTtcblxuICAgIC8vIE1hdHJpeCB0aHJlZWpzXG4gICAgcm90YXRpb25YID0gbmV3IFRIUkVFLk1hdHJpeDQoKS5tYWtlUm90YXRpb25YKC1yb3RYKTtcbiAgICByb3RhdGlvblkgPSBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VSb3RhdGlvblkocm90WSk7XG4gICAgcm90YXRpb25aID0gbmV3IFRIUkVFLk1hdHJpeDQoKS5tYWtlUm90YXRpb25YKHJvdFopO1xuICAgIHZhciBtYXRyaXggPSByb3RhdGlvbloubXVsdGlwbHkocm90YXRpb25ZLm11bHRpcGx5KHJvdGF0aW9uWC5tdWx0aXBseSh0cmFuc2xhdGlvbikpKTtcblxuICAgIHZhciBvYmplY3QzRCA9IHRoaXMub2JqZWN0M0Q7XG4gICAgb2JqZWN0M0QubWF0cml4QXV0b1VwZGF0ZSA9IGZhbHNlO1xuICAgIG9iamVjdDNELm1hdHJpeCA9IG1hdHJpeDtcblxuICB9LFxuXG4gIHRlbXBsYXRlOiBgXG4gICAgPGNvbnRlbnQ+PC9jb250ZW50PlxuICAgIDpob3N0IHtcbiAgICAgIGxlZnQ6IDUwJTtcbiAgICAgIHRvcDogNTAlO1xuICAgICAgcG9zaXRpb246IGFic29sdXRlO1xuICAgICAgdHJhbnNmb3JtLXN0eWxlOiBwcmVzZXJ2ZS0zZDtcbiAgICB9XG4gIGBcbn0pO1xuXG59KTt9KSh0eXBlb2YgZGVmaW5lPT0nZnVuY3Rpb24nJiZkZWZpbmUuYW1kP2RlZmluZVxuOihmdW5jdGlvbihuLHcpeyd1c2Ugc3RyaWN0JztyZXR1cm4gdHlwZW9mIG1vZHVsZT09J29iamVjdCc/ZnVuY3Rpb24oYyl7XG5jKHJlcXVpcmUsZXhwb3J0cyxtb2R1bGUpO306ZnVuY3Rpb24oYyl7dmFyIG09e2V4cG9ydHM6e319O2MoZnVuY3Rpb24obil7XG5yZXR1cm4gd1tuXTt9LG0uZXhwb3J0cyxtKTt3W25dPW0uZXhwb3J0czt9O30pKCdWUkNhbWVyYScsdGhpcykpO1xuIiwiLyogZ2xvYmFscyBkZWZpbmUgKi9cbihmdW5jdGlvbihkZWZpbmUpeyd1c2Ugc3RyaWN0JztkZWZpbmUoZnVuY3Rpb24ocmVxdWlyZSxleHBvcnRzLG1vZHVsZSl7XG5cbi8qKlxuICogRGVwZW5kZW5jaWVzXG4gKi9cblxudmFyIGNvbXBvbmVudCA9IHJlcXVpcmUoJ2dhaWEtY29tcG9uZW50Jyk7XG5cbi8qKlxuICogU2ltcGxlIGxvZ2dlclxuICogQHR5cGUge0Z1bmN0aW9ufVxuICovXG52YXIgZGVidWcgPSAwID8gY29uc29sZS5sb2cuYmluZChjb25zb2xlKSA6IGZ1bmN0aW9uKCkge307XG5cbi8qKlxuICogRXhwb3J0c1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gY29tcG9uZW50LnJlZ2lzdGVyKCd2ci1tb2RlbCcsIHtcbiAgZXh0ZW5kczogVlJPYmplY3QucHJvdG90eXBlLFxuXG4gIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc2V0dXBTY2VuZSgpO1xuICAgIFZST2JqZWN0LnByb3RvdHlwZS5jcmVhdGVkLmNhbGwodGhpcyk7XG4gIH0sXG5cbiAgc2V0dXBTY2VuZTogZnVuY3Rpb24oKSB7XG4gICAgdmFyIG1hdGVyaWFsID0gbmV3IFRIUkVFLk1lc2hMYW1iZXJ0TWF0ZXJpYWwoeyBjb2xvcjogJ21hZ2VudGEnIH0pO1xuICAgIHZhciBtb2RlbCA9IHRoaXMubW9kZWwgPSBuZXcgVEhSRUUuTWVzaChuZXcgVEhSRUUuQm94R2VvbWV0cnkoMTIwLCAxMjAsIDEyMCksIG1hdGVyaWFsKTtcbiAgICB2YXIgeCA9IHRoaXMuc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZSgnLS14JykgfHwgMDtcbiAgICB2YXIgeSA9IHRoaXMuc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZSgnLS15JykgfHwgMDtcbiAgICB2YXIgeiA9IHRoaXMuc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZSgnLS16Jyk7XG4gICAgdGhpcy5yYXljYXN0ZXIgPSBuZXcgVEhSRUUuUmF5Y2FzdGVyKCk7XG4gICAgbW9kZWwub3ZlcmRyYXcgPSB0cnVlO1xuICAgIG1vZGVsLnBvc2l0aW9uLnNldCh4LCB5LCAteik7XG4gICAgdGhpcy5vYmplY3QzRCA9IG1vZGVsO1xuICAgIHRoaXMuYXR0YWNoQ2xpY2tIYW5kbGVyKCk7XG4gICAgLy90aGlzLmFuaW1hdGUoKTtcbiAgfSxcblxuICBhdHRhY2hDbGlja0hhbmRsZXI6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLm1vdXNlUG9zID0gbmV3IFRIUkVFLlZlY3RvcjIoMCwgMCk7XG4gICAgLy90aGlzLnNjZW5lLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIG9uTW91c2VNb3ZlZCwgZmFsc2UpO1xuICAgIC8vZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lciggJ21vdXNlZG93bicsIG9uRG9jdW1lbnRNb3VzZURvd24sIGZhbHNlICk7XG5cbiAgICBmdW5jdGlvbiBvbk1vdXNlTW92ZWQgKCBlICkge1xuICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgc2VsZi5tb3VzZVBvcy54ID0gKCBlLmNsaWVudFggLyB3aW5kb3cuaW5uZXJXaWR0aCApICogMiAtIDE7XG4gICAgICBzZWxmLm1vdXNlUG9zLnkgPSAtICggZS5jbGllbnRZIC8gd2luZG93LmlubmVySGVpZ2h0ICkgKiAyICsgMTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBvbkRvY3VtZW50TW91c2VEb3duKCBlICkge1xuICAgICAgaWYgKHNlbGYuaW50ZXJzZWN0ZWQpIHtcbiAgICAgICAgc2VsZi5leHBsb2RlKCk7XG4gICAgICB9XG4gICAgICAvLyBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAvLyB2YXIgbW91c2VWZWN0b3IgPSBuZXcgVEhSRUUuVmVjdG9yMygpO1xuICAgICAgLy8gbW91c2VWZWN0b3IueCA9IDIgKiAoZS5jbGllbnRYIC8gU0NSRUVOX1dJRFRIKSAtIDE7XG4gICAgICAvLyBtb3VzZVZlY3Rvci55ID0gMSAtIDIgKiAoIGUuY2xpZW50WSAvIFNDUkVFTl9IRUlHSFQgKTtcbiAgICAgIC8vIHZhciByYXljYXN0ZXIgPSBwcm9qZWN0b3IucGlja2luZ1JheSggbW91c2VWZWN0b3IuY2xvbmUoKSwgY2FtZXJhICk7XG4gICAgICAvLyB2YXIgaW50ZXJzZWN0cyA9IHJheWNhc3Rlci5pbnRlcnNlY3RPYmplY3QoIFRBUkdFVCApO1xuICAgICAgLy8gZm9yKCB2YXIgaSA9IDA7IGkgPCBpbnRlcnNlY3RzLmxlbmd0aDsgaSsrICkge1xuICAgICAgLy8gICB2YXIgaW50ZXJzZWN0aW9uID0gaW50ZXJzZWN0c1sgaSBdLFxuICAgICAgLy8gICBvYmogPSBpbnRlcnNlY3Rpb24ub2JqZWN0O1xuICAgICAgLy8gICBjb25zIG9sZS5sb2coXCJJbnRlcnNlY3RlZCBvYmplY3RcIiwgb2JqKTtcbiAgICAgIC8vIH1cbiAgICB9XG4gIH0sXG5cbiAgZXhwbG9kZTogZnVuY3Rpb24oKSB7XG5cbiAgICB2YXIgYm94ID0gdGhpcy5vYmplY3QzRDtcbiAgICB2YXIgc2NlbmUgPSB0aGlzLnNjZW5lO1xuICAgIHZhciBkdXJhdGlvbiA9IDgwMDA7XG4gICAgdGhpcy5leHBsb2RpbmcgPSB0cnVlO1xuXG4gICAgLy8gZXhwbG9kZSBnZW9tZXRyeSBpbnRvIG9iamVjdHNcbiAgICB2YXIgcGllY2VzID0gZXhwbG9kZSggYm94Lmdlb21ldHJ5LCBib3gubWF0ZXJpYWwgKTtcblxuICAgIGJveC5tYXRlcmlhbC52aXNpYmxlID0gZmFsc2U7XG5cbiAgICAvLyBhbmltYXRlIG9iamVjdHNcbiAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBwaWVjZXMuY2hpbGRyZW4ubGVuZ3RoOyBpICsrICkge1xuXG4gICAgICB2YXIgb2JqZWN0ID0gcGllY2VzLmNoaWxkcmVuWyBpIF07XG5cbiAgICAgIG9iamVjdC5nZW9tZXRyeS5jb21wdXRlRmFjZU5vcm1hbHMoKTtcbiAgICAgIHZhciBub3JtYWwgPSBvYmplY3QuZ2VvbWV0cnkuZmFjZXNbMF0ubm9ybWFsLmNsb25lKCk7XG4gICAgICB2YXIgdGFyZ2V0UG9zaXRpb24gPSBvYmplY3QucG9zaXRpb24uY2xvbmUoKS5hZGQoIG5vcm1hbC5tdWx0aXBseVNjYWxhciggMzAwMCApICk7XG4gICAgICAvL3JlbW92ZUJveEZyb21MaXN0KCBib3ggKTtcbiAgICAgIG5ldyBUV0VFTi5Ud2Vlbiggb2JqZWN0LnBvc2l0aW9uIClcbiAgICAgICAgLnRvKCB0YXJnZXRQb3NpdGlvbiwgZHVyYXRpb24gKVxuICAgICAgICAub25Db21wbGV0ZSggZGVsZXRlQm94IClcbiAgICAgICAgLnN0YXJ0KCk7XG5cbiAgICAgIG9iamVjdC5tYXRlcmlhbC5vcGFjaXR5ID0gMDtcbiAgICAgIG5ldyBUV0VFTi5Ud2Vlbiggb2JqZWN0Lm1hdGVyaWFsIClcbiAgICAgICAgLnRvKCB7IG9wYWNpdHk6IDEgfSwgZHVyYXRpb24gKVxuICAgICAgICAuc3RhcnQoKTtcblxuICAgICAgdmFyIHJvdGF0aW9uID0gMiAqIE1hdGguUEk7XG4gICAgICB2YXIgdGFyZ2V0Um90YXRpb24gPSB7IHg6IHJvdGF0aW9uLCB5OiByb3RhdGlvbiwgejpyb3RhdGlvbiB9O1xuICAgICAgbmV3IFRXRUVOLlR3ZWVuKCBvYmplY3Qucm90YXRpb24gKVxuICAgICAgICAudG8oIHRhcmdldFJvdGF0aW9uLCBkdXJhdGlvbiApXG4gICAgICAgIC5zdGFydCgpO1xuXG4gICAgfVxuXG4gICAgYm94LmFkZCggcGllY2VzICk7XG5cbiAgICBmdW5jdGlvbiByZW1vdmVCb3hGcm9tTGlzdCggYm94ICkge1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBvYmplY3RzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGlmIChvYmplY3RzW2ldID09PSBib3gpIHtcbiAgICAgICAgICBvYmplY3RzLnNwbGljZShpLCAxKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkZWxldGVCb3goKSB7XG4gICAgICBib3gucmVtb3ZlKCBwaWVjZXMgKVxuICAgICAgLy9zY2VuZS5yZW1vdmUoIGJveCApO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGV4cGxvZGUoIGdlb21ldHJ5LCBtYXRlcmlhbCApIHtcblxuICAgICAgdmFyIHBpZWNlcyA9IG5ldyBUSFJFRS5Hcm91cCgpO1xuICAgICAgdmFyIG1hdGVyaWFsID0gbWF0ZXJpYWwuY2xvbmUoKTtcbiAgICAgIG1hdGVyaWFsLnNpZGUgPSBUSFJFRS5Eb3VibGVTaWRlO1xuXG4gICAgICBmb3IgKCB2YXIgaSA9IDA7IGkgPCBnZW9tZXRyeS5mYWNlcy5sZW5ndGg7IGkgKysgKSB7XG5cbiAgICAgICAgdmFyIGZhY2UgPSBnZW9tZXRyeS5mYWNlc1sgaSBdO1xuXG4gICAgICAgIHZhciB2ZXJ0ZXhBID0gZ2VvbWV0cnkudmVydGljZXNbIGZhY2UuYSBdLmNsb25lKCk7XG4gICAgICAgIHZhciB2ZXJ0ZXhCID0gZ2VvbWV0cnkudmVydGljZXNbIGZhY2UuYiBdLmNsb25lKCk7XG4gICAgICAgIHZhciB2ZXJ0ZXhDID0gZ2VvbWV0cnkudmVydGljZXNbIGZhY2UuYyBdLmNsb25lKCk7XG5cbiAgICAgICAgdmFyIGdlb21ldHJ5MiA9IG5ldyBUSFJFRS5HZW9tZXRyeSgpO1xuICAgICAgICBnZW9tZXRyeTIudmVydGljZXMucHVzaCggdmVydGV4QSwgdmVydGV4QiwgdmVydGV4QyApO1xuICAgICAgICBnZW9tZXRyeTIuZmFjZXMucHVzaCggbmV3IFRIUkVFLkZhY2UzKCAwLCAxLCAyICkgKTtcblxuICAgICAgICB2YXIgbWVzaCA9IG5ldyBUSFJFRS5NZXNoKCBnZW9tZXRyeTIsIG1hdGVyaWFsICk7XG4gICAgICAgIG1lc2gucG9zaXRpb24uc3ViKCBnZW9tZXRyeTIuY2VudGVyKCkgKTtcbiAgICAgICAgcGllY2VzLmFkZCggbWVzaCApO1xuXG4gICAgICB9XG5cbiAgICAgIC8vc29ydCB0aGUgcGllY2VzXG4gICAgICBwaWVjZXMuY2hpbGRyZW4uc29ydCggZnVuY3Rpb24gKCBhLCBiICkge1xuXG4gICAgICAgIHJldHVybiBhLnBvc2l0aW9uLnogLSBiLnBvc2l0aW9uLno7XG4gICAgICAgIC8vcmV0dXJuIGEucG9zaXRpb24ueCAtIGIucG9zaXRpb24ueDsgICAgIC8vIHNvcnQgeFxuICAgICAgICAvL3JldHVybiBiLnBvc2l0aW9uLnkgLSBhLnBvc2l0aW9uLnk7ICAgLy8gc29ydCB5XG5cbiAgICAgIH0gKTtcblxuICAgICAgcGllY2VzLnJvdGF0aW9uLnNldCggMCwgMCwgMCApXG5cbiAgICAgIHJldHVybiBwaWVjZXM7XG5cbiAgICB9XG5cbiAgfSxcblxuICBhbmltYXRlOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIGxhc3RUaW1lID0gc2VsZi5sYXN0VGltZSB8fCAwO1xuICAgIHZhciBhbmd1bGFyU3BlZWQgPSBzZWxmLmFuZ3VsYXJTcGVlZCB8fCAwLjI7XG4gICAgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZ1bmN0aW9uKCkge1xuICAgICAgc2VsZi5hbmltYXRlKCk7XG4gICAgICBUV0VFTi51cGRhdGUoKTtcbiAgICB9KTtcblxuICAgIGlmICghdGhpcy5leHBsb2RpbmcpIHtcbiAgICAgIHZhciB0aW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcbiAgICAgIHZhciB0aW1lRGlmZiA9IHRpbWUgLSBsYXN0VGltZTtcbiAgICAgIHZhciBhbmdsZUNoYW5nZSA9IGFuZ3VsYXJTcGVlZCAqIHRpbWVEaWZmICogMiAqIE1hdGguUEkgLyAxMDAwO1xuICAgICAgc2VsZi5tb2RlbC5yb3RhdGlvbi55ICs9IGFuZ2xlQ2hhbmdlO1xuICAgICAgc2VsZi5sYXN0VGltZSA9IHRpbWU7XG4gICAgICAvL3RoaXMuaW50ZXJzZWN0TW91c2UoKTtcbiAgICB9XG4gIH0sXG5cbiAgLy8gZmluZCBpbnRlcnNlY3Rpb25zXG4gIGludGVyc2VjdE1vdXNlOiBmdW5jdGlvbiBpbnRlcnNlY3QoKSB7XG4gICAgdmFyIHJheWNhc3RlciA9IHRoaXMucmF5Y2FzdGVyO1xuICAgIHZhciBvYmplY3RzID0gW3RoaXMub2JqZWN0M0RdO1xuICAgIHJheWNhc3Rlci5zZXRGcm9tQ2FtZXJhKCB0aGlzLm1vdXNlUG9zLCB0aGlzLnNjZW5lLmNhbWVyYSApO1xuICAgIHZhciBpbnRlcnNlY3RzID0gcmF5Y2FzdGVyLmludGVyc2VjdE9iamVjdHMoIG9iamVjdHMgKTtcblxuICAgIGlmICggaW50ZXJzZWN0cy5sZW5ndGggPiAwICkge1xuXG4gICAgICBpZiAoIHRoaXMub2JqZWN0M0QgPT0gaW50ZXJzZWN0c1sgMCBdLm9iamVjdCAmJiAhdGhpcy5pbnRlcnNlY3RlZCkge1xuXG4gICAgICAgIHRoaXMuaW50ZXJzZWN0ZWQgPSB0aGlzLm9iamVjdDNELm1hdGVyaWFsLmVtaXNzaXZlLmdldEhleCgpO1xuICAgICAgICB0aGlzLm9iamVjdDNELm1hdGVyaWFsLmVtaXNzaXZlLnNldEhleCggMHhmZmZmMDAgKTtcblxuICAgICAgfVxuXG4gICAgfSBlbHNlIHtcblxuICAgICAgaWYgKCB0aGlzLmludGVyc2VjdGVkICkgdGhpcy5vYmplY3QzRC5tYXRlcmlhbC5lbWlzc2l2ZS5zZXQoICdibGFjaycgKTtcbiAgICAgIHRoaXMuaW50ZXJzZWN0ZWQgPSBudWxsO1xuXG4gICAgfVxuICB9LFxuXG4gIHRlbXBsYXRlOiBgXG4gICAgOmhvc3Qge1xuICAgICAgbGVmdDogNTAlO1xuICAgICAgdG9wOiA1MCU7XG4gICAgICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gICAgICB0cmFuc2Zvcm0tc3R5bGU6IHByZXNlcnZlLTNkO1xuICAgIH1cbiAgYFxufSk7XG5cbn0pO30pKHR5cGVvZiBkZWZpbmU9PSdmdW5jdGlvbicmJmRlZmluZS5hbWQ/ZGVmaW5lXG46KGZ1bmN0aW9uKG4sdyl7J3VzZSBzdHJpY3QnO3JldHVybiB0eXBlb2YgbW9kdWxlPT0nb2JqZWN0Jz9mdW5jdGlvbihjKXtcbmMocmVxdWlyZSxleHBvcnRzLG1vZHVsZSk7fTpmdW5jdGlvbihjKXt2YXIgbT17ZXhwb3J0czp7fX07YyhmdW5jdGlvbihuKXtcbnJldHVybiB3W25dO30sbS5leHBvcnRzLG0pO3dbbl09bS5leHBvcnRzO307fSkoJ1ZSTW9kZWwnLHRoaXMpKTtcbiIsIi8qIGdsb2JhbHMgZGVmaW5lICovXG4oZnVuY3Rpb24oZGVmaW5lKXsndXNlIHN0cmljdCc7ZGVmaW5lKGZ1bmN0aW9uKHJlcXVpcmUsZXhwb3J0cyxtb2R1bGUpe1xuXG4vKipcbiAqIERlcGVuZGVuY2llc1xuICovXG5cbnZhciBjb21wb25lbnQgPSByZXF1aXJlKCdnYWlhLWNvbXBvbmVudCcpO1xuXG4vKipcbiAqIFNpbXBsZSBsb2dnZXJcbiAqIEB0eXBlIHtGdW5jdGlvbn1cbiAqL1xudmFyIGRlYnVnID0gMCA/IGNvbnNvbGUubG9nLmJpbmQoY29uc29sZSkgOiBmdW5jdGlvbigpIHt9O1xuXG4vKipcbiAqIEV4cG9ydHNcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGNvbXBvbmVudC5yZWdpc3RlcigndnItdGVycmFpbicsIHtcbiAgZXh0ZW5kczogVlJPYmplY3QucHJvdG90eXBlLFxuXG4gIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB0aGlzLnNldHVwU2NlbmUob25Mb2FkZWQpO1xuICAgIGZ1bmN0aW9uIG9uTG9hZGVkKCkge1xuICAgICAgVlJPYmplY3QucHJvdG90eXBlLmNyZWF0ZWQuY2FsbChzZWxmKTtcbiAgICAgIHNlbGYuZ2VuZXJhdGVMYWJlbHMobm9pc2UpO1xuICAgIH1cbiAgfSxcblxuICBzZXR1cFNjZW5lOiBmdW5jdGlvbihvbkxvYWRlZCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBuZXcgVGVycmFpbihub2lzZSwgMTAyNCwgNCwgNjQsIGZ1bmN0aW9uKG1vZGVsKSB7O1xuICAgICAgdmFyIHggPSBzZWxmLnN0eWxlLmdldFByb3BlcnR5VmFsdWUoJy0teCcpIHx8IDA7XG4gICAgICB2YXIgeSA9IHNlbGYuc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZSgnLS15JykgfHwgMDtcbiAgICAgIHZhciB6ID0gc2VsZi5zdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKCctLXonKSB8fCAwO1xuICAgICAgbW9kZWwucG9zaXRpb24uc2V0KHgsIHksIC16KTtcbiAgICAgIHNlbGYub2JqZWN0M0QgPSBtb2RlbDtcbiAgICAgIG9uTG9hZGVkKCk7XG4gICAgfSk7XG4gIH0sXG5cbiAgZ2VuZXJhdGVMYWJlbHM6IGZ1bmN0aW9uKG5vaXNlKSB7XG4gICAgdmFyIGh1ZCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJy5odWQnKTtcbiAgICB2YXIgbGFiZWw7XG4gICAgdmFyIG1heCA9IDIwO1xuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBub2lzZS5pbWFnZS5kYXRhLmxlbmd0aDsgKytpKSB7XG4gICAgICB2YXIgbm9pc2VWYWx1ZSA9IG5vaXNlLmltYWdlLmRhdGFbaV07XG4gICAgICB2YXIgc2lnbjEgPSAoTWF0aC5yYW5kb20oKSoxMCkudG9GaXhlZCgwKSAlIDIgPT09IDA/IC0xOiAxO1xuICAgICAgdmFyIHNpZ24yID0gKE1hdGgucmFuZG9tKCkqMTApLnRvRml4ZWQoMCkgJSAyID09PSAwPyAtMTogMTtcbiAgICAgIGlmIChub2lzZVZhbHVlID4gODApIHtcbiAgICAgICAgbGFiZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd2ci1vYmplY3QnKTtcbiAgICAgICAgbGFiZWwuY2xhc3NMaXN0LmFkZCgncGVhay1sYWJlbCcpO1xuICAgICAgICBsYWJlbC5zdHlsZS5zZXRQcm9wZXJ0eSgnLS14JywgIHNpZ24xICogKE1hdGgucmFuZG9tKCkgKiAxMDI0KSk7XG4gICAgICAgIGxhYmVsLnN0eWxlLnNldFByb3BlcnR5KCctLXknLCAgc2lnbjIgKiAoTWF0aC5yYW5kb20oKSAqIDEwMjQpKTtcbiAgICAgICAgbGFiZWwuc3R5bGUuc2V0UHJvcGVydHkoJy0teicsICAtbm9pc2VWYWx1ZSAtIDUwKTtcbiAgICAgICAgbGFiZWwuc3R5bGUuc2V0UHJvcGVydHkoJy0tcm90WCcsICAtaHVkLnN0eWxlLmdldFByb3BlcnR5VmFsdWUoXCItLXJvdFhcIikpO1xuICAgICAgICBsYWJlbC5pbm5lckhUTUwgPSBcIkxhbmRtYXJrIFwiICsgaTtcbiAgICAgICAgaHVkLmFwcGVuZENoaWxkKGxhYmVsKTtcbiAgICAgICAgbWF4LT0xO1xuICAgICAgICBpZiAobWF4ID09IDApIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgdGVtcGxhdGU6IGBcbiAgICA6aG9zdCB7XG4gICAgICBsZWZ0OiA1MCU7XG4gICAgICB0b3A6IDUwJTtcbiAgICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgICAgIHRyYW5zZm9ybS1zdHlsZTogcHJlc2VydmUtM2Q7XG4gICAgfVxuICBgXG59KTtcblxufSk7fSkodHlwZW9mIGRlZmluZT09J2Z1bmN0aW9uJyYmZGVmaW5lLmFtZD9kZWZpbmVcbjooZnVuY3Rpb24obix3KXsndXNlIHN0cmljdCc7cmV0dXJuIHR5cGVvZiBtb2R1bGU9PSdvYmplY3QnP2Z1bmN0aW9uKGMpe1xuYyhyZXF1aXJlLGV4cG9ydHMsbW9kdWxlKTt9OmZ1bmN0aW9uKGMpe3ZhciBtPXtleHBvcnRzOnt9fTtjKGZ1bmN0aW9uKG4pe1xucmV0dXJuIHdbbl07fSxtLmV4cG9ydHMsbSk7d1tuXT1tLmV4cG9ydHM7fTt9KSgnVlJUZXJyYWluJyx0aGlzKSk7XG4iXSwic291cmNlUm9vdCI6Ii9zb3VyY2UvIn0=