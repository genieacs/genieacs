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

http = require 'http'
libxmljs = require 'libxmljs'
deviceTemplate = require './huawei_bm632w'
methods = require './methods'
util = require 'util'

NAMESPACES = {
  'soap-enc' : 'http://schemas.xmlsoap.org/soap/encoding/',
  'soap-env' : 'http://schemas.xmlsoap.org/soap/envelope/',
  'xsd' : 'http://www.w3.org/2001/XMLSchema',
  'xsi' : 'http://www.w3.org/2001/XMLSchema-instance',
  'cwmp' : 'urn:dslforum-org:cwmp-1-0',
}


createSoapDocument = (id) ->
  xml = libxmljs.Document()
  env = xml.node('soap-env:Envelope')
  for prefix, url of NAMESPACES
    env.defineNamespace prefix, url

  header = env.node('soap-env:Header')
  header.node('cwmp:ID').attr({'soap-env:mustUnderstand' : 1}).text(id)
  body = env.node('soap-env:Body')
  return xml


createDevice = (serial) ->
  device = JSON.parse(JSON.stringify(deviceTemplate))
  device['InternetGatewayDevice.DeviceInfo.SerialNumber'][1] = serial
  return device


sendRequest = (device,xml, callback) ->
  headers = {}
  if xml?
    body = xml.toString()
  else
    body = ''

  headers['Content-Length'] = body.length
  headers['Content-Type'] = 'text/xml; charset="utf-8"'

  if device.Cookies?
    headers['Cookie'] = device['Cookies']

  options = {
    hostname: 'localhost',
    port: 7547,
    path: '/',
    method: 'POST',
    headers: headers
  }

  request = http.request(options, (response) ->
    chunks = []
    bytes = 0
    response.on('data', (chunk) ->
      chunks.push(chunk)
      bytes += chunk.length
    )
    response.on('end', () ->
      body = new Buffer(bytes)
      offset = 0
      chunks.forEach((chunk) ->
        chunk.copy(body, offset, 0, chunk.length)
        offset += chunk.length
      )

      if +response.headers['Content-Length'] > 0 or body.length > 0
        xml = libxmljs.parseXml(body)
      else
        xml = null

      if response.headers['set-cookie']?
        # TODO set individual cookies
        device['Cookies'] = [true, response.headers['set-cookie'], 'string']

      callback(xml)
    )
  )
  request.end(body)


startSession = (device) ->
  xmlOut = createSoapDocument(0)
  methods.inform(device, xmlOut, (xml) ->
    sendRequest(device, xml, (xml) ->
      if not xml?
        console.log('No inform response, trying again in 10 seconds.')
        setTimeout(() ->
          startSession(device)
        , 10000)
        return
      sendRequest(device, null, (xml) ->
        handleMethod(device, xml)
      )
    )
  )


createFaultResponse = (xmlOut, code, message) ->
  body = xmlOut.root().childNodes()[1]

  soapFault = body.node('soap-env:Fault')
  soapFault.node('faultcode').text('Client')
  soapFault.node('faultstring').text('CWMP fault')

  fault = soapFault.node('detail').node('cwmp:Fault')
  fault.node('FaultCode').text(code)
  fault.node('FaultString').text(message)


handleMethod = (device, xml) ->
  if not xml?
    setTimeout(() ->
      startSession(device)
    , 1000 * parseInt(device['InternetGatewayDevice.ManagementServer.PeriodicInformInterval'][1]))
    return

  requestId = xml.get('/soap-env:Envelope/soap-env:Header/cwmp:ID', NAMESPACES).text()

  xmlOut = createSoapDocument(requestId)

  element = xml.get('/soap-env:Envelope/soap-env:Body/cwmp:*', NAMESPACES)
  method = methods[element.name()]

  if method?
    methods[element.name()](device, xml, xmlOut, (xml) ->
      sendRequest(device, xml, (xml) ->
        handleMethod(device, xml)
      )
    )
  else
    createFaultResponse(xmlOut, 9000, 'Method not supported')
    sendRequest(device, xmlOut, (xml) ->
      handleMethod(device, xml)
    )


cluster = require 'cluster'

NUM_WORKERS = 1
NUM_DEVICES = 1

if cluster.isMaster
  for i in [0 ... NUM_WORKERS]
    cluster.fork({SERIAL_PREFIX : i})
else
  for i in [0...NUM_DEVICES]
    serial = process.env.SERIAL_PREFIX + ("00000#{i}".slice(-6))
    device = createDevice(serial)
    do (device) ->
      setTimeout(() ->
        startSession(device)
      , i * 100)
