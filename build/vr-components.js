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
  var template = props.template || baseProto.templateString;

  // Components are extensible by default but can be declared
  // as non extensible as an optimization to avoid
  // storing the template strings
  var extensible = props.extensible = props.hasOwnProperty('extensible')?
    props.extensible : true;

  // Clean up
  delete props.extends;

  // Pull out CSS that needs to be in the light-dom
  if (template) {
    // Stores the string to be reprocessed when
    // a new component extends this one
    if (extensible && props.template) {
      props.templateString = props.template;
    }

    var output = processCss(template, name);

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
    var perspectiveMatrix = this.perspectiveMatrix(THREE.Math.degToRad(45), this.offsetWidth / this.offsetHeight, 1, 50000);
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
    this.object3D.rotation.set(-rotX, rotY, rotZ);
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
    translation = new THREE.Matrix4().makeTranslation(x, -y, -z);
    var matrix = rotationZ.multiply(rotationY.multiply(rotationX.multiply(translation)));

    var object3D = this.object3D;
    object3D.matrix = matrix;
    object3D.matrixAutoUpdate = false;
    object3D.matrixWorldNeedsUpdate = true;
  }

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

module.exports = component.register('vr-billboard', {
  extends: VRObject.prototype,

  created: function() {
    VRObject.prototype.created.call(this);
    this.updateTransform();
  },

  update: function() {
    this.updateTransform();
  },

  updateTransform: function() {
    var camera = document.querySelector('vr-camera');
    var matrix = new THREE.Matrix4();
    matrix.copy( matrix.getInverse(camera.object3D.matrixWorld) );
    matrix.copy( camera.object3D.matrixWorld );

    matrix.transpose();

    matrix.elements[ 3 ] = 0;
    matrix.elements[ 7 ] = 0;
    matrix.elements[ 11 ] = 0;
    matrix.elements[ 15 ] = 1;

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

    this.style.transform = 'translate3d(-50%, -50%, 0) ' + this.getCSSMatrix(translation.multiply(rotationZ.multiply(rotationY.multiply(rotationX.multiply(matrix)))));
    this.object3D.position.set(x, -y, -z);
    this.object3D.rotation.order = 'YXZ';
    this.object3D.rotation.set(-rotX, rotY, rotZ);
  }

});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('VRBillboard',this));

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

module.exports = component.register('vr-axis-gl', {
  extends: VRObject.prototype,

  created: function() {
    this.setupScene();
    VRObject.prototype.created.call(this);
  },

  setupScene: function() {
    this.object3D = new THREE.AxisHelper( 500 );
  }

});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('VRAxisGL',this));

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

