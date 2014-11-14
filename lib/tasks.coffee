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
#
# This file incorporates work covered by the following copyright and
# permission notice:
#
# Copyright 2013 Fanoos Telecom
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.
###

config = require './config'
common = require './common'
db = require './db'
mongodb = require 'mongodb'
customCommands = require './custom-commands'
url = require 'url'

exports.STATUS_OK = STATUS_OK = 1
exports.STATUS_FAULT = STATUS_FAULT = 2
exports.STATUS_COMPLETED = STATUS_COMPLETED = 4
exports.STATUS_SAVE = STATUS_SAVE = 128 # not mutually exclusive with the rest


this.refreshObject = (task, methodResponse, callback) ->
  task.session = {} if not task.session?

  if not task.session.subtask?
    path = task.objectName
    path += '.' if path != '' and not common.endsWith(path, '.')
    task.session.subtask = {device : task.device, name : 'getParameterNames', parameterPath : path}

  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if task.session.subtask.name is 'getParameterNames'
    this.getParameterNames(task.session.subtask, methodResponse, (err, status, methodRequest, deviceUpdates) =>
      task.session.parameterNames ?= []
      if deviceUpdates?.parameterNames?
        for p in deviceUpdates.parameterNames
          if not common.endsWith(p[0], '.')
            task.session.parameterNames.push(p[0])

      if status & STATUS_COMPLETED
        task.session.subtask = {device : task.device, name : 'getParameterValues', parameterNames : task.session.parameterNames}
        delete task.session.parameterNames

        this.getParameterValues(task.session.subtask, {}, (err, status, methodRequest) ->
          # ignore deviceUpdates returned by first call to getParameterValues
          callback(err, status, methodRequest, deviceUpdates)
        )
      else if status & STATUS_OK
        callback(err, STATUS_OK, methodRequest, deviceUpdates)
      else
        throw new Error('Unexpected subtask status')
    )
  else if task.session.subtask.name is 'getParameterValues'
    if methodResponse.faultcode?
      task.fault = methodResponse
      return callback(null, STATUS_FAULT)

    this.getParameterValues(task.session.subtask, methodResponse, (err, status, methodRequest, deviceUpdates) ->
      callback(err, status, methodRequest, deviceUpdates)
    )
  else
    throw Error('Unexpected subtask name')


this.getParameterNames = (task, methodResponse, callback) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  GET_PARAMETER_NAMES_DEPTH_THRESHOLD = config.get('GET_PARAMETER_NAMES_DEPTH_THRESHOLD', task.device)

  getParameterDepth = (param) ->
    return 0 if !param
    return (param[...-1] + '.').split('.').length - 1

  if methodResponse.type is 'GetParameterNamesResponse'
    path = task.session.queue.pop()

    # If parameter depth higher than the threshold, nextLevel was set to false
    if not task.nextLevel? and getParameterDepth(path) < GET_PARAMETER_NAMES_DEPTH_THRESHOLD
      for p in methodResponse.parameterList
        task.session.queue.push(p[0]) if p[0][-1..] == '.'

    deviceUpdates = {parameterNames : methodResponse.parameterList}

    # Make sure that for each parameter, all its parents are explicitly included
    found = {}
    found[path] = 0 if !!path
    for p in deviceUpdates.parameterNames
      param = p[0]
      i = param.length
      while (i = param.lastIndexOf('.', i-1)) > path.length
        pp = param.slice(0, i + 1)
        break if found[pp]?
        found[pp] = 0
      found[p[0]] = 1

    for k, v of found
      deviceUpdates.parameterNames.push([k]) if v == 0
  else
    task.session = {queue : [task.parameterPath]}

  if task.session.queue.length > 0
    path = task.session.queue[-1..][0]
    methodRequest = {
      type : 'GetParameterNames',
      parameterPath : path,
      nextLevel : task.nextLevel ? getParameterDepth(path) < GET_PARAMETER_NAMES_DEPTH_THRESHOLD
    }
    return callback(null, STATUS_OK, methodRequest, deviceUpdates)
  else
    return callback(null, STATUS_COMPLETED, null, deviceUpdates)


this.getParameterValues = (task, methodResponse, callback) ->
  task.session = {} if not task.session?

  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if not task.session.currentIndex?
    task.session.currentIndex = 0
  else if methodResponse.parameterList?
    task.session.currentIndex = task.session.nextIndex

  task.session.nextIndex = Math.min(task.session.currentIndex + config.get('TASK_PARAMETERS_BATCH_SIZE', task.device), task.parameterNames.length)
  names = task.parameterNames.slice(task.session.currentIndex, task.session.nextIndex)

  if methodResponse.type is 'GetParameterValuesResponse'
    deviceUpdates = {parameterValues : methodResponse.parameterList}

  if names.length == 0
    callback(null, STATUS_COMPLETED, null, deviceUpdates)
  else
    methodRequest = {
      type : 'GetParameterValues',
      parameterNames : names
    }
    callback(null, STATUS_OK, methodRequest, deviceUpdates)


this.setParameterValues = (task, methodResponse, callback) ->
  task.session = {} if not task.session?

  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if not task.session.currentIndex?
    task.session.currentIndex = 0
  else if methodResponse.type is 'SetParameterValuesResponse'
    prevValues = task.parameterValues.slice(task.session.currentIndex, task.session.nextIndex)
    task.session.currentIndex = task.session.nextIndex

  task.session.nextIndex = Math.min(task.session.currentIndex + config.get('TASK_PARAMETERS_BATCH_SIZE', task.device), task.parameterValues.length)
  values = task.parameterValues.slice(task.session.currentIndex, task.session.nextIndex)

  if prevValues?
    deviceUpdates = {parameterValues : prevValues}

  if values.length == 0
    callback(null, STATUS_COMPLETED, null, deviceUpdates)
  else
    callback(null, STATUS_OK, {type : 'SetParameterValues', parameterList : values}, deviceUpdates)


