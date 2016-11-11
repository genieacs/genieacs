###
# Copyright 2013, 2014  Zaid Abdulla
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

crypto = require 'crypto'
dgram = require 'dgram'

config = require './config'
db = require './db'
http = require 'http'
common = require './common'
util = require 'util'
URL = require 'url'
auth = require './auth'

udpConReq = (address, un, key, callback) ->
  [host, port] = address.split(':', 2)

  ts = Math.trunc(Date.now() / 1000)
  id = Math.trunc(Math.random() * 4294967295)
  cn = crypto.randomBytes(8).toString('hex')
  sig = crypto.createHmac('sha1', key).update("#{ts}#{id}#{un}#{cn}").digest('hex')
  uri = "http://#{address}?ts=#{ts}&id=#{id}&un=#{un}&cn=#{cn}&sig=#{sig}"

  message = Buffer.from("GET #{uri} HTTP/1.1\r\nHost: #{host}:#{port}\r\n\r\n")

  client = dgram.createSocket('udp4')

  count = 3
  client.send(message, 0, message.length, port, host, f = (err) ->
    if err or -- count <= 0
      client.close()
      return callback(err)
    client.send(message, 0, message.length, port, host, f)
  )


connectionRequest = (deviceId, callback) ->
  # ensure socket is reused in case of digest authentication
  agent = new http.Agent({maxSockets : 1})

  statusToError = (statusCode) ->
    switch statusCode
      when 200, 204
        null
      when 401
        new Error('Incorrect connection request credentials')
      when 0
        new Error('Device is offline')
      else
        new Error("Unexpected response code from device: #{statusCode}")

  conReq = (url, authString, callback) ->
    options = URL.parse(url)
    options.agent = agent

    if authString
      options.headers = {'Authorization' : authString}

    request = http.get(options, (res) ->
      if res.statusCode == 401 and res.headers['www-authenticate']?
        authHeader = auth.parseAuthHeader(res.headers['www-authenticate'])
      callback(res.statusCode, authHeader)
      # don't need body, go ahead and emit events to free up the socket for possible reuse
      res.resume()
    )

    request.on('error', (err) ->
      # error event when request is aborted
      request.abort()
      callback(0)
    )

    request.on('socket', (socket) ->
      socket.setTimeout(2000)
      socket.on('timeout', () ->
        request.abort()
      )
    )

  proj = {
    'Device.ManagementServer.ConnectionRequestURL._value' : 1,
    'Device.ManagementServer.UDPConnectionRequestAddress._value' : 1,
    'Device.ManagementServer.ConnectionRequestUsername._value' : 1,
    'Device.ManagementServer.ConnectionRequestPassword._value' : 1,
    'InternetGatewayDevice.ManagementServer.ConnectionRequestURL._value' : 1,
    'InternetGatewayDevice.ManagementServer.UDPConnectionRequestAddress._value' : 1,
    'InternetGatewayDevice.ManagementServer.ConnectionRequestUsername._value' : 1,
    'InternetGatewayDevice.ManagementServer.ConnectionRequestPassword._value' : 1
  }

  db.devicesCollection.findOne({_id : deviceId}, proj, (err, device)->
    if err
      callback(err)
      return

    if device.Device? # TR-181 data model
      connectionRequestUrl = device.Device.ManagementServer.ConnectionRequestURL._value
      udpConnectionRequestAddress = device.Device.ManagementServer?.UDPConnectionRequestAddress?._value
      username = device.Device.ManagementServer.ConnectionRequestUsername?._value
      password = device.Device.ManagementServer.ConnectionRequestPassword?._value
    else # TR-098 data model
      connectionRequestUrl = device.InternetGatewayDevice.ManagementServer.ConnectionRequestURL._value
      udpConnectionRequestAddress = device.InternetGatewayDevice.ManagementServer?.UDPConnectionRequestAddress?._value
      username = device.InternetGatewayDevice.ManagementServer.ConnectionRequestUsername?._value
      password = device.InternetGatewayDevice.ManagementServer.ConnectionRequestPassword?._value

    if not (username and password) and config.auth?.connectionRequest
      [username, password] = config.auth.connectionRequest(deviceId)

    if udpConnectionRequestAddress
      udpConReq(udpConnectionRequestAddress, username, password, (err) -> throw err if err)

    # for testing
    #connectionRequestUrl = connectionRequestUrl.replace(/^(http:\/\/)([0-9\.]+)(\:[0-9]+\/[a-zA-Z0-9]+\/?$)/, '$110.1.1.254$3')
    conReq(connectionRequestUrl, null, (statusCode, authHeader) ->
      if statusCode == 401
        if authHeader.method is 'Basic'
          authString = auth.basic(username, password)
        else if authHeader.method is 'Digest'
          uri = URL.parse(connectionRequestUrl)
          authString = auth.digest(username, password, uri.path, 'GET', null, authHeader)

        conReq(connectionRequestUrl, authString, (statusCode, authHeader) ->
          if statusCode == 0
            # Workaround for some devices unexpectedly closing the connection
            return conReq(connectionRequestUrl, authString, (statusCode) -> callback(statusToError(statusCode)))
          callback(statusToError(statusCode))
        )
      else if udpConnectionRequestAddress
        return callback()
      else
        callback(statusToError(statusCode))
    )
  )


