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

const UNITS = {
  year: 12 * 30 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  hour: 60 * 60 * 1000,
  minute: 60 * 1000,
  second: 1000
};

export default function timeAgo(dtime): string {
  let res = "";
  let level = 2;

  for (const [u, t] of Object.entries(UNITS)) {
    if (dtime >= t) {
      let n;
      if (level > 1) {
        n = Math.floor(dtime / t);
        dtime -= n * t;
      } else {
        n = Math.round(dtime / t);
      }
      if (n > 1) res += `${n} ${u}s `;
      else res += `${n} ${u} `;
      if (!--level) break;
    }
  }

  return res + "ago";
}
