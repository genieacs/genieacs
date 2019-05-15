import ava from "ava";
import Path from "../lib/common/path";
import PathSet from "../lib/common/path-set";

ava("depth", t => {
  const pathSet = new PathSet();
  t.is(pathSet.depth, 0);
  pathSet.add(Path.parse(""));
  t.is(pathSet.depth, 1);
  pathSet.add(Path.parse("a"));
  t.is(pathSet.depth, 2);
});

ava("add", t => {
  const pathSet = new PathSet();
  pathSet.add(Path.parse("a"));
  pathSet.add(Path.parse("a"));
  t.is(pathSet.find(Path.parse("a"), true, true, 99).length, 1);
});

ava("get", t => {
  const pathSet = new PathSet();
  pathSet.add(Path.parse("a.*"));
  pathSet.add(Path.parse("a.a"));
  pathSet.add(Path.parse("*.*"));

  t.is(pathSet.get(Path.parse("a.*")).toString(), "a.*");
  t.is(pathSet.get(Path.parse("*.a")), null);
});

ava("find", t => {
  const pathSet = new PathSet();
  pathSet.add(Path.parse("a"));
  pathSet.add(Path.parse("a.*"));
  pathSet.add(Path.parse("a.a"));
  pathSet.add(Path.parse("*.a"));
  pathSet.add(Path.parse("*.*"));

  t.deepEqual(
    pathSet.find(Path.parse(""), true, true, 1).map(p => p.toString()),
    ["a"]
  );

  t.deepEqual(
    pathSet.find(Path.parse(""), false, false, 2).map(p => p.toString()),
    ["a", "a.*", "a.a", "*.a", "*.*"]
  );

  t.deepEqual(
    pathSet.find(Path.parse("a.*"), false, false).map(p => p.toString()),
    ["a.*"]
  );

  t.deepEqual(
    pathSet.find(Path.parse("a.*"), false, true).map(p => p.toString()),
    ["a.*", "a.a"]
  );

  t.deepEqual(
    pathSet.find(Path.parse("a.*"), true, false).map(p => p.toString()),
    ["a.*", "*.*"]
  );

  t.deepEqual(
    pathSet.find(Path.parse("a.*"), true, true).map(p => p.toString()),
    ["a.*", "a.a", "*.a", "*.*"]
  );
});
