FLOAT_REGEX = /^([\-\+]?[0-9\.]+)/

extractFloat = (numStr) ->
  res = FLOAT_REGEX.exec(numStr)
  if res != null
    parseFloat(res[1])
  else
    null

exports.sanitize = (path, value) ->
  switch path
    when 'InternetGatewayDevice.WiMAX.Status.RSSI'
      extractFloat(value)
    when 'InternetGatewayDevice.WiMAX.Status.CINR1'
      extractFloat(value)
    when 'InternetGatewayDevice.WiMAX.Status.CINR2'
      extractFloat(value)
    else
      undefined