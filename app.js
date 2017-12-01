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
parser.addArgument(['--no-graph'], {
    help: 'Disables the real time graph',
    nargs: 0
});

var args = parser.parseArgs();
var config, Session = null;

if (args['config'] != null) {
    config = JSON.parse(fs.readFileSync(args['config'], 'utf8'));
    config['devices'] = config['devices'].map(d => typeof(d) === 'string' ? ({'mac': d }) : d)
} else {
    if (args['device'] != null && args['sensor'] != null) {
        config = {
            "devices": args['device'].map(d => {
                const parts = d.split("=");
                return parts.length == 1 ? {'mac': d} : {'mac': parts[0], 'name': parts[1]}
            }),
            "sensors": args['sensor'].reduce((acc, s) => {
                const parts = s.split("=");
                acc[parts[0]] = parseFloat(parts[1])
                return acc
            }, {})
        };
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
async function start(options) {
    for(let d of config['devices']) {
        winston.info("Connecting to device", { 'mac': d['mac'] });
        try {
            let device = await findDevice(d['mac']);
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
            devices.push([device, 'name' in d ? d['name'] : 'MetaWear']);
        } catch (e) {
            winston.warn(e, {'mac': d['mac']});
        }
    }

    if (!devices.length) {
        winston.error("Failed to connect to any devices, terminating app");
        process.exit(0);
    }
    setTimeout(() => {
        var now = moment().format("YYYY-MM-DDTHH-mm-ss.SSS");
        var x = 0, y = 0;
        devices.forEach(it => {
            let d = it[0]
            var session = null;
            if (Session != null) {
                session = Session.create(d.firmwareRevision, d.address, d.modelDescription, it[1], 'MetaBase', '1.0.0');
                sessions.push(session);
            }

            let sensors = [];
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
                    
                    newState['update-graph'] = args['no_graph'] == null ? 
                        (data) => windows[d.address].webContents.send(`update-${s}-${d.address}` , data) :
                        (data) => {}
                    
                    states.push(newState);
                    sensors.push(s);
                }
            });

            if (args['no_graph'] == null) {
                let sizes = {
                    'width': options['electron'].screen.getPrimaryDisplay().size.width,
                    'height': options['electron'].screen.getPrimaryDisplay().size.height
                };
                if (!('resolution' in config)) {
                    config["resolution"] = { }
                }
                if (!('width' in config['resolution']) || config['resolution']['width'] == null) {
                    config['resolution']['width'] = sizes['width'] / 2
                }
                if (!('height' in config['resolution']) || config['resolution']['height'] == null) {
                    config['resolution']['height'] = sizes['height'] / 2
                }
    
                createWindow(d.address, it[1], sensors.map(s => `${s}=${1000 / config["sensors"][s]}`), config['resolution'], x, y)
                x += config['resolution']['width'];
                if (x >= sizes['width']) {
                    x = 0;
                    y += config['resolution']['height'];

                    if (y >= sizes['height']) {
                        x = 0;
                        y = 0;
                    }
                }
            }
            sensors.forEach(s => {
                sensorConfig[s].configure(d.board, config["sensors"][s]);
                sensorConfig[s].start(d.board);
            });
        })
        
        process.openStdin().addListener("data", async data => {
            winston.info("Resetting devices");
            Promise.all(devices.map(d => {
                var task = new Promise((resolve, reject) => d[0].on('disconnect', () => resolve(null)))
                MetaWear.mbl_mw_debug_reset(d[0].board)
                return task
            })).then(async results => {
                states.forEach(s => s['stream'].end());

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
                process.exit(0)
            })
        });
        winston.info("Streaming data to host device");
        winston.info("Press [Enter] to terminate...");
    }, 1000);
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
var windows = {};

if (args['no_graph'] == null) {
    const electron = require('electron')
    // Module to control application life.
    const app = electron.app
    // Module to create native browser window.
    const BrowserWindow = electron.BrowserWindow
    const url = require('url')

    let options = {
        'electron': electron
    }
    // Quit when all windows are closed.
    app.on('window-all-closed', function () {
        // On OS X it is common for applications and their menu bar
        // to stay active until the user quits explicitly with Cmd + Q
        if (process.platform !== 'darwin') {
            app.quit()
        }
    });
    app.on('browser-window-created',function(e,window) {
        window.setMenu(null);
    });

    function createWindow(mac, title, sensors, resolution, x, y) {
        let attr = Object.assign({title: `${title} (${mac})`, x: x, y: y}, resolution);
        // Create the browser window.
        let newWindow = new BrowserWindow(attr)
        windows[mac] = newWindow;
    
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
            delete windows[mac]
            // Dereference the window object, usually you would store windows
            // in an array if your app supports multi windows, this is the time
            // when you should delete the corresponding element.
            newWindow = null
        })
    }

    app.on('ready', () => start(options));
} else {
    start({});
}
