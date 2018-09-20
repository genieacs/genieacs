"use strict";

import m from "mithril";
import config from "./config";
import * as expressionParser from "../common/expression-parser";
import * as expression from "../common/expression";
import memoize from "../common/memoize";

const memoizedStringify = memoize(expression.stringify);
const memoizedEvaluate = memoize(expression.evaluate);

let fulfillTimestamp = 0;

const queries = {
  filter: new WeakMap(),
  bookmark: new WeakMap(),
  limit: new WeakMap(),
  sort: new WeakMap(),
  fulfilled: new WeakMap(),
  fulfilling: new WeakSet(),
  accessed: new WeakMap(),
  value: new WeakMap()
};

const resources = {};
for (let r of [
  "devices",
  "faults",
  "files",
  "presets",
  "provisions",
  "virtualParameters"
])
  resources[r] = {
    objects: new Map(),
    count: new Map(),
    fetch: new Map(),
    combinedFilter: null
  };

class QueryResponse {
  get fulfilled() {
    queries.accessed.set(this, Date.now());
    return !!queries.fulfilled.get(this);
  }

  get value() {
    queries.accessed.set(this, Date.now());
    return queries.value.get(this);
  }
}

function unpackExpression(exp) {
  if (!Array.isArray(exp)) return exp;
  const e = memoizedEvaluate(exp, null, fulfillTimestamp);
  return e;
}

function count(resourceType, filter) {
  const filterStr = memoizedStringify(filter);
  let queryResponse = resources[resourceType].count.get(filterStr);
  if (queryResponse) return queryResponse;

  queryResponse = new QueryResponse();

  resources[resourceType].count.set(filterStr, queryResponse);
  queries.filter.set(queryResponse, filter);
  return queryResponse;
}

function limitFilter(filter, sort, bookmark) {
  const sortSort = (a, b) => Math.abs(b[1]) - Math.abs(a[1]);
  const arr = Object.entries(sort)
    .sort(sortSort)
    .reverse();
  return expression.and(
    filter,
    arr.reduce((cur, kv) => {
      const [param, asc] = kv;
      if (asc <= 0) {
        if (bookmark[param] == null)
          return expression.or(
            ["IS NOT NULL", ["PARAM", param]],
            expression.and(["IS NULL", ["PARAM", param]], cur)
          );

        let f = null;

        if (typeof bookmark[param] !== "string")
          f = expression.or(f, [">=", ["PARAM", param], ""]);

        f = expression.or(f, [">", ["PARAM", param], bookmark[param]]);
        return expression.or(
          f,
          expression.and(["=", ["PARAM", param], bookmark[param]], cur)
        );
      } else {
        let f = ["IS NULL", ["PARAM", param]];
        if (bookmark[param] == null) return expression.and(f, cur);

        if (typeof bookmark[param] !== "number") {
          f = expression.or(f, [">=", ["PARAM", param], 0]);
          f = expression.or(f, ["<", ["PARAM", param], 0]);
        }

        f = expression.or(f, ["<", ["PARAM", param], bookmark[param]]);

        return expression.or(
          f,
          expression.and(["=", ["PARAM", param], bookmark[param]], cur)
        );
      }
    }, true)
  );
}

function compareFunction(sort) {
  const sortEntries = Object.entries(sort).sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1])
  );

  return (a, b) => {
    for (const [param, asc] of sortEntries) {
      let v1 = a[param];
      let v2 = b[param];
      if (v1 != null && typeof v1 === "object")
        if (v1.value) v1 = v1.value[0];
        else v1 = null;

      if (v2 != null && typeof v2 === "object")
        if (v2.value) v2 = v2.value[0];
        else v2 = null;

      if (v1 > v2) {
        return asc;
      } else if (v1 < v2) {
        return asc * -1;
      } else if (v1 !== v2) {
        const w = {
          null: 1,
          number: 2,
          string: 3
        };
        const w1 = w[v1 == null ? "null" : typeof v1] || 4;
        const w2 = w[v2 == null ? "null" : typeof v2] || 4;
        return Math.max(-1, Math.min(1, w1 - w2)) * asc;
      }
    }
    return 0;
  };
}

