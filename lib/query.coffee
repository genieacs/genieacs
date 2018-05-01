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
#
# This file incorporates work covered by the following copyright and
# permission notice:
#
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

common = require './common'
mongodb = require 'mongodb'


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


normalize = (input) ->
  if common.typeOf(input) is common.STRING_TYPE
    vals = [input]
    if (m = /^\/(.*?)\/(g?i?m?y?)$/.exec(input))
      vals.push({'$regex' : new RegExp(m[1], m[2])})

    if +input == parseFloat(input)
      vals.push(+input)

    d = new Date(input)
    if input.length >= 8 and d.getFullYear() > 1983
      vals.push(d)

    r = stringToRegexp(input)
    if r isnt false
      vals.push({'$regex' : r})

    return vals
  return input


expandValue = (value) ->
  if common.typeOf(value) is common.ARRAY_TYPE
    a = []
    for j in value
      a = a.concat(expandValue(j))
    return [a]
  else if common.typeOf(value) isnt common.OBJECT_TYPE
    n = normalize(value)
    if common.typeOf(n) isnt common.ARRAY_TYPE
      return [n]
    else
      return n

  objs = []
  indices = []
  keys = []
  values = []
  for k,v of value
    keys.push(k)
    values.push(expandValue(v))
    indices.push(0)

  i = 0
  while i < indices.length
    obj = {}
    for i in [0...keys.length]
      obj[keys[i]] = values[i][indices[i]]
    objs.push(obj)

    for i in [0...indices.length]
      indices[i] += 1
      if indices[i] < values[i].length
        break
      indices[i] = 0
  return objs


permute = (param, val) ->
  conditions = []

  values = expandValue(val)
  if param[param.lastIndexOf('.') + 1] != '_'
    param += '._value'

  for v in values
    obj = {}
    obj[param] = v
    conditions.push(obj)

  return conditions


expand = (query) ->
  new_query = {}
  for k,v of query
    if k[0] == '$' # operator
      expressions = []
      for e in v
        expressions.push(expand(e))
      new_query[k] = expressions
    else
      conditions = permute(k, v)
      if conditions.length > 1
        new_query['$and'] ?= []
        if v?['$ne']?
          for c in conditions
            new_query['$and'].push(c)
        else
          new_query['$and'].push({'$or' : conditions})
      else
        Object.assign(new_query, conditions[0])

  return new_query


# Generate parameter projection from a query
# If second arg is given, it's edited and returned
queryProjection = (query, proj) ->
  proj ?= {}
  for k,v of query
    if k.charAt(0) == '$' # this is a logical operator
      for q in v
        queryProjection(q, proj)
    else
      proj[k] = 1
  return proj


testExpressions = (params, expressions, lop) ->
  for f in expressions
    res = test(params, f)

    switch lop
      when '$and'
        return false if not res
      when '$or'
        return true if res
      when '$nor'
        return false if res

  return switch lop
    when '$and' then true
    when '$or' then false
    when '$nor' then true
    else throw new Error('Unknown logical operator')


test = (params, query) ->
  for k,v of query
    if k.charAt(0) == '$' # this is a logical operator
      res = testExpressions(params, v, k)
    else
      value = params[k]

      if common.typeOf(v) isnt common.OBJECT_TYPE
        # TODO comparing array to regex, array to array, and object to object
        if common.typeOf(value) is common.ARRAY_TYPE
          res = value.indexOf(v) != -1
        else
          if common.typeOf(v) is common.REGEXP_TYPE
            res = v.test(value)
          else
            res = v == value
      else
        for k2,v2 of v
          switch k2
            when '$ne'
              if common.typeOf(value) is common.ARRAY_TYPE
                res = value.indexOf(v2) == -1
              else
                res = value != v2
            when '$lt'
              res = value < v2
            when '$lte'
              res = value <= v2
            when '$gt'
              res = value > v2
            when '$gte'
              res = value >= v2
            when '$regex'
              res = v2.test(value)
            when '$in'
              throw new Error('Operator not supported')
            when '$nin'
              throw new Error('Operator not supported')
            when '$all'
              throw new Error('Operator not supported')
            when '$exists'
              throw new Error('Operator not supported')
            else
              throw new Error('Operator not supported')

    if not res
      return false

  return true


