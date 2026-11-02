use rilgate_client::{
  CancellationToken, ClientOptions, HttpRequest, HttpTransport, RilgateClient,
  transport::reqwest::ReqwestTransport,
};

fn main() {
  if let Err(error) = run() {
    eprintln!("{error}");
    std::process::exit(1);
  }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
  let mut args = std::env::args().skip(1);
  let url = args
    .next()
    .ok_or("Usage: solve <url> [--brand-id <id>] [--user-agent <ua>]")?;
  let mut options = ClientOptions::default();
  let mut user_agent = "rilgate-client-example".to_owned();
  while let Some(option) = args.next() {
    let value = args.next().ok_or("An option value is missing.")?;
    match option.as_str() {
      "--brand-id" => options.brand_id = value,
      "--user-agent" => user_agent = value,
      _ => return Err(format!("Unknown option: {option}").into()),
    }
  }
  let transport = ReqwestTransport::new(&user_agent)?;
  let get = |cookie: Option<String>| {
    let mut headers = vec![("accept".into(), "application/json".into())];
    if let Some(cookie) = cookie {
      headers.push(("cookie".into(), cookie));
    }
    transport.send(HttpRequest {
      method: "GET".into(),
      url: url.clone(),
      headers,
      body: vec![],
    })
  };
  let client = RilgateClient::new(ReqwestTransport::new(&user_agent)?, options)?;
  let response = get(None)?;
  if let Some(challenge) = client.detect(&url, &response.headers)? {
    let solution = client.solve(&challenge, &CancellationToken::new())?;
    let pairs: Vec<_> = solution
      .set_cookie
      .iter()
      .filter_map(|cookie| cookie.split(';').next())
      .collect();
    let names: Vec<_> = pairs
      .iter()
      .filter_map(|pair| pair.split_once('=').map(|(name, _)| name))
      .collect();
    println!(
      "Algorithm: {}. Cookie names: {}",
      solution.algorithm,
      names.join(", ")
    );
    println!("Status: {}", get(Some(pairs.join("; ")))?.status);
  } else {
    println!("Status: {}", response.status);
  }
  Ok(())
}
