# sync/atomic — Optimisation Exercises

> Atomic operations are already the lowest-overhead synchronisation primitive in Go (~2 ns uncontended). The "optimisation" goal here is not faster atomics — it is choosing the right primitive, eliminating contention, and removing unnecessary synchronisation. Each exercise either replaces a slower primitive with `atomic`, or replaces a contended atomic with a contention-free shape.

---

## Principle: Pick the Cheapest Tool for the Job

Approximate costs on modern x86-64, per operation:

| Operation | Uncontended | Contended (16 goroutines) |
|---|---|---|
| Non-atomic memory access | < 1 ns | N/A (would be racy) |
| `atomic.Int64.Load` | ~1 ns | ~1 ns (read-shared cache line) |
| `atomic.Int64.Add` | ~2 ns | ~60 ns (cache-line bounce) |
| `atomic.Int64.CompareAndSwap` | ~2 ns | ~100 ns (with retries) |
| `sync.Mutex` Lock+Unlock | ~15 ns | ~200 ns - 10 µs (with parking) |
| `sync.RWMutex` RLock+RUnlock | ~10 ns | ~100 ns (atomic counter) |
| Channel send/recv (buffered) | ~50 ns | ~100-1000 ns |

The optimisation game is:
- Push hot paths to the fastest primitive.
- Avoid contention via sharding.
- Avoid synchronisation entirely where possible (immutable data, single-goroutine ownership).

---

## Exercise 1 — Replace a Mutex-Guarded Counter With Atomic

**Starting code:**

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

**Optimisation.** Replace with `atomic.Int64`:

```go
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc()         { c.n.Add(1) }
func (c *Counter) Value() int64 { return c.n.Load() }
```

**Win.** 5-10x faster for `Inc` (one CPU instruction vs lock-unlock). The contention curve flattens; multiple goroutines incrementing scale much better.

**Verification.** Benchmark with `b.RunParallel`:

```go
func BenchmarkMutex(b *testing.B) {
    var c Counter
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() { c.Inc() }
    })
}
```

Expect ~3x throughput at 4 goroutines.

---

## Exercise 2 — Shard a Contended Counter

**Starting code:**

```go
var totalRequests atomic.Int64

func handler(...) {
    totalRequests.Add(1)
    serve()
}
```

At 4 goroutines, throughput is fine. At 64 goroutines on a 16-core machine, the counter becomes a bottleneck — every `Add` requires exclusive ownership of one cache line.

**Optimisation.** Shard into one counter per CPU:

```go
const shards = 64

type ShardedCounter struct {
    s [shards]struct {
        v atomic.Int64
        _ [56]byte
    }
}

func (c *ShardedCounter) Add(n int64) {
    idx := shardIndex()
    c.s[idx].v.Add(n)
}

func (c *ShardedCounter) Load() int64 {
    var total int64
    for i := range c.s {
        total += c.s[i].v.Load()
    }
    return total
}
```

**Win.** `Add` becomes contention-free. Throughput scales linearly with goroutine count up to the shard count.

**Trade-off.** `Load` is O(shards). Acceptable for metrics scraped every few seconds; bad for counters read on every operation.

---

## Exercise 3 — Replace `Load`-then-`Store` With `Swap`

**Starting code:**

```go
var pending atomic.Int64

func drain() int64 {
    n := pending.Load()
    pending.Store(0)
    return n
}
```

**Bug.** Between `Load` and `Store`, increments can be lost. The `drain` reads `n`, then a producer adds 5, then `drain` writes 0 — the 5 is gone.

**Optimisation.** Use `Swap`:

```go
func drain() int64 {
    return pending.Swap(0)
}
```

**Win.** Atomic snapshot-and-reset. No lost updates. Also one operation instead of two — a small performance bonus.

---

## Exercise 4 — Replace CAS Loop With `Add` Where Possible

**Starting code:**

```go
for {
    old := counter.Load()
    if counter.CompareAndSwap(old, old+1) {
        break
    }
}
```

