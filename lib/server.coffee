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

domain = require 'domain'
util = require 'util'
cluster = require 'cluster'
config = require './config'
db = require './db'

service = config.argv[0]
if not service?
  throw new Error('Missing argument cwmp, fs, or nbi')

networkInterface = config.get("#{service.toUpperCase()}_INTERFACE")
port = config.get("#{service.toUpperCase()}_PORT")
useHttps = config.get("#{service.toUpperCase()}_SSL")

serviceListener = require("./#{service}").listener

server = null

listener = (httpRequest, httpResponse) ->
  d = domain.create()

  d.on('error', (err) ->
    util.error("#{new Date().toISOString()} - #{err.stack}\n")
    try
      killTimer = setTimeout(() ->
        process.exit(1)
      , 30000)

      killTimer.unref()

      cluster.worker?.disconnect()
      server.close(() ->
        db.disconnect()
      )

      httpResponse.writeHead(500, {'Connection' : 'close'})
      httpResponse.end()
    catch err2
      util.error("#{new Date().toISOString()} - #{err2.stack}\n")
  )

  d.add(httpRequest)
  d.add(httpResponse)

  d.run(() ->
    serviceListener(httpRequest, httpResponse)
  )


if useHttps
  path = require 'path'
  fs = require 'fs'
  httpsKey = path.resolve(config.get('CONFIG_DIR'), "#{service}.key")
  httpsCert = path.resolve(config.get('CONFIG_DIR'), "#{service}.crt")
  options = {
    key: fs.readFileSync(httpsKey),
    cert: fs.readFileSync(httpsCert),
    passphrase: config.get(service.toUpperCase()+'_PASSPHRASE')
  }
  server = require('https').createServer(options, listener)
else
  server = require('http').createServer(listener)

db.connect((err) ->
  throw err if err
  server.listen(port, networkInterface)
)
