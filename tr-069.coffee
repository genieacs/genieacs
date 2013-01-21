libxmljs = require 'libxmljs'

SERVER_NAME = 'Genie/0.1'

NAMESPACES = {
  'soap-enc' : 'http://schemas.xmlsoap.org/soap/encoding/',
  'soap-env' : 'http://schemas.xmlsoap.org/soap/envelope/',
  'xsd' : 'http://www.w3.org/2001/XMLSchema',
  'xsi' : 'http://www.w3.org/2001/XMLSchema-instance',
  'cwmp' : 'urn:dslforum-org:cwmp-1-0',
}

trim = (str) ->
  str.replace /^\s+|\s+$/g, ''


cookiesToObj = (cookieLine) ->
  cookies = {}
  for c in trim(cookieLine).split ','
    nv = c.split '='
    continue if nv.length < 2
    cookies[trim(nv[0])] = trim(nv[1])
  return cookies


cookiesToStr = (obj) ->
  l = []
  for cn, cv of obj
    l.push("#{cn}=#{cv}")
  return l# + 'path=/'


sessionId = (xml) ->
  e = xml.get('//soap-env:Envelope/soap-env:Header/cwmp:ID', NAMESPACES)
  if e?
    return trim(e.text())
  return undefined


deviceId = (xml) ->
  e = xml.get('//soap-env:Envelope/soap-env:Body/cwmp:Inform/DeviceId', NAMESPACES)
  if e?
    id = {}
    for n in e.find('//child::*')
      id[n.name()] = trim(n.text())
    return id
  return undefined


eventCodes = (xml) ->
  (trim(e.text()) for e in xml.find('//soap-env:Envelope/soap-env:Body/cwmp:Inform/Event/EventStruct/EventCode', NAMESPACES))


retryCount = (xml) ->
  e = xml.get('//soap-env:Envelope/soap-env:Body/cwmp:Inform/RetryCount', NAMESPACES)
  if e
    return JSON.parse(e.text())
  return undefined


informParameterValues = (xml) ->
  if not xml.get( '//soap-env:Envelope/soap-env:Body/cwmp:Inform/ParameterList', NAMESPACES)
    return undefined

  values = []
  for e in xml.find('//soap-env:Envelope/soap-env:Body/cwmp:Inform/ParameterList/ParameterValueStruct', NAMESPACES)
    valueType = trim(e.get('Value').attr('type').value())
    name = trim(e.get('Name').text())
    switch valueType
      when 'xsd:boolean'
        value = Boolean(JSON.parse(e.get('Value').text()))
      when 'xsd:unsignedInt'
        value = JSON.parse(e.get('Value').text())
      else
        value = trim(e.get('Value').text())

    values.push([name, value])
  return values


getParameterNamesResponse = (xml) ->
  if not xml.get('//soap-env:Envelope/soap-env:Body/cwmp:GetParameterNamesResponse', NAMESPACES)
    return undefined

  response = []
  for e in xml.find('//soap-env:Envelope/soap-env:Body/cwmp:GetParameterNamesResponse/ParameterList/ParameterInfoStruct', NAMESPACES)
    name = trim(e.get('Name').text())
    writable = Boolean(JSON.parse(e.get('Writable').text()))
    response.push([name, writable])
  return response


getParameterValuesResponse = (xml) ->
  if not xml.get( '//soap-env:Envelope/soap-env:Body/cwmp:GetParameterValuesResponse', NAMESPACES)
    return undefined

  values = []
  for e in xml.find('//soap-env:Envelope/soap-env:Body/cwmp:GetParameterValuesResponse/ParameterList/ParameterValueStruct', NAMESPACES)
    valueType = trim(e.get('Value').attr('type').value())
    name = trim(e.get('Name').text())
    switch valueType
      when 'xsd:boolean'
        value = Boolean(JSON.parse(e.get('Value').text()))
      when 'xsd:unsignedInt'
        value = JSON.parse(e.get('Value').text())
      else
        value = trim(e.get('Value').text())

    values.push([name, value])
  return values


setParameterValuesResponse = (xml) ->
  e = xml.get('//soap-env:Envelope/soap-env:Body/cwmp:SetParameterValuesResponse/Status', NAMESPACES)
  if e
    return JSON.parse(e.text())
  return undefined

