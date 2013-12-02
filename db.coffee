config = require './config'
mongodb = require 'mongodb'
redisClient = require('redis').createClient(config.REDIS_SOCKET)
parameters = require './parameters'

tasksCollection = null
devicesCollection = null
presetsCollection = null
objectsCollection = null

mongodb.MongoClient.connect("mongodb://#{config.MONGODB_SOCKET}/#{config.DATABASE_NAME}", config.MONGODB_OPTIONS, (err, db) ->
  exports.mongoDb = db
  db.collection('tasks', (err, collection) ->
    throw new Error(err) if err?
    exports.tasksCollection = tasksCollection = collection
    collection.ensureIndex({device: 1, timestamp: 1}, (err) ->
    )
  )

  db.collection('devices', (err, collection) ->
    throw new Error(err) if err?
    exports.devicesCollection  = devicesCollection = collection
  )

  db.collection('presets', (err, collection) ->
    throw new Error(err) if err?
    exports.presetsCollection = presetsCollection = collection
  )

  db.collection('objects', (err, collection) ->
    throw new Error(err) if err?
    exports.objectsCollection = objectsCollection = collection
  )

  db.collection('fs.files', (err, collection) ->
    throw new Error(err) if err?
    exports.filesCollection = filesCollection = collection
  )
)


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
  getCached('aliases', parameters.compileAliases, config.PRESETS_CACHE_DURATION, (err, res) ->
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
      , config.PRESETS_CACHE_DURATION, (err, res) ->
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
      , config.PRESETS_CACHE_DURATION, (err, res) ->
        throw err if err
        objects = res
        callback(presets, objects, aliases) if presets and aliases
      )

    if not aliases
      getCached('aliases', parameters.compileAliases, config.PRESETS_CACHE_DURATION, (err, res) ->
        throw err if err
        aliases = res
        callback(presets, objects, aliases) if presets and objects
      )
  )


exports.redisClient = redisClient
exports.getTask = getTask
exports.getPresetsObjectsAliases = getPresetsObjectsAliases
exports.getAliases = getAliases
