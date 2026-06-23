---
layout: default
title: Interview
parent: Channel Close Violations
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 6
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/03-channel-close-violations/interview/
---

# Channel Close Violations — Interview Questions

## Introduction

This file collects 30+ interview questions across the difficulty spectrum, from junior screening to staff-level system design. Each question is followed by a graded answer and a discussion of common follow-ups.

The questions are organized by difficulty:

- Q1-Q10: junior (basic facts).
- Q11-Q20: middle (multi-sender patterns, race analysis).
- Q21-Q30: senior (design choices, library API).
- Q31+: staff-level (architecture, trade-offs).

---

## Junior-Level Questions

### Q1: What happens if you close a nil channel?

Runtime panic: `close of nil channel`. Nil channels cannot be closed because the runtime cannot mark a nil channel as closed — there is no channel object.

Follow-up: What happens if you send or receive on a nil channel? Both block forever.

### Q2: What happens if you close an already-closed channel?

Runtime panic: `close of closed channel`. The runtime detects via the channel's internal closed flag.

Follow-up: How do you prevent this in concurrent code? Use `sync.Once` or a coordinator goroutine.

### Q3: What happens if you send on a closed channel?

Runtime panic: `send on closed channel`. This is detected during the chansend operation, before any buffer or waiter check.

Follow-up: Does buffering save you? No. Closed-state is checked first; buffered or not is irrelevant.

### Q4: What does `v, ok := <-ch` return after close?

`v` is the zero value of the element type; `ok` is `false`. The receive does not block.

Follow-up: What if there were buffered values when close fired? They drain first; `ok` is `true` for each. After drain, subsequent receives return zero+false.

### Q5: Trace this program. Does it panic?

```go
ch := make(chan int, 2)
ch <- 1
close(ch)
ch <- 2
```

It panics on the last line: `send on closed channel`. The first send fits in the buffer; close is fine; the second send violates Rule 3.

Follow-up: What if `close` were after `ch <- 2`? Then both sends succeed; close finalises; no panic.

### Q6: Why does `for range ch` exit when ch is closed?

The range loop is equivalent to `for { v, ok := <-ch; if !ok { break }; ... }`. When the channel is closed and drained, ok becomes false; the loop exits.

Follow-up: Does range close the channel when it exits? No. Range is a receiver; receivers never close.

### Q7: Should a receiver close the channel?

No. Conventional rule: only the sender (or a single closer with knowledge of all senders) closes.

Follow-up: Why? If a receiver closes, any in-flight sender panics.

### Q8: Multiple producers send to one channel. Who closes?

A coordinator goroutine. The producers report completion via `sync.WaitGroup`; the coordinator calls `wg.Wait()` then `close(ch)`.

Follow-up: Why not the last producer? Because no producer knows it is the last until coordination tells it.

### Q9: What is the difference between `<-chan T` and `chan<- T`?

`<-chan T` is receive-only (cannot send or close). `chan<- T` is send-only (cannot receive). Both are subtypes of `chan T`.

Follow-up: Why use them? At API boundaries, they enforce the close-protocol intent at compile time.

### Q10: Write a single-producer, single-consumer channel with proper close.

```go
func produce() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < 10; i++ {
            out <- i
        }
    }()
    return out
}

func main() {
    for v := range produce() {
        fmt.Println(v)
    }
}
```

The producer goroutine is the closer (via `defer close(out)`). The consumer ranges. No coordination needed.

---

## Middle-Level Questions

### Q11: Two goroutines each have `defer close(ch)`. What happens?

The first to exit closes the channel; the second panics on `close of closed channel`.

Follow-up: Fix it. Use a coordinator goroutine:

```go
var wg sync.WaitGroup
wg.Add(2)
go func() { defer wg.Done(); ... }()
go func() { defer wg.Done(); ... }()
go func() { wg.Wait(); close(ch) }()
```

### Q12: How would you implement an idempotent Close method?

