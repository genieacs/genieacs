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
            return m(
              "textarea.long-text",
              {
                cols: 80,
                rows: 24,
                readonly: "",
                oncreate: vnode2 => {
                  setTimeout(() => {
                    vnode2.dom.focus();
                    vnode2.dom.select();
                  }, 50);
                }
              },
              text
            );
          });
        }
      },
      text
    );
  }
};

export default component;
