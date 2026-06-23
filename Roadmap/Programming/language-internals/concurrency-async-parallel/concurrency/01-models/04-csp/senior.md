# CSP — Senior Level

> **Topic:** [CSP](README.md)
> **Focus:** Go runtime, structured concurrency, FDR verification

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [What You Can Build](#what-you-can-build)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)
23. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

At the senior level, CSP stops being a model you use and becomes a model you reason about. You no longer ask "how do I send a value on a channel" — you ask "what does the Go runtime actually do when chansend is called, what locks are taken, who wakes up which goroutine, and what does it cost in nanoseconds." You stop treating channels as magic and start treating them as a runtime data structure with measurable properties: contention behavior, lock granularity, allocation pressure, and scheduling fairness.

Senior engineers know when channels are the right answer and when they are the wrong one. Channels feel elegant, but elegance is not free. A `sync.Mutex` plus a `sync.Cond` will sometimes outperform a channel by 5–10x on contended workloads. A buffered channel of size one is sometimes just a worse version of an atomic pointer. A complex `select` statement with five cases and a timeout can be replaced by a single goroutine reading from one channel and a context. The skill is knowing which.

This level also crosses into formal verification. Hoare's CSP was originally an algebra — processes, prefixes, choice, refinement. Tools like FDR can verify that your protocol is deadlock-free, that one process refines another, that two processes are observationally equivalent. Real production systems rarely run FDR on their code, but the *vocabulary* — refinement, trace equivalence, livelock — is exactly what senior engineers reach for when arguing about correctness in code review.

And finally, this level reaches into the future of CSP: structured concurrency. Nathaniel Smith's essay "Notes on structured concurrency, or: Go statement considered harmful" argued that Go's bare `go` statement is the moral equivalent of `goto` — it lets concurrency escape the current scope without a guarantee that anyone will ever wait for it. Trio, Kotlin coroutines, Swift Task groups, and Java's Project Loom have all taken that critique seriously. Understanding it changes how you write Go.

---

## Prerequisites

- Solid understanding of [channels, goroutines, and `select`](../../../../../languages/golang/05-concurrency/README.md).
- Familiarity with mutexes, condition variables, and atomic operations.
- Comfort reading Go runtime source (or at least the `runtime/chan.go` file).
- Awareness of the Go scheduler: G/M/P model, work stealing, gopark/goready.
- Experience debugging goroutine leaks with `pprof` and `go tool trace`.
- Exposure to context cancellation patterns.
- Optional but useful: any encounter with formal methods (TLA+, FDR, Alloy, Spin).

---

## Glossary

- **hchan** — The runtime struct backing every Go channel; holds the ring buffer, send/recv wait queues, and lock.
- **sudog** — A pseudo-G structure used to represent a goroutine waiting in a channel queue.
- **gopark / goready** — Runtime functions that suspend and resume goroutines on the scheduler.
- **Refinement (FDR)** — A relation between two CSP processes where one is a "more deterministic" version of the other.
- **Trace equivalence** — Two processes that produce the same set of observable event sequences.
- **Deadlock freedom** — Property that the system always has some process able to make progress.
- **Livelock** — System keeps moving but makes no useful progress.
- **Structured concurrency** — Discipline where every spawned task has a parent scope that waits for its completion.
- **Nursery / TaskGroup** — A lexical scope that owns a set of concurrent tasks.
- **Backpressure** — Mechanism by which slow consumers slow down fast producers.
- **Fan-out / fan-in** — Distributing work to many workers and collecting results.
- **Goroutine leak** — A goroutine that lives forever because no one will ever unblock it.
- **Panic on double close** — Closing an already-closed channel panics; closing nil panics; sending on closed panics.
- **Reactive Streams** — Async stream protocol with explicit `request(n)` backpressure, contrast with CSP's implicit blocking.
- **CSPm** — Machine-readable CSP, the language fed to FDR.

---

## Core Concepts

### 1. The Go runtime's channel implementation

A Go channel is not magic. It is a struct called `hchan` defined in `runtime/chan.go`. Conceptually:

```go
type hchan struct {
    qcount   uint           // number of elements currently in buffer
    dataqsiz uint           // size of the ring buffer
    buf      unsafe.Pointer // ring buffer
    elemsize uint16
    closed   uint32
    elemtype *_type
    sendx    uint           // send index into ring
    recvx    uint           // recv index into ring
    recvq    waitq          // list of recv waiters (sudogs)
    sendq    waitq          // list of send waiters (sudogs)
    lock     mutex          // protects all of the above
}
```

When you write `ch <- v`, the runtime calls `chansend`. The flow is roughly:

1. Acquire `ch.lock`.
2. If the channel is closed, panic.
3. If there is a receiver already waiting in `recvq`, dequeue it, copy the value directly into its stack frame, mark it runnable via `goready`, release the lock, return.
4. Otherwise, if the buffer has space (`qcount < dataqsiz`), copy the value into `buf[sendx]`, advance `sendx`, release the lock, return.
5. Otherwise, attach the current goroutine as a `sudog` to `sendq`, release the lock, and call `gopark`. The goroutine is now suspended.
6. When a receiver later wakes us up, we return from `gopark` and complete.

A crucial detail: when a sender hands off a value directly to a parked receiver, the value never touches the buffer. This is a *direct write to the receiver's stack*. It is fast — one memcpy — but it requires that the receiver's goroutine struct still describe a valid stack location, which is part of why moving stacks must coordinate with sudogs.

### 2. The cost of channels

Every channel send and receive has overhead the language does not advertise:

- **Atomic operations and lock acquisition.** Acquiring `ch.lock` is an atomic CAS in the uncontended case and a futex-equivalent park in the contended case.
- **Scheduler hooks.** `gopark` and `goready` are not free — they invoke the scheduler, may trigger stealing, and touch global state.
- **sudog allocation.** Each waiter needs a sudog, which is pool-allocated but still costs cycles.
- **Memory copies.** Each send is at least one memcpy of `elemsize` bytes; for large structs this dominates.

Microbenchmarks typically show:

- Uncontended unbuffered send/recv pair: ~50–100 ns on modern hardware.
- A bare `sync.Mutex` Lock/Unlock pair: ~10–20 ns.
- An atomic load/store: ~1 ns.

This means: if you have a single shared counter, a channel is *5x to 100x slower* than `atomic.AddInt64`. If you have a state machine with ten transitions per microsecond, a channel is the wrong primitive.

### 3. When channels are wrong

Use a mutex when:

- You are protecting a small piece of state with very short critical sections.
- The contention pattern is "many readers, one writer" (use `sync.RWMutex`).
- You need fine-grained locking that maps onto data structures (a per-bucket lock in a hash map).

Use a condition variable when:

- You need to wait for an arbitrary predicate, not just "a value arrived."
- You have multiple waiters with different conditions and want to signal selectively.

Use an atomic when:

- Your protected state is a single word.
- The operation is read-modify-write that can be expressed as CAS, add, or swap.

Channels win when:

- You need to *move ownership* of a value from one goroutine to another.
- You need to *select* over multiple sources of events.
- You want the receiver to *block until data arrives* without writing a wait predicate.

### 4. Structured concurrency adapted from CSP

Nathaniel Smith argued in "Notes on structured concurrency" that `go f()` is `goto` for concurrency: it spawns work that escapes the current scope with no parent waiting on it. Errors get lost. Cancellation does not propagate. Leaks happen silently.

His alternative, implemented in Trio (Python) and inspired by occam's `PAR`, is the **nursery**: a lexical scope in which all spawned tasks must complete before the scope exits.

```python
async with trio.open_nursery() as nursery:
    nursery.start_soon(task_a)
    nursery.start_soon(task_b)
# when we reach this line, both tasks have finished
# if either raised, the exception propagates here
```

Go has no native nursery. The closest analogue is `errgroup.Group` from `golang.org/x/sync`, but it is opt-in, not enforced by the language. Senior Go engineers know that *every* `go` statement should either:

- Have a clear parent that will wait for it (via `WaitGroup`, channel close, or errgroup), or
- Be a documented long-lived service with a clear shutdown signal.

The bare `go f()` with no plan for completion is a bug.

### 5. Formal verification with FDR

FDR (Failures Divergences Refinement) is a model checker for CSP. It takes a process specification in CSPm and answers questions like:

- Is this process deadlock-free?
- Does process `Impl` refine process `Spec` (i.e., every behavior of `Impl` is allowed by `Spec`)?
- Are `P` and `Q` trace-equivalent?

A toy example: a one-place buffer.

```cspm
channel in, out : {0..1}
ONE = in?x -> out!x -> ONE
SPEC = in?x -> out!x -> SPEC
assert SPEC [T= ONE
```

This says: `SPEC` is trace-refined by `ONE`. If we accidentally allowed `ONE` to output a value that was never input, the refinement check would fail and FDR would print the violating trace.

Production engineers don't usually run FDR. But the *vocabulary* — refinement, trace, deadlock check — is exactly how senior engineers argue about concurrency on whiteboards.

### 6. Pipeline pattern at scale

A pipeline is `stage1 -> chan -> stage2 -> chan -> stage3`. At small scale it just works. At production scale you must answer:

- **Backpressure**: if `stage2` is slow, do producers stall (good) or do they pile up in an unbounded queue (bad)?
- **Slow stages**: what if `stage2` occasionally takes 100x longer? Do you parallelize that stage with fan-out/fan-in?
- **Monitoring**: how do you know each stage's utilization? Expose `len(ch)/cap(ch)` as a Prometheus metric.
- **Shutdown**: when input closes, do you drain pending work or drop it?

### 7. Backpressure in CSP

CSP's backpressure model is implicit. A bounded channel of capacity `N` says: "I will accept up to `N` pending messages; beyond that, you block." This is elegant — the producer learns the consumer is slow by experiencing a stall — but it has a property worth noting: **the producer's stall is the entire feedback mechanism.** There is no `request(n)` token like in Reactive Streams. There is no rate limit. There is no priority. There is only "the buffer is full, you wait."

### 8. Reactive streams vs CSP channels

Reactive Streams (RxJava, Project Reactor, Akka Streams) use explicit backpressure: the consumer sends a `request(n)` token upstream, and the producer is allowed to emit up to `n` items. CSP-style channels use implicit backpressure via blocking.

Trade-offs:

- Reactive Streams give the consumer explicit control — you can request 10, process them, request 10 more, build adaptive flow control.
- CSP is simpler — the buffer size is the contract.
- Reactive Streams add complexity: callback hell, hard stack traces, hot vs cold publishers.
- CSP is sequential within a goroutine, so stack traces are clean and `for-range-chan` is idiomatic.

### 9. Cancellation correctness

The classic trap: you have a goroutine that sends on a channel and respects context cancellation. You write:

```go
go func() {
    select {
    case ch <- value:
    case <-ctx.Done():
    }
}()
```

This is correct only if either the receiver is ready or the context is cancelled. If neither happens, the goroutine blocks forever — leak. The fix is to ensure `ctx` *will* be cancelled when no one will ever receive. That is a property of the *system*, not of this goroutine.

### 10. Common senior-level Go bugs

- **Goroutine leaks from forgotten select cases.** A select with three cases but the parent only cancels one of them.
- **Slow consumer memory growth.** A buffered channel grows because the producer is fast and the consumer is slow.
- **Ticker that never stops.** `time.NewTicker` returns a ticker that must be `.Stop()`'d or it leaks a goroutine.
- **Panic-on-double-close.** Closing a closed channel panics. Always have a single owner.
- **Nil channel in select.** A nil channel case is permanently blocked — sometimes useful, often a bug.

---

## Real-World Analogies

- **Air traffic control.** Channels are the radio frequencies; goroutines are the planes. A controller (the runtime) routes requests, but no one talks unless someone is listening.
- **Restaurant kitchen with order tickets.** The order rail is the channel; chefs pull tickets when ready. If the rail fills up, the front-of-house must wait — natural backpressure.
- **Bucket brigade.** Each person passes a bucket to the next. If anyone slows down, the whole line slows. No central coordinator needed.

---

## Mental Models

- **Channels as runtime data structures.** Not magic. Locks, queues, and scheduler hooks.
- **Direct hand-off.** Unbuffered sends copy directly into the receiver's stack. The buffer is not used.
- **Buffered channel as a bounded queue.** Capacity is the contract for backpressure.
- **Nil channel as eternal block.** Useful as a way to disable a select case.
- **Closed channel as broadcast.** Every receiver gets the zero value forever. Excellent for shutdown signals.
- **Structured concurrency as a discipline.** Every spawn has a waiter.

---

## Code Examples

### Example 1 — Monitoring service aggregating events

A monitoring service receives events from many goroutines and aggregates them into per-minute buckets.

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type Event struct {
    Kind   string
    Value  float64
    Time   time.Time
}

type Bucket struct {
    Count int
    Sum   float64
}

type Monitor struct {
    in      chan Event
    buckets map[string]*Bucket
    mu      sync.Mutex
}

func NewMonitor(buf int) *Monitor {
    return &Monitor{
        in:      make(chan Event, buf),
        buckets: make(map[string]*Bucket),
    }
}

func (m *Monitor) Send(e Event) bool {
    select {
    case m.in <- e:
        return true
    default:
        return false // drop on overflow, don't block producer
    }
}

func (m *Monitor) Run(ctx context.Context) {
    flush := time.NewTicker(time.Second)
    defer flush.Stop()

    for {
        select {
        case <-ctx.Done():
            m.dump("shutdown")
            return
        case <-flush.C:
            m.dump("tick")
        case e, ok := <-m.in:
            if !ok {
                return
            }
            m.mu.Lock()
            b, ok := m.buckets[e.Kind]
            if !ok {
                b = &Bucket{}
                m.buckets[e.Kind] = b
            }
            b.Count++
            b.Sum += e.Value
            m.mu.Unlock()
        }
    }
}

func (m *Monitor) dump(reason string) {
    m.mu.Lock()
    defer m.mu.Unlock()
    for k, b := range m.buckets {
        fmt.Printf("[%s] %s: count=%d sum=%.2f\n", reason, k, b.Count, b.Sum)
    }
    m.buckets = make(map[string]*Bucket)
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel()

    m := NewMonitor(1024)
    go m.Run(ctx)

    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := 0; j < 1000; j++ {
                m.Send(Event{Kind: fmt.Sprintf("worker-%d", id), Value: float64(j), Time: time.Now()})
                time.Sleep(time.Microsecond * 100)
            }
        }(i)
    }
    wg.Wait()
    cancel()
    time.Sleep(100 * time.Millisecond)
}
```

Notes:

- The producer uses a non-blocking send with `select { case ... default: }` so a slow monitor cannot stall the workload.
- The monitor uses a ticker for periodic flush plus a context for shutdown.
- The ticker is `Stop`'d in `defer` — critical to avoid leaking the underlying timer goroutine.

### Example 2 — API gateway pipeline fanning out to 4 backends

The gateway receives a request, fans it out to four backends in parallel, and returns the first successful response (or all errors).

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "math/rand"
    "sync"
    "time"
)

type Response struct {
    Backend string
    Body    string
    Err     error
}

func callBackend(ctx context.Context, name string) Response {
    delay := time.Duration(rand.Intn(200)) * time.Millisecond
    select {
    case <-ctx.Done():
        return Response{Backend: name, Err: ctx.Err()}
    case <-time.After(delay):
        if rand.Intn(4) == 0 {
            return Response{Backend: name, Err: errors.New("backend failure")}
        }
        return Response{Backend: name, Body: fmt.Sprintf("%s ok", name)}
    }
}

func gateway(ctx context.Context, backends []string) (Response, []error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel() // ensures all stragglers learn we're done

    results := make(chan Response, len(backends))
    var wg sync.WaitGroup
    for _, b := range backends {
        wg.Add(1)
        go func(name string) {
            defer wg.Done()
            select {
            case results <- callBackend(ctx, name):
            case <-ctx.Done():
            }
        }(b)
    }

    // Close results when all goroutines finish; needed for the drain.
    go func() {
        wg.Wait()
        close(results)
    }()

    var errs []error
    for r := range results {
        if r.Err == nil {
            cancel()  // cancel siblings
            // drain remaining (they will exit via ctx)
            for range results {
            }
            return r, nil
        }
        errs = append(errs, r.Err)
    }
    return Response{}, errs
}

func main() {
    rand.Seed(time.Now().UnixNano())
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    resp, errs := gateway(ctx, []string{"a", "b", "c", "d"})
    if resp.Err == nil && resp.Body != "" {
        fmt.Println("got:", resp.Body)
    } else {
        fmt.Println("all failed:", errs)
    }
}
```

