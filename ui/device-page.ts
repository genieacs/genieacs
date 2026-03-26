import { ClosureComponent, Component } from "mithril";
import { m } from "./components.ts";
import config from "./config.ts";
import * as store from "./store.ts";

// Workaround for Mithril 2.3.8 regression
// https://github.com/MithrilJS/mithril.js/issues/3064
function getPathParamFromHash(hash: string, prefix: string): string | null {
  if (!hash.startsWith(prefix)) return null;

  const pathWithQuery = hash.slice(prefix.length);

  // Stop at query string or hash fragment (mirrors Mithril's parsePathname)
  const queryIdx = pathWithQuery.indexOf("?");
  const hashIdx = pathWithQuery.indexOf("#");
  let pathEnd = pathWithQuery.length;
  if (queryIdx >= 0) pathEnd = Math.min(pathEnd, queryIdx);
  if (hashIdx >= 0) pathEnd = Math.min(pathEnd, hashIdx);

  const rawPath = pathWithQuery.slice(0, pathEnd);

  // Normalize: collapse slashes, remove trailing slash (matches Mithril)
  const normalizedPath = rawPath.replace(/\/{2,}/g, "/").replace(/\/$/, "");

  // Decode once (Mithril already decoded with decodeURIComponentSafe)
  return decodeURIComponent(normalizedPath);
}

export function init(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!window.authorizer.hasAccess("devices", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page"),
    );
  }

  const deviceId =
    getPathParamFromHash(window.location.hash, "#!/devices/") ??
    (args.id as string);

  return Promise.resolve({
    deviceId: deviceId,
    deviceFilter: ["=", ["PARAM", "DeviceID.ID"], deviceId],
  });
}

export const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      document.title = `${vnode.attrs["deviceId"]} - Devices - GenieACS`;

      const dev = store.fetch("devices", vnode.attrs["deviceFilter"]);
      if (!dev.value.length) {
        if (!dev.fulfilling)
          return m("p.error", `No such device ${vnode.attrs["deviceId"]}`);
        return m(
          "loading",
          { queries: [dev] },
          m("div", { style: "height: 100px;" }),
        );
      }

      const conf = config.ui.device;
      const cmps = [];

      for (const c of Object.values(conf)) {
        cmps.push(
          m.context(
            { device: dev.value[0], deviceQuery: dev },
            store.evaluateExpression(c["type"], null) as string,
            c,
          ),
        );
      }

      return [m("h1", vnode.attrs["deviceId"]), cmps];
    },
  };
};
