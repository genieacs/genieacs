config = require './config'
util = require 'util'
http = require 'http'
url = require 'url'
mongodb = require 'mongodb'

dbserver = new mongodb.Server(config.MONGODB_SOCKET, 0, {auto_reconnect: true})
db = new mongodb.Db(config.DATABASE_NAME, dbserver, {native_parser:true, safe:true})

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
      gs = new mongodb.GridStore(db, urlParts.pathname.substring(1), 'r', {})
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
