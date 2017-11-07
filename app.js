var MetaWear = require('metawear');
const sensorConfig = require('./lib/sensor-config.js');
const fs = require('fs');
const path = require('path');
const util = require("util");
const moment = require("moment");

const CSV_DIR = "csv";
var states = [];
var devices = {};

async function parseConfigFile(configJson) {
    try {
        let config = await new Promise((resolve, reject) => {
            fs.readFile(configJson, 'utf8', function (err, data) {
                if (err) reject(err);
                resolve(JSON.parse(data));
            });
        });
        for(let k of Object.keys(config)) {
            console.log("Connecting to " + k.toLowerCase());
            try {
                let device = await new Promise((resolve, reject) => MetaWear.discoverByAddress(k.toLowerCase(), device => resolve(device)));
                await new Promise((resolve, reject) => {
                    device.connectAndSetUp(error => {
                        if (error == null) resolve(device)
                        else reject(error)
                    });
                });
                
                MetaWear.mbl_mw_settings_set_connection_parameters(device.board, 7.5, 7.5, 0, 6000);
                devices[k] = device;
                console.log("Connected to " + k);
            } catch (e) {
                console.log(e);
            }
        }

        setTimeout(() => {
            var now = moment().format("YYYY-MM-DDTHH-mm-ss.SSS");
            Object.keys(devices).forEach(k => {
                Object.keys(config[k]).forEach(s => {
                    let stream = fs.createWriteStream(path.join(CSV_DIR, util.format("%s_%s_%s.csv", now, k.replace(/:/g, ""), s)));
                    let newState = {
                        'stream': stream
                    }
                    sensorConfig[s].csvHeader(stream);
                    MetaWear.mbl_mw_datasignal_subscribe(sensorConfig[s].signal(devices[k].board), MetaWear.FnVoid_DataP.toPointer(pointer => {
                        sensorConfig[s].writeValue(pointer.deref(), newState);
                    }));
    
                    states.push(newState);
                });
                Object.keys(config[k]).forEach(s => {
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
            console.log("Streaming data to host device. Press any key to terminate...");
        }, 1000);
    } catch (e) {
        console.log(e);
        process.exit(1);
    }
}

if (!fs.existsSync(CSV_DIR)){
    fs.mkdirSync(CSV_DIR);
}
parseConfigFile(process.argv[2]);