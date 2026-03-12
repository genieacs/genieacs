import Path from "../path.ts";
import Expression from "../expression.ts";

export class Cursor {
  input: string;
  pos: number;
  boundryStack: number[][];
  boundry: number[];
  charCode: number;

  constructor(input: string) {
    this.input = input;
    this.pos = 0;
    this.boundryStack = [];
    this.boundry = [];
    this.charCode = input.charCodeAt(0) || 0;
  }

  fork(): Cursor {
    const cursor = new Cursor(this.input);
    cursor.pos = this.pos;
    cursor.boundryStack = this.boundryStack.slice();
    cursor.boundry = this.boundry;
    cursor.charCode = this.charCode;
    return cursor;
  }

  sync(cursor: Cursor): void {
    this.pos = cursor.pos;
    this.boundryStack = cursor.boundryStack.slice();
    this.boundry = cursor.boundry;
    this.charCode = cursor.charCode;
  }

  read(cur: Cursor): string {
    return this.input.slice(this.pos, cur.pos);
  }

  step(): Cursor {
    if (this.charCode === 0) return this;
    ++this.pos;
    this.charCode = this.input.charCodeAt(this.pos) || 0;
    if (this.boundry.includes(this.charCode)) this.charCode = 0;
    return this;
  }

  walk(callback: (charCode: number) => boolean): Cursor {
    while (this.charCode && callback(this.charCode)) this.step();
    return this;
  }

  descend(chars: number[], override = true): void {
    this.boundryStack.push(this.boundry);
    if (override) this.boundry = chars;
    else this.boundry = [...this.boundry, ...chars];
    this.charCode = this.input.charCodeAt(this.pos) || 0;
    if (this.boundry.includes(this.charCode)) this.charCode = 0;
  }

  ascend(): void {
    if (!this.boundryStack.length) throw new Error("Unmatched boundry");
    this.boundry = this.boundryStack.pop();
    this.charCode = this.input.charCodeAt(this.pos) || 0;
  }

  skipwhitespace(): Cursor {
    return this.walk((c) => c <= 32);
  }
}

const CHAR_SINGLE_QUOTE = 39;
const CHAR_DOUBLE_QUOTE = 34;
const CHAR_OPEN_PAREN = 40;
const CHAR_CLOSE_PAREN = 41;
const CHAR_COMMA = 44;
const CHAR_PERIOD = 46;
const CHAR_COLON = 58;
const CHAR_OPEN_BRACKET = 91;
const CHAR_BACKSLASH = 92;
const CHAR_CLOSE_BRACKET = 93;

const BINARY_OPERATORS = [
  ">=",
  "<=",
  "<>",
  "=",
  ">",
  "<",
  "LIKE",
  "NOT LIKE",
  "AND",
  "OR",
  "*",
  "/",
  "%",
  "||",
  "-",
  "+",
];

const PRECEDENCE = {
  OR: 10,
  AND: 11,
  NOT: 12,
  "=": 20,
  "<>": 20,
  ">": 20,
  ">=": 20,
  "<": 20,
  "<=": 20,
  LIKE: 20,
  "NOT LIKE": 20,
  "IS NULL": 20,
  "IS NOT NULL": 20,
  "||": 30,
  "+": 31,
  "-": 31,
  "*": 32,
  "/": 32,
  "%": 32,
};

function* range(s: number, e: number): Generator<number> {
  for (let i = s; i < e; i++) yield i;
}

const PATH_CHARS = new Set<number>([
  ...range(65, 91),
  ...range(97, 123),
  ...range(48, 58),
  95,
  45,
  42,
  123,
  125,
]);

function findOperator(cursor: Cursor): string {
  cursor.skipwhitespace();
  let found = "";
  let foundCursor = cursor;
  let operators = [...BINARY_OPERATORS, "IS NULL", "IS NOT NULL"];
  for (let i = 0; operators.length && cursor.charCode; ++i) {
    let c = cursor.charCode;
    cursor.step();
    if (c >= 97 && c <= 122) c -= 32;
    if (c <= 32) {
      cursor.skipwhitespace();
      c = 32;
    }
    operators = operators.filter((o) => {
      if (o.charCodeAt(i) !== c) return false;
      if (o.length === i + 1) {
        found = o;
        foundCursor = cursor.fork();
      }
      return true;
    });
  }

  if (found) cursor.sync(foundCursor);
  return found;
}

// Turn escaped characters into real ones (e.g. "\\n" becomes "\n").
function interpretEscapes(str): string {
  const escapes = {
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
  };
  return str.replace(/\\(u[0-9a-fA-F]{4}|[^u])/g, (_, escape) => {
    const type = escape.charAt(0);
    const hex = escape.slice(1);
    if (type === "u") return String.fromCharCode(parseInt(hex, 16));

    if (escapes.hasOwnProperty(type)) return escapes[type];

    return type;
  });
}

