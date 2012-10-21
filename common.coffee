exports.endsWith = (str, suffix) ->
  str.indexOf(suffix, str.length - suffix.length) isnt -1


exports.arrayToHash = (arr) ->
  hash = {}
  for i in arr
    hash[i[0]] = i[1]
  return hash


exports.getDeviceId = (deviceIdStruct) ->
  # Guaranteeing globally unique id as defined in TR-069
  if deviceIdStruct['ProductClass']
    return "#{escape(deviceIdStruct['OUI'])}-#{escape(deviceIdStruct['ProductClass'])}-#{escape(deviceIdStruct['SerialNumber'])}"

  return "#{escape(deviceIdStruct['OUI'])}-#{escape(deviceIdStruct['SerialNumber'])}"

