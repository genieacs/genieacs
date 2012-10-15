# Configurations
DATABASE_NAME = 'genie'
PORT = 1337
CACHE_DURATION = 60000

# Common functions
endsWith = (str, suffix) ->
  str.indexOf(suffix, str.length - suffix.length) isnt -1

arrayToHash = (arr) ->
  hash = {}
  for i in arr
    hash[i[0]] = i[1]
  return hash

util = require 'util'
http = require 'http'
mongo = require 'mongodb'
tr069 = require './tr-069'
tasks = require './tasks'
Memcached = require 'memcached'
memcached = new Memcached '/tmp/memcached.sock'


# Create MongoDB connections
dbserver = new mongo.Server('/tmp/mongodb-27017.sock', 0, {auto_reconnect: true, safe: true})
tasksCollection = null
devicesCollection = null
db = new mongo.Db(DATABASE_NAME, dbserver, {native_parser:true})
db.open( (err, db) ->
  db.collection('tasks', (err, collection) ->
    tasksCollection = collection
    tasksCollection.ensureIndex({device: 1, timestamp: 1})
  )

  db.collection('devices', (err, collection) ->
    devicesCollection = collection
  )
)


updateDevice = (deviceId, actions) ->
  return if not actions?
  if actions.parameterValues?
    params = arrayToHash(actions.parameterValues)
    devicesCollection.update({'_id' : deviceId}, {'$set' : params}, {upsert: true})

runTask = (sessionId, deviceId, task, reqParams, response) ->
  resParams = {}
  actions = tasks.task(task, reqParams, resParams)
  updateDevice(deviceId, actions)

  if Object.keys(resParams).length > 0
    memcached.set(String(task._id), task, CACHE_DURATION, (err, result) ->
      tr069.response(reqParams.sessionId, response, resParams, {task : String(task._id)})
    )
    return

  # Task finished
  memcached.del(String(task._id))
  tasksCollection.remove({'_id' : mongo.ObjectID(task._id)}, {safe: true}, (err, removed) ->
    console.log("Device #{deviceId}: Completed task #{task.name}(#{task._id})")
    cookies = {task : null}
    tr069.response(sessionId, response, resParams, cookies)
    nextTask(sessionId, deviceId, response, cookies)
  )


nextTask = (sessionId, deviceId, response, cookies) ->
  cur = tasksCollection.find({'device' : deviceId, 'status' : 0}).sort(['timestamp']).limit(1)
  cur.nextObject( (err, task) ->
    reqParams = {}
    resParams = {}
    if not task
      tr069.response(sessionId, response, resParams, cookies)
      return

    console.log("Device #{deviceId}: Running task #{task.name}(#{task._id})")
    runTask(sessionId, deviceId, task, reqParams, response)
  )


cluster = require 'cluster'
numCPUs = require('os').cpus().length

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
        devicesCollection.count({'_id' : deviceId}, (err, count) ->
          if not count
            console.log("New device #{deviceId}")
            task = {device : deviceId, name : 'init', timestamp : mongo.Timestamp(), status: 0}
            tasksCollection.save(task, (err) ->
              console.log("Added init task for #{deviceId}")
            )

          devicesCollection.update({'_id' : deviceId}, {'$set' : arrayToHash(reqParams.informParameterValues)}, {upsert: true, safe:true}, (err, modified) ->
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
      else
        memcached.get(taskId, (err, task) ->
          runTask(sessionId, deviceId, task, reqParams, response)
        )

  server.listen PORT
  console.log "Server listening on port #{PORT}"
