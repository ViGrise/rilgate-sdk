use rilgate_client as core;
use std::sync::Arc;

uniffi::setup_scaffolding!();

#[derive(uniffi::Record)]
pub struct HttpHeader {
  pub name: String,
  pub value: String,
}
#[derive(uniffi::Record)]
pub struct HttpRequest {
  pub method: String,
  pub url: String,
  pub headers: Vec<HttpHeader>,
  pub body: Vec<u8>,
}
#[derive(uniffi::Record)]
pub struct HttpResponse {
  pub status: u16,
  pub headers: Vec<HttpHeader>,
  pub body: Vec<u8>,
}

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum TransportError {
  #[error("The transport failed: {message}")]
  Failed { message: String },
}

#[uniffi::export(with_foreign)]
pub trait HttpTransport: Send + Sync {
  fn send(&self, request: HttpRequest) -> Result<HttpResponse, TransportError>;
}

struct ForeignTransport(Arc<dyn HttpTransport>);
impl core::HttpTransport for ForeignTransport {
  fn send(&self, request: core::HttpRequest) -> Result<core::HttpResponse, core::TransportError> {
    let response = self
      .0
      .send(HttpRequest {
        method: request.method,
        url: request.url,
        body: request.body,
        headers: request
          .headers
          .into_iter()
          .map(|(name, value)| HttpHeader { name, value })
          .collect(),
      })
      .map_err(|TransportError::Failed { message }| core::TransportError { message })?;
    Ok(core::HttpResponse {
      status: response.status,
      headers: response
        .headers
        .into_iter()
        .map(|h| (h.name, h.value))
        .collect(),
      body: response.body,
    })
  }
}

#[derive(uniffi::Record)]
pub struct Challenge {
  pub origin: String,
  pub base_path: String,
  pub presentation_token: String,
  pub challenge_url: String,
}
impl From<core::Challenge> for Challenge {
  fn from(value: core::Challenge) -> Self {
    Self {
      origin: value.origin.into(),
      base_path: value.base_path,
      presentation_token: value.presentation_token,
      challenge_url: value.challenge_url.into(),
    }
  }
}

#[derive(uniffi::Record)]
pub struct Solution {
  pub set_cookie: Vec<String>,
  pub receipt: String,
  pub algorithm: String,
}

#[derive(uniffi::Object, Default)]
pub struct CancellationToken(core::CancellationToken);
#[uniffi::export]
impl CancellationToken {
  #[uniffi::constructor]
  pub fn new() -> Arc<Self> {
    Arc::new(Self::default())
  }
  pub fn cancel(&self) {
    self.0.cancel();
  }
  pub fn is_cancelled(&self) -> bool {
    self.0.is_cancelled()
  }
}

#[derive(uniffi::Object)]
pub struct RilgateClient {
  client: core::RilgateClient<ForeignTransport>,
}
#[uniffi::export]
impl RilgateClient {
  #[uniffi::constructor]
  pub fn new(
    transport: Arc<dyn HttpTransport>,
    brand_id: Option<String>,
  ) -> Result<Arc<Self>, RilgateError> {
    let options = core::ClientOptions {
      brand_id: brand_id.unwrap_or_else(|| core::DEFAULT_BRAND_ID.into()),
    };
    Ok(Arc::new(Self {
      client: core::RilgateClient::new(ForeignTransport(transport), options)?,
    }))
  }
  pub fn detect(
    &self,
    request_url: String,
    headers: Vec<HttpHeader>,
  ) -> Result<Option<Challenge>, RilgateError> {
    let headers: Vec<_> = headers.into_iter().map(|h| (h.name, h.value)).collect();
    Ok(self.client.detect(&request_url, &headers)?.map(Into::into))
  }
  pub fn solve(
    &self,
    challenge: Challenge,
    cancel: Arc<CancellationToken>,
  ) -> Result<Solution, RilgateError> {
    let challenge = core::Challenge {
      origin: challenge
        .origin
        .parse()
        .map_err(|e| RilgateError::InvalidChallenge {
          message: format!("{e}"),
        })?,
      base_path: challenge.base_path,
      presentation_token: challenge.presentation_token,
      challenge_url: challenge.challenge_url.parse().map_err(|e| {
        RilgateError::InvalidChallenge {
          message: format!("{e}"),
        }
      })?,
    };
    let solution = self.client.solve(&challenge, &cancel.0)?;
    Ok(Solution {
      set_cookie: solution.set_cookie,
      receipt: solution.receipt,
      algorithm: solution.algorithm,
    })
  }
}

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum RilgateError {
  #[error("The brand identifier is invalid.")]
  InvalidBrandId,
  #[error("The challenge is invalid: {message}")]
  InvalidChallenge { message: String },
  #[error("The algorithm is unsupported: {message}")]
  UnsupportedAlgorithm { message: String },
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
  #[error("The response is invalid: {message}")]
  InvalidResponse { message: String },
  #[error("The transport failed: {message}")]
  Transport { message: String },
}

impl From<core::Error> for RilgateError {
  fn from(error: core::Error) -> Self {
    match error {
      core::Error::InvalidBrandId => Self::InvalidBrandId,
      core::Error::InvalidChallenge(message) => Self::InvalidChallenge { message },
      core::Error::UnsupportedAlgorithm(message) => Self::UnsupportedAlgorithm { message },
      core::Error::ChallengeExpired => Self::ChallengeExpired,
      core::Error::Cancelled => Self::Cancelled,
      core::Error::RateLimited {
        retry_after_seconds,
      } => Self::RateLimited {
        retry_after_seconds,
      },
      core::Error::WorkUnavailable {
        retry_after_seconds,
      } => Self::WorkUnavailable {
        retry_after_seconds,
      },
      core::Error::Rejected { status, body } => Self::Rejected { status, body },
      core::Error::UnexpectedStatus { status } => Self::UnexpectedStatus { status },
      core::Error::InvalidResponse(message) => Self::InvalidResponse { message },
      core::Error::Transport(message) => Self::Transport { message },
    }
  }
}
