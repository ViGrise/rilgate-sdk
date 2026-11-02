#[derive(Debug, thiserror::Error)]
pub enum Error {
  #[error("The brand identifier is invalid.")]
  InvalidBrandId,
  #[error("The challenge is invalid: {0}")]
  InvalidChallenge(String),
  #[error("The algorithm is unsupported: {0}")]
  UnsupportedAlgorithm(String),
  #[error("The challenge has expired.")]
  ChallengeExpired,
  #[error("The operation was cancelled.")]
  Cancelled,
  #[error("The request rate limit was reached.")]
  RateLimited { retry_after_seconds: Option<u64> },
  #[error("Work is unavailable.")]
  WorkUnavailable { retry_after_seconds: Option<u64> },
  #[error("The request was rejected with status {status}: {body}")]
  Rejected { status: u16, body: String },
  #[error("The response status is unexpected: {status}")]
  UnexpectedStatus { status: u16 },
  #[error("The response is invalid: {0}")]
  InvalidResponse(String),
  #[error("The transport failed: {0}")]
  Transport(String),
}
