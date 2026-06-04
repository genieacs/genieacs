import m, { createMithrilHost } from "./mithril-compat.ts";
import { m as mContext } from "./components.ts";
import { device as deviceConfig } from "./config.ts";
import { evaluateExpression } from "./reactive-store.ts";
import { fetch as legacyFetch } from "./legacy-store.ts";
import Expression from "../lib/common/expression.ts";
import Path from "../lib/common/path.ts";
import { renderView } from "./views.ts";
import { div } from "./dom.ts";

export interface Attrs {
  deviceId: string;
  deviceFilter: Expression;
}

export function init(args: URLSearchParams): Promise<Attrs> {
  if (!window.authorizer.hasAccess("devices", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page"),
    );
  }

  const deviceId = args.get("id") as string;
  return Promise.resolve({
    deviceId,
    deviceFilter: new Expression.Binary(
      "=",
      new Expression.Parameter(Path.parse("DeviceID.ID")),
      new Expression.Literal(deviceId),
    ),
  });
}

export function createPage(attrs: Attrs): HTMLElement {
  document.title = `${attrs.deviceId} - Devices - GenieACS`;

  const conf = deviceConfig;

  // Custom view mode
  if (conf instanceof Expression.Literal && typeof conf.value === "string") {
    return div(
      {},
      renderView(conf.value as string, { deviceId: attrs.deviceId }),
    );
  }

  // Legacy mode — mithril components driven by a reactive signal.
  // createMithrilHost watches any signals read inside the render function
  // and calls m.render() on changes, preserving component state via diffing.
  const deviceQuery = legacyFetch("devices", attrs.deviceFilter);

  return createMithrilHost(() => {
    if (!(deviceQuery.value as unknown[]).length) {
      if (!deviceQuery.fulfilling) {
        return m(
          "p.text-sm.font-bold.text-red-500",
          `No such device ${attrs.deviceId}`,
        );
      }
      return mContext(
        "loading",
        { queries: [deviceQuery] },
        m("div", { style: "height: 100px;" }),
      );
    }

    const device = (deviceQuery.value as unknown[])[0];

    return m(
      "div.device-page",
      m("h1", attrs.deviceId),
      ...Object.values(conf).map((c) => {
        const componentType = evaluateExpression(
          (c as { type: Expression })["type"],
          {},
        ).value as string;
        return m(
          "div.device-component",
          mContext.context({ device, deviceQuery }, componentType, c as any),
        );
      }),
    );
  });
}
