config = require './config'
mongo = require 'mongodb'
Memcached = require 'memcached'
Memcached.config.maxExpiration = 86400
memcached = new Memcached(config.MEMCACHED_SOCKET)

# Create MongoDB connections
tasksCollection = null
devicesCollection = null
profilesCollection = null

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

  db.collection('profiles', (err, collection) ->
    exports.profilesCollection = collection
  )
)

exports.mongo = mongo
exports.memcached = memcached
