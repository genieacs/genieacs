import { ClosureComponent } from "mithril";
import { m } from "../components.ts";
import * as taskQueue from "../task-queue.ts";
import { QueryResponse, evaluateExpression } from "../store.ts";
import * as expressionParser from "../../lib/common/expression/parser.ts";
import { icon } from "../tailwind-utility-components.ts";
import { FlatDevice } from "../../lib/ui/db.ts";
import { Expression } from "../../lib/types.ts";

interface Attrs {
  device: FlatDevice;
  parameter: Expression;
  label: Expression;
  childParameters: Record<string, { label: string; parameter: Expression }>;
  filter?: Expression;
  deviceQuery: QueryResponse;
}

const component: ClosureComponent<Attrs> = () => {
  return {
    oninit: (vnode) => {
      const obj = vnode.attrs.parameter;
      if (!Array.isArray(obj) || obj[0] !== "PARAM")
        throw new Error("Object must be a parameter path");
      vnode.state["object"] = obj[1];
      vnode.state["parameters"] = Object.values(vnode.attrs.childParameters);
    },
    view: (vnode) => {
      const device = vnode.attrs.device;
      const object = evaluateExpression(vnode.state["object"], device);
      const parameters = vnode.state["parameters"];

      if (typeof object !== "string" || !device[object]) return null;

      const instances: Set<string> = new Set();
      const prefix = `${object}.`;
      for (const p in device) {
        if (p.startsWith(prefix)) {
          const i = p.indexOf(".", prefix.length);
          if (i === -1) instances.add(p);
          else instances.add(p.slice(0, i));
        }
      }

      const headers = Object.values(parameters).map((p, i) => {
        const padding = i ? "px-3" : "pl-6 pr-3";

        return m(
          "th",
          {
            scope: "col",
            class:
              "py-3.5 text-left text-sm font-semibold text-stone-500 " +
              padding,
          },
          evaluateExpression(p["label"], device),
        );
      });

      headers.push(m("th.pl-3", { scope: "col" }));

      const thead = m("thead.bg-stone-50", m("tr", headers));

      const rows = [];
      for (const i of instances) {
        let filter = "filter" in vnode.attrs ? vnode.attrs.filter : true;

        filter = expressionParser.map(filter, (e) => {
          if (Array.isArray(e) && e[0] === "PARAM")
            return ["PARAM", ["||", i, ".", e[1]]];
          return e;
        });

        if (!evaluateExpression(filter, device)) continue;

        const row = parameters.map((p, j) => {
          const padding = j ? "px-3" : "pl-6 pr-3";

          const param = expressionParser.map(p.parameter, (e) => {
            if (Array.isArray(e) && e[0] === "PARAM")
              return ["PARAM", ["||", i, ".", e[1]]];
            return e;
          });
          return m(
            "td",
            {
              class: "whitespace-nowrap py-4 text-sm text-stone-900 " + padding,
            },
            m.context(
              {
                device: device,
                parameter: param,
              },
              p.type || "parameter",
              Object.assign({}, p, {
                device: device,
                parameter: param,
                label: null,
              }),
            ),
          );
        });

        if (device[i].writable === true) {
          row.push(
            m(
              "td",
              {
                class:
                  "whitespace-nowrap pl-3 pr-6 py-4 text-sm text-stone-900",
              },
              m(
                "button",
                {
                  title: "Delete this instance",
                  onclick: () => {
                    taskQueue.queueTask({
                      name: "deleteObject",
                      device: device["DeviceID.ID"].value[0] as string,
                      objectName: i,
                    });
                  },
                },
                m(icon, {
                  name: "delete-instance",
                  class: "inline h-4 w-4 text-cyan-700 hover:text-cyan-900",
                }),
              ),
            ),
          );
        } else {
          row.push(m("td"));
        }
        rows.push(m("tr", row));
      }

      if (!rows.length) {
        rows.push(
          m(
            "tr",
            m(
              "td.bg-stripes text-sm font-medium text-center text-stone-500 p-4",
              { colspan: headers.length },
              "No instances",
            ),
          ),
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
                      device: device["DeviceID.ID"].value[0] as string,
                      objectName: object,
                    });
                  },
                },
                m(icon, {
                  name: "add-instance",
                  class:
                    "inline h-4 w-4 ml-1 text-cyan-700 hover:text-cyan-900",
                }),
              ),
            ),
          ),
        );
      }

      let label;

      const l = evaluateExpression(vnode.attrs.label, device);
      if (l != null) label = m("h2", l);

      return [
        label,
        m(
          "loading",
          { queries: [vnode.attrs.deviceQuery] },
          m(
            "div.shadow-sm overflow-hidden rounded-lg w-max",
            m(
              "table.divide-y divide-stone-200",
              thead,
              m("tbody.divide-y divide-stone-200 bg-white", rows),
            ),
          ),
        ),
      ];
    },
  };
};

export default component;
