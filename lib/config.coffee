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

path = require 'path'
common = require './common'


defaults = {
  CONFIG_DIR : './config',

  MONGODB_CONNECTION_URL : 'mongodb://127.0.0.1/genieacs',
  REDIS_PORT : 6379,
  REDIS_HOST : '127.0.0.1',
  REDIS_DB : 0,

  CWMP_WORKER_PROCESSES : 4,
  CWMP_PORT : 7547, # CWMP port as assigned by IANA
  CWMP_INTERFACE : '0.0.0.0',
  CWMP_SSL : false,
  NBI_WORKER_PROCESSES : 2,
  NBI_PORT : 7557,
  NBI_INTERFACE : '0.0.0.0',
  NBI_SSL : false,
  FS_WORKER_PROCESSES : 2,
  FS_PORT : 7567,
  FS_INTERFACE : '0.0.0.0',
  FS_SSL : false,
  FS_IP : '192.168.0.1', # Used when sending download requests to devices

  CACHE_DURATION : 60, # in seconds
  PRESETS_CACHE_DURATION : 86400,
  PRESETS_TIME_PADDING : 1,

  LOG_INFORMS : true,
  DEBUG : false,
  DEVICE_ONLINE_THRESHOLD : 4000,
  RETRY_DELAY : 300,
  IGNORE_XML_NAMESPACES : false, # Traverse XML using element's local name only
  SESSION_TIMEOUT : 30,
  GET_PARAMETER_NAMES_DEPTH_THRESHOLD : 0,
  TASK_PARAMETERS_BATCH_SIZE : 32
}


# Command line arguments
exports.argv = []
argv = process.argv[2..]
while argv.length
  arg = argv.shift()
  if arg[0] == '-'
    v = argv.shift()
    exports.argv[arg] = v
    n = arg[2..].toUpperCase().replace(/-/g, '_')
    if defaults[n]?
      exports[n] ?= common.matchType(defaults[n], v)
      # Save as environmnet variables to pass on to any child processes
      process.env["GENIEACS_#{n}"] = v
  else
    exports.argv.push(arg)


# Environment variable
for k, v of process.env
  k = k[9..] # remove "GENIEACS_" prefix
  if defaults[k]?
    exports[k] ?= common.matchType(defaults[k], v)


# Find config dir
if exports.argv['--config-dir']?
  exports.CONFIG_DIR = exports.argv['--config-dir']
else if process.env['GENIEACS_CONFIG_DIR']?
  exports.CONFIG_DIR = process.env['GENIEACS_CONFIG_DIR']
else
  exports.CONFIG_DIR = defaults.CONFIG_DIR


# Configuration file
for k, v of require(path.resolve(exports.CONFIG_DIR, 'config'))
  if defaults[k]?
    exports[k] ?= common.matchType(defaults[k], v)


# Defaults
for k, v of defaults
  exports[k] ?= defaults[k]


# load parameter configurations
exports.PARAMETERS = require(path.resolve(exports.CONFIG_DIR, 'parameters'))

# load authentication scripts
exports.auth = require(path.resolve(exports.CONFIG_DIR, 'auth'))

exports.CUSTOM_COMMANDS = require(path.resolve(exports.CONFIG_DIR, 'custom_commands'))
