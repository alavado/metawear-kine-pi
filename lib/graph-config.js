var cartesianAttr = [
  { name: 'xaxis', color: 'red' },
  { name: 'yaxis', color: 'green' },
  { name: 'zaxis', color: 'blue' }
]
function Fn_3arg(arg) {
  return {'xaxis': arg[0], 'yaxis': arg[1], 'zaxis': arg[2]}
}

function GraphSetting(min, max, shortName, attr, unpack) {
  this.min = min;
  this.max = max;
  this.shortName = shortName;
  this.attr = attr.map(e => Object.assign({}, e));
  this.unpack = unpack;
}

module.exports = {
  "Accelerometer": new GraphSetting(-21, 21, "acc", cartesianAttr, Fn_3arg),
  "Gyroscope" : new GraphSetting(-2100.0, 2100.0, "gyro", cartesianAttr, Fn_3arg),
  "Magnetometer" : new GraphSetting(-0.0025, 0.0025, "mag", cartesianAttr, Fn_3arg),
  "Quaternion" : new GraphSetting(-1.05, 1.05, "quat", [
    { name: 'w', color: 'black' },
    { name: 'x', color: 'red' },
    { name: 'y', color: 'green' },
    { name: 'z', color: 'blue' }
    ], arg => ({'w': arg[0], 'x': arg[1], 'y': arg[2], 'z': arg[3]})),
  "Euler Angles" : new GraphSetting(-365.0, 365.0, "euler", [
    { name: 'pitch', color: 'red' },
    { name: 'roll', color: 'green' },
    { name: 'yaw', color: 'blue' }
    ], arg => ({'pitch': arg[0], 'roll': arg[1], 'yaw': arg[2]})),
  "Linear Acceleration" : new GraphSetting(-21.0, 21.0, "lin-acc", cartesianAttr, Fn_3arg),
  "Gravity" : new GraphSetting(-21.0, 21.0, "gravity", cartesianAttr, Fn_3arg)
}