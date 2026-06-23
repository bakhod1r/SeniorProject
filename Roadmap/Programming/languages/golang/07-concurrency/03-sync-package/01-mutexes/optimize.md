# Mutexes — Optimization

> A mutex protects shared memory by serialising access to it. Serialisation is, by definition, the opposite of parallelism. Every nanosecond a goroutine spends waiting on a mutex is a nanosecond your program is *not* using its other cores. The first three rules of optimising mutex code are: keep critical sections short, hold them rarely, and — when you can — eliminate them entirely.
>
> Each entry below names a contention pattern, shows the slow code, explains *why* it is slow, and shows an optimised version with realistic perf intuition. None of these are micro-optimisations: every one of them has flipped a real production service from "doesn't scale past two cores" to "linear up to thirty-two cores."

---

## Optimization 1 — Replace mutex with atomic for a simple counter

**Problem:** A counter incremented from many goroutines, guarded by a mutex. Each `Inc` traps the entire counter for a single integer add.

**Slow:**
```go
type Stats struct {
    mu sync.Mutex
    n  int64
}

func (s *Stats) Inc()        { s.mu.Lock(); s.n++; s.mu.Unlock() }
func (s *Stats) Load() int64 { s.mu.Lock(); defer s.mu.Unlock(); return s.n }
```

**Bottleneck:** `Lock`/`Unlock` for a one-instruction operation is a 30–50 ns round trip, plus contention queueing under load. With 32 goroutines hammering it, throughput is far below what a single CPU could do alone.

**Optimised:**
```go
import "sync/atomic"

type Stats struct {
    n atomic.Int64
}

func (s *Stats) Inc()        { s.n.Add(1) }
func (s *Stats) Load() int64 { return s.n.Load() }
```

**Gain:** Each operation drops to ~1–5 ns and scales near-linearly with cores. For a metric counter incremented millions of times per second, this single change can return 5–20% of total CPU.

**Caveat:** atomics work only when the protected state is a single primitive (or a small struct via `atomic.Pointer`). The moment two fields must be updated together, you need a mutex (or `atomic.Value` with publish-replace semantics).

---

## Optimization 2 — Use `RWMutex` when reads dominate writes

**Problem:** A read-heavy data structure (e.g., a 99%-read, 1%-write configuration cache) protected by `sync.Mutex`. Every read serialises with every other read, even though concurrent reads of immutable memory are perfectly safe.

**Slow:**
```go
type Config struct {
    mu sync.Mutex
    m  map[string]string
}

func (c *Config) Get(k string) string {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.m[k]
}
```

**Bottleneck:** Two readers running on different cores cannot proceed in parallel. With 100k reads/sec, lock acquisition becomes the bottleneck even though the work itself is trivial.

**Optimised:**
```go
type Config struct {
    mu sync.RWMutex
    m  map[string]string
}

func (c *Config) Get(k string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.m[k]
}

func (c *Config) Set(k, v string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.m[k] = v
}
```

**Gain:** Reads now run in parallel. For a 99%-read workload, throughput typically 3–5x on multi-core, much higher under sustained load.

**Caveat:** `RWMutex` is heavier than `Mutex` per acquisition. If the critical section is a few nanoseconds long, the overhead can *outweigh* the parallelism benefit. Benchmark before committing. As a rough rule: if the read holds the lock for less than ~200 ns, plain `Mutex` is often faster.

---

## Optimization 3 — Sharded mutexes (split lock by key hash)

**Problem:** A single mutex on a large concurrent map. Every operation contends, regardless of which key is touched. With dozens of cores, a single lock becomes a bottleneck no amount of optimisation inside the critical section can fix.

**Slow:**
```go
type Cache struct {
    mu sync.Mutex
    m  map[string][]byte
}

func (c *Cache) Get(k string) []byte { c.mu.Lock(); defer c.mu.Unlock(); return c.m[k] }
func (c *Cache) Set(k string, v []byte) { c.mu.Lock(); defer c.mu.Unlock(); c.m[k] = v }
```

**Bottleneck:** A worker updating key `"a"` blocks a worker reading key `"z"`. The lock serialises operations that share nothing.

