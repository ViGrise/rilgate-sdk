# Rilgate Swift and Kotlin bindings

`rilgate-client-ffi` exposes the blocking Rust client through UniFFI. See the
[core client](../rilgate-client/README.md) for supported algorithms, the request
flow, transport requirements, and cancellation.

## Generate bindings

Run these commands at the repository root with the stable Rust toolchain:

```sh
scripts/generate-bindings.sh
```

The script builds the host shared library and writes Swift files to
`target/bindings/swift` and Kotlin files to `target/bindings/kotlin`.
The Swift module is `RilgateClient`. The Kotlin package is
`com.vigrise.rilgate.client`.

Build the Rust library for each application target and add the generated source
and library to the application build. XCFramework, SwiftPM, Android AAR, Maven,
and publishing are outside this repository's scope.

## Swift transport

Use the same cookie storage, User-Agent, and proxy configuration as the
application. The delegate disables redirects. This synchronous wrapper must run
off the UI thread. Keep the URLSession callback queue free while it waits.

```swift
import Foundation
import RilgateClient

final class RilgateRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

// The semaphore publishes the response before the waiting thread reads it.
private final class RilgateResponseSlot: @unchecked Sendable {
    let ready = DispatchSemaphore(value: 0)
    var result: Result<HttpResponse, Error>?
}

final class RilgateHttpTransport: HttpTransport {
    private let session: URLSession

    init(configuration: URLSessionConfiguration) {
        session = URLSession(configuration: configuration, delegate: RilgateRedirectDelegate(),
                             delegateQueue: nil)
    }

    func send(request: HttpRequest) throws -> HttpResponse {
        guard let url = URL(string: request.url) else {
            throw TransportError.Failed(message: "Invalid request URL.")
        }
        var outgoing = URLRequest(url: url)
        outgoing.httpMethod = request.method
        outgoing.httpBody = request.body
        for header in request.headers {
            outgoing.addValue(header.value, forHTTPHeaderField: header.name)
        }
        let slot = RilgateResponseSlot()
        session.dataTask(with: outgoing) { data, response, error in
            defer { slot.ready.signal() }
            if let error = error {
                slot.result = .failure(TransportError.Failed(message: error.localizedDescription))
                return
            }
            guard let response = response as? HTTPURLResponse else {
                slot.result = .failure(TransportError.Failed(message: "Missing HTTP response."))
                return
            }
            let headers = response.allHeaderFields.map {
                HttpHeader(name: String(describing: $0.key), value: String(describing: $0.value))
            }
            slot.result = .success(HttpResponse(status: UInt16(response.statusCode),
                                           headers: headers, body: data ?? Data()))
        }.resume()
        slot.ready.wait()
        guard let result = slot.result else {
            throw TransportError.Failed(message: "Missing transport result.")
        }
        return try result.get()
    }
}

let configuration = URLSessionConfiguration.default
configuration.httpCookieStorage = HTTPCookieStorage.shared
configuration.httpAdditionalHeaders = ["User-Agent": "example-native-client"]
let client = try RilgateClient(transport: RilgateHttpTransport(configuration: configuration), brandId: nil)
let cancel = CancellationToken()
// Call detect and solve on a background thread with the intercepted response.
```

URLSession stores response cookies in the configured storage. Its header map can
combine repeated header fields. Preserve each `Set-Cookie` value when an HTTP
stack exposes separate values. Keep the cookie jar active for the retry.

## Kotlin transport

Use an application OkHttp client with its cookie jar and network settings.
The wrapper disables HTTP and HTTPS redirects. Run it on a background thread.

```kotlin
import com.vigrise.rilgate.client.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class RilgateHttpTransport(applicationClient: OkHttpClient) : HttpTransport {
    private val http = applicationClient.newBuilder()
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    override fun send(request: HttpRequest): HttpResponse {
        try {
            val builder = Request.Builder().url(request.url)
            request.headers.forEach { builder.addHeader(it.name, it.value) }
            val body = if (request.method == "GET" || request.method == "HEAD") null
                       else request.body.toRequestBody()
            http.newCall(builder.method(request.method, body).build()).execute().use { response ->
                val headers = (0 until response.headers.size).map {
                    HttpHeader(response.headers.name(it), response.headers.value(it))
                }
                return HttpResponse(response.code.toUShort(), headers,
                                    response.body?.bytes() ?: byteArrayOf())
            }
        } catch (error: Exception) {
            throw TransportException.Failed(error.message ?: "Transport failed.")
        }
    }
}

fun makeClient(applicationClient: OkHttpClient): RilgateClient =
    RilgateClient(RilgateHttpTransport(applicationClient), null)
```

The application client must send its usual User-Agent and store cookies.
Pass a `CancellationToken` to `solve`. Call `cancel` from another thread when the
application stops waiting. Store returned cookie values if the transport has no
cookie jar, then retry the intercepted request.
