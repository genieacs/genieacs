config = require './config'
libxmljs = require 'libxmljs'

SERVER_NAME = "GenieACS/#{require('../package.json').version}"

NAMESPACES = {
  '1.0' : {
    'soap-enc' : 'http://schemas.xmlsoap.org/soap/encoding/',
    'soap-env' : 'http://schemas.xmlsoap.org/soap/envelope/',
    'xsd' : 'http://www.w3.org/2001/XMLSchema',
    'xsi' : 'http://www.w3.org/2001/XMLSchema-instance',
    'cwmp' : 'urn:dslforum-org:cwmp-1-0'
  },
  '1.1' : {
    'soap-enc' : 'http://schemas.xmlsoap.org/soap/encoding/',
    'soap-env' : 'http://schemas.xmlsoap.org/soap/envelope/',
    'xsd' : 'http://www.w3.org/2001/XMLSchema',
    'xsi' : 'http://www.w3.org/2001/XMLSchema-instance',
    'cwmp' : 'urn:dslforum-org:cwmp-1-1'
  },
  '1.2' : {
    'soap-enc' : 'http://schemas.xmlsoap.org/soap/encoding/',
    'soap-env' : 'http://schemas.xmlsoap.org/soap/envelope/',
    'xsd' : 'http://www.w3.org/2001/XMLSchema',
    'xsi' : 'http://www.w3.org/2001/XMLSchema-instance',
    'cwmp' : 'urn:dslforum-org:cwmp-1-2'
  },
  '1.3' : {
    'soap-enc' : 'http://schemas.xmlsoap.org/soap/encoding/',
    'soap-env' : 'http://schemas.xmlsoap.org/soap/envelope/',
    'xsd' : 'http://www.w3.org/2001/XMLSchema',
    'xsi' : 'http://www.w3.org/2001/XMLSchema-instance',
    'cwmp' : 'urn:dslforum-org:cwmp-1-2'
  },
  '1.4' : {
    'soap-enc' : 'http://schemas.xmlsoap.org/soap/encoding/',
    'soap-env' : 'http://schemas.xmlsoap.org/soap/envelope/',
    'xsd' : 'http://www.w3.org/2001/XMLSchema',
    'xsi' : 'http://www.w3.org/2001/XMLSchema-instance',
    'cwmp' : 'urn:dslforum-org:cwmp-1-3'
  }
}


# Workaround for devices that don't use correct namespace declarations or prefixes
if config.IGNORE_XML_NAMESPACES
  libxmljs.Element.prototype.__find = libxmljs.Element.prototype.find
  libxmljs.Element.prototype.find = (xpath, namespaces) ->
    # Modify xpath queries to work regardless of element's namespace
    p = xpath.replace(/([^\/:]+:)?([^\/]+)(\/|$)/g, '$2$3') \
      .replace(/([a-zA-Z0-9_-]+)([^\/]*)(\/|$)/g, "*[local-name()='$1']$2$3")
    libxmljs.Element.prototype.__find.call(this, p, namespaces)


# Separation by comma is important as some devices don't comform to standard
COOKIE_REGEX = /\s*([a-zA-Z0-9\-_]+?)\s*=\s*"?([a-zA-Z0-9\-_]*?)"?\s*(,|;|$)/g

cookieEncode = (value) ->
  new Buffer(value).toString('base64').replace(/\/|\+|\=/g, (c) -> if c is '/' then '_' else if c is '+' then '-' else '')

cookieDecode = (encodedValue) ->
  new Buffer(encodedValue, 'base64').toString()

cookiesToObj = (cookieLine) ->
  cookies = {}
  while match = COOKIE_REGEX.exec(cookieLine)
    cookies[cookieDecode(match[1])] = cookieDecode(match[2])
  return cookies

cookiesToStr = (obj) ->
  "#{cookieEncode(cn)}=#{cookieEncode(cv)}" for cn, cv of obj


event = (xml) ->
  e.text().trim() for e in xml.find('EventStruct/EventCode')


parameterInfoList = (xml) ->
  infoList = []
  for e in xml.find('ParameterInfoStruct')
    name = e.get('Name').text().trim()
    writable = Boolean(JSON.parse(e.get('Writable').text()))
    infoList.push([name, writable])
  return infoList


parameterValueList = (xml) ->
  valueList = []
  for e in xml.find('ParameterValueStruct')
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
    el.node('string').text(p)


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


acsInform = (xml) ->
  {
    parameterList : parameterValueList(xml.get('ParameterList')),
    deviceId : traverseXml(xml.get('DeviceId')),
    event : event(xml.get('Event')),
    retryCount : JSON.parse(xml.get('RetryCount').text())
  }


acsInformResponse = (xml, methodResponse) ->
  xml.node('cwmp:InformResponse').node('MaxEnvelopes').text(1)


acsGetRPCMethods = (xml) ->
  {}


acsGetRPCMethodsResponse = (xml, methodResponse) ->
  el = xml.node('cwmp:GetRPCMethodsResponse').node('MethodList')
  el.attr({'soap-enc:arrayType' : "xsd:string[#{methodResponse.methodList.length}]"})
  for m in methodResponse.methodList
    el.node('string').text(m)


acsTransferComplete = (xml) ->
  {
    commandKey : xml.get('CommandKey').text(),
    faultStruct : traverseXml(xml.get('FaultStruct')),
    startTime : xml.get('StartTime').text(), # TODO convert to datetime
    completeTime : xml.get('CompleteTime').text() # TODO convert to datetime
  }


