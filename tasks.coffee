common = require './common'
BATCH_SIZE = 16

this.init = (task, methodResponse, cwmpResponse) ->
  ret = {}
  if not task.subtask?
    task.subtask = {'name' : 'getParameterNames', 'parameterPath' : '', 'nextLevel' : false}

  if task.subtask.name == 'getParameterNames'
    common.extend(ret, this.getParameterNames(task.subtask, methodResponse, cwmpResponse))
    if ret.parameterNames? # task finished
      parameterNames = []
      for p in ret.parameterNames
        if not common.endsWith(p[0], '.')
          parameterNames.push(p[0])
      task.subtask = {'name' : 'getParameterValues', 'parameterNames' : parameterNames}

  if task.subtask.name == 'getParameterValues'
    common.extend(ret, this.getParameterValues(task.subtask, methodResponse, cwmpResponse))

  ret

this.getParameterNames = (task, methodResponse, cwmpResponse) ->
  if methodResponse.type is 'GetParameterNamesResponse'
    return {'parameterNames' : methodResponse.parameterList}
  else
    cwmpResponse.methodRequest = {
      type : 'GetParameterNames',
      parameterPath : task.parameterPath,
      nextLevel : if task.nextLevel? then task.nextLevel else false
    }
  return

this.getParameterValues = (task, methodResponse, cwmpResponse) ->
  if not task.currentIndex?
    task.currentIndex = 0
  else if methodResponse.parameterList?
    task.currentIndex = task.nextIndex

  task.nextIndex = Math.min(task.currentIndex + BATCH_SIZE, task.parameterNames.length)
  names = task.parameterNames.slice(task.currentIndex, task.nextIndex)

  if names.length > 0
    cwmpResponse.methodRequest = {
      type : 'GetParameterValues',
      parameterNames : names
    }

  if methodResponse.type is 'GetParameterValuesResponse'
    return {'parameterValues' : methodResponse.parameterList}
  return

this.setParameterValues = (task, methodResponse, cwmpResponse) ->
  if not task.currentIndex?
    task.currentIndex = 0
  else if methodResponse.type is 'SetParameterValuesResponse'
    prevValues = task.parameterValues.slice(task.currentIndex, task.nextIndex)
    task.currentIndex = task.nextIndex

  task.nextIndex = Math.min(task.currentIndex + BATCH_SIZE, task.parameterValues.length)
  values = task.parameterValues.slice(task.currentIndex, task.nextIndex)

  if values.length > 0
    cwmpResponse.methodRequest = {
      type : 'SetParameterValues',
      parameterList : values
    }

  if prevValues?
    return {'parameterValues' : prevValues}
  return

this.reboot = (task, methodResponse, cwmpResponse) ->
  if methodResponse.type isnt 'RebootResponse'
    cwmpResponse.methodRequest = {
      type : 'Reboot'
    }
  
exports.task = (task, methodResponse, cwmpResponse) ->
  return this[task.name](task, methodResponse, cwmpResponse)
