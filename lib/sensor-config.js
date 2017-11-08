const MetaWear = require('metawear');
const os = require("os");
const util = require("util");
const moment = require("moment");

const CSV_HEADER_ROOT= "epoch (ms),time (%s),elapsed (s),";

function formatTime(epoch) {
    return moment(epoch).format("YYYY-MM-DDTHH-mm-ss.SSS");
}

function formatElapsed(epoch, state) {
    if (!('first' in state)) {
        state['first'] = epoch;
    }

    return ((epoch - state['first']) / 1000.0).toFixed(3);
}

function closest(values, key) {
    var smallest = Math.abs(values[0] - key);
    var place = 0;
    for(var i = 1; i < values.length; i++) {
        var dist = Math.abs(values[i] - key);
        if (dist < smallest) {
            smallest = dist;
            place = i;
        }
    }

    return place;
}

function Setting(header, configure, start, signal, writeValue, exists) {
    this.configure = configure;
    this.start = start;
    this.csvHeader = (stream) => stream.write(util.format(CSV_HEADER_ROOT + header + os.EOL, moment().format("Z")));
    this.signal = signal;
    this.writeValue = writeValue;
    this.exists = exists;
}

function SensorFusionSetting(header, type, writeValue) {
    return new Setting(header, (board, odr) => {
        MetaWear.mbl_mw_sensor_fusion_set_mode(board, MetaWear.SensorFusionMode.NDOF);
        MetaWear.mbl_mw_sensor_fusion_set_acc_range(board, MetaWear.SensorFusionAccRange._16G);
        MetaWear.mbl_mw_sensor_fusion_set_gyro_range(board, MetaWear.SensorFusionGyroRange._2000DPS);
        MetaWear.mbl_mw_sensor_fusion_write_config(board);
    }, (board) => {
        MetaWear.mbl_mw_sensor_fusion_enable_data(board, type);
        MetaWear.mbl_mw_sensor_fusion_start(board);
    }, (board) => {
        return MetaWear.mbl_mw_sensor_fusion_get_data_signal(board, type);
    }, writeValue, 
    (board) => {
        return MetaWear.mbl_mw_metawearboard_lookup_module(board, MetaWear.Module.SENSOR_FUSION) != MetaWear.Const.MODULE_TYPE_NA;
    });
}

