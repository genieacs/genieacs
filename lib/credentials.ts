import { createHmac, randomBytes } from "node:crypto";

import * as config from "./config.ts";
import { collections } from "./db/db.ts";
import Expression from "./common/expression.ts";
import { del } from "./cache.ts";
import { putProvision } from "./ui/db.ts";
import INFORM_SCRIPT from "../seed/inform.js" with { type: "text" };
import LEGACY_INFORM_SCRIPT from "../seed/inform.legacy.js" with { type: "text" };

export { LEGACY_INFORM_SCRIPT };

function evaluateConfigString(value: string): string {
  try {
    const lit = Expression.parse(value).evaluate((e) => e);
    if (lit instanceof Expression.Literal && typeof lit.value === "string")
      return lit.value;
  } catch {
    // Fall through
  }
  return "";
}

export function deriveCredentialHash(
  secret: string,
  ...parts: string[]
): string {
  return createHmac("sha256", secret)
    .update(parts.join("\0"))
    .digest("base64url")
    .slice(0, 24);
}

export function buildRngSeed(
  deviceId: string,
  randomSeed = "",
  extra = "",
): string {
  const parts = [deviceId];
  if (randomSeed) parts.push(randomSeed);
  if (extra) parts.push(String(extra));
  return parts.join("\0");
}

export function resolveCredentialsSecretFromEnv(): string {
  return String(config.get("CWMP_CREDENTIALS_SECRET") || "");
}

export function resolveRandomSeedFromEnv(): string {
  return String(config.get("CWMP_RANDOM_SEED") || "");
}

export function resolveCredentialsSecretSync(fromDb = ""): string {
  return resolveCredentialsSecretFromEnv() || fromDb || "";
}

export function resolveRandomSeedSync(fromDb = ""): string {
  return resolveRandomSeedFromEnv() || fromDb || "";
}

async function loadConfigString(id: string): Promise<string> {
  const doc = await collections.config.findOne({ _id: id });
  if (!doc?.value) return "";
  return evaluateConfigString(doc.value);
}

/**
 * Ensure a credentials secret exists (env or DB) and migrate the stock inform
 * provision when it still matches the legacy Math.random script.
 */
export async function ensureCredentials(): Promise<void> {
  if (!resolveCredentialsSecretFromEnv()) {
    const existing = await loadConfigString("cwmp.credentialsSecret");
    if (!existing) {
      const secret = randomBytes(32).toString("hex");
      await collections.config.findOneAndUpdate(
        { _id: "cwmp.credentialsSecret" },
        { $setOnInsert: { value: JSON.stringify(secret) } },
        { upsert: true },
      );
      await Promise.all([
        del("cwmp-local-cache-hash"),
        del("ui-local-cache-hash"),
      ]);
    }
  }

  const provision = await collections.provisions.findOne({ _id: "inform" });
  if (provision?.script === LEGACY_INFORM_SCRIPT) {
    await putProvision("inform", { script: INFORM_SCRIPT });
    await del("cwmp-local-cache-hash");
  }
}
