###
# Copyright 2013 Fanoos Telecom
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.
###

# Credit to Netanel Rubin from Check Point Software Technologies for discovering
# vulnerability caused by use of eval to generate regex from user input.

common = require './common'
parameters = require './parameters'


stringToRegexp = (input, flags) ->
  if (input.indexOf('*') == -1)
    return false

  output = input.replace(/[\[\]\\\^\$\.\|\?\+\(\)]/, "\\$&")
  if output[0] == '*'
    output = output.replace(/^\*+/g, '')
  else
    output = '^' + output

  if output[output.length - 1] == '*'
    output = output.replace(/\*+$/g, '')
  else
    output = output + '$'

  output = output.replace(/[\*]/, '.*')

  return new RegExp(output, flags)


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
      vals.push(r)

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
    if (m = /^\/(.*?)\/(g?i?m?y?)$/.exec(input))
      return [new RegExp(m[1], m[2]), input]
  return input


colonizeMac = (input) ->
  if (i = input.indexOf(':')) != -1
    i = if (i % 2) == 0 then 0 else 1
    while i < input.length
      if input[i-1] != ':' and input[i-2] != ':'
        if input[i] != ':' and i != 0
          input = input.substring(0, i) + ':' + input.substring(i)
          ++i
        ++i
      ++ i
    return input
  else
    return input.replace(/[0-9A-F]{1}(?!$)/g, '$&:?')


normalizers.mac = (input, normType) ->
  if normType isnt 'query'
    return input

  input = input.trim().toUpperCase().replace(/[^0-9A-F\*\-\:]/g, '').replace(/[\-\:]/g, ':')

  if input.indexOf('*') != -1
    input = (colonizeMac(a) for a in input.split('*')).join('*')
    return stringToRegexp(input, 'i')

  input = colonizeMac(input)

  if input.length == 17
    return [input, input.toLowerCase()]

  return new RegExp(input, 'i')


exports.normalize = (path, value, normType) ->
  type = parameters.getType(path) ? 'default'
  normalizers[type](value, normType)
