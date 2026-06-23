# 8.17 `container/*` — Professional

> **Audience.** You're choosing data structures for a service that
> runs in production. This file covers the decision points: when
> `container/heap` and `container/list` earn their place, what
> replaces them, and the operational concerns (observability,
> failure modes, contention) that don't show up in the package docs.

## 1. Decision: do you actually need a heap?

Before reaching for `container/heap`, run the cost-benefit:

| Scenario | Use a heap? |
|----------|-------------|
| Fewer than ~100 items, infrequent ops | No. Sort the slice on each change. |
| Items inserted once, drained in order | No. Sort once, iterate. |
| Insert/remove rate < 1k/s, latency-tolerant | Maybe. A heap is overkill; a sorted slice is fine. |
| High insert rate, need top-of-queue cheap | Yes. |
| Expiration-driven (timer wheels, deadlines) | Yes, with the caveat below. |
| Thousands of timers, many cancelled before firing | Hashed timer wheel beats a heap. |

The "hashed timer wheel" point is real: for high-cancellation
workloads (e.g., per-request timeouts where 99% of timers are
cancelled before firing), a wheel's O(1) insert and cancel
outperforms a heap's O(log n) by a wide margin. Go's `time` package
internally uses a heap with bucketing optimizations; for
application-level scheduling at scale, a hashed wheel is worth
implementing.

## 2. Production timer wheel patterns

A scheduler-with-cancel built on `container/heap`:

```go
type Scheduler struct {
    mu     sync.Mutex
    pq     *Heap[*Job]
    wakeCh chan struct{}
    nowFn  func() time.Time // injectable for tests
}

type Job struct {
    Deadline  time.Time
    Fire      func()
    cancelled atomic.Bool
    index     int
}

func (s *Scheduler) Schedule(deadline time.Time, fn func()) *Job {
    j := &Job{Deadline: deadline, Fire: fn}
    s.mu.Lock()
    s.pq.Push(j)
    s.mu.Unlock()
    select {
    case s.wakeCh <- struct{}{}:
    default:
    }
    return j
}

func (s *Scheduler) Cancel(j *Job) {
    j.cancelled.Store(true)
    // do not Remove from the heap; the runner will skip it.
}
```

The "lazy cancel" pattern: instead of `heap.Remove(pq, j.index)`
(which requires the lock and bookkeeping), set a flag and let the
runner skip cancelled jobs at pop time. Cost: stale jobs occupy heap
slots until they bubble up. Benefit: `Cancel` is wait-free.

Trade-off: if cancellations are rare, lazy cancel wastes nothing. If
they dominate (10× more cancels than fires), the heap accumulates
ghosts and `Pop` does extra work. Profile your service's workload
before choosing.

## 3. Observability for queue-backed services

Any production queue should expose:

- `len` (queue depth) — a gauge.
- `enqueued_total`, `dequeued_total` — counters.
- `wait_time_seconds` — histogram of dequeue latency
  (`time.Since(item.enqueuedAt)`).
- `fire_lateness_seconds` — for timer wheels: actual fire time minus
  scheduled deadline.

For a heap, these are easy to instrument inside the wrapper:

```go
func (s *Scheduler) Pop() *Job {
    s.mu.Lock()
    defer s.mu.Unlock()
    j := s.pq.Pop()
    metrics.QueueDepth.Set(float64(s.pq.Len()))
    metrics.WaitTime.Observe(time.Since(j.enqueuedAt).Seconds())
    return j
}
```

Two pitfalls:

1. **Don't put metrics inside `heap.Interface` methods.** `Less` and
   `Swap` are called O(log n) times per operation. A counter
   increment per swap pollutes both your metrics and your
   performance profile.

2. **Histogram cardinality.** Don't label per-job-type; you'll
   explode the metric set. Use a small fixed set of priority bands.

## 4. Replacing list-LRU with a sharded cache

A mutex-protected `container/list` LRU bottlenecks at one core under
contention. For services serving thousands of cache lookups per
second across many goroutines, shard the cache by key hash:

```go
const shardCount = 32

type ShardedLRU[K comparable, V any] struct {
    shards [shardCount]*lockedLRU[K, V]
    hash   func(K) uint64
}

type lockedLRU[K comparable, V any] struct {
    mu sync.Mutex
    c  *LRU[K, V]
}

func (s *ShardedLRU[K, V]) Get(k K) (V, bool) {
    sh := s.shards[s.hash(k)%shardCount]
    sh.mu.Lock()
    defer sh.mu.Unlock()
    return sh.c.Get(k)
}
```

