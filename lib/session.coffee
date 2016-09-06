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
extensions = require './extensions'
PathSet = require './path-set'
VersionedMap = require './versioned-map.js'
InstanceSet = require './instance-set'


initDeviceData = () ->
  return {
    paths : new PathSet()
    timestamps : {exist: new VersionedMap(), object: new VersionedMap(), writable: new VersionedMap(), value: new VersionedMap()}
    values : {exist: new VersionedMap(), object: new VersionedMap(), writable: new VersionedMap(), value: new VersionedMap()}
    loaded : new Map()
  }


init = (deviceId, cwmpVersion, timeout, callback) ->
  timestamp = Date.now()

  sessionData = {
    timestamp : timestamp
    deviceId : deviceId
    deviceData : initDeviceData()
    cwmpVersion : cwmpVersion
    timeout : timeout
    provisions: [[]]
    channels: []
    revisions: [0]
    rpcCount: 0
    cycle: 0
    extensionsCache: []
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
      loaded = [[[], 99]]
      parameters = []

    vparams = {}

    for p in loaded
      path = sessionData.deviceData.paths.add(p[0])

      if p[1]
        l = sessionData.deviceData.loaded.get(path) || 0
        sessionData.deviceData.loaded.set(path, Math.max(l, p[1]))

      if path.length <= 2 and path.length + p[1] > 2
        if path.length < 1 or path[0] == '*' or path[0] == 'VirtualParameters'
          if path.length < 2 or path[1] == '*'
            vparams['*'] = 1
          else
            vparams[path[1]] = 1

      if path.length <= 1 and path.length + p[1] > 1
        if path.length < 1 or path[0] == '*' or path[0] == 'VirtualParameters'
          vparams[''] = 1

    for p in parameters
      path = sessionData.deviceData.paths.add(p[0])

      for k, v of p[1]
        sessionData.deviceData.timestamps[k].set(path, v, 0)

      for k, v of p[2]
        sessionData.deviceData.values[k].set(path, v, 0)

    # Virtual parameters
    if vparams['']
      device.set(sessionData.deviceData, ['VirtualParameters'],
        {exist: sessionData.timestamp, object: sessionData.timestamp, writable: sessionData.timestamp},
        {exist: 1, object: 1, writable: 0})
      delete vparams['']

    if vparams['*']
      for k, v of sessionData.cache.virtualParameters
        device.set(sessionData.deviceData, ['VirtualParameters', k],
          {exist: sessionData.timestamp, object: sessionData.timestamp},
          {exist: 1, object: 0})

      device.set(sessionData.deviceData, ['VirtualParameters', '*'],
        {exist: sessionData.timestamp})
    else
      for k of vparams
        if k of sessionData.cache.virtualParameters
          device.set(sessionData.deviceData, ['VirtualParameters', k]
            {exist: sessionData.timestamp, object: sessionData.timestamp},
            {exist: 1, object: 0})
        else
          device.set(sessionData.deviceData, ['VirtualParameters', k], {exist: sessionData.timestamp})

    delete sessionData.toLoad
    return callback()
  )


generateRpcId = (sessionData) ->
  if sessionData.rpcCount > 255 or sessionData.cycle > 15 or sessionData.revisions.length > 15
    throw new Error('Too many RPCs')

  return sessionData.timestamp.toString(16) + "0#{sessionData.rpcCount.toString(16)}".slice(-2)


inform = (sessionData, rpcReq, callback) ->
  timestamp = sessionData.timestamp

  params = []
  params.push([['DeviceID', 'Manufacturer'],
    {exist: timestamp, object: timestamp, writable: timestamp, value: timestamp},
    {exist: 1, object: 0, writable: 0, value: [rpcReq.deviceId.Manufacturer, 'xsd:string']}])

  params.push([['DeviceID', 'OUI'],
    {exist: timestamp, object: timestamp, writable: timestamp, value: timestamp},
    {exist: 1, object: 0, writable: 0, value: [rpcReq.deviceId.OUI, 'xsd:string']}])

  params.push([['DeviceID', 'ProductClass'],
    {exist: timestamp, object: timestamp, writable: timestamp, value: timestamp},
    {exist: 1, object: 0, writable: 0, value: [rpcReq.deviceId.ProductClass, 'xsd:string']}])

  params.push([['DeviceID', 'SerialNumber'],
    {exist: timestamp, object: timestamp, writable: timestamp, value: timestamp},
    {exist: 1, object: 0, writable: 0, value: [rpcReq.deviceId.SerialNumber, 'xsd:string']}])

  for p in rpcReq.parameterList
    path = common.parsePath(p[0])
    params.push([path,
      {exist: timestamp, object: timestamp, value: timestamp},
      {exist: 1, object: 0, value: p.slice(1)}])

  params.push([['Events', 'Inform'],
    {exist: timestamp, object: timestamp, writable: timestamp, value: timestamp},
    {exist: 1, object: 0, writable: 0, value: [timestamp, 'xsd:dateTime']}])

  for e in rpcReq.event
    params.push([['Events', e.replace(' ', '_')],
      {exist: timestamp, object: timestamp, writable: timestamp, value: timestamp},
      {exist: 1, object: 0, writable: 0, value: [timestamp, 'xsd:dateTime']}])

  for p in params
    loadPath(sessionData, p[0])

  loadParameters(sessionData, (err) ->
    return callback(err) if err

    v.revision = 1 for k, v of sessionData.deviceData.timestamps
    v.revision = 1 for k, v of sessionData.deviceData.values

    for p in params
      device.set(sessionData.deviceData, p[0], p[1], p[2])

    return callback(null, {type : 'InformResponse'})
  )


