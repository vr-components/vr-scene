/* globals define */
;(function(define){'use strict';define(function(require,exports,module){

  var texturePath = "js/textures/";
  var sky = THREE.ImageUtils.loadTexture( texturePath + "sky.png" );

  var textures = module.exports = {
    sky: sky,
    //grass: THREE.ImageUtils.loadTexture( texturePath + "grass.jpg" ),
    rock: THREE.ImageUtils.loadTexture( texturePath + "rock.jpg" ),
    //snow: THREE.ImageUtils.loadTexture( texturePath + "snow.jpg" )
  };

  for ( var t in textures ) {
    if ( textures.hasOwnProperty( t ) ) {
      textures[t].wrapS = textures[t].wrapT = THREE.RepeatWrapping;
    }
  }

  sky.wrapS = sky.wrapT = THREE.MirroredRepeatWrapping;
  sky.repeat.set( 2, 2 );

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('terrain-textures',this));
