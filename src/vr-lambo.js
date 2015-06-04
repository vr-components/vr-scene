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

var r = "textures/bridge/";
var urls = [ r + "posx.jpg", r + "negx.jpg",
             r + "posy.jpg", r + "negy.jpg",
             r + "posz.jpg", r + "negz.jpg" ];
var textureCube = THREE.ImageUtils.loadTextureCube( urls );
textureCube.format = THREE.RGBFormat;

/**
 * Exports
 */

module.exports = component.register('vr-lambo', {
  extends: VRObject.prototype,

  created: function() {
    var self = this;
    var modelInfo = this.modelInfo;
    var materials = this.materials;
    modelInfo.materials = {
      body: [
        [ "Orange metal",  materials[ "Orange metal" ] ],
        [ "Blue metal",   materials[ "Blue metal" ] ],
        [ "Red metal",    materials[ "Red metal" ] ],
        [ "Green metal",  materials[ "Green metal" ] ],
        [ "Black metal",  materials[ "Black metal" ] ],
        [ "Gold",     materials[ "Gold" ] ],
        [ "Bronze",   materials[ "Bronze" ] ],
        [ "Chrome",   materials[ "Chrome" ] ]
      ],
      mmap: {
        0: materials[ "Black rough" ],   // tires + inside
        1: materials[ "Pure chrome" ],   // wheels + extras chrome
        2: materials[ "Bronze" ],       // back / top / front torso
        3: materials[ "Light glass" ],    // glass
        4: materials[ "Pure chrome" ],   // sides torso
        5: materials[ "Pure chrome" ],   // engine
        6: materials[ "Red glass 50" ],    // backlights
        7: materials[ "Orange glass 50" ]  // backsignals
      }
    };
    this.setupScene(onLoaded);
    function onLoaded() {
      VRObject.prototype.created.call(self);
      var ambient = new THREE.AmbientLight( 0x050505 );
      self.scene.scene.add( ambient );

      var directionalLight = new THREE.DirectionalLight( 0xffffff, 2 );
      directionalLight.position.set( 2, 1.2, 10 ).normalize();
      self.scene.scene.add( directionalLight );

      directionalLight = new THREE.DirectionalLight( 0xffffff, 1 );
      directionalLight.position.set( -2, 1.2, -10 ).normalize();
      self.scene.scene.add( directionalLight );

      var pointLight = new THREE.PointLight( 0xffaa00, 2 );
      pointLight.position.set( 2000, 1200, 10000 );
      self.scene.scene.add( pointLight );
    }
  },

  // common materials
  materials: {
    "Orange":   new THREE.MeshLambertMaterial( { color: 0xff6600, ambient: 0xff2200, envMap: textureCube, combine: THREE.MixOperation, reflectivity: 0.3 } ),
    "Blue":   new THREE.MeshLambertMaterial( { color: 0x001133, ambient: 0x001133, envMap: textureCube, combine: THREE.MixOperation, reflectivity: 0.3 } ),
    "Red":    new THREE.MeshLambertMaterial( { color: 0x660000, ambient: 0x330000, envMap: textureCube, combine: THREE.MixOperation, reflectivity: 0.25 } ),
    "Black":  new THREE.MeshLambertMaterial( { color: 0x000000, ambient: 0x000000, envMap: textureCube, combine: THREE.MixOperation, reflectivity: 0.15 } ),
    "White":  new THREE.MeshLambertMaterial( { color: 0xffffff, ambient: 0x666666, envMap: textureCube, combine: THREE.MixOperation, reflectivity: 0.25 } ),

    "Carmine":  new THREE.MeshPhongMaterial( { color: 0x770000, specular:0xffaaaa, envMap: textureCube, combine: THREE.MultiplyOperation } ),
    "Gold":   new THREE.MeshPhongMaterial( { color: 0xaa9944, specular:0xbbaa99, shininess:50, envMap: textureCube, combine: THREE.MultiplyOperation } ),
    "Bronze": new THREE.MeshPhongMaterial( { color: 0x150505, specular:0xee6600, shininess:10, envMap: textureCube, combine: THREE.MixOperation, reflectivity: 0.25 } ),
    "Chrome":   new THREE.MeshPhongMaterial( { color: 0xffffff, specular:0xffffff, envMap: textureCube, combine: THREE.MultiplyOperation } ),

    "Orange metal": new THREE.MeshLambertMaterial( { color: 0xff6600, ambient: 0xff2200, envMap: textureCube, combine: THREE.MultiplyOperation } ),
    "Blue metal":   new THREE.MeshLambertMaterial( { color: 0x001133, ambient: 0x002266, envMap: textureCube, combine: THREE.MultiplyOperation } ),
    "Red metal":  new THREE.MeshLambertMaterial( { color: 0x770000, envMap: textureCube, combine: THREE.MultiplyOperation } ),
    "Green metal":  new THREE.MeshLambertMaterial( { color: 0x007711, envMap: textureCube, combine: THREE.MultiplyOperation } ),
    "Black metal":  new THREE.MeshLambertMaterial( { color: 0x222222, envMap: textureCube, combine: THREE.MultiplyOperation } ),

    "Pure chrome":  new THREE.MeshLambertMaterial( { color: 0xffffff, envMap: textureCube } ),
    "Dark chrome":  new THREE.MeshLambertMaterial( { color: 0x444444, envMap: textureCube } ),
    "Darker chrome":new THREE.MeshLambertMaterial( { color: 0x222222, envMap: textureCube } ),

    "Black glass":  new THREE.MeshLambertMaterial( { color: 0x101016, envMap: textureCube, opacity: 0.975, transparent: true } ),
    "Dark glass": new THREE.MeshLambertMaterial( { color: 0x101046, envMap: textureCube, opacity: 0.25, transparent: true } ),
    "Blue glass": new THREE.MeshLambertMaterial( { color: 0x668899, envMap: textureCube, opacity: 0.75, transparent: true } ),
    "Light glass":  new THREE.MeshBasicMaterial( { color: 0x223344, envMap: textureCube, opacity: 0.25, transparent: true, combine: THREE.MixOperation, reflectivity: 0.25 } ),

    "Red glass":  new THREE.MeshLambertMaterial( { color: 0xff0000, opacity: 0.75, transparent: true } ),
    "Yellow glass": new THREE.MeshLambertMaterial( { color: 0xffffaa, opacity: 0.75, transparent: true } ),
    "Orange glass": new THREE.MeshLambertMaterial( { color: 0x995500, opacity: 0.75, transparent: true } ),

    "Orange glass 50":  new THREE.MeshLambertMaterial( { color: 0xffbb00, opacity: 0.5, transparent: true } ),
    "Red glass 50":   new THREE.MeshLambertMaterial( { color: 0xff0000, opacity: 0.5, transparent: true } ),

    "Fullblack rough":  new THREE.MeshLambertMaterial( { color: 0x000000 } ),
    "Black rough":    new THREE.MeshLambertMaterial( { color: 0x050505 } ),
    "Darkgray rough": new THREE.MeshLambertMaterial( { color: 0x090909 } ),
    "Red rough":    new THREE.MeshLambertMaterial( { color: 0x330500 } ),

    "Darkgray shiny": new THREE.MeshPhongMaterial( { color: 0x000000, specular: 0x050505 } ),
    "Gray shiny":   new THREE.MeshPhongMaterial( { color: 0x050505, shininess: 20 } )
  },

  modelInfo: {
    name: "Bugatti Veyron",
    url:  "obj/veyron/VeyronNoUv_bin.js",
    author: '<a href="http://artist-3d.com/free_3d_models/dnm/model_disp.php?uid=1129" target="_blank">Troyano</a>',
    init_rotation: [ 0, 0, 0 ],
    scale: 5.5,
    init_material: 4,
    body_materials: [ 2 ],
    object: null,
    buttons: null,
    materials: null
  },

  setupScene: function(onLoaded) {
    var self = this;
    var loader = new THREE.BinaryLoader(true);
    loader.load(this.modelInfo.url, function(geometry) {
      var modelInfo = self.modelInfo;
      var material = new THREE.MeshFaceMaterial();
      var scale = modelInfo.scale * 1;
      var rotation = modelInfo.init_rotation;
      var materials = modelInfo.materials;
      var initMaterial = modelInfo.init_material;
      var bodyMaterials = modelInfo.body_materials;
      for ( var i in modelInfo.materials.mmap ) {
        material.materials[ i ] = modelInfo.materials.mmap[ i ];
      }
      var mesh = new THREE.Mesh( geometry, material );
      mesh.rotation.x = rotation[ 0 ];
      mesh.rotation.y = rotation[ 1 ];
      mesh.rotation.z = rotation[ 2 ];
      mesh.scale.x = mesh.scale.y = mesh.scale.z = scale;
      var x = parseInt(self.style.getPropertyValue('--x')) || 0;
      var y = parseInt(self.style.getPropertyValue('--y')) || 0;
      var z = parseInt(self.style.getPropertyValue('--z')) || 0;
      mesh.position.set(x, y, -z);
      self.object3D = mesh;
      onLoaded();
    });
  }

});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('VRModel',this));
