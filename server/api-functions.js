"use strict";

const http = require("http");
const https = require("https");
const url = require("url");
const querystring = require("querystring");

const config = require("./config");
const device = require("./device");
const filterParser = require("../common/filter-parser");

const commaAscii = ",".charCodeAt(0);
const newLineAscii = "\n".charCodeAt(0);

function unpackTimestamps(filter) {
  return filterParser.map(filter, exp => {
    if (["=", "<>", ">=", "<=", "<", ">"].includes(exp[0]))
      if (typeof exp[2] === "number") {
        let alt = exp.slice();
        alt[2] = new Date(alt[2]).toJSON();
        return ["OR", exp, alt];
      }
  });
}

function filterToQuery(filter, negate = false, res = {}) {
  const op = filter[0];

  if ((!negate && op === "AND") || (negate && op === "OR")) {
    res["$and"] = res["$and"] || [];
    for (let i = 1; i < filter.length; ++i)
      res["$and"].push(filterToQuery(filter[i], negate));
  } else if ((!negate && op === "OR") || (negate && op === "AND")) {
    res["$or"] = res["$or"] || [];

    for (let i = 1; i < filter.length; ++i)
      res["$or"].push(filterToQuery(filter[i], negate));
  } else if (op === "NOT") {
    filterToQuery(filter[1], !negate, res);
  } else if (op === "=") {
    let p = (res[filter[1]] = res[filter[1]] || {});
    if (negate) p["$ne"] = filter[2];
    else p["$eq"] = filter[2];
  } else if (op === "<>") {
    let p = (res[filter[1]] = res[filter[1]] || {});
    if (negate) {
      p["$eq"] = filter[2];
    } else {
      p["$ne"] = filter[2];
      p["$exists"] = true;
    }
  } else if (op === ">") {
    let p = (res[filter[1]] = res[filter[1]] || {});
    if (negate) p = p["$not"] = p["$not"] || {};
    p["$gt"] = filter[2];
  } else if (op === ">=") {
    let p = (res[filter[1]] = res[filter[1]] || {});
    if (negate) p = p["$not"] = p["$not"] || {};
    p["$gte"] = filter[2];
  } else if (op === "<") {
    let p = (res[filter[1]] = res[filter[1]] || {});
    if (negate) p = p["$not"] = p["$not"] || {};
    p["$lt"] = filter[2];
  } else if (op === "<=") {
    let p = (res[filter[1]] = res[filter[1]] || {});
    if (negate) p = p["$not"] = p["$not"] || {};
    p["$lte"] = filter[2];
  } else if (op === "IS NULL") {
    res[filter[1]] = { $exists: negate };
  } else if (op === "IS NOT NULL") {
    res[filter[1]] = { $exists: !negate };
  } else {
    throw new Error(`Unrecognized operator ${op}`);
  }

  return res;
}

function count(resource, filter, limit) {
  return new Promise((resolve, reject) => {
    let qs = {};
    if (filter) {
      filter = filter.evaluateExpressions();
      let ast = unpackTimestamps(filter.ast);

      let q = filterToQuery(ast);
      if (resource === "devices") q = device.transposeQuery(q);
      qs.query = JSON.stringify(q);
    }

    if (limit) qs.limit = limit;

    let options = url.parse(
      `${config.get("server.nbi")}${resource}?${querystring.stringify(qs)}`
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

function query(resource, filter, limit, skip, projection, callback) {
  return new Promise((resolve, reject) => {
    let ret;
    if (!callback) ret = [];
    let qs = {};
    if (filter) {
      filter = filter.evaluateExpressions();
      let ast = unpackTimestamps(filter.ast);

      let q = filterToQuery(ast);
      if (resource === "devices") q = device.transposeQuery(q);

      qs.query = JSON.stringify(q);
    }

    if (limit) qs.limit = limit;
    if (skip) qs.skip = skip;
    if (projection) qs.projection = projection;
    qs.sort = JSON.stringify({ _id: 1 });

    let options = url.parse(
      `${config.get("server.nbi")}${resource}?${querystring.stringify(qs)}`
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
