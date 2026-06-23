# Channels — Senior Level

> **Topic:** [Channels](README.md)
> **Focus:** runtime internals, perf, lock-free alternatives, MPMC libs

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

At the junior level you learned that channels move data between goroutines. At the middle level you learned that they implement CSP, support select, and replace many uses of explicit locks. At the senior level the romance ends. A channel is not magic. It is a mutex, a ring buffer, and two FIFO wait queues, glued to the scheduler. Every send and every receive walks through those data structures and pays for the lock, the atomics, the parking, and the wake-up.

This file is about that cost — when it matters, when it does not, and what to reach for when it does. We will walk through Go's `hchan` line by line, measure where the microseconds go, and compare against lock-free alternatives like crossbeam, kanal, and the LMAX Disruptor. We will look at the production failure modes that only show up at scale: leaked goroutines from forgotten select cases, unbounded buffers under slow consumers, ticker leaks, and the difference between `tokio::sync::mpsc` and `std::sync::mpsc` when you mix async and blocking.

The thesis is simple. Channels are the right default for clarity and correctness. They are the wrong choice when the message rate, message size, or contention pattern makes the per-operation overhead dominate useful work. Knowing which side of that line you are on is the senior skill.

---

## Prerequisites

You should already be comfortable with:

- The mechanics of unbuffered, buffered, and closed channels (junior level).
- Select with default, timeout, and cancellation via context (middle level).
- Mutexes, atomics, and memory ordering at least at the acquire/release level.
- The Go scheduler basics: G, M, P, run queues, parking and unparking.
- Reading a CPU profile and identifying contention through a block or mutex profile.
- The difference between blocking and async runtimes; how Tokio schedules tasks.
- Cache lines, false sharing, and why a hot atomic counter destroys throughput.

If any of those feel shaky, the rest of this file will read like a list of warnings without a target. Revisit middle level first.

---

## Glossary

- **hchan** — the Go runtime struct that backs every channel.
- **sudog** — a "pseudo-G", a node placed on a channel's wait queue when a goroutine blocks on send or receive.
- **gopark / goready** — runtime primitives that suspend and resume a goroutine.
- **MPMC** — multiple producer, multiple consumer.
- **SPSC** — single producer, single consumer; the only configuration where truly lock-free ring buffers are simple.
- **Lock-free** — progress is guaranteed for at least one thread; no thread holds a lock that can block others.
- **Wait-free** — every thread makes progress in a bounded number of steps.
- **Disruptor** — LMAX's SPSC/MPMC ring buffer using cursor sequences and barriers.
- **Crossbeam** — Rust crate offering bounded and unbounded MPMC channels and lock-free queues.
- **Kanal** — Rust channel crate emphasising low latency and zero-copy under contention.
- **Backpressure** — the mechanism by which a slow consumer slows down a fast producer.
- **Block profile** — Go's profile of where goroutines spend time blocked on synchronisation.
- **Goroutine leak** — a goroutine that will never make progress and never be collected.
- **Oneshot** — a channel sized 1 used exactly once for a single value, then dropped.

---

## Core Concepts

### Go runtime: the `hchan` struct

In `src/runtime/chan.go` of the Go source tree the channel type is roughly:

```go
type hchan struct {
    qcount   uint           // number of items in the buffer
    dataqsiz uint           // capacity of the ring buffer
    buf      unsafe.Pointer // pointer to the ring buffer array
    elemsize uint16
    closed   uint32
    elemtype *_type
    sendx    uint           // send index into buf
    recvx    uint           // recv index into buf
    recvq    waitq          // queue of waiting receivers (sudog)
    sendq    waitq          // queue of waiting senders   (sudog)
    lock     mutex          // a real mutex
}
```

This is not lock-free, not even lockless on the fast path. Every send and every receive acquires `c.lock`. The lock is a Go runtime `mutex` (futex on Linux) — cheaper than `sync.Mutex` because it does not need to integrate with `sync` semantics, but still a lock.

### `runtime.chansend` walkthrough

The send path, simplified:

1. If `c == nil`, block forever (panic if non-blocking).
2. Lock `c.lock`.
3. If a receiver is waiting in `recvq`, hand the value directly to it (skip the buffer entirely), unlock, `goready` the receiver, return.
4. Otherwise if the buffer has room, copy the value into `buf[sendx]`, increment `sendx`, `qcount++`, unlock, return.
5. Otherwise (full / unbuffered with no receiver), create a `sudog`, attach it to `sendq`, `gopark`. When unparked, the value has been handed off; return.

