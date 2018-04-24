"use strict";

import m from "mithril";
import * as components from "../components";
import * as taskQueue from "../task-queue";

function escapeRegExp(str) {
  return str.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
}

const component = {
  view: vnode => {
    const device = vnode.attrs.device;

    let search = m("input", {
      type: "text",
      placeholder: "Search parameters",
      oninput: e => {
        vnode.state.searchString = e.target.value;
      }
    });

    let instanceRegex = /\.[0-9]+$/;
    let re;
    if (vnode.state.searchString) {
      let keywords = vnode.state.searchString.split(" ").filter(s => s);
      if (keywords.length)
        re = new RegExp(keywords.map(s => escapeRegExp(s)).join(".*"), "i");
    }

    const rows = Object.keys(device)
      .sort()
      .map(k => {
        let p = device[k];
        let val = [];
        let attrs = {};
        if (re) {
          let str = p.value && p.value[0] ? `${k} ${p.value[0]}` : k;
          if (!re.test(str)) attrs.style = "display: none;";
        }

        if (p.object === false)
          val.push(
            m(
              components.get("parameter"),
              Object.assign({ device: device, parameter: k })
            )
          );
        else if (p.object && p.writable)
          if (instanceRegex.test(k)) {
            val.push(
              m(
                "button",
                {
                  title: "Delete this instance",
                  onclick: () => {
                    taskQueue.queueTask({
                      name: "deleteObject",
                      device: device["DeviceID.ID"].value[0],
                      objectName: k
                    });
                  }
                },
                "✕"
              )
            );
          } else {
            val.push(
              m(
                "button",
                {
                  title: "Create a new instance",
                  onclick: () => {
                    taskQueue.queueTask({
                      name: "addObject",
                      device: device["DeviceID.ID"].value[0],
                      objectName: k
                    });
                  }
                },
                "🞢"
              )
            );
          }

        val.push(
          m(
            "button",
            {
              title: "Refresh tree",
              onclick: () => {
                taskQueue.queueTask({
                  name: "getParameterValues",
                  device: device["DeviceID.ID"].value[0],
                  parameterNames: [k]
                });
              }
            },
            "↺"
          )
        );

        return m("tr", attrs, m("td.left", k), m("td.right", val));
      });

    return [
      m("h2", "Device parameters"),
      m(
        ".all-parameters",
        search,
        m(".parameter-list", m("table", m("tbody", rows)))
      )
    ];
  }
};

export default component;
