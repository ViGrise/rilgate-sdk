import type { BrandNames } from "./brand.ts";

/**
 * The challenge page URL announced by a response, or `null` when the response is not a Rilgate
 * challenge. Opaque cross-origin responses expose no headers and always give `null`.
 */
export function challengeUrlOf(
  response: { headers: Headers },
  base: string,
  names: BrandNames,
): URL | null {
  if (response.headers.get(names.challengeHeader)?.trim().toLowerCase() !== "required") return null;
  const raw = response.headers.get(names.challengeUrlHeader);
  if (!raw) return null;
  try {
    const url = new URL(raw, base);
    return url.origin === new URL(base).origin ? url : null;
  } catch {
    return null;
  }
}
