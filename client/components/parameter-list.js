"use strict";

import m from "mithril";
import * as components from "../components";
import * as store from "../store";
import * as filterParser from "../../common/filter-parser";

const component = {
  oninit: vnode => {
    vnode.state.parameters = Object.values(vnode.attrs.parameters).map(
      parameter =>
        Object.assign({}, parameter, {
          parameter: filterParser.parseParameter(parameter.parameter)
        })
    );
  },
  view: vnode => {
    const device = vnode.attrs.device;

    const rows = [];
    for (let parameter of vnode.state.parameters) {
      let p = store.evaluateExpression(parameter.parameter, device);

      if (!(p in device)) continue;
      rows.push(
        m(
          "tr",
          m("th", parameter.label),
          m(
            "td",
            m(
              components.get(parameter.type || "parameter"),
              Object.assign({}, parameter, { device: device, parameter: p })
            )
          )
        )
      );
    }

    return m("table.parameter-list", rows);
  }
};

export default component;
