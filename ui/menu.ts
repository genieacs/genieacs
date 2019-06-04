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

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      const active = { [vnode.attrs["page"]]: "active" };

      const tabs = [];
      if (window.authorizer.hasAccess("devices", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["overview"] },
            m("a", { href: "#!/overview" }, "Overview")
          )
        );
      }

      if (window.authorizer.hasAccess("devices", 2)) {
        tabs.push(
          m(
            "li",
            { class: active["devices"] },
            m("a", { href: "#!/devices" }, "Devices")
          )
        );
      }

      if (window.authorizer.hasAccess("faults", 2)) {
        tabs.push(
          m(
            "li",
            { class: active["faults"] },
            m("a", { href: "#!/faults" }, "Faults")
          )
        );
      }

      const adminPages = [
        "presets",
        "provisions",
        "virtualParameters",
        "files"
      ];
      for (const page of adminPages) {
        if (window.authorizer.hasAccess(page, 2)) {
          tabs.push(
            m(
              "li",
              { class: active["admin"] },
              m("a", { href: "#!/admin" }, "Admin")
            )
          );
          break;
        }
      }

      return m("nav", m("ul", tabs));
    }
  };
};

export default component;
