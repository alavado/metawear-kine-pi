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

function Setting(header, configure, start, stop, signal, writeValue) {
    this.configure = configure;
    this.start = start;
    this.stop = stop;
    this.csvHeader = (stream) => stream.write(util.format(CSV_HEADER_ROOT + header + os.EOL, moment().format("Z")));
    this.signal = signal;
    this.writeValue = writeValue;
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
        MetaWear.mbl_mw_acc_stop(board);
        MetaWear.mbl_mw_acc_disable_acceleration_sampling(board);
    }, (board) => {
        return MetaWear.mbl_mw_acc_get_packed_acceleration_data_signal(board);
    }, (data, state) => {
        let value = data.parseValue()
        state['stream'].write(util.format("%d,%s,%s,%s,%s,%s,%s", data.epoch, formatTime(data.epoch), formatElapsed(data.epoch, state), 
                value.x.toFixed(3), value.y.toFixed(3), value.z.toFixed(3), os.EOL))
    })
}