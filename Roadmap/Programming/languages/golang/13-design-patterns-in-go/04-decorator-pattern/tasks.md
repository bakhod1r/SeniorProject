# Decorator Pattern — Hands-on Tasks

Work through these in order. The first few drill the "wrap-and-delegate" shape from `junior.md` — a struct that implements the same interface, holds an `Inner`, and runs work around the call. The middle tasks force the design decisions in `middle.md` — struct vs function form, ordering invariants, statefulness, context propagation, embedding-based wrapping. The last few are open-ended mini-projects.

Run every solution with `go vet ./...` and `go test ./...` before moving on. Each task is self-contained — copy the solution into a fresh directory, `go mod init scratch`, then iterate.

You need Go 1.21 or later. Tasks 10 and 13 use generics. Task 7 and 19 use `net/http`. Task 8 uses `compress/gzip`. Task 16 uses `github.com/prometheus/client_golang`. Task 18 is a refactoring exercise — start from broken code, end with the decorator form.

---

## Task 1: Logging decorator for a counter service (warm-up)

A trivial in-memory counter service that you'll wrap with a logging decorator. The counter has two operations: `Incr(key string)` and `Value(key string) int`. The decorator logs every call before delegating.

```go
base := NewMemoryCounter()
counter := &LoggingCounter{Inner: base, Log: log.Default()}

counter.Incr("hits")
counter.Incr("hits")
fmt.Println(counter.Value("hits")) // 2
// Output (to stderr):
// counter: Incr(key=hits)
// counter: Incr(key=hits)
// counter: Value(key=hits) = 2
```

**Acceptance criteria**

- [ ] `Counter` interface with two methods: `Incr(key string)` and `Value(key string) int`.
- [ ] `MemoryCounter` is the base implementation using a `map[string]int` guarded by a mutex.
- [ ] `LoggingCounter` is a decorator that holds `Inner Counter` and `Log *log.Logger`, and logs each call before delegating.
- [ ] A `main()` exercises both directly and through the decorator.
- [ ] A test asserts that wrapping the counter does not change the observed values (transparency).

<details><summary>Hints</summary>

- The decorator must use a pointer receiver on `LoggingCounter` if it ever holds state. For this task it doesn't, but adopt the habit anyway — your next decorator will.
- For `Value`, log both the argument and the return value. That's the smallest useful trace.
- In the test, run a loop of `Incr` against both the base and the wrapped counter and compare the `Value` outputs.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"log"
	"os"
	"sync"
)

type Counter interface {
	Incr(key string)
	Value(key string) int
}

type MemoryCounter struct {
	mu sync.Mutex
	m  map[string]int
}

func NewMemoryCounter() *MemoryCounter {
	return &MemoryCounter{m: map[string]int{}}
}

func (c *MemoryCounter) Incr(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m[key]++
}

func (c *MemoryCounter) Value(key string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.m[key]
}

type LoggingCounter struct {
	Inner Counter
	Log   *log.Logger
}

func (l *LoggingCounter) Incr(key string) {
	l.Log.Printf("counter: Incr(key=%s)", key)
	l.Inner.Incr(key)
}

func (l *LoggingCounter) Value(key string) int {
	v := l.Inner.Value(key)
	l.Log.Printf("counter: Value(key=%s) = %d", key, v)
	return v
}

func main() {
	base := NewMemoryCounter()
	counter := &LoggingCounter{Inner: base, Log: log.New(os.Stderr, "", 0)}
	counter.Incr("hits")
	counter.Incr("hits")
	counter.Value("hits")
}
```

</details>

**Discussion.** This is the entire Decorator pattern in 30 lines. Notice three properties: the wrapper and the base implement the *same* interface (`Counter`); the wrapper holds an `Inner` of *interface* type, not the concrete struct (so it could wrap any other `Counter` later); and the wrapper *delegates* — it doesn't try to do the increment itself. Get this shape right and every other decorator is a variation. If your code reaches inside `Inner` to mutate fields, or has a different return type from `Inner`'s methods, something is off.

---

## Task 2: Retry decorator for an HTTP client

An HTTP client interface with one method: `Do(*http.Request) (*http.Response, error)`. Wrap it with a `RetryClient` decorator that retries transient failures up to N times with exponential backoff.

```go
base := &http.Client{Timeout: 10 * time.Second}
client := &RetryClient{
    Inner:    base,
    Attempts: 3,
    Backoff:  100 * time.Millisecond,
}

resp, err := client.Do(req) // retries up to 3 times on 5xx or network error
```

**Acceptance criteria**

- [ ] `HTTPDoer` interface: `Do(*http.Request) (*http.Response, error)`. (Match the `http.Client.Do` signature so `*http.Client` satisfies it directly.)
- [ ] `RetryClient` struct holds `Inner HTTPDoer`, `Attempts int`, `Backoff time.Duration`.
- [ ] Retry on network error (`err != nil`) *or* a 5xx status code.
- [ ] Do **not** retry 4xx — these are client errors, retrying won't help.
- [ ] Wait `Backoff << attempt` between tries (exponential).
- [ ] Honor `req.Context()` — abort retry loop if the context is cancelled.
- [ ] A test using `httptest.NewServer` returning 503 twice then 200 asserts exactly 3 calls were made.

<details><summary>Hints</summary>

- The HTTP request body is a single-read `io.Reader`. If you want to retry POSTs, you must `req.GetBody()` to rewind — or only retry methods where the body is `nil` (GET, DELETE, HEAD). For this task, assume idempotent requests.
- For exponential backoff: `wait := r.Backoff << attempt` — left-shift by attempt number.
- Use `time.NewTimer` + `select` over `ctx.Done()` and `timer.C` so the wait is cancelable.

</details>

<details><summary>Solution</summary>

```go
package retryclient

import (
	"errors"
	"fmt"
	"net/http"
	"time"
)

type HTTPDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type RetryClient struct {
	Inner    HTTPDoer
	Attempts int
	Backoff  time.Duration
}

func (r *RetryClient) Do(req *http.Request) (*http.Response, error) {
	if r.Attempts <= 0 {
		return nil, errors.New("RetryClient: Attempts must be > 0")
	}
	var lastErr error
	for i := 0; i < r.Attempts; i++ {
		resp, err := r.Inner.Do(req)
		if err == nil && resp.StatusCode < 500 {
			return resp, nil
		}
		if err == nil {
			// 5xx — discard the body so the connection can be reused.
			resp.Body.Close()
			lastErr = fmt.Errorf("status %d", resp.StatusCode)
		} else {
			lastErr = err
		}
		if i == r.Attempts-1 {
			break
		}
		wait := r.Backoff << i
		t := time.NewTimer(wait)
		select {
		case <-req.Context().Done():
			t.Stop()
			return nil, req.Context().Err()
		case <-t.C:
		}
	}
	return nil, fmt.Errorf("after %d attempts: %w", r.Attempts, lastErr)
}
```

</details>

**Discussion.** The decorator wraps any `HTTPDoer` — that includes `*http.Client` from the standard library, since its `Do` method has the matching signature. The interface is one method, defined in your package; `*http.Client` satisfies it implicitly. This is the small-interface dividend: you don't depend on the whole `http.Client` surface, just the method you care about.

Three subtleties worth internalizing: (1) status-code classification belongs in the decorator, not the caller — retry on 5xx, not 4xx; (2) the response body must be closed on the failure path or you'll leak file descriptors; (3) the context is a first-class citizen — every wait must be cancelable.

---

## Task 3: Cache decorator for a repository

A user repository with one method: `Get(ctx, id) (User, error)`. The base implementation hits the database. Wrap it with a `CachedRepo` decorator that caches results in memory with a TTL.

```go
db := NewDBRepo(dbConn)
repo := NewCachedRepo(db, 5*time.Minute)

u, _ := repo.Get(ctx, 42) // DB call
u, _ = repo.Get(ctx, 42)  // cached, no DB call
```

**Acceptance criteria**

- [ ] `Repo` interface: `Get(ctx context.Context, id int) (User, error)`.
- [ ] `DBRepo` simulates a DB by sleeping 10ms and returning `User{ID: id, Name: fmt.Sprintf("user_%d", id)}`. Track a call count to assert in tests.
- [ ] `CachedRepo` holds `Inner Repo`, a TTL, and a map of `id -> (User, expiresAt)`, guarded by a mutex.
- [ ] On hit: return the cached value without calling `Inner`.
- [ ] On miss or expired: delegate to `Inner`, store the result, return it.
- [ ] Errors from `Inner` are *not* cached.
- [ ] A test asserts: two `Get(42)` calls in succession produce one DB call; after the TTL expires, a third call produces a second DB call.

<details><summary>Hints</summary>

- Use `time.Now().Before(entry.expires)` to check freshness.
- The "errors not cached" rule is important: if the DB is down for one millisecond, caching the failure for the full TTL would extend the outage. Always check `err != nil` before storing.
- A simple `time.Sleep(10*time.Millisecond)` is enough to simulate latency for the test. You'll see one slow Get and one fast Get.

</details>

<details><summary>Solution</summary>

```go
package cacherepo

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

type User struct {
	ID   int
	Name string
}

type Repo interface {
	Get(ctx context.Context, id int) (User, error)
}

type DBRepo struct {
	Calls atomic.Int64
}

func NewDBRepo() *DBRepo { return &DBRepo{} }

