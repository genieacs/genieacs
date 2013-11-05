config = require './config'
mongodb = require 'mongodb'
redisClient = require('redis').createClient(config.REDIS_SOCKET)

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


getPresets = (callback) ->
  redisClient.mget('presets', 'objects', (err, res) ->
    presets = JSON.parse(res[0])
    objects = JSON.parse(res[1])
    if presets and objects
      callback(presets, objects)
      return

    if not presets
      presetsCollection.find().toArray((err, p) ->
        throw err if err
        presets = p

        redisClient.setex('presets', config.PRESETS_CACHE_DURATION, JSON.stringify(presets))
        callback(presets, objects) if objects
      )

    if not objects
      objectsCollection.find().toArray((err, o) ->
        throw err if err
        objects = {}
        for i in o
          objects[i._id] = i

        redisClient.setex('objects', config.PRESETS_CACHE_DURATION, JSON.stringify(objects))
        callback(presets, objects) if presets
      )
  )


exports.redisClient = redisClient
exports.getTask = getTask
exports.getPresets = getPresets
