# Cache-Aware Data Layout — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Cache Lines and Locality, Formally](#cache-lines-and-locality-formally)
   - [The Line as the Unit of Transfer](#the-line-as-the-unit-of-transfer)
   - [Spatial and Temporal Locality](#spatial-and-temporal-locality)
   - [Effective Bandwidth and the Working-Set Condition](#effective-bandwidth-and-the-working-set-condition)
3. [AoS vs SoA: Quantified](#aos-vs-soa-quantified)
   - [The Waste Formula](#the-waste-formula)
   - [When AoS Wins: Random Access by Record](#when-aos-wins-random-access-by-record)
   - [SoA and SIMD](#soa-and-simd)
4. [Loop Tiling / Blocking](#loop-tiling--blocking)
   - [Why the Naive Multiply Is Θ(n³/B)](#why-the-naive-multiply-is-θnb)
   - [The Tiled Multiply: Θ(n³/(B√M))](#the-tiled-multiply-θnbm)
   - [Stencils and the General Recipe](#stencils-and-the-general-recipe)
   - [Contrast: Cache-Aware Tiling vs Cache-Oblivious Recursion](#contrast-cache-aware-tiling-vs-cache-oblivious-recursion)
5. [Cache-Conscious Layout of Data Structures](#cache-conscious-layout-of-data-structures)
   - [Implicit / Contiguous Trees](#implicit--contiguous-trees)
   - [The van Emde Boas (Cache-Aware) Layout](#the-van-emde-boas-cache-aware-layout)
   - [Structure Splitting and Field Reordering](#structure-splitting-and-field-reordering)
6. [False Sharing](#false-sharing)
   - [The Mechanism: A Line Ping-Ponging Between Cores](#the-mechanism-a-line-ping-ponging-between-cores)
   - [The Fix: Padding to a Line](#the-fix-padding-to-a-line)
7. [Prefetching](#prefetching)
8. [Code: Measuring Layout Effects](#code-measuring-layout-effects)
   - [Go](#go)
   - [Python (and a C-like note)](#python-and-a-c-like-note)
9. [Pitfalls](#pitfalls)
10. [Summary](#summary)

---

## Introduction

> Focus: turn the junior intuition — *cache lines, AoS vs SoA, sequential access is fast* — into quantitative engineering you can derive and measure. By the end you can compute the exact fraction of a fetched line that AoS wastes, derive why a tiled matrix multiply drops misses from `Θ(n³/B)` to `Θ(n³/(B√M))`, lay out a tree so search costs `O(1)` misses per `Θ(B)`-fanout chunk, diagnose and fix false sharing, and explain why sequential layout lets the hardware prefetcher hide latency.

At the [junior level](./junior.md) you met the mechanical facts: memory moves in **cache lines** of `B` bytes, the same loop runs faster when it walks memory sequentially, and a **struct-of-arrays (SoA)** layout often beats an **array-of-structs (AoS)** one. This file makes those facts rigorous and adds the techniques a working engineer reaches for.

It builds directly on the [I/O model](../01-the-io-model/middle.md). That model's two levels — slow external memory and fast internal memory, transferring data in blocks of `B` — describe *any* adjacent pair of levels in a real hierarchy: RAM and L3, L3 and L2, L2 and L1. A "cache line" is exactly the model's **block** `B`; a "cache miss" is exactly one **block transfer (I/O)**. The cache-aware discipline is the I/O model applied to the CPU's caches: the algorithm *knows* `M` (the cache size) and `B` (the line size) and lays out and traverses data to minimize transfers.

We cover, with derivations and measurements:

- **Locality, formally** — spatial locality is the line bringing `B` bytes at once; temporal locality is reuse before eviction; **effective bandwidth = useful bytes / bytes fetched** is the single number every layout decision optimizes.
- **AoS vs SoA, quantified** — touching `f` of `d` fields, AoS wastes a fraction `(d−f)/d` of every line; SoA recovers it for up to a `d/f` speedup and enables SIMD. The exception: AoS wins for random access that touches *all* fields of *few* records.
- **Loop tiling** — the cache-aware counterpart to cache-oblivious recursion. Block a matrix multiply so a tile fits in cache, and misses drop from `Θ(n³/B)` to `Θ(n³/(B√M))`. We derive it and contrast it with the [cache-oblivious recursion](../02-cache-oblivious-algorithms/middle.md) that achieves the same bound *without* tuning to `M`.
- **Cache-conscious structures** — implicit (pointerless) trees, the van Emde Boas layout, and Chilimbi-style hot/cold field splitting.
- **False sharing** — two cores writing different variables on the *same line* force the line to ping-pong between caches; the fix is per-core padding.
- **Prefetching** — why sequential access is doubly good, and how layout enables hardware and software prefetch.

A note on vocabulary, carried from the [I/O model](../01-the-io-model/middle.md):

| Symbol | Meaning |
|--------|---------|
| `B` | bytes per cache line (one miss transfers one line) |
| `M` | bytes that fit in the cache under analysis (`M/B` lines) |
| `f`, `d` | number of fields touched (`f`) out of total fields per record (`d`) |
| miss | one line transfer between this cache level and the next slower one |
| working set | the set of bytes a loop or phase touches repeatedly |

Throughout, "miss" and "block transfer" are the same event seen from two angles; we count misses, and (unlike the pure I/O model) we also *measure wall-clock time*, because on real hardware misses dominate it.

---

## Cache Lines and Locality, Formally

### The Line as the Unit of Transfer

A cache never moves a single byte. On a miss it fetches an entire aligned **line** of `B` bytes (64 on essentially every current x86 and ARM core) from the next level down. This is the same atomicity the [I/O model](../01-the-io-model/middle.md) builds on — *you cannot fetch half a block* — applied to the CPU caches. The consequence is the central lever of cache-aware design:

```text
  cost(access) ≈ {  ~1–4   cycles  if the line is already resident (a hit)
                 {  ~10    cycles  if it is in the next level (L2)
                 {  ~40    cycles  if it is in L3
                 {  ~200+  cycles  if it must come from DRAM (a miss to memory)
```

Because one miss drags in `B` bytes regardless of how many you use, the entire game is to **use as many of those `B` bytes as possible before the line is evicted**. Two algorithms with identical instruction counts can differ by an order of magnitude in wall-clock time purely from how their data is laid out relative to lines — exactly the I/O model's "layout matters" fact, now paid in cycles instead of disk seeks.

### Spatial and Temporal Locality

Two complementary properties make a line "pay off":

- **Spatial locality** — if you access address `a`, you will soon access addresses near `a` (within the same line). Because the line already brought in its `B` bytes, those nearby accesses are free hits. Sequential array traversal has perfect spatial locality: every line is fetched once and every one of its `B/elem` elements is used.
- **Temporal locality** — if you access address `a`, you will access `a` again **before the line is evicted**. A value reused while still resident costs nothing on the reuse. The qualifier *before eviction* is the whole subtlety: reuse only helps if the working set is small enough that the line survives in cache until the reuse.

Spatial locality is won by **layout** (pack what you touch together); temporal locality is won by **traversal order** (touch reused data in a tight enough window). Tiling, below, is precisely the technique for manufacturing temporal locality in a computation that has reuse but, traversed naively, evicts data before reusing it.

### Effective Bandwidth and the Working-Set Condition

Define the **effective bandwidth** of a loop as the ratio of bytes the algorithm actually needs to the bytes the memory system actually fetched:

```text
  effective bandwidth  =  useful bytes used  /  line bytes fetched
                       =  (bytes you read)    /  (B · number of misses)
```

A loop with effective bandwidth `1.0` wastes nothing — every byte of every fetched line is used. AoS that touches one 8-byte field of a 64-byte record achieves `8/64 = 0.125`: seven-eighths of memory traffic is wasted. This single number is what every layout transformation in this file improves; "make the data cache-friendly" means precisely "drive effective bandwidth toward 1."

The other guiding inequality is the **working-set-fits-in-cache** condition. If a phase repeatedly touches a working set of `W` bytes and `W ≤ M`, then after the initial `Θ(W/B)` compulsory misses the whole set is resident and every subsequent access in the phase is a hit. The art of tiling is to *choose* the unit of work so that its working set satisfies `W ≤ M`:

```text
  W ≤ M   →   working set stays resident   →   only Θ(W/B) compulsory misses, then all hits
  W > M   →   capacity misses: lines evicted before reuse   →   miss rate stays high
```

This is the same "fits in cache" base case that powers the [cache-oblivious analysis](../02-cache-oblivious-algorithms/middle.md); the difference is that there the recursion *discovers* the fitting size, while here we *compute* it from `M`.

---

## AoS vs SoA: Quantified

### The Waste Formula

Consider a record with `d` fields of equal size, and a loop that, per record, reads only `f` of them (`1 ≤ f ≤ d`). Take `N` records.

**Array of structs (AoS):** records laid out `[f₁ f₂ … f_d][f₁ f₂ … f_d]…`. A loop reading `f` of the `d` fields still drags in the whole record on each fetched line, because the `f` fields it wants are interleaved with the `d−f` it does not. Every line therefore carries a fraction

```text
  AoS waste  =  (d − f) / d        (fraction of each fetched line that is unused)
```

For `d = 8`, `f = 1`: waste `= 7/8`, effective bandwidth `1/8`. The loop fetches eight times more memory than it uses, so it makes roughly `8×` the misses of an ideal layout.

**Struct of arrays (SoA):** each field stored in its own contiguous array, `[all f₁][all f₂]…[all f_d]`. A loop reading `f` fields now scans `f` dense arrays and touches *only* useful bytes. Effective bandwidth is `1.0`, misses drop to `Θ(f · N · size / B)`, and the speedup over AoS is up to

```text
  SoA speedup over AoS  =  d / f        (touch f of d fields → fetch f of d arrays)
```

The same `d/f` factor seen two ways: AoS wastes `(d−f)/d`, so it fetches `d/f` times as many lines as SoA for the fields actually read. A field-heavy struct scanned for one field is the canonical `d/f`-fold win.

### When AoS Wins: Random Access by Record

SoA is not universally better. The tradeoff inverts when the access pattern is **random access that touches all `d` fields of a few records** — e.g. "fetch entity 91,237 and read its whole struct."

- **AoS:** the whole record is contiguous, so it lands on one (or two, if it straddles a boundary) lines. One random record = `O(1)` misses, and *all* `d` fields come along usefully. Effective bandwidth `≈ 1` because `f = d`.
- **SoA:** the `d` fields of one record live in `d` *different* arrays, so reading one record's fields scatters across `d` lines — `d` misses, each line mostly wasted on neighboring records you do not want. Effective bandwidth `≈ 1/(B/size)` per array — terrible.

```text
  scan f of d fields over MANY records   →  SoA wins by d/f   (dense, sequential, vectorizable)
  read all d fields of FEW random records →  AoS wins         (one record = O(1) lines)
```

So the decision rule is about the *shape of the access*, not a blanket preference: **SoA for columnar, bulk, few-fields-many-records work** (the analytics / SIMD pattern); **AoS for record-at-a-time, all-fields, random work** (the OLTP / pointer-following pattern). This is exactly why columnar databases store SoA and row stores store AoS.

### SoA and SIMD

SoA has a second, compounding benefit beyond eliminating waste: it makes data **vectorizable**. A SIMD lane processes, say, 8 floats at once, but only if those 8 floats are *contiguous*. In SoA the `x` field of 8 consecutive particles is `x[i..i+8]` — one aligned vector load. In AoS the same 8 `x` values are 8 fields strided `sizeof(record)` apart, which a vector unit cannot load in one instruction (it needs a gather, far slower). So SoA's `d/f` memory win is frequently multiplied by a `4×`–`16×` SIMD win on the arithmetic. The two effects are why the SoA transform is the first move in nearly every numerical hot loop.

---

## Loop Tiling / Blocking

Tiling is the cache-aware technique for manufacturing **temporal locality**: restructure a loop nest so the data it reuses fits in cache during the window of reuse. The showcase is matrix multiply, the same problem the [cache-oblivious chapter](../02-cache-oblivious-algorithms/middle.md) solves by recursion.

### Why the Naive Multiply Is Θ(n³/B)

Compute `C = A · B`, all `n × n`, row-major, with the textbook triple loop:

```text
  for i in 0..n:
    for j in 0..n:
      for k in 0..n:
        C[i][j] += A[i][k] * B[k][j]
```

Count misses for `n` large enough that **a full row/column does not stay resident**. The inner `k`-loop, for fixed `i, j`, streams row `i` of `A` (contiguous — `Θ(n/B)` misses) and **column `j` of `B`** (strided by `n` — one miss *per element*, `Θ(n)` misses, since each `B[k][j]` is on a different line). The strided access to `B` dominates: across all `n²` choices of `(i, j)` the column reads alone cost `Θ(n² · n) = Θ(n³)` element-misses... but because `B` is re-read column by column and each pass evicts the previous one, the total is

```text
  naive multiply misses  =  Θ(n³ / B)   for A (each row reused, blocked)  +  Θ(n³)  worst-case for B's strided columns
                         ≈  Θ(n³ / B)    when at least one matrix streams in line order, but with NO temporal reuse:
```

The precise, layout-honest statement: the naive multiply gets the `1/B` blocking benefit on whichever matrix it streams sequentially, but it gets **no temporal-reuse benefit at all**, because by the time it could reuse a loaded element of `A` or `B`, that element has long been evicted. Its miss count is `Θ(n³/B)` in the best inner ordering — every element of the `n³` multiply-adds pulls fresh data through the cache.

### The Tiled Multiply: Θ(n³/(B√M))

Tiling fixes the reuse problem. Partition each matrix into `T × T` tiles and reorder the loops so the innermost work is a tile-by-tile multiply:

```text
  for ii in 0..n step T:
    for jj in 0..n step T:
      for kk in 0..n step T:
        // multiply the T×T tiles A[ii..][kk..] · B[kk..][jj..] into C[ii..][jj..]
        for i in ii..ii+T:
          for j in jj..jj+T:
            for k in kk..kk+T:
              C[i][j] += A[i][k] * B[k][j]
```

The inner three loops touch three `T × T` tiles: one of `A`, one of `B`, one of `C`. Their working set is `3T²` elements. **Choose `T` so the three tiles fit in cache:**

```text
  3 T²  ≤  M   →   T = Θ(√M)
```

Now derive the miss count. With `T = Θ(√M)`, loading the three tiles costs `Θ(T²/B) = Θ(M/B)` misses, and then the *entire* `T³` multiply-add work of those tiles runs with **zero further misses** — the tiles are resident. The number of tile-triples processed is `(n/T)³`, so:

```text
  tiled multiply misses  =  (n/T)³  tile-triples  ·  Θ(T²/B)  misses each
                         =  (n³ / T³) · (T² / B)
                         =  Θ( n³ / (T · B) )
                         =  Θ( n³ / (√M · B) )        substituting T = Θ(√M)
                         =  Θ( n³ / (B √M) ).
```

> **Result (tiled matrix multiply).** Tiling with `T = Θ(√M)` so that three tiles fit in cache reduces multiply misses from `Θ(n³/B)` to `Θ(n³/(B√M))` — a factor of `√M` fewer misses.

The `√M` is the **temporal-reuse factor**: each element of `A` and `B` loaded into a tile is reused `Θ(T) = Θ(√M)` times (once per row/column of the tile) before eviction, instead of once. For a working `M` in the tens of kilobytes, `√M` (in elements) is in the dozens-to-hundreds — a large constant, often a `10×`–`100×` real speedup. This is the identical bound the [cache-oblivious recursion](../02-cache-oblivious-algorithms/middle.md) reaches; the difference is that *here we computed `T = √M` from a known `M`*, whereas the oblivious version recurses past that size automatically.

### Stencils and the General Recipe

The same transformation applies to any loop nest with **reuse across iterations**. A 2D stencil (each output `out[i][j]` reads its neighbors `in[i±1][j±1]`) reuses each input element across several outputs. Traversed row by row over a large grid, a row is evicted before the next row needs it; **tiling the grid into `T × T` blocks** (with `T = Θ(√M)`) keeps each block plus its halo resident, recovering the reuse. The recipe generalizes:

```text
  Tiling recipe:
    1. Identify the reused data and the loop that re-touches it.
    2. Block the iteration space so one block's working set ≤ M.
    3. Reorder loops so a whole block completes before moving on.
    4. (Optional) tile again for L1 inside the L2 tile — multi-level blocking.
```

Real BLAS libraries tile at *every* level — L1, L2, L3, and registers — choosing a `T` per level, which is the cache-aware cost of beating the cache-oblivious version's single recursive code.

### Contrast: Cache-Aware Tiling vs Cache-Oblivious Recursion

The two approaches reach the *same* `Θ(n³/(B√M))` bound by opposite philosophies:

```text
  cache-AWARE tiling:       T = √M chosen from known M   →  one tuned T per cache level, retune per machine
  cache-OBLIVIOUS recursion: bisect to size 1, no M, no B →  optimal at every level at once, no tuning
```

- **Tiling** ([this file]) reads `M` (and often `B`) and picks tile sizes. It is frequently a constant factor *faster* in practice because it tiles exactly and uses tight unrolled inner loops — but it must be **retuned** for each cache size and each machine, and a multi-level hierarchy needs a tile size per level.
- **Recursion** ([cache-oblivious](../02-cache-oblivious-algorithms/middle.md)) names neither `M` nor `B`; one code is simultaneously optimal at L1, L2, L3, and disk. The cost is heavier call overhead unless you cut the recursion at a coarse base case.

Neither dominates; production numerical kernels often *combine* them (recursive blocking down to a tuned micro-kernel). See the cache-oblivious side for the recursion's derivation and the [I/O model](../01-the-io-model/middle.md) for the cost measure both share.

---

## Cache-Conscious Layout of Data Structures

Tiling reorders a *computation*; cache-conscious layout reorders a *data structure* so traversal touches fewer lines. Three techniques:

### Implicit / Contiguous Trees

A pointer-based tree pays one likely miss **per node** on a root-to-leaf walk, because successive nodes are scattered across the heap — `Θ(log₂ N)` misses for a binary tree of `N` nodes (this is exactly the [I/O model](../01-the-io-model/middle.md)'s "binary tree = `log₂ N` I/Os" observation). Two cures:

- **Implicit (pointerless) layout.** Store a complete binary tree in an array with children of index `i` at `2i+1`, `2i+2` — the classic binary-heap layout. No pointers (saving memory and the indirection miss), and the top levels of the tree, being low indices, sit in a few contiguous lines that stay hot. A binary heap's `sift-down` walks `Θ(log N)` levels but the upper levels are almost always cache-resident.
- **Wide, packed nodes.** Pack many keys into one node sized to a line (or a few lines), giving fanout `Θ(B)` — this is the **B-tree** node, and it turns `log₂ N` misses into `Θ(log_B N)` misses (the [I/O-model search bound](../01-the-io-model/middle.md)). The cache-aware analogue, a B-tree node tuned to the *cache line* rather than the disk block, is the standard layout for in-memory ordered indexes.

### The van Emde Boas (Cache-Aware) Layout

The [cache-oblivious chapter](../02-cache-oblivious-algorithms/middle.md) derives the **van Emde Boas layout** of a balanced search tree: lay nodes out by recursively halving the tree's *height*, so every subtree of height `≤ ½h` occupies a contiguous run of memory. A search then visits `Θ(log₂ N)/Θ(log₂ B) = Θ(log_B N)` contiguous "base trees" of `≤ B` nodes, each costing `O(1)` misses — matching the B-tree's `Θ(log_B N)` **without** the node size being tuned to `B`.

The reason it appears here too: the vEB layout is the headline example of *layout, not computation,* determining miss count. The same `N` nodes, the same `Θ(log N)` comparisons, but a contiguous-by-recursive-triangle order instead of a scattered one — and search drops from `Θ(log₂ N)` misses to `Θ(log_B N)`. Whether you tune the node size to `B` (B-tree, cache-aware) or use the self-similar vEB order (cache-oblivious), the win is the same kind: **cluster the nodes a traversal visits together onto the same lines.**

### Structure Splitting and Field Reordering

Chilimbi, Hill, and Larus (1999) formalized two layout transforms for records whose fields differ in how *hot* (frequently accessed) they are:

- **Hot/cold splitting (structure splitting).** Split a record into a hot part (the fields a loop touches every iteration) and a cold part (rarely-touched fields), linked by a pointer. The hot parts pack densely — many per line — so the common loop's effective bandwidth jumps. The cold part is fetched only on the rare path. This is AoS→SoA done *per field group* rather than per field: it keeps a record's hot fields together (good for record-at-a-time access) while evicting the dead weight that was wasting the line.

```text
  before:  struct { hotA; hotB; coldX; coldY; coldZ; }   // 5 fields, loop reads 2
           → every line carries 3/5 dead bytes  (waste 0.6)

  after:   struct Hot { hotA; hotB; Cold* cold; }         // dense: many Hot per line
           struct Cold { coldX; coldY; coldZ; }           // fetched only when needed
           → hot loop effective bandwidth ≈ 1; cold path one extra miss when taken
```

- **Field reordering.** Within a record, group fields that are accessed *together in time* so they share a line, and push apart fields used in different phases. A field read in the same loop iteration as another should sit on the same line; one read in a different phase should not crowd it out.

These are the same `(d−f)/d` waste calculus as AoS vs SoA, applied at the granularity of field *clusters* — and they are how you make a record-oriented structure cache-friendly without abandoning AoS entirely.

---

## False Sharing

Everything above concerns a single thread's miss count. **False sharing** is a multicore pathology, and the dangerous thing about it is that it is *invisible in single-threaded tests* — the code is correct, each thread touches only its own variable, and yet adding threads makes it *slower*.

### The Mechanism: A Line Ping-Ponging Between Cores

Cache coherence (MESI and its kin) maintains a single source of truth per line across cores. The unit of coherence is, again, the **line** — not the variable. So if two cores write two *different* variables that happen to fall on the *same line*, the hardware treats it as a conflict even though the program has no real data dependency:

```text
  counters: [ c0 ][ c1 ][ c2 ][ c3 ]   ← four int64 counters, 32 bytes, ALL on one 64-byte line

  core 0 writes c0  →  it must own the line Exclusive → invalidate the line in cores 1,2,3
  core 1 writes c1  →  it must own the line Exclusive → invalidate the line in cores 0,2,3
  ...
  the single line PING-PONGS between the four cores' caches on every write,
  each transfer a coherence miss costing ~tens-to-hundreds of cycles.
```

Each core writes only its own counter — there is no logical sharing — but they **falsely share** the line, so the line bounces between caches and every increment stalls. The result is catastrophic negative scaling: four threads can be *slower* than one. This is "false" sharing precisely because no shared *datum* exists; only a shared *line* does.

### The Fix: Padding to a Line

Place each hot per-core variable on its **own line** by padding the struct to the line size (and aligning it):

```text
  before (false sharing):              after (padded):
  type Counter struct {                type Counter struct {
    v int64                              v   int64
  }                                      _   [56]byte   // pad: 8 + 56 = 64 bytes = one line
  counters := make([]Counter, 4)       }
  // 4 × 8 = 32 bytes → one line        counters := make([]Counter, 4)
  // → all four share a line            // each Counter = 64 bytes → its own line
                                        // → no two cores share a line → no ping-pong
```

The cost is space: padding wastes `B − size` bytes per counter (56 of every 64 bytes here). That is the right trade for **hot, contended, per-core** state — and the wrong trade for everything else (you do not pad a million read-only records). Real codebases mark such types with a cache-line-padding helper (`[64]byte` align in Go via a padded field, `alignas(64)` in C++, `#[repr(align(64))]` in Rust, `@Contended` in Java). The diagnostic instinct: *if adding threads to embarrassingly-parallel per-core work makes it slower, suspect two hot variables on one line.*

---

## Prefetching

Sequential access is fast for the spatial-locality reason already given — but it has a second, compounding benefit: it lets the **hardware prefetcher** hide miss latency entirely.

- **Hardware stride prefetchers.** Every modern core watches the stream of cache misses and detects regular **strides**. Once it sees you walking memory at a fixed stride (a sequential scan is stride = element size), it *speculatively fetches lines ahead of the access*, so by the time the loop asks for the next line it is already resident. A sequential scan over a large array thus runs near memory bandwidth with *almost no exposed miss latency* — the prefetcher stays ahead of you. This is why sequential layout is "doubly good": fewer lines fetched (spatial locality) *and* their latency hidden (prefetching).
- **What defeats the prefetcher.** Pointer-chasing (linked lists, scattered trees) and random/large strides give the prefetcher no pattern to lock onto, so every miss's full latency is exposed. The same `O(N)` work that runs at bandwidth when sequential can run `B×`-and-latency-bound-slower when pointer-chasing — the cautionary opposite the [I/O model](../01-the-io-model/middle.md) flags for linked traversal.
- **Software prefetch hints.** When the access pattern is predictable to *you* but not to the hardware (e.g. you will touch `index[i]` whose values are irregular but known a few iterations ahead), an explicit prefetch instruction (`__builtin_prefetch` in C/GCC, `sync/atomic`-adjacent intrinsics, etc.) tells the CPU to start fetching a line now so it is resident when needed. Used well it hides latency in gather-heavy loops; used carelessly it pollutes the cache and slows things down.

The layout lesson is that **good layout *enables* prefetching**: an SoA scan, a tiled traversal, or an implicit-tree walk presents the prefetcher with the regular strides it thrives on, whereas AoS-with-waste and pointer-chasing starve it. Designing for sequential, strided access is designing for the prefetcher.

---

## Code: Measuring Layout Effects

The theory predicts three measurable facts:

1. **SoA beats AoS** by up to `d/f` when a loop touches `f` of `d` fields over many records.
2. **Tiled multiply beats naive** by a large factor (the `√M` temporal-reuse win), without changing the arithmetic.
3. **Padded per-core counters beat unpadded** under multithreading, because padding kills false sharing.

We measure wall-clock time (cache misses are why these differ). Numbers vary by machine; the *ratios* are the point.

### Go

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

// ---------- (1) AoS vs SoA: sum one of d fields over N records ----------

type Particle struct { // AoS: 8 float64 fields = 64 bytes per record
	X, Y, Z, VX, VY, VZ, Mass, Charge float64
}

func sumAoS(ps []Particle) float64 {
	var s float64
	for i := range ps {
		s += ps[i].X // touch 1 of 8 fields → 7/8 of each line wasted
	}
	return s
}

func sumSoA(x []float64) float64 {
	var s float64
	for i := range x {
		s += x[i] // dense scan: effective bandwidth ≈ 1
	}
	return s
}

// ---------- (2) Naive vs tiled matrix multiply ----------

func naiveMul(a, b, c []float64, n int) {
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			var s float64
			for k := 0; k < n; k++ {
				s += a[i*n+k] * b[k*n+j] // b column-strided: no temporal reuse
			}
			c[i*n+j] = s
		}
	}
}

func tiledMul(a, b, c []float64, n, T int) {
	for ii := 0; ii < n; ii += T {
		for kk := 0; kk < n; kk += T {
			for jj := 0; jj < n; jj += T {
				iMax, kMax, jMax := min(ii+T, n), min(kk+T, n), min(jj+T, n)
				for i := ii; i < iMax; i++ {
					for k := kk; k < kMax; k++ {
						aik := a[i*n+k]
						for j := jj; j < jMax; j++ {
							c[i*n+j] += aik * b[k*n+j] // tile stays resident
						}
					}
				}
			}
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ---------- (3) False sharing: unpadded vs padded per-core counters ----------

type Unpadded struct{ v int64 }            // 8 bytes → 8 share a 64B line
type Padded struct {                       // 64 bytes → one per line
	v int64
	_ [56]byte
}

func hammerUnpadded(workers, iters int) {
	c := make([]Unpadded, workers)
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for i := 0; i < iters; i++ {
				c[w].v++ // adjacent counters share a line → ping-pong
			}
		}(w)
	}
	wg.Wait()
}

func hammerPadded(workers, iters int) {
	c := make([]Padded, workers)
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for i := 0; i < iters; i++ {
				c[w].v++ // each counter on its own line → no ping-pong
			}
		}(w)
	}
	wg.Wait()
}

func timeIt(name string, f func()) {
	t := time.Now()
	f()
	fmt.Printf("  %-18s %v\n", name, time.Since(t))
}

func main() {
	// (1) AoS vs SoA
	const N = 1 << 22
	ps := make([]Particle, N)
	xs := make([]float64, N)
	for i := range ps {
		ps[i].X = float64(i)
		xs[i] = float64(i)
	}
	fmt.Println("(1) sum 1 of 8 fields over", N, "records:")
	timeIt("AoS", func() { sumAoS(ps) })
	timeIt("SoA", func() { sumSoA(xs) })

	// (2) naive vs tiled multiply
	const n, T = 512, 64
	a := make([]float64, n*n)
	b := make([]float64, n*n)
	c := make([]float64, n*n)
	for i := range a {
		a[i], b[i] = 1.0, 1.0
	}
	fmt.Printf("(2) %dx%d matrix multiply (tile T=%d):\n", n, n, T)
	timeIt("naive", func() { naiveMul(a, b, c, n) })
	for i := range c {
		c[i] = 0
	}
	timeIt("tiled", func() { tiledMul(a, b, c, n, T) })

	// (3) false sharing
	const workers, iters = 8, 50_000_000
	fmt.Printf("(3) %d goroutines × %d increments:\n", workers, iters)
	timeIt("unpadded (shared)", func() { hammerUnpadded(workers, iters) })
	timeIt("padded (own line)", func() { hammerPadded(workers, iters) })
}
```

Representative output (ratios matter; absolute times are machine-specific):

```text
(1) sum 1 of 8 fields over 4194304 records:
  AoS                3.9ms
  SoA                0.6ms          ← ≈ 6–8× (the d/f = 8 ceiling, minus prefetch help to AoS)
(2) 512x512 matrix multiply (tile T=64):
  naive              210ms
  tiled              48ms           ← several×; the √M temporal-reuse win
(3) 8 goroutines × 50000000 increments:
  unpadded (shared)  410ms
  padded (own line)  52ms           ← ≈ 8×; false sharing eliminated by padding
```

Read the three results against the theory: **(1)** the SoA scan approaches the `d/f = 8` ceiling (it falls short of exactly `8×` because the hardware prefetcher partially hides AoS's wasted traffic); **(2)** tiling buys the `√M` reuse factor with identical arithmetic and zero algorithmic change; **(3)** the *only* difference between the two counter loops is 56 bytes of padding, and it is worth an `≈ 8×` multithreaded speedup — the signature of false sharing.

### Python (and a C-like note)

Pure Python's interpreter overhead swamps cache effects, so the AoS/SoA and tiling differences are best shown with NumPy (which stores SoA-style contiguous arrays and dispatches to tiled BLAS internally). The point is the same: *contiguous, columnar layout is what makes the fast path fast.*

```python
import time
import numpy as np


def timeit(name, f):
    t = time.perf_counter()
    f()
    print(f"  {name:<22} {1e3 * (time.perf_counter() - t):8.2f} ms")


# (1) AoS vs SoA: sum one field of an 8-field record over N records.
N = 1 << 22

# AoS: a (N, 8) array, read column 0 → strided by 8 in memory (row-major).
aos = np.ones((N, 8), dtype=np.float64)
# SoA: each field its own contiguous 1-D array.
soa_x = np.ones(N, dtype=np.float64)

print(f"(1) sum 1 of 8 fields over {N} records:")
timeit("AoS (strided column)", lambda: aos[:, 0].sum())   # gathers a strided column
timeit("SoA (contiguous)", lambda: soa_x.sum())           # dense scan


# (2) Naive (Python triple loop) vs tiled-by-BLAS (np.dot) matrix multiply.
n = 512
A = np.ones((n, n)); B = np.ones((n, n))


def naive_mul():
    C = np.zeros((n, n))
    for i in range(n):
        for k in range(n):           # i,k,j order so B[k,:] is a contiguous row
            aik = A[i, k]
            C[i, :] += aik * B[k, :]  # still Python-level; no cache tiling
    return C


print(f"(2) {n}x{n} matrix multiply:")
timeit("naive (python loops)", naive_mul)
timeit("np.dot (tiled BLAS)", lambda: A.dot(B))  # internally multi-level tiled
```

Representative output:

```text
(1) sum 1 of 8 fields over 4194304 records:
  AoS (strided column)      9.80 ms
  SoA (contiguous)          1.40 ms     ← contiguous scan wins (≈ d/f, capped by prefetch)
(2) 512x512 matrix multiply:
  naive (python loops)    430.00 ms
  np.dot (tiled BLAS)       2.10 ms     ← tiled, vectorized, multi-level blocked
```

**A C-like note on the false-sharing demo.** Languages that expose raw layout make the false-sharing fix explicit. In C/C++ you align each per-thread counter to a line:

```c
// Unpadded: 8 counters share a 64-byte line → false sharing, negative scaling.
long counters_bad[8];

// Padded: each counter on its own line → no coherence ping-pong.
struct PaddedCounter { _Alignas(64) long v; char pad[56]; };
struct PaddedCounter counters_good[8];   // sizeof == 64 each
```

The `_Alignas(64)` (or C++ `alignas(64)`, or `std::hardware_destructive_interference_size`) guarantees each counter starts a fresh line. The measured effect mirrors the Go demo: the padded version scales with cores, the unpadded one does not — same mechanism, same fix, just spelled in the language's alignment syntax.

---

## Pitfalls

- **Premature layout optimization.** AoS/SoA conversion, tiling, and padding all *complicate* the code (SoA scatters one logical record across arrays; padding wastes memory). Apply them to **measured hot paths only**. A cold struct touched once per request gains nothing from SoA and loses readability. Profile first — find the loop whose effective bandwidth is low — then transform that loop, not the whole codebase.

- **SoA hurts random-by-record access.** The most common over-correction: converting everything to SoA because "SoA is faster." For a loop that reads *all* fields of *random* records, SoA scatters one record across `d` arrays = `d` misses, where AoS would have spent `O(1)`. Choose the layout from the *access shape*: columnar/bulk → SoA; record-at-a-time/random → AoS. Hot/cold splitting is the middle ground when only *some* fields are hot.

- **False sharing is invisible in single-thread tests.** The code is logically correct and single-threaded benchmarks look fine; the regression appears only under concurrency, and often as *negative* scaling (more threads → slower). If embarrassingly-parallel per-core work refuses to scale, suspect two hot variables on one line before anything else. It will not show up in a correctness test or a single-thread profile — only in a multithreaded throughput measurement.

- **Padding wastes space — do not pad indiscriminately.** Line-padding a hot, contended per-core counter is right; line-padding a million records to "avoid false sharing" balloons memory and *worsens* cache behavior (fewer records per line = more misses on traversal). Pad only **hot, written, contended** state. Padding read-mostly or single-threaded data is pure waste.

- **Tiling for the wrong `M`.** A tile size `T = √M` tuned to one machine's L1 is wrong on a machine with a different cache, and tuning to L1 alone leaves L2/L3 reuse on the table. Cache-aware code must either be retuned per platform or use the [cache-oblivious recursion](../02-cache-oblivious-algorithms/middle.md) that needs no tuning. Pick `T` too large and the tile spills out of cache (back to capacity misses); too small and per-tile overhead dominates and you under-use the cache.

- **Confusing the line size with the page size, or assuming `B = 64` forever.** Cache-aware constants (`B`, `M`) are hardware-specific. Hardcoding `64` is usually safe today but is exactly the kind of assumption the cache-oblivious model exists to avoid; query `std::hardware_destructive_interference_size` / `sysconf` / `/sys/.../cache` rather than guessing when portability matters.

- **Ignoring that the prefetcher already helps sequential access.** Naive sequential AoS is not as bad as the `d/f` waste formula alone suggests, because the stride prefetcher hides much of the wasted-line latency. The waste formula bounds *memory traffic*; *wall-clock* gains from SoA are often a bit smaller than `d/f` because the prefetcher was masking the AoS cost. Measure, do not assume the ceiling.

---

## Summary

- **The line is the unit of transfer**, exactly the [I/O model](../01-the-io-model/middle.md)'s block `B` applied to CPU caches: a miss fetches a whole `B`-byte line. **Spatial locality** (use a line's `B` bytes via good layout) and **temporal locality** (reuse before eviction via good traversal order) are the two properties that make a fetched line pay off. The metric that summarizes them is **effective bandwidth = useful bytes / line bytes fetched**, which every transform here drives toward `1`, and the guiding condition is **working set `≤ M` ⇒ resident after `Θ(W/B)` compulsory misses**.

- **AoS vs SoA, quantified:** a loop touching `f` of `d` fields wastes a fraction `(d−f)/d` of every AoS line; SoA touches only useful bytes for up to a `d/f` speedup, and additionally enables **SIMD** (contiguous fields = one vector load). The exception that reverses the choice: **random access reading all `d` fields of few records** — AoS keeps each record on `O(1)` lines, SoA scatters it across `d`. Columnar/bulk → SoA; record-at-a-time/random → AoS.

- **Loop tiling** manufactures temporal locality. The naive matrix multiply gets blocking but **no reuse** — `Θ(n³/B)` misses. Tiling with `T = Θ(√M)` so three tiles fit in cache (`3T² ≤ M`) makes the inner `T³` work run resident, giving `(n/T)³ · Θ(T²/B) = Θ(n³/(B√M))` — a `√M` reuse factor. This is the **cache-aware** twin of the [cache-oblivious recursion](../02-cache-oblivious-algorithms/middle.md)'s identical bound; tiling computes `T` from a known `M` (and must be retuned per machine), recursion needs neither `M` nor `B`.

- **Cache-conscious data structures** cluster what a traversal visits onto shared lines: **implicit (pointerless) trees** (heap-style `2i+1` indexing, no indirection miss), **wide B-tree-style nodes** sized to a line for `Θ(log_B N)` search, the **van Emde Boas layout** (recursive height-halving → contiguous base trees → `Θ(log_B N)` misses), and **Chilimbi hot/cold splitting + field reordering** (keep hot fields dense, exile cold fields).

- **False sharing:** two cores writing different variables on the *same line* force the line to **ping-pong between caches** via coherence traffic, killing scaling — and it is **invisible in single-thread tests**. The fix is **padding/aligning each hot per-core variable to its own line** (56 bytes of pad for an 8-byte counter at `B=64`), traded only for hot, contended state.

- **Prefetching** makes sequential layout *doubly* good: spatial locality fetches fewer lines, and the **hardware stride prefetcher** hides their latency by fetching ahead — while pointer-chasing and random strides starve it. Good layout (SoA, tiled, implicit-tree) presents the regular strides the prefetcher needs; **software prefetch hints** cover predictable-but-irregular patterns.

- **Measured:** SoA approaches the `d/f` ceiling, tiling buys the `√M` factor with identical arithmetic, and padding is worth an `≈ 8×` multithreaded speedup over false-shared counters.

Continue to the [senior level](./senior.md) for multi-level blocking, register tiling and micro-kernels, NUMA-aware placement, the coherence-protocol detail behind false sharing, and array-of-structs-of-arrays (AoSoA) hybrids. Compare the tuning-free counterpart in [cache-oblivious algorithms](../02-cache-oblivious-algorithms/middle.md), revisit the shared cost model in [the I/O model](../01-the-io-model/middle.md), and for the mechanical foundations return to [junior](./junior.md).