module.exports = {
    "Accelerometer": new Setting("x-axis (g),y-axis (g),z-axis (g)", (board, odr) => {
        MetaWear.mbl_mw_acc_set_range(board, 16.0);
        MetaWear.mbl_mw_acc_set_odr(board, odr);
        MetaWear.mbl_mw_acc_write_acceleration_config(board);
    }, (board) => {
        MetaWear.mbl_mw_acc_enable_acceleration_sampling(board);
        MetaWear.mbl_mw_acc_start(board);
    }, (board) => {
        return MetaWear.mbl_mw_acc_get_packed_acceleration_data_signal(board);
    }, (data, state) => {
        let value = data.parseValue()
        state['stream'].write(util.format("%d,%s,%s,%s,%s,%s,%s", data.epoch, formatTime(data.epoch), formatElapsed(data.epoch, state), 
                value.x.toFixed(3), value.y.toFixed(3), value.z.toFixed(3), os.EOL))
    }, (board) => {
        return MetaWear.mbl_mw_metawearboard_lookup_module(board, MetaWear.Module.ACCELEROMETER) != MetaWear.Const.MODULE_TYPE_NA;
    }),
    "Gyroscope" : new Setting("x-axis (deg/s),y-axis (deg/s),z-axis (deg/s)", (board, odr) => {
        MetaWear.mbl_mw_gyro_bmi160_set_range(board, MetaWear.GyroBmi160Range._2000dps);
        MetaWear.mbl_mw_gyro_bmi160_set_odr(board, MetaWear.GyroBmi160Odr.enums[closest([25.0, 50.0, 100.0, 200.0], odr)].value);
        MetaWear.mbl_mw_gyro_bmi160_write_config(board);
    }, (board) => {
        MetaWear.mbl_mw_gyro_bmi160_enable_rotation_sampling(board);
        MetaWear.mbl_mw_gyro_bmi160_start(board);
    }, (board) => {
        return MetaWear.mbl_mw_gyro_bmi160_get_packed_rotation_data_signal(board);
    }, (data, state) => {
        let value = data.parseValue()
        state['stream'].write(util.format("%d,%s,%s,%s,%s,%s,%s", data.epoch, formatTime(data.epoch), formatElapsed(data.epoch, state), 
                value.x.toFixed(3), value.y.toFixed(3), value.z.toFixed(3), os.EOL))
    }, (board) => {
        return MetaWear.mbl_mw_metawearboard_lookup_module(board, MetaWear.Module.GYRO) != MetaWear.Const.MODULE_TYPE_NA;
    }),
    "Magnetometer" : new Setting("x-axis (T),y-axis (T),z-axis (T)", (board, odr) => {
        MetaWear.mbl_mw_mag_bmm150_configure(board, 9, 15, MetaWear.MagBmm150Odr.enums[closest([10.0, 2.0, 6.0, 8.0, 15.0, 20.0, 25.0], odr)].value);
    }, (board) => {
        MetaWear.mbl_mw_mag_bmm150_enable_b_field_sampling(board);
        MetaWear.mbl_mw_mag_bmm150_start(board);
    }, (board) => {
        return MetaWear.mbl_mw_mag_bmm150_get_packed_b_field_data_signal(board);
    }, (data, state) => {
        let value = data.parseValue()
        state['stream'].write(util.format("%d,%s,%s,%s,%s,%s,%s", data.epoch, formatTime(data.epoch), formatElapsed(data.epoch, state), 
                (value.x / 1000000.0).toFixed(9), (value.y / 1000000.0).toFixed(9), (value.z / 1000000.0).toFixed(9), os.EOL))
    }, (board) => {
        return MetaWear.mbl_mw_metawearboard_lookup_module(board, MetaWear.Module.MAGNETOMETER) != MetaWear.Const.MODULE_TYPE_NA;
    }),
    "Quaternion" : new SensorFusionSetting("w (number),x (number),y (number), z (number)", MetaWear.SensorFusionData.QUATERION, (data, state) => {
        let value = data.parseValue()
        state['stream'].write(util.format("%d,%s,%s,%s,%s,%s,%s,%s", data.epoch, formatTime(data.epoch), formatElapsed(data.epoch, state), 
                value.w.toFixed(3), value.x.toFixed(3), value.y.toFixed(3), value.z.toFixed(3), os.EOL))
    }),
    "Euler Angles" : new SensorFusionSetting("pitch (deg),roll (deg),yaw (deg), heading (deg)", MetaWear.SensorFusionData.EULER_ANGLE, (data, state) => {
        let value = data.parseValue()
        state['stream'].write(util.format("%d,%s,%s,%s,%s,%s,%s,%s", data.epoch, formatTime(data.epoch), formatElapsed(data.epoch, state), 
                value.pitch.toFixed(3), value.roll.toFixed(3), value.yaw.toFixed(3), value.heading.toFixed(3), os.EOL))
    }),
    "Linear Acceleration" : new SensorFusionSetting("x-axis (g),y-axis (g),z-axis (g)", MetaWear.SensorFusionData.LINEAR_ACC, (data, state) => {
        let value = data.parseValue()
        state['stream'].write(util.format("%d,%s,%s,%s,%s,%s,%s", data.epoch, formatTime(data.epoch), formatElapsed(data.epoch, state), 
                value.x.toFixed(3), value.y.toFixed(3), value.z.toFixed(3), os.EOL))
    }),
    "Gravity" : new SensorFusionSetting("x-axis (g),y-axis (g),z-axis (g)", MetaWear.SensorFusionData.GRAVITY, (data, state) => {
        let value = data.parseValue()
        state['stream'].write(util.format("%d,%s,%s,%s,%s,%s,%s", data.epoch, formatTime(data.epoch), formatElapsed(data.epoch, state), 
                value.x.toFixed(3), value.y.toFixed(3), value.z.toFixed(3), os.EOL))
    })
}