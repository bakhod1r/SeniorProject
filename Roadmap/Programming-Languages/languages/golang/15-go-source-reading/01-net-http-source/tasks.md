## net/http Source Reading — Practice Tasks

Twenty exercises to read, instrument, and re-implement pieces of `net/http`. The goal is not to memorize the package; it is to learn the **two layers** every Go HTTP programmer needs — the *handler-side* (Server, ServeMux, ResponseWriter) and the *client-side* (Client, Transport, RoundTripper, conn pool) — well enough that you can debug production issues by intuition. Read along with the source: `$(go env GOROOT)/src/net/http/server.go`, `transport.go`, `client.go`, `request.go`, `response.go`.

Each task gives a Goal, Difficulty, Skills, Setup, Steps, Acceptance criteria, Hints, and a folded Reference solution that compiles on Go 1.22+. Difficulty: **J**unior, **M**id, **S**enior, **Staff**. Don't skip steps; the value is in the trace, not the answer.

---

### Task 1: Hello-world server with source trace

**Goal.** Write the smallest possible HTTP server and identify *exactly* which functions in `net/http/server.go` run on startup and on the first request.

**Difficulty.** Junior

**Skills.** Reading stdlib source, basic server bootstrap, `pprof`-free tracing via prints.

**Setup.**
- Open `$(go env GOROOT)/src/net/http/server.go` in a second window.
- Have `dlv` (`go install github.com/go-delve/delve/cmd/dlv@latest`) ready.

**Steps.**
1. Write a 10-line server that responds `hello\n` on `/`.
2. Boot it under `dlv debug`, set breakpoints on `(*Server).ListenAndServe`, `(*Server).Serve`, `(*conn).serve`, and `(*ServeMux).ServeHTTP`.
3. Run `curl localhost:8080/` and step through. Note the order.
4. Write the call chain as a comment at the top of your file.

**Acceptance criteria.**
- Server returns 200 with body `hello\n`.
- Comment lists at least six functions in the order they fire: `ListenAndServe` → `Serve` → `(*conn).serve` → `serverHandler.ServeHTTP` → `(*ServeMux).ServeHTTP` → your handler.
- You can explain *why* `(*conn).serve` runs in its own goroutine — point to the `go c.serve(connCtx)` line.

<details><summary>Hints</summary>

- `ListenAndServe` is a 4-line wrapper. The real work is in `Serve`.
- The accept loop in `Serve` is `for { rw, err := l.Accept(); ... go c.serve(connCtx) }`. Every connection gets one goroutine.
- `serverHandler{c.server}.ServeHTTP(w, w.req)` is the bridge into the mux. The `serverHandler` type exists *only* to default to `DefaultServeMux` when `Handler` is nil.
- The handler runs on the goroutine spawned by `Serve`; it does not return to the accept loop.

</details>

<details><summary>Reference solution</summary>

```go
// Call chain on first request:
//   1. http.ListenAndServe          (server.go ~3300)
//   2. (*Server).ListenAndServe     (server.go ~3300)
//   3. (*Server).Serve              (server.go ~3070) — accept loop
//   4. go (*conn).serve             (server.go ~1900) — per-conn goroutine
//   5. serverHandler.ServeHTTP      (server.go ~3000) — bridge
//   6. (*ServeMux).ServeHTTP        (server.go ~2700)
//   7. hello (our handler)
package main

import (
	"fmt"
	"log"
	"net/http"
)

func hello(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintln(w, "hello")
}

func main() {
	http.HandleFunc("/", hello)
	log.Println("listening :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
```

Why a goroutine per conn: HTTP/1 keep-alive means a single connection serves many requests serially; HTTP/2 multiplexes streams onto one connection. The `go c.serve` line means a slow handler blocks only its own connection — never the accept loop. The trade-off: goroutine-per-conn caps at ~1M on a beefy box because each goroutine costs ~2 KB initial stack + scheduler overhead. Production servers behind LBs typically see 1K–100K concurrent — well within the budget.

</details>

---

### Task 2: Client with a 5s timeout

**Goal.** Build a client that times out the *entire* request (DNS + dial + TLS + read body) at 5 seconds, and verify the source path that enforces it.

**Difficulty.** Junior

**Skills.** `http.Client.Timeout`, `context.DeadlineExceeded`, reading `client.go`.

**Setup.**
- Have a slow endpoint: `nc -l 9999` (or `python3 -m http.server 9999` and sleep before responding via a fake).
- Or hit `https://httpbin.org/delay/10`.

**Steps.**
1. Create `http.Client{Timeout: 5 * time.Second}`.
2. GET the slow endpoint; print the error.
3. Open `client.go` and find `(*Client).Do`. Trace how `Timeout` becomes a `context.WithDeadline` on the request.
4. Show that the returned error wraps `context.DeadlineExceeded` (use `errors.Is`).

**Acceptance criteria.**
- Request returns after ~5s, not 10s.
- `errors.Is(err, context.DeadlineExceeded)` is true.
- You can point to the line in `client.go` that calls `setRequestCancel` / context deadline.

<details><summary>Hints</summary>

- `Client.Timeout` covers the *entire* round-trip including reading the body. If your handler streams forever, the body read will trip the deadline.
- For finer control (e.g. dial 1s, response-header 3s, total 5s) use `Transport.DialContext` timeouts and `Transport.ResponseHeaderTimeout`.
- The `Do` method calls `c.do(req)` which calls `setRequestCancel(req, c.transport(), deadline)` — that's where the timer lives.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"
)

func main() {
	client := &http.Client{Timeout: 5 * time.Second}
	start := time.Now()
	resp, err := client.Get("https://httpbin.org/delay/10")
	elapsed := time.Since(start)
	if err != nil {
		fmt.Printf("err after %v: %v\n", elapsed, err)
		fmt.Printf("is DeadlineExceeded? %v\n", errors.Is(err, context.DeadlineExceeded))
		// url.Error wraps the context error; errors.Is unwraps it.
		return
	}
	defer resp.Body.Close()
	fmt.Printf("ok in %v: %d\n", elapsed, resp.StatusCode)
}
```

Why total-timeout via `Client.Timeout` is dangerous for long uploads/downloads: the clock starts at `Do` and ticks through body-read. A 1 GB download over a 1 Mbps line takes ~2.3 hours — your 5 s timeout kills it. For large transfers, use a per-phase budget via `Transport` plus a *liveness* timeout (no bytes for N seconds = cancel), implemented as a wrapped `io.Reader` around `resp.Body`.

</details>

---

### Task 3: ServeMux with Go 1.22 method+path patterns

**Goal.** Use the new 1.22 `ServeMux` syntax to register `GET /users/{id}` and extract the path value, then read how `mux.go` parses the pattern.

**Difficulty.** Junior

**Skills.** `http.HandleFunc`, `r.PathValue`, `(*ServeMux).Handler`.

**Setup.**
- Go 1.22+ (`go version`).

**Steps.**
1. Register two routes: `GET /users/{id}` and `POST /users`.
2. Inside the GET handler, read `r.PathValue("id")` and write it back.
3. Curl `GET /users/42` and `POST /users` to verify routing.
4. Curl `DELETE /users/42` — confirm you get `405 Method Not Allowed` (auto-generated by the mux in 1.22).
5. Open `server.go`, find `parsePattern`. Note how it splits method, host, and path.

**Acceptance criteria.**
- `GET /users/42` returns `42`.
- `POST /users` returns `201`.
- `DELETE /users/42` returns `405` with an `Allow: GET` header.

<details><summary>Hints</summary>

- The pattern is `"<METHOD> <HOST>/<PATH>"`. Method and host are optional; whitespace between method and path is required.
- `r.PathValue("id")` returns `""` if the wildcard didn't match — but with the new mux, it will match by definition or the handler won't run.
- `{id...}` (trailing `...`) captures the rest of the path including slashes.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"fmt"
	"log"
	"net/http"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /users/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		fmt.Fprintf(w, "user %s\n", id)
	})
	mux.HandleFunc("POST /users", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		fmt.Fprintln(w, "created")
	})
	log.Fatal(http.ListenAndServe(":8080", mux))
}
```

