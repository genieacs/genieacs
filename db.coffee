config = require './config'
mongo = require 'mongodb'
Memcached = require 'memcached'
Memcached.config.maxExpiration = 86400
memcached = new Memcached(config.MEMCACHED_SOCKET)


dbserver = new mongo.Server(config.MONGODB_SOCKET, 0, {auto_reconnect: true})
db = new mongo.Db(config.DATABASE_NAME, dbserver, {native_parser:true, safe:true})

db.open( (err, db) ->
  db.collection('tasks', (err, collection) ->
    exports.tasksCollection = collection
    collection.ensureIndex({device: 1, timestamp: 1}, (err) ->
    )
  )

  db.collection('devices', (err, collection) ->
    exports.devicesCollection = collection
  )

  db.collection('presets', (err, collection) ->
    exports.presetsCollection = collection
  )
)

exports.mongo = mongo
exports.memcached = memcached
