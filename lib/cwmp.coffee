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
mongodb = require 'mongodb'

config = require './config'
common = require './common'
soap = require './soap'
session = require './session'
query = require './query'
device = require './device'
cache = require './cache'
db = require './db'


writeResponse = (currentRequest, res) ->
  if config.get('DEBUG', currentRequest.sessionData.deviceId)
    dump = "# RESPONSE #{new Date(Date.now())}\n" + JSON.stringify(res.headers) + "\n#{res.data}\n\n"
    require('fs').appendFile("./debug/#{currentRequest.sessionData.deviceId}.dump", dump, (err) ->
      throw err if err
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
      res.headers['Content-Length'] = data.length
      currentRequest.httpResponse.writeHead(res.code, res.headers)
      currentRequest.httpResponse.end(data)
    )
  else
    res.headers['Content-Length'] = res.data.length
    currentRequest.httpResponse.writeHead(res.code, res.headers)
    currentRequest.httpResponse.end(res.data)


inform = (currentRequest, cwmpRequest) ->
  if config.get('LOG_INFORMS', currentRequest.sessionData.deviceId)
    util.log("#{currentRequest.sessionData.deviceId}: Inform (#{cwmpRequest.methodRequest.event}); retry count #{cwmpRequest.methodRequest.retryCount}")

  session.inform(currentRequest.sessionData, cwmpRequest.methodRequest, (err, rpcResponse) ->
    throw err if err
    res = soap.response({
      id : cwmpRequest.id,
      methodResponse : rpcResponse,
      cwmpVersion : currentRequest.sessionData.cwmpVersion
    })

    session.save(currentRequest.sessionData, (err, sessionId) ->
      throw err if err
      if !!cookiesPath = config.get('COOKIES_PATH', currentRequest.sessionData.deviceId)
        res.headers['Set-Cookie'] = "session=#{sessionId}; Path=#{cookiesPath}"
      else
        res.headers['Set-Cookie'] = "session=#{sessionId}"

      writeResponse(currentRequest, res)
    )
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


applyPresets = (currentRequest) ->
  cache.getPresets((err, presetsHash, presets) ->
    throw err if err

    currentRequest.sessionData.presetsHash = presetsHash

    deviceEvents = {}
    iter = currentRequest.sessionData.deviceData.paths.subset(['Events', '*'])
    while (p = iter.next().value)
      if currentRequest.sessionData.timestamp == currentRequest.sessionData.deviceData.values.value.get(p)?[0]
        deviceEvents[p[1]] = true

    parameters = {}
    filteredPresets = []
    for p in presets
      eventsMatch = true
      for k, v of p.events
        if !v != !deviceEvents[k.replace(' ', '_')]
          eventsMatch = false
          break

      continue if not eventsMatch or (p.schedule and not
        (p.schedule.schedule and testSchedule(p.schedule, currentRequest.sessionData.timestamp)[0]))

      filteredPresets.push(p)
      for a in Object.keys(query.queryProjection(p.precondition))
        parameters[a] = common.parsePath(a)

    declarations = []
    for k, v of parameters
      declarations.push([v, {exist: 1, value: 1}])

    session.rpcRequest(currentRequest.sessionData, declarations, (err, id, rpcRequest) ->
      throw err if err

      if rpcRequest?
        return sendRpcRequest(currentRequest, id, rpcRequest)

      for k, v of parameters
        unpacked = device.unpack(currentRequest.sessionData.deviceData, v)
        if unpacked[0] and (vv = deviceData.values.value.get(unpacked[0]))?
          parameters[k] = vv[0]

      for p in filteredPresets
        if query.test(parameters, p.precondition)
          session.addProvisions(currentRequest.sessionData, p.provisions)

      session.rpcRequest(currentRequest.sessionData, null, (err, id, rpcRequest) ->
        throw err if err
        if not rpcRequest?
          session.clearProvisions(currentRequest.sessionData)
        sendRpcRequest(currentRequest, id, rpcRequest)
      )
    )
  )


nextRpc = (currentRequest) ->
  session.rpcRequest(currentRequest.sessionData, null, (err, id, rpcRequest) ->
    throw err if err
    if rpcRequest?
      return sendRpcRequest(currentRequest, id, rpcRequest)

    doneTasks = null
    for p in currentRequest.sessionData.provisions when p[0] == '_task'
      doneTasks ?= []
      doneTasks.push(mongodb.ObjectID(p[1]))

    session.clearProvisions(currentRequest.sessionData)

    # No need to query for pending tasks if there was none in previous cycle
    if not doneTasks? and currentRequest.sessionData.provisions?.length
      return applyPresets(currentRequest)

    nextTask = () ->
      cur = db.tasksCollection.find({'device' : currentRequest.sessionData.deviceId, timestamp : {$lte : new Date(currentRequest.sessionData.timestamp)}}).sort(['timestamp']).limit(1)
      cur.nextObject((err, task) ->
        if not task?
          return applyPresets(currentRequest)

        switch task.name
          when 'getParameterValues'
            session.addProvisions(currentRequest.sessionData, [['_task', task._id, 'getParameterValues'].concat(task.parameterNames)])
          when 'setParameterValues'
            t = ['_task', task._id, 'setParameterValues']
            for p in task.parameterValues
              t.push(p[0])
              t.push(p[1])
              t.push(p[2] ? '')
            session.addProvisions(currentRequest.sessionData, [t])
          when 'refreshObject'
            session.addProvisions(currentRequest.sessionData, [['_task', task._id, 'refreshObject', task.objectName]])
          else
            throw new Error('Task name not recognized')

        return nextRpc(currentRequest)
      )

    if not doneTasks?
      return nextTask()

    db.tasksCollection.remove({'_id' : {'$in' : doneTasks}}, (err, res) ->
      throw err if err
      return nextTask()
    )
  )


sendRpcRequest = (currentRequest, id, rpcRequest) ->
  if not rpcRequest?
    session.end(currentRequest.sessionData, (err, isNew) ->
      throw err if err
      if isNew
        util.log("#{currentRequest.sessionData.deviceId}: New device registered")

      writeResponse(currentRequest, soap.response(null))
    )
    return

  util.log("#{currentRequest.sessionData.deviceId}: #{rpcRequest.type} (#{id})")

  res = soap.response({
    id : id,
    methodRequest : rpcRequest,
    cwmpVersion : currentRequest.sessionData.cwmpVersion
  })

  session.save(currentRequest.sessionData, (err) ->
    throw err if err
    writeResponse(currentRequest, res)
  )


getSession = (httpRequest, callback) ->
  # Separation by comma is important as some devices don't comform to standard
  COOKIE_REGEX = /\s*([a-zA-Z0-9\-_]+?)\s*=\s*"?([a-zA-Z0-9\-_]*?)"?\s*(,|;|$)/g
  while match = COOKIE_REGEX.exec(httpRequest.headers.cookie)
    sessionId = match[2] if match[1] == 'session'

  return callback() if not sessionId?

  session.load(sessionId, (err, sessionData) ->
    throw err if err
    return callback(sessionId, sessionData)
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
    getSession(httpRequest, f = (sessionId, sessionData) ->
      cwmpRequest ?= soap.request(httpRequest, sessionData?.cwmpVersion)
      if not sessionData?
        if cwmpRequest.methodRequest?.type isnt 'Inform'
          httpResponse.writeHead(400)
          httpResponse.end('Session is expired')
          return

        deviceId = common.generateDeviceId(cwmpRequest.methodRequest.deviceId)
        return session.init(deviceId, cwmpRequest.cwmpVersion, cwmpRequest.sessionTimeout ? config.get('SESSION_TIMEOUT', deviceId), (err, sessionData) ->
          throw err if err
          httpRequest.connection.setTimeout(sessionData.timeout * 1000)
          f(null, sessionData)
        )

      currentRequest = {
        httpRequest : httpRequest,
        httpResponse : httpResponse,
        sessionData : sessionData
      }

      if config.get('DEBUG', currentRequest.sessionData.deviceId)
        dump = "# REQUEST #{new Date(Date.now())}\n" + JSON.stringify(httpRequest.headers) + "\n#{httpRequest.getBody()}\n\n"
        require('fs').appendFile("./debug/#{currentRequest.sessionData.deviceId}.dump", dump, (err) ->
          throw err if err
        )

      if cwmpRequest.methodRequest?
        if cwmpRequest.methodRequest.type is 'Inform'
          inform(currentRequest, cwmpRequest)
        else if cwmpRequest.methodRequest.type is 'GetRPCMethods'
          util.log("#{currentRequest.sessionData.deviceId}: GetRPCMethods")
          res = soap.response({
            id : cwmpRequest.id,
            methodResponse : {type : 'GetRPCMethodsResponse', methodList : ['Inform', 'GetRPCMethods', 'TransferComplete', 'RequestDownload']},
            cwmpVersion : currentRequest.sessionData.cwmpVersion
          })
          session.save(currentRequest.sessionData, (err) ->
            throw err if err
            writeResponse(currentRequest, res)
          )
        else if cwmpRequest.methodRequest.type is 'TransferComplete'
          throw new Error('ACS method not supported')
      else if cwmpRequest.methodResponse?
        session.rpcResponse(currentRequest.sessionData, cwmpRequest.id, cwmpRequest.methodResponse, (err) ->
          throw err if err
          nextRpc(currentRequest)
        )
      else if cwmpRequest.fault?
        session.rpcFault(sessionData, cwmpRequest.id, cwmpRequest.fault, (err) ->
          nextRpc(currentRequest)
        )
      else
        # cpe sent empty response. add presets
        nextRpc(currentRequest)
    )
  )


exports.listener = listener
