config = require './config'
common = require './common'
util = require 'util'
http = require 'http'
https = require 'https'
tr069 = require './tr-069'
tasks = require './tasks'
normalize = require('./normalize').normalize
db = require './db'
presets = require './presets'
mongodb = require 'mongodb'
fs = require 'fs'
apiFunctions = require './api-functions'

OBJECT_REGEX = /\.$/
INSTANCE_REGEX = /\.[\d]+\.$/


# Used to reject new TR-069 sessions when under load
holdUntil = Date.now()


applyConfigurations = (currentRequest, taskList) ->
  if taskList.length
    util.log("#{currentRequest.deviceId}: Presets discrepancy found")
    apiFunctions.insertTasks(taskList, (err, tasks) ->
      throw new Error(err) if err?
      task = tasks[0]
      util.log("#{currentRequest.deviceId}: Started task #{task.name}(#{task._id})")
      runTask(currentRequest, task, {})
    )
  else
    res = tr069.response(null, {}, {})
    writeResponse(currentRequest, res)


writeResponse = (currentRequest, res) ->
  if res.headers['Content-Length'] == 0
    # no more requests. terminate TCP connection
    res.headers['Connection'] = 'close' if currentRequest.httpRequest.httpVersion == '1.1'
  else
    res.headers['Connection'] = 'Keep-Alive' if currentRequest.httpRequest.httpVersion == '1.0'

  if config.DEBUG_DEVICES[currentRequest.deviceId]
    dump = "# RESPONSE #{new Date(Date.now())}\n" + JSON.stringify(res.headers) + "\n#{res.data}\n\n"
    fs = require('fs').appendFile("debug/#{currentRequest.deviceId}.dump", dump, (err) ->
      throw new Error(err) if err?
    )

  currentRequest.httpResponse.writeHead(res.code, res.headers)
  currentRequest.httpResponse.end(res.data)


updateDevice = (currentRequest, actions, callback) ->
  if not actions?
    callback() if callback?
    return

  now = new Date(Date.now())
  updates = {}
  deletes = {}
  if actions.inform?
    updates['_lastInform'] = now
    updates['_lastBoot'] = now if '1 BOOT' in actions.inform
    updates['_lastBootstrap'] = now if '0 BOOTSTRAP' in actions.inform

  if actions.parameterValues?
    for p in actions.parameterValues
      origValue = p[1]
      v = normalize(p[0], origValue)

      path = if common.endsWith(p[0], '.') then p[0] else "#{p[0]}."
      if v == origValue
        deletes["#{path}_orig"] = 1
      else
        updates["#{path}_orig"] = origValue
      updates["#{path}_value"] = v
      updates["#{path}_timestamp"] = now
      if p[2]?
        updates["#{path}_type"] = p[2]
      else
        deletes["#{path}_type"] = 1

  if actions.deletedObjects?
    for p in actions.deletedObjects
      deletes[p] = 1

  if actions.instanceName?
    for i in actions.instanceName
      updates["#{i[0]}._name"] = i[1]

  if actions.parameterNames?
    for p in actions.parameterNames
      if OBJECT_REGEX.test(p[0])
        path = p[0]
        if INSTANCE_REGEX.test(p[0])
          updates["#{path}_instance"] = true
        else
          updates["#{path}_object"] = true
      else
        path = "#{p[0]}."
      updates["#{path}_writable"] = p[1] if p[1]?
      updates["#{path}_timestamp"] = now

  if actions.customCommands?
    for p in actions.customCommands
      commandName = p[0]
      updates["_customCommands.#{commandName}._value"] = p[1]
      updates["_customCommands.#{commandName}._timestamp"] = now

  if Object.keys(updates).length > 0 or Object.keys(deletes).length > 0
    db.devicesCollection.update({'_id' : currentRequest.deviceId}, {'$set' : updates, '$unset' : deletes}, {}, (err, count) ->
      if (err)
        callback(err) if callback?
        return

      if count == 0
        util.log("#{currentRequest.deviceId}: New device detected")
        db.devicesCollection.update({'_id' : currentRequest.deviceId}, {'$set' : updates}, {upsert: true}, (err) ->
          if err?
            callback(err) if callback?
            return
          
          task = {device : currentRequest.deviceId, name : 'init', timestamp : config.INIT_TIMESTAMP}
          apiFunctions.insertTasks(task, (err, t) ->
            callback(err) if callback?
          )
        )
      else if updates['_lastBootstrap']?
        # reinitialize on bootstrap event (e.g. firmware upgrade)
        task = {device : currentRequest.deviceId, name : 'init', timestamp : config.INIT_TIMESTAMP}
        apiFunctions.insertTasks(task, (err) ->
          callback(err) if callback?
        )
      else
        callback() if callback?
    )
  else
    callback() if callback?


