"use strict";

import m from "mithril";

import menu from "./menu";

const layout = {
  view: vnode => {
    return [
      m("#header", [
        m("img.logo", { src: "logo.svg" }),
        m(menu, { page: vnode.attrs.page })
      ]),
      m("#content", { class: `page-${vnode.attrs.page}` }, [vnode.children])
    ];
  }
};

export default layout;
