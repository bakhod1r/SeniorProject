# The `hchan` Struct — Optimize

[← Back to index](index.md)

## How to Use This Page

Each section presents a performance scenario, an explanation grounded in `hchan` internals, and concrete fixes. Numbers are illustrative; always measure on your own workload.

---

## 1. Hot Channel With Many Producers

**Symptom**: a single buffered channel receives from 100+ goroutines. CPU profile shows time spent in `runtime.lock2` and `runtime.futexsleep`.

**Why**: every producer must acquire `c.lock`. The runtime spin-mutex tries a brief spin, but with 100 concurrent contenders most contenders fall through to a futex wait. Throughput is bounded by lock-acquire bandwidth: roughly one critical section per few hundred nanoseconds. At 100+ producers, individual producers wait microseconds.

**Diagnosis**:

```go
import _ "net/http/pprof"
runtime.SetMutexProfileFraction(5)
// access /debug/pprof/mutex
```

The mutex profile will show `hchan.lock` as a top contender.

**Fix options**:

1. **Shard the channel** into N channels; producers send to `channels[i%N]`, and N consumer goroutines (or one consumer doing a select-fan-in) read.
2. **Batch sends**: each producer accumulates K items then sends a slice or batch struct. Fewer locks, more work per acquire.
3. **Use a lock-free ring** (third-party MPMC queue) when channels' semantics are not needed.
4. **Reduce producer count**: combine logically-related producers into fewer goroutines that aggregate work.

A sharded design scales roughly linearly until the consumer side becomes the bottleneck. Sharding factor of 8–16 is usually enough for hundreds of producers.

---

## 2. Large Element Types

**Symptom**: `chan [4096]byte` is slow even at low concurrency.

**Why**: every send is a `typedmemmove` of the element size. 4 KB per op is real work. The buffer slot is also 4 KB; a buffer of 100 entries is 400 KB allocated upfront.

**Fix**:

```go
type Buf [4096]byte
chFast := make(chan *Buf, 100)  // 8 B per slot, 800 B total
```

Pass pointers. The element copy is 8 bytes instead of 4096. Bonus: the `Buf` lives on the heap (escaped via pointer), but the channel only moves pointers. The GC tracks the pointers normally.

Catch: the pool of `Buf` allocations may now stress the GC if you create/discard them rapidly. Combine with `sync.Pool` for reuse:

```go
var bufPool = sync.Pool{New: func() any { return new(Buf) }}

func produce() {
    b := bufPool.Get().(*Buf)
    fillBuffer(b)
    chFast <- b
}

func consume(b *Buf) {
    use(b)
    bufPool.Put(b)
}
```

---

## 3. Tiny Sends, Many Goroutines

**Symptom**: 10,000 goroutines each sending a single byte to a fan-in channel. Throughput is dismal.

**Why**: every send is a runtime call (`chansend1`), a lock-acquire, a 1-byte memmove. The overhead dwarfs the payload. Plus, 10,000 parked goroutines is 10,000 `sudog`s; the per-P cache can hold ~128, so the central cache and `sudoglock` get involved.

**Fix**: change the protocol. Instead of one-message-per-goroutine, have each producer accumulate in a local buffer and send a batch. Or have fewer producer goroutines pulling from work queues.

A common pattern:

```go
// Bad: 10,000 producers each sending one item
for i := 0; i < 10000; i++ {
    go func(i int) { ch <- i }(i)
}

// Better: workers consuming from a work source, batching to output
workCh := make(chan int, 10000)
for i := 0; i < 10000; i++ { workCh <- i }
close(workCh)
for w := 0; w < runtime.NumCPU(); w++ {
    go func() {
        var batch [128]int
        n := 0
        for v := range workCh {
            batch[n] = v; n++
            if n == len(batch) {
                outCh <- batch
                n = 0
            }
        }
        if n > 0 { outCh <- batch[:n] }
    }()
}
```

The ratio of useful work to lock contention goes way up.

---

## 4. Unbuffered Channel for High-Throughput Pipeline

**Symptom**: an unbuffered channel between two fast goroutines is the throughput bottleneck.

**Why**: unbuffered means every send-receive is a rendezvous. The producer parks if the consumer is not exactly ready; the consumer parks if the producer is not ready. Park/unpark involves the scheduler — orders of magnitude more expensive than copying into a buffer slot.

**Fix**: add a small buffer.

```go
ch := make(chan T, 64)
```

Even a buffer of 1 helps: it allows the producer to push one ahead while the consumer is busy with the previous item, smoothing out variance. A buffer of 64 acts as a pipeline stage decoupler.

Trade-off: buffering delays back-pressure. If the consumer is permanently slower than the producer, the buffer fills and the producer eventually blocks anyway. Choose the buffer size to absorb expected jitter, not to absorb a permanently slow consumer.

