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

import { ClosureComponent, Component } from "mithril";
import { m } from "./components";
import { codeMirror } from "./dynamic-loader";

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      return m("textarea", {
        name: vnode.attrs["id"],
        value: vnode.attrs["value"],
        oncreate: _vnode => {
          const editor = codeMirror.fromTextArea(_vnode.dom, {
            mode: vnode.attrs["mode"],
            lineNumbers: true,
            readOnly: vnode.attrs["readOnly"],
            extraKeys: {
              "Ctrl-Enter": () => {
                if (vnode.attrs["onSubmit"])
                  vnode.attrs["onSubmit"](_vnode.dom);
              },
              "Cmd-Enter": () => {
                if (vnode.attrs["onSubmit"])
                  vnode.attrs["onSubmit"](_vnode.dom);
              }
            }
          });

          if (vnode.attrs["onChange"]) {
            editor.on("change", e => {
              vnode.attrs["onChange"](e.getValue());
            });
          }

          if (vnode.attrs["focus"]) editor.focus();
          if (vnode.attrs["onReady"]) vnode.attrs["onReady"](editor);
        }
      });
    }
  };
};

export default component;
