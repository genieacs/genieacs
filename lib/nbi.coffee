config = require './config'
util = require 'util'
http = require 'http'
url = require 'url'
common = require './common'
db = require './db'
mongodb = require 'mongodb'
querystring = require 'querystring'
query = require './query'
apiFunctions = require './api-functions'
presets = require './presets'

# regular expression objects
DEVICE_TASKS_REGEX = /^\/devices\/([a-zA-Z0-9\-\_\%]+)\/tasks\/?$/
TASKS_REGEX = /^\/tasks\/([a-zA-Z0-9\-\_\%]+)(\/[a-zA-Z_]*)?$/
TAGS_REGEX = /^\/devices\/([a-zA-Z0-9\-\_\%]+)\/tags\/([a-zA-Z0-9\-\_\%]+)\/?$/
PRESETS_REGEX = /^\/presets\/([a-zA-Z0-9\-\_\%]+)\/?$/
OBJECTS_REGEX = /^\/objects\/([a-zA-Z0-9\-\_\%]+)\/?$/
FILES_REGEX = /^\/files\/([a-zA-Z0-9\-\_\%\ \.\/\(\)]+)\/?$/
PING_REGEX = /^\/ping\/([a-zA-Z0-9\-\_\.]+)\/?$/
QUERY_REGEX = /^\/([a-zA-Z0-9_]+s)\/?$/
DEVICE_PRESET_REGEX = /^\/devices\/([a-zA-Z0-9\-\_\%]+)\/preset\/?$/


cluster = require 'cluster'
numCPUs = require('os').cpus().length

if cluster.isMaster
  cluster.on('listening', (worker, address) ->
    util.log("Worker #{worker.process.pid} listening to #{address.address}:#{address.port}")
  )

  cluster.on('exit', (worker, code, signal) ->
    util.log("Worker #{worker.process.pid} died (#{worker.process.exitCode})")
    setTimeout(()->
      cluster.fork()
    , config.WORKER_RESPAWN_TIME)
  )

  for [1 .. numCPUs]
    cluster.fork()
