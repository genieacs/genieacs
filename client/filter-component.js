"use strict";

import m from "mithril";

import config from "./config";

const component = {
  view: vnode => {
    let a = m(
      "datalist#filters",
      config.filter.map(f => m("option", { value: `${f.label} = ` }))
    );

    const filterList = vnode.attrs.filterList.filter(f => {
      return !!f;
    });
    filterList.push("");

    return m(
      "div.filter",
      [m("b", "Filter"), a].concat(
        filterList.map((fltr, idx) => {
          return m("input", {
            type: "string",
            list: "filters",
            value: fltr,
            onchange: function(e) {
              e.redraw = false;
              filterList[idx] = this.value;
              m.route.set("/devices", {
                filter: filterList.filter(f => !!f)
              });
            }
          });
        })
      )
    );
  }
};

export default component;
