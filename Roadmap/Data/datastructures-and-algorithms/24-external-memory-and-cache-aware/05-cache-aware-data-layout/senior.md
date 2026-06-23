# Cache-Aware Data Layout — Senior Level

## Prerequisites

- [Middle Level](./middle.md) — cache lines and the cost of a miss, the **array-of-structures vs structure-of-arrays (AoS/SoA)** choice, loop tiling/blocking, **false sharing** and padding, hardware/software prefetch, and the basic locality vocabulary
- [The I/O Model — Senior](../01-the-io-model/senior.md) — the two-level `(N, M, B)` model and the `Θ(log_B N)` search bound that block-conscious layouts target, now with the cache line as `B`
- [Cache-Oblivious Algorithms — Senior](../02-cache-oblivious-algorithms/senior.md) — the van Emde Boas recursive layout and why a *parameter-free* layout can match a *parameter-tuned* one, the foil against which cache-*aware* layouts here are measured
- [B-Tree I/O Analysis — Senior](../04-b-tree-io-analysis/senior.md) — block-conscious node design, the structure whose in-memory cache-aware cousin (CSB+-tree) appears below

## Table of Contents

1. [What Senior-Level Cache-Aware Layout Is About](#what-senior-level-cache-aware-layout-is-about)
2. [Data-Oriented Design as a Discipline](#data-oriented-design-as-a-discipline)
3. [Cache-Conscious Data Structures: Chilimbi and Lattner](#cache-conscious-data-structures-chilimbi-and-lattner)
4. [Tree Layouts for Search: Eytzinger, vEB, and CSB+-Trees](#tree-layouts-for-search-eytzinger-veb-and-csb-trees)
5. [Worked Piece: Why Eytzinger Binary Search Beats Sorted-Array Binary Search](#worked-piece-why-eytzinger-binary-search-beats-sorted-array-binary-search)
6. [Multidimensional Locality: Space-Filling Curves](#multidimensional-locality-space-filling-curves)
7. [Columnar Storage, Vectorization, and PAX](#columnar-storage-vectorization-and-pax)
8. [NUMA-Aware Layout](#numa-aware-layout)
9. [Cache-Aware vs Cache-Oblivious Layout](#cache-aware-vs-cache-oblivious-layout)
10. [Decision Framework](#decision-framework)
11. [Research Pointers](#research-pointers)
12. [Key Takeaways](#key-takeaways)

---

## What Senior-Level Cache-Aware Layout Is About

The middle level establishes the *micro-mechanics*: a cache line is `64` bytes, a miss costs hundreds of cycles, AoS wastes bandwidth when you touch one field of many, SoA fixes it, tiling keeps a working set resident, false sharing destroys scaling, and prefetch hides latency when the access pattern is predictable. That is the "here are the knobs" level — local, tactical, per-loop.

Senior-level cache-aware layout is about the *discipline and the deep techniques* that turn those knobs into an architecture. The unifying fact behind all of it is the **memory wall**: since roughly the mid-1990s, processor throughput has grown far faster than DRAM latency, so a modern core can retire on the order of hundreds of instructions in the time one last-level-cache miss takes to resolve. The binding resource is no longer arithmetic; it is *the rate at which the right bytes arrive in registers*. Four threads run through the senior treatment:

1. **Layout is an architectural choice, not a micro-optimization.** **Data-oriented design (DOD)** — Mike Acton's framing — organizes a program *around the data's access pattern and the transformations applied to it*, not around the object identities of OOP. The senior obligation is to see *why* this wins on memory-wall hardware: it is the only discipline that systematically converts the dominant cost (stalls) into the cheap one (instructions).

2. **There are real data structures, not just rearranged loops.** Chilimbi's **cache-conscious structures** (structure splitting, field reordering, instance clustering / `ccmalloc`) and Lattner's compiler-driven *automatic pool allocation* are principled transformations with measured wins. They generalize AoS/SoA from arrays to pointer-linked structures.

3. **Search structures have layouts, and the layout dominates.** The **Eytzinger (implicit BFS)** array layout makes binary search branch-free and prefetchable and beats classic sorted-array binary search on cache; the **van Emde Boas** recursive layout gives `Θ(log_B N)` blocks; **CSB+-trees** (Rao–Ross) raise B-tree fanout by *deleting child pointers*. These are the cache-aware mirrors of the cache-oblivious layouts in [`../02-cache-oblivious-algorithms/senior.md`](../02-cache-oblivious-algorithms/senior.md).

4. **Locality is multidimensional, columnar, and NUMA-shaped.** **Space-filling curves** (Morton/Z-order, Hilbert) map `k`-D data to 1-D while preserving neighborhood; **columnar storage** is SoA at database scale and is what makes SIMD and lightweight compression pay off; **NUMA-aware placement** extends the whole story one level out, where "remote DRAM" is the new slow tier and first-touch is the new tiling.

The senior stance: **a cache-aware layout is a deliberate map from the program's access pattern onto the physical hierarchy — line, page, NUMA node — chosen because on memory-wall hardware the layout, not the algorithm's instruction count, sets the running time.**

---

## Data-Oriented Design as a Discipline

Object-oriented design organizes code by *conceptual identity*: a `GameObject` owns its position, velocity, health, mesh, and AI state, all interleaved in one record, because they "belong to the same thing." Data-oriented design rejects identity as the organizing principle and organizes by *what the hardware does with the data*.

### The three premises

> **Data-oriented design (Acton, "Data-Oriented Design and C++", CppCon 2014).** (1) *The purpose of a program is to transform data;* design from the data and its transformations, not from idealized object models. (2) *Different data is transformed differently;* group data by the transformation that reads it, not by the object that conceptually owns it. (3) *Where there is one, there are many;* the common case is a homogeneous collection processed in bulk, so design for the *many* (the array, the batch), not for the singular instance.

The third premise — "where there's one, there's many" — is the load-bearing one. OOP optimizes the *single* object: a clean `class` with all its fields together. But programs almost never touch one object; they sweep over thousands every frame or every query. DOD's **existential processing** idea sharpens this: an entity does not need an `isAlive` flag checked in a branch; its *existence in a particular array* encodes its state. Instead of one heterogeneous list with per-element conditionals (`if (obj.active && obj.visible) draw(obj)`), keep separate homogeneous arrays (a `visible` array, a `culled` array) and process each in a tight branch-free loop. State becomes *which array you are in*, and the transformation becomes a straight scan.

### Why DOD wins on memory-wall hardware

State the cost model precisely, because it is the whole argument:

- **The dominant cost is the stall, not the instruction.** A core that can issue several instructions per cycle (high IPC when fed) collapses to a tiny effective IPC when it stalls on a last-level-cache miss, because the hundreds of cycles spent waiting retire nothing. Wasted *bandwidth* is wasted *time*: every byte pulled into a line and not used is latency you paid for and threw away.
- **OOP layout systematically wastes bandwidth.** An AoS `GameObject` of, say, `128` bytes, swept to update only the `12`-byte position+velocity, drags `116` bytes of cold fields through cache on every element — under 10% of the bus is doing useful work, so the loop runs at under a tenth of bandwidth-limited speed.
- **DOD layout systematically saves it.** Splitting position+velocity into their own SoA arrays packs `~5` elements per `64`-byte line, every byte used, and the access pattern is a linear stream the hardware prefetcher predicts perfectly — turning random-latency-bound code into bandwidth-bound code that runs near peak.

The senior framing: **DOD is the program-architecture-level generalization of AoS→SoA.** The middle level applies SoA to one hot loop; DOD applies the same principle — *organize by access pattern, design for the many, let position-in-collection encode state* — to the entire system. It is unpopular to state but true on this hardware: the OOP instinct to colocate by identity is a *pessimization* whenever the access pattern is "touch one field across many objects," which is the common case. DOD is not anti-abstraction; it is *choosing the abstraction boundary to match the transformation rather than the noun*.

---

## Cache-Conscious Data Structures: Chilimbi and Lattner

DOD is a discipline for *arrays you control*. The harder problem is pointer-linked structures — trees, lists, graphs — where the elements are heap-scattered and a traversal is a chain of cache misses. Trishul Chilimbi's thesis work (Chilimbi, Hill, Larus; late 1990s) made the AoS/SoA insight rigorous and extended it to such structures, and Chris Lattner later automated a key piece in a compiler.

### Structure splitting (hot/cold field separation)

> **Structure splitting (Chilimbi–Davidson–Larus 1999).** Partition a structure's fields into a **hot** part (frequently accessed, often in the inner loop) and a **cold** part (rarely accessed). Store the hot parts contiguously in their own array; replace the cold fields with a pointer (or parallel-array index) to the cold part.

The payoff: the hot array packs more elements per line, so a sweep over the hot fields touches fewer lines and prefetches cleanly, while the cold fields — error strings, debug metadata, rarely-read configuration — are exiled out of the working set instead of polluting every line. This is exactly AoS→SoA applied *within one record* rather than across an array, decided by *access frequency*, and profiling drives the split: instrument which fields the hot loops actually read.

### Field reordering by access frequency

A weaker but cheaper transformation when you cannot split: **reorder fields so that fields accessed together are placed together**, packing co-accessed fields into the same line and pushing rarely-touched fields to their own lines. Compilers and profile-guided tools (and the programmer, by hand) cluster a structure's fields by an access-affinity graph derived from profiling — the goal is to minimize the number of *distinct* lines a typical operation touches.

### Instance clustering and pool allocation (`ccmalloc`)

Splitting and reordering fix *intra-structure* layout; they do nothing for *where the instances live*. A tree built by repeated `malloc` scatters its nodes across the heap, so a root-to-leaf traversal hops through unrelated lines.

> **Cache-conscious allocation (Chilimbi–Hill–Larus, `ccmalloc` / `ccmorph`).** `ccmalloc` takes a *hint* — a pointer to a logically related, recently-allocated object — and places the new object on the same cache line or block when possible, *clustering* instances that will be traversed together. `ccmorph` reorganizes an existing read-mostly tree into a cache-conscious layout (clustering subtrees into blocks), analogous to laying a tree out in vEB or B-tree order.

The principle: **make the heap layout follow the traversal order.** A subtree clustered into one block is traversed with one miss instead of one-per-node — the pointer-structure analogue of contiguous array storage.

### Automatic Pool Allocation (Lattner)

Chris Lattner and Vikram Adve's **Automatic Pool Allocation** (PLDI 2005) pushes clustering into the compiler. Using a points-to / data-structure analysis, the compiler proves which heap objects belong to the same logical data structure and segregates them into **pools** — per-data-structure memory regions — so that, e.g., all nodes of one list live in one contiguous pool rather than interleaved with unrelated allocations.

The senior point: pool allocation turns a *whole-program* property ("these objects form one traversable structure") into a *layout* property ("these objects are contiguous"), automatically, and it is a foundational pass in LLVM's heritage. It is the compiler doing `ccmalloc`'s clustering without programmer hints — the most general statement of "lay the heap out to match access." Together, Chilimbi's manual transforms and Lattner's automatic ones cover the spectrum from hand-tuned hot/cold splits to whole-program pool segregation, all serving the one idea: *co-accessed data should be co-located in memory*.

---

## Tree Layouts for Search: Eytzinger, vEB, and CSB+-Trees

A sorted set supports search, and the *algorithm* (binary search, B-tree descent) is fixed — but the *layout* of the same logical tree in memory is a free variable, and on memory-wall hardware it dominates. Three layouts matter at senior level.

### The implicit / Eytzinger (BFS) layout

The classic sorted-array binary search has a layout problem hiding in plain sight. The first probe hits the middle, the next hits a quarter or three-quarters in, the next an eighth — the early probes are *far apart in the array*, each on its own line, and only the last few probes are close enough to share a line. The first `log₂(N/B)` probes are essentially guaranteed misses.

The **Eytzinger layout** (named for the genealogist Eytzinger, who in 1590 numbered ancestors breadth-first; the same as the implicit binary-heap layout) stores the *balanced BST in breadth-first order* in an array, `1`-indexed:

```text
   Sorted array:    [ a b c d e f g ]            (indices 0..6)
   As a balanced BST, BFS / level order:
                            d                     (root)
                        b       f
                      a   c   e   g
   Eytzinger array: [ _ d b f a c e g ]           (index 0 unused; root at 1)
   Navigation:  from node i, left child = 2i, right child = 2i+1.
```

Search becomes a pointer-free, branch-friendly descent:

```text
EYTZINGER-SEARCH(array t, key x):
    i = 1
    while i <= N:
        i = 2*i + (x > t[i] ? 1 : 0)     # branchless: one comparison, no branch
    # recover the predecessor index from the trailing bits of i  (see worked piece)
```

Two structural wins flow from BFS order. First, the descent has a **predictable, prefetchable** access pattern: from index `i`, the *next* two candidates are `2i` and `2i+1`, adjacent in memory, so the hardware can be told to prefetch `t[2i]` and `t[4i]` ahead of need — the misses are *known in advance*, unlike sorted-array binary search where the next probe depends on the comparison result. Second, the top of the tree is **packed into the front of the array**, so the first several levels (the universally-visited root region) share a handful of lines that stay hot across all queries. The worked piece below quantifies why this beats sorted-array binary search.

### The van Emde Boas (cache-aware) layout

Eytzinger's BFS order is cache-*aware* only in a weak sense: it is good but not block-optimal, because a BFS layout still spreads one root-to-leaf path across `Θ(log₂(N/B))` lines once you descend past the packed top. The **van Emde Boas (vEB) layout** — recursively split the height-`h` tree at its *middle level* into a top tree of height `h/2` and `√N` bottom trees of height `h/2`, store top-then-bottoms contiguously, recursively lay out each — achieves `Θ(log_B N)` *blocks* per search because some recursion level produces subtrees of `Θ(B)` size that are block-aligned. The full vEB development, including why it is *cache-oblivious* (it needs no knowledge of `B`), lives in [`../02-cache-oblivious-algorithms/senior.md`](../02-cache-oblivious-algorithms/senior.md). For the cache-*aware* engineer, the takeaway is the comparison: Eytzinger is simpler, branch-free, and prefetch-friendly, and on real hardware it is often *faster* than vEB despite vEB's superior asymptotic block count, because Eytzinger's prefetchability hides the extra misses (Khuong–Morin, "Array Layouts for Comparison-Based Searching", 2017, benchmarked exactly this and found Eytzinger with prefetch the practical winner).

### CSB+-trees: deleting pointers to raise fanout

For a *dynamic*, cache-resident search tree, the relevant unit is again the cache line, and the B+-tree node should be sized to a small number of lines. But a conventional B+-tree node spends half its space on **child pointers** — `k` keys need `k+1` pointers — so on a 64-bit machine, half of every node's bytes carry no keys, halving the fanout and thus the information per line.

> **Cache-Sensitive B+-Tree (CSB+-tree) — Rao & Ross, SIGMOD 2000.** Store the *children of a node contiguously* in one **node group**, so a node needs only **one** pointer (to the start of its child group) plus an implicit offset, instead of one pointer per child. Eliminating the per-child pointers nearly *doubles* the fanout for a given node size — the freed bytes hold keys — which lowers the tree height and the number of cache lines touched per search.

This is the same move as Eytzinger's "navigate by arithmetic, not by pointer," applied to a dynamic B+-tree: arithmetic on a contiguous child group replaces stored pointers, trading pointer-chasing for index computation. Rao and Ross's earlier **Cache-Sensitive Search Tree (CSS-tree)** did this for the *static* read-only case (a perfectly balanced tree in an array, children located purely by arithmetic, *zero* stored pointers — the multiway generalization of Eytzinger). The cost CSB+ pays is on update: keeping a child group contiguous makes node splits move more memory than in a plain B+-tree (a split may relocate a whole sibling group), so CSB+ is the right choice for *read-mostly* in-memory indexes — the same read/write-ratio judgment as the [B^ε/LSM curve](../04-b-tree-io-analysis/senior.md) one level down the hierarchy.

The senior thread tying these together: **all three layouts buy cache efficiency by replacing stored pointers with implicit, arithmetic navigation over a contiguous region** — Eytzinger for static binary search, CSS/CSB+ for multiway search, vEB for block-optimal obliviousness — because every pointer you *store* is a byte not spent on keys and a hop the prefetcher cannot predict.

---

## Worked Piece: Why Eytzinger Binary Search Beats Sorted-Array Binary Search

This is the calculation that earns the layout. Compare classic sorted-array binary search against the Eytzinger layout on the only metric that matters on memory-wall hardware: cache misses on the critical path, and whether they can be overlapped.

### Sorted-array binary search: the miss pattern

Searching `N` sorted elements, `B` elements per cache line. The probe sequence is `N/2, N/4` or `3N/4`, `N/8, …` — successive probes that, near the top of the search, are separated by `N/2, N/4, N/8, …` array positions. A probe lands on the same line as the previous one only once the gap drops below `B`, i.e. only for the last `log₂ B` probes. The total probe count is `log₂ N`; of those, the first

```text
   log₂ N − log₂ B = log₂(N/B)
```

probes are on distinct, far-apart lines — **each a near-certain cache miss**, and worse, each miss is *serialized*: the address of probe `k+1` depends on the comparison at probe `k`, so the CPU cannot issue the next memory request until the current one returns. The critical path is `Θ(log₂(N/B))` *dependent* misses, latency stacked end to end, with nothing to overlap them.

### Eytzinger: the same probes, but prefetchable and front-loaded

The Eytzinger descent visits the *same* `log₂ N` comparisons (it is the same balanced tree), so the *miss count* is comparable — the top levels still miss. The two wins are structural:

1. **The top of the tree is packed at the front of the array.** Levels `0,1,2,…` of the BFS layout occupy array indices `1`, `2..3`, `4..7`, … — the first `B` elements hold the top `log₂ B` levels, all on one or two lines that stay resident across *every* query in a workload. So the universally-hot root region costs `O(1)` lines amortized, where the sorted array re-misses the far-apart top probes per query.

2. **The future probes are known and prefetchable.** From index `i`, the search will go to `2i` then `2i+1` or further; the entire *subtree* of upcoming candidates sits at indices `2i, 4i, 8i, …`. The code can issue `prefetch(t[k*i])` for the level `~log₂ k` ahead *before* it is needed, so the miss for a future probe is launched early and its latency overlaps the comparisons of the current ones. This converts the *serialized* dependent-miss chain of sorted-array search into a *pipelined* one — the killer property, because memory latency is the bottleneck and overlapping it is the only way to hide it.

### The branch-free bonus and the index recovery

The descent `i = 2*i + (x > t[i])` is **branchless** — the comparison's boolean is added directly to the index, so there is no data-dependent branch for the predictor to mispredict (binary search's branch is famously unpredictable: it is "random" by construction). One mispredict costs a pipeline flush of ~15–20 cycles; eliminating it across `log₂ N` iterations is a second, independent win on top of the cache behavior.

The one subtlety is recovering the answer. When the loop exits, `i` has run *past* the leaves (`i > N`); the index of the predecessor (largest key `≤ x`) is recovered by shifting `i` right until the trailing `1`-bits are cleared:

```text
   # After the loop, i overshot. The path of left/right turns is encoded in i's bits.
   # The predecessor index is i >> (number_of_trailing_ones(i) + 1), in 1-based BFS terms.
   result_index = i >> (__builtin_ffs(~i))     # clear the trailing 1s, one shift
```

The trailing-ones trick works because each "go right" set a bit and each "go left" cleared the position; the last "go left" we should have stopped at is found by stripping the run of rights at the bottom. It is `O(1)` bit arithmetic, paid once.

### The verdict

> **Result (Khuong–Morin 2017, "Array Layouts for Comparison-Based Searching").** With software prefetching, the **Eytzinger layout is the fastest comparison-based search layout** on modern hardware for in-memory data, beating sorted-array binary search (and often beating the asymptotically-better vEB and B-tree layouts), because its prefetchability lets it *overlap* the cache misses that sorted-array binary search is forced to *serialize*, and its branch-free descent eliminates mispredictions.

The senior lesson is general: **the asymptotic miss count is not the whole story; whether the misses are dependent or overlappable is.** Sorted-array binary search and Eytzinger have the *same* asymptotic `Θ(log(N/B))` top-level misses, but one chain is serial and one is pipelined, and on memory-wall hardware that is the difference between memory-latency-bound and memory-bandwidth-bound — a several-fold gap. This is the same "overlap the latency" principle that prefetch serves in the middle level, here baked into the *layout* rather than added as an afterthought.

---

## Multidimensional Locality: Space-Filling Curves

Everything above is one-dimensional: a record, an array, a tree path. Real data is often `k`-dimensional — image pixels `(x, y)`, spatial points `(lat, lon)`, matrix entries `(i, j)` — and the question is how to lay `k`-D data into 1-D memory so that points *near in `k`-D space are near in memory*. Row-major order fails badly: two pixels vertically adjacent (`(x, y)` and `(x, y+1)`) are a full row apart in memory. **Space-filling curves** solve this by interleaving the dimensions.

### Z-order (Morton) curves: bit interleaving

> **Morton / Z-order code.** Given coordinates `x = x_{n-1}…x_1 x_0` and `y = y_{n-1}…y_1 y_0`, the Morton code interleaves their bits: `morton(x, y) = … x_2 y_2 x_1 y_1 x_0 y_0`. Sorting points by Morton code lays them out along a recursive **Z-shaped** curve that visits each `2×2` quadrant fully before moving on, at every scale.

The mechanism is purely bitwise — interleave with a few shift-and-mask "magic number" steps — which is why Morton order is the cheap, ubiquitous choice. Its key property is **recursive quadrant locality**: a contiguous run of Morton codes corresponds to a (mostly) square region of `k`-D space, so storing a 2-D array or image in Morton order means that a `2^k × 2^k` tile is a *contiguous* memory range. This is exactly **blocked/tiled layout** generalized to all scales at once: a Morton-ordered matrix is implicitly tiled at every power-of-two block size, so a cache-blocked traversal needs no explicit tiling loop — the layout *is* the blocking. (Note the structural echo of the [vEB recursive split](../02-cache-oblivious-algorithms/senior.md): Morton order tiles space recursively the way vEB tiles a tree, and a **Morton-order matrix** is a cache-*oblivious*-friendly layout for transpose and multiply.)

Morton's one flaw is the **"Z" jump**: at quadrant boundaries the curve makes a long diagonal leap (the bottom-right of one quadrant to the top-left of the next), so two spatially-adjacent points straddling a boundary can be far apart in code. For most uses this is acceptable; when it is not, the Hilbert curve fixes it.

### Hilbert curves: better locality, higher cost

> **Hilbert curve.** A space-filling curve that, unlike Z-order, is **continuous** — consecutive positions on the curve are always spatial neighbors (no long jumps) — by rotating and reflecting the sub-curve in each quadrant so the curve enters and exits adjacent quadrants contiguously.

The Hilbert curve has strictly better **clustering** (fewer "runs" needed to cover a query rectangle, so range queries touch fewer disjoint memory segments) than Morton, at the cost of a more complex encode/decode (the per-level rotation state must be tracked). The senior trade-off: **Morton for cheap encoding and when occasional boundary jumps are tolerable; Hilbert when range-query locality is worth the encoding cost** (it is the standard choice in spatial indexes that prioritize range performance).

### Where this is used

- **Spatial indexes.** Both curves linearize 2-D/3-D keys so a 1-D B-tree or LSM index serves spatial range queries; this is the **linear quadtree** / Morton-keyed index, and it underpins many production geospatial systems. The tree-structured alternatives — [quadtrees and octrees](../../09-trees/16-quadtree-octree/) and [R-trees](../../09-trees/17-r-tree/) — partition space explicitly; space-filling curves instead bring spatial locality to a *flat* index by clever key ordering.
- **Tiled images and textures.** GPU textures are stored in Morton ("swizzled") order so that 2-D-adjacent texels share a cache line regardless of access direction.
- **Matrices.** Morton-order (and Hilbert-order) matrix layouts make blocked dense linear algebra locality-friendly without explicit tiling loops, and pair naturally with recursive cache-oblivious matrix algorithms.
- **Databases.** Multidimensional clustering (e.g., Z-ordering of columns in analytics engines) co-locates rows that are near in several dimensions, so multi-predicate range scans read fewer blocks.

The unifying idea: **a space-filling curve is a cache-aware layout for `k`-D data — it chooses the one ordering of multidimensional points that makes "near in space" imply "near in memory," at every scale,** turning multidimensional locality into the one-dimensional contiguity the hardware rewards.

---

## Columnar Storage, Vectorization, and PAX

SoA at the scale of a *whole dataset* is **columnar storage** — the dominant layout for analytics — and it is the most consequential cache-aware layout in data systems.

### Why columns win for analytics

A row store (AoS) keeps each record's fields contiguous: good for OLTP, where a transaction reads or writes a whole row. An analytical query, by contrast, scans *one or a few columns across millions of rows* (`SELECT AVG(price) WHERE region = 'EU'`). On a row store this drags every unread column through cache — the AoS bandwidth waste, at dataset scale. A **column store** keeps each column contiguous, so the scan reads *only* the columns it touches, every byte on the bus used. This is precisely the AoS→SoA argument promoted from a loop to a storage engine, and three further wins compound it:

1. **SIMD / vectorization.** A contiguous column of homogeneous values is the ideal SIMD operand: a single vector instruction applies the predicate or aggregate to `8`/`16` values at once. Vectorized execution engines (MonetDB/X100, Vectorwise) process data in cache-resident *vectors* of a column precisely so the hot loop is a tight, branch-light, SIMD-friendly scan over contiguous memory.
2. **Lightweight compression.** A column of like-typed values compresses far better than a heterogeneous row. **Run-length encoding (RLE)** crushes sorted or low-cardinality columns; **dictionary encoding** replaces wide values with small codes; **bit-packing / frame-of-reference** stores integers in the minimum bits needed. Compression multiplies effective bandwidth (more useful values per byte fetched) — and crucially, many operators run *directly on the compressed form* (compare dictionary codes, sum RLE runs), so compression saves both I/O and CPU.
3. **Late materialization.** Because columns are separate, the engine can apply predicates on a few columns, produce a *position list* of qualifying rows, and fetch the other columns *only for surviving positions* — deferring (materializing) the wide columns until late, so cold columns of rejected rows are never touched. This is existential-processing/DOD at query-engine scale.

### PAX: the hybrid

Pure columnar layout has a cost: reconstructing a full row (needed by some queries and by OLTP) requires gathering one value from each of many separate column files — a scattered, cache-unfriendly access. **PAX** resolves this.

> **PAX — Partition Attributes Across (Ailamaki, DeWitt, Hill, Skounakis, VLDB 2001).** Within each disk *page*, store data **column-major** (group all values of attribute 1, then all of attribute 2, …) while keeping each page's *set of rows* the same as a row store. A page holds the same rows as NSM (row layout) but lays them out by column internally.

PAX gets the best of both: a scan of one attribute reads only that attribute's mini-column *within each cache line / page* (cache- and bandwidth-efficient like a column store), while a full-row reconstruction stays *within a single page* (no cross-file gather — cheaper than pure columnar). The senior framing: **PAX is a cache-conscious page layout that decouples the storage granularity (page = rows, for I/O and reconstruction) from the access granularity (column-major within the page, for cache efficiency).** It is the direct ancestor of modern hybrid formats (e.g., the per-row-group column chunks of Parquet/ORC), and it is the cleanest illustration that *the layout question recurs at every level of granularity* — record, cache line, page, file.

---

## NUMA-Aware Layout

Everything above treats "memory" as one tier behind the cache. On a multi-socket server, that is false: memory is **NUMA** (Non-Uniform Memory Access) — each socket has its own local DRAM, and accessing another socket's DRAM (a *remote* access) costs noticeably more latency and shares a limited inter-socket interconnect's bandwidth. NUMA is "the cache hierarchy with one more, larger, slower tier," and the cache-aware discipline extends to it directly.

### First-touch placement

> **First-touch policy.** On Linux (the default), a virtual page is physically allocated on the NUMA node of the thread that *first writes* to it, not the thread that called `malloc`. Allocation reserves address space; the page is placed on first touch.

The consequence trips up nearly everyone: if one initialization thread touches a whole array first, the *entire array lands on that thread's node*, and every other thread's accesses are remote — a single-node memory bottleneck masquerading as a scaling problem. The fix is to **initialize data with the same parallel decomposition that will later process it**, so each thread first-touches (and thus places locally) the partition it will own. The senior rule: *place data by the access pattern that will dominate*, which for parallel workloads means parallelizing the initialization to match the computation.

### Per-node data and avoiding remote traffic

Beyond first-touch, NUMA-aware structures **replicate read-mostly data per node** (each socket gets a local copy of a lookup table, trading memory for zero remote reads) and **partition write-heavy data per node** (each socket owns a shard, so writes stay local). Explicit placement via `numactl`, `libnuma` (`numa_alloc_onnode`), or `mbind` overrides first-touch when the natural touch order does not match the access pattern. The goal is the same as cache tiling one level down: *keep the working set in the fast, local tier; minimize traffic to the slow, remote one.*

### Interaction with false sharing

NUMA sharpens the false-sharing problem from the middle level. A cache line bouncing between two cores on the *same* socket is expensive; a line bouncing between cores on *different* sockets is far worse, because the coherence traffic crosses the interconnect. So NUMA-aware layout subsumes the false-sharing discipline: pad and align per-thread data to line boundaries *and* place each thread's data on its own node, so neither intra-socket nor inter-socket coherence storms arise. The senior synthesis: **NUMA-aware layout is cache-aware layout with the node as the outer tier — first-touch is tiling, per-node replication is keeping the working set local, and cross-node false sharing is the false-sharing problem with a much steeper coherence cost.**

---

## Cache-Aware vs Cache-Oblivious Layout

Every cache-aware layout here has a cache-*oblivious* counterpart in [`../02-cache-oblivious-algorithms/senior.md`](../02-cache-oblivious-algorithms/senior.md), and a senior engineer must state the trade precisely.

- **Cache-aware** layouts *name the parameters.* A B+-tree (or CSB+-tree) node is sized to a page or a small number of lines; a tiled matrix uses tile `√M`; SoA arrays and column vectors are sized to the cache. They win the micro-benchmark on a *fixed* machine and a *single dominant* level, with the tightest constants — but they must be *re-tuned* per machine and they optimize one level at a time.
- **Cache-oblivious** layouts are *parameter-free* and optimal at *every* level at once: the vEB tree layout searches in `Θ(log_B N)` blocks for *all* `B`, a Morton/recursive matrix layout tiles at every scale, funnelsort sorts at every level — no `B`, `M`, or page size named. They win portability and multi-level reach; they pay in larger constants and need the tall-cache regularity.

The two meet most visibly in tree search. **Eytzinger (cache-aware-ish, prefetchable) vs vEB (cache-oblivious, block-optimal)**: vEB has the better *asymptotic* block count, but Eytzinger-with-prefetch usually *wins in wall-clock* (Khuong–Morin) because its predictable access pattern overlaps misses while vEB's recursive addressing is harder to prefetch and has more index-arithmetic overhead. This is the cache-aware-vs-oblivious tension made concrete: **the asymptotically-superior oblivious layout loses to the prefetchable aware one because real performance is set by overlappable latency and constant factors, not block count alone** — exactly the lesson of the worked piece.

The senior position is not "pick one." It is: *use cache-oblivious layouts when you need portability across an unknown or multi-level hierarchy (library code, recursive algorithms, matrices) and cache-aware layouts when you own the machine and want peak constants on its dominant level (a database engine sized to its page and line, a CSB+ index tuned to the cache line).* They are two points on the tuning–generality spectrum, identical in spirit and differing only in whether the layout names the hardware.

---

## Decision Framework

| Situation | Reach for | Why |
| --- | --- | --- |
| Sweep one field across many objects | **SoA / DOD** (split by access pattern) | Every byte on the line is used; linear, prefetchable; the AoS→SoA win at system scale |
| A record with hot and cold fields | **Structure splitting** (Chilimbi) | Hot array packs more per line; cold fields exiled from the working set |
| Pointer structure traversed in a fixed order | **Instance clustering / pool allocation** (`ccmalloc`, Lattner) | Lay the heap out to match traversal; one miss per block, not per node |
| Static in-memory binary search | **Eytzinger layout** (branch-free + prefetch) | Overlaps the misses sorted-array search serializes; no branch mispredicts |
| Block-optimal search, portable across `B` | **vEB layout** ([cache-oblivious](../02-cache-oblivious-algorithms/senior.md)) | `Θ(log_B N)` blocks with no knowledge of `B` |
| Read-mostly in-memory multiway index | **CSB+-tree** (Rao–Ross) | Delete child pointers → ~2× fanout → fewer lines per search |
| Map `k`-D data to 1-D, cheap encoding | **Morton / Z-order** (bit interleaving) | Recursive quadrant locality = implicit tiling at all scales |
| Map `k`-D data to 1-D, best range locality | **Hilbert curve** | Continuous (no jumps); fewer runs per query rectangle |
| Analytical scans over few columns | **Columnar storage** (+ SIMD, RLE/dict/bit-pack, late materialization) | Reads only touched columns; compression multiplies bandwidth; vectorizes |
| Need both scans *and* row reconstruction | **PAX** (Ailamaki) | Column-major within a page; cache-efficient scan, in-page reconstruction |
| Multi-socket server, parallel workload | **NUMA-aware: first-touch by partition, per-node data** | Keep the working set in local DRAM; avoid remote-interconnect traffic |

Two rules of thumb:

1. **Profile the access pattern, then lay out to match it.** Every transformation here is "co-locate what is co-accessed, separate what is not" — but *what* is co-accessed is a measured property of the workload, not a guess. Structure splitting, field reordering, Z-ordering, and NUMA placement all start from a profile.
2. **The metric is overlappable misses and used bytes per line, not asymptotic block count.** On memory-wall hardware a prefetchable, branch-free, bandwidth-tight layout (Eytzinger, SoA, columnar) beats an asymptotically-better but latency-serialized one. State which level of the hierarchy — line, page, node — you are optimizing, and whether the misses overlap.

---

## Research Pointers

- **Acton, M. (2014). "Data-Oriented Design and C++."** *CppCon.* The canonical statement of DOD: transform-the-data premise, "where there's one, there's many," existential processing, and the memory-wall cost argument.
- **Chilimbi, T. M., Davidson, B., & Larus, J. R. (1999). "Cache-Conscious Structure Definition."** *PLDI.* Structure splitting (hot/cold separation) and field reordering by access frequency.
- **Chilimbi, T. M., Hill, M. D., & Larus, J. R. (1999). "Cache-Conscious Structure Layout."** *PLDI.* Instance clustering, `ccmalloc` (hint-based allocation) and `ccmorph` (tree reorganization).
- **Lattner, C., & Adve, V. (2005). "Automatic Pool Allocation: Improving Performance by Controlling Data Structure Layout in the Heap."** *PLDI.* Compiler-driven pool segregation of logically-related heap objects (LLVM heritage).
- **Rao, J., & Ross, K. A. (1999). "Cache Conscious Indexing for Decision-Support in Main Memory."** *VLDB.* The CSS-tree: pointer-free static search trees by arithmetic navigation.
- **Rao, J., & Ross, K. A. (2000). "Making B+-Trees Cache Conscious in Main Memory."** *SIGMOD.* The **CSB+-tree**: contiguous child groups eliminate per-child pointers to raise fanout.
- **Khuong, P.-V., & Morin, P. (2017). "Array Layouts for Comparison-Based Searching."** *ACM JEA.* The definitive empirical comparison of sorted, Eytzinger, B-tree, and vEB layouts; the case for Eytzinger-with-prefetch.
- **Morton, G. M. (1966). "A Computer Oriented Geodetic Data Base and a New Technique in File Sequencing."** *IBM Tech. Report.* The origin of the Z-order / Morton code via bit interleaving.
- **Hilbert, D. (1891). "Über die stetige Abbildung einer Linie auf ein Flächenstück."** *Math. Ann.* The Hilbert space-filling curve.
- **Ailamaki, A., DeWitt, D. J., Hill, M. D., & Skounakis, M. (2001). "Weaving Relations for Cache Performance."** *VLDB.* **PAX** — partition attributes across, the hybrid row/column page layout.
- **Boncz, P., Zukowski, M., & Nes, N. (2005). "MonetDB/X100: Hyper-Pipelining Query Execution."** *CIDR.* Vectorized, cache-resident columnar execution; the modern column-store performance argument.
- **Abadi, D., Boncz, P., Harizopoulos, S., et al. (2013). "The Design and Implementation of Modern Column-Oriented Database Systems."** *Foundations and Trends in Databases.* Compression, late materialization, and vectorization in column stores.
- **Wulf, W. A., & McKee, S. A. (1995). "Hitting the Memory Wall: Implications of the Obvious."** *ACM SIGARCH.* The memory-wall thesis that motivates the whole topic.

---

## Key Takeaways

1. **Data-oriented design is AoS→SoA promoted to an architecture (Acton).** On memory-wall hardware the dominant cost is the cache-miss stall, so organize by *access pattern and transformation*, not object identity; design for the *many* ("where there's one, there's many"); let position-in-collection encode state (existential processing). OOP's colocate-by-identity instinct is a pessimization whenever you touch one field across many objects — the common case.
2. **Cache-conscious data structures make the principle rigorous for pointer structures (Chilimbi; Lattner).** **Structure splitting** (hot/cold separation) and **field reordering** by access frequency fix intra-record layout; **instance clustering** (`ccmalloc`) and **automatic pool allocation** (Lattner, PLDI 2005) fix where instances live — all serving "co-accessed data, co-located in memory."
3. **Search-tree *layout* dominates the search *algorithm*.** The **Eytzinger (BFS)** layout makes binary search branch-free and prefetchable; the **vEB** layout gives `Θ(log_B N)` blocks obliviously; **CSB+-trees** (Rao–Ross) delete per-child pointers to roughly double fanout. The shared move: replace stored pointers with implicit arithmetic navigation over a contiguous region.
4. **Eytzinger beats sorted-array binary search because it overlaps misses (Khuong–Morin 2017).** Both have `Θ(log(N/B))` top-level misses, but sorted-array search *serializes* its dependent-miss chain while Eytzinger *pipelines* it via prefetch (`2i, 4i, …` are known ahead) and packs the hot root region at the array's front; the branch-free descent also kills mispredictions. The metric is overlappable misses, not block count.
5. **Space-filling curves give multidimensional locality.** **Morton/Z-order** interleaves coordinate bits for cheap recursive-quadrant locality (implicit tiling at every scale, a Morton-order matrix layout); **Hilbert** curves are continuous with strictly better range-query clustering at higher encoding cost. Both linearize `k`-D keys so "near in space" implies "near in memory" — used in spatial indexes ([quadtree/octree](../../09-trees/16-quadtree-octree/), [R-tree](../../09-trees/17-r-tree/) alternatives), tiled images, and matrices.
6. **Columnar storage is SoA at dataset scale; PAX is the hybrid (Ailamaki 2001).** Column layout reads only touched columns and enables SIMD vectorization, lightweight compression (RLE, dictionary, bit-packing — often operated on directly), and late materialization. **PAX** stores column-major *within* a row page, decoupling storage granularity (rows, for reconstruction) from access granularity (columns, for cache efficiency).
7. **NUMA-aware layout is cache-aware layout with the node as the outer tier.** **First-touch** placement = tiling (initialize with the parallel decomposition that will process the data); per-node replication/partitioning keeps the working set local; cross-socket false sharing is the false-sharing problem with far steeper interconnect cost.
8. **Cache-aware vs cache-oblivious is the same tuning–generality spectrum as the [I/O model](../01-the-io-model/senior.md).** Aware layouts (CSB+, tiled, columnar sized to the machine) win peak constants on a fixed dominant level; oblivious layouts (vEB, Morton/recursive) win portability and multi-level reach. Eytzinger-vs-vEB is the case in point: the prefetchable aware layout often beats the block-optimal oblivious one in wall-clock.

---

> **See also:** [`./middle.md`](./middle.md) for cache lines, AoS/SoA, tiling, false sharing, and prefetch · [`../02-cache-oblivious-algorithms/senior.md`](../02-cache-oblivious-algorithms/senior.md) for the vEB layout, recursive matrix layouts, and the cache-oblivious counterparts of every layout here · [`../04-b-tree-io-analysis/senior.md`](../04-b-tree-io-analysis/senior.md) for block-conscious node design and the read/write tradeoff that CSB+ vs LSM mirrors · [`../01-the-io-model/senior.md`](../01-the-io-model/senior.md) for the `Θ(log_B N)` search bound and the cache-aware/cache-oblivious distinction these layouts instantiate
