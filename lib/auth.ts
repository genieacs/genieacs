import { createHash, randomBytes, pbkdf2 } from "node:crypto";

function parseHeaderFeilds(str: string): Record<string, string> {
  const res: Record<string, string> = {};
  const parts = str.split(",");

  let part: string | undefined;
  while ((part = parts.shift()) != null) {
    const name = part.split("=", 1)[0];
    if (name.length === part.length) {
      if (!part.trim()) continue;
      throw new Error("Unable to parse auth header");
    }

    let value = part.slice(name.length + 1);
    if (!/^\s*"/.test(value)) {
      value = value.trim();
    } else {
      while (!/[^\\]"\s*$/.test(value)) {
        const p = parts.shift();
        if (p == null) throw new Error("Unable to parse auth header");
        value += "," + p;
      }

      try {
        value = JSON.parse(value);
      } catch (error) {
        throw new Error("Unable to parse auth header", { cause: error });
      }
    }
    res[name.trim()] = value;
  }
  return res;
}

export interface AuthorizationHeader {
  method: string;
  username?: string;
  password?: string;
  nonce?: string;
  qop?: string;
  cnonce?: string;
  nc?: string;
  uri?: string;
  response?: string;
  body?: string;
  [key: string]: string | undefined;
}

export function parseAuthorizationHeader(
  authHeader: string,
): AuthorizationHeader {
  authHeader = authHeader.trim();
  const method = authHeader.split(" ", 1)[0];
  const res: AuthorizationHeader = { method: method };

  if (method === "Basic") {
    // Inspired by https://github.com/jshttp/basic-auth
    const USER_PASS_REGEX = /^([^:]*):(.*)$/;
    const creds = USER_PASS_REGEX.exec(
      Buffer.from(authHeader.slice(method.length + 1), "base64").toString(),
    );

    if (!creds) throw new Error("Unable to parse auth header");
    res.username = creds[1];
    res.password = creds[2];
  } else if (method === "Digest") {
    Object.assign(res, parseHeaderFeilds(authHeader.slice(method.length + 1)));
  }

  return res;
}

export function parseWwwAuthenticateHeader(
  authHeader: string,
): Record<string, string> {
  authHeader = authHeader.trim();
  const method = authHeader.split(" ", 1)[0];
  const res = { method: method };
  Object.assign(res, parseHeaderFeilds(authHeader.slice(method.length + 1)));
  return res;
}

export function basic(username: string, password: string): string {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

// Maps RFC 7616 digest algorithms to Node.js hash names
function getDigestHash(algorithm: string): string | undefined {
  switch (algorithm.toUpperCase()) {
    case "MD5":
    case "MD5-SESS":
      return "md5";
    case "SHA-256":
    case "SHA-256-SESS":
      return "sha256";
    case "SHA-512-256":
    case "SHA-512-256-SESS":
      return "sha512-256";
  }
  return undefined;
}

export function digest(
  username: string | Buffer,
  realm: string | Buffer,
  password: string | Buffer,
  nonce: string | Buffer,
  httpMethod: string | Buffer,
  uri: string | Buffer,
  qop?: string | Buffer,
  body?: string | Buffer,
  cnonce?: string | Buffer,
  nc?: string | Buffer,
  algorithm = "MD5",
): string {
  const sess = algorithm.toUpperCase().endsWith("-SESS");
  // Unsupported algorithms fall back to MD5 and fail authentication
  const hashName = getDigestHash(algorithm) ?? "md5";

  const ha1 = createHash(hashName);
  ha1.update(username).update(":").update(realm).update(":").update(password);
  let ha1d = ha1.digest("hex");

  if (sess) {
    ha1d = createHash(hashName)
      .update(ha1d)
      .update(":")
      .update(nonce)
      .update(":")
      .update(cnonce ?? "")
      .digest("hex");
  }

  const ha2 = createHash(hashName);
  ha2.update(httpMethod).update(":").update(uri);

  if (qop === "auth-int") {
    const bodyHash = createHash(hashName)
      .update(body || "")
      .digest("hex");
    ha2.update(":").update(bodyHash);
  }

  const ha2d = ha2.digest("hex");

  const hash = createHash(hashName);
  hash.update(ha1d).update(":").update(nonce);
  if (qop) {
    hash
      .update(":")
      .update(nc ?? "")
      .update(":")
      .update(cnonce ?? "")
      .update(":")
      .update(qop);
  }
  hash.update(":").update(ha2d);

  return hash.digest("hex");
}

export function solveDigest(
  username: string | Buffer,
  password: string | Buffer,
  uri: string | Buffer,
  httpMethod: string | Buffer,
  body: string | Buffer,
  authHeader: Record<string, string>,
): string {
  const cnonce = randomBytes(8).toString("hex");
  const nc = "00000001";

  let qop;
  if (authHeader.qop) {
    if (authHeader.qop.indexOf(",") !== -1) qop = "auth";
    // Either auth or auth-int, prefer auth
    else qop = authHeader.qop;
  }

  const hash = digest(
    username,
    authHeader.realm,
    password,
    authHeader.nonce,
    httpMethod,
    uri,
    qop,
    body,
    cnonce,
    nc,
    authHeader.algorithm,
  );

  let authString = `Digest username="${username}"`;
  authString += `,realm="${authHeader.realm}"`;
  authString += `,nonce="${authHeader.nonce}"`;
  authString += `,uri="${uri}"`;
  if (authHeader.algorithm) authString += `,algorithm=${authHeader.algorithm}`;
  if (qop) authString += `,qop=${qop},nc=${nc}`;
  // -sess algorithms hash the cnonce even without qop
  if (qop || authHeader.algorithm?.toUpperCase().endsWith("-SESS"))
    authString += `,cnonce="${cnonce}"`;
  authString += `,response="${hash}"`;
  if (authHeader.opaque) authString += `,opaque="${authHeader.opaque}"`;

  return authString;
}

export function generateSalt(length: number): Promise<string> {
  return new Promise((resolve, reject) => {
    randomBytes(length, (err, rand) => {
      if (err) return void reject(err);
      resolve(rand.toString("hex"));
    });
  });
}

export function hashPassword(pass: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    pbkdf2(pass, salt, 10000, 128, "sha512", (err, hash) => {
      if (err) return void reject(err);
      resolve(hash.toString("hex"));
    });
  });
}
