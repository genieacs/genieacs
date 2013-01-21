common = require './common'
BATCH_SIZE = 16

this.init = (task, cwmpRequest, cwmpResponse) ->
  ret = {}
  if not task.subtask?
    task.subtask = {'name' : 'getParameterNames', 'parameterPath' : '', 'nextLevel' : false}

  if task.subtask.name == 'getParameterNames'
    common.extend(ret, this.getParameterNames(task.subtask, cwmpRequest, cwmpResponse))
    if ret.parameterNames? # task finished
      parameterNames = []
      for p in ret.parameterNames
        if not common.endsWith(p[0], '.')
          parameterNames.push(p[0])
      task.subtask = {'name' : 'getParameterValues', 'parameterNames' : parameterNames}

  if task.subtask.name == 'getParameterValues'
    common.extend(ret, this.getParameterValues(task.subtask, cwmpRequest, cwmpResponse))

  ret

this.getParameterNames = (task, cwmpRequest, cwmpResponse) ->
  if cwmpRequest.getParameterNamesResponse?
    return {'parameterNames' : cwmpRequest.getParameterNamesResponse}
  else
    cwmpResponse.getParameterNames = [task.parameterPath, if task.nextLevel? task.nextLevel else false]
  return

this.getParameterValues = (task, cwmpRequest, cwmpResponse) ->
  if not task.currentIndex?
    task.currentIndex = 0
  else if cwmpRequest.getParameterValuesResponse?
    task.currentIndex = task.nextIndex

  task.nextIndex = Math.min(task.currentIndex + BATCH_SIZE, task.parameterNames.length)
  names = task.parameterNames.slice(task.currentIndex, task.nextIndex)

  if names.length > 0
    cwmpResponse.getParameterValues = names

  if cwmpRequest.getParameterValuesResponse
    return {'parameterValues' : cwmpRequest.getParameterValuesResponse}
  return

this.setParameterValues = (task, cwmpRequest, cwmpResponse) ->
  if not task.currentIndex?
    task.currentIndex = 0
  else if cwmpRequest.setParameterValuesResponse?
    prevValues = task.parameterValues.slice(task.currentIndex, task.nextIndex)
    task.currentIndex = task.nextIndex

  task.nextIndex = Math.min(task.currentIndex + BATCH_SIZE, task.parameterValues.length)
  values = task.parameterValues.slice(task.currentIndex, task.nextIndex)

  if values.length > 0
    cwmpResponse.setParameterValues = values

  if prevValues?
    return {'parameterValues' : prevValues}
  return

this.reboot = (task, cwmpRequest, cwmpResponse) ->
  if not cwmpRequest.reboot
    cwmpResponse.reboot = 'reboot'
  
exports.task = (task, cwmpRequest, cwmpResponse) ->
  return this[task.name](task, cwmpRequest, cwmpResponse)
