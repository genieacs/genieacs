"use strict";

import m from "mithril";

const component = {
  view: function(vnode) {
    document.title = "Error! - GenieACS";
    return m("p.error", vnode.attrs.error);
  }
};

export { component };