else
  server = http.createServer (request, response) ->
    chunks = []
    bytes = 0

    request.addListener 'data', (chunk) ->
      chunks.push(chunk)
      bytes += chunk.length

    request.getBody = (encoding) ->
      # Write all chunks into a Buffer
      body = new Buffer(bytes)
      offset = 0
      chunks.forEach((chunk) ->
        chunk.copy(body, offset, 0, chunk.length)
        offset += chunk.length
      )

      # Return encoded (default to UTF8) string
      return body.toString(encoding || 'utf8', 0, body.byteLength)

    request.addListener 'end', () ->
      body = request.getBody()
      urlParts = url.parse(request.url, true)
      if PRESETS_REGEX.test(urlParts.pathname)
        presetName = querystring.unescape(PRESETS_REGEX.exec(urlParts.pathname)[1])
        if request.method == 'PUT'
          preset = JSON.parse(body)
          preset._id = presetName

          db.presetsCollection.save(preset, (err) ->
            db.redisClient.del('presets', 'presets_hash', (err) ->
              throw err if err
            )
            if err
              response.writeHead(500)
              response.end(err)
              return
            response.writeHead(200)
            response.end()
          )
        else if request.method == 'DELETE'
          db.presetsCollection.remove({'_id' : presetName}, (err, removedCount) ->
            db.redisClient.del('presets', 'presets_hash', (err) ->
              throw err if err
            )
            if err
              response.writeHead(500)
              response.end(err)
              return
            response.writeHead(200)
            response.end()
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
            db.redisClient.del('objects', 'presets_hash', (err) ->
              throw err if err
            )
            if err
              response.writeHead(500)
              response.end(err)
              return
            response.writeHead(200)
            response.end()
          )
        else if request.method == 'DELETE'
          db.objectsCollection.remove({'_id' : objectName}, (err, removedCount) ->
            db.redisClient.del('objects', 'presets_hash', (err) ->
              throw err if err
            )
            if err
              response.writeHead(500)
              response.end(err)
              return
            response.writeHead(200)
            response.end()
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
            db.redisClient.del("#{deviceId}_presets_hash", (err) ->
              throw err if err
            )
            if err
              response.writeHead(500)
              response.end(err)
              return
            response.writeHead(200)
            response.end()
          )
        else if request.method == 'DELETE'
          db.devicesCollection.update({'_id' : deviceId}, {'$pull' : {'_tags' : tag}}, {safe: true}, (err) ->
            db.redisClient.del("#{deviceId}_presets_hash", (err) ->
              throw err if err
            )
            if err
              response.writeHead(500)
              response.end(err)
              return
            response.writeHead(200)
            response.end()
          )
        else
          response.writeHead 405, {'Allow': 'POST, DELETE'}
          response.end('405 Method Not Allowed')
      else if DEVICE_TASKS_REGEX.test(urlParts.pathname)
        if request.method == 'POST'
          deviceId = querystring.unescape(DEVICE_TASKS_REGEX.exec(urlParts.pathname)[1])
          if body
            task = JSON.parse(body)
            task.device = deviceId
            db.getAliases((aliases) ->
              apiFunctions.insertTasks(task, aliases, (err) ->
                db.redisClient.del("#{deviceId}_presets_hash", (err) ->
                  throw err if err
                )
                if err
                  response.writeHead(500)
                  response.end(err)
                  return

                if urlParts.query.connection_request?
                  apiFunctions.connectionRequest(deviceId, (err) ->
                    if err
                      response.writeHead(202)
                      response.end()
                    else
                      apiFunctions.watchTask(task._id, config.DEVICE_ONLINE_THRESHOLD, (err) ->
                        if err
                          response.writeHead(202)
                          response.end()
                          return
                        response.writeHead(200)
                        response.end()
                      )
                  )
                else
                  response.writeHead(202)
                  response.end()
              )
            )
          else if urlParts.query.connection_request?
            # no task, send connection request only
            apiFunctions.connectionRequest(deviceId, (err) ->
              if err
                response.writeHead 504
                response.end()
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
      else if DEVICE_PRESET_REGEX.test(urlParts.pathname)
        deviceId = querystring.unescape(DEVICE_PRESET_REGEX.exec(urlParts.pathname)[1])
        if request.method is 'GET'
          db.getPresetsObjectsAliases((allPresets, allObjects, allAliases) ->
            presets.getDevicePreset(deviceId, allPresets, allObjects, allAliases, (devicePreset) ->
              response.writeHead(200, {'Content-Type' : 'application/json'})
              response.end(JSON.stringify(devicePreset))
            )
          )
        else
          response.writeHead 405, {'Allow': 'GET'}
          response.end('405 Method Not Allowed')
      else if TASKS_REGEX.test(urlParts.pathname)
        r = TASKS_REGEX.exec(urlParts.pathname)
        taskId = mongodb.ObjectID(querystring.unescape(r[1]))
        action = try querystring.unescape(r[2])
        if not action? or action is '/'
          if request.method == 'DELETE'
            db.tasksCollection.remove({'_id' : taskId}, (err, removedCount) ->
              if err
                response.writeHead(500)
                response.end(err)
                return
              response.writeHead(200)
              response.end()
            )
          else
            response.writeHead 405, {'Allow': 'PUT DELETE'}
            response.end('405 Method Not Allowed')
        else if action is '/retry'
          if request.method == 'POST'
            db.tasksCollection.update({_id : taskId}, {$unset : {fault : 1}, $set : {timestamp : new Date()}}, (err, count) ->
              # TODO need to invalidate presets hash for the device
              response.writeHead(200)
              response.end()
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
            manufacturer : request.headers.manufacturer,
            productClass : request.headers.productclass,
            version : request.headers.version,
          }

          gs = new mongodb.GridStore(db.mongoDb, filename, 'w', {metadata : metadata})
          gs.open((err, gs) ->
            gs.write(request.getBody('binary'), (err, res) ->
              throw err if err
              gs.close((err) ->
                throw err if err
              )
              response.writeHead(201)
              response.end()
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
          if err?
            response.writeHead(404, {'Cache-Control' : 'no-cache'})
            response.end()
            return
          response.writeHead(200, {'Content-Type' : 'text/plain', 'Cache-Control' : 'no-cache'})
          response.end(stdout)
        )
      else if QUERY_REGEX.test(urlParts.pathname)
        collectionName = QUERY_REGEX.exec(urlParts.pathname)[1]
        if request.method not in ['GET', 'HEAD']
          response.writeHead 405, {'Allow' : 'GET, HEAD'}
          response.end('405 Method Not Allowed')
          return
        collection = db["#{collectionName}Collection"]
        if not collection?
          response.writeHead 404
          response.end('404 Not Found')
          return

        func = (aliases) ->
          if urlParts.query.query?
            q = JSON.parse(urlParts.query.query)
          else
            q = {}
          q = query.expand(q, aliases) if collectionName is 'devices'

          if urlParts.query.projection?
            projection = {}
            for p in urlParts.query.projection.split(',')
              p = p.trim()
              projection[p] = 1
              if collectionName is 'devices'
                for k,v of aliases
                  if k == p or common.startsWith(k, "#{p}.")
                    projection[a] = 1 for a in v

          cur = collection.find(q, projection, {batchSize : 50})
          if urlParts.query.sort?
            s = JSON.parse(urlParts.query.sort)
            sort = {}
            for k,v of s
              if aliases[k]?
                sort[a] = v for a in aliases[k]
              else
                sort[k] = v
            cur.sort(sort)

          cur.skip(parseInt(urlParts.query.skip)) if urlParts.query.skip?
          cur.limit(parseInt(urlParts.query.limit)) if urlParts.query.limit?
          cur.count((err, total) ->
            response.writeHead(200, {'Content-Type' : 'application/json', 'total' : total})
            if request.method is 'HEAD'
              response.end()
              return
            response.write("[\n")
            i = 0
            cur.each((err, item) ->
              if item is null
                response.end("\n]")
              else
                response.write(",\n") if i++
                apiFunctions.addAliases(item, aliases) if collectionName is 'devices'
                response.write(JSON.stringify(item))
            )
          )

        if collectionName is 'devices'
          db.getAliases((aliases) ->
            func(aliases)
          )
        else
          func({})
      else
        response.writeHead 404
        response.end('404 Not Found')

  server.listen config.API_PORT, config.API_INTERFACE
