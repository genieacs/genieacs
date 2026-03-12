import {
  Cursor,
  parseExpression,
  stringifyExpression,
} from "./expression/parser.ts";
import Path from "./path.ts";
import { reduce } from "./expression/evaluate.ts";

export type Value = string | number | boolean | null;

export abstract class Expression {
  private _string: string;

  abstract map(fn: (e: Expression, i: number) => Expression): Expression;
  abstract mapAsync(
    fn: (e: Expression, i: number) => Promise<Expression>,
  ): Promise<Expression>;

  toString(): string {
    if (!this._string) this._string = stringifyExpression(this);
    return this._string;
  }

  evaluate<T extends Expression>(fn: (e: Expression) => T = (e) => e as T): T {
    return fn(reduce(this.map((e) => e.evaluate(fn))));
  }

  async evaluateAsync<T extends Expression>(
    fn: (e: Expression) => Promise<T>,
  ): Promise<T> {
    return await fn(
      reduce(await this.mapAsync(async (e) => await e.evaluateAsync(fn))),
    );
  }

  static parse(input: string): Expression {
    const cursor = new Cursor(input);
    const exp = parseExpression(cursor);
    if (cursor.charCode) throw new Error("Unexpected character");
    return exp;
  }

  static and(left: Expression, right: Expression): Expression {
    // Flatten same-operator tree into operands
    const operands: Expression[] = [];
    const stack: Expression[] = [right, left];
    while (stack.length) {
      const e = stack.pop()!;
      if (e instanceof Expression.Binary && e.operator === "AND")
        stack.push(e.right, e.left);
      else operands.push(e);
    }

    // Fold literals using three-valued AND logic
    let folded: boolean | null = true;
    let i = 0;
    while (i < operands.length) {
      const e = operands[i];
      if (e instanceof Expression.Literal) {
        operands.splice(i, 1);
        if (e.value == null) folded = folded === false ? false : null;
        else if (!e.value) return new Expression.Literal(false);
        // truthy is identity for AND; discard
      } else {
        i++;
      }
    }

    // Rebuild: folded value + remaining non-literal operands
    if (!operands.length) return new Expression.Literal(folded);
    let result = operands.reduce((a, b) => new Expression.Binary("AND", a, b));
    if (folded === null)
      result = new Expression.Binary(
        "AND",
        new Expression.Literal(null),
        result,
      );
    return result;
  }

