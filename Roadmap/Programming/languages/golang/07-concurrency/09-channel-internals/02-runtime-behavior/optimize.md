# Channel Runtime Behaviour — Optimisation

This page is about deciding *when channels are the right tool*, and how to push performance when they are. The runtime knowledge from junior/middle/senior pages informs each optimisation: we know what the hot path does, so we know what to optimise.

---

## Decision Matrix: Channel vs Alternative

| Situation | Best primitive | Reason |
|---|---|---|
| One-to-one rendezvous | unbuffered channel | Direct hand-off, no buffer overhead, clear semantics |
| Producer faster than consumer, smoothing | small buffered channel (capacity = ~10) | Absorbs jitter, parks producer when truly behind |
| Fan-out broadcast | `close(done)` channel | One wake-up per receiver, clear shutdown semantic |
| Counter / accumulator | `atomic.Int64` | ~3 ns vs ~70 ns for channel |
| Bounded resource / semaphore | buffered channel of `struct{}` | Capacity = N, send-acquire, recv-release |
| Mutual exclusion of a critical section | `sync.Mutex` | 3x faster than channel rendezvous |
| One-time signalling | `sync.WaitGroup` or closed channel | Both are clean; channel allows select integration |
| Pub-sub many receivers | broadcast lib or fan-out channels | Single channel cannot fan-out without explicit per-receiver loop |
| High-throughput pipe (>1M ops/s) | lock-free ring buffer (rare) | `c.lock` is the bottleneck |
| Cancellable wait with timeout | `select` with `time.NewTimer` | Native, integrates with other channels |

The default should be: channels for communication, mutexes for shared state. Reach for atomics only when you have measured channel/mutex overhead and need lower-level perf.

---

## Optimisation 1: Use `chan struct{}` for Signal Channels

`struct{}` is a zero-sized type. The channel buffer (if any) allocates `cap * sizeof(elem) = 0` bytes. `typedmemmove` for size 0 is a no-op.

```go
done := make(chan struct{})       // signal channel
result := make(chan struct{}, 1)  // signal with one-shot bucket
```

vs:

```go
done := make(chan bool)           // 1 byte per slot, plus alignment
```

For high-frequency signalling, this can be measurable. For a one-time `done` signal, it's stylistic — `chan struct{}` is the idiomatic choice and signals intent ("no data, just events").

---

## Optimisation 2: Avoid Goroutine-Per-Item

Pattern:

```go
for _, item := range items {
    go func(it Item) {
        ch <- process(it)
    }(item)
}
```

Each goroutine adds:
- ~2 KB stack allocation.
- One `chansend` call that may park.
- Scheduler overhead to start and stop the goroutine.

If `len(items)` is large (thousands), this is slower than processing serially. Better: a fixed pool of worker goroutines draining a job channel.

```go
jobs := make(chan Item, len(items))
results := make(chan Result, len(items))
for w := 0; w < numWorkers; w++ {
    go func() {
        for j := range jobs {
            results <- process(j)
        }
    }()
}
for _, item := range items {
    jobs <- item
}
close(jobs)
```

The worker pool reuses goroutine stacks and amortises scheduling. `numWorkers = runtime.NumCPU()` is a reasonable default.

---

## Optimisation 3: Batch Sends

Each `ch <- v` is one `c.lock` cycle. Sending 1000 individual values is 1000 lock cycles. Sending one slice of 1000 values is one lock cycle.

```go
// Slow: one-at-a-time
for _, item := range items {
    ch <- item
}

// Fast: batch
ch <- items
```

Trade-off: the receiver gets a slice and must loop internally. Memory: the slice is allocated once. Latency: the receiver doesn't see any item until the whole batch is sent.

For high-throughput pipelines, batching with batches of ~100 items is a sweet spot: 100x less lock contention, modest latency increase.

---

## Optimisation 4: Right-Size the Buffer

