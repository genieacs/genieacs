/**
 * Copyright 2013-2020  GenieACS Inc.
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

import JSBI from "jsbi";

export function and(a: JSBI, b: JSBI): JSBI {
  return JSBI.bitwiseAnd(a, b);
}

export function or(a: JSBI, b: JSBI): JSBI {
  return JSBI.bitwiseOr(a, b);
}

export function xor(a: JSBI, b: JSBI): JSBI {
  return JSBI.bitwiseXor(a, b);
}

export function not(a: JSBI): JSBI {
  return JSBI.bitwiseNot(a);
}

export function lshift(a: JSBI, b: JSBI): JSBI {
  return JSBI.leftShift(a, b);
}

export function rshift(a: JSBI, b: JSBI): JSBI {
  return JSBI.signedRightShift(a, b);
}

export function add(a: JSBI, b: JSBI): JSBI {
  return JSBI.add(a, b);
}

export function sub(a: JSBI, b: JSBI): JSBI {
  return JSBI.subtract(a, b);
}

export function mul(a: JSBI, b: JSBI): JSBI {
  return JSBI.multiply(a, b);
}

export function div(a: JSBI, b: JSBI): JSBI {
  return JSBI.divide(a, b);
}

export function exp(a: JSBI, b: JSBI): JSBI {
  return JSBI.exponentiate(a, b);
}

export function rem(a: JSBI, b: JSBI): JSBI {
  return JSBI.remainder(a, b);
}

export function toNumber(a: JSBI): number {
  return JSBI.toNumber(a);
}

export function eq(a: JSBI, b: JSBI): boolean {
  return JSBI.equal(a, b);
}

export function ne(a: JSBI, b: JSBI): boolean {
  return JSBI.notEqual(a, b);
}

export function lt(a: JSBI, b: JSBI): boolean {
  return JSBI.lessThan(a, b);
}

export function lte(a: JSBI, b: JSBI): boolean {
  return JSBI.lessThanOrEqual(a, b);
}

export function gt(a: JSBI, b: JSBI): boolean {
  return JSBI.greaterThan(a, b);
}

export function gte(a: JSBI, b: JSBI): boolean {
  return JSBI.greaterThanOrEqual(a, b);
}

export function asUintN(a: number, b: JSBI): JSBI {
  return JSBI.asUintN(a, b);
}

export function asIntN(a: number, b: JSBI): JSBI {
  return JSBI.asIntN(a, b);
}

const _BigInt = JSBI.BigInt;
type _bigint = JSBI;
export { _BigInt as BigInt, _bigint as bigint };
