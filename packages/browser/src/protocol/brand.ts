export interface BrandNames {
  challengeHeader: string;
  challengeUrlHeader: string;
  pageVerifiedMessage: string;
  channelName: string;
  messagePrefix: string;
  overlayAttribute: string;
}

export function brandNames(brandId = "rilgate"): BrandNames {
  if (brandId.match(/^[a-z](?:[a-z0-9-]{0,30}[a-z0-9])?$/)?.[0] !== brandId) {
    throw new TypeError(
      "brandId: expected 1 to 32 lowercase letters, digits or hyphens, starting with a letter and not ending with a hyphen",
    );
  }
  return {
    challengeHeader: `${brandId}-challenge`,
    challengeUrlHeader: `${brandId}-challenge-url`,
    pageVerifiedMessage: `${brandId}:verified`,
    channelName: `${brandId}-client`,
    messagePrefix: `${brandId}-client:`,
    overlayAttribute: `data-${brandId}-challenge`,
  };
}
