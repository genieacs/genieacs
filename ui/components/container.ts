import { ClosureComponent, Component } from "mithril";
import { m } from "../components";
import * as store from "../store";

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      if (vnode.attrs["filter"]) {
        if (
          !store.evaluateExpression(
            vnode.attrs["filter"],
            vnode.attrs["device"]
          )
        )
          return null;
      }

      const children = Object.values(vnode.attrs["components"]).map(c => {
        if (typeof c !== "object") return `${c}`;
        return m(c["type"], c);
      });
      if (vnode.attrs["element"]) return m(vnode.attrs["element"], children);
      else return children;
    }
  };
};

export default component;
