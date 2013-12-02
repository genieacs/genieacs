common = require './common'
normalize = require './normalize'


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
        if new_query['$and']?
          new_query['$and'].push({'$or' : conditions})
        else
          new_query['$and'] = [{'$or' : conditions}]
      else
        common.extend(new_query, conditions[0])

  return new_query


exports.expand = expand
