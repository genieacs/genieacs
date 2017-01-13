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

MAX_CYCLES = 4


throwError = (err, httpResponse) ->
  if httpResponse
    httpResponse.writeHead(500, {'Connection' : 'close'})
    httpResponse.end("#{err.name}: #{err.message}")

  throw err


writeResponse = (currentRequest, res) ->
  if config.get('DEBUG', currentRequest.sessionData.deviceId)
    dump = "# RESPONSE #{new Date(Date.now())}\n" + JSON.stringify(res.headers) + "\n#{res.data}\n\n"
    require('fs').appendFile("./debug/#{currentRequest.sessionData.deviceId}.dump", dump, (err) ->
      throwError(err) if err
    )

  # respond using the same content-encoding as the request
  if currentRequest.httpRequest.headers['content-encoding']? and res.data.length > 0
    switch currentRequest.httpRequest.headers['content-encoding']
      when 'gzip'
        res.headers['Content-Encoding'] = 'gzip'
        compress = zlib.gzip
      when 'deflate'
        res.headers['Content-Encoding'] = 'deflate'
        compress = zlib.deflate

  if compress?
    compress(res.data, (err, data) ->
      return throwError(err, currentRequest.httpResponse) if err
      res.headers['Content-Length'] = data.length
      currentRequest.httpResponse.writeHead(res.code, res.headers)
      currentRequest.httpResponse.end(data)
    )
  else
    res.headers['Content-Length'] = res.data.length
    currentRequest.httpResponse.writeHead(res.code, res.headers)
    currentRequest.httpResponse.end(res.data)


recordFault = (sessionData, fault, provisions, channels) ->
  faults = sessionData.faults

  for channel of channels
    provs = sessionData.faults[channel]?.provisions or []
    faults[channel] = Object.assign({provisions: provs}, fault)

    if sessionData.retries[channel]?
      ++ sessionData.retries[channel]
    else
      sessionData.retries[channel] = 0
      if Object.keys(channels).length != 1
        faults[channel].retryNow = true

    if channels[channel] == 0
      faults[channel].precondition = true

    sessionData.faultsTouched ?= {}
    sessionData.faultsTouched[channel] = true
    util.log("#{sessionData.deviceId}: Fault occurred in channel #{channel} (retries: #{sessionData.retries[channel]})")

  for provision, i in provisions
    for channel of channels
      if (channels[channel] >> i) & 1
        faults[channel].provisions.push(provision)

  for channel of channels
    provs = faults[channel].provisions
    faults[channel].provisions = []
    appendProvisions(faults[channel].provisions, provs)

  session.clearProvisions(sessionData)
  return


inform = (currentRequest, cwmpRequest) ->
  if config.get('LOG_INFORMS', currentRequest.sessionData.deviceId)
    util.log("#{currentRequest.sessionData.deviceId}: Inform (#{cwmpRequest.methodRequest.event}); retry count #{cwmpRequest.methodRequest.retryCount}")

  session.inform(currentRequest.sessionData, cwmpRequest.methodRequest, (err, rpcResponse) ->
    return throwError(err, currentRequest.httpResponse) if err
    res = soap.response({
      id : cwmpRequest.id,
      methodResponse : rpcResponse,
      cwmpVersion : currentRequest.sessionData.cwmpVersion
    })

    if !!cookiesPath = config.get('COOKIES_PATH', currentRequest.sessionData.deviceId)
      res.headers['Set-Cookie'] = "session=#{currentRequest.sessionData.sessionId}; Path=#{cookiesPath}"
    else
      res.headers['Set-Cookie'] = "session=#{currentRequest.sessionData.sessionId}"

    writeResponse(currentRequest, res)
  )


