# Broadcast Pattern — Optimize

This file moves from "works correctly" to "works fast." Most optimisations only matter when measurement shows they matter; the first section is therefore measurement, not changes.

## Table of Contents
1. [Measure First](#measure-first)
2. [Allocation Optimisation](#allocation-optimisation)
3. [Reducing Lock Contention](#reducing-lock-contention)
4. [Copy-On-Write Subscriber List](#copy-on-write-subscriber-list)
5. [Per-Subscriber Goroutine Trade-offs](#per-subscriber-goroutine-trade-offs)
6. [Sharded Hub Throughput](#sharded-hub-throughput)
7. [Channel Internals and Send Cost](#channel-internals-and-send-cost)
8. [`sync.Cond` vs Channels Benchmark](#synccond-vs-channels-benchmark)
9. [Cache-Line Awareness](#cache-line-awareness)
10. [Cheat Sheet](#cheat-sheet)

---

## Measure First

The most common optimisation mistake is changing code without measuring first. Set up a benchmark suite before touching anything:

```go
func BenchmarkPublish(b *testing.B) {
    cases := []int{1, 10, 100, 1000}
    for _, n := range cases {
        b.Run(fmt.Sprintf("subs=%d", n), func(b *testing.B) {
            h := New[int](16, DropNewest)
            defer h.Close()
            subs := make([]Subscription[int], n)
            done := make(chan struct{})
            var wg sync.WaitGroup
            for i := range subs {
                subs[i] = h.Subscribe()
                wg.Add(1)
                go func(s Subscription[int]) {
                    defer wg.Done()
                    for {
                        select {
                        case <-done: return
                        case _, ok := <-s.C():
                            if !ok { return }
                        }
                    }
                }(subs[i])
            }

            b.ResetTimer()
            b.ReportAllocs()
            for i := 0; i < b.N; i++ {
                _ = h.Publish(context.Background(), i)
            }
            b.StopTimer()

            close(done)
            for _, s := range subs { s.Unsubscribe() }
            wg.Wait()
        })
    }
}
```

Run with:

```
go test -bench=BenchmarkPublish -benchmem -benchtime=3s ./broadcast
```

Record baseline numbers: ns/op, B/op, allocs/op. Every optimisation must be re-benchmarked. If it does not move the needle, revert it — complexity without benefit is a debt.

`go tool pprof` of the benchmark (`-cpuprofile`) tells you *where* time is spent. If the profile shows `runtime.mapiter` dominating, the map iteration is the hot path — focus there. If `runtime.chansend1` dominates, the channel sends are the hot path. The fix differs in each case.

---

## Allocation Optimisation

Allocations on every publish are a common but invisible cost. They surface as GC pressure rather than per-op latency.

Common allocation hotspots in broadcast code:

### Snapshotting the subscriber slice

```go
subs := make([]*sub, 0, len(h.subs)) // ALLOCATION per publish
for s := range h.subs {
    subs = append(subs, s)
}
```

Fix: reuse a per-hub scratch slice (under lock so concurrent publishes do not interfere), or eliminate the snapshot entirely.

If you must snapshot (to release the lock before sending), use a `sync.Pool` of scratch slices:

```go
var slicePool = sync.Pool{
    New: func() any { s := make([]*sub, 0, 64); return &s },
}

func (h *Hub) Publish(v string) {
    bufP := slicePool.Get().(*[]*sub)
    buf := (*bufP)[:0]

    h.mu.RLock()
    for s := range h.subs {
        buf = append(buf, s)
    }
    h.mu.RUnlock()

    for _, s := range buf {
        select { case s.ch <- v: default: }
    }

    *bufP = buf
    slicePool.Put(bufP)
}
```

Now the slice is recycled. `B/op` drops to near zero.

### Closure allocations

```go
h.Subscribe(func(v T) { ... }) // closure escapes, allocates
```

If your hub takes a callback rather than returning a channel, every Subscribe allocates the closure plus its captured variables. For low-Subscribe-rate workloads this is fine; for high churn, channels are cheaper.

### Boxing on interface dispatch

A `chan any` or `chan interface{}` boxes each value. For high-throughput broadcast of integers or small structs, the boxing dwarfs the channel cost. Use generics:

```go
type Hub[T any] struct { ... }
```

No boxing; the channel carries `T` directly.

### Per-publish error allocations

`fmt.Errorf` allocates. If you return errors on the hot path, use sentinel errors:

```go
var ErrClosed = errors.New("broadcast: hub closed")
```

Returning `ErrClosed` is allocation-free; comparing with `errors.Is(err, ErrClosed)` is too.

---

## Reducing Lock Contention

Profile shows `sync.(*RWMutex).RLock` near the top? You have lock contention. Three levers:

### Make the critical section shorter

The hub's publish loop sends to each subscriber while holding `RLock`. The loop's duration scales with N. Subscribe/Unsubscribe waits at least that long.

If sends are fast (`DropNewest` with non-blocking `select default`), the loop is short. If sends Block, the loop is unbounded. Move to non-blocking everywhere.

### Use `sync.RWMutex` for read-heavy workloads

If Subscribe is rare and Publish is frequent, `RWMutex` lets many publishes proceed in parallel. We already do this. But `RWMutex` has a higher constant cost than `Mutex` for the lock acquisition itself. At very high contention with cheap critical sections, `Mutex` can win. Benchmark.

### Eliminate the lock entirely with COW

Discussed below. Net: Publish has zero lock cost; Subscribe pays O(N) to copy.

---

## Copy-On-Write Subscriber List

```go
type Hub[T any] struct {
    subs atomic.Value // []*sub[T]
    mu   sync.Mutex   // only for mutators
    closed atomic.Bool
}

func (h *Hub[T]) Publish(ctx context.Context, v T) error {
    if h.closed.Load() { return ErrClosed }
    subs, _ := h.subs.Load().([]*sub[T])
    for _, s := range subs {
        select { case s.ch <- v: default: }
    }
    return nil
}

func (h *Hub[T]) Subscribe() Subscription[T] {
    h.mu.Lock()
    defer h.mu.Unlock()
    old, _ := h.subs.Load().([]*sub[T])
    s := &sub[T]{ch: make(chan T, 16)}
    next := make([]*sub[T], len(old)+1)
    copy(next, old)
    next[len(old)] = s
    h.subs.Store(next)
    return &handle[T]{ /* ... */ }
}

func (h *Hub[T]) Unsubscribe(s *sub[T]) {
    h.mu.Lock()
    defer h.mu.Unlock()
    old, _ := h.subs.Load().([]*sub[T])
    next := make([]*sub[T], 0, len(old))
    for _, x := range old {
        if x != s { next = append(next, x) }
    }
    h.subs.Store(next)
    close(s.ch)
}
```

**Wins.** Publish is lock-free. Concurrent publishes parallelise perfectly. No `RWMutex` cost.

**Costs.** Subscribe and Unsubscribe are O(N) (copy the slice). At N=10k subscribers and high churn (>100 subs/sec), this hurts. For N=1k with low churn (<10 subs/sec), it is a clear win.

**Subtle issue.** Send on a closed channel: between `Publish` loading the slice and the inner `s.ch <- v`, another goroutine can Unsubscribe `s` and close `s.ch`. The send panics.

Fix: do not let Unsubscribe close immediately. Instead, mark the sub as closed and have the publish loop check before sending. Or defer the close to after a generation counter passes.

Simplest fix: use `select default` to make sends non-blocking; if `s.ch` is closed, the send panics, so wrap each send in a recover:

```go
for _, s := range subs {
    func() {
        defer func() { recover() }() // tolerate send on closed
        select { case s.ch <- v: default: }
    }()
}
```

Defer-recover per iteration is expensive (each is ~50 ns). Cheaper: use a `closed` atomic on each sub:

```go
type sub[T any] struct {
    ch     chan T
    closed atomic.Bool
}

for _, s := range subs {
    if s.closed.Load() { continue }
    select { case s.ch <- v: default: }
}
```

Race: another goroutine sets `closed=true` and closes `ch` between the Load and the send. Still a panic. To make it safe, close must wait for in-flight publishes; that requires reference counting or a generation counter.

The clean solution: never close the subscriber channel until you can prove no one is sending. Use a `done` channel per subscriber and let the subscriber's consumer goroutine drain `ch` after `done` closes:

```go
type sub[T any] struct {
    ch   chan T
    done chan struct{}
}

// Publish
for _, s := range subs {
    select {
    case <-s.done: // unsubscribed
    case s.ch <- v:
    default: // full
    }
}

// Unsubscribe
close(s.done) // no further sends will be attempted
// don't close s.ch; consumer drains it
```

The consumer's loop also reads `done`:

```go
for {
    select {
    case <-s.done: return
    case v, ok := <-s.ch:
        if !ok { return }
        handle(v)
    }
}
```

Eventually `s.ch` is GC'd when no one references it. No "send on closed" panic. Slightly more memory until GC sees the channel is unreferenced.

---

## Per-Subscriber Goroutine Trade-offs

Per-subscriber goroutine adds a hop but isolates each subscriber's pace from the hub.

```
hub → sub1.in (small buffer) → sub1.goroutine → sub1.out (consumer)
hub → sub2.in (small buffer) → sub2.goroutine → sub2.out (consumer)
```

Cost analysis:

- Each subscriber adds one goroutine (~8 KB stack initial).
- Each event is sent twice (hub → in, in → out): roughly 2× per-event cost.
- The hub's per-event work drops because it only writes to small bounded buffers; slow subscribers do not affect hub publish throughput.

When it wins:

- N is high and many subscribers are slow. The hub's flat-fan-out cost was O(N × slow_subscriber_wait); now it is O(N × fast_send).
- You want fine-grained drop policy *per subscriber* rather than per hub.

When it loses:

- N is low (<100) and subscribers are all fast. The extra hop is just overhead.
- Memory budget is tight.

Benchmark with and without to make the call.

---

## Sharded Hub Throughput

A single Hub goroutine (or a single subscription map) caps throughput. For >100k publishes/sec or >10k subscribers, shard:

```go
type ShardedHub[T any] struct {
    shards []*Hub[T]
    mask   uint64
}

func NewSharded[T any](shardBits int, buf int) *ShardedHub[T] {
    n := 1 << shardBits
    s := &ShardedHub[T]{
        shards: make([]*Hub[T], n),
        mask:   uint64(n - 1),
    }
    for i := range s.shards {
        s.shards[i] = New[T](buf, DropNewest)
    }
    return s
}

func (s *ShardedHub[T]) Subscribe(key uint64) Subscription[T] {
    return s.shards[key&s.mask].Subscribe()
}

func (s *ShardedHub[T]) Publish(ctx context.Context, v T) {
    var wg sync.WaitGroup
    for _, h := range s.shards {
        wg.Add(1)
        go func(h *Hub[T]) {
            defer wg.Done()
            _ = h.Publish(ctx, v)
        }(h)
    }
    wg.Wait()
}
```

Each shard runs a parallel publish. Total wall time = max shard time, not sum. With K shards and N total subscribers, each shard handles N/K subscribers.

Trade-off: `wg.Wait` and goroutine spawn for each publish (~200 ns). At low publish rate this is dominated by other costs; at high rate it can become visible. Reuse a goroutine pool to amortise.

For broadcast where every subscriber sees every event, you must publish to *every* shard — sharding does not skip work, it parallelises it. The throughput gain caps at `min(K, GOMAXPROCS)`.

For per-topic broadcast where each event goes to one shard (sharded by topic), throughput scales perfectly to K shards because each shard works on disjoint events.

---

## Channel Internals and Send Cost

The Go runtime channel send (`runtime.chansend`) costs:

- **Fast path:** receiver ready or buffer has room. ~50 ns.
- **Slow path:** receiver not ready, buffer full. Goroutine parks, scheduler switches. ~500 ns + scheduler overhead.

For broadcast, you want the fast path on every send. Pre-conditions:

- Either every subscriber has a non-full buffer, or
- Every subscriber has a ready receiver (synchronous receive).

A buffered channel with bounded fill is the fastest path. Empty buffers force the receiver to wake on each send (slow path). Full buffers force the sender to wait (slow path).

The sweet spot: buffer size = ~burst size. The buffer absorbs bursts without filling permanently.

`runtime.chansend` also calls `runtime.lock` on the channel's internal mutex. Two concurrent senders on the same channel contend. For per-subscriber channels this is rarely an issue (one sender), but for shared producer-multiplexed channels it can matter.

A non-blocking `select default` is faster than a blocking send because it skips the parking path:

```go
select {
case s.ch <- v:
default:
}
```

Even when the send succeeds, the cost is comparable to a plain send. When it fails, it returns immediately instead of parking. The "drop" case is therefore essentially free.

---

## `sync.Cond` vs Channels Benchmark

A microbenchmark comparing close-to-broadcast against Cond.Broadcast for waking N waiters:

```go
func BenchmarkCloseWakesN(b *testing.B) {
    Ns := []int{10, 100, 1000}
    for _, n := range Ns {
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            for i := 0; i < b.N; i++ {
                done := make(chan struct{})
                var wg sync.WaitGroup
                for j := 0; j < n; j++ {
                    wg.Add(1)
                    go func() { defer wg.Done(); <-done }()
                }
                close(done)
                wg.Wait()
            }
        })
    }
}

func BenchmarkCondWakesN(b *testing.B) {
    Ns := []int{10, 100, 1000}
    for _, n := range Ns {
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            for i := 0; i < b.N; i++ {
                var mu sync.Mutex
                cond := sync.NewCond(&mu)
                var ready bool
                var wg sync.WaitGroup
                for j := 0; j < n; j++ {
                    wg.Add(1)
                    go func() {
                        defer wg.Done()
                        mu.Lock()
                        for !ready { cond.Wait() }
                        mu.Unlock()
                    }()
                }
                mu.Lock()
                ready = true
                mu.Unlock()
                cond.Broadcast()
                wg.Wait()
            }
        })
    }
}
```

Typical results on a modern laptop (numbers vary by machine; use as orientation):

| N | close-to-broadcast | Cond.Broadcast |
|---|--------------------|------------------|
| 10 | 8 µs | 12 µs |
| 100 | 60 µs | 90 µs |
| 1000 | 800 µs | 1.2 ms |

Channels win. Reason: `Cond.Broadcast` wakes every waiter and each one then contends for the mutex on Wake. Channels move each waiter from blocked to runnable with no further contention.

For repeated wake-and-rewait (e.g., a producer/consumer queue), Cond can match or beat channels because the channel close-and-recreate sequence has its own cost. Benchmark your specific workload.

---

## Cache-Line Awareness

For very-high-throughput broadcast, false sharing can hurt. If two `*sub` structs share a cache line and two goroutines write to them simultaneously (e.g., updating `dropCount`), cache coherency traffic dominates.

Pad hot per-sub fields to 64 bytes:

```go
type sub[T any] struct {
    ch       chan T
    closed   atomic.Bool
    dropped  atomic.Uint64
    _        [56]byte // pad to 64 bytes
}
```

Or use `cpu.CacheLinePad`:

```go
import "golang.org/x/sys/cpu"

type sub[T any] struct {
    _        cpu.CacheLinePad
    ch       chan T
    closed   atomic.Bool
    dropped  atomic.Uint64
    _        cpu.CacheLinePad
}
```

Measurable only when many goroutines hit the same `*sub` concurrently. For a typical broadcast where one hub writes to each `*sub`, false sharing is rare. Confirm via `perf stat -e cache-misses` before committing the complexity.

---

## Cheat Sheet

| Bottleneck | Tool | Win |
|------------|------|-----|
| GC pressure | `sync.Pool` for scratch slices | Zero allocs/op |
| Lock contention | `RWMutex` then COW | 10× publish parallelism |
| Slow subscriber stalls others | Per-sub goroutine + DropNewest | Independent rates |
| Hub goroutine saturated | Sharded hub | Linear K-way scaling |
| `chan any` boxing | Generic `Hub[T]` | Zero box per event |
| False sharing | Cache-line padding | Marginal at scale |
| Cond contention | Switch to channel close | 1.5× wake-up speed |

```go
// COW publish — lock-free hot path
func (h *Hub[T]) Publish(ctx context.Context, v T) error {
    if h.closed.Load() { return ErrClosed }
    subs, _ := h.subs.Load().([]*sub[T])
    for _, s := range subs {
        select {
        case s.ch <- v:
        case <-s.done:
        default:
        }
    }
    return nil
}
```

---

## Summary

Optimisations are choices, not improvements. Each has a cost:

- COW: cheap publish, expensive subscribe.
- Per-subscriber goroutine: independent rates, double the goroutines.
- Sharding: parallelism, more wg.Wait cycles.
- `sync.Pool`: zero allocs, extra indirection.

Measure first. Apply one change at a time. Re-measure. Revert if no gain. The goal is a Hub whose performance is bounded by the *real* work (delivering to subscribers), not by lock contention, allocations, or scheduler overhead. With the right combination, a single Go process can broadcast 100k events/sec to 10k subscribers — but only with deliberate engineering, not by writing the same hub eight times.