func (d *DBRepo) Get(ctx context.Context, id int) (User, error) {
	d.Calls.Add(1)
	time.Sleep(10 * time.Millisecond)
	return User{ID: id, Name: fmt.Sprintf("user_%d", id)}, nil
}

type cacheEntry struct {
	user    User
	expires time.Time
}

type CachedRepo struct {
	Inner Repo
	TTL   time.Duration

	mu      sync.Mutex
	entries map[int]cacheEntry
}

func NewCachedRepo(inner Repo, ttl time.Duration) *CachedRepo {
	return &CachedRepo{Inner: inner, TTL: ttl, entries: map[int]cacheEntry{}}
}

func (c *CachedRepo) Get(ctx context.Context, id int) (User, error) {
	c.mu.Lock()
	e, ok := c.entries[id]
	c.mu.Unlock()
	if ok && time.Now().Before(e.expires) {
		return e.user, nil
	}
	u, err := c.Inner.Get(ctx, id)
	if err != nil {
		return User{}, err
	}
	c.mu.Lock()
	c.entries[id] = cacheEntry{user: u, expires: time.Now().Add(c.TTL)}
	c.mu.Unlock()
	return u, nil
}
```

</details>

**Discussion.** The decorator owns the cache state — concurrency, TTL, the data structure. The inner repo doesn't know caching exists. This is the payoff of small interfaces: a hundred-line decorator slots in front of a database with zero changes downstream. Two design choices to internalize: the cache state is *inside* the decorator (not on the inner type), and errors are never cached.

A common follow-up is "what about cache stampede?" — when ten goroutines simultaneously miss the same key and all hit the DB. The fix is `singleflight.Group` from `golang.org/x/sync/singleflight`, but adding it is another decorator level you'd layer on top. Don't blend concerns; each decorator does one thing.

---

## Task 4: Tracing decorator for a database client

A database client interface with `Query(ctx, sql, args...)` and `Exec(ctx, sql, args...)`. Wrap it with a `TracingDB` decorator that emits a span (logged to stdout for this exercise) per call, recording method, SQL, duration, and outcome.

```go
db := &TracingDB{Inner: &PostgresDB{...}}
rows, err := db.Query(ctx, "SELECT * FROM users WHERE id=$1", 42)
// trace: Query sql="SELECT * FROM users WHERE id=$1" args=[42] duration=12.3ms status=ok
```

**Acceptance criteria**

- [ ] `DB` interface: `Query(ctx, sql string, args ...any) ([]Row, error)`, `Exec(ctx, sql string, args ...any) (int64, error)`.
- [ ] `Row` is `map[string]any`.
- [ ] `MemDB` is the base implementation — returns a single hard-coded row for `Query`, returns `1` for `Exec`.
- [ ] `TracingDB` wraps any `DB` and logs each call's method, SQL, args, duration, and status (`ok` or `error: <msg>`).
- [ ] The trace must include both successful and failed calls. Use a named return error so a `defer` can read it.
- [ ] The decorator must redact arguments that look like passwords (any arg with type `string` and key name `password` — for this exercise, any string arg starting with `pw_` is "secret").
- [ ] A test captures stdout, runs a Query, and asserts the trace line matches the expected format.

<details><summary>Hints</summary>

- Named returns plus deferred functions are the canonical idiom for "do something after the call regardless of outcome":
  ```go
  func (t *TracingDB) Query(ctx context.Context, sql string, args ...any) (rows []Row, err error) {
      start := time.Now()
      defer func() { ... use err ... }()
      return t.Inner.Query(ctx, sql, args...)
  }
  ```
- Format the trace line with `fmt.Printf`; in real code you'd use OpenTelemetry, but the format is the lesson.

</details>

<details><summary>Solution</summary>

```go
package tracedb

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type Row = map[string]any

type DB interface {
	Query(ctx context.Context, sql string, args ...any) ([]Row, error)
	Exec(ctx context.Context, sql string, args ...any) (int64, error)
}

type MemDB struct{}

func (MemDB) Query(ctx context.Context, sql string, args ...any) ([]Row, error) {
	return []Row{{"id": 1, "name": "alice"}}, nil
}

func (MemDB) Exec(ctx context.Context, sql string, args ...any) (int64, error) {
	return 1, nil
}

type TracingDB struct {
	Inner DB
}

func redact(args []any) []any {
	out := make([]any, len(args))
	for i, a := range args {
		if s, ok := a.(string); ok && strings.HasPrefix(s, "pw_") {
			out[i] = "***"
		} else {
			out[i] = a
		}
	}
	return out
}

func (t *TracingDB) Query(ctx context.Context, sql string, args ...any) (rows []Row, err error) {
	start := time.Now()
	defer func() {
		status := "ok"
		if err != nil {
			status = "error: " + err.Error()
		}
		fmt.Printf("trace: Query sql=%q args=%v duration=%s status=%s\n",
			sql, redact(args), time.Since(start), status)
	}()
	return t.Inner.Query(ctx, sql, args...)
}

func (t *TracingDB) Exec(ctx context.Context, sql string, args ...any) (affected int64, err error) {
	start := time.Now()
	defer func() {
		status := "ok"
		if err != nil {
			status = "error: " + err.Error()
		}
		fmt.Printf("trace: Exec sql=%q args=%v duration=%s status=%s\n",
			sql, redact(args), time.Since(start), status)
	}()
	return t.Inner.Exec(ctx, sql, args...)
}
```

</details>

**Discussion.** Named returns plus deferred closures is *the* idiom for observability decorators. The deferred function reads the error after the inner call returns, including the case where the inner panics — though for panic safety you'd combine with a recovery decorator (Task 7). The redaction logic shows another aspect of a tracing decorator: it's responsible for not leaking sensitive data into logs. Argument scrubbing belongs inside the tracer, not at every call site.

Production tracing in Go uses OpenTelemetry (`otelhttp`, `otelsql`). Those packages are sophisticated decorators with the same structure. Reading their source after you've built this one is a good way to bridge from toy to production.

---

## Task 5: Rate-limit decorator

Wrap any operation with a rate-limit decorator that allows at most N calls per second. If the budget is exhausted, `Wait(ctx)` blocks until a token is available or the context is cancelled.

```go
api := NewAPIClient(httpClient)
limited := &RateLimitedAPI{
    Inner:   api,
    Limiter: rate.NewLimiter(rate.Limit(10), 5), // 10 rps, burst 5
}

for i := 0; i < 20; i++ {
    limited.Call(ctx, req) // first 5 instant; rest spaced ~100ms
}
```

**Acceptance criteria**

- [ ] `API` interface: `Call(ctx context.Context, req string) (string, error)`.
- [ ] `MemAPI` base implementation returns `"resp:" + req` after a short artificial delay.
- [ ] `RateLimitedAPI` holds `Inner API` and `*rate.Limiter` (from `golang.org/x/time/rate`).
- [ ] `Call` calls `limiter.Wait(ctx)` before delegating. If the wait fails (context cancelled), return the context error wrapped.
- [ ] A test fires 10 calls at a 5 rps limiter and asserts the elapsed time is at least 1 second (the limiter must have throttled).
- [ ] A test cancels the context during waiting and asserts the call returns the context error within ~10ms.

<details><summary>Hints</summary>

- `go get golang.org/x/time/rate` if you don't already have it.
- `limiter.Wait(ctx)` blocks until a token is available; returns `ctx.Err()` if the context is cancelled while waiting.
- The test for throttling: 10 calls at 5 rps with burst 5 — first 5 are instant, then 5 more spaced 200ms each — total ~1 second.

</details>

<details><summary>Solution</summary>

```go
package rl

import (
	"context"
	"fmt"
	"time"

	"golang.org/x/time/rate"
)

type API interface {
	Call(ctx context.Context, req string) (string, error)
}

type MemAPI struct{}

func (MemAPI) Call(ctx context.Context, req string) (string, error) {
	return "resp:" + req, nil
}

type RateLimitedAPI struct {
	Inner   API
	Limiter *rate.Limiter
}

func (r *RateLimitedAPI) Call(ctx context.Context, req string) (string, error) {
	if err := r.Limiter.Wait(ctx); err != nil {
		return "", fmt.Errorf("rate limited: %w", err)
	}
	return r.Inner.Call(ctx, req)
}

// Convenience constructor.
func NewRateLimitedAPI(inner API, rps float64, burst int) *RateLimitedAPI {
	return &RateLimitedAPI{Inner: inner, Limiter: rate.NewLimiter(rate.Limit(rps), burst)}
}

var _ time.Duration // keep time import in case test uses it
```

</details>

**Discussion.** The rate limiter from `x/time/rate` is already thread-safe; the decorator just delegates to it. That's the right division of responsibility — the decorator wires the limiter into the call path; the limiter handles the token-bucket math.

Two production refinements worth knowing: (1) per-key rate limiting — wrap a `sync.Map` of `key -> *rate.Limiter`, look up the limiter by the request's API key/user/route; (2) cooperative vs preemptive — `Wait` blocks; alternatively `Allow()` returns `false` immediately so the caller can fast-fail. Which one fits depends on whether the upstream tolerates retries with backoff or wants quick rejection.

---

## Task 6: Circuit breaker decorator

Wrap a service with a circuit breaker. After N consecutive failures, the breaker opens — subsequent calls fail fast for a cooldown period. After the cooldown, the breaker goes half-open and allows one probe call; success closes the breaker, failure re-opens it.

```go
breaker := &CircuitBreaker{
    Inner:            unreliableAPI,
    FailureThreshold: 5,
    OpenTimeout:      10 * time.Second,
}

