# Mutexes — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [RWMutex: When It Helps and When It Hurts](#rwmutex-when-it-helps-and-when-it-hurts)
3. [Sharded Mutexes for Linear Scaling](#sharded-mutexes-for-linear-scaling)
4. [Lock-Free Alternatives](#lock-free-alternatives)
5. [Mutex Starvation and Fairness](#mutex-starvation-and-fairness)
6. [Contention Profiling in Production](#contention-profiling-in-production)
7. [Advanced Lock Ordering](#advanced-lock-ordering)
8. [Mutex Plus Condition Variable](#mutex-plus-condition-variable)
9. [Designing Lockable Types](#designing-lockable-types)
10. [Architectural Alternatives](#architectural-alternatives)
11. [Real Production Cases](#real-production-cases)
12. [Tricky Questions](#tricky-questions)
13. [Summary](#summary)

---

## Introduction

Senior-level mutex work is rarely about adding mutexes. It is about removing them, shrinking them, sharding them, or replacing them with something better. By this point you can make code correct with a mutex; the question is whether the design you've chosen is the *right* one for the throughput, latency, and fairness goals of the system.

This file covers:
- Quantitative reasoning about when `RWMutex` actually pays off.
- Sharded-lock designs and their trade-offs.
- Mutex starvation modes and how Go's runtime mitigates them.
- Reading mutex profiles in production.
- Architectural alternatives: actor goroutines, copy-on-write, snapshot-based reads.

---

## RWMutex: When It Helps and When It Hurts

### The naive model

`sync.RWMutex` allows multiple readers (`RLock`) or one writer (`Lock`) at a time. The intuition is "if you have lots of readers and few writers, RWMutex wins." This is half-true.

### The cost of a reader lock

Each `RLock` does an atomic increment of a reader counter and possibly an atomic CAS to acquire the wlock if a writer has been waiting. Compare:

```
sync.Mutex.Lock      ≈ 1 atomic op (uncontended)
sync.RWMutex.RLock   ≈ 2-3 atomic ops + check writer flag
```

Under no contention, `Mutex` is *faster* than `RWMutex`. The break-even point is when many goroutines actually overlap inside the critical section.

### Empirical rule

Benchmark your own workload. As a starting heuristic:

- If reads ≥ 5× writes **and** the read critical section is non-trivial (≥ 1µs of work), `RWMutex` is worth trying.
- If reads ≤ 2× writes, just use `Mutex`.
- If the critical section is < 100ns, `RWMutex` is almost never better — the bookkeeping eats the benefit.

### The reader-starves-writer mode

Under heavy reader pressure, a steady stream of readers can keep the writer waiting indefinitely. Go's `RWMutex` mitigates this: once a writer calls `Lock` and blocks, *new* readers also block (queued behind the writer). But existing readers are not evicted; the writer waits until they all `RUnlock`.

Symptoms in production: writer p99 latency spikes when reader rate is high. The cure is either fewer readers per write, faster reader critical sections, or a different design (snapshot-based reads, atomic.Value).

### Benchmark template

```go
func BenchmarkMap(b *testing.B) {
    m := map[string]int{}
    var mu sync.RWMutex
    keys := generateKeys(1000)

    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            k := keys[i%len(keys)]
            i++
            if i%100 == 0 { // 1% writes
                mu.Lock()
                m[k] = i
                mu.Unlock()
            } else {
                mu.RLock()
                _ = m[k]
                mu.RUnlock()
            }
        }
    })
}
```

Run with `-cpu=1,2,4,8` to see scaling:

```bash
go test -bench=BenchmarkMap -benchmem -cpu=1,2,4,8
```

If the benchmark shows linear improvement with cores, RWMutex is paying off. If not, the lock is the bottleneck even for readers.

---

## Sharded Mutexes for Linear Scaling

### Motivation

A single mutex around a map is a global bottleneck. As cores grow, throughput plateaus. Sharding splits the data so that operations on different keys hit different mutexes.

### Implementation

```go
const shardCount = 64

type ShardedMap[V any] struct {
    shards [shardCount]struct {
        mu sync.RWMutex
        m  map[string]V
    }
}

func NewShardedMap[V any]() *ShardedMap[V] {
    var s ShardedMap[V]
    for i := range s.shards {
        s.shards[i].m = make(map[string]V)
    }
    return &s
}

func (s *ShardedMap[V]) shard(k string) *struct {
    mu sync.RWMutex
    m  map[string]V
} {
    h := fnv1a(k)
    return &s.shards[h%shardCount]
}

func (s *ShardedMap[V]) Get(k string) (V, bool) {
    sh := s.shard(k)
    sh.mu.RLock()
    defer sh.mu.RUnlock()
    v, ok := sh.m[k]
    return v, ok
}

func (s *ShardedMap[V]) Set(k string, v V) {
    sh := s.shard(k)
    sh.mu.Lock()
    defer sh.mu.Unlock()
    sh.m[k] = v
}
```

### Choosing the shard count

- Power of two enables cheap mask (`h & (n-1)`).
- A common default is 32 or 64 — enough to remove contention on most workloads, not so many that memory grows.
- Higher shard counts only help if you actually have that many cores doing parallel work *and* the keys hash uniformly.

### Trade-offs

- Memory: each shard has its own map and mutex. 64 shards = 64 small maps.
- Iteration: full-map iteration must lock every shard, which kills concurrency. Avoid full-map walks in hot paths.
- Single-key operations: same speed.
- Multi-key transactions across shards require locking multiple shards in a fixed order.

### Cache-line padding

If the shards live in a single array, two shards may share a cache line, causing false sharing. Pad to 64 bytes:

```go
type paddedShard struct {
    mu sync.RWMutex
    m  map[string]V
    _  [64 - unsafe.Sizeof(sync.RWMutex{}) - unsafe.Sizeof(map[string]V{})]byte
}
```

In practice the false-sharing penalty is small for write-heavy paths and zero for read-heavy paths because cache lines are read-shared.

---

## Lock-Free Alternatives

### Atomics for single-word state

```go
// Atomic counter — no mutex
var n atomic.Int64
n.Add(1)
v := n.Load()
```

For a counter, `atomic.Int64` is 5–10× faster than a mutex-protected `int`.

### atomic.Pointer for pointer swaps

```go
type Config struct {
    timeout time.Duration
    retries int
}

var cfg atomic.Pointer[Config]

func current() *Config { return cfg.Load() }

func update(c *Config) { cfg.Store(c) }
```

Readers do a single atomic load. Writers replace the entire pointer. Old `Config` instances must be immutable — never mutate after publishing.

### atomic.Value for legacy code

`atomic.Value` is the older API. Prefer `atomic.Pointer[T]` (Go 1.19+) for new code; it is type-safe.

### Copy-on-write

For read-heavy data that changes rarely, build a new copy and swap the pointer atomically:

```go
type Cache struct {
    data atomic.Pointer[map[string]string]
    mu   sync.Mutex // serializes writers
}

func (c *Cache) Get(k string) string {
    return (*c.data.Load())[k]
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    old := *c.data.Load()
    next := make(map[string]string, len(old)+1)
    for kk, vv := range old {
        next[kk] = vv
    }
    next[k] = v
    c.data.Store(&next)
}
```

Reads are lock-free and contention-free. Writes pay O(N) copy. Worth it when reads vastly outnumber writes (config blobs, routing tables).

### sync.Map

`sync.Map` is a concurrent map specialised for two patterns:
1. Each key is written once, read many times.
2. Multiple goroutines read, write, and overwrite mostly disjoint sets of keys.

For workloads outside these patterns, `Mutex+map` or sharded maps are usually faster.

---

## Mutex Starvation and Fairness

### Go's two modes

Go's `sync.Mutex` has two modes (since 1.9):

- **Normal mode:** A waiting goroutine may be beaten to the lock by a "barging" goroutine that just arrived and finds the mutex briefly free. Throughput-optimised; the running CPU keeps running. Risks starvation: a slow waiter may keep losing.
- **Starvation mode:** Triggered when a waiter has been waiting > 1ms. The mutex is handed directly to the front-of-queue waiter; new arrivals queue behind. Latency-optimised; eliminates starvation.

The runtime switches between modes automatically. You don't choose. The two-line mental model:

```
Normal mode    → high throughput, possible long-tail latency
Starvation     → bounded latency, slightly lower throughput
```

### Symptoms of starvation

- p99 latency much higher than mean (one goroutine is held back).
- A goroutine that "sometimes" hangs for hundreds of milliseconds in `Lock`.
- `runtime/trace` showing one goroutine repeatedly blocked while others run.

### Diagnosing

`go tool trace` shows individual goroutine blocked-on-mutex events:

```bash
curl http://localhost:6060/debug/pprof/trace?seconds=5 > trace.out
go tool trace trace.out
```

The "Goroutine analysis" page lists each goroutine's blocking history.

### Mitigations

If starvation is a real problem:

1. Reduce critical-section length so the lock is rarely held.
2. Shard the lock so contention drops below the trigger.
3. Replace with a fair queue (channel-based) where order matters.

Don't try to "force" starvation mode. The runtime's heuristic is good; if you're hitting starvation, the design is the problem.

---

## Contention Profiling in Production

### Enabling

```go
import _ "net/http/pprof"

func main() {
    runtime.SetMutexProfileFraction(100) // sample 1 in 100 contention events
    runtime.SetBlockProfileFraction(100)
    go http.ListenAndServe(":6060", nil)
    ...
}
```

### Collecting

```bash
curl 'http://localhost:6060/debug/pprof/mutex?seconds=30' > mu.prof
go tool pprof mu.prof
```

In pprof:

```
(pprof) top
(pprof) list YourFunc
(pprof) web
```

### Interpreting

The mutex profile reports *contention delay* — total time goroutines spent waiting for each lock. Hot lines are call sites where many goroutines were blocked.

The block profile is broader (any blocking op including channels). Mutex profile is more focused.

### Continuous profiling in production

Tools like Pyroscope, Parca, and Datadog Continuous Profiler attach to live services and stream pprof samples. For mutex hotspots, this is invaluable: you see the bottleneck shift between request types or hours of day.

### Worked example

Imagine you see this:

```
(pprof) top
   8.3s 41.5%   runtime.semacquire
   3.1s 15.5%   sync.(*Mutex).Lock (api.handleRequest)
   1.8s  9.0%   sync.(*RWMutex).RLock (cache.Get)
```

Translation: 41% of CPU is paying for mutex contention; the biggest contributor is one mutex inside `api.handleRequest`. Look at that critical section first. Common findings:

- A debug log call holding the lock.
- A cache invalidation that lock-acquires per call when it could batch.
- An expensive serialization happening under the lock.

---

## Advanced Lock Ordering

### Hierarchical locking

Many systems have natural hierarchies: workspace → project → file → line. Define lock ordering top-down:

```
Workspace.mu
  Project.mu
    File.mu
```

A goroutine that needs `File.mu` must already hold (or have released) the higher-level locks.

### Ranked locks

For dynamic structures, assign each lock a rank. A goroutine holding a rank-K lock may only acquire rank > K. The runtime won't enforce this; static analysis or runtime debug helpers can.

```go
type RankedMutex struct {
    sync.Mutex
    Rank int
}

// In debug builds, check that current ranks are increasing
```

### Try-then-fall-back

Sometimes you need two locks and the order isn't naturally fixed:

```go
// A wants a then b. B wants b then a. Avoid deadlock with TryLock + back-off:
for {
    a.mu.Lock()
    if b.mu.TryLock() {
        defer a.mu.Unlock()
        defer b.mu.Unlock()
        break
    }
    a.mu.Unlock()
    runtime.Gosched()
}
```

This works but is rare in practice. A consistent global order is almost always cleaner.

### Lock leveling tools

`golang.org/x/exp/locks` (proposal-stage) experiments with leveled locks. In production, code review and convention remain the standard tools.

---

## Mutex Plus Condition Variable

`sync.Cond` is a condition variable, used when goroutines must wait for a state change protected by a mutex.

```go
type Queue struct {
    mu      sync.Mutex
    cond    *sync.Cond
    items   []Item
    closed  bool
}

func New() *Queue {
    q := &Queue{}
    q.cond = sync.NewCond(&q.mu)
    return q
}

func (q *Queue) Push(it Item) {
    q.mu.Lock()
    defer q.mu.Unlock()
    if q.closed {
        return
    }
    q.items = append(q.items, it)
    q.cond.Signal()
}

func (q *Queue) Pop() (Item, bool) {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == 0 && !q.closed {
        q.cond.Wait() // releases mu, blocks, reacquires on wake
    }
    if len(q.items) == 0 {
        return Item{}, false
    }
    it := q.items[0]
    q.items = q.items[1:]
    return it, true
}

func (q *Queue) Close() {
    q.mu.Lock()
    defer q.mu.Unlock()
    q.closed = true
    q.cond.Broadcast()
}
```

Key rules:
- `cond.Wait()` must be called inside a `for` loop checking the condition; spurious wakeups happen.
- `cond.Wait()` requires the mutex to be held; it releases and reacquires.
- `Signal()` wakes one waiter; `Broadcast()` wakes all.

In practice, channels often replace `sync.Cond` in idiomatic Go. Prefer channels unless you genuinely need a "wake all waiters of a complex predicate" pattern, which is `Broadcast`'s sweet spot.

---

## Designing Lockable Types

### API guidelines

- **Don't expose the mutex.** Don't make the mutex field public; don't return `*sync.Mutex` from any function. Doing so leaks the synchronisation contract.
- **Provide synchronised methods.** All public methods that touch protected fields take the lock internally.
- **Don't mix sync and async.** A method should either always lock or always not lock; don't have an "Unsafe" variant unless its purpose is clearly documented and use-restricted.
- **Document invariants.** "fields `head` and `tail` are protected by `mu`" — comment.

### Example: a well-designed lockable type

```go
// Cache is a goroutine-safe LRU cache.
//
// Concurrency:
//   - All exported methods are safe for concurrent use.
//   - mu protects entries and order.
//   - The cache may be copied only before any method is called on it.
type Cache struct {
    mu      sync.Mutex
    entries map[string]*entry
    order   *list.List
    cap     int
}

func New(cap int) *Cache {
    return &Cache{
        entries: make(map[string]*entry),
        order:   list.New(),
        cap:     cap,
    }
}

func (c *Cache) Get(k string) (string, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    e, ok := c.entries[k]
    if !ok {
        return "", false
    }
    c.order.MoveToFront(e.elem)
    return e.value, true
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if e, ok := c.entries[k]; ok {
        e.value = v
        c.order.MoveToFront(e.elem)
        return
    }
    e := &entry{value: v}
    e.elem = c.order.PushFront(k)
    c.entries[k] = e
    if c.order.Len() > c.cap {
        oldest := c.order.Back()
        delete(c.entries, oldest.Value.(string))
        c.order.Remove(oldest)
    }
}
```

Notice:
- All public methods take the lock internally.
- Pointer receivers throughout.
- Doc comment notes concurrency contract.
- No exported field that requires synchronisation.

---

## Architectural Alternatives

### Actor (single-owner) goroutine

Instead of locking shared state, give one goroutine sole ownership and let others communicate via channel:

```go
type Cache struct {
    requests chan request
}

type request struct {
    op    string
    key   string
    value string
    reply chan reply
}

type reply struct {
    value string
    ok    bool
}

func New() *Cache {
    c := &Cache{requests: make(chan request)}
    go c.run()
    return c
}

func (c *Cache) run() {
    m := make(map[string]string)
    for r := range c.requests {
        switch r.op {
        case "get":
            v, ok := m[r.key]
            r.reply <- reply{value: v, ok: ok}
        case "set":
            m[r.key] = r.value
            r.reply <- reply{}
        }
    }
}

func (c *Cache) Get(k string) (string, bool) {
    rep := make(chan reply, 1)
    c.requests <- request{op: "get", key: k, reply: rep}
    r := <-rep
    return r.value, r.ok
}
```

Pros: zero locking; ownership is clear.
Cons: single-threaded throughput on the actor; channels have their own overhead; backpressure must be designed.

### Read-snapshot / write-publish

Keep state immutable. Writers build a new version and publish via `atomic.Pointer[State]`. Readers load the current pointer and read freely.

Pros: lock-free reads.
Cons: write-heavy or large-state workloads pay copy cost.

### Per-shard goroutine

Combine sharding with the actor pattern: each shard is owned by one goroutine that reads its work from a channel. Used inside Kubernetes' informer caches and many real-time databases.

---

## Real Production Cases

### Case 1 — Hot lock around a metrics struct

A service was emitting Prometheus metrics by locking a single `Metrics` struct on every HTTP request. Mutex profile showed the metrics lock held for 35% of total time. Fix: replace the counter fields with `atomic.Int64`. p99 latency dropped from 18ms to 4ms; CPU usage dropped 22%.

### Case 2 — Routing table updated on every request

A service refreshed a routing table (3000 entries) on every cache miss. The refresh held a `sync.Mutex`; under load this became the system bottleneck. Fix: convert routing table to copy-on-write with `atomic.Pointer[Table]`. Refresh now happens in a background goroutine; reads are lock-free. Throughput tripled.

### Case 3 — Shopping cart deadlock during transfer

The cart-transfer code acquired locks `from.mu` then `to.mu`. Two concurrent transfers between the same two carts in opposite directions deadlocked rarely (~1 incident/week). Fix: order locks by cart ID. Deadlocks went to zero.

### Case 4 — RWMutex starvation under read storm

A configuration service used `sync.RWMutex` for reads. During config reload, the writer waited up to 8 seconds because reader rate stayed steady. Fix: replace with `atomic.Pointer[Config]`. Reads became lock-free; writer publishes new pointer instantly.

---

## Tricky Questions

**Q: Why does Go provide `sync.Mutex` instead of letting users build it on top of channels?**

A: Mutexes are 10–50× faster than channels for the same purpose because they don't pay the cost of context switches and goroutine scheduling. They are also conceptually simpler for "protect these few fields."

**Q: What is the cost of an uncontended Lock/Unlock?**

A: Roughly 25 ns on modern x86-64. Contended cases can cost microseconds or more, depending on whether the goroutine parks (sleeps) versus spins.

**Q: Does Go's mutex spin?**

A: Yes, briefly. Before parking, the runtime spins for a short interval if it's likely the holder will release soon. The exact heuristic is in `runtime/lock_futex.go` / `runtime/sema.go`.

**Q: Can I use a pointer to a `sync.Mutex` field as a unique identifier?**

A: You can take its address, but never copy it. The address is unique while the struct lives.

**Q: What does `sync.Mutex.Unlock` do under the hood when a waiter exists?**

A: Atomic CAS to clear the locked bit, then `runtime.semrelease` if a waiter is parked. The runtime wakes the waiter, who reattempts the CAS.

**Q: Are nested RWMutexes a problem?**

A: They can be. If goroutine A holds a write lock on `X` and tries to RLock `Y`, while goroutine B holds a read lock on `Y` and tries to write-lock `X`, you have a deadlock. Treat all locks (read or write) as ordered.

**Q: Why doesn't Go expose the mutex's internal queue?**

A: It would lock the runtime to a specific implementation. The Go team explicitly preserves the right to change the algorithm.

---

## Summary

Senior-level mutex design is about *minimising the role of the mutex*. The best mutex is the one you don't need: atomics for counters, copy-on-write for read-heavy state, sharding for parallel workloads, single-owner goroutines for serialised access. When you do use a mutex, choose the smallest scope, the right type (Mutex vs RWMutex vs sharded), and document the locking contract explicitly. Profile in production with `runtime.SetMutexProfileFraction`. Watch for starvation in long-tail latency. The professional file goes one layer deeper, to the runtime and OS primitives that make all of this work.
