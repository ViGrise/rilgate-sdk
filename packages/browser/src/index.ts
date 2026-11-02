export {
  createRilgateClient,
  RilgateClient,
  type RilgateClientOptions,
  type ChallengeEventDetail,
} from "./page/client.ts";
export type { ChallengeHandler, ChallengeSource } from "./core/types.ts";
export {
  createIframeSolver,
  ChallengeDismissedError,
  type IframeSolverOptions,
} from "./page/solvers/iframe.ts";
export { ChallengeCoordinator, type ChallengeSolver } from "./core/coordinator.ts";
export { brandNames, type BrandNames, challengeUrlOf } from "./protocol/index.ts";
