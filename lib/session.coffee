###
# Copyright 2013-2017  Zaid Abdulla
#
# This file is part of GenieACS.
#
# GenieACS is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# GenieACS is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
###

config = require './config'
common = require './common'
db = require './db'
device = require './device'
sandbox = require './sandbox'
localCache = require './local-cache'
PathSet = require './path-set'
VersionedMap = require './versioned-map'
InstanceSet = require './instance-set'
defaultProvisions = require './default-provisions'

MAX_ITERATIONS = 64

provisionsCache = new WeakMap()
virtualParametersCache = new WeakMap()


initDeviceData = () ->
  return {
    paths : new PathSet()
    timestamps : new VersionedMap()
    attributes : new VersionedMap()
    loaded : new Map()
    trackers : new Map()
    changes : new Set()
  }


init = (deviceId, cwmpVersion, timeout, callback) ->
  timestamp = Date.now()

  sessionContext = {
    timestamp : timestamp
    deviceId : deviceId
    deviceData : initDeviceData()
    cwmpVersion : cwmpVersion
    timeout : timeout
    provisions: []
    channels: {}
    virtualParameters: []
    revisions: [0]
    rpcCount: 0
    iteration: 0
    cycle: 0
    extensionsCache: {}
    declarations: []
  }

  localCache.getProvisionsAndVirtualParameters((err, hash, provisions, virtualParameters) ->
    return callback(err) if err

    sessionContext.presetsHash = hash
    provisionsCache.set(sessionContext, provisions)
    virtualParametersCache.set(sessionContext, virtualParameters)

    return callback(null, sessionContext)
  )


loadParameters = (sessionContext, callback) ->
  if not sessionContext.toLoad?.size
    return callback()

  toLoad = Array.from(sessionContext.toLoad.entries())
  db.fetchDevice(sessionContext.deviceId, sessionContext.timestamp, toLoad, (err, parameters, loaded) ->
    return callback(err) if err

    if not parameters?
      # Device not available in database, mark as new
      sessionContext.new = true
      loaded = [[[], (1 << config.get('MAX_DEPTH', sessionContext.deviceId)) - 1]]
      parameters = []

    for p in loaded
      path = sessionContext.deviceData.paths.add(p[0])

      if p[1]
        l = sessionContext.deviceData.loaded.get(path) | 0
        sessionContext.deviceData.loaded.set(path, l | p[1])

    for p in parameters
      path = sessionContext.deviceData.paths.add(p[0])

      sessionContext.deviceData.timestamps.set(path, p[1], 0)

      if p[2]
        sessionContext.deviceData.attributes.set(path, p[2], 0)

    delete sessionContext.toLoad

    return callback()
  )


generateRpcId = (sessionContext) ->
  return sessionContext.timestamp.toString(16) +
    "0#{sessionContext.cycle.toString(16)}".slice(-2) +
    "0#{sessionContext.rpcCount.toString(16)}".slice(-2)


inform = (sessionContext, rpcReq, callback) ->
  timestamp = sessionContext.timestamp + sessionContext.iteration + 1

  params = []
  params.push([['DeviceID', 'Manufacturer'], timestamp,
    {object: [timestamp, 0], writable: [timestamp, 0], value: [timestamp, [rpcReq.deviceId.Manufacturer, 'xsd:string']]}])

  params.push([['DeviceID', 'OUI'], timestamp,
    {object: [timestamp, 0], writable: [timestamp, 0], value: [timestamp, [rpcReq.deviceId.OUI, 'xsd:string']]}])

  params.push([['DeviceID', 'ProductClass'], timestamp,
    {object: [timestamp, 0], writable: [timestamp, 0], value: [timestamp, [rpcReq.deviceId.ProductClass, 'xsd:string']]}])

  params.push([['DeviceID', 'SerialNumber'], timestamp,
    {object: [timestamp, 0], writable: [timestamp, 0], value: [timestamp, [rpcReq.deviceId.SerialNumber, 'xsd:string']]}])

  for p in rpcReq.parameterList
    path = common.parsePath(p[0])
    params.push([path, timestamp, {object: [timestamp, 0], value: [timestamp, p.slice(1)]}])

  params.push([['Events', 'Inform'], timestamp,
    {object: [timestamp, 0], writable: [timestamp, 0], value: [timestamp, [sessionContext.timestamp, 'xsd:dateTime']]}])

  for e in rpcReq.event
    params.push([['Events', e.replace(' ', '_')], timestamp,
      {object: [timestamp, 0], writable: [timestamp, 0], value: [timestamp, [sessionContext.timestamp, 'xsd:dateTime']]}])

  # Preload DeviceID params
  loadPath(sessionContext, ['DeviceID', '*'])

  for p in params
    loadPath(sessionContext, p[0])

  loadParameters(sessionContext, (err) ->
    return callback(err) if err

    if sessionContext.new
      params.push([['DeviceID', 'ID'], timestamp,
        {object: [timestamp, 0], writable: [timestamp, 0], value: [timestamp, [sessionContext.deviceId, 'xsd:string']]}])

      params.push([['Events', 'Registered'], timestamp,
        {object: [timestamp, 0], writable: [timestamp, 0], value: [timestamp, [sessionContext.timestamp, 'xsd:dateTime']]}])

    sessionContext.deviceData.timestamps.revision = 1
    sessionContext.deviceData.attributes.revision = 1

    toClear = null
    for p in params
      # Don't need to clear wildcards for Events
      if p[0][0] == 'Events'
        device.set(sessionContext.deviceData, p[0], p[1], p[2])
      else
        toClear = device.set(sessionContext.deviceData, p[0], p[1], p[2], toClear)

    clear(sessionContext, toClear, (err) ->
      return callback(err, {name: 'InformResponse'})
    )
  )


transferComplete = (sessionContext, rpcReq, callback) ->
  revision = (sessionContext.revisions[sessionContext.revisions.length - 1] or 0) + 1
  sessionContext.deviceData.timestamps.revision = revision
  sessionContext.deviceData.attributes.revision = revision
  commandKey = rpcReq.commandKey
  operation = sessionContext.operations[commandKey]

  if not operation?
    return callback(null, {name: 'TransferCompleteResponse'})

  instance = operation.args.instance

  delete sessionContext.operations[commandKey]
  sessionContext.operationsTouched ?= {}
  sessionContext.operationsTouched[commandKey] = 1

  if rpcReq.faultStruct? and rpcReq.faultStruct.faultCode != '0'
    return revertDownloadParameters(sessionContext, operation.args.instance, (err) ->
      fault = {
        code: "cwmp.#{rpcReq.faultStruct.faultCode}"
        message: rpcReq.faultStruct.faultString
        detail: rpcReq.faultStruct
        timestamp: operation.timestamp
      }

      return callback(err, {name: 'TransferCompleteResponse'}, operation, fault)
    )

  loadPath(sessionContext, ['Downloads', instance, '*'])

  loadParameters(sessionContext, (err) ->
    return callback(err) if err

    toClear = null
    timestamp = sessionContext.timestamp + sessionContext.iteration + 1

    p = sessionContext.deviceData.paths.add(['Downloads', instance, 'LastDownload'])
    toClear = device.set(sessionContext.deviceData, p, timestamp,
      {value: [timestamp, [operation.timestamp, 'xsd:dateTime']]}, toClear)

    p = sessionContext.deviceData.paths.add(['Downloads', instance, 'LastFileType'])
    toClear = device.set(sessionContext.deviceData, p, timestamp,
      {value: [timestamp, [operation.args.fileType, 'xsd:string']]}, toClear)

    p = sessionContext.deviceData.paths.add(['Downloads', instance, 'LastFileName'])
    toClear = device.set(sessionContext.deviceData, p, timestamp,
      {value: [timestamp, [operation.args.fileName, 'xsd:string']]}, toClear)

    p = sessionContext.deviceData.paths.add(['Downloads', instance, 'LastTargetFileName'])
    toClear = device.set(sessionContext.deviceData, p, timestamp,
      {value: [timestamp, [operation.args.targetFileName, 'xsd:string']]}, toClear)

    p = sessionContext.deviceData.paths.add(['Downloads', instance, 'StartTime'])
    toClear = device.set(sessionContext.deviceData, p, timestamp,
      {value: [timestamp, [+rpcReq.startTime, 'xsd:dateTime']]}, toClear)

    p = sessionContext.deviceData.paths.add(['Downloads', instance, 'CompleteTime'])
    toClear = device.set(sessionContext.deviceData, p, timestamp,
      {value: [timestamp, [+rpcReq.completeTime, 'xsd:dateTime']]}, toClear)

    clear(sessionContext, toClear, (err) ->
      return callback(err, {name: 'TransferCompleteResponse'}, operation)
    )
  )


