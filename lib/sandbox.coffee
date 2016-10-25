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

vm = require 'vm'

common = require './common'
device = require './device'


# Used for throwing to exit user script
class Exit;


sandbox = {
  timestamp: null
  deviceData: null
  revision: null
  maxRevision: null
  declarations: null
  extensionsCache: null
  extensions: null
  context: vm.createContext()
}

Object.defineProperty(sandbox.context, 'Date', {value: class
  constructor: (arg) ->
    if arguments.length
      return new (Function.prototype.bind.apply(Date, arguments))

    return new Date(sandbox.timestamp)

  @now: () ->
    return sandbox.timestamp
})


Object.defineProperty(sandbox.context, 'ext', {value: () ->
  if sandbox.extensions?.length
    throw new Error('Ext function should not be called from within a try/catch block')

  extCall = (String(a) for a in arguments)
  key = JSON.stringify(extCall)
  if not sandbox.extensionsCache[sandbox.revision]? or key not of sandbox.extensionsCache[sandbox.revision]
    sandbox.extensions = [extCall]
    throw new Exit()

  return sandbox.extensionsCache[sandbox.revision][key]
})


Object.defineProperty(sandbox.context, 'declare', {value: (decs) ->
  if ++ sandbox.revision > sandbox.maxRevision + 1
    throw new Error('Declare function should not be called from within a try/catch block')

  if sandbox.revision == sandbox.maxRevision + 1
    for k, v of decs
      timestamp = 1
      exist = null
      attributeTimestamps = {}
      attributeValues = {}
      for attrName, dec of v
        if attrName is 'exist'
          if Array.isArray(dec)
            timestamp = dec[0]
            exist = dec[1] if 1 of dec
          else
            timestamp = dec
          continue

        if Array.isArray(dec)
          attributeTimestamps[attrName] = dec[0]
          attributeValues[attrName] = dec[1] if 1 of dec
        else
          attributeTimestamps[attrName] = dec

      sandbox.declarations.push([common.parsePath(k), timestamp, attributeTimestamps, exist, attributeValues])

    throw new Exit()

  res = {}
  for k, v of decs
    path = common.parsePath(k)
    single = true
    for p in path
      if p == '*' or common.typeOf(p) isnt common.STRING_TYPE
        single = false
        break

    unpacked = device.unpack(sandbox.deviceData, path, sandbox.revision)
    for param in unpacked
      r = {}
      attrs = sandbox.deviceData.attributes.get(param, sandbox.revision)
      for attrName, dec of v
        if attrName of attrs
          r[attrName] = attrs[attrName]

      if single
        res[k] = r
      else
        res[k] ?= {}
        res[k][param.join('.')] = r

  return res
})


Object.defineProperty(sandbox.context, 'clear', {value: (pattern, timestamp) ->
  if sandbox.revision == sandbox.maxRevision
    sandbox.clear ?= []
    sandbox.clear.push([common.parsePath(pattern), timestamp])
  return
})


run = (script, globals, timestamp, deviceData, extensionsCache, startRevision, maxRevision) ->
  sandbox.timestamp = timestamp
  sandbox.deviceData = deviceData
  sandbox.extensionsCache = extensionsCache
  sandbox.revision = startRevision
  sandbox.maxRevision = maxRevision
  sandbox.declarations = []
  sandbox.extensions = null
  sandbox.clear = null

  for k, v of globals
    sandbox.context[k] = v

  try
    ret = script.runInNewContext(sandbox.context, {displayErrors: false})
    delete sandbox.context[k] for k of sandbox.context
    return {done: true, declarations: sandbox.declarations, extensions: sandbox.extensions, clear: sandbox.clear, returnValue: ret}
  catch err
    delete sandbox.context[k] for k of sandbox.context
    throw err if err not instanceof Exit
    return {done: false, declarations: sandbox.declarations, extensions: sandbox.extensions, clear: sandbox.clear}


exports.run = run
