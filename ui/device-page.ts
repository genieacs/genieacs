import { ClosureComponent, Component } from "mithril";
import { m } from "./components.ts";
import config from "./config.ts";
import * as store from "./store.ts";

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
    deviceFilter: ["=", ["PARAM", "DeviceID.ID"], args.id],
    tab: args.tab,
  });
}

export const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      const deviceId = vnode.attrs["deviceId"];
      document.title = `${deviceId} - Device ${vnode.attrs["tab"]} - GenieACS`;

      const dev = store.fetch("devices", vnode.attrs["deviceFilter"]);
      if (!dev.value.length) {
        if (!dev.fulfilling)
          return m("p.error", `No such device ${deviceId}`);
        return m(
          "loading",
          { queries: [dev] },
          m("div", { style: "height: 100px;" }),
        );
      }

      const conf = config.ui.device;
      const multiTabs = config.ui.multiTabs;
      const cmps = [];

      if (Object.keys(multiTabs).length > 0) {
        const tabActive = { [vnode.attrs["tab"] || multiTabs[0]["route"]]: "active" };
        const tabs = [];
        const tabContent = [];

        // Encode deviceId only once
        const deviceIdEncoded = encodeURIComponent(deviceId).replace(/%2D/g, '-');
        
        for (const [k, c] of Object.entries(multiTabs)) {
            tabs.push(
                m("li", {
                    "class": tabActive[c["route"]],
                }, [
                    m("a", {
                        href: `#!/devices/${deviceIdEncoded}/${c["route"]}`,
                    }, c["label"])
                ])
            );

            if (tabActive[c["route"]]) {
                for (const comp of Object.values(c["components"])) {
                    tabContent.push(
                        m.context({ device: dev.value[0], deviceQuery: dev }, comp["type"], comp)
                    );
                }
            }
        }

        cmps.push(
            m("div.tab", [
                m("ul", tabs),
                m("div.tab_content", tabContent)
            ])
        );
      } else {
        for (const c of Object.values(conf)) {
          cmps.push(
            m.context(
              { device: dev.value[0], deviceQuery: dev },
              store.evaluateExpression(c["type"], null) as string,
              c,
            ),
          );
       }
      }

      return [m("h1", deviceId), cmps];
    },
  };
};