revertDownloadParameters = (sessionContext, instance, callback) ->
  loadPath(sessionContext, ['Downloads', instance, '*'])

  loadParameters(sessionContext, (err) ->
    return callback(err) if err

    timestamp = sessionContext.timestamp + sessionContext.iteration + 1

    p = sessionContext.deviceData.paths.add(['Downloads', instance, 'LastDownload'])
    LastDownload = sessionContext.deviceData.attributes.get(p)

    p = sessionContext.deviceData.paths.add(['Downloads', instance, 'Download'])
    toClear = device.set(sessionContext.deviceData, p, timestamp,
      {value: [timestamp, [LastDownload?.value[1]?[0] or 0, 'xsd:dateTime']]}, toClear)

    clear(sessionContext, toClear, callback)
  )

timeoutOperations = (sessionContext, callback) ->
  revision = (sessionContext.revisions[sessionContext.revisions.length - 1] or 0) + 1
  sessionContext.deviceData.timestamps.revision = revision
  sessionContext.deviceData.attributes.revision = revision
  faults = []
  operations = []
  counter = 3

  for commandKey, operation of sessionContext.operations
    if operation.name isnt 'Download'
      return callback(new Error("Unknown operation name #{operation.name}"))

    DOWNLOAD_TIMEOUT = config.get('DOWNLOAD_TIMEOUT', sessionContext.deviceId) * 1000

    if sessionContext.timestamp > operation.timestamp + DOWNLOAD_TIMEOUT
      delete sessionContext.operations[commandKey]
      sessionContext.operationsTouched ?= {}
      sessionContext.operationsTouched[commandKey] = 1

      faults.push({
        code: 'timeout'
        message: 'Download operation timed out'
        timestamp: operation.timestamp
      })

      operations.push(operation)

      counter += 2
      revertDownloadParameters(sessionContext, operation.args.instance, (err) ->
        if err
          callback(err) if counter & 1
          return counter = 0

        return callback(null, faults, operations) if (counter -= 2) == 1
      )

  return callback(null, faults, operations) if (counter -= 2) == 1


addProvisions = (sessionContext, channel, provisions) ->
  delete sessionContext.syncState
  delete sessionContext.rpcRequest
  sessionContext.declarations = []
  sessionContext.provisionsRet = []
  if sessionContext.revisions[sessionContext.revisions.length - 1] > 0
    sessionContext.deviceData.timestamps.collapse(1)
    sessionContext.deviceData.attributes.collapse(1)
    sessionContext.revisions = [0]
    sessionContext.extensionsCache = {}

  if sessionContext.iteration != sessionContext.cycle * MAX_ITERATIONS
    sessionContext.cycle += 1
    sessionContext.rpcCount = 0
    sessionContext.iteration = sessionContext.cycle * MAX_ITERATIONS

  sessionContext.channels[channel] |= 0

  for provision, i in provisions
    channels = [channel]
    # Remove duplicate provisions
    provisionStr = JSON.stringify(provision)
    for p, j in sessionContext.provisions
      if JSON.stringify(p) == provisionStr
        sessionContext.provisions.splice(j, 1)
        for c of sessionContext.channels
          channels.push(c) if sessionContext.channels[c] & (1 << j)
          a = sessionContext.channels[c] >> (j + 1)
          sessionContext.channels[c] &= ((1 << j) - 1)
          sessionContext.channels[c] |= (a << j)

    for c in channels
      sessionContext.channels[c] |= (1 << sessionContext.provisions.length)
    sessionContext.provisions.push(provision)


clearProvisions = (sessionContext) ->
  if sessionContext.revisions[sessionContext.revisions.length - 1] > 0
    sessionContext.deviceData.timestamps.collapse(1)
    sessionContext.deviceData.attributes.collapse(1)

  if sessionContext.iteration != sessionContext.cycle * MAX_ITERATIONS
    sessionContext.cycle += 1
    sessionContext.rpcCount = 0
    sessionContext.iteration = sessionContext.cycle * MAX_ITERATIONS

  delete sessionContext.syncState
  delete sessionContext.rpcRequest
  sessionContext.provisions = []
  sessionContext.virtualParameters = []
  sessionContext.channels = {}
  sessionContext.declarations = []
  sessionContext.provisionsRet = []
  sessionContext.revisions = [0]
  sessionContext.extensionsCache = {}


runProvisions = (sessionContext, provisions, startRevision, endRevision, callback) ->
  done = true
  allDeclarations = []
  allClear = []
  counter = 3
  allProvisions = provisionsCache.get(sessionContext)
  for provision, j in provisions
    if not allProvisions[provision[0]]?
      allDeclarations[j] = []
      allClear[j] = []
      if defaultProvisions[provision[0]]
        done = defaultProvisions[provision[0]](sessionContext, provision, allDeclarations[j], startRevision, endRevision) and done
      continue

    counter += 2
    do (j) -> sandbox.run(allProvisions[provision[0]].script,
      {args: provision.slice(1)}, sessionContext, startRevision, endRevision,
      (err, _fault, _clear, _declarations, _done) ->
        if err or _fault
          callback(err, _fault) if counter & 1
          return counter = 0

        done &&= _done
        allDeclarations[j] = _declarations or []
        allClear[j] = _clear or []

        if (counter -= 2) == 1
          allDeclarations = Array.prototype.concat.apply([], allDeclarations)
          allClear = Array.prototype.concat.apply([], allClear)
          return callback(null, null, done, allDeclarations, allClear)
      )

  if (counter -= 2) == 1
    allDeclarations = Array.prototype.concat.apply([], allDeclarations)
    allClear = Array.prototype.concat.apply([], allClear)
    return callback(null, null, done, allDeclarations, allClear)


runVirtualParameters = (sessionContext, provisions, startRevision, endRevision, callback) ->
  done = true
  virtualParameterUpdates = []
  allDeclarations = []
  allClear = []
  counter = 3
  allVirtualParameters = virtualParametersCache.get(sessionContext)
  for provision, j in provisions
    counter += 2
    globals = {args: provision.slice(1)}
    do (provision, j) -> sandbox.run(allVirtualParameters[provision[0]].script, globals,
      sessionContext, startRevision, endRevision,
      (err, _fault, _clear, _declarations, _done, _returnValue) ->
        if err or _fault
          callback(err, _fault) if counter & 1
          return counter = 0

        done &&= _done
        allDeclarations[j] = _declarations or []
        allClear[j] = _clear or []
        if _done
          if not _returnValue
            if counter & 1
              callback(null, {code: 'script', message: 'Invalid virtual parameter return value'})
            return counter = 0

          ret = {}

          if _returnValue.writable?
            ret.writable = +!!_returnValue.writable
          else if provision[1].writable? or provision[2].writable?
            if counter & 1
              callback(null, {code: 'script', message: 'Virtual parameter must provide declared attributes'})
            return counter = 0

          if _returnValue.value?
            ret.value = device.sanitizeParameterValue(_returnValue.value)
          else if provision[1].value? or provision[2].value?
            if counter & 1
              callback(null, {code: 'script', message: 'Virtual parameter must provide declared attributes'})
            return counter = 0

          virtualParameterUpdates[j] = ret

        if (counter -= 2) == 1
          allDeclarations = Array.prototype.concat.apply([], allDeclarations)
          allClear = Array.prototype.concat.apply([], allClear)
          return callback(null, null, (if done then virtualParameterUpdates else null), allDeclarations, allClear)
      )

  if (counter -= 2) == 1
    allDeclarations = Array.prototype.concat.apply([], allDeclarations)
    allClear = Array.prototype.concat.apply([], allClear)
    return callback(null, null, (if done then virtualParameterUpdates else null), allDeclarations, allClear)


