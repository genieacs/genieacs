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

crypto = require 'crypto'

config = require './config'
common = require './common'
db = require './db'
device = require './device'
sandbox = require './sandbox'
cache = require './cache'
extensions = require './extensions'
PathSet = require './path-set'
VersionedMap = require './versioned-map.js'


initDeviceData = () ->
  return {
    paths : new PathSet()
    timestamps : {exist: new VersionedMap(), object: new VersionedMap(), writable: new VersionedMap(), value: new VersionedMap()}
    values : {exist: new VersionedMap(), object: new VersionedMap(), writable: new VersionedMap(), value: new VersionedMap()}
    declarationTimestamps : new Map()
    declarationValues : new Map()
    virtualParameterTimestamps : new Map()
    virtualParameterValues : new Map()
    loaded : new Map()
  }


init = (deviceId, cwmpVersion, timeout) ->
  timestamp = Date.now()

  sessionData = {
    timestamp : timestamp
    deviceId : deviceId
    deviceData : initDeviceData()
    cwmpVersion : cwmpVersion
    timeout : timeout
    provisions: []
    revisions: [0]
    rpcCount: 0
    cycle: 0
    extensionsCache: []
  }

  return sessionData


loadParameters = (sessionData, toLoad, virtualParameters, callback) ->
  if not toLoad.length
    return callback()

  db.fetchDevice(sessionData.deviceId, sessionData.timestamp, toLoad, (err, parameters, loaded) ->
    return callback(err) if err

    if not parameters?
      # Device not available in database, mark as new
      sessionData.new = true
      path = sessionData.deviceData.paths.add([])
      sessionData.deviceData.loaded.set(path, 99)
      return callback()

    for p in loaded
      path = sessionData.deviceData.paths.add(p[0])

      if p[1]
        l = sessionData.deviceData.loaded.get(path) || 0
        sessionData.deviceData.loaded.set(path, Math.max(l, p[1]))

    for p in parameters
      path = sessionData.deviceData.paths.add(p[0])

      for k, v of p[1]
        sessionData.deviceData.timestamps[k].set(path, v, 0)

      for k, v of p[2]
        sessionData.deviceData.values[k].set(path, v, 0)

    # Virtual parameters
    for p in toLoad
      p = sessionData.deviceData.paths.add(p)
      if p[0] == '*' or p[0] == 'VirtualParameters'
        if p.length == 1
          sessionData.deviceData.timestamps.exist.set(p, sessionData.timestamp, 0)
          sessionData.deviceData.timestamps.object.set(p, sessionData.timestamp, 0)
          sessionData.deviceData.timestamps.writable.set(p, sessionData.timestamp, 0)
          sessionData.deviceData.values.exist.set(p, 1, 0)
          sessionData.deviceData.values.object.set(p, 1, 0)
          sessionData.deviceData.values.writable.set(p, 0, 0)
        else if p.length == 2
          if not p[1]?
            sessionData.deviceData.timestamps.exist.set(p, sessionData.timestamp, 0)

            for k, v of virtualParameters
              p = sessionData.deviceData.paths.add(p)
              sessionData.deviceData.timestamps.exist.set(p, sessionData.timestamp, 0)
              sessionData.deviceData.timestamps.object.set(p, sessionData.timestamp, 0)
              sessionData.deviceData.values.exist.set(p, 1, 0)
              sessionData.deviceData.values.object.set(p, 0, 0)
          else if virtualParameters[p[1]]?
            sessionData.deviceData.timestamps.exist.set(p, sessionData.timestamp, 0)
            sessionData.deviceData.timestamps.object.set(p, sessionData.timestamp, 0)
            sessionData.deviceData.values.exist.set(p, 1, 0)
            sessionData.deviceData.values.object.set(p, 0, 0)

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

  toLoad = []
  for p in params
    tl = []
    for i in [p[0].length...0] by -1
      path = p[0].slice(0, i)
      loaded = 0
      iter = sessionData.deviceData.paths.superset(path)
      while sup = iter.next().value
        if (l = sessionData.deviceData.loaded.get(sup)) > loaded
          loaded = l

      if loaded
        tl = tl.slice(0, tl.length - (loaded - 1))
        break

      tl.push(path)

    toLoad = toLoad.concat(tl)

  loadParameters(sessionData, toLoad, null, (err) ->
    return callback(err) if err

    v.revision = 1 for k, v of sessionData.deviceData.timestamps
    v.revision = 1 for k, v of sessionData.deviceData.values

    for p in params
      device.set(sessionData.deviceData, p[0], p[1], p[2])

    return callback(null, {type : 'InformResponse'})
  )


addProvisions = (sessionData, provisions) ->
  sessionData.provisions = sessionData.provisions.concat(provisions)
  if sessionData.revisions.length > 1 or sessionData.revisions[0] > 0
    v.collapse(1) for k, v of sessionData.timestamps
    v.collapse(1) for k, v of sessionData.values
    sessionData.cycle += 1
    sessionData.rpcCount = 0
    sessionData.revisions = [0]
    sessionData.extensionsCache.length = 0


clearProvisions = (sessionData) ->
  sessionData.provisions = []
  if sessionData.revisions.length > 1 or sessionData.revisions[0] > 0
    v.collapse(1) for k, v of sessionData.deviceData.timestamps
    v.collapse(1) for k, v of sessionData.deviceData.values
    sessionData.cycle += 1
    sessionData.rpcCount = 0
    sessionData.revisions = [0]
    sessionData.extensionsCache.length = 0



generateRpcRequest = (sessionData) ->
  if sessionData.deviceData.declarationTimestamps.size == 0 and
      sessionData.deviceData.declarationValues.size == 0
    return null

  refreshPaths = new PathSet()
  refreshAttributes = {
    exist: new Set()
    object: new Set()
    writable: new Set()
    value: new Set()
  }
  setValues = new Map()
  refreshGpn = new Map()

  revision = sessionData.revisions.reduce(((a, b) -> a + (b >> 1)), 0) + 1

  test = (deviceData, path, timestamps, values) ->
    iter = deviceData.paths.superset(path)
    param = null
    existTimestamp = 0
    while sup = iter.next().value
      param = sup if not sup.wildcards
      for k, v of timestamps
        continue if not (t = deviceData.timestamps[k].get(sup, revision))?
        existTimestamp = Math.max(existTimestamp, t) if k is 'exist'
        delete timestamps[k] if t >= v

    if not Object.keys(timestamps).length and
        not (values? and Object.keys(values).length)
      return

    if param?
      if deviceData.values.exist.get(param, revision)
        param = refreshPaths.add(param)
        isObject = deviceData.values.object.get(param, revision)
        isWritable = deviceData.values.writable.get(param, revision)
        for k of timestamps
          if k isnt 'value' or isObject == 0
            refreshAttributes[k].add(param)
          else if not isObject?
            refreshAttributes.object.add(param)

        if values?.value?
          if isObject == 0 and isWritable == 1
            curVal = deviceData.values.value.get(param, revision)
            cur = setValues.get(param)
            if not cur?
              cur = [deviceData.values.value.get(param, revision), values.value]
              setValues.set(param, cur)
            else
              cur[1] = values.value
          else
            if not isObject?
              refreshAttributes.object.add(param)
            if not isWritable?
              refreshAttributes.writable.add(param)
        return
      else if existTimestamp >= (timestamps.exist or 1)
        return
    else if path.indexOf('*') >= 0
      subIter = deviceData.paths.subset(path)
      while sub = subIter.next().value
        continue if not deviceData.values.exist.get(sub, revision)

        isObject = deviceData.values.object.get(sub, revision)
        isWritable = deviceData.values.writable.get(sub, revision)

        for k, v of timestamps
          if not (v <= deviceData.timestamps[k].get(sub, revision))
            if k isnt 'value' or isObject == 0
              sub = refreshPaths.add(sub)
              refreshAttributes[k].add(sub)
            else if not isObject?
              sub = refreshPaths.add(sub)
              refreshAttributes.object.add(sub)

        if values?.value?
          if isObject == 0 and isWritable == 1
            curVal = deviceData.values.value.get(sub, revision)
            cur = setValues.get(sub)
            if not cur?
              cur = [deviceData.values.value.get(sub, revision), values.value]
              setValues.set(sub, cur)
            else
              cur[1] = values.value
          else
            if not isObject?
              refreshAttributes.object.add(sub)
            if not isWritable?
              refreshAttributes.writable.add(sub)

    if existTimestamp >= (timestamps.exist or 1)
      return

    childrenTimestamp = existTimestamp

    for i in [path.length - 1...0] by -1
      existTimestamp = 0
      p = path.slice(0, i)
      iter = deviceData.paths.superset(p)
      param = null
      while sup = iter.next().value
        param = sup if not sup.wildcards
        if (t = deviceData.timestamps.exist.get(sup, revision))?
          existTimestamp = Math.max(existTimestamp, t)

      if param?
        if deviceData.values.exist.get(param, revision)
          isObject = deviceData.values.object.get(param, revision)
          objectTimestamp = deviceData.timestamps.object.get(param, revision)
          if isObject
            if childrenTimestamp == 0
              param = refreshPaths.add(param)
              refreshGpn.set(param, refreshGpn.get(param) | ((1 << path.length - i) - 1))
            else if childrenTimestamp < (timestamps.exist or 1)
              param = refreshPaths.add(param)
              refreshGpn.set(param, refreshGpn.get(param) or 1)
          if not (objectTimestamp >= (timestamps.exist or 1))
            param = refreshPaths.add(param)
            refreshAttributes.object.add(param)
          return
        else if existTimestamp >= (timestamps.exist or 1)
          return
      else if p.indexOf('*') >= 0
        subIter = deviceData.paths.subset(p)
        ret = true
        while sub = subIter.next().value
          continue if not deviceData.values.exist.get(sub, revision)
          # TODO check if not object
          pp = sub.concat(path.slice(sub.length))
          ts = {}
          ts[k] = v for k, v of timestamps
          ret = ret and test(deviceData, pp, ts)

      if existTimestamp >= (timestamps.exist or 1)
        return

      childrenTimestamp = existTimestamp

    p = refreshPaths.add([])
    refreshGpn.set(p, refreshGpn.get(p) or 1)
    return false

  iter = sessionData.deviceData.declarationTimestamps.entries()
  while (pair = iter.next().value)
    timestamps = {}
    timestamps[k] = v for k, v of pair[1]
    test(sessionData.deviceData, pair[0], timestamps, sessionData.deviceData.declarationValues.get(pair[0]))


  iter = refreshAttributes.exist.values()
  while (path = iter.next().value)
    descendantIter = refreshPaths.subset(path, 99)
    found = false
    while (p = descendantIter.next().value)?
      if refreshAttributes.value.has(p) or
          refreshAttributes.object.has(p) or
          refreshAttributes.writable.has(p) or
          refreshGpn.has(p)
        found = true
        break
    if not found
      path = refreshPaths.add(path.slice(0, -1))
      refreshGpn.set(path, refreshGpn.get(path) or 1)


  iter = refreshAttributes.object.values()
  while (path = iter.next().value)
    descendantIter = refreshPaths.subset(path, 99)
    found = false
    while (p = descendantIter.next().value)?
      if refreshAttributes.value.has(p) or
          (p.length > path.length and
          (refreshAttributes.object.has(p) or
          refreshAttributes.writable.has(p)))
        found = true
        break
    if not found
      path = refreshPaths.add(path.slice(0, -1))
      refreshGpn.set(path, refreshGpn.get(path) or 1)

  iter = refreshAttributes.writable.values()
  while (path = iter.next().value)
    path = refreshPaths.add(path.slice(0, -1))
    refreshGpn.set(path, refreshGpn.get(path) or 1)

  iter = refreshGpn.keys()
  while (path = iter.next().value)
    descendantIter = refreshPaths.subset(path, 99)
    found = false
    while (p = descendantIter.next().value)?
      continue if p == path
      if (flags = refreshGpn.get(p))
        flags <<= p.length - path.length
        refreshGpn.set(path, refreshGpn.get(path) | flags)
        refreshGpn.delete(p)

  rpcReq = null
  completed = true

  if refreshGpn.size
    GET_PARAMETER_NAMES_DEPTH_THRESHOLD =
      config.get('GET_PARAMETER_NAMES_DEPTH_THRESHOLD', sessionData.deviceId)

    pair = refreshGpn.entries().next().value

    nextLevel = true
    if pair[0].length >= GET_PARAMETER_NAMES_DEPTH_THRESHOLD
      nextLevel = false
    else if common.hammingWeight(pair[1] >> 3) >= 3
      nextLevel = false

    if refreshGpn.size > 1 or (pair[1] > 1 and nextLevel)
      completed = false

    rpcReq = {
      type: 'GetParameterNames'
      parameterPath: pair[0].join('.')
      nextLevel: nextLevel
    }

  if refreshAttributes.value.size
    if rpcReq?
      completed = false
    else
      TASK_PARAMETERS_BATCH_SIZE =
        config.get('TASK_PARAMETERS_BATCH_SIZE', sessionData.deviceId)

      parameterNames = []
      iter = refreshAttributes.value.values()
      while (path = iter.next().value) and
          parameterNames.length < TASK_PARAMETERS_BATCH_SIZE
        parameterNames.push(path)

      if refreshAttributes.value.size > parameterNames.length
        completed = false

      rpcReq = {
        type: 'GetParameterValues'
        parameterNames: (p.join('.') for p in parameterNames)
      }

  TASK_PARAMETERS_BATCH_SIZE =
    config.get('TASK_PARAMETERS_BATCH_SIZE', sessionData.deviceId)

  parameterValues = []
  setValues.forEach((v, k) ->
    return if completed == false

    if rpcReq?
      completed = false
      return

    val = v[1].slice()
    if not val[1]?
      val[1] = v[0][1]
    device.sanitizeParameterValue(val)
    if val[0] != v[0][0] or val[1] != v[0][1]
      if parameterValues.length >= TASK_PARAMETERS_BATCH_SIZE
        completed = false
        return
      parameterValues.push([k, val[0], val[1]])
  )

  if parameterValues.length and not rpcReq?
    rpcReq = {
      type: 'SetParameterValues'
      parameterList: ([p[0].join('.'), p[1], p[2]] for p in parameterValues)
    }

  if completed
    sessionData.deviceData.declarationTimestamps.clear()
    sessionData.deviceData.declarationValues.clear()

  return rpcReq


getParametersToLoad = (sessionData) ->
  toLoad = []

  test = (timestamps, path) ->
    tl = []
    for i in [path.length...0] by -1
      p = path.slice(0, i)
      loaded = 0
      iter = sessionData.deviceData.paths.superset(p, 1)

      while sup = iter.next().value
        if (l = sessionData.deviceData.loaded.get(sup)) > loaded
          loaded = l

      if loaded
        tl = tl.slice(0, tl.length - (loaded - 1))
        break

      tl.push(p)

    toLoad = toLoad.concat(tl)

  sessionData.deviceData.declarationTimestamps.forEach(test)
  sessionData.deviceData.virtualParameterTimestamps.forEach(test)

  return toLoad


extractVirtualParameterDeclarations = (deviceData, revision, virtualParameters) ->
  if deviceData.virtualParameterTimestamps.size == 0 and
      deviceData.virtualParameterValues.size == 0
    return {}

  iter = deviceData.paths.subset(['VirtualParameters', '*'])
  virtualParameterDeclarations = {}
  while path = iter.next().value
    continue if path.wildcards or not virtualParameters[path[1]]?

    if declarationTimestamps = deviceData.virtualParameterTimestamps.get(path)
      for k, v of declarationTimestamps
        ct = deviceData.timestamps[k].get(path, revision)
        if not (v <= ct)
          virtualParameterDeclarations[path[1]] ?= {timestamps: {}, values: {}}
          virtualParameterDeclarations[path[1]].timestamps[k] =
            Math.max(v, virtualParameterDeclarations[path[1]].timestamps[k] ? 0)

    if declarationValues = deviceData.virtualParameterValues.get(path)
      for k, v of declarationValues
        virtualParameterDeclarations[path[1]] ?= {timestamps: {}, values: {}}
        cv = deviceData.values[k].get(path, revision)
        if not virtualParameterDeclarations[path[1]].values[k]?
          virtualParameterDeclarations[path[1]].values[k] = [cv, v]
        else
          virtualParameterDeclarations[path[1]].values[k][1] = v

  for k, v of virtualParameterDeclarations
    for attrName, attrValue of v.values
      val = attrValue[1].slice()
      val[1] = attrValue[0][1] if not val[1]?
      device.sanitizeParameterValue(val)
      if val[0] != attrValue[0][0] or val[1] != attrValue[0][1]
        v.values[attrName] = attrValue[1]
      else
        delete v.values[attrName]
        if Object.keys(v.values).length == 1
          if Object.keys(v.timestamps).length == 0
            delete virtualParameterDeclarations[k]
          else
            delete v.values[attrName]

  deviceData.virtualParameterTimestamps.clear()
  deviceData.virtualParameterValues.clear()

  return virtualParameterDeclarations


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
  else if declaration.timestmaps.value?
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


rpcRequest = (sessionData, declarations, callback) ->
  if not declarations?.length
    if (rpcReq = generateRpcRequest(sessionData))?
      sessionData.rpcRequest = rpcReq
      return callback(null, generateRpcId(sessionData), rpcReq)

  allDeclarations = declarations?.slice() ? []

  cache.getProvisionsAndVirtualParameters((err, presetsHash, provisions, virtualParameters) ->
    return callback(err) if err or (sessionData.presetsHash? and sessionData.presetsHashpresetsHash)

    done = true
    _extensions = []
    for provision in sessionData.provisions
      if not provisions[provision[0]]?
        switch provision[0]
          when 'refresh'
            path = common.parsePath(provision[1])
            l = path.length
            path.length = 16
            path.fill('*', l)
            t = provision[2]
            t += sessionData.timestamp if t <= 0

            for i in [l...path.length] by 1
              allDeclarations.push([path.slice(0, i), {exist: t, object: 1, writable: 1, value: t}])
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
                path = common.parsePath(provision[3])
                l = path.length
                path.length = 16
                path.fill('*', l)
                for i in [l...16] by 1
                  allDeclarations.push([path.slice(0, i), {exist: sessionData.timestamp, object: 1, writable: 1, value: sessionData.timestamp}])
        continue

      ret = sandbox.run(provisions[provision[0]].script, provision.slice(1), sessionData.timestamp, sessionData.deviceData, sessionData.extensionsCache, 0, sessionData.revisions[0] >> 1)
      if ret.extensions?.length
        _extensions = _extensions.concat(ret.extensions)
      done &&= ret.done
      allDeclarations = allDeclarations.concat(ret.declarations)

    if done and (not allDeclarations?.length or sessionData.revisions[0] > 1)
      return callback()

    if _extensions.length
      runExtensions(sessionData, (sessionData.revisions[0] >> 1), _extensions, (err) ->
        return callback(err) if err
        return rpcRequest(sessionData, declarations, callback)
      )
      return

    doVirtualParameters = (inception, virtualParameterDeclarations, cb) ->
      revision = sessionData.revisions.reduce(((a, b) -> a + (b >> 1)), 0) + 1
      if not virtualParameterDeclarations?
        virtualParameterDeclarations =
          extractVirtualParameterDeclarations(sessionData.deviceData, revision, virtualParameters)
        if not Object.keys(virtualParameterDeclarations).length
          return cb(false)

      sessionData.revisions[inception] ?= 0
      decs = []
      virtualParameterUpdates = {}
      _extensions = []

      firstRevision = revision - (sessionData.revisions[sessionData.revisions.length - 1] >> 1)
      for vpName, vpDeclarations of virtualParameterDeclarations
        ret = sandbox.run(virtualParameters[vpName].script, [vpDeclarations.timestamps, vpDeclarations.values], sessionData.timestamp, sessionData.deviceData, sessionData.extensionsCache, firstRevision, revision)

        if ret.extensions?.length
          _extensions = _extensions.concat(ret.extensions)

        decs = decs.concat(ret.declarations)
        if ret.done
          virtualParameterUpdates[vpName] = ret.returnValue

      if _extensions.length
        runExtensions(sessionData, revision, _extensions, (err) ->
          return callback(err) if err
          return doVirtualParameters(inception, virtualParameterDeclarations, cb)
        )
        return

      if Object.keys(virtualParameterUpdates).length == Object.keys(virtualParameterDeclarations).length
        rev = sessionData.revisions.reduce(((a, b) -> a + (b >> 1)), 0) + 1
        v.revision = rev for k, v of sessionData.deviceData.timestamps
        v.revision = rev for k, v of sessionData.deviceData.values
        for vpName, vpDeclarations of virtualParameterDeclarations
          commitVirtualParameter(sessionData, vpName, vpDeclarations, virtualParameterUpdates[vpName])

        if sessionData.revisions[inception] == 0
          return cb(false)

        sessionData.revisions.length = inception
        rev = sessionData.revisions.reduce(((a, b) -> a + (b >> 1)), 0) + 1
        m.collapse(rev) for k, m of sessionData.deviceData.timestamps
        m.collapse(rev) for k, m of sessionData.deviceData.values
        if sessionData.extensionsCache.length > rev
          sessionData.extensionsCache.length = rev
        return cb(true)

      applyDeclarations(inception, decs, () ->
        return doVirtualParameters(inception, virtualParameterDeclarations, cb)
      )

    applyDeclarations = (inception, decs, cb) ->
      declare = (path, timestamps, values, allTimestamps, allValues) ->
        dt = null
        for k, v of timestamps
          if not dt?
            dt = allTimestamps.get(path)
            if not dt?
              dt = {}
              allTimestamps.set(path, dt)
          v += sessionData.timestamp if v <= 0
          dt[k] = v if v > (dt[k] || 0)

        dv = null
        for k, v of values
          if not dv?
            dv = allValues.get(path)
            if not dv?
              dv = {}
              allValues.set(path, dv)
          dv[k] = v

      if sessionData.revisions[inception] % 2 == 0
        for declaration in decs
          aliasDeclarations = device.getAliasDeclarations(declaration[0], declaration[1][0])
          if aliasDeclarations?
            for d in aliasDeclarations
              path = sessionData.deviceData.paths.add(d[0])
              if path[0] == 'VirtualParameters' or path[0] == '*'
                declare(path, d[1], d[2],
                  sessionData.deviceData.virtualParameterTimestamps,
                  sessionData.deviceData.virtualParameterValues)
                continue if path[0] != '*'

              declare(path, d[1], d[2],
                sessionData.deviceData.declarationTimestmaps,
                sessionData.deviceData.declarationValues)
      else
        for declaration in decs
          unpacked = device.unpack(sessionData.deviceData, declaration[0])

          for path in unpacked
            path = sessionData.deviceData.paths.add(path)
            if path[0] == 'VirtualParameters' or path[0] == '*'
              declare(path, declaration[1], declaration[2],
                sessionData.deviceData.virtualParameterTimestamps,
                sessionData.deviceData.virtualParameterValues)
              continue if path[0] != '*'

            declare(path, declaration[1], declaration[2],
              sessionData.deviceData.declarationTimestamps,
              sessionData.deviceData.declarationValues)

      nextRpc = (applied) ->
        ++ sessionData.revisions[inception]
        if not applied
          if (rpcReq = generateRpcRequest(sessionData))?
            sessionData.rpcRequest = rpcReq
            return callback(null, generateRpcId(sessionData), rpcReq)

        if sessionData.revisions[inception] % 2 == 0
          return cb()
        else
          return applyDeclarations(inception, decs, cb)

      if sessionData.revisions.length > inception + 1
        doVirtualParameters(inception + 1, null, nextRpc)
      else
        loadParameters(sessionData, getParametersToLoad(sessionData), virtualParameters, (err) ->
          return callback(err) if err
          doVirtualParameters(inception + 1, null, nextRpc)
        )

    applyDeclarations(0, allDeclarations, () ->
      return rpcRequest(sessionData, declarations, callback)
    )
  )


rpcResponse = (sessionData, id, rpcRes, callback) ->
  if id != generateRpcId(sessionData)
    return callback(new Error('Request ID not recognized'))

  ++ sessionData.rpcCount

  rpcReq = sessionData.rpcRequest
  sessionData.rpcRequest = null

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

      device.set(sessionData.deviceData, common.parsePath(rpcReq.parameterPath).concat('*'),
        {exist: timestamp})

      for p in rpcRes.parameterList
        if common.endsWith(p[0], '.')
          path = common.parsePath(p[0][0...-1])
          if not rpcReq.nextLevel
            device.set(sessionData.deviceData, path.concat('*'),
              {exist: timestamp})

          device.set(sessionData.deviceData, path,
            {exist: timestamp, object: timestamp, writable: timestamp},
            {exist: 1, object: 1, writable: if p[1] then 1 else 0})
        else
          device.set(sessionData.deviceData, common.parsePath(p[0]),
            {exist: timestamp, object: timestamp, writable: timestamp},
            {exist: 1, object: 0, writable: if p[1] then 1 else 0})

    when 'SetParameterValuesResponse'
      return callback(new Error('Response type does not match request type')) if rpcReq.type isnt 'SetParameterValues'

      for p in rpcReq.parameterList
        device.set(sessionData.deviceData, common.parsePath(p[0]),
          {exist: timestamp, object: timestamp, writable: timestamp, value: timestamp},
          {exist: 1, object: 0, writable: 1, value: p.slice(1)})

    else
      return callback(new Error('Response type not recognized'))

  return callback()


rpcFault = (sessionData, id, faultResponse, callback) ->
  throw new Error('Not implemented')


load = (id, callback) ->
  db.redisClient.get("session_#{id}", (err, sessionDataString) ->
    return callback(err) if err or not sessionDataString?
    sessionData = JSON.parse(sessionDataString)
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

        if r[2 + (keys.length * 2) + i]?
          deviceData.declarationTimestamps.set(path, r[2 + (keys.length * 2) + i])

        if r[2 + (keys.length * 3) + i]?
          deviceData.declarationValues.set(path, r[2 + (keys.length * 3) + i])

    sessionData.deviceData = deviceData

    return callback(null, sessionData)
  )


save = (sessionData, callback) ->
  sessionData.id ?= crypto.randomBytes(8).toString('hex')
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

      if r = sessionData.deviceData.declarationTimestamps.get(path)
        e[2 + (keys.length * 2) + i] = r

      if r = sessionData.deviceData.declarationValues.get(path)
        e[2 + (keys.length * 3) + i] = r

    deviceData.push(e)

  oldDeviceData = sessionData.deviceData.deviceData
  sessionData.deviceData = deviceData
  sessionDataString = JSON.stringify(sessionData)
  sessionData.deviceData = oldDeviceData

  db.redisClient.setex("session_#{sessionData.id}", sessionData.timeout, sessionDataString, (err) ->
     return callback(err, sessionData.id)
  )
  return


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
exports.save = save
exports.load = load