export function parseExpression(cursor: Cursor, presedence = 0): Expression {
  cursor.skipwhitespace();
  const char = cursor.charCode;
  let lhs: Expression;
  if (char === CHAR_OPEN_PAREN) {
    cursor.step();
    cursor.descend([CHAR_CLOSE_PAREN]);
    lhs = parseExpression(cursor, 0);
    cursor.ascend();

    cursor.skipwhitespace();
    if (cursor.charCode !== CHAR_CLOSE_PAREN)
      throw new Error("Expected ')'" + cursor.pos + " " + cursor.charCode);
    cursor.step();
  } else if (char === CHAR_DOUBLE_QUOTE) {
    cursor.step();
    const cursor2 = cursor.fork();
    for (
      cursor2.descend([]);
      cursor2.charCode !== CHAR_DOUBLE_QUOTE;
      cursor2.step()
    ) {
      if (!cursor2.charCode) throw new Error("Unterminated string");
      if (cursor2.charCode === CHAR_BACKSLASH) cursor2.step();
    }
    cursor2.ascend();
    const str = cursor.read(cursor2);
    cursor.sync(cursor2);
    cursor.step();
    return new Expression.Literal(interpretEscapes(str));
  } else if (char === CHAR_SINGLE_QUOTE) {
    cursor.step();
    const cursor2 = cursor.fork();
    for (
      cursor2.descend([]);
      cursor2.charCode !== CHAR_SINGLE_QUOTE;
      cursor2.step()
    ) {
      if (!cursor2.charCode) throw new Error("Unterminated string");
      if (cursor2.charCode === CHAR_BACKSLASH) cursor2.step();
    }
    cursor2.ascend();
    const str = cursor.read(cursor2);
    cursor.sync(cursor2);
    cursor.step();
    return new Expression.Literal(str.replaceAll("''", "'"));
  } else {
    const cursor2 = cursor.fork();
    cursor.walk(
      (c) => c > 32 && c !== CHAR_OPEN_PAREN && c !== CHAR_OPEN_BRACKET,
    );
    const token = cursor2.read(cursor);
    if (!token) throw new Error("Invalid expression");
    if (/^true$/i.test(token)) lhs = new Expression.Literal(true);
    else if (/^false$/i.test(token)) lhs = new Expression.Literal(false);
    else if (/^null$/i.test(token)) lhs = new Expression.Literal(null);
    else if (/^-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][+-]?[0-9]+)?$/.test(token))
      lhs = new Expression.Literal(Number(token));
    else if (/^not$/i.test(token)) {
      lhs = new Expression.Unary(
        "NOT",
        parseExpression(cursor, PRECEDENCE["NOT"]),
      );
    } else if (/^case$/i.test(token)) {
      const pairs: [Expression, Expression][] = [];
      for (;;) {
        cursor.skipwhitespace();
        const whenStr = cursor.fork().read(cursor.walk((c) => c > 32));
        if (/^else$/i.test(whenStr)) {
          lhs = parseExpression(cursor);
          continue;
        }
        if (/^end$/i.test(whenStr)) break;
        else if (lhs) throw new Error("Expected END");
        if (!/^when$/i.test(whenStr)) throw new Error("Expected WHEN");
        const condition = parseExpression(cursor);
        cursor.skipwhitespace();
        const thenStr = cursor.fork().read(cursor.walk((c) => c > 32));
        if (!/^then$/i.test(thenStr)) throw new Error("Expected THEN");
        const then = parseExpression(cursor);
        pairs.push([condition, then]);
      }
      if (!lhs) lhs = new Expression.Literal(null);
      while (pairs.length) {
        const [condition, then] = pairs.pop();
        lhs = new Expression.Conditional(condition, then, lhs);
      }
    } else if (cursor.charCode === CHAR_OPEN_PAREN) {
      cursor.step();
      cursor.descend([CHAR_CLOSE_PAREN]);
      cursor.skipwhitespace();
      const args = [] as Expression[];
      while (cursor.charCode) {
        cursor.descend([CHAR_COMMA], false);
        const e = parseExpression(cursor);
        args.push(e);
        cursor.ascend();
        cursor.skipwhitespace();
        if ((cursor.charCode as number) !== CHAR_COMMA) break;
        cursor.step();
      }
      cursor.ascend();
      cursor.step();
      lhs = new Expression.FunctionCall(token, args);
    } else {
      const p = parsePath(cursor2);
      lhs = new Expression.Parameter(p);
      cursor.sync(cursor2);
    }
  }

  for (;;) {
    cursor.skipwhitespace();
    const cursor2 = cursor.fork();
    const op = findOperator(cursor2);
    const p = PRECEDENCE[op];
    if (p <= presedence) return lhs;
    if (op === "IS NULL") {
      lhs = new Expression.Unary("IS NULL", lhs);
    } else if (op === "IS NOT NULL") {
      lhs = new Expression.Unary("IS NOT NULL", lhs);
    } else if (BINARY_OPERATORS.includes(op)) {
      lhs = new Expression.Binary(op, lhs, parseExpression(cursor2, p));
    } else if (op) throw new Error("Unrecognized operator: " + op);
    else break;
    cursor.sync(cursor2);
  }
  return lhs;
}

