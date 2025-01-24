import test from "node:test";
import assert from "node:assert";
import {
  parseXmlDeclaration,
  decodeEntities,
  parseXml,
} from "../lib/xml-parser.ts";

void test("parseXmlDeclaration", () => {
  const buf = Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>\n<soap-env:Envelope />',
  );
  const attrs = parseXmlDeclaration(buf);
  assert.deepStrictEqual(attrs, [
    {
      name: "version",
      namespace: "",
      localName: "version",
      value: "1.0",
    },
    {
      name: "encoding",
      namespace: "",
      localName: "encoding",
      value: "UTF-8",
    },
  ]);
});

void test("decodeEntities", () => {
  assert.strictEqual(
    decodeEntities("&&amp;&lt;&gt;&quot;&apos;&gt;&#167;&#xd842;&#xDFB7;;"),
    "&&<>\"'>§𠮷;",
  );
});

void test("parse", () => {
  const xml =
    '<?xml version="1.0"?>\n<a-b:c><d f="1<g>"/><!-- comment --><h >i</h></a-b:c>';
  const parsed = parseXml(xml);
  assert.deepStrictEqual(parsed, {
    name: "root",
    namespace: "",
    localName: "root",
    attrs: "",
    text: "",
    bodyIndex: 0,
    children: [
      {
        name: "a-b:c",
        namespace: "a-b",
        localName: "c",
        attrs: "",
        text: "",
        bodyIndex: 29,
        children: [
          {
            name: "d",
            namespace: "",
            localName: "d",
            attrs: 'f="1<g>"',
            text: "",
            bodyIndex: 42,
            children: [],
          },
          {
            name: "h",
            namespace: "",
            localName: "h",
            attrs: "",
            text: "i",
            bodyIndex: 62,
            children: [],
          },
        ],
      },
    ],
  });
});
