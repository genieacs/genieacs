/**
 * Copyright 2013-2020  GenieACS Inc.
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

import * as net from "net";
import * as tls from "tls";
import { EventEmitter } from "events";
import { createHash, createHmac, randomBytes } from "crypto";
import { parseXml, Element, parseAttrs } from "./xml-parser";

function encodeBase64(str: string): string {
  return Buffer.from(str).toString("base64");
}

function decodeBase64(str: string): string {
  return Buffer.from(str, "base64").toString();
}

function detectStreamTag(data: string): number {
  const i1 = data.indexOf("<stream:stream");
  if (i1 < 0) throw new Error("Cannot detect opening stream tag");
  const i2 = data.indexOf(">", i1);
  if (i2 < 0) throw new Error("Cannot detect opening stream tag");
  return i2 + 1;
}

function xmppStream<T>(
  socket: net.Socket,
  callback: Generator<void, T, Element>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => {
      socket.removeListener("error", onError);
      reject(err);
    };
    socket.on("error", onError);

    const onData = (chunk: Buffer): void => {
      try {
        const str = chunk.toString("utf8");
        const xml = parseXml(str);
        const { value, done } = callback.next(xml.children[0]);
        if (done) {
          socket.removeListener("error", onError);
          socket.removeListener("data", onData);
          resolve(value as T);
        }
      } catch (err) {
        socket.removeListener("error", onError);
        socket.removeListener("data", onData);
        reject(err);
      }
    };

    socket.once("data", (chunk: Buffer) => {
      try {
        const str = chunk.toString("utf8");
        const i = detectStreamTag(str);
        const streamTagStr = str.slice(0, i);
        const xml = parseXml(streamTagStr + "</stream:stream>");
        callback.next(xml.children[0]);
        chunk = chunk.slice(Buffer.byteLength(streamTagStr));
        if (chunk.length) onData(chunk);
        socket.on("data", onData);
      } catch (err) {
        socket.removeListener("error", onError);
        socket.removeListener("data", onData);
        reject(err);
      }
    });

    try {
      callback.next();
    } catch (err) {
      socket.removeListener("error", onError);
      socket.removeListener("data", onData);
      reject(err);
    }
  });
}

const INT_1 = Buffer.from([0, 0, 0, 1]);
const saltedPasswordCache = {
  password: "",
  iterationCount: 0,
  saltBase64: "",
  salted: Buffer.allocUnsafe(0),
};

function saltPassword(
  password: string,
  saltBase64: string,
  iteractionCount: number
): Buffer {
  if (
    password === saltedPasswordCache.password &&
    saltBase64 === saltedPasswordCache.saltBase64 &&
    iteractionCount === saltedPasswordCache.iterationCount
  )
    return saltedPasswordCache.salted;

  const hi = createHmac("sha1", password)
    .update(Buffer.concat([Buffer.from(saltBase64, "base64"), INT_1]))
    .digest();
  let hi2: Buffer = hi;
  for (let i = 1; i < iteractionCount; ++i) {
    hi2 = createHmac("sha1", password).update(hi2).digest();
    for (const [j, b] of hi2.entries()) hi[j] ^= b;
  }

  saltedPasswordCache.saltBase64 = saltBase64;
  saltedPasswordCache.password = password;
  saltedPasswordCache.iterationCount = iteractionCount;
  saltedPasswordCache.salted = hi;

  return hi;
}

function* login(
  socket: net.Socket,
  username: string,
  password: string
): Generator<void, void, Element> {
  const cnonce = randomBytes(8).toString("base64");
  const gs2Header = "n,,";
  const clientFirstMessageBare = `n=${username},r=${cnonce}`;
  const clientFirstMessage = gs2Header + clientFirstMessageBare;
  socket.write(
    `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="SCRAM-SHA-1">${encodeBase64(
      clientFirstMessage
    )}</auth>`
  );
  const res1 = yield;
  if (res1.name !== "challenge")
    throw new Error(`Unexpected element ${res1.name}`);
  const serverFirstMessage = decodeBase64(res1.text);

  let iterationCount: number;
  let saltBase64: string;
  let nonce: string;
  for (const s of serverFirstMessage.split(",")) {
    if (s.startsWith("i=")) iterationCount = parseInt(s.slice(2));
    else if (s.startsWith("s=")) saltBase64 = s.slice(2);
    else if (s.startsWith("r=")) nonce = s.slice(2);
  }
  if (iterationCount == null || isNaN(iterationCount))
    throw new Error("Invalid iteration count");
  if (saltBase64 == null) throw new Error("Missing salt");
  if (nonce == null) throw new Error("Missing nonce");

  const saltedPassword = saltPassword(password, saltBase64, iterationCount);
  const clientKey = createHmac("sha1", saltedPassword)
    .update("Client Key")
    .digest();
  const storedKey = createHash("sha1").update(clientKey).digest();

  const clientFinalMessageWithoutProof = `c=${encodeBase64(
    gs2Header
  )},r=${nonce}`;
  const authMessage = `${clientFirstMessageBare},${serverFirstMessage},${clientFinalMessageWithoutProof}`;
  const clientSignature = createHmac("sha1", storedKey)
    .update(authMessage)
    .digest();

  const clientProof = Buffer.from(clientKey);
  for (const [i, b] of clientSignature.entries()) clientProof[i] ^= b;

  const clientFinalMessage = `${clientFinalMessageWithoutProof},p=${clientProof.toString(
    "base64"
  )}`;
  socket.write(
    `<response xmlns="urn:ietf:params:xml:ns:xmpp-sasl">${encodeBase64(
      clientFinalMessage
    )}</response>`
  );
  const res2 = yield;

  if (
    res2.name === "failure" &&
    res2.children.some((c) => c.name === "not-authorized")
  )
    throw new Error("Not authorized");

  if (res2.name !== "success")
    throw new Error(`Unexpected response ${res2.name}`);

  const serverKey = createHmac("sha1", saltedPassword)
    .update("Server Key")
    .digest();
  const serverSignature = createHmac("sha1", serverKey)
    .update(authMessage)
    .digest("base64");

  if (!decodeBase64(res2.text).endsWith(serverSignature))
    throw new Error("Invalid server signature");
}

function* starttls(socket: net.Socket): Generator<void, void, Element> {
  socket.write("<starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'/>");
  const res1 = yield;
  if (res1.name !== "proceed") throw new Error("Failed to initiate STARTTLS");
}

function* bind(
  socket: net.Socket,
  resource: string
): Generator<void, void, Element> {
  const id = randomBytes(8).toString("base64");
  socket.write(
    `<iq id='${id}' type='set'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><resource>${resource}</resource></bind></iq>`
  );
  const res1 = yield;
  if (res1.name !== "iq") throw new Error(`Unexpected element ${res1.name}`);
  const attrs1 = parseAttrs(res1.attrs);
  const idAttr = attrs1.find((a) => a.name === "id");
  if (!idAttr || idAttr.value !== id) throw new Error("Invalid ID");
  const typeAttr = attrs1.find((a) => a.name === "type");
  if (!typeAttr) throw new Error("Missing type attribute");
  if (typeAttr.value !== "result") throw new Error("Cannot bind to resource");
}

const STATUS_RESTART_STREAM = 1;
const STATUS_STARTTLS = 2;

function* init(
  socket: net.Socket,
  host: string,
  username: string,
  password: string,
  resource: string
): Generator<void, number, Element> {
  socket.write(
    `<?xml version='1.0'?><stream:stream from='${username}@${host}' to='${host}' version='1.0' xml:lang='en' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams'>`
  );
  const open = yield;
  if (open.name !== "stream:stream")
    throw new Error(`Unexpected element ${open.name}`);
  const features = yield;
  if (features.name !== "stream:features")
    throw new Error(`Unexpected element ${features.name}`);
  for (const feature of features.children) {
    if (feature.name === "starttls") {
      if (feature.children.some((c) => c.name === "required")) {
        yield* starttls(socket);
        return STATUS_STARTTLS;
      }
    } else if (feature.name === "mechanisms") {
      const mechanisms: Set<string> = new Set(
        feature.children.map((c) => c.text)
      );
      if (mechanisms.has("SCRAM-SHA-1")) {
        yield* login(socket, username, password);
        return STATUS_RESTART_STREAM;
      }
    } else if (feature.name === "bind") {
      if (feature.children.some((c) => c.name === "required")) {
        yield* bind(socket, resource);
        return 0;
      }
    }
  }
  return 0;
}

function upgradeTls(socket: net.Socket, host: string): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    socket.on("error", reject);
    const newSocket = tls.connect({ socket, host }, () => {
      socket.removeListener("error", reject);
      resolve(newSocket);
    });
  });
}

interface XmppClientOptions {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  resource?: string;
}

export class XmppClient extends EventEmitter {
  private _socket: net.Socket;
  private _host: string;
  private _username: string;
  private _resource: string;

  private constructor() {
    super();
    this._socket = null;
    this._host = null;
    this._username = null;
    this._resource = null;
  }

  static connect(opts: XmppClientOptions): Promise<XmppClient> {
    return new Promise((resolve, reject) => {
      let socket = new net.Socket();
      socket.on("error", reject);

      socket.connect(opts.port || 5222, opts.host, async () => {
        socket.removeListener("error", reject);
        try {
          let status = 1;
          while (status) {
            if (status === STATUS_STARTTLS)
              socket = await upgradeTls(socket, opts.host);
            status = await xmppStream(
              socket,
              init(
                socket,
                opts.host,
                opts.username,
                opts.password,
                opts.resource
              )
            );
          }

          const client = new XmppClient();
          client._socket = socket;
          client._host = opts.host;
          client._username = opts.username;
          client._resource = opts.resource;
          socket.on("data", client._onData);
          socket.on("error", client._onError);
          resolve(client);
        } catch (err) {
          socket.destroy();
          reject(err);
        }
      });
    });
  }

  disconnect(): void {
    this._socket.removeListener("data", this._onData);
    this._socket.removeListener("error", this._onError);
    this._socket.end();
  }

  get host(): string {
    return this._host;
  }

  get username(): string {
    return this._username;
  }

  get resource(): string {
    return this._resource;
  }

  private _onData(chunk: Buffer): void {
    try {
      const str = chunk.toString("utf8");
      const xml = parseXml(str);
      for (const c of xml.children) this.emit("stanza", c);
    } catch (err) {
      this.emit("error", err);
    }
  }

  private _onError(err: Error): void {
    this._socket.end();
    this.emit("error", err);
  }

  send(msg: string): void {
    this._socket.write(msg);
  }
}
