use crate::{CancellationToken, Error};
use sha2::{Digest, Sha256};

pub fn solve_hashwx(
  challenge_hex: &str,
  difficulty: u64,
  nonces_per_seed: u32,
  expires_at: i64,
  cancel: &CancellationToken,
  now: impl Fn() -> i64,
) -> Result<u64, Error> {
  if challenge_hex.len() != 64
    || !challenge_hex
      .bytes()
      .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    || difficulty == 0
    || nonces_per_seed == 0
  {
    return Err(Error::InvalidChallenge(
      "The HashWX parameters are invalid.".into(),
    ));
  }
  let mut challenge = [0; 32];
  hex::decode_to_slice(challenge_hex, &mut challenge)
    .map_err(|e| Error::InvalidChallenge(e.to_string()))?;
  let target = u64::MAX / difficulty;
  let mut nonce = 0u64;
  loop {
    let batch = nonce / u64::from(nonces_per_seed);
    let mut seed = Sha256::new();
    seed.update(challenge);
    seed.update(batch.to_le_bytes());
    let mut hashwx = hashwx_core::HashWx::new(&seed.finalize().into());
    loop {
      if nonce.is_multiple_of(1024) {
        cancel.check()?;
        if now() >= expires_at {
          return Err(Error::ChallengeExpired);
        }
      }
      if hashwx.hash(nonce) < target {
        return Ok(nonce);
      }
      nonce = nonce
        .checked_add(1)
        .ok_or_else(|| Error::InvalidChallenge("The nonce range is exhausted.".into()))?;
      if nonce / u64::from(nonces_per_seed) != batch {
        break;
      }
    }
  }
}