// Parse old-format alias value: unquoted, double-quoted, or single-quoted.
// Returns the parsed string value. Cursor is advanced past the value.
function parseOldAliasValue(cursor: Cursor): string {
  cursor.walk((c) => c <= 32); // skip leading whitespace
  const c = cursor.charCode;
  if (c === CHAR_DOUBLE_QUOTE) {
    // Double-quoted: use JSON.parse semantics (handles \", \n, \uXXXX etc.)
    // Descend with no boundaries so commas/brackets inside quotes are not
    // treated as terminators.
    const start = cursor.pos;
    cursor.step();
    cursor.descend([]);
    while (cursor.charCode) {
      if (cursor.charCode === CHAR_BACKSLASH) {
        cursor.step();
        if (!cursor.charCode) break;
      } else if (cursor.charCode === CHAR_DOUBLE_QUOTE) {
        cursor.ascend();
        cursor.step();
        return JSON.parse(cursor.input.slice(start, cursor.pos)) as string;
      }
      cursor.step();
    }
    throw new Error("Unterminated string");
  }
  if (c === CHAR_SINGLE_QUOTE) {
    // Single-quoted: strip quotes, no escape processing
    cursor.step();
    cursor.descend([]);
    const start = cursor.pos;
    while (cursor.charCode && cursor.charCode !== CHAR_SINGLE_QUOTE)
      cursor.step();
    if (!cursor.charCode) throw new Error("Unterminated string");
    const value = cursor.input.slice(start, cursor.pos);
    cursor.ascend();
    cursor.step();
    return value;
  }
  // Unquoted: read until , or ] (respecting boundary), trim result
  const start = cursor.pos;
  cursor.walk(() => true);
  return cursor.input.slice(start, cursor.pos).trim();
}

// Parse old-format alias content: key:value,key:value,...
// Cursor should be positioned at the start of bracket content
// (after '[', with ']' set as boundary).
// Returns an Expression: Binary("AND", ...) chain of Binary("=", param, literal).
// Empty content returns Literal(true).
function parseOldAlias(cursor: Cursor): Expression {
  cursor.skipwhitespace();
  if (!cursor.charCode) return new Expression.Literal(true);

  let result: Expression | null = null;
  for (;;) {
    cursor.skipwhitespace();
    // Parse key as a path (supports nested aliases via parsePath).
    // Add colon and comma as boundaries so the path stops there.
    cursor.descend([CHAR_COLON, CHAR_COMMA], false);
    const keyPath = parsePath(cursor);
    cursor.ascend();

    // After ascend, check for the colon separator
    cursor.skipwhitespace();
    if ((cursor.charCode as number) !== CHAR_COLON)
      throw new Error("Expected ':'");
    cursor.step();

    // Parse value (reads until boundary , or ])
    cursor.descend([CHAR_COMMA], false);
    const value = parseOldAliasValue(cursor);
    cursor.ascend();

    const pair = new Expression.Binary(
      "=",
      new Expression.Parameter(keyPath),
      new Expression.Literal(value),
    );
    result = result ? new Expression.Binary("AND", result, pair) : pair;

    cursor.skipwhitespace();
    if ((cursor.charCode as number) !== CHAR_COMMA) break;
    cursor.step();
  }
  return result;
}

