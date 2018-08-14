"use strict";

import m from "mithril";
import * as expression from "../common/expression";
import memoize from "../common/memoize";

const splitFilter = memoize(filter => {
  if (!filter) return [""];
  const list = [];
  const f = expression.parse(filter);
  if (Array.isArray(f) && f[0] === "AND")
    for (let ff of f.slice(1)) list.push(expression.stringify(ff));
  else list.push(expression.stringify(f));

  list.push("");
  return list;
});

const component = {
  view: vnode => {
    const predefined = vnode.attrs.predefined || [];
    let a = m(
      "datalist#filters",
      predefined.map(f => m("option", { value: `${f.parameter} = ` }))
    );

    if (!vnode.state.filterList || vnode.attrs.filter !== vnode.state.filter) {
      vnode.state.filterInvalid = 0;
      vnode.state.filter = vnode.attrs.filter;
      vnode.state.filterList = splitFilter(vnode.attrs.filter);
    }

    function onChange() {
      vnode.state.filterInvalid = 0;
      vnode.state.filterList = vnode.state.filterList.filter(f => f);
      let filter = vnode.state.filterList.map((f, idx) => {
        try {
          return expression.parse(f);
        } catch (err) {
          vnode.state.filterInvalid |= 1 << idx;
        }
      });
      vnode.state.filterList.push("");

      if (!vnode.state.filterInvalid) {
        delete vnode.state.filter;
        if (filter.length === 0) {
          vnode.attrs.onChange("");
        } else {
          if (filter.length > 1) filter = ["AND"].concat(filter);
          else filter = filter[0];
          vnode.attrs.onChange(expression.stringify(filter));
        }
      }
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
              vnode.state.filterList = vnode.state.filterList.slice();
              vnode.state.filterList[idx] = e.target.value.trim();
              onChange();
            }
          });
        })
      )
    );
  }
};

export default component;