function findMatches(resourceType, filter, sort, limit) {
  // Handle "tag =" and "tag <>" special cases
  if (resourceType === "devices")
    filter = expressionParser.map(filter, e => {
      if (
        Array.isArray(e) &&
        Array.isArray(e[1]) &&
        e[1][0] === "PARAM" &&
        e[1][1] === "tag"
      )
        if (e[0] === "=") return ["IS NOT NULL", ["PARAM", `Tags.${e[2]}`]];
        else if (e[0] === "<>") return ["IS NULL", ["PARAM", `Tags.${e[2]}`]];
      return e;
    });

  let value = [];
  for (let obj of resources[resourceType].objects.values())
    if (expression.evaluate(filter, obj, fulfillTimestamp))
      value.push(obj);

  value = value.sort(compareFunction(sort));
  if (limit) value = value.slice(0, limit);

  return value;
}

function inferQuery(resourceType, queryResponse) {
  const limit = queries.limit.get(queryResponse);
  let filter = queries.filter.get(queryResponse);
  filter = unpackExpression(filter);
  let bookmark = queries.bookmark.get(queryResponse);
  const sort = queries.sort.get(queryResponse);
  if (bookmark || !limit) {
    if (bookmark) filter = limitFilter(filter, sort, bookmark);
    if (
      resources[resourceType].combinedFilter &&
      expression.subset(filter, resources[resourceType].combinedFilter)
    )
      queries.fulfilled.set(queryResponse, fulfillTimestamp);
  }

  queries.value.set(
    queryResponse,
    findMatches(resourceType, filter, sort, limit)
  );
}

function fetch(resourceType, filter, options = {}) {
  const filterStr = memoizedStringify(filter);
  const sort = Object.assign({}, options.sort);
  for (const [k, v] of Object.entries(sort)) sort[k] += Math.sign(v);

  const limit = options.limit || 0;
  if (resourceType === "devices")
    sort["DeviceID.ID"] = sort["DeviceID.ID"] || 1;
  else sort["_id"] = sort["_id"] || 1;

  let key = `${filterStr}:${limit}:${JSON.stringify(sort)}`;
  let queryResponse = resources[resourceType].fetch.get(key);
  if (queryResponse) return queryResponse;

  queryResponse = new QueryResponse();
  resources[resourceType].fetch.set(key, queryResponse);
  queries.filter.set(queryResponse, filter);
  queries.limit.set(queryResponse, limit);
  queries.sort.set(queryResponse, sort);
  inferQuery(resourceType, queryResponse);
  return queryResponse;
}

