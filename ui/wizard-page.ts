import { ClosureComponent, Component } from "mithril";
import { m } from "./components.ts";
import * as notifications from "./notifications.ts";

export async function init(): Promise<Record<string, unknown>> {
  return m.request({ url: "init" });
}

export const component: ClosureComponent = (vnode): Component => {
  let options = vnode.attrs;
  const selected = new Set<string>();
  for (const [k, v] of Object.entries(options)) if (v) selected.add(k);

  return {
    view: () => {
      document.title = "Initialization wizard - GenieACS";

      const items = [
        { key: "users", label: "Users, roles and permissions" },
        { key: "presets", label: "Presets and provisions" },
        { key: "filters", label: "Devices predefined search filters" },
        { key: "device", label: "Device details page" },
        { key: "index", label: "Devices listing page" },
        { key: "overview", label: "Overview page" },
      ];

      return [
        m(
          "h1.text-xl font-medium text-stone-900 mb-5",
          "Initialization wizard",
        ),
        m(".bg-white shadow-sm rounded-lg p-6 sm:p-8 max-w-lg", [
          m(
            "p.text-sm text-stone-600 mb-6",
            "This wizard will seed the database with a minimal initial configuration to serve as a starting point. Select what you want to initialize and click the button below.",
          ),
          m(
            ".flex flex-col gap-3 mb-6",
            items.map((item) => {
              if (!options[item.key]) selected.delete(item.key);
              return m(
                "label.flex items-center text-sm text-stone-700",
                { class: options[item.key] ? "" : "opacity-50" },
                m(
                  "input.focus:ring-cyan-500 h-4 w-4 text-cyan-700 border-stone-300 rounded-sm",
                  {
                    type: "checkbox",
                    checked: selected.has(item.key),
                    disabled: !options[item.key],
                    onclick: (e) => {
                      if (e.target.checked) selected.add(item.key);
                      else selected.delete(item.key);
                    },
                  },
                ),
                m("span.ml-2", item.label),
              );
            }),
          ),
          m(
            "button.inline-flex justify-center py-2 px-4 border border-transparent shadow-xs text-sm font-medium rounded-md text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed",
            {
              disabled: selected.size === 0,
              onclick: (e) => {
                e.target.disabled = true;

                const opts = {};
                for (const s of selected) opts[s] = true;

                m.request({
                  method: "POST",
                  url: "init",
                  body: opts,
                })
                  .then(() => {
                    setTimeout(() => {
                      m.request({ url: "init" })
                        .then((o) => {
                          e.target.disabled = false;
                          options = o;
                          notifications.push(
                            "success",
                            "Initialization complete",
                            {
                              "Open Sesame!": () => {
                                m.route.set("/login");
                                window.location.reload();
                              },
                            },
                          );
                        })
                        .catch((err) => {
                          notifications.push("error", err.message);
                        });
                    }, 3000);
                    if (opts["users"]) {
                      alert(
                        "An administrator user has been created for you. Use admin/admin to log in. Don't forget to change the default password.",
                      );
                    }
                  })
                  .catch((err) => {
                    notifications.push("error", err.message);
                  });
              },
            },
            "ABRACADABRA!",
          ),
        ]),
      ];
    },
  };
};
