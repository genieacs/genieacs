BATCH_SIZE = 16

endsWith = (str, suffix) ->
  str.indexOf(suffix, str.length - suffix.length) isnt -1

this.init = (task, request, response) ->
  if not task.subtask?
    task.subtask = {'name' : 'getParameterNames', 'parameterPath' : '', 'nextLevel' : false}

  if task.subtask.name == 'getParameterNames'
    ret = this.getParameterNames(task.subtask, request, response)
    if ret? and ret.parameterNames? # task finished
      parameterNames = []
      for p in ret.parameterNames
        if not endsWith(p[0], '.')
          parameterNames.push(p[0])
      task.subtask = {'name' : 'getParameterValues', 'parameterNames' : parameterNames}
    else
      return

  if task.subtask.name == 'getParameterValues'
    return this.getParameterValues(task.subtask, request, response)

  throw 'Unspecified error'

this.getParameterNames = (task, request, response) ->
  if request.getParameterNamesResponse?
    return {'parameterNames' : request.getParameterNamesResponse}
  else
    response.getParameterNames = [task.parameterPath, if task.nextLevel? task.nextLevel else false]
  return

this.getParameterValues = (task, request, response) ->
  if not task.currentIndex?
    task.currentIndex = 0
  else if request.getParameterValuesResponse?
    task.currentIndex = task.nextIndex

  task.nextIndex = Math.min(task.currentIndex + BATCH_SIZE, task.parameterNames.length)
  names = task.parameterNames.slice(task.currentIndex, task.nextIndex)

  if names.length > 0
    response.getParameterValues = names

  if request.getParameterValuesResponse
    return {'parameterValues' : request.getParameterValuesResponse}
  return

this.setParameterValues = (task, request, response) ->
  if not task.currentIndex?
    task.currentIndex = 0
  else if request.setParameterValuesResponse?
    prevValues = task.parameterValues.slice(task.currentIndex, task.nextIndex)
    task.currentIndex = task.nextIndex

  task.nextIndex = Math.min(task.currentIndex + BATCH_SIZE, task.parameterValues.length)
  values = task.parameterValues.slice(task.currentIndex, task.nextIndex)

  if values.length > 0
    response.setParameterValues = values

  if prevValues?
    return {'parameterValues' : prevValues}
  return

this.reboot = (task, request, response) ->
  if not request.reboot
    response.reboot = 'reboot'
  
exports.task = (task, request, response) ->
  return this[task.name](task, request, response)
