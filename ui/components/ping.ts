import { ClosureComponent, Component, VnodeDOM } from "mithril";
import { m } from "../components.ts";
import { ping } from "../api-client.ts";
import { FlatDevice } from "../../lib/ui/db.ts";

const REFRESH_INTERVAL = 3000;

interface Attrs {
  device: FlatDevice;
}

const component: ClosureComponent<Attrs> = (vn): Component<Attrs> => {
  let interval: ReturnType<typeof setInterval>;
  let host: string | undefined;

  const refresh = (): void => {
    if (!host) {
      const dom = (vn as VnodeDOM<Attrs>).dom;
      if (dom) dom.innerHTML = "";
      return;
    }

    let status = "";
    ping(host)
      .then((res) => {
        if (res["avg"] != null) status = `${Math.trunc(res["avg"])} ms`;
        else status = "Unreachable";
      })
      .catch(() => {
        status = "Error!";
        clearInterval(interval);
      })
      .finally(() => {
        const dom = (vn as VnodeDOM<Attrs>).dom;
        if (dom) dom.innerHTML = `Pinging ${host}: ${status}`;
      });
  };

  return {
    onremove: () => {
      clearInterval(interval);
    },
    view: (vnode) => {
      const device = vnode.attrs.device;
      let param = device[
        "InternetGatewayDevice.ManagementServer.ConnectionRequestURL"
      ] as string;
      if (!param)
        param = device[
          "Device.ManagementServer.ConnectionRequestURL"
        ] as string;
      let h;
      try {
        const url = new URL(param);
        h = url.hostname;
      } catch {
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

      return m("div.text-sm my-4", host ? `Pinging ${host}:` : "");
    },
  };
};

export default component;
