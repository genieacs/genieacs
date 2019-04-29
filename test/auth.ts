import ava from "ava";
import { randomBytes } from "crypto";
import * as auth from "../lib/auth";

ava("digest", t => {
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
    `Digest realm="${realm}",nonce="${nonce}",qop="auth-int"`
  ];

  t.plan(challenges.length);

  for (const challenge of challenges) {
    const wwwAuthHeader = auth.parseWwwAuthenticateHeader(challenge);
    const solution = auth.solveDigest(
      username,
      password,
      uri,
      method,
      body,
      wwwAuthHeader
    );
    const authHeader = auth.parseAuthorizationHeader(solution);
    t.is(
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
        authHeader["nc"]
      )
    );
  }
});
