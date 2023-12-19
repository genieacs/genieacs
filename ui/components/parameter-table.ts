import { ClosureComponent } from "mithril";
import { m } from "../components.ts";
import * as taskQueue from "../task-queue.ts";
import { QueryResponse, evaluateExpression } from "../store.ts";
import * as expressionParser from "../../lib/common/expression/parser.ts";
import { getIcon } from "../icons.ts";
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

      const headers = Object.values(parameters).map((p) =>
        m("th", evaluateExpression(p["label"], device)),
      );

      const thead = m("thead", m("tr", headers));

      const rows = [];
      for (const i of instances) {
        let filter = "filter" in vnode.attrs ? vnode.attrs.filter : true;

        filter = expressionParser.map(filter, (e) => {
          if (Array.isArray(e) && e[0] === "PARAM")
            return ["PARAM", ["||", i, ".", e[1]]];
          return e;
        });

        if (!evaluateExpression(filter, device)) continue;

        const row = parameters.map((p) => {
          const param = expressionParser.map(p.parameter, (e) => {
            if (Array.isArray(e) && e[0] === "PARAM")
              return ["PARAM", ["||", i, ".", e[1]]];
            return e;
          });
          return m(
            "td",
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
                getIcon("delete-instance"),
              ),
            ),
          );
        }
        rows.push(m("tr", row));
      }

      if (!rows.length) {
        rows.push(
          m("tr.empty", m("td", { colspan: headers.length }, "No instances")),
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
                getIcon("add-instance"),
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
          m("table.table", thead, m("tbody", rows)),
        ),
      ];
    },
  };
};

export default component;
