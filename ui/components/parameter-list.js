"use strict";

import m from "mithril";
import { get } from "../components";
import memoize from "../../lib/common/memoize";

const getChildAttrs = memoize((attrs, device) =>
  Object.assign({}, attrs, { device: device })
);

export default {
  view: vnode => {
    const device = vnode.attrs.device;

    const rows = Object.values(vnode.attrs.parameters).map(parameter => {
      const p = m(
        get(parameter.type || "parameter"),
        getChildAttrs(parameter, device)
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
