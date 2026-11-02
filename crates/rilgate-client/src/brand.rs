use crate::Error;

pub const DEFAULT_BRAND_ID: &str = "rilgate";

pub struct BrandNames {
  pub challenge_header: String,
  pub challenge_url_header: String,
}

pub fn brand_names(brand_id: &str) -> Result<BrandNames, Error> {
  if !(1..=32).contains(&brand_id.len())
    || !brand_id.as_bytes()[0].is_ascii_lowercase()
    || brand_id.ends_with('-')
    || !brand_id
      .bytes()
      .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
  {
    return Err(Error::InvalidBrandId);
  }
  Ok(BrandNames {
    challenge_header: format!("{brand_id}-challenge"),
    challenge_url_header: format!("{brand_id}-challenge-url"),
  })
}
