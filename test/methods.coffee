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

common = require '../lib/common'

NAMESPACES = {
  'soap-enc' : 'http://schemas.xmlsoap.org/soap/encoding/',
  'soap-env' : 'http://schemas.xmlsoap.org/soap/envelope/',
  'xsd' : 'http://www.w3.org/2001/XMLSchema',
  'xsi' : 'http://www.w3.org/2001/XMLSchema-instance',
  'cwmp' : 'urn:dslforum-org:cwmp-1-0',
}


exports.inform = (device, xmlOut, callback) ->
  body = xmlOut.root().childNodes()[1]
  inform = body.node('cwmp:Inform')

  deviceId = inform.node('DeviceId')
  deviceId.node('Manufacturer', device['InternetGatewayDevice.DeviceInfo.Manufacturer'][1])
  deviceId.node('OUI', device['InternetGatewayDevice.DeviceInfo.ManufacturerOUI'][1])
  deviceId.node('ProductClass', device['InternetGatewayDevice.DeviceInfo.ProductClass'][1])
  deviceId.node('SerialNumber', device['InternetGatewayDevice.DeviceInfo.SerialNumber'][1])

  eventStruct = inform.node('Event').attr({'soap-enc:arrayType' : 'cwmp:EventStruct[1]'}).node('EventStruct')
  eventStruct.node('EventCode', '2 PERIODIC')
  eventStruct.node('CommandKey')

  inform.node('MaxEnvelopes', '1')
  inform.node('CurrentTime', new Date().toISOString())
  inform.node('RetryCount', '0')

  parameterList = inform.node('ParameterList').attr({'soap-enc:arrayType' : 'cwmp:ParameterValueStruct[7]'})
  for p in [
      'InternetGatewayDevice.DeviceInfo.SpecVersion',
      'InternetGatewayDevice.DeviceInfo.HardwareVersion',
      'InternetGatewayDevice.DeviceInfo.SoftwareVersion',
      'InternetGatewayDevice.DeviceInfo.ProvisioningCode',
      'InternetGatewayDevice.ManagementServer.ParameterKey',
      'InternetGatewayDevice.ManagementServer.ConnectionRequestURL',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress']
    parameterValueStruct = parameterList.node('ParameterValueStruct')
    parameterValueStruct.node('Name', p)
    parameterValueStruct.node('Value', device[p][1]).attr({'xsi:type' : "#{device[p][2]}"})

  callback(xmlOut)


exports.GetParameterNames = (device, xmlIn, xmlOut, callback) ->
  parameterNames = Object.keys(device).sort()
  parameterPath = xmlIn.get('/soap-env:Envelope/soap-env:Body/cwmp:GetParameterNames/ParameterPath', NAMESPACES).text()
  nextLevel = !!eval(xmlIn.get('/soap-env:Envelope/soap-env:Body/cwmp:GetParameterNames/NextLevel', NAMESPACES).text())

  parameterList = []
  if nextLevel
    for p in parameterNames
      if common.startsWith(p, parameterPath) and p.length > parameterPath.length + 1
        i = p.indexOf('.', parameterPath.length + 1)
        if i == -1 or i == p.length - 1
          parameterList.push(p)
  else
    for p in parameterNames
      if common.startsWith(p, parameterPath)
        parameterList.push(p)

  getParameterNamesResponseNode = xmlOut.root().childNodes()[1].node('cwmp:GetParameterNamesResponse')
  parameterListNode = getParameterNamesResponseNode.node('ParameterList')
  parameterListNode.attr({'soap-enc:arrayType' : "cwmp:ParameterInfoStruct[#{parameterList.length}]"})
  for p in parameterList
    parameterInfoStructNode = parameterListNode.node('ParameterInfoStruct')
    parameterInfoStructNode.node('Name', p)
    parameterInfoStructNode.node('Writable', String(device[p][0]))

  callback(xmlOut)


exports.GetParameterValues = (device, xmlIn, xmlOut, callback) ->
  parameterNames = xmlIn.find('/soap-env:Envelope/soap-env:Body/cwmp:GetParameterValues/ParameterNames/*', NAMESPACES)

  parameterList = xmlOut.root().childNodes()[1].node('cwmp:GetParameterValuesResponse').node('ParameterList')
  parameterList.attr({'soap-enc:arrayType' : "cwmp:ParameterValueStruct[#{parameterNames.length}]"})

  for p in parameterNames
    name = p.text()
    value = device[name][1]
    type = device[name][2]
    valueStruct = parameterList.node('ParameterValueStruct')
    valueStruct.node('Name', name)
    valueStruct.node('Value', device[name][1]).attr({'xsi:type' : "#{type}"})

  callback(xmlOut)


exports.SetParameterValues = (device, xmlIn, xmlOut, callback) ->
  parameterValues = xmlIn.find('/soap-env:Envelope/soap-env:Body/cwmp:SetParameterValues/ParameterList/*', NAMESPACES)

  for p in parameterValues
    name = p.get('Name').text()
    value = p.get('Value')
    device[name][1] = value.text()
    device[name][2] = value.attr('type').value()

  responseNode = xmlOut.root().childNodes()[1].node('cwmp:SetParameterValuesResponse')
  responseNode.node('Status', '0')

  callback(xmlOut)


exports.AddObject = (device, xmlIn, xmlOut, callback) ->
  objectName = xmlIn.get('/soap-env:Envelope/soap-env:Body/cwmp:AddObject/ObjectName', NAMESPACES).text()

  parameters = []
  instances = {}
  instanceNumber = 1
  while device[objectName + instanceNumber + '.']?
    instanceNumber += 1

  for p in Object.keys(device).sort()
    if common.startsWith(p, objectName) and p.length > objectName.length
      n = objectName + instanceNumber + p.slice(p.indexOf('.', objectName.length))
      if not device[n]?
        device[n] = [device[p][0], '', device[p][2]]

  responseNode = xmlOut.root().childNodes()[1].node('cwmp:AddObjectResponse')
  responseNode.node('InstanceNumber', String(instanceNumber))
  responseNode.node('Status', '0')

  callback(xmlOut)


exports.DeleteObject = (device, xmlIn, xmlOut, callback) ->
  objectName = xmlIn.get('/soap-env:Envelope/soap-env:Body/cwmp:DeleteObject/ObjectName', NAMESPACES).text()

  for p in Object.keys(device)
    if common.startsWith(p, objectName)
      delete device[p]

  responseNode = xmlOut.root().childNodes()[1].node('cwmp:DeleteObjectResponse')
  responseNode.node('Status', '0')

  callback(xmlOut)
