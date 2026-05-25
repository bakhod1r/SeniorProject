# Mutex and Block Profiling — Optimize

## 1. The decision tree

You have a confirmed contention bottleneck (the profile points at it; the diff against the fix shows improvement is possible). Reach for fixes in this order:

1. **Shrink the critical section** — move work outside the lock.
2. **Replace the primitive** — `Mutex` → `RWMutex` if reads dominate; `RWMutex` → atomic snapshot if reads vastly dominate.
3. **Shard the state** — multiple locks each guarding a subset.
4. **Eliminate the shared state** — per-goroutine or per-P storage.
5. **Switch to a lock-free structure** — `atomic.Pointer[T]` copy-on-write or specialised types.
6. **Redesign the boundary** — use channels for ownership transfer, eliminate the shared structure entirely.

Each step gives up something (complexity, semantics, generality). Don't skip steps.

---

## 2. Shrinking the critical section

The single highest-yield fix. Audit every `Lock()`/`Unlock()` pair and ask: "what's the smallest thing this region must protect?"

Before:
```go
func (s *Service) Handle(req Request) Result {
    s.mu.Lock()
    defer s.mu.Unlock()

    data := s.cache[req.Key]
    result := expensiveCompute(data, req) // 5 ms
    s.metrics[req.User]++
    return result
}
```

After:
```go
func (s *Service) Handle(req Request) Result {
    s.mu.Lock()
    data := s.cache[req.Key]
    s.mu.Unlock()

    result := expensiveCompute(data, req) // outside lock

    s.mu.Lock()
    s.metrics[req.User]++
    s.mu.Unlock()

    return result
}
```

Two short critical sections with no work between them. The mutex profile's delay attributed to this function should drop by `compute_duration × qps`.

Watch out for **races** the split creates: if `expensiveCompute` mutates `data`, you've turned a safe code path into a corrupt one. Copy what you need under the lock, work on the copy.

---

## 3. `Mutex` → `RWMutex` when reads dominate

If 95%+ of operations are reads:

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]Value
}

func (c *Cache) Get(k string) Value {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.m[k]
}

func (c *Cache) Put(k string, v Value) {
    c.mu.Lock()
    c.m[k] = v
    c.mu.Unlock()
}
```

The block profile shifts shape: readers no longer queue behind each other. Writers still cause read-starvation while pending, but with rare writes this is a small effect.

`RWMutex` has overhead even for `RLock` — atomic increment, two writes. For very short critical sections (e.g., reading a single field), a plain `Mutex` may actually be faster because of the lower constant per call. Measure.

---

## 4. Copy-on-write with `atomic.Pointer[T]`

When reads vastly dominate (1000:1 or more) and the data is rebuildable, eliminate read locks entirely:

```go
type Config struct {
    Routes map[string]Handler
}

type Server struct {
    cfg atomic.Pointer[Config]
}

func (s *Server) Lookup(path string) Handler {
    return s.cfg.Load().Routes[path]   // no lock
}

func (s *Server) Reload(c *Config) {
    s.cfg.Store(c)                     // one atomic write
}
```

Trade-offs:

- Readers observe a **stable snapshot** for the duration of a single `Load()`. No torn reads.
- Writes are atomic but **wholesale**: incremental update means rebuilding the whole structure.
- Memory transiently doubles during a swap.
- The previous `Config` lingers until no `Load()` user holds it.

Pattern matches: routing tables, feature flag stores, schema registries, throttling configs. Anti-pattern: anything with high write frequency.

---

## 5. Sharding (per-bucket lock)

A single map with one lock is the textbook contention case. Shard:

```go
const shardCount = 32

type ShardedMap struct {
    shards [shardCount]struct {
        mu sync.Mutex
        m  map[string]Value
    }
}

func (s *ShardedMap) shard(k string) *struct {
    mu sync.Mutex
    m  map[string]Value
} {
    h := fnv1a(k)
    return &s.shards[h%shardCount]
}

func (s *ShardedMap) Get(k string) (Value, bool) {
    sh := s.shard(k)
    sh.mu.Lock()
    v, ok := sh.m[k]
    sh.mu.Unlock()
    return v, ok
}

func (s *ShardedMap) Put(k string, v Value) {
    sh := s.shard(k)
    sh.mu.Lock()
    sh.m[k] = v
    sh.mu.Unlock()
}
```

Notes:

- Use a fast hash with good distribution (`fnv1a`, `xxhash`). A bad hash collapses all keys onto one shard.
- Choose `shardCount` ≥ `GOMAXPROCS × 2`. Power-of-two count lets the compiler turn `%` into a mask.
- Cross-shard iteration is now O(shards × shard ops); be careful with `Range`-like methods.
- Memory footprint is `shardCount` × overhead. For 32 shards, that's negligible.

The mutex profile after sharding has the same shape but with delays divided by approximately `min(shardCount, parallelism)`.

---

## 6. `sync.Map` — the read-mostly specialist

```go
var m sync.Map

