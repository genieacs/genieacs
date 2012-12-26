config = require './config'
common = require './common'
util = require 'util'
http = require 'http'
mongo = require 'mongodb'
tr069 = require './tr-069'
tasks = require './tasks'
Memcached = require 'memcached'
memcached = new Memcached(config.MEMCACHED_SOCKET)
sanitize = require('./sanitize').sanitize

currentClientIP = null

# Create MongoDB connections
dbserver = new mongo.Server(config.MONGODB_SOCKET, 0, {auto_reconnect: true})
tasksCollection = null
devicesCollection = null
db = new mongo.Db(config.DATABASE_NAME, dbserver, {native_parser:true, safe:true})

db.open( (err, db) ->
  db.collection('tasks', (err, collection) ->
    tasksCollection = collection
    tasksCollection.ensureIndex({device: 1, timestamp: 1}, (err) ->
    )
  )

  db.collection('devices', (err, collection) ->
    devicesCollection = collection
  )
)


writeResponse = (serverResponse, res) ->
  if config.DEBUG
    s = "# RESPONSE #{new Date(Date.now())}\n" + JSON.stringify(res.headers) + "\n#{res.data}\n\n"
    memcached.append("debug-#{currentClientIP}", s, (err, result) ->
    )

  serverResponse.writeHead(res.code, res.headers)
  serverResponse.end(res.data)


updateDevice = (deviceId, actions, callback) ->
  if not actions?
    callback() if callback?
    return

  now = new Date(Date.now())
  updates = {}
  if actions.inform
    updates['_last_inform'] = now

  if actions.parameterValues?
    for p in actions.parameterValues
      v = sanitize(p[0], p[1])
      path = if common.endsWith(p[0], '.') then p[0] else "#{p[0]}."
      if v is undefined
        updates["#{path}_value"] = p[1]
      else
        updates["#{path}_value"] = v
        updates["#{path}_orig"] = p[1]
      updates["#{path}_timestamp"] = now

  if actions.parameterNames?
    for p in actions.parameterNames
      path = if common.endsWith(p[0], '.') then p[0] else "#{p[0]}."
      if common.endsWith(p[0], '.')
        updates["#{path}_object"] = true
      updates["#{path}_writable"] = p[1]
      updates["#{path}_timestamp"] = now

  if Object.keys(updates).length > 0
    devicesCollection.update({'_id' : deviceId}, {'$set' : updates}, {safe: true}, (err, count) ->
      if (err)
        callback(err) if callback?
        return

      if count == 0
        util.log("#{deviceId}: new device detected")
        devicesCollection.update({'_id' : deviceId}, {'$set' : updates}, {upsert: true, safe: true}, (err) ->
          if err?
            callback(err) if callback?
            return
          
          task = {device : deviceId, name : 'init', timestamp : mongo.Timestamp()}
          tasksCollection.save(task, (err) ->
            util.log("#{deviceId}: Added init task #{task._id}")
            callback(err) if callback?
          )
        )
      else
        callback() if callback?
    )
  else
    callback() if callback?


runTask = (sessionId, deviceId, task, reqParams, response) ->
  resParams = {}
  actions = tasks.task(task, reqParams, resParams)
  updateDevice(deviceId, actions)

  if Object.keys(resParams).length > 0
    memcached.set(String(task._id), task, config.CACHE_DURATION, (err, result) ->
      res = tr069.response(sessionId, resParams, {task : String(task._id)})
      writeResponse response, res
    )
    return

  # Task finished
  memcached.del(String(task._id))
  tasksCollection.remove({'_id' : mongo.ObjectID(task._id)}, {safe: true}, (err, removed) ->
    util.log("#{deviceId}: completed task #{task.name}(#{task._id})")
    cookies = {task : null}
    nextTask(sessionId, deviceId, response, cookies)
  )


nextTask = (sessionId, deviceId, response, cookies) ->
  cur = tasksCollection.find({'device' : deviceId}).sort(['timestamp']).limit(1)
  cur.nextObject( (err, task) ->
    reqParams = {}
    resParams = {}
    if not task
      res = tr069.response(sessionId, resParams, cookies)
      writeResponse response, res
      return

    util.log("#{deviceId}: started task #{task.name}(#{task._id})")
    runTask(sessionId, deviceId, task, reqParams, response)
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
  if config.DEBUG
    process.on('uncaughtException', (error) ->
      # dump request/response logs and stack trace
      util.log("Unexpected error occured. Writing log to debug/#{currentClientIP}.log.")
      memcached.get("debug-#{currentClientIP}", (err, l) ->
        util.error(err) if err
        fs = require 'fs'
        fs.writeFileSync("debug/#{currentClientIP}.log", l + "\n\n" + error.stack)
        process.exit(1)
      )
    )

  server = http.createServer (request, response) ->
    if request.method != 'POST'
      #console.log '>>> 405 Method Not Allowed'
      response.writeHead 405, {'Allow': 'POST'}
      response.end('405 Method Not Allowed')
      return

    chunks = []
    bytes = 0
    cookies = {}

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

      #Return encoded (default to UTF8) string
      return body.toString(encoding || 'utf8', 0, body.byteLength)

    request.addListener 'end', () ->
      currentClientIP = request.connection.remoteAddress
      if config.DEBUG
        s = "# REQUEST #{new Date(Date.now())}\n" + JSON.stringify(request.headers) + "\n#{request.getBody()}\n\n"
        memcached.append("debug-#{currentClientIP}", s, (err, result) ->
          if err == 'Item is not stored'
            memcached.set("debug-#{currentClientIP}", s, config.CACHE_DURATION, (err, result) ->
            )
        )

      resParams = {}
      reqParams = tr069.request(request)

      if reqParams.inform
        resParams.inform = true
        cookies.ID = sessionId = reqParams.sessionId
        cookies.DeviceId = deviceId = common.getDeviceId(reqParams.deviceId)
        if config.DEBUG
          util.log("#{deviceId}: inform (#{reqParams.eventCodes}); retry count #{reqParams.retryCount}")

        updateDevice(deviceId, {'inform' : true, 'parameterValues' : reqParams.informParameterValues}, (err) ->
          res = tr069.response(sessionId, resParams, cookies)
          writeResponse response, res
        )
        return

      sessionId = reqParams.cookies.ID
      deviceId = reqParams.cookies.DeviceId
      taskId = reqParams.cookies.task

      if not taskId
        nextTask(sessionId, deviceId, response, cookies)
      else
        memcached.get(taskId, (err, task) ->
          runTask(sessionId, deviceId, task, reqParams, response)
        )

  server.listen config.ACS_PORT, config.ACS_INTERFACE
  #console.log "Server listening on port #{config.ACS_PORT}"
