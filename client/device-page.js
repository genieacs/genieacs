"use strict";

import m from "mithril";

import * as config from "./config";
import Filter from "../common/filter";
import * as store from "./store";
import * as components from "./components";

function init(args) {
  return new Promise(resolve => {
    resolve({
      deviceId: args.id,
      deviceFilter: new Filter(["=", "DeviceID.ID", args.id])
    });
  });
}

const component = {
  view: vnode => {
    document.title = `${vnode.attrs.deviceId} - Devices - GenieACS`;

    let dev = store.fetch("devices", vnode.attrs.deviceFilter).value;
    if (!dev.length) return "Loading";
    const conf = config.get("ui.device");
    const cmps = [];

    for (let c of Object.values(conf))
      cmps.push(
        m(components.get(c["type"]), Object.assign({ device: dev[0] }, c))
      );

    return [
      m("h1", vnode.attrs.deviceId),
      m("span", dev[0]["InternetGatewayDevice.DeviceInfo.SerialNumber"]),
      cmps
    ];
  }
};

export { init, component };
