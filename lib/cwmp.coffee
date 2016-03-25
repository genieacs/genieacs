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

config = require './config'
common = require './common'
soap = require './soap'
session = require './session'
query = require './query'
device = require './device'
cache = require './cache'


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


applyPresets = (currentRequest) ->
  cache.getPresets((err, presetsHash, presets) ->
    throw err if err

    currentRequest.sessionData.presetsHash = presetsHash

    parameters = {}
    for p in presets
      for a in Object.keys(query.queryProjection(p.precondition))
        parameters[a] = common.parsePath(a)

    declarations = []
    for k, v of parameters
      declarations.push([v, 1, null, null, null, null, null, 1])

    session.rpcRequest(currentRequest.sessionData, declarations, (err, id, rpcRequest) ->
      throw err if err

      if rpcRequest?
        return sendRpcRequest(currentRequest, id, rpcRequest)

      for k, v of parameters
        if (vv = device.getAll(currentRequest.sessionData.deviceData, v)[0]?[8]?[0])
          parameters[k] = vv

      for p in presets
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
    if not rpcRequest?
      session.clearProvisions(currentRequest.sessionData)
      return applyPresets(currentRequest)

    sendRpcRequest(currentRequest, id, rpcRequest)
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
    getSession(httpRequest, (sessionId, sessionData) ->
      cwmpRequest = soap.request(httpRequest, session?.cwmpVersion)
      if not sessionData?
        if cwmpRequest.methodRequest?.type isnt 'Inform'
          httpResponse.writeHead(400)
          httpResponse.end('Session is expired')
          return

        deviceId = common.generateDeviceId(cwmpRequest.methodRequest.deviceId)
        sessionData = session.init(deviceId, cwmpRequest.cwmpVersion, cwmpRequest.sessionTimeout ? config.get('SESSION_TIMEOUT', deviceId))
        httpRequest.connection.setTimeout(sessionData.timeout * 1000)

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
