"use strict";

import m from "mithril";
import * as components from "../components";
import * as taskQueue from "../task-queue";
import * as store from "../store";
import * as filterParser from "../../common/filter-parser";

const component = {
  oninit: vnode => {
    vnode.state.object = filterParser.parseParameter(vnode.attrs.object);
    vnode.state.parameters = Object.values(vnode.attrs.parameters).map(
      parameter => {
        let p = filterParser.parseParameter(parameter.parameter);
        return Object.assign({}, parameter, { parameter: p });
      }
    );
  },
  view: vnode => {
    const device = vnode.attrs.device;
    const object = store.evaluateExpression(vnode.state.object, device);
    const parameters = vnode.state.parameters;

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
      const row = parameters.map(p =>
        m(
          "td",
          m(
            components.get("parameter"),
            Object.assign({}, p, {
              device: device,
              parameter: `${i}.${store.evaluateExpression(p.parameter, device)}`
            })
          )
        )
      );

      if (device[i].writable === true)
        row.push(
          m(
            "td",
            m(
              "button",
              {
                title: "Delete this instance",
                onclick: () => {
                  taskQueue.queueTask({
                    name: "deleteObject",
                    device: device["DeviceID.ID"].value[0],
                    objectName: i
                  });
                }
              },
              "✕"
            )
          )
        );
      rows.push(m("tr", row));
    }

    if (!rows.length)
      rows.push(
        m("tr.empty", m("td", { colspan: headers.length }, "No instances"))
      );

    if (device[object].writable === true)
      rows.push(
        m(
          "tr",
          m("td", { colspan: headers.length }),
          m(
            "td",
            m(
              "button",
              {
                title: "Create a new instance",
                onclick: () => {
                  taskQueue.queueTask({
                    name: "addObject",
                    device: device["DeviceID.ID"].value[0],
                    objectName: object
                  });
                }
              },
              "🞢"
            )
          )
        )
      );

    let label;
    if (vnode.attrs.label) label = m("h2", vnode.attrs.label);

    return [label, m("table.table", thead, m("tbody", rows))];
  }
};

export default component;