**Optimisation.** If the update is `+delta`, use `Add`:

```go
counter.Add(1)
```

**Win.** One instruction instead of a loop. Under contention, the CAS loop retries; `Add` does not — the CPU hardware retries internally at the cache-coherence level, which is faster.

Use CAS only when the update is non-trivial (max-update, conditional update, pointer publication). Use `Add` for counters.

---

## Exercise 5 — Pre-Build the Replacement in Copy-on-Write

**Starting code:**

```go
var cfg atomic.Pointer[Config]

func reload() {
    cfg.Store(&Config{})
    cfg.Load().Endpoints = loadEndpoints() // BUG — race, and slow
}
```

**Bug** (covered in `find-bug.md`): mutation after publication.

**Optimisation.** Build the full struct before publishing:

```go
func reload() {
    newCfg := &Config{
        Endpoints: loadEndpoints(),
        Timeout:   loadTimeout(),
    }
    cfg.Store(newCfg)
}
```

**Win.** Correct, and fewer operations. No partial updates visible to readers.

---

## Exercise 6 — Cache-Line Padding to Eliminate False Sharing

**Starting code:**

```go
type Stats struct {
    requests atomic.Int64
    errors   atomic.Int64
}
```

Both fields fit in one 64-byte cache line. If `requests` is incremented by goroutine A on core 1 and `errors` by goroutine B on core 2, the line ping-pongs between caches even though the variables are independent.

**Optimisation.** Pad to separate cache lines:

```go
type Stats struct {
    requests atomic.Int64
    _        [56]byte
    errors   atomic.Int64
    _        [56]byte
}
```

**Win.** No false sharing. Each field lives on its own cache line; updates are independent. Measurable improvement at high concurrency (> 4 cores writing simultaneously).

**Trade-off.** Memory cost: 64 bytes per atomic instead of 8. Acceptable for hot counters; wasteful for thousands of cold counters.

---

## Exercise 7 — Replace `atomic.Value` with `atomic.Pointer[T]`

**Starting code:**

```go
var cfg atomic.Value

func reload(c *Config) { cfg.Store(c) }

func current() *Config {
    if v := cfg.Load(); v != nil {
        return v.(*Config)
    }
    return nil
}
```

**Optimisation.** Use the typed atomic pointer:

```go
var cfg atomic.Pointer[Config]

func reload(c *Config) { cfg.Store(c) }
func current() *Config { return cfg.Load() }
```

**Wins.**

1. Compile-time type safety. No type-mismatch panic at runtime.
2. No interface dance. `atomic.Value.Load` returns `any` and requires a type assertion; `atomic.Pointer[T].Load` returns `*T` directly.
3. Slightly faster — no two-word interface handling.
4. Nil is allowed. `atomic.Value.Store(nil)` panics; `atomic.Pointer[T].Store(nil)` is fine.

---

## Exercise 8 — Use Go 1.23 `Or`/`And` Instead of CAS Loops

**Starting code:**

```go
var flags atomic.Uint32

func setFlag(f uint32) {
    for {
        old := flags.Load()
        if flags.CompareAndSwap(old, old|f) {
            return
        }
    }
}

func clearFlag(f uint32) {
    for {
        old := flags.Load()
        if flags.CompareAndSwap(old, old&^f) {
            return
        }
    }
}
```

**Optimisation (Go 1.23+).** Use the new bitwise atomic operations:

```go
func setFlag(f uint32)   { flags.Or(f) }
func clearFlag(f uint32) { flags.And(^f) }
```

**Win.** One CPU instruction (`LOCK OR`, `LOCK AND` on x86) instead of a CAS loop. Faster, especially under contention where the CAS retries multiply.

If you cannot use Go 1.23, the CAS loop is the correct fallback.

---

## Exercise 9 — Avoid Atomic Through Goroutine-Local State

**Starting code:**

