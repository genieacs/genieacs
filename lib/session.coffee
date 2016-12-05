###
# Copyright 2013-2016  Zaid Abdulla
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
cache = require './cache'
PathSet = require './path-set'
VersionedMap = require './versioned-map'
InstanceSet = require './instance-set'


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

  sessionData = {
    timestamp : timestamp
    deviceId : deviceId
    deviceData : initDeviceData()
    cwmpVersion : cwmpVersion
    timeout : timeout
    provisions: []
    channels: []
    revisions: []
    rpcCount: 0
    iteration: 0
    extensionsCache: {}
    declarations: []
  }

  cache.getProvisionsAndVirtualParameters((err, hash, provisions, virtualParameters) ->
    return callback(err) if err

    sessionData.cache = {
      hash: hash
      provisions: provisions
      virtualParameters: virtualParameters
    }

    return callback(null, sessionData)
  )


loadParameters = (sessionData, callback) ->
  if not sessionData.toLoad?.length
    return callback()

  db.fetchDevice(sessionData.deviceId, sessionData.timestamp, sessionData.toLoad, (err, parameters, loaded) ->
    return callback(err) if err

    if not parameters?
      # Device not available in database, mark as new
      sessionData.new = true
      loaded = [[[], (1 << config.get('MAX_DEPTH', sessionData.deviceId)) - 1]]
      parameters = []

    for p in loaded
      path = sessionData.deviceData.paths.add(p[0])

      if p[1]
        l = sessionData.deviceData.loaded.get(path) | 0
        sessionData.deviceData.loaded.set(path, l | p[1])

    for p in parameters
      path = sessionData.deviceData.paths.add(p[0])

      sessionData.deviceData.timestamps.set(path, p[1], 0)

      if p[2]
        sessionData.deviceData.attributes.set(path, p[2], 0)

    delete sessionData.toLoad

    return callback()
  )


generateRpcId = (sessionData) ->
  if sessionData.rpcCount > 255 or sessionData.revisions.length > 15
    throw new Error('Too many RPCs')

  return sessionData.timestamp.toString(16) + "0#{sessionData.rpcCount.toString(16)}".slice(-2)


inform = (sessionData, rpcReq, callback) ->
  timestamp = sessionData.timestamp + sessionData.iteration + 1

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
    {object: [timestamp, 0], writable: [timestamp, 0], value: [timestamp, [timestamp, 'xsd:dateTime']]}])

  for e in rpcReq.event
    params.push([['Events', e.replace(' ', '_')], timestamp,
      {object: [timestamp, 0], writable: [timestamp, 0], value: [timestamp, [timestamp, 'xsd:dateTime']]}])

  for p in params
    loadPath(sessionData, p[0])

  loadParameters(sessionData, (err) ->
    return callback(err) if err

    sessionData.deviceData.timestamps.revision = 1
    sessionData.deviceData.attributes.revision = 1

    toClear = null
    for p in params
      toClear = device.set(sessionData.deviceData, p[0], p[1], p[2], toClear)

    clear(sessionData, toClear, (err) ->
      return callback(err, {type : 'InformResponse'})
    )
  )


transferComplete = (sessionData, rpcReq, callback) ->
  commandKey = rpcReq.commandKey
  operation = sessionData.operations[commandKey]
  if not operation?
    # TODO Show a warning instead
    throw new Error('Invalid command key')
  instance = operation.args.instance
  faults = {}

  delete sessionData.operations[commandKey]
  sessionData.operationsTouched ?= {}
  sessionData.operationsTouched[commandKey] = 1

  if rpcReq.faultStruct? and rpcReq.faultStruct.FaultCode != '0'
    return revertDownloadParameters(sessionData, operation.args.instance, (err) ->
      for channel, provisions of operation.provisions
        faults[channel] = {
          provisions: provisions
          timestamp: sessionData.timestamp
          code: "cwmp.#{rpcReq.faultStruct['FaultCode']}"
          message: rpcReq.faultStruct['FaultString']
          detail: rpcReq.faultStruct
        }

        if operation.retries[channel]?
          faults[channel].retries = operation.retries[channel] + 1

      return callback(err, {type : 'TransferCompleteResponse'}, faults)
    )

  loadPath(sessionData, ['Downloads', instance, '*'])

  loadParameters(sessionData, (err) ->
    return callback(err) if err

    toClear = null
    timestamp = sessionData.timestamp + sessionData.iteration + 1

    p = sessionData.deviceData.paths.add(['Downloads', instance, 'LastDownload'])
    toClear = device.set(sessionData.deviceData, p, timestamp,
      {value: [timestamp, [operation.timestamp, 'xsd:dateTime']]}, toClear)

    p = sessionData.deviceData.paths.add(['Downloads', instance, 'LastFileType'])
    toClear = device.set(sessionData.deviceData, p, timestamp,
      {value: [timestamp, [operation.args.fileType, 'xsd:string']]}, toClear)

    p = sessionData.deviceData.paths.add(['Downloads', instance, 'LastFileName'])
    toClear = device.set(sessionData.deviceData, p, timestamp,
      {value: [timestamp, [operation.args.fileName, 'xsd:string']]}, toClear)

    p = sessionData.deviceData.paths.add(['Downloads', instance, 'LastTargetFileName'])
    toClear = device.set(sessionData.deviceData, p, timestamp,
      {value: [timestamp, [operation.args.targetFileName, 'xsd:string']]}, toClear)

    p = sessionData.deviceData.paths.add(['Downloads', instance, 'StartTime'])
    toClear = device.set(sessionData.deviceData, p, timestamp,
      {value: [timestamp, [+rpcReq.startTime, 'xsd:dateTime']]}, toClear)

    p = sessionData.deviceData.paths.add(['Downloads', instance, 'CompleteTime'])
    toClear = device.set(sessionData.deviceData, p, timestamp,
      {value: [timestamp, [+rpcReq.completeTime, 'xsd:dateTime']]}, toClear)

    clear(sessionData, toClear, (err) ->
      return callback(err, {type : 'TransferCompleteResponse'}, faults)
    )
  )


revertDownloadParameters = (sessionData, instance, callback) ->
  loadPath(sessionData, ['Downloads', instance, '*'])

  loadParameters(sessionData, (err) ->
    return callback(err) if err

    timestamp = sessionData.timestamp + sessionData.iteration + 1

    p = sessionData.deviceData.paths.add(['Downloads', instance, 'LastDownload'])
    LastDownload = sessionData.deviceData.attributes.get(p)

    p = sessionData.deviceData.paths.add(['Downloads', instance, 'Download'])
    toClear = device.set(sessionData.deviceData, p, timestamp,
      {value: [timestamp, [LastDownload?.value[1]?[0] or 0, 'xsd:dateTime']]}, toClear)

    clear(sessionData, toClear, callback)
  )


