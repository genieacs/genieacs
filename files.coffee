config = require './config'
util = require 'util'
http = require 'http'
url = require 'url'
mongodb = require 'mongodb'
querystring = require 'querystring'

db = null
mongodb.MongoClient.connect("mongodb://#{config.MONGODB_SOCKET}/#{config.DATABASE_NAME}", config.MONGODB_OPTIONS, (err, _db) ->
  db = _db
)


cluster = require 'cluster'
numCPUs = require('os').cpus().length

if cluster.isMaster
  cluster.on('listening', (worker, address) ->
    util.log("Worker #{worker.process.pid} listening to #{address.address}:#{address.port}")
  )

  cluster.on('exit', (worker, code, signal) ->
    util.log("Worker #{worker.process.pid} died (#{worker.process.exitCode})")
    setTimeout(()->
      cluster.fork()
    , config.WORKER_RESPAWN_TIME)
  )

  for i in [1 .. numCPUs]
    cluster.fork()
else
  server = http.createServer((request, response) ->
    urlParts = url.parse(request.url, true)
    if request.method == 'GET'
      filename = querystring.unescape(urlParts.pathname.substring(1))
      gs = new mongodb.GridStore(db, filename, 'r', {})
      gs.open((err, gs) ->
        if err
          response.writeHead(404)
          response.end()
          return
        stream = gs.stream(true)
        response.writeHead(200, {'Content-Type' : 'application/octet-stream', 'Content-Length' : gs.length})
        stream.pipe(response)
      )
    else
      response.writeHead(405, {'Allow': 'GET'})
      response.end('405 Method Not Allowed')
  )

  server.listen config.FILES_PORT, config.FILES_INTERFACE
