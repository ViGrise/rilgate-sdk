use crate::{CancellationToken, Challenge, Error, HttpRequest, HttpResponse, HttpTransport};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(tag = "algorithm", rename_all = "snake_case")]
pub(crate) enum Work {
  Fast {
    challenge_token: String,
    challenge: String,
    difficulty: u64,
  },
  Hashwx {
    challenge_token: String,
    challenge: String,
    difficulty: u64,
    nonces_per_seed: u32,
    expires_at: i64,
  },
}

#[derive(Deserialize)]
pub(crate) struct Verification {
  pub receipt: String,
  pub cookie_set: Option<bool>,
}

#[derive(Deserialize)]
struct Exchange {
  status: String,
}

fn post<T: DeserializeOwned>(
  transport: &impl HttpTransport,
  challenge: &Challenge,
  endpoint: &str,
  body: Value,
  cancel: &CancellationToken,
) -> Result<(T, Vec<String>), Error> {
  let mut url = challenge.origin.clone();
  url.set_path(&format!("{}{endpoint}", challenge.base_path));
  url.set_query(None);
  url.set_fragment(None);
  let request = HttpRequest {
    method: "POST".into(),
    url: url.into(),
    headers: vec![
      ("accept".into(), "application/json".into()),
      ("content-type".into(), "application/json".into()),
    ],
    body: serde_json::to_vec(&body).map_err(|e| Error::InvalidResponse(e.to_string()))?,
  };
  cancel.check()?;
  let response = transport
    .send(request)
    .map_err(|e| Error::Transport(e.message))?;
  check_status(&response)?;
  let value =
    serde_json::from_slice(&response.body).map_err(|e| Error::InvalidResponse(e.to_string()))?;
  let cookies = response
    .headers
    .into_iter()
    .filter(|(name, _)| name.eq_ignore_ascii_case("set-cookie"))
    .map(|(_, value)| value)
    .collect();
  Ok((value, cookies))
}

fn check_status(response: &HttpResponse) -> Result<(), Error> {
  let retry_after_seconds = response
    .headers
    .iter()
    .find(|(name, _)| name.eq_ignore_ascii_case("retry-after"))
    .and_then(|(_, value)| value.trim().parse().ok());
  match response.status {
    200..=299 => Ok(()),
    429 => Err(Error::RateLimited {
      retry_after_seconds,
    }),
    503 => Err(Error::WorkUnavailable {
      retry_after_seconds,
    }),
    400 | 401 => {
      let mut body =
        String::from_utf8_lossy(&response.body[..response.body.len().min(1024)]).into_owned();
      let mut end = body.len().min(1024);
      while !body.is_char_boundary(end) {
        end -= 1;
      }
      body.truncate(end);
      Err(Error::Rejected {
        status: response.status,
        body,
      })
    }
    status => Err(Error::UnexpectedStatus { status }),
  }
}

pub(crate) fn challenge(
  transport: &impl HttpTransport,
  challenge: &Challenge,
  cancel: &CancellationToken,
) -> Result<Work, Error> {
  let (value, _) = post::<Value>(
    transport,
    challenge,
    "/api/challenge",
    json!({"presentation_token": challenge.presentation_token}),
    cancel,
  )?;
  let tag = value
    .get("algorithm")
    .and_then(Value::as_str)
    .ok_or_else(|| Error::InvalidResponse("The algorithm tag is missing.".into()))?;
  if !matches!(tag, "fast" | "hashwx") {
    return Err(Error::UnsupportedAlgorithm(tag.into()));
  }
  serde_json::from_value(value).map_err(|e| Error::InvalidResponse(e.to_string()))
}

pub(crate) fn verify(
  transport: &impl HttpTransport,
  challenge: &Challenge,
  challenge_token: &str,
  nonce: u64,
  cancel: &CancellationToken,
) -> Result<(Verification, Vec<String>), Error> {
  post(
    transport,
    challenge,
    "/api/verify",
    json!({"challenge_token": challenge_token, "nonce": nonce.to_string(), "set_cookie": true}),
    cancel,
  )
}

pub(crate) fn exchange(
  transport: &impl HttpTransport,
  challenge: &Challenge,
  receipt: &str,
  cancel: &CancellationToken,
) -> Result<Vec<String>, Error> {
  let (response, cookies) = post::<Exchange>(
    transport,
    challenge,
    "/api/exchange",
    json!({"receipt": receipt}),
    cancel,
  )?;
  if response.status != "ok" {
    return Err(Error::InvalidResponse(
      "The exchange status is invalid.".into(),
    ));
  }
  Ok(cookies)
}
