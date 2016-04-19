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


init = (deviceId, cwmpVersion, timeout) ->
  timestamp = Date.now()
  deviceData = device.init()
  device.set(deviceData, [], 0, [timestamp, 1, timestamp, 1, timestamp, 0, timestamp, null])

  sessionData = {
    timestamp : timestamp
    deviceId : deviceId
    deviceData : deviceData
    cwmpVersion : cwmpVersion
    timeout : timeout
    provisions: []
    revisions: [0]
    rpcCount: 0
    cycle: 0
    extensionsCache: []
  }

  return sessionData


loadParameters = (sessionData, toLoad, callback) ->
  # TODO optimize by removing overlaps
  for p, i in toLoad
    device.set(sessionData.deviceData, p, 0, [0, null, 0, null, 0, null, 0, null])

  if sessionData.new
    return callback()

  db.fetchDevice(sessionData.deviceId, sessionData.timestamp, toLoad, (err, parameters) ->
    return callback(err) if err

    if not parameters?
      # Device not available in database, mark as new
      sessionData.new = true
      return callback()

    for p in parameters
      device.set(sessionData.deviceData, p[0], 0, p.slice(1))

    return callback()
  )


generateRpcId = (sessionData) ->
  if sessionData.rpcCount > 255 or sessionData.cycle > 15 or sessionData.revisions.length > 15
    throw new Error('Too many RPCs')

  return sessionData.timestamp.toString(16) + "0#{sessionData.rpcCount.toString(16)}".slice(-2)


inform = (sessionData, rpcReq, callback) ->
  timestamp = sessionData.timestamp
  device.set(sessionData.deviceData, ['DeviceID', 'Manufacturer'], 1, [timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [rpcReq.deviceId.Manufacturer, 'xsd:string']])
  device.set(sessionData.deviceData, ['DeviceID', 'OUI'], 1, [timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [rpcReq.deviceId.OUI, 'xsd:string']])
  device.set(sessionData.deviceData, ['DeviceID', 'ProductClass'], 1, [timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [rpcReq.deviceId.ProductClass, 'xsd:string']])
  device.set(sessionData.deviceData, ['DeviceID', 'SerialNumber'], 1, [timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [rpcReq.deviceId.SerialNumber, 'xsd:string']])

  for p in rpcReq.parameterList
    device.set(sessionData.deviceData, common.parsePath(p[0]), 1, [timestamp, 1, timestamp, 0, null, null, timestamp, p.slice(1)])

  device.set(sessionData.deviceData, ['Events', 'Inform'], 1, [timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [timestamp, 'xsd:dateTime']])

  for e in rpcReq.event
    device.set(sessionData.deviceData, ['Events', e.replace(' ', '_')], 1, [timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [timestamp, 'xsd:dateTime']])

  return callback(null, {type : 'InformResponse'})


addProvisions = (sessionData, provisions) ->
  sessionData.provisions = sessionData.provisions.concat(provisions)
  if sessionData.revisions.length > 1 or sessionData.revisions[0] > 0
    sessionData.cycle += 1
    sessionData.rpcCount = 0
    sessionData.revisions = [0]
    device.collapse(sessionData.deviceData, 1)
    sessionData.extensionsCache.length = 0


clearProvisions = (sessionData) ->
  sessionData.provisions = []
  if sessionData.revisions.length > 1 or sessionData.revisions[0] > 0
    sessionData.cycle += 1
    sessionData.rpcCount = 0
    sessionData.revisions = [0]
    device.collapse(sessionData.deviceData, 1)
    sessionData.extensionsCache.length = 0


