###
# Copyright 2013-2017  Zaid Abdulla
#
# This file is part of GenieACS.
#
# GenieACS is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# GenieACS is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
###

util = require 'util'
zlib = require 'zlib'
crypto = require 'crypto'

config = require './config'
common = require './common'
soap = require './soap'
session = require './session'
query = require './query'
device = require './device'
cache = require './cache'
localCache = require './local-cache'
db = require './db'
logger = require './logger'

MAX_CYCLES = 4

MAX_CONCURRENT_REQUESTS = config.get('MAX_CONCURRENT_REQUESTS')
stats = {
  concurrentRequests: 0
  totalRequests: 0
  droppedRequests: 0
  initiatedSessions: 0
}

throwError = (err, httpResponse) ->
  if httpResponse
    currentSessions.delete(httpResponse.connection)
    httpResponse.writeHead(500, {'Connection' : 'close'})
    httpResponse.end("#{err.name}: #{err.message}")
    stats.concurrentRequests -= 1

  throw err


writeResponse = (sessionContext, res, close) ->
  # Close connection after last request in session
  res.headers['Connection'] = 'close' if close

  if config.get('DEBUG', sessionContext.deviceId)
    dump = "# RESPONSE #{new Date(Date.now())}\n" + JSON.stringify(res.headers) + "\n#{res.data}\n\n"
    require('fs').appendFile("./debug/#{sessionContext.deviceId}.dump", dump, (err) ->
      throwError(err) if err
    )

  finish = () ->
    stats.concurrentRequests -= 1
    if sessionContext.httpRequest.connection.destroyed
      logger.accessError({
        sessionContext: sessionContext
        message: 'Connection dropped'
      })
    else if close
      endSession(sessionContext, (err, isNew) ->
        return throwError(err) if err

        if isNew
          logger.accessInfo({
            sessionContext: sessionContext
            message: 'New device registered'
          })
      )
    else
      sessionContext.lastActivity = Date.now()
      currentSessions.set(sessionContext.httpRequest.connection, sessionContext)

  # respond using the same content-encoding as the request
  if sessionContext.httpRequest.headers['content-encoding']? and res.data.length > 0
    switch sessionContext.httpRequest.headers['content-encoding']
      when 'gzip'
        res.headers['Content-Encoding'] = 'gzip'
        compress = zlib.gzip
      when 'deflate'
        res.headers['Content-Encoding'] = 'deflate'
        compress = zlib.deflate

  if compress?
    compress(res.data, (err, data) ->
      return throwError(err, sessionContext.httpResponse) if err
      res.headers['Content-Length'] = data.length
      sessionContext.httpResponse.writeHead(res.code, res.headers)
      sessionContext.httpResponse.end(data)
      finish()
    )
  else
    res.headers['Content-Length'] = res.data.length
    sessionContext.httpResponse.writeHead(res.code, res.headers)
    sessionContext.httpResponse.end(res.data)
    finish()


recordFault = (sessionContext, fault, provisions, channels) ->
  if not provisions
    provisions = sessionContext.provisions
    channels = sessionContext.channels

  faults = sessionContext.faults

  for channel of channels
    provs = sessionContext.faults[channel]?.provisions or []
    faults[channel] = Object.assign({provisions: provs}, fault)

    if sessionContext.retries[channel]?
      ++ sessionContext.retries[channel]
    else
      sessionContext.retries[channel] = 0
      if Object.keys(channels).length != 1
        faults[channel].retryNow = true

    if channels[channel] == 0
      faults[channel].precondition = true

    sessionContext.faultsTouched ?= {}
    sessionContext.faultsTouched[channel] = true

    logger.accessWarn({
      sessionContext: sessionContext
      message: 'Channel has faulted'
      fault: fault
      channel: channel
      retries: sessionContext.retries[channel]
    })

  for provision, i in provisions
    for channel of channels
      if (channels[channel] >> i) & 1
        faults[channel].provisions.push(provision)

  for channel of channels
    provs = faults[channel].provisions
    faults[channel].provisions = []
    appendProvisions(faults[channel].provisions, provs)

  session.clearProvisions(sessionContext)
  return


