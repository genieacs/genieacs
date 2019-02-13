"use strict";

import { m } from "./components";
import * as store from "./store";
import * as notifications from "./notifications";

export function init(args) {
  return Promise.resolve(args);
}

export function component() {
  return {
    view: vnode => {
      if (window.username) m.route.set(vnode.attrs.continue || "/");

      document.title = "Login - GenieACS";
      return [
        m("h1", "Log in"),
        m(
          "form",
          m(
            "p",
            m("label", { for: "username" }, "Username"),
            m("input", {
              name: "username",
              type: "text",
              value: vnode.state.username,
              oncreate: vnode2 => {
                vnode2.dom.focus();
              },
              oninput: m.withAttr("value", v => (vnode.state.username = v))
            })
          ),
          m(
            "p",
            m("label", { for: "password" }, "Password"),
            m("input", {
              name: "password",
              type: "password",
              value: vnode.state.password,
              oninput: m.withAttr("value", v => (vnode.state.password = v))
            })
          ),
          m(
            "p",
            m(
              "button.primary",
              {
                type: "submit",
                onclick: e => {
                  e.target.disabled = true;
                  store
                    .logIn(vnode.state.username, vnode.state.password)
                    .then(() => {
                      location.reload();
                    })
                    .catch(err => {
                      notifications.push("error", err.message);
                      e.target.disabled = false;
                    });
                  return false;
                }
              },
              "Login"
            )
          )
        )
      ];
    }
  };
}
