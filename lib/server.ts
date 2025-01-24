import { readFileSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import { Socket } from "node:net";
import * as path from "node:path";
import { ROOT_DIR } from "./config.ts";

let server: http.Server | https.Server;
let listener: http.RequestListener;
let stopping = false;

function closeServer(timeout, callback): void {
  if (!server) return void callback();

  setTimeout(() => {
    if (!callback) return;

    // Ignore HTTP requests from connection that may still be open
    server.removeListener("request", listener);
    server.setTimeout(1);

    const cb = callback;
    callback = null;
    setTimeout(cb, 1000);
  }, timeout).unref();

  server.close(() => {
    if (!callback) return;

    const cb = callback;
    callback = null;
    // Allow some time for connection close events to fire
    setTimeout(cb, 50);
  });
}

interface ServerOptions {
  port?: number;
  host?: string;
  ssl?: { key: string; cert: string };
  timeout?: number;
  keepAliveTimeout?: number;
  requestTimeout?: number;
  onConnection?: (socket: Socket) => void;
  onClientError?: (err: Error, socket: Socket) => void;
}

interface SocketEndpoint {
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  remoteFamily: "IPv4" | "IPv6";
}

// Save this info as they're not accessible after a socket has been closed
const socketEndpoints: WeakMap<Socket, SocketEndpoint> = new WeakMap();

type Promisify<T extends (...args: any) => any> = (
  ...args: Parameters<T>
) => Promise<ReturnType<T>>;

function getValidPrivKeys(value: string): Buffer[] {
  return value.split(":").map((str) => {
    str = str.trim();
    const buf = str.startsWith("-----BEGIN ")
      ? Buffer.from(str)
      : readFileSync(path.resolve(ROOT_DIR, str));
    return buf;
  });
}

function getValidCerts(value: string): Buffer[] {
  return value.split(":").map((str) => {
    str = str.trim();
    const buf = str.startsWith("-----BEGIN ")
      ? Buffer.from(str)
      : readFileSync(path.resolve(ROOT_DIR, str));
    return buf;
  });
}

export function start(
  options: ServerOptions,
  _listener: Promisify<http.RequestListener>,
): void {
  listener = (req, res) => {
    if (stopping) res.setHeader("Connection", "close");
    _listener(req, res).catch((err) => {
      try {
        res.socket.unref();
        if (res.headersSent) {
          res.writeHead(500, { Connection: "close" });
          res.end(`${err.name}: ${err.message}`);
        }
      } catch (err) {
        // Ignore
      }
      throw err;
    });
  };

  if (options.ssl) {
    const opts = {
      key: getValidPrivKeys(options.ssl.key),
      cert: getValidCerts(options.ssl.cert),
    };

    server = https.createServer(opts, listener);
    if (options.onConnection)
      server.on("secureConnection", options.onConnection);
  } else {
    server = http.createServer(listener);
    if (options.onConnection) server.on("connection", options.onConnection);
  }

  server.on("connection", (socket: Socket) => {
    socketEndpoints.set(socket, {
      localAddress: socket.localAddress,
      localPort: socket.localPort,
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
      remoteFamily: socket.remoteFamily as "IPv4" | "IPv6",
    });
  });

  if (options.onClientError) {
    server.on("clientError", (err, socket: Socket) => {
      if (err["code"] !== "ECONNRESET" && socket.writable)
        socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");

      // As per Node docs: This event is guaranteed to be passed an instance
      // of the <net.Socket> class
      options.onClientError(err, socket as Socket);
    });
  }

  server.timeout = options.timeout || 0;
  if (options.keepAliveTimeout != null)
    server.keepAliveTimeout = options.keepAliveTimeout;
  if (options.requestTimeout != null)
    server.requestTimeout = options.requestTimeout;

  server.listen({ port: options.port, host: options.host });
}

export function stop(terminateConnections = true): Promise<void> {
  stopping = terminateConnections;
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new Error("Could not close server in a timely manner"));
    }, 30000).unref();
    closeServer(20000, resolve);
  });
}

export function getSocketEndpoints(socket: Socket): SocketEndpoint {
  // TLSSocket keeps a reference to the raw TCP socket in _parent
  return socketEndpoints.get(socket["_parent"] ?? socket);
}
