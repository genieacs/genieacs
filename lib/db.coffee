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
###

config = require './config'
mongodb = require 'mongodb'
redis = require('redis')
parameters = require './parameters'
common = require './common'

redisClient = null
tasksCollection = null
devicesCollection = null
presetsCollection = null
objectsCollection = null
provisionsCollection = null
virtualParametersCollection = null
faultsCollection = null


connect = (callback) ->
  callbackCounter = 9
  mongodb.MongoClient.connect(config.get('MONGODB_CONNECTION_URL'), {db:{w:1},server:{autoReconnect:true}}, (err, db) ->
    return callback(err) if err
    exports.mongoDb = db
    db.collection('tasks', (err, collection) ->
      exports.tasksCollection = tasksCollection = collection
      collection?.ensureIndex({device: 1, timestamp: 1}, (err) ->
      )

      if --callbackCounter == 0 or err
        callbackCounter = 0
        return callback(err)
    )

    db.collection('devices', (err, collection) ->
      exports.devicesCollection  = devicesCollection = collection
      if --callbackCounter == 0 or err
        callbackCounter = 0
        return callback(err)
    )

    db.collection('presets', (err, collection) ->
      exports.presetsCollection = presetsCollection = collection
      if --callbackCounter == 0 or err
        callbackCounter = 0
        return callback(err)
    )

    db.collection('objects', (err, collection) ->
      exports.objectsCollection = objectsCollection = collection
      if --callbackCounter == 0 or err
        callbackCounter = 0
        return callback(err)
    )

    db.collection('fs.files', (err, collection) ->
      exports.filesCollection = filesCollection = collection
      if --callbackCounter == 0 or err
        callbackCounter = 0
        return callback(err)
    )

    db.collection('provisions', (err, collection) ->
      exports.provisionsCollection = provisionsCollection = collection
      if --callbackCounter == 0 or err
        callbackCounter = 0
        return callback(err)
    )

    db.collection('virtualParameters', (err, collection) ->
      exports.virtualParametersCollection = virtualParametersCollection = collection
      if --callbackCounter == 0 or err
        callbackCounter = 0
        return callback(err)
    )

    db.collection('faults', (err, collection) ->
      exports.faultsCollection = faultsCollection = collection
      if --callbackCounter == 0 or err
        callbackCounter = 0
        return callback(err)
    )

    exports.redisClient = redisClient = redis.createClient(config.get('REDIS_PORT'), config.get('REDIS_HOST'))
    redisClient.select(config.get('REDIS_DB'), (err) ->
      if --callbackCounter == 0 or err
        callbackCounter = 0
        return callback(err)
    )
  )


disconnect = () ->
  exports.mongoDb.close()
  redisClient.quit()


getCached = (name, valueCallback, valueExpiry, callback) ->
  redisClient.get(name, (err, res) ->
    return callback(err) if err
    return callback(null, JSON.parse(res)) if res?

    lockAcquired = () ->
      valueCallback((err, value) ->
        return callback(err, value) if err
        redisClient.setex(name, valueExpiry, JSON.stringify(value), (err) ->
          return callback(err, value) if err
          redisClient.del("lock.#{name}", (err) ->
            callback(err, value)
          )
        )
      )

    redisClient.setnx("lock.#{name}", Date.now() + 30000, (err, res) ->
      return callback(err) if err
      if res == 1
        lockAcquired()
      else
        setTimeout(() ->
          redisClient.get("lock.#{name}", (err, timestamp) ->
            return callback(err) if err
            now = Date.now()
            if not timestamp?
              getCached(name, valueCallback, valueExpiry, callback)
            else if timestamp > now
              setTimeout(() ->
                getCached(name, valueCallback, valueExpiry, callback)
              , 1000)
            else
              redisClient.getset("lock.#{name}", now + 30000, (err, timestamp) ->
                return callback(err) if err
                if timestamp > now
                  setTimeout(() ->
                    getCached(name, valueCallback, valueExpiry, callback)
                  , 1000)
                else
                  lockAcquired()
              )
          )
        , 1000)
    )
  )


