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

const CHAR_SINGLE_QUOTE = 39;
const CHAR_DOUBLE_QUOTE = 34;
const CHAR_LESS_THAN = 60;
const CHAR_GREATER_THAN = 62;
const CHAR_COLON = 58;
const CHAR_SPACE = 32;
const CHAR_TAB = 9;
const CHAR_CR = 13;
const CHAR_LF = 10;
const CHAR_SLASH = 47;
const CHAR_EXMARK = 33;
const CHAR_QMARK = 63;
const CHAR_EQUAL = 61;

const STATE_LESS_THAN = 1;
const STATE_SINGLE_QUOTE = 2;
const STATE_DOUBLE_QUOTE = 3;

export interface Attribute {
  name: string;
  namespace: string;
  localName: string;
  value: string;
}

export interface Element {
  name: string;
  namespace: string;
  localName: string;
  attrs: string;
  text: string;
  bodyIndex: number;
  children: Element[];
}

export function parseXmlDeclaration(buffer: Buffer): Attribute[] {
  for (const enc of ["utf16le", "utf8", "latin1", "ascii"]) {
    let str = buffer.toString(enc, 0, 150);
    if (str.startsWith("<?xml")) {
      str = str.split("\n")[0].trim();
      try {
        return parseAttrs(str.slice(5, -2));
      } catch (err) {
        // Ignore
      }
    }
  }
  return null;
}

export function parseAttrs(string: string): Attribute[] {
  const attrs: Attribute[] = [];
  const len = string.length;

  let state = 0;
  let name = "";
  let namespace = "";
  let localName = "";
  let idx = 0;
  let colonIdx = 0;
  for (let i = 0; i < len; ++i) {
    const c = string.charCodeAt(i);
    switch (c) {
      case CHAR_SINGLE_QUOTE:
      case CHAR_DOUBLE_QUOTE:
        if (state === c) {
          state = 0;
          if (name) {
            const value = string.slice(idx + 1, i);
            const e = {
              name: name,
              namespace: namespace,
              localName: localName,
              value: value
            };
            attrs.push(e);
            name = "";
            idx = i + 1;
          }
        } else {
          state = c;
          idx = i;
        }
        continue;

      case CHAR_COLON:
        if (idx >= colonIdx) colonIdx = i;
        continue;

      case CHAR_EQUAL:
        if (name) throw new Error(`Unexpected character at ${i}`);
        name = string.slice(idx, i).trim();
        // TODO validate name
        if (colonIdx > idx) {
          namespace = string.slice(idx, colonIdx).trim();
          localName = string.slice(colonIdx + 1, i).trim();
        } else {
          namespace = "";
          localName = name;
        }
    }
  }

  if (name) throw new Error(`Attribute must have value at ${idx}`);

  const tail = string.slice(idx);
  if (tail.trim()) throw new Error(`Unexpected string at ${len - tail.length}`);

  return attrs;
}

export function decodeEntities(string): string {
  return string.replace(/&[0-9a-z#]+;/gi, match => {
    switch (match) {
      case "&quot;":
        return '"';

      case "&amp;":
        return "&";

      case "&apos;":
        return "'";

      case "&lt;":
        return "<";

      case "&gt;":
        return ">";

      default:
        if (match.startsWith("&#x")) {
          const str = match.slice(3, -1).toLowerCase();
          const n = parseInt(str, 16);
          if (str.endsWith(n.toString(16))) return String.fromCharCode(n);
        } else if (match.startsWith("&#")) {
          const str = match.slice(2, -1);
          const n = parseInt(str);
          if (str.endsWith(n.toString())) return String.fromCharCode(n);
        }
    }
    return match;
  });
}

