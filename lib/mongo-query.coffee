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
  return if keys.length <= 1
  i = 1
  while i < keys.length
    a = keys[i-1]
    b = keys[i]
    if common.startsWith(b, a)
      if b.charAt(a.length) == '.' or b.charAt(a.length - 1) == '.'
        delete obj[b]
        keys.splice(i--, 1)
    ++ i


exports.test = test
exports.projection = projection
exports.optimizeProjection = optimizeProjection