matchType = (src, dst) ->
  if typeof src is 'string'
    return String(dst)
  else if typeof src is 'number'
    if +dst == parseFloat(dst)
      return +dst
    else if not isNaN(Date.parse(dst))
      return Date.parse(dst)
  else if typeof src is 'boolean'
    v = String(dst).trim()
    if v is 'true' or v is 'TRUE' or v is 'True' or v is '1'
      return true
    else if v is 'false' or v is 'FALSE' or v is 'False' or v is '0'
      return false

  return dst


testFilter = (obj, filter) ->
  for k, v of filter
    [param, op] = k.split(/([^a-zA-Z0-9\-\_\.].*)/, 2)
    val = matchType(obj[param], v)
    switch op
      when '=', undefined
        return false if obj[param] != val
      when '>'
        return false if not (obj[param] > val)
      when '>='
        return false if not (obj[param] >= val)
      when '<'
        return false if not (obj[param] < val)
      when '<='
        return false if not (obj[param] <= val)
      when '!'
        return false if obj[param] == val
      else
        throw new Error("Unrecognized operator #{op}")

  return true


convertMongoQueryToFilters = (query, filters) ->
  filters ?= {}
  for k, v of query
    if k[0] == '$'
      if k == '$and'
        for vv in v
          convertMongoQueryToFilters(vv, filters)
      else
        throw new Error("Operator #{k} not supported")
    else if k == '_tags'
      if common.typeOf(v) is common.OBJECT_TYPE
        for kk, vv of v
          vv = vv.replace(/[^a-zA-Z0-9\-]+/g, '_')
          switch kk
            when '$ne'
              filters["Tags.#{vv}!"] = true
            else
              throw new Error("Operator #{kk} not supported")
      else
        v = v.replace(/[^a-zA-Z0-9\-]+/g, '_')
        filters["Tags.#{v}"] = true
    else
      switch k
        when '_id' then k = 'DeviceID.ID'
        when '_deviceId._Manufacturer' then k = 'DeviceID.Manufacturer'
        when '_deviceId._OUI' then k = 'DeviceID.OUI'
        when '_deviceId._ProductClass' then k = 'DeviceID.ProductClass'
        when '_deviceId._SerialNumber' then k = 'DeviceID.SerialNumber'
        when '_lastInform' then k = 'Events.Inform'
        when '_lastBootstrap' then k = 'Events.0_BOOTSTRAP'
        when '_lastBoot' then k = 'Events.1_BOOT'
        when '_registered' then k = 'Events.Registered'

      if common.typeOf(v) is common.OBJECT_TYPE
        for kk, vv of v
          switch kk
            when '$eq'
              filters[k] = vv
            when '$ne'
              filters["#{k}!"] = vv
            when '$lt'
              filters["#{k}<"] = vv
            when '$lte'
              filters["#{k}<="] = vv
            when '$gt'
              filters["#{k}>"] = vv
            when '$gte'
              filters["#{k}>="] = vv
            else
              throw new Error("Oprator #{kk} not supported")
      else
        filters[k] = v

  return filters


sanitizeQueryTypes = (query, types) ->
  for k, v of query
    if k[0] == '$' # logical operator
      sanitizeQueryTypes(vv, types) for vv in v
    else if k of types
      if common.typeOf(v) is common.OBJECT_TYPE
        for kk, vv of v
          switch kk # operator
            when '$in', '$nin'
              vv[i] = types[k](vv[i]) for i in [0...vv.length]
            when '$eq', '$gt', '$gte', '$lt', '$lte', '$ne'
              v[kk] = types[k](vv)
            when '$exists', '$type' then
              # ignore
            else
              throw new Error('Operator not supported')
      else
        query[k] = types[k](query[k])

  return query


exports.expand = expand
exports.queryProjection = queryProjection
exports.test = test
exports.sanitizeQueryTypes = sanitizeQueryTypes
exports.convertMongoQueryToFilters = convertMongoQueryToFilters
exports.testFilter = testFilter
