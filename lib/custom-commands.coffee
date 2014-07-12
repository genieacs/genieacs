###
# Copyright 2013, 2014  Zaid Abdulla
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


exports.execute = (deviceId, command, callback) ->
  args = command.split(/\s+/)
  f = args.shift()
  c = args.shift()

  file = require "../config/custom_commands/#{f}"
  file[c](deviceId, args.join(' '), callback)


exports.getFileCommands = (filename) ->
  commands = []
  f = require("../config/custom_commands/#{filename}")
  for k,v of f
    commands.push(k)
  return commands


exports.getDeviceCustomCommands = (deviceId) ->
  commands = {}
  for k,v of config.CUSTOM_COMMANDS
    if eval(v).test(deviceId)
      commands[k] = exports.getFileCommands(k)
  return commands


exports.getDeviceCustomCommandNames = (deviceId) ->
  commands = []
  for k,v of config.CUSTOM_COMMANDS
    if eval(v).test(deviceId)
      commands.push(k)
  return commands
