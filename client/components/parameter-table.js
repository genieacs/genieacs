"use strict";

import m from "mithril";
import * as components from "../components";
import * as taskQueue from "../task-queue";

const component = {
  view: vnode => {
    const device = vnode.attrs.device;
    const object = vnode.attrs.object;
    const parameters = vnode.attrs.parameters;

    if (!device[object]) return null;

    const instances = new Set();
    const prefix = `${object}.`;
    for (let p in device)
      if (p.startsWith(prefix)) {
        let i = p.indexOf(".", prefix.length);
        if (i === -1) instances.add(p);
        else instances.add(p.slice(0, i));
      }

    const headers = Object.values(parameters).map(p => m("th", p.label));

    const thead = m("thead", m("tr", headers));

    const rows = [];
    for (let i of instances) {
      const row = Object.values(parameters).map(p =>
        m(
          "td",
          m(
            components.get("parameter"),
            Object.assign({ device: device }, p, {
              parameter: `${i}.${p.parameter}`
            })
          )
        )
      );
      if (device[i].writable === true)
        row.push(
          m(
            "td",
            m(
              "a.delete",
              {
                onclick: () => {
                  taskQueue.queueTask({
                    name: "deleteObject",
                    device: device["DeviceID.ID"].value[0],
                    objectName: i
                  });
                }
              },
              "−"
            )
          )
        );
      rows.push(m("tr", row));
    }
    if (device[object].writable === true)
      rows.push(
        m(
          "tr",
          m("td", { colspan: headers.length }),
          m(
            "td",
            m(
              "a.add",
              {
                onclick: () => {
                  taskQueue.queueTask({
                    name: "addObject",
                    device: device["DeviceID.ID"].value[0],
                    objectName: object
                  });
                }
              },
              "+"
            )
          )
        )
      );
    return m("table.parameter-table", thead, m("tbody", rows));
  }
};

export default component;
