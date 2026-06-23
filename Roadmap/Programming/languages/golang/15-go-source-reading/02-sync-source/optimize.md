# sync — Optimization

## 1. How to use this file

Fourteen scenarios where `sync`-shaped code is slower, allocates more, or scales worse than a different primitive in the same package — or no primitive at all. Each entry has a **Before** (code + benchmark) and a collapsible **After** (optimized code + benchmark + why + trade-offs + when NOT).

Anchored at Go 1.23, amd64, GOMAXPROCS=8. Numbers are reproducible-shape — run `go test -bench=. -benchmem -cpu=8` on your hardware before quoting them. `sync` cost is dominated by four things: contention on a single word (mutex state, atomic value), cache-line bouncing across cores, per-call allocation of pooled values, and runtime calls into `runtime.semacquire`/`runtime.gopark`. Most wins remove one of those four from the hot path. Reading order: Ex. 1, 2, 11, then any order. Ex. 4, 6, 13 are the ones most senior reviews flag.

---

## 2. Exercise 1 — Mutex-protected counter

A request counter is read and incremented millions of times per second from many goroutines. Each `mu.Lock`/`Unlock` pair is a `runtime.semacquire`-shaped call even when uncontended, and contended waits park the goroutine.

```go
type Counter struct {
    mu sync.Mutex
    n  int64
}

func (c *Counter) Inc()       { c.mu.Lock(); c.n++; c.mu.Unlock() }
func (c *Counter) Load() int64 { c.mu.Lock(); defer c.mu.Unlock(); return c.n }
```

```
BenchmarkMutexCounter-8   50000000   42 ns/op   0 B/op   0 allocs/op  // uncontended
BenchmarkMutexCounterParallel-8   8000000   178 ns/op   0 B/op   0 allocs/op  // 8 goroutines
```

<details><summary>After</summary>

`atomic.Int64` is a single LOCK XADD on x86 — no park, no spin, no fairness machinery.

```go
type Counter struct{ n atomic.Int64 }

func (c *Counter) Inc()        { c.n.Add(1) }
func (c *Counter) Load() int64 { return c.n.Load() }
```

```
BenchmarkAtomicCounter-8   200000000   6.1 ns/op   0 B/op   0 allocs/op
BenchmarkAtomicCounterParallel-8   80000000   18 ns/op   0 B/op   0 allocs/op
```

~7× faster uncontended, ~10× under contention.

**Why faster:** `sync.Mutex` does an atomic CAS plus bookkeeping (`state`, `sema`) and parks on contention. `atomic.Int64.Add` compiles to one `LOCK XADDQ` instruction. No goroutine ever sleeps — the bus arbitrates.
**Trade-off:** Atomics protect one word — for two related fields (counter + last-updated timestamp), you still need a mutex or a packed struct + `atomic.Pointer`. Compound reads (`if n == 0 { ... }`) are racy without rechecking. Memory ordering is sequentially consistent in Go's `sync/atomic` — fine, but on weaker-ordered platforms the compiler still emits barriers.
**When NOT:** Counter participates in invariants with other fields (e.g., "if n > 0, ptr must be non-nil"). The increment is conditional on a complex predicate. You want fairness/queue order — atomics don't queue.
</details>

---

## 3. Exercise 2 — Global Mutex on a hot path

A request-tracking map is guarded by one `sync.Mutex` for a whole-process metrics path. Eight goroutines spin on the same cache line; throughput collapses past 4 cores.

```go
type Stats struct {
    mu      sync.Mutex
    perRoute map[string]int
}

func (s *Stats) Hit(route string) {
    s.mu.Lock()
    s.perRoute[route]++
    s.mu.Unlock()
}
```

```
BenchmarkGlobalMutex-8   3000000   420 ns/op   0 B/op   0 allocs/op  // 8 goroutines, 1024 routes
```

<details><summary>After</summary>

Shard the map. Pick the shard from a hash of the key; only goroutines hitting the same shard contend.

```go
const shards = 64

type Stats struct {
    s [shards]struct {
        mu  sync.Mutex
        m   map[string]int
        _   [56]byte // pad to 64 B so neighboring shards don't share a cache line
    }
}

func (s *Stats) Hit(route string) {
    h := fnv.New32a(); h.Write([]byte(route))
    sh := &s.s[h.Sum32()%shards]
    sh.mu.Lock(); sh.m[route]++; sh.mu.Unlock()
}
```

```
BenchmarkShardedMutex-8   30000000   38 ns/op   0 B/op   0 allocs/op
```

~11× faster under 8-way contention.

