---
layout: default
title: Middle
parent: Cooperative vs Forced
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/01-cooperative-vs-force/middle/
---

# Cooperative vs Forced Cancellation — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [When to Use Cooperative Cancellation](#when-to-use-cooperative-cancellation)
3. [Cancellation Patterns](#cancellation-patterns)
4. [Propagating `ctx` Through Layers](#propagating-ctx-through-layers)
5. [Channel-Based Cancellation](#channel-based-cancellation)
6. [Bounding Worker Lifetime](#bounding-worker-lifetime)
7. [Cancellation in the Standard Library](#cancellation-in-the-standard-library)
8. [Cancellation and `select`](#cancellation-and-select)
9. [Cancellation and `sync` Primitives](#cancellation-and-sync-primitives)
10. [Cancellation and Timers](#cancellation-and-timers)
11. [Cancellation and Resource Cleanup](#cancellation-and-resource-cleanup)
12. [Error Handling Strategies](#error-handling-strategies)
13. [Observability](#observability)
14. [Performance Considerations](#performance-considerations)
15. [Testing Cancellable Code](#testing-cancellable-code)
16. [When Cooperative Is Not Enough](#when-cooperative-is-not-enough)
17. [Anti-Patterns](#anti-patterns)
18. [Production Stories](#production-stories)
19. [Checklist](#checklist)
20. [Summary](#summary)

---

## Introduction

The junior file established the *what*: cancellation in Go is cooperative, mediated by `context.Context`, and there is no per-goroutine kill. The middle file is about *how*: how to design subsystems whose every goroutine respects cancellation, how to propagate signals through deep call stacks, how to bound worker lifetime, and how to write tests that prove your cancellation actually works.

We assume you can already write a `for { select { case <-ctx.Done() } }` loop, that you know `context.WithTimeout` and `defer cancel()`, and that you understand why `time.Sleep` does not respect contexts. From here we go into the daily decisions of building real software around cooperative cancellation.

By the end of this file you should be able to:

- Choose between `context.Context`, channel signals, and `sync.Cond` for cancellation
- Write a worker pool that drains gracefully on shutdown
- Propagate cancellation through HTTP, database, and external API layers
- Recognise the patterns that fail under cancellation and rewrite them
- Test that cancellation actually stops your goroutines (not just *should*)

---

## When to Use Cooperative Cancellation

### The default: any non-trivial goroutine

If a goroutine runs for more than a few microseconds, it should be cancellable. The cost is a single `select` branch; the benefit is shutdown safety, predictable test behaviour, and a healthy goroutine count under load.

### When you can skip it

- Tiny synchronous helpers that finish in a few function calls.
- Goroutines that exit on a channel close anyway (the close *is* the cancellation signal).
- One-shot `go func() { close(done) }()` notifiers used inside a single function scope.

### When you must add it

- HTTP handlers and downstream calls.
- Background workers and tickers.
- Database queries and remote calls.
- Pipeline stages.
- Subscriptions and long-polling loops.

The rule of thumb: **if removing the goroutine would let you "wait for it to finish," then it needs cancellation**. If you could plausibly want to stop it, give it the ability.

---

## Cancellation Patterns

### Pattern 1: Single worker, simple cancel

```go
func work(ctx context.Context) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }
        if err := doOneUnit(); err != nil {
            return err
        }
    }
}
```

The "polling between units" model. Latency is bounded by the cost of one unit.

### Pattern 2: Single worker, blocking on data

```go
func work(ctx context.Context, in <-chan Item) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case it, ok := <-in:
            if !ok {
                return nil
            }
            if err := processItem(it); err != nil {
                return err
            }
        }
    }
}
```

No "default" branch; `select` blocks on the first of {cancel, data, close}. This is the cleanest form for consumer goroutines.

### Pattern 3: Worker pool with shared input

```go
func pool(ctx context.Context, jobs <-chan Job, workers int) error {
    g, gctx := errgroup.WithContext(ctx)
    for i := 0; i < workers; i++ {
        g.Go(func() error {
            for {
                select {
                case <-gctx.Done():
                    return gctx.Err()
                case j, ok := <-jobs:
                    if !ok {
                        return nil
                    }
                    if err := j.Run(gctx); err != nil {
                        return err
                    }
                }
            }
        })
    }
    return g.Wait()
}
```

`errgroup.WithContext` couples worker errors to cancellation: if any worker returns an error, all others see `gctx.Done()` and exit.

### Pattern 4: Pipeline of stages

```go
func pipeline(ctx context.Context, src <-chan In) <-chan Out {
    out := make(chan Out)
    go func() {
        defer close(out)
        for {
            select {
            case <-ctx.Done():
                return
            case x, ok := <-src:
                if !ok {
                    return
                }
                y := transform(x)
                select {
                case <-ctx.Done():
                    return
                case out <- y:
                }
            }
        }
    }()
    return out
}
```

Two `select` statements per stage: one for reading, one for writing. Each is cancellable. Without the second `select`, a slow downstream consumer holds the pipeline hostage even after cancel.

### Pattern 5: Fan-out, fan-in

```go
func fanOut(ctx context.Context, in <-chan Job, n int) <-chan Result {
    out := make(chan Result)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case j, ok := <-in:
                    if !ok {
                        return
                    }
                    r := j.Run()
                    select {
                    case <-ctx.Done():
                        return
                    case out <- r:
                    }
                }
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

Every worker observes the same `ctx`; the `wg.Wait` → `close(out)` ensures downstream sees end-of-stream when *all* workers have exited (either by cancellation or by `in` closing).

### Pattern 6: Cancellation as graceful shutdown

```go
type Service struct {
    cancel context.CancelFunc
    done   chan struct{}
}

func New(ctx context.Context) *Service {
    sctx, cancel := context.WithCancel(ctx)
    s := &Service{cancel: cancel, done: make(chan struct{})}
    go s.run(sctx)
    return s
}

func (s *Service) run(ctx context.Context) {
    defer close(s.done)
    // ... loop on ctx ...
}

func (s *Service) Shutdown(ctx context.Context) error {
    s.cancel()
    select {
    case <-s.done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

`Shutdown` accepts its own `ctx` with a deadline: "wait up to this long for graceful exit." This is the standard pattern (mirrored by `http.Server.Shutdown`).

---

## Propagating `ctx` Through Layers

### The first parameter rule

The Go convention, enforced by `staticcheck` and many linters: **`ctx context.Context` is the first parameter** of any function that can block. No exceptions in production code.

```go
func GetUser(ctx context.Context, id string) (*User, error)
func (s *Server) Handle(ctx context.Context, req Request) Response
func (db *DB) Query(ctx context.Context, q string) ([]Row, error)
```

### HTTP request → DB → external API

A canonical web request flow:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    u, err := loadUser(ctx, r.URL.Query().Get("id"))
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    avatar, err := fetchAvatar(ctx, u.AvatarURL)
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    w.Write(avatar)
}

func loadUser(ctx context.Context, id string) (*User, error) {
    row := db.QueryRowContext(ctx, "SELECT ...", id)
    var u User
    return &u, row.Scan(&u.ID, &u.AvatarURL)
}

func fetchAvatar(ctx context.Context, url string) ([]byte, error) {
    req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    return io.ReadAll(resp.Body)
}
```

The HTTP server hands the request context down through each function. The database driver and HTTP client both honour the context: a client disconnect cancels both calls.

### Deriving sub-contexts at boundaries

```go
func loadUser(ctx context.Context, id string) (*User, error) {
    ctx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
    defer cancel()
    // ... use ctx for DB call ...
}
```

The DB call uses a *shorter* timeout than the parent: 200ms regardless of how much the parent has left. Use this to bound a single operation more tightly than the surrounding request.

### Don't store the context

```go
type BadHandler struct {
    ctx context.Context // BUG: handler outlives requests
}
```

Pass `ctx` as an argument. The struct represents a long-lived thing; the context represents a per-call lifetime.

### Background work that outlives the request

Sometimes you want to fire off work that should *not* be cancelled when the request ends — for example, logging that an event happened. In that case, *do not* pass the request context:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    // respond to user
    w.Write(...)
    // log asynchronously with a fresh, bounded context
    go func() {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        logger.LogEvent(ctx, eventFor(r))
    }()
}
```

Use `context.Background()` (or `context.WithoutCancel` in Go 1.21+) for "fire and forget" that needs to survive the request.

---

## Channel-Based Cancellation

### When to prefer plain channels

Sometimes context is overkill. For a single internal goroutine with one parent, a plain `stop chan struct{}` works fine and avoids the small allocation of a context.

```go
type Server struct {
    stop chan struct{}
}

func (s *Server) Run() {
    for {
        select {
        case <-s.stop:
            return
        default:
            s.tick()
        }
    }
}

func (s *Server) Stop() {
    close(s.stop)
}
```

The pattern: `close(stop)` is the signal. Receiving on a closed channel returns the zero value immediately. Idempotent if you guard against double-close (or use `sync.Once`).

### When to switch to context

- Multiple levels of goroutines (hierarchy)
- Interop with standard library (`net/http`, `database/sql`, etc.)
- Need for timeouts as well as explicit cancel
- Need for error reporting via `ctx.Err()`

A useful migration path: a struct that *uses* context internally but exposes a `Stop()` method:

```go
type Server struct {
    cancel context.CancelFunc
    done   chan struct{}
}

func New() *Server {
    ctx, cancel := context.WithCancel(context.Background())
    s := &Server{cancel: cancel, done: make(chan struct{})}
    go s.run(ctx)
    return s
}

func (s *Server) Stop() {
    s.cancel()
    <-s.done
}
```

Callers see a simple API; internals use the context tree.

### Closing channels as signals

```go
done := make(chan struct{})
go func() {
    defer close(done)
    work()
}()
// ...later...
<-done // wait for completion
```

`close` is a *broadcast* signal. Any number of goroutines can wait on the same `done` channel and they all unblock on close. This is the underlying mechanism that `ctx.Done()` uses.

### Mixing close and `select`

```go
for {
    select {
    case <-done:
        return
    case x, ok := <-in:
        if !ok {
            return // input closed
        }
        process(x)
    }
}
```

Two cancellation paths: `done` close (external) or `in` close (upstream end-of-stream). Both lead to a clean return.

---

## Bounding Worker Lifetime

### "Every goroutine has a known death"

A core mantra: when you spawn a goroutine, you should be able to answer the question "what causes this goroutine to return?" If the answer is "the program exits," that is a leak.

The patterns that bound lifetime:

1. **Context cancellation** — explicit signal.
2. **Channel close** — input stream ends.
3. **Bounded loop** — iterates over a finite slice and returns.
4. **Timeout** — deadline expires.
5. **Error return** — first error exits.

### Counting and asserting

In tests, the canonical leak check:

```go
func TestNoLeaks(t *testing.T) {
    before := runtime.NumGoroutine()
    runMyCode()
    // give time for goroutines to exit
    time.Sleep(10 * time.Millisecond)
    after := runtime.NumGoroutine()
    if after > before {
        t.Errorf("leaked %d goroutines", after-before)
    }
}
```

Better: use `go.uber.org/goleak` in your test setup. It snapshots goroutines at start, asserts none remain at end, and prints the leaked stacks.

### Bounding by deadline

```go
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
runService(ctx)
```

If `runService` does not return by 30 seconds, the context fires, all internal goroutines see cancellation, and (assuming they cooperate) the function returns. The deadline is a backstop.

### Bounding by counted iterations

```go
for i := 0; i < maxIters; i++ {
    select {
    case <-ctx.Done():
        return
    default:
        step()
    }
}
```

For batch jobs, prefer counted bounds over open-ended loops. "Process exactly N items" is easier to reason about than "process until cancelled."

---

## Cancellation in the Standard Library

### `net/http`

- `http.Request.Context()` is cancelled when the client disconnects.
- `http.Server.Shutdown(ctx)` gracefully stops the server.
- `http.NewRequestWithContext(ctx, ...)` ties a client request to a context; the connection is closed if the context cancels.

### `database/sql`

- `db.QueryContext`, `db.ExecContext`, `db.PingContext` all respect cancellation.
- On cancellation, the driver typically sends a "kill query" command to the server and closes the connection.
- `db.PrepareContext` and `stmt.QueryContext` similarly tie statements to contexts.

### `os/exec`

- `exec.CommandContext(ctx, ...)` kills the underlying process when the context cancels. The kill signal is `SIGKILL` by default on Unix; `cmd.Cancel = func() error { ... }` (Go 1.20+) lets you customise.

### `net`

- `net.Dialer.DialContext(ctx, ...)` aborts the connection attempt on context cancel.
- `net.Conn` itself does *not* respect context. You set deadlines with `SetDeadline`/`SetReadDeadline`/`SetWriteDeadline`. To cancel an in-flight `Read`, you close the connection.

### `io`

- Pure `io.Reader`/`io.Writer` have no context. Wrappers like `io.Copy` cannot be cancelled directly; you must close the underlying source/destination.
- `iotest` and `ioutil` (deprecated) are similar.

### `runtime`

- `runtime.Goexit()` terminates the current goroutine. It is not "external cancellation"; the goroutine itself calls it.
- `runtime.LockOSThread()` pins a goroutine to an OS thread for the purpose of receiving signals or interacting with thread-local state. Senior-level topic.

---

## Cancellation and `select`

### The standard cancellable receive

```go
select {
case v := <-ch:
    handle(v)
case <-ctx.Done():
    return ctx.Err()
}
```

### Cancellable send

```go
select {
case ch <- v:
case <-ctx.Done():
    return ctx.Err()
}
```

### Cancellable send with timeout

```go
select {
case ch <- v:
    return nil
case <-ctx.Done():
    return ctx.Err()
case <-time.After(100 * time.Millisecond):
    return errSendTimeout
}
```

Note: `time.After` allocates a timer that lives until it fires. In hot loops, prefer `time.NewTimer` + `defer timer.Stop()`.

### Multi-source cancellable select

```go
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case x := <-srcA:
        handleA(x)
    case x := <-srcB:
        handleB(x)
    }
}
```

Three signals in one place: cancel + two data sources. Go's `select` picks one uniformly at random when multiple are ready.

### `select` with `default` for non-blocking check

```go
select {
case <-ctx.Done():
    return ctx.Err()
default:
}
// continue with other work
```

A non-blocking poll. Useful inside CPU-bound work to avoid blocking when nothing is ready.

---

## Cancellation and `sync` Primitives

### `sync.Mutex.Lock` is not cancellable

```go
mu.Lock() // blocks indefinitely; cannot be cancelled
```

There is no `LockContext`. If you need cancellable locking, use a channel-based "semaphore":

```go
type CancelMutex struct {
    ch chan struct{}
}

func NewCancelMutex() *CancelMutex {
    return &CancelMutex{ch: make(chan struct{}, 1)}
}

func (m *CancelMutex) Lock(ctx context.Context) error {
    select {
    case m.ch <- struct{}{}:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (m *CancelMutex) Unlock() {
    <-m.ch
}
```

Cost: a few hundred nanoseconds extra per lock acquisition. Use when contention is bounded and cancellability matters; for hot critical sections, prefer `sync.Mutex` and design so you never need to cancel a `Lock`.

### `sync.WaitGroup.Wait` is not cancellable

```go
wg.Wait() // blocks until counter is 0
```

Wrap with a goroutine and channel if you need cancellation:

```go
func waitCtx(ctx context.Context, wg *sync.WaitGroup) error {
    done := make(chan struct{})
    go func() { wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err() // wg is still ticking; caller has abandoned it
    }
}
```

Caveat: returning before `wg` is done leaves the spawned goroutine running. Make sure either (a) all workers eventually finish or (b) the workers themselves observe the same context.

### `sync.Cond` and cancellation

`sync.Cond.Wait()` releases the mutex and blocks; it cannot be cancelled. The idiomatic alternative is a channel + mutex broadcast:

```go
// Instead of cond.Wait(), use:
for !condition {
    mu.Unlock()
    select {
    case <-ch: // signalled
    case <-ctx.Done():
        mu.Lock()
        return ctx.Err()
    }
    mu.Lock()
}
```

Convoluted. In Go, `sync.Cond` is rarely the right tool when cancellation matters.

---

## Cancellation and Timers

### `time.Sleep` is uncancellable

```go
time.Sleep(time.Hour) // blocks for an hour, period
```

Replace with `time.NewTimer` + `select`:

```go
timer := time.NewTimer(time.Hour)
defer timer.Stop()
select {
case <-timer.C:
case <-ctx.Done():
    return ctx.Err()
}
```

### `time.After` is uncancellable from the caller's side

```go
select {
case <-time.After(time.Hour):
case <-ctx.Done():
    // ctx cancellation works, but the timer leaks for the full hour
}
```

In Go 1.23+, `time.After` was changed so the underlying timer can be garbage collected sooner. Before 1.23, prefer `time.NewTimer` for any non-trivial duration.

### Tickers and cancellation

```go
ticker := time.NewTicker(time.Second)
defer ticker.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-ticker.C:
        doWork()
    }
}
```

Always `defer ticker.Stop()`. The ticker has an internal goroutine that delivers ticks; `Stop` shuts it down.

---

## Cancellation and Resource Cleanup

### `defer` for cleanup

Every resource acquired must have a `defer` for release:

```go
f, err := os.Open(path)
if err != nil {
    return err
}
defer f.Close()
```

This survives cancellation, panic, and early return. It is the idiom.

### Cleanup order matters

`defer` is LIFO. Locks released last:

```go
mu.Lock()
defer mu.Unlock()

f, err := os.Open(path)
if err != nil {
    return err
}
defer f.Close() // runs first

// work...
```

The file closes before the lock releases. Usually fine; occasionally you need a specific order, in which case you write explicit cleanup.

### Cancellation in the middle of a critical section

```go
mu.Lock()
defer mu.Unlock()
for _, x := range items {
    select {
    case <-ctx.Done():
        return ctx.Err()
    default:
    }
    process(x)
}
```

The lock is held across cancellation. That is fine as long as the cleanup (`defer mu.Unlock()`) runs reliably. Watch for: another goroutine cannot acquire the lock until cancellation cleanup completes.

### Multi-resource cleanup

```go
func loadAndStore(ctx context.Context) error {
    src, err := os.Open(srcPath)
    if err != nil {
        return err
    }
    defer src.Close()

    dst, err := os.Create(dstPath)
    if err != nil {
        return err
    }
    defer dst.Close()

    return copyCtx(ctx, dst, src)
}

func copyCtx(ctx context.Context, dst io.Writer, src io.Reader) error {
    buf := make([]byte, 32*1024)
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }
        n, err := src.Read(buf)
        if n > 0 {
            if _, werr := dst.Write(buf[:n]); werr != nil {
                return werr
            }
        }
        if err == io.EOF {
            return nil
        }
        if err != nil {
            return err
        }
    }
}
```

Each `defer Close` runs on any exit path, including cancellation. The cancellable copy checks per buffer (32 KB chunks); latency is bounded by chunk size and disk speed.

---

## Error Handling Strategies

### Map `ctx.Err()` to your error type

In service code, you often want a uniform error vocabulary:

```go
func (s *Service) Do(ctx context.Context) error {
    err := s.work(ctx)
    switch {
    case errors.Is(err, context.Canceled):
        return ErrCancelled
    case errors.Is(err, context.DeadlineExceeded):
        return ErrTimedOut
    default:
        return err
    }
}
```

### Wrap to preserve cause

```go
if err != nil {
    return fmt.Errorf("loading user %q: %w", id, err)
}
```

`%w` preserves the underlying error for `errors.Is` and `errors.As`.

### Use `context.WithCancelCause` for richer info

```go
ctx, cancel := context.WithCancelCause(parent)
// ...
cancel(fmt.Errorf("rate limit exceeded for tenant %s", tenantID))
```

Downstream code can call `context.Cause(ctx)` to retrieve the original cause. `ctx.Err()` still returns `context.Canceled`, but `context.Cause` returns the richer error.

### Distinguishing parent vs self cancellation

```go
func (s *Service) Do(parent context.Context) error {
    ctx, cancel := context.WithTimeout(parent, 5*time.Second)
    defer cancel()

    err := s.work(ctx)
    switch {
    case parent.Err() != nil:
        return parent.Err() // caller cancelled
    case errors.Is(err, context.DeadlineExceeded):
        return ErrSelfTimedOut // we hit our own deadline
    default:
        return err
    }
}
```

Check `parent.Err()` to tell whether cancellation came from above (the caller said stop) or from your own deadline.

---

## Observability

### Logging cancellation

```go
if errors.Is(err, context.Canceled) {
    log.Info("cancelled", "op", "loadUser", "id", id)
}
if errors.Is(err, context.DeadlineExceeded) {
    log.Warn("timed out", "op", "loadUser", "id", id)
}
```

Distinguish in logs. Timeouts are usually more interesting (someone's SLA was missed) than explicit cancels (someone changed their mind).

### Metrics

Counters for `cancelled` and `timed_out` separately. Histograms for "time to cancel notice" (how long after cancel did the worker actually exit?).

### Tracing

OpenTelemetry spans should record `cancelled` or `timed_out` as span status:

```go
ctx, span := tracer.Start(ctx, "loadUser")
defer span.End()

err := work(ctx)
if err != nil {
    if errors.Is(err, context.Canceled) {
        span.SetStatus(codes.Error, "cancelled")
    } else {
        span.RecordError(err)
    }
}
```

Helps you spot tail-latency requests that exhaust their budget and get killed.

---

## Performance Considerations

### Cost of a context check

A `select { case <-ctx.Done(): default: }` against a non-cancelled context is roughly 5–20 ns on modern hardware. `ctx.Err()` is roughly 1–5 ns (a single atomic load on the modern stdlib implementation). Either is cheap.

### Cost of context creation

`context.WithCancel(parent)` allocates a struct and a channel and registers a hook on the parent. Approximately 200–500 ns and a small heap allocation. Do not create per-iteration contexts in a hot inner loop.

### Deep context chains

Each `ctx.Done()` walks up the chain looking for the most recent cancellable context. For shallow chains this is irrelevant; for a 50-deep chain it adds up. In typical code, the chain is 2–5 deep — irrelevant.

### Polling frequency vs latency

If your cancellation latency target is 10 ms and each work unit takes 1 ms, poll every 10 units. If a work unit takes 100 µs, poll every 100 units. Tune to taste.

### Hot-path tricks

```go
const checkEvery = 1024
for i, item := range items {
    if i&(checkEvery-1) == 0 {
        if ctx.Err() != nil {
            return ctx.Err()
        }
    }
    process(item)
}
```

`i&(checkEvery-1)` is a bit-mask, cheaper than `i % checkEvery` for power-of-two `checkEvery`. Use when the inner loop is fast and you need every nanosecond.

---

## Testing Cancellable Code

### Test 1: cancellation actually stops the goroutine

```go
func TestWorkerStopsOnCancel(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    done := make(chan error)
    go func() { done <- work(ctx) }()
    cancel()
    select {
    case err := <-done:
        if !errors.Is(err, context.Canceled) {
            t.Errorf("expected Canceled, got %v", err)
        }
    case <-time.After(time.Second):
        t.Fatal("worker did not exit within 1s of cancel")
    }
}
```

### Test 2: timeout fires

```go
func TestWorkerTimesOut(t *testing.T) {
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()
    err := work(ctx)
    if !errors.Is(err, context.DeadlineExceeded) {
        t.Errorf("expected DeadlineExceeded, got %v", err)
    }
}
```

### Test 3: no goroutine leaks

```go
func TestNoLeaks(t *testing.T) {
    defer goleak.VerifyNone(t)
    // ... your test code ...
}
```

`go.uber.org/goleak` makes this one line. Add it to every concurrency-relevant test.

### Test 4: cancellation latency

```go
func TestCancelLatency(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    done := make(chan struct{})
    go func() {
        defer close(done)
        work(ctx)
    }()
    time.Sleep(10 * time.Millisecond) // let it start
    start := time.Now()
    cancel()
    <-done
    elapsed := time.Since(start)
    if elapsed > 50*time.Millisecond {
        t.Errorf("cancel took too long: %v", elapsed)
    }
}
```

Assert that your worker reacts within a budget. If it does not, your polling is too sparse.

### Test 5: graceful shutdown drains in-flight

```go
func TestShutdownDrains(t *testing.T) {
    s := NewService()
    s.Submit("job-1")
    s.Submit("job-2")
    err := s.Shutdown(context.Background())
    if err != nil {
        t.Fatal(err)
    }
    if !s.JobCompleted("job-1") || !s.JobCompleted("job-2") {
        t.Error("submitted jobs were not completed before shutdown returned")
    }
}
```

Graceful shutdown means in-flight items finish. Test that property.

---

## When Cooperative Is Not Enough

Three situations where cooperative cancellation cannot reach the worker:

### 1. Blocking syscalls

`net.Conn.Read`, `os.File.Read`, `unix.Read` all block in the kernel. The Go runtime parks the goroutine; cancellation cannot wake it. Solution: set a deadline on the underlying handle, or close the handle from another goroutine.

### 2. CGO calls

Once execution enters C code via cgo, the Go runtime cannot interrupt it. The OS thread is busy running C. Cancellation messages queue up in the goroutine but are not observed until C returns. Solution: design the C call to be short, or unblock it via external means (close a socket, set an OS flag).

### 3. Tight loops without checks

A pure-CPU loop with no context check is uncancellable until you add one. Async preemption (Go 1.14+) prevents the *scheduler* from starving but does not deliver cancellation. Solution: add a periodic `ctx.Err()` check.

In all three, the escape hatch is to "force stop" at the *process* level — `os.Exit(1)` after a grace period — or to redesign the workload so it has a cancellation point.

The senior file goes deep into the kernel-level mechanisms: signal-based forced cancellation via `runtime.LockOSThread`, the CGO state machine, and design patterns to bound C work.

---

## Anti-Patterns

### Anti-pattern 1: "I'll cancel by setting a bool"

```go
var stop bool

go func() {
    for !stop {
        work()
    }
}()
// ...
stop = true // data race; reader may never see this
```

Without synchronisation, the worker may never observe `stop = true`. Use `atomic.Bool` or a channel. Better: use `context.Context`.

### Anti-pattern 2: "I'll cancel by closing the input channel"

This works *only if* the worker reads from the channel. If the worker is blocked elsewhere (a syscall, a sleep), closing the channel does nothing. Use context as the cancellation signal; use channels for data.

### Anti-pattern 3: "I'll cancel by calling `panic` from outside"

You cannot panic from outside a goroutine. There is no API. And panicking from inside a goroutine kills the entire process. Do not.

### Anti-pattern 4: "I'll cancel with a fresh `context.Background()` inside the worker"

```go
func worker(parent context.Context) {
    ctx := context.Background() // discards parent cancellation
    for {
        select {
        case <-ctx.Done(): // never fires
            return
        }
    }
}
```

You have isolated yourself from the cancellation tree. Always derive from the parent.

### Anti-pattern 5: "I'll wait for cancellation with `time.Sleep`"

```go
time.Sleep(time.Hour)
// hope ctx is cancelled by now
```

`time.Sleep` is not a check. Use `select` with `<-ctx.Done()` and a timer.

### Anti-pattern 6: "Forgot `defer cancel()` because the function is short"

```go
ctx, _ := context.WithTimeout(parent, 5*time.Second)
return doWork(ctx)
```

`go vet` flags this as `lostcancel`. The timer leaks until either the deadline fires (5 seconds) or the parent cancels. Always `defer`.

---

## Production Stories

### Story 1: The 4 AM goroutine pile-up

A service ran fine for months. One Sunday at 4 AM the goroutine count graph hit 2 million. Cause: a downstream API started hanging after a deploy. The service's outgoing HTTP client had no timeout. Every incoming request spawned a goroutine that called the broken API and blocked forever. The fix: `http.Client{Timeout: 5*time.Second}` plus `context.WithTimeout` on every external call.

Lesson: cooperative cancellation requires that *the operation can be cancelled*. An HTTP call with no timeout cannot be cancelled by context — it can only be cancelled by closing the connection.

### Story 2: The shutdown that never ended

Kubernetes sent `SIGTERM`. The service called `srv.Shutdown(ctx)`. `Shutdown` returned after 30 seconds with `context.DeadlineExceeded`. The pod was killed by `SIGKILL`. Investigating: a long-running websocket handler held the request goroutine forever; it never observed `r.Context().Done()`. The fix: explicit polling inside the websocket loop.

Lesson: `http.Server.Shutdown` is only as graceful as its handlers. If a handler ignores its context, shutdown stalls.

### Story 3: The CGO call from hell

A service used a C library to validate certificates. Most calls returned in milliseconds. One certificate, due to a parser bug, sent the C code into an infinite loop. The Go goroutine was pinned to its OS thread (because cgo locks the M during the call). No context cancellation could reach it. The fix: run the cgo call in a child process with a hard timeout; kill the process if it doesn't return.

Lesson: cgo calls are an escape hatch that cooperative cancellation does not span. Treat them like an external service.

### Story 4: The captured context

A handler stored `r.Context()` in a struct field "for later use." When the handler returned, the context was cancelled. The "later use" code observed `ctx.Err()` and skipped its work. The fix: pass the context as a parameter; do not capture it.

Lesson: contexts are call-scoped. Once the call ends, the context is dead. Build a new context if you need background work to survive.

---

## Checklist

Before merging code that spawns goroutines or accepts a context:

- [ ] Every goroutine has a clear exit condition (cancellation, channel close, or bounded loop).
- [ ] Every `WithCancel` / `WithTimeout` / `WithDeadline` has a `defer cancel()`.
- [ ] `ctx context.Context` is the first parameter of every blocking function.
- [ ] No context is stored in a struct field (for request-scoped data).
- [ ] No goroutine ignores its context.
- [ ] Tests verify that cancellation actually stops the worker (with a time budget).
- [ ] `go.uber.org/goleak` is enabled in concurrency tests.
- [ ] External calls (HTTP, DB, RPC) all accept the context.
- [ ] Graceful shutdown drains in-flight work within a deadline.

---

## Summary

Cooperative cancellation in Go is a design discipline, not a feature. The mechanism (`context.Context`, `Done()`, `Err()`) is simple; the rules for using it (first parameter, defer cancel, derive children, observe at safe points) are uniform. The patterns at this level — worker pools, pipelines, fan-out, graceful shutdown — are about applying the mechanism systematically.

When cooperative cancellation cannot reach a worker (syscalls, cgo, tight loops), the answer is to either *make the operation cancellable from the outside* (close the resource, set a deadline) or to escalate to *process-level forced cancellation* (`os.Exit`, kill the cgo child). The senior file goes into the kernel-level mechanisms that enable the latter.

Master the patterns above and the everyday cancellation bugs disappear. The remaining hard problems — CGO state machines, signal delivery, locked OS threads — are next.
