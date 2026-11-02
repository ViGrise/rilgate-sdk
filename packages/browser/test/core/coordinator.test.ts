import assert from "node:assert/strict";
import test from "node:test";
import { ChallengeCoordinator } from "../../src/core/coordinator.ts";
import { brandNames } from "../../src/protocol/index.ts";

const url = new URL("https://example.test/challenge");

test("verification in another tab settles the open challenge and aborts the local solver", async () => {
  const channel = new BroadcastChannel(brandNames().channelName);
  const other = new BroadcastChannel(brandNames().channelName);
  let solverSignal: AbortSignal | undefined;
  let aborted = false;
  const coordinator = new ChallengeCoordinator({
    names: brandNames(),
    channel,
    timeoutMs: 1_000,
    solver: {
      solve(_url, signal) {
        solverSignal = signal;
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise<void>(() => {});
      },
    },
  });
  try {
    const pending = coordinator.solve(url);
    other.postMessage({ type: "rilgate-client:verified" });
    await pending;
    assert.equal(solverSignal?.aborted, true);
    assert.equal(aborted, true);
  } finally {
    coordinator.dispose();
    channel.close();
    other.close();
  }
});

test("a timeout rejects the open challenge and a later challenge can start", async () => {
  let calls = 0;
  const coordinator = new ChallengeCoordinator({
    names: brandNames(),
    timeoutMs: 20,
    solver: {
      solve() {
        calls++;
        return new Promise<void>(() => {});
      },
    },
  });
  try {
    await assert.rejects(coordinator.solve(url), /timed out/);
    assert.equal(coordinator.pending, null);
    await assert.rejects(coordinator.solve(url), /timed out/);
    assert.equal(calls, 2);
  } finally {
    coordinator.dispose();
  }
});
