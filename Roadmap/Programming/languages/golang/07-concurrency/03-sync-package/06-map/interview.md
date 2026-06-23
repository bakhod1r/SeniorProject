# sync.Map — Interview Q&A

> Questions and reference answers from junior through staff level. Each question is tagged with the level it is most commonly asked at; senior candidates should be comfortable with all of them. Answers are deliberately concise — interview-pace, not textbook-pace.

---

## Junior

### Q1. Why is the built-in `map` not safe for concurrent use?

**A.** The Go specification does not promise anything about concurrent map access, and the runtime installs a detector that aborts the program with `fatal error: concurrent map writes` if two goroutines write the same map or one reads while another writes. The map's internal bucket layout would be corrupted by races, so the detector chooses immediate crash over silent corruption.

### Q2. What is `sync.Map`?

**A.** A struct in the `sync` package whose methods are safe to call from multiple goroutines. Its zero value is a usable empty map. It uses `any` for keys and values.

### Q3. List the core methods of `sync.Map`.

**A.** `Load`, `Store`, `LoadOrStore`, `LoadAndDelete`, `Delete`, `Range`. Since Go 1.20: `Swap`, `CompareAndSwap`, `CompareAndDelete`.

### Q4. What does `Load` return?

**A.** Two values: the value (`any`) and `ok bool`. `ok` is `true` if the key exists. The value must be type-asserted.

### Q5. What does `LoadOrStore` return?

**A.** `(actual any, loaded bool)`. If the key existed, `actual` is the existing value and `loaded == true`. If we inserted, `actual` is the value we passed in and `loaded == false`.

### Q6. Why is there no `Len` method?

**A.** A consistent size in a lock-free concurrent map is either expensive or misleading. The Go authors chose to omit it rather than return a stale or expensive answer. Track size externally with `atomic.Int64` if needed.

### Q7. Can you iterate over `sync.Map` with `range`?

**A.** No. Use the `Range` method, which takes a callback `func(k, v any) bool`.

### Q8. Why is `m.Store(key, value)` better than `m[key] = value`?

**A.** `sync.Map` is not indexable. The `Store` method is the only way to set a value. The square-bracket syntax does not compile.

### Q9. Can you copy a `sync.Map`?

**A.** No. It contains unexported synchronisation state. `go vet` warns about it. Always pass `*sync.Map`.

### Q10. What is the type assertion idiom for a `Load`?

**A.**

```go
v, ok := m.Load(key)
if !ok { ... }
typed, ok := v.(*Entry)
if !ok { ... }
```

Always use the comma-ok form to avoid panicking on a bad type.

---

## Middle

### Q11. When should you use `sync.Map` vs `RWMutex + map`?

**A.** Use `sync.Map` for read-mostly maps with stable keys, or per-goroutine entries with rare cross-goroutine writes. Use `RWMutex + map` for everything else, especially balanced or write-heavy workloads, or when you need `Len`, ordered iteration, or atomic snapshot.

### Q12. What is the bug in this counter?

```go
v, _ := m.Load("hits")
m.Store("hits", v.(int)+1)
```

**A.** Race between `Load` and `Store`. Two goroutines can both read the same value, both increment, both store, and one update is lost. Fix with `CompareAndSwap` in a retry loop (Go 1.20+) or use `atomic.Int64` instead of `sync.Map` for counters.

### Q13. Write the race-free counter using `CompareAndSwap`.

**A.**

```go
for {
    v, _ := m.Load("hits")
    if m.CompareAndSwap("hits", v, v.(int)+1) {
        break
    }
}
```

### Q14. What does `Swap` return?

**A.** `(previous any, loaded bool)`. The previous value (or `nil`) and whether the key existed before the swap. Added in Go 1.20.

### Q15. When does `CompareAndSwap` return `false`?

**A.** When the current value is not equal to `old`, or when the key is absent. `CompareAndSwap` does not insert.

### Q16. What is the difference between `Delete` and `LoadAndDelete`?

