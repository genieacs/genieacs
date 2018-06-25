"use strict";

import m from "mithril";

import menu from "./menu";
import drawerComponent from "./drawer-component";
import userMenu from "./user-menu";
import * as overlay from "./overlay";

const layout = {
  view: vnode => {
    return [
      m("#header", [
        m("img.logo", { src: "logo.svg" }),
        m(userMenu),
        m(menu, { page: vnode.attrs.page }),
        m(drawerComponent)
      ]),
      m("#content", { class: `page-${vnode.attrs.page}` }, [vnode.children]),
      overlay.render()
    ];
  }
};

export default layout;