---

## 5. `select` With Many Cases

**Symptom**: `select { case <-ch1: ...; case <-ch2: ...; case <-chN: ... }` with N = 50 in a hot loop. CPU profile shows `runtime.selectgo`.

**Why**: `selectgo` locks all N channels (in pointer-sorted order), polls each, and either takes a case or enqueues N `sudog`s on all N channels. Per-iteration cost is O(N).

**Fix options**:

1. **Single channel with tagged union**:
   ```go
   type Event struct {
       Kind int
       Data any
   }
   eventCh := make(chan Event, 64)
   // all sources send Events with their Kind
   for ev := range eventCh {
       switch ev.Kind { ... }
   }
   ```
   One channel, one lock, one parking point.

2. **Hierarchy of selects**: split 50 cases into 5 groups of 10 with intermediate aggregator goroutines.

3. **Worker pools**: dispatch events to workers via a small `chan Job`; workers handle the heavy lifting.

A tagged-union channel is almost always faster than a wide select.

---

## 6. False Sharing Across Goroutines on the Same Channel

**Symptom**: a producer goroutine and a consumer goroutine, each pinned to a core, see lower throughput than expected.

**Why**: `hchan`'s `sendx` and `recvx` fields are close in memory (within one cache line). The producer writes `sendx`; the consumer writes `recvx`. Both cores keep invalidating each other's cache line.

**Diagnosis**: `perf stat -e cache-misses` will show high cache-miss rate on the channel object.

**Fix**: the runtime does not let you pad `hchan`. Workarounds:

1. **Multiple channels** so writes go to different cache lines.
2. **Batch operations** so the cache-line ping-pong amortises.
3. **Custom queue** (outside the runtime) with explicit padding between head and tail.

For typical workloads, cache-line bouncing inside `hchan` is not the dominant cost. Diagnose with measurement before "fixing" something that is not slow.

---

## 7. Repeated `make(chan T)` in Hot Path

**Symptom**: profile shows `runtime.makechan` and `runtime.mallocgc` as hot.

**Why**: every `make(chan T, N)` is a heap allocation. Creating millions of channels per second stresses the allocator and GC.

**Fix options**:

1. **Reuse**: keep a channel alive longer. Many "create channel, do one rendezvous, discard" patterns can be re-architected.
2. **Pool**: `sync.Pool` of empty channels (rare; usually awkward because channels carry state across uses).
3. **Replace with `sync.WaitGroup` or `sync.Cond`**: if you only need "wait for one event", a `chan struct{}` is overkill — `sync.WaitGroup{Add(1); Done(); Wait()}` is lighter (no per-event allocation).

Example:

```go
// Hot path: 1M times
done := make(chan struct{})
go func() {
    work()
    close(done)
}()
<-done
```

vs.

```go
var wg sync.WaitGroup
wg.Add(1)
go func() {
    work()
    wg.Done()
}()
wg.Wait()
```

The `WaitGroup` version has a one-time allocation (the WaitGroup itself) and reuses it. The channel version allocates per call.

---

## 8. Channels of `interface{}` and `any`

**Symptom**: profile shows `runtime.convT*` (interface conversion) as a top cost.

**Why**: `chan any` (which is `chan interface{}`) requires every send to box the value into an `iface{ tab, data }` two-word structure. Small values may also allocate on the heap (escape analysis can sometimes inline, but often does not). The buffer slots are two words each — half of them are pointers.

**Fix**: use concrete types if possible. `chan int` is much cheaper than `chan any` carrying ints. Generics (Go 1.18+) help:

```go
type Pipe[T any] struct { ch chan T }
func NewPipe[T any](n int) Pipe[T] { return Pipe[T]{ch: make(chan T, n)} }
```

The compiler specialises `Pipe[int]` to use a `chan int` underlying — no boxing.

---

## 9. The "Atomic Snapshot" of `len(ch)`

**Symptom**: code calls `len(ch)` thousands of times per second in a metrics-collection loop.

**Why**: `len(ch)` is cheap — one word read of `c.qcount`. But thousands of unsynchronised reads from multiple cores still cause cache traffic if `qcount` is on a frequently-modified line. Worse: `len(ch)` is a snapshot; basing decisions on it leads to flaky behavior.

**Fix**: do not use `len(ch)` for control flow. For metrics, sample less frequently (every 100 ms) and accept the staleness. For back-pressure, use buffered-send-or-fail patterns:

```go
select {
case ch <- v:
    // accepted
default:
    // dropped or queued elsewhere
}
```

This naturally bounds queue depth without polling `len`.

---

## 10. Closed Channel as "Broadcast" Signal