The "direct hand-off" path is critical: an unbuffered channel never touches the buffer. The cost is the lock plus a copy plus a park/wake pair.

### The cost: lock + atomics + scheduler hooks

A channel send under no contention is in the order of 50–150 nanoseconds on modern x86: lock acquire, copy, lock release. Under contention with parking it is 1–5 microseconds because `gopark`/`goready` involve queue manipulation, M handoff, and a scheduler trip. Across a million operations per second this is the difference between 50ms and 5s of CPU time. Plan accordingly.

### When channels lose: high contention with short messages

If you are pushing 10 million `int64`s per second through a single channel between two goroutines, the channel mutex becomes the bottleneck. A `sync.Mutex` plus a slice plus a `sync.Cond` is often slightly slower than a channel because it adds another wake. But a sharded queue, a per-P ring buffer, or a dedicated SPSC ring buffer can be 5–20x faster because there is no shared lock at all.

The rule of thumb: if your message is small (< 64 bytes), your rate is high (> 1M/s), and contention is real (multiple goroutines hammering one channel), measure. The channel may not be the right tool.

### Lock-free channel implementations

- **crossbeam** in Rust: `crossbeam::channel::bounded` and `unbounded` use a segmented ring buffer with atomic head/tail. The bounded variant is MPMC and lock-free on the fast path.
- **kanal** in Rust: aggressive on latency, sometimes uses futexes directly and avoids allocations.
- **LMAX Disruptor** (Java, ported to many languages): a SPSC or MPSC ring buffer where producers and consumers each hold a cursor. No CAS retries on the consumer side in SPSC. Used in trading systems for sub-microsecond latency.

None of these are free. Lock-free queues have more complex invariants, harder backoff strategies, and pathological cases (e.g. ABA, retry storms under saturation). They are not always faster under realistic load; they are usually faster under specific high-contention regimes.

### Backpressure: bounded channels as the only natural mechanism

A bounded channel of size N implements backpressure by default: when full, the sender blocks. This is the single greatest argument for channels over queues. An unbounded queue with a slow consumer is an OOM waiting to happen. A bounded channel forces the producer to slow down or shed load. Choose a size, do not choose unbounded. Unbounded is not a feature, it is a deferred disaster.

### Memory cost: large messages copy through the buffer

A buffered channel of `[1024]byte` with capacity 1000 reserves about 1 MB of contiguous memory at creation. Send copies the value into the buffer. Receive copies it out. If your messages are large structs, pass pointers, not values — but then you are responsible for ensuring the producer no longer mutates the value after sending. The channel does not give you ownership semantics like Rust does.

### The "channel as semaphore" idiom

```go
sem := make(chan struct{}, N)
for _, job := range jobs {
    sem <- struct{}{}
    go func(j Job) {
        defer func() { <-sem }()
        process(j)
    }(job)
}
```

A buffered channel of size N is a counting semaphore with zero allocation per acquire (because `struct{}` is zero-sized). Idiomatic in Go and surprisingly performant.

### Profiling channel contention

- `runtime.SetBlockProfileRate(1)` — every blocking event is sampled. Then `go tool pprof http://.../debug/pprof/block`.
- `runtime.SetMutexProfileFraction(1)` — same for mutexes, including `hchan.lock`.
- `runtime/trace` (the `go tool trace` viewer) shows per-G timelines, where you see goroutines parked on channels with exact reasons.

If the block profile shows large self time on `runtime.chanrecv` or `runtime.chansend`, you have contention. The fix is usually fewer goroutines, sharded channels, batched messages, or a different primitive.

### Common production bugs

- **Leaked goroutines from forgotten select cases.** A select that does not have a context-cancel case will park forever if its peer dies.
- **Tickers not stopped.** `time.Tick` returns a channel and leaks the timer forever. Use `time.NewTicker` and defer `Stop()`.
- **Slow consumer + unbounded buffer = OOM.** Bound your buffers. Always.
- **Goroutine per request without limits.** A panic or a stalled downstream piles goroutines into the channel's `sendq` and grows memory unboundedly.

### Tokio mpsc vs std::sync::mpsc

- `std::sync::mpsc` is a blocking channel. Calling `recv()` in an async task blocks the entire executor thread.
- `tokio::sync::mpsc` is a Future-aware channel. `recv().await` yields back to the runtime when empty.
- `crossbeam::channel` is also blocking but supports `select!` and is generally faster than std's.

Inside an async runtime, use `tokio::sync::mpsc` (or `flume`, which is dual blocking/async). Mixing `std::sync::mpsc::recv()` into a Tokio task starves other tasks on that worker.

