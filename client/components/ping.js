"use strict";

import m from "mithril";
import * as store from "../store";

const REFRESH_INTERVAL = 3000;

const component = {
  oninit: vnode => {
    vnode.state.timestamp = 0;
    vnode.state.ping = null;
    vnode.state.host = null;
    vnode.state.timeout = null;
  },
  view: vnode => {
    const refresh = () => {
      const device = vnode.attrs.device;
      let param =
        device["InternetGatewayDevice.ManagementServer.ConnectionRequestURL"];
      if (!param)
        param = device["Device.ManagementServer.ConnectionRequestURL"];
      if (!param || !param.value) return;

      const url = new URL(param.value[0]);
      vnode.state.host = url.hostname;
      vnode.state.timestamp = Date.now();
      store
        .ping(vnode.state.host)
        .then(res => {
          vnode.state.ping = res;
        })
        .catch(() => {
          // Do nothing
        });
    };

    const t = vnode.state.timestamp + REFRESH_INTERVAL - Date.now();
    clearTimeout(vnode.state.timeout);
    if (t <= 0) refresh();
    else vnode.state.timeout = setTimeout(refresh, t);

    if (vnode.state.host) {
      let status = "";
      if (vnode.state.ping) {
        if (vnode.state.ping.avg != null)
          status = `${Math.trunc(vnode.state.ping.avg)} ms`;
        else status = "Unreachable";
      }

      return m("div", `Pinging ${vnode.state.host}: ${status}`);
    }
    return null;
  }
};

export default component;
