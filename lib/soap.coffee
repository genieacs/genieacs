libxmljs = require 'libxmljs'

SERVER_NAME = "GenieACS/#{require('../package.json').version}"

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
    try
      switch valueType
        when 'xsd:boolean'
          value = Boolean(JSON.parse(value))
        when 'xsd:unsignedInt'
          value = JSON.parse(value)
        when 'xsd:int'
          value = JSON.parse(value)
    catch err
      value = null
    valueList.push([name, value, valueType])
  return valueList


cpeGetParameterNames = (xml, methodRequest) ->
  el = xml.node('cwmp:GetParameterNames')
  el.node('ParameterPath').text(methodRequest.parameterPath)
  el.node('NextLevel').text(+methodRequest.nextLevel)


cpeGetParameterNamesResponse = (xml) ->
  {parameterList : parameterInfoList(xml.get('ParameterList'))}


cpeGetParameterValues = (xml, methodRequest) ->
  el = xml.node('cwmp:GetParameterValues').node('ParameterNames')
  el.attr({'soap-enc:arrayType' : "xsd:string[#{methodRequest.parameterNames.length}]"})
  for p in methodRequest.parameterNames
    el.node('xsd:string').text(p)


cpeGetParameterValuesResponse = (xml) ->
  {parameterList : parameterValueList(xml.get('ParameterList'))}


cpeSetParameterValues = (xml, methodRequest) ->
  el = xml.node('cwmp:SetParameterValues')
  paramList = el.node('ParameterList')
  paramList.attr({'soap-enc:arrayType' : "cwmp:ParameterValueStruct[#{methodRequest.parameterList.length}]"})
  for i in methodRequest.parameterList
    pvs = paramList.node('ParameterValueStruct')
    pvs.node('Name').text(i[0])
    v = pvs.node('Value')
    v.text(i[1])
    v.attr({'xsi:type' : i[2]}) if i[2]?
  el.node('ParameterKey').text(methodRequest.parameterKey ? '')


cpeSetParameterValuesResponse = (xml) ->
  {status : JSON.parse(xml.get('Status').text())}


cpeAddObject = (xml, methodRequest) ->
  el = xml.node('cwmp:AddObject')
  el.node('ObjectName').text(methodRequest.objectName)
  el.node('ParameterKey').text(methodRequest.parameterKey ? '')


cpeAddObjectResponse = (xml) ->
  {
    instanceNumber : parseInt(xml.get('InstanceNumber').text()),
    status : parseInt(xml.get('Status').text())
  }


cpeDeleteObject = (xml, methodRequest) ->
  el = xml.node('cwmp:DeleteObject')
  el.node('ObjectName').text(methodRequest.objectName)
  el.node('ParameterKey').text(methodRequest.parameterKey ? '')


cpeDeleteObjectResponse = (xml) ->
  {status : parseInt(xml.get('Status').text())}


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
  el.node('CommandKey').text(methodRequest.commandKey ? '')


cpeRebootResponse = (xml) ->
  {}


cpeFactoryReset = (xml, methodRequest) ->
  el = xml.node('cwmp:FactoryReset')


cpeFactoryResetResponse = (xml, methodRequest) ->
  {}


cpeDownload = (xml, methodRequest) ->
  el = xml.node('cwmp:Download')
  el.node('CommandKey').text(methodRequest.commandKey ? '')
  el.node('FileType').text(methodRequest.fileType)
  el.node('URL').text(methodRequest.url)
  el.node('Username').text(methodRequest.username ? '')
  el.node('Password').text(methodRequest.password ? '')
  el.node('FileSize').text(methodRequest.fileSize ? '0')
  el.node('TargetFileName').text(methodRequest.TargetFileName ? '')
  el.node('DelaySeconds').text(methodRequest.delaySeconds ? '0')
  el.node('SuccessURL').text(methodRequest.successUrl ? '')
  el.node('FailureURL').text(methodRequest.failureUrl ? '')


cpeDownloadResponse = (xml) ->
  {status : JSON.parse(xml.get('Status').text())}


