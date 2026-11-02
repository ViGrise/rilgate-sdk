import { wrapEventSource, wrapWebSocket } from "./detectors/connections.ts";
import { ChallengeCoordinator, type ChallengeSolver } from "../core/coordinator.ts";
import type { ChallengeHandler, ChallengeSource } from "../core/types.ts";
import { wrapFetch } from "./detectors/fetch.ts";
import { createIframeSolver } from "./solvers/iframe.ts";
import { probeChallenge } from "../core/probe.ts";
import { brandNames } from "../protocol/index.ts";
import { monitorResources } from "./detectors/resources.ts";
import { connectServiceWorker } from "./detectors/service-worker-bridge.ts";
import { instrumentXhr } from "./detectors/xhr.ts";

export interface RilgateClientOptions {
  brandId?: string;
  solver?: ChallengeSolver;
  timeoutMs?: number;
  maxRetries?: number;
  reloadOnScriptChallenge?: boolean;
  instrument?: {
    fetch?: boolean;
    xhr?: boolean;
    resources?: boolean;
    connections?: boolean;
    serviceWorker?: boolean;
  };
}

export interface ChallengeEventDetail {
  source: ChallengeSource;
  resourceUrl: string;
  challengeUrl: string;
}

let reloadRequested = false;

export class RilgateClient extends EventTarget {
  readonly fetch: typeof fetch;
  #coordinator: ChallengeCoordinator;
  #channel: BroadcastChannel | undefined;
  #restores: (() => void)[] = [];
  #probes = new Map<string, Promise<boolean>>();

  constructor(options: RilgateClientOptions = {}) {
    super();
    const names = brandNames(options.brandId);
    this.#channel =
      typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(names.channelName);
    this.#coordinator = new ChallengeCoordinator({
      names,
      solver: options.solver ?? createIframeSolver({ brandId: options.brandId ?? "rilgate" }),
      timeoutMs: options.timeoutMs ?? 120_000,
      channel: this.#channel,
    });
    const handle: ChallengeHandler = (url, source, resourceUrl) =>
      this.#handle(url, source, resourceUrl);
    const nativeFetch = typeof globalThis.fetch === "undefined" ? undefined : globalThis.fetch;
    this.fetch = wrapFetch(
      (input, init) => {
        if (!nativeFetch) return Promise.reject(new Error("Fetch is unavailable"));
        return nativeFetch.call(globalThis, input, init);
      },
      handle,
      { maxRetries: options.maxRetries ?? 1, base: () => location.href, names },
    );
    const instrument = options.instrument ?? {};
    if (instrument.fetch !== false && nativeFetch) {
      globalThis.fetch = this.fetch;
      this.#restores.push(() => {
        globalThis.fetch = nativeFetch;
      });
    }
    if (instrument.xhr !== false && typeof XMLHttpRequest !== "undefined") {
      this.#restores.push(instrumentXhr(XMLHttpRequest, handle, names));
    }
    const recover = (url: string, source: "resource" | "connection") => {
      const active = this.#probes.get(url);
      if (active) return active;
      const recovery = (async () => {
        const pending = this.#coordinator.pending;
        if (pending) await pending;
        else {
          if (!nativeFetch) return false;
          const challengeUrl = await probeChallenge(
            nativeFetch.bind(globalThis),
            url,
            location.href,
            names,
          );
          if (challengeUrl === null) return false;
          await handle(challengeUrl, source, url);
        }
        return true;
      })();
      const tracked = recovery.finally(() => this.#probes.delete(url));
      this.#probes.set(url, tracked);
      return tracked;
    };
    if (instrument.resources !== false && typeof window !== "undefined") {
      this.#restores.push(
        monitorResources(window, (failure) => {
          void recover(failure.url, "resource")
            .then((verified) => {
              if (!verified) return;
              if (failure.reload) failure.reload();
              else if ((options.reloadOnScriptChallenge ?? true) && !reloadRequested) {
                reloadRequested = true;
                location.reload();
              }
            })
            .catch(() => {});
        }),
      );
    }
    if (instrument.connections !== false) {
      const onFailure = (url: string) => {
        void recover(url, "connection").catch(() => {});
      };
      if (typeof WebSocket !== "undefined") {
        const native = globalThis.WebSocket;
        globalThis.WebSocket = wrapWebSocket(native, onFailure);
        this.#restores.push(() => {
          globalThis.WebSocket = native;
        });
      }
      if (typeof EventSource !== "undefined") {
        const native = globalThis.EventSource;
        globalThis.EventSource = wrapEventSource(native, onFailure);
        this.#restores.push(() => {
          globalThis.EventSource = native;
        });
      }
    }
    if (
      instrument.serviceWorker !== false &&
      typeof navigator !== "undefined" &&
      navigator.serviceWorker &&
      this.#channel
    ) {
      this.#restores.push(
        connectServiceWorker(navigator.serviceWorker, this.#channel, handle, names),
      );
    }
  }

  async #handle(challengeUrl: URL, source: ChallengeSource, resourceUrl: string): Promise<void> {
    const detail: ChallengeEventDetail = { source, resourceUrl, challengeUrl: challengeUrl.href };
    this.dispatchEvent(new CustomEvent("challenge", { detail }));
    try {
      await this.#coordinator.solve(challengeUrl);
      this.dispatchEvent(new CustomEvent("verified", { detail }));
    } catch (error) {
      this.dispatchEvent(new CustomEvent("failed", { detail: { ...detail, error } }));
      throw error;
    }
  }

  solve(challengeUrl: URL): Promise<void> {
    return this.#handle(challengeUrl, "fetch", challengeUrl.href);
  }

  dispose(): void {
    for (const restore of this.#restores.splice(0).reverse()) restore();
    this.#coordinator.dispose();
    this.#channel?.close();
  }
}

export function createRilgateClient(options?: RilgateClientOptions): RilgateClient {
  return new RilgateClient(options);
}