_, err := breaker.Call(ctx, "ping") // fails fast if breaker is open
```

**Acceptance criteria**

- [ ] `API` interface: `Call(ctx, req string) (string, error)`.
- [ ] `CircuitBreaker` has three states: `Closed`, `Open`, `HalfOpen`.
- [ ] Closed: all calls go through. Track consecutive failures.
- [ ] Open: all calls return `ErrCircuitOpen` immediately. After `OpenTimeout`, transition to HalfOpen.
- [ ] HalfOpen: one call may go through. Success → Closed (reset failure count). Failure → Open (reset timer).
- [ ] State transitions are guarded by a mutex.
- [ ] A test simulates 5 consecutive failures and asserts the 6th call returns `ErrCircuitOpen` without invoking `Inner`.
- [ ] A test asserts that after `OpenTimeout`, the breaker allows a probe.

<details><summary>Hints</summary>

- Three states fit in `iota` constants.
- The "one probe at a time" in HalfOpen needs care under concurrency. A clean trick: in HalfOpen, transition optimistically to "Probing" before letting the call through, so only one goroutine wins.
- For the test, an `unreliableAPI` that always returns an error is enough.

</details>

<details><summary>Solution</summary>

```go
package breaker

import (
	"context"
	"errors"
	"sync"
	"time"
)

type API interface {
	Call(ctx context.Context, req string) (string, error)
}

type breakerState int

const (
	Closed breakerState = iota
	Open
	HalfOpen
)

var ErrCircuitOpen = errors.New("circuit breaker open")

type CircuitBreaker struct {
	Inner            API
	FailureThreshold int
	OpenTimeout      time.Duration

	mu       sync.Mutex
	state    breakerState
	failures int
	opened   time.Time
}

func (b *CircuitBreaker) Call(ctx context.Context, req string) (string, error) {
	if !b.allow() {
		return "", ErrCircuitOpen
	}
	resp, err := b.Inner.Call(ctx, req)
	b.record(err)
	return resp, err
}

func (b *CircuitBreaker) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	switch b.state {
	case Open:
		if time.Since(b.opened) > b.OpenTimeout {
			b.state = HalfOpen
			return true
		}
		return false
	case HalfOpen:
		// Allow exactly one probe — by transitioning back to Open until the probe
		// reports. The probe's record() call decides the next state.
		b.state = Open
		b.opened = time.Now()
		return true
	default:
		return true
	}
}

func (b *CircuitBreaker) record(err error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if err != nil {
		b.failures++
		if b.failures >= b.FailureThreshold {
			b.state = Open
			b.opened = time.Now()
		}
		return
	}
	b.state = Closed
	b.failures = 0
}
```

</details>

**Discussion.** Stateful decorators need state machines, and state machines need mutexes. This breaker is a small example: three states, two transitions on the call path. The non-trivial design choice is *which probe is allowed* in HalfOpen — if you naively return `true` whenever the state is HalfOpen, all concurrent goroutines slip through and stampede the upstream. The trick above is to flip back to Open inside `allow()` so the *next* probe re-checks the timer.

Real breakers (Sony/gobreaker, Netflix Hystrix) add more knobs: time windows for failure counting, percentage-based opening, half-open call quotas. The pattern stays the same — a decorator that wraps a `Call` method and decides whether to forward or short-circuit.

---

## Task 7: HTTP middleware chain (logging + recovery + auth)

Build the three classical middlewares — logging, recovery, auth — and a chain helper that composes them. Verify the order is what you expect.

```go
handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintln(w, "hello")
})

h := Chain(handler, Logging, Recover, Auth)
http.ListenAndServe(":8080", h)
```

**Acceptance criteria**

- [ ] `Middleware` type: `func(http.Handler) http.Handler`.
- [ ] `Logging` logs `<method> <path> <status> <duration>`. Capture status via a `ResponseWriter` wrapper.
- [ ] `Recover` catches panics and writes 500.
- [ ] `Auth` checks the `Authorization` header; if empty, write 401 and short-circuit.
- [ ] `Chain(h, mws...)` composes left-to-right — the first middleware in the slice is the outermost.
- [ ] A test fires a request that panics; asserts that the response is 500 and a panic log was emitted.
- [ ] A test asserts that an unauthenticated request returns 401 and doesn't reach the handler.

<details><summary>Hints</summary>

- The status-capturing `ResponseWriter` wrapper is a 5-line struct: `type statusRecorder struct { http.ResponseWriter; status int }` with `WriteHeader` overridden.
- `Chain` iterates the slice in reverse so the first middleware wraps last (ending up outermost).
- Use `httptest.NewRecorder` and `httptest.NewRequest` for the tests.

</details>

<details><summary>Solution</summary>

```go
package middleware

import (
	"log"
	"net/http"
	"runtime/debug"
	"time"
)

type Middleware func(http.Handler) http.Handler

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, rec.status, time.Since(start))
	})
}

func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("panic: %v\n%s", rec, debug.Stack())
				http.Error(w, "internal error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func Auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func Chain(h http.Handler, mws ...Middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}
```

</details>

**Discussion.** Three middlewares, one chain helper, the canonical pattern for every Go HTTP server. Note the order in `Chain(h, Logging, Recover, Auth)`: `Logging` is *outermost* — it sees the final status of every request including unauthorized ones and recovered panics. If you wanted to *not* log 401s, you'd reorder to `Chain(h, Auth, Logging, Recover)` — but then a panic in the handler would propagate up through Logging *after* `Auth` had been bypassed, and the log line would record a 500 from Recover. Each ordering is reasonable; choose deliberately.

The `statusRecorder` wrapper is itself a tiny decorator over `http.ResponseWriter` — the same pattern at a smaller scale. Once you start spotting decorators, you see them at every level of an HTTP server.

---

## Task 8: Compression decorator (io.Reader wrapping)

Build a `gzipReader` decorator that wraps an `io.Reader` and transparently decompresses gzipped bytes. Then build a `countingReader` that wraps any reader and exposes the number of bytes read. Stack them.

```go
f, _ := os.Open("data.gz")
defer f.Close()

gz, _ := newGzipReader(f)    // decompresses on the fly
ct := &countingReader{Inner: gz}

data, _ := io.ReadAll(ct)
fmt.Printf("decompressed %d bytes, read %d bytes from gz\n", len(data), ct.Count())
```

**Acceptance criteria**

- [ ] Both wrappers implement `io.Reader`.
- [ ] `gzipReader` uses `compress/gzip` internally; it satisfies `io.Reader` and `io.Closer` (close the underlying gzip reader on `Close`).
- [ ] `countingReader` wraps any `io.Reader`, forwards reads, and exposes a `Count() int64` method.
- [ ] A test writes a known string into a `bytes.Buffer` via `gzip.Writer`, wraps the buffer with the two decorators, reads through, and asserts the count and decompressed content.

<details><summary>Hints</summary>

- `gzip.NewReader(r io.Reader) (*gzip.Reader, error)` returns a `*gzip.Reader` which is already an `io.Reader`. Your `gzipReader` can be a thin wrapper that holds the `*gzip.Reader` and exposes `Read` + `Close`.
- `countingReader`'s `Read` reads from `Inner`, increments the counter by the read length, and returns.
- Use `atomic.Int64` for the counter if you'll read it from another goroutine; otherwise a plain `int64` is fine for the test.

</details>

<details><summary>Solution</summary>

```go
package iowrap

import (
	"compress/gzip"
	"io"
	"sync/atomic"
)

type gzipReader struct {
	gz *gzip.Reader
}

func newGzipReader(r io.Reader) (*gzipReader, error) {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return nil, err
	}
	return &gzipReader{gz: gz}, nil
}

func (g *gzipReader) Read(p []byte) (int, error) { return g.gz.Read(p) }
func (g *gzipReader) Close() error               { return g.gz.Close() }

type countingReader struct {
	Inner io.Reader
	count atomic.Int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.Inner.Read(p)
	c.count.Add(int64(n))
	return n, err
}

func (c *countingReader) Count() int64 { return c.count.Load() }
```

</details>

**Discussion.** This is decorator at the smallest scale — wrapping `io.Reader`, which has one method. The standard library is full of this: `bufio.NewReader`, `gzip.NewReader`, `lz4.NewReader`, `tls.Client(conn, ...)`. Each adds one layer of capability while keeping the interface unchanged. The lesson: when an interface is small and pure (no state, no side effects on construction), decorators stack endlessly without coupling.

Stacking matters here. `countingReader` over `gzipReader` over `*os.File` counts decompressed bytes after gzip. `countingReader` directly on `*os.File` counts compressed bytes from disk. Same wrapper, different placement, different answer. That's the power and the trap of decorators — placement is meaning.

---

## Task 9: Buffering decorator (io.Writer wrapping)

The mirror of Task 8 for the write side. Build a `bufferedWriter` decorator that buffers writes in memory and flushes on demand. Stack it with a `countingWriter` that tracks bytes written.

```go
f, _ := os.Create("out.txt")
ct := &countingWriter{Inner: f}
bw := newBufferedWriter(ct, 1024)

