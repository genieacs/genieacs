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

import { Attributes, ClosureComponent, Component } from "mithril";
import { map } from "../../lib/common/expression-parser";
import memoize from "../../lib/common/memoize";
import { Expression } from "../../lib/types";
import { m } from "../components";
import { evaluateExpression, getTimestamp } from "../store";

const evaluateAttributes = memoize(
  (
    attrs: Record<string, Expression>,
    obj: Record<string, unknown>,
    now: number // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Attributes => {
    const res: Attributes = {};
    for (const [k, v] of Object.entries(attrs)) {
      const vv = map(v, (e) => {
        if (
          Array.isArray(e) &&
          e[0] === "FUNC" &&
          e[1] === "ENCODEURICOMPONENT"
        ) {
          const a = evaluateExpression(e[2], obj);
          if (a == null) return null;
          return encodeURIComponent(a as string);
        }
        return e;
      });
      res[k] = evaluateExpression(vv, obj);
    }
    return res;
  }
);

const component: ClosureComponent = (): Component => {
  return {
    view: (vnode) => {
      const device = vnode.attrs["device"];
      if ("filter" in vnode.attrs) {
        if (!evaluateExpression(vnode.attrs["filter"], device || {}))
          return null;
      }

      const children = Object.values(vnode.attrs["components"]).map((c) => {
        if (Array.isArray(c)) c = evaluateExpression(c, device || {});
        if (typeof c !== "object") return `${c}`;
        const type = evaluateExpression(c["type"], device || {});
        if (!type) return null;
        return m(type as string, c);
      });

      let el = vnode.attrs["element"];

      if (el == null) return children;

      let attrs: Attributes;
      if (Array.isArray(el)) {
        el = evaluateExpression(el, device || {});
      } else if (typeof el === "object") {
        if (el["attributes"] != null) {
          attrs = evaluateAttributes(
            el["attributes"],
            device || {},
            getTimestamp()
          );
        }

        el = evaluateExpression(el["tag"], device || {});
      }

      return m(el, attrs, children);
    },
  };
};

export default component;
