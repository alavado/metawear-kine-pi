var SensorConfig = require('./sensor-config.js')
var MetaWear = require('metawear');
var winston = require('winston');
var moment = require("moment");
var fs = require('fs');
var util = require('util');
const BleConn = require('./ble-conn.js')
const DataCapture = require('./data-capture.js');

var identifierToName = {
  'acceleration': 'Accelerometer',
  'illuminance': 'Ambient Light',
  'pressure': 'Pressure',
  'relative-humidity': 'Humidity',
  'angular-velocity': 'Gyroscope',
  'magnetic-field': 'Magnetometer',
  'quaternion': 'Quaternion',
  'euler-angles': 'Euler Angles',
  'gravity': 'Gravity',
  'linear-acceleration': 'Linear Acceleration'
}

// adopted from https://stackoverflow.com/a/34325723
function printProgress(iteration, total, prefix, suffix, decimals, bar_length) {
  let percents = (100 * (iteration / parseFloat(total))).toFixed(decimals)
  let filled_length = parseInt(Math.round(bar_length * iteration / parseFloat(total)))

  let bar = '';
  for(let i = 0; i < filled_length; i++) {
    bar+= '█';
  }
  for(let i = 0; i < (bar_length - filled_length); i++) {
    bar+= '-';
  }

  process.stdout.write(util.format('\r%s |%s| %s%s %s', prefix, bar, percents, '%', suffix))

  if(iteration == total) {
      process.stdout.write('\n')
  }
}

module.exports = async function(config, cache, cacheFile) {
  var devices = [];
  for(let d of config['devices']) {
    winston.info("Connecting to device", { 'mac': d['mac'] });
    try {
      let device = await BleConn.findDevice(d['mac']);
      await BleConn.connect(device, true, cache);
      await BleConn.serializeDeviceState(device, cacheFile, cache)
      
      let name = device._peripheral['advertisement']['manufacturerData'] === undefined ? 
        ('name' in d ? d['name'] : 'MetaWear') :
        (device._peripheral['advertisement']['manufacturerData'].toString('ascii', 2))
      devices.push([device, name]);
    } catch (e) {
      winston.warn(e, {'mac': d['mac']});
    }
  }

  await new Promise((resolve, reject) => setTimeout(() => resolve(null)), 1000);

  let tasks = [];
  let valid = [];
  for(let it of devices) {
    let d = it[0]
    try {
      winston.info("Syncing log information", { 'mac': d.address });
      it.push(await new Promise((resolve, reject) => MetaWear.mbl_mw_metawearboard_create_anonymous_datasignals(d.board,
        MetaWear.FnVoid_MetaWearBoardP_AnonymousDataSignalP_UInt.toPointer((board, anonymousSignals, size) => {
          if (anonymousSignals) {
            if (size == 0) {
              reject("device is not logging any sensor data")
            } else {
              anonymousSignals.length = size;
              resolve(anonymousSignals);
            }
          } else {
            reject("failed to create anonymous data signals (status = " + size + ")");
          }
        }
      ))));
      valid.push(it)
      tasks.push(new Promise((resolve, reject) => d.once('disconnect', () => resolve(null))))
      MetaWear.mbl_mw_debug_reset(d.board)
    } catch (e) {
      winston.warn(e, {'mac': d.address})
      MetaWear.mbl_mw_debug_disconnect(d.board)
    }
  }

  await Promise.all(tasks);

  var states = []
  for(let it of valid) {
    let d = it[0]
    await BleConn.reconnect(d, 3);
    await new Promise((resolve, reject) => setTimeout(() => resolve(null)), 1000);

    var session = undefined;
    if ('cloudLogin' in config) {
      session = DataCapture.prepareMetaCloud(d, it[1]);
    }

    for (let i = 0; i < it[2].length; i++) {
      let options = {
        csv: {
          root: config['csv'],
          now: '@',
          address: d.address,
        }
      }
      if (session !== undefined) {
        options['metacloud'] = session;
      }

      states.push(DataCapture.createState((handler) => MetaWear.mbl_mw_anonymous_datasignal_subscribe(it[2][i], handler), 
          identifierToName[MetaWear.mbl_mw_anonymous_datasignal_get_identifier(it[2][i])], options));
    }

    await new Promise((resolve, reject) => {
      var downloadHandler = new MetaWear.LogDownloadHandler();
      downloadHandler.received_progress_update = MetaWear.FnVoid_UInt_UInt.toPointer((entriesLeft, totalEntries) => {
        printProgress(totalEntries - entriesLeft, totalEntries, "Progress", "Complete", 1, 50);
        if (entriesLeft === 0) {
          resolve(null);
        }
      });
      downloadHandler.received_unknown_entry = MetaWear.FnVoid_UByte_Long_UByteP_UByte.toPointer((id, epoch, data, length) => {
        winston.warn('received_unknown_entry', { 'mac': d.address });
      });
      downloadHandler.received_unhandled_entry = MetaWear.FnVoid_DataP.toPointer(dataPtr => {
        var data = dataPtr.deref();
        var dataPoint = data.parseValue();
        winston.warn('received_unhandled_entry: ' + dataPoint, { 'mac': d.address });
      });

      winston.info("Downloading log", { 'mac': d.address });
      // Actually start the log download, this will cause all the handlers we setup to be invoked
      MetaWear.mbl_mw_logging_download(d.board, 100, downloadHandler.ref());
    });

    winston.info("Download completed", { 'mac': d.address });
    MetaWear.mbl_mw_macro_erase_all(d.board)
    MetaWear.mbl_mw_debug_reset_after_gc(d.board)

    var task = new Promise((resolve, reject) => d.once('disconnect', () => resolve(null)));
    MetaWear.mbl_mw_debug_disconnect(d.board);
    await task;

    await Promise.all(states.map(s => {
      s['csv'].end();
      return new Promise((resolve, reject) => fs.rename(s['path'], s['path'].replace(/@/g, moment(s['first']).format("YYYY-MM-DDTHH-mm-ss.SSS")), err => {
        if (err) reject(err)
        else resolve(null)
      }))
    }))
  }

  process.exit(0)
}