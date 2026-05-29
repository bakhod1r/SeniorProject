# Ternary Search — Junior Level

> **Read time: ~30 minutes** · **Audience:** Students and engineers who already know iterative binary search and want to learn its three-way cousin and, more importantly, the real workhorse use of the same idea — finding the maximum of a **unimodal function**.

Ternary search is what happens when you ask: *"What if I cut the range into three pieces instead of two?"* The honest answer is that on a **sorted array** for plain lookup, **binary search is strictly better** — it does fewer comparisons per iteration and shrinks the range faster. But ternary search comes alive in a different setting: when the data (or a function) **increases and then decreases with a single peak** — a *unimodal* function. Binary search cannot find that peak, because "greater" and "less" no longer tell you which side the answer is on. Ternary search can, in O(log n).

This document teaches both versions. We will derive the recurrence, prove the shrink factor of `2/3` per iteration, show the integer and the real-valued (`while hi - lo > eps`) variants, explain why the unimodality assumption is non-negotiable, and walk through the "Find Peak Element"-style problems that are the bread and butter of competitive programming.

---

## Table of Contents

1. [Introduction — Cut the Range into Three](#introduction)
2. [Two Faces of Ternary Search](#two-faces)
3. [Prerequisites — Sortedness or Unimodality](#prerequisites)
4. [Glossary](#glossary)
5. [Core Concepts — `m1`, `m2`, and the Eliminated Third](#core-concepts)
6. [Big-O Summary](#big-o-summary)
7. [Real-World Analogies](#analogies)
8. [Pros and Cons](#pros-and-cons)
9. [Step-by-Step Walkthrough](#walkthrough)
10. [Code Examples — Go, Java, Python](#code-examples)
11. [The Real-Valued Variant — Precision Termination](#real-valued)
12. [Error Handling — Overflow, Division, Off-by-One](#errors)
13. [Performance Tips](#performance-tips)
14. [Best Practices](#best-practices)
15. [Edge Cases](#edge-cases)
16. [Common Mistakes](#common-mistakes)
17. [Cheat Sheet](#cheat-sheet)
18. [Visual Animation Reference](#animation)
19. [Summary](#summary)
20. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — Cut the Range into Three

Picture a thrown ball. Its height as a function of time goes up, reaches a maximum, then comes back down. The graph is a downward parabola. You want to find the exact moment of maximum height **without** knowing the formula — you can only sample the height at a few times you choose.

If you sample at `t = 1s` and `t = 3s` and get heights `5m` and `8m` respectively, you know the maximum is **not before `t = 1`** — because the function is still climbing past `t = 1` (well, it could be falling and still pass `5m`, but here we assume strict unimodality). More usefully: if you sample at two points `m1 < m2` and `f(m1) < f(m2)`, the peak must be **to the right of `m1`**, because if the peak were left of `m1`, the function would already be descending by `m1` and `f(m2) < f(m1)`, contradiction.

That single observation is the engine of ternary search. Pick two probe points `m1` and `m2` that divide the range `[lo, hi]` into three roughly equal pieces:

```
lo ────────── m1 ────────── m2 ────────── hi
   first 1/3      middle 1/3     last 1/3
```

Then:
- If `f(m1) < f(m2)`: the peak is somewhere in `(m1, hi]`. **Discard the first third** by setting `lo = m1 + 1` (integer) or `lo = m1` (real).
- If `f(m1) > f(m2)`: the peak is somewhere in `[lo, m2)`. **Discard the last third** by setting `hi = m2 - 1` (integer) or `hi = m2` (real).
- If equal: in the strict-unimodal model this only happens at the very flat top, so either move works.

Each iteration the surviving range is `2/3` of the previous. After `k` iterations the range is `n × (2/3)^k`. When the range collapses to a single point, you have the peak. The iteration count is `log_{3/2}(n) ≈ 1.71 × log₂(n)`. With two function evaluations per iteration, that's about `3.42 × log₂ n` total probes — a constant factor worse than binary search would be **if binary search applied at all**, which it does not for unimodal data.

The same procedure works to find the **minimum** of a unimodal function — just flip the comparison.

---

<a name="two-faces"></a>
## 2. Two Faces of Ternary Search

Ternary search shows up in two flavors that get confused with each other constantly. They share the "cut into three" geometry but the use cases and the math differ.

### 2.1 Ternary search on a sorted array

The naive version: given a sorted array, "search by cutting into three". Pick `m1` and `m2`, compare the target against `arr[m1]` and `arr[m2]`, decide which third holds the target.

**This works, but binary search is strictly better.** A single iteration of binary search does **1 comparison** and eliminates **half** the range. A single iteration of ternary search does **2 comparisons** and eliminates **one third** of the range. To shrink the range by a factor of 2, binary uses 1 comparison; ternary uses ≈ 1.7 comparisons (because it needs `log_2 2 / log_2(3/2) ≈ 1.71` iterations × 2 comparisons each / 2). Detailed comparison count is given in `professional.md`, but the intuitive answer is: **for ordered search, use binary, not ternary.**

We still cover this version because it appears in interviews and on contest sites — and because seeing it makes the unimodal version click.

### 2.2 Ternary search on a unimodal function

The interesting version. The function (or array) is **unimodal**: there is exactly one value of `x` where `f(x)` is the maximum, and `f` strictly increases on `[lo, x_max]` and strictly decreases on `[x_max, hi]` (or the mirror for a minimum). Binary search cannot help here — `f(mid) > t` does not tell you whether to go left or right, because both sides of the peak satisfy it.

Ternary search exploits the unimodal shape. This is its **real** use: optimization on continuous unimodal functions, peak finding on unimodal arrays, parametric problems where the cost-vs-parameter curve is convex.

Throughout this document, when we say "ternary search" without qualification we mean the unimodal variant — it is the version you will actually use in practice.

---

<a name="prerequisites"></a>
## 3. Prerequisites — Sortedness or Unimodality

For the **sorted-array variant**, the prerequisites are identical to binary search:
1. A sorted sequence (ascending or descending).
2. O(1) random access.
3. A total order.

For the **unimodal variant** — the important one — the prerequisites are:

1. **Strict unimodality.** There is exactly one `x*` in `[lo, hi]` such that `f` is strictly increasing on `[lo, x*]` and strictly decreasing on `[x*, hi]` (for finding a maximum; flip for minimum). "Strictly" matters: ties on a plateau can mislead the algorithm into picking the wrong third.
2. **Cheap-enough function evaluation.** Each iteration calls `f` twice. If `f` is itself expensive (e.g., a physics simulation), you may prefer **golden-section search** which reuses one probe between iterations.
3. **Real-valued or integer index domain.** The domain can be either; the algorithm structure is the same, but the termination condition differs (precision for real, range-of-3-or-less for integer).
4. **No noise.** If `f` is sampled from a noisy process, two close evaluations may swap by random chance and ternary search will mis-direct. Use a smoothed surrogate or a noise-tolerant optimizer (Bayesian, simulated annealing) instead.

If your function is **multimodal** (multiple local peaks), ternary search will lock onto one peak and may miss the global one. For multimodal data use grid search, simulated annealing, genetic algorithms, or basin-hopping.

If your function has a **plateau** at the top (a flat region where `f(x) = max` over an interval), ternary search may converge to a point inside the plateau, which is fine if you want any maximizer — but if you want the leftmost or rightmost, you need a different procedure.

---

<a name="glossary"></a>
## 4. Glossary

| Term | Definition |
|---|---|
| **Unimodal function** | A function with exactly one local extremum (peak or valley) and monotonic on each side. |
| **Peak** | The maximum point `(x*, f(x*))` of a unimodal function with a maximum. |
| **Valley** | The minimum point of a unimodal function with a minimum. (Same algorithm, flipped comparisons.) |
| **`lo`, `hi`** | Endpoints of the current search interval. Shrinks each iteration. |
| **`m1`, `m2`** | The two probe points that split `[lo, hi]` into three pieces. Computed as `m1 = lo + (hi-lo)/3` and `m2 = hi - (hi-lo)/3`. |
| **Eliminated third** | The piece of the interval discarded after comparing `f(m1)` vs `f(m2)`. |
| **Precision threshold `eps`** | Used in real-valued search. Loop terminates when `hi - lo < eps`. |
| **Shrink factor** | The ratio of new interval length to old. For ternary, exactly `2/3` per iteration. |
| **Golden-section search** | A related algorithm that uses the golden ratio `φ = (√5 + 1)/2` to position probes so one is reused between iterations. Slightly more efficient than ternary in evaluation count. |
| **Multimodal** | A function with multiple local extrema. Ternary search does **not** work here. |
| **Convex function** | `f` is convex if `f(λx + (1-λ)y) ≤ λf(x) + (1-λ)f(y)`. A strictly convex function is unimodal (has a single minimum). Many cost functions in engineering are convex. |
| **Concave** | The opposite of convex. A strictly concave function is unimodal with a single maximum. Parabolas opening downward are concave. |

---

<a name="core-concepts"></a>
## 5. Core Concepts — `m1`, `m2`, and the Eliminated Third

### 5.1 The state: a window `[lo, hi]`

Ternary search maintains a window `[lo, hi]` known to contain the peak. Initially the window is the entire domain. Each iteration shrinks it to either `[lo, m2 - 1]` (or `[lo, m2]` in the real case) or `[m1 + 1, hi]` (or `[m1, hi]`).

### 5.2 Choosing `m1` and `m2`

```
m1 = lo + (hi - lo) / 3
m2 = hi - (hi - lo) / 3
```

These split `[lo, hi]` into three pieces of size `(hi - lo) / 3` each (with the middle piece potentially one larger due to integer truncation). For example, `lo = 0`, `hi = 9` gives `m1 = 3`, `m2 = 6`, and three slabs `[0, 3], [3, 6], [6, 9]`.

Why this formulation? Same overflow safety as `mid = lo + (hi - lo) / 2` in binary search — avoid `(lo + hi)` directly. And it cleanly handles negative ranges (in the real case, when domain is e.g. `[-10, 10]`).

### 5.3 The decision

After computing `f(m1)` and `f(m2)`:

| Comparison | Peak location | Window update |
|---|---|---|
| `f(m1) < f(m2)` | In `(m1, hi]` | `lo = m1 + 1` (integer) or `lo = m1` (real) |
| `f(m1) > f(m2)` | In `[lo, m2)` | `hi = m2 - 1` (integer) or `hi = m2` (real) |
| `f(m1) == f(m2)` | Between them (assuming strict unimodality) | Either move works; conventionally `lo = m1 + 1` |

**Why does `f(m1) < f(m2)` imply the peak is right of `m1`?**

By unimodality, `f` is strictly increasing up to the peak `x*` and strictly decreasing after. If the peak were at some `x* ≤ m1`, then `f` would already be decreasing on `[m1, m2]`, giving `f(m1) > f(m2)`. But we observed `f(m1) < f(m2)`, contradiction. So `x* > m1`, i.e., `x*` lies in `(m1, hi]`.

This argument **requires strict unimodality**. If `f` has a plateau at the top, the argument breaks down on the plateau.

### 5.4 Termination

**Integer domain.** Stop when the interval has 1, 2, or 3 candidates. Then scan them linearly. This avoids tricky off-by-one bugs near the end.

```
while hi - lo > 2:
    m1 = lo + (hi - lo) // 3
    m2 = hi - (hi - lo) // 3
    if f(m1) < f(m2): lo = m1 + 1
    else:             hi = m2 - 1
return max(range(lo, hi + 1), key=f)
```

**Real domain.** Stop when the interval is smaller than a precision threshold `eps`:

```
while hi - lo > eps:
    m1 = lo + (hi - lo) / 3
    m2 = hi - (hi - lo) / 3
    if f(m1) < f(m2): lo = m1
    else:             hi = m2
return (lo + hi) / 2
```

In the real case we set `lo = m1` (not `m1 + eps` or similar) because float arithmetic does not have a meaningful "next value". A fixed iteration count (often 200) is more robust than a precision-based loop — see §11.

---

<a name="big-o-summary"></a>
## 6. Big-O Summary

| Aspect | Complexity |
|---|---|
| **Best case** | O(1) — peak happens to be at `m1` or `m2` on iteration 1 (rare) |
| **Average and worst case (iterations)** | `⌈log_{3/2}(n)⌉ ≈ 1.71 × log₂ n` |
| **Function evaluations per iteration** | 2 |
| **Total function evaluations (worst case)** | `2 × ⌈log_{3/2}(n)⌉ ≈ 3.42 × log₂ n` |
| **Comparisons between `f` values** | 1 per iteration |
| **Space (iterative)** | O(1) |
| **Space (recursive)** | O(log n) — recursion stack |
| **Recurrence** | `T(n) = T(2n/3) + O(1)` ⇒ O(log n) |
| **Real-valued precision** | After `k` iters, range is `(2/3)^k × (hi - lo)`. To reach precision `ε`: `k ≈ ⌈log_{3/2}((hi-lo) / ε)⌉` |
| **Requires unimodal input** | YES (for the useful version) |

For `n = 1,000,000`: ~35 iterations, ~70 evaluations. For real range `[0, 10^6]` to precision `10^{-9}`: ~75 iterations, ~150 evaluations.

**Golden-section search** does the same work with **only one new evaluation per iteration** (the other is reused from the previous step) — `~1.71 × log₂ n` evaluations total, half as many as naive ternary. When `f` is expensive, this matters; see `middle.md`.

---

<a name="analogies"></a>
## 7. Real-World Analogies

### 7.1 Tuning the bass on a stereo
You turn the bass knob and listen. Too low — flat. Too high — muddy. There is exactly one knob setting that sounds best. You compare two settings, decide which is closer to the sweet spot, and narrow your search. That's ternary search on a unimodal "quality" function.

### 7.2 Finding the highest point on a hill walk
You walk a one-dimensional ridge. Compare the altitude at two points; the higher one is closer to (or past) the peak; eliminate the worse third.

### 7.3 Calibrating a camera's autofocus
The image's sharpness as a function of focus distance is unimodal — it peaks at the correct focal length. Cameras use a peak-finding algorithm (often a variant of golden-section search) to land on the sharpest setting in a few sensor reads.

### 7.4 Trajectory optimization
You throw a projectile to hit a target. The horizontal distance reached as a function of launch angle is unimodal — too flat or too steep both undershoot, 45° (in vacuum) is the optimum. Ternary search finds the optimal angle in O(log) function evaluations.

### 7.5 Hyperparameter tuning when the curve is unimodal
For some ML hyperparameters (e.g., learning rate in a narrow band, regularization strength under specific conditions), the validation cost is empirically unimodal. Ternary search can find the optimum faster than grid search. **Caveat:** in general ML, loss-vs-hyperparameter curves are not unimodal, so don't use ternary search blindly.

### 7.6 Finding the sweet spot in a control system
A PID controller has a gain that, too small, makes the system sluggish; too large, makes it oscillate. The "settling time" as a function of gain is unimodal in a well-behaved range. Ternary search tunes the gain.

---

<a name="pros-and-cons"></a>
## 8. Pros and Cons

### Pros
- **Solves problems binary search cannot** — finding extrema of unimodal functions.
- **Logarithmic time.** `O(log n)` iterations.
- **No need for derivatives.** Unlike Newton's method or gradient descent, ternary search needs only function values, not derivatives. Useful when `f` is a black-box simulator.
- **Simple to implement** — one loop, one comparison.
- **Predictable convergence** — geometric shrink factor `2/3` per iteration, no surprises.
- **Numerically stable** for well-behaved real-valued functions.

### Cons
- **Requires unimodality.** This is the hard prerequisite. If `f` has two peaks, ternary search converges to one of them, often the wrong one.
- **Slower than binary search on sorted arrays.** Use binary for ordered lookup; ternary's "two probes per step" gives binary the edge.
- **Two function evaluations per iteration.** Golden-section search uses one. For expensive `f`, prefer golden-section.
- **Fragile to noise.** Two close evaluations can flip from one iteration to the next due to noise, leading to wrong direction.
- **Plateau confusion.** A flat region at the top breaks the strict-unimodal assumption.
- **No derivative use.** When you have access to `f'(x)`, gradient descent or Newton's method converges much faster (quadratic vs. logarithmic) — though they need extra care for global convergence.

---

<a name="walkthrough"></a>
## 9. Step-by-Step Walkthrough

### 9.1 Unimodal array peak

Find the maximum of `arr = [1, 3, 8, 12, 15, 9, 4, 1]` (n = 8). The peak is `arr[4] = 15`.

```
Init: lo=0, hi=7
Array: [1, 3, 8, 12, 15, 9, 4, 1]
Idx:    0  1  2   3   4  5  6  7
```

**Iteration 1.**
```
m1 = 0 + (7 - 0) / 3 = 2  →  arr[2] = 8
m2 = 7 - (7 - 0) / 3 = 5  →  arr[5] = 9
8 < 9   →   peak is right of m1  →  lo = m1 + 1 = 3
```
Window: `[3, 7]`. Eliminated: `[0, 2]`.

**Iteration 2.**
```
m1 = 3 + (7 - 3) / 3 = 4  →  arr[4] = 15
m2 = 7 - (7 - 3) / 3 = 6  →  arr[6] = 4
15 > 4  →   peak is left of m2  →  hi = m2 - 1 = 5
```
Window: `[3, 5]`. Eliminated: `[6, 7]`.

**Iteration 3.**
Window size is `hi - lo = 2 ≤ 2`, exit loop. Linear scan: `max(arr[3], arr[4], arr[5]) = arr[4] = 15`. Done.

Total iterations: 2. Function evaluations: 4 (m1, m2 each iter).

### 9.2 Real-valued: maximum of `f(x) = -x² + 10x + 3` on `[0, 10]`

The peak by calculus is at `x = 5` with `f(5) = 28`. Let's run ternary.

```
Init: lo=0.0, hi=10.0
```

**Iteration 1.**
```
m1 = 0 + (10 - 0) / 3 ≈ 3.333  →  f(m1) ≈ 25.222
m2 = 10 - (10 - 0) / 3 ≈ 6.667 →  f(m2) ≈ 25.222
Equal (very close). Conventionally lo = m1.
```
Window: `[3.333, 10]` (or `[0, 6.667]` if `>` direction chosen). Let's say `lo = 3.333`.

**Iteration 2.**
```
m1 = 3.333 + (10 - 3.333) / 3 ≈ 5.556  →  f ≈ 27.694
m2 = 10 - (10 - 3.333) / 3 ≈ 7.778      →  f ≈ 20.494
27.7 > 20.5  →  hi = m2 ≈ 7.778
```
Window: `[3.333, 7.778]`.

**Iteration 3.**
```
m1 ≈ 4.815, f ≈ 27.967
m2 ≈ 6.296, f ≈ 26.330
27.97 > 26.33  →  hi = m2 ≈ 6.296
```
Window: `[3.333, 6.296]`.

After ~50 more iterations, the window collapses to a near-zero size around `x = 5`. Final answer: `(lo + hi) / 2 ≈ 5.0000…`.

The convergence rate is geometric: after `k` iterations the window is `10 × (2/3)^k`. Reaching `1e-9` precision requires about `log_{3/2}(10^{10}) ≈ 57` iterations.

---

<a name="code-examples"></a>
## 10. Code Examples — Go, Java, Python

### 10.1 Ternary search on a sorted array (for completeness — prefer binary search)

**Go:**
```go
package ternsearch

// SortedSearch returns an index of target in a sorted slice, or -1 if absent.
// Note: prefer binary search for sorted arrays — this exists for completeness.
func SortedSearch(arr []int, target int) int {
    lo, hi := 0, len(arr)-1
    for lo <= hi {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if arr[m1] == target {
            return m1
        }
        if arr[m2] == target {
            return m2
        }
        if target < arr[m1] {
            hi = m1 - 1
        } else if target > arr[m2] {
            lo = m2 + 1
        } else {
            lo = m1 + 1
            hi = m2 - 1
        }
    }
    return -1
}
```

**Java:**
```java
public final class TernarySearch {
    private TernarySearch() {}

    /**
     * Returns an index of target in a sorted array, or -1 if absent.
     * For sorted-array lookup prefer binary search; this is shown for educational completeness.
     */
    public static int sortedSearch(int[] arr, int target) {
        int lo = 0, hi = arr.length - 1;
        while (lo <= hi) {
            int m1 = lo + (hi - lo) / 3;
            int m2 = hi - (hi - lo) / 3;
            if (arr[m1] == target) return m1;
            if (arr[m2] == target) return m2;
            if (target < arr[m1])      hi = m1 - 1;
            else if (target > arr[m2]) lo = m2 + 1;
            else { lo = m1 + 1; hi = m2 - 1; }
        }
        return -1;
    }
}
```

**Python:**
```python
def sorted_search(arr: list[int], target: int) -> int:
    """Ternary search on a sorted array. Prefer binary search for this use case."""
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        m1 = lo + (hi - lo) // 3
        m2 = hi - (hi - lo) // 3
        if arr[m1] == target:
            return m1
        if arr[m2] == target:
            return m2
        if target < arr[m1]:
            hi = m1 - 1
        elif target > arr[m2]:
            lo = m2 + 1
        else:
            lo = m1 + 1
            hi = m2 - 1
    return -1
```

### 10.2 Ternary search on an integer unimodal array (find peak)

**Go:**
```go
// TernaryMaxInt finds the index of the maximum of a strictly unimodal integer array.
func TernaryMaxInt(arr []int) int {
    lo, hi := 0, len(arr)-1
    for hi-lo > 2 {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if arr[m1] < arr[m2] {
            lo = m1 + 1
        } else {
            hi = m2 - 1
        }
    }
    best := lo
    for i := lo + 1; i <= hi; i++ {
        if arr[i] > arr[best] {
            best = i
        }
    }
    return best
}
```

**Java:**
```java
public static int ternaryMaxInt(int[] arr) {
    int lo = 0, hi = arr.length - 1;
    while (hi - lo > 2) {
        int m1 = lo + (hi - lo) / 3;
        int m2 = hi - (hi - lo) / 3;
        if (arr[m1] < arr[m2]) lo = m1 + 1;
        else                   hi = m2 - 1;
    }
    int best = lo;
    for (int i = lo + 1; i <= hi; i++) {
        if (arr[i] > arr[best]) best = i;
    }
    return best;
}
```

**Python:**
```python
def ternary_max_int(arr: list[int]) -> int:
    """Index of the maximum of a strictly unimodal integer array."""
    lo, hi = 0, len(arr) - 1
    while hi - lo > 2:
        m1 = lo + (hi - lo) // 3
        m2 = hi - (hi - lo) // 3
        if arr[m1] < arr[m2]:
            lo = m1 + 1
        else:
            hi = m2 - 1
    return max(range(lo, hi + 1), key=lambda i: arr[i])
```

### 10.3 Ternary search on a real-valued unimodal function

**Go:**
```go
// TernaryMaxFloat finds argmax of a unimodal f on [lo, hi] in O(log((hi-lo)/eps)).
func TernaryMaxFloat(lo, hi float64, f func(float64) float64) float64 {
    const iters = 200
    for i := 0; i < iters; i++ {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if f(m1) < f(m2) {
            lo = m1
        } else {
            hi = m2
        }
    }
    return (lo + hi) / 2
}
```

**Java:**
```java
public static double ternaryMaxFloat(double lo, double hi,
                                     java.util.function.DoubleUnaryOperator f) {
    for (int i = 0; i < 200; i++) {
        double m1 = lo + (hi - lo) / 3.0;
        double m2 = hi - (hi - lo) / 3.0;
        if (f.applyAsDouble(m1) < f.applyAsDouble(m2)) lo = m1;
        else                                           hi = m2;
    }
    return (lo + hi) / 2.0;
}
```

**Python:**
```python
def ternary_max_float(lo: float, hi: float, f) -> float:
    """Argmax of a unimodal f on [lo, hi]. Fixed 200 iterations for stability."""
    for _ in range(200):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if f(m1) < f(m2):
            lo = m1
        else:
            hi = m2
    return (lo + hi) / 2
```

### 10.4 Finding a minimum instead of a maximum

Just flip the comparison: `f(m1) > f(m2)` ⇒ `lo = m1 + 1`.

**Python:**
```python
def ternary_min_float(lo, hi, f):
    for _ in range(200):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if f(m1) > f(m2):
            lo = m1
        else:
            hi = m2
    return (lo + hi) / 2
```

The structure is identical; only the comparison direction changes. Many libraries expose a single `ternary_search(direction='max'|'min')` parameter.

---

<a name="real-valued"></a>
## 11. The Real-Valued Variant — Precision Termination

When the domain is `ℝ` instead of integer indices, you cannot expect `lo == hi` to ever hold — float arithmetic has finite precision but the iteration shrinks `hi - lo` by `2/3` forever in theory. You need a stopping rule.

### 11.1 Three stopping strategies

**A. Precision threshold.**
```python
while hi - lo > eps:
    ...
```
**Pro:** Stops as soon as you have desired precision. **Con:** If `eps` is too small (e.g., `1e-18` on a `double`), the loop may run forever because `hi - lo` is rounded to a value that does not decrease further.

**B. Fixed iteration count.**
```python
for _ in range(200):
    ...
```
**Pro:** Always terminates. **Con:** May do more work than necessary if the initial range is small. Generally preferred in practice for reliability.

**C. Both, with the fixed count as a safety net.**
```python
for _ in range(500):
    if hi - lo <= eps:
        break
    ...
```

### 11.2 How many iterations for desired precision

Each iteration shrinks `hi - lo` by `2/3`. Starting from range `R`, after `k` iterations the range is `R × (2/3)^k`. To reach precision `ε`:

```
R × (2/3)^k ≤ ε
k ≥ log(R / ε) / log(3/2) = log_{1.5}(R / ε)
```

| Initial range `R` | Target precision `ε` | Iterations needed |
|---|---|---|
| 1.0 | `10⁻⁶` | 35 |
| 1.0 | `10⁻⁹` | 52 |
| 1.0 | `10⁻¹²` | 69 |
| 10⁶ | `10⁻⁶` | 69 |
| 10⁹ | `10⁻⁹` | 103 |
| 10¹² | `10⁻¹²` | 137 |

200 iterations covers virtually any double-precision request — beyond ~70 iterations you're hitting `double`'s `~10⁻¹⁵` precision limit anyway.

### 11.3 Numerical traps

- **Cancellation when `lo ≈ hi`.** Computing `(hi - lo) / 3` near zero amplifies relative error. Modern double precision is good enough for most engineering use; do not worry about this until you are doing scientific computing.
- **Catastrophic cancellation in `f`.** If `f(m1)` and `f(m2)` are very close and computed with subtractions, you might compare two noise-dominated values. Use a higher-precision representation (`long double`, `BigDecimal`) or analytic simplification.
- **Function discontinuities.** A nominally unimodal function with a tiny discontinuity (e.g., from a `max(0, ...)` clip) can break monotonicity locally; ternary search may misdirect once and recover. Add a noise tolerance: if `|f(m1) - f(m2)| < δ`, do not shrink (or shrink by a smaller amount).

---

<a name="errors"></a>
## 12. Error Handling — Overflow, Division, Off-by-One

### 12.1 Avoid `(lo + hi) / 3` in integer code

`(lo + hi) / 3` is **not** the same as `lo + (hi - lo) / 3` (the latter is correct and overflow-safe). Also, the natural geometric meaning differs:

```
correct:    m1 = lo + (hi - lo) / 3     (one third of the way from lo to hi)
wrong:      m1 = (lo + hi) / 3          (one third of the value — not the index!)
```

`(2*lo + hi) / 3` is mathematically equivalent to `lo + (hi - lo) / 3` (for integer division you may differ by 1 due to truncation), but introduces overflow risk for large `lo + hi`.

### 12.2 The "infinite loop" trap

```python
# BAD: if f(m1) == f(m2), neither branch moves the bound.
while lo < hi:
    m1 = lo + (hi - lo) // 3
    m2 = hi - (hi - lo) // 3
    if f(m1) < f(m2):
        lo = m1 + 1
    elif f(m1) > f(m2):
        hi = m2 - 1
    # else: missing — infinite loop on plateau
```

Fix: combine the equal case with one of the inequality cases, or use `<=` so the loop also makes progress:

```python
if f(m1) <= f(m2):     # combines == with <
    lo = m1 + 1
else:
    hi = m2 - 1
```

This works *if* you accept that on a plateau you may converge to either edge of the plateau, not the center.

### 12.3 Off-by-one in integer termination

The pattern `while hi - lo > 2: ... return max(range(lo, hi + 1), key=f)` is robust. Why `> 2`? Because if `hi - lo = 2` (three candidates: `lo, lo+1, hi`), then `m1 = lo`, `m2 = hi`, and shrinking by 1 (`lo = m1 + 1 = lo + 1` or `hi = m2 - 1 = hi - 1`) leaves only 2 candidates — but the algorithm's correctness argument requires *strict* unimodality with at least 3 evaluable points; falling back to a linear scan at this size is the safest exit.

Alternative termination conditions:
- `while hi - lo > 1`: ends with 2 candidates, scan returns the larger.
- `while lo < hi`: needs careful index arithmetic and is bug-prone.

Pick `> 2` and `linear scan on `[lo, hi]`. It is unconditionally correct.

### 12.4 Other error cases

| Error | Cause | Mitigation |
|---|---|---|
| `arr is empty` | Length 0 input | Return `-1` or raise an error; do not enter the loop. |
| `arr has 1 or 2 elements` | Termination condition trivial | Directly return `argmax(arr)` without entering the loop. |
| `arr is not unimodal` | Caller's responsibility | Add a debug-only check that scans for the peak shape. |
| `f raises an exception mid-search` | Domain error in `f` | Wrap `f` to clamp arguments to the valid domain, or catch and treat as `-∞`. |
| `f returns NaN` | Numerical issue in `f` | NaN comparisons fail silently; sanitize or use a comparator that treats NaN as "worst". |

---

<a name="performance-tips"></a>
## 13. Performance Tips

1. **Use the integer variant for integer domains.** Float arithmetic is slower per op and has precision concerns. If your indices are integers, stay integer.

2. **Cache function evaluations** when `f` is expensive. The same `m1` or `m2` can repeat across iterations near convergence; memoization avoids re-running an expensive simulation.

3. **Prefer golden-section search if `f` is expensive.** It reuses one evaluation per iteration. Half the calls to `f`. See `middle.md`.

4. **For sorted arrays, use binary search.** Ternary loses to binary on comparison count. Use ternary only when the structure is unimodal, not just sorted.

5. **Fixed iteration count beats precision threshold for floats.** Avoids the "infinite loop near float epsilon" failure mode. 200 iterations is enough for any realistic precision.

6. **Avoid divisions when possible.** `(hi - lo) / 3` involves an integer division which is slow on some CPUs. For hot inner loops, precompute or use bit hacks. In practice this matters only inside tight optimization loops.

7. **Use derivatives when you have them.** If `f` is differentiable and you can compute `f'`, **Newton's method** converges quadratically vs. ternary's geometric — orders of magnitude faster near the optimum. Use ternary as a fallback when derivatives are not available.

8. **For multimodal functions, do NOT use ternary search.** Use a global optimizer (Bayesian optimization, basin hopping, simulated annealing) instead.

---

<a name="best-practices"></a>
## 14. Best Practices

- **Document the unimodality precondition.** Every ternary-search function should have a docstring stating "input MUST be strictly unimodal".
- **Validate (in dev/test) that the input is actually unimodal.** A linear scan `O(n)` check catches the most common caller error.
- **Pick a termination strategy and stick with it** — fixed iterations for reals, `hi - lo > 2` + linear scan for integers.
- **For minima vs maxima, change the comparator, not the algorithm.** Wrap `f` in `g(x) = -f(x)` and search for the max, or invert the comparison.
- **When iterating on integer indices, prefer linear scan of last 3** — fewer corner cases.
- **Don't roll your own when scipy / scipy-like libraries provide `scipy.optimize.minimize_scalar(method='golden')`.** For Python production code, use the library.
- **For competitive programming, write the 12-line template once, memorize it, reuse it.**

---

<a name="edge-cases"></a>
## 15. Edge Cases

| Case | Input | Expected |
|---|---|---|
| Empty array | `[]` | Error or `-1` |
| Single element | `[5]` | Index 0 |
| Two elements | `[3, 5]` (strictly increasing) | Index 1 |
| Two elements | `[5, 3]` (strictly decreasing) | Index 0 |
| Peak at the start | `[10, 8, 6, 4]` | Index 0 |
| Peak at the end | `[1, 3, 5, 10]` | Index 3 |
| All equal | `[5, 5, 5, 5]` | Any index (plateau; convention: leftmost) |
| Tiny range (3 elements) | `[1, 5, 2]` | Skip loop, linear scan returns index 1 |
| Real range collapsed | `lo = hi = 0.5` | Return 0.5 immediately |
| Function with two equal peaks | `[1, 3, 1, 3, 1]` | **Undefined** — input violates unimodality; result may be either peak |
| Function with plateau on top | `[1, 5, 5, 5, 1]` | Some index in `[1, 3]` — depends on tie-break |
| Very narrow peak | `[1, 1, 1, 1, 100, 1, 1, 1, 1]` | Works correctly — `m1`, `m2` straddle the peak |

---

<a name="common-mistakes"></a>
## 16. Common Mistakes

1. **Using ternary search on non-unimodal data.** The most common error. If the array has two peaks, ternary may pick the smaller one. Always verify unimodality.

2. **Using ternary search on a sorted array for plain lookup.** Slower than binary search. Use binary search instead.

3. **Forgetting the `f(m1) == f(m2)` case.** On strict unimodal data this only happens on a plateau, but plateaus exist. Combine equality with one inequality branch.

4. **`(lo + hi) / 3` instead of `lo + (hi - lo) / 3`.** Wrong geometric meaning, plus overflow risk.

5. **Precision-based termination without an iteration cap.** Float arithmetic can stall the shrink; the loop never exits.

6. **Confusing max and min versions.** Get the comparison direction wrong and you converge to a valley instead of a peak.

7. **Two-probe-per-iter when one would suffice.** If `f` is expensive, use golden-section search to halve the call count.

8. **Treating noisy data as unimodal.** Random noise can flip `f(m1)` and `f(m2)` adversarially. Smooth the data or use a noise-tolerant optimizer.

9. **Going recursive in production.** Adds stack space, no speed benefit. Iterative is preferred.

10. **Off-by-one in the integer termination.** Using `while lo < hi` directly without careful corner-case analysis leads to infinite loops or wrong answers. Use `while hi - lo > 2` + linear scan.

---

<a name="cheat-sheet"></a>
## 17. Cheat Sheet

```
INTEGER UNIMODAL ARRAY (find peak)
    lo = 0; hi = n - 1
    while hi - lo > 2:
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if arr[m1] < arr[m2]:   lo = m1 + 1
        else:                    hi = m2 - 1
    return argmax(arr[lo..hi])

REAL-VALUED UNIMODAL FUNCTION (find argmax)
    for _ in range(200):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if f(m1) < f(m2):  lo = m1
        else:               hi = m2
    return (lo + hi) / 2

MINIMUM INSTEAD OF MAXIMUM
    Flip the comparison: f(m1) > f(m2) → lo = m1 [+1]

COMPLEXITY
    Iterations:   ⌈log_{3/2}(n)⌉  ≈  1.71 × log₂ n
    Func calls:   2 per iteration  ≈  3.42 × log₂ n
    Shrink:       2/3 per iteration
    Space:        O(1) iterative

KEY PREREQUISITE
    STRICT UNIMODALITY — exactly one peak (or valley), monotonic on each side.

WHEN TO USE
    Sorted array lookup:        Binary search  (NOT ternary)
    Unimodal array peak:        Ternary search
    Unimodal real f optimum:    Ternary or golden-section (golden if f expensive)
    Multimodal functions:       Global optimizer (Bayesian, SA, GA)
    Differentiable f:           Newton's method / gradient descent (faster)
```

---

<a name="animation"></a>
## 18. Visual Animation Reference

See `animation.html` in this folder. It renders a unimodal array as vertical bars (the bar height visualizes the value), shows the `lo`, `m1`, `m2`, `hi` markers above, color-codes which third of the range is eliminated each iteration, and tracks the peak as it gets cornered. A speed slider and custom-input field let you experiment. Stats display the iteration count, function evaluations, the theoretical `⌈log_{3/2}(n)⌉` bound, and the current window size.

Watching the algorithm collapse around the peak in real time clarifies the geometric intuition that pages of text cannot.

---

<a name="summary"></a>
## 19. Summary

- Ternary search splits a range `[lo, hi]` into three pieces with `m1 = lo + (hi-lo)/3` and `m2 = hi - (hi-lo)/3`, then discards one third based on `f(m1)` vs `f(m2)`.
- Its **main use is finding the maximum (or minimum) of a unimodal function**, not searching a sorted array. For sorted arrays, binary search is strictly better.
- The shrink factor is `2/3` per iteration, giving `O(log_{3/2}(n)) ≈ 1.71 × log₂ n` iterations, with 2 function evaluations each.
- For integer domains, terminate when `hi - lo ≤ 2` and linear-scan the survivors. For real domains, use a fixed iteration count (~200) for numerical stability.
- The hard prerequisite is **strict unimodality**. Plateaus, noise, or multimodal shapes break the algorithm.
- Related: **golden-section search** uses the golden ratio to reuse one probe per iteration — half the function evaluations of naive ternary. Worth it when `f` is expensive.
- Related: **Newton's method** and **gradient descent** converge much faster when you have access to derivatives.

Master ternary search and you have a tool for the entire class of "find the optimum of a unimodal cost function" problems — projectile trajectories, autofocus, PID tuning, scheduling parametric problems — that gradient-free, derivative-free, and O(log n) deep.

---

<a name="further-reading"></a>
## 20. Further Reading

- **Kiefer**, "Sequential minimax search for a maximum" (1953). The original analysis of golden-section search and ternary-style methods for unimodal optimization.
- **Avriel & Wilde**, "Optimal Search for a Maximum with Sequences of Simultaneous Function Evaluations" (1966). Generalizes ternary and golden section.
- **CP-Algorithms** entry on Ternary Search (cp-algorithms.com). Concise treatment with competitive-programming examples.
- **Nocedal & Wright**, *Numerical Optimization*, 2nd ed., Chapter 3. Line search methods, including golden-section and ternary-like procedures.
- **LeetCode** — problems 162 (Find Peak Element), 852 (Peak Index in a Mountain Array), 1095 (Find in Mountain Array). Practice problems aligned with ternary search.
- Continue with `middle.md` for golden-section search, parametric ternary search, finding closest point on a unimodal curve, and the comparison with gradient descent.