runDeclarations = (sessionContext, declarations) ->
  sessionContext.syncState ?= {
    refreshAttributes: {
      exist: new Set()
      object: new Set()
      writable: new Set()
      value: new Set()
    }
    spv: new Map()
    gpn: new Set()
    gpnPatterns: new Map()
    tags: new Map()

    virtualParameterDeclarations: []
    instancesToDelete: new Map()
    instancesToCreate: new Map()

    downloadsToDelete: new Set()
    downloadsToCreate: new InstanceSet()
    downloadsValues: new Map()
    downloadsDownload: new Map()
  }

  allDeclareTimestamps = new Map()
  allDeclareAttributeTimestamps = new Map()
  allDeclareAttributeValues = new Map()

  allVirtualParameters = virtualParametersCache.get(sessionContext)

  mergeAttributeTimestamps = (p, attrs) ->
    if cur = allDeclareAttributeTimestamps.get(p)
      cur = Object.assign({}, cur)
      cur[k] = Math.max(v, cur[k] or 0) for k, v of attrs
      allDeclareAttributeTimestamps.set(p, cur)
    else
      allDeclareAttributeTimestamps.set(p, attrs)

  mergeAttributeValues = (p, attrs) ->
    if cur = allDeclareAttributeValues.get(p)
      cur = Object.assign({}, cur, attrs)
      allDeclareAttributeValues.set(p, cur)
    else
      allDeclareAttributeValues.set(p, attrs)

  for declaration, i in declarations
    path = common.addPathMeta(declaration[0])
    unpacked = null

    if (path.alias | path.wildcard) & 1 or path[0] == 'VirtualParameters'
      sessionContext.deviceData.paths.add(['VirtualParameters'])
      if (path.alias | path.wildcard) & 2
        sessionContext.deviceData.paths.add(['VirtualParameters', '*'])
        for k of allVirtualParameters
          sessionContext.deviceData.paths.add(['VirtualParameters', k])

    if (path.alias | path.wildcard) & 1 or path[0] == 'Reboot'
      sessionContext.deviceData.paths.add(['Reboot'])

    if (path.alias | path.wildcard) & 1 or path[0] == 'FactoryReset'
      sessionContext.deviceData.paths.add(['FactoryReset'])

    if path.alias
      aliasDecs = device.getAliasDeclarations(path, declaration[1] or 1)
      for ad in aliasDecs
        p = sessionContext.deviceData.paths.add(ad[0])
        allDeclareTimestamps.set(p, Math.max(ad[1] or 1, allDeclareTimestamps.get(p) or 0))
        attrTrackers = null
        if ad[2]
          attrTrackers = Object.keys(ad[2])
          mergeAttributeTimestamps(p, ad[2])
        device.track(sessionContext.deviceData, p, 'prerequisite', attrTrackers)

      unpacked = device.unpack(sessionContext.deviceData, path)
      for u in unpacked
        allDeclareTimestamps.set(u, Math.max(declaration[1] or 1, allDeclareTimestamps.get(u) or 0))
        if declaration[2]
          mergeAttributeTimestamps(u, declaration[2])
    else
      path = sessionContext.deviceData.paths.add(path)
      allDeclareTimestamps.set(path, Math.max(declaration[1] or 1, allDeclareTimestamps.get(path) or 0))
      if declaration[2]
        mergeAttributeTimestamps(path, declaration[2])
      device.track(sessionContext.deviceData, path, 'prerequisite')

    if declaration[4]
      if path.alias | path.wildcard
        unpacked ?= device.unpack(sessionContext.deviceData, path)
        for u in unpacked
          mergeAttributeValues(u, declaration[4])
      else
        mergeAttributeValues(path, declaration[4])

    if declaration[3]?
      if Array.isArray(declaration[3])
        minInstances = declaration[3][0]
        maxInstances = declaration[3][1]
      else
        minInstances = maxInstances = declaration[3]

      parent = common.addPathMeta(path.slice(0, -1))

      keys = null
      if Array.isArray(path[path.length - 1])
        keys = {}
        for p, i in path[path.length - 1] by 2
          keys[p.join('.')] = path[path.length - 1][i + 1]
      else if path[path.length - 1] == '*'
        keys = {}

      if ((path.wildcard | path.alias) & ((1 << (path.length - 1)) - 1)) == 0
        parent = sessionContext.deviceData.paths.add(parent)
        unpacked ?= device.unpack(sessionContext.deviceData, path)
        processInstances(sessionContext, parent, unpacked, keys, minInstances, maxInstances)
      else
        parentsUnpacked = device.unpack(sessionContext.deviceData, parent)
        for parent in parentsUnpacked
          parent = sessionContext.deviceData.paths.add(parent)
          processInstances(sessionContext, parent, device.unpack(sessionContext.deviceData, common.addPathMeta(parent.concat([path[parent.length]]))), keys, minInstances, maxInstances)

  return processDeclarations(sessionContext, allDeclareTimestamps, allDeclareAttributeTimestamps, allDeclareAttributeValues)


