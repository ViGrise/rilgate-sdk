import type { BrandNames } from "./brand.ts";

export type ChannelMessage =
  /** Service worker to one page: a held request needs this challenge solved. */
  | { type: `${string}-client:challenge`; id: string; challengeUrl: string }
  /** Page to service worker: the page has the client and will solve challenge `id`. */
  | { type: `${string}-client:accepted`; id: string }
  /** Any page: the access cookie is set, so held and failed requests can be retried. */
  | { type: `${string}-client:verified` }
  /** Page to service worker: solving challenge `id` failed or was dismissed. */
  | { type: `${string}-client:failed`; id: string };

/** The part of a message event that channel listeners read. */
export interface ChannelEvent {
  data: unknown;
}

export interface ChannelLike {
  postMessage(message: ChannelMessage): void;
  addEventListener(type: "message", listener: (event: ChannelEvent) => void): void;
  removeEventListener(type: "message", listener: (event: ChannelEvent) => void): void;
}

export function isChannelMessage(data: unknown, names: BrandNames): data is ChannelMessage {
  if (typeof data !== "object" || data === null || !("type" in data)) return false;
  switch (data.type) {
    case `${names.messagePrefix}verified`:
      return true;
    case `${names.messagePrefix}challenge`:
      return (
        "id" in data &&
        typeof data.id === "string" &&
        "challengeUrl" in data &&
        typeof data.challengeUrl === "string"
      );
    case `${names.messagePrefix}accepted`:
    case `${names.messagePrefix}failed`:
      return "id" in data && typeof data.id === "string";
    default:
      return false;
  }
}
