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

import * as crypto from "crypto";
import * as dgram from "dgram";
import * as URL from "url";
import * as http from "http";
import * as config from "./config";
import * as db from "./db";
import * as common from "./common";
import * as auth from "./auth";
import * as cache from "./cache";

function udpConReq(address, un, key, callback): boolean {
  if (!address) return false;

  let [host, port] = address.split(":", 2);

  if (!port) {
    port = 80;
  } else {
    port = parseInt(port);
    if (isNaN(port)) return false;
  }

  const ts = Math.trunc(Date.now() / 1000);
  const id = Math.trunc(Math.random() * 4294967295);
  const cn = crypto.randomBytes(8).toString("hex");
  const sig = crypto
    .createHmac("sha1", key)
    .update(`${ts}${id}${un}${cn}`)
    .digest("hex");
  const uri = `http://${address}?ts=${ts}&id=${id}&un=${un}&cn=${cn}&sig=${sig}`;
  const message = Buffer.from(
    `GET ${uri} HTTP/1.1\r\nHost: ${address}\r\n\r\n`
  );

  const client = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const UDP_CONNECTION_REQUEST_PORT = +config.get(
    "UDP_CONNECTION_REQUEST_PORT"
  );

  if (UDP_CONNECTION_REQUEST_PORT)
    // When a device is NAT'ed, the UDP Connection Request must originate from
    // the same address and port used by the STUN server, in order to traverse
    // the firewall. This does require that the Genieacs NBI and STUN server
    // are allowed to bind to the same address and port. The STUN server needs
    // to open its UDP port with the SO_REUSEADDR option, allowing the NBI to
    // also bind to the same port.
    client.bind({ port: UDP_CONNECTION_REQUEST_PORT, exclusive: true });

  let count = 3;
  const func = (err: Error): void => {
    if (err || --count <= 0) {
      client.close();
      return void callback(err);
    }
    client.send(message, 0, message.length, port, host, func);
  };
  client.send(message, 0, message.length, port, host, func);
  return true;
}

function httpConReq(
  url,
  username,
  password,
  allowBasicAuth,
  timeout,
  callback
): void {
  const options: http.RequestOptions = URL.parse(url);
  if (options.protocol !== "http:") {
    return void callback(
      new Error("Invalid connection request URL or protocol")
    );
  }
  options.agent = new http.Agent({ maxSockets: 1 });

  function statusToError(statusCode): Error {
    switch (statusCode) {
      case 200:
      case 204:
        return null;
      case 401:
        return new Error("Incorrect connection request credentials");
      case 0:
        return new Error("Device is offline");
      default:
        return new Error(`Unexpected response code from device: ${statusCode}`);
    }
  }

  const request = http
    .get(options, response => {
      if (response.statusCode === 401 && response.headers["www-authenticate"]) {
        const authHeader = auth.parseAuthHeader(
          response.headers["www-authenticate"]
        );
        if (authHeader["method"] === "Basic") {
          if (!allowBasicAuth) {
            request.abort();
            return void callback(
              new Error("Basic HTTP authentication not allowed")
            );
          }
          options.headers = {
            Authorization: auth.basic(username || "", password || "")
          };
        } else if (authHeader["method"] === "Digest") {
          options.headers = {
            Authorization: auth.digest(
              username || "",
              password || "",
              options.path,
              "GET",
              null,
              authHeader
            )
          };
        }

        const req = http
          .get(options, res => {
            if (res.statusCode === 0) {
              // Workaround for some devices unexpectedly closing the connection
              const req2 = http
                .get(options, res2 => {
                  callback(statusToError(res2.statusCode));
                  res2.resume();
                })
                .on("error", () => {
                  req2.abort();
                  callback(statusToError(0));
                })
                .on("socket", socket => {
                  socket.setTimeout(timeout);
                  socket.on("timeout", () => {
                    req2.abort();
                  });
                });
            } else {
              callback(statusToError(res.statusCode));
            }
            res.resume();
          })
          .on("error", () => {
            req.abort();
            callback(statusToError(0));
          })
          .on("socket", socket => {
            socket.setTimeout(timeout);
            socket.on("timeout", () => {
              req.abort();
            });
          });
      } else {
        callback(statusToError(response.statusCode));
      }
      // No listener for data so emit resume
      response.resume();
    })
    .on("error", () => {
      request.abort();
      callback(statusToError(0));
    })
    .on("socket", socket => {
      socket.setTimeout(timeout);
      socket.on("timeout", () => {
        request.abort();
      });
    });
}

