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
    `Digest realm="${realm}",nonce="${nonce}",qop="auth",algorithm=SHA-256`,
    `Digest realm="${realm}",nonce="${nonce}",qop="auth",algorithm=MD5-sess`,
    `Digest realm="${realm}",nonce="${nonce}",algorithm=MD5-sess`,
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
    assert.strictEqual(authHeader["algorithm"], wwwAuthHeader["algorithm"]);
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
        authHeader["algorithm"],
      ),
    );
  }
});

void test("digest matches RFC 7616 examples and curl", () => {
  const args = [
    "Mufasa",
    "http-auth@example.org",
    "Circle of Life",
    "7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v",
    "GET",
    "/dir/index.html",
    "auth",
    "",
  ] as const;
  const cnonce = "f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ";

  assert.strictEqual(
    auth.digest(...args, cnonce, "00000001", "MD5"),
    "8ca523f5e9506fed4657c9700eebdbec",
  );
  assert.strictEqual(
    auth.digest(...args, cnonce, "00000001", "SHA-256"),
    "753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1",
  );

  // Response from RFC 7616 erratum 4897, which corrects the example
  assert.strictEqual(
    auth.digest(
      "Jäsøn Doe",
      "api@example.org",
      "Secret, or not?",
      "5TsQWLVdgBdmrQ0XsxbDODV+57QdFR34I9HAbC/RVvkK",
      "GET",
      "/doe.json",
      "auth",
      "",
      "NTg6RKcb9boFIAS3KrFK9BGeh+iDa/sm6jUMp2wds69v",
      "00000001",
      "SHA-512-256",
    ),
    "3798d4131c277846293534c3edc11bd8a5e4cdcbff78b05db9d95eeb1cec68a5",
  );

  // RFC 7616 has no -sess example, so this one comes from curl 8.21.0
  assert.strictEqual(
    auth.digest(...args, "cjKSYz5Mws0VM1po", "00000001", "SHA-256-sess"),
    "5a5108bf4f80359018b15c0a057f68590bb95678186329493dc9dd1b24a67850",
  );
});
