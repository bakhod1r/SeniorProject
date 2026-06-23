# Concurrent Bloom Filter — Interview Questions

> Questions span junior to staff level. Each comes with a model answer or sketch. Use this for self-assessment, mock interviews, or to write your own questions for candidates.

---

## Junior Level

### Q1. What is a Bloom filter?

A probabilistic set that supports Add and Test. Test may return "yes" for items never added (false positive) but never returns "no" for items that were added (no false negatives). It stores a fixed-size bit array and a small number of hash functions; Add sets bits, Test checks bits.

### Q2. Why use a Bloom filter instead of a `map[string]struct{}`?

A Bloom filter uses far less memory: about 9.6 bits per item for 1% false-positive rate, versus dozens of bytes per key in a Go map. It is suitable when negative lookups dominate and you can tolerate a small false-positive rate.

### Q3. What are the three numbers that define a Bloom filter?

`m` (number of bits), `k` (number of hash functions), `n` (number of items added). Together they determine the false-positive rate `p`.

### Q4. How do you size a Bloom filter for a target FPR?

Use `bloom.NewWithEstimates(n, p)`, where `n` is the expected item count and `p` is the target FPR. The library picks optimum `m` and `k`. Rule of thumb: 10 bits per item gives roughly 1% FPR.

### Q5. Can a Bloom filter return a false negative?

No. If a key was added, every Test for that key returns true. The structure may report "yes" for keys never added (false positive), but never the reverse.

### Q6. Is `bits-and-blooms/bloom/v3` safe to share across goroutines?

No. The library documents that concurrent use is not supported. Wrap with `sync.RWMutex`, `sync.Mutex`, or use an atomic-bitset wrapper.

### Q7. What happens if you add 10x more items than the filter was sized for?

The FPR climbs steeply, approaching 1.0. The filter still answers Tests, but most answers will be "maybe," eliminating its value.

### Q8. Can you delete from a Bloom filter?

Not from the basic variant. Deletion requires a Counting Bloom Filter (counters instead of bits) or a Cuckoo filter.

---

## Middle Level

### Q9. How would you make a Bloom filter safe under thousands of concurrent goroutines?

Three options, in order of complexity:

1. `sync.RWMutex` around the library — simple but serialises writes.
2. Atomic bitset using `atomic.OrUint64` and `atomic.LoadUint64` — wait-free.
3. Sharded filter — N independent sub-filters, hash-routed.

Pick by workload: RWMutex for read-heavy; atomic for write-heavy; sharded for very-high core counts.

### Q10. Why does `atomic.OrUint64` not lose bits when two goroutines write to the same word?

Atomic operations are indivisible at the hardware level (LOCK OR on x86; LL/SC on ARM). Two concurrent ORs are serialised by the memory system; both bits are set, neither lost.

### Q11. What is false sharing, and how does it affect a sharded Bloom filter?

False sharing occurs when two threads write to different variables in the same cache line; each write invalidates the other thread's cache copy. In a sharded Bloom filter with adjacent shard mutexes, writes to one shard's mutex invalidate neighbouring shards' mutexes. Pad shards with `cpu.CacheLinePad` to prevent this.

### Q12. How do you measure observed FPR in production?

Sample a small fraction (e.g. 1%) of "maybe" answers and confirm them against the slow path. Track `false_positives / sampled_hits` as a rolling rate. Expose as a metric; alert if it diverges from the design target.

### Q13. What is a counting Bloom filter and when do you use one?

A Bloom variant that stores small counters (typically 4-bit) instead of bits. Add increments; Delete decrements; Test checks for positive count. Use when you need delete and can afford ~4x the basic Bloom's memory. Cuckoo filters are an alternative with better memory.

### Q14. Describe the "double-write" pattern during a Bloom filter rebuild.

While rebuilding, every Add writes to both the old and new filter. Reads use the old until the new is populated; then atomically swap. This prevents the race where an Add lands on the old filter during the rebuild window and is missing from the new one.

