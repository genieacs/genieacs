config = require './config'
common = require './common'
util = require 'util'
http = require 'http'
tr069 = require './tr-069'
tasks = require './tasks'
sanitize = require('./sanitize').sanitize
db = require './db'
presets = require './presets'


currentRequest = null


applyConfigurations = (taskList) ->
  if taskList.length
    util.log("#{currentRequest.deviceId}: Presets discrepancy found")
    db.tasksCollection.save(taskList, (err) ->
      for task in taskList
        util.log("#{currentRequest.deviceId}: Added #{task.name} task #{task._id}")
      task = taskList[0]
      util.log("#{currentRequest.deviceId}: started task #{task.name}(#{task._id})")
      runTask(task, {})
    )
  else
    res = tr069.response(currentRequest.sessionId, {}, {})
    writeResponse res


writeResponse = (res) ->
  if config.DEBUG
    s = "# RESPONSE #{new Date(Date.now())}\n" + JSON.stringify(res.headers) + "\n#{res.data}\n\n"
    db.memcached.append("debug-#{currentRequest.clientIp}", s, (err, result) ->
    )

  currentRequest.response.writeHead(res.code, res.headers)
  currentRequest.response.end(res.data)


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
    db.devicesCollection.update({'_id' : currentRequest.deviceId}, {'$set' : updates}, {safe: true}, (err, count) ->
      if (err)
        callback(err) if callback?
        return

      if count == 0
        util.log("#{currentRequest.deviceId}: new device detected")
        db.devicesCollection.update({'_id' : currentRequest.deviceId}, {'$set' : updates}, {upsert: true, safe: true}, (err) ->
          if err?
            callback(err) if callback?
            return
          
          task = {device : currentRequest.deviceId, name : 'init', timestamp : db.mongo.Timestamp()}
          db.tasksCollection.save(task, (err) ->
            util.log("#{currentRequest.deviceId}: Added init task #{task._id}")
            callback(err) if callback?
          )
        )
      else
        callback() if callback?
    )
  else
    callback() if callback?


runTask = (task, reqParams) ->
  resParams = {}
  actions = tasks.task(task, reqParams, resParams)
  updateDevice(currentRequest.deviceId, actions)

  if Object.keys(resParams).length > 0
    db.updateTask(task, (err) ->
      res = tr069.response(currentRequest.sessionId, resParams, {task : String(task._id)})
      writeResponse res
    )
    return

  # Task finished
  db.memcached.del(String(task._id))
  db.tasksCollection.remove({'_id' : db.mongo.ObjectID(String(task._id))}, {safe: true}, (err, removed) ->
    util.log("#{currentRequest.deviceId}: completed task #{task.name}(#{task._id})")
    cookies = {task : null}
    nextTask(cookies)
  )


nextTask = (cookies) ->
  cur = db.tasksCollection.find({'device' : currentRequest.deviceId}).sort(['timestamp']).limit(1)
  cur.nextObject( (err, task) ->
    reqParams = {}
    resParams = {}

    if not task
      # no more taks, check presets discrepancy
      db.memcached.get(["#{currentRequest.deviceId}_presets_hash", 'presets_hash'], (err, results) ->
        presetsHash = results['presets_hash']
        devicePresetsHash = results["#{currentRequest.deviceId}_presets_hash"]

        if not devicePresetsHash or presetsHash != devicePresetsHash
          presets.assertPresets(currentRequest.deviceId, presetsHash, (taskList) ->
            applyConfigurations(taskList)
          )
        else if not presetsHash
          presets.getPresetsHash((hash) ->
            if hash != devicePresetsHash
              presets.assertPresets(currentRequest.deviceId, presetsHash, (taskList) ->
                applyConfigurations(taskList)
              )
            else
              # no discrepancy, return empty response
              res = tr069.response(currentRequest.sessionId, resParams, cookies)
              writeResponse res
          )
        else
          # no discrepancy, return empty response
          res = tr069.response(currentRequest.sessionId, resParams, cookies)
          writeResponse res
      )
      return

    util.log("#{currentRequest.deviceId}: started task #{task.name}(#{task._id})")
    runTask(task, reqParams)
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
      util.error(error.stack)
      # dump request/response logs and stack trace
      db.memcached.get("debug-#{currentRequest.clientIp}", (err, l) ->
        util.log("Unexpected error occured. Writing log to debug/#{currentRequest.clientIp}.log.")
        util.error(err) if err
        fs = require 'fs'
        fs.writeFileSync("debug/#{currentRequest.clientIp}.log", l + "\n\n" + error.stack)
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
      currentRequest = {}
      currentRequest.request = request
      currentRequest.response = response
      currentRequest.clientIp = request.connection.remoteAddress
      if config.DEBUG
        s = "# REQUEST #{new Date(Date.now())}\n" + JSON.stringify(request.headers) + "\n#{request.getBody()}\n\n"
        db.memcached.append("debug-#{currentRequest.clientIp}", s, (err, result) ->
          if err == 'Item is not stored'
            db.memcached.set("debug-#{currentRequest.clientIp}", s, config.CACHE_DURATION, (err, result) ->
            )
        )

      resParams = {}
      reqParams = tr069.request(request)

      if reqParams.inform
        resParams.inform = true
        cookies.ID = currentRequest.sessionId = reqParams.sessionId
        cookies.DeviceId = currentRequest.deviceId = common.getDeviceId(reqParams.deviceId)
        if config.DEBUG
          util.log("#{currentRequest.deviceId}: inform (#{reqParams.eventCodes}); retry count #{reqParams.retryCount}")

        updateDevice(currentRequest.deviceId, {'inform' : true, 'parameterValues' : reqParams.informParameterValues}, (err) ->
          res = tr069.response(currentRequest.sessionId, resParams, cookies)
          writeResponse res
        )
        return

      currentRequest.sessionId = reqParams.cookies.ID
      currentRequest.deviceId = reqParams.cookies.DeviceId
      taskId = reqParams.cookies.task

      if not taskId
        nextTask(cookies)
      else
        db.getTask(taskId, (task) ->
          runTask(task, reqParams)
        )

  server.listen config.ACS_PORT, config.ACS_INTERFACE
  #console.log "Server listening on port #{config.ACS_PORT}"
