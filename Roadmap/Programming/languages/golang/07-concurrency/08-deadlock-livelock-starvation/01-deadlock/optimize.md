# Deadlock in Go — Optimize

> "Optimization" here means **two distinct things.** First, reducing the chance of deadlock through architectural choices. Second, reducing the cost of the deadlock-prevention machinery so it does not become a bottleneck. Both matter.

---

## What we optimize

A naive deadlock prevention strategy — coarse locks, `singleflight` everywhere, channels for every shared variable — produces correct, deadlock-free code that is slow. A naive performance strategy — many fine-grained locks, callbacks under lock, optimistic operations everywhere — produces fast code that deadlocks regularly.

The optimization conversation is the tradeoff between **safety** and **throughput** at each point in a concurrent system.

---

## Optimization 1: replace mutex with `atomic` where shape permits

A `sync.Mutex.Lock`/`Unlock` pair on an uncontested mutex costs roughly 20 ns. An `atomic.AddInt64` costs roughly 5-8 ns. For counters, flags, and pointer swaps, the atomic is faster *and* cannot deadlock.

Before:

```go
var (
    mu    sync.Mutex
    count int64
)

func Inc() {
    mu.Lock()
    count++
    mu.Unlock()
}
```

After:

```go
var count int64

func Inc() {
    atomic.AddInt64(&count, 1)
}
```

Or with the typed wrapper (Go 1.19+):

```go
var count atomic.Int64

func Inc() {
    count.Add(1)
}
```

Atomic operations require careful memory-ordering reasoning. For simple counters and flags, Go's `atomic` package gives you what you need. For complex invariants (multiple fields that must update together), atomics are not enough and you need a mutex or a lock-free algorithm.

---

## Optimization 2: copy-on-write for read-heavy data

If reads vastly outnumber writes, replace the mutex with `atomic.Value` storing a pointer to immutable data:

```go
type Config struct { /* fields */ }

var cfg atomic.Value // *Config

func GetConfig() *Config {
    return cfg.Load().(*Config)
}

func UpdateConfig(c *Config) {
    cfg.Store(c)
}
```

Readers do one atomic load. No lock. No contention. Writers prepare a new value outside any critical section and atomically swap the pointer.

Multiple writers race — if two updates happen simultaneously, one overwrites the other. If you need linearizable updates, serialize writers with a separate mutex held only during the prepare-and-swap step. Readers still pay nothing.

Pros: readers are deadlock-free and contention-free. Throughput is essentially zero overhead.

Cons: every update allocates a new copy. For large data structures and frequent writes, this is expensive. Use only when reads dominate.

---

## Optimization 3: shard the lock

A single hot mutex protecting a `map[K]V` is a scalability ceiling. Replace with N shards, each with its own mutex:

```go
type ShardedMap struct {
    shards [256]struct {
        mu sync.Mutex
        m  map[string]int
    }
}

func (s *ShardedMap) Get(key string) (int, bool) {
    sh := &s.shards[hash(key)%256]
    sh.mu.Lock()
    defer sh.mu.Unlock()
    v, ok := sh.m[key]
    return v, ok
}
```

Contention drops by a factor of 256 (for evenly distributed keys). Each shard's lock is rarely contested.

Caveat: any operation that touches multiple shards (e.g., iterate all entries) must acquire multiple locks. Apply lock-order rank: always acquire shards in increasing index order. Without that, sharded structures are a deadlock-amplifier — more locks, more inversion opportunities.

`sync.Map` is the standard library's sharded-ish map. It uses two maps and a clever protocol to provide lock-free reads for keys that are read more than they are written. Use it for that specific workload; for general-purpose maps, the basic sharded version is often faster and easier to reason about.

---

## Optimization 4: reduce the locked region

The cost of a lock is roughly the *duration* it is held. A function that locks for 100 µs serializes the system to 10,000 operations per second per lock. A function that locks for 1 µs serializes to 1,000,000 per second.

The optimization: do as much work as possible outside the lock.

Before:

```go
func (c *Cache) Insert(key string, val *Item) {
    c.mu.Lock()
    defer c.mu.Unlock()
    serialized := expensiveSerialization(val)
    c.m[key] = serialized
}
```

After:

```go
func (c *Cache) Insert(key string, val *Item) {
    serialized := expensiveSerialization(val) // outside lock
    c.mu.Lock()
    defer c.mu.Unlock()
    c.m[key] = serialized
}
```

Serialization happens outside the lock. The lock is held only for the map write. Throughput rises by the ratio of `expensiveSerialization` cost to map-write cost — often 10x or more.

This pattern also reduces deadlock risk: less time holding the lock means less window for another goroutine to take a second lock and form a cycle.

---

## Optimization 5: read-only snapshot then mutate

For read-then-write patterns where the read is heavy and the write is light:

```go
func (s *Store) Recompute(key string) {
    s.mu.Lock()
    val := s.data[key]
    s.mu.Unlock()

    newVal := expensiveCompute(val)

    s.mu.Lock()
    if current, ok := s.data[key]; ok && current == val {
        s.data[key] = newVal // only update if nothing changed
    }
    s.mu.Unlock()
}
```

