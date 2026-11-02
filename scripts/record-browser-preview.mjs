// Records the browser SDK in Chromium and writes docs/images/browser-sdk.gif.
//
// A Rilgate gateway serves an example application and challenges its API. The application calls
// the API with fetch, and @rilgate/browser opens the real challenge page in its frame. The page
// solves nothing: its proof API requests never complete, and the script plays its states on a
// fixed timeline. The script then sends the verification message from the frame and answers the
// retried API request, in place of the gateway accepting the access cookie.
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const binary = process.env.RILGATE_BINARY;
if (!binary) throw new Error("Set RILGATE_BINARY to a Rilgate gateway binary.");
const viewport = { width: 720, height: 450 };
const frameRate = 25;
// Each step is [page state, seconds on screen, options]. `rate` animates the attempt counter in
// hashes per second.
const steps = [
  ["preparing", 3],
  ["fast", 5, { rate: 330_000 }],
  ["verifying", 3],
  ["success", 2],
];
const report = { title: "Monthly report", rows: 128, updated: "2 minutes ago" };
const applicationPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Example application</title>
<script src="/sdk/rilgate-browser.global.js"></script>
<script>Rilgate.createRilgateClient()</script>
<style>body{margin:0;font:16px system-ui,sans-serif;background:#f6f7fb;color:#1d2433;display:grid;place-items:center;height:100vh}
main{background:#fff;border-radius:16px;padding:36px 44px;box-shadow:0 8px 30px rgba(20,30,60,.08);text-align:center;min-width:340px}
h1{margin:0 0 6px;font-size:26px}p{margin:0 0 20px;color:#5b6475}
button{font:inherit;padding:10px 20px;border:0;border-radius:10px;background:#1d2433;color:#fff;cursor:pointer}
#result{margin-top:20px;color:#1d2433}#result strong{display:block;font-size:18px;margin-bottom:4px}</style></head>
<body><main><h1>Example application</h1><p>The API behind this button is protected by Rilgate.</p>
<button id="load" type="button">Load report</button><div id="result"></div></main>
<script>
document.querySelector("#load").addEventListener("click", async () => {
  const result = document.querySelector("#result");
  result.textContent = "Loading…";
  const response = await fetch("/api/report", { headers: { accept: "application/json" } });
  const body = await response.json();
  result.innerHTML = response.ok
    ? "<strong>" + body.title + "</strong>" + body.rows + " rows · updated " + body.updated
    : "Request failed";
});
</script></body></html>`;

const wait = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startUpstream() {
  const sdk = await readFile(join(root, "packages/browser/dist/rilgate-browser.global.js"));
  const server = createServer((request, response) => {
    if (request.url === "/sdk/rilgate-browser.global.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(sdk);
    } else {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(applicationPage);
    }
  });
  return { server, port: await listen(server) };
}

async function startGateway(directory, upstreamPort) {
  const port = await freePort();
  const operationsPort = await freePort();
  const config = join(directory, "gateway.yml");
  await writeFile(
    config,
    `server:
  listen: "127.0.0.1:${port}"
  operations:
    listen: "127.0.0.1:${operationsPort}"
  upstream:
    url: "http://127.0.0.1:${upstreamPort}"
security:
  secret: "browser-sdk-preview-proof-key-with-at-least-32-bytes"
policy:
  rules:
    - name: report-api
      when: {path: {prefix: /api/}}
      action: challenge
      challenge: {algorithm: fast, difficulty: 4}
    - name: application
      when: {path: {prefix: /}}
      action: allow
`,
  );
  const gateway = spawn(binary, ["--config", config], { stdio: ["ignore", "ignore", "pipe"] });
  let errors = "";
  gateway.stderr.on("data", (chunk) => {
    errors = (errors + chunk).slice(-4000);
  });
  const url = `http://localhost:${port}/`;
  for (let attempt = 0; ; attempt++) {
    try {
      await fetch(url);
      return { gateway, url };
    } catch {
      if (attempt > 100 || gateway.exitCode !== null) {
        throw new Error(`The gateway did not start: ${errors}`);
      }
      await wait(0.1);
    }
  }
}

// Runs in every frame before its scripts. Requests to the gateway proof API never complete, so
// the challenge page waits and the recorder sets every state.
function holdProofApi() {
  const send = window.fetch.bind(window);
  window.fetch = (input, init) =>
    String(input instanceof Request ? input.url : input).includes("/.well-known/rilgate/api/")
      ? new Promise(() => {})
      : send(input, init);
}

// Runs in every frame before its scripts and draws a pointer at the mouse position, because
// headless Chromium records no cursor.
function showPointer() {
  if (window !== window.top) return;
  // Each shape has its hot spot, the point that the mouse position names, at its offset.
  const shapes = {
    arrow: {
      offset: [5, 3],
      svg: '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 3l14 9-6.5 1.5L16 20l-2.6 1.2-3-6.6L5 19z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    },
    hand: {
      offset: [10.5, 2],
      svg: '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M9 3.5a1.5 1.5 0 0 1 3 0V10h.5V8.5a1.5 1.5 0 0 1 3 0V10h.5V9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.2a5 5 0 0 1-4-2l-3.3-4.4a1.5 1.5 0 0 1 2.3-1.9L9 14.5z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    },
  };
  addEventListener("DOMContentLoaded", () => {
    const pointer = document.createElement("div");
    Object.assign(pointer.style, {
      position: "fixed",
      left: "0",
      top: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
      display: "none",
      transition: "transform 0.12s, opacity 0.4s",
    });
    document.documentElement.append(pointer);
    let shape;
    addEventListener(
      "mousemove",
      (event) => {
        const next = event.target.closest?.("button, a, [role=button]") ? "hand" : "arrow";
        if (next !== shape) {
          shape = next;
          pointer.innerHTML = shapes[shape].svg;
          pointer.style.transformOrigin = `${shapes[shape].offset[0]}px ${shapes[shape].offset[1]}px`;
        }
        pointer.style.display = "block";
        pointer.style.left = `${event.clientX - shapes[shape].offset[0]}px`;
        pointer.style.top = `${event.clientY - shapes[shape].offset[1]}px`;
      },
      true,
    );
    addEventListener("mousedown", () => (pointer.style.transform = "scale(0.85)"), true);
    addEventListener(
      "mouseup",
      () => {
        pointer.style.transform = "";
        // The pointer leaves after the click, so it does not cover the challenge.
        setTimeout(() => (pointer.style.opacity = "0"), 400);
      },
      true,
    );
  });
}

// Moves the mouse along an eased path, one position per display frame.
async function glide(page, from, to, seconds) {
  const started = Date.now();
  for (;;) {
    const progress = Math.min((Date.now() - started) / 1000 / seconds, 1);
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    await page.mouse.move(from.x + (to.x - from.x) * eased, from.y + (to.y - from.y) * eased);
    if (progress === 1) return;
    await wait(1 / 60);
  }
}

// Shows one challenge state in the frame for `seconds`, with a live attempt counter while the
// state solves.
async function play(frame, [state, seconds, options = {}]) {
  await frame.evaluate((state) => window.PowClient.state(state), state);
  if (!options.rate) return wait(seconds);
  const started = Date.now();
  let attempts = 0;
  for (let elapsed = 0; elapsed < seconds; elapsed = (Date.now() - started) / 1000) {
    const rate = options.rate * (0.96 + Math.random() * 0.08);
    attempts += rate * 0.1;
    await frame.evaluate(
      ([attempts, rate]) => window.PowClient.stats(attempts, rate),
      [Math.round(attempts), Math.round(rate)],
    );
    await wait(0.1);
  }
}

async function record(directory, url) {
  const videos = join(directory, "video");
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: videos, size: viewport },
    colorScheme: "light",
    locale: "en-US",
  });
  await context.addInitScript(holdProofApi);
  await context.addInitScript(showPointer);
  let reportRequests = 0;
  await context.route("**/api/report", async (route) => {
    reportRequests += 1;
    if (reportRequests === 1) return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report) });
  });
  const started = Date.now();
  const page = await context.newPage();
  await page.goto(url);
  await page.getByText("Example application").waitFor();
  const start = (Date.now() - started) / 1000;

  const button = page.locator("#load");
  const box = await button.boundingBox();
  const from = { x: viewport.width * 0.82, y: viewport.height * 0.86 };
  const to = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.6 };
  await page.mouse.move(from.x, from.y);
  await wait(1);
  await glide(page, from, to, 1.4);
  await wait(0.8);
  await page.mouse.down();
  await wait(0.12);
  await page.mouse.up();

  const challenge = page.frameLocator("[data-rilgate-challenge] iframe");
  await challenge.locator("#title").waitFor();
  const frame = page.frames().find((candidate) => candidate.url().includes("/challenge?"));
  await frame.waitForFunction(() => window.PowClient?.state);
  for (const step of steps) await play(frame, step);
  await frame.evaluate(() => window.parent.postMessage({ type: "rilgate:verified" }, location.origin));
  await page.getByText(report.title).waitFor();
  await wait(3);
  await context.close();
  await browser.close();
  const [video] = await readdir(videos);
  return { video: join(videos, video), start };
}

function writeGif({ video, start }, output) {
  const duration = Number(
    execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      video,
    ]).toString(),
  );
  // The recording ends on a blank frame.
  const end = Math.max(duration - 0.3, start + 1);
  const filter = [
    `trim=start=${start}:end=${end},setpts=PTS-STARTPTS,fps=${frameRate},scale=640:-1:flags=lanczos,split[a][b]`,
    "[a]palettegen=max_colors=128:stats_mode=full[p]",
    "[b][p]paletteuse=dither=sierra2_4a",
  ].join(";");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    video,
    "-filter_complex",
    filter,
    "-loop",
    "0",
    output,
  ]);
}

const directory = await mkdtemp(join(tmpdir(), "rilgate-browser-preview-"));
const upstream = await startUpstream();
try {
  const { gateway, url } = await startGateway(directory, upstream.port);
  try {
    const recording = await record(directory, url);
    const output = join(root, "docs/images/browser-sdk.gif");
    writeGif(recording, output);
    console.log(`Wrote ${output}`);
  } finally {
    gateway.kill("SIGTERM");
    await once(gateway, "exit");
  }
} finally {
  upstream.server.close();
  await rm(directory, { recursive: true, force: true });
}
