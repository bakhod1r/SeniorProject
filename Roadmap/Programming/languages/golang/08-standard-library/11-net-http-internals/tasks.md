# 8.11 `net/http` Internals — Tasks

> Hands-on exercises with explicit acceptance criteria. Do them with
> the standard library only unless a task says otherwise. After each
> one, ask whether the same code would survive the failure modes in
> [find-bug.md](find-bug.md).

## 1. Minimal JSON API server

Build a server with the following endpoints, using only `net/http`:

```
GET  /healthz
POST /users         body: {"name":"..."}
GET  /users/{id}
DELETE /users/{id}
```

Acceptance:

- All five `http.Server` timeouts set explicitly.
- Body cap of 64 KiB on POST via `MaxBytesReader`.
- Returns `{"error":"..."}` JSON on every error path.
- POST returns `201 Created` with `Location: /users/{id}` header.
- `GET /users/42` and `GET /users/abc` both work; the server returns
  404 for unknown IDs.
- `DELETE /users/{id}` returns 204 No Content with empty body.
- Uses `r.PathValue("id")` (Go 1.22 routing).

## 2. Recovery + access-log middleware

Implement two middlewares:

- `recoverPanic` — recovers from panics in inner handlers, logs the
  stack via `log/slog`, returns 500 with a JSON body.
- `accessLog` — logs one `slog.Info` per request with method, path,
  status, bytes written, duration, request ID.

Acceptance:

- Compose: `chain(handler, recoverPanic, accessLog)`. Recovery is
  outermost.
- A `panic("boom")` in the handler returns 500 and the access log
  shows `status=500` (not `status=0`).
- Generates a request ID if `X-Request-Id` is missing; passes through
  if present.
- The access-log wrapper around `ResponseWriter` implements `Unwrap()`
  so `http.NewResponseController(w).Flush()` still works downstream.

## 3. Streaming server-sent events endpoint

Endpoint: `GET /events` streams ticks every second:

```
data: tick 0

data: tick 1

...
```

Acceptance:

- `Content-Type: text/event-stream` and `Cache-Control: no-cache` set.
- `WriteTimeout: 0` on the server; per-stream deadline managed via
  `ResponseController`.
- Uses `http.NewResponseController(w).Flush()` after each event.
- Stops cleanly when `r.Context().Done()` fires.
- Limits a single client to 5 minutes of streaming.
- Test with `curl -N` — events appear immediately, not in a batch.

## 4. Graceful shutdown CLI

Wrap the server from task 1 with shutdown machinery:

Acceptance:

- Listens on `:8080`.
- On `SIGTERM` or `SIGINT`:
  1. Marks `/readyz` as failing (returns 503).
  2. Sleeps 5 seconds (LB deregister period).
  3. Calls `srv.Shutdown` with a 30-second context.
  4. Exits with code 0 if shutdown succeeded, 1 if it timed out.
- `ListenAndServe`'s `http.ErrServerClosed` is treated as success.
- A test that opens a slow request, sends SIGTERM mid-flight, and
  asserts the request completes before exit.

## 5. HTTP client with timeouts and retries

Build `Fetch(ctx, url) ([]byte, error)`:

Acceptance:

- Uses one shared `*http.Client` with `Timeout: 10 * time.Second`.
- Custom `Transport` with `MaxIdleConnsPerHost: 100`.
- Drains and closes the body on every path including errors and
  non-2xx.
- Retries up to 3 times on:
  - Network error.
  - 5xx status.
  - 429 with `Retry-After` (respect the value, capped at 30s).
- Backoff: 100ms, 400ms, 1s with ±25% jitter.
- Honors `ctx.Done()` between retries — stops immediately.
- A test that mocks an upstream returning 500 twice then 200; the
  function returns 200 on the third try.

## 6. Custom RoundTripper for outbound logging

Implement a `RoundTripper` that wraps `http.DefaultTransport`:

Acceptance:

- Logs one line per request with method, URL host (not full URL),
  status, duration, and whether the conn was reused.
