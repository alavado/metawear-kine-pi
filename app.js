var MetaWear = require('metawear');
const sensorConfig = require('./lib/sensor-config.js');
var fs = require('fs');

var states = []
var devices = {}
async function parseConfigFile(path) {
    try {
        let config = await new Promise((resolve, reject) => {
            fs.readFile(path, 'utf8', function (err, data) {
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

        Object.keys(devices).forEach(k => {
            Object.keys(config[k]).forEach(s => {
                let stream = fs.createWriteStream(s + '.txt');
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
                console.log("ODR = " + config[k][s]);
                sensorConfig[s].configure(devices[k].board, config[k][s]);
                sensorConfig[s].start(devices[k].board);
                console.log("Starting " + k);
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
    } catch (e) {
        console.log(e);
        process.exit(1);
    }
}

parseConfigFile(process.argv[2]);