transferComplete = (currentRequest, cwmpRequest) ->
  session.transferComplete(currentRequest.sessionData, cwmpRequest.methodRequest, (err, rpcResponse, fault, operation) ->
    return throwError(err, currentRequest.httpResponse) if err

    if fault
      for k, v of operation.retries
        currentRequest.sessionData.retries[k] = v

      recordFault(currentRequest.sessionData, fault, operation.provisions, operation.channels)

    res = soap.response({
      id : cwmpRequest.id,
      methodResponse : rpcResponse,
      cwmpVersion : currentRequest.sessionData.cwmpVersion
    })
    writeResponse(currentRequest, res)
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


applyPresets = (currentRequest) ->
  sessionData = currentRequest.sessionData

  cache.getPresets((err, presetsHash, presets) ->
    return throwError(err, currentRequest.httpResponse) if err

    # Filter presets based on existing faults
    blackList = {}
    whiteList = null
    whiteListProvisions = null

    RETRY_DELAY = config.get('RETRY_DELAY', sessionData.deviceId)

    if sessionData.faults?
      for channel, fault of sessionData.faults
        if fault.retryNow
          retryTimestamp = 0
        else
          retryTimestamp = fault.timestamp + (RETRY_DELAY * Math.pow(2, sessionData.retries[channel])) * 1000

        if retryTimestamp <= sessionData.timestamp
          whiteList = channel
          whiteListProvisions = fault.provisions
          break

        blackList[channel] = if fault.precondition then 1 else 2

    sessionData.presetsHash = presetsHash

    deviceEvents = {}
    iter = sessionData.deviceData.paths.subset(['Events', '*'])
    while (p = iter.next().value)
      if sessionData.timestamp <= sessionData.deviceData.attributes.get(p)?.value?[1][0]
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
        (preset.schedule.schedule and testSchedule(preset.schedule, sessionData.timestamp)[0]))

      filteredPresets.push(preset)
      for k of preset.precondition
        sessionData.channels[preset.channel] = 0
        p = k.split(/([^a-zA-Z0-9\-\_\.].*)/, 1)[0]
        parameters[p] = common.parsePath(p)

    declarations = []
    for k, v of parameters
      declarations.push([v, 1, {value: 1}])

    session.rpcRequest(sessionData, declarations, (err, fault, id, rpcRequest) ->
      return throwError(err, currentRequest.httpResponse) if err

      if fault
        recordFault(sessionData, fault, sessionData.provisions, sessionData.channels)
        session.clearProvisions(sessionData)
        return applyPresets(currentRequest)

      if rpcRequest?
        return sendRpcRequest(currentRequest, id, rpcRequest)

      session.clearProvisions(sessionData)

      for k, v of parameters
        unpacked = device.unpack(sessionData.deviceData, v)
        if unpacked[0] and (vv = sessionData.deviceData.attributes.get(unpacked[0]).value?[1])?
          parameters[k] = vv[0]
        else
          delete parameters[k]

      if whiteList?
        session.addProvisions(sessionData, whiteList, whiteListProvisions)

      appendProvisionsToFaults = {}
      for p in filteredPresets
        if query.testFilter(parameters, p.precondition)
          if blackList[p.channel] == 2
            appendProvisionsToFaults[p.channel] =
              (appendProvisionsToFaults[p.channel] or []).concat(p.provisions)
          else
            session.addProvisions(sessionData, p.channel, p.provisions)

      for channel, provisions of appendProvisionsToFaults
        if appendProvisions(sessionData.faults[channel].provisions, provisions)
          sessionData.faultsTouched ?= {}
          sessionData.faultsTouched[channel] = true

      sessionData.presetCycles = (sessionData.presetCycles or 0) + 1

      if sessionData.presetCycles > MAX_CYCLES
        fault = {
          code: 'endless_cycle'
          message: 'The provision seems to be repeating indefinitely'
          timestamp: sessionData.timestamp
        }
        recordFault(sessionData, fault, sessionData.provisions, sessionData.channels)
        session.clearProvisions(sessionData)
        return sendRpcRequest(currentRequest)

      session.rpcRequest(sessionData, null, (err, fault, id, rpcRequest) ->
        return throwError(err, currentRequest.httpResponse) if err

        if fault
          recordFault(sessionData, fault, sessionData.provisions, sessionData.channels)
          session.clearProvisions(sessionData)
          return applyPresets(currentRequest)

        if not rpcRequest?
          for channel, flags of sessionData.channels
            if channel of sessionData.faults
              delete sessionData.faults[channel]
              sessionData.faultsTouched ?= {}
              sessionData.faultsTouched[channel] = true

          if whiteList?
            return applyPresets(currentRequest)

        sendRpcRequest(currentRequest, id, rpcRequest)
      )
    )
  )


