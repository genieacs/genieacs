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


getProfilesVaraibles = (profiles) ->
  vars = []
  for p in profiles
    for c in p.configurations
      vars.push(c[0])
  return vars


exports.findDeviceConfigurationDiscrepancy = (deviceId, profilesHash, callback) ->
  getProfiles((profiles) ->
    params = {'_tags' : 1}
    for p of profiles
      profile = profiles[p]
      for c in profile.configurations
        switch c.type
          when 'value'
            params[c.param] = 1
          else
            throw 'Unknown configuration type'

    db.devicesCollection.findOne({'_id' : deviceId}, params, (err, device) ->
      tags = device['_tags'] or []
      tags.push('default')

      deviceProfiles = []
      for t in tags
        if profiles[t]?
          deviceProfiles.push(profiles[t])

      combinedConfigurations = combineProfileConfigurations(deviceProfiles)

      discrepency = {}
      for c in combinedConfigurations
        switch c.type
          when 'value'
            if c.value != getDeviceParamFromPath(device, "#{c.param}._value")
              discrepency[c.param] = c.value
          else
            throw 'Unknown configuration type'
      if not profilesHash
        profilesHash = calculateProfilesHash(profiles)
        db.memcached.set('profiles_hash', profilesHash, config.PROFILES_CACHE_DURATION, (err, res) ->
        )

      db.memcached.set("#{deviceId}_profiles_hash", profilesHash, config.PROFILES_CACHE_DURATION, (err, res) ->
        callback(discrepency)
      )
    )
  )


combineProfileConfigurations = (profiles) ->
  maxWeights = {}
  configurations = {}
  for p in profiles
    for c in p.configurations
      type = c.type
      switch type
        when 'value'
          paramName = c.param
          if not maxWeights["#{type}_#{paramName}"]? or p.weight > maxWeights["#{type}_#{paramName}"]
            configurations["#{type}_#{paramName}"] = c
            maxWeights["#{type}_#{paramName}"] = p.weight
        else
          throw 'Unknown configuration type'

  configurationsList = (configurations[c] for c of configurations)
  return configurationsList


getDeviceParamFromPath = (device, paramPath) ->
  path = paramPath.split('.')
  ref = device
  for p in path
    ref = ref[p]
  return ref