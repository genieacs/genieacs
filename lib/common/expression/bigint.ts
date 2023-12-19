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
export { _BigInt as BigInt, type _bigint as bigint };
