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
  },

  update: function() {
    // var camera = this.scene.camera;

    // // http://swiftcoder.wordpress.com/2008/11/25/constructing-a-billboard-matrix/
    // var matrix = new THREE.Matrix4();
    // matrix.copy( camera.matrixWorldInverse );
    // //matrix.transpose();
    // //matrix.copyPosition( object.matrixWorld );
    // //matrix.scale( object.scale );

    // matrix.elements[ 3 ] = 0;
    // matrix.elements[ 7 ] = 0;
    // matrix.elements[ 11 ] = 0;
    // matrix.elements[ 15 ] = 1;

    // this.style.transform = this.getCSSMatrix( matrix );

  },

  // template: `
  //   <content></content>
  //   :host {
  //     left: 50%;
  //     top: 50%;
  //     position: absolute;
  //     transform-style: preserve-3d;
  //   }
  //`
});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('VRBillboard',this));
