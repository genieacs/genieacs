"use strict";

import { m } from "../components";
import * as taskQueue from "../task-queue";
import * as store from "../store";
import * as expressionParser from "../../lib/common/expression-parser";

export default function component() {
  return {
    oninit: vnode => {
      const obj = vnode.attrs.parameter;
      if (!Array.isArray(obj) || !obj[0] === "PARAM")
        throw new Error("Object must be a parameter path");
      vnode.state.object = obj[1];
      vnode.state.parameters = Object.values(vnode.attrs.childParameters);
    },
    view: vnode => {
      const device = vnode.attrs.device;
      const object = store.evaluateExpression(vnode.state.object, device);
      const parameters = vnode.state.parameters;

      if (!device[object]) return null;

      const instances = new Set();
      const prefix = `${object}.`;
      for (const p in device) {
        if (p.startsWith(prefix)) {
          const i = p.indexOf(".", prefix.length);
          if (i === -1) instances.add(p);
          else instances.add(p.slice(0, i));
        }
      }

      const headers = Object.values(parameters).map(p => m("th", p.label));

      const thead = m("thead", m("tr", headers));

      const rows = [];
      for (const i of instances) {
        let filter = vnode.attrs.filter != null ? vnode.attrs.filter : true;

        filter = expressionParser.map(filter, e => {
          if (Array.isArray(e) && e[0] === "PARAM")
            return ["PARAM", ["||", i, ".", e[1]]];
          return e;
        });

        if (!store.evaluateExpression(filter, device)) continue;

        const row = parameters.map(p => {
          const param = expressionParser.map(p.parameter, e => {
            if (Array.isArray(e) && e[0] === "PARAM")
              return ["PARAM", ["||", i, ".", e[1]]];
            return e;
          });
          return m(
            "td",
            m.context(
              {
                device: device,
                parameter: param
              },
              p.type || "parameter",
              Object.assign({}, p, {
                device: device,
                parameter: param
              })
            )
          );
        });

        if (device[i].writable === true) {
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
        }
        rows.push(m("tr", row));
      }

      if (!rows.length) {
        rows.push(
          m("tr.empty", m("td", { colspan: headers.length }, "No instances"))
        );
      }

      if (device[object].writable === true) {
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
      }

      let label;
      if (vnode.attrs.label) label = m("h2", vnode.attrs.label);

      return [label, m("table.table", thead, m("tbody", rows))];
    }
  };
}