inform = (sessionContext, rpc) ->
  session.inform(sessionContext, rpc.cpeRequest, (err, acsResponse) ->
    return throwError(err, sessionContext.httpResponse) if err
    res = soap.response({
      id: rpc.id,
      acsResponse: acsResponse,
      cwmpVersion : sessionContext.cwmpVersion
    })

    if !!cookiesPath = config.get('COOKIES_PATH', sessionContext.deviceId)
      res.headers['Set-Cookie'] = "session=#{sessionContext.sessionId}; Path=#{cookiesPath}"
    else
      res.headers['Set-Cookie'] = "session=#{sessionContext.sessionId}"

    writeResponse(sessionContext, res)
  )


transferComplete = (sessionContext, rpc) ->
  session.transferComplete(sessionContext, rpc.cpeRequest, (err, acsResponse, operation, fault) ->
    return throwError(err, sessionContext.httpResponse) if err

    if not operation?
      logger.accessWarn({
        sessionContext: sessionContext
        message: 'Unrecognized command key'
        rpc: rpc
      })

    if fault
      for k, v of operation.retries
        sessionContext.retries[k] = v

      recordFault(sessionContext, fault, operation.provisions, operation.channels)

    res = soap.response({
      id : rpc.id,
      acsResponse : acsResponse,
      cwmpVersion : sessionContext.cwmpVersion
    })
    writeResponse(sessionContext, res)
  )


testSchedule = (schedule, timestamp) ->
  range = schedule.schedule.nextRange(10, new Date(timestamp))
  prev = schedule.schedule.prevRange(1, new Date(timestamp), new Date(timestamp - schedule.duration))

  if prev
    first = +(prev[0] ? 0)
    last = +(prev[1] ? 0) + schedule.duration
  else
    first = +(range[0][0] ? 0)
    last = +(range[0][1] ? 0) + schedule.duration

  for r in range
    if last < r[0]
      break
    last = +(r[1] ? 0) + schedule.duration

  if timestamp >= first
    return [true, Math.max(0, last - timestamp)]
  else
    return [false, first - timestamp]


# Append providions and remove duplicates
appendProvisions = (original, toAppend) ->
  modified = false
  stringified = new WeakMap()
  for p, i in original
    stringified.set(p, JSON.stringify(p))

  for p, i in toAppend by -1
    s = JSON.stringify(p)
    for pp, j in original by -1
      ss = stringified.get(pp)
      if s == ss
        if (not p) or j >= original.length - (toAppend.length - i)
          p = null
        else
          original.splice(j, 1)
          modified = true
    if p
      original.splice(original.length - (toAppend.length - i) + 1, 0, p)
      stringified.set(p, s)
      modified = true

  return modified