Why the 1.22 mux finally became usable: pre-1.22 you needed `gorilla/mux` or `chi` for `GET /users/{id}`. The stdlib mux did prefix matching only — `/users/` matched `/users/42` and `/users/42/posts` equally. The new parser builds a routing tree with method specificity and conflict detection at `Register`. You'll get a panic on overlapping patterns like `GET /users/{id}` + `GET /users/admin` because both could match `/users/admin`.

</details>

---

### Task 4: Read response body fully, defer Close

**Goal.** Make the canonical mistake (forgetting `Body.Close`), observe the consequence (connection leak, no reuse), then fix it.

**Difficulty.** Junior

**Skills.** `io.ReadAll`, `defer`, connection reuse.

**Setup.**
- A simple local server with `http.HandleFunc("/", ...)` that returns 1 KB.

**Steps.**
1. Write a loop that makes 100 GETs and *does not* close the body.
2. Print `runtime.NumGoroutine()` and look at `netstat -an | grep ESTAB | wc -l` (or `lsof -p $PID | grep TCP`).
3. Add `defer resp.Body.Close()`; rerun.
4. Compare connection counts.
5. Read `(*Transport).RoundTrip` in `transport.go` — find `persistConn.readLoop` and the line that puts the conn back in the idle pool *only after the body is fully drained or closed*.

**Acceptance criteria.**
- Without `Close`, you see goroutine count grow (the readLoop goroutine is alive per leaked conn).
- With `Close` *and* full read, only one or two TCP conns appear (reused).
- You can explain why closing without reading the body to EOF *also* prevents reuse: the conn is dirty (unread bytes), so the Transport discards it.

<details><summary>Hints</summary>

- `defer resp.Body.Close()` is *necessary but not sufficient* for reuse. You also need `io.Copy(io.Discard, resp.Body)` (or `io.ReadAll`) so the conn is drained.
- `if err != nil` *before* `defer` — if `err != nil`, `resp` is nil and `defer resp.Body.Close()` will nil-panic. Order: check err, then defer.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"runtime"
)

func main() {
	client := &http.Client{}
	for i := 0; i < 100; i++ {
		resp, err := client.Get("http://localhost:8080/")
		if err != nil {
			log.Fatal(err)
		}
		// Senior decision: defer comes AFTER nil check; drain BEFORE close so the
		// Transport can park the conn back in the idle pool. Forgetting either
		// half leaks a TCP connection and a readLoop goroutine.
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}
	fmt.Println("goroutines:", runtime.NumGoroutine())
}
```

Why drain-before-close: `persistConn.readLoop` (in `transport.go`) blocks reading the response. Once your handler/code closes the body before draining, `readLoop` sees an early close, marks `pc.broken = true`, and `putIdleConn` refuses to return it. New requests open new conns. After 10K requests with this bug, you have 10K conns in `TIME_WAIT` and a deeply unhappy load balancer.

</details>

---

### Task 5: Custom Transport with MaxIdleConnsPerHost=100

**Goal.** Build a tuned `http.Transport`, hammer one host, verify that connections are reused (not opened/closed per request).

**Difficulty.** Mid

**Skills.** `http.Transport` config, `httptrace.ClientTrace`, conn reuse.

**Setup.**
- A local server (the one from Task 4).
- Concurrent client (e.g. `errgroup.Group` with 50 goroutines).

**Steps.**
1. Build a `Transport` with `MaxIdleConns: 200`, `MaxIdleConnsPerHost: 100`, `IdleConnTimeout: 90 * time.Second`.
2. Wrap it in `http.Client{Transport: tr}`.
3. Use `httptrace.WithClientTrace` to count `GotConn` events with `Reused == true`.
4. Make 1000 concurrent requests; print reuse ratio.
5. Repeat with `MaxIdleConnsPerHost: 1` (the default is 2). Observe the contention.

**Acceptance criteria.**
- With `MaxIdleConnsPerHost: 100`, reuse ratio > 95% after the first batch.
- With `MaxIdleConnsPerHost: 1`, reuse ratio drops dramatically and request latency rises.
- You can point to `(*Transport).getConn` in `transport.go` and explain how it pulls from `idleConn[connectMethodKey]`.

<details><summary>Hints</summary>

- The default `MaxIdleConnsPerHost = 2` is the #1 gotcha. Any service that calls one backend at >2 concurrency is reopening conns constantly.
- `Transport` is safe for concurrent use; create **one** per process and share it.
- `httptrace.ClientTrace` is the introspection tool. `GotConn` fires once per attempt with `Reused`, `WasIdle`, and `IdleTime` populated.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptrace"
	"sync"
	"sync/atomic"
	"time"
)

func main() {
	tr := &http.Transport{
		MaxIdleConns:        200,
		MaxIdleConnsPerHost: 100,
		IdleConnTimeout:     90 * time.Second,
	}
	client := &http.Client{Transport: tr, Timeout: 10 * time.Second}

	var reused, total int64
	var wg sync.WaitGroup
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			trace := &httptrace.ClientTrace{
				GotConn: func(info httptrace.GotConnInfo) {
					atomic.AddInt64(&total, 1)
					if info.Reused {
						atomic.AddInt64(&reused, 1)
					}
				},
			}
			ctx := httptrace.WithClientTrace(context.Background(), trace)
			req, _ := http.NewRequestWithContext(ctx, "GET", "http://localhost:8080/", nil)
			resp, err := client.Do(req)
			if err != nil {
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}()
	}
	wg.Wait()
	fmt.Printf("reuse: %d/%d (%.1f%%)\n", reused, total, 100*float64(reused)/float64(total))
}
```

Why `MaxIdleConnsPerHost` and not just `MaxIdleConns`: the per-host cap is what governs reuse when you're a microservice calling a peer microservice. `MaxIdleConns` is a global cap across all hosts — useful only if you fan out to thousands of hosts (e.g. a crawler). For a service that talks to 5 peers, set per-host to your concurrency and global to per-host × peer count.

</details>

---

### Task 6: Graceful shutdown via Server.Shutdown

**Goal.** Run a server with in-flight long requests; shut down without dropping them.

**Difficulty.** Mid

**Skills.** `Server.Shutdown`, signal handling, context deadlines.

**Setup.**
- A handler that sleeps 5 s before responding (`time.Sleep(5 * time.Second)`).
- Two terminals: one for the server, one for `curl`.

**Steps.**
1. Wire `SIGTERM`/`SIGINT` to call `srv.Shutdown(ctx)` with a 30 s deadline.
2. Start the server, send a slow request, then immediately `kill -TERM` the process.
3. Verify the in-flight request completes, but new requests get `connection refused`.
4. Read `(*Server).Shutdown` in `server.go`. Note how it closes listeners, then polls `getDoneChan` until idle.

**Acceptance criteria.**
- In-flight request completes with 200.
- New request during shutdown is refused (no listener).
- Process exits within 30 s; if a handler exceeds the deadline, you see `context.DeadlineExceeded` from `Shutdown`.

<details><summary>Hints</summary>