generateRpcRequest = (sessionData) ->
  res = device.traverse(sessionData.deviceData, null, null, (path, declaration, base, current, descendantTimestamps, children) ->
    if path[0] == 'Tags'
      if path.length == 2 and path[1]? and declaration[7]?
        if declaration[7][0] != current[7][0]
          device.set(sessionData.deviceData, path, 1, [sessionData.timestamp, 1, null, null, null, null, sessionData.timestamp, declaration[7]])
      return

    r = {}
    gpn = false

    descendantRefresh = []
    for i in [0...descendantTimestamps.length] by 1 when descendantTimestamps[i][4]? or descendantTimestamps[i][2]?
      if descendantTimestamps[i][2] > descendantTimestamps[i][4]
        if current[3] == 1
          descendantRefresh[i] = true
        else
          r.object = true if current[2] < descendantTimestamps[i][2]

      for j in [0...i] by 1 when descendantTimestamps[j][4]? or descendantRefresh[j]
        overlap = common.pathOverlap(descendantTimestamps[j][0], descendantTimestamps[i][0], path.length)

        if overlap & 1 and descendantTimestamps[j][4]?
          if descendantRefresh[i] and descendantTimestamps[j][4] > descendantTimestamps[i][2]
            descendantRefresh[i] = false

        if overlap & 2 and descendantTimestamps[i][4]?
          if descendantRefresh[j] and descendantTimestamps[i][4] > descendantTimestamps[j][2]
            descendantRefresh[j] = false

    for d in descendantRefresh when d
      gpn = true
      break

    if declaration.length
      if declaration[0] > current[0]
        r.exist = true

      if declaration[2] > current[2]
        r.object = true
        r.exist = false

      if declaration[4] > current[4]
        r.writable = true
        r.exist = false

      if declaration[6] > current[6]
        if current[7]? or current[3] == 0
          r.gpv ?= []
          r.gpv.push(path)
          r.object = false
          r.exist = false
          gpn = false
        else if not current[2] > 0
          r.object = true

      if declaration[7]? and current[7]?
        if current[4] == 0
          r.writable = true
        else if current[5]
          if declaration[7][0] != current[7][0] or declaration[7][1] != current[7][1]
            r.spv = [[path, declaration[7][0], declaration[7][1]]]
            r.exist = false
            gpn = false

    for k, v of children
      if v.writable or v.object or v.exist
        gpn = true

      if v.gpn
        r.gpn = (r.gpn ? []).concat(v.gpn)
        r.exist = false

      if v.gpv
        r.gpv = (r.gpv ? []).concat(v.gpv)
        r.exist = false

      if v.spv
        r.spv = (r.spv ? []).concat(v.spv)
        r.exist = false

    if gpn
      r.exist = false
      if r.gpn?
        r.gpn = [path].concat(r.gpn)
      else
        r.gpn = [path]

    return r
  )

  if res.gpn?
    rpcReq = {
      type: 'GetParameterNames'
      parameterPath: res.gpn[0].join('.')
      nextLevel: true
    }
    return rpcReq

  if res.gpv?
    rpcReq = {
      type: 'GetParameterValues'
      parameterNames: (p.join('.') for p in res.gpv.slice(0, config.get('TASK_PARAMETERS_BATCH_SIZE', sessionData.deviceId)))
    }
    return rpcReq

  if res.spv?
    rpcReq = {
      type: 'SetParameterValues'
      parameterList: ([p[0].join('.'), p[1], p[2]] for p in res.spv.slice(0, config.get('TASK_PARAMETERS_BATCH_SIZE', sessionData.deviceId)))
    }
    return rpcReq

  return null