**Why faster:** Contention drops by ~`shards`× when keys distribute evenly. Each shard's `state` word lives on its own cache line — no false sharing between shards. The cost per call is one hash + one (probably uncontended) lock.
**Trade-off:** Snapshotting all stats requires locking all 64 shards in a stable order — verbose and slower than one lock. Hot keys still contend if they hash to the same shard. Memory grows: 64 maps with their own buckets, plus padding.
**When NOT:** The map is small (< 1k entries) and contention is mild — one mutex is faster than 64 cache-padded ones. Iteration is the hot path, not point updates. Keys are skewed (one route gets 90% of traffic) — sharding helps proportionally less.
</details>

---

## 4. Exercise 3 — RWMutex worse than Mutex (few readers, many writers)

A small in-memory routing table is read 1× per request and written 4× per request (counters, last-seen, latency, status). The author reached for `sync.RWMutex` because "it has reads," but write-heavy workloads pay RWMutex's larger state machine without the readers-in-parallel benefit.

```go
type Routes struct {
    mu     sync.RWMutex
    routes map[string]*Route
}

func (r *Routes) Get(k string) *Route { r.mu.RLock(); defer r.mu.RUnlock(); return r.routes[k] }
func (r *Routes) Update(k string, fn func(*Route)) {
    r.mu.Lock(); fn(r.routes[k]); r.mu.Unlock()
}
```

```
BenchmarkRWMutexWriteHeavy-8   5000000   310 ns/op   0 B/op   0 allocs/op  // 1 read : 4 writes, 8 goroutines
```

<details><summary>After</summary>

Plain `sync.Mutex`. Lock/unlock is one CAS pair; RWMutex's writer path goes through a reader-counting protocol that's costlier under contention.

```go
type Routes struct {
    mu     sync.Mutex
    routes map[string]*Route
}

func (r *Routes) Get(k string) *Route { r.mu.Lock(); defer r.mu.Unlock(); return r.routes[k] }
func (r *Routes) Update(k string, fn func(*Route)) {
    r.mu.Lock(); fn(r.routes[k]); r.mu.Unlock()
}
```

```
BenchmarkMutexWriteHeavy-8   9000000   175 ns/op   0 B/op   0 allocs/op
```

~1.8× faster.

**Why faster:** `RWMutex.Lock` (writer) must first wait for active readers to drain, atomic-increment-decrement a reader counter, and park if needed. `Mutex.Lock` is a single CAS on `state`. When writers dominate, the reader-counting machinery is pure overhead.
**Trade-off:** Loses parallel reads — but the workload had only 1 read per 4 writes, so there's nothing to parallelize. If the workload mix shifts back to read-heavy (>10:1), switch back.
**When NOT:** Read:write ratio above ~8:1 with reads holding the lock for nontrivial work — `RWMutex` wins there. Long-held read locks where parallel reads matter more than per-op overhead. Mixed access patterns where the lock type is hard to predict — measure both.
</details>

---

## 5. Exercise 4 — `sync.Map` for write-heavy work

`sync.Map` is optimized for "write once, read many" or "disjoint key sets per goroutine." A session cache that's read and written at near-equal rates pays for the `read`/`dirty` two-map machinery without the read-mostly win.

```go
var cache sync.Map // map[string]*Session

func Get(id string) *Session {
    v, _ := cache.Load(id)
    if v == nil { return nil }
    return v.(*Session)
}

func Put(id string, s *Session) { cache.Store(id, s) }
```

```
BenchmarkSyncMapWriteHeavy-8   4000000   280 ns/op   48 B/op   2 allocs/op  // 50/50 R/W, 8 goroutines
```

<details><summary>After</summary>

Plain `map[string]*Session` + `sync.Mutex`. Single lock, single map, predictable cost.

```go
type Cache struct {
    mu sync.Mutex
    m  map[string]*Session
}

func (c *Cache) Get(id string) *Session { c.mu.Lock(); defer c.mu.Unlock(); return c.m[id] }
func (c *Cache) Put(id string, s *Session) { c.mu.Lock(); c.m[id] = s; c.mu.Unlock() }
```

```
BenchmarkMutexMapWriteHeavy-8   12000000   95 ns/op   0 B/op   0 allocs/op
```

~3× faster, allocations eliminated.