```go
func (s *Svc) Close() {
    s.once.Do(func() { close(s.done) })
}
```

`sync.Once.Do` ensures the function runs at most once, regardless of how many goroutines call Close.

Follow-up: What's the cost of sync.Once? Fast path is a single atomic load (~1 ns). Slow path runs once.

### Q13: A worker pool has N workers reading from a job channel. How do you shut it down?

Close a separate "done" channel. Workers select on both `jobs` and `done`. When `done` closes, workers exit.

```go
for {
    select {
    case <-done: return
    case j := <-jobs: j.Run()
    }
}
```

Follow-up: Why not close the jobs channel? Because Submit calls may be in flight; closing jobs would panic them.

### Q14: Implement a safe send that does not panic on closed channel.

Option A: defensive recover.

```go
func send(ch chan int, v int) (ok bool) {
    defer func() { if r := recover(); r != nil { ok = false } }()
    ch <- v
    return true
}
```

Option B: done-channel gate.

```go
func send(ch chan<- int, done <-chan struct{}, v int) bool {
    select {
    case <-done: return false
    case ch <- v: return true
    }
}
```

Option B is preferred: no panic, no recover overhead, explicit cancellation.

### Q15: A channel has a single sender and 100 receivers. How does close behave?

The sender closes. All 100 receivers see ok=false (or range exit) on their next receive. The wakeup is O(100); the runtime wakes each receiver and schedules them.

Follow-up: Is this efficient? At small scale yes. For 10,000 receivers, the close itself is ~1ms. For 1,000,000, it's noticeable.

### Q16: Two goroutines send to a channel; one of them closes early. What happens?

The early-closer panics nothing; close itself succeeds. The other sender panics on its next send.

Follow-up: How do you prevent? Use a coordinator. Single sender close is never safe with multiple senders.

### Q17: A buffered channel of cap 10 has 5 items, then closed. What can a receiver do?

The receiver can receive 5 items (the buffered ones), each with ok=true. The 6th receive returns zero+false.

Follow-up: What if the receiver uses range? Range receives 5 items, then exits.

### Q18: Explain how a select on `ctx.Done()` and a channel send work together.

```go
select {
case <-ctx.Done(): return ctx.Err()
case ch <- v: // sent successfully
}
```

Both cases are evaluated. If ctx is cancelled, the Done channel is closed, so that case is always ready. The select picks pseudo-randomly between ready cases.

If ch is also ready (a receiver waiting or buffer space), either case may win.

Follow-up: How to prefer ctx.Done? Do a pre-check:

```go
select { case <-ctx.Done(): return ctx.Err(); default: }
select { case <-ctx.Done(): return ctx.Err(); case ch <- v: }
```

### Q19: Memory model — what guarantees does close provide?

The Go memory model: close happens-before any receive that returns due to the close. This means writes the closer made before close are observable by receivers after the close.

```go
data = 42
close(done)
// other goroutine:
<-done
fmt.Println(data) // guaranteed to see 42
```

Follow-up: What about writes after close? Not guaranteed. Always order writes before close.

### Q20: A goroutine is blocked on `ch <- v`. Another goroutine closes ch. What happens to the blocked goroutine?

The blocked sender is unblocked and immediately panics with `send on closed channel`. The unblocking and panicking are synchronised by the channel's internal lock.

Follow-up: How would you make the sender exit cleanly? Wrap the send in a select with a done channel:

```go
select {
case ch <- v: // success
case <-done:  // cancelled; do not panic
    return
}
```

---

## Senior-Level Questions

### Q21: Design a thread-safe, idempotent Close method that returns the same error every call.

```go
type Svc struct {
    once sync.Once
    err  error
    done chan struct{}
}

func (s *Svc) Close() error {
    s.once.Do(func() {
        s.err = s.cleanup()
        close(s.done)
    })
    <-s.done
    return s.err
}
```

