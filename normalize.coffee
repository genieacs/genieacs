config = require './config'
common = require './common'


normalizers = {}

normalizers.default = (input, normType) ->
  if normType is 'query' and common.typeOf(input) is common.STRING_TYPE
    vals = []
    str = normalizers.string(input, normType)
    if common.typeOf(str) == common.ARRAY_TYPE
      vals = vals.concat(str)
    else
      vals.push(str)

    f = parseFloat(input)
    if not isNaN(f)
      vals.push(f)

    d = new Date(input)
    if input.length >= 8 and d.getFullYear() > 1983
      vals.push(d)
    return vals
  return input


FLOAT_REGEX = /^([\-\+]?[0-9\.]+)/
normalizers.float = (input, normType) ->
  res = FLOAT_REGEX.exec(input)
  if res != null
    parseFloat(res[1])
  else
    null


normalizers.date = (input, normType) ->
  return new Date(input)


normalizers.string = (input, normType) ->
  if normType is 'query'
    if /^\/(.*?)\/(g?i?m?y?)$/.test(input)
      return [{'$regex' : eval(input)}, input]
  input


exports.normalize = (path, value, normType) ->
  if path of config.PARAMETERS and config.PARAMETERS[path].type?
    return normalizers[config.PARAMETERS[path].type](value)
  else
    return normalizers['default'](value, normType)
