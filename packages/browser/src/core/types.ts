export type ChallengeSource = "fetch" | "xhr" | "resource" | "connection" | "service-worker";
export type ChallengeHandler = (
  challengeUrl: URL,
  source: ChallengeSource,
  resourceUrl: string,
) => Promise<void>;
