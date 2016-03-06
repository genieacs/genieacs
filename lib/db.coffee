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


connect = (callback) ->
  callbackCounter = 6
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


getTask = (taskId, callback) ->
  tid = String(taskId)
  redisClient.get(tid, (err, res) ->
    return callback(err) if err
    if res?
      callback(err, JSON.parse(res))
    else
      tasksCollection.findOne({_id : mongodb.ObjectID(tid)}, (err, task) ->
        callback(err, task)
      )
  )


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

  # Build projection
  projection = {_id: 1}
  for pattern in patterns
    if pattern.length == 0
      projection['_timestamp'] = 1
    else if not pattern[0]?
      projection[''] = 1
    else if pattern[0] == 'Events'
      if pattern.length == 1
        res.push([['Events'], timestamp, 1, timestamp, 1, timestamp, 0])
      else if pattern.length == 2
        if not pattern[1]?
          projection['_registered'] = 1
          projection['_lastInform'] = 1
          projection['_lastBootstrap'] = 1
          projection['_lastBoot'] = 1
          res.push([['Events', null], timestamp])
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
        res.push([['DeviceID'], timestamp, 1, timestamp, 1, timestamp, 0])
      else if pattern.length == 2
        if not pattern[1]?
          projection['_id'] = 1
          projection['_deviceId._Manufacturer'] = 1
          projection['_deviceId._ProductClass'] = 1
          projection['_deviceId._SerialNumber'] = 1
          projection['_deviceId._OUI'] = 1
          res.push([['DeviceID', null], timestamp])
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
        res.push([['Tags'], timestamp, 1, timestamp, 1, timestamp, 0])
      else if pattern.length == 2
        res.push([['Tags', null], timestamp])
        projection['_tags'] = 1
    else
      for i in [0...pattern.length] by 1
        break if not pattern[i]

      if i == pattern.length
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
        s = pattern.slice(0, i).join('.')
        projection[s] = 1

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

      v = [timestamp, 1]

      if obj['_value']?
        v[6] = obj['_timestamp'] ? timestamp
        v[7] = [obj['_value'], obj['_type']]
        obj['_object'] = false

      if obj['_writable']?
        v[4] = timestamp
        v[5] = if obj['_writable'] then 1 else 0

      if obj['_object']?
        v[2] = timestamp
        v[3] = if obj['_object'] then 1 else 0

      if v.length
        v[0] ?= timestamp ? 0
        v[1] ?= 1
        res.push([path].concat(v))

      for k, v of obj
        if k[0] != '_'
          obj['_object'] = true
          storeParams(v, path.concat(k), obj['_timestamp'] ? 0, descendantsFetched)

      if obj['_object'] and descendantsFetched
        res.push([path.concat(null), obj['_timestamp'] ? 0])

    for k, v of device
      if k == '_timestamp'
        res.push([[null], v]) if not Object.keys(projection).length
      else if k == '_lastInform'
        res.push([['Events', 'Inform'], timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [v, 'xsd:dateTime']])
      else if k == '_lastBoot'
        res.push([['Events', '1_BOOT'], timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [v, 'xsd:dateTime']])
      else if k == '_lastBootstrap'
        res.push([['Events', '0_BOOTSTRAP'], timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [v, 'xsd:dateTime']])
      else if k == '_registered'
        res.push([['Events', 'Registered'], timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [v, 'xsd:dateTime']])
      else if k == '_id'
        res.push([['DeviceID', 'ID'], timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [v, 'xsd:string']])
      else if k == '_tags'
        for t in v
          res.push([['Tags', t], timestamp, 1, timestamp, 0, timestamp, 1, timestamp, [true, 'xsd:boolean']])
      else if k == '_deviceId'
        for kk, vv of v
          if kk == '_Manufacturer'
            res.push([['DeviceID', 'Manufacturer'], timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [vv, 'xsd:string']])
          else if kk == '_OUI'
            res.push([['DeviceID', 'OUI'], timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [vv, 'xsd:string']])
          if kk == '_ProductClass'
            res.push([['DeviceID', 'ProductClass'], timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [vv, 'xsd:string']])
          if kk == '_SerialNumber'
            res.push([['DeviceID', 'SerialNumber'], timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [vv, 'xsd:string']])
      else if common.typeOf(v) is common.OBJECT_TYPE
        storeParams(v, [k], 0, projection == null)

    return callback(null, res)
  )


