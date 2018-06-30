"use strict";

let cache1 = new WeakMap();
let cache2 = new WeakMap();

function get(func, k) {
  let c1 = cache1.get(func);
  if (!c1) cache1.set(func, (c1 = new Map()));
  if (c1.has(k)) return c1.get(k);
  const c2 = cache2.get(func);
  const v = c2 && c2.has(k) ? c2.get(k) : func(k);
  c1.set(k, v);
  return v;
}

function getter(func) {
  return k => get(func, k);
}

function purge() {
  cache2 = cache1;
  cache1 = new WeakMap();
}

exports.get = get;
exports.getter = getter;
exports.purge = purge;