rpcRequest = (sessionContext, _declarations, callback) ->
  if sessionContext.rpcRequest?
    return callback(null, null, generateRpcId(sessionContext), sessionContext.rpcRequest)

  if sessionContext.virtualParameters.length == 0 and
      sessionContext.declarations.length == 0 and
      not _declarations?.length and
      sessionContext.provisions.length == 0
    return callback()

  if sessionContext.declarations.length <= sessionContext.virtualParameters.length
    inception = sessionContext.declarations.length
    revision = (sessionContext.revisions[inception] or 0) + 1
    sessionContext.deviceData.timestamps.revision = revision
    sessionContext.deviceData.attributes.revision = revision

    if inception == 0
      run = runProvisions
      provisions = sessionContext.provisions
    else
      run = runVirtualParameters
      provisions = sessionContext.virtualParameters[inception - 1]

    return run(sessionContext, provisions, sessionContext.revisions[inception - 1] or 0, sessionContext.revisions[inception], (err, fault, ret, decs, toClear) ->
      return callback(err) if err

      if fault
        fault.timestamp = sessionContext.timestamp
        return callback(null, fault)

      # Enforce max clear timestamp
      for c in toClear
        c[1] = sessionContext.timestamp if c[1] > sessionContext.timestamp
        for k, v of c[2]
          c[2][k] = sessionContext.timestamp if v > sessionContext.timestamp

      sessionContext.declarations.push(decs)
      sessionContext.provisionsRet[inception] = ret

      for d in decs
        # Enforce max timestamp
        d[1] = sessionContext.timestamp if d[1] > sessionContext.timestamp
        for k, v of d[2]
          d[2][k] = sessionContext.timestamp if v > sessionContext.timestamp

        for ad in device.getAliasDeclarations(d[0], 1)
          loadPath(sessionContext, ad[0])

      return clear(sessionContext, toClear, (err) ->
        return callback(err) if err
        loadParameters(sessionContext, (err) ->
          return callback(err) if err
          rpcRequest(sessionContext, _declarations, callback)
        )
      )
    )

  if _declarations?.length
    delete sessionContext.syncState
    sessionContext.declarations[0] ?= []
    sessionContext.declarations[0] = sessionContext.declarations[0].concat(_declarations)

    for d in _declarations
      for ad in device.getAliasDeclarations(d[0], 1)
        loadPath(sessionContext, ad[0])

    return loadParameters(sessionContext, (err) ->
      return callback(err) if err
      return rpcRequest(sessionContext, null, callback)
    )

  if sessionContext.rpcCount >= 255
    return callback(null, {
      code: 'too_many_rpcs'
      message: 'Too many RPC requests'
      timestamp: sessionContext.timestamp
    })

  if sessionContext.revisions.length >= 8
    return callback(null, {
      code: 'deeply_nested_vparams'
      message: 'Virtual parameters are referencing other virtual parameters in a deeply nested manner'
      timestamp: sessionContext.timestamp
    })

  if sessionContext.cycle >= 255
    return callback(null, {
      code: 'too_many_cycles'
      message: 'Too many provision cycles'
      timestamp: sessionContext.timestamp
    })

  if sessionContext.iteration >= MAX_ITERATIONS * (sessionContext.cycle + 1)
    return callback(null, {
      code: 'too_many_commits'
      message: 'Too many commit iterations'
      timestamp: sessionContext.timestamp
    })

  if (sessionContext.syncState?.virtualParameterDeclarations?.length or 0) < sessionContext.declarations.length
    inception = sessionContext.syncState?.virtualParameterDeclarations?.length or 0
    # Avoid unnecessary increment of iteration when using vparams
    sessionContext.iteration += 2 if inception == sessionContext.declarations.length - 1
    vpd = runDeclarations(sessionContext, sessionContext.declarations[inception])
    timestamp = sessionContext.timestamp + sessionContext.iteration
    toClear = null

    allVirtualParameters = virtualParametersCache.get(sessionContext)

    vpd = vpd.filter((declaration) ->
      if Object.keys(allVirtualParameters).length
        if declaration[0].length == 1
          # Avoid setting on every inform as "exist" timestamp is not saved in DB
          if not sessionContext.deviceData.attributes.has(declaration[0])
            toClear = device.set(sessionContext.deviceData, declaration[0], timestamp, {object: [timestamp, 1], writable: [timestamp, 0]}, toClear)
          return false
        else if declaration[0].length == 2
          if declaration[0][1] == '*'
            for k, v of allVirtualParameters
              toClear = device.set(sessionContext.deviceData, ['VirtualParameters', k], timestamp, {object: [timestamp, 0]}, toClear)
            toClear = device.set(sessionContext.deviceData, declaration[0], timestamp, null, toClear)
            return false
          else if declaration[0][1] of allVirtualParameters
            # Avoid setting on every inform as "exist" timestamp is not saved in DB
            if not sessionContext.deviceData.attributes.has(declaration[0])
              toClear = device.set(sessionContext.deviceData, declaration[0], timestamp, {object: [timestamp, 0]}, toClear)
            return true

      for p in sessionContext.deviceData.paths.find(declaration[0], false, true)
        if sessionContext.deviceData.attributes.has(p)
          toClear ?= []
          toClear.push([declaration[0], timestamp])
          break

      return false
    )

    return clear(sessionContext, toClear, (err) ->
      return callback(err) if err
      sessionContext.syncState.virtualParameterDeclarations[inception] = vpd
      return rpcRequest(sessionContext, null, callback)
    )

  if not sessionContext.syncState?
    return callback()

  inception = sessionContext.declarations.length - 1

  provisions = generateGetVirtualParameterProvisions(sessionContext, sessionContext.syncState.virtualParameterDeclarations[inception])
  if not provisions
    sessionContext.rpcRequest = generateGetRpcRequest(sessionContext)
    if not sessionContext.rpcRequest
      # Only check after read stage is complete to minimize reprocessing of
      # declarations especially during initial discovery of data model
      if sessionContext.deviceData.changes.has('prerequisite')
        delete sessionContext.syncState
        device.clearTrackers(sessionContext.deviceData, 'prerequisite')
        return rpcRequest(sessionContext, null, callback)

      toClear = null
      timestamp = sessionContext.timestamp + sessionContext.iteration + 1

      # Update tags
      sessionContext.syncState.tags.forEach((v, p) ->
        c = sessionContext.deviceData.attributes.get(p)
        if v and not c?
          toClear = device.set(sessionContext.deviceData, p, timestamp, {object: [timestamp, false], writable: [timestamp, true], value: [timestamp, [true, 'xsd:boolean']]}, toClear)
        else if c? and not v
          toClear = device.set(sessionContext.deviceData, p, timestamp, null, toClear)
      )

      # Downloads
      index = null
      sessionContext.syncState.downloadsToCreate.forEach((instance) ->
        if not index?
          index = 0
          for p in sessionContext.deviceData.paths.find(['Downloads', '*'], false, true)
            if +p[1] > index and sessionContext.deviceData.attributes.has(p)
              index = +p[1]

        ++ index

        toClear = device.set(sessionContext.deviceData, ['Downloads'],
          timestamp,
          {object: [timestamp, 1], writable: [timestamp, 1]}, toClear)

        toClear = device.set(sessionContext.deviceData, ['Downloads', "#{index}"],
          timestamp,
          {object: [timestamp, 1], writable: [timestamp, 1]}, toClear)

        params = {
          'FileType': {writable: 1, value: [instance.FileType or '', 'xsd:string']}
          'FileName': {writable: 1, value: [instance.FileName or '', 'xsd:string']}
          'TargetFileName': {writable: 1, value: [instance.TargetFileName or '', 'xsd:string']}
          'Download': {writable: 1, value: [instance.Download or 0, 'xsd:dateTime']}
          'LastFileType': {writable: 0, value: ['', 'xsd:string']}
          'LastFileName': {writable: 0, value: ['', 'xsd:string']}
          'LastTargetFileName': {writable: 0, value: ['', 'xsd:string']}
          'LastDownload': {writable: 0, value: [0, 'xsd:dateTime']}
          'StartTime': {writable: 0, value: [0, 'xsd:dateTime']}
          'CompleteTime': {writable: 0, value: [0, 'xsd:dateTime']}
        }

        for k, v of params
          toClear = device.set(sessionContext.deviceData, ['Downloads', "#{index}", k],
            timestamp, {object: [timestamp, 0], writable: [timestamp, v.writable], value: [timestamp, v.value]}, toClear)

        toClear = device.set(sessionContext.deviceData, ['Downloads', "#{index}", '*'],
          timestamp, null, toClear)
      )
      sessionContext.syncState.downloadsToCreate.clear()

      sessionContext.syncState.downloadsToDelete.forEach((instance) ->
        toClear = device.set(sessionContext.deviceData, instance, timestamp, null, toClear)
        sessionContext.syncState.downloadsValues.forEach((v, p) ->
          if p[1] == instance[1]
            sessionContext.syncState.downloadsValues.delete(p)
        )
      )
      sessionContext.syncState.downloadsToDelete.clear()

      sessionContext.syncState.downloadsValues.forEach((v, p) ->
        if attrs = sessionContext.deviceData.attributes.get(p)
          if attrs.writable?[1] and attrs.value?
            v = device.sanitizeParameterValue([v, attrs.value[1][1]])
            if v[0] != attrs.value[1][0]
              toClear = device.set(sessionContext.deviceData, p, timestamp, {value: [timestamp, v]}, toClear)
      )

      if toClear or sessionContext.deviceData.changes.has('prerequisite')
        return clear(sessionContext, toClear, (err) ->
          return callback(err) if err
          rpcRequest(sessionContext, null, callback)
        )

      provisions = generateSetVirtualParameterProvisions(sessionContext, sessionContext.syncState.virtualParameterDeclarations[inception])
      if not provisions
        sessionContext.rpcRequest = generateSetRpcRequest(sessionContext)

  if provisions
    sessionContext.virtualParameters.push(provisions)
    sessionContext.revisions.push(sessionContext.revisions[inception])
    return rpcRequest(sessionContext, null, callback)

  if sessionContext.rpcRequest
    return callback(null, null, generateRpcId(sessionContext), sessionContext.rpcRequest)

  ++ sessionContext.revisions[inception]
  sessionContext.declarations.pop()
  sessionContext.syncState.virtualParameterDeclarations.pop()

  ret = sessionContext.provisionsRet.splice(inception)[0]
  if not ret
    return rpcRequest(sessionContext, null, callback)

  sessionContext.revisions.pop()
  rev = sessionContext.revisions[sessionContext.revisions.length - 1] or 0
  sessionContext.deviceData.timestamps.collapse(rev + 1)
  sessionContext.deviceData.attributes.collapse(rev + 1)
  sessionContext.deviceData.timestamps.revision = rev + 1
  sessionContext.deviceData.attributes.revision = rev + 1

  for k of sessionContext.extensionsCache
    if rev < Number(k.split(':', 1)[0])
      delete sessionContext.extensionsCache[k]

  vparams = sessionContext.virtualParameters.pop()

  if not vparams
    return callback()

  timestamp = sessionContext.timestamp + sessionContext.iteration
  toClear = null
  for vpu, i in ret
    vpu[k] = [timestamp + (if vparams[i][2][k]? then 1 else 0), v] for k, v of vpu
    toClear = device.set(sessionContext.deviceData, ['VirtualParameters', vparams[i][0]], timestamp, vpu, toClear)

  clear(sessionContext, toClear, (err) ->
    return callback(err) if err
    rpcRequest(sessionContext, null, callback)
  )


