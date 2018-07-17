"use strict";

import m from "mithril";

import * as expression from "../common/expression";

const component = {
  view: vnode => {
    const predefined = vnode.attrs.predefined || [];
    let a = m(
      "datalist#filters",
      predefined.map(f => m("option", { value: `${f.parameter} = ` }))
    );

    if (vnode.attrs.filter !== vnode.state.filter) {
      vnode.state.filterList = [];
      vnode.state.filter = vnode.attrs.filter;
      if (vnode.attrs.filter != null)
        if (vnode.attrs.filter[0] === "AND")
          for (let i = 1; i < vnode.attrs.filter.length; ++i)
            vnode.state.filterList.push(
              expression.stringify(vnode.attrs.filter[i])
            );
        else
          vnode.state.filterList.push(expression.stringify(vnode.attrs.filter));
      vnode.state.filterList.push("");
    }

    function onChange() {
      vnode.state.filterInvalid = 0;
      vnode.state.filterList = vnode.state.filterList.filter(
        f => f && f.trim()
      );
      let filter = vnode.state.filterList.map((f, idx) => {
        try {
          return expression.parse(f);
        } catch (err) {
          vnode.state.filterInvalid |= 1 << idx;
        }
      });
      if (filter.length) filter = ["AND"].concat(filter);
      else filter = null;

      vnode.state.filterList.push("");
      if (!vnode.state.filterInvalid) vnode.attrs.onChange(filter);
    }

    return m(
      "div.filter",
      [m("b", "Filter"), a].concat(
        vnode.state.filterList.map((fltr, idx) => {
          return m("input", {
            type: "text",
            list: "filters",
            class: `${(vnode.state.filterInvalid >> idx) & 1 ? "error" : ""}`,
            value: fltr,
            onchange: e => {
              vnode.state.filterList[idx] = e.target.value;
              onChange();
            }
          });
        })
      )
    );
  }
};

export default component;
