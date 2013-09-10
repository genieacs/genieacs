common = require './common'

exports.execute = (deviceId, command, callback) ->
  args = command.split(/\s+/)
  f = args.shift()
  c = args.shift()

  file = require "./config/custom_commands/#{f}"
  file[c](deviceId, args.join(' '), callback)


exports.getCommands = (filename) ->
  commands = []
  f = require("./config/custom_commands/#{filename}")
  for k,v of f
    commands.push(k)
  return commands
