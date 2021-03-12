/**
 * Copyright 2013-2021  GenieACS Inc.
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

import m, { ClosureComponent, Component, Vnode } from "mithril";

const elements: Map<string, Vnode> = new Map();

// Source: https://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/
function hash(str: string): number {
  let res = 0;
  for (let i = 0; i < str.length; ++i) {
    const c = str.charCodeAt(i);
    res = (res << 5) - res + c;
    res |= 0;
  }
  return res;
}

export function getDatalistId(options: string[]): string {
  const id = "datalist" + options.reduce((acc, cur) => acc ^ hash(cur), 0);
  if (!elements.has(id)) {
    const n = m(
      "datalist",
      { id },
      options.map((o) => m("option", { value: o }))
    );
    elements.set(id, n);
  }
  return id;
}

const component: ClosureComponent = (): Component => {
  return {
    view: () => {
      return [...elements.values()];
    },
    onupdate: () => {
      for (const id of elements.keys()) {
        const used = document.querySelector(`[list='${id}']`);
        if (!used) elements.delete(id);
      }
    },
  };
};

export default component;
