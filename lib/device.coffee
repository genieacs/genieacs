###
# Copyright 2013-2015  Zaid Abdulla
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
mongoQuery = require './mongo-query'
DataModel = require './data-model'


class Device

  constructor: (id) ->
    @id = id
    @dataModel = new DataModel()
    @new = null
    @toFetch = {}
    @toFetchCallbacks = []


  get: (patterns, callback) ->
    now = Date.now()
    prefix = null
    result = {}

    f = (parameter, properties, flags, children) =>
      return if (flags[1] & 1) and not properties[1]? # skip deleted
      res = {fetch: {}, parameters: {}}

      if children is null # This is a rightmost parameter
        if not (flags[0] & 1)
          res.fetch[parameter] |= 1
        else if properties.length > 0
          values = {}

          if parameter in ['Tags', 'Events', 'DeviceID']
            values['timestamp'] = now
            values['writable'] = false

          else if common.startsWith(parameter, 'Tags.')
            values['timestamp'] = now
            values['value'] = false
            values['type'] = 'xsd:boolean'
            values['writable'] = true

          else if common.startsWith(parameter, 'Events.')
            values['timestamp'] = now
            values['type'] = 'xsd:dateTime'
            values['writable'] = true

          else if common.startsWith(parameter, 'DeviceID.')
            values['timestamp'] = now
            values['type'] = 'xsd:string'
            values['writable'] = false

          values[k] = v for k, v of properties[0]
          values[k] = v for k, v of properties[1]
          res.parameters[parameter] = values

        return res

      if not (flags[0] > 1 or flags[1] > 1)
        if parameter.length < prefix.length
          res.fetch[prefix] |= 2
        else
          res.fetch[parameter] |= 2

      for c of children
        for k, v of children[c].fetch
          res.fetch[k] |= v
        for k, v of children[c].parameters
          res.parameters[k] = v

      return res

    if common.typeOf(patterns) isnt common.ARRAY_TYPE
      _patterns = [patterns]
    else
      _patterns = patterns

    unsatisfied = []

    for pattern in _patterns
      wildcard = pattern.indexOf('*')
      prefix = if wildcard == -1 then pattern else pattern[0...wildcard-1]
      res = @dataModel.walk(pattern, f)

      if Object.keys(res.fetch).length == 0
        if _patterns != patterns
          result = res.parameters
        else
          result[pattern] = res.parameters
      else
        unsatisfied.push(pattern)
        for k, v of res.fetch
          @toFetch[k] |= v

    if unsatisfied.length == 0
      return callback(result)

    @fetch(() =>
      for pattern in unsatisfied
        prefix = if wildcard == -1 then pattern else pattern[0...wildcard-1]
        res = @dataModel.walk(pattern, f)

        if Object.keys(res.fetch).length == 0
          if _patterns != patterns
            result = res.parameters
          else
            result[pattern] = res.parameters
        else
          throw new Error('Something is not right!') if not satisfied
      return callback(result)
    )


  fetch: (callback) ->
    @toFetchCallbacks.push(callback)

    # Fetch from DB only once
    if @toFetchCallbacks.length > 1
      return

    process.nextTick(() =>
      callbacks = @toFetchCallbacks
      projection = @toFetch
      @toFetchCallbacks = []
      @toFetch = {}

      if @new
        for k, v of projection
          if v == 1
            @dataModel.flag(0, k)
          else
            @dataModel.flag(0, k, true)
        c() for c in callbacks
        return

      proj = {}
      for k, v of projection
        if k == 'Events'
          proj['_registered'] = 1
          proj['_lastInform'] = 1
          proj['_lastBoot'] = 1
          proj['_lastBootstrap'] = 1
        else if k == 'Events.Registered'
          proj['_registered'] = 1
        else if k == 'Events.Inform'
          proj['_lastInform'] = 1
        else if k == 'Events.0_BOOTSTRAP'
          proj['_lastBootstrap'] = 1
        else if k == 'Events.1_BOOT'
          proj['_lastBoot'] = 1
        else if k == 'DeviceID'
          proj['_deviceId'] = 1
        else if k == 'DeviceID.ID'
          proj['_id'] = 1
        else if k == 'DeviceID.Manufacturer'
          proj['_deviceId._Manufacturer'] = 1
        else if k == 'DeviceID.ProductClass'
          proj['_deviceId._ProductClass'] = 1
        else if k == 'DeviceID.OUI'
          proj['_deviceId._OUI'] = 1
        else if k == 'DeviceID.SerialNumber'
          proj['_deviceId._SerialNumber'] = 1
        else if k == 'Tags' or common.startsWith(k, 'Tags.')
          proj['_tags'] = 1
        else
          if v == 2
            proj[k] = 1
          else if k == ''
            proj['_timestamp'] = 1
          else
            proj["#{k}._value"] = 1
            proj["#{k}._timestamp"] = 1
            proj["#{k}._type"] = 1
            proj["#{k}._writable"] = 1
            proj["#{k}._object"] = 1
            proj["#{k}._orig"] = 1

      mongoQuery.optimizeProjection(proj)

      db.devicesCollection.findOne({'_id' : @id}, proj, (err, device) =>
        throw err if err
        @new = (device is null)

        storeParams = (obj, prefix) =>
          p = prefix[...-1]
          o = {}
          for k, v of obj
            if k == '_timestamp'
              o['timestamp'] = +v
            else if k[0] == '_'
              o[k[1..]] = v
            else
              storeParams(v, "#{prefix}#{k}.")
          if Object.keys(o).length > 0
            @dataModel.set(0, p, o, (if o['value']? then true else false), {object: true})

        now = Date.now()
        for k, v of device
          if k == '_timestamp'
            @dataModel.set(0, '', {timestamp: +v, object: true})
          else if k == '_lastInform'
            @dataModel.set(0, 'Events.Inform', {value: +v, writable: false, timestamp: now, type: 'xsd:dateTime'}, true, {object: true, timestamp: now})
          else if k == '_lastBoot'
            @dataModel.set(0, 'Events.1_BOOT', {value: +v, writable: false, timestamp: now, type: 'xsd:dateTime'}, true, {object: true})
          else if k == '_lastBootstrap'
            @dataModel.set(0, 'Events.0_BOOTSTRAP', {value: +v, writable: false, timestamp: now, type: 'xsd:dateTime'}, true, {object: true})
          else if k == '_registered'
            @dataModel.set(0, 'Events.Registered', {value: +v, writable: false, timestamp: now, type: 'xsd:dateTime'}, true, {object: true})
          else if k == '_id'
            @dataModel.set(0, 'DeviceID.ID', {value: v, writable: false, timestamp: now, type: 'xsd:string'}, true, {object: true})
          else if k == '_tags'
            for t in v
              @dataModel.set(0, "Tags.#{t}", {value: true, writable: false, timestamp: now, type: 'xsd:boolean'}, true, {object: true, timestamp: now})
            @dataModel.flag(0, 'Tags.*', true)
          else if k == '_id'
            @dataModel.set(0, 'DeviceID.ID', {value: vv, writable: false, timestamp: now, type: 'xsd:string'}, true, {object: true})
          else if k == '_deviceId'
            for kk, vv of v
              if kk == '_Manufacturer'
                @dataModel.set(0, 'DeviceID.Manufacturer', {value: vv, writable: false, timestamp: now, type: 'xsd:string'}, true, {object: true})
              else if kk == '_OUI'
                @dataModel.set(0, 'DeviceID.OUI', {value: vv, writable: false, timestamp: now, type: 'xsd:string'}, true, {object: true})
              if kk == '_ProductClass'
                @dataModel.set(0, 'DeviceID.ProductClass', {value: vv, writable: false, timestamp: now, type: 'xsd:string'}, true, {object: true})
              if kk == '_SerialNumber'
                @dataModel.set(0, 'DeviceID.SerialNumber', {value: vv, writable: false, timestamp: now, type: 'xsd:string'}, true, {object: true})
          else if common.typeOf(v) is common.OBJECT_TYPE
            storeParams(v, k + '.')

        for k, v of projection
          if v == 1
            @dataModel.flag(0, k)
          else
            @dataModel.flag(0, k, true)

        c() for c in callbacks
      )
    )


  setParameterValues: (timestamp, parameterValueList) ->
    for p in parameterValueList
      @dataModel.set(1, p[0], {value: p[1], type: p[2], timestamp: timestamp}, true, {object: true})


  setParameterInfo: (timestamp, parameter, nextLevel, parameterInfoList) ->
    @dataModel.set(1, parameter, {timestamp: timestamp})

    for p in parameterInfoList
      values = {writable: p[1]}

      values['timestamp'] = timestamp if not nextLevel

      if common.endsWith(p[0], '.')
        p[0] = p[0][...-1]
        values['object'] = true
      else
        values['object'] = null

      @dataModel.set(1, p[0], values)

    if nextLevel
      @dataModel.flag(1, "#{parameter}.*", false)
    else
      @dataModel.flag(1, parameter, true)


  commit: (callback) ->
    # TODO Ensure newly discovered parameters are fully fetched
    updates = @dataModel.walk(null, (parameter, properties, flags, children) =>
      update = {'$set' : {}, '$unset' : {}, '$addToSet' : {}, '$pull' : {}}
      if flags[1] and properties[1] is null and properties[0] isnt null
        update['$unset'][parameter] = 1
        return update

      prefix = if parameter == '' then '' else "#{parameter}."

      if parameter == 'Events'
        for k, v of children
          if k == 'Inform'
            update['$set']['_lastInform'] = new Date(v['$set']['Events.Inform._value'])
          else if k == '0_BOOTSTRAP'
            update['$set']['_lastBootstrap'] = new Date(v['$set']['Events.0_BOOTSTRAP._value'])
          else if k == '1_BOOT'
            update['$set']['_lastBoot'] = new Date(v['$set']['Events.1_BOOT._value'])
          else if k == 'Registered'
            update['$set']['_registered'] = new Date(v['$set']['Events.Registered._value'])
        return update

      if parameter == 'DeviceID'
        return null if not @new # Only save for new devices
        if children['Manufacturer']?
          update['$set']['_deviceId._Manufacturer'] = children['Manufacturer']['$set']['DeviceID.Manufacturer._value']
        if children['OUI']?
          update['$set']['_deviceId._OUI'] = children['OUI']['$set']['DeviceID.OUI._value']
        if children['ProductClass']?
          update['$set']['_deviceId._ProductClass'] = children['ProductClass']['$set']['DeviceID.ProductClass._value']
        if children['SerialNumber']?
          update['$set']['_deviceId._SerialNumber'] = children['SerialNumber']['$set']['DeviceID.SerialNumber._value']
        return update

      if parameter == 'Tags'
        addTags = []
        removeTags = []
        for k, v of children
          if v['$set']['Tags.' + k + '._value'] == true
            addTags.push(k)
          else
            removeTags.push(k)
        update['$addToSet'] = {'_tags' : {'$each' : addTags}}
        update['$pull'] = {'_tags' : {'$in' : removeTags}}
        return update

      for k, v of properties[1]
        if v is null
          update['$unset']["#{prefix}_#{k}"]  =1
        else if v != properties[0]?[k]
          if k == 'timestamp'
            v = new Date(v)
          update['$set']["#{prefix}_#{k}"] = v

      for k, v of children
        for k2, v2 of v
          for k3, v3 of v2
            update[k2][k3] = v3

      return update
    )

    for k of updates
      if k == '$addToSet'
        for kk of updates[k]
          delete updates[k][kk] if updates[k][kk]['$each'].length == 0
      else if k == '$pull'
        for kk of updates[k]
          delete updates[k][kk] if updates[k][kk]['$in'].length == 0
      delete updates[k] if Object.keys(updates[k]).length == 0

    return callback() if Object.keys(updates).length == 0

    db.devicesCollection.update({'_id' : @id}, updates, {upsert: @new}, (err, count) =>
      if not err and count != 1
        return callback(new Error("Device #{@id} not found in database"))

      return callback(err)
    )


  serialize: () ->
    data = {
      id: @id,
      new: @new
      dataModel: @dataModel.serialize()
    }
    return data


  @deserialize: (data) ->
    device = new Device(data.id)
    device.new = data.new
    device.dataModel = DataModel.deserialize(data.dataModel)
    return device


module.exports = Device