  static or(left: Expression, right: Expression): Expression {
    // Flatten same-operator tree into operands
    const operands: Expression[] = [];
    const stack: Expression[] = [right, left];
    while (stack.length) {
      const e = stack.pop()!;
      if (e instanceof Expression.Binary && e.operator === "OR")
        stack.push(e.right, e.left);
      else operands.push(e);
    }

    // Fold literals using three-valued OR logic
    let folded: boolean | null = false;
    let i = 0;
    while (i < operands.length) {
      const e = operands[i];
      if (e instanceof Expression.Literal) {
        operands.splice(i, 1);
        if (e.value == null) folded = folded === true ? true : null;
        else if (e.value) return new Expression.Literal(true);
        // falsy is identity for OR; discard
      } else {
        i++;
      }
    }

    // Rebuild: folded value + remaining non-literal operands
    if (!operands.length) return new Expression.Literal(folded);
    let result = operands.reduce((a, b) => new Expression.Binary("OR", a, b));
    if (folded === null)
      result = new Expression.Binary(
        "OR",
        new Expression.Literal(null),
        result,
      );
    return result;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Expression {
  export class Literal extends Expression {
    constructor(public readonly value: Value) {
      super();
    }

    map(): Literal {
      return this;
    }

    async mapAsync(): Promise<Literal> {
      return this;
    }
  }

  export class Parameter extends Expression {
    constructor(public readonly path: Path) {
      super();
    }

    map(): Parameter {
      return this;
    }

    async mapAsync(): Promise<Parameter> {
      return this;
    }

    toString(): string {
      return this.path.toString();
    }
  }

  export class Unary extends Expression {
    constructor(
      public readonly operator: string,
      public readonly operand: Expression,
    ) {
      super();
    }

    map(fn: (e: Expression, i: number) => Expression): Unary {
      const operand = fn(this.operand, 0);
      if (operand === this.operand) return this;
      return Reflect.construct(this.constructor, [this.operator, operand]);
    }

    async mapAsync(
      fn: (e: Expression, i: number) => Promise<Expression>,
    ): Promise<Unary> {
      const operand = await fn(this.operand, 0);
      if (operand === this.operand) return this;
      return Reflect.construct(this.constructor, [this.operator, operand]);
    }
  }

  export class Binary extends Expression {
    constructor(
      public readonly operator: string,
      public readonly left: Expression,
      public readonly right: Expression,
    ) {
      super();
    }

    map(fn: (e: Expression, i: number) => Expression): Binary {
      const left = fn(this.left, 0);
      const right = fn(this.right, 1);
      if (left === this.left && right === this.right) return this;
      return Reflect.construct(this.constructor, [this.operator, left, right]);
    }

    async mapAsync(
      fn: (e: Expression, i: number) => Promise<Expression>,
    ): Promise<Binary> {
      const left = await fn(this.left, 0);
      const right = await fn(this.right, 1);
      if (left === this.left && right === this.right) return this;
      return Reflect.construct(this.constructor, [this.operator, left, right]);
    }
  }

  export class FunctionCall extends Expression {
    constructor(
      public readonly name: string,
      public readonly args: Expression[],
    ) {
      super();
    }

    map(fn: (e: Expression, i: number) => Expression): FunctionCall {
      const args = this.args.map(fn);
      if (args.every((arg, i) => arg === this.args[i])) return this;
      return new FunctionCall(this.name, args);
    }

    async mapAsync(
      fn: (e: Expression, i: number) => Promise<Expression>,
    ): Promise<FunctionCall> {
      const args = await Promise.all(this.args.map(fn));
      if (args.every((arg, i) => arg === this.args[i])) return this;
      return new FunctionCall(this.name, args);
    }
  }

  export class Conditional extends Expression {
    constructor(
      public readonly condition: Expression,
      public readonly then: Expression,
      public readonly otherwise: Expression,
    ) {
      super();
    }

    map(fn: (e: Expression, i: number) => Expression): Conditional {
      const condition = fn(this.condition, 0);
      const then = fn(this.then, 1);
      const otherwise = fn(this.otherwise, 2);
      if (
        condition === this.condition &&
        then === this.then &&
        otherwise === this.otherwise
      )
        return this;
      return new Conditional(condition, then, otherwise);
    }

    async mapAsync(
      fn: (e: Expression, i: number) => Promise<Expression>,
    ): Promise<Conditional> {
      const condition = await fn(this.condition, 0);
      const then = await fn(this.then, 1);
      const otherwise = await fn(this.otherwise, 2);
      if (
        condition === this.condition &&
        then === this.then &&
        otherwise === this.otherwise
      )
        return this;
      return new Conditional(condition, then, otherwise);
    }
  }
}

export function extractPaths(exp: Expression): Path[] {
  if (exp instanceof Expression.Parameter) return [exp.path];
  const paths: Path[] = [];
  exp.map((e) => {
    if (e instanceof Expression.Parameter) paths.push(e.path);
    else paths.push(...extractPaths(e));
    return e;
  });
  return paths;
}

export function parseList(input: string): Expression[] {
  const CHAR_COMMA = 44;
  const res: Expression[] = [];
  const cursor = new Cursor(input);
  cursor.skipwhitespace();
  if (!cursor.charCode) return res;
  res.push(parseExpression(cursor));
  while (cursor.charCode === CHAR_COMMA) {
    cursor.step();
    res.push(parseExpression(cursor));
  }
  if (cursor.charCode) throw new Error("Unexpected character");
  return res;
}

export default Expression;
