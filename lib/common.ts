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

export const UNDEFINED_TYPE = "[object Undefined]";
export const NULL_TYPE = "[object Null]";
export const BOOLEAN_TYPE = "[object Boolean]";
export const NUMBER_TYPE = "[object Number]";
export const STRING_TYPE = "[object String]";
export const ARRAY_TYPE = "[object Array]";
export const OBJECT_TYPE = "[object Object]";
export const REGEXP_TYPE = "[object RegExp]";
export const DATE_TYPE = "[object Date]";

export const typeOf = (obj): string => Object.prototype.toString.call(obj);

export function generateDeviceId(deviceIdStruct): string {
  // Escapes everything except alphanumerics and underscore
  function esc(str): string {
    return str.replace(/[^A-Za-z0-9_]/g, chr => {
      const buf = Buffer.from(chr, "utf8");
      let rep = "";
      for (const b of buf) rep += "%" + b.toString(16).toUpperCase();
      return rep;
    });
  }

  // Guaranteeing globally unique id as defined in TR-069
  if (deviceIdStruct["ProductClass"]) {
    return (
      esc(deviceIdStruct["OUI"]) +
      "-" +
      esc(deviceIdStruct["ProductClass"]) +
      "-" +
      esc(deviceIdStruct["SerialNumber"])
    );
  }
  return esc(deviceIdStruct["OUI"]) + "-" + esc(deviceIdStruct["SerialNumber"]);
}

// Source: http://stackoverflow.com/a/6969486
export function escapeRegExp(str): string {
  return str.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
}
