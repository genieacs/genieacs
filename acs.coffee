config = require './config'
common = require './common'
util = require 'util'
http = require 'http'
tr069 = require './tr-069'
tasks = require './tasks'
sanitize = require('./sanitize').sanitize
db = require './db'
presets = require './presets'
mongodb = require 'mongodb'


applyConfigurations = (currentRequest, taskList) ->
  if taskList.length
    util.log("#{currentRequest.deviceId}: Presets discrepancy found")
    db.tasksCollection.save(taskList, (err) ->
      for task in taskList
        util.log("#{currentRequest.deviceId}: Added #{task.name} task #{task._id}")
      task = taskList[0]
      util.log("#{currentRequest.deviceId}: Started task #{task.name}(#{task._id})")
      runTask(currentRequest, task, {})
    )
  else
    res = tr069.response(currentRequest.sessionId, {}, {})
    writeResponse(currentRequest, res)


writeResponse = (currentRequest, res) ->
  if config.DEBUG_DEVICES[currentRequest.deviceId]
    dump = "# RESPONSE #{new Date(Date.now())}\n" + JSON.stringify(res.headers) + "\n#{res.data}\n\n"
    fs = require('fs').appendFile("debug/#{currentRequest.deviceId}.dump", dump, (err) ->
      throw new Error(err) if err
    )

  currentRequest.response.writeHead(res.code, res.headers)
  currentRequest.response.end(res.data)


updateDevice = (currentRequest, actions, callback) ->
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
        util.log("#{currentRequest.deviceId}: New device detected")
        db.devicesCollection.update({'_id' : currentRequest.deviceId}, {'$set' : updates}, {upsert: true, safe: true}, (err) ->
          if err?
            callback(err) if callback?
            return
          
          task = {device : currentRequest.deviceId, name : 'init', timestamp : mongodb.Timestamp()}
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


runTask = (currentRequest, task, reqParams) ->
  resParams = {}
  actions = tasks.task(task, reqParams, resParams)
  updateDevice(currentRequest, actions)

  if Object.keys(resParams).length > 0
    db.updateTask(task, (err) ->
      res = tr069.response(currentRequest.sessionId, resParams, {task : String(task._id)})
      writeResponse(currentRequest, res)
    )
    return

  # Task finished
  db.memcached.del(String(task._id))
  db.tasksCollection.remove({'_id' : mongodb.ObjectID(String(task._id))}, {safe: true}, (err, removed) ->
    util.log("#{currentRequest.deviceId}: Completed task #{task.name}(#{task._id})")
    cookies = {task : null}
    nextTask(currentRequest, cookies)
  )


nextTask = (currentRequest, cookies) ->
  cur = db.tasksCollection.find({'device' : currentRequest.deviceId}).sort(['timestamp']).limit(1)
  cur.nextObject( (err, task) ->
    reqParams = {}
    resParams = {}

    if not task
      # no more tasks, check presets discrepancy
      db.memcached.get(["#{currentRequest.deviceId}_presets_hash", 'presets_hash'], (err, results) ->
        presetsHash = results['presets_hash']
        devicePresetsHash = results["#{currentRequest.deviceId}_presets_hash"]

        if not devicePresetsHash or presetsHash != devicePresetsHash
          presets.assertPresets(currentRequest.deviceId, presetsHash, (taskList) ->
            applyConfigurations(currentRequest, taskList)
          )
        else if not presetsHash
          presets.getPresetsHash((hash) ->
            if hash != devicePresetsHash
              presets.assertPresets(currentRequest.deviceId, presetsHash, (taskList) ->
                applyConfigurations(currentRequest, taskList)
              )
            else
              # no discrepancy, return empty response
              res = tr069.response(currentRequest.sessionId, resParams, cookies)
              writeResponse(currentRequest, res)
          )
        else
          # no discrepancy, return empty response
          res = tr069.response(currentRequest.sessionId, resParams, cookies)
          writeResponse(currentRequest, res)
      )
      return
    else if task.fault?
      # last task was faulty. Do nothing until until task is deleted
      res = tr069.response(currentRequest.sessionId, resParams, cookies)
      writeResponse(currentRequest, res)
    else
      util.log("#{currentRequest.deviceId}: Started task #{task.name}(#{task._id})")
      runTask(currentRequest, task, reqParams)
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

      resParams = {}
      reqParams = tr069.request(request)

      # get deviceId either from inform xml or cookie
      if reqParams.deviceId?
        currentRequest.deviceId = common.getDeviceId(reqParams.deviceId)
        cookies.DeviceId = currentRequest.deviceId
      else
        currentRequest.deviceId = reqParams.cookies.DeviceId

      if config.DEBUG_DEVICES[currentRequest.deviceId]
        dump = "# REQUEST #{new Date(Date.now())}\n" + JSON.stringify(request.headers) + "\n#{request.getBody()}\n\n"
        require('fs').appendFile("debug/#{currentRequest.deviceId}.dump", dump, (err) ->
          throw new Error(err) if err
        )

      if reqParams.inform
        resParams.inform = true
        cookies.ID = currentRequest.sessionId = reqParams.sessionId

        if config.LOG_INFORMS
          util.log("#{currentRequest.deviceId}: Inform (#{reqParams.eventCodes}); retry count #{reqParams.retryCount}")

        updateDevice(currentRequest, {'inform' : true, 'parameterValues' : reqParams.informParameterValues}, (err) ->
          res = tr069.response(currentRequest.sessionId, resParams, cookies)
          writeResponse(currentRequest, res)
        )
        return

      currentRequest.sessionId = reqParams.cookies.ID
      taskId = reqParams.cookies.task

      if not taskId
        nextTask(currentRequest, cookies)
      else
        db.getTask(taskId, (task) ->
          if not task
            nextTask(currentRequest, cookies)
          else if reqParams.fault?
            util.log("#{currentRequest.deviceId}: Fault response for task #{task._id}")
            db.tasksCollection.update({_id : mongodb.ObjectID(String(task._id))}, {$set : {fault : reqParams.fault}}, (err) ->
              # Faulty task. No more work to do until task is deleted.
              res = tr069.response(currentRequest.sessionId, resParams, cookies)
              writeResponse(currentRequest, res)
            )
          else
            runTask(currentRequest, task, reqParams)
        )

  server.listen config.ACS_PORT, config.ACS_INTERFACE
  #console.log "Server listening on port #{config.ACS_PORT}"
