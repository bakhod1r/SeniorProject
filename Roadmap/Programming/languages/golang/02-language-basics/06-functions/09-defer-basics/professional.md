# Go Defer — Professional / Internals Level

## 1. Overview

This document covers how `defer` is used in real production Go codebases — the standard library, Kubernetes, etcd, CockroachDB, Caddy, Prometheus — along with team conventions, review checklists, lint rules, and postmortem-style stories where defer caused or solved a real problem.

The aim is to teach by reference: when you see a particular defer pattern in production code, you should be able to identify the codebase convention it embodies and the failure mode it guards against.

---

## 2. Standard Library Patterns

### 2.1 `net/http` — Response Body Close

From `src/net/http/client.go` and the documentation contract:

```go
resp, err := http.Get("http://example.com")
if err != nil {
    return err
}
defer resp.Body.Close()
```

The Go stdlib documentation for `http.Response.Body` says:

> The http Client and Transport guarantee that Body is always non-nil, even on responses without a body or responses with a zero-length body. It is the caller's responsibility to close Body.

If the caller forgets to close, the underlying TCP connection cannot be reused (it's stuck waiting for the body to be drained or closed). Production HTTP clients that leak `resp.Body` see degraded throughput and connection pool exhaustion.

A subtler pattern: read the body fully *and* close it, so the connection can be reused:

```go
defer func() {
    io.Copy(io.Discard, resp.Body)
    resp.Body.Close()
}()
```

You'll see this in clients that need maximum keep-alive reuse.

### 2.2 `database/sql` — Rows Close

From `src/database/sql/sql.go`:

```go
rows, err := db.Query("SELECT id, name FROM users WHERE active = ?", true)
if err != nil {
    return err
}
defer rows.Close()

for rows.Next() {
    var id int
    var name string
    if err := rows.Scan(&id, &name); err != nil {
        return err
    }
    // ...
}
return rows.Err()
```

`rows.Close()` returns the connection to the pool. Without it, the connection is "leaked" until the GC eventually finalizes the `*sql.Rows`. Long-running services with leaked Rows hit "too many open connections" errors.

The community lint rule `sqlclosecheck` (part of `golangci-lint`) catches this.

### 2.3 `sync.Mutex` — Unlock

The "lock-then-defer-unlock" idiom is so pervasive that the Go authors describe it as the canonical use case for defer. From `src/sync/mutex.go`'s example:

```go
var mu sync.Mutex
var count int

func Increment() {
    mu.Lock()
    defer mu.Unlock()
    count++
}
```

The defer guarantees the mutex unlocks even if the critical section panics. Forgetting to unlock causes deadlocks; using `defer` makes forgetting impossible.

### 2.4 `context.WithCancel/WithTimeout/WithDeadline` — Cancel

From `src/context/context.go`:

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
```

The `context` package's documentation explicitly says:

> Failing to call CancelFunc leaks the child and its subtree until the parent is canceled or the timer fires.

`golangci-lint` ships a rule (`govet -copylocks` and `staticcheck SA1012`) that catches missing `cancel` calls.

### 2.5 `os/exec` — Wait

```go
cmd := exec.Command("ls", "-la")
if err := cmd.Start(); err != nil {
    return err
}
defer cmd.Wait()
// ... use cmd.Stdout, etc.
```

`Wait` releases the OS resources associated with the process. If you never call it, you accumulate zombie processes.

### 2.6 `runtime/pprof` — StopCPUProfile

```go
f, err := os.Create("cpu.prof")
if err != nil { return err }
defer f.Close()

if err := pprof.StartCPUProfile(f); err != nil { return err }
defer pprof.StopCPUProfile()
```

Profiling without `StopCPUProfile` leaves the profiler enabled after your function exits, distorting later measurements.

---

## 3. Kubernetes Patterns

### 3.1 `kube-apiserver` Recovery Middleware

From `staging/src/k8s.io/apiserver/pkg/server/filters/wrap.go` (paraphrased):

```go
func WithPanicRecovery(handler http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
        defer runtime.HandleCrash(func(panicReason interface{}) {
            http.Error(w, "Internal server error", http.StatusInternalServerError)
        })
        handler.ServeHTTP(w, req)
    })
}
```

The defer ensures any panicking handler inside the chain results in a 500 response and a logged crash, rather than crashing the apiserver.

### 3.2 Kubernetes Lock Tracing

Kubernetes' `client-go/tools/leaderelection` uses defer extensively for lock release in distributed leader election:

```go
func (le *LeaderElector) tryAcquireOrRenew(ctx context.Context) bool {
    // ...
    le.observedRecordLock.Lock()
    defer le.observedRecordLock.Unlock()
    // ...
}
```

A pattern repeated in dozens of places: lock, defer-unlock, work.

### 3.3 Kubernetes Trace Spans

`k8s.io/utils/trace` uses defer to close trace spans:

```go
trace := utiltrace.New("admit",
    utiltrace.Field{Key: "type", Value: kind})
