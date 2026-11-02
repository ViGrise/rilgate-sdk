use rilgate_client::{
  CancellationToken,
  solve::{solve_fast, solve_hashwx},
};

#[test]
fn fast_solutions_pass_the_gateway_verifier() {
  for difficulty in 1..=4 {
    let challenge = "test-challenge";
    let nonce = solve_fast(challenge, difficulty, &CancellationToken::new()).unwrap();
    assert!(
      rilgate_pow_hash::sha256::verifier::verify_fast(challenge, &nonce.to_string(), difficulty)
        .unwrap()
    );
  }
}

#[test]
fn hashwx_solution_passes_the_gateway_verifier() {
  let challenge = "ab".repeat(32);
  let nonce = solve_hashwx(
    &challenge,
    64,
    463,
    i64::MAX,
    &CancellationToken::new(),
    || 0,
  )
  .unwrap();
  let mut bytes = [0; 32];
  hex::decode_to_slice(challenge, &mut bytes).unwrap();
  let seed = rilgate_pow_hashwx::proof::seed(&bytes, nonce / 463);
  assert!(hashwx_core::HashWx::new(&seed).hash(nonce) < u64::MAX / 64);
}