function fulfill(accessTimestamp, _fulfillTimestamp) {
  let updated = false;

  if (_fulfillTimestamp > fulfillTimestamp) {
    for (let resource of Object.values(resources))
      resource.combinedFilter = null;
    fulfillTimestamp = _fulfillTimestamp;
  }

  const allPromises = [];

  for (let [resourceType, resource] of Object.entries(resources))
    for (let [queryResponseKey, queryResponse] of resource.count) {
      if (!(queries.accessed.get(queryResponse) >= accessTimestamp)) {
        resource.count.delete(queryResponseKey);
        continue;
      }

      if (queries.fulfilling.has(queryResponse)) continue;

      if (!(fulfillTimestamp <= queries.fulfilled.get(queryResponse))) {
        queries.fulfilling.add(queryResponse);
        allPromises.push(
          new Promise((resolve, reject) => {
            updated = true;
            let filter = queries.filter.get(queryResponse);
            filter = unpackExpression(filter);
            m.request({
              method: "HEAD",
              url:
                `/api/${resourceType}/?` +
                m.buildQueryString({
                  filter: memoizedStringify(filter)
                }),
              extract: xhr => +xhr.getResponseHeader("x-total-count"),
              background: true
            })
              .then(c => {
                queries.value.set(queryResponse, c);
                queries.fulfilled.set(queryResponse, fulfillTimestamp);
                queries.fulfilling.delete(queryResponse);
                resolve();
              })
              .catch(err => reject(err));
          })
        );
      }
    }

  let toFetchAll = {};

  for (let [resourceType, resource] of Object.entries(resources))
    for (let [queryResponseKey, queryResponse] of resource.fetch) {
      if (!(queries.accessed.get(queryResponse) >= accessTimestamp)) {
        resource.fetch.delete(queryResponseKey);
        continue;
      }

      if (queries.fulfilling.has(queryResponse)) continue;

      if (!(fulfillTimestamp <= queries.fulfilled.get(queryResponse))) {
        queries.fulfilling.add(queryResponse);
        toFetchAll[resourceType] = toFetchAll[resourceType] || [];
        toFetchAll[resourceType].push(queryResponse);
        const limit = queries.limit.get(queryResponse);
        const sort = queries.sort.get(queryResponse);
        if (limit)
          allPromises.push(
            new Promise((resolve, reject) => {
              updated = true;
              let filter = queries.filter.get(queryResponse);
              filter = unpackExpression(filter);
              m.request({
                method: "GET",
                url:
                  `/api/${resourceType}/?` +
                  m.buildQueryString({
                    filter: memoizedStringify(filter),
                    limit: 1,
                    skip: limit - 1,
                    sort: JSON.stringify(sort),
                    projection: Object.keys(sort).join(",")
                  })
              })
                .then(res => {
                  if (res.length) {
                    // Generate bookmark object
                    let bm = Object.keys(sort).reduce((b, k) => {
                      if (res[0][k] != null)
                        if (typeof res[0][k] === "object") {
                          if (res[0][k].value != null)
                            b[k] = res[0][k].value[0];
                        } else b[k] = res[0][k];

                      return b;
                    }, {});
                    queries.bookmark.set(queryResponse, bm);
                  } else {
                    queries.bookmark.delete(queryResponse);
                  }
                  resolve();
                })
                .catch(reject);
            })
          );
      }
    }

  return new Promise((resolve, reject) => {
    Promise.all(allPromises)
      .then(() => {
        const allPromises2 = [];
        for (let [resourceType, toFetch] of Object.entries(toFetchAll)) {
          let combinedFilter = null;

          toFetch = toFetch.filter(queryResponse => {
            let filter = queries.filter.get(queryResponse);
            filter = unpackExpression(filter);
            const limit = queries.limit.get(queryResponse);
            const bookmark = queries.bookmark.get(queryResponse);
            const sort = queries.sort.get(queryResponse);
            if (bookmark) filter = limitFilter(filter, sort, bookmark);

            if (
              resources[resourceType].combinedFilter &&
              expression.subset(filter, resources[resourceType].combinedFilter)
            ) {
              queries.value.set(
                queryResponse,
                findMatches(resourceType, filter, sort, limit)
              );
              queries.fulfilled.set(queryResponse, fulfillTimestamp);
              queries.fulfilling.delete(queryResponse);
              return false;
            }

            combinedFilter = expression.or(combinedFilter, filter);
            return true;
          });

          if (combinedFilter == null) continue;

          updated = true;
          let deleted = new Set();
          if (!resources[resourceType].combinedFilter)
            deleted = new Set(resources[resourceType].objects.keys());
          let combinedFilterDiff = combinedFilter;
          if (resources[resourceType].combinedFilter)
            combinedFilterDiff = expression.and(
              combinedFilterDiff,
              expression.not(resources[resourceType].combinedFilter)
            );
          resources[resourceType].combinedFilter = expression.or(
            combinedFilter,
            resources[resourceType].combinedFilter
          );

          allPromises2.push(
            new Promise((resolve2, reject2) => {
              m.request({
                method: "GET",
                url:
                  `/api/${resourceType}/?` +
                  m.buildQueryString({
                    filter: memoizedStringify(combinedFilterDiff)
                  })
              })
                .then(res => {
                  for (let r of res) {
                    const id =
                      resourceType === "devices"
                        ? r["DeviceID.ID"].value[0]
                        : r["_id"];
                    resources[resourceType].objects.set(id, r);
                    deleted.delete(id);
                  }

                  for (let d of deleted) {
                    const obj = resources[resourceType].objects.get(d);
                    if (
                      expression.evaluate(
                        combinedFilterDiff,
                        obj,
                        fulfillTimestamp
                      )
                    )
                      resources[resourceType].objects.delete(d);
                  }

                  for (let queryResponse of toFetch) {
                    let filter = queries.filter.get(queryResponse);
                    filter = unpackExpression(filter);
                    const limit = queries.limit.get(queryResponse);
                    const bookmark = queries.bookmark.get(queryResponse);
                    const sort = queries.sort.get(queryResponse);
                    if (bookmark) filter = limitFilter(filter, sort, bookmark);

                    queries.value.set(
                      queryResponse,
                      findMatches(resourceType, filter, sort, limit)
                    );
                    queries.fulfilled.set(queryResponse, fulfillTimestamp);
                    queries.fulfilling.delete(queryResponse);
                  }
                  resolve2();
                })
                .catch(reject2);
            })
          );
        }
        Promise.all(allPromises2)
          .then(() => resolve(updated))
          .catch(reject);
      })
      .catch(reject);
  });
}

