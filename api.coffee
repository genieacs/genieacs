config = require './config'
util = require 'util'
http = require 'http'
mongo = require 'mongodb'
url  = require 'url'

# regular expression objects
DEVICES_REGEX = /^\/devices\/?$/
DEVICE_REGEX = /^\/devices\/([a-zA-Z0-9\-\_]+)\/?$/

# Create MongoDB connections
dbserver = new mongo.Server(config.MONGODB_SOCKET, 0, {auto_reconnect: true, safe: true})
tasksCollection = null
devicesCollection = null
db = new mongo.Db(config.DATABASE_NAME, dbserver, {native_parser:true})
db.open( (err, db) ->
  db.collection('tasks', (err, collection) ->
    tasksCollection = collection
    tasksCollection.ensureIndex({device: 1, timestamp: 1})
  )

  db.collection('devices', (err, collection) ->
    devicesCollection = collection
  )
)

cluster = require 'cluster'
numCPUs = require('os').cpus().length

if cluster.isMaster
  for i in [1 .. numCPUs]
    cluster.fork()
  cluster.on('exit', (worker, code, signal) ->
    console.log('worker ' + worker.process.pid + ' died')
  )
else
  server = http.createServer (request, response) ->
    if request.method != 'GET'
      console.log '>>> 405 Method Not Allowed'
      response.writeHead 405, {'Allow': 'GET'}
      response.end('405 Method Not Allowed')
      return

    request.content = ''

    request.addListener 'data', (chunk) ->
      request.content += chunk

    request.addListener 'end', () ->
      urlParts = url.parse(request.url, true)
      if DEVICES_REGEX.test(urlParts.pathname)
        # TODO search for devices
      else if DEVICE_REGEX.test(urlParts.pathname)
        id = DEVICE_REGEX.exec(urlParts.pathname)[1]
        devicesCollection.findOne({_id : id}, (err, device)->
          if err
            console.log("Error: " + err)
            response.writeHead 500
            response.end(err)
            return

          if device is null
            response.writeHead 404
            response.end()
            return

          response.end(JSON.stringify(device))
          return
        )
        return

      console.log '>>> 404 Not Found'
      response.writeHead 404
      response.end('404 Not Found')

  server.listen config.API_PORT
  console.log "Server listening on port #{config.API_PORT}"