### The "channel of result" anti-pattern

For request-reply, a common mistake is:

```go
req := Request{ReplyCh: make(chan Response, 1)}
worker <- req
resp := <-req.ReplyCh
```

This is fine, but if you only ever send one value to `ReplyCh`, a Rust-style `oneshot` channel (one-shot, single-value) is leaner and conveys intent. In Go, a buffered channel of size 1 is the equivalent. The anti-pattern is when developers reuse `ReplyCh` for multiple values, forget to close it, and leak.

---

## Real-World Analogies

- **Bank teller window with a queue.** The teller is a goroutine; the window is the channel; the queue is the wait queue. When the queue is empty and a customer arrives, the teller is already waiting (direct hand-off). When the teller is busy and the queue is full, the next customer is told to wait outside (backpressure).
- **Conveyor belt at customs.** The belt has fixed capacity. Bags pile up if officers are slow; arrivals are throttled when full. This is bounded channel backpressure.
- **A pneumatic tube system in a hospital.** The tube can carry one capsule at a time; messages are physical. This is an unbuffered channel — every send synchronises with a receive.
- **Stock exchange limit order book.** Many producers, many consumers, microsecond latencies, no locks anywhere. This is the LMAX Disruptor.

---

## Mental Models

### Model 1: a channel is a mutex with two queues

Forget the abstract CSP picture. At runtime there is one lock, one ring buffer, one sender queue, one receiver queue. Every operation acquires the lock, manipulates the queues or the buffer, then releases. The cost is whatever a contended mutex costs, plus copy, plus scheduler hooks when goroutines block.

### Model 2: send/receive is either fast path or slow path

The fast path is: lock, copy, unlock — ~100ns. The slow path is: lock, enqueue self, unlock, park, ..., be woken, copy, unpark — ~2µs. Optimising for throughput means staying on the fast path; optimising for latency means knowing the slow path budget.

### Model 3: channels are about ownership transfer, not data

Sending a pointer through a channel says "I am done with this; you own it now." If both sides keep references and mutate, the channel did not protect you — it just delivered a pointer. The channel is a synchronisation primitive that happens to deliver a value.

### Model 4: bounded channels are flow-control valves

The size of your channel is a knob. Size 0 means lock-step coupling. Size N means N units of slack between producer and consumer. Size infinity means you have no flow control and you are betting your memory on the consumer's speed. Size your channels deliberately.

---

## Code Examples

### Example 1: runtime/trace analysis of a Go pipeline

```go
package main

import (
    "context"
    "fmt"
    "os"
    "runtime/trace"
    "time"
)

// stage produces n integers, then closes.
func stage1(ctx context.Context, n int) <-chan int {
    out := make(chan int, 16)
    go func() {
        defer close(out)
        for i := 0; i < n; i++ {
            select {
            case out <- i:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

// stage2 transforms input -> output, simulating CPU-bound work.
func stage2(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int, 16)
    go func() {
        defer close(out)
        for v := range in {
            // simulate work; this is intentionally cheap so the channel cost dominates
            v = v*31 + 7
            select {
            case out <- v:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

// stage3 consumes and sums.
func stage3(ctx context.Context, in <-chan int) int {
    sum := 0
    for v := range in {
        sum += v
        _ = ctx
    }
    return sum
}

func main() {
    f, err := os.Create("trace.out")
    if err != nil {
        panic(err)
    }
    defer f.Close()
    if err := trace.Start(f); err != nil {
        panic(err)
    }
    defer trace.Stop()

    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()

    start := time.Now()
    c1 := stage1(ctx, 1_000_000)
    c2 := stage2(ctx, c1)
    sum := stage3(ctx, c2)
    fmt.Printf("sum=%d in %v\n", sum, time.Since(start))
}
```

Run:

```
go run pipeline.go
go tool trace trace.out
```

In the trace viewer, navigate to "Goroutine analysis". You will see three goroutines, each spending most of their time blocked on channel send or receive. The "Network blocking profile" will be empty; the "Synchronisation blocking profile" will show your channels. This is how you confirm that the workload is channel-bound, not CPU-bound. Doubling the buffer from 16 to 1024 will reduce parking events and may double throughput. Inlining stage2's work into stage1 will halve the channel traffic and usually win outright.

### Example 2: crossbeam vs std::sync::mpsc benchmark

