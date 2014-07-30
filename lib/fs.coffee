###
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
url = require 'url'
mongodb = require 'mongodb'
querystring = require 'querystring'
db = require './db'


listener = (request, response) ->
  urlParts = url.parse(request.url, true)
  if request.method == 'GET'
    filename = querystring.unescape(urlParts.pathname.substring(1))
    gs = new mongodb.GridStore(db.mongoDb, filename, 'r', {})
    gs.open((err, gs) ->
      if err
        response.writeHead(404)
        response.end()
        return
      stream = gs.stream(true)
      response.writeHead(200, {'Content-Type' : 'application/octet-stream', 'Content-Length' : gs.length})
      stream.pipe(response)
    )
  else
    response.writeHead(405, {'Allow': 'GET'})
    response.end('405 Method Not Allowed')


exports.listener = listener
