import type { BrandNames, ChannelEvent, ChannelLike } from "../protocol/index.ts";
import { isChannelMessage } from "../protocol/index.ts";

/** Shows a challenge page to the user and settles when the page reports verification. */
export interface ChallengeSolver {
  solve(challengeUrl: URL, signal: AbortSignal): Promise<void>;
}

export interface CoordinatorOptions {
  names: BrandNames;
  solver: ChallengeSolver;
  timeoutMs: number;
  channel?: ChannelLike | undefined;
}

/** Shares one open challenge across callers and accepts verification from other tabs. */
export class ChallengeCoordinator {
  #names: BrandNames;
  #solver: ChallengeSolver;
  #timeoutMs: number;
  #channel: ChannelLike | undefined;
  #pending: Promise<void> | null = null;
  #verifiedElsewhere: (() => void) | null = null;
  #onMessage = (event: ChannelEvent) => {
    if (
      isChannelMessage(event.data, this.#names) &&
      event.data.type === `${this.#names.messagePrefix}verified`
    ) {
      this.#verifiedElsewhere?.();
    }
  };

  constructor(options: CoordinatorOptions) {
    this.#names = options.names;
    this.#solver = options.solver;
    this.#timeoutMs = options.timeoutMs;
    this.#channel = options.channel;
    this.#channel?.addEventListener("message", this.#onMessage);
  }

  /** The open challenge, or `null` when no challenge is open. */
  get pending(): Promise<void> | null {
    return this.#pending;
  }

  solve(challengeUrl: URL): Promise<void> {
    if (this.#pending) return this.#pending;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("The challenge timed out")),
      this.#timeoutMs,
    );
    let solvedHere = false;
    const remote = new Promise<void>((resolve) => {
      this.#verifiedElsewhere = resolve;
    });
    const local = Promise.resolve()
      .then(() => this.#solver.solve(challengeUrl, controller.signal))
      .then(() => {
        solvedHere = true;
      });
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
        once: true,
      });
    });
    this.#pending = Promise.race([local, remote, aborted])
      .then(() => {
        if (solvedHere)
          this.#channel?.postMessage({
            type: `${this.#names.messagePrefix}verified` as `${string}-client:verified`,
          });
      })
      .finally(() => {
        clearTimeout(timer);
        // Closes the local solver UI when another tab or the timeout settled the challenge.
        controller.abort(new Error("The challenge is settled"));
        this.#verifiedElsewhere = null;
        this.#pending = null;
      });
    return this.#pending;
  }

  dispose(): void {
    this.#channel?.removeEventListener("message", this.#onMessage);
  }
}
