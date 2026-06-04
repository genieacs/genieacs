import { ClosureComponent, Component, VnodeDOM } from "../mithril-compat.ts";
import { createLongText } from "../long-text-component.ts";

const component: ClosureComponent = (): Component => {
  let current: HTMLSpanElement | null = null;
  let lastText: string | undefined;
  let lastClass: string | undefined;

  function sync(vnode: VnodeDOM): void {
    const text = vnode.attrs["text"] || "";
    const cls = vnode.attrs["class"] || "";
    if (current && text === lastText && cls === lastClass) {
      // Even when content is unchanged, the diff engine has just pointed this
      // redraw's vnode.dom at its recorded placeholder span — detached since
      // our replaceWith below — so re-point it at the live element for
      // consumers that compare against vnode.dom (e.g. parameter.ts's hover
      // guard). The engine keeps no-op-diffing the detached placeholder,
      // which is benign: it is inert (no attrs/children) and unmount cleanup
      // happens via onremove → current.remove().
      vnode.dom = current;
      return;
    }

    const fresh = createLongText({ text, class: cls });
    const target = current ?? vnode.dom;
    target?.replaceWith(fresh);
    current = fresh;
    vnode.dom = fresh;
    lastText = text;
    lastClass = cls;
  }

  return {
    view: () => ({ tag: "span", attrs: {}, children: [] }),
    oncreate: sync,
    onupdate: sync,
    onremove: () => {
      current?.remove();
      current = null;
    },
  };
};

export default component;
