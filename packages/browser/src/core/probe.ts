import { type BrandNames, challengeUrlOf } from "../protocol/index.ts";

export async function probeChallenge(
  fetchImpl: typeof fetch,
  url: string,
  base: string,
  names: BrandNames,
): Promise<URL | null> {
  try {
    if (new URL(url, base).origin !== new URL(base).origin) return null;
    const response = await fetchImpl(url, {
      method: "HEAD",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual",
    });
    return challengeUrlOf(response, base, names);
  } catch {
    return null;
  }
}