saveDevice = (deviceId, diff, isNew, callback) ->
  update = {'$set' : {}, '$unset' : {}, '$addToSet' : {}, '$pull' : {}}
  for p in diff
    base = p[2]
    current = p[3]
    if p[0][0] == 'Events'
      if p[0].length == 2
        if p[0][1] == 'Inform'
          update['$set']['_lastInform'] = new Date(current[7][0])
        else if p[0][1] == '0_BOOTSTRAP'
          update['$set']['_lastBootstrap'] = new Date(current[7][0])
        else if p[0][1] == '1_BOOT'
          update['$set']['_lastBoot'] = new Date(current[7][0])
        else if p[0][1] == 'Registered'
          update['$set']['_registered'] = new Date(current[7][0])
    else if p[0][0] == 'Tags'
      if p[0].length == 2 and p[0][1]?
        if current[7][0] and not base[7]?[0]
          update['$addToSet']['_tags'] ?= {'$each' : []}
          update['$addToSet']['_tags']['$each'].push(p[0][1])
        else if not current[7]?[0] and base[7]?[0]
          update['$pull']['_tags'] ?= {'$in' : []}
          update['$pull']['_tags']['$in'].push(p[0][1])
    else if p[0][0] == 'DeviceID'
      if p[0].length == 2 and current[7]?
        if p[0][1] == 'ID'
          update['$set']['_id'] = current[7][0]
        else if p[0][1] == 'Manufacturer'
          update['$set']['_deviceId._Manufacturer'] = current[7][0]
        else if p[0][1] == 'OUI'
          update['$set']['_deviceId._OUI'] = current[7][0]
        else if p[0][1] == 'ProductClass'
          update['$set']['_deviceId._ProductClass'] = current[7][0]
        else if p[0][1] == 'SerialNumber'
          update['$set']['_deviceId._SerialNumber'] = current[7][0]
    else if p[1] == p[0].length
      param = p[0].join('.')
      if current[2]?
        if current[3] != base[3]
          if current[3]
            update['$set']["#{param}._object"] = true
          else if base[3]?
            update['$unset']["#{param}._object"] = 1
      else if base[2]?
        update['$unset']["#{param}._object"] = 1

      if current[4]?
        if current[5] != base[5]
          update['$set']["#{param}._writable"] = !!current[5]
      else if base[4]?
        update['$unset']["#{param}._writable"] = 1

      if current[6]? and current[7]?
        if current[6] != base[6]
          update['$set']["#{param}._timestamp"] = new Date(current[6])

        if current[7][0] != base[7]?[0] or current[7][1] != base[7]?[1]
          if current[7][1] == 'xsd:dateTime'
            update['$set']["#{param}._value"] = new Date(current[7][0])
          else
            update['$set']["#{param}._value"] = current[7][0]
          update['$set']["#{param}._type"] = current[7][1]
      else if base[7]?
        update['$unset']["#{param}._value"] = 1
        update['$unset']["#{param}._type"] = 1
    else if p[1] == p[0].length - 1 and not p[0][p[1]]?
      param = p[0].slice(0, p[1]).concat('_timestamp').join('.')
      if current?
        update['$set'][param] = new Date(current)
      else if base?
        update['$unset'][param] = 1

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

  devicesCollection.update({'_id' : deviceId}, update, {upsert: isNew}, (err, count) =>
    if not err and count != 1
      return callback(new Error("Device #{deviceId} not found in database"))

    return callback(err)
  )


exports.getTask = getTask
exports.getPresetsObjectsAliases = getPresetsObjectsAliases
exports.getAliases = getAliases
exports.connect = connect
exports.disconnect = disconnect
exports.fetchDevice = fetchDevice
exports.saveDevice = saveDevice
