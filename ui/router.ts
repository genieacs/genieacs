const ROUTES = [
  "/",
  "/overview",
  "/wizard",
  "/devices",
  "/devices/:id",
  "/faults",
  "/presets",
  "/provisions",
  "/virtualParameters",
  "/files",
  "/config",
  "/permissions",
  "/users",
  "/views",
  "/login",
];

export function matchRoute(
  pathname: string,
): { route: string; pathname: string; params: Record<string, string> } | null {
  const pathParts = pathname.split("/").filter((p) => p);
  for (const route of ROUTES) {
    const patternParts = route.split("/").filter((p) => p);
    if (patternParts.length !== pathParts.length) continue;

    const params: Record<string, string> = {};
    const matched = patternParts.every((part, i) => {
      if (part.startsWith(":") && pathParts[i]) {
        try {
          params[part.slice(1)] = decodeURIComponent(pathParts[i]);
        } catch {
          return false;
        }
        return true;
      }
      return part === pathParts[i];
    });

    if (matched) return { route, pathname: "/" + pathParts.join("/"), params };
  }

  return null;
}

let handler: (
  path: string,
  params: URLSearchParams,
  signal: AbortSignal,
) => Promise<void>;

function navigateHandler(e: NavigateEvent): void {
  if (!e.canIntercept || e.downloadRequest || e.navigationType === "reload")
    return;

  const url = new URL(e.destination.url);

  if (url.origin !== window.origin) return;

  if (url.hash.startsWith("#!/")) {
    const u = new URL(url.origin + url.hash.slice(2));
    url.hash = "";
    url.pathname = u.pathname;
    url.search = u.search;
  } else if (e.hashChange) return;

  const match = matchRoute(url.pathname);

  if (!match) return;

  url.pathname = match.pathname;

  if (url.toString() !== e.destination.url) {
    e.intercept({
      precommitHandler(controller) {
        controller.redirect(url);
      },
    });
  }

  const params = new URLSearchParams(url.searchParams);
  for (const [k, v] of Object.entries(match.params)) params.set(k, v);

  e.intercept({
    handler: () => handler(match.route, params, e.signal),
  });
}

export function initRouter(_handler: typeof handler): void {
  handler = _handler;

  window.navigation.addEventListener("navigate", navigateHandler);

  // Initial render
  window.navigation.navigate(window.navigation.currentEntry!.url!, {
    history: "replace",
  });
}

export async function navigate(
  path: string,
  params?: Record<string, string>,
): Promise<void> {
  if (params) path += "?" + new URLSearchParams(params).toString();
  await window.navigation.navigate(path).committed;
}

export async function redirect(
  path: string,
  params?: Record<string, string>,
): Promise<void> {
  if (params) path += "?" + new URLSearchParams(params).toString();
  await window.navigation.navigate(path, { history: "replace" }).committed;
}

export async function reload(): Promise<void> {
  await window.navigation.reload().committed;
}
