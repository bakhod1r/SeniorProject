# Ternary Search — Middle Level

> **Audience:** Engineers who have implemented ternary search on a unimodal array and want the surrounding family of optimization techniques used in real production code and competitive programming. Prerequisite: `junior.md`.

This document goes deeper into **derivative-free optimization on unimodal domains**: the relationship between ternary search and **golden-section search** (the canonical efficient version), **parametric ternary search** for "minimize the maximum"-style problems, **nested ternary search** for 2-D unimodal surfaces, the **convexity-vs-unimodality distinction**, the comparison with **gradient descent** and **Newton's method** when derivatives are available, and a clear-eyed comparison of ternary search vs **bisection on derivatives** (the other classical approach).

---

## Table of Contents

1. [Golden-Section Search — Half the Evaluations](#golden-section)
2. [Parametric Ternary Search](#parametric)
3. [Nested Ternary for 2-D Surfaces](#nested)
4. [Convexity vs Unimodality](#convexity)
5. [Ternary on Derivatives — `f'(x) = 0`](#derivative-bisection)
6. [Compared with Gradient Descent and Newton's Method](#vs-gradient)
7. [Comparison Table — Which Optimizer to Pick](#comparison)

---

<a name="golden-section"></a>
## 1. Golden-Section Search — Half the Evaluations

Ternary search calls `f` twice per iteration and shrinks the range by `2/3`. **Golden-section search** does the same shrink but calls `f` only **once per iteration after the first** — because the inner probe from the previous iteration becomes one of the new probes. When `f` is expensive (a physics simulation, a costly hyperparameter evaluation, a black-box network round trip), halving the call count is huge.

### 1.1 The setup

Let `φ = (√5 + 1) / 2 ≈ 1.618` (the golden ratio) and `ρ = 1 / φ ≈ 0.618`. Place the two probe points so that they are symmetric about the midpoint and divide the range in golden proportions:

```
m1 = hi - ρ × (hi - lo)
m2 = lo + ρ × (hi - lo)
```

Equivalently, `m1 = lo + (1 - ρ)(hi - lo)` and `m2 = lo + ρ(hi - lo)`, so the three pieces have widths `(1 - ρ)`, `(2ρ - 1)`, `(1 - ρ)` — the outer pieces are equal, the middle is the shortest.

### 1.2 The reuse trick

When we shrink to `[m1, hi]` (the case `f(m1) < f(m2)`):
- New range: `[m1, hi]` of width `ρ × (old width)`.
- New probes: `m1' = hi - ρ²(hi - lo)` and `m2' = m1 + ρ × ρ(hi - lo) = lo + ρ²(hi - lo) + ρ²(hi - lo) × ...`

It works out that **`m1' == m2`** (the old `m2` becomes the new `m1`), so we already have `f(m1')` from the previous iteration. Only `m2'` is new. **One function call per iteration after the first.**

The number-theoretic reason this works: `1 - ρ = ρ²`, which is exactly the defining property of the golden ratio. Any other ratio loses the reuse property.

### 1.3 Implementation

**Python:**
```python
import math

def golden_section_max(lo: float, hi: float, f, eps: float = 1e-9) -> float:
    """Find argmax of unimodal f on [lo, hi] using golden-section search."""
    rho = (math.sqrt(5) - 1) / 2  # 0.618…

    m1 = hi - rho * (hi - lo)
    m2 = lo + rho * (hi - lo)
    f1, f2 = f(m1), f(m2)

    while hi - lo > eps:
        if f1 < f2:
            lo = m1
            m1, f1 = m2, f2
            m2 = lo + rho * (hi - lo)
            f2 = f(m2)
        else:
            hi = m2
            m2, f2 = m1, f1
            m1 = hi - rho * (hi - lo)
            f1 = f(m1)
    return (lo + hi) / 2
```

**Go:**
```go
package goldensec

import "math"

func GoldenSectionMax(lo, hi float64, f func(float64) float64, eps float64) float64 {
    rho := (math.Sqrt(5) - 1) / 2
    m1 := hi - rho*(hi-lo)
    m2 := lo + rho*(hi-lo)
    f1, f2 := f(m1), f(m2)
    for hi-lo > eps {
        if f1 < f2 {
            lo = m1
            m1, f1 = m2, f2
            m2 = lo + rho*(hi-lo)
            f2 = f(m2)
        } else {
            hi = m2
            m2, f2 = m1, f1
            m1 = hi - rho*(hi-lo)
            f1 = f(m1)
        }
    }
    return (lo + hi) / 2
}
```

**Java:**
```java
public static double goldenSectionMax(double lo, double hi,
                                      java.util.function.DoubleUnaryOperator f,
                                      double eps) {
    double rho = (Math.sqrt(5) - 1) / 2.0;
    double m1 = hi - rho * (hi - lo);
    double m2 = lo + rho * (hi - lo);
    double f1 = f.applyAsDouble(m1), f2 = f.applyAsDouble(m2);
    while (hi - lo > eps) {
        if (f1 < f2) {
            lo = m1; m1 = m2; f1 = f2;
            m2 = lo + rho * (hi - lo); f2 = f.applyAsDouble(m2);
        } else {
            hi = m2; m2 = m1; f2 = f1;
            m1 = hi - rho * (hi - lo); f1 = f.applyAsDouble(m1);
        }
    }
    return (lo + hi) / 2;
}
```

### 1.4 Complexity comparison

| Method | Iterations to precision `ε` (range `R`) | Evaluations per iter | Total `f` calls |
|---|---|---|---|
| Ternary | `log_{1.5}(R/ε) ≈ 1.71 × log₂(R/ε)` | 2 | `~3.42 × log₂(R/ε)` |
| Golden section | `log_{1/ρ}(R/ε) ≈ 1.44 × log₂(R/ε)` | 1 (after first) | `~1.44 × log₂(R/ε) + 1` |

Golden section makes **about 42% the number of function calls** of ternary search for the same precision. For a function that costs 100 ms per evaluation (e.g., a physics sim), reaching `1e-9` precision over `[0, 1]` takes:
- Ternary: ~100 evaluations × 100 ms = 10 seconds.
- Golden section: ~44 evaluations × 100 ms = 4.4 seconds.

When `f` is cheap (arithmetic, table lookup), ternary's slightly simpler bookkeeping breaks even or wins on overhead. Benchmark for your specific case.

### 1.5 Fibonacci search — the discrete cousin

When you must use exactly `n` evaluations (e.g., a fixed budget), **Fibonacci search** is the optimal discrete analog. It uses Fibonacci numbers `F_k` to choose probe positions and achieves the **information-theoretic minimum** number of evaluations for any precision in the discrete setting. Golden-section is the continuous limit of Fibonacci search.

---

<a name="parametric"></a>
## 2. Parametric Ternary Search

The "binary search on the answer" pattern (LC 875 Koko, LC 1011 Capacity to Ship) is one of the most powerful interview tricks. **Parametric ternary search** is its sibling for the case where the cost function is **unimodal in the parameter**, not monotonic.

### 2.1 Pattern

You have a problem where:
1. The answer `x*` minimizes (or maximizes) some `cost(x)`.
2. `cost(x)` is **unimodal** in `x` over a known range `[lo, hi]`.
3. Each `cost(x)` evaluation is feasible (polynomial, not exponential).

Then: **ternary-search `x`** over `[lo, hi]`.

### 2.2 Example: minimize sum of distances to a moving point

A car travels along a road at speed `v`. At time `t`, its position is `p(t) = (x₀ + v × t, y₀)`. You have a static point `(a, b)`. Find the time `t*` that minimizes the distance between the car and the static point.

The distance `d(t) = √((x₀ + vt - a)² + (y₀ - b)²)` is unimodal in `t` — it decreases as the car approaches the perpendicular foot, then increases as it passes.

```python
def closest_time(x0, y0, v, a, b):
    def d(t):
        dx = (x0 + v * t) - a
        dy = y0 - b
        return (dx * dx + dy * dy) ** 0.5
    lo, hi = 0.0, 1e9
    for _ in range(200):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if d(m1) < d(m2):
            hi = m2
        else:
            lo = m1
    return (lo + hi) / 2
```

(This particular case has a closed-form solution via calculus, but ternary search works without knowing it — useful when the trajectory is non-trivial.)

### 2.3 Example: choose the best gear ratio

A bicycle has a continuously variable gear ratio `r ∈ [0.5, 4.0]`. The time to traverse a known route is some function `time(r)` computed by a physics simulator. Empirically, `time(r)` is unimodal — low `r` means too many pedal strokes, high `r` means struggling on hills.

```python
def best_gear_ratio(route_simulator):
    lo, hi = 0.5, 4.0
    for _ in range(50):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if route_simulator(m1) > route_simulator(m2):
            lo = m1
        else:
            hi = m2
    return (lo + hi) / 2
```

50 iterations × 2 simulator calls = 100 simulations to find the best ratio to ~`(2/3)^50 × 3.5 ≈ 2.4 × 10⁻⁹` precision. Reasonable for an offline optimization.

### 2.4 Example: "the longest box that fits"

You have boxes of dimensions `(L, W, H)` and a doorway. The maximum `L` that fits while sliding the box at angle `θ` is `min(W/sin(θ), H/cos(θ))` — unimodal in `θ`. Find the `θ` that maximizes the fitting `L`.

```python
import math
def longest_box(W, H):
    def L(theta):
        return min(W / math.sin(theta), H / math.cos(theta))
    lo, hi = 0.01, math.pi / 2 - 0.01
    for _ in range(200):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if L(m1) < L(m2):
            lo = m1
        else:
            hi = m2
    return L((lo + hi) / 2)
```

This is a classic geometry problem ("ladder around a corner") whose unimodal structure makes ternary search natural.

### 2.5 The recipe

1. Identify the parameter `x` and the cost/value function `f(x)`.
2. Prove (or check empirically by plotting) that `f(x)` is unimodal in the relevant range.
3. Bound `x` to `[lo, hi]`.
4. Ternary or golden-section search.

The proof of unimodality is often the hardest step. Two useful sufficient conditions:
- **Convexity** (for minima). If `f`'s second derivative is non-negative throughout the range, `f` is convex and unimodal.
- **Sum of unimodal functions with matching peaks**. If `f₁` and `f₂` both peak at the same `x*`, so does `f₁ + f₂`.

When in doubt, **plot the function** for a few values and visually confirm unimodality. Then run ternary.

---

<a name="nested"></a>
## 3. Nested Ternary for 2-D Surfaces

What if `f(x, y)` is unimodal in **both** variables — i.e., for any fixed `y`, `f(·, y)` is unimodal in `x`, and for any fixed `x`, `f(x, ·)` is unimodal in `y`? Then you can **nest** two ternary searches.

### 3.1 The algorithm

For each candidate `x` along the outer search, run an inner ternary search over `y` to find the best `y` given that `x`. Return the `(x, y)` with the best inner result.

**Python:**
```python
def ternary_max_2d(lo_x, hi_x, lo_y, hi_y, f, iters=100):
    def best_y_given(x):
        a, b = lo_y, hi_y
        for _ in range(iters):
            m1 = a + (b - a) / 3
            m2 = b - (b - a) / 3
            if f(x, m1) < f(x, m2):
                a = m1
            else:
                b = m2
        return f(x, (a + b) / 2)

    a, b = lo_x, hi_x
    for _ in range(iters):
        m1 = a + (b - a) / 3
        m2 = b - (b - a) / 3
        if best_y_given(m1) < best_y_given(m2):
            a = m1
        else:
            b = m2
    return (a + b) / 2
```

### 3.2 Complexity

Each outer iteration does 2 inner ternary searches, each of which does `~3.42 × log₂(R/ε)` function evaluations. Total: `O(log² n)` evaluations. For 100-iter outer × 100-iter inner × 2 calls: **40,000 evaluations** for 2-D precision. Worse than 1-D's ~100 but still much better than a 2-D grid scan of size `n² = 10⁸`.

### 3.3 The unimodality requirement (2-D)

You need `f(x, y)` to be unimodal **along every axis-aligned line through the domain**. This is stronger than just "has a single peak". A function with a single peak but a curved ridge (think of a banana-shaped valley) is unimodal globally but **not** along every axis-aligned line — nested ternary may fail.

The safer abstraction is **convexity**: if `f` is convex (for a minimization), nested ternary works because every cross-section is convex (hence unimodal).

### 3.4 Higher dimensions

You can nest k-deep for k-dimensional unimodal functions, but the cost is `O(log^k n)` evaluations. For k = 3 it's still tractable; beyond that, use gradient methods or Bayesian optimization. Hyperparameter searches with many dimensions almost always use those instead.

---

<a name="convexity"></a>
## 4. Convexity vs Unimodality

The two concepts are related but distinct, and ternary search exploits the weaker one (unimodality). Knowing which assumption your problem satisfies tells you which algorithm to use.

### 4.1 Definitions

A function `f : [a, b] → ℝ` is:

- **Unimodal** with a maximum at `x*` if `f` is strictly increasing on `[a, x*]` and strictly decreasing on `[x*, b]`.
- **Convex** (for the minimization sense) if for every `λ ∈ [0, 1]` and every `x, y`:
  ```
  f(λx + (1-λ)y) ≤ λ f(x) + (1-λ) f(y)
  ```
  Equivalently (when `f` is twice differentiable), `f''(x) ≥ 0` everywhere.
- **Strictly convex** if the inequality is strict for `λ ∈ (0, 1)` and `x ≠ y`.

### 4.2 Relationships

- **Strictly convex ⇒ unimodal (with a unique minimum).**
- **Unimodal does NOT imply convex.** A unimodal function can have a "fat" peak or weird-shaped sides.

### 4.3 Why does it matter?

| Property | Allowed algorithms |
|---|---|
| Convex (smooth) | Newton's method, gradient descent, ternary, golden section, bisection on `f'` |
| Convex (non-smooth) | Subgradient methods, ternary, golden section |
| Unimodal (non-convex) | Ternary, golden section |
| Multimodal | Global optimizers (Bayesian, GA, SA, basin hopping) |
| Discrete unimodal | Integer ternary, exhaustive scan if `n` small |

If you know convexity, you have more options. If you only know unimodality, ternary/golden are the safe choice.

### 4.4 Quick checks

- **Is `f` differentiable?** Compute `f'`. If `f'` is continuous and crosses zero exactly once in the range, `f` is unimodal.
- **Is `f` convex?** Compute `f''`. If `f'' ≥ 0` everywhere, yes.
- **Empirical check.** Sample `f` at 20 points in the range. Look at the sequence of values. If it's monotonically increasing then monotonically decreasing (with at most one direction change), it's unimodal *on the samples* — not a proof but a strong hint.

---

<a name="derivative-bisection"></a>
## 5. Ternary on Derivatives — `f'(x) = 0`

If you can compute `f'(x)` analytically or via automatic differentiation, you can **binary-search the derivative for zero**. At a maximum, `f'(x*) = 0` and `f'` is positive to the left, negative to the right — a monotonic predicate. Binary search nails it in `log₂(R/ε)` evaluations.

### 5.1 The procedure

**Python:**
```python
def find_max_via_derivative(lo, hi, f_prime, eps=1e-12):
    """f_prime(x) returns f'(x). Assumes f is unimodal with f'(lo) > 0 and f'(hi) < 0."""
    for _ in range(100):
        mid = (lo + hi) / 2
        if f_prime(mid) > 0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2
```

### 5.2 Comparison with ternary

| Aspect | Ternary on `f` | Bisection on `f'` |
|---|---|---|
| Function calls per iter | 2 (ternary) or 1 (golden) | 1 (`f'` only) |
| Shrink per iter | 2/3 (ternary), `1/φ` (golden) | 1/2 (faster) |
| Total work | `~3.4 × log₂` (ternary), `~1.44 × log₂` (golden) | `~log₂` evaluations of `f'` |
| Needs derivative? | No | Yes |
| Needs unimodal `f`? | Yes | Yes (and `f'` must be continuous and change sign once) |

**Bisection on the derivative wins by ~30% when the derivative is available** and equally costly to evaluate. It is what scipy's `brentq`-style routines do under the hood.

### 5.3 Newton's method — the next step up

If you have **both** `f'` and `f''`, Newton's method converges **quadratically** instead of geometrically:

```
x_{k+1} = x_k - f'(x_k) / f''(x_k)
```

Each iteration roughly doubles the number of correct digits. Reaching `1e-9` precision from a reasonable initial guess takes ~5–6 iterations. **Two orders of magnitude faster than ternary.**

Caveat: Newton requires a good initial guess and doesn't guarantee global convergence on non-convex `f`. Hybrid strategies (bisect a few iterations to localize, then Newton to polish) are common in production scientific code.

---

<a name="vs-gradient"></a>
## 6. Compared with Gradient Descent and Newton's Method

For 1-D unimodal optimization, here's the landscape:

| Algorithm | Needs | Iterations to `ε` precision | Per-iter cost |
|---|---|---|---|
| Linear scan | nothing | `O(R/ε)` | 1 |
| Ternary search | unimodality | `~1.71 × log₂(R/ε)` | 2 `f` calls |
| Golden-section | unimodality | `~1.44 × log₂(R/ε)` | 1 `f` call (amortized) |
| Bisection on `f'` | unimodality + `f'` | `log₂(R/ε)` | 1 `f'` call |
| Newton's method | `f'`, `f''`, convexity / good init | `~log₂(log₂(R/ε))` (quadratic) | 1 `f'`, 1 `f''` |
| Gradient descent | `f'`, smoothness, learning rate | `O(1/ε)` (for convex `f`) | 1 `f'` call |
| Quasi-Newton (BFGS) | `f'`, decent init | superlinear | `f'` + Hessian update |

For **1-D problems specifically**, gradient descent is rarely the right tool — it has the wrong convergence rate and there's no benefit over bisection on `f'`. Gradient descent dominates in **high dimensions** where ternary cannot reach.

The summary for 1-D:
- **No derivative, just `f`:** ternary or golden section. (Golden if `f` expensive.)
- **`f'` available:** bisection on `f'`.
- **`f'` and `f''` available, convex:** Newton's method.
- **Multimodal:** none of the above; use a global optimizer.

For high-D:
- **`∇f` available, smooth:** gradient descent / Adam / L-BFGS.
- **Black box, low D (≤ ~20):** Bayesian optimization.
- **Black box, very low D (≤ ~3):** nested ternary or grid search.
- **Combinatorial:** simulated annealing, GA, or exact methods.

---

<a name="comparison"></a>
## 7. Comparison Table — Which Optimizer to Pick

| Situation | Recommended | Why |
|---|---|---|
| Sorted array lookup | Binary search | Ternary is strictly worse. |
| Unimodal int array, find peak | Ternary search | Standard textbook case. |
| Real-valued unimodal, cheap `f` | Ternary search | Simple, robust. |
| Real-valued unimodal, expensive `f` | Golden section | Halves the call count. |
| Convex `f`, have `f'` | Bisection on `f'` | Faster shrink, one call. |
| Smooth convex `f`, have `f'` & `f''` | Newton's method | Quadratic convergence. |
| Multi-D smooth | Gradient descent / L-BFGS | Right tool for high-D. |
| 2-D unimodal in each axis | Nested ternary | OK for offline; expensive online. |
| Multimodal black box | Bayesian / GA / SA | Global, not local. |
| Discrete fixed budget | Fibonacci search | Information-theoretic optimum. |
| Noisy `f` | Bayesian optimization, smoothing surrogate | Ternary fragile to noise. |

---

## Cheat Sheet — Algorithm Selection

```
Goal                                          Best tool
-----                                         ----------
Lookup in sorted array                        Binary search
Peak of unimodal array                        Ternary search
Argmax of unimodal real f, cheap f            Ternary search
Argmax of unimodal real f, expensive f        Golden-section search
Argmax with discrete fixed call budget        Fibonacci search
Argmax of convex f, derivative available      Bisection on f'
Argmax of convex f, f' and f'' available      Newton's method
Argmax in 2D, unimodal each axis              Nested ternary
Argmax in high D, gradient available          Gradient descent / L-BFGS
Argmax of multimodal black box                Bayesian optimization
Noisy optimization                            Bayesian / smoothed surrogate
```

---

## Further Reading

- **Kiefer**, "Sequential minimax search for a maximum" (1953). Original golden-section paper.
- **Brent**, *Algorithms for Minimization Without Derivatives* (1973). Definitive reference on derivative-free 1-D optimization, including Brent's hybrid method (a robust default).
- **Nocedal & Wright**, *Numerical Optimization*, 2nd ed., Chapters 3 and 6. Line search and Newton-type methods.
- **CP-Algorithms** entry on Ternary Search — competitive-programming examples.
- **SciPy** source for `scipy.optimize.minimize_scalar(method='golden')` — production-grade golden-section.
- Continue with `senior.md` for the production-side view: optimization in control systems, real-time tuning, and where ternary appears in CV / robotics pipelines.
