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

  created: function() {
    VRObject.prototype.created.call(this);
    var style = window.getComputedStyle(this);
    this.els = {};
    this.els.urlbar = this.shadowRoot.querySelector('.urlbar');
    var data_url = this.getPropertyValue("--data-url");
    data_url = /url\(['"](.*)['"]\)/.exec(data_url)[1];
    ajax.get(data_url, this.loadLinks.bind(this));
  },

  loadLinks(links) {
    var links = links.sites;
    this.classList.add('hud');
    var i;
    var el;
    var h1;
    var h2;
    for (i=0; i < links.length; ++i) {
      el = document.createElement('div');
      el.classList.add('hud-element');
      el.classList.add('link');
      h1 = document.createElement('h1');
      h2 = document.createElement('h2');
      h1.innerHTML = links[i].name;
      h2.innerHTML = links[i].tagline;
      el.appendChild(h1);
      el.appendChild(h2);
      el.style.setProperty("--url", links[i].url);
      el.addEventListener('click', this.linkClickHandler.bind(this));
      this.appendChild(el);
    }
  },

  linkClickHandler: function(evt) {
    var url = evt.currentTarget.style.getPropertyValue('--url');
    var event = new CustomEvent('click', { 'detail': { 'url': url } });
    evt.stopPropagation();
    this.dispatchEvent(event);
  },

  show: function() {
    this.classList.remove('hidden');
  },

  hide: function() {
    this.classList.add('hidden');
  },

  template: `
    <div class="links">
      <content></content>
    </div>
    <form class="hud-element urlbar" action="#">
      <input class="urlbar-input" type="text">
    </form>
    <style>

      .hud-element {
        display: inline-block;
        background-color: hsla(228, 15%, 6%, 0.75);
        border: 0.25cm solid black;
        font: 500 1.1rem sans-serif;
      }

      /**
      * URL Bar
      */

      .urlbar {
        margin-top: 20px;
        width: 45%;
      }

      .urlbar-input {
        font: 500 2.1rem/1 sans-serif;
        letter-spacing: 0.05em;
        padding: 0.5em 1em;
        text-align: center;
        text-transform: uppercase;
        transition: .25s width ease;
        width: 100%;
        color: black;
        box-sizing : border-box;
      }

      .urlbar-input:hover {
        background: black;
        color: white;
      }

      .urlbar-input:focus {
        background: white;
        color: black;
      }

      /* NOTE: These selectors cannot be combined: https://developer.mozilla.org/en-US/docs/Web/CSS/::selection#Examples */
      .urlbar-input::selection {
        background: hsla(0, 0%, 0%, 0.2);
        color: white;
      }

      .urlbar-input::-moz-selection {
        background: hsla(0, 0%, 0%, 0.2);
        color: white;
      }

      /**
      * Links
      */

      ::content .link {
        background: white;
        border: 0.25cm solid black;
        font: 500 1.1rem sans-serif;
        display: inline-block;
        height: 7cm;
        margin: 0.25cm;
        overflow: hidden;
        padding: 0.5cm;
        text-align: left;
        width: 7cm;
        color: black;
        text-decoration: none;
        cursor: pointer;
      }

      ::content .link:hover {
        background-color: black;
        color: white;
      }

      ::content .link h1 {
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
        text-align: center;
      }

      .hidden {
        pointer-events: none;
        display: none;
      }
    </style>
  `

});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('VRHUD',this));
