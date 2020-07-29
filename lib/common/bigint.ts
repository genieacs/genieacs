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

export function and(a: bigint, b: bigint): bigint {
  return a & b;
}

export function or(a: bigint, b: bigint): bigint {
  return a | b;
}

export function xor(a: bigint, b: bigint): bigint {
  return a ^ b;
}

export function not(a: bigint): bigint {
  return ~a;
}

export function lshift(a: bigint, b: bigint): bigint {
  return a << b;
}

export function rshift(a: bigint, b: bigint): bigint {
  return a >> b;
}

export function add(a: bigint, b: bigint): bigint {
  return a + b;
}

export function sub(a: bigint, b: bigint): bigint {
  return a - b;
}

export function mul(a: bigint, b: bigint): bigint {
  return a * b;
}

export function div(a: bigint, b: bigint): bigint {
  return a / b;
}

export function exp(a: bigint, b: bigint): bigint {
  return a ** b;
}

export function rem(a: bigint, b: bigint): bigint {
  return a % b;
}

export function toNumber(a: bigint): number {
  return Number(a);
}

export function eq(a: bigint, b: bigint): boolean {
  return a === b;
}

export function ne(a: bigint, b: bigint): boolean {
  return a !== b;
}

export function lt(a: bigint, b: bigint): boolean {
  return a < b;
}

export function lte(a: bigint, b: bigint): boolean {
  return a <= b;
}

export function gt(a: bigint, b: bigint): boolean {
  return a > b;
}

export function gte(a: bigint, b: bigint): boolean {
  return a >= b;
}

export function asUintN(a: number, b: bigint): bigint {
  return BigInt.asUintN(a, b);
}

export function asIntN(a: number, b: bigint): bigint {
  return BigInt.asIntN(a, b);
}

const _BigInt = BigInt;
type _bigint = bigint;
export { _BigInt as BigInt, _bigint as bigint };
