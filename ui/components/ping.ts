import { ClosureComponent, Component, VnodeDOM } from "mithril";
import { m } from "../components.ts";
import * as store from "../store.ts";

const REFRESH_INTERVAL = 3000;

const component: ClosureComponent = (vn): Component => {
  let interval: ReturnType<typeof setInterval>;
  let host: string;

  const refresh = (): void => {
    if (!host) {
      const dom = (vn as VnodeDOM).dom;
      if (dom) dom.innerHTML = "";
      return;
    }

    let status = "";
    store
      .ping(host)
      .then((res) => {
        if (res["avg"] != null) status = `${Math.trunc(res["avg"])} ms`;
        else status = "Unreachable";
      })
      .catch(() => {
        status = "Error!";
        clearInterval(interval);
      })
      .finally(() => {
        const dom = (vn as VnodeDOM).dom;
        if (dom) dom.innerHTML = `Pinging ${host}: ${status}`;
      });
  };

  return {
    onremove: () => {
      clearInterval(interval);
    },
    view: (vnode) => {
      const device = vnode.attrs["device"];
      let param =
        device["InternetGatewayDevice.ManagementServer.ConnectionRequestURL"];
      if (!param)
        param = device["Device.ManagementServer.ConnectionRequestURL"];

      let h;
      try {
        const url = new URL(param.value[0]);
        h = url.hostname;
      } catch (err) {
        // Ignore
      }

      if (host !== h) {
        host = h;
        clearInterval(interval);
        if (host) {
          refresh();
          interval = setInterval(refresh, REFRESH_INTERVAL);
        }
      }

      return m("div", host ? `Pinging ${host}:` : "");
    },
  };
};

export default component;
