import { brandNames } from "../protocol/index.ts";
import {
  createRilgateServiceWorker,
  type RilgateServiceWorker,
  type ServiceWorkerClientsLike,
} from "../service-worker/index.ts";

function shared(options: { brandId?: string } = {}): RilgateServiceWorker {
  const brandId = options.brandId ?? "rilgate";
  const names = brandNames(brandId);
  let instance = instances.get(brandId);
  if (!instance) {
    instance = createRilgateServiceWorker({
      brandId,
      clients: worker.clients,
      channel: new BroadcastChannel(names.channelName),
    });
    instances.set(brandId, instance);
  }
  return instance;
}

const instances = new Map<string, RilgateServiceWorker>();
const worker = globalThis as typeof globalThis & {
  clients: ServiceWorkerClientsLike;
  RilgateServiceWorker: {
    createRilgateServiceWorker: typeof createRilgateServiceWorker;
    shared: typeof shared;
  };
};
worker.RilgateServiceWorker = { createRilgateServiceWorker, shared };