addProvisions = (sessionData, channel, provisions) ->
  sessionData.declarations = []
  sessionData.provisions.length = 1
  sessionData.doneProvisions = 0
  sessionData.doneDeclarations = 0

  for provision, i in provisions
    # Remove duplicate provisions
    for p, j in sessionData.provisions[0]
      if channel == sessionData.channels[j] and JSON.stringify(p) == JSON.stringify(provision)
        sessionData.provisions.splice(j, 1)
        sessionData.channels.splice(j, 1)

    sessionData.provisions[0].push(provision)
    sessionData.channels.push(channel)

  if sessionData.revisions.length > 1 or sessionData.revisions[0] > 0
    v.collapse(1) for k, v of sessionData.timestamps
    v.collapse(1) for k, v of sessionData.values
    sessionData.cycle += 1
    sessionData.rpcCount = 0
    sessionData.revisions = [0]
    sessionData.extensionsCache.length = 0


clearProvisions = (sessionData) ->
  delete sessionData.syncState
  sessionData.provisions = [[]]
  sessionData.channels = []
  sessionData.declarations = []
  sessionData.doneProvisions = 0
  sessionData.doneDeclarations = 0
  if sessionData.revisions.length > 1 or sessionData.revisions[0] > 0
    v.collapse(1) for k, v of sessionData.deviceData.timestamps
    v.collapse(1) for k, v of sessionData.deviceData.values
    sessionData.cycle += 1
    sessionData.rpcCount = 0
    sessionData.revisions = [0]
    sessionData.extensionsCache.length = 0


runProvisions = (sessionData, provisions, startRevision, endRevision, callback) ->
  done = true
  _extensions = []
  allDeclarations = []
  for provision in provisions
    if not sessionData.cache.provisions[provision[0]]?
      switch provision[0]
        when 'refresh'
          path = common.parsePath(provision[1]).slice()
          l = path.length
          path.length = 10
          path.fill('*', l)
          t = provision[2]
          t += sessionData.timestamp if t <= 0

          for i in [l...path.length] by 1
            p = common.addPathMeta(path.slice(0, i))
            allDeclarations.push([p, {exist: t, object: 1, writable: 1, value: t}])
        when 'value'
          allDeclarations.push([common.parsePath(provision[1]), {exist: 1, value: 1}, {value: [provision[2]]}])
        when 'tag'
          allDeclarations.push([['Tags', provision[1]], {exist: 1, value: 1}, {exist: 1, value: [provision[2], 'xsd:boolean']}])
        when '_task'
          # A special provision for tasks compatibility
          switch provision[2]
            when 'getParameterValues'
              for i in [3...provision.length] by 1
                allDeclarations.push([common.parsePath(provision[i]), {exist: 1, value: sessionData.timestamp}])
            when 'setParameterValues'
              for i in [3...provision.length] by 3
                v = if provision[i + 2] then [provision[i + 1], provision[i + 2]] else [provision[i + 1]]
                allDeclarations.push([common.parsePath(provision[i]), {exist: 1, value: 1}, {value: v}])
            when 'refreshObject'
              path = common.parsePath(provision[3]).slice()
              l = path.length
              path.length = 10
              path.fill('*', l)
              for i in [l...path.length] by 1
                p = common.addPathMeta(path.slice(0, i))
                allDeclarations.push([p, {exist: sessionData.timestamp, object: 1, writable: 1, value: sessionData.timestamp}])
      continue

    ret = sandbox.run(sessionData.cache.provisions[provision[0]].script, {args: provision[1]}, sessionData.timestamp, sessionData.deviceData, sessionData.extensionsCache, startRevision, endRevision)
    if ret.extensions?.length
      _extensions = _extensions.concat(ret.extensions)
    done &&= ret.done
    allDeclarations = allDeclarations.concat(ret.declarations)

  if _extensions.length
    return runExtensions(sessionData, endRevision, _extensions, (err) ->
      return callback(err) if err
      return runProvisions(sessionData, provisions, startRevision, endRevision, callback)
    )

  return callback(null, done, allDeclarations)


