###
# Copyright 2013, 2014  Zaid Abdulla
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


test = (obj, query) ->
  for k,v of query
    if k.charAt(0) == '$' # this is a logical operator
      res = testExpressions(obj, v, k)
    else
      value = common.getParamValueFromPath(obj, k)

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


testExpressions = (obj, expressions, lop) ->
  for f in expressions
    res = test(obj, f)

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


# generate field projection from a query
projection = (query, proj) ->
  for k,v of query
    if k.charAt(0) == '$' # this is a logical operator
      for q in v
        projection(q, proj)
    else
      proj[k] = 1

# optimize projection by removing overlaps
optimizeProjection = (obj) ->
  keys = Object.keys(obj).sort()
  i = 1
  while i < keys.length
    a = keys[i-1]
    b = keys[i]
    if common.startsWith(b, a)
      if b.charAt(a.length) == '.' or b.charAt(a.length - 1) == '.'
        delete obj[b]
        keys.splice(i--, 1)
    ++ i

  # Emtpy string implies fetch all
  if keys[0] == ''
    delete obj[k] for k in keys

  return


exports.test = test
exports.projection = projection
exports.optimizeProjection = optimizeProjection