loadDeclarations = (sessionData, virtualParameters, callback) ->
  toLoad = []
  device.traverse(sessionData.deviceData, null, null, (path, declaration, base, current, descendantTimestamps, children) ->
    descendantLoad = []
    for i in [0...descendantTimestamps.length] by 1
      if descendantTimestamps[i][2]?
        if not descendantTimestamps[i][4]?
          toLoad.push(descendantTimestamps[i][0])
          continue
        else if descendantTimestamps[i][2] > descendantTimestamps[i][4]
          descendantLoad[i] = true if descendantTimestamps[i][0].length > path.length + 1
      else if not descendantTimestamps[i][4]?
        continue

      for j in [0...i] by 1 when descendantTimestamps[j][4]? or descendantFlags[j]
        overlap = common.pathOverlap(descendantTimestamps[j][0], descendantTimestamps[i][0], path.length)

        if overlap & 1 and descendantTimestamps[j][4]?
          if descendantLoad[i] and descendantTimestamps[j][0].length == path.length + 1
            descendantLoad[i] = false

        if overlap & 2 and descendantTimestamps[i][4]?
          if descendantLoad[j] and descendantTimestamps[i][0].length == path.length + 1
            descendantLoad[j] = false

      for d, j in descendantLoad when d
        toLoad.push(path.concat(descendantTimestamps[j][0][path.length] ? null))

    if declaration[7]? and not current[4]?
      # Need writable attribute when declaring a value
      toLoad.push(path)
      return

    for i in [0...declaration.length] by 2
      if declaration[i]? and not current[i]?
        toLoad.push(path)
        break
  )

  # Virtual parameters
  for p in toLoad
    if not p[0]? or p[0] == 'VirtualParameters'
      if p.length == 1
        device.set(sessionData.deviceData, ['VirtualParameters'], 1, [sessionData.timestamp, 1, sessionData.timestamp, 1, sessionData.timestamp, 0])
      else if p.length == 2
        if not p[1]?
          for k, v of virtualParameters
            device.set(sessionData.deviceData, ['VirtualParameters', k], 1, [sessionData.timestamp, 1, sessionData.timestamp, 0])
        else if virtualParameters[p[1]]?
          device.set(sessionData.deviceData, ['VirtualParameters', p[1]], 1, [sessionData.timestamp, 1, sessionData.timestamp, 0])

  return loadParameters(sessionData, toLoad, callback)


extractVirtualParameterDeclarations = (sessionData) ->
  virtualParameterDeclarations = []
  res = device.traverse(sessionData.deviceData, ['VirtualParameters', null], null, (path, declaration, base, current, descendantTimestamps, children) ->
    if path.length == 2 and declaration?.length
      d = [path]
      for i in [0...declaration.length] by 2
        if declaration[i]? and not (declaration[i] <= current[i])
          d[i + 1] = declaration[i]
        if declaration[i + 1]?
          if i != 6 or not current[i + 1]?
            d[i + 2] = declaration[i + 1]
          else if declaration[i + 1][0] != current[i + 1][0] and
              (declaration[i + 1][0] != current[i + 1][0] or not declaration[i + 1][1]?)
            d[i + 2] = declaration[i + 1]
      if d.length > 1
        virtualParameterDeclarations.push(d)
  )

  device.clearDeclarations(sessionData.deviceData, ['VirtualParameters'])
  return virtualParameterDeclarations


