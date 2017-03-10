"use strict";

function connectionRequest(deviceId, url, username, password, callback) {
  return callback(username || deviceId, password || "");
}

exports.connectionRequest = connectionRequest;
