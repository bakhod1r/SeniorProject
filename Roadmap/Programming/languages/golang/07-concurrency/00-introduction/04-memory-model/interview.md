# Memory Model — Interview Questions

> Questions from junior to staff. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is a data race?

**Model answer.** A data race is when two goroutines concurrently access the same memory location, at least one of them writes, and there is no synchronisation between them. Per the Go memory model, a program with a data race has undefined behaviour: the compiler may produce code that crashes, returns wrong values, or appears to work until a different build or hardware exposes the bug.

**Common wrong answers.**
- "Two threads using the same variable." (Two reads with no writes is not a race.)
- "Race condition with timing-dependent results." (That is a race *condition*; a data race is a specific kind.)

**Follow-up.** *How do you fix one?* — Add synchronisation: mutex, atomic, channel, or other primitives that establish happens-before.

---

### Q2. What is happens-before?

**Model answer.** Happens-before is a partial order on memory operations. If event A happens-before event B, then any write A made (or that happened-before A) is visible at B. The Go memory model defines which operations establish happens-before: channel send/receive/close, mutex lock/unlock, atomic operations, `sync.Once.Do`, `sync.WaitGroup.Wait/Done`, and goroutine creation.

**Follow-up.** *Why is it called "partial" order?* — Some events are not ordered relative to each other (they are concurrent). Happens-before only orders events tied by synchronisation; everything else is unordered.

---

### Q3. What does `go test -race` do?

**Model answer.** It compiles the test binary with race-detection instrumentation. The runtime tracks memory accesses and happens-before relationships. When it detects an unsynchronised concurrent access, it reports the location and both stack traces.

The race detector catches races that occur during the test run. It does not catch races in untested code paths.

**Follow-up.** *Why not run with `-race` in production?* — It is 2–10x slower and uses 5–10x more memory.

---

### Q4. What's wrong with this code?

```go
var x int
go func() { x = 42 }()
fmt.Println(x)
```

**Model answer.** Data race. The main goroutine reads `x` while the spawned goroutine writes. No synchronisation. The race detector flags it. The output is undefined: 0, 42, or in theory anything else (the compiler may even optimise the read away).

**Fix.**

```go
done := make(chan struct{})
var x int
go func() {
    x = 42
    close(done)
}()
<-done
fmt.Println(x)
```

The channel close establishes happens-before between the write and the read.

---

### Q5. What is the difference between `sync.Mutex` and `sync.RWMutex`?

**Model answer.** `sync.Mutex` allows one goroutine into the critical section at a time. `sync.RWMutex` allows either many readers (via `RLock`/`RUnlock`) or one writer (via `Lock`/`Unlock`) — but not both. `RWMutex` is useful when reads vastly outnumber writes, allowing parallelism among readers.

**Follow-up.** *When is `Mutex` better?* — When reads and writes are roughly balanced, or when contention is low. `RWMutex` has higher per-operation overhead than `Mutex`.

---

### Q6. What does `atomic.AddInt64` do?

**Model answer.** It atomically adds a value to an `int64` memory location and returns the new value. The read-modify-write is indivisible — no other goroutine sees a partial state. The operation also establishes happens-before with other atomic operations on the same variable.

**Follow-up.** *Is `counter++` atomic for an `int64`?* — No. It is read, modify, write — three operations, not atomic.

---

## Middle

### Q7. What guarantees does a channel send/receive provide?

**Model answer.** Per the Go memory model:

- A send on a channel is synchronised-before the corresponding receive completes.
- A receive from a closed channel is synchronised-after the close.
- For a buffered channel of capacity C, the kth receive is synchronised-before the (k+C)th send completes.

In simpler terms: anything written before a send is visible after the receive. Closing a channel broadcasts to all receivers.

---

### Q8. When would you use `atomic.Value` instead of a mutex?

**Model answer.** `atomic.Value` is for atomic swap of an entire value, typically a pointer. Use it when:

- Reads are frequent and writes are rare.
- The value is immutable after publication.
- You want lock-free reads.

Example: hot configuration that changes occasionally. Readers do `cfg.Load().(*Config)`; writers do `cfg.Store(newCfg)`. Reads are nearly free; writes are atomic.

**Constraint.** All stored values must be of the same concrete type.

**Follow-up.** *What's better since Go 1.19?* — `atomic.Pointer[T]` is type-safe via generics. Prefer it over `atomic.Value`.

---

