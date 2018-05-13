###
# Copyright 2013-2017  Zaid Abdulla
#
# This file is part of GenieACS.
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

crypto = require 'crypto'


exports.parseAuthHeader = (authHeader) ->
  authHeader = authHeader.trim()
  method = authHeader.split(' ', 1)[0]
  res = {method: method}
  parts = authHeader.slice(method.length + 1).split(',')

  while (part = parts.shift())?
    name = part.split('=', 1)[0]
    throw new Error('Unable to parse auth header') if name.length == part.length
    value = part.slice(name.length + 1)
    if not /^\s*"/.test(value)
      value = value.trim()
    else
      while not /[^\\]"\s*$/.test(value)
        p = parts.shift()
        throw new Error('Unable to parse auth header') if not p?
        value += ',' + p

      try
        value = JSON.parse(value)
      catch
        throw new Error('Unable to parse auth header')

    res[name.trim()] = value

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
  authString += ",qop=#{qop},nc=#{nc},cnonce=\"#{cnonce}\"" if qop?
  authString += ",response=\"#{response}\""
  authString += ",opaque=\"#{authHeader.opaque}\"" if authHeader.opaque?
  return authString