- `Shutdown` blocks listeners but leaves accepted conns running. `Close` is the brutal version — kills everything immediately.
- For SSE/long-poll handlers that never return on their own, you also need a `context` on the request that you watch from inside the handler. Otherwise `Shutdown` hangs until your deadline.
- `srv.RegisterOnShutdown(fn)` lets you signal active connections to wind down (e.g. by canceling their per-request context).

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/slow", func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(5 * time.Second):
			w.Write([]byte("done\n"))
		case <-r.Context().Done():
			// Senior decision: respect ctx so Shutdown can unblock us.
			http.Error(w, "shutting down", http.StatusServiceUnavailable)
		}
	})

	srv := &http.Server{Addr: ":8080", Handler: mux}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("shutdown: %v", err)
	}
	log.Println("bye")
}
```

Why `signal.NotifyContext` and not `signal.Notify` on a channel: `NotifyContext` ties the signal to a `context.Context` so you can pass it down to anything that needs the same cancellation semantics. The old channel-based pattern still works but means you write the same boilerplate in three places — main, worker pools, and the server.

</details>

---

### Task 7: Middleware chain — logging, auth, handler

**Goal.** Build a small middleware framework that composes three layers and prints the order of execution on every request.

**Difficulty.** Mid

**Skills.** `http.Handler` composition, closures, request-scoped state.

**Setup.**
- Empty package; no dependencies.

**Steps.**
1. Define `type Middleware func(http.Handler) http.Handler`.
2. Write `Logging(next)`, `Auth(next)` (rejects without `Authorization: Bearer dev`), and a terminal handler.
3. Write `Chain(mws ...Middleware) Middleware` that composes right-to-left so the first listed runs first.
4. Curl with and without auth; show the log lines.

**Acceptance criteria.**
- Order: Logging → Auth → handler → Auth-after → Logging-after.
- Missing/wrong token → 401 *before* the handler runs.
- `Chain(A, B, C).Then(h)` equals `A(B(C(h)))`.

<details><summary>Hints</summary>

- Compose right-to-left so the slice order reads naturally: `Chain(Logging, Auth, RateLimit)` means Logging is the outermost layer.
- Capture the start time in Logging, log on the way out — gives you latency for free.
- Use `*responseWriterWrap` (a struct embedding `http.ResponseWriter` with a `status int` field) to capture status for the log line.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"log"
	"net/http"
	"time"
)

type Middleware func(http.Handler) http.Handler

func Chain(mws ...Middleware) Middleware {
	return func(final http.Handler) http.Handler {
		for i := len(mws) - 1; i >= 0; i-- {
			final = mws[i](final)
		}
		return final
	}
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(c int) { s.status = c; s.ResponseWriter.WriteHeader(c) }

func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sw := &statusWriter{ResponseWriter: w, status: 200}
		start := time.Now()
		next.ServeHTTP(sw, r)
		log.Printf("%s %s %d %v", r.Method, r.URL.Path, sw.status, time.Since(start))
	})
}

func Auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer dev" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hello\n"))
	})
	wrapped := Chain(Logging, Auth)(h)
	http.Handle("/", wrapped)
	log.Fatal(http.ListenAndServe(":8080", nil))
}
```

Why this beats a framework: it's 25 lines, it's the model every router uses internally (chi, gin, echo), and it's debuggable with prints. The trick most beginners miss is `statusWriter` — without it, `Logging` can't see the response status because `http.ResponseWriter.WriteHeader` doesn't expose what was written. Production middleware should also capture bytes-written and observed panics (`defer recover()`).

</details>

---

### Task 8: Test a handler with httptest.NewServer

**Goal.** Write a handler that fetches a remote URL, then test it with `httptest.NewServer` standing in for the remote.

**Difficulty.** Mid

**Skills.** `httptest.NewServer`, `httptest.NewRecorder`, test isolation.

**Setup.**
- `go test ./...` in a fresh module.

**Steps.**
1. Write `func ProxyTime(w http.ResponseWriter, r *http.Request)` that GETs `http://upstream/now`, parses an int unix-time, and writes `now: <value>`.
2. Make `upstream` injectable (a package-level `var upstreamURL = "http://upstream"` or, better, a function with a `client` and `url` parameter).
3. In the test, spin up `httptest.NewServer` returning `"1700000000"`.
4. Point your handler at `ts.URL` and assert the response body.

**Acceptance criteria.**
- Test passes without network access.
- Defer `ts.Close()` cleanly.
- A failing upstream (close before request) yields a 502 from your handler.

<details><summary>Hints</summary>

- Don't fake the upstream with a global; pass `upstreamURL` as a parameter or struct field. Easier to test, easier to multi-tenant later.
- `httptest.NewRecorder` is for testing a handler directly (no socket). `httptest.NewServer` is for testing a *client* (real socket on 127.0.0.1, random port).
- For TLS, use `httptest.NewTLSServer` — it generates a self-signed cert and exposes `ts.Client()` that trusts it.

</details>

<details><summary>Reference solution</summary>

```go
package proxytime

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type Service struct {
	UpstreamURL string
	Client      *http.Client
}

func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	resp, err := s.Client.Get(s.UpstreamURL + "/now")
	if err != nil {
		http.Error(w, "upstream failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	fmt.Fprintf(w, "now: %s", strings.TrimSpace(string(b)))
}

func TestProxyTime(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/now" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		fmt.Fprint(w, "1700000000")
	}))
	defer upstream.Close()

	s := &Service{UpstreamURL: upstream.URL, Client: upstream.Client()}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/", nil)
	s.ServeHTTP(rec, req)

	if got, want := rec.Body.String(), "now: 1700000000"; got != want {
		t.Errorf("body = %q, want %q", got, want)
	}
}
```

Why `httptest.NewServer` instead of mocking `http.Client`: a real server tests the full stack — TCP, headers, encoding, body streaming. Mocking the `RoundTripper` hides bugs in URL composition, header forwarding, and TLS behavior. The cost is microseconds per test, which doesn't matter; the alternative is a green test that fails in prod because your URL had a missing slash.

</details>

---

### Task 9: Request-ID propagation via context and header

**Goal.** Generate an `X-Request-ID` if missing, store it in `context.Context`, log it from every layer.

**Difficulty.** Mid

**Skills.** `context.WithValue`, typed keys, structured logging.

**Setup.**
- Use `slog` (stdlib) for logging.

**Steps.**
1. Middleware: read `X-Request-ID`; if empty, generate a UUID-ish (crypto/rand hex).
2. Stash it in context using a private key type.
3. Set the same header on the *response* so the caller can correlate.
4. Provide `RequestIDFromContext(ctx) string` and use it in a downstream handler log.

**Acceptance criteria.**
- Missing `X-Request-ID` → new one generated, returned in response header.
- Provided `X-Request-ID` → preserved verbatim.
- A panic-recovery middleware (bonus) logs the request ID with the stack.

<details><summary>Hints</summary>

- Define `type ctxKey struct{}` and use `ctxKey{}` as the key. `string` keys collide and `go vet` complains.
- Don't expose the key type. Expose only `WithRequestID` and `RequestIDFromContext` helpers.
- For ID generation, `crypto/rand` 16 bytes hex-encoded is enough. Don't reach for `uuid` dependency unless you need the format.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"os"
)

type ctxKey struct{}

var reqIDKey = ctxKey{}

func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, reqIDKey, id)
}

func RequestIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(reqIDKey).(string); ok {
		return v
	}
	return ""
}

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = newID()
		}
		w.Header().Set("X-Request-ID", id)
		ctx := WithRequestID(r.Context(), id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		logger.InfoContext(r.Context(), "hit", "req_id", RequestIDFromContext(r.Context()))
		w.Write([]byte("ok\n"))
	})
	http.ListenAndServe(":8080", RequestID(mux))
}
```

Why echo the ID back on the response: callers (often other services, sometimes the user via a browser dev-tool) need a correlation key they can grep for. Logging it server-side without returning it is half a feature. Combined with OTel trace IDs (which serve the same purpose), most shops standardize on one and stop. Pick `traceparent` if you're OTel-shaped; pick `X-Request-ID` if you're not.

</details>

---

### Task 10: JSON API with json.Decoder direct from Body

**Goal.** Build `POST /widgets` that decodes a JSON payload directly off `r.Body` (no `io.ReadAll` first), validates, and stores in memory.

**Difficulty.** Mid

**Skills.** `json.Decoder`, validation, streaming decode.

**Setup.**
- A struct `type Widget struct { ID string; Name string; Qty int }`.

**Steps.**
1. Handler reads `json.NewDecoder(r.Body).Decode(&w)`.
2. Add `dec.DisallowUnknownFields()` so typos in the payload fail loudly.
3. Cap payload size with `http.MaxBytesReader(w, r.Body, 1<<20)` — 1 MB.
4. Return 400 on decode error, 422 on validation error, 201 on success.
5. Curl with valid, with extra field, and with 2 MB junk.

**Acceptance criteria.**
- Valid → 201.
- Unknown field (`"color": "red"`) → 400 with a clear message.
- Body > 1 MB → 413.
- A trailing JSON object (`{...}{...}`) is rejected (use `dec.Decode` then `dec.More()`).

<details><summary>Hints</summary>

- `MaxBytesReader` wraps the body so reads beyond N bytes return an error. Add it *before* the decoder.
- `DisallowUnknownFields` catches client/server schema drift before it becomes a silent data bug.
- After `Decode`, call `dec.More()`. If true, the client sent extra data — that's a sign of a misbehaving client and you should 400.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
)

type Widget struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Qty  int    `json:"qty"`
}

func (w Widget) Validate() error {
	if w.ID == "" {
		return errors.New("id required")
	}
	if w.Qty < 0 {
		return errors.New("qty must be >= 0")
	}
	return nil
}

func create(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	var widget Widget
	if err := dec.Decode(&widget); err != nil {
		// MaxBytesReader returns a *http.MaxBytesError on 1.19+.
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			http.Error(w, "request too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, fmt.Sprintf("bad json: %v", err), http.StatusBadRequest)
		return
	}
	if dec.More() {
		http.Error(w, "trailing data", http.StatusBadRequest)
		return
	}
	if err := widget.Validate(); err != nil {
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"id": widget.ID})
	_ = strings.Builder{}
}

func main() {
	http.HandleFunc("POST /widgets", create)
	log.Fatal(http.ListenAndServe(":8080", nil))
}
```

Why streaming decode beats `io.ReadAll` + `json.Unmarshal`: `Unmarshal` requires the whole payload in memory before parsing starts. `Decoder` parses incrementally, so a 1 GB stream of newline-separated JSON objects (NDJSON) processes in O(1) memory per object. For small bodies the difference is academic; for large or unbounded bodies it's the difference between a working service and an OOM-loop.

</details>

---

### Task 11: Tune server for 10K concurrent connections

**Goal.** Configure timeouts, body limits, and OS file-descriptor ulimits to safely run a 10K-concurrent server.

**Difficulty.** Senior

**Skills.** `Server.ReadTimeout`, `WriteTimeout`, `IdleTimeout`, `MaxHeaderBytes`, ulimit.

**Setup.**
- A Linux host (Mac works for local but the ulimit ceiling differs).
- A load generator: `hey`, `wrk`, or `bombardier`.

**Steps.**
1. Configure: `ReadHeaderTimeout: 5s`, `ReadTimeout: 30s`, `WriteTimeout: 30s`, `IdleTimeout: 120s`, `MaxHeaderBytes: 1 << 14`.
2. Set process ulimit: `ulimit -n 65536` before starting the server.
3. Use `wrk -c 10000 -d 30s -t 16 http://localhost:8080/` and watch for `accept: too many open files`.
4. If you see EMFILE, raise the ulimit. If you see slow responses, tune `IdleTimeout` lower.
5. Profile with `go tool pprof http://localhost:6060/debug/pprof/goroutine` — confirm goroutine count tracks active conns.

**Acceptance criteria.**
- 10K concurrent reaches steady state without EMFILE.
- p99 latency under 50 ms for a no-op handler.
- Idle conns close after 120 s (TCP `FIN` visible in `tcpdump`).

<details><summary>Hints</summary>

- `ReadHeaderTimeout` is the cheap one — it protects against Slowloris (slow header send). Set it short (1–5s).
- `WriteTimeout` includes the time your handler holds the response. For long-poll/SSE handlers, set it to zero (no timeout) and rely on `r.Context()`.
- ulimit per-process; ulimit -Hn is the hard cap your user can set. `/etc/security/limits.conf` raises it system-wide.
- Each in-flight conn costs ~10 KB of Go heap + 1 file descriptor + kernel socket buffers.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"log"
	"net"
	"net/http"
	_ "net/http/pprof"
	"time"
)

func main() {
	// Start pprof on its own listener so it doesn't share fates with the main server.
	go func() {
		log.Println(http.ListenAndServe("127.0.0.1:6060", nil))
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok\n"))
	})

	srv := &http.Server{
		Addr:              ":8080",
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 14, // 16 KB
	}

	// Bind explicitly so we can log the resolved address.
	ln, err := net.Listen("tcp", srv.Addr)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("listening %s", ln.Addr())
	log.Fatal(srv.Serve(ln))
}
```

Pre-flight checklist before going to 10K (bash, not Go):

```bash
ulimit -n 65536           # process-level FD cap
sysctl -w net.core.somaxconn=65535        # accept queue
sysctl -w net.ipv4.tcp_max_syn_backlog=65535
sysctl -w net.ipv4.ip_local_port_range="10000 65535"
```

Why these numbers: `somaxconn` is the kernel's accept-queue ceiling — if your server can't accept fast enough, conns drop in SYN-recv. Default is 128 on many distros — that's a hard cap of 128 pending accepts. `ip_local_port_range` matters on the *client* side; if your service makes outbound calls, you'll run out of ephemeral ports at ~28K concurrent outbound conns to a single backend.

</details>

---

### Task 12: Reverse proxy with httputil

**Goal.** Stand up a reverse proxy that rewrites the request and inspects the response.

**Difficulty.** Senior

**Skills.** `httputil.NewSingleHostReverseProxy`, `Director`, `ModifyResponse`, `Rewrite` (1.20+).

**Setup.**
- A backend at `http://localhost:9000/`.
- Proxy at `http://localhost:8080/`.

**Steps.**
1. Build the proxy with `httputil.NewSingleHostReverseProxy(targetURL)`.
2. Override `proxy.Rewrite` to set `X-Forwarded-Host` and strip a path prefix `/api`.
3. Set `proxy.ModifyResponse` to add `X-Proxy: senior-go` to every response.
4. Curl `localhost:8080/api/users/1` and verify it reaches `localhost:9000/users/1` with the right headers.
5. Read `httputil/reverseproxy.go` — note how `ServeHTTP` clones the request, calls `Transport.RoundTrip`, and copies headers/body back.

**Acceptance criteria.**
- Prefix stripped correctly.
- Backend sees `X-Forwarded-Host: localhost:8080`.
- Client sees `X-Proxy: senior-go`.
- Body streams (no full buffering) — verify with a slow 100 MB backend response.

<details><summary>Hints</summary>

- Prefer `Rewrite` (Go 1.20+) over `Director`. `Rewrite` receives a `ProxyRequest` with `In` and `Out`, eliminating the "did I clone or mutate the original?" confusion.
- For host-based routing (more than one backend), build a `map[string]*httputil.ReverseProxy` keyed by hostname.
- `proxy.ErrorHandler` lets you customize the 502 response when the backend is down.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

