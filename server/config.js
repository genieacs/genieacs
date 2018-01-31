"use strict";

const filterParser = require("../common/filter-parser.js");
const Filter = require("../common/filter.js");

const configFile = require("../config.json");

const cache = {};

function parse(name, value) {
  if (/^ui\.overview\.charts\.[^.]+\.slices\.[^.]+\.filter$/.test(name))
    return new Filter(value);

  return value;
}

function get(name) {
  let v = cache[name];
  if (v === undefined) {
    v = configFile[name];
    if (v != null) {
      v = parse(name, v);
    } else {
      const prefix = `${name}.`;
      for (let k of Object.keys(configFile))
        if (k.startsWith(prefix)) {
          v = v || {};
          let ar = k.slice(prefix.length).split(".");
          let ref = v;
          for (let a of ar.slice(0, -1)) ref = ref[a] = ref[a] || {};
          ref[ar[ar.length - 1]] = parse(k, configFile[k]);
        }
    }
    if (v) cache[name] = v;
    else cache[name] = null;
  }

  return v;
}

function getClientConfig() {
  const regex = [
    /^ui\.pageSize$/,
    /^ui\.filters\.[^.]+\.label$/,
    /^ui\.filters\.[^.]+\.parameter$/,
    /^ui\.filters\.[^.]+\.type$/,
    /^ui\.index\./,
    /^ui\.overview\.groups\./,
    /^ui\.overview\.charts\./,
    /^ui\.device/
  ];

  const clientConfig = {};
  for (let [k, v] of Object.entries(configFile))
    for (let r of regex)
      if (r.test(k)) {
        clientConfig[k] = v;
        break;
      }

  return clientConfig;
}

exports.get = get;
exports.getClientConfig = getClientConfig;
