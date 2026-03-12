import { ClosureComponent, Component } from "mithril";
import { m } from "../components.ts";
import * as store from "../store.ts";
import * as notifications from "../notifications.ts";
import { stringify } from "../../lib/common/yaml.ts";
import Expression from "../../lib/common/expression.ts";
import Path from "../../lib/common/path.ts";

const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      const device = vnode.attrs["device"];
      const deviceId = device["DeviceID.ID"];
      const p = new Expression.Parameter(Path.parse("_id"));
      const exp = Expression.and(
        new Expression.Binary(">", p, new Expression.Literal(`${deviceId}:`)),
        new Expression.Binary(
          "<",
          p,
          new Expression.Literal(`${deviceId}:zzzz`),
        ),
      );
      const faults = store.fetch("faults", exp);

      const headers = [
        "Channel",
        "Code",
        "Message",
        "Detail",
        "Retries",
        "Timestamp",
        "",
      ].map((l, i) => {
        let padding: string;
        if (i === 0) padding = "pl-6 pr-3";
        else if (i === 6) padding = "pl-3";
        else padding = "px-3";
        return m(
          "th",
          {
            scope: "col",
            class:
              "py-3.5 text-left text-sm font-semibold text-stone-500 " +
              padding,
          },
          l,
        );
      });
      const thead = m("thead.bg-stone-50", m("tr", headers));

      const rows = [];
      for (const f of faults.value) {
        rows.push(
          m(
            "tr",
            m(
              "td.whitespace-nowrap pl-6 pr-3 py-4 text-sm text-stone-900",
              f["channel"],
            ),
            m(
              "td.whitespace-nowrap px-3 py-4 text-sm text-stone-900",
              f["code"],
            ),
            m(
              "td.whitespace-nowrap px-3 py-4 text-sm text-stone-900",
              m("long-text", { text: f["message"], class: "max-w-xs" }),
            ),
            m(
              "td.whitespace-nowrap px-3 py-4 text-sm text-stone-900",
              m("long-text", {
                text: stringify(f["detail"]),
                class: "max-w-xs",
              }),
            ),

            m(
              "td.whitespace-nowrap px-3 py-4 text-sm text-stone-900",
              f["retries"],
            ),
            m(
              "td.whitespace-nowrap px-3 py-4 text-sm text-stone-900",
              new Date(f["timestamp"]).toLocaleString(),
            ),
            m(
              "td.whitespace-nowrap pl-3 pr-6 py-4 text-sm text-stone-900",
              m(
                "button",
                {
                  class: "text-cyan-700 hover:text-cyan-900 font-medium",
                  title: "Delete fault",
                  onclick: (e) => {
                    e.redraw = false;
                    store
                      .deleteResource("faults", f["_id"])
                      .then(() => {
                        notifications.push("success", "Fault deleted");
                        store.setTimestamp(Date.now());
                        m.redraw();
                      })
                      .catch((err) => {
                        notifications.push("error", err.message);
                        store.setTimestamp(Date.now());
                      });
                  },
                },
                "Delete",
              ),
            ),
          ),
        );
      }

      if (!rows.length) {
        rows.push(
          m(
            "tr",
            m(
              "td.bg-stripes text-sm font-medium text-center text-stone-500 p-4",
              { colspan: headers.length },
              "No faults",
            ),
          ),
        );
      }

      return m(
        "loading",
        { queries: [faults] },
        m(
          "div.shadow-sm overflow-hidden rounded-lg w-max",
          m(
            "table.divide-y divide-stone-200",
            thead,
            m("tbody.divide-y divide-stone-200 bg-white", rows),
          ),
        ),
      );
    },
  };
};

export default component;