nextRpc = (currentRequest) ->
  session.rpcRequest(currentRequest.sessionData, null, (err, fault, id, rpcRequest) ->
    return throwError(err, currentRequest.httpResponse) if err

    if fault
      recordFault(currentRequest.sessionData, fault, currentRequest.sessionData.provisions, currentRequest.sessionData.channels)
      session.clearProvisions(currentRequest.sessionData)
      return nextRpc(currentRequest)

    if rpcRequest?
      return sendRpcRequest(currentRequest, id, rpcRequest)

    for channel, flags of currentRequest.sessionData.channels
      if flags and channel of currentRequest.sessionData.faults
        delete currentRequest.sessionData.faults[channel]
        currentRequest.sessionData.faultsTouched ?= {}
        currentRequest.sessionData.faultsTouched[channel] = true

      if channel.startsWith('task_')
        taskId = channel.slice(5)
        currentRequest.sessionData.doneTasks ?= []
        currentRequest.sessionData.doneTasks.push(taskId)
        for t, j in currentRequest.sessionData.tasks
          if t._id == taskId
            currentRequest.sessionData.tasks.splice(j, 1)
            break

    session.clearProvisions(currentRequest.sessionData)

    for task in currentRequest.sessionData.tasks
      channel = "task_#{task._id}"

      # Delete if expired
      if task.expiry <= currentRequest.sessionData.timestamp
        util.log("#{currentRequest.sessionData.deviceId}: Task is expired #{task.name}(#{task._id})")
        currentRequest.sessionData.doneTasks ?= []
        currentRequest.sessionData.doneTasks.push(String(task._id))
        if channel of currentRequest.sessionData.faults
          delete currentRequest.sessionData.faults[channel]
          currentRequest.sessionData.faultsTouched ?= {}
          currentRequest.sessionData.faultsTouched[channel] = true
        continue

      if currentRequest.sessionData.faults[channel]
        continue

      switch task.name
        when 'getParameterValues'
          for p in task.parameterNames
            session.addProvisions(currentRequest.sessionData, "task_#{task._id}",
              [['refresh', p]])
        when 'setParameterValues'
          for p in task.parameterValues
            session.addProvisions(currentRequest.sessionData, "task_#{task._id}",
              [['value', p[0], p[1]]])
        when 'refreshObject'
          session.addProvisions(currentRequest.sessionData, "task_#{task._id}",
            [['refresh', task.objectName]])
        when 'reboot'
          session.addProvisions(currentRequest.sessionData, "task_#{task._id}",
            [['reboot']])
        when 'factoryReset'
          session.addProvisions(currentRequest.sessionData, "task_#{task._id}",
            [['reset']])
        when 'download'
          session.addProvisions(currentRequest.sessionData, "task_#{task._id}",
            [['download', task.fileType, task.fileName, task.targetFileName]])
        when 'addObject'
          alias = ("#{p[0]}:#{JSON.stringify(p[1])}" for p in task.parameterValues or []).join(',')
          session.addProvisions(currentRequest.sessionData, "task_#{task._id}",
            [['instances', "#{task.objectName}.[#{alias}]", "+1"]]);
        when 'deleteObject'
          session.addProvisions(currentRequest.sessionData, "task_#{task._id}",
            [['instances', task.objectName, 0]]);
        else
          return throwError(new Error('Task name not recognized'), currentRequest.httpResponse) if err

      return nextRpc(currentRequest)

    return applyPresets(currentRequest)
  )


