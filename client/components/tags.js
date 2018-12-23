"use strict";

import m from "mithril";
import * as notifications from "../notifications";
import * as store from "../store";

const component = {
  view: vnode => {
    const device = vnode.attrs.device;
    let writable = true;
    if (vnode.attrs.writable != null) writable = vnode.attrs.writable;

    const tags = [];
    for (let p of Object.keys(device))
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
                store
                  .updateTags(device["DeviceID.ID"].value[0], { [tag]: false })
                  .then(() => {
                    e.target.disabled = false;
                    notifications.push("success", `Tag '${tag}' unassigned`);
                    store.fulfill(0, Date.now());
                  })
                  .catch(err => notifications.push("error", err.message));
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
              const tag = prompt(`Enter tag to assign to device:`);
              if (!tag) {
                e.target.disabled = false;
                return;
              }

              store
                .updateTags(device["DeviceID.ID"].value[0], { [tag]: true })
                .then(() => {
                  e.target.disabled = false;
                  notifications.push("success", `Tag '${tag}' assigned`);
                  store.fulfill(0, Date.now());
                })
                .catch(err => notifications.push("error", err.message));
            }
          },
          "🞢"
        )
      )
    );
  }
};

export default component;
