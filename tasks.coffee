config = require './config'
common = require './common'
db = require './db'
mongodb = require 'mongodb'
customCommands = require './custom-commands'
BATCH_SIZE = 16

exports.STATUS_QUEUED = STATUS_QUEUED = 0
exports.STATUS_STARTED = STATUS_STARTED = 1
exports.STATUS_SAVE = STATUS_SAVE = 2
exports.STATUS_PENDING = STATUS_PENDING = 3
exports.STATUS_FAULT = STATUS_FAULT = 4
exports.STATUS_FINISHED = STATUS_FINISHED = 5


initCustomCommands = (deviceId, callback) ->
  updates = {customCommands : []}
  counter = 0
  for k,v of customCommands.getDeviceCustomCommands(deviceId)
    if 'init' in v
      ++counter
      customCommands.execute(deviceId, "#{k} init", (err, value) ->
        updates.customCommands.push([k, value])
        callback(updates) if --counter <= 0
      )
  callback(updates) if counter <= 0


this.init = (task, methodResponse, callback) ->
  if not task.subtask?
    task.subtask = {device : task.device, name : 'getParameterNames', parameterPath : '', nextLevel : false}

  if task.subtask.name == 'getParameterNames'
    if methodResponse.faultcode?
      task.fault = methodResponse
      callback(null, STATUS_FAULT)
      return

    this.getParameterNames(task.subtask, methodResponse, (err, status, cwmpResponse, deviceUpdates) =>
      if status is STATUS_FINISHED
        parameterNames = []
        for p in deviceUpdates.parameterNames
          if not common.endsWith(p[0], '.')
            parameterNames.push(p[0])
        task.subtask = {name : 'getParameterValues', parameterNames : parameterNames}
        this.getParameterValues(task.subtask, {}, (err, status, cwmpResponse) ->
          # ignore deviceUpdates returned by firt call to getParameterValues
          callback(err, status, cwmpResponse, deviceUpdates)
        )
      else if status is STATUS_STARTED
        callback(err, STATUS_STARTED, cwmpResponse, deviceUpdates)
      else
        throw Error('Unexpected subtask status')
    )
  else if task.subtask.name == 'getParameterValues'
    if methodResponse.faultcode?
      # Ignore GetParameterValues errors. A workaround for the crappy Seewon devices.
      methodResponse = {parameterList : {}}
    this.getParameterValues(task.subtask, methodResponse, (err, status, cwmpResponse, deviceUpdates) ->
      if status is STATUS_FINISHED
        initCustomCommands(task.device, (updates) ->
          common.extend(deviceUpdates, updates)
          callback(err, status, cwmpResponse, deviceUpdates)
        )
      else
        callback(err, status, cwmpResponse, deviceUpdates)
    )
  else
    throw Error('Unexpected subtask name')


this.refreshObject = (task, methodResponse, callback) ->
  if not task.subtask?
    task.subtask = {device : task.device, name : 'getParameterNames', parameterPath : "#{task.objectName}.", nextLevel : false}

  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if task.subtask.name == 'getParameterNames'
    this.getParameterNames(task.subtask, methodResponse, (err, status, cwmpResponse, deviceUpdates) =>
      if status is STATUS_FINISHED
        parameterNames = []
        for p in deviceUpdates.parameterNames
          if not common.endsWith(p[0], '.')
            parameterNames.push(p[0])
        task.subtask = {name : 'getParameterValues', parameterNames : parameterNames}
        this.getParameterValues(task.subtask, {}, (err, status, cwmpResponse) ->
          # ignore deviceUpdates returned by firt call to getParameterValues
          callback(err, status, cwmpResponse, deviceUpdates)
        )
      else if status is STATUS_STARTED
        callback(err, STATUS_STARTED, cwmpResponse, deviceUpdates)
      else
        throw Error('Unexpected subtask status')
    )
  else if task.subtask.name == 'getParameterValues'
    if methodResponse.faultcode?
      # Ignore GetParameterValues errors. A workaround for the crappy Seewon devices.
      methodResponse = {parameterList : {}}
    this.getParameterValues(task.subtask, methodResponse, (err, status, cwmpResponse, deviceUpdates) ->
      callback(err, status, cwmpResponse, deviceUpdates)
    )
  else
    throw Error('Unexpected subtask name')


