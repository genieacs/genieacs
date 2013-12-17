config = require './config'
common = require './common'
db = require './db'
mongoQuery = require './mongo-query'
query = require './query'
log = require('util').log
customCommands = require './custom-commands'


exports.calculatePresetsHash = (presets, objects) ->
  crypto = require('crypto')
  hash = crypto.createHash('md5').update(JSON.stringify(presets) + JSON.stringify(objects)).digest('hex')
  return hash


matchObject = (object, param) ->
  return false if not object._keys? or object._keys.length == 0
  for k in object._keys
    return false if not param[k]?
    v = common.matchType(param[k]._value, object[k])
    if param[k]._value != v
      return false
  return true


exports.getDevicePreset = (deviceId, presets, objects, aliases, callback) ->
  deviceCustomCommands = customCommands.getDeviceCustomCommands(deviceId)
  # only fetch relevant params
  projection = {_id : 1}
  for p in presets
    p.precondition = query.expand(p.precondition, aliases)
    mongoQuery.projection(p.precondition, projection)

    for c in p.configurations
      switch c.type
        when 'value', 'age'
          projection[c.name] = 1
        when 'custom_command_value', 'custom_command_age'
          commandfile = c.command.split(' ', 1)
          if commandfile of deviceCustomCommands
            projection["_customCommands.#{c.command.split(' ', 1)}"] = 1
        when 'software_version'
          projection['InternetGatewayDevice.DeviceInfo.SoftwareVersion'] = 1
        when 'add_tag', 'delete_tag'
          projection['_tags'] = 1
        when 'add_object', 'delete_object'
          projection[c.name] = 1
        else
          throw new Error('Unknown configuration type')

  mongoQuery.optimizeProjection(projection)

  db.devicesCollection.findOne({'_id' : deviceId}, projection, (err, device) ->
    throw err if err
    devicePresets = []
    for p in presets
      if mongoQuery.test(device, p.precondition)
        devicePresets.push(p)

    configurations = accumulateConfigurations(devicePresets, objects)

    getParamDetails = (device, path) ->
      p = common.getParamValueFromPath(device, path)
      return undefined if not p?
      details = {}
      for k,v of p
        details[k] = v if k[0] == '_'
      return details

    devicePreset = {}
    for c in configurations
      switch c.type
        when 'value'
          devicePreset.parameters ?= {}
          devicePreset.parameters[c.name] ?= {}
          devicePreset.parameters[c.name].preset ?= {}
          devicePreset.parameters[c.name].preset.value = c.value
          devicePreset.parameters[c.name].current = getParamDetails(device, c.name)

        when 'age'
          devicePreset.parameters ?= {}
          devicePreset.parameters[c.name] ?= {}
          devicePreset.parameters[c.name].preset ?= {}
          devicePreset.parameters[c.name].preset.expiry = parseInt(c.age)
          devicePreset.parameters[c.name].current = getParamDetails(device, c.name)

        when 'add_tag'
          devicePreset.tags ?= {}
          devicePreset.tags[c.tag] = 2 | c.tag in (device._tags ? [])

        when 'delete_tag'
          devicePreset.tags ?= {}
          devicePreset.tags[c.tag] = 0 | c.tag in (device._tags ? [])

        when 'add_object'
          devicePreset.objects ?= {}
          devicePreset.objects[c.name] ?= {}
          devicePreset.objects[c.name][c.object] ?= {}
          devicePreset.objects[c.name][c.object].preset = objects[c.object]
          continue if not param = common.getParamValueFromPath(device, c.name)
          devicePreset.objects[c.name][c.object].current ?= {}
          for k,p of param
            continue if k[0] == '_'
            if p._name?
              if p._name == c.object
                devicePreset.objects[c.name][c.object].current[k] = p
            else if matchObject(objects[c.object], p)
              u = {}
              u["#{c.name}.#{k}._name"] = c.object
              db.devicesCollection.update({'_id' : deviceId}, {'$set' : u}, {}, (err, count) ->
                throw err if err
              )
              devicePreset.objects[c.name][c.object].current[k] = p

        when 'delete_object'
          devicePreset.objects ?= {}
          devicePreset.objects[c.name] ?= {}
          devicePreset.objects[c.name][c.object] ?= {}
          continue if not param = common.getParamValueFromPath(device, c.name)
          devicePreset.objects[c.name][c.object].current ?= {}
          for k,p of param
            continue if k[0] == '_'
            if p._name?
              if p._name == c.object
                devicePreset.objects[c.name][c.object].current[k] = p
            else if matchObject(objects[c.object], p)
              u = {}
              u["#{c.name}.#{k}._name"] = c.object
              db.devicesCollection.update({'_id' : deviceId}, {'$set' : u}, {}, (err, count) ->
                throw err if err
              )
              devicePreset.objects[c.name][c.object].current[k] = p

        when 'custom_command_value'
          [filename, commandName] = c.command.split(' ', 2)
          devicePreset.customCommands ?= {}
          devicePreset.customCommands[filename] ?= {}
          devicePreset.customCommands[filename].preset ?= {}
          devicePreset.customCommands[filename].preset.value = c.value
          devicePreset.customCommands[filename].preset.valueCommand = c.command
          continue if not deviceCustomCommands[filename]? or commandName not in deviceCustomCommands[filename]
          if cmd = common.getParamValueFromPath(device, "_customCommands.#{filename}")
            devicePreset.customCommands[filename].current = cmd
          else
            devicePreset.customCommands[filename].current ?= {}

        when 'custom_command_age'
          [filename, commandName] = c.command.split(' ', 2)
          devicePreset.customCommands ?= {}
          devicePreset.customCommands[filename] ?= {}
          devicePreset.customCommands[filename].preset ?= {}
          devicePreset.customCommands[filename].preset.expiry = parseInt(c.age)
          devicePreset.customCommands[filename].preset.expiryCommand = c.command
          continue if not deviceCustomCommands[filename]? or commandName not in deviceCustomCommands[filename]
          if cmd = common.getParamValueFromPath(device, "_customCommands.#{filename}")
            devicePreset.customCommands[filename].current = cmd
          else
            devicePreset.customCommands[filename].current ?= {}

        when 'software_version'
          devicePreset.softwareVersion ?= {}
          devicePreset.softwareVersion.preset = c.software_version
          devicePreset.softwareVersion.current = common.getParamValueFromPath(device, 'InternetGatewayDevice.DeviceInfo.SoftwareVersion')

        else
          throw new Error('Unknown configuration type')

    callback(devicePreset)
  )