export function connectionRequest(deviceId, callback): void {
  const CONNECTION_REQUEST_TIMEOUT = config.get(
    "CONNECTION_REQUEST_TIMEOUT",
    deviceId
  );
  const CONNECTION_REQUEST_ALLOW_BASIC_AUTH = config.get(
    "CONNECTION_REQUEST_ALLOW_BASIC_AUTH",
    deviceId
  );
  const options = {
    projection: {
      "Device.ManagementServer.ConnectionRequestURL._value": 1,
      "Device.ManagementServer.UDPConnectionRequestAddress._value": 1,
      "Device.ManagementServer.ConnectionRequestUsername._value": 1,
      "Device.ManagementServer.ConnectionRequestPassword._value": 1,
      "InternetGatewayDevice.ManagementServer.ConnectionRequestURL._value": 1,
      "InternetGatewayDevice.ManagementServer.UDPConnectionRequestAddress._value": 1,
      "InternetGatewayDevice.ManagementServer.ConnectionRequestUsername._value": 1,
      "InternetGatewayDevice.ManagementServer.ConnectionRequestPassword._value": 1
    }
  };

  db.devicesCollection.findOne({ _id: deviceId }, options, (err, device) => {
    if (err) return void callback(err);
    if (!device) return void callback(new Error("No such device"));

    let managementServer,
      connectionRequestUrl,
      udpConnectionRequestAddress,
      username,
      password;
    if (device.Device)
      // TR-181 data model
      managementServer = device.Device.ManagementServer;
    // TR-098 data model
    else managementServer = device.InternetGatewayDevice.ManagementServer;

    if (managementServer.ConnectionRequestURL)
      connectionRequestUrl = managementServer.ConnectionRequestURL._value;
    if (managementServer.UDPConnectionRequestAddress) {
      udpConnectionRequestAddress =
        managementServer.UDPConnectionRequestAddress._value;
    }
    if (managementServer.ConnectionRequestUsername)
      username = managementServer.ConnectionRequestUsername._value;
    if (managementServer.ConnectionRequestPassword)
      password = managementServer.ConnectionRequestPassword._value;

    const conReq = (): void => {
      const udpSent = udpConReq(
        udpConnectionRequestAddress,
        username,
        password,
        err => {
          if (err) throw err;
        }
      );

      httpConReq(
        connectionRequestUrl,
        username,
        password,
        CONNECTION_REQUEST_ALLOW_BASIC_AUTH,
        CONNECTION_REQUEST_TIMEOUT,
        err => {
          if (udpSent) return void callback();
          callback(err);
        }
      );
    };

    if (config.auth && config.auth.connectionRequest) {
      // Callback is optional for backward compatibility
      if (config.auth.connectionRequest.length > 4) {
        return void config.auth.connectionRequest(
          deviceId,
          connectionRequestUrl,
          username,
          password,
          (u, p) => {
            username = u;
            password = p;
            conReq();
          }
        );
      }
      [username, password] = config.auth.connectionRequest(
        deviceId,
        connectionRequestUrl,
        username,
        password
      );
    }
    conReq();
  });
}

export function watchTask(deviceId, taskId, timeout, callback): void {
  setTimeout(() => {
    db.tasksCollection.findOne(
      { _id: taskId },
      { projection: { _id: 1 } },
      (err, task) => {
        if (err) return void callback(err);

        if (!task) return void callback(null, "completed");

        const q = { _id: `${deviceId}:task_${taskId}` };
        db.faultsCollection.findOne(
          q,
          { projection: { _id: 1 } },
          (err, fault) => {
            if (err) return void callback(err);

            if (fault) return void callback(null, "fault");

            if ((timeout -= 500) <= 0) return void callback(null, "timeout");

            watchTask(deviceId, taskId, timeout, callback);
          }
        );
      }
    );
  }, 500);
}

function sanitizeTask(task, callback): void {
  task.timestamp = new Date(task.timestamp || Date.now());
  if (task.expiry) {
    if (common.typeOf(task.expiry) === common.DATE_TYPE || isNaN(task.expiry))
      task.expiry = new Date(task.expiry);
    else task.expiry = new Date(task.timestamp.getTime() + +task.expiry * 1000);
  }

  callback(task);
}

export function insertTasks(tasks, callback): void {
  if (tasks && common.typeOf(tasks) !== common.ARRAY_TYPE) tasks = [tasks];
  else if (!tasks || tasks.length === 0)
    return void callback(null, tasks || []);

  let counter = tasks.length;
  for (const task of tasks) {
    sanitizeTask(task, t => {
      if (t.uniqueKey) {
        db.tasksCollection.deleteOne(
          { device: t.device, uniqueKey: t.uniqueKey },
          () => {}
        );
      }

      if (--counter === 0) db.tasksCollection.insertMany(tasks, callback);
    });
  }
}

export function deleteDevice(deviceId, callback): void {
  db.tasksCollection.deleteMany({ device: deviceId }, err => {
    if (err) return void callback(err);
    db.devicesCollection.deleteOne({ _id: deviceId }, err => {
      if (err) return void callback(err);
      db.faultsCollection.deleteMany(
        {
          _id: {
            $regex: `^${common.escapeRegExp(deviceId)}\\:`
          }
        },
        err => {
          if (err) return void callback(err);
          db.operationsCollection.deleteMany(
            {
              _id: {
                $regex: `^${common.escapeRegExp(deviceId)}\\:`
              }
            },
            err => {
              if (err) return void callback(err);
              cache.del(`${deviceId}_tasks_faults_operations`, callback);
            }
          );
        }
      );
    });
  });
}
