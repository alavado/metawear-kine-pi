var MetaWear = require('metawear');
const sensorConfig = require('./lib/sensor-config.js');
var fs = require('fs');
var path = require('path');
var util = require("util");
var moment = require("moment");
var winston = require('winston');
var ArgumentParser = require('argparse').ArgumentParser;

const electron = require('electron')
// Module to control application life.
const app = electron.app
// Module to create native browser window.
const BrowserWindow = electron.BrowserWindow
const url = require('url')

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
parser.addArgument(['--cloud-user'], {
    help: 'MetaCloud user name',
    metavar: 'name'
});
parser.addArgument(['--cloud-passwd'], {
    help: 'MetaCloud password',
    metavar: 'pw'
});
parser.addArgument(['-o'], {
    help: 'Path to store the CSV files',
    metavar: 'path'
});
parser.addArgument(['--width'], {
    help: 'Window width',
    metavar: 'res',
    type: 'int'
});
parser.addArgument(['--height'], {
    help: 'Window height',
    metavar: 'res',
    type: 'int'
});

var args = parser.parseArgs();
var config, Session = null;

if (args['config'] != null) {
    config = JSON.parse(fs.readFileSync(args['config'], 'utf8'));
} else {
    if (args['device'] != null && args['sensor'] != null) {
        config = { "devices": args['device'], "sensors": {} };
        args['sensor'].forEach(s => {
            const parts = s.split("=");
            config["sensors"][parts[0]] = parseFloat(parts[1]);
        });
    } else {
        winston.error("either '--config' or '--device' & '--sensor' options must be used");
        process.exit(0);
    }

    if (args['cloud_user'] != null && args['cloud_passwd'] != null) {
        config["cloudLogin"] = {
            "username" : args['cloud_user'],
            "password" : args['cloud_passwd']
        }
    } else if (!(args['cloud_user'] == null && args['cloud_passwd'] == null)) {
        winston.error("'--cloud-user' and '--cloud-passwd' required to sync to MetaCloud");
        process.exit(0);
    }

    config["resolution"] = {
        "width": args["width"],
        "height": args["height"]
    }
}

if ('cloudLogin' in config) {
    Session = require('metacloud').Session;
}

const CSV_DIR = args['o'] != null ? args['o'] : "output";
if (!fs.existsSync(CSV_DIR)){
    fs.mkdirSync(CSV_DIR);
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
var windows = {}

// Quit when all windows are closed.
app.on('window-all-closed', function () {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
})
app.on('browser-window-created',function(e,window) {
    window.setMenu(null);
});

function createWindow (mac, sensors, resolution) {
    // Create the browser window.
    let newWindow = new BrowserWindow(resolution)
    windows[mac.toLowerCase()] = newWindow;

    // and load the index.html of the app.
    newWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'views', 'index.html'),
        protocol: 'file:',
        slashes: true,
        search: `mac=${mac}&sensors=${sensors.join(',')}&width=${resolution['width']}&height=${resolution['height']}`
    }))

    // Open the DevTools.
    // mainWindow.webContents.openDevTools()

    // Emitted when the window is closed.
    newWindow.on('closed', function () {
        delete windows[mac.toLowerCase()]
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        newWindow = null
    })
}
// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

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
app.on('ready', async () => {
    if (!('resolution' in config)) {
        config["resolution"] = { }
    }
    if (!('width' in config['resolution']) || config['resolution']['width'] == null) {
        config['resolution']['width'] = electron.screen.getPrimaryDisplay().size.width / 2
    }
    if (!('height' in config['resolution']) || config['resolution']['height'] == null) {
        config['resolution']['height'] = electron.screen.getPrimaryDisplay().size.height / 2
    }
    
    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    
    for(let d of config['devices']) {
        winston.info("Connecting to device", { 'mac': d });
        try {
            let device = await findDevice(d);
            await new Promise((resolve, reject) => {
                var timeout = setTimeout(function() {
                    reject("Failed to initialize SDK");
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
            winston.warn(e, {'mac': d});
        }
    }

    if (!devices.length) {
        winston.error("Failed to connect to any devices, terminating app");
        process.exit(0);
    }
    setTimeout(() => {
        var now = moment().format("YYYY-MM-DDTHH-mm-ss.SSS");
        devices.forEach(d => {
            var session = null;
            if (Session != null) {
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
                        'stream': stream,
                    }
                    sensorConfig[s].csvHeader(stream);
                    MetaWear.mbl_mw_datasignal_subscribe(sensorConfig[s].signal(d.board), MetaWear.FnVoid_DataP.toPointer(pointer => {
                        sensorConfig[s].writeValue(pointer.deref(), newState);
                    }));
    
                    if (session != null) {
                        newState['session'] = session;
                    }
                    newState['update-graph'] = (data) => {
                        windows[d.address].webContents.send(`update-${s}-${d.address}` , data);
                    }
                    states.push(newState);
                }
            });
            let sensors = Object.keys(config["sensors"]).filter(s => sensorConfig[s].exists(d.board));
            createWindow(d.address, sensors, config['resolution'])
            sensors.forEach(s => {
                sensorConfig[s].configure(d.board, config["sensors"][s]);
                sensorConfig[s].start(d.board);
            });
        })
        
        process.openStdin().addListener("data", async data => {
            devices.forEach(d => MetaWear.mbl_mw_debug_reset(d.board));

            if ('cloudLogin' in config) {
                winston.info("Syncing data to MetaCloud");
                for(let s of sessions) {
                    try {
                        await new Promise((resolve, reject) => {
                            s.sync(config['cloudLogin']['username'], config['cloudLogin']['password'], (error, result) => {
                                if (error == null) resolve(result)
                                else reject(error);
                            });
                        });
                    } catch (e) {
                        winston.warn("Could not sync data to metacloud", { 'error': error });
                    }
                }
                winston.info("Syncing completed");
            }
            
            states.forEach(s => s['stream'].end());
            process.exit(0)
        });
        winston.info("Streaming data to host device. Press [Enter] to terminate...");
    }, 1000);
})