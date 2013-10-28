UNDEFINED_TYPE = '[object Undefined]'
NULL_TYPE = '[object Null]'
BOOLEAN_TYPE = '[object Boolean]'
NUMBER_TYPE = '[object Number]'
STRING_TYPE = '[object String]'
ARRAY_TYPE = '[object Array]'
OBJECT_TYPE = '[object Object]'
REGEXP_TYPE = '[object RegExp]'
DATE_TYPE = '[object Date]'


typeOf = (obj) ->
  Object.prototype.toString.call(obj)


exports.endsWith = (str, suffix) ->
  str.indexOf(suffix, str.length - suffix.length) isnt -1


exports.startsWith = (str, prefix) ->
  str.substring(0, prefix.length) == prefix


exports.arrayToHash = (arr) ->
  hash = {}
  for i in arr
    hash[i[0]] = i[1]
  return hash


exports.getDeviceId = (deviceIdStruct) ->
  # Percent escaping function. Escapes everything except alphanumerics and underscore
  esc = (str) ->
    str.replace(/[^A-Za-z0-9_]/g, (chr) ->
      buf = new require('buffer').Buffer(chr)
      rep = ''
      rep += "%#{b.toString(16).toUpperCase()}" for b in buf
      return rep
    )

  # Guaranteeing globally unique id as defined in TR-069
  if deviceIdStruct['ProductClass']
    return "#{esc(deviceIdStruct['OUI'])}-#{esc(deviceIdStruct['ProductClass'])}-#{esc(deviceIdStruct['SerialNumber'])}"

  return "#{esc(deviceIdStruct['OUI'])}-#{esc(deviceIdStruct['SerialNumber'])}"


exports.extend = (obj, mixin) ->
  obj[name] = method for name, method of mixin        
  obj


exports.getParamValueFromPath = (obj, path) ->
  pp = path.split('.')
  ref = obj
  try
    for p in pp
      ref = ref[p]
    return ref
  catch err
    return undefined


exports.matchType = (src, dst) ->
  switch typeOf(src)
    when STRING_TYPE
      String(dst)
    when NUMBER_TYPE
      Number(dst)
    when BOOLEAN_TYPE
      v = String(dst).trim().toLowerCase()
      v == 'true' or v == 'on' or v == 'yes' or v == '1'
    else
      dst


exports.UNDEFINED_TYPE = UNDEFINED_TYPE
exports.NULL_TYPE = NULL_TYPE
exports.NUMBER_TYPE = NUMBER_TYPE
exports.STRING_TYPE = STRING_TYPE
exports.ARRAY_TYPE = ARRAY_TYPE
exports.OBJECT_TYPE = OBJECT_TYPE
exports.REGEXP_TYPE = REGEXP_TYPE

exports.typeOf = typeOf
