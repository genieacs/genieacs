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
  return false if not address
  [host, port] = address.split(':', 2)
  if port is undefined
    port = 80
  else
    port = parseInt(port)
    return false if isNaN(port)

  ts = Math.trunc(Date.now() / 1000)
  id = Math.trunc(Math.random() * 4294967295)
  cn = crypto.randomBytes(8).toString('hex')
  sig = crypto.createHmac('sha1', key).update("#{ts}#{id}#{un}#{cn}").digest('hex')
  uri = "http://#{address}?ts=#{ts}&id=#{id}&un=#{un}&cn=#{cn}&sig=#{sig}"

  message = Buffer.from("GET #{uri} HTTP/1.1\r\nHost: #{address}\r\n\r\n")

  client = dgram.createSocket({type:'udp4', reuseAddr:true})
  if config.get("UDP_CONNECTION_REQUEST_PORT")
    # When a device is NAT'ed, the UDP Connection Request must originate from the same address and port used by the STUN server, in order to traverse the firewall.
    # This does require that the Genieacs NBI and STUN server are allowed to bind to the same address and port.
    # The STUN server needs to open its UDP port with the SO_REUSEADDR option, allowing the NBI to also bind to the same port.
    client.bind({port: config.get("UDP_CONNECTION_REQUEST_PORT")})

  count = 3
  client.send(message, 0, message.length, port, host, f = (err) ->
    if err or -- count <= 0
      client.close()
      return callback(err)
    client.send(message, 0, message.length, port, host, f)
  )
  return true


httpConReq = (url, username, password, timeout, callback) ->
  options = URL.parse(url)
  # Ensure socket is reused in case of digest authentication
  options.agent = new http.Agent({maxSockets : 1})

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

  request = http.get(options, (res) ->
    if res.statusCode == 401 and res.headers['www-authenticate']?
      authHeader = auth.parseAuthHeader(res.headers['www-authenticate'])
      if authHeader.method is 'Basic'
        options.headers = {'Authorization' : auth.basic(username or '', password or '')}
      else if authHeader.method is 'Digest'
        options.headers = {
          'Authorization' : auth.digest(username or '', password or '', options.path, 'GET', null, authHeader)
        }

      request = http.get(options, (res) ->
        if res.statusCode == 0
          # Workaround for some devices unexpectedly closing the connection
          request = http.get(options, (res) ->
            callback(statusToError(res.statusCode))
            res.resume()
          ).on('error', (err) ->
            request.abort()
            callback(statusToError(0))
          ).on('socket', (socket) ->
            socket.setTimeout(timeout)
            socket.on('timeout', () -> request.abort())
          )
        else
          callback(statusToError(res.statusCode))
        res.resume()
      ).on('error', (err) ->
        request.abort()
        callback(statusToError(0))
      ).on('socket', (socket) ->
        socket.setTimeout(timeout)
        socket.on('timeout', () -> request.abort())
      )
    else
      callback(statusToError(res.statusCode))

    # No listener for data so emit resume
    res.resume()
  ).on('error', (err) ->
    request.abort()
    callback(statusToError(0))
  ).on('socket', (socket) ->
    socket.setTimeout(timeout)
    socket.on('timeout', () -> request.abort())
  )


connectionRequest = (deviceId, callback) ->
  CONNECTION_REQUEST_TIMEOUT = config.get('CONNECTION_REQUEST_TIMEOUT', deviceId)
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
    return callback(err) if err

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

    conReq = () ->
      udpSent = udpConReq(udpConnectionRequestAddress, username, password, (err) -> throw err if err)

      httpConReq(connectionRequestUrl, username, password, CONNECTION_REQUEST_TIMEOUT, (err) ->
        if udpSent
          return callback()
        callback(err)
      )

    if config.auth?.connectionRequest?
      # Callback is optional for backward compatibility
      if config.auth.connectionRequest.length > 4
        return config.auth.connectionRequest(deviceId, connectionRequestUrl, username, password, (u, p) ->
          username = u
          password = p
          conReq()
        )
      [username, password] = config.auth.connectionRequest(deviceId, connectionRequestUrl, username, password)
    conReq()
  )


watchTask = (deviceId, taskId, options, callback) ->
  options = options || {}
  delay = options.delay || 500
  timeout = options.timeout || 3600
  makeConnectionRequest = options.makeConnectionRequest || false

  setTimeout(() ->
    db.tasksCollection.findOne({_id : taskId}, {'_id' : 1}, (err, task) ->
      return callback(err) if err

      if not task
        return callback(null, 'completed')

      db.faultsCollection.findOne({_id : "#{deviceId}:task_#{taskId}"}, {'_id' : 1}, (err, fault) ->
        return callback(err) if err

        if fault
          return callback(null, 'fault')

        if (timeout -= delay) <= 0
          return callback(null, 'timeout')

        if (makeConnectionRequest)
          connectionRequest(deviceId, () ->)

        options.timeout = timeout
        watchTask(deviceId, taskId, options, callback)
      )
    )
  , delay)


sanitizeTask = (task, callback) ->
  task.timestamp = new Date(task.timestamp ? Date.now())
  if task.expiry?
    if common.typeOf(task.expiry) is common.DATE_TYPE or isNaN(task.expiry)
      task.expiry = new Date(task.expiry)
    else
      task.expiry = new Date(task.timestamp.getTime() + +task.expiry * 1000)

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
          db.redisClient.del("#{deviceId}_presets_hash",
            "#{deviceId}_inform_hash",
            "#{deviceId}_faults",
            "#{deviceId}_tasks",
            "#{deviceId}_operations",
            callback)
        )
      )
    )
  )


exports.connectionRequest = connectionRequest
exports.watchTask = watchTask
exports.insertTasks = insertTasks
exports.deleteDevice = deleteDevice