getAliases = (callback) ->
  getCached('aliases', parameters.compileAliases, config.get('PRESETS_CACHE_DURATION'), (err, res) ->
    throw err if err
    callback(res)
  )


getPresetsObjectsAliases = (callback) ->
  redisClient.mget('presets', 'objects', 'aliases', (err, res) ->
    presets = JSON.parse(res[0])
    objects = JSON.parse(res[1])
    aliases = JSON.parse(res[2])

    if presets and objects and aliases
      return callback(presets, objects, aliases)

    if not presets
      getCached('presets', (callback) ->
        presetsCollection.find().toArray((err, res) ->
          for r in res
            r.precondition = JSON.parse(r.precondition)

            # Generate provisions from the old configuration format
            r.provisions = []
            for c in r.configurations
              switch c.type
                when 'age'
                  r.provisions.push(['refresh', c.name, c.age * -1000])
                when 'value'
                  r.provisions.push(['value', c.name, c.value])
                when 'add_tag'
                  r.provisions.push(['tag', c.tag, true])
                when 'delete_tag'
                  r.provisions.push(['tag', c.tag, false])
                else
                  throw new Error("Unknown configuration type #{c.type}")

          callback(err, res)
        )
      , config.get('PRESETS_CACHE_DURATION'), (err, res) ->
        throw err if err
        presets = res
        callback(presets, objects, aliases) if objects and aliases
      )

    if not objects
      getCached('objects', (callback) ->
        objectsCollection.find().toArray((err, res) ->
          return callback(err) if err
          objs = {}
          objs[r._id] = r for r in res
          callback(null, objs)
        )
      , config.get('PRESETS_CACHE_DURATION'), (err, res) ->
        throw err if err
        objects = res
        callback(presets, objects, aliases) if presets and aliases
      )

    if not aliases
      getCached('aliases', parameters.compileAliases, config.get('PRESETS_CACHE_DURATION'), (err, res) ->
        throw err if err
        aliases = res
        callback(presets, objects, aliases) if presets and objects
      )
  )


# Optimize projection by removing overlaps
# This modifies given object and returns it
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
  return obj


