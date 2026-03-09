import m, { ClosureComponent, Component } from "mithril";
import * as overlay from "./overlay.ts";

const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      const text = vnode.attrs["text"];
      const element = vnode.attrs["element"] || "span";
      const className = vnode.attrs["class"] || "";

      function overflowed(_vnode): void {
        _vnode.dom.classList.add("cursor-pointer", "hover:underline");
        _vnode.dom.setAttribute("title", text);
        _vnode.dom.onclick = (e) => {
          overlay.open(() => {
            return m(
              "textarea.font-mono text-sm focus:ring-cyan-500 focus:border-cyan-500 border border-stone-300 rounded-md",
              {
                value: text,
                cols: 80,
                rows: 24,
                readonly: "",
                oncreate: (vnode2) => {
                  (vnode2.dom as HTMLTextAreaElement).focus();
                },
              },
            );
          });
          // prevent index page selection
          e.stopPropagation();
          m.redraw();
        };
      }

      return m(
        element,
        {
          oncreate: (vnode2) => {
            const w = Math.round(vnode2.dom.getBoundingClientRect().width);
            if (w !== vnode2.dom.scrollWidth) overflowed(vnode2);
          },
          onupdate: (vnode2) => {
            const w = Math.round(vnode2.dom.getBoundingClientRect().width);
            if (w === vnode2.dom.scrollWidth) {
              (vnode2.dom as HTMLElement).classList.remove(
                "cursor-pointer",
                "hover:underline",
              );
              (vnode2.dom as HTMLElement).onclick = null;
              (vnode2.dom as HTMLElement).removeAttribute("title");
            } else {
              overflowed(vnode2);
            }
          },
          class: "block truncate decoration-dotted max-w-full " + className,
        },
        text,
      );
    },
  };
};

export default component;
