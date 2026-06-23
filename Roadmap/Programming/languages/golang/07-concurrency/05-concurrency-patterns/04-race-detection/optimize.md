# Race Detection — Optimization

> Honest framing first: a "race-free" program is the baseline, not the target. Once your code passes `-race`, the question becomes *how cheaply* you achieve correctness — locking primitives differ in throughput by orders of magnitude under contention.
>
> This file covers ten optimisation patterns that turn a correct-but-slow concurrent design into a correct-and-fast one. Each entry follows: **Problem / Before / After / Gain / Caveat**. All examples remain race-free under `-race`.

---

## Optimization 1 — Replace mutex with atomic for single counters

**Problem:** A single counter under `sync.Mutex` is correct but pays the cost of mutex Lock/Unlock on every increment — typically 25-40ns on uncontended fast paths and far more under contention. Atomics on a single integer are 4-10x cheaper.

**Before:**

```go
type Counter struct {
    mu sync.Mutex
    n  int64
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}

func (c *Counter) Value() int64 {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.n
}
```

Benchmark on 8 cores at 64 goroutines: ~120ns/op.

**After:**

```go
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc()        { c.n.Add(1) }
func (c *Counter) Value() int64 { return c.n.Load() }
```

Same benchmark: ~12ns/op. 10x improvement, no behaviour change.

**Gain:** 5-10x throughput on hot counters; smaller critical section means less contention.

**Caveat:** Atomics work for single-cell operations only. The moment the counter is one of several invariant-linked fields ("Total *and* OK both increment"), you need a mutex (or per-field atomics carefully reasoned about).

---

## Optimization 2 — Sharded counter for high contention

**Problem:** Even a single `atomic.Int64` becomes a bottleneck when 32+ cores hammer it. The cache line containing the atomic bounces between cores, degrading throughput non-linearly.

**Before:**

```go
type Counter struct{ n atomic.Int64 }

func (c *Counter) Inc() { c.n.Add(1) }
```

At 64 goroutines: ~60ns/op (the cache line ping-pong dominates).

**After:**

```go
const cacheLine = 64

type shard struct {
    v atomic.Int64
    _ [cacheLine - 8]byte // pad to one cache line
}

type Sharded struct {
    shards []shard
}

func New() *Sharded {
    return &Sharded{shards: make([]shard, runtime.GOMAXPROCS(0))}
}

func (s *Sharded) Inc(id int) {
    s.shards[id%len(s.shards)].v.Add(1)
}

func (s *Sharded) Sum() int64 {
    var t int64
    for i := range s.shards {
        t += s.shards[i].v.Load()
    }
    return t
}
```

At 64 goroutines: ~5ns/op. Near-linear scaling.

**Gain:** 10x or more throughput on hot counters under heavy contention. Sum is O(N) but called rarely (for metrics export, etc.).

**Caveat:** Sum is *not* a snapshot — shards are read sequentially; concurrent Inc calls during Sum produce a slightly stale total. This is fine for metrics; not fine if you need exact transactional consistency.

---

## Optimization 3 — Lock-free SPSC queue (Single Producer, Single Consumer)

**Problem:** A general-purpose queue with `sync.Mutex` works, but for the common case of *one* writer goroutine and *one* reader, you can use a ring buffer with two atomic indices and zero locks.

**Before:**

```go
type Queue struct {
    mu sync.Mutex
    q  []int
}

func (q *Queue) Push(v int) {
    q.mu.Lock()
    q.q = append(q.q, v)
    q.mu.Unlock()
}

func (q *Queue) Pop() (int, bool) {
    q.mu.Lock()
    defer q.mu.Unlock()
    if len(q.q) == 0 {
        return 0, false
    }
    v := q.q[0]
    q.q = q.q[1:]
    return v, true
}
```

**After (SPSC ring):**

