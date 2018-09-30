"use strict";

import m from "mithril";
import * as expression from "../common/expression";
import memoize from "../common/memoize";
import Autocomplete from "./autocomplete-compnent";
import * as smartQuery from "./smart-query";

const getAutocomplete = memoize(resource => {
  const labels = smartQuery.getLabels(resource);
  const autocomplete = new Autocomplete("autocomplete", (txt, cb) => {
    txt = txt.toLowerCase();
    cb(labels.filter(s => s.toLowerCase().includes(txt)).map(s => `${s}: `));
  });
  return autocomplete;
});

function parseFilter(f) {
  if (/^[\s0-9a-zA-Z]+:/.test(f)) {
    const k = f.split(":", 1)[0];
    const v = f.slice(k.length + 1).trim();
    return ["FUNC", "Q", k.trim(), v];
  }
  return expression.parse(f);
}

function stringifyFilter(f) {
  if (Array.isArray(f) && f[0] === "FUNC" && f[1] === "Q")
    return `${f[2]}: ${f[3]}`;
  return expression.stringify(f);
}

const splitFilter = memoize(filter => {
  if (!filter) return [""];
  const list = [];
  const f = expression.parse(filter);
  if (Array.isArray(f) && f[0] === "AND")
    for (const ff of f.slice(1)) list.push(stringifyFilter(ff));
  else list.push(stringifyFilter(f));

  list.push("");
  return list;
});

const component = {
  view: vnode => {
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
          return parseFilter(f);
        } catch (err) {
          vnode.state.filterInvalid |= 1 << idx;
        }
        return null;
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
      [m("b", "Filter")].concat(
        vnode.state.filterList.map((fltr, idx) => {
          return m("input", {
            type: "text",
            class: `${(vnode.state.filterInvalid >> idx) & 1 ? "error" : ""}`,
            value: fltr,
            onchange: e => {
              vnode.state.filterList = vnode.state.filterList.slice();
              vnode.state.filterList[idx] = e.target.value.trim();
              onChange();
            },
            oncreate: vn => {
              getAutocomplete(vnode.attrs.resource).attach(vn.dom);
            }
          });
        })
      )
    );
  }
};

export default component;