findMissingParameters = (device, parameterList, prefix) ->
  missingParameters = []
  paths = {}
  for param in parameterList
    p = param[0]
    paths[p] = true
    i = p.indexOf('.')
    while i != -1
      paths[p[0...i]] = true
      i = p.indexOf('.', i + 1)

  recursive = (obj, prefix) ->
    for k,v of obj
      continue if k[0] == '_'
      p = prefix + k

      if paths[p]
        recursive(v, "#{p}.")
      else
        missingParameters.push(p)

  recursive(device, prefix)
  return missingParameters


this.getParameterNames = (task, methodResponse, callback) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if methodResponse.type is 'GetParameterNamesResponse'
    deviceUpdates = {parameterNames : methodResponse.parameterList}
    path = if common.endsWith(task.parameterPath, '.') then task.parameterPath.slice(0, -1) else task.parameterPath
    projection = {}
    projection[path] = 1 if !!task.parameterPath

    # delete nonexisting params
    db.devicesCollection.findOne({_id : task.device}, projection, (err, device) ->
      if device
        if !!task.parameterPath
          root = device
          rootPath = ''
          ps = path.split('.')
          for p in ps
            rootPath += "#{p}."
            root = root[p]
            break if not root?
        else
          root = device['InternetGatewayDevice']
          rootPath = 'InternetGatewayDevice.'

        if root
          deviceUpdates.deletedObjects = findMissingParameters(root, methodResponse.parameterList, rootPath)
        else
          # avoid adding and deleting the same param
          if rootPath isnt task.parameterPath
            deviceUpdates.deletedObjects = [rootPath.slice(0, -1)]

      # some devices don't return the root object as described in the standard. add manually to update timestamp
      deviceUpdates.parameterNames.push([task.parameterPath]) if !!task.parameterPath

      callback(null, STATUS_FINISHED, null, deviceUpdates)
    )
  else
    methodRequest = {
      type : 'GetParameterNames',
      parameterPath : task.parameterPath,
      nextLevel : if task.nextLevel? then task.nextLevel else false
    }
    callback(null, STATUS_STARTED, {methodRequest : methodRequest})


this.getParameterValues = (task, methodResponse, callback) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if not task.currentIndex?
    task.currentIndex = 0
  else if methodResponse.parameterList?
    task.currentIndex = task.nextIndex

  task.nextIndex = Math.min(task.currentIndex + BATCH_SIZE, task.parameterNames.length)
  names = task.parameterNames.slice(task.currentIndex, task.nextIndex)

  if methodResponse.type is 'GetParameterValuesResponse'
    deviceUpdates = {parameterValues : methodResponse.parameterList}

  if names.length == 0
    callback(null, STATUS_FINISHED, null, deviceUpdates)
  else
    methodRequest = {
      type : 'GetParameterValues',
      parameterNames : names
    }
    callback(null, STATUS_STARTED, {methodRequest : methodRequest}, deviceUpdates)


this.setParameterValues = (task, methodResponse, callback) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if not task.currentIndex?
    task.currentIndex = 0
  else if methodResponse.type is 'SetParameterValuesResponse'
    prevValues = task.parameterValues.slice(task.currentIndex, task.nextIndex)
    task.currentIndex = task.nextIndex

  task.nextIndex = Math.min(task.currentIndex + BATCH_SIZE, task.parameterValues.length)
  values = task.parameterValues.slice(task.currentIndex, task.nextIndex)

  if prevValues?
    deviceUpdates = {parameterValues : prevValues}

  if values.length == 0
    callback(null, STATUS_FINISHED, null, deviceUpdates)
  else
    callback(null, STATUS_STARTED, {methodRequest : {type : 'SetParameterValues', parameterList : values}}, deviceUpdates)