timeoutOperations = (sessionData, callback) ->
  faults = {}
  counter = 1

  for commandKey, operation of sessionData.operations
    if operation.type isnt 'Download'
      return callback(new Error("Unknown operation type #{operation.type}"))

    DOWNLOAD_TIMEOUT = config.get('DOWNLOAD_TIMEOUT', sessionData.deviceId) * 1000

    if sessionData.timestamp > operation.timestamp + DOWNLOAD_TIMEOUT
      delete sessionData.operations[commandKey]
      sessionData.operationsTouched ?= {}
      sessionData.operationsTouched[commandKey] = 1

      for channel, provisions of operation.provisions
        faults[channel] = {
          provisions: provisions
          timestamp: sessionData.timestamp
          code: 'timeout'
          message: 'Download operation timeed out'
        }

        if operation.retries[channel]?
          faults[channel].retries = operation.retries[channel] + 1

      ++ counter
      revertDownloadParameters(sessionData, operation.args.instance, (err) ->
        -- counter
        if err and counter > 0
          counter = 0

        return callback(err, faults) if counter == 0
      )

  -- counter
  return callback(null, faults) if counter == 0


addProvisions = (sessionData, channel, provisions) ->
  if sessionData.revisions[0] > 0
    sessionData.deviceData.timestamps.collapse(1)
    sessionData.deviceData.attributes.collapse(1)

  delete sessionData.syncState
  delete sessionData.rpcRequest
  sessionData.declarations = []
  sessionData.doneProvisions = 0
  sessionData.provisions[0] ?= []
  sessionData.provisions.length = 1
  sessionData.revisions = [0]
  sessionData.extensionsCache = {}

  for provision, i in provisions
    # Remove duplicate provisions
    for p, j in sessionData.provisions[0]
      if channel == sessionData.channels[j] and JSON.stringify(p) == JSON.stringify(provision)
        sessionData.provisions[0].splice(j, 1)
        sessionData.channels.splice(j, 1)

    sessionData.provisions[0].push(provision)
    sessionData.channels.push(channel)


clearProvisions = (sessionData) ->
  if sessionData.revisions[sessionData.revisions.length - 1] > 0
    sessionData.deviceData.timestamps.collapse(1)
    sessionData.deviceData.attributes.collapse(1)

  delete sessionData.syncState
  delete sessionData.rpcRequest
  sessionData.provisions = []
  sessionData.channels = []
  sessionData.declarations = []
  sessionData.doneProvisions = 0
  sessionData.revisions = []
  sessionData.extensionsCache = {}


runProvisions = (sessionData, provisions, startRevision, endRevision, callback) ->
  done = true
  allDeclarations = []
  allClear = []
  counter = 1
  for provision in provisions
    if not sessionData.cache.provisions[provision[0]]?
      switch provision[0]
        when 'refresh'
          path = common.parsePath(provision[1]).slice()
          l = path.length
          path.length = config.get('MAX_DEPTH', sessionData.deviceId)
          path.fill('*', l)
          t = provision[2]
          t += sessionData.timestamp if t <= 0

          for i in [l...path.length] by 1
            p = common.addPathMeta(path.slice(0, i))
            allDeclarations.push([p, t, {object: 1, writable: 1, value: t}])
        when 'value'
          allDeclarations.push([common.parsePath(provision[1]), 1, {value: 1}, null, {value: [provision[2]]}])
        when 'tag'
          allDeclarations.push([['Tags', provision[1]], 1, {value: 1}, null, {value: [provision[2], 'xsd:boolean']}])
        when '_task'
          # A special provision for tasks compatibility
          switch provision[2]
            when 'getParameterValues'
              for i in [3...provision.length] by 1
                allDeclarations.push([common.parsePath(provision[i]), 1, {value: sessionData.timestamp}])
            when 'setParameterValues'
              for i in [3...provision.length] by 3
                v = if provision[i + 2] then [provision[i + 1], provision[i + 2]] else [provision[i + 1]]
                allDeclarations.push([common.parsePath(provision[i]), 1, {value: 1}, null, {value: v}])
            when 'refreshObject'
              path = common.parsePath(provision[3]).slice()
              l = path.length
              path.length = config.get('MAX_DEPTH', sessionData.deviceId)
              path.fill('*', l)
              for i in [l...path.length] by 1
                p = common.addPathMeta(path.slice(0, i))
                allDeclarations.push([p, sessionData.timestamp, {object: 1, writable: 1, value: sessionData.timestamp}])
            when 'reboot'
              allDeclarations.push([['Reboot'], 1, {value: 1}, null, {value: [sessionData.timestamp]}])
            when 'factoryReset'
              allDeclarations.push([['FactoryReset'], 1, {value: 1}, null, {value: [sessionData.timestamp]}])
            when 'download'
              alias = "[FileType:#{JSON.stringify(provision[3] or '')},FileName:#{JSON.stringify(provision[4] or '')},TargetFileName:#{JSON.stringify(provision[5] or '')}]"
              allDeclarations.push([common.parsePath("Downloads.#{alias}"),
                1, {}, 1, {}])
              allDeclarations.push([common.parsePath("Downloads.#{alias}.Download"),
                1, {value: 1}, null, {value: [sessionData.timestamp]}])
      continue

    ++ counter
    sandbox.run(sessionData.cache.provisions[provision[0]].script,
      {args: provision[1]}, sessionData.timestamp, sessionData.deviceData,
      sessionData.extensionsCache, startRevision, endRevision,
      (err, _fault, _clear, _declarations, _done) ->
        -- counter
        if err or _fault
          if counter >= 0
            counter = 0
            return callback(err, _fault)
          return

        done &&= _done

        if _declarations
          allDeclarations = allDeclarations.concat(_declarations)

        if _clear
          allClear = allClear.concat(_clear)

        if counter == 0
          return callback(null, null, done, allDeclarations, allClear)
      )

  if -- counter == 0
    return callback(null, null, done, allDeclarations, allClear)


