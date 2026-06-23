# External Sorting — Junior Level

> **Audience:** You know the I/O model basics — that cost is measured in **block transfers**, not operations ([the I/O model](../01-the-io-model/junior.md)) — and you've written an in-memory sort or two. Now the data is bigger than RAM, and every sorting algorithm you know quietly assumed it all fit. That assumption just broke.
> **Read time:** ~45 minutes. **Focus:** "When `N` elements don't fit in `M` memory, how do you sort them while touching the disk as few times as possible — and why does the answer turn out to be just a couple of passes?"

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Problem: Sorting What Doesn't Fit](#the-problem-sorting-what-doesnt-fit)
5. [Why Your Favorite Sort Breaks on Disk](#why-your-favorite-sort-breaks-on-disk)
6. [External Merge Sort: The Two-Phase Picture](#external-merge-sort-the-two-phase-picture)
7. [Phase 1 — Run Formation](#phase-1--run-formation)
8. [Phase 2 — Merging Runs](#phase-2--merging-runs)
9. [A Fully Worked Tiny Example (N=12, M=4, B=2)](#a-fully-worked-tiny-example-n12-m4-b2)
10. [Counting the Cost: The Sorting Bound](#counting-the-cost-the-sorting-bound)
11. [The 1 TB Example: Only a Couple of Passes](#the-1-tb-example-only-a-couple-of-passes)
12. [Why Merge, Not Quicksort](#why-merge-not-quicksort)
13. [Code: External Merge Sort That Counts Its Passes](#code-external-merge-sort-that-counts-its-passes)
14. [Where External Sort Lives in the Real World](#where-external-sort-lives-in-the-real-world)
15. [Common Misconceptions](#common-misconceptions)
16. [Common Mistakes](#common-mistakes)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

Every sorting algorithm you've ever written shares a hidden assumption so deep you probably never noticed it: **the whole array fits in memory.** Quicksort swaps elements at arbitrary indices `A[i]` and `A[j]`; mergesort allocates a scratch array as big as the input; heapsort sifts values up and down a tree that spans the entire dataset. All of them reach freely into any position of the data at any time, because in the RAM model every access costs the same and the array is just *there*, in one flat addressable space.

Now imagine the data is a **terabyte** and your machine has **8 gigabytes** of RAM. The array is not "just there." Most of it is on disk, and you can only hold a small slice — `M` elements — in memory at once. The moment quicksort tries to compare `A[5]` with `A[900,000,000,000]`, those two elements live in completely different places on disk, and fetching each one is a block transfer that costs about ten million times more than an in-memory comparison. Run quicksort unchanged and it will thrash the disk into oblivion, doing roughly one slow random I/O per comparison — billions of them. Your sort that "should" take seconds takes **days**.

This is the external-sorting problem, and it's not exotic — it's everywhere data outgrows RAM: a database executing `ORDER BY` on a hundred-million-row table, the GNU `sort` command piping a giant log file, Spark shuffling intermediate results across a cluster, a search engine building its index. The question is sharp and practical: **how do you sort `N` elements when only `M` of them fit in memory, while touching the disk as few times as possible?** And "as few times as possible" has a precise meaning from the [I/O model](../01-the-io-model/junior.md) — we count **block transfers** of `B` elements each, and we want to minimize them.

The answer is one of the most satisfying results in all of algorithm design, because it's both simple and astonishingly cheap. The algorithm is **external merge sort**, and it works in two phases: first chop the data into memory-sized chunks, sort each one internally, and write them back as sorted **runs**; then **merge** those runs together — many at a time — until a single sorted file remains. The headline result is that this takes only **a handful of sequential passes over the data** — often just *two* for real-world sizes — because each merge pass can combine a huge number of runs at once. This file builds that algorithm from the ground up: the two-phase picture with diagrams, a fully worked tiny example you can trace by hand, the pass-counting math applied to a real terabyte, why merging beats quicksort on disk, and runnable code that sorts a simulated on-disk list using bounded memory while counting every pass and I/O it spends.

---

## Prerequisites

- **Required:** The I/O model basics — what `N`, `M`, `B` mean, and that cost is **block transfers**, not operations. See [The I/O Model](../01-the-io-model/junior.md). In particular you need `scan(N) = Θ(N/B)` (one sequential pass costs `N/B` I/Os) — we'll lean on it constantly.
- **Required:** Knowing how to merge two (or more) sorted lists into one sorted list — the merge step of mergesort. If it's rusty, revisit [Merge Sort](../../07-sorting-algorithms/02-merge-sort/junior.md).
- **Required:** Any one internal (in-memory) sort — quicksort, mergesort, heapsort. We use it as a black box to sort each memory-sized chunk. The full menu lives in [Sorting Algorithms](../../07-sorting-algorithms/).
- **Helpful:** Big-O basics and what `log_b N` means for varying base `b` — the whole point of external sort is that the base of the pass-count logarithm is large.
- **Helpful:** A feel for "sequential vs random" disk access (sequential is ~`B`× cheaper), covered in the I/O model file.

No probability, no advanced data structures. Everything here is counted by hand.

---

## Glossary

| Term | Definition |
|------|-----------|
| **External sorting** | Sorting `N` elements when `N` is far larger than fast memory `M`; data lives on disk and cost is block transfers. |
| **Internal / in-memory sort** | An ordinary sort (quicksort, mergesort…) that assumes the whole array fits in RAM. Used as a subroutine. |
| **Run** | A sorted sequence of elements stored contiguously on disk. The output of sorting one memory-sized chunk. |
| **Run formation** | Phase 1: read `M` elements, sort them in memory, write them back as one sorted run. Produces `⌈N/M⌉` runs. |
| **Merge** | Phase 2: combine several sorted runs into one larger sorted run by repeatedly emitting the smallest current element. |
| **Pass** | One sweep that reads every element and writes every element once — costs `Θ(N/B)` I/Os, i.e. `2·N/B` (read + write). |
| **k-way merge / fan-in** | Merging `k` runs at once. The maximum `k` is `M/B − 1` (one input block per run, one output block). |
| **`N`** | Total number of elements to sort. |
| **`M`** | Number of elements that fit in fast memory at once. |
| **`B`** | Block size — elements moved per I/O. Fast memory holds `M/B` blocks. |
| **`M/B`** | Number of blocks that fit in memory = the merge fan-in (≈ the base of the pass-count logarithm). |
| **Sequential I/O** | Reading/writing contiguous blocks — cheap, one I/O per `B` elements. Merge does this. |
| **Random I/O** | Reading/writing scattered blocks — expensive, up to one I/O per element. Quicksort-on-disk does this. |

---

## The Problem: Sorting What Doesn't Fit

State the setup precisely, because every design choice falls out of it:

- You have `N` elements to sort. `N` is **huge** — think billions or trillions.
- Your fast memory holds only `M` elements at a time, and `M ≪ N`. The data does **not** fit.
- Everything you can't hold lives on **disk** (the slow level). To touch an element it must first be read into memory, one **block of `B` contiguous elements** per I/O.
- The cost you're minimizing is the **number of I/Os** — block transfers between disk and memory. In-memory work (comparisons, swaps, the internal sort itself) is **free** by comparison, exactly as the [I/O model](../01-the-io-model/junior.md) says.

So the constraint that reshapes everything is: **you can only ever look at `M` elements at once.** You cannot hold the whole array. You cannot freely compare element 5 with element 900-billion. Whatever algorithm you design must work by repeatedly pulling in a chunk that fits, doing something useful with it, and writing results back — and it must arrange those reads and writes to be as **sequential** as possible, because sequential I/O is up to `B`× cheaper than random I/O.

A quick sanity figure. Suppose `N = 1` billion elements, `M = 10` million (so the data is 100× too big for memory), and one random I/O takes 10 ms. If your algorithm did even *one* random I/O per element — as a naive on-disk sort would — that's `10⁹ × 10 ms = 10⁷ seconds ≈ 116 days`. Completely unusable. The whole art of external sorting is getting that number down to **a few sequential sweeps** of the data, which for the same size is minutes, not months. Let's see why the obvious approaches fail and the merge approach wins.

---

## Why Your Favorite Sort Breaks on Disk

Run your usual in-memory sorts mentally on a disk-resident array and watch them detonate:

**Quicksort.** Partitioning picks a pivot and swaps elements from the two ends of the current range inward — `A[i] ↔ A[j]` where `i` starts at the left and `j` at the right of a range that, at the top level, spans the *entire* array. Those two positions are on opposite ends of the disk. Each swap touches two far-apart blocks; each comparison may pull in a fresh block. Partition is essentially **random access across the whole dataset**, and on disk random access costs up to one I/O per element. Quicksort's elegant `O(N log N)` comparisons become `O(N log N)` *random I/Os* — catastrophic.

**Heapsort.** Even worse. Sifting an element down the heap follows parent→child links that jump to positions `2i+1`, `2i+2` — scattered all over the array. A heap that spans the disk is a random-access nightmare; heapsort does `O(N log N)` pointer-chasing accesses, nearly all of them random I/Os.

**In-memory mergesort, run blindly.** Mergesort's *merge* step is actually sequential and disk-friendly (that's the seed of the right answer!). But naive recursive mergesort also allocates a scratch buffer the size of the whole input and recurses to the bottom — it assumes the entire array and its scratch copy both fit in memory. Run it unchanged on data bigger than RAM and the recursion's lower levels work on slices that don't fit, and the scratch allocation alone exceeds memory.

The lesson: **the problem isn't the comparison count — it's the access pattern.** All these sorts do roughly `N log N` comparisons, which is fine. What kills them on disk is *where* they touch memory: scattered, unpredictable positions across data far bigger than `M`. We need an algorithm whose every disk access is **sequential** and that never needs more than `M` elements in memory at once. Merging — done right, in two phases — is exactly that algorithm.

---

## External Merge Sort: The Two-Phase Picture

External merge sort has two phases. Hold this picture in your head and the rest is detail:

```
  PHASE 1 — RUN FORMATION                PHASE 2 — MERGE
  (turn unsorted disk into sorted runs)  (combine runs until one remains)

  unsorted N on disk                     run1  run2  run3 ... runR
   │                                       \    |    /
   │ read M at a time                       \   |   /   (M/B − 1)-way merge,
   ▼                                          \  |  /     one block per run
  ┌──────────┐  internal                       \ | /      in memory
  │ M in RAM │  sort in                          ▼
  └──────────┘  memory                      ┌──────────┐  output block
   │                                         │ M in RAM │  written
   │ write sorted chunk back                 └──────────┘  sequentially
   ▼                                              │
  one sorted RUN on disk                          ▼
  (repeat ⌈N/M⌉ times)                       fewer, longer runs
                                            (repeat passes until 1 run = sorted file)
```

- **Phase 1 (Run Formation):** Read the data in memory-sized gulps of `M` elements. Sort each gulp in memory with any internal sort. Write each sorted gulp back to disk as a **run**. After one sequential pass over all the data, you have `⌈N/M⌉` sorted runs.

- **Phase 2 (Merge):** Repeatedly merge groups of runs into longer runs. Because you can fit one block from each of `M/B − 1` runs in memory simultaneously (plus one output block), you can merge `M/B − 1` runs at a time — a **`(M/B − 1)`-way merge**. Each *pass* reads and writes everything once and cuts the number of runs by a factor of ≈ `M/B`. After `⌈log_{M/B}(N/M)⌉` passes, exactly **one** run remains — the fully sorted file.

Both phases do only **sequential** disk I/O (read runs front-to-back, write output front-to-back), which is why they hit the cheap `Θ(N/B)`-per-pass cost. The genius is in Phase 2's fan-in: by merging many runs at once instead of two, the number of passes is a logarithm with a **huge base** (`M/B`, often thousands), so it's tiny. Let's build each phase carefully.

---

## Phase 1 — Run Formation

The first phase is almost embarrassingly simple, and that's the point — it does the minimum possible work to turn an unsorted disk into a small number of sorted runs.

**The procedure:**

1. Read the next `M` elements from disk into memory. (That's `M/B` block reads — a sequential chunk.)
2. Sort those `M` elements **in memory**, using any internal sort you like (quicksort, mergesort, whatever your standard library provides). This sorting is **free** in the I/O model — it touches only data already in memory.
3. Write the sorted `M` elements back to disk as one contiguous **run**. (That's `M/B` block writes — sequential.)
4. Repeat until all `N` elements have been processed.

**What it produces.** Since each run holds `M` elements, you end up with `⌈N/M⌉` sorted runs. If `N = 12` and `M = 4`, that's 3 runs of 4 each. If `N = 1` billion and `M = 10` million, that's 100 runs.

**What it costs.** You read every element once and write every element once — a single **pass** over the data. That's `N/B` reads + `N/B` writes = `Θ(N/B)` I/Os, all **sequential**. In I/O-model terms, run formation is exactly **one `scan(N)`** of reading plus one of writing — the cheapest thing an algorithm that must touch all the data can possibly do.

```
Run formation: read M, sort in RAM, write run. Repeat ⌈N/M⌉ times.
  Output:  ⌈N/M⌉ sorted runs, each of length M (last may be shorter).
  Cost:    one pass = 2·(N/B) I/Os, all sequential.   (the internal sorting is FREE)
```

> **Why this is the right starting move.** After Phase 1 you've spent the absolute minimum — one sweep — and converted a totally unsorted dataset into a modest pile of sorted runs. The *order within each run* is now correct; all that remains is to interleave the runs. And interleaving sorted sequences is exactly what merging does, sequentially and cheaply. Phase 1 sets up Phase 2 to do only the disk-friendly thing.

(A more advanced trick called **replacement selection** can make the initial runs *longer* than `M` — about `2M` on average — which reduces the run count and can save a pass. The middle-level treatment covers it; for now, plain `M`-sized runs are the clean mental model.)

---

## Phase 2 — Merging Runs

Now we have `⌈N/M⌉` sorted runs and need to combine them into one. This is where the cleverness lives.

**The two-way merge you already know.** Merging two sorted lists is simple: keep a pointer into each, compare the two current heads, emit the smaller, advance that pointer. Repeat until both are exhausted. It reads each list once, front-to-back — perfectly **sequential**. You could merge runs two at a time, like a tournament: merge runs into pairs, then merge those, and so on. With `R` runs that's `log₂ R` passes. Correct, but wasteful — `log₂ R` is bigger than it needs to be.

**The `k`-way merge — the key upgrade.** Nothing stops you from merging *many* runs at once. To merge `k` runs, keep one **input buffer** (one block) per run in memory, plus one **output buffer** (one block) for the result. You repeatedly find the smallest current element across all `k` buffer heads, emit it to the output buffer, and advance that run's pointer (refilling its input block from disk when it empties). When the output buffer fills, write it out (sequentially) and start a new one.

**How big can `k` be?** Memory holds `M/B` blocks. You need one block buffered per input run plus one for output, so:

```
k_max = (M/B) − 1       the maximum merge fan-in
```

(In practice you devote several blocks per run to buffer reads/writes smoothly, so real `k` is a bit smaller — but the order of magnitude is `M/B`, which is what matters.) If memory holds 1000 blocks, you can merge ~1000 runs in a single pass.

**What one merge pass costs and accomplishes.** A merge pass reads every element once (across all the runs) and writes every element once (the merged output) — one pass = `Θ(N/B)` I/Os, all sequential. And crucially, it **cuts the number of runs by a factor of ≈ `M/B`**: `R` runs become `⌈R / (M/B − 1)⌉` runs. Repeat passes until one run is left:

```
After pass 0 (run formation):   ⌈N/M⌉ runs
After pass 1 (k-way merge):     ⌈N/M⌉ / k   runs       (k ≈ M/B)
After pass 2:                   ⌈N/M⌉ / k²  runs
   ...
After pass p:                   ⌈N/M⌉ / kᵖ  runs   → reaches 1 when
                                p = ⌈log_k (N/M)⌉ = ⌈log_{M/B}(N/M)⌉ passes
```

```
         pass 1 (4-way merge of 16 runs → 4 runs)
  run1 run2 run3 run4 ─┐
  run5 run6 run7 run8 ─┤→ merge → runA      pass 2 (4-way merge of 4 runs → 1)
  run9 ...        run12┤→ merge → runB ─┐
  run13 ...      run16 ┘→ merge → runC ─┼→ merge → SORTED
                        → merge → runD ─┘
```

So the number of merge passes is `⌈log_{M/B}(N/M)⌉`. Because the base `M/B` is *large* (thousands of blocks fit in memory), this logarithm is **tiny** — usually 1 or 2. That is the whole magic: a big merge fan-in means very few passes.

---

## A Fully Worked Tiny Example (N=12, M=4, B=2)

Numbers make it concrete. Sort these 12 elements with memory `M = 4` and block size `B = 2` (so memory holds `M/B = 2` blocks):

```
DISK (unsorted):  [ 8  3 | 11  1 | 5  9 | 2  7 | 12  4 | 6  10 ]
                   block0  block1  block2  block3  block4   block5
```

### Phase 1 — Run formation (read 4, sort, write)

Read `M = 4` elements at a time, sort in memory, write back as a run. `⌈12/4⌉ = 3` runs.

```
read [8, 3, 11, 1]  → sort in RAM → write run1 = [1, 3, 8, 11]
read [5, 9, 2, 7]   → sort in RAM → write run2 = [2, 5, 7, 9]
read [12, 4, 6, 10] → sort in RAM → write run3 = [4, 6, 10, 12]

DISK after Phase 1:
  run1: [ 1  3  8  11 ]
  run2: [ 2  5  7  9  ]
  run3: [ 4  6  10 12 ]
```

Cost so far: one pass — read 12 elements, write 12 elements. In I/Os (blocks of `B=2`): 6 reads + 6 writes = 12 I/Os.

### Phase 2 — Merge

Here `k_max = M/B − 1 = 2 − 1 = 1`... which would mean we can't even merge two runs! That's the honest edge of a *tiny* `M`: with only 2 blocks of memory you can't hold one input block from two runs plus an output block. Real systems have `M/B` in the thousands, so this never bites. For the sake of a clean illustration, let's give memory just enough room to do a **2-way merge** (one block per input run held as single elements, one output) and merge two runs at a time — exactly the tournament structure.

**Pass 1 — merge run1 and run2 (2-way):**

```
run1: 1  3  8  11
run2: 2  5  7  9
heads compare → emit smaller, advance:
  1<2 → 1 |  3<2? no, 2 → 2 | 3<5 → 3 | 8<5? no,5 →5 | 8<7?no,7→7 | 8<9→8 | 11<9?no,9→9 | 11
merged runA = [1, 2, 3, 5, 7, 8, 9, 11]
```

run3 is left alone this pass (nothing to pair it with), carried forward as runB = [4, 6, 10, 12].

**Pass 2 — merge runA and runB (2-way):**

```
runA: 1  2  3  5  7  8  9  11
runB: 4  6  10 12
emit: 1,2,3, (4<5)4, 5, (6<7)6, 7,8,9, (10<11)10, 11, 12
SORTED = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]   ✓
```

One sorted file. Trace it by hand once and the mechanism sticks: **run formation makes sorted chunks; merging interleaves them, always reading each run front-to-back (sequential) and emitting in order.** Notice we never held more than a handful of elements in memory — never more than `M` — yet we sorted data that (pretend) didn't fit. With a realistic `M/B` of, say, 1000, all 3 runs would merge in a **single** pass instead of two.

---

## Counting the Cost: The Sorting Bound

Add up the I/Os. Each pass — whether run formation or a merge — reads every element once and writes every element once, costing `2·(N/B) = Θ(N/B)` I/Os. The total number of passes is:

```
1 pass  (run formation)  +  ⌈log_{M/B}(N/M)⌉ passes  (merging)
```

Multiply passes by the per-pass cost `Θ(N/B)`:

```
  external merge sort  =  Θ( (N/B) · log_{M/B}(N/B) )   I/Os
```

This is **the** external-memory sorting bound (Aggarwal–Vitter), the same `sort(N)` you met in [the I/O model](../01-the-io-model/junior.md). Read it as a product of two meaningful pieces:

- **`N/B`** — the cost of *one* sequential pass over the data (one `scan(N)`). Passes are the unit of work, and each is a cheap linear sweep.
- **`log_{M/B}(N/B)`** — the **number of passes**, a logarithm whose base is the merge fan-in `M/B`. (We wrote `N/M` inside the log earlier and `N/B` here; they differ only by the constant `M/B` inside the log, which Θ-notation absorbs — both forms are standard.)

The entire performance story is in that base. Compare a naive 2-way merge against a `(M/B)`-way merge:

```
naive 2-way:     (N/B) · log₂(N/M)         ← base 2, MANY passes
external sort:   (N/B) · log_{M/B}(N/B)     ← base M/B (thousands), FEW passes
```

Both are "`N/B` times a logarithm." But `log₂` of a billion is ~30, while `log_{1000}` of a billion is ~3 — a **10× reduction in passes**, hence 10× fewer total I/Os, purely from making the merge wider. This is the same lesson as B-tree search from the I/O model: **make the base of the logarithm large**, and you do it here by merging as many runs at once as memory allows.

> **The headline to remember:** external sort costs `Θ((N/B)·log_{M/B}(N/B))` I/Os, and because the log base `M/B` is large, that's just a **small constant number of sequential passes** over the data — usually 2 or 3, sometimes even fewer.

---

## The 1 TB Example: Only a Couple of Passes

Numbers make the "only a couple of passes" claim land. Sort **1 TB** of data with **8 GB** of RAM. Say each element is 100 bytes (a typical record) and a disk block is 1 MB (a sensible large sequential read/write unit).

```
N (elements)   = 1 TB / 100 B          ≈ 10¹² / 10²  = 10¹⁰ elements
M (elements)   = 8 GB / 100 B          ≈ 8·10⁹ / 10² = 8·10⁷ elements
B (elements)   = 1 MB / 100 B          = 10⁶ / 10²   = 10⁴ elements per block
M/B (fan-in)   = 8·10⁷ / 10⁴           = 8000 blocks fit in memory
```

**Phase 1 — run formation.** `⌈N/M⌉ = ⌈10¹⁰ / (8·10⁷)⌉ = ⌈125⌉ = 125` runs, each 8 GB, written in one pass.

**Phase 2 — merging.** Fan-in `k ≈ M/B = 8000`. We have only 125 runs. Since `125 ≤ 8000`, **a single merge pass** combines all 125 runs at once into one sorted file. Number of merge passes:

```
passes = ⌈log_{M/B}(N/M)⌉ = ⌈log_{8000}(125)⌉ = ⌈0.54⌉ = 1 pass
```

**Total: 1 run-formation pass + 1 merge pass = 2 passes over the data.** That's it. To sort a *terabyte* with *8 gigabytes* of RAM, you read and write the whole dataset just **twice** end-to-end.

What does that cost in wall-clock terms? Two passes means reading 1 TB twice and writing 1 TB twice = 4 TB of sequential disk traffic. At a modest 200 MB/s sequential throughput, that's `4·10⁶ MB / 200 MB/s = 20,000 s ≈ 5.6 hours` — and far less on faster storage. Compare that to the naive "one random I/O per comparison" disaster, which we estimated at *months*. The difference between months and hours is the entire payoff of doing external sort right.

And the fan-in is so generous that even far bigger inputs stay cheap. To force a *second* merge pass, you'd need more than `8000` runs, i.e. `N/M > 8000`, i.e. `N > 8000 · 8 GB = 64 TB`. So with 8 GB of RAM you can sort anything up to **64 TB in just two passes**, and up to `8000² ≈ 64 million` runs — exabytes — in three. **External sort needs only a few passes over the data, no matter how big it gets.** That is the result worth carrying away.

---

## Why Merge, Not Quicksort

We chose *merge* for Phase 2, not quicksort or another in-memory champion. The reason is access pattern, and it's worth making explicit because it's the deepest point in the topic.

**Merging is sequential I/O.** A `k`-way merge reads each run **strictly front-to-back** — you consume run `i`'s block, and when it's empty you fetch the *next* contiguous block of run `i`. Output is written **front-to-back** too. Every disk access is sequential, so you pay the cheap `N/B`-per-pass cost. Sequential access is the friend of disks (and SSDs): it amortizes each transfer over `B` elements and avoids seeks.

**Quicksort's partition is random-ish I/O.** Partitioning walks two pointers inward from the ends of a range and swaps `A[i] ↔ A[j]` at far-apart positions. On disk-resident data those positions are in different blocks, so partitioning scatters its accesses across the whole range — **random I/O**, up to `B`× more transfers than sequential. The recursion does this `log N` times over ranges that (at the top) span the entire dataset. Quicksort's beauty in RAM — in-place, cache-friendly *within* a fitting array — turns into a liability on disk, because "in-place across the disk" means "jumping all over the disk."

```
MERGE (good on disk):           QUICKSORT partition (bad on disk):
  run1: → → → → (sequential)      A: [.....pivot.....]
  run2: → → → → (sequential)          i→            ←j
  out:  → → → → (sequential)          swap A[i]↔A[j] across the whole range
  one I/O serves B elements           → scattered blocks → ~1 I/O per access
```

The general principle, straight from the [I/O model](../01-the-io-model/junior.md): **on slow storage, prefer algorithms whose disk accesses are sequential, even if they look less elegant in the RAM model.** Merge's "read several sorted streams and interleave" is the canonical sequential pattern, which is exactly why every external-sort and big-data system is built on merging, not partitioning. (Internally, when sorting each `M`-sized chunk in Phase 1, quicksort is *perfect* — that chunk fits in memory, so its random accesses are cache/RAM accesses, not disk I/O. Use the right tool at the right level.)

---

## Code: External Merge Sort That Counts Its Passes

Here's a working external merge sort that **simulates** disk with a list of on-disk "runs" (files-in-memory), never holds more than `M` elements at once during the core steps, and **counts passes and I/Os**. It does the two phases explicitly: run formation, then repeated `k`-way merges. Read it to see the bound become code.

### Python

```python
import heapq

def external_merge_sort(data, M, B, verbose=True):
    """
    Sort `data` using at most M elements of 'memory' at a time.
    'Disk' is simulated by a list of runs (each run is a list = a file on disk).
    We count passes and I/Os (block transfers of B elements).
    Returns (sorted_list, passes, ios).
    """
    N = len(data)
    ios = 0
    passes = 0
    k = max(2, M // B - 1)          # merge fan-in: M/B - 1 blocks for inputs

    # ---- PHASE 1: RUN FORMATION ----
    # Read M elements at a time, sort in memory, write back as a sorted run.
    runs = []
    for i in range(0, N, M):
        chunk = data[i:i + M]       # read M (one chunk): M/B block reads
        chunk.sort()                # internal sort — FREE in the I/O model
        runs.append(chunk)          # write the sorted run back: M/B block writes
        ios += 2 * ((len(chunk) + B - 1) // B)   # read blocks + write blocks
    passes += 1
    if verbose:
        print(f"Phase 1: formed {len(runs)} runs of <= {M} elements "
              f"(fan-in k = {k})")

    # ---- PHASE 2: MERGE PASSES ----
    # Repeatedly k-way merge groups of runs until a single run remains.
    while len(runs) > 1:
        next_runs = []
        for i in range(0, len(runs), k):
            group = runs[i:i + k]            # up to k runs merged at once
            merged = list(heapq.merge(*group))  # k-way merge, streaming/sequential
            next_runs.append(merged)
            n = sum(len(r) for r in group)
            ios += 2 * ((n + B - 1) // B)    # read all + write all (one sweep)
        runs = next_runs
        passes += 1
        if verbose:
            print(f"Merge pass {passes - 1}: {len(runs)} run(s) remain")

    result = runs[0] if runs else []
    if verbose:
        print(f"Done. N={N}, M={M}, B={B}: {passes} passes, {ios} I/Os")
    return result, passes, ios


if __name__ == "__main__":
    import random
    # Tiny worked example from this file: N=12, M=4, B=2
    data = [8, 3, 11, 1, 5, 9, 2, 7, 12, 4, 6, 10]
    out, passes, ios = external_merge_sort(data, M=4, B=2)
    print("sorted:", out)
    assert out == sorted(data)

    # Bigger demo: watch passes stay tiny as N grows, because fan-in is large.
    print("\n--- scaling demo (fan-in is large -> few passes) ---")
    for N in (1_000, 100_000, 1_000_000):
        big = [random.randint(0, 10**9) for _ in range(N)]
        _, p, io = external_merge_sort(big, M=10_000, B=100, verbose=False)
        print(f"N={N:>9}: {p} passes, {io:>8} I/Os "
              f"(naive 1-random-IO-per-element would be {N} I/Os)")
```

Running the tiny example prints the 3 runs forming, then the merge passes, then the sorted result. The scaling demo shows the headline: as `N` grows from a thousand to a million, the number of passes barely moves (it stays a small constant), because the fan-in `k = M/B − 1` is large enough to collapse many runs per pass.

### Go

```go
package main

import (
	"container/heap"
	"fmt"
	"math/rand"
	"sort"
)

// --- a tiny min-heap over (value, runIndex) for k-way merge ---
type item struct{ val, run int }
type minHeap []item

func (h minHeap) Len() int            { return len(h) }
func (h minHeap) Less(i, j int) bool  { return h[i].val < h[j].val }
func (h minHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *minHeap) Push(x interface{}) { *h = append(*h, x.(item)) }
func (h *minHeap) Pop() interface{} {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}

func ceilDiv(a, b int) int { return (a + b - 1) / b }

// kWayMerge merges several sorted runs into one, streaming (sequential).
func kWayMerge(runs [][]int) []int {
	h := &minHeap{}
	pos := make([]int, len(runs))
	for r, run := range runs {
		if len(run) > 0 {
			heap.Push(h, item{run[0], r})
		}
	}
	var out []int
	for h.Len() > 0 {
		it := heap.Pop(h).(item)
		out = append(out, it.val)
		pos[it.run]++
		if pos[it.run] < len(runs[it.run]) {
			heap.Push(h, item{runs[it.run][pos[it.run]], it.run})
		}
	}
	return out
}

// externalMergeSort sorts data with <= M elements in memory, counting passes/IOs.
func externalMergeSort(data []int, M, B int, verbose bool) ([]int, int, int) {
	N := len(data)
	ios, passes := 0, 0
	k := M/B - 1
	if k < 2 {
		k = 2
	}

	// PHASE 1: run formation
	var runs [][]int
	for i := 0; i < N; i += M {
		end := i + M
		if end > N {
			end = N
		}
		chunk := append([]int(nil), data[i:end]...) // read M
		sort.Ints(chunk)                            // internal sort — free
		runs = append(runs, chunk)                  // write run
		ios += 2 * ceilDiv(len(chunk), B)
	}
	passes++
	if verbose {
		fmt.Printf("Phase 1: %d runs (fan-in k=%d)\n", len(runs), k)
	}

	// PHASE 2: merge passes
	for len(runs) > 1 {
		var next [][]int
		for i := 0; i < len(runs); i += k {
			end := i + k
			if end > len(runs) {
				end = len(runs)
			}
			group := runs[i:end]
			merged := kWayMerge(group)
			next = append(next, merged)
			n := 0
			for _, r := range group {
				n += len(r)
			}
			ios += 2 * ceilDiv(n, B)
		}
		runs = next
		passes++
		if verbose {
			fmt.Printf("Merge pass %d: %d run(s) remain\n", passes-1, len(runs))
		}
	}

	var result []int
	if len(runs) == 1 {
		result = runs[0]
	}
	if verbose {
		fmt.Printf("Done. N=%d M=%d B=%d: %d passes, %d I/Os\n", N, M, B, passes, ios)
	}
	return result, passes, ios
}

func main() {
	data := []int{8, 3, 11, 1, 5, 9, 2, 7, 12, 4, 6, 10}
	out, _, _ := externalMergeSort(data, 4, 2, true)
	fmt.Println("sorted:", out)

	fmt.Println("\n--- scaling demo ---")
	for _, N := range []int{1000, 100000, 1000000} {
		big := make([]int, N)
		for i := range big {
			big[i] = rand.Intn(1_000_000_000)
		}
		_, p, io := externalMergeSort(big, 10000, 100, false)
		fmt.Printf("N=%9d: %d passes, %8d I/Os\n", N, p, io)
	}
}
```

**What both versions show:** Phase 1 forms `⌈N/M⌉` sorted runs in one pass; Phase 2 repeatedly merges `k = M/B − 1` runs at a time until one remains. The `ios` counter only charges for **block transfers** (`ceilDiv(n, B)` reads + writes per sweep) — the in-memory sorting and comparisons are free, exactly as the I/O model prescribes. Run the scaling demo and you'll see the pass count stay at a small constant as `N` climbs by orders of magnitude: that flat line *is* the `log_{M/B}` bound, with its large base, in action.

---

## Where External Sort Lives in the Real World

This isn't a textbook curiosity — external merge sort is one of the most-used algorithms on the planet, running quietly under systems you touch daily.

| System | How external sort is used |
|--------|---------------------------|
| **GNU `sort` / Unix tools** | Sorting a file bigger than RAM: `sort` forms sorted runs in temp files, then merges them. Tune with `--buffer-size` (that's `M`) and `--batch-size` (the merge fan-in `k`). |
| **Relational databases** | `ORDER BY`, `GROUP BY`, `DISTINCT`, and **sort-merge join** on large tables all use external sort when the data exceeds the sort buffer. The query planner literally budgets `M` (work_mem) and counts passes. |
| **MapReduce / Hadoop / Spark** | The **shuffle** phase sorts mapper output by key using external merge sort so the reducer sees keys in order. Shuffle is often the dominant cost of a big job — and it's external sort. |
| **Building search-engine / database indexes** | Inverting a huge document collection means sorting billions of (term, doc) pairs by term — classic external sort, then a sequential pass to build posting lists. |
| **Log / event processing** | Sorting enormous log files by timestamp before analysis or deduplication; the input dwarfs memory, so it's external by necessity. |

The common shape every time: **the data is bigger than memory, the result must be sorted, and the only affordable way is a few sequential passes of run-formation-then-merge.** Once you recognize external merge sort, you'll spot it everywhere big data meets ordering. And it's the engine behind operations that *reduce to* sorting — joins, grouping, deduplication — so understanding it unlocks a whole layer of how data systems work.

---

## Common Misconceptions

- **"Just use quicksort, it's the fastest sort."** Fastest *in RAM*, where its random accesses are cheap. On disk, partition's scattered swaps become random I/Os — up to `B`× the cost of sequential. External sort uses **merge** for Phase 2 precisely because merging is sequential. (Quicksort is still great *inside* Phase 1, where each chunk fits in memory.)

- **"More passes means external sort is slow."** It's the opposite of slow because there are *so few* passes. The pass count is `log_{M/B}(N/M)` with a **large base** (`M/B` is thousands), so it's typically 2–3 total. A terabyte sorts in two passes with 8 GB of RAM.

- **"You need memory proportional to `N`."** No — you need only `M`, a fixed amount far smaller than `N`. The whole point is sorting `N ≫ M`. Phase 1 holds `M` at a time; Phase 2 holds one block per run plus an output block (`M/B` blocks total). Memory never scales with `N`.

- **"The merge fan-in `k` should be 2, like binary mergesort."** Binary (2-way) merging gives `log₂(N/M)` passes — needlessly many. Merging `M/B − 1` runs at once gives `log_{M/B}(N/M)` passes — far fewer. Big fan-in is the entire optimization; don't throw it away.

- **"Sorting `M` elements in memory costs I/Os."** In the I/O model the internal sort is **free** — it touches only data already in fast memory. You pay I/Os only to read the chunk in and write the run out. The cleverness of the internal sort doesn't change the I/O bound at all.

- **"External sort is unstable / loses ties' order."** Stability is a property of the merge: if your `k`-way merge breaks ties by preferring the earlier run (and runs are processed in order), external merge sort is stable — just like in-memory mergesort. It's a design choice, not an inherent limitation.

---

## Common Mistakes

- **Running an in-memory sort directly on disk-resident data.** Calling `sort()` on an array bigger than RAM either crashes (out of memory) or thrashes (the OS swaps, turning every access into random disk I/O). You must explicitly chunk it — that's what Phase 1 is for.

- **Choosing too small a merge fan-in.** Merging only 2–4 runs at a time when memory could hold a thousand blocks wastes the whole optimization, multiplying your pass count. Size `k` to `M/B − 1` (leaving room for the output block and read-ahead buffers).

- **Forgetting the output buffer (and read-ahead) in the memory budget.** Memory holds `M/B` blocks; you can't use all of them for inputs — at least one must hold the output being written, and good implementations reserve several blocks per run for smooth sequential I/O. So real fan-in is a bit below `M/B`.

- **Making runs that don't fill memory.** If Phase 1 reads only `M/2` at a time, you double the run count and may add a merge pass. Read as close to `M` as your buffers allow so runs are as long as possible (and consider replacement selection to make them even longer).

- **Doing random I/O in the merge.** If your merge seeks back and forth in a run instead of streaming it front-to-back, you've thrown away the sequential advantage. Each run must be consumed strictly in order, refilling its input block from the next contiguous block on disk.

- **Ignoring that the last run/chunk is short.** With `N` not a multiple of `M`, the final run is smaller. Off-by-one handling of that partial chunk is the most common bug in a first implementation — guard your slice bounds.

---

## Cheat Sheet

```
THE PROBLEM
  Sort N elements; only M fit in memory (M << N); rest on disk.
  Cost = block transfers (I/Os) of B elements each. In-memory work = FREE.
  In-memory sorts (quicksort/heapsort) FAIL: random disk access, ~1 I/O per access.

EXTERNAL MERGE SORT — TWO PHASES
  Phase 1  RUN FORMATION:
    read M, sort in memory (any internal sort), write sorted run. Repeat.
    → ⌈N/M⌉ sorted runs.   Cost: 1 sequential pass = 2·(N/B) I/Os.
  Phase 2  MERGE:
    k-way merge with fan-in  k = M/B − 1  (one input block/run + one output block).
    each pass: read all + write all = Θ(N/B) I/Os, cuts #runs by factor ≈ M/B.
    → ⌈log_{M/B}(N/M)⌉ passes until ONE sorted file remains.

TOTAL COST
  sort(N) = Θ( (N/B) · log_{M/B}(N/B) )   I/Os      ← the external sorting bound
          = (1 + few) sequential passes over the data.

WHY MERGE, NOT QUICKSORT
  merge     = SEQUENTIAL I/O (read runs front-to-back) → cheap, ~N/B per pass
  quicksort = RANDOM I/O (partition swaps across the disk) → up to B× worse

NUMBERS THAT STICK  (1 TB data, 8 GB RAM, 100 B/elem, 1 MB block)
  M/B ≈ 8000 runs merge at once. 125 runs → 1 merge pass.
  TOTAL = 2 passes (1 form + 1 merge).  Up to 64 TB still sorts in 2 passes.

THE ONE BIG IDEA
  Make the merge fan-in (M/B) as large as memory allows → log base is huge →
  only a FEW sequential passes. Few passes = fast external sort.
```

---

## Summary

When `N` elements don't fit in `M` memory, every in-memory sort you know breaks — not because of its comparison count, but because of its **access pattern**. Quicksort's partition and heapsort's sifting jump to scattered positions, and on disk each scattered access is a random I/O up to `B`× more expensive than a sequential one. Run them on data bigger than RAM and they do billions of random I/Os — months of work. We need an algorithm that touches the disk **sequentially** and never holds more than `M` elements at once.

- **External merge sort** is that algorithm, in **two phases**. *Run formation:* read `M` elements at a time, sort each gulp in memory with any internal sort, write it back as a sorted **run** — one sequential pass, producing `⌈N/M⌉` runs. *Merging:* repeatedly combine `k = M/B − 1` runs at a time with a `k`-way merge (one input block per run, one output block), each pass cutting the run count by ≈ `M/B`, until a single sorted file remains after `⌈log_{M/B}(N/M)⌉` passes.

- **The cost is `Θ((N/B)·log_{M/B}(N/B))` I/Os** — the external-memory sorting bound. The `N/B` is one cheap sequential pass; the `log_{M/B}` is the number of passes, a logarithm whose **base is the merge fan-in `M/B`**. Because that base is large (thousands of blocks fit in memory), the pass count is tiny.

- **In practice it's just a couple of passes.** Sorting **1 TB with 8 GB of RAM** forms 125 runs, then merges them all in a single 8000-way pass — **2 total passes** over the data. The same 8 GB sorts up to **64 TB** in two passes and exabytes in three. External sort needs only a few sweeps, no matter how big the data.

- **Merge, not quicksort, for Phase 2**, because merging reads each run strictly front-to-back — **sequential I/O**, the disk's friend — while quicksort's partition scatters accesses across the whole dataset. (Quicksort is ideal *inside* Phase 1, where each chunk fits in memory.) The runnable code makes it concrete: it forms runs, merges `k` at a time, and counts passes and I/Os — and the pass count stays a small constant as `N` grows by orders of magnitude.

- **It's everywhere:** GNU `sort`, database `ORDER BY` and sort-merge join, MapReduce/Spark shuffle, log sorting, index building. Anywhere data outgrows memory and must come out ordered, external merge sort is the engine.

The idea to carry forward: when data doesn't fit, **sort it in a few sequential passes** — form memory-sized sorted runs, then merge them as wide as memory allows. Maximize the fan-in, minimize the passes.

**Next steps:** [the middle-level treatment](./middle.md) digs into the details — replacement selection for longer runs, buffer management and double-buffering, the optimal merge pattern (and why naive merging can be suboptimal), and a rigorous derivation of the pass count. For the closely related search structure built on the same `log`-base-`B` insight, see [B-Tree I/O Analysis](../04-b-tree-io-analysis/junior.md). To revisit the cost model underneath everything, return to [The I/O Model](../01-the-io-model/junior.md); and for the internal sorts used as Phase-1 subroutines, browse [Sorting Algorithms](../../07-sorting-algorithms/).

---

## Further Reading

- **Aggarwal & Vitter (1988), "The Input/Output Complexity of Sorting and Related Problems"** — the paper that proved the `Θ((N/B)·log_{M/B}(N/B))` sorting bound and showed external merge sort achieves it. The origin of the result.
- **Donald Knuth, *The Art of Computer Programming, Vol. 3: Sorting and Searching*** — the classic, exhaustive treatment of external sorting, merge patterns, and replacement selection.
- **Vitter, *Algorithms and Data Structures for External Memory*** — the modern survey; external sorting is the centerpiece, with all the practical refinements.
- **GNU coreutils `sort` source and man page** — a real, battle-tested external merge sort; see `--buffer-size` (`M`) and `--batch-size` (merge fan-in).
- **[The I/O Model](../01-the-io-model/junior.md)** — the cost model (`N`, `M`, `B`, block transfers) this whole topic stands on, including the `sort(N)` bound stated abstractly.
- **[B-Tree I/O Analysis](../04-b-tree-io-analysis/junior.md)** — the search-structure cousin, built on the same "make the log base `B`" idea.
- **[Sorting Algorithms](../../07-sorting-algorithms/)** — the internal sorts used to sort each memory-sized chunk in Phase 1.
- **[External Sorting — Middle](./middle.md)** — replacement selection, buffering, optimal merge ordering, and a rigorous pass-count derivation.
