"use strict";

import m from "mithril";
import * as components from "../components";
import memoize from "../../common/memoize";

const getChildAttrs = memoize((attrs, device) =>
  Object.assign({}, attrs, { device: device })
);

const component = {
  view: vnode => {
    const device = vnode.attrs.device;

    const rows = Object.values(vnode.attrs.parameters).map(parameter =>
      m(
        "tr",
        m("th", parameter.label),
        m(
          "td",
          m(
            components.get(parameter.type || "parameter"),
            getChildAttrs(parameter, device)
          )
        )
      )
    );

    return m("table.parameter-list", rows);
  }
};

export default component;
