import m, { ClosureComponent, Component } from "mithril";

const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      const active = { [vnode.attrs["page"]]: "active" };
      const tabs = [];

      if (window.authorizer.hasAccess("presets", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["presets"] },
            m("a", { href: "#!/admin/presets" }, "Presets"),
          ),
        );
      }

      if (window.authorizer.hasAccess("provisions", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["provisions"] },
            m("a", { href: "#!/admin/provisions" }, "Provisions"),
          ),
        );
      }

      if (window.authorizer.hasAccess("virtualParameters", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["virtualParameters"] },
            m(
              "a",
              { href: "#!/admin/virtualParameters" },
              "Virtual Parameters",
            ),
          ),
        );
      }

      if (window.authorizer.hasAccess("files", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["files"] },
            m("a", { href: "#!/admin/files" }, "Files"),
          ),
        );
      }

      if (window.authorizer.hasAccess("config", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["config"] },
            m("a", { href: "#!/admin/config" }, "Config"),
          ),
        );
      }

      if (window.authorizer.hasAccess("permissions", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["permissions"] },
            m("a", { href: "#!/admin/permissions" }, "Permissions"),
          ),
        );
      }

      if (window.authorizer.hasAccess("users", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["users"] },
            m("a", { href: "#!/admin/users" }, "Users"),
          ),
        );
      }

      return m("nav#side-menu", m("ul", tabs));
    },
  };
};

export default component;
