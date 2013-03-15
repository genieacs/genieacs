common = require './common'


normalizers = {}


FLOAT_REGEX = /^([\-\+]?[0-9\.]+)/
normalizers.float = (input) ->
  res = FLOAT_REGEX.exec(input)
  if res != null
    parseFloat(res[1])
  else
    null


exports.normalize = (path, value) ->
  if path of parameters
    return normalizers[parameters[path].type](value)
  else
    return value


parameters = {
  'InternetGatewayDevice.WiMAX.Status.RSSI' : {
    type : 'float',
  },
  'InternetGatewayDevice.WiMAX.Status.CINR1' : {
    type : 'float',
  },
  'InternetGatewayDevice.WiMAX.Status.CINR2' : {
    type : 'float',
  },
  'InternetGatewayDevice.X_MTK_WiMAX_Param.CINR_level' : {
    type : 'float',
  },
  'InternetGatewayDevice.X_MTK_WiMAX_Param.RSSI_level' : {
    type : 'float',
  },
}