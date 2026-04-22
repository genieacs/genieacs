import { ClosureComponent, Component } from "mithril";
import { m } from "../components.ts";
import { evaluateExpression } from "../store.ts";
import Expression from "../../lib/common/expression.ts";
import { FlatDevice } from "../../lib/ui/db.ts";

interface Attrs {
  device?: FlatDevice;
  components: Record<string, unknown>;
}

const component: ClosureComponent<Attrs> = (): Component<Attrs> => {
  return {
    view: (vnode) => {
      let deviceId;
      const device = vnode.attrs.device;
      if (device) deviceId = device["DeviceID.ID"];

      const children = Object.values(vnode.attrs.components).map((c) => {
        if (c instanceof Expression)
          c = evaluateExpression(c, device ?? {}).value;
        if (typeof c !== "object" || c == null) return `${c}`;
        const comp = c as { type: Expression };
        const type = evaluateExpression(comp.type, device ?? {}).value;
        if (!type) return null;
        const attrs = Object.assign({}, vnode.attrs, comp);
        return m(type as string, attrs);
      });
      if (deviceId) {
        return m(
          "a.text-cyan-700 hover:text-cyan-900 font-medium",
          { href: `/devices/${encodeURIComponent(deviceId)}` },
          children,
        );
      } else {
        return children;
      }
    },
  };
};

export default component;
