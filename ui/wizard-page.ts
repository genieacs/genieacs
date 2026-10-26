import * as notifications from "./notifications.ts";
import { request } from "./api-client.ts";
import { navigate, reload } from "./router.ts";
import { StateSignal } from "./signals.ts";
import { div, h1, p, label, input, span, button } from "./dom.ts";

export type Attrs = Record<string, boolean>;

export async function init(): Promise<Attrs> {
  const res = await request("/init");
  return (await res.json()) as Attrs;
}

export function createPage(attrs: Attrs): HTMLElement {
  document.title = "Initialization wizard - GenieACS";

  let options = attrs;
  const selected = new Set<string>();
  for (const [k, v] of Object.entries(options)) if (v) selected.add(k);
  const version = new StateSignal(0);
  let adminUsername = "admin";
  let adminPassword = "";
  let adminPasswordConfirm = "";

  const items = [
    { key: "users", label: "Users, roles and permissions" },
    { key: "presets", label: "Presets and provisions" },
    { key: "filters", label: "Devices predefined search filters" },
    { key: "device", label: "Device details page" },
    { key: "index", label: "Devices listing page" },
    { key: "overview", label: "Overview page" },
  ];

  return div(
    {},
    h1(
      { class: "text-xl font-medium text-stone-900 mb-5" },
      "Initialization wizard",
    ),
    () => {
      version.get();

      const submitBtn = button(
        {
          class:
            "inline-flex justify-center py-2 px-4 border border-transparent shadow-xs text-sm font-medium rounded-md text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
          disabled: selected.size === 0,
          onclick: () => handleSubmit(),
        },
        "ABRACADABRA!",
      );

      function updateButtonState(): void {
        submitBtn.disabled = selected.size === 0;
      }

      function handleSubmit(): void {
        submitBtn.disabled = true;

        const opts: Record<string, unknown> = {};
        for (const s of selected) opts[s] = true;

        if (opts["users"]) {
          if (adminPassword !== adminPasswordConfirm) {
            submitBtn.disabled = false;
            notifications.push("error", "Passwords do not match");
            return;
          }
          opts["username"] = adminUsername.trim();
          opts["password"] = adminPassword;
        }

        request("/init", { method: "POST", body: opts })
          .then(() => {
            setTimeout(() => {
              request("/init")
                .then((r) => r.json() as Promise<Record<string, boolean>>)
                .then((o) => {
                  options = o;
                  selected.clear();
                  for (const [k, v] of Object.entries(options))
                    if (v) selected.add(k);
                  adminPassword = "";
                  adminPasswordConfirm = "";
                  version.set(version.get() + 1);
                  notifications.push("success", "Initialization complete", {
                    "Open Sesame!": () => {
                      navigate("/login").then(reload).catch(console.error);
                    },
                  });
                })
                .catch((err) => {
                  submitBtn.disabled = false;
                  notifications.push("error", err.message);
                });
            }, 3000);
            if (opts["users"]) {
              alert(`Administrator user "${adminUsername.trim()}" created.`);
            }
          })
          .catch((err) => {
            submitBtn.disabled = false;
            notifications.push("error", err.message);
          });
      }

      const checkboxes = items.map((item) => {
        const disabled = !options[item.key];
        if (disabled) selected.delete(item.key);

        return label(
          {
            class: `flex items-center text-sm text-stone-700 ${disabled ? "opacity-50" : ""}`,
          },
          input({
            type: "checkbox",
            checked: selected.has(item.key),
            disabled,
            class:
              "focus:ring-cyan-500 h-4 w-4 text-cyan-700 border-stone-300 rounded-sm",
            onclick: (e) => {
              const checked = (e.currentTarget as HTMLInputElement).checked;
              if (checked) {
                selected.add(item.key);
              } else {
                selected.delete(item.key);
              }
              updateButtonState();
              if (item.key === "users") version.set(version.get() + 1);
            },
          }),
          span({ class: "ml-2" }, item.label),
        );
      });

      const credentialFields = selected.has("users")
        ? div(
            { class: "flex flex-col gap-3 mb-6" },
            label(
              { class: "block text-sm font-semibold text-stone-700" },
              "Admin username",
              input({
                type: "text",
                value: adminUsername,
                class:
                  "shadow-sm focus:ring-cyan-500 focus:border-cyan-500 block sm:text-sm border-stone-300 rounded-md",
                oninput: (e) => {
                  adminUsername = (e.target as HTMLInputElement).value;
                },
              }),
            ),
            label(
              { class: "block text-sm font-semibold text-stone-700" },
              "Admin password",
              input({
                type: "password",
                value: adminPassword,
                class:
                  "shadow-sm focus:ring-cyan-500 focus:border-cyan-500 block sm:text-sm border-stone-300 rounded-md",
                oninput: (e) => {
                  adminPassword = (e.target as HTMLInputElement).value;
                },
              }),
            ),
            label(
              { class: "block text-sm font-semibold text-stone-700" },
              "Confirm password",
              input({
                type: "password",
                value: adminPasswordConfirm,
                class:
                  "shadow-sm focus:ring-cyan-500 focus:border-cyan-500 block sm:text-sm border-stone-300 rounded-md",
                oninput: (e) => {
                  adminPasswordConfirm = (e.target as HTMLInputElement).value;
                },
              }),
            ),
          )
        : null;

      return div(
        { class: "bg-white shadow-sm rounded-lg p-6 sm:p-8 max-w-lg" },
        p(
          { class: "text-sm text-stone-600 mb-6" },
          "This wizard will seed the database with a minimal initial configuration to serve as a starting point. Select what you want to initialize and click the button below.",
        ),
        div({ class: "flex flex-col gap-3 mb-6" }, ...checkboxes),
        credentialFields,
        submitBtn,
      );
    },
  );
}
