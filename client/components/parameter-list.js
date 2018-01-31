"use strict";

import m from "mithril";
import * as components from "../components";

const component = {
  view: vnode => {
    const device = vnode.attrs.device;
    const parameters = vnode.attrs.parameters;
    const filtered = Object.values(parameters).filter(
      p => p.parameter in device
    );
    const rows = filtered.map(p =>
      m(
        "tr",
        m("th", p.label),
        m(
          "td",
          m(components.get("parameter"), Object.assign({ device: device }, p))
        )
      )
    );
    return m("table.parameter-list", rows);
  }
};

export default component;