```go
var totalProcessed atomic.Int64

func worker(items <-chan Item) {
    for it := range items {
        process(it)
        totalProcessed.Add(1) // hot, contended
    }
}
```

**Optimisation.** Maintain a goroutine-local count, merge at the end:

```go
var totalProcessed atomic.Int64

func worker(items <-chan Item) {
    var local int64
    for it := range items {
        process(it)
        local++
    }
    totalProcessed.Add(local) // one atomic at the end
}
```

**Win.** From one atomic per item to one atomic per goroutine. For a million items processed by 8 workers, this is 8 atomics vs 1 million. The local `local++` is a single register increment — essentially free.

**Caveat.** The global counter is no longer live during processing. If a metrics scraper wants the count mid-flight, this approach hides progress. Choose based on whether you need real-time visibility.

For a hybrid, periodically merge:

```go
const batchSize = 1000
var local int64
for it := range items {
    process(it)
    local++
    if local == batchSize {
        totalProcessed.Add(local)
        local = 0
    }
}
totalProcessed.Add(local)
```

One atomic per 1000 items. The visible count lags by at most batchSize.

---

## Exercise 10 — Profiling Atomic Hot Paths

**Starting code:**

```go
type Service struct {
    requests atomic.Int64
    cfg      atomic.Pointer[Config]
}

func (s *Service) handle(r Request) {
    s.requests.Add(1)
    cfg := s.cfg.Load()
    process(r, cfg)
}
```

**How to profile.**

```bash
go test -bench=. -cpuprofile=cpu.out
go tool pprof cpu.out
(pprof) top
(pprof) list handle
```

If `requests.Add` shows up in the top, you have a hot counter. Options:
- Shard (Exercise 2).
- Move to a goroutine-local + merge (Exercise 9).
- Accept the cost if it is a small fraction.

If `cfg.Load` shows up significantly, you have a hot read of a pointer. `atomic.Pointer[T].Load` is essentially a `MOV` on x86; if it dominates, something is unusual. Inspect:
- Is the function being inlined? `-gcflags='-m'` reports.
- Is the call going through an interface (Exercise 12)?

**Win.** Profiling identifies which atomic ops are actually hot. Most atomic ops are not bottlenecks; do not waste time optimising the ones that are not.

---

## Exercise 11 — Cap CAS-Loop Retries Under Pathological Contention

**Starting code:**

```go
for {
    old := x.Load()
    new := slowTransform(old)
    if x.CompareAndSwap(old, new) {
        break
    }
}
```

If `slowTransform` is expensive and contention is high, every retry wastes the slow computation. Under pathological contention, the loop may not terminate in any reasonable time.

**Optimisation.** Cap retries; fall back to a mutex:

```go
const maxRetries = 16

for i := 0; i < maxRetries; i++ {
    old := x.Load()
    new := slowTransform(old)
    if x.CompareAndSwap(old, new) {
        return
    }
}

mu.Lock()
defer mu.Unlock()
old := x.Load()
x.Store(slowTransform(old))
```

**Win.** Pathological cases fall back to deterministic mutex behaviour. Common case still benefits from lock-free.

**Caveat.** This pattern is rare. Most CAS loops succeed in 1-2 iterations. The retry cap is for code that has profiled badly under contention.

---

## Exercise 12 — Avoid Interface Dispatch on Atomic Methods

**Starting code:**

```go
type Counter interface {
    Inc()
}

type atomicCounter struct{ n atomic.Int64 }
func (c *atomicCounter) Inc() { c.n.Add(1) }

func process(c Counter) {
    for i := 0; i < 1e6; i++ {
        c.Inc() // interface dispatch
    }
}
```

**Optimisation.** Pass the concrete type:

```go
func process(c *atomicCounter) {
    for i := 0; i < 1e6; i++ {
        c.Inc() // direct call; inlined; emits LOCK XADDQ inline
    }
}
```

