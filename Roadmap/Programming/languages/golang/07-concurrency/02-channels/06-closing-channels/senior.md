# Closing Channels — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Go Memory Model and `close`](#the-go-memory-model-and-close)
3. [Designing for Shutdown: a System Architecture View](#designing-for-shutdown-a-system-architecture-view)
4. [Ownership, Lifetimes, and the Closer Identity](#ownership-lifetimes-and-the-closer-identity)
5. [Cascading Shutdown in Large Pipelines](#cascading-shutdown-in-large-pipelines)
6. [Cancellation vs Termination](#cancellation-vs-termination)
7. [Diagnosing Close-Related Bugs in Production](#diagnosing-close-related-bugs-in-production)
8. [Bounded Drain Patterns](#bounded-drain-patterns)
9. [Close, Backpressure, and Drop Semantics](#close-backpressure-and-drop-semantics)
10. [Channels as Data Structures with Lifecycles](#channels-as-data-structures-with-lifecycles)
11. [Close in Library APIs](#close-in-library-apis)
12. [Comparison with Other Languages](#comparison-with-other-languages)
13. [Anti-Lockup Recipes](#anti-lockup-recipes)
14. [Observability of Close Events](#observability-of-close-events)
15. [Failure Modes That Wear a Close Disguise](#failure-modes-that-wear-a-close-disguise)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## Introduction

At senior level, closing channels is no longer a syntax question. It is an architecture question: who owns a stream, how does the stream end, how does shutdown propagate, and how do you observe and prove that all goroutines exited.

We assume you can write multi-sender close patterns from middle level. The senior view is: *every goroutine that reads or writes a channel has a lifetime, and close is one of the events that defines that lifetime*. Design correctness depends on aligning the lifetime of producers, consumers, and channels.

After this you will:

- Cite the Go memory model guarantees `close` provides, and design code that depends on them.
- Architect shutdown for services with hundreds of long-lived goroutines.
- Diagnose "the channel didn't close" and "the channel closed too early" bugs from production traces.
- Decide between a closed data channel, a separate done channel, and `context.Context` based on the system's communication topology.
- Build library APIs whose close contract is explicit, documented, and panic-safe for callers.
- Recognise close-related failure modes that look like other bugs.

---

## The Go Memory Model and `close`

The Go memory model (`https://go.dev/ref/mem`) gives close two specific happens-before guarantees:

> *The closing of a channel happens before a receive that returns because the channel is closed.*

In plain words: any write performed by a goroutine *before* it closes a channel is visible to any goroutine that *observes the close* via a receive. This is the foundation for using close as a synchronisation primitive, not just a signal.

### Practical implication

```go
var data []int
done := make(chan struct{})

go func() {
    data = compute()
    close(done) // close = release
}()

<-done           // <-done = acquire
fmt.Println(data) // safe to read; the write happens-before the close
```

The write to `data` is guaranteed visible after `<-done` returns. No mutex, no atomic — close is the synchronisation point. This pattern is *the* alternative to `sync.WaitGroup` for "wait for one goroutine to finish and publish a result."

### Comparison with send

A send also synchronises:

> *A send on a channel happens before the corresponding receive from that channel completes.*

The difference: a send delivers one value to one receiver. A close synchronises with *every* receiver. For broadcast, only close has the right semantics.

### Why this matters in design

You can publish results to many goroutines by writing them and then closing:

```go
type Cache struct {
    ready chan struct{}
    data  map[string]string
}

func (c *Cache) Load() {
    c.data = loadFromDisk()
    close(c.ready) // any goroutine that has done <-c.ready now sees c.data
}

func (c *Cache) Get(k string) string {
    <-c.ready
    return c.data[k]
}
```

A late caller that comes after `Load()` returns also passes `<-c.ready` instantly (closed channels never block) and sees the data. This is a one-shot publish pattern: write once, close, read many times.

### Important non-guarantee

Closing does *not* synchronise with sends that happen on the same channel *after* close in some "logical" sense — there is no such thing, because sends after close panic. The model is: writes that happen before the close in the closer's goroutine are visible to receivers; that is all.

---

## Designing for Shutdown: a System Architecture View

A senior Go service of any complexity has a clear shutdown architecture. The components:

1. **A root cancel.** Usually `context.Context` from `signal.NotifyContext` at the top of `main`.
2. **Goroutine groups with bounded lifetimes.** Each group is started from a parent that knows how to wait for it (errgroup, WaitGroup, or a coordinator goroutine).
3. **Channels with clearly designated closers.** Every channel has a single goroutine (or `sync.Once`) responsible for closing it, and that goroutine has a clear lifetime tied to its parent group.
4. **Drains.** Where a producer may be mid-send when a cancellation arrives, a drainer is in place to consume the in-flight values, so the producer doesn't deadlock.
5. **Observability.** Each shutdown phase logs its progress; metrics record the number of in-flight tasks.

### Sketch

```go
func main() {
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    g, ctx := errgroup.WithContext(ctx)

    // server group
    g.Go(func() error { return runHTTPServer(ctx) })

    // background workers group
    g.Go(func() error { return runWorkers(ctx) })

    // metrics group
    g.Go(func() error { return runMetrics(ctx) })

    if err := g.Wait(); err != nil {
        log.Printf("shutdown: %v", err)
    }
}
```

Each `g.Go` returns when its group's work completes — or when `ctx` is cancelled. `errgroup.Wait` waits for all of them. Close is implicit in `ctx.Done()`; explicit close happens inside each subsystem on the channels it owns.

### Anti-pattern: the "shutdown function" that doesn't propagate

```go
func (s *Server) Shutdown() {
    close(s.done)
}
```

Close `done` here. But what about each connection's read loop? Each background ticker? Each cgo worker pinned to a thread? If `Shutdown` does not coordinate with all of them — wait for them, drain any pending data — the caller is left with goroutines still running.

A correct `Shutdown` is more like:

```go
func (s *Server) Shutdown(ctx context.Context) error {
    s.once.Do(func() { close(s.done) })

    done := make(chan struct{})
    go func() {
        s.wg.Wait()
        close(done)
    }()

    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Signal close. Wait for goroutines to drain. Bound the wait with a context (so the caller can give up after a deadline).

This is the `http.Server.Shutdown` design.

---

## Ownership, Lifetimes, and the Closer Identity

Every channel has an "owner": the goroutine (or unit of code) responsible for its lifecycle. Establishing ownership at design time is the single most effective close-bug prevention.

### Identifying the owner

Ask: "if this channel needs to close, what code is responsible?" The answer must be one well-defined location. If the answer is "any of these N goroutines" or "I'm not sure," you have a bug nucleus.

### Channels often have these owners

- The **dispatcher** that sends inputs owns the `inputs` channel.
- The **synchronising closer** owns the `outputs` channel.
- The **coordinator** that initiated a group owns the group's `done` channel.
- A **request handler** owns any per-request channels it creates.

### Documenting ownership

Comment on the channel's declaration:

```go
// Done is closed when Server.Shutdown is called.
// Owner: Server. Closer: Server.Shutdown via sync.Once.
Done <-chan struct{}
```

For external packages, exposing `<-chan T` (receive-only) in the API surface communicates "you read, I close."

### Lifetime alignment

A channel's lifetime should fit inside its owner's lifetime. If the owner is a function, the channel lives for the function call. If the owner is a struct, the channel lives for the struct's lifetime, with close in a teardown method. If the owner is a goroutine, the channel lives for that goroutine's body.

The bug surface appears when these don't align: a function returns a channel it doesn't close (the receiver inherits an obligation it can't fulfil), or a struct exposes a channel that survives the struct's destruction.

### The "closer count must equal one" rule

For each channel, in its lifetime, exactly one close operation must succeed. Achieve this by:

- One goroutine reaches `close(ch)`, others don't.
- `sync.Once` wraps the close, and you accept that the "first to arrive" closes.
- A coordinator goroutine is the only place where `close(ch)` appears in code.

The static analyzer `staticcheck` (`SA4022`) flags "useless close" patterns but cannot prove single-closer in general. Architecture review is the real check.

---

## Cascading Shutdown in Large Pipelines

A pipeline with 5–10 stages, each with its own channel, can shut down cleanly if every stage follows the discipline:

1. Each stage closes its output channel when its input channel closes *or* when `ctx.Done()` fires.
2. Each stage's `select` checks both input availability *and* `ctx.Done()`.
3. Failures in one stage cancel the context, propagating to all stages.

### Full example: a typed pipeline

```go
type Stage[T, U any] func(context.Context, <-chan T) <-chan U

func Stage1(ctx context.Context, in <-chan A) <-chan B {
    out := make(chan B)
    go func() {
        defer close(out)
        for a := range in {
            b, err := transform(a)
            if err != nil {
                // upstream cancellation
                return
            }
            select {
            case <-ctx.Done():
                return
            case out <- b:
            }
        }
    }()
    return out
}
```

Every stage has the same shape:

- `defer close(out)` at the top.
- `for ... range in` — exits when upstream closes.
- `select { case <-ctx.Done(): return; case out <- v: }` — exits on cancellation, blocks for downstream.

When `ctx` is cancelled:

- The current stage's `select` picks `ctx.Done()` and returns.
- `defer close(out)` runs.
- The next stage's `for range` sees its input close and exits.
- Cascade reaches the sink in O(depth) goroutine context switches.

### What goes wrong without ctx in the select

```go
for a := range in {
    b := transform(a)
    out <- b // no select! blocks if downstream is slow or stopped
}
```

If the downstream goroutine has exited and stopped reading `out`, this `out <- b` blocks forever. Upstream's `in` then has no reader, blocks, and so on. The pipeline freezes.

Always pair the send with `ctx.Done()`.

### Producer-side cancellation

```go
for _, v := range source {
    select {
    case <-ctx.Done():
        return
    case out <- v:
    }
}
```

Even the source stage cooperates: cancellation means "stop iterating immediately."

---

## Cancellation vs Termination

These are different events. Distinguishing them is senior-level fluency.

| Event | Meaning | Channel state |
|---|---|---|
| **Normal termination** | Input is exhausted; producer finished naturally. | Close output. |
| **Cancellation** | An external request to stop early (timeout, signal, error in another goroutine). | Close output (so consumers see end). |
| **Failure** | A non-recoverable error occurred inside the producer. | Close output; record error via separate channel or `errgroup`. |
| **Pause** | Temporarily stop producing; resume later. | Do *not* close; use a separate pause channel. |

`close` is the right signal for termination *and* cancellation *and* failure — three different events with the same effect on the consumer. The error or completion status is conveyed *out of band* (via an `error` returned by `errgroup.Wait`, or a `Result` struct with `Err` field, or a final `errs` channel).

### Anti-pattern: encoding error in close

```go
// Wrong: close means "error happened"
if err != nil {
    close(out)
    return
}
out <- result
close(out)
```

The consumer cannot tell error from success. Both look like "channel closed." Use a struct:

```go
type Result struct {
    Value V
    Err   error
}
```

---

## Diagnosing Close-Related Bugs in Production

### Symptom 1: goroutine count climbs forever

Diagnosis: somewhere, a goroutine is blocked on `<-ch` for a channel that is never closed (or never sent to). Tools:

```bash
curl http://localhost:6060/debug/pprof/goroutine?debug=2
```

Look for stacks like `runtime.chanrecv1` or `runtime.gopark`. Group by function. The function appearing thousands of times is the leaking one.

### Symptom 2: panic "send on closed channel"

Diagnosis: a sender is sending after close. Root causes:

- Multi-sender close without coordination.
- A sender goroutine outliving its expected lifetime.
- A `sync.Once.Do(close)` racing with a send loop.

Fix path:

1. Identify the panicking goroutine from the panic trace.
2. Trace back: who closed the channel? Who started the sender? When was each supposed to finish?
3. Add a `select { case <-done: return; case ch <- v: }` in the sender, or restructure so close happens after the sender finishes (Pattern 1: synchronising closer).

### Symptom 3: panic "close of closed channel"

Diagnosis: two code paths both reached `close(ch)`. Root causes:

- Two error handlers each closing in `defer`.
- A teardown that closes, then a parent that also closes.
- A `sync.Once` was not used.

Fix path:

1. Wrap close in `sync.Once`.
2. Or rearchitect: only one well-defined location closes.

### Symptom 4: "the receiver never wakes up"

Diagnosis: the channel was never closed, never sent to, and the receiver is blocked on `<-ch` or `for range ch`. Often combined with a producer that returned early due to an unrelated error.

Fix path:

1. Make sure the producer's `defer close(ch)` is at the top of its body, not nested inside a conditional.
2. If the producer can panic, ensure the deferred close still runs (it will, by Go's defer semantics).
3. If multiple producers, use a synchronising closer that waits for all of them.

### Symptom 5: race between close and send (sometimes panics, sometimes not)

Diagnosis: classic data race. The race detector catches it:

```
WARNING: DATA RACE
Write at 0x00c000010060 by goroutine 7:
  runtime.closechan()
      ...
Previous read at 0x00c000010060 by goroutine 8:
  ...
```

Fix: synchronise close with the sender population. Pattern 1, 2, 3, or 5.

### Symptom 6: "the program exits before consumers finish"

Diagnosis: `main` returned while consumers were still processing. Cause: `wg.Wait` skipped, no synchronisation, or `WaitGroup` counter is off by one.

Fix: every goroutine that must finish before `main` exits is tracked by a `WaitGroup` or `errgroup` that `main` waits on.

---

## Bounded Drain Patterns

When a producer is mid-send and you signal shutdown, the producer's send blocks until a reader appears. If no reader appears, the producer blocks forever. The fix: **drain**.

### Pattern: drain after cancel

```go
ctx, cancel := context.WithCancel(context.Background())
out := pipeline(ctx, source)

// consume some
for i := 0; i < 100; i++ {
    <-out
}

// stop early
cancel()

// drain remaining in-flight values
go func() {
    for range out {
        // discard
    }
}()
```

The drainer reads whatever the producer has in flight, allowing it to complete its `select` and exit via `ctx.Done()`. Without the drainer, the producer's send blocks; cancellation cannot complete.

### Pattern: bounded drain

```go
done := make(chan struct{})
go func() {
    defer close(done)
    for range out {
    }
}()

select {
case <-done:
case <-time.After(5 * time.Second):
    log.Println("drain timeout; producer may be stuck")
}
```

If drain doesn't complete in a bounded time, you have a bug — the producer is stuck somewhere not observing `ctx.Done()`.

### Avoid drain by closing the source

If you control the source, closing the source channel ends the producer's `for range`. Cancellation via `ctx.Done()` is needed only when source can't be closed (e.g., it's an infinite ticker).

---

## Close, Backpressure, and Drop Semantics

A buffered channel that fills up applies backpressure: senders block until space is available. Close interacts with this:

- A closed-with-data channel has a full buffer. Receivers drain it; only then does the channel report "closed and drained."
- The close itself does not drain the buffer.

### Bounded queues with close

```go
type Queue struct {
    in   chan Item
    done chan struct{}
}

func (q *Queue) Enqueue(it Item) error {
    select {
    case q.in <- it:
        return nil
    case <-q.done:
        return errors.New("queue closed")
    default:
        return errors.New("queue full") // non-blocking
    }
}
```

A "queue full" error is returned without blocking. Closing `done` makes `Enqueue` return "closed" rather than blocking on `in`.

### Drop-oldest semantics

For metrics or telemetry, dropping the *oldest* item is sometimes preferable:

```go
func (q *DropOldest) Push(it Item) {
    select {
    case q.ch <- it:
        return
    default:
        <-q.ch    // drop one
        q.ch <- it
    }
}
```

Close is orthogonal to drop policy; the policy applies during open operation only.

---

## Channels as Data Structures with Lifecycles

Treat each channel as an object with:

- Construction (`make`).
- Sends (mutation).
- Receives (consumption).
- Close (one-shot mutation; sets terminal state).
- Garbage collection (after no references remain).

This framing helps with design reviews. A channel embedded in a struct has the struct's lifecycle; a channel returned from a function has the lifecycle the caller assigns it.

### Channels in structs

```go
type Worker struct {
    in   chan Job
    out  chan Result
    done chan struct{}
    wg   sync.WaitGroup
}

func (w *Worker) Start() {
    w.wg.Add(1)
    go func() {
        defer w.wg.Done()
        for {
            select {
            case j := <-w.in:
                r := process(j)
                select {
                case w.out <- r:
                case <-w.done:
                    return
                }
            case <-w.done:
                return
            }
        }
    }()
}

func (w *Worker) Stop() {
    close(w.done)
    w.wg.Wait()
    close(w.in)
    close(w.out)
}
```

Lifetimes are explicit: the worker goroutine runs from `Start` to `Stop`; `Stop` closes done (signal), waits (drain), then closes the data channels.

### Channels passed in vs created in

A function that creates a channel and returns it owns the channel. The caller does not.

```go
// gen owns out; caller reads from it.
func gen(in []int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, v := range in {
            out <- v
        }
    }()
    return out
}
```

A function that takes a channel as a parameter does *not* own it. The caller does.

```go
// drainer does not own ch; do not close.
func drainer(ch <-chan int) {
    for range ch {
    }
}
```

If your function takes a `chan T` (bidirectional) parameter and the convention is "I'll close it when I'm done," document it. Better: take `chan<- T` (send-only) and have a separate `chan struct{}` for control.

---

## Close in Library APIs

Libraries that expose channels in their API surface must be explicit about close semantics.

### Idiom 1: return `<-chan T`, close internally

```go
// Stream returns events. The returned channel is closed when there are no more events.
func (c *Client) Stream(ctx context.Context) <-chan Event { /* ... */ }
```

The caller cannot close (type forbids it). The library is responsible. The contract: the channel will close when `ctx` is cancelled or when the stream naturally ends.

### Idiom 2: provide an explicit Close method

```go
type Stream struct{ /* ... */ }

func (s *Stream) Events() <-chan Event { return s.ch }

func (s *Stream) Close() error {
    s.once.Do(func() {
        close(s.done)
        s.wg.Wait()
        close(s.ch)
    })
    return s.err
}
```

The caller decides when to close. `Close` is idempotent (via `sync.Once`) and returns any accumulated error. After `Close`, the `Events()` channel is drained and stays closed.

### Idiom 3: closing a returned channel is undefined behaviour

Don't let callers close channels you returned. The contract should be: "we close, you read." If the caller closes, behaviour is undefined (probably future sends panic).

### Documentation template

```go
// Watch returns a channel that emits change events for the resource.
//
// The returned channel is closed under any of these conditions:
//   - ctx is cancelled
//   - the underlying watch ends (server reset, connection lost)
//   - Close is called on the underlying client
//
// The caller MUST NOT close the channel.
//
// The caller SHOULD drain the channel until it is closed; otherwise
// the watcher goroutine will leak.
```

---

## Comparison with Other Languages

| Language | Equivalent of "close" | Visibility |
|---|---|---|
| Go | `close(ch)` | Built-in; receivers see `ok = false` and `for range` exits. |
| Erlang | No channel close; processes exit instead. | Subscribers monitor processes; receive an `'EXIT'` message. |
| Java (`BlockingQueue`) | Often a sentinel "poison pill" value, or a separate flag. | Consumer checks for poison value or flag. |
| Rust (`mpsc::channel`) | All `Sender`s dropped → `Receiver` sees `Err(RecvError)`. | Compile-time ownership ensures clean drop. |
| Kotlin (`Channel`) | `channel.close()`, with optional cause. | Receivers see `ClosedReceiveChannelException` or `null` from `receiveCatching()`. |
| Clojure (`core.async`) | `(close! ch)` | Equivalent to Go; consumer sees `nil` after close. |
| Python (`asyncio.Queue`) | No close; sentinel pattern. | Consumer special-cases. |

Rust's drop-the-sender model is most rigorous: the type system tracks which scopes hold senders, and "close" is the last drop. Go's runtime-close is more flexible but requires programmer discipline.

---

## Anti-Lockup Recipes

### Recipe 1: every long-running goroutine has a stop case

```go
for {
    select {
    case <-ctx.Done():
        return
    case msg := <-in:
        handle(msg)
    }
}
```

No goroutine should block on a single channel without a cancellation path.

### Recipe 2: every send pairs with a cancellation case

```go
select {
case <-ctx.Done():
    return
case out <- v:
}
```

Even if you "know" downstream will be ready, defend against the case where it isn't.

### Recipe 3: every channel has a single closer

Document it. Code-review it. If a channel is closed in two places, one of them is a bug.

### Recipe 4: every shutdown has a timeout

```go
go func() {
    wg.Wait()
    close(done)
}()
select {
case <-done:
case <-time.After(timeout):
    log.Fatal("shutdown timed out")
}
```

If shutdown doesn't complete in time, you have a leaked goroutine. Better to crash and dump goroutine stacks than to silently leak.

### Recipe 5: use `errgroup` for "many goroutines, all must finish, error propagates"

```go
g, ctx := errgroup.WithContext(ctx)
for _, x := range items {
    x := x
    g.Go(func() error { return work(ctx, x) })
}
if err := g.Wait(); err != nil {
    log.Println(err)
}
```

`errgroup` handles WaitGroup + first-error reporting + context cancellation in one tool.

---

## Observability of Close Events

You cannot directly observe a `close` call from outside the process. But you can observe its effects:

### Metric 1: open channels (estimated)

Track per-channel-type counters via wrappers:

```go
type CountedChannel struct {
    Ch     chan int
    Name   string
    Opened atomic.Int64
    Closed atomic.Int64
}

func (c *CountedChannel) Close() {
    c.once.Do(func() {
        close(c.Ch)
        c.Closed.Add(1)
    })
}
```

Export to Prometheus. A persistent gap between `Opened` and `Closed` indicates leaks.

### Metric 2: goroutine count

`runtime.NumGoroutine()` is the cheapest aggregate health signal. A monotonically increasing goroutine count over hours is a leak.

### Metric 3: pprof goroutine sampling

Periodically capture a goroutine profile, hash the stacks, and count repeated stacks. A stack appearing in thousands of goroutines is the leak source.

### Metric 4: structured logs at close

```go
log.With(
    "channel", "results",
    "items_sent", sent,
    "items_dropped", dropped,
).Info("channel closed")
```

Per-channel lifecycle logging. Search by channel name in incident reviews.

### Trace 1: distributed tracing on goroutine spawns

OpenTelemetry spans for each goroutine. Each span has start, end, error. The span for a goroutine that never ends is visible in traces — a leak signal.

---

## Failure Modes That Wear a Close Disguise

### Symptom: panic "send on closed channel" under load only

Diagnosis: a race between close and send that only manifests with enough concurrency. The race detector reproduces it. Fix: synchronising closer or done channel.

### Symptom: a `for range` loop that "never sees the close"

Diagnosis: the close was on a *different* channel. Two channels with similar names; the wrong one was closed. Audit ownership and naming.

### Symptom: shutdown takes minutes instead of seconds

Diagnosis: a goroutine is in a long-running cgo call or non-cancellable syscall. Cancellation via close cannot interrupt it. Fix: bound the cgo or syscall with a deadline.

### Symptom: program exits but a goroutine continues writing to disk

Diagnosis: a goroutine outside the WaitGroup tree. `main` returned, but the goroutine is mid-syscall. Fix: register all background goroutines in a top-level errgroup.

### Symptom: `close(nil)` panic in a defer

```go
defer close(ch)
ch = make(chan int)
```

Common typo: assigning `ch` after the defer is registered. The defer captures the value of `ch` at function exit, which depends on whether `ch` is a local or a closure-captured variable. Audit.

### Symptom: a "shutdown timed out" log every deploy

Diagnosis: an unobserved leak. Probably a goroutine that blocks on a network read with no deadline. Set `SetReadDeadline` on all net.Conns.

---

## Self-Assessment

- [ ] I can cite the Go memory model guarantee for close and have used it as a synchronisation primitive (not just a signal).
- [ ] I have designed a shutdown architecture with a root context, group hierarchy, and bounded drains.
- [ ] I have documented channel ownership in code or design docs.
- [ ] I have built a pipeline of 5+ stages where cancellation cascades cleanly.
- [ ] I have diagnosed a "send on closed channel" panic in production by reading a panic trace and goroutine dump.
- [ ] I have used `sync.Once` correctly with close and explained why it is not sufficient alone (without stopping senders).
- [ ] I can articulate when to use a done channel vs `context.Context`.
- [ ] I have written a library API with explicit close semantics in the doc comment.
- [ ] I have observability in place to detect channel leaks (goroutine count, per-channel metrics, or pprof sampling).
- [ ] I can defend "we don't close this channel" as a design choice in a code review.

---

## Summary

Closing channels at senior level is an architectural concern, not a syntax concern. Key insights:

1. **The memory model gives close happens-before semantics.** Writes before close are visible to receivers — close is a synchronisation primitive.
2. **Every channel has an owner and a single closer.** Identify them at design time. Document them. If you can't, you have a bug nucleus.
3. **Shutdown is a phased operation**: signal (close done), drain (read in-flight values), wait (WaitGroup), reap (close data channels). The phases must happen in order.
4. **Close cascades through pipelines** when each stage applies the single-sender discipline to its own output. Cancellation arrives via `ctx.Done()`; the cascade is automatic.
5. **`context.Context` is the canonical broadcast-shutdown mechanism.** Built on `close(c.done)`. Use it for cancellation; use explicit done channels only for finer-grained signals.
6. **Library APIs must document close contracts**: who closes, when, and what happens if the caller does (typically: undefined behaviour, so use `<-chan T`).
7. **Observability is the safety net.** Goroutine count, per-channel metrics, and pprof sampling catch the leaks code review misses.
8. **Close failures wear disguises.** Long shutdown, send-on-closed-under-load, "the receiver never wakes" — diagnose by looking at the channel ownership graph and cancellation paths.

The professional level digs into `closechan` runtime internals, exactly which atomic operations occur, how sudog drain interacts with the scheduler, and the locking semantics that make close safe.
