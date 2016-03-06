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
provisions = require './provisions'


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
    presets : {}
    rpcCount : 0
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


inform = (sessionData, rpcRequest, callback) ->
  timestamp = sessionData.timestamp
  device.set(sessionData.deviceData, ['DeviceID', 'Manufacturer'], 1, [timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [rpcRequest.deviceId.Manufacturer, 'xsd:string']])
  device.set(sessionData.deviceData, ['DeviceID', 'OUI'], 1, [timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [rpcRequest.deviceId.OUI, 'xsd:string']])
  device.set(sessionData.deviceData, ['DeviceID', 'ProductClass'], 1, [timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [rpcRequest.deviceId.ProductClass, 'xsd:string']])
  device.set(sessionData.deviceData, ['DeviceID', 'SerialNumber'], 1, [timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [rpcRequest.deviceId.SerialNumber, 'xsd:string']])

  for p in rpcRequest.parameterList
    device.set(sessionData.deviceData, common.parsePath(p[0]), 1, [timestamp, 1, timestamp, 0, null, null, timestamp, p.slice(1)])

  device.set(sessionData.deviceData, ['Events', 'Inform'], 1, [timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [timestamp, 'xsd:dateTime']])

  for e in rpcRequest.event
    device.set(sessionData.deviceData, ['Events', e.replace(' ', '_')], 1, [timestamp, 1, timestamp, 0, timestamp, 0, timestamp, [timestamp, 'xsd:dateTime']])

  return callback(null, {type : 'InformResponse'})


addPreset = (sessionData, name, preset) ->
  sessionData.presets[name] = preset


