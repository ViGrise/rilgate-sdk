import { brandNames } from "../../src/protocol/index.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { isChannelMessage } from "../../src/protocol/index.ts";
import {
  createRilgateServiceWorker,
  type ServiceWorkerClientLike,
} from "../../src/service-worker/index.ts";

const base = "https://example.test/resource";
const challenge = () =>
  new Response("challenge", {
    headers: { "Rilgate-Challenge": "required", "Rilgate-Challenge-Url": "/challenge" },
  });

test("a challenged subresource is held until a page verifies and then gets the re-fetched response", async () => {
  const channel = new BroadcastChannel(brandNames().channelName);
  const page = new BroadcastChannel(brandNames().channelName);
  const messages: unknown[] = [];
  let fetchCalls = 0;
  const client: ServiceWorkerClientLike = {
    id: "page",
    type: "window",
    postMessage(message) {
      messages.push(message);
      if (isChannelMessage(message, brandNames()) && message.type === "rilgate-client:challenge") {
        page.postMessage({ type: "rilgate-client:accepted", id: message.id });
        page.postMessage({ type: "rilgate-client:verified" });
      }
    },
  };
  const worker = createRilgateServiceWorker({
    channel,
    clients: {
      async get() {
        return client;
      },
      async matchAll() {
        return [client];
      },
    },
    fetch: async () => {
      fetchCalls++;
      return new Response("upstream");
    },
  });
  try {
    const response = await worker.handleResponse(new Request(base), challenge(), "page");
    assert.equal(await response.text(), "upstream");
    assert.equal(fetchCalls, 1);
    assert.equal(messages.length, 1);
    assert.ok(isChannelMessage(messages[0], brandNames()));
    assert.equal(messages[0].type, "rilgate-client:challenge");
    if (messages[0].type === "rilgate-client:challenge")
      assert.equal(messages[0].challengeUrl, "https://example.test/challenge");
  } finally {
    channel.close();
    page.close();
  }
});

test("with no page accepting, the challenge response returns after the accept timeout", async () => {
  const channel = new BroadcastChannel(brandNames().channelName);
  const page = new BroadcastChannel(brandNames().channelName);
  let fetchCalls = 0;
  const client: ServiceWorkerClientLike = { id: "page", type: "window", postMessage() {} };
  const worker = createRilgateServiceWorker({
    channel,
    acceptTimeoutMs: 20,
    timeoutMs: 1_000,
    clients: {
      async get() {
        return client;
      },
      async matchAll() {
        return [client];
      },
    },
    fetch: async () => {
      fetchCalls++;
      return new Response("upstream");
    },
  });
  try {
    const original = challenge();
    assert.equal(await worker.handleResponse(new Request(base), original, "page"), original);
    assert.equal(fetchCalls, 0);
  } finally {
    channel.close();
    page.close();
  }
});

test("navigation and POST challenges pass through untouched", async () => {
  const channel = new BroadcastChannel(brandNames().channelName);
  const page = new BroadcastChannel(brandNames().channelName);
  let messages = 0;
  const client: ServiceWorkerClientLike = {
    id: "page",
    type: "window",
    postMessage() {
      messages++;
    },
  };
  const worker = createRilgateServiceWorker({
    channel,
    clients: {
      async get() {
        return client;
      },
      async matchAll() {
        return [client];
      },
    },
  });
  try {
    const navigation = new Request(base);
    Object.defineProperty(navigation, "mode", { value: "navigate" });
    const original = challenge();
    assert.equal(await worker.handleResponse(navigation, original, "page"), original);
    assert.equal(
      await worker.handleResponse(
        new Request(base, { method: "POST", body: "body" }),
        original,
        "page",
      ),
      original,
    );
    assert.equal(messages, 0);
  } finally {
    channel.close();
    page.close();
  }
});