this.addObject = (task, methodResponse, callback) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  allDeviceUpdates = {}

  if not task.instanceNumber?
    if methodResponse.type is 'AddObjectResponse'
      task.instanceNumber = methodResponse.instanceNumber
      task.subtask = {device : task.device, name : 'getParameterNames', parameterPath : "#{task.objectName}.#{task.instanceNumber}.", nextLevel : false}
      task.appliedParameterValues = []
      task.parameterNames = []
      allDeviceUpdates.instanceName = [["#{task.objectName}.#{task.instanceNumber}", task.instanceName]] if task.instanceName?
    else
      callback(null, STATUS_STARTED, {methodRequest : {type : 'AddObject', objectName : "#{task.objectName}."}})
      return

  subtask = () =>
    switch task.subtask.name
      when 'getParameterNames'
        this.getParameterNames(task.subtask, methodResponse, (err, status, cwmpResponse, deviceUpdates) =>
          common.extend(allDeviceUpdates, deviceUpdates)
          if deviceUpdates and deviceUpdates.parameterNames
            for p in deviceUpdates.parameterNames
              task.parameterNames.push(p[0]) if not common.endsWith(p[0], '.')

          if status is STATUS_FINISHED
            task.subtask = {name : 'getParameterValues', parameterNames : task.parameterNames}
            subtask()
          else if status is STATUS_STARTED
            if allDeviceUpdates.instanceName?
              # Use STATUSS_SAVE to avoid adding duplicate object in case of error
              callback(err, STATUS_SAVE, cwmpResponse, allDeviceUpdates)
            else
              callback(err, STATUS_STARTED, cwmpResponse, allDeviceUpdates)
          else
            throw Error('Unexpected subtask status')
        )
      when 'getParameterValues'
        this.getParameterValues(task.subtask, methodResponse, (err, status, cwmpResponse, deviceUpdates) =>
          common.extend(allDeviceUpdates, deviceUpdates)
          # if values are given, compare with default values
          if task.parameterValues?
            if deviceUpdates and deviceUpdates.parameterValues?
              for p1 in deviceUpdates.parameterValues
                for p2 in task.parameterValues
                  if common.endsWith(p1[0], ".#{p2[0]}")
                    t = if p2[2] then p2[2] else p1[2]
                    v = common.matchType(p1[1], p2[1])
                    # TODO only include if writable
                    task.appliedParameterValues.push([p1[0], v, t])

          if methodResponse.faultcode?
            # Ignore GetParameterValues errors. A workaround for the crappy Seewon devices.
            methodResponse = {parameterList : {}}
          if status is STATUS_FINISHED and task.appliedParameterValues.length > 0
            task.subtask = {name : 'setParameterValues', parameterValues : task.appliedParameterValues}
            subtask()
          else
            callback(err, status, cwmpResponse, allDeviceUpdates)
        )
      when 'setParameterValues'
        this.setParameterValues(task.subtask, methodResponse, (err, status, cwmpResponse, deviceUpdates) =>
          common.extend(allDeviceUpdates, deviceUpdates)
          callback(err, status, cwmpResponse, allDeviceUpdates)
        )
  subtask()


this.deleteObject = (task, methodResponse, callback) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if methodResponse.type is 'DeleteObjectResponse'
    callback(null, STATUS_FINISHED, null, {deletedObjects : [task.objectName]})
  else
    methodRequest = {
      type : 'DeleteObject',
      objectName : "#{task.objectName}."
    }
    callback(null, STATUS_STARTED, {methodRequest : methodRequest})


this.reboot = (task, methodResponse, callback) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return
  
  if methodResponse.type isnt 'RebootResponse'
    callback(null, STATUS_STARTED, {methodRequest : {type : 'Reboot'}})
  else
    callback(null, STATUS_FINISHED)


this.factoryReset = (task, methodResponse, callback) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if methodResponse.type isnt 'FactoryResetResponse'
    callback(null, STATUS_STARTED, {methodRequest : {type : 'FactoryReset'}})
  else
    callback(null, STATUS_FINISHED)


this.download = (task, methodResponse, callback) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if methodResponse.type isnt 'DownloadResponse'
    db.filesCollection.findOne({_id : mongodb.ObjectID(task.file)}, (err, file) ->
      if not file?
        callback('File not found')
        return
      else if err?
        callback(err)
        return

      methodRequest = {
        type : 'Download',
        fileType : file.metadata?.FileType ? '1 Firmware Upgrade Image',
        fileSize : file.length,
        url : "http://#{config.FILES_IP}:#{config.FILES_PORT}/#{file.filename}"
      }
      callback(null, STATUS_STARTED, {methodRequest : methodRequest})
    )
  else
    callback(null, STATUS_FINISHED)


this.customCommand = (task, methodResponse, callback) ->
  # TODO implement timeout
  customCommands.execute(task.device, task.command, (err, value) ->
    if err?
      task.fault = err
      callback(null, STATUS_FAULT)
    else
      commandName = task.command.split(' ', 2)[0]
      callback(null, STATUS_FINISHED, null, {customCommands : [[commandName, value]]})
  )


exports.task = (task, methodResponse, callback) ->
  this[task.name](task, methodResponse, callback)