### Q15. Why is the cache-aside ordering rule (truth before cache) important?

If the filter is updated before the source of truth, a concurrent reader can see a "yes" in the filter but find nothing in the database — a stale state. By updating truth first, the filter is always conservative: it might lag truth (false negative for a new key) but never claims something that doesn't exist.

For Bloom filters specifically, the "filter conservatism" means we accept brief windows where a recently-Added key is not yet in the filter; we never accept a window where the filter says yes but the data isn't there.

### Q16. What happens if you marshal a filter under heavy concurrent writes?

`MarshalBinary` walks the bitset; without atomic loads, you may read torn (partially-updated) words. With atomic loads, each word is read coherently, but the snapshot may include or exclude in-flight Adds. Either way, the snapshot is *valid* (no torn data) but not necessarily *complete* with respect to all writes happening concurrently.

### Q17. How do you observe a Bloom filter in production?

Expose four metrics: capacity (m), fill fraction, observed FPR, hit/miss counts. Add alerts on fill > 0.7 (saturation) and observed FPR > 5x target (drift). Log filter actions at INFO level with sampling.

---

## Senior Level

### Q18. Describe the architecture of a scalable Bloom filter (SBF).

A chain of basic Bloom filters with geometrically growing capacities and tightening FPR targets. New keys go to the current (last) filter; when full, a new larger filter is appended. Tests check all filters. The overall FPR is bounded by `p_0 / (1 - s)` where `s` is the tightening ratio.

### Q19. When would you prefer a Cuckoo filter over a Bloom filter?

