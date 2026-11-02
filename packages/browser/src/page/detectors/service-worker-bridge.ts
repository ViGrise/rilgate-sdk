import type { ChallengeHandler } from "../../core/types.ts";
import { type BrandNames, type ChannelLike, isChannelMessage } from "../../protocol/index.ts";

export function connectServiceWorker(
  container: ServiceWorkerContainer,
  channel: ChannelLike,
  handle: ChallengeHandler,
  names: BrandNames,
): () => void {
  const onMessage = (event: MessageEvent) => {
    const message: unknown = event.data;
    if (
      !isChannelMessage(message, names) ||
      message.type !== `${names.messagePrefix}challenge` ||
      !("challengeUrl" in message)
    )
      return;
    channel.postMessage({
      type: `${names.messagePrefix}accepted` as `${string}-client:accepted`,
      id: message.id,
    });
    void (async () => {
      try {
        await handle(
          new URL(message.challengeUrl, location.href),
          "service-worker",
          message.challengeUrl,
        );
      } catch {
        channel.postMessage({
          type: `${names.messagePrefix}failed` as `${string}-client:failed`,
          id: message.id,
        });
      }
    })();
  };
  container.addEventListener("message", onMessage);
  return () => container.removeEventListener("message", onMessage);
}
