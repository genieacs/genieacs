config = require './config'
mongodb = require 'mongodb'
Memcached = require 'memcached'
memcached = new Memcached(config.MEMCACHED_SOCKET, {maxExpiration : 86400, retries : 1})

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
  # TODO using getMulti instead of get because of possible bug
  # in node-memcached where it sometimes returns incorrect values
  # when under heavy load. getMulti works fine.
  tid = String(taskId)
  memcached.getMulti([tid], (err, data) ->
    task = data[tid]
    if not task?
      tasksCollection.findOne({_id : mongodb.ObjectID(tid)}, (err, task) ->
        # TODO use err parameter in callback
        throw new Error(err) if err?
        callback(task)
      )
    else
      callback(task)
  )


updateTask = (task, callback) ->
  id = String(task._id)

  memcached.set(id, task, config.CACHE_DURATION, (err, res) ->
    if res
      callback()
    else
      task._id = mongodb.ObjectID(id)
      tasksCollection.save(task, (err) ->
        callback(err)
      )
  )


saveTask = (task, callback) ->
  # task ID can either be a string or a MongoDB ID
  id = String(task._id)
  task._id = mongodb.ObjectID(id)
  tasksCollection.save(task, (mongoErr) ->
    memcached.del(id, (memcachedErr, res) ->
      callback(mongoErr or memcachedErr)
    )
  )


getPresets = (callback) ->
  memcached.get(['presets', 'objects'], (err, res) ->
    presets = res.presets
    objects = res.objects
    if presets and objects
      callback(presets, objects)
      return

    presetsCollection.find().toArray((err, p) ->
      throw err if err
      presets = p

      memcached.set('presets', presets, config.PRESETS_CACHE_DURATION)
      callback(presets, objects) if objects
    )

    objectsCollection.find().toArray((err, o) ->
      throw err if err
      objects = {}
      for i in o
        objects[i._id] = i

      memcached.set('objects', objects, config.PRESETS_CACHE_DURATION)
      callback(presets, objects) if presets
    )
  )


exports.memcached = memcached
exports.getTask = getTask
exports.updateTask = updateTask
exports.saveTask = saveTask
exports.getPresets = getPresets
