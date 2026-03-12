import { ClosureComponent, Component, VnodeDOM } from "mithril";
import { m } from "../components.ts";
import * as taskQueue from "../task-queue.ts";
import * as store from "../store.ts";
import Expression, { Value } from "../../lib/common/expression.ts";
import memoize from "../../lib/common/memoize.ts";
import timeAgo from "../timeago.ts";
import { icon } from "../tailwind-utility-components.ts";

const evaluateParam = memoize(
  (
    exp: Expression,
    obj: any,
    now: number,
  ): { value: Value; timestamp: number; parameter: string } => {
    let timestamp = now;
    const valueMap: Map<Expression.Literal, string> = new Map();
    const lit = exp.evaluate((e): Expression.Literal => {
      if (e instanceof Expression.Literal) return e;
      if (e instanceof Expression.Parameter) {
        let v = obj[e.path.toString()];
        if (v) {
          timestamp = Math.min(
            timestamp,
            obj[e.path.toString() + ":valueTimestamp"] ?? 0,
          );
          const t = obj[e.path.toString() + ":type"];
          if (t === "xsd:dateTime" && typeof v === "number")
            v = new Date(v).toLocaleString();
          const val = new Expression.Literal(v);
          valueMap.set(val, e.path.toString());
          return val;
        }
      } else if (e instanceof Expression.FunctionCall) {
        if (e.name === "NOW") return new Expression.Literal(now);
        else if (e.name === "DATE_STRING") {
          const v = e.args[0];
          if (v instanceof Expression.Literal) {
            return new Expression.Literal(
              new Date(v.value as string | number).toLocaleString(),
            );
          }
        }
      }
      return new Expression.Literal(null);
    });

    return { value: lit.value, timestamp, parameter: valueMap.get(lit) };
  },
);

const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      const device = vnode.attrs["device"];

      const { value, timestamp, parameter } = evaluateParam(
        vnode.attrs["parameter"],
        device,
        store.getTimestamp() + store.getClockSkew(),
      );

      if (value == null) return null;

      let edit;
      if (device[parameter + ":writable"]) {
        edit = m(
          "button",
          {
            title: "Edit parameter value",
            onclick: () => {
              taskQueue.stageSpv({
                name: "setParameterValues",
                devices: [device["DeviceID.ID"]],
                parameterValues: [
                  [parameter, device[parameter], device[parameter + ":type"]],
                ],
              });
            },
          },
          m(icon, {
            name: "edit",
            class: "inline h-4 w-4 ml-1 text-cyan-700 hover:text-cyan-900",
          }),
        );
      }

      const el = m("long-text", { text: `${value}` });

      return m(
        "span.inline-flex overflow-hidden align-top",
        {
          onmouseover: (e) => {
            e.redraw = false;
            // Don't update any child element
            if (e.target === (el as VnodeDOM).dom) {
              const now = Date.now() + store.getClockSkew();
              const localeString = new Date(timestamp).toLocaleString();
              e.target.title = `${localeString} (${timeAgo(now - timestamp)})`;
            }
          },
        },
        m("span.truncate", el),
        edit,
      );
    },
  };
};

export default component;