defer trace.LogIfLong(500 * time.Millisecond)
```

The `LogIfLong` call inspects the elapsed time at exit and logs only if it exceeds the threshold. Defer makes this happen for every return path.

---

## 4. etcd Patterns

### 4.1 etcd's Lease Cleanup

From `etcd/server/etcdserver/server.go`:

```go
func (s *EtcdServer) leaseExpired(now time.Time) {
    le := s.lessor
    if le == nil {
        return
    }
    le.mu.Lock()
    defer le.mu.Unlock()
    // ... expire leases ...
}
```

Standard mutex pattern. Worth noting: etcd has **strict review** that any function modifying lease state must hold the lock and release it via defer.

### 4.2 etcd's Watcher Close

```go
ch := w.Watch(ctx, key)
defer w.Close() // close watcher when done
```

If the watcher isn't closed, etcd's watch streams accumulate, causing memory leak on the etcd server side.

### 4.3 etcd's Transaction Pattern

```go
tx := s.kv.Write(traceutil.TODO())
defer tx.End()
// ... operations ...
```

`tx.End()` commits or rolls back, and if you forget it, the transaction is held indefinitely.

---

## 5. CockroachDB Patterns And Conventions

### 5.1 CockroachDB Discourages Defer In Hot Paths

CockroachDB maintains a style guide that explicitly cautions against defer in storage and SQL execution hot paths:

> "Do not use `defer` in performance-sensitive code paths. The overhead of `defer` (~50ns) is significant relative to the work being done. Use explicit cleanup instead."

You'll see code like:

```go
func (b *Batch) Commit() error {
    b.mu.Lock()
    err := b.commitLocked()
    b.mu.Unlock()
    return err
}
```

Instead of:

```go
func (b *Batch) Commit() error {
    b.mu.Lock()
    defer b.mu.Unlock()
    return b.commitLocked()
}
```

The latter is idiomatic Go but slower. CockroachDB measures the impact in microbenchmarks and explicitly chooses the faster form for hot paths only.

### 5.2 The "Locked" Naming Convention

When a function expects the caller to hold a lock, the function name ends in `Locked`:

```go
func (b *Batch) commitLocked() error { /* ... */ }
```

Callers do `b.mu.Lock()` (with or without defer) and call `commitLocked()`. The convention makes lock ownership explicit at the call site and sidesteps the defer-in-hot-path question entirely.

### 5.3 Logging In Deferred Closures

CockroachDB's `pkg/util/log` uses deferred closures for "log if slow":

```go
defer func() {
    if d := time.Since(start); d > slowThreshold {
        log.Warningf(ctx, "slow operation: %v", d)
    }
}()
```

This pattern is fine even in hot paths because it doesn't allocate when slow operations are rare.

---

## 6. Caddy Patterns

### 6.1 Caddy's HTTP Lifecycle

Caddy's HTTP handlers use defer for response body close, similar to net/http:

```go
resp, err := h.transport.RoundTrip(req)
if err != nil { return err }
defer resp.Body.Close()
```

But Caddy adds a recover middleware at the boundary:

```go
defer func() {
    if rec := recover(); rec != nil {
        c.HandleError(w, r, rec)
    }
}()
```

So a panicking middleware doesn't crash the server.

### 6.2 Module Cleanup In Caddy

Caddy modules implement a `Cleanup` interface, and the framework calls Cleanup on shutdown. Inside a module, defers for lock release are common:

```go
func (m *MyModule) ServeHTTP(w http.ResponseWriter, r *http.Request) error {
    m.mu.RLock()
    defer m.mu.RUnlock()
    // ...
}
```

---

## 7. Prometheus Patterns

### 7.1 Prometheus Scrape Loop

The scrape inner loop in `pkg/scrape/scrape.go` uses **explicit cleanup** to avoid defer cost:

```go
for _, t := range targets {
    // No defer here; cleanup is inline
    err := t.scrape()
    t.report(err)
}
```

Outside the inner loop, Prometheus uses defer freely:

```go
func (s *scrapeManager) reload() {
    s.mtxScrape.Lock()
    defer s.mtxScrape.Unlock()
    // ... reload config ...
}
```

The split mirrors CockroachDB's: hot inner loops avoid defer; orchestration code uses it idiomatically.

### 7.2 Prometheus' HTTP Handler Cleanup

```go
defer r.Body.Close()
```

Standard. Prometheus' API server has a recovery middleware similar to Kubernetes'.

---

## 8. Team Convention Examples

### 8.1 The "Always defer Close" Rule

Many teams adopt: "after every Open/Connect/Begin, the next line is `defer X.Close()`". Reviewers reject PRs that don't follow this.

```go
// CORRECT
f, err := os.Open(p)
if err != nil { return err }
defer f.Close()

