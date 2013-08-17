config = require './config'
common = require './common'
db = require './db'
mongoQuery = require './mongo-query'
query = require './query'
log = require('util').log


getPresets = (callback) ->
  db.memcached.get(['presets', 'objects'], (err, res) ->
    presets = res.presets
    objects = res.objects
    if presets and objects
      callback(presets, objects)
      return

    db.presetsCollection.find().toArray((err, p) ->
      throw new Error(err) if err
      presets = p

      db.memcached.set('presets', presets, config.PRESETS_CACHE_DURATION)
      callback(presets, objects) if objects
    )

    db.objectsCollection.find().toArray((err, o) ->
      throw new Error(err) if err
      objects = {}
      for i in o
        objects[i._id] = i

      db.memcached.set('objects', objects, config.PRESETS_CACHE_DURATION)
      callback(presets, objects) if presets
    )
  )


getPresetsHash = (callback) ->
  db.memcached('presets_hash', (err, res) ->
    if res
      callback(res)
    else
      getPresets((presets, objects) ->
        hash = calculatePresetsHash(presets, objects)
        db.memcached.set('presets_hash', hash, config.PRESETS_CACHE_DURATION, (err, res) ->
          callback(hash)
        )
      )
  )


calculatePresetsHash = (presets, objects) ->
  crypto = require('crypto')
  hash = crypto.createHash('md5').update(JSON.stringify(presets) + JSON.stringify(objects)).digest('hex')
  return hash


matchObject = (object, param) ->
  return false if not object._keys? or object._keys.length == 0
  for k in object._keys
    v = common.matchType(param[k]._value, object[k])
    if param[k]._value != v
      return false
  return true


exports.assertPresets = (deviceId, presetsHash, callback) ->
  getPresets((presets, objects) ->
    # only fetch relevant params
    projection = {_id : 1}
    for p in presets
      p.precondition = query.expand(p.precondition)
      mongoQuery.projection(p.precondition, projection)

      for c in p.configurations
        switch c.type
          when 'value', 'age'
            projection[c.name] = 1
          when 'firmware'
            projection['InternetGatewayDevice.DeviceInfo.SoftwareVersion'] = 1
          when 'add_tag', 'delete_tag'
            projection['_tags'] = 1
          when 'add_object', 'delete_object'
            projection[c.name] = 1
          else
            throw new Error('Unknown configuration type')

    mongoQuery.optimizeProjection(projection)
    db.devicesCollection.findOne({'_id' : deviceId}, projection, (err, device) ->
      devicePresets = []
      for p in presets
        if mongoQuery.test(device, p.precondition)
          devicePresets.push(p)

      configurations = accumulateConfigurations(devicePresets, objects)
      now = Date.now()
      taskList = []
      expiry = config.PRESETS_CACHE_DURATION
      getParameterValues = []
      setParameterValues = []
      add_tags = []
      delete_tags = []
      for c in configurations
        param = if c.name? then common.getParamValueFromPath(device, c.name) else undefined

        switch c.type
          when 'value'
            continue if not param? # ignore parameters that don't exist
            dst = common.matchType(param._value, c.value)
            if param._value != dst
              setParameterValues.push([c.name, dst, param._type])
          when 'age'
            continue if not param? # ignore parameters that don't exist
            timeDiff = (now - param._timestamp) / 1000
            if (c.age - timeDiff < config.PRESETS_TIME_PADDING)
              expiry = Math.min(expiry, c.age)
              if param._object or param._instance
                taskList.push({device : deviceId, name : 'refreshObject', objectName : c.name})
              else
                getParameterValues.push(c.name)
            else
              expiry = Math.min(expiry, c.age - timeDiff)
          when 'add_tag'
            add_tags.push(c.tag) if not device['_tags']? or c.tag not in device['_tags']
          when 'delete_tag'
            delete_tags.push(c.tag) if device['_tags']? and c.tag in device['_tags']
          when 'add_object'
            instances = {}
            for k,p of param
              continue if k[0] == '_'
              if p._name?
                if p._name == c.object
                  instances[k] = p
              else if matchObject(objects[c.object], p)
                u = {}
                u["#{c.name}.#{k}._name"] = c.object
                db.devicesCollection.update({'_id' : deviceId}, {'$set' : u}, {safe : false})
                instances[k] = p

            if Object.keys(instances).length > 0
              for k,i of instances
                for k2,j of objects[c.object]
                  continue if k2[0] == '_'
                  dst = common.matchType(param[k][k2]._value, j)
                  if param[k][k2]._value != dst
                    setParameterValues.push(["#{c.name}.#{k}.#{k2}", dst, param[k][k2]._value])
            else
              vals = []
              for k2,j of objects[c.object]
                vals.push([k2, j]) if k2[0] != '_'
              taskList.push({device : deviceId, name : 'addObject', objectName : c.name, parameterValues : vals, instanceName : c.object})
          when 'delete_object'
            for k,p of param
              continue if k[0] == '_'
              if p._name?
                if p._name == c.object
                  taskList.push({device : deviceId, name : 'deleteObject', objectName : "#{c.name}.#{k}"})
              else if matchObject(objects[c.object], p)
                taskList.push({device : deviceId, name : 'deleteObject', objectName : "#{c.name}.#{k}"})
          else
            throw new Error('Unknown configuration type')

      if add_tags.length + delete_tags.length > 0
        log("#{deviceId}: Updating tags")

      if delete_tags.length > 0
        db.devicesCollection.update({'_id' : deviceId}, {'$pull' : {'_tags' : {'$in' : delete_tags}}}, {safe : false})

      if add_tags.length > 0
        db.devicesCollection.update({'_id' : deviceId}, {'$addToSet' : {'_tags' : {'$each' : add_tags}}}, {safe : false})

      if getParameterValues.length
        taskList.push {device : deviceId, name : 'getParameterValues', parameterNames: getParameterValues, timestamp : new Date()}

      if setParameterValues.length
        taskList.push {device : deviceId, name : 'setParameterValues', parameterValues: setParameterValues, timestamp : new Date()}

      if not presetsHash
        presetsHash = calculatePresetsHash(presets, objects)
        db.memcached.set('presets_hash', presetsHash, config.PRESETS_CACHE_DURATION, (err, res) ->
        )

      db.memcached.set("#{deviceId}_presets_hash", presetsHash, expiry - config.PRESETS_TIME_PADDING, (err, res) ->
        callback(taskList)
      )
    )
  )


getObjectHash = (object) ->
  return object._id if not object._keys? or object._keys.length == 0
  hash = ''
  for k in object._keys
    hash += "#{k}=#{object[k]}"
  return hash

accumulateConfigurations = (presets, objects) ->
  maxWeights = {}
  configurations = {}
  for p in presets
    for c in p.configurations
      configurationHash = switch c.type
        when 'add_tag', 'delete_tag'
          "tag_#{c.tag}"
        when 'add_object', 'delete_object'
          objectHash = getObjectHash(objects[c.object])
          "object_#{c.name}_#{objectHash}"
        when 'firmware'
          'firmware'
        else
          "#{c.type}_#{c.name}"

      if not maxWeights[configurationHash]? or p.weight > maxWeights[configurationHash]
        configurations[configurationHash] = c
        maxWeights[configurationHash] = p.weight

  configurationsList = (configurations[c] for c of configurations)
  return configurationsList
