import ava from "ava";
import * as common from "../lib/common";

ava("typeOf", t => {
  const cases = [
    [undefined, common.UNDEFINED_TYPE],
    [null, common.NULL_TYPE],
    [true, common.BOOLEAN_TYPE],
    [false, common.BOOLEAN_TYPE],
    [0, common.NUMBER_TYPE],
    [1, common.NUMBER_TYPE],
    [-1, common.NUMBER_TYPE],
    [0.0, common.NUMBER_TYPE],
    [1.0, common.NUMBER_TYPE],
    [1.1, common.NUMBER_TYPE],
    [-1.0, common.NUMBER_TYPE],
    [-1.1, common.NUMBER_TYPE],
    ["", common.STRING_TYPE],
    ["TEST", common.STRING_TYPE],
    [[], common.ARRAY_TYPE],
    [[1, 2, 3], common.ARRAY_TYPE],
    [{}, common.OBJECT_TYPE],
    [{ test: 1 }, common.OBJECT_TYPE],
    [/[^A-Za-z0-9_]/g, common.REGEXP_TYPE],
    [new RegExp("//"), common.REGEXP_TYPE],
    [new Date(), common.DATE_TYPE]
  ];
  t.plan(cases.length);
  for (const c of cases) t.is(common.typeOf(c[0]), c[1]);
});

ava("generateDeviceId", t => {
  const space = [" ", "%20"];
  const special = [";", "%3B"];
  const cases = [
    [
      {
        ProductClass: "TestProductClass",
        OUI: "TestOUI",
        SerialNumber: "TestSerialNumber"
      },
      "TestOUI-TestProductClass-TestSerialNumber"
    ],
    [
      {
        OUI: "TestOUI",
        SerialNumber: "TestSerialNumber"
      },
      "TestOUI-TestSerialNumber"
    ],
    [
      {
        OUI: `TestOUIWith${space[0]}_${special[0]}2912`,
        SerialNumber: `TestSerialNumberWith${space[0]}_${special[0]}2912`
      },
      `TestOUIWith${space[1]}_${special[1]}2912-TestSerialNumberWith${space[1]}_${special[1]}2912`
    ]
  ];
  t.plan(cases.length);
  for (const c of cases) t.is(common.generateDeviceId(c[0]), c[1]);
});

ava("escapeRegExp", t => {
  t.is(
    common.escapeRegExp("\\ ^ $ * + ? . ( ) | { } [ ]"),
    "\\\\ \\^ \\$ \\* \\+ \\? \\. \\( \\) \\| \\{ \\} \\[ \\]"
  );
});
