"use strict";

import m from "mithril";
import Filter from "../common/filter";
import * as config from "./config";
import * as filterParser from "../common/filter-parser";

let fulfillTimestamp = 0;

let unpackedFiltersCache = new WeakMap();
let expressionsCache = new WeakMap();

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
for (let r of ["devices", "faults"])
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

function unpackFilter(filter) {
  let f = unpackedFiltersCache.get(filter);
  if (!f) {
    f = f.evaluateExpressions(fulfillTimestamp);
    unpackedFiltersCache.set(filter, f);
  }
  return f;
}

function count(resourceType, filter) {
  let queryResponse = resources[resourceType].count.get(filter.toString());
  if (queryResponse) return queryResponse;

  queryResponse = new QueryResponse();

  resources[resourceType].count.set(filter.toString(), queryResponse);
  queries.filter.set(queryResponse, filter);
  return queryResponse;
}

function limitFilter(resourceType, filter, last) {
  if (resourceType === "devices")
    return filter.and(new Filter(["<=", "DeviceID.ID", last]));
  else return filter.and(new Filter(["<=", "_id", last]));
}

function findMatches(resourceType, filter, limit) {
  // Handle "tag =" and "tag <>" special cases
  if (resourceType === "devices" && filter.ast) {
    const ast = filterParser.map(filter.ast, e => {
      if (e[1] === "tag")
        if (e[0] === "=") return ["=", `Tags.${e[2]}`, true];
        else if (e[0] === "<>") return ["NOT", ["=", `Tags.${e[2]}`, true]];
    });
    filter = new Filter(ast);
  }

  let value = [];
  for (let [id, obj] of resources[resourceType].objects.entries())
    if (filter.test(obj)) value.push(id);

  value = value.sort();
  if (limit) value = value.slice(0, limit);

  return value;
}

function inferQuery(resourceType, queryResponse) {
  const limit = queries.limit.get(queryResponse);
  let filter = queries.filter.get(queryResponse);
  filter = unpackFilter(filter);
  let last = queries.last.get(queryResponse);
  if (last || !limit) {
    if (last) filter = limitFilter(resourceType, filter, last);
    if (
      resources[resourceType].combinedFilter &&
      filter.subset(resources[resourceType].combinedFilter)
    )
      queries.fulfilled.set(queryResponse, fulfillTimestamp);
  }

  queries.value.set(queryResponse, findMatches(resourceType, filter, limit));
}

function fetch(resourceType, filter, limit = 0) {
  const key = `${limit}:${filter.toString()}`;
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
    unpackedFiltersCache = new WeakMap();
    expressionsCache = new WeakMap();

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
            filter = unpackFilter(filter);
            m
              .request({
                method: "HEAD",
                url:
                  `/api/${resourceType}/?` +
                  m.buildQueryString({
                    filter: filter.toString()
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
              filter = unpackFilter(filter);
              m
                .request({
                  method: "GET",
                  url:
                    `/api/${resourceType}/?` +
                    m.buildQueryString({
                      filter: filter.toString(),
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
            filter = unpackFilter(filter);
            let last = queries.last.get(queryResponse);
            if (last) filter = limitFilter(resourceType, filter, last);

            if (
              resources[resourceType].combinedFilter &&
              filter.subset(resources[resourceType].combinedFilter)
            ) {
              queries.value.set(
                queryResponse,
                findMatches(resourceType, filter)
              );
              queries.fulfilled.set(queryResponse, fulfillTimestamp);
              queries.fulfilling.delete(queryResponse);
              return false;
            }

            combinedFilter = filter.or(combinedFilter);
            return true;
          });

          if (!combinedFilter) return resolve(updated);

          updated = true;
          let deleted = new Set();
          if (!resources[resourceType].combinedFilter)
            deleted = new Set(resources[resourceType].objects.keys());
          let combinedFilterDiff = combinedFilter;
          if (resources[resourceType].combinedFilter)
            combinedFilterDiff = combinedFilterDiff.and(
              resources[resourceType].combinedFilter.not()
            );
          resources[resourceType].combinedFilter = combinedFilter.or(
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
                      filter: combinedFilterDiff.toString()
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
                    if (combinedFilterDiff.test(obj))
                      resources[resourceType].objects.delete(d);
                  }

                  for (let queryResponse of toFetch) {
                    let filter = queries.filter.get(queryResponse);
                    filter = unpackFilter(filter);
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

function evaluateExpression(exp, device) {
  if (!Array.isArray(exp)) return exp;

  let exps = expressionsCache.get(exp);
  if (!exps) expressionsCache.set(exp, (exps = new WeakMap()));

  if (!exps.has(device)) {
    let v = filterParser.evaluateExpressions(exp, e => {
      if (e[0] === "FUNC" && e[1] === "NOW") return fulfillTimestamp;
    });
    exps.set(device, v);
  }

  return exps.get(device);
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
  unpackFilter,
  getTimestamp,
  postTasks,
  updateTags,
  deleteResource,
  evaluateExpression,
  logIn,
  logOut,
  ping
};
