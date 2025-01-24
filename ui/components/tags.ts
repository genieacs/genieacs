import { ClosureComponent } from "mithril";
import { m } from "../components.ts";
import * as notifications from "../notifications.ts";
import * as store from "../store.ts";
import { getIcon } from "../icons.ts";
import { decodeTag } from "../../lib/util.ts";
import { Expression } from "../../lib/types.ts";
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
        if (p.startsWith("Tags.")) tags.push(decodeTag(p.slice(5)));

      tags.sort();

      if (!writable) {
        return m(
          ".tags",
          tags.map((t) => m("span.tag", t)),
        );
      }

      return m(
        ".tags",
        tags.map((tag) =>
          m(
            "span.tag",
            tag,
            m(
              "button",
              {
                onclick: (e) => {
                  e.target.disabled = true;
                  const deviceId = device["DeviceID.ID"].value[0] as string;
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
              getIcon("remove"),
            ),
          ),
        ),
        m(
          "span.tag.writable",
          m.trust("&nbsp;"),
          m(
            "button",
            {
              onclick: (e) => {
                e.target.disabled = true;
                const deviceId = device["DeviceID.ID"].value[0] as string;
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
            getIcon("add"),
          ),
        ),
      );
    },
  };
};

export default component;
