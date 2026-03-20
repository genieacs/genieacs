// Mock implementation of ui/store.ts for testing (substituted via esbuild alias)

import Expression from "../../lib/common/expression.ts";

// Provide window.clockSkew for reactive-store.ts in Node.js test environment
if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = { clockSkew: 0 };
} else {
  (globalThis.window as any).clockSkew = 0;
}

// Clock skew is always 0 in tests
export function getClockSkew(): number {
  return 0;
}

// Mock request handler type
type MockHandler = (options: XhrRequestOptions) => unknown | Promise<unknown>;

// Store mock handlers
const mockHandlers: MockHandler[] = [];

// Track all requests for test assertions
interface RequestRecord {
  url: string;
  method: string;
  timestamp: number;
}
const requestLog: RequestRecord[] = [];

// Options type matching mithril's RequestOptions
interface XhrRequestOptions {
  url: string;
  method?: string;
  body?: unknown;
  extract?: (xhr: MockXhr) => unknown;
  deserialize?: (text: string) => unknown;
  background?: boolean;
}

// Mock XMLHttpRequest for extract functions
interface MockXhr {
  status: number;
  responseText: string;
  getResponseHeader(name: string): string | null;
}

function parseQueryParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return params;

  const queryString = url.slice(queryStart + 1);
  for (const pair of queryString.split("&")) {
    const [key, value] = pair.split("=");
    if (key && value !== undefined) {
      params[decodeURIComponent(key)] = decodeURIComponent(value);
    }
  }
  return params;
}

function evaluate(
  exp: Expression,
  obj: Record<string, unknown>,
  timestamp: number,
): Expression {
  return exp.evaluate((e) => {
    if (e instanceof Expression.Literal) return e;
    else if (e instanceof Expression.FunctionCall) {
      if (e.name === "NOW") return new Expression.Literal(timestamp);
    } else if (e instanceof Expression.Parameter && obj) {
      let v = obj[e.path.toString()];
      if (v == null) return new Expression.Literal(null);
      if (typeof v === "object")
        v = (v as Record<string, unknown>)["value"]?.[0];
      return new Expression.Literal(v as string | number | boolean | null);
    }
    return e;
  });
}

function filterData(data: unknown[], filterStr: string | undefined): unknown[] {
  if (!filterStr) return data;

  const filterExpr = Expression.parse(filterStr);
  if (filterExpr == null) return data;

  const now = Date.now();
  return data.filter((obj) => {
    const result = evaluate(filterExpr, obj as Record<string, unknown>, now);
    return result instanceof Expression.Literal && !!result.value;
  });
}

export async function xhrRequest(options: XhrRequestOptions): Promise<unknown> {
  // Log the request
  requestLog.push({
    url: options.url,
    method: options.method || "GET",
    timestamp: Date.now(),
  });

  for (const handler of mockHandlers) {
    const result = handler(options);
    if (result !== undefined) {
      return result instanceof Promise ? result : Promise.resolve(result);
    }
  }

  // Default: return empty result based on method
  if (options.method === "HEAD") {
    if (options.extract) {
      const mockXhr: MockXhr = {
        status: 200,
        responseText: "",
        getResponseHeader: (name: string) => {
          if (name.toLowerCase() === "x-total-count") return "0";
          return null;
        },
      };
      return options.extract(mockXhr);
    }
    return 0;
  }

  // GET returns empty array by default
  return [];
}

export function mockRegisterHandler(handler: MockHandler): void {
  mockHandlers.push(handler);
}

export function mockClearHandlers(): void {
  mockHandlers.length = 0;
  requestLog.length = 0;
}

export function mockGetRequestLog(): RequestRecord[] {
  return [...requestLog];
}

export function mockClearRequestLog(): void {
  requestLog.length = 0;
}

export function mockUrlHandler(
  urlPattern: string | RegExp,
  response: unknown | ((options: XhrRequestOptions) => unknown),
): MockHandler {
  return (options: XhrRequestOptions) => {
    const matches =
      typeof urlPattern === "string"
        ? options.url.includes(urlPattern)
        : urlPattern.test(options.url);

    if (matches) {
      return typeof response === "function" ? response(options) : response;
    }
    return undefined;
  };
}

export function mockCountHandler(
  urlPattern: string | RegExp,
  data: unknown[],
  delayMs = 0,
): MockHandler {
  return (options: XhrRequestOptions) => {
    if (options.method !== "HEAD") return undefined;

    const matches =
      typeof urlPattern === "string"
        ? options.url.includes(urlPattern)
        : urlPattern.test(options.url);

    if (matches && options.extract) {
      const params = parseQueryParams(options.url);
      const filtered = filterData(data, params.filter);
      const count = filtered.length;

      const mockXhr: MockXhr = {
        status: 200,
        responseText: "",
        getResponseHeader: (name: string) => {
          if (name.toLowerCase() === "x-total-count") return String(count);
          return null;
        },
      };

      if (delayMs > 0) {
        return new Promise((resolve) => {
          setTimeout(() => resolve(options.extract!(mockXhr)), delayMs);
        });
      }
      return options.extract(mockXhr);
    }
    return undefined;
  };
}

export function mockFetchHandler(
  urlPattern: string | RegExp,
  data: unknown[],
  delayMs = 0,
): MockHandler {
  return (options: XhrRequestOptions) => {
    if (options.method && options.method !== "GET") return undefined;

    const matches =
      typeof urlPattern === "string"
        ? options.url.includes(urlPattern)
        : urlPattern.test(options.url);

    if (matches) {
      const params = parseQueryParams(options.url);
      const filtered = filterData(data, params.filter);

      if (delayMs > 0) {
        return new Promise((resolve) => {
          setTimeout(() => resolve(filtered), delayMs);
        });
      }
      return filtered;
    }
    return undefined;
  };
}