bw.Write([]byte("hello"))   // goes to buffer, not yet to file
bw.Flush()                  // now to file via ct
fmt.Println(ct.Count())     // 5
```

**Acceptance criteria**

- [ ] Both wrappers implement `io.Writer`.
- [ ] `bufferedWriter` collects writes up to a configurable buffer size; when full, it auto-flushes. Exposes an explicit `Flush() error`.
- [ ] `Close()` on `bufferedWriter` flushes and (if `Inner` is also an `io.Closer`) closes the inner writer.
- [ ] `countingWriter` exposes `Count() int64` for total bytes written to `Inner`.
- [ ] A test writes mixed-sized payloads, asserts that buffering triggers a flush only when full, and that the final `Flush` writes the residual.

<details><summary>Hints</summary>

- Don't reimplement `bufio.Writer` — but the structure (an internal `[]byte` and an `n int` for current size) is identical, and writing it once builds intuition.
- The "Close if `io.Closer`" pattern: type-assert `Inner.(io.Closer)` and call `Close` only if the assertion succeeds.

</details>

<details><summary>Solution</summary>

```go
package iowrap

import (
	"io"
	"sync/atomic"
)

type bufferedWriter struct {
	Inner io.Writer
	buf   []byte
	max   int
}

func newBufferedWriter(w io.Writer, size int) *bufferedWriter {
	return &bufferedWriter{Inner: w, buf: make([]byte, 0, size), max: size}
}

func (b *bufferedWriter) Write(p []byte) (int, error) {
	written := 0
	for len(p) > 0 {
		space := b.max - len(b.buf)
		if space == 0 {
			if err := b.Flush(); err != nil {
				return written, err
			}
			space = b.max
		}
		n := space
		if n > len(p) {
			n = len(p)
		}
		b.buf = append(b.buf, p[:n]...)
		p = p[n:]
		written += n
	}
	return written, nil
}

func (b *bufferedWriter) Flush() error {
	if len(b.buf) == 0 {
		return nil
	}
	_, err := b.Inner.Write(b.buf)
	b.buf = b.buf[:0]
	return err
}

func (b *bufferedWriter) Close() error {
	if err := b.Flush(); err != nil {
		return err
	}
	if c, ok := b.Inner.(io.Closer); ok {
		return c.Close()
	}
	return nil
}

type countingWriter struct {
	Inner io.Writer
	count atomic.Int64
}

func (c *countingWriter) Write(p []byte) (int, error) {
	n, err := c.Inner.Write(p)
	c.count.Add(int64(n))
	return n, err
}

func (c *countingWriter) Count() int64 { return c.count.Load() }
```

</details>

**Discussion.** The buffer decorator does something clever — it *changes the timing* of writes. The caller's perception is "Write returned, my data is safe", but the data is only in memory until Flush. This is one of the few times a decorator changes more than just "what runs around the call" — it changes the visible semantics of the operation. If the program crashes between Write and Flush, the buffered data is lost. That's the contract `bufio.Writer` carries too.

The "Close if `io.Closer`" idiom is worth memorizing. Many decorators must propagate Close — file descriptors, network connections, gzip footers — but the inner interface might not include Close. The type assertion is how you bridge the gap without expanding the interface.

---

## Task 10: Generic Map/Filter pipeline (Go 1.18+) using decorator

A streaming iterator with map and filter operations chained via decorators. Each operation returns a new iterator that decorates the previous one.

```go
nums := FromSlice([]int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10})
result := Filter(Map(nums, func(x int) int { return x * x }), func(x int) bool { return x > 20 })

for result.Next() {
    fmt.Println(result.Value()) // 25, 36, 49, 64, 81, 100
}
```

**Acceptance criteria**

- [ ] `Iter[T any]` interface: `Next() bool`, `Value() T`.
- [ ] `FromSlice[T](s []T) Iter[T]` returns a slice-backed iterator.
- [ ] `Map[T, U any](in Iter[T], f func(T) U) Iter[U]` decorates `in` with element-wise mapping.
- [ ] `Filter[T any](in Iter[T], pred func(T) bool) Iter[T]` decorates `in` with predicate filtering.
- [ ] Iterators are *lazy* — `Map` and `Filter` produce values on demand, not eagerly.
- [ ] A test asserts that the example above produces `[25 36 49 64 81 100]` in order.
- [ ] A test asserts that `Map` over an empty iterator returns no values.

<details><summary>Hints</summary>

- The returned iterator wraps the input. `Map` stores `in`, applies `f` inside `Value`.
- `Filter`'s `Next` loops over the inner iterator until it finds a match or exhausts the input.
- Cache the current value inside `Filter` so `Value` doesn't recompute or re-advance.

</details>

<details><summary>Solution</summary>

```go
package pipeline

type Iter[T any] interface {
	Next() bool
	Value() T
}

// slice-backed
type sliceIter[T any] struct {
	data []T
	pos  int
}

func FromSlice[T any](s []T) Iter[T] {
	return &sliceIter[T]{data: s, pos: -1}
}

func (s *sliceIter[T]) Next() bool {
	s.pos++
	return s.pos < len(s.data)
}

func (s *sliceIter[T]) Value() T {
	return s.data[s.pos]
}

// Map
type mapIter[T, U any] struct {
	in Iter[T]
	f  func(T) U
}

func Map[T, U any](in Iter[T], f func(T) U) Iter[U] {
	return &mapIter[T, U]{in: in, f: f}
}

func (m *mapIter[T, U]) Next() bool { return m.in.Next() }
func (m *mapIter[T, U]) Value() U   { return m.f(m.in.Value()) }

// Filter
type filterIter[T any] struct {
	in     Iter[T]
	pred   func(T) bool
	cached T
	has    bool
}

func Filter[T any](in Iter[T], pred func(T) bool) Iter[T] {
	return &filterIter[T]{in: in, pred: pred}
}

func (f *filterIter[T]) Next() bool {
	for f.in.Next() {
		v := f.in.Value()
		if f.pred(v) {
			f.cached = v
			f.has = true
			return true
		}
	}
	f.has = false
	return false
}

func (f *filterIter[T]) Value() T {
	return f.cached
}
```

</details>

**Discussion.** This is decorator composed through generics. Each combinator (`Map`, `Filter`) takes an `Iter[T]` and returns an `Iter[U]` that wraps it. Composition is just function application: `Filter(Map(...))`. The wrappers are lazy — values flow through the pipeline on demand, like UNIX pipes.

This is also how Go 1.23's `iter.Seq[T]` package shapes the standard streaming API. Once you've built this by hand, reading `slices.All`, `maps.Keys`, and the `iter` package documentation feels familiar — it's the same Decorator+Generics combo.

A caveat: error handling is missing from this design. Real iterator chains return either `(T, error)` or have a separate `Err()` method on the iterator. Decide upfront; retrofitting later is painful.

---

## Task 11: Request-ID injection middleware

A middleware that injects a `X-Request-ID` into incoming requests (generating one if absent) and into outgoing responses, and exposes the ID via `context.Context` so handlers can log it.

```go
chain := Chain(handler, RequestID, Logging)
http.Handle("/api", chain)
// Every request log line includes a unique request ID.
// Downstream handlers can call RequestIDFromContext(r.Context()) to retrieve it.
```

**Acceptance criteria**

- [ ] `RequestID` middleware: reads `X-Request-ID` header; if empty, generates a new ID (use `crypto/rand` to produce 8 random bytes hex-encoded).
- [ ] The middleware injects the ID into the request context via `context.WithValue` using a private key type.
- [ ] The middleware sets the `X-Request-ID` header on the response.
- [ ] An exported `RequestIDFromContext(ctx context.Context) (string, bool)` retrieves the ID.
- [ ] A `Logging` middleware that uses the request ID in its log line.
- [ ] A test sends a request without `X-Request-ID`, asserts the response has the header set, and the log line contains a non-empty ID.

<details><summary>Hints</summary>

- The "private key type" pattern: `type ctxKey struct{}`, then `var requestIDKey = ctxKey{}`. Using an empty struct type as the key avoids collisions with other packages.
- For the ID, `hex.EncodeToString(buf)` after reading from `rand.Reader` gives a compact unique identifier.
- The middleware must set the response header *before* the handler writes the body — once headers are sent, you can't change them.

</details>

<details><summary>Solution</summary>

```go
package reqid

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
)

type ctxKey struct{}

var requestIDKey = ctxKey{}

func RequestIDFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(requestIDKey).(string)
	return v, ok
}