Notes:

- `cancel()` is called both on success (to cancel siblings) and via `defer` (to catch the error path).
- The `select` on `results <- ...` vs `<-ctx.Done()` ensures workers don't block sending into a channel no one will read.
- The `wg.Wait` -> `close(results)` pattern is the canonical way to know "all senders are done." Forget this and the receiver may hang.

### Example 3 — Debug walkthrough of goroutine leak from leftover sender

Buggy code:

```go
func leak() <-chan int {
    out := make(chan int)
    go func() {
        for i := 0; i < 10; i++ {
            out <- i  // blocks forever if no one reads
        }
        close(out)
    }()
    return out
}

func consumer() {
    ch := leak()
    for v := range ch {
        if v == 3 {
            return // early exit -- sender is now stuck on `out <- 4`
        }
        fmt.Println(v)
    }
}
```

When `consumer` returns early at `v == 3`, the sender goroutine is parked on `out <- 4` forever. The hchan is still alive (referenced by the parked goroutine), the goroutine never runs again, and a `pprof` goroutine dump would show it sleeping on `chan send`.

Fix using context:

```go
func notLeak(ctx context.Context) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < 10; i++ {
            select {
            case out <- i:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func goodConsumer() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel() // tells the producer we are done
    ch := notLeak(ctx)
    for v := range ch {
        if v == 3 {
            return
        }
        fmt.Println(v)
    }
}
```

