###
# Copyright 2013-2015  Zaid Abdulla
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

MAX_DEPTH = 16


class DataModel

  constructor: () ->
    @parameters = [[],[]]


  set: (layer, parameter, values, leaf, ancestorDefaults) ->
    parts = if parameter == '' then [] else parameter.split('.')

    ref = @parameters
    for i in [0 ... parts.length]
      ref[0][layer] |= 0 # init flag
      ref[1][layer] ?= if ancestorDefaults? then JSON.parse(JSON.stringify(ancestorDefaults)) else {}
      ref[2] ?= {}
      ref[2][parts[i]] ?= [[],[]]
      ref = ref[2][parts[i]]

    ref[0][layer] |= 1
    ref[0][layer] |= Math.pow(2, MAX_DEPTH - i) - 1 if leaf
    ref[1][layer] ?= {}
    for k, v of values
      ref[1][layer][k] = v


  # Flag parameters matching given pattern indicating they're fully fetched.
  flag: (layer, pattern, descendants) ->
    parts = if pattern == '' then [] else pattern.split('.')
    length = parts.length
    filters = []
    i  = 0
    for p in parts
      if p != '*'
        filters.push([i, p])
        i = 0
      else
        ++ i

    ref = @parameters
    for f in filters
      length -= f[0] + 1
      ref[2 + f[0]] ?= {}
      ref[2 + f[0]][f[1]] ?= [[], []]
      ref = ref[2 + f[0]][f[1]]

    if descendants
      ref[0][layer] |= (Math.pow(2, (MAX_DEPTH-parts.length)) - 1) ^ (Math.pow(2, length) - 1)
    else
      ref[0][layer] |= Math.pow(2, length)


  # Walk through parameters matching given pattern recursively.
  # callback is (parameter, properties, flags, children).
  # flags is array ints for each layer, each bit for different depth level
  # Return value from callback is passed in children arg for parent callback
  walk: (pattern, callback) ->
    filters = {}
    if pattern?
      parts = if pattern == '' then [] else pattern.split('.')
      length = parts.length
      for p, i in parts
        filters[i] = p if p != '*'
    else
      length = MAX_DEPTH

    compileFlags = (filters, ref, depth) ->
      flags = ref[0].slice()

      for j in [0 ... ref.length - 2]
        r = ref[2 + j][filters[j + depth]]
        if r?
          childFlags = compileFlags(filters, r, depth + j + 1)
          for f, l in childFlags
            flags[l] |= f << j + 1

      return flags

    recursive = (pat, ref, depth, _flags) ->
      children = null

      flags = compileFlags(filters, ref, depth)
      for i in [0 ... Math.max(flags.length, _flags.length)]
        flags[i] = (flags[i] | _flags[i] >> 1) & (Math.pow(2, (1 + length) - depth) - 1)

      if depth < length
        children = {}
        if filters[depth]?
          if ref[2]?[filters[depth]]?
            res = recursive("#{pat}#{filters[depth]}.", ref[2][filters[depth]], depth + 1, flags)
            children[filters[depth]] = res if res?
        else
          for k, v of ref[2]
            res = recursive("#{pat}#{k}.", v, depth + 1, flags)
            children[k] = res if res?

      callback(pat[0...-1], ref[1], flags, children)

    return recursive('', @parameters, 0, [])


  serialize: () ->
    return @parameters


  @deserialize: (data) ->
    dataModel = new DataModel()
    dataModel.parameters = data
    return dataModel


module.exports = DataModel