runVirtualParameters = (sessionData, provisions, startRevision, endRevision, callback) ->
  done = true
  decs = []
  virtualParameterUpdates = []
  _extensions = []

  for provision in provisions
    ret = sandbox.run(sessionData.cache.virtualParameters[provision[0]].script, provision[1], sessionData.timestamp, sessionData.deviceData, sessionData.extensionsCache, startRevision, endRevision)
    if ret.extensions?.length
      _extensions = _extensions.concat(ret.extensions)
    done &&= ret.done
    decs = decs.concat(ret.declarations)

    if ret.done
      virtualParameterUpdates.push([provision[0], ret.returnValue])

  if _extensions.length
    return runExtensions(sessionData, endRevision, _extensions, (err) ->
      return callback(err) if err
      return runVirtualParameters(sessionData, provisions, startRevision, endRevision, callback)
    )

  if virtualParameterUpdates.length == provisions.length
    for vpu, i in virtualParameterUpdates
      commitVirtualParameter(sessionData, vpu[0], provisions[i][1], vpu[1])

  return callback(null, done, decs)


runDeclarations = (sessionData, declarations, callback) ->
  done = true
  if sessionData.toLoad?.length
    return loadParameters(sessionData, (err) ->
      return callback(err) if err
      runDeclarations(sessionData, declarations, callback)
    )

  for d in declarations
    done &= applyDeclaration(sessionData, d[0], d[1], d[2])

  if sessionData.syncState? and sessionData.syncState.virtualParameters?
    provisions = []
    for k, v of sessionData.syncState.virtualParameters
      provisions.push([k, v])
    sessionData.syncState.virtualParameters = {}

  return callback(null, done, provisions)


rpcRequest = (sessionData, _declarations, callback) ->
  if sessionData.rpcRequest?
    return callback(null, generateRpcId(sessionData), sessionData.rpcRequest)

  if sessionData.syncState? and (rpcReq = generateRpcRequest(sessionData))?
    sessionData.rpcRequest = rpcReq
    return callback(null, generateRpcId(sessionData), rpcReq)

  revision = sessionData.revisions[sessionData.revisions.length - 1] + 1
  v.revision = revision for k, v of sessionData.deviceData.timestamps
  v.revision = revision for k, v of sessionData.deviceData.values

  if _declarations?.length
    sessionData.declarations = []
    sessionData.provisions[0] ?= []
    sessionData.revisions[0] ?= 0
    sessionData.doneDeclarations = 0
    sessionData.doneProvisions = 0

  if sessionData.declarations.length != sessionData.provisions.length
    inception = sessionData.declarations.length
    run = if inception == 0 then runProvisions else runVirtualParameters

    return run(sessionData, sessionData.provisions[inception], sessionData.revisions[inception - 1] ? 0, sessionData.revisions[inception], f = (err, done, decs) ->
      return callback(err) if err

      if _declarations?.length
        decs = decs.concat(_declarations)

      sessionData.declarations.push(decs)
      sessionData.doneProvisions |= 1 << inception if done

      if ++ inception < sessionData.provisions.length
        if inception == 1 and _declarations?.length
          for d in _declarations
            sessionData.declarations[0].push(d)
            for ad in device.getAliasDeclarations(d[0], 1)
              loadPath(sessionData, ad[0])
      else
        if not decs.length
          while sessionData.doneDeclarations & (1 << (sessionData.declarations.length - 1))
            sessionData.declarations.pop()

          while sessionData.provisions.length > (sessionData.declarations.length or 1) and
              sessionData.doneProvisions & (1 << (sessionData.provisions.length - 1))
            sessionData.provisions.pop()
            sessionData.revisions.pop()
            rev = sessionData.revisions[sessionData.revisions.length - 1]
            m.collapse(rev + 1) for k, m of sessionData.deviceData.timestamps
            m.collapse(rev + 1) for k, m of sessionData.deviceData.values
            sessionData.extensionsCache.splice(rev)

          sessionData.doneDeclarations &= (1 << sessionData.declarations.length) - 1
          sessionData.doneProvisions &= (1 << sessionData.provisions.length) - 1

          if sessionData.provisions.length == 1 and sessionData.doneProvisions
            return callback()

        for d in decs
          for ad in device.getAliasDeclarations(d[0], 1)
            loadPath(sessionData, ad[0])

        return rpcRequest(sessionData, null, callback)

      return runVirtualParameters(sessionData, sessionData.provisions[inception], sessionData.revisions[inception - 1], sessionData.revisions[inception], f)
    )

  return callback() if not sessionData.declarations.length

  inception = 0
  runDeclarations(sessionData, sessionData.declarations[inception], f = (err, done, provisions) ->
    return callback(err) if err
    sessionData.doneDeclarations |= 1 << (sessionData.revisions.length - 1)
    if ++ inception < sessionData.revisions.length
      return runDeclarations(sessionData, sessionData.declarations[inception], f)

    if provisions?.length
      rev = sessionData.revisions[sessionData.revisions.length - 1]
      sessionData.revisions.push(rev)
      sessionData.provisions.push(provisions)
      return runVirtualParameters(sessionData, provisions, rev, rev, (err, done, declarations) ->
        return callback(err) if err
        sessionData.doneProvisions |= 1 << (sessionData.revisions.length - 1) if done
        for d in declarations
          for ad in device.getAliasDeclarations(d[0], 1)
            loadPath(sessionData, ad[0])
        sessionData.declarations.push(declarations)
        runDeclarations(sessionData, declarations, f)
      )

    rpcReq = generateRpcRequest(sessionData)
    if not rpcReq?
      while sessionData.doneDeclarations & (1 << (sessionData.declarations.length - 1))
        sessionData.declarations.pop()

      while sessionData.provisions.length > (sessionData.declarations.length or 1) and
          sessionData.doneProvisions & (1 << (sessionData.provisions.length - 1))
        sessionData.provisions.pop()
        sessionData.revisions.pop()
        rev = sessionData.revisions[sessionData.revisions.length - 1]
        m.collapse(rev + 1) for k, m of sessionData.deviceData.timestamps
        m.collapse(rev + 1) for k, m of sessionData.deviceData.values
        sessionData.extensionsCache.splice(rev)

      sessionData.doneDeclarations &= (1 << sessionData.declarations.length) - 1
      sessionData.doneProvisions &= (1 << sessionData.provisions.length) - 1

      if sessionData.provisions.length == 1 and sessionData.doneProvisions
        return callback()

      ++ sessionData.revisions[sessionData.revisions.length - 1]
      return rpcRequest(sessionData, _declarations, callback)

    sessionData.rpcRequest = rpcReq
    return callback(null, generateRpcId(sessionData), rpcReq)
  )


