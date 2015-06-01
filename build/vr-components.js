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
    var self = this;
    this.updateChildren();
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
      <content></content>
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

    this.style.transform = 'translate3d(-50%, -50%, 0) ' + this.getCSSMatrix(matrixCSS);

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

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImdhaWEtY29tcG9uZW50LmpzIiwidnItc2NlbmUuanMiLCJ2ci1vYmplY3QuanMiLCJ2ci1jYW1lcmEuanMiLCJ2ci1tb2RlbC5qcyIsInZyLXRlcnJhaW4uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FDdlpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FDbE5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUN6SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FDdkVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQ2hPQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6InZyLWNvbXBvbmVudHMuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvKiBnbG9iYWxzIGRlZmluZSAqL1xuOyhmdW5jdGlvbihkZWZpbmUpeyd1c2Ugc3RyaWN0JztkZWZpbmUoZnVuY3Rpb24ocmVxdWlyZSxleHBvcnRzLG1vZHVsZSl7XG4vKipcbiAqIExvY2Fsc1xuICovXG52YXIgdGV4dENvbnRlbnQgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKE5vZGUucHJvdG90eXBlLFxuICAgICd0ZXh0Q29udGVudCcpO1xudmFyIGlubmVySFRNTCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoRWxlbWVudC5wcm90b3R5cGUsICdpbm5lckhUTUwnKTtcbnZhciByZW1vdmVBdHRyaWJ1dGUgPSBFbGVtZW50LnByb3RvdHlwZS5yZW1vdmVBdHRyaWJ1dGU7XG52YXIgc2V0QXR0cmlidXRlID0gRWxlbWVudC5wcm90b3R5cGUuc2V0QXR0cmlidXRlO1xudmFyIG5vb3AgID0gZnVuY3Rpb24oKSB7fTtcblxuLyoqXG4gKiBSZWdpc3RlciBhIG5ldyBjb21wb25lbnQuXG4gKlxuICogQHBhcmFtICB7U3RyaW5nfSBuYW1lXG4gKiBAcGFyYW0gIHtPYmplY3R9IHByb3BzXG4gKiBAcmV0dXJuIHtjb25zdHJ1Y3Rvcn1cbiAqIEBwdWJsaWNcbiAqL1xuZXhwb3J0cy5yZWdpc3RlciA9IGZ1bmN0aW9uKG5hbWUsIHByb3BzKSB7XG4gIHZhciBiYXNlUHJvdG8gPSBnZXRCYXNlUHJvdG8ocHJvcHMuZXh0ZW5kcyk7XG5cbiAgLy8gQ2xlYW4gdXBcbiAgZGVsZXRlIHByb3BzLmV4dGVuZHM7XG5cbiAgLy8gUHVsbCBvdXQgQ1NTIHRoYXQgbmVlZHMgdG8gYmUgaW4gdGhlIGxpZ2h0LWRvbVxuICBpZiAocHJvcHMudGVtcGxhdGUpIHtcbiAgICB2YXIgb3V0cHV0ID0gcHJvY2Vzc0Nzcyhwcm9wcy50ZW1wbGF0ZSwgbmFtZSk7XG5cbiAgICBwcm9wcy50ZW1wbGF0ZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RlbXBsYXRlJyk7XG4gICAgcHJvcHMudGVtcGxhdGUuaW5uZXJIVE1MID0gb3V0cHV0LnRlbXBsYXRlO1xuICAgIHByb3BzLmxpZ2h0Q3NzID0gb3V0cHV0LmxpZ2h0Q3NzO1xuXG4gICAgcHJvcHMuZ2xvYmFsQ3NzID0gcHJvcHMuZ2xvYmFsQ3NzIHx8ICcnO1xuICAgIHByb3BzLmdsb2JhbENzcyArPSBvdXRwdXQuZ2xvYmFsQ3NzO1xuICB9XG5cbiAgLy8gSW5qZWN0IGdsb2JhbCBDU1MgaW50byB0aGUgZG9jdW1lbnQsXG4gIC8vIGFuZCBkZWxldGUgYXMgbm8gbG9uZ2VyIG5lZWRlZFxuICBpbmplY3RHbG9iYWxDc3MocHJvcHMuZ2xvYmFsQ3NzKTtcbiAgZGVsZXRlIHByb3BzLmdsb2JhbENzcztcblxuICAvLyBNZXJnZSBiYXNlIGdldHRlci9zZXR0ZXIgYXR0cmlidXRlcyB3aXRoIHRoZSB1c2VyJ3MsXG4gIC8vIHRoZW4gZGVmaW5lIHRoZSBwcm9wZXJ0eSBkZXNjcmlwdG9ycyBvbiB0aGUgcHJvdG90eXBlLlxuICB2YXIgZGVzY3JpcHRvcnMgPSBtaXhpbihwcm9wcy5hdHRycyB8fCB7fSwgYmFzZS5kZXNjcmlwdG9ycyk7XG5cbiAgLy8gU3RvcmUgdGhlIG9yZ2luYWwgZGVzY3JpcHRvcnMgc29tZXdoZXJlXG4gIC8vIGEgbGl0dGxlIG1vcmUgcHJpdmF0ZSBhbmQgZGVsZXRlIHRoZSBvcmlnaW5hbFxuICBwcm9wcy5fYXR0cnMgPSBwcm9wcy5hdHRycztcbiAgZGVsZXRlIHByb3BzLmF0dHJzO1xuXG4gIC8vIENyZWF0ZSB0aGUgcHJvdG90eXBlLCBleHRlbmRlZCBmcm9tIGJhc2UgYW5kXG4gIC8vIGRlZmluZSB0aGUgZGVzY3JpcHRvcnMgZGlyZWN0bHkgb24gdGhlIHByb3RvdHlwZVxuICB2YXIgcHJvdG8gPSBjcmVhdGVQcm90byhiYXNlUHJvdG8sIHByb3BzKTtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMocHJvdG8sIGRlc2NyaXB0b3JzKTtcblxuICAvLyBSZWdpc3RlciB0aGUgY3VzdG9tLWVsZW1lbnQgYW5kIHJldHVybiB0aGUgY29uc3RydWN0b3JcbiAgdHJ5IHtcbiAgICByZXR1cm4gZG9jdW1lbnQucmVnaXN0ZXJFbGVtZW50KG5hbWUsIHsgcHJvdG90eXBlOiBwcm90byB9KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmIChlLm5hbWUgIT09ICdOb3RTdXBwb3J0ZWRFcnJvcicpIHtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG59O1xuXG52YXIgYmFzZSA9IHtcbiAgcHJvcGVydGllczoge1xuICAgIEdhaWFDb21wb25lbnQ6IHRydWUsXG4gICAgYXR0cmlidXRlQ2hhbmdlZDogbm9vcCxcbiAgICBhdHRhY2hlZDogbm9vcCxcbiAgICBkZXRhY2hlZDogbm9vcCxcbiAgICBjcmVhdGVkOiBub29wLFxuXG4gICAgY3JlYXRlZENhbGxiYWNrOiBmdW5jdGlvbigpIHtcbiAgICAgIGlmICh0aGlzLnJ0bCkgeyBhZGREaXJPYnNlcnZlcigpOyB9XG4gICAgICBpbmplY3RMaWdodENzcyh0aGlzKTtcbiAgICAgIHRoaXMuY3JlYXRlZCgpO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBJdCBpcyB2ZXJ5IGNvbW1vbiB0byB3YW50IHRvIGtlZXAgb2JqZWN0XG4gICAgICogcHJvcGVydGllcyBpbi1zeW5jIHdpdGggYXR0cmlidXRlcyxcbiAgICAgKiBmb3IgZXhhbXBsZTpcbiAgICAgKlxuICAgICAqICAgZWwudmFsdWUgPSAnZm9vJztcbiAgICAgKiAgIGVsLnNldEF0dHJpYnV0ZSgndmFsdWUnLCAnZm9vJyk7XG4gICAgICpcbiAgICAgKiBTbyB3ZSBzdXBwb3J0IGFuIG9iamVjdCBvbiB0aGUgcHJvdG90eXBlXG4gICAgICogbmFtZWQgJ2F0dHJzJyB0byBwcm92aWRlIGEgY29uc2lzdGVudFxuICAgICAqIHdheSBmb3IgY29tcG9uZW50IGF1dGhvcnMgdG8gZGVmaW5lXG4gICAgICogdGhlc2UgcHJvcGVydGllcy4gV2hlbiBhbiBhdHRyaWJ1dGVcbiAgICAgKiBjaGFuZ2VzIHdlIGtlZXAgdGhlIGF0dHJbbmFtZV1cbiAgICAgKiB1cC10by1kYXRlLlxuICAgICAqXG4gICAgICogQHBhcmFtICB7U3RyaW5nfSBuYW1lXG4gICAgICogQHBhcmFtICB7U3RyaW5nfHxudWxsfSBmcm9tXG4gICAgICogQHBhcmFtICB7U3RyaW5nfHxudWxsfSB0b1xuICAgICAqL1xuICAgIGF0dHJpYnV0ZUNoYW5nZWRDYWxsYmFjazogZnVuY3Rpb24obmFtZSwgZnJvbSwgdG8pIHtcbiAgICAgIHZhciBwcm9wID0gdG9DYW1lbENhc2UobmFtZSk7XG4gICAgICBpZiAodGhpcy5fYXR0cnMgJiYgdGhpcy5fYXR0cnNbcHJvcF0pIHsgdGhpc1twcm9wXSA9IHRvOyB9XG4gICAgICB0aGlzLmF0dHJpYnV0ZUNoYW5nZWQobmFtZSwgZnJvbSwgdG8pO1xuICAgIH0sXG5cbiAgICBhdHRhY2hlZENhbGxiYWNrOiBmdW5jdGlvbigpIHsgdGhpcy5hdHRhY2hlZCgpOyB9LFxuICAgIGRldGFjaGVkQ2FsbGJhY2s6IGZ1bmN0aW9uKCkgeyB0aGlzLmRldGFjaGVkKCk7IH0sXG5cbiAgICAvKipcbiAgICAgKiBBIGNvbnZlbmllbnQgbWV0aG9kIGZvciBzZXR0aW5nIHVwXG4gICAgICogYSBzaGFkb3ctcm9vdCB1c2luZyB0aGUgZGVmaW5lZCB0ZW1wbGF0ZS5cbiAgICAgKlxuICAgICAqIEByZXR1cm4ge1NoYWRvd1Jvb3R9XG4gICAgICovXG4gICAgc2V0dXBTaGFkb3dSb290OiBmdW5jdGlvbigpIHtcbiAgICAgIGlmICghdGhpcy50ZW1wbGF0ZSkgeyByZXR1cm47IH1cbiAgICAgIHZhciBub2RlID0gZG9jdW1lbnQuaW1wb3J0Tm9kZSh0aGlzLnRlbXBsYXRlLmNvbnRlbnQsIHRydWUpO1xuICAgICAgdGhpcy5jcmVhdGVTaGFkb3dSb290KCkuYXBwZW5kQ2hpbGQobm9kZSk7XG4gICAgICByZXR1cm4gdGhpcy5zaGFkb3dSb290O1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBTZXRzIGFuIGF0dHJpYnV0ZSBpbnRlcm5hbGx5XG4gICAgICogYW5kIGV4dGVybmFsbHkuIFRoaXMgaXMgc28gdGhhdFxuICAgICAqIHdlIGNhbiBzdHlsZSBpbnRlcm5hbCBzaGFkb3ctZG9tXG4gICAgICogY29udGVudC5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IHZhbHVlXG4gICAgICovXG4gICAgc2V0QXR0cjogZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgICAgIHZhciBpbnRlcm5hbCA9IHRoaXMuc2hhZG93Um9vdC5maXJzdEVsZW1lbnRDaGlsZDtcbiAgICAgIHNldEF0dHJpYnV0ZS5jYWxsKGludGVybmFsLCBuYW1lLCB2YWx1ZSk7XG4gICAgICBzZXRBdHRyaWJ1dGUuY2FsbCh0aGlzLCBuYW1lLCB2YWx1ZSk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFJlbW92ZXMgYW4gYXR0cmlidXRlIGludGVybmFsbHlcbiAgICAgKiBhbmQgZXh0ZXJuYWxseS4gVGhpcyBpcyBzbyB0aGF0XG4gICAgICogd2UgY2FuIHN0eWxlIGludGVybmFsIHNoYWRvdy1kb21cbiAgICAgKiBjb250ZW50LlxuICAgICAqXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IG5hbWVcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gdmFsdWVcbiAgICAgKi9cbiAgICByZW1vdmVBdHRyOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgICB2YXIgaW50ZXJuYWwgPSB0aGlzLnNoYWRvd1Jvb3QuZmlyc3RFbGVtZW50Q2hpbGQ7XG4gICAgICByZW1vdmVBdHRyaWJ1dGUuY2FsbChpbnRlcm5hbCwgbmFtZSk7XG4gICAgICByZW1vdmVBdHRyaWJ1dGUuY2FsbCh0aGlzLCBuYW1lKTtcbiAgICB9XG4gIH0sXG5cbiAgZGVzY3JpcHRvcnM6IHtcbiAgICB0ZXh0Q29udGVudDoge1xuICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICB0ZXh0Q29udGVudC5zZXQuY2FsbCh0aGlzLCB2YWx1ZSk7XG4gICAgICAgIGlmICh0aGlzLmxpZ2h0U3R5bGUpIHsgdGhpcy5hcHBlbmRDaGlsZCh0aGlzLmxpZ2h0U3R5bGUpOyB9XG4gICAgICB9LFxuXG4gICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gdGV4dENvbnRlbnQuZ2V0KCk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGlubmVySFRNTDoge1xuICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICBpbm5lckhUTUwuc2V0LmNhbGwodGhpcywgdmFsdWUpO1xuICAgICAgICBpZiAodGhpcy5saWdodFN0eWxlKSB7IHRoaXMuYXBwZW5kQ2hpbGQodGhpcy5saWdodFN0eWxlKTsgfVxuICAgICAgfSxcblxuICAgICAgZ2V0OiBpbm5lckhUTUwuZ2V0XG4gICAgfVxuICB9XG59O1xuXG4vKipcbiAqIFRoZSBkZWZhdWx0IGJhc2UgcHJvdG90eXBlIHRvIHVzZVxuICogd2hlbiBgZXh0ZW5kc2AgaXMgdW5kZWZpbmVkLlxuICpcbiAqIEB0eXBlIHtPYmplY3R9XG4gKi9cbnZhciBkZWZhdWx0UHJvdG90eXBlID0gY3JlYXRlUHJvdG8oSFRNTEVsZW1lbnQucHJvdG90eXBlLCBiYXNlLnByb3BlcnRpZXMpO1xuXG4vKipcbiAqIFJldHVybnMgYSBzdWl0YWJsZSBwcm90b3R5cGUgYmFzZWRcbiAqIG9uIHRoZSBvYmplY3QgcGFzc2VkLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0gIHtIVE1MRWxlbWVudFByb3RvdHlwZXx1bmRlZmluZWR9IHByb3RvXG4gKiBAcmV0dXJuIHtIVE1MRWxlbWVudFByb3RvdHlwZX1cbiAqL1xuZnVuY3Rpb24gZ2V0QmFzZVByb3RvKHByb3RvKSB7XG4gIGlmICghcHJvdG8pIHsgcmV0dXJuIGRlZmF1bHRQcm90b3R5cGU7IH1cbiAgcHJvdG8gPSBwcm90by5wcm90b3R5cGUgfHwgcHJvdG87XG4gIHJldHVybiAhcHJvdG8uR2FpYUNvbXBvbmVudCA/XG4gICAgY3JlYXRlUHJvdG8ocHJvdG8sIGJhc2UucHJvcGVydGllcykgOiBwcm90bztcbn1cblxuLyoqXG4gKiBFeHRlbmRzIHRoZSBnaXZlbiBwcm90byBhbmQgbWl4ZXNcbiAqIGluIHRoZSBnaXZlbiBwcm9wZXJ0aWVzLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0gIHtPYmplY3R9IHByb3RvXG4gKiBAcGFyYW0gIHtPYmplY3R9IHByb3BzXG4gKiBAcmV0dXJuIHtPYmplY3R9XG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZVByb3RvKHByb3RvLCBwcm9wcykge1xuICByZXR1cm4gbWl4aW4oT2JqZWN0LmNyZWF0ZShwcm90byksIHByb3BzKTtcbn1cblxuLyoqXG4gKiBEZXRlY3RzIHByZXNlbmNlIG9mIHNoYWRvdy1kb21cbiAqIENTUyBzZWxlY3RvcnMuXG4gKlxuICogQHByaXZhdGVcbiAqIEByZXR1cm4ge0Jvb2xlYW59XG4gKi9cbnZhciBoYXNTaGFkb3dDU1MgPSAoZnVuY3Rpb24oKSB7XG4gIHZhciBkaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgdHJ5IHsgZGl2LnF1ZXJ5U2VsZWN0b3IoJzpob3N0Jyk7IHJldHVybiB0cnVlOyB9XG4gIGNhdGNoIChlKSB7IHJldHVybiBmYWxzZTsgfVxufSkoKTtcblxuLyoqXG4gKiBSZWdleHMgdXNlZCB0byBleHRyYWN0IHNoYWRvdy1jc3NcbiAqXG4gKiBAdHlwZSB7T2JqZWN0fVxuICovXG52YXIgcmVnZXggPSB7XG4gIHNoYWRvd0NzczogLyg/OlxcOmhvc3R8XFw6XFw6Y29udGVudClbXntdKlxce1tefV0qXFx9L2csXG4gICc6aG9zdCc6IC8oPzpcXDpob3N0KS9nLFxuICAnOmhvc3QoKSc6IC9cXDpob3N0XFwoKC4rKVxcKSg/OiBcXDpcXDpjb250ZW50KT8vZyxcbiAgJzpob3N0LWNvbnRleHQnOiAvXFw6aG9zdC1jb250ZXh0XFwoKC4rKVxcKShbXnssXSspPy9nLFxuICAnOjpjb250ZW50JzogLyg/OlxcOlxcOmNvbnRlbnQpL2dcbn07XG5cbi8qKlxuICogRXh0cmFjdHMgdGhlIDpob3N0IGFuZCA6OmNvbnRlbnQgcnVsZXNcbiAqIGZyb20gdGhlIHNoYWRvdy1kb20gQ1NTIGFuZCByZXdyaXRlc1xuICogdGhlbSB0byB3b3JrIGZyb20gdGhlIDxzdHlsZSBzY29wZWQ+XG4gKiBpbmplY3RlZCBhdCB0aGUgcm9vdCBvZiB0aGUgY29tcG9uZW50LlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKi9cbmZ1bmN0aW9uIHByb2Nlc3NDc3ModGVtcGxhdGUsIG5hbWUpIHtcbiAgdmFyIGdsb2JhbENzcyA9ICcnO1xuICB2YXIgbGlnaHRDc3MgPSAnJztcblxuICBpZiAoIWhhc1NoYWRvd0NTUykge1xuICAgIHRlbXBsYXRlID0gdGVtcGxhdGUucmVwbGFjZShyZWdleC5zaGFkb3dDc3MsIGZ1bmN0aW9uKG1hdGNoKSB7XG4gICAgICB2YXIgaG9zdENvbnRleHQgPSByZWdleFsnOmhvc3QtY29udGV4dCddLmV4ZWMobWF0Y2gpO1xuXG4gICAgICBpZiAoaG9zdENvbnRleHQpIHtcbiAgICAgICAgZ2xvYmFsQ3NzICs9IG1hdGNoXG4gICAgICAgICAgLnJlcGxhY2UocmVnZXhbJzo6Y29udGVudCddLCAnJylcbiAgICAgICAgICAucmVwbGFjZShyZWdleFsnOmhvc3QtY29udGV4dCddLCAnJDEgJyArIG5hbWUgKyAnJDInKVxuICAgICAgICAgIC5yZXBsYWNlKC8gKy9nLCAnICcpOyAvLyBleGNlc3Mgd2hpdGVzcGFjZVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbGlnaHRDc3MgKz0gbWF0Y2hcbiAgICAgICAgICAucmVwbGFjZShyZWdleFsnOmhvc3QoKSddLCBuYW1lICsgJyQxJylcbiAgICAgICAgICAucmVwbGFjZShyZWdleFsnOmhvc3QnXSwgbmFtZSlcbiAgICAgICAgICAucmVwbGFjZShyZWdleFsnOjpjb250ZW50J10sIG5hbWUpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gJyc7XG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHRlbXBsYXRlOiB0ZW1wbGF0ZSxcbiAgICBsaWdodENzczogbGlnaHRDc3MsXG4gICAgZ2xvYmFsQ3NzOiBnbG9iYWxDc3NcbiAgfTtcbn1cblxuLyoqXG4gKiBTb21lIENTUyBydWxlcywgc3VjaCBhcyBAa2V5ZnJhbWVzXG4gKiBhbmQgQGZvbnQtZmFjZSBkb24ndCB3b3JrIGluc2lkZVxuICogc2NvcGVkIG9yIHNoYWRvdyA8c3R5bGU+LiBTbyB3ZVxuICogaGF2ZSB0byBwdXQgdGhlbSBpbnRvICdnbG9iYWwnXG4gKiA8c3R5bGU+IGluIHRoZSBoZWFkIG9mIHRoZVxuICogZG9jdW1lbnQuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSAge1N0cmluZ30gY3NzXG4gKi9cbmZ1bmN0aW9uIGluamVjdEdsb2JhbENzcyhjc3MpIHtcbiAgaWYgKCFjc3MpIHtyZXR1cm47fVxuICB2YXIgc3R5bGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzdHlsZScpO1xuICBzdHlsZS5pbm5lckhUTUwgPSBjc3MudHJpbSgpO1xuICBoZWFkUmVhZHkoKS50aGVuKGZ1bmN0aW9uKCkge1xuICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQoc3R5bGUpO1xuICB9KTtcbn1cblxuXG4vKipcbiAqIFJlc29sdmVzIGEgcHJvbWlzZSBvbmNlIGRvY3VtZW50LmhlYWQgaXMgcmVhZHkuXG4gKlxuICogQHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gaGVhZFJlYWR5KCkge1xuICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSkge1xuICAgIGlmIChkb2N1bWVudC5oZWFkKSB7IHJldHVybiByZXNvbHZlKCk7IH1cbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbG9hZCcsIGZ1bmN0aW9uIGZuKCkge1xuICAgICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2xvYWQnLCBmbik7XG4gICAgICByZXNvbHZlKCk7XG4gICAgfSk7XG4gIH0pO1xufVxuXG5cbi8qKlxuICogVGhlIEdlY2tvIHBsYXRmb3JtIGRvZXNuJ3QgeWV0IGhhdmVcbiAqIGA6OmNvbnRlbnRgIG9yIGA6aG9zdGAsIHNlbGVjdG9ycyxcbiAqIHdpdGhvdXQgdGhlc2Ugd2UgYXJlIHVuYWJsZSB0byBzdHlsZVxuICogdXNlci1jb250ZW50IGluIHRoZSBsaWdodC1kb20gZnJvbVxuICogd2l0aGluIG91ciBzaGFkb3ctZG9tIHN0eWxlLXNoZWV0LlxuICpcbiAqIFRvIHdvcmthcm91bmQgdGhpcywgd2UgY2xvbmUgdGhlIDxzdHlsZT5cbiAqIG5vZGUgaW50byB0aGUgcm9vdCBvZiB0aGUgY29tcG9uZW50LFxuICogc28gb3VyIHNlbGVjdG9ycyBhcmUgYWJsZSB0byB0YXJnZXRcbiAqIGxpZ2h0LWRvbSBjb250ZW50LlxuICpcbiAqIEBwcml2YXRlXG4gKi9cbmZ1bmN0aW9uIGluamVjdExpZ2h0Q3NzKGVsKSB7XG4gIGlmIChoYXNTaGFkb3dDU1MpIHsgcmV0dXJuOyB9XG4gIGVsLmxpZ2h0U3R5bGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzdHlsZScpO1xuICBlbC5saWdodFN0eWxlLnNldEF0dHJpYnV0ZSgnc2NvcGVkJywgJycpO1xuICBlbC5saWdodFN0eWxlLmlubmVySFRNTCA9IGVsLmxpZ2h0Q3NzO1xuICBlbC5hcHBlbmRDaGlsZChlbC5saWdodFN0eWxlKTtcbn1cblxuLyoqXG4gKiBDb252ZXJ0IGh5cGhlbiBzZXBhcmF0ZWRcbiAqIHN0cmluZyB0byBjYW1lbC1jYXNlLlxuICpcbiAqIEV4YW1wbGU6XG4gKlxuICogICB0b0NhbWVsQ2FzZSgnZm9vLWJhcicpOyAvLz0+ICdmb29CYXInXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSAge1NyaW5nfSBzdHJpbmdcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqL1xuZnVuY3Rpb24gdG9DYW1lbENhc2Uoc3RyaW5nKSB7XG4gIHJldHVybiBzdHJpbmcucmVwbGFjZSgvLSguKS9nLCBmdW5jdGlvbiByZXBsYWNlcihzdHJpbmcsIHAxKSB7XG4gICAgcmV0dXJuIHAxLnRvVXBwZXJDYXNlKCk7XG4gIH0pO1xufVxuXG4vKipcbiAqIE9ic2VydmVyIChzaW5nbGV0b24pXG4gKlxuICogQHR5cGUge011dGF0aW9uT2JzZXJ2ZXJ8dW5kZWZpbmVkfVxuICovXG52YXIgZGlyT2JzZXJ2ZXI7XG5cbi8qKlxuICogT2JzZXJ2ZXMgdGhlIGRvY3VtZW50IGBkaXJgIChkaXJlY3Rpb24pXG4gKiBhdHRyaWJ1dGUgYW5kIGRpc3BhdGNoZXMgYSBnbG9iYWwgZXZlbnRcbiAqIHdoZW4gaXQgY2hhbmdlcy5cbiAqXG4gKiBDb21wb25lbnRzIGNhbiBsaXN0ZW4gdG8gdGhpcyBldmVudCBhbmRcbiAqIG1ha2UgaW50ZXJuYWwgY2hhbmdlcyBpZiBuZWVkIGJlLlxuICpcbiAqIEBwcml2YXRlXG4gKi9cbmZ1bmN0aW9uIGFkZERpck9ic2VydmVyKCkge1xuICBpZiAoZGlyT2JzZXJ2ZXIpIHsgcmV0dXJuOyB9XG5cbiAgZGlyT2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihvbkNoYW5nZWQpO1xuICBkaXJPYnNlcnZlci5vYnNlcnZlKGRvY3VtZW50LmRvY3VtZW50RWxlbWVudCwge1xuICAgIGF0dHJpYnV0ZUZpbHRlcjogWydkaXInXSxcbiAgICBhdHRyaWJ1dGVzOiB0cnVlXG4gIH0pO1xuXG4gIGZ1bmN0aW9uIG9uQ2hhbmdlZChtdXRhdGlvbnMpIHtcbiAgICBkb2N1bWVudC5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnZGlyY2hhbmdlZCcpKTtcbiAgfVxufVxuXG4vKipcbiAqIENvcHkgdGhlIHZhbHVlcyBvZiBhbGwgcHJvcGVydGllcyBmcm9tXG4gKiBzb3VyY2Ugb2JqZWN0IGB0YXJnZXRgIHRvIGEgdGFyZ2V0IG9iamVjdCBgc291cmNlYC5cbiAqIEl0IHdpbGwgcmV0dXJuIHRoZSB0YXJnZXQgb2JqZWN0LlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0gICB7T2JqZWN0fSB0YXJnZXRcbiAqIEBwYXJhbSAgIHtPYmplY3R9IHNvdXJjZVxuICogQHJldHVybnMge09iamVjdH1cbiAqL1xuZnVuY3Rpb24gbWl4aW4odGFyZ2V0LCBzb3VyY2UpIHtcbiAgZm9yICh2YXIga2V5IGluIHNvdXJjZSkge1xuICAgIHRhcmdldFtrZXldID0gc291cmNlW2tleV07XG4gIH1cbiAgcmV0dXJuIHRhcmdldDtcbn1cblxufSk7fSkodHlwZW9mIGRlZmluZT09J2Z1bmN0aW9uJyYmZGVmaW5lLmFtZD9kZWZpbmVcbjooZnVuY3Rpb24obix3KXsndXNlIHN0cmljdCc7cmV0dXJuIHR5cGVvZiBtb2R1bGU9PSdvYmplY3QnP2Z1bmN0aW9uKGMpe1xuYyhyZXF1aXJlLGV4cG9ydHMsbW9kdWxlKTt9OmZ1bmN0aW9uKGMpe3ZhciBtPXtleHBvcnRzOnt9fTtjKGZ1bmN0aW9uKG4pe1xucmV0dXJuIHdbbl07fSxtLmV4cG9ydHMsbSk7d1tuXT1tLmV4cG9ydHM7fTt9KSgnZ2FpYS1jb21wb25lbnQnLHRoaXMpKTtcbiIsIi8qIGdsb2JhbHMgZGVmaW5lICovXG4oZnVuY3Rpb24oZGVmaW5lKXsndXNlIHN0cmljdCc7ZGVmaW5lKGZ1bmN0aW9uKHJlcXVpcmUsZXhwb3J0cyxtb2R1bGUpe1xuXG4vKipcbiAqIERlcGVuZGVuY2llc1xuICovXG5cbnZhciBjb21wb25lbnQgPSByZXF1aXJlKCdnYWlhLWNvbXBvbmVudCcpO1xuXG4vKipcbiAqIFNpbXBsZSBsb2dnZXJcbiAqIEB0eXBlIHtGdW5jdGlvbn1cbiAqL1xudmFyIGRlYnVnID0gMCA/IGNvbnNvbGUubG9nLmJpbmQoY29uc29sZSkgOiBmdW5jdGlvbigpIHt9O1xuXG4vKipcbiAqIEV4cG9ydHNcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGNvbXBvbmVudC5yZWdpc3RlcigndnItc2NlbmUnLCB7XG4gIGV4dGVuZHM6IEhUTUxEaXZFbGVtZW50LnByb3RvdHlwZSxcblxuICBjcmVhdGVkOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnNldHVwU2hhZG93Um9vdCgpO1xuICAgIHRoaXMuc2V0dXBSZW5kZXJlcigpO1xuICAgIHRoaXMuc2V0dXBTY2VuZSgpO1xuICAgIHRoaXMuc2V0dXBDYW1lcmEoKTtcbiAgfSxcblxuICBhZGRPYmplY3Q6IGZ1bmN0aW9uKGVsLCBwcm92aWRlZF9vYmopIHtcbiAgICB2YXIgb2JqID0gZWwub2JqZWN0M0Q7XG4gICAgdmFyIG9ialBhcmVudCA9IGVsLnBhcmVudE5vZGU7XG4gICAgaWYgKG9iaiAmJiB0aGlzLnNjZW5lLmdldE9iamVjdEJ5SWQob2JqLmlkKSkge1xuICAgICAgcmV0dXJuIG9iajtcbiAgICB9XG4gICAgb2JqID0gZWwub2JqZWN0M0QgPSBlbC5vYmplY3QzRCB8fCBwcm92aWRlZF9vYmogfHwgbmV3IFRIUkVFLk9iamVjdDNEKCk7XG4gICAgb2JqLnNjZW5lID0gdGhpcztcbiAgICBpZiAob2JqUGFyZW50ICYmIG9ialBhcmVudCAhPT0gdGhpcykge1xuICAgICAgb2JqUGFyZW50ID0gdGhpcy5hZGRPYmplY3QoZWwucGFyZW50Tm9kZSk7XG4gICAgICBvYmpQYXJlbnQuYWRkKG9iaik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuc2NlbmUuYWRkKG9iaik7XG4gICAgfVxuICAgIHJldHVybiBvYmo7XG4gIH0sXG5cbiAgZXBzaWxvbjogZnVuY3Rpb24gKCB2YWx1ZSApIHtcbiAgICByZXR1cm4gTWF0aC5hYnMoIHZhbHVlICkgPCAwLjAwMDAwMSA/IDAgOiB2YWx1ZTtcbiAgfSxcblxuICBnZXRDU1NNYXRyaXg6IGZ1bmN0aW9uIChtYXRyaXgpIHtcbiAgICB2YXIgZXBzaWxvbiA9IHRoaXMuZXBzaWxvbjtcbiAgICB2YXIgZWxlbWVudHMgPSBtYXRyaXguZWxlbWVudHM7XG5cbiAgICByZXR1cm4gJ21hdHJpeDNkKCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDAgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAxIF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMiBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDMgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyA0IF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgNSBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDYgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyA3IF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgOCBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDkgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAxMCBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDExIF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMTIgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAxMyBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDE0IF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMTUgXSApICtcbiAgICAnKSc7XG4gIH0sXG5cbiAgc2V0dXBDYW1lcmE6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBmb3YgPSB0aGlzLnN0eWxlLmdldFByb3BlcnR5VmFsdWUoJy0tZm92JykgfHwgNDU7XG4gICAgdmFyIHZpZXdwb3J0ID0gdGhpcy5zaGFkb3dSb290LnF1ZXJ5U2VsZWN0b3IoJy52aWV3cG9ydCcpO1xuXG4gICAgLy8gRE9NIGNhbWVyYVxuICAgIHZhciBwZXJzcGVjdGl2ZU1hdHJpeCA9IHRoaXMucGVyc3BlY3RpdmVNYXRyaXgoVEhSRUUuTWF0aC5kZWdUb1JhZCg0NSksIHRoaXMub2Zmc2V0V2lkdGggLyB0aGlzLm9mZnNldEhlaWdodCwgMSwgNTAwMCk7XG4gICAgdmFyIHNjYWxlZCA9IHBlcnNwZWN0aXZlTWF0cml4LmNsb25lKCkuc2NhbGUobmV3IFRIUkVFLlZlY3RvcjModGhpcy5vZmZzZXRXaWR0aCwgdGhpcy5vZmZzZXRIZWlnaHQsIDEpKTtcbiAgICB2YXIgc3R5bGUgPSB0aGlzLmdldENTU01hdHJpeChzY2FsZWQpO1xuICAgIHZpZXdwb3J0LnN0eWxlLnRyYW5zZm9ybSA9IHN0eWxlO1xuXG4gICAgLy8gV2ViR0wgY2FtZXJhXG4gICAgdGhpcy5jYW1lcmEgPSBuZXcgVEhSRUUuUGVyc3BlY3RpdmVDYW1lcmEoNDUsIHRoaXMub2Zmc2V0V2lkdGggLyB0aGlzLm9mZnNldEhlaWdodCwgMSwgNTAwMDApO1xuICB9LFxuXG4gIHBlcnNwZWN0aXZlTWF0cml4OiBmdW5jdGlvbihmb3YsIGFzcGVjdCwgbmVhcnosIGZhcnopIHtcbiAgICB2YXIgbWF0cml4ID0gbmV3IFRIUkVFLk1hdHJpeDQoKTtcbiAgICB2YXIgcmFuZ2UgPSBNYXRoLnRhbihmb3YgKiAwLjUpICogbmVhcno7XG5cbiAgICBtYXRyaXguZWxlbWVudHNbMF0gPSAoMiAqIG5lYXJ6KSAvICgocmFuZ2UgKiBhc3BlY3QpIC0gKC1yYW5nZSAqIGFzcGVjdCkpO1xuICAgIG1hdHJpeC5lbGVtZW50c1sxXSA9IDA7XG4gICAgbWF0cml4LmVsZW1lbnRzWzJdID0gMDtcbiAgICBtYXRyaXguZWxlbWVudHNbM10gPSAwO1xuICAgIG1hdHJpeC5lbGVtZW50c1s0XSA9IDA7XG4gICAgbWF0cml4LmVsZW1lbnRzWzVdID0gKDIgKiBuZWFyeikgLyAoMiAqIHJhbmdlKTtcbiAgICBtYXRyaXguZWxlbWVudHNbNl0gPSAwO1xuICAgIG1hdHJpeC5lbGVtZW50c1s3XSA9IDA7XG4gICAgbWF0cml4LmVsZW1lbnRzWzhdID0gMDtcbiAgICBtYXRyaXguZWxlbWVudHNbOV0gPSAwO1xuICAgIG1hdHJpeC5lbGVtZW50c1sxMF0gPSAtKGZhcnogKyBuZWFyeikgLyAoZmFyeiAtIG5lYXJ6KTtcbiAgICBtYXRyaXguZWxlbWVudHNbMTFdID0gLTE7XG4gICAgbWF0cml4LmVsZW1lbnRzWzEyXSA9IDA7XG4gICAgbWF0cml4LmVsZW1lbnRzWzEzXSA9IDA7XG4gICAgbWF0cml4LmVsZW1lbnRzWzE0XSA9IC0oMiAqIGZhcnogKiBuZWFyeikgLyAoZmFyeiAtIG5lYXJ6KTtcbiAgICBtYXRyaXguZWxlbWVudHNbMTVdID0gMDtcbiAgICByZXR1cm4gbWF0cml4LnRyYW5zcG9zZSgpO1xuICB9LFxuXG4gIHNldHVwUmVuZGVyZXI6IGZ1bmN0aW9uKCkge1xuICAgIC8vIEFsbCBXZWJHTCBzZXR1cFxuICAgIHZhciBjYW52YXMgPSB0aGlzLmNhbnZhcyA9IHRoaXMuc2hhZG93Um9vdC5xdWVyeVNlbGVjdG9yKCdjYW52YXMnKTtcblxuICAgIHRoaXMucmVzaXplQ2FudmFzKCk7XG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIHRoaXMucmVzaXplQ2FudmFzLmJpbmQodGhpcyksIGZhbHNlKTtcblxuICAgIHZhciByZW5kZXJlciA9IHRoaXMucmVuZGVyZXIgPSBuZXcgVEhSRUUuV2ViR0xSZW5kZXJlciggeyBjYW52YXM6IGNhbnZhcywgYW50aWFsaWFzOiB0cnVlLCBhbHBoYTogdHJ1ZSB9ICk7XG4gICAgcmVuZGVyZXIuc2V0U2l6ZSggdGhpcy5jYW52YXMud2lkdGgsIHRoaXMuY2FudmFzLmhlaWdodCApO1xuICAgIHJlbmRlcmVyLnNvcnRPYmplY3RzID0gZmFsc2U7XG4gIH0sXG5cbiAgc2V0dXBTY2VuZTogZnVuY3Rpb24oKSB7XG4gICAgLy8vIEFsbCBXZWJHTCBTZXR1cFxuICAgIHZhciBzY2VuZSA9IHRoaXMuc2NlbmUgPSBuZXcgVEhSRUUuU2NlbmUoKTtcbiAgICBjcmVhdGVMaWdodHMoKTtcbiAgICBmdW5jdGlvbiBjcmVhdGVMaWdodHMoKSB7XG4gICAgICB2YXIgZGlyZWN0aW9uYWxMaWdodCA9IG5ldyBUSFJFRS5EaXJlY3Rpb25hbExpZ2h0KDB4ZmZmZmZmKTtcbiAgICAgIGRpcmVjdGlvbmFsTGlnaHQucG9zaXRpb24uc2V0KDEsIDEsIDEpLm5vcm1hbGl6ZSgpO1xuICAgICAgc2NlbmUuYWRkKGRpcmVjdGlvbmFsTGlnaHQpO1xuICAgIH1cbiAgfSxcblxuICB1cGRhdGVDaGlsZHJlbjogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGNoaWxkO1xuICAgIHZhciBpO1xuICAgIGZvciAoaSA9IDA7IGkgPCB0aGlzLmNoaWxkcmVuLmxlbmd0aDsgKytpKSB7XG4gICAgICBjaGlsZCA9IHRoaXMuY2hpbGRyZW5baV07XG4gICAgICBpZiAodHlwZW9mIGNoaWxkLnVwZGF0ZSA9PSAnZnVuY3Rpb24nKSB7IGNoaWxkLnVwZGF0ZSgpOyB9XG4gICAgICBpZiAodHlwZW9mIGNoaWxkLnVwZGF0ZUNoaWxkcmVuID09ICdmdW5jdGlvbicpIHsgY2hpbGQudXBkYXRlQ2hpbGRyZW4oKTsgfVxuICAgIH1cbiAgfSxcblxuICByZXNpemVDYW52YXM6IGZ1bmN0aW9uKHJlbmRlcmVyLCBjYW1lcmEpe1xuICAgIHZhciBjYW52YXMgPSB0aGlzLmNhbnZhcztcbiAgICAvLyBNYWtlIGl0IHZpc3VhbGx5IGZpbGwgdGhlIHBvc2l0aW9uZWQgcGFyZW50XG4gICAgY2FudmFzLnN0eWxlLndpZHRoID0nMTAwJSc7XG4gICAgY2FudmFzLnN0eWxlLmhlaWdodD0nMTAwJSc7XG4gICAgLy8gLi4udGhlbiBzZXQgdGhlIGludGVybmFsIHNpemUgdG8gbWF0Y2hcbiAgICBjYW52YXMud2lkdGggID0gY2FudmFzLm9mZnNldFdpZHRoO1xuICAgIGNhbnZhcy5oZWlnaHQgPSBjYW52YXMub2Zmc2V0SGVpZ2h0O1xuXG4gICAgaWYgKHRoaXMuY2FtZXJhKSB7XG4gICAgICB0aGlzLmNhbWVyYS5hc3BlY3QgPSBjYW52YXMud2lkdGggLyBjYW52YXMuaGVpZ2h0O1xuICAgICAgdGhpcy5jYW1lcmEudXBkYXRlUHJvamVjdGlvbk1hdHJpeCgpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLnJlbmRlcmVyKSB7XG4gICAgICAvLyBub3RpZnkgdGhlIHJlbmRlcmVyIG9mIHRoZSBzaXplIGNoYW5nZVxuICAgICAgdGhpcy5yZW5kZXJlci5zZXRTaXplKCBjYW52YXMud2lkdGgsIGNhbnZhcy5oZWlnaHQgKTtcbiAgICB9XG4gIH0sXG5cbiAgYW5pbWF0ZTogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHRoaXMudXBkYXRlQ2hpbGRyZW4oKTtcbiAgICBzZWxmLnJlbmRlcmVyLnJlbmRlcihzZWxmLnNjZW5lLCBzZWxmLmNhbWVyYSk7XG4gIH0sXG5cbiAgYXR0cmlidXRlQ2hhbmdlZDogZnVuY3Rpb24obmFtZSwgZnJvbSwgdG8pIHtcbiAgICBpZiAobmFtZSA9PT0gXCJhbmdsZVwiKSB7XG4gICAgICB0aGlzLnN0eWxlLnRyYW5zZm9ybSA9ICdyb3RhdGVZKCAnICsgdGhpcy5hbmdsZSArICdkZWcgKSc7XG4gICAgfVxuICB9LFxuXG4gIHRlbXBsYXRlOiBgXG4gICAgPGNhbnZhcyB3aWR0aD1cIjEwMCVcIiBoZWlnaHQ9XCIxMDAlXCI+PC9jYW52YXM+XG4gICAgPGRpdiBjbGFzcz1cInZpZXdwb3J0XCI+XG4gICAgICA8Y29udGVudD48L2NvbnRlbnQ+XG4gICAgPC9kaXY+XG5cbiAgICAgIDxzdHlsZT5cbiAgICA6aG9zdCB7XG4gICAgICBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7XG4gICAgICB3aWR0aDogMTAwJTtcbiAgICAgIGhlaWdodDogMTAwdmg7XG4gICAgfVxuXG4gICAgLnZpZXdwb3J0IHtcbiAgICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcbiAgICAgIGJveC1zaXppbmc6IGJvcmRlci1ib3g7XG4gICAgICB0cmFuc2Zvcm0tc3R5bGU6IHByZXNlcnZlLTNkO1xuICAgICAgd2lkdGg6IDEwMCU7XG4gICAgICBoZWlnaHQ6IDEwMHZoO1xuICAgIH1cblxuICAgIGNhbnZhcyB7XG4gICAgICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gICAgICB0cmFuc2Zvcm0tc3R5bGU6IHByZXNlcnZlLTNkO1xuICAgICAgd2lkdGg6IDEwMCU7XG4gICAgICBoZWlnaHQ6IDEwMHZoO1xuICAgIH1cbiAgICA8L3N0eWxlPmBcbn0pO1xuXG59KTt9KSh0eXBlb2YgZGVmaW5lPT0nZnVuY3Rpb24nJiZkZWZpbmUuYW1kP2RlZmluZVxuOihmdW5jdGlvbihuLHcpeyd1c2Ugc3RyaWN0JztyZXR1cm4gdHlwZW9mIG1vZHVsZT09J29iamVjdCc/ZnVuY3Rpb24oYyl7XG5jKHJlcXVpcmUsZXhwb3J0cyxtb2R1bGUpO306ZnVuY3Rpb24oYyl7dmFyIG09e2V4cG9ydHM6e319O2MoZnVuY3Rpb24obil7XG5yZXR1cm4gd1tuXTt9LG0uZXhwb3J0cyxtKTt3W25dPW0uZXhwb3J0czt9O30pKCdWUlNDZW5lJyx0aGlzKSk7XG4iLCIvKiBnbG9iYWxzIGRlZmluZSAqL1xuKGZ1bmN0aW9uKGRlZmluZSl7J3VzZSBzdHJpY3QnO2RlZmluZShmdW5jdGlvbihyZXF1aXJlLGV4cG9ydHMsbW9kdWxlKXtcblxuLyoqXG4gKiBEZXBlbmRlbmNpZXNcbiAqL1xuXG52YXIgY29tcG9uZW50ID0gcmVxdWlyZSgnZ2FpYS1jb21wb25lbnQnKTtcblxuLyoqXG4gKiBTaW1wbGUgbG9nZ2VyXG4gKiBAdHlwZSB7RnVuY3Rpb259XG4gKi9cbnZhciBkZWJ1ZyA9IDAgPyBjb25zb2xlLmxvZy5iaW5kKGNvbnNvbGUpIDogZnVuY3Rpb24oKSB7fTtcblxuLyoqXG4gKiBFeHBvcnRzXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBjb21wb25lbnQucmVnaXN0ZXIoJ3ZyLW9iamVjdCcsIHtcbiAgZXh0ZW5kczogSFRNTERpdkVsZW1lbnQucHJvdG90eXBlLFxuXG4gIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc2V0dXBTaGFkb3dSb290KCk7XG4gICAgdGhpcy5maW5kU2NlbmUoKTtcbiAgICB0aGlzLnNjZW5lLmFkZE9iamVjdCh0aGlzKTtcbiAgICB0aGlzLnVwZGF0ZVRyYW5zZm9ybSgpO1xuICB9LFxuXG4gIGF0dHJpYnV0ZUNoYW5nZWQ6IGZ1bmN0aW9uKG5hbWUsIGZyb20sIHRvKSB7XG4gICAgdGhpcy51cGRhdGVUcmFuc2Zvcm0oKTtcbiAgfSxcblxuICBlcHNpbG9uOiBmdW5jdGlvbiAoIHZhbHVlICkge1xuICAgIHJldHVybiBNYXRoLmFicyggdmFsdWUgKSA8IDAuMDAwMDAxID8gMCA6IHZhbHVlO1xuICB9LFxuXG4gIHVwZGF0ZTogZnVuY3Rpb24oKSB7IC8qIE5PT1AgKi8gfSxcblxuICB1cGRhdGVDaGlsZHJlbjogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGNoaWxkO1xuICAgIHZhciBpO1xuICAgIGZvciAoaSA9IDA7IGkgPCB0aGlzLmNoaWxkcmVuLmxlbmd0aDsgKytpKSB7XG4gICAgICBjaGlsZCA9IHRoaXMuY2hpbGRyZW5baV07XG4gICAgICBpZiAodHlwZW9mIGNoaWxkLnVwZGF0ZSA9PSAnZnVuY3Rpb24nKSB7IGNoaWxkLnVwZGF0ZSgpOyB9XG4gICAgICBpZiAodHlwZW9mIGNoaWxkLnVwZGF0ZUNoaWxkcmVuID09ICdmdW5jdGlvbicpIHsgY2hpbGQudXBkYXRlQ2hpbGRyZW4oKTsgfVxuICAgIH1cbiAgfSxcblxuICBnZXRDU1NNYXRyaXg6IGZ1bmN0aW9uIChtYXRyaXgpIHtcbiAgICB2YXIgZXBzaWxvbiA9IHRoaXMuZXBzaWxvbjtcbiAgICB2YXIgZWxlbWVudHMgPSBtYXRyaXguZWxlbWVudHM7XG5cbiAgICByZXR1cm4gJ21hdHJpeDNkKCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDAgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAxIF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMiBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDMgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyA0IF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgNSBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDYgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyA3IF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgOCBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDkgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAxMCBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDExIF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMTIgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAxMyBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDE0IF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMTUgXSApICtcbiAgICAnKSc7XG4gIH0sXG5cbiAgdXBkYXRlVHJhbnNmb3JtOiBmdW5jdGlvbigpIHtcbiAgICAvLyBQb3NpdGlvblxuICAgIHZhciB4ID0gdGhpcy5zdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKCctLXgnKSB8fCAwO1xuICAgIHZhciB5ID0gdGhpcy5zdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKCctLXknKSB8fCAwO1xuICAgIHZhciB6ID0gdGhpcy5zdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKCctLXonKSB8fCAwO1xuICAgIHZhciB0cmFuc2xhdGlvbiA9IG5ldyBUSFJFRS5NYXRyaXg0KCkubWFrZVRyYW5zbGF0aW9uKHgsIHksIC16KTtcblxuICAgIC8vIE9yaWVudGF0aW9uXG4gICAgdmFyIG9yaWVudGF0aW9uWCA9IHRoaXMuc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZSgnLS1yb3RYJykgfHwgMDtcbiAgICB2YXIgb3JpZW50YXRpb25ZID0gdGhpcy5zdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKCctLXJvdFknKSB8fCAwO1xuICAgIHZhciBvcmllbnRhdGlvblogPSB0aGlzLnN0eWxlLmdldFByb3BlcnR5VmFsdWUoJy0tcm90WicpIHx8IDA7XG5cbiAgICB2YXIgcm90WCA9IFRIUkVFLk1hdGguZGVnVG9SYWQob3JpZW50YXRpb25YKTtcbiAgICB2YXIgcm90WSA9IFRIUkVFLk1hdGguZGVnVG9SYWQob3JpZW50YXRpb25ZKTtcbiAgICB2YXIgcm90WiA9IFRIUkVFLk1hdGguZGVnVG9SYWQob3JpZW50YXRpb25aKTtcbiAgICB2YXIgcm90YXRpb25YID0gbmV3IFRIUkVFLk1hdHJpeDQoKS5tYWtlUm90YXRpb25YKHJvdFgpO1xuICAgIHZhciByb3RhdGlvblkgPSBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VSb3RhdGlvblkocm90WSk7XG4gICAgdmFyIHJvdGF0aW9uWiA9IG5ldyBUSFJFRS5NYXRyaXg0KCkubWFrZVJvdGF0aW9uWChyb3RaKTtcblxuICAgIHRoaXMuc3R5bGUudHJhbnNmb3JtID0gJ3RyYW5zbGF0ZTNkKC01MCUsIC01MCUsIDApICcgKyB0aGlzLmdldENTU01hdHJpeCh0cmFuc2xhdGlvbi5tdWx0aXBseShyb3RhdGlvbloubXVsdGlwbHkocm90YXRpb25ZLm11bHRpcGx5KHJvdGF0aW9uWCkpKSk7XG4gICAgdGhpcy5vYmplY3QzRC5wb3NpdGlvbi5zZXQoeCwgLXksIC16KTtcbiAgICB0aGlzLm9iamVjdDNELnJvdGF0aW9uLm9yZGVyID0gJ1lYWic7XG4gICAgdGhpcy5vYmplY3QzRC5yb3RhdGlvbi5zZXQoLXJvdFgsIHJvdFksIDApO1xuICB9LFxuXG4gIGZpbmRTY2VuZTogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNjZW5lcyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJ3ZyLXNjZW5lJyk7XG4gICAgdmFyIHBlcnNwZWN0aXZlO1xuICAgIGZvciAodmFyIGk9MDsgaSA8IHNjZW5lcy5sZW5ndGg7ICsraSkge1xuICAgICAgdGhpcy5zY2VuZSA9IHNjZW5lc1tpXTtcbiAgICB9XG4gIH0sXG5cbiAgdGVtcGxhdGU6IGBcbiAgICA8Y29udGVudD48L2NvbnRlbnQ+XG4gICAgOmhvc3Qge1xuICAgICAgbGVmdDogNTAlO1xuICAgICAgdG9wOiA1MCU7XG4gICAgICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gICAgICB0cmFuc2Zvcm0tc3R5bGU6IHByZXNlcnZlLTNkO1xuICAgIH1cbiAgYFxufSk7XG5cbn0pO30pKHR5cGVvZiBkZWZpbmU9PSdmdW5jdGlvbicmJmRlZmluZS5hbWQ/ZGVmaW5lXG46KGZ1bmN0aW9uKG4sdyl7J3VzZSBzdHJpY3QnO3JldHVybiB0eXBlb2YgbW9kdWxlPT0nb2JqZWN0Jz9mdW5jdGlvbihjKXtcbmMocmVxdWlyZSxleHBvcnRzLG1vZHVsZSk7fTpmdW5jdGlvbihjKXt2YXIgbT17ZXhwb3J0czp7fX07YyhmdW5jdGlvbihuKXtcbnJldHVybiB3W25dO30sbS5leHBvcnRzLG0pO3dbbl09bS5leHBvcnRzO307fSkoJ1ZST2JqZWN0Jyx0aGlzKSk7XG4iLCIvKiBnbG9iYWxzIGRlZmluZSAqL1xuKGZ1bmN0aW9uKGRlZmluZSl7J3VzZSBzdHJpY3QnO2RlZmluZShmdW5jdGlvbihyZXF1aXJlLGV4cG9ydHMsbW9kdWxlKXtcblxuLyoqXG4gKiBEZXBlbmRlbmNpZXNcbiAqL1xuXG52YXIgY29tcG9uZW50ID0gcmVxdWlyZSgnZ2FpYS1jb21wb25lbnQnKTtcblxuLyoqXG4gKiBTaW1wbGUgbG9nZ2VyXG4gKiBAdHlwZSB7RnVuY3Rpb259XG4gKi9cbnZhciBkZWJ1ZyA9IDAgPyBjb25zb2xlLmxvZy5iaW5kKGNvbnNvbGUpIDogZnVuY3Rpb24oKSB7fTtcblxuLyoqXG4gKiBFeHBvcnRzXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBjb21wb25lbnQucmVnaXN0ZXIoJ3ZyLWNhbWVyYScsIHtcbiAgZXh0ZW5kczogVlJPYmplY3QucHJvdG90eXBlLFxuXG4gIHVwZGF0ZVRyYW5zZm9ybTogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGVsU3R5bGVzID0gd2luZG93LmdldENvbXB1dGVkU3R5bGUodGhpcyk7XG4gICAgLy8gUG9zaXRpb25cbiAgICB2YXIgeCA9IGVsU3R5bGVzLmdldFByb3BlcnR5VmFsdWUoJy0teCcpIHx8IDA7XG4gICAgdmFyIHkgPSBlbFN0eWxlcy5nZXRQcm9wZXJ0eVZhbHVlKCctLXknKSB8fCAwO1xuICAgIHZhciB6ID0gZWxTdHlsZXMuZ2V0UHJvcGVydHlWYWx1ZSgnLS16JykgfHwgMDtcbiAgICB2YXIgdHJhbnNsYXRpb24gPSBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VUcmFuc2xhdGlvbih4LCB5LCAteik7XG5cbiAgICAvLyBPcmllbnRhdGlvblxuICAgIHZhciBvcmllbnRhdGlvblggPSBlbFN0eWxlcy5nZXRQcm9wZXJ0eVZhbHVlKCctLXJvdFgnKSB8fCAwO1xuICAgIHZhciBvcmllbnRhdGlvblkgPSBlbFN0eWxlcy5nZXRQcm9wZXJ0eVZhbHVlKCctLXJvdFknKSB8fCAwO1xuICAgIHZhciBvcmllbnRhdGlvblogPSBlbFN0eWxlcy5nZXRQcm9wZXJ0eVZhbHVlKCctLXJvdFonKSB8fCAwO1xuICAgIHZhciByb3RYID0gVEhSRUUuTWF0aC5kZWdUb1JhZChvcmllbnRhdGlvblgpO1xuICAgIHZhciByb3RZID0gVEhSRUUuTWF0aC5kZWdUb1JhZChvcmllbnRhdGlvblkpO1xuICAgIHZhciByb3RaID0gVEhSRUUuTWF0aC5kZWdUb1JhZChvcmllbnRhdGlvblopO1xuICAgIHZhciByb3RhdGlvblggPSBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VSb3RhdGlvblgocm90WCk7XG4gICAgdmFyIHJvdGF0aW9uWSA9IG5ldyBUSFJFRS5NYXRyaXg0KCkubWFrZVJvdGF0aW9uWShyb3RZKTtcbiAgICB2YXIgcm90YXRpb25aID0gbmV3IFRIUkVFLk1hdHJpeDQoKS5tYWtlUm90YXRpb25YKHJvdFopO1xuICAgIHZhciBtYXRyaXhDU1MgPSByb3RhdGlvbloubXVsdGlwbHkocm90YXRpb25ZLm11bHRpcGx5KHJvdGF0aW9uWC5tdWx0aXBseSh0cmFuc2xhdGlvbikpKTtcblxuICAgIHRoaXMuc3R5bGUudHJhbnNmb3JtID0gJ3RyYW5zbGF0ZTNkKC01MCUsIC01MCUsIDApICcgKyB0aGlzLmdldENTU01hdHJpeChtYXRyaXhDU1MpO1xuXG4gICAgLy8gTWF0cml4IHRocmVlanNcbiAgICByb3RhdGlvblggPSBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VSb3RhdGlvblgoLXJvdFgpO1xuICAgIHJvdGF0aW9uWSA9IG5ldyBUSFJFRS5NYXRyaXg0KCkubWFrZVJvdGF0aW9uWShyb3RZKTtcbiAgICByb3RhdGlvblogPSBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VSb3RhdGlvblgocm90Wik7XG4gICAgdmFyIG1hdHJpeCA9IHJvdGF0aW9uWi5tdWx0aXBseShyb3RhdGlvblkubXVsdGlwbHkocm90YXRpb25YLm11bHRpcGx5KHRyYW5zbGF0aW9uKSkpO1xuXG4gICAgdmFyIG9iamVjdDNEID0gdGhpcy5vYmplY3QzRDtcbiAgICBvYmplY3QzRC5tYXRyaXhBdXRvVXBkYXRlID0gZmFsc2U7XG4gICAgb2JqZWN0M0QubWF0cml4ID0gbWF0cml4O1xuXG4gIH0sXG5cbiAgdGVtcGxhdGU6IGBcbiAgICA8Y29udGVudD48L2NvbnRlbnQ+XG4gICAgOmhvc3Qge1xuICAgICAgbGVmdDogNTAlO1xuICAgICAgdG9wOiA1MCU7XG4gICAgICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gICAgICB0cmFuc2Zvcm0tc3R5bGU6IHByZXNlcnZlLTNkO1xuICAgIH1cbiAgYFxufSk7XG5cbn0pO30pKHR5cGVvZiBkZWZpbmU9PSdmdW5jdGlvbicmJmRlZmluZS5hbWQ/ZGVmaW5lXG46KGZ1bmN0aW9uKG4sdyl7J3VzZSBzdHJpY3QnO3JldHVybiB0eXBlb2YgbW9kdWxlPT0nb2JqZWN0Jz9mdW5jdGlvbihjKXtcbmMocmVxdWlyZSxleHBvcnRzLG1vZHVsZSk7fTpmdW5jdGlvbihjKXt2YXIgbT17ZXhwb3J0czp7fX07YyhmdW5jdGlvbihuKXtcbnJldHVybiB3W25dO30sbS5leHBvcnRzLG0pO3dbbl09bS5leHBvcnRzO307fSkoJ1ZSQ2FtZXJhJyx0aGlzKSk7XG4iLCIvKiBnbG9iYWxzIGRlZmluZSAqL1xuKGZ1bmN0aW9uKGRlZmluZSl7J3VzZSBzdHJpY3QnO2RlZmluZShmdW5jdGlvbihyZXF1aXJlLGV4cG9ydHMsbW9kdWxlKXtcblxuLyoqXG4gKiBEZXBlbmRlbmNpZXNcbiAqL1xuXG52YXIgY29tcG9uZW50ID0gcmVxdWlyZSgnZ2FpYS1jb21wb25lbnQnKTtcblxuLyoqXG4gKiBTaW1wbGUgbG9nZ2VyXG4gKiBAdHlwZSB7RnVuY3Rpb259XG4gKi9cbnZhciBkZWJ1ZyA9IDAgPyBjb25zb2xlLmxvZy5iaW5kKGNvbnNvbGUpIDogZnVuY3Rpb24oKSB7fTtcblxuLyoqXG4gKiBFeHBvcnRzXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBjb21wb25lbnQucmVnaXN0ZXIoJ3ZyLW1vZGVsJywge1xuICBleHRlbmRzOiBWUk9iamVjdC5wcm90b3R5cGUsXG5cbiAgY3JlYXRlZDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5zZXR1cFNjZW5lKCk7XG4gICAgVlJPYmplY3QucHJvdG90eXBlLmNyZWF0ZWQuY2FsbCh0aGlzKTtcbiAgfSxcblxuICBzZXR1cFNjZW5lOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgbWF0ZXJpYWwgPSBuZXcgVEhSRUUuTWVzaExhbWJlcnRNYXRlcmlhbCh7IGNvbG9yOiAnbWFnZW50YScgfSk7XG4gICAgdmFyIG1vZGVsID0gdGhpcy5tb2RlbCA9IG5ldyBUSFJFRS5NZXNoKG5ldyBUSFJFRS5Cb3hHZW9tZXRyeSgxMjAsIDEyMCwgMTIwKSwgbWF0ZXJpYWwpO1xuICAgIHZhciB4ID0gdGhpcy5zdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKCctLXgnKSB8fCAwO1xuICAgIHZhciB5ID0gdGhpcy5zdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKCctLXknKSB8fCAwO1xuICAgIHZhciB6ID0gdGhpcy5zdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKCctLXonKTtcbiAgICB0aGlzLnJheWNhc3RlciA9IG5ldyBUSFJFRS5SYXljYXN0ZXIoKTtcbiAgICBtb2RlbC5vdmVyZHJhdyA9IHRydWU7XG4gICAgbW9kZWwucG9zaXRpb24uc2V0KHgsIHksIC16KTtcbiAgICB0aGlzLm9iamVjdDNEID0gbW9kZWw7XG4gICAgdGhpcy5hdHRhY2hDbGlja0hhbmRsZXIoKTtcbiAgICAvL3RoaXMuYW5pbWF0ZSgpO1xuICB9LFxuXG4gIGF0dGFjaENsaWNrSGFuZGxlcjogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYubW91c2VQb3MgPSBuZXcgVEhSRUUuVmVjdG9yMigwLCAwKTtcbiAgICAvL3RoaXMuc2NlbmUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgb25Nb3VzZU1vdmVkLCBmYWxzZSk7XG4gICAgLy9kb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCAnbW91c2Vkb3duJywgb25Eb2N1bWVudE1vdXNlRG93biwgZmFsc2UgKTtcblxuICAgIGZ1bmN0aW9uIG9uTW91c2VNb3ZlZCAoIGUgKSB7XG4gICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBzZWxmLm1vdXNlUG9zLnggPSAoIGUuY2xpZW50WCAvIHdpbmRvdy5pbm5lcldpZHRoICkgKiAyIC0gMTtcbiAgICAgIHNlbGYubW91c2VQb3MueSA9IC0gKCBlLmNsaWVudFkgLyB3aW5kb3cuaW5uZXJIZWlnaHQgKSAqIDIgKyAxO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG9uRG9jdW1lbnRNb3VzZURvd24oIGUgKSB7XG4gICAgICBpZiAoc2VsZi5pbnRlcnNlY3RlZCkge1xuICAgICAgICBzZWxmLmV4cGxvZGUoKTtcbiAgICAgIH1cbiAgICAgIC8vIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgIC8vIHZhciBtb3VzZVZlY3RvciA9IG5ldyBUSFJFRS5WZWN0b3IzKCk7XG4gICAgICAvLyBtb3VzZVZlY3Rvci54ID0gMiAqIChlLmNsaWVudFggLyBTQ1JFRU5fV0lEVEgpIC0gMTtcbiAgICAgIC8vIG1vdXNlVmVjdG9yLnkgPSAxIC0gMiAqICggZS5jbGllbnRZIC8gU0NSRUVOX0hFSUdIVCApO1xuICAgICAgLy8gdmFyIHJheWNhc3RlciA9IHByb2plY3Rvci5waWNraW5nUmF5KCBtb3VzZVZlY3Rvci5jbG9uZSgpLCBjYW1lcmEgKTtcbiAgICAgIC8vIHZhciBpbnRlcnNlY3RzID0gcmF5Y2FzdGVyLmludGVyc2VjdE9iamVjdCggVEFSR0VUICk7XG4gICAgICAvLyBmb3IoIHZhciBpID0gMDsgaSA8IGludGVyc2VjdHMubGVuZ3RoOyBpKysgKSB7XG4gICAgICAvLyAgIHZhciBpbnRlcnNlY3Rpb24gPSBpbnRlcnNlY3RzWyBpIF0sXG4gICAgICAvLyAgIG9iaiA9IGludGVyc2VjdGlvbi5vYmplY3Q7XG4gICAgICAvLyAgIGNvbnMgb2xlLmxvZyhcIkludGVyc2VjdGVkIG9iamVjdFwiLCBvYmopO1xuICAgICAgLy8gfVxuICAgIH1cbiAgfSxcblxuICBleHBsb2RlOiBmdW5jdGlvbigpIHtcblxuICAgIHZhciBib3ggPSB0aGlzLm9iamVjdDNEO1xuICAgIHZhciBzY2VuZSA9IHRoaXMuc2NlbmU7XG4gICAgdmFyIGR1cmF0aW9uID0gODAwMDtcbiAgICB0aGlzLmV4cGxvZGluZyA9IHRydWU7XG5cbiAgICAvLyBleHBsb2RlIGdlb21ldHJ5IGludG8gb2JqZWN0c1xuICAgIHZhciBwaWVjZXMgPSBleHBsb2RlKCBib3guZ2VvbWV0cnksIGJveC5tYXRlcmlhbCApO1xuXG4gICAgYm94Lm1hdGVyaWFsLnZpc2libGUgPSBmYWxzZTtcblxuICAgIC8vIGFuaW1hdGUgb2JqZWN0c1xuICAgIGZvciAoIHZhciBpID0gMDsgaSA8IHBpZWNlcy5jaGlsZHJlbi5sZW5ndGg7IGkgKysgKSB7XG5cbiAgICAgIHZhciBvYmplY3QgPSBwaWVjZXMuY2hpbGRyZW5bIGkgXTtcblxuICAgICAgb2JqZWN0Lmdlb21ldHJ5LmNvbXB1dGVGYWNlTm9ybWFscygpO1xuICAgICAgdmFyIG5vcm1hbCA9IG9iamVjdC5nZW9tZXRyeS5mYWNlc1swXS5ub3JtYWwuY2xvbmUoKTtcbiAgICAgIHZhciB0YXJnZXRQb3NpdGlvbiA9IG9iamVjdC5wb3NpdGlvbi5jbG9uZSgpLmFkZCggbm9ybWFsLm11bHRpcGx5U2NhbGFyKCAzMDAwICkgKTtcbiAgICAgIC8vcmVtb3ZlQm94RnJvbUxpc3QoIGJveCApO1xuICAgICAgbmV3IFRXRUVOLlR3ZWVuKCBvYmplY3QucG9zaXRpb24gKVxuICAgICAgICAudG8oIHRhcmdldFBvc2l0aW9uLCBkdXJhdGlvbiApXG4gICAgICAgIC5vbkNvbXBsZXRlKCBkZWxldGVCb3ggKVxuICAgICAgICAuc3RhcnQoKTtcblxuICAgICAgb2JqZWN0Lm1hdGVyaWFsLm9wYWNpdHkgPSAwO1xuICAgICAgbmV3IFRXRUVOLlR3ZWVuKCBvYmplY3QubWF0ZXJpYWwgKVxuICAgICAgICAudG8oIHsgb3BhY2l0eTogMSB9LCBkdXJhdGlvbiApXG4gICAgICAgIC5zdGFydCgpO1xuXG4gICAgICB2YXIgcm90YXRpb24gPSAyICogTWF0aC5QSTtcbiAgICAgIHZhciB0YXJnZXRSb3RhdGlvbiA9IHsgeDogcm90YXRpb24sIHk6IHJvdGF0aW9uLCB6OnJvdGF0aW9uIH07XG4gICAgICBuZXcgVFdFRU4uVHdlZW4oIG9iamVjdC5yb3RhdGlvbiApXG4gICAgICAgIC50byggdGFyZ2V0Um90YXRpb24sIGR1cmF0aW9uIClcbiAgICAgICAgLnN0YXJ0KCk7XG5cbiAgICB9XG5cbiAgICBib3guYWRkKCBwaWVjZXMgKTtcblxuICAgIGZ1bmN0aW9uIHJlbW92ZUJveEZyb21MaXN0KCBib3ggKSB7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IG9iamVjdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgaWYgKG9iamVjdHNbaV0gPT09IGJveCkge1xuICAgICAgICAgIG9iamVjdHMuc3BsaWNlKGksIDEpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRlbGV0ZUJveCgpIHtcbiAgICAgIGJveC5yZW1vdmUoIHBpZWNlcyApXG4gICAgICAvL3NjZW5lLnJlbW92ZSggYm94ICk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZXhwbG9kZSggZ2VvbWV0cnksIG1hdGVyaWFsICkge1xuXG4gICAgICB2YXIgcGllY2VzID0gbmV3IFRIUkVFLkdyb3VwKCk7XG4gICAgICB2YXIgbWF0ZXJpYWwgPSBtYXRlcmlhbC5jbG9uZSgpO1xuICAgICAgbWF0ZXJpYWwuc2lkZSA9IFRIUkVFLkRvdWJsZVNpZGU7XG5cbiAgICAgIGZvciAoIHZhciBpID0gMDsgaSA8IGdlb21ldHJ5LmZhY2VzLmxlbmd0aDsgaSArKyApIHtcblxuICAgICAgICB2YXIgZmFjZSA9IGdlb21ldHJ5LmZhY2VzWyBpIF07XG5cbiAgICAgICAgdmFyIHZlcnRleEEgPSBnZW9tZXRyeS52ZXJ0aWNlc1sgZmFjZS5hIF0uY2xvbmUoKTtcbiAgICAgICAgdmFyIHZlcnRleEIgPSBnZW9tZXRyeS52ZXJ0aWNlc1sgZmFjZS5iIF0uY2xvbmUoKTtcbiAgICAgICAgdmFyIHZlcnRleEMgPSBnZW9tZXRyeS52ZXJ0aWNlc1sgZmFjZS5jIF0uY2xvbmUoKTtcblxuICAgICAgICB2YXIgZ2VvbWV0cnkyID0gbmV3IFRIUkVFLkdlb21ldHJ5KCk7XG4gICAgICAgIGdlb21ldHJ5Mi52ZXJ0aWNlcy5wdXNoKCB2ZXJ0ZXhBLCB2ZXJ0ZXhCLCB2ZXJ0ZXhDICk7XG4gICAgICAgIGdlb21ldHJ5Mi5mYWNlcy5wdXNoKCBuZXcgVEhSRUUuRmFjZTMoIDAsIDEsIDIgKSApO1xuXG4gICAgICAgIHZhciBtZXNoID0gbmV3IFRIUkVFLk1lc2goIGdlb21ldHJ5MiwgbWF0ZXJpYWwgKTtcbiAgICAgICAgbWVzaC5wb3NpdGlvbi5zdWIoIGdlb21ldHJ5Mi5jZW50ZXIoKSApO1xuICAgICAgICBwaWVjZXMuYWRkKCBtZXNoICk7XG5cbiAgICAgIH1cblxuICAgICAgLy9zb3J0IHRoZSBwaWVjZXNcbiAgICAgIHBpZWNlcy5jaGlsZHJlbi5zb3J0KCBmdW5jdGlvbiAoIGEsIGIgKSB7XG5cbiAgICAgICAgcmV0dXJuIGEucG9zaXRpb24ueiAtIGIucG9zaXRpb24uejtcbiAgICAgICAgLy9yZXR1cm4gYS5wb3NpdGlvbi54IC0gYi5wb3NpdGlvbi54OyAgICAgLy8gc29ydCB4XG4gICAgICAgIC8vcmV0dXJuIGIucG9zaXRpb24ueSAtIGEucG9zaXRpb24ueTsgICAvLyBzb3J0IHlcblxuICAgICAgfSApO1xuXG4gICAgICBwaWVjZXMucm90YXRpb24uc2V0KCAwLCAwLCAwIClcblxuICAgICAgcmV0dXJuIHBpZWNlcztcblxuICAgIH1cblxuICB9LFxuXG4gIGFuaW1hdGU6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgbGFzdFRpbWUgPSBzZWxmLmxhc3RUaW1lIHx8IDA7XG4gICAgdmFyIGFuZ3VsYXJTcGVlZCA9IHNlbGYuYW5ndWxhclNwZWVkIHx8IDAuMjtcbiAgICByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoZnVuY3Rpb24oKSB7XG4gICAgICBzZWxmLmFuaW1hdGUoKTtcbiAgICAgIFRXRUVOLnVwZGF0ZSgpO1xuICAgIH0pO1xuXG4gICAgaWYgKCF0aGlzLmV4cGxvZGluZykge1xuICAgICAgdmFyIHRpbWUgPSAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1xuICAgICAgdmFyIHRpbWVEaWZmID0gdGltZSAtIGxhc3RUaW1lO1xuICAgICAgdmFyIGFuZ2xlQ2hhbmdlID0gYW5ndWxhclNwZWVkICogdGltZURpZmYgKiAyICogTWF0aC5QSSAvIDEwMDA7XG4gICAgICBzZWxmLm1vZGVsLnJvdGF0aW9uLnkgKz0gYW5nbGVDaGFuZ2U7XG4gICAgICBzZWxmLmxhc3RUaW1lID0gdGltZTtcbiAgICAgIC8vdGhpcy5pbnRlcnNlY3RNb3VzZSgpO1xuICAgIH1cbiAgfSxcblxuICAvLyBmaW5kIGludGVyc2VjdGlvbnNcbiAgaW50ZXJzZWN0TW91c2U6IGZ1bmN0aW9uIGludGVyc2VjdCgpIHtcbiAgICB2YXIgcmF5Y2FzdGVyID0gdGhpcy5yYXljYXN0ZXI7XG4gICAgdmFyIG9iamVjdHMgPSBbdGhpcy5vYmplY3QzRF07XG4gICAgcmF5Y2FzdGVyLnNldEZyb21DYW1lcmEoIHRoaXMubW91c2VQb3MsIHRoaXMuc2NlbmUuY2FtZXJhICk7XG4gICAgdmFyIGludGVyc2VjdHMgPSByYXljYXN0ZXIuaW50ZXJzZWN0T2JqZWN0cyggb2JqZWN0cyApO1xuXG4gICAgaWYgKCBpbnRlcnNlY3RzLmxlbmd0aCA+IDAgKSB7XG5cbiAgICAgIGlmICggdGhpcy5vYmplY3QzRCA9PSBpbnRlcnNlY3RzWyAwIF0ub2JqZWN0ICYmICF0aGlzLmludGVyc2VjdGVkKSB7XG5cbiAgICAgICAgdGhpcy5pbnRlcnNlY3RlZCA9IHRoaXMub2JqZWN0M0QubWF0ZXJpYWwuZW1pc3NpdmUuZ2V0SGV4KCk7XG4gICAgICAgIHRoaXMub2JqZWN0M0QubWF0ZXJpYWwuZW1pc3NpdmUuc2V0SGV4KCAweGZmZmYwMCApO1xuXG4gICAgICB9XG5cbiAgICB9IGVsc2Uge1xuXG4gICAgICBpZiAoIHRoaXMuaW50ZXJzZWN0ZWQgKSB0aGlzLm9iamVjdDNELm1hdGVyaWFsLmVtaXNzaXZlLnNldCggJ2JsYWNrJyApO1xuICAgICAgdGhpcy5pbnRlcnNlY3RlZCA9IG51bGw7XG5cbiAgICB9XG4gIH0sXG5cbiAgdGVtcGxhdGU6IGBcbiAgICA6aG9zdCB7XG4gICAgICBsZWZ0OiA1MCU7XG4gICAgICB0b3A6IDUwJTtcbiAgICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgICAgIHRyYW5zZm9ybS1zdHlsZTogcHJlc2VydmUtM2Q7XG4gICAgfVxuICBgXG59KTtcblxufSk7fSkodHlwZW9mIGRlZmluZT09J2Z1bmN0aW9uJyYmZGVmaW5lLmFtZD9kZWZpbmVcbjooZnVuY3Rpb24obix3KXsndXNlIHN0cmljdCc7cmV0dXJuIHR5cGVvZiBtb2R1bGU9PSdvYmplY3QnP2Z1bmN0aW9uKGMpe1xuYyhyZXF1aXJlLGV4cG9ydHMsbW9kdWxlKTt9OmZ1bmN0aW9uKGMpe3ZhciBtPXtleHBvcnRzOnt9fTtjKGZ1bmN0aW9uKG4pe1xucmV0dXJuIHdbbl07fSxtLmV4cG9ydHMsbSk7d1tuXT1tLmV4cG9ydHM7fTt9KSgnVlJNb2RlbCcsdGhpcykpO1xuIiwiLyogZ2xvYmFscyBkZWZpbmUgKi9cbihmdW5jdGlvbihkZWZpbmUpeyd1c2Ugc3RyaWN0JztkZWZpbmUoZnVuY3Rpb24ocmVxdWlyZSxleHBvcnRzLG1vZHVsZSl7XG5cbi8qKlxuICogRGVwZW5kZW5jaWVzXG4gKi9cblxudmFyIGNvbXBvbmVudCA9IHJlcXVpcmUoJ2dhaWEtY29tcG9uZW50Jyk7XG5cbi8qKlxuICogU2ltcGxlIGxvZ2dlclxuICogQHR5cGUge0Z1bmN0aW9ufVxuICovXG52YXIgZGVidWcgPSAwID8gY29uc29sZS5sb2cuYmluZChjb25zb2xlKSA6IGZ1bmN0aW9uKCkge307XG5cbi8qKlxuICogRXhwb3J0c1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gY29tcG9uZW50LnJlZ2lzdGVyKCd2ci10ZXJyYWluJywge1xuICBleHRlbmRzOiBWUk9iamVjdC5wcm90b3R5cGUsXG5cbiAgY3JlYXRlZDogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHRoaXMuc2V0dXBTY2VuZShvbkxvYWRlZCk7XG4gICAgZnVuY3Rpb24gb25Mb2FkZWQoKSB7XG4gICAgICBWUk9iamVjdC5wcm90b3R5cGUuY3JlYXRlZC5jYWxsKHNlbGYpO1xuICAgICAgc2VsZi5nZW5lcmF0ZUxhYmVscyhub2lzZSk7XG4gICAgfVxuICB9LFxuXG4gIHNldHVwU2NlbmU6IGZ1bmN0aW9uKG9uTG9hZGVkKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIG5ldyBUZXJyYWluKG5vaXNlLCAxMDI0LCA0LCA2NCwgZnVuY3Rpb24obW9kZWwpIHs7XG4gICAgICB2YXIgeCA9IHNlbGYuc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZSgnLS14JykgfHwgMDtcbiAgICAgIHZhciB5ID0gc2VsZi5zdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKCctLXknKSB8fCAwO1xuICAgICAgdmFyIHogPSBzZWxmLnN0eWxlLmdldFByb3BlcnR5VmFsdWUoJy0teicpIHx8IDA7XG4gICAgICBtb2RlbC5wb3NpdGlvbi5zZXQoeCwgeSwgLXopO1xuICAgICAgc2VsZi5vYmplY3QzRCA9IG1vZGVsO1xuICAgICAgb25Mb2FkZWQoKTtcbiAgICB9KTtcbiAgfSxcblxuICBnZW5lcmF0ZUxhYmVsczogZnVuY3Rpb24obm9pc2UpIHtcbiAgICB2YXIgaHVkID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcignLmh1ZCcpO1xuICAgIHZhciBsYWJlbDtcbiAgICB2YXIgbWF4ID0gMjA7XG4gICAgZm9yKHZhciBpID0gMDsgaSA8IG5vaXNlLmltYWdlLmRhdGEubGVuZ3RoOyArK2kpIHtcbiAgICAgIHZhciBub2lzZVZhbHVlID0gbm9pc2UuaW1hZ2UuZGF0YVtpXTtcbiAgICAgIHZhciBzaWduMSA9IChNYXRoLnJhbmRvbSgpKjEwKS50b0ZpeGVkKDApICUgMiA9PT0gMD8gLTE6IDE7XG4gICAgICB2YXIgc2lnbjIgPSAoTWF0aC5yYW5kb20oKSoxMCkudG9GaXhlZCgwKSAlIDIgPT09IDA/IC0xOiAxO1xuICAgICAgaWYgKG5vaXNlVmFsdWUgPiA4MCkge1xuICAgICAgICBsYWJlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3ZyLW9iamVjdCcpO1xuICAgICAgICBsYWJlbC5jbGFzc0xpc3QuYWRkKCdwZWFrLWxhYmVsJyk7XG4gICAgICAgIGxhYmVsLnN0eWxlLnNldFByb3BlcnR5KCctLXgnLCAgc2lnbjEgKiAoTWF0aC5yYW5kb20oKSAqIDEwMjQpKTtcbiAgICAgICAgbGFiZWwuc3R5bGUuc2V0UHJvcGVydHkoJy0teScsICBzaWduMiAqIChNYXRoLnJhbmRvbSgpICogMTAyNCkpO1xuICAgICAgICBsYWJlbC5zdHlsZS5zZXRQcm9wZXJ0eSgnLS16JywgIC1ub2lzZVZhbHVlIC0gNTApO1xuICAgICAgICBsYWJlbC5zdHlsZS5zZXRQcm9wZXJ0eSgnLS1yb3RYJywgIC1odWQuc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZShcIi0tcm90WFwiKSk7XG4gICAgICAgIGxhYmVsLmlubmVySFRNTCA9IFwiTGFuZG1hcmsgXCIgKyBpO1xuICAgICAgICBodWQuYXBwZW5kQ2hpbGQobGFiZWwpO1xuICAgICAgICBtYXgtPTE7XG4gICAgICAgIGlmIChtYXggPT0gMCkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfSxcblxuICB0ZW1wbGF0ZTogYFxuICAgIDpob3N0IHtcbiAgICAgIGxlZnQ6IDUwJTtcbiAgICAgIHRvcDogNTAlO1xuICAgICAgcG9zaXRpb246IGFic29sdXRlO1xuICAgICAgdHJhbnNmb3JtLXN0eWxlOiBwcmVzZXJ2ZS0zZDtcbiAgICB9XG4gIGBcbn0pO1xuXG59KTt9KSh0eXBlb2YgZGVmaW5lPT0nZnVuY3Rpb24nJiZkZWZpbmUuYW1kP2RlZmluZVxuOihmdW5jdGlvbihuLHcpeyd1c2Ugc3RyaWN0JztyZXR1cm4gdHlwZW9mIG1vZHVsZT09J29iamVjdCc/ZnVuY3Rpb24oYyl7XG5jKHJlcXVpcmUsZXhwb3J0cyxtb2R1bGUpO306ZnVuY3Rpb24oYyl7dmFyIG09e2V4cG9ydHM6e319O2MoZnVuY3Rpb24obil7XG5yZXR1cm4gd1tuXTt9LG0uZXhwb3J0cyxtKTt3W25dPW0uZXhwb3J0czt9O30pKCdWUlRlcnJhaW4nLHRoaXMpKTtcbiJdLCJzb3VyY2VSb290IjoiL3NvdXJjZS8ifQ==