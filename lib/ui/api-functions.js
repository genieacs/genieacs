"use strict";

const http = require("http");
const https = require("https");
const url = require("url");

const config = require("../config");
const db = require("./db");
const mongodbFunctions = require("./mongodb-functions");

function filterToMongoQuery(filter, negate = false, res = {}) {
  const op = filter[0];

  if ((!negate && op === "AND") || (negate && op === "OR")) {
    res["$and"] = res["$and"] || [];
    for (let i = 1; i < filter.length; ++i)
      res["$and"].push(filterToMongoQuery(filter[i], negate));
  } else if ((!negate && op === "OR") || (negate && op === "AND")) {
    res["$or"] = res["$or"] || [];

    for (let i = 1; i < filter.length; ++i)
      res["$or"].push(filterToMongoQuery(filter[i], negate));
  } else if (op === "NOT") {
    filterToMongoQuery(filter[1], !negate, res);
  } else if (op === "=") {
    const param = filter[1][1];
    const p = (res[param] = res[param] || {});
    if (negate) p["$ne"] = filter[2];
    else p["$eq"] = filter[2];
  } else if (op === "<>") {
    const param = filter[1][1];
    let p = (res[param] = res[param] || {});
    if (negate) p = p["$not"] = p["$not"] || {};
    p["$ne"] = filter[2];
    p["$exists"] = true;
  } else if (op === ">") {
    const param = filter[1][1];
    let p = (res[param] = res[param] || {});
    if (negate) p = p["$not"] = p["$not"] || {};
    p["$gt"] = filter[2];
  } else if (op === ">=") {
    const param = filter[1][1];
    let p = (res[param] = res[param] || {});
    if (negate) p = p["$not"] = p["$not"] || {};
    p["$gte"] = filter[2];
  } else if (op === "<") {
    const param = filter[1][1];
    let p = (res[param] = res[param] || {});
    if (negate) p = p["$not"] = p["$not"] || {};
    p["$lt"] = filter[2];
  } else if (op === "<=") {
    const param = filter[1][1];
    let p = (res[param] = res[param] || {});
    if (negate) p = p["$not"] = p["$not"] || {};
    p["$lte"] = filter[2];
  } else if (op === "IS NULL") {
    const param = filter[1][1];
    res[param] = { $exists: negate };
  } else if (op === "IS NOT NULL") {
    const param = filter[1][1];
    res[param] = { $exists: !negate };
  } else {
    throw new Error(`Unrecognized operator ${op}`);
  }

  return res;
}

function deleteResource(resource, id) {
  return new Promise((resolve, reject) => {
    const resourceUrl =
      resource === "virtualParameters" ? "virtual_parameters" : resource;
    const options = url.parse(
      `http://127.0.0.1:${config.get(
        "NBI_PORT"
      )}/${resourceUrl}/${encodeURIComponent(id)}`
    );

    options.method = "DELETE";

    const _http = options.protocol === "https:" ? https : http;

    _http
      .request(options, res => {
        res.resume();
        if (res.statusCode === 200) resolve(true);
        else if (res.statusCode === 404) resolve(false);
        else reject(new Error(`Unexpected status code ${res.statusCode}`));
      })
      .end();
  });
}