```rust
// Cargo.toml dependencies:
//   crossbeam-channel = "0.5"
//   criterion = "0.5"
// Run: cargo bench --bench channels

use crossbeam_channel as xc;
use std::sync::mpsc;
use std::thread;
use std::time::Instant;

const N: usize = 1_000_000;

fn bench_std() -> u128 {
    let (tx, rx) = mpsc::channel::<u64>();
    let t = thread::spawn(move || {
        let mut sum: u64 = 0;
        while let Ok(v) = rx.recv() {
            sum = sum.wrapping_add(v);
        }
        sum
    });
    let start = Instant::now();
    for i in 0..N as u64 {
        tx.send(i).unwrap();
    }
    drop(tx);
    let _ = t.join().unwrap();
    start.elapsed().as_micros()
}

fn bench_crossbeam_bounded() -> u128 {
    let (tx, rx) = xc::bounded::<u64>(1024);
    let t = thread::spawn(move || {
        let mut sum: u64 = 0;
        while let Ok(v) = rx.recv() {
            sum = sum.wrapping_add(v);
        }
        sum
    });
    let start = Instant::now();
    for i in 0..N as u64 {
        tx.send(i).unwrap();
    }
    drop(tx);
    let _ = t.join().unwrap();
    start.elapsed().as_micros()
}

fn main() {
    let s = bench_std();
    let c = bench_crossbeam_bounded();
    println!("std::sync::mpsc      {N} msgs: {s} us  ({:.2} M msg/s)", N as f64 / s as f64);
    println!("crossbeam bounded    {N} msgs: {c} us  ({:.2} M msg/s)", N as f64 / c as f64);
}
```

On a typical laptop, crossbeam's bounded MPMC channel will move 5–10x more messages per second than std's mpsc in this SPSC pattern, because std's mpsc is a Mutex over a queue while crossbeam uses a segmented lock-free ring. Try `xc::unbounded()` too; it is also fast but has no backpressure.

### Example 3: LMAX Disruptor mini-implementation (SPSC ring buffer)

```go
package disruptor

import (
    "runtime"
    "sync/atomic"
)

// SPSCRing is a single-producer single-consumer ring buffer.
// Sizes must be a power of two for cheap modulo via mask.
type SPSCRing struct {
    mask uint64
    buf  []uint64
    // pad to avoid false sharing
    _    [64]byte
    head atomic.Uint64 // written by producer, read by consumer
    _    [64]byte
    tail atomic.Uint64 // written by consumer, read by producer
    _    [64]byte
}

func New(size uint64) *SPSCRing {
    if size == 0 || size&(size-1) != 0 {
        panic("size must be a power of two")
    }
    return &SPSCRing{mask: size - 1, buf: make([]uint64, size)}
}

// Publish blocks (spin) until there is room, then writes v.
func (r *SPSCRing) Publish(v uint64) {
    head := r.head.Load()
    for {
        tail := r.tail.Load()
        if head-tail < uint64(len(r.buf)) {
            r.buf[head&r.mask] = v
            r.head.Store(head + 1) // release: makes the write visible
            return
        }
        runtime.Gosched()
    }
}

// Consume blocks (spin) until a value is available, returns it.
func (r *SPSCRing) Consume() uint64 {
    tail := r.tail.Load()
    for {
        head := r.head.Load() // acquire: sees Publish's store
        if tail < head {
            v := r.buf[tail&r.mask]
            r.tail.Store(tail + 1)
            return v
        }
        runtime.Gosched()
    }
}
```

Usage:

```go
r := disruptor.New(1024)
go func() {
    for i := uint64(0); i < 1_000_000; i++ {
        r.Publish(i)
    }
}()
var sum uint64
for i := 0; i < 1_000_000; i++ {
    sum += r.Consume()
}
```

This SPSC ring is roughly 10x faster than a Go channel for the same workload because there is no lock, no allocation, no scheduler interaction in the common case. The cost: only one producer and one consumer; busy-spinning instead of parking; cache padding to avoid false sharing on head/tail. This is the LMAX Disruptor's core idea. For MPMC, add a "claim sequence" CAS loop and per-producer cursors; complexity grows quickly.

### Example 4: goroutine leak detection with pprof

```go
package main

import (
    "context"
    "fmt"
    "net/http"
    _ "net/http/pprof"
    "time"
)

// brokenWorker forgets to honour ctx.Done. It will leak on every call.
func brokenWorker(ctx context.Context, in <-chan int) {
    for v := range in {
        // simulate slow work; doesn't watch ctx
        time.Sleep(10 * time.Millisecond)
        _ = v
    }
}

// fixedWorker watches ctx and exits.
func fixedWorker(ctx context.Context, in <-chan int) {
    for {
        select {
        case <-ctx.Done():
            return
        case v, ok := <-in:
            if !ok {
                return
            }
            time.Sleep(10 * time.Millisecond)
            _ = v
        }
    }
}

func main() {
    go http.ListenAndServe("localhost:6060", nil)
    in := make(chan int) // unbuffered; sender blocks if no receiver
    for i := 0; i < 100; i++ {
        ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
        go brokenWorker(ctx, in)
        cancel() // ctx is dead, but brokenWorker never checks
    }
    fmt.Println("visit http://localhost:6060/debug/pprof/goroutine?debug=1")
    time.Sleep(1 * time.Hour)
}
```