runVirtualParameters = (sessionData, provisions, startRevision, endRevision, callback) ->
  done = true
  virtualParameterUpdates = []
  allDeclarations = []
  allClear = []
  counter = 1
  for provision in provisions
    ++ counter
    globals = {TIMESTAMPS: provision[1], VALUES: provision[2]}
    sandbox.run(sessionData.cache.virtualParameters[provision[0]].script, globals,
      sessionData.timestamp, sessionData.deviceData,
      sessionData.extensionsCache, startRevision, endRevision,
      (err, _fault, _clear, _declarations, _done, _returnValue) ->
        -- counter
        if err or _fault
          if counter >= 0
            counter = 0
            return callback(err, _fault)
          return

        done &&= _done

        if _declarations
          allDeclarations = allDeclarations.concat(_declarations)

        if _clear
          allClear = allClear.concat(_clear)

        if _done
          virtualParameterUpdates.push(_returnValue)

        if counter == 0
          toClear = null
          if virtualParameterUpdates.length == provisions.length
            for vpu, i in virtualParameterUpdates
              toClear = commitVirtualParameter(sessionData, provisions[i], vpu, toClear)

          clear(sessionData, toClear, (err) ->
            return callback(err, null, done, allDeclarations, allClear)
          )
      )

  if -- counter == 0
    toClear = null
    if virtualParameterUpdates.length == provisions.length
      for vpu, i in virtualParameterUpdates
        toClear = commitVirtualParameter(sessionData, provisions[i], vpu, toClear)

    clear(sessionData, toClear, (err) ->
      return callback(err, null, done, allDeclarations, allClear)
    )