runTask = (currentRequest, task, methodResponse) ->
  timeDiff = process.hrtime()
  tasks.task(task, methodResponse, (err, status, cwmpResponse, deviceUpdates) ->
    throw new Error(err) if err?
    # TODO handle error
    updateDevice(currentRequest, deviceUpdates, (err) ->
      throw new Error(err) if err?

      timeDiff = process.hrtime(timeDiff)[0] + 1
      if timeDiff > 3 # in seconds
        # Server under load. Hold new sessions temporarily.
        holdUntil = Math.max(Date.now() + timeDiff * 2000, holdUntil)

      switch status
        when tasks.STATUS_FINISHED
          db.memcached.del(String(task._id))
          db.tasksCollection.remove({'_id' : mongodb.ObjectID(String(task._id))}, {safe: true}, (err, removed) ->
            throw new Error(err) if err?
            util.log("#{currentRequest.deviceId}: Completed task #{task.name}(#{task._id})")
            nextTask(currentRequest)
          )
        when tasks.STATUS_FAULT
          util.log("#{currentRequest.deviceId}: Fault response for task #{task._id}")
          db.saveTask(task, (err) ->
            throw new Error(err) if err?
            # Faulty task. No more work to do until task is deleted.
            res = tr069.response(null, cwmpResponse)
            writeResponse(currentRequest, res)
          )
        when tasks.STATUS_PENDING
          db.saveTask(task, (err) ->
            throw new Error(err) if err?
            # task expects CPE confirmation later
            nextTask(currentRequest)
          )
        when tasks.STATUS_STARTED
          db.updateTask(task, (err) ->
            throw new Error(err) if err?
            res = tr069.response(task._id, cwmpResponse)
            writeResponse(currentRequest, res)
          )
        when tasks.STATUS_SAVE
          db.saveTask(task, (err) ->
            throw new Error(err) if err?
            res = tr069.response(task._id, cwmpResponse)
            writeResponse(currentRequest, res)
          )
        else
          throw Error('Unknown task status')
    )
  )


isTaskExpired = (task) ->
  now = Date.now()
  if task.expires and (now - task.timestamp.getTime()) > config.DEVICE_ONLINE_THRESHOLD
    return true
  return false


nextTask = (currentRequest) ->
  cur = db.tasksCollection.find({'device' : currentRequest.deviceId}).sort(['timestamp']).limit(1)
  cur.nextObject((err, task) ->
    throw new Error(err) if err?
    cwmpResponse = {}

    if not task
      # no more tasks, check presets discrepancy
      db.memcached.get(["#{currentRequest.deviceId}_presets_hash", 'presets_hash'], (err, results) ->
        # ignore memcached errors
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
              res = tr069.response(null, cwmpResponse)
              writeResponse(currentRequest, res)
          )
        else
          # no discrepancy, return empty response
          res = tr069.response(null, cwmpResponse)
          writeResponse(currentRequest, res)
      )
    else if task.fault?
      # last task was faulty. Do nothing until until task is deleted
      res = tr069.response(null, cwmpResponse)
      writeResponse(currentRequest, res)
    else if isTaskExpired(task)
      db.tasksCollection.remove({'_id' : mongodb.ObjectID(String(task._id))}, {safe: true}, (err, removed) ->
        throw new Error(err) if err?
        nextTask(currentRequest)
      )
    else
      util.log("#{currentRequest.deviceId}: Started task #{task.name}(#{task._id})")
      runTask(currentRequest, task, {})
  )


