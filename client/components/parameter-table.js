"use strict";

import m from "mithril";
import * as components from "../components";

const component = {
  view: vnode => {
    const device = vnode.attrs.device;
    const object = vnode.attrs.object;
    const parameters = vnode.attrs.parameters;

    if (!device[object]) return null;

    const instances = new Set();
    for (let p in device)
      if (p.startsWith(object))
        instances.add(p.slice(0, p.indexOf(".", object.length + 1)));

    const thead = m(
      "thead",
      m("tr", Object.values(parameters).map(p => m("th", p.label)))
    );
    const rows = [];
    for (let i of instances) {
      const row = Object.values(parameters).map(p =>
        m(
          "td",
          m(
            components.get("parameter"),
            Object.assign({ device: device }, p, {
              parameter: `${i}.${p.parameter}`
            })
          )
        )
      );
      rows.push(m("tr", row));
    }
    return m("table.parameter-table", thead, m("tbody", rows));
  }
};

export default component;