**Win.** Removes interface vtable lookup (~3 ns) per call. For a hot path of 1M iterations, this saves 3 ms total. The compiler also inlines `Inc` and emits the atomic instruction directly — no function call.

**Trade-off.** Loses interface flexibility. If you need to swap counter implementations, keep the interface and accept the cost. If the implementation is fixed, the concrete type wins.

---

## Exercise 13 — Use Per-CPU `runtime.NumCPU` for Shard Count

**Starting code:**

```go
const shardCount = 64 // arbitrary
```

**Optimisation.** Match the actual hardware:

```go
var shardCount = runtime.NumCPU()
```

Or round up to a power of 2 for masking:

```go
var shardCount = nextPow2(runtime.NumCPU())
```

**Win.** No wasted shards (on small machines), no excess contention (on large machines). The exact match between shards and cores eliminates the "two goroutines on the same core sharing a shard" pathology.

**Caveat.** `runtime.NumCPU` returns the OS view of cores, not the Go runtime's `GOMAXPROCS`. Usually the same; in containers they may differ. Honour `GOMAXPROCS` if your workload is GOMAXPROCS-bound.

---

## Exercise 14 — Lazy Atomic Reset

**Starting code:**

```go
var counter atomic.Int64

func report() int64 {
    n := counter.Load()
    counter.Store(0)
    return n
}
```

**Bug** (covered in Exercise 3): lost updates between Load and Store.

**Optimisation.** Use `Swap`:

```go
func report() int64 {
    return counter.Swap(0)
}
```

**Win.** Atomic snapshot-and-reset. Also one operation instead of two.

This is Exercise 3 repeated because the pattern is so common it deserves emphasis. Every time you see "Load then Store(0)" in production code, replace it with `Swap(0)`.

---

## Exercise 15 — Eliminate Atomic Where Single-Goroutine Owns the Variable

**Starting code:**

```go
type Producer struct {
    sent atomic.Int64
}

func (p *Producer) Run() {
    for {
        msg := nextMessage()
        send(msg)
        p.sent.Add(1)
    }
}

func (p *Producer) Sent() int64 { return p.sent.Load() }
```

The producer is the *only* goroutine writing `sent`. Why atomic?

**Optimisation.** Use a plain `int64`, but ensure `Sent()` reads safely. Options:

1. Accept stale reads — `Sent()` is for a periodic metric. Use a plain `int64` written by the producer and a periodic snapshot via a channel:

```go
type Producer struct {
    sent int64 // owned by Run
    snapshotCh chan int64
}

func (p *Producer) Run() {
    var localSent int64
    for {
        select {
        case msg := <-...:
            send(msg)
            localSent++
        case p.snapshotCh <- localSent:
        }
    }
}
```

Run loops on a select that either processes a message or replies to a snapshot request. The variable `localSent` is owned by Run. Readers ask via the channel.

2. Use atomic, accept the cost. Often the right answer — atomic is cheap.

**Win.** Approach 1 makes ownership explicit; the variable is purely goroutine-local. The atomic disappears. Approach 2 is simpler and rarely costs anything.

The lesson: question whether you need an atomic at all. If a single goroutine writes and others only read for monitoring, a snapshot channel can replace the atomic.

---

## Exercise 16 — Inline-Friendly Atomic Methods

**Starting code:**

```go
func (c *Counter) Inc() {
    log.Trace("counter inc")  // BUG — defeats inlining
    c.n.Add(1)
}
```

**Optimisation.** Remove logging from the hot path:

```go
func (c *Counter) Inc() { c.n.Add(1) }
```

**Win.** The `Inc` function is small enough to inline. The compiler emits `LOCK XADDQ` directly at the call site. With the log call, the function is too large to inline and every `Inc` is a function call (~3 ns extra).

Generally: keep atomic-wrapping methods one-liners. Logging belongs in slow paths, not hot atomic increments.

---

## Exercise 17 — Choose Read-Friendly vs Write-Friendly Layouts

**Starting code (read-heavy):**