listener = (httpRequest, httpResponse) ->
  if httpRequest.method != 'POST'
    #console.log '>>> 405 Method Not Allowed'
    httpResponse.writeHead 405, {'Allow': 'POST'}
    httpResponse.end('405 Method Not Allowed')
    return

  chunks = []
  bytes = 0
  cookies = {}

  httpRequest.addListener 'data', (chunk) ->
    chunks.push(chunk)
    bytes += chunk.length

  httpRequest.getBody = (encoding) ->
    # Write all chunks into a Buffer
    body = new Buffer(bytes)
    offset = 0
    chunks.forEach((chunk) ->
      chunk.copy(body, offset, 0, chunk.length)
      offset += chunk.length
    )

    #Return encoded (default to UTF8) string
    return body.toString(encoding || 'utf8', 0, body.byteLength)

  httpRequest.addListener 'end', () ->
    currentRequest = {}
    currentRequest.httpRequest = httpRequest
    currentRequest.httpResponse = httpResponse

    cwmpResponse = {}
    cwmpRequest = tr069.request(httpRequest)

    # get deviceId either from inform xml or cookie
    if cwmpRequest.methodRequest? and cwmpRequest.methodRequest.type is 'Inform'
      cookies.deviceId = currentRequest.deviceId = common.getDeviceId(cwmpRequest.methodRequest.deviceId)
    else
      currentRequest.deviceId = cwmpRequest.cookies.deviceId

    if config.DEBUG_DEVICES[currentRequest.deviceId]
      dump = "# REQUEST #{new Date(Date.now())}\n" + JSON.stringify(httpRequest.headers) + "\n#{httpRequest.getBody()}\n\n"
      require('fs').appendFile("debug/#{currentRequest.deviceId}.dump", dump, (err) ->
        throw new Error(err) if err
      )

    if cwmpRequest.methodRequest?
      if cwmpRequest.methodRequest.type is 'Inform'
        if Date.now() < holdUntil
          # Ask CPE to retry in 5 mins
          res = {code : 503, headers : {'Content-Length' : 0, 'Retry-After' : 300}, data : ''}
          writeResponse(currentRequest, res)
          return

        cwmpResponse.methodResponse = {type : 'InformResponse'}

        if config.LOG_INFORMS
          util.log("#{currentRequest.deviceId}: Inform (#{cwmpRequest.methodRequest.event}); retry count #{cwmpRequest.methodRequest.retryCount}")

        updateDevice(currentRequest, {'inform' : cwmpRequest.methodRequest.event, 'parameterValues' : cwmpRequest.methodRequest.parameterList}, (err) ->
          throw new Error(err) if err?
          res = tr069.response(cwmpRequest.id, cwmpResponse, cookies)
          writeResponse(currentRequest, res)
        )
      else if cwmpRequest.methodRequest.type is 'TransferComplete'
        # do nothing
        util.log("#{currentRequest.deviceId}: Transfer complete")
        cwmpResponse.methodResponse = {type : 'TransferCompleteResponse'}
        res = tr069.response(cwmpRequest.id, cwmpResponse, cookies)
        writeResponse(currentRequest, res)
      else
        throw Error('ACS method not supported')
    else if cwmpRequest.methodResponse?
      taskId = cwmpRequest.id

      db.getTask(taskId, (task) ->
        if not task
          nextTask(currentRequest)
        else
          runTask(currentRequest, task, cwmpRequest.methodResponse)
      )
    else if cwmpRequest.fault?
      taskId = cwmpRequest.id
      if not taskId
        # Fault not related to a task. return empty response.
        res = tr069.response(null, {}, {})
        writeResponse(currentRequest, res)
        return

      db.getTask(taskId, (task) ->
        if not task
          nextTask(currentRequest)
        else
          runTask(currentRequest, task, cwmpRequest.fault)
      )
    else
      # cpe sent empty response. start sending acs requests
      nextTask(currentRequest)


cluster = require 'cluster'
numCPUs = require('os').cpus().length

if cluster.isMaster
  db.memcached.flush(() ->
  )
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
  options = {
    key: fs.readFileSync('httpscert.key'),
    cert: fs.readFileSync('httpscert.crt')
  }

  httpServer = http.createServer(listener)
  httpsServer = https.createServer(options, listener)

  httpServer.listen(config.ACS_PORT, config.ACS_INTERFACE)
  httpsServer.listen(config.ACS_HTTPS_PORT, config.ACS_HTTPS_INTERFACE)
  #console.log "Server listening on port #{config.ACS_PORT}"
