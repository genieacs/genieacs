import * as net from "node:net";
import * as tls from "node:tls";
import { EventEmitter } from "node:events";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { parseXml, Element, parseAttrs } from "./xml-parser.ts";

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
  callback: Generator<void, T, Element>,
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
  iteractionCount: number,
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

function* loginPlain(
  socket: net.Socket,
  username: string,
  password: string,
): Generator<void, void, Element> {
  socket.write(
    `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="PLAIN">${encodeBase64(
      `\x00${username}\x00${password}`,
    )}</auth>`,
  );
  const res1 = yield;

  if (
    res1.name === "failure" &&
    res1.children.some((c) => c.name === "not-authorized")
  )
    throw new Error("Not authorized");

  if (res1.name !== "success")
    throw new Error(`Unexpected response ${res1.name}`);
}

function* loginScram(
  socket: net.Socket,
  username: string,
  password: string,
): Generator<void, void, Element> {
  const cnonce = randomBytes(8).toString("base64");
  const gs2Header = "n,,";
  const clientFirstMessageBare = `n=${username},r=${cnonce}`;
  const clientFirstMessage = gs2Header + clientFirstMessageBare;
  socket.write(
    `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="SCRAM-SHA-1">${encodeBase64(
      clientFirstMessage,
    )}</auth>`,
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
    gs2Header,
  )},r=${nonce}`;
  const authMessage = `${clientFirstMessageBare},${serverFirstMessage},${clientFinalMessageWithoutProof}`;
  const clientSignature = createHmac("sha1", storedKey)
    .update(authMessage)
    .digest();

  const clientProof = Buffer.from(clientKey);
  for (const [i, b] of clientSignature.entries()) clientProof[i] ^= b;

  const clientFinalMessage = `${clientFinalMessageWithoutProof},p=${clientProof.toString(
    "base64",
  )}`;
  socket.write(
    `<response xmlns="urn:ietf:params:xml:ns:xmpp-sasl">${encodeBase64(
      clientFinalMessage,
    )}</response>`,
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
  resource: string,
): Generator<void, void, Element> {
  const id = randomBytes(8).toString("base64");
  socket.write(
    `<iq id='${id}' type='set'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><resource>${resource}</resource></bind></iq>`,
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
  resource: string,
): Generator<void, number, Element> {
  socket.write(
    `<?xml version='1.0'?><stream:stream from='${username}@${host}' to='${host}' version='1.0' xml:lang='en' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams'>`,
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
        feature.children.map((c) => c.text),
      );
      if (mechanisms.has("PLAIN")) {
        yield* loginPlain(socket, username, password);
        return STATUS_RESTART_STREAM;
      } else if (mechanisms.has("SCRAM-SHA-1")) {
        yield* loginScram(socket, username, password);
        return STATUS_RESTART_STREAM;
      } else {
        throw new Error("No supported SASL method");
      }
    } else if (feature.name === "bind") {
      yield* bind(socket, resource);
      return 0;
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
  timeout?: number;
}

export default class XmppClient extends EventEmitter {
  private _socket: net.Socket;
  private _host: string;
  private _username: string;
  private _resource: string;
  private _iqStanzaCallbacks: Map<
    string,
    (err: Error, r?: { rawRes: string; res: Element }) => void
  >;

  private constructor() {
    super();
    this._socket = null;
    this._host = null;
    this._username = null;
    this._resource = null;
    this._iqStanzaCallbacks = new Map();
  }

  static async connect(opts: XmppClientOptions): Promise<XmppClient> {
    function connectSocket(host: string, port: number): Promise<net.Socket> {
      return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        socket.on("error", reject);
        socket.connect(port, host, () => {
          socket.removeListener("error", reject);
          resolve(socket);
        });
      });
    }

    let socket = await connectSocket(opts.host, opts.port || 5222);
    try {
      let status = 1;
      while (status) {
        if (status === STATUS_STARTTLS)
          socket = await upgradeTls(socket, opts.host);
        status = await xmppStream(
          socket,
          init(socket, opts.host, opts.username, opts.password, opts.resource),
        );
      }
    } catch (err) {
      socket.destroy();
      throw err;
    }

    const client = new XmppClient();
    client._socket = socket;
    client._host = opts.host;
    client._username = opts.username;
    client._resource = opts.resource;
    socket.on("data", client._onData.bind(client));
    socket.on("error", client._onError.bind(client));
    if (opts.timeout)
      socket.setTimeout(opts.timeout, client.close.bind(client));
    return client;
  }

  close(): void {
    this._socket.end("</stream:stream>");
    this._socket.removeAllListeners("data");
    this._socket.removeAllListeners("error");
    this.emit("close");
  }

  ref(): void {
    this._socket.ref();
  }

  unref(): void {
    this._socket.unref();
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
      let close = false;
      let str = chunk.toString("utf8");
      if (str.endsWith("</stream:stream>")) {
        str = str.slice(0, -16);
        close = true;
      }
      const xml = parseXml(str);
      const idx = xml.children.map((c) => c.bodyIndex);
      for (const [i, c] of xml.children.entries()) {
        const s = str.slice(idx[i], idx[i + 1]);
        if (c.name === "iq") {
          const attrs = parseAttrs(c.attrs);
          const id = attrs.find((a) => a.name === "id");
          if (id) {
            const cb = this._iqStanzaCallbacks.get(id.value);
            if (cb) cb(null, { rawRes: s, res: c });
          }
        }
        this.emit("stanza", c, s);
      }
      if (close) {
        this._socket.removeAllListeners("data");
        this._socket.removeAllListeners("error");
        this.emit("close");
      }
    } catch (err) {
      this._socket.removeAllListeners("data");
      this._socket.removeAllListeners("error");
      this.emit("error", err);
    }
  }

  private _onError(err: Error): void {
    this._socket.end();
    this.emit("error", err);
    for (const cb of this._iqStanzaCallbacks.values()) cb(err);
  }

  send(msg: string): void {
    this._socket.write(msg);
  }

  sendIqStanza(
    from: string,
    to: string,
    type: string,
    body: string,
    timeout = 3000,
  ): Promise<{ rawReq: string; rawRes: string; res: Element }> {
    return new Promise((resolve, reject) => {
      const id = randomBytes(8).toString("base64");
      const rawReq = `<iq from="${from}" to="${to}" id="${id}" type="${type}">${body}</iq>`;
      this.send(rawReq);
      const t = setTimeout(() => {
        this._iqStanzaCallbacks.delete(id);
        reject(
          new Error("Did not receive IQ stanza response in a timely manner"),
        );
      }, timeout);
      this._iqStanzaCallbacks.set(id, (err, r) => {
        this._iqStanzaCallbacks.delete(id);
        clearTimeout(t);
        if (err) reject(err);
        else resolve(Object.assign(r, { rawReq }));
      });
    });
  }
}
