UNDEFINED_TYPE = '[object Undefined]'
NULL_TYPE = '[object Null]'
BOOLEAN_TYPE = '[object Boolean]'
NUMBER_TYPE = '[object Number]'
STRING_TYPE = '[object String]'
ARRAY_TYPE = '[object Array]'
OBJECT_TYPE = '[object Object]'


typeOf = (obj) ->
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


exports.matchType = (src, dst) ->
  switch typeOf(src)
    when STRING_TYPE
      String(dst)
    when NUMBER_TYPE
      Number(dst)
    when BOOLEAN_TYPE
      v = String(dst).trim().toLowerCase()
      v == 'true' or v == 'on' or v == '1'
    else
      dst


exports.UNDEFINED_TYPE = UNDEFINED_TYPE
exports.NULL_TYPE = NULL_TYPE
exports.NUMBER_TYPE = NUMBER_TYPE
exports.STRING_TYPE = STRING_TYPE
exports.ARRAY_TYPE = ARRAY_TYPE
exports.OBJECT_TYPE = OBJECT_TYPE

exports.typeOf = typeOf