**Optimised:**
```go
const shards = 32

type shard struct {
    mu sync.RWMutex
    m  map[string][]byte
}

type Cache struct {
    s [shards]shard
}

func New() *Cache {
    var c Cache
    for i := range c.s {
        c.s[i].m = make(map[string][]byte)
    }
    return &c
}

func (c *Cache) shardFor(k string) *shard {
    h := fnv.New32a()
    h.Write([]byte(k))
    return &c.s[h.Sum32()%shards]
}

func (c *Cache) Get(k string) []byte {
    sh := c.shardFor(k)
    sh.mu.RLock(); defer sh.mu.RUnlock()
    return sh.m[k]
}

func (c *Cache) Set(k string, v []byte) {
    sh := c.shardFor(k)
    sh.mu.Lock(); defer sh.mu.Unlock()
    sh.m[k] = v
}
```

**Gain:** Contention is divided by `shards`. With 32 shards on a 32-core machine, the cache scales nearly linearly with cores under uniform key access. Real-world: 5–20x throughput improvement for hot caches.

**Caveat:** Shard count must be a power of two (or any constant) chosen with profiling. Too few = still contended; too many = wasted memory and cache-line ping-pong. 16 or 32 is a good default for general workloads.

---

## Optimization 4 — Reduce critical section size

**Problem:** Code that does too much work while holding the lock. The classic offender is computing values inside the critical section that could be computed outside.

**Slow:**
```go
func (s *Server) record(req *Request) {
    s.mu.Lock()
    defer s.mu.Unlock()
    payload := json.Marshal(req)            // expensive, no shared state
    hash := sha256.Sum256(payload)
    s.history[req.ID] = hash[:]
}
```

**Bottleneck:** Every concurrent request waits for `Marshal` and `Sha256`, which depend only on `req` (locally owned).

**Optimised:**
```go
func (s *Server) record(req *Request) {
    payload := json.Marshal(req)            // outside the lock
    hash := sha256.Sum256(payload)

    s.mu.Lock()
    defer s.mu.Unlock()
    s.history[req.ID] = hash[:]
}
```

**Gain:** The critical section shrinks from ~10 µs to ~50 ns. Throughput under contention can rise 50–100x because the lock is now held for the *necessary* time only.

**Rule of thumb:** if a line inside `Lock`/`Unlock` does not read or mutate the protected state, move it out. The smaller the critical section, the closer your program runs to its parallel ceiling.

---

## Optimization 5 — `map + mutex` → `sync.Map` for read-heavy keys

**Problem:** A map keyed by long-lived identifiers, mostly read, occasionally written, with a frequent "read or insert if missing" pattern. A regular `map + sync.RWMutex` is fine, but `sync.Map` is purpose-built for this access shape.

**Slow:**
```go
type Sessions struct {
    mu sync.RWMutex
    m  map[string]*Session
}

func (s *Sessions) Get(id string) (*Session, bool) {
    s.mu.RLock(); defer s.mu.RUnlock()
    v, ok := s.m[id]
    return v, ok
}

func (s *Sessions) Set(id string, v *Session) {
    s.mu.Lock(); defer s.mu.Unlock()
    s.m[id] = v
}
```

**Bottleneck:** Every read takes a read lock — fast in absolute terms, but with millions of reads/second the atomic operations on the rwmutex internal state become the limit.

**Optimised:**
```go
type Sessions struct {
    m sync.Map // key string, value *Session
}

func (s *Sessions) Get(id string) (*Session, bool) {
    v, ok := s.m.Load(id)
    if !ok {
        return nil, false
    }
    return v.(*Session), true
}

func (s *Sessions) Set(id string, v *Session) { s.m.Store(id, v) }
```

**Gain:** `sync.Map` keeps a separate read-mostly snapshot that requires no lock for hits in the common case. For workloads where the same keys are read many times after being written once, expect 2–10x improvement on read paths.

**Caveat:** `sync.Map` is *not* a general-purpose map. It loses badly to `map + Mutex` for write-heavy or churning-key workloads. The official guidance is "use it only for the cases listed in the docs": insert-once / read-many, or where each key is touched by only one goroutine. Profile before adopting.

---

## Optimization 6 — `sync.Pool` to amortise allocations under lock

**Problem:** A handler allocates a temporary buffer on every call, each allocation triggering GC pressure that increases tail latency. The allocation isn't *inside* a mutex, but it inflates the time goroutines spend in critical sections that follow.

