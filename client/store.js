"use strict";

import m from "mithril";
import config from "./config";
import * as expressionParser from "../common/expression-parser";
import * as expression from "../common/expression";
import * as funcCache from "../common/func-cache";

let fulfillTimestamp = 0;

let unpackExpressionCache = new WeakMap();
let evaluateExpressionCache = new WeakMap();

const queries = {
  filter: new WeakMap(),
  last: new WeakMap(),
  limit: new WeakMap(),
  fulfilled: new WeakMap(),
  fulfilling: new WeakSet(),
  mapper: new WeakMap(),
  accessed: new WeakMap(),
  value: new WeakMap()
};

const resources = {};
for (let r of ["devices", "faults", "files"])
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
    const mapper = queries.mapper.get(this);
    const value = queries.value.get(this);

    if (mapper) return mapper(queries.value.get(this));
    else return value;
  }
}

function unpackExpression(exp) {
  if (!Array.isArray(exp)) return exp;
  let e = unpackExpressionCache.get(exp);
  if (e === undefined) {
    e = expression.evaluate(e, null, fulfillTimestamp);
    unpackExpressionCache.set(exp, e);
  }
  return e;
}

function count(resourceType, filter) {
  const filterStr = funcCache.get(expression.stringify, filter);
  let queryResponse = resources[resourceType].count.get(filterStr);
  if (queryResponse) return queryResponse;

  queryResponse = new QueryResponse();

  resources[resourceType].count.set(filterStr, queryResponse);
  queries.filter.set(queryResponse, filter);
  return queryResponse;
}

function limitFilter(resourceType, filter, last) {
  if (resourceType === "devices")
    return expression.and(filter, ["<=", ["PARAM", "DeviceID.ID"], last]);
  else return expression.and(filter, ["<=", ["PARAM", "_id"], last]);
}

function findMatches(resourceType, filter, limit) {
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
  for (let [id, obj] of resources[resourceType].objects.entries())
    if (expression.evaluate(filter, obj, fulfillTimestamp))
      value.push(id);

  value = value.sort();
  if (limit) value = value.slice(0, limit);

  return value;
}

function inferQuery(resourceType, queryResponse) {
  const limit = queries.limit.get(queryResponse);
  let filter = queries.filter.get(queryResponse);
  filter = unpackExpression(filter);
  let last = queries.last.get(queryResponse);
  if (last || !limit) {
    if (last) filter = limitFilter(resourceType, filter, last);
    if (
      resources[resourceType].combinedFilter &&
      expression.subset(filter, resources[resourceType].combinedFilter)
    )
      queries.fulfilled.set(queryResponse, fulfillTimestamp);
  }

  queries.value.set(queryResponse, findMatches(resourceType, filter, limit));
}

function fetch(resourceType, filter, limit = 0) {
  const filterStr = funcCache.get(expression.stringify, filter);
  const key = `${limit}:${filterStr}`;
  let queryResponse = resources[resourceType].fetch.get(key);
  if (queryResponse) return queryResponse;

  queryResponse = new QueryResponse();
  resources[resourceType].fetch.set(key, queryResponse);
  queries.filter.set(queryResponse, filter);
  queries.limit.set(queryResponse, limit);
  queries.mapper.set(queryResponse, list =>
    list.map(x => resources[resourceType].objects.get(x))
  );
  inferQuery(resourceType, queryResponse);
  return queryResponse;
}

function fulfill(accessTimestamp, _fulfillTimestamp) {
  let updated = false;

  if (_fulfillTimestamp > fulfillTimestamp) {
    unpackExpressionCache = new WeakMap();
    evaluateExpressionCache = new WeakMap();

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
            m
              .request({
                method: "HEAD",
                url:
                  `/api/${resourceType}/?` +
                  m.buildQueryString({
                    filter: funcCache.get(expression.stringify, filter)
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
        if (limit)
          allPromises.push(
            new Promise((resolve, reject) => {
              updated = true;
              let filter = queries.filter.get(queryResponse);
              filter = unpackExpression(filter);
              m
                .request({
                  method: "GET",
                  url:
                    `/api/${resourceType}/?` +
                    m.buildQueryString({
                      filter: funcCache.get(expression.stringify, filter),
                      limit: 1,
                      skip: limit - 1,
                      projection: "_id"
                    })
                })
                .then(res => {
                  if (res.length)
                    if (resourceType === "devices")
                      queries.last.set(
                        queryResponse,
                        res[0]["DeviceID.ID"].value[0]
                      );
                    else queries.last.set(queryResponse, res[0]["_id"]);
                  else queries.last.delete(queryResponse);
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
            let last = queries.last.get(queryResponse);
            if (last) filter = limitFilter(resourceType, filter, last);

            if (
              resources[resourceType].combinedFilter &&
              expression.subset(filter, resources[resourceType].combinedFilter)
            ) {
              queries.value.set(
                queryResponse,
                findMatches(resourceType, filter)
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
              m
                .request({
                  method: "GET",
                  url:
                    `/api/${resourceType}/?` +
                    m.buildQueryString({
                      filter: funcCache.get(
                        expression.stringify,
                        combinedFilterDiff
                      )
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
                    let last = queries.last.get(queryResponse);
                    if (last) filter = limitFilter(resourceType, filter, last);

                    queries.value.set(
                      queryResponse,
                      findMatches(resourceType, filter)
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
    m
      .request({
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
      })
      .catch(reject);
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

function evaluateExpression(exp, obj) {
  if (!Array.isArray(exp)) return exp;

  let exps = evaluateExpressionCache.get(exp);
  if (!exps) evaluateExpressionCache.set(exp, (exps = new WeakMap()));

  if (!exps.has(obj)) {
    let v = expression.evaluate(exp, obj, fulfillTimestamp);
    exps.set(obj, v);
  }

  return exps.get(obj);
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
  evaluateExpression,
  logIn,
  logOut,
  ping
};
