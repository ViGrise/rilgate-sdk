use crate::{CancellationToken, Error};
use sha2::{Digest, Sha256};

pub fn solve_fast(
  challenge: &str,
  difficulty: u64,
  cancel: &CancellationToken,
) -> Result<u64, Error> {
  if !(1..=64).contains(&difficulty) {
    return Err(Error::InvalidChallenge(
      "The difficulty must be between 1 and 64.".into(),
    ));
  }
  for nonce in 0u64..=u64::MAX {
    if nonce.is_multiple_of(4096) {
      cancel.check()?;
    }
    let mut hash = Sha256::new();
    hash.update(challenge.as_bytes());
    hash.update(nonce.to_string().as_bytes());
    let hash = hash.finalize();
    let full_bytes = (difficulty / 2) as usize;
    if hash[..full_bytes].iter().all(|b| *b == 0)
      && (difficulty.is_multiple_of(2) || hash[full_bytes] & 0xf0 == 0)
    {
      return Ok(nonce);
    }
  }
  Err(Error::InvalidChallenge(
    "The nonce range is exhausted.".into(),
  ))
}
