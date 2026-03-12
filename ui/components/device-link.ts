import { ClosureComponent, Component } from "mithril";
import { m } from "../components.ts";
import { evaluateExpression } from "../store.ts";
import Expression from "../../lib/common/expression.ts";

const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      let deviceId;
      const device = vnode.attrs["device"];
      if (device) deviceId = device["DeviceID.ID"];

      const children = Object.values(vnode.attrs["components"]).map((c) => {
        if (c instanceof Expression)
          c = evaluateExpression(c, device ?? {}).value;
        if (typeof c !== "object") return `${c}`;
        const type = evaluateExpression(c["type"], device ?? {}).value;
        if (!type) return null;
        const attrs = Object.assign({}, vnode.attrs, c);
        return m(type as string, attrs);
      });
      if (deviceId) {
        return m(
          "a.text-cyan-700 hover:text-cyan-900 font-medium",
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
