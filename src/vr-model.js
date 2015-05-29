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
