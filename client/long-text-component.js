"use strict";

import m from "mithril";
import * as overlay from "./overlay";

const component = {
  view: vnode => {
    const text = vnode.attrs.text;
    const element = vnode.attrs.element || "span";

    return m(
      element,
      {
        class: "long-text",
        title: text,
        onclick: () => {
          overlay.open(() => {
            return m("textarea.long-text", {
              value: text,
              cols: 80,
              rows: 24,
              readonly: "",
              oncreate: vnode2 => {
                vnode2.dom.focus();
                vnode2.dom.select();
              }
            });
          });
        }
      },
      text
    );
  }
};

export default component;