generateRpcRequest = (sessionData) ->
  if not (syncState = sessionData.syncState)?
    return

  iter = syncState.refreshAttributes.exist.values()
  while (path = iter.next().value)
    descendantIter = syncState.paths.subset(path, 99)
    found = false
    while (p = descendantIter.next().value)?
      if syncState.refreshAttributes.value.has(p) or
          syncState.refreshAttributes.object.has(p) or
          syncState.refreshAttributes.writable.has(p) or
          syncState.refreshGpn.has(p)
        found = true
        break
    if not found
      path = syncState.paths.add(path.slice(0, -1))
      syncState.refreshGpn.set(path, syncState.refreshGpn.get(path) or 1)
  syncState.refreshAttributes.exist.clear()

  iter = syncState.refreshAttributes.object.values()
  while (path = iter.next().value)
    descendantIter = syncState.paths.subset(path, 99)
    found = false
    while (p = descendantIter.next().value)?
      if syncState.refreshAttributes.value.has(p) or
          (p.length > path.length and
          (syncState.refreshAttributes.object.has(p) or
          syncState.refreshAttributes.writable.has(p)))
        found = true
        break
    if not found
      path = syncState.paths.add(path.slice(0, -1))
      syncState.refreshGpn.set(path, syncState.refreshGpn.get(path) or 1)
  syncState.refreshAttributes.object.clear()

  iter = syncState.refreshAttributes.writable.values()
  while (path = iter.next().value)
    path = syncState.paths.add(path.slice(0, -1))
    syncState.refreshGpn.set(path, syncState.refreshGpn.get(path) or 1)
  syncState.refreshAttributes.writable.clear()

  iter = syncState.refreshGpn.keys()
  while (path = iter.next().value)
    descendantIter = syncState.paths.subset(path, 99)
    found = false
    while (p = descendantIter.next().value)?
      continue if p == path
      if (flags = syncState.refreshGpn.get(p))
        flags <<= p.length - path.length
        syncState.refreshGpn.set(path, syncState.refreshGpn.get(path) | flags)
        syncState.refreshGpn.delete(p)

  rpcReq = null
  completed = true

  if syncState.refreshGpn.size
    if rpcReq?
      completed = false
    else
      GET_PARAMETER_NAMES_DEPTH_THRESHOLD =
        config.get('GET_PARAMETER_NAMES_DEPTH_THRESHOLD', sessionData.deviceId)

      pair = syncState.refreshGpn.entries().next().value

      nextLevel = true
      if pair[0].length >= GET_PARAMETER_NAMES_DEPTH_THRESHOLD
        nextLevel = false
      else if common.hammingWeight(pair[1] >> 3) >= 3
        nextLevel = false

      if syncState.refreshGpn.size > 1 or (pair[1] > 1 and nextLevel)
        completed = false

      rpcReq = {
        type: 'GetParameterNames'
        parameterPath: pair[0].concat('').join('.')
        nextLevel: nextLevel
      }
      syncState.refreshGpn.delete(pair[0])

  if syncState.refreshAttributes.value.size
    if rpcReq?
      completed = false
    else
      TASK_PARAMETERS_BATCH_SIZE =
        config.get('TASK_PARAMETERS_BATCH_SIZE', sessionData.deviceId)

      parameterNames = []
      iter = syncState.refreshAttributes.value.values()
      while (path = iter.next().value) and
          parameterNames.length < TASK_PARAMETERS_BATCH_SIZE
        parameterNames.push(path)
        syncState.refreshAttributes.value.delete(path)

      if syncState.refreshAttributes.value.size > parameterNames.length
        completed = false

      rpcReq = {
        type: 'GetParameterValues'
        parameterNames: (p.join('.') for p in parameterNames)
      }

  refreshDone = not rpcReq?
  # Skip write if read isn't finished
  sessionData.syncState.setValues.clear()
  sessionData.syncState.instancesToDelete.clear()
  sessionData.syncState.instancesToCreate.clear()

  # Delete instance
  syncState.instancesToDelete.forEach((instances, parent) ->
    instances.forEach((instance, index, thisArray) ->
      if rpcReq?
        completed = false
      else
        rpcReq = {
          type: 'DeleteObject'
          objectName: instance.join('.') + '.'
        }
        thisArray.splice(index, 1)
    )
  )

  syncState.instancesToDelete.clear() if not refreshDone

  # Create instance
  syncState.instancesToCreate.forEach((instances, parent) ->
    instances.forEach((instance, index, thisArray) ->
      if rpcReq?
        completed = false
      else
        rpcReq = {
          type: 'AddObject'
          objectName: parent.join('.') + '.'
          next: 'getInstanceKeys'
          instanceValues: instance
        }
        thisArray.splice(index, 1)
    )
  )

  syncState.instancesToCreate.clear() if not refreshDone

  # Set values
  TASK_PARAMETERS_BATCH_SIZE =
    config.get('TASK_PARAMETERS_BATCH_SIZE', sessionData.deviceId)

  parameterValues = []
  syncState.setValues.forEach((v, k) ->
    return if completed == false

    if (curVal = sessionData.deviceData.values.value.get(k))? and sessionData.deviceData.values.writable.get(k)
      val = v.slice()
      val[1] = curVal[1] if not val[1]?
      device.sanitizeParameterValue(val)

      if val[0] != curVal[0] or val[1] != curVal[1]
        if rpcReq? or parameterValues.length >= TASK_PARAMETERS_BATCH_SIZE
          completed = false
          return

        parameterValues.push([k, val[0], val[1]])
        syncState.setValues.delete(k)
  )

  syncState.setValues.clear() if not refreshDone

  if parameterValues.length and not rpcReq?
    rpcReq = {
      type: 'SetParameterValues'
      parameterList: ([p[0].join('.'), p[1], p[2]] for p in parameterValues)
    }

  if completed and rpcReq?
    rpcReq.done = true

  return rpcReq


