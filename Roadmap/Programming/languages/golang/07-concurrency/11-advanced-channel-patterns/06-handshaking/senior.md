---
layout: default
title: Handshaking — Senior
parent: Advanced Channel Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/11-advanced-channel-patterns/06-handshaking/senior/
---

# Handshaking — Senior

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [Graceful Shutdown Handshakes](#graceful-shutdown-handshakes)
3. [N-Way Startup Barriers](#n-way-startup-barriers)
4. [Supervisor Trees](#supervisor-trees)
5. [Drain Handshakes](#drain-handshakes)
6. [Promotion and Step-Down Handshakes](#promotion-and-step-down-handshakes)
7. [Deadlock Hazards and How to Spot Them](#deadlock-hazards-and-how-to-spot-them)
8. [Goroutine Leaks from Broken Handshakes](#goroutine-leaks-from-broken-handshakes)
9. [Handshakes Across Process Boundaries](#handshakes-across-process-boundaries)
10. [Testing Handshakes](#testing-handshakes)
11. [Mental Models](#mental-models)
12. [Use Cases](#use-cases)
13. [Coding Patterns](#coding-patterns)
14. [Common Mistakes at Senior Level](#common-mistakes-at-senior-level)
15. [Tricky Points](#tricky-points)
16. [Self-Assessment Checklist](#self-assessment-checklist)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction

> Focus: "I need to shut down a service with thirty-seven goroutines spread across five packages without losing in-flight work or panicking on a closed channel. How do I design that?"

At senior level you stop writing handshakes one-off and start designing *lifecycle protocols* for whole services. The questions shift:

- What does the operator see when this service is in mid-shutdown?
- If component A's stop handshake takes 30 seconds, can component B's still finish in its budget?
- When a child goroutine panics, who notices? How does the supervisor decide whether to restart or escalate?
- How do I write a test that proves shutdown is graceful — not just that it eventually completes?

These questions are not about channels per se. They are about *system design under cancellation*. Channels are still the mechanism, but the discipline is around composition: a service is a tree of components, each with a stop/started/drained handshake, and shutdown is a coordinated traversal of that tree.

By the end of this page you will be able to:

- Design a multi-component shutdown that respects per-component budgets.
- Build an N-way startup barrier with error reporting and a global deadline.
- Sketch a supervisor that watches N children, propagates failures, and restarts where appropriate.
- Recognise and prevent the four classes of deadlock that arise in handshake protocols.
- Use the goroutine dump as a debugging tool for a handshake-related hang.

What is still ahead in [Professional](professional.md): production observability, real-world systems integration, leader election with promotion ack at the cluster level.

---

## Graceful Shutdown Handshakes

A "graceful shutdown" in a service has four guarantees:

1. No new requests are accepted after shutdown begins.
2. All in-flight requests complete (or time out cleanly).
3. All goroutines have returned before the process exits.
4. All external resources (connections, files, locks) are released.

Channels carry the orchestration; the discipline is in the order.

### The four-phase shutdown

```go
type App struct {
    listener    net.Listener
    srv         *http.Server
    workers     *WorkerPool
    db          *sql.DB
    shutdownCh  chan struct{}
    doneCh      chan struct{}
}

func (a *App) Shutdown(ctx context.Context) error {
    select {
    case <-a.shutdownCh:
        // already shutting down; wait for completion
        <-a.doneCh
        return nil
    default:
    }
    close(a.shutdownCh)
    defer close(a.doneCh)

    // Phase 1: stop accepting new work
    a.listener.Close()
    if err := a.srv.Shutdown(ctx); err != nil {
        return fmt.Errorf("http shutdown: %w", err)
    }

    // Phase 2: drain in-flight work in the worker pool
    if err := a.workers.Drain(ctx); err != nil {
        return fmt.Errorf("worker drain: %w", err)
    }

    // Phase 3: close downstream resources
    if err := a.db.Close(); err != nil {
        return fmt.Errorf("db close: %w", err)
    }

    return nil
}
```

The phases are ordered. Listener first (stop accepting), HTTP server (drain in-flight handlers), worker pool (drain queued work), database (release pool connections). Reverse this order and you risk closing the database before the handlers finish writing.

### Budgets per phase

Top-level `ctx` carries the global deadline (often 30 seconds, set by Kubernetes' `terminationGracePeriodSeconds`). Subdivide it:

```go
httpCtx, httpCancel := context.WithTimeout(ctx, 10*time.Second)
defer httpCancel()
if err := a.srv.Shutdown(httpCtx); err != nil { ... }

workerCtx, workerCancel := context.WithTimeout(ctx, 15*time.Second)
defer workerCancel()
if err := a.workers.Drain(workerCtx); err != nil { ... }

dbCtx, dbCancel := context.WithTimeout(ctx, 5*time.Second)
defer dbCancel()
if err := a.db.PingContext(dbCtx); err != nil { ... }
```

Sum of sub-budgets ≤ total budget. Each component's handshake completes within its slice or surfaces the error — never silently extends the budget at the expense of the next phase.

### Idempotent shutdown

`Shutdown` may be called twice (signal handler races; multiple callers). Make it idempotent with a `shutdownCh` and a `doneCh` as in the example: first call performs work, subsequent calls block on `doneCh`.

A common alternative is `sync.Once`:

```go
func (a *App) Shutdown(ctx context.Context) error {
    a.once.Do(func() { a.runShutdown(ctx) })
    return a.err
}
```

`sync.Once` is simpler but does not let a second caller wait for the first's completion. The channel form is what you want for production.

---

## N-Way Startup Barriers

The startup version of the shutdown handshake: launch N goroutines, wait until *all* have reported ready, then proceed.

### Implementation A: a `sync.WaitGroup`

```go
var wg sync.WaitGroup
errs := make(chan error, N)

for i := 0; i < N; i++ {
    wg.Add(1)
    go func(id int) {
        defer wg.Done()
        if err := initialise(id); err != nil {
            errs <- fmt.Errorf("child %d: %w", id, err)
            return
        }
        runMainLoop(id)
    }(i)
}
```

Wait for all to *complete* — not what we want. `wg.Done()` fires only when the main loop returns. For startup, you need each goroutine to signal *separately* that init has finished.

### Implementation B: per-child started channels

```go
type Child struct {
    Started chan error // nil = ready, non-nil = init failure
}

children := make([]*Child, N)
for i := range children {
    children[i] = &Child{Started: make(chan error, 1)}
    go run(i, children[i])
}

ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()

for i, c := range children {
    select {
    case err := <-c.Started:
        if err != nil {
            return fmt.Errorf("child %d: %w", i, err)
        }
    case <-ctx.Done():
        return fmt.Errorf("child %d: %w", i, ctx.Err())
    }
}
```

Each child has its own started channel. The coordinator iterates over them with a single global deadline. If any one fails or times out, an error is surfaced — and the surviving children still need to be stopped, which the caller must handle.

### Implementation C: a single barrier channel

```go
ready := make(chan struct{}, N)
errs := make(chan error, N)

for i := 0; i < N; i++ {
    go func(id int) {
        if err := initialise(id); err != nil {
            errs <- fmt.Errorf("child %d: %w", id, err)
            return
        }
        ready <- struct{}{}
        runMainLoop(id)
    }(i)
}

for i := 0; i < N; i++ {
    select {
    case <-ready:
    case err := <-errs:
        return err
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Cleaner for the common case. The downside is no per-child identity in the ready signal; if you need to know *which* child reported, prefer per-child channels.

### Error handling in N-way starts

When one child fails, every other child should be stopped. The cleanest way is an `errgroup.WithContext` whose context is cancelled on first error:

```go
g, ctx := errgroup.WithContext(parent)
for i := 0; i < N; i++ {
    i := i
    g.Go(func() error {
        if err := initialise(i); err != nil {
            return fmt.Errorf("child %d: %w", i, err)
        }
        return runLoop(ctx, i)
    })
}
if err := g.Wait(); err != nil {
    // every other child saw ctx.Done() and returned
    return err
}
```

`errgroup` handles the cancellation propagation; you just have to write each child's `runLoop` to watch `<-ctx.Done()`.

---

## Supervisor Trees

In Erlang/OTP, a supervisor manages a set of children: it starts them in order, watches them, and restarts them on failure according to a strategy. Go does not have a built-in supervisor, but the patterns translate.

### A minimal supervisor

```go
type Supervisor struct {
    children []ChildSpec
    mu       sync.Mutex
}

type ChildSpec struct {
    Name    string
    Start   func(ctx context.Context) (Child, error)
    Restart RestartPolicy // Permanent, Transient, Temporary
}

type Child interface {
    Wait() error // blocks until child exits; returns the error
}

func (s *Supervisor) Run(ctx context.Context) error {
    var wg sync.WaitGroup
    for _, spec := range s.children {
        spec := spec
        wg.Add(1)
        go s.runChild(ctx, spec, &wg)
    }
    wg.Wait()
    return nil
}

func (s *Supervisor) runChild(ctx context.Context, spec ChildSpec, wg *sync.WaitGroup) {
    defer wg.Done()
    for {
        c, err := spec.Start(ctx)
        if err != nil {
            log.Printf("child %s start failed: %v", spec.Name, err)
            return
        }
        err = c.Wait()
        if ctx.Err() != nil {
            return
        }
        switch spec.Restart {
        case Permanent:
            log.Printf("child %s exited: %v; restarting", spec.Name, err)
            continue
        case Transient:
            if err == nil {
                return
            }
            log.Printf("child %s exited with error: %v; restarting", spec.Name, err)
        case Temporary:
            return
        }
    }
}
```

Each child has its own goroutine; the supervisor restarts according to policy. Cancellation propagates via the context.

The handshakes here are implicit:

- `Start(ctx)` is the started handshake: it returns only after the child is up.
- `Wait()` is the stopped handshake: blocks until the child has returned.

Building these handshakes into the `Child` interface forces every implementation to follow the protocol.

### Restart strategies

- **Permanent.** Always restart. For long-running daemons.
- **Transient.** Restart on error, exit cleanly on `nil`. For tasks that have an intended completion.
- **Temporary.** Never restart. For one-shot work.

Add escalation: if a child has restarted N times in M seconds, escalate to the parent (return an error from the supervisor's `Run`). This caps restart loops on a permanently broken dependency.

### Why not just panic?

A panicking goroutine that is not recovered crashes the whole process. A supervisor *recovers* the panic inside the child's goroutine and translates it into an `error` for `Wait()`. This is the same model as Erlang's "let it crash, but contain the crash."

---

## Drain Handshakes

A drain handshake is shutdown's middle phase: stop accepting input, process what is already in-flight, then exit.

### The closing-input-channel pattern

```go
type Queue struct {
    in       chan Item
    workers  int
    drained  chan struct{}
}

func (q *Queue) Run() {
    var wg sync.WaitGroup
    for i := 0; i < q.workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for item := range q.in {
                process(item)
            }
        }()
    }
    wg.Wait()
    close(q.drained)
}

func (q *Queue) Drain(ctx context.Context) error {
    close(q.in) // no more pushes; workers finish what's queued
    select {
    case <-q.drained:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

`close(q.in)` is the input-side signal. Each worker's `for ... range q.in` loop exits when the channel is drained and closed. `wg.Wait()` blocks until all workers have returned. The final `close(q.drained)` is the explicit "I am done" handshake the caller waits on.

Watch out: callers must not be sending on `q.in` when `Drain` is called, or they will panic. The owner of `q.in` is the only goroutine that closes it. Provide a `Push` that returns `ErrClosed`:

```go
func (q *Queue) Push(item Item) error {
    select {
    case q.in <- item:
        return nil
    case <-q.stopReq:
        return ErrClosed
    }
}
```

Now callers cannot accidentally push into a closed channel.

### Drain with a deadline

If the workers are slow, the drain may exceed the budget. The pattern:

```go
func (q *Queue) Drain(ctx context.Context) error {
    close(q.stopReq) // tell workers to stop after current item
    select {
    case <-q.drained:
        return nil
    case <-ctx.Done():
        // workers may still be running; force-cancel
        close(q.forceStop)
        <-q.drained
        return ctx.Err()
    }
}
```

Two-stage shutdown: first ask politely (`stopReq`), then force (`forceStop`). The worker watches both:

```go
for {
    select {
    case <-q.forceStop:
        return
    case item, ok := <-q.in:
        if !ok {
            return
        }
        process(item)
        select {
        case <-q.stopReq:
            return
        default:
        }
    }
}
```

After processing each item the worker checks `stopReq`. If signalled, exit gracefully. If `forceStop` fires mid-item, abandon the in-flight work.

---

## Promotion and Step-Down Handshakes

In a leader-elected system, the new leader must not begin serving until the previous leader has demonstrably stepped down. The handshake:

```go
type Election struct {
    stepDown    chan struct{}
    steppedDown chan struct{}
    promoted    chan struct{}
}

// run by the losing node
func (e *Election) StepDown(ctx context.Context) error {
    select {
    case <-e.stepDown:
        // already in progress
    default:
        close(e.stepDown)
    }
    select {
    case <-e.steppedDown:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

// run by the winning node
func (e *Election) Promote(ctx context.Context) error {
    select {
    case <-e.steppedDown:
    case <-ctx.Done():
        return ctx.Err()
    }
    close(e.promoted)
    return nil
}
```

The `<-e.steppedDown` block in `Promote` is the key line: the new leader does not signal its own promotion until it has observed the old leader's confirmed stop. The window of "two leaders" is closed.

In practice the `steppedDown` signal is mediated through the consensus log (etcd lease, ZooKeeper sequential node), not a Go channel — but the in-process equivalent is exactly the stop/stopped pair.

---

## Deadlock Hazards and How to Spot Them

Channel handshakes deadlock in characteristic ways. Recognising them in code review saves you 3 AM debugging.

### 1. The cyclic wait

A waits for B; B waits for C; C waits for A. None proceeds.

```go
// goroutine A
<-bDone
close(aDone)

// goroutine B
<-cDone
close(bDone)

// goroutine C
<-aDone
close(cDone)
```

Spot it by drawing the wait-for graph. Any cycle is a deadlock.

### 2. The missed close

The closer goroutine returns without closing. Everyone watching the channel hangs.

```go
go func() {
    if condition {
        return // forgot to close(done)
    }
    close(done)
}()
<-done // forever
```

Spot it by `defer close(done)` at the top of every goroutine that owns a close.

### 3. The held lock plus blocked channel

Goroutine holds a mutex; tries to send on a channel; receiver of the channel needs the same mutex.

```go
s.mu.Lock()
defer s.mu.Unlock()
s.notify <- something // receiver does s.mu.Lock(), deadlocks
```

Spot it by never holding a lock across a channel send/receive.

### 4. The unbuffered ack after timeout

The requester gave up after timeout. The worker's send on the unbuffered reply parks forever.

```go
reply := make(chan int) // unbuffered
go func() { reply <- compute() }() // parks if requester left
select {
case <-reply:
case <-ctx.Done(): return // worker is now leaked
}
```

Spot it by buffering all reply channels with capacity 1.

### Debugging a live deadlock

Send `SIGQUIT` to the process (`kill -SIGQUIT <pid>`) or curl `/debug/pprof/goroutine?debug=2` if you have `net/http/pprof` registered. The dump shows every goroutine's stack. Look for goroutines stuck on `chan receive`, `chan send`, or `select`. Cross-reference the file:line locations with the channel-owner documentation. The cycle reveals itself.

---

## Goroutine Leaks from Broken Handshakes

A goroutine that is parked on a channel that no one will ever signal is a leak. Symptoms:

- `runtime.NumGoroutine()` grows linearly with request count.
- Memory grows but heap profile shows no hot spots — it is the goroutine stacks.
- Tests pass; production fills up after hours.

Common leak shapes:

### 1. The orphaned request

```go
in <- Request{Reply: make(chan int)} // unbuffered
// caller never reads Reply because of an earlier return
```

Worker's send blocks; worker goroutine leaks.

### 2. The forgotten stopper

```go
func newService() *Service {
    return &Service{
        in: make(chan Req),
    }
    // forgot to launch the goroutine that reads from in
}
```

Now every caller's `s.in <- r` blocks forever.

### 3. The captured channel in a long-lived closure

```go
done := make(chan struct{})
go func() {
    for {
        select {
        case <-done:
            return
        case e := <-events:
            handleEvent(e)
        }
    }
}()
// done is never closed
```

The closure captures `done`; even if the outer function returns, the goroutine remains.

### Detecting leaks

- `goleak` (https://github.com/uber-go/goleak): pluggable test helper that fails a test if goroutines outlive it.
- Periodic `runtime.NumGoroutine` metric exposed via Prometheus.
- Manual: pprof goroutine dump in load tests, look for goroutines stuck on the same channel.

---

## Handshakes Across Process Boundaries

When two processes communicate, the handshake is over a network protocol (gRPC, HTTP), but the *logic* is the same: request + ack, started + stopped, drain.

### gRPC StreamingRPC as a handshake

A bidirectional gRPC stream is a handshake at the protocol level. Client sends a message; server processes; server sends a response (or several). The stream's `Recv` and `Send` calls play the role of the channel send/receive.

Inside the server handler, you typically wrap the stream in goroutines:

```go
func (s *server) Process(stream pb.Service_ProcessServer) error {
    ctx := stream.Context()
    in := make(chan *pb.Request)
    out := make(chan *pb.Response)
    g, ctx := errgroup.WithContext(ctx)

    g.Go(func() error {
        defer close(in)
        for {
            r, err := stream.Recv()
            if err == io.EOF {
                return nil
            }
            if err != nil {
                return err
            }
            select {
            case in <- r:
            case <-ctx.Done():
                return ctx.Err()
            }
        }
    })

    g.Go(func() error {
        for r := range in {
            resp := process(r)
            if err := stream.Send(resp); err != nil {
                return err
            }
        }
        return nil
    })

    return g.Wait()
}
```

`g.Wait()` is the handshake: the handler returns only after both goroutines have completed (or one has errored, causing the other to be cancelled). The pattern is the same one you used for in-process workers; the only difference is the channel is wrapped around a stream.

### Kubernetes readiness as a startup handshake

A pod's `readinessProbe` is a periodic handshake between Kubernetes and your process. Your service answers "yes, ready" or "no, not yet." The pod is added to the service's load balancer only when the readiness probe succeeds. The probe is the network-level equivalent of `<-started`.

---

## Testing Handshakes

A handshake is testable in two directions:

### 1. Success path

```go
func TestStartStop(t *testing.T) {
    s := New()
    go s.Run()
    if err := s.WaitStarted(timeoutCtx(t, time.Second)); err != nil {
        t.Fatal(err)
    }
    // do some work...
    if err := s.Stop(timeoutCtx(t, time.Second)); err != nil {
        t.Fatal(err)
    }
}
```

Each handshake is wrapped in a timeout. If the handshake hangs, the test fails — not the build.

### 2. Cancellation path

```go
func TestStopRespectsContext(t *testing.T) {
    s := newSlow()
    go s.Run()
    <-s.Started()
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
    defer cancel()
    err := s.Stop(ctx)
    if err == nil {
        t.Fatal("expected ctx.Err()")
    }
    if !errors.Is(err, context.DeadlineExceeded) {
        t.Fatalf("unexpected error: %v", err)
    }
}
```

Force the handshake to time out; verify the error surfaces correctly.

### 3. Race detector

Run every test with `-race`. The race detector catches the data races that occur when a handshake fails to provide the happens-before guarantee you expected.

### 4. `goleak`

Wrap every test in `defer goleak.VerifyNone(t)` (or use `TestMain` with `goleak.VerifyTestMain(m)`). Any goroutine that outlives the test is a leak — almost always a missing handshake.

---

## Mental Models

### Shutdown is a topological sort

The components of a service have dependencies: HTTP handlers depend on workers, workers depend on the database. To shut down without losing data, you must shut down in the reverse of startup order — *and* you must wait for each layer to drain before moving to the next.

### A handshake is a barrier

Every handshake is a synchronisation barrier: no goroutine that participates in it can proceed past its barrier point until the others have arrived. Designing handshakes is designing barriers.

### Cancellation is a poison pill

`context.Cancel` is a poison pill that spreads through the goroutine tree. Every blocking call should watch the context. The handshake design ensures that the poison reaches every leaf and that each leaf cleans up before returning.

---

## Use Cases

### Service lifecycle

Start → ready → serve → drain → stop. Each transition is a handshake.

### Distributed transactions (saga)

Each step is a handshake with its participant. Compensation steps are inverse handshakes.

### Background job processors

A job processor with N workers, a stop signal, and a "drain finished" handshake. Used in every queue worker (Sidekiq, Celery analogues).

### Hot config reload

The config-watcher goroutine reads a new config and asks the service to switch. The service confirms the switch by closing a "config applied" channel. The watcher waits for the confirmation before proceeding to the next change.

---

## Coding Patterns

### Wrap the handshake in a method, not a comment

```go
func (s *Service) Stop(ctx context.Context) error {
    close(s.stop)
    select {
    case <-s.stopped:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Callers see a method; the channel ops are private.

### Use `errgroup` for multi-goroutine handshakes

`errgroup.Group.Wait()` is the canonical N-way stopped handshake. Use it instead of hand-rolling a `WaitGroup` + error channel.

### Make every long-running goroutine cancellable

```go
go func() {
    for {
        select {
        case <-ctx.Done():
            return
        case e := <-in:
            handle(e)
        }
    }
}()
```

No exceptions. Every loop watches the context. This is what allows the supervisor to cleanly tear down a subtree.

---

## Common Mistakes at Senior Level

### Mistake 1: Sequential shutdown phases without timeouts

```go
a.srv.Shutdown(ctx)
a.workers.Drain(ctx) // ctx already exhausted
a.db.Close()
```

Each phase shares one context. The first phase may consume the whole budget, leaving none for the others. Sub-divide.

### Mistake 2: Closing channels you do not own

Any function that closes a channel needs to be the sole owner. If a library closes a channel its caller also wants to close, you have a panic waiting to happen.

### Mistake 3: Stop signal that doesn't propagate to children

A service stops, but its goroutines hold references to inner contexts that were never derived from the outer one. Always `ctx, cancel := context.WithCancel(parentCtx)` and propagate.

### Mistake 4: Treating "panic in worker" as fatal

A panic in one worker should be recovered by the supervisor, not crash the process. Wrap each worker's main goroutine:

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            errCh <- fmt.Errorf("panic: %v\n%s", r, debug.Stack())
        }
    }()
    runWorker()
}()
```

### Mistake 5: Reaching for `sync.Cond` because "channels are slow"

At this level you should benchmark before you optimise. Channels are slow *only* in microbenchmarks at hundreds of nanoseconds per op. Real services rarely care.

---

## Tricky Points

### Why is `errgroup.WithContext` the right hammer for most jobs?

It packages four concerns: launch goroutines, collect the first error, propagate cancellation on first error, and wait for all to return. That is the entire startup-and-coordinated-shutdown pattern in one library.

### Why does `http.Server.Shutdown` use a context?

Because the drain may take longer than you want to wait. The context's deadline is the budget; on expiry, Shutdown returns the error and leaves any still-active connections to be cleaned up forcibly (or not — `Shutdown` does not kill connections, it just stops waiting for them).

### How do I shut down a goroutine that is blocked on a syscall?

You cannot, in general. A goroutine in a blocking `read` on a file descriptor will not check `ctx.Done()`. You have to close the underlying fd from another goroutine, which unblocks the read with an error. This is why `net.Listener` and `net.Conn` expose `Close` — closing the conn from outside is the only way to interrupt a blocked goroutine.

---

## Self-Assessment Checklist

You are ready for [Professional](professional.md) when you can:

- [ ] Design a multi-phase service shutdown with per-phase budgets.
- [ ] Implement an N-way startup barrier with error propagation.
- [ ] Build a supervisor that restarts children according to a policy.
- [ ] Identify all four classes of channel deadlock in code review.
- [ ] Write tests that prove a handshake respects context cancellation.
- [ ] Use `goleak` to catch goroutine leaks.
- [ ] Translate a Go in-process handshake to its gRPC streaming equivalent.

---

## Summary

Senior handshakes are about *protocols*, not individual channels.

- **Graceful shutdown** is a topologically ordered traversal of components, each with its own handshake and budget.
- **N-way startup barriers** synchronise multiple goroutines' "ready" signals, with error propagation and a global deadline.
- **Supervisors** watch children, propagate failures, and restart according to policy.
- **Drain handshakes** convert "stop now" into "stop after the queue is empty."
- **Promotion / step-down** handshakes ensure that at most one leader is active at a time.
- **Deadlock hazards** fall into four classes: cyclic wait, missed close, lock+channel, unbuffered ack after timeout.
- **Leaks** come from broken handshakes; `goleak` catches them in tests.
- **Cross-process handshakes** map directly onto the same patterns over gRPC streams or HTTP.

These patterns let you build services that the operator can shut down cleanly, the supervisor can restart, and the test suite can verify. They are the difference between "the service works" and "the service is operable."

---

## Further Reading

- *errgroup* documentation: https://pkg.go.dev/golang.org/x/sync/errgroup
- *goleak*: https://github.com/uber-go/goleak
- Pike, R. *Advanced Go Concurrency Patterns*: https://talks.golang.org/2013/advconc.slide
- `http.Server.Shutdown` documentation and source.
- `database/sql.DB.Close` source — a real-world drain implementation.
- Cox-Buday, K. *Concurrency in Go* (O'Reilly), chapter 4 on "Concurrency at Scale".
- [Professional](professional.md) — production examples and observability.
- [Specification](specification.md) — memory model guarantees that underpin the patterns above.
