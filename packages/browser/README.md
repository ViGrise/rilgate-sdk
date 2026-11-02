# @rilgate/browser

The Rilgate browser SDK detects challenges on same-origin requests. It opens one solver for concurrent challenges. It shares verification between tabs. It retries fetch requests and eligible service worker requests after verification. It also detects failed resources and connections.

## Requirements

Use a Rilgate gateway that sends `Rilgate-Challenge: required` and `Rilgate-Challenge-Url` on every challenge response. The response status can be 200, 401, or 403. These header names follow `brandId`, which defaults to `"rilgate"`. The `brandId` value must equal the gateway `site.brand_id`. The SDK uses the header to detect a challenge. Keep the application, protected resources, and challenge page on the same origin. Allow same-origin frames in the application Content Security Policy.

## Install

```sh
npm install @rilgate/browser
```

## Quick start

For a bundled application, create the client early in the application entry point.

```js
import { createRilgateClient } from "@rilgate/browser";

const client = createRilgateClient();
```

For classic scripts, serve the global bundle from your origin. Put these scripts first in `<head>`.

```html
<script src="/rilgate-browser.global.js"></script>
<script>Rilgate.createRilgateClient()</script>
```

The global bundle does not start the client automatically.

Use `client.fetch` to call the wrapped fetch directly. It is available when `instrument.fetch` is false. Call `client.solve(challengeUrl)` to open a challenge directly. Call `client.dispose()` to restore patched globals and close the channel.

All instrumentation flags default to true.

```js
const client = createRilgateClient({
  brandId: "rilgate",
  timeoutMs: 120_000,
  maxRetries: 1,
  reloadOnScriptChallenge: true,
  instrument: {
    fetch: true,
    xhr: true,
    resources: true,
    connections: true,
    serviceWorker: true,
  },
});
```

## What it detects

| Source | How detected | How recovered |
| --- | --- | --- |
| Fetch | Challenge header | Transparent retry |
| XHR | Challenge header | Application retries on `verified` |
| Images, media, stylesheets | Element error and HEAD probe | Resource reload |
| Scripts and module chunks | SyntaxError, element error, or import rejection and HEAD probe | Page reload |
| WebSocket and EventSource | Connection failure and HEAD probe | Application reconnects on `verified` |
| Any same-origin GET or HEAD with a service worker | Challenge header | Request held and retried |

A probe sends HEAD with `Accept: application/json`. It uses same-origin credentials, disables the cache, and handles redirects manually. The client shares probes for the same URL while they are in progress. Set `reloadOnScriptChallenge: false` to disable the automatic page reload for script challenges.

## Service worker setup

Keep a page client active to show the solver. The page client and service worker use the `<brandId>-client` BroadcastChannel, with `rilgate-client` as the default.

For a bundled service worker, pass responses through `handleResponse`.

```js
import { createRilgateServiceWorker } from "@rilgate/browser/service-worker";

const rilgateServiceWorker = createRilgateServiceWorker({
  clients: self.clients,
  channel: new BroadcastChannel("rilgate-client"),
});

self.addEventListener("fetch", (event) => {
  event.respondWith((async () => {
    const response = await fetch(event.request.clone());
    return rilgateServiceWorker.handleResponse(
      event.request,
      response,
      event.clientId || event.resultingClientId,
    );
  })());
});
```

The service worker waits up to 2,000 ms for a page to accept. It waits up to 120,000 ms for verification. Use `acceptTimeoutMs` and `timeoutMs` to set these limits. It selects the request's window client when available. Otherwise, it selects a focused window, a visible window, or the first window. It retries an eligible request once after verification.

For Workbox, add the plugin to each route. Register a final catch-all `NetworkOnly` route.

```js
import { registerRoute } from "workbox-routing";
import { NetworkOnly } from "workbox-strategies";
import { createRilgateServiceWorker } from "@rilgate/browser/service-worker";

const rilgateServiceWorker = createRilgateServiceWorker({
  clients: self.clients,
  channel: new BroadcastChannel("rilgate-client"),
});

registerRoute(
  ({ url }) => url.pathname.startsWith("/api/"),
  new NetworkOnly({ plugins: [rilgateServiceWorker.plugin] }),
);
registerRoute(
  () => true,
  new NetworkOnly({ plugins: [rilgateServiceWorker.plugin] }),
);
```

For unbundled Workbox `generateSW`, serve the global service worker bundle at `/rilgate-service-worker.global.js`. Use `importScripts` to load it. Add this plugin object to each runtime route. Put the catch-all route last.

```js
import { generateSW } from "workbox-build";

await generateSW({
  globDirectory: "public",
  globPatterns: ["**/*.{html,js,css,png,svg}"],
  swDest: "public/sw.js",
  importScripts: ["/rilgate-service-worker.global.js"],
  runtimeCaching: [
    {
      urlPattern: /\/api\//,
      handler: "NetworkOnly",
      options: {
        plugins: [{
          fetchDidSucceed: (args) => self.RilgateServiceWorker.shared({ brandId: "rilgate" }).plugin.fetchDidSucceed(args),
        }],
      },
    },
    {
      urlPattern: () => true,
      handler: "NetworkOnly",
      options: {
        plugins: [{
          fetchDidSucceed: (args) => self.RilgateServiceWorker.shared({ brandId: "rilgate" }).plugin.fetchDidSucceed(args),
        }],
      },
    },
  ],
});
```

## Events

Listen on the client for these `CustomEvent` types.

| Event | When sent | Detail |
| --- | --- | --- |
| `challenge` | Each detection, before solving | `source`, `resourceUrl`, `challengeUrl` |
| `verified` | Successful verification in this tab or another tab | The same detail |
| `failed` | Solving fails | The same detail and `error` |

`source` is `fetch`, `xhr`, `resource`, `connection`, or `service-worker`.

```js
client.addEventListener("verified", (event) => {
  if (event.detail.source === "xhr") retryApplicationRequest(event.detail.resourceUrl);
  if (event.detail.source === "connection") reconnectApplication();
});

client.addEventListener("failed", (event) => {
  console.error(event.detail.error);
});
```

## Custom UI

Use `createIframeSolver({ mount })` to mount the solver frame in your interface. Return a function that removes the mounted elements. Call `dismiss` to cancel the challenge. A cancellation rejects with `ChallengeDismissedError`.

```js
import { createIframeSolver, createRilgateClient } from "@rilgate/browser";

const solver = createIframeSolver({
  title: "Security check",
  mount(frame, dismiss) {
    const dialog = document.createElement("dialog");
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", dismiss);
    dialog.addEventListener("cancel", dismiss);
    dialog.append(frame, close);
    document.body.append(dialog);
    dialog.showModal();
    return () => dialog.remove();
  },
});

const client = createRilgateClient({ solver });
```

The default solver shows an overlay with a close button. The default frame title is `Security check`. The solver checks the message origin and the sending frame before it accepts verification.

## Limits

Cross-origin requests and opaque responses are not detected. The gateway page handles the first page navigation. Streaming bodies cannot be replayed. XHR requests are not replayed. Applications retry XHR requests and reconnect connections after the `verified` event. The service worker retries only GET and HEAD requests. A persistent challenge returns to the caller after the retry limit.

## Development

See the [repository README](../../README.md#development).