**A.** `Delete` removes the key with no return value. `LoadAndDelete` removes the key and returns the previous value with `loaded bool`. Use `LoadAndDelete` for work-handoff patterns where exactly one consumer should get the entry.

### Q17. Show how to atomically swap a connection.

**A.**

```go
prev, loaded := m.Swap(connID, newConn)
if loaded {
    prev.(*Conn).Close()
}
```

### Q18. Why does this benchmark show `sync.Map` slower than `RWMutex+map`?

```go
// 50/50 read/write
```

**A.** `sync.Map`'s write path is expensive — every new key takes the lock, may rebuild the dirty map, and CAS the entry pointer. `RWMutex+map` writes are a single lock plus a map insert. For balanced or write-heavy workloads, `RWMutex+map` is faster.

### Q19. Is `Range` a snapshot?

**A.** No. Concurrent stores and deletes may or may not be visible during iteration. Each key is visited at most once, but the value observed for each key can be from any point during the call. Order is unspecified.

### Q20. What is the typical "compute once and cache" pattern with `sync.Map`?

**A.**

```go
if v, ok := m.Load(key); ok {
    return v.(*Entry)
}
actual, _ := m.LoadOrStore(key, compute(key))
return actual.(*Entry)
```

Two goroutines may both compute, but only one stores. For expensive computation, combine with `golang.org/x/sync/singleflight` so only one computes.

---

## Senior

### Q21. Walk through what happens inside `sync.Map` when you call `Load` on a key that exists.

**A.** Atomic load of the `read` pointer. Map lookup on `read.m`. The entry's value pointer is loaded atomically. Return the value and `true`. No mutex acquired. About 15–25 ns on modern hardware.

### Q22. What happens on a miss?

**A.** Same atomic load of `read`. Map lookup fails. If `read.amended == false`, return `(nil, false)`. Otherwise take `mu`, re-check `read`, check `dirty`, increment `misses`, and if `misses >= len(dirty)`, promote dirty to read. Release `mu`.

### Q23. What are the three states of `entry.p`?

**A.** A pointer to the live value, `nil` (deleted but still in read, possibly in dirty), and `expunged` (deleted and confirmed absent from dirty during last rebuild). `expunged` entries cannot be revived without acquiring `mu` and re-adding to dirty.

### Q24. Why do deletes not immediately free memory?

**A.** The entry stays in `read.m` with `p == nil`. It is only removed when the read map is rebuilt (on the next promotion). For high-churn workloads, deleted entries accumulate as tombstones, causing memory amplification.

### Q25. Why does write-heavy `sync.Map` underperform?

**A.** Every new-key store takes the lock. The first new-key store after a promotion rebuilds dirty by copying every non-expunged entry from read (O(n)). Stores box values as interfaces, allocating on the heap. CAS contention on shared entries hits cache lines. None of these costs apply to `RWMutex+map`'s simpler write path.

### Q26. How would you build a `sync.Map[K, V]` generic wrapper?

**A.** A struct containing a private `sync.Map`, with methods that take typed parameters, do the type assertion in one place, and return zero values of `V` on miss. Pseudocode:

```go
type Map[K comparable, V any] struct { inner sync.Map }
func (m *Map[K, V]) Load(k K) (V, bool) {
    v, ok := m.inner.Load(k)
    if !ok { var z V; return z, false }
    return v.(V), true
}
```

Generics fix type safety but do not eliminate interface boxing.

### Q27. Why use `singleflight` together with `sync.Map`?

**A.** `LoadOrStore` prevents double-store but not double-compute. Two concurrent misses both run the expensive compute. `singleflight.Group.Do` ensures only one runs; others wait for its result. Combine: check the cache, fall back to singleflight which computes and stores.

### Q28. Compare `sync.Map` with `atomic.Pointer[map[K]V]`.

