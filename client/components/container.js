"use strict";

import m from "mithril";
import * as components from "../components";
import * as store from "../store";
import Filter from "../../common/filter";
import * as funcCache from "../../common/func-cache";

const component = {
  view: vnode => {
    if (vnode.attrs.filter) {
      const filter = store.unpackFilter(
        funcCache.get(Filter.parse, vnode.attrs.filter)
      );
      if (!filter.test(vnode.attrs.device)) return;
    }

    let children = Object.values(vnode.attrs.components).map(c => {
      if (typeof c !== "object") return `${c}`;
      const attrs = Object.assign({}, vnode.attrs, c);
      return m(components.get(attrs.type), attrs);
    });
    if (vnode.attrs.element) return m(vnode.attrs.element, children);
    else return children;
  }
};

export default component;
