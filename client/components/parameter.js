"use strict";

import m from "mithril";
import * as taskQueue from "../task-queue";

const component = {
  view: vnode => {
    const device = vnode.attrs.device;
    const parameter = vnode.attrs.parameter;
    const param = device[parameter];
    if (!param || !param.value) return m("span.na", "N/A");
    let value = param.value[0];
    if (param.value[1] === "xsd:dateTime")
      value = new Date(value).toLocaleString();

    let edit;
    if (param.writable)
      edit = m(
        "button",
        {
          title: "Edit parameter value",
          onclick: () => {
            taskQueue.stageSpv({
              name: "setParameterValues",
              device: device["DeviceID.ID"].value[0],
              parameterValues: [[parameter, param.value[0], param.value[1]]]
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
