config = require './config'
db = require './db'


PATH_REGEX = /\w+|(\/.+?\/\w*)/g

# Javascript represents numbers as 64-bit floating point numbers
# Integers up to 2^53 can be encoded precisely
MAX_PARAMETERS = 52


# get the index of the least significant bit
getLsb = (num) ->
  i = -1
  while num > 0
    ++ i
    break if num & 1
    num >>= 1
  return i


# compile types into data types optimized for quick lookup
types = []
stringSegments = {}
regexSegments = {}
paramRegex = {}

for k, v of config.PARAMETERS
  continue if not v.type?
  typeIndex = types.push(v.type) - 1
  throw new Error("There cannot be more than #{MAX_PARAMETERS} configured parameters") if typeIndex >= MAX_PARAMETERS
  segmentIndex = 0
  parts = k.match(PATH_REGEX)
  for i in [0 ... parts.length]
    part = parts[i]
    positionHash = i + parts.length * MAX_PARAMETERS

    if part[0] == '/' # this is a regex part
      j = part.lastIndexOf('/')
      regExp = new RegExp(part[1...j], part[j+1..])
      regexSegments[positionHash] ?= 0
      regexSegments[positionHash] |= Math.pow(2, typeIndex)
      paramRegex[typeIndex] ?= {}
      paramRegex[typeIndex][i] = regExp
    else
      stringSegments[positionHash] ?= {}
      stringSegments[positionHash][part] ?= 0
      stringSegments[positionHash][part] |= Math.pow(2, typeIndex)


getType = (param) ->
  parts = param.split('.')
  positionHash = parts.length * MAX_PARAMETERS

  stringIndices = 0 | stringSegments[positionHash]?[parts[0]]
  allIndices = stringIndices | regexSegments[positionHash]

  for i in [1...parts.length]
    positionHash = i + parts.length * MAX_PARAMETERS
    strIdx = stringSegments[positionHash]?[parts[i]]
    rgxIdx = regexSegments[positionHash]
    stringIndices &= strIdx
    allIndices &= (strIdx | rgxIdx)

  if stringIndices > 0
    return types[getLsb(stringIndices)]
  
  typeIndex = 0
  while allIndices > 0
    if allIndices & 1
      match = true
      for i, r of paramRegex[typeIndex]
        if not r.test(parts[i])
          match = false
          break

      if match
        return types[typeIndex]

    ++ typeIndex
    allIndices >>= 1

  return null


splitIds = (batches, callback) ->
  ids = [{}]
  return callback(ids) if batches == 1
  db.devicesCollection.count((err, count) ->
    return callback(ids) if count <= 1000
    batchSize = Math.floor(count / batches)
    for i in [1 ... batches]
      ids[i] = {}
      do (i) ->
        cursor = db.devicesCollection.find({}, {_id:1}).sort({'_id':1}).skip(i * batchSize).limit(1)
        cursor.nextObject((err, obj) ->
          ids[i]['$gte'] = obj._id
          ids[i-1]['$lt'] = obj._id
          if i == batches - 1
            callback(ids)
        )
  )


compileAliases = (callback) ->
  map = () ->
    for key, parts of keys
      ref = this
      path = ''
      for part in parts
        if part.test?
          r = ref
          ref = null
          for p of r
            if part.test(p)
              path += ".#{p}"
              ref = r[p]
              break
        else
          path += ".#{part}"
          ref = ref[part]
        break if not ref
      emit(path[1..], key) if ref
    return

  reduce = (k, v) ->
    return v[0]

  aliases = {}
  keys = {}
  for k, v of config.PARAMETERS
    alias = v.alias
    continue if not alias?
    isStatic = true
    ar = []
    for p in k.match(/\w+|(\/.+?\/\w*)/g)
      if p[0] == '/' # this is a regex
        isStatic = false
        i = p.lastIndexOf('/')
        r = new RegExp(p[1...i], p[i+1..])
        ar.push(r)
      else
        ar.push(p)

    if isStatic
      if not aliases[alias]?
        aliases[alias] = []
      aliases[alias].push(k)
    else
      keys[k] = ar

  counter = 0
  splitIds(4, (batches) ->
    for batch in batches
      options = {
        out : {inline : 1}
        jsMode : true
        sort : {$natural : 1}
        scope : {keys : keys, flags : {}}
        query : {_id : batch} if batches.length > 1
      }

      db.devicesCollection.mapReduce(map, reduce, options, (err, out) ->
        for o in out
          alias = config.PARAMETERS[o.value].alias
          if not aliases[alias]?
            aliases[alias] = []
          id = String(o._id)
          if id not in aliases[alias]
            aliases[alias].push(id)

        if ++counter == batches.length
          callback(err, aliases, config.ALIASES_CACHE)
      )
  )


exports.getType = getType
exports.compileAliases = compileAliases
