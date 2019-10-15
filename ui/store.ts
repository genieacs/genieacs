/**
 * Copyright 2013-2019  GenieACS Inc.
 *
 * This file is part of GenieACS.
 *
 * GenieACS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * GenieACS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
 */

import m from "mithril";
import { stringify } from "../lib/common/expression-parser";
import { or, and, not, evaluate, subset } from "../lib/common/expression";
import memoize from "../lib/common/memoize";
import { QueryOptions, Expression } from "../lib/types";
import * as notifications from "./notifications";
import { configSnapshot, genieacsVersion } from "./config";

const memoizedStringify = memoize(stringify);
const memoizedEvaluate = memoize(evaluate);

let fulfillTimestamp = 0;
let connectionNotification, configNotification, versionNotification;

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

interface Resources {
  [resource: string]: {
    objects: Map<string, any>;
    count: Map<string, QueryResponse>;
    fetch: Map<string, QueryResponse>;
    combinedFilter: Expression;
  };
}

const resources: Resources = {};
for (const r of [
  "devices",
  "faults",
  "files",
  "presets",
  "provisions",
  "virtualParameters",
  "files",
  "config",
  "users",
  "permissions"
]) {
  resources[r] = {
    objects: new Map(),
    count: new Map(),
    fetch: new Map(),
    combinedFilter: null
  };
}

class QueryResponse {
  public get fulfilled(): boolean {
    queries.accessed.set(this, Date.now());
    return !!queries.fulfilled.get(this);
  }

  public get fulfilling(): boolean {
    queries.accessed.set(this, Date.now());
    return queries.fulfilling.has(this);
  }

  public get value(): any {
    queries.accessed.set(this, Date.now());
    return queries.value.get(this);
  }
}

function checkConnection(): void {
  m.request({
    url: "/status",
    method: "GET",
    background: true,
    extract: xhr => {
      if (xhr.status !== 200) {
        if (!connectionNotification) {
          connectionNotification = notifications.push(
            "warning",
            "Server is unreachable",
            {}
          );
        }
      } else {
        if (connectionNotification) {
          notifications.dismiss(connectionNotification);
          connectionNotification = null;
        }

        const configChanged =
          xhr.getResponseHeader("x-config-snapshot") !== configSnapshot;
        const versionChanged =
          xhr.getResponseHeader("genieacs-version") !== genieacsVersion;

        if (!configNotification !== !configChanged) {
          if (configNotification) {
            notifications.dismiss(configNotification);
            configNotification = null;
          } else {
            configNotification = notifications.push(
              "warning",
              "Configuration has been modified, please reload the page",
              {
                Reload: () => {
                  window.location.reload();
                }
              }
            );
          }
        }

        if (!versionNotification !== !versionChanged) {
          if (versionNotification) {
            notifications.dismiss(versionNotification);
            versionNotification = null;
          } else {
            versionNotification = notifications.push(
              "warning",
              "Server has been updated, please reload the page",
              {
                Reload: () => {
                  window.location.reload();
                }
              }
            );
          }
        }
      }
    }
  });
}

setInterval(checkConnection, 3000);