**Slow:**
```go
func (s *Server) handle(req *Request) []byte {
    buf := make([]byte, 0, 4096) // fresh buffer each call
    buf = encode(buf, req)
    return buf
}
```

**Bottleneck:** Millions of short-lived 4 KB buffers thrash the allocator. GC runs more often, every goroutine pauses, and any code holding a mutex during a GC pause holds it longer.

**Optimised:**
```go
var bufPool = sync.Pool{
    New: func() any { b := make([]byte, 0, 4096); return &b },
}

func (s *Server) handle(req *Request) []byte {
    bp := bufPool.Get().(*[]byte)
    buf := (*bp)[:0]
    defer func() { *bp = buf[:0]; bufPool.Put(bp) }()

    buf = encode(buf, req)
    out := append([]byte(nil), buf...) // copy out before returning
    return out
}
```

**Gain:** Allocation count drops by orders of magnitude. GC pause-time drops; tail latency improves; mutex hold-times under GC pressure stabilise. For high-QPS services, p99 latency improvements of 30–60% are typical.

**Caveat:** `sync.Pool` items can be discarded between GC cycles, so never assume your buffer "is still there." Always reset state on `Get` and never store pool entries past the function call.

---

## Optimization 7 — Lock-free read-mostly snapshot with `atomic.Value`

**Problem:** A configuration object replaced wholesale at intervals (every minute, every reload). Reads happen millions of times per second; writes happen rarely. The read path is in everyone's hot loop.

**Slow:**
```go
type Service struct {
    mu  sync.RWMutex
    cfg *Config
}

func (s *Service) Cfg() *Config {
    s.mu.RLock(); defer s.mu.RUnlock()
    return s.cfg
}
```

**Bottleneck:** `RLock`/`RUnlock` is cheap but not free. At a few million reads/sec across cores, the atomic operations inside `RWMutex` show up in profiles.

**Optimised:**
```go
import "sync/atomic"

type Service struct {
    cfg atomic.Pointer[Config] // or atomic.Value for pre-1.19 codebases
}

func (s *Service) Cfg() *Config       { return s.cfg.Load() }
func (s *Service) Reload(c *Config)   { s.cfg.Store(c) }
```

**Gain:** Read path reduces to a single atomic load — typically <1 ns and lock-free. The write path is unchanged in cost. Real services have seen 2–4x improvement on the read path with no behavioural change.

**Caveat:** `atomic.Pointer` only works for "publish a whole new value" semantics. You cannot mutate the pointed-to `*Config` after publication; readers may have stale snapshots, which is exactly why this is so fast.

---

## Optimization 8 — Channel-based serialisation in place of a mutex

**Problem:** A struct with one or two fields whose updates must be serialised, where the work being protected is itself best expressed as a sequence of operations. A mutex works, but a single goroutine owning the state is often clearer *and* faster under high contention.

**Slow:**
```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Add(d int) { c.mu.Lock(); c.n += d; c.mu.Unlock() }
```

This is fine for trivial cases — but consider a server that needs to serialise *many* operations against a single state machine (a session, a connection, a state-driven worker). With high contention, mutex queueing dominates.

**Optimised:** make the state owned by one goroutine and send operations to it:
```go
type Op struct {
    delta int
    reply chan int
}

type Counter struct {
    ch chan Op
}

func NewCounter() *Counter {
    c := &Counter{ch: make(chan Op, 64)}
    go func() {
        n := 0
        for op := range c.ch {
            n += op.delta
            if op.reply != nil { op.reply <- n }
        }
    }()
    return c
}

func (c *Counter) Add(d int) { c.ch <- Op{delta: d} }
```

**Gain:** For long-running stateful workers, throughput rises because the owner goroutine batches operations, hits its CPU cache, and is never preempted by other goroutines fighting for the same mutex. For trivial counters this is *worse* than a mutex — the win shows up when the per-op work is non-trivial and contention is heavy.

**Caveat:** "Don't communicate by sharing memory; share memory by communicating" is right *sometimes*, not always. For a single-integer counter, atomics are still the answer. Profile to see whether channel send/receive cost beats lock acquisition for your case.

---

## Optimization 9 — Double-checked initialisation with `sync.Once`

**Problem:** Lazy initialisation of an expensive resource. Naive code locks every call to check whether the work has been done.