fetchDevice = (id, timestamp, patterns, callback) ->
  res = []
  loaded = []

  # Build projection
  projection = {_id: 1}
  for pattern in patterns
    loaded.push([pattern, 1])
    if pattern.length == 0
      projection['_timestamp'] = 1
    else if pattern[0] == '*'
      projection[''] = 1
    else if pattern[0] == 'Events'
      if pattern.length == 1
        res.push([['Events'],
          {exist: timestamp, object: timestamp, writable: timestamp},
          {exist: 1, object: 1, writable: 0}])
      else if pattern.length == 2
        if pattern[1] == '*'
          projection['_registered'] = 1
          projection['_lastInform'] = 1
          projection['_lastBootstrap'] = 1
          projection['_lastBoot'] = 1
          res.push([['Events', '*'], {exist: timestamp}])
        else if pattern[1] == 'Registered'
          projection['_registered'] = 1
        else if pattern[1] == 'Inform'
          projection['_lastInform'] = 1
        else if pattern[1] == '0_BOOTSTRAP'
          projection['_lastBootstrap'] = 1
        else if pattern[1] == '1_BOOT'
          projection['_lastBoot'] = 1
    else if pattern[0] == 'DeviceID'
      if pattern.length == 1
        res.push([['DeviceID'],
          {exist: timestamp, object: timestamp, writable: timestamp},
          {exist: 1, object: 1, writable: 0}])

      else if pattern.length == 2
        if pattern[1] == '*'
          projection['_id'] = 1
          projection['_deviceId._Manufacturer'] = 1
          projection['_deviceId._ProductClass'] = 1
          projection['_deviceId._SerialNumber'] = 1
          projection['_deviceId._OUI'] = 1
          res.push([['DeviceID', '*'], {exist: timestamp}])

        else if pattern[1] == 'ID'
          projection['_id'] = 1
        else if pattern[1] == 'Manufacturer'
          projection['_deviceId._Manufacturer'] = 1
        else if pattern[1] == 'ProductClass'
          projection['_deviceId._ProductClass'] = 1
        else if pattern[1] == 'OUI'
          projection['_deviceId._OUI'] = 1
        else if pattern[1] == 'SerialNumber'
          projection['_deviceId._SerialNumber'] = 1
    else if pattern[0] == 'Tags'
      if pattern.length == 1
        res.push([['Tags'],
          {exist: timestamp, object: timestamp, writable: timestamp},
          {exist: 1, object: 1, writable: 0}])

      else if pattern.length == 2
        res.push([['Tags', '*'], {exist: timestamp}])
        projection['_tags'] = 1
    else
      wildcardIndex = pattern.indexOf('*')

      if wildcardIndex == -1
        s = pattern.join('.')
        projection["#{s}._value"] = 1
        projection["#{s}._timestamp"] = 1
        projection["#{s}._type"] = 1
        projection["#{s}._writable"] = 1
        projection["#{s}._object"] = 1
        projection["#{s}._orig"] = 1

        # Timestamp from parent is needed for writable timestamp
        if pattern.length <= 1
          projection['_timestamp'] = 1
        else
          projection["#{pattern.slice(0, -1).join('.')}._timestamp"] = 1
      else
        p = pattern.slice(0, wildcardIndex)
        loaded.push([p, 99])
        s = p.join('.')
        projection[s] = 1
        projection[pattern.slice(0, wildcardIndex - 1).concat('_timestamp').join('.')] = 1

  if projection['']
    projection = {}

  if projection?
    optimizeProjection(projection)

  devicesCollection.findOne({'_id' : id}, projection, (err, device) ->
    return callback(err) if err or not device?

    storeParams = (obj, path, timestamp, descendantsFetched) ->
      if not descendantsFetched and not obj['_value']? and projection[path.join('.')]
        descendantsFetched = true

      if obj['_timestamp']?
        obj['_timestamp'] = +obj['_timestamp']

      t = {}
      v = {}

      if obj['_value']?
        t.value = obj['_timestamp'] ? timestamp
        v.value = [obj['_value'], obj['_type']]
        obj['_object'] = false
        t.exist = Math.max(t.exist || 0, t.value)
        v.exist = 1

      if obj['_writable']?
        t.writable = timestamp or 1
        v.writable = if obj['_writable'] then 1 else 0
        t.exist = Math.max(t.exist || 0, t.writable)
        v.exist = 1

      if obj['_object']?
        t.object = obj['_timestamp'] or timestamp or 1
        v.object = if obj['_object'] then 1 else 0
        t.exist = Math.max(t.exist || 0, t.object)
        v.exist = 1

        if not obj['_object']
          loaded.push([path, 99])

      res.push([path, t, v])

      for k, v of obj
        if k[0] != '_'
          obj['_object'] = true
          storeParams(v, path.concat(k), obj['_timestamp'] ? 0, descendantsFetched)

      if obj['_object'] and descendantsFetched
        res.push([path.concat('*'), {exist: obj['_timestamp'] ? 0}])

    for k, v of device
      if k == '_timestamp'
        res.push([['*'], {exist: v}]) if not Object.keys(projection).length
      else if k == '_lastInform'
        res.push([['Events', 'Inform'],
          {exist: timestamp, object: timestamp, writable: timestamp, value: timestamp},
          {exist: 1, object: 0, writable: 0, value: [+v, 'xsd:dateTime']}])
      else if k == '_lastBoot'
        res.push([['Events', '1_BOOT'],
          {exist: timestamp, object: timestamp, writable: timestamp, value: timestamp},
          {exist: 1, object: 0, writable: 0, value: [+v, 'xsd:dateTime']}])
      else if k == '_lastBootstrap'
        res.push([['Events', '0_BOOTSTRAP'],
          {exist: timestamp, object: timestamp, writable: timestamp, value: timestamp},
          {exist: 1, object: 0, writable: 0, value: [+v, 'xsd:dateTime']}])
      else if k == '_registered'
        res.push([['Events', 'Registered'],
          {exist: timestamp, object: timestamp, writable: timestamp, value: timestamp},
          {exist: 1, object: 0, writable: 0, value: [+v, 'xsd:dateTime']}])
      else if k == '_id'
        res.push([['DeviceID', 'ID'],
          {exist: timestamp, object: timestamp, writable: timestamp, value: timestamp},
          {exist: 1, object: 0, writable: 0, value: [v, 'xsd:string']}])
      else if k == '_tags'
        for t in v
          res.push([['Tags', t],
            {exist: timestamp, object: timestamp, writable: timestamp, value: timestamp},
            {exist: 1, object: 0, writable: 1, value: [true, 'xsd:boolean']}])
      else if k == '_deviceId'
        for kk, vv of v
          if kk == '_Manufacturer'
            res.push([['DeviceID', 'Manufacturer'],
              {exist: timestamp, object: timestamp, writable: timestamp, value: timestamp},
              {exist: 1, object: 0, writable: 0, value: [vv, 'xsd:boolean']}])
          else if kk == '_OUI'
            res.push([['DeviceID', 'OUI'],
              {exist: timestamp, object: timestamp, writable: timestamp, value: timestamp},
              {exist: 1, object: 0, writable: 0, value: [vv, 'xsd:boolean']}])
          if kk == '_ProductClass'
            res.push([['DeviceID', 'ProductClass'],
              {exist: timestamp, object: timestamp, writable: timestamp, value: timestamp},
              {exist: 1, object: 0, writable: 0, value: [vv, 'xsd:boolean']}])
          if kk == '_SerialNumber'
            res.push([['DeviceID', 'SerialNumber'],
              {exist: timestamp, object: timestamp, writable: timestamp, value: timestamp},
              {exist: 1, object: 0, writable: 0, value: [vv, 'xsd:boolean']}])
      else if common.typeOf(v) is common.OBJECT_TYPE
        storeParams(v, [k], +(device['_timestamp'] ? 0), Object.keys(projection).length == 0)

    return callback(null, res, loaded)
  )


