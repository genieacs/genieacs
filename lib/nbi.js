/**
 * Copyright 2013-2018  Zaid Abdulla
 *
 * This file is part of GenieACS.
 *
 * GenieACS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * GenieACS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
 */
"use strict";

const url = require("url");
const mongodb = require("mongodb");
const querystring = require("querystring");
const vm = require("vm");
const childProcess = require("child_process");
const config = require("./config");
const db = require("./db");
const query = require("./query");
const apiFunctions = require("./api-functions");
const cache = require("./cache");

const VERSION = require("../package.json").version;

const DEVICE_TASKS_REGEX = /^\/devices\/([a-zA-Z0-9\-_%]+)\/tasks\/?$/;
const TASKS_REGEX = /^\/tasks\/([a-zA-Z0-9\-_%]+)(\/[a-zA-Z_]*)?$/;
const TAGS_REGEX = /^\/devices\/([a-zA-Z0-9\-_%]+)\/tags\/([a-zA-Z0-9\-_%]+)\/?$/;
const PRESETS_REGEX = /^\/presets\/([a-zA-Z0-9\-_%]+)\/?$/;
const OBJECTS_REGEX = /^\/objects\/([a-zA-Z0-9\-_%]+)\/?$/;
const FILES_REGEX = /^\/files\/([a-zA-Z0-9%!*'();:@&=+$,?#[\]\-_.~]+)\/?$/;
const PING_REGEX = /^\/ping\/([a-zA-Z0-9\-_.:]+)\/?$/;
const QUERY_REGEX = /^\/([a-zA-Z0-9_]+)\/?$/;
const DELETE_DEVICE_REGEX = /^\/devices\/([a-zA-Z0-9\-_%]+)\/?$/;
const PROVISIONS_REGEX = /^\/provisions\/([a-zA-Z0-9\-_%]+)\/?$/;
const VIRTUAL_PARAMETERS_REGEX = /^\/virtual_parameters\/([a-zA-Z0-9\-_%]+)\/?$/;
const FAULTS_REGEX = /^\/faults\/([a-zA-Z0-9\-_%:]+)\/?$/;

function throwError(err, httpResponse) {
  if (httpResponse) {
    httpResponse.writeHead(500, { Connection: "close" });
    httpResponse.end(`${err.name}: ${err.message}`);
  }
  throw err;
}

function listener(request, response) {
  const chunks = [];
  let bytes = 0;
  response.setHeader("GenieACS-Version", VERSION);

  request.addListener("data", chunk => {
    chunks.push(chunk);
    bytes += chunk.length;
  });

  function getBody() {
    // Write all chunks into a Buffer
    const body = Buffer.allocUnsafe(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      chunk.copy(body, offset, 0, chunk.length);
      offset += chunk.length;
    }
    return body;
  }

  request.addListener("end", () => {
    const body = getBody();
    const urlParts = url.parse(request.url, true);
    if (PRESETS_REGEX.test(urlParts.pathname)) {
      const presetName = querystring.unescape(
        PRESETS_REGEX.exec(urlParts.pathname)[1]
      );
      if (request.method === "PUT") {
        const preset = JSON.parse(body);
        preset._id = presetName;
        db.presetsCollection.save(preset, err => {
          if (err) return void throwError(err, response);

          cache.del("presets_hash", err => {
            if (err) return void throwError(err, response);

            response.writeHead(200);
            response.end();
          });
        });
      } else if (request.method === "DELETE") {
        db.presetsCollection.remove({ _id: presetName }, err => {
          if (err) return void throwError(err, response);

          cache.del("presets_hash", err => {
            if (err) return void throwError(err, response);

            response.writeHead(200);
            response.end();
          });
        });
      } else {
        response.writeHead(405, { Allow: "PUT, DELETE" });
        response.end("405 Method Not Allowed");
      }
    } else if (OBJECTS_REGEX.test(urlParts.pathname)) {
      const objectName = querystring.unescape(
        OBJECTS_REGEX.exec(urlParts.pathname)[1]
      );
      if (request.method === "PUT") {
        const object = JSON.parse(body);
        object._id = objectName;
        db.objectsCollection.save(object, err => {
          if (err) return void throwError(err, response);

          cache.del("presets_hash", err => {
            if (err) return void throwError(err, response);

            response.writeHead(200);
            response.end();
          });
        });
      } else if (request.method === "DELETE") {
        db.objectsCollection.remove({ _id: objectName }, err => {
          if (err) return void throwError(err, response);

          cache.del("presets_hash", err => {
            if (err) return void throwError(err, response);

            response.writeHead(200);
            response.end();
          });
        });
      } else {
        response.writeHead(405, { Allow: "PUT, DELETE" });
        response.end("405 Method Not Allowed");
      }
    } else if (PROVISIONS_REGEX.test(urlParts.pathname)) {
      const provisionName = querystring.unescape(
        PROVISIONS_REGEX.exec(urlParts.pathname)[1]
      );
      if (request.method === "PUT") {
        const object = {
          _id: provisionName,
          script: body.toString()
        };

        try {
          new vm.Script(`"use strict";(function(){\n${object.script}\n})();`);
        } catch (err) {
          response.writeHead(400);
          response.end(`${err.name}: ${err.message}`);
          return;
        }

        db.provisionsCollection.save(object, err => {
          if (err) return void throwError(err, response);

          cache.del("presets_hash", err => {
            if (err) return void throwError(err, response);

            response.writeHead(200);
            response.end();
          });
        });
      } else if (request.method === "DELETE") {
        db.provisionsCollection.remove({ _id: provisionName }, err => {
          if (err) return void throwError(err, response);

          cache.del("presets_hash", err => {
            if (err) return void throwError(err, response);

            response.writeHead(200);
            response.end();
          });
        });
      } else {
        response.writeHead(405, { Allow: "PUT, DELETE" });
        response.end("405 Method Not Allowed");
      }
    } else if (VIRTUAL_PARAMETERS_REGEX.test(urlParts.pathname)) {
      const virtualParameterName = querystring.unescape(
        VIRTUAL_PARAMETERS_REGEX.exec(urlParts.pathname)[1]
      );
      if (request.method === "PUT") {
        const object = {
          _id: virtualParameterName,
          script: body.toString()
        };

        try {
          new vm.Script(`"use strict";(function(){\n${object.script}\n})();`);
        } catch (err) {
          response.writeHead(400);
          response.end(`${err.name}: ${err.message}`);
          return;
        }

        db.virtualParametersCollection.save(object, err => {
          if (err) return void throwError(err, response);

          cache.del("presets_hash", err => {
            if (err) return void throwError(err, response);

            response.writeHead(200);
            response.end();
          });
        });
      } else if (request.method === "DELETE") {
        db.virtualParametersCollection.remove(
          { _id: virtualParameterName },
          err => {
            if (err) return void throwError(err, response);

            cache.del("presets_hash", err => {
              if (err) return void throwError(err, response);

              response.writeHead(200);
              response.end();
            });
          }
        );
      } else {
        response.writeHead(405, { Allow: "PUT, DELETE" });
        response.end("405 Method Not Allowed");
      }
    } else if (TAGS_REGEX.test(urlParts.pathname)) {
      const r = TAGS_REGEX.exec(urlParts.pathname);
      const deviceId = querystring.unescape(r[1]);
      const tag = querystring.unescape(r[2]);
      if (request.method === "POST") {
        db.devicesCollection.update(
          { _id: deviceId },
          { $addToSet: { _tags: tag } },
          { safe: true },
          err => {
            if (err) return void throwError(err, response);
            response.writeHead(200);
            response.end();
          }
        );
      } else if (request.method === "DELETE") {
        db.devicesCollection.update(
          { _id: deviceId },
          { $pull: { _tags: tag } },
          { safe: true },
          err => {
            if (err) return void throwError(err, response);

            response.writeHead(200);
            response.end();
          }
        );
      } else {
        response.writeHead(405, { Allow: "POST, DELETE" });
        response.end("405 Method Not Allowed");
      }
    } else if (FAULTS_REGEX.test(urlParts.pathname)) {
      if (request.method === "DELETE") {
        const faultId = querystring.unescape(
          FAULTS_REGEX.exec(urlParts.pathname)[1]
        );
        const deviceId = faultId.split(":", 1)[0];
        const channel = faultId.slice(deviceId.length + 1);
        db.faultsCollection.remove({ _id: faultId }, err => {
          if (err) return void throwError(err, response);

          if (channel.startsWith("task_")) {
            const objId = new mongodb.ObjectID(channel.slice(5));
            return void db.tasksCollection.remove({ _id: objId }, err => {
              if (err) return void throwError(err, response);

              cache.del(`${deviceId}_tasks_faults_operations`, err => {
                if (err) return void throwError(err, response);

                response.writeHead(200);
                response.end();
              });
            });
          }

          cache.del(`${deviceId}_tasks_faults_operations`, err => {
            if (err) return void throwError(err, response);

            response.writeHead(200);
            response.end();
          });
        });
      } else {
        response.writeHead(405, { Allow: "DELETE" });
        response.end("405 Method Not Allowed");
      }
    } else if (DEVICE_TASKS_REGEX.test(urlParts.pathname)) {
      if (request.method === "POST") {
        const deviceId = querystring.unescape(
          DEVICE_TASKS_REGEX.exec(urlParts.pathname)[1]
        );
        if (body.length) {
          const task = JSON.parse(body);
          task.device = deviceId;
          apiFunctions.insertTasks(task, err => {
            if (err) return void throwError(err, response);

            cache.del(`${deviceId}_tasks_faults_operations`, err => {
              if (err) return void throwError(err, response);

              if (urlParts.query.connection_request != null) {
                apiFunctions.connectionRequest(deviceId, err => {
                  if (err) {
                    response.writeHead(202, err.message, {
                      "Content-Type": "application/json"
                    });
                    response.end(JSON.stringify(task));
                    return;
                  }

                  const DEVICE_ONLINE_THRESHOLD = config.get(
                    "DEVICE_ONLINE_THRESHOLD",
                    deviceId
                  );
                  apiFunctions.watchTask(
                    deviceId,
                    task._id,
                    DEVICE_ONLINE_THRESHOLD,
                    (err, status) => {
                      if (err) return void throwError(err, response);

                      if (status === "timeout") {
                        response.writeHead(
                          202,
                          "Task queued but not processed",
                          {
                            "Content-Type": "application/json"
                          }
                        );
                        response.end(JSON.stringify(task));
                      } else if (status === "fault") {
                        db.tasksCollection.findOne(
                          { _id: task._id },
                          (err, task2) => {
                            if (err) return void throwError(err, response);

                            response.writeHead(202, "Task faulted", {
                              "Content-Type": "application/json"
                            });
                            response.end(JSON.stringify(task2));
                          }
                        );
                      } else {
                        response.writeHead(200, {
                          "Content-Type": "application/json"
                        });
                        response.end(JSON.stringify(task));
                      }
                    }
                  );
                });
              } else {
                response.writeHead(202, {
                  "Content-Type": "application/json"
                });
                response.end(JSON.stringify(task));
              }
            });
          });
        } else if (urlParts.query.connection_request != null) {
          // No task, send connection request only
          apiFunctions.connectionRequest(deviceId, err => {
            if (err) {
              response.writeHead(504);
              response.end(`${err.name}: ${err.message}`);
              return;
            }
            response.writeHead(200);
            response.end();
          });
        } else {
          response.writeHead(400);
          response.end();
        }
      } else {
        response.writeHead(405, { Allow: "POST" });
        response.end("405 Method Not Allowed");
      }
    } else if (TASKS_REGEX.test(urlParts.pathname)) {
      const r = TASKS_REGEX.exec(urlParts.pathname);
      const taskId = querystring.unescape(r[1]);
      const action = r[2];
      if (!action || action === "/") {
        if (request.method === "DELETE") {
          db.tasksCollection.findOne(
            { _id: new mongodb.ObjectID(taskId) },
            { device: 1 },
            (err, task) => {
              if (err) return void throwError(err, response);

              if (!task) {
                response.writeHead(404);
                response.end("Task not found");
                return;
              }

              const deviceId = task.device;
              db.tasksCollection.remove(
                { _id: new mongodb.ObjectID(taskId) },
                err => {
                  if (err) return void throwError(err, response);

                  db.faultsCollection.remove(
                    { _id: `${deviceId}:task_${taskId}` },
                    err => {
                      if (err) return void throwError(err, response);

                      cache.del(`${deviceId}_tasks_faults_operations`, err => {
                        if (err) return void throwError(err, response);

                        response.writeHead(200);
                        response.end();
                      });
                    }
                  );
                }
              );
            }
          );
        } else {
          response.writeHead(405, { Allow: "PUT DELETE" });
          response.end("405 Method Not Allowed");
        }
      } else if (action === "/retry") {
        if (request.method === "POST") {
          db.tasksCollection.findOne(
            { _id: new mongodb.ObjectID(taskId) },
            { device: 1 },
            (err, task) => {
              if (err) return void throwError(err, response);

              const deviceId = task.device;
              db.faultsCollection.remove(
                { _id: `${deviceId}:task_${taskId}` },
                err => {
                  if (err) return void throwError(err, response);

                  cache.del(`${deviceId}_tasks_faults_operations`, err => {
                    if (err) return void throwError(err, response);

                    response.writeHead(200);
                    response.end();
                  });
                }
              );
            }
          );
        } else {
          response.writeHead(405, { Allow: "POST" });
          response.end("405 Method Not Allowed");
        }
      } else {
        response.writeHead(404);
        response.end();
      }
    } else if (FILES_REGEX.test(urlParts.pathname)) {
      const filename = querystring.unescape(
        FILES_REGEX.exec(urlParts.pathname)[1]
      );
      if (request.method === "PUT") {
        const metadata = {
          fileType: request.headers.filetype,
          oui: request.headers.oui,
          productClass: request.headers.productclass,
          version: request.headers.version
        };
        const gs = new mongodb.GridStore(db.mongoDb, filename, filename, "w", {
          metadata: metadata
        });
        gs.open(err => {
          if (err) return void throwError(err, response);

          gs.write(body, err => {
            if (err) return void throwError(err, response);

            gs.close(err => {
              if (err) return void throwError(err, response);

              response.writeHead(201);
              response.end();
            });
          });
        });
      } else if (request.method === "DELETE") {
        mongodb.GridStore.unlink(db.mongoDb, filename, err => {
          if (err) return void throwError(err, response);

          response.writeHead(200);
          response.end();
        });
      } else {
        response.writeHead(405, { Allow: "PUT, DELETE" });
        response.end("405 Method Not Allowed");
      }
    } else if (PING_REGEX.test(urlParts.pathname)) {
      const host = querystring.unescape(PING_REGEX.exec(urlParts.pathname)[1]);
      childProcess.exec(`ping -w 1 -i 0.2 -c 3 ${host}`, (err, stdout) => {
        if (err) {
          response.writeHead(404, { "Cache-Control": "no-cache" });
          response.end(`${err.name}: ${err.message}`);
          return;
        }

        response.writeHead(200, {
          "Content-Type": "text/plain",
          "Cache-Control": "no-cache"
        });
        response.end(stdout);
      });
    } else if (DELETE_DEVICE_REGEX.test(urlParts.pathname)) {
      if (request.method !== "DELETE") {
        response.writeHead(405, { Allow: "DELETE" });
        response.end("405 Method Not Allowed");
        return;
      }

      const deviceId = querystring.unescape(
        DELETE_DEVICE_REGEX.exec(urlParts.pathname)[1]
      );
      apiFunctions.deleteDevice(deviceId, err => {
        if (err) return void throwError(err, response);

        response.writeHead(200);
        response.end();
      });
    } else if (QUERY_REGEX.test(urlParts.pathname)) {
      let collectionName = QUERY_REGEX.exec(urlParts.pathname)[1];

      // Convert to camel case
      let i = collectionName.indexOf("_");
      while (i++ >= 0) {
        const up =
          i < collectionName.length ? collectionName[i].toUpperCase() : "";
        collectionName =
          collectionName.slice(0, i - 1) + up + collectionName.slice(i + 1);
        i = collectionName.indexOf("_", i);
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end("405 Method Not Allowed");
        return;
      }

      const collection = db[`${collectionName}Collection`];
      if (!collection) {
        response.writeHead(404);
        response.end("404 Not Found");
        return;
      }

      let q = {};
      if (urlParts.query.query) {
        try {
          q = JSON.parse(urlParts.query.query);
        } catch (err) {
          response.writeHead(400);
          response.end(`${err.name}: ${err.message}`);
          return;
        }
      }

      switch (collectionName) {
        case "devices":
          q = query.expand(q);
          break;
        case "tasks":
          q = query.sanitizeQueryTypes(q, {
            _id: v => new mongodb.ObjectID(v),
            timestamp: v => new Date(v),
            retries: Number
          });
          break;
        case "faults":
          q = query.sanitizeQueryTypes(q, {
            timestamp: v => new Date(v),
            retries: Number
          });
      }

      let projection = null;
      if (urlParts.query.projection) {
        projection = {};
        for (const p of urlParts.query.projection.split(","))
          projection[p.trim()] = 1;
      }

      const cur = collection.find(q, projection, { batchSize: 50 });

      if (urlParts.query.sort) {
        const s = JSON.parse(urlParts.query.sort);
        const sort = {};
        for (const [k, v] of Object.entries(s)) {
          if (k[k.lastIndexOf(".") + 1] !== "_" && collectionName === "devices")
            sort[`${k}._value`] = v;
          else sort[k] = v;
        }

        cur.sort(sort);
      }

      if (urlParts.query.skip) cur.skip(parseInt(urlParts.query.skip));

      let limit;
      if (urlParts.query.limit)
        cur.limit((limit = parseInt(urlParts.query.limit)));

      cur.count(false, (err, total) => {
        if (err) return void throwError(err);

        response.writeHead(200, {
          "Content-Type": "application/json",
          total: total
        });

        if (request.method === "HEAD") {
          response.end();
          return;
        }

        response.write("[\n");
        i = 0;
        cur.each((err, item) => {
          if (err) {
            throwError(err);
            return false;
          }

          if (item) {
            if (i++) response.write(",\n");
            response.write(JSON.stringify(item));
          }

          if (!item || i >= limit) {
            response.end("\n]");
            return false;
          }

          return null;
        });
      });
    } else {
      response.writeHead(404);
      response.end("404 Not Found");
    }
  });
}

exports.listener = listener;