**Symptom**: code uses `close(done)` to signal many goroutines and observes that the wake-up is fast and uniform.

**Why**: this is one of the *best* patterns. `closechan` drains all parked receivers in one lock acquisition, batches them in a local list, and wakes them after releasing the lock. Each receiver wakes with `success = false` and receives the zero value.

This is *more* efficient than sending N values:

```go
// Worse:
for i := 0; i < N; i++ { done <- struct{}{} }

// Better:
close(done)
```

The close is one lock acquisition and one drain. N sends would be N lock acquisitions, N hand-offs, N wakes.

Practical note: this only works for "fire once" signals. For ongoing signaling, use a channel-of-channels or a `context.Context`.

---

## 11. The `gopark`/`goready` Overhead

**Symptom**: micro-benchmark of unbuffered channel ping-pong is ~200 ns per operation; you expected 20 ns.

**Why**: each operation involves `gopark` (record reason, transition G to `_Gwaiting`, mcall to system stack, schedule another G) and `goready` (transition G to `_Grunnable`, push to runqueue, possibly wake an idle P). Each is hundreds of nanoseconds — not just a function call.

**Fix**: avoid unnecessary parking. Strategies:

1. **Buffer**: keep buffer slots so a producer can push without parking until the buffer is full.
2. **Batch**: do K operations per gopark cycle by accumulating.
3. **Spin briefly**: in some scenarios a brief atomic-poll loop outperforms park/unpark (the runtime mutex itself does this).
4. **Use `runtime.Gosched()` instead of channel sync** when you only need cooperative scheduling.

Reality: 200 ns per unbuffered op is the realistic lower bound. If you need 20 ns, you should not be using channels — use shared memory with atomics.

---

## 12. The Allocation Mountain of `sudog`

**Symptom**: profile shows `runtime.acquireSudog` allocating heavily, especially during program startup.

**Why**: per-P caches start empty. The first wave of channel parks allocates `sudog`s. Once enough sudogs exist (each goroutine recycles its own), allocations cease.

**Fix**: usually nothing — this is a one-time warm-up cost. If it matters at startup, pre-warm by triggering channel operations early. Most production servers do this organically by handling a few requests before traffic spikes.

If you see `acquireSudog` allocating *continuously*, you have an actual leak — goroutines parking and never being woken, causing their `sudog`s to never return to the pool. Investigate goroutine leaks.

---

## 13. `select { default: }` as Non-Blocking Probe

**Symptom**: a hot loop polls a channel with `select { case v := <-ch: ...; default: }` and never sleeps when the channel is empty.

**Why**: the default branch makes the select non-blocking. The loop becomes a CPU-burning spin. The channel itself is fine — the *use* is wrong.

**Fix**:

1. **Remove the default**: block on the channel.
2. **Add a timer case** so the loop sleeps if no data: `case <-time.After(10*time.Millisecond):`.
3. **Use a separate "go to sleep" channel**: a coordinator can signal "wait for work" via a long-poll.

Spinning is acceptable only for very short bursts (e.g., to amortise a rare wake-up), and even then you should fall back to a real block.

---

## 14. Two-Way Communication on One Channel

**Symptom**: pattern of "client sends request, server processes, sends back on the same channel" leads to confusion and races.

**Why**: a single `chan T` is unidirectional in spirit, even though the type is bidirectional. Mixing send and receive on the same channel from the same goroutines courts deadlock.

**Fix**: use two channels — one for requests, one for responses. Or a request struct that carries a reply channel:

```go
type Req struct {
    Data string
    Reply chan Resp
}
type Resp struct {
    Result string
}
```

This is the canonical "reply channel" pattern. Each request carries its own private reply channel, eliminating cross-request confusion. The reply channel is unbuffered for synchronous response or buffered (cap 1) for async with no risk of dropping.

---

## 15. Profile Before Optimising

The single most important rule. Channel-heavy programs sometimes have non-channel bottlenecks (allocator, GC, syscalls). Always:

1. `pprof -cpu`: where is CPU time spent?
2. `pprof -mutex`: is mutex contention the issue?
3. `pprof -block`: are goroutines blocked on something?
4. `runtime/trace`: when do goroutines park and run?

If `runtime.chansend1` and `runtime.chanrecv1` are not in the top 10, the channel itself is not the bottleneck. Optimise the actual hot path.

If they *are* in the top 10, you have a real channel-cost issue and the techniques above apply.

---

## What to Read Next

- **`find-bug.md`** — Correctness bugs grounded in the same internals.
- **`tasks.md`** — Implementation exercises that build intuition for the cost model.
- **`02-runtime-behavior/`** — Scheduler-level views of channel-blocked goroutines.
- **`14-performance-tuning/`** — General Go performance tuning, of which channels are one piece.