acsTransferCompleteResponse = (xml, methodResponse) ->
  xml.node('cwmp:TransferCompleteResponse').text('')


acsRequestDownload = (xml) ->
  # TODO FileTypeArg
  {
    fileType : xml.get('FileType').text()
  }


acsRequestDownloadResponse = (xml, methodResponse) ->
  xml.node('cwmp:RequestDownloadResponse').text('')


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


exports.request = (httpRequest) ->
  cwmpRequest = {cookies: {}}
  cwmpRequest.cookies = cookiesToObj(httpRequest.headers.cookie) if httpRequest.headers.cookie
  cwmpRequest.cwmpVersion = cwmpRequest.cookies.cwmpVersion

  data = httpRequest.getBody()

  if data.length > 0
    xml = libxmljs.parseXml(data, config.LIBXMLJS_OPTIONS)

    if not cwmpRequest.cwmpVersion?
      # cwmpVersion doesn't exist in cookies, thus it's an inform request
      methodElement = xml.get('/soap-env:Envelope/soap-env:Body/*', NAMESPACES['1.0'])
      switch methodElement.namespace().href()
        when 'urn:dslforum-org:cwmp-1-0'
          cwmpRequest.cwmpVersion = '1.0'
        when 'urn:dslforum-org:cwmp-1-1'
          cwmpRequest.cwmpVersion = '1.1'
        when 'urn:dslforum-org:cwmp-1-2'
          cwmpRequest.sessionTimeout = try xml.get('/soap-env:Envelope/soap-env:Header/cwmp:sessionTimeout', NAMESPACES['1.2']).text() catch then null
          if cwmpRequest.sessionTimeout?
            cwmpRequest.cwmpVersion = '1.3'
          else
            cwmpRequest.cwmpVersion = '1.2'
        when 'urn:dslforum-org:cwmp-1-3'
          cwmpRequest.cwmpVersion = '1.4'
        else
          throw new Error('Unrecognized CWMP version')

      cwmpRequest.sessionTimeout ?= try xml.get('/soap-env:Envelope/soap-env:Header/cwmp:sessionTimeout', NAMESPACES[cwmpRequest.cwmpVersion]).text() catch then null
    else
      methodElement = xml.get('/soap-env:Envelope/soap-env:Body/cwmp:*', NAMESPACES[cwmpRequest.cwmpVersion])

    cwmpRequest.id = try xml.get('/soap-env:Envelope/soap-env:Header/cwmp:ID', NAMESPACES[cwmpRequest.cwmpVersion]).text() catch then null

    if methodElement? and not (config.IGNORE_XML_NAMESPACES and methodElement.name() is 'Fault')
      switch methodElement.name()
        when 'Inform'
          cwmpRequest.methodRequest = acsInform(methodElement)
          cwmpRequest.methodRequest.type = 'Inform'
        when 'GetRPCMethods'
          cwmpRequest.methodRequest = acsGetRPCMethods(methodElement)
          cwmpRequest.methodRequest.type = 'GetRPCMethods'
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
      faultElement = xml.get('/soap-env:Envelope/soap-env:Body/soap-env:Fault', NAMESPACES[cwmpRequest.cwmpVersion])
      cwmpRequest.fault = fault(faultElement)
    
  return cwmpRequest


createSoapEnv = (cwmpVersion) ->
  xml = libxmljs.Document()
  env = xml.node('soap-env:Envelope')
  for prefix, url of NAMESPACES[cwmpVersion]
    env.defineNamespace prefix, url
  return env


exports.response = (cwmpResponse) ->
  headers = {
    'Server' : SERVER_NAME,
    'SOAPServer' : SERVER_NAME,
  }

  if cwmpResponse?.methodResponse?
    env = createSoapEnv(cwmpResponse.cwmpVersion)
    header = env.node('soap-env:Header')
    header.node('cwmp:ID').attr({'soap-env:mustUnderstand' : 1}).text(cwmpResponse.id)
    body = env.node('soap-env:Body')
    switch cwmpResponse.methodResponse.type
      when 'InformResponse'
        cwmpResponse.cookies ?= {}
        cwmpResponse.cookies.cwmpVersion = cwmpResponse.cwmpVersion
        acsInformResponse(body, cwmpResponse.methodResponse)
      when 'GetRPCMethodsResponse'
        acsGetRPCMethodsResponse(body, cwmpResponse.methodResponse)
      when 'TransferCompleteResponse'
        acsTransferCompleteResponse(body, cwmpResponse.methodResponse)
      when 'RequestDownloadResponse'
        acsRequestDownloadResponse(body, cwmpResponse.methodResponse)
      else
        throw Error("Unknown method response type #{cwmpResponse.methodResponse.type}")
  else if cwmpResponse?.methodRequest?
    env = createSoapEnv(cwmpResponse.cwmpVersion)
    header = env.node('soap-env:Header')
    header.node('cwmp:ID').attr({'soap-env:mustUnderstand' : 1}).text(cwmpResponse.id)
    body = env.node('soap-env:Body')
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
  
  if cwmpResponse?.cookies? and Object.keys(cwmpResponse.cookies).length > 0
    headers['Set-Cookie'] = cookiesToStr(cwmpResponse.cookies)

  if env?
    headers['Content-Type'] = 'text/xml; charset="utf-8"'
    return {code: 200, headers: headers, data: new Buffer(env.doc().toString(false))}
  else
    return {code: 204, headers: headers, data: new Buffer(0)}
