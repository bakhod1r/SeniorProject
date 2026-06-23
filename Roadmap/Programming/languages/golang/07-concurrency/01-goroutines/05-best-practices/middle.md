# Goroutine Best Practices — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [From Rules to Patterns](#from-rules-to-patterns)
3. [`errgroup` in Anger](#errgroup-in-anger)
4. [Worker Pools, Bounded Channels, Semaphores](#worker-pools-bounded-channels-semaphores)
5. [Structured Concurrency in Go](#structured-concurrency-in-go)
6. [Graceful Shutdown](#graceful-shutdown)
7. [Context Discipline](#context-discipline)
8. [Recover Helpers and Logging Strategy](#recover-helpers-and-logging-strategy)
9. [Concurrent Data Structures: Mutex vs `sync.Map` vs Channel-Owned State](#concurrent-data-structures-mutex-vs-syncmap-vs-channel-owned-state)
10. [Testing Concurrent Code](#testing-concurrent-code)
11. [Leak Detection in CI](#leak-detection-in-ci)
12. [Self-Assessment](#self-assessment)
13. [Summary](#summary)

---

## Introduction

The junior level introduced the twelve canonical rules. At middle level, you apply them in real services and run into the second-order questions: how big should the worker pool be? Where do `recover` helpers belong? When does `errgroup` not fit? What's the production-shaped error path? How do tests prove the rules are followed, not just that the code runs?

This file is the working-engineer's version. Each section assumes you already accept the rules; the question is *how* to wire them into a service that survives a production environment.

---

## From Rules to Patterns

Rules are negative ("don't do X"); patterns are positive ("do Y"). A mature codebase doesn't read like a list of don'ts — it reads like a small set of repeating patterns. Three patterns cover roughly 90% of goroutine usage in a service:

| Pattern | Use case |
|---|---|
| **Fan-out / fan-in with `errgroup`** | Parallel calls to N downstreams, collect results or first error. |
| **Bounded worker pool** | Long-lived consumers reading from a queue or channel. |
| **Periodic loop with context** | Heartbeats, metric flushes, garbage collection of caches. |

The remaining 10% are special: pipelines, broadcast topologies, supervisors. Build them on top of the three.

The discipline: when you reach for `go func()`, ask "which of the three patterns is this?" If the answer is "none," double-check that you really want a new shape.

---

## `errgroup` in Anger

`golang.org/x/sync/errgroup` is the workhorse. Here are the production-level details.

### `WithContext`: not optional

```go
g, ctx := errgroup.WithContext(parent)
```

Always use `WithContext`. The bare `errgroup.Group{}` is for trivial cases; in a service, you want first-error cancellation. Pass the returned `ctx` to children:

```go
g.Go(func() error {
    return doWork(ctx, x)        // ctx, not parent
})
```

Otherwise the cancellation cascade doesn't reach the child.

### `SetLimit(n)`: bound concurrency

Available in Go 1.20+. Caps how many `g.Go` callbacks run concurrently. Cleaner than a separate semaphore:

```go
g, ctx := errgroup.WithContext(parent)
g.SetLimit(16)
for _, url := range urls {
    url := url
    g.Go(func() error { return fetch(ctx, url) })
}
return g.Wait()
```

Pick the limit by measuring, not by guessing. Typical starting points:

- CPU-bound work: `runtime.GOMAXPROCS(0)` (one worker per logical CPU).
- Network-bound work to one host: 8–64 depending on the host's tolerance.
- Network-bound work to many hosts: 256–1024 if you have to keep them all in flight.

### When `errgroup` is not enough

- You need to collect *all* errors, not just the first. Use a mutex-protected slice or `errors.Join`.
- You need partial results when some workers fail. Catch errors inside each `Go` and don't return them; aggregate manually.
- Workers depend on each other (output of A feeds B). Use a pipeline, not a fan-out.
- You need different timeouts per worker. Use `context.WithTimeout` per `Go` body.

### Common `errgroup` bugs

```go
// Bug A: forgot to shadow loop variable (pre-1.22)
for _, url := range urls {
    g.Go(func() error { return fetch(ctx, url) })   // wrong url
}

// Bug B: bare parent context
g.Go(func() error { return fetch(parent, url) })    // cancellation lost

// Bug C: returning nil "to signal completion"
g.Go(func() error {
    if done() { return nil }                        // doesn't cancel peers
    return work()
})
```

---

## Worker Pools, Bounded Channels, Semaphores

Three implementations of the same idea: "at most N goroutines in flight." Pick by ergonomics, not by raw performance — they are close enough.

### Implementation A: fixed pool over a channel

```go
func pool(ctx context.Context, in <-chan Job, n int, handle func(context.Context, Job) error) error {
    g, ctx := errgroup.WithContext(ctx)
    for i := 0; i < n; i++ {
        g.Go(func() error {
            for {
                select {
                case <-ctx.Done():
                    return ctx.Err()
                case j, ok := <-in:
                    if !ok {
                        return nil
                    }
                    if err := handle(ctx, j); err != nil {
                        return err
                    }
                }
            }
        })
    }
    return g.Wait()
}
```

Use when:

- Workers are long-lived (lifetime ≈ service lifetime).
- Jobs arrive over time.
- You care about throughput more than latency.

### Implementation B: per-item goroutine with `errgroup.SetLimit`

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(n)
for _, item := range items {
    item := item
    g.Go(func() error { return process(ctx, item) })
}
return g.Wait()
```

Use when:

- Items are known up front.
- You want a single join at the end.
- Each item is non-trivial (otherwise the spawn cost dominates).

### Implementation C: semaphore channel

```go
sem := make(chan struct{}, n)
var wg sync.WaitGroup
for _, item := range items {
    item := item
    sem <- struct{}{}
    wg.Add(1)
    go func() {
        defer wg.Done()
        defer func() { <-sem }()
        process(item)
    }()
}
wg.Wait()
```

Use when:

- You can't import `errgroup` for some reason.
- You're mixing pool ownership across multiple call sites.

The first two patterns are preferred. The semaphore is fine but more bookkeeping.

### Sizing the pool

Three considerations:

- **Resource caps.** N file descriptors, N database connections, etc. Pool size ≤ resource cap.
- **Downstream tolerance.** A third-party API that 429s above 50 requests/sec needs N small enough that you stay below the limit.
- **Memory.** N goroutines × per-goroutine memory (stacks plus per-job allocations). Bound to fit your memory budget.

Start with a number based on the smallest of the three. Measure. Adjust.

---

## Structured Concurrency in Go

*Structured concurrency* is the discipline that every goroutine's lifetime is bounded by a lexical scope — typically a function call. The function does not return until every goroutine it spawned has returned. There are no detached goroutines.

Go does not enforce structured concurrency at the language level (unlike Python's `asyncio.TaskGroup` or Trio's `nursery`). But you can adopt it as a convention:

```go
func process(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    for _, item := range items {
        item := item
        g.Go(func() error { return work(ctx, item) })
    }
    return g.Wait()
}
```

Every goroutine spawned by `process` returns before `process` does (by definition of `g.Wait`). Locally, structured concurrency is achieved.

### Why it matters

- **No leaks by construction.** If `process` returns, every spawned goroutine has returned.
- **Errors propagate naturally.** `g.Wait` returns the first error.
- **Cancellation cascades.** Cancelling the context cancels every descendant.
- **Stack traces make sense.** Every goroutine's stack is reachable from a known function.

### Where it breaks

- **Fire-and-forget metrics.** A goroutine that flushes metrics in the background doesn't fit lexical scoping.
- **Long-lived workers.** A worker pool that runs for the lifetime of the service is bounded by the service, not by a function.

For these, lift the scope to the service (`Service.Run(ctx)` runs until `ctx` cancels; every goroutine respects `ctx`). The structure is at the service level, not the function level.

---

## Graceful Shutdown

A correctly-behaving Go service does the following on SIGTERM:

1. Stop accepting new work (close the listener, stop pulling from the queue).
2. Cancel the root context to signal in-flight work to wind down.
3. Wait (with a bounded deadline) for in-flight goroutines to return.
4. Exit with code 0.

If shutdown takes longer than the deadline, log which goroutines are still alive (using `pprof goroutine`) and exit anyway.

### Skeleton

```go
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    // Translate SIGTERM/SIGINT into cancel.
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
    go func() {
        <-sigCh
        log.Println("shutting down")
        cancel()
    }()

    if err := run(ctx); err != nil {
        log.Fatal(err)
    }
}

func run(ctx context.Context) error {
    srv := &http.Server{Addr: ":8080", Handler: newRouter()}
    g, ctx := errgroup.WithContext(ctx)

    g.Go(func() error {
        log.Println("listening on", srv.Addr)
        if err := srv.ListenAndServe(); err != http.ErrServerClosed {
            return err
        }
        return nil
    })

    g.Go(func() error {
        <-ctx.Done()
        shutCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
        defer cancel()
        return srv.Shutdown(shutCtx)
    })

    g.Go(func() error { return backgroundWorker(ctx) })

    return g.Wait()
}
```

This wires together every rule:

- Single root context (Rule 4).
- `errgroup` joins everything (Rule 6).
- Each goroutine has a clear exit story (Rule 1).
- A bounded shutdown deadline (no infinite hang).

### The "drain" stage

If the service runs background jobs from an in-memory queue, shutdown needs a drain stage:

```go
g.Go(func() error {
    <-ctx.Done()
    // Stop accepting new jobs.
    close(jobCh)
    // The worker pool drains jobCh; pool's own goroutines exit naturally.
    return nil
})
```

The order is: cancel root → workers stop pulling new external work → drain in-memory buffers → join everyone → exit.

---

## Context Discipline

`context.Context` is the most-misused type in Go. The middle-level discipline:

### Rules of context

1. **`Context` is the first parameter, named `ctx`.** Standard library convention.
2. **Don't store contexts in structs.** Pass them as call arguments.
3. **`context.Background()` only at the top of `main` or in tests.** Nowhere else.
4. **`context.TODO()` is for when you don't know what context to use.** It is a marker for "fix this later" — and the linter (e.g., `contextcheck`) can find them.
5. **`WithCancel` returns a `cancel`; always `defer cancel()`** (otherwise the timer leaks).
6. **Don't use `context.Value` for required parameters.** Use it for cross-cutting trace IDs, not for the user ID your function needs.

### Wrapping context

When a function needs both a deadline and the parent context's values:

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
```

The result inherits values from `parent` and adds its own deadline. The cancel is for *this* timer; calling it doesn't cancel `parent`.

### Detecting context misuse

- `golang.org/x/tools/go/analysis/passes/contextcheck` flags functions that take a context but don't use it.
- `staticcheck`'s SA1029 flags context keys with built-in types.
- `revive`'s `context-as-argument` enforces the "first parameter" rule.

---

## Recover Helpers and Logging Strategy

A `safeGo` helper centralises the recover-and-log policy. The naive version:

```go
func safeGo(name string, fn func()) {
    go func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("goroutine %q panic: %v\n%s", name, r, debug.Stack())
            }
        }()
        fn()
    }()
}
```

The production version adds:

- Structured logging (zap, slog) with the panic value as a field.
- A metric (`panics_total{goroutine="..."}`) so panics are visible on the dashboard.
- Optional re-raise: if the panic represents an unrecoverable state (corrupted invariants), call `os.Exit(2)` rather than continue.

```go
func SafeGo(ctx context.Context, name string, fn func(context.Context)) {
    go func() {
        defer func() {
            if r := recover(); r != nil {
                stack := debug.Stack()
                slog.ErrorContext(ctx, "goroutine panic",
                    "name", name,
                    "panic", fmt.Sprintf("%v", r),
                    "stack", string(stack))
                metrics.GoroutinePanics.WithLabelValues(name).Inc()
            }
        }()
        fn(ctx)
    }()
}
```

Treat panics in goroutines as bugs to fix, not as part of the application's error model. Every panic that hits the recover should result in either:

- A fix in the code that caused the panic, or
- A documented "this input is invalid; we now return error X instead of panicking."

---

## Concurrent Data Structures: Mutex vs `sync.Map` vs Channel-Owned State

When multiple goroutines share state, three patterns are common. Each has a sweet spot.

### `sync.Mutex` / `sync.RWMutex` wrapping a plain map

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string][]byte
}

func (c *Cache) Get(k string) ([]byte, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    v, ok := c.m[k]
    return v, ok
}
```

Pros: simple, fast under low contention, predictable. Cons: scales poorly under heavy write contention; one slow operation under the lock blocks everyone.

### `sync.Map`

```go
var cache sync.Map
cache.Store("k", v)
val, ok := cache.Load("k")
```

Pros: optimised for "many distinct keys, mostly reads" or "keys that are written once and read many times." Cons: slower than a mutex+map for moderate write rates, no value type safety (returns `any`), no iteration ordering guarantees.

Use `sync.Map` only when the documented sweet spot fits. Otherwise prefer mutex+map.

### Channel-owned state

```go
type Counter struct {
    incCh chan struct{}
    getCh chan chan int
}

func (c *Counter) run() {
    var n int
    for {
        select {
        case <-c.incCh:
            n++
        case ch := <-c.getCh:
            ch <- n
        }
    }
}
```

Pros: serialises access without explicit locking; composes well with `select`. Cons: more code; introduces an additional goroutine (= an exit story to manage); slower for simple counters.

Use channel-owned state when the operation is naturally a message ("apply this update to the state") rather than a mutation ("increment that field").

### Decision matrix

| Workload | Choice |
|---|---|
| Counter with high write rate | `atomic.Int64` |
| Cache with mixed reads/writes | mutex + map |
| Read-mostly map with distinct keys per write | `sync.Map` |
| State that responds to commands and queries | channel-owned actor |
| Set of values for membership checks | mutex + map[T]struct{} |

---

## Testing Concurrent Code

Testing concurrency is its own discipline. The middle-level toolkit:

### Race detector

Enable in CI:

```bash
go test -race ./...
```

Run unit and integration tests under `-race`. Most flake reports trace back to a real race.

### `goleak` per-package

```go
package mypkg_test
import (
    "testing"
    "go.uber.org/goleak"
)
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

Test-level alternative:

```go
func TestProcess(t *testing.T) {
    defer goleak.VerifyNone(t)
    // ...
}
```

### Deterministic synchronisation in tests

Instead of `time.Sleep`, expose a synchronisation point:

```go
// In code:
type Worker struct {
    onReady chan struct{}
}
func (w *Worker) Start() {
    go func() {
        w.setup()
        close(w.onReady)
        w.loop()
    }()
}

// In test:
w := newWorker()
w.Start()
select {
case <-w.onReady:
case <-time.After(time.Second):
    t.Fatal("timeout")
}
```

The test waits for the *event*, with a deadline that catches hangs.

### `testing/synctest` (Go 1.24+)

Go 1.24 introduced `testing/synctest`, which fakes time and lets concurrent code be tested deterministically. Worth adopting where available:

```go
synctest.Run(func() {
    // time.Sleep, time.After, time.Tick all use fake time here.
    // The package waits until all goroutines are blocked, then advances.
})
```

This eliminates a class of "wait long enough" flakiness.

### Stress-testing

For code where ordering matters, run the test many times with `-count`:

```bash
go test -race -count=1000 ./... -run TestRaceyThing
```

A race that reproduces 1 in 100 runs becomes 10 reproductions in 1000 runs.

---

## Leak Detection in CI

A leak detector in CI is what turns "we have a discipline" into "we enforce a discipline."

### Strategy 1: `goleak` everywhere

Add `goleak.VerifyTestMain(m)` to every package's `TestMain`. New tests that leak fail. Old leaks that escaped notice now surface.

Cost: some legitimate background goroutines from imports (HTTP/2, DNS resolver) need to be allowed:

```go
goleak.VerifyTestMain(m,
    goleak.IgnoreTopFunction("net/http.(*Transport).readBufferingLoop"),
    goleak.IgnoreCurrent(),
)
```

`IgnoreCurrent` ignores goroutines alive at the start (e.g., the test runner's own).

### Strategy 2: production goroutine profiling

`net/http/pprof` exposes `/debug/pprof/goroutine`. In production, scrape it periodically:

```bash
go tool pprof http://host:6060/debug/pprof/goroutine
(pprof) top 10
```

A leak shows up as a stack-trace count that grows monotonically over hours.

Set up an alert: if `go_goroutines{job="myservice"}` (Prometheus) crosses a threshold for more than 10 minutes, page.

### Strategy 3: CI smoke test

Run the service under integration test, do typical workflows, then check the goroutine count is back to baseline:

```go
base := runtime.NumGoroutine()
runWorkload()
if runtime.NumGoroutine() > base+5 {
    t.Fatalf("leak: %d -> %d", base, runtime.NumGoroutine())
}
```

The "+5" tolerates noise from runtime-internal goroutines. Tune to your environment.

---

## Self-Assessment

- [ ] I have used `errgroup.SetLimit` in real code.
- [ ] I can explain when `sync.Map` is preferred over a mutex+map.
- [ ] I have set up graceful shutdown for a service.
- [ ] My services use a single root context that cancels on SIGTERM.
- [ ] I have a `safeGo`-style helper or know which package's I use.
- [ ] I run `go test -race` in CI on a dedicated job.
- [ ] I use `goleak.VerifyTestMain` in at least one package.
- [ ] I know that `context.Background()` should only appear in `main` and tests.
- [ ] I have replaced a `time.Sleep` synchronisation with an event channel.
- [ ] I have written or used `testing/synctest`-style tests.

---

## Summary

At middle level, the twelve rules become three patterns (fan-out with `errgroup`, bounded worker pool, periodic loop with context) and a small toolkit (`safeGo`, `errgroup.SetLimit`, `goleak`, race detector in CI). Graceful shutdown is the integration test that proves the patterns work together. Tests use event-based synchronisation, not `time.Sleep`. Concurrent state uses the right primitive for the workload, not "always channels" or "always mutex." The next level — senior — is about pushing these conventions across a team via review checklists and style guides.
