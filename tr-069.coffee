libxmljs = require 'libxmljs'

SERVER_NAME = 'Genie/0.1'

NAMESPACES = {
  'soap-enc' : 'http://schemas.xmlsoap.org/soap/encoding/',
  'soap-env' : 'http://schemas.xmlsoap.org/soap/envelope/',
  'xsd' : 'http://www.w3.org/2001/XMLSchema',
  'xsi' : 'http://www.w3.org/2001/XMLSchema-instance',
  'cwmp' : 'urn:dslforum-org:cwmp-1-0',
}


cookiesToObj = (cookieLine) ->
  cookies = {}
  for c in cookieLine.trim().split ','
    nv = c.split '='
    continue if nv.length < 2
    cookies[nv[0].trim()] = nv[1].trim()
  return cookies


cookiesToStr = (obj) ->
  l = []
  for cn, cv of obj
    l.push("#{cn}=#{cv}")
  return l# + 'path=/'


event = (xml) ->
  e.text().trim() for e in xml.find('EventStruct/EventCode', NAMESPACES)


parameterInfoList = (xml) ->
  infoList = []
  for e in xml.find('ParameterInfoStruct', NAMESPACES)
    name = e.get('Name').text().trim()
    writable = Boolean(JSON.parse(e.get('Writable').text()))
    infoList.push([name, writable])
  return infoList


parameterValueList = (xml) ->
  valueList = []
  for e in xml.find('ParameterValueStruct', NAMESPACES)
    valueType = e.get('Value').attr('type').value().trim()
    name = e.get('Name').text().trim()
    value = e.get('Value').text().trim()
    switch valueType
      when 'xsd:boolean'
        value = Boolean(JSON.parse(value))
      when 'xsd:unsignedInt'
        value = JSON.parse(value)
    valueList.push([name, value])
  return valueList


cpeGetParameterNames = (xml, methodRequest) ->
  el = xml.node('cwmp:GetParameterNames')
  el.node('cwmp:ParameterPath').text(methodRequest.parameterPath)
  el.node('cwmp:NextLevel').text(+methodRequest.nextLevel)


cpeGetParameterNamesResponse = (xml) ->
  {parameterList : parameterInfoList(xml.get('ParameterList'))}


cpeGetParameterValues = (xml, methodRequest) ->
  el = xml.node('cwmp:GetParameterValues').node('cwmp:ParameterNames')
  for p in methodRequest.parameterNames
    el.node('xsd:string').text(p)


cpeGetParameterValuesResponse = (xml) ->
  {parameterList : parameterValueList(xml.get('ParameterList'))}


cpeSetParameterValues = (xml, methodRequest) ->
  el = xml.node('cwmp:SetParameterValues')
  paramList = el.node('ParameterList')
  for i in methodRequest.parameterList
    pvs = paramList.node('ParameterValueStruct')
    pvs.node('Name').text(i[0])
    pvs.node('Value').text(i[1])
  # Huawei CPEs need this element present otherwise won't respond
  el.node('ParameterKey').text(if methodRequest.parameterKey? then methodRequest.parameterKey else '')


cpeSetParameterValuesResponse = (xml) ->
  {status : JSON.parse(xml.get('Status').text())}


traverseXml = (xml) ->
  obj = {}
  for n in xml.childNodes()
    if n.type() == 'element'
      obj[n.name()] = traverseXml(n)

  if Object.keys(obj).length == 0
    xml.text()
  else
    obj

fault = (xml) ->
  return traverseXml(xml)


acsInform = (xml) ->
  {
    parameterList : parameterValueList(xml.get('ParameterList')),
    deviceId : traverseXml(xml.get('DeviceId')),
    event : event(xml.get('Event')),
    retryCount : JSON.parse(xml.get('RetryCount').text())
  }


acsInformResponse = (xml) ->
  xml.node('cwmp:InformResponse').node('MaxEnvelopes').text(1)


cpeReboot = (xml, methodRequest) ->
  el = xml.node('cwmp:Reboot')
  # Huawei CPEs need this element present otherwise won't respond
  el.node('CommandKey').text(if methodRequest.commandKey then methodRequest.commandKey else '')


cpeRebootResponse = (xml) ->
  {}


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

    cwmpRequest.id = xml.get('//soap-env:Envelope/soap-env:Header/cwmp:ID', NAMESPACES).text()

    methodElement = xml.get('/soap-env:Envelope/soap-env:Body/cwmp:*', NAMESPACES)
    if methodElement?
      switch methodElement.name()
        when 'Inform'
          cwmpRequest.methodRequest = acsInform(methodElement)
          cwmpRequest.methodRequest.type = 'Inform'
        when 'GetParameterNamesResponse'
          cwmpRequest.methodResponse = cpeGetParameterNamesResponse(methodElement)
          cwmpRequest.methodResponse.type = 'GetParameterNamesResponse'
        when 'GetParameterValuesResponse'
          cwmpRequest.methodResponse = cpeGetParameterValuesResponse(methodElement)
          cwmpRequest.methodResponse.type = 'GetParameterValuesResponse'
        when 'SetParameterValuesResponse'
          cwmpRequest.methodResponse = cpeSetParameterValuesResponse(methodElement)
          cwmpRequest.methodResponse.type = 'SetParameterValuesResponse'
        when 'RebootResponse'
          cwmpRequest.methodResponse = cpeRebootResponse(methodElement)
          cwmpRequest.methodResponse.type = 'RebootResponse'
        else
          throw Error('8000 Method not supported')
    else
      faultElement = xml.get('/soap-env:Envelope/soap-env:Body/soap-env:Fault', NAMESPACES)
      cwmpRequest.fault = fault(faultElement)
    
  return cwmpRequest


exports.response = (id, cwmpResponse, cookies = null) ->
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
  header.node('cwmp:ID').attr({'soap-env:mustUnderstand' : 1}).text(id)
  body = env.node('soap-env:Body')

  if cwmpResponse.methodResponse?
    switch cwmpResponse.methodResponse.type
      when 'InformResponse'
        acsInformResponse(body)
      else
        throw Error("Unknown method response type #{cwmpResponse.methodResponse.type}")
  else if cwmpResponse.methodRequest?
    switch cwmpResponse.methodRequest.type
      when 'GetParameterNames'
        cpeGetParameterNames(body, cwmpResponse.methodRequest)
      when 'GetParameterValues'
        cpeGetParameterValues(body, cwmpResponse.methodRequest)
      when 'SetParameterValues'
        cpeSetParameterValues(body, cwmpResponse.methodRequest)
      when 'Reboot'
        cpeReboot(body, cwmpResponse.methodRequest)
      else
        throw Error("Unknown method request #{cwmpResponse.methodRequest.type}")
  else
    throw Error('Invalid response arguments')
  
  data = xml.toString()
  headers['Content-Length'] = data.length

  return {code: 200, headers: headers, data: data}
