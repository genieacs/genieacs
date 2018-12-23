"use strict";

import m from "mithril";
import * as components from "../components";

const component = {
  view: vnode => {
    let children = Object.values(vnode.attrs.components).map(c => {
      const attrs = Object.assign({}, vnode.attrs, c);
      return m(components.get(attrs.type), attrs);
    });
    if (vnode.attrs.element) return m(vnode.attrs.element, children);
    else return children;
  }
};

export default component;