func main() {
	target, _ := url.Parse("http://localhost:9000")
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Rewrite = func(r *httputil.ProxyRequest) {
		r.SetURL(target)
		r.Out.URL.Path = strings.TrimPrefix(r.In.URL.Path, "/api")
		r.Out.Header.Set("X-Forwarded-Host", r.In.Host)
		r.SetXForwarded() // sets X-Forwarded-For/Proto from r.In
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		resp.Header.Set("X-Proxy", "senior-go")
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("proxy err: %v", err)
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
	}
	log.Fatal(http.ListenAndServe(":8080", proxy))
}
```

Why `Rewrite` and not `Director`: `Director` operated on the *outgoing* request without making the inbound request available, leading to bugs where people read the body twice or accidentally mutated the inbound request. `Rewrite` cleanly separates `In` (read-only-ish view of what came in) from `Out` (what gets sent upstream), and provides helpers like `SetXForwarded` and `SetURL` that handle host/scheme correctly.

</details>

---

### Task 13: Inspect HTTP/2 with GODEBUG=http2debug=1

**Goal.** Watch the HTTP/2 framing layer of a real request from both client and server sides.

**Difficulty.** Senior

**Skills.** Reading `golang.org/x/net/http2` traces, frame types.

**Setup.**
- A TLS-enabled server (use `httptest.NewTLSServer` for convenience).
- The `GODEBUG=http2debug=2` env var (level 1 = summary, level 2 = per-frame).

**Steps.**
1. Build server + client; both use `https`.
2. Run with `GODEBUG=http2debug=2`. Make a single GET.
3. In the output, find `HEADERS`, `DATA`, `WINDOW_UPDATE`, `SETTINGS`, and `PING` frames.
4. Identify the stream ID (always odd for client-initiated).
5. Bonus: force HTTP/1 by setting `Transport.TLSNextProto = map[string]func(...)Roundtripper{}` and confirm via debug that no h2 frames appear.

**Acceptance criteria.**
- Trace output shows SETTINGS exchange before any HEADERS.
- You can identify the request HEADERS frame and the response DATA frame.
- You can explain why `WINDOW_UPDATE` exists (flow control) and what happens if you ignore it (sender stalls).

<details><summary>Hints</summary>

- `GODEBUG=http2debug=1` summary, `=2` verbose. Use `=2` for first few traces, drop to `=1` once you understand the shape.
- HTTP/2 over h2c (cleartext) requires opt-in on both sides. The stdlib client does not speak h2c by default.
- Stream IDs: 0 = connection-level (SETTINGS, PING, GOAWAY), odd = client-initiated, even = server-initiated (push).

</details>

<details><summary>Reference solution</summary>

```go
// Run with: GODEBUG=http2debug=2 go run main.go
package main

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
)

func main() {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "hello over h2")
	}))
	defer srv.Close()

	client := srv.Client() // already configured to trust the self-signed cert
	resp, err := client.Get(srv.URL)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	fmt.Printf("proto=%s status=%d body=%s", resp.Proto, resp.StatusCode, body)
}
```

Expected (abridged) output with `http2debug=2`:

```
http2: Framer 0xc0001a4000: wrote SETTINGS len=24
http2: Framer 0xc0001a4000: read SETTINGS len=18
http2: Framer 0xc0001a4000: wrote HEADERS flags=END_STREAM|END_HEADERS stream=1 len=...
http2: Framer 0xc0001a4000: read HEADERS flags=END_HEADERS stream=1
http2: Framer 0xc0001a4000: read DATA flags=END_STREAM stream=1 len=14
```

Why this matters in production: when HTTP/2 misbehaves, the symptom is "request hangs" — there is no SYN/FIN dance to look at like in HTTP/1. The framing trace is the only window into "is the server actually sending DATA or is it stuck on flow control?" `WINDOW_UPDATE` neglect is a real bug class: if your handler streams a large response and the *client* drops without sending WINDOW_UPDATE, the server stalls writing — which then ties up a stream slot. Server timeouts save you, but the trace tells you why.

</details>

---

### Task 14: Server-Sent Events endpoint

**Goal.** Build an SSE endpoint that streams server time every second.

**Difficulty.** Senior

**Skills.** `Content-Type: text/event-stream`, `Flusher`, long-lived connections.

**Setup.**
- A handler at `/events`.
- A browser or `curl -N http://localhost:8080/events`.

**Steps.**
1. Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
2. Type-assert `w` to `http.Flusher`; bail with 500 if not supported.
3. Loop: write `data: <time>\n\n`, `Flush`, `time.Sleep(time.Second)`.
4. Watch `r.Context().Done()` to stop on client disconnect.
5. Set `WriteTimeout` to 0 on the Server (else handler dies at 30s).

**Acceptance criteria.**
- `curl -N` shows a new line per second.
- Closing curl (Ctrl-C) makes the server log "client gone" within ~1s.
- `WriteTimeout: 0` (or per-conn override) so the long-lived stream survives.

<details><summary>Hints</summary>

- The `\n\n` between events is part of the SSE spec — it terminates an event.
- You can send `event: foo\ndata: bar\n\n` for typed events, or `id: 42\ndata: bar\n\n` for resumable streams.
- Browsers auto-reconnect SSE on transport errors. If you need at-least-once delivery, use the `id:` field and respect `Last-Event-ID` header on reconnect.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"fmt"
	"log"
	"net/http"
	"time"
)

func sse(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			log.Println("client gone")
			return
		case t := <-ticker.C:
			fmt.Fprintf(w, "data: %s\n\n", t.Format(time.RFC3339))
			flusher.Flush()
		}
	}
}

func main() {
	srv := &http.Server{
		Addr:         ":8080",
		Handler:      http.HandlerFunc(sse),
		WriteTimeout: 0, // SSE streams indefinitely; per-stream timeout via ctx
		IdleTimeout:  0,
	}
	log.Fatal(srv.ListenAndServe())
}
```

Why disable `WriteTimeout` for SSE: `WriteTimeout` measures from "request fully read" to "response fully written". For SSE, the response is never "fully written" — it's open until the client disconnects. With a 30 s `WriteTimeout`, your stream dies at 30 s and the client reconnects, dragging your conn churn through the roof. The proper bound is `r.Context()` plus your business logic (e.g. "kick clients idle for >5 min").

</details>

---

### Task 15: Streaming JSON API with json.Encoder

**Goal.** Stream a million records as a JSON array without buffering them all in memory.

**Difficulty.** Senior

**Skills.** `json.Encoder` direct to `ResponseWriter`, manual array framing.

**Setup.**
- A source of records (channel, paginated DB query, etc.). For this task: synthetic data from a loop.

**Steps.**
1. Set `Content-Type: application/json`.
2. Write `[`.
3. For each record: encode via `json.NewEncoder(w).Encode(rec)`; between records write `,`.
4. Write `]`.
5. Flush every N records so the client sees progress.
6. Alternative for huge streams: emit **NDJSON** (one JSON object per line, no enclosing array) — easier to parse incrementally.

**Acceptance criteria.**
- 1M records stream to client without server heap exceeding ~20 MB (measure with `pprof heap`).
- Output is valid JSON (validate with `jq`).
- Client can start parsing before the response ends (true streaming, not chunked-but-buffered).

<details><summary>Hints</summary>

- `json.NewEncoder(w).Encode(v)` writes a newline after each value. For an array, you have to manage commas yourself.
- For huge streams, NDJSON is *much* easier — clients can split on newlines and parse line-by-line.
- Don't forget to `Flush` periodically — without it, the kernel buffers and the client sees one big chunk at the end.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
)

type Record struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Value int    `json:"value"`
}

func stream(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	flusher, _ := w.(http.Flusher)

	enc := json.NewEncoder(w)
	fmt.Fprint(w, "[")
	first := true
	for i := 0; i < 1_000_000; i++ {
		if !first {
			fmt.Fprint(w, ",")
		}
		first = false
		if err := enc.Encode(Record{ID: i, Name: "row", Value: i * 2}); err != nil {
			// client disconnected — silently bail
			return
		}
		if i%1000 == 0 && flusher != nil {
			flusher.Flush()
		}
	}
	fmt.Fprint(w, "]")
	if flusher != nil {
		flusher.Flush()
	}
}

func main() {
	http.HandleFunc("/stream", stream)
	log.Fatal(http.ListenAndServe(":8080", nil))
}
```

Why NDJSON beats JSON-array for streams: clients don't have to wait for the closing `]` to start processing; they parse line-by-line as bytes arrive. Most ETL tools (`jq`, BigQuery, Postgres `COPY ... FROM PROGRAM`) handle NDJSON natively. The cost is one less character per record (no commas) and no schema-enforced "this is a JSON array" framing — which is fine because the response's `Content-Type: application/x-ndjson` carries that information.

</details>

---

### Task 16: Profile a handler with net/http/pprof and labels

