---
layout: default
title: Senior
parent: Cooperative vs Forced
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/01-cooperative-vs-force/senior/
---

# Cooperative vs Forced Cancellation — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Architectural Principles](#architectural-principles)
3. [Designing Cancellable Subsystems](#designing-cancellable-subsystems)
4. [Bounding Work: Budgets, Deadlines, and Quotas](#bounding-work-budgets-deadlines-and-quotas)
5. [Forced Cancellation Mechanisms](#forced-cancellation-mechanisms)
6. [`runtime.LockOSThread` and Signal-Based Stops](#runtime-lockosthread-and-signal-based-stops)
7. [CGO Cancellation Pitfalls](#cgo-cancellation-pitfalls)
8. [Cancellation in External Process Boundaries](#cancellation-in-external-process-boundaries)
9. [Structured Concurrency in Go](#structured-concurrency-in-go)
10. [Cancellation in Streaming Systems](#cancellation-in-streaming-systems)
11. [Graceful Shutdown Architectures](#graceful-shutdown-architectures)
12. [Multi-Cancellation: Merge, Choose, Compose](#multi-cancellation-merge-choose-compose)
13. [Cancellation and the Memory Model](#cancellation-and-the-memory-model)
14. [Designing for Failure Modes](#designing-for-failure-modes)
15. [Observability and Diagnostics](#observability-and-diagnostics)
16. [Anti-Patterns at Scale](#anti-patterns-at-scale)
17. [Case Studies](#case-studies)
18. [Decision Framework](#decision-framework)
19. [Summary](#summary)

---

## Introduction

At senior level the question shifts from "how do I cancel one goroutine?" to "how do I design a system whose cancellation behaviour is correct, bounded, and observable?" Cancellation is no longer a local detail; it is a property of the architecture.

This file covers:

- The architectural principles that make cancellation tractable
- How to bound work explicitly with budgets, deadlines, and quotas
- The mechanisms behind forced cancellation: `runtime.LockOSThread`, signal-based stops, and the kernel boundary
- CGO and the limits of cooperation
- External-process cancellation patterns
- The "structured concurrency" idea applied in Go
- Graceful shutdown architectures for production services
- Diagnostics for cancellation failures

Prerequisites: junior and middle files in this section, plus comfort with `errgroup`, channels, `select`, and the basic shape of the GMP scheduler.

---

## Architectural Principles

### Principle 1: Every long-lived component owns a context

Long-lived components — services, workers, schedulers — should each carry a context that represents *their* lifetime. Their lifetime is the scope within which they may run goroutines. Cancelling the context terminates the component cleanly.

```go
type Service struct {
    ctx    context.Context
    cancel context.CancelFunc
    wg     sync.WaitGroup
}

func NewService(parent context.Context) *Service {
    ctx, cancel := context.WithCancel(parent)
    return &Service{ctx: ctx, cancel: cancel}
}

func (s *Service) Spawn(f func(context.Context)) {
    s.wg.Add(1)
    go func() {
        defer s.wg.Done()
        f(s.ctx)
    }()
}

func (s *Service) Stop() {
    s.cancel()
    s.wg.Wait()
}
```

Every goroutine spawned through `Spawn` observes `s.ctx`. `Stop` cancels and waits. The component's *cancellation domain* is well-defined.

### Principle 2: Cancellation is downward, completion is upward

Signals (cancel) flow from parent to children. Completion (errors, results) flows from children to parent. The shapes are opposite:

```
cancel:           result:
  parent            children
   |                   |
   v                   v
 children           parent
```

This is enforced by `errgroup`: workers return errors upward; the group cancels its context downward. It is the structural invariant.

### Principle 3: Cooperation is the rule; force is the exception

In production code, well over 95% of cancellation should be cooperative. Forced cancellation is reserved for unrecoverable cases: a hung CGO call, a deadline exceeded after a graceful budget. Forced cancellation must be *visible* — logged, alerted, surfaced — because it indicates a bug elsewhere.

### Principle 4: Cancellation has a budget

Every cancellation has two budgets:

1. **Notice budget** — the time between calling `cancel()` and the last goroutine observing it. Bounded by your polling frequency.
2. **Drain budget** — the time the system gives in-flight work to finish gracefully. Set per system, often 10–30 seconds.

When the drain budget expires, escalate to force (close handles, kill the process).

### Principle 5: Cancellation paths are tested, not assumed

Every cancellable component should have a test that proves cancellation works. Add `goleak` to every test. Without active proof, cancellation paths bit-rot.

---

## Designing Cancellable Subsystems

### Subsystem template

```go
type Subsystem struct {
    name   string
    ctx    context.Context
    cancel context.CancelFunc
    wg     sync.WaitGroup
    log    *slog.Logger
}

func NewSubsystem(parent context.Context, name string, log *slog.Logger) *Subsystem {
    ctx, cancel := context.WithCancel(parent)
    return &Subsystem{name: name, ctx: ctx, cancel: cancel, log: log}
}

func (s *Subsystem) Run(f func(context.Context) error) {
    s.wg.Add(1)
    go func() {
        defer s.wg.Done()
        if err := f(s.ctx); err != nil && !errors.Is(err, context.Canceled) {
            s.log.Error("subsystem worker exited with error", "subsystem", s.name, "err", err)
            s.cancel() // one worker failing cancels the rest
        }
    }()
}

func (s *Subsystem) Stop(graceCtx context.Context) error {
    s.cancel()
    done := make(chan struct{})
    go func() { s.wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-graceCtx.Done():
        return fmt.Errorf("subsystem %q did not stop within grace period: %w", s.name, graceCtx.Err())
    }
}
```

Properties:

- One context per subsystem
- Worker errors cancel siblings
- `Stop` takes its own context for the grace budget
- Errors are logged at the boundary, not propagated upward (the parent can choose its own escalation)

### Component composition

```go
type App struct {
    subs []*Subsystem
}

func (a *App) Start(parent context.Context) {
    a.subs = append(a.subs,
        NewSubsystem(parent, "ingestor", log),
        NewSubsystem(parent, "processor", log),
        NewSubsystem(parent, "writer", log),
    )
    for _, s := range a.subs {
        s.Run(s.workFunc())
    }
}

func (a *App) Stop(grace time.Duration) error {
    ctx, cancel := context.WithTimeout(context.Background(), grace)
    defer cancel()
    var firstErr error
    for _, s := range a.subs {
        if err := s.Stop(ctx); err != nil && firstErr == nil {
            firstErr = err
        }
    }
    return firstErr
}
```

Each subsystem has its own grace budget. The app's `Stop` walks them in order. You can reverse the order, parallelise, or split into "stop accepting" / "drain" phases as needed.

### One context vs many

Sometimes you want different parts of a subsystem to have different lifetimes:

- **Ingress** stops accepting new work on `SIGTERM`.
- **Processing** continues until the queue is drained.
- **Egress** continues until processing has flushed everything.

Express this as a chain of contexts:

```go
ingressCtx, cancelIngress := context.WithCancel(parent)
processingCtx, cancelProcessing := context.WithCancel(parent)
egressCtx, cancelEgress := context.WithCancel(parent)

// On SIGTERM:
cancelIngress()           // stop accepting
waitForQueueDrain()
cancelProcessing()        // stop processing
waitForFlush()
cancelEgress()            // stop writing
```

This is sometimes called a "phased shutdown" and corresponds to the `Shutdown` pattern in `http.Server`.

---

## Bounding Work: Budgets, Deadlines, and Quotas

### Per-request budgets

Every external-facing operation should have a *total time budget*, propagated via context:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
    defer cancel()
    // all work uses ctx
}
```

The budget is yours to allocate. Sub-operations get sub-budgets:

```go
dbCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
defer cancel()
user, _ := db.LoadUser(dbCtx, id)

apiCtx, cancel := context.WithTimeout(ctx, 1*time.Second)
defer cancel()
avatar, _ := api.FetchAvatar(apiCtx, user.URL)
```

The DB call gets 500 ms; the API call gets 1 s. If the DB takes 600 ms, it fails (deadline exceeded). The parent context has 2 seconds in total; if both sub-operations succeed quickly, time is left for the response.

### Deadlines vs timeouts

- **Timeout**: relative — "this call may take up to 500 ms."
- **Deadline**: absolute — "this call must finish by 14:30:01.500."

Use deadlines when propagating across boundaries. `context.WithDeadline(parent, t)` will cancel at `t` regardless of how the parent's clock has moved.

### Quotas: bounding concurrency

A budget controls *time*. A quota controls *concurrency*:

```go
sem := make(chan struct{}, 100) // max 100 concurrent

func handle(ctx context.Context) error {
    select {
    case sem <- struct{}{}:
        defer func() { <-sem }()
    case <-ctx.Done():
        return ctx.Err()
    }
    return doWork(ctx)
}
```

Cancellable acquire: if the context expires before a slot is available, the caller bails out with `ctx.Err()`. Without this, requests pile up waiting for a slot.

### Bulkheads

Different operations get different quotas:

```go
var (
    semDB  = make(chan struct{}, 50)
    semAPI = make(chan struct{}, 20)
    semCPU = make(chan struct{}, runtime.GOMAXPROCS(0))
)
```

A surge in API calls cannot starve DB calls. Cancellation respects bulkhead boundaries because each operation's acquire is independently cancellable.

### Token-bucket rate limits with cancellation

```go
import "golang.org/x/time/rate"

limiter := rate.NewLimiter(rate.Every(100*time.Millisecond), 5)
if err := limiter.Wait(ctx); err != nil {
    return err // ctx.Err() if cancelled
}
```

`Wait(ctx)` respects context: if cancelled while waiting, returns `ctx.Err()`. This is the right pattern for any rate-limited path.

---

## Forced Cancellation Mechanisms

The Go language deliberately offers no "kill a goroutine" API. The forced-cancellation options available are all at higher levels:

### 1. `os.Exit(code)`

```go
os.Exit(1)
```

Terminates the process immediately. **Deferred functions do not run.** All goroutines die instantly. Use as last resort — after a grace period, after logging, after flushing.

### 2. `runtime.Goexit()`

```go
runtime.Goexit()
```

Terminates the *current* goroutine. Deferred functions run. This is *self*-cancellation; you cannot call it on another goroutine.

### 3. `panic(...)` without recovery

Kills the entire process if not recovered. Same effect as `os.Exit` for forced shutdown, with the added cost of a stack dump.

### 4. Closing the underlying resource

Not "forced" in the strict sense, but the practical escape for stuck syscalls:

```go
conn.Close() // unblocks any in-flight Read/Write with an error
```

The goroutine then exits cooperatively when its blocked syscall returns an error.

### 5. Killing a child process

For work in a subprocess (cgo wrapped, or genuinely external):

```go
cmd := exec.CommandContext(ctx, "subprocess")
// ctx cancellation kills the child
```

`CommandContext` sends a kill signal (default `SIGKILL` on Unix) when the context cancels. The Go side resumes when the subprocess exits.

### 6. OS-level signals to your own process

```go
process, _ := os.FindProcess(os.Getpid())
process.Signal(syscall.SIGTERM)
```

You can signal your own process. Useful to trigger your signal handler from within. Most commonly, the kernel signals you (kubelet sends SIGTERM, user hits Ctrl-C).

### What you cannot do

- Send a signal to a specific goroutine.
- Interrupt a function mid-execution from another goroutine.
- Force a `defer` to run in a goroutine you don't control.
- Kill a CGO call from Go.

The cooperative model holds because the language refuses to violate it.

---

## `runtime.LockOSThread` and Signal-Based Stops

### What `LockOSThread` does

```go
runtime.LockOSThread()
defer runtime.UnlockOSThread()
```

Pins the calling goroutine to the *current* OS thread (M). The goroutine will execute *only* on that M, and no other goroutine will execute on it, until `UnlockOSThread` has been called as many times as `LockOSThread`.

Why this matters for cancellation:

- **Thread-local OS state**: certain OS APIs (OpenGL, some POSIX TLS implementations, X11) require thread affinity. If you call them from a goroutine that may be migrated, state is corrupted.
- **Signal delivery**: OS signals can be directed to specific threads via `pthread_kill`. A locked goroutine can be the deliberate target of such a signal.
- **CGO interactions**: cgo calls that establish thread-local state must be re-entered from the same OS thread.

### Signal-based "forced" cancellation pattern

Suppose you have a goroutine running a long CGO call that you wish to interrupt. The pattern (rare, advanced, with caveats):

```go
func cgoWithCancel(ctx context.Context) error {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()

    tid := syscall.Gettid() // Linux: get the kernel thread ID

    done := make(chan struct{})
    go func() {
        select {
        case <-ctx.Done():
            // ask the OS to interrupt the syscall on `tid`
            syscall.Tgkill(syscall.Getpid(), tid, syscall.SIGUSR1)
        case <-done:
        }
    }()
    defer close(done)

    // CGO call here; the C code must install a SIGUSR1 handler that
    // sets a flag the C loop checks, or arranges to long-jump out.
    err := C.long_running_thing()
    return ctxErrIfCancelled(ctx, err)
}
```

This is *not* idiomatic Go. It works only if:

- The C code is signal-safe and observes the flag.
- You install the signal handler globally; Go's runtime must tolerate it.
- The CGO library is willing to be interrupted.

Use only when you control the C code. Otherwise, prefer subprocess isolation.

### `signal.Notify` and `signal.NotifyContext`

For *process-level* signals (`SIGINT`, `SIGTERM`):

```go
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()
```

`signal.NotifyContext` (Go 1.16+) returns a context that cancels on the named signals. This is the idiomatic shutdown signal handler.

```go
func main() {
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    srv := newServer()
    go srv.Run(ctx)

    <-ctx.Done()

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    if err := srv.Shutdown(shutdownCtx); err != nil {
        log.Error("shutdown error", err)
        os.Exit(1)
    }
}
```

This is the canonical shutdown shape: signal cancels root context; server uses it for cooperative stop; `Shutdown` has its own grace budget; `os.Exit(1)` if grace expires.

### `signal.Reset` and `signal.Ignore`

For finer control:

```go
signal.Ignore(syscall.SIGHUP)             // ignore HUP
signal.Reset(syscall.SIGTERM)             // restore default (terminate)
```

Rarely needed. Default behaviour is correct for most services.

---

## CGO Cancellation Pitfalls

### Pitfall 1: cgo holds the M

When a goroutine calls into C, the runtime locks the M (OS thread) until C returns. The goroutine cannot be preempted, cannot be migrated, and cannot observe cancellation. The M is consumed.

If many goroutines simultaneously call long C functions, GOMAXPROCS Ms can all be stuck in C. New goroutines wait. New Ms are spawned (up to `GODEBUG=cgomaxprocs`, but typically up to ~10000 — the runtime gets pathological well before that). Cancellation does not reach any of them.

### Pitfall 2: cgo and stack growth

C uses the OS thread's stack, not Go's growable stack. A C call into a deep recursion can overflow the thread stack and segfault. The Go cgo wrapper allocates an "extra" stack, but the limit is fixed at thread creation. Cancellation cannot save you from a stack overflow inside C.

### Pitfall 3: cgo and locks

If C code grabs a Go-side mutex (via callbacks), the goroutine is in C while holding Go state. Cancellation cannot interrupt; you risk deadlock if cancellation logic needs the same lock.

### Pitfall 4: cgo and signals

Go installs its own signal handlers. C libraries that also install signal handlers can race. Mixing async-preempt signals (Go 1.14+) with C signal handlers is fragile. Some C libraries (`libcurl`, certain crypto code) need careful integration.

### Mitigations

1. **Keep cgo calls short.** Decompose a long C job into many short C calls; check context between them on the Go side.
2. **Isolate long cgo work in a subprocess.** Use `exec.CommandContext`. Cancellation kills the subprocess; the Go side waits for it via OS-level wait.
3. **Install a cancellation flag on the C side.** If you control the C code, expose a `volatile sig_atomic_t cancel_flag` that the C loop polls. Set it from Go (via a `C.set_cancel_flag(1)` call from another goroutine that is *not* locked in C).
4. **Use `runtime.LockOSThread` + signals only as a last resort.** Document the design.

### CGO + cancellation: a worked example

```go
/*
#include <stdint.h>
#include <stdatomic.h>

static atomic_int cancel_flag = 0;

void set_cancel_flag(int v) { atomic_store(&cancel_flag, v); }

int long_work(int n) {
    for (int i = 0; i < n; i++) {
        if (atomic_load(&cancel_flag) != 0) return -1;
        // ... real work ...
    }
    return 0;
}
*/
import "C"

func runLongWork(ctx context.Context, n int) error {
    stop := make(chan struct{})
    go func() {
        select {
        case <-ctx.Done():
            C.set_cancel_flag(1)
        case <-stop:
        }
    }()
    defer close(stop)
    defer C.set_cancel_flag(0)

    res := C.long_work(C.int(n))
    if res == -1 {
        return ctx.Err()
    }
    return nil
}
```

The C code polls a shared flag. The Go side flips the flag on cancellation. The C function returns with an error code, which Go translates. This is cooperative cancellation extended across the cgo boundary — only possible because we control the C side.

---

## Cancellation in External Process Boundaries

### Cancelling subprocesses

```go
cmd := exec.CommandContext(ctx, "ffmpeg", "-i", "input.mp4", "output.mkv")
err := cmd.Run()
```

When `ctx` cancels, `cmd` gets `SIGKILL` (default). On Go 1.20+, you can customise:

```go
cmd.Cancel = func() error {
    return cmd.Process.Signal(syscall.SIGTERM) // graceful first
}
cmd.WaitDelay = 5 * time.Second // then escalate to kill after 5s
```

The pattern: graceful first, force after a grace period. This matches the cooperative-then-force philosophy.

### Cancelling network calls

```go
req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
resp, err := http.DefaultClient.Do(req)
```

`http.Client` honours the context. On cancellation, it closes the underlying connection, which causes any in-flight read to fail with an error. The goroutine doing the request returns with `ctx.Err()`.

### Cancelling DB queries

```go
rows, err := db.QueryContext(ctx, "SELECT ...")
```

Most drivers honour the context. Some (notably MySQL) send a `KILL QUERY` to the server; PostgreSQL sends `CancelRequest`. The server then aborts the query. The Go side returns when the connection unblocks.

Note: server-side cancellation is best-effort. If the query has produced side effects, those persist. Treat cancellation paths as "the operation might have happened."

### Cancelling gRPC calls

```go
import "google.golang.org/grpc"

resp, err := client.Method(ctx, req)
```

gRPC propagates the context as a deadline metadata header (`grpc-timeout`). Server-side handlers observe `ctx.Done()` and bail out. This is one of the cleanest cancellation stories in distributed Go.

### Cancelling queue consumers

A consumer reading from a queue (Kafka, NATS, RabbitMQ) should accept a context. On cancel:

```go
for {
    msg, err := consumer.FetchMessage(ctx)
    if err != nil {
        if errors.Is(err, context.Canceled) {
            return // graceful exit
        }
        return err
    }
    if err := process(ctx, msg); err != nil {
        return err
    }
    if err := consumer.CommitMessages(ctx, msg); err != nil {
        return err
    }
}
```

The Fetch is cancellable; the Commit too. The consumer must commit the last successfully processed message before exiting; otherwise the next instance will re-process.

---

## Structured Concurrency in Go

### What "structured concurrency" means

The principle: a goroutine should not outlive its lexical parent. If function `f` spawns goroutines, all of them must have exited (or been adopted) before `f` returns.

Go does not enforce this; it is a discipline. But `errgroup` is the de facto structured-concurrency primitive:

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return workerA(ctx) })
g.Go(func() error { return workerB(ctx) })
return g.Wait() // none of the spawned goroutines outlive this call
```

When `g.Wait()` returns, both workers have exited. If either returned an error, `ctx` was cancelled and both saw it.

### Why this matters

Unstructured concurrency leads to:

- Goroutines that outlive their caller's frame, holding stale references
- Errors swallowed silently because no one is waiting
- Cancellation impossible to reason about
- Test flakes when a goroutine from a previous test continues into the next

Structured concurrency:

- Errors propagate up
- Cancellation propagates down
- Lifetimes match lexical scope
- Tests are deterministic

### `errgroup` patterns

```go
g, ctx := errgroup.WithContext(parent)
sem := make(chan struct{}, 8) // bound concurrency

for _, item := range items {
    item := item
    g.Go(func() error {
        select {
        case sem <- struct{}{}:
            defer func() { <-sem }()
        case <-ctx.Done():
            return ctx.Err()
        }
        return process(ctx, item)
    })
}

return g.Wait()
```

Bounded fan-out: at most 8 workers, all observing `ctx`. One error cancels the rest. The function returns only when every spawned goroutine has finished.

### `errgroup.Group.SetLimit`

Go 1.20+ adds `g.SetLimit(n)`. The same as the semaphore above, but built in:

```go
g, ctx := errgroup.WithContext(parent)
g.SetLimit(8)
for _, item := range items {
    item := item
    g.Go(func() error { return process(ctx, item) })
}
return g.Wait()
```

Cleaner. Prefer this when you don't need fine-grained acquire semantics.

### `sync/v2.WaitGroup.Go` (proposal)

Recent proposals add structured-concurrency helpers to the standard library. As of Go 1.22, `errgroup` is still the standard tool. Watch the release notes.

### Limits of structured concurrency

The discipline breaks when:

- You want a goroutine to outlive the function (e.g. background work fire-and-forget).
- The work is event-driven and may run indefinitely.
- You are wrapping a third-party API that spawns its own goroutines.

In those cases, accept that you are outside structured concurrency and add explicit lifetime management: the component owns the context, the caller calls `Stop`.

---

## Cancellation in Streaming Systems

### A streaming pipeline

```go
func pipeline(ctx context.Context, src <-chan In) <-chan Out {
    out := make(chan Out)
    go func() {
        defer close(out)
        for in := range src {
            select {
            case <-ctx.Done():
                return
            case out <- transform(in):
            }
        }
    }()
    return out
}
```

Two cancellation points: read (range over `src`) and write (`out <- ...`). If `src` closes, we exit the range. If `ctx` cancels, we exit at the next write. Both paths close `out`, which signals end-of-stream downstream.

### Drain-on-cancel

When `ctx` cancels mid-stream, what about the items still in `src`? Three policies:

1. **Drop**: just return; items in `src` are lost.
2. **Drain**: read remaining items but do not emit them (e.g., send them to a dead-letter queue).
3. **Best-effort emit**: keep trying to forward but with a tighter deadline.

The choice depends on the system. Streaming analytics may prefer "drop and ack the cancel"; payment processing may prefer "drain to disk." Make the policy explicit, document it.

### Back-pressure and cancellation

If the consumer is slow, the pipeline back-pressures (blocks on `out <- ...`). Cancellation must reach this blocked send. The pattern shown above does that: the `select` includes `<-ctx.Done()`.

If you forget the cancellable send, your pipeline hangs on shutdown even after `ctx` cancels.

### Buffered pipelines

```go
out := make(chan Out, 100)
```

Buffering reduces back-pressure latency but adds drain complexity: when `ctx` cancels, the buffer contains 100 in-flight items. Are they lost? Drained? The choice depends on the system.

### Cancellation across many stages

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()

stage1 := stage(ctx, source)
stage2 := stage(ctx, stage1)
stage3 := stage(ctx, stage2)

for r := range stage3 {
    sink(r)
}
```

All stages observe the same `ctx`. Cancellation propagates instantly to all of them. Each stage closes its output, which terminates the next stage's range. The downstream consumer sees end-of-stream and exits.

---

## Graceful Shutdown Architectures

### The four phases

A robust shutdown has four phases:

1. **Signal received** (e.g., SIGTERM).
2. **Refuse new work**: stop accepting connections, stop polling queues.
3. **Drain in-flight**: let active operations finish within a grace budget.
4. **Force**: if grace expires, kill remaining work.

```go
func runWithShutdown(parent context.Context) error {
    ctx, stop := signal.NotifyContext(parent, syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    srv := newServer()
    srvErr := make(chan error, 1)
    go func() { srvErr <- srv.ListenAndServe() }()

    select {
    case err := <-srvErr:
        return err
    case <-ctx.Done():
        log.Info("shutdown signal received")
    }

    // Phase 2 & 3: graceful Shutdown drains in-flight requests
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    err := srv.Shutdown(shutdownCtx)

    // Phase 4: force if grace expired
    if errors.Is(err, context.DeadlineExceeded) {
        log.Error("graceful shutdown timed out; forcing close")
        _ = srv.Close()
    }
    return err
}
```

`Shutdown` is cooperative; `Close` is force. Together they cover the grace + escalation pattern.

### Kubernetes integration

Kubernetes sends `SIGTERM` and waits `terminationGracePeriodSeconds` (default 30). Then `SIGKILL`. Your graceful shutdown budget should be *less* than this so you have time to log the failure before the kernel takes over.

```yaml
# In the pod spec
terminationGracePeriodSeconds: 60
# Your service uses, say, 50-second graceful budget, leaving 10s slack
```

### `lameduck` mode

Some services advertise themselves to a load balancer. Graceful shutdown should *first* deregister so new requests stop arriving, *then* drain:

```go
func gracefulStop() error {
    deregisterFromLB()                  // step 1
    time.Sleep(5 * time.Second)         // let LB notice
    return srv.Shutdown(shutdownCtx)    // step 2: drain
}
```

The sleep is the LB's update interval; tune to your LB.

### Database connection drain

```go
defer db.Close() // waits for in-flight queries to finish, up to MaxConnIdleTime
```

`*sql.DB.Close()` is cooperative: it stops accepting new queries and waits for active ones. If you want a time-bounded close, wrap it manually:

```go
done := make(chan struct{})
go func() { db.Close(); close(done) }()
select {
case <-done:
case <-time.After(10 * time.Second):
    log.Warn("db.Close did not finish in 10s")
}
```

### Worker pool drain

```go
func (p *Pool) Shutdown(ctx context.Context) error {
    close(p.jobs) // no more work accepted
    done := make(chan struct{})
    go func() { p.wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Close `jobs` to stop accepting; wait for workers to finish; honour the shutdown context for the grace budget.

---

## Multi-Cancellation: Merge, Choose, Compose

### Merging two contexts

You want a context that cancels when *either* of two parents cancels. The standard library does not provide this directly (until you write it). One implementation:

```go
func mergeCtx(a, b context.Context) (context.Context, context.CancelFunc) {
    ctx, cancel := context.WithCancel(a)
    stop := make(chan struct{})
    go func() {
        select {
        case <-a.Done():
        case <-b.Done():
            cancel()
        case <-stop:
        }
    }()
    return ctx, func() {
        close(stop)
        cancel()
    }
}
```

Use case: a request context (from HTTP) and a service context (from the service). Either cancel terminates the work.

### Race two contexts to a result

```go
func raceCtx(a, b context.Context, work func(context.Context) (R, error)) (R, error) {
    type result struct {
        r   R
        err error
    }
    out := make(chan result, 1)
    cctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    go func() {
        r, err := work(cctx)
        out <- result{r, err}
    }()

    select {
    case r := <-out:
        return r.r, r.err
    case <-a.Done():
        cancel()
        return zero, a.Err()
    case <-b.Done():
        cancel()
        return zero, b.Err()
    }
}
```

The work observes `cctx`; cancelling it stops the work. We exit on the first cancellation.

### Compose deadline + cancel + value

```go
ctx := parent
ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()
ctx = context.WithValue(ctx, requestIDKey, reqID)
```

Each step layers a property. The order matters for performance (deeper trees are slower to traverse) but not correctness.

### `context.WithoutCancel`

Go 1.21+ added `context.WithoutCancel(parent)` — returns a context that has parent's values but no cancellation:

```go
bgctx := context.WithoutCancel(reqCtx)
go logEvent(bgctx, evt) // continues after request ends
```

Cleaner than `context.Background()` because the values (trace IDs, etc.) are preserved.

---

## Cancellation and the Memory Model

### `Done()` close and happens-before

The Go memory model specifies: the `cancel()` call's actions happen-before the *return* of any `<-ctx.Done()`. So when a goroutine observes the closed `Done` channel, it sees all writes that were sequenced before `cancel()`.

This is important: you can cancel and then expect the cancelled goroutine to observe state that you set just before `cancel()`.

```go
state.SetReason("user requested stop")
cancel() // happens-before any Done() observer
```

The worker that reads state after observing `Done()` will see "user requested stop."

### `context.WithCancelCause` and atomic semantics

`cancel(err)` sets the cause atomically with the cancellation. `context.Cause(ctx)` then returns either nil (not yet cancelled) or the cause (cancelled). There is no torn read.

### Avoiding races around the `cancel` call

Multiple goroutines may call `cancel()` on the same context. The implementation is race-free: `cancel()` is idempotent and uses internal synchronisation. You do not need to wrap it in a mutex.

---

## Designing for Failure Modes

### Failure 1: cancellation is observed but cleanup hangs

A worker sees `Done()` and starts cleanup. Cleanup calls a flaky API that hangs. The worker never returns. Shutdown stalls.

Solution: bound cleanup with its own context:

```go
case <-ctx.Done():
    cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    _ = cleanup(cleanupCtx)
    return
```

### Failure 2: cancellation arrives but the worker is wedged

The worker is blocked in a syscall that does not honour context. Cancellation cannot reach it.

Solution: close the underlying resource (`conn.Close()`) from a sibling goroutine that observes the context.

### Failure 3: worker finishes just as cancellation arrives

Cancellation and completion race. The worker successfully completes; cancellation arrives a microsecond later. The caller may see `ctx.Err() != nil` even though the work completed.

Solution: check completion first, then cancellation. Or treat both as valid outcomes.

```go
result, err := work(ctx)
if err == nil {
    return result // success
}
if ctxErr := ctx.Err(); ctxErr != nil {
    return zero, ctxErr // cancellation
}
return zero, err // genuine error
```

### Failure 4: child outlives parent

A goroutine spawns a child with `go work()` but forgets to use the parent's context. The parent returns; the child runs on. The child's writes go nowhere, but the child still consumes resources.

Solution: structured concurrency. Every `go` corresponds to a `wg.Wait` or `g.Wait`. No exceptions.

### Failure 5: cancellation observed but not propagated

A worker observes its parent context and returns. But before returning, it spawned a sub-worker with `context.Background()`. The sub-worker continues, unobservable.

Solution: derive every sub-worker context from the parent. `context.WithCancel(parent)`, not `context.Background()`.

---

## Observability and Diagnostics

### Goroutine count over time

Trend in `runtime.NumGoroutine()` is a leading indicator of cancellation bugs. Spikes correlated with errors mean cancellation is leaking goroutines.

Export to Prometheus:

```go
collector := prometheus.NewGaugeFunc(
    prometheus.GaugeOpts{Name: "go_goroutines_count"},
    func() float64 { return float64(runtime.NumGoroutine()) },
)
prometheus.MustRegister(collector)
```

### `/debug/pprof/goroutine`

Standard library endpoint. Dumps all goroutine stacks. Look for:

- Many goroutines stuck at the same line (a bottleneck).
- Goroutines blocked on `<-ctx.Done()` that should have been returned (cancellation arrived but the goroutine cannot proceed — perhaps holding a lock).
- Goroutines in `chan receive` on channels nobody sends to (classic leak).

```bash
curl http://localhost:6060/debug/pprof/goroutine?debug=2 > stacks.txt
```

### `runtime/trace`

For granular cancellation timing:

```go
trace.Start(os.Stderr)
defer trace.Stop()
```

Then view with `go tool trace`. You can see when each goroutine started, when it observed cancellation, when it exited.

### Custom cancellation tracing

```go
g.Go(func() error {
    log.Info("worker start", "id", id)
    defer log.Info("worker exit", "id", id)
    return work(ctx)
})
```

In tests and staging, log start/exit. In production, sample or disable. Correlated logs reveal cancellation lag.

### Health probe semantics

Kubernetes calls `/healthz` periodically. During graceful shutdown, fail it deliberately so the LB removes you from rotation:

```go
var shuttingDown atomic.Bool

func healthz(w http.ResponseWriter, r *http.Request) {
    if shuttingDown.Load() {
        http.Error(w, "shutting down", http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusOK)
}

func main() {
    // on SIGTERM:
    shuttingDown.Store(true)
    time.Sleep(10 * time.Second) // let LB notice
    server.Shutdown(ctx)
}
```

This is a higher-level cancellation: the *service* is "cancelled" from the cluster's view well before its goroutines stop.

---

## Anti-Patterns at Scale

### Anti-pattern 1: per-request goroutine pools

```go
func handler(...) {
    pool := makePool(16)        // BUG: new pool per request
    pool.Run(ctx, jobs)
    pool.Wait()
}
```

Each request creates and destroys a worker pool. Cancellation works, but the cost is huge. Pools should be long-lived; jobs are submitted via channel.

### Anti-pattern 2: never-cancelled background

```go
func init() {
    go forever() // no way to stop in tests
}
```

`init` goroutines have no cancellation handle. Tests cannot clean up. Refactor to explicit lifecycle: a constructor returns the component; the test cancels it.

### Anti-pattern 3: cancellation through a global

```go
var globalCancel context.CancelFunc

func setupGlobalCtx() {
    _, globalCancel = context.WithCancel(context.Background())
}
```

Hidden mutable global cancellation handles are an anti-pattern. Pass context explicitly.

### Anti-pattern 4: forgetting to cancel children on error

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error {
    if err := step1(ctx); err != nil {
        return err // good: ctx cancels, siblings see it
    }
    return step2(ctx)
})
g.Go(func() error {
    return slowWork(ctx)
})
```

If `step1` errors, `ctx` cancels, `slowWork` sees `Done`, all is well. But if you used `&sync.WaitGroup` instead of `errgroup`, `step1`'s error would not have cancelled `slowWork`. Use `errgroup` for cancel-on-error semantics.

### Anti-pattern 5: cancellation as control flow

```go
if x {
    cancel()
}
work(ctx) // ctx already cancelled
```

Cancellation is for "stop running"; using it for "skip this branch" is confusing. Use a regular `if/else`.

---

## Case Studies

### Case study 1: A queue worker that drained correctly

A team had a Kafka consumer that processed messages. On shutdown, the rule was "finish processing the current batch, commit offsets, exit." Implementation:

```go
type Consumer struct {
    ctx    context.Context
    cancel context.CancelFunc
    wg     sync.WaitGroup
}

func (c *Consumer) Run() {
    c.wg.Add(1)
    defer c.wg.Done()
    for {
        select {
        case <-c.ctx.Done():
            return
        default:
        }
        batch, err := c.fetch(c.ctx)
        if err != nil {
            if errors.Is(err, context.Canceled) {
                return
            }
            log.Error("fetch", err)
            continue
        }
        if err := c.process(c.ctx, batch); err != nil {
            log.Error("process", err)
            continue
        }
        // commit always uses a fresh context: even on shutdown, finish committing
        commitCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        if err := c.commit(commitCtx, batch); err != nil {
            log.Error("commit", err)
        }
        cancel()
    }
}
```

Key: `commit` uses a fresh context so it survives `ctx` cancellation. Without this, you would lose the offsets and reprocess on restart.

### Case study 2: An HTTP server that did not drain

A different team had a chat server. On `SIGTERM`, they called `srv.Shutdown(ctx)` with a 30-second budget. But websocket handlers held the request goroutine forever — they wrote messages from a per-connection buffer and read from the socket. They never checked `r.Context().Done()`.

`Shutdown` returned after 30 seconds with `context.DeadlineExceeded`. The kernel sent `SIGKILL`. All in-flight chats dropped.

Fix: inside the websocket loop, `select` between socket read, message channel, and `<-r.Context().Done()`. On cancel, send a "shutting down" message to the client and return.

Lesson: cooperative cancellation requires every handler to cooperate. A single non-cooperating handler can ruin shutdown.

### Case study 3: The cgo image processor

A service used a C library to decode images. Average call: 50 ms. Worst case: 30 seconds for adversarial inputs. The Go side wrapped each decode in `context.WithTimeout(ctx, 5*time.Second)`. But the cgo call ignored context — the C code looped without checks.

After 5 seconds, the Go context fired, but the cgo call kept running. The Go goroutine could not be unparked because the M was locked in C. The service ran out of Ms; new requests blocked.

Fix: ran the cgo decode in a subprocess (`exec.CommandContext`). `ctx.WithTimeout` → child gets `SIGKILL` → cgo call dies → Go side returns. Slower path, but bounded.

Lesson: cgo + cancellation is fundamentally fragile. Subprocess isolation is the safe pattern.

---

## Decision Framework

### Should this be cooperative or forced?

**Cooperative** if:

- The worker is a goroutine running pure Go code.
- The worker reads from cancellable sources (`net/http`, `database/sql`).
- You control the chunk size and can poll.
- Cancellation latency budget is achievable with polling.

**Forced** (escalate after grace period) if:

- The worker uses cgo with non-cancellable C code.
- The worker blocks on syscalls without honouring deadlines.
- The cooperative path may take longer than your shutdown SLO.
- You are at the *end* of a graceful shutdown that has already exceeded its budget.

### Should I propagate context through this layer?

**Yes** if:

- It can block (any I/O, any channel op).
- It calls something that may block.
- It loops.
- It is part of a request-scoped operation.

**No** if:

- It is pure compute and finishes in microseconds.
- It is package init or a one-shot helper.
- It is genuinely background and uncoupled.

### Should this goroutine be in an `errgroup`?

**Yes** if:

- It runs alongside others for the same logical task.
- An error in one should cancel the others.
- The lexical parent should wait for all to finish.

**No** if:

- It is genuinely independent of siblings.
- It outlives the spawning function deliberately.
- It is a singleton background loop.

### Should this code use `context.WithCancelCause`?

**Yes** if:

- Downstream code benefits from knowing *why* cancellation happened.
- You want richer error reporting.

**No** if:

- The cause is obvious from context.
- You are writing a small private helper.

---

## Summary

At senior level, cancellation becomes an architectural property. Components own contexts; subsystems compose via context trees; structured concurrency (via `errgroup`) keeps lifetimes lexically bounded; signals trigger graceful shutdown; force is the last resort.

The forced-cancellation toolbox in Go is narrow on purpose: `os.Exit`, `panic`, `runtime.Goexit` (self), `process.Signal`, subprocess kill, and resource close. None of them target a single goroutine. The cooperative model is the language's commitment.

The hard problems — cgo cancellation, locked OS threads, signal handlers, drain budgets — all reduce to: design the work so it can be stopped, and have a fallback for when it cannot. Build observability for the latter; you will need it the first time production cancellation breaks.

The professional file goes deeper into the runtime: how preemption interacts with cancellation, why the scheduler cannot force a stop, the precise signal mechanism behind async preemption, and the implementation of `context` itself.
