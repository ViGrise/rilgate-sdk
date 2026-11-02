#[cfg(feature = "reqwest")]
pub mod reqwest;

pub struct HttpRequest {
  pub method: String,
  pub url: String,
  pub headers: Vec<(String, String)>,
  pub body: Vec<u8>,
}

pub struct HttpResponse {
  pub status: u16,
  pub headers: Vec<(String, String)>,
  pub body: Vec<u8>,
}

pub trait HttpTransport: Send + Sync {
  /// Sends one request without following redirects.
  /// The application supplies its usual User-Agent and stores `Set-Cookie` values.
  fn send(&self, request: HttpRequest) -> Result<HttpResponse, TransportError>;
}

#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct TransportError {
  pub message: String,
}
