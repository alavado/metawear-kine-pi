MetaBase configures [MetaSensor](https://mbientlab.com/store/sensors/) boards to stream data to your MetaHub.  It saves all data to CSV files and can also sync the data to the 
[MetaCloud](https://mbientlab.com/store/cloud/) service.  

# Config File
The primary way to configure the application is with a JSON config file which is passed to the app via the ``--config`` options.  Your config file must have at minimum the devices 
and sensors defined.

```bash
sudo npm start -- --config metabase-config.json
```

## Devices
The ``devices`` key is an array that holds the mac addresses of the devices to use.  The array elements can either be a MAC address string or an object containing both the MAC 
address string and a user defined name identifying the device.

```json
{
  "devices": [        
    "D4:5E:82:E1:15:01",
    {"mac": "D5:7B:B9:7D:CE:0E", "name": "Demo Unit"}
  ]
}
```

In the above example, the ``D4:5E:82:E1:15:01`` mac address will have a default name assigned to it whereas the ``D5:7B:B9:7D:CE:0E`` will be referred to as "Demo Unit" in both  
the UI window and MetaCloud

## Sensors
The ``sensors`` key is an object that defines the sampling frequencies for the various data streams.  Some streams, such as sensor fusion data, are not configurable (but must 
still be set), and the app will use the closest valid frequency to the set value.

```json
{
    "sensors": {
        "Accelerometer": 100.0,
        "Gyroscope": 100.0,
        "Magnetometer": 25.0
    }
}
```

## Resolution
The ``resolution`` key is optional and sets the windows' width and height for the real time graphs.  If not set, the application will automatically create windows 1/4th the 
screen resolution.

```json
{
    "resolution": {
        "width": 960,
        "height": 540
    }
}
```

# Command Line Options
All settings in the config file have equivalent command line options.  Like in the config file, the ``--devices`` and ``--sensors`` flags must be set, and can be repeated 
for multiple devices and sensors respectively.  The table below maps JSON keys to their matching option:

| JSON Key   | Command Line       |
|------------|--------------------|
| devices    | --device           |
| sensors    | --sensor           |
| resolution | --width, --height  |

The JSON configuration from the previous section can equivalently expressed in the command line as follows:

```bash
sudo npm start -- --device D4:5E:82:E1:15:01 --device "D5:7B:B9:7D:CE:0E=Demo Unit" \
    --sensor Accelerometer=100.0 --sensor Gyroscope=100.0 --sensor Magnetometer=25.0 \
    --width 960 --height 540
```

## Disable RealTime Graph
By default, the app will create a window for each connected board and graph the data in real time, one graph per stream.  The realtime graphs can consume a lot of resources 
so users can disable it by passing in the ``--no-graph`` option in the command line.

```bash
sudo npm start -- --config metabase-config.json --no--graph
```
