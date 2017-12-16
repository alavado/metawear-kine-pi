var MetaWear = require('metawear');
const SensorConfig = require('./lib/sensor-config.js');
var fs = require('fs');
var path = require('path');
var util = require("util");
var moment = require("moment");
var winston = require('winston');
var ref = require('ref');
const CLO = require('./lib/clo.js');
const BleConn = require('./lib/ble-conn.js')

const CACHE_FILENAME = '.cache.json';
// We save the state of the MetaWear device so that we can download it later
var cache = fs.existsSync(CACHE_FILENAME) ? JSON.parse(fs.readFileSync(CACHE_FILENAME, 'utf8')) : {};

var args = CLO.setup().parseArgs();
var config, Session = null;

if (args['list_sensors'] != null) {
    console.log("Available Sensors")
    console.log("-----------------")
    Object.keys(SensorConfig).forEach(s => console.log(s))
    process.exit(0)
}
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

    if (args['fps'] != null) {
        config['fps'] = args['fps']
    }

    config["resolution"] = {
        "width": args["width"],
        "height": args["height"]
    }
}

if (!('fps' in config)) {
    config['fps'] = 10
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
    var timeout = setTimeout(() => {
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
            await BleConn.connect(device, true, cache);
            await serializeDeviceState(device)
            
            device.once('disconnect', BleConn.onUnexpectedDisconnect)
            devices.push([device, 'name' in d ? d['name'] : 'MetaWear']);
        } catch (e) {
            winston.warn(e, {'mac': d['mac']});
        }
    }

    if (!devices.length) {
        winston.error("Failed to connect to any devices, terminating app");
        process.exit(0);
    }
    setTimeout(async () => {
        winston.info("Configuring devices")

        var now = moment().format("YYYY-MM-DDTHH-mm-ss.SSS");
        var x = -1, y = 0;
        for(let it of devices) {
            let d = it[0]
            var session = null;
            if (Session != null) {
                session = Session.create(d.firmwareRevision, d.address, d.modelDescription, it[1], 'MetaBase', '1.0.0');
                sessions.push(session);
            }

            let current_states = []
            let sensors = [];
            Object.keys(config['sensors']).forEach(s => {
                if (!(s in SensorConfig)) {
                    winston.warn(util.format("'%s' is not a valid sensor name", s));
                } else if (!SensorConfig[s].exists(d.board)) {
                    winston.warn(util.format("'%s' does not exist on this board", s), { 'mac': d.address });
                } else {
                    let stream = fs.createWriteStream(path.join(CSV_DIR, util.format("%s_%s_%s.csv", now, d.address.toUpperCase().replace(/:/g, ""), s)));
                    let newState = {
                        'stream': stream,
                    }
                    SensorConfig[s].csvHeader(stream);
                    MetaWear.mbl_mw_datasignal_subscribe(SensorConfig[s].signal(d.board), MetaWear.FnVoid_DataP.toPointer(pointer => {
                        SensorConfig[s].writeValue(pointer.deref(), newState);
                    }));
    
                    if (session != null) {
                        newState['session'] = session;
                    }
                    
                    newState['update-graph'] = args['no_graph'] == null ? 
                        (data) => windows[d.address].webContents.send(`update-${s}-${d.address}` , data) :
                        (data) => {}
                    
                    current_states.push(newState)
                    states.push(newState);
                    sensors.push(s);
                }
            });

            if (sensors.length != 0) {
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
        
                    if (x < 0) {
                        x = sizes['width'] - config['resolution']['width'];
                    }
                    createWindow(current_states, config['fps'], d.address, it[1], sensors.map(s => `${s}=${SensorConfig[s].odrToMs(config["sensors"][s])}`), config['resolution'], x, y)

                    x -= config['resolution']['width'];
                    if (x < 0) {
                        y += config['resolution']['height'];
                        if (y >= sizes['height']) {
                            y = 0;
                        }
                    }
                }
                for(let s of sensors) {
                    await SensorConfig[s].configure(d.board, config["sensors"][s]);
                    SensorConfig[s].start(d.board);
                }
            } else {
                winston.warn("No sensors were enabled for device", { 'mac': d.address })
            }
        }
        
        if (states.length == 0) {
            winston.error("No active sensors to receive data from, terminating app")
            process.exit(0)
        } else {
            process.openStdin().addListener("data", async data => {
                winston.info("Resetting devices");
                Promise.all(devices.map(d => {
                    if (d[0]._peripheral.state !== 'connected') {
                        return Promise.resolve(null);
                    }
                    d[0].removeListener('disconnect', BleConn.onUnexpectedDisconnect);
                    var task = new Promise((resolve, reject) => d[0].once('disconnect', () => resolve(null)))
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
                                winston.warn("Could not sync data to metacloud", { 'error': e });
                            }
                        }
                        winston.info("Syncing completed");
                    }
                    process.exit(0)
                })
            });
            winston.info("Streaming data to host device");
            winston.info("Press [Enter] to terminate...");
        }
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
    app.on('window-all-closed', function () {
    });
    app.on('browser-window-created',function(e,window) {
        window.setMenu(null);
    });

    function createWindow(states, fps, mac, title, sensors, resolution, x, y) {
        let attr = Object.assign({title: `${title} (${mac.toUpperCase()})`, x: x, y: y}, resolution);
        // Create the browser window.
        let newWindow = new BrowserWindow(attr)
        windows[mac] = newWindow;
    
        // and load the index.html of the app.
        newWindow.loadURL(url.format({
            pathname: path.join(__dirname, 'views', 'index.html'),
            protocol: 'file:',
            slashes: true,
            search: `fps=${fps}&mac=${mac}&sensors=${sensors.join(',')}&width=${resolution['width']}&height=${resolution['height']}`
        }))
    
        // Open the DevTools.
        // mainWindow.webContents.openDevTools()
    
        // Emitted when the window is closed.
        newWindow.on('closed', function () {
            winston.info("Window closed, data is still being written to the CSV file", { 'mac': mac })
            states.forEach(s => s['update-graph'] = (data) => {})
            delete windows[mac]
            // Dereference the window object, usually you would store windows
            // in an array if your app supports multi windows, this is the time
            // when you should delete the corresponding element.
            newWindow = null
        })

        newWindow.on('resize', () => newWindow.webContents.send(`resize-${mac}` , newWindow.getSize()));
    }

    app.on('ready', () => start(options));
} else {
    start({});
}

function serializeDeviceState(device) {
    var intBuf = ref.alloc(ref.types.uint32);
    var raw = MetaWear.mbl_mw_metawearboard_serialize(device.board, intBuf);
    var sizeRead = intBuf.readUInt32LE();
    var data = ref.reinterpret(raw, sizeRead, 0);
    var initStr = data.toString('hex');
    cache[device.address] = initStr;

    return new Promise((resolve, reject) => {
        fs.writeFile(CACHE_FILENAME, JSON.stringify(cache), err => {
            if (err) reject(err)
            else resolve(null)
        });
    })
}