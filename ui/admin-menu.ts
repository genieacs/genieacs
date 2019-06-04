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

import m from "mithril";
import { ClosureComponent, Component } from "mithril";

const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      const active = { [vnode.attrs["page"]]: "active" };
      const tabs = [];

      if (window.authorizer.hasAccess("presets", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["presets"] },
            m("a", { href: "#!/admin/presets" }, "Presets")
          )
        );
      }

      if (window.authorizer.hasAccess("provisions", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["provisions"] },
            m("a", { href: "#!/admin/provisions" }, "Provisions")
          )
        );
      }

      if (window.authorizer.hasAccess("virtualParameters", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["virtualParameters"] },
            m("a", { href: "#!/admin/virtualParameters" }, "Virtual Parameters")
          )
        );
      }

      if (window.authorizer.hasAccess("files", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["files"] },
            m("a", { href: "#!/admin/files" }, "Files")
          )
        );
      }

      if (window.authorizer.hasAccess("config", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["config"] },
            m("a", { href: "#!/admin/config" }, "Config")
          )
        );
      }

      if (window.authorizer.hasAccess("permissions", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["permissions"] },
            m("a", { href: "#!/admin/permissions" }, "Permissions")
          )
        );
      }

      if (window.authorizer.hasAccess("users", 1)) {
        tabs.push(
          m(
            "li",
            { class: active["users"] },
            m("a", { href: "#!/admin/users" }, "Users")
          )
        );
      }

      return m("nav#side-menu", m("ul", tabs));
    }
  };
};

export default component;
