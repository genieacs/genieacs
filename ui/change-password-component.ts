import { VnodeDOM, ClosureComponent } from "mithril";
import * as notifications from "./notifications.ts";
import { changePassword } from "./api-client.ts";
import { m } from "./components.ts";

interface Attrs {
  noAuth?: boolean;
  username?: string;
  onPasswordChange: () => void;
}

const component: ClosureComponent<Attrs> = () => {
  let usernameState = "";
  let newPassword = "";
  let confirmPassword = "";
  let authPassword = "";

  const labelClass =
    "label.block text-sm font-semibold text-stone-700 mt-2 mb-1";
  const inputClass =
    "input.shadow-sm focus:ring-cyan-500 focus:border-cyan-500 block sm:text-sm border-stone-300 rounded-md";

  return {
    view: (vnode) => {
      const onPasswordChange = vnode.attrs.onPasswordChange;
      const enforceAuth = !vnode.attrs.noAuth;
      const username = vnode.attrs.username;

      if (username) usernameState = username;

      const form = [
        m(
          "p",
          m(labelClass, { for: "username" }, "Username"),
          m(inputClass, {
            name: "username",
            type: "text",
            value: usernameState,
            disabled: !!username,
            oninput: (e: Event) => {
              usernameState = (e.target as HTMLInputElement).value;
            },
            oncreate: (_vnode) => {
              (_vnode.dom as HTMLSelectElement).focus();
            },
          }),
        ),
      ];

      if (enforceAuth) {
        form.push(
          m(
            "p",
            m(labelClass, { for: "authPassword" }, "Your password"),
            m(inputClass, {
              name: "authPassword",
              type: "password",
              value: authPassword,
              oninput: (e: Event) => {
                authPassword = (e.target as HTMLInputElement).value;
              },
            }),
          ),
        );
      }

      form.push(
        m(
          "p",
          m(labelClass, { for: "newPassword" }, "New password"),
          m(inputClass, {
            name: "newPassword",
            type: "password",
            value: newPassword,
            oninput: (e: Event) => {
              newPassword = (e.target as HTMLInputElement).value;
            },
          }),
        ),
        m(
          "p",
          m(labelClass, { for: "confirmPassword" }, "Confirm password"),
          m(inputClass, {
            name: "confirmPassword",
            type: "password",
            value: confirmPassword,
            oninput: (e: Event) => {
              confirmPassword = (e.target as HTMLInputElement).value;
            },
          }),
        ),
      );

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
            onsubmit: (e: Event) => {
              e.redraw = false;
              e.preventDefault();
              if (
                !usernameState ||
                !newPassword ||
                (enforceAuth && !authPassword)
              ) {
                notifications.push("error", "Please fill all fields");
              } else if (newPassword !== confirmPassword) {
                notifications.push(
                  "error",
                  "Password confirm doesn't match new password",
                );
              } else {
                (submit.dom as HTMLFormElement).disabled = true;
                changePassword(usernameState, newPassword, authPassword)
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
