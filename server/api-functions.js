"use strict";

const http = require("http");
const https = require("https");
const url = require("url");
const querystring = require("querystring");

const config = require("./config");
const device = require("./device");

const commaAscii = ",".charCodeAt(0);
const newLineAscii = "\n".charCodeAt(0);

function filtersToQuery(filters) {
  if (!Array.isArray(filters)) filters = [filters];

  let queries = [];
  for (let filter of filters) {
    let q = {};
    for (let [k, v] of Object.entries(filter)) {
      let [param, op] = k.split(/([^a-zA-Z0-9\-_.].*)/, 2);
      if (!op || op === "=") q[param] = v;
      else if (op === ">") q[param] = { $gt: v };
      else throw new Error(`Operator "${op}" not recognized`);
    }
    queries.push(q);
  }

  if (queries.length === 1) return queries[0];
  else return { $or: queries };
}

function count(resource, filters, limit) {
  return new Promise((resolve, reject) => {
    let qs = {};
    if (filters) {
      let q = filtersToQuery(filters);
      if (resource === "devices") q = device.transposeQuery(q);
      qs.query = JSON.stringify(q);
    }

    if (limit) qs.limit = limit;

    let options = url.parse(
      `${config.GENIEACS_NBI}${resource}?${querystring.stringify(qs)}`
    );

    options.method = "HEAD";

    let _http = options.protocol === "https:" ? https : http;

    _http
      .request(options, res => {
        if (res.statusCode !== 200) {
          reject(new Error(`Unexpected status code ${res.statusCode}`));
          res.resume();
          return;
        }
        resolve(+res.headers["total"]);
      })
      .end();
  });
}

function query(resource, filters, limit, callback) {
  return new Promise((resolve, reject) => {
    let ret;
    if (!callback) ret = [];
    let qs = {};
    if (filters) {
      let q = filtersToQuery(filters);
      if (resource === "devices") q = device.transposeQuery(q);
      qs.query = JSON.stringify(q);
    }

    if (limit) qs.limit = limit;

    let options = url.parse(
      `${config.GENIEACS_NBI}${resource}?${querystring.stringify(qs)}`
    );

    let _http = options.protocol === "https:" ? https : http;

    _http.get(options, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`Unexpected status code ${res.statusCode}`));
        res.resume();
        return;
      }
      let chunks = [];
      let bytes = 0;
      res.on("data", chunk => {
        let i;
        while ((i = chunk.indexOf(newLineAscii)) !== -1) {
          let buf;
          if (chunk[chunk.length - 2] === commaAscii) {
            i -= 1;
            buf = new Buffer(bytes + i);
            chunk.copy(buf, buf.length - i, 0, i);
            chunk = chunk.slice(i + 2);
          } else {
            buf = new Buffer(bytes + i);
            chunk.copy(buf, buf.length - i, 0, i);
            chunk = chunk.slice(i + 1);
          }

          let o = 0;
          for (let c of chunks) {
            c.copy(buf, o, 0, c.length);
            o += c.length;
          }

          if (buf.length > 1) {
            let obj = JSON.parse(buf);
            if (resource === "devices") obj = device.transpose(obj);
            if (ret) ret.push(obj);
            else callback(obj);
          }

          bytes = 0;
          chunks = [];
        }
        bytes += chunk.length;
        chunks.push(chunk);
      });

      res.on("end", () => {
        let buf = new Buffer(bytes);
        let o = 0;
        for (let c of chunks) {
          c.copy(buf, o, 0, c.length);
          o += c.length;
        }
        if (buf.length > 1) {
          let obj = JSON.parse(buf);
          if (resource === "devices") obj = device.transpose(obj);

          if (ret) ret.push(obj);
          else callback(obj);
        }
        resolve(ret);
      });

      res.on("aborted", () => {
        res.removeAllListeners("end");
        reject(new Error("Timeout"));
      });
    });
  });
}

exports.query = query;
exports.count = count;
