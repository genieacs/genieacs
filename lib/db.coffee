###
# Copyright 2013-2017  Zaid Abdulla
#
# This file is part of GenieACS.
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
common = require './common'

tasksCollection = null
devicesCollection = null
presetsCollection = null
objectsCollection = null
provisionsCollection = null
virtualParametersCollection = null
faultsCollection = null
filesCollection = null
operationsCollection = null


connect = (callback) ->
  callbackCounter = 9
  mongodb.MongoClient.connect(config.get('MONGODB_CONNECTION_URL'), (err, db) ->
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

    db.collection('operations', (err, collection) ->
      exports.operationsCollection = operationsCollection = collection
      if --callbackCounter == 0 or err
        callbackCounter = 0
        return callback(err)
    )

  )


disconnect = () ->
  exports.mongoDb?.close()


# Optimize projection by removing overlaps
# This modifies given object and returns it
optimizeProjection = (obj) ->
  keys = Object.keys(obj).sort()
  return if keys.length <= 1
  i = 1
  while i < keys.length
    a = keys[i-1]
    b = keys[i]
    if b.startsWith(a)
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
        projection[path.concat([fragment, '_instance']).join('.')] = 1
        projection[path.concat([fragment, '_writable']).join('.')] = 1
        projection[path.concat([fragment, '_orig']).join('.')] = 1

      if pat[1] >> (path.length + 1)
        children[fragment] ?= []
        children[fragment].push(pat)

    for k, v of children
      func(path.concat(k), v, projTree[k])

  func([], patterns, projectionTree)

  delete projectionTree['DeviceID']
  delete projectionTree['Events']
  delete projectionTree['Tags']

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

        if obj['_object']? or obj['_instance']?
          attrs.object = [t, if (obj['_object'] or obj['_instance']) then 1 else 0]

        res.push([path, t, attrs])

      for k, v of obj
        if k[0] != '_'
          kk = k
          obj['_object'] = true
          storeParams(v, path.concat(k), obj['_timestamp'] or 1, descendantsFetched, projTree?[k])
          delete projTree[kk] if projTree

      if obj['_object'] or obj['_instance']
        if descendantsFetched
          res.push([path.concat('*'), obj['_timestamp']]) if obj['_timestamp']
        else
          for k, v of projTree
            p = path.concat(k)
            res.push([p, obj['_timestamp']]) if obj['_timestamp']
            loaded.push([p, ((1 << path.length) - 1) ^ ((1 << MAX_DEPTH) - 1)])

    for k, v of device
      switch k
        when '_lastInform'
          res.push([['Events'], timestamp,
            {object: [timestamp, 1], writable: [timestamp, 0]}])
          res.push([['Events', 'Inform'], +v,
            {object: [+v, 0], writable: [+v, 0], value: [+v, [+v, 'xsd:dateTime']]}])
          delete device[k]
        when '_lastBoot'
          res.push([['Events'], timestamp,
            {object: [timestamp, 1], writable: [timestamp, 0]}])
          res.push([['Events', '1_BOOT'], +v,
            {object: [+v, 0], writable: [+v, 0], value: [+v, [+v, 'xsd:dateTime']]}])
          delete device[k]
        when '_lastBootstrap'
          res.push([['Events'], timestamp,
            {object: [timestamp, 1], writable: [timestamp, 0]}])
          res.push([['Events', '0_BOOTSTRAP'], +v,
            {object: [+v, 0], writable: [+v, 0], value: [+v, [+v, 'xsd:dateTime']]}])
          delete device[k]
        when '_registered'
          res.push([['Events'], timestamp,
            {object: [timestamp, 1], writable: [timestamp, 0]}])
          # Use current timestamp for registered event attribute timestamps
          res.push([['Events', 'Registered'], timestamp,
            {object: [timestamp, 0], writable: [timestamp, 0], value: [timestamp, [+v, 'xsd:dateTime']]}])
          delete device[k]
        when '_id'
          res.push([['DeviceID'], timestamp,
            {object: [timestamp, 1], writable: [timestamp, 0]}])
          res.push([['DeviceID', 'ID'], timestamp,
            {object: [timestamp, 0], writable: [timestamp, 0], value: [timestamp, [v, 'xsd:string']]}])
          delete device[k]
        when '_tags'
          res.push([['Tags'], timestamp,
            {object: [timestamp, 1], writable: [timestamp, 0]}])
          for t in v
            t = t.replace(/[^a-zA-Z0-9\-]+/g, '_')
            res.push([['Tags', t], timestamp,
              {object: [timestamp, 0], writable: [timestamp, 1], value: [timestamp, [true, 'xsd:boolean']]}])
          delete device[k]
        when '_deviceId'
          res.push([['DeviceID'], timestamp,
            {object: [timestamp, 1], writable: [timestamp, 0]}])
          if v['_Manufacturer']?
            res.push([['DeviceID', 'Manufacturer'], timestamp,
              {object: [timestamp, 0], writable: [timestamp, 0], value: [timestamp, [v['_Manufacturer'], 'xsd:string']]}])
          if v['_OUI']?
            res.push([['DeviceID', 'OUI'], timestamp,
              {object: [timestamp, 0], writable: [timestamp, 0], value: [timestamp, [v['_OUI'], 'xsd:string']]}])
          if v['_ProductClass']?
            res.push([['DeviceID', 'ProductClass'], timestamp,
              {object: [timestamp, 0], writable: [timestamp, 0], value: [timestamp, [v['_ProductClass'], 'xsd:string']]}])
          if v['_SerialNumber']?
            res.push([['DeviceID', 'SerialNumber'], timestamp,
              {object: [timestamp, 0], writable: [timestamp, 0], value: [timestamp, [v['_SerialNumber'], 'xsd:string']]}])
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
      parent = deviceData.paths.get(diff[0].slice(0, -1))
      if parent and (parent.length == 0 or deviceData.attributes.has(parent))
        update['$set'][diff[0].slice(0, -1).concat('_timestamp').join('.')] = new Date(diff[2])

  iter = deviceData.attributes.diff()
  while diff = iter.next().value
    continue if diff[1] == diff[2]
    path = diff[0]
    switch path[0]
      when 'Events'
        if diff[0].length == 2 and diff[2]?.value?[1][0] != diff[1]?.value?[1][0]
          if not diff[2]
            switch path[1]
              when 'Inform'
                update['$unset']['_lastInform'] = 1
              when '1_BOOT'
                update['$unset']['_lastBoot'] = 1
              when '0_BOOTSTRAP'
                update['$unset']['_lastBootstrap'] = 1
              when 'Registered'
                update['$unset']['_registered'] = 1
          else
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
                  if diff[2].value[1][1] == 'xsd:dateTime' and Number.isInteger(diff[2].value[1][0])
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

  if update['$addToSet'] and update['$pull']
    # Mongo doesn't allow $addToSet and $pull at the same time
    update2 = {'$pull': update['$pull']}
    delete update['$pull']

  devicesCollection.update({'_id' : deviceId}, update, {upsert: isNew}, (err, result) ->
    if not err and result.result.n != 1
      return callback(new Error("Device #{deviceId} not found in database"))

    if update2
      return devicesCollection.update({'_id': deviceId}, update2, callback)

    return callback(err)
  )


