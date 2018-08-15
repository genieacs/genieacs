"use strict";

import m from "mithril";

const menu = {
  view: vnode => {
    const active = { [vnode.attrs.page]: "active" };

    let tabs = [];
    if (window.authorizer.hasAccess("devices", 1))
      tabs.push(
        m(
          "li",
          { class: active["overview"] },
          m("a", { href: "#!/overview" }, "Overview")
        )
      );

    if (window.authorizer.hasAccess("devices", 2))
      tabs.push(
        m(
          "li",
          { class: active["devices"] },
          m("a", { href: "#!/devices" }, "Devices")
        )
      );

    if (window.authorizer.hasAccess("faults", 2))
      tabs.push(
        m(
          "li",
          { class: active["faults"] },
          m("a", { href: "#!/faults" }, "Faults")
        )
      );

    if (window.authorizer.hasAccess("presets", 2))
      tabs.push(
        m(
          "li",
          { class: active["presets"] },
          m("a", { href: "#!/presets" }, "Presets")
        )
      );

    return m("nav", m("ul", tabs));
  }
};

export default menu;
