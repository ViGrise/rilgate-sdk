use rilgate_client::{Challenge, Error};

#[test]
fn headers_follow_the_brand_and_ignore_case() {
  let headers = vec![
    ("RiLgAtE-ChAlLeNgE".into(), " ReQuIrEd ".into()),
    (
      "RILGATE-CHALLENGE-URL".into(),
      "/proof/challenge?presentation_token=test".into(),
    ),
  ];
  assert!(
    Challenge::from_response("https://example.com/api", &headers, "rilgate")
      .unwrap()
      .is_some()
  );
  assert!(
    Challenge::from_response("https://example.com/api", &headers, "vigrise")
      .unwrap()
      .is_none()
  );
  let headers = vec![
    ("ViGrise-Challenge".into(), "required".into()),
    (
      "VIGRISE-Challenge-Url".into(),
      "/proof/challenge?presentation_token=test".into(),
    ),
  ];
  assert!(
    Challenge::from_response("https://example.com/api", &headers, "vigrise")
      .unwrap()
      .is_some()
  );
}

#[test]
fn cross_origin_challenge_is_rejected() {
  let headers = vec![
    ("rilgate-challenge".into(), "required".into()),
    (
      "rilgate-challenge-url".into(),
      "https://other.example/challenge?presentation_token=test".into(),
    ),
  ];
  assert!(matches!(
    Challenge::from_response("https://example.com/", &headers, "rilgate"),
    Err(Error::InvalidChallenge(_))
  ));
}

#[test]
fn relative_url_decodes_the_token_and_extracts_the_base_path() {
  let headers = vec![
    ("Rilgate-Challenge".into(), "required".into()),
    (
      "Rilgate-Challenge-Url".into(),
      "../.well-known/rilgate/challenge?presentation_token=a%2Bb%2Fc%3D".into(),
    ),
  ];
  let challenge = Challenge::from_response("https://example.com/api/data", &headers, "rilgate")
    .unwrap()
    .unwrap();
  assert_eq!(challenge.origin.as_str(), "https://example.com/");
  assert_eq!(challenge.base_path, "/.well-known/rilgate");
  assert_eq!(challenge.presentation_token, "a+b/c=");
  assert_eq!(
    challenge.challenge_url.path(),
    "/.well-known/rilgate/challenge"
  );
}
