config = require './config'
util = require 'util'
http = require 'http'
url = require 'url'
db = require './db'
mongodb = require 'mongodb'
querystring = require 'querystring'
query = require './query'

# regular expression objects
DEVICE_TASKS_REGEX = /^\/devices\/([a-zA-Z0-9\-\_\%]+)\/tasks\/?$/
TASKS_REGEX = /^\/tasks\/([a-zA-Z0-9\-\_\%]+)(\/[a-zA-Z_]*)?$/
TAGS_REGEX = /^\/devices\/([a-zA-Z0-9\-\_\%]+)\/tags\/([a-zA-Z0-9\-\_\%]+)\/?$/
PRESETS_REGEX = /^\/presets\/([a-zA-Z0-9\-\_\%]+)\/?$/
FILES_REGEX = /^\/files\/([a-zA-Z0-9\-\_\%\ \.\/\(\)]+)\/?$/
PING_REGEX = /^\/ping\/([a-zA-Z0-9\-\_\.]+)\/?$/
QUERY_REGEX = /^\/([a-zA-Z0-9_]+s)\/?$/

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


sanitizeTask = (device, task) ->
  task.device = device
  task.timestamp = mongodb.Timestamp()
  return task

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
        presetName = querystring.unescape(PRESETS_REGEX.exec(urlParts.pathname)[1])
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
        deviceId = querystring.unescape(r[1])
        tag = querystring.unescape(r[2])
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
      else if DEVICE_TASKS_REGEX.test(urlParts.pathname)
        if request.method == 'POST'
          deviceId = querystring.unescape(DEVICE_TASKS_REGEX.exec(urlParts.pathname)[1])
          if body
            # queue given task
            task = sanitizeTask(deviceId, JSON.parse(body))

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
          response.writeHead 405, {'Allow': 'POST'}
          response.end('405 Method Not Allowed')
      else if TASKS_REGEX.test(urlParts.pathname)
        r = TASKS_REGEX.exec(urlParts.pathname)
        taskId = mongodb.ObjectID(querystring.unescape(r[1]))
        action = try querystring.unescape(r[2])
        if not action? or action is '/'
          if request.method == 'DELETE'
            db.tasksCollection.remove({'_id' : taskId}, (err, removedCount) ->
              if err
                response.writeHead(500)
                response.end(err)
                return
              response.writeHead(200)
              response.end()
            )
          else
            response.writeHead 405, {'Allow': 'PUT DELETE'}
            response.end('405 Method Not Allowed')
        else if action is '/retry'
          if request.method == 'POST'
            db.tasksCollection.update({_id : taskId}, {$unset : {fault : 1}}, (err, count) ->
              response.writeHead(200)
              response.end()
            )
          else
            response.writeHead 405, {'Allow': 'POST'}
            response.end('405 Method Not Allowed')
        else
          response.writeHead(404)
          response.end()
      else if FILES_REGEX.test(urlParts.pathname)
        filename = querystring.unescape(FILES_REGEX.exec(urlParts.pathname)[1])
        if request.method == 'PUT'
          metadata = {
            SoftwareVersion : request.headers.softwareversion,
            HardwareVersion : request.headers.hardwareversion,
            Manufacturer : request.headers.manufacturer,
          }

          gs = new mongodb.GridStore(db.mongo.db, filename, 'w', {metadata : metadata})
          gs.open((err, gs) ->
            gs.write(request.getBody('binary'), (err, res) ->
              gs.close((err) ->
              )
              response.writeHead(201)
              response.end()
            )
          )
        else if request.method == 'DELETE'
          mongodb.GridStore.unlink(db.mongo.db, filename, (err) ->
            response.writeHead(200)
            response.end()
          )
        else
          response.writeHead 405, {'Allow': 'PUT, DELETE'}
          response.end('405 Method Not Allowed')
      else if PING_REGEX.test(urlParts.pathname)
        host = querystring.unescape(PING_REGEX.exec(urlParts.pathname)[1])
        require('child_process').exec("ping -w 1 -i 0.2 -c 3 #{host}", (err, stdout, stderr) ->
          if err?
            response.writeHead(404, {'Cache-Control' : 'no-cache'})
            response.end()
            return
          response.writeHead(200, {'Content-Type' : 'text/plain', 'Cache-Control' : 'no-cache'})
          response.end(stdout)
        )
      else if QUERY_REGEX.test(urlParts.pathname)
        collectionName = QUERY_REGEX.exec(urlParts.pathname)[1]
        if request.method isnt 'GET'
          response.writeHead 405, {'Allow' : 'GET'}
          response.end('405 Method Not Allowed')
          return
        collection = db["#{collectionName}Collection"]
        if not collection?
          response.writeHead 404
          response.end('404 Not Found')
          return

        if urlParts.query.query?
          q = JSON.parse(querystring.unescape(urlParts.query.query))
        else
          q = {}
        q = query.expand(q) if collectionName is 'devices'
        cur = collection.find(q, {}, {batchSize : 50})
        
        cur.skip(parseInt(urlParts.query.skip)) if urlParts.query.skip?
        cur.limit(parseInt(urlParts.query.limit)) if urlParts.query.limit?

        response.writeHead(200, {'Content-Type' : 'application/json'})
        response.write("[\n")
        cur.each((err, item) ->
          if item is null
            response.end(']')
          else
            response.write(JSON.stringify(item) + ",\n")
        )
        return
      else
        response.writeHead 404
        response.end('404 Not Found')

  server.listen config.API_PORT, config.API_INTERFACE