watchTask = (taskId, timeout, callback) ->
  setTimeout( () ->
    db.tasksCollection.findOne({_id : taskId}, {'_id' : 1, 'fault' : 1}, (err, task) ->
      return callback(err) if err

      if task
        timeout -= 500
        if task.fault?
          callback(null, 'fault')
        else if timeout <= 0
          callback(null, 'timeout')
        else
          watchTask(taskId, timeout, callback)
      else
        callback(null, 'completed')
    )
  , 500)


sanitizeTask = (task, callback) ->
  task.timestamp = new Date(task.timestamp ? Date.now())
  if task.expiry?
    if common.typeOf(task.expiry) is common.DATE_TYPE or isNaN(task.expiry)
      task.expiry = new Date(task.expiry)
    else
      task.expiry = new Date(task.timestamp.getTime() + +task.expiry * 1000)

  switch task.name
    when 'getParameterValues'
      projection = {}
      for p in task.parameterNames
        projection[p] = 1
      db.devicesCollection.findOne({_id : task.device}, projection, (err, device) ->
        parameterNames = []
        for k of projection
          if common.getParamValueFromPath(device, k)?
            parameterNames.push(k)
        task.parameterNames = parameterNames
        callback(task)
      )
    when 'setParameterValues'
      projection = {}
      values = {}
      for p in task.parameterValues
        projection[p[0]] = 1
        values[p[0]] = p[1]
      db.devicesCollection.findOne({_id : task.device}, projection, (err, device) ->
        parameterValues = []
        for k of projection
          param = common.getParamValueFromPath(device, k)
          if param?
            parameterValues.push([k, values[k], param._type])
        task.parameterValues = parameterValues
        callback(task)
      )
    else
      # TODO implement setParameterValues
      callback(task)


insertTasks = (tasks, callback) ->
  if tasks? and common.typeOf(tasks) isnt common.ARRAY_TYPE
    tasks = [tasks]
  else if not tasks? or tasks.length == 0
    return callback(tasks)

  counter = tasks.length

  for task in tasks
    sanitizeTask(task, (t) ->
      if t.uniqueKey?
        db.tasksCollection.remove({device : t.device, uniqueKey : t.uniqueKey}, (err) ->
        )

      --counter
      if counter == 0
        db.tasksCollection.insert(tasks, (err, _tasks) ->
          #util.log("#{_task.device}: Added task #{_task.name}(#{_task._id})") for _task in _tasks
          callback(err, _tasks)
        )
    )


deleteDevice = (deviceId, callback) ->
  db.tasksCollection.remove({'device' : deviceId}, (err) ->
    return callback(err) if err
    db.devicesCollection.remove({'_id' : deviceId}, (err) ->
      return callback(err) if err
      db.faultsCollection.remove({'_id' : {'$regex' : "^#{common.escapeRegExp(deviceId)}\\:"}}, (err) ->
        return callback(err) if err
        db.operationsCollection.remove({'_id' : {'$regex' : "^#{common.escapeRegExp(deviceId)}\\:"}}, (err) ->
          return callback(err) if err
          db.redisClient.del("#{deviceId}_presets_hash", "#{deviceId}_inform_hash", "#{deviceId}_faults", "#{deviceId}_no_tasks", callback)
        )
      )
    )
  )


exports.connectionRequest = connectionRequest
exports.watchTask = watchTask
exports.insertTasks = insertTasks
exports.deleteDevice = deleteDevice