Sharding linearizes throughput up to `shardCount` cores. Beyond that,
contention on individual hot keys dominates and you need
admission-based caches (ristretto, TinyLFU). For most services, a
32-way shard is plenty.

## 5. When to use `hashicorp/golang-lru/v2`

The library does sharding, generics, expiration, and metrics. For new
projects, the case for rolling your own is:

| Reason | Verdict |
|--------|---------|
| Avoiding the dependency | Weak; it's a 600-line library with no transitive deps |
| Custom eviction policy | Real; if you need 2Q, ARC, or LFU specifically |
| Embedded in a tight loop | Real; the call overhead matters at >1M ops/s |
| Pure-stdlib codebase policy | Sometimes (regulated environments) |
| "I want to understand the internals" | Build it once, then import |

For 90% of services, importing the library is right. Implement your
own only when you have a specific reason to.

## 6. The "expiring LRU" trap

A common variant: cache entries expire after T seconds. Two ways to
implement it:

**Lazy expiration.** On `Get`, check `time.Since(entry.created) < T`.
If expired, evict and return miss. Cheap on the write path; reads
do the work. Stale entries take up space until they're touched.

**Active expiration.** A goroutine scans the cache and evicts expired
entries. More predictable memory; adds a background CPU cost.

For most purposes, lazy expiration is fine. Active expiration is
worth it when:

- The cache approaches its size limit and lazy expiration leaves stale
  entries crowding live ones.
- The service has predictable quiet periods where the scanner can run.
- You need expired entries to be observable (e.g., for cache-coherence
  guarantees).

`hashicorp/golang-lru/v2/expirable` does lazy expiration. For active,
you build it yourself — `time.NewTicker` plus a goroutine that walks
the list back-to-front and removes expired entries.

## 7. The "object pool" anti-pattern

A common temptation: use `container/list` as a pool of reusable
buffers. Resist it.

**Use `sync.Pool` instead.** `sync.Pool` is designed for this exact
case: a free list of reusable objects, with two important guarantees
that `container/list` doesn't give you:

1. **Per-P (per-CPU) caching.** No cross-core contention.
2. **GC integration.** Pooled objects are released during GC, so the
   pool doesn't accumulate forever.

`container/list` as a pool requires a mutex and grows unbounded. The
only case where rolling your own beats `sync.Pool` is when you need
deterministic ordering (FIFO over LIFO) — and at that point, a
buffered channel is usually cleaner.

## 8. Bounded queues: channel vs custom

For "I need a FIFO of size N with backpressure," `make(chan T, N)`
is the canonical choice:

```go
queue := make(chan Job, 1000)
// producer
queue <- job // blocks if full
// consumer
job := <-queue // blocks if empty
```

You get blocking, fair scheduling, and graceful shutdown via `close`.
Don't build a custom ring-buffer-with-mutex unless you have a
specific reason — the channel handles 99% of bounded-queue cases at
near-optimal performance.

The 1% where channels lose:

- **Non-blocking peek.** Channels can't peek; once you receive, the
  value is gone. If you need "look at the next item without removing
  it," use a list or a ring with a mutex.

- **Out-of-order removal.** Channels are strict FIFO. To remove a
  specific element by ID (e.g., cancellation), you need a different
  structure.

- **Priority.** A channel is FIFO. If you need a priority queue with
  blocking behavior, wrap `container/heap` with a `sync.Cond` for
  signaling.

## 9. The "blocking priority queue" pattern

Combine `container/heap` with `sync.Cond`. The shape: `Push` locks,
pushes, signals; `Pop` locks, waits on the condition while empty,
pops. Cancellation via `context.Context` is the awkward part because
`cond.Wait` doesn't take a context — the workaround is a separate
goroutine that calls `cond.Broadcast` when the context is done, and
`Pop` re-checks the context after each wake. See
[find-bug.md](find-bug.md) §9 for the goroutine-leak hazard and the
fix.

The `sync.Cond` is necessary because channels can't carry "highest
priority" semantics. The pattern also applies to LIFO stacks and
deadline queues — anything where consumers block on emptiness.

## 10. Heap-backed rate limiter

A token-bucket limiter is usually array-backed, but a deadline-driven
limiter ("fire X events at exactly these times") is a heap. The heap
stores the timestamps of recent fires; popping older entries gives a
sliding window; the next-fire time is `pq.Peek().Add(window)` if the
window is full. For short windows and low rates this is overkill —
`golang.org/x/time/rate` does it better with a token bucket. For
exact-rate "no more than N events per second forever," the heap is
precise.

## 11. Replacing `container/list` with `slices`

The `slices` package (Go 1.21+) gives you `Insert`, `Delete`,
`Reverse`, `Sort` as generic functions on `[]T`. For lists where you
don't need O(1) middle-insert, `slices` is faster, simpler, and
compiles without `any`:

