# Wrong Data Structure — Senior Level

> **Category:** [Performance Anti-Patterns](../README.md) → **Wrong Data Structure** — *a collection whose cost model fights the access pattern.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Find the Hot Scan First: Profiling, Not Guessing](#find-the-hot-scan-first-profiling-not-guessing)
4. [Preprocess Once vs Per-Query: Where to Pay the O(n)](#preprocess-once-vs-per-query-where-to-pay-the-on)
5. [The Cache-Locality Trade-Off: Why Arrays Beat the "Better" Big-O](#the-cache-locality-trade-off-why-arrays-beat-the-better-big-o)
6. [The Small-n Crossover: When the Worse Big-O Wins](#the-small-n-crossover-when-the-worse-big-o-wins)
7. [Spotting It in Code Review](#spotting-it-in-code-review)
8. [Immutable and Streaming Variants](#immutable-and-streaming-variants)
9. [Common Mistakes](#common-mistakes)
10. [Test Yourself](#test-yourself)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Choosing well in a real codebase** — finding the hot scan with a profiler, deciding *where* to pay the preprocessing cost, the cache-locality trade-off that makes arrays beat "better" structures, and the small-n crossover where the worse big-O actually wins.

`middle.md` gave you the cost table and the canonical fixes. In a textbook, that's the whole story: pick the structure with the best big-O, done. In a real codebase it isn't, for three reasons that define this level.

First, **you have to find the scan before you can fix it** — and the O(n·m) loop is rarely where you'd guess. Second, **big-O hides constant factors**, and on modern hardware those constants — dominated by cache behavior — routinely flip the "obviously correct" choice: a linear scan of a contiguous array can crush a hash lookup for small n, because the array is one cache line and the hash map is a scavenger hunt through pointer-chased memory. Third, **the right structure depends on how long it lives and how it's shared**: a map you build once and query a million times is a great deal; a map you build to answer one query is pure overhead.

The senior skill is not "know the best big-O." It's **measure the actual workload, on the actual data sizes, on the actual hardware, and pick the structure that wins there** — which is sometimes the one with the worse asymptotic complexity.

> **The mental model:** big-O tells you how cost *scales*; it says nothing about the *constant* in front, and on real hardware that constant is mostly about memory locality. Use big-O to rule out the quadratic disasters, then *measure* to choose among the survivors.

---

## Prerequisites

- **Required:** Fluent with `middle.md` — the cost table and the five canonical fixes are second nature.
- **Required:** You can capture and read a CPU profile (Go `pprof`, Java async-profiler/JFR, Python `py-spy`/`cProfile`) and a benchmark comparison (`benchstat`, JMH, `pyperf`). The `profiling-techniques` skill is the companion.
- **Required:** A working mental model of the memory hierarchy: registers → L1/L2/L3 cache (~64-byte lines) → RAM, and that a cache miss costs ~100× an L1 hit.
- **Helpful:** Familiarity with your language's memory layout — Go structs vs pointers, Java object headers and reference indirection, Python's everything-is-a-boxed-object model.

---

## Find the Hot Scan First: Profiling, Not Guessing

The wrong-structure bug is *diffuse*. There's no single slow line — there's an O(n) scan called from a loop, and the time is smeared across millions of calls. It hides from code reading because each call looks cheap. The profiler is how you find it.

**The signature in a profile:** a `contains` / equality-comparison / linear-search function sitting at the top of the flat profile with a huge cumulative time and a tiny per-call time. That combination — *cheap per call, enormous in aggregate* — is the fingerprint of a structure mismatch inside a loop.

```text
# Go pprof — top, cum sorted (illustrative)
      flat  flat%   cum   cum%
   18.20s  61.3%  18.20s  61.3%  pkg.(*Index).contains   ← linear scan, called per item
    3.10s  10.4%  29.60s  99.7%  pkg.reconcile
```

`contains` at 61% with a trivial body is the tell. Confirm it's a structure problem (not a genuinely expensive computation) by checking the call count — if it's invoked O(n²) times, you have a wrong-structure hotspot, not a slow function.

> **Don't refactor structures you haven't profiled.** A map "feels faster" everywhere, but converting cold-path lists to maps adds memory, allocation, and complexity for no measured gain — that's [Premature Optimization](../01-premature-optimization-traps/senior.md). Profile, find the hot scan, fix *that one*, measure again.

---

## Preprocess Once vs Per-Query: Where to Pay the O(n)

Building the right structure costs an O(n) pass. The question is *who pays it and how often*. This is the decision that separates a real win from a wash.

Let `n` = collection size, `q` = number of queries:

| Strategy | Cost | Wins when |
|---|---|---|
| Scan per query (no index) | O(n·q) | `q` is tiny (1–2) or `n` is small |
| Build index once, reuse | O(n + q) | `q` is large and the data is stable |
| Rebuild index every query | O(n·q + index overhead) | **never** — strictly worse than scanning |

The trap in the middle is real: people build the map *inside* the loop, paying the O(n) build `q` times. The whole point is to **hoist the build to where the data stabilizes** — outside the loop, at construction time, or memoized.

**The harder real-world case: the data mutates.** If the collection changes between queries, a build-once index goes stale. Options:

- **Maintain incrementally.** Keep the map and the list in sync — every insert updates both. Cost shifts to write-time, which is right if reads dominate (the usual case).
- **Rebuild on a cadence.** If reads come in bursts after a batch of writes, rebuild once per batch, not per query.
- **Stay with a scan** if writes dominate and `n` is small — the index's maintenance cost may exceed what it saves.

```go
// A read-optimized collection: writes keep the index in sync so reads are O(1).
type UserStore struct {
    users  []User           // ordered iteration, source of truth
    byID   map[int]int      // id -> slice index, kept in sync on every write
}

func (s *UserStore) Add(u User) {
    s.byID[u.ID] = len(s.users)   // O(1) index maintenance at write time
    s.users = append(s.users, u)
}

func (s *UserStore) Get(id int) (User, bool) {
    if i, ok := s.byID[id]; ok {  // O(1) read — the common case
        return s.users[i], true
    }
    return User{}, false
}
```

This pattern — **keep two structures in sync, each fast at a different operation** — is the senior answer when one structure can't serve every access pattern (ordered iteration *and* O(1) key lookup). You pay a little memory and a little write-time bookkeeping to make the hot reads cheap.

---

## The Cache-Locality Trade-Off: Why Arrays Beat the "Better" Big-O

Here is where the textbook lies to you. A linked list and an array both store n elements; the linked list has O(1) insert-anywhere and the array has O(n). Big-O says the linked list is better for insert-heavy work. On real hardware, **the array usually wins anyway** — often by 10× — and big-O can't see why.

The reason is the memory hierarchy. An array is *contiguous*: walking it streams sequential cache lines, the prefetcher predicts your access, and you get ~64 bytes of useful data per memory fetch. A linked list is *scattered*: each `node.next` is a pointer to who-knows-where in the heap, so every step is a potential cache miss — ~100× slower than an L1 hit — and the prefetcher is blind.

```text
Traverse 1,000,000 ints (illustrative, modern x86):
  contiguous slice/array:  ~0.4 ms   (sequential, prefetched, ~1 miss / 16 ints)
  linked list (pointers):  ~12 ms    (pointer-chased, ~1 miss / node)
```

The same effect makes **array-of-structs beat map-of-pointers** for iteration-heavy workloads. A `[]User` is one tight block you stream through; a `map[int]*User` scatters the `User`s across the heap and adds a hash + indirection per access. If your hot operation is *iterating and computing*, not *random key lookup*, the slice wins decisively despite the map's O(1) lookup advantage — because you're not doing lookups, you're doing a scan, and the slice scans faster.

**Practical rules:**

- **Default to contiguous.** Slices/`ArrayList`/arrays of *values* are the cache-friendly default. Reach for pointer-linked or hash structures only when the access pattern demands them.
- **Linked lists are almost never the answer** in application code. Their O(1) insert is theoretical; the cache penalty erases it unless you're already holding the node and n is large.
- **For "lookup by key but also iterate fast,"** keep a slice of values plus a `map[key]index` (the pattern above) rather than a `map[key]*Value` — you get cache-friendly iteration *and* O(1) lookup.

> The senior point: **big-O ranks structures by how cost scales; cache locality often decides which one is actually faster at your n.** Use big-O to avoid quadratics; use a benchmark to choose between linear-but-contiguous and logarithmic-but-scattered.

---

## The Small-n Crossover: When the Worse Big-O Wins

A set's O(1) membership beats a list's O(n) — *asymptotically*. But O(1) for a hash set means "hash the key, mask to a bucket, follow the bucket, compare" — a dozen-ish instructions plus a likely cache miss. O(n) for a small contiguous slice means "compare a few ints that are already in L1." For small n, the slice wins.

There's a **crossover point** — the n below which the linear scan is faster. Below it, reaching for a set/map is not just unnecessary, it's *slower* and burns more memory. You find it by measuring, not guessing:

```go
// Benchmark linear slice scan vs map lookup across sizes; find where they cross.
func BenchmarkLookup(b *testing.B) {
    for _, n := range []int{4, 8, 16, 32, 64, 128, 256} {
        slice := makeSlice(n)
        m := makeMap(n)
        target := n - 1 // worst case for the scan: last element

        b.Run(fmt.Sprintf("slice/n=%d", n), func(b *testing.B) {
            for i := 0; i < b.N; i++ { _ = sliceContains(slice, target) }
        })
        b.Run(fmt.Sprintf("map/n=%d", n), func(b *testing.B) {
            for i := 0; i < b.N; i++ { _, _ = m[target] }
        })
    }
}
```

Typical result (illustrative — *measure yours*): for small integer/short-string keys the slice scan beats the map up to **n ≈ 8–32**, then the map pulls ahead and never looks back. The exact crossover depends on key type (hashing a string costs more than comparing an int), comparison cost, and hardware.

**Why this matters in practice:**

- A struct with a handful of fixed "tags" — store them in a slice, scan it. A `map[string]bool` there is slower and noisier.
- A function-local "have I seen this in these 5 items" — a slice scan is fine and clearer.
- A `switch` over a handful of constants beats a map dispatch for the same reason.

> The discipline: **don't cargo-cult the set/map.** For provably small, bounded n, a slice scan is faster, leaner, and simpler. Reserve hash structures for n past the measured crossover — which is most real collections, but not all of them.

---

## Spotting It in Code Review

You won't have a profile in a review, so you read for the *shape*. Flags worth a comment:

- **A `contains` / `indexOf` / `find` call inside a loop** over another collection → likely O(n·m). Ask: "what's n in production?"
- **A `.sort()` inside a function that's called repeatedly** → re-sorting per query; ask if a heap or a kept-sorted structure fits.
- **`pop(0)` / `remove(0)` / `insert(0, …)`** → O(n) front operations; a deque is almost always meant.
- **A nested loop matching two collections by an equality on keys** → a hash join in disguise.
- **`map[k]*V` that's only ever iterated, never looked up by key** → a `[]V` would be cache-friendlier; the map is the wrong choice.
- **A map/set built and used to answer a single query** → the O(n) build wasn't worth it; a scan was fine.

The two-sided review judgment: flag the O(n·m)-in-a-loop shapes, but *also* push back on a needless map over five elements. **The senior reviewer optimizes for the right n, in both directions** — neither a quadratic on big data nor a hash table on a five-element list.

---

## Immutable and Streaming Variants

Two real-world constraints change the calculus:

**Immutability.** If the structure must be immutable (shared across goroutines/threads, or a value-semantics API), a build-once-then-freeze index is ideal — you pay O(n) once and hand out a read-only map/slice that's safe to share with no locking. Persistent/immutable maps (structural sharing) give O(log n) "updates" that return a new version without copying everything; reach for them when you need versioned snapshots, not when a plain map will do.

**Streaming / unbounded data.** When you can't hold the whole collection in memory, structure choice shifts to *bounded* tools:

- **Top-k over a stream** → bounded min-heap of size k, O(k) memory (the `middle.md` pattern, now load-bearing because n doesn't fit).
- **Membership over a huge stream where a tiny false-positive rate is acceptable** → a **Bloom filter**: O(1) check in a fixed, tiny memory footprint instead of an O(n)-memory set (detailed in `professional.md`).
- **Sliding-window aggregates** → a ring buffer / monotonic deque, not re-scanning the window each step.

The principle is unchanged — match the structure to the operation — but the operation is now "process a stream within a memory bound," which rules out the build-the-whole-set answer.

---

## Common Mistakes

1. **Refactoring structures you never profiled.** "Maps are faster" leads to converting cold-path lists for no measured gain — premature optimization with a memory cost.
2. **Building the index per query instead of once.** Hoisting the O(n) build out of the loop *is* the optimization; rebuilding it inside defeats it entirely.
3. **Ignoring cache locality.** Choosing a linked list or `map[k]*V` for iteration-heavy work because big-O "looks better," then losing to a plain slice by 10×.
4. **Cargo-culting hash structures for tiny n.** A `map`/`set` over 5–8 elements is slower and heavier than a slice scan; below the crossover, the simple structure wins.
5. **Letting a build-once index go stale silently.** If the data mutates, either maintain the index incrementally or rebuild it on a clear cadence — a stale index is a correctness bug, not just a perf one.
6. **Holding the whole stream to answer a bounded question.** Top-k and membership over unbounded data want a heap or Bloom filter, not a materialized set.

---

## Test Yourself

1. A CPU profile shows `contains` at 55% cumulative with a 30 ns per-call body. What does that pattern tell you, and what do you check next?
2. You can build a key index once or scan per query. Give the big-O of each for `n` items and `q` queries, and the rule for choosing.
3. Big-O says a linked list's O(1) insert beats an array's O(n). Why does the array usually win in practice, and on what workload would the linked list actually win?
4. What is the "small-n crossover," and how do you find it for slice-scan vs map-lookup?
5. Your read-heavy store needs both ordered iteration and O(1) lookup by id. No single structure does both well. What do you do?
6. You must check membership against a stream of a billion ids and can tolerate a 0.1% false-positive rate. What structure, and what do you trade?

<details>
<summary>Answers</summary>

1. *Cheap per call, huge in aggregate* = a structure mismatch inside a loop (an O(n) scan called O(n) or O(q) times). **Check the call count** — if `contains` is invoked O(n²) times, replace the scanned collection with a set/map; if it's called a few times, it's not your bug.
2. Scan-per-query: **O(n·q)**. Build-once index: **O(n + q)**. Choose the index when `q` is large and the data is stable enough that the build amortizes; scan when `q` is tiny or `n` is small. Never rebuild the index per query (strictly worse).
3. The array is **contiguous**, so traversal streams sequential cache lines with prefetching (~1 miss per cache line); the linked list **pointer-chases** scattered heap nodes, ~1 cache miss per step (~100× an L1 hit). The list wins only when n is large, you're already holding the node, and inserts/deletes vastly outnumber traversals — rare in application code.
4. The n below which a linear scan of a contiguous slice beats a hash lookup (the hash + likely cache miss costs more than comparing a few cache-resident elements). Find it with a benchmark that sweeps n (e.g., 4…256) for both structures and reports where the curves cross — typically n ≈ 8–32 for small keys, but *measure yours*.
5. Keep **two structures in sync**: a slice of values for cache-friendly ordered iteration plus a `map[id]index` maintained on every write. Reads get O(1) lookup *and* fast iteration; the cost is a little write-time bookkeeping and memory, which is the right trade for read-heavy access.
6. A **Bloom filter** — O(1) checks in fixed, tiny memory. You trade exactness: it can report a false positive (says "present" when absent) but never a false negative, and it can't enumerate or delete. Acceptable precisely because a small false-positive rate is allowed.

</details>

---

## Cheat Sheet

| Decision | Senior answer |
|---|---|
| Where's the wrong-structure bug? | Profile; look for a cheap-per-call scan with huge cumulative time |
| Build index once or per query? | Once, hoisted out of the loop; per-query build is the classic mistake |
| Data mutates between queries? | Maintain the index incrementally (read-heavy) or rebuild per batch |
| Linked list vs array? | Array — contiguity and prefetch beat O(1) insert in practice |
| `map[k]*V` but only iterating? | Use `[]V` (or `[]V` + `map[k]int`) — cache locality |
| Tiny, bounded n? | Slice scan beats set/map below the measured crossover (~8–32) |
| Streaming / unbounded? | Bounded heap (top-k), Bloom filter (membership), ring (window) |

> **One rule:** *big-O rules out the quadratics; the benchmark on your real n and hardware picks the winner among what's left.*

---

## Summary

- In a real codebase, "pick the best big-O" is necessary but not sufficient. You must **find the hot scan with a profiler** (cheap-per-call, huge-in-aggregate is its fingerprint), then choose with a benchmark.
- **Pay the O(n) build once**, hoisted out of the loop; when the data mutates, maintain the index incrementally or rebuild per batch — never per query.
- **Cache locality routinely overrides big-O.** Contiguous arrays beat pointer-chased linked lists and `map[k]*V` for iteration-heavy work, often by 10×, because big-O can't see cache misses. Default to contiguous; keep a `slice + map[index]` when you need both iteration and key lookup.
- There's a **small-n crossover** below which a slice scan beats a hash structure. Don't cargo-cult sets/maps onto tiny bounded collections — measure and use the simpler structure when it wins.
- For **immutable or streaming** constraints, the operation changes ("process within a memory bound"), pointing to build-once-freeze indexes, bounded heaps, and Bloom filters.
- Next: [`professional.md`](professional.md) — *deep trade-offs: constant factors and cache lines in detail, amortized vs worst-case (hash resize, array growth), specialized structures (bitset, trie, Bloom, ring buffer), concurrent collections, and benchmarking the real workload.*

---

## Further Reading

- **Programming Pearls** — Jon Bentley (2nd ed., 1999) — Column 1 (the right structure shrinks the problem) and the performance columns on measuring before choosing.
- **Algorithms** — Robert Sedgewick & Kevin Wayne (4th ed., 2011) — Symbol Tables and Priority Queues, with empirical cost comparisons.
- **What Every Programmer Should Know About Memory** — Ulrich Drepper (2007) — the cache-hierarchy reference behind the locality arguments.
- **Language docs:** Go [pprof](https://go.dev/blog/pprof) and `container/heap`; Java JMH and the Collections framework; Python `cProfile` and `heapq`.

---

## Related Topics

- [Premature Optimization Traps](../01-premature-optimization-traps/senior.md) — profile before you convert structures; don't optimize cold paths.
- [N+1 in Code](../02-n-plus-one-in-code/senior.md) — the I/O cousin; a preloaded map fixes both N+1 queries and N+1 scans.
- [Unnecessary Allocation](../03-unnecessary-allocation/senior.md) — `map[k]*V` vs `[]V` is also an allocation and GC-pressure decision.
- [Bad Structure (Development)](../../01-development/01-bad-structure/senior.md) — refactoring structural anti-patterns safely at scale.
- [Architecture Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — when the wrong structure is a *system* decision (the wrong store, not the wrong collection).
- The `profiling-techniques`, `big-o-analysis`, and `hash-table-design` skills — finding the scan, reasoning about scaling, and the hash internals behind the crossover.