applyPresets = (sessionContext) ->
  localCache.getPresets((err, presetsHash, presets) ->
    return throwError(err, sessionContext.httpResponse) if err

    # Filter presets based on existing faults
    blackList = {}
    whiteList = null
    whiteListProvisions = null

    RETRY_DELAY = config.get('RETRY_DELAY', sessionContext.deviceId)

    if sessionContext.faults?
      for channel, fault of sessionContext.faults
        if fault.retryNow
          retryTimestamp = 0
        else
          retryTimestamp = fault.timestamp + (RETRY_DELAY * Math.pow(2, sessionContext.retries[channel])) * 1000

        if retryTimestamp <= sessionContext.timestamp
          whiteList = channel
          whiteListProvisions = fault.provisions
          break

        blackList[channel] = if fault.precondition then 1 else 2

    sessionContext.deviceData.timestamps.revision = 1
    sessionContext.deviceData.attributes.revision = 1

    deviceEvents = {}
    for p in sessionContext.deviceData.paths.find(['Events', '*'], false, true)
      if sessionContext.timestamp <= sessionContext.deviceData.attributes.get(p)?.value?[1][0]
        deviceEvents[p[1]] = true

    parameters = {}
    filteredPresets = []

    for preset in presets
      if whiteList?
        continue if preset.channel != whiteList
      else if blackList[preset.channel] == 1
        continue

      eventsMatch = true
      for k, v of preset.events
        if (!v) != (!deviceEvents[k.replace(' ', '_')])
          eventsMatch = false
          break

      continue if (not eventsMatch) or (preset.schedule and not
        (preset.schedule.schedule and testSchedule(preset.schedule, sessionContext.timestamp)[0]))

      filteredPresets.push(preset)
      for k of preset.precondition
        sessionContext.channels[preset.channel] = 0
        p = k.split(/([^a-zA-Z0-9\-\_\.].*)/, 1)[0]
        parameters[p] = common.parsePath(p)

    declarations = []
    for k, v of parameters
      declarations.push([v, 1, {value: 1}])

    session.rpcRequest(sessionContext, declarations, (err, fault, id, acsRequest) ->
      return throwError(err, sessionContext.httpResponse) if err

      if fault
        recordFault(sessionContext, fault)
        session.clearProvisions(sessionContext)
        return applyPresets(sessionContext)

      if acsRequest
        return sendAcsRequest(sessionContext, id, acsRequest)

      session.clearProvisions(sessionContext)

      for k, v of parameters
        unpacked = device.unpack(sessionContext.deviceData, v)
        if unpacked[0] and (vv = sessionContext.deviceData.attributes.get(unpacked[0]).value?[1])?
          parameters[k] = vv[0]
        else
          delete parameters[k]

      if whiteList?
        session.addProvisions(sessionContext, whiteList, whiteListProvisions)

      appendProvisionsToFaults = {}
      for p in filteredPresets
        if query.testFilter(parameters, p.precondition)
          if blackList[p.channel] == 2
            appendProvisionsToFaults[p.channel] =
              (appendProvisionsToFaults[p.channel] or []).concat(p.provisions)
          else
            session.addProvisions(sessionContext, p.channel, p.provisions)

      for channel, provisions of appendProvisionsToFaults
        if appendProvisions(sessionContext.faults[channel].provisions, provisions)
          sessionContext.faultsTouched ?= {}
          sessionContext.faultsTouched[channel] = true

      sessionContext.presetCycles = (sessionContext.presetCycles or 0) + 1

      if sessionContext.presetCycles > MAX_CYCLES
        fault = {
          code: 'endless_cycle'
          message: 'The provision seems to be repeating indefinitely'
          timestamp: sessionContext.timestamp
        }
        recordFault(sessionContext, fault)
        session.clearProvisions(sessionContext)
        return sendAcsRequest(sessionContext)

      session.rpcRequest(sessionContext, null, (err, fault, id, acsRequest) ->
        return throwError(err, sessionContext.httpResponse) if err

        if fault
          recordFault(sessionContext, fault)
          session.clearProvisions(sessionContext)
          return applyPresets(sessionContext)

        if not acsRequest
          for channel, flags of sessionContext.channels
            if channel of sessionContext.faults
              delete sessionContext.faults[channel]
              sessionContext.faultsTouched ?= {}
              sessionContext.faultsTouched[channel] = true

          if whiteList?
            return applyPresets(sessionContext)

        sendAcsRequest(sessionContext, id, acsRequest)
      )
    )
  )


nextRpc = (sessionContext) ->
  session.rpcRequest(sessionContext, null, (err, fault, id, acsRequest) ->
    return throwError(err, sessionContext.httpResponse) if err

    if fault
      recordFault(sessionContext, fault)
      session.clearProvisions(sessionContext)
      return nextRpc(sessionContext)

    if acsRequest
      return sendAcsRequest(sessionContext, id, acsRequest)

    for channel, flags of sessionContext.channels
      if flags and channel of sessionContext.faults
        delete sessionContext.faults[channel]
        sessionContext.faultsTouched ?= {}
        sessionContext.faultsTouched[channel] = true

      if channel.startsWith('task_')
        taskId = channel.slice(5)
        sessionContext.doneTasks ?= []
        sessionContext.doneTasks.push(taskId)
        for t, j in sessionContext.tasks
          if t._id == taskId
            sessionContext.tasks.splice(j, 1)
            break

    session.clearProvisions(sessionContext)

    # Clear expired tasks
    sessionContext.tasks = sessionContext.tasks.filter((task) ->
      return true if not (task.expiry <= sessionContext.timestamp)

      logger.accessInfo({
        sessionContext: sessionContext
        message: 'Task expired'
        task: task
      })
      sessionContext.doneTasks ?= []
      sessionContext.doneTasks.push(task._id)
      channel = "task_#{task._id}"
      if channel of sessionContext.faults
        delete sessionContext.faults[channel]
        sessionContext.faultsTouched ?= {}
        sessionContext.faultsTouched[channel] = true

      return false
    )

    task = sessionContext.tasks.find((task) -> !sessionContext.faults["task_#{task._id}"])

    return applyPresets(sessionContext) if not task

    switch task.name
      when 'getParameterValues'
        # Set channel in case params array is empty
        sessionContext.channels["task_#{task._id}"] = 0
        for p in task.parameterNames
          session.addProvisions(sessionContext, "task_#{task._id}",
            [['refresh', p]])
      when 'setParameterValues'
        # Set channel in case params array is empty
        sessionContext.channels["task_#{task._id}"] = 0
        for p in task.parameterValues
          session.addProvisions(sessionContext, "task_#{task._id}",
            [['value', p[0], p[1]]])
      when 'refreshObject'
        session.addProvisions(sessionContext, "task_#{task._id}",
          [['refresh', task.objectName]])
      when 'reboot'
        session.addProvisions(sessionContext, "task_#{task._id}",
          [['reboot']])
      when 'factoryReset'
        session.addProvisions(sessionContext, "task_#{task._id}",
          [['reset']])
      when 'download'
        session.addProvisions(sessionContext, "task_#{task._id}",
          [['download', task.fileType, task.fileName, task.targetFileName]])
      when 'addObject'
        alias = ("#{p[0]}:#{JSON.stringify(p[1])}" for p in task.parameterValues or []).join(',')
        session.addProvisions(sessionContext, "task_#{task._id}",
          [['instances', "#{task.objectName}.[#{alias}]", "+1"]]);
      when 'deleteObject'
        session.addProvisions(sessionContext, "task_#{task._id}",
          [['instances', task.objectName, 0]]);
      else
        return throwError(new Error('Task name not recognized'), sessionContext.httpResponse)

    return nextRpc(sessionContext)
  )


