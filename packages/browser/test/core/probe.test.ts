import { brandNames } from "../../src/protocol/index.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { probeChallenge } from "../../src/core/probe.ts";

test("a probe reports a challenge only for same-origin URLs with the header", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    calls++;
    assert.equal(init?.method, "HEAD");
    assert.equal(new Headers(init?.headers).get("Accept"), "application/json");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "manual");
    return new Response(null, {
      status: 403,
      headers: { "Rilgate-Challenge": "required", "Rilgate-Challenge-Url": "/challenge" },
    });
  };
  const base = "https://example.test/";
  assert.equal(
    (await probeChallenge(fetchImpl, `${base}image.png`, base, brandNames()))?.href,
    `${base}challenge`,
  );
  assert.equal(
    await probeChallenge(fetchImpl, "https://other.test/image.png", base, brandNames()),
    null,
  );
  assert.equal(calls, 1);
  assert.equal(
    await probeChallenge(async () => new Response(null), base, base, brandNames()),
    null,
  );
});
