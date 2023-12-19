import test from "node:test";
import assert from "node:assert";
import { parsePing } from "../lib/ping.ts";

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
