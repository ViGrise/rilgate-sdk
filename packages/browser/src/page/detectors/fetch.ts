import { type BrandNames, challengeUrlOf } from "../../protocol/index.ts";
import type { ChallengeHandler } from "../../core/types.ts";

export function wrapFetch(
  fetchImpl: typeof fetch,
  handle: ChallengeHandler,
  options: { maxRetries: number; base: () => string; names: BrandNames },
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    let retries = 0;
    while (true) {
      const response = await fetchImpl(request.clone());
      const url = challengeUrlOf(response, options.base(), options.names);
      if (url === null || retries >= options.maxRetries || request.signal.aborted) return response;
      retries++;
      try {
        await handle(url, "fetch", request.url);
      } catch {
        return response;
      }
    }
  };
}
