"use strict";

import * as Filter from "../common/filter";

const configFile = window.clientConfig;

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

export { get };
