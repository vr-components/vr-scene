(function(define){'use strict';define(function(require,exports,module){

  module.exports = {
    observeHeadingChanges: function(heading) {
    },
    reformatHeading: function(heading) {
    }
  };

});})((function(n,w){'use strict';return typeof define=='function'&&define.amd?
define:typeof module=='object'?function(c){c(require,exports,module);}:
function(c){var m={exports:{}},r=function(n){return w[n];};
w[n]=c(r,m.exports,m)||m.exports;};})('./test/mocks/mock_font_fit',this));
