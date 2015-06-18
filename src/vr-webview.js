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

module.exports = component.register('vr-webview', {
  extends: VRObject.prototype,

  created: function() {
    VRObject.prototype.created.call(this);
    this.els = {};
    this.els.iframe = this.shadowRoot.querySelector('iframe');
    this.hide();
  },

  loadURL: function(url) {
    this.els.iframe.src = url;
  },

  show: function() {
    this.els.iframe.classList.remove('hidden');
  },

  hide: function() {
    this.els.iframe.classList.add('hidden');
  },

  template: `
    <iframe remote="true" mozbrowser="true"></iframe>
    <style>
      :host {
        left: 50%;
        top: 50%;
        position: absolute;
        transform-style: preserve-3d;
      }

      iframe {
        width: 100%;
        height: 100%;
        border: 0;
        transition: transform 0.3s ease-in-out;
      }

      .hidden {
        pointer-events: none;
        opacity: 0.2;
        transform: translate3d(0, 0, -100px) scale(0.75, 0.75);
      }
    </style>
  `

});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('VRWebView',this));
