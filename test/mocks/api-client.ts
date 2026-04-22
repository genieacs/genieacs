// Mock implementation of ui/api-client.ts for testing (substituted via esbuild alias)

// Provide window globals needed by modules that import config.ts indirectly
if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = {
    clockSkew: 0,
    configSnapshot: "",
    genieacsVersion: "",
    clientConfig: {},
  };
} else {
  const w = globalThis.window as any;
  w.clockSkew ??= 0;
  w.configSnapshot ??= "";
  w.genieacsVersion ??= "";
  w.clientConfig ??= {};
}

// Mock request handler type
type MockHandler = (options: MockRequestOptions) => unknown | Promise<unknown>;

interface MockRequestOptions {
  url: string;
  method: string;
  body?: unknown;
  params?: Record<string, string>;
}

// Store mock handlers
const mockHandlers: MockHandler[] = [];

// Track all requests for test assertions
interface RequestRecord {
  url: string;
  method: string;
  timestamp: number;
}
const requestLog: RequestRecord[] = [];

// Mock Response that mimics the browser Response API
class MockResponse {
  private _body: unknown;
  private _headers: Map<string, string>;
  status: number;
  ok: boolean;

  constructor(body: unknown, headers: Record<string, string> = {}) {
    this._body = body;
    this._headers = new Map(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
    );
    this.status = 200;
    this.ok = true;
  }

  async json(): Promise<unknown> {
    return this._body;
  }

  async text(): Promise<string> {
    return typeof this._body === "string"
      ? this._body
      : JSON.stringify(this._body);
  }

  get headers(): { get(name: string): string | null } {
    const headers = this._headers;
    return {
      get(name: string): string | null {
        return headers.get(name.toLowerCase()) ?? null;
      },
    };
  }
}

function parseQueryParams(url: string): Record<string, string> {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return {};

  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(url.slice(queryStart + 1)))
    params[key] = value;
  return params;
}

import Expression from "../../lib/common/expression.ts";

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
      if (typeof v === "object") v = (v as { value?: unknown[] })["value"]?.[0];
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

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
}

export class HttpError extends Error {
  code: number;
  response: string;

  constructor(message: string, code: number, response: string) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.response = response;
  }
}

export async function request(
  url: string,
  options: RequestOptions = {},
): Promise<MockResponse> {
  const method = options.method || "GET";

  // Build full URL with params
  let fullUrl = url;
  if (options.params) {
    const search = new URLSearchParams(options.params).toString();
    fullUrl = `${url}?${search}`;
  }

  // Log the request
  requestLog.push({
    url: fullUrl,
    method,
    timestamp: Date.now(),
  });

  const mockOptions: MockRequestOptions = {
    url: fullUrl,
    method,
    body: options.body,
    params: options.params,
  };

  for (const handler of mockHandlers) {
    const result = handler(mockOptions);
    if (result !== undefined) {
      const data = result instanceof Promise ? await result : result;

      // If handler returns a MockResponse, use it directly
      if (data instanceof MockResponse) return data;

      // Otherwise wrap in MockResponse
      return new MockResponse(data);
    }
  }

  // Default: return empty result based on method
  if (method === "HEAD") {
    return new MockResponse("", { "x-total-count": "0" });
  }

  // GET returns empty array by default
  return new MockResponse([]);
}

// Re-export mock utilities
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
  response: unknown | ((options: MockRequestOptions) => unknown),
): MockHandler {
  return (options: MockRequestOptions) => {
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
  return (options: MockRequestOptions) => {
    if (options.method !== "HEAD") return undefined;

    const matches =
      typeof urlPattern === "string"
        ? options.url.includes(urlPattern)
        : urlPattern.test(options.url);

    if (matches) {
      const params = parseQueryParams(options.url);
      const filtered = filterData(data, params.filter);
      const count = filtered.length;
      const response = new MockResponse("", {
        "x-total-count": String(count),
      });

      if (delayMs > 0) {
        return new Promise((resolve) => {
          setTimeout(() => resolve(response), delayMs);
        });
      }
      return response;
    }
    return undefined;
  };
}

export function mockFetchHandler(
  urlPattern: string | RegExp,
  data: unknown[],
  delayMs = 0,
): MockHandler {
  return (options: MockRequestOptions) => {
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