**Goal.** Profile a CPU-bound handler, distinguish its samples from background work using `runtime/pprof.Do`.

**Difficulty.** Senior

**Skills.** `net/http/pprof`, profile labels, flame graph reading.

**Setup.**
- A handler that does measurable work (e.g. computes 100K SHA-256 hashes).
- Two background goroutines doing other CPU work.

**Steps.**
1. Import `_ "net/http/pprof"` and start a separate pprof server on `:6060`.
2. Wrap the handler with `pprof.Do(ctx, pprof.Labels("endpoint", "/hash"), func(ctx) { ... })`.
3. Run `go tool pprof -http=:7000 http://localhost:6060/debug/pprof/profile?seconds=30`.
4. While profile is running, hit the endpoint with `hey -z 30s http://localhost:8080/hash`.
5. In the profile UI, filter by label `endpoint=/hash`.

**Acceptance criteria.**
- Profile shows the hash hot path inside the labeled scope.
- Filtering by label reduces noise from background goroutines.
- You can identify the function consuming most CPU and explain why.

<details><summary>Hints</summary>

- pprof labels propagate via `context.Context`. Any goroutine you spawn from the labeled scope inherits them — but only if you pass the ctx.
- The `?seconds=N` parameter on `/debug/pprof/profile` is what makes it a *CPU profile* over that window. Without it you'd get other profile types.
- Don't expose `:6060` (pprof) to the internet — labels and traces leak info. Bind to `127.0.0.1`.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"context"
	"crypto/sha256"
	"log"
	"net/http"
	_ "net/http/pprof"
	"runtime/pprof"
)

func hashHandler(w http.ResponseWriter, r *http.Request) {
	pprof.Do(r.Context(), pprof.Labels("endpoint", "/hash"), func(ctx context.Context) {
		buf := make([]byte, 32)
		for i := 0; i < 100_000; i++ {
			h := sha256.Sum256(buf)
			buf = h[:]
		}
		w.Write(buf)
	})
}

func main() {
	go func() { log.Fatal(http.ListenAndServe("127.0.0.1:6060", nil)) }()

	// Background noise to make labels useful.
	go func() {
		buf := make([]byte, 32)
		for {
			h := sha256.Sum256(buf)
			buf = h[:]
		}
	}()

	http.HandleFunc("/hash", hashHandler)
	log.Fatal(http.ListenAndServe(":8080", nil))
}
```

Why labels matter: in a production binary you have dozens of code paths running concurrently. A flame graph without labels looks like `sha256.Sum256` is 60% of CPU — but is it your hot endpoint, the metrics serializer, or a leaked background goroutine? With labels, you filter to `endpoint=/hash` and instantly see the breakdown for *just that handler*. The pprof UI's `tag` filter (use `-tagfocus=endpoint:/hash` on CLI) makes this surgical.

</details>

---

### Task 17: Hijack the connection for a WebSocket-style upgrade

**Goal.** Use `http.Hijacker` to take over the TCP connection from `net/http` and do a hand-crafted "upgrade" handshake (a tiny echo protocol, not full WebSocket).

**Difficulty.** Senior

**Skills.** `Hijacker`, raw TCP, manual framing.

**Setup.**
- A handler at `/upgrade`.
- A custom client using `net.Dial` + raw HTTP.

**Steps.**
1. In the handler, type-assert `w.(http.Hijacker)`.
2. Call `conn, bufrw, err := hijacker.Hijack()`.
3. Write a `101 Switching Protocols` response manually via `bufrw`.
4. Loop: read a line, echo it back uppercase.
5. Build a client that opens a TCP conn, writes a `GET /upgrade HTTP/1.1\r\nUpgrade: echo\r\n\r\n`, then exchanges lines.

**Acceptance criteria.**
- Server returns 101 with the right `Upgrade` header.
- Client and server exchange at least 5 messages.
- After `Hijack`, the Go `net/http` runtime no longer touches the conn — you own its lifetime, including timeouts and close.

<details><summary>Hints</summary>

- After `Hijack`, you must `bufrw.Flush()` to push the 101 response — the standard `WriteHeader` doesn't apply.
- The conn is in HTTP/1 mode at the byte level. There's no built-in framing — you decide whether it's line-delimited, length-prefixed, or something else.
- HTTP/2 doesn't support hijacking. If you serve over h2, `Hijack()` returns `ErrNotSupported`. WebSocket over h2 uses the CONNECT method instead.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"bufio"
	"fmt"
	"log"
	"net/http"
	"strings"
)

func upgrade(w http.ResponseWriter, r *http.Request) {
	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "hijack unsupported (HTTP/2?)", http.StatusInternalServerError)
		return
	}
	conn, bufrw, err := hj.Hijack()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer conn.Close()

	// Senior decision: hand-write the 101. Don't try to call WriteHeader after Hijack.
	fmt.Fprintf(bufrw, "HTTP/1.1 101 Switching Protocols\r\n")
	fmt.Fprintf(bufrw, "Upgrade: echo\r\n")
	fmt.Fprintf(bufrw, "Connection: Upgrade\r\n\r\n")
	bufrw.Flush()

	for {
		line, err := bufrw.ReadString('\n')
		if err != nil {
			log.Printf("client gone: %v", err)
			return
		}
		out := strings.ToUpper(strings.TrimRight(line, "\r\n"))
		fmt.Fprintf(bufrw, "%s\n", out)
		bufrw.Flush()
	}
}

func main() {
	http.HandleFunc("/upgrade", upgrade)
	log.Fatal(http.ListenAndServe(":8080", nil))
}
```

A minimal raw client:

```go
package main

import (
	"bufio"
	"fmt"
	"net"
)

func main() {
	c, _ := net.Dial("tcp", "127.0.0.1:8080")
	defer c.Close()
	fmt.Fprintf(c, "GET /upgrade HTTP/1.1\r\nHost: localhost\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n")
	br := bufio.NewReader(c)
	for i := 0; i < 6; i++ {
		line, _ := br.ReadString('\n')
		fmt.Print("< ", line)
		if i < 5 {
			fmt.Fprintf(c, "ping%d\n", i)
		}
	}
}
```

Why hijack at all when `gorilla/websocket` exists: educational. Real WS implementations do exactly this — hijack, then implement RFC 6455 framing. Understanding the layering matters: `net/http` gives you HTTP semantics; once you upgrade, those semantics are gone and you're back to raw bytes. The same mechanism powers SSH-over-HTTP, gRPC's HTTP/2 streams (different layer though), and proxy tunneling via `CONNECT`.

</details>

---

### Task 18: Circuit-breaker Transport wrapper

**Goal.** Wrap `http.RoundTripper` with a circuit breaker that opens after 5 consecutive failures, half-opens after 30 seconds.

**Difficulty.** Staff

**Skills.** `http.RoundTripper`, state machines, atomic counters, time-based recovery.

**Setup.**
- A flaky upstream (sleep + random 500s).
- Your own `cbTransport` wrapping `http.DefaultTransport`.

**Steps.**
1. Define states: `closed`, `open`, `halfOpen`.
2. In `closed`: pass through; count consecutive failures (network err or 5xx).
3. On 5th failure: transition to `open` with `openedAt = time.Now()`.
4. In `open`: short-circuit immediately, return a sentinel `ErrCircuitOpen` without calling the next RT.
5. After 30 s in `open`: allow one request as `halfOpen`. Success → `closed` (reset counter). Failure → back to `open`.
6. Use atomics or a mutex; don't be sloppy about concurrent state transitions.

**Acceptance criteria.**
- 5 failures → 6th request immediately errors with `ErrCircuitOpen` (no upstream call).
- After 30 s, one probe is allowed; result determines next state.
- Concurrent requests during `open` all fail-fast; no thundering herd on the probe.

<details><summary>Hints</summary>

- The hardest bug is the "two probes at once" race. Guard the half-open transition with a single `CompareAndSwap` so only one request becomes the probe.
- Count failures atomically, but the state transition needs a mutex (or a CAS on a state field).
- Don't count *client* errors (4xx) as failures — those are caller bugs, not upstream failures.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"errors"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

