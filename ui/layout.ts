import m, { ClosureComponent, Component } from "mithril";
import menu from "./menu.ts";
import drawerComponent from "./drawer-component.ts";
import userMenu from "./user-menu.ts";
import adminMenu from "./admin-menu.ts";
import * as overlay from "./overlay.ts";
import { version as VERSION } from "../package.json";
import datalist from "./datalist.ts";
import { LOGO_SVG } from "../build/assets.ts";

const adminPages = [
  "presets",
  "provisions",
  "virtualParameters",
  "files",
  "config",
  "users",
  "permissions",
];

const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      let sideMenu, group;

      if (adminPages.includes(vnode.attrs["page"])) {
        group = "admin";
        const attrs = {};
        attrs["page"] = vnode.attrs["page"];
        sideMenu = m(adminMenu, attrs);
      }

      const attrs = {};
      attrs["page"] = group || vnode.attrs["page"];

      return [
        m("#header", [
          m(
            "div.logo",
            m("img", { src: LOGO_SVG }),
            m("span.version", "v" + VERSION),
          ),
          m(userMenu),
          m(menu, attrs),
          m(drawerComponent),
        ]),
        m(
          "#content-wrapper",
          sideMenu,
          m("#content", { class: `page-${vnode.attrs["page"]}` }, [
            vnode.children,
          ]),
        ),
        overlay.render(),
        m(datalist),
      ];
    },
  };
};

export default component;
