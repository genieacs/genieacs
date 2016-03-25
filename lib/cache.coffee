###
# Copyright 2013-2016  Zaid Abdulla
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

vm = require 'vm'
crypto = require 'crypto'

db = require './db'

REFRESH = 3000

nextRefresh = 0
hash = null
presets = null
scripts = null


UNLOCK_SCRIPT = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end'
EXTEND_SCRIPT = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end'

lock = (lockName, ttl, callback) ->
  token = Math.random().toString(36).slice(2)
  unlockOrExtend = (ttl) ->
    if not ttl
      db.redisClient.eval(UNLOCK_SCRIPT, 1, lockName, token, (err, res) ->
        throw err or new Error('Lock expired') if err or not res
      )
    else
      db.redisClient.eval(EXTEND_SCRIPT, 1, lockName, token, ttl, (err, res) ->
        throw err or new Error('Lock expired') if err or not res
      )
    return

  db.redisClient.set(lockName, token, 'NX', 'PX', ttl, (err, res) ->
    if err or res
      return callback(err, unlockOrExtend)

    setTimeout(() ->
      return lock(lockName, ttl, callback)
    , 200)
  )


computeHash = () ->
  # MD5 hash for presets and scripts for detecting changes
  h = crypto.createHash('md5')
  for p in presets
    h.update(JSON.stringify(p.name))
    h.update(JSON.stringify(p.precondition))
    h.update(JSON.stringify(p.provisions))

  for s in Object.keys(scripts).sort()
    h.update(JSON.stringify(s))
    h.update(JSON.stringify(scripts[s].source))

  return h.digest('hex')


refresh = (callback) ->
  now = Date.now()
  db.redisClient.get('presets_hash', (err, res) ->
    return callback(err) if err

    if hash? and res == hash
      nextRefresh = now + REFRESH
      return callback()

    lock('presets_hash_lock', 3000, (err, unlockOrExtend) ->
      counter = 2
      db.presetsCollection.find().toArray((err, res) ->
        if err
          callback(err) if -- counter >= 0
          counter = 0
          return

        res.sort((a, b) ->
          if a.weight == b.weight
            return a._id > b._id
          else
            return a.weight - b.weight
        )

        presets = []

        for preset in res
          precondition = JSON.parse(preset.precondition)

          provisions = preset.provisions or []

          # Generate provisions from the old configuration format
          for c in preset.configurations
            switch c.type
              when 'age'
                provisions.push(['refresh', c.name, c.age * -1000])
              when 'value'
                provisions.push(['value', c.name, c.value])
              when 'add_tag'
                provisions.push(['tag', c.tag, true])
              when 'delete_tag'
                provisions.push(['tag', c.tag, false])
              when 'script'
                provisions.push([c.name].concat(c.args or []))
              else
                throw new Error("Unknown configuration type #{c.type}")

          presets.push({name: preset._id, precondition: precondition, provisions: provisions})

        if -- counter == 0
          computeHash()
          db.redisClient.setex("presets_hash", 300, hash, (err) ->
            unlockOrExtend(0)
            nextRefresh = now + REFRESH
            return callback()
          )
      )

      db.scriptsCollection.find().toArray((err, res) ->
        if err
          callback(err) if -- counter >= 0
          counter = 0
          return

        scripts = {}
        for r in res
          scripts[r._id] = {}
          scripts[r._id].source = r.source
          scripts[r._id].md5 = r.md5
          scripts[r._id].compiled = vm.Script(r.source, {filename: r._id, timeout: 50})

        if -- counter == 0
          computeHash()
          db.redisClient.setex("presets_hash", 300, hash, (err) ->
            unlockOrExtend(0)
            nextRefresh = now + REFRESH
            return callback()
          )
      )
    )
  )



getPresets = (callback) ->
  if Date.now() < nextRefresh
    return callback(null, hash, presets)

  refresh((err) ->
    return callback(err, hash, presets)
  )


getScripts = (callback) ->
  if Date.now() < nextRefresh
    return callback(null, hash, scripts)

  refresh((err) ->
    return callback(err, hash, scripts)
  )


exports.getPresets = getPresets
exports.getScripts = getScripts