**Slow:**
```go
type Service struct {
    mu    sync.Mutex
    cfg   *Config
    done  bool
}

func (s *Service) Cfg() *Config {
    s.mu.Lock()
    defer s.mu.Unlock()
    if !s.done {
        s.cfg = loadFromDisk()
        s.done = true
    }
    return s.cfg
}
```

**Bottleneck:** Every call takes the mutex, even after initialisation completed. Hot-path readers serialise against each other forever.

**Optimised:**
```go
type Service struct {
    once sync.Once
    cfg  *Config
}

func (s *Service) Cfg() *Config {
    s.once.Do(func() { s.cfg = loadFromDisk() })
    return s.cfg
}
```

**Gain:** After the first call, `Once.Do` is a single atomic load on the fast path — about as fast as a regular function call. For services that read configuration on every request, removing the lock on the steady-state path can return measurable CPU.

**Variant — `OnceValue` (Go 1.21+):**
```go
var loadCfg = sync.OnceValue(loadFromDisk)

func (s *Service) Cfg() *Config { return loadCfg() }
```
Even cleaner; same fast-path performance.

---

## Optimization 10 — Coalesce updates to reduce lock acquisitions

**Problem:** Many goroutines making tiny updates to a shared aggregate (counters, histograms, log buckets). Each update takes the lock individually.

**Slow:**
```go
type Histogram struct {
    mu      sync.Mutex
    buckets []int
}

func (h *Histogram) Record(b int) {
    h.mu.Lock()
    h.buckets[b]++
    h.mu.Unlock()
}
```

**Bottleneck:** With N goroutines each calling `Record` millions of times per second, the mutex serialises every increment. No amount of CPU helps.

**Optimised — per-goroutine accumulators flushed periodically:**
```go
type Histogram struct {
    mu      sync.Mutex
    buckets []int
}

type Local struct {
    h       *Histogram
    pending []int // local copy
}

func (l *Local) Record(b int) {
    l.pending[b]++
    if l.pending[b]%1024 == 0 {
        l.flush()
    }
}

func (l *Local) flush() {
    l.h.mu.Lock()
    for i, v := range l.pending {
        l.h.buckets[i] += v
        l.pending[i] = 0
    }
    l.h.mu.Unlock()
}
```

**Gain:** Lock acquisitions drop by a factor of 1024 (the batch size). Aggregate throughput rises by orders of magnitude on multi-core systems. Trade-off: the global histogram lags by up to one batch per goroutine.

**Caveat:** Coalescing is right when the consumer can tolerate slight staleness (metrics, observability, statistical aggregates). It is wrong for state where each update must be visible immediately (account balances, allocation tracking). Know which side you are on.

---

## Optimization 11 — Per-CPU sharding (`runtime.GOMAXPROCS`)

**Problem:** A counter incremented by many goroutines on many cores. Even atomic increments contend on the same cache line; cores fight for ownership of that 64-byte chunk of memory.

**Slow:**
```go
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc() { c.n.Add(1) }
```

**Bottleneck:** True/false sharing. Every `Add(1)` from a different core invalidates that core's L1 cache for the line containing `n`. On 32 cores, throughput plateaus or even *decreases* with more goroutines.

**Optimised — striped counter, one cache line per core:**
```go
const cacheLine = 64

type StripedCounter struct {
    cells [runtime.NumCPU()]struct {
        n atomic.Int64
        _ [cacheLine - 8]byte // padding
    }
}

func (c *StripedCounter) Inc() {
    // index by goroutine-local hint
    i := procPin()       // pseudo, e.g. via runtime.procPin
    c.cells[i].n.Add(1)
    procUnpin()
}

func (c *StripedCounter) Sum() int64 {
    var total int64
    for i := range c.cells {
        total += c.cells[i].n.Load()
    }
    return total
}
```

**Gain:** Cache-line contention disappears; each core writes to its own cell. Throughput scales linearly with cores. Common library: `golang.org/x/sync/singleflight`'s siblings, or DIY following the pattern above.

**Caveat:** `Sum()` is now an O(NumCPU) walk. Use this for write-heavy counters where reads are rare (request counts, byte counters). `runtime.procPin` is unexported in the standard library; libraries like `uber-go/atomic` or `puzpuzpuz/xsync` implement this safely.

---

