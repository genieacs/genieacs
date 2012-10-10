http = require 'http'
fs = require 'fs'

TEMPLATE_SERIAL = '8KA8WA1151100043'
TEMPLATE_TASKID = '50731c1bfb2b97e764000001'

templates = []
for i in [0..48]
  templates.push(JSON.parse(fs.readFileSync("test/#{i}.json")))

sendRequest = (serial, taskId, seq = 0) ->
  if seq >= templates.length
    t = new Date()
    console.log("Finished #{serial} at #{t}")
    return
  headers = JSON.parse(JSON.stringify(templates[seq][0]))
  if headers.cookie?
    headers.cookie = headers.cookie.replace(TEMPLATE_TASKID, taskId).replace(TEMPLATE_SERIAL, serial)

  body = templates[seq][1].replace(TEMPLATE_SERIAL, serial)
  headers['Content-Length'] = body.length

  options = {
    host: '',
    port: 1337,
    method: 'POST',
    headers: headers,
  }

  #startTime = new Date().getTime()
  req = http.request(options, (res) ->
    if res.headers['set-cookie']?
      for c in res.headers['set-cookie']
        if c.indexOf('task=', 0) is 0
          taskId = c.substr(5)
    #endTime = new Date().getTime() - startTime
    #console.log("Response time: #{endTime}")
    sendRequest(serial, taskId, seq + 1)
  )
  req.end(body)

t = new Date()
console.log("Start at #{t}")

for i in [0 .. 500]
  sendRequest(TEMPLATE_SERIAL + String(i), TEMPLATE_TASKID, 0)
