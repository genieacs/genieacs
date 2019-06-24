/**
 * Copyright 2013-2019  GenieACS Inc.
 *
 * This file is part of GenieACS.
 *
 * GenieACS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * GenieACS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
 */

import m, { ClosureComponent, Component } from "mithril";
import { parse, stringify, map } from "../lib/common/expression-parser";
import memoize from "../lib/common/memoize";
import Autocomplete from "./autocomplete-compnent";
import * as smartQuery from "./smart-query";
import { filterToMongoQuery } from "../lib/mongodb-functions";
import { Expression } from "../lib/types";

const getAutocomplete = memoize(resource => {
  const labels = smartQuery.getLabels(resource);
  const autocomplete = new Autocomplete("autocomplete", (txt, cb) => {
    txt = txt.toLowerCase();
    cb(
      labels
        .filter(s => s.toLowerCase().includes(txt))
        .map(s => ({
          value: `${s}: `,
          tip: smartQuery.getTip(resource, s)
        }))
    );
  });
  return autocomplete;
});

function parseFilter(resource, f): Expression {
  let exp;
  if (/^[\s0-9a-zA-Z]+:/.test(f)) {
    const k = f.split(":", 1)[0];
    const v = f.slice(k.length + 1).trim();
    exp = ["FUNC", "Q", k.trim(), v];
  } else {
    exp = parse(f);
  }

  // Throw exception if invalid Mongo query
  filterToMongoQuery(
    map(exp, e => {
      if (Array.isArray(e) && e[0] === "FUNC" && e[1] === "Q")
        return smartQuery.unpack(resource, e[2], e[3]);
      return e;
    })
  );

  return exp;
}

function stringifyFilter(f: Expression): string {
  if (Array.isArray(f) && f[0] === "FUNC" && f[1] === "Q")
    return `${f[2]}: ${f[3]}`;
  return stringify(f);
}

const splitFilter = memoize(filter => {
  if (!filter) return [""];
  const list = [];
  const f = parse(filter);
  if (Array.isArray(f) && f[0] === "AND")
    for (const ff of f.slice(1)) list.push(stringifyFilter(ff));
  else list.push(stringifyFilter(f));

  list.push("");
  return list;
});

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      if (
        !vnode.state["filterList"] ||
        vnode.attrs["filter"] !== vnode.state["filter"]
      ) {
        vnode.state["filterInvalid"] = 0;
        vnode.state["filter"] = vnode.attrs["filter"];
        vnode.state["filterList"] = splitFilter(vnode.attrs["filter"]);
      }

      function onChange(): void {
        vnode.state["filterInvalid"] = 0;
        vnode.state["filterList"] = vnode.state["filterList"].filter(f => f);
        let filter = vnode.state["filterList"].map((f, idx) => {
          try {
            return parseFilter(vnode.attrs["resource"], f);
          } catch (err) {
            vnode.state["filterInvalid"] |= 1 << idx;
          }
          return null;
        });
        vnode.state["filterList"].push("");

        if (!vnode.state["filterInvalid"]) {
          delete vnode.state["filter"];
          if (filter.length === 0) {
            vnode.attrs["onChange"]("");
          } else {
            if (filter.length > 1) filter = ["AND"].concat(filter);
            else filter = filter[0];
            vnode.attrs["onChange"](stringify(filter));
          }
        }
      }

      return m(
        "div.filter",
        [m("b", "Filter")].concat(
          vnode.state["filterList"].map((fltr, idx) => {
            return m("input", {
              type: "text",
              class: `${
                (vnode.state["filterInvalid"] >> idx) & 1 ? "error" : ""
              }`,
              value: fltr,
              onchange: e => {
                vnode.state["filterList"] = vnode.state["filterList"].slice();
                vnode.state["filterList"][idx] = e.target.value.trim();
                onChange();
              },
              oncreate: vn => {
                getAutocomplete(vnode.attrs["resource"]).attach(vn.dom);
              }
            });
          })
        )
      );
    }
  };
};

export default component;
