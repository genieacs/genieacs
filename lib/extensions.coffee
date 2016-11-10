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

childProcess = require 'child_process'
crypto = require 'crypto'
path = require 'path'

config = require './config'


TIMEOUT = 5000

processes = {}
queue = {}

messageHandler = (message) ->
  func = queue[message[0]]
  delete queue[message[0]]
  func(message[1], message[2])


run = (args, callback) ->
  scriptName = args[0]
  if not processes[scriptName]?
    cwd = path.resolve(config.get('CONFIG_DIR'), 'ext')
    p = childProcess.fork('lib/extension-wrapper', [cwd, scriptName])
    p.on('message', messageHandler)
    processes[scriptName] = p

  id = crypto.randomBytes(8).toString('hex')
  queue[id] = callback
  setTimeout(() ->
    if id of queue
      delete queue[id]
      return callback(new Error('Extension timeout'))
  , TIMEOUT)

  processes[scriptName].send([id, args.slice(1)])


exports.run = run