The `<-s.done` outside the Once ensures concurrent callers all wait for cleanup completion before returning the error.

Follow-up: What if cleanup is long-running and callers want a timeout? Take a context:

```go
func (s *Svc) Close(ctx context.Context) error {
    s.once.Do(func() { go s.cleanup() })
    select {
    case <-s.done: return s.err
    case <-ctx.Done(): return ctx.Err()
    }
}
```

### Q22: When should you use `context.Done()` vs closing a custom channel?

- `context.Done()` for cancellation that may have a parent (it propagates from parent context).
- Custom done-channel for self-contained signals without context coupling.
- `context.Done()` carries deadline and cause information; custom channels do not.

In modern Go, prefer context unless you have a library that cannot depend on context.

### Q23: How does close interact with `time.NewTimer`?

`time.NewTimer.C` is a channel owned by the runtime. You cannot close it; calling close would be a runtime panic.

To stop a timer early: `t.Stop()`. If Stop returns false (timer already fired), drain the channel: `<-t.C`.

For repeating tickers (`time.NewTicker`): `t.Stop()` stops the ticker but does not close `t.C`. Subsequent receives block forever. Use a separate done channel for exiting the loop.

### Q24: Design a pub-sub system where subscribers can unsubscribe.

```go
type PubSub struct {
    mu   sync.Mutex
    subs map[uint64]chan Event
    next uint64
}

func (p *PubSub) Subscribe() (uint64, <-chan Event) {
    p.mu.Lock()
    defer p.mu.Unlock()
    id := p.next
    p.next++
    ch := make(chan Event, 16)
    p.subs[id] = ch
    return id, ch
}

func (p *PubSub) Unsubscribe(id uint64) {
    p.mu.Lock()
    defer p.mu.Unlock()
    if ch, ok := p.subs[id]; ok {
        close(ch)
        delete(p.subs, id)
    }
}

func (p *PubSub) Publish(e Event) {
    p.mu.Lock()
    defer p.mu.Unlock()
    for _, ch := range p.subs {
        select { case ch <- e: default: }
    }
}
```

Notes:

- Publish holds the lock; no Unsubscribe can race.
- Unsubscribe closes the channel under the lock; the subscriber's range exits cleanly.
- New subscribers (via Subscribe) cannot race Publish.

Follow-up: This has Publish-under-lock latency. How to improve? Per-subscriber goroutines that deliver async. The subscriber's channel is the queue; the broadcast is non-blocking via per-subscriber routing.

### Q25: A pipeline has three stages. The last stage encounters an error. How do upstream stages learn to stop?

Use `errgroup.WithContext`. The errgroup cancels its context on the first error. Each stage selects on `ctx.Done()` and exits.

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return stage1(ctx, in, mid) })
g.Go(func() error { return stage2(ctx, mid, out) })
g.Go(func() error { return stage3(ctx, out) }) // may return error
return g.Wait()
```

If stage3 returns error, errgroup cancels ctx. stage1 and stage2 observe ctx.Done() and exit. Their `defer close` cascades the close.

### Q26: How would you instrument channel close events for production observability?

Wrap the channel:

```go
type InstrCh struct {
    name string
    ch   chan T
    once sync.Once
}

func (i *InstrCh) Close() {
    i.once.Do(func() {
        log.WithFields(log.Fields{
            "channel": i.name,
            "occupancy": len(i.ch),
            "capacity": cap(i.ch),
        }).Info("channel closing")
        closeCounter.WithLabelValues(i.name).Inc()
        close(i.ch)
    })
}
```

Log the occupancy at close (helps detect overflowing buffers or starving channels). Increment a Prometheus counter (for alerting on excessive closes).

For traces, add a span around close to see shutdown sequences in distributed tracing.

### Q27: Compare sync.Once + close to atomic-CAS + close. When prefer each?

```go
// sync.Once
s.once.Do(func() { close(s.done) })

