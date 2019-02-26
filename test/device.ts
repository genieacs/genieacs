import ava from "ava";
import Path from "../lib/common/path";
import * as device from "../lib/device";

ava("getAliasDeclarations", t => {
  const path = Path.parse("a.[aa:10,bb.[aaa:100].cc:1].b");
  const decs = device.getAliasDeclarations(path, 99);

  const expected = ["a.*.b", "a.*.aa", "a.*.bb.*.cc", "a.*.bb.*.aaa"];

  t.plan(24);
  for (const [i, d] of decs.entries()) {
    t.is(d.path.toString(), expected[i]);
    t.is(d.pathGet, 99);
    t.is(d.pathSet, null);
    t.deepEqual(d.attrGet, i ? { value: 99 } : null);
    t.is(d.attrSet, null);
    t.is(d.defer, true);
  }
});