The crucial change: the consumer signals "I'm done" via `cancel()`, and the producer's `select` lets it unblock and exit cleanly. The `defer cancel()` makes this true even on panic or early return.

---

## Pros & Cons

| Pros | Cons |
| --- | --- |
| Clean separation of communication and computation. | Channel ops cost ~50–100 ns; not appropriate for hot paths. |
| Backpressure is implicit and natural. | Coordination is implicit — easy to write subtle deadlocks. |
| `select` enables event multiplexing without callbacks. | `select` semantics get tricky with nil channels and closed cases. |
| Goroutine leaks are diagnosable with `pprof`. | Bare `go` is `goto`-equivalent — escapes scope. |
| Composes well into pipelines and fan-out/fan-in. | No first-class structured concurrency in Go (yet). |
| Suits CSP-style formal reasoning. | Hard to reason about liveness without a model checker. |

---

## Use Cases

- High-throughput pipelines (log processing, ETL).
- API gateways with backend fan-out.
- Monitoring and metrics aggregation.
- Workflow orchestration with parallel stages.
- Coordinated shutdown of long-lived services.
- Rate-limited request dispatchers.

When to *avoid*:

- Hot critical sections (use mutex).
- Counters and gauges (use atomic).
- Shared cache lines (use atomic or mutex with cache-line padding).