| Buffer size | When to use |
|---|---|
| 0 (unbuffered) | Strict rendezvous required; sender must wait for receiver |
| 1 | Off-by-one decoupling; allows producer to compute one step ahead |
| Small (~10) | Smooths short bursts; if both producers and consumers are roughly balanced |
| Large (~1000) | Producer is bursty; consumer can fall far behind |
| Pre-sized to N | The total number of items is known; buffered prevents goroutine leaks on early return |

Two anti-patterns:

- **Buffer everything "just in case."** Large buffers hide back-pressure. If the consumer is slow, the buffer grows, memory bloats, and you don't notice until OOM.
- **Buffer of 1 as "magic shortcut."** It's not. Capacity 1 still requires the receiver to drain; the producer parks on the second send.

Measure with `len(ch)` over time in a debug-only goroutine to see actual usage.

---

## Optimisation 5: Avoid `select` When You Don't Need It

`select` adds:
- A shuffle pass (O(k)).
- A sort pass (O(k log k)).
- One lock acquisition per case.
- A sudog allocation per case if it parks.

For a single channel op, just use the direct op:

```go
v := <-ch  // direct chanrecv, no shuffle/sort
```

`select` is only worth it for genuine multi-channel waits, cancellation, or non-blocking variants.

A common waste: `select { case x := <-ch: ... }` with only one case. That's equivalent to `x := <-ch`. The compiler does not optimise the single-case select to a direct call.

---

## Optimisation 6: Pre-Allocate Buffered Channels for Bounded Workloads

```go
// Slow: dynamically appending; may park as buffer fills
results := make(chan Result)
for _, item := range items {
    go worker(item, results)
}
for range items {
    r := <-results
    handle(r)
}
```

```go
// Fast: pre-sized buffer holds all results, no parking
results := make(chan Result, len(items))
for _, item := range items {
    go worker(item, results)
}
for range items {
    r := <-results
    handle(r)
}
```

The pre-sized version saves N parking events. Difference: fast version uses N * sizeof(Result) more memory while results are pending.

---

## Optimisation 7: Replace Channels with Atomics for Counters

```go
// Slow: each increment is a channel op (~70 ns)
counter := make(chan int, 1)
counter <- 0
for i := 0; i < 1000000; i++ {
    n := <-counter
    counter <- n + 1
}
```

```go
// Fast: atomic add is ~3 ns
var counter atomic.Int64
for i := 0; i < 1000000; i++ {
    counter.Add(1)
}
```

The channel version uses a 1-slot buffer as a token: only one goroutine can hold the value at a time. This is essentially a mutex. For pure counter semantics, atomics are 25x faster.

Replace channels with atomics when:

- The state is a single value of a primitive type.
- All operations are reads/writes of that value (no complex transactional logic).
- You can express the operation as `Load`, `Store`, `Add`, or `CompareAndSwap`.

---

## Optimisation 8: Use `sync.Pool` for Channel Element Allocations

If your channel transports large structs:

```go
type BigMsg struct { /* lots of fields */ }
ch := make(chan *BigMsg, 100)

for i := 0; i < 1000000; i++ {
    msg := &BigMsg{...} // GC pressure
    ch <- msg
}
```

Use `sync.Pool` to reuse allocations:

```go
var msgPool = sync.Pool{New: func() any { return &BigMsg{} }}

for i := 0; i < 1000000; i++ {
    msg := msgPool.Get().(*BigMsg)
    msg.reset() // reuse, don't allocate
    ch <- msg
}

// Consumer:
for msg := range ch {
    use(msg)
    msgPool.Put(msg)
}
```

The pool eliminates GC pressure for the message structs. The channel still pays its own cost per op, but the dominant cost (allocation) is amortised.

---

## Optimisation 9: Avoid Closing Channels Unnecessarily

`close(ch)` wakes all parked goroutines. If the channel has 1000 parked receivers, `close` does 1000 `goready` calls before returning.

If you only need "no more values" semantics for one receiver, don't close. Use a context or a separate done channel.

```go
// Heavy-fanout close — every receiver pays
ch := make(chan struct{})
for i := 0; i < 1000; i++ {
    go func() {
        <-ch
        // ...
    }()
}
close(ch) // wakes all 1000 at once
```

