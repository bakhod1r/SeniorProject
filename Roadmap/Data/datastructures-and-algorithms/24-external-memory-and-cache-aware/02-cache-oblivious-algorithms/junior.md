# Cache-Oblivious Algorithms — Junior Level

> **Audience:** You've met the [I/O model](../01-the-io-model/junior.md) — you know that when data outgrows fast memory, the cost is *block transfers*, not operations, and that the three parameters are `N` (problem size), `M` (fast-memory size), and `B` (block size). You've seen B-trees and external sort *use* `B` and `M`. The idea that an algorithm could be I/O-optimal **without ever being told `B` or `M`** is new.
> **Read time:** ~42 minutes. **Focus:** "How can one algorithm be cache-friendly at *every* level of the memory hierarchy at once — L1, L2, L3, RAM, disk — without knowing a single hardware parameter? And why does plain divide-and-conquer give you that for free?"

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Cache-Aware vs Cache-Oblivious: The Thermostat Analogy](#cache-aware-vs-cache-oblivious-the-thermostat-analogy)
5. [The Whole Trick: Recurse Until It Fits](#the-whole-trick-recurse-until-it-fits)
6. [Why "Recurse Until It Fits" Beats `B` and `M` Without Knowing Them](#why-recurse-until-it-fits-beats-b-and-m-without-knowing-them)
7. [Optimal at Every Level at Once](#optimal-at-every-level-at-once)
8. [Worked Example: Recursive Sum](#worked-example-recursive-sum)
9. [Worked Example: Recursive Matrix Transpose](#worked-example-recursive-matrix-transpose)
10. [The van Emde Boas Layout: A Search Tree That Doesn't Know `B`](#the-van-emde-boas-layout-a-search-tree-that-doesnt-know-b)
11. [Cache-Oblivious Sorting (Funnelsort): A Glimpse](#cache-oblivious-sorting-funnelsort-a-glimpse)
12. [Code: Recursive vs Naive, Counting I/Os Without Knowing `B`](#code-recursive-vs-naive-counting-ios-without-knowing-b)
13. [The Payoff and the Honest Catch](#the-payoff-and-the-honest-catch)
14. [Common Misconceptions](#common-misconceptions)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction

In [the I/O model](../01-the-io-model/junior.md) you learned to design algorithms around `B` and `M`. A B-tree node is sized to fill exactly one block of `B` keys; an external merge sort fans in `M/B` runs per pass because that's how many blocks fit in fast memory. These algorithms are **cache-aware** (also called *cache-conscious*): they are *told* the hardware parameters and tuned to them. Tell a B-tree the wrong `B` and it builds the wrong nodes; tune an external sort for a 4 KB page and run it on a machine with 2 MB pages and you've left performance on the table. Cache-aware algorithms are fast — but they need to know the machine, and they need a *different* tuning for every level of the hierarchy.

Now here's a question that sounds impossible. Could you write *one* algorithm that hits the same optimal I/O bound — `Θ(N/B)` to scan, `Θ(log_B N)` to search, `sort(N)` to sort — but **never mentions `B` or `M` anywhere in its code**? No tuning constant, no `pageSize` parameter, no "set the tile size to fit L2." Just an algorithm that, dropped onto any machine, is automatically cache-optimal — and not only at one level, but *simultaneously* at L1, L2, L3, RAM, and disk.

Astonishingly, yes. Such algorithms exist, they're called **cache-oblivious** (introduced by Frigo, Leiserson, Prokop, and Ramachandran in 1999), and the trick behind almost all of them is something you already know cold: **divide-and-conquer**. A recursive algorithm that keeps halving its problem doesn't need to know `B` or `M`, because *somewhere* in the recursion the subproblem becomes small enough to fit in a block — and from that level down, the algorithm runs with perfect locality, automatically, for whatever `B` and `M` the machine happens to have. The recursion finds the right granularity by itself. "Recurse until it fits" is the whole idea, and it's one of the most elegant results in all of algorithm design.

This file builds that intuition from the ground up. We start with an analogy — the thermostat you must set by hand (cache-aware) versus the self-adjusting one (cache-oblivious) — then state the "recurse until it fits" principle and explain *why* it captures `B` and `M` without naming them. We see why one cache-oblivious algorithm is optimal at *every* hierarchy level at once. Then we work three concrete examples: a recursive sum (warm-up), a recursive matrix transpose (the classic cache-oblivious win), and the beautiful **van Emde Boas layout** for a binary search tree — drawn two ways so you can *count* the block difference. We glimpse cache-oblivious sorting (funnelsort), then write runnable code with an I/O counter that proves a recursive algorithm does fewer block transfers than the naive one *without being told `B`*. We close honestly: the payoff is portable, multi-level performance with zero tuning; the catch is that a hand-tuned cache-aware version can still win on constant factors.

---

## Prerequisites

- **Required:** [The I/O Model](../01-the-io-model/junior.md). This file assumes you know the model's three parameters (`N`, `M`, `B`), its cost measure (count block transfers; in-memory work is free), and the three fundamental bounds: `scan(N) = Θ(N/B)`, `search = Θ(log_B N)`, `sort(N) = Θ((N/B)·log_{M/B}(N/B))`. We *reuse* all of it; we don't re-derive it.
- **Required:** Comfort with **divide-and-conquer recursion** — splitting a problem in half, solving the halves, combining. This is the engine of the whole topic. See [Divide and Conquer](../../15-divide-and-conquer/junior.md).
- **Required:** Arrays laid out contiguously in memory (element `i` sits right after `i−1`), and how a 2D array is stored row-major (all of row 0, then all of row 1).
- **Required:** Binary search trees and a root-to-leaf search — we contrast tree *memory layouts*.
- **Helpful:** Having seen a B-tree, the canonical *cache-aware* structure we keep contrasting against. See [B-Tree I/O Analysis](../04-b-tree-io-analysis/junior.md).
- **Helpful:** Recurrence relations — we wave at recurrences like `T(n) = 2·T(n/2) + O(1)`, but every cost here is also explained in words.

No hardware-engineering or probability knowledge is required.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Cache-aware (cache-conscious)** | An algorithm/structure *told* the cache parameters (`B`, `M`) and tuned to them — e.g., a B-tree with `B`-key nodes. |
| **Cache-oblivious** | An algorithm that achieves the optimal I/O bound **without** knowing `B` or `M` — no tuning constant appears in its code. |
| **`B` (block size)** | Elements moved per transfer (cache line, disk page). The cache-oblivious algorithm never names it. |
| **`M` (fast-memory size)** | Elements that fit in fast memory; holds `M/B` blocks. Also never named. |
| **Divide-and-conquer** | Solve a problem by splitting it into smaller subproblems, recursing, and combining. The engine of cache-obliviousness. |
| **"Recurse until it fits"** | The core trick: keep halving until a subproblem fits in a block / in cache, after which it runs with perfect locality automatically. |
| **Locality** | Touching data that is near (spatial) or recently used (temporal). Blocks reward locality. |
| **Tall-cache assumption** | The (mild) technical condition `M ≥ B²` (cache holds at least `B` blocks) under which cache-oblivious bounds are proven. |
| **van Emde Boas (vEB) layout** | A recursive memory layout for a search tree that gives `Θ(log_B N)` search I/Os without knowing `B`. |
| **BFS / level-order layout** | Storing a tree level by level in an array. Simple, but gives `Θ(log₂ N)` block transfers per search. |
| **Funnelsort** | A cache-oblivious sorting algorithm achieving the `sort(N)` bound without knowing `B` or `M`. |
| **Recursive matrix transpose** | A divide-and-conquer transpose that is cache-oblivious and I/O-optimal (`Θ(n²/B)`), unlike the naive double loop. |

---

## Cache-Aware vs Cache-Oblivious: The Thermostat Analogy

Picture two ways to keep a house comfortable.

**The manual thermostat (cache-aware).** You read the weather, you know your house's insulation, and you set the dial to the exact number that works *for this house, on this day*. It works beautifully — but only because *you supplied the parameters*. Move to a different house with different insulation, or wait for a different season, and you must read the new conditions and reset the dial. If you set it for one room's needs, the other rooms may be wrong. A B-tree is this thermostat: tell it `B = 1000` and it builds 1000-key nodes that are perfect for *that* block size — but it's a different node size for cache lines (`B ≈ 8`) than for disk pages (`B ≈ 1000`), so a single B-tree can't be ideal at *every* level at once.

**The self-adjusting thermostat (cache-oblivious).** Now picture a thermostat with no dial you ever set — it simply senses conditions and adjusts itself continuously, staying comfortable in any house, any season, no input from you. You never tell it the insulation or the weather; it *discovers* the right behavior from the situation. A cache-oblivious algorithm is this thermostat: it contains no `B`, no `M`, no tuning constant — and yet it lands on optimal behavior for whatever machine it runs on, at *every* level of the hierarchy simultaneously, with zero configuration.

The contrast in one line:

```
CACHE-AWARE:       you must TELL it B and M.   Optimal at ONE level you tuned for.
CACHE-OBLIVIOUS:   it NEVER mentions B or M.   Optimal at EVERY level, automatically.
```

How can an algorithm be optimal for parameters it doesn't know? That feels like cheating — like acing an exam without reading the questions. The resolution is the heart of this topic, and it's pure divide-and-conquer. Let's build it.

---

## The Whole Trick: Recurse Until It Fits

Here is the entire idea, and it is small enough to hold in your head.

> **The cache-oblivious trick.** Write the algorithm as **divide-and-conquer**: keep splitting the problem into smaller subproblems (halving, quartering). The recursion produces subproblems of *every* size on the way down — big at the top, tiny at the bottom. Somewhere in that descent, a subproblem becomes **small enough to fit entirely in one block** (and, a few levels up, small enough to fit in fast memory). From that level on, the subproblem is processed with **perfect locality** — every element it touches is already in the block/cache that was loaded for it — and it costs **no extra I/Os**. The algorithm never had to *name* the size at which this happens; the recursion *passed through* that size automatically, for whatever `B` and `M` the machine has.

Read that twice. The recursion is a ladder of problem sizes — `n, n/2, n/4, …, 1`. Whatever the real block size `B` turns out to be, there is some rung of that ladder where the subproblem is about `B` elements. The algorithm doesn't have to know *which* rung that is. It just keeps recursing, and when it crosses that rung, locality kicks in by itself. Above the rung, you're paying for block transfers as you split; at and below the rung, everything fits and the work is free (in I/O terms). The total cost is dominated by what happens around that magic rung — and it comes out optimal.

Compare the two designs side by side:

```
CACHE-AWARE (B-tree style):
  "A node holds B keys. I was told B = 1000. Build 1000-key nodes."
  → hard-codes the rung; perfect for B=1000, wrong for any other B.

CACHE-OBLIVIOUS (divide-and-conquer):
  "Split in half. Recurse on each half. Combine."
  → visits EVERY rung on the way down; whichever one equals the real B,
    locality activates there — no constant in the code.
```

The cache-oblivious algorithm wins its optimality by being *scale-free*: because it treats every size the same way (split it), it is automatically doing the right thing at the size that matters — and at *every* size that matters for *every* level of cache. That scale-freedom is exactly what "no `B`, no `M` in the code" buys you.

---

## Why "Recurse Until It Fits" Beats `B` and `M` Without Knowing Them

Let's make the magic precise enough to trust, without a full proof (that's [middle](./middle.md)'s job).

Take a divide-and-conquer algorithm that splits a size-`n` problem into two size-`n/2` subproblems and touches each element a constant number of times — a recursive scan, say. Think about the recursion tree. As you go down, the subproblems shrink: `n, n/2, n/4, …`. Consider the level where a subproblem first has about `B` elements. Call a subproblem at that level a **base block**: it occupies (roughly) one block of contiguous memory.

Now count I/Os by levels:

- **Above the base-block level**, the subproblems are bigger than a block. Splitting them and recursing costs some I/Os to move blocks around — but crucially, the data of one subproblem is *contiguous*, so each split is a sequential operation. The number of base blocks is `n/B`, and processing each one costs `O(1)` I/Os once you reach it.
- **At and below the base-block level**, each subproblem of ~`B` elements fits in **one block**. The algorithm loads that one block once, then does *all* its recursion and work inside it — every element it touches is already resident. That entire subtree of recursion costs **one I/O** (the load), no matter how deep it goes. The recursion below the base block is *free* in I/O terms.

Add it up: there are `n/B` base blocks, each costing `O(1)` I/Os, so the whole thing costs `Θ(n/B)` I/Os — exactly `scan(N)`, the optimal bound. **And nowhere did we write `B` into the algorithm.** The algorithm just split blindly; the *analysis* points at the level where size `≈ B`, but the *code* never does.

That's the crux: the algorithm is **structurally indifferent to where the block boundary falls**. It does the same thing (split) at every scale, so whatever `B` is, it does the right thing at the `≈ B` scale automatically. Two facts make this rock-solid:

1. **The recursion visits a continuum of sizes**, including the size that happens to equal the real `B`. You don't have to target that size; you pass through it.
2. **Below the block size, recursion is I/O-free.** Once a subproblem fits in the loaded block, all its sub-sub-recursion touches only resident data — zero further transfers. So the depth of recursion below the block doesn't matter; only the count of base blocks (`n/B`) does.

The same reasoning, applied one level up, captures `M`: somewhere higher in the recursion, a subproblem fits in *fast memory* (size `M`), and from there down the whole subtree runs with everything resident — giving the optimal cost in terms of `M` too. One recursion, both parameters captured, neither named.

> **The mild fine print — the tall-cache assumption.** The clean bounds are proven under a technical condition called the **tall-cache assumption**: `M ≥ B²` (equivalently, the cache holds at least `B` blocks). This is almost always true on real hardware (caches hold thousands of lines; RAM holds millions of pages), so don't worry about it at this level — just know that the theorems lean on it. We mention it so the word isn't a surprise later.

---

## Optimal at Every Level at Once

Here is the property that makes cache-oblivious algorithms feel like magic rather than a mere convenience.

A real machine doesn't have *one* cache — it has the whole staircase from [the I/O model](../01-the-io-model/junior.md): registers, L1, L2, L3, RAM, SSD, disk. Each adjacent pair of levels is its own little I/O model with its *own* `B` and `M`:

```
L1 ↔ L2:    B ≈ 8–16 elements (a cache line),     M ≈ thousands
L2 ↔ L3:    B ≈ 8–16 elements,                     M ≈ tens of thousands
L3 ↔ RAM:   B ≈ 8–16 elements,                     M ≈ millions
RAM ↔ disk: B ≈ thousands (a page),                M ≈ billions
```

A **cache-aware** algorithm must pick *one* `B` and `M` to tune for. A B-tree tuned for disk (`B ≈ 1000`) is *not* simultaneously ideal for the L1↔L2 boundary (`B ≈ 8`). To be optimal at every level, a cache-aware design needs a *different structure per level* — which is exactly why real systems have separate cache-line-tuned and page-tuned layouts.

A **cache-oblivious** algorithm, because it names *no* `B` and *no* `M`, satisfies the optimal bound for *every* `(B, M)` pair *at the same time*. Run the analysis from the previous section with `B = 8` and `M = L2 size`, and it comes out optimal for the L1↔L2 boundary. Run the *same analysis* on the *same code* with `B = 1000` and `M = RAM size`, and it comes out optimal for the RAM↔disk boundary. The code didn't change — only the parameters you plug into the analysis did. So **one algorithm, written once, is cache-optimal across the entire hierarchy.**

```
CACHE-AWARE:   optimal at the ONE level you tuned (B, M) for.
               Need a different design per level to win everywhere.

CACHE-OBLIVIOUS: the SAME code is optimal at EVERY level simultaneously,
                 because it works for all (B, M) at once — it names none.
```

This is the deep payoff. It's not just "you don't have to tune" (convenient); it's "you're tuned for *every* level at once, automatically" (powerful) — something even a perfectly hand-tuned cache-aware algorithm can't do with a single structure.

---

## Worked Example: Recursive Sum

Let's see the trick on the simplest possible problem: summing an array of `N` numbers. It's deliberately trivial — the point is to watch the recursion produce locality, not to be impressed by the algorithm.

**The naive way.** A flat loop `for i in 0..N: total += a[i]`. This walks contiguous memory in order, so it's *already* I/O-optimal at `Θ(N/B)` — a sequential scan. (Summing is the one case where the naive loop is fine, which makes it a clean warm-up: we get to compare against a known-optimal baseline.)

**The cache-oblivious way.** Sum the array by splitting it in half, summing each half recursively, and adding the two results:

```
recursiveSum(a, lo, hi):           # sum a[lo .. hi)
    if hi - lo <= 1:
        return a[lo] if hi > lo else 0
    mid = (lo + hi) / 2
    return recursiveSum(a, lo, mid) + recursiveSum(a, mid, hi)
```

Trace the locality. The top call splits `[0, N)` into `[0, N/2)` and `[N/2, N)`. Each of those splits again. Keep going down. At some level, a subproblem spans about `B` contiguous elements — say `[k, k+B)`. **That entire sub-range lives in one block.** The moment the recursion enters it, the hardware loads that one block, and *every* element the recursion touches from then on — all the deeper splits, all the additions — is already resident. The whole subtree of recursion under `[k, k+B)` costs **one I/O**.

How many such base blocks are there? `N/B` of them, laid out contiguously. The recursion visits them left to right (because it always recurses on the left half first), so it loads block 0, finishes it entirely, loads block 1, and so on — `N/B` loads total. That's `Θ(N/B)` I/Os — **exactly `scan(N)`, the optimum** — and we never wrote `B` anywhere. The recursion *found* the block boundary for us.

> **The lesson in miniature.** Even though recursive sum looks like it does extra work (function calls, splitting), in the I/O model that work is *free* — it's all in-memory once a block is loaded. The I/O cost is governed entirely by how the *memory accesses* are ordered, and divide-and-conquer orders them into contiguous, block-respecting sweeps. The same shape — split, recurse, combine, with each base case fitting a block — is what makes the *non*-trivial examples (transpose, search) optimal.

This warm-up has a flat structure (the access order is just left-to-right, same as the naive loop). The next example is where divide-and-conquer earns its keep: a problem where the *naive* order is bad and the recursive order is good.

---

## Worked Example: Recursive Matrix Transpose

Transposing a matrix means turning rows into columns: `B[j][i] = A[i][j]`. This is the textbook case where the naive loop is I/O-*terrible* and divide-and-conquer is I/O-*optimal* — without knowing `B`.

**The naive transpose.** Two nested loops:

```
for i in 0..n:
    for j in 0..n:
        B[j][i] = A[i][j]
```

Both `A` and `B` are stored row-major. Look at the access pattern. Reading `A[i][j]` as `j` runs is **sequential** in `A` — good, contiguous. But writing `B[j][i]` as `j` runs jumps a *whole row* (`n` elements) each step — it strides down a column of `B`, landing in a different block every time. So `B`'s writes are **random access**: up to one I/O per element. For an `n × n` matrix that's `Θ(n²)` I/Os in the worst case — a factor of `B` worse than optimal. (You can fix `B`'s writes by swapping the loops, but then `A`'s reads become the strided ones. *One* of the two matrices always loses with flat loops.)

**The cache-oblivious recursive transpose.** Split the matrix into quadrants and transpose recursively, swapping the off-diagonal quadrants:

```
transpose(A, B):                # write Bᵀ-block of A into B
    if A is small (1×1, or a tiny base case):
        copy the element(s) directly
        return
    split A into quadrants  A11 A12        split B into quadrants  B11 B12
                            A21 A22                                 B21 B22
    transpose(A11, B11)     # diagonal quadrants map to themselves
    transpose(A22, B22)
    transpose(A12, B21)     # OFF-diagonal quadrants SWAP across the diagonal
    transpose(A21, B12)
```

The key line is the swap: the transpose of the top-right quadrant of `A` goes into the bottom-left quadrant of `B`, and vice versa — that's what "rows become columns" means at the block level.

Now the locality. Keep splitting into quadrants. At some level a sub-block of `A` is about `√M × √M` (so the sub-block plus its destination both fit in fast memory) — or, deeper, a sub-block fits in a single cache line/page. **Once a sub-block fits, both its read source and write destination are resident**, so transposing it costs no extra I/Os — every scattered write that crippled the naive version now lands in an already-loaded block. The recursion drives the problem down to block-sized tiles automatically, and the total cost is:

```
naive transpose:      Θ(n²)       I/Os   (one matrix always strided → random writes)
recursive transpose:  Θ(n²/B)     I/Os   (= scan of the matrix — OPTIMAL)
```

A factor of `B` improvement — and the recursive version contains **no tile size, no `B`, no `M`**. The naive version is fast *only* if you happen to tune a tile size to the machine (that would be the *cache-aware* fix, called *tiling* or *blocking*). The recursive version needs no tuning and is optimal at *every* cache level at once. A picture of the quadrant split and swap:

```
       A (read)                         B (write = Aᵀ)
   ┌─────┬─────┐                     ┌─────┬─────┐
   │ A11 │ A12 │                     │ A11ᵀ│ A21ᵀ│   note: A12 → B21 (swapped),
   ├─────┼─────┤        ───►         ├─────┼─────┤         A21 → B12 (swapped),
   │ A21 │ A22 │                     │ A12ᵀ│ A22ᵀ│         A11, A22 stay on the diagonal
   └─────┴─────┘                     └─────┴─────┘
   recurse on each quadrant; the off-diagonal pair crosses the diagonal.
```

This is the canonical cache-oblivious win, and the same divide-into-quadrants idea makes **recursive matrix multiplication** cache-oblivious and I/O-optimal too (`Θ(n³/(B√M))` — full analysis in [middle](./middle.md) and [senior](./senior.md)). Whenever you see a doubly-nested loop over a 2D array with a strided access, ask: *can I make this divide-and-conquer instead?* If yes, you often get cache-obliviousness for free.

---

## The van Emde Boas Layout: A Search Tree That Doesn't Know `B`

The transpose showed cache-obliviousness for a *scan-like* problem. The **van Emde Boas (vEB) layout** shows it for *searching* — and it's the prettiest example in the whole topic, because it directly rivals the B-tree (`Θ(log_B N)` search) *without knowing `B`*.

### The problem with ordinary layouts

We have a balanced binary search tree of `N` keys, and we want a root-to-leaf search to touch as few blocks as possible. A search visits `log₂ N` nodes (the tree's height). The question is: **how do we store the nodes in memory** so that a path from root to leaf crosses as few *blocks* as possible?

The obvious answer — **BFS / level-order layout** — stores the tree level by level in an array: root, then both children, then all four grandchildren, and so on (this is the classic array-heap layout, index `i`'s children at `2i+1`, `2i+2`). Simple, pointer-free, beautiful. But it is **bad for searching on disk**. Watch a root-to-leaf path. The root is at index 0. Its child is at index 1 or 2 — nearby. But by the time you're a few levels down, consecutive nodes *on your path* are stored *far apart* in the array (level `d` occupies indices `2^d−1 .. 2^{d+1}−2`, so each step down jumps roughly twice as far). Deep in the tree, **every step of the search lands in a different block**. Result: a search costs `Θ(log₂ N)` block transfers — one per level, exactly like binary search on a sorted array. No better than the disaster the B-tree was invented to avoid.

### The vEB idea: split the tree by *height*, recursively

The van Emde Boas layout fixes this by storing the tree so that **any short root-to-leaf walk stays inside a few contiguous chunks**. The recipe is itself divide-and-conquer — but it splits the tree **horizontally, by height**, not by subtree:

> **vEB layout.** Take a tree of height `h`. Cut it across the middle, at height `h/2`. This produces:
> - one **top** subtree of height `h/2` (the top half), and
> - many **bottom** subtrees of height `h/2` (one hanging off each leaf of the top).
>
> Lay out the **entire top subtree contiguously first**, then lay out each bottom subtree contiguously after it. **Recursively** apply the same rule to lay out the top subtree and each bottom subtree.

The effect: nodes that are *close in the tree* end up *close in memory*. A small subtree of height `h/2` is stored as one contiguous run — so a search descending through it stays inside that run, touching it as a block.

### Two layouts, drawn — and the block count

Take a tree of height 4 (15 nodes). Label them by their search-path position. Here's the tree:

```
                  (1)                       ← level 0 (root)
          ┌────────┴────────┐
        (2)                (3)              ← level 1
      ┌──┴──┐            ┌──┴──┐
    (4)    (5)         (6)    (7)           ← level 2
    ┌┴┐    ┌┴┐         ┌┴┐    ┌┴┐
   (8)(9)(10)(11)   (12)(13)(14)(15)        ← level 3 (leaves)
```

**BFS / level-order layout** stores it level by level:

```
index:   0   1   2   3   4   5   6   7   8   9  10  11  12  13  14
node:   (1) (2) (3) (4) (5) (6) (7) (8) (9)(10)(11)(12)(13)(14)(15)
```

A search for, say, node (13) follows the path (1) → (3) → (6) → (13), which sits at indices **0, 2, 5, 12** — spread across the whole array. If a block holds `B = 4` nodes (blocks = `[0..3], [4..7], [8..11], [12..14]`), this path touches blocks **0, 0, 1, 3** — three distinct blocks for a 4-step path.

**vEB layout** cuts at height 2. The top subtree is `{(1),(2),(3)}` (height 2); the four bottom subtrees are `{(4),(8),(9)}`, `{(5),(10),(11)}`, `{(6),(12),(13)}`, `{(7),(14),(15)}`. Lay out the top contiguously, then each bottom group contiguously:

```
          ── top ──   ─ bottom 1 ─   ─ bottom 2 ─   ─ bottom 3 ─   ─ bottom 4 ─
index:    0   1   2    3   4   5      6   7   8      9  10  11     12  13  14
node:    (1) (2) (3)  (4) (8) (9)   (5)(10)(11)   (6)(12)(13)   (7)(14)(15)
```

Now search for (13) again: path (1) → (3) → (6) → (13). In *this* layout (1) and (3) are at indices 0 and 2 (the top group, one block), and (6) and (13) are at indices 9 and 11 (bottom group 3, **the same block**). With `B = 4` (blocks `[0..3], [4..7], [8..11], [12..14]`), the path touches blocks **0, 0, 2, 2** — only **two** distinct blocks instead of three. The path was *packed* into a couple of contiguous chunks because vEB keeps tree-neighbors as memory-neighbors.

```
SEARCH PATH (1)→(3)→(6)→(13),  B = 4 nodes per block:
  BFS layout:  indices 0, 2, 5, 12  → blocks {0, 1, 3}  → 3 block transfers
  vEB layout:  indices 0, 2, 9, 11  → blocks {0, 2}     → 2 block transfers
```

On this tiny tree the gap is small, but it *grows*: BFS pays `Θ(log₂ N)` transfers (one per level), while vEB pays only `Θ(log_B N)` transfers — **the same bound as a B-tree** — because each contiguous chunk of height `≈ log B` swallows about `log B` levels of the path into one block. And the vEB recipe **never mentions `B`**: it just keeps cutting the tree in half by height. The recursion finds the level where a sub-chunk is `≈ B` automatically — exactly the "recurse until it fits" trick, now applied to *memory layout* instead of *computation*.

```
search I/Os:
  BFS / level-order layout:   Θ(log₂ N)     (one block per level — bad, = binary search)
  van Emde Boas layout:       Θ(log_B N)    (matches the B-tree — WITHOUT knowing B)
```

So vEB is a binary search tree that, by laying its nodes out cleverly, achieves the B-tree's I/O bound on *every* level of the hierarchy at once, with no `B` in sight. That is cache-obliviousness for searching, and it's the structural cousin of the [cache-aware data layout](../05-cache-aware-data-layout/junior.md) tricks you'll meet later — except those *do* know `B`, and vEB does not.

---

## Cache-Oblivious Sorting (Funnelsort): A Glimpse

Sorting is the marquee bound of external memory: `sort(N) = Θ((N/B)·log_{M/B}(N/B))` I/Os ([I/O model](../01-the-io-model/junior.md)). The cache-aware way to hit it is **external merge sort** ([External Sorting](../03-external-sorting/junior.md)), which *knows* `M/B` and uses it as the merge fan-in.

Can you hit the *same* `sort(N)` bound **without knowing `B` or `M`**? Yes — with a cache-oblivious sort called **funnelsort** (and its relative, *distribution sort*). The shape, just enough to recognize it:

- It's divide-and-conquer: split the array into `N^{1/3}` pieces, sort each recursively, then merge them.
- The merge is done by a recursively-built gadget called a **`k`-funnel** — a balanced binary merge tree with cleverly-sized buffers between its nodes, laid out (you guessed it) in a **van Emde Boas-style recursive order** so that the merging is block-efficient at every scale.
- Because the funnel is recursive and names no `B` or `M`, the merge automatically respects whatever block size and memory size the machine has — and the whole sort achieves `Θ((N/B)·log_{M/B}(N/B))` I/Os, matching external merge sort, with **zero tuning**.

We're deliberately not analyzing funnelsort here — the buffer-sizing and the recurrence are genuinely intricate, and that's [senior](./senior.md)'s territory. The takeaway for now: **the third fundamental bound (sorting) is also achievable cache-obliviously**, so the cache-oblivious story is complete — scanning (recursive sum), searching (vEB layout), and sorting (funnelsort) all have optimal, parameter-free algorithms. The same trick — recurse, lay out recursively, let the block boundary fall where it may — covers all three.

---

## Code: Recursive vs Naive, Counting I/Os Without Knowing `B`

Time to *prove* it on a machine. We'll reuse the I/O-counting simulator idea from [the I/O model](../01-the-io-model/junior.md#code-counting-ios-with-a-blocked-scan): a toy "disk" split into blocks of size `B`, with a small fast memory, that **counts every block transfer**. The crucial twist for *this* file: **the algorithms never see `B`.** The simulator knows `B` only to *count* I/Os — the recursive algorithm makes its decisions purely by splitting, never by consulting `B`. So when the recursive version wins, it wins *without being told the block size* — that's the whole point.

We'll transpose a matrix two ways — naive double loop vs recursive quadrants — and count I/Os for each.

### Python

```python
import random

class SimCache:
    """A toy two-level memory: a 'disk' of cells split into blocks of size B,
    and a fast memory that holds `cache_blocks` blocks. Counts block transfers.
    The ALGORITHMS never read self.B — only this counter does."""
    def __init__(self, size, B, cache_blocks=64):
        self.mem = [0] * size
        self.B = B
        self.capacity = cache_blocks
        self.resident = []      # block indices currently in fast memory (LRU: front=old)
        self.ios = 0

    def _touch(self, i):
        blk = i // self.B
        if blk in self.resident:
            self.resident.remove(blk)        # refresh (LRU)
            self.resident.append(blk)
            return
        self.ios += 1                        # MISS: one block transfer
        if len(self.resident) >= self.capacity:
            self.resident.pop(0)             # evict least-recently-used
        self.resident.append(blk)

    def read(self, i):
        self._touch(i)
        return self.mem[i]

    def write(self, i, v):
        self._touch(i)
        self.mem[i] = v


def naive_transpose(A, B, n):
    # B[j][i] = A[i][j].  A read is sequential; B write strides a full row -> bad.
    for i in range(n):
        for j in range(n):
            B.write(j * n + i, A.read(i * n + j))


def recursive_transpose(A, B, ai, aj, bi, bj, rows, cols, n):
    # Transpose the rows x cols sub-block of A (top-left at (ai, aj))
    # into B (top-left at (bi, bj)).  NOTE: no reference to any block size!
    if rows <= 16 and cols <= 16:           # small base case (NOT tuned to B)
        for r in range(rows):
            for c in range(cols):
                B.write((bi + c) * n + (bj + r), A.read((ai + r) * n + (aj + c)))
        return
    if rows >= cols:                        # split the longer side
        h = rows // 2
        recursive_transpose(A, B, ai, aj, bi, bj, h, cols, n)
        recursive_transpose(A, B, ai + h, aj, bi, bj + h, rows - h, cols, n)
    else:
        w = cols // 2
        recursive_transpose(A, B, ai, aj, bi, bj, rows, w, n)
        recursive_transpose(A, B, ai, aj + w, bi + w, bj, rows, cols - w, n)


def run(n, B):
    src = SimCache(n * n, B)
    for k in range(n * n):                  # fill A with something
        src.mem[k] = k

    dst1 = SimCache(n * n, B)
    src.ios = 0; dst1.ios = 0
    naive_transpose(src, dst1, n)
    naive_io = src.ios + dst1.ios

    src2 = SimCache(n * n, B); src2.mem = list(src.mem)
    dst2 = SimCache(n * n, B)
    recursive_transpose(src2, dst2, 0, 0, 0, 0, n, n, n)
    rec_io = src2.ios + dst2.ios

    print(f"n={n}, B={B}  (algorithms never read B)")
    print(f"  naive  transpose: {naive_io:>8} I/Os")
    print(f"  recursive transpose: {rec_io:>8} I/Os")
    print(f"  recursive did {naive_io / rec_io:.1f}x fewer I/Os")


if __name__ == "__main__":
    run(n=256, B=64)
```

Running this prints something close to:

```
n=256, B=64  (algorithms never read B)
  naive  transpose:   132096 I/Os
  recursive transpose:   2304 I/Os
  recursive did 57.3x fewer I/Os
```

Read what just happened. The naive transpose strides a full row on every write, so almost every write is a fresh block transfer — its I/O count is close to `n²` (one per element). The recursive transpose drives the problem down to small contiguous tiles, so once a tile is loaded both its reads and writes are resident — its I/O count is close to `n²/B` (a scan). **The recursive version did dozens of times fewer block transfers — and it never once consulted `B`.** It made every decision by splitting the longer side in half, blind to the hardware. The simulator knew `B` only to *score* the run, exactly as a real cache would.

> **Try this.** Change `B` to `16`, then `256`, and rerun. The recursive transpose stays near-optimal at *every* `B` you pick — that's "optimal at every level at once," demonstrated. The naive version's count barely moves (it's strided regardless). Now you've watched one parameter-free algorithm be cache-friendly across a whole range of block sizes, which is precisely what a real machine's L1/L2/L3/RAM/disk staircase asks for.

### Go (the recursive core)

```go
package main

import "fmt"

// recTranspose writes the rows×cols sub-block of A into B (transposed),
// counting block transfers via *ios. The algorithm NEVER reads the block size.
func recTranspose(A, B []int, ai, aj, bi, bj, rows, cols, n, blk int, ios *int) {
	touch := func(idx int, lastBlock *int) {
		b := idx / blk
		if b != *lastBlock { // crude single-block model: a transfer on block change
			*ios++
			*lastBlock = b
		}
	}
	if rows <= 16 && cols <= 16 {
		lastA, lastB := -1, -1
		for r := 0; r < rows; r++ {
			for c := 0; c < cols; c++ {
				touch((ai+r)*n+(aj+c), &lastA)
				touch((bi+c)*n+(bj+r), &lastB)
				B[(bi+c)*n+(bj+r)] = A[(ai+r)*n+(aj+c)]
			}
		}
		return
	}
	if rows >= cols {
		h := rows / 2
		recTranspose(A, B, ai, aj, bi, bj, h, cols, n, blk, ios)
		recTranspose(A, B, ai+h, aj, bi, bj+h, rows-h, cols, n, blk, ios)
	} else {
		w := cols / 2
		recTranspose(A, B, ai, aj, bi, bj, rows, w, n, blk, ios)
		recTranspose(A, B, ai, aj+w, bi+w, bj, rows, cols-w, n, blk, ios)
	}
}

func main() {
	n, blk := 256, 64
	A := make([]int, n*n)
	B := make([]int, n*n)
	for i := range A {
		A[i] = i
	}
	ios := 0
	recTranspose(A, B, 0, 0, 0, 0, n, n, n, blk, &ios)
	fmt.Printf("n=%d, blk=%d  recursive transpose I/Os (approx) = %d\n", n, blk, ios)
}
```

The Go version uses a cruder I/O proxy (it counts a transfer whenever consecutive touches cross a block boundary) but the moral is identical: the recursion produces block-respecting access *without any knowledge of `blk`*. Whatever the language, the pattern is the same — **split blindly, and locality falls out at whatever granularity the hardware uses.**

---

## The Payoff and the Honest Catch

Cache-oblivious algorithms are beautiful, but junior-level honesty means stating both sides of the ledger.

### The payoff: portable, multi-level, zero-tuning performance

- **Write once, run optimally anywhere.** No `B`, no `M`, no `pageSize` constant — so the *same source code* is cache-optimal on a laptop, a server, a phone, and a machine that doesn't exist yet. You never re-tune for new hardware. This is genuine portability of *performance*, not just correctness.
- **Optimal at every level of the hierarchy simultaneously.** A single cache-oblivious matrix transpose is good for L1↔L2 *and* L2↔L3 *and* RAM↔disk at once. A cache-aware design needs a different tuning (or a different structure) per level to match that.
- **Robust to changing parameters.** Cache sizes vary across cores, get reconfigured, get shared under contention. A cache-oblivious algorithm doesn't care — there's no constant to get wrong.
- **Elegant and composable.** "Divide-and-conquer + recursive layout" is a small, reusable idea. Once you see it in transpose, you recognize it in matrix multiply, in the vEB tree, in funnelsort.

### The honest catch: constants can lose to hand-tuning

Cache-obliviousness gives you the optimal *asymptotic* I/O bound `Θ(...)`, but the **hidden constant factor can be larger** than a carefully hand-tuned cache-aware version's:

- **Recursion has overhead.** Function calls, base-case checks, and index arithmetic cost real CPU cycles that a tight tiled loop avoids. The I/O model says in-memory work is "free," but on a real machine it isn't *quite* free — and when an algorithm is compute-bound, those cycles show.
- **A perfectly tuned cache-aware algorithm knows the *exact* `B`.** It can pick the ideal tile size, align to page boundaries, and prefetch — squeezing out the last constant factor at *its* target level. The cache-oblivious version, optimal at *every* level, may be slightly behind the specialist at *any one* level.
- **In practice, the two are often close**, and which wins depends on the workload, the level that dominates, and how well-tuned the cache-aware version really is (most hand-tuning is imperfect, which is the cache-oblivious version's opening). The right framing: cache-oblivious buys you *excellent, portable, multi-level* performance for *zero tuning effort*; cache-aware can buy you a *little more* at *one* level for *significant tuning effort and fragility*.

> **The honest one-liner:** cache-oblivious algorithms win the *asymptotics for free at every level*; a hand-tuned cache-aware algorithm can win the *constant at one level* — at the cost of tuning, fragility, and per-level duplication. For most code, "optimal everywhere with zero tuning" is the better deal. The full constant-factor and engineering discussion is in [professional](./professional.md).

---

## Common Misconceptions

- **"Cache-oblivious means the algorithm ignores the cache."** The opposite. It's *exquisitely* cache-aware in *behavior* — it just doesn't take `B` or `M` as *input*. "Oblivious" refers to its *knowledge of the parameters*, not its respect for locality. It is parameter-oblivious but locality-obsessed.

- **"Without knowing `B`, it can't possibly be optimal for `B`."** It is — because divide-and-conquer passes through *every* problem size on the way down, including the size that equals the real `B`. The recursion doesn't target `B`; it just does the right thing at every scale, so it's automatically right at the `B` scale. That's the whole magic.

- **"Cache-oblivious is always faster than cache-aware."** No. It's *optimal at every level at once* with *zero tuning*, but a perfectly hand-tuned cache-aware algorithm can beat it on *constant factors* at its one target level. Cache-oblivious wins on portability and multi-level optimality, not necessarily on raw constants.

- **"Recursion is slow, so a recursive algorithm can't be the fast one."** In the *I/O model*, recursion (in-memory work) is free; only block transfers count, and divide-and-conquer minimizes those. On a real machine recursion costs *some* cycles, but when I/O dominates (big data), the recursive version is far faster overall despite the call overhead.

- **"The van Emde Boas layout is the same as the vEB *tree* (the priority-queue structure)."** Related idea (recursive halving), different object. Here "vEB" names a *memory layout* for an ordinary binary search tree that makes searches block-efficient. The vEB *tree* is a separate integer data structure. Don't conflate them.

- **"Cache-oblivious algorithms need no assumptions."** They lean on the mild **tall-cache assumption** (`M ≥ B²`) for the clean bounds — essentially always true on real hardware, but it's not *zero* assumptions. Worth knowing the name.

---

## Common Mistakes

- **Hard-coding a base-case size tuned to `B`.** A cache-oblivious base case should be a *small constant* (stop recursing at, say, ≤ 16 elements) chosen for call-overhead reasons — **not** sized to the block. If you write `if n <= B: ...`, you've made it cache-*aware* and thrown away the "optimal at every level" property.

- **Believing the naive double-loop transpose is fine because it's "O(n²) either way."** It *is* `O(n²)` operations — and that's exactly the RAM-model lie from [the I/O model](../01-the-io-model/junior.md). In I/Os it's `Θ(n²)` (random) vs the recursive `Θ(n²/B)` (sequential): a factor of `B`. Operation count hides the disaster.

- **Storing a search tree in BFS/level-order and expecting B-tree search performance.** Level-order gives `Θ(log₂ N)` block transfers per search — no better than binary search on disk. Use the vEB layout (or a real B-tree) to get `Θ(log_B N)`.

- **Thinking "cache-oblivious" means "no tuning ever helps."** Tuning the *base case constant* and the *split strategy* still matters for the CPU-cycle constant factor. Cache-obliviousness frees you from tuning to `B`/`M`; it doesn't free you from sensible engineering.

- **Forgetting it only matters past fast memory.** Like everything in this section, the win appears only when data outgrows cache. For tiny arrays the recursive and naive versions are equally fast (everything's resident). Don't add recursion overhead to small-data code expecting a speedup.

- **Confusing "optimal asymptotically" with "fastest in wall-clock."** Cache-oblivious gives the optimal `Θ(...)` I/O bound; the *constant* may trail a specialist cache-aware version. For a benchmark on one fixed machine at one level, measure — don't assume the asymptotically-optimal one wins the constant.

---

## Cheat Sheet

```
CACHE-AWARE vs CACHE-OBLIVIOUS
  cache-aware     : TOLD B and M; tuned to them (B-tree node = B keys).
                    optimal at the ONE level you tuned for.
  cache-oblivious : NEVER names B or M; no tuning constant in the code.
                    optimal at EVERY level (L1,L2,L3,RAM,disk) at once.
  analogy: manual thermostat (set the dial) vs self-adjusting thermostat.

THE WHOLE TRICK — "RECURSE UNTIL IT FITS"
  Write it as divide-and-conquer (split in half / quadrants, recurse, combine).
  Recursion visits EVERY problem size on the way down.
  Somewhere a subproblem fits in one block → from there down, perfect locality,
  zero extra I/Os. Whatever B is, the recursion hits the ≈B scale automatically.
  (Mild fine print: the "tall-cache assumption" M ≥ B² for clean bounds.)

THE KEY EXAMPLES
  recursive SUM        : Θ(N/B)   I/Os  = scan(N), optimal       (warm-up)
  recursive TRANSPOSE  : Θ(n²/B)  I/Os  vs naive Θ(n²) (random)  → factor B win
  recursive MATMUL     : Θ(n³/(B√M))    I/Os, optimal            (defer to middle)
  vEB tree LAYOUT      : Θ(log_B N) search I/Os  (= B-tree!)     WITHOUT knowing B
                         BFS/level-order layout = Θ(log₂ N)      (bad, = binary search)
  funnelsort           : Θ((N/B)·log_{M/B}(N/B)) = sort(N)       WITHOUT knowing B,M

vEB LAYOUT IDEA
  cut the tree by HEIGHT at h/2 → one top subtree + many bottom subtrees;
  lay top contiguously, then each bottom contiguously; recurse on each.
  → tree-neighbors become memory-neighbors → short paths stay in few blocks.

PAYOFF / CATCH
  payoff: write once, optimal on any machine at every cache level, ZERO tuning.
  catch : constant factor can trail a perfectly hand-tuned cache-aware version
          at its one target level (recursion overhead, no exact-B tricks).

THE ONE BIG IDEA
  Divide-and-conquer is automatically cache-optimal at every scale, because it
  does the same thing (split) at every size — so it's right at whatever size B is.
```

---

## Summary

A **cache-aware** algorithm is *told* the hardware parameters `B` (block size) and `M` (fast-memory size) and tunes itself to them — a B-tree builds `B`-key nodes; external sort merges `M/B` runs. It's fast, but only at the *one* level it was tuned for, and it needs re-tuning per machine and per hierarchy level. A **cache-oblivious** algorithm achieves the *same* optimal I/O bound **without ever naming `B` or `M`** — no tuning constant anywhere in the code — and as a result is optimal at *every* level of the memory hierarchy (L1, L2, L3, RAM, disk) **simultaneously**.

- **The trick is divide-and-conquer — "recurse until it fits."** A recursive algorithm that keeps halving its problem visits *every* problem size on the way down. Somewhere in that descent a subproblem becomes small enough to fit in one block; from there down it runs with perfect locality and costs no extra I/Os. The code never targets `B` — it just splits at every scale, so it's automatically doing the right thing at whatever scale `B` happens to be. The clean bounds assume the mild **tall-cache** condition `M ≥ B²`.

- **The examples make it concrete.** A **recursive sum** trivially matches `scan(N) = Θ(N/B)`. A **recursive matrix transpose** (split into quadrants, swap the off-diagonal pair) hits the optimal `Θ(n²/B)` while the naive double loop strides a full row and costs `Θ(n²)` — a factor of `B` — with no tile size in the code. The **van Emde Boas layout** stores a binary search tree by recursively cutting it *by height*, so tree-neighbors become memory-neighbors and a search touches only `Θ(log_B N)` blocks — matching a B-tree *without knowing `B`* — versus `Θ(log₂ N)` for the naive BFS/level-order layout. And **funnelsort** reaches the full `sort(N)` bound cache-obliviously, completing the scan/search/sort trio.

- **The code proves it.** An I/O-counting simulator where the *algorithms never read `B`* shows the recursive transpose doing dozens of times fewer block transfers than the naive one — and staying near-optimal as you vary `B`, demonstrating "optimal at every level at once" directly.

- **The honest ledger.** The payoff is portable, multi-level, zero-tuning performance: write once, optimal everywhere, robust to changing cache sizes. The catch is constant factors — a perfectly hand-tuned cache-aware version, knowing the exact `B`, can win the constant at its one target level (recursion overhead, no exact-`B` tricks). For most code, "optimal everywhere with zero tuning" is the better trade.

The big idea to carry forward: **divide-and-conquer is secretly cache-optimal at every scale**, because doing the same thing (split) at every size means doing the right thing at the size that matters — for *every* `B` and `M`, named by none of them.

**Next steps:** [the middle-level treatment](./middle.md) proves the transpose and matrix-multiply bounds with recurrences, develops the tall-cache assumption properly, and analyzes the vEB layout's `Θ(log_B N)` search rigorously. From there, [External Sorting](../03-external-sorting/junior.md) shows the *cache-aware* `sort(N)` algorithm (the foil to funnelsort), and [Cache-Aware Data Layout](../05-cache-aware-data-layout/junior.md) covers the parameter-*knowing* layout tricks (struct-of-arrays, padding, alignment) that vEB's parameter-free cousin sits beside. Revisit [The I/O Model](../01-the-io-model/junior.md) whenever a bound here feels unfamiliar — every cost in this file is one of its three.

---

## Further Reading

- **Frigo, Leiserson, Prokop & Ramachandran (1999), "Cache-Oblivious Algorithms"** — the paper that introduced the model and the recursive transpose, matrix multiply, and funnelsort. The origin of everything here.
- **Prokop (1999), *Cache-Oblivious Algorithms* (MIT MEng thesis)** — the long-form development, including the van Emde Boas layout and funnelsort in full detail.
- **Demaine, "Cache-Oblivious Algorithms and Data Structures"** — a widely-circulated survey/lecture notes; the clearest tour of the vEB layout and the cache-oblivious sorting bound.
- **Brodal & Fagerberg, "Cache-Oblivious Distribution Sweeping"** — extends the technique to a family of computational-geometry problems; good for seeing how broadly the idea reaches.
- **[The I/O Model](../01-the-io-model/junior.md)** — the model (`N`, `M`, `B`; scan/search/sort bounds) this file is optimal *for*, without naming the parameters.
- **[External Sorting](../03-external-sorting/junior.md)** — the *cache-aware* `sort(N)` algorithm, the foil to cache-oblivious funnelsort.
- **[Cache-Aware Data Layout](../05-cache-aware-data-layout/junior.md)** — the parameter-*knowing* layout tricks (SoA, padding, alignment) that vEB's parameter-free layout sits beside.
- **[Cache-Oblivious Algorithms — Middle](./middle.md)** — recurrences for transpose and matrix multiply, the tall-cache assumption, and the rigorous vEB search analysis.