// atomic CAS
if s.closed.CompareAndSwap(0, 1) { close(s.done) }
```

- sync.Once: more readable, well-documented intent, slightly slower (mutex involved).
- Atomic CAS: faster on uncontended path, one fewer struct field if you reuse the same atomic for other state.

For library code, prefer sync.Once. For ultra-hot paths after profiling, atomic CAS.

### Q28: A goroutine ranges over a channel. The producer crashes. What happens?

The producer's deferred close fires (if it was wrapped in `defer close(ch)`). The receiver's range exits when the channel closes.

If the producer crashes without a deferred close, the channel is never closed. The receiver blocks forever on the next iteration. Goroutine leak.

Solution: always `defer close(ch)` in the producer, and consider top-level recover-and-log for producer goroutines so panics convert to "exit and log" not "exit and abandon".

### Q29: How do you test that a Close method is idempotent under concurrency?

```go
func TestIdempotent(t *testing.T) {
    s := New()
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); _ = s.Close() }()
    }
    wg.Wait()
    // If sync.Once is missing, double-close panic occurs
}
```

Run with `-race -count=100`. If Close panics, the test fails. If it deadlocks, the test times out.

### Q30: When is it appropriate to use `defer func() { recover() }()` around a channel send?

Almost never. The right pattern is:

```go
select {
case ch <- v: // sent
case <-done:  // cancelled
}
```

This avoids the panic entirely.

Recover is appropriate only when:

- You are bridging to a third-party API that does not support done-channel.
- The cost of the deferred recover is acceptable (sub-microsecond).
- You log the recovered value so the design defect is visible.

Even then, prefer to refactor the API to support done-channel.

---

## Staff-Level Questions

### Q31: Design a graceful shutdown protocol for a service with HTTP, gRPC, worker pool, and database. What's the order?

The order respects dependencies. Stop accepting new work, drain in-flight work, close stateful resources.

```
1. Stop accepting HTTP/gRPC connections (close listeners).
2. Wait for in-flight HTTP/gRPC handlers to complete (with timeout).
3. Close the worker pool's accept channel; workers drain their queues.
4. Wait for all workers to exit (with timeout).
5. Flush any in-memory caches to durable storage.
6. Close database connections.
7. Flush telemetry (metrics, logs, traces).
8. Exit process.
```

Each step has a sub-timeout; if any exceeds, log and proceed (or fail fast).

Follow-up: What if the HTTP handler depends on the worker pool? You must drain HTTP first; otherwise handlers fail because pool is closed.

### Q32: A long-running service has been leaking goroutines. How do you diagnose?

1. Fetch goroutine profile: `curl /debug/pprof/goroutine?debug=2`.
2. Compare goroutine counts over time. Look for monotonic growth.
3. Group goroutines by stack. Identify the dominant stack.
4. Trace the stack to find the blocking operation (typically a channel receive).
5. Identify why the producer is not closing or sending.
6. Fix the producer's close protocol.

Follow-up: If `runtime.NumGoroutine()` is bounded but the process is slow, look at the mutex profile instead — contention on channel locks could be the issue.

### Q33: How do you ensure a Go HTTP server gracefully handles SIGTERM in Kubernetes?

```go
srv := &http.Server{Addr: addr, Handler: h}
go srv.ListenAndServe()
sigCh := make(chan os.Signal, 1)
signal.Notify(sigCh, syscall.SIGTERM)
<-sigCh
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
srv.Shutdown(ctx)
```

Plus configure Kubernetes:

```yaml
terminationGracePeriodSeconds: 35
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "sleep 5"] # let LB drain
```

The preStop sleeps 5 seconds (LB time to drain); SIGTERM fires; the application has 30 seconds (timeout) within 35 seconds (Kubernetes grace).

Follow-up: What if a slow handler exceeds 30 seconds? srv.Shutdown returns ctx.Err(). Application logs and exits. Kubernetes sends SIGKILL at 35s.

### Q34: Walk through what happens at the runtime level when `close(ch)` is called with 10 blocked receivers.

1. `closechan(c)` acquires `c.lock`.
2. Checks `c.closed`; if non-zero, panics.
3. Sets `c.closed = 1`.
4. Builds a list of all 10 receivers (from `c.recvq`).
5. Each receiver is marked as "channel closed"; their elem pointers are zeroed.
6. Releases `c.lock`.
7. Calls `goready` for each receiver, placing them on runqueues.
8. The scheduler picks them up over time; each resumes execution, observing the closed-flag (via the comma-ok path).

The closer's goroutine continues running after step 7. The 10 receivers do not run synchronously; they wake up over the next few microseconds.

Follow-up: What if there are also blocked senders? Same loop builds them; on resume, each sender will see closed and panic.

### Q35: Compare close-based broadcast to sync.Cond.Broadcast. Trade-offs?

Close:

- One-shot. Cannot be undone.
- Zero allocation after channel creation.
- Receivers wait via `<-ch` or `select`.
- Memory model: close happens-before observer receive.

sync.Cond.Broadcast:

- Reusable. Can be re-signalled.
- Requires a mutex + cond variable.
- Receivers wait via `cond.Wait()` (must hold the mutex).
- Memory model: cond.Broadcast signals follow mutex semantics.

Close is preferred for one-shot signals (cancellation, init complete, shutdown). sync.Cond is for repeatable signals (state changes, queue notifications).

### Q36: A library exposes `chan T` (bidirectional). What are the risks?

The caller can:

- Send to the channel (may or may not be appropriate).
- Close the channel (may or may not be appropriate).
- Range, receive, select.

If the library's design assumes "only the library closes", a caller calling close violates the assumption. Future library sends panic.

Fix: return `<-chan T` (receive-only); caller cannot close. If caller needs to close, expose a `Close()` method that is idempotent.

### Q37: How would you implement a multi-tenant channel system where each tenant can be independently closed without affecting others?

A map of `*tenantChannel`, each with its own done channel and sync.Once. Operations on a tenant route through its struct.

```go
type tenantChannel struct {
    ch   chan Event
    done chan struct{}
    once sync.Once
}

