import { ClosureComponent } from "mithril";
import { m } from "../components.ts";
import * as notifications from "../notifications.ts";
import * as store from "../store.ts";
import { icon } from "../tailwind-utility-components.ts";
import { decodeTag } from "../../lib/util.ts";
import Expression from "../../lib/common/expression.ts";
import { FlatDevice } from "../../lib/ui/db.ts";

interface Attrs {
  device: FlatDevice;
  writable?: Expression;
}

const component: ClosureComponent<Attrs> = () => {
  return {
    view: (vnode) => {
      const device = vnode.attrs.device;
      let writable = true;
      if ("writable" in vnode.attrs)
        writable = !!store.evaluateExpression(vnode.attrs.writable, device);

      const tags = [];
      for (const p of Object.keys(device))
        if (p.startsWith("Tags.") && p.lastIndexOf(":") === -1)
          tags.push(decodeTag(p.slice(5)));

      tags.sort();

      if (!writable) {
        return m(
          "div",
          tags.map((t) =>
            m(
              "span",
              {
                class:
                  "inline-flex items-center px-3 py-0.5 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800 mr-2 -my-0.5 ring-1 ring-yellow-200",
              },
              t,
            ),
          ),
        );
      }

      return m(
        "div",
        tags.map((tag) =>
          m(
            "span",
            {
              class:
                "inline-flex items-center pl-3 pr-1 py-0.5 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800 mr-2 ring-1 ring-yellow-200",
            },
            tag,
            m(
              "button",
              {
                title: "Remove tag",
                class:
                  "flex-shrink-0 ml-0.5 h-4 w-4 rounded-full inline-flex items-center justify-center text-yellow-400 hover:bg-yellow-200 hover:text-yellow-500 focus:outline-hidden focus:bg-yellow-500 focus:text-white",
                onclick: (e) => {
                  e.target.disabled = true;
                  const deviceId = device["DeviceID.ID"] as string;
                  store
                    .updateTags(deviceId, { [tag]: false })
                    .then(() => {
                      e.target.disabled = false;
                      notifications.push(
                        "success",
                        `${deviceId}: Tags updated`,
                      );
                      store.setTimestamp(Date.now());
                    })
                    .catch((err) => {
                      e.target.disabled = false;
                      notifications.push(
                        "error",
                        `${deviceId}: ${err.message}`,
                      );
                    });
                },
              },
              m("span.sr-only", "Remove tag"),
              m(icon, {
                name: "remove",
                class: "h-4 w-4",
              }),
            ),
          ),
        ),
        m(
          "span",
          {
            class:
              "inline-flex items-center pl-1 pr-1 py-0.5 rounded-full text-sm font-medium bg-yellow-50 ring-1 ring-yellow-200",
          },
          m.trust("&#x200B;"),
          m(
            "button",
            {
              title: "Add tag",
              class:
                "flex-shrink-0 h-4 w-4 rounded-full inline-flex items-center justify-center text-yellow-400 hover:bg-yellow-200 hover:text-yellow-500 focus:outline-hidden focus:bg-yellow-500 focus:text-white",
              onclick: (e) => {
                e.target.disabled = true;
                const deviceId = device["DeviceID.ID"] as string;
                const tag = prompt(`Enter tag to assign to device:`);
                if (!tag) {
                  e.target.disabled = false;
                  return;
                }

                store
                  .updateTags(deviceId, { [tag]: true })
                  .then(() => {
                    e.target.disabled = false;
                    notifications.push("success", `${deviceId}: Tags updated`);
                    store.setTimestamp(Date.now());
                  })
                  .catch((err) => {
                    e.target.disabled = false;
                    notifications.push("error", `${deviceId}: ${err.message}`);
                  });
              },
            },
            m("span.sr-only", "Add tag"),
            m(icon, {
              name: "add",
              class: "h-4 w-4",
            }),
          ),
        ),
      );
    },
  };
};

export default component;
