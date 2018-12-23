"use strict";

import m from "mithril";

const menu = {
  view: vnode => {
    const active = { [vnode.attrs.page]: "active" };

    return m(
      "nav",
      m("ul", [
        m(
          "li",
          { class: active["overview"] },
          m("a", { href: "#!/overview" }, "Overview")
        ),
        m(
          "li",
          { class: active["devices"] },
          m("a", { href: "#!/devices" }, "Devices")
        ),
        m(
          "li",
          { class: active["faults"] },
          m("a", { href: "#!/faults" }, "Faults")
        )
      ])
    );
  }
};

export default menu;
