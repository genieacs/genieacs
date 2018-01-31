"use strict";

import m from "mithril";
import * as components from "../components";

const component = {
  view: vnode => {
    const param = vnode.attrs.device[vnode.attrs.parameter];
    if (!param || !param.value) return m("span.na", "N/A");
    let value = param.value[0];
    if (param.value[1] === "xsd:dateTime")
      value = new Date(value).toISOString();

    let meta;
    if (vnode.attrs.meta) {
      const metaAttrs = Object.assign(
        { device: vnode.attrs.device, parameter: vnode.attrs.parameter },
        vnode.attrs.meta
      );
      meta = m("span", [
        " (",
        m(components.get(metaAttrs.type), metaAttrs),
        ")"
      ]);
    }
    return [m("span", { title: param.valueTimestamp }, value), meta];
  }
};

export default component;
