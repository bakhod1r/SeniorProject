# Preventing Goroutine Leaks — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Library Design: Leaks Impossible by Construction](#library-design-leaks-impossible-by-construction)
3. [Code Review Checklist](#code-review-checklist)
4. [Real-World Example: HTTP Server Graceful Shutdown](#real-world-example-http-server-graceful-shutdown)
5. [Real-World Example: Kafka Consumer Group Lifecycle](#real-world-example-kafka-consumer-group-lifecycle)
6. [Anti-Patterns at Scale](#anti-patterns-at-scale)
7. [Audit Checklist for an Existing Codebase](#audit-checklist-for-an-existing-codebase)
8. [Lifecycle Across Service Boundaries](#lifecycle-across-service-boundaries)
9. [When Leaks Are Acceptable (and How to Document Them)](#when-leaks-are-acceptable-and-how-to-document-them)
10. [Patterns Beyond Start/Stop](#patterns-beyond-startstop)
11. [Self-Assessment](#self-assessment)
12. [Summary](#summary)

---

## Introduction

At junior and middle levels, the goal is to write a single goroutine that does not leak. At senior level, the goal is to design *systems* — libraries, services, platforms — where leaks are not possible for any caller, no matter how careless they are. The lever is the API. A well-designed API makes the leak-free path the easiest path; a poorly designed API requires every caller to remember the same five-line cleanup ritual, which they will eventually forget.

This file is about three shifts:

1. **From discipline to design.** Push the leak prevention out of caller code and into the type's contract.
2. **From individual reviews to systemic audits.** Bring an existing codebase under control with a checklist.
3. **From textbook examples to real systems.** HTTP servers, message consumers, and pool managers have well-known shapes; understanding them is the difference between writing a service and copying one.

You should already be fluent with `errgroup`, the Start/Stop struct, context propagation, and goleak in CI.

---

## Library Design: Leaks Impossible by Construction

### The contract: every spawn comes with a stop

A library that starts goroutines must expose a way to stop them. If your type's documentation says "this starts a background goroutine," it must also document the method that stops it. There is no exception.

Bad API:

```go
// metrics.go
func StartReporter(addr string) {
    go reporter(addr) // no way to stop
}
```

Caller has no handle. The goroutine is immortal until the process exits. If a test calls `StartReporter`, the goroutine survives the test and contaminates the next one.

Good API:

```go
type Reporter struct {
    cancel context.CancelFunc
    done   chan struct{}
}

func NewReporter(ctx context.Context, addr string) *Reporter {
    ctx, cancel := context.WithCancel(ctx)
    r := &Reporter{cancel: cancel, done: make(chan struct{})}
    go func() {
        defer close(r.done)
        report(ctx, addr)
    }()
    return r
}

func (r *Reporter) Close() error {
    r.cancel()
    <-r.done
    return nil
}
```

`Close` is documented, `io.Closer`-compatible, idempotent, and waits. The caller has no excuse for leaking the goroutine.

### Take a context in the constructor, not the methods

A type that owns long-lived goroutines should take a `context.Context` once, at construction:

```go
func NewReporter(ctx context.Context, addr string) *Reporter
```

This ties the goroutine's lifetime to a context the caller controls. If the caller wants the goroutine to stop, they can cancel the context — and `Close` is still available as a synchronous wait.

Don't take `ctx` in every method of a long-lived type for the *internal* goroutines' lifetime; that confuses per-call cancellation with type lifetime. Per-call methods take `ctx` for *that call's* cancellation, which is a different concern.

### `io.Closer`, not `Stop`

When the library exposes shutdown, prefer `io.Closer` over an ad hoc `Stop` method. `Close()` is the standard library's convention, and tools (linters, defer helpers, panicking-test wrappers) recognise it:

```go
defer r.Close()
```

Reserve `Stop` for cases where `Close` is meaningfully different (e.g., a watcher that has both `Stop` for the watch loop and `Close` for the underlying file handle).

### Don't expose a goroutine you don't own

If your library accepts a callback to run "in the background," you have implicitly handed the caller a goroutine they cannot stop. Either:

- Take a `context.Context` and use it as the stop signal.
- Return an `io.Closer` and document that callers must call `Close` to stop it.
- Refuse to expose the goroutine at all; require the caller to run the work themselves.

The pattern to avoid:

```go
// Bad: caller has no handle to the goroutine
func OnEveryTick(interval time.Duration, fn func()) {
    go func() {
        for range time.Tick(interval) {
            fn()
        }
    }()
}
```

Compare to:

```go
// Good: caller owns lifecycle
type Ticker struct { /* ... */ }

func NewTicker(ctx context.Context, interval time.Duration, fn func(context.Context)) *Ticker

func (t *Ticker) Close() error
```

### Pool pattern: own the lifecycle of your workers

Connection pools, worker pools, and similar types own a set of goroutines. The lifecycle pattern:

```go
type Pool struct {
    size   int
    cancel context.CancelFunc
    wg     sync.WaitGroup
    jobs   chan Job
}

func NewPool(ctx context.Context, size int) *Pool {
    ctx, cancel := context.WithCancel(ctx)
    p := &Pool{
        size:   size,
        cancel: cancel,
        jobs:   make(chan Job),
    }
    p.wg.Add(size)
    for i := 0; i < size; i++ {
        go func() {
            defer p.wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case j, ok := <-p.jobs:
                    if !ok {
                        return
                    }
                    j.Run(ctx)
                }
            }
        }()
    }
    return p
}

func (p *Pool) Submit(j Job) {
    p.jobs <- j
}

func (p *Pool) Close() {
    p.cancel()
    p.wg.Wait()
}
```

`Submit` doesn't accept a context, because the pool's goroutines have their own. If a submission needs a deadline, the caller wraps `Submit` in their own select.

### Two-phase shutdown for services

A service that handles in-flight work needs two phases:

1. **Drain**: stop accepting new work; wait for in-flight work to complete.
2. **Terminate**: cancel everything that hasn't finished by a deadline.

```go
type Service struct {
    cancel context.CancelFunc
    wg     sync.WaitGroup
    // ...
}

func (s *Service) Shutdown(ctx context.Context) error {
    close(s.acceptCh) // phase 1: stop accepting
    done := make(chan struct{})
    go func() {
        s.wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        s.cancel() // phase 2: force-cancel
        s.wg.Wait()
        return ctx.Err()
    }
}
```

The caller controls the drain window via the context's timeout. This is the same shape `http.Server.Shutdown` uses.

---

## Code Review Checklist

Every PR that adds or modifies concurrent code goes through this list. Mechanical, not optional.

### Spawn-level checks

- [ ] Every `go f()` is associated with a struct field or local variable that holds its cancel/stop mechanism.
- [ ] Every long-running goroutine accepts `ctx context.Context` as its first parameter.
- [ ] Every long-running goroutine has a `select` case for `<-ctx.Done()` and returns from it.
- [ ] No `context.Background()` appears outside `main`, top-level constructors, or in tests.
- [ ] No `context.TODO()` was committed (it's a placeholder, not a value).
- [ ] No `context.Context` stored in a struct field as a *call parameter* (it may be stored only when it owns the struct's internal goroutines).

### Channel checks

- [ ] Every channel that is closed has exactly one closer.
- [ ] The closer is the unique sender (or the unique coordinator of multiple senders).
- [ ] Receivers check the `ok` value when a close is possible.
- [ ] Buffer sizes are documented (constant, capacity, or "unbounded queue with back-pressure").
- [ ] No `time.After` in a long-running loop.

### Cleanup checks

- [ ] Every `time.NewTicker` is paired with `defer t.Stop()`.
- [ ] Every `time.NewTimer` is paired with `defer t.Stop()`.
- [ ] Every `context.WithCancel`/`WithTimeout`/`WithDeadline` has a corresponding `cancel()` (or `defer cancel()`).
- [ ] Every type that spawns a goroutine in its constructor exposes a `Close` (or equivalent) method.
- [ ] Every test that uses a struct with `Close` calls it in `defer` or test cleanup.

### Test-level checks

- [ ] The package's `TestMain` calls `goleak.VerifyTestMain(m)` (or each test defers `goleak.VerifyNone(t)`).
- [ ] Tests cover the cancellation path: pass an already-cancelled context, assert the function returns.
- [ ] Tests cover the timeout path: pass a context with a short deadline, assert the function honours it.
- [ ] If the code uses tickers, tests use `time.NewTicker` with a small interval or inject a clock.

### Mutex checks

- [ ] No mutex is held across a channel send or receive.
- [ ] No mutex is held across an HTTP call, database query, file I/O, or any other blocking syscall.
- [ ] `defer mu.Unlock()` immediately follows `mu.Lock()` unless there's a documented reason otherwise.
- [ ] `RWMutex` is used only when reads outnumber writes by 10x or more; otherwise plain `Mutex`.

### Documentation checks

- [ ] Types that own goroutines document their lifecycle in the package or type comment.
- [ ] The `Close` method documents whether it is idempotent and whether it waits.
- [ ] If `Close` may return an error, the comment explains under what conditions.

---

## Real-World Example: HTTP Server Graceful Shutdown

The canonical leak-free service skeleton.

```go
package main

import (
    "context"
    "errors"
    "log"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"

    "golang.org/x/sync/errgroup"
)

func main() {
    if err := run(); err != nil {
        log.Fatal(err)
    }
}

func run() error {
    rootCtx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    g, ctx := errgroup.WithContext(rootCtx)

    srv := &http.Server{
        Addr:              ":8080",
        Handler:           buildHandler(),
        ReadHeaderTimeout: 5 * time.Second,
        ReadTimeout:       30 * time.Second,
        WriteTimeout:      30 * time.Second,
        IdleTimeout:       120 * time.Second,
    }

    // Goroutine 1: run the server.
    g.Go(func() error {
        log.Printf("listening on %s", srv.Addr)
        if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            return err
        }
        return nil
    })

    // Goroutine 2: watch for shutdown and trigger graceful stop.
    g.Go(func() error {
        <-ctx.Done()
        shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
        defer cancel()
        return srv.Shutdown(shutdownCtx)
    })

    return g.Wait()
}

func buildHandler() http.Handler {
    mux := http.NewServeMux()
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        // Honour the request context for backend calls.
        select {
        case <-time.After(time.Second):
            w.Write([]byte("ok\n"))
        case <-r.Context().Done():
            return
        }
    })
    return mux
}
```

### What this code does right

1. **Signal handling**: `signal.NotifyContext` returns a context cancelled by SIGINT or SIGTERM. The whole tree below it inherits cancellation for free.
2. **Structured concurrency**: both the server goroutine and the shutdown goroutine live inside `errgroup.WithContext`. The function returns only after both finish.
3. **Drain window**: `srv.Shutdown` accepts a context with a 30-second timeout, the standard for graceful shutdown. Within that window, the server finishes in-flight requests and refuses new ones.
4. **Independent shutdown context**: the shutdown context is not derived from `rootCtx` (which is already cancelled), but from `context.Background()` with its own timeout. If we used the cancelled `rootCtx`, `srv.Shutdown` would return immediately and kill in-flight connections.
5. **Server-level timeouts**: `ReadTimeout`, `WriteTimeout`, `IdleTimeout` bound how long any single connection can stall. Without them, a slow client can hold a goroutine forever.
6. **Handler honours request context**: the handler selects on `r.Context().Done()`. When the client disconnects or shutdown begins, the handler returns promptly.

### Common bugs in this skeleton

- **Using `rootCtx` for `srv.Shutdown`**: the shutdown returns immediately because the context is already cancelled. In-flight requests are dropped.
- **No `IdleTimeout`**: keep-alive connections held by idle clients never time out, leaking a goroutine per connection.
- **No `ReadHeaderTimeout`**: a Slowloris attacker holds connections open with partial headers; each one is a leaked goroutine.
- **Handler ignoring `r.Context()`**: long handler operations don't notice the client disconnect; goroutines pile up.

### Testing the skeleton

```go
func TestRunShutsDownCleanly(t *testing.T) {
    defer goleak.VerifyNone(t)
    ctx, cancel := context.WithCancel(context.Background())
    errCh := make(chan error, 1)
    go func() { errCh <- runWithCtx(ctx) }()
    time.Sleep(50 * time.Millisecond) // let server start
    cancel()
    if err := <-errCh; err != nil {
        t.Fatal(err)
    }
}
```

`goleak` asserts no goroutines remain. The test will fail loudly if any handler or background goroutine outlives the shutdown.

---

## Real-World Example: Kafka Consumer Group Lifecycle

A Kafka consumer group is harder than an HTTP server because:

- Each partition is its own concurrent stream.
- Rebalances can swap partitions in and out mid-process.
- Commits must happen after processing, not before.
- The whole group must drain on shutdown without losing messages.

A leak-resistant skeleton (using a generic consumer interface; the principles apply to `confluent-kafka-go`, `segmentio/kafka-go`, `IBM/sarama`):

```go
type Consumer struct {
    client KafkaClient
    cancel context.CancelFunc
    wg     sync.WaitGroup
    closed chan struct{}
}

func NewConsumer(ctx context.Context, cfg Config) (*Consumer, error) {
    ctx, cancel := context.WithCancel(ctx)
    c := &Consumer{
        cancel: cancel,
        closed: make(chan struct{}),
    }
    client, err := newClient(cfg)
    if err != nil {
        cancel()
        return nil, err
    }
    c.client = client
    c.wg.Add(1)
    go func() {
        defer c.wg.Done()
        c.runGroup(ctx)
    }()
    return c, nil
}

func (c *Consumer) runGroup(ctx context.Context) {
    for {
        if err := c.consumeOnce(ctx); err != nil {
            if errors.Is(err, context.Canceled) {
                return
            }
            log.Printf("consume: %v; retrying in 1s", err)
            select {
            case <-ctx.Done():
                return
            case <-time.After(time.Second):
            }
        }
    }
}

func (c *Consumer) consumeOnce(ctx context.Context) error {
    session, err := c.client.JoinGroup(ctx)
    if err != nil {
        return err
    }
    defer session.Close()

    g, gctx := errgroup.WithContext(ctx)
    for _, partition := range session.Partitions() {
        partition := partition
        g.Go(func() error {
            return c.consumePartition(gctx, session, partition)
        })
    }
    return g.Wait()
}

func (c *Consumer) consumePartition(ctx context.Context, session Session, p Partition) error {
    for {
        msg, err := p.Next(ctx)
        if err != nil {
            return err
        }
        if err := c.handle(ctx, msg); err != nil {
            return err
        }
        if err := session.Commit(ctx, msg); err != nil {
            return err
        }
    }
}

func (c *Consumer) Close() error {
    c.cancel()
    c.wg.Wait()
    return c.client.Close()
}
```

### What this code does right

1. **One owning goroutine** (`runGroup`) at the top level, which owns *all* its children through `errgroup`.
2. **Per-partition goroutines** are spawned inside `errgroup.WithContext`, so a failure in one cancels the others — exactly what you want when the partition assignment is no longer valid.
3. **Cancellation reaches every layer**: `ctx` is the first argument to `JoinGroup`, `Next`, `handle`, and `Commit`. None of them can block forever.
4. **Rebalance handling**: when partitions change, `Next` returns an error (or the session ends); the loop returns, the parent `consumeOnce` returns, and `runGroup` calls `consumeOnce` again to re-join with new partitions.
5. **Backoff with cancellation**: the retry sleep uses `select` so cancellation isn't delayed by the retry.
6. **Idempotent close**: `c.cancel()` is safe to call multiple times; `c.wg.Wait()` blocks until all per-partition goroutines have stopped before closing the client.

### Common bugs in Kafka consumers

- **Forgetting to pass `ctx` to `Next`**: the consumer blocks in the library, ignoring shutdown.
- **Committing in a separate goroutine**: race conditions on commit order; the leak appears as "I keep getting the same message after restart."
- **Spawning a goroutine per message**: if `handle` is slow, you accumulate goroutines per message. Use the partition goroutine to serialise; if you need parallelism, use a fixed pool per partition.
- **Catching errors and continuing**: `consumeOnce` should return on any error so the rebalance loop can re-join. Eating errors inside the partition goroutine masks broker problems.

### Drain semantics

When `Close` is called mid-message:

- The partition goroutine sees `ctx.Done()` on its next `Next` call.
- If `handle(ctx, msg)` is in progress, it should also see `ctx.Done()` and return promptly (cooperative cancellation).
- `Commit` should not be called for half-processed messages.

If your handler does *exactly-once* work, the cancellation must happen *before* the side effect, not after. Design the handler accordingly.

---

## Anti-Patterns at Scale

### Fire-and-forget side effects

```go
func ProcessRequest(req Request) error {
    go func() { auditLog.Write(req) }()      // fire-and-forget
    go func() { metrics.Increment("rcv") }() // fire-and-forget
    return doWork(req)
}
```

Symptoms:

- Audit log entries silently disappear on shutdown.
- Metrics inflation: spawning a goroutine per request can outpace processing during a spike.
- No way to apply back-pressure: if `auditLog.Write` slows down, you accumulate goroutines instead of failing requests.

Fix: a queue-based pattern. `audit.Submit(req)` puts a copy on a bounded channel; an owned background worker drains the channel. Submission either blocks (back-pressure) or fails fast (load shedding), with explicit behaviour. The worker has a clean shutdown that drains the queue.

### Lazy goroutine for caching

```go
var once sync.Once

func GetConfig() Config {
    once.Do(func() {
        go refreshLoop() // spawned on first call, no owner
    })
    return current
}
```

The goroutine is started by the first caller and outlives them all. No shutdown. Common in HTTP middleware initialisation.

Fix: explicit `NewConfigService(ctx)` that returns a struct with a `Close`. The HTTP server constructs it before `ListenAndServe` and closes it on shutdown.

### "Just one more goroutine to handle the edge case"

```go
if specialCase {
    go retryAsync(req) // leaks if retryAsync hangs
}
```

Anywhere a goroutine is spawned conditionally, the owner is conditional. The conditional owner is a guarantee that someone, somewhere, will forget to close it.

Fix: spawn unconditionally inside a struct that always owns it, and have the goroutine itself check the condition.

### Per-connection goroutine without bounds

```go
for {
    conn, _ := listener.Accept()
    go handle(conn) // unbounded
}
```

Real services need rate limiting. A simple bound is a semaphore (or `errgroup.SetLimit`):

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(1000)
for {
    conn, err := listener.Accept()
    if err != nil {
        return err
    }
    g.Go(func() error {
        defer conn.Close()
        return handle(ctx, conn)
    })
}
```

Now connection count is bounded. Excess connections wait in the kernel's accept queue, and the OS can apply its own back-pressure (SYN queue overflow, RST).

---

## Audit Checklist for an Existing Codebase

You inherit a codebase. There are leaks. How do you find and fix them systematically?

### Phase 1: instrumentation (1 day)

1. Add `runtime.NumGoroutine` to a debug endpoint or metric. Watch it over a few hours of normal traffic.
2. Add `pprof` endpoints (`net/http/pprof`).
3. Take a goroutine profile (`go tool pprof http://service/debug/pprof/goroutine`) under load and under idle. Diff them.

If `NumGoroutine` grows over time with steady traffic, you have leaks. The pprof profile shows where they are parked.

### Phase 2: catalogue (1–2 days)

1. `grep -rn 'go ' --include='*.go'` to list every spawn site.
2. For each spawn site, identify:
   - The function or struct that owns it.
   - The stop signal (context, channel, none).
   - The wait point (`WaitGroup`, `errgroup`, none).
3. Tag each entry: `OWNED` (clear lifecycle), `IMPLICIT` (owner clear but no wait), `ORPHAN` (no clear owner).

The output is a spreadsheet of every goroutine in the system. The orphans are your priority list.

### Phase 3: add tests first (1 week)

For each package with concurrent code, add `goleak.VerifyTestMain` to a `TestMain`. Many tests will start failing. Each failure is a leak in the test (or in the code the test exercises).

Fix the leaks in the test setup first (forgotten `Close` calls), then fix the leaks in the code. After this phase, the test suite is clean.

### Phase 4: refactor the orphans (1–4 weeks)

For each orphan goroutine:

1. Wrap the spawn site in a struct (the Start/Stop pattern).
2. Thread `ctx` from the construction point.
3. Add the cancellation case to the goroutine's loop.
4. Update callers to call `Close`.
5. Add a test that exercises the cancellation path.

Do not try to fix all orphans in a single PR. One per PR, reviewed individually.

### Phase 5: prevent regression (ongoing)

1. CI: `go test ./...` with goleak required. Block merges on leak.
2. Linter: a custom `staticcheck` or `golangci-lint` config that flags `go` statements outside known patterns.
3. Code review checklist (see above) made mandatory.
4. Monthly review of `NumGoroutine` baseline in production. Spikes get investigated.

### When the audit reveals legitimate background goroutines

Some are: a connection pool's keepalive, a metrics flusher, a leader-election heartbeat. Document them in a `BACKGROUND_GOROUTINES.md` in the repo. List each one with: owner, lifetime, what triggers stop, how shutdown is verified. The doc is your allowlist of expected long-lived goroutines.

---

## Lifecycle Across Service Boundaries

When a goroutine's lifetime crosses a process boundary (gRPC stream, WebSocket, long-poll), the rules change slightly.

### Server streaming RPCs

The server-side stream handler runs in a goroutine until the client disconnects or it returns. The handler must:

1. Watch `stream.Context().Done()` for client disconnect.
2. Return promptly on disconnect (no fire-and-forget background work).
3. Bound any per-stream resources (counters, caches) and free them on return.

```go
func (s *Server) StreamData(req *pb.Req, stream pb.Svc_StreamDataServer) error {
    ctx := stream.Context()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case item := <-s.feed:
            if err := stream.Send(item); err != nil {
                return err
            }
        }
    }
}
```

Behind the scenes, gRPC manages the goroutine for this handler. Your job is to make it return promptly when the stream ends.

### WebSocket connections

Each connection is a goroutine (or two: one for reads, one for writes). The pattern:

```go
type Conn struct {
    cancel context.CancelFunc
    wg     sync.WaitGroup
}

func handleWebSocket(ws *websocket.Conn) {
    ctx, cancel := context.WithCancel(context.Background())
    c := &Conn{cancel: cancel}
    c.wg.Add(2)
    go func() { defer c.wg.Done(); c.readLoop(ctx, ws) }()
    go func() { defer c.wg.Done(); c.writeLoop(ctx, ws) }()
    c.wg.Wait()
}
```

When either loop returns (network error, ping timeout, client close), it calls `cancel()` to wake the other, and the function blocks until both have exited. No leaked goroutine per connection.

---

## When Leaks Are Acceptable (and How to Document Them)

Some goroutines are intentionally immortal. The Go runtime's GC has them. Standard library packages (`net/http` keepalive pools, `database/sql` connection pool maintainers) have them. Your service probably has a few.

The rule: an immortal goroutine is *explicitly documented*, with these facts:

- It is started exactly once, at process start (not per-request, not per-connection).
- Its memory footprint is bounded and known.
- Its work is idempotent if the process is killed mid-iteration.
- It is on the allowlist for goleak and for the goroutine-count alert.

A documented immortal goroutine is fine. An undocumented one is a leak in disguise.

---

## Patterns Beyond Start/Stop

### Supervisor pattern

A supervisor owns a set of goroutines. If one dies, the supervisor restarts it. Common in long-lived workers that may panic:

```go
type Supervisor struct {
    cancel context.CancelFunc
    wg     sync.WaitGroup
}

func (s *Supervisor) Spawn(name string, fn func(ctx context.Context) error) {
    s.wg.Add(1)
    go func() {
        defer s.wg.Done()
        for {
            err := s.runOnce(name, fn)
            if errors.Is(err, context.Canceled) {
                return
            }
            log.Printf("supervisor: %s exited: %v; restarting", name, err)
            select {
            case <-s.ctx.Done():
                return
            case <-time.After(time.Second):
            }
        }
    }()
}
```

The supervisor itself is owned by its caller and shuts down cleanly. Children that panic don't bring down the process; they get restarted.

### Lifecycle manager

For services with many components, a lifecycle manager coordinates start and stop:

```go
type Lifecycle struct {
    components []Component
}

func (l *Lifecycle) Add(c Component) { l.components = append(l.components, c) }

func (l *Lifecycle) Start(ctx context.Context) error {
    for _, c := range l.components {
        if err := c.Start(ctx); err != nil {
            l.Stop(context.Background()) // unwind
            return err
        }
    }
    return nil
}

func (l *Lifecycle) Stop(ctx context.Context) error {
    var errs []error
    for i := len(l.components) - 1; i >= 0; i-- {
        if err := l.components[i].Stop(ctx); err != nil {
            errs = append(errs, err)
        }
    }
    return errors.Join(errs...)
}
```

Components register at construction; the manager starts them in order, stops them in reverse, and surfaces all errors. This is the structural backbone of frameworks like fx, kratos, and similar.

---

## Self-Assessment

- [ ] You can design a library type that exposes a long-lived goroutine and makes it impossible for the caller to leak it.
- [ ] You can perform a code review of a 500-line concurrent diff and identify every leak vector.
- [ ] You can write the HTTP server graceful shutdown skeleton from memory, including all the standard timeouts.
- [ ] You can explain the role of each context in a Kafka consumer group's lifecycle.
- [ ] You can audit a 50,000-line codebase for leaks with a documented plan.
- [ ] You know when to use a supervisor and when not to (hint: rarely; structured concurrency covers most cases).
- [ ] You can explain why `context.Background()` inside `srv.Shutdown` is correct even though the parent context is already cancelled.

---

## Summary

Senior-level leak prevention is design, not vigilance. The lever is the type's API:

- Every type that owns goroutines exposes a `Close` (or `Stop`).
- The `Close` is idempotent and waits.
- The constructor takes a context that scopes the goroutine's lifetime.
- The contract is documented in the type comment.

Beyond individual types, the patterns scale:

- HTTP servers use `Shutdown` with an independent timeout context.
- Kafka consumers use nested `errgroup` for partition lifecycle and rebalance.
- Supervisors restart panicking children without leaking.
- Lifecycle managers coordinate start/stop across whole services.

For an existing codebase, the audit is a five-phase project: instrument, catalogue, test, refactor, prevent. The output is a system where leaks are bugs caught in CI, not weekly fires in production. Once the design has these properties, the prevention work moves from individual code to platform-level guarantees — covered in the [professional level](professional.md).