processVirtualparameterDeclaration = (sessionData, path, timestamps, values) ->
  ret = true
  return ret if path.length != 2
  deviceData = sessionData.deviceData
  subIter = sessionData.deviceData.paths.subset(path)
  while sub = subIter.next().value
    continue if sub[0] isnt 'VirtualParameters'
    continue if not deviceData.values.exist.get(sub)

    isWritable = deviceData.values.writable.get(sub)

    for k, v of timestamps
      if not (v <= deviceData.timestamps[k].get(sub))
        sessionData.syncState.virtualParameters[sub[1]] ?= {timestamps: {}, values: {}}
        sessionData.syncState.virtualParameters[sub[1]].timestamps[k] =
          Math.max(v, sessionData.syncState.virtualParameters[sub[1]].timestamps[k] ? 0)
        ret = false

    if values?.value?
      if isWritable == 1
        sessionData.syncState.virtualParameters[sub[1]] ?= {timestamps: {}, values: {}}
        cur = sessionData.syncState.virtualParameters[sub[1]].values.value
        if not cur?
          cur = [deviceData.values.value.get(sub), values.value]
          sessionData.syncState.virtualParameters[sub[1]].values.value = cur
        else
          cur[1] = values.value
      else if not isWritable?
        sessionData.syncState.virtualParameters[sub[1]] ?= {timestamps: {}, values: {}}
        sessionData.syncState.virtualParameters[sub[1]].timestamps.writable =
          Math.max(1, sessionData.syncState.virtualParameters[sub[1]].timestamps.writable ? 0)
        ret = false

  return ret


