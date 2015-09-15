###
# Copyright 2013, 2014, 2015  Zaid Abdulla
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

db = require '../lib/db'
fs = require 'fs'

deviceJson = {}

f = (object, path) ->
  if (not path)
    path = ''

  for key in Object.keys(object)
    continue if key[0] == '_'

    if (object[key])
      isObject = '_object' of object[key] or '_instance' of object[key]
      isValue = '_value' of object[key]
      if (isObject and isValue) or (not isObject and not isValue)
        throw new Error('Unexpected object')

      if (isValue)
        value = object[key]['_value']
        if (typeof value == 'boolean')
          if (value)
            value  = 1
          else
            value = 0

        values = [object[key]['_writable'] or false, value.toString()]
        values.push(object[key]['_type']) if (object[key]['_type'])
        deviceJson["#{path}#{key}"] = values
        continue

      if (isObject)
        values = [object[key]['_writable'] or false]
        deviceJson["#{path}#{key}."] = values
        f(object[key], "#{path}#{key}.")


db.connect((err) ->
  throw err if (err)

  db.devicesCollection.findOne({_id: process.argv[2]}, {}, (err, device) ->
    throw err if (err)

    if (not device)
      throw new Error('Device not found')

    f(device)
    fs.writeFile("data_model_#{process.argv[2]}.json", JSON.stringify(deviceJson, null, '  '), () ->
      throw err if (err)

      console.log("data_model_#{process.argv[2]}.json Saved")
      process.exit(0)
    )
  )
)