**A.** `atomic.Pointer[map]` (copy-on-write): reads are atomic load plus map index — even faster than `sync.Map`. Writes rebuild the entire map under a CAS retry loop. Wins when reads vastly dominate and writes are rare (config swap, feature flags). `sync.Map` wins when there are more writes than `atomic.Pointer[map]` can tolerate.

### Q29. When would a sharded `RWMutex+map[K]V` outperform `sync.Map`?

**A.** Write-heavy or balanced workloads with uniformly distributed keys. Each shard's lock is contended only by ~1/N of operations. For 64 shards, throughput approaches 64× a single-lock map. `sync.Map`'s lock is also a single point, plus it has more per-write overhead, so sharded `RWMutex+map` is typically faster.

### Q30. What memory model guarantees does `sync.Map` provide?

**A.** A successful `Store(k, v)` synchronises with any later `Load(k)` that returns `v` — meaning all writes before `Store` are visible to the reading goroutine after `Load`. This is per-key; cross-key ordering is not guaranteed. `Range` does not provide global synchronisation.

---

## Staff

### Q31. The Go authors say `sync.Map` is for "two specific use cases." Why was the API not generalised?

**A.** Because a general-purpose concurrent map without those constraints performs no better than `RWMutex+map`. The fast-read-path design requires sacrificing write performance and accepting memory amplification. Marketing it as "the" concurrent map would lead engineers to use it where it loses. The narrow framing is intentional defensive design.

### Q32. Suppose you must build a hot-path concurrent map for 100M ops/sec. What would you avoid?

**A.** Avoid `sync.Map` (boxing overhead, single internal mutex on writes). Avoid `RWMutex+map` (single mutex). Avoid maps with string keys (hash cost). Reach for: sharded map with `maphash` (64+ shards), fixed-capacity `[N]atomic.Int64` indexed by hash for counter-only workloads, or per-goroutine state combined occasionally. Profile cache-line contention with `perf c2c` if hot keys exist.

### Q33. What is wrong with this generic wrapper for `CompareAndSwap`?

```go
func (m *Map[K, V]) CompareAndSwap(k K, old, new V) bool {
    return m.inner.CompareAndSwap(k, old, new)
}
```

**A.** `V` is `any`-constrained; non-comparable `V` (slice, map, function) makes the inner `CompareAndSwap` panic at runtime. The compiler cannot enforce comparability at the method level because Go does not yet support method-level constraints. Document the requirement and panic intentionally with a clearer message, or restrict the wrapper to comparable `V` only.

### Q34. A team migrates from `sync.Map` to `RWMutex+map` and sees QPS drop. What is plausible?

**A.** Their workload is actually read-mostly with stable keys, and the lock-free read path of `sync.Map` was carrying them. Under `RWMutex+map`, all reads serialise on the `RLock` cache-line, which contends at high concurrency. Solutions: shard the `RWMutex+map`, or stay on `sync.Map` and address the team's original complaint (likely typing, not performance) with a generic wrapper.

### Q35. How does `sync.Map.Range` interact with `expunged` entries?

**A.** `Range` iterates `read.m`. For each entry, it calls `e.load()` which returns `(nil, false)` for both `nil` and `expunged` states; the callback is not invoked for those. So expunged entries are invisible to `Range` even though they occupy slots in `read.m`. They are reclaimed only on the next dirty rebuild.

### Q36. You see `sync.Map` taking 5× expected memory in a high-churn benchmark. Diagnose.

**A.** Tombstone accumulation. Entries deleted from `read.m` stay there as `nil` or `expunged` until the next dirty rebuild, which only happens on a new-key store after a slow-path miss promotion. If your churn is "store new key, delete old key" repeatedly, every cycle re-promotes and rebuilds, but rebuild keeps every non-expunged entry. Memory grows until the GC and the rebuild align. Switch to sharded `RWMutex+map` or accept the amplification and budget memory accordingly.

### Q37. Design a TTL cache around `sync.Map` that is safe under high concurrency.