export function parsePath(cur: Cursor): Path {
  const segments: (string | Expression)[] = [];
  let colon = 0;
  const cur2 = cur.fork();
  for (;;) {
    let char = cur2.charCode;
    let exp: Expression;

    if (char === CHAR_OPEN_BRACKET) {
      if (cur2.pos !== cur.pos) throw new Error("Invalid path");
      cur2.step();
      cur2.descend([CHAR_CLOSE_BRACKET]);
      // Try parsing as expression first
      const cur3 = cur2.fork();
      let err: unknown;
      try {
        exp = parseExpression(cur3);
      } catch (e) {
        err = e;
      }
      // Fall back to old alias format if not a valid expression or produced
      // a bare Parameter (old format like [a:1] mis-parsed as a path).
      if (err || exp instanceof Expression.Parameter) {
        exp = parseOldAlias(cur2);
      } else {
        cur2.sync(cur3);
      }
      cur2.ascend();
      char = cur2.charCode;
      if (char !== CHAR_CLOSE_BRACKET) throw new Error("Expected ']'");
      char = cur2.step().charCode;
    }

    if (!PATH_CHARS.has(char)) {
      if (cur2.pos <= cur.pos) throw new Error("Invalid path");

      if (char === CHAR_COLON) {
        if (colon) throw new Error("Multiple colons");
        colon = segments.length + 1;
      }

      if (exp) segments.push(exp);
      else segments.push(cur.read(cur2));

      if (char !== CHAR_PERIOD && char !== CHAR_COLON) break;
      cur2.step();
      cur.sync(cur2);
      continue;
    }

    if (exp) throw new Error("Invalid path");
    cur2.step();
  }
  cur.sync(cur2);

  if (colon) colon = segments.length - colon;
  return new Path(segments, colon);
}

export function stringifyExpression(exp: Expression, level = 0): string {
  function wrap(e: string, op: string): string {
    if (PRECEDENCE[op] <= level) return `(${e})`;
    else return e;
  }

  if (exp instanceof Expression.Literal) {
    if (exp.value == null) return "NULL";
    if (exp.value === true) return "TRUE";
    if (exp.value === false) return "FALSE";
    return JSON.stringify(exp.value);
  } else if (exp instanceof Expression.Unary) {
    if (exp.operator === "NOT") {
      return wrap(
        `NOT ${stringifyExpression(exp.operand, PRECEDENCE[exp.operator])}`,
        "NOT",
      );
    } else if (exp.operator === "IS NULL" || exp.operator === "IS NOT NULL") {
      return wrap(
        `${stringifyExpression(exp.operand, PRECEDENCE[exp.operator])} ${exp.operator}`,
        exp.operator,
      );
    }
  } else if (exp instanceof Expression.Binary) {
    const op = exp.operator;
    if (!(op in PRECEDENCE)) throw new Error("Invalid operator");
    return wrap(
      `${stringifyExpression(exp.left, PRECEDENCE[op] - 1)} ${exp.operator} ${stringifyExpression(exp.right, PRECEDENCE[op])}`,
      op,
    );
  } else if (exp instanceof Expression.Parameter) {
    return exp.path.toString();
  } else if (exp instanceof Expression.FunctionCall) {
    return `${exp.name}(${exp.args.map((a) => stringifyExpression(a)).join(", ")})`;
  } else if (exp instanceof Expression.Conditional) {
    let str = `CASE WHEN ${stringifyExpression(exp.condition)} THEN ${stringifyExpression(exp.then)}`;
    if (
      exp.otherwise instanceof Expression.Literal &&
      exp.otherwise.value == null
    )
      str += " END";
    else if (exp.otherwise instanceof Expression.Conditional)
      str += stringifyExpression(exp.otherwise).slice(4);
    else str += ` ELSE ${stringifyExpression(exp.otherwise)} END`;
    return str;
  }

  throw new Error("Invalid expression");
}

export function parseLikePattern(pat: string, esc: string): string[] {
  const chars = pat.split("");

  for (let i = 0; i < chars.length; ++i) {
    const c = chars[i];
    if (c === esc) {
      chars[i] = chars[i + 1] || "";
      chars[i + 1] = "";
    } else if (c === "_") {
      chars[i] = "\\_";
    } else if (c === "%") {
      chars[i] = "\\%";
      while (chars[i + 1] === "%") chars[++i] = "";
    }
  }
  return chars.filter((c) => c);
}

export function likePatternToRegExp(pat: string, esc = "", flags = ""): RegExp {
  const convChars = {
    "-": "\\-",
    "/": "\\/",
    "\\": "\\/",
    "^": "\\^",
    $: "\\$",
    "*": "\\*",
    "+": "\\+",
    "?": "\\?",
    ".": "\\.",
    "(": "\\(",
    ")": "\\)",
    "|": "\\|",
    "[": "\\[",
    "]": "\\]",
    "{": "\\{",
    "}": "\\}",
    "\\%": ".*",
    "\\_": ".",
  };
  let chars = parseLikePattern(pat, esc);
  if (!chars.length) return new RegExp("^$", flags);
  chars = chars.map((c) => convChars[c] || c);
  chars[0] = chars[0] === ".*" ? "" : "^" + chars[0];
  const l = chars.length - 1;
  chars[l] = [".*", ""].includes(chars[l]) ? "" : chars[l] + "$";
  return new RegExp(chars.join(""), flags);
}
