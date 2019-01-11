"use strict";

import m from "mithril";
import * as components from "../components";
import * as store from "../store";

const component = {
  view: vnode => {
    if (vnode.attrs.filter) {
      if (!store.evaluateExpression(vnode.attrs.filter, vnode.attrs.device))
        return null;
    }

    const children = Object.values(vnode.attrs.components).map(c => {
      if (typeof c !== "object") return `${c}`;
      const attrs = Object.assign({}, vnode.attrs, c);
      return m(components.get(attrs.type), attrs);
    });
    if (vnode.attrs.element) return m(vnode.attrs.element, children);
    else return children;
  }
};

export default component;
