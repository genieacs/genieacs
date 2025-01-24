import * as vm from "node:vm";
import { IncomingMessage, ServerResponse } from "node:http";
import { Collection, ObjectId } from "mongodb";
import { getRevision, getConfig } from "./ui/local-cache.ts";
import { filesBucket, collections } from "./db/db.ts";
import { optimizeProjection } from "./db/util.ts";
import * as query from "./query.ts";
import * as apiFunctions from "./api-functions.ts";
import * as cache from "./cache.ts";
import { version as VERSION } from "../package.json";
import { ping } from "./ping.ts";
import * as logger from "./logger.ts";
import { flattenDevice } from "./ui/db.ts";
import { getRequestOrigin } from "./forwarded.ts";
import { acquireLock, releaseLock } from "./lock.ts";
import { ResourceLockedError } from "./common/errors.ts";

const DEVICE_TASKS_REGEX = /^\/devices\/([a-zA-Z0-9\-_%]+)\/tasks\/?$/;
const TASKS_REGEX = /^\/tasks\/([a-zA-Z0-9\-_%]+)(\/[a-zA-Z_]*)?$/;
const TAGS_REGEX =
  /^\/devices\/([a-zA-Z0-9\-_%]+)\/tags\/([a-zA-Z0-9\-_%]+)\/?$/;