- Uses `httptrace.WithClientTrace` to detect conn reuse via
  `GotConnInfo.Reused`.
- Does not modify the input request (use `req.Clone(ctx)` if you
  need to).
- Strips `Authorization` from the logged URL.
- A test asserting that two requests to the same host show
  `reused=true` on the second call.

## 7. Reverse proxy with header sanitization

Build a reverse proxy in front of a backend at `http://localhost:9000`:

Acceptance:

- Uses `httputil.ReverseProxy{}` directly with `Rewrite`,
  `ModifyResponse`, `ErrorHandler`.
- Strips `Server` and `X-Powered-By` from upstream responses.
- Adds `X-Request-Id` if missing on inbound requests; logs it.
- On upstream error, returns `502 Bad Gateway` with a JSON body.
- Provides a `BufferPool` of 32 KiB buffers via `sync.Pool`.
- Limits client body size to 1 MiB via `MaxBytesReader`.
- A test that pretends to be the backend and verifies request
  forwarding.

## 8. File upload endpoint with streaming

`POST /upload` accepts a `multipart/form-data` upload of one or
more files.

Acceptance:

- Total request body capped at 100 MiB via `MaxBytesReader`.
- Uses `r.MultipartReader()` (not `ParseMultipartForm`) — streams
  each part to disk without buffering the whole upload.
- Filename sanitization: rejects `..`, absolute paths, suspicious
  characters; uses `filepath.Base`.
- Each part written to a temp file in a configurable upload dir.
- Returns JSON `{"files":["a.png","b.png"]}` on success.
- Returns `413 Request Entity Too Large` with the right error body
  when the cap is exceeded (use `errors.As(*http.MaxBytesError)`).
- A test uploading a 200 MiB file that exits before OOM.

## 9. TLS server with cert hot-reload

Build a TLS server that reloads its cert from disk on `SIGHUP`:

Acceptance:

- Cert and key paths configurable via flags.
- Uses `tls.Config.GetCertificate` to look up the current cert per
  handshake.
- A goroutine listens for `SIGHUP` and reloads the cert; reload errors
  log but don't crash.
- New conns immediately see the new cert; existing conns keep their
  old cert until they close.
- A test that:
  1. Starts the server with cert A.
  2. Verifies `curl --cacert ca.pem https://...` shows cert A.
  3. Replaces cert files on disk, sends SIGHUP.
  4. Verifies a fresh `curl` shows cert B.

## 10. Connection-pool diagnostics

Build a small tool that hits `https://example.com` 100 times in a
loop, sharing a `*http.Client`:

Acceptance:

- Uses `httptrace` to record per-request: dial latency, TLS
  handshake latency, time to first response byte, total time, conn
  reused (yes/no).
- Prints a final summary: percent reused, p50/p99 of each phase.
- Resilient to errors — a failed request doesn't crash the program.
- After 10 requests, conn-reused should be near 100% (default pool).
- After tweaking `MaxIdleConnsPerHost: 1`, conn-reused should drop.
- A test that runs against `httptest.NewServer` and verifies the
  metrics structure.

## 11. Slow-loris simulator

Build a *client* that opens many conns to a target and sends one byte
every N seconds.

Acceptance:

- Configurable target URL, conn count, byte interval.
- Each conn opened, request line written, then dribble bytes.
- Reports how many conns the server tolerated before disconnecting.
- A test against your own server from task 1 — the server should
  disconnect each conn after `ReadHeaderTimeout` (5s).

## 12. Idempotent POST endpoint with key cache

`POST /orders` accepts `Idempotency-Key` header.

Acceptance:

- Missing key → 400.
- First request with key K: do the work, store result keyed by K.
- Subsequent request with same K (and same body): return cached
  response, status, headers.
- Subsequent request with same K but different body: return 422
  with explanation.
- Cache TTL: 24 hours. Use a simple in-memory map; documentation says
  to use Redis in production.
- Cache survives concurrent requests with the same K (only one runs;
  others wait).