```go
// Old: container/list
l := list.New()
l.PushBack("a")
l.PushBack("b")
for e := l.Front(); e != nil; e = e.Next() {
    fmt.Println(e.Value)
}

// New: slices
s := []string{"a", "b"}
for _, v := range s {
    fmt.Println(v)
}
```

The case for keeping `container/list`:

- You hold `*Element` references for O(1) remove/move.
- The list is long enough that mid-sequence inserts dominate.

If you're using a list as "an append-only sequence," it's a slice
in disguise. Migrate.

## 12. Memory budget for caches

Sizing an LRU cache is two questions:

1. **How many entries?** Bound the working set for your hit-rate
   target.
2. **How much memory per entry?** Sum of key, value, and overhead.

For `container/list`-based LRU, overhead is roughly:

- `*list.Element`: 48 bytes (next, prev, list, value `any`).
- `entry` struct (key + val): depends on K and V.
- Map slot: ~16 bytes amortized.

So a `LRU[string, []byte]` with 64-byte keys and 1-KiB values runs at
~1.1 KiB per entry. A 1M-entry cache is ~1.1 GiB before you count
the value bytes themselves.

For very small entries (a `LRU[uint64, uint64]` for a deduplication
filter), overhead is 90% of the cost — switch to a Bloom filter or a
cuckoo filter, which are dramatically more compact at the cost of
false positives.

## 13. The `container/ring` use case that actually shipped

Real-world `container/ring` use is rare but not zero. Plausible
shapes:

- **Round-robin DNS resolver.** A ring of resolvers; advance on each
  query. Resolvers can be added or removed at runtime. (Slice + index
  works too; the ring shows up in legacy code.)
- **Replay buffer of fixed-size events.** A ring of 1000 events;
  overwrite the oldest. (Slice ring buffer is faster.)
- **Linked-list of scheduler runqueues.** Some custom schedulers use
  a ring of doubly linked queues; not common in user code.

If you're starting fresh, you almost always want a slice or a
channel. If you're maintaining code that uses `container/ring`, the
package is stable and well-tested — leave it alone unless you have a
profiling reason to change.

## 14. Failure modes in production

What goes wrong with these structures under load:

| Failure | Cause | Mitigation |
|---------|-------|------------|
| Heap appears wrong | Forgot `heap.Fix` after mutating priority | Make priority immutable; use `Update`/`Cancel` API only |
| LRU misses go up over time | Mutex contention starves writers | Shard the cache |
| Memory grows without bound | Cache has no size limit, or cancelled jobs accumulate | Set explicit caps; ensure lazy-cancel garbage gets pruned |
| Latency P99 spikes | Single-mutex queue serializes all ops | Sharded queue or lock-free structure |
| Map+List divergence | Bug where list and map fall out of sync | Build the cache around a single source of truth |
| Goroutine leak | `cond.Wait` without timeout/cancellation | Plumb `context.Context` through, always |

The last point is worth emphasizing. Any blocking primitive backed by
a `sync.Cond` should expose a context-aware path or a documented
shutdown protocol. Otherwise services don't shut down cleanly and
your shutdown timeouts trigger.

## 15. Testing strategies

For data structures, two test layers:

**Unit tests** verify the contract on the public API. Push items,
pop in order, check sizes, exercise edge cases (empty, single
element, duplicates, equal priorities).

**Property tests** verify invariants on random inputs. The shape:

```go
func TestHeapInvariant(t *testing.T) {
    rng := rand.New(rand.NewSource(42))
    h := pq.New(func(a, b int) bool { return a < b })
    for i := 0; i < 10000; i++ {
        h.Push(rng.Intn(1000))
    }
    last := math.MinInt
    for h.Len() > 0 {
        v := h.Pop()
        if v < last {
            t.Fatalf("non-monotonic pop: %d after %d", v, last)
        }
        last = v
    }
}
```

For an LRU, randomly interleave `Get` and `Put` and assert that
recently-accessed keys are present and the cache size never exceeds
the limit. This kind of fuzz finds the real bugs (off-by-one in
`Swap`, forgotten `MoveToFront`, etc.) faster than hand-written
cases.

## 16. What to read next

- [optimize.md](optimize.md) — when constant factors matter and you
  consider replacing the standard implementations.
- [find-bug.md](find-bug.md) — drills targeting production-shaped bugs.
- [interview.md](interview.md) — the questions hiring loops actually
  ask about these structures.
- [`../16-sort-slices-maps/`](../16-sort-slices-maps/junior.md) — the modern
  generic alternatives.
