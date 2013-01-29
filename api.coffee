config = require './config'
util = require 'util'
http = require 'http'
url = require 'url'
db = require './db'
mongodb = require 'mongodb'

# regular expression objects
TASKS_REGEX = /^\/devices\/([a-zA-Z0-9\-\_\%]+)\/tasks\/?$/
TAGS_REGEX = /^\/devices\/([a-zA-Z0-9\-\_\%]+)\/tags\/([a-zA-Z0-9\-\_\%]+)\/?$/
PRESETS_REGEX = /^\/presets\/([a-zA-Z0-9\-\_\%]+)\/?$/

connectionRequest = (deviceId, callback) ->
  db.devicesCollection.findOne({_id : deviceId}, {'InternetGatewayDevice.ManagementServer.ConnectionRequestURL._value' : 1}, (err, device)->
    if err
      callback(err)
      return
    connectionRequestUrl = device.InternetGatewayDevice.ManagementServer.ConnectionRequestURL._value
    # for testing
    #connectionRequestUrl = connectionRequestUrl.replace(/^(http:\/\/)([0-9\.]+)(\:[0-9]+\/[a-zA-Z0-9]+\/?$)/, '$1192.168.1.1$3')
    request = http.request(connectionRequestUrl, (res) ->
      res.setEncoding('utf8')
      res.on('end', () ->
        callback()
      )
    )

    request.on('error', (err) ->
      # error event when request is aborted
      request.abort()
      callback(err)
    )

    request.on('socket', (socket) ->
      socket.setTimeout(2000)
      socket.on('timeout', () ->
        request.abort()
      )
    )
    request.end()
  )

watchTask = (taskId, timeout, callback) ->
  setTimeout( () ->
    db.tasksCollection.findOne({_id : taskId}, {'_id' : 1}, (err, task) ->
      if task
        timeout -= 500
        if timeout < 0
          callback('timeout')
        else
          watchTask(taskId, timeout, callback)
      else
        callback(err)
    )
  , 500)


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
  server = http.createServer (request, response) ->
    chunks = []
    bytes = 0

    request.addListener 'data', (chunk) ->
      chunks.push(chunk)
      bytes += chunk.length

    request.getBody = (encoding) ->
      # Write all chunks into a Buffer
      body = new Buffer(bytes)
      offset = 0
      chunks.forEach((chunk) ->
        chunk.copy(body, offset, 0, chunk.length)
        offset += chunk.length
      )

      # Return encoded (default to UTF8) string
      return body.toString(encoding || 'utf8', 0, body.byteLength)

    request.addListener 'end', () ->
      body = request.getBody()
      urlParts = url.parse(request.url, true)
      if PRESETS_REGEX.test(urlParts.pathname)
        presetName = PRESETS_REGEX.exec(urlParts.pathname)[1]
        if request.method == 'PUT'
          preset = JSON.parse(body)
          preset._id = presetName

          db.presetsCollection.save(preset, (err) ->
            db.memcached.del('presets_hash', (err, res) ->
            )
            if err
              response.writeHead(500)
              response.end(err)
              return
            response.writeHead(200)
            response.end()
          )
        else if request.method == 'DELETE'
          db.presetsCollection.remove({'_id' : presetName}, (err, removedCount) ->
            db.memcached.del('presets_hash', (err, res) ->
            )
            if err
              response.writeHead(500)
              response.end(err)
              return
            response.writeHead(200)
            response.end()
          )
        else
          response.writeHead 405, {'Allow': 'PUT, DELETE'}
          response.end('405 Method Not Allowed')
      else if TAGS_REGEX.test(urlParts.pathname)
        r = TAGS_REGEX.exec(urlParts.pathname)
        deviceId = r[1]
        tag = r[2]
        if request.method == 'POST'
          db.devicesCollection.update({'_id' : deviceId}, {'$addToSet' : {'_tags' : tag}}, {safe: true}, (err) ->
            if err
              response.writeHead(500)
              response.end(err)
              return
            response.writeHead(200)
            response.end()
          )
        else if request.method == 'DELETE'
          db.devicesCollection.update({'_id' : deviceId}, {'$pull' : {'_tags' : tag}}, {safe: true}, (err) ->
            if err
              response.writeHead(500)
              response.end(err)
              return
            response.writeHead(200)
            response.end()
          )
        else
          response.writeHead 405, {'Allow': 'POST, DELETE'}
          response.end('405 Method Not Allowed')
      else if TASKS_REGEX.test(urlParts.pathname)
        if request.method == 'POST'
          deviceId = TASKS_REGEX.exec(urlParts.pathname)[1]
          if body
            # queue given task
            task = JSON.parse(body)
            task.device = deviceId
            task.timestamp = mongodb.Timestamp()

            db.tasksCollection.save(task, (err) ->
              if err
                response.writeHead(500)
                response.end(err)
                return

              watch = () ->
                if urlParts.query.timeout?
                  timeout = parseInt(urlParts.query.timeout)
                  watchTask(task._id, timeout, (err) ->
                    if err
                      response.writeHead(202)
                      response.end()
                      return
                    response.writeHead(200)
                    response.end()
                  )
                else
                  response.writeHead(202)
                  response.end()

              if urlParts.query.connection_request?
                connectionRequest(deviceId, (err) ->
                  if err
                    response.writeHead(202)
                    response.end()
                  else
                    watch()
                )
              else
                watch()
            )
          else if urlParts.query.connection_request?
            # no task, send connection request only
            connectionRequest(deviceId, (err) ->
              if err
                response.writeHead 504
                response.end()
                return
              response.writeHead 200
              response.end()
            )
          else
            response.writeHead(400)
            response.end()
        else
          response.writeHead 405, {'Allow': 'GET'}
          response.end('405 Method Not Allowed')
      else
        response.writeHead 404
        response.end('404 Not Found')

  server.listen config.API_PORT, config.API_INTERFACE