**Why faster:** `sync.Map.Store` on a missing key promotes the `read` map to `dirty` and re-allocates entries — that's the 2 allocs/op. Writes that hit the `dirty` path traverse two maps. A plain map + mutex has one lookup, one assignment, and amortizes contention by holding the lock briefly.
**Trade-off:** All access serializes through one lock — shard (Ex. 2) for higher fan-in. Lose `Range`'s lock-free iteration. Lose per-key concurrent updates if you also need read parallelism (then `RWMutex` if reads dominate).
**When NOT:** True read-mostly (>10:1) workloads with stable key sets — `sync.Map` shines. Per-goroutine key partitions where each goroutine owns its keys. Code that uses `LoadOrStore`/`CompareAndSwap` patterns that the mutex map would have to reinvent.
</details>

---

## 6. Exercise 5 — `sync.Pool` storing tiny objects

A logging path pools `*[8]byte` headers via `sync.Pool` "to avoid allocations." Each header is 8 bytes — smaller than the per-Get/Put bookkeeping. The pool adds an atomic CAS and per-P bookkeeping for every call.

```go
var headerPool = sync.Pool{New: func() any { return new([8]byte) }}

func writeRecord(w io.Writer, ts int64) {
    h := headerPool.Get().(*[8]byte)
    binary.LittleEndian.PutUint64(h[:], uint64(ts))
    w.Write(h[:])
    headerPool.Put(h)
}
```

```
BenchmarkPoolTiny-8   30000000   55 ns/op   0 B/op   0 allocs/op
```

<details><summary>After</summary>

Just allocate on the stack. A `[8]byte` value is 8 bytes; escape analysis keeps it stack-resident if the slice doesn't escape.

```go
func writeRecord(w io.Writer, ts int64) {
    var h [8]byte
    binary.LittleEndian.PutUint64(h[:], uint64(ts))
    w.Write(h[:])
}
```

```
BenchmarkStackAlloc-8   80000000   18 ns/op   0 B/op   0 allocs/op
```

~3× faster, same zero allocations (escape analysis keeps `h` on the stack).

**Why faster:** `sync.Pool.Get` does an atomic load of `local[P].private`, then `local[P].shared.popHead`, then steals from other Ps if empty. That machinery is ~30 ns even on a cache hit. For an 8-byte value, allocation costs zero (stack), so the pool is pure overhead.
**Trade-off:** Stack-only works if escape analysis agrees. `w.Write(h[:])` keeps `h` on the stack here because `Write` doesn't retain the slice. If it did escape (e.g., goroutine spawn), you'd allocate per call — which for 8 B is still ~5 ns, not 55.
**When NOT:** The pooled value is large (≥ 256 B) and escapes — pool saves the allocator call and GC pressure. Pool stores a value with expensive initialization (a zeroed-out `bytes.Buffer` ready to grow). The hot path allocates ≥ 1 MB across goroutines per second.
</details>

---

## 7. Exercise 6 — Channel-based mutex pattern

A "Go-idiomatic" lock uses a buffered channel of capacity 1. The author thought "channels not mutexes." Send/receive on a buffered channel is slower than mutex lock/unlock because it goes through `runtime.chansend1`/`chanrecv1` with parking machinery.

```go
type ChanLock struct{ ch chan struct{} }
func NewChanLock() *ChanLock { return &ChanLock{ch: make(chan struct{}, 1)} }

func (l *ChanLock) Lock()   { l.ch <- struct{}{} }
func (l *ChanLock) Unlock() { <-l.ch }
```

```
BenchmarkChanLock-8   30000000   58 ns/op   0 B/op   0 allocs/op  // uncontended
BenchmarkChanLockParallel-8   5000000   240 ns/op   0 B/op   0 allocs/op  // 8 goroutines
```

<details><summary>After</summary>

`sync.Mutex` — the right primitive for mutual exclusion.

```go
var mu sync.Mutex
// mu.Lock(); /* critical section */; mu.Unlock()
```

```
BenchmarkSyncMutex-8   60000000   24 ns/op   0 B/op   0 allocs/op
BenchmarkSyncMutexParallel-8   10000000   115 ns/op   0 B/op   0 allocs/op
```

~2.4× faster uncontended, ~2.1× under contention.

**Why faster:** `sync.Mutex.Lock` fast-path is one CAS on a 32-bit `state` word. The channel path enters `runtime.chansend` which acquires the channel's own mutex, checks the buffer, possibly enqueues on the sendq, and may park. Even when the buffer has room, the bookkeeping is 2× the work of a mutex CAS.
**Trade-off:** Channels are needed when you also want `select`/timeout/cancellation. `Mutex` doesn't compose with `<-ctx.Done()`. If you really need "try-lock with timeout," use `chan struct{}` with `select` or `TryLock` (Go 1.18+) plus a wait loop.
**When NOT:** You need `select { case <-lock: ...; case <-ctx.Done(): return ctx.Err() }` semantics. The "lock" is conceptually a token (semaphore with N > 1) — then a buffered channel of capacity N is the right primitive. Educational examples illustrating CSP.
</details>

