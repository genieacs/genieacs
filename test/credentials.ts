import test from "node:test";
import assert from "node:assert";
import { buildRngSeed, deriveCredentialHash } from "../lib/credentials.ts";

void test("deriveCredentialHash is stable for same inputs", () => {
  const a = deriveCredentialHash("secret", "device-1");
  const b = deriveCredentialHash("secret", "device-1");
  assert.strictEqual(a, b);
  assert.strictEqual(a.length, 24);
});

void test("deriveCredentialHash depends on secret", () => {
  const a = deriveCredentialHash("secret-a", "device-1");
  const b = deriveCredentialHash("secret-b", "device-1");
  assert.notStrictEqual(a, b);
});

void test("deriveCredentialHash depends on material", () => {
  const a = deriveCredentialHash("secret", "device-1");
  const b = deriveCredentialHash("secret", "device-2");
  assert.notStrictEqual(a, b);
});

void test("buildRngSeed without optional parts matches deviceId", () => {
  assert.strictEqual(buildRngSeed("dev-1"), "dev-1");
});

void test("buildRngSeed includes random seed and extra", () => {
  assert.strictEqual(buildRngSeed("dev-1", "rs"), "dev-1\0rs");
  assert.strictEqual(buildRngSeed("dev-1", "rs", "extra"), "dev-1\0rs\0extra");
  assert.strictEqual(buildRngSeed("dev-1", "", "extra"), "dev-1\0extra");
});
