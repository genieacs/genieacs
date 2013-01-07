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
        params[c.name] = 1

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
        if c.value != getDeviceParamFromPath(device, "#{c.name}._value")
          discrepency[c.name] = c.value

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
      if not maxWeights[c.name]? or p.weight > maxWeights[c.name]
        configurations[c.name] = c
        maxWeights[c.name] = p.weight

  configurationsList = (configurations[c] for c of configurations)
  return configurationsList


getDeviceParamFromPath = (device, paramPath) ->
  path = paramPath.split('.')
  ref = device
  for p in path
    ref = ref[p]
  return ref