acsTransferComplete = (xml) ->
  {
    commandKey : xml.get('CommandKey').text(),
    faultStruct : traverseXml(xml.get('FaultStruct')),
    startTime : xml.get('StartTime').text(), # TODO convert to datetime
    completeTime : xml.get('CompleteTime').text() # TODO convert to datetime
  }


acsTransferCompleteResponse = (xml, methodRequest) ->
  xml.node('cwmp:TransferCompleteResponse').text('')


acsRequestDownload = (xml) ->
  # TODO FileTypeArg
  {
    fileType : xml.get('FileType').text()
  }


acsRequestDownloadResponse = (xml, methodRequest) ->
  xml.node('cwmp:RequestDownloadResponse').text('')


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

    try
      cwmpRequest.id = xml.get('//soap-env:Envelope/soap-env:Header/cwmp:ID', NAMESPACES).text()
    catch err
      cwmpRequest.id = null

    methodElement = xml.get('/soap-env:Envelope/soap-env:Body/cwmp:*', NAMESPACES)
    if methodElement?
      switch methodElement.name()
        when 'Inform'
          cwmpRequest.methodRequest = acsInform(methodElement)
          cwmpRequest.methodRequest.type = 'Inform'
        when 'TransferComplete'
          cwmpRequest.methodRequest = acsTransferComplete(methodElement)
          cwmpRequest.methodRequest.type = 'TransferComplete'
        when 'RequestDownload'
          cwmpRequest.methodRequest = acsRequestDownload(methodElement)
          cwmpRequest.methodRequest.type = 'RequestDownload'
        when 'GetParameterNamesResponse'
          cwmpRequest.methodResponse = cpeGetParameterNamesResponse(methodElement)
          cwmpRequest.methodResponse.type = 'GetParameterNamesResponse'
        when 'GetParameterValuesResponse'
          cwmpRequest.methodResponse = cpeGetParameterValuesResponse(methodElement)
          cwmpRequest.methodResponse.type = 'GetParameterValuesResponse'
        when 'SetParameterValuesResponse'
          cwmpRequest.methodResponse = cpeSetParameterValuesResponse(methodElement)
          cwmpRequest.methodResponse.type = 'SetParameterValuesResponse'
        when 'AddObjectResponse'
          cwmpRequest.methodResponse = cpeAddObjectResponse(methodElement)
          cwmpRequest.methodResponse.type = 'AddObjectResponse'
        when 'DeleteObjectResponse'
          cwmpRequest.methodResponse = cpeDeleteObjectResponse(methodElement)
          cwmpRequest.methodResponse.type = 'DeleteObjectResponse'
        when 'RebootResponse'
          cwmpRequest.methodResponse = cpeRebootResponse(methodElement)
          cwmpRequest.methodResponse.type = 'RebootResponse'
        when 'FactoryResetResponse'
          cwmpRequest.methodResponse = cpeFactoryResetResponse(methodElement)
          cwmpRequest.methodResponse.type = 'FactoryResetResponse'
        when 'DownloadResponse'
          cwmpRequest.methodResponse = cpeDownloadResponse(methodElement)
          cwmpRequest.methodResponse.type = 'DownloadResponse'
        else
          throw Error('8000 Method not supported ' + methodElement.name())
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

  if not cwmpResponse? or Object.keys(cwmpResponse).length == 0
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
      when 'TransferCompleteResponse'
        acsTransferCompleteResponse(body)
      when 'RequestDownloadResponse'
        acsRequestDownloadResponse(body)
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
      when 'AddObject'
        cpeAddObject(body, cwmpResponse.methodRequest)
      when 'DeleteObject'
        cpeDeleteObject(body, cwmpResponse.methodRequest)
      when 'Reboot'
        cpeReboot(body, cwmpResponse.methodRequest)
      when 'FactoryReset'
        cpeFactoryReset(body, cwmpResponse.methodRequest)
      when 'Download'
        cpeDownload(body, cwmpResponse.methodRequest)
      else
        throw Error("Unknown method request #{cwmpResponse.methodRequest.type}")
  else
    throw Error('Invalid response arguments')
  
  data = xml.toString()
  headers['Content-Length'] = data.length

  return {code: 200, headers: headers, data: data}
