import { ClosureComponent, Component } from "mithril";
import { m } from "../components.ts";
import { evaluateExpression } from "../store.ts";

const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      let deviceId;
      const device = vnode.attrs["device"];
      if (device) deviceId = device["DeviceID.ID"].value[0];

      const children = Object.values(vnode.attrs["components"]).map((c) => {
        if (Array.isArray(c)) c = evaluateExpression(c, device || {});
        if (typeof c !== "object") return `${c}`;
        const type = evaluateExpression(c["type"], device || {});
        if (!type) return null;
        const attrs = Object.assign({}, vnode.attrs, c);
        return m(type as string, attrs);
      });
      if (deviceId) {
        return m(
          "a",
          { href: `#!/devices/${encodeURIComponent(deviceId)}` },
          children,
        );
      } else {
        return children;
      }
    },
  };
};

export default component;
