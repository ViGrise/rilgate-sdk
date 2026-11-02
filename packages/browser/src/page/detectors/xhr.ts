import type { ChallengeHandler } from "../../core/types.ts";
import { type BrandNames, challengeUrlOf } from "../../protocol/index.ts";

export function instrumentXhr(
  XhrClass: typeof XMLHttpRequest,
  handle: ChallengeHandler,
  names: BrandNames,
): () => void {
  const originalOpen = XhrClass.prototype.open;
  const originalSend = XhrClass.prototype.send;
  const urls = new WeakMap<XMLHttpRequest, string>();
  XhrClass.prototype.open = function (
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null,
  ) {
    urls.set(this, String(url));
    originalOpen.call(this, method, url, async, username, password);
  };
  XhrClass.prototype.send = function (body) {
    const onReadyStateChange = () => {
      if (this.readyState !== 2) return;
      this.removeEventListener("readystatechange", onReadyStateChange);
      const headers = new Headers();
      for (const name of [names.challengeHeader, names.challengeUrlHeader]) {
        const value = this.getResponseHeader(name);
        if (value !== null) headers.set(name, value);
      }
      const url = challengeUrlOf({ headers }, location.href, names);
      if (url) void handle(url, "xhr", urls.get(this) ?? "").catch(() => {});
    };
    this.addEventListener("readystatechange", onReadyStateChange);
    originalSend.call(this, body);
  };
  return () => {
    XhrClass.prototype.open = originalOpen;
    XhrClass.prototype.send = originalSend;
  };
}
