# MEX -- Mathematical Foundations

## Table of Contents

1. [Formal Definition](#formal-definition)
2. [The MEX <= n Bound by Pigeonhole](#the-mex--n-bound-by-pigeonhole)
3. [Correctness Proof for the Bucket Algorithm](#correctness-proof-for-the-bucket-algorithm)
4. [Amortized Analysis -- Incremental Insert-Only MEX](#amortized-analysis----incremental-insert-only-mex)
5. [Persistent Segment Tree Range MEX](#persistent-segment-tree-range-mex)
6. [Lower Bound for Offline Range MEX](#lower-bound-for-offline-range-mex)
7. [Sprague-Grundy Theorem](#sprague-grundy-theorem)
8. [Cache-Oblivious Analysis](#cache-oblivious-analysis)
9. [Information-Theoretic Notes](#information-theoretic-notes)
10. [Summary](#summary)

---

## Formal Definition

Let `S` be a finite subset of the non-negative integers `Z_{>=0}`. The **minimum excludant** of `S` is

```text
MEX(S) = min { k in Z_{>=0} : k not in S }.
```

The minimum is well-defined because `Z_{>=0}` is unbounded above, so the candidate set is non-empty (e.g., `|S| + 1` always works -- see the pigeonhole bound below).

For a finite **multiset** `M` (or equivalently an array `a[0..n-1]`), define

```text
MEX(M) = MEX( { v : v occurs in M } ).
```

Multiplicities do not affect MEX -- only set-presence matters. This is why all MEX algorithms internally collapse multisets to their support.

---

## The MEX <= n Bound by Pigeonhole

**Theorem.** For any multiset `M` with `|M| = n`, `MEX(M) <= n`.

**Proof.** Consider the `n + 1` candidate values `{0, 1, ..., n}`. The support of `M` has at most `n` distinct values. By the pigeonhole principle, at least one element of `{0, 1, ..., n}` is missing from the support. Therefore there exists `k in {0, 1, ..., n}` with `k not in M`, so `MEX(M) <= k <= n`. **Q.E.D.**

**Tightness.** The bound is tight: for `M = {0, 1, ..., n-1}`, `MEX(M) = n`. So no algorithm can replace the `+1` with a smaller constant.

**Corollary.** Any value `v > n` in `M` is irrelevant to the MEX computation and may be ignored. This is the structural fact that powers the O(n)-time, O(n)-space bucket algorithm: only the marks for values in `[0, n]` matter.

---

## Correctness Proof for the Bucket Algorithm

```text
BucketMEX(a[0..n-1]):
    let seen[0..n] = all false
    for i = 0 to n-1:
        if 0 <= a[i] <= n:
            seen[a[i]] = true
    for k = 0 to n:
        if not seen[k]:
            return k
    return n + 1   // unreachable
```

**Claim.** `BucketMEX(a) = MEX(a)`.

**Proof.**

*Loop invariant of the first loop (marking).* After processing `a[0..i-1]`, for every `k in [0, n]`,
`seen[k] = True iff (exists j in [0, i-1] : a[j] == k)`.

Base case `i = 0`: vacuously true.

Inductive step: in iteration `i`, if `a[i] in [0, n]` we set `seen[a[i]] = True`, which is the only change. For all other `k`, `seen[k]` is preserved, so the invariant carries to `i+1`.

After the first loop runs to `i = n`, the invariant gives `seen[k] = True iff k in support(a) and k in [0, n]`.

*Second loop (scan).* The loop returns the smallest `k in [0, n]` with `seen[k] = False`, i.e., the smallest `k in [0, n]` not in support(a). By the pigeonhole bound, `MEX(a) in [0, n]`, so this `k` is exactly `MEX(a)`.

If the loop completes without returning, every `k in [0, n]` is in support(a), so `MEX(a) > n`. But by the pigeonhole bound `MEX(a) <= n` -- contradiction. So this path is unreachable for finite `a` with `|a| = n`. **Q.E.D.**

**Time.** Two loops of `n + 1` iterations: O(n).

**Space.** Bucket of size `n + 1`: O(n).

---

## Amortized Analysis -- Incremental Insert-Only MEX

When the workload is "insert-only, report MEX after each insert," we can achieve **amortized O(1)** per insert.

```text
IncMEX:
    seen[0..N] = all false      // N is the upper bound on inserts
    mex = 0

    Insert(v):
        if 0 <= v <= N: seen[v] = true
        while seen[mex]:
            mex = mex + 1
        return mex
```

**Theorem.** A sequence of `n` inserts runs in total time O(n), giving amortized O(1) per insert.

### Aggregate method

Count work in two buckets:

- **Marking:** each insert performs one O(1) write to `seen`. Total marking work across `n` inserts: O(n).
- **Pointer advance:** the inner `while` loop increments `mex`. Each increment is permanent -- `mex` never decreases under insert-only. The pointer starts at 0 and ends at most at `n` (by the pigeonhole bound). Total increments across all inserts: at most `n`.

Sum: O(n) total, amortized O(1) per insert. **Q.E.D.**

### Potential method (alternative)

Define the potential function

```text
Phi(D) = (final mex of D) - (current mex of D).
```

Phi is non-negative because mex is monotone non-decreasing under insert-only and bounded above by `n`.

Amortized cost of an insert that advances mex by `delta`:

```text
a = c_actual + Delta(Phi) = (1 + delta) + (-delta) = 1.
```

So the amortized cost per insert is exactly 1 -- O(1) amortized. The actual cost can be O(n) for a single insert that finally advances mex through a long pre-marked prefix, but the prepaid potential covers it. **Q.E.D.**

### Worst-case single-insert cost

The amortized bound hides a worst-case single insert of O(n). Example: insert `1, 2, 3, ..., n` in order, then insert `0`. The first `n` inserts each take O(1) (mex stays at 0). The `n+1`-th insert advances mex from 0 to `n+1`, costing O(n). The amortized average is still O(1) -- but for latency-sensitive systems, the burst matters; see senior.md for instrumentation.

---

## Persistent Segment Tree Range MEX

**Problem.** Given a static array `a[0..n-1]` and `q` online queries `(l, r)`, compute `MEX(a[l..r])` per query.

### Structure

For each prefix `a[0..i]`, store a **persistent segment tree** over the value range `[0, n]`. Each leaf `v in [0, n]` stores `last[v]` = the largest index `j <= i` such that `a[j] = v`, or `-1` if no such index exists. Internal nodes store the **min** of `last[v]` over leaves in their subtree.

Persistent updates: when transitioning from prefix `i-1` to prefix `i`, only the path from root to leaf `a[i]` changes -- O(log n) new nodes. Total memory across all `n + 1` versions: O(n log n).

### Query

To answer `MEX(a[l..r])`:

1. Take the version for prefix `r` (which captures `a[0..r]`).
2. Descend the tree, preferring the left subtree when its `min(last[v]) < l` -- that subtree contains a value whose last occurrence in `a[0..r]` is before `l`, so that value is missing in `a[l..r]`.
3. Otherwise descend right (and the answer's leaf index has an offset added).
4. Terminate at a leaf; its index is the MEX.

```text
RangeMEX(version_r, l):
    node = root(version_r)
    answer = 0
    while node is internal:
        if min(node.left) < l:
            node = node.left
        else:
            answer += span(node.left)
            node = node.right
    return answer
```

**Theorem.** Each query runs in O(log n) time.

**Proof.** The descent visits at most one node per level. The tree has O(log n) levels. Each per-node operation is O(1). **Q.E.D.**

**Theorem.** The structure uses O(n log n) preprocessing time and space.

**Proof.** `n + 1` persistent versions; each adds O(log n) new nodes; each takes O(log n) work to construct (rebuild the path). Total: O(n log n) time and space. **Q.E.D.**

### Correctness

**Claim.** A value `v` is missing in `a[l..r]` iff `last_{r}[v] < l`, where `last_{r}[v]` is the last occurrence of `v` in `a[0..r]`.

**Proof.** If `last_{r}[v] < l`, the last occurrence in `a[0..r]` is at index < `l`, so no occurrence falls in `[l, r]`. Conversely, if `v in a[l..r]`, then some occurrence index `j in [l, r]` exists, so `last_{r}[v] >= j >= l`. **Q.E.D.**

The descent's preference for "left subtree whose min < l" therefore finds the leftmost leaf that satisfies "missing in `[l, r]`," which is the MEX.

---

## Lower Bound for Offline Range MEX

**Problem.** Given a static array `a[0..n-1]` and `q` offline queries `(l_i, r_i)`, compute `MEX(a[l_i..r_i])` for each.

**Theorem (informal).** Under natural computational models (cell-probe, comparison), any offline range MEX algorithm requires `Omega((n + q) sqrt(n))` time in the worst case for `q = Theta(n)` queries.

### Sketch of the argument

The lower bound comes from a reduction from **offline range mode** and from **multi-pointer Mo's-style** lower bounds. The intuition:

1. **Output size.** Each query produces one integer, so `q` queries require `Omega(q)` output time.
2. **Information per query.** A range MEX query is sensitive to the support of `a[l..r]`. Adversary inputs exist where two queries `(l, r)` and `(l, r+1)` have MEX values that depend on whether `a[r+1]` equals the current MEX -- a comparison decision.
3. **Cell-probe lower bound.** For balanced query distributions, any data structure must probe `Omega(sqrt(n))` cells per query in the worst case for the range-mode problem; range MEX inherits this lower bound through a reduction in which the mode element is the MEX of a transformed array.

The matching upper bound is **Mo's algorithm** combined with a sqrt-decomposed missing-min structure, achieving `O((n + q) sqrt(n))` total time. This matches the lower bound up to constants and is the optimal known offline algorithm.

For **online** range MEX (queries arrive one at a time, each must be answered before the next), the persistent-segment-tree approach achieves `O(log n)` per query -- strictly better than the offline Mo's bound. This is one of the rare cases where online beats offline; the difference comes from the persistent structure paying O(n log n) preprocessing up front rather than amortizing across queries.

### Reduction sketch (range-mode -> range-MEX)

Given an array `b[0..n-1]` for the range-mode problem, build `a[0..n-1]` by replacing each `b[i]` with a unique tag if it is the first occurrence of `b[i]`, else leave it. Then MEX of `a[l..r]` corresponds to information about which values are absent, which transitively encodes mode information. A full formal reduction requires care; the takeaway is that range MEX is **at least as hard** as range mode in standard models.

---

## Sprague-Grundy Theorem

The Sprague-Grundy theorem is the theoretical foundation of impartial-game analysis. MEX is its defining operation.

### Theorem (Sprague 1935, Grundy 1939)

Let `G` be an impartial game (both players have the same moves available, the last player to move wins). Every game position `p` has a non-negative integer `G(p)`, called its **Grundy number**, satisfying:

```text
G(p) = MEX( { G(p') : p' is reachable from p in one move } ).
```

A position `p` is a losing position for the player to move (a P-position) iff `G(p) = 0`.

### Sum of games

If `H = G_1 + G_2 + ... + G_k` is the sum of independent impartial games (a move in `H` is a move in exactly one component), then

```text
G(H) = G(G_1) XOR G(G_2) XOR ... XOR G(G_k).
```

This is the **Sprague-Grundy theorem for sums**: the XOR of Grundy values determines the value of the sum.

### Why MEX specifically?

The MEX choice is essential. Consider an alternative `G'(p) = 1 + max { G'(p') : ... }`. With this alternative:

- The single-game P-position characterization still holds (G' = 0 iff terminal), but
- The XOR-sum formula breaks: there is no clean composition law.

MEX makes the XOR-sum equivalence work because of a clean bijection. For any non-negative integer `g` and target `g XOR x`, the player can move from a position of Grundy `g` to a position of Grundy `g XOR x` in **at least one** component as long as the component's Grundy set contains every value below it. The MEX guarantees this: by definition `MEX(S) = k` means `{0, 1, ..., k-1} subset S`, so from a position of Grundy `k` there is a move to every position of Grundy `0, 1, ..., k-1`.

### Proof sketch (Sprague-Grundy sum)

Let `H = G_1 + G_2`. Define `f(H) = G(G_1) XOR G(G_2)`. We show `G(H) = f(H)` by induction on game depth.

**Base case.** Both games terminal: `G(G_1) = G(G_2) = 0`, `f = 0`, `H` is terminal so `G(H) = 0`. Match.

**Inductive step.** Assume the claim for all sub-positions of `H`.

*Show: every Grundy value `< f(H)` is reachable from `H`.* Pick any `x < f(H)`. Let `d = f(H) XOR x`. The highest set bit of `d` is set in `f(H)`, so it is set in exactly one of `G(G_1), G(G_2)` -- say `G(G_1)`. Then `G(G_1) XOR d < G(G_1)`, so by the MEX property of single-game Grundy values, `G_1` has a move to a sub-position `p'` with `G(p') = G(G_1) XOR d`. Moving in `G_1` to `p'` reaches a sum with Grundy `(G(G_1) XOR d) XOR G(G_2) = G(G_1) XOR G(G_2) XOR d = f(H) XOR d = x`. **Reachable.**

*Show: `f(H)` itself is not reachable from `H`.* Any move from `H` is a move in exactly one component, say to `p'` in `G_1`. The new Grundy is `G(p') XOR G(G_2)`. If this equals `f(H) = G(G_1) XOR G(G_2)`, then `G(p') = G(G_1)` -- but by the MEX property, `G(G_1)` is not reachable from `G_1` in one move. **Contradiction.**

So `G(H) = MEX(reachable) = f(H)`. **Q.E.D.**

This proof is the reason MEX is the operation. Replace it with anything else and the XOR composition breaks.

---

## Cache-Oblivious Analysis

The bucket-MEX algorithm has excellent cache behavior. Parameters: `N = n` (array size), `M = cache size`, `B = block size`.

```text
First loop (marking):
    Read a[0..n-1] sequentially:           O(N / B) misses.
    Write seen[a[i]] -- random pattern:    O(N / B) misses if seen fits in cache,
                                          O(N) misses otherwise (random access).

Second loop (scan):
    Read seen[0..n] sequentially:          O(N / B) misses.
```

If `seen` fits in cache (i.e., `N <= M`), the total miss count is `O(N / B)` -- optimal. Otherwise (`N > M`), the random-write pattern in the first loop can degrade to one miss per write, giving `O(N)` misses.

### Cache-conscious variant for large N

When the value range is much larger than cache, **bucket the input** before marking:

```text
For very large n:
    1. Partition a[0..n-1] into k = ceil(n * sizeof(int) / M) blocks
       so each block's distinct values fit in cache.
    2. For each block, allocate a per-block bitset, mark within it.
    3. Merge bitsets sequentially, OR-ing into a global bitset.
    4. Scan the global bitset for the first clear bit.
```

The marking phase now does `O(N / B)` misses (sequential writes within each cache-resident bitset). The merge phase is sequential. Total: `O(N / B * log_{M/B}(N/B))` -- the same Funnelsort-like bound as cache-oblivious merging.

### When bitset wins

For very large `n` (say `n = 10^9`), using a packed bitset (1 bit per value) instead of a `bool[]` (1 byte per value, or worse in Java due to boxing) reduces memory by 8x and reduces cache pressure proportionally. `BitSet.nextClearBit` in Java is hardware-accelerated and matches the cache-oblivious lower bound on modern hardware.

---

## Information-Theoretic Notes

### Output entropy

For a uniformly random multiset `M` of size `n` drawn from `[0, n]`, the distribution of `MEX(M)` is concentrated near `n/2`. Standard combinatorial arguments give:

```text
Pr[MEX(M) >= k] = product_{j=0}^{k-1} (1 - 1/(n+1))^n  (informal, for the IID case)
```

The expected MEX for random input is `Theta(n / log n)` -- much smaller than the worst-case `n`. This is why in practice the **incremental insert-only MEX**'s `mex` pointer stays small for most workloads, and why production observability often shows mex << n.

### MEX as a hash

A MEX-based scheme cannot serve as a cryptographic hash -- the output is highly structured (small integers) and adversarially predictable. But MEX-of-Grundy is essentially a **canonical hash** of an impartial game's position class: two positions with the same Grundy value are interchangeable in any sum-of-games context. This is why Grundy values are sometimes called **Nim values**.

### Connection to first-missing-positive

LeetCode 41 (First Missing Positive) is a 1-indexed variant of MEX restricted to positive integers. The classic O(n)-time O(1)-space in-place algorithm (cycle sort with index = value swaps) is a clever realization of the bucket approach that reuses the input array as the bucket. The pigeonhole bound `answer in [1, n+1]` is the same argument with a shifted base.

---

## Comparison with Alternatives

| Attribute | Bucket MEX | Sort + scan | Hash set | Segment tree (dynamic) | Persistent seg tree |
|-----------|-----------|-------------|----------|------------------------|---------------------|
| Time | O(n) | O(n log n) | O(n) avg | O(log n) per op | O(log n) per query |
| Space | O(n) | O(1) extra | O(n) | O(n) | O(n log n) |
| Static / dynamic | Static | Static | Static | Dynamic | Static, online range queries |
| Cache I/Os | O(N/B) | O((N/B) log(N/M)) | O(N) worst | O(log n * N/B) | O(log n * N/B) |
| Deterministic | Yes | Yes | No (hash) | Yes | Yes |

---

## Summary

The MEX function admits a tight `MEX <= n` bound by pigeonhole, an O(n) bucket algorithm provable by loop invariant, and an amortized O(1) per-insert incremental variant via the potential method. Persistent segment trees lift offline-only range MEX to online O(log n) per query, while Mo's algorithm achieves the matching offline lower bound of `Omega((n + q) sqrt(n))`.

The Sprague-Grundy theorem makes MEX the canonical operation of impartial-game analysis -- it is the unique choice that allows clean XOR composition of game sums. Cache-oblivious analysis favors the bucket form for arrays that fit in memory and the bitset variant for very large `n`. The algorithmic depth is small; the connections to game theory and to the cell-probe lower bounds are what make MEX worth proving carefully.