// REJECTED IN REVIEW
f, err := os.Open(p)
if err != nil { return err }
// ... 50 lines later ...
f.Close()
```

The "always defer" rule has one important exception: when you need to close *and* check the close error, use the named-return pattern (see Section 9).

### 8.2 Wrap Errors In A Deferred Closure

Some teams require functions that return errors to use the named-return + deferred-wrap pattern:

```go
func loadModule(path string) (mod *Module, err error) {
    defer func() {
        if err != nil {
            err = fmt.Errorf("loadModule %q: %w", path, err)
        }
    }()
    // ...
}
```

This makes error wrapping uniform and impossible to forget.

### 8.3 No Defer In Hot Paths Rule

Teams maintaining latency-sensitive systems adopt: "no defer inside hot inner loops". Hot paths are identified by profiling and called out in code comments:

```go
// Hot path: do NOT add defer here.
func (b *Batch) appendKey(k []byte) {
    // ...
}
```

This is documented in the team's style guide and enforced via review.

### 8.4 Defer For Trace / Metric Middleware

Teams with strong observability instrument every public API entry point with a deferred trace closure:

```go
func (s *Service) Foo(ctx context.Context, req *FooReq) (resp *FooResp, err error) {
    defer s.tracer.Start("Foo")(ctx, &err)()
    // ...
}
```

The double-`()` pattern is a curried trace helper: outer call evaluates immediately and returns a closure that finishes the trace at exit.

---

## 9. Review Checklist

When reviewing Go code that uses defer, scan for:

1. **Is the resource error checked before deferring its release?** `defer f.Close()` after a failed `os.Open` causes a nil-pointer panic.
2. **Is the defer inside a loop?** If yes, is there a reason it should accumulate? Usually no — extract a helper.
3. **Are there 9+ defers in this function?** If yes, can it be split? (Open-coded defer drops at 9.)
4. **Are arguments to the deferred call correct at defer-time?** If the deferred call needs late-bound state, is it wrapped in a closure?
5. **Does a deferred closure modify a return value?** If yes, is the return named?
6. **For Close() on a writer (file, gzip, etc.), is the close error captured?**
7. **For mutex unlock, is there a lock?** And vice versa: every Lock should have a corresponding Unlock (or `defer Unlock`).
8. **For context.With...:** is `defer cancel()` present?
9. **For tx.Begin:** is there `defer rollback-on-err` or explicit commit?
10. **For panics in goroutines:** is there a `defer recover()` at the top of the goroutine?

---

## 10. Lint Rules

### 10.1 `errcheck`

Catches `f.Close()` (without checking the error) used directly. Has an option to ignore deferred Close calls (most teams enable this so `defer f.Close()` doesn't warn).

```yaml
errcheck:
  exclude-functions:
    - (*os.File).Close
    - (*sql.Rows).Close
```

### 10.2 `staticcheck`

- **SA1012**: never call cancel on its own (i.e., always defer it).
- **SA1019**: deprecated function detection.
- **SA1029**: detects nil response body before defer Close.

### 10.3 `govet`

- `-lostcancel`: catches missing `defer cancel()` after `context.WithCancel`.
- `-copylocks`: catches accidental copies of mutex types (which break defer-unlock).

### 10.4 `bodyclose`

Catches missing `resp.Body.Close()` after `http.Get` and similar.

### 10.5 `sqlclosecheck`

Catches missing `rows.Close()` or `stmt.Close()`.

### 10.6 `gocritic`'s `deferInLoop` rule

Detects `defer` inside loops. Can be enabled in `golangci.yaml`:

```yaml
gocritic:
  enabled-checks:
    - deferInLoop
