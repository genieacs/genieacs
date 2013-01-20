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

dbserver = new mongodb.Server(config.MONGODB_SOCKET, 0, {auto_reconnect: true})
db = new mongodb.Db(config.DATABASE_NAME, dbserver, {native_parser:true, safe:true})

db.open( (err, db) ->
  db.collection('tasks', (err, collection) ->
    exports.tasksCollection = tasksCollection = collection
    collection.ensureIndex({device: 1, timestamp: 1}, (err) ->
    )
  )

  db.collection('devices', (err, collection) ->
    exports.devicesCollection  = devicesCollection = collection
  )

  db.collection('presets', (err, collection) ->
    exports.presetsCollection = presetsCollection = collection
  )
)


getTask = (taskId, callback) ->
  memcached.get(taskId, (err, task) ->
    if not task?
      tasksCollection.findOne({_id : mongodb.ObjectID(String(taskId))}, (err, task) ->
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


exports.memcached = memcached
exports.getTask = getTask
exports.updateTask = updateTask
