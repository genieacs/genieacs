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

path = require 'path'
common = require './common'

options = {
  CONFIG_DIR : {type : 'path', default : 'config'},
  MONGODB_CONNECTION_URL : {type : 'string', default : 'mongodb://127.0.0.1/genieacs'},
  REDIS_PORT : {type : 'int', default : 6379},
  REDIS_HOST : {type : 'string', default : ''},
  REDIS_DB : {type : 'int', default : 0},

  CWMP_WORKER_PROCESSES : {type : 'int', default : 0},
  CWMP_PORT : {type : 'int', default : 7547},
  CWMP_INTERFACE : {type : 'string', default : '0.0.0.0'},
  CWMP_SSL : {type : 'bool', default : false},
  CWMP_LOG_FILE : {type: 'path', default : ''},
  CWMP_ACCESS_LOG_FILE : {type : 'path', default : ''},

  NBI_WORKER_PROCESSES : {type : 'int', default : 0},
  NBI_PORT : {type : 'int', default : 7557},
  NBI_INTERFACE : {type : 'string', default : '0.0.0.0'},
  NBI_SSL : {type : 'bool', default : false},
  NBI_LOG_FILE : {type: 'path', default : ''},
  NBI_ACCESS_LOG_FILE : {type : 'path', default : ''},

  FS_WORKER_PROCESSES : {type : 'int', default : 0},
  FS_PORT : {type : 'int', default : 7567},
  FS_INTERFACE : {type : 'string', default : '0.0.0.0'},
  FS_SSL : {type : 'bool', default : false},
  FS_HOSTNAME : {type : 'string', default : 'acs.example.com'},
  FS_LOG_FILE : {type: 'path', default : ''},
  FS_ACCESS_LOG_FILE : {type : 'path', default : ''},

  UDP_CONNECTION_REQUEST_PORT : {type : 'int', default : 0},

  DOWNLOAD_TIMEOUT: {type : 'int', default : 3600},
  EXT_TIMEOUT: {type: 'int', default: 3000},
  MAX_CACHE_TTL : {type : 'int', default : 86400},
  DEBUG : {type : 'bool', default : false},
  RETRY_DELAY : {type : 'int', default : 300},
  SESSION_TIMEOUT : {type : 'int', default : 30},
  CONNECTION_REQUEST_TIMEOUT : {type : 'int', default: 2000},
  GPN_NEXT_LEVEL : {type : 'int', default : 0},
  GPV_BATCH_SIZE : {type : 'int', default : 32},
  MAX_DEPTH : {type: 'int', default : 16},
  COOKIES_PATH : {type : 'string'},
  LOG_FORMAT : {type : 'string', default : 'simple'},
  ACCESS_LOG_FORMAT : {type : 'string', default : ''},
  MAX_CONCURRENT_REQUESTS : {type : 'int', default: 20},

  # XML configuration
  XML_RECOVER : {type : 'bool', default : false},
  XML_IGNORE_ENC : {type : 'bool', default : false},
  XML_FORMAT : {type : 'bool', default : false},
  XML_NO_DECL : {type : 'bool', default : false},
  XML_NO_EMPTY : {type : 'bool', default : false},
  XML_IGNORE_NAMESPACE : {type : 'bool', default : false},

  # Should probably never be changed
  DEVICE_ONLINE_THRESHOLD : {type : 'int', default : 4000}
}

allConfig = {}


setConfig = (name, value, commandLineArgument) ->
  return true if allConfig[name]?

  # For compatibility with v1.0
  if name in ['PRESETS_CACHE_DURATION', 'presets-cache-duration']
    setConfig('MAX_CACHE_TTL', value)

  if name in ['GET_PARAMETER_NAMES_DEPTH_THRESHOLD', 'get-parameter-names-depth-threshold']
    setConfig('GPN_NEXT_LEVEL', value)

  if name in ['TASK_PARAMETERS_BATCH_SIZE', 'task-parameters-batch-size']
    setConfig('GPV_BATCH_SIZE', value)

  if name in ['IGNORE_XML_NAMESPACES', 'ignore-xml-namespaces']
    setConfig('XML_IGNORE_NAMESPACE', value)

  if name in ['XML_PARSE_IGNORE_ENC', 'xml-parse-ignore-enc']
    setConfig('XML_IGNORE_ENC', value)

  if name in ['XML_PARSE_RECOVER', 'xml-parse-recover']
    setConfig('XML_RECOVER', value)

  if name in ['FS_IP', 'fs-ip']
    setConfig('FS_HOSTNAME', value)

  cast = (val, type) ->
    switch type
      when 'int'
        Number(val)
      when 'bool'
        String(val).trim().toLowerCase() in ['true', 'on', 'yes', '1']
      when 'string'
        String(val)
      when 'path'
        if val then path.resolve(val) else ''
      else
        null

  _value = null

  for optionName, optionDetails of options
    n = optionName
    if commandLineArgument
      n = n.toLowerCase().replace(/_/g, '-')

    if name == n
      _value = cast(value, optionDetails.type)
      n = optionName
    else if name.startsWith("#{n}-")
      _value = cast(value, optionDetails.type)
      n = "#{optionName}-#{name[optionName.length+1..]}"

    if _value?
      allConfig[n] = _value
      # Save as environmnet variable to pass on to any child processes
      process.env["GENIEACS_#{n}"] = _value
      return true

  return false


# Command line arguments
argv = process.argv[2..]
while argv.length
  arg = argv.shift()
  if arg[0] == '-'
    v = argv.shift()
    setConfig(arg[2..], v, true)


# Environment variable
for k, v of process.env
  continue if k.lastIndexOf('GENIEACS_', 0) != 0
  k = k[9..] # remove "GENIEACS_" prefix
  setConfig(k, v)


# Use default config dir if none defined
setConfig('CONFIG_DIR', options['CONFIG_DIR'].default)

# Configuration file
for k, v of require(path.resolve(allConfig.CONFIG_DIR, 'config'))
  if not setConfig(k, v)
    # Pass as environment variable to be accessable by extensions
    process.env["GENIEACS_#{k}"] = v


# Defaults
for k, v of options
  setConfig(k, v.default) if v.default?


get = (option, deviceId) ->
  if deviceId?
    name = "#{option}-#{deviceId}"
    v = allConfig[name]
    return v if v?
    i = name.lastIndexOf('-')
    v = allConfig[name[0...i]]
    return v if v?
    i = name.lastIndexOf('-', i-1)
    v = allConfig[name[0...i]]
    return v if v? or i == -1

  return allConfig[option]


# load authentication scripts
try
  exports.auth = require(path.resolve(allConfig.CONFIG_DIR, 'auth'))

exports.get = get
