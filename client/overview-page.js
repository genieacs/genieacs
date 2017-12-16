"use strict";

import m from "mithril";

const init = function() {
  return new Promise(resolve => {
    resolve({ message: "Hello world!" });
  });
};

const component = {
  view: vnode => {
    document.title = "Overview - GenieACS";
    return m(
      "a",
      { href: "#!/devices/202BC1-BM632w-000000" },
      vnode.attrs.message
    );
  }
};

export { init, component };