```

Some teams set this to error level.

### 10.7 `revive`'s `defer` rule

Configurable to flag specific defer patterns:
- `loop`: defer in a loop
- `recover`: recover not inside a deferred function
- `return`: defer + return interaction

```yaml
revive:
  rules:
    - name: defer
      arguments: [["loop", "recover", "return"]]
```

---

## 11. Postmortem-Style Stories

### Story 1 — The File Descriptor Leak

A team had a service that ingested CSV files. The processing function looked like:

```go
func ingest(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil { return err }
        defer f.Close()
        if err := processCSV(f); err != nil { return err }
    }
    return nil
}
```

In testing with 10 files, no problem. In production with 100,000 files, the service crashed with "too many open files".

**Root cause**: `defer f.Close()` accumulated, all firing at the end of `ingest`. The OS's per-process file descriptor limit (1024 by default) was hit at file 1024.

**Fix**: extract a helper that handles one file and lets its defer fire per-iteration.

```go
func ingest(paths []string) error {
    for _, p := range paths {
        if err := ingestOne(p); err != nil {
            return err
        }
    }
    return nil
}

func ingestOne(p string) error {
    f, err := os.Open(p)
    if err != nil { return err }
    defer f.Close()
    return processCSV(f)
}
```

The lint rule `gocritic deferInLoop` would have caught this in CI.

### Story 2 — The Rollback That Never Ran

A team's payment service used:

```go
func charge(db *sql.DB, ...) error {
    tx, err := db.Begin()
    if err != nil { return err }
    defer tx.Rollback() // attempts rollback on every exit

    if _, err := tx.Exec(...); err != nil {
        return err
    }
    return tx.Commit()
}
```

In testing, this looked fine. In production, the team noticed warnings: `sql: Transaction has already been committed or rolled back`.

**Root cause**: after `tx.Commit()` succeeds, the deferred `tx.Rollback()` runs and returns an error (which was being logged). Annoying but not breaking.

**Fix**: gate the rollback on the err state:

```go
defer func() {
    if err != nil {
        _ = tx.Rollback()
    }
}()
```

The function needed a named `err` return for this pattern.

### Story 3 — The Panic That Crashed The Server

A team's HTTP handler did:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    data := parse(r.Body) // could panic on malformed input
    fmt.Fprintln(w, data)
}
```

A malformed POST body crashed the entire process.

**Root cause**: no recovery middleware. The panic propagated through the HTTP server's serve goroutine and crashed it. The Go HTTP server's default behavior **does** recover panics in handlers (since Go 1.0), but this codebase had a custom server that didn't.

**Fix**: add a recovery middleware:

```go
func recoverMiddleware(h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("panic in handler: %v\n%s", rec, debug.Stack())
                http.Error(w, "internal error", 500)
            }
        }()
        h.ServeHTTP(w, r)
    })
}
```

### Story 4 — The Defer Order Bug

A team had a function that read a gzipped log file:

```go
func read(path string) ([]byte, error) {
    f, err := os.Open(path)
    if err != nil { return nil, err }
    defer f.Close()

    gz, err := gzip.NewReader(f)
    if err != nil { return nil, err }
    defer gz.Close()

    return io.ReadAll(gz)
}
```

For most files this worked. For specific files, `Close` returned an error like "gzip: invalid checksum" — and they were getting truncated reads.

**Root cause**: `gz.Close()` runs first (LIFO). If the gzip reader hasn't consumed the entire stream, `Close` returns an error. The error was unchecked; the truncated data flowed through.

**Fix**: capture the close errors:

```go
func read(path string) (data []byte, err error) {
    f, err := os.Open(path)
    if err != nil { return nil, err }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()

    gz, err := gzip.NewReader(f)
    if err != nil { return nil, err }
    defer func() {
        if cerr := gz.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()

    return io.ReadAll(gz)
}
```

### Story 5 — The Missing `defer cancel()`

A goroutine pool used:

```go
func work() {
    for job := range jobs {
        ctx, _ := context.WithTimeout(context.Background(), 5*time.Second)
        process(ctx, job)
    }
}
```

