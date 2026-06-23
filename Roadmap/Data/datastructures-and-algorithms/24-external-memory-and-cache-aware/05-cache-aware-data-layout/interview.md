# Cache-Aware Data Layout — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [AoS vs SoA](#aos-vs-soa)
3. [Arrays vs Pointer-Chasing](#arrays-vs-pointer-chasing)
4. [Loop Tiling / Blocking](#loop-tiling--blocking)
5. [False Sharing](#false-sharing)
6. [Applied: Columnar, SIMD, Eytzinger](#applied-columnar-simd-eytzinger)
7. [Gotcha / Trick Questions](#gotcha--trick-questions)
8. [Rapid-Fire Q&A](#rapid-fire-qa)
9. [Common Mistakes](#common-mistakes)
10. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: What is a cache line, and why does data layout matter even when the algorithm and its big-O are unchanged? *(Easy)*

**Answer**: A **cache line** is the fixed-size unit the hardware transfers between memory levels — typically **64 bytes** on x86/ARM. You never load a single byte; you load the whole line containing it. This is exactly the [I/O model](../01-the-io-model/interview.md)'s block `B`, applied to the CPU-cache hierarchy.

Big-O counts *operations*; it is blind to *how many lines you touch*. Two programs with identical `O(n)` work can differ 5–10× in wall-clock because one streams contiguous lines (one miss per `B` elements) while the other scatters across memory (one miss per element). Layout decides **locality**, and on memory-bound code locality decides speed. The algorithm is the same; what changed is how much *useful* data each transferred line carries.

### Q2: Distinguish spatial and temporal locality. *(Easy)*

**Answer**:

- **Spatial locality**: if you touch address `x`, you'll soon touch addresses *near* `x`. The cache exploits this by fetching a whole line and by hardware **prefetching** the next lines. Sequential array traversal is the canonical case.
- **Temporal locality**: if you touch `x`, you'll touch `x` *again* soon. The cache exploits this by *keeping* recently used lines resident. Reusing a tile of a matrix while it's hot is the canonical case.

Good layout maximizes spatial locality (pack what's used together) and good loop structure (tiling) maximizes temporal locality (reuse what's resident). Most layout optimizations are really one of these two in disguise.

---

## AoS vs SoA

### Q3: Define Array-of-Structs (AoS) and Struct-of-Arrays (SoA). When is each better? *(Medium)*

**Answer**: For records with `d` fields:

- **AoS** — `struct P { x; y; z; ... }; P arr[n];` — each record's fields are **contiguous**; records are laid out back-to-back.
- **SoA** — `struct { x[n]; y[n]; z[n]; ... }` — each *field* gets its own array; all `x` values are contiguous, all `y`, etc.

**Use SoA** when loops sweep **column-wise**, touching only `f` of the `d` fields across many records (e.g. "sum all `x`"). Every loaded line is then 100% useful, and the contiguous single-field stream **vectorizes (SIMD)** cleanly.

**Use AoS** when access is **random by record** and touches the **whole record** at once (e.g. "load entity `i` and update all its fields"). One record sits in one (or few) lines; SoA would instead force one miss per field, scattered across `d` arrays.

### Q4: Quantify the waste/speedup of AoS vs SoA for a column scan. *(Medium)*

**Answer**: Suppose a loop touches `f` of the `d` fields of each record, and fields are roughly equal-sized.

- **AoS**: each cache line holds whole records, but you only use `f/d` of each line — you **waste `(d − f)/d`** of every transferred line. To read the `f` useful fields you drag along the other `d − f`.
- **SoA**: each touched field's array is dense, so every line is fully useful. You move a factor of `d/f` **less** data.

So SoA gives up to a **`d/f`× reduction in memory traffic** (and the corresponding bandwidth-bound speedup), plus SIMD on the contiguous stream. Example: `d = 8` fields, touch `f = 1` → AoS wastes 7/8 of each line; SoA is up to **8× faster**. The win shrinks toward 1× as `f → d`.

---

## Arrays vs Pointer-Chasing

### Q5: Why is iterating a contiguous array far faster than walking a linked list of the same length? *(Medium)*

**Answer**: Same `O(n)`, wildly different I/O behavior:

- **Array**: elements are contiguous. One cache miss brings in a line of `B` elements, so you pay **one miss per `B` elements** — `Θ(n/B)` misses. The hardware **prefetcher** detects the sequential stride and loads lines *ahead* of use, hiding latency almost entirely.
- **Linked list**: each node is a separate allocation at an arbitrary address. Following `next` is a **dependent load** to an unpredictable location → typically **one cache miss per node** (`Θ(n)` misses), and the prefetcher can't help because it can't guess the next address until the current node is loaded. This is **pointer-chasing**: a chain of latency-bound dependent misses.

The gap is roughly a factor of `B` in misses (e.g. 8–16×), often more once prefetch and memory-level parallelism are counted. The lesson: **contiguity + predictable stride beats pointers**, which is why flat arrays, array-backed structures, and arena/pool allocation routinely outrun node-based ones in practice even at equal asymptotic cost.

---

## Loop Tiling / Blocking

### Q6: Why does blocking (tiling) a matrix multiply speed it up, and what is the resulting I/O cost? *(Hard)*

**Answer**: A naive triple-loop multiply streams entire rows/columns far larger than the cache, so a reused row is **evicted before it's reused** — the inner data never stays hot, and you pay `Θ(n³)` misses on large matrices.

**Tiling** partitions the matrices into `t × t` tiles and multiplies tile-by-tile. Choose `t` so that the working set — a tile of `A`, a tile of `B`, and the accumulating tile of `C`, i.e. `3t²` elements — **fits in cache** (`t ≈ √(M/3)`, so `t = Θ(√M)`). Each tile is then loaded once and **fully reused** while resident (temporal locality), instead of being re-streamed from memory.

Counting transfers: with `t = Θ(√M)`, the total is

```
Θ(n³ / (B · √M))
```

— the same bound a [cache-oblivious](../02-cache-oblivious-algorithms/interview.md) recursive multiply reaches. The cache "buys" a `√M` factor because it holds a `√M × √M` block.

### Q7: How does explicit tiling relate to cache-oblivious recursion? *(Medium)*

**Answer**: They reach the **same I/O bound** by the same underlying idea — work on a sub-block small enough to fit in cache and reuse it fully — but differ in *who picks the size*:

- **Tiling (cache-aware)**: you choose the tile size `t = Θ(√M)` explicitly, baking `M` into the code. Best constant factor at the level you tuned, but brittle — re-tune per machine and per cache level.
- **Cache-oblivious recursion**: keep splitting into quadrants without ever naming `M` or `B`; the recursion *passes through* the fits-in-cache size automatically, so it's optimal at **every** level at once.

So tiling is the hand-tuned, single-level version of "recurse until it fits." See [../02-cache-oblivious-algorithms/interview.md](../02-cache-oblivious-algorithms/interview.md). In practice people often combine them: recurse for portability, then a tuned tiled/SIMD kernel at the base case.

---

## False Sharing

### Q8: What is false sharing, why does it tank multicore scaling, and how do you fix it? *(Hard)*

**Answer**: **False sharing** happens when two cores write to **different variables that happen to live on the same cache line**. Logically they share nothing — but the cache **coherence protocol** (MESI) tracks ownership at **line granularity**, not variable granularity. So each write by core A invalidates the line in core B's cache and vice versa: the line **ping-pongs** between cores over the interconnect, every write stalling on a coherence transaction.

The symptom is brutal: a parallel loop that should scale linearly instead **slows down as you add cores** — the more threads, the more ping-pong. It's "false" because there is no real data dependency; the contention is an artifact of layout.

**Fix: separate the contended variables onto different lines** by padding/aligning. Classic patterns:

- Pad each thread's counter to a full 64 bytes (`alignas(64)` / `#[repr(align(64))]`), e.g. `struct alignas(64) Counter { long v; char pad[64 - sizeof(long)]; };`.
- Give each thread its **own** accumulator (thread-local), combine once at the end.
- Lay out per-thread state in a striped array with line-sized stride.

This is one of the most-asked senior concurrency questions because it's invisible in the source code and only shows up under a profiler (high `mem_load_..._hitm` / coherence-miss counters).

### Q9: How do you *detect* false sharing if the code looks correct? *(Medium)*

**Answer**: It produces correct results, so only **performance signals** reveal it:

- **Profilers / hardware counters**: look for high counts of cache-line coherence misses — HITM (hit-modified) events, e.g. via `perf c2c` (cache-to-cache) on Linux or VTune's "Contested Accesses." `perf c2c` will name the exact offending line and the variables sharing it.
- **Scaling test**: measure throughput vs thread count. If it flattens or *regresses* with more cores while CPU stays busy, suspect false sharing on a hot, frequently-written shared line.
- **Code smell**: a small struct or array of per-thread counters/flags written in a tight parallel loop with no padding.

Confirm by padding to a line and re-measuring; if scaling recovers, that was it.

---

## Applied: Columnar, SIMD, Eytzinger

### Q10: Why do analytics/OLAP engines use columnar storage? *(Medium)*

**Answer**: Columnar storage is **SoA for tables**: each column stored contiguously rather than each row. Analytical queries are column-wise — `SELECT avg(price) WHERE ...` touches a few columns over millions of rows. Benefits, all layout-driven:

- **No wasted bandwidth**: only the referenced columns are read; you don't drag entire wide rows through cache/disk (the AoS `(d−f)/d` waste avoided).
- **SIMD-friendly**: a contiguous, single-type column vectorizes — sum/filter many values per instruction.
- **Better compression**: homogeneous values per column compress far better (RLE, dictionary, delta), shrinking the bytes that must move.

Row stores (OLTP) win the opposite workload: read/write a whole single row. Same AoS-vs-SoA trade-off, one level up the hierarchy. See [./middle.md](./middle.md).

### Q11: Why can an Eytzinger (implicit BFS) layout beat a sorted array for binary search? *(Hard)*

**Answer**: Plain binary search on a **sorted array** has perfect order but terrible *access* locality: the first probes are at indices `n/2`, `n/4`, `3n/4`, … — huge strides, each a fresh cache line, and the prefetcher can't predict the data-dependent next probe. Most of each loaded line is wasted.

The **Eytzinger layout** stores the same keys in **BFS/level order** of the implicit search tree (root at index 1, children of `i` at `2i` and `2i+1`). Now the search path's early nodes — the ones every query hits — are packed near the front and near each other, so the top levels stay hot, and a node's two children sit adjacent (one line often holds both). You also **prefetch both children speculatively** (`__builtin_prefetch(a + 2*i)`) since you'll descend into one of them regardless of the comparison, hiding latency.

The result is fewer cache misses per search and branch-free, prefetch-friendly code that can outrun `std::lower_bound` by ~2× on large arrays — **same comparisons, better layout**. This is the cache-aware cousin of the cache-oblivious vEB layout in [../02-cache-oblivious-algorithms/interview.md](../02-cache-oblivious-algorithms/interview.md).

### Q12: Why does row-major vs column-major traversal order matter? *(Easy)*

**Answer**: A 2-D array stored **row-major** (C, NumPy default) has each row contiguous. Traversing it **row-by-row** strides by 1 → one miss per line, prefetch-friendly. Traversing the *same* array **column-by-column** strides by the row length → potentially **one miss per element**, no useful prefetch, every line mostly wasted. For large matrices that's a 5–10×+ slowdown with identical arithmetic. Rule: **make your innermost loop walk the contiguous dimension** (innermost index varies fastest for row-major). In column-major languages (Fortran, Julia, MATLAB) the rule flips.

---

## Gotcha / Trick Questions

### Q13: "Optimize layout, or pick a better algorithm — which first?" *(Hard)*

**Answer**: **Algorithm/complexity first, then profile, then layout** — but with nuance. A better asymptotic algorithm beats any constant-factor layout tweak as `n` grows; never micro-optimize a quadratic loop you could make linearithmic. *However*, once the complexity is right, layout is the **highest-leverage constant-factor lever left** on memory-bound code — routinely **5–10×**, occasionally more.

The discipline: **measure before you layout.** Premature layout work (manual SoA conversion, padding everything) costs readability and is wasted if the hot path is elsewhere or compute-bound. Profile to confirm the code is *memory-bound* and find the actual hot data structure, *then* restructure it. So: right algorithm → profile → fix the layout of whatever the profile blames. Layout is a finisher, not an opener.

### Q14: "Is SoA always better than AoS?" *(Medium)*

**Answer**: **No.** SoA wins **column-wise / streaming** access touching few fields, and enables SIMD. It **loses** on **random access that touches the whole record**: SoA scatters one record's fields across `d` separate arrays, so loading entity `i` causes `d` cache misses (one per array), whereas AoS keeps that record in one line → one miss. SoA also hurts code that frequently inserts/deletes whole records or passes records by value. The honest answer is *workload-dependent*: pick SoA for hot column sweeps, AoS for record-at-a-time random access, and consider **AoSoA** (array of small SoA tiles) as the hybrid that gets SIMD without losing all record locality.

### Q15: "Padding to fix false sharing wastes memory — is it worth it?" *(Medium)*

**Answer**: Almost always **yes for hot, write-shared data**. Padding a per-thread counter to 64 bytes "wastes" a few dozen bytes *per thread* — negligible — to eliminate a coherence ping-pong that can cost an order of magnitude in a tight parallel loop. The trade-off only tips the other way for **large arrays of cold/rarely-written** items, where padding bloats the footprint (hurting *spatial* locality and capacity) without removing meaningful contention. Pad the contended hot variables; don't reflexively pad everything.

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | Typical cache-line size? | **64 bytes** |
| 2 | Why does layout matter at fixed big-O? | Decides lines touched / locality |
| 3 | Spatial vs temporal locality? | Near-soon vs same-soon |
| 4 | AoS? | Array of whole records (fields contiguous per record) |
| 5 | SoA? | Separate array per field |
| 6 | SoA wins when? | Column sweep, few fields, SIMD |
| 7 | AoS wins when? | Random access touching whole record |
| 8 | AoS waste touching `f` of `d` fields? | `(d − f)/d` of each line |
| 9 | SoA speedup ceiling? | up to `d/f`× less traffic |
| 10 | Array vs linked list misses? | `Θ(n/B)` vs `Θ(n)` — pointer-chasing |
| 11 | Tiled matmul tile size? | `t = Θ(√M)` |
| 12 | Tiled matmul I/O? | `Θ(n³/(B√M))` |
| 13 | False sharing? | Two cores write different vars on same line → ping-pong |
| 14 | False-sharing fix? | Pad/align to separate lines; per-thread state |
| 15 | Detect false sharing? | `perf c2c` / HITM counters; scaling regresses |
| 16 | Columnar storage = ? | SoA for tables (OLAP) |
| 17 | Eytzinger layout? | BFS-order array → cache-friendly binary search |
| 18 | Row-major contiguous dim? | The last index (walk it innermost) |
| 19 | Layout or algorithm first? | Algorithm → profile → layout |
| 20 | SoA always best? | No — loses on whole-record random access |

---

## Common Mistakes

1. **Assuming equal big-O means equal speed.** Layout changes misses, not operations — 5–10× swings are common on memory-bound code.
2. **Defaulting to SoA everywhere.** SoA tanks whole-record random access (one miss per field, scattered). Match layout to access pattern.
3. **Ignoring false sharing.** Invisible in source; only a profiler (`perf c2c`, HITM) or a scaling test reveals it. Pad hot write-shared vars to a line.
4. **Over-padding cold data.** Padding everything bloats the footprint and hurts spatial locality; pad only the contended hot variables.
5. **Stating tiled matmul as `Θ(n³/B)`.** The `√M` factor is the point: `Θ(n³/(B√M))` — the cache holds a `√M × √M` block.
6. **Traversing column-major over a row-major array** (or vice versa). Make the innermost loop walk the contiguous dimension.
7. **Micro-optimizing layout before fixing the algorithm or profiling.** Layout is a finisher; a better complexity wins as `n` grows.
8. **Forgetting pointer-chasing kills prefetch.** Dependent loads to unpredictable addresses defeat the prefetcher; prefer contiguous/array-backed structures.

---

## Tips & Summary

- **Lead with the unit of transfer**: "The cache moves **64-byte lines**, not bytes — layout decides how much of each line is useful, so it decides speed even at fixed big-O." That frames every answer.
- **Nail the AoS/SoA rule with numbers**: touch `f` of `d` fields → AoS wastes `(d−f)/d` per line; SoA up to `d/f`× less traffic plus SIMD. SoA for column sweeps, AoS for whole-record random access.
- **Have the false-sharing story ready cold** — it's the classic senior question: *two cores write different vars on the same line → MESI ping-pong → scaling regresses; fix by padding/aligning to separate lines.* Mention `perf c2c` to show you can find it.
- **Connect tiling to cache-oblivious**: tiling picks `t = Θ(√M)` explicitly for one level; recursion does it for free at every level — same `Θ(n³/(B√M))` bound. See [../02-cache-oblivious-algorithms/interview.md](../02-cache-oblivious-algorithms/interview.md).
- **Cite the applied wins**: columnar/OLAP (SoA for tables), Eytzinger binary search (BFS layout + speculative prefetch), row-major traversal order. Concrete, real-system examples land hardest.
- **Get the priority right**: algorithm first, **profile to confirm memory-bound**, then layout — it's a 5–10× finisher, wasted if applied prematurely or to the wrong (cold/compute-bound) code.

**Related:** [The I/O Model — Interview](../01-the-io-model/interview.md) · [Cache-Oblivious Algorithms — Interview](../02-cache-oblivious-algorithms/interview.md) · [Cache-Aware Data Layout — Middle](./middle.md)