fault = (xml) ->
  f = xml.get('//soap-env:Envelope/soap-env:Body/soap-env:Fault', NAMESPACES)
  if f
    traverse = (el) ->
      children = el.childNodes()
      obj = {}
      for n in el.childNodes()
        if n.type() == 'element'
          obj[n.name()] = traverse(n)
      if Object.keys(obj).length == 0
        return el.text()
      else
        return obj

    return traverse(f)
  return undefined


exports.request = (httpRequest) ->
  cwmpRequest = {cookies: {}}
  cwmpRequest.cookies = cookiesToObj(httpRequest.headers.cookie) if httpRequest.headers.cookie

  data = httpRequest.getBody()

  if +httpRequest.headers['Content-Length'] > 0 || data.length > 0
    try
      xml = libxmljs.parseXml data
    catch err
      # some devices send invalid utf8 characters
      xml = libxmljs.parseXml httpRequest.getBody('binary')

    cwmpRequest.sessionId = sessionId xml
    cwmpRequest.inform = true if xml.get('//soap-env:Envelope/soap-env:Body/cwmp:Inform', NAMESPACES)
    cwmpRequest.informParameterValues = informParameterValues xml
    cwmpRequest.reboot = true if xml.get('//soap-env:Envelope/soap-env:Body/cwmp:RebootResponse', NAMESPACES)
    cwmpRequest.deviceId = deviceId xml
    cwmpRequest.eventCodes = eventCodes xml
    cwmpRequest.retryCount = retryCount xml
    cwmpRequest.getParameterNamesResponse = getParameterNamesResponse xml
    cwmpRequest.getParameterValuesResponse = getParameterValuesResponse xml
    cwmpRequest.setParameterValuesResponse = setParameterValuesResponse xml
    cwmpRequest.fault = fault xml
  return cwmpRequest


exports.response = (sessionId, cwmpResponse, cookies = null) ->
  headers = {
    'Content-Type' : 'text/xml; charset="utf-8"',
    'Server' : SERVER_NAME,
    'SOAPServer' : SERVER_NAME,
  }

  if cookies? and Object.keys(cookies).length > 0
    headers['Set-Cookie'] = cookiesToStr(cookies)

  if cwmpResponse is null or Object.keys(cwmpResponse).length == 0
    #console.log '>>> EMPTY RESPONSE'
    # send empty response
    headers['Content-Length'] = 0
    return {code: 204, headers: headers, data: ''}

  xml = libxmljs.Document()
  env = xml.node('soap-env:Envelope')
  for prefix, url of NAMESPACES
    env.defineNamespace prefix, url

  header = env.node('soap-env:Header')
  header.node('cwmp:ID').attr({'soap-env:mustUnderstand' : 1}).text(sessionId)
  #header.node('cwmp:NoMoreRequests').text(0) # depracated
  body = env.node('soap-env:Body')

  if cwmpResponse.inform
    body.node('cwmp:InformResponse').node('MaxEnvelopes').text(1)

  if cwmpResponse.getParameterNames?
    getParameterNames = body.node('cwmp:GetParameterNames')
    getParameterNames.node('cwmp:ParameterPath').text(cwmpResponse.getParameterNames[0])
    getParameterNames.node('cwmp:NextLevel').text(+cwmpResponse.getParameterNames[1])

  if cwmpResponse.getParameterValues?
    parameterNames = body.node('cwmp:GetParameterValues').node('cwmp:ParameterNames')
    for p in cwmpResponse.getParameterValues
      parameterNames.node('xsd:string').text(p)

  if cwmpResponse.setParameterValues?
    setParameterValuesNode = body.node('cwmp:SetParameterValues')
    parameterList = setParameterValuesNode.node('ParameterList')
    for i in cwmpResponse.setParameterValues
      pvs = parameterList.node('ParameterValueStruct')
      pvs.node('Name').text(i[0])
      pvs.node('Value').text(i[1])
    setParameterValuesNode.node('ParameterKey')

  if cwmpResponse.reboot?
    body.node('cwmp:Reboot').node('CommandKey').text(cwmpResponse.reboot)

  
  data = xml.toString()
  headers['Content-Length'] = data.length

  return {code: 200, headers: headers, data: data}
