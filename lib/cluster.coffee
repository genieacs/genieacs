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
cluster = require 'cluster'
util = require 'util'


cluster.on('listening', (worker, address) ->
  util.log("Worker #{worker.process.pid} listening to #{address.address}:#{address.port}")
)

restartWorker = (worker, code, signal) ->
  util.log("Worker #{worker.process.pid} died (#{worker.process.exitCode}) #{signal}")
  cluster.fork()

cluster.on('exit', restartWorker)


start = (service) ->
  console.error('WARNING: This is a development branch of GenieACS. DO NOT use in production.')
  workerProcesses = config.get("#{service.toUpperCase()}_WORKER_PROCESSES")

  cluster.setupMaster({
      exec : 'lib/server',
      args : [service]
  })

  for [0 ... workerProcesses]
    cluster.fork()


process.on('SIGINT', () ->
  cluster.removeListener('exit', restartWorker)
)

process.on('SIGTERM', () ->
  cluster.removeListener('exit', restartWorker)
  for id of cluster.workers
    cluster.workers[id].kill()
)


exports.start = start
