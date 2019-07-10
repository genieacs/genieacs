/**
 * Copyright 2013-2019  GenieACS Inc.
 *
 * This file is part of GenieACS.
 *
 * GenieACS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * GenieACS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
 */

import { VnodeDOM, ClosureComponent, Component } from "mithril";
import * as notifications from "./notifications";
import { changePassword } from "./store";
import { m } from "./components";

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      const onPasswordChange = vnode.attrs["onPasswordChange"];
      const enforceAuth = !vnode.attrs["noAuth"];
      const username = vnode.attrs["username"];

      if (username) vnode.state["username"] = username;

      const form = [
        m(
          "p",
          m("label", { for: "username" }, "Username"),
          m("input", {
            name: "username",
            type: "text",
            value: vnode.state["username"],
            disabled: !!username,
            oninput: e => {
              vnode.state["username"] = e.target.value;
            },
            oncreate: _vnode => {
              (_vnode.dom as HTMLSelectElement).focus();
            }
          })
        )
      ];

      let fields = {
        newPassword: "New password",
        confirmPassword: "Confirm password"
      };
      if (enforceAuth)
        fields = Object.assign({ authPassword: "Your password" }, fields);

      for (const [f, l] of Object.entries(fields)) {
        form.push(
          m(
            "p",
            m("label", { for: f }, l),
            m("input", {
              name: f,
              type: "password",
              value: vnode.state[f],
              oninput: e => {
                vnode.state[f] = e.target.value;
              }
            })
          )
        );
      }

      const submit = m(
        "button.primary",
        {
          type: "submit"
        },
        "Change password"
      ) as VnodeDOM;

      form.push(m(".actions-bar", submit));

      const children = [
        m("h1", "Change password"),
        m(
          "form",
          {
            onsubmit: e => {
              e.redraw = false;
              e.preventDefault();
              if (
                !vnode.state["username"] ||
                !vnode.state["newPassword"] ||
                (enforceAuth && !vnode.state["authPassword"])
              ) {
                notifications.push("error", "Please fill all fields");
              } else if (
                vnode.state["newPassword"] !== vnode.state["confirmPassword"]
              ) {
                notifications.push(
                  "error",
                  "Password confirm doesn't match new password"
                );
              } else {
                (submit.dom as HTMLFormElement).disabled = true;
                changePassword(
                  vnode.state["username"],
                  vnode.state["newPassword"],
                  vnode.state["authPassword"]
                )
                  .then(() => {
                    notifications.push(
                      "success",
                      "Password updated successfully"
                    );
                    if (onPasswordChange) onPasswordChange();
                    (submit.dom as HTMLFormElement).disabled = false;
                  })
                  .catch(err => {
                    notifications.push("error", err.message);
                    (submit.dom as HTMLFormElement).disabled = false;
                  });
              }
            }
          },
          form
        )
      ];

      return m("div.put-form", children);
    }
  };
};

export default component;