This is optimistic concurrency. Read snapshot, compute outside lock, conditionally apply. Sacrifices linearizability (the "current == val" check may fail and you discard the work), but holds the lock for tiny windows.

For high-contention recompute paths, this can improve throughput by 100x. For low-contention paths, it is unnecessary complexity.

---

## Optimization 6: `RWMutex` for read-heavy with rare writes

When the read/write ratio is high (say > 10:1) and reads are expensive (i.e., they hold the lock for non-trivial time), `sync.RWMutex` lets readers share:

```go
var mu sync.RWMutex
var data map[string]int

func Read(key string) int {
    mu.RLock()
    defer mu.RUnlock()
    return data[key]
}

func Write(key string, val int) {
    mu.Lock()
    defer mu.Unlock()
    data[key] = val
}
```

Many readers proceed concurrently. Writes are exclusive.

Caveats:

- `RWMutex` has more overhead than `Mutex` for short critical sections. If your read holds the lock for 50 ns, `Mutex` is faster than `RWMutex`. Benchmark.
- `RWMutex` cannot be upgraded. A reader cannot then become a writer. See Bug 13 in `find-bug.md`.
- Writer starvation is prevented by Go's implementation (pending writers block new readers), but this means under heavy write traffic readers are not as parallel as you might hope.

---

## Optimization 7: channel-based pipeline over shared queue

A worker pool with shared `chan Job` (each worker pulls jobs from the same channel) has a hidden lock — `chan` operations serialize through internal mutexes. For very high throughput, channels can become the bottleneck.

Optimization: per-worker channels with a dispatcher:

```go
type Pool struct {
    workers []chan Job
    next    atomic.Int64
}

func (p *Pool) Submit(j Job) {
    i := p.next.Add(1) % int64(len(p.workers))
    p.workers[i] <- j
}
```

Each worker pulls from its own channel. Sender uses an atomic counter to distribute, no shared queue lock. Throughput scales with worker count.

Cost: a worker with no jobs sits idle while others are loaded. For uneven work distribution, this is worse than a shared queue. Use only when jobs are uniform in cost.

---

## Optimization 8: lock-free where it counts

For the very hottest paths (e.g., a network packet queue at 1 Mops/s), even `sync.Mutex` is too slow. Lock-free queues using compare-and-swap on `unsafe.Pointer` give the highest possible throughput.

```go
type Node struct {
    val  any
    next unsafe.Pointer // *Node
}

type Queue struct {
    head unsafe.Pointer
    tail unsafe.Pointer
}

func (q *Queue) Enqueue(v any) {
    n := &Node{val: v}
    for {
        tail := atomic.LoadPointer(&q.tail)
        tailNode := (*Node)(tail)
        next := atomic.LoadPointer(&tailNode.next)
        if next == nil {
            if atomic.CompareAndSwapPointer(&tailNode.next, nil, unsafe.Pointer(n)) {
                atomic.CompareAndSwapPointer(&q.tail, tail, unsafe.Pointer(n))
                return
            }
        } else {
            atomic.CompareAndSwapPointer(&q.tail, tail, next)
        }
    }
}
```

(This is the Michael-Scott queue, sketched.)

Pros: no lock, no deadlock, no priority inversion. Massive throughput on high-contention workloads.

Cons: subtle. The code above has the "ABA problem" (a node that is freed and reused at the same address makes the CAS succeed incorrectly). Production lock-free queues use hazard pointers, epochs, or generation counters. Reading the code is hard. Debugging it is harder. Use lock-free only when you have measured the alternative and know that it is the bottleneck.

---

## Optimization 9: lazy lock acquisition with `TryLock`

For background or housekeeping work, you can `TryLock` and skip if busy:

```go
func (c *Cache) maybeEvict() {
    if !c.mu.TryLock() {
        return // someone else is busy, skip eviction this round
    }
    defer c.mu.Unlock()
    // evict
}
```

The background job runs only when the cache is idle. If the cache is hot, eviction is deferred. Throughput is unaffected; eviction is best-effort.

Pros: zero contention with the hot path.

Cons: eviction may starve if the cache is permanently hot. Add a fallback: after N skipped attempts, force `Lock` to ensure eviction eventually happens.

---

## Optimization 10: profile-guided lock optimization

Use `go test -bench -mutexprofile` and `go tool pprof` to identify hot locks:

```bash
go test -bench=. -mutexprofile=mu.prof
go tool pprof mu.prof
> top
```

The `top` command shows mutexes by total wait time. The hottest ones are your contention bottlenecks. Optimize those first.

Common findings:

- A single global mutex with 90% of total wait. Shard or replace with lock-free.
- A mutex held during I/O. Move the I/O outside.
- A `RWMutex` where writes are too frequent to benefit from sharing. Switch to `Mutex` or shard.
- A `sync.Once` mutex that appears in a hot path. The once is being re-entered too often — restructure.

