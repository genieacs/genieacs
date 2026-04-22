import m from "mithril";
import Expression from "../lib/common/expression.ts";
import memoize from "../lib/common/memoize.ts";
import * as notifications from "./notifications.ts";
import { unionDiff } from "../lib/common/expression/synth.ts";
import {
  bookmarkToExpression,
  paginate,
  toBookmark,
} from "../lib/common/expression/pagination.ts";
import { getClockSkew } from "./skewed-date.ts";
import { request } from "./api-client.ts";

function evaluate(exp: Expression, timestamp: number): Expression;
function evaluate(
  exp: Expression,
  timestamp: number,
  obj: Record<string, unknown>,
): Expression.Literal;
function evaluate(
  exp: Expression,
  timestamp: number,
  obj?: Record<string, unknown>,
): Expression {
  return exp.evaluate((e) => {
    if (e instanceof Expression.Literal) return e;
    else if (e instanceof Expression.FunctionCall) {
      if (e.name === "NOW") return new Expression.Literal(timestamp);
    } else if (e instanceof Expression.Parameter && obj) {
      let v = obj[e.path.toString()] as unknown;
      if (v == null) return new Expression.Literal(null);
      if (typeof v === "object") v = (v as { value?: unknown[] })["value"]?.[0];
      return new Expression.Literal(v as any);
    }
    return e;
  });
}
const memoizedEvaluate = memoize(evaluate);

let fulfillTimestamp = 0;

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
  "views",
]) {
  resources[r] = {
    objects: new Map(),
    count: new Map(),
    fetch: new Map(),
    combinedFilter: new Expression.Literal(false) as Expression,
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

export function unpackExpression(exp: Expression): Expression {
  return memoizedEvaluate(exp, fulfillTimestamp + getClockSkew());
}

export function count(resourceType: string, filter: Expression): QueryResponse {
  const filterStr = filter.toString();
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
        const w: Record<string, number> = {
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

function findMatches(
  resourceType: string,
  filter: Expression,
  sort: { [param: string]: number },
  limit: number,
): any[] {
  let value = [];
  for (const obj of resources[resourceType].objects.values())
    if (evaluate(filter, fulfillTimestamp + getClockSkew(), obj).value)
      value.push(obj);

  value = value.sort(compareFunction(sort));
  if (limit) value = value.slice(0, limit);

  return value;
}

export function fetch(
  resourceType: string,
  filter: Expression,
  options: { limit?: number; sort?: { [param: string]: number } } = {},
): QueryResponse {
  const sort = Object.assign({}, options.sort);

  const limit = options.limit || 0;
  if (resourceType === "devices")
    sort["DeviceID.ID"] = sort["DeviceID.ID"] || 1;
  else sort["_id"] = sort["_id"] || 1;

  const key = `${filter.toString()}:${limit}:${JSON.stringify(sort)}`;
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
  if (
    (diff instanceof Expression.Literal && !diff.value) ||
    (limit && matches.length >= limit)
  )
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
          request(`/api/${resourceType}/`, {
            method: "HEAD",
            params: { filter: filter.toString() },
          }).then((res) => {
            const c = +(res.headers.get("x-total-count") ?? 0);
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
            request(`/api/${resourceType}/`, {
              params: {
                filter: filter.toString(),
                limit: "1",
                skip: String(limit - 1),
                sort: JSON.stringify(sort),
                projection: Object.keys(sort).join(","),
              },
            })
              .then((res) => res.json())
              .then((res) => {
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
    .then((res) => {
      if (res.length) m.redraw();
    })
    .then(() => {
      let updated = false;
      const allPromises2 = [];
      for (const [resourceType, toFetch] of Object.entries(toFetchAll)) {
        let combinedFilter = new Expression.Literal(false) as Expression;

        for (const queryResponse of toFetch) {
          let filter = queries.filter.get(queryResponse);
          filter = memoizedEvaluate(filter, fulfillTimestamp + getClockSkew());
          const bookmark = queries.bookmark.get(queryResponse);
          const sort = queries.sort.get(queryResponse);
          if (bookmark)
            filter = Expression.and(
              filter,
              bookmarkToExpression(bookmark, sort),
            );
          combinedFilter = Expression.or(combinedFilter, filter);
        }

        const [union, diff] = unionDiff(
          resources[resourceType].combinedFilter,
          combinedFilter,
        );

        if (diff instanceof Expression.Literal && !diff.value) {
          for (const queryResponse of toFetch) {
            let filter = queries.filter.get(queryResponse);
            filter = memoizedEvaluate(
              filter,
              fulfillTimestamp + getClockSkew(),
            );
            const limit = queries.limit.get(queryResponse);
            const bookmark = queries.bookmark.get(queryResponse);
            const sort = queries.sort.get(queryResponse);
            if (bookmark)
              filter = Expression.and(
                filter,
                bookmarkToExpression(bookmark, sort),
              );

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
        const cf = resources[resourceType].combinedFilter;
        if (cf instanceof Expression.Literal && !cf.value)
          deleted = new Set(resources[resourceType].objects.keys());

        const combinedFilterDiff = diff;
        resources[resourceType].combinedFilter = union;

        allPromises2.push(
          request(`/api/${resourceType}/`, {
            params: { filter: combinedFilterDiff.toString() },
          })
            .then((res) => res.json())
            .then((res) => {
              for (const r of res as any[]) {
                const id = r["DeviceID.ID"] ?? r["_id"];
                resources[resourceType].objects.set(id, r);
                deleted.delete(id);
              }

              for (const d of deleted) {
                const obj = resources[resourceType].objects.get(d);
                if (
                  evaluate(
                    combinedFilterDiff,
                    fulfillTimestamp + getClockSkew(),
                    obj,
                  ).value
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
                  filter = Expression.and(
                    filter,
                    bookmarkToExpression(bookmark, sort),
                  );

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
    .then((res) => {
      if (res.length) m.redraw();
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
      resource.combinedFilter = new Expression.Literal(false);
  }
}

export function evaluateExpression(exp: Expression): Expression;
export function evaluateExpression(
  exp: Expression,
  obj: Record<string, unknown>,
): Expression.Literal;
export function evaluateExpression(
  exp: Expression,
  obj?: Record<string, unknown>,
): Expression {
  return memoizedEvaluate(exp, fulfillTimestamp + getClockSkew(), obj);
}
