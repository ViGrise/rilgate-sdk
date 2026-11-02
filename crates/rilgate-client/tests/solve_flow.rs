use rilgate_client::{
  CancellationToken, Challenge, ClientOptions, Error, HttpRequest, HttpResponse, HttpTransport,
  RilgateClient, TransportError,
};
use serde_json::{Value, json};
use std::{
  collections::VecDeque,
  sync::{Arc, Mutex},
};

#[derive(Clone)]
struct FakeTransport {
  requests: Arc<Mutex<Vec<HttpRequest>>>,
  responses: Arc<Mutex<VecDeque<HttpResponse>>>,
}
impl HttpTransport for FakeTransport {
  fn send(&self, request: HttpRequest) -> Result<HttpResponse, TransportError> {
    self.requests.lock().unwrap().push(request);
    Ok(
      self
        .responses
        .lock()
        .unwrap()
        .pop_front()
        .expect("A scripted response is available"),
    )
  }
}
fn response(body: Value, headers: Vec<(String, String)>) -> HttpResponse {
  HttpResponse {
    status: 200,
    headers,
    body: serde_json::to_vec(&body).unwrap(),
  }
}
fn work() -> HttpResponse {
  response(
    json!({"algorithm":"fast", "challenge_token":"work-token", "challenge":"test", "difficulty":1}),
    vec![],
  )
}
fn setup(responses: Vec<HttpResponse>) -> (RilgateClient<FakeTransport>, FakeTransport, Challenge) {
  let transport = FakeTransport {
    requests: Arc::default(),
    responses: Arc::new(Mutex::new(responses.into())),
  };
  let client = RilgateClient::new(transport.clone(), ClientOptions::default()).unwrap();
  let challenge = client
    .detect(
      "https://example.com/resource",
      &[
        ("rilgate-challenge".into(), "required".into()),
        (
          "rilgate-challenge-url".into(),
          "/proof/challenge?presentation_token=presentation".into(),
        ),
      ],
    )
    .unwrap()
    .unwrap();
  (client, transport, challenge)
}
fn body(request: &HttpRequest) -> Value {
  serde_json::from_slice(&request.body).unwrap()
}

#[test]
fn verify_sets_the_cookie_without_exchange() {
  let cookies = vec![
    ("Set-Cookie".into(), "access=secret; Secure".into()),
    ("set-cookie".into(), "other=value; Secure".into()),
  ];
  let (client, transport, challenge) = setup(vec![
    work(),
    response(json!({"receipt":"receipt", "cookie_set":true}), cookies),
  ]);
  let solution = client.solve(&challenge, &CancellationToken::new()).unwrap();
  assert_eq!(solution.algorithm, "fast");
  assert_eq!(solution.receipt, "receipt");
  assert_eq!(
    solution.set_cookie,
    ["access=secret; Secure", "other=value; Secure"]
  );
  let requests = transport.requests.lock().unwrap();
  assert_eq!(requests.len(), 2);
  assert_eq!(requests[0].url, "https://example.com/proof/api/challenge");
  assert_eq!(
    body(&requests[0]),
    json!({"presentation_token":"presentation"})
  );
  assert_eq!(requests[1].url, "https://example.com/proof/api/verify");
  let verify = body(&requests[1]);
  assert_eq!(verify["set_cookie"], true);
  assert_eq!(verify["challenge_token"], "work-token");
  assert!(
    rilgate_pow_hash::sha256::verifier::verify_fast("test", verify["nonce"].as_str().unwrap(), 1)
      .unwrap()
  );
  for request in requests.iter() {
    assert_eq!(request.method, "POST");
    assert!(
      request
        .headers
        .contains(&("accept".into(), "application/json".into()))
    );
    assert!(
      request
        .headers
        .contains(&("content-type".into(), "application/json".into()))
    );
  }
}

#[test]
fn missing_cookie_set_exchanges_the_receipt() {
  let (client, transport, challenge) = setup(vec![
    work(),
    response(json!({"receipt":"receipt"}), vec![]),
    response(
      json!({"status":"ok"}),
      vec![("Set-Cookie".into(), "access=exchanged; Secure".into())],
    ),
  ]);
  let solution = client.solve(&challenge, &CancellationToken::new()).unwrap();
  assert_eq!(solution.set_cookie, ["access=exchanged; Secure"]);
  let requests = transport.requests.lock().unwrap();
  assert_eq!(requests.len(), 3);
  assert_eq!(requests[2].url, "https://example.com/proof/api/exchange");
  assert_eq!(body(&requests[2]), json!({"receipt":"receipt"}));
}

#[test]
fn randomx_is_rejected_without_verification() {
  let (client, transport, challenge) =
    setup(vec![response(json!({"algorithm":"randomx"}), vec![])]);
  assert!(
    matches!(client.solve(&challenge, &CancellationToken::new()), Err(Error::UnsupportedAlgorithm(tag)) if tag == "randomx")
  );
  assert_eq!(transport.requests.lock().unwrap().len(), 1);
}

#[test]
fn rate_limit_preserves_retry_after() {
  let (client, transport, challenge) = setup(vec![HttpResponse {
    status: 429,
    headers: vec![("Retry-After".into(), "7".into())],
    body: vec![],
  }]);
  assert!(matches!(
    client.solve(&challenge, &CancellationToken::new()),
    Err(Error::RateLimited {
      retry_after_seconds: Some(7)
    })
  ));
  assert_eq!(transport.requests.lock().unwrap().len(), 1);
}

#[test]
fn cancellation_stops_before_the_first_request() {
  let (client, transport, challenge) = setup(vec![]);
  let cancel = CancellationToken::new();
  cancel.cancel();
  assert!(matches!(
    client.solve(&challenge, &cancel),
    Err(Error::Cancelled)
  ));
  assert!(transport.requests.lock().unwrap().is_empty());
}