```go
type Cache struct {
    data atomic.Pointer[map[string]int]
}

// Update is rare; reads are many.
```

For read-heavy workloads, the copy-on-write `atomic.Pointer` shines: reads are lock-free, writes pay an allocation.

**Starting code (write-heavy):**

```go
type Tally struct {
    n atomic.Int64
}

// Add is constant; reads are rare.
```

For write-heavy workloads, plain `atomic.Int64.Add` is the right choice. Reading once per second is fine.

**Mid case (balanced read/write):**

For a balanced workload, profile both. `sync.Mutex + map` often wins for balanced map access. For balanced counter access, atomic wins until contention forces sharding.

**Win.** The "right" primitive is workload-dependent. Profile before optimising.

---

## Exercise 18 — Replace Channel Signalling With Atomic Flag

**Starting code:**

```go
done := make(chan struct{})

go func() {
    select {
    case <-done:
        return
    case <-ticker.C:
        work()
    }
}()

close(done)
```

If the worker's `select` already handles ticker events, the channel is fine. But if the worker is in a tight loop:

```go
for {
    select {
    case <-done:
        return
    default:
    }
    work()
}
```

The `select { case <-done: ... default: }` is heavier than necessary. An atomic flag is faster.

**Optimisation.**

```go
var done atomic.Bool

go func() {
    for !done.Load() {
        work()
    }
}()

done.Store(true)
```

**Win.** `atomic.Bool.Load` is ~1 ns; the `select-default` pattern is ~5-10 ns. For a tight inner loop, atomic wins.

**Caveat.** If the worker is *not* in a tight loop and naturally blocks on a channel anyway, keep the channel. Atomic-flag polling is only better when polling is already what you want.

---

## Exercise 19 — Benchmark Before and After Every Change

Always:

```bash
go test -bench=. -count=10 -benchmem
```

Compare with `benchstat`:

```bash
go install golang.org/x/perf/cmd/benchstat@latest
go test -bench=. -count=10 > old.txt
# make changes
go test -bench=. -count=10 > new.txt
benchstat old.txt new.txt
```

Without measurement, "optimisations" can be regressions. Atomic-related changes especially: the constant-factor changes are small (~ns), and noise can dominate. `benchstat` reports confidence intervals.

**Win.** Verified improvements; no regressions.

---

## Exercise 20 — Know When to Stop

Atomic optimisations have diminishing returns. After:

1. Replacing mutex-guarded counters with atomic.
2. Sharding hot counters.
3. Using the right operation (`Add` not CAS, `Swap` not Load+Store).
4. Eliminating false sharing with padding.
5. Removing atomics in single-goroutine-owned variables.

The atomic cost is usually a small fraction of total CPU. Further optimisation belongs to:

- Algorithm changes (different data structure, better algorithm).
- Reducing work (fewer items processed, smarter caching).
- Eliminating allocations.
- Removing redundant operations.

A 50% improvement to a 2 ns operation saves 1 ns per call. A 10% improvement to a 200 ns operation saves 20 ns. Optimise the big numbers first.

---

## Final Notes

The `sync/atomic` optimisation playbook:

1. **Replace mutex with atomic** for single-variable updates.
2. **Replace CAS with Add/Swap/And/Or** when applicable.
3. **Replace `atomic.Value` with `atomic.Pointer[T]`** for type safety and speed.
4. **Shard hot counters** with cache-line padding.
5. **Goroutine-local accumulation with periodic merge** for hot per-item counters.
6. **Pass concrete types, not interfaces** for atomic-method calls.
7. **Keep wrapper methods one-liners** so the compiler inlines them.
8. **Question whether atomic is needed at all** — single-owner variables do not need it.
9. **Profile before optimising** — most atomic ops are not bottlenecks.
10. **Benchmark with `benchstat`** to validate improvements.

The smallest correct primitive wins. Atomic for one variable, mutex for several, channel for messages. Pick correctly and the rest is constant-factor tuning.
