config = require './config'
common = require './common'


stringToRegexp = (input) ->
  if (input.indexOf('*') == -1)
    return false

  output = input.replace(/[\[\]\\\^\$\.\|\?\+\(\)]/, "\\$&")
  if output[0] == '*'
    prefix = '/'
    output = output.replace(/^\*+/g, '')
  else
    prefix = '/^'

  if output[output.length - 1] == '*'
    suffix = '/'
    output = output.replace(/\*+$/g, '')
  else
    suffix = '$/'

  output = output.replace(/[\*]/, '.*')

  return eval(prefix + output + suffix)


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

    r = stringToRegexp(input)
    if r isnt false
      vals.push({'$regex' : r})

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


normalizers.mac = (input, normType) ->
  if normType isnt 'query'
    return input

  input = input.toUpperCase().replace(/[^0-9A-F]/g, '')
  if input.length == 12
    return input.substring(2).replace(/[0-9A-F]{2}(?!$)/g, '$&:')

  return {'$regex' : eval('/' + input.replace(/[0-9A-F]{1}(?!$)/g, '$&:?') + '/')}


exports.normalize = (path, value, normType) ->
  if path of config.PARAMETERS and config.PARAMETERS[path].type?
    return normalizers[config.PARAMETERS[path].type](value, normType)
  else
    return normalizers['default'](value, normType)