---

## Coding Patterns

### Fan-out / fan-in

```go
func fanOut(in <-chan Job, n int) []<-chan Result {
    outs := make([]<-chan Result, n)
    for i := 0; i < n; i++ {
        out := make(chan Result)
        outs[i] = out
        go func() {
            defer close(out)
            for job := range in {
                out <- process(job)
            }
        }()
    }
    return outs
}

func fanIn(ctx context.Context, ins ...<-chan Result) <-chan Result {
    out := make(chan Result)
    var wg sync.WaitGroup
    for _, c := range ins {
        wg.Add(1)
        go func(c <-chan Result) {
            defer wg.Done()
            for v := range c {
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            }
        }(c)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

### Tee channel

```go
func tee(ctx context.Context, in <-chan int) (<-chan int, <-chan int) {
    a, b := make(chan int), make(chan int)
    go func() {
        defer close(a)
        defer close(b)
        for v := range in {
            ca, cb := a, b
            for i := 0; i < 2; i++ {
                select {
                case <-ctx.Done():
                    return
                case ca <- v:
                    ca = nil // disable this case
                case cb <- v:
                    cb = nil
                }
            }
        }
    }()
    return a, b
}
```

Note the `ca = nil` idiom — setting a channel to nil disables its case in `select`, ensuring each value is sent to each output exactly once.

### Bridge channel

```go
func bridge(ctx context.Context, chans <-chan <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for {
            var stream <-chan int
            select {
            case maybeStream, ok := <-chans:
                if !ok {
                    return
                }
                stream = maybeStream
            case <-ctx.Done():
                return
            }
            for v := range orDone(ctx, stream) {
                select {
                case out <- v:
                case <-ctx.Done():
                }
            }
        }
    }()
    return out
}
```

---

## Clean Code

- Channel directions in function signatures: accept `<-chan` and return `chan<-` when you can.
- One owner closes a channel. Document who that is in a comment.
- Bound every channel unless you have an explicit reason for unbounded.
- Always pair `time.NewTicker` and `time.NewTimer` with `defer t.Stop()`.
- Wrap concurrent helpers with comments stating their lifetime contract: "this goroutine exits when ctx is cancelled or in is closed."
- Use `errgroup.Group` instead of raw `WaitGroup` when goroutines can fail.
- Keep `select` statements small — five cases is a smell, ten is a bug.

---

## Best Practices

- **Have a parent for every goroutine.** Treat bare `go f()` as the equivalent of a `goto`. Either wait for it, or document why it's a service.
- **Always reason about who closes.** A channel has exactly one closer — the sender, or a coordinator. Never close from the receiver.
- **Measure before assuming channels are fast.** Profile with `go test -bench` and `pprof`. Mutexes often win.
- **Watch buffer sizes.** A buffer larger than necessary hides backpressure and grows memory. A buffer smaller than necessary causes false stalls.
- **Use context for cancellation, not custom done channels.** The standard library and ecosystem expect contexts.
- **Expose channel utilization as metrics.** `len(ch)` and `cap(ch)` are observable; report them.
- **Reach for `errgroup` for grouped lifetimes.** It is the closest thing Go has to a nursery.
- **Write tests with `-race`.** Every concurrent function should be exercised under the race detector.

---

## Edge Cases & Pitfalls

- **Closed-channel receive returns the zero value, not an error.** Use the two-value form `v, ok := <-ch`.
- **Send on closed panics.** Always make sure the closer is the only sender, or use a separate done channel.
- **Close on nil panics.** Defensive code sometimes catches this.
- **Select with all cases nil blocks forever.** Useful for tests; surprising in production.
- **Channels are not GC roots.** A blocked goroutine on a channel keeps both the goroutine *and* the channel alive.
- **Time.After leaks.** `time.After(t)` creates a timer that lives until expiry; in a hot loop, prefer `time.NewTimer` with explicit `Stop`.
- **Range over a channel doesn't see cancellation.** You must use `select` with `<-ctx.Done()`.

---

## Common Mistakes

- Closing a channel from the receive side.
- Using a buffered channel of size 1 instead of `sync.Mutex` to "synchronize" — slower and harder to read.
- Sharing a channel between many closers.
- Using `time.After` in a hot select loop.
- Forgetting to drain a result channel after early exit (causes sender leak).
- Spawning workers with `go` without a `WaitGroup` or errgroup to wait for them.
- Treating `select` as random when in fact case selection is fair-pseudo-random and you need ordering — add explicit prioritization.

---

## Tricky Points

- **Direct hand-off vs buffered drop.** An unbuffered send to a parked receiver is faster than a buffered send to an empty buffer because it skips the memcpy into and out of the ring.
- **Select fairness.** When multiple cases are ready, Go chooses one pseudo-randomly. This is fair on average but not deterministic.
- **Buffered channels and ordering.** A buffered channel preserves FIFO order. An unbuffered channel does too, but only because there's only one sender-receiver pair active at a time.
- **GOMAXPROCS interaction.** A pipeline with eight stages on a 4-core machine doesn't parallelize fully — some stages will time-share.
- **Channel send/recv in a loop with `default`.** Acts as a busy poll. Almost always wrong.

---

## Test Yourself

1. Walk through the runtime's `chansend` for an unbuffered channel where the receiver is parked. Which struct holds the parked receiver? Where is the value copied?
2. Write a benchmark comparing `sync.Mutex` and a single-cap buffered channel for a counter increment. Which is faster? By how much?
3. Implement a structured-concurrency-style `WithNursery(func(*Nursery))` helper using `errgroup`. What guarantees does it give that bare `go` doesn't?
4. Write a CSPm specification for a producer-consumer with a one-place buffer. Assert no deadlock.
5. Find a goroutine leak in a small program using `pprof`. What is the goroutine's wait reason in the dump?

---

## Tricky Questions

**Q1.** Why does `len(ch)` on a channel hold the channel's lock?
**A.** Because the buffer state can be mutated concurrently by senders and receivers, an unlocked read would observe a torn count. The lock is short but real.

**Q2.** What happens if you `select` over a closed channel and a ready receive?
**A.** Both cases are runnable. Go picks one pseudo-randomly. The closed channel case returns the zero value immediately.

**Q3.** Why is `time.After` in a hot loop a memory leak?
**A.** Each call creates a new `runtimeTimer` that lives until expiry. In a tight loop, many timers accumulate; even though they expire, the goroutine and channel objects sit in the timer wheel.

**Q4.** Can `select` starve a case?
**A.** Not in the single-iteration sense — Go picks fairly among ready cases. But if one channel is always ready when the select runs, others may rarely fire. Add deliberate prioritization if you need it.

**Q5.** Is `make(chan int, 0)` the same as `make(chan int)`?
**A.** Yes. Both are unbuffered.

**Q6.** When does a buffered channel act unbuffered?
**A.** When the buffer is full and a sender arrives — the sender blocks. From the sender's perspective, this is identical to the unbuffered case.

**Q7.** What is the runtime's "directRecv" optimization?
**A.** When `chansend` finds a parked receiver, it copies the value *directly* from the sender's variable into the receiver's stack frame, skipping the ring buffer entirely. This is the fast path for unbuffered channels.

---

## Cheat Sheet

```text
hchan struct:    qcount, dataqsiz, buf, sendx, recvx, sendq, recvq, lock
chansend flow:   lock -> if closed panic -> if recv waiting handoff -> if buf room enqueue -> else gopark
chanrecv flow:   lock -> if buf nonempty dequeue -> if send waiting handoff -> if closed return zero,false -> else gopark
cost:            channel op ~50-100ns, mutex op ~10-20ns, atomic ~1ns
nil channel:     blocks forever in send/recv; useful to disable select case
closed channel:  recv returns zero,false forever; send panics; close panics
ticker:          must Stop, else timer goroutine leaks
ctx in select:   case <-ctx.Done(): is the standard cancellation case
structured:      every spawn needs a waiter; use errgroup, not bare go
verification:    FDR checks refinement, deadlock, equivalence
```

---

## Summary

At the senior level, CSP is not just a programming model — it is a vocabulary for reasoning about concurrent systems, a runtime data structure you can measure, and a philosophy of structured concurrency that critiques the language you use it in. You stop asking "is this channel correct?" and start asking "what does the runtime do here, what does it cost, and is there a simpler primitive that would do the same job better?" You learn when channels are wrong, when mutexes are right, and when the only honest answer is "model-check it."

The Go runtime's hchan and its `chansend`/`chanrecv` dance are the implementation; CSPm and FDR are the formalism; Trio and errgroup are the next-generation discipline. A senior engineer holds all three in their head at once and reaches for the right one for the situation.

---

## What You Can Build

- A high-throughput, multi-stage telemetry pipeline with per-stage backpressure and observability.
- An API gateway with parallel backend dispatch, hedged requests, and coordinated cancellation.
- A general-purpose nursery library that enforces structured concurrency on top of Go's primitives.
- A static analyzer that flags bare `go` statements without a clear lifetime contract.
- A CSPm model of your critical concurrent code paths, verified with FDR.

---

## Further Reading

- Tony Hoare, *Communicating Sequential Processes* (1985 book, free online).
- A.W. Roscoe, *Understanding Concurrent Systems* — modern CSP textbook.
- Nathaniel J. Smith, "Notes on structured concurrency, or: Go statement considered harmful."
- Go runtime source: `runtime/chan.go` and `runtime/select.go`.
- Roberto Clapis, "Go runtime: 4 years later" talks.
- Bryan C. Mills, "Rethinking Classical Concurrency Patterns" (GopherCon talk).
- `golang.org/x/sync/errgroup` documentation.
- FDR4 user guide and CSPm tutorial.

---

## Related Topics

- [Actor Model](../05-actor-model/README.md) — alternative concurrency model with mailboxes instead of rendezvous.
- [Shared Memory & Locks](../06-shared-memory/README.md) — the primitives channels are sometimes worse than.
- [Go Scheduler](../../../../languages/golang/05-concurrency/scheduler/README.md) — how goroutines actually run.
- [Context Package](../../../../languages/golang/15-go-source-reading/04-context-source/README.md) — the standard cancellation primitive.
- [Structured Concurrency](../../09-structured-concurrency/README.md) — the modern discipline.

---

## Diagrams & Visual Aids

### Channel runtime structure

```text
+-----------------------+
|       hchan           |
+-----------------------+
| qcount, dataqsiz      |
| buf -> [ . . . . . ]  |  ring buffer of dataqsiz slots
| sendx, recvx          |
| recvq -> sudog -> ... |  waiting receivers
| sendq -> sudog -> ... |  waiting senders
| lock                  |
+-----------------------+
```

### chansend decision tree

```text
chansend(ch, v):
  lock(ch.lock)
  if ch.closed: panic
  if recvq nonempty:
      sg = recvq.dequeue()
      copy v -> sg.elem            # direct hand-off
      goready(sg.g)
      unlock; return
  if qcount < dataqsiz:
      copy v -> buf[sendx]
      sendx = (sendx + 1) % dataqsiz
      qcount++
      unlock; return
  mysg = acquireSudog(); mysg.elem = &v; mysg.g = G
  sendq.enqueue(mysg)
  gopark(unlock)                    # releases ch.lock atomically
  # later: receiver wakes us
  releaseSudog(mysg); return
```

### Fan-out / fan-in topology

```text
                    +---> worker1 ---+
                    |                |
input  --->  chan ---+---> worker2 ---+---> merge chan ---> result
                    |                |
                    +---> worker3 ---+
```

### Structured concurrency scope

```text
nursery_start
   |
   +-- spawn task A ---|
   +-- spawn task B ---|
   +-- spawn task C ---|
   |                   |
   +<------------------+   nursery waits for all
nursery_end
   (errors propagated out of this scope)
```

### Goroutine leak detection flow

```text
go tool pprof -goroutine running-binary
   |
   v
look for goroutines parked on chan send / chan recv
   |
   v
identify the channel via stack frame
   |
   v
find who should have closed it or received from it
   |
   v
add ctx.Done() to the select, or close the channel from the owner
```