generateRpcRequest = (sessionData, declarations, callback) ->
  test = (cb) ->
    toLoad = []
    res = device.traverse(sessionData.deviceData, null, null, (path, declaration, base, current, descendantTimestamps, children) ->

      if path[0] == 'Tags'
        if path.length == 2 and path[1]? and declaration[7]?
          if declaration[7][0] != current[7][0]
            device.set(sessionData.deviceData, path, 1, [sessionData.timestamp, 1, null, null, null, null, sessionData.timestamp, declaration[7]])
        return

      r = {}
      gpn = false

      descendantFlags = []
      for i in [0...descendantTimestamps.length] by 1
        if descendantTimestamps[i][2]?
          if not descendantTimestamps[i][4]?
            toLoad.push(descendantTimestamps[i][0])
            continue
          else if descendantTimestamps[i][2] > descendantTimestamps[i][4]
            descendantFlags[i] = 1
            descendantFlags[i] |= 2 if descendantTimestamps[i][0].length > path.length + 1
        else if not descendantTimestamps[i][4]?
          continue

        for j in [0...i] by 1 when descendantTimestamps[j][4]? or descendantFlags[j]
          overlap = common.pathOverlap(descendantTimestamps[j][0], descendantTimestamps[i][0], path.length)

          if overlap & 1 and descendantTimestamps[j][4]?
            if descendantFlags[i] & 2 and descendantTimestamps[j][0].length == path.length + 1
              descendantFlags[i] ^= 2
            if descendantFlags[i] & 1 and descendantTimestamps[j][4] > descendantTimestamps[i][2]
              descendantFlags[i] ^= 1

          if overlap & 2 and descendantTimestamps[i][4]?
            if descendantFlags[j] & 2 and descendantTimestamps[i][0].length == path.length + 1
              descendantFlags[j] ^= 2
            if descendantFlags[j] & 1 and descendantTimestamps[i][4] > descendantTimestamps[j][2]
              descendantFlags[j] ^= 1

      for d, j in descendantFlags
        if d & 1
          gpn = true
        if d & 2
          toLoad.push(path.concat(descendantTimestamps[j][0][path.length] ? null))

      if declaration.length
        if declaration[0]?
          if not current[0]?
            toLoad.push(path)
          else if declaration[0] > current[0]
            r.exist = true

        if declaration[2]?
          if not current[2]?
            toLoad.push(path)
          else if declaration[2] > current[2]
            r.writable = true
            r.exist = false

        if declaration[4]?
          if not current[4]?
            toLoad.push(path)
          else if declaration[4] > current[4]
            r.object = true
            r.exist = false

        if declaration[6]?

          if not current[6]?
            toLoad.push(path) if not current[3]
          else if declaration[6] > current[6]
            if current[7]? or current[3] == 0
              r.gpv ?= []
              r.gpv.push(path)
              r.object = false
              r.exist = false
              gpn = false
            else if not current[3]?
              r.object = true

        if declaration[7]? and current[7]?
          if not current[5]?
            toLoad.push(path)
          else if current[4] == 0
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

    if toLoad.length
      loadParameters(sessionData, toLoad, (err) ->
        return callback(err) if err
        test(cb)
      )
      return

    if res.gpn?
      rpcRequest = {
        type: 'GetParameterNames'
        parameterPath: res.gpn[0].join('.')
        nextLevel: true
      }
      return callback(null, rpcRequest)

    if res.gpv?
      rpcRequest = {
        type: 'GetParameterValues'
        parameterNames: (p.join('.') for p in res.gpv.slice(0, config.get('TASK_PARAMETERS_BATCH_SIZE', sessionData.deviceId)))
      }
      return callback(null, rpcRequest)

    if res.spv?
      rpcRequest = {
        type: 'SetParameterValues'
        parameterList: ([p[0].join('.'), p[1], p[2]] for p in res.spv.slice(0, config.get('TASK_PARAMETERS_BATCH_SIZE', sessionData.deviceId)))
      }
      return callback(null, rpcRequest)

    return cb()

  for declaration in declarations
    pre = device.getPrerequisiteDeclarations(declaration)
    for d in pre
      device.declare(sessionData.deviceData, d[0], d.slice(1), sessionData.timestamp)

  test(() ->
    for declaration in declarations
      params = device.getAll(sessionData.deviceData, declaration[0], null)
      if declaration[0][0] == 'Tags' and declaration[0].length == 2
        if not declaration[0][1]?
          continue if declaration[8][0]
        else if params.length == 0
          device.set(sessionData.deviceData, declaration[0], 1, [sessionData.timestamp, 1, null, null, null, null, sessionData.timestamp, [false, 'xsd:boolean']])
          device.declare(sessionData.deviceData, declaration[0], declaration.slice(1), sessionData.timestamp)
          continue

      for p in params
        device.declare(sessionData.deviceData, p[0], declaration.slice(1), sessionData.timestamp)

    test(() ->
      return callback()
    )
  )


rpcRequest = (sessionData, allDeclarations, callback) ->
  presetNames = Object.keys(sessionData.presets)
  presetNames.sort((a, b) ->
    if sessionData.presets[a].weight == sessionData.presets[b].weight
      return a > b
    else
      return sessionData.presets[a].weight - sessionData.presets[b].weight
  )

  allDeclarations = allDeclarations?.slice() ? []

  counter = 1
  for presetName in presetNames
    do (presetName) ->
      for provision in sessionData.presets[presetName].provisions
        ++ counter
        provisions.processProvision(provision[0], provision[1..], (err, declarations) ->
          if err
            callback(err) if -- counter >= 0
            counter = 0
            return

          allDeclarations = allDeclarations.concat(declarations)

          if -- counter == 0
            generateRpcRequest(sessionData, allDeclarations, (err, rpcRequest) ->
              sessionData.rpcRequest = rpcRequest
              if err or not rpcRequest?
                return callback(err)

              callback(err, sessionData.rpcCount++, rpcRequest)
            )
            return
      )

  if -- counter == 0
    generateRpcRequest(sessionData, allDeclarations, (err, rpcRequest) ->
      sessionData.rpcRequest = rpcRequest
      if err or not rpcRequest?
        return callback(err)

      callback(err, sessionData.rpcCount++, rpcRequest)
    )
    return


rpcResponse = (sessionData, id, rpcResponse, callback) ->
  # TODO verify ID
  rpcRequest = sessionData.rpcRequest
  sessionData.rpcRequest = null

  timestamp = sessionData.timestamp

  switch rpcResponse.type
    when 'GetParameterValuesResponse'
      return callback(new Error('Response type does not match request type')) if rpcRequest.type isnt 'GetParameterValues'

      for p in rpcResponse.parameterList
        device.set(sessionData.deviceData, common.parsePath(p[0]), 1, [timestamp, 1, timestamp, 0, null, null, timestamp, p.slice(1)])

    when 'GetParameterNamesResponse'
      return callback(new Error('Response type does not match request type')) if rpcRequest.type isnt 'GetParameterNames'

      device.set(sessionData.deviceData, common.parsePath(rpcRequest.parameterPath).concat(null), 1, timestamp)

      for p in rpcResponse.parameterList
        if common.endsWith(p[0], '.')
          path = common.parsePath(p[0][0...-1])
          if not rpcRequest.nextLevel
            device.set(sessionData.deviceData, path.conact(null), 1, timestamp)

          device.set(sessionData.deviceData, path, 1, [timestamp, 1, timestamp, 1, timestamp, if p[1] then 1 else 0])
        else
          device.set(sessionData.deviceData, common.parsePath(p[0]), 1, [timestamp, 1, timestamp, 0, timestamp, if p[1] then 1 else 0])

    when 'SetParameterValuesResponse'
      return callback(new Error('Response type does not match request type')) if rpcRequest.type isnt 'SetParameterValues'

      for p in rpcRequest.parameterList
        device.set(sessionData.deviceData, common.parsePath(p[0]), 1, [timestamp, 1, timestamp, 0, timestamp, 1, timestamp, p.slice(1)])

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
exports.addPreset = addPreset
exports.rpcRequest = rpcRequest
exports.rpcResponse = rpcResponse
exports.rpcFault = rpcFault
exports.end = end
exports.save = save
exports.load = load