runDeclarations = (sessionData, declarations) ->
  sessionData.iteration += 2
  sessionData.syncState ?= {
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

  for declaration, i in declarations
    path = common.addPathMeta(declaration[0])

    if (path.alias | path.wildcard) & 1 or path[0] == 'VirtualParameters'
      sessionData.deviceData.paths.add(['VirtualParameters'])
      if (path.alias | path.wildcard) & 2
        sessionData.deviceData.paths.add(['VirtualParameters', '*'])
        for k of sessionData.cache.virtualParameters
          sessionData.deviceData.paths.add(['VirtualParameters', k])

    if (path.alias | path.wildcard) & 1 or path[0] == 'Reboot'
      sessionData.deviceData.paths.add(['Reboot'])

    if (path.alias | path.wildcard) & 1 or path[0] == 'FactoryReset'
      sessionData.deviceData.paths.add(['FactoryReset'])

    if path[0] == 'Files' and
        !(path.alias | path.wildcard) and
        path.length == 3 and
        path[2] == 'Download' and
        (declaration[4]?.value? or sessionData.deviceData.attributes.has(path))
      sessionData.syncState.download ?= new Map()
      sessionData.syncState.download.set(path, 0)

    if path.alias
      aliasDecs = device.getAliasDeclarations(path, declaration[1] or 1)
      for ad in aliasDecs
        p = sessionData.deviceData.paths.add(ad[0])
        allDeclareTimestamps.set(p, Math.max(ad[1] or 1, allDeclareTimestamps.get(p) or 0))
        attrTrackers = []
        if ad[2]
          cur = allDeclareAttributeTimestamps.get(p)
          allDeclareAttributeTimestamps.set(p, cur = {}) if not cur
          for k, v of ad[2]
            attrTrackers.push(k)
            cur[k] = Math.max(v, cur[k] or 0)

        device.track(sessionData.deviceData, p, 'prerequisite', false, null, true, attrTrackers)

      unpacked = device.unpack(sessionData.deviceData, path)
      for u in unpacked
        allDeclareTimestamps.set(u, Math.max(declaration[1] or 1, allDeclareTimestamps.get(u) or 0))
        if declaration[2]
          cur = allDeclareAttributeTimestamps.get(u)
          allDeclareAttributeTimestamps.set(u, cur = {}) if not cur
          for k, v of declaration[2]
            cur[k] = Math.max(v, cur[k] or 0)

        if declaration[4]
          cur = allDeclareAttributeValues.get(u)
          allDeclareAttributeValues.set(u, cur = {}) if not cur
          for k, v of declaration[4]
            cur[k] = v
    else
      path = sessionData.deviceData.paths.add(path)
      allDeclareTimestamps.set(path, Math.max(declaration[1] or 1, allDeclareTimestamps.get(path) or 0))
      if declaration[2]
        cur = allDeclareAttributeTimestamps.get(path)
        allDeclareAttributeTimestamps.set(path, cur = {}) if not cur
        for k, v of declaration[2]
          cur[k] = Math.max(v, cur[k] or 0)

      if declaration[4]
        if declaration[4]
          cur = allDeclareAttributeValues.get(path)
          allDeclareAttributeValues.set(path, cur = {}) if not cur
          for k, v of declaration[4]
            cur[k] = v

      device.track(sessionData.deviceData, path, 'prerequisite', false, null, true)

    if declaration[3]?
      if Array.isArray(declaration[3])
        minInstances = declaration[3][0]
        maxInstances = declaration[3][1]
      else
        minInstances = maxInstances = declaration[3]

      parent = common.addPathMeta(path.slice(0, -1))

      if Array.isArray(path[path.length - 1])
        keys = {}
        for p, i in path[path.length - 1] by 2
          keys[p] = path[path.length - 1][i + 1]
      else if path[path.length - 1] == '*'
        keys = {}

      if ((path.wildcard | path.alias) & ((1 << (path.length - 1)) - 1)) == 0
        parent = sessionData.deviceData.paths.add(parent)
        unpacked ?= device.unpack(sessionData.device, path)
        processInstances(sessionData, parent, unpacked, keys, minInstances, maxInstances)
      else
        parentsUnpacked = device.unpack(sessionData.deviceData, parent)
        for parent in parentsUnpacked
          parent = sessionData.deviceData.paths.add(parent)
          processInstances(sessionData, parent, device.unpack(sessionData.deviceData, common.addPathMeta(parent.concat([path[parent.length]]))), keys, minInstances, maxInstances)

  return processDeclarations(sessionData, allDeclareTimestamps, allDeclareAttributeTimestamps, allDeclareAttributeValues)


rpcRequest = (sessionData, _declarations, callback) ->
  if sessionData.rpcRequest?
    return callback(null, null, generateRpcId(sessionData), sessionData.rpcRequest)

  if sessionData.declarations.length < sessionData.provisions.length
    inception = sessionData.declarations.length
    revision = sessionData.revisions[inception] + 1
    sessionData.deviceData.timestamps.revision = revision
    sessionData.deviceData.attributes.revision = revision
    run = if inception == 0 then runProvisions else runVirtualParameters

    return run(sessionData, sessionData.provisions[inception], sessionData.revisions[inception - 1] ? 0, sessionData.revisions[inception], (err, fault, done, decs, toClear) ->
      return callback(err) if err

      if fault
        faults = {}
        for p, i in sessionData.provisions[0]
          channel = sessionData.channels[i]
          f = faults[channel]
          if not f?
            f = {
              provisions: []
              timestamp: sessionData.timestamp
              code: fault.code
              message: fault.message
              detail: fault.detail
            }

            if sessionData.faults[channel]?
              f.retries = (sessionData.faults[channel].retries or 0) + 1

            faults[channel] = f

          f.provisions.push(p)

        clearProvisions(sessionData)
        return callback(null, faults)

      sessionData.declarations.push(decs)
      sessionData.doneProvisions |= 1 << inception if done or not decs.length

      for d in decs
        for ad in device.getAliasDeclarations(d[0], 1)
          loadPath(sessionData, ad[0])

      return clear(sessionData, toClear, (err) ->
        return callback(err) if err
        loadParameters(sessionData, (err) ->
          return callback(err) if err
          rpcRequest(sessionData, _declarations, callback)
        )
      )
    )

  if _declarations?.length
    delete sessionData.syncState
    sessionData.declarations[0] ?= []
    sessionData.declarations[0] = sessionData.declarations[0].concat(_declarations)
    sessionData.provisions[0] ?= []
    sessionData.revisions[0] ?= 0

    for d in _declarations
      for ad in device.getAliasDeclarations(d[0], 1)
        loadPath(sessionData, ad[0])

    return loadParameters(sessionData, (err) ->
      return callback(err) if err
      return rpcRequest(sessionData, null, callback)
    )

  if (sessionData.syncState?.virtualParameterDeclarations?.length or 0) < sessionData.declarations.length
    inception = sessionData.syncState?.virtualParameterDeclarations?.length or 0
    vpd = runDeclarations(sessionData, sessionData.declarations[inception])
    timestamp = sessionData.timestamp + sessionData.iteration
    toClear = null

    vpd = vpd.filter((declaration) ->
      if declaration[0].length == 1
        if Object.keys(sessionData.cache.virtualParameters).length
          toClear = device.set(sessionData.deviceData, declaration[0], timestamp, {object: [timestamp, 1], writable: [timestamp, 0]}, toClear)
        else
          toClear = device.set(sessionData.deviceData, declaration[0], timestamp, null, toClear)
      else if declaration[0].length == 2
        if declaration[0][1] == '*'
          for k, v of sessionData.cache.virtualParameters
            toClear = device.set(sessionData.deviceData, ['VirtualParameters', k], timestamp, {object: [timestamp, 0]}, toClear)
          toClear = device.set(sessionData.deviceData, declaration[0], timestamp, null, toClear)
        else if not (declaration[0][1] of sessionData.cache.virtualParameters)
          toClear = device.set(sessionData.deviceData, declaration[0], timestamp, null, toClear)
        else
          return true
      return false
    )

    return clear(sessionData, toClear, (err) ->
      return callback(err) if err
      sessionData.syncState.virtualParameterDeclarations[inception] = vpd
      return rpcRequest(sessionData, null, callback)
    )

  if not sessionData.syncState?
    return callback()

  inception = sessionData.declarations.length - 1

  provisions = generateGetVirtualParameterProvisions(sessionData, sessionData.syncState.virtualParameterDeclarations[inception])
  if not provisions
    sessionData.rpcRequest = generateGetRpcRequest(sessionData)
    if not sessionData.rpcRequest
      if sessionData.deviceData.changes.has('prerequisite')
        delete sessionData.syncState
        device.clearTrackers(sessionData.deviceData, 'prerequisite')
        return rpcRequest(sessionData, null, callback)

      toClear = null
      timestamp = sessionData.timestamp + sessionData.iteration + 1

      # Update tags
      sessionData.syncState.tags.forEach((v, p) ->
        c = sessionData.deviceData.attributes.get(p)
        if v and not c?
          toClear = device.set(sessionData.deviceData, p, timestamp, {object: [timestamp, false], writable: [timestamp, true], value: [timestamp, [true, 'xsd:boolean']]}, toClear)
        else if c? and not v
          toClear = device.set(sessionData.deviceData, p, timestamp, toClear)
          noMoreTags = true
          iter = sessionData.deviceData.paths.subset(['Tags', '*'])
          while p = iter.next().value
            if sessionData.deviceData.attributes.has(p)
              noMoreTags = false
              break
          if noMoreTags
            toClear = device.set(sessionData.deviceData, ['Tags'], timestamp, null, toClear)
      )

      # Downloads
      index = null
      sessionData.syncState.downloadsToCreate.forEach((instance) ->
        if not index?
          index = 0
          iter = sessionData.deviceData.paths.subset(['Downloads', '*'])
          while p = iter.next().value
            if +p[1] > index and sessionData.deviceData.attributes.has(p)
              index = +p[1]

        ++ index

        toClear = device.set(sessionData.deviceData, ['Downloads'],
          timestamp,
          {object: [timestamp, 1], writable: [timestamp, 1]}, toClear)

        toClear = device.set(sessionData.deviceData, ['Downloads', "#{index}"],
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
          toClear = device.set(sessionData.deviceData, ['Downloads', "#{index}", k],
            timestamp, {object: [timestamp, 0], writable: [timestamp, v.writable], value: [timestamp, v.value]}, toClear)

        toClear = device.set(sessionData.deviceData, ['Downloads', "#{index}", '*'],
          timestamp, null, toClear)
      )
      sessionData.syncState.downloadsToCreate.clear()

      sessionData.syncState.downloadsToDelete.forEach((instance) ->
        toClear = device.set(sessionData.deviceData, instance, timestamp, null, toClear)
        sessionData.syncState.downloadsValues.forEach((v, p) ->
          if p[1] == instance[1]
            sessionData.syncState.downloadsValues.delete(p)
        )
      )
      sessionData.syncState.downloadsToDelete.clear()

      sessionData.syncState.downloadsValues.forEach((v, p) ->
        if attrs = sessionData.deviceData.attributes.get(p)
          if attrs.writable?[1] and attrs.value?
            v = device.sanitizeParameterValue([v, attrs.value[1][1]])
            if v[0] != attrs.value[1][0]
              toClear = device.set(sessionData.deviceData, p, timestamp, {value: [timestamp, v]}, toClear)
      )

      if toClear
        return clear(sessionData, toClear, (err) ->
          return callback(err) if err
          if sessionData.deviceData.changes.has('prerequisite')
            delete sessionData.syncState
            device.clearTrackers(sessionData.deviceData, 'prerequisite')
          return rpcRequest(sessionData, null, callback)
        )

      if sessionData.deviceData.changes.has('prerequisite')
        delete sessionData.syncState
        device.clearTrackers(sessionData.deviceData, 'prerequisite')
        return rpcRequest(sessionData, null, callback)

      provisions = generateSetVirtualParameterProvisions(sessionData, sessionData.syncState.virtualParameterDeclarations[inception])
      if not provisions
        sessionData.rpcRequest = generateSetRpcRequest(sessionData)

  if provisions
    sessionData.provisions.push(provisions)
    sessionData.revisions.push(sessionData.revisions[inception])
    return rpcRequest(sessionData, null, callback)

  if sessionData.rpcRequest
    return callback(null, null, generateRpcId(sessionData), sessionData.rpcRequest)

  ++ sessionData.revisions[inception]
  sessionData.declarations.pop()
  while sessionData.doneProvisions & (1 << (sessionData.provisions.length - 1))
    doneProvisions = sessionData.provisions.pop()
    sessionData.revisions.pop()
    sessionData.declarations.pop()
    sessionData.doneProvisions &= (1 << sessionData.provisions.length) - 1
    if not sessionData.provisions.length
      delete sessionData.syncState
      sessionData.deviceData.timestamps.collapse(1)
      sessionData.deviceData.attributes.collapse(1)
      sessionData.extensionsCache = {}
      return callback(null, null, null, null, doneProvisions)

    rev = sessionData.revisions[sessionData.revisions.length - 1]
    sessionData.deviceData.timestamps.collapse(rev + 1)
    sessionData.deviceData.attributes.collapse(rev + 1)
    for k of sessionData.extensionsCache
      if rev < Number(k.split(':', 1)[0])
        delete sessionData.extensionsCache[k]

  sessionData.syncState.virtualParameterDeclarations.length = sessionData.declarations.length

  return rpcRequest(sessionData, null, callback)


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


generateGetRpcRequest = (sessionData) ->
  if not (syncState = sessionData.syncState)?
    return

  iter = syncState.refreshAttributes.exist.values()
  while (path = iter.next().value)
    descendantIter = sessionData.deviceData.paths.subset(path, 99)
    found = false
    while (p = descendantIter.next().value)?
      if syncState.refreshAttributes.value.has(p) or
          syncState.refreshAttributes.object.has(p) or
          syncState.refreshAttributes.writable.has(p) or
          syncState.gpn.has(p)
        found = true
        break
    if not found
      p = sessionData.deviceData.paths.add(path.slice(0, -1))
      syncState.gpn.add(p)
      f = 1 << p.length
      syncState.gpnPatterns.set(p, f | syncState.gpnPatterns.get(p))
  syncState.refreshAttributes.exist.clear()

  iter = syncState.refreshAttributes.object.values()
  while (path = iter.next().value)
    descendantIter = sessionData.deviceData.paths.subset(path, 99)
    found = false
    while (p = descendantIter.next().value)?
      if syncState.refreshAttributes.value.has(p) or
          (p.length > path.length and
          (syncState.refreshAttributes.object.has(p) or
          syncState.refreshAttributes.writable.has(p)))
        found = true
        break
    if not found
      p = sessionData.deviceData.paths.add(path.slice(0, -1))
      syncState.gpn.add(p)
      f = 1 << p.length
      syncState.gpnPatterns.set(p, f | syncState.gpnPatterns.get(p))
  syncState.refreshAttributes.object.clear()

  iter = syncState.refreshAttributes.writable.values()
  while (path = iter.next().value)
    p = sessionData.deviceData.paths.add(path.slice(0, -1))
    syncState.gpn.add(p)
    f = 1 << p.length
    syncState.gpnPatterns.set(p, f | syncState.gpnPatterns.get(p))
  syncState.refreshAttributes.writable.clear()

  if syncState.gpn.size
    GET_PARAMETER_NAMES_DEPTH_THRESHOLD =
      config.get('GET_PARAMETER_NAMES_DEPTH_THRESHOLD', sessionData.deviceId)

    paths = Array.from(syncState.gpn.keys()).sort((a,b) -> b.length - a.length)
    path = paths.pop()
    while path and not sessionData.deviceData.attributes.has(path)
      syncState.gpn.delete(path)
      path = paths.pop()

    if path
      patterns = []
      iter = sessionData.deviceData.paths.superset(path, 99)
      while p = iter.next().value
        if v = syncState.gpnPatterns.get(p)
          patterns.push([p, (v >> path.length) << path.length])

      if path.length >= GET_PARAMETER_NAMES_DEPTH_THRESHOLD
        est = estimateGpnCount(patterns)
      else
        est = 0

      if est < Math.pow(2, Math.max(0, 8 - path.length))
        nextLevel = true
        syncState.gpn.delete(path)
      else
        nextLevel = false
        iter = sessionData.deviceData.paths.subset(path, 99)
        while p = iter.next().value
          syncState.gpn.delete(p)

      return {
        type: 'GetParameterNames'
        parameterPath: path.concat('').join('.')
        nextLevel: nextLevel
      }

  if syncState.refreshAttributes.value.size
    TASK_PARAMETERS_BATCH_SIZE =
      config.get('TASK_PARAMETERS_BATCH_SIZE', sessionData.deviceId)

    parameterNames = []
    iter = syncState.refreshAttributes.value.values()
    while (path = iter.next().value) and
        parameterNames.length < TASK_PARAMETERS_BATCH_SIZE
      syncState.refreshAttributes.value.delete(path)
      if sessionData.deviceData.attributes.has(path)
        parameterNames.push(path)

    return {
      type: 'GetParameterValues'
      parameterNames: (p.join('.') for p in parameterNames)
    }

  return null


generateSetRpcRequest = (sessionData) ->
  if not (syncState = sessionData.syncState)?
    return

  deviceData = sessionData.deviceData

  # Delete instance
  iter = syncState.instancesToDelete.values()
  while instances = iter.next().value
    if (instance = instances.values().next().value) and
        sessionData.deviceData.attributes.has(instance)
      return {
        type: 'DeleteObject'
        objectName: instance.concat('').join('.')
      }

  # Create instance
  iter = syncState.instancesToCreate.entries()
  while pair = iter.next().value
    if sessionData.deviceData.attributes.has(pair[0]) and
        instance = pair[1].values().next().value
      pair[1].delete(instance)
      return {
        type: 'AddObject'
        objectName: pair[0].concat('').join('.')
        instanceValues: instance
        next: 'getInstanceKeys'
      }

  # Set values
  TASK_PARAMETERS_BATCH_SIZE =
    config.get('TASK_PARAMETERS_BATCH_SIZE', sessionData.deviceId)

  parameterValues = []
  syncState.spv.forEach((v, k) ->
    return if parameterValues.length >= TASK_PARAMETERS_BATCH_SIZE
    attrs = sessionData.deviceData.attributes.get(k)
    if (curVal = attrs.value?[1])? and attrs.writable?[1]
      val = v.slice()
      val[1] = curVal[1] if not val[1]?
      device.sanitizeParameterValue(val)

      if val[0] != curVal[0] or val[1] != curVal[1]
        parameterValues.push([k, val[0], val[1]])
        syncState.spv.delete(k)
  )

  if parameterValues.length
    return {
      type: 'SetParameterValues'
      parameterList: ([p[0].join('.'), p[1], p[2]] for p in parameterValues)
    }

  # Reboot
  if syncState.reboot?
    p = sessionData.deviceData.paths.subset(['Reboot']).next().value
    if not (p? and sessionData.deviceData.attributes.get(p)?.value?[1][0] >= syncState.reboot)
      delete syncState.reboot
      return {
        type: 'Reboot'
      }

  # Factory reset
  if syncState.factoryReset?
    p = sessionData.deviceData.paths.subset(['FactoryReset']).next().value
    if not (p? and sessionData.deviceData.attributes.get(p)?.value?[1][0] >= syncState.factoryReset)
      delete syncState.factoryReset
      return {
        type: 'FactoryReset'
      }

  # Download
  iter = syncState.downloadsDownload.entries()
  while pair = iter.next().value
    if not (pair[1] <= deviceData.attributes.get(pair[0])?.value?[1][0])
      fileTypePath = deviceData.paths.subset(pair[0].slice(0, -1).concat('FileType')).next().value
      fileNamePath = deviceData.paths.subset(pair[0].slice(0, -1).concat('FileName')).next().value
      targetFileNamePath = deviceData.paths.subset(pair[0].slice(0, -1).concat('TargetFileName')).next().value
      return {
        type: 'Download'
        commandKey: generateRpcId(sessionData)
        instance: pair[0][1]
        fileType: deviceData.attributes.get(fileTypePath)?.value?[1][0]
        fileName: deviceData.attributes.get(fileNamePath)?.value?[1][0]
        targetFileName: deviceData.attributes.get(targetFileNamePath)?.value?[1][0]
      }

  return null


generateGetVirtualParameterProvisions = (sessionData, virtualParameterDeclarations) ->
  provisions = null
  for declaration in virtualParameterDeclarations
    if declaration[1]
      provisions ?= []
      provisions.push([declaration[0][1], declaration[1], undefined])
      delete declaration[1]

  return provisions


generateSetVirtualParameterProvisions = (sessionData, virtualParameterDeclarations) ->
  provisions = null
  for declaration in virtualParameterDeclarations
    if declaration[2]?.value?
      attrs = sessionData.deviceData.attributes.get(declaration[0])
      if (curVal = attrs.value?[1])? and attrs.writable?[1]
        val = declaration[2].value.slice()
        val[1] = curVal[1] if not val[1]?
        device.sanitizeParameterValue(val)

        if val[0] != curVal[0] or val[1] != curVal[1]
          provisions ?= []
          provisions.push([declaration[0][1], undefined, {value: val}])

  virtualParameterDeclarations.length = 0
  return provisions


processDeclarations = (sessionData, allDeclareTimestamps, allDeclareAttributeTimestamps, allDeclareAttributeValues) ->
  deviceData = sessionData.deviceData
  syncState = sessionData.syncState

  root = sessionData.deviceData.paths.add([])
  paths = Array.from(sessionData.deviceData.paths.subset([], 99))
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
    declareAttributeTimestamps = {}
    declareAttributeValues = {}

    currentTimestamp = 0
    currentAttributes = null
    if currentPath.wildcard == 0
      currentAttributes = deviceData.attributes.get(currentPath)

    for path in paths
      if path.length > currentPath.length
        fragment = path[currentPath.length]
        children[fragment] ?= []
        children[fragment].push(path)
        continue

      currentTimestamp = Math.max(currentTimestamp, deviceData.timestamps.get(path) ? 0)
      declareTimestamp = Math.max(declareTimestamp, allDeclareTimestamps.get(path) ? 0)

      if currentPath.wildcard == 0
        if attrs = allDeclareAttributeTimestamps.get(path)
          for attrName of attrs
            declareAttributeTimestamps[attrName] = Math.max(attrs[attrName], declareAttributeTimestamps[attrName] or 0)

          if attrs = allDeclareAttributeValues.get(path)
            for attrName of attrs
              declareAttributeValues[attrName] = attrs[attrName]

    switch (if currentPath[0] != '*' then currentPath[0] else leafParam[0])
      when 'Reboot'
        if currentPath.length == 1
          if declareAttributeValues.value?
            syncState.reboot = +(new Date(declareAttributeValues.value[0]))
      when 'FactoryReset'
        if currentPath.length == 1
          if declareAttributeValues.value?
            syncState.factoryReset = +(new Date(declareAttributeValues.value[0]))
      when 'Tags'
        if currentPath.length == 2 and currentPath.wildcard == 0 and declareAttributeValues?.value?
          syncState.tags.set(currentPath, device.sanitizeParameterValue([declareAttributeValues.value[0], 'xsd:boolean'])[0])
      when 'Events', 'DeviceID' then
        # Do nothing
      when 'Downloads'
        if currentPath.length == 3 and currentPath.wildcard == 0 and declareAttributeValues.value?
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
                if declareAttributeTimestamps[attrName] <= currentAttributes?[attrName]?[0]
                  delete declareAttributeTimestamps[attrName]

              if Object.keys(declareAttributeTimestamps).length
                d ?= [currentPath]
                d[1] = declareAttributeTimestamps

            if Object.keys(declareAttributeValues).length
              d ?= [currentPath]
              d[2] = declareAttributeValues

          virtualParameterDeclarations.push(d) if d
      else
        if declareTimestamp > currentTimestamp and declareTimestamp > leafTimestamp
          if leafIsObject
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

          if declareAttributeValues.value?
            syncState.spv.set(currentPath, declareAttributeValues.value)

    if currentAttributes
      leafParam = currentPath
      leafIsObject = currentAttributes.object?[1]
      if leafIsObject == 0
        leafTimestamp = Math.max(leafTimestamp, currentAttributes.object[0])
    else
      leafTimestamp = Math.max(leafTimestamp, currentTimestamp)

    for child of children
      # This fine expression avoids duplicate visits
      if ((currentPath.wildcard ^ children[child][0].wildcard) & ((1 << currentPath.length) - 1)) >> leafParam.length == 0
        if child != '*' and children['*']?
          children[child] = children[child].concat(children['*'])
        func(leafParam, leafIsObject, leafTimestamp, children[child])

  func(root, 1, 0, paths)
  return virtualParameterDeclarations


loadPath = (sessionData, path, depth) ->
  return true if sessionData.new
  depth ?= (1 << path.length) - 1

  # Trim trailing wildcards
  trimWildcard = path.length
  -- trimWildcard while trimWildcard and path[trimWildcard - 1] == '*'
  path = path.slice(0, trimWildcard) if trimWildcard < path.length

  for i in [0..path.length] by 1
    iter = sessionData.deviceData.paths.superset(path.slice(0, i))

    while sup = iter.next().value
      v = sessionData.deviceData.loaded.get(sup)
      depth &= depth ^ sessionData.deviceData.loaded.get(sup)

    return true if depth == 0

  sessionData.toLoad ?= []
  sessionData.toLoad.push([path, depth])
  return false


processInstances = (sessionData, parent, parameters, keys, minInstances, maxInstances) ->
  if parent[0] == 'Downloads'
    return if parent.length != 1
    instancesToDelete = sessionData.syncState.downloadsToDelete
    instancesToCreate = sessionData.syncState.downloadsToCreate
  else
    instancesToDelete = sessionData.syncState.instancesToDelete.get(parent)
    if not instancesToDelete?
      instancesToDelete = new Set()
      sessionData.syncState.instancesToDelete.set(parent, instancesToDelete)

    instancesToCreate = sessionData.syncState.instancesToCreate.get(parent)
    if not instancesToCreate?
      instancesToCreate = new InstanceSet()
      sessionData.syncState.instancesToCreate.set(parent, instancesToCreate)

  counter = 0
  for p in parameters
    ++ counter
    if counter > maxInstances
      instancesToDelete.add(p)
    else if counter <= minInstances
      instancesToDelete.delete(p)

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


clear = (sessionData, toClear, callback) ->
  return callback() if not toClear?.length

  MAX_DEPTH = config.get('MAX_DEPTH', sessionData.deviceId)

  toClear.forEach((c) ->
    loadPath(sessionData, c[0], ((1 << c[0].length) - 1) ^ (1 << MAX_DEPTH) - 1)
  )

  loadParameters(sessionData, (err) ->
    return callback(err) if err

    toClear.forEach((c) ->
      device.clear(sessionData.deviceData, c[0], c[1], c[2])
    )
    return callback()
  )


commitVirtualParameter = (sessionData, provision, update, toClear) ->
  attributes = {}

  timestamp = sessionData.timestamp + sessionData.iteration
  timestamp += 1 if provision[2]?

  if update.writable?
    attributes.writable = [timestamp, +update.writable]
  else if provision[1]?.writable? or provision[2]?.writable?
    throw new Error('Virtual parameter must provide declared attributes')

  if update.value?
    attributes.value = [timestamp, device.sanitizeParameterValue(update.value)]
  else if provision[1]?.value? or provision[2]?.value?
    throw new Error('Virtual parameter must provide declared attributes')

  return device.set(sessionData.deviceData, ['VirtualParameters', provision[0]], timestamp, attributes, toClear)


rpcResponse = (sessionData, id, rpcRes, callback) ->
  if id != generateRpcId(sessionData)
    return callback(new Error('Request ID not recognized'))

  ++ sessionData.rpcCount

  rpcReq = sessionData.rpcRequest
  if not rpcReq.next?
    sessionData.rpcRequest = null
  else if rpcReq.next == 'getInstanceKeys'
    instanceNumber = rpcRes.instanceNumber
    parameterNames = []
    instanceValues = {}
    for k, v of rpcReq.instanceValues
      n = "#{rpcReq.objectName}#{rpcRes.instanceNumber}.#{k}"
      parameterNames.push(n)
      instanceValues[n] = v

    if parameterNames.length == 0
      sessionData.rpcRequest = null
    else
      sessionData.rpcRequest = {
        type: 'GetParameterValues'
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
      sessionData.rpcRequest = null
    else
      sessionData.rpcRequest = {
        type: 'SetParameterValues'
        parameterList: parameterList
      }

  timestamp = sessionData.timestamp + sessionData.iteration

  revision = sessionData.revisions[sessionData.revisions.length - 1] + 1
  sessionData.deviceData.timestamps.revision = revision
  sessionData.deviceData.attributes.revision = revision

  toClear = null

  switch rpcRes.type
    when 'GetParameterValuesResponse'
      return callback(new Error('Response type does not match request type')) if rpcReq.type isnt 'GetParameterValues'

      for p in rpcRes.parameterList
        toClear = device.set(sessionData.deviceData, common.parsePath(p[0]), timestamp,
          {object: [timestamp, 0], value: [timestamp, p.slice(1)]}, toClear)

    when 'GetParameterNamesResponse'
      return callback(new Error('Response type does not match request type')) if rpcReq.type isnt 'GetParameterNames'

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

        if common.endsWith(p[0], '.')
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
        params.push([common.parsePath(k), timestamp, {object: [timestamp, 1], writable: [timestamp, 0]}])

      # Sort such that actual parameters are set before wildcard ones
      params.sort((a, b) ->
        al = a[0].length
        bl = b[0].length
        ++ bl if b[0][bl - 1] == '*'
        ++ al if a[0][al - 1] == '*'
        return al - bl
      )

      if rpcReq.nextLevel
        loadPath(sessionData, root, (1 << (root.length + 1)) - 1)
      else
        loadPath(sessionData, root, (1 << config.get('MAX_DEPTH', sessionData.deviceId) - 1))

      loadParameters(sessionData, (err) ->
        return callback(err) if err

        if root.length == 0
          for n in ['DeviceID', 'Events', 'Tags', 'Reboot', 'FactoryReset', 'VirtualParameters']
            if p = sessionData.deviceData.paths.subset([n]).next().value
              if sessionData.deviceData.attributes.has(p)
                sessionData.deviceData.timestamps.set(p, timestamp)

        for p in params
          toClear = device.set(sessionData.deviceData, p[0], p[1], p[2], toClear)

        clear(sessionData, toClear, callback)
      )
      return

    when 'SetParameterValuesResponse'
      return callback(new Error('Response type does not match request type')) if rpcReq.type isnt 'SetParameterValues'

      for p in rpcReq.parameterList
        toClear = device.set(sessionData.deviceData, common.parsePath(p[0]), timestamp + 1,
          {object: [timestamp + 1, 0], writable: [timestamp + 1, 1], value: [timestamp + 1, p.slice(1)]}, toClear)

    when 'AddObjectResponse'
      toClear = device.set(sessionData.deviceData, common.parsePath(rpcReq.objectName + rpcRes.instanceNumber),
        timestamp + 1, {object: [timestamp + 1, 1]}, toClear)

    when 'DeleteObjectResponse'
      toClear = device.set(sessionData.deviceData, common.parsePath(rpcReq.objectName.slice(0, -1)),
        timestamp + 1, null, toClear)

    when 'RebootResponse'
      toClear = device.set(sessionData.deviceData, common.parsePath('Reboot'),
        timestamp + 1, {value: [timestamp + 1, [timestamp + 1, 'xsd:dateTime']]}, toClear)

    when 'FactoryResetResponse'
      toClear = device.set(sessionData.deviceData, common.parsePath('FactoryReset'),
        timestamp + 1, {value: [timestamp + 1, [timestamp + 1, 'xsd:dateTime']]}, toClear)

    when 'DownloadResponse'
      toClear = device.set(sessionData.deviceData, ['Downloads', rpcReq.instance, 'Download'],
        timestamp + 1, {value: [timestamp + 1, [timestamp + 1, 'xsd:dateTime']]}, toClear)

      if rpcRes.status == 0
        toClear = device.set(sessionData.deviceData, ['Downloads', rpcReq.instance, 'LastDownload'],
          timestamp + 1, {value: [timestamp + 1, [timestamp + 1, 'xsd:dateTime']]}, toClear)
        toClear = device.set(sessionData.deviceData, ['Downloads', rpcReq.instance, 'LastFileType'],
          timestamp + 1, {value: [timestamp + 1, [rpcReq.fileType, 'xsd:dateTime']]}, toClear)
        toClear = device.set(sessionData.deviceData, ['Downloads', rpcReq.instance, 'LastFileName'],
          timestamp + 1, {value: [timestamp + 1, [rpcReq.fileType, 'xsd:dateTime']]}, toClear)
        toClear = device.set(sessionData.deviceData, ['Downloads', rpcReq.instance, 'LastTargetFileName'],
          timestamp + 1, {value: [timestamp + 1, [rpcReq.fileType, 'xsd:dateTime']]}, toClear)

        toClear = device.set(sessionData.deviceData, ['Downloads', rpcReq.instance, 'StartTime'],
          timestamp + 1, {value: [timestamp + 1, [+rpcRes.startTime, 'xsd:dateTime']]}, toClear)
        toClear = device.set(sessionData.deviceData, ['Downloads', rpcReq.instance, 'CompleteTime'],
          timestamp + 1, {value: [timestamp + 1, [+rpcRes.completeTime, 'xsd:dateTime']]}, toClear)
      else
        operation = {
          type: 'Download'
          timestamp: sessionData.timestamp
          provisions: {}
          retries: {}
          args: {
            instance: rpcReq.instance
            fileType: rpcReq.fileType
            fileName: rpcReq.fileName
            targetFileName: rpcReq.targetFileName
          }
        }

        for provision, i in sessionData.provisions[0]
          channel = sessionData.channels[i]
          operation.provisions[channel] ?= []
          operation.provisions[channel].push(provision)
          if sessionData.faults[channel]?
            operation.retries[channel] = sessionData.faults[channel].retries or 0

        sessionData.operations[rpcReq.commandKey] = operation
        sessionData.operationsTouched ?= {}
        sessionData.operationsTouched[rpcReq.commandKey] = 1

    else
      return callback(new Error('Response type not recognized'))

  return clear(sessionData, toClear, callback)


rpcFault = (sessionData, id, faultResponse, callback) ->
  # TODO Consider handling invalid parameter faults by automatically refreshing
  # relevant data model portions

  if not sessionData.provisions[0]?.length
    throw new Error('A fault occured while trying to discover parameters to test preset preconditions: ' + JSON.stringify(flt))

  faults = {}
  for p, i in sessionData.provisions[0]
    channel = sessionData.channels[i]
    fault = faults[channel]
    if not fault?
      fault = {
        provisions: []
        timestamp: sessionData.timestamp
        code: "cwmp.#{faultResponse.detail.Fault['FaultCode']}"
        message: faultResponse.detail.Fault['FaultString']
        detail: faultResponse.detail.Fault
      }

      if sessionData.faults[channel]?
        fault.retries = (sessionData.faults[channel].retries or 0) + 1

      faults[channel] = fault

    fault.provisions.push(p)

  clearProvisions(sessionData)
  return callback(null, faults)


deserialize = (sessionDataString, callback) ->
  cache.getProvisionsAndVirtualParameters((err, hash, provisions, virtualParameters) ->
    return callback(err) if err

    sessionData = JSON.parse(sessionDataString)

    if sessionData.presetsHash? and sessionData.presetsHash != hash
      return callback(new Error('Preset hash mismatch'))

    sessionData.cache = {
      provisions: provisions
      virtualParameters: virtualParameters
    }

    for d in sessionData.declarations
      common.addPathMeta(d[0])

    deviceData = initDeviceData()

    for r in sessionData.deviceData
      path = deviceData.paths.add(r[0])

      if r[1]
        deviceData.loaded.set(path, r[1])

      if r[2]
        deviceData.trackers.set(path, r[2])

      if r[3]
        deviceData.timestamps.setRevisions(path, r[3])

        if r[4]
          deviceData.attributes.setRevisions(path, r[4])

    sessionData.deviceData = deviceData

    return callback(null, sessionData)
  )


serialize = (sessionData, callback) ->
  deviceData = []

  iter = sessionData.deviceData.paths.find([], 99)
  while not (p = iter.next()).done
    path = p.value
    e = [path]
    e[1] = sessionData.deviceData.loaded.get(path) || 0
    e[2] = sessionData.deviceData.trackers.get(path) || null
    e[3] = sessionData.deviceData.timestamps.getRevisions(path) || null
    e[4] = sessionData.deviceData.attributes.getRevisions(path) || null

    deviceData.push(e)

  oldDeviceData = sessionData.deviceData
  oldSyncState = sessionData.syncState
  oldToLoad = sessionData.toLoad
  oldCache = sessionData.cache

  sessionData.deviceData = deviceData
  delete sessionData.syncState
  delete sessionData.toLoad
  delete sessionData.cache

  sessionDataString = JSON.stringify(sessionData)

  sessionData.deviceData = oldDeviceData
  sessionData.syncState = oldSyncState
  sessionData.toLoad = oldToLoad
  sessionData.cache = oldCache

  return callback(null, sessionDataString)


end = (sessionData, callback) ->
  counter = 2
  db.saveDevice(sessionData.deviceId, sessionData.deviceData, sessionData.new, (err) ->
    -- counter
    if err and counter > 0
      counter = 0
    return callback(err, sessionData.new) if counter == 0
  )

  db.redisClient.del("session_#{sessionData.id}", (err) ->
    -- counter
    if err and counter > 0
      counter = 0
    return callback(err, sessionData.new) if counter == 0
  )

  for k of sessionData.operationsTouched
    ++ counter
    if sessionData.operations[k]?
      db.saveOperation(sessionData.deviceId, k, sessionData.operations[k], (err) ->
        -- counter
        if err and counter > 0
          counter = 0
        return callback(err, sessionData.new) if counter == 0
      )
    else
      db.deleteOperation(sessionData.deviceId, k, (err) ->
        -- counter
        if err and counter > 0
          counter = 0
        return callback(err, sessionData.new) if counter == 0
      )


exports.init = init
exports.timeoutOperations = timeoutOperations
exports.inform = inform
exports.transferComplete = transferComplete
exports.addProvisions = addProvisions
exports.clearProvisions = clearProvisions
exports.rpcRequest = rpcRequest
exports.rpcResponse = rpcResponse
exports.rpcFault = rpcFault
exports.end = end
exports.serialize = serialize
exports.deserialize = deserialize