Visit the pprof endpoint and look for stacks ending in `runtime.gopark` on `chan receive`. Each goroutine is parked forever on a channel nobody will send to. The fix is `fixedWorker`: every goroutine that reads or writes a channel must also have a way out via context.

---

## Pros & Cons

### Pros (when used correctly)

- Built into Go, no library to import; idiomatic.
- Backpressure for free with bounded size.
- Select lets you compose channels with timeouts and cancellation.
- Direct hand-off between sender and receiver on unbuffered channels avoids buffer copy.
- Simpler invariants than lock-free queues; easier to reason about.

### Cons (when pushed beyond their sweet spot)

- Lock-based on the fast path; not scalable to dozens of producers and consumers.
- Per-operation overhead in the 100ns–microsecond range.
- No ownership semantics; sender can still hold pointers post-send.
- Copies large values through the buffer.
- No batch send/receive in the standard library.
- Leak-prone if you forget the cancel case in a select.

---

## Use Cases

- **Pipeline stages** — stage 1 produces, stage 2 transforms, stage 3 sinks. Channels are the right glue.
- **Fan-out to a worker pool** — one input channel, N workers reading. Bounded channel of jobs throttles producers.
- **Fan-in from many goroutines** — N producers into one channel; the receiver gets a serialized stream.
- **Timeouts and cancellation** — via select on `ctx.Done()`.
- **Rate limiting via semaphore** — `make(chan struct{}, N)` as a counter.
- **Notification / event signalling** — `chan struct{}` for "something happened, no payload".
- **Request-reply** — embed a `replyCh` in the request struct.

Avoid channels when:

- The hot path is hundreds of millions of ops per second between two threads (use SPSC ring buffers).
- You need MPMC at low microsecond latency under heavy contention (use crossbeam, Disruptor, kanal).
- You only need shared-memory state with locked reads/writes (use a mutex; do not invent a channel-based state machine).

---

## Coding Patterns

### Pattern 1: closing is the producer's job

Only the producer side closes a channel. Consumers detect close via the two-value receive `v, ok := <-ch`. If multiple producers exist, none of them owns the close; introduce a separate done-channel or a `sync.WaitGroup` and have a coordinator close the channel after the WaitGroup completes.

### Pattern 2: select with cancellation, always

Every send and every receive in long-running code should be in a select with at least one of `<-ctx.Done()`, a `done` channel, or a timeout. The cost is one extra case; the benefit is no leaked goroutines.

### Pattern 3: bound everything

```go
jobs := make(chan Job, 64) // not make(chan Job)
results := make(chan Result, 64)
```

The right size depends on producer/consumer rates. Start with something like `runtime.NumCPU() * 2` and tune via the block profile.

### Pattern 4: oneshot reply

```go
type Req struct{ Reply chan Resp }
req := Req{Reply: make(chan Resp, 1)} // buffered 1 so worker never blocks on send
worker <- req
resp := <-req.Reply
```

Buffered size 1 means the worker can send and return even if the caller has not yet read.

### Pattern 5: tee / broadcast

Standard channels are point-to-point. To broadcast, fan-out manually or use a `sync.Cond` / `golang.org/x/sync/errgroup`-style helper. Closing a channel is the only built-in broadcast — every receiver sees it.

---

## Clean Code

- Name channels for the items they carry: `jobs`, `results`, `errs`, `done` — not `c1`, `c2`.
- Direction-typed parameters: `func consume(in <-chan Job)`, `func produce() <-chan Job`. The compiler enforces intent.
- Keep send and close ownership clear in comments. "The producer closes `jobs`." One sentence saves hours.
- One responsibility per channel. Do not multiplex unrelated message types through one `interface{}` channel.
- Pair every long-lived goroutine that owns a channel with a clear shutdown story: who closes, who cancels, who joins.

---

## Best Practices