- A test simulating 10 concurrent retries — only one DB write
  occurs.

## 13. Per-host transport registry

Implement a registry that returns a `*http.Transport` per host with
custom defaults:

Acceptance:

- `registry.Get("api.example.com")` returns a transport configured
  for that host (e.g., higher idle pool, custom TLS).
- Registry creates transports lazily on first call.
- Goroutine-safe (concurrent gets for the same host return the same
  transport).
- Per-host overrides via a config map; default transport for unknown
  hosts.
- `registry.CloseAll()` closes idle conns on every transport.
- A test asserting two concurrent gets for the same host return
  pointer-equal transports.

## 14. Body draining wrapper

Wrap `*http.Client` to guarantee bodies are drained on every path:

Acceptance:

- `func DrainingClient(c *http.Client) *http.Client` returns a new
  client whose responses are drained on `Close`.
- Implementation: wrap `Transport` with a `RoundTripper` that wraps
  the response body in a draining `ReadCloser`.
- The draining `ReadCloser.Close` first does `io.Copy(io.Discard, r)`
  then closes the underlying body.
- A test using `httptest.NewServer` that returns a large body; the
  client only reads 10 bytes; the conn is still reused for the next
  request (assert via `httptrace`).

## 15. HTTP/2 detection

Build a tool that hits a URL and reports whether the conn used HTTP/2:

Acceptance:

- For TLS targets, attempts HTTP/2 via ALPN (default).
- Reports `r.Proto`, `r.ProtoMajor`, `r.ProtoMinor` from the response.
- Uses `httptrace.GotConn` and inspects `tls.ConnectionState.NegotiatedProtocol`.
- Has a flag to disable HTTP/2 (`Transport.TLSNextProto = map[string]...{}`)
  and re-test.
- A test using `httptest.NewTLSServer` confirming HTTP/2 is the
  default and HTTP/1.1 with the flag set.

## 16. Cookie-based session middleware

Implement session middleware that issues a session cookie on first
visit and validates it on subsequent requests.

Acceptance:

- Cookie is `session=<random32hex>; Path=/; HttpOnly; Secure; SameSite=Lax;
  Max-Age=86400`.
- Server-side store keyed by session ID (in-memory map with mutex is
  fine for the exercise).
- Middleware adds the session ID to `r.Context()`; downstream handlers
  read it via `SessionFromContext(r.Context())`.
- A `/logout` handler invalidates the session and clears the cookie
  by setting `Max-Age=-1`.
- A test that simulates two requests: first sets the cookie, second
  uses it to read a session value back.

## 17. Path-traversal-safe file server

Build a `/files/{name...}` endpoint that serves files from a
configurable root directory.

Acceptance:

- Uses `os.OpenRoot` (Go 1.24+) or, if older Go, `filepath.Clean` +
  prefix check + reject any path with `..`.
- Returns `404` for missing files, not `500`.
- Sets `Content-Type` from extension; falls back to `DetectContentType`
  on unknown extensions.
- Sets `Cache-Control: public, max-age=3600` for static assets.
- Supports `If-Modified-Since` via `http.ServeContent`.
- A test that requests `/files/../../etc/passwd` and asserts a 404
  (not 200).

## 18. Server with per-route timeouts

Build a server where each route can specify its own timeout
(different from the server-wide defaults).

Acceptance:

- Server's `ReadTimeout` and `WriteTimeout` are 0; per-request
  deadlines via `http.NewResponseController`.
- A `WithTimeout(d)` middleware sets `SetReadDeadline` and
  `SetWriteDeadline` on entry.
- A `/slow` route allows 60 seconds; a `/fast` route allows 1 second;
  default is 10 seconds.
- A test that requests `/fast` with a sleep handler that takes 2
  seconds — the request fails with a write timeout.

## 19. Concurrent fan-out with context propagation

Implement `func FanOut(ctx context.Context, urls []string) []Result`:

Acceptance:

- Issues all requests concurrently via one shared `*http.Client`.
- Each request uses `http.NewRequestWithContext(ctx, ...)`.
- `ctx` cancellation immediately stops all in-flight requests.
- Returns one `Result{URL, Status, Body, Err}` per URL (preserves
  input order).
- Bounds total concurrency at 100 via a semaphore channel.
- A test using `httptest.NewServer` with deliberate slowness;
  cancelling `ctx` mid-fan-out causes all results to have
  `context.Canceled` errors.

## 20. h2c (HTTP/2 cleartext) server

Build a server that accepts HTTP/2 over plaintext, useful for
internal gRPC-like services without TLS.

Acceptance:

- Uses `golang.org/x/net/http2` (the only third-party package
  allowed for this task).
- Wraps the handler with `h2c.NewHandler(handler, &http2.Server{})`.
- A test using `*http.Client` with `Transport.AllowHTTP = true` and
  custom `DialTLS` returning a plain TCP conn — the response shows
  `Proto: "HTTP/2.0"`.

## 21. Server with structured request IDs

Add request ID propagation throughout your service.

Acceptance:

- Middleware looks at `X-Request-Id`; generates a `uuid` if absent.
- Adds the ID to `r.Context()` via a typed key.
- Adds `X-Request-Id` to the response.
- A helper `LogFromContext(ctx)` returns a `*slog.Logger` with the
  request ID baked in as a default field.
- All log lines from inside a handler include `request_id=...`.
- Outbound HTTP requests (in `RoundTripper`) propagate the ID by
  reading from `req.Context()` and setting `X-Request-Id` header.
- A test that asserts the same request ID appears in inbound and
  outbound logs.

## 22. Rate limiter middleware

Implement a token-bucket rate limiter as middleware.

Acceptance:

- Per-IP rate: 10 requests/second, burst of 20.
- Identifies client via `X-Forwarded-For` (first IP) if set,
  otherwise `r.RemoteAddr`.
- Returns `429 Too Many Requests` with `Retry-After: <seconds>` when
  exceeded.
- Uses `golang.org/x/time/rate` (one of the few non-stdlib
  exceptions; or implement manually).
- Stores per-IP limiters in a `sync.Map` with a TTL janitor that
  removes idle entries.
- A test asserting that 30 rapid requests from the same IP yield 20
  successes and 10 rate-limited responses.

## 23. Custom error type with HTTP status

Build an error type that carries an HTTP status code and a public
message, plus a helper that writes it as a JSON response.

Acceptance:

- `type APIError struct { Status int; Code, Message string }`.
- `APIError` implements `error`.
- `WriteAPIError(w, err)` walks `errors.As(err, &APIError)` and
  writes the contained status + message; falls back to `500 internal`
  for unknown errors.
- Predefined sentinels: `ErrNotFound`, `ErrUnauthorized`,
  `ErrBadRequest`, `ErrConflict`.
- A handler that returns `ErrNotFound` from the database layer; the
  middleware translates it to a `404 {"code":"not_found",...}`.
- A test asserting that a wrapped `fmt.Errorf("user lookup: %w",
  ErrNotFound)` still maps to 404.

## 24. CORS middleware

Implement a CORS middleware for browser-facing JSON APIs.

Acceptance:

- Allowed origins configurable as a list; reject anything else.
- Responds to `OPTIONS` preflight with `Access-Control-Allow-*`
  headers, status 204.
- For non-preflight responses, sets `Access-Control-Allow-Origin`
  matching the inbound `Origin` (echo, not wildcard).
- Supports `Access-Control-Allow-Credentials: true` only when the
  origin is on the allowlist (per spec, never with `*`).
- A test asserting an OPTIONS preflight returns 204 with the right
  headers and a request from a disallowed origin returns 403.

## 25. Cross-references

- [junior.md](junior.md), [middle.md](middle.md), [senior.md](senior.md),
  [professional.md](professional.md) — concepts the tasks exercise.
- [find-bug.md](find-bug.md) — bugs that show up if your task
  solution skips an edge case.
- [optimize.md](optimize.md) — when your task is correct but slow.
