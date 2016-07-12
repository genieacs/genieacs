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
  args: null
  revision: null
  maxRevision: null
  declarations: null
  extensionsCache: null
  extensions: null
  context: vm.createContext()
}

sandbox.context.Date = class
  constructor: (arg) ->
    if arguments.length
      return new (Function.prototype.bind.apply(Date, arguments))

    return new Date(sandbox.timestamp)

  @now: () ->
    return sandbox.timestamp


sandbox.context.ext = () ->
  if sandbox.extensions?.length
    throw new Error('Ext function should not be called from within a try/catch block')

  extCall = (String(a) for a in arguments)
  key = JSON.stringify(extCall)
  if not sandbox.extensionsCache[sandbox.revision]?[key]?
    sandbox.extensions = [extCall]
    throw new Exit()

  return sandbox.extensionsCache[sandbox.revision][key]


sandbox.context.declare = (decs) ->
  if ++ sandbox.revision > sandbox.maxRevision + 1
    throw new Error('Declare function should not be called from within a try/catch block')

  if sandbox.revision == sandbox.maxRevision + 1
    for k, v of decs
      decT = {}
      decV = {}
      for attrName, dec of v
        if Array.isArray(dec)
          decT[attrName] = dec[0]
          decV[attrName] = dec[1] if 1 of dec
        else
          decT[attrName] = dec

      sandbox.declarations.push([common.parsePath(k), decT, decV])

    throw new Exit()

  res = {}
  for k, v of decs
    path = common.parsePath(k)

    res[k] = {}
    unpacked = device.unpack(sandbox.deviceData, path, sandbox.revision)
    for path in unpacked
      iter = sandbox.deviceData.paths.subset(path)
      while (param = iter.next().value)?
        if param.wildcards == 0 and sandbox.deviceData.values.exist.get(param, sandbox.revision)
          r = {}
          for attrName, dec of v
            if (attrValue = sandbox.deviceData.values[attrName].get(param, sandbox.revision))?
              r[attrName] = [sandbox.deviceData.timestamps[attrName].get(param, sandbox.revision), attrValue]

          p = param.join('.')
          if p == k
            res[k] = r
          else
            res[k][p] = r

  return res

Object.freeze(sandbox.context)


run = (script, args, timestamp, deviceData, extensionsCache, startRevision, maxRevision) ->
  sandbox.timestamp = timestamp
  sandbox.deviceData = deviceData
  sandbox.extensionsCache = extensionsCache
  sandbox.args = args
  sandbox.revision = startRevision
  sandbox.maxRevision = maxRevision
  sandbox.declarations = []
  sandbox.extensions = null

  try
    ret = script.runInNewContext(sandbox.context, {displayErrors: false})
    return {done: true, declarations: sandbox.declarations, returnValue: ret}
  catch err
    throw err if err not instanceof Exit

    return {done: false, declarations: sandbox.declarations, extensions: sandbox.extensions}


exports.run = run
