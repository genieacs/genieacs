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

config = require './config'
common = require './common'
util = require 'util'
soap = require './soap'
tasks = require './tasks'
db = require './db'
presets = require './presets'
mongodb = require 'mongodb'
apiFunctions = require './api-functions'
customCommands = require './custom-commands'
crypto = require 'crypto'
zlib = require 'zlib'
updateDevice = require './update-device'


# Used to reject new TR-069 sessions when under load
holdUntil = Date.now()


writeResponse = (currentRequest, res) ->
  if config.get('DEBUG', currentRequest.session.deviceId)
    dump = "# RESPONSE #{new Date(Date.now())}\n" + JSON.stringify(res.headers) + "\n#{res.data}\n\n"
    require('fs').appendFile("./debug/#{currentRequest.session.deviceId}.dump", dump, (err) ->
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


endSession = (currentRequest) ->
  db.redisClient.del("session_#{currentRequest.sessionId}", (err, res) ->
    throw err if err
    res = soap.response(null)
    writeResponse(currentRequest, res)
  )


inform = (currentRequest, cwmpRequest) ->
  # If overloaded, ask CPE to retry in 5 mins
  if Date.now() < holdUntil
    res = {code : 503, headers : {'Retry-After' : 300}, data : ''}
    return writeResponse(currentRequest, res)

  now = new Date(Date.now())

  if config.get('LOG_INFORMS', currentRequest.session.deviceId)
    util.log("#{currentRequest.session.deviceId}: Inform (#{cwmpRequest.methodRequest.event}); retry count #{cwmpRequest.methodRequest.retryCount}")

  parameterNames = (p[0] for p in cwmpRequest.methodRequest.parameterList)

  informHash = crypto.createHash('md5').update(JSON.stringify(parameterNames)).update(JSON.stringify(config.CUSTOM_COMMANDS)).digest('hex')

  deviceUpdates = {parameterValues : cwmpRequest.methodRequest.parameterList, informEvents : cwmpRequest.methodRequest.event}

  # Delete all pending tasks on bootstrap (e.g. factory reset)
  if '0 BOOTSTRAP' in cwmpRequest.methodRequest.event
    lastBootstrap = now
    db.tasksCollection.remove({device : currentRequest.session.deviceId}, (err, removed) ->
      throw err if err
    )

  db.redisClient.get("#{currentRequest.session.deviceId}_inform_hash", (err, oldInformHash) ->
    throw err if err

    updateAndRespond = () ->
      updateDevice.commitUpdates(currentRequest.session.deviceId, deviceUpdates, false, (err) ->
        throw err if err
        db.redisClient.setex("session_#{currentRequest.sessionId}", currentRequest.session.sessionTimeout, JSON.stringify(currentRequest.session), (err) ->
          throw err if err
          res = soap.response({
            id : cwmpRequest.id,
            methodResponse : {type : 'InformResponse'},
            cwmpVersion : cwmpRequest.cwmpVersion
          })

          if !!cookiesPath = config.get('COOKIES_PATH', currentRequest.session.deviceId)
            res.headers['Set-Cookie'] = "session=#{currentRequest.sessionId}; Path=#{cookiesPath}"
          else
            res.headers['Set-Cookie'] = "session=#{currentRequest.sessionId}"

          writeResponse(currentRequest, res)
        )
      )

    if oldInformHash == informHash and not lastBootstrap?
      return updateAndRespond()

    db.redisClient.setex("#{currentRequest.session.deviceId}_inform_hash", config.get('PRESETS_CACHE_DURATION', currentRequest.session.deviceId), informHash, (err, res) ->
      throw err if err
    )

    # populate projection and parameterStructure
    parameterStructure = {}
    projection = {}
    projection._customCommands = 1
    projection._timestamp = 1
    projection._lastBootstrap = 1
    for param in parameterNames
      ref = parameterStructure
      path = ''
      for p in param.split('.')
        ref[p] ?= {_path : path}
        ref = ref[p]
        path += p + '.'
        projection[path + '_timestamp'] = 1

    db.devicesCollection.findOne({'_id' : currentRequest.session.deviceId}, projection, (err, device) ->
      throw err if err
      lastBootstrap ?= device?._lastBootstrap
      _tasks = []

      # For any parameters that aren't in the DB model, issue a refresh task
      traverse = (reference, actual) ->
        for k of reference
          continue if k[0] == '_'
          if not actual[k]?._timestamp? or actual[k]._timestamp < lastBootstrap
            _tasks.push({device: currentRequest.session.deviceId, name : 'refreshObject', objectName : reference[k]._path, timestamp : now})
          else
            traverse(reference[k], actual[k])

      if device?
        traverse(parameterStructure, device)

        # Update custom commands if needed
        deviceCustomCommands = {}
        deviceCustomCommands[k] = v._timestamp for k,v of device._customCommands

        for cmd in customCommands.getDeviceCustomCommandNames(currentRequest.session.deviceId)
          if not (deviceCustomCommands[cmd]?._timestamp < lastBootstrap)
            # Increment timestamp by one millisecond to ensure it runs after any refresh task
            _tasks.push({device: currentRequest.session.deviceId, name: 'customCommand', command: "#{cmd} init", timestamp: new Date(now.getTime() + 1)})
          delete deviceCustomCommands[cmd]

        for cmd of deviceCustomCommands
          deviceUpdates.deletedObjects ?= []
          deviceUpdates.deletedObjects.push("_customCommands.#{cmd}")

        # clear presets hash if parameters are potentially modified
        if _tasks.length > 0
          db.redisClient.del("#{currentRequest.session.deviceId}_presets_hash", (err) ->
            throw err if err
          )

        apiFunctions.insertTasks(_tasks, {}, () ->
          updateAndRespond()
        )
      else
        deviceIdDetails = {}
        for k, v of cwmpRequest.methodRequest.deviceId
          deviceIdDetails["_#{k}"] = v

        db.devicesCollection.insert({_id : currentRequest.session.deviceId, _registered : now, _deviceId : deviceIdDetails}, (err) ->
          throw err if err
          util.log("#{currentRequest.session.deviceId}: New device registered")
          _tasks.push({device: currentRequest.session.deviceId, name : 'refreshObject', objectName : '', timestamp : now})

          for cmd in customCommands.getDeviceCustomCommandNames(currentRequest.session.deviceId)
            # Increment timestamp by one millisecond to ensure it runs after any refresh task
            _tasks.push({device: currentRequest.session.deviceId, name: 'customCommand', command: "#{cmd} init", timestamp: new Date(now.getTime() + 1)})

          apiFunctions.insertTasks(_tasks, {}, () ->
            updateAndRespond()
          )
        )
    )
  )


runTask = (currentRequest, task, methodResponse) ->
  timeDiff = process.hrtime()
  tasks.task(task, methodResponse, (err, status, methodRequest, deviceUpdates) ->
    throw err if err

    timeDiff = process.hrtime(timeDiff)[0] + 1
    if timeDiff > 3 # in seconds
      # Server under load. Hold new sessions temporarily.
      holdUntil = Math.max(Date.now() + timeDiff * 2000, holdUntil)

    save = status & tasks.STATUS_SAVE
    switch status & ~tasks.STATUS_SAVE
      when tasks.STATUS_OK
        f = () ->
          db.redisClient.setex(String(task._id), currentRequest.session.sessionTimeout, JSON.stringify(task), (err) ->
            throw err if err
            res = soap.response({
              id : task._id,
              methodRequest : methodRequest,
              cwmpVersion : currentRequest.session.cwmpVersion
            })
            writeResponse(currentRequest, res)
            updateSessionExpiry(currentRequest)
          )

        if save
          updateDevice.commitUpdates(currentRequest.session.deviceId, deviceUpdates, true, (err) ->
            throw err if err
            db.tasksCollection.update({_id : mongodb.ObjectID(String(task._id))}, {$set : {session : task.session}}, (err) ->
              throw err if err
              f()
            )
          )
        else
          updateDevice.queueUpdates(currentRequest.session.deviceId, deviceUpdates, (err) ->
            f()
          )
      when tasks.STATUS_COMPLETED
        util.log("#{currentRequest.session.deviceId}: Completed task #{task.name}(#{task._id})")
        updateDevice.commitUpdates(currentRequest.session.deviceId, deviceUpdates, true, (err) ->
          throw err if err
          db.tasksCollection.remove({'_id' : mongodb.ObjectID(String(task._id))}, (err, removed) ->
            throw err if err
            db.redisClient.del(String(task._id), (err, res) ->
              throw err if err
              nextTask(currentRequest)
            )
          )
        )
      when tasks.STATUS_FAULT
        retryAfter = config.get('RETRY_DELAY', currentRequest.session.deviceId) * Math.pow(2, task.retries ? 0)
        util.log("#{currentRequest.session.deviceId}: Fault response for task #{task._id}. Retrying after #{retryAfter} seconds.")
        taskUpdate = {fault : task.fault, timestamp : new Date(Date.now() + retryAfter * 1000)}
        if save
          taskUpdate.session = task.session

        db.tasksCollection.update({_id : mongodb.ObjectID(String(task._id))}, {$set : taskUpdate, $inc : {retries : 1}}, (err) ->
          throw err if err
          nextTask(currentRequest)
        )
      else
        throw new Error('Unknown task status')
  )


isTaskExpired = (task) ->
  task.expiry <= new Date()


assertPresets = (currentRequest) ->
  db.redisClient.mget("#{currentRequest.session.deviceId}_presets_hash", 'presets_hash', (err, res) ->
    throw err if err
    devicePresetsHash = res[0]
    presetsHash = res[1]
    if devicePresetsHash? and devicePresetsHash == presetsHash
      # no discrepancy, end the session
      endSession(currentRequest)
    else
      PRESETS_CACHE_DURATION = config.get('PRESETS_CACHE_DURATION', currentRequest.session.deviceId)
      db.getPresetsObjectsAliases((allPresets, allObjects, allAliases) ->
        if not presetsHash?
          presetsHash = presets.calculatePresetsHash(allPresets, allObjects)
          db.redisClient.setex('presets_hash', PRESETS_CACHE_DURATION, presetsHash, (err, res) ->
            throw err if err
          )

        presets.getDevicePreset(currentRequest.session.deviceId, allPresets, allObjects, allAliases, (devicePreset) ->
          presets.processDevicePreset(currentRequest.session.deviceId, devicePreset, (taskList, addTags, deleteTags, expiry) ->
            db.redisClient.setex("#{currentRequest.session.deviceId}_presets_hash", Math.floor(Math.max(1, expiry - config.get('PRESETS_TIME_PADDING'))), presetsHash, (err, res) ->
              throw err if err
            )

            if addTags.length + deleteTags.length + taskList.length
              util.log("#{currentRequest.session.deviceId}: Presets discrepancy found")

            if addTags.length + deleteTags.length
              util.log("#{currentRequest.session.deviceId}: Updating tags +(#{addTags}) -(#{deleteTags})")

            if deleteTags.length
              db.devicesCollection.update({'_id' : currentRequest.session.deviceId}, {'$pull' : {'_tags' : {'$in' : deleteTags}}}, {}, (err, count) ->
                throw err if err
              )

            if addTags.length
              db.devicesCollection.update({'_id' : currentRequest.session.deviceId}, {'$addToSet' : {'_tags' : {'$each' : addTags}}}, {}, (err, count) ->
                throw err if err
              )

            if taskList.length
              t.expiry = expiry for t in taskList
              apiFunctions.insertTasks(taskList, allAliases, (err, taskList) ->
                throw err if err
                task = taskList[0]
                util.log("#{currentRequest.session.deviceId}: Started task #{task.name}(#{task._id})")
                runTask(currentRequest, task, {})
              )
            else
              endSession(currentRequest)
          )
        )
      )
  )


nextTask = (currentRequest) ->
  now = new Date()
  cur = db.tasksCollection.find({'device' : currentRequest.session.deviceId, timestamp : {$lte : now}}).sort(['timestamp']).limit(1)
  cur.nextObject((err, task) ->
    throw err if err

    if not task
      # no more tasks, check presets discrepancy
      assertPresets(currentRequest)
    else if isTaskExpired(task)
      util.log("#{currentRequest.session.deviceId}: Task is expired #{task.name}(#{task._id})")
      db.tasksCollection.remove({'_id' : mongodb.ObjectID(String(task._id))}, {safe: true}, (err, removed) ->
        throw err if err
        nextTask(currentRequest)
      )
    else
      util.log("#{currentRequest.session.deviceId}: Started task #{task.name}(#{task._id})")
      updateDevice.clearUpdatesQueue(currentRequest.session.deviceId, (err) ->
        throw err if err
        runTask(currentRequest, task, {})
      )
  )


getSession = (httpRequest, callback) ->
  # Separation by comma is important as some devices don't comform to standard
  COOKIE_REGEX = /\s*([a-zA-Z0-9\-_]+?)\s*=\s*"?([a-zA-Z0-9\-_]*?)"?\s*(,|;|$)/g
  while match = COOKIE_REGEX.exec(httpRequest.headers.cookie)
    sessionId = match[2] if match[1] == 'session'

  return callback() if not sessionId?

  db.redisClient.get("session_#{sessionId}", (err, res) ->
    throw err if err
    return callback(sessionId, JSON.parse(res))
  )


updateSessionExpiry = (currentRequest) ->
  db.redisClient.expire("session_#{currentRequest.sessionId}", currentRequest.session.sessionTimeout, (err, res) ->
    throw err if err
    if not res
      # Resave session in the very rare case when session cache expires while processing request
      db.redisClient.setex("session_#{currentRequest.sessionId}", currentRequest.session.sessionTimeout, JSON.stringify(currentRequest.session), (err) ->
        throw err if err
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
    getSession(httpRequest, (sessionId, session) ->
      cwmpRequest = soap.request(httpRequest, session?.cwmpVersion)
      if not session?
        if cwmpRequest.methodRequest?.type isnt 'Inform'
          httpResponse.writeHead(400)
          httpResponse.end('Session is expired')
          return

        deviceId = common.generateDeviceId(cwmpRequest.methodRequest.deviceId)
        sessionId = crypto.randomBytes(8).toString('hex')

        session = {
          deviceId : deviceId,
          cwmpVersion : cwmpRequest.cwmpVersion,
          sessionTimeout : cwmpRequest.sessionTimeout ? config.get('SESSION_TIMEOUT', deviceId)
        }

        httpRequest.connection.setTimeout(session.sessionTimeout * 1000)

      currentRequest = {
        httpRequest : httpRequest,
        httpResponse : httpResponse,
        sessionId : sessionId,
        session : session
      }

      if config.get('DEBUG', currentRequest.session.deviceId)
        dump = "# REQUEST #{new Date(Date.now())}\n" + JSON.stringify(httpRequest.headers) + "\n#{httpRequest.getBody()}\n\n"
        require('fs').appendFile("./debug/#{currentRequest.session.deviceId}.dump", dump, (err) ->
          throw err if err
        )

      if cwmpRequest.methodRequest?
        if cwmpRequest.methodRequest.type is 'Inform'
          inform(currentRequest, cwmpRequest)
        else if cwmpRequest.methodRequest.type is 'GetRPCMethods'
          util.log("#{currentRequest.session.deviceId}: GetRPCMethods")
          res = soap.response({
            id : cwmpRequest.id,
            methodResponse : {type : 'GetRPCMethodsResponse', methodList : ['Inform', 'GetRPCMethods', 'TransferComplete', 'RequestDownload']},
            cwmpVersion : currentRequest.session.cwmpVersion
          })
          writeResponse(currentRequest, res)
          updateSessionExpiry(currentRequest)
        else if cwmpRequest.methodRequest.type is 'TransferComplete'
          # do nothing
          util.log("#{currentRequest.session.deviceId}: Transfer complete")
          res = soap.response({
            id : cwmpRequest.id,
            methodResponse : {type : 'TransferCompleteResponse'},
            cwmpVersion : currentRequest.session.cwmpVersion
          })
          writeResponse(currentRequest, res)
          updateSessionExpiry(currentRequest)
        else if cwmpRequest.methodRequest.type is 'RequestDownload'
          requestDownloadResponse = () ->
            res = soap.response({
              id : cwmpRequest.id,
              methodResponse : {type : 'RequestDownloadResponse'},
              cwmpVersion : currentRequest.session.cwmpVersion
            })
            writeResponse(currentRequest, res)
            updateSessionExpiry(currentRequest)
          fileType = cwmpRequest.methodRequest.fileType
          util.log("#{currentRequest.session.deviceId}: RequestDownload (#{fileType})")
          if fileType isnt '1 Firmware Upgrade Image'
            # Only supporting firmware upgrade for now
            return requestDownloadResponse()

          db.getPresetsObjectsAliases((allPresets, allObjects, allAliases) ->
            presets.getDevicePreset(currentRequest.session.deviceId, allPresets, allObjects, allAliases, (devicePreset) ->
              presetSoftwareVersion = devicePreset.softwareVersion?.preset
              currentSoftwareVersion = devicePreset.softwareVersion?.current._value
              if presetSoftwareVersion? and presetSoftwareVersion != currentSoftwareVersion
                deviceIdStruct = common.parseDeviceId(currentRequest.session.deviceId)
                db.filesCollection.findOne({'metadata.fileType' : '1 Firmware Upgrade Image', 'metadata.oui' : deviceIdStruct.oui, 'metadata.productClass' : deviceIdStruct.productClass, 'metadata.version' : presetSoftwareVersion}, {_id : 1}, (err, file) ->
                  throw err if err
                  if not file?
                    util.error("#{currentRequest.session.deviceId}: Firmware image not found (#{presetSoftwareVersion})")
                    return requestDownloadResponse()

                  task = {
                    device : currentRequest.session.deviceId,
                    name : 'download',
                    file : file['_id']
                  }
                  apiFunctions.insertTasks(task, allAliases, (err, tasks) ->
                    throw err if err
                    return requestDownloadResponse()
                  )
                )
              else
                return requestDownloadResponse()
            )
          )
        else
          throw new Error('ACS method not supported')
      else if cwmpRequest.methodResponse?
        taskId = cwmpRequest.id

        db.getTask(taskId, (err, task) ->
          throw err if err
          if not task
            nextTask(currentRequest)
          else
            runTask(currentRequest, task, cwmpRequest.methodResponse)
        )
      else if cwmpRequest.fault?
        taskId = cwmpRequest.id
        if not taskId
          # Fault not related to a task. End the session.
          return endSession(currentRequest)

        db.getTask(taskId, (err, task) ->
          throw err if err
          if not task
            nextTask(currentRequest)
          else
            runTask(currentRequest, task, cwmpRequest.fault)
        )
      else
        # cpe sent empty response. start sending acs requests
        nextTask(currentRequest)
    )
  )


exports.listener = listener
