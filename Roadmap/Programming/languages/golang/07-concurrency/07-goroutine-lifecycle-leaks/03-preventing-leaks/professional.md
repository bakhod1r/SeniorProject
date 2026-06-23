# Preventing Goroutine Leaks — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Platform-Level Guarantees](#platform-level-guarantees)
3. [Compile-Time Enforcement](#compile-time-enforcement)
4. [Lifecycle Frameworks and DI Containers](#lifecycle-frameworks-and-di-containers)
5. [Runtime Hooks for Leak Surveillance](#runtime-hooks-for-leak-surveillance)
6. [Cancellation Latency Budgets](#cancellation-latency-budgets)
7. [Interaction with the Runtime and the Scheduler](#interaction-with-the-runtime-and-the-scheduler)
8. [Building a Concurrency Style Guide](#building-a-concurrency-style-guide)
9. [Self-Assessment](#self-assessment)
10. [Summary](#summary)

---

## Introduction

At professional level, the question is no longer "how do I prevent a leak in this function?" or even "how do I design this type to be leak-proof?" It is "how do I make leaks structurally impossible across an organisation of 50 engineers and 200 services?" The answer is platform: a combination of a shared concurrency framework, compile-time checks, runtime hooks, and a style guide enforced by tooling.

This file is for the engineer responsible for the concurrency story across a fleet. The patterns here are not exotic; they are the senior-level patterns packaged so that other teams pick them up without reading 700 lines of guidance.

---

## Platform-Level Guarantees

### The shared lifecycle base

A platform team provides a `lifecycle` package that every service uses:

```go
package lifecycle

type Component interface {
    Name() string
    Start(ctx context.Context) error
    Stop(ctx context.Context) error
}

type Manager struct {
    components []Component
    started    []Component
    mu         sync.Mutex
}

func (m *Manager) Register(c Component) {
    m.mu.Lock()
    defer m.mu.Unlock()
    m.components = append(m.components, c)
}

func (m *Manager) Run(ctx context.Context) error {
    if err := m.startAll(ctx); err != nil {
        m.stopAll(context.Background())
        return err
    }
    <-ctx.Done()
    stopCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    return m.stopAll(stopCtx)
}
```

Services adopt it:

```go
mgr := lifecycle.NewManager()
mgr.Register(db)
mgr.Register(cache)
mgr.Register(server)
return mgr.Run(ctx)
```

Every component goes through the same start/stop discipline. The platform team owns the manager; service teams get the leak prevention for free.

### Concurrency primitives wrapper

The platform package wraps `errgroup` and `context` with defaults appropriate to the organisation:

```go
package concurrency

func Go(ctx context.Context, name string, fn func(ctx context.Context) error) {
    pool.Submit(ctx, name, fn)
}
```

Inside, `Go` registers the goroutine in a goroutine registry (with name, start time, owner), runs the function with panic recovery, and unregisters on exit. The registry powers a `/debug/goroutines` endpoint that's far richer than `pprof/goroutine`: it shows business-logic names, ages, parent goroutines.

The trade-off: callers no longer write `go ...` directly; they go through the wrapper. The benefit is fleet-wide visibility into every goroutine.

---

## Compile-Time Enforcement

### Custom linters

`golangci-lint` includes useful checks:

- `contextcheck`: every function that takes `ctx` passes it down.
- `containedctx`: warns when a context is stored in a struct field.
- `noctx`: forbids `http.NewRequest` without `WithContext`.

Beyond off-the-shelf, organisations write custom linters using `go/analysis`. Examples:

- A linter that flags `go ` statements outside approved packages (e.g., only `lifecycle/`, `worker/`, and `pool/` may spawn goroutines directly; everywhere else uses the wrapper).
- A linter that flags `time.After` inside `for` loops.
- A linter that requires every type with a goroutine field (a `chan` or `cancel`) to have a `Close` method.
- A linter that requires every `context.WithCancel`/`WithTimeout`/`WithDeadline` to have a `cancel()` call in the same lexical scope.

Custom linters take a week to write and pay for themselves the first time they catch a bug.

### Build-time checks

Some checks are easier in build flags than in the AST:

- `go vet ./...` already catches missing `cancel()` and improperly-passed contexts.
- `-race` in CI catches mutex-around-channel patterns at runtime, which often correlate with leaks.

### CODEOWNERS gating

Files that spawn goroutines (the `lifecycle/`, `pool/`, `worker/` directories) have a `CODEOWNERS` entry that requires a member of the concurrency team to review changes. Service teams don't write `go` statements unsupervised in those files.

---

## Lifecycle Frameworks and DI Containers

### Uber fx, Google wire, kratos

DI frameworks like fx provide lifecycle hooks as a built-in. Components register `OnStart` and `OnStop`:

```go
fx.Invoke(func(lc fx.Lifecycle, srv *Server) {
    lc.Append(fx.Hook{
        OnStart: func(ctx context.Context) error { return srv.Start(ctx) },
        OnStop:  func(ctx context.Context) error { return srv.Stop(ctx) },
    })
})
```

The framework guarantees start/stop ordering, timeout discipline, and shutdown traceability. The trade-off is a heavier framework with its own learning curve and runtime cost.

For a 200-service organisation, the trade is often worth it. For a single service, the in-house `lifecycle.Manager` above is enough.

### Choosing not to adopt a framework

Some organisations explicitly reject DI frameworks. Reasons:

- Frameworks hide the goroutine count behind their own abstractions.
- Errors and panics in framework code are harder to debug.
- Engineers leaving the org take framework expertise with them.

The replacement is a strict in-house pattern documented in the style guide and enforced by linters. Either is defensible; the bad choice is "no framework and no style guide."

---

## Runtime Hooks for Leak Surveillance

### Goroutine registry

A registry tracks every named goroutine. Implementation:

```go
type Registry struct {
    mu   sync.Mutex
    next int64
    live map[int64]Entry
}

type Entry struct {
    ID        int64
    Name      string
    StartedAt time.Time
    Stack     []byte
}

func (r *Registry) Track(name string, fn func()) {
    id := r.add(name)
    defer r.remove(id)
    fn()
}
```

Every `concurrency.Go` call registers; on return, it unregisters. The `/debug/goroutines` endpoint dumps the registry. Operators can see "12 goroutines named `kafka-consumer-orders-partition-5` running for 3 hours" — far more useful than `pprof/goroutine`'s anonymous function names.

### Goroutine count alarms

Every service exports `runtime.NumGoroutine` as a metric. The platform's monitoring system:

- Tracks the median goroutine count over a 7-day window per service.
- Alerts when the count exceeds the median by 3x for more than 10 minutes.
- Links the alert to the service's `/debug/goroutines` and `/debug/pprof/goroutine` for one-click investigation.

This catches leaks before users do. The threshold (3x median, 10 minutes) is tunable: noisy services raise it, quiet services lower it.

### Heap and goroutine snapshot on shutdown

A shutdown hook dumps `runtime.Stack` of all goroutines and a heap profile to disk if shutdown takes longer than expected:

```go
func slowShutdownHook(stuck time.Duration) {
    go func() {
        select {
        case <-shutdownDone:
            return
        case <-time.After(stuck):
            buf := make([]byte, 64<<20)
            n := runtime.Stack(buf, true)
            os.WriteFile("/tmp/stuck-shutdown.txt", buf[:n], 0o644)
            pprof.Lookup("heap").WriteTo(os.Stderr, 1)
        }
    }()
}
```

If a service ever exits non-gracefully, the post-mortem artefacts are on disk. The platform team aggregates them and reviews them weekly.

---

## Cancellation Latency Budgets

### Defining the budget

The cancellation latency budget is: from the moment `cancel()` is called, how long can elapse before all owned goroutines have exited?

Typical budgets:

- Internal microservice: 1 second.
- Public-facing HTTP service with in-flight requests: 30 seconds.
- Batch worker that must finish a unit of work: 5 minutes.

The budget is part of the service's contract. SREs page when shutdown exceeds the budget.

### How to meet the budget

For each long-running goroutine:

- The select must include `<-ctx.Done()`.
- Any blocking call (DB query, HTTP call, RPC) must propagate the context.
- Any sleep must use `select` with `<-ctx.Done()`, not `time.Sleep`.
- Tight loops must check `ctx.Err()` periodically (every iteration, or every N iterations for very tight loops).

The hardest case is a CPU-bound loop that does not call any cancellable function:

```go
for i := range items {
    if i%1000 == 0 {
        if ctx.Err() != nil {
            return ctx.Err()
        }
    }
    crunch(items[i])
}
```

Modulo check every 1000 iterations is usually fine; tune per workload.

### Cancellation tests

```go
func TestCancellationLatency(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    c := NewComponent(ctx)
    time.Sleep(10 * time.Millisecond) // let it ramp up
    start := time.Now()
    cancel()
    c.Wait()
    if elapsed := time.Since(start); elapsed > 100*time.Millisecond {
        t.Errorf("cancellation took %v, budget 100ms", elapsed)
    }
}
```

Run this in CI for every long-running component. A regression that adds latency to shutdown is a bug.

---

## Interaction with the Runtime and the Scheduler

### Goroutines parked in syscalls don't see cancellation

If a goroutine is blocked in `read(2)` on a TCP socket, calling `cancel()` on its context does nothing — the syscall keeps blocking. The fix is at the layer that owns the socket: `conn.SetReadDeadline(time.Now())` aborts the read.

The pattern: every owning struct that holds a connection also has a way to interrupt the I/O:

```go
type Worker struct {
    conn   net.Conn
    cancel context.CancelFunc
}

func (w *Worker) Close() error {
    w.cancel()
    w.conn.SetReadDeadline(time.Now()) // wake the read goroutine
    w.conn.SetWriteDeadline(time.Now())
    return w.conn.Close()
}
```

The same applies to `database/sql` (uses context internally), file I/O on Linux (`O_NONBLOCK` if available), and any custom syscall code (use `syscall.Pipe2` self-pipe trick).

### `runtime.LockOSThread` and shutdown

A goroutine that calls `runtime.LockOSThread()` and never unlocks pins an OS thread for life. When the goroutine exits, the thread is destroyed. This is fine if the goroutine has a clean exit; it is a slow leak (thread + thread-local storage) if the goroutine is immortal.

`LockOSThread` is rare in application code (mostly used by cgo bridges, Wayland/Cocoa wrappers, OS-specific I/O). When you see it, double-check the exit path.

### `runtime.SetFinalizer` is not for goroutine cleanup

```go
runtime.SetFinalizer(c, func(c *Component) { c.Close() }) // BAD
```

Finalizers run when the GC decides, not when the program needs cleanup. By the time the finalizer fires, the program may be shutting down or have already moved on. Use explicit `Close`. Finalizers are for cleanup of unreachable resources where missing them is acceptable (e.g., a file descriptor in a forgotten temp file), not for goroutines that hold meaningful state.

---

## Building a Concurrency Style Guide

A platform team's deliverable is a style guide. The guide is short, opinionated, and enforced.

### Suggested contents

1. **Spawn rules**: where `go` is allowed (lifecycle, pool, worker packages) and where it is not.
2. **Context rules**: always first arg, named `ctx`, never stored as parameter, always inherited.
3. **Channel rules**: closer is the unique sender; buffers documented; no `close` of received channel.
4. **Mutex rules**: short critical sections; no I/O inside; `defer Unlock` on the next line; `RWMutex` only when justified.
5. **Test rules**: `goleak.VerifyTestMain` in every package; cancellation tests for every long-running component.
6. **Library design rules**: every spawn-in-constructor returns a `Close`; documented in the type comment.
7. **Anti-patterns list**: with code samples and rationales for each ban.

The guide is 5–10 pages, linked from the company wiki, and updated when a new pattern emerges from incidents.

### Enforcement

The guide alone is not enforcement. Enforcement is:

- Linters (the custom ones above).
- CI blocks (goleak required, race detector required).
- Code review: every PR with concurrent code has a `concurrency-review` label and a member of the concurrency team is required.
- Onboarding: every new engineer reads the guide before their first concurrent PR.

### Living document

Every incident postmortem that involves a leak ends with: "does this incident require a change to the concurrency style guide?" If yes, the guide is updated and the linter is extended. Over years, the guide becomes the institutional memory of every leak the organisation has ever suffered.

---

## Self-Assessment

- [ ] You can design a `lifecycle.Manager` package and explain its trade-offs vs. fx/wire.
- [ ] You can build a custom `go/analysis` linter that flags `go` statements outside approved packages.
- [ ] You know how to wake a goroutine blocked in a syscall (`SetDeadline`, self-pipe).
- [ ] You can set up cancellation-latency tests as a default in your service template.
- [ ] You have written or could write a concurrency style guide for a 50-engineer organisation.
- [ ] You can explain why finalizers are unsuitable for goroutine cleanup.

---

## Summary

At professional level, leak prevention is a platform: shared libraries, linters, CI gates, and a style guide enforced by review. The individual patterns are the same as at senior level; the difference is scale.

- A `lifecycle.Manager` provides every service the same start/stop discipline.
- A concurrency wrapper (`concurrency.Go`) gives fleet-wide goroutine visibility.
- Custom linters catch the wrong shape at compile time.
- Cancellation-latency tests in CI catch regressions per PR.
- A style guide encodes the lessons of past incidents.

The work is unglamorous and pays off slowly. But after two years of investment, leaks become incidents that the platform team writes a postmortem about — not the daily reality every team copes with.

See [04-pprof-tools](../04-pprof-tools/) for the diagnostic tooling that complements this prevention layer, and [02-detecting-leaks](../02-detecting-leaks/) for the runtime side of the same problem.