type state int32

const (
	closed state = iota
	open
	halfOpen
)

var ErrCircuitOpen = errors.New("circuit breaker open")

type cbTransport struct {
	next         http.RoundTripper
	failThresh   int32
	resetAfter   time.Duration

	mu       sync.Mutex
	state    state
	failures int32
	openedAt time.Time
}

func (c *cbTransport) allow() (allowed bool, probe bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	switch c.state {
	case closed:
		return true, false
	case open:
		if time.Since(c.openedAt) >= c.resetAfter {
			c.state = halfOpen
			return true, true // first request after timeout = probe
		}
		return false, false
	case halfOpen:
		// Block other concurrent requests while the probe is in flight.
		return false, false
	}
	return false, false
}

func (c *cbTransport) onResult(err error, status int, isProbe bool) {
	failed := err != nil || status >= 500
	c.mu.Lock()
	defer c.mu.Unlock()
	if failed {
		if isProbe {
			c.state = open
			c.openedAt = time.Now()
			return
		}
		c.failures++
		if c.failures >= c.failThresh {
			c.state = open
			c.openedAt = time.Now()
		}
		return
	}
	// success
	c.failures = 0
	c.state = closed
}

func (c *cbTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	allowed, probe := c.allow()
	if !allowed {
		return nil, ErrCircuitOpen
	}
	resp, err := c.next.RoundTrip(req)
	status := 0
	if resp != nil {
		status = resp.StatusCode
	}
	c.onResult(err, status, probe)
	return resp, err
}

func main() {
	tr := &cbTransport{
		next:       http.DefaultTransport,
		failThresh: 5,
		resetAfter: 30 * time.Second,
	}
	client := &http.Client{Transport: tr}
	_ = client
	// use atomic.Pointer if you want lock-free; the mutex version is plenty fast
	_ = atomic.Int32{}
}
```

Why the lock vs atomic-only: state transition requires reading + checking + writing two fields (`state`, `openedAt`) consistently. Atomics can't atomically read-and-update two values without a CAS-loop, which is harder to get right than a tiny mutex. The mutex contention is irrelevant at HTTP RPS — your RT is microseconds, the lock is nanoseconds.

</details>

---

### Task 19: RoundTripper with retry, exponential backoff, jitter

**Goal.** Build a `retryTransport` that retries idempotent methods on 5xx and network errors using exponential backoff with full jitter, up to 3 attempts.

**Difficulty.** Staff

**Skills.** `RoundTripper`, request body rewind, jitter math, idempotency rules.

**Setup.**
- A flaky upstream returning 500 50% of the time.
- A non-idempotent endpoint (POST) and an idempotent one (GET).

**Steps.**
1. Wrap `http.DefaultTransport`.
2. Retry on `err != nil` or `resp.StatusCode >= 500`, but **only for idempotent methods** (GET, HEAD, PUT, DELETE, OPTIONS).
3. Compute backoff: `sleep = rand(0, min(cap, base * 2^attempt))` — "full jitter" from AWS architecture blog.
4. Respect `req.Context()` — abort retries if the context fires.
5. For requests with a body, you must rewind. Require `req.GetBody` to be non-nil (set automatically by `http.NewRequest` for `*bytes.Reader` / `*strings.Reader`).

**Acceptance criteria.**
- GET that 500s twice then 200s eventually returns 200 with the body.
- POST that 500s once is **not** retried (idempotency).
- Context cancellation during sleep aborts immediately.
- Two clients hitting the same flaky endpoint don't sync up on retries (jitter works).

<details><summary>Hints</summary>

- Full jitter beats fixed backoff and even exponential-no-jitter. Without jitter, all clients retry at the same instants and you create a thundering herd that re-breaks the upstream.
- Request body rewind: if `req.Body != nil`, you need `req.GetBody()` to get a fresh reader for each attempt. If `GetBody` is nil, you cannot retry — fail with a clear error.
- Don't retry on 4xx — those are client errors. Don't retry on `context.Canceled` — the caller asked you to stop.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"time"
)

type retryTransport struct {
	next     http.RoundTripper
	max      int
	base     time.Duration
	cap      time.Duration
}

func isIdempotent(m string) bool {
	switch m {
	case http.MethodGet, http.MethodHead, http.MethodPut, http.MethodDelete, http.MethodOptions:
		return true
	}
	return false
}

func (rt *retryTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if !isIdempotent(req.Method) {
		return rt.next.RoundTrip(req)
	}
	if req.Body != nil && req.GetBody == nil {
		return nil, errors.New("retryTransport: request body without GetBody is not retryable")
	}

	var resp *http.Response
	var err error
	for attempt := 0; attempt <= rt.max; attempt++ {
		if attempt > 0 {
			// rewind body for the retry
			if req.GetBody != nil {
				newBody, gerr := req.GetBody()
				if gerr != nil {
					return nil, fmt.Errorf("rewind body: %w", gerr)
				}
				req.Body = newBody
			}
			// full jitter: sleep = rand(0, min(cap, base*2^attempt))
			expo := rt.base << (attempt - 1)
			if expo > rt.cap {
				expo = rt.cap
			}
			sleep := time.Duration(rand.Int63n(int64(expo)))
			select {
			case <-time.After(sleep):
			case <-req.Context().Done():
				return nil, req.Context().Err()
			}
		}
		resp, err = rt.next.RoundTrip(req)
		if err == nil && resp.StatusCode < 500 {
			return resp, nil
		}
		if resp != nil {
			io.Copy(io.Discard, resp.Body) // drain so the conn can be reused
			resp.Body.Close()
		}
		// fall through to retry
	}
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func main() {
	client := &http.Client{
		Transport: &retryTransport{
			next: http.DefaultTransport,
			max:  3,
			base: 100 * time.Millisecond,
			cap:  2 * time.Second,
		},
		Timeout: 10 * time.Second,
	}
	req, _ := http.NewRequestWithContext(context.Background(), "GET", "http://localhost:8080/flaky", nil)
	resp, err := client.Do(req)
	if err != nil {
		fmt.Println("err:", err)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	fmt.Println(resp.StatusCode, string(body))
}
```

Why full jitter (`rand(0, expo)`) and not "decorrelated jitter" or "equal jitter": all three reduce thundering herds; full jitter is the simplest to reason about and produces the smoothest distribution. AWS's blog post on the topic measured similar performance for all three under simulated load. Pick the simplest and stop tuning. The real question is: are you retrying the right errors? POST without idempotency keys, retries on 4xx, and missing context-respect are far more common bugs than jitter formula choice.

</details>

---

### Task 20: Connection pool keyed by SNI for multi-tenant TLS

**Goal.** Build a per-tenant `http.Transport` pool where each tenant gets its own TLS config (its own client cert, CA bundle, and SNI), with safe lifecycle.

**Difficulty.** Staff

**Skills.** `crypto/tls.Config`, `tls.GetClientCertificate`, `Transport` lifecycle, sync.Map.

**Setup.**
- N tenants, each with their own keypair and trust bundle.
- A handler that receives `X-Tenant-ID` and proxies upstream using the tenant's certs.

**Steps.**
1. Define `type Tenant struct { ID string; Cert tls.Certificate; CAs *x509.CertPool; UpstreamHost string }`.
2. Build a `Pool` with a `sync.Map[string]*http.Transport`.
3. For each tenant, build a `Transport` with `TLSClientConfig: &tls.Config{Certificates: ..., RootCAs: tenant.CAs, ServerName: tenant.UpstreamHost}`.
4. On request, look up the transport; if absent, build (only one builder per tenant via singleflight or `sync.Once`).
5. Expose a `Close(tenantID)` that closes idle conns and removes the entry.
6. Periodically reap idle transports (LRU or TTL — pick one).

