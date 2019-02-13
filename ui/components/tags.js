"use strict";

import { m } from "../components";
import * as notifications from "../notifications";
import * as store from "../store";

export default function component() {
  return {
    view: vnode => {
      const device = vnode.attrs.device;
      let writable = true;
      if (vnode.attrs.writable != null) writable = vnode.attrs.writable;

      const tags = [];
      for (const p of Object.keys(device))
        if (p.startsWith("Tags.")) tags.push(p.slice(5));

      tags.sort();

      if (!writable) return m(".tags", tags.map(t => m("span.tag", t)));

      return m(
        ".tags",
        tags.map(tag =>
          m(
            "span.tag",
            tag,
            m(
              "button",
              {
                onclick: e => {
                  e.target.disabled = true;
                  const deviceId = device["DeviceID.ID"].value[0];
                  store
                    .updateTags(deviceId, { [tag]: false })
                    .then(() => {
                      e.target.disabled = false;
                      notifications.push(
                        "success",
                        `${deviceId}: Tags updated`
                      );
                      store.fulfill(0, Date.now());
                    })
                    .catch(err => {
                      e.target.disabled = false;
                      notifications.push(
                        "error",
                        `${deviceId}: ${err.message}`
                      );
                    });
                }
              },
              "✕"
            )
          )
        ),
        m(
          "span.tag.writable",
          m(
            "button",
            {
              onclick: e => {
                e.target.disabled = true;
                const deviceId = device["DeviceID.ID"].value[0];
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
                    store.fulfill(0, Date.now());
                  })
                  .catch(err => {
                    e.target.disabled = false;
                    notifications.push("error", `${deviceId}: ${err.message}`);
                  });
              }
            },
            "🞢"
          )
        )
      );
    }
  };
}
