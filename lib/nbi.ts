/**
 * Copyright 2013-2019  GenieACS Inc.
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

import * as url from "url";
import { Collection, GridFSBucket, ObjectId } from "mongodb";
import * as querystring from "querystring";
import * as vm from "vm";
import * as config from "./config";
import { onConnect } from "./db";
import * as query from "./query";
import * as apiFunctions from "./api-functions";
import { IncomingMessage, ServerResponse } from "http";
import * as cache from "./cache";
import { version as VERSION } from "../package.json";
import { ping } from "./ping";
import * as logger from "./logger";

const DEVICE_TASKS_REGEX = /^\/devices\/([a-zA-Z0-9\-_%]+)\/tasks\/?$/;
const TASKS_REGEX = /^\/tasks\/([a-zA-Z0-9\-_%]+)(\/[a-zA-Z_]*)?$/;
const TAGS_REGEX = /^\/devices\/([a-zA-Z0-9\-_%]+)\/tags\/([a-zA-Z0-9\-_%]+)\/?$/;
const PRESETS_REGEX = /^\/presets\/([a-zA-Z0-9\.\-_%]+)\/?$/;
const OBJECTS_REGEX = /^\/objects\/([a-zA-Z0-9\-_%]+)\/?$/;
const FILES_REGEX = /^\/files\/([a-zA-Z0-9%!*'();:@&=+$,?#[\]\-_.~]+)\/?$/;
const PING_REGEX = /^\/ping\/([a-zA-Z0-9\-_.:]+)\/?$/;
const QUERY_REGEX = /^\/([a-zA-Z0-9_]+)\/?$/;
const DELETE_DEVICE_REGEX = /^\/devices\/([a-zA-Z0-9\-_%]+)\/?$/;
const PROVISIONS_REGEX = /^\/provisions\/([a-zA-Z0-9\-_%]+)\/?$/;
const VIRTUAL_PARAMETERS_REGEX = /^\/virtual_parameters\/([a-zA-Z0-9\-_%]+)\/?$/;
const FAULTS_REGEX = /^\/faults\/([a-zA-Z0-9\-_%:]+)\/?$/;

const collections = {
  tasks: null as Collection,
  devices: null as Collection,
  presets: null as Collection,
  objects: null as Collection,
  files: null as Collection,
  provisions: null as Collection,
  virtualParameters: null as Collection,
  faults: null as Collection,
};
let filesBucket: GridFSBucket;

onConnect(async (db) => {
  for (const k of Object.keys(collections)) {
    if (k === "files") collections[k] = db.collection("fs.files");
    else collections[k] = db.collection(k);
  }
  filesBucket = new GridFSBucket(db);
});

function throwError(err: Error, httpResponse?: ServerResponse): never {
  if (httpResponse) {
    httpResponse.writeHead(500, { Connection: "close" });
    httpResponse.end(`${err.name}: ${err.message}`);
  }
  throw err;
}

export function listener(
  request: IncomingMessage,
  response: ServerResponse
): void {
  const chunks = [];
  let bytes = 0;
  response.setHeader("GenieACS-Version", VERSION);

  request.addListener("data", (chunk): void => {
    chunks.push(chunk);
    bytes += chunk.length;
  });

  function getBody(): Buffer {
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

    logger.accessInfo(
      Object.assign({}, urlParts.query, {
        remoteAddress: request.connection.remoteAddress,
        message: `${request.method} ${urlParts.pathname}`,
      })
    );

    if (PRESETS_REGEX.test(urlParts.pathname)) {
      const presetName = querystring.unescape(
        PRESETS_REGEX.exec(urlParts.pathname)[1]
      );
      if (request.method === "PUT") {
        const preset = JSON.parse(body.toString());
        preset._id = presetName;
        collections.presets.replaceOne(
          { _id: presetName },
          preset,
          { upsert: true },
          (err) => {
            if (err) return void throwError(err, response);

            cache
              .del("presets_hash")
              .then(() => {
                response.writeHead(200);
                response.end();
              })
              .catch((err) => {
                setTimeout(() => {
                  throwError(err, response);
                });
              });
          }
        );
      } else if (request.method === "DELETE") {
        collections.presets.deleteOne({ _id: presetName }, (err) => {
          if (err) return void throwError(err, response);

          cache
            .del("presets_hash")
            .then(() => {
              response.writeHead(200);
              response.end();
            })
            .catch((err) => {
              setTimeout(() => {
                throwError(err, response);
              });
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
        const object = JSON.parse(body.toString());
        object._id = objectName;
        collections.objects.replaceOne(
          { _id: objectName },
          object,
          { upsert: true },
          (err) => {
            if (err) return void throwError(err, response);

            cache
              .del("presets_hash")
              .then(() => {
                response.writeHead(200);
                response.end();
              })
              .catch((err) => {
                setTimeout(() => {
                  throwError(err, response);
                });
              });
          }
        );
      } else if (request.method === "DELETE") {
        collections.objects.deleteOne({ _id: objectName }, (err) => {
          if (err) return void throwError(err, response);

          cache
            .del("presets_hash")
            .then(() => {
              response.writeHead(200);
              response.end();
            })
            .catch((err) => {
              setTimeout(() => {
                throwError(err, response);
              });
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
          script: body.toString(),
        };

        try {
          new vm.Script(`"use strict";(function(){\n${object.script}\n})();`);
        } catch (err) {
          response.writeHead(400);
          response.end(`${err.name}: ${err.message}`);
          return;
        }

        collections.provisions.replaceOne(
          { _id: provisionName },
          object,
          { upsert: true },
          (err) => {
            if (err) return void throwError(err, response);

            cache
              .del("presets_hash")
              .then(() => {
                response.writeHead(200);
                response.end();
              })
              .catch((err) => {
                setTimeout(() => {
                  throwError(err, response);
                });
              });
          }
        );
      } else if (request.method === "DELETE") {
        collections.provisions.deleteOne({ _id: provisionName }, (err) => {
          if (err) return void throwError(err, response);

          cache
            .del("presets_hash")
            .then(() => {
              response.writeHead(200);
              response.end();
            })
            .catch((err) => {
              setTimeout(() => {
                throwError(err, response);
              });
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
          script: body.toString(),
        };

        try {
          new vm.Script(`"use strict";(function(){\n${object.script}\n})();`);
        } catch (err) {
          response.writeHead(400);
          response.end(`${err.name}: ${err.message}`);
          return;
        }

        collections.virtualParameters.replaceOne(
          { _id: virtualParameterName },
          object,
          { upsert: true },
          (err) => {
            if (err) return void throwError(err, response);

            cache
              .del("presets_hash")
              .then(() => {
                response.writeHead(200);
                response.end();
              })
              .catch((err) => {
                setTimeout(() => {
                  throwError(err, response);
                });
              });
          }
        );
      } else if (request.method === "DELETE") {
        collections.virtualParameters.deleteOne(
          { _id: virtualParameterName },
          (err) => {
            if (err) return void throwError(err, response);

            cache
              .del("presets_hash")
              .then(() => {
                response.writeHead(200);
                response.end();
              })
              .catch((err) => {
                setTimeout(() => {
                  throwError(err, response);
                });
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
        collections.devices.updateOne(
          { _id: deviceId },
          { $addToSet: { _tags: tag } },
          (err) => {
            if (err) return void throwError(err, response);
            response.writeHead(200);
            response.end();
          }
        );
      } else if (request.method === "DELETE") {
        collections.devices.updateOne(
          { _id: deviceId },
          { $pull: { _tags: tag } },
          (err) => {
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
        collections.faults.deleteOne({ _id: faultId }, (err) => {
          if (err) return void throwError(err, response);

          if (channel.startsWith("task_")) {
            const objId = new ObjectId(channel.slice(5));
            return void collections.tasks.deleteOne({ _id: objId }, (err) => {
              if (err) return void throwError(err, response);

              cache
                .del(`${deviceId}_tasks_faults_operations`)
                .then(() => {
                  response.writeHead(200);
                  response.end();
                })
                .catch((err) => {
                  setTimeout(() => {
                    throwError(err, response);
                  });
                });
            });
          }

          cache
            .del(`${deviceId}_tasks_faults_operations`)
            .then(() => {
              response.writeHead(200);
              response.end();
            })
            .catch((err) => {
              setTimeout(() => {
                throwError(err, response);
              });
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
          const task = JSON.parse(body.toString());
          task.device = deviceId;
          apiFunctions
            .insertTasks(task)
            .then(async () => {
              const lastInform = Date.now();

              const socketTimeout: number = request.socket["timeout"];

              // Disable socket timeout while waiting for session
              if (socketTimeout) request.socket.setTimeout(0);

              const notInSession = await apiFunctions.awaitSessionEnd(
                deviceId,
                30000
              );
              await cache.del(`${deviceId}_tasks_faults_operations`);
              if (urlParts.query.connection_request == null) {
                if (socketTimeout) request.socket.setTimeout(socketTimeout);
                response.writeHead(202, {
                  "Content-Type": "application/json",
                });
                response.end(JSON.stringify(task));
                return;
              }

              if (!notInSession) {
                if (socketTimeout) request.socket.setTimeout(socketTimeout);
                response.writeHead(202, "Task queued but not processed", {
                  "Content-Type": "application/json",
                });
                response.end(JSON.stringify(task));
                return;
              }

              const status = await apiFunctions.connectionRequest(deviceId);

              if (status) {
                if (socketTimeout) request.socket.setTimeout(socketTimeout);
                response.writeHead(202, status, {
                  "Content-Type": "application/json",
                });
                response.end(JSON.stringify(task));
                return;
              }

              const onlineThreshold =
                (urlParts.query.timeout &&
                  parseInt(urlParts.query.timeout as string)) ||
                (config.get("DEVICE_ONLINE_THRESHOLD", deviceId) as number);

              const sessionStarted = await apiFunctions.awaitSessionStart(
                deviceId,
                lastInform,
                onlineThreshold
              );
              if (!sessionStarted) {
                if (socketTimeout) request.socket.setTimeout(socketTimeout);
                response.writeHead(202, "Task queued but not processed", {
                  "Content-Type": "application/json",
                });
                response.end(JSON.stringify(task));
                return;
              }

              const sessionEnded = await apiFunctions.awaitSessionEnd(
                deviceId,
                120000
              );
              if (!sessionEnded) {
                if (socketTimeout) request.socket.setTimeout(socketTimeout);
                response.writeHead(202, "Task queued but not processed", {
                  "Content-Type": "application/json",
                });
                response.end(JSON.stringify(task));
                return;
              }

              const prom1 = collections.tasks.findOne(
                { _id: task._id },
                { projection: { _id: 1 } }
              );
              const prom2 = collections.faults.findOne(
                { _id: `${deviceId}:task_${task._id}` },
                {
                  projection: { _id: 1 },
                }
              );

              const [t, f] = await Promise.all([prom1, prom2]);

              // Restore socket timeout
              if (socketTimeout) request.socket.setTimeout(socketTimeout);

              if (f) {
                response.writeHead(202, "Task faulted", {
                  "Content-Type": "application/json",
                });
                response.end(JSON.stringify(t || task));
              } else if (t) {
                response.writeHead(202, "Task queued but not processed", {
                  "Content-Type": "application/json",
                });
                response.end(JSON.stringify(t));
              } else {
                response.writeHead(200, {
                  "Content-Type": "application/json",
                });
                response.end(JSON.stringify(task));
              }
            })
            .catch((err) => {
              setTimeout(() => {
                throwError(err, response);
              });
            });
        } else if (urlParts.query.connection_request != null) {
          // No task, send connection request only
          apiFunctions
            .connectionRequest(deviceId)
            .then(() => {
              response.writeHead(200);
              response.end();
            })
            .catch((err) => {
              response.writeHead(504);
              response.end(`${err.name}: ${err.message}`);
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
          collections.tasks.findOne(
            { _id: new ObjectId(taskId) },
            { projection: { device: 1 } },
            (err, task) => {
              if (err) return void throwError(err, response);

              if (!task) {
                response.writeHead(404);
                response.end("Task not found");
                return;
              }

              const deviceId = task.device;
              collections.tasks.deleteOne(
                { _id: new ObjectId(taskId) },
                (err) => {
                  if (err) return void throwError(err, response);

                  collections.faults.deleteOne(
                    { _id: `${deviceId}:task_${taskId}` },
                    (err) => {
                      if (err) return void throwError(err, response);

                      cache
                        .del(`${deviceId}_tasks_faults_operations`)
                        .then(() => {
                          response.writeHead(200);
                          response.end();
                        })
                        .catch((err) => {
                          setTimeout(() => {
                            throwError(err, response);
                          });
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
          collections.tasks.findOne(
            { _id: new ObjectId(taskId) },
            { projection: { device: 1 } },
            (err, task) => {
              if (err) return void throwError(err, response);

              const deviceId = task.device;
              collections.faults.deleteOne(
                { _id: `${deviceId}:task_${taskId}` },
                (err) => {
                  if (err) return void throwError(err, response);

                  cache
                    .del(`${deviceId}_tasks_faults_operations`)
                    .then(() => {
                      response.writeHead(200);
                      response.end();
                    })
                    .catch((err) => {
                      setTimeout(() => {
                        throwError(err, response);
                      });
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
          version: request.headers.version,
        };
        filesBucket.delete((filename as unknown) as ObjectId, () => {
          const uploadStream = filesBucket.openUploadStreamWithId(
            filename,
            filename,
            {
              metadata: metadata,
            }
          );

          uploadStream.on("error", (err) => {
            throwError(err, response);
          });

          uploadStream.end(body, () => {
            response.writeHead(201);
            response.end();
          });
        });
      } else if (request.method === "DELETE") {
        filesBucket.delete((filename as unknown) as ObjectId, (err) => {
          if (err) {
            if (err.message.startsWith("FileNotFound")) {
              response.writeHead(404);
              response.end("404 Not Found");
              return;
            }
            return void throwError(err, response);
          }

          response.writeHead(200);
          response.end();
        });
      } else {
        response.writeHead(405, { Allow: "PUT, DELETE" });
        response.end("405 Method Not Allowed");
      }
    } else if (PING_REGEX.test(urlParts.pathname)) {
      const host = querystring.unescape(PING_REGEX.exec(urlParts.pathname)[1]);
      ping(host, (err, res, stdout) => {
        if (err) {
          if (!res) {
            response.writeHead(500, { Connection: "close" });
            response.end(`${err.name}: ${err.message}`);
            return;
          }
          response.writeHead(404, { "Cache-Control": "no-cache" });
          response.end(`${err.name}: ${err.message}`);
          return;
        }

        response.writeHead(200, {
          "Content-Type": "text/plain",
          "Cache-Control": "no-cache",
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
      apiFunctions
        .deleteDevice(deviceId)
        .then(() => {
          response.writeHead(200);
          response.end();
        })
        .catch((err) => {
          setTimeout(() => {
            throwError(err, response);
          });
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

      const collection = collections[collectionName];
      if (!collection) {
        response.writeHead(404);
        response.end("404 Not Found");
        return;
      }

      let q = {};
      if (urlParts.query.query) {
        try {
          q = JSON.parse(urlParts.query.query as string);
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
            _id: (v) => new ObjectId(v as string),
            timestamp: (v) => new Date(v as number),
            retries: Number,
          });
          break;
        case "faults":
          q = query.sanitizeQueryTypes(q, {
            timestamp: (v) => new Date(v as number),
            retries: Number,
          });
      }

      let projection = null;
      if (urlParts.query.projection) {
        projection = {};
        for (const p of (urlParts.query.projection as string).split(","))
          projection[p.trim()] = 1;
      }

      const cur = collection.find(q, { projection: projection });

      if (urlParts.query.sort) {
        const s = JSON.parse(urlParts.query.sort as string);
        const sort = {};
        for (const [k, v] of Object.entries(s)) {
          if (k[k.lastIndexOf(".") + 1] !== "_" && collectionName === "devices")
            sort[`${k}._value`] = v;
          else sort[k] = v;
        }

        cur.sort(sort);
      }

      if (urlParts.query.skip)
        cur.skip(parseInt(urlParts.query.skip as string));

      if (urlParts.query.limit)
        cur.limit(parseInt(urlParts.query.limit as string));

      cur.count(false, (err, total) => {
        if (err) return void throwError(err);

        response.writeHead(200, {
          "Content-Type": "application/json",
          total: total,
        });

        if (request.method === "HEAD") {
          response.end();
          return;
        }

        response.write("[\n");
        i = 0;
        cur.forEach(
          (item) => {
            if (i++) response.write(",\n");
            response.write(JSON.stringify(item));
          },
          (err) => {
            if (err) return void throwError(err);
            response.end("\n]");
          }
        );
      });
    } else {
      response.writeHead(404);
      response.end("404 Not Found");
    }
  });
}
