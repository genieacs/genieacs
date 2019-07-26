import ava from "ava";
import Path from "../lib/common/path";
import * as device from "../lib/device";
import PathSet from "../lib/common/path-set";
import VersionedMap from "../lib/versioned-map";
import { Attributes } from "../lib/types";

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

ava("unpack", t => {
  const now = Date.now();
  const deviceData = {
    paths: new PathSet(),
    timestamps: new VersionedMap<Path, number>(),
    attributes: new VersionedMap<Path, Attributes>(),
    trackers: new Map<Path, { [name: string]: number }>(),
    changes: new Set<string>()
  };

  device.set(deviceData, Path.parse("a.1.b"), now, {
    value: [now, ["b", "xsd:string"]]
  });
  device.set(deviceData, Path.parse("a.1.c"), now, {
    value: [now, ["c", "xsd:string"]]
  });
  device.set(deviceData, Path.parse("a.1.a.1.a"), now, {
    value: [now, ["", "xsd:string"]]
  });
  device.set(deviceData, Path.parse("a.1.a.1.b"), now, {
    value: [now, ["b1", "xsd:string"]]
  });
  device.set(deviceData, Path.parse("a.1.a.1.c"), now, {
    value: [now, ["c1", "xsd:string"]]
  });
  device.set(deviceData, Path.parse("a.1.a.2.a"), now, {
    value: [now, ["", "xsd:string"]]
  });
  device.set(deviceData, Path.parse("a.1.a.2.b"), now, {
    value: [now, ["b2", "xsd:string"]]
  });
  device.set(deviceData, Path.parse("a.1.a.2.c"), now, {
    value: [now, ["c2", "xsd:string"]]
  });

  device.set(deviceData, Path.parse("a.2.b"), now, {
    value: [now, ["b", "xsd:string"]]
  });
  device.set(deviceData, Path.parse("a.2.c"), now, {
    value: [now, ["c", "xsd:string"]]
  });
  device.set(deviceData, Path.parse("a.2.a.1.a"), now, {
    value: [now, ["", "xsd:string"]]
  });
  device.set(deviceData, Path.parse("a.2.a.1.b"), now, {
    value: [now, ["b1", "xsd:string"]]
  });
  device.set(deviceData, Path.parse("a.2.a.1.c"), now, {
    value: [now, ["c1", "xsd:string"]]
  });
  device.set(deviceData, Path.parse("a.2.a.2.a"), now, {
    value: [now, ["", "xsd:string"]]
  });
  device.set(deviceData, Path.parse("a.2.a.2.b"), now, {
    value: [now, ["c1", "xsd:string"]]
  });
  device.set(deviceData, Path.parse("a.2.a.2.c"), now, {
    value: [now, ["b1", "xsd:string"]]
  });

  let unpacked: Path[];
  unpacked = device.unpack(
    deviceData,
    Path.parse("a.[b:b,c:c].a.[b:b1,c:c1].a")
  );
  t.is(unpacked.length, 2);
  t.is(unpacked[0].toString(), "a.1.a.1.a");
  t.is(unpacked[1].toString(), "a.2.a.1.a");

  unpacked = device.unpack(deviceData, Path.parse("a.*.a.[b:c1,c:b1].a"));
  t.is(unpacked.length, 1);
  t.is(unpacked[0].toString(), "a.2.a.2.a");
});
