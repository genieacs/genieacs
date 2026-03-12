import { ClosureComponent } from "mithril";
import { m } from "../components.ts";
import * as taskQueue from "../task-queue.ts";
import { QueryResponse, evaluateExpression } from "../store.ts";
import { icon } from "../tailwind-utility-components.ts";
import { FlatDevice } from "../../lib/ui/db.ts";
import Expression from "../../lib/common/expression.ts";
import Path from "../../lib/common/path.ts";

interface Attrs {
  device: FlatDevice;
  parameter: Expression;
  label: Expression;
  childParameters: Record<string, { label: Expression; parameter: Expression }>;
  filter?: Expression;
  deviceQuery: QueryResponse;
}

const component: ClosureComponent<Attrs> = () => {
  let object: Path;
  let parameters: { label: Expression; parameter: Expression }[];

  return {
    oninit: (vnode) => {
      const obj = vnode.attrs.parameter;
      if (!(obj instanceof Expression.Parameter))
        throw new Error("Object must be a parameter path");
      object = obj.path;
      parameters = Object.values(vnode.attrs.childParameters);
    },
    view: (vnode) => {
      const device = vnode.attrs.device;
      const instances: Set<string> = new Set();
      const prefix = `${object.toString()}.`;
      for (const p in device) {
        if (!p.startsWith(prefix)) continue;
        if (p.lastIndexOf(":") !== -1) continue;
        const i = p.indexOf(".", prefix.length);
        if (i === -1) instances.add(p);
        else instances.add(p.slice(0, i));
      }

      const headers = parameters.map((p, i) => {
        const padding = i ? "px-3" : "pl-6 pr-3";

        return m(
          "th",
          {
            scope: "col",
            class:
              "py-3.5 text-left text-sm font-semibold text-stone-500 " +
              padding,
          },
          evaluateExpression(p.label, device).value,
        );
      });

      headers.push(m("th.pl-3", { scope: "col" }));

      const thead = m("thead.bg-stone-50", m("tr", headers));

      const rows = [];
      for (const i of instances) {
        let filter: Expression =
          "filter" in vnode.attrs
            ? vnode.attrs.filter
            : new Expression.Literal(true);

        const root = Path.parse(i);
        filter = filter.evaluate((e) => {
          if (e instanceof Expression.Parameter)
            return new Expression.Parameter(root.concat(e.path));
          return e;
        });

        if (!evaluateExpression(filter, device).value) continue;

        const row = parameters.map((p, j) => {
          const padding = j ? "px-3" : "pl-6 pr-3";

          const param = p.parameter.evaluate((e) => {
            if (e instanceof Expression.Parameter)
              return new Expression.Parameter(root.concat(e.path));
            return e;
          });

          let type = "parameter";
          if (p["type"] instanceof Expression)
            type = evaluateExpression(p["type"], device).value + "";

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
              type,
              Object.assign({}, p, {
                device: device,
                parameter: param,
                label: null,
              }),
            ),
          );
        });

        if (device[i + ":writable"]) {
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
                      device: device["DeviceID.ID"] as string,
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

      if (device[object.toString() + ":writable"]) {
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
                      device: device["DeviceID.ID"] as string,
                      objectName: object.toString(),
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