saveDevice = (deviceId, deviceData, isNew, callback) ->
  update = {'$set' : {}, '$unset' : {}, '$addToSet' : {}, '$pull' : {}}

  # Delete parameters that no longer exist
  iter = deviceData.values.exist.diff()
  while not (diff = iter.next()).done
    if diff.value[1] and not diff.value[2]
      update['$unset'][diff.value[0].join('.')] = 1

  # Set object's children timestamps
  iter = deviceData.timestamps.exist.diff()
  while not (diff = iter.next()).done
    continue if diff.value[0].wildcard != (1 << (diff.value[0].length - 1))
    continue if diff.value[0][0] in ['Events', 'DeviceID', 'Tags']

    if not diff.value[2]? and diff.value[1]?
      update['$unset'][diff.value[0].slice(0, -1).concat('_timestamp').join('.')] = 1
    else if diff.value[2] != diff.value[1]
      update['$set'][diff.value[0].slice(0, -1).concat('_timestamp').join('.')] = new Date(diff.value[2])

  # Set writable
  iter = deviceData.values.writable.diff()
  while not (diff = iter.next()).done
    continue if diff.value[0][0] in ['Events', 'DeviceID', 'Tags']
    if not diff.value[2]? and diff.value[1]?
      update['$unset'][diff.value[0].concat('_writable').join('.')] = 1
    else if diff.value[2] != diff.value[1]
      update['$set'][diff.value[0].concat('_writable').join('.')] = Boolean(diff.value[2])

  # Set object
  iter = deviceData.values.object.diff()
  while not (diff = iter.next()).done
    continue if diff.value[0][0] in ['Events', 'DeviceID', 'Tags']
    if diff.value[1] != diff.value[2]
      if diff.value[2]
        update['$set'][diff.value[0].concat('_object').join('.')] = true
      else if not diff.value[2]?
        update['$unset'][diff.value[0].concat('_object').join('.')] = 1
      else
        if deviceData.values.value.getDiff(diff.value[0])?[2]?
          if diff.value[1]?
            update['$unset'][diff.value[0].concat('_object').join('.')] = 1
        else
          update['$set'][diff.value[0].concat('_object').join('.')] = false
    else if diff.value[2]?
      vdiff = deviceData.values.value.getDiff(diff.value[0])
      if vdiff[1] != vdiff[2]
        if not vdiff[2]?
          update['$set'][diff.value[0].concat('_object').join('.')] = false
        else if not vdiff[1]?
          update['$unset'][diff.value[0].concat('_object').join('.')] = 1

  # Set value
  iter = deviceData.values.value.diff()
  while not (diff = iter.next()).done
    if diff.value[0][0] == 'Events'
      continue if diff.value[1]?[0] == diff.value[2][0]
      if diff.value[0][1] == 'Inform'
        update['$set']['_lastInform'] = new Date(diff.value[2][0])
      else if diff.value[0][1] == '1_BOOT'
        update['$set']['_lastBoot'] = new Date(diff.value[2][0])
      else if diff.value[0][1] == '0_BOOTSTRAP'
        update['$set']['_lastBootstrap'] = new Date(diff.value[2][0])
      else if diff.value[0][1] == 'Registered'
        update['$set']['_registered'] = new Date(diff.value[2][0])
    else if diff.value[0][0] == 'Tags'
      continue if diff.value[1]?[0] == diff.value[2]?[0]
      if diff.value[2][0]
        update['$addToSet']['_tags'] ?= {'$each' : []}
        update['$addToSet']['_tags']['$each'].push(p[0][1])
      else
        update['$pull']['_tags'] ?= {'$in' : []}
        update['$pull']['_tags']['$in'].push(p[0][1])
    else if diff.value[0][0] == 'DeviceID'
      continue if diff.value[1]?[0] == diff.value[2][0]
      if diff.value[0][1] == 'ID'
        update['$set']['_id'] = diff.value[2][0]
      else if diff.value[0][1] == 'Manufacturer'
        update['$set']['_deviceId._Manufacturer'] = diff.value[2][0]
      else if diff.value[0][1] == 'OUI'
        update['$set']['_deviceId._OUI'] = diff.value[2][0]
      else if diff.value[0][1] == 'ProductClass'
        update['$set']['_deviceId._ProductClass'] = diff.value[2][0]
      else if diff.value[0][1] == 'SerialNumber'
        update['$set']['_deviceId._SerialNumber'] = diff.value[2][0]
    else
      tdiff = deviceData.timestamps.value.getDiff(diff.value[0])
      if diff.value[2]?
        if tdiff[2] != tdiff[1]
          update['$set'][diff.value[0].concat('_timestamp').join('.')] = new Date(tdiff[2])
          delete update['$unset'][diff.value[0].concat('_timestamp').join('.')]
        if diff.value[2][0] != diff.value[1]?[0]
          update['$set'][diff.value[0].concat('_value').join('.')] = diff.value[2][0]
        if diff.value[2][1] != diff.value[1]?[1]
          update['$set'][diff.value[0].concat('_type').join('.')] = diff.value[2][1]

      else if diff.value[1]?
        update['$unset'][diff.value[0].concat('_value').join('.')] = 1
        update['$unset'][diff.value[0].concat('_value').join('.')] = 1

  # Remove empty keys
  for k of update
    if k == '$addToSet'
      for kk of update[k]
        delete update[k][kk] if update[k][kk]['$each'].length == 0
    else if k == '$pull'
      for kk of update[k]
        delete update[k][kk] if update[k][kk]['$in'].length == 0
    delete update[k] if Object.keys(update[k]).length == 0

  return callback() if Object.keys(update).length == 0

  if (update['$unset']?)
    optimizeProjection(update['$unset'])

  devicesCollection.update({'_id' : deviceId}, update, {upsert: isNew}, (err, result) ->
    if not err and result.result.n != 1
      return callback(new Error("Device #{deviceId} not found in database"))

    return callback(err)
  )


