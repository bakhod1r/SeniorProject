# Two Pointers — Mathematical Foundations and Complexity Theory

## Table of Contents

1. [Formal Setup](#formal-setup)
2. [Correctness Proof — Two-Sum on Sorted Array](#correctness-proof--two-sum-on-sorted-array)
3. [Correctness Proof — In-Place Partition](#correctness-proof--in-place-partition)
4. [Amortized Argument for Total O(n) Work](#amortized-argument-for-total-on-work)
5. [Lower Bounds — When Two Pointers Is Optimal](#lower-bounds--when-two-pointers-is-optimal)
6. [Cache-Friendliness vs Binary Search](#cache-friendliness-vs-binary-search)
7. [Parallelization Difficulty](#parallelization-difficulty)
8. [Summary](#summary)

---

## Formal Setup

Let `A` be an array of length `n` over a totally ordered domain `D`. A **two-pointer algorithm** maintains a state `(l, r) in N x N` and updates it via a transition function `delta : (D x D) -> {move_left, move_right, terminate}`. The configuration evolves as:

```text
(l_{k+1}, r_{k+1}) = step(l_k, r_k, A)
```

where `step` increments `l`, decrements `r`, or both, based on `delta(A[l_k], A[r_k])` and the problem-specific predicate `P`.

For the **converging** variant the invariant is `0 <= l <= r <= n - 1` and the termination predicate is `l >= r`. For the **slow/fast** variant the invariant is `0 <= slow <= fast <= n` and termination is `fast = n`. For the **merge** variant we have two sequences `A`, `B` and indices `(i, j)`; the invariant is `0 <= i <= |A|`, `0 <= j <= |B|`; termination is `i = |A| or j = |B|`.

Every correctness proof in this file follows the **loop-invariant** discipline:

1. **Initialization.** The invariant holds before the loop starts.
2. **Maintenance.** If the invariant holds at the start of iteration `k`, it still holds at the end.
3. **Termination.** When the loop ends, the invariant plus the negation of the loop condition imply the postcondition.

Termination is also a **monovariant** argument: some non-negative integer strictly decreases each iteration and is bounded below by zero.

---

## Correctness Proof — Two-Sum on Sorted Array

**Algorithm.**

```text
Input:  A sorted in non-decreasing order, length n; target t.
Output: (i, j) with 0 <= i < j <= n - 1 and A[i] + A[j] = t, or NONE.

l <- 0; r <- n - 1
while l < r:
    s <- A[l] + A[r]
    if s = t: return (l, r)
    if s < t: l <- l + 1
    else:     r <- r - 1
return NONE
```

**Loop invariant `I`:**

> If a valid pair `(i*, j*)` with `0 <= i* < j* <= n - 1` and `A[i*] + A[j*] = t` exists, then `l <= i* and j* <= r`.

**Initialization.** Before the first iteration, `l = 0` and `r = n - 1`, so any valid `(i*, j*)` satisfies `0 <= i*` and `j* <= n - 1` trivially. `I` holds.

**Maintenance.** Assume `I` holds. Let `s = A[l] + A[r]`. Three cases:

- **Case `s = t`.** Return `(l, r)`. `I` is not needed beyond this point; we have a valid pair.
- **Case `s < t`.** Claim: no valid pair `(i*, j*)` has `i* = l`.
  Suppose for contradiction `i* = l`. Then `j* <= r`, so `A[j*] <= A[r]` (sorted). Therefore `A[i*] + A[j*] = A[l] + A[j*] <= A[l] + A[r] = s < t`, so `A[i*] + A[j*] != t`, contradicting validity. Thus `i* > l`, which gives `i* >= l + 1`. After `l <- l + 1`, the invariant `l <= i*` still holds.
- **Case `s > t`.** By symmetric argument no valid pair has `j* = r`, so `j* <= r - 1`. After `r <- r - 1`, `j* <= r` still holds.

**Termination.** The quantity `phi = r - l` is a non-negative integer at the start of every iteration (because `l < r` is the loop guard, `phi >= 1`). On every non-returning iteration, exactly one of `l` or `r` moves toward the other, so `phi` strictly decreases by 1. After at most `n - 1` iterations, `phi = 0` and the loop exits.

**Postcondition.** Two ways to exit:

- Via `return (l, r)` inside the loop: by construction `A[l] + A[r] = t` and `l < r`. Output is valid.
- Via `return NONE` after the loop: at that point `l >= r`. The invariant says: if a valid pair existed, then `l <= i* < j* <= r`. But `l >= r` makes this empty (no `i*, j*` with `l <= i* < j* <= r`). So no valid pair exists.

QED. The algorithm is correct in both branches.

---

## Correctness Proof — In-Place Partition

We prove correctness of the slow/fast partition: given a predicate `P`, rearrange `A` so that `A[0..k-1]` contains exactly the elements satisfying `P`, and return `k`. Element order **inside the satisfying prefix** is preserved (stable partition); the suffix order is unspecified.

**Algorithm (write-only variant).**

```text
slow <- 0
for fast in 0 .. n - 1:
    if P(A[fast]):
        A[slow] <- A[fast]
        slow <- slow + 1
return slow
```

Note this assumes "destroying" the discarded elements is acceptable (e.g., `removeDuplicates` semantics). For a true swap-based partition the proof is similar; we focus on the write variant for clarity.

**Loop invariant `I`:**

> At the start of iteration `fast = k`, the multiset `{A[0], ..., A[slow - 1]}` equals the multiset of elements in the **original** `A[0..k-1]` that satisfy `P`, **and in the same relative order**.

**Initialization.** Before iteration `k = 0`, `slow = 0`, so the prefix is empty. The set of satisfying elements in `A[0..-1]` is also empty. `I` holds.

**Maintenance.** Assume `I` holds. Two cases:

- **`P(A[fast])` false.** `slow` does not change; the prefix is unchanged. Now `I` must hold for the prefix `A[0..fast]` (one more element). The new element `A[fast]` does not satisfy `P`, so the set of satisfying elements in `A[0..fast]` is unchanged. `I` still holds.
- **`P(A[fast])` true.** Execute `A[slow] <- A[fast]; slow <- slow + 1`. The new prefix `A[0..slow - 1]` is the old prefix with `A[fast]` appended. The new "should-be" set is the old should-be set with `A[fast]` appended (in order). Match. `I` still holds.

**Termination.** `fast` strictly increases from `0` to `n - 1` and is bounded; the loop runs exactly `n` times.

**Postcondition.** After the loop, `fast = n`. By `I`, `A[0..slow - 1]` equals the satisfying subsequence of the original `A[0..n - 1]`. Therefore the algorithm returns the correct partition size, and the prefix contains the correct elements in the correct order. QED.

---

## Amortized Argument for Total O(n) Work

The runtime claim "two pointers is `O(n)`" follows from an **aggregate** amortized argument, not a per-iteration argument. Per iteration, the work is `O(1)`, but the **number of iterations** must be bounded.

**Aggregate analysis (converging).** Define the potential `phi(l, r) = (r - l)`. Initially `phi = n - 1`. Every iteration either decreases `phi` by exactly 1 (move one pointer) or terminates. Since `phi >= 0` and is integer-valued, the total number of iterations is at most `n - 1`. Per-iteration work is `O(1)`. Total: `O(n)`.

**Aggregate analysis (slow/fast).** `fast` increases by exactly 1 per iteration and is bounded by `n`. Total iterations: `n`. Work per iteration: `O(1)`. Total: `O(n)`.

**Aggregate analysis (merge).** Define `phi = i + j`. Initially `phi = 0`. Every iteration increases `phi` by at least 1 (one pointer moves; on a match both move, but still at least 1). `phi` is bounded by `|A| + |B|`. Total iterations: at most `|A| + |B|`. Per-iteration work: `O(1)`. Total: `O(|A| + |B|)`.

**Note on amortization vs worst case.** This is not really "amortized" in the classical sense (no operation is occasionally expensive while others are cheap). It is a straightforward **aggregate** argument: the total work across the loop is `O(n)`, even though no single iteration costs more than `O(1)`. The terminology "amortized" is sometimes loosely applied here, but pedantically this is a **worst-case** bound, not an amortized one. Each iteration is `O(1)` in the worst case; their sum is `O(n)` in the worst case.

This distinguishes two pointers from genuinely amortized structures like dynamic arrays, where some operations cost `O(n)` and the amortization shows that the **average** per operation is `O(1)`.

---

## Lower Bounds — When Two Pointers Is Optimal

### Sorted two-sum

**Claim.** Any algorithm that solves two-sum on a sorted array must examine `Omega(log n)` elements in the worst case.

**Proof sketch.** Consider an adversary that returns the answer "NONE" on all queries until forced to commit. The algorithm must distinguish between an array where the pair exists and one where it does not. By the comparison-tree lower bound argument, the algorithm makes at least `log_2(n)` comparisons in the worst case. Binary search achieves this.

**However**, two pointers does `Theta(n)` comparisons in the worst case, which is **not** optimal for the **decision problem**. So why prefer it?

- Two pointers is **deterministic linear** with `O(1)` extra memory. Binary search needs random access; on a linked list or sequential read, you cannot use it.
- For **producing the pair** (not just deciding existence), two pointers is `O(n)` while running binary search `n` times costs `O(n log n)`.
- Cache and prefetcher behavior: two pointers reads sequentially, which is dramatically faster in practice (see next section), so even at `Theta(n)` comparisons the constants beat `Theta(log n)` random-access comparisons for moderate `n`.

In summary, two pointers is **not optimal** in the comparison-complexity sense but is **practically optimal** for stream / sequential-access models.

### Comparison-based merging

**Claim.** Merging two sorted sequences of total length `n` requires at least `n - 1` comparisons in the worst case.

**Proof.** Each comparison `A[i] vs B[j]` resolves the relative order of exactly two elements. The output sequence has `n` elements; in the worst case (e.g., alternating: `A[0] < B[0] < A[1] < B[1] < ...`), every adjacent pair in the output is one `A` element next to one `B` element, requiring a comparison to decide their order. That gives `n - 1` adjacencies, hence `n - 1` comparisons.

The merge-style two-pointer algorithm achieves exactly `<= n - 1` comparisons. It is therefore **comparison-optimal**.

### Partitioning by a predicate

Lower bound: `Omega(n)` because every element must be examined (the predicate is opaque). Two pointers achieves this with one pass. **Optimal** in both comparison and access model.

---

## Cache-Friendliness vs Binary Search

In the **external memory model** (`B` = block size, `M` = cache size, both measured in elements):

| Algorithm | Cache misses |
|-----------|--------------|
| Two pointers (sequential scan) | `O(n / B)` |
| Binary search | `O(log_2(n / B))` per query, `O(log n)` total |

For a single query, binary search wins asymptotically. But for **producing all answers** (e.g., all triplets, the merged list, etc.), two pointers' single sequential scan often beats `n` random-access binary searches for any realistic `n`, because the constant from sequential access is roughly **1-2 nanoseconds per element** vs **50-300 nanoseconds per cache miss** for a true random access.

This is why production database query planners often prefer sort-merge join over hash join (with binary lookups) when the relations are already sorted or near-sorted: the sequential I/O profile is unbeatable, even though the hash join may have a lower asymptotic comparison count.

**Conclusion.** In the RAM model, binary search is asymptotically faster for **single-query** search. In the external-memory model, two pointers is competitive or better for **bulk** operations. Real systems pick the algorithm based on the **access pattern**, not just the comparison count.

---

## Parallelization Difficulty

Two pointers is **inherently sequential** because each step's pointer movement depends on the previous step's comparison result. This creates a **data dependency chain** of length `Theta(n)`, which limits parallel speedup.

Formally, the **work-span model** of parallel computing:

- **Work** `T_1 = Theta(n)`: total operations.
- **Span** `T_infinity = Theta(n)`: critical path is the chain of pointer updates.
- **Parallelism** `T_1 / T_infinity = 1`.

There is no asymptotic parallelism in the straight algorithm.

**Workarounds (partial parallelism).**

1. **Chunk partition (works for slow/fast).** Split the array into `p` chunks of `n / p`, run partition independently in each, then concatenate the satisfying prefixes. Output order is preserved within chunks but the global ordering requires a final compaction step (which is itself sequential). Net speedup is bounded by `p` ignoring the final merge.

2. **Pipeline (works for merge).** With `k` sorted streams, the merger is sequential, but the `k` producers can run in parallel. Speedup is in I/O / decoding, not in the merger itself.

3. **Speculative execution.** Pre-compute "what if `l` moves" and "what if `r` moves" in parallel, commit one branch. This wastes half the work and only helps when the comparison is itself expensive (rare).

4. **Map-reduce style for converging.** For "count pairs with property", you can transform into prefix-sum + binary search, which parallelizes. This usually changes the algorithm rather than parallelizing two pointers per se.

The takeaway: two pointers gives you **excellent serial constants**, not **algorithmic parallelism**. If you need true parallel speedup, you must restructure the problem (e.g., divide-and-conquer merge sort splits into independent sub-merges).

---

## Summary

| Aspect | Result |
|--------|--------|
| **Correctness** | Proven by loop-invariant arguments: at every step a discardable region can be named |
| **Total work** | `O(n)` by aggregate argument; `phi = r - l` (or `i + j`) bounds iterations |
| **Comparison lower bound (decision)** | `Omega(log n)` for sorted two-sum; two pointers is NOT comparison-optimal |
| **Comparison lower bound (merge)** | `Omega(n)`; two pointers IS comparison-optimal |
| **Cache complexity** | `O(n / B)` sequential — beats binary search in bulk-output scenarios |
| **Parallelism** | Span = work = `Theta(n)`; no asymptotic parallel speedup |

Two pointers is a tight, low-overhead pattern with provable correctness, optimal sequential I/O, and lower bounds that match its merge-style variant. Its main theoretical weakness — non-optimal for single-query decision problems and unparallelizable on the critical path — is also the reason it dominates the practical bulk-streaming domain where allocations, cache misses, and random access are the real enemy.