processDeclaration = (sessionData, path, _timestamps, values) ->
  syncState = sessionData.syncState
  deviceData = sessionData.deviceData

  timestamps = {}
  timestamps[k] = v for k, v of _timestamps
  timestamps.exist ?= 1

  ret = true

  if path[0] == '*' or path[0] == 'VirtualParameters'
    ret = processVirtualparameterDeclaration(sessionData, path, _timestamps, values) && ret
    return ret if path[0] != '*'

  iter = sessionData.deviceData.paths.superset(path)
  param = null
  existTimestamp = 0
  while sup = iter.next().value
    param = sup if not sup.wildcard
    for k, v of timestamps
      continue if not (t = deviceData.timestamps[k].get(sup))?
      existTimestamp = Math.max(existTimestamp, t) if k is 'exist'
      delete timestamps[k] if t >= v

  if not Object.keys(timestamps).length and
      not (values? and Object.keys(values).length)
    return ret

  if param?
    if deviceData.values.exist.get(param)
      param = syncState.paths.add(param)
      isObject = deviceData.values.object.get(param)
      isWritable = deviceData.values.writable.get(param)

      for k of timestamps
        if k isnt 'value' or isObject == 0
          syncState.refreshAttributes[k].add(param)
          ret = false
        else if not isObject?
          syncState.refreshAttributes.object.add(param)
          ret = false

      if values?.value?
        syncState.setValues.set(param, values.value)
        if not isObject?
          syncState.refreshAttributes.object.add(param)
          ret = false
        if not isWritable?
          syncState.refreshAttributes.writable.add(param)
          ret = false
      return ret
    else if existTimestamp >= (timestamps.exist or 1)
      return ret
  else if path.indexOf('*') >= 0
    subIter = deviceData.paths.subset(path)
    while sub = subIter.next().value
      continue if not deviceData.values.exist.get(sub)

      isObject = deviceData.values.object.get(sub)
      isWritable = deviceData.values.writable.get(sub)

      for k, v of timestamps
        if not (v <= deviceData.timestamps[k].get(sub))
          if k isnt 'value' or isObject == 0
            sub = syncState.paths.add(sub)
            syncState.refreshAttributes[k].add(sub)
            ret = false
          else if not isObject?
            sub = syncState.paths.add(sub)
            syncState.refreshAttributes.object.add(sub)
            ret = false

      if values?.value?
        syncState.setValues.set(sub, values.value)
        if not isObject?
          syncState.refreshAttributes.object.add(sub)
          ret = false
        if not isWritable?
          syncState.refreshAttributes.writable.add(sub)
          ret = false

  if existTimestamp >= (timestamps.exist or 1)
    return ret

  childrenTimestamp = existTimestamp

  for i in [path.length - 1...0] by -1
    existTimestamp = 0
    p = path.slice(0, i)
    iter = deviceData.paths.superset(p)
    param = null
    while sup = iter.next().value
      param = sup if not sup.wildcard
      if (t = deviceData.timestamps.exist.get(sup))?
        existTimestamp = Math.max(existTimestamp, t)

    if param?
      if deviceData.values.exist.get(param)
        isObject = deviceData.values.object.get(param)
        objectTimestamp = deviceData.timestamps.object.get(param)
        if isObject
          if childrenTimestamp == 0
            param = syncState.paths.add(param)
            syncState.refreshGpn.set(param, syncState.refreshGpn.get(param) | ((1 << path.length - i) - 1))
            ret = false
          else if childrenTimestamp < (timestamps.exist or 1)
            param = syncState.paths.add(param)
            syncState.refreshGpn.set(param, syncState.refreshGpn.get(param) or 1)
            ret = false
        if not (objectTimestamp >= (timestamps.exist or 1))
          param = syncState.paths.add(param)
          syncState.refreshAttributes.object.add(param)
          ret = false
      #   return ret
      # else if existTimestamp >= (timestamps.exist or 1)
      #   return ret
    else if p.indexOf('*') >= 0
      subIter = deviceData.paths.subset(p)
      while sub = subIter.next().value
        continue if not deviceData.values.exist.get(sub)
        # TODO check if not object
        pp = sub.concat(path.slice(sub.length))
        ts = {}
        ts[k] = v for k, v of timestamps
        ret = processDeclaration(sessionData, pp, ts) && ret

    if existTimestamp >= (timestamps.exist or 1)
      return ret

    childrenTimestamp = existTimestamp

  p = syncState.paths.add([])
  ret = false
  syncState.refreshGpn.set(p, syncState.refreshGpn.get(p) or 1)
  return ret


