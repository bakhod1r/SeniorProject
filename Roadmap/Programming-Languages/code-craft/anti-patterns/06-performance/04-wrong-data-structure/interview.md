# Wrong Data Structure — Interview Questions

> **Category:** [Performance Anti-Patterns](../README.md) → **Wrong Data Structure** — *a collection whose cost model fights the access pattern.*

---

These questions probe whether you can **choose the right collection for an access pattern** and *justify it with the cost model* — not just recite "use a hash map." They run from fundamentals (the cost table) through the subtle senior judgment (cache locality beats big-O, the small-n crossover, amortized vs worst case). Each answer is what a strong candidate would say out loud.

> **How to use this file:** cover the answer, say yours aloud, then compare. The gap is usually in the *trade-off* — interviewers reward "set, *because* membership goes O(n) → O(1), *but* for n under ~16 a slice scan wins, so I'd measure."

---

## Table of Contents

- [Fundamentals — The Cost Model](#fundamentals--the-cost-model)
- [Choosing for an Access Pattern](#choosing-for-an-access-pattern)
- [Membership, Lookup, and Joins](#membership-lookup-and-joins)
- [Heaps, Queues, and Ordering](#heaps-queues-and-ordering)
- [Cache Locality and Constant Factors](#cache-locality-and-constant-factors)
- [Amortized, Worst-Case, and Crossover](#amortized-worst-case-and-crossover)
- [Specialized Structures](#specialized-structures)
- [Judgment and Review](#judgment-and-review)

---

## Fundamentals — The Cost Model

**1. What is the "Wrong Data Structure" anti-pattern in one sentence?**

Picking a collection whose operations don't match how you use it, so a hot operation runs in the structure's slow column — turning O(1)/O(log n) work into O(n)/O(n²) — even though the code is correct.

**2. Why does this anti-pattern survive code review and tests?**

Each line looks cheap (`x in list` reads like one operation), the code is *correct*, and test fixtures are small enough that an O(n·m) shape never shows. The cost is latent in the *shape* and only detonates at production scale.

**3. Give the cost of these on a list/array: index, append, membership, find-by-key.**

Index by position O(1); append O(1) amortized; membership (`contains`) O(n); find-by-key O(n) (a scan). The two O(n)s are where the anti-pattern lives.

**4. What's the average-case cost of membership, insert, and lookup-by-key on a hash set/map?**

All O(1) average. The caveats: O(n) on resize (amortized away) and O(n) worst case under collisions/adversarial keys.

**5. When does a tree map (sorted map) beat a hash map?**

When you need **ordered iteration** or **range/nearest queries** (floor/ceiling), or a **guaranteed O(log n) worst case** for untrusted keys. You pay O(log n) instead of O(1) average and lose cache locality; take it only when you use the ordering or need the worst-case guarantee.

**6. What's the single question that drives structure choice?**

"What's the operation I perform *most often*?" Find that operation's cheapest row in the cost table and pick that structure — then preprocess into it once.

---

## Choosing for an Access Pattern

**7. You build a collection once at startup and only ever check membership. Which structure?**

A **set**. Build once (O(n)), then every check is O(1) average. If you also need an associated value, a map.

**8. You need to repeatedly fetch a record by id from 100k records. Which structure and why not a list?**

A **map keyed by id** — O(1) lookups. A list forces an O(n) scan per lookup; q lookups against n records is O(n·q), effectively quadratic.

**9. You need both fast lookup by key *and* iteration in insertion order. What do you do?**

Keep **two structures in sync**: a slice/list of values for ordered, cache-friendly iteration plus a `map[key]index` maintained on every write. (Or a language's insertion-ordered map — Python `dict`, Java `LinkedHashMap` — which gives both at some memory cost.)

**10. You need lookup by key *and* sorted iteration. One structure?**

A **tree map** (`TreeMap`, C++ `std::map`, Go via an ordered-map library or a sorted slice + binary search) — O(log n) lookup, O(n) sorted iteration with no extra sort.

**11. The access pattern is "add to one end, remove from the other." Which structure?**

A **deque** (double-ended queue) or ring buffer — O(1) at both ends. A list used this way has an O(n) front operation.

**12. When is a plain list/array actually the right choice despite a set's O(1) membership?**

When **n is small** (below the measured crossover, often ~8–32), when you need **positional indexing** or **insertion order**, or when you build it and iterate once but never query by value. Cache-friendly contiguous storage and zero hashing overhead win there.

---

## Membership, Lookup, and Joins

**13. Walk through why `for x in A: if x in B_list` is O(n·m) and how to fix it.**

For each of the m elements of A, `x in B_list` scans up to n elements of B — n·m comparisons. Fix: build `B_set = set(B)` once (O(n)), then each `x in B_set` is O(1), making the whole thing O(n + m).

**14. A junior "optimizes" by writing `if x in set(B)` inside the loop. What happens?**

It gets *worse*: `set(B)` rebuilds the whole set on every iteration, paying O(n) m times — O(n·m) just to build, plus the lookups. The set must be built **once, outside** the loop.

**15. What's a hash join and when do you use it in application code?**

Matching two collections by key. Build a hash index of the *smaller* collection once (O(m)), then probe it while scanning the larger (O(n)) — O(n + m) total, vs O(n·m) for a nested-loop join. It's exactly what a database does when it chooses a hash join.

**16. Why hash the *smaller* collection in a hash join?**

The hash table holds the smaller side, so it uses less memory and is more likely to stay in cache; you probe it with the larger stream. Either side is correct asymptotically, but hashing the smaller one minimizes memory and cache pressure.

**17. You see `list.index(x)` or `indexOf` called in a loop. What's the smell?**

Repeated O(n) search → O(n²). If you're looking things up by value/key repeatedly, you want a set or map, not repeated linear searches.

---

## Heaps, Queues, and Ordering

**18. You repeatedly need the minimum of a changing collection. Re-sort each time or use a heap?**

A **heap** (priority queue). Re-sorting is O(n log n) per query; a heap gives O(1) peek of the min and O(log n) to pop/insert while maintaining it.

**19. Find the top 10 of a billion-item stream. How, and what's the complexity?**

A **bounded min-heap of size 10**: stream through once, push if smaller than 10 elements so far, else replace the min if the new item beats it. O(n log k) time, O(k) memory — never materialize or sort the billion. (`heapq.nlargest` / a size-k `PriorityQueue`.)

**20. Why is `sorted(stream)[:k]` worse than the heap for top-k?**

It's O(n log n) time (sorting everything) and O(n) memory (holding everything). The heap is O(n log k) and O(k) — for k ≪ n, dramatically less of both.

**21. Why is using a list as a FIFO queue (`pop(0)`) a bug at scale?**

`pop(0)` removes the front, forcing every remaining element to shift down one index — O(n) per pop, O(n²) to drain. Use a `deque`/`ArrayDeque` (O(1) `popleft`).

**22. In Go, why is `q = q[1:]` a subtle queue mistake?**

It's O(1) in *time* but pins the original backing array in memory — the dropped front elements aren't garbage-collected because the slice still references the underlying array. A long-lived queue leaks memory; use a ring buffer or a head index with periodic compaction.

---

## Cache Locality and Constant Factors

**23. Big-O says a linked list's O(1) insert beats an array's O(n). Why does the array usually win in practice?**

**Cache locality.** An array is contiguous, so traversal streams sequential cache lines with hardware prefetching (~1 miss per 64 bytes). A linked list pointer-chases scattered heap nodes — ~1 cache miss per node, and a miss costs ~100× an L1 hit. The list's O(1) insert is theoretical; the array wins unless n is huge, you already hold the node, and inserts dominate traversals.

**24. Two structures both iterate in O(n) but one is 28× slower. How?**

`[]Struct` (contiguous values) vs `map[k]*Struct` (scattered pointers). The map pointer-chases across the heap (cache miss per element) and hashes/derefs each access; the slice streams sequentially. Same big-O, wildly different constant — plus the map's pointers cost the GC per element.

**25. What is structure-of-arrays (SoA) and when does it beat array-of-structs (AoS)?**

SoA stores each field in its own array; AoS stores whole records contiguously. SoA wins on analytical scans that touch *one* field, because each cache line carries only that field — no bytes wasted on unused fields. It's why columnar databases exist.

**26. Why might `PriorityQueue<Integer>` in Java be slower than its O(log n) suggests?**

Boxing: each `Integer` is a heap object, so every heap comparison dereferences a pointer (likely a cache miss). A primitive `int[]`-backed heap is the same O(log n) with a far smaller constant.

---

## Amortized, Worst-Case, and Crossover

**27. "Append is O(1)." When is it actually O(n)?**

It's *amortized* O(1). When a dynamic array fills, it doubles and copies all n elements — that append is O(n). Pre-sizing (`make([]T,0,n)`, `new ArrayList<>(n)`) avoids the log-n reallocations entirely.

**28. A hash map is O(1) average. Name two situations where it's effectively O(n).**

(1) **Resize/rehash** when the load factor is exceeded — that insert rehashes every key, O(n). (2) **Collisions** — adversarial or unlucky keys pile into one bucket; a chain degrades toward O(n) (Java 8+ treeifies long chains to O(log n)). For p99 latency or untrusted keys, these worst cases matter.

**29. What is the small-n crossover, and how do you find it?**

The n below which a linear scan of a contiguous slice beats a hash lookup — because hashing plus a likely cache miss costs more than comparing a few cache-resident elements. Find it by benchmarking both structures across a sweep of sizes (e.g., 4…256) and seeing where the curves cross; typically ~8–32 for small keys, but you measure for your key type and hardware.

**30. Why can a tree map (O(log n)) be safer than a hash map (O(1) average) for untrusted input?**

A hash map degrades to O(n) under attacker-chosen colliding keys (hash-flooding DoS). A tree map guarantees O(log n) worst case regardless of keys, so its bounded worst case can beat the hash map's exploitable average for security-sensitive paths.

---

## Specialized Structures

**31. When does a bitset beat a hash set?**

For membership/set operations over a **dense integer domain**. A bitset stores 1 bit per id (a million ids in 125 KB, fits in L2) and does intersection/union as word-wise AND/OR — O(n/64) words. A `map[int]bool` costs tens of bytes per entry and can't do set algebra cheaply.

**32. When is a Bloom filter the right structure, and what do you trade?**

Membership over a huge set where a small false-positive rate is acceptable and an exact set won't fit in memory (e.g., "have I crawled this URL?" over a billion URLs). You trade exactness: it can report a false positive but never a false negative, and it can't enumerate or delete. Fixed tiny memory, O(1) checks.

**33. Why is a false negative impossible in a Bloom filter?**

Adding an element only ever *sets* bits. So if a query finds any of the element's bits unset, the element was definitely never added — a "not present" answer is always true. Only "present" can be wrong (a false positive).

**34. What access pattern makes a trie the right choice?**

Prefix queries: autocomplete, longest-prefix-match (IP routing tables), or dictionary lookups where keys share prefixes. Lookup is O(L) in key length (not O(n) in entries), and shared prefixes save memory.

**35. When is a ring buffer the right structure?**

A **bounded FIFO** or sliding window with fixed capacity — O(1) at both ends, zero allocation after init, cache-friendly contiguous storage. Ideal for fixed-size queues, recent-event windows, and lock-free single-producer/single-consumer channels.

---

## Judgment and Review

**36. Before converting a list to a map for speed, what should you do?**

**Profile.** Confirm the scan is an actual hotspot. "Maps feel faster" leads to converting cold paths for no measured gain — that's premature optimization with a memory cost. Fix the scan the profiler points to, then measure again.

**37. In a CPU profile, what's the fingerprint of a wrong-structure hotspot?**

A `contains`/equality/linear-search function with a **tiny per-call time but huge cumulative time**, called an O(n²)-ish number of times. Cheap per call, enormous in aggregate = a scan inside a loop.

**38. In review with no profile, what shapes do you flag?**

`contains`/`indexOf`/`find` inside a loop over another collection; `.sort()` inside a repeatedly-called function; `pop(0)`/`remove(0)`/`insert(0,…)`; nested loops matching two collections by key; `map[k]*V` that's only iterated, never looked up. And the reverse — a needless map over five elements.

**39. How do you avoid a build-once index going stale when the data mutates?**

Maintain it **incrementally** (every write updates the index too — right when reads dominate), or **rebuild on a cadence** (once per batch of writes). A silently-stale index is a correctness bug, not just a perf one.

**40. Someone benchmarks "map vs slice" and concludes "map always wins," but production is slower with the map. What likely went wrong?**

The benchmark didn't mirror the workload: wrong n (below the crossover, or fits in cache while production spills), wrong key distribution (random vs clustered/colliding production keys), wrong read/write ratio, or dead-code elimination removing the work. Benchmark real sizes, keys, and access patterns; use `benchstat` over multiple runs, not a single eyeballed number.

**41. Summarize the decision procedure for picking a collection.**

Name the hottest operation → find its cheapest row in the cost table → that's your candidate structure → preprocess into it once → for anything performance-critical, **benchmark the real workload** (real n, keys, ratio, access pattern) and let the numbers, not intuition, confirm — knowing big-O screens out the disasters but constants (cache, hashing, locks) decide among the survivors.

---

## Related Topics

- [`junior.md`](junior.md) · [`middle.md`](middle.md) · [`senior.md`](senior.md) · [`professional.md`](professional.md) — the full progression these questions sample.
- [`tasks.md`](tasks.md) · [`find-bug.md`](find-bug.md) · [`optimize.md`](optimize.md) — practice the choices hands-on.
- [Premature Optimization Traps](../01-premature-optimization-traps/interview.md) — the "measure first" discipline these answers assume.
- The `big-o-analysis`, `hash-table-design`, and `profiling-techniques` skills — the cost model, hash internals, and measurement vocabulary behind every answer.
