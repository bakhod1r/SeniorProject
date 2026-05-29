# Ternary Search — Interview Questions & Coding Challenges

> **Audience:** Anyone preparing for a software engineering interview where ternary search may come up (competitive programming, optimization-heavy roles, robotics, graphics, control systems). Includes conceptual questions across levels and 7 coding challenges with full Go / Java / Python solutions.

---

## Section A — Conceptual Questions

### Junior level

**Q1. When does ternary search apply?**
On a **strictly unimodal** function — one that strictly increases then strictly decreases (for finding a maximum), or vice versa for a minimum. It does **not** apply to general sorted data; binary search is the right tool there.

**Q2. How do you choose `m1` and `m2`?**
`m1 = lo + (hi - lo) / 3` and `m2 = hi - (hi - lo) / 3`. These split `[lo, hi]` into three roughly equal pieces. Use `lo + (hi - lo) / 3` (not `(lo + hi) / 3`) to avoid integer overflow and preserve the geometric meaning.

**Q3. Why not just use binary search on sorted data?**
Binary search is **strictly better** for sorted-array lookup. Ternary uses 2 comparisons per iteration but shrinks the range by only `2/3`, while binary uses 1 comparison per iteration and shrinks by `1/2`. Net: ternary does ~26% more comparisons than binary on sorted data.

**Q4. What's the time complexity of ternary search?**
`O(log_{3/2} n) ≈ 1.71 × log₂ n` iterations, with 2 function evaluations per iteration. The recurrence is `T(n) = T(2n/3) + O(1)`.

**Q5. What does "unimodal" mean precisely?**
A function `f` is unimodal on `[a, b]` if there exists exactly one `x* ∈ [a, b]` such that `f` is strictly monotonic on each side of `x*` (strictly increasing on `[a, x*]` and strictly decreasing on `[x*, b]`, for the maximum case).

**Q6. What if `f(m1) == f(m2)`?**
On a strictly unimodal function this occurs only at the plateau on top (if any). Either move works; conventionally use the `≤` branch (e.g., `f(m1) ≤ f(m2)` ⇒ `lo = m1 + 1`).

**Q7. What's the termination condition?**
For integer indices: loop while `hi - lo > 2`, then linear-scan the remaining 1–3 candidates. For real-valued: fixed iteration count (~200) or `hi - lo < eps`.

### Middle level

**Q8. What's golden-section search and why use it instead?**
Golden-section search places probes at `m1 = hi - ρ(hi - lo)` and `m2 = lo + ρ(hi - lo)` where `ρ = 1/φ ≈ 0.618`. The defining property `1 - ρ = ρ²` lets one probe **be reused** from the previous iteration — so it uses **1 function call per iteration after the first**, vs ternary's 2. For expensive `f`, golden-section is ~2× faster.

**Q9. What's the difference between unimodality and convexity?**
Convex functions are unimodal (with a unique minimum), but unimodal functions need not be convex. Convexity is a stronger assumption. Ternary search only requires unimodality.

**Q10. How does ternary search behave on noisy data?**
Poorly. Two close `f(m1)` and `f(m2)` can be swapped by random noise, sending ternary in the wrong direction. Mitigation: average multiple samples per probe, or use a noise-tolerant optimizer like Bayesian optimization.

**Q11. When can you nest ternary searches?**
For 2-D functions that are unimodal **in each variable when the other is fixed** (slightly stronger than just having a single peak). Cost `O(log² n)`. Used in some computational geometry and offline optimization.

**Q12. What's the parametric ternary pattern?**
Like binary search on the answer, but the cost function `cost(x)` is **unimodal** in the parameter `x` rather than monotonic. Ternary-search `x` over its range to find the optimum.

**Q13. Why is golden-section optimal among derivative-free unimodal optimizers?**
Kiefer (1953) proved that the **Fibonacci search** strategy is the optimal evaluation policy for fixed evaluation budgets, and golden-section is the asymptotic limit as budget → ∞. The shrink factor `1/φ` per evaluation is the information-theoretic minimum for derivative-free unimodal optimization.

### Senior level

**Q14. Where does ternary search actually appear in production?**
Contrast-detection autofocus in cameras (with golden-section variant), PID controller autotuning, robotics trajectory smoothing, closest-point-on-convex-curve geometry, peak finding in some controlled time-series.

**Q15. Why not use ternary search for ML hyperparameter tuning?**
Most loss-vs-hyperparameter curves are **multimodal** (multiple local optima from noise, regularization interactions, etc.). Ternary converges to *some* local optimum, often the wrong one. Use Bayesian optimization, random search, or grid search instead.

