config = require './config'
mongodb = require 'mongodb'
Memcached = require 'memcached'
Memcached.config.maxExpiration = 86400
Memcached.config.timeout = 1000
Memcached.config.retries = 0
Memcached.config.reconnect = 1000
memcached = new Memcached(config.MEMCACHED_SOCKET)

tasksCollection = null
devicesCollection = null
presetsCollection = null
objectsCollection = null

options = {
  db : {
    w : 1
    wtimeout : 60000
  }
  server : {
    auto_reconnect : true
  }
}

mongodb.MongoClient.connect("mongodb://#{config.MONGODB_SOCKET}/#{config.DATABASE_NAME}", options, (err, db) ->
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
  task._id = mongodb.ObjectID(String(task._id))
  tasksCollection.save(task, (err) ->
    callback(err)
  )


exports.memcached = memcached
exports.getTask = getTask
exports.updateTask = updateTask
exports.saveTask = saveTask