export function encodeEntities(string): string {
  const entities = {
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
    "<": "&lt;",
    ">": "&gt;"
  };
  return string.replace(/[&"'<>]/g, m => entities[m]);
}

export function parseXml(string: string): Element {
  const len = string.length;
  let state1 = 0;
  let state1Index = 0;
  let state2 = 0;
  let state2Index = 0;

  const root: Element = {
    name: "root",
    namespace: "",
    localName: "root",
    attrs: "",
    text: "",
    bodyIndex: 0,
    children: []
  };

  const stack: Element[] = [root];

  for (let i = 0; i < len; ++i) {
    switch (string.charCodeAt(i)) {
      case CHAR_SINGLE_QUOTE:
        switch (state1 & 0xff) {
          case STATE_SINGLE_QUOTE:
            state1 = state2;
            state1Index = state2Index;
            state2 = 0;
            continue;

          case STATE_LESS_THAN:
            state2 = state1;
            state2Index = state1Index;
            state1 = STATE_SINGLE_QUOTE;
            state1Index = i;
            continue;
        }
        continue;

      case CHAR_DOUBLE_QUOTE:
        switch (state1 & 0xff) {
          case STATE_DOUBLE_QUOTE:
            state1 = state2;
            state1Index = state2Index;
            state2 = 0;
            continue;

          case STATE_LESS_THAN:
            state2 = state1;
            state2Index = state1Index;
            state1 = STATE_DOUBLE_QUOTE;
            state1Index = i;
            continue;
        }
        continue;

      case CHAR_LESS_THAN:
        if ((state1 & 0xff) === 0) {
          state2 = state1;
          state2Index = state1Index;
          state1 = STATE_LESS_THAN;
          state1Index = i;
        }
        continue;

      case CHAR_COLON:
        if ((state1 & 0xff) === STATE_LESS_THAN) {
          const colonIndex = (state1 >> 8) & 0xff;
          if (colonIndex === 0) state1 ^= ((i - state1Index) & 0xff) << 8;
        }
        continue;

      case CHAR_SPACE:
      case CHAR_TAB:
      case CHAR_CR:
      case CHAR_LF:
        if ((state1 & 0xff) === STATE_LESS_THAN) {
          const wsIndex = (state1 >> 16) & 0xff;
          if (wsIndex === 0) state1 ^= ((i - state1Index) & 0xff) << 16;
        }
        continue;

      case CHAR_GREATER_THAN:
        if ((state1 & 0xff) === STATE_LESS_THAN) {
          const secondChar = string.charCodeAt(state1Index + 1);
          const wsIndex: number = (state1 >> 16) & 0xff;
          let name: string,
            colonIndex: number,
            e: Element,
            parent: Element,
            selfClosing: number,
            localName: string,
            namespace: string;

          switch (secondChar) {
            case CHAR_SLASH:
              e = stack.pop();
              name =
                wsIndex === 0
                  ? string.slice(state1Index + 2, i)
                  : string.slice(state1Index + 2, state1Index + wsIndex);
              if (e.name !== name)
                throw new Error(`Unmatched closing tag at ${i}`);
              if (!e.children.length)
                e.text = string.slice(e.bodyIndex, state1Index);
              state1 = state2;
              state1Index = state2Index;
              state2 = 0;
              continue;

            case CHAR_EXMARK:
              if (string.startsWith("![CDATA[", state1Index + 1)) {
                if (string.endsWith("]]", i))
                  throw new Error(`CDATA nodes are not supported at ${i}`);
              } else if (string.startsWith("!--", state1Index + 1)) {
                // Comment node, ignore
                if (string.endsWith("--", i)) {
                  state1 = state2;
                  state1Index = state2Index;
                  state2 = 0;
                }
              }
              continue;

            case CHAR_QMARK:
              if (string.charCodeAt(i - 1) === CHAR_QMARK) {
                // XML declaration node, ignore
                state1 = state2;
                state1Index = state2Index;
                state2 = 0;
              }
              continue;

            default:
              selfClosing = +(string.charCodeAt(i - 1) === CHAR_SLASH);
              parent = stack[stack.length - 1];
              colonIndex = (state1 >> 8) & 0xff;

              name =
                wsIndex === 0
                  ? string.slice(state1Index + 1, i - selfClosing)
                  : string.slice(state1Index + 1, state1Index + wsIndex);
              if (colonIndex && (!wsIndex || colonIndex < wsIndex)) {
                localName = name.slice(colonIndex);
                namespace = name.slice(0, colonIndex - 1);
              } else {
                localName = name;
                namespace = "";
              }

              e = {
                name: name,
                namespace: namespace,
                localName: localName,
                attrs: wsIndex
                  ? string.slice(state1Index + wsIndex + 1, i - selfClosing)
                  : "",
                text: "",
                bodyIndex: i + 1,
                children: []
              };
              parent.children.push(e);
              if (!selfClosing) stack.push(e);

              state1 = state2;
              state1Index = state2Index;
              state2 = 0;
              continue;
          }
        }
        continue;
    }
  }

  if (state1) throw new Error(`Unclosed token at ${state1Index}`);

  if (stack.length > 1) {
    const e = stack[stack.length - 1];
    throw new Error(`Unclosed XML element at ${e.bodyIndex}`);
  }

  if (!root.children.length) root.text = string;
  return root;
}
