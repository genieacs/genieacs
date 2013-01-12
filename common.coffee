exports.UNDEFINED_TYPE = '[object Undefined]'
exports.NULL_TYPE = '[object Null]'
exports.NUMBER_TYPE = '[object Number]'
exports.STRING_TYPE = '[object String]'
exports.ARRAY_TYPE = '[object Array]'
exports.OBJECT_TYPE = '[object Object]'

exports.typeOf = (obj) ->
  Object.prototype.toString.call(obj)


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


exports.extend = (obj, mixin) ->
  obj[name] = method for name, method of mixin        
  obj


exports.getParamValueFromPath = (obj, path) ->
  pp = path.split('.')
  ref = obj
  for p in pp
    ref = ref[p]
  return ref
