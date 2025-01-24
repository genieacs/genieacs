import m from "mithril";
import { stringify } from "../lib/common/expression/parser.ts";
import { or, and, evaluate } from "../lib/common/expression/util.ts";
import memoize from "../lib/common/memoize.ts";
import { Expression, Task } from "../lib/types.ts";
import * as notifications from "./notifications.ts";
import { configSnapshot, genieacsVersion } from "./config.ts";
import { QueueTask } from "./task-queue.ts";
import { PingResult } from "../lib/ping.ts";
import { unionDiff } from "../lib/common/expression/synth.ts";
import {
  bookmarkToExpression,
  paginate,
  toBookmark,
} from "../lib/common/expression/pagination.ts";

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
  unsatisfied: new WeakMap(),
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

export class QueryResponse {
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
            {},
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
              `System and server clocks are out of sync. Adding ${clockSkew}ms offset to any client-side time relative calculations.`,
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
              },
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
              },
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
  options: { url: string } & m.RequestOptions<unknown>,
): Promise<any> {
  const extract = options.extract;
  const deserialize = options.deserialize;

  options.extract = (
    xhr: XMLHttpRequest,
    _options?: { url: string } & m.RequestOptions<unknown>,
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
        "application/json",
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

function compareFunction(sort: {
  [param: string]: number;
}): (a: any, b: any) => number {
  return (a, b) => {
    for (const [param, asc] of Object.entries(sort)) {
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

export function fetch(
  resourceType: string,
  filter: Expression,
  options: { limit?: number; sort?: { [param: string]: number } } = {},
): QueryResponse {
  const filterStr = memoizedStringify(filter);
  const sort = Object.assign({}, options.sort);

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
  const [satisfied, diff] = paginate(
    resources[resourceType].combinedFilter,
    unpackExpression(filter),
    sort,
  );
  const matches = findMatches(resourceType, satisfied, sort, limit);
  queries.value.set(queryResponse, matches);
  if (!diff || (limit && matches.length >= limit))
    queries.fulfilled.set(queryResponse, fulfillTimestamp);
  else queries.unsatisfied.set(queryResponse, diff);
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
                  `Unexpected response status code ${xhr.status}`,
                );
              }
              return +xhr.getResponseHeader("x-total-count");
            },
            background: false,
          }).then((c) => {
            queries.value.set(queryResponse, c);
            queries.fulfilled.set(queryResponse, fulfillTimestamp);
            queries.fulfilling.delete(queryResponse);
          }),
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
        let limit = queries.limit.get(queryResponse);
        const sort = queries.sort.get(queryResponse);
        if (limit) {
          let filter = queries.filter.get(queryResponse);
          filter = unpackExpression(filter);

          const unsatisfied = queries.unsatisfied.get(queryResponse);
          if (unsatisfied) {
            limit -= queries.value.get(queryResponse).length;
            filter = unsatisfied;
          }

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
              queries.unsatisfied.delete(queryResponse);
              if ((res as any[]).length) {
                queries.bookmark.set(queryResponse, toBookmark(sort, res[0]));
              } else {
                queries.bookmark.delete(queryResponse);
              }
            }),
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
          if (bookmark)
            filter = and(filter, bookmarkToExpression(bookmark, sort));
          combinedFilter = or(combinedFilter, filter);
        }

        const [union, diff] = unionDiff(
          resources[resourceType].combinedFilter,
          combinedFilter,
        );

        if (!diff) {
          for (const queryResponse of toFetch) {
            let filter = queries.filter.get(queryResponse);
            filter = memoizedEvaluate(
              filter,
              null,
              fulfillTimestamp + clockSkew,
            );
            const limit = queries.limit.get(queryResponse);
            const bookmark = queries.bookmark.get(queryResponse);
            const sort = queries.sort.get(queryResponse);
            if (bookmark)
              filter = and(filter, bookmarkToExpression(bookmark, sort));

            queries.value.set(
              queryResponse,
              findMatches(resourceType, filter, sort, limit),
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
              if (bookmark)
                filter = and(filter, bookmarkToExpression(bookmark, sort));

              queries.value.set(
                queryResponse,
                findMatches(resourceType, filter, sort, limit),
              );
              queries.fulfilled.set(queryResponse, fulfillTimestamp);
              queries.fulfilling.delete(queryResponse);
            }
          }),
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
  tasks: QueueTask[],
): Promise<string> {
  const tasks2: Task[] = [];
  for (const t of tasks) {
    t.status = "pending";
    const t2 = Object.assign({}, t);
    delete t2.device;
    delete t2.status;
    tasks2.push(t2);
  }

  return xhrRequest({
    method: "POST",
    url: `api/devices/${encodeURIComponent(deviceId)}/tasks`,
    body: tasks2,
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
      }
      return connectionRequestStatus;
    },
  });
}

export function updateTags(
  deviceId: string,
  tags: Record<string, boolean>,
): Promise<void> {
  return xhrRequest({
    method: "POST",
    url: `api/devices/${encodeURIComponent(deviceId)}/tags`,
    body: tags,
  });
}

export function deleteResource(
  resourceType: string,
  id: string,
): Promise<void> {
  return xhrRequest({
    method: "DELETE",
    url: `api/${resourceType}/${encodeURIComponent(id)}`,
  });
}

export function putResource(
  resourceType: string,
  id: string,
  object: Record<string, unknown>,
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
  obj: Record<string, unknown>,
): Expression {
  if (!Array.isArray(exp)) return exp;
  return memoizedEvaluate(exp, obj, fulfillTimestamp + clockSkew);
}

export function changePassword(
  username: string,
  newPassword: string,
  authPassword?: string,
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