m.Store(k, v)
v, ok := m.Load(k)
m.Delete(k)
m.Range(func(k, v any) bool { ... ; return true })
```

Internals: two maps — a read-only `read` view atomic-pointered for fast reads, and a dirty mutable `dirty` view behind a mutex. A read hits `read` first (no lock); a miss escalates to `dirty` (locked).

Use when:

| Pattern | `sync.Map` wins |
|---------|-----------------|
| Keys disjoint across goroutines | Yes (per-goroutine accumulators) |
| Many readers, rare writers (cache) | Yes |
| Balanced read/write | **No** — sharded map is faster |
| Write-mostly | **No** |
| Need typed values | **No** — `sync.Map` uses `any`; consider a generic sharded type |

`sync.Map` is the right answer surprisingly rarely. The vast majority of Go code that "should use `sync.Map`" really should use either a regular map with a `Mutex` (simple, fastest for small N) or a sharded map (best for many concurrent writers).

---

## 7. Atomics for counters and flags

Replace mutex-protected scalars with `sync/atomic`:

| Want | Use |
|------|-----|
| Counter (monotonic add) | `atomic.AddInt64` / `atomic.Int64.Add` |
| Latest value (single writer or last-wins) | `atomic.LoadX` / `atomic.StoreX` |
| CAS (compare-and-swap) | `atomic.CompareAndSwap...` |
| Pointer swap (CoW) | `atomic.Pointer[T]` |
| Boolean flag | `atomic.Bool` |

The `atomic.X` typed structs (Go 1.19+) prevent the field-alignment footgun (`int64` on 32-bit systems must be 8-byte aligned). Prefer them over the raw functions.

Atomics don't appear in mutex/block profiles. They do appear in CPU profiles as a small constant cost per call. A workload moving from a mutex-protected counter to `atomic.Int64` typically sees: mutex profile drops to zero on this path, CPU profile gains ~3 ns/op for the atomic.

---

## 8. Per-P / per-goroutine accumulators

For high-frequency counter increments, even atomic adds get expensive on many cores due to **cache line contention**. The CPU's MESI protocol bounces the line between cores. The fix is to **eliminate sharing** during the hot path:

```go
type Counter struct {
    cells [numCells]struct {
        v atomic.Int64
        _ [64 - 8]byte // pad to one cache line
    }
}

func (c *Counter) Add(n int64) {
    // pick a cell based on the current P or goroutine ID
    idx := runtime_procPin() % numCells
    runtime_procUnpin()
    c.cells[idx].v.Add(n)
}

func (c *Counter) Sum() int64 {
    var s int64
    for i := range c.cells {
        s += c.cells[i].v.Load()
    }
    return s
}
```

Real Go doesn't expose `runtime_procPin` directly — that's runtime-internal. The practical equivalents:

- Use `golang.org/x/sys/cpu` or a fast hash of `goroutine_id`.
- Use [`@hsanjuan/atomic-counters`](https://github.com/uber-go/atomic) or similar libraries.
- For benchmarks, `pcg_random()` modulo numCells distributes well.

Trade-off: reads are now O(numCells). For counters reported once per second to a monitor, that's free.

---

## 9. Channels for ownership transfer

If the contention is "many goroutines mutate one object", flip the design: one goroutine owns the object, others send it work over a channel.

Before (contended):
```go
var (
    mu    sync.Mutex
    state State
)

func update(req Update) {
    mu.Lock()
    state.Apply(req)
    mu.Unlock()
}
```

After (single-owner):
```go
type updateMsg struct {
    req  Update
    resp chan struct{}
}

var updates = make(chan updateMsg, 1024)

func init() {
    go func() {
        var state State
        for m := range updates {
            state.Apply(m.req)
            close(m.resp)
        }
    }()
}

func update(req Update) {
    msg := updateMsg{req: req, resp: make(chan struct{})}
    updates <- msg
    <-msg.resp
}
```

The mutex contention is gone; you have a single goroutine processing updates serially. The block profile now shows time on `updates <- msg`. That's expected — it's the same waiting, made explicit. Wins:

- The owning goroutine doesn't need locks.
- Easier to reason about correctness.
- Easier to add batching (read multiple `updateMsg` in one go).

Costs:

- One extra goroutine per actor.
- Latency floor of one scheduler hop.
- Channel can saturate (back-pressure).

Use this pattern when the data has natural single-owner semantics: state machines, in-memory queues, connection-per-actor services.

---

## 10. `sync.Pool` to remove allocator contention

`sync.Pool` is also a contention reducer. Without a pool, every allocation hits the per-P `mcache` — fast, but `mcache` refills hit `mcentral` which is locked. A pool keeps the hot path entirely within the P:

```go
var bufPool = sync.Pool{
    New: func() any { return make([]byte, 0, 4096) },
}

