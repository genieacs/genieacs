util = require 'util'
http = require 'http'
mongo = require 'mongodb'
tr069 = require './tr-069'
tasks = require './tasks'

cluster = require 'cluster'
numCPUs = require('os').cpus().length

DATABASE_NAME = 'genie'
PORT = 1337

endsWith = (str, suffix) ->
  str.indexOf(suffix, str.length - suffix.length) isnt -1

arrayToHash = (arr) ->
  hash = {}
  for i in arr
    hash[i[0]] = i[1]
  return hash

dbserver = new mongo.Server('localhost', 27017, {auto_reconnect: true})
db = new mongo.Db(DATABASE_NAME, dbserver, {native_parser:true})
db.open( (err, db) ->
)


updateDevice = (deviceId, actions) ->
  return if not actions?
  if actions.parameterValues?
    params = arrayToHash(actions.parameterValues)
    db.collection('devices', (err, collection) ->
      collection.update({'_id' : deviceId}, {'$set' : params}, {upsert: true})
    )


nextTask = (sessionId, deviceId, response, cookies) ->
  if err?
    throw 'ERROR: Cannot open database connection'

  db.collection('tasks', (err, collection) ->
    cur = collection.find({'device' : deviceId}).sort(['timestamp']).limit(1)
    cur.nextObject( (err, task) ->
      reqParams = {}
      resParams = {}
      if not task
        # add init task and end of queue
        db.collection('tasks', (err, collection) ->
          collection.insert({'name' : 'endOfQueue', 'device': deviceId, 'timestamp' : mongo.Timestamp(new Date(2020, 1, 1))})
        )
        task = {'name' : 'init', 'timestamp' : mongo.Timestamp()}
      else if task.name == 'endOfQueue'
        tr069.response(sessionId, response, resParams, cookies)
        return

      actions = tasks.task(task, reqParams, resParams)
      updateDevice(deviceId, actions)
      # TODO in rare cases a task could finish without sending response
      collection.save(task, (err) ->
        console.log("Device #{deviceId}: Running task #{task.name}(#{task._id})")
        cookies.task = String(task._id)
        tr069.response(sessionId, response, resParams, cookies)
      )
      return
    )
  )


if cluster.isMaster
  for i in [1 .. numCPUs]
    cluster.fork()
  cluster.on('exit', (worker, code, signal) ->
    console.log('worker ' + worker.process.pid + ' died')
  )
else
  server = http.createServer (request, response) ->
    if request.method != 'POST'
      console.log '>>> 405 Method Not Allowed'
      response.writeHead 405, {'Allow': 'POST'}
      response.end('405 Method Not Allowed')
      return

    request.content = ''
    cookies = {}

    request.addListener 'data', (chunk) ->
      request.content += chunk

    request.addListener 'end', () ->
      resParams = {}
      reqParams = tr069.request(request.headers, request.content)

      if reqParams.inform
        resParams.inform = true
        cookies.ID = sessionId = reqParams.sessionId
        cookies.DeviceId = deviceId = reqParams.deviceId.SerialNumber
        db.collection('devices', (err, collection) ->
          collection.update({'_id' : deviceId}, {'$set' : arrayToHash(reqParams.informParameterValues)}, {upsert: true}, (err) ->
            tr069.response(reqParams.sessionId, response, resParams, cookies)
          )
        )
        return

      sessionId = reqParams.cookies.ID
      deviceId = reqParams.cookies.DeviceId
      taskId = reqParams.cookies.task

      if not taskId
        nextTask(sessionId, deviceId, response, cookies)
        return

      db.collection('tasks', (err, collection) ->
        cur = collection.find({'_id' : mongo.ObjectID(taskId)})
        cur.nextObject( (err, task) ->
          actions = tasks.task(task, reqParams, resParams)
          updateDevice(deviceId, actions)

          if Object.keys(resParams).length > 0
            collection.save(task)
            tr069.response(reqParams.sessionId, response, resParams, cookies)
          else
            console.log("Device #{deviceId}: Completed task #{task.name}(#{task._id})")
            collection.remove({'_id' : task._id}, (err, removed) ->
              cookies.task = undefined
              nextTask(sessionId, deviceId, response, cookies)
            )
        )
      )

  server.listen PORT
  console.log "Server listening on port #{PORT}"
