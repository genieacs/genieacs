config = require './config'
db = require './db'
http = require 'http'
common = require './common'
util = require 'util'
URL = require 'url'
auth = require './auth'


connectionRequest = (deviceId, callback) ->
  # ensure socket is reused in case of digest authentication
  agent = new http.Agent({maxSockets : 1})

  conReq = (url, authString, callback) ->
    options = URL.parse(url)
    options.agent = agent

    if authString
      options.headers = {'Authorization' : authString}

    request = http.get(options, (res) ->
      if res.statusCode == 401
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

  db.devicesCollection.findOne({_id : deviceId}, {'InternetGatewayDevice.ManagementServer.ConnectionRequestURL._value' : 1}, (err, device)->
    if err
      callback(err)
      return
    connectionRequestUrl = device.InternetGatewayDevice.ManagementServer.ConnectionRequestURL._value
    # for testing
    #connectionRequestUrl = connectionRequestUrl.replace(/^(http:\/\/)([0-9\.]+)(\:[0-9]+\/[a-zA-Z0-9]+\/?$)/, '$110.1.1.254$3')
    conReq(connectionRequestUrl, null, (statusCode, authHeader) ->
      if statusCode == 401
        [username, password] = config.auth.connectionRequest(deviceId)
        if authHeader.method is 'Basic'
          authString = auth.basic(username, password)
        else if authHeader.method is 'Digest'
          uri = URL.parse(connectionRequestUrl)
          authString = auth.digest(username, password, uri.path, 'GET', null, authHeader)

        conReq(connectionRequestUrl, authString, (statusCode, authHeader) ->
          callback()
        )
      else
        callback()
    )
  )


watchTask = (taskId, timeout, callback) ->
  setTimeout( () ->
    db.tasksCollection.findOne({_id : taskId}, {'_id' : 1}, (err, task) ->
      if task
        timeout -= 500
        if timeout < 0
          callback('timeout')
        else
          watchTask(taskId, timeout, callback)
      else
        callback(err)
    )
  , 500)


expandParam = (param, aliases) ->
  params = [param]
  for a,aa of aliases
    if a == param or common.startsWith(a, "#{param}.")
      for p in aa
        params.push(p) if p[p.lastIndexOf('.') + 1] != '_'

  return params


sanitizeTask = (task, aliases, callback) ->
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
        for pp in expandParam(p, aliases)
          projection[pp] = 1
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
        for pp in expandParam(p[0], aliases)
          projection[pp] = 1
          values[pp] = p[1]
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


addAliases = (device, aliases) ->
  for k,v of aliases
    for p in v
      pp = p.split('.')
      obj = device
      for i in pp
        if not obj[i]?
          obj = null
          break
        obj = obj[i]

      device[k] = obj if obj?


insertTasks = (tasks, aliases, callback) ->
  if tasks? and common.typeOf(tasks) isnt common.ARRAY_TYPE
    tasks = [tasks]
  else if not tasks? or tasks.length == 0
    return callback(tasks)

  counter = tasks.length

  for task in tasks
    sanitizeTask(task, aliases, (t) ->
      if t.uniqueKey?
        db.tasksCollection.remove({device : t.device, uniqueKey : t.uniqueKey}, (err, removed) ->
        )

      --counter
      if counter == 0
        db.tasksCollection.insert(tasks, (err, _tasks) ->
          #util.log("#{_task.device}: Added task #{_task.name}(#{_task._id})") for _task in _tasks
          callback(err, _tasks)
        )
    )


exports.addAliases = addAliases
exports.sanitizeTask = sanitizeTask
exports.connectionRequest = connectionRequest
exports.watchTask = watchTask
exports.insertTasks = insertTasks