# Simple algorithm to estimate GPN count in a set of patterns used
# to decide whether to use nextLevel = false in GPN.
estimateGpnCount = (patterns) ->
  res = []
  counts = new Map()
  for pattern in patterns
    c = []
    i = -1
    while pattern[1] >> (++ i)
      if pattern[1] & (1 << i)
        f = (pattern[0].wildcard & pattern[1]) | ((pattern[1] >> pattern[0].length) << pattern[0].length)
        r = [i, f & ((1 << i) - 1), 1, new Set()]
        res.push(c[i] = r)
    counts.set(pattern, c)

  for pattern in patterns
    pats = patterns.filter((pat) -> return pat != pattern)
    i = -1
    while pattern[1] >> (++ i)
      pats = pats.filter((pat) ->
        return false if not pat[1] << i
        if not pat[0][i]? or pat[0][i] == '*' or pat[0][i] == pattern[0][i]
          if pattern[1] & pat[1] & (1 << i)
            counts.get(pattern)[i][3].add(counts.get(pat)[i])
          return true
        return false
      )

  count = 0
  for r in res
    div = 1
    r[3].forEach((rr) -> ++ div if rr[3].has(r))
    if r[3].size == div - 1
      h = common.hammingWeight(r[1])
      if h < 8
        count += (r[2] * Math.pow(3, h)) / div

  return Math.round(count)


generateGetRpcRequest = (sessionContext) ->
  if not (syncState = sessionContext.syncState)?
    return

  iter = syncState.refreshAttributes.exist.values()
  while (path = iter.next().value)
    found = false
    for p in sessionContext.deviceData.paths.find(path, false, true, 99)
      if syncState.refreshAttributes.value.has(p) or
          syncState.refreshAttributes.object.has(p) or
          syncState.refreshAttributes.writable.has(p) or
          syncState.gpn.has(p)
        found = true
        break
    if not found
      p = sessionContext.deviceData.paths.add(path.slice(0, -1))
      syncState.gpn.add(p)
      f = 1 << p.length
      syncState.gpnPatterns.set(p, f | syncState.gpnPatterns.get(p))
  syncState.refreshAttributes.exist.clear()

  iter = syncState.refreshAttributes.object.values()
  while (path = iter.next().value)
    found = false
    for p in sessionContext.deviceData.paths.find(path, false, true, 99)
      if syncState.refreshAttributes.value.has(p) or
          (p.length > path.length and
          (syncState.refreshAttributes.object.has(p) or
          syncState.refreshAttributes.writable.has(p)))
        found = true
        break
    if not found
      p = sessionContext.deviceData.paths.add(path.slice(0, -1))
      syncState.gpn.add(p)
      f = 1 << p.length
      syncState.gpnPatterns.set(p, f | syncState.gpnPatterns.get(p))
  syncState.refreshAttributes.object.clear()

  iter = syncState.refreshAttributes.writable.values()
  while (path = iter.next().value)
    p = sessionContext.deviceData.paths.add(path.slice(0, -1))
    syncState.gpn.add(p)
    f = 1 << p.length
    syncState.gpnPatterns.set(p, f | syncState.gpnPatterns.get(p))
  syncState.refreshAttributes.writable.clear()

  if syncState.gpn.size
    GPN_NEXT_LEVEL = config.get('GPN_NEXT_LEVEL', sessionContext.deviceId)

    paths = Array.from(syncState.gpn.keys()).sort((a,b) -> b.length - a.length)
    path = paths.pop()
    while path and path.length and not sessionContext.deviceData.attributes.has(path)
      syncState.gpn.delete(path)
      path = paths.pop()

    if path
      patterns = []
      for p in sessionContext.deviceData.paths.find(path, true, false, 99)
        if v = syncState.gpnPatterns.get(p)
          patterns.push([p, (v >> path.length) << path.length])

      if path.length >= GPN_NEXT_LEVEL
        est = estimateGpnCount(patterns)
      else
        est = 0

      if est < Math.pow(2, Math.max(0, 8 - path.length))
        nextLevel = true
        syncState.gpn.delete(path)
      else
        nextLevel = false
        for p in sessionContext.deviceData.paths.find(path, false, true, 99)
          syncState.gpn.delete(p)

      return {
        name: 'GetParameterNames'
        parameterPath: path.concat('').join('.')
        nextLevel: nextLevel
      }

  if syncState.refreshAttributes.value.size
    GPV_BATCH_SIZE = config.get('GPV_BATCH_SIZE', sessionContext.deviceId)

    parameterNames = []
    iter = syncState.refreshAttributes.value.values()
    while (path = iter.next().value) and
        parameterNames.length < GPV_BATCH_SIZE
      syncState.refreshAttributes.value.delete(path)
      if sessionContext.deviceData.attributes.has(path)
        parameterNames.push(path)

    if parameterNames.length
      return {
        name: 'GetParameterValues'
        parameterNames: (p.join('.') for p in parameterNames)
      }

  return null


generateSetRpcRequest = (sessionContext) ->
  if not (syncState = sessionContext.syncState)?
    return

  deviceData = sessionContext.deviceData

  # Delete instance
  iter = syncState.instancesToDelete.values()
  while instances = iter.next().value
    if (instance = instances.values().next().value) and
        sessionContext.deviceData.attributes.has(instance)
      return {
        name: 'DeleteObject'
        objectName: instance.concat('').join('.')
      }

  # Create instance
  iter = syncState.instancesToCreate.entries()
  while pair = iter.next().value
    if sessionContext.deviceData.attributes.has(pair[0]) and
        instance = pair[1].values().next().value
      pair[1].delete(instance)
      return {
        name: 'AddObject'
        objectName: pair[0].concat('').join('.')
        instanceValues: instance
        next: 'getInstanceKeys'
      }

  # Set values
  GPV_BATCH_SIZE = config.get('GPV_BATCH_SIZE', sessionContext.deviceId)
  DATETIME_MILLISECONDS = config.get('DATETIME_MILLISECONDS', sessionContext.deviceId)
  BOOLEAN_LITERAL = config.get('BOOLEAN_LITERAL', sessionContext.deviceId)

  parameterValues = []
  syncState.spv.forEach((v, k) ->
    return if parameterValues.length >= GPV_BATCH_SIZE
    syncState.spv.delete(k)
    attrs = sessionContext.deviceData.attributes.get(k)
    if (curVal = attrs.value?[1])? and attrs.writable?[1]
      val = v.slice()
      val[1] = curVal[1] if not val[1]?
      device.sanitizeParameterValue(val)

      # Strip milliseconds
      if val[1] == 'xsd:dateTime' and not DATETIME_MILLISECONDS and typeof val[0] == 'number'
        val[0] -= val[0] % 1000

      if val[0] != curVal[0] or val[1] != curVal[1]
        parameterValues.push([k, val[0], val[1]])
  )

  if parameterValues.length
    return {
      name: 'SetParameterValues'
      parameterList: ([p[0].join('.'), p[1], p[2]] for p in parameterValues)
      DATETIME_MILLISECONDS: DATETIME_MILLISECONDS
      BOOLEAN_LITERAL: BOOLEAN_LITERAL
    }

  # Download
  iter = syncState.downloadsDownload.entries()
  while pair = iter.next().value
    if not (pair[1] <= deviceData.attributes.get(pair[0])?.value?[1][0])
      fileTypePath = deviceData.paths.get(pair[0].slice(0, -1).concat('FileType'))
      fileNamePath = deviceData.paths.get(pair[0].slice(0, -1).concat('FileName'))
      targetFileNamePath = deviceData.paths.get(pair[0].slice(0, -1).concat('TargetFileName'))
      return {
        name: 'Download'
        commandKey: generateRpcId(sessionContext)
        instance: pair[0][1]
        fileType: deviceData.attributes.get(fileTypePath)?.value?[1][0]
        fileName: deviceData.attributes.get(fileNamePath)?.value?[1][0]
        targetFileName: deviceData.attributes.get(targetFileNamePath)?.value?[1][0]
      }

  # Reboot
  if syncState.reboot?
    p = sessionContext.deviceData.paths.get(['Reboot'])
    if not (p? and sessionContext.deviceData.attributes.get(p)?.value?[1][0] >= syncState.reboot)
      delete syncState.reboot
      return {
        name: 'Reboot'
      }

  # Factory reset
  if syncState.factoryReset?
    p = sessionContext.deviceData.paths.get(['FactoryReset'])
    if not (p? and sessionContext.deviceData.attributes.get(p)?.value?[1][0] >= syncState.factoryReset)
      delete syncState.factoryReset
      return {
        name: 'FactoryReset'
      }

  return null