getDueTasksAndFaults = (deviceId, timestamp, callback) ->
  redisClient.mget("#{deviceId}_no_tasks", "#{deviceId}_faults", (err, res) ->
    return callback(err) if err

    if res[0]?
      tasks = []

    if res[1]?
      faults = JSON.parse(res[1])

    if tasks? and faults?
      return callback(null, tasks, faults)

    CACHE_DURATION = config.get('PRESETS_CACHE_DURATION', deviceId)

    if not faults?
      getFaults(deviceId, (err, flts) ->
        if err
          callback?(err)
          return callback = null

        faults = flts
        if tasks?
          return callback(null, tasks, faults)
      )

    if not tasks?
      getDueTasks(deviceId, timestamp, (err, dueTasks, nextTimestamp) ->
        if err
          callback?(err)
          return callback = null

        if nextTimestamp?
          exp = Math.min(0, Math.trunc((nextTimestamp - Date.now()) / 1000))
        else
          exp = CACHE_DURATION

        redisClient.setex("#{deviceId}_no_tasks", exp, 1, (err) ->
          if err
            callback?(err)
            return callback = null

          tasks = dueTasks
          if faults?
            return callback(null, tasks, faults)
        )
      )
  )


getFaults = (deviceId, callback) ->
  faultsCollection.find({'_id' : {'$regex' : "^#{common.escapeRegExp(deviceId)}\\:"}}).toArray((err, res) ->
    return callback(err) if err

    faults = {}
    for r in res
      channel = r._id.slice(deviceId.length + 1)
      delete r._id
      r.timestamp = +r.timestamp
      r.expiry = +r.expiry if r.expiry?
      faults[channel] = r

    CACHE_DURATION = config.get('PRESETS_CACHE_DURATION', deviceId)

    redisClient.setex("#{deviceId}_faults", CACHE_DURATION, JSON.stringify(faults), (err) ->
      callback(err, faults)
    )
  )