function postTask(task, connectionRequest, callback) {
  const options = url.parse(
    `http://127.0.0.1:${config.get("NBI_PORT")}/devices/${encodeURIComponent(
      task.device
    )}/tasks${connectionRequest ? "?connection_request" : ""}`
  );
  options.method = "POST";
  const _http = options.protocol === "https:" ? https : http;

  _http
    .request(options, res => {
      if (res.statusCode !== 200 && res.statusCode !== 202) {
        callback(new Error(`Unexpected status code ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks = [];
      let bytes = 0;
      res.on("data", chunk => {
        chunks.push(chunk);
        bytes += chunk.length;
      });

      res.on("end", () => {
        const buf = Buffer.allocUnsafe(bytes);
        let o = 0;
        for (const c of chunks) {
          c.copy(buf, o, 0, c.length);
          o += c.length;
        }
        try {
          const t = JSON.parse(buf);
          let connectionRequestStatus;
          if (connectionRequest) {
            connectionRequestStatus = "OK";
            if (
              res.statusCode === 202 &&
              res.statusMessage !== "Task queued but not processed" &&
              res.statusMessage !== "Task faulted"
            )
              connectionRequestStatus = res.statusMessage;
          }
          callback(null, t, connectionRequestStatus);
        } catch (err) {
          callback(err);
        }
      });
    })
    .end(JSON.stringify(task));
}

function postTasks(deviceId, tasks) {
  return new Promise((resolve, reject) => {
    let connectionRequestStatus;
    const promises = [];
    for (const [idx, task] of tasks.entries()) {
      task.device = deviceId;
      promises.push(
        new Promise((res, rej) => {
          const conReq = idx === tasks.length - 1;
          delete task._id;
          task.expiry = 5;
          postTask(task, conReq, (err, t, crs) => {
            if (err) return void rej(err);
            if (conReq) connectionRequestStatus = crs;
            res({ _id: t._id, status: "pending" });
          });
        })
      );
    }

    Promise.all(promises)
      .then(statuses => {
        if (connectionRequestStatus !== "OK") {
          return void resolve({
            connectionRequest: connectionRequestStatus,
            tasks: statuses
          });
        }

        const promises2 = [];
        for (const s of statuses) {
          promises2.push(db.query("tasks", ["=", ["PARAM", "_id"], s._id]));
          promises2.push(
            db.query("faults", [
              "=",
              ["PARAM", "_id"],
              `${deviceId}:task_${s._id}`
            ])
          );
        }

        Promise.all(promises2)
          .then(res => {
            for (const [i, r] of statuses.entries()) {
              if (res[i * 2].length === 0) {
                r.status = "done";
              } else if (res[i * 2 + 1].length === 1) {
                r.status = "fault";
                r.fault = res[i * 2 + 1][0];
              }
              deleteResource("tasks", r._id);
            }

            resolve({
              connectionRequest: connectionRequestStatus,
              tasks: statuses
            });
          })
          .catch(reject);
      })
      .catch(reject);
  });
}

function updateTags(deviceId, tags) {
  return Promise.all(
    Object.entries(tags).map(
      ([tag, onOff]) =>
        new Promise((resolve, reject) => {
          const options = url.parse(
            `http://127.0.0.1:${config.get(
              "NBI_PORT"
            )}/devices/${encodeURIComponent(
              deviceId
            )}/tags/${encodeURIComponent(tag)}`
          );
          if (onOff) options.method = "POST";
          else options.method = "DELETE";
          const _http = options.protocol === "https:" ? https : http;

          _http
            .request(options, res => {
              res.resume();
              if (res.statusCode === 200) resolve();
              else
                reject(new Error(`Unexpected status code ${res.statusCode}`));
            })
            .end();
        })
    )
  );
}

function ping(host) {
  return new Promise((resolve, reject) => {
    const options = url.parse(
      `http://127.0.0.1:${config.get("NBI_PORT")}/ping/${encodeURIComponent(
        host
      )}`
    );

    const _http = options.protocol === "https:" ? https : http;
    _http
      .request(options, res => {
        if (res.statusCode === 404) {
          res.resume();
          return void resolve({});
        }

        if (res.statusCode !== 200) {
          res.resume();
          return void reject(
            new Error(`Unexpected status code ${res.statusCode}`)
          );
        }

        const chunks = [];
        let bytes = 0;
        res.on("data", chunk => {
          chunks.push(chunk);
          bytes += chunk.length;
        });

        res.on("end", () => {
          const buf = Buffer.allocUnsafe(bytes);
          let o = 0;
          for (const c of chunks) {
            c.copy(buf, o, 0, c.length);
            o += c.length;
          }
          const m = buf
            .toString()
            .match(
              /(\d) packets transmitted, (\d) received, ([\d.%]+) packet loss[^]*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/
            );
          if (!m)
            return void reject(new Error("Could not parse ping response"));

          resolve({
            packetsTransmitted: +m[1],
            packetsReceived: +m[2],
            packetLoss: m[3],
            min: +m[4],
            avg: +m[5],
            max: +m[6],
            mdev: +m[7]
          });
        });
      })
      .end();
  });
}

function putResource(resource, id, data) {
  return new Promise((resolve, reject) => {
    const resourceUrl =
      resource === "virtualParameters" ? "virtual_parameters" : resource;
    const options = url.parse(
      `http://127.0.0.1:${config.get(
        "NBI_PORT"
      )}/${resourceUrl}/${encodeURIComponent(id)}`
    );

    options.method = "PUT";

    const _http = options.protocol === "https:" ? https : http;

    if (resource === "presets") data = mongodbFunctions.preProcessPreset(data);

    if (resource === "provisions")
      data = mongodbFunctions.preProcessProvision(data);

    if (resource === "virtualParameters")
      data = mongodbFunctions.preProcessVirtualParameters(data);

    const body = typeof data !== "string" ? JSON.stringify(data) : data;
    _http
      .request(options, res => {
        const chunks = [];
        let bytes = 0;
        res.on("data", chunk => {
          chunks.push(chunk);
          bytes += chunk.length;
        });

        res.on("end", () => {
          if (res.statusCode === 200) {
            return void resolve();
          } else if (res.statusCode !== 400) {
            return void reject(
              new Error(`Unexpected status code ${res.statusCode}`)
            );
          }
          const buf = Buffer.allocUnsafe(bytes);
          let o = 0;
          for (const c of chunks) {
            c.copy(buf, o, 0, c.length);
            o += c.length;
          }
          resolve(buf.toString());
        });
      })
      .end(body);
  });
}

function putFile(id, metadata, fileStream) {
  return new Promise((resolve, reject) => {
    const options = url.parse(
      `http://127.0.0.1:${config.get("NBI_PORT")}/files/${encodeURIComponent(
        id
      )}`
    );

    options.method = "PUT";
    options.headers = Object.assign({}, metadata);
    const _http = options.protocol === "https:" ? https : http;
    const req = _http.request(options, res => {
      res.resume();
      if (res.statusCode === 201) {
        return void resolve();
      } else {
        return void reject(
          new Error(`Unexpected status code ${res.statusCode}`)
        );
      }
    });
    fileStream.pipe(req);
  });
}

exports.postTasks = postTasks;
exports.deleteResource = deleteResource;
exports.putResource = putResource;
exports.updateTags = updateTags;
exports.filterToMongoQuery = filterToMongoQuery;
exports.ping = ping;
exports.putFile = putFile;