loadPath = (sessionData, path) ->
  return true if sessionData.new
  tl = []
  for i in [path.length...0] by -1
    p = path.slice(0, i)
    loaded = 0
    iter = sessionData.deviceData.paths.superset(p)

    while sup = iter.next().value
      if (l = sessionData.deviceData.loaded.get(sup)) > loaded
        loaded = l

    if loaded
      tl = tl.slice(0, tl.length - (loaded - 1))
      break

    tl.push(p)

  if not tl.length
    return true

  sessionData.toLoad ?= []
  sessionData.toLoad = sessionData.toLoad.concat(tl)
  return false


processInstances = (sessionData, parent, parameters, keys, minInstances, maxInstances) ->
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


applyDeclaration = (sessionData, path, timestamps, values) ->
  sessionData.syncState ?= {
    paths: new PathSet()
    refreshAttributes: {
      exist: new Set()
      object: new Set()
      writable: new Set()
      value: new Set()
    }
    setValues: new Map()
    refreshGpn: new Map()
    virtualParameters: {}
    instancesToDelete: new Map()
    instancesToCreate: new Map()
  }

  decs = device.getAliasDeclarations(path, timestamps.exist ? 1)

  if decs.length == 1
    processDeclaration(sessionData, decs[0][0], timestamps, values)
    return true

  satisfied = true

  for d in decs
    satisfied = processDeclaration(sessionData, d[0], d[1]) && satisfied

  return false if not satisfied

  unpacked = device.unpack(sessionData.deviceData, path)

  if values.exist?
    if Array.isArray(values.exist)
      minInstances = values.exist[0]
      maxInstances = values.exist[1]
    else
      minInstances = maxInstances = values.exist

    parent = path.slice(0, -1)

    if Array.isArray(path[path.length - 1])
      keys = {}
      for p, i in path[path.length - 1] by 2
        keys[p] = path[path.length - 1][i + 1]
    else if path[path.length - 1] == '*'
      keys = {}

    if (path.wildcard | path.alias) & ((1 << (path.length - 1)) - 1) == 0
      processInstances(sessionData, parent, unpacked, keys, minInstances, maxInstances)
    else
      parentsUnpacked = device.unpack(sessionData.deviceData, parent)
      for parent in parentsUnpacked
        processInstances(sessionData, parent, device.unpack(sessionData.deviceData, parent.concat([path[parent.length]])), keys, minInstances, maxInstances)

  for up in unpacked
    processDeclaration(sessionData, path, timestamps, values)

  return true


commitVirtualParameter = (sessionData, name, declaration, update) ->
  t = {}
  v = {}
  if update.writable?
    if update.writable[0] <= 0
      t.writable = sessionData.timestamp + update.writable[0]
    else
      t.writable = Math.min(sessionData.timestamp, update.writable[0])

    if declaration.timestamps.writable?
      t.writable = Math.max(declaration.timestamps.writable, t.writable)

    v.writable = +update.writable[1]
  else if declaration.timestamps.writable?
    throw new Error('Virtual parameter must provide declared attributes')

  if update.value?
    if update.value[0] <= 0
      t.value = sessionData.timestamp + update.value[0]
    else
      t.value = Math.min(sessionData.timestamp, update.value[0])

    if declaration.timestamps.value?
      t.value = Math.max(declaration.timestamps.value, t.value)

    v.value = device.sanitizeParameterValue(update.value[1])
  else if declaration.timestamps.value?
    throw new Error('Virtual parameter must provide declared attributes')

  device.set(sessionData.deviceData, ['VirtualParameters', name], t, v)


