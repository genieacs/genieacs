import { ClosureComponent, Component, VnodeDOM } from "mithril";
import { m } from "../components";

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      const device = vnode.attrs["device"];

      const rows = Object.values(vnode.attrs["parameters"]).map(parameter => {
        const p = m.context(
          {
            device: device,
            parameter: parameter["parameter"]
          },
          parameter["type"] || "parameter",
          parameter
        );

        return m(
          "tr",
          {
            onupdate: vn => {
              (vn.dom as HTMLElement).style.display = (p as VnodeDOM).dom
                ? ""
                : "none";
            }
          },
          m("th", parameter["label"]),
          m("td", p)
        );
      });

      return m("table.parameter-list", rows);
    }
  };
};

export default component;
