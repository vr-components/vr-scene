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
  extends: HTMLDivElement.prototype,

  created: function() {
    this.position = {
      x: 0,
      y: 0,
      z: 0
    };
    this.orientation = new VR.Euler(0, 0, 0, "YXZ");
    this.setupShadowRoot();
    this.setupScene();
    this.updateTransform();
  },

  setupScene: function() {
    this.findScene();
    var material = new THREE.MeshLambertMaterial({ color: 'magenta' });
    var model = this.model = new THREE.Mesh(new THREE.BoxGeometry(120, 120, 120), material);
    var x = this.getAttribute('x') || 0;
    var y = this.getAttribute('y') || 0;
    var z = this.getAttribute('z') || 0;
    this.raycaster = new THREE.Raycaster();
    model.overdraw = true;
    model.position.set(x, y, z);
    this.object3D = model;
    this.scene.addObject(this);
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

    var translation = new VR.Matrix4().makeTranslation(x, y, -z);
    var rotationY = new VR.Matrix4().makeRotationY(VR.Math.degToRad(orientationY));
    var rotationX = new VR.Matrix4().makeRotationX(VR.Math.degToRad(orientationX));
    var matrix = new VR.Matrix4();
    this.style.transform = 'translate3d(-50%, -50%, 0) ' + this.getCameraCSSMatrix(translation.multiply(rotationY.multiply(rotationX)));
  },

  findScene: function() {
    var scenes = document.querySelectorAll('vr-scene');
    var perspective;
    for (var i=0; i < scenes.length; ++i) {
      if (isDescendant(scenes[i], this)) {
        this.scene = scenes[i];
        perspective = window.getComputedStyle(this.scene, null).perspective;
        this.perspective = parseInt(perspective.substring(0, perspective.indexOf("px"))) - 1;
        this.updateTransform();
        return;
      }
    }

    this.perspective = 0;
    this.updateTransform();

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
    :host {
      left: 50%;
      top: 50%;
    }
  `
});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('vr-model',this));
