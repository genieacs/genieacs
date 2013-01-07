config = require './config'
db = require './db'


getProfiles = (callback) ->
  db.memcached.get('profiles', (err, res) ->
    throw err if err

    if res
      callback(res)
      return

    db.profilesCollection.find().toArray((err, res) ->
      if err
        callback(err, res)
        return

      profiles = {}
      for p in res
        profiles[p['_id']] = p

      db.memcached.set('profiles', profiles, config.PROFILES_CACHE_DURATION)
      callback(profiles)
    )
  )


getProfilesHash = (callback) ->
  db.memcached('profiles_hash', (err, res) ->
    if res
      callback(res)
    else
      getProfiles((profiles) ->
        hash = callback(calculateProfilesHash(profiles))
        db.memcached.set('profiles_hash', hash, config.PROFILES_CACHE_DURATION, (err, res) ->
          callback(hash)
        )
      )
  )


calculateProfilesHash = (profiles) ->
  crypto = require('crypto')
  hash = crypto.createHash('md5').update(JSON.stringify(profiles)).digest('hex')
  return hash


exports.findDeviceConfigurationDiscrepancy = (deviceId, profilesHash, callback) ->
  getProfiles((profiles) ->
    params = {'_tags' : 1}
    for p of profiles
      profile = profiles[p]
      for c in profile.configurations
        if c.type == 'get' or c.type == 'set'
          params[c.name] = 1

    db.devicesCollection.findOne({'_id' : deviceId}, params, (err, device) ->
      tags = device['_tags'] or []
      tags.push('default')

      deviceProfiles = []
      for t in tags
        if profiles[t]?
          deviceProfiles.push(profiles[t])

      combinedConfigurations = combineProfileConfigurations(deviceProfiles)
      now = Date.now()
      taskList = []
      expiry = config.PROFILES_CACHE_DURATION
      getParameterValues = []
      setParameterValues = []
      for c in combinedConfigurations
        switch c.type
          when 'set'
            if c.value != getDeviceParamFromPath(device, "#{c.name}._value")
              setParameterValues.push([c.name, c.value])
          when 'get'
            timeDiff = (now - getDeviceParamFromPath(device, "#{c.name}._timestamp")) / 1000
            if (c.age - timeDiff < config.PROFILES_TIME_PADDING)
              expiry = Math.min(expiry, c.age)
              getParameterValues.push(c.name)
            else
              expiry = Math.min(expiry, c.age - timeDiff)
          else
            throw new Error('Unknown configuration type')
      if getParameterValues.length
        taskList.push {device : deviceId, name : 'getParameterValues', parameterNames: getParameterValues, timestamp : db.mongo.Timestamp()}
      if setParameterValues.length
        taskList.push {device : deviceId, name : 'setParameterValues', parameterValues: getParameterValues, timestamp : db.mongo.Timestamp()}

      if not profilesHash
        profilesHash = calculateProfilesHash(profiles)
        db.memcached.set('profiles_hash', profilesHash, expiry - config.PROFILES_TIME_PADDING, (err, res) ->
        )

      db.memcached.set("#{deviceId}_profiles_hash", profilesHash, expiry - config.PROFILES_TIME_PADDING, (err, res) ->
        callback(taskList)
      )
    )
  )


combineProfileConfigurations = (profiles) ->
  maxWeights = {}
  configurations = {}
  for p in profiles
    for c in p.configurations
      configurationHash = if c.name? then "#{c.type}_#{c.name}" else c.type

      if not maxWeights[configurationHash]? or p.weight > maxWeights[configurationHash]
        configurations[configurationHash] = c
        maxWeights[configurationHash] = p.weight

  configurationsList = (configurations[c] for c of configurations)
  return configurationsList


getDeviceParamFromPath = (device, paramPath) ->
  path = paramPath.split('.')
  ref = device
  for p in path
    ref = ref[p]
  return ref