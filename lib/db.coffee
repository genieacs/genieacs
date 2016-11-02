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
  MAX_DEPTH = config.get('MAX_DEPTH', id)

  projection = {_id: 1}
  projectionTree = {}
  func = (path, pats, projTree) ->
    children = {}
    for pat in pats
      fragment = pat[0][path.length] or '*'
      load = 0
      if fragment == '*'
        projection[path.join('.')] = 1
        return

      projTree[fragment] ?= {}

      if pat[1] & (1 << path.length)
        projection[path.concat('_timestamp').join('.')] = 1
        projection[path.concat([fragment, '_timestamp']).join('.')] = 1
        projection[path.concat([fragment, '_value']).join('.')] = 1
        projection[path.concat([fragment, '_type']).join('.')] = 1
        projection[path.concat([fragment, '_object']).join('.')] = 1
        projection[path.concat([fragment, '_writable']).join('.')] = 1
        projection[path.concat([fragment, '_orig']).join('.')] = 1

      if pat[1] >> (path.length + 1)
        children[fragment] ?= []
        children[fragment].push(pat)

    for k, v of children
      func(path.concat(k), v, projTree[k])

  func([], patterns, projectionTree)

  if projection['']?
    proj = {}
  else
    proj = JSON.parse(JSON.stringify(projection))

  for k, v of proj
    if k == '' or k == 'Events' or k.startsWith('Events.')
      if k.length < 7 or k.startsWith('Events.Inform.') or k == 'Events.Inform'
        proj['_lastInform'] = 1
      if k.length < 7 or k.startsWith('Events.1_BOOT.') or k == 'Events.1_BOOT'
        proj['_lastBoot'] = 1
      if k.length < 7 or k.startsWith('Events.0_BOOTSTRAP.') or k == 'Events.0_BOOTSTRAP'
        proj['_lastBootstrap'] = 1
      if k.length < 7 or k.startsWith('Events.Registered.') or k == 'Events.Registered'
        proj['_registered'] = 1
      delete proj[k] if k != ''

    if k == '' or k == 'DeviceID' or k.startsWith('DeviceID.')
      if k.length < 9 or k.startsWith('DeviceID.ID.') or k == 'DeviceID.ID'
        proj['_id'] = 1
      if k.length < 9 or k.startsWith('DeviceID.Manufacturer.') or k == 'DeviceID.DeManufacturer'
        proj['_deviceId._Manufacturer'] = 1
      if k.length < 9 or k.startsWith('DeviceID.ProductClass.') or k == 'DeviceID.ProductClass'
        proj['_deviceId._ProductClass'] = 1
      if k.length < 9 or k.startsWith('DeviceID.OUI.') or k == 'DeviceID.OUI'
        proj['_deviceId._OUI'] = 1
      if k.length < 9 or k.startsWith('DeviceID.SerialNumber.') or k == 'DeviceID.SerialNumber'
        proj['_deviceId._SerialNumber'] = 1
      if k.length < 9
        proj['_deviceId'] = 1
      delete proj[k] if k != ''

    if k == '' or k == 'Tags' or k.startsWith('Tags.')
      proj['_tags'] = 1
      delete proj[k] if k != ''

  optimizeProjection(proj)

  res = []
  loaded = []

  devicesCollection.findOne({'_id' : id}, proj, (err, device) ->
    return callback(err) if err or not device?

    storeParams = (obj, path, timestamp, descendantsFetched, projTree) ->
      if descendantsFetched
        thisFetched = true
      else
        if projection[path.join('.')]
          descendantsFetched = true
          loaded.push([path, ((1 << path.length) - 1) ^ ((1 << MAX_DEPTH) - 1)])
        if projection[path.concat('_writable').join('.')]
          loaded.push([path, 1 << (path.length - 1)])
          thisFetched = true

      if obj['_timestamp']?
        obj['_timestamp'] = +obj['_timestamp']

      if thisFetched
        attrs = {}

        t = if obj['_timestamp'] > timestamp then obj['_timestamp'] else timestamp

        if obj['_value']?
          attrs.value = [obj['_timestamp'] or 1, [obj['_value'], obj['_type']]]
          attrs.value[1][0] = +attrs.value[1][0] if obj['_type'] == 'xsd:dateTime'
          obj['_object'] = false

        if obj['_writable']?
          attrs.writable = [timestamp, if obj['_writable'] then 1 else 0]

        if obj['_object']?
          attrs.object = [t, if obj['_object'] then 1 else 0]

        res.push([path, t, attrs])

      for k, v of obj
        if k[0] != '_'
          kk = k
          obj['_object'] = true
          storeParams(v, path.concat(k), obj['_timestamp'] or 1, descendantsFetched, projTree?[k])
          delete projTree[kk] if projTree

      if obj['_object']
        if descendantsFetched
          res.push([path.concat('*'), obj['_timestamp']]) if obj['_timestamp']
        else
          for k, v of projTree
            p = path.concat(k)
            res.push([p, +(obj['_timestamp'] ? 1)])
            loaded.push([p, ((1 << path.length) - 1) ^ ((1 << MAX_DEPTH) - 1)])

    for k, v of device
      if k == '_lastInform'
        device['Events'] ?= {'_timestamp': timestamp, '_writable': false, '_object': true}
        device['Events']['Inform'] = {'_writable': false, '_value': v, '_type' : 'xsd:dateTime', '_timestamp': v}
        delete device[k]
      else if k == '_lastBoot'
        device['Events'] ?= {'_timestamp': timestamp, '_writable': false, '_object': true}
        device['Events']['1_BOOT'] = {'_writable': false, '_value': v, '_type' : 'xsd:dateTime', '_timestamp': v}
        delete device[k]
      else if k == '_lastBootstrap'
        device['Events'] ?= {'_timestamp': timestamp, '_writable': false, '_object': true}
        device['Events']['0_BOOTSTRAP'] = {'_writable': false, '_value': v, '_type' : 'xsd:dateTime', '_timestamp': v}
        delete device[k]
      else if k == '_registered'
        device['Events'] ?= {'_timestamp': timestamp, '_writable': false, '_object': true}
        device['Events']['Registered'] = {'_writable': false, '_value': v, '_type' : 'xsd:dateTime', '_timestamp': v}
        delete device[k]
      else if k == '_id'
        device['DeviceID'] ?= {'_timestamp': timestamp, '_writable': false, '_object': true}
        device['DeviceID']['ID'] = {'_writable': false, '_value': v, '_type' : 'xsd:string', '_timestamp': timestamp}
        delete device[k]
      else if k == '_tags'
        device['Tags'] ?= {'_timestamp': timestamp, '_writable': false, '_object': true}
        for t in v
          t = t.replace(/[^a-zA-Z0-9\-]+/g, '_')
          device['Tags'][t] = {'_writable': true, '_value': true, '_type' : 'xsd:boolean', '_timestamp': timestamp}
        delete device[k]
      else if k == '_deviceId'
        device['DeviceID'] ?= {'_timestamp': timestamp, '_writable': false, '_object': true}
        for kk, vv of v
          if kk == '_Manufacturer'
            device['DeviceID']['Manufacturer'] = {'_writable': false, '_value': vv, '_type' : 'xsd:string', '_timestamp': timestamp}
          else if kk == '_OUI'
            device['DeviceID']['OUI'] = {'_writable': false, '_value': vv, '_type' : 'xsd:string', '_timestamp': timestamp}
          if kk == '_ProductClass'
            device['DeviceID']['ProductClass'] = {'_writable': false, '_value': vv, '_type' : 'xsd:string', '_timestamp': timestamp}
          if kk == '_SerialNumber'
            device['DeviceID']['SerialNumber'] = {'_writable': false, '_value': vv, '_type' : 'xsd:string', '_timestamp': timestamp}
        delete device[k]

    storeParams(device, [], 0, false, projectionTree)

    return callback(null, res, loaded)
  )


