import * as notifications from "./notifications.ts";
import { changePassword } from "./api-client.ts";
import { div, h2, form, p, label, input, button } from "./dom.ts";

interface Attrs {
  noAuth?: boolean;
  username?: string;
  onPasswordChange: () => void;
}

// DOM-based render function for use in overlays
export function renderChangePasswordForm(attrs: Attrs): Node {
  // Form state
  let usernameValue = attrs.username || "";
  let authPasswordValue = "";
  let newPasswordValue = "";
  let confirmPasswordValue = "";

  const enforceAuth = !attrs.noAuth;
  const submitBtn = button(
    {
      type: "submit",
      class:
        "ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-xs text-sm font-medium rounded-md text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500",
    },
    "Change password",
  );

  function handleSubmit(e: Event): void {
    e.preventDefault();

    if (
      !usernameValue ||
      !newPasswordValue ||
      (enforceAuth && !authPasswordValue)
    ) {
      notifications.push("error", "Please fill all fields");
      return;
    }

    if (newPasswordValue !== confirmPasswordValue) {
      notifications.push(
        "error",
        "Password confirm doesn't match new password",
      );
      return;
    }

    submitBtn.disabled = true;

    changePassword(
      usernameValue,
      newPasswordValue,
      enforceAuth ? authPasswordValue : undefined,
    )
      .then(() => {
        notifications.push("success", "Password updated successfully");
        if (attrs.onPasswordChange) attrs.onPasswordChange();
        submitBtn.disabled = false;
      })
      .catch((err) => {
        notifications.push("error", err.message);
        submitBtn.disabled = false;
      });
  }

  // Build form fields
  const fields: Node[] = [];

  // Username field
  const usernameInput = input({
    id: "username",
    name: "username",
    type: "text",
    value: usernameValue,
    disabled: !!attrs.username,
    class:
      "shadow-sm focus:ring-cyan-500 focus:border-cyan-500 block sm:text-sm border-stone-300 rounded-md",
    oninput: (e) => {
      usernameValue = (e.target as HTMLInputElement).value;
    },
    onMount: attrs.username
      ? undefined
      : (el) => {
          (el as HTMLInputElement).focus();
        },
  });

  fields.push(
    p(
      label(
        {
          for: "username",
          class: "block text-sm font-semibold text-stone-700 mt-2 mb-1",
        },
        "Username",
      ),
      usernameInput,
    ),
  );

  // Auth password field (if required)
  if (enforceAuth) {
    fields.push(
      p(
        label(
          {
            for: "authPassword",
            class: "block text-sm font-semibold text-stone-700 mt-2 mb-1",
          },
          "Your password",
        ),
        input({
          id: "authPassword",
          name: "authPassword",
          type: "password",
          value: authPasswordValue,
          class:
            "shadow-sm focus:ring-cyan-500 focus:border-cyan-500 block sm:text-sm border-stone-300 rounded-md",
          oninput: (e) => {
            authPasswordValue = (e.target as HTMLInputElement).value;
          },
        }),
      ),
    );
  }

  // New password field
  fields.push(
    p(
      label(
        {
          for: "newPassword",
          class: "block text-sm font-semibold text-stone-700 mt-2 mb-1",
        },
        "New password",
      ),
      input({
        id: "newPassword",
        name: "newPassword",
        type: "password",
        value: newPasswordValue,
        class:
          "shadow-sm focus:ring-cyan-500 focus:border-cyan-500 block sm:text-sm border-stone-300 rounded-md",
        oninput: (e) => {
          newPasswordValue = (e.target as HTMLInputElement).value;
        },
      }),
    ),
  );

  // Confirm password field
  fields.push(
    p(
      label(
        {
          for: "confirmPassword",
          class: "block text-sm font-semibold text-stone-700 mt-2 mb-1",
        },
        "Confirm password",
      ),
      input({
        id: "confirmPassword",
        name: "confirmPassword",
        type: "password",
        value: confirmPasswordValue,
        class:
          "shadow-sm focus:ring-cyan-500 focus:border-cyan-500 block sm:text-sm border-stone-300 rounded-md",
        oninput: (e) => {
          confirmPasswordValue = (e.target as HTMLInputElement).value;
        },
      }),
    ),
  );

  fields.push(div({ class: "flex justify-end mt-5" }, submitBtn));

  const content = div(
    { class: "put-form" },
    h2(
      { class: "text-lg leading-6 font-medium text-stone-900" },
      "Change password",
    ),
    form({ onsubmit: handleSubmit }, ...fields),
  );

  return content;
}