---

## 8. Exercise 7 — `WaitGroup` + result via shared slice

A fan-out collects results into a `[]Result` indexed by goroutine ID. A `sync.Mutex` guards the append; a `WaitGroup` signals completion. The shape works but tangles concerns: error propagation is bolted on as a shared `error` slot, and the API leaks the index discipline.

```go
func fetchAll(urls []string) ([]Result, error) {
    results := make([]Result, len(urls))
    var firstErr error
    var mu sync.Mutex
    var wg sync.WaitGroup
    for i, u := range urls {
        wg.Add(1)
        go func(i int, u string) {
            defer wg.Done()
            r, err := fetch(u)
            mu.Lock()
            if err != nil && firstErr == nil { firstErr = err }
            results[i] = r
            mu.Unlock()
        }(i, u)
    }
    wg.Wait()
    return results, firstErr
}
```

```
BenchmarkWaitGroupShared-8   3000   480000 ns/op   2400 B/op   33 allocs/op  // 32 URLs, mocked fetch
```

<details><summary>After</summary>

`errgroup.Group` with context-cancel on first error, results in a pre-sized slice keyed by index — no mutex needed because each goroutine writes a disjoint cell.

```go
import "golang.org/x/sync/errgroup"

func fetchAll(ctx context.Context, urls []string) ([]Result, error) {
    results := make([]Result, len(urls))
    g, ctx := errgroup.WithContext(ctx)
    for i, u := range urls {
        i, u := i, u
        g.Go(func() error {
            r, err := fetchCtx(ctx, u)
            if err != nil { return err }
            results[i] = r // disjoint index — no mutex
            return nil
        })
    }
    if err := g.Wait(); err != nil { return nil, err }
    return results, nil
}
```

```
BenchmarkErrgroup-8   4500   320000 ns/op   1100 B/op   24 allocs/op
```

~1.5× faster, ~2× less garbage, plus correct first-error semantics and context cancellation.

**Why faster:** The mutex was serializing 32 goroutines on result-write, even though each wrote a disjoint cell. Removing it lets goroutines complete in parallel. `errgroup`'s internal `sync.Once` for first-error replaces the explicit `firstErr` check + lock.
**Trade-off:** Need `golang.org/x/sync` (not stdlib, though widely used). Cancellation requires every worker to plumb `ctx` — a discipline issue. Disjoint-index writes are safe only because each `i` is unique per goroutine; collecting variable-length output (append) still needs a mutex or per-goroutine slices merged at the end.
**When NOT:** Workers don't fail (no error path) — `WaitGroup` is fine. You truly need to append into a shared slice — use one slice per worker, merge after `Wait`. You can't import `x/sync` for policy reasons — write the `Once`+`WaitGroup`+`context` combo manually.
</details>

---

## 9. Exercise 8 — `sync.Cond` for one-time event

A connection-init path uses `sync.Cond` to broadcast "connection ready" once at startup. `Cond` is right for *repeated* events with multiple waiters; for one-shot signaling, a channel `close` is simpler and faster.

```go
type Conn struct {
    mu    sync.Mutex
    cond  *sync.Cond
    ready bool
}

func NewConn() *Conn { c := &Conn{}; c.cond = sync.NewCond(&c.mu); return c }

func (c *Conn) WaitReady() {
    c.mu.Lock()
    for !c.ready { c.cond.Wait() }
    c.mu.Unlock()
}

func (c *Conn) MarkReady() {
    c.mu.Lock()
    c.ready = true
    c.cond.Broadcast()
    c.mu.Unlock()
}
```

```
BenchmarkCondOneShot-8   500000   2800 ns/op   96 B/op   2 allocs/op  // 8 waiters
```

<details><summary>After</summary>

A `chan struct{}` closed once. Any number of receivers wake up; subsequent receives return immediately.

```go
type Conn struct {
    ready chan struct{} // closed when ready
}

func NewConn() *Conn { return &Conn{ready: make(chan struct{})} }

func (c *Conn) WaitReady()                 { <-c.ready }
func (c *Conn) WaitReadyCtx(ctx context.Context) error {
    select {
    case <-c.ready:    return nil
    case <-ctx.Done(): return ctx.Err()
    }
}
func (c *Conn) MarkReady() { close(c.ready) }
```

```
BenchmarkChanClose-8   2000000   620 ns/op   0 B/op   0 allocs/op
```

~4.5× faster, zero allocations, plus free cancellation via `select`.