### Q9. What is the difference between `sync.Once` and `sync.OnceFunc`?

**Model answer.** `sync.Once` is a struct with a `Do(func())` method that runs its argument exactly once. `sync.OnceFunc` (Go 1.21+) is a higher-level helper that takes a function and returns a wrapped version that runs the original only once.

```go
init := sync.OnceFunc(func() { setup() })
init() // calls setup
init() // does nothing
```

Both have the same happens-before semantics: the first execution is synchronised-before any return from a subsequent call.

---

### Q10. Explain why `concurrent map writes` panics.

**Model answer.** Go's built-in map is not safe for concurrent writes. The runtime detects concurrent map writes via internal bookkeeping (a write flag set during operations) and panics with "fatal error: concurrent map writes." This is intentional: the alternative is silent corruption.

The race detector also catches concurrent map operations. The panic is a backup for non-`-race` builds.

**Fix.** Use `sync.Mutex` for explicit synchronisation, or `sync.Map` for built-in concurrency safety.

---

### Q11. What is `sync.Map` and when should you use it?

**Model answer.** `sync.Map` is a goroutine-safe map. Its read path is lock-free for keys present at last update; updates are mutex-protected. Designed for read-mostly workloads.

Use when:
- Many concurrent reads, few writes.
- Keys mostly persist (not constantly created and deleted).

