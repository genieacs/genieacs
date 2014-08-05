###
# Copyright 2013, 2014  Zaid Abdulla
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

redisClient = null
tasksCollection = null
devicesCollection = null
presetsCollection = null
objectsCollection = null


# Only flush redis DB if aliases or custom commands config has changed
flushRedis = (callback) ->
  redisClient.get('config_hash', (err, res) ->
    return callback(err) if err

    hash = require('crypto')
      .createHash('md5')
      .update(JSON.stringify(config.PARAMETERS))
      .update(JSON.stringify(config.CUSTOM_COMMANDS))
      .digest('hex')

    if res == hash
      return callback()

    redisClient.flushdb((err) ->
      return callback(err) if err
      redisClient.set('config_hash', hash, (err, res) ->
        return callback(err)
      )
    )
  )


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
      if err
        callbackCounter = 0
        return callback(err)

      flushRedis((err) ->
        if --callbackCounter == 0 or err
          callbackCounter = 0
          return callback(err)
      )
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


exports.getTask = getTask
exports.getPresetsObjectsAliases = getPresetsObjectsAliases
exports.getAliases = getAliases
exports.connect = connect
exports.disconnect = disconnect