When you need Delete and memory matters (Cuckoo uses ~9 bits/key vs Bloom's 9.6 at p=0.01, and the gap widens for tighter FPR). Also when you can tolerate occasional insertion failure (Cuckoo can fail to insert in near-full filters).

### Q20. How does RocksDB use Bloom filters?

Each SSTable carries a small Bloom filter in RAM. On Get, RocksDB tests each SSTable's filter; only "maybe" responses trigger an actual SSTable read. Filters are immutable per SSTable (because SSTables are immutable); compaction creates new SSTables with fresh filters. No synchronisation is needed for reads because the filters never mutate.

### Q21. What is hash flooding and how do you defend against it?

A denial-of-service attack where an attacker crafts inputs that all hash to the same positions, driving up observed FPR or saturating specific bits. Defence: keyed hash with secret seed (e.g. `hash/maphash` or SipHash); per-process random seed; per-tenant FPR monitoring.

### Q22. Design a Bloom filter that grows without bound.

Use a scalable Bloom filter (SBF) chain. Pick base capacity `n_0`, growth ratio `r` (e.g. 2), and tightening ratio `s` (e.g. 0.5). New sub-filters are appended when the current is full. Memory grows geometrically but bounded by `2 * largest sub-filter`. Test latency grows logarithmically.

### Q23. A filter is serving 1M req/sec. Profile shows 80% of CPU in `sync.RWMutex.Lock`. What do you do?

Replace the RWMutex with an atomic bitset. The library's `BloomFilter` cannot be directly atomic; either wrap with the per-word atomic operations or move to a custom filter using `atomic.OrUint64`/`atomic.LoadUint64`. Atomic Adds and Tests are wait-free; profile should show CPU spent in `atomic.OrUint64` (the actual work) rather than mutex locking.

### Q24. How do you handle a Bloom filter that needs to be shared across many service replicas?

Each replica maintains its own filter. Periodically (every minute), replicas exchange filters via gossip or a central coordinator; each replica `Union`s the received filters into its own. The union is a CRDT (monotonic, idempotent, commutative); convergence is guaranteed.

For strong consistency, replicate every Add synchronously across replicas — slow but exact. For most use cases, eventual consistency via gossip is fine.

### Q25. Compare partitioned, scalable, and block Bloom filters.

- **Partitioned:** k partitions, one per hash function. Cleaner math; slight memory overhead; helps with concurrency.
- **Scalable:** chain of sub-filters; grows over time; FPR bounded by 2x base.
- **Block:** all k bits in a single cache line per key. Slightly worse FPR; 5-10x faster Test on large filters.

Use scalable for unknown growth; block for cache-bound throughput; partitioned for academic correctness or specific concurrency designs.

---

## Staff Level

### Q26. Design a deduplication system handling 100M events/sec across 1000 instances with a 24-hour window and 0.0001 FPR.

- Partition events by hash across 1000 instances; each handles ~100K events/sec.
- Per-instance: two-window atomic Bloom filter, each window 12 hours, rotated every 12 hours.
- Per-instance filter sized for `2 * 100K * 86400 * 12 / 24 = 86.4B` events with 1B safety margin.
- Memory per instance: 1B * 19.2 bits = 2.4 GB per window, 4.8 GB total.
- Total cluster memory: 4.8 TB across 1000 instances.
- Concurrency: atomic bitset within each instance; no cross-instance sync.

If memory is too high, raise p to 0.001 (saves ~5 bits/key) or use Cuckoo (saves ~3 bits/key).

### Q27. How do you debug a suspected false-negative bug in production?

False negatives are bugs — they should never occur. Steps:

1. Add a sentinel-key test: Add a known key; periodically Test; alert if false.
2. Audit all paths to the filter: do they hold the wrapper's lock? Are atomic ops used?
3. Run `go test -race` on the codebase.
4. Check for racy snapshot/restore: was the filter being modified during Marshal?
5. Check for hash determinism: is the same key hashing the same way across processes?
6. Check the rebuild path: was the new filter populated from the same source of truth?

The fix usually requires either better synchronisation or a rebuild from the source of truth.

### Q28. A Bloom filter has been in production for 18 months and is "slow." Walk me through the investigation.

Step 1: check the four metrics. Fill fraction, observed FPR, hit rate, capacity. Is the filter saturated? Probably yes after 18 months of growth.

Step 2: check the rebuild process. When was the last rebuild? Were there any errors? Is the source of truth available?

Step 3: profile. Where is CPU going? If in `OrUint64`, you have hot-bit contention (rare); if in `Lock`, you have lock contention; if in `Hashing`, you have a CPU-bound workload that may benefit from a faster hash.

Step 4: check observability. Are GC pauses correlating with latency? Are there long Marshal pauses?

Step 5: plan the fix. Usually: rebuild with larger n; possibly switch to atomic bitset if locks dominate; possibly switch to block Bloom if cache misses dominate.

### Q29. Discuss the trade-offs of Bloom vs Cuckoo vs Xor filter.

- **Bloom:** simple, dynamic, no delete. Best general-purpose.
- **Cuckoo:** dynamic with delete. Slightly less memory at p ≤ 0.001. Insertion can fail.
- **Xor:** static (build once). Lowest memory. Best for read-only.

A staff-level answer notes:

- Cuckoo's eviction protocol makes concurrent insertion hard; Cuckoo is best when writes are serialised.
- Bloom is the easiest to make wait-free.
- Xor is the closest to the information-theoretic lower bound (~1.23 bits/key per FPR-bit).

### Q30. Bloom filters across multiple availability zones — how?

Each AZ has its own filter. AZ-local reads use the local filter. New Adds are replicated:

- Sync: every Add waits for all-AZ acknowledgement. Slow; impractical at high rates.
- Async: each AZ periodically gossips its filter; others Union.

For most use cases, eventual consistency via gossip is appropriate. False positives compound across AZs; size each accordingly.

For mission-critical correctness (e.g. fraud detection), sync replication is required.

### Q31. Explain how a Bloom filter contributes to LSM-tree read efficiency.

In an LSM-tree, point lookups must check every SSTable for the key. Without filters, this is O(N) disk reads. Per-SSTable Bloom filters in RAM allow the lookup to skip SSTables that "definitely don't have" the key; on average, only ~1 + p*N SSTables are read. For p = 0.01 and N = 100, ~2 reads.

The filters are immutable (SSTables are immutable), so reads are wait-free. Compaction creates new SSTables (and filters) and atomically updates a version pointer.

### Q32. Describe a real-world failure mode of a Bloom filter at scale.

Several:

- **Saturation:** Filter sized too small; FPR climbs over time. Alert on fill fraction.
- **Snapshot pause:** A long Marshal under a mutex pauses all queries. Fix: lockless snapshot via atomic loads.
- **GC interaction:** Multi-GB filter slows GC scans. Fix: off-heap allocation or higher GOGC.
- **TLB misses:** Filter spans more pages than the TLB. Fix: enable transparent huge pages.
- **Hot bits:** Pathological key sets concentrate writes on a few words; cache lines bounce. Fix: deduplicate at the call site.
- **Stale snapshot:** Marshal during writes captures inconsistent state. Fix: snapshot when quiescent.

A staff-level engineer can quickly diagnose which failure mode is at play from metrics.

### Q33. Bloom filter with TTL — how do you make individual entries expire?

You cannot expire bits in a basic Bloom filter; bits are shared across keys. Solutions:

1. **Counting Bloom filter with timestamps.** Each cell stores the most recent Add time; periodically sweep and decrement expired cells. Expensive.
2. **Time-windowed filters.** Multiple filters covering successive time windows; tests check all; window filters are dropped when expired. Effective for TTL ≈ window granularity.
3. **Stable Bloom filter.** Randomly decay bits on each Add; old keys eventually evicted. Bounded memory but FPR is not flat.
4. **Cuckoo filter with timestamped fingerprints.** Periodically remove fingerprints whose timestamps are stale. Cleaner than CBF for time-based eviction.

For most cases, time-windowed filters (option 2) are the simplest correct answer.

### Q34. What is the difference between `TestAndAdd` and `TestOrAdd`?

`TestAndAdd`: returns the Test result, then ALWAYS Adds (the Add is unconditional).
`TestOrAdd`: returns the Test result, then Adds only if Test was false (skip Add if already present).

For a basic Bloom filter, the *result* is identical (Adding an already-present key is a no-op for bits). The difference is *cost*: TestAndAdd always pays the k Or operations; TestOrAdd short-circuits.

For a counting Bloom filter, they differ semantically: TestAndAdd increments counters every time; TestOrAdd only on first sight.

In concurrent code, neither is atomic in the usual sense; two goroutines can both observe "false" and both Add. For strict "first writer wins" semantics, wrap with a mutex.

### Q35. How do you defend a Bloom filter against an attacker who can choose query keys?

If the hash family is fixed and public (e.g. Murmur3 with constant seed), an attacker can construct keys that always trigger Tests at specific positions. Two effects:

1. They can force the slow path for chosen keys, amplifying DoS.
2. They can saturate specific bits, raising FPR for unrelated keys.

Defences:

- Use a keyed hash with secret seed (maphash, siphash). Attacker cannot precompute.
- Re-seed on rebuild. Old precomputed keys become useless.
- Rate-limit slow-path calls per source. An attacker cannot amplify beyond their rate limit.
- Monitor per-source observed FPR. Spikes indicate attack.

For most internal services, this is overkill; for public-facing endpoints, it is essential.

---

## Bonus

### Q36. Why is the optimum k roughly 0.7 * (m/n)?

`k* = (m/n) * ln 2`, and `ln 2 ≈ 0.693`. So `k* ≈ 0.7 * (m/n)`. Memorise the constant.

### Q37. How many bits per item for p = 0.01? p = 0.001? p = 0.0001?

`m/n = 1.44 * log_2(1/p)`. For p = 0.01: ~9.6. p = 0.001: ~14.4. p = 0.0001: ~19.2.

Each "9" of FPR improvement costs ~4.8 extra bits per item.

### Q38. A filter at 50% fill — what is the FPR?

At fill = 0.5, the FPR is `(0.5)^k`. For k = 7: ~0.78%. For k = 10: ~0.10%. For k = 13: ~0.012%.

This is by design: optimum k makes the filter half-full at the design n.

### Q39. Is a Bloom filter linearisable?

No. Add and Test are multi-step (k bits each). Two concurrent operations can observe intermediate states. The contract is weaker: if Add A happens-before Test B (via channel, mutex, or atomic synchronisation), then B sees A's writes. Otherwise, B may see partial state.

This is sufficient for Bloom semantics; the no-false-negative property holds for non-concurrent Add and Test, which is what users actually need.

### Q40. Why is Bloom filter Union exact (no extra false positives)?

The bitwise OR of two filters yields a filter that says "yes" iff either input would. Any key in A's set was Added to A, so all its k bits are set in A and therefore in the union. Any key in B's set is similarly in the union. No false negatives are introduced.

False positives compound: a key not in A or B may still trigger a false positive in the union because its k bits may all be set by the combined contributions. But these are still false positives, not false negatives.

### Q41. What does a Bloom filter teach an engineer?

The Bloom filter is one of the cleanest examples of approximation as an engineering strategy. It teaches:

- Trade certainty for memory.
- Quantify the trade-off (the FPR formula is closed-form).
- Defend the trade-off with metrics.
- Operate the trade-off across years.

Engineers who internalise these lessons apply them across many domains: caching, sampling, sketching, learning-augmented data structures. The Bloom filter is a small structure with a long shadow.

---

## Closing

This list is not exhaustive. A senior or staff interview will adapt to the candidate's experience. The depth of an interviewer's follow-ups is the real signal.

For practice: pick five questions; answer each in writing in 5-10 minutes; show the answers to a peer. Iterate.

---

## Coding Round Questions

### Q42. Implement a thread-safe Bloom filter in 30 minutes.

A pass: wrap the library with `sync.RWMutex`. Show Add, Test, methods.

```go
type SafeBloom struct {
    mu sync.RWMutex
    f  *bloom.BloomFilter
}

func NewSafeBloom(n uint, p float64) *SafeBloom {
    return &SafeBloom{f: bloom.NewWithEstimates(n, p)}
}

func (s *SafeBloom) Add(k []byte) {
    s.mu.Lock()
    s.f.Add(k)
    s.mu.Unlock()
}

func (s *SafeBloom) Test(k []byte) bool {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.f.Test(k)
}
```

A strong pass: extend with atomic-bitset implementation, Marshal/Unmarshal, ApproximatedSize.

A staff pass: implement sharded atomic, padding for false sharing, observed-FPR sampling.

### Q43. Implement a Bloom filter from scratch (no library).

Skeleton:

```go
type Bloom struct {
    bits []uint64
    m    uint64
    k    uint64
}

func New(m, k uint64) *Bloom {
    return &Bloom{
        bits: make([]uint64, (m+63)/64),
        m:    m,
        k:    k,
    }
}

func (b *Bloom) Add(key []byte) {
    h1, h2 := hashes(key)
    for i := uint64(0); i < b.k; i++ {
        pos := (h1 + i*h2) % b.m
        b.bits[pos/64] |= 1 << (pos % 64)
    }
}

func (b *Bloom) Test(key []byte) bool {
    h1, h2 := hashes(key)
    for i := uint64(0); i < b.k; i++ {
        pos := (h1 + i*h2) % b.m
        if b.bits[pos/64]&(1<<(pos%64)) == 0 {
            return false
        }
    }
    return true
}

func hashes(key []byte) (uint64, uint64) {
    x := xxhash.Sum64(key)
    h2 := x>>33 | x<<31
    if h2 == 0 { h2 = 1 }
    return x, h2
}
```

Discuss: why double hashing, why guard h2 == 0, why xxhash, edge case of m = 0.

### Q44. Implement `MarshalBinary` and `UnmarshalBinary` for your custom Bloom filter.

```go
func (b *Bloom) MarshalBinary() []byte {
    buf := make([]byte, 16+len(b.bits)*8)
    binary.LittleEndian.PutUint64(buf[0:8], b.m)
    binary.LittleEndian.PutUint64(buf[8:16], b.k)
    for i, w := range b.bits {
        binary.LittleEndian.PutUint64(buf[16+i*8:24+i*8], w)
    }
    return buf
}

func UnmarshalBinary(data []byte) (*Bloom, error) {
    if len(data) < 16 {
        return nil, errors.New("too short")
    }
    m := binary.LittleEndian.Uint64(data[0:8])
    k := binary.LittleEndian.Uint64(data[8:16])
    if uint64(len(data)) != 16+((m+63)/64)*8 {
        return nil, errors.New("size mismatch")
    }
    b := New(m, k)
    for i := range b.bits {
        b.bits[i] = binary.LittleEndian.Uint64(data[16+i*8 : 24+i*8])
    }
    return b, nil
}
```

Discuss: endianness, size validation, error handling.

### Q45. Implement a counting Bloom filter that supports delete.

```go
type CBF struct {
    mu       sync.Mutex
    counters []byte // 4-bit counters packed two per byte
    m        uint64
    k        uint64
}

func (c *CBF) get(i uint64) uint8 {
    b := c.counters[i/2]
    if i%2 == 0 { return b & 0xF }
    return b >> 4
}

func (c *CBF) set(i uint64, v uint8) {
    v &= 0xF
    b := &c.counters[i/2]
    if i%2 == 0 { *b = (*b & 0xF0) | v }
    else        { *b = (*b & 0x0F) | (v << 4) }
}

func (c *CBF) Add(key []byte) {
    h1, h2 := hashes(key)
    c.mu.Lock()
    defer c.mu.Unlock()
    for i := uint64(0); i < c.k; i++ {
        pos := (h1 + i*h2) % c.m
        v := c.get(pos)
        if v < 15 { c.set(pos, v+1) }
    }
}

func (c *CBF) Delete(key []byte) {
    h1, h2 := hashes(key)
    c.mu.Lock()
    defer c.mu.Unlock()
    for i := uint64(0); i < c.k; i++ {
        pos := (h1 + i*h2) % c.m
        v := c.get(pos)
        if v > 0 && v < 15 { c.set(pos, v-1) }
    }
}

func (c *CBF) Test(key []byte) bool {
    h1, h2 := hashes(key)
    c.mu.Lock()
    defer c.mu.Unlock()
    for i := uint64(0); i < c.k; i++ {
        pos := (h1 + i*h2) % c.m
        if c.get(pos) == 0 { return false }
    }
    return true
}
```

Discuss: why saturating counters, why 4 bits, why we never decrement saturated counters.

### Q46. Implement a sliding-window dedup using Bloom filters.

```go
type SlidingDedup struct {
    mu       sync.RWMutex
    cur, prev *bloom.BloomFilter
    n        uint
    p        float64
}

func NewSlidingDedup(n uint, p float64, interval time.Duration) *SlidingDedup {
    sd := &SlidingDedup{
        cur:  bloom.NewWithEstimates(n, p),
        prev: bloom.NewWithEstimates(n, p),
        n:    n, p: p,
    }
    go sd.rotateLoop(interval)
    return sd
}

func (sd *SlidingDedup) rotateLoop(interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for range t.C {
        sd.mu.Lock()
        sd.prev = sd.cur
        sd.cur = bloom.NewWithEstimates(sd.n, sd.p)
        sd.mu.Unlock()
    }
}

func (sd *SlidingDedup) Seen(key string) bool {
    sd.mu.RLock()
    seen := sd.cur.TestString(key) || sd.prev.TestString(key)
    sd.mu.RUnlock()
    if seen { return true }
    sd.mu.Lock()
    defer sd.mu.Unlock()
    if sd.cur.TestString(key) { return true }
    sd.cur.AddString(key)
    return false
}
```

Discuss: why two windows, why double-check after lock upgrade, what is the actual dedup window (1x-2x interval).

### Q47. Write a benchmark for your Bloom filter under concurrent load.

```go
func BenchmarkConcurrent(b *testing.B) {
    f := New(8_000_000, 7)
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        var buf [16]byte
        rand.Read(buf[:])
        for pb.Next() {
            f.Add(buf[:])
            f.Test(buf[:])
        }
    })
}
```

Discuss: `RunParallel`, why pre-allocate buf, what does `b.ResetTimer` do, why we Add and Test together (mixed workload).

### Q48. Implement a Bloom filter with hot reload via `atomic.Pointer`.

```go
type HotFilter struct {
    current atomic.Pointer[bloom.BloomFilter]
}

func (h *HotFilter) Test(k []byte) bool {
    return h.current.Load().Test(k)
}

func (h *HotFilter) Reload(path string) error {
    data, err := os.ReadFile(path)
    if err != nil { return err }
    fresh := &bloom.BloomFilter{}
    if err := fresh.UnmarshalBinary(data); err != nil { return err }
    h.current.Store(fresh)
    return nil
}
```

Discuss: why `atomic.Pointer` (Go 1.19+), wait-free reads, atomic swap.

---

## Conceptual / Discussion Questions

### Q49. Why is the optimum k a beautiful result?

At `k* = (m/n) ln 2`, exactly half the bits are set in expectation. This is the optimum point for any FPR formula of the form `(1 - q)^k`: tighter k risks more bits being set; looser k risks too few positions to discriminate. Half-full is the maximum entropy state.

### Q50. Compare a Bloom filter to a perfect hash function.

A perfect hash function (PHF) maps n known keys to n unique slots with zero collisions. It is exact and requires `O(log n)` bits per key — better than Bloom's `1.44 log_2(1/p)`. But:

- PHF is static: cannot add new keys.
- PHF requires the key set in advance to construct.
- PHF cannot tell you "x is not in the set" without checking; Bloom can.

For static read-mostly sets, MPHF (minimal perfect hash function) is often a better choice. For dynamic sets, Bloom is the standard.

### Q51. Why do Bloom filters never go extinct?

Because they are *exactly the right level of approximation* for a wide class of problems: massive memory savings, simple math, easy to implement, no false negatives. The trade-off (controlled false-positive rate) is acceptable in every cache, every database engine, every dedup system. New variants improve constants; the algorithm endures.

### Q52. What is the most common bug you've seen with Bloom filters?

Several candidates:

1. Sizing for current `n` without growth headroom.
2. Updating the filter before the source of truth (cache-aside violation).
3. Using the library without a mutex.
4. Treating Test=true as definitive without slow-path confirmation.
5. Forgetting `go test -race`.

Each has been written about in postmortems.

### Q53. Why doesn't Go's standard library include a Bloom filter?

Bloom filters are an *application-level* tool, not a runtime primitive. The standard library focuses on building blocks (hash maps, atomics, sync, hash functions); third-party libraries build the specialised structures on top. This is consistent with Go's philosophy: prefer composition over a kitchen-sink stdlib.

### Q54. If you had to add one feature to `bits-and-blooms/bloom/v3`, what would it be?

Plausible answers:

- Optional concurrent-safe variant (atomic-bitset).
- Built-in observed-FPR sampling.
- Snapshot versioning.
- Block-Bloom variant.
- Cuckoo filter for delete.

Each is a real gap in the library. A thoughtful candidate would justify the choice by use case.

### Q55. Where would a Bloom filter not work, and what would you use instead?

- Need exact answers: hash map or DB.
- Need enumeration: hash map.
- Need TTL per entry: time-windowed Bloom or cache with TTL.
- Need cardinality, not membership: HyperLogLog.
- Need frequency: Count-Min Sketch.
- Need similarity: MinHash.
- Need quantiles: t-digest.

Knowing the menu and when each applies is the staff-level signal.

### Q56. Walk me through how Cuckoo filter eviction works.

Each key has two possible buckets (b_1 = h(x); b_2 = b_1 XOR h(fp(x))). Inserting:

1. Try b_1: empty slot? Insert.
2. Try b_2: empty slot? Insert.
3. Otherwise: pick one of b_1, b_2; evict a random fingerprint; insert the new one in its slot.
4. The evicted fingerprint goes to its alternate bucket (computed by XOR'ing its current bucket index with its own fingerprint's hash).
5. Repeat until success or max attempts (typically 500).

If max attempts is exceeded, insertion fails. The filter is "too full."

The key property: given a fingerprint and *any* of its two buckets, you can compute the other bucket — no need to store the original key.

### Q57. How would you test that your concurrent Bloom filter implementation has no false negatives?

```go
func TestNoFalseNegatives(t *testing.T) {
    f := NewConcurrent(...)
    var wg sync.WaitGroup
    keys := make([]string, 100_000)
    for i := range keys {
        keys[i] = fmt.Sprintf("k%d", i)
    }
    for g := 0; g < 16; g++ {
        wg.Add(1)
        go func(g int) {
            defer wg.Done()
            for i := g; i < len(keys); i += 16 {
                f.Add([]byte(keys[i]))
            }
        }(g)
    }
    wg.Wait()
    for _, k := range keys {
        if !f.Test([]byte(k)) {
            t.Fatalf("false negative for %q", k)
        }
    }
}
```

Run with `-race`. The `wg.Wait()` establishes happens-before between all Adds and the subsequent Tests, so no false negatives should occur. Any failure indicates a real bug in the concurrency primitives.

### Q58. What does `go test -race` actually detect?

It tracks happens-before relationships and reports any concurrent read-write or write-write on the same memory location not separated by a happens-before edge. For Bloom filters, it catches:

- Add and Test happening concurrently without synchronisation.
- Two concurrent Adds touching the same bitset word without atomic ops.
- Marshal during Add.

False positives in the detector are rare; you should treat every report as a bug.

### Q59. Describe one production architecture you would design from scratch using Bloom filters.

A multi-tier cache for a user lookup service:

- L1: in-process LRU cache for hot users.
- L2: atomic Bloom filter for "user exists?"
- L3: Postgres for authoritative data.

Lookup flow:
1. Check L1; return if present.
2. Check L2; if "no", return 404 without touching DB.
3. Else, hit L3; populate L1.

Concurrency:
- L1: sharded `sync.Map` or `groupcache/lru` per shard.
- L2: atomic bitset; safe for thousands of goroutines.
- L3: connection pool with appropriate limits.

Observability:
- L1 hit rate, eviction rate.
- L2 fill, observed FPR, hit/miss.
- L3 query latency, error rate.

Rebuild:
- L1 rebuilds itself naturally.
- L2 rebuilds nightly from L3 scan.
- L3 is the source of truth.

This architecture handles 100k req/sec with sub-millisecond p99 on a modest server.

### Q60. What's the boring answer for "should we use a Bloom filter here?"

For most cases: "yes, with `bits-and-blooms/bloom/v3` and `sync.RWMutex`." The library is well-tested, the wrapper is correct, and the operational story is well-known. Reach for variants only when profiling demonstrates a need.

The boring answer is right more often than the clever one.

---

## Final Note

A Bloom filter interview is a microcosm of an engineering interview: depth on a small structure, breadth on its applications, judgement on trade-offs. A candidate who can navigate junior to staff Bloom filter questions is signalling general engineering maturity.

Use this list to prepare; use the underlying material (junior through professional files) to build the understanding that supports the answers.
