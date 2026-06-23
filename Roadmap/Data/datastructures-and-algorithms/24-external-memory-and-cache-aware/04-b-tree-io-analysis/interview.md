# B-Tree I/O Analysis — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [The Classic: B-Trees vs Balanced Binary Trees](#the-classic-b-trees-vs-balanced-binary-trees)
3. [The Bounds](#the-bounds)
4. [B-Tree vs B+-Tree](#b-tree-vs-b-tree)
5. [Optimality & Lower Bound](#optimality--lower-bound)
6. [Write Optimization: LSM & B^ε-Trees](#write-optimization-lsm--bε-trees)
7. [Gotcha / Trick Questions](#gotcha--trick-questions)
8. [Rapid-Fire Q&A](#rapid-fire-qa)
9. [Common Mistakes](#common-mistakes)
10. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: What is a B-tree and why does its node size match the block size? *(Easy)*

**Answer**: A **B-tree** is a balanced search tree designed for the [I/O model](../01-the-io-model/interview.md): each node holds `Θ(B)` keys and `Θ(B)` child pointers, sized so that **one node fills exactly one disk block / page**. Reading a node is therefore **one I/O**, and that single I/O lets you make a `(B+1)`-way branching decision instead of a 2-way one.

The fanout is tied to the block size because the cost unit is the *block transfer*: you already pay a full I/O to touch a node, so you want that node to be as wide as a block allows — extract the maximum branching from every I/O you're forced to spend. A node smaller than a block wastes part of the transfer; a node larger than a block costs multiple I/Os to read. See [the B-tree data structure](../../09-trees/11-b-tree/interview.md) for the algorithmic mechanics (splits, merges, invariants).

### Q2: What's the fanout B in practice, and how deep is the tree? *(Easy)*

**Answer**: With a typical page of 4–16 KB and keys plus pointers of a few bytes to tens of bytes, the fanout `B` lands in the **hundreds to low thousands** (often quoted as `B ≈ 100–1000`). Height is `Θ(log_B N)`, so:

- A billion keys (`N = 10⁹`) with `B = 1000`: height `log₁₀₀₀(10⁹) = 3`.
- A trillion keys with the same fanout: height 4.

So even enormous indexes are **3–4 levels deep**, meaning a lookup is a handful of I/Os. That shallowness — driven entirely by the fat fanout — is the whole reason B-trees dominate on-disk indexing. See [./middle.md](./middle.md) for the derivation in detail.

---

## The Classic: B-Trees vs Balanced Binary Trees

### Q3: Why do databases use B-trees instead of balanced binary trees (AVL/red-black)? *(Medium — the marquee question)*

**Answer**: Both are `O(log N)` in the **RAM model**, but on **disk** we count *I/Os*, and that's where they diverge. A balanced binary tree branches 2-way, so its height is `log₂ N`, and in the worst case **each node sits on a different block** — one random I/O per level, `Θ(log₂ N)` I/Os per search. A B-tree branches `(B+1)`-way, packing one block per node, so its height is `log_B N` and a search costs `Θ(log_B N)` I/Os.

The difference is the **change of logarithm base**:

```
log_B N = log₂ N / log₂ B
```

so the B-tree does a factor of `log₂ B` fewer I/Os. Concretely, for a billion keys: a binary tree is `log₂(10⁹) ≈ 30` levels → ~30 random I/Os; a B-tree with `B = 1000` is **~3** levels → ~3 I/Os. On disk, where an I/O is the entire cost, **10× fewer accesses is a 10× speedup**. The binary tree counts operations; the B-tree counts the thing that actually matters — block transfers.

### Q4: A binary tree is also O(log N) — isn't that the same? *(Medium)*

**Answer**: Same in the **RAM model**, wildly different in the **I/O model**. `log₂ N` and `log_B N` are both "logarithmic," but the constant hiding in the base is colossal on disk: `log₂ B ≈ 10` when `B = 1000`. Worse, the binary tree's `~30` accesses are **random** I/Os (each node potentially a fresh seek), the most expensive kind. The lesson is the recurring external-memory discipline: **two algorithms with identical asymptotic complexity in the RAM model can differ by an order of magnitude in I/Os** — always ask how many times data crosses the slow boundary, not how many operations run.

---

## The Bounds

### Q5: Derive the search bound Θ(log_B N). *(Medium)*

**Answer**: A B-tree of fanout `Θ(B)` over `N` keys has height `h = Θ(log_B N)`, because each level multiplies the number of reachable keys by `Θ(B)`: `B^h ≥ N ⟹ h ≥ log_B N`. A search descends root-to-leaf, reading **one node — one block — one I/O per level**, so the total is `Θ(log_B N)` I/Os. Insert and delete follow the same root-to-leaf path, plus `O(1)` amortized split/merge work that touches `O(log_B N)` nodes in the worst case, so they're also **`Θ(log_B N)`** I/Os.

### Q6: What's the cost of a range query, and why? *(Medium)*

**Answer**: A range query returning `K` results costs **`Θ(log_B N + K/B)`** I/Os. Two parts:

- **`log_B N`** — descend the tree to locate the first key in the range.
- **`K/B`** — stream the `K` matching records. Because they're stored contiguously and sequentially, reading them is a **scan**, and a scan of `K` elements is `Θ(K/B)` I/Os (each block delivers `B` of them).

This is optimal: you must find the start (`log_B N`) and you must read `K` results, which can't take fewer than `K/B` transfers. The `K/B` term is what makes range scans cheap — but only if the matching records are physically sequential, which is exactly what the [B+-tree](#b-tree-vs-b-tree) guarantees.

### Q7: How fast can you build a B-tree from N pre-existing keys? *(Medium)*

**Answer**: **Bulk loading** builds it in **`Θ(N/B)` I/Os** (after sorting, if not already sorted): stream the sorted keys, pack them into full leaf blocks sequentially, then build each parent level bottom-up — every level is a fraction the size of the one below, so the total is a geometric series dominated by the leaf scan, `Θ(N/B)`.

Contrast with **repeated insertion**: inserting `N` keys one at a time costs `Θ(N · log_B N)` I/Os, mostly *random* writes scattered across the tree. So the standard fast path is **sort-then-bulk-load**, not incremental insertion — `Θ(sort(N)) + Θ(N/B)` of sequential I/O beats `Θ(N log_B N)` of random I/O by orders of magnitude. This is why databases rebuild or `CREATE INDEX` via a sort, not a loop of inserts. See [external sorting](../03-external-sorting/interview.md).

---

## B-Tree vs B+-Tree

### Q8: What's the difference between a B-tree and a B+-tree, and why do databases use B+-trees? *(Medium)*

**Answer**: In a **B-tree**, data records (or their payloads) live in **every node**, internal and leaf alike. In a **B+-tree**, internal nodes hold **only keys and child pointers** — *all* actual records live in the **leaves**, and the leaves are **linked together in a sorted doubly-linked list**.

Databases prefer the **B+-tree** for two reasons:

1. **Fatter fanout.** With no payloads in internal nodes, each internal node packs *more* keys per block → higher `B` → shallower tree → fewer I/Os per lookup.
2. **Sequential range scans.** The linked leaf list lets a range query, once it finds the first leaf, simply **walk leaf-to-leaf sequentially** — pure sequential I/O — collecting `K` results in `Θ(K/B)`. A plain B-tree would have to do an in-order traversal bouncing up and down internal nodes (random-ish I/O). The `K/B` term in `Θ(log_B N + K/B)` is realizable *because* of the linked leaves.

### Q9: Why do the top levels of a B+-tree stay cached, and what does that do to the effective I/O count? *(Medium)*

**Answer**: The tree is shallow and the upper levels are **tiny**: the root is one block, level 2 is `B` blocks, level 3 is `B²` blocks. For `B = 1000`, the top two levels are `~1 + 1000` blocks — a few MB — which **comfortably fits in the buffer pool / page cache** and stays resident across queries. So although the *height* is `log_B N`, the **effective disk I/Os** per lookup are just the **bottom level or two** that aren't cached — often a single I/O for the leaf. This is why a "3-level" B+-tree behaves like a 1-I/O structure in steady state, and why caching matters as much as height in the real cost.

---

## Optimality & Lower Bound

### Q10: Why is Θ(log_B N) the *lower bound* for external search — can't we do better? *(Hard)*

**Answer**: **No** — `Θ(log_B N)` is provably optimal for comparison-based search in the I/O model. The argument: a single I/O brings `B` keys into memory, and comparing the search key against them can rule out keys but reveals at most enough to **narrow the candidate set by a factor of `Θ(B)`** (you learn where the key falls among `B` sorted values). Starting from `N` candidates and shrinking by `Θ(B)` per I/O, you need `Ω(log_B N)` I/Os to isolate one key. The B-tree matches this, so it's **I/O-optimal for search**.

The takeaway: the base of the logarithm is `B` *because* that's the information one block transfer can yield — the bound is tight against the physics of "one I/O = one block of `B` keys."

---

## Write Optimization: LSM & B^ε-Trees

### Q11: B-trees are great for reads — what's their weakness, and what's the alternative? *(Hard)*

**Answer**: Their weakness is **random-write amplification**. Each insert into a B+-tree dirties a leaf page somewhere in the tree — a **random** write — so a write-heavy ingest workload scatters small random writes across disk, the most expensive pattern. The insert cost is `Θ(log_B N)` I/Os, but each is random.

The **write-optimized** alternatives buffer writes and apply them in bulk:

- **Buffer trees / B^ε-trees**: attach a **buffer** to each internal node; inserts drop into the root buffer cheaply and **cascade down in batches** only when a buffer fills, amortizing many writes into one sequential block rewrite.
- **LSM-trees (Log-Structured Merge)**: buffer writes in an in-memory table, flush as **sorted runs** sequentially, and **compact/merge** runs in the background. All writes become sequential.

Both trade some read cost for dramatically cheaper writes.

### Q12: State the insert/query tradeoff for the B^ε-tree. *(Hard)*

**Answer**: The **B^ε-tree** is a tunable family parameterized by `ε ∈ (0, 1]`. Each node devotes a `B^ε` fraction of its space to pivots (giving fanout `B^ε`) and the rest to a buffer. The bounds:

```
insert:  Θ( (log_B N) / (ε · B^(1−ε)) )   amortized I/Os
query:   Θ( (log_B N) / ε )               I/Os
```

The knob `ε` **slides between a B-tree and a buffered log**:

- `ε = 1` → fanout `B`, no buffer → a **plain B-tree**: query `Θ(log_B N)`, insert `Θ(log_B N)`.
- `ε → 0` (e.g. `ε = ½`) → inserts get a `Θ(√B)`-ish speedup at a small constant-factor query cost.

So you can make inserts **asymptotically cheaper than a B-tree** (`Θ(log_B N / B^(1−ε))` vs `Θ(log_B N)`) while keeping queries within a constant factor of optimal. It's the **tunable middle ground** between read-optimized (B-tree) and write-optimized (log/LSM) extremes.

### Q13: When would you pick an LSM-tree over a B-tree? Frame it with RUM. *(Hard)*

**Answer**: Pick an **LSM-tree** for **write-heavy / high-ingest** workloads — time-series, event logs, metrics, message queues, key-value stores under heavy `PUT` load. LSM turns all writes into **sequential** flushes and background compaction, giving far higher write throughput and lower write amplification than a B-tree's random in-place updates. Pick a **B-tree** for **read-heavy / range-scan / point-lookup** workloads where you want the lowest, most predictable read latency.

The principle is the **RUM conjecture**: you cannot simultaneously minimize all three of **R**ead amplification, **U**pdate amplification, and **M**emory (space) amplification — optimizing two worsens the third.

- **B-tree**: low read amp, higher update amp (random writes), low space amp.
- **LSM-tree**: low update amp (sequential writes), higher read amp (a query may probe several runs; mitigated by Bloom filters) and space amp (old data lingers until compaction).
- **B^ε-tree**: dials a chosen point along the read/update curve.

There's no free lunch — you choose where to spend based on the workload's read/write mix.

---

## Gotcha / Trick Questions

### Q14: "Does a bigger node (larger B) always make the tree faster?" *(Hard)*

**Answer**: **No — there's a tradeoff.** A bigger `B` lowers the height `log_B N` (fewer levels, fewer I/Os to descend), which is good. But a bigger node also costs **more to read**: beyond one block it's multiple I/Os per node, and even within reason, very large nodes mean more wasted transfer for a point lookup that only needs one branch decision, plus more CPU to binary-search within the node and more write amplification when the node is rewritten on update. The sweet spot is `B` ≈ **one block/page** (or a small multiple): big enough for a fat fanout, small enough that a node is one cheap transfer. So "bigger is better" holds only up to the block size — past that, node-read cost overtakes the height savings.

### Q15: "The search bound is Θ(log_B N) — is the base really B, or is that a typo for 2?" *(Medium)*

**Answer**: **The base is genuinely `B`, and that's the entire point.** A binary tree gives `log₂ N`; the B-tree's contribution is replacing base 2 with base `B` via its `(B+1)`-way branching, saving a factor of `log₂ B`. If you "correct" it to `log₂ N` you've thrown away the whole reason B-trees exist. The base of the logarithm *is* the fanout, and the fanout *is* the block size — `log_B N` encodes "one I/O reveals `B` keys" directly.

### Q16: "Inserting N keys into a B-tree one by one is fine, right?" *(Medium)*

**Answer**: It's *correct* but **slow** — `Θ(N · log_B N)` I/Os of mostly **random** writes. If you have the keys up front, **sort them and bulk-load** in `Θ(sort(N)) + Θ(N/B)` sequential I/Os, which is dramatically faster. This mirrors the external-sort lesson: incremental random updates lose to sorted sequential bulk operations. Repeated insertion is the right tool only for a genuinely online stream of updates — and even then, a write-optimized structure (LSM / B^ε-tree) beats it.

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | Node size vs block size? | One node = one block = one I/O |
| 2 | Fanout `B` in practice? | Hundreds to low thousands |
| 3 | Tree height? | `Θ(log_B N)` — ~3–4 levels for billions of keys |
| 4 | Search cost? | `Θ(log_B N)` I/Os |
| 5 | Insert / delete cost? | `Θ(log_B N)` I/Os |
| 6 | Range query cost? | `Θ(log_B N + K/B)` |
| 7 | Bulk load cost? | `Θ(N/B)` (after sorting) |
| 8 | Search lower bound? | `Θ(log_B N)` — one I/O reveals ≤ `B` keys |
| 9 | B-tree vs binary tree I/Os? | `log_B N` vs `log₂ N` → factor `log₂ B` |
| 10 | B-tree vs B+-tree? | B+-tree: data in linked leaves, keys-only internals |
| 11 | Why DBs use B+-trees? | Fatter fanout + sequential range scans |
| 12 | Effective I/Os per lookup? | Bottom level or two (top levels cached) |
| 13 | Why is the log base `B`? | `(B+1)`-way branching = block of `B` keys |
| 14 | Write-optimized structures? | Buffer / B^ε-trees, LSM-trees |
| 15 | LSM vs B-tree? | Write-optimized vs read-optimized |
| 16 | RUM conjecture? | Can't minimize Read, Update, Memory amp together |
| 17 | Bigger `B` always better? | No — height drops but node-read cost rises |

---

## Common Mistakes

1. **Calling `log_B N` a typo for `log₂ N`.** The base `B` *is* the contribution — it encodes the `(B+1)`-way branching and saves a `log₂ B` factor.
2. **Confusing B-tree with B+-tree.** B+-trees keep data only in linked leaves; that's what makes range scans sequential (`K/B`) and fanout fatter.
3. **Forgetting the `K/B` term in range queries.** It's `Θ(log_B N + K/B)`, not `Θ(log_B N)` — you still must read the `K` results.
4. **Inserting `N` keys one by one.** That's `Θ(N log_B N)` random I/O; sort-then-bulk-load is `Θ(N/B)` sequential.
5. **Assuming bigger nodes are strictly better.** Fanout helps only up to the block size; past that, node-read cost overtakes height savings.
6. **Ignoring caching when counting I/Os.** Top levels stay resident; effective cost is the bottom level or two, not the full height.
7. **Treating B-trees as universally best.** For write-heavy ingest, LSM-trees (sequential writes) win — RUM says you can't have everything.

---

## Tips & Summary

- **Lead with the cost model**: "One node = one block = one I/O, fanout `B` → height `log_B N`." That sentence answers the marquee question before it's fully asked.
- **Memorize the bounds cold**: search/insert/delete `Θ(log_B N)`, range `Θ(log_B N + K/B)`, bulk load `Θ(N/B)`, lower bound `Θ(log_B N)`. State the base as `B` and explain *why* (one I/O reveals `B` keys).
- **Nail the headline numbers**: `B = 1000`, a billion keys → **3-level B-tree (~3 I/Os)** vs **~30-level binary tree (~30 I/Os)**. Concrete numbers beat asymptotics.
- **Distinguish B-tree from B+-tree**: data in linked leaves → sequential range scans + fatter fanout → that's why databases use B+-trees.
- **Bring caching into the I/O count**: the top levels stay in the buffer pool, so effective lookups touch only the leaf.
- **Have the modern angle ready**: B-tree = read-optimized, LSM = write-optimized, B^ε-tree = tunable middle, all governed by the **RUM conjecture**. "When would you pick LSM?" → write-heavy ingest.

**Related:** [The I/O Model — Interview](../01-the-io-model/interview.md) · [External Sorting — Interview](../03-external-sorting/interview.md) · [B-Tree (data structure) — Interview](../../09-trees/11-b-tree/interview.md) · [B-Tree I/O Analysis — Middle](./middle.md)
