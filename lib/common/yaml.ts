const LINE_WIDTH = 80;
const INDENTATION = "  ";

const STRING_RESERVED = new Set([
  "true",
  "True",
  "TRUE",
  "false",
  "False",
  "FALSE",
  "null",
  "Null",
  "NULL",
]);

function isPrintable(str: string): boolean {
  return !/[^\t\n\x20-\x7e\x85\u{a0}-\u{d7ff}\u{e000}-\u{fffd}\u{10000}-\u{10ffff}]/u.test(
    str
  );
}

function stringifyKey(str: string): string {
  if (!str || !isPrintable(str)) return JSON.stringify(str);
  if (/^[\s-?:,[\]{}#&$!|>'"%@`]|: | #|[\n,[\]{}]|\s$/.test(str))
    return JSON.stringify(str);
  return str;
}

function foldString(str: string): string[] {
  if (str.length <= LINE_WIDTH) return [str];
  if (str.startsWith(" ")) return [str];
  const words = str.split(/(?<=[^ ]) (?=[^ ])/);
  const lines: string[] = [];

  let idx = 0;
  let len = 0;
  for (const [i, word] of words.entries()) {
    len += word.length + 1;
    if (len >= LINE_WIDTH && len !== word.length) {
      lines.push(words.slice(idx, i).join(" "));
      idx = i;
      len = 0;
    }
  }

  if (idx < words.length) lines.push(words.slice(idx).join(" "));

  return lines;
}

function stringifyString(str: string, res: string[], prefix1, prefix2): void {
  if (/^\s*$/.test(str) || STRING_RESERVED.has(str) || !isPrintable(str)) {
    res.push(prefix1 + JSON.stringify(str));
    return;
  }

  if (!prefix2) prefix2 = INDENTATION;

  const lines = str.split("\n");
  if (lines.length > 1) {
    let idt = "";
    let chmp = "-";
    if ((lines.find((l) => l) || "").startsWith(" "))
      idt = `${INDENTATION.length}`;

    if (!lines[lines.length - 1]) {
      lines.pop();
      if (lines[lines.length - 1]) chmp = "";
      else chmp = "+";
    }

    if (/^\s+$/.test(lines[lines.length - 1])) {
      res.push(prefix1 + JSON.stringify(str));
      return;
    }

    let isFolded = false;
    const folded = lines.map((l) => {
      const ls = foldString(l);
      if (ls.length > 1) isFolded = true;
      return ls;
    });

    if (!isFolded) {
      res.push(
        `${prefix1}|${idt}${chmp}`,
        ...lines.map((l) => (l ? prefix2 + l : l))
      );
      return;
    }

    res.push(`${prefix1}>${idt}${chmp}`);
    res.push(...folded[0].map((f) => prefix2 + f));
    for (let i = 1; i < folded.length; ++i) {
      const prevLine = folded[i - 1][0];
      if (prevLine && !folded[i - 1][0].startsWith(" ")) res.push("");
      res.push(...folded[i].map((f) => prefix2 + f));
    }
    return;
  }

  if (
    /^[\s-?:,[\]{}#&$!|>'"%@`]|: | #|\s$/.test(str) ||
    parseFloat(str) === +str
  ) {
    res.push(prefix1 + JSON.stringify(str));
    return;
  }

  res.push(prefix1 + str);
}

function stringifyAny(
  obj: unknown,
  res: string[],
  prefix1 = "",
  prefix2 = ""
): void {
  if (obj == null) {
    res.push(`${prefix1}null`);
    return;
  }
  if (typeof obj === "number" || typeof obj === "boolean") {
    res.push(`${prefix1}${JSON.stringify(obj)}`);
    return;
  }
  if (obj instanceof Date) {
    res.push(`${prefix1}${obj.toJSON()}`);
    return;
  }

  if (typeof obj === "string") {
    stringifyString(obj, res, prefix1, prefix2);
    return;
  }

  if (Array.isArray(obj)) {
    if (!obj.length) {
      res.push(prefix1 + "[]");
      return;
    }

    if (!prefix1 || prefix1.endsWith("- ")) {
      stringifyAny(obj[0], res, prefix1 + "- ", prefix2 + INDENTATION);
      prefix1 = prefix2 + "- ";
      prefix2 = prefix2 + INDENTATION;
      for (let i = 1; i < obj.length; ++i)
        stringifyAny(obj[i], res, prefix1, prefix2);
    } else {
      res.push(prefix1);
      prefix1 = prefix2 + "- ";
      prefix2 = prefix2 + INDENTATION;
      for (let i = 0; i < obj.length; ++i)
        stringifyAny(obj[i], res, prefix1, prefix2);
    }
    return;
  }

  const entries = Object.entries(obj).filter((e) => e[1] !== undefined);

  if (!entries.length) {
    res.push(prefix1 + "{}");
    return;
  }

  if (!prefix1 || prefix1.endsWith("- ")) {
    stringifyAny(
      entries[0][1],
      res,
      prefix1 + `${stringifyKey(entries[0][0])}: `,
      prefix2 + INDENTATION
    );
    prefix1 = prefix2;
    prefix2 = prefix2 + INDENTATION;
    for (let i = 1; i < entries.length; ++i) {
      stringifyAny(
        entries[i][1],
        res,
        prefix1 + `${stringifyKey(entries[i][0])}: `,
        prefix2
      );
    }
  } else {
    res.push(prefix1);
    prefix1 = prefix2;
    prefix2 = prefix2 + INDENTATION;
    for (let i = 0; i < entries.length; ++i) {
      stringifyAny(
        entries[i][1],
        res,
        prefix1 + `${stringifyKey(entries[i][0])}: `,
        prefix2
      );
    }
  }
}

export function stringify(obj: unknown): string {
  if (obj === undefined) return undefined;
  const lines: string[] = [];
  stringifyAny(obj, lines);
  return lines.join("\n") + "\n";
}
