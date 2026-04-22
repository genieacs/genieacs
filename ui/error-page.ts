import { ClosureComponent, Component } from "mithril";
import { m } from "./components.ts";

interface Attrs {
  error: string;
}

export const component: ClosureComponent<Attrs> = (): Component<Attrs> => {
  return {
    view: function (vnode) {
      document.title = "Error! - GenieACS";
      return m("p.text-sm font-bold text-red-500", vnode.attrs.error);
    },
  };
};