func handle(req []byte) {
    buf := bufPool.Get().([]byte)[:0]
    defer bufPool.Put(buf)
    buf = append(buf, req...)
    process(buf)
}
```

In a profile, this shows as:

- The `runtime.mcache_refill` or `runtime.lock`-related mutex profile entries shrink.
- The CPU profile's `runtime.mallocgc` shrinks proportionally.

Pool contents are dropped on GC, so the pool is a *hint*, not a cache. Don't put oversized values back — that pin's memory until the next GC.

---

## 11. Avoiding false sharing

When two unrelated atomic variables sit on the same 64-byte cache line, writes to one invalidate the line for the other. Profiles can't see this — it shows up as "atomics inexplicably slow on multi-core".

```go
type Counter struct {
    a atomic.Int64   // bytes 0..7
    b atomic.Int64   // bytes 8..15 — shares the cache line with a
}
```

Two goroutines hammering `a` and `b` respectively will compete for the line. Fix with padding:

```go
type Counter struct {
    a atomic.Int64
    _ [56]byte       // pad a to one full cache line
    b atomic.Int64
    _ [56]byte
}
```

Or with `golang.org/x/sys/cpu.CacheLinePad`. Confirm with a benchmark before and after — false sharing typically gives a 2–4× speedup when present.

---

## 12. Lock-free queues — when to and not to

Specialised lock-free data structures (MPSC queues, ring buffers) exist in libraries like `chan` (built-in), `nsq.io/go-diskqueue`, `lockfree.com/lockfree`. They eliminate explicit mutex contention but add complexity.

**Use when:**

- Single-producer-single-consumer fits the use case.
- Throughput requirement is in tens of millions of ops/sec.
- You've measured channels and they're the bottleneck.

**Don't use when:**

- A buffered channel handles your throughput.
- Multiple producers/consumers — MPMC lock-free is genuinely hard.
- The code will be maintained by someone other than you.

A buffered `chan T` of size 1024 handles millions of ops/sec on a modern machine. The number of services that need anything fancier is small.

---

## 13. Optimisation in context: `RWMutex.RLocker()` and bookkeeping

A common optimisation oversight: `sync.RWMutex` has the `RLocker()` method returning a `Locker` for the read side. Sometimes you can pass that to a `sync.Cond`:

```go
var (
    mu  sync.RWMutex
    c   = sync.NewCond(mu.RLocker())
)
```

This lets waiters use the read lock while waiting on a condition variable, reducing writer contention. Niche, but real.

Other small wins:

- Replace `bytes.Buffer` with `strings.Builder` when you only need a string (no concurrency).
- Replace `time.Now()` inside a critical section with `time.Now()` outside — the call is cheap but the holding-time isn't.
- Inline trivial wrappers: a function that just takes a lock and calls another function adds depth to your contention stacks.

---

## 14. Measuring the fix

Every fix gets a before/after profile:

```bash
go tool pprof -base before-mutex.pb.gz after-mutex.pb.gz
```

Three outcomes:

| Diff result | Meaning |
|-------------|---------|
| Target stack: large negative delta, others ≈ 0 | Clean win; ship it |
| Target: negative; another stack grew | You moved contention; understand where before shipping |
| Target: no change | Your fix didn't address the real bottleneck; reread the original profile |

A "moved contention" outcome is common with sharding: per-shard contention drops but writer-of-shard-N became the new top stack. Sometimes that's progress, sometimes it's the wrong shape.

---

## 15. Summary

The contention-reduction toolkit, ordered: shrink the critical section, switch primitives (`RWMutex`, `atomic.Pointer`, `sync.Map`), shard, eliminate sharing (per-P, channels), apply lock-free where measurements justify it, and watch for false sharing. Each fix is followed by a diff capture; "moved contention" is real and easy to miss. The deepest fix is usually the design one: rethink which goroutine owns the data, not how to lock it.

---

## Further reading
- `sync` source: https://github.com/golang/go/tree/master/src/sync
- Dmitry Vyukov on lock-free algorithms: http://www.1024cores.net/
- `golang.org/x/sync/singleflight` — collapse duplicate work: https://pkg.go.dev/golang.org/x/sync/singleflight
- `uber-go/atomic` for ergonomic atomics: https://github.com/uber-go/atomic
