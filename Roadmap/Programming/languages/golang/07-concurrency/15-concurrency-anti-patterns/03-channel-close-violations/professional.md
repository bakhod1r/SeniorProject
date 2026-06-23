---
layout: default
title: Professional
parent: Channel Close Violations
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 4
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/03-channel-close-violations/professional/
---

# Channel Close Violations — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Operating Production Systems with Channel Closes](#operating-production-systems-with-channel-closes)
3. [Shutdown Protocols Across Services](#shutdown-protocols-across-services)
4. [Graceful Drain of Pipelines](#graceful-drain-of-pipelines)
5. [Context Cancellation Versus Close](#context-cancellation-versus-close)
6. [Observability of Channel State](#observability-of-channel-state)
7. [Framework-Level Patterns: errgroup](#framework-level-patterns-errgroup)
8. [Framework-Level Patterns: Worker Pools](#framework-level-patterns-worker-pools)
9. [Runtime Anatomy of Close](#runtime-anatomy-of-close)
10. [The hchan Structure](#the-hchan-structure)
11. [Panic Stack Trace Forensics](#panic-stack-trace-forensics)
12. [Race Detector Output on Close Violations](#race-detector-output-on-close-violations)
13. [Production Incident Playbook](#production-incident-playbook)
14. [Kubernetes-Scale Shutdown Patterns](#kubernetes-scale-shutdown-patterns)
15. [Pod Termination and Channel Drain](#pod-termination-and-channel-drain)
16. [Signal Handling and Close Triggers](#signal-handling-and-close-triggers)
17. [Distributed Shutdown Coordination](#distributed-shutdown-coordination)
18. [Health Checks and Pre-Close Behaviour](#health-checks-and-pre-close-behaviour)
19. [Backpressure and Close](#backpressure-and-close)
20. [Performance Cost of Safe-Close Patterns](#performance-cost-of-safe-close-patterns)
21. [Lock-Free Idempotent Close](#lock-free-idempotent-close)
22. [Memory Model Implications](#memory-model-implications)
23. [Telemetry: Metrics, Logs, Traces](#telemetry-metrics-logs-traces)
24. [Chaos Engineering for Close](#chaos-engineering-for-close)
25. [Post-Incident Review Patterns](#post-incident-review-patterns)
26. [Self-Assessment](#self-assessment)
27. [Summary](#summary)

---

## Introduction

The senior level covered the design of close protocols. The professional level covers the operation of systems built on those protocols.

In production:

- Close failures cause incidents, not just unit-test failures.
- A graceful shutdown that takes 30 seconds when the SLO is 5 seconds is a real bug.
- Close panics in the field are a paging event and a public post-mortem.
- Observability of close events is required for capacity planning and incident response.
- Patterns must scale to thousands of nodes, millions of QPS, and dozens of microservices interleaved.

This file is the operator's handbook. Topics include the runtime mechanics that produce close-related panics, the patterns that make production-grade shutdown possible, and the tools (metrics, traces, logs, profiling) that surface close issues before they wake you at 3 AM.

It assumes you have internalised the senior-level material. We will spend less time on the why and more time on the operational details.

---

## Operating Production Systems with Channel Closes

A production system distinguishes itself from a development prototype by how it handles edge cases. For channels, the edge cases are:

1. **Cold start.** Channels are created, but no senders are running yet. Closing is a no-op for receivers.
2. **Steady state.** Normal operation. Close should not happen.
3. **Graceful shutdown.** Initiated by SIGTERM, a deploy, a scale-down. Close cascades through the system.
4. **Hard shutdown.** Initiated by SIGKILL or a panic. Goroutines die mid-stride; channels are abandoned.
5. **Restart after crash.** A new process comes up; old channels are gone with the old process.

Production discipline: every channel must have a documented behaviour in each of these states.

### Cold start

Channels created during initialisation should not be exposed to senders until they are ready to receive. A common mistake: spawn the receiver goroutine after exposing the channel.

```go
// BAD
type Svc struct { events chan Event }
func New() *Svc { return &Svc{events: make(chan Event)} }
func (s *Svc) Start() { go s.consume() }

// caller does:
svc := New()
svc.SubmitEvent(e) // blocks; receiver not running
svc.Start()
```

The fix is to start the receiver in the constructor, or to defer event submission until after Start. The convention "Start before Submit" must be enforced — usually by making `events` private and exposing a `SubmitEvent` method that checks state.

### Graceful shutdown

The canonical sequence:

1. Signal: SIGTERM or admin endpoint.
2. Stop accepting new work (close listener, refuse Submit).
3. Cancel context to signal in-flight work.
4. Wait for in-flight work to finish or timeout.
5. Close internal channels (after senders have stopped).
6. Close external resources (DB, log file, etc.).
7. Exit process.

Each step has potential close issues. A misordered step (close before drain, drain before stop-accepting) causes panic or data loss.

### Hard shutdown

A panic in any goroutine terminates the process. If a defer-based close was scheduled, it may or may not run (the deferred function in the panicking goroutine runs; other goroutines' defers do not). Channels in an inconsistent state may panic on subsequent operations.

Production-grade systems often have a top-level recover-and-log that captures panics, logs context, then re-panics (to terminate the process cleanly). The point: do not try to recover into normal operation after an unintended panic in a critical goroutine.

---

## Shutdown Protocols Across Services

Most production systems are not single processes. A microservice ecosystem has interdependencies: service A depends on service B, which depends on service C. Shutdown must respect these dependencies.

### Independent shutdowns

If services are truly independent — no synchronous calls between them — each shuts down on its own schedule. Channels within each service close per the senior-level patterns. No cross-service coordination.

In practice, even "independent" services share message queues or databases. Shutdown of those shared resources is a different problem (database connection drains, queue acknowledgements, etc.).

### Dependent shutdowns

If service A calls service B synchronously, and B shuts down first, A's in-flight requests fail. Two strategies:

1. **Drain protocol.** B announces intent to shut down. A stops sending new requests. A drains its in-flight requests. B confirms drain. B finishes shutdown.
2. **Retry-and-tolerate.** B shuts down abruptly. A's in-flight requests fail; retry against a different B replica. A's open connections to B drop and reconnect.

Drain is gentler but slower. Retry is faster but causes blip in latency. Most production systems use retry; drain is reserved for resource-intensive operations (large file transfers).

### How channels fit in

Within each service, channels coordinate goroutines. The "shutdown" of a service is the cascade of channel closes:

1. Listener closes accept loop.
2. Accept loop's exit closes its connection registry.
3. Connection handlers' exits close their per-connection state.
4. State holders close their persistence channels.

Each level is one application of the senior-level patterns. The professional skill is sequencing them.

---

## Graceful Drain of Pipelines

A pipeline (source → stages → sink) under shutdown must drain: finish processing in-flight items before exiting. Done wrong, items are lost.

### Drain algorithm

```
1. Signal source: stop emitting new items.
2. Source exits when current item is sent (or aborted on timeout).
3. Source closes its output channel.
4. Stage 1 ranges over source; range exits when source closes.
5. Stage 1 finishes its current item, sends downstream, closes its output.
6. ... cascade through all stages ...
7. Sink ranges over last stage's output, finishes when it closes.
8. All goroutines have exited. Service exits.
```

This is quiescent shutdown. No items lost (assuming all goroutines cooperate).

### Implementing drain with errgroup

```go
func RunPipeline(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)

    src := make(chan Item, 32)
    mid := make(chan Item, 32)

    g.Go(func() error {
        defer close(src)
        return source(ctx, src)
    })

    g.Go(func() error {
        defer close(mid)
        for it := range src {
            out, err := stage1(ctx, it)
            if err != nil { return err }
            select {
            case <-ctx.Done(): return ctx.Err()
            case mid <- out:
            }
        }
        return nil
    })

    g.Go(func() error {
        for it := range mid {
            if err := sink(ctx, it); err != nil { return err }
        }
        return nil
    })

    return g.Wait()
}
```

On context cancellation, `source` observes `ctx.Done()` and exits. `defer close(src)` fires. Stage1 ranges exit; its `defer close(mid)` fires. Sink ranges exit. errgroup's Wait returns. Total drain time = source's response time + stage1's processing time + sink's processing time.

The drain is bounded by the slowest in-flight item, not the total queue size — because items already in mid have been processed by source.

Wait — items in the buffer of `src` are not yet processed by stage1. Those drain through stage1 as stage1 reads them. Items in the buffer of `mid` are not yet processed by sink. So total drain time depends on buffer sizes: 32 items in src buffer + 32 in mid buffer + the in-flight item per stage.

If you need stricter bounds, reduce buffer sizes or use unbuffered channels — at the cost of throughput.

### Drain with timeout

If drain exceeds the SLO, you must abandon and lose data. The pattern:

```go
func GracefulShutdown(ctx context.Context, p *Pipeline) error {
    cancelCtx, cancel := context.WithCancel(context.Background())
    defer cancel()
    drainDone := make(chan error, 1)
    go func() { drainDone <- p.Run(cancelCtx) }()

    cancel() // signal pipeline to drain
    select {
    case err := <-drainDone:
        return err
    case <-ctx.Done():
        return ctx.Err() // shutdown timeout
    }
}
```

Caller provides `ctx` with a deadline. If drain exceeds the deadline, shutdown returns with the deadline error. The pipeline may still be running (its goroutines will eventually finish or leak). Hard shutdown follows (process exit).

### What drain *cannot* do

Drain is graceful for in-process queues. It cannot drain:

- External queues (Kafka, RabbitMQ): drain there means stop fetching, which is a separate protocol.
- Network connections to clients: drain means stop accepting, finish responding to existing, then close listener.
- Database transactions: drain means commit in-flight transactions and refuse new ones.

These each have their own shutdown protocols. Channel-based drain is just one layer.

---

## Context Cancellation Versus Close

The professional-level distinction:

- `context.Context.Done()` is a *signal*. It says "stop, please". The receiver decides how to comply.
- `close(ch)` is a *fact*. It says "no more data will arrive". The receiver must handle this state.

A pipeline that uses *only* context cancellation can leak items: cancellation tells everyone to stop, but in-flight items are not delivered. A pipeline that uses *only* channel close can hang on errors: there is no way to abort.

Production pipelines use both. Context is the abort signal; close is the natural-end signal. Both must be handled in every loop.

### The five places to check ctx.Done

In a pipeline stage:

```go
for {
    select {
    case <-ctx.Done(): return ctx.Err() // 1. waiting for input
    case it, ok := <-in:
        if !ok { return nil }              // 2. input channel closed
        out, err := process(ctx, it)       // 3. inside processing (passed ctx)
        if err != nil { return err }
        select {
        case <-ctx.Done(): return ctx.Err() // 4. waiting to send
        case sink <- out:
        }
    }
}
// 5. before return, defer close(sink) // if this stage owns sink
```

Five places. Miss any one, and cancellation does not propagate through that arm.

In practice, the top-level select catches most cases. But the send arm (place 4) is the most frequently missed: developers write `sink <- out` directly, assuming the receiver is fast enough that it never blocks. Under load, it can block; cancellation never reaches the goroutine.

### Anti-pattern: bare send after Receive

```go
for it := range in {
    out := process(it)
    sink <- out  // can block forever if sink consumer gone
}
```

Cancellation cannot reach this goroutine while it is stuck on `sink <-`. Always wrap sends in `select { case sink <-out: case <-ctx.Done(): }`.

### Anti-pattern: ctx-only without close

```go
for {
    select {
    case <-ctx.Done(): return
    default:
    }
    out := produce()
    sink <- out
}
```

The receiver does not know when production has ended. It must rely on ctx.Done() somehow. But if the receiver does:

```go
for {
    select {
    case v := <-sink: process(v)
    case <-ctx.Done(): return
    }
}
```

Then on cancellation, the receiver may exit before draining the buffered items in `sink`. Lost data.

Fix: close `sink` when the producer exits. Receiver ranges; range exits when sink closes; drain is complete.

The pattern is always: close-on-natural-end + ctx-for-abort, observed by both ends.

---

## Observability of Channel State

In production, you want to know:

- How many channels are currently allocated.
- How occupied each channel's buffer is (over time).
- How long sends and receives block (latency distributions).
- When channels close (events).
- Which channels block longest (for capacity planning).

Go does not expose these directly. You instrument them.

### Instrumented channel

```go
type InstrCh[T any] struct {
    name string
    ch   chan T
    cap  int
}

func NewInstrCh[T any](name string, buf int) *InstrCh[T] {
    return &InstrCh[T]{name: name, ch: make(chan T, buf), cap: buf}
}

func (c *InstrCh[T]) Send(v T) {
    start := time.Now()
    c.ch <- v
    sendLatency.WithLabelValues(c.name).Observe(time.Since(start).Seconds())
    occupancy.WithLabelValues(c.name).Set(float64(len(c.ch)))
}

func (c *InstrCh[T]) Recv() (T, bool) {
    start := time.Now()
    v, ok := <-c.ch
    recvLatency.WithLabelValues(c.name).Observe(time.Since(start).Seconds())
    occupancy.WithLabelValues(c.name).Set(float64(len(c.ch)))
    return v, ok
}

func (c *InstrCh[T]) Close() {
    closeCount.WithLabelValues(c.name).Inc()
    close(c.ch)
}
```

Each operation updates metrics. The overhead is small (a few atomic operations on the Prometheus counters); for high-QPS channels, sample at 1/N.

### Occupancy sampling

Polling `len(ch)` periodically is cheaper than per-operation:

```go
go func() {
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    for range ticker.C {
        for _, c := range channels {
            occupancy.WithLabelValues(c.name).Set(float64(len(c.ch)))
        }
    }
}()
```

A 1Hz sample is enough for capacity planning. Higher rates only matter if you are debugging a specific issue.

### Tracking close events

A trace span per close:

```go
func (c *InstrCh[T]) Close() {
    span := trace.SpanFromContext(c.parentCtx) // or start a new span
    span.AddEvent("channel.close",
        trace.WithAttributes(
            attribute.String("name", c.name),
            attribute.Int("len_at_close", len(c.ch)),
        ),
    )
    close(c.ch)
}
```

In a trace visualisation (Jaeger, Tempo), you can see exactly when each channel closed during a shutdown. Invaluable for debugging slow drains.

---

## Framework-Level Patterns: errgroup

`golang.org/x/sync/errgroup` is the canonical framework for structured concurrency in Go. Its close protocol is the gold standard.

### How errgroup handles close

```go
g, ctx := errgroup.WithContext(parentCtx)
g.Go(f1)
g.Go(f2)
err := g.Wait()
```

Internally:

1. errgroup holds a context derived from `parentCtx` via WithCancel.
2. Each `g.Go(fn)` wraps `fn` in a goroutine that calls `fn`, captures the return error, and if non-nil and first-error, cancels the context via the captured cancel func.
3. `g.Wait()` waits for all goroutines, then returns the first error (or nil).

The "first error cancels context" is the key. It means every other goroutine sees `ctx.Done()` and can abort.

### When errgroup is the right tool

- Fixed set of parallel tasks; first error aborts all.
- Each task takes context, respects cancellation.
- You want all tasks to finish (or abort) before continuing.

### When errgroup is not the right tool

- Indefinite/long-running goroutines (services, listeners). errgroup's Wait blocks indefinitely.
- Goroutines that don't take context.
- Patterns that want all tasks to continue even if some fail.

For the second and third, write your own goroutine management or use a different library.

### Channels within errgroup

A common pattern: each task sends to a shared channel; the main goroutine collects from the channel.

```go
g, ctx := errgroup.WithContext(ctx)
out := make(chan Result, 16)

for i := 0; i < 10; i++ {
    i := i
    g.Go(func() error {
        r, err := compute(ctx, i)
        if err != nil { return err }
        select {
        case <-ctx.Done(): return ctx.Err()
        case out <- r:
        }
        return nil
    })
}

go func() { _ = g.Wait(); close(out) }()

for r := range out { handle(r) }
```

The producer goroutines are managed by errgroup. After all return, a separate goroutine closes `out`. The consumer ranges and exits.

This is the standard "errgroup + channel" pattern. Note the separate goroutine for the close — you cannot do `g.Wait()` followed by `close(out)` in the main thread because `Wait()` blocks until *all* goroutines including the consumer-side are done, and the consumer's `for range` cannot exit until close.

The separate close-after-wait goroutine breaks the chicken-and-egg.

### Pitfall: errgroup with non-error returning goroutines

```go
g.Go(func() error {
    for {
        select {
        case <-ctx.Done(): return nil
        case msg := <-input:
            // process
        }
    }
})
```

This goroutine never returns. `g.Wait()` blocks forever. Even if you cancel ctx, the goroutine returns nil (no error), so the errgroup sees "first error was nil" and waits for all other goroutines.

Fix: ensure all goroutines have a termination condition that matches your shutdown protocol. For service goroutines, errgroup is not the right fit. Use sync.WaitGroup directly.

---

## Framework-Level Patterns: Worker Pools

A production worker pool has many failure modes related to close.

### Production worker pool: full implementation

```go
package pool

import (
    "context"
    "errors"
    "sync"
    "sync/atomic"
    "time"
)

var ErrPoolClosed = errors.New("pool: closed")

type Job interface {
    Run(ctx context.Context) error
}

type Pool struct {
    workers  int
    queueLen int

    jobs chan Job
    done chan struct{}
    wg   sync.WaitGroup
    once sync.Once

    submitted atomic.Int64
    completed atomic.Int64
    failed    atomic.Int64
}

func New(workers, queueLen int) *Pool {
    p := &Pool{
        workers:  workers,
        queueLen: queueLen,
        jobs:     make(chan Job, queueLen),
        done:     make(chan struct{}),
    }
    p.start()
    return p
}

func (p *Pool) start() {
    p.wg.Add(p.workers)
    for i := 0; i < p.workers; i++ {
        go p.worker(i)
    }
}

func (p *Pool) worker(id int) {
    defer p.wg.Done()
    for {
        select {
        case <-p.done:
            // Drain remaining jobs without blocking.
            for {
                select {
                case j := <-p.jobs:
                    p.runJob(id, j)
                default:
                    return
                }
            }
        case j := <-p.jobs:
            p.runJob(id, j)
        }
    }
}

func (p *Pool) runJob(workerID int, j Job) {
    defer func() {
        if r := recover(); r != nil {
            p.failed.Add(1)
            // log r, possibly increment metrics
        }
    }()
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    if err := j.Run(ctx); err != nil {
        p.failed.Add(1)
    } else {
        p.completed.Add(1)
    }
}

func (p *Pool) Submit(j Job) error {
    select {
    case <-p.done:
        return ErrPoolClosed
    default:
    }
    select {
    case <-p.done:
        return ErrPoolClosed
    case p.jobs <- j:
        p.submitted.Add(1)
        return nil
    }
}

func (p *Pool) SubmitOrTimeout(j Job, timeout time.Duration) error {
    select {
    case <-p.done:
        return ErrPoolClosed
    default:
    }
    timer := time.NewTimer(timeout)
    defer timer.Stop()
    select {
    case <-p.done:
        return ErrPoolClosed
    case p.jobs <- j:
        p.submitted.Add(1)
        return nil
    case <-timer.C:
        return errors.New("pool: timeout")
    }
}

func (p *Pool) Shutdown(ctx context.Context) error {
    p.once.Do(func() {
        close(p.done)
    })
    done := make(chan struct{})
    go func() {
        p.wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (p *Pool) Stats() (submitted, completed, failed int64) {
    return p.submitted.Load(), p.completed.Load(), p.failed.Load()
}
```

Properties:

- Workers are supervised via WaitGroup.
- Close uses sync.Once for idempotency.
- Close signals via `p.done`; workers drain `p.jobs` and exit.
- `p.jobs` is *never* closed. This eliminates send-on-closed races.
- Submit checks `p.done` twice: pre-check for fast path, select-with-cancel for the actual send.
- Workers recover panics in user code and increment a failure counter.
- Shutdown has a deadline; if it exceeds, return the deadline error.

This is the production template. Test it; ship it. We will scrutinise the close logic in more detail.

### Why two `<-p.done` checks in Submit

```go
select { case <-p.done: return; default: }
// what if Shutdown fires here?
select { case <-p.done: return; case p.jobs <- j: }
```

Without the first check: if jobs has buffer space, the second select might choose `p.jobs <- j` even after Shutdown closed `done`, because select picks pseudo-randomly when multiple cases are ready.

With the first check: we eliminate the race for the common case (Shutdown was already fired before Submit started). The second select handles the case where Shutdown fires while Submit is in progress.

There is *still* a residual race: a Submit that passes the first check, enters the second select, picks the `p.jobs <- j` arm, and starts to send — concurrently, Shutdown fires. The send completes. The worker has already exited (drained `p.jobs` and returned).

Wait — the worker's drain loop is `for { select { case j := <-p.jobs: ... default: return } }`. If the Submit happens after the worker's `default: return`, the job is in the buffer but no one is reading. Submit succeeded, but the job is never run.

Is this acceptable? It depends on the contract. Most pools accept this as "best-effort during shutdown". If you need stronger guarantees, you must reject Submits earlier — perhaps by adding a separate "stopping" state that rejects all Submits before any worker exits.

### State machine for graceful shutdown

```go
const (
    stateRunning int32 = iota
    stateStopping
    stateStopped
)

type Pool struct {
    state atomic.Int32
    // ...
}

func (p *Pool) Submit(j Job) error {
    if p.state.Load() != stateRunning {
        return ErrPoolClosed
    }
    // ... existing logic ...
}

func (p *Pool) Shutdown(ctx context.Context) error {
    if !p.state.CompareAndSwap(stateRunning, stateStopping) {
        return ErrPoolClosed
    }
    close(p.done) // signal workers to drain
    // ... wait for workers ...
    p.state.Store(stateStopped)
    return nil
}
```

Submit checks the state atomically; the state transitions happen-before the close. This eliminates the residual race because Submit returns ErrPoolClosed once stateStopping is set.

But still a race: a Submit that loaded `stateRunning` before the Shutdown CAS proceeds. The check-then-act sequence is not atomic. We've narrowed the window but not eliminated it.

To fully eliminate, you need to either:

1. Hold a mutex during Submit and Shutdown (heavy).
2. Use the done-channel pattern as the source of truth, not the atomic state (the existing code).
3. Accept the residual window and document it.

In practice, option 3 is fine. The window is microseconds wide; the failure mode (a job submitted but not run) is benign for most pools.

---

## Runtime Anatomy of Close

To debug close-related issues at the professional level, you need to understand what the Go runtime does inside `close(ch)`.

The function is `runtime.closechan(c *hchan)` in `src/runtime/chan.go`. Approximately:

```go
func closechan(c *hchan) {
    if c == nil {
        panic(plainError("close of nil channel"))
    }
    lock(&c.lock)
    if c.closed != 0 {
        unlock(&c.lock)
        panic(plainError("close of closed channel"))
    }
    // ... possibly record the close for race detection ...
    c.closed = 1

    // Release all readers.
    var glist gList
    for {
        sg := c.recvq.dequeue()
        if sg == nil { break }
        if sg.elem != nil {
            typedmemclr(c.elemtype, sg.elem) // zero-out
            sg.elem = nil
        }
        // mark this sudog as "channel closed"
        sg.closed = true
        gp := sg.g
        gp.param = unsafe.Pointer(sg)
        glist.push(gp)
    }
    // Release all writers — they will panic.
    for {
        sg := c.sendq.dequeue()
        if sg == nil { break }
        gp := sg.g
        gp.param = nil
        glist.push(gp) // these will panic on resume
    }
    unlock(&c.lock)
    // Wake up everyone.
    for !glist.empty() {
        gp := glist.pop()
        gp.schedlink = 0
        goready(gp, 3)
    }
}
```

(Pseudocode for clarity; the real function has more bookkeeping.)

Key insights:

1. The lock is taken first. All operations are serialised.
2. The closed-flag check raises the double-close panic.
3. Readers in the recv queue are dequeued, marked, and woken up. They will return zero-value + ok=false.
4. Writers in the send queue are dequeued and woken up. They will panic on resume.
5. The lock is released *before* the wakeups. This means another goroutine entering closechan immediately after will see closed=1 and panic.

The whole operation is O(N) where N is the number of waiting goroutines. For low-fanout, it's microseconds; for high-fanout (a broadcast close with thousands of waiters), it can be milliseconds.

### What the panic looks like in stack traces

A "close of closed channel" panic:

```
panic: close of closed channel

goroutine 1 [running]:
main.cleanup(...)
        /path/to/file.go:42
main.main()
        /path/to/main.go:88 +0x...
```

The frame at the top of the goroutine 1 stack is the caller of `close(ch)`. The runtime's `closechan` is not shown by default in the user-visible trace because it is in `runtime/chan.go` which is filtered.

To see the runtime frames, set `GOTRACEBACK=all` or `GOTRACEBACK=system`.

### What the panic looks like for send-on-closed

```
panic: send on closed channel

goroutine 5 [running]:
main.producer(...)
        /path/to/producer.go:23
created by main.main
        /path/to/main.go:14 +0x...
```

The "created by" line tells you which goroutine started this one. Useful for tracing back to the origin: who started the producer that is now sending on a closed channel?

### What "close of nil channel" looks like

```
panic: close of nil channel
```

Rare in practice; usually indicates a constructor that forgot to call `make`. The fix is always at the constructor, not at the close site.

---

## The hchan Structure

The runtime's hchan struct (in `src/runtime/chan.go`):

```go
type hchan struct {
    qcount   uint           // total data in the queue
    dataqsiz uint           // size of the circular queue (capacity)
    buf      unsafe.Pointer // points to an array of dataqsiz elements
    elemsize uint16
    closed   uint32         // close flag
    elemtype *_type
    sendx    uint           // send index (circular)
    recvx    uint           // receive index (circular)
    recvq    waitq          // list of recv waiters
    sendq    waitq          // list of send waiters
    lock     mutex
}
```

Close interacts mainly with three fields:

1. **closed.** A uint32 (could be a bool, but uint32 for alignment). 0 = open, 1 = closed. Read under `c.lock`.
2. **recvq.** Goroutines blocked on `<-ch`. On close, all are released with zero value.
3. **sendq.** Goroutines blocked on `ch <-`. On close, all are released and will panic on resume.

The lock serialises all of these. There is no lock-free close path; even the most optimised channel operations take the lock.

### Implication: close is not free

A close that wakes up N waiters takes O(N) under the lock. For high-fanout cases (broadcasts to thousands of subscribers), this can be a hotspot. If you observe long close times in profiles, look for high-fanout patterns.

### Implication: read-after-close is fast

A receive on a closed empty channel:

```go
v, ok := <-ch // ch closed, empty
```

The runtime acquires the lock, sees closed=1, qcount=0, returns zero value with ok=false, releases the lock. Constant time, no waiters touched.

This makes close-as-broadcast efficient on the receiver side: thousands of receivers, each doing `<-done`, all wake up at close, and each does an O(1) operation.

### Implication: buffered close preserves data

```go
ch := make(chan int, 3)
ch <- 1; ch <- 2; ch <- 3
close(ch)
for v := range ch { fmt.Println(v) } // 1, 2, 3, exits
```

The hchan's buf still contains 1, 2, 3. close just sets closed=1. Subsequent receives drain the buf, decrementing qcount. When qcount=0 and closed=1, the range loop terminates.

---

## Panic Stack Trace Forensics

Reading a panic stack trace from production to find the close-violation bug.

### Example 1: close of closed channel

```
panic: close of closed channel

goroutine 152 [running]:
github.com/example/svc.(*Worker).Stop(0xc000123450)
        /src/worker.go:88 +0x55
github.com/example/svc.(*Manager).Shutdown.func1(0xc000123450)
        /src/manager.go:42 +0x33
sync.(*WaitGroup).Wait(0xc000089060)
        /usr/local/go/src/sync/waitgroup.go:117 +0x6e
github.com/example/svc.(*Manager).Shutdown(0xc000089000)
        /src/manager.go:55 +0x...
```

Read top-down:

- The panic happened in `Worker.Stop` at worker.go:88.
- That was called from `Manager.Shutdown.func1` (an anonymous function inside Shutdown).
- The Shutdown caller is at manager.go:55.

Look at worker.go:88. Likely `close(w.ch)` without an idempotency guard. Look at manager.go:42 — likely a loop calling Stop on each worker.

Now: who called the first Stop? The double-close means *two* code paths reached the close. Search for callers of Worker.Stop. Likely the worker itself has a self-stop on its done channel, and Manager.Shutdown also calls Stop.

The fix: add sync.Once to Worker.Stop:

```go
func (w *Worker) Stop() {
    w.once.Do(func() { close(w.ch) })
}
```

### Example 2: send on closed channel

```
panic: send on closed channel

goroutine 893 [running]:
github.com/example/svc.(*Producer).produce(0xc000abcdef)
        /src/producer.go:42 +0x88
created by github.com/example/svc.NewProducer
        /src/producer.go:15 +0x55
```

Send is at producer.go:42. The producer goroutine was created by NewProducer at line 15.

Look at line 42. It's `p.out <- v`. Who closed `p.out`? Search for `close(.*\.out)`. Likely the Manager closed `p.out` when it shut down, but did not wait for the producer to exit first.

The fix: do not close `p.out` externally; let the producer close on its own when it exits. The Manager should signal via a done channel, not by closing the data channel.

### Example 3: goroutine dump shows hung close

Sometimes the problem is not a panic but a deadlock: the close has not happened, and someone is waiting for it.

```
goroutine 5 [chan receive, 60 minutes]:
main.consume(0xc000...)
        /src/consumer.go:23 +0x...
```

The consumer has been waiting on a channel receive for 60 minutes. Find the channel; find the producer; ask why the producer is not sending or closing.

Common cause: producer is stuck on a different channel that the consumer is supposed to read from but cannot, because it is waiting on the first channel. Circular dependency.

Send-side analogous: producer stuck on `chan send`, no consumer reading. Look at the consumer; why is it not consuming?

### Stack trace tools

- `go tool pprof goroutine.prof` — analyse a goroutine profile.
- `kill -SIGQUIT $PID` (or `kill -ABRT`) — dumps all goroutines on stderr.
- `runtime/pprof` HTTP endpoint at `/debug/pprof/goroutine?debug=2` — full stack of every goroutine.

Production binaries should expose `/debug/pprof/goroutine` (behind authorisation). When close-related deadlocks or panics are reported, fetch the goroutine dump and find the channel operation in question.

---

## Race Detector Output on Close Violations

Run with `-race`. When a close-violation occurs concurrently with another op, the detector logs:

```
==================
WARNING: DATA RACE
Write at 0x00c000123450 by goroutine 7:
  runtime.closechan()
      /usr/local/go/src/runtime/chan.go:357 +0x39
  main.cleanup()
      /home/user/example.go:42 +0x33

Previous read at 0x00c000123450 by goroutine 8:
  runtime.chansend()
      /usr/local/go/src/runtime/chan.go:160 +0x...
  main.producer()
      /home/user/example.go:25 +0x...

Goroutine 7 (running) created at:
  main.main()
      /home/user/example.go:78 +0x...

Goroutine 8 (running) created at:
  main.main()
      /home/user/example.go:82 +0x...
==================
```

Interpretation:

- Goroutine 7 (closer) wrote to the channel state at example.go:42.
- Goroutine 8 (sender) read the channel state at example.go:25.
- They overlapped — a data race.

In a few microseconds, one of them will probably trigger the "send on closed channel" panic. The race detector caught the cause before the panic surfaces.

Use this to find close bugs that have not yet manifested. Run `go test -race -count=10 -timeout=120s` against your packages regularly.

### Limitations

The race detector only finds races that actually happen during the test run. It cannot find races in code paths that the tests do not exercise. Code coverage of concurrent paths is the limiting factor.

For close violations specifically, the race detector finds:

- Send-on-closed if the send and close are concurrent.
- Write to a non-channel-internal field that should be protected.

It does not find:

- Double-close where both closes are sequential.
- Send-after-close where the close completes before the send (no overlap; still panics, but not a race).

For these, you need stress tests that drive the patterns under load.

---

## Production Incident Playbook

When a close-related panic hits production:

### 1. Confirm the panic

Check logs for `panic: close of closed channel`, `panic: send on closed channel`, or `panic: close of nil channel`.

### 2. Identify the goroutine

Find the line number in the stack trace. The first frame after the runtime is the user code that did the wrong thing.

### 3. Find the second site

For close-of-closed, two sites called `close(ch)`. Find both.

For send-on-closed, find every `close(ch)` and every `ch <- v`. The bug is at the intersection: close happened, then send, on a channel that should not have been closed yet.

### 4. Reconstruct the timeline

Did the close happen during a shutdown? At a specific point in handler logic? Check the request that triggered it. Logs around the panic may show the trigger.

### 5. Identify the design defect

Once you find the two sites, ask: why are both sites authorised to close (or send-after-close)? The design has a defect; identify it.

Common defects:

- Receiver closes the channel (Rule 4 violation).
- Multiple producers each `defer close(ch)`.
- Close in error path duplicates close in success path.
- A Close method called both by explicit invocation and by some other lifecycle hook.

### 6. Hotfix

If the bug is "two senders both close", add a coordinator goroutine. If it's "receiver closes", remove that close and use a done-channel. If it's "double-close", add sync.Once.

Deploy the hotfix; observe panic rate.

### 7. Root cause analysis

After stabilisation, write a post-mortem. The relevant questions:

- What was the design assumption that proved wrong?
- Why did tests not catch it? (Insufficient concurrency? No race detector?)
- What linter could have caught it?
- What documentation should change?

### 8. Preventive measures

- Add a unit test that reproduces the bug.
- Add stress tests with -race for the affected component.
- Add a linter or vet check for similar patterns.
- Update the team's close-pattern style guide.

---

## Kubernetes-Scale Shutdown Patterns

A service running on Kubernetes may be terminated at any time. The lifecycle:

1. **SIGTERM sent to PID 1.**
2. **Pod grace period begins** (default 30 seconds).
3. **Pod IP removed from service endpoints** (so new traffic does not arrive).
4. **Liveness/readiness probes can still hit the pod.**
5. **Container exits.** Either by graceful shutdown completing, or by SIGKILL after grace period.

Channels participate in step 2: the application processes the SIGTERM, signals shutdown, drains in-flight work, exits.

### Reading SIGTERM into a channel

```go
sigCh := make(chan os.Signal, 1)
signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
go func() {
    sig := <-sigCh
    log.Printf("received %v; shutting down", sig)
    shutdown()
}()
```

The signal handler is a small goroutine; it converts the signal into a shutdown call. The shutdown function does the rest.

### Signal handler must be idempotent

Two SIGTERMs (e.g., user impatient and runs `kill` twice) should not cause double shutdown:

```go
var shutdownOnce sync.Once
shutdown := func() {
    shutdownOnce.Do(func() { realShutdown() })
}
```

`sync.Once` ensures realShutdown runs at most once, regardless of how many signals fire.

### Grace period bounded close

If the application takes 60 seconds to drain but Kubernetes gives 30 seconds, the container will be SIGKILLed mid-drain. In-flight work is lost.

Options:

1. **Increase Kubernetes grace period.** `terminationGracePeriodSeconds: 60`.
2. **Shrink drain time.** Reduce buffer sizes; cancel slow operations early.
3. **Externalise the queue.** If work is in a durable queue (Kafka), drainage is the queue's problem, not the pod's. The pod just stops accepting new work and exits.

In production, option 3 is most common. The application never has more than a few seconds of in-flight work; the queue persists the rest.

### Pre-stop hook for graceful drain

Kubernetes supports a pre-stop lifecycle hook: a command (or HTTP call) runs before SIGTERM is sent. Use it to flip the readiness probe to "not ready" *before* the application is told to shut down. This gives the load balancer time to drop the pod from its rotation before traffic ceases.

```yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "/app/notify-shutdown; sleep 10"]
```

The 10-second sleep gives the load balancer time to converge. During this window, the application keeps serving but reports "not ready".

Channels are not involved in this step, but the overall protocol is the same: signal, drain, exit.

---

## Pod Termination and Channel Drain

For applications with significant in-flight work, the drain must be coordinated with Kubernetes.

### State machine

```
running → not-ready → draining → stopping → terminated
```

- **running:** healthy, accepting work.
- **not-ready:** readiness probe fails; new requests do not arrive; in-flight requests proceed.
- **draining:** new submissions rejected; in-flight work continues.
- **stopping:** all goroutines exit; channels close.
- **terminated:** process exits.

The transitions are driven by:

- running → not-ready: pre-stop hook (or explicit admin call).
- not-ready → draining: SIGTERM received.
- draining → stopping: in-flight work finished.
- stopping → terminated: cleanup complete.

Each transition is a state change; concurrent observers (handlers, workers) react to it.

### Implementation

```go
type ServiceState int32

const (
    StateRunning ServiceState = iota
    StateNotReady
    StateDraining
    StateStopping
    StateTerminated
)

type Service struct {
    state atomic.Int32
    done  chan struct{}
    once  sync.Once
}

func (s *Service) State() ServiceState {
    return ServiceState(s.state.Load())
}

func (s *Service) Ready() bool {
    return s.State() == StateRunning
}

func (s *Service) BeginNotReady() {
    s.state.CompareAndSwap(int32(StateRunning), int32(StateNotReady))
}

func (s *Service) BeginDrain() {
    s.state.CompareAndSwap(int32(StateNotReady), int32(StateDraining))
    s.state.CompareAndSwap(int32(StateRunning), int32(StateDraining))
    s.once.Do(func() { close(s.done) })
}
```

Readiness probe handler:

```go
func (s *Service) Health(w http.ResponseWriter, r *http.Request) {
    if s.Ready() {
        w.WriteHeader(200)
        return
    }
    w.WriteHeader(503)
}
```

Pre-stop endpoint:

```go
func (s *Service) PreStop(w http.ResponseWriter, r *http.Request) {
    s.BeginNotReady()
    w.WriteHeader(200)
}
```

Signal handler:

```go
sigCh := make(chan os.Signal, 1)
signal.Notify(sigCh, syscall.SIGTERM)
go func() {
    <-sigCh
    svc.BeginDrain()
}()
```

The svc.done channel closes once on BeginDrain. Workers and handlers observe it; they drain in-flight and exit.

---

## Signal Handling and Close Triggers

Signals (SIGTERM, SIGINT) trigger shutdown. The signal handler must convert them into a clean shutdown sequence.

### Best practice: only one shutdown initiator

The signal handler should be the *only* source of "start shutdown". Other code paths should request shutdown via the same channel:

```go
type App struct {
    shutdown chan struct{}
    once     sync.Once
}

func (a *App) Shutdown() {
    a.once.Do(func() { close(a.shutdown) })
}

// Signal handler:
go func() {
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
    <-sigCh
    a.Shutdown()
}()

// Admin endpoint:
http.HandleFunc("/admin/shutdown", func(w http.ResponseWriter, r *http.Request) {
    a.Shutdown()
})

// On fatal error:
func (a *App) onFatalError(err error) {
    log.Printf("fatal: %v", err)
    a.Shutdown()
}
```

All sources converge on `a.Shutdown()`, which is idempotent via sync.Once. The application sees one shutdown signal.

### Signal handler must not block

The signal handler should be tiny and non-blocking. If you do real work inside the handler, the signal delivery may queue (depending on the runtime), and the application may not respond promptly.

```go
// BAD: signal handler does real work
go func() {
    <-sigCh
    drainQueue() // takes minutes
    cleanupResources()
    os.Exit(0)
}()
```

Better:

```go
go func() {
    <-sigCh
    a.Shutdown() // returns immediately
}()

// Main goroutine waits for shutdown to complete.
<-a.done
drainQueue()
cleanupResources()
os.Exit(0)
```

The signal handler signals; the main goroutine does the work. This separation makes the signal handler robust.

### Handling SIGUSR1, SIGHUP for in-process reload

Some applications use SIGUSR1 or SIGHUP to trigger reload (re-read config, rotate logs). This is *not* shutdown; do not converge it with the shutdown channel.

```go
go func() {
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGUSR1)
    for range sigCh {
        a.Reload()
    }
}()
```

Reload uses its own mechanism. Shutdown is reserved for actual termination.

---

## Distributed Shutdown Coordination

In a distributed system, a node's shutdown is one event in a larger coordinated dance.

### Single-leader shutdown

If the cluster has a leader, the leader's shutdown initiates a re-election. New leader takes over. Old leader drains its in-flight work and exits.

The close coordination is local to the old leader: drain → close internal channels → exit. Coordination with the new leader is via external state (etcd, ZooKeeper, etc.), not via channels.

### Leaderless shutdown

A node going down notifies peers (e.g., via gossip). Peers stop routing requests to it. The node drains and exits.

Within the node, channels handle the drain. The "notify peers" step is a network operation, not a channel close.

### Centralised orchestrator

An orchestrator (Kubernetes, Nomad) decides when to terminate. The node receives a signal; the close protocol begins.

The orchestrator may impose a deadline. The node must complete shutdown within it or be forcibly killed.

### Implication for channel close patterns

Distributed coordination changes nothing about channel close inside a process. The close patterns are the same. What changes is:

- The signal that triggers shutdown.
- The deadline by which shutdown must complete.
- The acceptable level of data loss.

For most services, these are externally-imposed parameters. Design close protocols to respect them.

---

## Health Checks and Pre-Close Behaviour

Health checks (liveness, readiness) interact with close.

### Liveness probe during shutdown

Liveness probes ask "is the process alive?" If it fails, Kubernetes kills the pod.

During shutdown, the process is still alive (responding) but is in a transitional state. Should liveness still return 200?

Convention: yes. Liveness should fail only if the process is wedged. Shutdown is a controlled state; the process is responsive.

If liveness fails during shutdown, Kubernetes kills the pod, abandoning the drain. Bad.

### Readiness probe during shutdown

Readiness asks "should new traffic be routed here?" During shutdown, the answer is no.

```go
func ReadinessHandler(s *Service) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        if s.State() == StateRunning {
            w.WriteHeader(200)
        } else {
            w.WriteHeader(503)
        }
    }
}
```

Flipping readiness to fail is one of the earliest steps in shutdown. It causes Kubernetes to remove the pod from the service endpoints, draining traffic from the load balancer's perspective.

### Drift between readiness and in-flight work

If readiness fails at T=0 and the load balancer takes 5 seconds to converge, there are 5 seconds of new connections arriving even though we are not ready. These must still be handled.

The pre-stop hook can sleep for this period before SIGTERM:

```yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "wget -q -O- localhost:8080/notready; sleep 10"]
```

The application sees /notready (or similar), flips state, returns 200. Then sleeps 10 seconds. Then exits the pre-stop script, allowing Kubernetes to send SIGTERM.

During the 10-second window, the application keeps serving in-flight work but reports not-ready. The load balancer drains. After the window, SIGTERM triggers the actual shutdown.

This is the production-grade pattern. The channel close happens at SIGTERM, when traffic has already been drained externally.

---

## Backpressure and Close

When the consumer is slow, the producer's send blocks. Close interacts with backpressure.

### Backpressure absorbs short bursts

A buffered channel absorbs bursts: producer sends N items, buffer fills, producer blocks. Consumer catches up; producer unblocks.

Close during backpressure: producer is blocked on `ch <- v`. Close fires. Producer's send panics (send on closed).

To avoid this, the producer must select on a done channel:

```go
select {
case ch <- v: // succeeded
case <-done:  // cancellation
    return
}
```

Now under backpressure, if close fires, the producer sees done and returns. No panic.

### Backpressure across services

In a multi-service system, backpressure surfaces as latency. Service A calls B; B is slow; A waits. A's caller (C) waits on A. C's caller (D) waits.

If any of these times out, the timeout fires; the call returns an error. No close happens.

But: if the system is failing, you may want to start dropping load. Two strategies:

1. **Reject early.** Service A rejects requests if its queue is full. Caller gets an error, can retry against another instance.
2. **Tail drop.** Service A accepts requests but drops the oldest in its queue when new ones arrive. Maintains throughput but with random latency tails.

Neither involves channel close directly, but both interact with the channel-based queues at each service.

---

## Performance Cost of Safe-Close Patterns

The patterns we have discussed have measurable costs. Understanding the costs helps when deciding whether to apply them in hot paths.

### Cost of bare close

```go
close(ch)
```

About 50-100 nanoseconds for a channel with no waiters. Linear in number of waiters: each wakeup is 100-200 nanoseconds.

### Cost of sync.Once.Do

Uncontended fast path: one atomic load (~1 ns), one branch (~1 ns). Effectively free.

Contended slow path: mutex lock + function call (~100-500 ns). Runs only once in the channel's lifetime.

### Cost of done-channel select

```go
select {
case ch <- v:
case <-done:
}
```

About 100-300 nanoseconds, depending on which case wins. The select machinery has a fixed overhead for locking and polling.

### Cost of mutex+flag

```go
m.Lock()
if !closed {
    ch <- v
}
m.Unlock()
```

Lock: ~20 ns uncontended, much more contended. Plus the channel send. For a hot path with many senders, the mutex contention dominates.

### Comparison for a "hot send"

| Pattern              | Hot path cost |
|----------------------|---------------|
| Bare send            | ~50 ns        |
| Done-channel select  | ~100-300 ns   |
| Mutex + flag + send  | ~100 ns + contention |
| Atomic + done-channel| ~100-300 ns   |

For most production workloads, all of these are sub-microsecond and irrelevant compared to the work the goroutine does (database queries, RPC calls, etc.).

For ultra-hot paths (a million sends per second per CPU), profile. The done-channel pattern is usually within 10% of bare send.

---

## Lock-Free Idempotent Close

For the rare case where sync.Once is too expensive:

```go
type FastClose struct {
    done   chan struct{}
    closed atomic.Uint32
}

func New() *FastClose {
    return &FastClose{done: make(chan struct{})}
}

func (f *FastClose) Close() {
    if f.closed.CompareAndSwap(0, 1) {
        close(f.done)
    }
}

func (f *FastClose) Done() <-chan struct{} {
    return f.done
}
```

The CAS is a single x86 CMPXCHG instruction, about 5-10 nanoseconds. sync.Once is comparable on the fast path (it uses an atomic load + branch).

The real savings of pure-atomic over sync.Once: no allocation. sync.Once is two fields (uint32 + mutex); a manually managed atomic is one field (uint32). For data structures with many of these, the savings add up.

For most uses, prefer sync.Once for readability. Use the atomic version only when profiling shows it matters.

---

## Memory Model Implications

Go's memory model says:

> The closing of a channel happens before a receive that returns because the channel is closed.

This guarantees that any write the closer made before `close(ch)` is visible to a receiver after the close.

### Practical use

```go
var state Config

go func() {
    state = loadConfig()
    close(ready)
}()

<-ready
fmt.Println(state) // guaranteed to see loadConfig's value
```

The write to `state` is sequenced before the close. The receive observes the close. Therefore the receive observes the write.

This is the canonical "init-and-broadcast" pattern. Initialize, close ready, all observers see initialized state.

### Subtle case: writes after close

```go
go func() {
    close(ready)
    state = loadConfig() // ORDER WRONG
}()

<-ready
fmt.Println(state) // may NOT see loadConfig's value
```

The write is after the close. The memory model does not guarantee that observers of the close see writes that happened after it.

Always sequence writes *before* the close.

### Compositional close-ordering

If you close two channels in sequence:

```go
close(a)
close(b)
```

A receiver of `<-b` sees writes before `close(a)`, but not necessarily writes between `close(a)` and `close(b)`. The memory model relates a close to a receive of *that* channel; transitivity through closes is not guaranteed.

In practice, you rarely care; sequencing is implicit through program order in a single goroutine.

### Channel close and atomics

If you mix atomic operations with channel close:

```go
atomic.StoreInt32(&flag, 1)
close(done)
```

A receiver:

```go
<-done
v := atomic.LoadInt32(&flag) // sees 1?
```

Yes, the atomic store is sequenced before the close. The receiver sees the close, which is happens-after the store. By transitivity, the load sees the store.

The same logic applies to any happens-before relationship through close.

---

## Telemetry: Metrics, Logs, Traces

Production observability for close events.

### Metrics

Useful Prometheus metrics:

- `channel_send_total{name}` — count of sends.
- `channel_recv_total{name}` — count of receives.
- `channel_close_total{name}` — count of closes (should be 0 or 1 for most channels).
- `channel_occupancy{name}` — current buffer occupancy.
- `channel_send_latency_seconds{name}` — histogram of send wait time.
- `channel_recv_latency_seconds{name}` — histogram of receive wait time.

Track these for the top-level channels in your application. Buffer occupancy and send latency are particularly useful: rising occupancy indicates a slow consumer; rising send latency indicates backpressure.

### Logs

Log every close event with context:

```go
log.WithFields(log.Fields{
    "channel": name,
    "occupancy": len(ch),
    "capacity": cap(ch),
    "trigger": triggerSource,
}).Info("channel closing")
```

In post-mortems, these logs let you reconstruct the close sequence.

### Traces

Span every channel close as part of a shutdown trace:

```go
ctx, span := tracer.Start(ctx, "channel.close",
    trace.WithAttributes(
        attribute.String("name", "events"),
        attribute.Int("occupancy", len(ch)),
    ))
defer span.End()
close(ch)
```

In a shutdown trace, you see the order and timing of each close. A drain that's stuck on one channel is visible as a long span.

### Continuous profiling

Enable continuous profiling with goroutine, mutex, and block profiles. Look for:

- Goroutine count rising over time: channels not closing, goroutines leaking.
- Mutex contention on channel internals (hchan.lock): close storms or high-fanout broadcasts.
- Block profile entries on channel sends/receives: backpressure.

These point to close-related issues even when no panic has occurred.

---

## Chaos Engineering for Close

A practitioner technique: inject failures into close paths to verify the system handles them.

### Chaos test: random close mid-pipeline

```go
go func() {
    delay := time.Duration(rand.Intn(100)) * time.Millisecond
    time.Sleep(delay)
    pipeline.Cancel()
}()
```

Run the pipeline under random cancellations. If any run panics or hangs, you have a bug.

### Chaos test: slow consumer

```go
go func() {
    for v := range pipeline.Out() {
        time.Sleep(10 * time.Millisecond) // simulate slow
        _ = v
    }
}()
```

Pipeline must apply backpressure or drop without panicking on close.

### Chaos test: kill mid-drain

Send SIGKILL while shutdown is in progress (in a test). Restart. Verify no data corruption or duplicated work.

This tests the durability of your queues, not just the close protocol, but they are linked.

### Chaos test: concurrent close

Multiple shutdown triggers (admin endpoint, signal, lifecycle event) arrive simultaneously. The system must converge on a single shutdown.

```go
go func() { svc.Shutdown() }()
go func() { svc.Shutdown() }()
go func() { svc.Shutdown() }()
```

If any panics or hangs, sync.Once is missing or misused.

---

## Post-Incident Review Patterns

After a close-related production incident, a structured review.

### Timeline

- T+0: anomaly first detected (alert, customer complaint).
- T+x: paged engineer identifies the panic.
- T+y: hotfix deployed.
- T+z: stability confirmed.

Include the times for each step. Identify gaps (slow detection, slow diagnosis, slow fix).

### Five whys

- Why did the panic occur? (Send on closed channel.)
- Why was the channel closed while a sender was in flight? (Two paths reached close.)
- Why were two paths authorised to close? (Cleanup code in two places.)
- Why was that not caught in code review? (The two paths were in different files.)
- Why was that not caught in tests? (Tests do not exercise the concurrent close path.)

Each "why" points to a process improvement.

### Action items

- Add unit test that reproduces the panic.
- Add lint rule for "close in deferred cleanup".
- Update onboarding docs with the close-pattern style guide.
- Add stress tests for any module that exposes a Close method.

Make these concrete, assigned, and time-bound.

---

## Practical: Building a Production-Grade Close Library

Putting it all together: a reusable close-helper library.

```go
package closer

import (
    "context"
    "errors"
    "sync"
    "sync/atomic"
    "time"
)

var (
    ErrClosed   = errors.New("closer: already closed")
    ErrTimeout  = errors.New("closer: timeout")
)

// Closer is a reusable shutdown coordinator. It is safe to call Close
// from multiple goroutines; only the first triggers shutdown. Subsequent
// calls observe the existing shutdown.
type Closer struct {
    done   chan struct{}
    once   sync.Once
    fn     []func(context.Context) error
    timeout time.Duration

    closing atomic.Bool
    closed  atomic.Bool
    err     error
    errOnce sync.Once
}

// New returns a Closer that runs the given cleanup functions on Close.
// Functions are run in order; first error stops the chain.
func New(timeout time.Duration, fns ...func(context.Context) error) *Closer {
    return &Closer{
        done: make(chan struct{}),
        fn:   fns,
        timeout: timeout,
    }
}

// Closing returns true once Close has been called.
func (c *Closer) Closing() bool { return c.closing.Load() }

// Closed returns true once the shutdown is complete.
func (c *Closer) Closed() bool { return c.closed.Load() }

// Done returns a channel that is closed when shutdown completes.
func (c *Closer) Done() <-chan struct{} { return c.done }

// Err returns the first error from any cleanup function, or nil.
func (c *Closer) Err() error { return c.err }

// Close triggers shutdown. Multiple calls are safe; only the first runs
// cleanup. Returns when cleanup completes or the timeout elapses.
func (c *Closer) Close() error {
    c.once.Do(func() {
        c.closing.Store(true)
        ctx, cancel := context.WithTimeout(context.Background(), c.timeout)
        defer cancel()
        for _, fn := range c.fn {
            if err := fn(ctx); err != nil {
                c.errOnce.Do(func() { c.err = err })
                break
            }
        }
        c.closed.Store(true)
        close(c.done)
    })
    <-c.done
    return c.err
}
```

This is a small, focused library. It enforces:

- Single shutdown (sync.Once).
- Idempotent Close (returns same error every time).
- Bounded duration (timeout context).
- Observable state (Closing, Closed, Done, Err).

Use it as the basis for service-level shutdown.

---

## Closed Channel as Boolean

A neat idiom: a closed channel of `struct{}` is a boolean that flips once.

```go
type Latch struct {
    ch chan struct{}
}

func NewLatch() *Latch { return &Latch{ch: make(chan struct{})} }
func (l *Latch) Trigger() {
    // Safe-close
    select { case <-l.ch: default: close(l.ch) }
}
func (l *Latch) Wait() { <-l.ch }
func (l *Latch) Triggered() bool {
    select { case <-l.ch: return true; default: return false }
}
```

The `Trigger` has a race (two goroutines both pass `default`, both call `close`). Fix with sync.Once.

This is the basis of context.Context.Done() and many "one-shot" signals. A latch is a higher-level name for the pattern.

---

## When You Cannot Use Channels

Sometimes the close protocol is infeasible. Channels are not appropriate when:

- The number of waiters is huge (millions). Each waiter is a goroutine; the close storm is expensive.
- The signal must be observable without blocking (poll-only). Channels are designed for blocking observation.
- The signal must be reusable. Channels close once.

For these cases, use `sync.Cond`, `atomic.Bool`, or `eventfd`/`futex` (in cgo).

A reusable signal:

```go
type Reusable struct {
    mu   sync.Mutex
    cond *sync.Cond
    set  bool
}

func New() *Reusable {
    r := &Reusable{}
    r.cond = sync.NewCond(&r.mu)
    return r
}

func (r *Reusable) Set() {
    r.mu.Lock()
    r.set = true
    r.cond.Broadcast()
    r.mu.Unlock()
}

func (r *Reusable) Wait() {
    r.mu.Lock()
    for !r.set { r.cond.Wait() }
    r.mu.Unlock()
}

func (r *Reusable) Reset() {
    r.mu.Lock()
    r.set = false
    r.mu.Unlock()
}
```

Set and Reset can be called repeatedly. Broadcast wakes all waiters. No close needed; the cond is reusable.

The trade-off: cond is more code and less self-documenting than a channel. Use only when you need reusability or extreme fanout.

---

## Cross-Cutting Concerns: Observability and Close

A service's observability infrastructure (metrics, logs, traces) often outlives the service's primary workload. Shutdown should not stop observability prematurely.

Order of shutdown:

1. Stop accepting new work.
2. Drain in-flight work, emitting telemetry as usual.
3. Flush telemetry buffers (metrics push, log flush, trace flush).
4. Close telemetry connections.
5. Exit.

If you close telemetry first, you lose visibility into the rest of shutdown. Bugs in shutdown become invisible.

The close protocol must respect this order. Telemetry is one of the *last* things to shut down, not one of the first.

---

## Network Service Close

A network service has:

- A listener accepting connections.
- Per-connection goroutines.
- Per-connection channels for request/response.
- Shared resources (DB pool, cache).

Shutdown order:

1. Close listener (no new connections).
2. Signal per-connection goroutines to drain (close per-connection done channel).
3. Wait for per-connection goroutines to exit.
4. Close shared resources.
5. Exit.

Implementing step 2: each connection goroutine holds a reference to a global done channel. When done closes, the goroutine wraps up its current request and exits.

```go
func handleConn(c net.Conn, done <-chan struct{}) {
    defer c.Close()
    for {
        select {
        case <-done:
            return
        default:
        }
        c.SetReadDeadline(time.Now().Add(time.Second))
        req, err := readRequest(c)
        if err != nil {
            if isTimeout(err) { continue }
            return
        }
        resp := handleRequest(req)
        if err := writeResponse(c, resp); err != nil {
            return
        }
    }
}
```

The connection goroutine polls done on each iteration; the read deadline ensures it returns to the poll every second even if the client is idle.

This is the pattern of the standard library's http.Server.Shutdown.

---

## Workers, Producers, and Consumers: A Unified View

A unified mental model: any goroutine is either a producer, a consumer, or both. Each has close obligations.

- **Producer:** sends to a channel. May close it when done. Must observe cancellation.
- **Consumer:** receives from a channel. Detects close via range or comma-ok. May trigger cancellation.
- **Worker:** both producer (to its output) and consumer (from its input).

For each goroutine in your system:

- Identify whether it is producer, consumer, or worker.
- Identify the channels it interacts with.
- For each channel, identify its closer.
- For each channel send, ensure cancellation is observable.
- For each channel receive, ensure close is handled (range exits, comma-ok checked).

This is a code-review checklist for any concurrent module.

---

## Real-World Pattern: HTTP Server Graceful Shutdown

The standard library's `http.Server.Shutdown` is a reference implementation worth studying.

```go
// (Simplified from net/http)
func (s *Server) Shutdown(ctx context.Context) error {
    s.inShutdown.Store(true)
    err := s.closeListenersLocked()
    s.closeDoneChanLocked()
    for _, cancel := range s.onShutdown {
        go cancel()
    }
    pollInterval := 500 * time.Millisecond
    timer := time.NewTimer(pollInterval)
    defer timer.Stop()
    for {
        if s.closeIdleConns() && s.numListeners() == 0 {
            return err
        }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-timer.C:
            timer.Reset(pollInterval)
        }
    }
}
```

Key insights:

1. Listeners are closed first (no new connections).
2. The done channel is closed (signals existing connections).
3. Polling loop: every 500ms, check if all idle connections are closed.
4. Polls until done or until ctx times out.

The polling is unusual — most patterns use channel-based wait. The reason: HTTP connections are kept alive between requests; "idle" status changes as requests complete. There's no single channel that signals "all connections are idle". A polling loop is the cleanest implementation.

For your own code, prefer channel-based waits when possible. Polling is appropriate when the state being observed is not channel-driven.

---

## Test Infrastructure for Close

Production-grade testing of close behaviour.

### Goleak

`go.uber.org/goleak` checks for goroutine leaks at test exit. If your code leaks goroutines, the test fails:

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

Or per-test:

```go
func TestSomething(t *testing.T) {
    defer goleak.VerifyNone(t)
    // ... test ...
}
```

After the test body, goleak counts active goroutines. If any are from your code, the test fails. This catches missing closes that leak consumer goroutines.

### Tests with -race

Always run `go test -race`. The race detector catches concurrent close/send races.

### Stress tests with -count

`go test -count=100 -race` runs the test 100 times. Flaky concurrent bugs surface.

### Timeout for hung tests

`go test -timeout=10s` kills tests that hang. A test hanging often means a missing close.

### Hot-spot stress

For modules with many concurrent operations, write a stress test:

```go
func TestStress(t *testing.T) {
    p := pool.New(10, 100)
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            _ = p.Submit(&jobImpl{id: i})
        }(i)
    }
    time.AfterFunc(100*time.Millisecond, func() {
        _ = p.Shutdown(context.Background())
    })
    wg.Wait()
}
```

Run with `-race -count=10`. Bugs surface.

---

## Long-Running Service Templates

A template for a typical long-running Go service.

```go
package main

import (
    "context"
    "log"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"
)

type App struct {
    server *http.Server
    db     *DB
    pool   *Pool
}

func main() {
    app, err := setup()
    if err != nil { log.Fatal(err) }
    if err := app.Run(); err != nil { log.Fatal(err) }
}

func (a *App) Run() error {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    errCh := make(chan error, 1)
    go func() {
        if err := a.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            errCh <- err
        }
    }()

    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)

    select {
    case sig := <-sigCh:
        log.Printf("received %v", sig)
    case err := <-errCh:
        log.Printf("server error: %v", err)
    case <-ctx.Done():
    }

    return a.shutdown(30 * time.Second)
}

func (a *App) shutdown(timeout time.Duration) error {
    ctx, cancel := context.WithTimeout(context.Background(), timeout)
    defer cancel()

    log.Println("shutting down server")
    if err := a.server.Shutdown(ctx); err != nil {
        log.Printf("server shutdown: %v", err)
    }

    log.Println("shutting down worker pool")
    if err := a.pool.Shutdown(ctx); err != nil {
        log.Printf("pool shutdown: %v", err)
    }

    log.Println("closing database")
    if err := a.db.Close(); err != nil {
        log.Printf("db close: %v", err)
    }

    log.Println("shutdown complete")
    return nil
}
```

This is the template for most Go services. Adapt to taste.

Note the order: server first (stop accepting), pool (drain workers), database (release connections). Reverse of dependencies.

---

## Recovery and Restart

After a panic or other failure, the process should exit and let the orchestrator restart it. Do not try to recover into normal operation.

The exception: per-request panics in HTTP handlers should be recovered (otherwise one bad request crashes the entire server). The standard library's `http.Server` does this by default.

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("panic in handler: %v\n%s", r, debug.Stack())
        http.Error(w, "internal error", 500)
    }
}()
```

For internal goroutines (workers, background tasks), recover with care:

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("panic in worker: %v\n%s", r, debug.Stack())
        // do not recover into normal operation; restart the goroutine if appropriate
    }
}()
```

Whether to restart depends on the failure mode. A panic from a known-stuck condition can be retried; a panic from data corruption should propagate to the process level.

---

## Best Practices Summary

A condensed guide for production code:

1. **Document every channel's close behaviour.** Who closes, when, with what guarantees.
2. **Use direction types at API boundaries.** `<-chan T` for receive-only, `chan<- T` for send-only.
3. **One closer per channel.** Use sync.Once or coordinator goroutines to enforce.
4. **Never close from a receiver.** It is always the sender's (or coordinator's) responsibility.
5. **Combine close with context.** Close for natural-end; context for abort.
6. **Test idempotency.** Multiple Close calls should be safe.
7. **Test cancellation.** Verify shutdown completes within SLO under load.
8. **Run with -race.** Catch concurrent close/send races early.
9. **Instrument production.** Metrics on send latency, occupancy, close events.
10. **Plan for failure.** Goroutine leaks, deadlocks, panic-on-shutdown should be detectable from telemetry.

A team that follows these has dramatically fewer close-related production incidents.

---

## Self-Assessment

By the end of this file, you should be able to:

1. Read a panic stack trace and identify the two code paths responsible for a close-violation.
2. Design a graceful shutdown protocol for a service running in Kubernetes.
3. Implement a worker pool with idempotent shutdown, drain semantics, and panic recovery.
4. Explain the runtime mechanics of `close(ch)` including the lock, the wakeup list, and the closed flag.
5. Choose between sync.Once, atomic.CAS, and mutex-based idempotent close.
6. Instrument channel operations with Prometheus metrics for capacity planning.
7. Use the race detector to find concurrent close violations.
8. Coordinate shutdown across service dependencies (database, queue, HTTP handlers).
9. Apply the memory model guarantees of close to design init-and-broadcast patterns.
10. Run chaos tests to verify close-protocol robustness under random cancellation.

If you can do all ten in a code review, you operate at the professional level.

---

## Summary

Professional close handling is about operating systems in production:

- Shutdown protocols cascade through services in a defined order.
- Drains have time budgets; exceeding them means data loss or kill.
- Observability of channel state is required for capacity planning and incident response.
- Patterns scale: errgroup for finite work, worker pools for indefinite work, sync.Once for idempotent close.
- The runtime mechanics matter: close is a locked operation that wakes N goroutines, panics on send-on-closed, returns zero-value on receive-from-closed.
- Post-incident reviews drive lasting fixes: tests, lints, docs.

A production-grade close protocol is invisible: users do not notice shutdowns; teams do not get paged at 3 AM; data is not lost. The work goes into the design so that operation is boring.

Channel close violations are among the most preventable categories of bugs in Go. The patterns are well-known, the tools are mature, the discipline is teachable. Apply consistently, review rigorously, and your services will outlast their authors.

---

## Appendix A: The Close Operation Inside the Scheduler

A deeper dive into how the Go scheduler interacts with `close(ch)`.

When `close` wakes up a blocked goroutine, the wakeup is via `goready`. This places the goroutine on a runqueue; it does not immediately resume execution. The actual resumption depends on the scheduler's decisions:

- If the current goroutine yields (e.g., another channel operation, function call to a runtime function), the runtime may pick the newly-readied goroutine.
- If a P (processor) is idle, the newly-readied goroutine may be stolen by that P.
- If no P is available, the goroutine sits on the runqueue until one is.

For close, this means: a closer of a channel with N waiters places N goroutines on runqueues. The closer continues; the waiters resume "soon" but not synchronously.

The implication for close: after `close(ch)`, do not assume any waiter has yet observed the close. They may be moments behind.

### When close-then-something must wait

Sometimes you close and then must wait for observers to act:

```go
close(done)
wg.Wait()
```

The `wg.Wait` is the synchronisation. Each waiter calls `wg.Done` when it observes `done` closing. The `wg.Wait` blocks until all have done so. The close itself is non-blocking; the wait is the synchronisation point.

This is the standard "broadcast and join" pattern. Close is the broadcast; Wait is the join.

### Avoiding starvation

If the closer immediately re-enters a hot loop after close, the waiters may not get a chance to run. Use `runtime.Gosched()` or actually wait for them via a WaitGroup.

In practice, the scheduler is fair enough that hot-loop-after-close is not a real concern. But under load with limited cores, it can be observed.

---

## Appendix B: Reader-Writer Mutex Alternative to Channel Close

For some "broadcast on event" patterns, a `sync.RWMutex` can replace channel close.

```go
type Latch struct {
    mu      sync.RWMutex
    set     bool
}

func (l *Latch) Set() {
    l.mu.Lock()
    l.set = true
    l.mu.Unlock()
}

func (l *Latch) Wait() {
    l.mu.RLock()
    for !l.set {
        l.mu.RUnlock()
        // bad: busy-wait
        runtime.Gosched()
        l.mu.RLock()
    }
    l.mu.RUnlock()
}
```

This is bad: Wait is a busy-wait. Use `sync.Cond` for proper waiting:

```go
type Latch struct {
    mu   sync.Mutex
    cond *sync.Cond
    set  bool
}

func New() *Latch {
    l := &Latch{}
    l.cond = sync.NewCond(&l.mu)
    return l
}

func (l *Latch) Set() {
    l.mu.Lock()
    l.set = true
    l.cond.Broadcast()
    l.mu.Unlock()
}

func (l *Latch) Wait() {
    l.mu.Lock()
    for !l.set { l.cond.Wait() }
    l.mu.Unlock()
}
```

Channel-close version is simpler:

```go
type Latch struct {
    ch chan struct{}
    once sync.Once
}

func New() *Latch { return &Latch{ch: make(chan struct{})} }
func (l *Latch) Set() { l.once.Do(func() { close(l.ch) }) }
func (l *Latch) Wait() { <-l.ch }
```

Both implement the same latch. The channel version is shorter, idiomatic, and uses well-tested runtime primitives. Prefer it.

The cond version is appropriate when you need *reusable* signalling (a latch that can be unset). The channel cannot be reopened.

---

## Appendix C: Implementing context.WithCancel Yourself

To deeply understand close, implement a stripped-down `context.WithCancel`.

```go
type myCtx struct {
    mu       sync.Mutex
    done     chan struct{}
    err      error
    children map[*myCtx]struct{}
    parent   *myCtx
    cancelOnce sync.Once
}

func newCtx(parent *myCtx) *myCtx {
    c := &myCtx{
        done:     make(chan struct{}),
        children: make(map[*myCtx]struct{}),
        parent:   parent,
    }
    if parent != nil {
        parent.addChild(c)
    }
    return c
}

func (c *myCtx) Done() <-chan struct{} { return c.done }

func (c *myCtx) Err() error {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.err
}

func (c *myCtx) Cancel(err error) {
    c.cancelOnce.Do(func() {
        c.mu.Lock()
        c.err = err
        children := c.children
        c.children = nil
        c.mu.Unlock()
        close(c.done)
        for child := range children {
            child.Cancel(err)
        }
        if c.parent != nil {
            c.parent.removeChild(c)
        }
    })
}

func (c *myCtx) addChild(child *myCtx) {
    c.mu.Lock()
    if c.children != nil {
        c.children[child] = struct{}{}
    }
    c.mu.Unlock()
}

func (c *myCtx) removeChild(child *myCtx) {
    c.mu.Lock()
    delete(c.children, child)
    c.mu.Unlock()
}
```

Properties:

- `Cancel` is idempotent (sync.Once).
- Cancel propagates to children synchronously (recursive).
- `done` is closed exactly once per context.
- The mutex protects the children map and err.

The real `context.WithCancel` is similar but handles more cases (timer-based, value-based, parent-cancel propagation via a goroutine for non-Context parents).

Studying this helps internalise the close-as-broadcast pattern.

---

## Appendix D: Comparing Close-Based and Mutex-Based Coordination

For a single team-level summary:

| Scenario | Close-based | Mutex-based |
|----------|-------------|-------------|
| One-shot signal | Channel close (sync.Once) | sync.Once + cond.Broadcast |
| Reusable signal | Cannot (rotate channels) | sync.Cond |
| State query | Comma-ok (destructive) | Atomic load + flag |
| Cancellation propagation | Context (native) | Cascading method calls |
| Memory model | Happens-before via channel | Happens-before via mutex |
| Multi-waiter wake | O(N) under channel lock | O(N) under mutex |
| Code length | Short | Longer (explicit lock-cond-flag) |
| Debugging | Stack traces show channel | Stack traces show mutex |

For most cases in Go, close-based is preferred. Mutex-based is appropriate for reusable signals and for cases where the state being observed is richer than a boolean.

---

## Appendix E: Close in Memory-Constrained Environments

For ultra-memory-constrained systems (embedded, edge devices):

- Each channel has a few hundred bytes of overhead (hchan struct + lock + queues).
- Each blocked goroutine on a channel costs ~2KB for its stack.
- Close itself does not allocate (the wake list is on the goroutine's stack).

For systems with thousands of channels, this overhead adds up. Consider:

- Fewer channels with shared use (one channel feeding many workers).
- Atomic flags for one-shot signals.
- sync.Cond for richer coordination.

For server-class hardware (8GB+), this is irrelevant. For edge (4MB-1GB), it matters.

---

## Production Cases by Industry

A short tour of how different industries handle close in their Go infrastructure.

### Financial: zero data loss

Trading systems cannot drop messages. Shutdown is graceful with infinite drain time (in practice, bounded by the trading day). Close is preceded by:

1. Stop accepting new orders.
2. Acknowledge all pending orders (responses to clients).
3. Flush all logs to durable storage.
4. Close internal channels in order: orderbook → matcher → publisher.
5. Exit.

Each step is bounded by SLAs (e.g., "all in-flight orders must respond within 100ms"). If a step exceeds, the system is in distress; pager fires.

### Big data: best-effort drain

A batch processing pipeline can tolerate some data loss. On shutdown:

1. Stop reading from input (Kafka offset commit).
2. Drain current batch through the pipeline.
3. Write checkpoint to durable storage.
4. Close all channels.
5. Exit.

If shutdown takes too long, abandon the current batch. The next process picks up from the last checkpoint. Data is replayed but not lost.

### Real-time: best-effort response

A real-time API service drops in-flight requests on shutdown:

1. Stop accepting connections.
2. Cancel context for in-flight requests; they return error.
3. Close internal channels.
4. Exit.

Clients retry; the load balancer routes to other instances. Brief blip in latency.

### IoT: lossy but persistent

Edge devices have spotty connectivity. On shutdown:

1. Persist in-flight messages to local disk.
2. Close internal channels.
3. Exit.

On restart, replay from disk. Lossy if the disk dies; otherwise reliable.

These patterns share the same close primitives but differ in tolerance for drop, drain time, and durability guarantees.

---

## Profiling Close Performance

`go tool pprof` analyses CPU and memory profiles. For close issues:

### CPU profile

If close is hot in the CPU profile, you have:

- Frequent channel creation-and-close (allocation churn).
- Close storms with many waiters.
- Inefficient close patterns (mutex contention, repeated select).

Investigate the call sites; replace with sync.Once + done-channel or reuse channels via lifetime extension.

### Mutex profile

Enable with `runtime.SetMutexProfileFraction(1)`. Look for contention on `runtime.chansend`, `runtime.chanrecv`, or `runtime.closechan`. Heavy contention suggests channel hot-spots that should be sharded.

### Block profile

Enable with `runtime.SetBlockProfileRate(1)`. Shows goroutines blocked on channels. Long blocks suggest backpressure or deadlocks.

Look for blocks on channel send (slow consumer) or channel receive (slow producer).

### Goroutine profile

`pprof.Lookup("goroutine")` lists all goroutines. Group by state and stack. A large group blocked on the same channel operation is a smell.

### Combining profiles

Use multiple profiles together. CPU + mutex = where time is spent and on what. CPU + block = where time is spent vs where goroutines are stuck. CPU + goroutine = where time is spent vs how many goroutines are there.

The skill is interpreting profiles together to find the systemic issue, not the single hot line.

---

## Migrating Legacy Code to Safe Close

A legacy codebase may have many close violations. A migration plan:

### Phase 1: catalogue

Grep for `close(` and `defer close(`. Categorise each:

- Single-sender single-closer (safe).
- Multi-sender with explicit coordinator (safe).
- Multi-sender with `defer close` (broken).
- Receiver-side close (broken).
- Defensive close-with-recover (smell).

### Phase 2: triage

Prioritise by:

- Production impact: has this caused incidents?
- Test coverage: do existing tests exercise it?
- Code complexity: how hard is the fix?

Fix the broken ones first, sorted by impact.

### Phase 3: refactor

For each broken site:

1. Identify the channel and all its senders.
2. Pick a safe pattern (coordinator, sync.Once, done-channel).
3. Implement the fix.
4. Add a test that would have caught the original bug.
5. Run -race tests.
6. Deploy.

Do this incrementally; do not try to rewrite the whole system at once.

### Phase 4: prevention

After all known issues are fixed:

- Add linter rules (golangci-lint, custom vet checks).
- Update style guide.
- Add a "close discipline" section to code-review checklist.
- Train new hires.

Migration is months of work for a large codebase. The payoff: a class of production incidents disappears.

---

## Long Tail of Close Issues

After the bulk of close violations are fixed, the long tail remains:

### Issue: close in third-party callbacks

```go
lib.OnEvent(func(e Event) {
    select { case eventCh <- e: case <-done: }
})
```

The callback runs in the library's goroutine. If the library closes its own channel and the callback tries to send to our channel, our send may panic on closed `eventCh`.

Solution: never close `eventCh`. Use `done` for cancellation; let `eventCh` GC.

### Issue: close on test cleanup

```go
func TestSomething(t *testing.T) {
    p := pool.New(...)
    t.Cleanup(func() { p.Shutdown(context.Background()) })
    // ... test ...
}
```

If the test causes the pool to panic mid-test, Cleanup runs Shutdown on a panicked pool. May or may not handle correctly. Test the pool's behaviour with explicit error injection.

### Issue: close in init

```go
func init() {
    eventCh = make(chan Event)
    go background()
}
```

Init runs once per program. The channel is process-wide. There's no exit hook; the channel is never closed. Usually fine (process exit reclaims memory), but if you need finalisation, use a singleton struct with a Close method called from main's defer.

### Issue: close in finalizer

```go
runtime.SetFinalizer(obj, func(o *T) { close(o.ch) })
```

Finalizers run during GC. The timing is unpredictable; the channel may be closed long after the last user of the struct. Avoid. Use explicit Close instead.

---

## Specific Library Pitfalls

A short tour of close-related pitfalls in popular Go libraries.

### context: never close ctx.Done() directly

`ctx.Done()` returns a `<-chan struct{}`. The receive-only direction prevents you from closing it. Good. Some user code casts to `chan struct{}`:

```go
done := ctx.Done().(chan struct{}) // BAD
close(done) // breaks context
```

Don't. The context's cancel function is the only safe way to close.

### sync.WaitGroup: do not Add after Wait

```go
var wg sync.WaitGroup
wg.Add(1)
go func() { wg.Done() }()
wg.Wait()
wg.Add(1) // BAD: behaviour undefined
```

WaitGroup state is sticky; reuse is undefined. Always Add before any Wait.

### golang.org/x/sync/errgroup: be careful with deadlock

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error {
    return helper(ctx)
})
// errgroup is one-shot; do not reuse after Wait.
```

After `g.Wait()`, the errgroup is done. Do not add more goroutines to it. Create a new errgroup.

### net/http: handler panics are recovered

The standard server recovers handler panics. Your custom code is responsible for the same.

### grpc-go: stream close ordering

gRPC streams have close semantics. The server's `Send` after the stream is closed returns an error (not panic). The client's `Recv` returns `io.EOF` on close.

If you wrap gRPC streams in channels, mirror the semantics: never close the channel from the server-side; let the goroutine exit naturally.

---

## Operational Runbook

A runbook for operations engineers responding to close-related issues.

### Symptom: panic "close of closed channel"

1. Get stack trace from logs.
2. Identify the two code paths reaching `close`.
3. Hotfix: add `sync.Once` wrapping the close.
4. Long-term: identify the underlying design defect (shared close authority).

### Symptom: panic "send on closed channel"

1. Get stack trace.
2. Find the closer; find the sender.
3. Hotfix: gate the send with a done-channel select.
4. Long-term: identify why the close was authorized while sender was live.

### Symptom: shutdown taking too long

1. Take a goroutine dump (kill -SIGABRT).
2. Find goroutines stuck on channel operations.
3. Identify which channels they are stuck on.
4. Find the producer/closer; why is it not closing?
5. Hotfix: increase the timeout, or force-close stuck channels.
6. Long-term: identify the slow operation; reduce its time bound.

### Symptom: rising goroutine count over time

1. Compare goroutine count at startup vs current.
2. Take goroutine profiles at intervals.
3. Identify the goroutines that are accumulating.
4. Trace them to their channels; identify the leak.
5. Hotfix: add explicit close or context cancellation.
6. Long-term: refactor to bounded goroutine lifetimes.

### Symptom: occasional message loss

1. Confirm message loss via durable logs.
2. Identify which channel the message went through.
3. Check for `select default` arms that drop on backpressure.
4. Check for context cancellation during in-flight processing.
5. Hotfix: increase buffer, remove drops.
6. Long-term: introduce backpressure or durable queues.

---

## Capacity Planning for Channel-Heavy Systems

Channels have measurable resource costs.

### Memory

Each channel: ~120 bytes (hchan + buf pointer + lock).
Each buffered slot: `cap(ch) * sizeof(elem)`.
Each blocked goroutine: ~2KB stack.

For a service with 10,000 channels each with 100-buffer of 64-byte elements: 10000 * (120 + 100*64) = 64MB. Plus blocked goroutines.

### CPU

Each send/recv: ~50-200 ns under low contention. Under contention (many goroutines, one channel), 10x worse.

For a service doing 100,000 channel ops/sec: ~10ms/sec of CPU. Sub-1% overhead.

### Scheduler load

Each blocked goroutine occupies a P slot when readied. High fanout closes can stall the scheduler briefly.

For closes with thousands of waiters, the close itself is ~1ms. Plan accordingly: avoid holding critical locks across high-fanout closes.

### Tuning advice

- Buffer sizes: small (4-32) unless burst absorption is required. Large buffers hide design issues.
- Number of channels: many small > few large. Sharding by tenant or request reduces contention.
- Close cadence: minimise. Reuse channels for the channel's lifetime; do not create-and-close per request.
- Worker counts: pin to GOMAXPROCS or slightly more, depending on I/O vs CPU mix.

---

## A Note on Style

Go's close idioms are mature. Style guides converge on:

- `defer close(ch)` in the producer goroutine.
- Coordinator goroutine for multi-sender.
- `sync.Once` for idempotent Close methods.
- `<-chan T` and `chan<- T` at API boundaries.
- Context for cancellation; close for natural-end.

If you find yourself fighting these idioms, step back. The pattern that fits is probably one of the four canonical ones; you do not need a sixth.

When in doubt, copy from the standard library. `net/http`, `database/sql`, `context`, `golang.org/x/sync/errgroup` are all well-designed references.

---

## Cross-Cutting: Close and Error Handling

Errors complicate close. The patterns to know:

### Error from producer

```go
func produce() (<-chan Item, <-chan error) {
    items := make(chan Item)
    errs := make(chan error, 1)
    go func() {
        defer close(items)
        defer close(errs)
        for {
            it, err := next()
            if err != nil {
                errs <- err
                return
            }
            items <- it
        }
    }()
    return items, errs
}
```

Two channels: data and error. Consumer ranges over data; checks error after data closes.

### Error embedded in data

```go
type Result struct {
    Item Item
    Err  error
}

func produce() <-chan Result {
    out := make(chan Result)
    go func() {
        defer close(out)
        for {
            it, err := next()
            if err != nil {
                out <- Result{Err: err}
                return
            }
            out <- Result{Item: it}
        }
    }()
    return out
}
```

One channel; consumer ranges and checks `r.Err`.

### Error via errgroup

```go
g, ctx := errgroup.WithContext(parent)
out := make(chan Item)
g.Go(func() error {
    defer close(out)
    for {
        if err := next(ctx, out); err != nil { return err }
    }
})
```

The errgroup collects the error. Context cancels on first error.

Pick based on: number of producers, whether errors are recoverable, complexity of the consumer.

---

## Channel Close in Iterators (Go 1.23+)

Go 1.23 added range-over-func iterators. Channel-based iterators have specific close patterns.

```go
func ChEvents(ctx context.Context) iter.Seq[Event] {
    return func(yield func(Event) bool) {
        ch := startEventSource(ctx)
        for ev := range ch {
            if !yield(ev) { return }
        }
    }
}

// Caller:
for ev := range ChEvents(ctx) {
    if shouldStop(ev) { break }
    process(ev)
}
```

When the caller breaks, `yield` returns false; the iterator returns; deferred resources clean up.

But: the event source goroutine inside `startEventSource` may still be running. Cancellation must propagate. Use a child context:

```go
func ChEvents(parent context.Context) iter.Seq[Event] {
    return func(yield func(Event) bool) {
        ctx, cancel := context.WithCancel(parent)
        defer cancel()
        ch := startEventSource(ctx)
        for ev := range ch {
            if !yield(ev) { return }
        }
    }
}
```

The deferred cancel fires when yield returns false; `startEventSource` sees the cancellation and exits. The source's deferred close on `ch` fires; the range completes.

This is the iterator+channel pattern. Note that without the child context, the source goroutine leaks.

---

## Closing Time-Based Channels

`time.After` and `time.NewTimer` return channels. Closing them is *not* allowed (they are owned by the runtime).

```go
ch := time.After(time.Second)
// ... use ch ...
// DO NOT close(ch)
```

The runtime's timer machinery sends to the channel when the timer expires. The channel is GC'd when references drop.

For early termination of a timer:

```go
t := time.NewTimer(time.Second)
// ...
if !t.Stop() {
    // Drain the channel if Stop returned false
    <-t.C
}
```

`Stop` returns true if the timer was stopped before firing. If false, the timer already fired (or is firing); drain the channel to avoid a leftover value.

For repeating timers (`time.NewTicker`), similar:

```go
ticker := time.NewTicker(time.Second)
defer ticker.Stop()
for range ticker.C {
    // ...
}
```

`ticker.Stop()` does not close `ticker.C`. The channel is left open. Subsequent receives block forever. Use a separate done-channel to break the loop:

```go
ticker := time.NewTicker(time.Second)
defer ticker.Stop()
for {
    select {
    case <-ticker.C:
        // tick
    case <-done:
        return
    }
}
```

The `ticker.C` is owned by the runtime; treat it as receive-only forever.

---

## High-Performance Close: When Microseconds Matter

For systems where every microsecond counts:

### Inline atomic CAS

Replace sync.Once with a CAS on an atomic.Uint32. Saves a few ns on uncontended fast path.

### Avoid channel allocation per request

If a "done" channel is allocated per request, the allocations add up. Reuse via a pool (carefully — pooled channels cannot be closed).

Better: use a process-wide done-channel for all requests, derived from context:

```go
func handle(ctx context.Context) {
    select {
    case <-ctx.Done(): return
    case result := <-doWork(ctx):
        process(result)
    }
}
```

The ctx.Done() is allocated once when WithCancel is called. Each handle call shares it.

### Avoid select if not needed

A direct send is faster than a select with one case:

```go
ch <- v // ~50 ns
select { case ch <- v: } // ~100 ns
```

The select has fixed overhead. If you don't need cancellation, drop it.

But the safety of cancellation is usually worth the 50ns. Profile before optimising.

### Batch close-induced wakeups

If you have many channels each with one waiter, closing each one wakes the runtime once per close. For thousands of channels, this is thousands of wakeups.

Instead, share a single done channel across all waiters:

```go
type Group struct {
    done chan struct{}
    once sync.Once
}
func (g *Group) Wait() <-chan struct{} { return g.done }
func (g *Group) Close() { g.once.Do(func() { close(g.done) }) }
```

One close, N waiters, one wakeup storm. Same total work as N closes, but fewer lock acquisitions.

For most workloads, this is not measurable. For extreme fanout, it matters.

---

## Wrap-Up: The Professional's Close Checklist

Before shipping any module that creates channels:

- [ ] Every channel's owner (closer) is documented.
- [ ] Every channel's direction at API boundaries is `<-chan T` or `chan<- T`, not `chan T`.
- [ ] Every Close method is idempotent (sync.Once or equivalent).
- [ ] Every send is gated by a select with done-channel or context cancellation.
- [ ] Every receive uses `range`, `comma-ok`, or select-with-default.
- [ ] Every long-running goroutine has a defined exit path.
- [ ] Every shutdown protocol has a documented time bound.
- [ ] Every channel operation is testable under `-race` with stress.
- [ ] Every panic-prone path has either prevention or recover with logging.
- [ ] Every telemetry instrument captures close events.

If you can check all ten, your module is production-ready for close handling.

---

## Detailed Close Trace: A Service Shutdown Step by Step

To make this concrete, walk through a single service shutdown event by event.

### t=0: SIGTERM received

Signal handler goroutine wakes up:

```go
go func() {
    sig := <-sigCh
    log.Printf("received %v", sig)
    app.Shutdown()
}()
```

The sigCh receive unblocks. log.Printf writes. Then app.Shutdown() is called.

### t=1ms: app.Shutdown begins

```go
func (a *App) Shutdown() {
    a.once.Do(func() {
        close(a.done)
        a.cancel()
    })
}
```

sync.Once.Do runs the function. close(a.done) wakes up every goroutine selecting on a.done. a.cancel() cancels the application context, propagating to every context-aware goroutine.

The Shutdown function returns immediately (does not wait for goroutines).

### t=2ms: HTTP server detects shutdown

The HTTP server's accept loop selects on its internal done:

```go
for {
    select {
    case <-srv.done: return
    case conn := <-acceptCh: handle(conn)
    }
}
```

It detects the close, returns. defer close(acceptCh) fires (if applicable). The listener is closed.

### t=3ms: in-flight handlers observe ctx.Done

Each handler:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    select {
    case <-r.Context().Done():
        http.Error(w, "shutting down", 503)
        return
    case result := <-doWork(r.Context()):
        // ...
    }
}
```

Most handlers complete; those in-flight see ctx.Done and return early.

### t=10ms: worker pool drains

Workers:

```go
for {
    select {
    case <-pool.done:
        // drain remaining jobs
        for { select { case j := <-pool.jobs: j.Run(); default: return } }
    case j := <-pool.jobs: j.Run()
    }
}
```

They observe pool.done is closed, switch to drain mode, finish remaining jobs in the buffer, exit.

### t=50ms: database connection pool flushes

```go
func (db *DB) Close() error {
    db.cancel()
    // wait for in-flight queries to complete
    db.wg.Wait()
    return db.driver.Close()
}
```

The DB cancels its context, waits for queries to finish, closes the driver.

### t=80ms: telemetry flushes

```go
metrics.Flush()
logs.Flush()
traces.Flush()
```

These push remaining data to the backend before the process exits.

### t=100ms: process exits

```go
os.Exit(0)
```

Or just return from main. Process is gone.

The whole shutdown is 100ms. Each step is a channel close (signal, app.done, pool.done, db cancellation) or a method call. Each is independently testable.

A production-grade Go service shuts down in 100ms or less under normal load. Under backpressure, it may take longer but should always converge within the grace period.

---

## Failure Mode Catalogue

A reference for common failure modes during shutdown.

### Failure: panic mid-shutdown

Cause: a goroutine panics during cleanup. Other goroutines may not run their deferred cleanups.

Mitigation: top-level recover in each long-running goroutine that logs the panic and lets the goroutine exit cleanly.

### Failure: shutdown hangs

Cause: a goroutine is stuck on a channel operation that no one will service.

Mitigation: every blocking operation must be guarded by ctx.Done() or a deadline. Goroutine dumps and timeouts.

### Failure: drain incomplete

Cause: shutdown timeout expires before all in-flight work finishes.

Mitigation: increase timeout, reduce in-flight work cap, externalise queues.

### Failure: double-close panic

Cause: two goroutines both close the same channel.

Mitigation: sync.Once. Code review.

### Failure: send-on-closed panic

Cause: a goroutine sends to a channel that another closed.

Mitigation: gate sends with done-channel select. Test under -race.

### Failure: data loss

Cause: in-flight items dropped on shutdown.

Mitigation: drain channels before close. If durable persistence is required, write to disk before close.

### Failure: corrupt state on restart

Cause: shutdown was interrupted (SIGKILL); some state was partially written.

Mitigation: use atomic file operations (rename, fsync). Replay logs on startup.

Each failure mode has known mitigations. Apply them proactively.

---

## Closing Thoughts: The Discipline of Close

Close is a small operation with a large surface area. A close protocol involves:

- Ownership: who closes.
- Coordination: how senders learn to stop.
- Cancellation: how operators can abort.
- Drain: how in-flight work completes.
- Observability: how operators see progress.
- Failure: how the system survives partial close.

Each of these is a sub-problem. Each has well-known patterns. The professional's skill is composing them into a coherent whole.

Some closing principles to internalise:

- Close is not optional. Channels that should close must close, or goroutines leak.
- Close is not free. High-fanout closes have measurable cost. Plan accordingly.
- Close is observable. Telemetry must capture close events for capacity planning and incident response.
- Close is testable. Stress tests with -race catch the common bugs. Chaos tests catch the uncommon ones.
- Close is composable. A service's shutdown is the composition of its modules' closes. Order matters.

A team that treats close as a first-class concern produces durable systems. A team that treats close as an afterthought produces fragile systems that page on every deploy.

Be the first team.

---

## Cross-References

For deeper coverage of related topics:

- The semantics of close in the Go specification: see `specification.md`.
- Interview-style questions on close patterns: see `interview.md`.
- Hands-on exercises: see `tasks.md`.
- Broken code to diagnose: see `find-bug.md`.
- Performance tuning of close-bearing code: see `optimize.md`.
- The five rules and the basic safe patterns: see `junior.md`.
- Multi-sender close, sync.Once, defensive recover: see `middle.md`.
- Ownership, design patterns, library APIs: see `senior.md`.

Together, these files give a complete operational view of channel close in Go.

---

## Appendix F: Detailed Implementation of Production Shutdown

A fully-fleshed-out production shutdown sequence to study line-by-line.

```go
package server

import (
    "context"
    "errors"
    "fmt"
    "log/slog"
    "net/http"
    "os"
    "os/signal"
    "sync"
    "sync/atomic"
    "syscall"
    "time"
)

type Server struct {
    logger *slog.Logger
    http   *http.Server
    pool   *WorkerPool
    db     *DB
    cache  *Cache

    state     atomic.Int32
    shutdownDone chan struct{}
    shutdownOnce sync.Once
}

const (
    stateStarting int32 = iota
    stateRunning
    stateDraining
    stateStopping
    stateStopped
)

func NewServer(cfg Config) (*Server, error) {
    s := &Server{
        logger: slog.Default(),
        shutdownDone: make(chan struct{}),
    }
    s.state.Store(stateStarting)

    db, err := NewDB(cfg.DSN)
    if err != nil {
        return nil, fmt.Errorf("db: %w", err)
    }
    s.db = db

    s.cache = NewCache(cfg.CacheSize)

    s.pool = NewWorkerPool(cfg.Workers, cfg.QueueSize)

    s.http = &http.Server{
        Addr:    cfg.Listen,
        Handler: s.handler(),
    }

    return s, nil
}

func (s *Server) Run(ctx context.Context) error {
    s.state.Store(stateRunning)
    s.logger.Info("server starting", "addr", s.http.Addr)

    errCh := make(chan error, 1)
    go func() {
        if err := s.http.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            errCh <- err
        }
    }()

    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)

    var runErr error
    select {
    case sig := <-sigCh:
        s.logger.Info("received signal", "signal", sig)
    case err := <-errCh:
        runErr = err
        s.logger.Error("server error", "err", err)
    case <-ctx.Done():
        s.logger.Info("context cancelled")
    }

    if err := s.Shutdown(30 * time.Second); err != nil {
        s.logger.Error("shutdown error", "err", err)
    }

    return runErr
}

func (s *Server) Shutdown(timeout time.Duration) error {
    var err error
    s.shutdownOnce.Do(func() {
        err = s.doShutdown(timeout)
        close(s.shutdownDone)
    })
    <-s.shutdownDone
    return err
}

func (s *Server) doShutdown(timeout time.Duration) error {
    s.state.Store(stateDraining)
    s.logger.Info("shutdown initiated")

    deadline := time.Now().Add(timeout)
    ctx, cancel := context.WithDeadline(context.Background(), deadline)
    defer cancel()

    // Step 1: stop accepting new connections, drain in-flight.
    s.logger.Info("draining http server")
    if err := s.http.Shutdown(ctx); err != nil {
        s.logger.Error("http shutdown", "err", err)
        return err
    }

    // Step 2: drain worker pool.
    s.logger.Info("draining worker pool")
    if err := s.pool.Shutdown(ctx); err != nil {
        s.logger.Error("pool shutdown", "err", err)
        return err
    }

    s.state.Store(stateStopping)

    // Step 3: flush cache.
    s.logger.Info("flushing cache")
    if err := s.cache.Flush(ctx); err != nil {
        s.logger.Error("cache flush", "err", err)
    }

    // Step 4: close database.
    s.logger.Info("closing database")
    if err := s.db.Close(); err != nil {
        s.logger.Error("db close", "err", err)
    }

    s.state.Store(stateStopped)
    s.logger.Info("shutdown complete")
    return nil
}
```

Notes on this code:

- The state field tracks the lifecycle for observability.
- Shutdown uses sync.Once for idempotency.
- The deadline context bounds each step; if any step exceeds, deadline error propagates.
- Each step is logged for trace visibility.
- The HTTP server's own Shutdown is used; we trust the standard library's implementation.
- The worker pool's Shutdown drains in-flight jobs (defined in the pool's own logic).
- Cache flush is best-effort (errors logged but not fatal).
- DB close is last; releases connections.

The order matters: HTTP first (stop accepting), then pool (no new work submitted, drain existing), then cache (flush before losing DB), then DB (release).

---

## Appendix G: Common Anti-Pattern: Close in Cleanup Defer

```go
// BAD
func handler(w http.ResponseWriter, r *http.Request) {
    ch := make(chan Result)
    defer close(ch)
    go produce(ch)
    for r := range ch {
        // ...
    }
}
```

The defer closes ch when handler returns. The producer is still running and will panic.

Fix: producer closes its own channel.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ch := producerChannel()
    for r := range ch {
        // ...
    }
}

func producerChannel() <-chan Result {
    ch := make(chan Result)
    go func() {
        defer close(ch)
        // ...
    }()
    return ch
}
```

Or use errgroup:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    g, ctx := errgroup.WithContext(ctx)
    ch := make(chan Result, 10)
    g.Go(func() error {
        defer close(ch)
        return produce(ctx, ch)
    })
    g.Go(func() error {
        for r := range ch { _ = r }
        return nil
    })
    if err := g.Wait(); err != nil {
        http.Error(w, err.Error(), 500)
    }
}
```

errgroup ensures both goroutines complete before handler returns.

---

## Appendix H: Resilience Patterns with Close

Resilience patterns interact with close in specific ways.

### Circuit breaker

A circuit breaker tracks failures and "opens" to short-circuit calls. When the breaker is open, calls return error immediately without invoking downstream.

Channels: typically not the right primitive here. Use atomic state + Time. Channels add overhead without benefit.

If you do use channels (e.g., to broadcast state changes), the close protocol is straightforward: a state channel that closes when the breaker is permanently disabled.

### Retry with backoff

Retries do not typically involve channel close. The retry loop:

```go
for attempt := 0; attempt < max; attempt++ {
    err := op()
    if err == nil { return nil }
    select {
    case <-time.After(backoff(attempt)):
    case <-ctx.Done(): return ctx.Err()
    }
}
```

`time.After` returns a channel; the runtime owns it. No close needed (it auto-closes after firing).

### Bulkhead

A bulkhead limits concurrent operations via a semaphore. The semaphore is typically a buffered channel:

```go
type Bulkhead struct {
    sem chan struct{}
}

func New(size int) *Bulkhead {
    return &Bulkhead{sem: make(chan struct{}, size)}
}

func (b *Bulkhead) Acquire(ctx context.Context) error {
    select {
    case b.sem <- struct{}{}:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (b *Bulkhead) Release() { <-b.sem }
```

The semaphore channel is never closed; it lives for the program. GC reclaims it on exit. Closing it would break Acquire calls.

If you want a bulkhead with a "close to drain" semantic, switch to atomic counter + done-channel:

```go
type Bulkhead struct {
    sem chan struct{}
    done chan struct{}
    once sync.Once
}

func (b *Bulkhead) Acquire(ctx context.Context) error {
    select {
    case <-b.done: return ErrClosed
    case b.sem <- struct{}{}:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (b *Bulkhead) Close() { b.once.Do(func() { close(b.done) }) }
```

After Close, Acquire returns ErrClosed. The semaphore channel is not closed; in-flight users can still Release.

### Rate limiter

A token bucket using a channel:

```go
type Limiter struct {
    tokens chan struct{}
}

func New(rate int) *Limiter {
    l := &Limiter{tokens: make(chan struct{}, rate)}
    for i := 0; i < rate; i++ { l.tokens <- struct{}{} }
    go l.refill(rate)
    return l
}

func (l *Limiter) Take() { <-l.tokens }
func (l *Limiter) refill(rate int) {
    t := time.NewTicker(time.Second / time.Duration(rate))
    defer t.Stop()
    for range t.C {
        select { case l.tokens <- struct{}{}: default: }
    }
}
```

The refill goroutine never exits. If you want it to exit on close, add a done channel and select.

### Hedging

Hedging sends the same request to multiple replicas and takes the first response:

```go
func hedged(ctx context.Context, replicas []string) (Response, error) {
    ch := make(chan Response, len(replicas))
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    for _, r := range replicas {
        go func(r string) {
            resp, err := call(ctx, r)
            if err == nil {
                select { case ch <- resp: default: }
            }
        }(r)
    }
    select {
    case resp := <-ch:
        return resp, nil
    case <-ctx.Done():
        return Response{}, ctx.Err()
    }
}
```

The first response arrives at `ch`; cancel propagates to other replicas; they return early. The `ch` is never explicitly closed; GC reclaims it.

Notice the buffered channel: each replica's send is non-blocking. If we only buffered for 1 but had N replicas, the late senders would block. Buffer N to avoid this.

---

## Appendix I: Close and Context Cancellation Together

A worked example showing how close and context cancellation interact in a multi-stage pipeline.

```go
type Stage func(ctx context.Context, in <-chan int) <-chan int

func wrap(name string, work func(int) int) Stage {
    return func(ctx context.Context, in <-chan int) <-chan int {
        out := make(chan int)
        go func() {
            defer close(out)
            for {
                select {
                case <-ctx.Done():
                    return
                case v, ok := <-in:
                    if !ok { return }
                    select {
                    case <-ctx.Done(): return
                    case out <- work(v):
                    }
                }
            }
        }()
        return out
    }
}

func Pipeline(ctx context.Context, src <-chan int, stages ...Stage) <-chan int {
    out := src
    for _, st := range stages {
        out = st(ctx, out)
    }
    return out
}

func source(ctx context.Context, n int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < n; i++ {
            select {
            case <-ctx.Done(): return
            case out <- i:
            }
        }
    }()
    return out
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    src := source(ctx, 100)
    p := Pipeline(ctx, src,
        wrap("double", func(v int) int { return v * 2 }),
        wrap("inc",    func(v int) int { return v + 1 }),
    )

    for v := range p {
        fmt.Println(v)
        if v > 50 {
            cancel() // early exit
            break
        }
    }
}
```

Trace through a cancellation:

1. The consumer's `for range` receives values.
2. At some point, condition triggers `cancel()`.
3. Cancel propagates to ctx.Done(); every goroutine selecting on it observes the close.
4. Each stage's `select { case <-ctx.Done(): return }` arm fires.
5. `defer close(out)` runs in each stage.
6. The next stage's `for v, ok := <-in` returns `ok=false`; it also returns and closes its out.
7. The consumer's `for range` exits when the final out closes.
8. main exits, `defer cancel()` runs (no-op since already cancelled).

The cascade is: source closes → stage1 closes → stage2 closes → consumer exits.

Each stage relies on either ctx.Done() (cancellation) or in being closed (natural end). Both lead to defer close(out).

---

## Appendix J: Common Real-World Bugs by Stack Trace

Examples of close-related panics with their root causes.

### Stack: panic in cleanup goroutine

```
panic: send on closed channel
goroutine 14 [running]:
main.cleanup()
    /app/main.go:75
main.loop.func1(...)
    /app/main.go:50
```

Root cause: a cleanup goroutine called from a loop, sending to a channel that another iteration of the loop closed.

Fix: structure the loop so each iteration's resources are independent. Or use a single channel that all iterations share, with proper coordination.

### Stack: double close in deferred shutdown

```
panic: close of closed channel
goroutine 8 [running]:
main.(*Service).Stop()
    /app/service.go:42
runtime.gopanic(...)
main.main.func1()
    /app/main.go:33
```

Root cause: `Service.Stop` was called from a deferred shutdown in main; another goroutine (perhaps a signal handler) already called Stop.

Fix: sync.Once in Stop.

### Stack: receive from closed nil channel

```
fatal error: all goroutines are asleep - deadlock!

goroutine 1 [chan receive]:
main.main()
    /app/main.go:15
```

Root cause: main is receiving from a nil channel (uninitialised). The runtime detected universal deadlock.

Fix: initialise channels in constructors, not deferred.

### Stack: close in finalizer

```
panic: close of closed channel
goroutine 6 [running]:
main.(*Watcher).cleanup(...)
runtime.(*SetFinalizer).callFinalizer(...)
```

Root cause: a finalizer set on a struct that owns a channel. The finalizer closes the channel. The struct's normal lifecycle also closed it. Double close.

Fix: do not use finalizers for channels. Use explicit Close.

---

## Appendix K: Effective Channel Sizing

Buffer sizing impacts close behaviour. Larger buffers:

- Absorb bursts (better throughput under spiky load).
- Increase memory usage.
- Increase drain time on shutdown (more in-flight to process).
- Hide design issues (slow consumer is harder to notice).

Smaller buffers:

- Reveal backpressure quickly (slow consumer blocks producer).
- Reduce memory usage.
- Faster drain on shutdown.
- Reduce variance in latency.

Rule of thumb: start with unbuffered (0). If sends are routinely blocked, increase to 1, then 16, then 64. Buffers above 256 should be justified by measurement.

The largest production channels we run are size 1024 — and they are rare. Most are unbuffered or size 16-32.

### Sizing and close interaction

A buffer of N means up to N items in flight. On shutdown:

- Without drain: those N items are lost.
- With drain: drain takes at least N * per-item-process-time.

For an 8-stage pipeline with 32-buffer per stage and 1ms per item, drain takes 256ms minimum. Plan accordingly.

---

## Appendix L: Common Question — Should I Close This Channel?

A decision tree:

1. Does the channel have multiple senders?
   - Yes: do not close from any sender. Use a coordinator (WaitGroup + closer goroutine) or do not close (let GC reclaim).
   - No: continue.

2. Does the receiver use `for range` or check `ok`?
   - Yes: close from the sender when no more data.
   - No: closing is unnecessary. (But it does not hurt.)

3. Is the channel a signal (chan struct{} for cancellation/broadcast)?
   - Yes: close once (use sync.Once if multiple closers possible). Never send.
   - No: continue.

4. Is the channel exposed via API (returned from a function)?
   - Yes: use `<-chan T` (direction); decide who has Close authority and document.
   - No: continue (internal channel).

5. Is the channel created per-request?
   - Yes: usually no close needed; GC reclaims when the request ends.
   - No: continue.

6. Else: probably close when the sender is done. Wrap in sync.Once if multiple paths can reach the close.

This tree covers 99% of cases. The remaining 1% are advanced patterns (pub-sub, fan-in with cancellation) covered in the senior-level material.

---

## Appendix M: When to Reach for sync.Cond Instead

sync.Cond is appropriate when:

- The signal is reusable (cond.Broadcast can fire many times).
- The state being signalled is richer than "yes/no" (multiple conditions on shared state).
- You need a separate predicate function (wait until X is true).

Channel close is appropriate when:

- The signal is one-shot.
- The state is "is this done?".
- You want simple, idiomatic code.

In production Go, channel close is used 95% of the time. sync.Cond is a specialist tool for the remaining 5%.

---

## Appendix N: Real Pitfall — Goroutine Wakeup Ordering

When close fires, the runtime wakes up all waiting goroutines. The order is:

1. The closer continues running (single-threaded execution).
2. The wakeup list is built under the channel's lock.
3. The lock is released.
4. Each goroutine on the wakeup list is goready'd.
5. The runtime scheduler picks them up over time.

This means: after `close(ch)`, the closer may proceed for a while before any waiter is observed. If the closer does work that depends on waiters having observed the close, you have a race.

```go
close(ch)
// At this point, waiters may not have woken up yet.
doMoreWork()
```

If `doMoreWork` requires "all waiters have exited", you must use wg.Wait, not assume close-then-immediately is enough.

The pattern:

```go
close(ch)
wg.Wait() // explicit synchronisation
doMoreWork()
```

The wg.Wait synchronises: it completes only after every waiter has finished its work (signalled via wg.Done in the waiter's defer).

---

## Appendix O: Concurrent Map of Channels

Some patterns maintain a map of channels (e.g., one channel per session). Concurrent access requires careful synchronisation, and close becomes complicated.

```go
type ChMap struct {
    mu sync.RWMutex
    m  map[string]chan Event
}

func (c *ChMap) Get(id string) chan Event {
    c.mu.RLock()
    ch, ok := c.m[id]
    c.mu.RUnlock()
    if ok { return ch }
    c.mu.Lock()
    defer c.mu.Unlock()
    if ch, ok := c.m[id]; ok { return ch }
    ch = make(chan Event, 16)
    c.m[id] = ch
    return ch
}

func (c *ChMap) Send(id string, ev Event) {
    ch := c.Get(id)
    select {
    case ch <- ev:
    default: // drop on full
    }
}

func (c *ChMap) Close(id string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if ch, ok := c.m[id]; ok {
        close(ch)
        delete(c.m, id)
    }
}
```

The race: between Send's `c.Get(id)` and `ch <- ev`, another goroutine can call Close on the same id. The send then panics.

Fix: hold the read lock for the whole operation:

```go
func (c *ChMap) Send(id string, ev Event) {
    c.mu.RLock()
    ch, ok := c.m[id]
    if !ok {
        c.mu.RUnlock()
        return
    }
    select {
    case ch <- ev:
    default:
    }
    c.mu.RUnlock()
}
```

But Close acquires the write lock; if Send holds the read lock, Close waits. If Send's `ch <- ev` blocks (no buffer space, no readers), Close blocks indefinitely.

The trade-off: select default ensures Send is non-blocking, so the read lock release is bounded. Close eventually proceeds.

The robust pattern uses a done-channel per session:

```go
type session struct {
    ch   chan Event
    done chan struct{}
    once sync.Once
}

type ChMap struct {
    mu sync.RWMutex
    m  map[string]*session
}

func (c *ChMap) Send(id string, ev Event) {
    c.mu.RLock()
    s := c.m[id]
    c.mu.RUnlock()
    if s == nil { return }
    select {
    case <-s.done:
        return
    case s.ch <- ev:
    default:
    }
}

func (c *ChMap) Close(id string) {
    c.mu.Lock()
    s := c.m[id]
    delete(c.m, id)
    c.mu.Unlock()
    if s != nil {
        s.once.Do(func() { close(s.done) })
    }
}
```

Now Send is non-blocking and Close does not deadlock. The data channel `s.ch` is never closed; GC reclaims when references drop.

This is the production-grade pattern for concurrent channel maps.

---

## Appendix P: Diagnostic — Reading Goroutine Profile for Close Issues

A snippet from a goroutine profile of a stuck application:

```
goroutine 5 [chan send, 60 minutes]:
main.producer(0xc000abcdef)
    /app/producer.go:42 +0x88

goroutine 6 [chan send, 60 minutes]:
main.producer2(0xc000abcdef)
    /app/producer2.go:35 +0x55

goroutine 7 [select, 60 minutes]:
main.consumer(0xc000abcdef)
    /app/consumer.go:23 +0x77

goroutine 8 [running]:
main.handler(0xc00012a000, 0xc000130000)
    /app/handler.go:15 +0x33
```

Goroutines 5, 6, 7 have been blocked for 60 minutes.

5 and 6 are in `chan send`. They are trying to send to a channel.
7 is in `select`. It is choosing among several channel operations.

The channel they're all waiting on is the same: 0xc000abcdef.

The consumer (7) is selecting; maybe it's choosing a different channel that's never ready. Look at consumer.go:23. The producers are sending to a buffered channel that's full because the consumer is stuck.

Fix: identify what consumer's select is waiting on; ensure it can proceed.

This kind of profile analysis is the bread-and-butter of debugging close-related (and broader concurrency) issues in production.

---

## Appendix Q: Idempotent Init Pattern (close as broadcast)

A common close idiom: "wait until init has completed".

```go
type Config struct {
    data Data
    ready chan struct{}
    once  sync.Once
}

func (c *Config) Init() {
    c.once.Do(func() {
        c.data = loadConfig()
        close(c.ready)
    })
}

func (c *Config) Get() Data {
    <-c.ready
    return c.data
}
```

Properties:

- Init can be called concurrently; only one performs the load.
- Get blocks until Init has completed.
- After completion, Get returns instantly (closed channel receive is non-blocking).
- The memory model guarantees that Get sees the data written by Init.

This is the canonical "lazy init with broadcast" pattern. Use it whenever you need a singleton initialised on first use.

---

## Appendix R: Why GC Cannot Help With Close

A misconception: "the GC will close the channel eventually".

The GC reclaims channels with no references. It does not close them. Receivers blocked on a never-closed channel hold a reference (the channel is on their stack); GC cannot reclaim. The receivers are leaked.

The GC's role: clean up after all references drop. The close's role: release receivers so they drop their references.

If you forget to close, you have:

1. Receivers blocked indefinitely.
2. Receivers holding references to the channel.
3. GC cannot reclaim.
4. Channel memory leaks for the life of the process.

This is the canonical "goroutine leak". Diagnose via `runtime.NumGoroutine()` rising over time and via goroutine profiles.

---

## Appendix S: Building Confidence in Close Code

A checklist before committing close-bearing code:

- [ ] Run `go vet` on the package.
- [ ] Run `go test -race -count=10` on the package.
- [ ] Run goleak in test cleanup.
- [ ] Stress test with at least 100 concurrent operations.
- [ ] Peer review by someone familiar with the concurrency style.
- [ ] Documented close protocol in code comments.

If you cannot tick all six, do not ship. Concurrency bugs are the hardest to debug in production.

---

## Appendix T: Glossary of Close-Related Terms

- **Close.** The builtin `close(ch)`. Marks a channel as closed; wakes all waiters.
- **Closer.** The entity (goroutine, method, or coordinator) authorised to call close.
- **Drain.** Processing remaining items in a channel before stopping.
- **Quiescent close.** Close after waiting for all senders to finish (e.g., via WaitGroup).
- **Snap-close.** Close immediately, accepting that in-flight sends may be lost.
- **Done channel.** A `chan struct{}` used for one-shot broadcast (closure = signal).
- **Cancellation.** Triggering the done channel or context to abort in-flight work.
- **Fan-in.** Merging N channels into one. Multi-sender close problem.
- **Fan-out.** Distributing one channel's values to N receivers. Single-closer.
- **Backpressure.** Blocking sends when receivers are slow.
- **Coordinator.** A goroutine that closes a channel after observing other goroutines' completion.
- **Idempotent close.** A close operation safe to call multiple times.
- **Receive-only direction.** `<-chan T` — cannot close from this side.
- **Send-only direction.** `chan<- T` — can send; can close.
- **Race window.** Time between checking close-state and acting on it.
- **Generation.** A logical lifetime; used when channels must be rotated.

Familiarity with these terms speeds discussion of close protocols in design reviews.

---

## Appendix U: Closing a Channel After Reset

Some applications need to reset a stream (e.g., a watcher that reconnects). The pattern:

```go
type Stream struct {
    mu       sync.Mutex
    ch       chan Event
    gen      uint64
}

func (s *Stream) Out() <-chan Event {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.ch
}

func (s *Stream) Reset() {
    s.mu.Lock()
    oldCh := s.ch
    s.ch = make(chan Event, cap(oldCh))
    s.gen++
    s.mu.Unlock()
    close(oldCh) // notify old subscribers
}
```

Old subscribers see oldCh close (their range exits). They call `s.Out()` to get the new channel.

Race: a subscriber that calls `s.Out()` between read-old and close-old gets the old channel. Their range exits immediately (closed). They call `s.Out()` again, get the new channel.

This works because:

- The mutex serialises the channel swap.
- Closing old after the swap ensures subscribers see the close after the new channel is available.

The pattern is "generation rotation". It enables a logical-stream with physical-channel renewal.

---

## Appendix V: Channel Close in Distributed Systems

In a distributed setting, what does "channel close" mean across nodes?

If nodes communicate via a message bus (Kafka, NATS), close is at the bus level: a producer marks the end-of-stream by writing a sentinel message, or by simply ceasing to write. There is no channel-level close across nodes.

Within each node, channels coordinate goroutines. The node-level close protocol composes:

1. Node's external connections receive shutdown signal.
2. Node's internal channels close per the senior-level patterns.
3. Node's process exits.

Distributed coordination is orthogonal to channel close. Channels are intra-node.

The principle: a channel is a node-local concept. Cross-node "channel-like" semantics require explicit protocols (heartbeats, sentinels, distributed locks).

---

## Appendix W: Tracing a Close Bug from Report to Fix

A walkthrough of debugging a real close bug, illustrative of professional practice.

### Bug report

"Service occasionally panics with 'send on closed channel' during deploys."

### Step 1: get the stack trace

From the logs:

```
panic: send on closed channel
goroutine 234 [running]:
github.com/svc/server.(*Hub).publish(0xc000123, 0xc000abc)
    /src/server/hub.go:88 +0x55
created by github.com/svc/server.(*Hub).Start
    /src/server/hub.go:42 +0x77
```

### Step 2: identify the channel

Line 88 of hub.go is `h.ch <- msg`. The channel is `h.ch`, a field of Hub.

### Step 3: find the closer

Search for `close(h.ch)` or `close(*\\.ch)`:

```
git grep 'close.*h\.ch'
hub.go:120:    close(h.ch)
hub.go:135:    close(h.ch)
```

Two closes! Look at lines 120 and 135.

Line 120 is in `Hub.Stop`:

```go
func (h *Hub) Stop() {
    close(h.ch)
    h.wg.Wait()
}
```

Line 135 is in `Hub.Restart`:

```go
func (h *Hub) Restart() {
    close(h.ch)
    h.ch = make(chan Msg)
    // restart workers
}
```

### Step 4: identify the bug

Restart closes h.ch and replaces it. But the publish goroutine (line 88) captured the *value* of h.ch at the time of its `created by` (line 42). It is still sending to the old channel.

After Restart, the old channel is closed; the publish goroutine panics on the next send.

### Step 5: design the fix

Option 1: prevent Restart from being called when publish is in flight. Add a wait.

Option 2: do not allow Restart. Force users to Stop and create a new Hub.

Option 3: rework publish to load h.ch fresh on each send (under lock). This adds lock contention but is correct.

We pick option 3 with a refinement: use a generation pattern (see Appendix U).

### Step 6: write a test

```go
func TestHubRestart(t *testing.T) {
    h := NewHub()
    h.Start()
    var wg sync.WaitGroup
    wg.Add(100)
    for i := 0; i < 100; i++ {
        go func() {
            defer wg.Done()
            h.Publish(Msg{...})
        }()
    }
    time.Sleep(10 * time.Millisecond)
    h.Restart() // should not panic
    wg.Wait()
    h.Stop()
}
```

Run with -race -count=10. Reproduce the panic. After fix, the test should pass.

### Step 7: ship the fix

After review, merge and deploy. Monitor for the panic for several days. If it does not recur, the bug is fixed.

### Lessons

- Restart-style operations on channels are dangerous.
- Always verify that goroutines have updated references after a channel swap.
- Use generation-based ownership for channels that must be reset.

This is a real-world workflow for diagnosing and fixing close bugs.

---

## Appendix X: Production Telemetry Examples

Concrete examples of telemetry that catches close issues before they cause incidents.

### Metric: send_block_seconds

Time spent in `ch <- v` waiting for the consumer. Rising values indicate backpressure.

```go
func (c *Ch) Send(v T) {
    start := time.Now()
    c.ch <- v
    sendBlockSeconds.Observe(time.Since(start).Seconds())
}
```

Alert if 99th percentile exceeds 1 second.

### Metric: channel_occupancy_ratio

Ratio of `len(ch) / cap(ch)`. Near 1 means buffer is full; near 0 means consumer is faster than producer.

```go
go func() {
    for range time.Tick(time.Second) {
        for name, ch := range channels {
            ratio := float64(len(ch.ch)) / float64(cap(ch.ch))
            occupancyRatio.WithLabelValues(name).Set(ratio)
        }
    }
}()
```

Alert if ratio > 0.9 for sustained period.

### Metric: goroutine_count

Total goroutines in the process.

```go
go func() {
    for range time.Tick(time.Second) {
        goroutineCount.Set(float64(runtime.NumGoroutine()))
    }
}()
```

Alert if count grows linearly over hours (indicates leak).

### Metric: panic_count

Counter of recovered panics, by type.

```go
defer func() {
    if r := recover(); r != nil {
        panicCount.WithLabelValues(fmt.Sprintf("%T", r)).Inc()
        // re-panic if not handled
    }
}()
```

Alert on any increment of "close-related" panic types.

These four metrics give visibility into the most common close-related issues. Add custom metrics for specific channels in your service.

---

## Appendix Y: Specific Anti-Pattern: Closing Inside a select

```go
// BAD
select {
case ch <- v: // ok
case <-done:
    close(ch) // BAD: closing inside select where send case exists
}
```

This is broken: if the send case wins, no close happens, and the done is leaked. If the done case wins, we close — but other senders may still be using the channel.

The fix: never close inside a select with a send case. Closing should be the responsibility of a single goroutine that knows no other senders exist.

```go
// GOOD
select {
case ch <- v:
case <-done:
    return // do not close; let owner close
}
```

The close is somewhere else (the channel's owner). The select just chooses to send or to give up.

---

## Appendix Z: Final Words on Close Discipline

After all the patterns, all the runtime mechanics, all the failure modes — the discipline of close boils down to a few habits:

1. Every channel has an owner. Document it.
2. Every close has a coordinator. Often it's a goroutine; sometimes it's sync.Once.
3. Every send is gated by a done-channel or context. Never bare-send on a channel that may be closed.
4. Every receive uses range or comma-ok. Never assume.
5. Every shutdown is tested. Stress, race, chaos.
6. Every panic is investigated. Find the design defect; fix it; prevent recurrence.

These habits are not exotic; they are the foundation of production-grade Go. Master them and channel close becomes invisible — which is exactly how it should feel.

The next file, `specification.md`, gives the formal Go-spec view of close: the precise semantics, the memory model rules, and comparisons to other languages. After that, `interview.md`, `tasks.md`, `find-bug.md`, and `optimize.md` give hands-on material to consolidate the practice.

Production-grade close is a skill. It takes years of practice to internalise. But the patterns are finite, the tools are good, and the discipline is teachable.

You are now equipped.

---

## Extended Discussion: Close in Streaming Frameworks

Modern Go services often use streaming frameworks: gRPC streams, NATS subscriptions, Kafka consumers, server-sent events. Each has close semantics that interact with internal channels.

### gRPC server streams

A gRPC server stream:

```go
func (s *Service) Watch(req *WatchReq, stream WatchService_WatchServer) error {
    ch := s.subscribe(req)
    defer s.unsubscribe(ch)
    for {
        select {
        case <-stream.Context().Done():
            return stream.Context().Err()
        case ev, ok := <-ch:
            if !ok { return nil } // subscription ended
            if err := stream.Send(ev); err != nil { return err }
        }
    }
}
```

The internal channel `ch` is the subscription. When the client cancels, `stream.Context().Done()` fires. The handler returns. The deferred unsubscribe closes the subscription channel (after removing from the subscriber list).

The close protocol:

- Handler is the receiver of `ch`.
- `unsubscribe` is the closer (the subscription owner).
- The publisher continues serving other subscribers.
- Close fires after the handler has returned and released its reference.

### gRPC client streams

The client side:

```go
stream, err := client.Watch(ctx, req)
if err != nil { return err }
for {
    ev, err := stream.Recv()
    if err == io.EOF { break } // server closed stream
    if err != nil { return err }
    handle(ev)
}
```

The `stream.Recv` returns EOF when the server closes. This is analogous to comma-ok with `ok=false`.

If the client wants to cancel, it cancels the context; `stream.Recv` returns an error. The server side's `stream.Context().Done()` fires.

No internal channels visible to the client. The framework handles the close protocol.

### NATS subscriptions

```go
sub, err := nc.Subscribe("events", func(m *nats.Msg) {
    process(m.Data)
})
defer sub.Unsubscribe()
```

The framework's internal channel feeds the callback. On Unsubscribe, the channel closes; the goroutine running the callback exits.

User code is shielded from the close. But: the callback may be invoked one more time after Unsubscribe (the message was already on the channel). Idempotency in the callback is recommended.

### Kafka consumers

A Kafka consumer typically has:

- A goroutine reading from Kafka (the consumer poll loop).
- A channel of decoded messages.
- Consumer goroutines processing the channel.

On shutdown:

1. Signal poll loop to stop.
2. Poll loop closes the message channel.
3. Consumer goroutines drain remaining; commit offsets; exit.

The pattern is the same as a generic pipeline. Kafka-specific details (offset management) are orthogonal to channel close.

### Server-sent events (SSE)

```go
func (h *Handler) Stream(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/event-stream")
    flusher, _ := w.(http.Flusher)
    ch := h.subscribe()
    defer h.unsubscribe(ch)
    for {
        select {
        case <-r.Context().Done():
            return
        case ev, ok := <-ch:
            if !ok { return }
            fmt.Fprintf(w, "data: %s\n\n", ev.JSON())
            flusher.Flush()
        }
    }
}
```

Same as gRPC server stream. The subscription channel is closed externally; the handler exits on close or on context cancellation.

The key insight: streaming frameworks abstract over the close protocol. Internally, they use channels with the same patterns we have been discussing.

---

## Extended Discussion: Close and Resource Pools

Resource pools (DB connections, HTTP clients, GPU contexts) have close requirements that interact with channel-based queue patterns.

### Connection pool

```go
type Pool struct {
    mu       sync.Mutex
    avail    chan *Conn
    closed   bool
}

func (p *Pool) Get(ctx context.Context) (*Conn, error) {
    select {
    case <-ctx.Done(): return nil, ctx.Err()
    case c, ok := <-p.avail:
        if !ok { return nil, ErrPoolClosed }
        return c, nil
    }
}

func (p *Pool) Put(c *Conn) {
    p.mu.Lock()
    defer p.mu.Unlock()
    if p.closed {
        c.Close()
        return
    }
    select {
    case p.avail <- c:
    default:
        c.Close() // pool full
    }
}

func (p *Pool) Close() error {
    p.mu.Lock()
    if p.closed {
        p.mu.Unlock()
        return nil
    }
    p.closed = true
    close(p.avail) // no more Gets succeed
    p.mu.Unlock()
    // Drain channel and close connections
    for c := range p.avail {
        c.Close()
    }
    return nil
}
```

Notice that `Get` returning from a closed `avail` channel gets `ok=false`, so it returns ErrPoolClosed. `Put` after Close closes the connection rather than returning it to the pool.

Race: a Get can receive a conn just before Close fires; the user gets the conn, uses it, returns it via Put. Put sees closed=true and closes the conn. Net effect: the conn is closed properly even though it was lent out.

This is the production pattern for connection pools. database/sql uses a more complex version internally.

### Pool with idle reaper

A long-lived pool may have idle connections. A reaper goroutine reclaims them:

```go
func (p *Pool) reaper() {
    t := time.NewTicker(time.Minute)
    defer t.Stop()
    for {
        select {
        case <-p.done:
            return
        case <-t.C:
            p.reapIdle()
        }
    }
}
```

`p.done` is the shutdown signal. On Close:

```go
func (p *Pool) Close() error {
    p.once.Do(func() {
        close(p.done) // signal reaper
        close(p.avail) // signal Get callers
    })
    // ... drain ...
}
```

Two closes are coordinated. The reaper sees `done` and exits. Get callers see `avail` closed and return error.

This is a multi-channel close. As always, each close has a single owner (the Close method); idempotency is via sync.Once.

---

## Extended Discussion: Close in Caching Layers

Caches often use channels for invalidation or for background refresh.

### Invalidation broadcast

```go
type Cache struct {
    mu    sync.RWMutex
    data  map[string]*Entry
    invalidateCh chan string
    done  chan struct{}
    once  sync.Once
}

func (c *Cache) Watch() <-chan string {
    return c.invalidateCh
}

func (c *Cache) Invalidate(key string) {
    select {
    case c.invalidateCh <- key:
    default: // drop on full
    }
}

func (c *Cache) Close() {
    c.once.Do(func() {
        close(c.done)
        close(c.invalidateCh)
    })
}
```

The invalidateCh broadcasts invalidations. Subscribers read from Watch. On Close, both channels close.

Issue: after `close(c.invalidateCh)`, Invalidate's select arms see "send on closed channel" — but we used default arm, which... still panics on closed send. We need to gate:

```go
func (c *Cache) Invalidate(key string) {
    select {
    case <-c.done:
        return
    case c.invalidateCh <- key:
    default:
    }
}
```

Now: if `done` is closed, return early. If channel has space, send. Otherwise drop.

This is the safe-broadcast pattern. The `done` channel is the source of truth; the data channel is never read after close.

### Background refresh

```go
func (c *Cache) refresher(ctx context.Context) {
    t := time.NewTicker(time.Minute)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done(): return
        case <-t.C: c.refresh()
        }
    }
}
```

Refresher exits on context cancellation. The context comes from the cache's owner. Close propagates via context.

```go
type Cache struct {
    cancel context.CancelFunc
    wg     sync.WaitGroup
    once   sync.Once
}

func NewCache(parent context.Context) *Cache {
    ctx, cancel := context.WithCancel(parent)
    c := &Cache{cancel: cancel}
    c.wg.Add(1)
    go func() { defer c.wg.Done(); c.refresher(ctx) }()
    return c
}

func (c *Cache) Close() {
    c.once.Do(func() {
        c.cancel()
        c.wg.Wait()
    })
}
```

Close cancels the context, waits for the refresher to exit. Clean.

---

## Extended Discussion: Close in Job Queues

A job queue distributes work to multiple consumers.

### Queue with priority

```go
type PriorityQueue struct {
    high chan Job
    low  chan Job
    done chan struct{}
    once sync.Once
}

func (q *PriorityQueue) Enqueue(j Job, priority int) error {
    select {
    case <-q.done:
        return ErrClosed
    default:
    }
    var ch chan Job
    if priority > 0 { ch = q.high } else { ch = q.low }
    select {
    case <-q.done:
        return ErrClosed
    case ch <- j:
        return nil
    }
}

func (q *PriorityQueue) Dequeue() (Job, bool) {
    // High priority first.
    select {
    case j := <-q.high:
        return j, true
    case <-q.done:
        // Drain high; then low.
        select {
        case j := <-q.high:
            return j, true
        default:
        }
        select {
        case j := <-q.low:
            return j, true
        default:
            return Job{}, false
        }
    default:
    }
    select {
    case j := <-q.high:
        return j, true
    case j := <-q.low:
        return j, true
    case <-q.done:
        return Job{}, false
    }
}

func (q *PriorityQueue) Close() {
    q.once.Do(func() { close(q.done) })
}
```

After Close, Enqueue rejects. Dequeue drains existing items, then returns false.

The channels `high` and `low` are never closed. They live for the program (or until GC reclaims after all references drop).

### Priority via single channel + heap

Alternative: one channel of pointers, with a separate priority heap. The channel is unordered; the heap orders. Less idiomatic Go but useful for richer prioritisation.

### Bounded backlog

If the queue must reject new work when full:

```go
func (q *Queue) Enqueue(j Job) error {
    select {
    case <-q.done: return ErrClosed
    case q.ch <- j: return nil
    default: return ErrFull
    }
}
```

The default arm handles full case. Non-blocking enqueue.

For graceful backpressure (block until space available, with cancellation):

```go
func (q *Queue) Enqueue(ctx context.Context, j Job) error {
    select {
    case <-q.done: return ErrClosed
    case q.ch <- j: return nil
    case <-ctx.Done(): return ctx.Err()
    }
}
```

Three arms: shutdown, send, cancel. The caller decides on which arm via context deadline.

---

## Extended Discussion: Performance Pitfalls

Some patterns look efficient but are not.

### Pitfall: chan struct{} channels are not free

A `chan struct{}` has the same hchan overhead as `chan int`. The element size is zero, so no buffer storage, but the lock and queues remain.

A program with thousands of `chan struct{}` channels (one per request, one per session) has thousands of hchan structs. Memory: ~120 bytes each = 120KB. Not huge but noticeable.

If you need many one-shot signals, consider a shared signal channel with values that identify the recipient.

### Pitfall: close storms

Closing a channel with N waiters is O(N). For N=10,000, this is ~1ms under the channel lock. During that 1ms, no other operation on the channel can proceed.

For high-fanout broadcasts, this is OK at low frequency but expensive at high frequency. If you broadcast 100 times per second to 10,000 subscribers, that's 100ms/sec of close-storm latency.

Mitigation: shard the subscribers across multiple channels; each shard is closed independently. Total work is the same but lock contention is reduced.

### Pitfall: select polling

```go
for {
    select {
    case v := <-ch1: process(v)
    case <-time.After(time.Millisecond):
    }
}
```

The `time.After` allocates a new timer each iteration. For high-frequency loops, this is allocation-heavy.

Better:

```go
t := time.NewTimer(time.Millisecond)
defer t.Stop()
for {
    select {
    case v := <-ch1:
        process(v)
        t.Reset(time.Millisecond)
    case <-t.C:
        t.Reset(time.Millisecond)
    }
}
```

Reuse the timer. No per-iteration allocation.

Or, even better, drop the timeout entirely if it's not needed for the loop's semantics:

```go
for v := range ch1 {
    process(v)
}
```

If the channel closes, the loop exits. No timeout machinery needed.

### Pitfall: large channel buffers

A buffer of 1024 ints is ~8KB. Not bad. A buffer of 1024 large structs (e.g., 1KB each) is 1MB. For many channels, this adds up.

Worse: GC scans the buffer when the channel is reachable. Large buffers slow GC.

Sizes >256 should be carefully justified. Often a small buffer with a slow producer/consumer is correct; the queue is in another tier (database, message bus).

---

## Extended Discussion: Close and Concurrency-Safe Iteration

Iterating over a channel while modifying it (e.g., adding new subscribers) is tricky.

### Iterator pattern

```go
type Watcher struct {
    mu sync.Mutex
    subs []chan<- Event
}

func (w *Watcher) Subscribe(ch chan<- Event) {
    w.mu.Lock()
    defer w.mu.Unlock()
    w.subs = append(w.subs, ch)
}

func (w *Watcher) Publish(ev Event) {
    w.mu.Lock()
    snapshot := make([]chan<- Event, len(w.subs))
    copy(snapshot, w.subs)
    w.mu.Unlock()
    for _, ch := range snapshot {
        select { case ch <- ev: default: }
    }
}
```

We snapshot under the lock, then iterate outside the lock. A new subscriber added during the iteration is missed (that's fine — they get the next event). A subscriber removed during the iteration may receive a stale event (also fine; let them check ev.timestamp).

If a subscriber's channel is closed, the iteration's send panics. To handle, Watcher should not allow external close of subscriber channels — it owns them, or the subscriber must call Unsubscribe rather than close.

```go
func (w *Watcher) Unsubscribe(ch chan<- Event) {
    w.mu.Lock()
    defer w.mu.Unlock()
    for i, c := range w.subs {
        if c == ch {
            w.subs[i] = w.subs[len(w.subs)-1]
            w.subs = w.subs[:len(w.subs)-1]
            break
        }
    }
}
```

Unsubscribe removes from the list. The subscriber's channel is still open; the subscriber is responsible for it.

If the Watcher should close subscriber channels on Unsubscribe, do it under the lock:

```go
func (w *Watcher) Unsubscribe(ch chan<- Event) {
    w.mu.Lock()
    defer w.mu.Unlock()
    for i, c := range w.subs {
        if c == ch {
            close(c.(chan Event)) // type assert; might fail
            w.subs[i] = w.subs[len(w.subs)-1]
            w.subs = w.subs[:len(w.subs)-1]
            break
        }
    }
}
```

But `chan<- Event` cannot be closed via the send-only direction. The Watcher must store the bidirectional `chan Event` if it wants to close. Trade-off: more flexibility for the Watcher, less safety from the user's perspective.

---

## Extended Discussion: Close in Lifetimes That Cross Goroutines

A "lifetime" is the duration during which a resource is valid. Goroutines have lifetimes. Channels have lifetimes.

### Goroutine lifetime vs channel lifetime

A channel can outlive a goroutine: if main holds a reference but the goroutine exits, the channel lives until main drops the reference.

A goroutine can outlive a channel: if the goroutine holds a reference but main drops, the channel is referenced only by the goroutine; GC cannot reclaim until the goroutine exits.

Either way, lifetimes are tracked via references, not via "is the goroutine still running".

### Implication: closing without dropping references

```go
ch := make(chan int)
go func() {
    // never returns; holds ch
}()
close(ch)
// ch is closed but still referenced; not GC'd
```

The channel is closed but still live. The goroutine holds it. Until the goroutine exits and the reference drops, the channel sticks around.

For long-running services, this is fine. For per-request resources, ensure goroutines exit.

### Implication: not closing but dropping references

```go
func foo() {
    ch := make(chan int)
    go func() {
        // sends or receives on ch
    }()
    // foo returns; ch goes out of scope from foo's perspective
}
```

After foo returns, the goroutine still holds ch. ch is alive. If the goroutine blocks on ch (no other sender/receiver), it leaks; ch leaks.

The pattern is: ensure the goroutine has a termination condition (close, cancellation), and the references drop after.

---

## Extended Discussion: Common Production Refactors

A refactor pattern: "this code panics under load; fix it".

### Pattern: replace defer close with explicit close after Wait

Before:

```go
go func() {
    defer close(ch)
    for ... {
        ch <- ...
    }
}()
go func() {
    defer close(ch) // double-close risk
    for ... {
        ch <- ...
    }
}()
```

After:

```go
var wg sync.WaitGroup
wg.Add(2)
go func() {
    defer wg.Done()
    for ... { ch <- ... }
}()
go func() {
    defer wg.Done()
    for ... { ch <- ... }
}()
go func() { wg.Wait(); close(ch) }()
```

Single closer (the third goroutine). Idempotent. Race-free.

### Pattern: replace receiver-side close with done-channel

Before:

```go
for v := range ch {
    if v.Stop { close(ch); break } // BAD
}
```

After:

```go
for v := range ch {
    if v.Stop {
        cancel() // signal upstream to stop
        // continue to drain remaining
    }
}
```

The receiver cancels upstream rather than closing the data channel. Upstream sees the cancellation, exits, and closes from its side.

### Pattern: replace bare close with sync.Once

Before:

```go
func (s *Service) Stop() { close(s.done) }
```

After:

```go
func (s *Service) Stop() {
    s.once.Do(func() { close(s.done) })
}
```

Idempotent. Safe for concurrent callers.

These refactors are common; you will apply them repeatedly during migrations.

---

## Extended Discussion: Close as a Concurrency Primitive

The Go community has converged on close as a fundamental concurrency primitive, alongside channels themselves.

A few principles to internalise:

1. **Close is broadcast.** When you need to wake N waiters, close a channel they all watch. This is the cleanest broadcast in Go.

2. **Close is finality.** When a channel is closed, the contract changes. Receivers know "no more data". Senders know "I must not touch this channel" (or risk panic). The before/after states are distinct.

3. **Close is a write.** It modifies channel state. As such, it must be synchronised against other writes (sends, other closes). The runtime synchronises via the channel's internal lock; user code synchronises via direction types and sync.Once.

4. **Close is happens-before.** Memory writes before the close are visible to observers after the close. This makes close usable for cross-goroutine state visibility.

5. **Close composes.** A multi-stage pipeline's close cascades naturally: each stage closes its output when its input is exhausted.

6. **Close is observable.** Receivers can detect it via range, comma-ok, or select-with-default. There is no out-of-band signal needed.

7. **Close is finite.** Each channel can be closed at most once. The cost of this finality is the patterns we have studied. The benefit is a clean, predictable runtime contract.

These principles underlie every safe-close pattern. Internalise them, and the patterns become obvious applications rather than memorised recipes.

---

## Conclusion of Professional-Level Material

We have covered:

- Operating systems where channels close in shutdown protocols.
- Graceful drains under time budgets.
- The runtime mechanics of `close` and its panic semantics.
- Forensic reading of panic stack traces.
- Production-grade worker pools and pipelines.
- Observability and telemetry for channel state.
- Kubernetes lifecycle and signal handling.
- Performance tuning of close-bearing code.
- Real-world incidents and their debugging workflows.

The professional Go engineer treats channel close not as a footnote to channels but as a first-class operational concern. They design for it, test for it, instrument for it, and respond to incidents involving it with practised debugging skills.

Channel close is small. Production-grade close is large. The gap is what separates senior engineers from staff engineers.

You have the material. Now write code, ship services, run them in production, and learn from the incidents that inevitably occur. Each one is a chance to deepen your understanding.

The next files cover the formal specification (`specification.md`), interview questions (`interview.md`), hands-on tasks (`tasks.md`), bugs to diagnose (`find-bug.md`), and performance optimisations (`optimize.md`). Each builds on the foundation laid here and at the senior level.

May your channels close cleanly.