1. **Default to bounded.** Unbounded channels are a tail risk you do not need.
2. **Size deliberately.** Use the block profile to confirm the size is right.
3. **One closer per channel.** Document it.
4. **Always select on context** in any non-trivial goroutine.
5. **`defer ticker.Stop()`** when using `time.NewTicker`.
6. **Avoid `time.After` in hot loops** — it allocates a timer per call that lives until it fires.
7. **Prefer pointers for large messages.** Transfer ownership in comment and convention.
8. **Profile under realistic load.** Channel cost is invisible until your workload reaches the regime where it dominates.
9. **Match the runtime.** In Tokio use `tokio::sync::mpsc`; in async-std use `async_std::channel`; in blocking Rust use `crossbeam`.
10. **Reach for SPSC rings or Disruptor only after measuring.** Premature lock-freedom is its own bug factory.

---

## Edge Cases & Pitfalls

- **Send on closed channel panics.** Receivers reading from a closed channel get the zero value with `ok = false`.
- **Closing a nil channel panics.** Sending to or receiving from a nil channel blocks forever.
- **Range over a non-closed channel never exits.** If the producer dies without closing, the consumer hangs.
- **Select with all nil cases blocks forever.** Sometimes intentional (disable a case by nilling it), often a bug.
- **A buffered channel does not guarantee delivery on close.** Closing while items are in the buffer still lets receivers drain them, but if the receiver exits before draining, those items are gone.
- **Receiving on `<-ctx.Done()` after the context is cancelled is non-blocking** — useful pattern for a quick "is ctx still alive" check inside loops.
- **`time.After` leaks the timer until it fires** even if you have already moved on; use `time.NewTimer` + `Stop()` in hot paths.
- **A select case `case v, ok := <-c:` distinguishes "channel closed" (`ok == false`) from "received the zero value" (`ok == true`). Forgetting `ok` is a silent bug.
- **Direct hand-off skips the buffer.** If you rely on FIFO across many producers via an unbuffered channel, items may be delivered in non-arrival order under contention.

---

## Common Mistakes

- Treating channels as cheap globally. They are cheap individually; they are not free in aggregate.
- Using one big unbuffered channel as a worker dispatch — every send pays for a park/unpark.
- Calling `<-time.After(d)` in every loop iteration of a long-running goroutine. Use a single `time.NewTimer` and reset it.
- Sending pointers and continuing to mutate them.
- Closing a channel from a consumer ("I'm done reading"). Senders cannot tell, will panic on next send.
- Using a channel of `error` to propagate cancellation. Use a context.
- Reaching for a lock-free queue without first profiling to confirm the channel is the bottleneck.
- Mixing `std::sync::mpsc::recv` (blocking) inside an async runtime.

---

## Tricky Points

- **Buffer size 1 is special.** It enables a single-element handshake without parking. Useful for oneshot replies.
- **`select` over many cases is O(n).** It shuffles the cases (PRNG) then walks them. With dozens of cases this becomes a real cost.
- **`runtime.Gosched()` in a spin loop is polite but not equivalent to channel parking.** It re-enters the scheduler with the goroutine still runnable.
- **A closed channel can be selected on for a non-blocking "is it done?" check.** `select { case <-done: return; default: }` checks without committing.
- **Channel ordering across goroutines.** Send to a buffered channel from G1, send to the same channel from G2; receive order is not deterministic relative to wall clock.
- **`hchan` allocates on the heap.** Even a zero-buffer channel is an allocation.
- **Inlining tiny work into a single goroutine usually beats a two-stage pipeline** at extreme rates, because the channel cost exceeds the work.

---

## Test Yourself

1. Walk through `runtime.chansend1` for a buffered channel that is not full and has no waiting receivers. List every lock acquire, every copy, every atomic operation.
2. What is the difference between `recvq` direct hand-off and `buf` copy paths, in terms of cost and observable order?
3. You have 8 producers and 8 consumers and one channel. Latency is 50µs per send. What are three things you would change before reaching for a lock-free queue?
4. Why does `chan struct{}` allocate nothing per send but `chan int` does not need to allocate either? Where does the `int` live?
5. Implement a bounded MPMC ring buffer in Rust with `crossbeam-utils::CachePadded` and explain where you placed the padding.
6. Why does the LMAX Disruptor spin instead of park? Under what hardware/workload assumption is that correct?
7. Show a code path where forgetting `defer ticker.Stop()` leaks more than just a goroutine.
8. In Tokio, what happens if you call `std::sync::mpsc::Receiver::recv` from a `#[tokio::main]` task? Why is `tokio::sync::mpsc::Receiver::recv().await` the right choice?
9. Sketch a "channel of result" interaction and the equivalent Rust `oneshot` interaction. Why is `oneshot` strictly more expressive in Rust's type system?
10. Use `runtime/trace` on the pipeline example and identify the dominant cost (parking, lock contention, scheduling). What change reduces it most?

