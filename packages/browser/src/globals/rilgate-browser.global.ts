import { createRilgateClient } from "../page/client.ts";
import { createIframeSolver } from "../page/solvers/iframe.ts";

(
  globalThis as typeof globalThis & {
    Rilgate: {
      createRilgateClient: typeof createRilgateClient;
      createIframeSolver: typeof createIframeSolver;
    };
  }
).Rilgate = { createRilgateClient, createIframeSolver };
