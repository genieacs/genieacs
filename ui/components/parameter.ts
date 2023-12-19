import { ClosureComponent, Component, VnodeDOM } from "mithril";
import { m } from "../components.ts";
import * as taskQueue from "../task-queue.ts";
import * as store from "../store.ts";
import { evaluate } from "../../lib/common/expression/util.ts";
import memoize from "../../lib/common/memoize.ts";
import timeAgo from "../timeago.ts";
import { getIcon } from "../icons.ts";

const evaluateParam = memoize((exp, obj, now: number) => {
  let timestamp = now;
  exp = evaluate(exp, null, now, (e) => {
    if (!Array.isArray(e)) return e;
    for (let i = 1; i < e.length; ++i) {
      if (
        Array.isArray(e[i]) &&
        e[i][0] === "PARAM" &&
        !Array.isArray(e[i][1])
      ) {
        let v = null;
        const p = obj[e[i][1]];
        if (p?.value) {
          v = p.value[0];
          timestamp = Math.min(timestamp, p.valueTimestamp);
        }
        e = e.slice();
        e[i] = v;
      }
    }
    if (e[0] === "FUNC" && e[1] === "DATE_STRING" && !Array.isArray(e[2]))
      return new Date(e[2]).toLocaleString();
    return e;
  });

  let parameter = null;
  let value = null;

  if (!Array.isArray(exp)) {
    value = exp;
  } else if (exp[0] === "PARAM") {
    const p = obj[exp[1]];
    if (p?.value) {
      timestamp = p.valueTimestamp;
      value = p.value[0];
      parameter = exp[1];
      if (p.value[1] === "xsd:dateTime" && typeof value === "number")
        value = new Date(value).toLocaleString();
    }
  }

  return { value, timestamp, parameter };
});

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
      if (device[parameter]?.writable) {
        edit = m(
          "button",
          {
            title: "Edit parameter value",
            onclick: () => {
              taskQueue.stageSpv({
                name: "setParameterValues",
                devices: [device["DeviceID.ID"].value[0]],
                parameterValues: [
                  [
                    parameter,
                    device[parameter].value[0],
                    device[parameter].value[1],
                  ],
                ],
              });
            },
          },
          getIcon("edit"),
        );
      }

      const el = m("long-text", { text: `${value}` });

      return m(
        "span",
        {
          class: "parameter-value",
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
        el,
        edit,
      );
    },
  };
};

export default component;
