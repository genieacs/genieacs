###
# Copyright 2013-2016  Zaid Abdulla
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
normalize = require './normalize'
mongodb = require 'mongodb'


expandValue = (param, value) ->
  if common.typeOf(value) is common.ARRAY_TYPE
    a = []
    for j in value
      a = a.concat(expandValue(param, j))
    return [a]
  else if common.typeOf(value) isnt common.OBJECT_TYPE
    n = normalize.normalize(param, value, 'query')
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
    values.push(expandValue(param, v))
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


permute = (param, val, aliases) ->
  keys = []
  if aliases[param]?
    for p in aliases[param]
      keys.push(p)
  else
    keys.push(param)

  conditions = []
  for k in keys
    values = expandValue(k, val)
    if k[k.lastIndexOf('.') + 1] != '_'
      k += '._value'

    for v in values
      obj = {}
      obj[k] = v
      conditions.push(obj)

  return conditions


expand = (query, aliases) ->
  new_query = {}
  for k,v of query
    if k[0] == '$' # operator
      expressions = []
      for e in v
        expressions.push(expand(e, aliases))
      new_query[k] = expressions
    else
      conditions = permute(k, v, aliases)
      if conditions.length > 1
        new_query['$and'] ?= []
        if v?['$ne']?
          for c in conditions
            new_query['$and'].push(c)
        else
          new_query['$and'].push({'$or' : conditions})
      else
        common.extend(new_query, conditions[0])

  return new_query


# Replace _id string values with ObjectID type
substituteObjectId = (query) ->
  for k, v of query
    if k[0] == '$' # logical operator
      for i in [0...v.length]
        substituteObjectId(v[i])
    else if k == '_id'
      if common.typeOf(v) is common.STRING_TYPE
        query[k] = mongodb.ObjectID(v) if v.length == 24
      else if common.typeOf(v) is common.OBJECT_TYPE
        for kk, vv of v
          switch kk # operator
            when '$in', '$nin'
              for i in [0...vv.length]
                vv[i] = mongodb.ObjectID(vv[i]) if vv[i].length == 24
            when '$eq', '$gt', '$gte', '$lt', '$lte', '$ne'
              v[kk] = mongodb.ObjectID(vv) if vv.length == 24
            when '$exists', '$type' then
              # ignore
            else
              throw new Error('Operator not supported')

  return query


# Generate parameter projection from a query
# If second arg is given, it's edited and returned
queryProjection = (query, proj) ->
  proj ?= {}
  for k,v of query
    if k.charAt(0) == '$' # this is a logical operator
      for q in v
        projection(q, proj)
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


exports.expand = expand
exports.substituteObjectId = substituteObjectId
exports.queryProjection = queryProjection
exports.test = test