endSession = (sessionContext, callback) ->
  saveCache = sessionContext.cacheUntil?

  counter = 3

  counter += 2
  db.saveDevice(sessionContext.deviceId, sessionContext.deviceData, sessionContext.new, (err) ->
    if err
      callback(err) if counter & 1
      return counter = 0

    return callback(null, sessionContext.new) if (counter -= 2) == 1
  )

  for k of sessionContext.operationsTouched
    counter += 2
    saveCache = true
    if sessionContext.operations[k]?
      db.saveOperation(sessionContext.deviceId, k, sessionContext.operations[k], (err) ->
        if err
          callback(err) if counter & 1
          return counter = 0

        return callback(null, sessionContext.new) if (counter -= 2) == 1
      )
    else
      db.deleteOperation(sessionContext.deviceId, k, (err) ->
        if err
          callback(err) if counter & 1
          return counter = 0

        return callback(null, sessionContext.new) if (counter -= 2) == 1
      )

  if sessionContext.doneTasks?.length
    counter += 2
    saveCache = true
    db.clearTasks(sessionContext.deviceId, sessionContext.doneTasks, (err) ->
      if err
        callback(err) if counter & 1
        return counter = 0

      return callback(null, sessionContext.new) if (counter -= 2) == 1
    )

  for k of sessionContext.faultsTouched
    counter += 2
    saveCache = true
    if sessionContext.faults[k]
      sessionContext.faults[k].retries = sessionContext.retries[k]
      db.saveFault(sessionContext.deviceId, k, sessionContext.faults[k], (err) ->
        if err
          callback(err) if counter & 1
          return counter = 0

        return callback(null, sessionContext.new) if (counter -= 2) == 1
      )
    else
      db.deleteFault(sessionContext.deviceId, k, (err) ->
        if err
          callback(err) if counter & 1
          return counter = 0

        return callback(null, sessionContext.new) if (counter -= 2) == 1
      )

  if saveCache
    counter += 2
    cacheDueTasksAndFaultsAndOperations(sessionContext.deviceId, sessionContext.tasks, sessionContext.faults, sessionContext.operations, sessionContext.cacheUntil, (err) ->
      if err
        callback(err) if counter & 1
        return counter = 0

      return callback(null, sessionContext.new) if (counter -= 2) == 1
    )

  callback(null, sessionContext.new) if (counter -= 2) == 1


