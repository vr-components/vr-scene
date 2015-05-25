/* global marionette */

'use strict';

marionette('index.html >', function() {
  var assert = require('assert');
  var client = marionette.client();

  setup(function() {
    client.setSearchTimeout('20000');
    client.goUrl('file://' + __dirname + '/index.html');
  });

  test('content of page', function() {
    var title = client.findElement('#title');
    var el = client.findElement('gaia-header');
    assert.equal(title.text(), 'Messages');
  });
});