Without profiling, lock optimization is guesswork. With profiling, you target the actual bottleneck.

---

## Tradeoff: safety vs throughput

| Pattern | Throughput | Deadlock risk | Reasoning cost |
|---|---|---|---|
| Single global Mutex | low | low | low |
| Sharded Mutex | medium | medium | low |
| `sync.RWMutex` | medium-high (read heavy) | medium | low |
| `atomic.Value` (COW) | high (reads) | none | medium |
| Channel-based ownership | medium | low | medium |
| `atomic` operations | very high | none | medium |
| Lock-free CAS | very high | none | high |

Pick the simplest pattern that meets your throughput target. Reach for lock-free CAS only when you have proven the simpler patterns are inadequate. Premature lock-free is one of the worst kinds of premature optimization.

---

## When to invest in lock-order ranking

Lock-order ranking (from `senior.md`) costs effort to design and maintain. The investment is worth it when:

- The package has 3+ mutexes.
- The same goroutine ever holds two of them simultaneously.
- Code change rate is high (frequent contributors, frequent refactors).
- A deadlock incident has happened in the past 6 months.

If none of these apply, ranking is overkill — discipline ("never hold a lock across calls") may suffice.

If all apply, ranking is essential. The cost of a single production deadlock outweighs hours of design and per-Lock runtime overhead.

---

## Cost of `goleak` in tests

`goleak.VerifyNone(t)` takes a goroutine snapshot at deferred-time and compares. For tests with ~10 goroutines, the cost is negligible (< 1 ms). For tests with thousands of goroutines (load tests), the cost can be 100 ms or more.

Optimization: use `goleak.IgnoreCurrent()` to skip pre-existing goroutines. For load tests, skip `goleak` entirely or use sampling.

---

## Cost of `go-deadlock` in production

`github.com/sasha-s/go-deadlock` maintains per-goroutine held-lock lists and walks them on every `Lock`. Reported overhead is 5-30% on hot paths. Not appropriate for production.

Use `go-deadlock` in CI only, via build tags:

```go
//go:build deadlock
package mypkg

import deadlock "github.com/sasha-s/go-deadlock"

type Mutex = deadlock.Mutex
```

```go
//go:build !deadlock
package mypkg

import "sync"

type Mutex = sync.Mutex
```

Run `go test -tags deadlock` in CI. Production uses `sync.Mutex` with zero overhead.

---

## Common anti-optimizations

Things that sound like they help, but make deadlock more likely:

- **Holding a lock "just in case."** Coarser locks reduce contention only when you genuinely need the locked region to be atomic. Otherwise they reduce throughput and increase deadlock surface.
- **Replacing `sync.Mutex` with a channel "for elegance."** Channels are not faster than uncontested mutexes. A channel-protected counter is 5-10x slower than an atomic. Use channels when ownership and message-passing semantics fit, not as a cargo-cult substitute.
- **Pre-emptively making everything lock-free.** Real lock-free code is hard to write correctly and harder to maintain. Use it after you have measured.
- **Adding `time.Sleep` to "give other goroutines a chance."** This masks deadlock detection and adds latency without solving the underlying coordination bug.
- **Wrapping every Lock in a `TryLock` loop.** Spin-and-sleep loops waste CPU and rarely solve contention; they often hide it.

---

## Optimization checklist

Before optimizing locks in a Go service:

- [ ] Profile (`-mutexprofile`, `pprof`). Identify the hottest locks.
- [ ] For each hot lock, classify: shareable reads (use RWMutex), simple counter (use atomic), large read-heavy (use atomic.Value), shardable map (shard).
- [ ] For each lock with deadlock incidents: apply lock-order ranking.
- [ ] For each lock held during I/O: move the I/O outside.
- [ ] For each lock with callbacks: copy state under lock, call outside.
- [ ] Add `goleak.VerifyTestMain` to tests.
- [ ] Add `go-deadlock` build tag to CI.
- [ ] Measure throughput after each change. Don't optimize blindly.

A disciplined approach to these usually doubles or triples throughput on lock-bound workloads without introducing new deadlocks.

---

## Summary

Optimization in the deadlock context is two-sided. **Safety side**: invest in lock-order ranking, contracts, and tests so deadlocks do not happen. **Performance side**: replace mutexes with atomics or lock-free structures where the shape allows, shard hot locks, reduce locked-region duration, and hold I/O outside locks.

The most effective optimization is usually moving work *out* of the locked region — serialization, computation, I/O — leaving only the bare minimum (read or update of in-memory state) inside. This single discipline often improves both throughput and deadlock safety simultaneously, because shorter locked regions create less window for inversion and starvation.

For the hottest paths, `atomic.Value` for reads and `atomic` operations for counters give effectively zero overhead and zero deadlock risk. For the most contested paths, sharded mutexes with documented rank order are the next step. Lock-free CAS structures are the last resort, reserved for measured bottlenecks where simpler approaches have proven inadequate.

Profile first. Optimize what is hot. Verify after each change. Never optimize on intuition alone.