sendRpcRequest = (currentRequest, id, rpcRequest) ->
  if not rpcRequest?
    session.end(currentRequest.sessionData, (err, isNew) ->
      return throwError(err, currentRequest.httpResponse) if err

      delete currentSessions.get(currentRequest.httpRequest.connection)[currentRequest.sessionData.sessionId]
      if isNew
        util.log("#{currentRequest.sessionData.deviceId}: New device registered")

      db.clearTasks(currentRequest.sessionData.deviceId, currentRequest.sessionData.doneTasks, (err) ->
        return throwError(err, currentRequest.httpResponse) if err

        counter = 3

        for k of currentRequest.sessionData.faultsTouched
          counter += 2
          if currentRequest.sessionData.faults[k]
            currentRequest.sessionData.faults[k].retries = currentRequest.sessionData.retries[k]
            db.saveFault(currentRequest.sessionData.deviceId, k, currentRequest.sessionData.faults[k], (err) ->
              if err
                throwError(err, currentRequest.httpResponse) if counter & 1
                return counter = 0

              if (counter -= 2) == 1
                return writeResponse(currentRequest, soap.response(null))
            )
          else
            db.deleteFault(currentRequest.sessionData.deviceId, k, (err) ->
              if err
                throwError(err, currentRequest.httpResponse) if counter & 1
                return counter = 0

              if (counter -= 2) == 1
                return writeResponse(currentRequest, soap.response(null))
            )

        if (counter -= 2) == 1
          return writeResponse(currentRequest, soap.response(null))
      )
    )
    return

  if rpcRequest.type is 'Download'
    if not rpcRequest.url?
      FS_PORT = config.get('FS_PORT')
      FS_IP = config.get('FS_IP')
      FS_SSL = config.get('FS_SSL')
      rpcRequest.url = if FS_SSL then 'https://' else 'http://'
      rpcRequest.url += FS_IP
      rpcRequest.url += ":#{FS_PORT}" if FS_PORT != 80
      rpcRequest.url += "/#{encodeURIComponent(rpcRequest.fileName)}"

    if not rpcRequest.fileSize?
      return cache.getFiles((err, hash, files) ->
        return throwError(err, currentRequest.httpResponse) if err

        if rpcRequest.fileName of files
          rpcRequest.fileSize = files[rpcRequest.fileName].length
        else
          rpcRequest.fileSize = 0

        return sendRpcRequest(currentRequest, id, rpcRequest)
      )

  util.log("#{currentRequest.sessionData.deviceId}: #{rpcRequest.type} (#{id})")

  res = soap.response({
    id : id,
    methodRequest : rpcRequest,
    cwmpVersion : currentRequest.sessionData.cwmpVersion
  })

  writeResponse(currentRequest, res)


