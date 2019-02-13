"use strict";

import { m } from "../components";

export default function component() {
  return {
    view: vnode => {
      const device = vnode.attrs.device;

      const rows = Object.values(vnode.attrs.parameters).map(parameter => {
        const p = m.context(
          {
            device: device,
            parameter: parameter.parameter
          },
          parameter.type || "parameter",
          parameter
        );

        return m(
          "tr",
          {
            onupdate: vn => {
              vn.dom.style.display = p.dom ? "" : "none";
            }
          },
          m("th", parameter.label),
          m("td", p)
        );
      });

      return m("table.parameter-list", rows);
    }
  };
}