getFaults = (deviceId, callback) ->
  faultsCollection.find({'_id' : {'$regex' : "^#{common.escapeRegExp(deviceId)}\\:"}}).toArray((err, res) ->
    return callback(err) if err

    faults = {}
    for r in res
      channel = r._id.slice(deviceId.length + 1)
      delete r._id
      delete r.channel
      delete r.device
      r.timestamp = +r.timestamp
      r.provisions = JSON.parse(r.provisions)
      faults[channel] = r

    callback(err, faults)
  )


saveFault = (deviceId, channel, fault, callback) ->
  fault = Object.assign({}, fault)
  fault._id = "#{deviceId}:#{channel}"
  fault.device = deviceId
  fault.channel = channel
  fault.timestamp = new Date(fault.timestamp)
  fault.provisions = JSON.stringify(fault.provisions)
  faultsCollection.save(fault, callback)


deleteFault = (deviceId, channel, callback) ->
  faultsCollection.remove({_id: "#{deviceId}:#{channel}"}, callback)


getDueTasks = (deviceId, timestamp, callback) ->
  cur = tasksCollection.find({'device' : deviceId}).sort(['timestamp'])

  tasks = []

  cur.nextObject(f = (err, task) ->
    return callback(err) if err

    if not task?
      return callback(null, tasks, null)

    task.timestamp = +task.timestamp if task.timestamp?
    task.expiry = +task.expiry if task.expiry?

    if task.timestamp >= timestamp
      return callback(null, tasks, +task.timestamp)

    task._id = String(task._id)
    tasks.push(task)

    # For API compatibility
    if task.name is 'download' and task.file?
      if mongodb.ObjectID.isValid(task.file)
        q = {_id: {'$in' : [task.file, new mongodb.ObjectID(task.file)]}}
      else
        q = {_id: task.file}

      filesCollection.find(q).toArray((err, res) ->
        return callback(err) if err
        if res[0]?
          task.fileType ?= res[0].metadata.fileType
          task.fileName ?= res[0].filename or res[0]._id.toString()
        cur.nextObject(f)
      )
    else
      cur.nextObject(f)
  )


