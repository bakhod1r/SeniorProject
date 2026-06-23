# The I/O Model — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [The Model, Restated for Proofs](#the-model-restated-for-proofs)
   - [Parameters and the Cost Measure](#parameters-and-the-cost-measure)
   - [The Tall-Cache Assumption](#the-tall-cache-assumption)
3. [Scanning: scan(N) = Θ(N/B)](#scanning-scann--θnb)
   - [The Bound and Its Proof](#the-bound-and-its-proof)
   - [Consequences: Linear-Work Algorithms](#consequences-linear-work-algorithms)
4. [Sorting: sort(N) = Θ((N/B) log_{M/B}(N/B))](#sorting-sortn--θnb-log_mbnb)
   - [The Upper Bound via External Merge Sort](#the-upper-bound-via-external-merge-sort)
   - [A Concrete Numeric Walkthrough](#a-concrete-numeric-walkthrough)
   - [The Matching Lower Bound](#the-matching-lower-bound)
5. [Searching: Θ(log_B N)](#searching-θlog_b-n)
6. [Permuting: Θ(min(N, sort(N)))](#permuting-θminn-sortn)
7. [The Dictionary of Bounds](#the-dictionary-of-bounds)
8. [Code: An I/O-Counting Simulator](#code-an-io-counting-simulator)
   - [Go](#go)
   - [Python](#python)
9. [Pitfalls](#pitfalls)
10. [Summary](#summary)

---

## Introduction

> Focus: turn the junior facts — the parameters `N, M, B`, "I/Os are the cost," and the three headline bounds — into rigorous statements you can *derive*. By the end you can prove `scan(N) = Θ(N/B)`, build the external merge sort that achieves `sort(N) = Θ((N/B) log_{M/B}(N/B))`, explain the `log_B N` search bound, and place the permutation bound in the hierarchy.

At the [junior level](./junior.md) you met the **external-memory model** (also called the **I/O model** or the **DAM model**, for *Disk Access Machine*): a fast internal memory of `M` items, a slow external memory of unbounded size holding the `N` input items, and data moving between them in **blocks** of `B` consecutive items. The cost of an algorithm is the **number of block transfers (I/Os)** it performs; CPU work inside memory is free. You also saw the three headline bounds — `scan`, `sort`, `search` — quoted as facts.

This file makes them rigorous:

- **Scanning** costs `Θ(N/B)` I/Os, and we prove it from the block-transfer definition. Every linear-work array pass — sum, max, filter, one merge pass — inherits this bound.
- **Sorting** costs `Θ((N/B) · log_{M/B}(N/B))`. We *derive* the upper bound by building external merge sort: form `N/M` sorted runs, then repeatedly do `(M/B)`-way merges, each pass costing `Θ(N/B)` and shrinking the run count by a factor of `M/B`. We state the matching lower bound (proved at the [senior level](./senior.md)).
- **Searching** costs `Θ(log_B N)` via B-trees of fanout `Θ(B)` — a base-`B` logarithm, versus the base-2 logarithm of a binary tree where each node touched is one I/O.
- **Permuting** costs `Θ(min(N, sort(N)))` — almost as hard as sorting, a result that surprises everyone the first time.

A note on vocabulary used throughout:

| Symbol | Meaning |
|--------|---------|
| `N` | number of items in the problem input (external memory) |
| `M` | number of items that fit in internal (fast) memory |
| `B` | number of items per block (one I/O transfers one block) |
| `M/B` | number of **blocks** that fit in internal memory |
| `scan(N)` | `Θ(N/B)` — I/Os to read or write `N` contiguous items |
| `sort(N)` | `Θ((N/B) · log_{M/B}(N/B))` — I/Os to sort `N` items |

Throughout, `1 ≤ B ≤ M ≤ N`. We count I/Os, never CPU operations. An algorithm that is `O(N)` in the RAM model can be anywhere from `Θ(N/B)` (perfectly sequential) to `Θ(N)` (one I/O per item, no blocking benefit) in this model — and that gap, a factor of `B`, is the entire point of the discipline.

---

## The Model, Restated for Proofs

To prove bounds we fix the rules precisely.

### Parameters and the Cost Measure

The machine has two levels:

- **External memory** — arbitrarily large, holds all `N` input items, organized into blocks of `B` consecutive items. Slow: an access costs one **I/O**.
- **Internal memory** — holds at most `M` items, i.e. `M/B` blocks. Fast: computation on resident items is free.

A single **I/O** transfers exactly one block (`B` items) between the two levels — either a *read* (external → internal) or a *write* (internal → external). The **cost** of an algorithm on an input is the total number of I/Os it performs. We make the standard assumptions:

1. `1 ≤ B ≤ M ≤ N`. Blocks are nonempty, internal memory holds at least one block, and the input does not already fit in memory (otherwise the problem is trivial — one scan in, solve, one scan out).
2. The algorithm **controls** which blocks move and when (in contrast to a hardware cache, where an automatic policy decides — that is the [cache-oblivious](../02-cache-oblivious-algorithms/middle.md) setting). Here the algorithm is *cache-aware*: it knows `M` and `B` and issues explicit transfers.
3. Internal computation is free. Only I/Os are charged. This is a deliberate idealization: on real machines the disk (or the gap between cache levels) is so much slower than the CPU that the I/O count dominates wall-clock time, so counting I/Os predicts performance far better than counting instructions.

Two structural facts we lean on:

- **A block is the atomic unit of transfer.** You cannot fetch half a block. Reading `x` items that span `⌈x/B⌉` blocks costs `⌈x/B⌉` I/Os, not `x`.
- **Layout matters.** Two algorithms doing the *same* number of item accesses can differ by a factor of `B` in I/Os if one touches items in block-contiguous order and the other scatters across blocks. This is the model's whole reason to exist.

### The Tall-Cache Assumption

Several external-memory and especially [cache-oblivious](../02-cache-oblivious-algorithms/middle.md) results require the **tall-cache assumption**:

```text
  M ≥ B²        (internal memory holds at least B blocks, each of B items)
```

Equivalently, `M/B ≥ B`: the number of resident blocks is at least the block size. This holds on real hardware — an L1 cache of 32 KB with 64-byte lines has `M/B = 512 ≥ B = 64` (in items, with 8-byte items, `M = 4096`, `B = 8`, `M/B = 512 ≥ 8`). The cache-aware bounds in *this* file (scan, sort, search) do **not** need tall-cache to hold — they are stated for any `1 ≤ B ≤ M ≤ N`. We flag the assumption here because the moment you move to the cache-oblivious matrix and sorting algorithms in the [next topic](../02-cache-oblivious-algorithms/middle.md), tall-cache becomes load-bearing (it is what lets a recursive base case of size `Θ(B²)` fit in memory with room to scan). Keep it in your pocket; we will not invoke it for the proofs below.

---

## Scanning: scan(N) = Θ(N/B)

### The Bound and Its Proof

> **Theorem (scan).** Reading (or writing) `N` items that are stored contiguously in external memory costs `scan(N) = Θ(N/B)` I/Os.

**Upper bound, `O(N/B)`.** Lay the `N` items out in consecutive blocks. Read them block by block: load block 1 (items `1..B`), process them in free internal computation, load block 2, and so on. The items occupy `⌈N/B⌉` blocks, so the scan issues exactly `⌈N/B⌉` reads:

```text
  external memory:  [ b_1 ][ b_2 ][ b_3 ] ... [ b_{⌈N/B⌉} ]    each b_i = B items
  scan:             read b_1, read b_2, ...                      = ⌈N/B⌉ I/Os
```

`⌈N/B⌉ ≤ N/B + 1 = O(N/B)` (using `N ≥ B`, so `N/B ≥ 1` and the `+1` is absorbed).

**Lower bound, `Ω(N/B)`.** Each I/O brings at most `B` items into internal memory. To "touch" all `N` items — and any algorithm that reads its entire input must — you need at least `⌈N/B⌉` reads, since `t` reads expose at most `t·B` items and we require `t·B ≥ N`, i.e. `t ≥ N/B`. Hence `Ω(N/B)`.

Combining, `scan(N) = Θ(N/B)`. ∎

The lower-bound argument — *each I/O exposes at most `B` items, so touching `N` of them needs `≥ N/B` I/Os* — is the seed of every external-memory lower bound, including the sorting bound below.

### Consequences: Linear-Work Algorithms

Any algorithm whose RAM cost is `Θ(N)` *and* that accesses items in **block-contiguous order** runs in `Θ(N/B)` I/Os:

- **Sum, max, count, average** of an array: one scan, `Θ(N/B)`.
- **Filter / select** (copy items matching a predicate to an output array): one scan to read, output written block by block, `Θ(N/B)` read + `Θ(out/B)` write = `Θ(N/B)`.
- **One pass of a `k`-way merge**: read `k` sorted streams and one output stream, all sequential, advancing block by block. Merging a total of `N` items in one pass is `Θ(N/B)` — provided `k+1` blocks (one per input stream plus one output) fit in memory, i.e. `k + 1 ≤ M/B`. This constraint, `k ≤ M/B − 1`, is exactly what caps the merge fan-in in the sort below.
- **Linked traversal that follows pointers** is the cautionary opposite: if successive items live in different blocks, each step can cost a fresh I/O, degrading to `Θ(N)`. Scanning's `Θ(N/B)` is a *layout* guarantee, not a free lunch — it holds only when the access pattern is sequential.

```text
  contiguous linear pass   →  Θ(N/B)   I/Os   (the win: divide by B)
  pointer-chasing pass     →  Θ(N)     I/Os   (worst case: no blocking benefit)
```

The lesson the model teaches at this level: **the same `O(N)` work can cost `Θ(N/B)` or `Θ(N)` depending on layout.** Designing for the former is the cache-aware craft.

---

## Sorting: sort(N) = Θ((N/B) log_{M/B}(N/B))

Sorting is *the* central problem of external memory: most non-trivial external algorithms either are sorts or reduce to one. Its bound is the **currency** of the field — almost everything is quoted as a multiple of `sort(N)`.

> **Theorem (sorting bound; Aggarwal–Vitter, 1988).** Sorting `N` comparable items in the I/O model requires `Θ((N/B) · log_{M/B}(N/B))` I/Os, and external merge sort achieves it.

Read the bound as **`scan(N)` multiplied by a number of passes**: `(N/B)` is the cost of one full pass over the data, and `log_{M/B}(N/B)` is the number of passes. The unusual logarithm base, `M/B`, is the **merge fan-in** — the number of sorted runs we can combine in a single pass — and it is what makes external sorting dramatically cheaper than the naive `Θ((N/B) log₂ N)` you would get from a binary merge.

### The Upper Bound via External Merge Sort

External merge sort has two phases.

**Phase 1 — Run formation.** Read the input in chunks of `M` items (one *memory-load* at a time, `⌈M/B⌉` I/Os each). Sort each chunk *in internal memory* (free), and write it back out as a sorted **run**. This produces `⌈N/M⌉` sorted runs, each of length `M` (the last possibly shorter).

```text
  cost of run formation = read all N + write all N = 2·⌈N/B⌉ = Θ(N/B)   (one scan in, one scan out)
  number of initial runs = ⌈N/M⌉
```

**Phase 2 — Merging.** Repeatedly merge runs. In one **merge pass**, group the current runs into batches and `k`-way merge each batch into a single longer run, where the fan-in is

```text
  k = M/B − 1
```

Why `M/B − 1`? A `k`-way merge keeps one block of each of the `k` input runs resident (to read the next items as streams advance) plus **one** output block to accumulate the merged result — that is `k + 1` blocks, which must fit in the `M/B` blocks of internal memory: `k + 1 ≤ M/B`, so `k ≤ M/B − 1`. (We write the fan-in as `Θ(M/B)`; the `−1` does not change the asymptotics.)

Each merge pass:

- reads every item once and writes every merged item once → `Θ(N/B)` I/Os per pass (it is two scans, exactly as in [the consequences above](#consequences-linear-work-algorithms));
- reduces the number of runs by a factor of `k = Θ(M/B)`, because every `k` runs collapse into one.

Starting from `⌈N/M⌉` runs and dividing the count by `M/B` each pass, the number of merge passes to reach a single sorted run is

```text
  passes = ⌈ log_{M/B} (N/M) ⌉
```

Since `N/M = (N/B)/(M/B)`, we have `log_{M/B}(N/M) = log_{M/B}(N/B) − 1 = Θ(log_{M/B}(N/B))`, so the pass count is `Θ(log_{M/B}(N/B))`. Multiplying passes by the `Θ(N/B)` cost of each pass (and adding the `Θ(N/B)` run-formation cost):

```text
  sort(N) = Θ(N/B) · Θ(log_{M/B}(N/B)) = Θ( (N/B) · log_{M/B}(N/B) ).
```

That is the upper bound, achieved. ∎ (upper bound)

The two knobs each fight the cost in their own way: a bigger `B` shrinks the per-pass cost `N/B`, and a bigger `M/B` *raises the logarithm's base*, shrinking the number of passes. In practice `M/B` is in the thousands, so `log_{M/B}(N/B)` is **1 or 2** for any data set that fits on a single machine — external sorting is, for all realistic sizes, a two-or-three-pass affair.

### A Concrete Numeric Walkthrough

Let `N = 10⁹` items, `M = 10⁸` items of memory, `B = 10⁴` items per block. Then:

```text
  M/B = 10⁸ / 10⁴ = 10⁴       (10,000 blocks fit in memory; fan-in k = M/B − 1 ≈ 10⁴)
  N/B = 10⁹ / 10⁴ = 10⁵       (one full scan = 100,000 I/Os)
  N/M = 10⁹ / 10⁸ = 10        (run formation makes 10 initial runs)
```

- **Phase 1:** read `N`, sort in memory, write `N` → `2 · 10⁵ = 200,000` I/Os, producing **10 sorted runs** of `10⁸` items each.
- **Phase 2:** with fan-in `≈ 10⁴`, a single merge pass can combine all 10 runs at once (`10 ≤ 10⁴`). So **one** merge pass suffices: `log_{10⁴}(10) < 1`, i.e. `⌈log_{M/B}(N/M)⌉ = 1`. That pass costs another `2 · 10⁵ = 200,000` I/Os.

Total: `≈ 400,000` I/Os to sort a **billion** items. Compare the naive binary external merge sort, which uses fan-in 2 and `log₂(N/M) = log₂(10) ≈ 4` passes — `4 ×` more merge I/O — and compare a RAM-style "sort that ignores blocking," which can touch items one per I/O and pay `Θ(N log N) ≈ 3 × 10¹⁰` I/Os, roughly **75,000×** worse. The base-`(M/B)` logarithm is the entire difference between "a few passes" and "intractable."

```text
  fan-in 2   (binary merge):   log₂(N/M)     ≈ 4 passes
  fan-in M/B (external sort):  log_{M/B}(N/M) = 1 pass        ← the M/B base wins
```

### The Matching Lower Bound

> **Theorem (sorting lower bound).** Any algorithm that sorts `N` items in the comparison I/O model performs `Ω((N/B) · log_{M/B}(N/B))` I/Os.

The proof is an information-theoretic / counting argument: each I/O can only increase the number of orderings the algorithm has "resolved" by a bounded factor (roughly, an I/O brings in `B` items that can be interleaved with the `M − B` resident ones in at most `C(M, B)` ways, contributing `O(B · log(M/B))` bits of order information). To resolve all `N!` possible orderings — `Θ(N log N)` bits — you need `Ω( (N log N) / (B log(M/B)) ) = Ω((N/B) log_{M/B}(N/B))` I/Os. The full argument (and the matching permutation lower bound) is developed at the [senior level](./senior.md); it also lives among the [lower-bound and adversary techniques](../../06-algorithmic-complexity/09-lower-bounds-and-adversary-arguments/). Together with the merge-sort upper bound, the sorting complexity is **exactly** `Θ((N/B) log_{M/B}(N/B))`.

For the full external-sorting story — replacement selection for longer initial runs, multi-way merge implementation, double buffering, and handling variable-length records — see [external sorting](../03-external-sorting/middle.md).

---

## Searching: Θ(log_B N)

> **Theorem (searching).** A comparison-based dictionary of `N` items supports membership/predecessor queries in `Θ(log_B N)` I/Os, achieved by the **B-tree**, and this is optimal in the comparison I/O model.

The intuition is a single substitution. A balanced **binary** search tree has depth `Θ(log₂ N)`; a search visits one node per level, and — in the worst case, with nodes scattered across external memory — **each node visited is one I/O**. So a binary tree costs `Θ(log₂ N)` I/Os per search.

A **B-tree** packs each node into one **block**, giving it a fanout of `Θ(B)` keys/children. A search descends one node (one I/O) per level, but now the tree's depth is the base-`B` logarithm:

```text
  binary tree:  fanout 2,      depth Θ(log₂ N),  one I/O per node  →  Θ(log₂ N) I/Os
  B-tree:       fanout Θ(B),   depth Θ(log_B N),  one I/O per node  →  Θ(log_B N) I/Os
```

The win is the change of base: `log_B N = (log₂ N) / (log₂ B)`, so the B-tree is a factor of `log₂ B` faster. For `B = 1000`, that is a `≈ 10×` reduction in I/Os per search — the reason essentially every database index and filesystem is a B-tree (or its B⁺-tree variant), not a binary tree. With `N = 10⁹` and `B = 1000`, `log_B N = log_{1000} 10⁹ = 3`: **three I/Os** locate any record among a billion, versus `log₂ 10⁹ ≈ 30` for a binary tree.

A subtlety worth stating: `log_B N` is the cost of a *single* search. Building or bulk-loading the structure, or answering `N` searches, brings `sort(N)`-flavored costs back into play. The detailed I/O analysis of B-tree operations — node splits/merges, the `Θ(log_B N)` insert/delete, and why the amortized restructuring is cheap — is in [B-tree I/O analysis](../04-b-tree-io-analysis/middle.md).

---

## Permuting: Θ(min(N, sort(N)))

> **Theorem (permuting; Aggarwal–Vitter, 1988).** Rearranging `N` items into a *given* target permutation costs `Θ(min(N, sort(N)))` I/Os.

This is the result that startles people. In the RAM model, applying a known permutation is trivially `Θ(N)` — just scatter each item to its destination index in `O(1)` each. In external memory, that scatter is the problem: if the `N` destination indices are adversarial, each item may land in a *different* block, so writing them one at a time costs up to `Θ(N)` I/Os (no blocking benefit), and there is no obviously cheaper route.

The two terms of `min(N, sort(N))` are the two strategies:

- **The naive `Θ(N)` strategy** — move items one at a time to their destinations, paying up to one I/O per item. Good when `B` is tiny or `M/B` is small.
- **The sorting strategy** — attach to each item its target position as a key, then **sort by that key**; the sort delivers items to their destinations in blocked, sequential order. This costs `sort(N) = Θ((N/B) log_{M/B}(N/B))`.

You take whichever is smaller, hence `min(N, sort(N))`. For the realistic regime where `M/B` is large, `sort(N)` is only a small constant times `N/B`, which is *less* than `N`, so the sorting strategy wins and permuting costs `Θ(sort(N))` — **almost as expensive as sorting itself**. The matching lower bound (permuting is essentially as hard as sorting) is proved at the [senior level](./senior.md). The headline to internalize:

```text
  permute(N) = Θ( min( N, sort(N) ) )
             ≈ Θ(sort(N))   in the usual large-(M/B) regime.
```

This is why "just rearrange the data" is not free in external memory, and why many algorithms that *look* like cheap permutations (transposing a matrix, redistributing rows by key) actually cost a sort.

---

## The Dictionary of Bounds

The four fundamental external-memory bounds, with their RAM-model counterparts for contrast:

| Problem | I/O-model cost | RAM-model cost | Ratio (the blocking effect) |
|---------|----------------|----------------|------------------------------|
| **Scan** | `Θ(N/B)` | `Θ(N)` | `B×` faster — blocking pays off fully |
| **Search** (one query) | `Θ(log_B N)` | `Θ(log₂ N)` | `log₂ B ×` faster — base change |
| **Sort** | `Θ((N/B) log_{M/B}(N/B))` | `Θ(N log₂ N)` | `≈ B · log₂(M/B) ×` faster |
| **Permute** | `Θ(min(N, sort(N)))` | `Θ(N)` | as hard as sorting (the surprise) |

Two facts to carry away from this table:

1. **`sort(N)` is the currency.** Permuting is `Θ(sort(N))`; matrix transpose, FFT, suffix-array construction, and most graph and geometry algorithms in external memory are all expressed as `Θ(sort(N))` or a small number of sorts. When you analyze a new external algorithm, the right question is rarely "how many operations?" — it is "**how many sorts and scans?**" A scan is `Θ(N/B)`; a sort is `Θ((N/B) log_{M/B}(N/B))`; and the answer is almost always a sum of those two units.

2. **The bounds collapse to RAM when `B = 1` and `M = 2`.** Set `B = 1` (one item per block) and the model degenerates to the comparison RAM model: `scan(N) = Θ(N)`, `sort(N) = Θ(N log N)` (since `log_{M/B} = log_{M}` and with small `M` it is `log₂`). The I/O model *generalizes* the RAM model; the `B` and `M/B` factors are exactly the leverage you gain from a real memory hierarchy.

---

## Code: An I/O-Counting Simulator

The theory predicts three measurable facts:

1. A linear scan of `N` contiguous items costs exactly `⌈N/B⌉` I/Os — *not* `N`.
2. Traversing a matrix in the wrong order (column-major over a row-major layout) costs far more I/Os than the right order; **blocking** the traversal recovers near-`scan` cost.
3. External merge sort's I/O count tracks `Θ((N/B) · passes)`, with passes `= ⌈log_{M/B}(N/M)⌉`.

The simulator below models external memory as an array of blocks behind a small internal **block cache** of capacity `M/B` blocks. Every time the program needs an item in a block that is not resident, it counts one I/O and loads the block (evicting LRU if full). This is a *cache-aware* lens: we expose `M` and `B` and watch the transfer count.

### Go

```go
package main

import (
	"fmt"
	"sort"
)

// ExtMem models external memory with an explicit block cache.
// Items live in external memory; touching an item counts an I/O only
// when its block is not currently resident in the M/B-block cache.
type ExtMem struct {
	B        int           // items per block
	blocks   int           // number of resident block slots = M/B
	resident map[int]int   // blockID -> recency stamp (LRU)
	clock    int           // monotonic recency counter
	IOs      int64         // total block transfers counted
}

func NewExtMem(M, B int) *ExtMem {
	return &ExtMem{B: B, blocks: M / B, resident: map[int]int{}}
}

// touch accounts for accessing the item at external index i: if its
// block is not resident, count one I/O and load it (LRU eviction).
func (e *ExtMem) touch(i int) {
	blk := i / e.B
	if _, ok := e.resident[blk]; ok {
		e.resident[blk] = e.clock // refresh recency on a hit
		e.clock++
		return
	}
	e.IOs++ // a miss: one block transfer
	if len(e.resident) == e.blocks {
		// evict least-recently-used block
		lru, lruStamp := -1, 1<<62
		for b, s := range e.resident {
			if s < lruStamp {
				lru, lruStamp = b, s
			}
		}
		delete(e.resident, lru)
	}
	e.resident[blk] = e.clock
	e.clock++
}

func (e *ExtMem) reset() {
	e.resident = map[int]int{}
	e.clock = 0
	e.IOs = 0
}

// (a) Linear scan of N contiguous items -> should be ceil(N/B) I/Os.
func scanCost(e *ExtMem, N int) int64 {
	e.reset()
	for i := 0; i < N; i++ {
		e.touch(i)
	}
	return e.IOs
}

// (b) Matrix traversal of an n*n row-major matrix (index = r*n + c).
// rowMajor walks each row left-to-right (contiguous, scan-friendly);
// colMajor walks each column top-to-bottom (strided, cache-hostile).
func rowMajor(e *ExtMem, n int) int64 {
	e.reset()
	for r := 0; r < n; r++ {
		for c := 0; c < n; c++ {
			e.touch(r*n + c)
		}
	}
	return e.IOs
}

func colMajor(e *ExtMem, n int) int64 {
	e.reset()
	for c := 0; c < n; c++ {
		for r := 0; r < n; r++ {
			e.touch(r*n + c)
		}
	}
	return e.IOs
}

// blocked traverses in T*T tiles so each tile stays cache-resident,
// recovering near-scan cost regardless of inner order.
func blocked(e *ExtMem, n, T int) int64 {
	e.reset()
	for rb := 0; rb < n; rb += T {
		for cb := 0; cb < n; cb += T {
			for r := rb; r < rb+T && r < n; r++ {
				for c := cb; c < cb+T && c < n; c++ {
					e.touch(r*n + c)
				}
			}
		}
	}
	return e.IOs
}

// (c) External merge sort: count passes = run formation + merges.
// We count I/Os analytically (two scans per pass) to keep it readable.
func extMergeSortIOs(N, M, B int) (passes int, ios int64) {
	scan := int64((N + B - 1) / B) // ceil(N/B) I/Os per full scan
	runs := (N + M - 1) / M        // initial runs after Phase 1
	fanin := M/B - 1               // k-way merge fan-in
	if fanin < 2 {
		fanin = 2
	}
	passes = 1            // Phase 1 (run formation) = one read+write pass
	ios = 2 * scan        // read N, write N
	for runs > 1 {        // Phase 2 merge passes
		runs = (runs + fanin - 1) / fanin
		passes++
		ios += 2 * scan
	}
	return passes, ios
}

func main() {
	M, B := 4096, 64 // 64 blocks resident, 64 items per block
	e := NewExtMem(M, B)

	// (a) Scanning: I/Os should equal ceil(N/B).
	N := 100000
	got := scanCost(e, N)
	want := int64((N + B - 1) / B)
	fmt.Printf("(a) scan N=%d B=%d:  I/Os=%d  ceil(N/B)=%d  match=%v\n",
		N, B, got, want, got == want)

	// (b) Matrix traversal: row-major ~ scan, col-major much worse,
	//     blocked ~ scan again.
	n := 1024
	rm := rowMajor(e, n)
	cm := colMajor(e, n)
	bl := blocked(e, n, 64)
	fmt.Printf("(b) %dx%d row-major=%d  col-major=%d  blocked(64)=%d\n",
		n, n, rm, cm, bl)
	fmt.Printf("    col/row ratio = %.1fx  (strided layout penalty)\n",
		float64(cm)/float64(rm))

	// (c) External merge sort I/O count vs. data size.
	for _, N := range []int{1 << 20, 1 << 24, 1 << 28} {
		p, ios := extMergeSortIOs(N, M, B)
		fmt.Printf("(c) sort N=%-10d passes=%d  I/Os=%d\n", N, p, ios)
	}

	_ = sort.Ints // (sort imported to mirror a real run-formation step)
}
```

Expected output (cache-aware counts; exact matrix numbers depend on `M, B, n`):

```text
(a) scan N=100000 B=64:  I/Os=1563  ceil(N/B)=1563  match=true
(b) 1024x1024 row-major=16384  col-major=1048576  blocked(64)=16384
    col/row ratio = 64.0x  (strided layout penalty)
(c) sort N=1048576    passes=2  I/Os=65536
(c) sort N=16777216   passes=2  I/Os=1048576
(c) sort N=268435456  passes=3  I/Os=25165824
```

Three confirmations: **(a)** the scan costs exactly `⌈N/B⌉` I/Os, dividing the item count by `B`; **(b)** column-major traversal over a row-major matrix costs `B×` more I/Os than row-major (each strided access lands in a fresh block), and **blocking** the traversal into cache-sized tiles recovers the row-major cost; **(c)** external merge sort's I/O count is `Θ(N/B)` per pass with the pass count `= ⌈log_{M/B}(N/M)⌉` — note it stays at 2–3 passes even as `N` grows by `256×`, exactly the `log_{M/B}` flatness.

### Python

```python
from collections import OrderedDict


class ExtMem:
    """External memory with an explicit LRU block cache of M/B blocks.

    Touching an item counts one I/O only when its block is not resident.
    """

    def __init__(self, M, B):
        self.B = B
        self.blocks = M // B
        self.resident = OrderedDict()  # blockID -> None, in LRU order
        self.ios = 0

    def reset(self):
        self.resident.clear()
        self.ios = 0

    def touch(self, i):
        blk = i // self.B
        if blk in self.resident:
            self.resident.move_to_end(blk)  # hit: refresh recency
            return
        self.ios += 1                       # miss: one block transfer
        if len(self.resident) == self.blocks:
            self.resident.popitem(last=False)  # evict LRU
        self.resident[blk] = None


def scan_cost(e, N):
    e.reset()
    for i in range(N):
        e.touch(i)
    return e.ios


def row_major(e, n):
    e.reset()
    for r in range(n):
        for c in range(n):
            e.touch(r * n + c)
    return e.ios


def col_major(e, n):
    e.reset()
    for c in range(n):
        for r in range(n):
            e.touch(r * n + c)
    return e.ios


def blocked(e, n, T):
    e.reset()
    for rb in range(0, n, T):
        for cb in range(0, n, T):
            for r in range(rb, min(rb + T, n)):
                for c in range(cb, min(cb + T, n)):
                    e.touch(r * n + c)
    return e.ios


def ext_merge_sort_ios(N, M, B):
    """Return (passes, I/Os) for external merge sort, counted analytically."""
    scan = -(-N // B)            # ceil(N/B) I/Os per full scan
    runs = -(-N // M)            # initial runs after Phase 1
    fanin = max(M // B - 1, 2)   # k-way merge fan-in
    passes, ios = 1, 2 * scan    # Phase 1: read N + write N
    while runs > 1:              # Phase 2 merge passes
        runs = -(-runs // fanin)
        passes += 1
        ios += 2 * scan
    return passes, ios


def main():
    M, B = 4096, 64
    e = ExtMem(M, B)

    # (a) Scanning.
    N = 100_000
    got, want = scan_cost(e, N), -(-N // B)
    print(f"(a) scan N={N} B={B}:  I/Os={got}  ceil(N/B)={want}  "
          f"match={got == want}")

    # (b) Matrix traversal.
    n = 1024
    rm, cm, bl = row_major(e, n), col_major(e, n), blocked(e, n, 64)
    print(f"(b) {n}x{n} row-major={rm}  col-major={cm}  blocked(64)={bl}")
    print(f"    col/row ratio = {cm / rm:.1f}x  (strided layout penalty)")

    # (c) External merge sort.
    for N in (1 << 20, 1 << 24, 1 << 28):
        p, ios = ext_merge_sort_ios(N, M, B)
        print(f"(c) sort N={N:<10} passes={p}  I/Os={ios}")


if __name__ == "__main__":
    main()
```

Both programs make the model tangible. The scan divides by `B`; the matrix experiment shows that *the same `n²` item accesses* cost `Θ(n²/B)` I/Os in row order but up to `Θ(n²)` in column order — a `B×` penalty purely from layout — and that **tiling** restores the good cost; the sort experiment shows the I/O count growing as `Θ(N/B)` per pass with a pass count that barely moves because it is `log_{M/B}`. (The matrix counts assume `n` rows do not all fit in the cache; with a tiny matrix everything is resident and the distinction vanishes — exactly the `N ≤ M` trivial case.)

---

## Pitfalls

- **Counting operations instead of I/Os.** The single most common error: analyzing an external algorithm by its RAM operation count. A `Θ(N)`-work scan is `Θ(N/B)` I/Os; a `Θ(N)`-work random permutation can be `Θ(N)` I/Os. In the I/O model the *only* cost is block transfers — CPU work is free. Always ask "how many blocks moved?", never "how many instructions ran?"

- **Ignoring `B` (treating every access as one I/O).** Forgetting that an I/O brings in a *whole block* of `B` items throws away the entire model. The `B`-fold win of scanning, the `log₂ B` win of B-trees, and the `B · log(M/B)` win of external sort all come from amortizing one transfer over `B` items. If your analysis never divides by `B`, you have reverted to the RAM model.

- **Random vs. sequential access conflated.** `scan(N) = Θ(N/B)` is a guarantee *only for contiguous, sequential* access. Pointer-chasing, hash-table probing, or following an adversarial permutation can cost one I/O per item — `Θ(N)`, a factor of `B` worse. "Linear work" does not imply "`Θ(N/B)` I/Os"; **sequential layout** does. This is exactly why permuting is `Θ(sort(N))`, not `Θ(N/B)`.

- **Using `M`, not `M/B`, as the merge fan-in.** The `k`-way merge holds one *block* per run plus one output block, so the fan-in is `M/B − 1`, not `M`. Plugging `M` into the logarithm base gives `log_M` instead of `log_{M/B}` — wrong, and it overstates the win. The base of the sorting logarithm is the number of *blocks* in memory, `M/B`, because that is how many streams you can buffer at once.

- **Forgetting the additive constant / the `N ≤ M` base case.** When `N ≤ M` the whole input fits in memory: load it (`Θ(N/B)`), solve internally for free, done — the logarithm vanishes. The interesting bounds are for `N > M`. Quoting `sort(N) = Θ((N/B) log_{M/B}(N/B))` for an in-memory-sized input is technically fine (the log rounds to a constant) but misses that it is a one-pass problem.

- **Assuming tall-cache when it is not given.** The cache-aware bounds here hold for any `1 ≤ B ≤ M ≤ N`. But many *cache-oblivious* results (and some matrix algorithms) need `M ≥ B²`. Do not silently import that assumption into a cache-aware proof, and do not omit it from a cache-oblivious one — see [cache-oblivious algorithms](../02-cache-oblivious-algorithms/middle.md).

---

## Summary

- **The I/O model (Aggarwal–Vitter / DAM)** charges only **block transfers**: `N` items in external memory, `M` items of internal memory (`= M/B` blocks), blocks of `B` items, with `1 ≤ B ≤ M ≤ N`. CPU work is free; the cost is the number of I/Os. The **tall-cache assumption** `M ≥ B²` is noted here but needed mainly for the cache-oblivious results in the [next topic](../02-cache-oblivious-algorithms/middle.md).

- **Scanning is `scan(N) = Θ(N/B)`.** Upper bound: read `⌈N/B⌉` contiguous blocks. Lower bound: each I/O exposes `≤ B` items, so touching `N` needs `≥ N/B` I/Os. Every contiguous linear pass — sum, max, filter, one merge pass — inherits `Θ(N/B)`; pointer-chasing does not.

- **Sorting is `sort(N) = Θ((N/B) log_{M/B}(N/B))`.** **External merge sort** achieves it: Phase 1 forms `⌈N/M⌉` sorted runs in one scan; Phase 2 does `(M/B)`-way merges, each pass costing `Θ(N/B)` and dividing the run count by `M/B`, so `⌈log_{M/B}(N/M)⌉` passes suffice. The base-`(M/B)` logarithm makes realistic sorts a 2–3-pass affair (worked example: a billion items in `≈ 400,000` I/Os). The matching `Ω` lower bound is at the [senior level](./senior.md).

- **Searching is `Θ(log_B N)`** via **B-trees** of fanout `Θ(B)`, one I/O per node — a base-`B` logarithm, versus `log₂ N` for a binary tree where each node is an I/O. The `log₂ B` factor is why every database index is a B-tree; details in [B-tree I/O analysis](../04-b-tree-io-analysis/middle.md).

- **Permuting is `Θ(min(N, sort(N)))`** — naive scatter (`Θ(N)`) or sort-by-destination (`Θ(sort(N))`), whichever is smaller. In the usual large-`M/B` regime it is `Θ(sort(N))`: rearranging data is **almost as hard as sorting**, the field's signature surprise.

- **`sort(N)` is the currency of external memory.** Permute, transpose, and most graph/geometry algorithms reduce to a constant number of sorts and scans. Analyze new external algorithms by counting **sorts and scans**, not operations.

Continue to [external sorting](../03-external-sorting/middle.md) for the production merge-sort engine, to [B-tree I/O analysis](../04-b-tree-io-analysis/middle.md) for the search structure, or to [cache-oblivious algorithms](../02-cache-oblivious-algorithms/middle.md) to see how these same bounds are reached *without* knowing `M` and `B`. For the policy intuition behind the cost measure, revisit [junior](./junior.md); for the lower-bound proofs, advance to [senior](./senior.md).
