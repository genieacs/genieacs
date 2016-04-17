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
class Declare;


sandbox = {
  deviceData: null
  args: null
  revision: null
  maxRevision: null
  declarations: null
  context: vm.createContext()
}

sandbox.context.declare = (decs) ->
  if ++ sandbox.revision > sandbox.maxRevision + 1
    throw new Error('Declare function should not be called from within a try/catch block')

  if sandbox.revision == sandbox.maxRevision + 1
    for k, v of decs
      sandbox.declarations.push([common.parsePath(k)].concat(toIndexDeclaration(v)))

    throw new Declare()

  res = {}
  for k, v of decs
    path = common.parsePath(k)
    all = device.getAll(sandbox.deviceData, path, sandbox.revision)
    res[k] = {}
    for a in all
      r = {}
      r.exist = a[1] if v.exist?
      r.type = a.slice(3, 5) if v.type?
      r.writable = a.slice(5, 7) if v.writable?
      r.value = a.slice(7, 9) if v.value? and a[8]?

      p = a[0].join('.')
      if p == k
        res[k] = r
      else
        res[k][p] = r

  return res

Object.freeze(sandbox.context)


# Convert from friendly declaration format
toIndexDeclaration = (keyDeclaraiton) ->
  indexDeclaraiton = []

  if keyDeclaraiton['exist']?
    if Array.isArray(keyDeclaraiton['exist'])
      indexDeclaraiton[0] = keyDeclaraiton['exist'][0]
    else
      indexDeclaraiton[0] = keyDeclaraiton['exist']

  if keyDeclaraiton['type']?
    if Array.isArray(keyDeclaraiton['type'])
      indexDeclaraiton[2] = keyDeclaraiton['type'][0]
    else
      indexDeclaraiton[2] = keyDeclaraiton['type']

  if keyDeclaraiton['writable']?
    if Array.isArray(keyDeclaraiton['writable'])
      indexDeclaraiton[4] = keyDeclaraiton['writable'][0]
    else
      indexDeclaraiton[4] = keyDeclaraiton['writable']

  if keyDeclaraiton['value']?
    if Array.isArray(keyDeclaraiton['value'])
      indexDeclaraiton[6] = keyDeclaraiton['value'][0]
      indexDeclaraiton[7] = keyDeclaraiton['value'][1]
    else
      indexDeclaraiton[6] = keyDeclaraiton['value']

  return indexDeclaraiton


run = (script, args, deviceData, startRevision, maxRevision) ->
  sandbox.deviceData = deviceData
  sandbox.args = args
  sandbox.revision = startRevision
  sandbox.maxRevision = maxRevision
  sandbox.declarations = []

  try
    ret = script.runInNewContext(sandbox.context)
    return {done: true, declarations: sandbox.declarations, returnValue: ret}
  catch err
    throw err if err not instanceof Declare

    return {done: false, declarations: sandbox.declarations}


exports.run = run