---

## Tricky Questions

1. A goroutine sends 1M ints through an unbuffered channel to another goroutine. CPU usage is 200% (two cores busy). Is the channel the bottleneck? How do you confirm? What is the maximum throughput you would expect?
2. You replace the unbuffered channel with a buffer of 4096. Throughput doubles. Why? At what buffer size does the gain plateau, and why?
3. You replace the channel with a `sync.Mutex` plus a `[]int`. Throughput drops 30%. Why?
4. You replace it with a SPSC ring buffer like Example 3. Throughput goes up 10x. Why does this not break ordering or memory safety?
5. You run the same workload in Rust with crossbeam bounded. Throughput is similar to the Go SPSC ring. Why is crossbeam competitive even though it is MPMC?
6. Add 7 more producer goroutines to the Go SPSC ring. What happens? How would you adapt it (still keeping single consumer) — and why might a channel become competitive again?
7. You see goroutine count climbing in production. Block profile shows time on `runtime.chanrecv`. What are the three most likely causes?
8. Your service does 100k RPS, each request spawns 5 goroutines that talk via channels. CPU is 30% on `runtime.chansend`. Is this a problem? When does it become one?
9. Why is `select` with two cases dramatically cheaper than `select` with twenty cases, in absolute and relative terms?
10. In a Tokio service you have a `tokio::sync::mpsc` channel between a producer task and a consumer task. The consumer falls behind. What happens to the producer? What are your options to recover?
11. Compare passing a 1KB struct by value through a channel versus passing a `*Struct` pointer through a channel. Which is faster? Which is safer? When does the answer flip?
12. The block profile shows `runtime.chanrecv` at 80% of blocked time, but CPU is at 5%. Is the channel the bottleneck? What is?

---

## Cheat Sheet

```
Operation                          Typical cost (modern x86)
-----------------------------------------------------------
Channel send, no contention        80-150 ns
Channel send, parked then resumed  1-5 µs
sync.Mutex Lock/Unlock, uncontended 20-30 ns
sync.Mutex Lock/Unlock, contended   100s ns - µs
atomic.Add (uncontended)            5-10 ns
atomic.Add (contended)              50-100+ ns
SPSC ring buffer push/pop           5-15 ns

Channel sizing
--------------
size 0       lock-step, every send synchronises with a receive
size 1       handshake / oneshot reply
size N small smooths bursts, gives backpressure
unbounded    never; you have no flow control

Common bugs
-----------
- close on consumer side               -> panic
- send to nil channel                  -> hangs forever
- select with no ctx case              -> goroutine leak on peer death
- time.After in hot loop               -> timer leak until fire
- unbounded buffer + slow consumer     -> OOM
- closed channel still in select       -> case fires immediately every time

Profile
-------
runtime.SetBlockProfileRate(1)         block profile (parked goroutines)
runtime.SetMutexProfileFraction(1)     mutex profile (incl. hchan.lock)
go tool trace trace.out                per-G timeline
go tool pprof .../goroutine            current goroutine stacks
```

---

## Summary

Channels are a brilliant high-level primitive built on a humble low-level reality: one mutex, one ring buffer, two wait queues, and a tight integration with the scheduler. That reality decides where they win and where they lose. They win on clarity, backpressure, and composability with select. They lose on raw throughput once contention or message rate exceeds the regime their lock can serve.

At the senior level the work is to know your numbers — 100 nanoseconds on the fast path, single-digit microseconds on the slow path, and how many of each your workload generates per second. You should be able to read a block profile, identify the dominant cost, and decide whether the fix is a bigger buffer, a different pattern, a sharded channel, or a different primitive altogether — crossbeam, kanal, LMAX Disruptor, or a hand-rolled SPSC ring.

You should also know the production failure modes by heart: the forgotten select case that leaks a goroutine, the ticker that is never stopped, the unbounded buffer that is one slow consumer away from OOM, and the std-vs-Tokio channel mismatch that starves async tasks. These are the bugs that survive every test suite and only show up under load.

The deeper lesson: most code does not need lock-free magic. Most code needs a bounded channel, a clear shutdown story, and a select on context. Reach for the heavy machinery when the profile, not the temptation, demands it.

---

## What You Can Build

