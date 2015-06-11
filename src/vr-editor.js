/* globals define */
(function(define){'use strict';define(function(require,exports,module){


var loadEditor = function() {

    var objects = document.querySelectorAll("vr-object");
    var scene = document.querySelector("vr-scene");
    var selectedObject;
    var hoveredObject;
    var i;
    var selectObject = function(evt) {
      for (var i = 0; i < objects.length; ++i) {
        objects[i].classList.remove('selected');
      }
      selectedObject = evt.currentTarget;
      selectedObject.classList.add('selected');
      selectedObject.classList.remove('hover');
      selectedObject.parentNode.classList.remove('hover-parent');
      xObj.x = parseInt(selectedObject.style.getPropertyValue('--x')) || 0;
      yObj.y = parseInt(selectedObject.style.getPropertyValue('--y')) || 0;
      evt.stopPropagation();
    };

    var mouseEntered = function(evt) {
      var el = evt.currentTarget;
      evt.stopPropagation();
      if (hoveredObject) {
        hoveredObject.classList.remove('hover');
        hoveredObject.parentNode.classList.remove('hover-parent');
      }
      if (el === selectedObject) {
        return;
      }
      hoveredObject = el;
      el.classList.add('hover');
      el.parentNode.classList.add('hover-parent');
    };

    var mouseLeft = function(evt) {
      var el = evt.currentTarget;
      hoveredObject = null;
      el.classList.remove('hover');
      el.parentNode.classList.remove('hover-parent');
      evt.stopPropagation();
    };

    for (i=0; i < objects.length; ++i) {
      objects[i].addEventListener('click', selectObject);
      objects[i].addEventListener('mouseover', mouseEntered);
      objects[i].addEventListener('mouseout', mouseLeft);
    }

    var hud = document.querySelector(".hud");
    var pivot = document.querySelector(".pivot");
    var camera = document.querySelector('.camera');
    var distObj = {
      distance: 400,
    };
    var latObj = {
      lat: 0,
    };
    var longObj = {
      long: 0,
    };
    var gui = new dat.GUI();
    var radius = gui.add(distObj, 'distance', 0, 5000);
    var lat = gui.add(latObj, 'lat', -180, 180).step(0.01);
    var long = gui.add(longObj, 'long', -180, 180).step(0.01);
    radius.onChange(function(value) {
      hud.style.setProperty('--z', value);
    });
    lat.onChange(function(value) {
      pivot.style.setProperty('--rotY', value);
    });
    long.onChange(function(value) {
      pivot.style.setProperty('--rotX', value);
    });
    var xObj = {
      x: 0
    };
    var yObj = {
      y: 0
    };
    var zObj = {
      z: 0
    };
    var rotXObj = {
      rotX: 0
    };
    var rotYObj = {
      rotY: 0
    };
    var rotZObj = {
      rotZ: 0
    };
    var x = gui.add(xObj, 'x', -500, 500);
    var y = gui.add(yObj, 'y', -500, 500);
    var z = gui.add(zObj, 'z', -500, 500);
    var rotX = gui.add(rotXObj, 'rotX', -180, 180);
    var rotY = gui.add(rotYObj, 'rotY', -180, 180);
    var rotZ = gui.add(rotZObj, 'rotZ', -180, 180);
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

    var x = 0;
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

        radius.setValue(1000);
        lat.setValue(0);
        long.setValue(0);
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

}

window.addEventListener('load', loadEditor, false);

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('VRModel',this));