getDueTasks = (deviceId, timestamp, callback) ->
  cur = tasksCollection.find({
    'device' : deviceId,
    'fault' : {'$exists': false}
    }).sort(['timestamp'])

  tasks = []

  cur.nextObject(f = (err, task) ->
    return callback(err) if err

    if not task?
      return callback(null, tasks, null)

    task.timestamp = +task.timestamp if task.timestamp?

    if task.timestamp >= timestamp
      return callback(null, tasks, +task.timestamp)

    task._id = String(task._id)
    tasks.push(task)
    cur.nextObject(f)
  )


clearTasks = (taskIds, callback) ->
  if not taskIds?.length
    return callback()

  tasksCollection.remove({'_id' : {'$in' : (mongodb.ObjectID(id) for id in taskIds)}}, callback)


syncFaults = (deviceId, faults, callback) ->
  getFaults(deviceId, (err, existingFaults) ->
    return callback(err) if err

    counter = 1
    toDelete = []
    for k of existingFaults
      if k not of faults
        toDelete.push("#{deviceId}:#{k}")

    if toDelete.length
      ++ counter
      faultsCollection.remove({'_id' : {'$in' : toDelete}}, (err) ->
        if err
          callback(err) if counter
          return counter = 0

        if -- counter == 0
          return redisClient.del("#{deviceId}_faults", callback)
      )

    for channel, fault of faults
      continue if fault.retries == existingFaults[channel]?.retries
      do (channel, fault) ->
        ++ counter
        fault._id = "#{deviceId}:#{channel}"
        fault.timestamp = new Date(fault.timestamp)
        fault.expiry = new Date(fault.expiry) if fault.expiry?

        faultsCollection.save(fault, (err) ->
          if err
            callback(err) if counter
            return counter = 0

          if channel.startsWith('_task_')
            return tasksCollection.update({_id: mongodb.ObjectID(channel.slice(6))}, {$set: {fault: fault.fault, retries: fault.retries}}, (err) ->
              if err
                callback(err) if counter
                return counter = 0

              if -- counter == 0
                return redisClient.del("#{deviceId}_faults", callback)
            )
          else
            if -- counter == 0
              return redisClient.del("#{deviceId}_faults", callback)
        )

    if -- counter == 0
      return callback()
  )


exports.getPresetsObjectsAliases = getPresetsObjectsAliases
exports.getAliases = getAliases
exports.connect = connect
exports.disconnect = disconnect
exports.fetchDevice = fetchDevice
exports.saveDevice = saveDevice
exports.getDueTasksAndFaults = getDueTasksAndFaults
exports.clearTasks = clearTasks
exports.syncFaults = syncFaults
