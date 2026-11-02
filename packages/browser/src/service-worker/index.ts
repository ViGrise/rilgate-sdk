import {
  type ChannelEvent,
  type ChannelLike,
  brandNames,
  challengeUrlOf,
  isChannelMessage,
} from "../protocol/index.ts";

export interface ServiceWorkerClientLike {
  id: string;
  type?: string;
  focused?: boolean;
  visibilityState?: string;
  postMessage(message: unknown): void;
}

export interface ServiceWorkerClientsLike {
  get(id: string): Promise<ServiceWorkerClientLike | undefined>;
  matchAll(options: {
    type: "window";
    includeUncontrolled: boolean;
  }): Promise<readonly ServiceWorkerClientLike[]>;
}

export interface RilgateServiceWorkerOptions {
  brandId?: string;
  clients: ServiceWorkerClientsLike;
  channel: ChannelLike;
  fetch?: typeof fetch;
  timeoutMs?: number;
  acceptTimeoutMs?: number;
}

export interface RilgateServiceWorker {
  /** Holds eligible responses until verification and retries them once. */
  handleResponse(request: Request, response: Response, clientId?: string): Promise<Response>;
  /** Workbox response hook for each route. */
  plugin: {
    fetchDidSucceed(args: {
      request: Request;
      response: Response;
      event?: { clientId?: string; resultingClientId?: string };
    }): Promise<Response>;
  };
}

export function createRilgateServiceWorker(
  options: RilgateServiceWorkerOptions,
): RilgateServiceWorker {
  const names = brandNames(options.brandId);
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  let pending: Promise<boolean> | null = null;
  const waitForVerification = async (challengeUrl: URL, clientId?: string): Promise<boolean> => {
    const id = crypto.randomUUID();
    let client = clientId ? await options.clients.get(clientId) : undefined;
    if (!client || client.type !== "window") {
      const clients = await options.clients.matchAll({ type: "window", includeUncontrolled: true });
      client =
        clients.find((candidate) => candidate.focused) ??
        clients.find((candidate) => candidate.visibilityState === "visible") ??
        clients[0];
    }
    if (!client) return false;
    const page = client;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (result: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(acceptTimer);
        clearTimeout(timer);
        options.channel.removeEventListener("message", onMessage);
        resolve(result);
      };
      const onMessage = (event: ChannelEvent) => {
        const message: unknown = event.data;
        if (!isChannelMessage(message, names)) return;
        if (message.type === `${names.messagePrefix}verified`) settle(true);
        else if (
          message.type === `${names.messagePrefix}accepted` &&
          "id" in message &&
          message.id === id
        )
          clearTimeout(acceptTimer);
        else if (
          message.type === `${names.messagePrefix}failed` &&
          "id" in message &&
          message.id === id
        )
          settle(false);
      };
      const acceptTimer = setTimeout(() => settle(false), options.acceptTimeoutMs ?? 2_000);
      const timer = setTimeout(() => settle(false), options.timeoutMs ?? 120_000);
      options.channel.addEventListener("message", onMessage);
      try {
        page.postMessage({
          type: `${names.messagePrefix}challenge`,
          id,
          challengeUrl: challengeUrl.href,
        });
      } catch {
        settle(false);
      }
    });
  };
  const handleResponse = async (
    request: Request,
    response: Response,
    clientId?: string,
  ): Promise<Response> => {
    if (request.mode === "navigate" || (request.method !== "GET" && request.method !== "HEAD"))
      return response;
    const challengeUrl = challengeUrlOf(response, request.url, names);
    if (challengeUrl === null) return response;
    if (!pending) {
      pending = waitForVerification(challengeUrl, clientId).finally(() => {
        pending = null;
      });
    }
    if (!(await pending)) return response;
    return await fetchImpl(request);
  };
  return {
    handleResponse,
    plugin: {
      fetchDidSucceed: ({ request, response, event }) =>
        handleResponse(request, response, event?.clientId || event?.resultingClientId),
    },
  };
}
