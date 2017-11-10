###
# Copyright 2013-2017  Zaid Abdulla
#
# This file is part of GenieACS.
#
# GenieACS is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# GenieACS is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
###

buffer = require 'buffer'

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


exports.generateDeviceId = (deviceIdStruct) ->
  # Percent escaping function. Escapes everything except alphanumerics and underscore
  esc = (str) ->
    str.replace(/[^A-Za-z0-9_]/g, (chr) ->
      buf = new buffer.Buffer(chr, 'utf8')
      rep = ''
      rep += "%#{b.toString(16).toUpperCase()}" for b in buf
      return rep
    )

  # Guaranteeing globally unique id as defined in TR-069
  if deviceIdStruct['ProductClass']
    return "#{esc(deviceIdStruct['OUI'])}-#{esc(deviceIdStruct['ProductClass'])}-#{esc(deviceIdStruct['SerialNumber'])}"

  return "#{esc(deviceIdStruct['OUI'])}-#{esc(deviceIdStruct['SerialNumber'])}"


exports.getParamValueFromPath = (obj, path) ->
  pp = path.split('.')
  ref = obj
  try
    for p in pp
      ref = ref[p]
    return ref
  catch err
    return undefined


pathOverlap = (a, b, start) ->
  if a.length == b.length
    res = 3
  else if a.length > b.length
    res = 2
  else
    res = 1

  for i in [(start ? 0)...Math.min(a.length, b.length)] by 1
    if a[i]?
      if not b[i]?
        res &= 2
      else if a[i] != b[i]
        return 0
    else if b[i]?
      res &= 1

    return 0 if not res

  return res


parseAlias = (pattern, start, res) ->
  aliases = []
  i = start
  while i < pattern.length and pattern[i] != ']'
    alias = []
    i = j = parsePath(pattern, i, alias) + 1

    while pattern[j] not in [']', ',']
      if pattern[j] == '"' and i == j
        ++ j
        while pattern[j] != '"' or pattern[j - 1] == '\\'
          if ++ j >= pattern.length
            throw new Error('Invalid alias expression')
      if ++ j >= pattern.length
        throw new Error('Invalid alias expression')
    value = pattern[i...j].trim()
    i = j
    if value[0] == '"'
      try
        value = JSON.parse(value)
      catch err
        throw new Error('Invalid alias expression')
    alias.push(value)
    aliases.push(alias)
    ++ i if pattern[i] == ','

  # Need to sort to ensure identical expressions have idential string representation
  srt = (a, b) ->
    for j in [0...Math.min(a.length, b.length)] by 2
      for k in [0...Math.min(a[j].length, b[j].length)] by 1
        if Array.isArray(a[j][k])
          if Array.isArray(b[j][k])
            return srt(a[j][k], b[j][k])
          else if not b[j][k]?
            return -1
          else
            return 1
        else if not a[j][k]?
          if not b[j][k]?
            return 0
          else
            return 1
        else if not b[j][k]? or Array.isArray(b[j][k])
            return -1
        else if a[j][k] > b[j][k]
          return 1
        else if a[j][k] < b[j][k]
          return -1

      if a[j].length > b[j].length
        return -1
      else if a[j].length < b[j].length
        return 1

      if a[j + 1] > b[j + 1]
        return -1
      else if a[j + 1] < b[j + 1]
        return 1

    if a.length > b.length
      return -1
    else if a.length < b.length
      return 1

    return 0

  aliases.sort(srt)
  res.push([].concat.apply([], aliases))
  return i


parsePath = (pattern, start, res) ->
  path = []
  path.wildcard = 0
  path.alias = 0
  i = start ? 0

  # Colon separator is needed for parseAlias
  if i < pattern.length and pattern[i] != ':'
    while true
      if pattern[i] == '['
        path.alias |= 1 << path.length
        i = parseAlias(pattern, i + 1, path) + 1
      else
        j = i
        while i < pattern.length and pattern[i] != ':' and pattern[i] != '.'
          ++ i
        n = pattern.slice(j, i)
        path.wildcard |= 1 << path.length if n == '*'
        path.push(n)

      if i >= pattern.length or pattern[i] == ':'
        break
      else if pattern[i] != '.'
        throw new Error('Invalid alias expression')

      ++ i

  Object.freeze(path)

  if not res?
    return path

  res.push(path)
  return i


addPathMeta = (path) ->
  return path if path.alias? or path.wildcard?

  path.alias = 0
  path.wildcard = 0

  for p, i in path
    if typeOf(p) is ARRAY_TYPE
      path.alias |= 1 << i
      for j in [0...p.length] by 2
        addPathMeta(p[j])
    else if p == '*'
      path.wildcard |= 1 << i

  Object.freeze(path)
  return path


hammingWeight = (flags) ->
  flags -= ((flags >> 1) & 0x55555555)
  flags = (((flags >> 2) & 0x33333333) + (flags & 0x33333333))
  flags = (((flags >> 4) + flags) & 0x0f0f0f0f)
  flags += (flags >> 8)
  flags += (flags >> 16)
  return flags & 0x0000003f


# Source: http://stackoverflow.com/a/6969486
escapeRegExp = (str) ->
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&")


exports.UNDEFINED_TYPE = UNDEFINED_TYPE
exports.NULL_TYPE = NULL_TYPE
exports.NUMBER_TYPE = NUMBER_TYPE
exports.STRING_TYPE = STRING_TYPE
exports.ARRAY_TYPE = ARRAY_TYPE
exports.OBJECT_TYPE = OBJECT_TYPE
exports.REGEXP_TYPE = REGEXP_TYPE

exports.typeOf = typeOf
exports.pathOverlap = pathOverlap
exports.parsePath = parsePath
exports.addPathMeta = addPathMeta
exports.hammingWeight = hammingWeight
exports.escapeRegExp = escapeRegExp
