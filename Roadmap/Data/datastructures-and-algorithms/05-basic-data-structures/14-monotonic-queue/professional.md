# Monotonic Queue — Mathematical Foundations and Complexity

## Table of Contents

1. [Formal Definition](#formal-definition)
2. [Loop Invariant and Correctness](#loop-invariant-and-correctness)
3. [Amortized Analysis via Aggregate Method](#amortized-analysis-via-aggregate-method)
4. [Amortized Analysis via Potential Function](#amortized-analysis-via-potential-function)
5. [Lower Bound Discussion](#lower-bound-discussion)
6. [Connection to Convex Hull Trick](#connection-to-convex-hull-trick)
7. [Persistent Monotonic Deque](#persistent-monotonic-deque)
8. [Parallel Sliding Window](#parallel-sliding-window)
9. [Summary](#summary)

---

## Formal Definition

```text
Let a in Z^n be an input sequence and k in N a window size, 1 <= k <= n.
For each i in [k-1, n-1], define:
    W_i = { i - k + 1, ..., i }                       (window of size k ending at i)
    m_i = argmax_{j in W_i} a[j]                       (index of max in W_i; ties broken later)
    M_i = a[m_i]

Goal: output M_{k-1}, M_k, ..., M_{n-1}.

A monotonic deque D is a sequence of indices D = [d_1, d_2, ..., d_t] satisfying
two invariants after processing index i:

  (I1) Window invariant:    d_1 >= i - k + 1
  (I2) Monotone invariant:  a[d_1] > a[d_2] > ... > a[d_t]      (for "max" version, using strict <)
       (variant) a[d_1] >= a[d_2] >= ... >= a[d_t]              (if ties are allowed to coexist)

The algorithm maintains both invariants and outputs M_i = a[d_1] for i >= k - 1.
```

The two ends of the deque do different things:

- **Front** is dictated by the window left edge (a *time* constraint).
- **Back** is dictated by the monotone invariant (a *value* constraint).

This is what distinguishes a monotonic deque from a monotonic stack: the stack has only one end and therefore only one constraint.

---

## Loop Invariant and Correctness

> **Claim.** After the i-th outer iteration of the sliding window max algorithm, invariants (I1) and (I2) hold and the recorded value (for i >= k - 1) equals `M_i`.

**Loop body** (one iteration, for input index `i`):

```text
1. while D non-empty and D.front() < i - k + 1: D.pop_front()
2. while D non-empty and a[D.back()] < a[i]:   D.pop_back()
3. D.push_back(i)
4. if i >= k - 1: emit a[D.front()] as M_i
```

**Invariant `I`:** Before iteration `i`, the deque represents the maximum-candidate indices in `W_{i-1}` in strictly decreasing value order (or empty for `i = 0`).

**Base case (`i = 0`):** Deque is empty. `I` holds vacuously.

**Inductive step:** Assume `I` before iteration `i`. We show `I` holds before iteration `i+1`.

1. Step 1 removes any index that is no longer in `W_i`. After this step, all indices in `D` satisfy `D.front() >= i - k + 1`, which is the new window's lower bound; (I1) holds for `W_i` minus the new element.
2. Step 2 removes back elements whose value is `< a[i]`. These removed indices `j` satisfy:
   - `j < i` (they were already in `D`)
   - `a[j] < a[i]`
   - For every future window `W_h` with `j, i in W_h`, the index `i` dominates `j` for the max — so `j` is never the answer once `i` exists.
   Removing them is safe and preserves the answer.
3. Step 3 pushes `i`. The back is now `i`. Combined with step 2, all elements at positions before the back have strictly greater value (or equal, depending on the comparison chosen).
4. Step 4 emits `a[D.front()]`, which by invariant equals `max_{j in W_i} a[j] = M_i`.

After steps 1-4, both (I1) and (I2) hold for `W_i`. Invariant `I` holds before iteration `i+1`.

**Termination:** The for-loop runs exactly `n` iterations. The inner while loops are bounded because each index is pushed once (step 3) and popped at most once across the entire run (steps 1 and 2). The algorithm terminates after `n` outer iterations.

**Postcondition:** For each `i in [k-1, n-1]`, the emitted value equals `M_i`. **QED.**

---

## Amortized Analysis via Aggregate Method

> **Claim.** The total cost of the sliding window max algorithm is `T(n) = O(n)`.

Let `c_i` be the actual cost of iteration `i`, where one "cost unit" is one push or pop. We do not count comparisons separately because each pop is paired with one comparison and each push with at most one.

```text
c_i = 1            (push of index i)
    + p_i^front    (number of front pops at iteration i)
    + p_i^back     (number of back pops at iteration i)
```

**Pushes.** Exactly one push per outer iteration. Total pushes = `n`.

**Pops.** Each index `i` enters the deque once (at step 3 of iteration `i`) and leaves the deque at most once (either via front-pop in some later iteration or back-pop in some later iteration). Once popped, an index never returns. So:

```text
sum_{i=0}^{n-1} (p_i^front + p_i^back) <= n
```

Total cost:

```text
T(n) = sum_{i=0}^{n-1} c_i
     = n + sum_{i=0}^{n-1} (p_i^front + p_i^back)
     <= n + n
     = 2n
     = O(n)
```

**Amortized cost per outer iteration** = `T(n) / n = O(1)`. **QED.**

The aggregate method is the right framing here: any individual iteration can be expensive (think of a long flush of the deque on a sudden large input), but the total work is bounded.

---

## Amortized Analysis via Potential Function

For practice, here is the same result via the potential method.

Define the potential function `Phi(D) = |D|` (deque size). Note `Phi >= 0` and `Phi(D_0) = 0`.

The **amortized cost** of iteration `i` is:

```text
a_i = c_i + Phi(D_i) - Phi(D_{i-1})
```

Where `c_i = 1 + p_i^front + p_i^back` as before and:

```text
Phi(D_i) - Phi(D_{i-1}) = 1 - p_i^front - p_i^back
                          (one push +1, each pop -1)
```

Therefore:

```text
a_i = (1 + p_i^front + p_i^back) + (1 - p_i^front - p_i^back) = 2
```

Each amortized cost is exactly `2`, a constant. Summing:

```text
sum a_i = 2n
sum c_i = sum a_i + Phi(D_0) - Phi(D_n) <= 2n + 0 - 0 = 2n
```

So `T(n) = O(n)`. **QED.**

The potential method makes the per-iteration bound transparent: every iteration "costs" exactly 2 amortized units regardless of how many pops it actually triggers.

---

## Lower Bound Discussion

A natural question: is `O(n)` optimal for sliding window maximum?

**Comparison-based lower bound for offline range max.** The classical lower bound for range-minimum-query (RMQ) is `Omega(n)` preprocessing and `Omega(1)` query — already optimal asymptotically; sparse tables achieve `O(n log n)` preprocessing and `O(1)` query, and the Bender-Farach-Colton construction achieves linear preprocessing.

**For the sliding window (online with monotone left edge).** The output has `n - k + 1` values, so any algorithm must do at least `Omega(n)` work simply to emit them. The monotonic deque achieves this lower bound exactly: `O(n)` total. There is no asymptotic room to improve.

**Comparison count.** Each pop is preceded by exactly one comparison, and each iteration uses one comparison even when no back-pop happens (the check that fails). The total comparison count is bounded by `2n` (one for the push check, at most one for the pop). This is information-theoretically minimal up to a constant: an adversary can construct inputs where any algorithm must do `Omega(n)` comparisons just to know whether each new element is larger than the previous extremum.

**Subtle point about "beats `n log k`."** A naive heap-based approach would give `O(n log k)` per element. One might guess `Omega(n log k)` is the lower bound. It is not — the monotonic deque achieves `O(n)`, independent of `k`. The deque does this by *exploiting structure across time*: the answer at step `i+1` reuses work from step `i` in a way that a heap-of-fixed-size does not. The reason heap-based solutions are `O(n log k)` is that they over-solve the problem (they maintain a fully sorted structure when only the max matters).

This is a useful insight to articulate in interviews: "the deque is not faster because it does the same work cheaper; it is faster because it does less work, by only tracking values that can still become the max in some future window."

---

## Connection to Convex Hull Trick

A monotonic deque generalizes naturally to maintaining the **lower envelope of a set of lines** — the **convex hull trick** (CHT), often used to optimize DP recurrences of the form:

```text
f(i) = min_{j < i} ( f(j) + b_j * x_i + c_j )
```

The inner expression `f(j) + b_j * x_i + c_j` is linear in `x_i` for each fixed `j`. The "best `j`" is the line that achieves the minimum at the point `x_i`. The set of all lines forms a piecewise-linear lower envelope; the answer at `x_i` is the envelope value.

When the slopes `b_j` are monotone in `j` and the queries `x_i` are monotone (both common in DP), the lower envelope can be maintained by a **monotonic deque of lines**:

```text
- Push a new line L from the back.
- While the back-most line is dominated by L and the second-to-back line
  (i.e., the intersection of L with the second-to-back falls left of
  the intersection of back-most with second-to-back), pop the back.
- Push L.
- When answering a query x_i with x_i monotone, pop from the front while
  the second line gives a smaller value than the front.
- Front line is the answer.
```

The structure of the algorithm is identical: push from back with maintenance, pop from front by monotone progress. The invariant changes from "values are monotone" to "the intersections of consecutive lines are monotone (the slopes form a convex sequence)."

CHT achieves `O(n)` total when both slopes and queries are monotone, and `O(n log n)` (via Li Chao tree or a binary search inside the hull) otherwise. The Li Chao tree is the segment-tree-based generalization that drops the monotonicity requirement.

This is one of the classic examples in advanced DP optimization. See [13-dynamic-programming/10-convex-hull-trick-li-chao](../../13-dynamic-programming/10-convex-hull-trick-li-chao/junior.md) for the dedicated treatment (when written).

---

## Persistent Monotonic Deque

A **persistent** version of a data structure remembers every past version, allowing queries against any historical state without mutation.

A purely functional deque can be built from two linked lists representing the front half and the back half:

```text
type PDeque[T] = (front: List[T], back: List[T])

push_back(d, x)  = PDeque(d.front, Cons(x, d.back))
push_front(d, x) = PDeque(Cons(x, d.front), d.back)

pop_front(d):
    case d.front:
        Cons(h, t) -> (h, PDeque(t, d.back))
        Nil -> rebalance(d) then pop_front
```

Persistent doubly-ended queues with O(1) amortized operations exist (Okasaki 1998, *Purely Functional Data Structures*); banker's deques and real-time deques give worst-case O(1).

Layering monotonicity on top requires care: each push from the back may pop multiple elements, and in a persistent setting those pops must not destroy the prior version. The trick is to share structure aggressively — the popped elements still exist in the previous version's representation, only the new version's tail changes.

A persistent monotonic deque is useful when you need a *retroactive* sliding window query: "what was the max in the window `[i, i+k-1]` for some `i` chosen later?" Persistent representations answer this in O(log n) per query with `O(n log n)` total memory, vs. the trivial `O(n*k)` rebuild approach.

For deeper treatment of persistent structures, see [21-advanced-structures](../../21-advanced-structures/) (when those topics are written).

---

## Parallel Sliding Window

The sequential algorithm is inherently iterative: iteration `i` depends on the deque state after `i - 1`. To parallelize, abandon the deque view and use a **divide-and-conquer** formulation.

**Block decomposition.** Split the array into `n / B` blocks of size `B`. For each block, precompute:

- `prefix_max[j]`: max of the block from its start through position `j`.
- `suffix_max[j]`: max of the block from position `j` through its end.

Then for any window of size `k` that straddles two blocks at positions `[l, r]`:

```text
max(a[l..r]) = max(suffix_max[l in left block], prefix_max[r in right block])
```

For windows entirely inside one block, prefix or suffix max suffices.

Choosing `B = k` makes every window touch exactly one or two blocks. Total work: `O(n)` for block prefix/suffix max + `O(n)` to assemble answers = `O(n)`. The blocks are independent and can be computed in parallel — `O(n / P + log P)` span on `P` processors.

This algorithm is sometimes called **Sliding RMQ** and is the basis for parallel implementations in libraries such as Intel TBB and CUB (CUDA).

A second parallel strategy is **prefix-doubling**: precompute `max[i..i+2^j-1]` for all `i, j` (a sparse table) using `O(n log n)` work and `O(log n)` span. Then each window query is `O(1)`. The sparse table requires `O(n log n)` memory, vs. the deque's `O(k)`, but it parallelizes more flatly.

In practice, the sequential monotonic deque dominates for streaming or near-streaming data because the structure is inherently sequential. Parallel approaches matter when:

- The input is fully materialized in memory and you want bulk processing speed.
- You are running on a GPU or wide-vector CPU where the deque's sequential dependency stalls the pipeline.
- The work per element is large enough to amortize the higher constant factor of the parallel algorithm.

---

## Summary

| Question | Answer |
|----------|-------|
| Is the algorithm correct? | Yes — proven by invariant `I` plus base case and inductive step. |
| What is the total time? | `O(n)` — proven by aggregate method and potential method. |
| Is `O(n)` optimal? | Yes — the output has `n - k + 1` values, so `Omega(n)` is the lower bound. |
| Why does the deque beat the heap's `O(n log k)`? | Because it does asymptotically less work, not the same work faster. |
| How does it generalize? | Convex hull trick maintains a lower envelope of lines using the same push-back-with-maintenance, pop-front-with-monotone-progress shape. |
| Can it be persistent? | Yes — persistent deques are a known result; adding the monotone invariant requires careful structural sharing. |
| Can it be parallelized? | Yes — via block prefix/suffix max with `O(n)` work and `O(log P)` span. |

At the professional level the monotonic deque is the canonical example of an `O(n)` amortized algorithm whose per-step cost is *not* `O(1)` but whose total cost *is* linear. The two-end maintenance pattern recurs in convex hull trick, Li Chao trees, parallel sliding RMQ, and persistent variants — all rooted in the same invariant logic.
