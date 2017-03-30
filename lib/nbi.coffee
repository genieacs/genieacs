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

url = require 'url'
mongodb = require 'mongodb'
querystring = require 'querystring'
vm = require 'vm'

config = require './config'
common = require './common'
db = require './db'
query = require './query'
apiFunctions = require './api-functions'

VERSION = require('../package.json').version

# regular expression objects
DEVICE_TASKS_REGEX = /^\/devices\/([a-zA-Z0-9\-\_\%]+)\/tasks\/?$/
TASKS_REGEX = /^\/tasks\/([a-zA-Z0-9\-\_\%]+)(\/[a-zA-Z_]*)?$/
TAGS_REGEX = /^\/devices\/([a-zA-Z0-9\-\_\%]+)\/tags\/([a-zA-Z0-9\-\_\%]+)\/?$/
PRESETS_REGEX = /^\/presets\/([a-zA-Z0-9\-\_\%]+)\/?$/
OBJECTS_REGEX = /^\/objects\/([a-zA-Z0-9\-\_\%]+)\/?$/
FILES_REGEX = /^\/files\/([a-zA-Z0-9\%\!\*\'\(\)\;\:\@\&\=\+\$\,\?\#\[\]\-\_\.\~]+)\/?$/
PING_REGEX = /^\/ping\/([a-zA-Z0-9\-\_\.]+)\/?$/
QUERY_REGEX = /^\/([a-zA-Z0-9_]+s)\/?$/
DELETE_DEVICE_REGEX = /^\/devices\/([a-zA-Z0-9\-\_\%]+)\/?$/
PROVISIONS_REGEX = /^\/provisions\/([a-zA-Z0-9\-\_\%]+)\/?$/
VIRTUAL_PARAMETERS_REGEX = /^\/virtual_parameters\/([a-zA-Z0-9\-\_\%]+)\/?$/
FAULTS_REGEX = /^\/faults\/([a-zA-Z0-9\-\_\%\:]+)\/?$/



throwError = (err, httpResponse) ->
  if httpResponse
    httpResponse.writeHead(500, {'Connection' : 'close'})
    httpResponse.end("#{err.name}: #{err.message}")

  throw err


listener = (request, response) ->
  chunks = []
  bytes = 0

  response.setHeader('GenieACS-Version', VERSION)

  request.addListener 'data', (chunk) ->
    chunks.push(chunk)
    bytes += chunk.length

  request.getBody = () ->
    # Write all chunks into a Buffer
    body = new Buffer(bytes)
    offset = 0
    chunks.forEach((chunk) ->
      chunk.copy(body, offset, 0, chunk.length)
      offset += chunk.length
    )
    return body

  request.addListener 'end', () ->
    body = request.getBody()
    urlParts = url.parse(request.url, true)
    if PRESETS_REGEX.test(urlParts.pathname)
      presetName = querystring.unescape(PRESETS_REGEX.exec(urlParts.pathname)[1])
      if request.method == 'PUT'
        preset = JSON.parse(body)
        preset._id = presetName

        db.presetsCollection.save(preset, (err) ->
          return throwError(err, response) if err
          db.redisClient.del('presets_hash', (err) ->
            return throwError(err, response) if err
            response.writeHead(200)
            response.end()
          )
        )
      else if request.method == 'DELETE'
        db.presetsCollection.remove({'_id' : presetName}, (err) ->
          return throwError(err, response) if err
          db.redisClient.del('presets_hash', (err) ->
            return throwError(err, response) if err
            response.writeHead(200)
            response.end()
          )
        )
      else
        response.writeHead 405, {'Allow': 'PUT, DELETE'}
        response.end('405 Method Not Allowed')
    else if OBJECTS_REGEX.test(urlParts.pathname)
      objectName = querystring.unescape(OBJECTS_REGEX.exec(urlParts.pathname)[1])
      if request.method == 'PUT'
        object = JSON.parse(body)
        object._id = objectName

        db.objectsCollection.save(object, (err) ->
          return throwError(err, response) if err
          db.redisClient.del('objects', 'presets_hash', (err) ->
            return throwError(err, response) if err
            response.writeHead(200)
            response.end()
          )
        )
      else if request.method == 'DELETE'
        db.objectsCollection.remove({'_id' : objectName}, (err) ->
          return throwError(err, response) if err
          db.redisClient.del('objects', 'presets_hash', (err) ->
            return throwError(err, response) if err
            response.writeHead(200)
            response.end()
          )
        )
      else
        response.writeHead 405, {'Allow': 'PUT, DELETE'}
        response.end('405 Method Not Allowed')
    else if PROVISIONS_REGEX.test(urlParts.pathname)
      provisionName = querystring.unescape(PROVISIONS_REGEX.exec(urlParts.pathname)[1])
      if request.method == 'PUT'
        object = {
          _id: provisionName
          script: body.toString()
        }
        try
          new vm.Script("\"use strict\";(function(){\n#{object.script}\n})();")
        catch err
          response.writeHead(400)
          response.end("#{err.name}: #{err.message}")
          return

        db.provisionsCollection.save(object, (err) ->
          return throwError(err, response) if err
          db.redisClient.del('presets_hash', (err) ->
            return throwError(err, response) if err
            response.writeHead(200)
            response.end()
          )
        )
      else if request.method == 'DELETE'
        db.provisionsCollection.remove({'_id' : provisionName}, (err) ->
          return throwError(err, response) if err
          db.redisClient.del('presets_hash', (err) ->
            return throwError(err, response) if err
            response.writeHead(200)
            response.end()
          )
        )
      else
        response.writeHead 405, {'Allow': 'PUT, DELETE'}
        response.end('405 Method Not Allowed')
    else if VIRTUAL_PARAMETERS_REGEX.test(urlParts.pathname)
      virtualParameterName = querystring.unescape(VIRTUAL_PARAMETERS_REGEX.exec(urlParts.pathname)[1])
      if request.method == 'PUT'
        object = {
          _id: virtualParameterName
          script: body.toString()
        }
        try
          new vm.Script("\"use strict\";(function(){\n#{object.script}\n})();")
        catch err
          response.writeHead(400)
          response.end("#{err.name}: #{err.message}")
          return

        db.virtualParametersCollection.save(object, (err) ->
          return throwError(err, response) if err
          db.redisClient.del('presets_hash', (err) ->
            return throwError(err, response) if err
            response.writeHead(200)
            response.end()
          )
        )
      else if request.method == 'DELETE'
        db.virtualParametersCollection.remove({'_id' : virtualParameterName}, (err) ->
          return throwError(err, response) if err
          db.redisClient.del('presets_hash', (err) ->
            return throwError(err, response) if err
            response.writeHead(200)
            response.end()
          )
        )
      else
        response.writeHead 405, {'Allow': 'PUT, DELETE'}
        response.end('405 Method Not Allowed')
    else if TAGS_REGEX.test(urlParts.pathname)
      r = TAGS_REGEX.exec(urlParts.pathname)
      deviceId = querystring.unescape(r[1])
      tag = querystring.unescape(r[2])
      if request.method == 'POST'
        db.devicesCollection.update({'_id' : deviceId}, {'$addToSet' : {'_tags' : tag}}, {safe: true}, (err) ->
          return throwError(err, response) if err
          db.redisClient.del("#{deviceId}_presets_hash", (err) ->
            return throwError(err, response) if err
            response.writeHead(200)
            response.end()
          )
        )
      else if request.method == 'DELETE'
        db.devicesCollection.update({'_id' : deviceId}, {'$pull' : {'_tags' : tag}}, {safe: true}, (err) ->
          return throwError(err, response) if err
          db.redisClient.del("#{deviceId}_presets_hash", (err) ->
            return throwError(err, response) if err
            response.writeHead(200)
            response.end()
          )
        )
      else
        response.writeHead 405, {'Allow': 'POST, DELETE'}
        response.end('405 Method Not Allowed')
    else if FAULTS_REGEX.test(urlParts.pathname)
      if request.method == 'DELETE'
        faultId = querystring.unescape(FAULTS_REGEX.exec(urlParts.pathname)[1])
        deviceId = faultId.split(':', 1)[0]
        channel = faultId.slice(deviceId.length + 1)
        db.faultsCollection.remove({_id : faultId}, (err) ->
          return throwError(err, response) if err
          if channel.startsWith('task_')
            return db.tasksCollection.remove({_id : new mongodb.ObjectID(channel.slice(5))}, (err) ->
              return throwError(err, response) if err
              db.redisClient.del("#{deviceId}_tasks", "#{deviceId}_faults", (err) ->
                return throwError(err, response) if err
                response.writeHead(200)
                response.end()
              )
            )

          db.redisClient.del("#{deviceId}_faults", (err) ->
            return throwError(err, response) if err
            response.writeHead(200)
            response.end()
          )
        )
      else
        response.writeHead 405, {'Allow': 'DELETE'}
        response.end('405 Method Not Allowed')
    else if DEVICE_TASKS_REGEX.test(urlParts.pathname)
      if request.method == 'POST'
        deviceId = querystring.unescape(DEVICE_TASKS_REGEX.exec(urlParts.pathname)[1])
        if body.length
          task = JSON.parse(body)
          task.device = deviceId
          apiFunctions.insertTasks(task, (err) ->
            return throwError(err, response) if err
            db.redisClient.del("#{deviceId}_tasks", (err) ->
              return throwError(err, response) if err

              if urlParts.query.connection_request?
                apiFunctions.connectionRequest(deviceId, (err) ->
                  if err
                    response.writeHead(202, err.message, {'Content-Type' : 'application/json'})
                    response.end(JSON.stringify(task))
                  else
                    apiFunctions.watchTask(deviceId, task._id, {timeout: config.get('DEVICE_ONLINE_THRESHOLD', deviceId)}, (err, status) ->
                      return throwError(err, response) if err

                      if status is 'timeout'
                        response.writeHead(202, 'Task queued but not processed', {'Content-Type' : 'application/json'})
                        response.end(JSON.stringify(task))
                        if config.get('BG_TASK_WATCHER')
                          # Finish this NBI reply but continue checking the task, making follow up connection requests to the CPE.
                          apiFunctions.watchTask(deviceId, task._id, {timeout: config.get('BG_TASK_WATCHER_TIMEOUT'), delay: config.get('BG_TASK_WATCHER_DELAY'), makeConnectionRequest: true}, () ->)
                      else if status is 'fault'
                        db.tasksCollection.findOne({_id : task._id}, (err, task) ->
                          return throwError(err, response) if err

                          response.writeHead(202, 'Task faulted', {'Content-Type' : 'application/json'})
                          response.end(JSON.stringify(task))
                        )
                      else
                        response.writeHead(200, {'Content-Type' : 'application/json'})
                        response.end(JSON.stringify(task))
                    )
                )
              else
                response.writeHead(202, {'Content-Type' : 'application/json'})
                response.end(JSON.stringify(task))
            )
          )
        else if urlParts.query.connection_request?
          # no task, send connection request only
          apiFunctions.connectionRequest(deviceId, (err) ->
            if err
              response.writeHead 504
              response.end("#{err.name}: #{err.message}")
              return
            response.writeHead 200
            response.end()
          )
        else
          response.writeHead(400)
          response.end()
      else
        response.writeHead 405, {'Allow': 'POST'}
        response.end('405 Method Not Allowed')
    else if TASKS_REGEX.test(urlParts.pathname)
      r = TASKS_REGEX.exec(urlParts.pathname)
      taskId = new mongodb.ObjectID(querystring.unescape(r[1]))
      action = r[2]
      if not action? or action is '/'
        if request.method == 'DELETE'
          db.tasksCollection.findOne({'_id' : taskId}, {'device' : 1}, (err, task) ->
            return throwError(err, response) if err
            deviceId = task.device
            db.tasksCollection.remove({'_id' : taskId}, (err) ->
              return throwError(err, response) if err
              db.faultsCollection.remove({_id : "#{deviceId}:task_#{String(taskId)}"}, (err) ->
                return throwError(err, response) if err
                db.redisClient.del("#{deviceId}_tasks", "#{deviceId}_faults", (err) ->
                  return throwError(err, response) if err
                  response.writeHead(200)
                  response.end()
                )
              )
            )
          )
        else
          response.writeHead 405, {'Allow': 'PUT DELETE'}
          response.end('405 Method Not Allowed')
      else if action is '/retry'
        if request.method == 'POST'
          db.tasksCollection.findOne({'_id' : taskId}, {'device' : 1}, (err, task) ->
            return throwError(err, response) if err
            deviceId = task.device
            db.faultsCollection.remove({_id : "#{deviceId}:task_#{String(taskId)}"}, (err) ->
              return throwError(err, response) if err
              db.redisClient.del("#{deviceId}_faults", (err) ->
                return throwError(err, response) if err
                response.writeHead(200)
                response.end()
              )
            )
          )
        else
          response.writeHead 405, {'Allow': 'POST'}
          response.end('405 Method Not Allowed')
      else
        response.writeHead(404)
        response.end()
    else if FILES_REGEX.test(urlParts.pathname)
      filename = querystring.unescape(FILES_REGEX.exec(urlParts.pathname)[1])
      if request.method == 'PUT'
        metadata = {
          fileType : request.headers.filetype,
          oui : request.headers.oui,
          productClass : request.headers.productclass,
          version : request.headers.version,
        }

        gs = new mongodb.GridStore(db.mongoDb, filename, filename, 'w', {metadata : metadata})
        gs.open((err, gs) ->
          gs.write(body, (err, res) ->
            return throwError(err, response) if err
            gs.close((err) ->
              return throwError(err, response) if err
              response.writeHead(201)
              response.end()
            )
          )
        )
      else if request.method == 'DELETE'
        mongodb.GridStore.unlink(db.mongoDb, filename, (err) ->
          response.writeHead(200)
          response.end()
        )
      else
        response.writeHead 405, {'Allow': 'PUT, DELETE'}
        response.end('405 Method Not Allowed')
    else if PING_REGEX.test(urlParts.pathname)
      host = querystring.unescape(PING_REGEX.exec(urlParts.pathname)[1])
      require('child_process').exec("ping -w 1 -i 0.2 -c 3 #{host}", (err, stdout, stderr) ->
        if err
          response.writeHead(404, {'Cache-Control' : 'no-cache'})
          response.end("#{err.name}: #{err.message}")
          return
        response.writeHead(200, {'Content-Type' : 'text/plain', 'Cache-Control' : 'no-cache'})
        response.end(stdout)
      )
    else if DELETE_DEVICE_REGEX.test(urlParts.pathname)
      if request.method isnt 'DELETE'
        response.writeHead(405, {'Allow' : 'DELETE'})
        response.end('405 Method Not Allowed')
        return

      deviceId = querystring.unescape(DELETE_DEVICE_REGEX.exec(urlParts.pathname)[1])
      apiFunctions.deleteDevice(deviceId, (err) ->
        return throwError(err, response) if err
        response.writeHead(200)
        response.end()
      )
    else if QUERY_REGEX.test(urlParts.pathname)
      collectionName = QUERY_REGEX.exec(urlParts.pathname)[1]

      # Convert to camel case
      i = collectionName.indexOf('_')
      while i >= 0
        ++ i
        up = if i < collectionName.length then collectionName[i].toUpperCase() else ''
        collectionName = collectionName.slice(0, i - 1) + up + collectionName.slice(i + 1)
        i = collectionName.indexOf('_', i)

      if request.method not in ['GET', 'HEAD']
        response.writeHead 405, {'Allow' : 'GET, HEAD'}
        response.end('405 Method Not Allowed')
        return
      collection = db["#{collectionName}Collection"]
      if not collection?
        response.writeHead 404
        response.end('404 Not Found')
        return

      if urlParts.query.query?
        try
          q = JSON.parse(urlParts.query.query)
        catch err
          response.writeHead(400)
          response.end("#{err.name}: #{err.message}")
          return
      else
        q = {}

      switch collectionName
        when 'devices'
          q = query.expand(q)
        when 'tasks'
          q = query.sanitizeQueryTypes(q, {
            _id: ((v) -> return new mongodb.ObjectID(v))
            timestamp: ((v) -> return new Date(v))
            retries: Number
          })
        when 'faults'
          q = query.sanitizeQueryTypes(q, {
            timestamp: ((v) -> return new Date(v))
            retries: Number
          })

      if urlParts.query.projection?
        projection = {}
        for p in urlParts.query.projection.split(',')
          p = p.trim()
          projection[p] = 1

      cur = collection.find(q, projection, {batchSize : 50})
      if urlParts.query.sort?
        s = JSON.parse(urlParts.query.sort)
        sort = {}
        for k,v of s
          if k[k.lastIndexOf('.') + 1] != '_' and collectionName is 'devices'
            sort["#{k}._value"] = v
          else
            sort[k] = v
        cur.sort(sort)

      cur.skip(parseInt(urlParts.query.skip)) if urlParts.query.skip?
      cur.limit(limit = parseInt(urlParts.query.limit)) if urlParts.query.limit?
      cur.count(false, (err, total) ->
        response.writeHead(200, {'Content-Type' : 'application/json', 'total' : total})
        if request.method is 'HEAD'
          response.end()
          return
        response.write("[\n")
        i = 0
        cur.each((err, item) ->
          if err
            throwError(err, response)
            return false

          if item?
            response.write(",\n") if i++
            response.write(JSON.stringify(item))

          if not item? or (limit? and i >= limit)
            response.end("\n]")
        )
      )

    else
      response.writeHead 404
      response.end('404 Not Found')


exports.listener = listener
