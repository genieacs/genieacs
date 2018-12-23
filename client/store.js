"use strict";

import m from "mithril";
import Filter from "../common/filter";
import * as config from "./config";

let fulfillTimestamp = 0;

let unpackedFilters = new WeakMap();

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
for (let r of ["devices"])
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
  let f = unpackedFilters.get(filter);
  if (!f) {
    f = f.evaluateExpressions(fulfillTimestamp);
    unpackedFilters.set(filter, f);
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
    unpackedFilters = new WeakMap();
    for (let resource of Object.values(resources))
      resource.combinedFilter = null;
    fulfillTimestamp = _fulfillTimestamp;
  }

  const allPromises = [];

  for (let [resourceType, resource] of Object.entries(resources))
    for (let queryResponse of resource.count.values()) {
      if (queries.fulfilling.has(queryResponse)) continue;
      if (
        queries.accessed.get(queryResponse) >= accessTimestamp &&
        !(fulfillTimestamp <= queries.fulfilled.get(queryResponse))
      ) {
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
    for (let queryResponse of resource.fetch.values()) {
      if (queries.fulfilling.has(queryResponse)) continue;

      if (
        queries.accessed.get(queryResponse) >= accessTimestamp &&
        !(fulfillTimestamp <= queries.fulfilled.get(queryResponse))
      ) {
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
                  for (let r of res)
                    if (resourceType === "devices")
                      resources.devices.objects.set(
                        r["DeviceID.ID"].value[0],
                        r
                      );
                    else resources[resourceType].objects.set(r["_id"], r);

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

function postTasks(tasks, callback) {
  return new Promise((resolve, reject) => {
    let devices = {};
    for (let t of tasks) {
      t.status = "pending";
      devices[t.device] = devices[t.device] || [];
      devices[t.device].push(t);
    }

    let promises = [];
    for (let [deviceId, tasks2] of Object.entries(devices))
      promises.push(
        m.request({
          method: "POST",
          url: `/api/devices/${encodeURIComponent(deviceId)}/tasks`,
          data: tasks2,
          extract: xhr => {
            const connectionRequestStatus = xhr.getResponseHeader(
              "Connection-Request"
            );
            let st = JSON.parse(xhr.response);
            for (let [i, t] of st.entries()) {
              tasks2[i]._id = t._id;
              tasks2[i].status = t.status;
              tasks2[i].fault = t.fault;
            }
            if (callback) callback(deviceId, connectionRequestStatus, tasks2);
          }
        })
      );

    Promise.all(promises)
      .then(() => resolve(tasks))
      .catch(err => {
        callback = null;
        reject(err);
      });
  });
}

export { count, fetch, fulfill, unpackFilter, getTimestamp, postTasks };
