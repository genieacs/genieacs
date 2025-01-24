let cache1 = new Map();
let cache2 = new Map();
const keys = new WeakMap();

function getKey(obj): string {
  if (obj === null) return "null";
  else if (obj === undefined) return "undefined";

  const t = typeof obj;
  if (t === "number" || t === "boolean" || t === "string") return `${t}:${obj}`;
  if (t !== "function" && t !== "object")
    throw new Error(`Cannot memoize ${t} arguments`);

  let k = keys.get(obj);
  if (!k) {
    const rnd = Math.trunc(Math.random() * Number.MAX_SAFE_INTEGER);
    k = `${t}:${rnd.toString(36)}`;
    keys.set(obj, k);
  }
  return k;
}

export default function memoize<T extends (...args: any[]) => any>(func: T): T {
  const funcKey = getKey(func);
  return ((...args) => {
    const key = JSON.stringify(args.map(getKey)) + funcKey;

    if (cache1.has(key)) return cache1.get(key);

    let r;
    if (cache2.has(key)) {
      cache1.set(key, (r = cache2.get(key)));
    } else {
      cache1.set(key, (r = func(...args)));
      // Evict rejected promises
      if (r instanceof Promise) {
        r.catch(() => {
          cache1.delete(key);
          cache2.delete(key);
        });
      }
    }
    return r;
  }) as any;
}

const interval = setInterval(() => {
  cache2 = cache1;
  cache1 = new Map();
}, 120000);

// Don't hold Node.js process
if (interval.unref) interval.unref();