module.exports = component.register('vr-axis-dom', {
  extends: VRObject.prototype,

  template: `
    <div class="axis x-axis"></div>
    <div class="axis y-axis"></div>
    <div class="axis z-axis"></div>
    <style>
    :host {
      left: 50%;
      top: 50%;
      position: absolute;
      transform-style: preserve-3d;
    }

    .axis {
      position: absolute;
      display: inline-block;
    }

    .x-axis {
      height: 1px;
      width: 500px;
      background-color: pink;
    }

    .y-axis {
      height: 500px;
      width: 1px;
      background-color: magent;
      transform: translate3d(0, -500px, 0);
    }

    .z-axis {
      height: 1px;
      width: 500px;
      background-color: violet;
      transform: translate3d(-50%, 0, 250px) rotateY(90deg);
    }
    </style>
  `

});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('VRAxisDOM',this));

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImdhaWEtY29tcG9uZW50LmpzIiwidnItc2NlbmUuanMiLCJ2ci1vYmplY3QuanMiLCJ2ci1jYW1lcmEuanMiLCJ2ci1tb2RlbC5qcyIsInZyLWJpbGxib2FyZC5qcyIsInZyLXRlcnJhaW4uanMiLCJ2ci1heGlzLWdsLmpzIiwidnItYXhpcy1kb20uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUNwYUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUNsTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUMzSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUMvREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FDaE9BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQzFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FDdEVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUNyQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJ2ci1jb21wb25lbnRzLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLyogZ2xvYmFscyBkZWZpbmUgKi9cbjsoZnVuY3Rpb24oZGVmaW5lKXsndXNlIHN0cmljdCc7ZGVmaW5lKGZ1bmN0aW9uKHJlcXVpcmUsZXhwb3J0cyxtb2R1bGUpe1xuLyoqXG4gKiBMb2NhbHNcbiAqL1xudmFyIHRleHRDb250ZW50ID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihOb2RlLnByb3RvdHlwZSxcbiAgICAndGV4dENvbnRlbnQnKTtcbnZhciBpbm5lckhUTUwgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKEVsZW1lbnQucHJvdG90eXBlLCAnaW5uZXJIVE1MJyk7XG52YXIgcmVtb3ZlQXR0cmlidXRlID0gRWxlbWVudC5wcm90b3R5cGUucmVtb3ZlQXR0cmlidXRlO1xudmFyIHNldEF0dHJpYnV0ZSA9IEVsZW1lbnQucHJvdG90eXBlLnNldEF0dHJpYnV0ZTtcbnZhciBub29wICA9IGZ1bmN0aW9uKCkge307XG5cbi8qKlxuICogUmVnaXN0ZXIgYSBuZXcgY29tcG9uZW50LlxuICpcbiAqIEBwYXJhbSAge1N0cmluZ30gbmFtZVxuICogQHBhcmFtICB7T2JqZWN0fSBwcm9wc1xuICogQHJldHVybiB7Y29uc3RydWN0b3J9XG4gKiBAcHVibGljXG4gKi9cbmV4cG9ydHMucmVnaXN0ZXIgPSBmdW5jdGlvbihuYW1lLCBwcm9wcykge1xuICB2YXIgYmFzZVByb3RvID0gZ2V0QmFzZVByb3RvKHByb3BzLmV4dGVuZHMpO1xuICB2YXIgdGVtcGxhdGUgPSBwcm9wcy50ZW1wbGF0ZSB8fCBiYXNlUHJvdG8udGVtcGxhdGVTdHJpbmc7XG5cbiAgLy8gQ29tcG9uZW50cyBhcmUgZXh0ZW5zaWJsZSBieSBkZWZhdWx0IGJ1dCBjYW4gYmUgZGVjbGFyZWRcbiAgLy8gYXMgbm9uIGV4dGVuc2libGUgYXMgYW4gb3B0aW1pemF0aW9uIHRvIGF2b2lkXG4gIC8vIHN0b3JpbmcgdGhlIHRlbXBsYXRlIHN0cmluZ3NcbiAgdmFyIGV4dGVuc2libGUgPSBwcm9wcy5leHRlbnNpYmxlID0gcHJvcHMuaGFzT3duUHJvcGVydHkoJ2V4dGVuc2libGUnKT9cbiAgICBwcm9wcy5leHRlbnNpYmxlIDogdHJ1ZTtcblxuICAvLyBDbGVhbiB1cFxuICBkZWxldGUgcHJvcHMuZXh0ZW5kcztcblxuICAvLyBQdWxsIG91dCBDU1MgdGhhdCBuZWVkcyB0byBiZSBpbiB0aGUgbGlnaHQtZG9tXG4gIGlmICh0ZW1wbGF0ZSkge1xuICAgIC8vIFN0b3JlcyB0aGUgc3RyaW5nIHRvIGJlIHJlcHJvY2Vzc2VkIHdoZW5cbiAgICAvLyBhIG5ldyBjb21wb25lbnQgZXh0ZW5kcyB0aGlzIG9uZVxuICAgIGlmIChleHRlbnNpYmxlICYmIHByb3BzLnRlbXBsYXRlKSB7XG4gICAgICBwcm9wcy50ZW1wbGF0ZVN0cmluZyA9IHByb3BzLnRlbXBsYXRlO1xuICAgIH1cblxuICAgIHZhciBvdXRwdXQgPSBwcm9jZXNzQ3NzKHRlbXBsYXRlLCBuYW1lKTtcblxuICAgIHByb3BzLnRlbXBsYXRlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGVtcGxhdGUnKTtcbiAgICBwcm9wcy50ZW1wbGF0ZS5pbm5lckhUTUwgPSBvdXRwdXQudGVtcGxhdGU7XG4gICAgcHJvcHMubGlnaHRDc3MgPSBvdXRwdXQubGlnaHRDc3M7XG5cbiAgICBwcm9wcy5nbG9iYWxDc3MgPSBwcm9wcy5nbG9iYWxDc3MgfHwgJyc7XG4gICAgcHJvcHMuZ2xvYmFsQ3NzICs9IG91dHB1dC5nbG9iYWxDc3M7XG4gIH1cblxuICAvLyBJbmplY3QgZ2xvYmFsIENTUyBpbnRvIHRoZSBkb2N1bWVudCxcbiAgLy8gYW5kIGRlbGV0ZSBhcyBubyBsb25nZXIgbmVlZGVkXG4gIGluamVjdEdsb2JhbENzcyhwcm9wcy5nbG9iYWxDc3MpO1xuICBkZWxldGUgcHJvcHMuZ2xvYmFsQ3NzO1xuXG4gIC8vIE1lcmdlIGJhc2UgZ2V0dGVyL3NldHRlciBhdHRyaWJ1dGVzIHdpdGggdGhlIHVzZXIncyxcbiAgLy8gdGhlbiBkZWZpbmUgdGhlIHByb3BlcnR5IGRlc2NyaXB0b3JzIG9uIHRoZSBwcm90b3R5cGUuXG4gIHZhciBkZXNjcmlwdG9ycyA9IG1peGluKHByb3BzLmF0dHJzIHx8IHt9LCBiYXNlLmRlc2NyaXB0b3JzKTtcblxuICAvLyBTdG9yZSB0aGUgb3JnaW5hbCBkZXNjcmlwdG9ycyBzb21ld2hlcmVcbiAgLy8gYSBsaXR0bGUgbW9yZSBwcml2YXRlIGFuZCBkZWxldGUgdGhlIG9yaWdpbmFsXG4gIHByb3BzLl9hdHRycyA9IHByb3BzLmF0dHJzO1xuICBkZWxldGUgcHJvcHMuYXR0cnM7XG5cbiAgLy8gQ3JlYXRlIHRoZSBwcm90b3R5cGUsIGV4dGVuZGVkIGZyb20gYmFzZSBhbmRcbiAgLy8gZGVmaW5lIHRoZSBkZXNjcmlwdG9ycyBkaXJlY3RseSBvbiB0aGUgcHJvdG90eXBlXG4gIHZhciBwcm90byA9IGNyZWF0ZVByb3RvKGJhc2VQcm90bywgcHJvcHMpO1xuICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyhwcm90bywgZGVzY3JpcHRvcnMpO1xuXG4gIC8vIFJlZ2lzdGVyIHRoZSBjdXN0b20tZWxlbWVudCBhbmQgcmV0dXJuIHRoZSBjb25zdHJ1Y3RvclxuICB0cnkge1xuICAgIHJldHVybiBkb2N1bWVudC5yZWdpc3RlckVsZW1lbnQobmFtZSwgeyBwcm90b3R5cGU6IHByb3RvIH0pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKGUubmFtZSAhPT0gJ05vdFN1cHBvcnRlZEVycm9yJykge1xuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH1cbn07XG5cbnZhciBiYXNlID0ge1xuICBwcm9wZXJ0aWVzOiB7XG4gICAgR2FpYUNvbXBvbmVudDogdHJ1ZSxcbiAgICBhdHRyaWJ1dGVDaGFuZ2VkOiBub29wLFxuICAgIGF0dGFjaGVkOiBub29wLFxuICAgIGRldGFjaGVkOiBub29wLFxuICAgIGNyZWF0ZWQ6IG5vb3AsXG5cbiAgICBjcmVhdGVkQ2FsbGJhY2s6IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKHRoaXMucnRsKSB7IGFkZERpck9ic2VydmVyKCk7IH1cbiAgICAgIGluamVjdExpZ2h0Q3NzKHRoaXMpO1xuICAgICAgdGhpcy5jcmVhdGVkKCk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIEl0IGlzIHZlcnkgY29tbW9uIHRvIHdhbnQgdG8ga2VlcCBvYmplY3RcbiAgICAgKiBwcm9wZXJ0aWVzIGluLXN5bmMgd2l0aCBhdHRyaWJ1dGVzLFxuICAgICAqIGZvciBleGFtcGxlOlxuICAgICAqXG4gICAgICogICBlbC52YWx1ZSA9ICdmb28nO1xuICAgICAqICAgZWwuc2V0QXR0cmlidXRlKCd2YWx1ZScsICdmb28nKTtcbiAgICAgKlxuICAgICAqIFNvIHdlIHN1cHBvcnQgYW4gb2JqZWN0IG9uIHRoZSBwcm90b3R5cGVcbiAgICAgKiBuYW1lZCAnYXR0cnMnIHRvIHByb3ZpZGUgYSBjb25zaXN0ZW50XG4gICAgICogd2F5IGZvciBjb21wb25lbnQgYXV0aG9ycyB0byBkZWZpbmVcbiAgICAgKiB0aGVzZSBwcm9wZXJ0aWVzLiBXaGVuIGFuIGF0dHJpYnV0ZVxuICAgICAqIGNoYW5nZXMgd2Uga2VlcCB0aGUgYXR0cltuYW1lXVxuICAgICAqIHVwLXRvLWRhdGUuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gIHtTdHJpbmd9IG5hbWVcbiAgICAgKiBAcGFyYW0gIHtTdHJpbmd8fG51bGx9IGZyb21cbiAgICAgKiBAcGFyYW0gIHtTdHJpbmd8fG51bGx9IHRvXG4gICAgICovXG4gICAgYXR0cmlidXRlQ2hhbmdlZENhbGxiYWNrOiBmdW5jdGlvbihuYW1lLCBmcm9tLCB0bykge1xuICAgICAgdmFyIHByb3AgPSB0b0NhbWVsQ2FzZShuYW1lKTtcbiAgICAgIGlmICh0aGlzLl9hdHRycyAmJiB0aGlzLl9hdHRyc1twcm9wXSkgeyB0aGlzW3Byb3BdID0gdG87IH1cbiAgICAgIHRoaXMuYXR0cmlidXRlQ2hhbmdlZChuYW1lLCBmcm9tLCB0byk7XG4gICAgfSxcblxuICAgIGF0dGFjaGVkQ2FsbGJhY2s6IGZ1bmN0aW9uKCkgeyB0aGlzLmF0dGFjaGVkKCk7IH0sXG4gICAgZGV0YWNoZWRDYWxsYmFjazogZnVuY3Rpb24oKSB7IHRoaXMuZGV0YWNoZWQoKTsgfSxcblxuICAgIC8qKlxuICAgICAqIEEgY29udmVuaWVudCBtZXRob2QgZm9yIHNldHRpbmcgdXBcbiAgICAgKiBhIHNoYWRvdy1yb290IHVzaW5nIHRoZSBkZWZpbmVkIHRlbXBsYXRlLlxuICAgICAqXG4gICAgICogQHJldHVybiB7U2hhZG93Um9vdH1cbiAgICAgKi9cbiAgICBzZXR1cFNoYWRvd1Jvb3Q6IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKCF0aGlzLnRlbXBsYXRlKSB7IHJldHVybjsgfVxuICAgICAgdmFyIG5vZGUgPSBkb2N1bWVudC5pbXBvcnROb2RlKHRoaXMudGVtcGxhdGUuY29udGVudCwgdHJ1ZSk7XG4gICAgICB0aGlzLmNyZWF0ZVNoYWRvd1Jvb3QoKS5hcHBlbmRDaGlsZChub2RlKTtcbiAgICAgIHJldHVybiB0aGlzLnNoYWRvd1Jvb3Q7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFNldHMgYW4gYXR0cmlidXRlIGludGVybmFsbHlcbiAgICAgKiBhbmQgZXh0ZXJuYWxseS4gVGhpcyBpcyBzbyB0aGF0XG4gICAgICogd2UgY2FuIHN0eWxlIGludGVybmFsIHNoYWRvdy1kb21cbiAgICAgKiBjb250ZW50LlxuICAgICAqXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IG5hbWVcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gdmFsdWVcbiAgICAgKi9cbiAgICBzZXRBdHRyOiBmdW5jdGlvbihuYW1lLCB2YWx1ZSkge1xuICAgICAgdmFyIGludGVybmFsID0gdGhpcy5zaGFkb3dSb290LmZpcnN0RWxlbWVudENoaWxkO1xuICAgICAgc2V0QXR0cmlidXRlLmNhbGwoaW50ZXJuYWwsIG5hbWUsIHZhbHVlKTtcbiAgICAgIHNldEF0dHJpYnV0ZS5jYWxsKHRoaXMsIG5hbWUsIHZhbHVlKTtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogUmVtb3ZlcyBhbiBhdHRyaWJ1dGUgaW50ZXJuYWxseVxuICAgICAqIGFuZCBleHRlcm5hbGx5LiBUaGlzIGlzIHNvIHRoYXRcbiAgICAgKiB3ZSBjYW4gc3R5bGUgaW50ZXJuYWwgc2hhZG93LWRvbVxuICAgICAqIGNvbnRlbnQuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gbmFtZVxuICAgICAqIEBwYXJhbSB7U3RyaW5nfSB2YWx1ZVxuICAgICAqL1xuICAgIHJlbW92ZUF0dHI6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICAgIHZhciBpbnRlcm5hbCA9IHRoaXMuc2hhZG93Um9vdC5maXJzdEVsZW1lbnRDaGlsZDtcbiAgICAgIHJlbW92ZUF0dHJpYnV0ZS5jYWxsKGludGVybmFsLCBuYW1lKTtcbiAgICAgIHJlbW92ZUF0dHJpYnV0ZS5jYWxsKHRoaXMsIG5hbWUpO1xuICAgIH1cbiAgfSxcblxuICBkZXNjcmlwdG9yczoge1xuICAgIHRleHRDb250ZW50OiB7XG4gICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgIHRleHRDb250ZW50LnNldC5jYWxsKHRoaXMsIHZhbHVlKTtcbiAgICAgICAgaWYgKHRoaXMubGlnaHRTdHlsZSkgeyB0aGlzLmFwcGVuZENoaWxkKHRoaXMubGlnaHRTdHlsZSk7IH1cbiAgICAgIH0sXG5cbiAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0ZXh0Q29udGVudC5nZXQoKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgaW5uZXJIVE1MOiB7XG4gICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgIGlubmVySFRNTC5zZXQuY2FsbCh0aGlzLCB2YWx1ZSk7XG4gICAgICAgIGlmICh0aGlzLmxpZ2h0U3R5bGUpIHsgdGhpcy5hcHBlbmRDaGlsZCh0aGlzLmxpZ2h0U3R5bGUpOyB9XG4gICAgICB9LFxuXG4gICAgICBnZXQ6IGlubmVySFRNTC5nZXRcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogVGhlIGRlZmF1bHQgYmFzZSBwcm90b3R5cGUgdG8gdXNlXG4gKiB3aGVuIGBleHRlbmRzYCBpcyB1bmRlZmluZWQuXG4gKlxuICogQHR5cGUge09iamVjdH1cbiAqL1xudmFyIGRlZmF1bHRQcm90b3R5cGUgPSBjcmVhdGVQcm90byhIVE1MRWxlbWVudC5wcm90b3R5cGUsIGJhc2UucHJvcGVydGllcyk7XG5cbi8qKlxuICogUmV0dXJucyBhIHN1aXRhYmxlIHByb3RvdHlwZSBiYXNlZFxuICogb24gdGhlIG9iamVjdCBwYXNzZWQuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSAge0hUTUxFbGVtZW50UHJvdG90eXBlfHVuZGVmaW5lZH0gcHJvdG9cbiAqIEByZXR1cm4ge0hUTUxFbGVtZW50UHJvdG90eXBlfVxuICovXG5mdW5jdGlvbiBnZXRCYXNlUHJvdG8ocHJvdG8pIHtcbiAgaWYgKCFwcm90bykgeyByZXR1cm4gZGVmYXVsdFByb3RvdHlwZTsgfVxuICBwcm90byA9IHByb3RvLnByb3RvdHlwZSB8fCBwcm90bztcbiAgcmV0dXJuICFwcm90by5HYWlhQ29tcG9uZW50ID9cbiAgICBjcmVhdGVQcm90byhwcm90bywgYmFzZS5wcm9wZXJ0aWVzKSA6IHByb3RvO1xufVxuXG4vKipcbiAqIEV4dGVuZHMgdGhlIGdpdmVuIHByb3RvIGFuZCBtaXhlc1xuICogaW4gdGhlIGdpdmVuIHByb3BlcnRpZXMuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSAge09iamVjdH0gcHJvdG9cbiAqIEBwYXJhbSAge09iamVjdH0gcHJvcHNcbiAqIEByZXR1cm4ge09iamVjdH1cbiAqL1xuZnVuY3Rpb24gY3JlYXRlUHJvdG8ocHJvdG8sIHByb3BzKSB7XG4gIHJldHVybiBtaXhpbihPYmplY3QuY3JlYXRlKHByb3RvKSwgcHJvcHMpO1xufVxuXG4vKipcbiAqIERldGVjdHMgcHJlc2VuY2Ugb2Ygc2hhZG93LWRvbVxuICogQ1NTIHNlbGVjdG9ycy5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHJldHVybiB7Qm9vbGVhbn1cbiAqL1xudmFyIGhhc1NoYWRvd0NTUyA9IChmdW5jdGlvbigpIHtcbiAgdmFyIGRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICB0cnkgeyBkaXYucXVlcnlTZWxlY3RvcignOmhvc3QnKTsgcmV0dXJuIHRydWU7IH1cbiAgY2F0Y2ggKGUpIHsgcmV0dXJuIGZhbHNlOyB9XG59KSgpO1xuXG4vKipcbiAqIFJlZ2V4cyB1c2VkIHRvIGV4dHJhY3Qgc2hhZG93LWNzc1xuICpcbiAqIEB0eXBlIHtPYmplY3R9XG4gKi9cbnZhciByZWdleCA9IHtcbiAgc2hhZG93Q3NzOiAvKD86XFw6aG9zdHxcXDpcXDpjb250ZW50KVtee10qXFx7W159XSpcXH0vZyxcbiAgJzpob3N0JzogLyg/OlxcOmhvc3QpL2csXG4gICc6aG9zdCgpJzogL1xcOmhvc3RcXCgoLispXFwpKD86IFxcOlxcOmNvbnRlbnQpPy9nLFxuICAnOmhvc3QtY29udGV4dCc6IC9cXDpob3N0LWNvbnRleHRcXCgoLispXFwpKFteeyxdKyk/L2csXG4gICc6OmNvbnRlbnQnOiAvKD86XFw6XFw6Y29udGVudCkvZ1xufTtcblxuLyoqXG4gKiBFeHRyYWN0cyB0aGUgOmhvc3QgYW5kIDo6Y29udGVudCBydWxlc1xuICogZnJvbSB0aGUgc2hhZG93LWRvbSBDU1MgYW5kIHJld3JpdGVzXG4gKiB0aGVtIHRvIHdvcmsgZnJvbSB0aGUgPHN0eWxlIHNjb3BlZD5cbiAqIGluamVjdGVkIGF0IHRoZSByb290IG9mIHRoZSBjb21wb25lbnQuXG4gKlxuICogQHByaXZhdGVcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqL1xuZnVuY3Rpb24gcHJvY2Vzc0Nzcyh0ZW1wbGF0ZSwgbmFtZSkge1xuICB2YXIgZ2xvYmFsQ3NzID0gJyc7XG4gIHZhciBsaWdodENzcyA9ICcnO1xuXG4gIGlmICghaGFzU2hhZG93Q1NTKSB7XG4gICAgdGVtcGxhdGUgPSB0ZW1wbGF0ZS5yZXBsYWNlKHJlZ2V4LnNoYWRvd0NzcywgZnVuY3Rpb24obWF0Y2gpIHtcbiAgICAgIHZhciBob3N0Q29udGV4dCA9IHJlZ2V4Wyc6aG9zdC1jb250ZXh0J10uZXhlYyhtYXRjaCk7XG5cbiAgICAgIGlmIChob3N0Q29udGV4dCkge1xuICAgICAgICBnbG9iYWxDc3MgKz0gbWF0Y2hcbiAgICAgICAgICAucmVwbGFjZShyZWdleFsnOjpjb250ZW50J10sICcnKVxuICAgICAgICAgIC5yZXBsYWNlKHJlZ2V4Wyc6aG9zdC1jb250ZXh0J10sICckMSAnICsgbmFtZSArICckMicpXG4gICAgICAgICAgLnJlcGxhY2UoLyArL2csICcgJyk7IC8vIGV4Y2VzcyB3aGl0ZXNwYWNlXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsaWdodENzcyArPSBtYXRjaFxuICAgICAgICAgIC5yZXBsYWNlKHJlZ2V4Wyc6aG9zdCgpJ10sIG5hbWUgKyAnJDEnKVxuICAgICAgICAgIC5yZXBsYWNlKHJlZ2V4Wyc6aG9zdCddLCBuYW1lKVxuICAgICAgICAgIC5yZXBsYWNlKHJlZ2V4Wyc6OmNvbnRlbnQnXSwgbmFtZSk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiAnJztcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgdGVtcGxhdGU6IHRlbXBsYXRlLFxuICAgIGxpZ2h0Q3NzOiBsaWdodENzcyxcbiAgICBnbG9iYWxDc3M6IGdsb2JhbENzc1xuICB9O1xufVxuXG4vKipcbiAqIFNvbWUgQ1NTIHJ1bGVzLCBzdWNoIGFzIEBrZXlmcmFtZXNcbiAqIGFuZCBAZm9udC1mYWNlIGRvbid0IHdvcmsgaW5zaWRlXG4gKiBzY29wZWQgb3Igc2hhZG93IDxzdHlsZT4uIFNvIHdlXG4gKiBoYXZlIHRvIHB1dCB0aGVtIGludG8gJ2dsb2JhbCdcbiAqIDxzdHlsZT4gaW4gdGhlIGhlYWQgb2YgdGhlXG4gKiBkb2N1bWVudC5cbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtICB7U3RyaW5nfSBjc3NcbiAqL1xuZnVuY3Rpb24gaW5qZWN0R2xvYmFsQ3NzKGNzcykge1xuICBpZiAoIWNzcykge3JldHVybjt9XG4gIHZhciBzdHlsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJyk7XG4gIHN0eWxlLmlubmVySFRNTCA9IGNzcy50cmltKCk7XG4gIGhlYWRSZWFkeSgpLnRoZW4oZnVuY3Rpb24oKSB7XG4gICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzdHlsZSk7XG4gIH0pO1xufVxuXG5cbi8qKlxuICogUmVzb2x2ZXMgYSBwcm9taXNlIG9uY2UgZG9jdW1lbnQuaGVhZCBpcyByZWFkeS5cbiAqXG4gKiBAcHJpdmF0ZVxuICovXG5mdW5jdGlvbiBoZWFkUmVhZHkoKSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlKSB7XG4gICAgaWYgKGRvY3VtZW50LmhlYWQpIHsgcmV0dXJuIHJlc29sdmUoKTsgfVxuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdsb2FkJywgZnVuY3Rpb24gZm4oKSB7XG4gICAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcignbG9hZCcsIGZuKTtcbiAgICAgIHJlc29sdmUoKTtcbiAgICB9KTtcbiAgfSk7XG59XG5cblxuLyoqXG4gKiBUaGUgR2Vja28gcGxhdGZvcm0gZG9lc24ndCB5ZXQgaGF2ZVxuICogYDo6Y29udGVudGAgb3IgYDpob3N0YCwgc2VsZWN0b3JzLFxuICogd2l0aG91dCB0aGVzZSB3ZSBhcmUgdW5hYmxlIHRvIHN0eWxlXG4gKiB1c2VyLWNvbnRlbnQgaW4gdGhlIGxpZ2h0LWRvbSBmcm9tXG4gKiB3aXRoaW4gb3VyIHNoYWRvdy1kb20gc3R5bGUtc2hlZXQuXG4gKlxuICogVG8gd29ya2Fyb3VuZCB0aGlzLCB3ZSBjbG9uZSB0aGUgPHN0eWxlPlxuICogbm9kZSBpbnRvIHRoZSByb290IG9mIHRoZSBjb21wb25lbnQsXG4gKiBzbyBvdXIgc2VsZWN0b3JzIGFyZSBhYmxlIHRvIHRhcmdldFxuICogbGlnaHQtZG9tIGNvbnRlbnQuXG4gKlxuICogQHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gaW5qZWN0TGlnaHRDc3MoZWwpIHtcbiAgaWYgKGhhc1NoYWRvd0NTUykgeyByZXR1cm47IH1cbiAgZWwubGlnaHRTdHlsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJyk7XG4gIGVsLmxpZ2h0U3R5bGUuc2V0QXR0cmlidXRlKCdzY29wZWQnLCAnJyk7XG4gIGVsLmxpZ2h0U3R5bGUuaW5uZXJIVE1MID0gZWwubGlnaHRDc3M7XG4gIGVsLmFwcGVuZENoaWxkKGVsLmxpZ2h0U3R5bGUpO1xufVxuXG4vKipcbiAqIENvbnZlcnQgaHlwaGVuIHNlcGFyYXRlZFxuICogc3RyaW5nIHRvIGNhbWVsLWNhc2UuXG4gKlxuICogRXhhbXBsZTpcbiAqXG4gKiAgIHRvQ2FtZWxDYXNlKCdmb28tYmFyJyk7IC8vPT4gJ2Zvb0JhcidcbiAqXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtICB7U3Jpbmd9IHN0cmluZ1xuICogQHJldHVybiB7U3RyaW5nfVxuICovXG5mdW5jdGlvbiB0b0NhbWVsQ2FzZShzdHJpbmcpIHtcbiAgcmV0dXJuIHN0cmluZy5yZXBsYWNlKC8tKC4pL2csIGZ1bmN0aW9uIHJlcGxhY2VyKHN0cmluZywgcDEpIHtcbiAgICByZXR1cm4gcDEudG9VcHBlckNhc2UoKTtcbiAgfSk7XG59XG5cbi8qKlxuICogT2JzZXJ2ZXIgKHNpbmdsZXRvbilcbiAqXG4gKiBAdHlwZSB7TXV0YXRpb25PYnNlcnZlcnx1bmRlZmluZWR9XG4gKi9cbnZhciBkaXJPYnNlcnZlcjtcblxuLyoqXG4gKiBPYnNlcnZlcyB0aGUgZG9jdW1lbnQgYGRpcmAgKGRpcmVjdGlvbilcbiAqIGF0dHJpYnV0ZSBhbmQgZGlzcGF0Y2hlcyBhIGdsb2JhbCBldmVudFxuICogd2hlbiBpdCBjaGFuZ2VzLlxuICpcbiAqIENvbXBvbmVudHMgY2FuIGxpc3RlbiB0byB0aGlzIGV2ZW50IGFuZFxuICogbWFrZSBpbnRlcm5hbCBjaGFuZ2VzIGlmIG5lZWQgYmUuXG4gKlxuICogQHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gYWRkRGlyT2JzZXJ2ZXIoKSB7XG4gIGlmIChkaXJPYnNlcnZlcikgeyByZXR1cm47IH1cblxuICBkaXJPYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKG9uQ2hhbmdlZCk7XG4gIGRpck9ic2VydmVyLm9ic2VydmUoZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LCB7XG4gICAgYXR0cmlidXRlRmlsdGVyOiBbJ2RpciddLFxuICAgIGF0dHJpYnV0ZXM6IHRydWVcbiAgfSk7XG5cbiAgZnVuY3Rpb24gb25DaGFuZ2VkKG11dGF0aW9ucykge1xuICAgIGRvY3VtZW50LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCdkaXJjaGFuZ2VkJykpO1xuICB9XG59XG5cbi8qKlxuICogQ29weSB0aGUgdmFsdWVzIG9mIGFsbCBwcm9wZXJ0aWVzIGZyb21cbiAqIHNvdXJjZSBvYmplY3QgYHRhcmdldGAgdG8gYSB0YXJnZXQgb2JqZWN0IGBzb3VyY2VgLlxuICogSXQgd2lsbCByZXR1cm4gdGhlIHRhcmdldCBvYmplY3QuXG4gKlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSAgIHtPYmplY3R9IHRhcmdldFxuICogQHBhcmFtICAge09iamVjdH0gc291cmNlXG4gKiBAcmV0dXJucyB7T2JqZWN0fVxuICovXG5mdW5jdGlvbiBtaXhpbih0YXJnZXQsIHNvdXJjZSkge1xuICBmb3IgKHZhciBrZXkgaW4gc291cmNlKSB7XG4gICAgdGFyZ2V0W2tleV0gPSBzb3VyY2Vba2V5XTtcbiAgfVxuICByZXR1cm4gdGFyZ2V0O1xufVxuXG59KTt9KSh0eXBlb2YgZGVmaW5lPT0nZnVuY3Rpb24nJiZkZWZpbmUuYW1kP2RlZmluZVxuOihmdW5jdGlvbihuLHcpeyd1c2Ugc3RyaWN0JztyZXR1cm4gdHlwZW9mIG1vZHVsZT09J29iamVjdCc/ZnVuY3Rpb24oYyl7XG5jKHJlcXVpcmUsZXhwb3J0cyxtb2R1bGUpO306ZnVuY3Rpb24oYyl7dmFyIG09e2V4cG9ydHM6e319O2MoZnVuY3Rpb24obil7XG5yZXR1cm4gd1tuXTt9LG0uZXhwb3J0cyxtKTt3W25dPW0uZXhwb3J0czt9O30pKCdnYWlhLWNvbXBvbmVudCcsdGhpcykpO1xuIiwiLyogZ2xvYmFscyBkZWZpbmUgKi9cbihmdW5jdGlvbihkZWZpbmUpeyd1c2Ugc3RyaWN0JztkZWZpbmUoZnVuY3Rpb24ocmVxdWlyZSxleHBvcnRzLG1vZHVsZSl7XG5cbi8qKlxuICogRGVwZW5kZW5jaWVzXG4gKi9cblxudmFyIGNvbXBvbmVudCA9IHJlcXVpcmUoJ2dhaWEtY29tcG9uZW50Jyk7XG5cbi8qKlxuICogU2ltcGxlIGxvZ2dlclxuICogQHR5cGUge0Z1bmN0aW9ufVxuICovXG52YXIgZGVidWcgPSAwID8gY29uc29sZS5sb2cuYmluZChjb25zb2xlKSA6IGZ1bmN0aW9uKCkge307XG5cbi8qKlxuICogRXhwb3J0c1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gY29tcG9uZW50LnJlZ2lzdGVyKCd2ci1zY2VuZScsIHtcbiAgZXh0ZW5kczogSFRNTERpdkVsZW1lbnQucHJvdG90eXBlLFxuXG4gIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc2V0dXBTaGFkb3dSb290KCk7XG4gICAgdGhpcy5zZXR1cFJlbmRlcmVyKCk7XG4gICAgdGhpcy5zZXR1cFNjZW5lKCk7XG4gICAgdGhpcy5zZXR1cENhbWVyYSgpO1xuICB9LFxuXG4gIGFkZE9iamVjdDogZnVuY3Rpb24oZWwsIHByb3ZpZGVkX29iaikge1xuICAgIHZhciBvYmogPSBlbC5vYmplY3QzRDtcbiAgICB2YXIgb2JqUGFyZW50ID0gZWwucGFyZW50Tm9kZTtcbiAgICBpZiAob2JqICYmIHRoaXMuc2NlbmUuZ2V0T2JqZWN0QnlJZChvYmouaWQpKSB7XG4gICAgICByZXR1cm4gb2JqO1xuICAgIH1cbiAgICBvYmogPSBlbC5vYmplY3QzRCA9IGVsLm9iamVjdDNEIHx8IHByb3ZpZGVkX29iaiB8fCBuZXcgVEhSRUUuT2JqZWN0M0QoKTtcbiAgICBvYmouc2NlbmUgPSB0aGlzO1xuICAgIGlmIChvYmpQYXJlbnQgJiYgb2JqUGFyZW50ICE9PSB0aGlzKSB7XG4gICAgICBvYmpQYXJlbnQgPSB0aGlzLmFkZE9iamVjdChlbC5wYXJlbnROb2RlKTtcbiAgICAgIG9ialBhcmVudC5hZGQob2JqKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5zY2VuZS5hZGQob2JqKTtcbiAgICB9XG4gICAgcmV0dXJuIG9iajtcbiAgfSxcblxuICBlcHNpbG9uOiBmdW5jdGlvbiAoIHZhbHVlICkge1xuICAgIHJldHVybiBNYXRoLmFicyggdmFsdWUgKSA8IDAuMDAwMDAxID8gMCA6IHZhbHVlO1xuICB9LFxuXG4gIGdldENTU01hdHJpeDogZnVuY3Rpb24gKG1hdHJpeCkge1xuICAgIHZhciBlcHNpbG9uID0gdGhpcy5lcHNpbG9uO1xuICAgIHZhciBlbGVtZW50cyA9IG1hdHJpeC5lbGVtZW50cztcblxuICAgIHJldHVybiAnbWF0cml4M2QoJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMCBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDEgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAyIF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMyBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDQgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyA1IF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgNiBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDcgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyA4IF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgOSBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDEwIF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMTEgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAxMiBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDEzIF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMTQgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAxNSBdICkgK1xuICAgICcpJztcbiAgfSxcblxuICBzZXR1cENhbWVyYTogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGZvdiA9IHRoaXMuc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZSgnLS1mb3YnKSB8fCA0NTtcbiAgICB2YXIgdmlld3BvcnQgPSB0aGlzLnNoYWRvd1Jvb3QucXVlcnlTZWxlY3RvcignLnZpZXdwb3J0Jyk7XG5cbiAgICAvLyBET00gY2FtZXJhXG4gICAgdmFyIHBlcnNwZWN0aXZlTWF0cml4ID0gdGhpcy5wZXJzcGVjdGl2ZU1hdHJpeChUSFJFRS5NYXRoLmRlZ1RvUmFkKDQ1KSwgdGhpcy5vZmZzZXRXaWR0aCAvIHRoaXMub2Zmc2V0SGVpZ2h0LCAxLCA1MDAwMCk7XG4gICAgdmFyIHNjYWxlZCA9IHBlcnNwZWN0aXZlTWF0cml4LmNsb25lKCkuc2NhbGUobmV3IFRIUkVFLlZlY3RvcjModGhpcy5vZmZzZXRXaWR0aCwgdGhpcy5vZmZzZXRIZWlnaHQsIDEpKTtcbiAgICB2YXIgc3R5bGUgPSB0aGlzLmdldENTU01hdHJpeChzY2FsZWQpO1xuICAgIHZpZXdwb3J0LnN0eWxlLnRyYW5zZm9ybSA9IHN0eWxlO1xuXG4gICAgLy8gV2ViR0wgY2FtZXJhXG4gICAgdGhpcy5jYW1lcmEgPSBuZXcgVEhSRUUuUGVyc3BlY3RpdmVDYW1lcmEoNDUsIHRoaXMub2Zmc2V0V2lkdGggLyB0aGlzLm9mZnNldEhlaWdodCwgMSwgNTAwMDApO1xuICB9LFxuXG4gIHBlcnNwZWN0aXZlTWF0cml4OiBmdW5jdGlvbihmb3YsIGFzcGVjdCwgbmVhcnosIGZhcnopIHtcbiAgICB2YXIgbWF0cml4ID0gbmV3IFRIUkVFLk1hdHJpeDQoKTtcbiAgICB2YXIgcmFuZ2UgPSBNYXRoLnRhbihmb3YgKiAwLjUpICogbmVhcno7XG5cbiAgICBtYXRyaXguZWxlbWVudHNbMF0gPSAoMiAqIG5lYXJ6KSAvICgocmFuZ2UgKiBhc3BlY3QpIC0gKC1yYW5nZSAqIGFzcGVjdCkpO1xuICAgIG1hdHJpeC5lbGVtZW50c1sxXSA9IDA7XG4gICAgbWF0cml4LmVsZW1lbnRzWzJdID0gMDtcbiAgICBtYXRyaXguZWxlbWVudHNbM10gPSAwO1xuICAgIG1hdHJpeC5lbGVtZW50c1s0XSA9IDA7XG4gICAgbWF0cml4LmVsZW1lbnRzWzVdID0gKDIgKiBuZWFyeikgLyAoMiAqIHJhbmdlKTtcbiAgICBtYXRyaXguZWxlbWVudHNbNl0gPSAwO1xuICAgIG1hdHJpeC5lbGVtZW50c1s3XSA9IDA7XG4gICAgbWF0cml4LmVsZW1lbnRzWzhdID0gMDtcbiAgICBtYXRyaXguZWxlbWVudHNbOV0gPSAwO1xuICAgIG1hdHJpeC5lbGVtZW50c1sxMF0gPSAtKGZhcnogKyBuZWFyeikgLyAoZmFyeiAtIG5lYXJ6KTtcbiAgICBtYXRyaXguZWxlbWVudHNbMTFdID0gLTE7XG4gICAgbWF0cml4LmVsZW1lbnRzWzEyXSA9IDA7XG4gICAgbWF0cml4LmVsZW1lbnRzWzEzXSA9IDA7XG4gICAgbWF0cml4LmVsZW1lbnRzWzE0XSA9IC0oMiAqIGZhcnogKiBuZWFyeikgLyAoZmFyeiAtIG5lYXJ6KTtcbiAgICBtYXRyaXguZWxlbWVudHNbMTVdID0gMDtcbiAgICByZXR1cm4gbWF0cml4LnRyYW5zcG9zZSgpO1xuICB9LFxuXG4gIHNldHVwUmVuZGVyZXI6IGZ1bmN0aW9uKCkge1xuICAgIC8vIEFsbCBXZWJHTCBzZXR1cFxuICAgIHZhciBjYW52YXMgPSB0aGlzLmNhbnZhcyA9IHRoaXMuc2hhZG93Um9vdC5xdWVyeVNlbGVjdG9yKCdjYW52YXMnKTtcblxuICAgIHRoaXMucmVzaXplQ2FudmFzKCk7XG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIHRoaXMucmVzaXplQ2FudmFzLmJpbmQodGhpcyksIGZhbHNlKTtcblxuICAgIHZhciByZW5kZXJlciA9IHRoaXMucmVuZGVyZXIgPSBuZXcgVEhSRUUuV2ViR0xSZW5kZXJlciggeyBjYW52YXM6IGNhbnZhcywgYW50aWFsaWFzOiB0cnVlLCBhbHBoYTogdHJ1ZSB9ICk7XG4gICAgcmVuZGVyZXIuc2V0U2l6ZSggdGhpcy5jYW52YXMud2lkdGgsIHRoaXMuY2FudmFzLmhlaWdodCApO1xuICAgIHJlbmRlcmVyLnNvcnRPYmplY3RzID0gZmFsc2U7XG4gIH0sXG5cbiAgc2V0dXBTY2VuZTogZnVuY3Rpb24oKSB7XG4gICAgLy8vIEFsbCBXZWJHTCBTZXR1cFxuICAgIHZhciBzY2VuZSA9IHRoaXMuc2NlbmUgPSBuZXcgVEhSRUUuU2NlbmUoKTtcbiAgICBjcmVhdGVMaWdodHMoKTtcbiAgICBmdW5jdGlvbiBjcmVhdGVMaWdodHMoKSB7XG4gICAgICB2YXIgZGlyZWN0aW9uYWxMaWdodCA9IG5ldyBUSFJFRS5EaXJlY3Rpb25hbExpZ2h0KDB4ZmZmZmZmKTtcbiAgICAgIGRpcmVjdGlvbmFsTGlnaHQucG9zaXRpb24uc2V0KDEsIDEsIDEpLm5vcm1hbGl6ZSgpO1xuICAgICAgc2NlbmUuYWRkKGRpcmVjdGlvbmFsTGlnaHQpO1xuICAgIH1cbiAgfSxcblxuICB1cGRhdGVDaGlsZHJlbjogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGNoaWxkO1xuICAgIHZhciBpO1xuICAgIGZvciAoaSA9IDA7IGkgPCB0aGlzLmNoaWxkcmVuLmxlbmd0aDsgKytpKSB7XG4gICAgICBjaGlsZCA9IHRoaXMuY2hpbGRyZW5baV07XG4gICAgICBpZiAodHlwZW9mIGNoaWxkLnVwZGF0ZSA9PSAnZnVuY3Rpb24nKSB7IGNoaWxkLnVwZGF0ZSgpOyB9XG4gICAgICBpZiAodHlwZW9mIGNoaWxkLnVwZGF0ZUNoaWxkcmVuID09ICdmdW5jdGlvbicpIHsgY2hpbGQudXBkYXRlQ2hpbGRyZW4oKTsgfVxuICAgIH1cbiAgfSxcblxuICByZXNpemVDYW52YXM6IGZ1bmN0aW9uKHJlbmRlcmVyLCBjYW1lcmEpe1xuICAgIHZhciBjYW52YXMgPSB0aGlzLmNhbnZhcztcbiAgICAvLyBNYWtlIGl0IHZpc3VhbGx5IGZpbGwgdGhlIHBvc2l0aW9uZWQgcGFyZW50XG4gICAgY2FudmFzLnN0eWxlLndpZHRoID0nMTAwJSc7XG4gICAgY2FudmFzLnN0eWxlLmhlaWdodD0nMTAwJSc7XG4gICAgLy8gLi4udGhlbiBzZXQgdGhlIGludGVybmFsIHNpemUgdG8gbWF0Y2hcbiAgICBjYW52YXMud2lkdGggID0gY2FudmFzLm9mZnNldFdpZHRoO1xuICAgIGNhbnZhcy5oZWlnaHQgPSBjYW52YXMub2Zmc2V0SGVpZ2h0O1xuXG4gICAgaWYgKHRoaXMuY2FtZXJhKSB7XG4gICAgICB0aGlzLmNhbWVyYS5hc3BlY3QgPSBjYW52YXMud2lkdGggLyBjYW52YXMuaGVpZ2h0O1xuICAgICAgdGhpcy5jYW1lcmEudXBkYXRlUHJvamVjdGlvbk1hdHJpeCgpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLnJlbmRlcmVyKSB7XG4gICAgICAvLyBub3RpZnkgdGhlIHJlbmRlcmVyIG9mIHRoZSBzaXplIGNoYW5nZVxuICAgICAgdGhpcy5yZW5kZXJlci5zZXRTaXplKCBjYW52YXMud2lkdGgsIGNhbnZhcy5oZWlnaHQgKTtcbiAgICB9XG4gIH0sXG5cbiAgYW5pbWF0ZTogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHRoaXMudXBkYXRlQ2hpbGRyZW4oKTtcbiAgICBzZWxmLnJlbmRlcmVyLnJlbmRlcihzZWxmLnNjZW5lLCBzZWxmLmNhbWVyYSk7XG4gIH0sXG5cbiAgYXR0cmlidXRlQ2hhbmdlZDogZnVuY3Rpb24obmFtZSwgZnJvbSwgdG8pIHtcbiAgICBpZiAobmFtZSA9PT0gXCJhbmdsZVwiKSB7XG4gICAgICB0aGlzLnN0eWxlLnRyYW5zZm9ybSA9ICdyb3RhdGVZKCAnICsgdGhpcy5hbmdsZSArICdkZWcgKSc7XG4gICAgfVxuICB9LFxuXG4gIHRlbXBsYXRlOiBgXG4gICAgPGNhbnZhcyB3aWR0aD1cIjEwMCVcIiBoZWlnaHQ9XCIxMDAlXCI+PC9jYW52YXM+XG4gICAgPGRpdiBjbGFzcz1cInZpZXdwb3J0XCI+XG4gICAgICA8Y29udGVudD48L2NvbnRlbnQ+XG4gICAgPC9kaXY+XG5cbiAgICAgIDxzdHlsZT5cbiAgICA6aG9zdCB7XG4gICAgICBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7XG4gICAgICB3aWR0aDogMTAwJTtcbiAgICAgIGhlaWdodDogMTAwdmg7XG4gICAgfVxuXG4gICAgLnZpZXdwb3J0IHtcbiAgICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcbiAgICAgIGJveC1zaXppbmc6IGJvcmRlci1ib3g7XG4gICAgICB0cmFuc2Zvcm0tc3R5bGU6IHByZXNlcnZlLTNkO1xuICAgICAgd2lkdGg6IDEwMCU7XG4gICAgICBoZWlnaHQ6IDEwMHZoO1xuICAgIH1cblxuICAgIGNhbnZhcyB7XG4gICAgICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gICAgICB0cmFuc2Zvcm0tc3R5bGU6IHByZXNlcnZlLTNkO1xuICAgICAgd2lkdGg6IDEwMCU7XG4gICAgICBoZWlnaHQ6IDEwMHZoO1xuICAgIH1cbiAgICA8L3N0eWxlPmBcbn0pO1xuXG59KTt9KSh0eXBlb2YgZGVmaW5lPT0nZnVuY3Rpb24nJiZkZWZpbmUuYW1kP2RlZmluZVxuOihmdW5jdGlvbihuLHcpeyd1c2Ugc3RyaWN0JztyZXR1cm4gdHlwZW9mIG1vZHVsZT09J29iamVjdCc/ZnVuY3Rpb24oYyl7XG5jKHJlcXVpcmUsZXhwb3J0cyxtb2R1bGUpO306ZnVuY3Rpb24oYyl7dmFyIG09e2V4cG9ydHM6e319O2MoZnVuY3Rpb24obil7XG5yZXR1cm4gd1tuXTt9LG0uZXhwb3J0cyxtKTt3W25dPW0uZXhwb3J0czt9O30pKCdWUlNDZW5lJyx0aGlzKSk7XG4iLCIvKiBnbG9iYWxzIGRlZmluZSAqL1xuKGZ1bmN0aW9uKGRlZmluZSl7J3VzZSBzdHJpY3QnO2RlZmluZShmdW5jdGlvbihyZXF1aXJlLGV4cG9ydHMsbW9kdWxlKXtcblxuLyoqXG4gKiBEZXBlbmRlbmNpZXNcbiAqL1xuXG52YXIgY29tcG9uZW50ID0gcmVxdWlyZSgnZ2FpYS1jb21wb25lbnQnKTtcblxuLyoqXG4gKiBTaW1wbGUgbG9nZ2VyXG4gKiBAdHlwZSB7RnVuY3Rpb259XG4gKi9cbnZhciBkZWJ1ZyA9IDAgPyBjb25zb2xlLmxvZy5iaW5kKGNvbnNvbGUpIDogZnVuY3Rpb24oKSB7fTtcblxuLyoqXG4gKiBFeHBvcnRzXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBjb21wb25lbnQucmVnaXN0ZXIoJ3ZyLW9iamVjdCcsIHtcbiAgZXh0ZW5kczogSFRNTERpdkVsZW1lbnQucHJvdG90eXBlLFxuXG4gIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc2V0dXBTaGFkb3dSb290KCk7XG4gICAgdGhpcy5maW5kU2NlbmUoKTtcbiAgICB0aGlzLnNjZW5lLmFkZE9iamVjdCh0aGlzKTtcbiAgICB0aGlzLnVwZGF0ZVRyYW5zZm9ybSgpO1xuICB9LFxuXG4gIGF0dHJpYnV0ZUNoYW5nZWQ6IGZ1bmN0aW9uKG5hbWUsIGZyb20sIHRvKSB7XG4gICAgdGhpcy51cGRhdGVUcmFuc2Zvcm0oKTtcbiAgfSxcblxuICBlcHNpbG9uOiBmdW5jdGlvbiAoIHZhbHVlICkge1xuICAgIHJldHVybiBNYXRoLmFicyggdmFsdWUgKSA8IDAuMDAwMDAxID8gMCA6IHZhbHVlO1xuICB9LFxuXG4gIHVwZGF0ZTogZnVuY3Rpb24oKSB7IC8qIE5PT1AgKi8gfSxcblxuICB1cGRhdGVDaGlsZHJlbjogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGNoaWxkO1xuICAgIHZhciBpO1xuICAgIGZvciAoaSA9IDA7IGkgPCB0aGlzLmNoaWxkcmVuLmxlbmd0aDsgKytpKSB7XG4gICAgICBjaGlsZCA9IHRoaXMuY2hpbGRyZW5baV07XG4gICAgICBpZiAodHlwZW9mIGNoaWxkLnVwZGF0ZSA9PSAnZnVuY3Rpb24nKSB7IGNoaWxkLnVwZGF0ZSgpOyB9XG4gICAgICBpZiAodHlwZW9mIGNoaWxkLnVwZGF0ZUNoaWxkcmVuID09ICdmdW5jdGlvbicpIHsgY2hpbGQudXBkYXRlQ2hpbGRyZW4oKTsgfVxuICAgIH1cbiAgfSxcblxuICBnZXRDU1NNYXRyaXg6IGZ1bmN0aW9uIChtYXRyaXgpIHtcbiAgICB2YXIgZXBzaWxvbiA9IHRoaXMuZXBzaWxvbjtcbiAgICB2YXIgZWxlbWVudHMgPSBtYXRyaXguZWxlbWVudHM7XG5cbiAgICByZXR1cm4gJ21hdHJpeDNkKCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDAgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAxIF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMiBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDMgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyA0IF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgNSBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDYgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyA3IF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgOCBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDkgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAxMCBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDExIF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMTIgXSApICsgJywnICtcbiAgICAgIGVwc2lsb24oIGVsZW1lbnRzWyAxMyBdICkgKyAnLCcgK1xuICAgICAgZXBzaWxvbiggZWxlbWVudHNbIDE0IF0gKSArICcsJyArXG4gICAgICBlcHNpbG9uKCBlbGVtZW50c1sgMTUgXSApICtcbiAgICAnKSc7XG4gIH0sXG5cbiAgdXBkYXRlVHJhbnNmb3JtOiBmdW5jdGlvbigpIHtcbiAgICAvLyBQb3NpdGlvblxuICAgIHZhciB4ID0gdGhpcy5zdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKCctLXgnKSB8fCAwO1xuICAgIHZhciB5ID0gdGhpcy5zdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKCctLXknKSB8fCAwO1xuICAgIHZhciB6ID0gdGhpcy5zdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKCctLXonKSB8fCAwO1xuICAgIHZhciB0cmFuc2xhdGlvbiA9IG5ldyBUSFJFRS5NYXRyaXg0KCkubWFrZVRyYW5zbGF0aW9uKHgsIHksIC16KTtcblxuICAgIC8vIE9yaWVudGF0aW9uXG4gICAgdmFyIG9yaWVudGF0aW9uWCA9IHRoaXMuc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZSgnLS1yb3RYJykgfHwgMDtcbiAgICB2YXIgb3JpZW50YXRpb25ZID0gdGhpcy5zdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKCctLXJvdFknKSB8fCAwO1xuICAgIHZhciBvcmllbnRhdGlvblogPSB0aGlzLnN0eWxlLmdldFByb3BlcnR5VmFsdWUoJy0tcm90WicpIHx8IDA7XG5cbiAgICB2YXIgcm90WCA9IFRIUkVFLk1hdGguZGVnVG9SYWQob3JpZW50YXRpb25YKTtcbiAgICB2YXIgcm90WSA9IFRIUkVFLk1hdGguZGVnVG9SYWQob3JpZW50YXRpb25ZKTtcbiAgICB2YXIgcm90WiA9IFRIUkVFLk1hdGguZGVnVG9SYWQob3JpZW50YXRpb25aKTtcbiAgICB2YXIgcm90YXRpb25YID0gbmV3IFRIUkVFLk1hdHJpeDQoKS5tYWtlUm90YXRpb25YKHJvdFgpO1xuICAgIHZhciByb3RhdGlvblkgPSBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VSb3RhdGlvblkocm90WSk7XG4gICAgdmFyIHJvdGF0aW9uWiA9IG5ldyBUSFJFRS5NYXRyaXg0KCkubWFrZVJvdGF0aW9uWChyb3RaKTtcblxuICAgIHRoaXMuc3R5bGUudHJhbnNmb3JtID0gJ3RyYW5zbGF0ZTNkKC01MCUsIC01MCUsIDApICcgKyB0aGlzLmdldENTU01hdHJpeCh0cmFuc2xhdGlvbi5tdWx0aXBseShyb3RhdGlvbloubXVsdGlwbHkocm90YXRpb25ZLm11bHRpcGx5KHJvdGF0aW9uWCkpKSk7XG4gICAgdGhpcy5vYmplY3QzRC5wb3NpdGlvbi5zZXQoeCwgLXksIC16KTtcbiAgICB0aGlzLm9iamVjdDNELnJvdGF0aW9uLm9yZGVyID0gJ1lYWic7XG4gICAgdGhpcy5vYmplY3QzRC5yb3RhdGlvbi5zZXQoLXJvdFgsIHJvdFksIHJvdFopO1xuICB9LFxuXG4gIGZpbmRTY2VuZTogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNjZW5lcyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJ3ZyLXNjZW5lJyk7XG4gICAgdmFyIHBlcnNwZWN0aXZlO1xuICAgIGZvciAodmFyIGk9MDsgaSA8IHNjZW5lcy5sZW5ndGg7ICsraSkge1xuICAgICAgdGhpcy5zY2VuZSA9IHNjZW5lc1tpXTtcbiAgICB9XG4gIH0sXG5cbiAgdGVtcGxhdGU6IGBcbiAgICA8Y29udGVudD48L2NvbnRlbnQ+XG4gICAgPHN0eWxlPlxuICAgIDpob3N0IHtcbiAgICAgIGxlZnQ6IDUwJTtcbiAgICAgIHRvcDogNTAlO1xuICAgICAgcG9zaXRpb246IGFic29sdXRlO1xuICAgICAgdHJhbnNmb3JtLXN0eWxlOiBwcmVzZXJ2ZS0zZDtcbiAgICB9XG4gICAgPC9zdHlsZT5cbiAgYFxufSk7XG5cbn0pO30pKHR5cGVvZiBkZWZpbmU9PSdmdW5jdGlvbicmJmRlZmluZS5hbWQ/ZGVmaW5lXG46KGZ1bmN0aW9uKG4sdyl7J3VzZSBzdHJpY3QnO3JldHVybiB0eXBlb2YgbW9kdWxlPT0nb2JqZWN0Jz9mdW5jdGlvbihjKXtcbmMocmVxdWlyZSxleHBvcnRzLG1vZHVsZSk7fTpmdW5jdGlvbihjKXt2YXIgbT17ZXhwb3J0czp7fX07YyhmdW5jdGlvbihuKXtcbnJldHVybiB3W25dO30sbS5leHBvcnRzLG0pO3dbbl09bS5leHBvcnRzO307fSkoJ1ZST2JqZWN0Jyx0aGlzKSk7XG4iLCIvKiBnbG9iYWxzIGRlZmluZSAqL1xuKGZ1bmN0aW9uKGRlZmluZSl7J3VzZSBzdHJpY3QnO2RlZmluZShmdW5jdGlvbihyZXF1aXJlLGV4cG9ydHMsbW9kdWxlKXtcblxuLyoqXG4gKiBEZXBlbmRlbmNpZXNcbiAqL1xuXG52YXIgY29tcG9uZW50ID0gcmVxdWlyZSgnZ2FpYS1jb21wb25lbnQnKTtcblxuLyoqXG4gKiBTaW1wbGUgbG9nZ2VyXG4gKiBAdHlwZSB7RnVuY3Rpb259XG4gKi9cbnZhciBkZWJ1ZyA9IDAgPyBjb25zb2xlLmxvZy5iaW5kKGNvbnNvbGUpIDogZnVuY3Rpb24oKSB7fTtcblxuLyoqXG4gKiBFeHBvcnRzXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBjb21wb25lbnQucmVnaXN0ZXIoJ3ZyLWNhbWVyYScsIHtcbiAgZXh0ZW5kczogVlJPYmplY3QucHJvdG90eXBlLFxuXG4gIHVwZGF0ZVRyYW5zZm9ybTogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGVsU3R5bGVzID0gd2luZG93LmdldENvbXB1dGVkU3R5bGUodGhpcyk7XG4gICAgLy8gUG9zaXRpb25cbiAgICB2YXIgeCA9IGVsU3R5bGVzLmdldFByb3BlcnR5VmFsdWUoJy0teCcpIHx8IDA7XG4gICAgdmFyIHkgPSBlbFN0eWxlcy5nZXRQcm9wZXJ0eVZhbHVlKCctLXknKSB8fCAwO1xuICAgIHZhciB6ID0gZWxTdHlsZXMuZ2V0UHJvcGVydHlWYWx1ZSgnLS16JykgfHwgMDtcbiAgICB2YXIgdHJhbnNsYXRpb24gPSBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VUcmFuc2xhdGlvbih4LCB5LCAteik7XG5cbiAgICAvLyBPcmllbnRhdGlvblxuICAgIHZhciBvcmllbnRhdGlvblggPSBlbFN0eWxlcy5nZXRQcm9wZXJ0eVZhbHVlKCctLXJvdFgnKSB8fCAwO1xuICAgIHZhciBvcmllbnRhdGlvblkgPSBlbFN0eWxlcy5nZXRQcm9wZXJ0eVZhbHVlKCctLXJvdFknKSB8fCAwO1xuICAgIHZhciBvcmllbnRhdGlvblogPSBlbFN0eWxlcy5nZXRQcm9wZXJ0eVZhbHVlKCctLXJvdFonKSB8fCAwO1xuICAgIHZhciByb3RYID0gVEhSRUUuTWF0aC5kZWdUb1JhZChvcmllbnRhdGlvblgpO1xuICAgIHZhciByb3RZID0gVEhSRUUuTWF0aC5kZWdUb1JhZChvcmllbnRhdGlvblkpO1xuICAgIHZhciByb3RaID0gVEhSRUUuTWF0aC5kZWdUb1JhZChvcmllbnRhdGlvblopO1xuICAgIHZhciByb3RhdGlvblggPSBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VSb3RhdGlvblgocm90WCk7XG4gICAgdmFyIHJvdGF0aW9uWSA9IG5ldyBUSFJFRS5NYXRyaXg0KCkubWFrZVJvdGF0aW9uWShyb3RZKTtcbiAgICB2YXIgcm90YXRpb25aID0gbmV3IFRIUkVFLk1hdHJpeDQoKS5tYWtlUm90YXRpb25YKHJvdFopO1xuICAgIHZhciBtYXRyaXhDU1MgPSByb3RhdGlvbloubXVsdGlwbHkocm90YXRpb25ZLm11bHRpcGx5KHJvdGF0aW9uWC5tdWx0aXBseSh0cmFuc2xhdGlvbikpKTtcblxuICAgIHRoaXMuc3R5bGUudHJhbnNmb3JtID0gJ3RyYW5zbGF0ZTNkKC01MCUsIC01MCUsIDApICcgKyB0aGlzLmdldENTU01hdHJpeChtYXRyaXhDU1MpO1xuXG4gICAgLy8gTWF0cml4IHRocmVlanNcbiAgICByb3RhdGlvblggPSBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VSb3RhdGlvblgoLXJvdFgpO1xuICAgIHJvdGF0aW9uWSA9IG5ldyBUSFJFRS5NYXRyaXg0KCkubWFrZVJvdGF0aW9uWShyb3RZKTtcbiAgICByb3RhdGlvblogPSBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VSb3RhdGlvblgocm90Wik7XG4gICAgdHJhbnNsYXRpb24gPSBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VUcmFuc2xhdGlvbih4LCAteSwgLXopO1xuICAgIHZhciBtYXRyaXggPSByb3RhdGlvbloubXVsdGlwbHkocm90YXRpb25ZLm11bHRpcGx5KHJvdGF0aW9uWC5tdWx0aXBseSh0cmFuc2xhdGlvbikpKTtcblxuICAgIHZhciBvYmplY3QzRCA9IHRoaXMub2JqZWN0M0Q7XG4gICAgb2JqZWN0M0QubWF0cml4ID0gbWF0cml4O1xuICAgIG9iamVjdDNELm1hdHJpeEF1dG9VcGRhdGUgPSBmYWxzZTtcbiAgICBvYmplY3QzRC5tYXRyaXhXb3JsZE5lZWRzVXBkYXRlID0gdHJ1ZTtcbiAgfVxuXG59KTtcblxufSk7fSkodHlwZW9mIGRlZmluZT09J2Z1bmN0aW9uJyYmZGVmaW5lLmFtZD9kZWZpbmVcbjooZnVuY3Rpb24obix3KXsndXNlIHN0cmljdCc7cmV0dXJuIHR5cGVvZiBtb2R1bGU9PSdvYmplY3QnP2Z1bmN0aW9uKGMpe1xuYyhyZXF1aXJlLGV4cG9ydHMsbW9kdWxlKTt9OmZ1bmN0aW9uKGMpe3ZhciBtPXtleHBvcnRzOnt9fTtjKGZ1bmN0aW9uKG4pe1xucmV0dXJuIHdbbl07fSxtLmV4cG9ydHMsbSk7d1tuXT1tLmV4cG9ydHM7fTt9KSgnVlJDYW1lcmEnLHRoaXMpKTtcbiIsIi8qIGdsb2JhbHMgZGVmaW5lICovXG4oZnVuY3Rpb24oZGVmaW5lKXsndXNlIHN0cmljdCc7ZGVmaW5lKGZ1bmN0aW9uKHJlcXVpcmUsZXhwb3J0cyxtb2R1bGUpe1xuXG4vKipcbiAqIERlcGVuZGVuY2llc1xuICovXG5cbnZhciBjb21wb25lbnQgPSByZXF1aXJlKCdnYWlhLWNvbXBvbmVudCcpO1xuXG4vKipcbiAqIFNpbXBsZSBsb2dnZXJcbiAqIEB0eXBlIHtGdW5jdGlvbn1cbiAqL1xudmFyIGRlYnVnID0gMCA/IGNvbnNvbGUubG9nLmJpbmQoY29uc29sZSkgOiBmdW5jdGlvbigpIHt9O1xuXG4vKipcbiAqIEV4cG9ydHNcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGNvbXBvbmVudC5yZWdpc3RlcigndnItbW9kZWwnLCB7XG4gIGV4dGVuZHM6IFZST2JqZWN0LnByb3RvdHlwZSxcblxuICBjcmVhdGVkOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnNldHVwU2NlbmUoKTtcbiAgICBWUk9iamVjdC5wcm90b3R5cGUuY3JlYXRlZC5jYWxsKHRoaXMpO1xuICB9LFxuXG4gIHNldHVwU2NlbmU6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBtYXRlcmlhbCA9IG5ldyBUSFJFRS5NZXNoTGFtYmVydE1hdGVyaWFsKHsgY29sb3I6ICdtYWdlbnRhJyB9KTtcbiAgICB2YXIgbW9kZWwgPSB0aGlzLm1vZGVsID0gbmV3IFRIUkVFLk1lc2gobmV3IFRIUkVFLkJveEdlb21ldHJ5KDEyMCwgMTIwLCAxMjApLCBtYXRlcmlhbCk7XG4gICAgdmFyIHggPSB0aGlzLnN0eWxlLmdldFByb3BlcnR5VmFsdWUoJy0teCcpIHx8IDA7XG4gICAgdmFyIHkgPSB0aGlzLnN0eWxlLmdldFByb3BlcnR5VmFsdWUoJy0teScpIHx8IDA7XG4gICAgdmFyIHogPSB0aGlzLnN0eWxlLmdldFByb3BlcnR5VmFsdWUoJy0teicpO1xuICAgIHRoaXMucmF5Y2FzdGVyID0gbmV3IFRIUkVFLlJheWNhc3RlcigpO1xuICAgIG1vZGVsLm92ZXJkcmF3ID0gdHJ1ZTtcbiAgICBtb2RlbC5wb3NpdGlvbi5zZXQoeCwgeSwgLXopO1xuICAgIHRoaXMub2JqZWN0M0QgPSBtb2RlbDtcbiAgICB0aGlzLmF0dGFjaENsaWNrSGFuZGxlcigpO1xuICAgIC8vdGhpcy5hbmltYXRlKCk7XG4gIH0sXG5cbiAgYXR0YWNoQ2xpY2tIYW5kbGVyOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5tb3VzZVBvcyA9IG5ldyBUSFJFRS5WZWN0b3IyKDAsIDApO1xuICAgIC8vdGhpcy5zY2VuZS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCBvbk1vdXNlTW92ZWQsIGZhbHNlKTtcbiAgICAvL2RvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoICdtb3VzZWRvd24nLCBvbkRvY3VtZW50TW91c2VEb3duLCBmYWxzZSApO1xuXG4gICAgZnVuY3Rpb24gb25Nb3VzZU1vdmVkICggZSApIHtcbiAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgIHNlbGYubW91c2VQb3MueCA9ICggZS5jbGllbnRYIC8gd2luZG93LmlubmVyV2lkdGggKSAqIDIgLSAxO1xuICAgICAgc2VsZi5tb3VzZVBvcy55ID0gLSAoIGUuY2xpZW50WSAvIHdpbmRvdy5pbm5lckhlaWdodCApICogMiArIDE7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gb25Eb2N1bWVudE1vdXNlRG93biggZSApIHtcbiAgICAgIGlmIChzZWxmLmludGVyc2VjdGVkKSB7XG4gICAgICAgIHNlbGYuZXhwbG9kZSgpO1xuICAgICAgfVxuICAgICAgLy8gZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgLy8gdmFyIG1vdXNlVmVjdG9yID0gbmV3IFRIUkVFLlZlY3RvcjMoKTtcbiAgICAgIC8vIG1vdXNlVmVjdG9yLnggPSAyICogKGUuY2xpZW50WCAvIFNDUkVFTl9XSURUSCkgLSAxO1xuICAgICAgLy8gbW91c2VWZWN0b3IueSA9IDEgLSAyICogKCBlLmNsaWVudFkgLyBTQ1JFRU5fSEVJR0hUICk7XG4gICAgICAvLyB2YXIgcmF5Y2FzdGVyID0gcHJvamVjdG9yLnBpY2tpbmdSYXkoIG1vdXNlVmVjdG9yLmNsb25lKCksIGNhbWVyYSApO1xuICAgICAgLy8gdmFyIGludGVyc2VjdHMgPSByYXljYXN0ZXIuaW50ZXJzZWN0T2JqZWN0KCBUQVJHRVQgKTtcbiAgICAgIC8vIGZvciggdmFyIGkgPSAwOyBpIDwgaW50ZXJzZWN0cy5sZW5ndGg7IGkrKyApIHtcbiAgICAgIC8vICAgdmFyIGludGVyc2VjdGlvbiA9IGludGVyc2VjdHNbIGkgXSxcbiAgICAgIC8vICAgb2JqID0gaW50ZXJzZWN0aW9uLm9iamVjdDtcbiAgICAgIC8vICAgY29ucyBvbGUubG9nKFwiSW50ZXJzZWN0ZWQgb2JqZWN0XCIsIG9iaik7XG4gICAgICAvLyB9XG4gICAgfVxuICB9LFxuXG4gIGV4cGxvZGU6IGZ1bmN0aW9uKCkge1xuXG4gICAgdmFyIGJveCA9IHRoaXMub2JqZWN0M0Q7XG4gICAgdmFyIHNjZW5lID0gdGhpcy5zY2VuZTtcbiAgICB2YXIgZHVyYXRpb24gPSA4MDAwO1xuICAgIHRoaXMuZXhwbG9kaW5nID0gdHJ1ZTtcblxuICAgIC8vIGV4cGxvZGUgZ2VvbWV0cnkgaW50byBvYmplY3RzXG4gICAgdmFyIHBpZWNlcyA9IGV4cGxvZGUoIGJveC5nZW9tZXRyeSwgYm94Lm1hdGVyaWFsICk7XG5cbiAgICBib3gubWF0ZXJpYWwudmlzaWJsZSA9IGZhbHNlO1xuXG4gICAgLy8gYW5pbWF0ZSBvYmplY3RzXG4gICAgZm9yICggdmFyIGkgPSAwOyBpIDwgcGllY2VzLmNoaWxkcmVuLmxlbmd0aDsgaSArKyApIHtcblxuICAgICAgdmFyIG9iamVjdCA9IHBpZWNlcy5jaGlsZHJlblsgaSBdO1xuXG4gICAgICBvYmplY3QuZ2VvbWV0cnkuY29tcHV0ZUZhY2VOb3JtYWxzKCk7XG4gICAgICB2YXIgbm9ybWFsID0gb2JqZWN0Lmdlb21ldHJ5LmZhY2VzWzBdLm5vcm1hbC5jbG9uZSgpO1xuICAgICAgdmFyIHRhcmdldFBvc2l0aW9uID0gb2JqZWN0LnBvc2l0aW9uLmNsb25lKCkuYWRkKCBub3JtYWwubXVsdGlwbHlTY2FsYXIoIDMwMDAgKSApO1xuICAgICAgLy9yZW1vdmVCb3hGcm9tTGlzdCggYm94ICk7XG4gICAgICBuZXcgVFdFRU4uVHdlZW4oIG9iamVjdC5wb3NpdGlvbiApXG4gICAgICAgIC50byggdGFyZ2V0UG9zaXRpb24sIGR1cmF0aW9uIClcbiAgICAgICAgLm9uQ29tcGxldGUoIGRlbGV0ZUJveCApXG4gICAgICAgIC5zdGFydCgpO1xuXG4gICAgICBvYmplY3QubWF0ZXJpYWwub3BhY2l0eSA9IDA7XG4gICAgICBuZXcgVFdFRU4uVHdlZW4oIG9iamVjdC5tYXRlcmlhbCApXG4gICAgICAgIC50byggeyBvcGFjaXR5OiAxIH0sIGR1cmF0aW9uIClcbiAgICAgICAgLnN0YXJ0KCk7XG5cbiAgICAgIHZhciByb3RhdGlvbiA9IDIgKiBNYXRoLlBJO1xuICAgICAgdmFyIHRhcmdldFJvdGF0aW9uID0geyB4OiByb3RhdGlvbiwgeTogcm90YXRpb24sIHo6cm90YXRpb24gfTtcbiAgICAgIG5ldyBUV0VFTi5Ud2Vlbiggb2JqZWN0LnJvdGF0aW9uIClcbiAgICAgICAgLnRvKCB0YXJnZXRSb3RhdGlvbiwgZHVyYXRpb24gKVxuICAgICAgICAuc3RhcnQoKTtcblxuICAgIH1cblxuICAgIGJveC5hZGQoIHBpZWNlcyApO1xuXG4gICAgZnVuY3Rpb24gcmVtb3ZlQm94RnJvbUxpc3QoIGJveCApIHtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgb2JqZWN0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAob2JqZWN0c1tpXSA9PT0gYm94KSB7XG4gICAgICAgICAgb2JqZWN0cy5zcGxpY2UoaSwgMSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZGVsZXRlQm94KCkge1xuICAgICAgYm94LnJlbW92ZSggcGllY2VzIClcbiAgICAgIC8vc2NlbmUucmVtb3ZlKCBib3ggKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBleHBsb2RlKCBnZW9tZXRyeSwgbWF0ZXJpYWwgKSB7XG5cbiAgICAgIHZhciBwaWVjZXMgPSBuZXcgVEhSRUUuR3JvdXAoKTtcbiAgICAgIHZhciBtYXRlcmlhbCA9IG1hdGVyaWFsLmNsb25lKCk7XG4gICAgICBtYXRlcmlhbC5zaWRlID0gVEhSRUUuRG91YmxlU2lkZTtcblxuICAgICAgZm9yICggdmFyIGkgPSAwOyBpIDwgZ2VvbWV0cnkuZmFjZXMubGVuZ3RoOyBpICsrICkge1xuXG4gICAgICAgIHZhciBmYWNlID0gZ2VvbWV0cnkuZmFjZXNbIGkgXTtcblxuICAgICAgICB2YXIgdmVydGV4QSA9IGdlb21ldHJ5LnZlcnRpY2VzWyBmYWNlLmEgXS5jbG9uZSgpO1xuICAgICAgICB2YXIgdmVydGV4QiA9IGdlb21ldHJ5LnZlcnRpY2VzWyBmYWNlLmIgXS5jbG9uZSgpO1xuICAgICAgICB2YXIgdmVydGV4QyA9IGdlb21ldHJ5LnZlcnRpY2VzWyBmYWNlLmMgXS5jbG9uZSgpO1xuXG4gICAgICAgIHZhciBnZW9tZXRyeTIgPSBuZXcgVEhSRUUuR2VvbWV0cnkoKTtcbiAgICAgICAgZ2VvbWV0cnkyLnZlcnRpY2VzLnB1c2goIHZlcnRleEEsIHZlcnRleEIsIHZlcnRleEMgKTtcbiAgICAgICAgZ2VvbWV0cnkyLmZhY2VzLnB1c2goIG5ldyBUSFJFRS5GYWNlMyggMCwgMSwgMiApICk7XG5cbiAgICAgICAgdmFyIG1lc2ggPSBuZXcgVEhSRUUuTWVzaCggZ2VvbWV0cnkyLCBtYXRlcmlhbCApO1xuICAgICAgICBtZXNoLnBvc2l0aW9uLnN1YiggZ2VvbWV0cnkyLmNlbnRlcigpICk7XG4gICAgICAgIHBpZWNlcy5hZGQoIG1lc2ggKTtcblxuICAgICAgfVxuXG4gICAgICAvL3NvcnQgdGhlIHBpZWNlc1xuICAgICAgcGllY2VzLmNoaWxkcmVuLnNvcnQoIGZ1bmN0aW9uICggYSwgYiApIHtcblxuICAgICAgICByZXR1cm4gYS5wb3NpdGlvbi56IC0gYi5wb3NpdGlvbi56O1xuICAgICAgICAvL3JldHVybiBhLnBvc2l0aW9uLnggLSBiLnBvc2l0aW9uLng7ICAgICAvLyBzb3J0IHhcbiAgICAgICAgLy9yZXR1cm4gYi5wb3NpdGlvbi55IC0gYS5wb3NpdGlvbi55OyAgIC8vIHNvcnQgeVxuXG4gICAgICB9ICk7XG5cbiAgICAgIHBpZWNlcy5yb3RhdGlvbi5zZXQoIDAsIDAsIDAgKVxuXG4gICAgICByZXR1cm4gcGllY2VzO1xuXG4gICAgfVxuXG4gIH0sXG5cbiAgYW5pbWF0ZTogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciBsYXN0VGltZSA9IHNlbGYubGFzdFRpbWUgfHwgMDtcbiAgICB2YXIgYW5ndWxhclNwZWVkID0gc2VsZi5hbmd1bGFyU3BlZWQgfHwgMC4yO1xuICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZShmdW5jdGlvbigpIHtcbiAgICAgIHNlbGYuYW5pbWF0ZSgpO1xuICAgICAgVFdFRU4udXBkYXRlKCk7XG4gICAgfSk7XG5cbiAgICBpZiAoIXRoaXMuZXhwbG9kaW5nKSB7XG4gICAgICB2YXIgdGltZSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XG4gICAgICB2YXIgdGltZURpZmYgPSB0aW1lIC0gbGFzdFRpbWU7XG4gICAgICB2YXIgYW5nbGVDaGFuZ2UgPSBhbmd1bGFyU3BlZWQgKiB0aW1lRGlmZiAqIDIgKiBNYXRoLlBJIC8gMTAwMDtcbiAgICAgIHNlbGYubW9kZWwucm90YXRpb24ueSArPSBhbmdsZUNoYW5nZTtcbiAgICAgIHNlbGYubGFzdFRpbWUgPSB0aW1lO1xuICAgICAgLy90aGlzLmludGVyc2VjdE1vdXNlKCk7XG4gICAgfVxuICB9LFxuXG4gIC8vIGZpbmQgaW50ZXJzZWN0aW9uc1xuICBpbnRlcnNlY3RNb3VzZTogZnVuY3Rpb24gaW50ZXJzZWN0KCkge1xuICAgIHZhciByYXljYXN0ZXIgPSB0aGlzLnJheWNhc3RlcjtcbiAgICB2YXIgb2JqZWN0cyA9IFt0aGlzLm9iamVjdDNEXTtcbiAgICByYXljYXN0ZXIuc2V0RnJvbUNhbWVyYSggdGhpcy5tb3VzZVBvcywgdGhpcy5zY2VuZS5jYW1lcmEgKTtcbiAgICB2YXIgaW50ZXJzZWN0cyA9IHJheWNhc3Rlci5pbnRlcnNlY3RPYmplY3RzKCBvYmplY3RzICk7XG5cbiAgICBpZiAoIGludGVyc2VjdHMubGVuZ3RoID4gMCApIHtcblxuICAgICAgaWYgKCB0aGlzLm9iamVjdDNEID09IGludGVyc2VjdHNbIDAgXS5vYmplY3QgJiYgIXRoaXMuaW50ZXJzZWN0ZWQpIHtcblxuICAgICAgICB0aGlzLmludGVyc2VjdGVkID0gdGhpcy5vYmplY3QzRC5tYXRlcmlhbC5lbWlzc2l2ZS5nZXRIZXgoKTtcbiAgICAgICAgdGhpcy5vYmplY3QzRC5tYXRlcmlhbC5lbWlzc2l2ZS5zZXRIZXgoIDB4ZmZmZjAwICk7XG5cbiAgICAgIH1cblxuICAgIH0gZWxzZSB7XG5cbiAgICAgIGlmICggdGhpcy5pbnRlcnNlY3RlZCApIHRoaXMub2JqZWN0M0QubWF0ZXJpYWwuZW1pc3NpdmUuc2V0KCAnYmxhY2snICk7XG4gICAgICB0aGlzLmludGVyc2VjdGVkID0gbnVsbDtcblxuICAgIH1cbiAgfSxcblxuICB0ZW1wbGF0ZTogYFxuICAgIDpob3N0IHtcbiAgICAgIGxlZnQ6IDUwJTtcbiAgICAgIHRvcDogNTAlO1xuICAgICAgcG9zaXRpb246IGFic29sdXRlO1xuICAgICAgdHJhbnNmb3JtLXN0eWxlOiBwcmVzZXJ2ZS0zZDtcbiAgICB9XG4gIGBcbn0pO1xuXG59KTt9KSh0eXBlb2YgZGVmaW5lPT0nZnVuY3Rpb24nJiZkZWZpbmUuYW1kP2RlZmluZVxuOihmdW5jdGlvbihuLHcpeyd1c2Ugc3RyaWN0JztyZXR1cm4gdHlwZW9mIG1vZHVsZT09J29iamVjdCc/ZnVuY3Rpb24oYyl7XG5jKHJlcXVpcmUsZXhwb3J0cyxtb2R1bGUpO306ZnVuY3Rpb24oYyl7dmFyIG09e2V4cG9ydHM6e319O2MoZnVuY3Rpb24obil7XG5yZXR1cm4gd1tuXTt9LG0uZXhwb3J0cyxtKTt3W25dPW0uZXhwb3J0czt9O30pKCdWUk1vZGVsJyx0aGlzKSk7XG4iLCIvKiBnbG9iYWxzIGRlZmluZSAqL1xuKGZ1bmN0aW9uKGRlZmluZSl7J3VzZSBzdHJpY3QnO2RlZmluZShmdW5jdGlvbihyZXF1aXJlLGV4cG9ydHMsbW9kdWxlKXtcblxuLyoqXG4gKiBEZXBlbmRlbmNpZXNcbiAqL1xuXG52YXIgY29tcG9uZW50ID0gcmVxdWlyZSgnZ2FpYS1jb21wb25lbnQnKTtcblxuLyoqXG4gKiBTaW1wbGUgbG9nZ2VyXG4gKiBAdHlwZSB7RnVuY3Rpb259XG4gKi9cbnZhciBkZWJ1ZyA9IDAgPyBjb25zb2xlLmxvZy5iaW5kKGNvbnNvbGUpIDogZnVuY3Rpb24oKSB7fTtcblxuLyoqXG4gKiBFeHBvcnRzXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBjb21wb25lbnQucmVnaXN0ZXIoJ3ZyLWJpbGxib2FyZCcsIHtcbiAgZXh0ZW5kczogVlJPYmplY3QucHJvdG90eXBlLFxuXG4gIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgIFZST2JqZWN0LnByb3RvdHlwZS5jcmVhdGVkLmNhbGwodGhpcyk7XG4gICAgdGhpcy51cGRhdGVUcmFuc2Zvcm0oKTtcbiAgfSxcblxuICB1cGRhdGU6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudXBkYXRlVHJhbnNmb3JtKCk7XG4gIH0sXG5cbiAgdXBkYXRlVHJhbnNmb3JtOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgY2FtZXJhID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcigndnItY2FtZXJhJyk7XG4gICAgdmFyIG1hdHJpeCA9IG5ldyBUSFJFRS5NYXRyaXg0KCk7XG4gICAgbWF0cml4LmNvcHkoIG1hdHJpeC5nZXRJbnZlcnNlKGNhbWVyYS5vYmplY3QzRC5tYXRyaXhXb3JsZCkgKTtcbiAgICBtYXRyaXguY29weSggY2FtZXJhLm9iamVjdDNELm1hdHJpeFdvcmxkICk7XG5cbiAgICBtYXRyaXgudHJhbnNwb3NlKCk7XG5cbiAgICBtYXRyaXguZWxlbWVudHNbIDMgXSA9IDA7XG4gICAgbWF0cml4LmVsZW1lbnRzWyA3IF0gPSAwO1xuICAgIG1hdHJpeC5lbGVtZW50c1sgMTEgXSA9IDA7XG4gICAgbWF0cml4LmVsZW1lbnRzWyAxNSBdID0gMTtcblxuICAgIC8vIFBvc2l0aW9uXG4gICAgdmFyIHggPSB0aGlzLnN0eWxlLmdldFByb3BlcnR5VmFsdWUoJy0teCcpIHx8IDA7XG4gICAgdmFyIHkgPSB0aGlzLnN0eWxlLmdldFByb3BlcnR5VmFsdWUoJy0teScpIHx8IDA7XG4gICAgdmFyIHogPSB0aGlzLnN0eWxlLmdldFByb3BlcnR5VmFsdWUoJy0teicpIHx8IDA7XG4gICAgdmFyIHRyYW5zbGF0aW9uID0gbmV3IFRIUkVFLk1hdHJpeDQoKS5tYWtlVHJhbnNsYXRpb24oeCwgeSwgLXopO1xuXG4gICAgLy8gT3JpZW50YXRpb25cbiAgICB2YXIgb3JpZW50YXRpb25YID0gdGhpcy5zdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKCctLXJvdFgnKSB8fCAwO1xuICAgIHZhciBvcmllbnRhdGlvblkgPSB0aGlzLnN0eWxlLmdldFByb3BlcnR5VmFsdWUoJy0tcm90WScpIHx8IDA7XG4gICAgdmFyIG9yaWVudGF0aW9uWiA9IHRoaXMuc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZSgnLS1yb3RaJykgfHwgMDtcblxuICAgIHZhciByb3RYID0gVEhSRUUuTWF0aC5kZWdUb1JhZChvcmllbnRhdGlvblgpO1xuICAgIHZhciByb3RZID0gVEhSRUUuTWF0aC5kZWdUb1JhZChvcmllbnRhdGlvblkpO1xuICAgIHZhciByb3RaID0gVEhSRUUuTWF0aC5kZWdUb1JhZChvcmllbnRhdGlvblopO1xuICAgIHZhciByb3RhdGlvblggPSBuZXcgVEhSRUUuTWF0cml4NCgpLm1ha2VSb3RhdGlvblgocm90WCk7XG4gICAgdmFyIHJvdGF0aW9uWSA9IG5ldyBUSFJFRS5NYXRyaXg0KCkubWFrZVJvdGF0aW9uWShyb3RZKTtcbiAgICB2YXIgcm90YXRpb25aID0gbmV3IFRIUkVFLk1hdHJpeDQoKS5tYWtlUm90YXRpb25YKHJvdFopO1xuXG4gICAgdGhpcy5zdHlsZS50cmFuc2Zvcm0gPSAndHJhbnNsYXRlM2QoLTUwJSwgLTUwJSwgMCkgJyArIHRoaXMuZ2V0Q1NTTWF0cml4KHRyYW5zbGF0aW9uLm11bHRpcGx5KHJvdGF0aW9uWi5tdWx0aXBseShyb3RhdGlvblkubXVsdGlwbHkocm90YXRpb25YLm11bHRpcGx5KG1hdHJpeCkpKSkpO1xuICAgIHRoaXMub2JqZWN0M0QucG9zaXRpb24uc2V0KHgsIC15LCAteik7XG4gICAgdGhpcy5vYmplY3QzRC5yb3RhdGlvbi5vcmRlciA9ICdZWFonO1xuICAgIHRoaXMub2JqZWN0M0Qucm90YXRpb24uc2V0KC1yb3RYLCByb3RZLCByb3RaKTtcbiAgfVxuXG59KTtcblxufSk7fSkodHlwZW9mIGRlZmluZT09J2Z1bmN0aW9uJyYmZGVmaW5lLmFtZD9kZWZpbmVcbjooZnVuY3Rpb24obix3KXsndXNlIHN0cmljdCc7cmV0dXJuIHR5cGVvZiBtb2R1bGU9PSdvYmplY3QnP2Z1bmN0aW9uKGMpe1xuYyhyZXF1aXJlLGV4cG9ydHMsbW9kdWxlKTt9OmZ1bmN0aW9uKGMpe3ZhciBtPXtleHBvcnRzOnt9fTtjKGZ1bmN0aW9uKG4pe1xucmV0dXJuIHdbbl07fSxtLmV4cG9ydHMsbSk7d1tuXT1tLmV4cG9ydHM7fTt9KSgnVlJCaWxsYm9hcmQnLHRoaXMpKTtcbiIsIi8qIGdsb2JhbHMgZGVmaW5lICovXG4oZnVuY3Rpb24oZGVmaW5lKXsndXNlIHN0cmljdCc7ZGVmaW5lKGZ1bmN0aW9uKHJlcXVpcmUsZXhwb3J0cyxtb2R1bGUpe1xuXG4vKipcbiAqIERlcGVuZGVuY2llc1xuICovXG5cbnZhciBjb21wb25lbnQgPSByZXF1aXJlKCdnYWlhLWNvbXBvbmVudCcpO1xuXG4vKipcbiAqIFNpbXBsZSBsb2dnZXJcbiAqIEB0eXBlIHtGdW5jdGlvbn1cbiAqL1xudmFyIGRlYnVnID0gMCA/IGNvbnNvbGUubG9nLmJpbmQoY29uc29sZSkgOiBmdW5jdGlvbigpIHt9O1xuXG4vKipcbiAqIEV4cG9ydHNcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGNvbXBvbmVudC5yZWdpc3RlcigndnItdGVycmFpbicsIHtcbiAgZXh0ZW5kczogVlJPYmplY3QucHJvdG90eXBlLFxuXG4gIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB0aGlzLnNldHVwU2NlbmUob25Mb2FkZWQpO1xuICAgIGZ1bmN0aW9uIG9uTG9hZGVkKCkge1xuICAgICAgVlJPYmplY3QucHJvdG90eXBlLmNyZWF0ZWQuY2FsbChzZWxmKTtcbiAgICAgIHNlbGYuZ2VuZXJhdGVMYWJlbHMobm9pc2UpO1xuICAgIH1cbiAgfSxcblxuICBzZXR1cFNjZW5lOiBmdW5jdGlvbihvbkxvYWRlZCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB0aGlzLnRlcnJhaW5TaXplID0gMTAyNDtcbiAgICBuZXcgVGVycmFpbihub2lzZSwgdGhpcy50ZXJyYWluU2l6ZSwgMiwgNjQsIGZ1bmN0aW9uKG1vZGVsKSB7O1xuICAgICAgc2VsZi5vYmplY3QzRCA9IG1vZGVsO1xuICAgICAgb25Mb2FkZWQoKTtcbiAgICB9KTtcbiAgfSxcblxuICBnZW5lcmF0ZUxhYmVsczogZnVuY3Rpb24obm9pc2UpIHtcbiAgICB2YXIgbGFiZWw7XG4gICAgdmFyIG1heCA9IDE1O1xuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBub2lzZS5pbWFnZS5kYXRhLmxlbmd0aDsgKytpKSB7XG4gICAgICB2YXIgbm9pc2VWYWx1ZSA9IG5vaXNlLmltYWdlLmRhdGFbaV07XG4gICAgICB2YXIgc2lnbjEgPSAoTWF0aC5yYW5kb20oKSoxMCkudG9GaXhlZCgwKSAlIDIgPT09IDA/IC0xOiAxO1xuICAgICAgdmFyIHNpZ24yID0gKE1hdGgucmFuZG9tKCkqMTApLnRvRml4ZWQoMCkgJSAyID09PSAwPyAtMTogMTtcbiAgICAgIGlmIChub2lzZVZhbHVlID4gODApIHtcbiAgICAgICAgbGFiZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd2ci1iaWxsYm9hcmQnKTtcbiAgICAgICAgbGFiZWwuY2xhc3NMaXN0LmFkZCgncGVhay1sYWJlbCcpO1xuICAgICAgICBsYWJlbC5zdHlsZS5zZXRQcm9wZXJ0eSgnLS14JywgIHNpZ24xICogKE1hdGgucmFuZG9tKCkgKiB0aGlzLnRlcnJhaW5TaXplKSk7XG4gICAgICAgIGxhYmVsLnN0eWxlLnNldFByb3BlcnR5KCctLXknLCAgc2lnbjIgKiAoTWF0aC5yYW5kb20oKSAqIHRoaXMudGVycmFpblNpemUpKTtcbiAgICAgICAgbGFiZWwuc3R5bGUuc2V0UHJvcGVydHkoJy0teicsICAtbm9pc2VWYWx1ZSk7XG4gICAgICAgIGxhYmVsLnN0eWxlLnNldFByb3BlcnR5KCctLXJvdFgnLCAgLTkwKTtcbiAgICAgICAgbGFiZWwuaW5uZXJIVE1MID0gXCJMYW5kbWFyayBcIiArIGk7XG4gICAgICAgIHRoaXMuYXBwZW5kQ2hpbGQobGFiZWwpO1xuICAgICAgICBtYXgtPTE7XG4gICAgICAgIGlmIChtYXggPT0gMCkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG59KTtcblxufSk7fSkodHlwZW9mIGRlZmluZT09J2Z1bmN0aW9uJyYmZGVmaW5lLmFtZD9kZWZpbmVcbjooZnVuY3Rpb24obix3KXsndXNlIHN0cmljdCc7cmV0dXJuIHR5cGVvZiBtb2R1bGU9PSdvYmplY3QnP2Z1bmN0aW9uKGMpe1xuYyhyZXF1aXJlLGV4cG9ydHMsbW9kdWxlKTt9OmZ1bmN0aW9uKGMpe3ZhciBtPXtleHBvcnRzOnt9fTtjKGZ1bmN0aW9uKG4pe1xucmV0dXJuIHdbbl07fSxtLmV4cG9ydHMsbSk7d1tuXT1tLmV4cG9ydHM7fTt9KSgnVlJUZXJyYWluJyx0aGlzKSk7XG4iLCIvKiBnbG9iYWxzIGRlZmluZSAqL1xuKGZ1bmN0aW9uKGRlZmluZSl7J3VzZSBzdHJpY3QnO2RlZmluZShmdW5jdGlvbihyZXF1aXJlLGV4cG9ydHMsbW9kdWxlKXtcblxuLyoqXG4gKiBEZXBlbmRlbmNpZXNcbiAqL1xuXG52YXIgY29tcG9uZW50ID0gcmVxdWlyZSgnZ2FpYS1jb21wb25lbnQnKTtcblxuLyoqXG4gKiBTaW1wbGUgbG9nZ2VyXG4gKiBAdHlwZSB7RnVuY3Rpb259XG4gKi9cbnZhciBkZWJ1ZyA9IDAgPyBjb25zb2xlLmxvZy5iaW5kKGNvbnNvbGUpIDogZnVuY3Rpb24oKSB7fTtcblxuLyoqXG4gKiBFeHBvcnRzXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBjb21wb25lbnQucmVnaXN0ZXIoJ3ZyLWF4aXMtZ2wnLCB7XG4gIGV4dGVuZHM6IFZST2JqZWN0LnByb3RvdHlwZSxcblxuICBjcmVhdGVkOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnNldHVwU2NlbmUoKTtcbiAgICBWUk9iamVjdC5wcm90b3R5cGUuY3JlYXRlZC5jYWxsKHRoaXMpO1xuICB9LFxuXG4gIHNldHVwU2NlbmU6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMub2JqZWN0M0QgPSBuZXcgVEhSRUUuQXhpc0hlbHBlciggNTAwICk7XG4gIH1cblxufSk7XG5cbn0pO30pKHR5cGVvZiBkZWZpbmU9PSdmdW5jdGlvbicmJmRlZmluZS5hbWQ/ZGVmaW5lXG46KGZ1bmN0aW9uKG4sdyl7J3VzZSBzdHJpY3QnO3JldHVybiB0eXBlb2YgbW9kdWxlPT0nb2JqZWN0Jz9mdW5jdGlvbihjKXtcbmMocmVxdWlyZSxleHBvcnRzLG1vZHVsZSk7fTpmdW5jdGlvbihjKXt2YXIgbT17ZXhwb3J0czp7fX07YyhmdW5jdGlvbihuKXtcbnJldHVybiB3W25dO30sbS5leHBvcnRzLG0pO3dbbl09bS5leHBvcnRzO307fSkoJ1ZSQXhpc0dMJyx0aGlzKSk7XG4iLCIvKiBnbG9iYWxzIGRlZmluZSAqL1xuKGZ1bmN0aW9uKGRlZmluZSl7J3VzZSBzdHJpY3QnO2RlZmluZShmdW5jdGlvbihyZXF1aXJlLGV4cG9ydHMsbW9kdWxlKXtcblxuLyoqXG4gKiBEZXBlbmRlbmNpZXNcbiAqL1xuXG52YXIgY29tcG9uZW50ID0gcmVxdWlyZSgnZ2FpYS1jb21wb25lbnQnKTtcblxuLyoqXG4gKiBTaW1wbGUgbG9nZ2VyXG4gKiBAdHlwZSB7RnVuY3Rpb259XG4gKi9cbnZhciBkZWJ1ZyA9IDAgPyBjb25zb2xlLmxvZy5iaW5kKGNvbnNvbGUpIDogZnVuY3Rpb24oKSB7fTtcblxuLyoqXG4gKiBFeHBvcnRzXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBjb21wb25lbnQucmVnaXN0ZXIoJ3ZyLWF4aXMtZG9tJywge1xuICBleHRlbmRzOiBWUk9iamVjdC5wcm90b3R5cGUsXG5cbiAgdGVtcGxhdGU6IGBcbiAgICA8ZGl2IGNsYXNzPVwiYXhpcyB4LWF4aXNcIj48L2Rpdj5cbiAgICA8ZGl2IGNsYXNzPVwiYXhpcyB5LWF4aXNcIj48L2Rpdj5cbiAgICA8ZGl2IGNsYXNzPVwiYXhpcyB6LWF4aXNcIj48L2Rpdj5cbiAgICA8c3R5bGU+XG4gICAgOmhvc3Qge1xuICAgICAgbGVmdDogNTAlO1xuICAgICAgdG9wOiA1MCU7XG4gICAgICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gICAgICB0cmFuc2Zvcm0tc3R5bGU6IHByZXNlcnZlLTNkO1xuICAgIH1cblxuICAgIC5heGlzIHtcbiAgICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgICAgIGRpc3BsYXk6IGlubGluZS1ibG9jaztcbiAgICB9XG5cbiAgICAueC1heGlzIHtcbiAgICAgIGhlaWdodDogMXB4O1xuICAgICAgd2lkdGg6IDUwMHB4O1xuICAgICAgYmFja2dyb3VuZC1jb2xvcjogcGluaztcbiAgICB9XG5cbiAgICAueS1heGlzIHtcbiAgICAgIGhlaWdodDogNTAwcHg7XG4gICAgICB3aWR0aDogMXB4O1xuICAgICAgYmFja2dyb3VuZC1jb2xvcjogbWFnZW50O1xuICAgICAgdHJhbnNmb3JtOiB0cmFuc2xhdGUzZCgwLCAtNTAwcHgsIDApO1xuICAgIH1cblxuICAgIC56LWF4aXMge1xuICAgICAgaGVpZ2h0OiAxcHg7XG4gICAgICB3aWR0aDogNTAwcHg7XG4gICAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2aW9sZXQ7XG4gICAgICB0cmFuc2Zvcm06IHRyYW5zbGF0ZTNkKC01MCUsIDAsIDI1MHB4KSByb3RhdGVZKDkwZGVnKTtcbiAgICB9XG4gICAgPC9zdHlsZT5cbiAgYFxuXG59KTtcblxufSk7fSkodHlwZW9mIGRlZmluZT09J2Z1bmN0aW9uJyYmZGVmaW5lLmFtZD9kZWZpbmVcbjooZnVuY3Rpb24obix3KXsndXNlIHN0cmljdCc7cmV0dXJuIHR5cGVvZiBtb2R1bGU9PSdvYmplY3QnP2Z1bmN0aW9uKGMpe1xuYyhyZXF1aXJlLGV4cG9ydHMsbW9kdWxlKTt9OmZ1bmN0aW9uKGMpe3ZhciBtPXtleHBvcnRzOnt9fTtjKGZ1bmN0aW9uKG4pe1xucmV0dXJuIHdbbl07fSxtLmV4cG9ydHMsbSk7d1tuXT1tLmV4cG9ydHM7fTt9KSgnVlJBeGlzRE9NJyx0aGlzKSk7XG4iXSwic291cmNlUm9vdCI6Ii9zb3VyY2UvIn0=