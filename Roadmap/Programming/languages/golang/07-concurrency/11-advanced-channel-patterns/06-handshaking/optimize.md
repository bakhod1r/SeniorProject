---
layout: default
title: Handshaking — Optimize
parent: Advanced Channel Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/11-advanced-channel-patterns/06-handshaking/optimize/
---

# Handshaking — Optimize

[← Back](../)

> A practical look at when handshake overhead matters and what to do about it. Three layers: cost of one channel op; cost of one request/ack cycle; cost of choosing the wrong pattern.

## Table of Contents
1. [The cost of a channel operation](#the-cost-of-a-channel-operation)
2. [Channel-of-channels vs request/ack vs done channel](#channel-of-channels-vs-requestack-vs-done-channel)
3. [Allocation reduction techniques](#allocation-reduction-techniques)
4. [Batching the handshake](#batching-the-handshake)
5. [Atomics as a replacement](#atomics-as-a-replacement)
6. [Benchmarking handshakes](#benchmarking-handshakes)
7. [When not to optimise](#when-not-to-optimise)

---

## The cost of a channel operation

On a modern x86-64 server, a single uncontended send-then-receive on an unbuffered channel costs roughly **150–300 ns** (Go 1.22, AMD64, Linux). A close costs about the same as a send. Allocation of a fresh unbuffered `chan struct{}` is around **80 ns** plus its 96-byte hchan header on the heap.

Compare that to:

- Atomic increment: **3–5 ns**.
- Mutex lock + unlock (uncontended): **15–25 ns**.
- `runtime.Gosched()`: **40 ns**.
- HTTP handler dispatch: tens of microseconds.

The takeaway: channels are not free, but they are cheap *enough* that they disappear into the noise of any real workload until your QPS is in the high tens of thousands.

The numbers above are reproducible with `go test -bench=.`:

```go
func BenchmarkRendezvous(b *testing.B) {
    c := make(chan struct{})
    go func() {
        for range b.N {
            <-c
        }
    }()
    for range b.N {
        c <- struct{}{}
    }
}
```

Profile with `go test -bench=. -cpuprofile=cpu.prof` and inspect `runtime.chansend` / `runtime.chanrecv` time.

---

## Channel-of-channels vs request/ack vs done channel

Three common handshake shapes have measurably different costs.

| Pattern | Channels per request | Allocations | Typical use |
|---------|----------------------|-------------|-------------|
| Done channel (close-as-broadcast) | 1 shared | 0 per signal | "Stop everything" |
| Request/ack with embedded reply | 1 per request | 1 channel + 1 struct per request | RPC-like serial worker |
| `chan chan T` dispatch | 1 per worker (reused) | 0 per request | Fan-out to N workers |

### Done channel

The cheapest. One channel, allocated once at startup, closed once at shutdown. Receivers `select { case <-done: }` at cost equivalent to a check of a flag — Go's `select` is implemented as a sequence of fast non-blocking probes on each case before parking.

For services with millions of short-lived goroutines that share one cancellation context, this is the only pattern that scales.

### Request/ack with reply channel

Allocating a fresh `chan T` per request is the expensive part. At 80 ns per allocation plus the GC pressure of a 96-byte heap object, a 100k-QPS workload spends roughly 8 ms/s in channel allocation alone — recoverable, but not negligible.

Optimisations:

1. **Buffered capacity 1** so the worker's send never blocks; saves the cost of parking the worker goroutine on an abandoned reply.
2. **Pool the reply channels** with `sync.Pool`:

```go
var replyPool = sync.Pool{
    New: func() any { return make(chan int, 1) },
}

func newReq() *Req {
    r := &Req{}
    r.Reply = replyPool.Get().(chan int)
    return r
}

func freeReq(r *Req) {
    // drain any leftover value so the channel can be reused
    select {
    case <-r.Reply:
    default:
    }
    replyPool.Put(r.Reply)
}
```

In benchmarks this can drop allocation per request from one channel to zero. Caveat: pooling channels is subtle — a stray value from the previous user can poison the next. Drain defensively.

### `chan chan T`

Allocations are amortised: each worker allocates its inner channel once at startup and reuses it for every job. The dispatcher's per-job cost is one read from `pool` and one send into the worker's channel — roughly 2× the cost of a single unbuffered handoff.

The compelling property is *backpressure*: workers can only advertise when idle, so the dispatch channel naturally limits the in-flight job count. Compared to a shared `chan Job`, where the dispatcher cannot distinguish busy from idle workers, this is structurally healthier even before performance is considered.

---

## Allocation reduction techniques

### 1. Reuse channels

A single long-lived channel costs nothing per use. Allocate at startup, close at shutdown. Avoid the pattern of `make(chan T)` inside a hot loop.

### 2. `chan struct{}` for signals

`struct{}` has size zero. The runtime knows this and avoids copying. Always prefer `chan struct{}` over `chan bool` for signal-only channels.

### 3. Pool requests, not just channels

If your request type carries a reply channel, pool the whole request:

```go
var reqPool = sync.Pool{
    New: func() any { return &Req{Reply: make(chan int, 1)} },
}
```

Resetting requires care: reset all fields, drain the reply channel before reuse.

### 4. Avoid `select` with a single default case in hot paths

```go
// slower
select {
case ch <- v:
default:
}

// faster, when you know the channel is buffered
ch <- v
```

The `select { default }` adds the cost of the select machinery for no synchronisation gain.

---

## Batching the handshake

A request/ack loop pays one handshake per request. If your workload tolerates latency in the millisecond range, batching collapses many handshakes into one:

```go
type Batch struct {
    Items []Item
    Reply chan []Result
}

func client(b *Batcher, items []Item) []Result {
    batch := Batch{Items: items, Reply: make(chan []Result, 1)}
    b.in <- batch
    return <-batch.Reply
}
```

The worker amortises the channel cost across `len(items)`. For internal microservices that handle thousands of requests per second, batching is often the single highest-leverage performance win.

The trade-off is latency: a batch of N requests waits for N-1 friends, or for a timeout, before being dispatched. Bound the wait with a small `time.AfterFunc` deadline.

---

## Atomics as a replacement

Some handshakes do not need the bidirectional synchronisation a channel offers — only a happens-before barrier. For those, `sync/atomic` is faster.

### One-shot ready flag

```go
var ready int32

func setup() {
    // ... do init
    atomic.StoreInt32(&ready, 1)
}

func use() {
    for atomic.LoadInt32(&ready) == 0 {
        runtime.Gosched()
    }
    // ... safe to use
}
```

Faster than a channel: the load is a single instruction. But the consumer must spin-wait, which is acceptable only if the wait is microseconds — for longer waits the channel is still better because it parks the goroutine.

For Go 1.19+, `atomic.Bool` and `atomic.Pointer[T]` provide typed equivalents.

### Read-mostly state

If the handshake is "the worker writes once, many readers check," use an `atomic.Pointer[Config]` rather than a channel-distributed configuration.

---

## Benchmarking handshakes

Three rules:

### 1. Compare apples to apples

Benchmarking `BenchmarkChannel` and `BenchmarkAtomic` is meaningless if the channel version also performs allocation while the atomic version reuses memory. Strip both down to the synchronisation primitive in isolation.

### 2. Use `b.N` correctly

`b.N` is the loop count, *not* a fixed quantity. Do not allocate `b.N` items at the start of the benchmark — that distorts measurements at large `b.N`.

```go
func BenchmarkReqAck(b *testing.B) {
    in := make(chan Req, 1)
    go worker(in)
    for i := 0; i < b.N; i++ {
        r := Req{Reply: make(chan int, 1)}
        in <- r
        <-r.Reply
    }
    close(in)
}
```

Report `ns/op` and `allocs/op`. The latter often dominates.

### 3. Pin GOMAXPROCS

Channel benchmarks are sensitive to scheduler decisions. Run with `GOMAXPROCS=1` for the synchronisation cost in isolation; then with `GOMAXPROCS=N` for the contention story.

---

## When not to optimise

Most services do not need any of this. The list of times you actually *should* optimise a handshake:

- Profile shows `runtime.chansend` or `runtime.chanrecv` in the top five CPU consumers.
- Allocation profile shows `chan` allocations as a large fraction of `alloc_objects`.
- p99 latency is bottlenecked on a single dispatcher goroutine that cannot drain its input fast enough.
- Goroutine count is growing in proportion to QPS — usually a sign of leaked reply channels, not raw overhead.

If none of the above apply, the readable form of the handshake — a fresh `chan T` per request, no pooling, no batching — is the right code. Pre-optimising handshakes is a category of pessimisation: it adds complexity that hides real bugs.

The patterns above are tools to reach for when you have evidence. Until then, write the simple version, and revisit only when the profiler points here.
