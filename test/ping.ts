import test, { TestContext } from "node:test";
import assert from "node:assert";
import childProcess from "node:child_process";
import os from "node:os";
import { parsePing, ping } from "../lib/ping.ts";

function mockExecFile(t: TestContext): () => string[] | undefined {
  let args: string[] | undefined;
  t.mock.method(
    childProcess,
    "execFile",
    (
      _file: string,
      a: string[],
      callback: (err: Error | null, stdout: string) => void,
    ) => {
      args = a;
      callback(null, "");
    },
  );
  return () => args;
}

void test("passes host to ping as a single argument after --", (t) => {
  const getArgs = mockExecFile(t);
  const platform = t.mock.method(os, "platform");
  const hosts = {
    "example.com": "example.com",
    "192.0.2.1": "192.0.2.1",
    "[2001:db8::1]": "2001:db8::1",
    "bücher.example": "bücher.example",
    "-n": "-n",
  };
  for (const osPlatform of ["linux", "freebsd"] as const) {
    platform.mock.mockImplementation(() => osPlatform);
    for (const [host, expected] of Object.entries(hosts)) {
      ping(host, () => {});
      assert.deepStrictEqual(getArgs()?.slice(-2), ["--", expected], host);
    }
  }
});

void test("rejects invalid hosts without running ping", (t) => {
  const getArgs = mockExecFile(t);
  // The first is stripped to "example.com" by domainToASCII
  const hosts = ["example.com/;id", "a;id", "$(id)", "`id`", "a b", "a\nb"];
  for (const host of hosts) {
    let message: string | undefined;
    ping(host, (err) => (message = err?.message));
    assert.strictEqual(message, "Invalid host", host);
  }
  assert.strictEqual(getArgs(), undefined);
});

void test("linux Case-1", () => {
  const platform = "linux";
  const stdout =
    "PING 8.8.8.8 (8.8.8.8) 56(84) bytes of data\n64 bytes from 8.8.8.8: icmp_seq=1 ttl=118 time=6.66 ms\n64 bytes from 8.8.8.8: icmp_seq=2 ttl=118 time=6.50 ms\n64 bytes from 8.8.8.8: icmp_seq=3 ttl=118 time=6.38 ms\n\n--- 8.8.8.8 ping statistics ---\n3 packets transmitted, 3 received, 0% packet loss, time 402ms\nrtt min/avg/max/mdev = 6.381/6.511/6.656/0.112 ms";
  const parsedResult = {
    packetsTransmitted: 3,
    packetsReceived: 3,
    packetLoss: 0,
    min: 6.381,
    avg: 6.511,
    max: 6.656,
    mdev: 0.112,
  };
  const parsed = parsePing(platform, stdout);
  assert.deepStrictEqual(parsedResult, parsed);
});

void test("linux Case-2", () => {
  const platform = "linux";
  const stdout =
    "PING 10.251.9.108 (10.251.9.108): 56 data bytes\n64 bytes from 10.251.9.108: icmp_seq=0 ttl=57 time=36.758 ms\n64 bytes from 10.251.9.108: icmp_seq=1 ttl=57 time=69.094 ms\n64 bytes from 10.251.9.108: icmp_seq=2 ttl=57 time=28.868 ms\n--- 10.251.9.108 ping statistics ---3 packets transmitted, 3 packets received, 0% packet loss\nround-trip min/avg/max/stddev = 28.868/44.907/69.094/17.404 ms";
  const parsedResult = {
    packetsTransmitted: 3,
    packetsReceived: 3,
    packetLoss: 0,
    min: 28.868,
    avg: 44.907,
    max: 69.094,
    mdev: 17.404,
  };
  const parsed = parsePing(platform, stdout);
  assert.deepStrictEqual(parsedResult, parsed);
});
