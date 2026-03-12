import { ClosureComponent } from "mithril";
import { m } from "./components.ts";
import { device as deviceConfig } from "./config.ts";
import * as store from "./store.ts";
import Expression from "../lib/common/expression.ts";
import Path from "../lib/common/path.ts";

export function init(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!window.authorizer.hasAccess("devices", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page"),
    );
  }

  return Promise.resolve({
    deviceId: args.id,
    deviceFilter: new Expression.Binary(
      "=",
      new Expression.Parameter(Path.parse("DeviceID.ID")),
      new Expression.Literal(args.id as string),
    ),
  });
}

interface Attrs {
  deviceId: string;
  deviceFilter: Expression;
}

export const component: ClosureComponent<Attrs> = () => {
  return {
    view: (vnode) => {
      document.title = `${vnode.attrs.deviceId} - Devices - GenieACS`;

      const dev = store.fetch("devices", vnode.attrs.deviceFilter);
      if (!dev.value.length) {
        if (!dev.fulfilling) {
          return m(
            "p.text-sm font-bold text-red-500",
            `No such device ${vnode.attrs["deviceId"]}`,
          );
        }
        return m(
          "loading",
          { queries: [dev] },
          m("div", { style: "height: 100px;" }),
        );
      }

      const conf = deviceConfig;
      const cmps = [];

      for (const c of Object.values(conf)) {
        cmps.push(
          m.context(
            { device: dev.value[0], deviceQuery: dev },
            store.evaluateExpression(c["type"], {}).value as string,
            c as any,
          ),
        );
      }

      return m("div.device-page", m("h1", vnode.attrs["deviceId"]), cmps);
    },
  };
};
