var MetaWear = require('metawear');
const sensorConfig = require('./lib/sensor-config.js');
var fs = require('fs');
var path = require('path');
var util = require("util");
var moment = require("moment");
var winston = require('winston');
var ArgumentParser = require('argparse').ArgumentParser;

var parser = new ArgumentParser({
    version: '1.0.0',
    addHelp:true,
    description: 'NodeJS app to stream sensor data to MetaHub'
});
parser.addArgument([ '-d', '--device' ], {
    help: 'MAC address of the device to use',
    action: 'append',
    metavar: 'mac',
    type: "string"
});
parser.addArgument([ '--sensor' ], {
    help: 'Key-value pair that sets a sensors sampling frequency',
    action: 'append',
    metavar: 'sensor=freq'
});
parser.addArgument(['--config'], {
    help: 'Path to the config file to load',
    metavar: 'path'
});
parser.addArgument(['--disable-cloud-sync'], {
    nargs: 0,
    help: 'Do not sync data to MetaCloud',
    metavar: 'path'
});
parser.addArgument(['--cloud-user'], {
    help: 'MetaCloud user name',
    metavar: 'name'
});
parser.addArgument(['--cloud-passwd'], {
    help: 'MetaCloud password',
    metavar: 'pw'
});

var args = parser.parseArgs();
var config, Session;

if (args['disable_cloud_sync'] == null) {
    if (args['cloud_user'] == null || args['cloud_passwd'] == null) {
        winston.error("'--cloud-user' and '--cloud-passwd' required to sync to MetaCloud, use '--disable-cloud-sync' to disable")
        process.exit(0)
    }
    Session = require('metacloud').Session;
}
if (args['config'] != null) {
    config = JSON.parse(fs.readFileSync(args['config'], 'utf8'));
} else if (args['device'] != null && args['sensor'] != null) {
    config = { "devices": args['device'], "sensors": {} };
    args['sensor'].forEach(s => {
        const parts = s.split("=");
        config["sensors"][parts[0]] = parseFloat(parts[1]);
    });
} else {
    winston.error("either '--config' or '-d' & '-s' options must be used");
    process.exit(0);
}

const CSV_DIR = "output";
if (!fs.existsSync(CSV_DIR)){
    fs.mkdirSync(CSV_DIR);
}

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

var sessions = [];
var states = [];
var devices = [];
(async function start() {
    for(let d of config['devices']) {
        winston.info("Connecting to device", { 'mac': d });
        try {
            let device = await findDevice(d);
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
            devices.push(device);
        } catch (e) {
            winston.warn("Failed to connect to and setup device", {'mac': d});
        }
    }

    if (!devices.length) {
        console.log("Failed to connect to any devices, terminating app");
        process.exit(0);
    }
    setTimeout(() => {
        var now = moment().format("YYYY-MM-DDTHH-mm-ss.SSS");
        devices.forEach(d => {
            var session = null;
            if (args['disable_cloud_sync'] == null) {
                session = Session.create(d.firmwareRevision, d.address, d.modelDescription, 'Device #1', 'MetaBase', '1.0.0');
                sessions.push(session);
            }

            Object.keys(config['sensors']).forEach(s => {
                if (!(s in sensorConfig)) {
                    winston.warn(util.format("'%s' is not a valid sensor name", s));
                } else if (!sensorConfig[s].exists(d.board)) {
                    winston.warn(util.format("'%s' does not exist on this board", s), { 'mac': d.address });
                } else {
                    let stream = fs.createWriteStream(path.join(CSV_DIR, util.format("%s_%s_%s.csv", now, d.address.replace(/:/g, ""), s)));
                    let newState = {
                        'stream': stream
                    }
                    sensorConfig[s].csvHeader(stream);
                    MetaWear.mbl_mw_datasignal_subscribe(sensorConfig[s].signal(d.board), MetaWear.FnVoid_DataP.toPointer(pointer => {
                        sensorConfig[s].writeValue(pointer.deref(), newState);
                    }));
    
                    if (session != null) {
                        newState['session'] = session;
                    }
                    states.push(newState);
                }
            });
            Object.keys(config["sensors"]).filter(s => sensorConfig[s].exists(d.board)).forEach(s => {
                sensorConfig[s].configure(d.board, config["sensors"][s]);
                sensorConfig[s].start(d.board);
            });
        })
        
        process.openStdin().addListener("data", async data => {
            devices.forEach(d => MetaWear.mbl_mw_debug_reset(d.board));

            if (args['disable_cloud_sync'] == null) {
                winston.info("Syncing data to MetaCloud");
            }
            for(let s of sessions) {
                try {
                    await new Promise((resolve, reject) => {
                        s.sync(args['cloud_user'], args['cloud_passwd'], (error, result) => {
                            if (error == null) resolve(result)
                            else reject(error);
                        });
                    });
                } catch (e) {
                    winston.warn("Could not sync data to metacloud", { 'error': error });
                }
            }

            states.forEach(s => s['stream'].end());
            process.exit(0)
        });
        winston.info("Streaming data to host device. Press [Enter] to terminate...");
    }, 1000);
})()