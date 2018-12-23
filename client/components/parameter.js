"use strict";

import m from "mithril";
import * as taskQueue from "../task-queue";

const component = {
  view: vnode => {
    const param = vnode.attrs.device[vnode.attrs.parameter];
    if (!param || !param.value) return m("span.na", "N/A");
    let value = param.value[0];
    if (param.value[1] === "xsd:dateTime")
      value = new Date(value).toISOString();

    let edit;
    if (param.writable)
      edit = m(
        "a.edit",
        {
          onclick: () => {
            taskQueue.stageSpv({
              name: "setParameterValues",
              device: vnode.attrs.device["DeviceID.ID"].value[0],
              parameterValues: [
                [vnode.attrs.parameter, param.value[0], param.value[1]]
              ]
            });
          }
        },
        "✎"
      );

    return m(
      "span.parameter-value",
      { title: param.valueTimestamp },
      value,
      edit
    );
  }
};

export default component;