**Q16. What's the recurrence for ternary search and how do you solve it?**
`T(n) = T(2n/3) + O(1)`. Applying the Master Theorem (case 2, with `a = 1`, `b = 3/2`, `f(n) = O(1)`): solution is `T(n) = O(log n)` with base `log_{3/2}`.

**Q17. When do you prefer bisecting `f'` over ternary search?**
When `f'(x)` is available (analytically or via auto-diff). Bisection on `f'` has the same `O(log)` shrink rate but only 1 evaluation per iteration (vs ternary's 2). It's the natural derivative-aware analog.

### Professional level

**Q18. Prove ternary search's correctness.**
Loop invariant: the unique maximizer `x*` is always within `[lo, hi]`. Base: `[a₀, b₀]` contains `x*` by assumption. Inductive step: case analysis on where `x*` lies relative to `m1` and `m2` shows each branch preserves the invariant. Termination: bracket width shrinks by factor `2/3` each iteration, eventually below `ε`.

**Q19. What's the information-theoretic lower bound for derivative-free unimodal optimization?**
`Ω(log_φ(R/ε))` ≈ `Ω(1.44 log₂(R/ε))` function evaluations, where `R` is the initial range and `ε` is the desired precision. Achieved (asymptotically) by golden-section search.

**Q20. How does Fibonacci search relate to golden-section?**
Fibonacci search is the **discrete, finite-budget** optimal procedure: place `k` probes at positions determined by Fibonacci ratios. Golden-section is its continuous limit (`k → ∞`), where the ratios converge to the golden ratio.

---

## Section B — Coding Challenges

### Challenge 1 — Find Peak in a Bitonic Array

> Given an array `a[]` known to first strictly increase then strictly decrease, find the index of the maximum.

**Go:**
```go
func findPeakBitonic(a []int) int {
    lo, hi := 0, len(a)-1
    for hi-lo > 2 {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if a[m1] < a[m2] {
            lo = m1 + 1
        } else {
            hi = m2 - 1
        }
    }
    best := lo
    for i := lo + 1; i <= hi; i++ {
        if a[i] > a[best] {
            best = i
        }
    }
    return best
}
```

**Java:**
```java
int findPeakBitonic(int[] a) {
    int lo = 0, hi = a.length - 1;
    while (hi - lo > 2) {
        int m1 = lo + (hi - lo) / 3;
        int m2 = hi - (hi - lo) / 3;
        if (a[m1] < a[m2]) lo = m1 + 1;
        else               hi = m2 - 1;
    }
    int best = lo;
    for (int i = lo + 1; i <= hi; i++) {
        if (a[i] > a[best]) best = i;
    }
    return best;
}
```

**Python:**
```python
def find_peak_bitonic(a):
    lo, hi = 0, len(a) - 1
    while hi - lo > 2:
        m1 = lo + (hi - lo) // 3
        m2 = hi - (hi - lo) // 3
        if a[m1] < a[m2]:
            lo = m1 + 1
        else:
            hi = m2 - 1
    return max(range(lo, hi + 1), key=lambda i: a[i])
```

**Complexity:** O(log n) time, O(1) space.

---

### Challenge 2 — Argmax of a Real-Valued Parabola

> Given `f(x) = -2x² + 12x + 5` (or any unimodal `f`), find `argmax_x f(x)` over `[0, 10]` with precision `1e-9`.

**Python:**
```python
def argmax_parabola():
    f = lambda x: -2 * x * x + 12 * x + 5
    lo, hi = 0.0, 10.0
    for _ in range(200):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if f(m1) < f(m2):
            lo = m1
        else:
            hi = m2
    return (lo + hi) / 2
# Expected: x = 3.0  (true maximum of -2x² + 12x + 5)
```

**Go:**
```go
func argmaxParabola() float64 {
    f := func(x float64) float64 { return -2*x*x + 12*x + 5 }
    lo, hi := 0.0, 10.0
    for i := 0; i < 200; i++ {
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
double argmaxParabola() {
    java.util.function.DoubleUnaryOperator f = x -> -2 * x * x + 12 * x + 5;
    double lo = 0, hi = 10;
    for (int i = 0; i < 200; i++) {
        double m1 = lo + (hi - lo) / 3.0;
        double m2 = hi - (hi - lo) / 3.0;
        if (f.applyAsDouble(m1) < f.applyAsDouble(m2)) lo = m1;
        else                                           hi = m2;
    }
    return (lo + hi) / 2;
}
```

**Complexity:** O(log((hi-lo)/eps)) time, O(1) space.

---

### Challenge 3 — Peak Index in a Mountain Array (LeetCode 852)

> A "mountain array" has `a[0] < a[1] < ... < a[i] > a[i+1] > ... > a[n-1]`. Find `i` in O(log n).

**Strategy:** classical "find peak" — can be solved with binary search using adjacent-pair comparison, but ternary fits the unimodal structure naturally.

**Go (binary, the standard answer):**
```go
func peakIndexInMountainArray(a []int) int {
    lo, hi := 0, len(a)-1
    for lo < hi {
        m := lo + (hi-lo)/2
        if a[m] < a[m+1] {
            lo = m + 1
        } else {
            hi = m
        }
    }
    return lo
}
```

**Go (ternary alternative):**
```go
func peakMountainTernary(a []int) int {
    lo, hi := 0, len(a)-1
    for hi-lo > 2 {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if a[m1] < a[m2] {
            lo = m1 + 1
        } else {
            hi = m2 - 1
        }
    }
    best := lo
    for i := lo + 1; i <= hi; i++ {
        if a[i] > a[best] {
            best = i
        }
    }
    return best
}
```

**Python (ternary):**
```python
def peakIndexInMountainArray(a):
    lo, hi = 0, len(a) - 1
    while hi - lo > 2:
        m1 = lo + (hi - lo) // 3
        m2 = hi - (hi - lo) // 3
        if a[m1] < a[m2]: lo = m1 + 1
        else:             hi = m2 - 1
    return max(range(lo, hi + 1), key=lambda i: a[i])
```

**Java (ternary):**
```java
int peakIndexInMountainArray(int[] a) {
    int lo = 0, hi = a.length - 1;
    while (hi - lo > 2) {
        int m1 = lo + (hi - lo) / 3;
        int m2 = hi - (hi - lo) / 3;
        if (a[m1] < a[m2]) lo = m1 + 1;
        else               hi = m2 - 1;
    }
    int best = lo;
    for (int i = lo + 1; i <= hi; i++) if (a[i] > a[best]) best = i;
    return best;
}
```

**Note for the interview:** The classic answer uses binary search with adjacent-element comparison (`a[m] < a[m+1]`). Either is correct; mention both and note that binary is preferred (fewer comparisons).

---

### Challenge 4 — Closest Point on a Parabola to a Query Point

> Given a query point `P = (a, b)` and the parabola `y = x²`, find the point `(t, t²)` on the parabola closest to `P`.

**Strategy:** the squared distance `d²(t) = (t - a)² + (t² - b)²` is unimodal in `t`. Ternary-search it.

**Python:**
```python
def closest_on_parabola(a, b):
    def d2(t):
        return (t - a) ** 2 + (t * t - b) ** 2
    # Conservative bracket
    R = max(10.0, abs(a) + abs(b) ** 0.5 if b > 0 else abs(a) + 10.0)
    lo, hi = -R, R
    for _ in range(300):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if d2(m1) > d2(m2):
            lo = m1
        else:
            hi = m2
    t = (lo + hi) / 2
    return (t, t * t)
```

**Go:**
```go
import "math"
func closestOnParabola(a, b float64) (float64, float64) {
    d2 := func(t float64) float64 {
        return (t-a)*(t-a) + (t*t-b)*(t*t-b)
    }
    R := math.Max(10.0, math.Abs(a)+math.Sqrt(math.Max(0, b))+1)
    lo, hi := -R, R
    for i := 0; i < 300; i++ {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if d2(m1) > d2(m2) {
            lo = m1
        } else {
            hi = m2
        }
    }
    t := (lo + hi) / 2
    return t, t * t
}
```

**Java:**
```java
double[] closestOnParabola(double a, double b) {
    java.util.function.DoubleUnaryOperator d2 = t ->
        (t - a) * (t - a) + (t * t - b) * (t * t - b);
    double R = Math.max(10.0, Math.abs(a) + Math.sqrt(Math.max(0, b)) + 1);
    double lo = -R, hi = R;
    for (int i = 0; i < 300; i++) {
        double m1 = lo + (hi - lo) / 3.0;
        double m2 = hi - (hi - lo) / 3.0;
        if (d2.applyAsDouble(m1) > d2.applyAsDouble(m2)) lo = m1;
        else                                             hi = m2;
    }
    double t = (lo + hi) / 2;
    return new double[]{t, t * t};
}
```

**Complexity:** O(log(R/eps)) function evals; ~300 iters gives near-machine precision.

---

### Challenge 5 — Minimum Time to Reach Closest Approach (Moving Object)

> A car drives along `x(t) = x0 + v*t`, `y(t) = y0` for `t ≥ 0`. Find the time `t*` minimizing distance to the static target `(a, b)`.

**Strategy:** distance is unimodal in `t`. Use ternary search.

**Python:**
```python
def closest_time(x0, y0, v, a, b):
    def dist(t):
        dx = (x0 + v * t) - a
        dy = y0 - b
        return (dx * dx + dy * dy) ** 0.5
    lo, hi = 0.0, 1e9
    for _ in range(300):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if dist(m1) > dist(m2):
            lo = m1
        else:
            hi = m2
    return (lo + hi) / 2
```

**Go:**
```go
import "math"
func closestTime(x0, y0, v, a, b float64) float64 {
    dist := func(t float64) float64 {
        dx := (x0 + v*t) - a
        dy := y0 - b
        return math.Sqrt(dx*dx + dy*dy)
    }
    lo, hi := 0.0, 1e9
    for i := 0; i < 300; i++ {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if dist(m1) > dist(m2) {
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
double closestTime(double x0, double y0, double v, double a, double b) {
    java.util.function.DoubleUnaryOperator dist = t -> {
        double dx = (x0 + v * t) - a;
        double dy = y0 - b;
        return Math.sqrt(dx * dx + dy * dy);
    };
    double lo = 0, hi = 1e9;
    for (int i = 0; i < 300; i++) {
        double m1 = lo + (hi - lo) / 3.0;
        double m2 = hi - (hi - lo) / 3.0;
        if (dist.applyAsDouble(m1) > dist.applyAsDouble(m2)) lo = m1;
        else                                                 hi = m2;
    }
    return (lo + hi) / 2;
}
```

**Note:** the closed-form is `t* = ((a - x0) * v) / (v * v)` for `v ≠ 0`, but ternary works without knowing it — useful for non-linear trajectories.

---

### Challenge 6 — Maximum-Throughput Throttle Setting (Parametric)

> A network connection's throughput as a function of "send rate" is unimodal — too slow underutilizes, too fast triggers congestion control. Given a black-box `measure(rate) -> throughput`, find the optimal rate in `[1, 1e6]` Mbps with precision `1e-3`.

**Python:**
```python
def best_send_rate(measure):
    """measure: function rate -> achieved throughput (Mbps)."""
    lo, hi = 1.0, 1e6
    while hi - lo > 1e-3:
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if measure(m1) < measure(m2):
            lo = m1
        else:
            hi = m2
    return (lo + hi) / 2
```

**Go:**
```go
func bestSendRate(measure func(float64) float64) float64 {
    lo, hi := 1.0, 1e6
    for hi-lo > 1e-3 {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if measure(m1) < measure(m2) {
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
double bestSendRate(java.util.function.DoubleUnaryOperator measure) {
    double lo = 1.0, hi = 1e6;
    while (hi - lo > 1e-3) {
        double m1 = lo + (hi - lo) / 3.0;
        double m2 = hi - (hi - lo) / 3.0;
        if (measure.applyAsDouble(m1) < measure.applyAsDouble(m2)) lo = m1;
        else                                                       hi = m2;
    }
    return (lo + hi) / 2;
}
```

**Discussion point for interview:** real network throughput is noisy. In production, **average several `measure(rate)` calls** per ternary probe and add a noise tolerance. Mention this to the interviewer.

---

### Challenge 7 — Golden-Section Search

> Implement golden-section search for finding the argmax of a unimodal function `f` on `[a, b]` with precision `eps`. Aim for **one new function call per iteration** after the first.

**Python:**
```python
import math
def golden_section_max(f, a, b, eps=1e-9):
    rho = (math.sqrt(5) - 1) / 2  # 0.618...
    m1 = b - rho * (b - a)
    m2 = a + rho * (b - a)
    f1, f2 = f(m1), f(m2)
    while b - a > eps:
        if f1 < f2:
            a = m1
            m1, f1 = m2, f2
            m2 = a + rho * (b - a)
            f2 = f(m2)
        else:
            b = m2
            m2, f2 = m1, f1
            m1 = b - rho * (b - a)
            f1 = f(m1)
    return (a + b) / 2
```

**Go:**
```go
import "math"
func goldenSectionMax(f func(float64) float64, a, b, eps float64) float64 {
    rho := (math.Sqrt(5) - 1) / 2
    m1 := b - rho*(b-a)
    m2 := a + rho*(b-a)
    f1, f2 := f(m1), f(m2)
    for b-a > eps {
        if f1 < f2 {
            a = m1
            m1, f1 = m2, f2
            m2 = a + rho*(b-a)
            f2 = f(m2)
        } else {
            b = m2
            m2, f2 = m1, f1
            m1 = b - rho*(b-a)
            f1 = f(m1)
        }
    }
    return (a + b) / 2
}
```

**Java:**
```java
double goldenSectionMax(java.util.function.DoubleUnaryOperator f,
                        double a, double b, double eps) {
    double rho = (Math.sqrt(5) - 1) / 2.0;
    double m1 = b - rho * (b - a);
    double m2 = a + rho * (b - a);
    double f1 = f.applyAsDouble(m1), f2 = f.applyAsDouble(m2);
    while (b - a > eps) {
        if (f1 < f2) {
            a = m1;
            m1 = m2; f1 = f2;
            m2 = a + rho * (b - a); f2 = f.applyAsDouble(m2);
        } else {
            b = m2;
            m2 = m1; f2 = f1;
            m1 = b - rho * (b - a); f1 = f.applyAsDouble(m1);
        }
    }
    return (a + b) / 2;
}
```

**Discussion:**
- One new `f` call per iteration (after the first 2).
- `~1.44 × log₂((b - a) / eps)` total evaluations — vs ternary's `~3.42 × log₂(...)`.
- For expensive `f`, this is the gold standard derivative-free 1-D optimizer.

---

## Section C — Common Interview Pitfalls

### Pitfall 1 — Applying ternary to non-unimodal data
The #1 mistake. If you don't verify unimodality, ternary may return any random index. Always state the assumption out loud: "I'm assuming `f` is strictly unimodal — let me verify this from the constraints."

### Pitfall 2 — Using ternary for sorted-array lookup
Binary search is strictly better. Don't use ternary here; the interviewer will deduct points. Only use ternary when the function is **unimodal**.

### Pitfall 3 — `(lo + hi) / 3` instead of `lo + (hi - lo) / 3`
The wrong formula has the wrong geometric meaning *and* overflow risk. Always use `lo + (hi - lo) / 3`.

### Pitfall 4 — Forgetting the `f(m1) == f(m2)` case
On a plateau, neither pure `<` nor `>` branch fires, leading to an infinite loop. Use `≤` or `≥` to combine the equal case with one branch.

### Pitfall 5 — Precision-only termination on floats
`while hi - lo > eps` can hang if `eps` is below float rounding error. Use a fixed iteration count (~200) for safety.

### Pitfall 6 — Wrong direction (min vs max)
`f(m1) < f(m2) ⇒ lo = m1` finds the maximum (peak is to the right of `m1`). For a minimum, the comparison flips.

### Pitfall 7 — Two probes per iteration when one would do
If `f` is expensive, golden-section search uses 1 evaluation per iteration after the first. Mention this in the interview — it shows you know the optimization-theory background.

### Pitfall 8 — Off-by-one in integer termination
`while hi - lo > 2` + linear scan of `[lo, hi]` is unconditionally correct. `while lo < hi` is bug-prone for ternary; use the former.

### Pitfall 9 — Assuming convergence on noisy data
Real-world cost functions are noisy. A single probe pair can mislead. Mention noise handling (averaging, smoothing) in production.

### Pitfall 10 — Using ternary when gradient is available
If `f'(x)` is computable, bisect `f'(x) = 0` instead — same shrink, 1 evaluation per iteration of `f'` only.

---

## Section D — Mock Interview Drill

A 45-minute interview centered on ternary search might look like:

1. **Warmup (5 min):** Describe ternary search. When does it apply? Why not use binary?
2. **Coding (15 min):** Write ternary search on a bitonic integer array (Challenge 1).
3. **Variant (10 min):** Modify for a real-valued function (Challenge 2). Discuss termination.
4. **Discussion (10 min):** Compare to golden-section search. Why is it faster? When does it matter?
5. **Stretch (5 min):** Describe a real-world use case (autofocus, PID tuning, closest point on parabola).

**Drill questions to practice aloud:**
- *"Walk through ternary search step by step on `[1, 3, 8, 12, 15, 9, 4, 1]`."*
- *"What if `f` is multimodal? How do you adapt?"* (Answer: you don't; use a global optimizer.)
- *"How would you find the closest point on a parabola to (3, 7)?"* (Answer: ternary-search the parameter `t` on the distance function.)
- *"Why is golden-section optimal among derivative-free methods?"* (Kiefer 1953, Fibonacci search asymptotic.)
- *"Why use binary search instead of ternary on sorted data?"* (Fewer comparisons per shrink.)

Memorize the integer template, the real-valued template, the unimodality check, and the comparison with golden-section. With those, you can handle 90% of ternary-related interview questions.
