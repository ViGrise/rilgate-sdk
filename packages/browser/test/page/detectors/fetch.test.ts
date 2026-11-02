import { createRilgateClient } from "../../../src/page/client.ts";
import { brandNames } from "../../../src/protocol/index.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { ChallengeCoordinator } from "../../../src/core/coordinator.ts";
import { wrapFetch } from "../../../src/page/detectors/fetch.ts";

const base = "https://example.test/";
const challenge = () =>
  new Response("challenge", {
    status: 200,
    headers: {
      "Content-Type": "text/html",
      "Rilgate-Challenge": "required",
      "Rilgate-Challenge-Url": "/challenge",
    },
  });

test("concurrent challenged requests open one challenge and each gets the upstream response", async () => {
  let solved = false;
  let calls = 0;
  const coordinator = new ChallengeCoordinator({
    names: brandNames(),
    solver: {
      async solve() {
        calls++;
        solved = true;
      },
    },
    timeoutMs: 1_000,
  });
  try {
    const fetchImpl: typeof fetch = async () => (solved ? new Response("ok") : challenge());
    const wrapped = wrapFetch(fetchImpl, (url) => coordinator.solve(url), {
      maxRetries: 1,
      names: brandNames(),
      base: () => base,
    });
    const responses = await Promise.all([wrapped(base), wrapped(base), wrapped(base)]);
    assert.equal(calls, 1);
    assert.deepEqual(await Promise.all(responses.map((response) => response.text())), [
      "ok",
      "ok",
      "ok",
    ]);
  } finally {
    coordinator.dispose();
  }
});

test("a challenge that persists after solving returns the challenge response without looping", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls++;
    return challenge();
  };
  const wrapped = wrapFetch(fetchImpl, async () => {}, {
    maxRetries: 1,
    names: brandNames(),
    base: () => base,
  });
  const response = await wrapped(base);
  assert.equal(calls, 2);
  assert.equal(response.headers.get("Rilgate-Challenge"), "required");
});

test("a retried POST sends the original body", async () => {
  let calls = 0;
  let recorded = "";
  const body = JSON.stringify({ message: "hello" });
  const fetchImpl: typeof fetch = async (input, init) => {
    calls++;
    if (calls === 1) return challenge();
    recorded = await new Request(input, init).text();
    return new Response("ok");
  };
  const wrapped = wrapFetch(fetchImpl, async () => {}, {
    maxRetries: 1,
    names: brandNames(),
    base: () => base,
  });
  await wrapped(base, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  assert.equal(recorded, body);
});

test("a custom brand id detects its own headers and ignores the default ones", async () => {
  let solved = false;
  let solves = 0;
  const defaultResponse = challenge();
  let response = defaultResponse;
  const originalFetch = globalThis.fetch;
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  globalThis.fetch = async () => (solved ? new Response("ok") : response);
  Object.defineProperty(globalThis, "location", { configurable: true, value: new URL(base) });
  const client = createRilgateClient({
    brandId: "vigrise",
    solver: {
      async solve() {
        solves++;
        solved = true;
      },
    },
    instrument: {
      fetch: false,
      xhr: false,
      resources: false,
      connections: false,
      serviceWorker: false,
    },
  });
  try {
    assert.equal(await client.fetch(base), defaultResponse);
    assert.equal(solves, 0);
    response = new Response("challenge", {
      headers: {
        "vigrise-challenge": "required",
        "vigrise-challenge-url": "/challenge",
      },
    });
    assert.equal(await (await client.fetch(base)).text(), "ok");
    assert.equal(solves, 1);
  } finally {
    client.dispose();
    globalThis.fetch = originalFetch;
    if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
    else Reflect.deleteProperty(globalThis, "location");
  }
});