func generateID() string {
	var buf [8]byte
	_, _ = rand.Read(buf[:])
	return hex.EncodeToString(buf[:])
}

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = generateID()
		}
		w.Header().Set("X-Request-ID", id)
		ctx := context.WithValue(r.Context(), requestIDKey, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
```

</details>

**Discussion.** The decorator does three things at once: generation, propagation via context, and reflection back via response header. Each is one line; together they're a critical operational tool. Request IDs in logs let you trace a single request across services — without them, distributed debugging is nearly impossible.

The private key type pattern (`type ctxKey struct{}`) is the standard Go idiom for context keys. The empty struct type is unforgeable from outside the package — no one can accidentally collide with your key. `context.WithValue` documentation explicitly recommends this.

A subtle point: the middleware sets the response header *before* the handler runs, but the handler might call `WriteHeader` (which "freezes" the headers). Order matters — set the header in the middleware, then call `next.ServeHTTP`.

---

## Task 12: Timeout decorator using context

A timeout decorator that wraps any context-aware operation and aborts the inner call after a deadline.

```go
op := &TimedOp{Inner: slowAPI, Timeout: 100 * time.Millisecond}
result, err := op.Run(ctx, "request")
// err is context.DeadlineExceeded if Inner takes >100ms
```

**Acceptance criteria**

- [ ] `Op` interface: `Run(ctx context.Context, input string) (string, error)`.
- [ ] `SlowOp` base implementation sleeps a configurable duration before returning.
- [ ] `TimedOp` derives a context with `context.WithTimeout` and passes it to `Inner.Run`.
- [ ] The decorator *must not* discard the caller's context — derive from it.
- [ ] Cancel function must be deferred to avoid context leaks.
- [ ] A test asserts: SlowOp(50ms) wrapped with Timeout(100ms) succeeds; SlowOp(200ms) wrapped with Timeout(100ms) returns `context.DeadlineExceeded`.

<details><summary>Hints</summary>

- `context.WithTimeout` returns a derived context and a cancel function. Always defer the cancel; otherwise the timer leaks even after the operation finishes.
- The inner op must honor the context: use `select { case <-ctx.Done(): ...; case <-time.After(sleep): ... }`.

</details>

<details><summary>Solution</summary>

```go
package timed

import (
	"context"
	"time"
)

type Op interface {
	Run(ctx context.Context, input string) (string, error)
}

type SlowOp struct {
	Duration time.Duration
}

func (s SlowOp) Run(ctx context.Context, input string) (string, error) {
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case <-time.After(s.Duration):
		return "done:" + input, nil
	}
}

type TimedOp struct {
	Inner   Op
	Timeout time.Duration
}

func (t *TimedOp) Run(ctx context.Context, input string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, t.Timeout)
	defer cancel()
	return t.Inner.Run(ctx, input)
}
```

</details>

**Discussion.** Three rules for context decorators: (1) derive from the caller's context, never from `context.Background()` — otherwise you discard the parent's deadline and cancellation; (2) defer cancel — even if `WithTimeout` fires, calling `cancel` releases the timer resource; (3) the inner op must honor the context — wrapping a non-context-aware operation with a timeout is pointless because nothing will check `ctx.Done()`.

Common bug: returning before `defer cancel()` is set up. If the decorator returns early without calling cancel, the goroutine that monitors the timeout leaks. `defer` first, then the call.

---

## Task 13: gRPC unary interceptor (similar pattern)

A unary interceptor in gRPC has the signature `func(ctx, req, info, handler)`. It's the gRPC framework's name for a decorator. Build a logging interceptor that wraps a fake gRPC-style handler chain.

```go
type Handler func(ctx context.Context, req any) (any, error)
type Interceptor func(ctx context.Context, req any, info *Info, next Handler) (any, error)

chain := WrapInterceptors(handler, LoggingInterceptor, AuthInterceptor)
chain(ctx, request)
```

**Acceptance criteria**

- [ ] `Handler` type: `func(ctx context.Context, req any) (any, error)`.
- [ ] `Interceptor` type: `func(ctx, req, info *Info, next Handler) (any, error)`.
- [ ] `Info` struct holds `Method string` (the RPC method name).
- [ ] `LoggingInterceptor`: logs method, duration, and result status.
- [ ] `AuthInterceptor`: returns `errUnauthenticated` if `Info.Method` requires auth and `ctx` has no `"user"` value.
- [ ] `WrapInterceptors(h Handler, info *Info, ics ...Interceptor) Handler` composes interceptors with the first one outermost.
- [ ] A test asserts that an authenticated request reaches the handler and an unauthenticated one does not.

<details><summary>Hints</summary>

- The composition trick: each interceptor receives `next Handler` and returns a new handler. Iterating the slice in reverse — wrapping `next` with `ic[i](next)` — produces the chain where `ic[0]` runs first.
- Build the chain incrementally: start from the base handler, wrap with the last interceptor, then the second-to-last, etc.

</details>

<details><summary>Solution</summary>

```go
package interceptor

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"
)

type Handler func(ctx context.Context, req any) (any, error)

type Info struct {
	Method string
}

type Interceptor func(ctx context.Context, req any, info *Info, next Handler) (any, error)

var ErrUnauthenticated = errors.New("unauthenticated")

func LoggingInterceptor(ctx context.Context, req any, info *Info, next Handler) (any, error) {
	start := time.Now()
	resp, err := next(ctx, req)
	log.Printf("%s took %s err=%v", info.Method, time.Since(start), err)
	return resp, err
}

func AuthInterceptor(ctx context.Context, req any, info *Info, next Handler) (any, error) {
	if _, ok := ctx.Value("user").(string); !ok {
		return nil, fmt.Errorf("%s: %w", info.Method, ErrUnauthenticated)
	}
	return next(ctx, req)
}

func WrapInterceptors(h Handler, info *Info, ics ...Interceptor) Handler {
	// Compose so that ics[0] is outermost.
	for i := len(ics) - 1; i >= 0; i-- {
		ic := ics[i]
		inner := h
		h = func(ctx context.Context, req any) (any, error) {
			return ic(ctx, req, info, inner)
		}
	}
	return h
}
```

</details>

**Discussion.** gRPC interceptors are decorators with a four-parameter signature instead of one. The pattern is otherwise identical to HTTP middleware — wrap a handler with another handler that does work around the call. The real `google.golang.org/grpc` package uses essentially this composition; reading the source after building this exercise is worthwhile.

The closure capture inside the loop (`inner := h`, then `h = func(...) { ic(ctx, req, info, inner) }`) is the canonical way to build a chain incrementally without losing references. Without the local `inner` binding, the closure would capture the *loop variable* `h`, which keeps getting reassigned, and every iteration's closure would end up referencing the same final handler. In Go 1.22+ the loop variable is per-iteration, but the explicit binding makes intent clear regardless.

---

## Task 14: Embedding-based decorator (large interface with selective override)

Use Go's struct embedding to decorate a large interface where you only want to override one method. The other methods are promoted automatically.

```go
type PaymentGateway interface {
    Charge(ctx context.Context, amount int) error
    Refund(ctx context.Context, id string) error
    Authorize(ctx context.Context, amount int) (string, error)
    Capture(ctx context.Context, authID string) error
    Void(ctx context.Context, authID string) error
}

type LoggingGateway struct {
    PaymentGateway      // embedded — promotes all 5 methods
    log *log.Logger
}

// Override only Charge; the other four are unchanged.
func (l *LoggingGateway) Charge(ctx context.Context, amount int) error {
    l.log.Printf("Charge: %d", amount)
    return l.PaymentGateway.Charge(ctx, amount)
}
```

**Acceptance criteria**

- [ ] `PaymentGateway` interface with the five methods above.
- [ ] `StripeGateway` implements all five (toy implementations that log to a buffer).
- [ ] `LoggingGateway` embeds `PaymentGateway` and overrides only `Charge`.
- [ ] A test asserts: `Charge` produces a log entry; `Refund` and the others do *not* (they're delegated transparently).
- [ ] A test asserts: removing the `Charge` override would cause the test for "Charge is logged" to fail. (Just write a comment in the test explaining this.)
- [ ] Bonus: write a `TimingGateway` (also embedding-based) that overrides `Charge` and `Authorize` only.

<details><summary>Hints</summary>

- The embedded field's name is the type's name (`PaymentGateway` here). Access it as `l.PaymentGateway`.
- If `StripeGateway` is passed in as a `PaymentGateway`, the embedding holds the *interface* value, so method calls go through interface dispatch. That's fine.
- If you embed `*StripeGateway` (concrete pointer) instead, the wrapper would be tied to that one implementation — exactly what we *don't* want.

</details>

<details><summary>Solution</summary>

```go
package gateway

import (
	"context"
	"fmt"
	"io"
	"log"
	"time"
)

type PaymentGateway interface {
	Charge(ctx context.Context, amount int) error
	Refund(ctx context.Context, id string) error
	Authorize(ctx context.Context, amount int) (string, error)
	Capture(ctx context.Context, authID string) error
	Void(ctx context.Context, authID string) error
}

type StripeGateway struct {
	w io.Writer
}

func NewStripeGateway(w io.Writer) *StripeGateway { return &StripeGateway{w: w} }

func (s *StripeGateway) Charge(ctx context.Context, amount int) error {
	fmt.Fprintf(s.w, "stripe.Charge(%d)\n", amount)
	return nil
}
func (s *StripeGateway) Refund(ctx context.Context, id string) error {
	fmt.Fprintf(s.w, "stripe.Refund(%s)\n", id)
	return nil
}
func (s *StripeGateway) Authorize(ctx context.Context, amount int) (string, error) {
	fmt.Fprintf(s.w, "stripe.Authorize(%d)\n", amount)
	return "auth_1", nil
}
func (s *StripeGateway) Capture(ctx context.Context, authID string) error {
	fmt.Fprintf(s.w, "stripe.Capture(%s)\n", authID)
	return nil
}
func (s *StripeGateway) Void(ctx context.Context, authID string) error {
	fmt.Fprintf(s.w, "stripe.Void(%s)\n", authID)
	return nil
}

type LoggingGateway struct {
	PaymentGateway
	log *log.Logger
}

func NewLoggingGateway(inner PaymentGateway, log *log.Logger) *LoggingGateway {
	return &LoggingGateway{PaymentGateway: inner, log: log}
}

func (l *LoggingGateway) Charge(ctx context.Context, amount int) error {
	l.log.Printf("Charge: %d", amount)
	return l.PaymentGateway.Charge(ctx, amount)
}

type TimingGateway struct {
	PaymentGateway
	log *log.Logger
}

