// This is an exmaple GenieACS extension to get the current latitude/longitude
// of the International Space Station. Why, you ask? Because why not.
// To install, copy this file to config/ext/iss.js.

"use strict";

const http = require("http");

let cache = null;
let cacheExpire = 0;

function latlong(args, callback) {
  if (Date.now() < cacheExpire)
    return callback(null, cache);

  http.get("http://api.open-notify.org/iss-now.json", (res) => {
    if (res.statusCode !== 200)
      return callback(new Error(`Request failed (status code: ${res.statusCode})`));

    let rawData = "";
    res.on("data", (chunk) => rawData += chunk);

    res.on("end", () => {
      let pos = JSON.parse(rawData)["iss_position"];
      cache = [+pos["latitude"], +pos["longitude"]];
      cacheExpire = Date.now() + 10000;
      callback(null, cache);
    });
  }).on("error", (err) => {
    callback(err);
  });
}

exports.latlong = latlong;
