import type { ChallengeSolver } from "../../core/coordinator.ts";
import { type BrandNames, brandNames } from "../../protocol/index.ts";

export interface IframeSolverOptions {
  brandId?: string;
  /** Mounts the frame and returns its cleanup function. */
  mount?: (frame: HTMLIFrameElement, dismiss: () => void) => () => void;
  title?: string;
}

export class ChallengeDismissedError extends Error {
  constructor() {
    super("The challenge was dismissed");
    this.name = "ChallengeDismissedError";
  }
}

function mountOverlay(
  frame: HTMLIFrameElement,
  dismiss: () => void,
  names: BrandNames,
): () => void {
  const overlay = document.createElement("div");
  overlay.setAttribute(names.overlayAttribute, "");
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:2147483647; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.5)";
  frame.style.cssText =
    "width:min(480px,100vw - 32px); height:min(640px,100vh - 32px); border:0; border-radius:12px; background:#fff";
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  close.style.cssText = "position:absolute; top:16px; right:16px";
  close.addEventListener("click", dismiss);
  overlay.append(frame, close);
  document.body.append(overlay);
  return () => overlay.remove();
}

export function createIframeSolver(options: IframeSolverOptions = {}): ChallengeSolver {
  const names = brandNames(options.brandId);
  return {
    solve(url, signal) {
      if (url.origin !== location.origin) {
        return Promise.reject(new Error("The challenge URL must be same-origin"));
      }
      if (signal.aborted) return Promise.reject(signal.reason);
      return new Promise<void>((resolve, reject) => {
        const frame = document.createElement("iframe");
        frame.src = url.href;
        frame.title = options.title ?? "Security check";
        let unmount: (() => void) | undefined;
        let settled = false;
        const settle = (success: boolean, error?: unknown) => {
          if (settled) return;
          settled = true;
          window.removeEventListener("message", onMessage);
          signal.removeEventListener("abort", onAbort);
          unmount?.();
          if (success) resolve();
          else reject(error);
        };
        const onMessage = (event: MessageEvent) => {
          if (
            event.origin === location.origin &&
            event.source === frame.contentWindow &&
            event.data?.type === names.pageVerifiedMessage
          )
            settle(true);
        };
        const onAbort = () => settle(false, signal.reason);
        window.addEventListener("message", onMessage);
        signal.addEventListener("abort", onAbort, { once: true });
        try {
          unmount = (options.mount ?? ((frame, dismiss) => mountOverlay(frame, dismiss, names)))(
            frame,
            () => settle(false, new ChallengeDismissedError()),
          );
          // A custom mount can settle the challenge before it returns its cleanup function.
          if (settled) unmount();
        } catch (error) {
          settle(false, error);
        }
      });
    },
  };
}
