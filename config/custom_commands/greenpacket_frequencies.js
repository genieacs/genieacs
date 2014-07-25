/*
 * Copyright 2013 Fanoos Telecom
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

var net = require('net');
var PORT = 23;
var USERNAME = 'mt7109';
var PASSWORD = 'wimax';
var TIMEOUT = 5000;

var FREQUENCIES_REGEX = /([0-9,]+)/
var BANDWIDTHS_REGEX = /[0-9]+\-([0-9,]+)/
var DEFAULT_BW_REGEX = /([0-9]+)\-[0-9,]+/
var telnetConnect = function(host, callback) {
  var client = net.connect(PORT, host, function() {
    // enter username
    telnetExecute(USERNAME, client, "Password: ", function(err, response) {
      if (err) return callback(err);
      // enter password
      telnetExecute(PASSWORD, client, "\n# ", function(err, response) {
        return callback(err);
      });
    });
  });
  return client;
}

var telnetExecute = function(command, connection, prompt, callback) {
  var response = '';
  command += "\n";
  var listener = function(chunk) {
    response += chunk.toString();
    if (response.slice(0 - prompt.length) == prompt) {
      connection.removeListener('data', listener);
      return callback(null, response.slice(command.length, 0 - prompt.length));
    }
  };

  var end = function() {
    connection.removeListener('end', end);
    return callback(null, response.slice(command.length));
  };

  if (prompt)
    connection.on('data', listener);
  else
    connection.on('end', end);

  if (command)
    connection.write(command);
}

var getDeviceIp = function(deviceId, callback) {
  var db = require('../../lib/db');
  var URL = require('url');

  db.devicesCollection.findOne({_id : deviceId}, {'InternetGatewayDevice.ManagementServer.ConnectionRequestURL._value' : 1}, function(err, device) {
    var connectionRequestUrl = device.InternetGatewayDevice.ManagementServer.ConnectionRequestURL._value;
    var url = URL.parse(connectionRequestUrl);
    return callback(url.hostname);
  });
};

exports.init = function(deviceId, args, callback) {
  return exports.get(deviceId, args, callback);
}

exports.get = function(deviceId, args, callback) {
  var currentFrequencies = [];
  var currentBandwidths = [];
  var defaultBandwidth = '';
  var final = [];

  getDeviceIp(deviceId, function(ip) {
    var client = telnetConnect(ip, function(err) {
      // get frequencies
      telnetExecute("sncfg get WMX_FREQ_LIST", client, "\n# ", function(err, response) {
        if (err) return callback(err);
        currentFrequencies = FREQUENCIES_REGEX.exec(response)[1].split(',')
        // get bandwidths
        telnetExecute("sncfg get WMX_FREQ_BANDWDITH_FL", client, "\n# ", function(err, response) {
          if (err) return callback(err);
          currentBandwidths = BANDWIDTHS_REGEX.exec(response)[1].split(',')
          defaultBandwidth = DEFAULT_BW_REGEX.exec(response)[1]
          // generate freq/bw pairs string
          for (var i = 0; i < currentFrequencies.length; i++) {
            final.push(currentFrequencies[i] + ' ' + currentBandwidths[i])
          }
          // log out
          telnetExecute("exit", client, null, function(err, response) {
            client.end();
            return callback(err, defaultBandwidth + '-' + final.join(','));
          });
        });
      });
    });

    client.on("error", function(err) {
      client.destroy();
      callback(err);
    });

    client.setTimeout(TIMEOUT, function() {
      client.destroy();
      callback("timeout");
    });
  });
};

var parsePairs = function(pairsString) {
  var a = pairsString.split(',');
  var f = [];
  var b = [];
  var l = [];
  for (i in a) {
    var sp = a[i].trim().split(' ');
    f.push(parseInt(sp[0]));
    b.push(parseFloat(sp[1]));
  }
  l.push(f.join(','));
  l.push(b.join(','));
  return l;
}

exports.set = function(deviceId, args, callback) {
  executeSet(deviceId, args, ['set'], callback);
};

exports.dset = function(deviceId, args, callback) {
  executeSet(deviceId, args, ['dset'], callback);
};

exports.setdset = function(deviceId, args, callback) {
  executeSet(deviceId, args, ['dset', 'set'], callback);
};

var executeSet = function(deviceId, args, method, callback) {
  var tmp = args.split('-');
  var defaultBandwidth = tmp[0];
  var pairs = parsePairs(tmp[1]);
  var frequenciesString = pairs[0];
  var bandwidthsString = pairs[1];

  getDeviceIp(deviceId, function(ip) {
    var client = telnetConnect(ip, function(err) {
      var telnet_cmd = "sncfg " + method[0];
      telnetExecute(telnet_cmd + " WMX_FREQ_BANDWDITH_FL '" + defaultBandwidth + "-" + bandwidthsString + "'", client, "\n# ", function(err, response) {
        if (err) return callback(err);
        telnetExecute(telnet_cmd + " WMX_FREQ_LIST '" + frequenciesString + "'", client, "\n# ", function(err, response) {
          if (err) return callback(err);
          if (method.length > 1) {
            telnet_cmd = "sncfg " + method[1];
            telnetExecute(telnet_cmd + " WMX_FREQ_BANDWDITH_FL '" + defaultBandwidth + "-" + bandwidthsString + "'", client, "\n# ", function(err, response) {
              if (err) return callback(err);
              telnetExecute(telnet_cmd + " WMX_FREQ_LIST '" + frequenciesString + "'", client, "\n# ", function(err, response) {
                if (err) return callback(err);
                telnetExecute("sncfg commit", client, "\n# ", function(err, response) {
                  if (err) return callback(err);
                  // log out
                  telnetExecute("exit", client, null, function(err, response) {
                    client.end();
                    return callback(null, args);
                  });
                });
              });
            });
          }
          else {
            telnetExecute("sncfg commit", client, "\n# ", function(err, response) {
            if (err) return callback(err);
              // log out
              telnetExecute("exit", client, null, function(err, response) {
                client.end();
                return callback(null, args);
              });
            });
          }
        });
      });
    });

    client.on("error", function(err) {
      client.destroy();
      callback(err);
    });

    client.setTimeout(TIMEOUT, function() {
      client.destroy();
      callback("timeout");
    });
  });
};
