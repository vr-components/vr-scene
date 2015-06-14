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

module.exports = component.register('vr-hud', {
  extends: VRObject.prototype,

  loadLinks(links) {
    this.classList.add('hud');
    var i;
    var el;
    var h1;
    var h2;
    for (i=0; i < links.length; ++i) {
      el = document.createElement('div');
      el.classList.add('link');
      h1 = document.createElement('h1');
      h2 = document.createElement('h2');
      h1.innerHTML = links[i].name;
      h2.innerHTML = links[i].tagline;
      el.appendChild(h1);
      el.appendChild(h2);
      this.appendChild(el);
    }
  },

  template: `
    <content></content>
    <style>
    ::content .link {
      width: 150px;
      height: 150px;
      background-color: red;
      display: inline-block;
      margin: 10px;
      background-color: white;
      border: 5px solid black;
      font-size: 8pt;
      padding: 20px;
    }

    ::content .link h1 {
      color: black;
      margin: 0;
      padding: 0;
    }

    ::content .link h2 {
      color: gray;
      margin: 0;
      padding: 0;
    }

    :host {
      left: 50%;
      top: 50%;
      position: absolute;
      transform-style: preserve-3d;
      width: 800px;
      height 600px;
    }
    </style>
  `

});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('VRHUD',this));
