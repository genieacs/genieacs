###
# Copyright 2013-2016  Zaid Abdulla
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
#
# This file incorporates work covered by the following copyright and
# permission notice:
#
# Copyright 2013 Fanoos Telecom
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.
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
db = require './db'
logger = require './logger'

MAX_CYCLES = 4


throwError = (err, httpResponse) ->
  if httpResponse
    httpResponse.writeHead(500, {'Connection' : 'close'})
    httpResponse.end("#{err.name}: #{err.message}")

  throw err


writeResponse = (sessionContext, res) ->
  if config.get('DEBUG', sessionContext.deviceId)
    dump = "# RESPONSE #{new Date(Date.now())}\n" + JSON.stringify(res.headers) + "\n#{res.data}\n\n"
    require('fs').appendFile("./debug/#{sessionContext.deviceId}.dump", dump, (err) ->
      throwError(err) if err
    )

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
    )
  else
    res.headers['Content-Length'] = res.data.length
    sessionContext.httpResponse.writeHead(res.code, res.headers)
    sessionContext.httpResponse.end(res.data)

  delete sessionContext.httpRequest
  delete sessionContext.httpResponse


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

    logger.accessError({
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

      recordFault(sessionContext, fault)

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
  cache.getPresets((err, presetsHash, presets) ->
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

    for task in sessionContext.tasks
      channel = "task_#{task._id}"

      # Delete if expired
      if task.expiry <= sessionContext.timestamp
        logger.accessInfo({
          sessionContext: sessionContext
          message: 'Task expired'
          task: task
        })
        sessionContext.doneTasks ?= []
        sessionContext.doneTasks.push(String(task._id))
        if channel of sessionContext.faults
          delete sessionContext.faults[channel]
          sessionContext.faultsTouched ?= {}
          sessionContext.faultsTouched[channel] = true
        continue

      if sessionContext.faults[channel]
        continue

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
          return throwError(new Error('Task name not recognized'), sessionContext.httpResponse) if err

      return nextRpc(sessionContext)

    return applyPresets(sessionContext)
  )


sendAcsRequest = (sessionContext, id, acsRequest) ->
  if not acsRequest?
    session.end(sessionContext, (err, isNew) ->
      return throwError(err, sessionContext.httpResponse) if err

      delete currentSessions.get(sessionContext.httpRequest.connection)[sessionContext.sessionId]
      if isNew
        logger.accessInfo({
          sessionContext: sessionContext
          message: 'New device registered'
        })

      db.clearTasks(sessionContext.deviceId, sessionContext.doneTasks, (err) ->
        return throwError(err, sessionContext.httpResponse) if err

        counter = 3

        for k of sessionContext.faultsTouched
          counter += 2
          if sessionContext.faults[k]
            sessionContext.faults[k].retries = sessionContext.retries[k]
            db.saveFault(sessionContext.deviceId, k, sessionContext.faults[k], (err) ->
              if err
                throwError(err, sessionContext.httpResponse) if counter & 1
                return counter = 0

              if (counter -= 2) == 1
                return writeResponse(sessionContext, soap.response(null))
            )
          else
            db.deleteFault(sessionContext.deviceId, k, (err) ->
              if err
                throwError(err, sessionContext.httpResponse) if counter & 1
                return counter = 0

              if (counter -= 2) == 1
                return writeResponse(sessionContext, soap.response(null))
            )

        if (counter -= 2) == 1
          return writeResponse(sessionContext, soap.response(null))
      )
    )
    return

  if acsRequest.name is 'Download'
    if not acsRequest.url?
      FS_PORT = config.get('FS_PORT')
      FS_HOSTNAME = config.get('FS_HOSTNAME')
      FS_SSL = config.get('FS_SSL')
      acsRequest.url = if FS_SSL then 'https://' else 'http://'
      acsRequest.url += FS_HOSTNAME
      acsRequest.url += ":#{FS_PORT}" if FS_PORT != 80
      acsRequest.url += "/#{encodeURIComponent(acsRequest.fileName)}"

    if not acsRequest.fileSize?
      return cache.getFiles((err, hash, files) ->
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


getSession = (httpRequest, callback) ->
  # Separation by comma is important as some devices don't comform to standard
  COOKIE_REGEX = /\s*([a-zA-Z0-9\-_]+?)\s*=\s*"?([a-zA-Z0-9\-_]*?)"?\s*(,|;|$)/g
  while match = COOKIE_REGEX.exec(httpRequest.headers.cookie)
    sessionId = match[2] if match[1] == 'session'

  return callback() if not sessionId?

  sessionContext = currentSessions.get(httpRequest.connection)?[sessionId]

  if sessionContext?
    return callback(null, sessionContext)

  setTimeout(() ->
    db.redisClient.eval('local v=redis.call("get",KEYS[1]);redis.call("del",KEYS[1]);return v;', 1, "session_#{sessionId}", (err, sessionContextString) ->
      return callback(err) if err or not sessionContextString
      session.deserialize(sessionContextString, (err, sessionContext) ->
        return callback(err) if err
        currentSessions.get(httpRequest.connection)[sessionId] = sessionContext
        callback(null, sessionContext)
      )
    )
  , 100
  )


currentSessions = new WeakMap()

# When socket closes, store active sessions in redis
onConnection = (socket) ->
  currentSessions.set(socket, {})
  socket.on('close', () ->
    sessions = currentSessions.get(socket)
    for sessionId, sessionContext of sessions
      delete sessionContext.httpRequest
      delete sessionContext.httpResponse
      session.serialize(sessionContext, (err, sessionContextString) ->
        return throwError(err) if err
        # TODO don't set if process is shutting down
        db.redisClient.setex("session_#{sessionId}", sessionContext.timeout, sessionContextString, (err) ->
          return throwError(err) if err
        )
      )
  )


listener = (httpRequest, httpResponse) ->
  if httpRequest.method != 'POST'
    httpResponse.writeHead 405, {'Allow': 'POST'}
    httpResponse.end('405 Method Not Allowed')
    return

  if httpRequest.headers['content-encoding']?
    switch httpRequest.headers['content-encoding']
      when 'gzip'
        stream = httpRequest.pipe(zlib.createGunzip())
      when 'deflate'
        stream = httpRequest.pipe(zlib.createInflate())
      else
        httpResponse.writeHead(415)
        httpResponse.end('415 Unsupported Media Type')
        return
  else
    stream = httpRequest

  chunks = []
  bytes = 0

  stream.on('data', (chunk) ->
    chunks.push(chunk)
    bytes += chunk.length
  )

  httpRequest.getBody = () ->
    # Write all chunks into a Buffer
    body = new Buffer(bytes)
    offset = 0
    chunks.forEach((chunk) ->
      chunk.copy(body, offset, 0, chunk.length)
      offset += chunk.length
    )
    return body

  stream.on('end', () ->
    rpc = null
    getSession(httpRequest, f = (err, sessionContext) ->
      return throwError(err, httpResponse) if err
      rpc ?= soap.request(httpRequest, sessionContext?.cwmpVersion)
      if not sessionContext?
        if rpc.cpeRequest?.name isnt 'Inform'
          httpResponse.writeHead(400)
          httpResponse.end('Session is expired')
          return

        deviceId = common.generateDeviceId(rpc.cpeRequest.deviceId)
        return session.init(deviceId, rpc.cwmpVersion, rpc.sessionTimeout ? config.get('SESSION_TIMEOUT', deviceId), (err, sessionContext) ->
          return throwError(err, httpResponse) if err

          sessionContext.sessionId = crypto.randomBytes(8).toString('hex')

          currentSessions.get(httpRequest.connection)[sessionContext.sessionId] = sessionContext

          httpRequest.connection.setTimeout(sessionContext.timeout * 1000)

          db.getDueTasksAndFaultsAndOperations(deviceId, sessionContext.timestamp, (err, dueTasks, faults, operations) ->
            return throwError(err, httpResponse) if err
            sessionContext.tasks = dueTasks
            sessionContext.faults = faults
            sessionContext.retries = {}
            for k, v of faults
              sessionContext.retries[k] = v.retries
            sessionContext.operations = operations

            # Delete expired faults
            for k, v of sessionContext.faults
              if v.expiry >= sessionContext.timestamp
                delete sessionContext.faults[k]
                sessionContext.faultsTouched ?= {}
                sessionContext.faultsTouched[k] = true

            f(null, sessionContext)
          )
        )

      sessionContext.httpRequest = httpRequest
      sessionContext.httpResponse = httpResponse

      if config.get('DEBUG', sessionContext.deviceId)
        dump = "# REQUEST #{new Date(Date.now())}\n" + JSON.stringify(httpRequest.headers) + "\n#{httpRequest.getBody()}\n\n"
        require('fs').appendFile("./debug/#{sessionContext.deviceId}.dump", dump, (err) ->
          return throwError(err) if err
        )

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
    )
  )


exports.listener = listener
exports.onConnection = onConnection
