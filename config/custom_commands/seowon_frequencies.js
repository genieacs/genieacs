// Change frequency plans for Seowon devices.
// Args format: 3532500 5000,3537500 5000,3542500 5000,3547500 5000,3552500 5000,3557500 5000,3505000 10000,3515000 10000,3525000 10000,3535000 10000,3545000 10000,3555000 10000
var net = require('net');
var PORT = 23;
var USERNAME = 'admin';
var PASSWORD = 'admin';

var FREQUENCIES_REGEX = /\s*([\d]+)\.\s*Frequency\s*:\s*([\d]+)\s\(KHz\),\s*Bandwidth\s*:\s*([\d\.]+)\s*\(MHz\)/gm

var telnetConnect = function(host, callback) {
  var client = net.connect(PORT, host, function() {
    // enter username
    telnetExecute(USERNAME, client, "Password: ", function(err, response) {
      if (err) return callback(err, client);
      if (!timeout) return;
      // enter password
      telnetExecute(PASSWORD, client, "MT7109> ", function(err, response) {
        if (!timeout) return;
        clearTimeout(timeout);
        return callback(err, client);
      });
    });
  });
  var timeout = setTimeout(function() {
    timeout = null;
    return callback('timeout', client);
  }, 2000);
}

var telnetExecute = function(command, connection, prompt, callback) {
  command += "\n";
  var response = '';
  var listener = function(chunk) {
    response += chunk.toString();
    if (response.slice(0 - prompt.length) == prompt) {
      if (!timeout) return;
      clearTimeout(timeout);
      connection.removeListener('data', listener);
      return callback(null, response.slice(command.length, 0 - prompt.length));
    }
  };

  var end = function() {
    if (!timeout) return;
    clearTimeout(timeout);
    connection.removeListener('end', end);
    return callback(null, response.slice(command.length));
  };

  var timeout = setTimeout(function() {
    timeout = null;
    return callback('timeout', response);
  }, 2000);

  if (prompt)
    connection.on('data', listener);
  else
    connection.on('end', end);

  if (command)
    connection.write(command);
}

var parseFrequencies = function(frequenciesString) {
  var a = frequenciesString.split(',')
  var l = [];
  for (i in a) {
    var sp = a[i].trim().split(' ');
    var frequency = parseInt(sp[0]);
    var bandwidth = parseFloat(sp[1]);
    l.push([frequency, bandwidth]);
  }
  return l;
}

var findFrequency = function(haystack, needle) {
  for (i in haystack) {
    if (haystack[i][0] == needle[0] && haystack[i][1] == needle[1])
      return i;
  }
  return -1;
}

var getDeviceIp = function(deviceId, callback) {
  var db = require('../../db');
  var URL = require('url');

  db.devicesCollection.findOne({_id : deviceId}, {'InternetGatewayDevice.ManagementServer.ConnectionRequestURL._value' : 1}, function(err, device) {
    var connectionRequestUrl = device.InternetGatewayDevice.ManagementServer.ConnectionRequestURL._value;
    var url = URL.parse(connectionRequestUrl);
    return callback(url.hostname);
  });
};

exports.init = function(deviceId, args, callback) {
  return exports.get(deviceId, args, callback);
};

exports.get = function(deviceId, args, callback) {
  var currentFrequencies = [];

  getDeviceIp(deviceId, function(ip) {
    telnetConnect(ip, function(err, client) {
      // enter privileged mode
      telnetExecute("enable", client, "MT7109# ", function(err, response) {
        if (err) return callback(err);
        // show frequencies
        telnetExecute("show wmx freq", client, "MT7109# ", function(err, response) {
          if (err) return callback(err);
          while (f = FREQUENCIES_REGEX.exec(response)) {
            var frequency = parseInt(f[2]);
            var bandwidth = Math.floor(parseFloat(f[3]) * 1000);
            var freqStr = String(frequency) + ' ' + String(bandwidth);
            currentFrequencies.push(freqStr);
          }
          // log out
          telnetExecute("logout", client, null, function(err, response) {
            return callback(err, currentFrequencies.join(','));
          });
        });
      });
    });
  });
};

exports.set = function(deviceId, args, callback) {
  var newFrequencies = parseFrequencies(args);
  var addFrequencies = [];
  var delFrequencies = [];

  getDeviceIp(deviceId, function(ip) {
    telnetConnect(ip, function(err, client) {
      // enter privileged mode
      telnetExecute("enable", client, "MT7109# ", function(err, response) {
        if (err) return callback(err);
        // show frequencies
        telnetExecute("show wmx freq", client, "MT7109# ", function(err, response) {
          if (err) return callback(err);
          while (f = FREQUENCIES_REGEX.exec(response)) {
            var index = parseInt(f[1]);
            var frequency = parseInt(f[2]);
            var bandwidth = Math.floor(parseFloat(f[3]));

            var i = findFrequency(newFrequencies, [frequency, bandwidth * 1000]);
            if (i == -1)
              delFrequencies.push(index);
            else
              newFrequencies.splice(i, 1);
          }
          for (f in newFrequencies)
            addFrequencies.push(newFrequencies[f]);

          if (addFrequencies.length == 0 && delFrequencies.length == 0) {
            // log out
            telnetExecute("logout", client, null, function(err, response) {
              return callback(err, args);
            });
            return;
          }

          telnetExecute("wimax", client, "MT7109 (WiMax)# ", function(err, response) {
            if (err) return callback(err);
            var add, del;
            del = function() {
              if (delFrequencies.length == 0) {
                add();
                return;
              }
              var i = delFrequencies.pop();
              telnetExecute("wmx freq del " + i, client, "MT7109 (WiMax)# ", function(err, response) {
                if (err) return callback(err);
                del();
              });
            };
            add = function() {
              if (addFrequencies.length == 0) {
                // commit
                telnetExecute("commit", client, "MT7109 (WiMax)# ", function(err, response) {
                  if (err) return callback(err);
                  // log out
                  telnetExecute("logout", client, null, function(err, response) {
                    return callback(null, args);
                  });
                });
                return;
              }
              var i = addFrequencies.pop();
              telnetExecute("wmx freq add " + i[0] + ' ' + i[1]/1000, client, "MT7109 (WiMax)# ", function(err, response) {
                if (err) return callback(err);
                add();
              });
            };
            del();
          });
        });
      });
    });
  });
};
