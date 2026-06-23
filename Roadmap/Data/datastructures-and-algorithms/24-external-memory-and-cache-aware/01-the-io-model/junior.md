# The I/O Model — Junior Level

> **Audience:** You know Big-O and basic data structures, but you've always counted *operations* and assumed every memory access costs the same. The idea that *moving data* — not computing on it — is the real bottleneck is new.
> **Read time:** ~40 minutes. **Focus:** "When data doesn't fit in fast memory, what actually costs you is **block transfers**, not CPU work — so how do we count those, and how does that rewrite what 'fast' means?"

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Memory Hierarchy: Not All Memory Is Equal](#the-memory-hierarchy-not-all-memory-is-equal)
5. [The Lie the RAM Model Tells](#the-lie-the-ram-model-tells)
6. [The I/O Model, Precisely (N, M, B)](#the-io-model-precisely-n-m-b)
7. [The Cost Measure: Count Transfers, Not Operations](#the-cost-measure-count-transfers-not-operations)
8. [Bound 1 — Scanning: Θ(N/B)](#bound-1--scanning-θnb)
9. [Bound 2 — Searching: Θ(log_B N), Not log₂ N](#bound-2--searching-θlog_b-n-not-log₂-n)
10. [Bound 3 — Sorting: The Central Result](#bound-3--sorting-the-central-result)
11. [Sequential vs Random: Putting Numbers On It](#sequential-vs-random-putting-numbers-on-it)
12. [Code: Making Cache Effects Tangible](#code-making-cache-effects-tangible)
13. [Code: Counting I/Os with a Blocked Scan](#code-counting-ios-with-a-blocked-scan)
14. [Why This Matters: Databases, Files, Big Data](#why-this-matters-databases-files-big-data)
15. [Common Misconceptions](#common-misconceptions)
16. [Common Mistakes](#common-mistakes)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

Every algorithm course starts by teaching you to count operations. A loop over `n` items is O(n); a nested loop is O(n²); binary search is O(log n). Underneath this is a quiet assumption you were never asked to question: **every memory access costs the same.** Reading `A[0]` costs the same as reading `A[1000000]`; touching a value in a tiny array costs the same as touching one in a gigantic array. This assumption is baked into the **RAM model**, the cost model behind almost all the Big-O you've ever done.

On a real machine, that assumption is **false** — and not by a little. Reading a value that happens to be sitting in the CPU's L1 cache takes about **1 nanosecond**. Reading one that lives on a spinning hard disk takes about **10 milliseconds** — that's **ten million times slower**. Between those two extremes sits a whole staircase of memories — L1, L2, L3 cache, main RAM, SSD, disk, network — each bigger and slower than the one above it. This staircase is called the **memory hierarchy**, and it has a brutal consequence: when your data is too big to fit in fast memory, the thing that dominates your running time is not how many additions or comparisons you do. It's **how many times you have to haul data up and down the hierarchy.**

This is where the RAM model lies to you. Two algorithms with the *same* O(n) operation count can differ by 100× in wall-clock time, purely because one of them touches memory in a friendly, predictable order and the other jumps around. The RAM model literally cannot see this difference — it scores them identically. To reason about it, we need a different cost model: one that counts **data transfers between fast and slow memory** instead of CPU operations. That model is the **I/O model** (also called the **external-memory model** or the **Disk Access Machine**, DAM), introduced by Aggarwal and Vitter in 1988. It is the foundation of this entire section.

This file builds the I/O model from the ground up. We'll walk the memory hierarchy with real latency numbers, see exactly where the RAM model misleads, then define the I/O model's three parameters — `N` (problem size), `M` (fast-memory size), `B` (block size) — and its single cost measure: the number of block transfers. We'll state the three fundamental bounds — **scanning**, **searching**, and **sorting** — with the intuition behind each, and you'll see why a B-tree crushes a binary tree on disk and why sequential access beats random access by orders of magnitude. Then we'll *measure* it: runnable code that touches the same array in two different orders and clocks the difference, plus an I/O-counting simulation of a blocked scan. By the end, "locality" will stop being a buzzword and become a number you can predict.

---

## Prerequisites

- **Required:** Big-O basics — what O(1), O(n), O(log n), and O(n log n) mean. See [Big-O Notation](../../06-algorithmic-complexity/04-asymptotic-notation/01-big-o-notation/junior.md). The I/O model reuses all of this vocabulary; it just changes *what we count*.
- **Required:** Comfort with arrays and how they're laid out contiguously in memory (element `i` sits right after element `i−1`).
- **Required:** Basic familiarity with binary search and binary search trees — we contrast them with their disk-friendly cousins.
- **Helpful:** A rough idea of what a CPU cache and main memory (RAM) are. We define everything, but a mental picture helps.
- **Helpful:** Familiarity with [amortized analysis](../../06-algorithmic-complexity/05-amortized-analysis/junior.md), which trains the same "judge by the whole run, not one step" mindset.

No probability or hardware-engineering knowledge is required — every cost here is counted by hand.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Memory hierarchy** | The staircase of memories from fast/small (registers, cache) to slow/large (RAM, SSD, disk, network). |
| **Cache** | A small, fast memory that holds a copy of recently/nearby-used data from a slower level. |
| **Block / page** | A fixed-size chunk of `B` contiguous elements moved as one unit between memory levels. |
| **RAM model** | The classic cost model: count operations, assume every memory access costs O(1). |
| **I/O model (DAM / external-memory)** | Cost model that counts **block transfers** between fast and slow memory; in-memory work is free. |
| **N** | The problem size — the number of elements (the input). |
| **M** | The size of fast (internal) memory, in elements. The cache holds `M/B` blocks. |
| **B** | The block size — how many contiguous elements move in one transfer. |
| **I/O (a transfer)** | One movement of a block of `B` elements between fast and slow memory. The unit of cost. |
| **Locality** | Accessing data that is near (spatial) or recently used (temporal) — what makes blocks pay off. |
| **scan(N)** | The I/O cost of reading `N` elements sequentially: `Θ(N/B)`. |
| **sort(N)** | The I/O cost of sorting `N` elements: `Θ((N/B) · log_{M/B}(N/B))`. |
| **B-tree** | A search tree with `B`-element nodes, designed so each node fits one block — search costs `Θ(log_B N)` I/Os. |
| **Sequential access** | Touching memory in contiguous order (`A[0], A[1], A[2], …`) — cache/disk loves it. |
| **Random access** | Touching memory at scattered addresses — defeats blocks, one I/O per access in the worst case. |

---

## The Memory Hierarchy: Not All Memory Is Equal

Start with the picture that makes everything else make sense. A modern computer doesn't have "memory" — it has *layers* of memory, arranged like a staircase. As you go down, each step is **bigger** (holds more) and **slower** (takes longer to reach). Here's the staircase with rough, order-of-magnitude latency numbers — don't memorize the exact figures, memorize the **gaps between them**:

| Level | Typical size | Rough latency | Relative speed |
|-------|-------------|---------------|----------------|
| **CPU registers** | a few hundred bytes | ~0.3 ns | instant |
| **L1 cache** | ~32–64 KB | ~1 ns | 1× (baseline) |
| **L2 cache** | ~256 KB–1 MB | ~4 ns | ~4× slower |
| **L3 cache** | ~8–32 MB | ~15 ns | ~15× slower |
| **Main memory (RAM)** | ~8–128 GB | ~100 ns | ~100× slower |
| **SSD (flash)** | ~256 GB–4 TB | ~100 µs | ~100,000× slower |
| **Hard disk (HDD)** | ~1–20 TB | ~10 ms | ~10,000,000× slower |
| **Network / remote** | effectively unlimited | ~1–100 ms+ | tens of millions× slower |

Stare at the right column. The jump from L1 cache to RAM is about **100×**. The jump from RAM to disk is another **100,000×**. From L1 to disk is **ten million×**. To make that concrete with a famous analogy: if an L1 cache access were **one second**, then a RAM access would be about **two minutes**, an SSD access would be about **a day and a half**, and a disk seek would be about **four months**. The CPU is a chef who can chop an onion in a second but has to wait four months for an ingredient to be shipped from the warehouse.

Two facts about this staircase drive the entire I/O model:

1. **Computation is fast; data movement is slow.** Once data is sitting in a fast level, the CPU rips through it. The expensive part is *fetching* it from a slower level. When your problem is big enough that the data doesn't fit in the fast levels, the bottleneck stops being "how many operations" and becomes "how many trips up and down the staircase."

2. **Data moves in blocks, not single elements.** When the CPU needs one byte that isn't in cache, the hardware doesn't fetch just that byte — it fetches a whole **cache line** (typically 64 bytes) around it. When the OS needs one byte from disk, it reads a whole **page** (typically 4 KB or more). Every transfer hauls a *chunk* of contiguous data, because moving a chunk costs almost the same as moving one element (the slow part is *finding and starting* the transfer, not the size of it). This is why touching nearby data is nearly free once one element of the chunk is loaded — and it's the single most important fact for designing fast algorithms.

That second fact — **data moves in blocks** — is the lever the entire I/O model pulls on. Keep it in mind as we go.

---

## The Lie the RAM Model Tells

Let's make the RAM model's blind spot painfully concrete. Consider two ways to sum every element of a big 2D matrix stored **row by row** in memory (this is how almost every language lays out a 2D array — all of row 0, then all of row 1, and so on).

**Version A — row-major (with the grain):** loop over rows on the outside, columns on the inside. You touch memory in exactly the order it's stored: `A[0][0], A[0][1], A[0][2], …` — contiguous, marching straight through.

**Version B — column-major (against the grain):** loop over columns on the outside, rows on the inside. You touch `A[0][0], A[1][0], A[2][0], …` — jumping a whole row's width in memory on every single step.

Both versions do **exactly the same arithmetic**: the same number of additions, the same number of array reads. The RAM model counts operations, so it declares them **identical** — both O(n²) for an n×n matrix, both equally fast. End of story, says the RAM model.

On a real machine, Version A is often **5× to 50× faster** than Version B. Why? Because of blocks. In Version A, when the hardware loads the cache line containing `A[0][0]`, it pulls in `A[0][1], A[0][2], …` for free (they're contiguous). The next several reads are cache *hits* — no trip down the staircase. One block fetch serves many reads. In Version B, each step jumps a full row away, landing in a *different* cache line every time. Almost every read is a cache *miss* — a fresh, slow fetch. You pay for a whole block but use only one element of it before jumping away and throwing the rest away.

> **The lie, stated plainly:** the RAM model assumes every memory access costs the same O(1). On real hardware, an access that hits a loaded block is ~100× cheaper than one that misses and triggers a fetch. Two algorithms with identical operation counts can therefore differ by orders of magnitude — and the RAM model is constitutionally unable to see it. It's not *wrong* about operation counts; it's just measuring the wrong thing when data movement dominates.

This is not a corner case. It is *the* performance story for databases, file systems, scientific computing, and any program working on data bigger than cache. We need a model that counts the thing that actually costs — and that model counts **block transfers**.

---

## The I/O Model, Precisely (N, M, B)

The **I/O model** (Aggarwal–Vitter, 1988) — also called the **external-memory model** or the **Disk Access Machine (DAM)** — throws out the "all accesses cost the same" assumption and replaces it with a deliberately simple two-level picture:

```
        ┌─────────────────────────┐
        │   FAST MEMORY (cache)    │   holds M elements total
        │   = M/B blocks           │   work here is FREE
        └───────────▲─────────────┘
                    │  one I/O moves
                    │  a block of B
                    │  contiguous elements
        ┌───────────▼─────────────┐
        │   SLOW MEMORY (disk)     │   unbounded
        │   stored in blocks of B  │   every access pulls a whole block
        └─────────────────────────┘
```

There are exactly **three parameters**, and you should be able to recite what each one means:

- **`N` — the problem size.** The number of elements in the input (the array to sort, the table to scan, the keys to search). This is the "n" you already know.
- **`M` — the size of fast memory.** How many elements fit in the fast level (cache, or RAM if the slow level is disk). The fast memory is small relative to `N`; the whole point is that `N` doesn't fit in `M`.
- **`B` — the block size.** How many contiguous elements move in a single transfer. One I/O always moves a *whole block* of `B` elements — never just one. The fast memory therefore holds **`M/B` blocks** at a time.

The setup, in words: there's a small fast memory holding `M` elements (organized as `M/B` blocks), and an unbounded slow memory (the "disk") holding everything, organized into blocks of `B` contiguous elements. To touch any element, it must first be in fast memory; if it isn't, you pay **one I/O** to pull in the whole block of `B` elements that contains it. If fast memory is full, you must evict a block to make room (which block to evict is the *caching* question — see [Paging and Caching Theory](../../25-online-algorithms/03-paging-and-caching-theory/junior.md)).

> **The key abstraction:** the I/O model deliberately ignores the *whole* staircase and models just **two adjacent levels** — one fast, one slow. That's enough to capture the dominant cost, because at any moment the bottleneck is the transfer between the two levels that matters for your problem (cache↔RAM if your data fits in RAM but not cache; RAM↔disk if it doesn't fit in RAM). The same math describes both; you just plug in different `M` and `B`.

---

## The Cost Measure: Count Transfers, Not Operations

Here is the heart of the model, and the one mental shift this whole file exists to install:

```
COST in the RAM model   =  number of CPU operations
COST in the I/O model   =  number of I/Os  (block transfers between fast and slow memory)

Work on data already in fast memory  =  FREE (cost 0)
```

Read that twice. In the I/O model, **computation is free.** Adding, comparing, multiplying — all the things the RAM model counts — cost **nothing** here. The *only* thing you pay for is moving a block between the slow and fast levels. An algorithm's I/O cost is simply the number of those transfers it triggers.

This sounds extreme — "computation is free?!" — but it's the right idealization for the regime we care about. When one disk I/O takes 10 ms and the CPU can do *tens of millions* of operations in that same 10 ms, the operations genuinely *are* free by comparison. You could do a thousand times more arithmetic per byte and barely notice, as long as you didn't trigger another I/O. So we model the operations as costing zero and focus entirely on the bottleneck: the transfers.

Two consequences flow immediately from this cost measure, and they explain almost everything about why disk-aware algorithms are designed the way they are:

1. **Touching `B` nearby elements costs *one* I/O, not `B`.** Because a single transfer brings in a whole block of `B` contiguous elements, once you've paid one I/O you can read (or write) all `B` of those elements for free. This is why **sequential access is cheap**: marching through contiguous data, you pay one I/O per `B` elements. It's the formal version of "data moves in blocks."

2. **Touching `B` scattered elements can cost `B` I/Os.** If your `B` accesses land in `B` different blocks (random access), each one triggers its own transfer. You pay full price every time and use only one element of each block you fetch. This is why **random access is expensive** — up to `B` times more I/Os than sequential for the same number of element-accesses.

So the entire game of external-memory algorithm design is: **arrange your computation so that whenever you pull a block into fast memory, you use as much of it as possible before evicting it.** Maximize the work done per I/O. That single principle — *locality* — is what every bound below comes from.

---

## Bound 1 — Scanning: Θ(N/B)

The simplest and most fundamental I/O bound. Suppose you need to read every one of the `N` elements once — sum an array, filter a table, copy a file. How many I/Os?

In the RAM model, reading `N` elements is obviously `Θ(N)` — one operation per element. In the I/O model, it's **`Θ(N/B)`**, because each transfer brings in `B` elements at once and you use all of them. The `N` elements live in `N/B` blocks; you fetch each block once, read its `B` elements for free, move on.

```
scan(N) = Θ(N/B)   I/Os
```

We give it a name — `scan(N)` — because it's a building block for everything else, the way `O(n)` is in the RAM world. The intuition is exactly the block fact: **sequential reading amortizes the cost of each transfer over `B` elements.** If `B = 4096` (a 4 KB page of 1-byte elements), scanning costs roughly `N/4096` I/Os — about four thousand times fewer transfers than naively reading one element per I/O.

> **Why scanning is the gold standard.** `scan(N) = Θ(N/B)` is the *best possible* I/O cost for any algorithm that must look at all `N` elements — you can't read `N` elements in fewer than `N/B` transfers, because each transfer delivers at most `B` of them. Whenever you can phrase an algorithm as "a few sequential scans," you've hit the floor. This is why "can I do this with sequential passes?" is the first question external-memory algorithm designers ask. (We exploit it heavily in [external sorting](../03-external-sorting/junior.md).)

The contrast that makes it vivid: reading the same `N` elements in *random* order — jumping to scattered positions — costs up to `Θ(N)` I/Os (one transfer per element, in the worst case). That's a factor of `B` worse than scanning. Same elements, same operation count, `B`× the I/O. The order you touch memory in *is* the performance.

---

## Bound 2 — Searching: Θ(log_B N), Not log₂ N

Now searching a sorted collection of `N` elements. You know binary search: `Θ(log₂ N)` comparisons, halving the range each step. In the RAM model that's wonderful — `log₂` of a billion is only 30. So just keep the sorted array on disk and binary-search it, right?

**Disastrously wrong on disk.** Binary search jumps to scattered positions: first the middle, then a quarter-point a *huge* distance away, then an eighth-point somewhere else entirely. Each of those probes lands in a *different* block, so each comparison costs **one full I/O**. Binary search on disk costs `Θ(log₂ N)` *I/Os* — about 30 disk seeks for a billion elements, ~30 × 10 ms = **0.3 seconds for a single lookup.** That's catastrophic for a database serving thousands of lookups a second.

The fix is to change the *base of the logarithm* by using a search tree whose nodes are sized to fill a block — a **B-tree**. Instead of a binary node holding 1 key and 2 child pointers, a B-tree node holds about `B` keys and `B+1` child pointers, all packed into one block. So **one I/O loads an entire node**, and that node lets you decide which of `B+1` children to descend into — a `B`-way branch, not a 2-way branch. The tree's height shrinks accordingly:

```
binary search tree height  ≈  log₂ N        (2-way branching)
B-tree height              ≈  log_B N        (B-way branching, one I/O per level)

search(N) = Θ(log_B N)   I/Os
```

The difference is enormous because the base changed from 2 to `B`. With `N = 10⁹` and a block holding `B = 1000` keys:

```
binary search on disk:  log₂(10⁹)    ≈  30 I/Os
B-tree search:          log_1000(10⁹) =  3 I/Os
```

**Thirty disk seeks versus three.** A 10× reduction in I/Os, which is a 10× reduction in lookup latency, just from matching the node size to the block size. And it only gets better at scale: B-trees stay shallow even for trillions of records (a 3–4 level B-tree indexes practically any real database). This is *the* reason every relational database and file system on Earth indexes with B-trees (or B⁺-trees) instead of binary trees — the base-`B` logarithm is the whole point. We analyze this carefully in [B-Tree I/O Analysis](../04-b-tree-io-analysis/junior.md).

> **The lesson:** in the I/O world, the *base* of your logarithm matters as much as having a logarithm at all. `log₂` and `log_B` are both "logarithmic," and the RAM model treats them as interchangeable (they differ only by a constant factor in operation counts). But in I/Os, that constant factor *is* a factor of `log B` — often 10× — and it's the difference between a usable database and an unusable one.

---

## Bound 3 — Sorting: The Central Result

Sorting is the marquee result of external-memory theory, because so many algorithms (joins, deduplication, grouping, building indexes) reduce to it. You know sorting is `Θ(N log N)` *comparisons* in the RAM model. The I/O cost is:

```
sort(N) = Θ( (N/B) · log_{M/B}(N/B) )   I/Os
```

Take it apart piece by piece — every factor has a meaning you already understand:

- **`N/B`** is `scan(N)` — the cost of one sequential pass over the data. So sorting costs some number of *passes*, each one a cheap linear scan. Good: passes are the floor.
- **`log_{M/B}(N/B)`** is the **number of passes**. The base of *this* logarithm is **`M/B`** — the number of blocks that fit in fast memory. The intuition (full story in [external sorting](../03-external-sorting/junior.md)): each pass merges together `M/B` sorted runs at once (a `(M/B)`-way merge, because you can hold one block from each of `M/B` runs in fast memory simultaneously). Merging `M/B`-ways per pass means the number of runs shrinks by a factor of `M/B` each pass — so you need `log_{M/B}` of them.

Put together: **sorting is a handful of sequential passes, where each pass multiplies your merge fan-in by `M/B`.** Because `M/B` is large in practice (fast memory holds thousands of blocks), `log_{M/B}(N/B)` is *tiny* — often just **2 or 3** for real data sizes. So external sorting is, in practice, "scan the data a small constant number of times," which is dramatically less than the naive `(N/B) · log₂ N` you'd get from blindly running an in-memory sort with each comparison costing an I/O.

A concrete sense of scale. Say `N = 10¹²` elements (a terabyte-ish), `B = 10³`, and `M/B = 10³` (fast memory holds a thousand blocks):

```
naive (binary-merge, log₂):  (N/B) · log₂(N/B) = 10⁹ · log₂(10⁹) ≈ 10⁹ · 30  = 3 × 10¹⁰ I/Os
external sort (log_{M/B}):   (N/B) · log_{M/B}(N/B) = 10⁹ · log_1000(10⁹) = 10⁹ · 3 = 3 × 10⁹ I/Os
```

A **10× reduction** in transfers from choosing the right merge width — and just like searching, it comes from changing the *base* of the logarithm (from 2 to `M/B`). It's the same lesson twice: in external memory, **maximize how much you accomplish per I/O**, and you do that by making the fan-in (the log base) as large as fast memory allows.

> **The three bounds in one breath:** `scan(N) = Θ(N/B)` says sequential reading is cheap; `search(N) = Θ(log_B N)` says use `B`-way nodes so the log base is `B`; `sort(N) = Θ((N/B)·log_{M/B}(N/B))` says sort in a few big-fan-in passes. All three are the *same idea* — **use whole blocks and make the log base big** — applied to three problems. Lock that pattern in and the rest of this section is variations on it.

---

## Sequential vs Random: Putting Numbers On It

Let's make "sequential beats random" a number rather than a slogan, because it's the practical takeaway you'll use most.

Suppose you need to read `1,000,000` elements from disk, where one random disk I/O takes `10 ms` and `B = 1000` elements per block.

**Sequential read** (elements stored contiguously, read in order):

```
I/Os = N/B = 1,000,000 / 1000 = 1,000 I/Os
time = 1,000 × 10 ms = 10 seconds
```

**Random read** (elements scattered, each in its own block):

```
I/Os = N = 1,000,000 I/Os
time = 1,000,000 × 10 ms = 10,000 seconds ≈ 2.8 hours
```

**Ten seconds versus nearly three hours** — a factor of `B = 1000` — for reading the *exact same number of elements*. The only difference is the *order* in which they sit on disk and the order you touch them. This is why:

- Databases work *extremely* hard to turn random I/O into sequential I/O (clustered indexes, log-structured storage, sorting before bulk operations).
- "Just add an index" sometimes makes a query *slower* — if a query touches a large fraction of a table, scanning it sequentially (one big sweep) can beat following an index that triggers a random I/O per row.
- SSDs were revolutionary partly because they shrank the random-vs-sequential gap (no physical seek), though even SSDs strongly prefer sequential and block-aligned access.

The same effect, scaled down, is exactly the row-major vs column-major matrix story from earlier — just at the cache↔RAM boundary instead of RAM↔disk. **It's blocks all the way down.** The I/O model is the one framework that explains the cache version and the disk version with identical math; you only change `M` and `B`.

---

## Code: Making Cache Effects Tangible

Theory is convincing, but *measuring* the effect on your own machine makes it unforgettable. Here we sum a large 2D array two ways — **row-major** (with the memory grain) and **column-major** (against it) — and clock the difference. Same arithmetic, same operation count; the only difference is access order, and therefore block reuse.

### Go

```go
package main

import (
	"fmt"
	"time"
)

const N = 4096 // N x N matrix; ~16M ints, far bigger than L1/L2 cache

func main() {
	// Allocate one big contiguous backing array, row-major:
	// element (r, c) lives at index r*N + c. Row r is contiguous.
	a := make([]int64, N*N)
	for i := range a {
		a[i] = int64(i % 7)
	}

	// Row-major: inner loop walks c, touching a[r*N+0], a[r*N+1], ... contiguous.
	start := time.Now()
	var sumRow int64
	for r := 0; r < N; r++ {
		for c := 0; c < N; c++ {
			sumRow += a[r*N+c]
		}
	}
	rowTime := time.Since(start)

	// Column-major: inner loop walks r, touching a[0*N+c], a[1*N+c], ...
	// each step jumps N elements ahead -> a different cache line every time.
	start = time.Now()
	var sumCol int64
	for c := 0; c < N; c++ {
		for r := 0; r < N; r++ {
			sumCol += a[r*N+c]
		}
	}
	colTime := time.Since(start)

	fmt.Printf("row-major (sequential): %v   sum=%d\n", rowTime, sumRow)
	fmt.Printf("col-major (strided):    %v   sum=%d\n", colTime, sumCol)
	fmt.Printf("column-major was %.1fx slower\n",
		float64(colTime)/float64(rowTime))
}
```

### Python

```python
import time

N = 2048  # smaller than Go's: pure-Python loops are slow, but the RATIO still shows

# One flat row-major list: element (r, c) at index r*N + c.
a = [i % 7 for i in range(N * N)]

# Row-major: inner loop over c is contiguous in memory.
start = time.perf_counter()
sum_row = 0
for r in range(N):
    base = r * N
    for c in range(N):
        sum_row += a[base + c]
row_time = time.perf_counter() - start

# Column-major: inner loop over r jumps N elements each step (strided).
start = time.perf_counter()
sum_col = 0
for c in range(N):
    for r in range(N):
        sum_col += a[r * N + c]
col_time = time.perf_counter() - start

print(f"row-major (sequential): {row_time:.3f}s   sum={sum_row}")
print(f"col-major (strided):    {col_time:.3f}s   sum={sum_col}")
print(f"column-major was {col_time / row_time:.1f}x slower")
```

**What it does:** both loops compute the identical sum with the identical number of additions and array reads — the RAM model scores them equal. But row-major marches through contiguous memory (each fetched cache line/block is fully used before moving on), while column-major jumps a full row on every step (each access lands in a fresh block, most of which is wasted). On a typical machine you'll see the column-major version run **several times to tens of times slower**. That gap is the I/O model made visible: same operations, very different *block transfers*.

> **Note on the numbers:** the exact ratio depends on your CPU's cache sizes, the matrix dimension, and the language. Make the matrix large enough that it doesn't fit in cache (a few thousand on a side) or the effect shrinks — because if everything fits in fast memory, there's no slow level to transfer from, and the I/O model's costs vanish. That itself is a lesson: **locality only matters when your data outgrows fast memory.** For small data the RAM model is fine; for big data the I/O model rules.

---

## Code: Counting I/Os with a Blocked Scan

The wall-clock demo shows the *effect*; this one shows the *mechanism* by simulating the I/O model directly. We build a tiny "disk" of `N` elements split into blocks of `B`, give ourselves a fast memory that can hold a few blocks, and **count every block transfer** — exactly the cost measure of the I/O model. Then we scan sequentially versus randomly and watch the I/O counter diverge by a factor of `B`.

### Python

```python
class SimDisk:
    """A toy slow memory of N elements split into blocks of size B.
    Every time we access an element NOT in our loaded block, we pay one I/O."""
    def __init__(self, data, B):
        self.data = data            # the N elements on "disk"
        self.B = B                  # block size
        self.loaded_block = None    # which block index is currently in fast memory
        self.ios = 0                # I/O counter — the I/O-model cost

    def read(self, i):
        block = i // self.B         # which block element i lives in
        if block != self.loaded_block:
            self.ios += 1           # MISS: pull this block into fast memory
            self.loaded_block = block
        # Element is now in fast memory -> reading it is FREE.
        return self.data[i]


def sequential_scan(N, B):
    disk = SimDisk(list(range(N)), B)
    total = 0
    for i in range(N):              # touch elements in stored order
        total += disk.read(i)
    return disk.ios

def random_scan(N, B):
    import random
    disk = SimDisk(list(range(N)), B)
    order = list(range(N))
    random.shuffle(order)           # touch the SAME elements in scattered order
    total = 0
    for i in order:
        total += disk.read(i)
    return disk.ios


if __name__ == "__main__":
    N, B = 100_000, 1000
    seq = sequential_scan(N, B)
    rnd = random_scan(N, B)
    print(f"N={N}, B={B}")
    print(f"sequential scan: {seq:>7} I/Os   (≈ N/B = {N // B})")
    print(f"random scan:     {rnd:>7} I/Os   (≈ N   = {N})")
    print(f"random was {rnd / seq:.0f}x more I/Os")
```

Running this prints something close to:

```
N=100000, B=1000
sequential scan:     100 I/Os   (≈ N/B = 100)
random scan:       99500 I/Os   (≈ N   = 100000)
random was 995x more I/Os
```

The numbers fall right out of the theory. Sequential scanning touches each block once and reads its `B` elements for free → `N/B = 100` I/Os, exactly `scan(N)`. Random scanning jumps to a fresh block almost every time → nearly `N` I/Os, a factor of `B ≈ 1000` worse. The simulator only counts *block transfers* (the `disk.ios` counter) and treats reading an already-loaded element as free — which is precisely the I/O model's cost measure. The code *is* the model.

> **This is the whole section in miniature.** Same `N` elements, same number of element-reads, identical operation count — yet the I/O cost differs by `B` purely because of *access order*. Every external-memory and cache-aware algorithm you'll meet is an effort to keep that I/O counter close to the sequential `N/B` floor and far from the random `N` ceiling.

---

## Why This Matters: Databases, Files, Big Data

The I/O model isn't an academic curiosity — it's the design constraint that shapes the systems you use every day. Wherever data is too big for fast memory, the I/O model is in charge.

| System | The "slow memory" is… | What the I/O model explains |
|--------|----------------------|------------------------------|
| **Relational databases** | disk / SSD pages | Why tables are indexed with **B-trees**, not binary trees (`log_B N`, not `log₂ N`); why query planners weigh sequential scans against index lookups; why `ORDER BY` on huge tables uses external sort. |
| **File systems** | disk blocks | Why files are stored in blocks; why fragmentation hurts (it turns sequential reads into random ones); why reading a file front-to-back is fast. |
| **Big-data / analytics** | disk, then network | Why sorting terabytes uses **external merge sort** (a few big passes); why MapReduce/Spark shuffle stages are dominated by I/O, not compute; why columnar formats (Parquet) exist — to scan only the columns you need, contiguously. |
| **CPU-bound numeric code** | RAM (cache is "fast") | Why matrix multiply is **blocked/tiled**, why row-major vs column-major matters, why "cache-friendly" data layouts (struct-of-arrays) beat pointer-chasing ones. |
| **Key-value stores (LSM trees)** | disk / SSD | Why writes are batched and flushed **sequentially** (turning random writes into sequential ones) instead of updating B-tree nodes in place. |

The throughline is always the same question: **how do we touch slow memory as few times as possible, and as sequentially as possible?** Every answer — B-trees, external sort, tiling, columnar storage, LSM trees — is a strategy for maximizing useful work per I/O. Once you've internalized the I/O model, you can look at any of these designs and immediately see *what problem it's solving*: it's reducing block transfers.

And there's a beautiful sequel to all this. So far we've assumed the algorithm *knows* `B` and `M` and tunes itself to them (a B-tree node is sized to `B`; an external sort merges `M/B` runs). But what if you could design an algorithm that's optimal for the I/O model **without ever being told `B` or `M`** — one that's automatically cache-friendly at *every* level of the hierarchy at once? Astonishingly, you can. That's the subject of [cache-oblivious algorithms](../02-cache-oblivious-algorithms/junior.md), the next topic — and it's one of the most elegant ideas in all of algorithm design.

---

## Common Misconceptions

- **"Big-O operation counts tell me how fast my code runs."** Only when data fits in fast memory. Once it doesn't, **data transfers dominate**, and two algorithms with identical O(n) operation counts can differ by 100× in wall-clock time. The RAM model can't see this; the I/O model can.

- **"Binary search is always great because it's O(log n)."** It's `O(log₂ n)` *operations*, but `O(log₂ n)` *I/Os* on disk — its scattered probes each hit a different block. A B-tree's `O(log_B n)` I/Os is ~10× better. On disk, the *base* of the log is the whole game.

- **"Sequential and random access are basically the same; an access is an access."** They differ by a factor of `B` — often 1000×. Sequential reuses each fetched block fully; random throws away most of each block. This single distinction explains more real-world performance than almost anything else.

- **"The I/O model is only about spinning hard disks."** No — it describes *any* two adjacent levels of the hierarchy. Cache↔RAM, RAM↔SSD, RAM↔disk, local↔network: same math, different `M` and `B`. The matrix row-major/column-major effect is the I/O model operating at the cache level.

- **"Computation being 'free' in the I/O model is obviously absurd."** It's an idealization, and a good one: when one I/O costs as much as millions of operations, the operations genuinely are negligible. The model deliberately exaggerates a true gap to make the dominant cost stand out. (At the cache level the gap is ~100×, not millions, so the idealization is looser — but the *direction* is right.)

- **"`M/B` is a weird base for a logarithm; surely it should be 2."** `M/B` is the number of blocks that fit in fast memory — the number of sorted runs you can merge at once. Making that base large (thousands) is *why* external sort needs only 2–3 passes instead of 30. Large log base = few passes = the goal.

---

## Common Mistakes

- **Counting operations when transfers are the bottleneck.** If your data is bigger than RAM (or bigger than cache), analyzing operation count answers the wrong question. Ask "how many block transfers?" instead. The two answers can disagree by orders of magnitude.

- **Putting a sorted array on disk and binary-searching it.** Each probe is a random I/O → `log₂ N` disk seeks per lookup. Use a B-tree (or sort + sequential scan, or a hash index) so each I/O does `B`-way work, not 2-way.

- **Ignoring access order.** Reading the right data in the wrong order (random instead of sequential) costs up to `B`× more I/Os for the *same* data. Always ask whether you can arrange the work as sequential passes.

- **Forgetting that locality only matters past fast memory.** If your whole dataset fits in cache, none of this applies — the RAM model is fine and the row/column trick shows no difference. The I/O model earns its keep precisely when `N ≫ M`. Don't over-engineer for I/O on tiny data.

- **Assuming `B` and `M` are constants you can drop.** In ordinary Big-O you'd absorb `B` into the constant factor. In the I/O model `B` and `M` are *the whole point* — they appear in every bound (`N/B`, `log_B N`, `log_{M/B}`). Dropping them throws away the entire model.

- **Conflating "has a logarithm" with "has the same logarithm."** `log₂ N`, `log_B N`, and `log_{M/B}(N/B)` are all "logarithmic," but the *base* changes the I/O cost by a factor of `log B` or `log(M/B)` — routinely 10×. In the I/O world, the base is load-bearing.

---

## Cheat Sheet

```
THE MEMORY HIERARCHY (rough latencies — memorize the GAPS)
  L1 cache  ~1 ns   |  RAM    ~100 ns  (~100x slower than L1)
  SSD     ~100 µs   |  disk   ~10 ms   (~10,000,000x slower than L1)
  → computation is FAST; moving data between levels is SLOW
  → data moves in BLOCKS (cache line ~64B, disk page ~4KB+), not single elements

WHY THE RAM MODEL LIES
  RAM model: count operations, assume every access = O(1)  ← false on real HW
  Two algorithms, SAME operation count, can differ 100x in wall time
  Example: summing a matrix row-major (fast) vs column-major (slow) — same ops!

THE I/O MODEL (Aggarwal–Vitter 1988) — aka external-memory / DAM
  N = problem size (elements)
  M = size of fast memory (elements)         → fast memory holds M/B blocks
  B = block size (elements moved per transfer)
  COST = number of I/Os (block transfers).  In-memory work is FREE.
  Touch B nearby elements  → 1 I/O   (sequential = cheap)
  Touch B scattered elements → B I/Os (random = expensive)

THE THREE FUNDAMENTAL BOUNDS
  SCAN    scan(N) = Θ(N/B)                     read N elements sequentially
  SEARCH  Θ(log_B N)                           B-tree, NOT log₂ N — base is B!
  SORT    sort(N) = Θ((N/B)·log_{M/B}(N/B))    a few big-fan-in passes

NUMBERS THAT STICK (B=1000)
  search 10⁹:  binary on disk = 30 I/Os   vs   B-tree = 3 I/Os      (10x)
  read 10⁶:    sequential = 1000 I/Os     vs   random = 10⁶ I/Os    (1000x = B)

THE ONE BIG IDEA
  Use whole blocks (sequential access) AND make the log base large (B-way nodes,
  M/B-way merges). Maximize useful work per I/O. That's the entire section.
```

---

## Summary

The classic RAM model counts CPU operations and pretends every memory access costs the same. On real hardware that's false: the **memory hierarchy** spans ten million× in latency from L1 cache (~1 ns) to disk (~10 ms), and crucially, **data moves in blocks** — fetching one element drags in a whole chunk of `B` contiguous neighbors. So when data outgrows fast memory, the bottleneck stops being *operations* and becomes **block transfers up and down the hierarchy** — something the RAM model literally cannot measure.

- **The I/O model** (external-memory / DAM) fixes this with three parameters — **`N`** (problem size), **`M`** (fast-memory size), **`B`** (block size) — and one cost measure: **the number of I/Os (block transfers)**. Computation on data already in fast memory is **free**; you pay only to move blocks between the slow and fast levels. The model captures any two adjacent hierarchy levels — cache↔RAM, RAM↔disk — with identical math.

- **The cost measure has two faces.** Touching `B` *nearby* elements costs **one** I/O (sequential access is cheap, because one transfer serves `B` reads). Touching `B` *scattered* elements costs up to `B` I/Os (random access is expensive). This single distinction — locality — drives every external-memory algorithm.

- **The three fundamental bounds** are all the same idea in different clothes: **`scan(N) = Θ(N/B)`** (sequential reading is the floor), **`search = Θ(log_B N)`** (use `B`-way B-tree nodes so the log base is `B`, not 2 — turning 30 disk seeks into 3), and **`sort(N) = Θ((N/B)·log_{M/B}(N/B))`** (a *few* sequential passes, each merging `M/B` runs). In every case the win comes from **using whole blocks and making the log base large**.

- **The code makes it real:** summing a matrix row-major vs column-major shows the same operation count running several-to-tens-of-times apart in wall-clock time, and an I/O-counting simulator shows a sequential scan costing `N/B` transfers while a random scan over the *same* elements costs `~N` — a factor of `B` — purely from access order.

- **It matters everywhere:** B-tree database indexes, file-system block layout, external merge sort over terabytes, tiled matrix multiply, columnar storage, LSM trees — all are strategies for the same goal: **touch slow memory as few times and as sequentially as possible.**

The big idea to carry forward: when data doesn't fit in fast memory, *transfers, not operations, are the cost* — and the art of fast algorithms becomes the art of maximizing useful work per block fetched.

**Next steps:** [the middle-level treatment](./middle.md) proves the scanning, searching, and sorting bounds rigorously and develops the lower-bound argument for `sort(N)`. Then [Cache-Oblivious Algorithms](../02-cache-oblivious-algorithms/junior.md) shows the stunning trick of being I/O-optimal *without knowing* `B` or `M`; [External Sorting](../03-external-sorting/junior.md) builds the `sort(N)` bound into a real algorithm; and [B-Tree I/O Analysis](../04-b-tree-io-analysis/junior.md) works the `log_B N` search bound in full. For the question of *which* block to evict when fast memory fills up, see [Paging and Caching Theory](../../25-online-algorithms/03-paging-and-caching-theory/junior.md).

---

## Further Reading

- **Aggarwal & Vitter (1988), "The Input/Output Complexity of Sorting and Related Problems"** — the paper that introduced the I/O model and proved the sorting bound. The origin of everything here.
- **Vitter, *Algorithms and Data Structures for External Memory*** — the comprehensive survey of external-memory algorithms (scanning, sorting, searching, and beyond).
- **Jon Bentley, *Programming Pearls*** — Column on "the back of the envelope" and cache effects; vivid, practical intuition for why locality wins.
- **"Latency Numbers Every Programmer Should Know"** (Jeff Dean / Peter Norvig, widely circulated) — the canonical table of hierarchy latencies behind the analogy used in this file.
- **[Cache-Oblivious Algorithms](../02-cache-oblivious-algorithms/junior.md)** — being I/O-optimal without knowing `B` or `M`.
- **[External Sorting](../03-external-sorting/junior.md)** and **[B-Tree I/O Analysis](../04-b-tree-io-analysis/junior.md)** — the `sort(N)` and `log_B N` bounds turned into real algorithms.
- **[Paging and Caching Theory](../../25-online-algorithms/03-paging-and-caching-theory/junior.md)** — the eviction question: when fast memory fills, which block do we throw out?
- **[The I/O Model — Middle](./middle.md)** — rigorous proofs of the scanning, searching, and sorting bounds, including the sorting lower bound.