generateGetVirtualParameterProvisions = (sessionContext, virtualParameterDeclarations) ->
  provisions = null
  for declaration in virtualParameterDeclarations
    if declaration[1]
      currentTimestamps = {}
      currentValues = {}
      dec = {}
      attrs = sessionContext.deviceData.attributes.get(declaration[0]) or {}
      for k, v of declaration[1]
        continue if k != 'value' and k != 'writable'
        if not attrs[k] or v > attrs[k][0]
          dec[k] = v
      for k, v of attrs
        currentTimestamps[k] = v[0]
        currentValues[k] = v[1]
      if (Object.keys(dec).length)
        provisions ?= []
        provisions.push([declaration[0][1], dec, {}, currentTimestamps, currentValues])

  return provisions


generateSetVirtualParameterProvisions = (sessionContext, virtualParameterDeclarations) ->
  provisions = null
  for declaration in virtualParameterDeclarations
    if declaration[2]?.value?
      attrs = sessionContext.deviceData.attributes.get(declaration[0])
      if (curVal = attrs.value?[1])? and attrs.writable?[1]
        val = declaration[2].value.slice()
        val[1] = curVal[1] if not val[1]?
        device.sanitizeParameterValue(val)

        if val[0] != curVal[0] or val[1] != curVal[1]
          provisions ?= []
          currentTimestamps = {}
          currentValues = {}
          for k, v of attrs
            currentTimestamps[k] = v[0]
            currentValues[k] = v[1]
          provisions.push([declaration[0][1], {}, {value: val}, currentTimestamps, currentValues])

  return provisions


processDeclarations = (sessionContext, allDeclareTimestamps, allDeclareAttributeTimestamps, allDeclareAttributeValues) ->
  deviceData = sessionContext.deviceData
  syncState = sessionContext.syncState

  root = sessionContext.deviceData.paths.add([])
  paths = sessionContext.deviceData.paths.find([], false, true, 99)
  paths.sort((a, b) ->
    if a.wildcard == b.wildcard
      return a.length - b.length

    return a.wildcard - b.wildcard
  )

  toClear = null
  virtualParameterDeclarations = []

  func = (leafParam, leafIsObject, leafTimestamp, paths) ->
    currentPath = paths[0]
    children = {}
    declareTimestamp = 0
    declareAttributeTimestamps = null
    declareAttributeValues = null

    currentTimestamp = 0
    currentAttributes = null
    if currentPath.wildcard == 0
      currentAttributes = deviceData.attributes.get(currentPath)

    for path in paths
      if path.length > currentPath.length
        fragment = path[currentPath.length]
        if not children[fragment]
          children[fragment] = []
          if path.length > currentPath.length + 1
            # This is to ensure we don't descend more than one step at a time
            p = common.addPathMeta(path.slice(0, currentPath.length + 1))
            children[fragment].push(p)
        children[fragment].push(path)
        continue

      currentTimestamp = Math.max(currentTimestamp, deviceData.timestamps.get(path) ? 0)
      declareTimestamp = Math.max(declareTimestamp, allDeclareTimestamps.get(path) ? 0)

      if currentPath.wildcard == 0
        if attrs = allDeclareAttributeTimestamps.get(path)
          if declareAttributeTimestamps
            delcareAttributeTimestamps = Object.assign({}, declareAttributeTimestamps)
            declareAttributeTimestamps[k] = Math.max(v, attrs[k] or 0) for k, v of attrs
          else
            declareAttributeTimestamps = attrs

        if attrs = allDeclareAttributeValues.get(path)
          declareAttributeValues = attrs

    if currentAttributes
      leafParam = currentPath
      leafIsObject = currentAttributes.object?[1]
      if leafIsObject == 0
        leafTimestamp = Math.max(leafTimestamp, currentAttributes.object[0])
    else
      leafTimestamp = Math.max(leafTimestamp, currentTimestamp)

    switch (if currentPath[0] != '*' then currentPath[0] else leafParam[0])
      when 'Reboot'
        if currentPath.length == 1
          if declareAttributeValues?.value?
            syncState.reboot = +(new Date(declareAttributeValues.value[0]))
      when 'FactoryReset'
        if currentPath.length == 1
          if declareAttributeValues?.value?
            syncState.factoryReset = +(new Date(declareAttributeValues.value[0]))
      when 'Tags'
        if currentPath.length == 2 and currentPath.wildcard == 0 and declareAttributeValues?.value?
          syncState.tags.set(currentPath, device.sanitizeParameterValue([declareAttributeValues.value[0], 'xsd:boolean'])[0])
      when 'Events', 'DeviceID' then
        # Do nothing
      when 'Downloads'
        if currentPath.length == 3 and currentPath.wildcard == 0 and declareAttributeValues?.value?
          if currentPath[2] == 'Download'
            syncState.downloadsDownload.set(currentPath, declareAttributeValues.value[0])
          else
            syncState.downloadsValues.set(currentPath, declareAttributeValues.value[0])
      when 'VirtualParameters'
        if currentPath.length <= 2
          d = null
          if not (declareTimestamp <= currentTimestamp)
            d = [currentPath]

          if currentPath.wildcard == 0
            if declareAttributeTimestamps
              for attrName of declareAttributeTimestamps
                if not (declareAttributeTimestamps[attrName] <= currentAttributes?[attrName]?[0])
                  d ?= [currentPath]
                  d[1] ?= {}
                  d[1][attrName] = declareAttributeTimestamps[attrName]

            if declareAttributeValues
              d ?= [currentPath]
              d[2] = declareAttributeValues

          virtualParameterDeclarations.push(d) if d
      else
        if declareTimestamp > currentTimestamp and declareTimestamp > leafTimestamp
          if currentPath == leafParam
            syncState.refreshAttributes.exist.add(leafParam)
          else if leafIsObject
            syncState.gpn.add(leafParam)
            if leafTimestamp > 0
              f = 1 << leafParam.length
              syncState.gpnPatterns.set(leafParam, f | syncState.gpnPatterns.get(leafParam))
            else
              f = ((1 << currentPath.length) - 1) ^ ((1 << leafParam.length) - 1)
              syncState.gpnPatterns.set(currentPath, f | syncState.gpnPatterns.get(currentPath))
          else
            syncState.refreshAttributes.object.add(leafParam)
            if not leafIsObject?
              f = ((1 << syncState.gpnPatterns.length) - 1) ^ ((1 << leafParam.length) - 1)
              syncState.gpnPatterns.set(currentPath, f | syncState.gpnPatterns.get(currentPath))

        if currentAttributes
          for attrName of declareAttributeTimestamps
            if not (declareAttributeTimestamps[attrName] <= currentAttributes[attrName]?[0])
              if attrName == 'value'
                if not currentAttributes.object?[1]?
                  syncState.refreshAttributes.object.add(currentPath)
                else if currentAttributes.object[1] == 0
                  syncState.refreshAttributes.value.add(currentPath)
              else
                syncState.refreshAttributes[attrName].add(currentPath)

          if declareAttributeValues?.value?
            syncState.spv.set(currentPath, declareAttributeValues.value)

    for child of children
      # This fine expression avoids duplicate visits
      if ((currentPath.wildcard ^ children[child][0].wildcard) & ((1 << currentPath.length) - 1)) >> leafParam.length == 0
        if child != '*' and children['*']?
          children[child] = children[child].concat(children['*'])
        func(leafParam, leafIsObject, leafTimestamp, children[child])

  if allDeclareTimestamps.size or allDeclareAttributeTimestamps.size or allDeclareAttributeValues.size
    func(root, 1, 0, paths)

  return virtualParameterDeclarations