function getTimestamp() {
  return fulfillTimestamp;
}

function postTasks(deviceId, tasks) {
  for (let t of tasks) {
    t.status = "pending";
    t.device = deviceId;
  }

  return new Promise((resolve, reject) => {
    m.request({
      method: "POST",
      url: `/api/devices/${encodeURIComponent(deviceId)}/tasks`,
      data: tasks,
      extract: xhr => {
        if (xhr.status !== 200) throw new Error(xhr.response);
        const connectionRequestStatus = xhr.getResponseHeader(
          "Connection-Request"
        );
        let st = JSON.parse(xhr.response);
        for (let [i, t] of st.entries()) {
          tasks[i]._id = t._id;
          tasks[i].status = t.status;
          tasks[i].fault = t.fault;
        }
        resolve(connectionRequestStatus);
      }
    }).catch(reject);
  });
}

function updateTags(deviceId, tags) {
  return m.request({
    method: "POST",
    url: `/api/devices/${encodeURIComponent(deviceId)}/tags`,
    data: tags
  });
}

function deleteResource(resourceType, id) {
  return m.request({
    method: "DELETE",
    url: `/api/${resourceType}/${encodeURIComponent(id)}`
  });
}

function putResource(resourceType, id, object) {
  for (let k in object) if (object[k] === undefined) object[k] = null;

  return m.request({
    method: "PUT",
    url: `/api/${resourceType}/${encodeURIComponent(id)}`,
    data: object
  });
}

function resourceExists(resource, id) {
  const param = resource === "devices" ? "DeviceID.ID" : "_id";
  let filter = ["=", ["PARAM", param], id];
  return m.request({
    method: "HEAD",
    url:
      `/api/${resource}/?` +
      m.buildQueryString({
        filter: memoizedStringify(filter)
      }),
    extract: xhr => +xhr.getResponseHeader("x-total-count"),
    background: true
  });
}

function evaluateExpression(exp, obj) {
  if (!Array.isArray(exp)) return exp;
  return memoizedEvaluate(exp, obj, fulfillTimestamp);
}

function logIn(username, password) {
  return m.request({
    method: "POST",
    url: "/login",
    background: true,
    data: { username, password }
  });
}

function logOut() {
  return m.request({
    method: "POST",
    url: "/logout"
  });
}

function ping(host) {
  return m.request({
    url: `/api/ping/${encodeURIComponent(host)}`
  });
}

export {
  count,
  fetch,
  fulfill,
  unpackExpression,
  getTimestamp,
  postTasks,
  updateTags,
  deleteResource,
  putResource,
  resourceExists,
  evaluateExpression,
  logIn,
  logOut,
  ping
};
