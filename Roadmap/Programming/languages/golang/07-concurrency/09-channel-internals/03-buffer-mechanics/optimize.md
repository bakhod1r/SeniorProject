# Buffer Mechanics — Optimisation

How to use what you know about the ring buffer to make channel-based code faster, lighter, and more predictable. Every recommendation here is informed by the buffer's actual behaviour, not by folklore.

## Table of Contents
1. [The Optimisation Mindset](#the-optimisation-mindset)
2. [Right-Sizing the Buffer](#right-sizing-the-buffer)
3. [Picking Element Type](#picking-element-type)
4. [Avoid Allocating Channels in Hot Paths](#avoid-allocating-channels-in-hot-paths)
5. [`chan struct{}` for Signalling](#chan-struct-for-signalling)
6. [Batching to Amortise Lock Cost](#batching-to-amortise-lock-cost)
7. [Sharding High-Contention Channels](#sharding-high-contention-channels)
8. [Avoid `len(ch)` in Hot Loops](#avoid-lench-in-hot-loops)
9. [Reduce GC Scanning by Choosing Non-Pointer Payloads](#reduce-gc-scanning-by-choosing-non-pointer-payloads)
10. [When to Replace a Channel With Something Else](#when-to-replace-a-channel-with-something-else)
11. [Profiling Workflow](#profiling-workflow)
12. [Anti-Optimisations to Avoid](#anti-optimisations-to-avoid)

---

## The Optimisation Mindset

The ring-buffer fast path is already very fast (~30 ns per op). Most "optimisations" you might think of either do nothing measurable or actually slow things down (by adding complexity that confuses the compiler or the runtime). Optimise channels only when profiling identifies them as the bottleneck, and even then prefer simple changes (element type, buffer size) over complex ones (custom queues, sharding).

The order of business:

1. Measure with `go test -bench` and `pprof`.
2. Identify whether the bottleneck is the lock (mutex profile), parking (block profile), the buffer copy (cpu profile), or GC (`GODEBUG=gctrace=1`).
3. Apply the smallest change that addresses the bottleneck.
4. Re-measure.

---

## Right-Sizing the Buffer

The most common channel "optimisation" is increasing capacity. It is also the most misused. Here is when each size is right:

| Capacity | When to use |
|---|---|
| 0 (unbuffered) | Strict synchronisation: handshake required between sender and receiver each time. |
| 1 | Single-value handoff with no backlog tolerated. |
| 2–16 | Smoothing over micro-jitter when sender and receiver have similar average rates. |
| 16–256 | Burst absorption with bounded latency. |
| 256–4096 | Heavy producer with bursty traffic and a slower consumer; back-pressure still preserved. |
| >4096 | Almost never. If you need this, ask whether the design has the right back-pressure. |

The decision is workload-driven. Run your application under realistic load; sample `len(ch)` periodically and plot it. If the buffer is always nearly empty, you have too much capacity (or the consumer is fast enough that capacity doesn't matter). If it is always nearly full, you have too little (or you have a back-pressure problem).

A practical heuristic: choose capacity = (peak burst size) − (sustainable consumer rate × tolerable latency). If unsure, start at 16 and adjust.

---

## Picking Element Type

Per-operation cost scales with element size (via `typedmemmove`) and pointer count (via write barriers during GC). To minimise:

- **Prefer small primitive types** (`int`, `int64`, `bool`) for very hot channels.
- **Send pointers (`*T`)** when the payload is large (>64 bytes) and the lifetime is clear.
- **Avoid embedding many pointer fields** in channel value types. Each pointer costs a write barrier during GC.
- **Prefer arrays over slices** when the size is fixed and small. Slices contain a pointer to backing data; arrays are values.

Example:

```go
// SLOW per send: 1024-byte memmove
ch := make(chan [128]int64, 16)

// FAST per send: 8-byte pointer copy
ch := make(chan *[128]int64, 16)
```

The pointer version is faster per send. But: the pointee is allocated on the heap (escape analysis) and must be tracked by the GC. For high-throughput channels, the per-send savings can be eaten by GC overhead. Profile both.

For very-hot small payloads, prefer:

```go
ch := make(chan int64, 16) // best of both worlds
```

If `int64` is enough information, use it.

---

## Avoid Allocating Channels in Hot Paths

`make(chan T, N)` is one `mallocgc` call (sometimes two for pointer-containing element types). It is not free. If your code creates a new channel for every request, that allocation adds up.

```go
// SLOW: per-request channel
func handle(req Request) {
    done := make(chan Result, 1)
    go process(req, done)
    return <-done
}
```

If `handle` is called millions of times per second, that is millions of channel allocations. Consider:

- **Reuse a channel across requests.** Create one at startup; multiplex via request IDs.
- **Use `sync.Pool` of channels.** Carefully, because a pooled channel must not have stale values.
- **Use a different primitive.** A single-shot result is sometimes better expressed as a callback or a `sync.Cond`.

In normal code paths (not nanosecond-sensitive), channel allocation is fine. The advice is for code that profiles show as hot.

---

## `chan struct{}` for Signalling

When you don't need to convey data, use `chan struct{}`. Reasons:

- Zero bytes per slot, so `typedmemmove` is a no-op.
- Smallest allocation footprint.
- Communicates intent clearly: this is signal-only.
- No write barriers ever (empty struct has no pointer data).

```go
done := make(chan struct{})
go func() {
    // work
    close(done)
}()
<-done
```

The cost difference vs `chan bool` or `chan int` is small per operation but accumulates at scale. For 1M signals/sec, the savings are measurable.

---

## Batching to Amortise Lock Cost

If you have a high rate of small messages on a channel, every send/receive pays the channel lock once. Batching reduces this:

```go
// Per-event channel: high lock pressure
events := make(chan Event, 1024)
for _, e := range eventsToSend {
    events <- e
}

// Batched: lock per batch
batches := make(chan []Event, 64)
batches <- eventsToSend
```

Trade-off: latency goes up (events wait to be batched). For metric pipelines, this is acceptable; for interactive responses, it isn't.

Batching is best done by the producer accumulating in a slice and flushing when full or on a timer. The consumer ranges over the slice. The channel does less work; the buffer holds fewer, larger items.

---

## Sharding High-Contention Channels

A single channel hammered by 1000 producers has serialised lock contention. Sharding splits the load:

```go
const Shards = 16
var chans [Shards]chan Event
for i := range chans {
    chans[i] = make(chan Event, 256)
    go consume(chans[i])
}

func send(e Event) {
    shard := hash(e.Key) % Shards
    chans[shard] <- e
}
```

Each shard has its own lock. Contention drops by ~Shards-fold. The trade-off: per-shard FIFO instead of global FIFO; you need a routing key that distributes well.

This is essentially what `sync.Pool` does internally with per-P sharding. For channels, you do it manually.

---

## Avoid `len(ch)` in Hot Loops

`len(ch)` is one memory read. Cheap, but in a tight loop it can show up:

```go
for len(ch) > 0 {
    v := <-ch
    process(v)
}
```

Replace with a `for-range`:

```go
for v := range ch {
    process(v)
}
```

The `for-range` loop is shorter, clearer, and the compiler can fuse the receive with the loop check. It also correctly handles `close`.

The bigger reason to avoid `len(ch)` is correctness (see `find-bug.md` Bugs 3 and 10), but for hot paths, removing it also lets the compiler emit tighter code.

---

## Reduce GC Scanning by Choosing Non-Pointer Payloads

If your channel carries values that contain pointers, every GC cycle scans the buffer. For a `chan *T` with capacity 1024 and a high allocation rate, the channel's buffer contributes to GC pause time.

Alternatives:

- Carry values directly: `chan T` instead of `chan *T` (if `T` is small).
- Carry indices or IDs into a separately-managed object table: `chan int` where the int looks up the real object.
- Pre-allocate a pool of payloads and reuse them.

For typical applications this is over-engineering. For latency-critical paths (GC pause is a tail-latency contributor), it matters.

---

## When to Replace a Channel With Something Else

A channel is a synchronisation primitive plus a queue. If you don't need both, consider:

| Need | Replacement |
|---|---|
| Latest value only, single reader | `atomic.Value` or a mutex+pointer |
| Unordered work distribution | `sync.Pool` (cache) or a custom MPMC ring |
| Single shot signal | `sync.Once` and a closed `chan struct{}` |
| Multiple readers waiting for an event | `sync.Cond` or close a `chan struct{}` |
| High-throughput SPSC | Custom lock-free ring (`go-disruptor`-style) |
| Cross-process | Operating-system pipes, sockets, message queue |

Channels are excellent default choices. Replace them only when profiling shows the channel is the limit.

---

## Profiling Workflow

A reproducible workflow for "is this channel my bottleneck?":

1. **Run with `-cpuprofile`.** Look for time in `runtime.chansend1`, `runtime.chanrecv1`, `runtime.selectgo`. If these are top entries, channel time is significant.

   ```bash
   go test -cpuprofile=cpu.prof -bench=.
   go tool pprof -top cpu.prof
   ```

2. **Run with `-blockprofile`.** Goroutines blocked on full or empty channels show up here.

   ```bash
   go test -blockprofile=block.prof -bench=.
   go tool pprof -top block.prof
   ```

   High block time on a specific channel = either too small a buffer or a slow consumer.

3. **Run with `-mutexprofile`.** Lock contention on `hchan.lock`. Rare unless you have many goroutines on one channel.

   ```bash
   go test -mutexprofile=mutex.prof -bench=.
   go tool pprof -top mutex.prof
   ```

4. **Run with `GODEBUG=gctrace=1`.** Look at GC pause times. If the channel's buffer carries pointers and you have a high allocation rate, the buffer's scanning shows up here.

5. **Run with `runtime/trace`.** Visual timeline of goroutine park/unpark events, including channel-mediated ones.

   ```bash
   go test -trace=trace.out -bench=.
   go tool trace trace.out
   ```

Always benchmark before and after each change. "I think this is faster" is not optimisation; measurement is.

---

## Anti-Optimisations to Avoid

- **Power-of-two capacity for "alignment."** Go's ring does not benefit from this. The wrap is a branch, not a bitwise AND.
- **`runtime.Gosched()` after every send "to help the scheduler."** It doesn't help. The runtime knows when to yield.
- **Spinning on `len(ch)` to "poll faster."** Spins are bad for the scheduler and for the channel's lock contention.
- **Custom lock-free ring buffers in user code.** Almost always slower than the channel when honestly benchmarked; correctness is hard.
- **Sleep-then-retry instead of blocking on the channel.** Wastes CPU and adds latency.
- **Pre-filling the buffer "for fast start."** The buffer is already empty after `make`; "pre-filling" just front-loads the work.
- **Multiple channels to "parallelise" within one consumer.** A single consumer can only read one channel at a time; multiple channels do not give parallelism without multiple consumer goroutines.

---

After applying the right-sized buffer, the right element type, and (rarely) batching or sharding, you have done everything productive at the buffer mechanics level. Further gains require redesigning the algorithm or moving away from channels entirely.

The ring buffer is small, fast, and predictable. Trust it. Optimise around it only when measurement demands it, and always with the simplest change that works.
