"use strict";

import { m } from "./components";

export function component() {
  return {
    view: function(vnode) {
      document.title = "Error! - GenieACS";
      return m("p.error", vnode.attrs.error);
    }
  };
}
