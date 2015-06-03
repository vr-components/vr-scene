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