const PRESETS_REGEX = /^\/presets\/([a-zA-Z0-9\-_%]+)\/?$/;
const OBJECTS_REGEX = /^\/objects\/([a-zA-Z0-9\-_%]+)\/?$/;
const FILES_REGEX = /^\/files\/([a-zA-Z0-9%!*'();:@&=+$,?#[\]\-_.~]+)\/?$/;
const PING_REGEX = /^\/ping\/([a-zA-Z0-9\-_.:]+)\/?$/;
const QUERY_REGEX = /^\/([a-zA-Z0-9_]+)\/?$/;
const DELETE_DEVICE_REGEX = /^\/devices\/([a-zA-Z0-9\-_%]+)\/?$/;
const PROVISIONS_REGEX = /^\/provisions\/([a-zA-Z0-9\-_%]+)\/?$/;
const VIRTUAL_PARAMETERS_REGEX =
  /^\/virtual_parameters\/([a-zA-Z0-9\-_%]+)\/?$/;
const FAULTS_REGEX = /^\/faults\/([a-zA-Z0-9\-_%:]+)\/?$/;

async function getBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let readableEnded = false;
  request.on("end", () => {
    readableEnded = true;
  });
  for await (const chunk of request) chunks.push(chunk);
  // In Node versions prior to 15, the stream will not emit an error if the
  // connection is closed before the stream is finished.
  // For Node 12.9+ we can just use stream.readableEnded
  if (!readableEnded) throw new Error("Connection closed");
  return Buffer.concat(chunks);
}

export async function listener(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  response.setHeader("GenieACS-Version", VERSION);

  const origin = getRequestOrigin(request);
  const url = new URL(
    request.url,
    (origin.encrypted ? "https://" : "http://") + origin.host,
  );

  const body = await getBody(request).catch(() => null);
  // Ignore incomplete requests
  if (body == null) return;

  logger.accessInfo(
    Object.assign({}, Object.fromEntries(url.searchParams), {
      remoteAddress: origin.remoteAddress,
      message: `${request.method} ${url.pathname}`,
    }),
  );
  return handler(request, response, url, body);
}

async function handler(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  body: Buffer,
): Promise<void> {
  if (PRESETS_REGEX.test(url.pathname)) {
    const presetName = decodeURIComponent(PRESETS_REGEX.exec(url.pathname)[1]);
    if (request.method === "PUT") {
      let preset;
      try {
        preset = JSON.parse(body.toString());
      } catch (err) {
        response.writeHead(400);
        response.end(`${err.name}: ${err.message}`);
        return;
      }
      preset._id = presetName;
      await collections.presets.replaceOne({ _id: presetName }, preset, {
        upsert: true,
      });
      await cache.del("cwmp-local-cache-hash");
      response.writeHead(200);
      response.end();
    } else if (request.method === "DELETE") {
      await collections.presets.deleteOne({ _id: presetName });
      await cache.del("cwmp-local-cache-hash");
      response.writeHead(200);
      response.end();
    } else {
      response.writeHead(405, { Allow: "PUT, DELETE" });
      response.end("405 Method Not Allowed");
    }
  } else if (OBJECTS_REGEX.test(url.pathname)) {
    const objectName = decodeURIComponent(OBJECTS_REGEX.exec(url.pathname)[1]);
    if (request.method === "PUT") {
      let object;
      try {
        object = JSON.parse(body.toString());
      } catch (err) {
        response.writeHead(400);
        response.end(`${err.name}: ${err.message}`);
        return;
      }
      object._id = objectName;
      await collections.objects.replaceOne({ _id: objectName }, object, {
        upsert: true,
      });
      await cache.del("cwmp-local-cache-hash");
      response.writeHead(200);
      response.end();
    } else if (request.method === "DELETE") {
      await collections.objects.deleteOne({ _id: objectName });
      await cache.del("cwmp-local-cache-hash");
      response.writeHead(200);
      response.end();
    } else {
      response.writeHead(405, { Allow: "PUT, DELETE" });
      response.end("405 Method Not Allowed");
    }
  } else if (PROVISIONS_REGEX.test(url.pathname)) {
    const provisionName = decodeURIComponent(
      PROVISIONS_REGEX.exec(url.pathname)[1],
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

      await collections.provisions.replaceOne({ _id: provisionName }, object, {
        upsert: true,
      });
      await cache.del("cwmp-local-cache-hash");
      response.writeHead(200);
      response.end();
    } else if (request.method === "DELETE") {
      await collections.provisions.deleteOne({ _id: provisionName });
      await cache.del("cwmp-local-cache-hash");
      response.writeHead(200);
      response.end();
    } else {
      response.writeHead(405, { Allow: "PUT, DELETE" });
      response.end("405 Method Not Allowed");
    }
  } else if (VIRTUAL_PARAMETERS_REGEX.test(url.pathname)) {
    const virtualParameterName = decodeURIComponent(
      VIRTUAL_PARAMETERS_REGEX.exec(url.pathname)[1],
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

      await collections.virtualParameters.replaceOne(
        { _id: virtualParameterName },
        object,
        { upsert: true },
      );
      await cache.del("cwmp-local-cache-hash");
      response.writeHead(200);
      response.end();
    } else if (request.method === "DELETE") {
      await collections.virtualParameters.deleteOne({
        _id: virtualParameterName,
      });
      await cache.del("cwmp-local-cache-hash");
      response.writeHead(200);
      response.end();
    } else {
      response.writeHead(405, { Allow: "PUT, DELETE" });
      response.end("405 Method Not Allowed");
    }
  } else if (TAGS_REGEX.test(url.pathname)) {
    const r = TAGS_REGEX.exec(url.pathname);
    const deviceId = decodeURIComponent(r[1]);
    const tag = decodeURIComponent(r[2]);
    if (request.method === "POST") {
      const updateRes = await collections.devices.updateOne(
        { _id: deviceId },
        { $addToSet: { _tags: tag } },
      );

      if (!updateRes.matchedCount) {
        response.writeHead(404);
        response.end("No such device");
        return;
      }

      response.writeHead(200);
      response.end();
    } else if (request.method === "DELETE") {
      const updateRes = await collections.devices.updateOne(
        { _id: deviceId },
        { $pull: { _tags: tag } },
      );

      if (!updateRes.matchedCount) {
        response.writeHead(404);
        response.end("No such device");
        return;
      }

      response.writeHead(200);
      response.end();
    } else {
      response.writeHead(405, { Allow: "POST, DELETE" });
      response.end("405 Method Not Allowed");
    }
  } else if (FAULTS_REGEX.test(url.pathname)) {
    if (request.method === "DELETE") {
      const faultId = decodeURIComponent(FAULTS_REGEX.exec(url.pathname)[1]);
      try {
        await apiFunctions.deleteFault(faultId);
      } catch (err) {
        if (err instanceof ResourceLockedError) {
          response.writeHead(503);
          response.end("Device is in session");
          return;
        }
        throw err;
      }

      response.writeHead(200);
      response.end();
    } else {
      response.writeHead(405, { Allow: "DELETE" });
      response.end("405 Method Not Allowed");
    }
  } else if (DEVICE_TASKS_REGEX.test(url.pathname)) {
    if (request.method === "POST") {
      const deviceId = decodeURIComponent(
        DEVICE_TASKS_REGEX.exec(url.pathname)[1],
      );

      const conReq = url.searchParams.has("connection_request");
      let task;
      if (body.length) {
        try {
          task = JSON.parse(body.toString());
          task.device = deviceId;
        } catch (err) {
          response.writeHead(400);
          response.end(`${err.name}: ${err.message}`);
          return;
        }
      }

      if (!task && !conReq) {
        response.writeHead(400);
        response.end();
        return;
      }

      if (!task || !conReq) {
        const dev = await collections.devices.findOne({ _id: deviceId });
        if (!dev) {
          response.writeHead(404);
          response.end("No such device");
          return;
        }

        if (task) {
          await apiFunctions.insertTasks(task);
          response.writeHead(202, { "Content-Type": "application/json" });
          response.end(JSON.stringify(task));
        } else {
          const status = await apiFunctions.connectionRequest(
            deviceId,
            flattenDevice(dev),
          );
          if (status) {
            response.writeHead(504, status);
            response.end(status);
          } else {
            response.writeHead(200);
            response.end();
          }
        }
        return;
      }

      const socketTimeout: number = request.socket.timeout;

      // Extend socket timeout while waiting for session
      if (socketTimeout) request.socket.setTimeout(300000);

      const token = await acquireLock(`cwmp_session_${deviceId}`, 5000, 30000);
      if (!token) {
        // Restore socket timeout
        if (socketTimeout) request.socket.setTimeout(socketTimeout);
        const dev = await collections.devices.findOne({ _id: deviceId });
        if (!dev) {
          response.writeHead(404);
          response.end("No such device");
          return;
        }

        await apiFunctions.insertTasks(task);
        response.writeHead(202, "Task queued but not processed", {
          "Content-Type": "application/json",
        });
        response.end(JSON.stringify(task));
        return;
      }

      let dev;

      try {
        dev = await collections.devices.findOne({ _id: deviceId });
        if (!dev) {
          response.writeHead(404);
          response.end("No such device");
          return;
        }
        await apiFunctions.insertTasks(task);
      } finally {
        await releaseLock(`cwmp_session_${deviceId}`, token);
      }

      const lastInform = (dev["_lastInform"] as Date).getTime();
      const device = flattenDevice(dev);

      let onlineThreshold: number;
      if (url.searchParams.has("timeout")) {
        onlineThreshold = parseInt(url.searchParams.get("timeout"));
      } else {
        const revision = await getRevision();
        onlineThreshold = getConfig(
          revision,
          "cwmp.deviceOnlineThreshold",
          {},
          Date.now(),
          (exp) => {
            if (!Array.isArray(exp)) return exp;
            if (exp[0] === "PARAM") {
              const p = device[exp[1]];
              if (p?.value) return p.value[0];
            } else if (exp[0] === "FUNC") {
              if (exp[1] === "REMOTE_ADDRESS") {
                for (const root of ["InternetGatewayDevice", "Device"]) {
                  const p =
                    device[`${root}.ManagementServer.ConnectionRequestURL`];
                  if (p?.value) return new URL(p.value[0] as string).hostname;
                }
                return null;
              }
            }
            return exp;
          },
        ) as number;
      }

      let status = await apiFunctions.connectionRequest(deviceId, device);
      if (!status) {
        const sessionStarted = await apiFunctions.awaitSessionStart(
          deviceId,
          lastInform,
          onlineThreshold,
        );
        if (!sessionStarted) {
          status = "Task queued but not processed";
        } else {
          const sessionEnded = await apiFunctions.awaitSessionEnd(
            deviceId,
            120000,
          );
          if (!sessionEnded) {
            status = "Task queued but not processed";
          } else {
            const f = await collections.faults.count({
              _id: `${deviceId}:task_${task._id}`,
            });
            if (f) status = "Task faulted";
          }
        }
      }

      // Restore socket timeout
      if (socketTimeout) request.socket.setTimeout(socketTimeout);

      if (status) {
        response.writeHead(202, status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(task));
      } else {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(task));
      }
    } else {
      response.writeHead(405, { Allow: "POST" });
      response.end("405 Method Not Allowed");
    }
  } else if (TASKS_REGEX.test(url.pathname)) {
    const r = TASKS_REGEX.exec(url.pathname);
    const taskId = decodeURIComponent(r[1]);
    const action = r[2];
    if (!action || action === "/") {
      if (request.method === "DELETE") {
        const task = await collections.tasks.findOne(
          { _id: new ObjectId(taskId) },
          { projection: { device: 1 } },
        );

        if (!task) {
          response.writeHead(404);
          response.end("Task not found");
          return;
        }

        const deviceId = task.device;
        const token = await acquireLock(`cwmp_session_${deviceId}`, 5000);
        if (!token) {
          response.writeHead(503);
          response.end("Device is in session");
          return;
        }

        try {
          await Promise.all([
            collections.tasks.deleteOne({ _id: new ObjectId(taskId) }),
            collections.faults.deleteOne({ _id: `${deviceId}:task_${taskId}` }),
          ]);
        } finally {
          await releaseLock(`cwmp_session_${deviceId}`, token);
        }

        response.writeHead(200);
        response.end();
      } else {
        response.writeHead(405, { Allow: "PUT DELETE" });
        response.end("405 Method Not Allowed");
      }
    } else if (action === "/retry") {
      if (request.method === "POST") {
        const task = await collections.tasks.findOne(
          { _id: new ObjectId(taskId) },
          { projection: { device: 1 } },
        );

        const deviceId = task.device;
        const token = await acquireLock(`cwmp_session_${deviceId}`, 5000);
        if (!token) {
          response.writeHead(503);
          response.end("Device is in session");
          return;
        }
        try {
          await collections.faults.deleteOne({
            _id: `${deviceId}:task_${taskId}`,
          });
        } finally {
          await releaseLock(`cwmp_session_${deviceId}`, token);
        }

        response.writeHead(200);
        response.end();
      } else {
        response.writeHead(405, { Allow: "POST" });
        response.end("405 Method Not Allowed");
      }
    } else {
      response.writeHead(404);
      response.end();
    }
  } else if (FILES_REGEX.test(url.pathname)) {
    const filename = decodeURIComponent(FILES_REGEX.exec(url.pathname)[1]);
    if (request.method === "PUT") {
      const metadata = {
        fileType: request.headers.filetype,
        oui: request.headers.oui,
        productClass: request.headers.productclass,
        version: request.headers.version,
      };
      try {
        await filesBucket.delete(filename as unknown as ObjectId);
      } catch (err) {
        // Ignore error if file doesn't exist
      }

      return new Promise((resolve, reject) => {
        const uploadStream = filesBucket.openUploadStreamWithId(
          filename as unknown as ObjectId,
          filename,
          {
            metadata: metadata,
          },
        );

        uploadStream.on("error", reject);

        uploadStream.end(body, () => {
          response.writeHead(201);
          response.end();
          resolve();
        });
      });
    } else if (request.method === "DELETE") {
      try {
        await filesBucket.delete(filename as unknown as ObjectId);
      } catch (err) {
        if (err.message.startsWith("FileNotFound")) {
          response.writeHead(404);
          response.end("404 Not Found");
          return;
        }
        throw err;
      }
      response.writeHead(200);
      response.end();
    } else {
      response.writeHead(405, { Allow: "PUT, DELETE" });
      response.end("405 Method Not Allowed");
    }
  } else if (PING_REGEX.test(url.pathname)) {
    const host = decodeURIComponent(PING_REGEX.exec(url.pathname)[1]);
    return new Promise((resolve) => {
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
        resolve();
      });
    });
  } else if (DELETE_DEVICE_REGEX.test(url.pathname)) {
    if (request.method !== "DELETE") {
      response.writeHead(405, { Allow: "DELETE" });
      response.end("405 Method Not Allowed");
      return;
    }

    const deviceId = decodeURIComponent(
      DELETE_DEVICE_REGEX.exec(url.pathname)[1],
    );

    try {
      await apiFunctions.deleteDevice(deviceId);
    } catch (err) {
      if (err instanceof ResourceLockedError) {
        response.writeHead(503);
        response.end("Device is in session");
        return;
      }
      throw err;
    }

    response.writeHead(200);
    response.end();
  } else if (QUERY_REGEX.test(url.pathname)) {
    let collectionName = QUERY_REGEX.exec(url.pathname)[1];

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

    const collection = collections[collectionName] as Collection<unknown>;
    if (!collection) {
      response.writeHead(404);
      response.end("404 Not Found");
      return;
    }

    let q = {};
    if (url.searchParams.has("query")) {
      try {
        q = JSON.parse(url.searchParams.get("query") as string);
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
    if (url.searchParams.has("projection")) {
      projection = {};
      for (const p of (url.searchParams.get("projection") as string).split(","))
        projection[p.trim()] = 1;
      projection = optimizeProjection(projection);
    }

    const cur = collection.find(q, { projection: projection });

    if (url.searchParams.has("sort")) {
      let s;
      try {
        s = JSON.parse(url.searchParams.get("sort") as string);
      } catch (err) {
        response.writeHead(400);
        response.end(`${err.name}: ${err.message}`);
        return;
      }
      const sort = {};
      for (const [k, v] of Object.entries(s)) {
        if (k[k.lastIndexOf(".") + 1] !== "_" && collectionName === "devices")
          sort[`${k}._value`] = v;
        else sort[k] = v;
      }

      cur.sort(sort);
    }

    const total = await collection.countDocuments(q);

    response.writeHead(200, {
      "Content-Type": "application/json",
      total: total,
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    if (url.searchParams.has("skip"))
      cur.skip(parseInt(url.searchParams.get("skip") as string));

    if (url.searchParams.has("limit"))
      cur.limit(parseInt(url.searchParams.get("limit") as string));

    response.write("[\n");
    i = 0;
    for await (const item of cur) {
      if (i++) response.write(",\n");
      response.write(JSON.stringify(item));
    }
    response.end("\n]");
  } else {
    response.writeHead(404);
    response.end("404 Not Found");
  }
}