commitVirtualParameter = (sessionData, parameterDeclaration, revision, update) ->
  v = []
  if update.writable?
    if update.writable[0] <= 0
      v[4] = now + update.writable[0]
    else
      v[4] = Math.min(sessionData.timestamp, update.writable[0])

    if parameterDeclaration[5]?
      v[4] = Math.max(parameterDeclaration[5], v[4])

    v[5] = Boolean(JSON.parse(update.writable[1]))
  else if parameterDeclaration[5]? or parameterDeclaration[6]?
    throw new Error('Virtual parameter must provide declared attributes')

  if update.value?
    if update.value[0] <= 0
      v[6] = sessionData.timestamp + update.value[0]
    else
      v[6] = Math.min(now, update.value[0])

    if parameterDeclaration[7]?
      v[6] = Math.max(parameterDeclaration[7], v[6])

    v[7] = device.sanitizeParameterValue(update.value[1])
  else if parameterDeclaration[7]? or parameterDeclaration[8]?
    throw new Error('Virtual parameter must provide declared attributes')

  device.set(sessionData.deviceData, parameterDeclaration[0], revision, v)


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
  allDeclarations = declarations?.slice() ? []

  cache.getProvisionsAndVirtualParameters((err, presetsHash, provisions, virtualParameters) ->
    return callback(err) if err or presetsHash != sessionData.presetsHash

    done = true
    _extensions = []
    for provision in sessionData.provisions
      if not provisions[provision[0]]?
        switch provision[0]
          when 'refresh'
            path = common.parsePath(provision[1])
            for i in [path.length...16] by 1
              path.length = i
              allDeclarations.push([path.slice(), provision[2], null, 1, null, 1, null, provision[2]])
          when 'value'
            allDeclarations.push([common.parsePath(provision[1]), 1, null, null, null, null, null, 1, [provision[2]]])
          when 'tag'
            allDeclarations.push([[['Tags', provision[1]], null, null, null, null, null, null, null, [provision[2], 'xsd:boolean']]])
        continue

      ret = sandbox.run(provisions[provision[0]].script, provision.slice(1), sessionData.deviceData, sessionData.extensionsCache, 0, sessionData.revisions[0] >> 1)
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

    doVirtualParameters = (iter, virtualParameterDeclarations, cb) ->
      if not virtualParameterDeclarations?
        virtualParameterDeclarations = extractVirtualParameterDeclarations(sessionData)
        if not virtualParameterDeclarations?.length
          return cb(false)

      sessionData.revisions[iter] ?= 0
      decs = []
      virtualParameterUpdates = []
      _extensions = []
      lastRevision = sessionData.revisions.reduce((a, b) -> (a >> 1) + (b >> 1))
      firstRevision = lastRevision - (sessionData.revisions[sessionData.revisions.length - 1] >> 1)
      for vpd, i in virtualParameterDeclarations
        vpName = vpd[0][1]
        continue if not virtualParameters[vpName]?
        ret = sandbox.run(virtualParameters[vpName].script, [vpd.slice(1)], sessionData.deviceData, sessionData.extensionsCache, firstRevision, lastRevision)
        if ret.extensions?.length
          _extensions = _extensions.concat(ret.extensions)

        decs = decs.concat(ret.declarations)
        if ret.done
          virtualParameterUpdates.push(ret.returnValue)

      if _extensions.length
        runExtensions(sessionData, lastRevision, _extensions, (err) ->
          return callback(err) if err
          return doVirtualParameters(iter, virtualParameterDeclarations, cb)
        )
        return

      if virtualParameterUpdates.length == virtualParameterDeclarations.length
        rev = sessionData.revisions.reduce((a, b) -> (a >> 1) + (b >> 1))
        for vpd, i in virtualParameterDeclarations
          commitVirtualParameter(sessionData, vpd, rev + 1, virtualParameterUpdates[i])

        if sessionData.revisions[iter] == 0
          return cb(false)

        sessionData.revisions.length = iter
        rev = sessionData.revisions.reduce((a, b) -> (a >> 1) + (b >> 1))
        device.collapse(sessionData.deviceData, rev + 1)
        if sessionData.extensionsCache.length > rev + 1
          sessionData.extensionsCache.length = rev + 1
        return cb(true)

      applyDeclarations(iter, decs, () ->
        return doVirtualParameters(iter, virtualParameterDeclarations, cb)
      )

    applyDeclarations = (iter, decs, cb) ->
      if sessionData.revisions[iter] % 2 == 0
        for declaration in decs
          for d in device.getPrerequisiteDeclarations(declaration)
            device.declare(sessionData.deviceData, d[0], d.slice(1), sessionData.timestamp)
      else
        for declaration in decs
          params = device.getAll(sessionData.deviceData, declaration[0], (sessionData.revisions[iter] >> 1) + 1)
          # TODO move setting tags elsewhere
          if declaration[0][0] == 'Tags' and declaration[0].length == 2
            if not declaration[0][1]?
              continue if declaration[8][0]
            else if params.length == 0
              device.set(sessionData.deviceData, declaration[0], 1, [sessionData.timestamp, 1, null, null, null, null, sessionData.timestamp, [false, 'xsd:boolean']])
              device.declare(sessionData.deviceData, declaration[0], declaration.slice(1), sessionData.timestamp)
              continue
          for p in params
            device.declare(sessionData.deviceData, p[0], declaration.slice(1), sessionData.timestamp)

      nextRpc = (applied) ->
        if not applied
          if (rpcReq = generateRpcRequest(sessionData))?
            sessionData.rpcRequest = rpcReq
            return callback(null, generateRpcId(sessionData), rpcReq)

        if ++ sessionData.revisions[iter] % 2 == 0
          return cb()
        else
          return applyDeclarations(iter, decs, cb)

      if sessionData.revisions.length > iter + 1
        doVirtualParameters(iter + 1, null, nextRpc)
      else
        loadDeclarations(sessionData, virtualParameters, (err) ->
          return callback(err) if err
          doVirtualParameters(iter + 1, null, nextRpc)
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
  revision = sessionData.revisions.reduce((a, b) -> (a >> 1) + (b >> 1)) + 1

  switch rpcRes.type
    when 'GetParameterValuesResponse'
      return callback(new Error('Response type does not match request type')) if rpcReq.type isnt 'GetParameterValues'

      for p in rpcRes.parameterList
        device.set(sessionData.deviceData, common.parsePath(p[0]), revision, [timestamp, 1, timestamp, 0, null, null, timestamp, p.slice(1)])

    when 'GetParameterNamesResponse'
      return callback(new Error('Response type does not match request type')) if rpcReq.type isnt 'GetParameterNames'

      device.set(sessionData.deviceData, common.parsePath(rpcReq.parameterPath).concat(null), revision, timestamp)

      for p in rpcRes.parameterList
        if common.endsWith(p[0], '.')
          path = common.parsePath(p[0][0...-1])
          if not rpcReq.nextLevel
            device.set(sessionData.deviceData, path.conact(null), revision, timestamp)

          device.set(sessionData.deviceData, path, revision, [timestamp, 1, timestamp, 1, timestamp, if p[1] then 1 else 0])
        else
          device.set(sessionData.deviceData, common.parsePath(p[0]), revision, [timestamp, 1, timestamp, 0, timestamp, if p[1] then 1 else 0])

    when 'SetParameterValuesResponse'
      return callback(new Error('Response type does not match request type')) if rpcReq.type isnt 'SetParameterValues'

      for p in rpcReq.parameterList
        device.set(sessionData.deviceData, common.parsePath(p[0]), revision, [timestamp, 1, timestamp, 0, timestamp, 1, timestamp, p.slice(1)])

    else
      return callback(new Error('Response type not recognized'))

  return callback()


rpcFault = (sessionData, id, faultResponse, callback) ->
  throw new Error('Not implemented')


load = (id, callback) ->
  db.redisClient.get("session_#{id}", (err, sessionData) ->
    return callback(err) if err
    return callback(null, JSON.parse(sessionData))
  )


save = (sessionData, callback) ->
  sessionData.id ?= crypto.randomBytes(8).toString('hex')

  db.redisClient.setex("session_#{sessionData.id}", sessionData.timeout, JSON.stringify(sessionData), (err) ->
     return callback(err, sessionData.id)
  )
  return


end = (sessionData, callback) ->
  getDiff = (cb) ->
    diff = []
    toLoad = []
    res = device.traverse(sessionData.deviceData, null, null, (path, declaration, base, current, descendantTimestamps, children) ->
      for dt in descendantTimestamps
        if dt[1] >= path.length and dt[3] != dt[4]
          toLoad.push(dt[0]) if not dt[3]?
          diff.push([dt[0], dt[1], dt[3], dt[4]])

      for i in [0...current.length] by 2
        if current[i] != base[i] or current[i + 1] != base[i + 1]
          if not base[i]?
            toLoad.push(path)
            break
          else
            diff.push([path, path.length, base, current])
            break
    )

    if toLoad.length
      loadParameters(sessionData, toLoad, (err) ->
        return callback(err) if err
        getDiff(cb)
      )
      return

    return cb(diff)

  getDiff((diff) ->
    db.saveDevice(sessionData.deviceId, diff, sessionData.new, (err) ->
      return callback(err) if err
      db.redisClient.del("session_#{sessionData.id}", (err) ->
        callback(err, sessionData.new)
      )
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
