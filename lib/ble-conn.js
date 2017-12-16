var MetaWear = require('metawear');
var winston = require('winston');

async function connect(device, deserialize, cache) {
  await new Promise((resolve, reject) => {
    var timeout = setTimeout(() => reject("Failed to initialize SDK"), 10000);

    var initBuf = undefined;
    if (deserialize && cache.hasOwnProperty(device.address)) {
      var initStr = cache[device.address];
      initBuf = new Buffer(initStr, 'hex');                  
    }
    device.connectAndSetUp(error => {
      clearTimeout(timeout);
      if (error == null) resolve(null)
      else reject(error)
    }, initBuf);
  });
}

async function reconnect(device, retries) {
  var timeout = 5;
  while(retries === undefined || retries > 0) {
    try {
      winston.info("Attempting to reconnect", { 'mac': device.address});

      device._peripheral.removeAllListeners();
      await connect(device, false);

      winston.info("Reconnected to device", { 'mac': device.address});
      retries = -1;
    } catch (e) {
      winston.info("Failed to reconnect (" + e + "), trying again in " + timeout + "s", { 'mac': device.address });
      await new Promise((resolve, reject) => setTimeout(() => resolve(null), timeout * 1000))
      timeout = Math.min(timeout + 10, 60.0);

      if (retries != null) {
        retries--;
      }
    }
  }

  if (retries == 0) {
    winston.info("Failed to reconnect to device", { 'mac': device.address});
  }
}

module.exports.connect = connect
module.exports.reconnect = reconnect
module.exports.onUnexpectedDisconnect = async function () {
  winston.warn("Connection lost", { 'mac': this.address});
  await reconnect(this);
}
