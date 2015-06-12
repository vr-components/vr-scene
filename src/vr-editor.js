/* globals define */
(function(define){'use strict';define(function(require,exports,module){

var hud;
var pivot;
var objects;
var scene;
var camera;

var labelHoveredParent = document.createElement('div');
var labelHovered = document.createElement('div');
var selectedObject;
var hoveredObject;
labelHoveredParent.classList.add('label');
labelHovered.classList.add('label');

var selectObject = function(evt) {
  for (var i = 0; i < objects.length; ++i) {
    objects[i].classList.remove('selected');
  }
  selectedObject = evt.currentTarget;
  selectedObject.classList.add('selected');
  selectedObject.classList.remove('hover');
  selectedObject.parentNode.classList.remove('hover-parent');
  setUI(selectedObject);
  evt.stopPropagation();
};

var ui = {};

var setUI = function() {
  ui.x.setValue(parseInt(selectedObject.style.getPropertyValue('--x')) || 0);
  ui.y.setValue(parseInt(selectedObject.style.getPropertyValue('--y')) || 0);
  ui.z.setValue(parseInt(selectedObject.style.getPropertyValue('--y')) || 0);
  ui.rotX.setValue(parseInt(selectedObject.style.getPropertyValue('--rotX')) || 0);
  ui.rotY.setValue(parseInt(selectedObject.style.getPropertyValue('--rotY')) || 0);
  ui.rotZ.setValue(parseInt(selectedObject.style.getPropertyValue('--rotZ')) || 0);
};

var resetUI = function() {
  ui.x.setValue(0);
  ui.y.setValue(0);
  ui.z.setValue(0);
  ui.rotX.setValue(0);
  ui.rotY.setValue(0);
  ui.rotZ.setValue(0);
  hud = document.querySelector(".hud");
  pivot = document.querySelector(".pivot");
  camera = document.querySelector('.camera');
  objects = document.querySelectorAll("vr-object");
  attachEventListeners();
  attachMouseKeyboardListeners();
};

var initUI = function() {
  var uiObj = {
    x: 0,
    y: 0,
    z: 0,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    distance: 400,
    lat: 0,
    long: 0
  };
  var gui = new dat.GUI();
  var radius = ui.radius = gui.add(uiObj, 'distance', 0, 5000);
  var lat = ui.lat = gui.add(uiObj, 'lat', -180, 180).step(0.01);
  var long = ui.long = gui.add(uiObj, 'long', -180, 180).step(0.01);
  radius.onChange(function(value) {
    hud.style.setProperty('--z', value);
  });
  lat.onChange(function(value) {
    pivot.style.setProperty('--rotY', value);
  });
  long.onChange(function(value) {
    pivot.style.setProperty('--rotX', value);
  });

  var x = ui.x = gui.add(uiObj, 'x', -500, 500);
  var y = ui.y = gui.add(uiObj, 'y', -500, 500);
  var z = ui.z = gui.add(uiObj, 'z', -500, 500);
  var rotX = ui.rotX = gui.add(uiObj, 'rotX', -180, 180);
  var rotY = ui.rotY = gui.add(uiObj, 'rotY', -180, 180);
  var rotZ = ui.rotZ =  gui.add(uiObj, 'rotZ', -180, 180);
  x.onChange(function(value) {
    selectedObject.style.setProperty('--x', value);
  });
  y.onChange(function(value) {
    selectedObject.style.setProperty('--y', value);
  });
  z.onChange(function(value) {
    selectedObject.style.setProperty('--z', value);
  });
  rotX.onChange(function(value) {
    selectedObject.style.setProperty('--rotX', value);
  });
  rotY.onChange(function(value) {
    selectedObject.style.setProperty('--rotY', value);
  });
  rotZ.onChange(function(value) {
    selectedObject.style.setProperty('--rotZ', value);
  });
};

var mouseEntered = function(evt) {
  var el = evt.currentTarget;
  var elRect = el.getBoundingClientRect();
  var parentRect = el.parentNode.getBoundingClientRect();
  evt.stopPropagation();
  if (hoveredObject) {
    hoveredObject.classList.remove('hover');
    hoveredObject.parentNode.classList.remove('hover-parent');
  }
  hoveredObject = el;
  el.parentNode.classList.add('hover-parent');
  labelHovered.style.top = elRect.top + 'px';
  labelHovered.style.left = elRect.left + 'px';
  labelHovered.innerHTML = el.classList.item(0);
  labelHovered.style.display = 'block';
  labelHoveredParent.style.top = parentRect.top + 'px';
  labelHoveredParent.style.left = parentRect.left + 'px';
  labelHoveredParent.innerHTML = el.parentNode.classList.item(0);
  labelHoveredParent.style.display = 'block';
  if (el === selectedObject) {
    return;
  }
  el.classList.add('hover');
};

var mouseLeft = function(evt) {
  var el = evt.currentTarget;
  hoveredObject = null;
  el.classList.remove('hover');
  el.parentNode.classList.remove('hover-parent');
  labelHovered.style.display = 'none';
  labelHoveredParent.style.display = 'none';
  evt.stopPropagation();
};

var attachEventListeners = function() {
  var i;
  for (i=0; i < objects.length; ++i) {
    objects[i].addEventListener('click', selectObject);
    objects[i].addEventListener('mouseover', mouseEntered);
    objects[i].addEventListener('mouseout', mouseLeft);
  }
}

var attachMouseKeyboardListeners = function() {

  var x = 0;
  var y = 0;
  var z = 0;
  var rotX = 0;
  var rotY = 0;
  var lastMouseX;
  var lastMouseY;
  var rotationEnabled;
  var lastPress = Date.now();
  var keys = {};
  // key events
  window.addEventListener('keydown', function(event) {
    keys[event.keyCode] = true;
  }, false);

  window.addEventListener('keyup', function(event) {
    keys[event.keyCode] = false;
  }, false);

  window.requestAnimationFrame(updatePositions);

  function updatePositions() {
    var delta = 10;
    if (keys[65]) { // Left
      x += delta;
      camera.style.setProperty('--x', x);
    }
    if (keys[87]) { // Up
      z -= delta;
      camera.style.setProperty('--z', z);
    }
    if (keys[68]) { // Right
      x -= delta;
      camera.style.setProperty('--x', x);
    }
    if (keys[83]) { // Down
      z += delta;
      camera.style.setProperty('--z', z);
    }

    if (keys[90]) { // Z
      x = 0;
      y = 0;
      z = 0;
      rotX = 0;
      rotY = 0;
      var smooth = 0.4;
      camera.style.setProperty('--x', x);
      camera.style.setProperty('--y', y);
      camera.style.setProperty('--z', z);

      camera.style.setProperty('--rotX', rotY * smooth);
      camera.style.setProperty('--rotY', rotX * smooth);

      ui.radius.setValue(1000);
      ui.lat.setValue(0);
      ui.long.setValue(0);
      scene.resetSensor();
    }
    camera.style.setProperty('--rotX', rotY);
    camera.style.setProperty('--rotY', rotX);
    scene.animate();
    window.requestAnimationFrame(updatePositions);
  }

  scene.addEventListener('mousedown', function(event) {
    rotationEnabled = true;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
  }, true);
  scene.addEventListener('mouseup', function(event) {
    rotationEnabled = false;
  }, true);
  scene.addEventListener('mousemove', function(event) {
    if (!rotationEnabled) {
      return;
    }
    var deltaX = (event.clientX - lastMouseX) * 0.25;
    var deltaY = (event.clientY - lastMouseY) * 0.25;
    rotX += deltaX;
    rotY += deltaY;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
  }, true);

};

var loadEditor = function() {
    hud = document.querySelector(".hud");
    pivot = document.querySelector(".pivot");
    camera = document.querySelector('.camera');
    objects = document.querySelectorAll("vr-object");
    scene = document.querySelector("vr-scene");
    document.body.appendChild(labelHoveredParent);
    document.body.appendChild(labelHovered);
    attachEventListeners();
    attachMouseKeyboardListeners();
    initUI();
};

window.addEventListener('load', loadEditor, false);

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('VREditor',this));
