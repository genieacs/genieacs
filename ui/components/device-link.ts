import { ClosureComponent, Component } from "mithril";
import { m } from "../components";

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      let deviceId;
      if (vnode.attrs["device"])
        deviceId = vnode.attrs["device"]["DeviceID.ID"].value[0];

      const children = Object.values(vnode.attrs["components"]).map(c => {
        if (typeof c !== "object") return `${c}`;
        const attrs = Object.assign({}, vnode.attrs, c);
        return m(attrs["type"], attrs);
      });
      if (deviceId) {
        return m(
          "a",
          { href: `#!/devices/${encodeURIComponent(deviceId)}` },
          children
        );
      } else {
        return children;
      }
    }
  };
};

export default component;
