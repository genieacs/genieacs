import { ClosureComponent, Component } from "mithril";
import { m } from "./components";
import config from "./config";
import * as store from "./store";

export function init(args): Promise<{}> {
  if (!window.authorizer.hasAccess("devices", 2)) {
    return Promise.reject(
      new Error("You are not authorized to view this page")
    );
  }

  return Promise.resolve({
    deviceId: args.id,
    deviceFilter: ["=", ["PARAM", "DeviceID.ID"], args.id]
  });
}

export const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      document.title = `${vnode.attrs["deviceId"]} - Devices - GenieACS`;

      const dev = store.fetch("devices", vnode.attrs["deviceFilter"]).value;
      if (!dev.length) return "Loading";
      const conf = config.ui.device;
      const cmps = [];

      for (const c of Object.values(conf))
        cmps.push(m.context({ device: dev[0] }, c["type"], c));

      return [m("h1", vnode.attrs["deviceId"]), cmps];
    }
  };
};
