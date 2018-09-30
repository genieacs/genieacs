"use strict";

import m from "mithril";
import * as taskQueue from "../task-queue";
import * as store from "../store";
import * as expression from "../../common/expression";
import memoize from "../../common/memoize";
import timeAgo from "../timeago";

const memoizedParse = memoize(expression.parse);

const evaluateParam = memoize((exp, obj, now) => {
  let timestamp = now;
  const params = new Set();
  const value = expression.evaluate(memoizedParse(exp), obj, now, e => {
    if (Array.isArray(e)) {
      if (e[0] === "PARAM") {
        params.add(e[1]);
        if (!Array.isArray(e[1])) {
          const p = obj[e[1]];
          if (p && p.valueTimestamp)
            timestamp = Math.min(timestamp, p.valueTimestamp);
        }
      }
      if (e[0] === "FUNC" && e[1] === "DATE_STRING" && !Array.isArray(e[2]))
        return new Date(e[2]).toLocaleString();
    }
    return e;
  });

  let parameter = params.size === 1 ? params.values().next().value : null;
  if (Array.isArray(parameter)) parameter = null;
  return { value, timestamp, parameter };
});

const component = {
  view: vnode => {
    const device = vnode.attrs.device;

    const { value, timestamp, parameter } = evaluateParam(
      vnode.attrs.parameter,
      vnode.attrs.device,
      store.getTimestamp()
    );

    if (value == null) return null;

    let edit;
    if (device[parameter] && device[parameter].writable) {
      edit = m(
        "button",
        {
          title: "Edit parameter value",
          onclick: () => {
            taskQueue.stageSpv({
              name: "setParameterValues",
              device: device["DeviceID.ID"].value[0],
              parameterValues: [
                [
                  parameter,
                  device[parameter].value[0],
                  device[parameter].value[1]
                ]
              ]
            });
          }
        },
        "✎"
      );
    }

    return m(
      "span.parameter-value",
      {
        onmouseover: e => {
          e.redraw = false;
          const now = Date.now();
          const localeString = new Date(timestamp).toLocaleString();
          e.target.title = `${localeString} (${timeAgo(now - timestamp)})`;
        }
      },
      value,
      edit
    );
  }
};

export default component;