getSession = (httpRequest, callback) ->
  # Separation by comma is important as some devices don't comform to standard
  COOKIE_REGEX = /\s*([a-zA-Z0-9\-_]+?)\s*=\s*"?([a-zA-Z0-9\-_]*?)"?\s*(,|;|$)/g
  while match = COOKIE_REGEX.exec(httpRequest.headers.cookie)
    sessionId = match[2] if match[1] == 'session'

  return callback() if not sessionId?

  sessionData = currentSessions.get(httpRequest.connection)?[sessionId]

  if sessionData?
    return callback(null, sessionData)

  setTimeout(() ->
    db.redisClient.eval('local v=redis.call("get",KEYS[1]);redis.call("del",KEYS[1]);return v;', 1, "session_#{sessionId}", (err, sessionDataString) ->
      return callback(err) if err or not sessionDataString
      session.deserialize(sessionDataString, (err, sessionData) ->
        return callback(err) if err
        currentSessions.get(httpRequest.connection)[sessionId] = sessionData
        callback(null, sessionData)
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
    for sessionId, sessionData of sessions
      session.serialize(sessionData, (err, sessionDataString) ->
        return throwError(err) if err
        # TODO don't set if process is shutting down
        db.redisClient.setex("session_#{sessionId}", sessionData.timeout, sessionDataString, (err) ->
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
    cwmpRequest = null
    getSession(httpRequest, f = (err, sessionData) ->
      return throwError(err, httpResponse) if err
      cwmpRequest ?= soap.request(httpRequest, sessionData?.cwmpVersion)
      if not sessionData?
        if cwmpRequest.methodRequest?.type isnt 'Inform'
          httpResponse.writeHead(400)
          httpResponse.end('Session is expired')
          return

        deviceId = common.generateDeviceId(cwmpRequest.methodRequest.deviceId)
        return session.init(deviceId, cwmpRequest.cwmpVersion, cwmpRequest.sessionTimeout ? config.get('SESSION_TIMEOUT', deviceId), (err, sessionData) ->
          return throwError(err, httpResponse) if err

          sessionData.sessionId = crypto.randomBytes(8).toString('hex')

          currentSessions.get(httpRequest.connection)[sessionData.sessionId] = sessionData

          httpRequest.connection.setTimeout(sessionData.timeout * 1000)

          db.getDueTasksAndFaultsAndOperations(deviceId, sessionData.timestamp, (err, dueTasks, faults, operations) ->
            return throwError(err, httpResponse) if err
            sessionData.tasks = dueTasks
            sessionData.faults = faults
            sessionData.retries = {}
            for k, v of faults
              sessionData.retries[k] = v.retries
            sessionData.operations = operations

            # Delete expired faults
            for k, v of sessionData.faults
              if v.expiry >= sessionData.timestamp
                delete sessionData.faults[k]
                sessionData.faultsTouched ?= {}
                sessionData.faultsTouched[k] = true

            f(null, sessionData)
          )
        )

      currentRequest = {
        httpRequest : httpRequest,
        httpResponse : httpResponse,
        sessionData : sessionData
      }

      if config.get('DEBUG', currentRequest.sessionData.deviceId)
        dump = "# REQUEST #{new Date(Date.now())}\n" + JSON.stringify(httpRequest.headers) + "\n#{httpRequest.getBody()}\n\n"
        require('fs').appendFile("./debug/#{currentRequest.sessionData.deviceId}.dump", dump, (err) ->
          return throwError(err) if err
        )

      if cwmpRequest.methodRequest?
        if cwmpRequest.methodRequest.type is 'Inform'
          inform(currentRequest, cwmpRequest)
        else if cwmpRequest.methodRequest.type is 'TransferComplete'
          transferComplete(currentRequest, cwmpRequest)
        else if cwmpRequest.methodRequest.type is 'GetRPCMethods'
          util.log("#{currentRequest.sessionData.deviceId}: GetRPCMethods")
          res = soap.response({
            id : cwmpRequest.id,
            methodResponse : {type : 'GetRPCMethodsResponse', methodList : ['Inform', 'GetRPCMethods', 'TransferComplete', 'RequestDownload']},
            cwmpVersion : currentRequest.sessionData.cwmpVersion
          })
          writeResponse(currentRequest, res)
        else if cwmpRequest.methodRequest.type is 'TransferComplete'
          return throwError(new Error('ACS method not supported'), currentRequest.httpResponse) if err
      else if cwmpRequest.methodResponse?
        session.rpcResponse(currentRequest.sessionData, cwmpRequest.id, cwmpRequest.methodResponse, (err) ->
          return throwError(err, currentRequest.httpResponse) if err
          nextRpc(currentRequest)
        )
      else if cwmpRequest.fault?
        session.rpcFault(currentRequest.sessionData, cwmpRequest.id, cwmpRequest.fault, (err, fault) ->
          return throwError(err, currentRequest.httpResponse) if err

          if fault
            recordFault(currentRequest.sessionData, fault, currentRequest.sessionData.provisions, currentRequest.sessionData.channels)
            session.clearProvisions(currentRequest.sessionData)
          nextRpc(currentRequest)
        )
      else # CPE sent empty response
        session.timeoutOperations(currentRequest.sessionData, (err, faults, operations) ->
          return throwError(err, currentRequest.httpResponse) if err

          for fault, i in faults
            for k, v of operations[i].retries
              sessionData.retries[k] = v

            recordFault(currentRequest.sessionData, fault, operations[i].provisions, operations[i].channels)

          nextRpc(currentRequest)
        )
    )
  )


exports.listener = listener
exports.onConnection = onConnection
