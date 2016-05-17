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
      if common.typeOf(values[i][indices[i]]) is common.REGEXP_TYPE
        if keys[i] == '$ne'
          obj['$not'] = values[i][indices[i]]
          continue
      else if keys[i] == '$not' and common.typeOf(values[i][indices[i]]) isnt common.OBJECT_TYPE
        # Only a regex or decoument (object) are allowed within a $not operator.
        # This is needed in order to discard string from which a regex is generated.
        continue

      obj[keys[i]] = values[i][indices[i]]
    objs.push(obj) if Object.keys(obj).length

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
        if v?['$ne']? or v?['$nin']? or v?['$not']?
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


exports.expand = expand
exports.substituteObjectId = substituteObjectId
