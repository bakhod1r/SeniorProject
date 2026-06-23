# B-Tree I/O Analysis — Senior Level

## Prerequisites

- [Middle Level](./middle.md) — the B-tree's height `Θ(log_B N)`, the search / insert / delete / range bounds, the B+-tree leaf chain, bulk loading, and the claim that B-trees are search-optimal in the I/O model
- [The I/O Model — Senior](../01-the-io-model/senior.md) — the two-level `(N, M, B)` model, the search lower bound `Θ(log_B N)`, the buffer-tree batch bound, and the Brodal–Fagerberg tradeoff stated in context
- [Cache-Oblivious Algorithms — Senior](../02-cache-oblivious-algorithms/senior.md) — the ideal-cache model, the van Emde Boas layout, the packed-memory array, and cache-oblivious B-trees
- [LSM-Tree — Senior](../../21-advanced-structures/04-lsm-tree/senior.md) — leveled vs tiered compaction, write/read/space amplification, and Bloom-filtered point reads

## Table of Contents

1. [What Senior-Level B-Tree Theory Is About](#what-senior-level-b-tree-theory-is-about)
2. [The Search Lower Bound and Why the B-Tree Is Search-Optimal](#the-search-lower-bound-and-why-the-b-tree-is-search-optimal)
3. [The Update Gap: Why `log_B N` Per Insert Is Wasteful](#the-update-gap-why-log_b-n-per-insert-is-wasteful)
4. [The Buffer Tree: Batching Updates to the Sorting Bound](#the-buffer-tree-batching-updates-to-the-sorting-bound)
5. [The B^ε-Tree and the Brodal–Fagerberg Tradeoff](#the-bε-tree-and-the-brodalfagerberg-tradeoff)
6. [LSM-Trees and the RUM Conjecture](#lsm-trees-and-the-rum-conjecture)
7. [Comparing the Three: B-Tree vs B^ε-Tree vs LSM](#comparing-the-three-b-tree-vs-bε-tree-vs-lsm)
8. [Cache-Oblivious B-Trees: Matching `log_B N` Without Knowing B](#cache-oblivious-b-trees-matching-log_b-n-without-knowing-b)
9. [Concurrency in External B-Trees](#concurrency-in-external-b-trees)
10. [Worked Piece: Deriving the B^ε-Tree Insert/Query Tradeoff](#worked-piece-deriving-the-bε-tree-insertquery-tradeoff)
11. [Decision Framework](#decision-framework)
12. [Research Pointers](#research-pointers)
13. [Key Takeaways](#key-takeaways)

---

## What Senior-Level B-Tree Theory Is About

The middle level establishes the *structure*: a Bayer–McCreight B-tree (1972) has fan-out `Θ(B)`, height `Θ(log_B N)`, and answers a search in `Θ(log_B N)` I/Os; a B+-tree threads the leaves for `Θ(log_B N + K/B)` range queries; bulk loading builds the tree bottom-up in `Θ(sort(N))`. The middle level is "the B-tree is the external search tree, and here are its costs."

Senior-level B-tree theory is about the *one place the B-tree is provably optimal and the one place it is provably wasteful*, and the entire family of structures that exploit that gap. Four threads run through it:

1. **The B-tree is search-optimal — and that is a theorem.** `Θ(log_B N)` is an information-theoretic floor for comparison-based external search: each block read can partition the universe into at most `B+1` parts, so `log_{B+1} N` probes are forced. The B-tree's fan-out `Θ(B)` is *exactly* the fan-out that matches information-per-block to information-per-probe. Nothing beats it for a single lookup.
2. **But the B-tree's *insert* cost is far from optimal.** An insert costs `Θ(log_B N)` — one root-to-leaf search per inserted element. Yet *batched* updates can be done in `O((1/B) log_{M/B}(N/B))` amortized I/Os each — the per-element sorting cost, a factor of roughly `B` cheaper. The B-tree leaves that factor of `B` on the table.
3. **There is a provably optimal curve between fast queries and fast inserts.** Brodal and Fagerberg (2003) proved that insert and query cost trade off along a frontier you cannot beat. The `B^ε`-tree parameterizes this frontier with a single knob `ε`: `ε = 1` recovers the B-tree (fast query, slow insert), `ε → 0` approaches an LSM-like write-optimal point (fast insert, slow query). Every modern storage engine is a *point on this curve*.
4. **The write-optimized end is a billion-dollar industry.** LSM-trees (O'Neil 1996), fractal trees (`B^ε`-trees productized as TokuDB), and their descendants power RocksDB, Cassandra, LevelDB, MyRocks. Understanding "which engine?" *is* understanding "where on the Brodal–Fagerberg curve does my read/write ratio belong?"

The unifying senior stance: *the B-tree is the read-optimal corner of a continuous, provably optimal tradeoff between insert-I/O and query-I/O; the rest of external dictionary design is choosing where on that curve to sit and engineering the structure that gets there.* Everything below is an instance of that map. The lower bounds it relies on are proved in [`../01-the-io-model/senior.md`](../01-the-io-model/senior.md); this file is where they meet the data structures.

---

## The Search Lower Bound and Why the B-Tree Is Search-Optimal

Start with the result that justifies the B-tree's existence and pins its fan-out.

> **Theorem (search lower bound).** Comparison-based searching for one key in a static, sorted set of `N` elements in the I/O model requires `Θ(log_B N)` I/Os, and the B-tree achieves it.

### The information-per-probe argument

Each I/O brings `B` elements into memory. In the comparison model, those `B` elements can serve as *pivots*: a block of `B` keys partitions the remaining key universe into at most `B + 1` open intervals, and the query key falls into exactly one. So a single block read multiplies the algorithm's *resolving power* by at most `B + 1` — it narrows the candidate range by a factor of `B + 1`. To resolve `N` candidates down to one, the number of probes `t` must satisfy

```text
   (B + 1)^t  ≥  N   ⟹   t  ≥  log_{B+1} N  =  Θ(log_B N).
```

This is the I/O-model analogue of the binary-search decision tree, with fan-out `B + 1` in place of `2`. The base of the logarithm is the information a single block can carry, and *that is why the B-tree branches with fan-out `Θ(B)`*: any smaller fan-out wastes the block (it reads `B` elements but only uses a few as pivots, paying for I/O it does not exploit); any larger fan-out cannot fit in one block. Fan-out `Θ(B)` is the unique choice that matches the information a probe must extract to the information a block can deliver.

### Cell-probe refinements: when you can beat `log_B N`

The `Θ(log_B N)` bound is *comparison-based*. As always, naming the model matters: in the stronger **cell-probe model** — where the algorithm may compute arbitrary functions of key bits, not just compare — the predecessor problem admits a more refined bound. Pătrașcu and Thorup's predecessor lower bounds (the van-Emde-Boas-vs-fusion-tree tradeoff) pin down exactly when exploiting the *bit representation* of keys lets you beat `log_B N` and when comparisons force it. The practical upshot: for the *membership / exact-match* query, integer structures (external hashing, fusion-tree-style nodes) can do better than `log_B N`; for *predecessor / range* queries on a comparison-only universe, `Θ(log_B N)` stands. This is the I/O-model shadow of the cell-probe predecessor theory in the lower-bounds file; the B-tree is optimal precisely in the comparison-based, order-based regime that range queries demand.

The senior takeaway: the B-tree is not "the best search structure" unconditionally — it is the **search-optimal comparison-based structure that also supports range queries**, which is exactly the workload databases need. Its optimality for *search* is what makes its sub-optimality for *insert* worth fixing rather than abandoning the tree shape.

---

## The Update Gap: Why `log_B N` Per Insert Is Wasteful

A B-tree insert does a root-to-leaf search to find the leaf, writes the element, and splits nodes up the path as needed. The cost is `Θ(log_B N)` I/Os — dominated by the search. For a single, isolated, must-be-visible-immediately insert, that is unavoidable: you genuinely must locate the leaf.

But consider inserting `N` elements. The B-tree pays `Θ(N log_B N)` I/Os. Contrast this with what *batching* achieves:

> **The batched-update floor.** Inserting `N` elements into an external dictionary, if the inserts may be applied lazily and in any interleaving, costs `Θ(sort(N)) = Θ((N/B) log_{M/B}(N/B))` I/Os total — i.e. `O((1/B) log_{M/B}(N/B))` amortized **per element**.

The gap is stark. Per element:

```text
   B-tree insert:    Θ(log_B N)                       I/Os
   batched insert:   Θ( (1/B) · log_{M/B}(N/B) )      I/Os
```

The batched cost has a `1/B` *factor* where the B-tree has a `log_B N` *term* — a difference of roughly `B / log` per element. For `B` in the hundreds or thousands, that is two to three orders of magnitude. The B-tree's insert cost is *far* from the achievable floor.

### Where the waste comes from

The B-tree wastes the block. To insert one element it reads `Θ(log_B N)` blocks, each holding `B` elements, but *modifies only one element per block*. The block transfer — the expensive thing — is amortized over a single update. Batching fixes exactly this: if you accumulate `B` updates destined for the same leaf and apply them together, the `Θ(log_B N)` path cost is shared across `B` elements, dropping the per-element cost by a factor of `B`. The write-optimized structures below are all mechanisms for *accumulating updates so that each expensive block transfer carries many of them*. The B-tree's flaw is not its shape; it is its **eager, one-element-at-a-time application** of updates. The fix is *laziness*: buffer updates high in the tree and flush them down in batches.

---

## The Buffer Tree: Batching Updates to the Sorting Bound

The first structure to realize batched updates at the sorting bound is Arge's buffer tree.

> **The buffer tree (Arge, 1995).** A tree with fan-out `Θ(M/B)` in which every internal node carries a **buffer of size `Θ(M)`** held on disk. An update (insert/delete) is not applied immediately; it is *appended to the root's buffer*. When a buffer fills, it is **flushed**: its `Θ(M)` elements are loaded into memory, sorted/distributed by which child they belong to, and pushed down into the children's buffers. Flushes cascade lazily down the tree.

### Why a flush is cheap per element

A buffer holds `Θ(M)` elements — that is `Θ(M/B)` blocks. Flushing it costs `Θ(M/B)` I/Os to read the buffer, plus `Θ(M/B)` to distribute the elements into the `Θ(M/B)` children's buffers (one output block per child, and `M/B` children fit because the node fan-out is `M/B`). So a flush moves `Θ(M)` elements at a cost of `Θ(M/B)` I/Os — i.e. `Θ(1/B)` I/Os **per element flushed**, one block transfer amortized over `B` elements. That is the entire trick: the buffer is large enough (`Θ(M)`) that emptying it is a *scan*, and a scan costs `1/B` per element.

### The amortized bound

Each element, on its way from the root to a leaf, passes through `Θ(log_{M/B}(N/B))` levels (the tree has fan-out `M/B`, so its height is `log_{M/B}(N/B)`), and at each level it participates in exactly one flush, costing `Θ(1/B)` per level:

```text
   per-element cost  =  (levels) × (cost per flush per element)
                     =  Θ( log_{M/B}(N/B) ) × Θ(1/B)
                     =  O( (1/B) · log_{M/B}(N/B) )      amortized I/Os.
```

This is `sort(N)/N` per element — so processing `N` updates costs `Θ(sort(N))`, **not** `Θ(N log_B N)`. The buffer tree turns a stream of updates into a sorting-equivalent workload, hitting the `perm ≈ sort` floor of [`../01-the-io-model/senior.md`](../01-the-io-model/senior.md) rather than the naïve per-update search cost.

### What the buffer tree is for

The buffer tree is not primarily a *queryable dictionary* — a query may have to inspect buffered, not-yet-applied updates along a root-to-leaf path, and the lazy design means a query must trigger flushes to get a consistent answer (an `O(log_{M/B}(N/B))`-ish operation, not a cheap point read). Its sweet spot is **batched / offline** workloads where queries are also batched:

- **External priority queues.** A buffer-tree-based heap supports `insert` and `delete-min` at `O((1/B) log_{M/B}(N/B))` amortized — the I/O-optimal external priority queue, used inside external graph algorithms.
- **Batched dictionaries and offline range queries.** Accumulate a batch of queries and updates, then resolve them all in one sweep at `Θ(sort)` total cost.
- **Plane sweep and time-forward processing.** Computational-geometry sweeps and the time-forward-processing technique for DAG evaluation are built on the buffer tree's batched priority queue.

The buffer tree's lesson — *buffers of size `Θ(M)`, flushed as scans, amortize the path cost to `1/B` per element* — is the seed of the `B^ε`-tree, which trades a little of the buffer's size away in exchange for fast *online* queries.

---

## The B^ε-Tree and the Brodal–Fagerberg Tradeoff

The buffer tree is write-optimal but query-clumsy. The B-tree is query-optimal but write-naïve. The `B^ε`-tree interpolates *continuously and provably optimally* between them.

> **The B^ε-tree (Brodal–Fagerberg, 2003).** A tree with **fan-out `B^ε`** for a tunable parameter `ε ∈ (0, 1]`, where each internal node devotes `B^ε` of its `B`-element capacity to **pivots/children** and the remaining `B − B^ε ≈ B` space to a **buffer** of pending updates. Inserts are appended to the root's buffer; when a node's buffer fills, the updates are flushed down to the appropriate children, exactly as in a buffer tree — but with the smaller fan-out `B^ε` instead of `M/B`.

### The two costs

The tree has height `log_{B^ε} N = (log_B N)/ε`. A query walks one root-to-leaf path, inspecting each node's buffer for pending updates to its key:

```text
   query:   O( (log_B N) / ε )   I/Os.
```

For inserts, a node's buffer holds `Θ(B)` elements (it gets nearly the whole node) and flushes to `B^ε` children. A flush moves `Θ(B)` elements at a cost of `O(B^ε)` I/Os (read the node, write to `B^ε` children), so the cost **per element per flush** is `O(B^ε / B) = O(B^{ε−1}) = O(1 / B^{1−ε})`. Each element passes through `(log_B N)/ε` levels, one flush each:

```text
   insert:  O( (1 / (ε · B^{1−ε})) · log_B N )   amortized I/Os.
```

(The full derivation is in the worked piece below.)

### Reading the curve

The single knob `ε` sweeps the entire tradeoff:

| `ε` | fan-out | insert (amortized) | query | character |
| --- | --- | --- | --- | --- |
| `ε = 1` | `B` | `O(log_B N)` | `O(log_B N)` | **B-tree**: read-optimal, write-naïve |
| `ε = 1/2` | `√B` | `O((1/√B) log_B N)` | `O(2 log_B N)` | **fractal-tree sweet spot** |
| `ε → 0` | `Θ(1)` | `O((1/B) log_B N) → sort/N` | `O(log N)` | **LSM-like**: write-optimal, read-naïve |

At `ε = 1/2` the insert drops by a `√B` factor versus a B-tree while the query merely doubles — you buy a `√B`× write speedup for a 2× read slowdown. As `ε → 0` the insert approaches the buffer-tree optimum `O((1/B) log N)` — the cheapest possible per-element write — while the query degrades to `O(log N)` (a tall, constant-fan-out tree).

> **Theorem (Brodal–Fagerberg, 2003 — optimality of the tradeoff).** For comparison-based external dictionaries, the insert and query costs obey a tradeoff curve that the `B^ε`-tree's parameterization traces, and **no structure can do asymptotically better on both at once**. Improving inserts past a given point on the frontier provably degrades queries, and vice versa.

This is the external-memory analogue of a time–space tradeoff — here an *insert-I/O vs query-I/O* tradeoff — and Brodal and Fagerberg proved *both* directions: the upper bound (the `B^ε`-tree construction) and the matching lower bound (no comparison-based dictionary beats the frontier). It is the theoretical spine of every write-optimized store. The fractal tree (TokuDB, later Percona) is a `B^ε`-tree at `ε ≈ 1/2` with engineering refinements (message buffers, fingerprinting); it uniquely supports efficient *range* queries among write-optimized structures, because the data stays in global tree order at all times.

---

## LSM-Trees and the RUM Conjecture

The log-structured merge-tree is the write-optimized structure that actually dominates production. It reaches a different point on (the spirit of) the same tradeoff by a different mechanism.

> **The LSM-tree (O'Neil, Cheng, Gawlick, O'Neil, 1996).** Buffer writes in an in-memory sorted structure (the *memtable*, size `≈ M`). When it fills, flush it to disk as an immutable sorted run (an *SSTable*). Periodically **compact** runs by merging them, organizing disk into levels of geometrically increasing size. A point query checks the memtable, then probes runs from newest to oldest until it finds the key.

### Leveled vs tiered compaction

The compaction policy is where LSM variants diverge, and it *is* the LSM's position on the read/write/space tradeoff:

- **Leveled compaction** (LevelDB, RocksDB default): each level `L_i` holds non-overlapping runs of total size `≈ T^i · M` for a growth factor `T`. Merging into a level rewrites overlapping data, so a key may be rewritten `O(T)` times per level → **write amplification `O(T · log_T(N/M))`**, but a point query probes `O(1)` run per level → **read amplification `O(log_T(N/M))`**. Low read amp, higher write amp. Space amplification is low (≈ `1 + 1/T`).
- **Tiered compaction** (Cassandra, ScyllaDB default): each level accumulates up to `T` runs before merging them all at once into the next level. A key is rewritten `O(1)` times per level → **write amplification `O(log_T(N/M))`**, but a point query may probe `O(T)` runs per level → **read amplification `O(T · log_T(N/M))`**. Low write amp, higher read amp, higher space amp (up to `T` overlapping copies).

The growth factor `T` and the leveled/tiered choice trace a tradeoff within the LSM family, formalized by the **Dostoevsky / Monkey** line of work (Dayan et al.) as a continuum ("lazy leveling" and "fluid LSM") rather than two discrete options. Per-insert cost is

```text
   insert (amortized)  ≈  O( (1/B) · log_T(N/M) )   I/Os,
```

essentially the `ε → 0` write-optimal end: each element is moved `O(1/B)`-per-block-transfer through `O(log_T(N/M))` merges. Point reads are kept fast in practice by **Bloom filters** per SSTable (skip runs that provably lack the key) and **fence pointers** (block-level min/max indexes), which together turn the `O(#runs)` read amplification into roughly one I/O on a key miss.

### The RUM conjecture

The LSM's amplifications are not independent — they are bound by a conservation law.

> **The RUM conjecture (Athanassoulis et al., 2016).** For an access method, the three overheads — **R**ead amplification, **U**pdate amplification, and **M**emory (space) amplification — cannot all be minimized simultaneously. Optimizing any two forces a cost in the third; you may pick at most two to make small.

RUM is the practitioner's framing of the same fundamental tension Brodal–Fagerberg formalize: a B-tree minimizes Read and Memory (in-place, no extra copies, optimal lookups) but pays in Update; a write-optimized LSM minimizes Update and (with leveling) Memory but pays in Read; a tiered LSM minimizes Update but pays in both Read and Memory. There is no structure that is simultaneously read-optimal, update-optimal, and space-optimal — the corners of the RUM triangle are the unreachable ideal, and every real engine sits on an edge. The full LSM treatment — compaction scheduling, Bloom-filter memory allocation (Monkey), tombstones, and the read/write/space numbers — is in [`../../21-advanced-structures/04-lsm-tree/senior.md`](../../21-advanced-structures/04-lsm-tree/senior.md).

---

## Comparing the Three: B-Tree vs B^ε-Tree vs LSM

All three are points on (or near) the Brodal–Fagerberg frontier. Stating their costs side by side is the senior's map for engine selection.

| | B-tree (`ε=1`) | B^ε-tree (`ε=1/2`) | LSM (leveled) |
| --- | --- | --- | --- |
| **Point query** | `O(log_B N)` | `O(2 log_B N)` | `O(log_T(N/M))` runs, ≈1 I/O with Bloom |
| **Insert (amortized)** | `O(log_B N)` | `O((1/√B) log_B N)` | `O((1/B) log_T(N/M))` |
| **Range query** | `O(log_B N + K/B)` optimal | `O(log_B N + K/B)` near-optimal | `O((#runs)·log + K/B)` — must merge runs |
| **Space amplification** | low (≈ fill factor) | low | leveled low / tiered high |
| **Write pattern** | in-place, random | buffered, batched | sequential (append + merge) |
| **RUM corner** | Read + Memory | balanced | Update (+ Memory if leveled) |

The structural distinctions a senior should be able to state without the table:

- **B-tree** keeps data fully ordered and applies updates eagerly in place → optimal reads (point *and* range), naïve writes, minimal space. The default *only* for read-heavy workloads.
- **B^ε-tree / fractal tree** keeps data ordered but buffers updates → a tunable read penalty for a large write gain, and — crucially — **retains efficient range queries** because the tree stays in global order. This is its decisive edge over LSM: range scans don't require merging many runs.
- **LSM** keeps data in *several* sorted runs and merges lazily → write-optimal and sequential-write-friendly (ideal for SSDs and the write path), but range queries must merge across runs and point reads lean on Bloom filters. Dominant in practice because sequential writes, compression, and the append-only log align with modern storage hardware.

The senior framing: "B-tree, B^ε-tree, or LSM?" is the same question as "where on the Brodal–Fagerberg curve does my read/write ratio sit, and do I need range scans?" Read-heavy → B-tree (`ε=1`). Write-heavy with point reads → LSM (`ε→0`). Write-heavy *with range reads* → B^ε-tree (`ε=1/2`), the one write-optimized structure that does not sacrifice range performance.

---

## Cache-Oblivious B-Trees: Matching `log_B N` Without Knowing B

The B-tree achieves `Θ(log_B N)` only because it is *told* `B` and sets its node size to one page. Can a parameter-blind structure match it for *all* `B` at once?

> **The cache-oblivious B-tree (Bender–Demaine–Farach-Colton, 2000).** Lay a balanced binary search tree out in memory by the **van Emde Boas (vEB) layout**: recursively split the tree at half its height into a top subtree and `√N` bottom subtrees, store the top recursively, then each bottom subtree recursively, contiguously. A search achieves `O(log_B N)` I/Os obliviously, because *whatever* `B` is, some level of the vEB recursion has subtrees of `Θ(B)` size that are block-aligned.

Static search obliviously is the easy half (see [`../02-cache-oblivious-algorithms/senior.md`](../02-cache-oblivious-algorithms/senior.md)). The hard half is *dynamism* — supporting inserts and deletes while keeping the vEB layout. The solution combines two pieces:

1. **The packed-memory array (PMA).** Store the `N` elements in sorted order in an array with `Θ(1)` density gaps interspersed. An insert shifts elements within a contiguous region to make room and periodically rebalances density. The PMA supports inserts in `O((log² N)/B)` amortized I/Os and, critically, scans in `O(K/B)` — it keeps the data **physically in sorted order with controlled gaps**, so range queries are scans.
2. **The vEB-laid-out index over the PMA.** A static-structured tree (rebuilt in the vEB layout) indexes the PMA slots; updates to the PMA propagate to the index.

Together these give a **dynamic cache-oblivious B-tree** with searches in `O(log_B N)`, inserts/deletes in `O(log_B N + (log² N)/B)` amortized, and range queries in `O(log_B N + K/B)` — matching the B-tree's bounds **without ever naming `B`**, hence optimal at *every* level of the memory hierarchy simultaneously. The PMA is also the cache-oblivious counterpart to the buffer/`B^ε` machinery: it is how you keep data scan-friendly under updates when you cannot pick a node size. Cache-oblivious `B^ε`-trees (Bender–Farach-Colton–Kuszmaul) extend this to the write-optimized regime, tracing the Brodal–Fagerberg curve obliviously.

---

## Concurrency in External B-Trees

Theory aside, a production B-tree is hammered by concurrent readers and writers. The classical I/O analysis is single-threaded; making it concurrent without serializing the root is its own discipline.

### Latch coupling (crabbing)

The baseline protocol is **latch coupling** (a.k.a. **crabbing**): to descend, acquire a latch on the child *before* releasing the latch on the parent — "crab" hand-over-hand down the tree. Readers take shared latches; writers take exclusive latches. A writer can release ancestors early once it knows a node is **safe** (will not split/merge on this operation — i.e. not full for an insert, more than half-full for a delete), bounding how far up the lock chain must extend. The flaw: the **root latch is a contention bottleneck** — every operation latches the root first, so write-heavy workloads serialize there.

### The B-link tree (Lehman–Yao)

> **The B-link tree (Lehman–Yao, 1981).** Add to every node a **right-link pointer** to its right sibling at the same level, plus a **high key** (the largest key in the subtree). This lets a node be split with only the splitting node and its new sibling latched — the parent's pointer is updated *lazily*, later. A search that arrives at a node whose high key is exceeded by the target simply **follows the right-link** to the sibling, tolerating the temporary inconsistency between a split and the parent's update.

The B-link tree's payoff is profound: **searches take no latches at all on the read path** (they self-correct via right-links), and a writer holds at most a constant number of latches at a time, never latching the root for reads. This decouples concurrency from tree height and removes the root bottleneck for readers — which is why the B-link design (and its descendants) underlies the index concurrency in PostgreSQL, and most high-concurrency B-trees.

### The Bw-tree (lock-free)

> **The Bw-tree (Levandoski, Lomet, Sengupta — Microsoft, 2013).** A **lock-free** B-tree built on a **mapping table** that indirects logical page IDs to physical addresses, updated by atomic compare-and-swap (CAS). Modifications are not applied in place; instead a **delta record** describing the change is prepended to the page and installed by a single CAS on the mapping table. Pages are periodically consolidated. The design is **latch-free** (no thread ever blocks on a lock) and append-friendly, pairing naturally with log-structured storage (it was built for Microsoft's Hekaton and the Deuteronomy stack).

The Bw-tree's delta-chaining echoes the write-optimized philosophy — *don't modify in place, append a description of the change* — at the concurrency layer rather than the I/O layer, and its mapping-table indirection is what makes lock-freedom and flexible page placement possible. It is the modern high-end of external B-tree concurrency; the senior point is the progression *latch coupling → B-link (latch-light reads) → Bw-tree (latch-free)*, each removing a serialization point the previous one left.

---

## Worked Piece: Deriving the B^ε-Tree Insert/Query Tradeoff

To see the tradeoff curve come out of the structure, derive both costs from the `B^ε`-tree's parameters and confirm the endpoints.

### Setup

Fix `ε ∈ (0, 1]`. Each internal node occupies `Θ(B)` space (one block, or `O(1)` blocks). Of that, `B^ε` is spent on **pivots** (hence `B^ε` children), and the remaining `B − B^ε = Θ(B)` (since `ε < 1` makes `B^ε ≪ B`; at `ε = 1` the buffer vanishes and we recover a plain B-tree) is a **buffer** of pending update messages.

### Height

With fan-out `B^ε`, the tree storing `N` elements has height

```text
   h  =  log_{B^ε} N  =  (log N) / (ε log B)  =  (1/ε) · log_B N.
```

### Query cost

A point query descends one root-to-leaf path. At each node it must read the node and check its buffer for any pending message about the query key (the answer might be a buffered insert/delete not yet flushed to the leaf). That is `O(1)` I/Os per level (the node is `O(1)` blocks), over `h` levels:

```text
   Q(N)  =  O(h)  =  O( (1/ε) · log_B N ).
```

### Insert cost

An insert appends a message to the **root buffer** — `O(1)` amortized to write, but the real cost is the eventual **flush** that carries the message down. Charge each message its share of the flushes it participates in.

A node's buffer holds `Θ(B)` messages. When it fills, a flush:
- reads the node's buffer: `O(B/B) = O(1)` blocks (the buffer is `Θ(B)` elements = `Θ(1)` blocks),
- distributes the `Θ(B)` messages into the `B^ε` children's buffers: writing one block per touched child, `O(B^ε)` I/Os in the worst case.

So a flush costs `O(B^ε)` I/Os and moves `Θ(B)` messages. The cost **per message per flush** is

```text
   O( B^ε / B )  =  O( B^{ε−1} )  =  O( 1 / B^{1−ε} ).
```

Each message is flushed once per level on its way to a leaf — `h = (1/ε) log_B N` levels. Therefore the amortized per-insert cost is

```text
   I(N)  =  h · O(1 / B^{1−ε})
         =  (1/ε) · log_B N · O(1 / B^{1−ε})
         =  O( (log_B N) / (ε · B^{1−ε}) ).
```

### Confronting the endpoints

The two formulas are the tradeoff curve. Check the corners:

```text
   ε = 1:     I = O( (log_B N) / (1 · B^0) )   = O(log_B N)            ← B-tree insert
              Q = O( (1/1) · log_B N )         = O(log_B N)            ← B-tree query

   ε = 1/2:   I = O( (log_B N) / (½ · B^{1/2}))= O( (1/√B) log_B N )   ← √B faster insert
              Q = O( 2 · log_B N )             = O(2 log_B N)         ← 2× slower query

   ε → 0:     I → O( (1/B) · log_B N )         → buffer-tree optimum   ← write-optimal
              Q → O( (1/ε) log_B N ) = O(log N)                       ← read-naïve
```

Two senior observations close the loop:

1. **The product of the two costs is roughly invariant near the frontier.** Multiplying the leading factors, `I · Q ≈ (log_B N)² · B^{ε−1}/ε²` — and the *interesting* term is that pushing `ε` down to cut `Q`'s denominator inflates `I` through `B^{1−ε}`, and vice versa. You cannot shrink both; you slide along the curve. This is precisely the Brodal–Fagerberg lower bound made visible: the construction *traces* a frontier that the lower bound proves you cannot cross.
2. **`ε` is one knob exposing a whole design space.** The same tree code, with `ε` as a compile/config parameter, *is* a B-tree, a fractal tree, or an LSM-flavored structure depending on the value. That a single parameter sweeps from read-optimal to write-optimal — and that the sweep is provably optimal at every setting — is why the `B^ε`-tree is the *unifying* object of external dictionary theory, and why the I/O-model file places this curve at the center of the write-optimization story.

---

## Decision Framework

| Situation | Reach for | Why |
| --- | --- | --- |
| Read-heavy, point + range queries, modest writes | **B-tree / B+-tree** (`ε = 1`) | Search-optimal `log_B N`, optimal ranges, minimal space; eager updates are fine when rare |
| Prove "no dictionary beats X on insert *and* query" | **Brodal–Fagerberg tradeoff** | The frontier is a theorem; you cannot improve both — pick a point |
| Write-heavy, point reads dominate | **LSM-tree** (`ε → 0` end) | Cheapest inserts `O((1/B) log)`, sequential writes; Bloom filters tame point reads |
| Write-heavy *with range scans* | **B^ε-tree / fractal tree** (`ε = 1/2`) | `√B`× faster inserts than a B-tree while keeping data in tree order for ranges |
| Batched / offline updates, external priority queue | **Buffer tree** (Arge) | `Θ(sort(N))` total for `N` updates; the I/O-optimal external PQ and sweep engine |
| Portable / multi-level-optimal index | **Cache-oblivious B-tree** (vEB + PMA) | Matches `log_B N` for *all* `B`; optimal at every hierarchy level without tuning |
| Tune the LSM read/write/space mix | **Leveled vs tiered (Dostoevsky/Monkey)** | Growth factor `T` + compaction policy slide along the RUM triangle |
| High-concurrency index, read-heavy | **B-link tree** (Lehman–Yao) | Latch-free search path via right-links; no root latch bottleneck for readers |
| Lock-free / log-structured storage | **Bw-tree** (Microsoft) | Delta records + CAS mapping table; never blocks, pairs with append-only storage |

Two rules of thumb:

1. **Choose your point on the Brodal–Fagerberg curve from the read/write ratio and the range-query need — not from habit.** The B-tree is the right default *only* when reads dominate; write-heavy workloads belong at the write-optimized end of a *provably optimal* tradeoff, and the range-query requirement decides between LSM (`ε→0`, point reads) and `B^ε`/fractal (`ε=1/2`, range reads).
2. **Batch what you can.** An eager `Θ(log_B N)`-per-insert is wasteful whenever updates can be deferred. If your workload tolerates lazy application — bulk loads, offline analytics, streaming ingest — a buffer-tree / `B^ε` / LSM structure pays `1/B` per element instead of `log_B N`, a factor-of-`B` win.

---

## Research Pointers

- **Bayer, R., & McCreight, E. (1972). "Organization and Maintenance of Large Ordered Indices."** *Acta Informatica* 1(3). The original B-tree: fan-out `Θ(B)`, height `log_B N`, the structure all of this analyzes.
- **Comer, D. (1979). "The Ubiquitous B-Tree."** *ACM Computing Surveys* 11(2). The B-tree/B+-tree survey that named the family and established it as the database index.
- **Arge, L. (1995/2003). "The Buffer Tree: A Technique for Designing Batched External Data Structures."** *WADS / Algorithmica.* Buffers of size `Θ(M)`, the `O((1/B) log_{M/B}(N/B))`-per-element batched bound, external priority queues, and time-forward processing.
- **Brodal, G. S., & Fagerberg, R. (2003). "Lower Bounds for External Memory Dictionaries."** *SODA.* The `B^ε`-tree and the matching **insert/query tradeoff lower bound** — the optimal frontier this whole file is organized around.
- **O'Neil, P., Cheng, E., Gawlick, D., & O'Neil, E. (1996). "The Log-Structured Merge-Tree (LSM-Tree)."** *Acta Informatica* 33(4). The origin of LSM; leveled merge, the write-optimized end of the curve.
- **Athanassoulis, M., Kester, M., Maas, L., Stoica, R., Idreos, S., Ailamaki, A., & Callaghan, M. (2016). "Designing Access Methods: The RUM Conjecture."** *EDBT.* Read–Update–Memory: you can optimize at most two.
- **Dayan, N., Athanassoulis, M., & Idreos, S. (2017/2018). "Monkey" and "Dostoevsky."** *SIGMOD.* The continuum between leveled and tiered LSM and optimal Bloom-filter memory allocation — the RUM tradeoff made tunable.
- **Bender, M. A., Demaine, E. D., & Farach-Colton, M. (2000/2005). "Cache-Oblivious B-Trees."** *FOCS / SICOMP.* The vEB layout + packed-memory array dynamic structure matching `log_B N` without knowing `B`.
- **Lehman, P. L., & Yao, S. B. (1981). "Efficient Locking for Concurrent Operations on B-Trees."** *ACM TODS* 6(4). The B-link tree: right-links and high keys for latch-light concurrent search.
- **Levandoski, J., Lomet, D., & Sengupta, S. (2013). "The Bw-Tree: A B-tree for New Hardware Platforms."** *ICDE.* The lock-free, delta-record, mapping-table B-tree.

---

## Key Takeaways

1. **The B-tree is search-optimal — `Θ(log_B N)` is a theorem (each block partitions the universe into `B+1` parts) — and its fan-out `Θ(B)` is exactly what matches information-per-block to information-per-probe.** It is the optimal *comparison-based, range-supporting* structure, which is why databases use it; cell-probe refinements (Pătrașcu–Thorup) beat `log_B N` only for membership on integer keys, never for predecessor/range.
2. **The B-tree's insert is far from optimal.** It pays `Θ(log_B N)` per insert by applying updates eagerly, one element per block transfer, when *batched* updates achieve `O((1/B) log_{M/B}(N/B))` per element — a factor of roughly `B` cheaper. The fix is laziness: buffer updates and flush them in batches.
3. **The buffer tree (Arge 1995) realizes the batched floor.** Buffers of size `Θ(M)` at fan-out-`M/B` nodes flush as scans (`1/B` per element per level), giving `Θ(sort(N))` for `N` updates — the engine behind external priority queues, plane sweep, and time-forward processing.
4. **The B^ε-tree (Brodal–Fagerberg 2003) interpolates the whole tradeoff with one knob `ε`.** Fan-out `B^ε`, buffer `B − B^ε`: insert `O((log_B N)/(ε·B^{1−ε}))`, query `O((log_B N)/ε)`. `ε=1` is the B-tree, `ε=1/2` the fractal-tree sweet spot (`√B`× faster inserts, 2× slower reads), `ε→0` the LSM-like write-optimal end. **No comparison-based dictionary beats this frontier** — they proved both the construction and the matching lower bound.
5. **LSM-trees (O'Neil 1996) sit at the write-optimal end via compaction, governed by the RUM conjecture.** Leveled (low read amp, high write amp) vs tiered (low write amp, high read/space amp) trade within the family; per-insert `O((1/B) log_T(N/M))`, point reads rescued by Bloom filters. **RUM (Athanassoulis 2016): Read, Update, Memory — optimize at most two.**
6. **Engine choice *is* a point on the Brodal–Fagerberg curve.** Read-heavy → B-tree; write-heavy + point reads → LSM; write-heavy + range reads → B^ε/fractal (the only write-optimized structure keeping data in tree order). The cache-oblivious B-tree (vEB + PMA, Bender–Demaine–Farach-Colton) matches `log_B N` for all `B` at once.
7. **External B-tree concurrency progresses from serialization to latch-freedom:** latch coupling (crabbing) has a root bottleneck → the **B-link tree** (Lehman–Yao) makes searches latch-free via right-links and high keys → the **Bw-tree** (Microsoft) is fully lock-free via delta records and a CAS mapping table.

---

> **See also:** [`./middle.md`](./middle.md) for the B-tree structure, the height/search/insert bounds, B+-trees, and bulk loading · [`../01-the-io-model/senior.md`](../01-the-io-model/senior.md) for the search lower bound, the buffer-tree batch bound, and the Brodal–Fagerberg curve in model context · [`../02-cache-oblivious-algorithms/senior.md`](../02-cache-oblivious-algorithms/senior.md) for the vEB layout, the packed-memory array, and cache-oblivious B-trees · [`../../21-advanced-structures/04-lsm-tree/senior.md`](../../21-advanced-structures/04-lsm-tree/senior.md) for compaction policies, amplification, and Bloom-filter tuning