## Optimization 12 — Use `mutex profiling` to find contention hotspots

**Problem:** "The service is slow under load." Profiling CPU shows nothing dominant; profiling allocations shows nothing unusual; the actual bottleneck is goroutines blocked on a contended mutex, which a CPU profile *cannot* see.

**Slow approach:** guess. Pick a likely lock, swap it for `RWMutex`, measure, repeat. This is folklore optimisation — most attempts make things worse.

**Optimised approach — collect a mutex profile:**
```bash
# from a running server with net/http/pprof:
go tool pprof http://localhost:6060/debug/pprof/mutex

# or from a benchmark:
go test -bench=. -mutexprofile=mu.out
go tool pprof mu.out
(pprof) top
(pprof) list myFunctionName
```

To enable contention sampling at runtime:
```go
import "runtime"
func init() { runtime.SetMutexProfileFraction(1) } // 1 = sample everything
```

A typical output line looks like:
```
flat   flat%   sum%   cum   cum%
14.2s  41.7%  41.7%  14.2s 41.7%  myapp/cache.(*Cache).Get
```

**Gain:** You now know *which* lock to optimise — usually one or two locks dominate. Fix that one, re-profile, repeat. Without this data, optimisation is guesswork.

**Companion tools:**
- `go test -blockprofile=block.out` — profiles all blocking events (channels, syscalls, mutexes).
- `runtime.SetBlockProfileRate(1)` — enables block profiling at runtime.
- `go tool trace` — visualises goroutine activity over time, including time spent waiting on locks.

**Rule:** never optimise a mutex without a profile that shows it as a hot spot. The intuition you have for locked code is almost always wrong; profilers are right.

---

## Benchmarking and Measurement

Optimisation without measurement is folklore. The harness:

```go
func BenchmarkCounterMutex(b *testing.B) {
    var c CounterWithMutex
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            c.Inc()
        }
    })
}

func BenchmarkCounterAtomic(b *testing.B) {
    var c CounterAtomic
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            c.Inc()
        }
    })
}
```

Run with:
```bash
go test -bench=. -benchmem -cpu=1,4,8,32 -mutexprofile=mu.out
```

Record `ns/op`, `B/op`, `allocs/op`, and the mutex-profile top callers *before* and *after* every change. If a "fix" doesn't move the numbers, it isn't a fix.

For production: emit `runtime.NumGoroutine()`, `runtime.ReadMemStats`, and (from `runtime/metrics`) `/sync/mutex/wait/total:seconds` over time. A rising mutex-wait-total against flat throughput is the canonical signature of growing contention.

---

## When NOT to Optimize

- **Pre-launch service with three users:** correct and clear beats fast and clever. Use a `Mutex`. Move on.
- **Counter incremented occasionally:** atomics are technically faster, but a mutex around an `int64` adds maybe 30 ns; if the counter is incremented once per request, this is invisible.
- **Sharding without a profile:** introducing `shards` worth of complexity for a workload with low contention is pure cost.
- **`sync.Map` outside its sweet spot:** use it for insert-once / read-many, not as a general fast map.
- **`sync.Pool` for tiny short-lived objects:** the pool overhead can exceed the allocation cost. Profile first.
- **Lock-free anything before measuring:** lock-free code is harder to verify, harder to debug, and easier to break under maintenance. Reach for it only when a profile demands it.

---

## Summary

A mutex is correctness; performance is what's *left* after correctness. The path from correct to fast is a sequence of demotions:

1. **`Mutex`** when state must be protected and you have nothing to measure with yet.
2. **`RWMutex`** when reads dominate writes *and* you have profiled to confirm the read lock pays for itself.
3. **Sharding** when one lock has become the bottleneck across many cores and the keys are independent.
4. **Atomics** when the shared state is a single primitive or a published pointer.
5. **`sync.Once` / `OnceValue`** for one-shot initialisation.
6. **Channels** when state is best owned by a single goroutine and the work is non-trivial.
7. **Per-CPU striping** when even atomics contend on cache-line ownership.
8. **`sync.Pool`** when allocation pressure inflates GC pauses (and therefore mutex hold times).

Every step adds complexity; every step assumes you have a profile justifying it. Optimise the lock you can prove is hot, measure the change, repeat. The fastest mutex is the one you removed; the second fastest is the one you almost never take.
