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
  "Accelerometer": new GraphSetting(-16.0, 16.0, "acc", cartesianAttr, Fn_3arg),
  "Gyroscope" : new GraphSetting(-2000.0, 2000.0, "gyro", cartesianAttr, Fn_3arg),
  "Magnetometer" : new GraphSetting(-0.0025, 0.0025, "mag", cartesianAttr, Fn_3arg),
  "Quaternion" : new GraphSetting(-1.0, 1.0, "quat", [
    { name: 'w', color: 'black' },
    { name: 'x', color: 'red' },
    { name: 'y', color: 'green' },
    { name: 'z', color: 'blue' }
    ], arg => ({'w': arg[0], 'x': arg[1], 'y': arg[2], 'z': arg[3]})),
  "Euler Angles" : new GraphSetting(-360.0, 360.0, "euler", [
    { name: 'heading', color: 'black' },
    { name: 'pitch', color: 'red' },
    { name: 'roll', color: 'green' },
    { name: 'yaw', color: 'blue' }
    ], arg => ({'heading': arg[0], 'pitch': arg[1], 'roll': arg[2], 'yaw': arg[3]})),
  "Linear Acceleration" : new GraphSetting(-16.0, 16.0, "lin-acc", cartesianAttr, Fn_3arg),
  "Gravity" : new GraphSetting(-16.0, 16.0, "gravity", cartesianAttr, Fn_3arg)
}