type System struct {
    mu  sync.RWMutex
    chs map[TenantID]*tenantChannel
}

func (s *System) Publish(id TenantID, e Event) {
    s.mu.RLock()
    tc := s.chs[id]
    s.mu.RUnlock()
    if tc == nil { return }
    select {
    case <-tc.done: return
    case tc.ch <- e:
    default:
    }
}

func (s *System) CloseTenant(id TenantID) {
    s.mu.Lock()
    tc := s.chs[id]
    delete(s.chs, id)
    s.mu.Unlock()
    if tc != nil { tc.once.Do(func() { close(tc.done) }) }
}
```

Each tenant's done is independent. CloseTenant removes from the map (so future Publish targets nothing) and closes done (so existing Publish in flight aborts).

### Q38: A worker submits to a channel that another goroutine has closed. The worker's send panics. What's wrong with the design, and how do you fix?

The closer was authorised to close while the worker was still sending. Either:

1. The closer closed prematurely (before all workers finished). Fix: use a coordinator with WaitGroup.
2. The data channel should not be closed at all; close a done channel instead. Fix: have workers select on done; never close the data channel.

The second fix is more robust because it eliminates the panic by construction.

### Q39: How do you reason about backpressure in a multi-stage pipeline with close?

Each stage's buffer absorbs short bursts. When a downstream stage is slow, upstream stages' sends block, eventually blocking the source.

On shutdown, cancellation unblocks the sends (because each stage selects on ctx.Done()). Buffered values still in flight are processed by the next stage as long as the next stage's goroutine is alive. After all stages exit (via ctx.Done), each closes its output via `defer close`; the cascade flushes.

Follow-up: What if the consumer is gone and the producer is faster? Producer blocks; cancellation unblocks; data in buffers is lost (unless explicitly drained before close).

### Q40: Explain the relationship between `close`, `context.WithCancel`, and the memory model.

`context.WithCancel(parent)` internally creates a done channel. `cancel()` closes that channel via sync.Once. Receivers of `ctx.Done()` see the close.

The memory model guarantees that writes the cancelling goroutine made before `cancel()` are observable to any goroutine that receives from `ctx.Done()`. This makes context.Cancel a thread-safe broadcast primitive.

The same guarantee applies to direct channel close: it is a synchronization point that publishes writes.

This is why `context.Context` is the canonical cancellation primitive in Go: it leverages channel close semantics under the hood and exposes them with a richer API (deadline, value, cause).

---

## Code-Trace Questions

### Q41: What does this print?

```go
ch := make(chan int, 2)
ch <- 1
close(ch)
v1, ok1 := <-ch
v2, ok2 := <-ch
v3, ok3 := <-ch
fmt.Println(v1, ok1, v2, ok2, v3, ok3)
```

`1 true 0 false 0 false`

The first receive drains the buffered 1. The next two receive from a closed-empty channel: zero value with ok=false.

### Q42: What does this print?

```go
var ch chan int
go func() {
    close(ch)
}()
time.Sleep(100 * time.Millisecond)
fmt.Println("done")
```

The goroutine panics with `close of nil channel`. The panic terminates the goroutine. The main routine sleeps, then prints "done".

Wait — does a panic in a goroutine crash the program? Yes. A panic in any goroutine, if unrecovered, terminates the entire program. The main routine never reaches "done".

Output: `panic: close of nil channel`.

### Q43: Will this deadlock?

```go
ch := make(chan int)
go func() {
    ch <- 1
    close(ch)
}()
v, ok := <-ch
fmt.Println(v, ok)
v, ok = <-ch
fmt.Println(v, ok)
```

No. The goroutine sends 1, closes ch. The main receives 1 (ok=true), then receives from closed channel (zero+false).

Output: `1 true` then `0 false`.

### Q44: Does this race?

```go
ch := make(chan int, 1)
var wg sync.WaitGroup
wg.Add(2)
go func() {
    defer wg.Done()
    ch <- 1
}()
go func() {
    defer wg.Done()
    close(ch)
}()
wg.Wait()
```

Yes, it races. The two goroutines run concurrently. If the send completes first, close succeeds. If close completes first, the send panics.

Run with `-race`: data race detected on `ch`. Even without the race detector, occasional panics will happen.

### Q45: Fix Q44.

```go
ch := make(chan int, 1)
ch <- 1     // send synchronously
close(ch)   // then close
```

Or use a coordinator:

```go
ch := make(chan int, 1)
var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    ch <- 1
}()
wg.Wait()
close(ch)
```

The wg.Wait ensures the send completes before close.

---

## Open-Ended Design Questions

### Q46: Design a library API for a one-shot event with broadcast subscription.

Requirements:
- Multiple subscribers can wait for the event.
- The event fires exactly once.
- Subscribers added after the event still see it instantly.

```go
type Event struct {
    done chan struct{}
    once sync.Once
}

