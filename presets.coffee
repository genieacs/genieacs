config = require './config'
common = require './common'
db = require './db'
mongoQuery = require './mongo-query'
query = require './query'
log = require('util').log


getPresets = (callback) ->
  db.memcached.get('presets', (err, res) ->
    if res
      callback(res)
      return

    db.presetsCollection.find().toArray((err, presets) ->
      throw new Error(err) if err

      db.memcached.set('presets', presets, config.PRESETS_CACHE_DURATION)
      callback(presets)
    )
  )


getPresetsHash = (callback) ->
  db.memcached('presets_hash', (err, res) ->
    if res
      callback(res)
    else
      getPresets((presets) ->
        hash = callback(calculatePresetsHash(presets))
        db.memcached.set('presets_hash', hash, config.PRESETS_CACHE_DURATION, (err, res) ->
          callback(hash)
        )
      )
  )


calculatePresetsHash = (presets) ->
  crypto = require('crypto')
  hash = crypto.createHash('md5').update(JSON.stringify(presets)).digest('hex')
  return hash


exports.assertPresets = (deviceId, presetsHash, callback) ->
  getPresets((presets) ->
    # only fetch relevant params
    projection = {}
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

    db.devicesCollection.findOne({'_id' : deviceId}, projection, (err, device) ->
      devicePresets = []
      for p in presets
        if mongoQuery.test(device, p.precondition)
          devicePresets.push(p)

      configurations = accumulateConfigurations(devicePresets)
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
              getParameterValues.push(c.name)
            else
              expiry = Math.min(expiry, c.age - timeDiff)
          when 'add_tag'
            add_tags.push(c.tag) if not device['_tags']? or c.tag not in device['_tags']
          when 'delete_tag'
            delete_tags.push(c.tag) if device['_tags']? and c.tag in device['_tags']
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
        presetsHash = calculatePresetsHash(presets)
        db.memcached.set('presets_hash', presetsHash, expiry - config.PRESETS_TIME_PADDING, (err, res) ->
        )

      db.memcached.set("#{deviceId}_presets_hash", presetsHash, expiry - config.PRESETS_TIME_PADDING, (err, res) ->
        callback(taskList)
      )
    )
  )


accumulateConfigurations = (presets) ->
  maxWeights = {}
  configurations = {}
  for p in presets
    for c in p.configurations
      configurationHash = switch c.type
        when 'add_tag', 'delete_tag'
          "tag_#{c.tag}"
        when 'add_object', 'delete_object'
          "object_#{c.object}_#{c.object}"
        when 'firmware'
          'firmware'
        else
          "#{c.type}_#{c.name}"

      if not maxWeights[configurationHash]? or p.weight > maxWeights[configurationHash]
        configurations[configurationHash] = c
        maxWeights[configurationHash] = p.weight

  configurationsList = (configurations[c] for c of configurations)
  return configurationsList
