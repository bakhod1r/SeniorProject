# Jump Search — Professional Level

> **Audience:** Algorithm designers, performance engineers, and researchers. Prerequisites: discrete math (square roots, AM-GM, asymptotics), basic external-memory model, comfort with cache hierarchies.

This document gives the **formal mathematical treatment** of jump search: a precise definition, a correctness proof, the **exact** worst-case comparison count `⌊√n⌋ + ⌈n / ⌊√n⌋⌉ - 1`, the AM-GM derivation of optimal block size, a **matching lower bound** for the asymmetric-access search model where backward seeks are forbidden, the **cache-complexity analysis** in the external-memory model, and the connection to **van Emde Boas / cache-oblivious** layouts that generalize the `√n` idea to multiple levels.

---

## Table of Contents

1. [Formal Definition](#definition)
2. [Correctness Proof](#correctness)
3. [Exact Comparison Count and AM-GM Optimality](#exact-count)
4. [Lower Bound for Forward-Only Access](#lower-bound)
5. [Cache Complexity in the External-Memory Model](#cache-complexity)
6. [Recursive `√n` Layouts and the van Emde Boas Connection](#veb)

---

<a name="definition"></a>
## 1. Formal Definition

### Problem

Let `A = [a_0, a_1, …, a_{n-1}]` be a sequence of `n` elements drawn from a totally ordered set `(S, ≤)`, sorted such that `a_i ≤ a_{i+1}` for all `0 ≤ i < n - 1`. Given a query `t ∈ S`, the **search problem** is to determine whether `t ∈ A` and, if so, return an index `i` such that `a_i = t`.

### Block-search procedure

Fix a block size `m ∈ [1, n]`. Define the **block boundary indices** `B = {0, m, 2m, …, ⌊n/m⌋ · m}`. Each boundary `b ∈ B` together with its successor (or `n` if it has none) defines a block `[b, min(b + m, n))`.

**Jump search algorithm:**

```
function JumpSearch(A, t, m):
    n ← |A|
    if n = 0: return ⊥
    prev ← 0
    step ← m
    // Phase 1 — jump phase
    while step < n ∧ A[step - 1] < t:
        prev ← step
        step ← step + m
    // Phase 2 — linear phase
    for i in [prev, min(step, n)):
        if A[i] = t: return i
        if A[i] > t: return ⊥
    return ⊥
```

When `m = ⌊√n⌋`, this is called **classical jump search**. When `m = 1`, it reduces to linear search; when `m = n`, to a single full block scan (also linear).

### Information-theoretic framing

There are `n + 1` outcomes (`n` indices + "not present"). Each comparison reveals at most one bit, so a comparison-based search needs at least `⌈log₂(n + 1)⌉` comparisons. Jump search does **not** achieve this — it makes `Θ(√n)` comparisons, exponentially more. The point of jump search is **not** comparison-optimality; it is to **minimize total access cost** under access models where each comparison's cost varies (forward seek cheap, backward seek expensive).

We formalize this in §4 with a precise model.

---

<a name="correctness"></a>
## 2. Correctness Proof

We prove the algorithm in §1 correctly returns the leftmost index `i` such that `A[i] = t`, or `⊥` if no such `i` exists.

### Invariants of the jump phase

> **(J1)** Before each iteration of the jump-phase loop, `0 ≤ prev ≤ step ≤ prev + m` and `step ≡ 0 (mod m)`.
>
> **(J2)** All indices `j < prev` satisfy `A[j] < t`. Equivalently: if `t ∈ A`, then any matching index is in `[prev, n)`.

**Proof of (J1).** Initialization: `prev = 0, step = m`, both multiples of `m`. Maintenance: each step assigns `prev ← step` then `step ← step + m`; both still multiples of `m`, and `step - prev = m` ≤ `m + 0`. ∎

**Proof of (J2).** Initialization: `prev = 0`, so no `j < 0` exists; vacuously true. Maintenance: the loop only advances when `A[step - 1] < t`. Since `A` is sorted, `A[j] ≤ A[step - 1] < t` for all `j ≤ step - 1`. After `prev ← step`, all indices `j < prev = step` satisfy `A[j] < t`. ∎

### Termination of the jump phase

Each iteration either advances `step` by `m ≥ 1` or causes the loop to exit. The loop exits when `step ≥ n` or `A[step - 1] ≥ t`. Since `step` strictly increases each iteration, the loop terminates after at most `⌈n / m⌉` iterations.

### Postcondition of the jump phase

Upon exit:
- If `step ≥ n`: all indices `j < prev` satisfy `A[j] < t`, and the array ends at `n`. Any match must be in `[prev, n)`.
- If `A[step - 1] ≥ t`: all indices `j < prev` satisfy `A[j] < t` (by J2), and `A[step - 1] ≥ t`. By sortedness, any match `i` with `A[i] = t` satisfies `prev ≤ i ≤ step - 1`, i.e., `i ∈ [prev, step)`.

In both cases, **any match lies in `[prev, min(step, n))`**.

### Linear phase

The for-loop iterates `i` over `[prev, min(step, n))` in increasing order. By sortedness, the first index satisfying `A[i] ≥ t` is the leftmost candidate. We return it if `A[i] = t`, else return `⊥` (since `A[i] > t` and all later indices have even larger values).

If the loop exits without finding `A[i] ≥ t`, then either `step > n` (in which case all indices have been scanned, no match), or all indices in `[prev, step)` are `< t` and the next iteration of the jump phase would have caught it — but we're past the jump phase, so this case is impossible given the postcondition. ∎

### Theorem 1 (Correctness)

JumpSearch(A, t, m) returns the smallest index `i` with `A[i] = t`, or `⊥` if no such `i` exists.

---

<a name="exact-count"></a>
## 3. Exact Comparison Count and AM-GM Optimality

### Worst-case comparisons

In the jump phase, each iteration performs **one comparison** (`A[step - 1] < t`). The maximum number of iterations is `⌈n / m⌉` (when we walk all the way to the end without overshoot), and we make one extra comparison to detect the overshoot — so the jump phase performs **at most `⌈n / m⌉` comparisons**.

In the linear phase, we scan at most `m - 1` elements (the block has at most `m` elements, and after finding the first `≥ t` we stop). Each step performs one comparison. So the linear phase makes **at most `m` comparisons** (one to find the target, or `m - 1` to confirm absence, plus the final equality check).

### Total

```
T(n, m) ≤ ⌈n/m⌉ + m
```

For `m = ⌊√n⌋`:

```
T(n, ⌊√n⌋) ≤ ⌈n / ⌊√n⌋⌉ + ⌊√n⌋
         ≤ ⌈√n⌉ + ⌊√n⌋  + 1     (since ⌈n/⌊√n⌋⌉ ≤ ⌈√n⌉ + 1 for most n)
         ≈ 2√n
```

In particular, for `n` a perfect square: `T(n, √n) = √n + √n - 1 = 2√n - 1` comparisons.

### Optimality of `m = √n` (AM-GM)

The cost function `f(m) = n/m + m` over real `m > 0` is minimized when its derivative is zero:

```
f'(m) = -n/m² + 1 = 0
⟹ m² = n
⟹ m = √n
```

Substituting back: `f(√n) = √n + √n = 2√n`.

Alternatively, by the AM-GM inequality:

```
n/m + m ≥ 2 · √((n/m) · m) = 2 · √n
```

with equality iff `n/m = m`, i.e., `m = √n`. So the minimum cost is exactly `2√n`, achieved at `m = √n`. ∎

### Sensitivity to suboptimal `m`

For `m = c · √n` where `c > 0` is a constant:

```
T(n, c√n) = n / (c√n) + c√n = (1/c + c) √n
```

`(1/c + c) ≥ 2` for all `c > 0`, with equality at `c = 1`. So any constant-factor deviation from `√n` gives a constant-factor penalty in `T`. This is **not** a critical penalty in practice — `c ∈ [0.5, 2]` doubles `T` at worst — but for fixed `n` it matters.

For non-constant deviations:

- `m = n^α` for `α ∈ (0, 1)`: `T = n^(1-α) + n^α`. Minimized at `α = 1/2`.
- For `α ≠ 1/2`, `T = Θ(n^{max(1-α, α)})`. This is `> O(√n)` for any `α ≠ 1/2`.

### Comparison-count concrete numbers

| `n` | `⌊√n⌋` | `T(n)` (worst case) | Linear `n` | Binary `⌈log₂(n+1)⌉` |
|---|---|---|---|---|
| 100 | 10 | 19 | 100 | 7 |
| 10⁴ | 100 | 199 | 10⁴ | 14 |
| 10⁶ | 1000 | 1999 | 10⁶ | 20 |
| 10⁸ | 10000 | 19999 | 10⁸ | 27 |
| 10⁹ | ~31623 | ~63245 | 10⁹ | 30 |

Jump search's comparison count grows much slower than linear but much faster than binary. The break-even point with linear is around `n = 4`; with binary it's never.

---

<a name="lower-bound"></a>
## 4. Lower Bound for Forward-Only Access

We now establish that, in an access model where **backward seeks are forbidden** (or equivalently, prohibitively expensive), `Ω(√n)` is the **best achievable** comparison count for comparison-based search. Jump search is optimal in this model.

### The forward-only model

Define the **forward-only sorted search problem**: given a sorted array `A` of size `n`, locate target `t`. Access to `A` is via a single read head that can only **advance** — at any step, the algorithm may read `A[k]` only if `k ≥ k_prev`, where `k_prev` is the largest previously-read index.

Note: this is a strict restriction. Binary search **cannot run** in this model — its access pattern requires bidirectional moves.

### Theorem 2 (Lower Bound, Yao-style)

Any deterministic algorithm solving the forward-only sorted search problem on `n` elements makes `Ω(√n)` comparisons in the worst case.

### Proof sketch (adversary argument)

Construct an adversary that adapts the array as the algorithm queries.

Let the algorithm query indices `k_1 < k_2 < … < k_q`. The adversary's strategy:

- For each query `A[k_j]`, the adversary returns a value consistent with sortedness and not yet committed.
- Between consecutive queries `k_{j-1}` and `k_j`, the **gap** `g_j = k_j - k_{j-1}` defines an interval `[k_{j-1} + 1, k_j - 1]` whose values the adversary has **not** revealed.

The adversary's claim: it can always place the target in the largest unvisited gap.

After `q` queries, the algorithm has visited `q` indices and divided `[0, n)` into `q + 1` gaps (allowing `k_0 = -1` and `k_{q+1} = n`). The largest gap has size `≥ (n - q) / (q + 1) ≥ (n - q) / (q + 1)`.

If the algorithm hasn't determined where the target is (because the largest gap could hold it), it must do **at least one more comparison per element of the largest gap** — since forward-only access means once you've passed the gap's left edge, you must scan every element.

For the algorithm to know "target is not in any unvisited gap", it must have either (a) read every element, or (b) committed to a gap and scanned it linearly. In the worst case, the algorithm commits to a gap of size `(n - q)/(q + 1) ≈ n / (q + 1)`, and scanning it costs `n / (q + 1)` more comparisons. Total: `q + n/(q+1) ≥ 2√n` by AM-GM, achieved at `q ≈ √n`. ∎

### Implications

- **Jump search is optimal** under forward-only access. No comparison-based algorithm can beat `O(√n)` in this model.
- To beat `O(√n)`, you need **either** random access (then binary search achieves `O(log n)`) **or** structural information about the data (interpolation, hashing).
- The `2√n` constant is tight in the worst case.

### Stronger model: forward seek free, backward seek expensive

A continuous version: forward seek costs `1` per unit; backward seek costs `c ≥ 1` per unit. Define **total seek cost** `S` and **comparison count** `Q`. The lower bound under `c → ∞` reduces to the forward-only model.

For finite `c`, the optimal algorithm is a generalization of jump search where block size depends on `c`:

```
m* = √(n · c / (c + 1))   (informally)
```

For `c = 1` (backward = forward): `m* = √(n/2)`. Roughly `m* ≈ √n`, jump search remains near-optimal.
For `c → ∞`: `m* → √n`. Jump search is exactly optimal.

For `c < 1` (backward cheaper than forward — rare): binary search becomes optimal.

This formal model justifies jump search's specific use cases (tape, append-only logs, paged storage) and explains why binary search wins on symmetric-access RAM.

---

<a name="cache-complexity"></a>
## 5. Cache Complexity in the External-Memory Model

We now analyze jump search in the **external-memory model** (Aggarwal & Vitter, 1988) to understand its I/O behavior.

### Setup

- Cache holds `M` elements, organized in **blocks** (lines) of `B` elements each. So `M/B` lines fit in cache.
- A cache **miss** transfers one block of `B` elements from main memory to cache.
- A cache **hit** is free.
- We count **block transfers** (memory accesses), not individual element accesses.

Note: this `B` is the cache block size, distinct from the jump-search block size `m`. Let's use `B_c` for cache block and `m` for jump-search block to avoid confusion.

### Analysis of jump search

**Jump phase:** We read `⌈n/m⌉` block-boundary elements at positions `m - 1, 2m - 1, …`. Each read is at a different memory location, separated by `m` elements.

- If `m · element_size ≥ B_c`: each jump-phase read misses a fresh cache block. Cost: `⌈n/m⌉` cache misses.
- If `m · element_size < B_c`: multiple boundaries fit per cache block; cost is `⌈n / (B_c / element_size)⌉` cache misses (essentially streaming through memory).

**Linear phase:** We scan up to `m` consecutive elements. Cost: `⌈m / (B_c / element_size)⌉ = ⌈m · element_size / B_c⌉` cache misses.

### Total cache misses

Assuming `m · element_size ≥ B_c` (typical for `m = √n` on modern hardware):

```
Total misses ≈ ⌈n/m⌉ + ⌈m · element_size / B_c⌉
           ≈ n/m + m / b      where b = B_c / element_size
```

Minimizing over `m`:

```
d/dm (n/m + m/b) = -n/m² + 1/b = 0
m* = √(n · b)
Total = 2 · √(n/b)
```

For `b = 16` (typical 64-byte cache line, 4-byte elements):

```
Total cache misses ≈ 2 · √(n / 16) = √n / 2
```

Half the misses of cache-oblivious jump search (which uses `m = √n`).

### Comparing to binary search

Binary search on a sorted array makes `log₂ n` probes, each (for large `n`) a cache miss. Total: `log₂ n` misses.

For `n = 10⁶`, `b = 16`:
- Jump search (with cache-tuned `m`): `√(10⁶ / 16) / 2 = 125` misses.
- Binary search: `log₂(10⁶) = 20` misses.

**Binary still wins** on cache misses for in-RAM workloads.

### When jump beats binary on cache

When element access cost is **dominated by sequential bandwidth** rather than seek latency:

- Streaming reads from disk: `1` seek per block, then `m` elements free (sequential prefetch fills cache).
- SIMD-vectorized linear scan: comparing 16 elements per cycle inside the located block.

In these regimes, the cache-miss model under-counts the cost of binary search's random probes (each requiring a full pipeline stall) and over-counts the cost of jump search's sequential scans (which the CPU handles in bulk). Empirical benchmarks (Khuong & Morin 2017, ClickHouse benchmarks) confirm jump-style scans beat binary on arrays of ~10⁴ elements with SIMD enabled.

### B-tree comparison

A B-tree with node size `B_c` makes `log_{B_c}(n)` cache misses (one per level). For `n = 10⁶`, `B_c = 256` (cache line full of small ints): `log_256(10⁶) ≈ 2.5` misses. B-trees crush both jump search and binary search on cache misses — this is why databases use them.

### Summary

| Algorithm | Cache misses (large `n`) |
|---|---|
| Linear search | `Θ(n/b)` |
| Jump search (m = √n) | `Θ(√n)` |
| Jump search (m = √(nb)) | `Θ(√(n/b))` |
| Binary search | `Θ(log₂ n)` |
| B-tree (node size `b`) | `Θ(log_b n)` |
| Cache-oblivious B-tree (vEB) | `Θ(log_b n)` |

Jump search occupies the same niche on cache misses as it does on comparisons: between linear and binary, exponentially worse than the optimum, but linear in some access models.

---

<a name="veb"></a>
## 6. Recursive `√n` Layouts and the van Emde Boas Connection

The `√n` block-size trick generalizes. Apply it **recursively**: split the array into `√n` blocks of `√n`; split each block into `√√n` sub-blocks of `√√n`; and so on, until block size is 1.

### Recursive cost

```
T(n) = T(√n) + √n          // jump phase O(√n), then recurse on the block of size √n
T(1) = O(1)
```

By the master theorem (or direct substitution):

```
T(n) = T(√n) + √n
     = T(n^(1/4)) + n^(1/4) + √n
     = ...
     = √n + n^(1/4) + n^(1/8) + ... + n^(1/2^k)
```

The series converges to `≈ 2√n`. **Recursive jump search is still `O(√n)`** — recursion doesn't help on the comparison count, since the first level's `√n` already dominates.

### The van Emde Boas layout

The **van Emde Boas (vEB) layout** does something more clever: it recursively splits the **memory layout** so that each level of recursion fits in one cache block. The trick: lay out the `√n`-th-root subtrees contiguously in memory.

For a balanced binary search tree on `n` elements with vEB layout:

- Top half of the tree (`log n / 2` levels, `√n` nodes) is laid out first.
- Each of the `√n` bottom-half subtrees (also `log n / 2` levels, `√n` nodes each) is laid out next, recursively in vEB order.

A search traverses `log₂ n` levels, but each chunk of `log(B_c)` levels is in one cache block. **Cache misses: `O(log_{B_c} n)`**, matching B-trees, *without knowing `B_c` at design time* — this is the **cache-oblivious** property.

### Connection to jump search

Single-level jump search is the **first level** of the vEB layout: the top `√n` "skip values" (block boundaries) and `√n` blocks. If you applied vEB recursion, you'd binary-search the top `√n` and then recurse — turning jump search into a multi-level cache-friendly binary-search variant.

In other words, vEB = jump search applied recursively with binary-style search at each level. This is the formal connection between the simple `√n` block-search and modern cache-oblivious data structures.

### Eytzinger layout (BFS in memory)

A simpler cache-friendly layout: store the implicit balanced BST in **BFS order** in memory. Children of node `k` are at `2k` and `2k + 1`. Binary search accesses are then **prefetcher-friendly**: when you probe `E[k]`, the prefetcher anticipates `E[2k]` and `E[2k+1]` and loads them.

Eytzinger is **simpler** than vEB and achieves nearly the same performance in practice (benchmarks in Khuong & Morin 2017). Jump search **does not** outperform Eytzinger on RAM arrays — Eytzinger is the right structure for cache-friendly comparison-based search on sorted data.

### Where jump search wins despite vEB / Eytzinger existing

- vEB and Eytzinger require **complete rebuild on insert**. Jump search on a normal sorted array is identical regardless of insert pattern (just resort).
- vEB and Eytzinger require **specific memory layouts**. Jump search runs on the natural array as-is — no preprocessing.
- vEB and Eytzinger are **complex to implement correctly**. Jump search is 10 lines.
- For **disk-resident data with forward-cheap access**, the cache model used by vEB is the wrong model — the dominant cost is seek direction asymmetry, not cache lines. Jump search's forward-only structure beats vEB in this regime.

### Recap of search algorithm families

| Family | Mechanism | Best use |
|---|---|---|
| Linear | One pass, no math | Tiny `n`, unsorted data |
| Jump | Fixed-stride probe + scan | Forward-cheap storage, skip-pointered lists |
| Exponential | Doubling probe + binary | Unbounded streams, adaptive |
| Binary | Halving | Random-access sorted |
| Eytzinger | BFS-laid binary search | Cache-bound RAM arrays |
| vEB | Cache-oblivious recursive BST | Large datasets, multi-tier cache |
| B-tree | Wide-branching block tree | Disk-resident sorted |
| Interpolation | Linear interpolation of value range | Uniformly distributed data |
| Hashing | Direct address computation | Unordered exact lookup |

Jump search is **the entry point** to this taxonomy. Understanding why `√n` is optimal under forward-only access teaches you to ask the right question for every other algorithm: **what is the cost model, and what does the optimum look like under that model?**

---

## Summary of Bounds

| Quantity | Value |
|---|---|
| Worst-case comparisons (block size `m`) | `⌈n/m⌉ + m` |
| Worst-case comparisons (`m = √n`) | `≤ 2⌈√n⌉` |
| Optimal block size (uniform access) | `m = √n` |
| Optimal block size (cache size `b`) | `m = √(n · b)` |
| Lower bound (forward-only access) | `Ω(√n)` |
| Lower bound (random access, comparison-based) | `Ω(log n)` (binary search is optimal) |
| Cache misses (cache line `b` elements) | `Θ(√(n/b))` with tuned `m` |
| Space | `O(1)` |
| Backward seek distance (worst case) | `O(√n)` (contained within one block) |
| Forward seek distance (total) | `O(n)` (visits every block boundary in worst case) |

These bounds are **tight** in their respective models. Jump search is optimal under forward-only or strongly-asymmetric access, suboptimal under symmetric random access.

---

## Further Reading

- **Shneiderman**, "Jump Searching: A Fast Sequential Search Technique" (CACM, 1978) — original block-size analysis.
- **Knuth TAOCP v3**, §6.2.1 — jump search alongside linear and binary, plus generalized `k-ary` block search.
- **Aggarwal & Vitter**, "The Input/Output Complexity of Sorting and Related Problems" (1988) — external-memory model used here.
- **Frigo, Leiserson, Prokop, Ramachandran**, "Cache-Oblivious Algorithms" (1999) — vEB layout and cache-oblivious framework.
- **Khuong & Morin**, "Array Layouts for Comparison-Based Searching" (2017) — Eytzinger benchmark, includes comparison against linear-with-SIMD inside blocks. Open access at arXiv:1509.05053.
- **Yao**, "On the Complexity of Comparison Problems Using Linear Functions" (1976) — adversary arguments for search lower bounds.
- **Bentley & Yao**, "An Almost Optimal Algorithm for Unbounded Searching" (1976) — exponential search, the adaptive cousin.