func New() *Event { return &Event{done: make(chan struct{})} }

func (e *Event) Fire() { e.once.Do(func() { close(e.done) }) }

func (e *Event) Wait() <-chan struct{} { return e.done }

// Usage:
// ev := New()
// go func() { <-ev.Wait(); /* do something */ }()
// // ... eventually ...
// ev.Fire() // all waiters wake
```

After Fire, late subscribers calling `Wait()` get the closed channel; their receive returns instantly. Perfect for "is initialization complete" or "is shutdown requested".

### Q47: Design a Drain method for a worker pool that processes remaining items then exits.

```go
func (p *Pool) Drain(ctx context.Context) error {
    p.beginDrain() // reject new Submits
    done := make(chan struct{})
    go func() { p.wg.Wait(); close(done) }()
    select {
    case <-done: return nil
    case <-ctx.Done(): return ctx.Err()
    }
}

func (p *Pool) beginDrain() {
    p.drainOnce.Do(func() { close(p.drainCh) })
}

// Submit:
func (p *Pool) Submit(j Job) error {
    select {
    case <-p.drainCh: return ErrDraining
    case p.jobs <- j: return nil
    }
}

// Worker (with drain mode):
func (p *Pool) worker() {
    defer p.wg.Done()
    for {
        select {
        case j := <-p.jobs:
            j.Run()
        case <-p.drainCh:
            // drain non-blocking
            for {
                select {
                case j := <-p.jobs: j.Run()
                default: return
                }
            }
        }
    }
}
```

Drain rejects new Submits, lets workers process existing items, then waits for all workers to exit.

### Q48: Design a generic "Closable" wrapper for any channel-bearing type.

```go
type Closable[T any] interface {
    Send(T) bool
    Recv() (T, bool)
    Close()
}

