Either run with command line options or config file.  

```bash
> npm start -- -d D4:5E:82:E1:15:01 --sensor Accelerometer=100.0 \
    --sensor Gyroscope=100.0 --sensor Magnetometer=25.0 \
    --cloud-user foo --cloud-passwd bar
```

Above command is equal to the following config file:

```json
{
    "_comment": "Assume file is named democonfig.json",
    "cloudLogin" : {
        "username" : "foo",
        "password" : "bar"
    }
    "devices": [
        "D4:5E:82:E1:15:01"
    ],
    "sensors": {
        "Accelerometer": 100.0,
        "Gyroscope": 100.0,
        "Magnetometer": 25.0
    }
}
```

```bash
> npm start -- --config democonfig.json
```