After deploying, the team noticed steady memory growth.

**Root cause**: each `WithTimeout` creates a goroutine internally to wait on the timer. Without `cancel()`, that goroutine sticks around until the timer fires. With high job throughput, these accumulate before timing out.

**Fix**: defer the cancel:

```go
func work() {
    for job := range jobs {
        func() {
            ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
            defer cancel()
            process(ctx, job)
        }()
    }
}
```

(Note the inline anonymous function to scope the defer to one iteration.)

---

## 12. Defer In Library APIs

When designing a library, prefer APIs where defer is the natural caller pattern:

```go
// GOOD — caller writes `defer h.Close()`
type Handle struct{ /* ... */ }
func Open(...) (*Handle, error) { /* ... */ }
func (h *Handle) Close() error { /* ... */ }
```

vs:

```go
// HARDER — manual scope or callback
func WithHandle(fn func(*Handle) error) error {
    h, err := Open(...)
    if err != nil { return err }
    defer h.Close()
    return fn(h)
}
```

The first pattern composes better with named returns and other defers. The second pattern (functional resource management) is sometimes used in Go but not idiomatic.

A hybrid: provide both:

```go
// Caller can pick.
func Open(...) (*Handle, error) { /* ... */ }
func WithHandle(fn func(*Handle) error) error { /* ... */ }
```

---

## 13. Defer And Code Review Antipatterns

### 13.1 Defer With A Side Effect You Forgot About

```go
defer doStuff() // does this rollback? close? log?
```

If `doStuff` is opaque, reviewers must check what it does. Prefer explicit names: `defer rollback()`, `defer close()`, `defer log.Done()`.

### 13.2 Defer Used For Control Flow

```go
defer func() {
    if condition { /* skip the panic */ }
}()
```

Defer for control flow (recover-and-skip) is sometimes valid but often a smell. Prefer explicit error handling.

### 13.3 Naked Returns With Defer-Modified Returns

```go
func f() (err error) {
    defer func() { err = wrap(err) }()
    if err = step1(); err != nil {
        return // naked return; relies on defer
    }
    return // naked return; works
}
```

Naked returns hide the data flow. Prefer explicit `return err` so reviewers see what's happening.

### 13.4 Multiple Defers Modifying The Same Variable

```go
defer func() { err = wrap1(err) }()
defer func() { err = wrap2(err) }()
```

LIFO: wrap2 runs first, then wrap1 wraps that. Reviewers easily get the order wrong. Comment or refactor.

---

## 14. Production Best Practices Summary

1. **Acquire then defer-release** is the canonical pattern.
2. **Check the resource error before deferring its release**.
3. **Avoid defer in hot inner loops**; profile first if unsure.
4. **Avoid defer in for loops over many items**; extract a helper.
5. **Use named returns + deferred closure** for error wrapping.
6. **Always `defer cancel()` after `context.With*`**.
7. **Always `defer f.Close()` for files, `resp.Body.Close()` for HTTP, `rows.Close()` for SQL**.
8. **In goroutines that may panic, defer-recover at the top**.
9. **Capture close errors when writing**, ignore them when reading-only.
10. **Document hot paths** that intentionally avoid defer.

---

## 15. References

- `net/http`: `src/net/http/client.go`, `src/net/http/server.go`
- `database/sql`: `src/database/sql/sql.go`
- `sync`: `src/sync/mutex.go`
- `context`: `src/context/context.go`
- Kubernetes: `staging/src/k8s.io/apiserver/pkg/server/filters/`
- etcd: `etcd/server/etcdserver/server.go`
- CockroachDB: `cockroach/pkg/util/log` and storage code
- Caddy: `caddyhttp/handler.go`
- Prometheus: `prometheus/scrape/scrape.go`
- golangci-lint docs on `bodyclose`, `sqlclosecheck`, `errcheck`, `staticcheck`

---

## 16. Summary

Defer is the production tool for "do this on the way out". Every major Go codebase uses it heavily for resource cleanup, with consistent conventions: acquire/defer-release, error wrapping via named returns + deferred closures, context cancel, panic recovery at goroutine and HTTP boundaries. The exceptions — places where defer is avoided — are well-documented hot paths in storage engines and inner loops, where the per-defer cost matters. Lint rules and review checklists catch the common bugs before they reach production. The cost of defer's discipline is small; the cost of forgetting cleanup is unbounded.
