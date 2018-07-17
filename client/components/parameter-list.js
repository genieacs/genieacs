"use strict";

import m from "mithril";
import * as components from "../components";
import * as store from "../store";
import * as funcCache from "../../common/func-cache";
import * as expression from "../../common/expression";

const parseParameter = funcCache.getter(p => {
  p = expression.parse(p);
  if (Array.isArray(p) && p[0] === "PARAM") p = p[1];
  return p;
});

const component = {
  oninit: vnode => {
    vnode.state.parameters = Object.values(vnode.attrs.parameters).map(
      parameter =>
        Object.assign({}, parameter, {
          parameter: parseParameter(parameter.parameter)
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
