"use strict";

import m from "mithril";

import * as store from "./store";
import * as notifications from "./notifications";

export default function userMenu() {
  return {
    view: () => {
      if (window.username) {
        return m(
          "div.user-menu",
          window.username,
          m(
            "button",
            {
              onclick: e => {
                e.target.disabled = true;
                store
                  .logOut()
                  .then(() => {
                    location.hash = "";
                    location.reload();
                  })
                  .catch(err => {
                    e.target.disabled = false;
                    notifications.push("error", err.message);
                  });
                return false;
              }
            },
            "Log out"
          )
        );
      } else {
        return m(
          "div.user-menu",
          m(
            "a",
            {
              href:
                "#!/login?" + m.buildQueryString({ continue: m.route.get() })
            },
            "Log in"
          )
        );
      }
    }
  };
}
