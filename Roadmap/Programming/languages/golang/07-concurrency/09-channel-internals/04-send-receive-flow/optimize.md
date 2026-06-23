# Send/Receive Flow — Optimisation

A practical guide to making the send/receive flow fast in production. Each section is a technique, with motivation, a before/after sketch, and a numbers estimate.

## Table of Contents
1. [The Three Cost Regimes](#the-three-cost-regimes)
2. [Favour Direct Handoff](#favour-direct-handoff)
3. [Buffer Sizing](#buffer-sizing)
4. [Batching to Amortise the Lock](#batching-to-amortise-the-lock)
5. [Sharding the Channel](#sharding-the-channel)
6. [Reducing Element Size](#reducing-element-size)
7. [Avoiding Allocations on the Hot Path](#avoiding-allocations-on-the-hot-path)
8. [Cache-Line Considerations](#cache-line-considerations)
9. [Using `select` Wisely](#using-select-wisely)
10. [When Not to Use Channels](#when-not-to-use-channels)
11. [Measuring](#measuring)
12. [Summary](#summary)

---

## The Three Cost Regimes

Recall the latency budget from earlier sections:

| Path | Cost |
|---|---|
| Buffer hop | ~30-60 ns |
| Direct handoff | ~40-100 ns |
| Park-and-wake | ~200+ ns + scheduler |

Optimisation is essentially: keep your channel ops in the first two regimes. Avoid park-and-wake on the hot path.

A secondary cost is the lock contention. On a single hot channel:

- 1-2 goroutines: lock is uncontended; full throughput.
- 4-16 goroutines: lock starts to contend; throughput drops.
- 100+ goroutines: lock is the bottleneck; throughput plateaus around 1-5M ops/sec.

The cost model and the contention model are independent. You can have a low-latency channel (fast individual ops) that is still throughput-bound (one channel, many goroutines).

---

## Favour Direct Handoff

If your producer and consumer run at roughly the same rate, an *unbuffered* channel maximises direct handoff. Both goroutines stay in lockstep; each send-receive is a single memmove under one lock.

**Before** (buffered, when not needed):

```go
ch := make(chan Result, 1024)

go producer(ch)
for r := range ch {
    consume(r)
}
```

If consumer is fast enough, the buffer is always near-empty; the runtime does a buffer hop on every op. That is still fast (~40 ns), but the buffer adds latency: the producer has to lock + copy, then the consumer has to lock + copy. Two memory operations.

**After** (unbuffered):

```go
ch := make(chan Result)
```

Now every op is a direct handoff: one memmove, one lock. Roughly 25% faster for a tightly-coupled producer-consumer.

**Caveat**: if the producer is bursty (irregular), an unbuffered channel synchronises the producer to the consumer's slow path. A small buffer (16-64) smooths bursts without adding noticeable latency.

Rule of thumb:
- Steady state, similar rates: unbuffered.
- Bursty producer: buffer = "expected burst size."
- Decoupled producer and consumer (different stages of pipeline): buffer = "pipeline depth."

---

## Buffer Sizing

If you need a buffer, size it correctly. Too small: park-and-wake on every burst. Too large: wasted memory, and you mask backpressure problems.

Heuristic:

```
buffer_size = peak_burst_rate * acceptable_lag
```

If a producer can momentarily emit 1000 items in 10 ms, and you can tolerate 10 ms of lag, buffer 1000.

If you don't know the burst rate, start with 64 and measure. Latency profiles will tell you if items are queueing.

**Example**:

A logging system writes log lines to a channel; a single writer goroutine batches them to disk.

```go
logs := make(chan LogLine, 4096)
```

4096 holds about 100 ms of logs at 40,000 lines/sec. Writer wakes up every batch and flushes. Producers never park unless logging exceeds 40k/sec.

**Anti-pattern**: `make(chan T, 1)` as a "throttle." This makes every send block, defeating the buffer. If you want throttling, use a `time.Ticker` or `golang.org/x/time/rate`.

**Anti-pattern**: `make(chan T, math.MaxInt32)` as a "just don't block." This allocates memory proportional to the buffer (if the elements are large). It also hides bugs: if you accumulate items, you have a leak.

---

## Batching to Amortise the Lock

The hot cost of a channel op is the lock acquire/release (~10 ns) and the memmove (~5 ns for small elements). For very small elements (a couple of bytes), the lock is the dominant cost.

If you can batch:

**Before**: 1M individual sends.

```go
for _, v := range values {
    ch <- v
}
```

Cost: ~30 ns × 1M = 30 ms. Plus contention if multiple senders.

**After**: 1k batches of 1k.

```go
type Batch [1024]int

for i := 0; i < len(values); i += 1024 {
    var batch Batch
    n := copy(batch[:], values[i:])
    ch <- batch
}
```

Cost: ~30 ns × 1k = 30 µs. 1000x faster.

The receiver then loops through each batch's elements. Total work is the same; lock cost is amortised.

**Caveats**:
- Batching adds latency: a half-full batch waits for the rest. For latency-critical paths, use a timer to flush partial batches.
- Channels of large structs incur larger memmoves. Past a few KB per element, the memmove cost dominates and batching hurts. Switch to channels of `[]T` or pointers.

---

## Sharding the Channel

A single channel's lock is the throughput ceiling. To scale beyond it, shard.

**Before**: one channel for all producers.

```go
jobs := make(chan Job, 1024)
// 100 producers send to jobs
// 1 consumer
```

Throughput cap: ~5M ops/sec, regardless of cores.

**After**: N channels, one per CPU or per producer group.

```go
const Shards = runtime.GOMAXPROCS(0)
jobs := make([]chan Job, Shards)
for i := range jobs {
    jobs[i] = make(chan Job, 1024)
}
// Producers: shard by hash(jobID) % Shards
// Consumers: one per shard
```

Throughput scales linearly with shards (up to memory bandwidth limits).

**Shard key choice**:
- Random (round-robin): even distribution, no ordering guarantees.
- Hash of a key: same key always goes to same shard (useful for stateful consumers).
- Producer's goroutine ID (via a sharded counter): zero-contention from producer side.

**Drawback**: ordering across shards is lost. If you need a global FIFO, sharding is not the right tool.

---

## Reducing Element Size

The memmove cost is proportional to the element size. A `chan struct{Big [1024]byte}` does a ~1 KB memmove per send.

**Before**:

```go
type Update struct {
    ID   int64
    Data [1024]byte
}
ch := make(chan Update, 100)
```

Each send: ~500 ns for the memmove alone.

**After**: pass a pointer.

```go
ch := make(chan *Update, 100)
```

Each send: ~30 ns. But:

- The `Update` must be heap-allocated (escape analysis).
- The receiver and sender share the same memory (mutation hazards).
- The GC has more work to do.

For large elements where the receiver and sender don't overlap in access, pointers are usually a win. For small elements (fits in a couple of cache lines), pass by value.

Rule of thumb:
- `<= 64 bytes`: pass by value.
- `64-512 bytes`: depends; benchmark.
- `> 512 bytes`: usually pointer.

---

## Avoiding Allocations on the Hot Path

A `chan interface{}` causes allocations: every send boxes the concrete type into an `interface{}` value, which requires a heap allocation (for non-trivial types).

**Before**:

```go
var ch chan interface{}
ch <- 42 // boxes 42 into a heap-allocated interface
```

**After**: use the concrete type.

```go
var ch chan int
ch <- 42
```

For genuinely polymorphic channels, consider using generics (Go 1.18+) or split into typed channels.

Sudog allocation: the runtime pools sudogs per-P. Allocations are usually free (~10 ns from cache). But if you have an unusual pattern that exhausts the cache, sudog allocation hits the central freelist and slows down. This is rare; you would notice as `acquireSudog` showing up in CPU profiles.

---

## Cache-Line Considerations

The `hchan` struct is ~96 bytes. It fits in two cache lines (each 64 bytes on x86). For sole-owner workloads, cache misses are rare.

For high-contention channels, the `hchan` cache line bounces between cores: every lock acquire requires the cache line to be in M (modified) state on the locking core. This is the actual hardware cost of contention.

There is no user-level fix for this short of sharding. The runtime team has experimented with cache-line padding for hot fields; the current design balances size and contention.

For your application code: if you have a channel that's known to be hot, ensure your goroutines that touch it tend to live on the same core (via `runtime.LockOSThread` and CPU affinity, but this is unusual and complex).

---

## Using `select` Wisely

A `select` with N cases costs O(N) per call: the runtime examines every case in the registration phase. For N > 8 or so, this becomes noticeable.

If you have many channels, consider:

- Fan in with a single channel: use a goroutine per source channel that forwards to a unified channel. The unified consumer does a single-case receive.
- Group channels by priority: a two-level select where high-priority channels are checked first.

**Anti-pattern**: a `for` loop that selects among many channels each iteration.

```go
for {
    select {
    case v := <-ch1:
        // ...
    case v := <-ch2:
        // ...
    case v := <-ch3:
        // ...
    // ... 20 more cases ...
    }
}
```

This pays the O(N) select cost on every iteration.

**Better**: dedicated goroutine per channel, forwarding to a unified channel.

```go
unified := make(chan event, 256)
go func() { for v := range ch1 { unified <- event{1, v} } }()
go func() { for v := range ch2 { unified <- event{2, v} } }()
// ...

for ev := range unified {
    // ...
}
```

---

## When Not to Use Channels

Sometimes a channel is the wrong primitive. Consider alternatives:

- **Shared counter**: `sync/atomic` is dozens of ns per op, no contention scaling issues.
- **Map of state**: `sync.Map` or a regular map under `sync.RWMutex`.
- **Done-only signalling**: a `chan struct{}` closed once. Fast and idiomatic.
- **Many small messages, single owner**: a ring buffer in a single goroutine (no channel needed).
- **Producer/consumer with backpressure**: a buffered channel is correct, but if you don't need ordering, a sync.Pool + atomic counter can be cheaper.

Rule: channels are for *communication and synchronisation between goroutines*. If you have only state, use mutexes or atomics. If you have only signalling, use a closed-channel pattern.

---

## Measuring

Always measure before optimising. Use:

### `go test -bench`

```go
func BenchmarkChannelSendRecv(b *testing.B) {
    ch := make(chan int, 1024)
    go func() {
        for range ch {
        }
    }()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        ch <- i
    }
}
```

Run with `-cpu=1,2,4,8` to see scaling.

### Block profile

```go
runtime.SetBlockProfileRate(1)
// ... run workload ...
pprof.Lookup("block").WriteTo(f, 0)
```

Reveals where goroutines spend time blocked. Channel block events show up under `chansend` / `chanrecv`.

### Trace

```go
trace.Start(f)
// ... run workload ...
trace.Stop()
```

`go tool trace trace.out` opens an interactive view. The "Goroutines" tab shows block/run/wait distributions.

### CPU profile

```go
pprof.StartCPUProfile(f)
// ... run workload ...
pprof.StopCPUProfile()
```

If `runtime.chansend` or `runtime.lock` are in the top entries, you have channel contention. If `runtime.gopark` is hot, you have park-and-wake on the critical path.

### Microbenchmark before and after

For any optimisation, write a benchmark for the specific scenario you're optimising. Measure both throughput (ops/sec) and per-op latency (ns/op). Compare. Don't trust your intuition.

---

## Summary

The send/receive flow has three cost regimes: buffer hop (cheapest), direct handoff (cheap), park-and-wake (slow). Optimisation is mostly about staying in the first two regimes.

Concrete techniques:

1. **Direct handoff when both sides are ready**: unbuffered or small-buffer channels.
2. **Buffer sized to absorb bursts**: prevents park-and-wake on temporary asymmetry.
3. **Batching**: amortise per-op lock cost across many values per op.
4. **Sharding**: scale beyond a single lock's throughput ceiling.
5. **Small elements**: keep the memmove cheap; pass pointers for large structs.
6. **Avoid allocations**: use typed channels, not `chan interface{}`.
7. **Smart select**: fan in to one channel rather than selecting over many.

When channels are not the right tool: atomics for counters, mutexes for shared state, ring buffers for single-owner queues.

Always measure. Block profile, CPU profile, and trace reveal where channel ops actually cost time. Optimise the hot path, leave the cold paths alone. A well-tuned channel-based program is competitive with hand-rolled lock-free queues for almost any practical workload.