sendAcsRequest = (sessionContext, id, acsRequest) ->
  if not acsRequest?
    return writeResponse(sessionContext, soap.response(null), true)

  if acsRequest.name is 'Download'
    if not acsRequest.url?
      FS_PORT = config.get('FS_PORT')
      FS_HOSTNAME = config.get('FS_HOSTNAME')
      FS_SSL = config.get('FS_SSL')
      acsRequest.url = if FS_SSL then 'https://' else 'http://'
      acsRequest.url += FS_HOSTNAME
      acsRequest.url += ":#{FS_PORT}" if FS_PORT != 80
      acsRequest.url += "/#{encodeURI(acsRequest.fileName)}"

    if not acsRequest.fileSize?
      return localCache.getFiles((err, hash, files) ->
        return throwError(err, sessionContext.httpResponse) if err

        if acsRequest.fileName of files
          acsRequest.fileSize = files[acsRequest.fileName].length
        else
          acsRequest.fileSize = 0

        return sendAcsRequest(sessionContext, id, acsRequest)
      )

  rpc = {
    id : id,
    acsRequest : acsRequest,
    cwmpVersion : sessionContext.cwmpVersion
  }

  logger.accessInfo({
    sessionContext: sessionContext
    message: 'ACS request'
    rpc: rpc
  })

  res = soap.response(rpc)

  writeResponse(sessionContext, res)


getSession = (connection, sessionId, callback) ->
  sessionContext = currentSessions.get(connection)

  if sessionContext
    currentSessions.delete(connection)
    return callback(null, sessionContext)

  return callback() if not sessionId

  setTimeout(() ->
    cache.pop("session_#{sessionId}", (err, sessionContextString) ->
      return callback(err) if err or not sessionContextString
      session.deserialize(sessionContextString, callback)
    )
  , 100)


currentSessions = new WeakMap()

# When socket closes, store active sessions in cache
onConnection = (socket) ->
  # The property remoteAddress may be undefined after the connection is
  # closed, unless we read it at least once (caching?)
  socket.remoteAddress

  socket.on('close', () ->
    sessionContext = currentSessions.get(socket)
    return if not sessionContext
    currentSessions.delete(socket)
    now = Date.now()

    lastActivity = sessionContext.lastActivity
    timeoutMsg = logger.flatten({
      sessionContext: sessionContext
      message: 'Session timeout'
      sessionTimestamp: sessionContext.timestamp
    })

    timeout = (sessionContext.lastActivity + sessionContext.timeout * 1000) - now
    if timeout <= 0
      return logger.accessError(timeoutMsg)

    setTimeout(() ->
      cache.get("session_#{sessionContext.sessionId}", (err, sessionContextString) ->
        return throwError(err) if err
        return if not sessionContextString
        session.deserialize(sessionContextString, (err, sessionContext) ->
          return throwError(err) if err
          if sessionContext.lastActivity == lastActivity
            logger.accessError(timeoutMsg)
        )
      )
    , timeout + 1000).unref()

    session.serialize(sessionContext, (err, sessionContextString) ->
      return throwError(err) if err
      cache.set("session_#{sessionContext.sessionId}", sessionContextString, Math.ceil(timeout / 1000) + 3, (err) ->
        return throwError(err) if err
      )
    )
  )

setInterval(() ->
  if stats.droppedRequests
    logger.warn({
      message: 'Worker overloaded'
      droppedRequests: stats.droppedRequests
      totalRequests: stats.totalRequests
      initiatedSessions: stats.initiatedSessions
      pid: process.pid
    })

  stats.totalRequests = 0
  stats.droppedRequests = 0
  stats.initiatedSessions = 0
, 10000).unref()


getDueTasksAndFaultsAndOperations = (deviceId, timestamp, callback) ->
  cache.get("#{deviceId}_tasks_faults_operations", (err, res) ->
    return callback(err) if err

    if res
      res = JSON.parse(res)
      return callback(null, res.tasks or [], res.faults or {}, res.operations or {})

    faults = tasks = operations = cacheUntil = null

    db.getFaults(deviceId, (err, _faults) ->
      if err
        callback?(err)
        return callback = null

      faults = _faults
      if tasks? and operations?
        return callback(null, tasks, faults, operations, cacheUntil)
    )

    db.getDueTasks(deviceId, timestamp, (err, dueTasks, nextTimestamp) ->
      if err
        callback?(err)
        return callback = null

      tasks = dueTasks
      cacheUntil = nextTimestamp or 0

      if faults? and operations?
        return callback(null, tasks, faults, operations, cacheUntil)
    )

    db.getOperations(deviceId, (err, _operations) ->
      if err
        callback?(err)
        return callback = null

      operations = _operations

      if faults? and tasks?
        return callback(null, tasks, faults, operations, cacheUntil)
    )

    if faults? and tasks? and operations?
      return callback(null, tasks, faults, operations, cacheUntil)
  )