func NewTimingGateway(inner PaymentGateway, log *log.Logger) *TimingGateway {
	return &TimingGateway{PaymentGateway: inner, log: log}
}

func (t *TimingGateway) Charge(ctx context.Context, amount int) (err error) {
	start := time.Now()
	defer func() { t.log.Printf("Charge took %s err=%v", time.Since(start), err) }()
	return t.PaymentGateway.Charge(ctx, amount)
}

func (t *TimingGateway) Authorize(ctx context.Context, amount int) (id string, err error) {
	start := time.Now()
	defer func() { t.log.Printf("Authorize took %s err=%v", time.Since(start), err) }()
	return t.PaymentGateway.Authorize(ctx, amount)
}
```

</details>

**Discussion.** Embedding is the right tool when the interface has many methods and most don't need decoration. Without it, `LoggingGateway` would need five method shims, four of which would be one-line passthroughs. With embedding, you write only what's interesting.

The trade-off is two-fold. (1) If the interface grows a new method, your wrapper silently inherits it without decoration — a new `Subscribe` method on `PaymentGateway` won't be logged until someone notices. (2) The embedded field is public by default; callers can mutate `lg.PaymentGateway = otherGateway` mid-flight. Both are mild — for internal code, the brevity wins; for published libraries with strict invariants, hand-written shims are safer.

---

## Task 15: Conditional middleware (If helper, identity decorator)

Sometimes a middleware should only apply when a config flag is set. Build an `If(cond, mw)` helper that returns the middleware if `cond` is true, otherwise returns an identity (no-op) middleware.

```go
chain := Chain(handler,
    If(cfg.UseAuth, Auth),
    If(cfg.Debug, Logging),
    Recover, // always on
)
```

**Acceptance criteria**

- [ ] `Identity` is a no-op middleware: `func Identity(next http.Handler) http.Handler { return next }`.
- [ ] `If(cond bool, mw Middleware) Middleware` returns `mw` if `cond` is true, otherwise `Identity`.
- [ ] `Unless(cond, mw)` — the inverse, for completeness.
- [ ] A test asserts: `If(true, mw)` produces output identical to `mw`; `If(false, mw)` produces output identical to the bare handler.
- [ ] Bonus: build a `FirstOf(conds ...Middleware) Middleware` that runs the first non-Identity middleware (useful for "fall through" patterns).

<details><summary>Hints</summary>

- `Identity` is a one-liner.
- The test for "If(true, mw)" is structurally identical to "just call mw" — wire both up to the same response recorder and compare bytes.

</details>

<details><summary>Solution</summary>

```go
package condmw

import "net/http"

type Middleware func(http.Handler) http.Handler

func Identity(next http.Handler) http.Handler { return next }

func If(cond bool, mw Middleware) Middleware {
	if cond {
		return mw
	}
	return Identity
}

func Unless(cond bool, mw Middleware) Middleware {
	if cond {
		return Identity
	}
	return mw
}

// FirstOf returns the first middleware in mws that is not the identity.
// Useful when several middlewares are conditional and exactly one should win.
func FirstOf(mws ...Middleware) Middleware {
	for _, m := range mws {
		if !isIdentity(m) {
			return m
		}
	}
	return Identity
}

func isIdentity(m Middleware) bool {
	// Identity is a top-level function; comparing function values by address works.
	// We compare by *passing a known handler through* and checking it's unchanged.
	probe := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	return funcsEqual(m(probe), probe)
}

func funcsEqual(a, b http.Handler) bool {
	// Equality between interface values: same dynamic type and value.
	return a == b
}
```

</details>

**Discussion.** The identity function as a no-op decorator is a small but important idea. Without it, every conditional middleware turns into an `if-else` at the chain-construction site, splitting the chain into two parallel definitions and inviting drift. With `If`, the chain reads top-down as a flat list, and the conditionals are inline.

The `FirstOf` helper is a more advanced version of the same idea — when several middlewares are mutually exclusive (e.g., "use OAuth2 *or* SAML *or* none"), `FirstOf` collapses the disjunction into one slot.

Functional programmers will recognize this as `id ∘ f = f` and `f ∘ id = f` — the identity element of decorator composition. The composition is associative, and identity is its neutral. That makes the middleware chain a monoid in a strict mathematical sense, which is occasionally useful for reasoning about it.

---

## Task 16: Metrics decorator with Prometheus

Wrap a service with a decorator that records Prometheus metrics — request count, error count, and latency histogram.

```go
api := &MetricsAPI{
    Inner: realAPI,
    requests: prometheus.NewCounterVec(...),
    errors:   prometheus.NewCounterVec(...),
    duration: prometheus.NewHistogramVec(...),
}

api.Call(ctx, "foo") // increments requests{method="Call"}, records duration
```

**Acceptance criteria**

- [ ] Add `github.com/prometheus/client_golang/prometheus` to go.mod (`go get` it).
- [ ] `API` interface: `Call(ctx context.Context, req string) (string, error)`.
- [ ] `MetricsAPI` decorator increments a counter on every call, an error counter on failure, and observes the duration in a histogram.
- [ ] Labels: `method="Call"`, `status="ok"` or `"error"`.
- [ ] A test calls the decorator several times and asserts metric values via `testutil.ToFloat64`.

<details><summary>Hints</summary>

- The `*prometheus.CounterVec` and `*prometheus.HistogramVec` need labels; create them with `prometheus.NewCounterVec(prometheus.CounterOpts{Name: ...}, []string{"method", "status"})`.
- Use `WithLabelValues("Call", "ok").Inc()` to increment.
- The `testutil` package (`github.com/prometheus/client_golang/prometheus/testutil`) exposes `ToFloat64(c prometheus.Collector) float64` for reading a single-cell metric.

</details>

<details><summary>Solution</summary>

```go
package metricsdec

import (
	"context"
	"errors"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

type API interface {
	Call(ctx context.Context, req string) (string, error)
}

type MetricsAPI struct {
	Inner    API
	Requests *prometheus.CounterVec
	Errors   *prometheus.CounterVec
	Duration *prometheus.HistogramVec
}

func NewMetricsAPI(inner API, reg prometheus.Registerer) *MetricsAPI {
	m := &MetricsAPI{
		Inner: inner,
		Requests: prometheus.NewCounterVec(
			prometheus.CounterOpts{Name: "api_requests_total", Help: "API requests"},
			[]string{"method", "status"},
		),
		Errors: prometheus.NewCounterVec(
			prometheus.CounterOpts{Name: "api_errors_total", Help: "API errors"},
			[]string{"method"},
		),
		Duration: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{Name: "api_duration_seconds", Help: "API duration"},
			[]string{"method"},
		),
	}
	if reg != nil {
		reg.MustRegister(m.Requests, m.Errors, m.Duration)
	}
	return m
}

func (m *MetricsAPI) Call(ctx context.Context, req string) (resp string, err error) {
	start := time.Now()
	defer func() {
		status := "ok"
		if err != nil {
			status = "error"
			m.Errors.WithLabelValues("Call").Inc()
		}
		m.Requests.WithLabelValues("Call", status).Inc()
		m.Duration.WithLabelValues("Call").Observe(time.Since(start).Seconds())
	}()
	return m.Inner.Call(ctx, req)
}

// Toy implementation for the test.
type FlakyAPI struct{ FailEvery int; n int }

func (f *FlakyAPI) Call(ctx context.Context, req string) (string, error) {
	f.n++
	if f.FailEvery > 0 && f.n%f.FailEvery == 0 {
		return "", errors.New("flake")
	}
	return "resp:" + req, nil
}
```

</details>

**Discussion.** Metrics decorators follow the same pattern as tracing decorators (Task 4) — named return, deferred closure, observe both success and failure. The difference is what the closure does with the result: tracing logs, metrics observe. Many real systems combine both into a single "observability" decorator, but separating them is cleaner because they have different operational owners (tracing for SRE, metrics for product).

A practical detail: metric registration is global by default (`prometheus.MustRegister`), which makes testing flaky. The constructor above takes an explicit `prometheus.Registerer`, so tests can pass a fresh `prometheus.NewRegistry()` and assert in isolation. Always inject the registry — never use the default.

---

## Task 17: Decorator chain order verification test

Write a test that proves the order of decorators in a chain. The test should not just observe one outcome — it should record the actual ordering of "before" and "after" events at each layer.

```go
// Given: Chain(handler, A, B, C)
// Want assertion: ["A:before", "B:before", "C:before", "handler", "C:after", "B:after", "A:after"]
```

**Acceptance criteria**

- [ ] `Recorder` type collects ordered events.
- [ ] Three middlewares `A`, `B`, `C` each append `"X:before"` before delegating and `"X:after"` after.
- [ ] `TestChainOrder` builds the chain, runs one request, and asserts the recorded sequence matches expectations.
- [ ] A second test reverses the chain and asserts the *opposite* order.
- [ ] Use `reflect.DeepEqual` or `slices.Equal` for the comparison.

<details><summary>Hints</summary>

- The recorder is just a slice; pass it as a closure variable into each middleware.
- The handler itself records `"handler"` so you can see where the inner work falls.
- `httptest.NewRecorder()` and `httptest.NewRequest("GET", "/", nil)` give you a fake request/response pair.

</details>

<details><summary>Solution</summary>

```go
package chainorder

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

type Middleware func(http.Handler) http.Handler

