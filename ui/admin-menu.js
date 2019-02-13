"use strict";

import m from "mithril";

export default function menu() {
  return {
    view: vnode => {
      const active = { [vnode.attrs.page]: "active" };
      const tabs = [];

      if (window.authorizer.hasAccess("presets", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["presets"] },
            m("a", { href: "#!/admin/presets" }, "Presets")
          )
        );
      }

      if (window.authorizer.hasAccess("provisions", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["provisions"] },
            m("a", { href: "#!/admin/provisions" }, "Provisions")
          )
        );
      }

      if (window.authorizer.hasAccess("virtualParameters", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["virtualParameters"] },
            m("a", { href: "#!/admin/virtualParameters" }, "Virtual Parameters")
          )
        );
      }

      if (window.authorizer.hasAccess("files", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["files"] },
            m("a", { href: "#!/admin/files" }, "Files")
          )
        );
      }

      if (window.authorizer.hasAccess("config", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["config"] },
            m("a", { href: "#!/admin/config" }, "Config")
          )
        );
      }

      return m("nav#side-menu", m("ul", tabs));
    }
  };
}
