---
layout: default
title: Interview
parent: Copy-on-Write
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/05-copy-on-write/interview/
---

# Copy-on-Write — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is copy-on-write?

**Model answer.** Copy-on-write (COW) is a concurrency pattern where shared data is never mutated in place. Instead, a writer copies the data, modifies the copy, and atomically publishes a new pointer. Readers always read through a single atomic pointer and never need a lock. In Go, the canonical implementation uses `atomic.Pointer[T]` (Go 1.19+) for the pointer swap and a writer mutex to serialize writers.

**Common wrong answers.**
- "It's a way to make all access lock-free." (Only reads; writers may still lock.)
- "It uses the GC magically." (The GC reclaims old snapshots, but the pattern is explicit.)
- "It avoids all copies." (No — writers copy; that's the point.)

**Follow-up.** *Why not just use a mutex?* — A mutex serializes both reads and writes. COW makes reads wait-free; only writers serialize. For read-mostly workloads, COW is dramatically faster.

---

### Q2. What does this code print?

```go
var p atomic.Pointer[int]
a := 1
p.Store(&a)
b := 2
p.Store(&b)
fmt.Println(*p.Load())
```

**Model answer.** It prints `2`. The second `Store` replaces the pointer. `Load` returns the current value, which is `&b`, and `*&b == 2`.

**Follow-up.** *What if you call `Load` between the two `Store`s?* — You get `1` if before the second Store, `2` if after.

---

### Q3. Why is mutating a published snapshot a bug?

**Model answer.** Once a snapshot is published, other goroutines may read it. If a writer modifies the snapshot's fields after publishing, those writes race with the reads — undefined behavior. The race detector catches this. Always build the new snapshot fully, then publish; never modify after publishing.

**Common wrong answers.**
- "It's not a bug as long as you have a mutex." (Wrong — the mutex doesn't protect existing readers.)
- "The GC handles it." (No, the GC doesn't synchronize concurrent access.)

**Follow-up.** *How do you build a new snapshot safely?* — Copy the old one (deep-copy slices and maps), modify the copy, then Store the new pointer.

---

### Q4. Why do you need a writer mutex if writes are atomic?

**Model answer.** The atomic pointer Store is atomic, but the load-modify-publish sequence is not. Two writers can each Load the same snapshot, each modify their copy, and the second's Store overwrites the first's update — a lost update. A writer mutex serializes the whole sequence to prevent this.

**Follow-up.** *Can you avoid the mutex?* — Yes, with a CAS loop: retry the load-modify-publish if another writer interleaved.

---

### Q5. What is the difference between `atomic.Value` and `atomic.Pointer[T]`?

**Model answer.** Both store a value atomically, but `atomic.Value` (pre-generics) stores an `interface{}`, requiring type assertions on Load and runtime type checking on Store. `atomic.Pointer[T]` (Go 1.19+) is generic and type-safe — no assertions, no boxing. Use `atomic.Pointer[T]` in new code.

**Follow-up.** *Performance difference?* — `atomic.Pointer[T]` is roughly 3-4× faster on Load and Store because it avoids interface boxing and type checks.

---

### Q6. When should you NOT use COW?

**Model answer.** When writes are frequent (more than ~1% of reads), or when the snapshot is large (>100 MB). Write-heavy workloads suffer from amplified garbage. Large snapshots make rebuilds expensive. Use `sync.Map` or a sharded mutex map instead.

**Follow-up.** *What about a single counter?* — Don't use COW for a single integer. Use `atomic.Int64`.

---

### Q7. What is a snapshot?

**Model answer.** A snapshot is an immutable version of the data, identified by a pointer. Once published, no field is mutated. Readers freely access it without synchronization because they know the data won't change underneath them.

**Follow-up.** *What if the snapshot contains a slice?* — The slice header is copied when the struct is copied. The backing array is shared. Writers must allocate a new backing array if they want to modify the slice.

---

## Middle

### Q8. Sketch a thread-safe configuration store using COW.

**Model answer.**

```go
type Config struct {
    LogLevel string
    Hosts    []string
}

type Store struct {
    cur atomic.Pointer[Config]
    mu  sync.Mutex
}

func New(initial *Config) *Store {
    s := &Store{}
    s.cur.Store(initial)
    return s
}

func (s *Store) Get() *Config { return s.cur.Load() }

func (s *Store) Update(fn func(*Config)) {
    s.mu.Lock()
    defer s.mu.Unlock()
    old := s.cur.Load()
    next := *old
    fn(&next)
    s.cur.Store(&next)
}
```

Note: callers of `fn` are responsible for deep-copying slices/maps if they want to modify them.

**Follow-up.** *Why isn't `fn` called inside the atomic store?* — Because the atomic store is a single instruction; you can't run arbitrary code "atomically." The mutex serializes the wider section.

---

### Q9. How would you handle reload errors?

**Model answer.** Validate before publish. If validation fails, return the error and do not call `Store`. The old snapshot remains current. Operators see a metric/log indicating reload failed; the service continues serving the previous config.

```go
func (s *Store) Reload(path string) error {
    next, err := load(path)
    if err != nil { return err }
    if err := validate(next); err != nil { return err }
    s.cur.Store(next)
    return nil
}
```

**Follow-up.** *What if the reload partially succeeded?* — Either fail the whole reload or apply a documented partial-update policy. The default should be "all or nothing."

---

### Q10. How does COW compare to `sync.RWMutex`?

**Model answer.**
- `RWMutex.RLock` costs ~10-30 ns (atomic increment, decrement). Multiple readers contend on the reader count.
- COW Load costs ~1.5 ns (single atomic load). Readers share the cache line with no contention.
- Writers in RWMutex block readers. COW writers don't.
- For 90R/10W workloads, COW is typically 5-10× faster.
- For 50/50 workloads, RWMutex may be comparable or faster (no snapshot rebuild cost).

**Follow-up.** *When does RWMutex make sense?* — When the data is large and you want to mutate in place, or when writes are common.

---

### Q11. How would you handle subscriber notifications on snapshot change?

**Model answer.** Several patterns:
- **Channel-based:** subscribers register channels; on update, non-blocking send to each. Drop on full.
- **Synchronous watcher list:** call subscriber functions inline; risk of slow watchers blocking writers.
- **Edge-triggered:** close a channel on update; subscribers wait on it.
- **Version polling:** subscribers poll the version field.

```go
type Store struct {
    cur     atomic.Pointer[Config]
    mu      sync.Mutex
    ch      chan struct{}
}

func (s *Store) Watch() <-chan struct{} { return s.ch }

func (s *Store) Update(c *Config) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.cur.Store(c)
    close(s.ch)
    s.ch = make(chan struct{})
}
```

**Follow-up.** *What if a subscriber is slow?* — In synchronous mode, it blocks all writers. In channel mode, the update may be dropped. Choose based on requirements.

---

### Q12. How do you ensure snapshot consistency across multiple fields?

**Model answer.** Put the fields in one snapshot struct. One Load gives all fields consistently. If you have two separate atomic pointers, a reader between two Loads can see inconsistent state.

**Follow-up.** *What if the data is hierarchical?* — Use a single snapshot at the top, possibly with embedded sub-snapshots that share pointers across versions.

---

### Q13. How would you measure if COW is the right choice?

**Model answer.** Benchmark all three: COW, RWMutex, sync.Map. Use realistic read/write ratios. Measure:
- Read latency (ns/op).
- Write throughput (ops/sec).
- GC pressure (alloc rate, GC pauses).
- Memory consumption.

If COW reads are faster than RWMutex by 5×+ AND writes are <1% of reads, COW is correct. Otherwise reconsider.

**Follow-up.** *What metrics in production?* — Snapshot version, age, reload success/failure, in-flight readers (via pprof).

---

### Q14. What is a lost update and how do you prevent it?

**Model answer.** Two writers concurrently Load the same snapshot, each modify their copy, and each Store. The second Store overwrites the first writer's changes — the first update is "lost."

Prevention:
- Writer mutex: serializes the whole RMW sequence.
- CAS loop: retries if another writer interleaved.

**Follow-up.** *Why doesn't atomic.Store prevent it?* — Atomic Store is atomic at the instruction level, but the wider sequence (Load + modify + Store) is not. Both writers see the same starting point.

---

### Q15. Can you store the result of `Load` for use later?

**Model answer.** Yes, but understand the tradeoff:
- Stored pointer pins that snapshot in memory until the variable goes out of scope.
- Subsequent updates are invisible to your stored reference.
- For request-scoped use, this is ideal (consistent snapshot for the request).
- For long-running use, periodically re-Load to avoid pinning and to see updates.

**Follow-up.** *When does this cause memory growth?* — When goroutines hold snapshot references for hours and many publishes happen in between.

---

## Senior

### Q16. Sketch how a persistent HAMT enables cheap COW writes.

**Model answer.** A HAMT (hash array-mapped trie) is a tree of nodes, each branching 32 ways indexed by 5 bits of the hash. When you `Set(k, v)`:
- Walk from root to the leaf at depth `log32(N)`.
- Copy only the nodes on this path (a "spine" of ~6 nodes for N=1M).
- All other nodes are shared between old and new tree.

The new HAMT pointer is the new root. Old roots remain valid for in-flight readers.

Per-write cost: `O(log N)` allocations instead of `O(N)`. For N=1M, ~6 nodes instead of 1M entries.

**Follow-up.** *What's the read cost?* — `O(log N)`: walk from root to leaf. For N=1M with branching 32, that's 4-6 array indexings. Slightly slower than Go's built-in map (O(1)) but very cache-friendly.

---

### Q17. Explain RCU and how Go's COW maps to it.

**Model answer.** RCU (read-copy-update) is a Linux kernel synchronization discipline:
1. Readers read with `rcu_read_lock`/`rcu_read_unlock` (usually no-ops).
2. Writers copy + modify + `rcu_assign_pointer` to publish.
3. Writers `synchronize_rcu` to wait for all in-flight readers to finish.
4. Writers `kfree` the old structure.

In Go, the GC handles step 3-4. The GC's reachability analysis is equivalent to RCU's grace period detection. You write the read and write paths; the runtime handles reclamation.

**Follow-up.** *Why does Go not need explicit grace periods?* — Because Go's GC traces from goroutine stacks. A snapshot referenced by a goroutine's local variable is reachable; once the variable is gone, the snapshot becomes unreachable and can be reclaimed.

---

### Q18. Design a sharded COW system for a 1M-entry map with 1K writes/sec.

**Model answer.** 

```go
const NShards = 32

type ShardedStore struct {
    shards [NShards]struct {
        cur atomic.Pointer[map[string]string]
        mu  sync.Mutex
    }
}

func (s *ShardedStore) shardFor(k string) int {
    return int(fnv.Sum32([]byte(k))) % NShards
}

func (s *ShardedStore) Get(k string) (string, bool) {
    v, ok := (*s.shards[s.shardFor(k)].cur.Load())[k]
    return v, ok
}

func (s *ShardedStore) Set(k, v string) {
    sh := &s.shards[s.shardFor(k)]
    sh.mu.Lock()
    defer sh.mu.Unlock()
    old := *sh.cur.Load()
    next := make(map[string]string, len(old)+1)
    for kk, vv := range old { next[kk] = vv }
    next[k] = v
    sh.cur.Store(&next)
}
```

With 32 shards, each has ~31K entries and ~31 writes/sec. Per-write rebuild: ~3 ms. Memory: 32 × ~1 MB = 32 MB live.

**Follow-up.** *How would you do `Range`?* — Iterate all shards; not consistent across shards. Or merge into one snapshot periodically.

---

### Q19. How do you detect snapshot pinning bugs in production?

**Model answer.**
- Track `runtime.NumGoroutine()`. Spikes correlate with stuck goroutines.
- Take heap profiles; look for many live snapshots of the same type.
- Tag goroutines with the snapshot version they hold via `pprof.Labels`; goroutine profile shows distribution.
- Emit `snapshot_age_max` metric across in-flight requests.
- Use the trace tool to see goroutines stuck in handlers.

**Follow-up.** *How do you fix?* — Bound request lifetimes via context deadlines. Periodically re-Load in long-running goroutines.

---

### Q20. Compare COW with MVCC.

**Model answer.**
- Both maintain multiple versions of data, readable concurrently.
- COW is in-memory, granular at the whole snapshot.
- MVCC is database-level, granular per-row or per-key.
- COW reclamation: GC. MVCC reclamation: manual vacuum/compaction.
- COW gives snapshot consistency per Load. MVCC gives transaction-level consistency.
- Both rely on "old versions remain valid for in-flight readers."

**Follow-up.** *Could you implement MVCC on top of COW?* — Yes, at the cost of memory: each row version is a separate object; readers see a consistent set of row versions via snapshot semantics.

---

### Q21. What is the writer mutex's relationship with `atomic.Pointer.Store`?

**Model answer.** The mutex protects the read-modify-write sequence. The atomic Store inside the mutex ensures the publish is atomic with respect to readers. Without the mutex, two writers could race on the RMW. Without the atomic Store, readers could see a torn pointer.

Both are needed for full correctness in concurrent COW.

**Follow-up.** *What if writes are pure (no Load needed)?* — Then no mutex is needed; a Store directly. Common when writers don't depend on the previous snapshot.

---

### Q22. How does the GC affect COW write latency?

**Model answer.** Two ways:
1. **Allocations.** Each snapshot rebuild allocates memory. The allocator path adds ~10 ns per allocation. Snapshots with many small allocations (e.g., HAMT) pay more.
2. **Write barrier.** During concurrent marking, pointer writes invoke a write barrier (~5 ns extra). The barrier is conditional (off most of the time), so the impact depends on how often GC is marking.

For typical workloads, GC adds <10% to COW write latency. For write-heavy workloads at high allocation rates, GC pauses become a concern.

**Follow-up.** *How do you mitigate?* — Persistent structures (fewer allocations), batched writes, smaller snapshots.

---

## Staff

### Q23. Why does Go's memory model give sequentially consistent atomics?

**Model answer.** Sequential consistency is the strongest practical memory model. It gives a single global total order on all atomic operations, simplifying programmer reasoning. The cost is higher hardware fences on weak memory architectures (ARM, RISC-V).

Go's designers chose SC over acquire-release because:
- Simpler mental model.
- Fewer bugs from subtle ordering issues.
- The cost is small on modern hardware.

For COW: SC ensures all atomic operations on the snapshot pointer are coherently ordered across all goroutines, removing entire classes of subtle bugs.

**Follow-up.** *Could Go expose acquire-release in the future?* — Possibly, but the Go team has consistently chosen simplicity over micro-optimization opportunities.

---

### Q24. How would you architect COW for a distributed system with strong consistency?

**Model answer.**
- Local COW for fast reads at each node.
- Raft (or similar consensus) for cross-node coordination.
- Updates: propose to leader, replicate to majority, then apply to local COW on each node.
- Reads: serve from local COW (eventually consistent) or via leader (linearizable).
- Snapshot fetching for new nodes.

The local COW is unchanged in design; the consensus layer ensures all nodes agree on updates.

**Follow-up.** *What about CAP tradeoffs?* — In a partition, you can either reject writes (CP) or accept divergence and reconcile later (AP). Choose based on your application.

---

### Q25. Walk through what happens at the hardware level when you call `atomic.Pointer.Store`.

**Model answer.**
1. Go compiler emits a call to `atomic.StorePointer`.
2. The runtime intrinsic on amd64 emits a `XCHGQ` instruction (provides full-fence semantics).
3. Before XCHG, the write barrier check fires; if GC is marking, it records the new pointer.
4. The XCHG atomically replaces the memory location with the new value.
5. The cache line containing the pointer transitions to Modified on the writer's core; other cores' copies are invalidated (MESI).
6. The next time another core reads this pointer, it fetches the new value from the writer's cache (or main memory).

Total time: ~10 ns on x86, including write barrier overhead and cache coherence traffic.

**Follow-up.** *How does this differ on ARM?* — ARM uses `STLR` (store-release) instead of XCHG. Slightly cheaper but provides the same ordering.

---

### Q26. Design a COW system that minimizes p99 latency for a 250K-req/sec routing layer.

**Model answer.**
- Snapshot: sorted prefix tree (trie) of 50K routes.
- Use `atomic.Pointer[Trie]` for the table.
- Reads: walk trie, O(L) where L is path length.
- Updates: rebuild trie on every change (~5 ms wall time).
- Pin snapshot per request via context.
- Validate before publish.
- Metrics: lookup latency histogram, table version, age.

p99 read latency: ~10 µs (trie walk + 1 atomic load). Updates: ~5 ms. With 1 update per minute, average impact is negligible.

**Follow-up.** *What if updates spike?* — Batch them into a 10-ms window before publishing.

---

### Q27. How do you handle COW for a snapshot that contains a `sync.Map`?

**Model answer.** A `sync.Map` is thread-safe; it can be inside a snapshot. But the whole-snapshot-immutability rule is relaxed: the sync.Map's contents may change after publish.

Use case: snapshot's role is "current sync.Map", which can be wholesale replaced (e.g., for cache clearing). Updates go to the inner sync.Map directly.

This composes the two patterns: COW for snapshot-level replacement, sync.Map for per-key concurrency.

**Follow-up.** *Why not just sync.Map?* — Wholesale clear is fast and atomic with COW; with sync.Map alone you'd have to iterate and delete or rebuild.

---

### Q28. Walk through diagnosing a COW memory leak.

**Model answer.**
1. Observe heap growth in production (Prometheus alert on `go_memstats_alloc_bytes`).
2. Capture heap profile: `curl pprof/heap`.
3. In pprof: `top` shows `*Snapshot` as the biggest live type.
4. `list NewSnapshot` shows where snapshots are constructed.
5. Capture goroutine profile: `pprof/goroutine`.
6. Look for goroutines stuck holding snapshot references — often in handler functions.
7. Identify the hung handler (e.g., a slow downstream call without timeout).
8. Fix: add timeout via context; bound request lifetime.

**Follow-up.** *Could it be the writer's fault?* — Rarely. The writer's old snapshots become unreachable once they Store the new one. Pinning is almost always reader-side.

---

### Q29. When would you choose CAS over a writer mutex?

**Model answer.** Rarely. CAS is appropriate when:
- Many concurrent writers, each performing very short updates.
- You can tolerate retry-induced CPU spikes under contention.
- The `fn` that builds the new value is idempotent and cheap.

For typical COW (1-10 writers, slow rebuilds), a mutex is simpler, predictable, and equally fast.

**Follow-up.** *What about ABA?* — In Go, ABA is essentially impossible because `&next` always allocates a fresh pointer. The CAS won't be fooled.

---

### Q30. How does `weak.Pointer[T]` (Go 1.24+) change COW patterns?

**Model answer.** Weak pointers don't prevent GC. A snapshot held by `weak.Pointer[T]` can be reclaimed once no strong references exist.

Use case: snapshot-keyed memoization caches. Without weak pointers, the cache retains old snapshots, defeating COW's lifetime story. With weak pointers, cache entries are automatically cleaned up when their snapshot is no longer current.

```go
var cache map[weak.Pointer[Snapshot]]Result
```

Cache entries become invalid (Value() returns nil) when their snapshot is reclaimed.

**Follow-up.** *What's the overhead?* — Per-access weak pointer overhead is ~10-50 ns. Not free, but worth it for memory-sensitive caches.

---

### Q31. How would you stress-test a production COW system?

**Model answer.**
- 10× normal read load with the race detector enabled. Long duration (hours).
- Bursts of writes (10× normal rate) followed by quiescence.
- Concurrent reload failures (return error from validator).
- Random goroutine cancellations to simulate stuck readers.
- Memory pressure (small `GOMEMLIMIT` to trigger frequent GC).
- Goroutine count metrics during all the above.

A robust system handles all of these without correctness violations or memory blowup.

**Follow-up.** *What's the production analogue?* — Continuous load testing in staging; canary deployments; chaos engineering tools.

---

### Q32. Defend or critique the decision to make `atomic.Value` panic on type mismatch.

**Model answer.**
**Defense:** Panic forces type consistency. If you mix types, you almost certainly have a bug. The panic surfaces it immediately rather than producing subtle wrong-behavior. The cost is a runtime check on every Store, which is cheap.

**Critique:** Forces all Stores to use the same dynamic type, even when polymorphism would be useful. The check is runtime-only; the compiler can't help. With generics, `atomic.Pointer[T]` makes the same guarantee compile-time and obsolets `atomic.Value` for most uses.

**Synthesis:** `atomic.Value` was the right design for pre-generic Go. `atomic.Pointer[T]` is strictly better for new code.

---

### Q33. Explain happens-before in your own words and apply it to COW.

**Model answer.** "Happens-before" is an ordering relation between events. If A happens-before B, then A's effects (memory writes) are guaranteed visible to B.

Sources of happens-before:
- Program order within a goroutine.
- Channel operations.
- Mutex Lock/Unlock pairs.
- Atomic operations on the same variable.

For COW:
- Writer's `Store(c)` happens-before any reader's `Load()` that returns `c`.
- Within the writer: building `c.Fields` happens-before `Store(c)` (program order).
- Within the reader: `Load() == c` happens-before reading `c.Fields` (program order).

Transitively: writer's field initialization happens-before reader's field access. The snapshot is consistently visible.

---

### Q34. What's the most subtle COW bug you've debugged or could imagine?

**Model answer.** Several candidates:
- A writer that re-publishes the same snapshot pointer twice after modification (re-using the pointer mutates the published snapshot).
- A writer that returns a slice from a snapshot, the consumer modifies it, breaking immutability.
- A subscriber whose handler calls `Update`, deadlocking on the writer mutex.
- A goroutine pinned to a snapshot during a panic recovery, never re-loading.
- An old snapshot kept alive by being logged (formatting captures fields).
- A snapshot containing a pointer to a mutable object, the object is shared across versions.

Each requires a different debugging approach but is caught by the race detector or memory profiling.

---

### Q35. If you could change one thing about Go's COW support, what would it be?

**Model answer.** Various legitimate answers:
- Add persistent collections to the standard library.
- Expose acquire-release atomics for finer-grained ordering.
- Native 128-bit atomic operations for SeqLock-style multi-word reads.
- Compile-time enforcement of snapshot immutability.
- Better integration with `pprof` for snapshot-keyed analysis.

The interviewer is looking for taste and understanding, not a "right" answer.

---

## Bonus: Coding Exercise Questions

### Q36. Implement a thread-safe `CounterMap` using COW where map updates increment a counter and Range returns a consistent snapshot.

**Solution sketch.**

```go
type CounterMap struct {
    cur atomic.Pointer[map[string]int]
    mu  sync.Mutex
}

func NewCounterMap() *CounterMap {
    m := map[string]int{}
    c := &CounterMap{}
    c.cur.Store(&m)
    return c
}

func (c *CounterMap) Inc(key string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    old := *c.cur.Load()
    next := make(map[string]int, len(old)+1)
    for k, v := range old { next[k] = v }
    next[key]++
    c.cur.Store(&next)
}

func (c *CounterMap) Range(fn func(k string, v int) bool) {
    for k, v := range *c.cur.Load() {
        if !fn(k, v) { return }
    }
}
```

### Q37. Write a benchmark comparing this CounterMap to `sync.Map`.

**Solution sketch.**

```go
func BenchmarkCounterMapRange(b *testing.B) {
    m := NewCounterMap()
    for i := 0; i < 1000; i++ {
        m.Inc(fmt.Sprintf("k%d", i))
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        m.Range(func(k string, v int) bool { return true })
    }
}
```

Comparable benchmark for sync.Map (with its Range method).

### Q38. Add a watcher API to the CounterMap.

**Solution sketch.**

```go
type CounterMap struct {
    cur    atomic.Pointer[map[string]int]
    mu     sync.Mutex
    chans  []chan map[string]int
}

func (c *CounterMap) Subscribe() <-chan map[string]int {
    ch := make(chan map[string]int, 1)
    c.mu.Lock()
    defer c.mu.Unlock()
    c.chans = append(c.chans, ch)
    return ch
}

func (c *CounterMap) Inc(key string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    old := *c.cur.Load()
    next := make(map[string]int, len(old)+1)
    for k, v := range old { next[k] = v }
    next[key]++
    c.cur.Store(&next)
    for _, ch := range c.chans {
        select { case ch <- next: default: }
    }
}
```

---

## Wrap-Up

The questions above span junior through staff levels. Use them for self-assessment or interview practice.

The pattern: junior questions probe usage; middle questions probe design; senior questions probe scaling; staff questions probe fundamentals and judgment.

A strong candidate at any level shows depth on questions appropriate to that level, with reasonable answers for one level up.

Good luck.