cacheDueTasksAndFaultsAndOperations = (deviceId, tasks, faults, operations, cacheUntil, callback) ->
  v = {}
  v.tasks = tasks if tasks.length
  v.faults = faults if Object.keys(faults).length
  v.operations = operations if Object.keys(operations).length

  if cacheUntil
    ttl = Math.trunc((Date.now() - cacheUntil) / 1000)
  else
    ttl = config.get('MAX_CACHE_TTL', deviceId)

  cache.set("#{deviceId}_tasks_faults_operations", JSON.stringify(v), ttl, callback)


processRequest = (sessionContext, rpc) ->
  if rpc.cpeRequest?
    if rpc.cpeRequest.name is 'Inform'
      logger.accessInfo({
        sessionContext: sessionContext
        message: 'Inform'
        rpc: rpc
      })
      inform(sessionContext, rpc)
    else if rpc.cpeRequest.name is 'TransferComplete'
      logger.accessInfo({
        sessionContext: sessionContext
        message: 'CPE request'
        rpc: rpc
      })
      transferComplete(sessionContext, rpc)
    else if rpc.cpeRequest.name is 'GetRPCMethods'
      logger.accessInfo({
        sessionContext: sessionContext
        message: 'CPE request'
        rpc: rpc
      })
      res = soap.response({
        id : rpc.id
        acsResponse : {name: 'GetRPCMethodsResponse', methodList: ['Inform', 'GetRPCMethods', 'TransferComplete']}
        cwmpVersion : sessionContext.cwmpVersion
      })
      writeResponse(sessionContext, res)
    else
      return throwError(new Error('ACS method not supported'), sessionContext.httpResponse)
  else if rpc.cpeResponse
    session.rpcResponse(sessionContext, rpc.id, rpc.cpeResponse, (err) ->
      return throwError(err, sessionContext.httpResponse) if err
      nextRpc(sessionContext)
    )
  else if rpc.cpeFault
    logger.accessWarn({
      sessionContext: sessionContext
      message: 'CPE fault'
      rpc:rpc
    })
    session.rpcFault(sessionContext, rpc.id, rpc.cpeFault, (err, fault) ->
      return throwError(err, sessionContext.httpResponse) if err

      if fault
        recordFault(sessionContext, fault)
        session.clearProvisions(sessionContext)
      nextRpc(sessionContext)
    )
  else # CPE sent empty response
    session.timeoutOperations(sessionContext, (err, faults, operations) ->
      return throwError(err, sessionContext.httpResponse) if err

      for fault, i in faults
        for k, v of operations[i].retries
          sessionContext.retries[k] = v

        recordFault(sessionContext, fault, operations[i].provisions, operations[i].channels)

      nextRpc(sessionContext)
    )


