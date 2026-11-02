# Rilgate Rust client

`rilgate-client` detects and solves gateway challenges with a blocking Rust API.
It supports `fast` and `hashwx`. It returns `Error::UnsupportedAlgorithm(tag)` for
`refresh`, `randomx`, and other algorithm tags.

## Request flow

1. Send the application request with `Accept: application/json`.
2. Call `detect` with the request URL and response headers.
3. If there is a challenge, call `solve`.
4. Store each `Solution.set_cookie` value in the application cookie jar.
5. Retry the application request with the access cookie.

The client requests work, solves it, and verifies it with `set_cookie: true`.
If verification does not confirm the cookie, the client exchanges the receipt.
The solution contains the receipt, algorithm, and all `Set-Cookie` values from
the response that sets the cookie.

## Transport

Implement `HttpTransport` with the application's HTTP stack. Send each request
with redirects disabled. Use the same User-Agent, client IP, proxy settings, and
cookie jar as the application request. The gateway binds the access cookie to
the User-Agent and client IP. A change to either can require another challenge.

The optional `reqwest` feature supplies `ReqwestTransport`. It has no cookie jar.
Store returned cookies and attach them to later requests in the application.
The CLI example shows this for a single request origin.

```rust,no_run
use rilgate_client::{
    CancellationToken, ClientOptions, Error, RilgateClient,
    transport::reqwest::ReqwestTransport,
};

fn solve_response(
    request_url: &str,
    headers: &[(String, String)],
) -> Result<Vec<String>, Error> {
    let transport = ReqwestTransport::new("example-native-client")?;
    let client = RilgateClient::new(transport, ClientOptions::default())?;
    let cancel = CancellationToken::new();
    if let Some(challenge) = client.detect(request_url, headers)? {
        return Ok(client.solve(&challenge, &cancel)?.set_cookie);
    }
    Ok(Vec::new())
}
```

Set `ClientOptions.brand_id` to the gateway's `site.brand_id` when it differs
from `rilgate`. Detection compares header names without case and rejects a
challenge URL with a different origin.

## Threads and cancellation

`solve` blocks. Call it off the UI thread. Clone a `CancellationToken` and call
`cancel` from another thread to stop work. The client checks cancellation before
each HTTP request and at fixed intervals during solving. An active HTTP request
finishes through the application transport. Configure its network timeouts there.
A cancelled operation returns `Error::Cancelled`. Expired HashWX work returns
`Error::ChallengeExpired`.

## Development

```sh
cargo run -p rilgate-client --features reqwest --example solve -- https://example.com/ --brand-id rilgate --user-agent example-native-client
```

The example prints the algorithm, cookie names, and final response status.
It keeps cookie values out of its output.
