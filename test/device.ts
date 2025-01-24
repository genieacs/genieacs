import test from "node:test";
import assert from "node:assert";
import Path from "../lib/common/path.ts";
import * as device from "../lib/device.ts";
import PathSet from "../lib/common/path-set.ts";
import VersionedMap from "../lib/versioned-map.ts";
import { Attributes } from "../lib/types.ts";

void test("getAliasDeclarations", () => {
  const path = Path.parse("a.[aa:10,bb.[aaa:100].cc:1].b");
  const decs = device.getAliasDeclarations(path, 99);

  const expected = ["a.*.b", "a.*.aa", "a.*.bb.*.cc", "a.*.bb.*.aaa"];

  for (const [i, d] of decs.entries()) {
    assert.strictEqual(d.path.toString(), expected[i]);
    assert.strictEqual(d.pathGet, 99);
    assert.strictEqual(d.pathSet, null);
    assert.deepStrictEqual(d.attrGet, i ? { value: 99 } : null);
    assert.strictEqual(d.attrSet, null);
    assert.strictEqual(d.defer, true);
  }
});

void test("unpack", () => {
  const now = Date.now();
  const deviceData = {
    paths: new PathSet(),
    timestamps: new VersionedMap<Path, number>(),
    attributes: new VersionedMap<Path, Attributes>(),
    trackers: new Map<Path, { [name: string]: number }>(),
    changes: new Set<string>(),
  };

  device.set(deviceData, Path.parse("a.1.b"), now, {
    value: [now, ["b", "xsd:string"]],
  });
  device.set(deviceData, Path.parse("a.1.c"), now, {
    value: [now, ["c", "xsd:string"]],
  });
  device.set(deviceData, Path.parse("a.1.a.1.a"), now, {
    value: [now, ["", "xsd:string"]],
  });
  device.set(deviceData, Path.parse("a.1.a.1.b"), now, {
    value: [now, ["b1", "xsd:string"]],
  });
  device.set(deviceData, Path.parse("a.1.a.1.c"), now, {
    value: [now, ["c1", "xsd:string"]],
  });
  device.set(deviceData, Path.parse("a.1.a.2.a"), now, {
    value: [now, ["", "xsd:string"]],
  });
  device.set(deviceData, Path.parse("a.1.a.2.b"), now, {
    value: [now, ["b2", "xsd:string"]],
  });
  device.set(deviceData, Path.parse("a.1.a.2.c"), now, {
    value: [now, ["c2", "xsd:string"]],
  });

  device.set(deviceData, Path.parse("a.2.b"), now, {
    value: [now, ["b", "xsd:string"]],
  });
  device.set(deviceData, Path.parse("a.2.c"), now, {
    value: [now, ["c", "xsd:string"]],
  });
  device.set(deviceData, Path.parse("a.2.a.1.a"), now, {
    value: [now, ["", "xsd:string"]],
  });
  device.set(deviceData, Path.parse("a.2.a.1.b"), now, {
    value: [now, ["b1", "xsd:string"]],
  });
  device.set(deviceData, Path.parse("a.2.a.1.c"), now, {
    value: [now, ["c1", "xsd:string"]],
  });
  device.set(deviceData, Path.parse("a.2.a.2.a"), now, {
    value: [now, ["", "xsd:string"]],
  });
  device.set(deviceData, Path.parse("a.2.a.2.b"), now, {
    value: [now, ["c1", "xsd:string"]],
  });
  device.set(deviceData, Path.parse("a.2.a.2.c"), now, {
    value: [now, ["b1", "xsd:string"]],
  });

  let unpacked: Path[];
  unpacked = device.unpack(
    deviceData,
    Path.parse("a.[b:b,c:c].a.[b:b1,c:c1].a"),
  );
  assert.strictEqual(unpacked.length, 2);
  assert.strictEqual(unpacked[0].toString(), "a.1.a.1.a");
  assert.strictEqual(unpacked[1].toString(), "a.2.a.1.a");

  unpacked = device.unpack(deviceData, Path.parse("a.*.a.[b:c1,c:b1].a"));
  assert.strictEqual(unpacked.length, 1);
  assert.strictEqual(unpacked[0].toString(), "a.2.a.2.a");
});
