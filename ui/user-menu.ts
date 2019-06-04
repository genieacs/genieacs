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
import * as store from "./store";
import * as notifications from "./notifications";

const component: ClosureComponent = (): Component => {
  return {
    view: () => {
      if (window.username) {
        return m(
          "div.user-menu",
          window.username,
          m(
            "button",
            {
              onclick: e => {
                e.target.disabled = true;
                store
                  .logOut()
                  .then(() => {
                    location.hash = "";
                    location.reload();
                  })
                  .catch(err => {
                    e.target.disabled = false;
                    notifications.push("error", err.message);
                  });
                return false;
              }
            },
            "Log out"
          )
        );
      } else {
        return m(
          "div.user-menu",
          m(
            "a",
            {
              href:
                "#!/login?" + m.buildQueryString({ continue: m.route.get() })
            },
            "Log in"
          )
        );
      }
    }
  };
};

export default component;
