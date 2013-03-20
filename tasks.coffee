config = require './config'
common = require './common'
db = require './db'
mongodb = require 'mongodb'
BATCH_SIZE = 16

exports.STATUS_QUEUED = STATUS_QUEUED = 0
exports.STATUS_STARTED = STATUS_STARTED = 1
exports.STATUS_PENDING = STATUS_PENDING = 2
exports.STATUS_FAULT = STATUS_FAULT = 3
exports.STATUS_FINISHED = STATUS_FINISHED = 4


this.init = (task, methodResponse, callback) ->
  if not task.subtask?
    task.subtask = {name : 'getParameterNames', parameterPath : '', nextLevel : false}

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
      callback(err, status, cwmpResponse, deviceUpdates)
    )
  else
    throw Error('Unexpected subtask name')


this.getParameterNames = (task, methodResponse, callback) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if methodResponse.type is 'GetParameterNamesResponse'
    callback(null, STATUS_FINISHED, null, {parameterNames : methodResponse.parameterList})
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


this.reboot = (task, methodResponse, callback) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return
  
  if methodResponse.type isnt 'RebootResponse'
    callback(null, STATUS_STARTED, {methodRequest : {type : 'Reboot'}})
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
        fileType : '1 Firmware Upgrade Image',
        fileSize : file.length,
        url : "http://#{config.FILES_IP}:#{config.FILES_PORT}/#{file.filename}"
      }
      callback(null, STATUS_STARTED, {methodRequest : methodRequest})
    )
  else
    callback(null, STATUS_FINISHED)


exports.task = (task, methodResponse, callback) ->
  this[task.name](task, methodResponse, callback)