clearTasks = (deviceId, taskIds, callback) ->
  tasksCollection.remove({'_id' : {'$in' : (new mongodb.ObjectID(id) for id in taskIds)}}, callback)


getOperations = (deviceId, callback) ->
  operationsCollection.find({'_id' : {'$regex' : "^#{common.escapeRegExp(deviceId)}\\:"}}).toArray((err, res) ->
    return callback(err) if err

    operations = {}
    for r in res
      commandKey = r._id.slice(deviceId.length + 1)
      delete r._id
      r.timestamp = +r.timestamp
      r.args = JSON.parse(r.args) if r.args
      r.provisions = JSON.parse(r.provisions)
      r.retries = JSON.parse(r.retries)
      operations[commandKey] = r

    callback(err, operations)
  )


saveOperation = (deviceId, commandKey, operation, callback) ->
  operation = Object.assign({}, operation)
  operation._id = "#{deviceId}:#{commandKey}"
  operation.timestamp = new Date(operation.timestamp)
  operation.provisions = JSON.stringify(operation.provisions)
  operation.retries = JSON.stringify(operation.retries)
  operation.args = JSON.stringify(operation.args)
  operationsCollection.save(operation, callback)


deleteOperation = (deviceId, commandKey, callback) ->
  operationsCollection.remove({_id: "#{deviceId}:#{commandKey}"}, callback)


getPresets = (callback) ->
  presetsCollection.find().toArray(callback)


getObjects = (callback) ->
  objectsCollection.find().toArray(callback)


getProvisions = (callback) ->
  provisionsCollection.find().toArray(callback)


getVirtualParameters = (callback) ->
  virtualParametersCollection.find().toArray(callback)


getFiles = (callback) ->
  filesCollection.find().toArray(callback)


exports.connect = connect
exports.disconnect = disconnect
exports.fetchDevice = fetchDevice
exports.saveDevice = saveDevice
exports.getFaults = getFaults
exports.saveFault = saveFault
exports.deleteFault = deleteFault
exports.clearTasks = clearTasks
exports.saveOperation = saveOperation
exports.deleteOperation = deleteOperation
exports.getPresets = getPresets
exports.getObjects = getObjects
exports.getProvisions = getProvisions
exports.getVirtualParameters = getVirtualParameters
exports.getFiles = getFiles
exports.getDueTasks = getDueTasks
exports.getOperations = getOperations