runExtensions = (sessionData, revision, _extensions, callback) ->
  sessionData.extensionsCache[revision] ?= {}
  obj = {}
  for e in _extensions
    obj[JSON.stringify(e)] = e

  counter = 1
  for k, v of obj
    ++ counter
    do (k, v) ->
      extensions.run(v, (err, res) ->
        sessionData.extensionsCache[revision][k] = res

        if -- counter == 0 or err
          counter = 0
          return callback(err)
      )

  if -- counter == 0
    return callback()


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

  timestamp = sessionData.timestamp
  revision = sessionData.revisions.reduce(((a, b) -> a + (b >> 1)), 0) + 1

  v.revision = revision for k, v of sessionData.deviceData.timestamps
  v.revision = revision for k, v of sessionData.deviceData.values

  switch rpcRes.type
    when 'GetParameterValuesResponse'
      return callback(new Error('Response type does not match request type')) if rpcReq.type isnt 'GetParameterValues'

      for p in rpcRes.parameterList
        device.set(sessionData.deviceData, common.parsePath(p[0]),
          {exist: timestamp, object: timestamp, value: timestamp},
          {exist: 1, object: 0, value: p.slice(1)})

    when 'GetParameterNamesResponse'
      return callback(new Error('Response type does not match request type')) if rpcReq.type isnt 'GetParameterNames'

      if rpcReq.parameterPath.endsWith('.')
        root = common.parsePath(rpcReq.parameterPath.slice(0, -1))
      else
        root = common.parsePath(rpcReq.parameterPath)

      params = []
      params.push([root.concat('*'), {exist: timestamp}])

      for p in rpcRes.parameterList
        if common.endsWith(p[0], '.')
          path = common.parsePath(p[0][0...-1])
          if not rpcReq.nextLevel
            params.push([path.concat('*'), {exist: timestamp}])

          params.push([path,
            {exist: timestamp, object: timestamp, writable: timestamp},
            {exist: 1, object: 1, writable: if p[1] then 1 else 0}])

        else
          params.push([common.parsePath(p[0]),
            {exist: timestamp, object: timestamp, writable: timestamp},
            {exist: 1, object: 0, writable: if p[1] then 1 else 0}])

      # Sort such that actual parameters are set before wildcard ones
      params.sort((a, b) ->
        al = a[0].length
        bl = b[0].length
        -- bl if b[0][bl - 1] == '*'
        -- al if a[0][al - 1] == '*'
        return bl - al
      )

      p = root.slice()
      p.length = params[params.length - 1].length
      p.fill('*', root.length)
      loadPath(sessionData, p)
      loadParameters(sessionData, (err) ->
        return callback(err) if err

        for p in params
          device.set(sessionData.deviceData, p[0], p[1], p[2])

        return callback()
      )
      return

    when 'SetParameterValuesResponse'
      return callback(new Error('Response type does not match request type')) if rpcReq.type isnt 'SetParameterValues'

      for p in rpcReq.parameterList
        device.set(sessionData.deviceData, common.parsePath(p[0]),
          {exist: timestamp, object: timestamp, writable: timestamp, value: timestamp},
          {exist: 1, object: 0, writable: 1, value: p.slice(1)})

    when 'AddObjectResponse'
      device.set(sessionData.deviceData, common.parsePath(rpcReq.objectName + rpcRes.instanceNumber),
        {exist: timestamp, object: timestamp},
        {exist: 1, object: 1})

    when 'DeleteObjectResponse'
      device.set(sessionData.deviceData, common.parsePath(rpcReq.objectName.slice(0, -1)),
        {exist: timestamp})

    else
      return callback(new Error('Response type not recognized'))

  return callback()


rpcFault = (sessionData, id, faultResponse, callback) ->
  # TODO Consider handling invalid parameter faults by automatically refreshing
  # relevant data model portions
  delete sessionData.rpcRequest
  return callback(null, faultResponse)


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
    keys = ['exist', 'object', 'writable', 'value']
    for r in sessionData.deviceData
      path = deviceData.paths.add(r[0])

      if r[1]
        deviceData.loaded.set(path, r[1])

      for k, i in keys
        if r[2 + i]?
          deviceData.timestamps[k].setRevisions(path, r[2 + i])

        if r[2 + keys.length + i]?
          deviceData.values[k].setRevisions(path, r[2 + keys.length +  i])

    sessionData.deviceData = deviceData

    return callback(null, sessionData)
  )


serialize = (sessionData, callback) ->
  deviceData = []
  keys = ['exist', 'object', 'writable', 'value']
  iter = sessionData.deviceData.paths.find([], 99)
  while not (p = iter.next()).done
    path = p.value
    e = [path]
    e[1] = sessionData.deviceData.loaded.get(path) || 0
    for k, i in keys
      if r = sessionData.deviceData.timestamps[k].getRevisions(path)
        e[2 + i] = r

      if r = sessionData.deviceData.values[k].getRevisions(path)
        e[2 + keys.length + i] = r

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
  db.saveDevice(sessionData.deviceId, sessionData.deviceData, sessionData.new, (err) ->
    return callback(err) if err
    db.redisClient.del("session_#{sessionData.id}", (err) ->
      callback(err, sessionData.new)
    )
  )


exports.init = init
exports.inform = inform
exports.addProvisions = addProvisions
exports.clearProvisions = clearProvisions
exports.rpcRequest = rpcRequest
exports.rpcResponse = rpcResponse
exports.rpcFault = rpcFault
exports.end = end
exports.serialize = serialize
exports.deserialize = deserialize
