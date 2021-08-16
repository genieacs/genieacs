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
import { or, and, evaluate } from "../lib/common/expression";
import memoize from "../lib/common/memoize";
import { QueryOptions, Expression } from "../lib/types";
import * as notifications from "./notifications";
import { configSnapshot, genieacsVersion } from "./config";
import { QueueTask } from "./task-queue";
import { PingResult } from "../lib/ping";
import { unionDiff, covers } from "../lib/common/boolean-expression";

const memoizedStringify = memoize(stringify);
const memoizedEvaluate = memoize(evaluate);

let fulfillTimestamp = 0;
let connectionNotification, configNotification, versionNotification;

let clockSkew = 0;

const queries = {
  filter: new WeakMap(),
  bookmark: new WeakMap(),
  limit: new WeakMap(),
  sort: new WeakMap(),
  fulfilled: new WeakMap(),
  fulfilling: new WeakSet(),
  accessed: new WeakMap(),
  value: new WeakMap(),
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
  "permissions",
]) {
  resources[r] = {
    objects: new Map(),
    count: new Map(),
    fetch: new Map(),
    combinedFilter: null,
  };
}

class QueryResponse {
  public get fulfilled(): number {
    queries.accessed.set(this, Date.now());
    return queries.fulfilled.get(this) || 0;
  }

  public get fulfilling(): boolean {
    queries.accessed.set(this, Date.now());
    return !(queries.fulfilled.get(this) >= fulfillTimestamp);
  }

  public get value(): any {
    queries.accessed.set(this, Date.now());
    return queries.value.get(this);
  }
}

function checkConnection(): void {
  const now1 = Date.now();
  m.request({
    url: "status",
    method: "GET",
    background: true,
    extract: (xhr) => {
      const now2 = Date.now();
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

        try {
          const nowAvg = Math.trunc((now1 + now2) / 2);
          const skew = Date.parse(xhr.getResponseHeader("Date")) - nowAvg;
          if (Math.abs(skew - clockSkew) > 5000 && now2 - now1 < 1000) {
            clockSkew = skew;
            console.warn(
              `System and server clocks are out of sync. Adding ${clockSkew}ms offset to any client-side time relative calculations.`
            );
            setTimestamp(now2);
            m.redraw();
          }
        } catch (err) {
          // Ignore in case of missing or invalid Date header
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
                },
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
                },
              }
            );
          }
        }
      }
    },
  }).catch((err) => {
    notifications.push("error", err.message);
  });
}

setInterval(checkConnection, 3000);