export async function xhrRequest(
  options: { url: string } & m.RequestOptions<{}>
): Promise<any> {
  const extract = options.extract;
  const deserialize = options.deserialize;

  options.extract = (
    xhr: XMLHttpRequest,
    _options?: { url: string } & m.RequestOptions<{}>
  ): any => {
    if (typeof extract === "function") return extract(xhr, _options);

    let response: any;
    if (typeof deserialize === "function") {
      response = deserialize(xhr.responseText);
    } else if (
      xhr.getResponseHeader("content-type").startsWith("application/json")
    ) {
      try {
        response = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch (err) {
        throw new Error("Invalid JSON: " + xhr.responseText.slice(0, 80));
      }
    } else {
      response = xhr.responseText;
    }

    // https://mithril.js.org/request.html#error-handling
    if (xhr.status !== 304 && Math.floor(xhr.status / 100) !== 2) {
      const err = new Error();
      err["message"] = xhr.responseText;
      err["code"] = xhr.status;
      err["response"] = response;
      throw err;
    }

    return response;
  };

  return m.request(options);
}

export function unpackExpression(exp): Expression {
  if (!Array.isArray(exp)) return exp;
  const e = memoizedEvaluate(exp, null, fulfillTimestamp);
  return e;
}

export function count(resourceType, filter): QueryResponse {
  const filterStr = memoizedStringify(filter);
  let queryResponse = resources[resourceType].count.get(filterStr);
  if (queryResponse) return queryResponse;

  queryResponse = new QueryResponse();

  resources[resourceType].count.set(filterStr, queryResponse);
  queries.filter.set(queryResponse, filter);
  return queryResponse;
}

function limitFilter(filter, sort, bookmark): Expression {
  const sortSort = (a, b): number => Math.abs(b[1]) - Math.abs(a[1]);
  const arr = Object.entries(sort)
    .sort(sortSort)
    .reverse();
  return and(
    filter,
    arr.reduce(
      (cur, kv) => {
        const [param, asc] = kv;
        if (asc <= 0) {
          if (bookmark[param] == null) {
            return or(
              ["IS NOT NULL", ["PARAM", param]],
              and(["IS NULL", ["PARAM", param]], cur)
            );
          }

          let f = null;

          if (typeof bookmark[param] !== "string")
            f = or(f, [">=", ["PARAM", param], ""]);

          f = or(f, [">", ["PARAM", param], bookmark[param]]);
          return or(f, and(["=", ["PARAM", param], bookmark[param]], cur));
        } else {
          let f: Expression = ["IS NULL", ["PARAM", param]];
          if (bookmark[param] == null) return and(f, cur);

          if (typeof bookmark[param] !== "number") {
            f = or(f, [">=", ["PARAM", param], 0]);
            f = or(f, ["<", ["PARAM", param], 0]);
          }

          f = or(f, ["<", ["PARAM", param], bookmark[param]]);

          return or(f, and(["=", ["PARAM", param], bookmark[param]], cur));
        }
      },
      true as Expression
    )
  );
}

function compareFunction(sort: {
  [param: string]: number;
}): (a: any, b: any) => number {
  const sortEntries = Object.entries(sort).sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1])
  );

  return (a, b) => {
    for (const [param, asc] of sortEntries) {
      let v1 = a[param];
      let v2 = b[param];
      if (v1 != null && typeof v1 === "object") {
        if (v1.value) v1 = v1.value[0];
        else v1 = null;
      }

      if (v2 != null && typeof v2 === "object") {
        if (v2.value) v2 = v2.value[0];
        else v2 = null;
      }

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

function findMatches(resourceType, filter, sort, limit): any[] {
  let value = [];
  for (const obj of resources[resourceType].objects.values())
    if (evaluate(filter, obj, fulfillTimestamp)) value.push(obj);

  value = value.sort(compareFunction(sort));
  if (limit) value = value.slice(0, limit);

  return value;
}

function inferQuery(resourceType, queryResponse): void {
  const limit = queries.limit.get(queryResponse);
  let filter = queries.filter.get(queryResponse);
  filter = unpackExpression(filter);
  const bookmark = queries.bookmark.get(queryResponse);
  const sort = queries.sort.get(queryResponse);
  if (bookmark || !limit) {
    if (bookmark) filter = limitFilter(filter, sort, bookmark);
    if (
      resources[resourceType].combinedFilter &&
      subset(filter, resources[resourceType].combinedFilter)
    )
      queries.fulfilled.set(queryResponse, fulfillTimestamp);
  }

  queries.value.set(
    queryResponse,
    findMatches(resourceType, filter, sort, limit)
  );
}

export function fetch(
  resourceType,
  filter,
  options: QueryOptions = {}
): QueryResponse {
  const filterStr = memoizedStringify(filter);
  const sort = Object.assign({}, options.sort);
  for (const [k, v] of Object.entries(sort)) sort[k] += Math.sign(v);

  const limit = options.limit || 0;
  if (resourceType === "devices")
    sort["DeviceID.ID"] = sort["DeviceID.ID"] || 1;
  else sort["_id"] = sort["_id"] || 1;

  const key = `${filterStr}:${limit}:${JSON.stringify(sort)}`;
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

export function fulfill(accessTimestamp, _fulfillTimestamp): Promise<boolean> {
  let updated = false;

  if (_fulfillTimestamp > fulfillTimestamp) {
    for (const resource of Object.values(resources))
      resource.combinedFilter = null;
    fulfillTimestamp = _fulfillTimestamp;
  }

  const allPromises = [];

  for (const [resourceType, resource] of Object.entries(resources)) {
    for (const [queryResponseKey, queryResponse] of resource.count) {
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
            xhrRequest({
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
  }

  const toFetchAll: { [resourceType: string]: QueryResponse[] } = {};

  for (const [resourceType, resource] of Object.entries(resources)) {
    for (const [queryResponseKey, queryResponse] of resource.fetch) {
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
        if (limit) {
          allPromises.push(
            new Promise((resolve, reject) => {
              updated = true;
              let filter = queries.filter.get(queryResponse);
              filter = unpackExpression(filter);
              xhrRequest({
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
                  if ((res as {}[]).length) {
                    // Generate bookmark object
                    const bm = Object.keys(sort).reduce((b, k) => {
                      if (res[0][k] != null) {
                        if (typeof res[0][k] === "object") {
                          if (res[0][k].value != null)
                            b[k] = res[0][k].value[0];
                        } else {
                          b[k] = res[0][k];
                        }
                      }

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
              subset(filter, resources[resourceType].combinedFilter)
            ) {
              queries.value.set(
                queryResponse,
                findMatches(resourceType, filter, sort, limit)
              );
              queries.fulfilled.set(queryResponse, fulfillTimestamp);
              queries.fulfilling.delete(queryResponse);
              return false;
            }

            combinedFilter = or(combinedFilter, filter);
            return true;
          });

          if (combinedFilter == null) continue;

          updated = true;
          let deleted = new Set<string>();
          if (!resources[resourceType].combinedFilter)
            deleted = new Set(resources[resourceType].objects.keys());
          let combinedFilterDiff = combinedFilter;
          if (resources[resourceType].combinedFilter) {
            combinedFilterDiff = and(
              combinedFilterDiff,
              not(resources[resourceType].combinedFilter)
            );
          }
          resources[resourceType].combinedFilter = or(
            combinedFilter,
            resources[resourceType].combinedFilter
          );

          allPromises2.push(
            new Promise((resolve2, reject2) => {
              xhrRequest({
                method: "GET",
                url:
                  `/api/${resourceType}/?` +
                  m.buildQueryString({
                    filter: memoizedStringify(combinedFilterDiff)
                  })
              })
                .then(res => {
                  for (const r of res as {}[]) {
                    const id =
                      resourceType === "devices"
                        ? r["DeviceID.ID"].value[0]
                        : r["_id"];
                    resources[resourceType].objects.set(id, r);
                    deleted.delete(id);
                  }

                  for (const d of deleted) {
                    const obj = resources[resourceType].objects.get(d);
                    if (evaluate(combinedFilterDiff, obj, fulfillTimestamp))
                      resources[resourceType].objects.delete(d);
                  }

                  for (const queryResponse of toFetch) {
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

export function getTimestamp(): number {
  return fulfillTimestamp;
}

export function postTasks(deviceId, tasks): Promise<string> {
  for (const t of tasks) {
    t.status = "pending";
    t.device = deviceId;
  }

  return xhrRequest({
    method: "POST",
    url: `/api/devices/${encodeURIComponent(deviceId)}/tasks`,
    body: tasks,
    extract: xhr => {
      if (xhr.status !== 200) throw new Error(xhr.response);
      const connectionRequestStatus = xhr.getResponseHeader(
        "Connection-Request"
      );
      const st = JSON.parse(xhr.response);
      for (const [i, t] of st.entries()) {
        tasks[i]._id = t._id;
        tasks[i].status = t.status;
        tasks[i].fault = t.fault;
      }
      return connectionRequestStatus;
    }
  });
}

export function updateTags(deviceId, tags): Promise<void> {
  return xhrRequest({
    method: "POST",
    url: `/api/devices/${encodeURIComponent(deviceId)}/tags`,
    body: tags
  });
}

export function deleteResource(resourceType, id): Promise<void> {
  return xhrRequest({
    method: "DELETE",
    url: `/api/${resourceType}/${encodeURIComponent(id)}`
  });
}

export function putResource(resourceType, id, object): Promise<void> {
  for (const k in object) if (object[k] === undefined) object[k] = null;

  return xhrRequest({
    method: "PUT",
    url: `/api/${resourceType}/${encodeURIComponent(id)}`,
    body: object
  });
}

export function queryConfig(pattern = "%"): Promise<any[]> {
  const filter = stringify(["LIKE", ["PARAM", "_id"], pattern]);
  return xhrRequest({
    method: "GET",
    url: `api/config/?${m.buildQueryString({ filter: filter })}`,
    background: true
  });
}

export function resourceExists(resource, id): Promise<number> {
  const param = resource === "devices" ? "DeviceID.ID" : "_id";
  const filter = ["=", ["PARAM", param], id];
  return xhrRequest({
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

export function evaluateExpression(exp, obj): Expression {
  if (!Array.isArray(exp)) return exp;
  return memoizedEvaluate(exp, obj, fulfillTimestamp);
}

export function changePassword(
  username,
  newPassword,
  authPassword?
): Promise<void> {
  const body = { newPassword };
  if (authPassword) body["authPassword"] = authPassword;
  return xhrRequest({
    method: "PUT",
    url: `/api/users/${username}/password`,
    background: true,
    body
  });
}

export function logIn(username, password): Promise<void> {
  return xhrRequest({
    method: "POST",
    url: "/login",
    background: true,
    body: { username, password }
  });
}

export function logOut(): Promise<void> {
  return xhrRequest({
    method: "POST",
    url: "/logout"
  });
}

export function ping(host): Promise<{}> {
  return xhrRequest({
    url: `/api/ping/${encodeURIComponent(host)}`,
    background: true
  });
}
