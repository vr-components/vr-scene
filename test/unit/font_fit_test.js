'use strict';

suite('font-fit.js', function() {
  var GaiaHeaderFontFit;

  const kDefaultFace = 'Arial';
  const kContainerWidth = 100;
  const kDefaultSize = 12;
  const kAllowedSizes = [8, 10, 14];
  const kStringChar = '#';
  const leftButtonWidth = 25;
  const rightButtonWidth = 55;

  function getMaxFontSizeInfo() {
    return GaiaHeaderFontFit._getMaxFontSizeInfo(text, kAllowedSizes,
      kDefaultFace, kContainerWidth);
  }

  var context;

  function getContext() {
    if (!context) {
      var canvas = document.createElement('canvas');
      canvas.setAttribute('moz-opaque', 'true');
      canvas.setAttribute('width', '1');
      canvas.setAttribute('height', '1');
      context = canvas.getContext('2d', { willReadFrequently: true });
    }
    return context;
  }

  function generateStringForPixels(width, fontSize, fontFace) {
    fontSize = fontSize || kDefaultSize;
    fontFace = fontFace || kDefaultFace;

    var ctx = getContext();
    ctx.font = 'italic ' + fontSize + 'px ' + fontFace;

    var str = kStringChar;
    while (ctx.measureText(str + kStringChar).width < width) {
      str += kStringChar;
    }

    return str;
  }

  var text;

  function setupSmallString(size, face) {
    text = generateStringForPixels(1, size, face);
    return text;
  }

  // string just barely smaller than the container width
  function setupMediumString(size, face) {
    text = generateStringForPixels(kContainerWidth, size, face);
    return text;
  }

  // string just barely larger than the container width
  function setupMediumPlusString(size, face) {
    text = generateStringForPixels(kContainerWidth + 1, size, face) +
      kStringChar;
    return text;
  }

  // way to large to ever fit anywhere
  function setupLargeString(size, face) {
    text = generateStringForPixels(kContainerWidth * 10, size, face);
    return text;
  }

  function setupHeaderElement() {
    var header = document.createElement('header');
    var headerText = document.createElement('h1');

    header.appendChild(headerText);

    headerText.style.overflow = 'hidden';
    headerText.style.textOverflow = 'ellipsis';
    headerText.style.width = kContainerWidth + 'px';
    // use maximum header fontSize
    var sizes = GaiaHeaderFontFit._HEADER_SIZES;
    headerText.style.fontSize = sizes[sizes.length - 1] + 'px';
    headerText.style.fontFamily = kDefaultFace;
    return headerText;
  }

  function setupHeaderElementWithButtons() {
    var headerText = setupHeaderElement();
    var header = headerText.parentNode;
    var leftButton = document.createElement('button');
    var rightButton = document.createElement('button');

    header.insertBefore(leftButton, headerText);
    header.appendChild(rightButton);

    header.style.width = (kContainerWidth + leftButtonWidth +
      rightButtonWidth) + 'px';

    leftButton.style.cssFloat = 'left';
    leftButton.style.width = leftButtonWidth + 'px';

    rightButton.style.cssFloat = 'right';
    rightButton.style.width = rightButtonWidth + 'px';

    headerText.style.margin = '0';
    // use maximum header fontSize
    var sizes = GaiaHeaderFontFit._HEADER_SIZES;
    headerText.style.fontSize = sizes[sizes.length - 1] + 'px';
    headerText.style.fontFamily = kDefaultFace;
    return headerText;
  }

  function getMaxHeaderFontSize() {
    var sizes = GaiaHeaderFontFit._HEADER_SIZES;
    return sizes[sizes.length - 1];
  }

  function getMinHeaderFontSize() {
    var sizes = GaiaHeaderFontFit._HEADER_SIZES;
    return sizes[0];
  }

  function lazyLoad(element) {
    document.body.appendChild(element);
    window.dispatchEvent(new CustomEvent('lazyload', {
      detail: element
    }));
  }

  setup(function() {
    GaiaHeaderFontFit = window['./font-fit'];
    this.sandbox = sinon.sandbox.create();
    text = '';
  });

  teardown(function() {
    GaiaHeaderFontFit.resetCache();
    this.sandbox.restore();
  });

  suite('Global', function() {
    test('GaiaHeaderFontFit exists', function() {
      assert.ok(GaiaHeaderFontFit);
    });
  });

  suite('Cache Mechanism', function() {
    test('Created', function() {
      GaiaHeaderFontFit._getCachedContext(kDefaultSize, kDefaultFace);

      assert.equal(Object.keys(GaiaHeaderFontFit._cachedContexts).length, 1);
    });

    test('Used', function() {
      var oldContext = GaiaHeaderFontFit._getCachedContext(kDefaultSize,
        kDefaultFace);
      var newContext = GaiaHeaderFontFit._getCachedContext(kDefaultSize,
        kDefaultFace);

      assert.equal(oldContext, newContext);
    });

    test('Cleared', function() {
      GaiaHeaderFontFit._getCachedContext(kDefaultSize, kDefaultFace);
      GaiaHeaderFontFit.resetCache();

      assert.equal(Object.keys(GaiaHeaderFontFit._cachedContexts).length, 0);
    });

    test('Created for specified font [size/face]', function() {
      getMaxFontSizeInfo();

      for (var i = 0; i < kAllowedSizes.length; i++) {
        assert.ok(GaiaHeaderFontFit._getCachedContext(kAllowedSizes[i],
          kDefaultFace));
      }
    });
  });

  suite('GaiaHeaderFontFit.getMaxFontSizeInfo(Small text)', function() {
    setup(function() {
      setupSmallString();
    });

    test('Returns max font size', function() {
      var infos = getMaxFontSizeInfo();
      assert.equal(infos.fontSize, kAllowedSizes[kAllowedSizes.length - 1]);
    });

    test('No overflow', function() {
      var infos = getMaxFontSizeInfo();
      assert.isFalse(infos.overflow);
    });
  });

  suite('GaiaHeaderFontFit.getMaxFontSizeInfo(Medium text)', function() {
    setup(function() {
      setupMediumString();
    });

    test('Returns middle font size', function() {
      var infos = getMaxFontSizeInfo();
      assert.equal(infos.fontSize, kAllowedSizes[1]);
    });

    test('overflow is false', function() {
      var infos = getMaxFontSizeInfo();
      assert.isFalse(infos.overflow);
    });
  });

  suite('GaiaHeaderFontFit.getMaxFontSizeInfo(Large Text)', function() {
    setup(function() {
      setupLargeString();
    });

    test('Returns min font size', function() {
      var infos = getMaxFontSizeInfo();
      assert.equal(infos.fontSize, kAllowedSizes[0]);
    });

    test('Overflow is true', function() {
      var infos = getMaxFontSizeInfo();
      assert.isTrue(infos.overflow);
    });
  });

  suite('GaiaHeaderFontFit._getTextChangeObserver', function() {
    test('Should only ever return 1 mutation observer', function() {
      var m1 = GaiaHeaderFontFit._getTextChangeObserver();
      var m2 = GaiaHeaderFontFit._getTextChangeObserver();

      assert.isTrue(m1 instanceof MutationObserver);
      assert.equal(m1, m2);
    });
  });

  suite('GaiaHeaderFontFit._getFontWidth', function() {
    test('Should measureText correctly for multiple fontSizes', function() {
      var string = 'arbitrary' + Date.now();
      var ctx = getContext();
      // test 2px up to 24px font size measurements
      for (var fontSize = 2; fontSize < 24; fontSize++) {
        ctx.font = 'italic ' + fontSize + 'px ' + kDefaultFace;
        assert.equal(ctx.measureText(string).width,
          GaiaHeaderFontFit._getFontWidth(string, fontSize,
            kDefaultFace));
      }
    });
  });

  suite('GaiaHeaderFontFit._resetCentering', function() {
    test('Should reset margin of header elements', function() {
      var el = setupHeaderElement();
      el.style.marginLeft = el.style.marginRight = '10px';
      GaiaHeaderFontFit._resetCentering(el);
      assert.equal(parseInt(el.style.marginLeft, 10), 0);
      assert.equal(parseInt(el.style.marginRight, 10), 0);
    });
  });

  suite('GaiaHeaderFontFit._autoResizeElement', function() {
    test('Should not resize a small header title', function() {
      var el = setupHeaderElement();
      var fontSizeBefore = getComputedStyle(el).fontSize;
      var style = GaiaHeaderFontFit._getStyleProperties(el);

      el.textContent = setupSmallString(fontSizeBefore);
      GaiaHeaderFontFit._autoResizeElement(el, style);

      assert.equal(fontSizeBefore, getComputedStyle(el).fontSize);
    });

    test('Should not resize a medium header title', function() {
      var el = setupHeaderElement();
      var fontSizeBefore = getComputedStyle(el).fontSize;
      var style = GaiaHeaderFontFit._getStyleProperties(el);

      el.textContent = setupMediumString(parseInt(fontSizeBefore));
      GaiaHeaderFontFit._autoResizeElement(el, style);

      assert.equal(fontSizeBefore, getComputedStyle(el).fontSize);
    });

    test('Should resize a barely overflowing header title', function() {
      var el = setupHeaderElement();
      var fontSizeBefore = getComputedStyle(el).fontSize;
      var style = GaiaHeaderFontFit._getStyleProperties(el);

      el.textContent = setupMediumPlusString(parseInt(fontSizeBefore));
      GaiaHeaderFontFit._autoResizeElement(el, style);

      assert.notEqual(fontSizeBefore, getComputedStyle(el).fontSize);
    });

    test('Should resize to minimum a very long header title', function() {
      var el = setupHeaderElement();
      var fontSizeBefore = '50px';
      el.style.fontSize = fontSizeBefore;
      var style = GaiaHeaderFontFit._getStyleProperties(el);

      el.textContent = setupLargeString(parseInt(fontSizeBefore));
      GaiaHeaderFontFit._autoResizeElement(el, style);

      assert.notEqual(getMinHeaderFontSize(), getComputedStyle(el).fontSize);
    });
  });

  /*suite('GaiaHeaderFontFit auto resize Mutation Observer', function() {
    test('Should auto-resize back up when text changes', function(done) {
      var el = setupHeaderElement();
      el.textContent = setupLargeString();

      // When we get an overflow event, make sure we have auto-resized
      // to the minimum possible font size for the large string.
      el.addEventListener('overflow', function onOverflow() {
        el.removeEventListener('overflow', onOverflow);
        assert.equal(parseInt(getComputedStyle(el).fontSize),
                     getMinHeaderFontSize());

        // Now set the smallest string possible, and make sure we have
        // auto-resized back to the maximum possible font size.
        el.textContent = setupSmallString();
        el.addEventListener('underflow', function onUnderflow() {
          el.removeEventListener('underflow', onUnderflow);
          assert.equal(parseInt(getComputedStyle(el).fontSize),
                       getMaxHeaderFontSize());

          // Clean up.
          el.parentNode.removeChild(el);
          done();
        });
      });

      lazyLoad(el.parentNode);
    });
  });*/

  suite('GaiaHeaderFontFit._getContentWidth', function() {
    var el;

    setup(function() {
      el = document.createElement('div');
      el.style.width = '50px';
      el.style.padding = '10px';
      document.body.appendChild(el);
    });

    teardown(function() {
      document.body.removeChild(el);
    });

    test('Should compute the width of content-box element', function() {
      el.style.boxSizing = 'content-box';
      var style = getComputedStyle(el);
      var styleWidth = parseInt(style.width, 10);
      var actualWidth = GaiaHeaderFontFit._getContentWidth(style);

      assert.equal(styleWidth, 50);
      assert.equal(actualWidth, 50);
    });

    test('Should compute the width of border-box element', function() {
      el.style.boxSizing = 'border-box';
      var style = getComputedStyle(el);
      var styleWidth = parseInt(style.width, 10);
      var actualWidth = GaiaHeaderFontFit._getContentWidth(style);

      assert.equal(styleWidth, 50);
      assert.equal(actualWidth, 30);
    });
  });

  suite('GaiaHeaderFontFit.centerTextToScreen', function() {
    setup(function() {
      // Body often has a default margin which needs to be removed
      // for the centering logic to work like it does in apps.
      document.body.style.margin = '0';

      // We have to stub window width incase tests
      // are run inside different window sizes
      this.sandbox.stub(GaiaHeaderFontFit, '_getWindowWidth', function() {
        return kContainerWidth + leftButtonWidth + rightButtonWidth;
      });
    });

    test('Should center a small header title', function() {
      var el = setupHeaderElementWithButtons();
      var fontSizeBefore = getComputedStyle(el).fontSize;

      el.textContent = setupSmallString(fontSizeBefore);
      document.body.appendChild(el.parentNode);

      GaiaHeaderFontFit.reformatHeading(el);

      var margin = Math.max(leftButtonWidth, rightButtonWidth);
      assert.equal(parseInt(el.style.marginLeft, 10), margin - leftButtonWidth);
      assert.equal(parseInt(el.style.marginRight, 10), margin - rightButtonWidth);

      // Clean up.
      document.body.removeChild(el.parentNode);
    });

    test('Should not center a medium header title', function() {
      var el = setupHeaderElementWithButtons();
      var fontSizeBefore = getComputedStyle(el).fontSize;

      el.textContent = setupMediumString(parseInt(fontSizeBefore));
      document.body.appendChild(el.parentNode);

      GaiaHeaderFontFit.reformatHeading(el);

      assert.equal(parseInt(el.style.marginLeft, 10), 0);
      assert.equal(parseInt(el.style.marginRight, 10), 0);

      // Clean up.
      document.body.removeChild(el.parentNode);
    });

    test('Should not center a barely overflowing header title', function() {
      var el = setupHeaderElementWithButtons();
      var fontSizeBefore = getComputedStyle(el).fontSize;

      el.textContent = setupMediumPlusString(parseInt(fontSizeBefore));
      document.body.appendChild(el.parentNode);

      GaiaHeaderFontFit.reformatHeading(el);

      assert.equal(parseInt(el.style.marginLeft, 10), 0);
      assert.equal(parseInt(el.style.marginRight, 10), 0);

      // Clean up.
      document.body.removeChild(el.parentNode);
    });

    test('Should not center a very long header title', function() {
      var el = setupHeaderElementWithButtons();
      var fontSizeBefore = getComputedStyle(el).fontSize;

      el.textContent = setupLargeString(parseInt(fontSizeBefore));
      document.body.appendChild(el.parentNode);

      GaiaHeaderFontFit.reformatHeading(el);

      assert.equal(parseInt(el.style.marginLeft, 10), 0);
      assert.equal(parseInt(el.style.marginRight, 10), 0);

      // Clean up.
      document.body.removeChild(el.parentNode);
    });

    test('Should not truncate a small header title', function() {
      var el = setupHeaderElementWithButtons();
      var fontSizeBefore = getComputedStyle(el).fontSize;

      el.textContent = setupSmallString(fontSizeBefore);
      document.body.appendChild(el.parentNode);

      GaiaHeaderFontFit.reformatHeading(el);

      // Clean up.
      document.body.removeChild(el.parentNode);
    });

    test('Should not truncate a medium header title', function() {
      var el = setupHeaderElementWithButtons();
      var fontSizeBefore = getComputedStyle(el).fontSize;

      el.textContent = setupMediumString(parseInt(fontSizeBefore));
      document.body.appendChild(el.parentNode);

      GaiaHeaderFontFit.reformatHeading(el);

      // Clean up.
      document.body.removeChild(el.parentNode);
    });

    test('It adds padding if text is flush with container', function() {
      var el = setupHeaderElement();

      // Set title to fill window width
      el.style.width = GaiaHeaderFontFit._getWindowWidth() + 'px';

      el.textContent = 'Fooovadvdaivdanviadvnadivnadvinadivnadviadnvadivadivinadiviadvnadivnadvinadivnadviadnvadivadivinadiviadvnadivnadvinadivnadviadnvadivadivinadivi';

      document.body.appendChild(el.parentNode);

      GaiaHeaderFontFit.reformatHeading(el);
      assert.isTrue(el.classList.contains('flush-left'));
      assert.isTrue(el.classList.contains('flush-right'));

      document.body.removeChild(el.parentNode);
    });

    test('It adds padding if text is flush with container', function() {
      var el = setupHeaderElementWithButtons();

      el.textContent = 'Fooovadvdaivdanviadvnadivnadvinadivnadviadnvadivadivinadiviadvnadivnadvinadivnadviadnvadivadivinadiviadvnadivnadvinadivnadviadnvadivadivinadivi';

      document.body.appendChild(el.parentNode);

      GaiaHeaderFontFit.reformatHeading(el);
      assert.isFalse(el.classList.contains('flush-left'));
      assert.isFalse(el.classList.contains('flush-right'));

      document.body.removeChild(el.parentNode);
    });

    test('Should truncate a barely overflowing header title', function(done) {
      var el = setupHeaderElementWithButtons();
      var fontSizeBefore = getComputedStyle(el).fontSize;

      el.textContent = setupMediumPlusString(parseInt(fontSizeBefore));
      document.body.appendChild(el.parentNode);

      el.addEventListener('overflow', function onOverflow() {
        el.removeEventListener('overflow', onOverflow);

        // Clean up.
        document.body.removeChild(el.parentNode);
        done();
      });
    });

    test('Should truncate a very long header title', function(done) {
      var el = setupHeaderElementWithButtons();
      var fontSizeBefore = getComputedStyle(el).fontSize;

      el.textContent = setupLargeString(parseInt(fontSizeBefore));
      document.body.appendChild(el.parentNode);

      el.addEventListener('overflow', function onOverflow() {
        el.removeEventListener('overflow', onOverflow);

        // Clean up.
        document.body.removeChild(el.parentNode);
        done();
      });
    });
  });

  /*suite('Lazy-Loading DOM MutationObserver', function() {
    test('Lazy loaded header should cause reformat', function(done) {
      var el = setupHeaderElement();
      el.textContent = setupLargeString();

      var stub = sinon.stub(GaiaHeaderFontFit, 'reformatHeading', function() {
        document.body.removeChild(el.parentNode);
        stub.restore();
        assert.isTrue(stub.calledWith(el));
        done();
      });

      lazyLoad(el.parentNode);
    });
  });*/
});
