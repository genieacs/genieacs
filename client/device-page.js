"use strict";

import m from "mithril";

import config from "./config";
import * as store from "./store";
import * as components from "./components";

function init(args) {
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

const component = {
  view: vnode => {
    document.title = `${vnode.attrs.deviceId} - Devices - GenieACS`;

    const dev = store.fetch("devices", vnode.attrs.deviceFilter).value;
    if (!dev.length) return "Loading";
    const conf = config.ui.device;
    const cmps = [];

    for (const c of Object.values(conf)) {
      cmps.push(
        m(components.get(c["type"]), Object.assign({ device: dev[0] }, c))
      );
    }

    return [
      m("h1", vnode.attrs.deviceId),
      m("span", dev[0]["InternetGatewayDevice.DeviceInfo.SerialNumber"]),
      cmps
    ];
  }
};

export { init, component };
