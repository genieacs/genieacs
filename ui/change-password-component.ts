import { VnodeDOM, ClosureComponent } from "mithril";
import * as notifications from "./notifications.ts";
import { changePassword } from "./store.ts";
import { m } from "./components.ts";

interface Attrs {
  noAuth?: boolean;
  username?: string;
  onPasswordChange: () => void;
}

const component: ClosureComponent<Attrs> = () => {
  return {
    view: (vnode) => {
      const onPasswordChange = vnode.attrs.onPasswordChange;
      const enforceAuth = !vnode.attrs.noAuth;
      const username = vnode.attrs.username;

      if (username) vnode.state["username"] = username;

      const form = [
        m(
          "p",
          m(
            "label.block text-sm font-semibold text-stone-700 mt-2 mb-1",
            { for: "username" },
            "Username",
          ),
          m(
            "input.shadow-sm focus:ring-cyan-500 focus:border-cyan-500 block sm:text-sm border-stone-300 rounded-md",
            {
              name: "username",
              type: "text",
              value: vnode.state["username"],
              disabled: !!username,
              oninput: (e) => {
                vnode.state["username"] = e.target.value;
              },
              oncreate: (_vnode) => {
                (_vnode.dom as HTMLSelectElement).focus();
              },
            },
          ),
        ),
      ];

      let fields = {
        newPassword: "New password",
        confirmPassword: "Confirm password",
      };
      if (enforceAuth)
        fields = Object.assign({ authPassword: "Your password" }, fields);

      for (const [f, l] of Object.entries(fields)) {
        form.push(
          m(
            "p",
            m(
              "label.block text-sm font-semibold text-stone-700 mt-2 mb-1",
              { for: f },
              l,
            ),
            m(
              "input.shadow-sm focus:ring-cyan-500 focus:border-cyan-500 block sm:text-sm border-stone-300 rounded-md",
              {
                name: f,
                type: "password",
                value: vnode.state[f],
                oninput: (e) => {
                  vnode.state[f] = e.target.value;
                },
              },
            ),
          ),
        );
      }

      const submit = m(
        "button.ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-xs text-sm font-medium rounded-md text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500",
        {
          type: "submit",
        },
        "Change password",
      ) as VnodeDOM;

      form.push(m("div.flex justify-end mt-5", submit));

      const children = [
        m("h2.text-lg leading-6 font-medium text-stone-900", "Change password"),
        m(
          "form",
          {
            onsubmit: (e) => {
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
                  "Password confirm doesn't match new password",
                );
              } else {
                (submit.dom as HTMLFormElement).disabled = true;
                changePassword(
                  vnode.state["username"],
                  vnode.state["newPassword"],
                  vnode.state["authPassword"],
                )
                  .then(() => {
                    notifications.push(
                      "success",
                      "Password updated successfully",
                    );
                    if (onPasswordChange) onPasswordChange();
                    (submit.dom as HTMLFormElement).disabled = false;
                  })
                  .catch((err) => {
                    notifications.push("error", err.message);
                    (submit.dom as HTMLFormElement).disabled = false;
                  });
              }
            },
          },
          form,
        ),
      ];

      return m("div.put-form", children);
    },
  };
};

export default component;
