crypto = require 'crypto'


exports.parseAuthHeader = (authHeader) ->
  res = {}
  i = authHeader.indexOf(' ')
  res['method'] = authHeader.slice(0, i)

  options = authHeader.slice(i + 1)
  regex = /([a-z]+)="([a-zA-Z0-9\/\.@\-,=]+)"/g
  while (r = regex.exec(options)) != null
    res[r[1]] = r[2]

  regex = /([a-z]+)=([a-zA-Z0-9\/\.@\-]+)/g
  while (r = regex.exec(options)) != null
    res[r[1]] = r[2]
  return res


exports.basic = (username, password) ->
  "Basic #{new Buffer("#{username}:#{password}").toString('base64')}"


exports.digest = (username, password, uri, httpMethod, body, authHeader) ->
  cnonce = '0a4f113b'
  nc = '00000001'

  if authHeader.qop?
    if authHeader.qop.indexOf(',') != -1
      qop = 'auth' # either auth or auth-int. prefer auth
    else
      qop = authHeader.qop

  ha1 = crypto.createHash('md5')
  ha1.update(username).update(':').update(authHeader.realm).update(':').update(password)
  # TODO support "MD5-sess" algorithm directive
  ha1 = ha1.digest('hex')

  ha2 = crypto.createHash('md5')
  ha2.update(httpMethod).update(':').update(uri)
  if qop == 'auth-int'
    ha2.update(':').update(body)
  ha2 = ha2.digest('hex')

  response = crypto.createHash('md5')
  response.update(ha1).update(':').update(authHeader.nonce)

  if qop?
    response.update(':').update(nc).update(':').update(cnonce).update(':').update(qop)
  response.update(':').update(ha2)
  response = response.digest('hex')

  authString = "Digest username=\"#{username}\""
  authString += ",realm=\"#{authHeader.realm}\""
  authString += ",nonce=\"#{authHeader.nonce}\""
  authString += ",uri=\"#{uri}\""
  authString += ",algorithm=#{authHeader.algorithm}" if authHeader.algorithm?
  authString += ",qop=#{qop}"
  authString += ",nc=#{nc}"
  authString += ",cnonce=\"#{cnonce}\""
  authString += ",response=\"#{response}\""
  authString += ",opaque=\"#{authHeader.opaque}\""
  return authString
