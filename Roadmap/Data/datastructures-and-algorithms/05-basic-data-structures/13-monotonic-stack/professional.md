# Monotonic Stack -- Mathematical Foundations

## Table of Contents

1. [Formal Definition](#formal-definition)
2. [Loop Invariant and Correctness](#loop-invariant-and-correctness)
3. [Amortized Analysis -- Aggregate Method](#amortized-analysis----aggregate-method)
4. [Amortized Analysis -- Accounting Method](#amortized-analysis----accounting-method)
5. [Cartesian Tree Connection](#cartesian-tree-connection)
6. [Range Minimum Query via Cartesian Tree + LCA](#range-minimum-query-via-cartesian-tree--lca)
7. [Lower Bounds for Next-Greater-Element](#lower-bounds-for-next-greater-element)
8. [Persistent Monotonic Stack](#persistent-monotonic-stack)
9. [Summary](#summary)

---

## Formal Definition

A **monotonic stack** over an array `a[0..n-1]` is a sequence `S = (i_1, i_2, ..., i_k)` of indices (read bottom to top) satisfying a monotonicity invariant:

```text
Strictly increasing variant:    a[i_1] < a[i_2] < ... < a[i_k]
Strictly decreasing variant:    a[i_1] > a[i_2] > ... > a[i_k]
Non-strict variants:            replace < or > with <= or >=
```

The associated algorithm `MonoScan(a, op)` -- where `op` is a comparison operator -- processes indices `0` through `n-1` and maintains the invariant by popping any top whose value violates `op` against the incoming element before pushing.

```text
MonoScan(a, op):
    S <- empty
    for i from 0 to n-1:
        while S is non-empty AND op(a[top(S)], a[i]):
            j <- pop(S)
            record(j, i)
        push(S, i)
    while S is non-empty:
        j <- pop(S)
        record(j, n)
```

The function `record(j, i)` writes the "answer" for index `j` -- the first index to its right that breaks the invariant. After the algorithm halts, every index has its answer set.

---

## Loop Invariant and Correctness

**Claim.** After processing prefix `a[0..i]`, the stack `S` contains exactly the indices `j <= i` for which **no** `k` in `[j+1, i]` satisfies `op(a[j], a[k])`. Moreover, the values `a[S[0]], a[S[1]], ..., a[top]` are strictly monotone (in the direction opposite to `op`).

**Proof by induction on i.**

*Base case (i = 0).* Before any iteration, `S` is empty -- vacuously every index satisfying the property is on the stack, and the empty sequence is trivially monotone. After the first iteration, only index 0 is pushed; there are no candidates `k` in `[1, 0]`, so the claim holds.

*Inductive step.* Assume the claim holds after processing `a[0..i-1]`. In iteration `i` we pop every `j` on top for which `op(a[j], a[i])` -- these are precisely the indices whose answer is now resolved by `i`, so they leave the stack with the correct `record(j, i)`. The remaining indices satisfy `not op(a[j], a[i])`, so `i` does not break their pending status; the invariant of the unpopped portion is preserved. Pushing `i` adds an index for which no future `k > i` has yet been seen -- its answer is correctly pending. Monotonicity is preserved because we stopped popping precisely when the comparison failed.

*Termination.* The outer loop runs `n` times. The inner loop's total number of iterations across all outer iterations is bounded by `n` because each index is pushed at most once and popped at most once. The final draining loop runs at most `|S|` <= `n` times. Total iterations: at most `3n`.

*Postcondition.* After the final draining loop, every index has `record(j, .)` set: either to some `i < n` where `op` first held, or to `n` (the sentinel meaning "no such index").

**Q.E.D.**

---

## Amortized Analysis -- Aggregate Method

**Theorem.** `MonoScan(a, op)` runs in O(n) time.

**Aggregate analysis.** Let `T(n)` be the total number of stack operations (pushes plus pops) performed across the entire algorithm. We count pushes and pops separately.

- **Pushes:** the outer loop runs exactly `n` times and pushes exactly one index per iteration -- total `n` pushes.
- **Pops:** each index is popped at most once over its lifetime, either by the inner while loop (resolving its answer to some `i < n`) or by the final draining loop (resolving to `n`). An index that is never pushed is never popped. Total pops <= `n`.

Hence `T(n) <= 2n`, and the amortized cost per iteration is `T(n) / n <= 2 = O(1)`. The total running time is O(n).

**Q.E.D.**

---

## Amortized Analysis -- Accounting Method

The aggregate method is the cleanest. The accounting method gives the same bound with extra intuition: we assign a **charge** to each operation that may exceed its actual cost, then show the bank account never goes negative.

Charge each push 2 credits. Real cost of a push: 1 credit. Save the extra 1 credit on the stack at the pushed index.

When the inner while loop pops an index, the pop costs 1 credit. Pay it from the saved credit at the popped index. The bank account stays non-negative.

Total charge: 2n credits (across n pushes). Total actual cost: at most 2n stack ops + n outer-loop overheads = O(n).

This view -- pushes prepay for their eventual pop -- is the same idea used to amortize the dynamic-array doubling resize. It generalizes: any technique where each element is touched a constant number of times across its lifetime admits this accounting.

---

## Cartesian Tree Connection

A **Cartesian tree** over `a[0..n-1]` is a binary tree:

- The root is the index of the minimum (or maximum) of the array.
- The left subtree is the Cartesian tree of `a[0..root-1]`.
- The right subtree is the Cartesian tree of `a[root+1..n-1]`.

Naively this is O(n^2). With a **monotonic stack**, you can build the Cartesian tree in O(n).

**Construction (min-heap variant).** Maintain a stack of "spine" nodes whose values are increasing from bottom to top. For each new element `a[i]`:

1. Pop all stack elements `>= a[i]`. Let the last popped node be `L`.
2. Make `L` the **left child** of the new node `a[i]`.
3. If the stack is non-empty, make the new node the **right child** of the new top.
4. Push the new node onto the stack.

The amortized analysis is identical to the next-smaller-element scan. After processing all `n` elements, the stack contains the right spine of the tree.

**Key property.** The in-order traversal of the Cartesian tree built this way yields exactly the original array. This is not a coincidence: the construction preserves left-right order while assigning depth by min-heap rank.

```text
Array:                  [3, 1, 4, 1, 5, 9, 2, 6]
Cartesian tree (min):
                          1 (index 1)
                         / \
                        3   1 (index 3)
                             \
                              2 (index 6)
                             / \
                            4   6 (index 7)
                             \
                              5
                               \
                                9
                  (a partial visualization -- index 3 is the tied min)
```

The presence of duplicates produces non-unique trees; tie-breaking is by left-most index.

---

## Range Minimum Query via Cartesian Tree + LCA

The Cartesian-tree construction is the gateway to **constant-time range minimum query** with linear preprocessing -- the Farach-Colton-Bender result.

**Setup.** Given an array `a[0..n-1]`, the range minimum query `RMQ(l, r)` is "the index of the minimum value of `a[l..r]`."

**Observation.** If `T` is the min-heap Cartesian tree of `a`, then `RMQ(l, r) = LCA(l, r)` in `T`, where `LCA` is the lowest common ancestor and the nodes are identified by their indices.

**Proof sketch.** The LCA of `l` and `r` in `T` is the deepest node `m` such that `l` is in `m`'s left subtree and `r` is in `m`'s right subtree (or `m = l` or `m = r`). By the Cartesian-tree definition, `m` is the index of the minimum of the range `[m-1's left-subtree-min, m+1's right-subtree-max]`, which contains `[l, r]`. Conversely, any index in `[l, r]` other than `m` has value > `a[m]` (by tree construction). So `m` is the argmin of `a[l..r]`.

**Putting it together.** Preprocessing: build the Cartesian tree in O(n) (monotonic stack), reduce LCA to ±1-RMQ via the Euler tour in O(n), then solve ±1-RMQ in O(n) preprocessing / O(1) query (block decomposition + sparse table on superblocks). The whole pipeline is O(n) preprocessing, O(1) query -- the best possible for this problem.

The Cartesian-tree step -- the monotonic stack -- is the surprising entry point. Without it, RMQ would need O(n log n) preprocessing.

---

## Lower Bounds for Next-Greater-Element

For the **offline** next-greater-element problem (entire input known in advance), the monotonic-stack algorithm runs in O(n), which is optimal: the output has n entries, so any algorithm needs Omega(n) time.

For the **online** version, where elements arrive one at a time and the answer for index `j` must be reported as soon as it is determined, no algorithm can do strictly better. Lower bound argument: an adversary may delay all answers by appending a single very large element only at time `n`. The algorithm must hold all `n` unresolved indices in memory in the worst case, so Omega(n) space and Omega(n) cumulative reporting time are necessary.

For the **comparison-based** decision-tree model, computing the NGE array requires at least `n - 1` comparisons in the worst case (proof: a strictly decreasing input requires every adjacent pair to be compared to confirm no NGE exists). The monotonic-stack algorithm achieves this bound exactly: it performs `n - 1` "useful" comparisons plus the same number of "stop" comparisons -- O(n) total, matching the lower bound up to a constant factor.

For the **circular** variant (LeetCode 503), where indexing wraps around, the monotonic-stack algorithm doubles the input and runs in O(n). The output size is still n, so this is optimal.

---

## Randomized Variants

For most monotonic-stack problems randomization adds nothing -- the deterministic O(n) algorithm is already optimal. There are, however, two settings where randomized analysis is informative.

### Expected stack depth under random input

Suppose `a[0..n-1]` is a uniformly random permutation of `n` distinct values. What is the expected depth of the decreasing monotonic stack after processing the entire array?

Let `X_i` be the indicator that index `i` is still on the stack at the end -- equivalently, that `a[i]` is greater than every later element `a[i+1], ..., a[n-1]`. For a random permutation, `Pr[X_i = 1] = 1 / (n - i)` (only one of the remaining `n - i` values is the maximum, and it could be `a[i]`).

```text
E[final depth] = Sum over i of 1 / (n - i)
              = Sum_{k=1..n} 1/k
              = H_n  (n-th harmonic number)
              = Theta(log n)
```

The expected final stack depth is O(log n) under uniform random input. In production this means a monotonic stack used on randomly ordered streams has a tiny working set -- usually under 30 indices even for n = 10^9. That is why the technique behaves so well on real-world data even when adversarial worst case is O(n).

### Concentration

Chernoff bounds on the sum of (negatively correlated) indicators give `Pr[final depth > 4 log n] <= 1/n^c` for a suitable constant `c`. So on uniform random input the probability of pathological depth is vanishingly small. Adversarial input is what breaks this guarantee -- a strictly sorted array forces depth `n`.

---

## Persistent Monotonic Stack

A **persistent** data structure preserves all past versions of itself across modifications. A persistent monotonic stack lets you, after the algorithm has run, query "what was the stack state at iteration i?" in O(log n) time, paying O(log n) per push/pop during the original run.

**Construction.** Replace the mutable stack array with a path-copy persistent linked list. Each push creates a new head node; each pop returns the tail. Both are O(1). To query the stack at iteration `i`, store the head reference for each iteration in an array `heads[0..n]`. Total memory: O(n) (each push allocates O(1)).

**Useful for:**
- Offline range queries: "in a query `(l, r)`, what is the next-greater-element of `a[l]` looking only at `a[l+1..r]`?" -- via persistent segment-tree style traversal.
- Functional implementations in languages without mutation (Clojure, Haskell, OCaml).
- Time-travel debugging of monotonic-stack-based pipelines.

**Cost.** Pure-functional implementations pay an O(log n) factor due to GC pressure and indirection. For most production use the imperative O(1)-per-op version is preferable; persistence is a niche tool.

---

## Comparison with Alternatives

| Attribute | Monotonic stack | Sparse table RMQ | Segment tree | Naive scan |
|-----------|-----------------|------------------|--------------|------------|
| Preprocessing | O(n) | O(n log n) | O(n) | 0 |
| Query | O(1) amortized over n queries (one per index) | O(1) per range | O(log n) per range | O(n) |
| Updates | Not supported | Not supported | O(log n) | O(1) |
| Space | O(n) | O(n log n) | O(n) | O(1) |
| Cache friendly | Yes (sequential) | Yes (table lookup) | Moderate | Yes |
| Deterministic | Yes | Yes | Yes | Yes |

The monotonic stack dominates when the query pattern is exactly one "nearest greater/smaller" per element with no updates. For arbitrary range queries the sparse table is asymptotically better; for queries-with-updates the segment tree is the right tool.

---

## Cache-Oblivious Analysis

The monotonic-stack scan has excellent cache behavior. The input array is read sequentially -- every byte fits in the prefetch pipeline. The stack itself is a contiguous array (or array-backed deque) that grows and shrinks at the top, with locality of reference. In the EM (external memory) model with block size B:

```text
I/Os for MonoScan = Theta(n / B)
```

The naive O(n^2) alternative reads the array repeatedly and has Theta(n^2 / B) I/Os, which is worse by a factor of n. On large arrays that exceed cache the monotonic-stack version is not just asymptotically faster -- it is faster in absolute wall-clock time by orders of magnitude for arrays that exceed L3.

The output array (e.g., `result[0..n-1]`) is also written sequentially in the streaming variant. Random-access writes occur in the standard variant (we write `result[popped]` for arbitrary popped indices), which is fine in DRAM but a measurable cost on persistent-memory targets. For NVDIMM-resident outputs, batch the writes via a small buffer.

---

## Reduction Sketch: Decreasing Subsequences

The monotonic stack also figures in the **longest decreasing subsequence ending at i** computation when combined with the patience-sorting trick. The naive DP is O(n^2); patience sorting reduces it to O(n log n). The monotonic-stack pattern is the building block: each pile's top forms a non-strict decreasing sequence over time, and a binary search picks the right pile.

```text
For LIS / LDS in O(n log n):
  - Process elements left to right.
  - Maintain piles (each pile's top is the smallest end of an increasing subseq of that length).
  - Place new element on the leftmost pile whose top >= element (binary search).
  - The number of piles at the end is the LIS length.

The piles' tops form a monotone sequence -- the same invariant the monotonic stack maintains.
```

This is not a strict monotonic-stack algorithm, but it generalizes the same invariant. Recognizing the family connection helps when designing variants for new problems.

---

## Summary

The monotonic stack admits a tight O(n) bound, proven by aggregate or accounting amortized analysis. Its correctness rests on a simple loop invariant: the stack contains precisely the indices whose answer is still pending, in monotone order.

The deepest connection is with **Cartesian trees**: the monotonic-stack scan implicitly builds the Cartesian tree of the input in linear time. That construction is the linear-preprocessing step of the optimal RMQ algorithm (Farach-Colton-Bender) -- linking monotonic stacks to range-minimum query and, via LCA, to a much broader class of tree-decomposition algorithms covered in section 09 (trees).

Online and circular variants match the offline bound up to constant factors. Persistent variants are O(log n) per operation but rarely needed in practice. The monotonic stack remains one of the most elegant amortized-O(1) primitives in the algorithm designer's toolkit.
</content>
</invoke>