import ava from "ava";
import Path from "../lib/common/path";

ava("toString", t => {
  const path1 = Path.parse('abc.[ abc : 123 , 123 : abc , 123: " abc "].123');
  const path2 = Path.parse('abc.[123:  " abc ",abc:123,123:abc].123');
  t.is(path1.toString(), path2.toString());
});

ava("slice", t => {
  const path = Path.parse("a.*.b.[x:y].c");
  const sliced = path.slice(1, -1);
  t.is(sliced.toString(), '*.b.[x:"y"]');
  t.is(sliced.alias, 0b100);
  t.is(sliced.wildcard, 0b1);
});

ava("concat", t => {
  const path1 = Path.parse("a");
  const path2 = Path.parse("*.[a:b]");
  const concat = path1.concat(path2);
  t.is(concat.toString(), 'a.*.[a:"b"]');
  t.is(concat.alias, 0b100);
  t.is(concat.wildcard, 0b10);
});