**Acceptance criteria.**
- Each tenant's connections show the right SNI on the wire (verify with `tcpdump -A`).
- Two tenants in flight do **not** share TCP conns even to the same backend host (different TLS configs = different conn pools).
- Removing a tenant closes idle conns and prevents reuse.
- Construction is concurrency-safe — 1000 parallel "first hits" for the same tenant build the transport exactly once.

<details><summary>Hints</summary>

- `http.Transport` keys conn pools by `connectMethodKey` which includes the TLS config's ServerName, NextProtos, etc. Different TLS configs naturally get different pools — no extra work needed.
- Use `golang.org/x/sync/singleflight` to dedupe concurrent transport-creation for the same tenant. `sync.Once` works too but is harder to evict.
- Don't share `*tls.Certificate` across mutable goroutines if you also rotate it. Wrap it in `tls.Config.GetClientCertificate` for hot-reload.
- `transport.CloseIdleConnections()` is the cleanup primitive when a tenant goes away.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

type Tenant struct {
	ID           string
	Cert         tls.Certificate
	CAs          *x509.CertPool
	UpstreamHost string // also used as SNI
}

type Pool struct {
	tenants map[string]*Tenant
	mu      sync.RWMutex

	transports sync.Map // map[string]*http.Transport
	sf         singleflight.Group
}

func NewPool(tenants []Tenant) *Pool {
	m := make(map[string]*Tenant, len(tenants))
	for i := range tenants {
		m[tenants[i].ID] = &tenants[i]
	}
	return &Pool{tenants: m}
}

func (p *Pool) buildTransport(t *Tenant) *http.Transport {
	return &http.Transport{
		TLSClientConfig: &tls.Config{
			Certificates: []tls.Certificate{t.Cert},
			RootCAs:      t.CAs,
			ServerName:   t.UpstreamHost, // SNI
			MinVersion:   tls.VersionTLS12,
		},
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 20,
		IdleConnTimeout:     90 * time.Second,
	}
}

func (p *Pool) For(tenantID string) (*http.Transport, error) {
	if v, ok := p.transports.Load(tenantID); ok {
		return v.(*http.Transport), nil
	}
	v, err, _ := p.sf.Do(tenantID, func() (any, error) {
		p.mu.RLock()
		t, ok := p.tenants[tenantID]
		p.mu.RUnlock()
		if !ok {
			return nil, errors.New("unknown tenant")
		}
		tr := p.buildTransport(t)
		actual, _ := p.transports.LoadOrStore(tenantID, tr)
		return actual, nil
	})
	if err != nil {
		return nil, err
	}
	return v.(*http.Transport), nil
}

func (p *Pool) Remove(tenantID string) {
	if v, ok := p.transports.LoadAndDelete(tenantID); ok {
		v.(*http.Transport).CloseIdleConnections()
	}
}

func main() {
	pool := NewPool([]Tenant{
		// populate with real certs/CAs
	})
	mux := http.NewServeMux()
	mux.HandleFunc("/call", func(w http.ResponseWriter, r *http.Request) {
		tid := r.Header.Get("X-Tenant-ID")
		tr, err := pool.For(tid)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		client := &http.Client{Transport: tr, Timeout: 5 * time.Second}
		resp, err := client.Get("https://" + tr.TLSClientConfig.ServerName + "/")
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		fmt.Fprintf(w, "tenant=%s status=%d\n", tid, resp.StatusCode)
	})
	http.ListenAndServe(":8080", mux)
}
```

Why this design over a single `Transport` with `GetClientCertificate`: a callback-based cert selection works *only* if the destination host is the same for all tenants. Once tenants point at different hosts (multi-region, vendor-per-tenant), you need different `ServerName` per request, and SNI is set at connection-establishment time — not per request. Different transports give you natural pool segregation. The downside: more memory (one transport per active tenant). At 100 K tenants, you'd switch to a LRU-evicted cache of transports keyed by hot-tenant ID, accepting cold-start latency for the long tail.

The singleflight wrap is the production-grade detail: when traffic stampedes for a tenant whose transport isn't built yet (say, a new tenant onboarding), 1000 concurrent requests trigger one build instead of 1000. `sync.Map.LoadOrStore` alone doesn't dedupe the *building* work — only the storing. `singleflight.Do` deduplicates the construction itself.

</details>

---

## Self-grading rubric

Score each task 0–3 and tally. Aim for >50 to consider this module complete.

- **0 — Skipped or copy-pasted reference without running.** No credit; come back later.
- **1 — Compiled and ran, but couldn't explain the trace.** You followed the steps; you don't yet *own* the behavior. Re-read the relevant source file with the running code in mind.
- **2 — Ran, explained, made one variation.** You understand the happy path. Push further: what breaks first under load? Where does the source disagree with your mental model?
- **3 — Ran, explained, made one variation, and identified at least one cross-cutting concern (timeouts, observability, security, lifecycle).** You're operating at the level where you'd ship this code. Move on.

Tally interpretation:

- **0–20**: Re-read `server.go` and `transport.go` slowly with a notebook. The exercises are testing whether you've internalized the architecture, not whether you can write Go.
- **21–40**: Mid-level — you can build with `net/http`, you need more reps on the failure modes (Tasks 4, 6, 11, 14, 18).
- **41–50**: Senior — you debug `net/http` issues by reading the source. The Staff-level tasks (18–20) are where you grow next.
- **51–60**: Staff — you've internalized the package well enough to design wrappers, custom RoundTrippers, and multi-tenant variants without copy-paste.

---

## Stretch challenges

Three larger projects that integrate the patterns above. Each is a 1–2 day exercise; treat them as portfolio-grade.

### Stretch 1: A drop-in replacement for `http.DefaultTransport` with observability baked in

Wrap `http.DefaultTransport` with a `RoundTripper` that emits OpenTelemetry spans, Prometheus metrics (RPS by host/status, p50/p95/p99 latency, conn reuse ratio), and structured logs — without changing call sites. The wrapped transport should be a single `New(opts ...Option) http.RoundTripper` constructor that callers swap in as `http.Client{Transport: obs.New()}`. Bonus: surface circuit-breaker and retry hooks as `Option`s so users can compose features without re-wrapping.

Acceptance: a microservice that previously used `http.DefaultTransport` should gain full observability with a one-line change, and zero new dependencies for callers other than `obs`.

### Stretch 2: A reverse proxy with sticky sessions, health checks, and admin API

Build a reverse proxy (`httputil.ReverseProxy`) that load-balances across N backends with three policies — round-robin, least-connections, and sticky-by-cookie. Run active health checks on a 5 s interval; drop unhealthy backends from rotation. Expose an admin API on `127.0.0.1:9000` that lets an operator drain a backend (`POST /drain/<id>`), force a health re-check, and dump the current backend table as JSON. Use the circuit-breaker pattern from Task 18 to fast-fail to other backends when one is misbehaving.

Acceptance: kill a backend during a `wrk` run; the proxy must shed traffic to the killed backend within one health-check interval, and the surviving backends should absorb the load with no 5xx visible to clients.

### Stretch 3: A multi-tenant TLS-terminating ingress

Combine Task 20's per-tenant transport pool with an ingress server that terminates TLS using `tls.Config.GetCertificate` (SNI-based cert selection on the *server* side this time). The ingress should look up the tenant by SNI, pick the right backend, and proxy via the tenant-specific upstream transport. Include cert hot-reload from disk (watch the directory; rebuild `tls.Config` atomically using `sync/atomic.Pointer[tls.Config]`). Run a benchmark: how many tenants can you serve from one box before TLS handshake CPU saturates? At what point does memory (one transport + one cert + one CA pool per tenant) become the bottleneck?

Acceptance: 10K tenants, 1K RPS aggregate, zero handshake failures, p99 < 100 ms. If you can't hit that on a 4-core box, profile and find out why — the answer is usually "TLS handshake CPU"; the fix is usually "share session tickets across handshakes by tuning `tls.Config.ClientSessionCache` or moving handshake to a sidecar". Document what you found.
