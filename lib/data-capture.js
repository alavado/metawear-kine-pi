const SensorConfig = require('./sensor-config.js')
var path = require('path');
var util = require("util");
var MetaWear = require('metawear');
var fs = require('fs');
var Session = undefined;

module.exports.prepareMetaCloud = function(device, name) {
  if (Session === undefined) {
    Session = require('metacloud').Session;
  }
  return Session.create(device.firmwareRevision, device.address, device.modelDescription, name, 'MetaBase', '1.0.0');
}

module.exports.createState = function(capture, sensor, options) {
  let state = {}

  if ('csv' in options) {
    let csv = options['csv'];
    let stream = fs.createWriteStream(path.join(csv['root'], util.format("%s_%s_%s.csv", csv['now'], csv['address'].toUpperCase().replace(/:/g, ""), sensor)));
    SensorConfig[sensor].csvHeader(stream);
  
    state['csv'] = stream;
  }

  if ('metacloud' in options) {
    state['metacloud'] = options['metacloud'];
  }

  capture(MetaWear.FnVoid_DataP.toPointer(pointer => SensorConfig[sensor].writeValue(pointer.deref(), state)));

  return state;
}