func Chain(h http.Handler, mws ...Middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

func recordingMW(name string, rec *[]string) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			*rec = append(*rec, name+":before")
			next.ServeHTTP(w, r)
			*rec = append(*rec, name+":after")
		})
	}
}

func TestChainOrder(t *testing.T) {
	var rec []string
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec = append(rec, "handler")
	})

	chain := Chain(h, recordingMW("A", &rec), recordingMW("B", &rec), recordingMW("C", &rec))
	chain.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))

	want := []string{"A:before", "B:before", "C:before", "handler", "C:after", "B:after", "A:after"}
	if !slices.Equal(rec, want) {
		t.Errorf("got %v, want %v", rec, want)
	}
}

func TestChainOrderReversed(t *testing.T) {
	var rec []string
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec = append(rec, "handler")
	})

	chain := Chain(h, recordingMW("C", &rec), recordingMW("B", &rec), recordingMW("A", &rec))
	chain.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))

	want := []string{"C:before", "B:before", "A:before", "handler", "A:after", "B:after", "C:after"}
	if !slices.Equal(rec, want) {
		t.Errorf("got %v, want %v", rec, want)
	}
}
```

</details>

**Discussion.** Tests for chain order are essential because order is implicit in the code — there's no compile-time check that `Logging` runs before `Auth`. The test above turns the implicit into the explicit: it records the actual sequence of events and compares to expectations.

For complex chains in production, write one of these tests per "ordering invariant" you care about. The test is cheap to write (a recorder slice and a few `append`s per middleware) and catches regressions where someone reorders middlewares to fix one bug and breaks another.

A related diagnostic: at server startup, log the chain configuration as a single line ("middleware order: Trace > Recover > Auth > Logging > handler"). When the system misbehaves at 2am, that log line is the first thing you'll want.

---

## Task 18: Refactor — convert duplicated try/log/return code into a decorator

You're handed a `OrderService` with three methods, each starting with the same eight lines of "log start, run, log end, log error if any". Refactor it into a decorator.

Starting code (broken — has the duplication):

```go
type OrderService struct{ db *DB }

func (s *OrderService) Create(ctx context.Context, o Order) (int, error) {
    log.Printf("Create: start order=%+v", o)
    start := time.Now()
    id, err := s.db.InsertOrder(ctx, o)
    if err != nil {
        log.Printf("Create: error after %s: %v", time.Since(start), err)
        return 0, err
    }
    log.Printf("Create: done in %s id=%d", time.Since(start), id)
    return id, nil
}

func (s *OrderService) Cancel(ctx context.Context, id int) error {
    log.Printf("Cancel: start id=%d", id)
    start := time.Now()
    err := s.db.MarkCancelled(ctx, id)
    if err != nil {
        log.Printf("Cancel: error after %s: %v", time.Since(start), err)
        return err
    }
    log.Printf("Cancel: done in %s", time.Since(start))
    return nil
}

func (s *OrderService) Get(ctx context.Context, id int) (Order, error) {
    log.Printf("Get: start id=%d", id)
    start := time.Now()
    o, err := s.db.FetchOrder(ctx, id)
    if err != nil {
        log.Printf("Get: error after %s: %v", time.Since(start), err)
        return Order{}, err
    }
    log.Printf("Get: done in %s order=%+v", time.Since(start), o)
    return o, nil
}
```

**Acceptance criteria**

- [ ] Define an `OrderService` interface with `Create`, `Cancel`, `Get` (matching the signatures above).
- [ ] Move the database-only logic into `DBOrderService` (no logging).
- [ ] Create a `LoggingOrderService` decorator that adds the start/end/error logging.
- [ ] Each decorated method must use named returns + deferred closure to read the error.
- [ ] A test asserts that wrapping `DBOrderService` with `LoggingOrderService` produces logs identical (modulo timestamps) to the original code.

<details><summary>Hints</summary>

- Named returns let the deferred closure read the error: `func (l *LoggingOrderService) Get(...) (o Order, err error) { defer func() { ... } }`.
- All three methods share the same logging shape; you might be tempted to extract a generic helper. For Go pre-1.18 you'd write three near-duplicates; with generics, you *could* write one. For this exercise, write three — clarity beats abstraction at this small scale.
- The deferred closure can format the result based on the method name. Inline the method name as a string literal.

</details>

<details><summary>Solution</summary>

```go
package orders

import (
	"context"
	"log"
	"time"
)

type Order struct {
	ID    int
	Items []string
}

type OrderService interface {
	Create(ctx context.Context, o Order) (int, error)
	Cancel(ctx context.Context, id int) error
	Get(ctx context.Context, id int) (Order, error)
}

// DBOrderService is the bare implementation. Tests can swap this for a fake.
type DBOrderService struct {
	db *DB
}

func (s *DBOrderService) Create(ctx context.Context, o Order) (int, error) {
	return s.db.InsertOrder(ctx, o)
}
func (s *DBOrderService) Cancel(ctx context.Context, id int) error {
	return s.db.MarkCancelled(ctx, id)
}
func (s *DBOrderService) Get(ctx context.Context, id int) (Order, error) {
	return s.db.FetchOrder(ctx, id)
}

// LoggingOrderService is the decorator.
type LoggingOrderService struct {
	Inner OrderService
	Log   *log.Logger
}

func (l *LoggingOrderService) Create(ctx context.Context, o Order) (id int, err error) {
	l.Log.Printf("Create: start order=%+v", o)
	start := time.Now()
	defer func() {
		if err != nil {
			l.Log.Printf("Create: error after %s: %v", time.Since(start), err)
		} else {
			l.Log.Printf("Create: done in %s id=%d", time.Since(start), id)
		}
	}()
	return l.Inner.Create(ctx, o)
}

func (l *LoggingOrderService) Cancel(ctx context.Context, id int) (err error) {
	l.Log.Printf("Cancel: start id=%d", id)
	start := time.Now()
	defer func() {
		if err != nil {
			l.Log.Printf("Cancel: error after %s: %v", time.Since(start), err)
		} else {
			l.Log.Printf("Cancel: done in %s", time.Since(start))
		}
	}()
	return l.Inner.Cancel(ctx, id)
}

func (l *LoggingOrderService) Get(ctx context.Context, id int) (o Order, err error) {
	l.Log.Printf("Get: start id=%d", id)
	start := time.Now()
	defer func() {
		if err != nil {
			l.Log.Printf("Get: error after %s: %v", time.Since(start), err)
		} else {
			l.Log.Printf("Get: done in %s order=%+v", time.Since(start), o)
		}
	}()
	return l.Inner.Get(ctx, id)
}

// DB stub.
type DB struct{}

func (DB) InsertOrder(ctx context.Context, o Order) (int, error) { return 1, nil }
func (DB) MarkCancelled(ctx context.Context, id int) error       { return nil }
func (DB) FetchOrder(ctx context.Context, id int) (Order, error) { return Order{ID: id}, nil }
```

</details>

**Discussion.** The refactor's payoff: the database methods are now *just* database code. If you decide later to drop logging in tests, swap to JSON-structured logs, or add tracing, the database service doesn't change. Each cross-cutting concern lives in its own decorator.

The duplication that survives — three decorator methods all shaped the same — is real and irreducible without generics. With Go 1.18+ generics you *can* write a single helper `withLogging(name string, fn func() (T, error)) (T, error)`, but the result is harder to read than the three methods above. The Decorator pattern accepts a fixed cost (one wrapper per method) in exchange for explicit, debuggable code at every layer.

This refactor is the most common "real-world" use of Decorator. Most legacy Go codebases have OrderService-shaped boilerplate scattered everywhere. Replacing it with a decorator is usually a one-day refactor that deletes hundreds of lines.

---

## Task 19: Mini-project — build a small HTTP server with full middleware stack

Combine everything from Tasks 7, 11, 12, 15, 16 into a working HTTP server. The server exposes two endpoints: `GET /hello` (public) and `GET /admin/secret` (requires auth). All requests go through a stack of middlewares.

**Acceptance criteria**

- [ ] One binary that runs `go run main.go` and serves on `:8080`.
- [ ] Middleware stack (outermost first): `RequestID`, `Logging`, `Recover`, `Timeout(2s)`, `Metrics`.
- [ ] An additional `Auth` middleware applied only to routes under `/admin/`.
- [ ] A `/metrics` endpoint exposes Prometheus metrics (use `promhttp.Handler()`).
- [ ] `GET /hello` returns 200 with body "hello".
- [ ] `GET /admin/secret` returns 401 without `Authorization` header; 200 otherwise.
- [ ] A `/panic` test endpoint panics; the recover middleware turns this into 500.
- [ ] A `/slow` test endpoint sleeps 5 seconds; the timeout middleware aborts it.
- [ ] Test with `curl`:
    - `curl localhost:8080/hello` → 200 hello
    - `curl localhost:8080/admin/secret` → 401
    - `curl -H "Authorization: x" localhost:8080/admin/secret` → 200
    - `curl localhost:8080/metrics` → Prometheus exposition format
    - `curl localhost:8080/panic` → 500
    - `curl localhost:8080/slow` → 504 or context error

<details><summary>Hints</summary>

- Use `http.ServeMux` for routing. Wrap individual handlers with the right chains.
- The metrics middleware needs labels `method` and `status_code`; use a `statusRecorder` like in Task 7 to capture status.
- For the `/admin` group, write a small `adminChain` helper that adds Auth on top of the global chain.
- The timeout middleware uses `context.WithTimeout`; the test handler must respect `r.Context()`.

</details>

<details><summary>Solution</summary>

```go
// main.go
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type ctxKey struct{}

