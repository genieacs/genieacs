config = require './config'
common = require './common'


exports.execute = (deviceId, command, callback) ->
  args = command.split(/\s+/)
  f = args.shift()
  c = args.shift()

  file = require "./config/custom_commands/#{f}"
  file[c](deviceId, args.join(' '), callback)


exports.getFileCommands = (filename) ->
  commands = []
  f = require("./config/custom_commands/#{filename}")
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
