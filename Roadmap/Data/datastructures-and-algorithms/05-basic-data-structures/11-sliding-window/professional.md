# Sliding Window — Mathematical Foundations and Complexity Theory

## Table of Contents

1. [Formal Definition](#formal-definition)
2. [Correctness via Loop Invariants](#correctness-via-loop-invariants)
3. [Amortized O(n) Argument](#amortized-on-argument)
4. [Lower Bounds](#lower-bounds)
5. [Monotonicity Requirement](#monotonicity-requirement)
6. [Streaming Model](#streaming-model)
7. [Parallel Sliding Window](#parallel-sliding-window)
8. [Comparison Summary](#comparison-summary)
9. [Summary](#summary)

---

## Formal Definition

```text
Definition. Let A = (a_0, a_1, ..., a_{n-1}) be a sequence over a domain D.
A sliding-window algorithm SW = (S, phi, init, push, pop, query) where:

  S    : state space
  phi  : D* -> Bool      predicate (the invariant)
  init : S               initial state
  push : S x D -> S      add an element to the right
  pop  : S x D -> S      remove an element from the left
  query: S -> R          answer function

For each step r in [0, n-1] SW maintains a window [l_r, r] satisfying
phi(a_{l_r}, ..., a_r) = true, where l_r is monotonically non-decreasing in r,
and emits answer y_r = query(state at step r).

A sliding window is FIXED-SIZE if l_r = max(0, r - k + 1) (forced).
A sliding window is VARIABLE-SIZE if l_r is chosen to be the smallest index
such that phi holds (shortest-shrink discipline).
```

The monotone movement of `l_r` is the structural property that buys the linear time bound; if `l_r` were allowed to move backwards the algorithm would no longer be a sliding window in any meaningful sense.

---

## Correctness via Loop Invariants

We prove correctness of the canonical variable-size sliding window for the problem **"longest contiguous segment of `a` satisfying monotone predicate `phi`"**.

```text
ALGORITHM. LongestSlidingWindow(a, phi, push, pop, init)
  state <- init
  l <- 0
  best <- 0
  for r = 0 .. n - 1:
      state <- push(state, a[r])
      while not phi(state):
          state <- pop(state, a[l])
          l <- l + 1
      best <- max(best, r - l + 1)
  return best
```

**Loop invariant I.** At the top of every iteration with index `r`:
```text
  (i)   state == fold(init, push, a[l..r-1])     # state exactly summarises window [l..r-1]
  (ii)  phi(state) == true                       # window [l..r-1] is valid
  (iii) l is the smallest non-negative index for which (ii) holds
  (iv)  best == max over (r', l') of (r' - l' + 1) where window [l'..r'-1] is valid
```

**Base case (`r = 0`).** Before the first iteration, `state = init`, `l = 0`, `best = 0`. The window `[0..-1]` is empty; (i)-(iii) trivially hold because `phi` is assumed to hold on the empty window (standard assumption for monotone invariants); (iv) holds because no non-empty windows have been examined.

**Inductive step.** Assume `I` holds at the top of iteration `r`. After the line `state <- push(state, a[r])`:

- The state now equals `fold(init, push, a[l..r])`, so (i) holds with `r-1` replaced by `r`.
- `phi(state)` may now be false (we just expanded).

The `while` loop pops `a[l]` while `phi(state)` is false. Each pop preserves (i) for the **smaller** window `[l+1..r]` and increments `l`. The loop terminates because either `phi` becomes true at some `l <= r` (possibly producing an empty window with `l = r + 1` if even `[r..r]` violates `phi`) or `l` exceeds `r`, at which point the empty-window assumption restores `phi`.

After the `while` exits, `phi(state)` is true and `l` is the smallest index for which `phi` holds with right endpoint `r` (because the loop stopped at the **first** index that restored `phi`). Thus (ii) and (iii) hold.

The next line updates `best <- max(best, r - l + 1)`, which extends (iv) by exactly the maximum-length valid window ending at `r`. Together with the previous best, (iv) holds.

**Termination.** `r` strictly increases by 1 each iteration of the outer loop; the loop runs exactly `n` times. The inner `while` strictly increases `l`, and `l <= r + 1` is bounded.

**Postcondition.** At loop exit, `r = n` and (iv) holds over all `r' in [0, n-1]` and all windows. Therefore `best` equals the longest valid window length. **QED.**

The same skeleton applies to fixed-size windows; replace step `r`'s push/pop pair with a forced pair that moves both pointers in lockstep.

---

## Amortized O(n) Argument

We give two proofs that the variable-size template runs in `O(n)` time, both using the standard amortized-analysis toolkit.

### Aggregate method

```text
Let T(n) = total time over all n iterations.

For each iteration r:
  - exactly one push (constant time, by assumption)
  - some number k_r >= 0 of pops (each constant time)
  - one max comparison (constant)

T(n) = sum over r of (1 + k_r + 1) = 2n + sum k_r

Sum k_r is the total number of pops over the run. Since l can only INCREASE
and l <= n (it never exceeds the rightmost index), the total number of pops
is at most n.

Therefore T(n) <= 2n + n = 3n = O(n).
```

### Potential method

```text
Define potential Phi(s) = (number of elements currently in the window)
                       = (r + 1 - l) at state s after iteration r.

Phi(s_0) = 0 (empty window before iteration 0).
Phi(s) >= 0 always.

For iteration r:
  actual cost c_r = 1 (push) + k_r (pops) + 1 (compare)
  delta Phi = +1 (push) - k_r (each pop reduces window length by 1)

Amortized cost a_r = c_r + delta Phi = (1 + k_r + 1) + (1 - k_r) = 3.

Total amortized = 3n; total actual = total amortized + Phi(s_0) - Phi(s_n)
                                  <= 3n + 0 - 0 = 3n.

So T(n) = O(n).
```

Both proofs depend on two structural facts of sliding window:
1. The pointer `l` is monotonically non-decreasing.
2. `push` and `pop` cost `O(1)` (given a suitable state — hash map ops are amortized `O(1)`; monotonic deque ops are amortized `O(1)` for the same reason).

If either fails — say, the state has `O(log n)` per-op cost (a balanced BST), or you allow `l` to back up — the bound degrades to `O(n log n)` or worse.

---

## Lower Bounds

```text
Theorem (read-once lower bound).
   Any algorithm that produces query(window) for every right endpoint
   r in [0, n-1] must inspect each input element at least once.
   Therefore any sliding-window algorithm is Omega(n).

Proof. Suppose an algorithm A produces the correct output sequence
y_0, ..., y_{n-1} without reading a[i] for some i. Construct two
inputs that differ only in a[i] but whose correct outputs disagree
at some r >= i (always possible for nontrivial query). A produces the
same output on both inputs (since it does not read a[i]). Contradiction.
Therefore A reads every a[i]. Time is Omega(n).  QED.
```

The matching upper bound `O(n)` from the amortized argument shows sliding-window is **asymptotically tight**: `Theta(n)`.

```text
Theorem (window-max lower bound).
   Computing max of every length-k window of a length-n array, in the
   COMPARISON model, requires Omega(n) comparisons even with k fixed.

Sketch. Each output entry is determined by inspecting at most k inputs;
an adversary can force every right shift to require at least one new
comparison. Tighter bounds (Omega(n log k)) hold without amortization;
the monotonic deque achieves O(n) amortized which is optimal.
```

This is what makes the monotonic deque trick from [14-monotonic-queue](../14-monotonic-queue/professional.md) optimal — it matches the read-once lower bound.

---

## Monotonicity Requirement

The variable-size template depends on a structural property called **monotonicity of the invariant under expansion**:

```text
Definition. A predicate phi over windows is monotone (closed under shrink) if:
   for all l <= l' <= r, phi(a[l..r]) = true implies phi(a[l'..r]) = true.

Equivalently: removing elements from the LEFT can only preserve or
restore validity, never break a valid window.
```

When `phi` is monotone the shrink-while loop is sound: once shrinking restores `phi`, every subsequent shorter window is also valid (so we have found the smallest valid `l`). If `phi` is not monotone, shrinking might overshoot a valid window and miss the answer.

### Examples and counter-examples

| Predicate | Monotone? | Reason |
|-----------|-----------|--------|
| `sum(window) <= K` with `a[i] >= 0` | Yes | Removing non-negatives can only decrease sum. |
| `sum(window) <= K` with mixed signs | No | Removing a negative INCREASES sum, can break validity. |
| `count of distinct chars <= k` | Yes | Removing chars can only reduce distinct count. |
| `count of distinct chars == k` (exactly) | No | Removing chars can drop below `k`. |
| "all 26 letters present" | Yes | Adding letters can only restore; equivalently shrinking can only break. |
| `max(window) - min(window) <= K` | Yes | Removing elements can only reduce the gap. |
| `window contains every char of target T` | Yes | Removing one occurrence can break the membership requirement. |

For non-monotone invariants, sliding window is the **wrong tool**. The standard fallback is prefix-sum + hash map (for "exact sum"), or sorted-multiset with `O(log n)` operations (for `==` constraints), or a different algorithmic approach entirely (DP, segment tree, two-pointers with bookkeeping).

---

## Streaming Model

The sliding window is the prototypical algorithm for the **streaming model** of computation:

```text
Streaming model.
  Input: x_1, x_2, x_3, ... arrives one element at a time.
  Memory budget: poly(log n) or O(W) for window of size W.
  Output: after seeing any prefix, answer queries about the recent W elements.
```

Classical theory results for sliding window in the streaming model:

| Problem | Best known memory | Reference |
|---------|------------------|-----------|
| Count of 1s in last W bits | O(log^2 W / eps) for (1+eps)-approx | Datar-Gionis-Indyk-Motwani 2002 (exponential histograms) |
| Sum of last W reals | O(log W / eps) for (1+eps)-approx | DGIM extension |
| Distinct elements in last W | O(log^2 W * (1/eps) log(1/eps)) | Various — see Gibbons-Tirthapura |
| Heavy hitters in last W | O((1/eps) log W) | Misra-Gries variant |
| Frequency moments F_k | Sub-linear sketches | Charikar-Chen-Farach-Colton |

The takeaway: **exact** sliding-window aggregates over an infinite stream of count window `W` require `Theta(W)` memory. **Approximate** aggregates within `(1 +/- eps)` can use polylog memory. Production systems exploit this aggressively — see senior.md on HyperLogLog (distinct), Count-Min Sketch (heavy hitters), t-digest (quantiles), all of which are mergeable across shards.

Cross-link to [22-randomized-structures](../../) for sketch families and to [21-advanced-structures](../../) for exponential histograms.

---

## Parallel Sliding Window

Sliding window resists parallelization because the answer at position `r` formally depends on the entire prefix up to `r`. Three production parallelization strategies:

### Strategy 1 — Chunk with boundary fixup

```text
Split A into chunks C_1, C_2, ..., C_p of size n/p each.
For each chunk in parallel, run sliding window LOCALLY.
For each boundary between C_i and C_{i+1}, recompute the windows that
straddle the boundary (at most W of them).

Cost: O(n/p) per worker + O(W p) merge -> O(n/p + W p).
Speedup is optimal at p = sqrt(n/W).
```

This works for monotone, decomposable aggregates (sum, count, max). It does **not** work for inherently sequential aggregates (running median where the boundary depends on the entire prefix's distribution).

### Strategy 2 — Mergeable aggregate sketches

Build per-chunk **sketches** that merge in `O(polylog)` time:

- t-digest for quantiles.
- HyperLogLog for distinct count.
- Count-Min Sketch for heavy hitters.
- Reservoir samples for random samples.

Each chunk produces a sketch in `O(n/p)`; merging `p` sketches takes `O(p polylog)`; querying takes `O(polylog)`. Total `O(n/p + p polylog)`, optimal for `p = sqrt(n / polylog)`.

### Strategy 3 — SIMD / vectorized per-step

For fixed-size sum windows on numeric arrays, SIMD instructions process 4-16 elements per cycle. The sequential dependence is the **prefix sum** of differences; modern CPUs have `vpaddq` plus shuffle that compute prefix sums in parallel within a 256-bit register.

In practice the production wins come from Strategy 1 + 2 combined; SIMD wins on hot inner loops in databases and analytical engines (DuckDB, ClickHouse).

---

## Comparison Summary

| Aspect | Sliding window | Prefix sum | Segment tree |
|--------|----------------|------------|--------------|
| Time per step | O(1) amortized | O(1) after O(n) precompute | O(log n) |
| Mutations | Streaming | Static | O(log n) |
| Range query shape | Contiguous, monotone left pointer | Arbitrary range | Arbitrary range |
| Distinct elements | Yes (with set state) | No (not composable) | Mergeable variants exist |
| Negatives in sum | No | Yes | Yes |
| Parallel friendliness | Hard (sequential pointer) | Easy (prefix scan is parallel) | Easy (tree merge) |
| Cache locality | Excellent (linear scan) | Excellent | Good (tree levels) |
| Worst-case memory | O(W) | O(n) | O(n) |

---

## Summary

The sliding window achieves `Theta(n)` time exactly because its left pointer is monotonically non-decreasing; this single structural property powers both the loop-invariant correctness proof and the amortized aggregate/potential analysis. The matching `Omega(n)` lower bound comes from the read-once requirement on any algorithm that emits a per-position answer. The variable-size template demands a **monotone** invariant — without monotonicity, shrink can overshoot and the algorithm is incorrect, which is why mixed-sign sum constraints, exact-count equality, and order statistics all need prefix sums, hash maps, or balanced trees instead. Streaming and parallel settings extend the picture: exact aggregates over infinite streams need `Omega(W)` memory; approximate aggregates compress to polylog via mergeable sketches; parallelization is bounded by the sequential prefix dependence but admits chunk-with-boundary-fixup and mergeable-sketch strategies that hit `O(n/p + sqrt(n))` work.