type SafeCh[T any] struct {
    ch   chan T
    done chan struct{}
    once sync.Once
}

func NewSafeCh[T any](buf int) *SafeCh[T] {
    return &SafeCh[T]{ch: make(chan T, buf), done: make(chan struct{})}
}

func (s *SafeCh[T]) Send(v T) bool {
    select {
    case <-s.done: return false
    case s.ch <- v: return true
    }
}

func (s *SafeCh[T]) Recv() (T, bool) {
    select {
    case v := <-s.ch: return v, true
    case <-s.done: var z T; return z, false
    }
}

func (s *SafeCh[T]) Close() { s.once.Do(func() { close(s.done) }) }
```

Generic version: `SafeCh[Event]`, `SafeCh[Job]`, etc. The done-channel pattern is type-independent.

### Q49: Compare two designs: (A) close the data channel to signal end-of-stream; (B) never close the data channel, use a separate done channel. When prefer each?

A: Close the data channel.
- Simpler API. Receivers use `range`.
- Lost data if cancellation fires mid-stream (receivers see close before buffered items? actually they see them, then close — see Q5).
- Panics if anyone tries to send after close (must coordinate senders).

B: Done channel, data channel never closed.
- More complex API. Receivers use `select`.
- No panic possible from data channel close.
- GC reclaims the data channel when references drop.

Prefer A when there is a single sender and natural end-of-stream is well-defined. Prefer B when there are multiple senders or when "abort" is more important than "natural end".

### Q50: Discuss the trade-offs between channel-based cancellation and using `context.Context`.

Channel-based:
- No external dependency.
- Simpler for one-off signals.
- Cannot carry deadline or values.

context.Context:
- Standard library; widely adopted.
- Carries deadline, cancel cause, key-value pairs.
- Propagates through call stack via convention (ctx as first arg).
- Slightly heavier (allocations on each WithCancel).

Use context.Context for any code that crosses package boundaries or carries deadlines. Use raw channels for self-contained, intra-package coordination.

In modern Go, almost everything uses context.Context. Raw done channels are appropriate for libraries that explicitly avoid context dependency (e.g., low-level concurrency primitives).

---

## Closing Thoughts

The 50 questions above cover the spectrum from "does close panic on nil" to "design a multi-tenant pub-sub system". An interviewer testing channel knowledge can pick questions matching the target level:

- Junior: Q1-Q10. Basic facts.
- Middle: Q11-Q20. Multi-sender patterns, memory model.
- Senior: Q21-Q40. Library design, observability, framework integration.
- Staff: Q31-Q40, Q46-Q50. System design, trade-off reasoning.

A candidate who can articulate the answers — not memorise them — has internalised the close protocol. The discipline applies far beyond close: it is the same reasoning used for any shared state in a concurrent program.
