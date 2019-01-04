"use strict";

const fs = require("fs");
const configFile = JSON.parse(fs.readFileSync("./config/config-ui.json"));

const config = loadConfig(configFile);

function getClientConfig() {
  return Object.assign({}, config, {
    server: null,
    auth: null,
    permissions: null
  });
}

function loadConfig(conf, root = {}) {
  for (const [key, value] of Object.entries(conf)) {
    const keys = key.split(".");
    let ref = root;
    while (keys.length > 1) {
      const k = keys.shift();
      if (typeof ref[k] !== "object") ref[k] = {};
      ref = ref[k];
    }

    if (typeof value === "object") {
      if (typeof ref[keys[0]] !== "object") ref[keys[0]] = {};
      loadConfig(value, ref[keys[0]]);
    } else {
      ref[keys[0]] = value;
    }
  }
  return root;
}

module.exports = Object.assign({}, config, { getClientConfig });
