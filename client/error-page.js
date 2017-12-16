"use strict";

const component = {
  view: function(vnode) {
    document.title = "Error! - GenieACS";
    return vnode.attrs.error;
  }
};

export { component };