loadPath = (sessionContext, path, depth) ->
  depth = depth or (1 << path.length) - 1
  return true if sessionContext.new or not depth

  sessionContext.toLoad ?= new Map()

  # Trim trailing wildcards
  trimWildcard = path.length
  -- trimWildcard while trimWildcard and path[trimWildcard - 1] == '*'
  path = path.slice(0, trimWildcard) if trimWildcard < path.length

  for i in [0..path.length] by 1
    d = if i == path.length then 99 else i
    for sup in sessionContext.deviceData.paths.find(path.slice(0, i), true, false, d)
      v = sessionContext.deviceData.loaded.get(sup) | sessionContext.toLoad.get(sup)
      if sup.length > i
        v &= (1 << i) - 1
      depth &= depth ^ v
      return true if depth == 0

  path = sessionContext.deviceData.paths.add(path)
  depth |= sessionContext.toLoad.get(path)
  sessionContext.toLoad.set(path, depth)
  return false


processInstances = (sessionContext, parent, parameters, keys, minInstances, maxInstances) ->
  if parent[0] == 'Downloads'
    return if parent.length != 1
    instancesToDelete = sessionContext.syncState.downloadsToDelete
    instancesToCreate = sessionContext.syncState.downloadsToCreate
  else
    instancesToDelete = sessionContext.syncState.instancesToDelete.get(parent)
    if not instancesToDelete?
      instancesToDelete = new Set()
      sessionContext.syncState.instancesToDelete.set(parent, instancesToDelete)

    instancesToCreate = sessionContext.syncState.instancesToCreate.get(parent)
    if not instancesToCreate?
      instancesToCreate = new InstanceSet()
      sessionContext.syncState.instancesToCreate.set(parent, instancesToCreate)

  counter = 0
  for p in parameters
    ++ counter
    if counter > maxInstances
      instancesToDelete.add(p)
    else if counter <= minInstances
      instancesToDelete.delete(p)

  # Key is null if deleting a particular instance rather than use alias
  return if not keys

  superset = instancesToCreate.superset(keys)
  for inst in superset
    ++ counter
    if counter > maxInstances
      instancesToCreate.delete(inst)

  subset = instancesToCreate.subset(keys)
  for inst in subset
    ++ counter
    if counter <= minInstances
      instancesToCreate.delete(inst)
      instancesToCreate.add(JSON.parse(JSON.stringify(keys)))

  while counter < minInstances
    ++ counter
    instancesToCreate.add(JSON.parse(JSON.stringify(keys)))

  return


clear = (sessionContext, toClear, callback) ->
  return callback() if not toClear?.length

  MAX_DEPTH = config.get('MAX_DEPTH', sessionContext.deviceId)

  toClear.forEach((c) ->
    if c[1]
      p = c[0].slice(0, -1) # in order to include superset
      loadPath(sessionContext, p, ((1 << p.length) - 1) ^ ((1 << MAX_DEPTH) - 1))
    else if (c[2] and c[2].object)
      loadPath(sessionContext, c[0], (((1 << c[0].length) - 1) >> 1) ^ ((1 << MAX_DEPTH) - 1))
    else
      loadPath(sessionContext, c[0], (1 << c[0].length) >> 1)
  )

  loadParameters(sessionContext, (err) ->
    return callback(err) if err

    toClear.forEach((c) ->
      device.clear(sessionContext.deviceData, c[0], c[1], c[2], c[3])
    )
    return callback()
  )