Avoid when:
- Many concurrent writes (mutex-based map is comparable).
- Keys constantly created/deleted (sync.Map's copy-on-write overhead grows).
- You need typed values (sync.Map uses `interface{}`).

---

### Q12. What does `sync.Pool` do?

**Model answer.** `sync.Pool` is a per-goroutine cache of reusable objects. It is *not* a synchronisation primitive — it is a memory-allocation helper. Each P (logical processor) has its own local pool; the runtime periodically clears them (at every GC).

Typical use: reusable buffers in hot paths.

```go
var pool = sync.Pool{New: func() interface{} { return new(Buffer) }}

buf := pool.Get().(*Buffer)
defer pool.Put(buf)
```

Reduces allocation pressure.

**Follow-up.** *What is a common misuse?* — Using `sync.Pool` for objects that have non-trivial cleanup. Since the runtime can clear the pool at any time, items are not guaranteed to be reused.

---

## Senior

### Q13. Describe how you would design a race-free hot-reload config.

**Model answer.** Use `atomic.Pointer[Config]` (or `atomic.Value`).

```go
var cfg atomic.Pointer[Config]

func init() {
    cfg.Store(loadConfig())
}

func reload() {
    cfg.Store(loadConfig())
}

func currentConfig() *Config {
    return cfg.Load()
}
```

Readers call `currentConfig()` — a single atomic load, lock-free. Writers call `reload()` — atomic store. The `*Config` is immutable: never modified after publication.

The discipline: treat the returned `*Config` as read-only. To "change" a setting, build a new `*Config` and store.

**Follow-up.** *What if Config has slices or maps?* — Treat them as immutable. Reading them is safe. Modifying them is a race (mutation after publication). On reload, construct fresh slices/maps.

---

### Q14. How would you implement a concurrent counter that minimises contention across 32 cores?

**Model answer.** A single atomic counter on 32 cores produces severe cache-line bouncing — the line ping-pongs every increment.

Better: per-CPU (or per-shard) counters with combined read.

```go
type Counter struct {
    shards [32]struct {
        n atomic.Int64
        _ [56]byte // pad to cache line
    }
}

func (c *Counter) Inc() {
    idx := someShardKey() // e.g., goroutine-derived
    c.shards[idx].n.Add(1)
}

func (c *Counter) Load() int64 {
    var total int64
    for i := range c.shards {
        total += c.shards[i].n.Load()
    }
    return total
}
```

Each goroutine increments its own shard. Reading sums all shards. Trade: cheap writes, slow reads.

For a single increment that does not care about per-shard locality, use the runtime's per-P state via internal tricks — or accept that one atomic counter is fine if updates are infrequent.

---

### Q15. Walk through what synchronisation a `sync.Mutex.Lock()` actually does.

**Model answer.** `Lock` does (simplified):

1. CAS attempt: if the mutex is free, atomically set it to locked. Fast path.
2. If contended: spin briefly hoping the holder releases soon (avoid syscall cost).
3. If still contended: park the goroutine via `runtime.gopark`. The runtime moves to another G.
4. When the holder unlocks (`runtime.semrelease`), the parked goroutine is woken.

The memory model semantics: the `Unlock()` is synchronised-before the next `Lock()` return. Any write before the unlock is visible after the lock.

Internally, mutex uses atomic CAS for the fast path and a runtime semaphore for parking. On uncontended access: ~20 ns.

---

### Q16. What is the cost of `RWMutex.RLock()` vs `Mutex.Lock()` under no contention?

**Model answer.** `RWMutex.RLock` is more expensive than `Mutex.Lock` uncontended. The reason: `RWMutex` must atomically increment the reader count (an atomic add or fetch_add), then verify no writer is waiting. `Mutex` only does one CAS.

Approximate numbers on modern x86:
- `Mutex.Lock` uncontended: ~20 ns.
- `RWMutex.RLock` uncontended: ~40 ns.

Under heavy reader contention, `RWMutex` is much faster because multiple readers proceed in parallel. The crossover depends on workload — for read-mostly workloads with many readers, `RWMutex` wins. For uncontended access or balanced reads/writes, `Mutex` wins.

---

### Q17. How does the race detector decide whether two events are ordered?

**Model answer.** It maintains vector clocks per goroutine. A vector clock is an integer vector with one entry per goroutine.

When goroutine A synchronises with goroutine B (e.g., via a channel send/receive), A's clock receives B's entries (component-wise max). Memory operations are tagged with the current goroutine's clock at the time.

To check if event X happens-before event Y: compare their vector clocks. If X's clock is "smaller-or-equal" (component-wise), then X happens-before Y. Otherwise concurrent — if both touch the same memory and at least one is a write, it is a race.

**Cost.** Storage is O(goroutines) per memory location, plus instrumentation overhead. Vector clock comparison is O(goroutines). In practice, ThreadSanitizer (the underlying library) uses tricks (shadow memory, epoch-based shortcuts) to reduce this.

---

### Q18. Why does Go choose sequentially consistent atomics?

**Model answer.** Several reasons:

1. **Simplicity.** Programmers do not need to learn acquire/release/relaxed orderings. Every atomic op is fully ordered.
2. **Safety.** Less expressive memory orderings make subtle bugs more common (compare to C++).
3. **Predictability.** Performance is consistent across architectures.
4. **Compiler/runtime control.** The Go team can change implementation per platform without breaking semantics.

**Cost.** On weakly-ordered hardware (ARM, RISC-V), seq_cst atomics require explicit fences, making them slower than relaxed atomics would be. The pragmatic answer: for 99% of code, the cost is invisible; the 1% that needs more can drop to unsafe or assembly.

---

## Staff

### Q19. Design the synchronisation strategy for a high-traffic in-memory cache.

**Model answer.** Layered approach:

1. **Sharded map.** N shards (16–64), each a `map[K]V` protected by its own mutex. Hash key to choose shard. Reduces contention by N.
2. **Per-shard `RWMutex`.** Read-mostly workloads benefit; writes block readers within a shard only.
3. **TTL via background goroutine.** A separate goroutine periodically scans for expired entries. Holds the shard lock briefly for each cleanup.
4. **`singleflight` for cache misses.** Concurrent misses for the same key dedupe to one fetch.
5. **Metrics.** Atomic counters for hits, misses, evictions. Per-shard or global.
6. **Hot keys.** If profiling shows one shard dominates, consider per-key locks for the top N keys.

For ultra-high-traffic caches: consider `groupcache`, `ristretto`, `bigcache`, or custom lock-free designs. Each has trade-offs.

---

### Q20. Critique this implementation:

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}
```

**Model answer.** Several concerns:

1. **Mutex for a single int.** Use `atomic.Int64` instead. ~5 ns vs ~20 ns uncontended; much better under contention.
2. **`int` vs `int64`.** On 32-bit ARM, atomic operations on `int` (32-bit) and `int64` differ in alignment requirements. Use `atomic.Int64` explicitly.
3. **No `Load` method.** Callers cannot read the counter safely without external locking.
4. **No documentation.** Is it safe for concurrent use? (Yes, but undocumented.)

**Improved version.**

```go
// Counter is a goroutine-safe int64 counter.
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc() int64 { return c.n.Add(1) }
func (c *Counter) Load() int64 { return c.n.Load() }
func (c *Counter) Reset() int64 { return c.n.Swap(0) }
```

Faster, simpler, more idiomatic.

---

### Q21. How would you write a stress test for a concurrent data structure?

**Model answer.** Multi-layered:

1. **Property-based tests.** Use `pgregory.net/rapid` to generate random operation sequences.
2. **Stress runs.** `go test -race -count=1000 -timeout=10m`.
3. **Adversarial scheduling.** Insert `runtime.Gosched()` in operations to perturb ordering.
4. **High concurrency.** 100+ goroutines hammering the structure.
5. **Goroutine leak detection.** `goleak` ensures no leaks.
6. **Invariant checking.** After each operation, verify invariants (size matches expected, no duplicates, etc.).
7. **Fuzz testing.** `testing.F` for randomised inputs (Go 1.18+).

Example skeleton:

```go
func TestConcurrent(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        n := rapid.IntRange(10, 1000).Draw(t, "n")
        c := New()
        var wg sync.WaitGroup
        for i := 0; i < n; i++ {
            wg.Add(1)
            go func(i int) {
                defer wg.Done()
                c.Op(i)
            }(i)
        }
        wg.Wait()
        if !c.Invariant() {
            t.Fatal("invariant violated")
        }
    })
}
```

---

### Q22. Describe a subtle memory model bug you have encountered.

**Model answer.** Many possible. One common example: "I thought my code was safe because writes are aligned and we are on x86."

```go
var x int32
// Goroutine A:
x = 42

