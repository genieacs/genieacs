exports.DATABASE_NAME = 'genieacs'
exports.ACS_PORT = 7547 # CWMP port as assigned by IANA
exports.ACS_HTTPS_PORT = 7548
exports.ACS_INTERFACE = '0.0.0.0'
exports.ACS_HTTPS_INTERFACE = '0.0.0.0'
exports.API_PORT = 7557
exports.API_INTERFACE = '0.0.0.0'
exports.FILES_PORT = 7567
exports.FILES_INTERFACE = '0.0.0.0'
exports.FILES_IP = '172.240.21.2' # Used when sending download requests to devices
exports.CACHE_DURATION = 60 # in seconds
exports.PRESETS_CACHE_DURATION = 86400
exports.PRESETS_TIME_PADDING = 1
exports.MONGODB_SOCKET = '/tmp/mongodb-27017.sock'
exports.REDIS_SOCKET = '/tmp/redis.sock'
exports.WORKER_RESPAWN_TIME = 60000
exports.LOG_INFORMS = false
exports.DEBUG_DEVICES = {} # {'202BC1-BM632w-8KA8WA1151100043' : true}
exports.DEVICE_ONLINE_THRESHOLD = 4000
exports.RETRY_DELAY = 300

exports.MONGODB_OPTIONS = {
  db : {
    w : 1
    wtimeout : 60000
  }
  server : {
    auto_reconnect : true
  }
}

# load configuration
c = require('../config/config')
for k, v of c
  exports[k] = v

# load parameter configurations
exports.PARAMETERS = require('../config/parameters')

# load authentication scripts
exports.auth = require('../config/auth')

exports.CUSTOM_COMMANDS = require('../config/custom_commands')