For controlled wake-up rates, use a token bucket pattern (send N tokens, sleep, repeat).

---

## Optimisation 10: Sharded Channels for Throughput

When `c.lock` is the bottleneck:

```go
// Single channel — all ops serialise through c.lock
ch := make(chan Job, 1024)
```

```go
// Sharded channels — each shard has its own lock
const N = 16
shards := make([]chan Job, N)
for i := range shards {
    shards[i] = make(chan Job, 64)
}

func route(j Job) {
    shards[j.Key % N] <- j
}
```

Each shard handles 1/N of the traffic. Locks are independent — no cross-shard contention.

Cost: routing logic, more workers (one per shard), and you need affinity (a worker handles one shard's jobs). Benefit: near-linear scaling up to N CPUs.

---

## Optimisation 11: Replace `time.After` in Loops with Reusable Timer

```go
// Slow: allocates new timer per iteration; leaks until fired
for {
    select {
    case j := <-jobs:
        handle(j)
    case <-time.After(time.Second):
        return
    }
}
```

```go
// Fast: one timer, reused
t := time.NewTimer(time.Second)
defer t.Stop()
for {
    if !t.Stop() {
        select {
        case <-t.C:
        default:
        }
    }
    t.Reset(time.Second)
    select {
    case j := <-jobs:
        handle(j)
    case <-t.C:
        return
    }
}
```

The Reset dance is awkward but avoids per-iteration timer allocation.

Go 1.23 simplifies this: a Reset on an unfired timer is now safe without draining. Check your Go version.

---

## Optimisation 12: Check for `select`-on-`nil` Patterns

The nil-channel idiom can "disable" a select case:

```go
var failChan chan<- error
if hasErr {
    failChan = errs
}
select {
case j := <-jobs:
    process(j)
case failChan <- pendingErr:  // disabled when failChan is nil
}
```

Cost: parking on a nil channel allocates a sudog (or would, but the runtime fast-paths nil channels). Worth confirming on hot paths that you are not paying for a parked sudog you don't need.

For a single optional case, simpler alternatives:

```go
if hasErr {
    select {
    case j := <-jobs:
        process(j)
    case errs <- pendingErr:
    }
} else {
    j := <-jobs
    process(j)
}
```

Explicit, but no select overhead in the common case.

---

## Optimisation 13: Reduce Wake-Up Cascades in Close-Heavy Code

If you call `close(ch)` on many channels in a tight loop, each close fires `goready` for parked receivers. If you have a thousand small channels, that's a thousand goready cascades.

Consolidate: one channel with sentinel values, or one done-channel that all goroutines watch:

```go
// Slow: many channels
for _, w := range workers {
    close(w.stop)
}

// Fast: one channel
close(globalStop)
```

The single-channel close does one wake-up per goroutine; the multi-channel version does one per channel per goroutine listening on that channel.

---

## Optimisation 14: Profile Channel Operations

Use the block profile to see which channels are causing parking:

```go
import _ "net/http/pprof"
runtime.SetBlockProfileRate(1) // sample every block event
```

Then:

```
go tool pprof http://localhost:6060/debug/pprof/block
(pprof) top
(pprof) list runtime.chansend
```

The block profile shows time spent parked. Hot spots there are candidates for: larger buffers, sharding, batching, or eliminating the channel entirely.

CPU profile shows time spent in `runtime.lock2`, `runtime.chansend`, `runtime.chanrecv`. Top consumers are channel-lock contention candidates.

---

## Optimisation 15: Skip Channel for Sync.Once Patterns

```go
// Slow: channel-based "ready" signal
ready := make(chan struct{})
go func() {
    expensiveInit()
    close(ready)
}()
// later:
<-ready
```

`sync.Once` is functionally equivalent and ~2x faster:

```go
var once sync.Once
init := func() { expensiveInit() }
// later:
once.Do(init)
```

`sync.Once` uses an atomic int32 and a mutex; no goroutine allocation.

Use channels when you also need to integrate with `select` (e.g., wait for ready or timeout). Otherwise, prefer `sync.Once`.

---

## Optimisation 16: Avoid Send-on-Receive Patterns

```go
type Result struct {
    Done chan struct{}
    Val  int
}

func compute() Result {
    r := Result{Done: make(chan struct{})}
    go func() {
        r.Val = slow()
        close(r.Done)
    }()
    return r
}

// Caller:
r := compute()
<-r.Done
fmt.Println(r.Val)
```

`Val` is written from one goroutine and read from another. The `close(r.Done)` synchronises (close-before-receive ordering), so the read is safe — but barely.

Cleaner: return the value through the channel.

```go
func compute() <-chan int {
    out := make(chan int, 1)
    go func() {
        out <- slow()
    }()
    return out
}

// Caller:
val := <-compute()
```

The buffered channel avoids the goroutine leak (it can exit before the caller reads). One channel op instead of two synchronisation points.

---

## Optimisation 17: Use `errgroup` Instead of Hand-Rolled Channel Coordination

```go
// Verbose: manual channel coordination
ch := make(chan error, len(tasks))
for _, t := range tasks {
    go func(t Task) {
        ch <- run(t)
    }(t)
}
var firstErr error
for i := 0; i < len(tasks); i++ {
    if err := <-ch; err != nil && firstErr == nil {
        firstErr = err
    }
}
```

```go
// Concise: errgroup
import "golang.org/x/sync/errgroup"

var g errgroup.Group
for _, t := range tasks {
    t := t
    g.Go(func() error {
        return run(t)
    })
}
firstErr := g.Wait()
```

`errgroup` internally uses a `sync.WaitGroup` + `sync.Once` + atomic; no channel. Faster and simpler.

---

## Optimisation 18: Drop vs Block Trade-off

For non-critical events (metrics, telemetry), prefer "drop on full" over "block":

```go
// Slow: blocks producer if telemetry consumer is slow
metric := make(chan Metric)
metric <- m  // may park

// Fast: drops on full
select {
case metric <- m:
default:
    // metric dropped; increment drop counter
}
```

The non-blocking send returns immediately if the buffer is full. The producer continues; metrics are best-effort. For a metrics pipeline, this is usually the right behaviour.

Combined with a small buffer (size 100 or so), this gives bounded memory and bounded latency.

---

## Optimisation 19: Use `bytes.Buffer` Patterns Over Channel-of-Bytes

If you're shovelling small data items through a channel:

```go
// Slow: one channel op per byte
ch := make(chan byte, 1024)
for _, b := range data {
    ch <- b
}
```

Use a `[]byte` element type:

```go
// Fast: one channel op per chunk
ch := make(chan []byte, 16)
ch <- data
```

1024x fewer lock ops. The cost: chunk-level granularity.

---

## Optimisation 20: Measure, Don't Assume

Each of the optimisations above has scenarios where it doesn't apply. The actual best practice:

1. Write the simple version first.
2. Profile under realistic load.
3. If a channel shows up in the profile, apply the most-likely fix.
4. Re-measure.

Common surprises:

- The channel you thought was the bottleneck is fine; the real bottleneck is GC or syscall.
- Replacing a channel with atomics drops latency 10x, but introduces a race you didn't see.
- Sharding helps in benchmarks but the per-shard cache miss pattern hurts in production.

The runtime is well-engineered. Most channel-based code is fast enough. When it isn't, profile, change one thing, re-measure.

---

## Summary

Channels are correct by default and fast by intent. The optimisations here are escape hatches:

- Replace channels with atomics or mutexes when you have a single primitive value.
- Batch sends to reduce lock overhead.
- Pre-size buffers to eliminate predictable parking.
- Use `sync.Pool` to absorb GC pressure from message types.
- Shard channels to scale past single-lock throughput.
- Profile to confirm changes are real wins, not noise.

When in doubt, leave the channel alone. Optimise only the parts that show up in profiles.