**Why faster:** `Cond.Wait` parks on a list under the cond's mutex, and `Broadcast` walks the list to wake each waiter. Channel `close` flips a flag and unparks the recv queue in one operation. Re-acquiring the mutex after `Cond.Wait` adds an extra lock/unlock pair per waiter.
**Trade-off:** A closed channel can't be "unclosed" — `Cond` lets you reset state for repeated events. Composing multiple one-shot signals into "wait for all" needs `sync.WaitGroup` or `errgroup`, not raw channels.
**When NOT:** The event repeats — buffered worker queues, resource pools waiting on slot availability. Waiters need predicate checks on every wakeup (queue non-empty AND room for me) — that's `Cond`'s natural shape. Cross-process signaling — neither works; use OS primitives.
</details>

---

## 10. Exercise 9 — `sync.Once` on the hot path (already optimal)

A config loader uses `sync.Once.Do` to lazily initialize a singleton. The Once is called millions of times per second after init; the worry is "is `Do` slow on the fast path?" — but `Once` has a fast-path atomic load, so re-checking is a single load.

```go
var (
    once sync.Once
    cfg  *Config
)

func GetConfig() *Config {
    once.Do(func() { cfg = loadConfig() })
    return cfg
}
```

```
BenchmarkOnceHot-8   1000000000   1.2 ns/op   0 B/op   0 allocs/op  // post-init, single goroutine
BenchmarkOnceHotParallel-8   500000000   2.4 ns/op   0 B/op   0 allocs/op
```

