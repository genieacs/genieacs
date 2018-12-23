"use strict";

import m from "mithril";

import * as config from "./config";
import * as filterParser from "../common/filter-parser";

const component = {
  view: vnode => {
    let a = m(
      "datalist#filters",
      Object.values(config.get("ui.filters")).map(f =>
        m("option", { value: `${f.parameter} = ` })
      )
    );

    if (vnode.attrs.filter !== vnode.state.filter) {
      vnode.state.filterList = [];
      vnode.state.filter = vnode.attrs.filter;
      if (vnode.attrs.filter)
        if (vnode.attrs.filter[0] === "AND")
          for (let i = 1; i < vnode.attrs.filter.length; ++i)
            vnode.state.filterList.push(
              filterParser.stringify(vnode.attrs.filter[i])
            );
        else
          vnode.state.filterList.push(
            filterParser.stringify(vnode.attrs.filter)
          );
      vnode.state.filterList.push("");
    }

    function onChange() {
      vnode.state.filterInvalid = 0;
      vnode.state.filterList = vnode.state.filterList.filter(
        f => f && f.trim()
      );
      let filterAst = vnode.state.filterList.map((f, idx) => {
        try {
          return filterParser.parse(f);
        } catch (err) {
          vnode.state.filterInvalid |= 1 << idx;
        }
      });
      if (filterAst.length) filterAst = ["AND"].concat(filterAst);
      else filterAst = null;

      vnode.state.filterList.push("");
      if (!vnode.state.filterInvalid) vnode.attrs.onChange(filterAst);
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