// Goroutine B:
if x == 42 {
    // do something
}
```

On x86, aligned 32-bit reads and writes are naturally atomic. But the Go memory model still says this is a race. The compiler may optimise based on the assumption that there are no races — for example, hoisting `x` out of a loop in B, so B never sees the update.

Even though the hardware would allow it to "work," the language semantics do not. The bug appeared months later when an unrelated compiler upgrade enabled a new optimisation.

Fix: `atomic.Int32` or a synchronisation primitive.

---

### Q23. Walk through how Go's `select` interacts with the memory model.

**Model answer.** A `select` evaluates each case's channel expressions, then waits for at least one channel operation to be ready. When a case fires:

- For a send case: the value is sent on the channel; standard channel-send synchronisation applies.
- For a receive case: the value is received; standard channel-receive synchronisation applies.

The `select` itself does not add new synchronisation beyond what the individual channel operations provide.

**Subtlety.** All channel expressions are evaluated before `select` begins waiting. If you do `select { case x := <-ch: ... }`, the `ch` expression is evaluated to a channel value first. After waiting, only the chosen case's body runs.

**Default case.** Does not synchronise — it just provides a non-blocking path. Use carefully; busy-poll patterns are usually wrong.

---

### Q24. How would you migrate a legacy mutex-heavy package to be more idiomatic?

**Model answer.** Step by step:

1. **Audit.** List every shared state, every mutex, every lock acquisition order.
2. **Identify hot paths.** Profile with `pprof -mutex` and `pprof -block`.
3. **Encapsulate.** Move mutex protection inside types; expose safe methods.
4. **Replace where possible.** Atomic counters, `sync.Map` for concurrent maps, `atomic.Pointer` for pointer publication.
5. **Reduce critical sections.** Move slow work out of locked sections.
6. **Document.** Each public method's concurrency semantics in the doc comment.
7. **Test.** Stress test with `-race -count=N` and `goleak`.
8. **Roll out gradually.** Feature flags for risky changes; compare metrics.

Each step is conservative; you cannot rewrite a concurrent system safely in one pass.

---

### Q25. What's the future of Go's memory model?

**Model answer.** Predictions / observations:

- **Continued formalisation.** The 2022 rewrite was clearer than 2014; further refinements likely.
- **Better tooling.** The race detector continues to improve; static analysis may catch more.
- **Generics interaction.** Generics enable type-safe `atomic.Pointer[T]`, which displaces `atomic.Value`. More such ergonomics ahead.
- **Hardware diversity.** ARM (Apple Silicon, AWS Graviton) makes weakly-ordered hardware more common; the seq_cst choice may show its cost more.
- **Lock-free patterns in the standard library.** `sync.Map` was the first; more may follow.
- **Better error messages.** The race detector's reports could be more actionable.

The fundamentals — happens-before, atomic operations, channels as synchronisation — are stable. Improvements are incremental.

---

## Closing

Memory model interviews probe both theoretical understanding (what is a data race?) and practical skills (how do you debug a flaky test?). Senior interviews dig into design choices and trade-offs.

The most useful preparation is to run the race detector on your own code regularly, see real reports, and fix real bugs. Reading the spec helps; experience helps more.
