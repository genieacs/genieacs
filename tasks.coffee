config = require './config'
common = require './common'
db = require './db'
mongodb = require 'mongodb'
customCommands = require './custom-commands'
BATCH_SIZE = 16

exports.STATUS_OK = STATUS_OK = 1
exports.STATUS_FAULT = STATUS_FAULT = 2
exports.STATUS_COMPLETED = STATUS_COMPLETED = 4
exports.STATUS_SAVE = STATUS_SAVE = 128 # not mutually exclusive with the rest


this.refreshObject = (task, methodResponse, callback) ->
  task.session = {} if not task.session?

  if not task.session.subtask?
    path = task.objectName
    path += '.' if path != '' and not common.endsWith(path, '.')
    task.session.subtask = {device : task.device, name : 'getParameterNames', parameterPath : path, nextLevel : false}

  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if task.session.subtask.name is 'getParameterNames'
    this.getParameterNames(task.session.subtask, methodResponse, (err, status, cwmpResponse, deviceUpdates) =>
      if status & STATUS_COMPLETED
        parameterNames = []
        for p in deviceUpdates.parameterNames
          if not common.endsWith(p[0], '.')
            parameterNames.push(p[0])
        task.session.subtask = {name : 'getParameterValues', parameterNames : parameterNames}
        this.getParameterValues(task.session.subtask, {}, (err, status, cwmpResponse) ->
          # ignore deviceUpdates returned by firt call to getParameterValues
          callback(err, status, cwmpResponse, deviceUpdates)
        )
      else if status & STATUS_OK
        callback(err, STATUS_OK, cwmpResponse, deviceUpdates)
      else
        throw Error('Unexpected subtask status')
    )
  else if task.session.subtask.name is 'getParameterValues'
    if methodResponse.faultcode?
      task.fault = methodResponse
      return callback(null, STATUS_FAULT)

    this.getParameterValues(task.session.subtask, methodResponse, (err, status, cwmpResponse, deviceUpdates) ->
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
    # Make sure that for each parameters, all its parents are included
    found = {}
    for p in methodResponse.parameterList
      param = p[0]
      i = param.length
      while (i = param.lastIndexOf('.', i-1)) > task.parameterPath.length
        pp = param.slice(0, i + 1)
        break if found[pp]?
        found[pp] = 0
      found[p[0]] = 1

    for k, v of found
      methodResponse.parameterList.push([k]) if v == 0

    deviceUpdates = {parameterNames : methodResponse.parameterList}
    path = if common.endsWith(task.parameterPath, '.') then task.parameterPath.slice(0, -1) else task.parameterPath
    projection = {}
    projection[path] = 1 if !!task.parameterPath

    # delete nonexisting params
    db.devicesCollection.findOne({_id : task.device}, projection, (err, device) ->
      if device
        root = device
        rootPath = ''
        if !!task.parameterPath
          ps = path.split('.')
          for p in ps
            rootPath += "#{p}."
            root = root[p]
            break if not root?

        if root
          deviceUpdates.deletedObjects = findMissingParameters(root, methodResponse.parameterList, rootPath)
        else
          # avoid adding and deleting the same param
          if rootPath isnt task.parameterPath
            deviceUpdates.deletedObjects = [rootPath.slice(0, -1)]

      # some devices don't return the root object as described in the standard. add manually to update timestamp
      deviceUpdates.parameterNames.push([task.parameterPath]) if !!task.parameterPath

      callback(null, STATUS_COMPLETED, null, deviceUpdates)
    )
  else
    methodRequest = {
      type : 'GetParameterNames',
      parameterPath : task.parameterPath,
      nextLevel : if task.nextLevel? then task.nextLevel else false
    }
    callback(null, STATUS_OK, {methodRequest : methodRequest})


this.getParameterValues = (task, methodResponse, callback) ->
  task.session = {} if not task.session?

  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if not task.session.currentIndex?
    task.session.currentIndex = 0
  else if methodResponse.parameterList?
    task.session.currentIndex = task.session.nextIndex

  task.session.nextIndex = Math.min(task.session.currentIndex + BATCH_SIZE, task.parameterNames.length)
  names = task.parameterNames.slice(task.session.currentIndex, task.session.nextIndex)

  if methodResponse.type is 'GetParameterValuesResponse'
    deviceUpdates = {parameterValues : methodResponse.parameterList}

  if names.length == 0
    callback(null, STATUS_COMPLETED, null, deviceUpdates)
  else
    methodRequest = {
      type : 'GetParameterValues',
      parameterNames : names
    }
    callback(null, STATUS_OK, {methodRequest : methodRequest}, deviceUpdates)


this.setParameterValues = (task, methodResponse, callback) ->
  task.session = {} if not task.session?

  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if not task.session.currentIndex?
    task.session.currentIndex = 0
  else if methodResponse.type is 'SetParameterValuesResponse'
    prevValues = task.parameterValues.slice(task.session.currentIndex, task.session.nextIndex)
    task.session.currentIndex = task.session.nextIndex

  task.session.nextIndex = Math.min(task.session.currentIndex + BATCH_SIZE, task.parameterValues.length)
  values = task.parameterValues.slice(task.session.currentIndex, task.session.nextIndex)

  if prevValues?
    deviceUpdates = {parameterValues : prevValues}

  if values.length == 0
    callback(null, STATUS_COMPLETED, null, deviceUpdates)
  else
    callback(null, STATUS_OK, {methodRequest : {type : 'SetParameterValues', parameterList : values}}, deviceUpdates)


this.addObject = (task, methodResponse, callback) ->
  task.session = {} if not task.session?

  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  allDeviceUpdates = {}

  if not task.session.instanceNumber?
    if methodResponse.type is 'AddObjectResponse'
      status_save = STATUS_SAVE
      task.session.instanceNumber = methodResponse.instanceNumber
      task.session.subtask = {device : task.device, name : 'getParameterNames', parameterPath : "#{task.objectName}.#{task.session.instanceNumber}.", nextLevel : false}
      task.session.appliedParameterValues = []
      task.session.parameterNames = []
      allDeviceUpdates.instanceName = [["#{task.objectName}.#{task.session.instanceNumber}", task.instanceName]] if task.instanceName?
    else
      callback(null, STATUS_OK, {methodRequest : {type : 'AddObject', objectName : "#{task.objectName}."}})
      return

  subtask = () =>
    switch task.session.subtask.name
      when 'getParameterNames'
        this.getParameterNames(task.session.subtask, methodResponse, (err, status, cwmpResponse, deviceUpdates) =>
          common.extend(allDeviceUpdates, deviceUpdates)
          if deviceUpdates and deviceUpdates.parameterNames
            for p in deviceUpdates.parameterNames
              task.session.parameterNames.push(p[0]) if not common.endsWith(p[0], '.')

          if status & STATUS_COMPLETED
            task.session.subtask = {name : 'getParameterValues', parameterNames : task.session.parameterNames}
            subtask()
          else if status & STATUS_OK
            # Use STATUS_SAVE to avoid adding duplicate object in case of error
            callback(err, STATUS_OK | status_save, cwmpResponse, allDeviceUpdates)
          else
            throw Error('Unexpected subtask status')
        )
      when 'getParameterValues'
        this.getParameterValues(task.session.subtask, methodResponse, (err, status, cwmpResponse, deviceUpdates) =>
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
                    task.session.appliedParameterValues.push([p1[0], v, t])

          if methodResponse.faultcode?
            task.fault = methodResponse
            return callback(null, STATUS_FAULT)

          if status & STATUS_COMPLETED and task.session.appliedParameterValues.length > 0
            task.session.subtask = {name : 'setParameterValues', parameterValues : task.session.appliedParameterValues}
            subtask()
          else
            callback(err, status, cwmpResponse, allDeviceUpdates)
        )
      when 'setParameterValues'
        this.setParameterValues(task.session.subtask, methodResponse, (err, status, cwmpResponse, deviceUpdates) =>
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
    callback(null, STATUS_COMPLETED, null, {deletedObjects : [task.objectName]})
  else
    methodRequest = {
      type : 'DeleteObject',
      objectName : "#{task.objectName}."
    }
    callback(null, STATUS_OK, {methodRequest : methodRequest})


this.reboot = (task, methodResponse, callback) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return
  
  if methodResponse.type isnt 'RebootResponse'
    callback(null, STATUS_OK, {methodRequest : {type : 'Reboot'}})
  else
    callback(null, STATUS_COMPLETED)


this.factoryReset = (task, methodResponse, callback) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if methodResponse.type isnt 'FactoryResetResponse'
    callback(null, STATUS_OK, {methodRequest : {type : 'FactoryReset'}})
  else
    callback(null, STATUS_COMPLETED)


this.download = (task, methodResponse, callback) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if methodResponse.type isnt 'DownloadResponse'
    db.filesCollection.findOne({_id : mongodb.ObjectID(String(task.file))}, (err, file) ->
      if not file?
        callback('File not found')
        return
      else if err?
        callback(err)
        return

      methodRequest = {
        type : 'Download',
        fileType : file.metadata.fileType,
        fileSize : file.length,
        url : "http://#{config.FILES_IP}:#{config.FILES_PORT}/#{encodeURIComponent(file.filename)}",
        successUrl : task.successUrl,
        failureUrl : task.failureUrl
      }
      callback(null, STATUS_OK, {methodRequest : methodRequest})
    )
  else
    callback(null, STATUS_COMPLETED)


this.customCommand = (task, methodResponse, callback) ->
  # TODO implement timeout
  customCommands.execute(task.device, task.command, (err, value) ->
    if err?
      task.fault = err
      callback(null, STATUS_FAULT)
    else
      commandName = task.command.split(' ', 2)[0]
      callback(null, STATUS_COMPLETED, null, {customCommands : [[commandName, value]]})
  )


exports.task = (task, methodResponse, callback) ->
  this[task.name](task, methodResponse, callback)