export async function xhrRequest(
  options: { url: string } & m.RequestOptions<unknown>
): Promise<any> {
  const extract = options.extract;
  const deserialize = options.deserialize;

  options.extract = (
    xhr: XMLHttpRequest,
    _options?: { url: string } & m.RequestOptions<unknown>
  ): any => {
    if (typeof extract === "function") return extract(xhr, _options);

    // https://mithril.js.org/request.html#error-handling
    if (xhr.status !== 304 && Math.floor(xhr.status / 100) !== 2) {
      if (xhr.status === 403) throw new Error("Not authorized");
      const err = new Error();
      err["message"] =
        xhr.status === 0
          ? "Server is unreachable"
          : `Unexpected response status code ${xhr.status}`;
      err["code"] = xhr.status;
      err["response"] = xhr.responseText;
      throw err;
    }

    let response: any;
    if (typeof deserialize === "function") {
      response = deserialize(xhr.responseText);
    } else if (
      (xhr.getResponseHeader("content-type") || "").startsWith(
        "application/json"
      )
    ) {
      try {
        response = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch (err) {
        throw new Error("Invalid JSON: " + xhr.responseText.slice(0, 80));
      }
    } else {
      response = xhr.responseText;
    }

    return response;
  };

  return m.request(options);
}

export function unpackExpression(exp: Expression): Expression {
  if (!Array.isArray(exp)) return exp;
  const e = memoizedEvaluate(exp, null, fulfillTimestamp + clockSkew);
  return e;
}

export function count(resourceType: string, filter: Expression): QueryResponse {
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
  const arr = Object.entries(sort).sort(sortSort).reverse();
  return and(
    filter,
    arr.reduce((cur, kv) => {
      const [param, asc] = kv;
      if (asc <= 0) {
        if (bookmark[param] == null) {
          return or(
            ["IS NOT NULL", ["PARAM", param]],
            and(["IS NULL", ["PARAM", param]], cur)
          );
        }
        let f = null;
        f = or(f, [">", ["PARAM", param], bookmark[param]]);
        return or(f, and(["=", ["PARAM", param], bookmark[param]], cur));
      } else {
        let f: Expression = ["IS NULL", ["PARAM", param]];
        if (bookmark[param] == null) return and(f, cur);
        f = or(f, ["<", ["PARAM", param], bookmark[param]]);
        return or(f, and(["=", ["PARAM", param], bookmark[param]], cur));
      }
    }, true as Expression)
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
          string: 3,
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
    if (evaluate(filter, obj, fulfillTimestamp + clockSkew)) value.push(obj);

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
    if (covers(resources[resourceType].combinedFilter, filter))
      queries.fulfilled.set(queryResponse, fulfillTimestamp);
  }

  queries.value.set(
    queryResponse,
    findMatches(resourceType, filter, sort, limit)
  );
}

export function fetch(
  resourceType: string,
  filter: Expression,
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

export function fulfill(accessTimestamp: number): void {
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
        let filter = queries.filter.get(queryResponse);
        filter = unpackExpression(filter);
        allPromises.push(
          xhrRequest({
            method: "HEAD",
            url:
              `api/${resourceType}/?` +
              m.buildQueryString({
                filter: memoizedStringify(filter),
              }),
            extract: (xhr) => {
              if (xhr.status === 403) throw new Error("Not authorized");
              if (!xhr.status) {
                throw new Error("Server is unreachable");
              } else if (xhr.status !== 200) {
                throw new Error(
                  `Unexpected response status code ${xhr.status}`
                );
              }
              return +xhr.getResponseHeader("x-total-count");
            },
            background: false,
          }).then((c) => {
            queries.value.set(queryResponse, c);
            queries.fulfilled.set(queryResponse, fulfillTimestamp);
            queries.fulfilling.delete(queryResponse);
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
          let filter = queries.filter.get(queryResponse);
          filter = unpackExpression(filter);
          allPromises.push(
            xhrRequest({
              method: "GET",
              url:
                `api/${resourceType}/?` +
                m.buildQueryString({
                  filter: memoizedStringify(filter),
                  limit: 1,
                  skip: limit - 1,
                  sort: JSON.stringify(sort),
                  projection: Object.keys(sort).join(","),
                }),
              background: true,
            }).then((res) => {
              if ((res as any[]).length) {
                // Generate bookmark object
                const bm = Object.keys(sort).reduce((b, k) => {
                  if (res[0][k] != null) {
                    if (typeof res[0][k] === "object") {
                      if (res[0][k].value != null) b[k] = res[0][k].value[0];
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
            })
          );
        }
      }
    }
  }

  Promise.all(allPromises)
    .then(() => {
      let updated = false;
      const allPromises2 = [];
      for (const [resourceType, toFetch] of Object.entries(toFetchAll)) {
        let combinedFilter = null;

        for (const queryResponse of toFetch) {
          let filter = queries.filter.get(queryResponse);
          filter = memoizedEvaluate(filter, null, fulfillTimestamp + clockSkew);
          const bookmark = queries.bookmark.get(queryResponse);
          const sort = queries.sort.get(queryResponse);
          if (bookmark) filter = limitFilter(filter, sort, bookmark);
          combinedFilter = or(combinedFilter, filter);
        }

        const [union, diff] = unionDiff(
          resources[resourceType].combinedFilter,
          combinedFilter
        );

        if (!diff) {
          for (const queryResponse of toFetch) {
            let filter = queries.filter.get(queryResponse);
            filter = memoizedEvaluate(
              filter,
              null,
              fulfillTimestamp + clockSkew
            );
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
            updated = true;
          }
          continue;
        }

        let deleted = new Set<string>();
        if (!resources[resourceType].combinedFilter)
          deleted = new Set(resources[resourceType].objects.keys());

        const combinedFilterDiff = diff;
        resources[resourceType].combinedFilter = union;

        allPromises2.push(
          xhrRequest({
            method: "GET",
            url:
              `api/${resourceType}/?` +
              m.buildQueryString({
                filter: memoizedStringify(combinedFilterDiff),
              }),
            background: false,
          }).then((res) => {
            for (const r of res as any[]) {
              const id =
                resourceType === "devices"
                  ? r["DeviceID.ID"].value[0]
                  : r["_id"];
              resources[resourceType].objects.set(id, r);
              deleted.delete(id);
            }

            for (const d of deleted) {
              const obj = resources[resourceType].objects.get(d);
              if (
                evaluate(combinedFilterDiff, obj, fulfillTimestamp + clockSkew)
              )
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
          })
        );
      }
      if (updated) m.redraw();
      return Promise.all(allPromises2);
    })
    .catch((err) => {
      notifications.push("error", err.message);
    });
}

export function getTimestamp(): number {
  return fulfillTimestamp;
}

export function setTimestamp(t: number): void {
  if (t > fulfillTimestamp) {
    fulfillTimestamp = t;
    for (const resource of Object.values(resources))
      resource.combinedFilter = null;
  }
}

export function getClockSkew(): number {
  return clockSkew;
}

export function postTasks(
  deviceId: string,
  tasks: QueueTask[]
): Promise<string> {
  for (const t of tasks) {
    t.status = "pending";
    t.device = deviceId;
  }

  return xhrRequest({
    method: "POST",
    url: `api/devices/${encodeURIComponent(deviceId)}/tasks`,
    body: tasks,
    extract: (xhr) => {
      if (xhr.status === 403) throw new Error("Not authorized");
      if (!xhr.status) throw new Error("Server is unreachable");
      if (xhr.status !== 200) throw new Error(xhr.response);
      const connectionRequestStatus =
        xhr.getResponseHeader("Connection-Request");
      const st = JSON.parse(xhr.response);
      for (const [i, t] of st.entries()) {
        tasks[i]._id = t._id;
        tasks[i].status = t.status;
        tasks[i]["fault"] = t.fault;
      }
      return connectionRequestStatus;
    },
  });
}

export function updateTags(
  deviceId: string,
  tags: Record<string, boolean>
): Promise<void> {
  return xhrRequest({
    method: "POST",
    url: `api/devices/${encodeURIComponent(deviceId)}/tags`,
    body: tags,
  });
}

export function deleteResource(
  resourceType: string,
  id: string
): Promise<void> {
  return xhrRequest({
    method: "DELETE",
    url: `api/${resourceType}/${encodeURIComponent(id)}`,
  });
}

export function putResource(
  resourceType: string,
  id: string,
  object: Record<string, unknown>
): Promise<void> {
  for (const k in object) if (object[k] === undefined) object[k] = null;

  return xhrRequest({
    method: "PUT",
    url: `api/${resourceType}/${encodeURIComponent(id)}`,
    body: object,
  });
}

export function queryConfig(pattern = "%"): Promise<any[]> {
  const filter = stringify(["LIKE", ["PARAM", "_id"], pattern]);
  return xhrRequest({
    method: "GET",
    url: `api/config/?${m.buildQueryString({ filter: filter })}`,
    background: true,
  });
}

export function resourceExists(resource: string, id: string): Promise<number> {
  const param = resource === "devices" ? "DeviceID.ID" : "_id";
  const filter = ["=", ["PARAM", param], id];
  return xhrRequest({
    method: "HEAD",
    url:
      `api/${resource}/?` +
      m.buildQueryString({
        filter: memoizedStringify(filter),
      }),
    extract: (xhr) => {
      if (xhr.status === 403) throw new Error("Not authorized");
      if (!xhr.status) throw new Error("Server is unreachable");
      else if (xhr.status !== 200)
        throw new Error(`Unexpected response status code ${xhr.status}`);
      return +xhr.getResponseHeader("x-total-count");
    },
    background: true,
  });
}

export function evaluateExpression(
  exp: Expression,
  obj: Record<string, unknown>
): Expression {
  if (!Array.isArray(exp)) return exp;
  return memoizedEvaluate(exp, obj, fulfillTimestamp + clockSkew);
}

export function changePassword(
  username: string,
  newPassword: string,
  authPassword?: string
): Promise<void> {
  const body = { newPassword };
  if (authPassword) body["authPassword"] = authPassword;
  return xhrRequest({
    method: "PUT",
    url: `api/users/${username}/password`,
    background: true,
    body,
  });
}

export function logIn(username: string, password: string): Promise<void> {
  return xhrRequest({
    method: "POST",
    url: "login",
    background: true,
    body: { username, password },
  });
}

export function logOut(): Promise<void> {
  return xhrRequest({
    method: "POST",
    url: "logout",
  });
}

export function ping(host: string): Promise<PingResult> {
  return xhrRequest({
    url: `api/ping/${encodeURIComponent(host)}`,
    background: true,
  });
}