**A.** Store `struct { value any; expires time.Time }`. On `Get`, check expiry; if expired, call `CompareAndDelete(key, currentEntry)` so refreshes between read and delete are not clobbered. Periodic sweep with `Range + CompareAndDelete`. Cap the size by tracking it externally and rejecting new entries above a watermark. Better: use a battle-tested library (`ristretto`, `golang-lru`).

### Q38. Why is iterating `Range` while another goroutine calls `Store` not a race?

**A.** `Range` reads through atomic pointers (the `read` pointer, each entry's value pointer). `Store` either modifies `dirty` under `mu` (Range does not look there) or CAS-updates an entry's value pointer (atomic, no race). Each visited key sees *some* value that was stored at some point during `Range`, not undefined behaviour. The race detector confirms this is race-free even under heavy concurrent modification.

### Q39. What problem did Go 1.20 `Swap`, `CompareAndSwap`, `CompareAndDelete` solve?

**A.** Before 1.20, there was no way to atomically *update* a value in `sync.Map`. You had `Load + Store` (racy) or external locking (defeats the point). For "increment counter," "replace if equal," "evict if not refreshed," users either had to use mutexes anyway or rely on hacky workarounds. The 1.20 methods provide proper atomic update primitives.

### Q40. You are designing a concurrent set (no values). Is `sync.Map` the right choice?

**A.** Probably not. Sets are typically write-heavy initially (insertion phase) and read-mostly later (membership checks). `sync.Map` would suffer during the insertion phase. Better: `RWMutex + map[K]struct{}` for write-heavy phases, or build the set once and freeze it via `atomic.Pointer[map[K]struct{}]` for read-heavy phases. If you really need both, sharded `RWMutex + map`.

### Q41. Justify the `expunged` sentinel's existence in two sentences.

**A.** Without `expunged`, every re-insertion of a previously-deleted key would have to consult dirty under the mutex, defeating the fast read path. The `expunged` state lets `LoadOrStore` distinguish "this read-entry can be revived via fast-path CAS" from "this read-entry is officially dead, you must take the lock and re-add to dirty."

### Q42. A junior writes `for { m.Range(...) }` to "watch" the map. Critique.

**A.** Three problems: (1) it busy-loops a CPU at 100%; use a ticker. (2) `Range` is not a snapshot, so the "watch" sees inconsistent views. (3) On a large map, each Range is O(n); the watcher consumes all of one core just iterating. Replace with: event-driven notification (channel sent on `Store`), or periodic snapshot via a different data structure.

### Q43. What is the closest equivalent of `sync.Map` in another language you know?

**A.** Java's `ConcurrentHashMap` is similar in goal but very different in implementation — it uses fine-grained striped locks plus CAS for the bin chains. C++'s `std::unordered_map` requires external synchronisation; folly's `ConcurrentHashMap` is the closest analog. Rust's `dashmap` crate uses sharded `RwLock`s. None match `sync.Map`'s exact read/dirty split; that design is unusual.

### Q44. The `sync.Map` proposal predates generics. If the design were redone today, what would you change?

**A.** A typed `Map[K comparable, V any]` to avoid boxing. Method-level constraints (`V comparable` for the CAS methods). A `Len` method that returns an approximate count via an atomic counter (acceptable inconsistency for the simplicity gain). An optional `Range` overload returning an iterator (Go 1.23 added `iter.Seq2`). And perhaps a `Clear` method, with documented semantics for concurrent callers.

### Q45. When you read someone else's Go code, what is the strongest signal that they should not be using `sync.Map`?

**A.** They are computing `Len` by counting in `Range`. That tells you they need a typed map with a counter — either `RWMutex+map[K]V` plus `atomic.Int64`, or `sharded.Map[K, V]`. Other strong signals: callbacks in `Range` that mutate the map and expect snapshot semantics; `Load`-then-`Store` patterns that should be `CompareAndSwap`; `sync.Map` of `int` or `bool` values (boxing waste); a global `sync.Map` exported from a package without a typed API.
