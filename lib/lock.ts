import { collections } from "./db/db.ts";

const CLOCK_SKEW_TOLERANCE = 30000;

export async function acquireLock(
  lockName: string,
  ttl: number,
  timeout = 0,
  token = Math.random().toString(36).slice(2),
): Promise<string> {
  try {
    const now = Date.now();
    const r = await collections.locks.findOneAndUpdate(
      { _id: lockName, value: token },
      {
        $set: {
          expire: new Date(now + ttl + CLOCK_SKEW_TOLERANCE),
        },
        $currentDate: { timestamp: true },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (Math.abs(r.value.timestamp.getTime() - now) > CLOCK_SKEW_TOLERANCE)
      throw new Error("Database clock skew too great");
  } catch (err) {
    if (err.code !== 11000) throw err;
    if (!(timeout > 0)) return null;
    const w = 50 + Math.random() * 50;
    await new Promise((resolve) => setTimeout(resolve, w));
    return acquireLock(lockName, ttl, timeout - w, token);
  }

  return token;
}

export async function releaseLock(
  lockName: string,
  token: string,
): Promise<void> {
  const res = await collections.locks.deleteOne({
    _id: lockName,
    value: token,
  });
  if (res.deletedCount !== 1) throw new Error("Lock expired");
}

export async function getToken(lockName: string): Promise<string> {
  const res = await collections.locks.findOne({ _id: lockName });
  return res?.value;
}