- A latency-sensitive trading-style event bus using a Disruptor-style SPSC ring with cache-padded cursors.
- A high-throughput log shipper where producers write structured records into a bounded crossbeam channel and a fixed pool of consumers ship them off.
- An adaptive worker pool that adjusts its size based on the block-profile signal from its input channel.
- A backpressure-aware HTTP proxy that drops or 429s when its internal job channel is full, instead of queueing unbounded.
- A pipeline microbenchmark harness that compares Go channels, `sync.Mutex` + slice, crossbeam bounded, std mpsc, kanal, and a hand-rolled SPSC ring under identical load patterns.
- A goroutine-leak detector library that snapshots `runtime.Stack` between operations and alerts when goroutine count drifts upward.

---

## Further Reading

- The Go runtime source — `src/runtime/chan.go`. The most important reading you can do on this topic.
- Dmitry Vyukov's writings on lock-free queues and the Go scheduler.
- The LMAX Disruptor technical paper (Thompson, Farley, Barker, Gee, Stewart).
- Crossbeam channel documentation and source on GitHub.
- Tokio documentation on synchronisation primitives, especially the mpsc and oneshot pages.
- "Concurrency in Go" by Katherine Cox-Buday — pipeline patterns.
- Jeff Preshing's blog on lock-free programming and memory ordering.
- The kanal Rust crate and its benchmarks against crossbeam, flume, and std.
- "Designing Data-Intensive Applications" — backpressure and stream processing chapters.
- Go's `runtime/trace` documentation and Dave Cheney's tutorials.

---

## Related Topics

- [Mutex](../03-mutex-rwmutex/README.md) — the primitive channels are built on.
- [Atomic operations](../02-atomic-operations/README.md) — the building blocks of lock-free alternatives.
- [Semaphore](../06-semaphore/README.md) — what a buffered channel of `struct{}` actually is.
- [Cond variable](../07-cond-variable/README.md) — when channels are overkill for "wait for state change".
- [Concurrency models](../../01-models/README.md) — CSP, actor, shared-memory, and where channels fit.
- [Profiling techniques](/Roadmap/Programming/quality-engineering/performance/README.md) — block profiles, trace viewer.
- [Backpressure and flow control](../../async-programming/README.md) — how async runtimes generalise the same idea.

---

## Diagrams & Visual Aids

### The `hchan` layout

```
+--------- hchan ---------+
| qcount, dataqsiz        |
| buf -> [ . . . . . . ]  |  ring buffer of dataqsiz elements
| sendx, recvx            |  indices into buf
| recvq:  [G1] -> [G2]    |  receivers parked, waiting for value
| sendq:  [G7] -> [G8]    |  senders parked, waiting for room
| lock                    |  runtime mutex
+-------------------------+
```

### Send path (fast and slow)

```
chansend(v):
  lock(c.lock)
  if recvq not empty:
      receiver = dequeue(recvq)
      copy v -> receiver's frame      <-- direct hand-off (fast)
      unlock
      goready(receiver)
      return
  if buffer has room:
      buf[sendx] = v                  <-- buffer copy (fast)
      sendx++; qcount++
      unlock
      return
  // slow path
  enqueue(sendq, self)
  unlock
  gopark(...)                         <-- park; another G will copy from our frame later
  return
```

### Pipeline with bounded buffers and cancellation

```
       [ctx]
        |  |
        v  v
 [P]  >--ch1 (buf=16)-->  [T]  >--ch2 (buf=16)-->  [C]
        ^                  ^                          ^
        |                  |                          |
     select on            select on                  range until close
     ctx.Done             ctx.Done
```

### Where the time goes (microbenchmark intuition)

```
Channel send (no contention)   ##                100 ns
Channel send (parked + resume) ############       2-5 us
SPSC ring push                 #                  10 ns
crossbeam bounded send (~SPSC) ##                  20-40 ns
sync.Mutex contended           ####                300+ ns
```

### Goroutine leak pattern

```
Caller:                    Worker:
  ch <- req                  for v := range ch { ... }   <-- never sees ctx
  cancel(ctx)                                           <-- ignored
  return                                                 worker still parked on <-ch forever
```

### Bounded vs unbounded under slow consumer

```
Bounded (size N):
  P --> [ X X X X ]  --X--> C(slow)
  P blocks when full; load is shed at the edge.

Unbounded:
  P --> [ X X X X X X X X X ... grows ...] --X--> C(slow)
  Memory rises until OOM.
```

### Disruptor SPSC layout (cache-padded)

```
+--- head (producer cursor) ---+ <pad 64B>
+--- buf [ . . . . . . . . ] --+
+--- tail (consumer cursor) --+  <pad 64B>

Producer:  if head - tail < cap, write at head & mask, head++ (release)
Consumer:  if tail < head, read at tail & mask, tail++
```