listener = (httpRequest, httpResponse) ->
  stats.totalRequests += 1
  if httpRequest.method != 'POST'
    httpResponse.writeHead 405, {'Allow': 'POST', 'Connection': 'close'}
    httpResponse.end('405 Method Not Allowed')
    return

  sessionId = null
  # Separation by comma is important as some devices don't comform to standard
  COOKIE_REGEX = /\s*([a-zA-Z0-9\-_]+?)\s*=\s*"?([a-zA-Z0-9\-_]*?)"?\s*(,|;|$)/g
  while match = COOKIE_REGEX.exec(httpRequest.headers.cookie)
    sessionId = match[2] if match[1] == 'session'

  # If overloaded, ask CPE to retry in 60 seconds
  if not sessionId and stats.concurrentRequests > MAX_CONCURRENT_REQUESTS
    httpResponse.writeHead(503, {'Retry-after': 60, 'Connection': 'close'})
    httpResponse.end('503 Service Unavailable')
    stats.droppedRequests += 1
    return

  if httpRequest.headers['content-encoding']?
    switch httpRequest.headers['content-encoding']
      when 'gzip'
        stream = httpRequest.pipe(zlib.createGunzip())
      when 'deflate'
        stream = httpRequest.pipe(zlib.createInflate())
      else
        httpResponse.writeHead(415, {'Connection': 'close'})
        httpResponse.end('415 Unsupported Media Type')
        return
  else
    stream = httpRequest

  stats.concurrentRequests += 1
  httpRequest.on('aborted', () ->
    stats.concurrentRequests -= 1
    # In some cases event end can be emitted after aborted event
    httpRequest.removeAllListeners('end')
  )

  chunks = []
  bytes = 0

  stream.on('data', (chunk) ->
    chunks.push(chunk)
    bytes += chunk.length
  )

  stream.on('end', () ->
    body = new Buffer(bytes)
    offset = 0
    chunks.forEach((chunk) ->
      chunk.copy(body, offset, 0, chunk.length)
      offset += chunk.length
    )

    parsedRpc = (sessionContext, rpc, parseWarnings) ->
      sessionContext.httpRequest = httpRequest
      sessionContext.httpResponse = httpResponse

      for w in parseWarnings
        w.sessionContext = sessionContext
        w.rpc = rpc;
        logger.accessWarn(w)

      if config.get('DEBUG', sessionContext.deviceId)
        dump = "# REQUEST #{new Date(Date.now())}\n" + JSON.stringify(httpRequest.headers) + "\n#{body}\n\n"
        require('fs').appendFile("./debug/#{sessionContext.deviceId}.dump", dump, (err) ->
          return throwError(err) if err
        )

      processRequest(sessionContext, rpc)

    getSession(httpRequest.connection, sessionId, (err, sessionContext) ->
      return throwError(err, httpResponse) if err

      if sessionContext and (sessionContext.sessionId != sessionId or
          sessionContext.lastActivity + sessionContext.timeout * 1000 < Date.now())
        logger.accessError({message: 'Invalid session', sessionContext: sessionContext})
        httpResponse.writeHead(400, {'Connection': 'close'})
        httpResponse.end('Invalid session')
        stats.concurrentRequests -= 1
        return

      # Check again just in case device included old session ID from the previous session
      if not sessionContext and stats.concurrentRequests > MAX_CONCURRENT_REQUESTS
        httpResponse.writeHead(503, {'Retry-after': 60, 'Connection': 'close'})
        httpResponse.end('503 Service Unavailable')
        stats.droppedRequests += 1
        stats.concurrentRequests -= 1
        return

      parseWarnings = []
      try
        rpc = soap.request(body, sessionContext?.cwmpVersion, parseWarnings)
      catch err
        msg = {
          message: 'XML parse error'
          parseError: err.message.trim()
          sessionContext: sessionContext or {}
        }
        msg.sessionContext.httpRequest = httpRequest
        msg.sessionContext.httpResponse = httpResponse
        logger.accessError(msg)
        httpResponse.writeHead(400, {'Connection': 'close'})
        httpResponse.end(err.message)
        stats.concurrentRequests -= 1
        return

      return parsedRpc(sessionContext, rpc, parseWarnings) if sessionContext

      if rpc.cpeRequest?.name isnt 'Inform'
        msg = {
          message: 'Invalid session'
          sessionContext: sessionContext or {}
        }
        msg.sessionContext.httpRequest = httpRequest
        msg.sessionContext.httpResponse = httpResponse
        logger.accessError(msg)
        httpResponse.writeHead(400, {'Connection': 'close'})
        httpResponse.end('Invalid session')
        stats.concurrentRequests -= 1
        return

      stats.initiatedSessions += 1
      deviceId = common.generateDeviceId(rpc.cpeRequest.deviceId)
      return session.init(deviceId, rpc.cwmpVersion, rpc.sessionTimeout ? config.get('SESSION_TIMEOUT', deviceId), (err, sessionContext) ->
        return throwError(err, httpResponse) if err

        sessionContext.sessionId = crypto.randomBytes(8).toString('hex')
        httpRequest.connection.setTimeout(sessionContext.timeout * 1000)

        getDueTasksAndFaultsAndOperations(deviceId, sessionContext.timestamp, (err, dueTasks, faults, operations, cacheUntil) ->
          return throwError(err, httpResponse) if err

          sessionContext.tasks = dueTasks
          sessionContext.faults = faults
          sessionContext.retries = {}
          for k, v of faults
            sessionContext.retries[k] = v.retries
          sessionContext.operations = operations
          sessionContext.cacheUntil = cacheUntil

          # Delete expired faults
          for k, v of sessionContext.faults
            if v.expiry >= sessionContext.timestamp
              delete sessionContext.faults[k]
              sessionContext.faultsTouched ?= {}
              sessionContext.faultsTouched[k] = true

          parsedRpc(sessionContext, rpc, parseWarnings)
        )
      )
    )
  )


exports.listener = listener
exports.onConnection = onConnection
