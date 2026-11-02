use crate::{
  CancellationToken, Challenge, DEFAULT_BRAND_ID, Error, HttpTransport,
  api::{self, Work},
  brand_names,
  solve::{solve_fast, solve_hashwx},
};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct ClientOptions {
  pub brand_id: String,
}
impl Default for ClientOptions {
  fn default() -> Self {
    Self {
      brand_id: DEFAULT_BRAND_ID.into(),
    }
  }
}

pub struct Solution {
  pub set_cookie: Vec<String>,
  pub receipt: String,
  pub algorithm: String,
}

pub struct RilgateClient<T: HttpTransport> {
  transport: T,
  brand_id: String,
}
impl<T: HttpTransport> RilgateClient<T> {
  pub fn new(transport: T, options: ClientOptions) -> Result<Self, Error> {
    brand_names(&options.brand_id)?;
    Ok(Self {
      transport,
      brand_id: options.brand_id,
    })
  }

  pub fn detect(
    &self,
    request_url: &str,
    headers: &[(String, String)],
  ) -> Result<Option<Challenge>, Error> {
    Challenge::from_response(request_url, headers, &self.brand_id)
  }

  /// Blocks until the proof is accepted and the access cookie is set. Call off the UI thread.
  pub fn solve(
    &self,
    challenge: &Challenge,
    cancel: &CancellationToken,
  ) -> Result<Solution, Error> {
    let work = api::challenge(&self.transport, challenge, cancel)?;
    let (algorithm, token, nonce) = match work {
      Work::Fast {
        challenge_token,
        challenge,
        difficulty,
      } => (
        "fast",
        challenge_token,
        solve_fast(&challenge, difficulty, cancel)?,
      ),
      Work::Hashwx {
        challenge_token,
        challenge,
        difficulty,
        nonces_per_seed,
        expires_at,
      } => {
        let nonce = solve_hashwx(
          &challenge,
          difficulty,
          nonces_per_seed,
          expires_at,
          cancel,
          || {
            SystemTime::now()
              .duration_since(UNIX_EPOCH)
              .map_or(0, |duration| duration.as_secs() as i64)
          },
        )?;
        ("hashwx", challenge_token, nonce)
      }
    };
    let (verification, cookies) = api::verify(&self.transport, challenge, &token, nonce, cancel)?;
    let set_cookie = if verification.cookie_set == Some(true) {
      cookies
    } else {
      api::exchange(&self.transport, challenge, &verification.receipt, cancel)?
    };
    Ok(Solution {
      set_cookie,
      receipt: verification.receipt,
      algorithm: algorithm.into(),
    })
  }
}