exports.processDevicePreset = (deviceId, devicePreset, callback) ->
  now = new Date()
  expiry = config.PRESETS_CACHE_DURATION
  getParameterValues = []
  setParameterValues = []
  addTags = []
  deleteTags = []
  taskList = []

  # Parameters
  for parameterPath, parameterDetails of devicePreset.parameters ? {}
    continue if not parameterDetails.current?
    expiry = Math.min(expiry, parameterDetails.preset.expiry) if parameterDetails.preset.expiry?
    presetValue = parameterDetails.preset.value
    currentValue = parameterDetails.current._value
    if presetValue? and currentValue != (presetValue = common.matchType(currentValue, presetValue))
      setParameterValues.push([parameterPath, presetValue, parameterDetails.current._type])
    else if parameterDetails.preset.expiry?
      diff = parameterDetails.preset.expiry - (now - (parameterDetails.current._timestamp ? 0)) / 1000
      if diff <= config.PRESETS_TIME_PADDING
        if parameterDetails.current._value?
          getParameterValues.push(parameterPath)
        else
          taskList.push({device : deviceId, name : 'refreshObject', objectName : parameterPath})
      else
        expiry = Math.min(expiry, diff)

  # Objects
  for parameterPath, object of devicePreset.objects ? {}
    for objectName, objectDetails of object
      continue if not objectDetails.current?
      if objectDetails.preset?
        if Object.keys(objectDetails.current).length > 0
          for i, obj of objectDetails.current
            for paramName, paramValue of objectDetails.preset
              continue if paramName[0] == '_'
              if obj[paramName]
                currentValue = obj[paramName]._value
                presetValue = common.matchType(currentValue, objectDetails.preset[paramName])
                if currentValue != presetValue
                  setParameterValues.push(["#{parameterPath}.#{i}.#{paramName}", presetValue, obj[paramName]._type])
        else
          vals = []
          for k,v of objectDetails.preset
            vals.push([k, v]) if k[0] != '_'
          taskList.push({device : deviceId, name : 'addObject', objectName : parameterPath, parameterValues : vals, instanceName : objectName})
      else if Object.keys(objectDetails.current).length > 0
        for i, obj of objectDetails.current
          taskList.push({device : deviceId, name : 'deleteObject', objectName : "#{parameterPath}.#{i}"})

  # Tags
  for tag, v of devicePreset.tags ? {}
    if v == 1
      deleteTags.push(tag)
    else if v == 2
      addTags.push(tag)

  # Custom commands
  for commandName, commandDetails of devicePreset.customCommands ? {}
    continue if not commandDetails.current?
    expiry = Math.min(expiry, commandDetails.preset.expiry) if commandDetails.preset.expiry?
    currentValue = commandDetails.current._value
    presetValue = common.matchType(currentValue, commandDetails.preset.value)
    if commandDetails.preset.value? and currentValue != presetValue
      taskList.push({device : deviceId, name : 'customCommand', command : commandDetails.preset.valueCommand})
    else if commandDetails.preset.expiry?
      diff = commandDetails.preset.expiry - (now - (commandDetails.current._timestamp ? 0)) / 1000
      if diff <= config.PRESETS_TIME_PADDING
        taskList.push({device : deviceId, name : 'customCommand', command : commandDetails.preset.expiryCommand})
      else
        expiry = Math.min(expiry, diff)

  if setParameterValues.length
    taskList.push {device : deviceId, name : 'setParameterValues', parameterValues: setParameterValues, timestamp : now}

  if getParameterValues.length
    taskList.push {device : deviceId, name : 'getParameterValues', parameterNames: getParameterValues, timestamp : now}

  callback(taskList, addTags, deleteTags, expiry)


getObjectHash = (object) ->
  return object._id if not object._keys? or object._keys.length == 0
  hash = ''
  for k in object._keys
    hash += "#{k}=#{object[k]}"
  return hash


accumulateConfigurations = (presets, objects) ->
  maxWeights = {}
  configurations = {}
  for p in presets
    for c in p.configurations
      configurationHash = switch c.type
        when 'add_tag', 'delete_tag'
          "tag_#{c.tag}"
        when 'add_object', 'delete_object'
          objectHash = getObjectHash(objects[c.object])
          "object_#{c.name}_#{objectHash}"
        when 'software_version'
          'software_version'
        else
          "#{c.type}_#{c.name}"

      if not maxWeights[configurationHash]? or p.weight > maxWeights[configurationHash]
        configurations[configurationHash] = c
        maxWeights[configurationHash] = p.weight

  configurationsList = (configurations[c] for c of configurations)
  return configurationsList
