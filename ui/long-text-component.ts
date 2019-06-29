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
import * as overlay from "./overlay";

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      const text = vnode.attrs["text"];
      const element = vnode.attrs["element"] || "span";

      function overflowed(_vnode): void {
        _vnode.dom.classList.add("long-text-overflowed");
        _vnode.dom.onclick = e => {
          overlay.open(() => {
            return m("textarea.long-text", {
              value: text,
              cols: 80,
              rows: 24,
              readonly: "",
              oncreate: vnode2 => {
                (vnode2.dom as HTMLTextAreaElement).focus();
                (vnode2.dom as HTMLTextAreaElement).select();
              }
            });
          });
          // prevent index page selection
          e.stopPropagation();
          m.redraw();
        };
      }

      return m(
        element,
        {
          oncreate: vnode2 => {
            if (vnode2.dom.clientWidth !== vnode2.dom.scrollWidth)
              overflowed(vnode2);
          },
          onupdate: vnode2 => {
            if (vnode2.dom.clientWidth === vnode2.dom.scrollWidth) {
              (vnode2.dom as HTMLElement).classList.remove(
                "long-text-overflowed"
              );
              (vnode2.dom as HTMLElement).onclick = null;
            } else {
              overflowed(vnode2);
            }
          },
          class: "long-text",
          title: text
        },
        text
      );
    }
  };
};

export default component;
