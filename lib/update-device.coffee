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

common = require './common'
db = require './db'
normalize = require('./normalize').normalize
mongoQuery = require './mongo-query'
parameters = require './parameters'

OBJECT_REGEX = /\.$/
INSTANCE_REGEX = /\.[\d]+\.$/


queueUpdates = (deviceId, deviceUpdates, callback) ->
  return callback() if not deviceUpdates? or Object.keys(deviceUpdates).length == 0
  # TODO consider setting expiry
  db.redisClient.rpush("#{deviceId}_updates", JSON.stringify(deviceUpdates), (err, res) ->
    return callback(err)
  )


clearUpdatesQueue = (deviceId, callback) ->
  db.redisClient.del("#{deviceId}_updates", (err, res) ->
    return callback(err)
  )


commitUpdates = (deviceId, deviceUpdates, commitQueue, callback) ->
  now = new Date(Date.now())
  update = {'$set' : {}, '$unset' : {}}

  # Used to find parameters that no longer exist in device
  presentPaths = null
  projection = null

  # Keep track of alias changes to clear cache if needed
  newAliases = null

  processBatch = (updatesBatch, cb) ->
    if updatesBatch.informEvents?
      update['$set']['_lastInform'] = now
      update['$set']['_lastBoot'] = now if '1 BOOT' in updatesBatch.informEvents
      update['$set']['_lastBootstrap'] = now if '0 BOOTSTRAP' in updatesBatch.informEvents

    if updatesBatch.parameterValues?
      for p in updatesBatch.parameterValues
        origValue = p[1]
        v = normalize(p[0], origValue)

        path = if common.endsWith(p[0], '.') then p[0] else "#{p[0]}."
        if v == origValue
          update['$unset']["#{path}_orig"] = 1
        else
          update['$set']["#{path}_orig"] = origValue
        update['$set']["#{path}_value"] = v
        update['$set']["#{path}_timestamp"] = now
        if p[2]?
          update['$set']["#{path}_type"] = p[2]

    if updatesBatch.deletedObjects?
      for p in updatesBatch.deletedObjects
        update['$unset'][p] = 1

    if updatesBatch.parameterNames?
      presentPaths ?= {}
      projection ?= {}

      for p in updatesBatch.parameterNames
        if OBJECT_REGEX.test(p[0])
          path = p[0].slice(0, -1)
          if INSTANCE_REGEX.test(p[0])
            update['$set']["#{path}._instance"] = true
          else
            update['$set']["#{path}._object"] = true
        else
          path = p[0]
        update['$set']["#{path}._writable"] = p[1] if p[1]?
        update['$set']["#{path}._timestamp"] = now

        # Add parameter (sans any dot suffix) if has an alias
        if (a = parameters.getAlias(path))?
          newAliases ?= {}
          newAliases[path] = a

        projection[path] = 1

        # Store this param path and all its parents for later look up
        presentPaths[path] = true
        i = p[0].indexOf('.')
        while i != -1
          presentPaths[p[0][0...i]] = true
          i = p[0].indexOf('.', i + 1)

    if updatesBatch.customCommands?
      for p in updatesBatch.customCommands
        commandName = p[0]
        update['$set']["_customCommands.#{commandName}._value"] = p[1]
        update['$set']["_customCommands.#{commandName}._timestamp"] = now

  processBatches = (cb) ->
    if not commitQueue
      processBatch(deviceUpdates) if deviceUpdates?
      return cb()

    db.redisClient.lpop("#{deviceId}_updates", (err, res) ->
      callback(err) if err

      if not res?
        processBatch(deviceUpdates) if deviceUpdates?
        return cb()

      processBatch(JSON.parse(res))
      return processBatches(cb)
    )

  commit = () ->
    for k of update
      delete update[k] if Object.keys(update[k]).length == 0

    if Object.keys(update).length
      db.devicesCollection.update({'_id' : deviceId}, update, {}, (err, count) ->
        return callback(err) if err

        # Clear aliases cache if there's a new aliased parameter that has not been included in aliases cache
        if newAliases?
          newAliasFound = false
          db.getAliases((aliases) ->
            for p, a of newAliases
              if not aliases[a]? or p not in aliases[a]
                newAliasFound = true
                break

            return callback() if not newAliasFound
            db.redisClient.del('aliases', (err, res) ->
              return callback(err)
            )
          )
        else
          return callback()
      )
    else
      return callback()

  processBatches(() ->
    if projection?
      mongoQuery.optimizeProjection(projection)

      # Fetch device from DB to discover and delete parameters that no longer exist
      # While we're fetching the object, we might as well use the information
      # to optimize our update query
      db.devicesCollection.findOne({'_id' : deviceId}, projection, (err, device) ->
        return callback(err) if err

        recursive = (obj, prefix) ->
          for k, v of obj
            p = prefix + k

            # Mark unset operations we want to keep
            if update['$unset'][p]?
              update['$unset'][p] = 2
              continue

            if k[0] == '_'
              # Remove set operations for unmodified values for optimization
              if update['$set'][p] == v
                delete update['$set'][p]
              continue

            if presentPaths[p]
              recursive(v, "#{p}.")
            else
              update['$unset'][p] = 2

        # Scan the DB object and remove parameters that no longer exists in device
        for path of projection
          root = device
          rootPath = ''
          for p in path.split('.')
            rootPath += "#{p}."
            root = root[p]
            break if not root?

          if root
            recursive(root, rootPath)
          else
            if not presentPaths[rootPath.slice(0, -1)]?
              update['$unset'][rootPath.slice(0, -1)] = 2

          # Remove unnecessary unset updates
          for k, v of update['$unset']
            if common.startsWith(k, path + '.') and v != 2
              delete update['$unset'][k]

        commit()
      )
    else
      commit()
  )


exports.queueUpdates = queueUpdates
exports.clearUpdatesQueue = clearUpdatesQueue
exports.commitUpdates = commitUpdates