saveDevice = (deviceId, deviceData, isNew, callback) ->
  update = {'$set' : {}, '$unset' : {}, '$addToSet' : {}, '$pull' : {}}

  iter = deviceData.timestamps.diff()
  while diff = iter.next().value
    continue if diff[0].wildcard != (1 << (diff[0].length - 1))
    continue if diff[0][0] in ['Events', 'DeviceID', 'Tags']

    if not diff[2]? and diff[1]?
      update['$unset'][diff[0].slice(0, -1).concat('_timestamp').join('.')] = 1
    else if diff[2] != diff[1]
      parent = deviceData.paths.subset(diff[0].slice(0, -1)).next().value
      if parent and (parent.length == 0 or deviceData.attributes.has(parent))
        update['$set'][diff[0].slice(0, -1).concat('_timestamp').join('.')] = new Date(diff[2])

  iter = deviceData.attributes.diff()
  while diff = iter.next().value
    continue if diff[1] == diff[2]
    path = diff[0]
    switch path[0]
      when 'Events'
        if diff[0].length == 2 and diff[2].value?[1][0] != diff[1]?.value?[1][0]
          t = new Date(diff[2].value[1][0])
          switch path[1]
            when 'Inform'
              update['$set']['_lastInform'] = t
            when '1_BOOT'
              update['$set']['_lastBoot'] = t
            when '0_BOOTSTRAP'
              update['$set']['_lastBootstrap'] = t
            when 'Registered'
              update['$set']['_registered'] = t
      when 'DeviceID'
        if diff[2].value?[1]?[0] != diff[1]?.value?[1]?[0]
          v = diff[2].value[1][0]
          switch path[1]
            when 'ID'
              update['$set']['_id'] = v
            when 'Manufacturer'
              update['$set']['_deviceId._Manufacturer'] = v
            when 'OUI'
              update['$set']['_deviceId._OUI'] = v
            when 'ProductClass'
              update['$set']['_deviceId._ProductClass'] = v
            when 'SerialNumber'
              update['$set']['_deviceId._SerialNumber'] = v
      when 'Tags'
        if diff[2]?.value?[1]?[0] != diff[1]?.value?[1]?[0]
          v = diff[2]?.value?[1][0]
          if v?
            update['$addToSet']['_tags'] ?= {'$each' : []}
            update['$addToSet']['_tags']['$each'].push(diff[0][1])
          else
            update['$pull']['_tags'] ?= {'$in' : []}
            update['$pull']['_tags']['$in'].push(diff[0][1])
      else
        if not diff[2]
          update['$unset'][diff[0].join('.')] = 1
          continue

        for attrName of diff[2]
          if diff[2][attrName][1]? or diff[1]?[attrName]?[1]?
            switch attrName
              when 'value'
                if not diff[1] or diff[2].value[1][0] != diff[1].value?[1][0]
                  if diff[2].value[1][1] == 'xsd:dateTime'
                    update['$set'][path.concat('_value').join('.')] = new Date(diff[2].value[1][0])
                  else
                    update['$set'][path.concat('_value').join('.')] = diff[2].value[1][0]
                if not diff[1] or diff[2].value[1][1] != diff[1].value?[1][1]
                  update['$set'][path.concat('_type').join('.')] = diff[2].value[1][1]
                if not diff[1] or diff[2].value[0] != diff[1].value?[0]
                  update['$set'][path.concat('_timestamp').join('.')] = new Date(diff[2].value[0])
              when 'object'
                if not diff[1]?.object or diff[2].object[1] != diff[1].object?[1]
                  update['$set'][path.concat('_object').join('.')] = !!diff[2].object[1]
              when 'writable'
                if not diff[1]?.writable or diff[2].writable[1] != diff[1].writable?[1]
                  update['$set'][path.concat('_writable').join('.')] = !!diff[2].writable[1]

        if diff[1]
          for attrName of diff[1]
            if attrName not of diff[2]
              update['$unset'][path.concat("_#{attrName}").join('.')] = 1
              if attrName is 'value'
                update['$unset'][path.concat('_type').join('.')] = 1
                update['$unset'][path.concat('_timestamp').join('.')] = 1


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
      continue if existingFaults[channel]? and fault.retries == existingFaults[channel].retries
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


exports.connect = connect
exports.disconnect = disconnect
exports.fetchDevice = fetchDevice
exports.saveDevice = saveDevice
exports.getDueTasksAndFaults = getDueTasksAndFaults
exports.clearTasks = clearTasks
exports.syncFaults = syncFaults
