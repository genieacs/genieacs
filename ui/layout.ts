import m, { ClosureComponent, Component } from "mithril";
import menu from "./menu";
import drawerComponent from "./drawer-component";
import userMenu from "./user-menu";
import adminMenu from "./admin-menu";
import * as overlay from "./overlay";

const adminPages = [
  "presets",
  "provisions",
  "virtualParameters",
  "files",
  "config",
  "users",
  "permissions"
];

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
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
          m("img.logo", { src: "logo.svg" }),
          m(userMenu),
          m(menu, attrs),
          m(drawerComponent)
        ]),
        m(
          "#content-wrapper",
          sideMenu,
          m("#content", { class: `page-${vnode.attrs["page"]}` }, [
            vnode.children
          ])
        ),
        overlay.render()
      ];
    }
  };
};

export default component;
