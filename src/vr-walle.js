/* globals define */
(function(define){'use strict';define(function(require,exports,module){

/**
 * Dependencies
 */

var component = require('gaia-component');


// .sprite { background: url('sprite.png') no-repeat top left; width: 270px; height: 343px;  }
// .sprite.arm-back { background-position: 0 0; width: 202px; height: 73px; }
// .sprite.arm-bottom { background-position: 0 -83px; width: 203px; height: 34px; }
// .sprite.arm { background-position: 0 -127px; width: 232px; height: 73px; }
// .sprite.body-back { background-position: 0 -210px; }
// .sprite.body-bottom { background-position: 0 -563px; width: 274px; height: 273px; }
// .sprite.body-front { background-position: 0 -846px; }
// .sprite.body-left { background-position: 0 -1199px; }
// .sprite.body-right { background-position: 0 -1552px; }
// .sprite.body-top { background-position: 0 -1905px; width: 274px; height: 273px; }
// .sprite.eyes { background-position: 0 -2188px; height: 110px; }
// .sprite.finger-tip { background-position: 0 -2308px; width: 51px; height: 58px; }
// .sprite.finger { background-position: 0 -2376px; width: 71px; height: 58px; }
// .sprite.forearm-cap { background-position: 0 -2444px; width: 39px; height: 42px; }
// .sprite.forearm { background-position: 0 -2496px; width: 189px; height: 31px; }
// .sprite.head-big { background-position: 0 -2537px; width: 207px; height: 125px; }
// .sprite.head-leftright { background-position: 0 -2672px; width: 14px; height: 130px; }
// .sprite.head-front-back { background-position: 0 -2812px; width: 209px; height: 14px; }
// .sprite.neck-base { background-position: 0 -2836px; width: 35px; height: 42px; }
// .sprite.neck-cap { background-position: 0 -2888px; width: 47px; height: 42px; }
// .sprite.neck-low { background-position: 0 -2940px; width: 170px; height: 37px; }
// .sprite.neck-high { background-position: 0 -2987px; width: 137px; height: 19px; }
// .sprite.shoulder-cap { background-position: 0 -3016px; width: 84px; height: 82px; }
// .sprite.shoulder-left { background-position: 0 -3108px; width: 65px; height: 105px; }
// .sprite.wheel { background-position: 0 -3223px; width: 54px; height: 137px; }
// .sprite.wrist { background-position: 0 -3370px; width: 148px; height: 18px; }

/**
 * Simple logger
 * @type {Function}
 */
var debug = 0 ? console.log.bind(console) : function() {};

/**
 * Exports
 */
module.exports = component.register('vr-walle', {
  extends: VRObject.prototype,


  template: `
    <div class="ground"></div>

    <div class="walle">

      <div class="body">
        <div class="sprite body-back"></div>
        <div class="sprite body-left"></div>
        <div class="sprite body-right"></div>
        <div class="sprite body-front"></div>
        <div class="sprite body-top"></div>
        <!-- <div class="sprite body-bottom"></div> -->
      </div>

      <div class="head">
        <div class="sprite head-big bottom"></div>
        <div class="sprite head-big top"></div>
        <div class="sprite head-leftright left"></div>
        <div class="sprite head-leftright right"></div>
        <div class="sprite head-front-back back"></div>
        <div class="sprite eyes"></div>
        <div class="sprite neck-low"></div>
        <div class="sprite neck-high"></div>
      </div>

      <div class="sprite arm left">
        <div class="sprite forearm">
          <div class="sprite wrist">
              <div class="sprite finger thumb">
                <div class="sprite finger-tip"></div>
              </div>
              <div class="sprite finger index">
                <div class="sprite finger-tip"></div>
              </div>
              <div class="sprite finger pinky">
                <div class="sprite finger-tip"></div>
              </div>
          </div>
        </div>
      </div>

      <div class="sprite arm right">
        <div class="sprite forearm">
          <div class="sprite wrist">
              <div class="sprite finger thumb">
                <div class="sprite finger-tip"></div>
              </div>
              <div class="sprite finger index">
                <div class="sprite finger-tip"></div>
              </div>
              <div class="sprite finger pinky">
                <div class="sprite finger-tip"></div>
              </div>
          </div>
        </div>
      </div>

      <div class="sprite wheel left">
        <div class="sprite belt bottom"></div>
        <div class="sprite belt back"></div>
        <div class="sprite belt front"></div>
      </div>

      <div class="sprite wheel right">
        <div class="sprite belt bottom"></div>
        <div class="sprite belt back"></div>
        <div class="sprite belt front"></div>
      </div>

    </div>

    <style>
    :host {
      left: 50%;
      top: 50%;
      position: absolute;
      transform-style: preserve-3d;
    }

    .walle {
      position: absolute:
      transform-style: preserve-3d;
    }

    .sprite {
      position: absolute;
      background: url('textures/walle/png/atlas.png') no-repeat top left; width: 270px; height: 343px;
      transform-style: preserve-3d;
    }

    .sprite.body-front {
      background-position: 0 -846px;
    }

    .sprite.body-back {
      background-position: 0 -210px;
      transform: translate3d(0, 0, -270px);
    }

    .sprite.body-left {
      background-position: 0 -1199px;
      transform: translate3d(-135px, 0, -135px) rotateY(90deg);
    }

    .sprite.body-right {
      background-position: 0 -1552px;
      transform: translate3d(135px, 0, -135px) rotateY(90deg) scaleX(-1);
    }

    .sprite.body-top {
      background-position: 0 -1905px; width: 274px; height: 273px;
      transform: translate3d(0, -135px, -135px) rotateX(90deg);
    }

    .sprite.body-bottom {
      background-position: 0 -563px; width: 274px; height: 273px;
      transform: translate3d(0, 210px, -135px) rotateX(90deg);
    }

    .sprite.eyes {
      background-position: 0 -2188px; height: 110px;
      transform: translate3d(0, -210px, -80px);
    }

    .sprite.head-big {
      background-position: 0 -2537px; width: 207px; height: 125px;
    }

    .sprite.head-big.top {
      transform: translate3d(0, -240px, -140px) rotateX(90deg);
    }

    .sprite.head-big.bottom {
      transform: translate3d(0, -220px, -140px) rotateX(90deg);
    }

    .sprite.head-leftright {
      background-position: 0 -2672px; width: 14px; height: 130px;
    }

    .sprite.head-leftright.left {
      transform: translate3d(0, -230px, -140px) rotateZ(90deg) rotateX(90deg);
    }

    .sprite.head-leftright.right {
      transform: translate3d(207px, -230px, -140px) rotateZ(90deg) rotateX(90deg);
    }

    .sprite.head-front-back {
      background-position: 0 -2812px; width: 209px; height: 14px;
      transform: translate3d(0, -170px, -205px);
    }

    .sprite.arm.left {
      background-position: 0 -127px; width: 232px; height: 73px;
      transform: translate3d(-136px, 30px, 0) rotateY(-90deg);
    }

    .sprite.arm.right {
      background-position: 0 -127px; width: 232px; height: 73px;
      transform: translate3d(180px, -60px, -60px) rotateX(60deg) rotateY(-90deg);
    }

    .sprite.forearm {
      background-position: 0 -2496px; width: 189px; height: 31px;
      transform: translate3d(159px, 16px, 0);
    }

    .sprite.wrist {
      background-position: 0 -3370px; width: 148px; height: 18px;
      transform: translate3d(100px, 9px, 0);
    }

    .sprite.finger {
      background-position: 0 -2376px; width: 71px; height: 58px;
    }

    .sprite.finger.thumb {
      transform: rotateX(90deg) translate3d(145px, 0px, 0) rotateY(15deg);
    }

    .sprite.finger.index {
      transform: rotateX(90deg) translate3d(145px, 25px, 40px) rotateY(-15deg);
    }

    .sprite.finger.pinky {
      transform: rotateX(90deg) translate3d(145px, -25px, 40px) rotateY(-15deg);
    }

    .sprite.finger-tip { background-position: 0 -2308px; width: 51px; height: 58px; }

    .sprite.finger.thumb .finger-tip {
      transform: translate3d(60px, 0px, 5px) rotateY(-15deg);
    }

    .sprite.finger.index .finger-tip,
    .sprite.finger.pinky .finger-tip {
      transform: translate3d(60px, 0px, -5px) rotateY(15deg);
    }

    .wheel.left {
      transform: translate3d(-120px, 200px, -150px) rotateY(-90deg) rotateX(-90deg) scale(0.8);
      background: none;
    }

    .wheel.right {
      transform: translate3d(300px, 200px, -150px) rotateY(-90deg) rotateX(-90deg) scale(0.8);
      background: none;
    }

    .belt {
      background: url('textures/walle/wheel.png');
      height: 137px;
      width: calc(54px * 6);
      background-repeat: repeat-x;
    }

    .belt.back {
      width: calc(54px * 4);
      transform-origin: left 50%;
      transform: rotateY(90deg);
    }

    .belt.front {
      width: calc(54px * 7.2);
      transform-origin: right 50%;
      transform: translate3d(calc(-1.2 * 54px), 0, 0) rotateY(-34deg);
    }

    .sprite.neck-low { background-position: 0 -2940px; width: 170px; height: 37px; }

    .sprite.neck-low {
      transform-origin: right 50%;
      transform: translate3d(-35px, 0, -200px) rotateZ(90deg) rotateY(40deg)
    }

    .sprite.neck-high { background-position: 0 -2987px; width: 137px; height: 19px; }

    .sprite.neck-high {
      transform-origin: right 50%;
      transform: translate3d(0, -120px, -90px) rotateZ(90deg) rotateY(-60deg)
    }

    .ground {
      width: 2048px;
      height: 2048px;
      transform-origin: left 50%;
      background-color: green;
      position: absolute;
      transform: translate3d(-50%, calc(-50% + 350px), 0) rotateX(90deg);
      transform-style: preserve-3d;
      background: url('textures/walle/sand.jpg') repeat;
    }

    </style>
  `

});

});})(typeof define=='function'&&define.amd?define
:(function(n,w){'use strict';return typeof module=='object'?function(c){
c(require,exports,module);}:function(c){var m={exports:{}};c(function(n){
return w[n];},m.exports,m);w[n]=m.exports;};})('VRWalle',this));
