use crate::{Error, brand_names};
use url::Url;

#[derive(Clone, Debug)]
pub struct Challenge {
  pub origin: Url,
  pub base_path: String,
  pub presentation_token: String,
  pub challenge_url: Url,
}

impl Challenge {
  /// Returns a challenge when the response headers announce one.
  pub fn from_response(
    request_url: &str,
    headers: &[(String, String)],
    brand_id: &str,
  ) -> Result<Option<Self>, Error> {
    let names = brand_names(brand_id)?;
    let header = |name: &str| {
      headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
    };
    if !header(&names.challenge_header).is_some_and(|v| v.trim().eq_ignore_ascii_case("required")) {
      return Ok(None);
    }
    let invalid = |message: &str| Error::InvalidChallenge(message.into());
    let request = Url::parse(request_url).map_err(|e| invalid(&e.to_string()))?;
    if !matches!(request.scheme(), "http" | "https") || request.host_str().is_none() {
      return Err(invalid("The request URL must use HTTP or HTTPS."));
    }
    let challenge_url = request
      .join(
        header(&names.challenge_url_header)
          .ok_or_else(|| invalid("The challenge URL is missing."))?,
      )
      .map_err(|e| invalid(&e.to_string()))?;
    if challenge_url.origin() != request.origin() {
      return Err(invalid("The challenge URL has a different origin."));
    }
    let base_path = challenge_url
      .path()
      .strip_suffix("/challenge")
      .ok_or_else(|| invalid("The challenge URL path is invalid."))?
      .to_owned();
    let presentation_token = challenge_url
      .query_pairs()
      .find(|(name, _)| name == "presentation_token")
      .map(|(_, value)| value.into_owned())
      .filter(|value| !value.is_empty())
      .ok_or_else(|| invalid("The presentation token is missing."))?;
    let origin = Url::parse(&format!("{}/", request.origin().ascii_serialization()))
      .map_err(|e| invalid(&e.to_string()))?;
    Ok(Some(Self {
      origin,
      base_path,
      presentation_token,
      challenge_url,
    }))
  }
}