<details><summary>After (no change — confirm it's already optimal)</summary>

`Once.Do` reads `o.done` atomically first; if 1, returns immediately. No mutex acquired on the fast path. Don't replace it with `atomic.Bool` + manual init unless you're solving a different problem.

```go
// Same code. The atomic Load is already the fast path.
func GetConfig() *Config {
    once.Do(func() { cfg = loadConfig() })
    return cfg
}
```

```
BenchmarkOnceHot-8   1000000000   1.2 ns/op   0 B/op   0 allocs/op  // identical
```

No change. The benchmark confirms `Once.Do` post-init is ~1.2 ns — within noise of an inline `atomic.Bool.Load` + branch.

**Why already optimal:** Since Go 1.x, `Once.Do` starts with `atomic.LoadUint32(&o.done)`. If non-zero, it returns. The slow path (mutex + closure call) runs only on the first call per Once. The 1.2 ns measurement is just the atomic load + branch + return.
**Trade-off:** Don't be tempted to hoist `cfg` to a package var and access it directly to "skip the Once" — you lose initialization-safety guarantees if any caller can race the loader. The 1.2 ns is not the bottleneck.
**When NOT (to "optimize"):** Never. Replacing `Once` with custom atomic-bool patterns is how the `sync.Once` memory-order bug from older codebases happens. Trust the primitive; profile something else.
</details>

---

## 11. Exercise 10 — Per-call allocation of struct with Mutex

A per-request rate limiter allocates a `*Bucket` per call, locks it briefly, then drops it. The allocation is the cost — mutex use is fine.

```go
type Bucket struct {
    mu     sync.Mutex
    tokens float64
    last   time.Time
}

func newBucket() *Bucket { return &Bucket{tokens: 10, last: time.Now()} }

func Allow() bool {
    b := newBucket() // alloc per call
    b.mu.Lock()
    now := time.Now()
    b.tokens += now.Sub(b.last).Seconds()
    b.last = now
    ok := b.tokens >= 1
    if ok { b.tokens-- }
    b.mu.Unlock()
    return ok
}
```

```
BenchmarkBucketAlloc-8   10000000   145 ns/op   48 B/op   1 allocs/op
```

<details><summary>After</summary>

`sync.Pool` for the bucket. The allocation goes away on the hot path; only cold paths allocate.

```go
var bucketPool = sync.Pool{New: func() any { return &Bucket{} }}

func Allow() bool {
    b := bucketPool.Get().(*Bucket)
    defer bucketPool.Put(b)
    b.tokens = 10; b.last = time.Now() // reset
    b.mu.Lock()
    /* ... same logic ... */
    b.mu.Unlock()
    return true
}
```

```
BenchmarkBucketPool-8   30000000   42 ns/op   0 B/op   0 allocs/op
```

~3.5× faster, allocations eliminated.

**Why faster:** The 48 B allocation per call was the dominant cost. `sync.Pool.Get`/`Put` is ~10 ns per call on cache hits — well under the 100+ ns saved by skipping `mallocgc` plus the GC's eventual sweep work.
**Trade-off:** The example is contrived because each "request" makes a *fresh* bucket — a real rate limiter would key buckets by user/IP and share them. If buckets are shared, you don't need a pool; if they're per-call, the right fix is usually not to allocate them at all. Treat this as the "if you really must do per-call allocation, pool it" recipe.
**When NOT:** Buckets carry state that must persist across calls — sharing one per key beats pooling. Allocation rate < 100k/s — pool overhead approaches allocation savings. Pooled object holds resources (file handles, goroutines) that need explicit cleanup — pool's "may be dropped" semantics break that.
</details>

---

## 12. Exercise 11 — Atomic on contended small field

A `ConnState` struct has an `atomic.Int32` field for status. Eight goroutines hammer it across the connection pool. The field shares a cache line with the next field (`stats`), so updates to either ping-pong the line — false sharing.

```go
type ConnState struct {
    status atomic.Int32 // 4 B at offset 0
    stats  atomic.Int64 // 8 B at offset 8 — same 64 B cache line
}
```

```
BenchmarkFalseSharing-8   3000000   320 ns/op   0 B/op   0 allocs/op  // status+stats updated by different goroutines
```

<details><summary>After</summary>

Pad to separate cache lines. The Go convention is `_ [N]byte` filler sized to push the next field onto its own line.

```go
type ConnState struct {
    status atomic.Int32
    _      [60]byte // pad to 64 B
    stats  atomic.Int64
    _      [56]byte
}
```

```
BenchmarkPaddedAtomic-8   8000000   125 ns/op   0 B/op   0 allocs/op
```

~2.5× faster under cross-field contention.

**Why faster:** False sharing forces the cache line to bounce between cores even though they're updating *different* fields. Padding gives each field its own 64 B line; writes go through L1 of the writing core without invalidating the other's cache. Visible in `perf stat -e cache-misses` as a sharp drop.
**Trade-off:** Memory cost: each padded field consumes 64 B instead of 4 or 8. For 1M struct instances, that's 60 MB of wasted RAM per padded field. Wrong cache-line size on ARM (often 128 B Cortex-A, 64 B M-series) — use `cpu.CacheLinePad` from `golang.org/x/sys/cpu` for portability.
**When NOT:** Atomic field is only ever updated by one goroutine — no contention to optimize. The two fields are always read/written together by the same goroutine — false sharing doesn't apply. Memory is constrained (embedded, mobile) and contention is mild.
</details>

---

## 13. Exercise 12 — `sync.Map.LoadOrStore` allocating on the hit path

`LoadOrStore(key, value)` always evaluates the second argument, even when the key exists. For values that are expensive to construct (sessions, compiled regexes), you allocate per call regardless of cache state.

```go
var sessions sync.Map

func GetOrCreate(id string) *Session {
    s := newSession(id) // expensive, called even on cache hit
    actual, _ := sessions.LoadOrStore(id, s)
    return actual.(*Session)
}
```

```
BenchmarkLoadOrStore-8   2000000   780 ns/op   320 B/op   4 allocs/op  // 99% cache hits
```

<details><summary>After</summary>

Cheap `Load` first; allocate + `Store` only on miss. The `LoadOrStore` after miss handles the race where another goroutine stored concurrently.

```go
func GetOrCreate(id string) *Session {
    if v, ok := sessions.Load(id); ok {
        return v.(*Session)
    }
    s := newSession(id) // only on miss
    actual, _ := sessions.LoadOrStore(id, s)
    return actual.(*Session)
}
```

```
BenchmarkLoadThenStore-8   30000000   42 ns/op   0 B/op   0 allocs/op  // 99% cache hits
```

~18× faster on the hit path, allocations gone.

**Why faster:** `Load` is lock-free against the immutable `read` map in `sync.Map`. The hit path becomes a single map lookup with no allocation. The miss path still allocates one `Session` and may race with another goroutine — `LoadOrStore` resolves the race by returning the winner.
**Trade-off:** Slightly more code than `LoadOrStore` alone. On miss, you may allocate a `Session` that's then discarded (the racing goroutine's wins) — wasted work, but rare and bounded. If `newSession` has side effects (opens a file, registers a callback), discarding it leaks; structure init to be cheap and idempotent.
**When NOT:** Hit rate is low (< 50%) — you'd allocate often anyway, and the double-check adds overhead. `newSession` is trivially cheap (e.g., struct literal) — the unconditional allocation is < 20 ns. You need exact "store wins iff key absent" semantics where the loser's value must be observable — only `LoadOrStore` gives that.
</details>

---

## 14. Exercise 13 — Excessive read-lock acquisition on config-style reads

