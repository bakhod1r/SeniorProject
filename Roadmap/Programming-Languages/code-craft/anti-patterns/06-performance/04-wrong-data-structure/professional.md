# Wrong Data Structure — Professional Level

> **Category:** [Performance Anti-Patterns](../README.md) → **Wrong Data Structure** — *a collection whose cost model fights the access pattern.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Constant Factors and Cache Locality: Array-of-Structs vs Map-of-Pointers](#constant-factors-and-cache-locality-array-of-structs-vs-map-of-pointers)
4. [Amortized vs Worst-Case: Hash Resize and Dynamic-Array Growth](#amortized-vs-worst-case-hash-resize-and-dynamic-array-growth)
5. [Specialized Structures and When They Pay Off](#specialized-structures-and-when-they-pay-off)
6. [Concurrent Structures: The Cost Model Changes](#concurrent-structures-the-cost-model-changes)
7. [The Memory-vs-Time Trade](#the-memory-vs-time-trade)
8. [The "Right Big-O, Wrong Constants" Trap](#the-right-big-o-wrong-constants-trap)
9. [Benchmarking the Real Workload](#benchmarking-the-real-workload)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The deep trade-offs** — constant factors and cache lines, amortized vs worst-case behavior, specialized structures (bitset, trie, Bloom filter, ring buffer), concurrent collections, the memory-for-time deal, and how to benchmark the *actual* workload so the numbers, not intuition, choose.

`senior.md` established that cache locality and the small-n crossover can override asymptotic complexity. This file goes all the way down. The professional doesn't ask "which structure has the best big-O?" — they ask "given my key distribution, my read/write ratio, my n, my latency-vs-throughput goal, my memory budget, and my concurrency model, which structure measurably wins, and what's its worst case?"

Two disciplines define this level:

1. **Big-O is a screening filter, not the decision.** It eliminates the quadratic catastrophes. Among the survivors, the winner is decided by constant factors — cache misses, hash quality, allocation, lock contention — none of which big-O can see. Every claim below comes with the instrument that proves it on *your* code; illustrative numbers are labeled.
2. **Know the worst case, not just the average.** Hash maps are O(1) *amortized average* and O(n) worst case (resize, adversarial collisions). For a p99 latency SLO or an adversarial input, the worst case is the number that matters.

> **The mental model:** a data structure is a contract with three optimizers you don't see — the **CPU** (caches, prefetcher, branch predictor), the **allocator/GC**, and (under concurrency) the **cache-coherence protocol**. The "wrong structure" breaks the assumptions one or more of them rely on, and the cost shows up as constant-factor slowdown that big-O is blind to.

---

## Prerequisites

- **Required:** Fluent with `senior.md` — profiling the hot scan, preprocess-once, cache-locality, and the small-n crossover.
- **Required:** Comfortable reading `benchstat`/JMH output and a CPU profile, and telling signal from noise (variance, warmup, dead-code elimination).
- **Required:** Mental model of a managed runtime — heap vs stack, a tracing GC's scan cost being proportional to live pointer count, hash-map resize/rehash.
- **Helpful:** CPU microarchitecture basics — 64-byte cache lines, ~100-cycle miss penalty, false sharing, branch misprediction, and the `profiling-techniques` and `memory-leak-detection` skills.

---

## Constant Factors and Cache Locality: Array-of-Structs vs Map-of-Pointers

The deepest constant-factor lever is **memory layout**. Two structures with identical big-O for an operation can differ by 10× because one keeps data contiguous and the other scatters it.

Consider summing a field over a million records.

```go
// AoS, contiguous values: the GC scans no pointers; iteration streams cache lines.
type User struct {
    ID      int64
    Balance int64
    Age     int32
    _       int32 // padding to keep it tidy
}
func sumBalances(us []User) (sum int64) {
    for i := range us {        // sequential; prefetcher nails it
        sum += us[i].Balance
    }
    return
}

// Map of pointers: each *User is a separate heap allocation, scattered.
func sumBalancesMap(m map[int64]*User) (sum int64) {
    for _, u := range m {      // random heap order; a cache miss per element
        sum += u.Balance
    }
    return
}
```

**Illustrative benchstat (1M users, Go, x86):**

| Layout | Time | Why |
|---|---|---|
| `[]User` (contiguous values) | ~0.5 ms | sequential reads, prefetched, ~1 miss / cache line |
| `map[int64]*User` (scattered pointers) | ~14 ms | hash walk + pointer deref + ~1 miss / element |

A **28× gap** for an operation both do in "O(n)." Big-O hid all of it. The map *also* costs the GC: every `*User` is a pointer the tracing collector must follow, so a map-of-pointers lengthens GC pauses in proportion to its size, while the `[]User` (no internal pointers) is scanned as one opaque block.

**The structure-of-arrays (SoA) extreme.** If you only ever touch `Balance`, store balances in their own slice so the cache line carries *only* the field you use, not the whole struct:

```go
balances []int64   // touching only this field: ~8 balances per 64-byte line wasted on nothing
```

For a million-row analytical scan, SoA can beat AoS by another 2–4× because no cache line carries unused fields. This is why columnar databases exist. The lesson scales down to your hot loop: **the right structure puts the bytes you touch next to each other.**

---

## Amortized vs Worst-Case: Hash Resize and Dynamic-Array Growth

"O(1) append" and "O(1) insert" are **amortized** claims. The amortization hides occasional expensive operations, and for tail-latency-sensitive code those spikes are the whole story.

**Dynamic array growth.** A slice/`ArrayList` doubles its backing array when full: most appends are O(1), but the doubling append copies all n elements — O(n). Amortized O(1), worst-case O(n). Two consequences:

- **Pre-size when you know the size.** `make([]T, 0, n)` / `new ArrayList<>(n)` / list comprehension avoids the log-n reallocations and copies entirely. In a hot builder this is a measurable, free win.
- **A latency-sensitive append can spike** exactly when the array doubles. For p99-critical paths, a pre-sized or fixed-capacity ring buffer removes the spike.

```go
// Pre-sizing eliminates ~log2(n) reallocations and their O(n) copies.
out := make([]Result, 0, len(input))   // one allocation, zero regrowth
for _, x := range input {
    out = append(out, process(x))
}
```

**Hash-map resize.** A hash map grows (and rehashes every key) when its load factor crosses a threshold. That single insert is O(n). Worse, **a single resize can blow a latency budget**: inserting into a 10M-entry map that happens to trigger a rehash pauses for the rehash. Mitigations: pre-size the map (`make(map[K]V, n)`), or use an incremental-rehash implementation (Go's runtime rehashes gradually; Java's `HashMap` does not — it rehashes in one shot).

**Adversarial worst case.** A hash map is O(1) *average* assuming good hash distribution. With colliding keys (accidental, or attacker-chosen — hash-flooding DoS), every operation degrades toward O(n) as a bucket becomes a list. Defenses: randomized hash seeds (Go and modern Java string hashing do this), and Java 8+ converting long collision chains to balanced trees (O(log n) worst case per bucket instead of O(n)). **For untrusted keys, a tree map's guaranteed O(log n) can be safer than a hash map's O(1)-average / O(n)-worst.**

> The professional habit: quote the **worst case** alongside the average. "O(1) amortized average, O(n) on resize, O(n) under collision" is the honest cost of a hash map — and which number matters depends on whether you're optimizing throughput or p99.

---

## Specialized Structures and When They Pay Off

Past the general-purpose set/map/heap lies a tier of structures that win big on specific access patterns. Knowing they exist is what separates "use a map" from "use the *right* thing."

| Structure | Beats the generic option when | Cost model | Trade |
|---|---|---|---|
| **Bitset** | Membership/set ops over a dense integer domain | O(1) test/set; n/64 *bits* of memory; AND/OR whole sets in O(n/64) words | Keys must be small dense ints |
| **Trie / radix tree** | Prefix queries, autocomplete, longest-prefix-match (routing tables) | O(L) by key length, not O(n); shared prefixes save memory | More memory per node than a hash for non-prefix workloads |
| **Bloom filter** | Membership over huge sets where false positives are tolerable | O(1), fixed tiny memory regardless of n | Probabilistic: false positives, no deletion, no enumeration |
| **Ring buffer** | Bounded FIFO / sliding window, fixed capacity | O(1) both ends, zero allocation after init, cache-friendly | Fixed capacity; overwrites or blocks when full |
| **Skip list / B-tree** | Sorted + concurrent, or disk-resident ordered data | O(log n) ordered ops; B-tree is cache/page friendly | More complex than a hash map |

**Bitset, concretely.** Tracking which of a million dense ids are "active": a `map[int]bool` costs ~tens of bytes per entry; a bitset costs 1 *bit* per id — a million ids in 125 KB, fits in L2 — and set intersection becomes a word-wise AND.

```java
// "active AND premium" over a million users: word-wise AND vs hashing every id.
BitSet active = ...;    // 1 bit per user id
BitSet premium = ...;
active.and(premium);    // O(n/64) — intersect a million users in ~16K word ops
```

**Bloom filter, concretely.** "Have I already crawled this URL?" over a billion URLs: an exact set needs O(n) memory (tens of GB); a Bloom filter sized for a 1% false-positive rate needs ~9.6 bits per element (~1.2 GB) and answers in O(1). The false positives cost you a few redundant fetches — a fine trade to fit in RAM. (A false negative never happens, which is what makes it safe as a "definitely-not-seen" filter in front of an exact store.)

**The rule:** specialized structures are not premature optimization *when the access pattern is their exact use case* — a routing table genuinely wants a trie; a dense-int membership set genuinely wants a bitset. Using them speculatively, where a map would do, *is* over-engineering. Match the structure to the operation, as always — these just give you more operations to match.

---

## Concurrent Structures: The Cost Model Changes

Under concurrency the cost table you memorized is wrong, because the dominant cost is no longer the operation — it's **contention and cache-line coherence traffic**.

- **A mutex-guarded map** serializes all access; the "O(1) lookup" becomes "O(1) lookup *plus* wait for the lock." Under high read concurrency, the lock — not the hash — is the bottleneck.
- **Sharded / striped maps** (Java `ConcurrentHashMap`, Go `sync.Map` for its niche, sharded `map`+`RWMutex`) split the keyspace so threads contend only when they touch the same shard. The right structure for a concurrent map is "many small maps," not "one big locked map."
- **False sharing** silently destroys throughput: two threads writing *different* fields that share a 64-byte cache line ping-pong that line between cores. Pad hot per-thread counters to their own cache line. This is a *layout* decision — a wrong structure (packed counters) causing a coherence-traffic cost big-O can't model.
- **Lock-free structures** (e.g., a Treiber stack, a `ConcurrentLinkedQueue`) trade contention for retry loops; they win under contention but lose to a simple slice when single-threaded. Measure under the *real* thread count.

```go
// Sharded counter map: threads contend only within a shard, not globally.
type ShardedCounts struct {
    shards [256]struct {
        mu sync.Mutex
        m  map[string]int
        _  [40]byte // pad to push the next shard's mutex onto a new cache line
    }
}
func (s *ShardedCounts) Inc(key string) {
    sh := &s.shards[fnv(key)&255]
    sh.mu.Lock(); sh.m[key]++; sh.mu.Unlock()
}
```

> Under concurrency, **"wrong structure" includes "right structure, wrong sharing."** Benchmark at the production thread count; single-threaded microbenchmarks lie about concurrent collections.

---

## The Memory-vs-Time Trade

Almost every "right structure" fix spends memory to save time. That trade has limits, and the professional names them.

- **An index is a memory tax.** A `map[id]index` over n rows costs ~n entries of memory to make lookups O(1). Worth it when reads dominate; wasteful when the map is bigger than the data it indexes and queried twice.
- **Caching/memoization** is the trade made explicit: store computed answers (memory) to skip recomputation (time). Bounded by an eviction policy or it becomes a memory leak.
- **Bloom filters invert the trade** — they spend a *little* memory to *probabilistically* save time/IO, accepting error to fit a budget. That's the move when an exact structure won't fit in RAM at all.
- **Interning / deduplication** spends a lookup to *save* memory: one canonical copy of each repeated string instead of millions. The opposite direction — time for memory.

The professional question is never "more memory or less?" but **"what's the memory budget, and which structure buys the most time-savings (or fits at all) within it?"** A structure that's 2× faster but doesn't fit in the cache (or in RAM) is the wrong structure for that budget.

---

## The "Right Big-O, Wrong Constants" Trap

The subtlest mistake at this level: you correctly pick the asymptotically-better structure and *still* lose, because the constant factor went the wrong way.

Examples that bite in production:

- **`map[string]V` keyed by long strings** where the keys collide on a prefix: every lookup hashes the whole string *and* the comparison on collision walks it again. A different key (an interned id, a hash precomputed once) keeps the O(1) but slashes the constant.
- **A heap of boxed objects** (`PriorityQueue<Integer>` in Java): correct O(log n), but every comparison chases a pointer to a boxed `Integer` — a cache miss per comparison. A primitive-specialized heap (or an index heap over a value array) is the same big-O, a fraction of the constant.
- **A tree map** where you only ever do point lookups: O(log n) with pointer-chasing and cache misses at every level, losing to a hash map's O(1) — you paid for ordering you don't use.
- **Tiny n** (the `senior.md` crossover): O(1) hash with a cache miss loses to O(n) on 8 cache-resident ints.

The cure is the same every time: **once big-O has narrowed the field, the constant factor is decided by measurement.** Pick by asymptotics, then *profile the candidates on real keys at real sizes* and let the constants break the tie.

---

## Benchmarking the Real Workload

A microbenchmark that doesn't mirror production lies confidently. The professional benchmark reproduces the *workload*, not just the operation.

What "real workload" means:

1. **Real sizes.** Benchmark at production n (and 10×, to see the scaling). A structure that wins at n=1,000 can lose at n=10M (cache spills) or vice versa (crossover).
2. **Real key distribution.** Random keys, sequential keys, and adversarially-clustered keys produce different hash behavior. Use a sample of *production* keys.
3. **Real read/write ratio.** A read-heavy benchmark blesses a build-once index that a write-heavy workload would punish.
4. **Real access pattern.** Sequential vs random access changes cache behavior by an order of magnitude — benchmark the access pattern you actually have.
5. **Warmup and isolation.** JIT warmup (JMH `@Warmup`), avoid dead-code elimination (consume the result — `b.Keep`, JMH `Blackhole`), and pin/repeat to control variance (`benchstat` over multiple runs).

```go
// Benchmark across sizes AND key distributions — both move the winner.
func BenchmarkLookup(b *testing.B) {
    for _, n := range []int{8, 64, 512, 4096, 1 << 20} {
        for _, dist := range []string{"random", "sequential", "clustered"} {
            keys := genKeys(n, dist)
            b.Run(fmt.Sprintf("map/n=%d/%s", n, dist), func(b *testing.B) {
                m := buildMap(keys)
                b.ResetTimer()
                for i := 0; i < b.N; i++ {
                    sink = m[keys[i%n]]   // sink is package-level: defeats DCE
                }
            })
            // ... same for slice scan, tree map ...
        }
    }
}
```

Then `benchstat old.txt new.txt` to get means and confidence — never eyeball a single run. **The benchmark is the decision-maker; the cost table is just where you start.**

---

## Common Mistakes

1. **Trusting big-O to pick the winner.** It screens out quadratics; constant factors (cache, hashing, boxing, locks) decide among the rest. Measure.
2. **Quoting only the average case.** Hash maps are O(n) on resize and under collision; for p99 or untrusted keys, the worst case is the real number.
3. **`map[k]*V` for iteration-heavy work.** Pointer scatter and GC pressure; a `[]V` (or SoA) is dramatically cache-friendlier.
4. **Not pre-sizing.** Letting a slice or map regrow through every doubling pays repeated O(n) copies/rehashes that one capacity hint eliminates.
5. **Boxed primitives in hot collections.** A `PriorityQueue<Integer>` or `HashMap<Integer,…>` chases a pointer per element; a primitive-specialized structure keeps the big-O and cuts the constant.
6. **Single-threaded benchmarks for concurrent structures.** Contention and false sharing only appear under the real thread count.
7. **Specialized structures where a map would do.** A trie/Bloom/bitset off its exact use case is over-engineering; use them only when the access pattern is theirs.
8. **Spending memory you don't have.** A faster structure that doesn't fit in cache/RAM is the wrong structure for the budget.

---

## Test Yourself

1. Two ways to store a million users both iterate in "O(n)," but one is 28× slower. Which, and what *two* costs explain the gap (one CPU, one GC)?
2. "Append is O(1)." When is it O(n), and how do you avoid that cost when you know the final size?
3. Why might a tree map (O(log n)) be the *safer* choice than a hash map (O(1) average) for keys that come from untrusted input?
4. You need membership over a billion URLs and the exact set won't fit in RAM. What structure, what do you trade, and why is a false *negative* impossible?
5. A `PriorityQueue<Integer>` has the right O(log n) but benchmarks poorly. Name the constant-factor culprit and the fix.
6. Two threads incrementing different counters that sit in the same struct are slower than expected. What's happening and what's the fix?
7. Your slice-vs-map benchmark says "map always wins," but production is slower with the map. Name two ways the benchmark probably failed to mirror the real workload.

<details>
<summary>Answers</summary>

1. `map[int64]*User` is the slow one. **CPU cost:** the `*User`s are scattered across the heap, so iteration pointer-chases and takes ~1 cache miss per element (vs sequential, prefetched reads on a `[]User`). **GC cost:** every `*User` is a pointer the tracing GC must follow, lengthening pauses in proportion to map size; a `[]User` of pointer-free structs is scanned as one opaque block.
2. The O(1) is **amortized** — when the backing array fills, it doubles and copies all n elements (O(n)). Avoid it by **pre-sizing**: `make([]T, 0, n)` / `new ArrayList<>(n)`, which does one allocation and never regrows.
3. Hash maps are O(1) *average* but degrade to O(n) under colliding keys, and an attacker who controls keys can force collisions (hash-flooding DoS). A tree map guarantees **O(log n) worst case** regardless of keys, so its bounded worst case can beat the hash map's exploitable average.
4. A **Bloom filter** — O(1) checks in fixed, tiny memory (e.g., ~1.2 GB for a billion at 1% FP vs tens of GB exact). You trade exactness: false positives occur. A false *negative* is impossible because adding an element only *sets* bits, so a "not present" answer means none of its bits were set — it was genuinely never added. That's what makes it safe as a pre-filter in front of an exact store.
5. **Boxing/pointer-chasing:** each `Integer` is a heap object, so every heap comparison dereferences a pointer (likely a cache miss). Fix: a primitive `int[]`-backed heap (or an index heap over a value array), or a primitive-collections library — same O(log n), far smaller constant.
6. **False sharing:** the two counters share a 64-byte cache line, so each write invalidates the other core's copy and the line ping-pongs between cores. Fix: pad each counter to its own cache line (or shard them).
7. Likely failures: (a) **wrong n** — benchmarked at a size below the crossover or one that fits in cache while production spills; (b) **wrong key distribution** — random keys in the benchmark vs clustered/colliding production keys; also wrong read/write ratio, or DCE eliminating the work being measured.

</details>

---

## Cheat Sheet

| Trade-off | Professional rule |
|---|---|
| Big-O vs reality | Big-O screens out quadratics; constants (cache, hash, boxing, locks) decide — measure |
| Average vs worst case | Quote both; p99 and untrusted keys care about the worst case |
| Layout | Contiguous values (AoS/SoA) beat scattered pointers; touch only the bytes you need |
| Amortized cost | Pre-size slices and maps to skip resize/rehash O(n) spikes |
| Specialized structures | Bitset (dense ints), trie (prefixes), Bloom (huge + approximate), ring (bounded FIFO) — only on their exact pattern |
| Concurrency | Shard the map; pad against false sharing; benchmark at real thread count |
| Memory vs time | Pick the structure that buys the most time within the memory budget; doesn't-fit = wrong |
| Benchmarking | Real n, real keys, real read/write ratio, real access pattern; `benchstat`, not eyeballs |

> **One rule:** *use big-O to eliminate the disasters, then let a benchmark on the real workload pick the winner — and always know the worst case.*

---

## Summary

- At the professional level, **big-O is a screening filter; constant factors decide.** Cache locality, hash quality, boxing, and lock contention — invisible to big-O — routinely make the asymptotically-equal or even asymptotically-worse structure the faster one.
- **Layout dominates constants.** Contiguous arrays-of-structs (and structure-of-arrays for analytical scans) beat maps-of-pointers by 10–30× on iteration, and cost the GC nothing per element. Touch only the bytes you use.
- **Amortized hides spikes.** Dynamic-array growth and hash resize are O(n) worst case; pre-size to remove the spike. Hash maps are O(n) under collision/adversarial keys; tree maps trade O(1)-average for a safe O(log n) worst case.
- **Specialized structures** (bitset, trie, Bloom filter, ring buffer) win decisively on their exact access pattern and are over-engineering off it.
- **Concurrency rewrites the cost model:** contention and false sharing dominate; the right concurrent structure is sharded and cache-line-aware, and must be benchmarked at production thread count.
- Every fix spends **memory for time** (or, for Bloom/interning, the reverse); the budget, not the raw speed, decides what fits.
- The throughline of the whole topic: **name the operation, screen with big-O, then benchmark the real workload** — real sizes, keys, ratios, and access patterns — and let the numbers, never intuition, choose.

---

## Further Reading

- **Programming Pearls** — Jon Bentley (2nd ed., 1999) — and its sequel *More Programming Pearls*; the performance columns on measuring before choosing and the space-time trade.
- **Introduction to Algorithms (CLRS)** — Cormen, Leiserson, Rivest, Stein (3rd ed.) — Ch. 11 (Hashing, including universal/perfect hashing), Ch. 17 (Amortized Analysis), Ch. 6 (Heaps).
- **What Every Programmer Should Know About Memory** — Ulrich Drepper (2007) — cache lines, prefetching, false sharing; the basis for the layout arguments here.
- **Space/Time Trade-offs in Hash Coding with Allowable Errors** — Burton Bloom (1970) — the original Bloom filter paper.
- **Language docs:** Go `container/heap`, `sync.Map`, and the runtime map implementation notes; Java `ConcurrentHashMap` and `HashMap` (treeification) Javadoc and JMH; Python `cProfile`, `array`, and `heapq`.

---

## Related Topics

- [Premature Optimization Traps](../01-premature-optimization-traps/professional.md) — the discipline of measuring before reaching for a specialized structure.
- [N+1 in Code](../02-n-plus-one-in-code/professional.md) — batching and preloading; the I/O analogue of preprocessing into the right structure.
- [Unnecessary Allocation](../03-unnecessary-allocation/professional.md) — boxing, pointer-vs-value layout, and GC pressure, which this topic shares.
- [Bad Structure (Development)](../../01-development/01-bad-structure/professional.md) — what structural anti-patterns cost the runtime and toolchain.
- [Architecture Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — choosing the wrong *store* (the system-scale version of choosing the wrong collection).
- The `hash-table-design`, `big-o-analysis`, and `profiling-techniques` skills — hash internals and worst cases, scaling analysis, and the benchmarking discipline.
