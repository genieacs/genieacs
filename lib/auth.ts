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

import { createHash, randomBytes, pbkdf2 } from "crypto";

function parseHeaderFeilds(str: string): {} {
  const res = {};
  const parts = str.split(",");

  let part;
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
        throw new Error("Unable to parse auth header");
      }
    }
    res[name.trim()] = value;
  }
  return res;
}

export function parseAuthorizationHeader(authHeader): { method: string } {
  authHeader = authHeader.trim();
  const method = authHeader.split(" ", 1)[0];
  const res = { method: method };

  if (method === "Basic") {
    // Inspired by https://github.com/jshttp/basic-auth
    const USER_PASS_REGEX = /^([^:]*):(.*)$/;
    const creds = USER_PASS_REGEX.exec(
      Buffer.from(authHeader.slice(method.length + 1), "base64").toString()
    );

    if (!creds) throw new Error("Unable to parse auth header");
    res["username"] = creds[1];
    res["password"] = creds[2];
  } else if (method === "Digest") {
    Object.assign(res, parseHeaderFeilds(authHeader.slice(method.length + 1)));
  }

  return res;
}

export function parseWwwAuthenticateHeader(authHeader): {} {
  authHeader = authHeader.trim();
  const method = authHeader.split(" ", 1)[0];
  const res = { method: method };
  Object.assign(res, parseHeaderFeilds(authHeader.slice(method.length + 1)));
  return res;
}

export function basic(username, password): string {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
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
  nc?: string | Buffer
): string {
  const ha1 = createHash("md5");
  ha1
    .update(username)
    .update(":")
    .update(realm)
    .update(":")
    .update(password);
  // TODO support "MD5-sess" algorithm directive
  const ha1d = ha1.digest("hex");

  const ha2 = createHash("md5");
  ha2
    .update(httpMethod)
    .update(":")
    .update(uri);

  if (qop === "auth-int") {
    const bodyHash = createHash("md5")
      .update(body || "")
      .digest("hex");
    ha2.update(":").update(bodyHash);
  }

  const ha2d = ha2.digest("hex");

  const hash = createHash("md5");
  hash
    .update(ha1d)
    .update(":")
    .update(nonce);
  if (qop) {
    hash
      .update(":")
      .update(nc)
      .update(":")
      .update(cnonce)
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
  authHeader
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
    nc
  );

  let authString = `Digest username="${username}"`;
  authString += `,realm="${authHeader.realm}"`;
  authString += `,nonce="${authHeader.nonce}"`;
  authString += `,uri="${uri}"`;
  if (authHeader.algorithm) authString += `,algorithm=${authHeader.algorithm}`;
  if (qop) authString += `,qop=${qop},nc=${nc},cnonce="${cnonce}"`;
  authString += `,response="${hash}"`;
  if (authHeader.opaque) authString += `,opaque="${authHeader.opaque}"`;

  return authString;
}

export function generateSalt(length): Promise<string> {
  return new Promise((resolve, reject) => {
    randomBytes(length, (err, rand) => {
      if (err) return void reject(err);
      resolve(rand.toString("hex"));
    });
  });
}

export function hashPassword(pass, salt): Promise<string> {
  return new Promise((resolve, reject) => {
    pbkdf2(pass, salt, 10000, 128, "sha512", (err, hash) => {
      if (err) return void reject(err);
      resolve(hash.toString("hex"));
    });
  });
}