A feature-flag service has 50k QPS of reads per server, with config reloads every 30 seconds. Each read takes `RLock`/`RUnlock` on a `sync.RWMutex`. The atomic CAS on `RLock` is fine uncontended but pings the cache line every read across cores.

```go
type FlagService struct {
    mu    sync.RWMutex
    flags map[string]bool
}

func (s *FlagService) Enabled(name string) bool {
    s.mu.RLock(); defer s.mu.RUnlock()
    return s.flags[name]
}

func (s *FlagService) Reload(newFlags map[string]bool) {
    s.mu.Lock(); s.flags = newFlags; s.mu.Unlock()
}
```

```
BenchmarkRLockRead-8   30000000   42 ns/op   0 B/op   0 allocs/op
BenchmarkRLockReadParallel-8   8000000   180 ns/op   0 B/op   0 allocs/op  // 8 goroutines
```

<details><summary>After</summary>

`atomic.Pointer[map[...]bool]` — the map is immutable; reload swaps the pointer atomically. Reads are a single atomic load with no fence on x86.

```go
type FlagService struct {
    flags atomic.Pointer[map[string]bool]
}

func NewFlagService() *FlagService {
    s := &FlagService{}
    m := map[string]bool{}
    s.flags.Store(&m)
    return s
}

func (s *FlagService) Enabled(name string) bool {
    return (*s.flags.Load())[name]
}

func (s *FlagService) Reload(newFlags map[string]bool) {
    s.flags.Store(&newFlags)
}
```

```
BenchmarkAtomicPtrRead-8   200000000   6.5 ns/op   0 B/op   0 allocs/op
BenchmarkAtomicPtrReadParallel-8   80000000   8.0 ns/op   0 B/op   0 allocs/op
```

~6× faster single-threaded, ~22× under 8-way contention.

**Why faster:** `RLock` increments and `RUnlock` decrements a reader counter via atomic CAS — both writes to a shared cache line, bouncing it across cores even though no exclusive lock is held. `atomic.Pointer.Load` is a single MOV on x86 (load-acquire); no cache line write, no inter-core ping-pong. Reads scale linearly with cores.
**Trade-off:** The map must be treated as immutable post-Store — callers cannot mutate it. Reload allocates a fresh map and copies; no in-place edits. Compound reads (e.g., "if X enabled, also check Y") see a consistent snapshot only if both reads use the same `Load`-returned pointer.
**When NOT:** The map mutates frequently between full reloads (per-key updates) — copy-on-write costs dominate. Readers need a transaction across multiple maps or fields — `RWMutex` keeps them in lockstep. Memory is tight and the map is large — each reload doubles peak usage.
</details>

---

## 15. Exercise 14 — Heavy work inside critical section

A request handler computes an expensive JSON marshal *while holding* a mutex on a shared cache. Other goroutines block on the mutex for the entire marshal duration, even though they don't need the marshaled result.

```go
type Cache struct {
    mu   sync.Mutex
    data map[string]*Entry
}

func (c *Cache) Snapshot(key string) ([]byte, error) {
    c.mu.Lock()
    defer c.mu.Unlock()
    entry := c.data[key]
    if entry == nil { return nil, errNotFound }
    return json.Marshal(entry) // 50-500 us under lock
}
```

```
BenchmarkLockedMarshal-8   30000   42000 ns/op   1200 B/op   18 allocs/op  // 8 goroutines
```

<details><summary>After</summary>

Narrow the critical section: lock to fetch + copy the pointer, unlock, then marshal outside the lock. If `Entry` is mutable, deep-clone the fields the marshaler reads.

```go
func (c *Cache) Snapshot(key string) ([]byte, error) {
    c.mu.Lock()
    entry := c.data[key]
    c.mu.Unlock()
    if entry == nil { return nil, errNotFound }
    return json.Marshal(entry) // no lock held
}
```

```
BenchmarkUnlockedMarshal-8   200000   8500 ns/op   1200 B/op   18 allocs/op
```

~5× faster under 8-way contention (single-threaded numbers are identical — the win is in not blocking peers).

**Why faster:** Holding the lock during marshal serializes 8 goroutines on a 50-us-per-op operation, capping throughput at ~20k/s. Narrowing the critical section to a pointer fetch (~50 ns) means the lock is held 1000× less time; goroutines marshal in parallel. The total work is the same; the *blocking* drops by 1000×.
**Trade-off:** `entry` must be safe to read outside the lock. If `Entry` has fields mutated by other goroutines (counters, last-updated), you race. Fixes: deep-clone inside the lock, mark `Entry` immutable post-insert, or wrap its mutable fields in atomics. Failure mode: stale-by-microseconds data in the marshaled output — usually acceptable for read snapshots.
**When NOT:** The work *must* happen atomically with the lookup (e.g., increment counter then read related field — invariant breaks if a writer interleaves). The critical section is already short (< 1 us). Single-threaded code where there's no peer to block.
</details>

