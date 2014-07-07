common = require './common'
db = require './db'
normalize = require('./normalize').normalize
mongoQuery = require './mongo-query'
parameters = require './parameters'

OBJECT_REGEX = /\.$/
INSTANCE_REGEX = /\.[\d]+\.$/


updateDevice = (deviceId, actions, callback) ->
  return callback?() if not actions?

  now = new Date(Date.now())
  update = {'$set' : {}, '$unset' : {}}

  if actions.parameterValues?
    for p in actions.parameterValues
      origValue = p[1]
      v = normalize(p[0], origValue)

      path = if common.endsWith(p[0], '.') then p[0] else "#{p[0]}."
      if v == origValue
        update['$unset']["#{path}_orig"] = 1
      else
        update['$set']["#{path}_orig"] = origValue
      update['$set']["#{path}_value"] = v
      update['$set']["#{path}_timestamp"] = now
      if p[2]?
        update['$set']["#{path}_type"] = p[2]

  if actions.deletedObjects?
    for p in actions.deletedObjects
      update['$unset'][p] = 1

  if actions.instanceName?
    for i in actions.instanceName
      update['$set']["#{i[0]}._name"] = i[1]

  if actions.parameterNames?
    projection = {} # fetch only necessary parameters
    presentPaths = {} # to be compared with to find no longer existing parameters

    for p in actions.parameterNames
      if OBJECT_REGEX.test(p[0])
        path = p[0].slice(0, -1)
        if INSTANCE_REGEX.test(p[0])
          update['$set']["#{path}._instance"] = true
        else
          update['$set']["#{path}._object"] = true
      else
        path = p[0]
      update['$set']["#{path}._writable"] = p[1] if p[1]?
      update['$set']["#{path}._timestamp"] = now

      # Add parameter (sans any dot suffix) if has an alias
      if (a = parameters.getAlias(path))?
        newAliases = {} if not newAliases?
        newAliases[path] = a

      projection[path] = 1

      # Store this param path and all its parents for later look up
      presentPaths[path] = true
      i = p[0].indexOf('.')
      while i != -1
        presentPaths[p[0][0...i]] = true
        i = p[0].indexOf('.', i + 1)

    mongoQuery.optimizeProjection(projection)

  if actions.customCommands?
    for p in actions.customCommands
      commandName = p[0]
      update['$set']["_customCommands.#{commandName}._value"] = p[1]
      update['$set']["_customCommands.#{commandName}._timestamp"] = now

  if actions.set?
    common.extend(update['$set'], actions.set)

  f = () ->
    for k of update
      delete update[k] if Object.keys(update[k]).length == 0

    if Object.keys(update).length
      db.devicesCollection.update({'_id' : deviceId}, update, {}, (err, count) ->
        throw err if err
        # Clear aliases cache if there's a new aliased parameter that has not been included in aliases cache
        if newAliases?
          db.getAliases((aliases) ->
            for p, a of newAliases
              if not aliases[a]? or p not in aliases[a]
                db.redisClient.del('aliases', (err, res) ->
                  throw err if err
                )
                break
          )
        callback?(err)
      )
    else
      callback?()

  if projection?
    db.devicesCollection.findOne({'_id' : deviceId}, projection, (err, device) ->
      throw err if err

      recursive = (obj, prefix) ->
        for k,v of obj
          p = prefix + k
          if k[0] == '_'
            # Remove set operations for unmodified values for optimization
            if update['$set'][p] == v
              delete update['$set'][p]
            continue

          # Remove unset operations for values that don't exist
          delete update['$unset']["#{p}._orig"] if not v._orig?

          if presentPaths[p]
            recursive(v, "#{p}.")
          else
            update['$unset'][p] = 1

      # Scan the DB object and remove parameters that no longer exists in device
      for k, v of projection
        root = device
        rootPath = ''
        for p in path.split('.')
          rootPath += "#{p}."
          root = root[p]
          break if not root?

        if root
          recursive(root, rootPath)
        else
          if not presentPaths[rootPath.slice(0, -1)]
            update['$unset'][rootPath.slice(0, -1)] = 1
      f()
    )
  else
    f()

module.exports = updateDevice