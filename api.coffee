config = require './config'
util = require 'util'
http = require 'http'
mongo = require 'mongodb'
url  = require 'url'
Timestamp = require('mongodb').Timestamp


# regular expression objects
DEVICES_REGEX = /^\/devices\/?$/
DEVICE_REGEX = /^\/devices\/([a-zA-Z0-9\-\_]+)\/?$/
TASKS_REGEX = /^\/devices\/([a-zA-Z0-9\-\_]+)\/tasks\/?$/

connectionRequest = (deviceId, callback) ->
  devicesCollection.findOne({_id : deviceId}, {'InternetGatewayDevice.ManagementServer.ConnectionRequestURL._value' : 1}, (err, device)->
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
    tasksCollection.findOne({_id : taskId}, {'_id' : 1}, (err, task) ->
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
    request.content = ''

    request.addListener 'data', (chunk) ->
      request.content += chunk

    request.addListener 'end', () ->
      urlParts = url.parse(request.url, true)
      if DEVICES_REGEX.test(urlParts.pathname)
        if request.method == 'POST'
          req = JSON.parse(request.content)
          query = devicesCollection.find(req.query)
          query.sort(req.sort) if req.sort?
          query.skip(req.skip) if req.skip?
          query.limit(if req.limit? req.limit else 100)

          query.toArray((err, devices) ->
            # TODO handle error
            response.writeHead 200
            response.end(JSON.stringify(devices))
          )
        else
          response.writeHead 405, {'Allow': 'POST'}
          response.end('405 Method Not Allowed')
      else if DEVICE_REGEX.test(urlParts.pathname)
        if request.method != 'GET'
          response.writeHead 405, {'Allow': 'GET'}
          response.end('405 Method Not Allowed')
          return

        deviceId = DEVICE_REGEX.exec(urlParts.pathname)[1]
        devicesCollection.findOne({_id : deviceId}, (err, device) ->
          if err
            console.log("Error: " + err)
            response.writeHead 500
            response.end(err)
          else if device is null
            response.writeHead 404
            response.end()
          else
            response.writeHead(200)
            response.end(JSON.stringify(device))
        )
      else if TASKS_REGEX.test(urlParts.pathname)
        if request.method == 'GET'
          deviceId = TASKS_REGEX.exec(urlParts.pathname)[1]
          query = tasksCollection.find({'device' : deviceId}).sort(['timestamp'])

          query.toArray((err, tasks) ->
            response.writeHead 200
            response.end(JSON.stringify(tasks))
          )
        else if request.method == 'POST'
          deviceId = TASKS_REGEX.exec(urlParts.pathname)[1]
          if request.content
            # queue given task
            task = JSON.parse(request.content)
            task.device = deviceId
            task.timestamp = Timestamp()

            tasksCollection.save(task, (err) ->
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
  console.log "Server listening on port #{config.API_PORT}"