var requestIDKey = ctxKey{}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

type Middleware func(http.Handler) http.Handler

func Chain(h http.Handler, mws ...Middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

// --- middlewares ---

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			var buf [8]byte
			_, _ = rand.Read(buf[:])
			id = hex.EncodeToString(buf[:])
		}
		w.Header().Set("X-Request-ID", id)
		ctx := context.WithValue(r.Context(), requestIDKey, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		id, _ := r.Context().Value(requestIDKey).(string)
		log.Printf("[%s] %s %s %d %s", id, r.Method, r.URL.Path, rec.status, time.Since(start))
	})
}

func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("panic: %v\n%s", rec, debug.Stack())
				http.Error(w, "internal error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func Timeout(d time.Duration) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), d)
			defer cancel()
			done := make(chan struct{})
			go func() {
				next.ServeHTTP(w, r.WithContext(ctx))
				close(done)
			}()
			select {
			case <-done:
			case <-ctx.Done():
				http.Error(w, "timeout", http.StatusGatewayTimeout)
			}
		})
	}
}

func Auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- metrics ---

var (
	requests = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "http_requests_total"},
		[]string{"method", "code"},
	)
	duration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{Name: "http_duration_seconds"},
		[]string{"method"},
	)
)

func init() {
	prometheus.MustRegister(requests, duration)
}

func Metrics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		requests.WithLabelValues(r.Method, fmt.Sprint(rec.status)).Inc()
		duration.WithLabelValues(r.Method).Observe(time.Since(start).Seconds())
	})
}

// --- handlers ---

func handleHello(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintln(w, "hello")
}

func handleSecret(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintln(w, "secret data")
}

func handlePanic(w http.ResponseWriter, r *http.Request) {
	panic("oops")
}

func handleSlow(w http.ResponseWriter, r *http.Request) {
	select {
	case <-r.Context().Done():
		http.Error(w, "cancelled", 499)
	case <-time.After(5 * time.Second):
		fmt.Fprintln(w, "finally")
	}
}

func main() {
	mux := http.NewServeMux()
	mux.Handle("/hello", http.HandlerFunc(handleHello))
	mux.Handle("/admin/secret", Auth(http.HandlerFunc(handleSecret)))
	mux.Handle("/panic", http.HandlerFunc(handlePanic))
	mux.Handle("/slow", http.HandlerFunc(handleSlow))
	mux.Handle("/metrics", promhttp.Handler())

	root := Chain(mux,
		RequestID,
		Logging,
		Recover,
		Timeout(2*time.Second),
		Metrics,
	)

	log.Println("listening on :8080")
	if err := http.ListenAndServe(":8080", root); err != nil {
		log.Fatal(err)
	}
}
```

</details>

**Discussion.** This is the production shape of an HTTP server in Go — a `ServeMux` for routing, a chain of middlewares around it, per-route authentication, and a metrics endpoint. The decorator pattern carries the entire architecture. Switch out the router for `chi.Router` and the chain helper for `chi.Use(...)` and you have a `chi` setup; the structure is unchanged.

Two design choices worth noting. (1) `Timeout` runs the handler in a goroutine and uses `select` to bail when the context fires. Without the goroutine, the handler would block past the timeout — `context.WithTimeout` cancels the context, but if the handler doesn't check `ctx.Done()`, it keeps running. The goroutine isolates that; the cost is that the abandoned handler leaks until it eventually returns. Real production setups use `http.TimeoutHandler` from the standard library, which has the same trade-off. (2) The `Metrics` middleware is *innermost* among the cross-cutting concerns — by the time it runs, status codes are finalized (Logging will see what Metrics saw). If you put Metrics outside Logging, the labels would still be right but the timing measurement would include log-writing latency.

---

## Task 20: Bonus — record-and-replay decorator for tests

A decorator that records all calls made through it to a tape (slice of records), and a sibling decorator that replays a tape — returning the recorded answers in sequence regardless of input. Useful for snapshot-style integration tests.

```go
// Record phase: hit the real API.
recorder := &Recorder{Inner: realAPI}
result, _ := recorder.Call(ctx, "alpha")
result, _ = recorder.Call(ctx, "beta")
tape := recorder.Tape()

// Save `tape` to disk.

// Replay phase: don't hit the real API.
replay := &Replayer{Tape: tape}
result, _ := replay.Call(ctx, "alpha") // returns recorded response
result, _ = replay.Call(ctx, "beta")
```

**Acceptance criteria**

- [ ] `API` interface: `Call(ctx, req string) (string, error)`.
- [ ] `Recorder` wraps an `API`, makes the real call, and records `(input, output, error)` to its tape.
- [ ] `Replayer` is an `API` constructed from a tape; each `Call` returns the next entry's response and error, regardless of input.
- [ ] `Replayer` panics if the tape is exhausted (or, alternatively, returns a sentinel error — your choice; document it).
- [ ] A test records two calls against a fake API, then replays them and asserts the responses match.
- [ ] A `MatchByInput` mode for `Replayer` — instead of returning entries in order, look up by input. (Two test cases: ordered and keyed.)

<details><summary>Hints</summary>

- The tape is a slice of structs: `type Entry struct { Input, Output string; Err string }` (string-encoded errors round-trip more easily through JSON).
- The `Recorder` should be thread-safe (a mutex around tape append).
- For `MatchByInput`, build a `map[string]Entry` from the tape at construction.

</details>

<details><summary>Solution</summary>

```go
package recplay

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

type API interface {
	Call(ctx context.Context, req string) (string, error)
}

type Entry struct {
	Input  string
	Output string
	Err    string
}

type Recorder struct {
	Inner API

	mu   sync.Mutex
	tape []Entry
}

func (r *Recorder) Call(ctx context.Context, req string) (string, error) {
	resp, err := r.Inner.Call(ctx, req)
	r.mu.Lock()
	entry := Entry{Input: req, Output: resp}
	if err != nil {
		entry.Err = err.Error()
	}
	r.tape = append(r.tape, entry)
	r.mu.Unlock()
	return resp, err
}

func (r *Recorder) Tape() []Entry {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Entry, len(r.tape))
	copy(out, r.tape)
	return out
}

type Replayer struct {
	Tape       []Entry
	MatchInput bool

	mu  sync.Mutex
	pos int
	idx map[string]Entry
}

func NewReplayer(tape []Entry, matchInput bool) *Replayer {
	r := &Replayer{Tape: tape, MatchInput: matchInput}
	if matchInput {
		r.idx = make(map[string]Entry, len(tape))
		for _, e := range tape {
			r.idx[e.Input] = e
		}
	}
	return r
}

func (r *Replayer) Call(ctx context.Context, req string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.MatchInput {
		e, ok := r.idx[req]
		if !ok {
			return "", fmt.Errorf("replayer: no recorded entry for %q", req)
		}
		if e.Err != "" {
			return e.Output, errors.New(e.Err)
		}
		return e.Output, nil
	}

	if r.pos >= len(r.Tape) {
		return "", errors.New("replayer: tape exhausted")
	}
	e := r.Tape[r.pos]
	r.pos++
	if e.Err != "" {
		return e.Output, errors.New(e.Err)
	}
	return e.Output, nil
}
```

</details>

**Discussion.** Record-and-replay is the test cousin of cache and proxy. It uses the same wrap-and-delegate shape but with a different goal — capture interactions for later reproduction. Tools like `dvyukov/go-fuzz`, `go-vcr/vcr` (HTTP record/replay), and AWS SDK's stub clients all use this pattern.

The two modes (ordered vs keyed by input) reflect a real design choice. Ordered replay is brittle — if you reorder test calls, the tape no longer matches. Keyed replay is more robust but assumes inputs uniquely identify the call (which fails if the same input is called multiple times with different intended responses). Mature tools layer both: keyed by *request signature* (URL + method + body hash), with the recorded order as a tie-breaker.

This is also a satisfying capstone for the pattern: the same wrapper structure as Task 1's logging counter, applied to a non-obvious use case. Once you've internalized "implement the same interface, hold an Inner, do work, delegate", you'll spot decorator opportunities in domains the Gang of Four never imagined.

---

## What to do next

You've worked through the decorator pattern from the warm-up to a small HTTP server. The next directions:

1. **Read the standard library.** Open `net/http`, `bufio`, `compress/gzip`, `crypto/tls`, `database/sql/driver`. Every one of them uses the decorator pattern at the core of its API. The third or fourth time you spot it, the pattern stops feeling like a "pattern" and starts feeling like the language.
2. **Read [`../03-strategy-pattern/`](../03-strategy-pattern/)** — Strategy and Decorator are the two ends of "this type satisfies the same interface". They compose: pick the Strategy (which gateway), then wrap with Decorators (logging, retry, metrics). Most well-designed Go services use both layered together.
3. **Read [`../11-proxy-pattern/`](../11-proxy-pattern/)** when you get there — Proxy and Decorator are structural twins. Proxy controls access; Decorator adds behavior. The distinction is intent, not syntax.
4. **Pick a real codebase** — `chi`, `gorilla/mux`, `go-chi/render`, `otelhttp`, `prometheus/client_golang` — and read its middleware implementation. You'll see the same patterns you've practiced here, with one or two production refinements per project. Those refinements (e.g., `chi`'s context-local middleware stack, `otelhttp`'s span management) are where the next layer of mastery lives.
