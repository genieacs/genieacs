common = require './common'
BATCH_SIZE = 16

exports.STATUS_QUEUED = STATUS_QUEUED = 0
exports.STATUS_STARTED = STATUS_STARTED = 1
exports.STATUS_PENDING = STATUS_PENDING = 2
exports.STATUS_FAULT = STATUS_FAULT = 3
exports.STATUS_FINISHED = STATUS_FINISHED = 4


this.init = (task, methodResponse, cwmpResponse, deviceUpdates) ->
  if not task.subtask?
    task.subtask = {'name' : 'getParameterNames', 'parameterPath' : '', 'nextLevel' : false}

  if task.subtask.name == 'getParameterNames'
    if methodResponse.faultcode?
      task.fault = methodResponse
      return STATUS_FAULT

    status = this.getParameterNames(task.subtask, methodResponse, cwmpResponse, deviceUpdates)
    if status is STATUS_FINISHED
      parameterNames = []
      for p in deviceUpdates.parameterNames
        if not common.endsWith(p[0], '.')
          parameterNames.push(p[0])
      task.subtask = {'name' : 'getParameterValues', 'parameterNames' : parameterNames}
    else if status != STATUS_STARTED
      throw Error('Unexpected subtask status')

  if task.subtask.name == 'getParameterValues'
    if methodResponse.faultcode?
      # Ignore GetParameterValues errors. A workaround for the crappy Seewon devices.
      status = this.getParameterValues(task.subtask, {parameterList : {}}, cwmpResponse, deviceUpdates)
    else
      status = this.getParameterValues(task.subtask, methodResponse, cwmpResponse, deviceUpdates)
    if status is STATUS_FINISHED
      return STATUS_FINISHED
    else if status isnt STATUS_STARTED
      throw Error('Unexpected subtask status')

  return STATUS_STARTED


this.getParameterNames = (task, methodResponse, cwmpResponse, deviceUpdates) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    return STATUS_FAULT

  if methodResponse.type is 'GetParameterNamesResponse'
    deviceUpdates.parameterNames = methodResponse.parameterList
    return STATUS_FINISHED

  cwmpResponse.methodRequest = {
    type : 'GetParameterNames',
    parameterPath : task.parameterPath,
    nextLevel : if task.nextLevel? then task.nextLevel else false
  }
  return STATUS_STARTED


this.getParameterValues = (task, methodResponse, cwmpResponse, deviceUpdates) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    return STATUS_FAULT

  if not task.currentIndex?
    task.currentIndex = 0
  else if methodResponse.parameterList?
    task.currentIndex = task.nextIndex

  task.nextIndex = Math.min(task.currentIndex + BATCH_SIZE, task.parameterNames.length)
  names = task.parameterNames.slice(task.currentIndex, task.nextIndex)

  if methodResponse.type is 'GetParameterValuesResponse'
    deviceUpdates.parameterValues = methodResponse.parameterList

  if names.length == 0
    return STATUS_FINISHED

  cwmpResponse.methodRequest = {
    type : 'GetParameterValues',
    parameterNames : names
  }

  return STATUS_STARTED


this.setParameterValues = (task, methodResponse, cwmpResponse, deviceUpdates) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    return STATUS_FAULT

  if not task.currentIndex?
    task.currentIndex = 0
  else if methodResponse.type is 'SetParameterValuesResponse'
    prevValues = task.parameterValues.slice(task.currentIndex, task.nextIndex)
    task.currentIndex = task.nextIndex

  task.nextIndex = Math.min(task.currentIndex + BATCH_SIZE, task.parameterValues.length)
  values = task.parameterValues.slice(task.currentIndex, task.nextIndex)

  if prevValues?
    deviceUpdates.parameterValues = prevValues

  if values.length == 0
    return STATUS_FINISHED

  cwmpResponse.methodRequest = {
    type : 'SetParameterValues',
    parameterList : values
  }
  return STATUS_STARTED


this.reboot = (task, methodResponse, cwmpResponse, deviceUpdates) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    return STATUS_FAULT

  if methodResponse.type isnt 'RebootResponse'
    cwmpResponse.methodRequest = {
      type : 'Reboot'
    }
    return STATUS_STARTED

  return STATUS_FINISHED


this.download = (task, methodResponse, cwmpResponse, deviceUpdates) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    return STATUS_FAULT

  if methodResponse.type isnt 'DownloadResponse'
    cwmpResponse.methodRequest = {
      type : 'Download',
      fileType : task.fileType,
      url : task.url
    }
    return STATUS_STARTED

  return STATUS_FINISHED


exports.task = (task, methodResponse, cwmpResponse, deviceUpdates) ->
  return this[task.name](task, methodResponse, cwmpResponse, deviceUpdates)