```go
type SPSC struct {
    buf  []int
    head atomic.Uint64 // producer-only writes; both read
    tail atomic.Uint64 // consumer-only writes; both read
}

func NewSPSC(size int) *SPSC {
    return &SPSC{buf: make([]int, size)}
}

func (q *SPSC) Push(v int) bool {
    h := q.head.Load()
    t := q.tail.Load()
    if h-t == uint64(len(q.buf)) {
        return false // full
    }
    q.buf[h%uint64(len(q.buf))] = v
    q.head.Store(h + 1)
    return true
}

func (q *SPSC) Pop() (int, bool) {
    h := q.head.Load()
    t := q.tail.Load()
    if h == t {
        return 0, false
    }
    v := q.buf[t%uint64(len(q.buf))]
    q.tail.Store(t + 1)
    return v, true
}
```

**Gain:** Throughput several times higher than mutex; zero contention because each index has exactly one writer.

**Caveat:** Strictly single-producer / single-consumer. With more goroutines on either side, the protocol breaks (lost updates). For MPMC, use a `chan` (which is itself a well-tuned MPMC ring) or a more complex lock-free queue (Michael-Scott, etc.). Also: `-race` happily verifies this design — both indices are atomics, so happens-before holds.

---

## Optimization 4 — `sync.Map` vs `map + RWMutex`

**Problem:** A `map + sync.RWMutex` works for everything but suffers under heavy read contention because `RLock`/`RUnlock` still cause atomic increments on the rwmutex's reader-count word — every read goroutine bounces that line.

**Before:**

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]string
}

func (c *Cache) Get(k string) (string, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    v, ok := c.m[k]
    return v, ok
}
```

**After (`sync.Map`, only for the right workload):**

```go
type Cache struct {
    m sync.Map
}

func (c *Cache) Get(k string) (string, bool) {
    v, ok := c.m.Load(k)
    if !ok {
        return "", false
    }
    return v.(string), true
}
```

**Gain:** On workloads of mostly-write-once / mostly-read keys, `sync.Map` reads are nearly lock-free (atomic-pointer load on the read map). Benchmarks show 2-5x improvement on read-dominated workloads with thousands of keys.

**Caveat:** `sync.Map` *loses* on workloads with frequent overwrites of the same key, small key sets, or mixed read/write — it has more complex internals (read map + dirty map + missed counter). Always benchmark before switching. The API is also weaker (no `len`, type assertions everywhere).

---

## Optimization 5 — Batch updates to amortise locking

**Problem:** A goroutine that takes a mutex per-item to update a shared data structure pays the lock cost N times. If items can be batched, one Lock can cover M items.

**Before:**

```go
func processOne(item int) {
    mu.Lock()
    state[item] = compute(item)
    mu.Unlock()
}

for _, item := range items {
    go processOne(item) // one Lock per item
}
```

**After:**

```go
func processBatch(items []int) {
    results := make(map[int]int, len(items))
    for _, item := range items {
        results[item] = compute(item) // outside lock
    }
    mu.Lock()
    for k, v := range results {
        state[k] = v
    }
    mu.Unlock()
}

const batchSize = 64
for i := 0; i < len(items); i += batchSize {
    end := i + batchSize
    if end > len(items) {
        end = len(items)
    }
    go processBatch(items[i:end])
}
```

**Gain:** Lock acquisition cost amortised over many items; throughput improves several-fold under contention.

**Caveat:** Latency per item rises (an item is not visible until its batch completes the merge). Trade-off: throughput vs. freshness. If readers expect real-time visibility, batching may not be acceptable.

---

## Optimization 6 — Single-writer pattern (pin to one goroutine)

**Problem:** A shared data structure with many writers needs a mutex on every write, throttling throughput. If the design allows, route all writes to a single goroutine; readers consult an atomically-published snapshot.

**Before:**

```go
type Map struct {
    mu sync.RWMutex
    m  map[string]string
}

func (m *Map) Set(k, v string) {
    m.mu.Lock()
    m.m[k] = v
    m.mu.Unlock()
}
```

**After:**

```go
type Map struct {
    snap atomic.Pointer[map[string]string]
    ops  chan op
}

type op struct {
    k, v string
    done chan struct{}
}

