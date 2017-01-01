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

util = require 'util'
cluster = require 'cluster'
config = require './config'
db = require './db'
extensions = require './extensions'


service = config.argv[0]
if not service?
  throw new Error('Missing argument cwmp, fs, or nbi')

networkInterface = config.get("#{service.toUpperCase()}_INTERFACE")
port = config.get("#{service.toUpperCase()}_PORT")
useHttps = config.get("#{service.toUpperCase()}_SSL")

listener = require("./#{service}").listener
onConnection = require("./#{service}").onConnection

server = null

exit = () ->
  setTimeout(() ->
    process.exit(1)
  , 30000).unref()

  cluster.worker?.disconnect()
  server.close(() ->
    db.disconnect()
    extensions.killAll()
  )


process.on('uncaughtException', (err) ->
  try
    util.error("#{new Date().toISOString()} - #{err.stack}\n")
    exit()
  catch err
    util.error("#{new Date().toISOString()} - #{err2.stack}\n")
  throw err
)


if useHttps
  path = require 'path'
  fs = require 'fs'
  httpsKey = path.resolve(config.get('CONFIG_DIR'), "#{service}.key")
  httpsCert = path.resolve(config.get('CONFIG_DIR'), "#{service}.crt")
  httpsCa = path.resolve(config.get('CONFIG_DIR'), "#{service}.cabundle.crt")

  read = require('fs').readFileSync
  chainLines = fs.readFileSync(httpsCa, 'utf8').split('\n')
  cert = []
  ca = []
  chainLines.forEach (line) ->
    cert.push line
    if line.match(/-END CERTIFICATE-/)
      ca.push cert.join('\n')
      cert = []
    return

  options = {
    key: fs.readFileSync(httpsKey),
    cert: fs.readFileSync(httpsCert)
    ca: ca
  }
  server = require('https').createServer(options, listener)
else
  server = require('http').createServer(listener)

if onConnection?
  server.on('connection', onConnection)

db.connect((err) ->
  throw err if err
  server.listen(port, networkInterface)
)


process.on('SIGINT', exit)
process.on('SIGTERM', exit)
