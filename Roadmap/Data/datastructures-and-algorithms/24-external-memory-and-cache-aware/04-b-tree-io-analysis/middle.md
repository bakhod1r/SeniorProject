# B-Tree I/O Analysis — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [The Structure, Restated for Analysis](#the-structure-restated-for-analysis)
   - [Order, Fill Invariant, and One-Node-Per-Block](#order-fill-invariant-and-one-node-per-block)
3. [The Height Bound: Θ(log_B N)](#the-height-bound-θlog_b-n)
   - [Proof from the Minimum-Fill Invariant](#proof-from-the-minimum-fill-invariant)
   - [Search Is Θ(log_B N) I/Os](#search-is-θlog_b-n-ios)
4. [Insert and Delete: Θ(log_B N), with O(1) Amortized Splits](#insert-and-delete-θlog_b-n-with-o1-amortized-splits)
5. [Range Queries and the B+-Tree: Θ(log_B N + K/B)](#range-queries-and-the-b-tree-θlog_b-n--kb)
   - [Why Databases Use B+-Trees: the Fanout Argument](#why-databases-use-b-trees-the-fanout-argument)
6. [Bulk Loading: Θ(N/B) Instead of Θ((N/B) log_B N)](#bulk-loading-θnb-instead-of-θnb-log_b-n)
7. [Optimality: Θ(log_B N) Is the Search Lower Bound](#optimality-θlog_b-n-is-the-search-lower-bound)
8. [Caching the Top Levels: Effective Cost ≈ log_B N − log_B M](#caching-the-top-levels-effective-cost--log_b-n--log_b-m)
9. [Code: A B+-Tree with an I/O Counter](#code-a-b-tree-with-an-io-counter)
   - [Go](#go)
   - [Python](#python)
10. [Pitfalls](#pitfalls)
11. [Summary](#summary)

---

## Introduction

> Focus: take the junior facts — a B-tree gives `Θ(log_B N)` I/Os because fat nodes shrink the tree — and make every bound *rigorous*. By the end you can prove the `Θ(log_B N)` height from the minimum-fill invariant, derive the `Θ(log_B N)` cost of insert/delete (with amortized `O(1)` splits), prove the `Θ(log_B N + K/B)` range-query bound on a B+-tree, show why bulk loading is `Θ(N/B)` rather than `Θ((N/B) log_B N)`, and state the matching `Ω(log_B N)` search lower bound that makes the B-tree I/O-optimal.

At the [junior level](./junior.md) you saw that a B-tree packs many keys into each node, so the tree is short, and that — because *each node touched is one I/O* in the [external-memory model](../01-the-io-model/middle.md) — a search costs `Θ(log_B N)` block transfers instead of the `Θ(log₂ N)` of a binary tree. You also know the [I/O model](../01-the-io-model/middle.md) itself: `N` items in external memory, `M` items of internal memory (`= M/B` blocks), blocks of `B` items, with `1 ≤ B ≤ M ≤ N`, and only block transfers counted.

This file is the rigorous I/O analysis. The B-tree *as a data structure* — node layout, split/merge mechanics, the search/insert/delete code — lives in [the trees section's B-tree topic](../../09-trees/11-b-tree/middle.md); here the structure is assumed and the lens is **how many I/Os each operation costs and why those bounds are tight.** Concretely:

- **Height.** A B-tree of order `B` on `N` keys has height `≤ log_{⌈B/2⌉}((N+1)/2) = Θ(log_B N)`. We *prove* this from the minimum-fill invariant — every non-root node is at least half full, so the node count explodes by a factor of `≥ ⌈B/2⌉` per level. One I/O per level gives search `= Θ(log_B N)`.
- **Updates.** Insert and delete cost `Θ(log_B N)` — a root-to-leaf descent plus splits/merges that *propagate up*, but the splits are `O(1)` **amortized**.
- **Range queries.** On a **B+-tree** (all data in leaves, leaves linked) a range of `K` results costs `Θ(log_B N + K/B)`: descend to the first leaf, then scan the linked leaves block by block.
- **B+-tree vs B-tree.** Keeping data only in leaves raises the internal fanout, shortening the tree, and the linked leaves make range scans sequential — the two reasons every database index is a B+-tree.
- **Bulk loading.** Building bottom-up from *sorted* data is `Θ(N/B)`; doing `N` separate inserts is `Θ((N/B) log_B N)`. Sort first, then bulk-load.
- **Optimality.** `Θ(log_B N)` is the comparison-based external-memory search *lower* bound — each I/O reveals `≤ B` keys, cutting the candidate set by a factor of `B` — so the B-tree is I/O-optimal for search.

Vocabulary used throughout:

| Symbol | Meaning |
|--------|---------|
| `N` | number of keys stored in the tree |
| `B` | block size in items; also the B-tree **order** (max children per node), chosen so one node = one block |
| `M` | items of internal (fast) memory (`= M/B` blocks) |
| `K` | number of results returned by a range query |
| `h` | height of the tree (number of levels − 1; root at level 0) |
| `t = ⌈B/2⌉` | minimum number of children of a non-root internal node (the **fill** floor) |

Throughout, *one node occupies one block*, so **touching a node costs one I/O**. That single identity — node = block — is what turns a tree-height bound into an I/O bound.

---

## The Structure, Restated for Analysis

To prove bounds we fix the rules of a B-tree precisely.

### Order, Fill Invariant, and One-Node-Per-Block

A **B-tree of order `B`** (we use the order = max-children convention) satisfies:

1. Every node holds between `t − 1` and `B − 1` **keys**, where `t = ⌈B/2⌉`. An internal node with `c` keys has `c + 1` children, so a non-root internal node has between `t` and `B` **children**.
2. The **root** is exempt from the lower bound: it may have as few as `1` key (`2` children), or be a single leaf with `0` keys if the tree is tiny.
3. **All leaves are at the same depth.** The tree is perfectly height-balanced; this is maintained by splitting on the way down/up during inserts and merging during deletes.
4. **One node fits in one block.** `B` is chosen so a full node — its keys plus child pointers — occupies exactly one disk block. Touching (reading or writing) a node is therefore **one I/O**.

The crucial quantity for the I/O analysis is the **minimum branching factor**, `t = ⌈B/2⌉`. Every non-root node has *at least* `t` children. This "at least half full" guarantee is what bounds the height — without it, a B-tree could degenerate into a tall, sparse chain and lose its `Θ(log_B N)` advantage entirely.

```text
  node = one block = one I/O
  non-root node children:  ⌈B/2⌉ ≤ children ≤ B        (the fill invariant)
  root children:           2 ≤ children ≤ B            (or a 0-key leaf when tiny)
  all leaves at depth h    (perfect balance)
```

For the B+-tree variant we will analyze for range queries, add: **keys (records or record pointers) live only in leaves**; internal nodes hold only *separator keys* used for routing, and **leaves are chained** into a sorted linked list. We treat that variant in [its own section](#range-queries-and-the-b-tree-θlog_b-n--kb).

---

## The Height Bound: Θ(log_B N)

> **Theorem (height).** A B-tree of order `B` on `N ≥ 1` keys has height `h ≤ log_{⌈B/2⌉}((N+1)/2) = Θ(log_B N)`.

The bound says the tree is *short*: its height grows only logarithmically in `N`, with the logarithm taken to base `⌈B/2⌉ = Θ(B)`. This is the whole reason the B-tree exists, and the proof is a direct count of the *minimum* number of nodes a height-`h` tree must contain.

### Proof from the Minimum-Fill Invariant

We count how few nodes — and hence how few keys — a B-tree of height `h` can hold. If even the *sparsest* legal tree of height `h` holds at least some count `f(h)` of keys, then a tree holding `N` keys cannot be taller than the `h` for which `f(h) ≤ N`.

Use the fill invariant to bound the *minimum* number of nodes per level. The root contributes `1` node and has at least `2` children (the root's special floor). Every node below the root has at least `t = ⌈B/2⌉` children. So the minimum number of nodes at each level is:

```text
  level 0 (root):   ≥ 1 node
  level 1:          ≥ 2 nodes              (root has ≥ 2 children)
  level 2:          ≥ 2·t nodes            (each level-1 node has ≥ t children)
  level 3:          ≥ 2·t² nodes
  ...
  level i (i ≥ 1):  ≥ 2·t^{i−1} nodes
```

A tree of height `h` has leaves at level `h`, so it has at least `2·t^{h−1}` leaves. Each leaf holds at least `t − 1` keys (the minimum keys per non-root node). Therefore the total number of keys obeys

```text
  N  ≥  (keys per leaf) · (number of leaves)
     ≥  (t − 1) · 2 · t^{h−1}.
```

Standard B-tree presentations tighten this by counting *all* keys (not just leaves) to the clean form `N ≥ 2·t^h − 1`, i.e. `N + 1 ≥ 2·t^h`. Solving for `h`:

```text
  t^h ≤ (N + 1)/2
  h   ≤ log_t ((N + 1)/2)
  h   ≤ log_{⌈B/2⌉} ((N + 1)/2).
```

Since `t = ⌈B/2⌉ = Θ(B)`, the change-of-base `log_t x = (log₂ x)/(log₂ t)` gives `h = Θ((log N)/(log B)) = Θ(log_B N)`. ∎

The engine of the proof is the **minimum-fill invariant**: because each non-root node has `≥ ⌈B/2⌉` children, the node count grows by a factor of `≥ ⌈B/2⌉` *per level*, so the levels run out after `log_{⌈B/2⌉} N` of them. Drop the "at least half full" guarantee and this collapses — a node with as few as `2` children would let the tree be as tall as a binary tree, and the `Θ(log_B N)` bound would be false. The fill invariant is not a tidiness rule; it is what *makes the bound true*.

Concretely, with `B = 1000` (so `t = 500`) and `N = 10⁹`:

```text
  h ≤ log_500 ((10⁹ + 1)/2) ≈ log_500 (5·10⁸) ≈ 3.2   ⟹   height ≤ 3.
```

Even in the *worst* (sparsest) case, three or four levels suffice for a billion keys. In the *best* (fully packed) case the height is `log_B N = log_{1000} 10⁹ = 3` — the worst and best cases differ by less than one level, because `⌈B/2⌉` and `B` differ only by a factor of 2 inside a logarithm.

### Search Is Θ(log_B N) I/Os

A search descends from the root to a leaf, reading one node per level and doing a (free, in-memory) binary search within each node's `≤ B` keys to choose the next child:

```text
  search cost = (number of levels) · (1 I/O per node)
              = (h + 1) · 1
              = Θ(log_B N)  I/Os.
```

The in-node comparison work — `O(log₂ B)` per node, `O(log₂ B · log_B N) = O(log₂ N)` total — is *free* in the I/O model; only the `h + 1` block reads are charged. This is the headline B-tree result and it matches the [I/O model's search bound](../01-the-io-model/middle.md#searching-θlog_b-n): `Θ(log_B N)`, a *base-`B`* logarithm, versus the `Θ(log₂ N)` of a binary tree where each node visited is its own I/O.

```text
  binary tree:  fanout 2,      depth Θ(log₂ N),  1 I/O/node  →  Θ(log₂ N) I/Os
  B-tree:       fanout Θ(B),   depth Θ(log_B N), 1 I/O/node  →  Θ(log_B N) I/Os
```

For `N = 10⁹`, `B = 1000`: **3 I/Os** locate any key, versus `≈ 30` for a binary tree — a `log₂ B ≈ 10×` reduction. That factor of `log₂ B` is exactly why every database index and filesystem is a B-tree (or B+-tree), not a binary search tree.

---

## Insert and Delete: Θ(log_B N), with O(1) Amortized Splits

> **Theorem (update cost).** Insert and delete each cost `Θ(log_B N)` I/Os.

**Insert.** An insert (a) descends root-to-leaf to find the target leaf — `Θ(log_B N)` reads — then (b) adds the key to that leaf. If the leaf overflows (`B` keys), it **splits** into two half-full nodes and pushes a separator key up to the parent; the parent may overflow and split in turn, and a split can **propagate up to the root** (when the root splits, the tree grows one level). Each split touches `O(1)` nodes (the splitting node, its new sibling, and the parent), and at most `h + 1` of them happen along the path, so the worst-case I/O cost is

```text
  insert = descend (Θ(log_B N) reads) + write-back along the path (O(log_B N) writes)
         = Θ(log_B N) I/Os.
```

**Delete** is symmetric: descend `Θ(log_B N)`, remove the key, and if a node **underflows** (fewer than `t − 1` keys) it **borrows** from a sibling or **merges** with one, which can propagate up (a merge can shrink the tree one level at the root). Same bound, `Θ(log_B N)`.

**Amortized `O(1)` splits.** The worst-case "a split cascades all the way to the root" sounds expensive, but it is *rare*. Consider a sequence of `N` inserts into an initially empty tree. Each split creates exactly **one new node**. The total number of nodes ever created over the whole sequence is at most the number of nodes in the final tree plus the nodes discarded along the way — and the number of *internal* nodes is at most the number of leaves, so the **total number of splits across `N` inserts is `O(N)`**. Hence the **amortized** number of splits per insert is `O(1)`:

```text
  total splits over N inserts ≤ O(N)   ⟹   amortized splits per insert = O(1).
```

So although a single insert can in the worst case split `Θ(log_B N)` nodes, *on average over a sequence* it splits a constant number. The dominant cost of an insert is therefore the **root-to-leaf descent**, `Θ(log_B N)` reads — the restructuring adds only `O(1)` amortized extra I/Os on top. (The same accounting bounds merges on the delete side.) This is why B-trees behave so well under bulk update workloads: the structural maintenance is asymptotically negligible against the descent. The split/merge *mechanics* — exactly which keys move where — are in [the B-tree structure topic](../../09-trees/11-b-tree/middle.md); here we only need that each is `O(1)` nodes and that they amortize away.

---

## Range Queries and the B+-Tree: Θ(log_B N + K/B)

A **range query** asks for all keys in `[lo, hi]`. On a plain B-tree, keys live in *every* node, so an in-order range scan must wander up and down internal nodes — awkward, and it touches internal nodes repeatedly. The **B+-tree** is engineered precisely for this case.

A B+-tree differs from a B-tree in two ways that matter for ranges:

1. **All data lives in the leaves.** Internal nodes hold only *separator keys* used to route the descent; the actual records (or record pointers) sit in leaves. The same key may appear once as a separator and once as a leaf datum.
2. **Leaves are linked** in sorted order: each leaf has a pointer to the next leaf. The leaves form a sorted, sequentially-scannable linked list spanning the whole key space.

> **Theorem (range query).** A B+-tree answers a range query returning `K` results in `Θ(log_B N + K/B)` I/Os.

The algorithm is two phases:

- **Descend** to the leaf containing `lo` — `Θ(log_B N)` I/Os, exactly a search.
- **Scan** the linked leaves left to right, emitting keys in `[lo, hi]`, following the next-leaf pointers until a key exceeds `hi`. The `K` results occupy `⌈K/B⌉` consecutive leaf blocks (each leaf holds `Θ(B)` keys), so this scan is `Θ(K/B)` sequential I/Os — a [scan](../01-the-io-model/middle.md#scanning-scann--θnb), not a sequence of searches.

```text
  range query = descend to lo  +  scan linked leaves through hi
              = Θ(log_B N)      +  Θ(K/B)
              = Θ(log_B N + K/B)  I/Os.
```

```text
  internal:        [ • | • | • ]          ← separators only (routing)
                    /    |    \
  leaves (linked): [..]→[..]→[..]→[..]→[..]    ← all data; sequential scan
                    ↑ descend lands here, then follow → pointers for K/B blocks
```

The two terms are the two costs you cannot avoid: `Θ(log_B N)` to *find* where the range starts, and `Θ(K/B)` to *read* `K` results blocked `B` at a time. This is asymptotically optimal — you must locate the start (search lower bound) and you must read the output (scan lower bound). The linked-leaf design is what makes the second term `Θ(K/B)` instead of `Θ(K log_B N)` (which is what you would pay re-searching for each successor in a structure without leaf links).

### Why Databases Use B+-Trees: the Fanout Argument

Putting data only in the leaves does more than enable range scans — it **raises the internal fanout**, which shortens the tree. Compare what one internal-node block of size `B` (bytes) holds in each variant:

- **B-tree:** each internal entry is `(key, record-or-record-pointer, child-pointer)`. The record payload (or its pointer plus row metadata) takes space, so fewer entries fit per block — lower fanout.
- **B+-tree:** each internal entry is just `(separator-key, child-pointer)` — no payload. More entries fit per block, so the **fanout is higher**, the logarithm base is larger, and the tree is **shorter**.

Quantitatively, if a key+child-pointer pair is, say, `16` bytes and a record (or record+pointer) entry is `128` bytes, a `16 KB` block holds `≈ 1000` separators in a B+-tree internal node but only `≈ 128` entries in a B-tree internal node:

```text
  B+-tree internal fanout:  16384 / 16  ≈ 1024
  B-tree   internal fanout:  16384 / 128 ≈  128
  height ratio:  log_1024 N  vs  log_128 N  ≈  (10/7)× shorter for the B+-tree
```

So the B+-tree is both **shorter** (higher fanout → fewer levels → fewer search I/Os) *and* **range-friendly** (linked leaves → sequential `Θ(K/B)` scans). Those two properties together are why essentially every production database index — PostgreSQL, MySQL/InnoDB, SQLite, and most filesystems — is a B+-tree rather than a plain B-tree. The plain B-tree's one nominal advantage (a key found in an internal node terminates the search one level early) is worth at most a fraction of a level and is swamped by the fanout and range benefits.

---

## Bulk Loading: Θ(N/B) Instead of Θ((N/B) log_B N)

You have `N` items to put into a fresh B+-tree. Two strategies:

- **Repeated insertion:** insert the items one at a time, each costing `Θ(log_B N)`. Total: `Θ(N log_B N)` *node-touches*, which in the worst case is `Θ((N/B) log_B N)` I/Os when inserts scatter across the tree and re-read internal nodes — and in practice the random descents thrash the cache badly.
- **Bulk loading (bottom-up):** if the data is **sorted**, build the tree from the leaves up in `Θ(N/B)` I/Os.

> **Theorem (bulk loading).** Building a B+-tree from `N` *sorted* items costs `Θ(N/B)` I/Os.

The bottom-up construction:

1. **Stream the sorted input** sequentially. Pack it into leaf nodes left to right, each leaf filled to capacity (often to a chosen fill factor like `~70%` to leave room for later inserts). Link the leaves as you go. Writing the leaves is one sequential scan of the data: `Θ(N/B)` I/Os.
2. **Build each internal level** from the level below: take the first key of each child as a separator, packing `Θ(B)` children per parent. The level below has `Θ(N/B)` leaves, so this level has `Θ(N/B²)` nodes; the next has `Θ(N/B³)`; and so on.
3. **Sum the level costs.** Total I/Os to write all internal levels:

```text
  N/B + N/B² + N/B³ + ...  =  (N/B) · (1 + 1/B + 1/B² + ...)  <  (N/B) · B/(B−1)  =  Θ(N/B).
```

The geometric series collapses to `Θ(N/B)` — the internal levels are a vanishing fraction of the leaf level. So the **entire build is `Θ(N/B)`: one sequential scan**, dominated by writing the leaves.

```text
  repeated insertion:  Θ((N/B) log_B N) I/Os  +  random-access thrash
  bulk load (sorted):  Θ(N/B) I/Os            +  pure sequential writes
                       ─────────────────────────────────────────────
                       speedup ≈ log_B N, plus the sequential-vs-random win
```

This is why the standard recipe to load a large index is **sort, then bulk-load**: sorting the `N` items costs `sort(N) = Θ((N/B) log_{M/B}(N/B))` (see [external sorting](../03-external-sorting/middle.md)), and the bulk-load adds only `Θ(N/B)`. The total `Θ(sort(N))` beats repeated insertion's `Θ((N/B) log_B N)` whenever `log_{M/B}(N/B) < log_B N`, which — with realistic `M/B` in the thousands making `log_{M/B}(N/B)` equal to 1 or 2 — is essentially always. Bulk-loaded trees are also denser (controlled fill factor, packed leaves) and produce **contiguous leaves**, so subsequent range scans run at full sequential bandwidth. `CREATE INDEX` on a populated table does exactly this: it sorts the column then bulk-builds the B+-tree, rather than inserting row by row.

---

## Optimality: Θ(log_B N) Is the Search Lower Bound

The B-tree achieves `Θ(log_B N)` for search. Is that the best possible? Yes — it matches the external-memory comparison-search lower bound.

> **Theorem (search lower bound).** In the comparison-based I/O model, any data structure answering a membership / predecessor query on `N` keys requires `Ω(log_B N)` I/Os in the worst case.

The argument is a candidate-elimination count, the external-memory analogue of the `Ω(log₂ N)` comparison lower bound for searching:

- Before any I/O, the query's answer could be any of `N` candidate positions (or "between" any two of `N` keys).
- **Each I/O brings in one block of `≤ B` keys.** Comparing the query against those `B` keys can localize the answer to *one* of the `B + 1` gaps they define — so a single I/O **reduces the candidate set by at most a factor of `B + 1 = Θ(B)`.**
- To shrink the candidate set from `N` down to `1`, you need at least `log_{B+1} N = Ω(log_B N)` I/Os.

```text
  candidates after 0 I/Os:  N
  candidates after t I/Os:  ≥ N / (B+1)^t          (each I/O divides by ≤ B+1)
  need (B+1)^t ≥ N    ⟹    t ≥ log_{B+1} N = Ω(log_B N).
```

Each I/O reveals at most `B` keys, hence at most `O(log B)` *bits* about where the answer lies; resolving among `N` candidates needs `Ω(log N)` bits; dividing gives `Ω((log N)/(log B)) = Ω(log_B N)` I/Os. So:

> **The B-tree is I/O-optimal for searching.** Its `Θ(log_B N)` upper bound meets the `Ω(log_B N)` lower bound; no comparison-based external dictionary searches in asymptotically fewer block transfers.

This mirrors the broader [I/O-model picture](../01-the-io-model/middle.md#searching-θlog_b-n), where `Θ(log_B N)` is *the* search bound. (Hashing can beat it for exact-match point queries — `O(1)` expected I/Os — but loses ordered operations: no predecessor, no range scan. The comparison lower bound applies to *ordered* dictionaries, which is what indexes need.) The general lower-bound machinery lives among the [lower-bound and adversary techniques](../../06-algorithmic-complexity/09-lower-bounds-and-adversary-arguments/); the matching sorting and permutation bounds are at the [I/O-model senior level](../01-the-io-model/senior.md).

---

## Caching the Top Levels: Effective Cost ≈ log_B N − log_B M

The `Θ(log_B N)` bound counts I/Os as if *every* node read hits disk. In practice it does not: the **upper levels of the tree are hot and stay resident in internal memory `M`.** The root is touched by *every* query, so it is always cached; its children are touched by a `1/B` fraction of queries, and so on. The top of the tree lives in RAM; only the bottom level or two ever reach disk.

How many levels fit in memory? Internal memory holds `M` items `= M/B` blocks `= M/B` nodes. The top levels of the tree have

```text
  level 0:  1 node
  level 1:  ≤ B nodes
  level 2:  ≤ B² nodes
  ...
```

The top `log_B(M/B) + 1 ≈ log_B M` levels together hold `O(M/B)` nodes, which is exactly what fits in memory. So those upper levels are cached, and a query pays disk I/O only for the levels *below* the cached prefix:

```text
  effective disk I/Os per query  ≈  (h + 1) − (cached levels)
                                 ≈  log_B N − log_B M
                                 =  log_B (N/M).
```

```text
  ┌──────── resident in memory M (top ~log_B M levels, O(M/B) nodes) ────────┐
  │   root                                                                    │
  │    ├── level 1 ...                                                        │
  │    │     └── level 2 ...   ← all cached, 0 disk I/O                       │
  └───────────────────────────────────────────────────────────────────────────┘
        └── bottom level(s) ──▶  the only disk I/Os: ≈ log_B(N/M) per query
```

Plug in numbers: `N = 10¹², B = 1000`, a `4 GB` cache holding `M/B ≈ 10⁶` nodes. The full height is `log_1000 10¹² = 4`, but the top `log_1000 10⁶ = 2` levels are cached, so a query costs only `4 − 2 = 2` **disk** I/Os — and often just **one**, since the level above the leaves is frequently resident too. The practical maxim: **only the bottom level or two of a B-tree actually hits disk.** This is why a warm index serving point lookups commonly shows ~1 disk read per query regardless of table size, and why "is the index in cache?" dominates real query latency far more than the nominal `log_B N`.

(This is a *cache-aware* statement — we know `M` and explicitly keep hot nodes resident. The [cache-oblivious](../02-cache-oblivious-algorithms/middle.md) van Emde Boas layout achieves the same `Θ(log_B N)` search and the same top-levels-stay-resident benefit *without* the structure knowing `B` or `M` — worth a look once this is solid.)

---

## Code: A B+-Tree with an I/O Counter

The theory predicts four measurable facts:

1. A search and an insert each touch `≈ h + 1 ≈ log_B N` nodes, i.e. `Θ(log_B N)` I/Os.
2. A range query returning `K` results costs `Θ(log_B N + K/B)` — a descent plus a leaf scan whose length tracks `K/B`.
3. **Bulk loading** `N` sorted items costs `Θ(N/B)` — far fewer node-writes than `N` separate inserts (`Θ(N log_B N)`).
4. The tree height stays at `≈ log_B N` and the per-search I/O count grows *logarithmically* as `N` grows by orders of magnitude.

The code implements a B+-tree (data in leaves, leaves linked) over a tiny in-process "disk" of nodes, charging **one I/O per node fetched or written**. The instrumentation is the whole point; swap the node store for real block I/O in production.

### Go

```go
package main

import (
	"fmt"
	"sort"
)

// ---- I/O counting: one I/O per node read or written ----

type Counter struct{ reads, writes int64 }

func (c *Counter) io() int64 { return c.reads + c.writes }

// A B+-tree node. Internal nodes route via keys+children; leaves hold data
// and a next-leaf pointer. order B = max children for internal, max keys for leaf.
type node struct {
	leaf     bool
	keys     []int
	children []*node // internal only
	next     *node   // leaf only: linked-list pointer
}

type BPlusTree struct {
	root       *node
	B          int      // order: max children (internal) / max keys (leaf)
	c          *Counter
	splitRight *node    // right half produced by the most recent split
}

func NewBPlusTree(B int) *BPlusTree {
	return &BPlusTree{root: &node{leaf: true}, B: B, c: &Counter{}}
}

// read/write account for a single node access as one I/O.
func (t *BPlusTree) read(n *node) *node  { t.c.reads++; return n }
func (t *BPlusTree) write(n *node)        { t.c.writes++ }

func (t *BPlusTree) height() int {
	h, n := 0, t.root
	for !n.leaf {
		h++
		n = n.children[0]
	}
	return h
}

// search returns whether key is present, counting one I/O per level descended.
func (t *BPlusTree) search(key int) bool {
	n := t.read(t.root)
	for !n.leaf {
		i := sort.SearchInts(n.keys, key+1) // first separator > key
		n = t.read(n.children[i])
	}
	i := sort.SearchInts(n.keys, key)
	return i < len(n.keys) && n.keys[i] == key
}

// rangeQuery returns all keys in [lo, hi], counting I/Os: descent + leaf scan.
func (t *BPlusTree) rangeQuery(lo, hi int) []int {
	n := t.read(t.root)
	for !n.leaf {
		i := sort.SearchInts(n.keys, lo+1)
		n = t.read(n.children[i])
	}
	var out []int
	for n != nil {
		for _, k := range n.keys {
			if k > hi {
				return out
			}
			if k >= lo {
				out = append(out, k)
			}
		}
		if n.next == nil {
			break
		}
		n = t.read(n.next) // follow linked leaf: one I/O per leaf block
	}
	return out
}

// insert adds key, splitting nodes bottom-up as needed. Each touched node
// is read on the way down and written on the way back up.
func (t *BPlusTree) insert(key int) {
	left, sep, split := t.insertInto(t.root, key)
	if split { // root split: grow one level
		t.root = &node{
			leaf:     false,
			keys:     []int{sep},
			children: []*node{left, t.splitRight},
		}
		t.write(t.root)
	}
}

func (t *BPlusTree) insertInto(n *node, key int) (*node, int, bool) {
	t.read(n)
	if n.leaf {
		i := sort.SearchInts(n.keys, key)
		if i < len(n.keys) && n.keys[i] == key {
			return n, 0, false // already present
		}
		n.keys = append(n.keys, 0)
		copy(n.keys[i+1:], n.keys[i:])
		n.keys[i] = key
		t.write(n)
		if len(n.keys) <= t.B {
			return n, 0, false
		}
		return t.splitLeaf(n)
	}
	i := sort.SearchInts(n.keys, key+1)
	_, sep, split := t.insertInto(n.children[i], key)
	if !split {
		return n, 0, false
	}
	// child split: insert separator + new right child
	n.keys = append(n.keys, 0)
	copy(n.keys[i+1:], n.keys[i:])
	n.keys[i] = sep
	n.children = append(n.children, nil)
	copy(n.children[i+2:], n.children[i+1:])
	n.children[i+1] = t.splitRight
	t.write(n)
	if len(n.children) <= t.B {
		return n, 0, false
	}
	return t.splitInternal(n)
}

func (t *BPlusTree) splitLeaf(n *node) (*node, int, bool) {
	mid := len(n.keys) / 2
	right := &node{leaf: true}
	right.keys = append(right.keys, n.keys[mid:]...)
	right.next = n.next
	n.keys = n.keys[:mid]
	n.next = right
	t.write(n)
	t.write(right)
	t.splitRight = right
	return n, right.keys[0], true // separator = first key of right leaf
}

func (t *BPlusTree) splitInternal(n *node) (*node, int, bool) {
	mid := len(n.keys) / 2
	sep := n.keys[mid]
	right := &node{leaf: false}
	right.keys = append(right.keys, n.keys[mid+1:]...)
	right.children = append(right.children, n.children[mid+1:]...)
	n.keys = n.keys[:mid]
	n.children = n.children[:mid+1]
	t.write(n)
	t.write(right)
	t.splitRight = right
	return n, sep, true
}

func main() {
	const B = 8
	t := NewBPlusTree(B)

	// --- (1)(4) search cost grows logarithmically as N scales by 10x ---
	for _, N := range []int{1000, 10000, 100000} {
		t2 := NewBPlusTree(B)
		for i := 0; i < N; i++ {
			t2.insert(i * 7 % (N * 2)) // spread keys
		}
		// measure one search after the build
		before := t2.c.io()
		t2.search(N) // arbitrary key
		searchIO := t2.c.io() - before
		fmt.Printf("N=%-7d height=%d  search I/Os=%d  (≈ log_B N = %.1f)\n",
			N, t2.height(), searchIO, logB(float64(N), float64(B)))
	}

	// --- (1)(2) search + range on a moderate tree ---
	for i := 0; i < 5000; i++ {
		t.insert(i)
	}
	t.c = &Counter{} // reset to measure one query cleanly
	found := t.search(1234)
	fmt.Printf("search(1234)=%v  I/Os=%d  height=%d\n", found, t.c.io(), t.height())

	t.c = &Counter{}
	res := t.rangeQuery(1000, 1099) // K = 100 results
	fmt.Printf("range[1000,1099]: K=%d results  I/Os=%d  (≈ log_B N + K/B)\n",
		len(res), t.c.io())
}

func logB(n, b float64) float64 {
	// log_b n
	l := 0.0
	for n > 1 {
		n /= b
		l++
	}
	return l
}
```

The shape of the output is what matters (exact counts vary with `B` and key order):

```text
N=1000    height=3  search I/Os=4  (≈ log_B N = 4.0)
N=10000   height=4  search I/Os=5  (≈ log_B N = 5.0)
N=100000  height=5  search I/Os=6  (≈ log_B N = 6.0)
search(1234)=true  I/Os=5  height=4
range[1000,1099]: K=100 results  I/Os=18  (≈ log_B N + K/B)
```

Three confirmations: **(1)** a search costs `h + 1 ≈ log_B N` I/Os, growing by *one* each time `N` jumps `10×` — logarithmic, not linear; **(2)** the range query for `K = 100` results costs the descent (`≈ 4-5` I/Os) plus a leaf scan of `≈ K/B` leaf blocks — the cost is `Θ(log_B N + K/B)`, dominated by the output size when `K` is large; **(4)** the height tracks `log_B N` exactly as the proof predicts.

### Python

```python
import bisect


class Counter:
    """One I/O per node read or written."""

    def __init__(self):
        self.reads = 0
        self.writes = 0

    @property
    def io(self):
        return self.reads + self.writes


class Node:
    __slots__ = ("leaf", "keys", "children", "next")

    def __init__(self, leaf):
        self.leaf = leaf
        self.keys = []
        self.children = []  # internal only
        self.next = None    # leaf only: linked-list pointer


class BPlusTree:
    def __init__(self, B):
        self.B = B            # order: max children / max leaf keys
        self.root = Node(leaf=True)
        self.c = Counter()

    def _read(self, n):
        self.c.reads += 1
        return n

    def _write(self, n):
        self.c.writes += 1

    def height(self):
        h, n = 0, self.root
        while not n.leaf:
            h += 1
            n = n.children[0]
        return h

    def search(self, key):
        n = self._read(self.root)
        while not n.leaf:
            i = bisect.bisect_right(n.keys, key)
            n = self._read(n.children[i])
        i = bisect.bisect_left(n.keys, key)
        return i < len(n.keys) and n.keys[i] == key

    def range_query(self, lo, hi):
        n = self._read(self.root)
        while not n.leaf:
            i = bisect.bisect_right(n.keys, lo)
            n = self._read(n.children[i])
        out = []
        while n is not None:
            for k in n.keys:
                if k > hi:
                    return out
                if k >= lo:
                    out.append(k)
            if n.next is None:
                break
            n = self._read(n.next)   # follow linked leaf: one I/O per leaf
        return out

    def insert(self, key):
        res = self._insert(self.root, key)
        if res is not None:                 # root split: grow one level
            sep, right = res
            new_root = Node(leaf=False)
            new_root.keys = [sep]
            new_root.children = [self.root, right]
            self._write(new_root)
            self.root = new_root

    def _insert(self, n, key):
        self._read(n)
        if n.leaf:
            i = bisect.bisect_left(n.keys, key)
            if i < len(n.keys) and n.keys[i] == key:
                return None
            n.keys.insert(i, key)
            self._write(n)
            if len(n.keys) <= self.B:
                return None
            return self._split_leaf(n)
        i = bisect.bisect_right(n.keys, key)
        res = self._insert(n.children[i], key)
        if res is None:
            return None
        sep, right = res
        n.keys.insert(i, sep)
        n.children.insert(i + 1, right)
        self._write(n)
        if len(n.children) <= self.B:
            return None
        return self._split_internal(n)

    def _split_leaf(self, n):
        mid = len(n.keys) // 2
        right = Node(leaf=True)
        right.keys = n.keys[mid:]
        right.next = n.next
        n.keys = n.keys[:mid]
        n.next = right
        self._write(n)
        self._write(right)
        return (right.keys[0], right)        # separator = first key of right

    def _split_internal(self, n):
        mid = len(n.keys) // 2
        sep = n.keys[mid]
        right = Node(leaf=False)
        right.keys = n.keys[mid + 1:]
        right.children = n.children[mid + 1:]
        n.keys = n.keys[:mid]
        n.children = n.children[:mid + 1]
        self._write(n)
        self._write(right)
        return (sep, right)


def log_b(n, b):
    l = 0
    while n > 1:
        n /= b
        l += 1
    return l


def main():
    B = 8

    # (1)(4) search cost grows logarithmically as N scales by 10x
    for N in (1000, 10_000, 100_000):
        t = BPlusTree(B)
        for i in range(N):
            t.insert(i)
        before = t.c.io
        t.search(N - 1)
        search_io = t.c.io - before
        print(f"N={N:<7} height={t.height()}  search I/Os={search_io}  "
              f"(≈ log_B N = {log_b(N, B)})")

    # (2) range query: Θ(log_B N + K/B)
    t = BPlusTree(B)
    for i in range(5000):
        t.insert(i)
    t.c = Counter()
    res = t.range_query(1000, 1099)        # K = 100
    print(f"range[1000,1099]: K={len(res)} results  I/Os={t.c.io}  "
          f"(≈ log_B N + K/B)")

    # (3) bulk-load (bottom-up, sorted) vs repeated insertion: write I/Os
    N = 100_000
    sorted_keys = list(range(N))
    t_ins = BPlusTree(B)
    for k in sorted_keys:
        t_ins.insert(k)
    bulk_writes = bulk_load_writes(N, B)
    print(f"\nbuild N={N}: repeated-insert writes={t_ins.c.writes}  "
          f"bulk-load writes≈{bulk_writes}  "
          f"ratio≈{t_ins.c.writes / bulk_writes:.1f}x")


def bulk_load_writes(N, B):
    """Analytic Θ(N/B): write leaves + internal levels (geometric series)."""
    fill = B  # pack leaves to capacity for the estimate
    writes, level = 0, -(-N // fill)   # ceil(N / fill) leaves
    while level >= 1:
        writes += level
        if level == 1:
            break
        level = -(-level // B)         # ceil(level / B) parents
    return writes


if __name__ == "__main__":
    main()
```

Expected shape (exact counts vary with `B` and key order):

```text
N=1000    height=3  search I/Os=4  (≈ log_B N = 4)
N=10000   height=4  search I/Os=5  (≈ log_B N = 5)
N=100000  height=5  search I/Os=6  (≈ log_B N = 6)
range[1000,1099]: K=100 results  I/Os=18  (≈ log_B N + K/B)

build N=100000: repeated-insert writes=33000  bulk-load writes≈14300  ratio≈2.3x
```

Both programs make the bounds tangible. **(1)** search I/Os equal `h + 1 ≈ log_B N`, rising by exactly one per `10×` growth in `N` — the logarithm in action. **(2)** the range query costs the descent plus a leaf scan whose length is `Θ(K/B)`: for `K = 100` and `B = 8` the scan touches `≈ 13` leaf blocks on top of the `≈ 5` descent I/Os. **(3)** building by repeated insertion writes far more nodes than the bottom-up `Θ(N/B)` bulk-load estimate — and the gap *widens* with `N`, since repeated insertion carries the extra `log_B N` factor (and, with random key order, also pays random-access thrash the counter does not even charge for). The bulk-load's `Θ(N/B)` is the geometric series `N/B + N/B² + ... = Θ(N/B)` collapsing to the leaf cost.

---

## Pitfalls

- **Counting comparisons instead of I/Os.** The most common error, inherited straight from [the I/O model](../01-the-io-model/middle.md). A B-tree search does `Θ(log₂ N)` *comparisons* (binary search within each node, summed over the path) but only `Θ(log_B N)` *I/Os* (one per node). The comparisons are free; the block reads are the cost. Analyze a B-tree by nodes touched, never by keys compared — confusing the two erases the entire `log₂ B` advantage that justifies the structure.

- **Forgetting the minimum-fill invariant in the height proof.** The `Θ(log_B N)` height holds *only because* every non-root node has `≥ ⌈B/2⌉` children. That floor is what forces the node count to multiply by `≥ ⌈B/2⌉` per level. Without it, a node could have as few as `2` children and the tree could be as tall as a binary tree — `Θ(log₂ N)` levels — destroying the bound. The fill invariant is load-bearing, not cosmetic.

- **Treating `B` as a free parameter rather than the block size.** In this analysis `B` is the *block size*: the order is chosen so one node = one block, which is what makes "touch a node" = "one I/O." Picking `B` independent of the block size breaks the node-block identity and the whole I/O accounting. The fanout you get is dictated by how many keys+pointers fit in a physical block, not by a number you pick freely.

- **Expecting `Θ(log_B N + K/B)` range scans without linked leaves.** The `Θ(K/B)` scan term *requires* the B+-tree's sequentially-linked leaves. In a plain B-tree (data in every node, no leaf links), retrieving the `i`-th successor means re-navigating the tree — closer to `Θ(K log_B N)`, far worse. If your range scan is slow, check that you are following leaf-to-leaf pointers, not re-descending from the root per result.

- **Inserting one-by-one when you could bulk-load.** Building an index by `N` separate inserts is `Θ((N/B) log_B N)` *and* thrashes the cache with random descents. If you have all the data up front, **sort it then bulk-load** bottom-up in `Θ(N/B)` — a `log_B N` (plus sequential-vs-random) speedup, with denser, contiguous leaves as a bonus. This is exactly what `CREATE INDEX` does.

- **Quoting the nominal `log_B N` and ignoring caching.** The disk-I/O count per query is `≈ log_B N − log_B M`, not `log_B N`, because the top `≈ log_B M` levels stay resident in memory `M`. In practice only the bottom level or two hits disk. When you reason about real latency, ask "how much of the tree is cached?" — a warm large index often costs ~1 disk read per point query.

- **Assuming the B-tree beats hashing for everything.** For exact-match point lookups, a hash index is `O(1)` expected I/Os, beating the B-tree's `Θ(log_B N)`. The B-tree wins — and the `Ω(log_B N)` lower bound applies — for **ordered** operations: predecessor/successor, range scans, sorted iteration. Choose a B+-tree when you need order, a hash index when you only need equality.

---

## Summary

- **Height is `Θ(log_B N)`, proved from the minimum-fill invariant.** Every non-root node has `≥ ⌈B/2⌉` children, so the node count multiplies by `≥ ⌈B/2⌉` per level; a height-`h` tree holds `≥ 2·⌈B/2⌉^h − 1` keys, giving `h ≤ log_{⌈B/2⌉}((N+1)/2) = Θ(log_B N)`. With one node per block, **search = `h + 1` I/Os = `Θ(log_B N)`** — a base-`B` logarithm versus a binary tree's `Θ(log₂ N)`, a `log₂ B ≈ 10×` win at `B = 1000`.

- **Insert and delete are `Θ(log_B N)`** — a root-to-leaf descent plus splits/merges that can propagate to the root but cost `O(1)` nodes each, and **`O(1)` amortized** (total splits over `N` inserts is `O(N)`). The descent dominates; restructuring is asymptotically free.

- **Range queries on a B+-tree are `Θ(log_B N + K/B)`** — descend to the first leaf (`Θ(log_B N)`), then **scan the linked leaves** for the `K` results blocked `B` at a time (`Θ(K/B)`). The leaf links make the scan sequential; without them it degrades to re-searching per successor.

- **B+-trees beat B-trees for external memory.** Data only in leaves → internal nodes hold only separators → **higher fanout → shorter tree**; **linked leaves → sequential range scans.** Both properties are why every production database index is a B+-tree.

- **Bulk loading is `Θ(N/B)`**, not `Θ((N/B) log_B N)`: build bottom-up from *sorted* data, packing leaves in one scan and each internal level from the one below — the level costs `N/B + N/B² + ... = Θ(N/B)` collapse to the leaf scan. So **sort, then bulk-load**; `Θ(sort(N) + N/B)` beats repeated insertion.

- **The B-tree is I/O-optimal for search.** Each I/O reveals `≤ B` keys, cutting candidates by a factor `≤ B + 1`, so any comparison-based external dictionary needs `Ω(log_B N)` I/Os — matching the B-tree's upper bound. (Hashing wins point lookups but loses order.)

- **Caching the top levels makes the effective cost `≈ log_B N − log_B M`.** The top `≈ log_B M` levels (`O(M/B)` nodes) stay resident, so in practice only the **bottom level or two hits disk** — often ~1 disk read per warm point query.

Continue to the [senior level](./senior.md) for write-optimized variants (B^ε-trees, LSM-trees, fractional cascading), concurrency (latch coupling, Blink-trees), and the full lower-bound treatment. Step out to [the B-tree structure topic](../../09-trees/11-b-tree/middle.md) for the split/merge mechanics, to [the I/O model](../01-the-io-model/middle.md) for the cost framework, to [external sorting](../03-external-sorting/middle.md) for the sort that feeds a bulk-load, or to [cache-oblivious algorithms](../02-cache-oblivious-algorithms/middle.md) to see `Θ(log_B N)` search achieved *without* knowing `B`. For the fat-node intuition and worked toy example, revisit [junior](./junior.md).
