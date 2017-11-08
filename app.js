var MetaWear = require('metawear');
const sensorConfig = require('./lib/sensor-config.js');
const fs = require('fs');
const path = require('path');
const util = require("util");
const moment = require("moment");
const winston = require('winston');

const CSV_DIR = "csv";
var states = [];
var devices = {};

function findDevice(mac) {
    return new Promise((resolve, reject) => {
        var timeout = setTimeout(function() {
            MetaWear.stopDiscoverAll(onDiscover);
            reject("Could not find device");
        }, 10000);

        function onDiscover(device) {
            if (device.address.toUpperCase() == mac.toUpperCase()) {
                MetaWear.stopDiscoverAll(onDiscover);
                clearTimeout(timeout);
                resolve(device);
            }
        }

        MetaWear.discoverAll(onDiscover);
    });
}

async function parseConfigFile(configJson) {
    let config = await new Promise((resolve, reject) => {
        fs.readFile(configJson, 'utf8', function (err, data) {
            if (err) reject(err);
            resolve(JSON.parse(data));
        });
    });
    for(let k of Object.keys(config)) {
        winston.info("Connecting to device", { 'mac': k });
        try {
            let device = await findDevice(k);
            await new Promise((resolve, reject) => {
                var timeout = setTimeout(function() {
                    reject(null);
                }, 10000);

                device.connectAndSetUp(error => {
                    clearTimeout(timeout);
                    if (error == null) resolve(device)
                    else reject(error)
                });
            });
            
            MetaWear.mbl_mw_settings_set_connection_parameters(device.board, 7.5, 7.5, 0, 6000);
            devices[k] = device;
        } catch (e) {
            winston.warn("Failed to connect to and setup device", {'mac': k});
        }
    }

    if (!Object.keys(devices).length) {
        console.log("Failed to connect to any devices, terminating app");
        process.exit(0);
    }
    setTimeout(() => {
        var now = moment().format("YYYY-MM-DDTHH-mm-ss.SSS");
        Object.keys(devices).forEach(k => {
            Object.keys(config[k]).forEach(s => {
                if (!(s in sensorConfig)) {
                    winston.warn(util.format("'%s' is not a valid sensor name", s));
                } else if (!sensorConfig[s].exists(devices[k].board)) {
                    winston.warn(util.format("'%s' does not exist on this board", s), { 'mac': k });
                } else {
                    let stream = fs.createWriteStream(path.join(CSV_DIR, util.format("%s_%s_%s.csv", now, k.replace(/:/g, ""), s)));
                    let newState = {
                        'stream': stream
                    }
                    sensorConfig[s].csvHeader(stream);
                    MetaWear.mbl_mw_datasignal_subscribe(sensorConfig[s].signal(devices[k].board), MetaWear.FnVoid_DataP.toPointer(pointer => {
                        sensorConfig[s].writeValue(pointer.deref(), newState);
                    }));
    
                    states.push(newState);
                }
            });
            Object.keys(config[k]).filter(s => sensorConfig[s].exists(devices[k].board)).forEach(s => {
                sensorConfig[s].configure(devices[k].board, config[k][s]);
                sensorConfig[s].start(devices[k].board);
            });
        })
        
        process.openStdin().addListener("data", data => {
            Object.keys(devices).forEach(k => {
                MetaWear.mbl_mw_debug_reset(devices[k].board);
            });
            states.forEach(s => s['stream'].end());
            process.exit(0)
        });
        winston.info("Streaming data to host device. Press any key to terminate...");
    }, 1000);
}

if (!fs.existsSync(CSV_DIR)){
    fs.mkdirSync(CSV_DIR);
}
parseConfigFile(process.argv[2]);