func (m *Map) writer() {
    for o := range m.ops {
        cur := *m.snap.Load()
        next := make(map[string]string, len(cur)+1)
        for k, v := range cur {
            next[k] = v
        }
        next[o.k] = o.v
        m.snap.Store(&next)
        close(o.done)
    }
}

func (m *Map) Set(k, v string) {
    done := make(chan struct{})
    m.ops <- op{k: k, v: v, done: done}
    <-done
}

func (m *Map) Get(k string) (string, bool) {
    v, ok := (*m.snap.Load())[k]
    return v, ok
}
```

**Gain:** Reads are lock-free (atomic load + map read). Writers serialise through the channel — fine if writes are rare compared to reads.

**Caveat:** Each write copies the whole map (O(N) work). Use this pattern only when reads vastly outnumber writes (e.g., feature flags, configs, routing tables). For balanced read/write workloads, stick with `map + RWMutex`.

---

## Optimization 7 — `atomic.Pointer` for copy-on-write configuration

**Problem:** A configuration struct read on every request and reloaded periodically. Reading under `RWMutex.RLock` is correct but adds a few hundred nanoseconds per read.

**Before:**

```go
type ConfigStore struct {
    mu  sync.RWMutex
    cfg *Config
}

func (s *ConfigStore) Load() *Config {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.cfg
}

func (s *ConfigStore) Store(c *Config) {
    s.mu.Lock()
    s.cfg = c
    s.mu.Unlock()
}
```

**After:**

```go
type ConfigStore struct {
    cfg atomic.Pointer[Config]
}

func (s *ConfigStore) Load() *Config  { return s.cfg.Load() }
func (s *ConfigStore) Store(c *Config) { s.cfg.Store(c) }
```

Per-Load cost drops from ~100ns to ~2ns.

**Gain:** Lock-free reads at near-CPU cost. Reload cost is a single atomic store. Scales linearly with cores.

**Caveat:** The pointed-to `Config` *must be immutable* after Store. If a writer mutates a Config that readers may already hold, that is a data race. Document the immutability invariant near the type.

---

## Optimization 8 — `sync.Once` instead of mutex for one-time init

**Problem:** A lazy-initialised resource is guarded by a mutex on every access — even after init has completed. The mutex is pure overhead post-init.

**Before:**

```go
type DB struct {
    mu     sync.Mutex
    inited bool
    conn   *sql.DB
}

func (d *DB) Get() *sql.DB {
    d.mu.Lock()
    defer d.mu.Unlock()
    if !d.inited {
        d.conn = openDB()
        d.inited = true
    }
    return d.conn
}
```

Every call locks even though after the first call, no shared mutation happens. Throughput is limited by the mutex.

**After:**

```go
type DB struct {
    once sync.Once
    conn *sql.DB
}

func (d *DB) Get() *sql.DB {
    d.once.Do(func() { d.conn = openDB() })
    return d.conn
}
```

After the first call, `Once.Do`'s fast path is a single atomic load — no mutex contention.

**Gain:** Post-init throughput improves ~10x; access becomes effectively free.

**Caveat:** `Once.Do` runs `f` exactly once. If init can fail, switch to `sync.OnceValues` (Go 1.21+) or build a custom retry primitive. Also: do not call `Once.Do` recursively — it deadlocks.

---

## Optimization 9 — Reduce critical section size

**Problem:** A handler holds the mutex for the entire request, including network I/O and computation. The critical section blocks all other writers/readers for the full request duration.

**Before:**

```go
type Server struct {
    mu sync.Mutex
    items map[string]int
}