this.addObject = (task, methodResponse, callback) ->
  task.session = {} if not task.session?

  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  allDeviceUpdates = {}

  if not task.session.instanceNumber?
    if methodResponse.type is 'AddObjectResponse'
      status_save = STATUS_SAVE
      task.session.instanceNumber = methodResponse.instanceNumber
      # TODO Don't specify nextLevel explicity. Also consider using refreshObject instead.
      task.session.subtask = {device : task.device, name : 'getParameterNames', parameterPath : "#{task.objectName}.#{task.session.instanceNumber}.", nextLevel : false}
      task.session.appliedParameterValues = []
      task.session.parameterNames = []
      allDeviceUpdates.instanceName = [["#{task.objectName}.#{task.session.instanceNumber}", task.instanceName]] if task.instanceName?
    else
      callback(null, STATUS_OK, {type : 'AddObject', objectName : "#{task.objectName}."})
      return

  subtask = () =>
    switch task.session.subtask.name
      when 'getParameterNames'
        this.getParameterNames(task.session.subtask, methodResponse, (err, status, methodRequest, deviceUpdates) =>
          common.extend(allDeviceUpdates, deviceUpdates)
          if deviceUpdates and deviceUpdates.parameterNames
            for p in deviceUpdates.parameterNames
              task.session.parameterNames.push(p[0]) if not common.endsWith(p[0], '.')

          if status & STATUS_COMPLETED
            task.session.subtask = {device : task.device, name : 'getParameterValues', parameterNames : task.session.parameterNames}
            subtask()
          else if status & STATUS_OK
            # Use STATUS_SAVE to avoid adding duplicate object in case of error
            callback(err, STATUS_OK | status_save, methodRequest, allDeviceUpdates)
          else
            throw Error('Unexpected subtask status')
        )
      when 'getParameterValues'
        this.getParameterValues(task.session.subtask, methodResponse, (err, status, methodRequest, deviceUpdates) =>
          common.extend(allDeviceUpdates, deviceUpdates)
          # if values are given, compare with default values
          if task.parameterValues?
            if deviceUpdates and deviceUpdates.parameterValues?
              for p1 in deviceUpdates.parameterValues
                for p2 in task.parameterValues
                  if common.endsWith(p1[0], ".#{p2[0]}")
                    t = if p2[2] then p2[2] else p1[2]
                    v = common.matchType(p1[1], p2[1])
                    # TODO only include if writable
                    task.session.appliedParameterValues.push([p1[0], v, t])

          if methodResponse.faultcode?
            task.fault = methodResponse
            return callback(null, STATUS_FAULT)

          if status & STATUS_COMPLETED and task.session.appliedParameterValues.length > 0
            task.session.subtask = {device : task.device, name : 'setParameterValues', parameterValues : task.session.appliedParameterValues}
            subtask()
          else
            callback(err, status, methodRequest, allDeviceUpdates)
        )
      when 'setParameterValues'
        this.setParameterValues(task.session.subtask, methodResponse, (err, status, methodRequest, deviceUpdates) =>
          common.extend(allDeviceUpdates, deviceUpdates)
          callback(err, status, methodRequest, allDeviceUpdates)
        )
  subtask()


this.deleteObject = (task, methodResponse, callback) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if methodResponse.type is 'DeleteObjectResponse'
    callback(null, STATUS_COMPLETED, null, {deletedObjects : [task.objectName]})
  else
    methodRequest = {
      type : 'DeleteObject',
      objectName : "#{task.objectName}."
    }
    callback(null, STATUS_OK, methodRequest)


this.reboot = (task, methodResponse, callback) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return
  
  if methodResponse.type isnt 'RebootResponse'
    callback(null, STATUS_OK, {type : 'Reboot'})
  else
    callback(null, STATUS_COMPLETED)


this.factoryReset = (task, methodResponse, callback) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if methodResponse.type isnt 'FactoryResetResponse'
    callback(null, STATUS_OK, {type : 'FactoryReset'})
  else
    callback(null, STATUS_COMPLETED)


this.download = (task, methodResponse, callback) ->
  if methodResponse.faultcode?
    task.fault = methodResponse
    callback(null, STATUS_FAULT)
    return

  if methodResponse.type isnt 'DownloadResponse'
    db.filesCollection.findOne({_id : mongodb.ObjectID(String(task.file))}, (err, file) ->
      if not file?
        callback('File not found')
        return
      else if err?
        callback(err)
        return

      l = {
        protocol : if config.get('FS_SSL') then 'https' else 'http',
        hostname : config.get('FS_IP'),
        port : config.get('FS_PORT'),
        pathname : encodeURIComponent(file.filename)
      }

      methodRequest = {
        type : 'Download',
        fileType : file.metadata.fileType,
        fileSize : file.length,
        url : url.format(l),
        successUrl : task.successUrl,
        failureUrl : task.failureUrl
      }
      callback(null, STATUS_OK, methodRequest)
    )
  else
    callback(null, STATUS_COMPLETED)


this.customCommand = (task, methodResponse, callback) ->
  # TODO implement timeout
  customCommands.execute(task.device, task.command, (err, value) ->
    if err?
      task.fault = err
      callback(null, STATUS_FAULT)
    else
      commandName = task.command.split(' ', 2)[0]
      callback(null, STATUS_COMPLETED, null, {customCommands : [[commandName, value]]})
  )


exports.task = (task, methodResponse, callback) ->
  this[task.name](task, methodResponse, callback)
