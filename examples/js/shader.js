/* globals define */
;(function(define){'use strict';define(function(require,exports,module){

  var Shader = module.exports = function ( url, onload ) {
    this.load( url, onload );
  };

  // Replace the value of a #define within the shader
  Shader.prototype.define = function ( define, value ) {
    var regexp = new RegExp("#define " + define + " .*", "g");
    var newDefine = "#define " + define + ( value ? " " + value : "" );
    if ( this.value.match( regexp ) ) {
      // #define already exists, update its value
      this.value = this.value.replace( regexp, newDefine );
    } else {
      // New #define, prepend to start of file
      this.value = newDefine + "\n" + this.value;
    }
  };

  Shader.prototype.load = function( url, onload ) {
    var self = this;
    // request the file over AJAX
    ajax({
      url: url,
      dataType: 'text',
      complete: function(r){
        self.loadDependencies( r.responseText, onload );
      }
    });

  };

  Shader.prototype.loadDependencies = function ( shaderContents, onload ) {
    var self = this;
    self.value = shaderContents;
    var matches = [];
    var dependencyLoaded = function( text, includeFile ) {
      var regexp = new RegExp("#include " + includeFile, "g");
      self.value = self.value.replace( regexp, text );
        loaded++;
        if ( loaded === matches.length ) {
          // All shaders have been loaded, return result
          onload(self);
        }
    }

    shaderContents.replace( /#include (.*)/g, function ( match, includeFile ) {
      matches.push( includeFile );
    } );

    if ( matches.length === 0 ) {
      // No includes, just return straight away
      onload();
    } else {
      // Load included shaders and replace them in the code
      var loaded = 0;
      for ( var m = 0; m < matches.length; m++ ) {
        // request the file over AJAX
        ajax({
          url: matches[m],
          dataType: 'text',
          complete: function(includeFile) {
            return function(r){
              dependencyLoaded( r.responseText, includeFile );
            }
          }(matches[m])
        });
      }
    }

  };

  });})(typeof define=='function'&&define.amd?define
  :(function(n,w){'use strict';return typeof module=='object'?function(c){
  c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
  return w[n];},m.exports,m);w[n]=m.exports;};})('Shader',this));