func (s *Server) Handle(req string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    data := fetchFromExternal(req)        // 50ms network I/O under lock!
    parsed := parse(data)                 // CPU work under lock
    s.items[req] = parsed                 // actual shared write
}
```

Throughput is bottlenecked by `fetchFromExternal` and `parse` running serialised.

**After:**

```go
func (s *Server) Handle(req string) {
    data := fetchFromExternal(req) // outside lock
    parsed := parse(data)          // outside lock
    s.mu.Lock()
    s.items[req] = parsed          // only this needs the lock
    s.mu.Unlock()
}
```

The lock now protects only the map write, which takes microseconds.

**Gain:** Throughput rises to the limit of the underlying resource (network), not the mutex.

**Caveat:** Be careful that the work outside the lock does not depend on the locked state. If `parse` needs a snapshot of `items`, take a defensive copy under the lock first, then release.

---

## Optimization 10 — Immutable snapshots for repeated reads

**Problem:** A function reads several fields of a shared struct multiple times in its body, taking the mutex each time. Even with `RWMutex`, repeated `RLock`/`RUnlock` cycles cost nanoseconds each and break optimisation.

**Before:**

```go
type Stats struct {
    mu    sync.RWMutex
    Total int
    OK    int
    Fails int
}

func (s *Stats) Report() string {
    s.mu.RLock()
    total := s.Total
    s.mu.RUnlock()

    s.mu.RLock()
    ok := s.OK
    s.mu.RUnlock()

    s.mu.RLock()
    fails := s.Fails
    s.mu.RUnlock()

    return fmt.Sprintf("total=%d ok=%d fails=%d ratio=%.2f", total, ok, fails, float64(ok)/float64(total))
}
```

Three Lock cycles for one report; also produces an inconsistent snapshot (each field read at a different time).

**After:**

```go
func (s *Stats) snapshot() (total, ok, fails int) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.Total, s.OK, s.Fails
}

func (s *Stats) Report() string {
    total, ok, fails := s.snapshot()
    return fmt.Sprintf("total=%d ok=%d fails=%d ratio=%.2f", total, ok, fails, float64(ok)/float64(total))
}
```

One Lock cycle; consistent snapshot; easier to reason about.

**Gain:** Lower lock overhead, consistent reads, simpler call site.

**Caveat:** Returning *pointers* or *slices* from a snapshot is not enough — the returned reference may still be mutated by the holder of the lock. For mutable types, return defensive copies. For atomic-published immutable structs (Optimization 7), this is automatic.

---

## Bonus — `sync.Mutex` vs `sync.RWMutex`: do not assume RW wins

**Problem:** `sync.RWMutex` is often introduced "because reads are cheap". In practice, RWMutex is *slower* than Mutex for short critical sections — RWMutex's internal bookkeeping (reader count, writer-waiting flag) is two atomics per RLock/RUnlock pair, vs one for Mutex Lock/Unlock.

**Before:**

```go
var mu sync.RWMutex
mu.RLock()
v := m[k] // 5ns of work
mu.RUnlock()
```

For a tiny critical section, RWMutex costs ~50ns/op.

**After:**

```go
var mu sync.Mutex
mu.Lock()
v := m[k]
mu.Unlock()
```

Same workload: ~25ns/op.

**Gain:** Plain Mutex is faster for short critical sections. Use RWMutex only when (a) reads dominate by 10x or more, and (b) the critical section is large enough that the extra atomic dance is amortised.

**Caveat:** Always benchmark. The folklore "RWMutex is for reads" is only correct for *long* read-heavy critical sections. For short ones, plain Mutex wins.

---

## Performance Cheat Sheet

| Pattern | Best For | Throughput Class |
|---------|----------|------------------|
| `atomic.Int64` | Single counter | very high |
| Sharded counter | Heavy write contention | very high (linear in cores) |
| `atomic.Pointer[T]` (COW) | Read-heavy config | very high |
| `sync.Once` | One-time init | very high (post-init) |
| `sync.Mutex` | Multi-field updates, short crits | high |
| `sync.RWMutex` | Long read-dominated crits | medium |
| `sync.Map` | Mostly write-once keys | medium-high |
| `chan`-based MPMC | Producer/consumer pipelines | high |
| Single-writer + COW snapshot | Read-only config | very high |

---

## Methodology Reminder

Optimisation without measurement is folklore. Every change in this file should be:

1. Benchmarked against the original (`go test -bench=. -benchmem`).
2. Verified race-free (`go test -race`).
3. Verified correct (functional tests pass).

A 10x faster *racy* version is not faster — it is broken. Always run `-race` on every "optimised" candidate.
