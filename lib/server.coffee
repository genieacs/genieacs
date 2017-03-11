###
# Copyright 2013-2017  Zaid Abdulla
#
# This file is part of GenieACS.
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

service = process.argv[2]
if not service?
  throw new Error('Missing argument cwmp, fs, or nbi')

util = require 'util'
cluster = require 'cluster'
logger = require './logger'
logger.init(service, require('../package.json').version)
config = require './config'
db = require './db'
extensions = require './extensions'

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

  if not server
    db.disconnect()
    extensions.killAll()
    logger.close()
    return

  server.close(() ->
    db.disconnect()
    extensions.killAll()
    logger.close()
  )


process.on('uncaughtException', (err) ->
  logger.error({
    message: 'Uncaught exception'
    exception: err
  })
  exit()
)


if useHttps
  path = require 'path'
  fs = require 'fs'
  httpsKey = path.resolve(config.get('CONFIG_DIR'), "#{service}.key")
  httpsCert = path.resolve(config.get('CONFIG_DIR'), "#{service}.crt")
  httpsCa = path.resolve(config.get('CONFIG_DIR'), "#{service}.ca-bundle")
  options = {
    key: fs.readFileSync(httpsKey),
    cert: fs.readFileSync(httpsCert)
  }

  try
    # Use intermediate certificates if available
    options.ca = fs.readFileSync(httpsCa).toString()
      .match(/\-+BEGIN CERTIFICATE\-+[0-9a-zA-Z\+\-\/\=\s]+?\-+END CERTIFICATE\-+/g)

  server = require('https').createServer(options, listener)
  server.on('secureConnection', onConnection) if onConnection?
else
  server = require('http').createServer(listener)
  server.on('connection', onConnection) if onConnection?

db.connect((err) ->
  throw err if err
  server.listen(port, networkInterface)
)


process.on('SIGINT', exit)
process.on('SIGTERM', exit)
