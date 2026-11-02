use super::{HttpRequest, HttpResponse, HttpTransport, TransportError};
use crate::Error;

pub struct ReqwestTransport {
  client: ::reqwest::blocking::Client,
}

impl ReqwestTransport {
  pub fn new(user_agent: &str) -> Result<Self, Error> {
    let client = ::reqwest::blocking::Client::builder()
      .redirect(::reqwest::redirect::Policy::none())
      .user_agent(user_agent)
      .build()
      .map_err(|e| Error::Transport(e.to_string()))?;
    Ok(Self { client })
  }
}

impl HttpTransport for ReqwestTransport {
  fn send(&self, request: HttpRequest) -> Result<HttpResponse, TransportError> {
    let failed = |e: String| TransportError { message: e };
    let method = request
      .method
      .parse::<::reqwest::Method>()
      .map_err(|e| failed(e.to_string()))?;
    let mut builder = self.client.request(method, request.url);
    for (name, value) in request.headers {
      builder = builder.header(name, value);
    }
    let response = builder
      .body(request.body)
      .send()
      .map_err(|e| failed(e.to_string()))?;
    let status = response.status().as_u16();
    let headers = response
      .headers()
      .iter()
      .map(|(name, value)| {
        Ok((
          name.to_string(),
          value
            .to_str()
            .map_err(|e| failed(e.to_string()))?
            .to_owned(),
        ))
      })
      .collect::<Result<_, TransportError>>()?;
    let body = response
      .bytes()
      .map_err(|e| failed(e.to_string()))?
      .to_vec();
    Ok(HttpResponse {
      status,
      headers,
      body,
    })
  }
}
