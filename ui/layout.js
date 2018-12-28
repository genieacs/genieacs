"use strict";

import m from "mithril";

import menu from "./menu";
import drawerComponent from "./drawer-component";
import userMenu from "./user-menu";
import adminMenu from "./admin-menu";
import * as overlay from "./overlay";

const adminPages = ["presets", "provisions", "virtualParameters", "files"];

const layout = {
  view: vnode => {
    let sideMenu, group;
    if (adminPages.includes(vnode.attrs.page)) {
      group = "admin";
      sideMenu = m(adminMenu, { page: vnode.attrs.page });
    }

    return [
      m("#header", [
        m("img.logo", { src: "logo.svg" }),
        m(userMenu),
        m(menu, { page: group || vnode.attrs.page }),
        m(drawerComponent)
      ]),
      m(
        "#content-wrapper",
        sideMenu,
        m("#content", { class: `page-${vnode.attrs.page}` }, [vnode.children])
      ),
      overlay.render()
    ];
  }
};

export default layout;
