# Interpolation Search — Professional Level

> **Audience:** Algorithm designers and researchers. Prerequisites: probability theory (uniform distribution, variance), discrete math, comfort with asymptotic recurrences.

This document gives the **formal mathematical treatment** of interpolation search: a precise definition, a correctness proof, the **O(log log n) average-case derivation** for uniform inputs via the recurrence `T(n) = T(√n) + O(1)`, the **Ω(n) worst-case construction** for adversarial inputs, the **Yao-Yao lower bound** matching the upper bound on uniform data, and the connection to **learned index structures** as a generalization.

---

## Table of Contents

1. [Formal Definition](#definition)
2. [Correctness Proof](#correctness)
3. [Average-Case Derivation — O(log log n)](#average)
4. [Worst-Case Construction — Ω(n)](#worst)
5. [Matching Lower Bound on Uniform Inputs](#lower-bound)
6. [Connection to Learned Index Structures](#learned)

---

<a name="definition"></a>
## 1. Formal Definition

### Problem

Let `A = [a₀, a₁, …, aₙ₋₁]` be a sorted sequence of `n` distinct numeric elements, and let `t` be a numeric query. The interpolation search algorithm computes, on each iteration, a position estimate

```
pos = lo + ⌊((t - A[lo]) · (hi - lo)) / (A[hi] - A[lo])⌋
```

and probes `A[pos]`, then shrinks the window `[lo, hi]` based on the comparison.

### Algorithm

```
function InterpSearch(A, t):
    lo ← 0
    hi ← n − 1
    while lo ≤ hi ∧ A[lo] ≤ t ≤ A[hi]:
        if A[lo] = A[hi]:
            return lo if A[lo] = t else ⊥
        pos ← lo + ⌊((t − A[lo]) · (hi − lo)) / (A[hi] − A[lo])⌋
        if A[pos] = t: return pos
        else if A[pos] < t: lo ← pos + 1
        else:               hi ← pos − 1
    return ⊥
```

### Information-theoretic framing

Unlike binary search, which extracts ~1 bit per comparison (information lower bound `⌈log₂(n+1)⌉` for any comparison algorithm), interpolation search **uses the value** of `A[pos]`, not just the comparison outcome. The extra information is the *magnitude* of the gap between `t` and `A[pos]`, which on uniform inputs allows the algorithm to converge in `O(log log n)` probes — beating the comparison-based lower bound by exploiting input structure.

This is analogous to **counting sort** beating `Ω(n log n)` comparison-based sorting by using the values of the keys directly.

---

<a name="correctness"></a>
## 2. Correctness Proof

We prove that `InterpSearch(A, t)` returns the index of `t` if present, or `⊥` otherwise, regardless of distribution.

### The invariant

> **(I)** At the top of every iteration, if `t ∈ A`, then the unique index `i` with `A[i] = t` satisfies `lo ≤ i ≤ hi`.

### Proof of (I)

**Initialization.** Before the first iteration, `lo = 0, hi = n − 1`. Every index `0 ≤ i ≤ n − 1` is in range, so (I) holds.

**Maintenance.** Assume (I) holds. Consider the loop body.

The guard `A[lo] ≤ t ≤ A[hi]` ensures that if `t ∈ A`, the index `i` with `A[i] = t` lies in `[lo, hi]` (by monotonicity of `A`). If this guard fails, `t ∉ A` and the loop exits returning `⊥`, satisfying postconditions.

If `A[lo] = A[hi]`, the entire window is constant. By monotonicity, `A[j] = A[lo]` for all `lo ≤ j ≤ hi`. So `t ∈ A ⇔ t = A[lo]`, and we return `lo` or `⊥` correctly.

Otherwise, compute `pos`. By construction, `lo ≤ pos ≤ hi` (proven below). After the three-way comparison:

- **Case 1:** `A[pos] = t`. Return `pos`. Correct.
- **Case 2:** `A[pos] < t`. By monotonicity, no `j ≤ pos` has `A[j] = t`, so if `t ∈ A`, the index is in `[pos+1, hi]`. We set `lo ← pos + 1`. (I) holds.
- **Case 3:** `A[pos] > t`. Symmetric. We set `hi ← pos − 1`. (I) holds.

**Termination.** Each non-returning iteration **strictly decreases the window size** because we set `lo ← pos + 1` or `hi ← pos − 1` with `lo ≤ pos ≤ hi`. The window is a non-negative integer; therefore the loop terminates in at most `n` iterations.

When the loop terminates without returning, either `lo > hi` (window empty) or the value guard `A[lo] ≤ t ≤ A[hi]` failed. In either case, `t ∉ A`, and returning `⊥` is correct. ∎

### Lemma: `lo ≤ pos ≤ hi`

We must show the formula produces an index within `[lo, hi]`. Given:
- `A[lo] ≤ t ≤ A[hi]` (guard), so `0 ≤ t − A[lo] ≤ A[hi] − A[lo]`.
- `hi − lo ≥ 1` (otherwise the equal-endpoints branch handled it).
- `A[hi] − A[lo] > 0` (we already excluded equality).

Then `0 ≤ ((t − A[lo]) · (hi − lo)) / (A[hi] − A[lo]) ≤ (hi − lo)`. Taking the floor:

```
0 ≤ ⌊((t − A[lo]) · (hi − lo)) / (A[hi] − A[lo])⌋ ≤ hi − lo
```

so `lo ≤ pos ≤ hi`. ∎

### A subtle correctness note

The proof relies on **arithmetic correctness**. In integer-based implementations, the multiplication `(t − A[lo]) · (hi − lo)` may overflow. On overflow with two's-complement wraparound, `pos` can wind up outside `[lo, hi]`, breaking the lemma. Production implementations therefore use **64-bit arithmetic** (or arbitrary precision in Python) to extend the safe range.

---

<a name="average"></a>
## 3. Average-Case Derivation — O(log log n)

### Theorem (Perl, Itai, Avni, 1978)

If the elements of `A` are drawn independently from a continuous uniform distribution `U(0, M)` and `t` is also drawn from `U(0, M)`, the expected number of probes for interpolation search is `O(log log n)`.

### Proof sketch

The intuition: a single interpolation probe on uniform data shrinks the window from `n` to roughly `√n` in expectation.

**Step 1.** Model the data as `n` iid samples from `U(0, M)`. After sorting, the sample at rank `i` has expected value `(i / (n − 1)) · M`. The actual value deviates by `O(M / √n)` with high probability (standard order-statistics result; the variance of the k-th order statistic of `U(0, M)` is `O(M² / n)`).

**Step 2.** When we compute `pos` for a query `t = (k / (n − 1)) · M`, the formula predicts `pos = k` — but only if `A[lo]` and `A[hi]` are exactly at their expected values. They aren't; they deviate by `O(M / √n)`.

**Step 3.** The propagated error in `pos` is `O(√n)`. So one probe reduces the window from `n` to at most `O(√n)` — typically less, but the bound is the relevant one.

**Step 4.** The recurrence:

```
T(n) = T(√n) + 1
```

with `T(2) = 1`. To solve, let `n = 2^(2^k)`. Then:

```
T(2^(2^k)) = T(2^(2^(k−1))) + 1
```

Each level reduces the doubly-exponential index `k` by 1. We reach `T(2) = 1` after `k = log₂ log₂ n` levels. So `T(n) = log₂ log₂ n + O(1) = O(log log n)`.

### Numeric magnitude

| `n` | `log₂ n` (binary probes) | `log₂ log₂ n` (interpolation probes) |
|---|---|---|
| 10³ | 10 | 4 |
| 10⁶ | 20 | 5 |
| 10⁹ | 30 | 5 |
| 10¹² | 40 | 6 |
| 10¹⁵ | 50 | 6 |
| 10¹⁸ | 60 | 6 |

For any practical `n`, the probe count caps at ~6. This is the source of interpolation search's reputation as "essentially constant time" on suitable data.

### Assumptions baked into the proof

1. **Continuous uniform distribution.** Discrete uniform (e.g., random integers in `[0, M]`) works similarly with replacement effects.
2. **Independent samples.** Real data is rarely iid (timestamps cluster around peak hours; IDs leap when load spikes).
3. **Random query.** A query drawn from the same distribution. Adversarial queries can degrade behavior.

When all three hold, the O(log log n) bound is real. When any fails, performance degrades — but **not necessarily** to the worst case unless the failure is severe.

---

<a name="worst"></a>
## 4. Worst-Case Construction — Ω(n)

### Theorem

There exists a sorted array `A` of `n` elements and a query `t ∈ A` such that interpolation search requires `Ω(n)` probes.

### Construction

Let `A = [1, 2, 4, 8, 16, …, 2ⁿ⁻¹]` — exponential growth. Let `t = 2`.

**Probe 1.** `lo = 0, hi = n − 1`, `A[lo] = 1`, `A[hi] = 2ⁿ⁻¹`.

```
pos = 0 + ⌊((2 − 1) · (n − 1)) / (2ⁿ⁻¹ − 1)⌋
    = ⌊(n − 1) / (2ⁿ⁻¹ − 1)⌋
    = 0  for n ≥ 3
```

We probe `A[0] = 1 < 2`, so `lo ← 1`.

**Probe 2.** `lo = 1, hi = n − 1`, `A[lo] = 2`, `A[hi] = 2ⁿ⁻¹`. The guard `A[lo] ≤ t ≤ A[hi]` gives `2 ≤ 2`, success. The equality check `A[lo] = A[hi]`? No (for `n > 1`). Compute:

```
pos = 1 + ⌊((2 − 2) · (n − 2)) / (2ⁿ⁻¹ − 2)⌋
    = 1 + 0 = 1
```

We probe `A[1] = 2 = t`, found! That's two probes — interpolation actually does well on this specific query (target is at the boundary).

### A more pathological construction

Let `A[i] = 2^i` for `i ∈ [0, n−1]`. Let `t = A[n−2] = 2^(n−2)`.

**Probe 1.** `A[lo] = 1, A[hi] = 2^(n−1)`. The interpolation:

```
pos = 0 + ⌊((2^(n−2) − 1) · (n − 1)) / (2^(n−1) − 1)⌋
    ≈ ⌊(n − 1) / 2⌋  for large n
```

We probe near the middle, like binary search. Find `A[(n−1)/2] = 2^((n−1)/2)` which is much smaller than `t = 2^(n−2)`. Set `lo ← (n−1)/2 + 1`.

**Probe 2.** The new window has `A[lo] ≈ 2^(n/2)` and `A[hi] = 2^(n−1)`. By similar computation:

```
pos ≈ lo + ⌊((2^(n−2) − 2^(n/2)) · (hi − lo)) / (2^(n−1) − 2^(n/2))⌋
```

The ratio is `(2^(n−2) − 2^(n/2)) / (2^(n−1) − 2^(n/2)) ≈ 1/2`, so we probe near the middle again. We're effectively doing binary search on exponential data: O(log n) probes — which is acceptable.

### The truly bad case

The worst case occurs when interpolation **consistently overshoots or undershoots** by a constant fraction. Construct:

```
A[i] = i               for 0 ≤ i ≤ n − 2
A[n − 1] = M           for some large M
```

Searching for `t = n − 2` (which is at index `n − 2`):

**Probe 1.** `A[lo] = 0, A[hi] = M, hi − lo = n − 1`.

```
pos = 0 + ⌊((n − 2) · (n − 1)) / M⌋
```

For `M = n²`, `pos ≈ ⌊(n² − 3n + 2) / n²⌋ = 0` (after floor).

Probe `A[0] = 0`. Set `lo ← 1`.

**Probe 2.** Similar computation gives `pos ≈ 1`. Probe `A[1] = 1`. Set `lo ← 2`.

This continues, advancing `lo` by 1 each probe. **Total probes: n − 2**, which is `Θ(n)`.

The pathology: one outlier value (`M`) skews the denominator so much that the formula always predicts position 0, regardless of `t`. The algorithm degenerates to linear scan.

### Mitigation in practice

The hybrid pattern (bounded interpolation followed by binary) caps this at `K + log n` probes — `K` wasted interpolation probes plus the binary fallback. This is why production code **never** uses pure interpolation search.

---

<a name="lower-bound"></a>
## 5. Matching Lower Bound on Uniform Inputs

### Theorem (Yao & Yao, 1976; refined by Mehlhorn, 1984)

Any deterministic algorithm searching a sorted array of `n` elements drawn iid from `U(0, M)` for a query also drawn from `U(0, M)`, where each probe reads an array value and performs constant-time computation, requires `Ω(log log n)` expected probes.

### Proof sketch (decision tree with value-aware probes)

In the standard comparison model, a probe extracts at most 1 bit per query (`A[pos] < t` or `≥ t`). A decision tree of depth `d` distinguishes at most `2^d` outcomes; with `n + 1` possible answers, `d ≥ log₂(n + 1)`.

In the **value-aware model**, each probe reads `A[pos]` — a real number from `U(0, M)`. The conditional distribution of the target index given `A[pos]` is **not** uniform; it concentrates around the predicted position. The algorithm can use this concentration to narrow the search.

**Quantitative bound.** Let `f(n)` be the expected number of probes to reduce the window from `n` to `1`. After one probe, the window shrinks to `O(√n)` in expectation (proven in §3). So `f(n) ≥ f(√n) + 1`. Solving gives `f(n) = Ω(log log n)`.

The matching upper bound (interpolation search achieves O(log log n)) and matching lower bound show **interpolation search is asymptotically optimal** on uniform inputs in the value-aware model.

### Implications

- No comparison-based algorithm can beat `O(log n)` on a general sorted array — proven by the binary-decision-tree argument.
- No value-aware algorithm can beat `O(log log n)` on uniform sorted data — by Yao-Yao.
- To go faster, you must exploit **more structure**: known closed-form data, learned models with fitted parameters, hash-based addressing (which gives O(1) but loses ordering).

### Probabilistic versions

For **randomized** algorithms, the lower bound remains `Ω(log log n)` because any randomized algorithm is a probability distribution over deterministic ones, each of which is bound by the same theorem.

---

<a name="learned"></a>
## 6. Connection to Learned Index Structures

### The unified framing

A search index can be described as a **function** `f: Key → Index` that maps a key to (approximately) its position. The algorithm pipeline is:

1. Compute `pred = f(key)`.
2. If `A[pred] = key`, done.
3. Otherwise, **search locally** in `[pred − ε, pred + ε]` where `ε` is the model's worst-case error.

The classical algorithms fit this template:

| Algorithm | Model `f` | Local search |
|---|---|---|
| Linear search | `f(key) = 0` | Scan from start |
| Binary search | `f(key) = n/2` (uninformed) | Halve recursively |
| Interpolation search | `f(key) = lo + (key − A[lo]) / (A[hi] − A[lo]) · (hi − lo)` | Iterate |
| Two-level B-tree | `f` indexes into an array of leaf pointers | Binary within leaf |
| Learned index (RMI) | Trained neural net or polynomial | Bounded binary |

### Why interpolation is the "minimum learned index"

Interpolation's model is a **degree-1 polynomial** fit to two points `(lo, A[lo])` and `(hi, A[hi])`. It is the simplest possible learned model. Its "training" happens online — recomputed each iteration.

A **degree-1 polynomial fit to many points** (least-squares regression) gives a **single-level RMI**, with better global fit but ignored local structure.

A **piecewise-linear model** (a few line segments covering different ranges of the index) gives the **PGM-index** (Ferragina & Vinciguerra, 2020), with O(1) average probes and provable worst-case bounds.

### Strict generalization

Every interpolation-search problem is also a learned-index problem with the trivial model `f(key) = lo + (key − A[lo]) / (A[hi] − A[lo]) · (hi − lo)`. A learned index with the same model and no training data produces identical behavior.

The reverse is not true: learned indexes can exploit non-linear, multi-modal, or high-dimensional structure that interpolation cannot.

### Practical advice

- **For small or moderate datasets** (n < 10⁷), interpolation search with a hybrid fallback is **simpler, comparable in speed, and easier to verify** than a learned index.
- **For massive, stable datasets** (n > 10⁹, infrequently updated), a learned index may give measurable wins (10–30%) over interpolation.
- **For datasets with non-trivial structure** (multi-dimensional, clustered), learned indexes are the only viable approach in the family.

The lesson: interpolation search is not just an algorithm — it is a **point in a design space**. Knowing the space and where interpolation lives in it lets you choose the right tool.

---

## Summary of Bounds

| Quantity | Value | Conditions |
|---|---|---|
| Average-case probes (uniform iid) | `Θ(log log n)` | Continuous uniform data and query |
| Worst-case probes (adversarial) | `Θ(n)` | Pathological distributions, no fallback |
| Worst-case probes (hybrid w/ K-probe cap) | `Θ(K + log n) = Θ(log n)` | Any distribution |
| Value-aware lower bound (uniform) | `Ω(log log n)` | Matches achievable |
| Comparison-only lower bound (general) | `Ω(log n)` | Binary search achieves |
| Iterative space | `O(1)` | — |
| Recursive space | `O(log log n)` average, `O(n)` worst | — |
| Multiplications per probe | `1` | — |
| Divisions per probe | `1` | The dominant CPU cost |

These bounds are **tight** in the value-aware model. To go strictly faster on uniform data, you need preprocessing (learned indexes), hash functions (O(1) but no order), or batch queries (fractional cascading).

---

## Further Reading

- **Peterson**, "Addressing for Random-Access Storage" (IBM Journal, 1957) — the seminal paper introducing the idea.
- **Perl, Itai, Avni**, "Interpolation Search — A Log Log N Search" (CACM, 1978) — the average-case proof.
- **Yao & Yao**, "The Complexity of Searching an Ordered Random Table" (FOCS, 1976) — matching lower bound on uniform inputs.
- **Mehlhorn**, *Data Structures and Algorithms 1: Sorting and Searching* (1984), §6.2 — comprehensive analysis including non-uniform cases.
- **Mehlhorn & Tsakalidis**, "Dynamic Interpolation Search" (1993) — supports inserts while maintaining O(log log n).
- **Kraska et al.**, "The Case for Learned Index Structures" (SIGMOD 2018) — generalization to trained models.
- **Ferragina & Vinciguerra**, "The PGM-index" (VLDB 2020) — piecewise-linear learned index with provable bounds.
- **Knuth TAOCP v3**, §6.2.1, exercises 22–24 — original analytical treatment.