rpcResponse = (sessionContext, id, rpcRes, callback) ->
  if id != generateRpcId(sessionContext)
    return callback(new Error('Request ID not recognized'))

  ++ sessionContext.rpcCount

  rpcReq = sessionContext.rpcRequest
  if not rpcReq.next?
    sessionContext.rpcRequest = null
  else if rpcReq.next == 'getInstanceKeys'
    instanceNumber = rpcRes.instanceNumber
    parameterNames = []
    instanceValues = {}
    for k, v of rpcReq.instanceValues
      n = "#{rpcReq.objectName}#{rpcRes.instanceNumber}.#{k}"
      parameterNames.push(n)
      instanceValues[n] = v

    if parameterNames.length == 0
      sessionContext.rpcRequest = null
    else
      sessionContext.rpcRequest = {
        name: 'GetParameterValues'
        parameterNames: parameterNames
        next: 'setInstanceKeys'
        instanceValues: instanceValues
      }
  else if rpcReq.next == 'setInstanceKeys'
    parameterList = []
    for p in rpcRes.parameterList
      if p[1] != rpcReq.instanceValues[p[0]]
        parameterList.push(
          [p[0]].concat(device.sanitizeParameterValue([rpcReq.instanceValues[p[0]], p[2]])))

    if not parameterList.length
      sessionContext.rpcRequest = null
    else
      sessionContext.rpcRequest = {
        name: 'SetParameterValues'
        parameterList: parameterList
      }

  timestamp = sessionContext.timestamp + sessionContext.iteration

  revision = (sessionContext.revisions[sessionContext.revisions.length - 1] or 0) + 1
  sessionContext.deviceData.timestamps.revision = revision
  sessionContext.deviceData.attributes.revision = revision

  toClear = null

  switch rpcRes.name
    when 'GetParameterValuesResponse'
      return callback(new Error('Response name does not match request name')) if rpcReq.name isnt 'GetParameterValues'

      for p in rpcRes.parameterList
        toClear = device.set(sessionContext.deviceData, common.parsePath(p[0]), timestamp,
          {object: [timestamp, 0], value: [timestamp, p.slice(1)]}, toClear)

    when 'GetParameterNamesResponse'
      return callback(new Error('Response name does not match request name')) if rpcReq.name isnt 'GetParameterNames'

      if rpcReq.parameterPath.endsWith('.')
        root = common.parsePath(rpcReq.parameterPath.slice(0, -1))
      else
        root = common.parsePath(rpcReq.parameterPath)

      params = []
      params.push([root.concat('*'), timestamp])

      # Some clients don't report all ancestors explicitly
      missing = {}

      for p in rpcRes.parameterList
        i = p[0].length - 1
        while (i = p[0].lastIndexOf('.', i - 1)) > rpcReq.parameterPath.length
          missing[p[0].slice(0, i)] |= 0

        if p[0].endsWith('.')
          missing[p[0][0...-1]] |= 1
          path = common.parsePath(p[0][0...-1])
          if not rpcReq.nextLevel
            params.push([path.concat('*'), timestamp])

          params.push([path, timestamp,
            {object: [timestamp, 1], writable: [timestamp, if p[1] then 1 else 0]}])

        else
          missing[p[0]] |= 1
          params.push([common.parsePath(p[0]), timestamp,
            {object: [timestamp, 0], writable: [timestamp, if p[1] then 1 else 0]}])

      for k, v of missing when v == 0
        # TODO consider showing a warning
        path = common.parsePath(k)
        params.push([path, timestamp, {object: [timestamp, 1], writable: [timestamp, 0]}])
        params.push([path.concat('*'), timestamp])

      # Sort such that actual parameters are set before wildcard ones
      params.sort((a, b) ->
        al = a[0].length
        bl = b[0].length
        ++ bl if b[0][bl - 1] == '*'
        ++ al if a[0][al - 1] == '*'
        return al - bl
      )

      if rpcReq.nextLevel
        loadPath(sessionContext, root, (1 << (root.length + 1)) - 1)
      else
        loadPath(sessionContext, root, (1 << config.get('MAX_DEPTH', sessionContext.deviceId)) - 1)

      loadParameters(sessionContext, (err) ->
        return callback(err) if err

        if root.length == 0
          for n in ['DeviceID', 'Events', 'Tags', 'Reboot', 'FactoryReset', 'VirtualParameters', 'Downloads']
            if p = sessionContext.deviceData.paths.get([n])
              if sessionContext.deviceData.attributes.has(p)
                sessionContext.deviceData.timestamps.set(p, timestamp)

        for p in params
          toClear = device.set(sessionContext.deviceData, p[0], p[1], p[2], toClear)

        clear(sessionContext, toClear, callback)
      )
      return

    when 'SetParameterValuesResponse'
      return callback(new Error('Response name does not match request name')) if rpcReq.name isnt 'SetParameterValues'

      for p in rpcReq.parameterList
        toClear = device.set(sessionContext.deviceData, common.parsePath(p[0]), timestamp + 1,
          {object: [timestamp + 1, 0], writable: [timestamp + 1, 1], value: [timestamp + 1, p.slice(1)]}, toClear)

    when 'AddObjectResponse'
      toClear = device.set(sessionContext.deviceData, common.parsePath(rpcReq.objectName + rpcRes.instanceNumber),
        timestamp + 1, {object: [timestamp + 1, 1]}, toClear)

    when 'DeleteObjectResponse'
      toClear = device.set(sessionContext.deviceData, common.parsePath(rpcReq.objectName.slice(0, -1)),
        timestamp + 1, null, toClear)

    when 'RebootResponse'
      toClear = device.set(sessionContext.deviceData, common.parsePath('Reboot'),
        timestamp + 1, {value: [timestamp + 1, [sessionContext.timestamp, 'xsd:dateTime']]}, toClear)

    when 'FactoryResetResponse'
      toClear = device.set(sessionContext.deviceData, common.parsePath('FactoryReset'),
        timestamp + 1, {value: [timestamp + 1, [sessionContext.timestamp, 'xsd:dateTime']]}, toClear)

    when 'DownloadResponse'
      toClear = device.set(sessionContext.deviceData, ['Downloads', rpcReq.instance, 'Download'],
        timestamp + 1, {value: [timestamp + 1, [sessionContext.timestamp, 'xsd:dateTime']]}, toClear)

      if rpcRes.status == 0
        toClear = device.set(sessionContext.deviceData, ['Downloads', rpcReq.instance, 'LastDownload'],
          timestamp + 1, {value: [timestamp + 1, [sessionContext.timestamp, 'xsd:dateTime']]}, toClear)
        toClear = device.set(sessionContext.deviceData, ['Downloads', rpcReq.instance, 'LastFileType'],
          timestamp + 1, {value: [timestamp + 1, [rpcReq.fileType, 'xsd:string']]}, toClear)
        toClear = device.set(sessionContext.deviceData, ['Downloads', rpcReq.instance, 'LastFileName'],
          timestamp + 1, {value: [timestamp + 1, [rpcReq.fileType, 'xsd:string']]}, toClear)
        toClear = device.set(sessionContext.deviceData, ['Downloads', rpcReq.instance, 'LastTargetFileName'],
          timestamp + 1, {value: [timestamp + 1, [rpcReq.fileType, 'xsd:string']]}, toClear)

        toClear = device.set(sessionContext.deviceData, ['Downloads', rpcReq.instance, 'StartTime'],
          timestamp + 1, {value: [timestamp + 1, [+rpcRes.startTime, 'xsd:dateTime']]}, toClear)
        toClear = device.set(sessionContext.deviceData, ['Downloads', rpcReq.instance, 'CompleteTime'],
          timestamp + 1, {value: [timestamp + 1, [+rpcRes.completeTime, 'xsd:dateTime']]}, toClear)
      else
        operation = {
          name: 'Download'
          timestamp: sessionContext.timestamp
          provisions: sessionContext.provisions
          channels: sessionContext.channels
          retries: {}
          args: {
            instance: rpcReq.instance
            fileType: rpcReq.fileType
            fileName: rpcReq.fileName
            targetFileName: rpcReq.targetFileName
          }
        }

        for channel of sessionContext.channels
          if sessionContext.retries[channel]?
            operation.retries[channel] = sessionContext.retries[channel]

        sessionContext.operations[rpcReq.commandKey] = operation
        sessionContext.operationsTouched ?= {}
        sessionContext.operationsTouched[rpcReq.commandKey] = 1

    else
      return callback(new Error('Response name not recognized'))

  return clear(sessionContext, toClear, callback)


rpcFault = (sessionContext, id, faultResponse, callback) ->
  # TODO Consider handling invalid parameter faults by automatically refreshing
  # relevant data model portions

  fault = {
    code: "cwmp.#{faultResponse.detail.faultCode}"
    message: faultResponse.detail.faultString
    detail: faultResponse.detail
    timestamp: sessionContext.timestamp
  }

  delete sessionContext.syncState
  return callback(null, fault)


deserialize = (sessionContextString, callback) ->
  localCache.getProvisionsAndVirtualParameters((err, hash, provisions, virtualParameters) ->
    return callback(err) if err

    sessionContext = JSON.parse(sessionContextString)

    if sessionContext.presetsHash? and sessionContext.presetsHash != hash
      return callback(new Error('Preset hash mismatch'))

    provisionsCache.set(sessionContext, provisions)
    virtualParametersCache.set(sessionContext, virtualParameters)

    for decs in sessionContext.declarations
      common.addPathMeta(d[0]) for d in decs

    deviceData = initDeviceData()

    for r in sessionContext.deviceData
      path = deviceData.paths.add(r[0])

      if r[1]
        deviceData.loaded.set(path, r[1])

      if r[2]
        deviceData.trackers.set(path, r[2])

      if r[3]
        deviceData.timestamps.setRevisions(path, r[3])

        if r[4]
          deviceData.attributes.setRevisions(path, r[4])

    sessionContext.deviceData = deviceData

    return callback(null, sessionContext)
  )


serialize = (sessionContext, callback) ->
  deviceData = []

  for path in sessionContext.deviceData.paths.find([], false, false, 99)
    e = [path]
    e[1] = sessionContext.deviceData.loaded.get(path) || 0
    e[2] = sessionContext.deviceData.trackers.get(path) || null
    e[3] = sessionContext.deviceData.timestamps.getRevisions(path) || null
    e[4] = sessionContext.deviceData.attributes.getRevisions(path) || null

    deviceData.push(e)

  sessionContext = Object.assign({}, sessionContext)
  sessionContext.deviceData = deviceData
  delete sessionContext.syncState
  delete sessionContext.toLoad
  delete sessionContext.httpRequest
  delete sessionContext.httpResponse

  sessionContextString = JSON.stringify(sessionContext)

  return callback(null, sessionContextString)


exports.init = init
exports.timeoutOperations = timeoutOperations
exports.inform = inform
exports.transferComplete = transferComplete
exports.addProvisions = addProvisions
exports.clearProvisions = clearProvisions
exports.rpcRequest = rpcRequest
exports.rpcResponse = rpcResponse
exports.rpcFault = rpcFault
exports.serialize = serialize
exports.deserialize = deserialize