---

## 16. When NOT to optimize

`sync` cost dominates only when a primitive is on the hot path of a high-frequency operation across multiple cores. If your mutex is taken once per HTTP request (a few thousand QPS), every optimization here is irrelevant: request-scoped locks in middleware, init-time singletons, occasional config reloads — `sync` cost is dwarfed by the work it guards.

**Profile first.** Sync overhead has four signatures in a CPU profile: `runtime.semacquire`/`runtime.gopark` → Ex. 1, 2, 3, 6, 7 (contention or wrong primitive); `runtime.mallocgc` on a pool-shaped path → Ex. 5 or 10 (over- or under-pooling); `sync.(*Map).Store` with high allocs/op → Ex. 4 or 12; `runtime.cgoCheckPointer`-free atomics that still cap at ~50 ns/op under 8-way parallel — Ex. 11 (false sharing).

**Common premature optimizations:** sharded mutex (Ex. 2) on a map with < 1k QPS; atomic counter (Ex. 1) where the counter participates in invariants with other fields — atomics break the invariant; replacing channel-based signaling with mutexes (Ex. 6) where you actually needed `select`/cancellation; padding atomics (Ex. 11) on structs allocated by the million; pooling tiny values (Ex. 5) where stack allocation already costs zero; preempting `sync.Once` (Ex. 9) — it's already optimal.

**Correctness gaps disguised as optimizations:** `atomic.Int64` replacing a mutex (Ex. 1) on a counter that's part of a multi-field invariant; sharded mutex (Ex. 2) where snapshot-across-shards forgot to lock in a stable order — deadlock under "snapshot during update"; mutex-protected map (Ex. 4) replacing `sync.Map` where the workload actually was read-mostly with stable keys; `errgroup` (Ex. 7) where workers don't honor `ctx` — first error doesn't cancel siblings; channel close (Ex. 8) where the channel is closed twice — panic; pool of buckets (Ex. 10) where reset forgot a field — leaked state from a previous request; `atomic.Pointer` for config (Ex. 13) where callers mutated the loaded map — data race invisible until production; narrowed critical section (Ex. 14) where the entry was mutated by a writer between unlock and marshal — torn read in the JSON output.

---

## 17. Summary

**Always-ship wins** (default in any new sync-touching code): `atomic.Int64` over `sync.Mutex` for plain counters (Ex. 1); `sync.Mutex` over channel-as-mutex for plain mutual exclusion (Ex. 6); narrow critical sections — never hold a lock across I/O or expensive computation (Ex. 14); `chan struct{}` close for one-shot events (Ex. 8); `errgroup` with disjoint result indices for fan-out with error propagation (Ex. 7); trust `sync.Once` on hot paths (Ex. 9).

**Wins behind a profile** (when measurements justify them): sharded mutex (Ex. 2, when one mutex shows in contention profile under high QPS); switching `RWMutex` to `Mutex` (Ex. 3, when writes dominate); plain map + mutex over `sync.Map` (Ex. 4, when write-heavy with churn); pool tiny objects only if they escape (Ex. 5, after escape analysis confirms heap allocation); pool for genuinely allocation-heavy paths (Ex. 10, when allocator shows in pprof); cache-line padding on contended atomic fields (Ex. 11, when `cache-misses` perf counter spikes); `Load` then `Store` over `LoadOrStore` (Ex. 12, when the second arg is allocation-heavy); `atomic.Pointer` for read-mostly config (Ex. 13, when `RLock` contention shows in 8+ core profiles).

**Specialty** (only when the design calls for it): cache-line-padded shards combined with per-shard pools for high-throughput connection state; `atomic.Pointer` over copy-on-write maps for hot-path config / feature flags; `sync.Cond` only when waiters need predicate checks on each wakeup — otherwise prefer channels; lock-free ring buffers (`golang.org/x/sys/cpu` + careful atomics) for single-producer single-consumer paths where even mutex CAS shows in profiles.

Sync cost is contention, cache-line bouncing, primitive mismatch, and locked work. Strip those four from the read path by choosing the right primitive: atomic for single-word state; mutex for mutual exclusion; channel for signaling and cancellation; `sync.Map` only for read-mostly stable keys; `errgroup` for typed fan-out; `sync.Pool` for genuinely large per-call allocations. The package itself is cheap — the wins come from matching the primitive to the access shape. Profile, then pick the lever; the four signatures above tell you which one.
