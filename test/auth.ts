import test from "node:test";
import assert from "node:assert";
import { randomBytes } from "node:crypto";
import * as auth from "../lib/auth.ts";

void test("digest", () => {
  const username = "test";
  const password = "test";
  const uri = "/";
  const method = "POST";
  const realm = "GeniceACS";
  const nonce = randomBytes(16).toString("hex");
  const body = randomBytes(128).toString();

  const challenges = [
    `Digest realm="${realm}",nonce="${nonce}"`,
    `Digest realm="${realm}",nonce="${nonce}",qop="auth"`,
    `Digest realm="${realm}",nonce="${nonce}",qop="auth-int"`,
  ];

  for (const challenge of challenges) {
    const wwwAuthHeader = auth.parseWwwAuthenticateHeader(challenge);
    const solution = auth.solveDigest(
      username,
      password,
      uri,
      method,
      body,
      wwwAuthHeader,
    );
    const authHeader = auth.parseAuthorizationHeader(solution);
    assert.strictEqual(
      authHeader["response"],
      auth.digest(
        username,
        realm,
        password,
        nonce,
        method,
        uri,
        authHeader["qop"],
        body,
        authHeader["cnonce"],
        authHeader["nc"],
      ),
    );
  }
});
