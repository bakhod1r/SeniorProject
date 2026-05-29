# Newton's Method (Newton–Raphson) — Junior Level

> **Read time: ~35 minutes** · **Audience:** First-year CS students, bootcamp grads, anyone who has just learned derivatives and loops.

Newton's Method — also called the **Newton–Raphson method** — is the **single most important root-finding algorithm** ever written down. It is the reason your CPU can compute square roots in a handful of cycles, the reason division on early ARM and modern GPUs uses no hardware divider at all, the reason `Math.sqrt` returns 16 correct digits in 4 iterations, and the reason logistic regression converges in 5–10 steps instead of 5–10 thousand. If you understand it deeply, a vast region of numerical computing suddenly clicks into place.

This document teaches Newton's method **so thoroughly** that you will never wonder where the formula `x_{n+1} = x_n − f(x_n)/f'(x_n)` came from, never be surprised that the iteration count is "only 4 or 5", and never be confused when it diverges on a bad seed. We cover the tangent-line derivation, the quadratic convergence property that doubles correct digits every step, the Babylonian sqrt as a special case, the Quake III fast inverse square root with the magic constant `0x5f3759df`, the canonical failure modes (zero derivative, oscillation, divergence), and the safe production pattern of "Newton with bisection fallback" used in Brent's method and in `glibc`'s `sqrt`.

---

## Table of Contents

1. [Introduction — Walk Down a Tangent](#introduction)
2. [Prerequisites — Differentiability and a Decent Seed](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — Tangent Line, Linearization, Iteration](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons](#pros-and-cons)
8. [Step-by-Step Walkthrough](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Coding Patterns — Babylonian sqrt and Fast Inverse sqrt](#patterns)
11. [Error Handling — Zero Derivative and Divergence](#errors)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases](#edge-cases)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation Reference](#animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — Walk Down a Tangent

You want to find a value `x` such that `f(x) = 0` — a **root** of `f`. For most equations, no closed-form solution exists. `x³ − x − 1 = 0`? Closed form, but ugly. `cos(x) = x`? No elementary closed form. `x − 2sin(x) = 0`? Same.

Binary search (bisection) solves this by narrowing a bracket `[a, b]` where `f(a) < 0 < f(b)`, halving each iteration. After 30 iterations you have ~9 decimal digits. Not bad — but it's slow, in the sense that each iteration only buys you **one bit** of precision.

Newton's method does something cleverer. At your current guess `x_n`, it does **not** look at `f(x_n)` and `f(x_{n-1})` like bisection does. Instead it looks at the **slope** of `f` at `x_n` — the derivative `f'(x_n)` — and pretends, for one step, that `f` is a straight line through that point. The straight line crosses zero at some `x_{n+1}`. Use that as your next guess. Repeat.

The straight line through `(x_n, f(x_n))` with slope `f'(x_n)` is `y = f(x_n) + f'(x_n)·(x − x_n)`. Setting `y = 0` and solving for `x`:

```
0 = f(x_n) + f'(x_n)·(x_{n+1} − x_n)
x_{n+1} = x_n − f(x_n) / f'(x_n)
```

That's the entire algorithm. One line. The magic is what happens when you iterate it: starting reasonably close to a real root, the number of correct digits **roughly doubles** each step. After:

- 1 iteration: 2 correct digits
- 2 iterations: 4
- 3 iterations: 8
- 4 iterations: 16 — full `double` precision

Compare with bisection, which buys 1 bit per step. **4 Newton steps ≈ 50 bisection steps.** This is **quadratic convergence**, and it is the property that puts Newton's method everywhere from `glibc`'s `sqrt` to the iterative refinement loops inside Tesla's autopilot.

The catch — and it is non-negotiable — is that you must (a) have a derivative, (b) the derivative must not be zero near the root, and (c) you need a starting point close enough that the tangent line is a sensible approximation. Pick a bad seed and Newton can diverge to infinity, oscillate forever between two bad guesses, or jump to a completely different root. We cover all three failures in §11.

---

<a name="prerequisites"></a>
## 2. Prerequisites — Differentiability and a Decent Seed

Before Newton's method applies, you must have:

1. **A differentiable function `f`.** You need both `f(x)` and `f'(x)` evaluable at any candidate `x`. If you only have `f` as a black box, you can use the **secant method** (finite-difference derivative) instead — see `middle.md`.
2. **A non-zero derivative at and near the root.** The formula divides by `f'(x_n)`; if `f'(x_n) = 0` you blow up. Geometrically, the tangent is horizontal and never crosses the x-axis.
3. **A reasonable starting point `x_0`.** "Reasonable" usually means "in the basin of attraction of the desired root". For well-behaved problems (sqrt, division, smooth concave functions) almost any positive seed works. For wild functions (high-degree polynomials with many roots) a bad seed converges to the wrong root or diverges entirely.
4. **A stopping criterion.** Floating-point arithmetic cannot reach exact zero; you need a tolerance like `|x_{n+1} − x_n| < eps` or `|f(x_n)| < eps`, plus an iteration cap as a safety net.

If you cannot meet these, fall back to:
- **Bisection / binary search** when you have a bracket `[a, b]` with sign change. Slower (linear convergence) but **guaranteed**.
- **Secant method** when you have no derivative. Convergence order ≈ 1.618 (golden ratio), between linear and quadratic.
- **Brent's method** in production when you want both safety and speed. It blends bisection and inverse-quadratic interpolation and is what SciPy's `brentq` uses by default.

**Rule of thumb:** Use Newton when (a) the derivative is cheap, (b) you have a good seed, and (c) you need many digits of precision fast. Use bisection when you want guaranteed convergence and don't mind 30–50 iterations.

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **Root / zero** | A value `r` with `f(r) = 0`. The target of root-finding. |
| **Iteration / step** | One application of the update rule, producing `x_{n+1}` from `x_n`. |
| **`f(x)`** | The function whose root we seek. Must be evaluable at any `x`. |
| **`f'(x)`** | The derivative of `f`. Slope of the tangent line at `x`. |
| **Tangent line** | Line through `(x_n, f(x_n))` with slope `f'(x_n)`. Best linear approximation to `f` near `x_n`. |
| **Linearization** | The act of replacing `f` with its tangent line for one step. Newton uses linearization as its update rule. |
| **Basin of attraction** | The set of starting points `x_0` from which Newton converges to a given root. |
| **Quadratic convergence** | Error roughly squares each step: `e_{n+1} ≈ C · e_n²`. Number of correct digits doubles. |
| **Linear convergence** | Error shrinks by a constant factor each step: `e_{n+1} ≈ ρ · e_n` with `ρ < 1`. Bisection has `ρ = 0.5`. |
| **Simple root** | A root where `f'(r) ≠ 0`. Newton converges quadratically. |
| **Multiple root** | A root where `f(r) = f'(r) = 0`. Newton degrades to linear convergence. |
| **Seed / initial guess** | The starting value `x_0`. Choosing it well is half the battle. |
| **Stopping criterion** | The rule that decides when to halt: `|Δx| < eps`, `|f(x)| < eps`, or iteration cap reached. |
| **Damped Newton** | `x_{n+1} = x_n − α · f(x_n)/f'(x_n)` with `0 < α ≤ 1`. Sacrifices quadratic convergence for stability. |
| **Babylonian / Heron method** | The special case of Newton applied to `f(x) = x² − n`: `x' = (x + n/x) / 2`. Known since ~1600 BC. |
| **Newton for optimization** | Applying Newton to `f'(x) = 0` to find a stationary point of `f`. Uses `f''` and finds minima/maxima. |
| **Fixed-point iteration** | Reframing `f(x) = 0` as `x = g(x)` and iterating `x_{n+1} = g(x_n)`. Newton is a fixed-point iteration with `g(x) = x − f(x)/f'(x)`. |

---

<a name="core-concepts"></a>
## 4. Core Concepts — Tangent Line, Linearization, Iteration

### 4.1 The geometric idea

Pick any point `x_n` on the x-axis. Go up to the curve to get `(x_n, f(x_n))`. Now draw the **tangent line** at that point — the line that just kisses the curve and has the same slope `f'(x_n)`. That tangent line is the **best linear approximation** to `f` near `x_n`.

Now ask: where does that tangent line cross the x-axis? Solve:

```
0 = f(x_n) + f'(x_n) · (x_{n+1} − x_n)
```

Rearrange:

```
x_{n+1} = x_n − f(x_n) / f'(x_n)
```

That x-intercept is `x_{n+1}`. Set it as your next guess. The picture: you slide down the tangent line from your guess until you hit the axis. Geometrically intuitive, algebraically trivial.

### 4.2 Why it works fast — Taylor expansion

Taylor expand `f` around the actual root `r`:

```
f(x_n) = f(r) + f'(r)·(x_n − r) + ½·f''(ξ)·(x_n − r)²
```

Since `f(r) = 0`:

```
f(x_n) = f'(r)·(x_n − r) + ½·f''(ξ)·(x_n − r)²
```

Let `e_n = x_n − r` (the error). Newton's update gives:

```
e_{n+1} = e_n − f(x_n)/f'(x_n)
        = e_n − [f'(r)·e_n + ½·f''(ξ)·e_n²] / f'(x_n)
```

If `f'(x_n) ≈ f'(r)` (true near the root), the leading terms cancel:

```
e_{n+1} ≈ −½·f''(r)/f'(r) · e_n²
```

The error of the next iterate is **proportional to the square of the previous error**. If your current error is `10⁻⁴`, the next is roughly `10⁻⁸`. The one after that is `10⁻¹⁶` — below the precision of `double`. **Quadratic convergence**.

This is the magic. Bisection halves the error each step (linear). Newton squares it (quadratic). Once you're close, you cross 16-digit `double` precision in 4 steps because `0.01 → 10⁻⁴ → 10⁻⁸ → 10⁻¹⁶`.

### 4.3 The three "states" of a Newton iteration

| State | Description | What happens |
|---|---|---|
| **Far from root** | `\|x_n − r\|` is large; tangent line is a bad approximation | Convergence is slow or erratic; possibly diverges |
| **In the basin** | `x_n` is "close enough"; quadratic convergence kicks in | Each step squares the error; 4–5 steps to full precision |
| **Converged** | `\|Δx\| < eps` or `\|f(x_n)\| < eps` | Stop. Return `x_n`. |

The "in the basin" phase is the productive part. The "far from root" phase is dangerous. Practical implementations use **safeguards** (bisection fallback, damping, bracket maintenance) to escape the far-from-root regime safely.

### 4.4 Stopping criteria

You cannot wait for `f(x_n) == 0` exactly — floating-point rarely reaches it. Three common criteria, used alone or combined:

1. **Step tolerance**: `|x_{n+1} − x_n| < eps_x` — successive iterates barely change.
2. **Residual tolerance**: `|f(x_n)| < eps_f` — function value is essentially zero.
3. **Iteration cap**: `n < N_max` — never loop forever.

The robust pattern is to combine all three:

```
for i in range(N_max):
    x_next = x - f(x) / fprime(x)
    if abs(x_next - x) < eps_x or abs(f(x_next)) < eps_f:
        return x_next
    x = x_next
raise NoConvergence
```

The iteration cap is your insurance against divergence — never write a Newton loop without it.

---

<a name="big-o-summary"></a>
## 5. Big-O Summary

| Aspect | Complexity |
|---|---|
| **Iterations to `eps` precision** | `O(log log(1/eps))` once in the basin of attraction |
| **Iterations for `double` (1e-16)** | ~4–6 from a decent seed |
| **Cost per iteration** | One `f(x)` evaluation + one `f'(x)` evaluation + 1 division |
| **Total work** | `O((f + f') · log log(1/eps))` |
| **Convergence order** | **Quadratic** at a simple root; linear at a multiple root |
| **Space** | O(1) — a handful of scalars |
| **Requires derivative** | YES — or a finite-difference approximation |
| **Convergence guaranteed?** | NO — only locally; bad seed → divergence |

Compare with bisection: `O(log(1/eps))` iterations, **guaranteed** convergence given a bracket. Newton is **exponentially faster** (log log vs log) but **not guaranteed** without safeguards.

For `eps = 10⁻¹⁶` (`double` precision):
- Bisection: ~53 iterations
- Newton: 4–6 iterations from a good seed

For `eps = 10⁻³²` (`long double` or arbitrary precision):
- Bisection: ~106 iterations
- Newton: 5–7 iterations

The `log log` term grows so slowly that you essentially get arbitrary precision "for free" once you're in the basin.

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 Skiing down a slope toward a valley

You stand on a mountainside; the valley floor is at `y = 0`. You don't know where the bottom is, but you can feel the slope under your skis. You take a step **straight down the gradient** as far as the tangent line predicts the bottom is. You overshoot or undershoot, look at the new slope, ski again. Within a few moves you're at the bottom. Newton's method is "ski down the tangent".

### 6.2 The Babylonians and square roots (1600 BC)

To compute `√2`, the Babylonians used: "guess a value `x`, then take the average of `x` and `2/x`". This is exactly Newton applied to `f(x) = x² − 2`. The algorithm is **3600 years older than calculus**, but the formula is identical. We derive it explicitly in §10.

### 6.3 Goldschmidt division in CPU microcode

Modern x86 (since Pentium 4) and ARM chips do **not** have a hardware divider in the floating-point unit. Instead, `1/n` is computed by Newton's method on `f(x) = 1/x − n`, which becomes the iteration `x' = x·(2 − n·x)` — only multiplications, no division. Two iterations give `float` precision; three give `double`. This is called **Goldschmidt division**.

### 6.4 The Quake III fast inverse square root

The most famous piece of game-engine code ever written. To normalize a 3D vector (every lighting / physics operation), you need `1/√x`. John Carmack's engine team computed it with one bit-cast trick and **one Newton step**:

```c
float Q_rsqrt(float n) {
    long  i = *(long*)&n;
    i = 0x5f3759df - (i >> 1);    // bit-level magic
    float y = *(float*)&i;
    y = y * (1.5f - (n*0.5f * y*y));   // one Newton iteration
    return y;
}
```

The bit-cast produces a startlingly good seed (~3 correct bits). The Newton step refines it to ~6 correct bits — accurate enough for lighting at 60 FPS in 1999. We dissect this in detail in `senior.md`.

### 6.5 Training a logistic regression model

Logistic regression is fit by **maximizing log-likelihood**, which is a smooth concave function. The standard solver is **IRLS** (iteratively reweighted least squares) — which is Newton's method applied to the gradient. Why does it train so fast? Because of quadratic convergence: 5–10 iterations vs. thousands for plain gradient descent. R's `glm()`, scikit-learn's `LogisticRegression(solver='newton-cg')`, and statsmodels all use Newton variants.

---

<a name="pros-and-cons"></a>
## 7. Pros and Cons

### Pros
- **Quadratic convergence.** Error squares each step. 4–6 iterations to `double` precision.
- **Exponentially faster than bisection** once in the basin.
- **Simple to implement.** One arithmetic update rule.
- **Tiny memory footprint.** A few scalars; no working buffer.
- **Generalizes to higher dimensions.** Newton's method on systems uses the Jacobian. Newton for optimization uses the Hessian.
- **Foundation for many algorithms.** Goldschmidt division, IRLS, interior-point methods, BFGS quasi-Newton, etc.

### Cons
- **No global convergence guarantee.** Bad seed → divergence, oscillation, or convergence to the wrong root.
- **Requires the derivative.** If `f'` is unknown, you fall back to secant or finite differences.
- **Fails at zero derivatives.** Division by `f'(x_n) ≈ 0` blows up. Local extrema near a root are kryptonite.
- **Degrades at multiple roots.** Convergence becomes linear (one bit per step) at `f(r) = f'(r) = 0`.
- **Sensitive to numerical noise in `f'`.** If you estimate `f'` by finite differences, cancellation error can ruin the iteration near the root.
- **Can converge to the "wrong" root.** Many roots → the basin you land in depends on the seed. Pathologically, basins form fractal patterns (Newton's fractals).
- **Needs safeguards in production.** Real code combines Newton with bisection or trust-region methods (Brent, MINPACK).

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough

Compute `√612` starting from `x_0 = 10`.

We are solving `f(x) = x² − 612 = 0`. The derivative is `f'(x) = 2x`. The Newton update simplifies:

```
x' = x − (x² − 612) / (2x) = (x + 612/x) / 2
```

(That's the Babylonian formula — derived from Newton in one line.)

| Iteration | `x_n` | `x_n²` | `x_n² − 612` | `x_{n+1} = (x_n + 612/x_n) / 2` | Correct digits |
|---|---|---|---|---|---|
| 0 | 10.000000000000000 | 100 | −512 | (10 + 61.2) / 2 = 35.600000 | 0 |
| 1 | 35.600000000000000 | 1267.36 | 655.36 | (35.6 + 17.1910...) / 2 = 26.395506 | 1 |
| 2 | 26.395505617977528 | 696.722... | 84.722... | (26.395... + 23.185...) / 2 = 24.790419 | 2 |
| 3 | 24.790419267015484 | 614.6649... | 2.6649... | 24.738894 | 3 |
| 4 | 24.738894005847953 | 612.013... | 0.0134... | 24.738633764 | 5 |
| 5 | 24.738633753705965 | 612.000000000345... | 3.4e-10 | 24.738633753705965 | 15 |
| 6 | 24.738633753705965 | 612.0 (within double) | 0 | converged | 16 |

After **6 iterations from a terrible seed** (`10` vs the true `24.738...`), we have full `double` precision. Notice how the "correct digits" column doubles between iterations 3–5 — that's quadratic convergence kicking in.

Bisection on `[1, 612]` for the same precision would take ~50 iterations. Newton finishes in 6.

---

Now a **bad seed**. Solve `f(x) = x³ − 2x + 2 = 0`, with `x_0 = 0`. The derivative is `f'(x) = 3x² − 2`.

```
Iter 0: x = 0,  f = 2,    f' = -2,  next = 0 − 2/(−2) = 1
Iter 1: x = 1,  f = 1,    f' = 1,   next = 1 − 1/1   = 0
Iter 2: x = 0,  f = 2,    f' = −2,  next = 1
Iter 3: x = 1   ...
```

It **oscillates between 0 and 1 forever**. Neither value is a root (the actual root is near `−1.7693`). This is one of the textbook failure modes — and a powerful demonstration that Newton needs safeguards. We address this in §11 and §15.

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

### 9.1 Classic Newton's method — generic

**Go:**
```go
package newton

import (
    "errors"
    "math"
)

// Newton returns a root of f near x0 using Newton's method.
// f and fprime must be evaluable at every iterate.
func Newton(f, fprime func(float64) float64, x0 float64,
            eps float64, maxIter int) (float64, error) {
    x := x0
    for i := 0; i < maxIter; i++ {
        fx := f(x)
        dfx := fprime(x)
        if dfx == 0 {
            return x, errors.New("derivative is zero; cannot proceed")
        }
        xNext := x - fx/dfx
        if math.Abs(xNext-x) < eps {
            return xNext, nil
        }
        x = xNext
    }
    return x, errors.New("did not converge within maxIter")
}
```

**Java:**
```java
import java.util.function.DoubleUnaryOperator;

public final class Newton {
    private Newton() {}

    /**
     * Returns a root of f near x0 using Newton's method.
     * Throws ArithmeticException if the derivative becomes zero,
     * or IllegalStateException if maxIter is exceeded.
     */
    public static double solve(DoubleUnaryOperator f,
                               DoubleUnaryOperator fprime,
                               double x0, double eps, int maxIter) {
        double x = x0;
        for (int i = 0; i < maxIter; i++) {
            double fx  = f.applyAsDouble(x);
            double dfx = fprime.applyAsDouble(x);
            if (dfx == 0.0)
                throw new ArithmeticException("zero derivative at x=" + x);
            double xNext = x - fx / dfx;
            if (Math.abs(xNext - x) < eps) return xNext;
            x = xNext;
        }
        throw new IllegalStateException("did not converge in " + maxIter + " iterations");
    }
}
```

**Python:**
```python
from typing import Callable

def newton(f: Callable[[float], float],
           fprime: Callable[[float], float],
           x0: float,
           eps: float = 1e-12,
           max_iter: int = 100) -> float:
    """Return a root of f near x0. Raises if derivative is zero or max_iter exceeded."""
    x = x0
    for _ in range(max_iter):
        fx, dfx = f(x), fprime(x)
        if dfx == 0.0:
            raise ZeroDivisionError(f"f'({x}) == 0; Newton cannot proceed")
        x_next = x - fx / dfx
        if abs(x_next - x) < eps:
            return x_next
        x = x_next
    raise RuntimeError(f"Newton did not converge in {max_iter} iterations")
```

### 9.2 Square root via Newton (Babylonian)

Solve `f(x) = x² − n = 0`. The update simplifies dramatically:

```
x' = x − (x² − n)/(2x) = (x + n/x) / 2
```

**Go:**
```go
func Sqrt(n float64) float64 {
    if n < 0 {
        return math.NaN()
    }
    if n == 0 {
        return 0
    }
    x := n // crude seed; converges anyway
    for i := 0; i < 50; i++ {
        next := 0.5 * (x + n/x)
        if math.Abs(next-x) < 1e-15*math.Abs(next) {
            return next
        }
        x = next
    }
    return x
}
```

**Java:**
```java
public static double sqrt(double n) {
    if (n < 0) return Double.NaN;
    if (n == 0) return 0;
    double x = n;
    for (int i = 0; i < 50; i++) {
        double next = 0.5 * (x + n / x);
        if (Math.abs(next - x) < 1e-15 * Math.abs(next)) return next;
        x = next;
    }
    return x;
}
```

**Python:**
```python
def sqrt(n: float) -> float:
    if n < 0: return float('nan')
    if n == 0: return 0.0
    x = n
    for _ in range(50):
        nxt = 0.5 * (x + n / x)
        if abs(nxt - x) < 1e-15 * abs(nxt):
            return nxt
        x = nxt
    return x
```

A relative-error stopping criterion (`|Δx| < eps · |x|`) is essential for floats: an absolute `1e-15` tolerance is meaningless when computing `√10²⁰`.

### 9.3 Integer square root via Newton

```
x' = (x + n/x) / 2     with integer arithmetic
```

Stop when the iterate stops decreasing — a classic technique.

**Go:**
```go
// IntSqrt returns ⌊√n⌋ for n >= 0.
func IntSqrt(n int64) int64 {
    if n < 0 {
        panic("negative input")
    }
    if n < 2 {
        return n
    }
    x := n
    for {
        next := (x + n/x) / 2
        if next >= x {
            return x
        }
        x = next
    }
}
```

**Java:**
```java
public static long isqrt(long n) {
    if (n < 0) throw new IllegalArgumentException();
    if (n < 2) return n;
    long x = n;
    while (true) {
        long next = (x + n / x) >>> 1;
        if (next >= x) return x;
        x = next;
    }
}
```

**Python:**
```python
def isqrt(n: int) -> int:
    if n < 0: raise ValueError
    if n < 2: return n
    x = n
    while True:
        nxt = (x + n // x) // 2
        if nxt >= x: return x
        x = nxt
```

> **Note:** Python 3.8+ ships `math.isqrt(n)` which uses essentially this algorithm, optimized for arbitrary-precision integers.

### 9.4 Newton's method for `cos(x) = x`

Solve `f(x) = cos(x) − x = 0`. Derivative: `f'(x) = −sin(x) − 1`. Famous fixed point: `x ≈ 0.7390851332151607`.

**Python:**
```python
import math
def solve_cos_eq_x(x0: float = 0.5) -> float:
    f      = lambda x: math.cos(x) - x
    fprime = lambda x: -math.sin(x) - 1
    return newton(f, fprime, x0)
```

**Go:**
```go
func SolveCosEqX(x0 float64) float64 {
    f      := func(x float64) float64 { return math.Cos(x) - x }
    fprime := func(x float64) float64 { return -math.Sin(x) - 1 }
    r, _ := Newton(f, fprime, x0, 1e-15, 50)
    return r
}
```

**Java:**
```java
public static double solveCosEqX(double x0) {
    return Newton.solve(
        x -> Math.cos(x) - x,
        x -> -Math.sin(x) - 1,
        x0, 1e-15, 50);
}
```

Try `x0 = 0`; you'll get the answer in 4 iterations.

---

<a name="patterns"></a>
## 10. Coding Patterns — Babylonian sqrt and Fast Inverse sqrt

### 10.1 Babylonian / Heron's method for sqrt

Apply Newton to `f(x) = x² − n`:

```
x_{n+1} = x_n − (x_n² − n) / (2·x_n)
        = (2·x_n² − x_n² + n) / (2·x_n)
        = (x_n² + n) / (2·x_n)
        = (x_n + n/x_n) / 2
```

That last form — "average of `x` and `n/x`" — has been known since at least 1600 BC (Babylonian clay tablets, then Heron of Alexandria around 50 AD). It's Newton 3500 years before Newton.

**Why it works geometrically.** If `x > √n`, then `n/x < √n`. The true root is between them, and the average is closer than either. If `x < √n`, then `n/x > √n`, and again the average is closer.

**Why it converges fast.** The error satisfies `e_{n+1} = e_n² / (2·x_{n+1})`. For `x_{n+1} ≈ √n` and any seed within an order of magnitude, the error squares each step.

### 10.2 Reciprocal `1/n` without using division

The hardware divider is large, slow, and uncommon on GPUs and DSPs. To compute `1/n` using only multiplication, apply Newton to `f(x) = 1/x − n`. Derivative: `f'(x) = −1/x²`. Update:

```
x' = x − (1/x − n) / (−1/x²)
   = x + x²·(1/x − n)
   = x + x − n·x²
   = x·(2 − n·x)
```

**No division.** Just two multiplies and one subtract. Two iterations from a 8-bit lookup-table seed give `float` precision; three iterations give `double`. This is **Goldschmidt division** and is how every modern AMD / Intel / ARM FPU implements `/`.

**Go:**
```go
func Reciprocal(n, x0 float64) float64 {
    x := x0
    for i := 0; i < 8; i++ {
        x = x * (2 - n*x)
    }
    return x
}
```

`x0` must be a reasonable approximation; production implementations use a lookup table on the high bits of `n`.

### 10.3 Fast inverse square root — the magic constant

To normalize a 3D vector you need `1/√x`. Solve `f(y) = 1/y² − x = 0`. Derivative: `f'(y) = −2/y³`. Update:

```
y' = y − (1/y² − x)/(−2/y³)
   = y + (y³)·(1/y² − x) / 2
   = y + (y − x·y³) / 2
   = (3y − x·y³) / 2
   = y · (3 − x·y²) / 2
   = y · (1.5 − 0.5·x·y²)
```

Two multiplies, one subtract, one half. Iteration count: 1 gives ~6 correct bits, 2 gives ~14, 3 gives full `float`.

**The seed.** The Quake III trick produces a great seed using bit-level interpretation of IEEE 754 floats:

```c
float Q_rsqrt(float number) {
    long  i;
    float x2, y;
    const float threehalfs = 1.5F;

    x2 = number * 0.5F;
    y  = number;
    i  = *(long *) &y;             // evil bit-level hack
    i  = 0x5f3759df - (i >> 1);    // what the **** ?
    y  = *(float *) &i;
    y  = y * (threehalfs - (x2 * y * y));   // 1st Newton iteration
    // y = y * (threehalfs - (x2 * y * y));  // 2nd iteration (omitted, accuracy not needed)

    return y;
}
```

The bit trick exploits the IEEE 754 layout: shifting the exponent by 1 approximates dividing the exponent by 2, which is what `√` does to the exponent. The magic constant `0x5f3759df` corrects the resulting mantissa. The constant was later proven to be slightly sub-optimal — `0x5f375a86` is better — but Carmack's value has become folklore.

We dissect the bit math in `senior.md`. The takeaway here: Newton's method **doesn't need a great seed**. One iteration salvaged a crude bit-shift estimate into a 6-bit-accurate result, which was enough for 1999 lighting at 60 FPS.

---

<a name="errors"></a>
## 11. Error Handling — Zero Derivative and Divergence

Newton's method has **three classic failure modes**. Production code must detect and handle each.

### 11.1 Zero (or near-zero) derivative

If `f'(x_n) = 0`, the formula divides by zero. Geometrically, the tangent is horizontal and never crosses the x-axis. Example: `f(x) = x² − 4` at `x = 0` — derivative is `0`, no update possible.

**Mitigation:**
- Check `|f'(x)| < threshold` before dividing.
- Bump `x` by a small perturbation and retry.
- Fall back to bisection on a known bracket.

```python
if abs(dfx) < 1e-300:
    return bisect(f, a, b, eps)   # safe fallback
```

### 11.2 Oscillation (cycle)

`f(x) = x³ − 2x + 2` with `x_0 = 0` oscillates `0 → 1 → 0 → 1 → ...` forever (we showed this in §8). The iteration is technically defined, doesn't diverge to infinity, but never converges.

**Mitigation:**
- Iteration cap — always.
- Detect oscillation by tracking the last two iterates: if `|x_n − x_{n−2}| < tiny` and `|x_n − x_{n−1}| > tiny`, you're cycling.
- Fall back to bisection or damp the step (`α < 1`).

### 11.3 Divergence to infinity

When `|f'(x)|` is small near `x_n` but `|f(x)|` is large, the next step takes a huge leap. The iterates wander away from the root. Example: `f(x) = arctan(x)` from `x_0 = 2` — the tangent slope shrinks faster than the function value, and the iterates blow up.

**Mitigation:**
- Iteration cap.
- Detect `|x_{n+1}| > 10·|x_n|` and step-shrink (`x_{n+1} = (x_n + x_{n+1})/2`).
- Maintain a bracket `[a, b]` with `f(a)·f(b) < 0` (sign change) and project Newton steps that escape the bracket back to the bisection midpoint. This is **the** production trick — see Brent's method.

### Other error cases

| Error | Cause | Mitigation |
|---|---|---|
| `NaN` in output | `f(x)` returned `NaN` (e.g., `sqrt` of negative) | Validate input range; clamp `x_{n+1}` into `f`'s domain |
| Infinity | Numerical overflow in `f(x)` or `f'(x)` | Use scaled arithmetic; rescale problem so `\|x\| ~ O(1)` |
| Converges to wrong root | Multi-root function, bad seed | Use domain knowledge to pick `x_0`; bracket the desired root |
| Linear convergence (slow) | Multiple root, `f(r) = f'(r) = 0` | Use modified Newton: `x' = x − m · f(x)/f'(x)` where `m` is the multiplicity |
| Iteration cap hit | Divergence or pathologically slow | Log the case, fall back to bisection, return best estimate so far |

### A safe production wrapper

```python
def safe_newton(f, fprime, x0, a, b, eps=1e-12, max_iter=100):
    """Newton with bracket-maintaining fallback to bisection."""
    fa, fb = f(a), f(b)
    if fa * fb > 0:
        raise ValueError("bracket [a,b] must have sign change")
    x = x0
    for _ in range(max_iter):
        fx = f(x)
        if abs(fx) < eps:
            return x
        dfx = fprime(x)
        if dfx == 0 or x < a or x > b:
            x = 0.5 * (a + b)        # bisect midpoint
        else:
            x_newton = x - fx / dfx
            if x_newton < a or x_newton > b:
                x_newton = 0.5 * (a + b)   # fallback when Newton escapes
            x = x_newton
        # maintain bracket
        if f(x) * fa < 0: b = x
        else:             a = x; fa = f(x)
    return x
```

This is the spirit of Brent's method: trust Newton when it stays inside the bracket and looks productive; bisect when it doesn't.

---

<a name="performance-tips"></a>
## 12. Performance Tips

1. **Choose seeds smartly.** A few cycles spent computing a good `x_0` (lookup table, bit trick, low-order polynomial) saves dozens of iterations and dwarfs Newton's runtime in tight loops.

2. **Simplify the update algebraically.** As we saw with sqrt and reciprocal, simplifying `x − f(x)/f'(x)` per problem yields fewer operations and no division. Always simplify by hand.

3. **Cache `f(x)` and `f'(x)`.** Some problems share work — e.g., computing `cos(x)` you'd want `sin(x)` too. Compute both in one call.

4. **Stop early on residual.** If `|f(x_n)| < eps` you're done; don't wait for the step-size criterion.

5. **Use relative tolerance for floats.** `|Δx| < eps · |x|` instead of absolute — scale-invariant.

6. **Vectorize when many roots.** If you need to find roots of many similar problems (Jacobian over a mesh), batch them and exploit SIMD or GPU.

7. **Avoid `pow`.** `pow(x, 2)` is much slower than `x*x`. Newton's updates often involve small integer powers — inline them.

8. **In `float` precision, 1–2 iterations suffice.** Don't iterate to `double` precision if you only need `float` — you're wasting cycles.

9. **For very high precision (200 digits)**, use `mpmath` / `BigDecimal`; Newton's quadratic convergence keeps iteration count low even at thousands of digits.

10. **In CPU microcode for division**, Goldschmidt-style Newton on `1/x` runs in 2–3 cycles total. The seed comes from a small ROM lookup; the iteration is hardwired in silicon.

---

<a name="best-practices"></a>
## 13. Best Practices

- **Always have an iteration cap.** Never write `while True`. Pick something generous (50–200) and log when it's exceeded.
- **Use combined stopping criteria.** Step tolerance, residual tolerance, and iteration cap together.
- **Validate inputs.** `sqrt(negative)`, `log(0)`, `1/0` — handle before iterating.
- **Document the seed assumption.** Comment what range of `x_0` is required for convergence.
- **Prefer well-conditioned formulations.** `f(x) = x² − a` is well-conditioned; `f(x) = a − x²` is the same problem but numerically equivalent. `f(x) = log(x) − a` may differ in conditioning from `f(x) = exp(a)/x − 1`.
- **For production, use Brent's method** (`scipy.optimize.brentq`, GSL's `gsl_root_fsolver_brent`). It is the safe Newton.
- **In tests, verify quadratic convergence.** Plot `log(|e_{n+1}|)` vs `log(|e_n|)`; the slope should be 2 once in the basin. Anything else is a bug or a multiple root.
- **Don't use Newton on noisy `f`.** Measurement noise in `f` couples into Newton steps with amplification `1/|f'|`. Use trust-region methods or Levenberg–Marquardt.
- **When `f'` is expensive but `f` is cheap, use the secant method.** No derivative needed; convergence order 1.618.
- **Use `math.fma` (fused multiply-add)** when available — both more accurate and faster.

---

<a name="edge-cases"></a>
## 14. Edge Cases

| Case | Input | What happens |
|---|---|---|
| Negative input to `sqrt` | `n = −4` | Return `NaN` or raise — `f(x) = x² + 4` has no real root |
| Zero input to `sqrt` | `n = 0` | Return 0 directly; avoid division by `2x = 0` |
| Huge input to `sqrt` | `n = 1e300` | Use scientific seed `x = 10^150`; avoid overflow in `x²` |
| Seed at a root | `x_0 = r` | First iteration: `f(r)/f'(r) = 0/f'(r) = 0`, returns `r` |
| Seed at local extremum | `x_0` where `f'(x_0) = 0` | Division by zero; perturb and retry |
| Multiple root | `f(x) = (x − 1)²` at `x = 1` | Linear convergence — error halves, not squares |
| Function flat near root | `f(x) ≈ ε near r` | Numerical noise dominates; precision limited |
| Newton diverges then re-enters basin | Wide oscillation | Detect via bracket; fall back to bisection |
| Roots clustered | `f(x) = (x − 1)(x − 1.000001)` | Quadratic convergence to one, but tiny basin — bracket carefully |
| Iteration count exceeded | Bad seed | Log; return best estimate or raise |
| `f(x_n) = ±∞` | Overflow in evaluation | Rescale problem |
| Complex roots needed | `f(x) = x² + 1` over reals | Use complex Newton (`x_0` complex) |

---

<a name="common-mistakes"></a>
## 15. Common Mistakes

1. **Forgetting the iteration cap.** Diverging Newton loops are silent infinite loops in production.
2. **Absolute-only stopping tolerance.** `|Δx| < 1e-10` is meaningless when `x ~ 10¹⁰`. Use relative.
3. **Not handling zero derivative.** A single `f'(x_n) = 0` crashes the iteration.
4. **Wrong derivative.** Hand-computed derivatives are bug-prone. Verify with finite differences:
   `|f'(x) − (f(x+h) − f(x−h))/(2h)| should be tiny.`
5. **Starting too far from the root.** Especially for high-degree polynomials, far-away seeds converge to surprising roots or diverge.
6. **Confusing "Newton for root-finding" with "Newton for optimization".** The latter finds a stationary point of `g` by applying root-finding to `g'`; the iteration is `x' = x − g'(x)/g''(x)`.
7. **Trusting Newton at multiple roots.** Convergence drops to linear; if you don't know the multiplicity you can think the algorithm is broken when it's "just" slow.
8. **Using `(lo + hi)/2` style midpoints** — that's bisection. Newton has no `lo`/`hi`; it has only `x`.
9. **Not testing on a known root.** Always validate with a problem where you know the answer (e.g., `sqrt(2)` to many digits).
10. **Using Newton on a non-differentiable function.** `|x|` at `x = 0`, step functions, discrete-valued functions — Newton is undefined.

---

<a name="cheat-sheet"></a>
## 16. Cheat Sheet

```
SETUP
    x       = x0                       initial seed
    eps     = 1e-12                    convergence tolerance
    N_max   = 100                      iteration cap

LOOP
    for i in 0..N_max:
        fx  = f(x)
        dfx = f'(x)
        if |dfx| < tiny:               return error or fallback
        x_next = x - fx / dfx
        if |x_next - x| < eps * (|x| + 1):
            return x_next
        x = x_next
    return error: did not converge

UPDATE FORMULA
    x_{n+1} = x_n - f(x_n) / f'(x_n)

CONVERGENCE
    Order: 2 (quadratic) at a simple root
    Iterations to double precision (eps=1e-16):  4-6 from good seed
    Iterations on bisection for same precision:  ~53

KEY SPECIAL CASES
    sqrt(n):       x' = (x + n/x) / 2            (Babylonian)
    1/n  :         x' = x * (2 - n*x)            (Goldschmidt)
    1/sqrt(n):     x' = x * (1.5 - 0.5*n*x*x)   (Quake rsqrt)
    k-th root:     x' = ((k-1)*x + n/x^(k-1)) / k

FAILURE MODES
    f'(x) = 0          → blow up; fall back to bisection
    Bad seed           → oscillation / divergence; bracket + bisect
    Multiple root      → linear convergence; modified Newton

SAFE PRODUCTION RULE
    Combine Newton with bisection (Brent's method).
```

---

<a name="animation"></a>
## 17. Visual Animation Reference

See `animation.html` in this folder. It plots a curve `f(x)`, lets you pick a starting `x_0` by clicking, then animates the Newton iteration: at each step it draws the tangent line at the current `x_n` and shows where that tangent crosses the x-axis to give `x_{n+1}`. A speed slider, function-picker dropdown, and reset button let you experiment. The stats panel shows iteration count, residual `|f(x_n)|`, step size `|x_{n+1} − x_n|`, and a numerical estimate of convergence order.

Run it on a "good seed" for `f(x) = x² − 2`: you'll see quadratic convergence visually — each step the cell distance to the root squares. Run it on the bad seed `x_0 = 0` for `f(x) = x³ − 2x + 2`: you'll see the iterates ping-pong between 0 and 1 forever. The visual is far more convincing than any equation.

---

<a name="summary"></a>
## 18. Summary

- Newton's method finds a root of a differentiable `f` by iterating `x_{n+1} = x_n − f(x_n)/f'(x_n)` — slide down the tangent line to its x-intercept, repeat.
- **Quadratic convergence** at a simple root: the number of correct digits roughly doubles per step. 4–6 iterations give full `double` precision once you're in the basin of attraction.
- The Babylonian formula `(x + n/x)/2` for `sqrt(n)` is Newton on `f(x) = x² − n` — discovered 3500 years before calculus.
- Modern CPUs compute `1/n` via Newton (`x' = x(2 − n·x)`), avoiding a hardware divider — the **Goldschmidt** algorithm.
- The Quake III fast inverse square root with the magic `0x5f3759df` constant uses bit-level IEEE 754 hacking for a good seed, then **one Newton iteration** to refine.
- Failure modes: zero derivative, oscillation, divergence, wrong root. Always combine Newton with safeguards (bracket maintenance, bisection fallback) in production — this is what **Brent's method** does and what every numerical library ships.
- Stopping criteria: step tolerance, residual tolerance, and an iteration cap, used together.

Master this algorithm and you will see it everywhere — in `Math.sqrt`, in IRLS-fitted logistic regression, in interior-point linear programming, in trust-region nonlinear solvers, in robotics inverse kinematics, in every game engine's vector normalization, and in the iterative loops at the heart of every JPEG decoder, every audio codec, and every neural-net second-order optimizer. It is the workhorse of numerical computing.

---

<a name="further-reading"></a>
## 19. Further Reading

- **Kahan**, "A Logarithm Too Clever by Half" — Kahan's notes on conditioning and Newton's pitfalls. Required reading for floating-point work.
- **Press, Teukolsky, Vetterling, Flannery**, *Numerical Recipes*, 3rd ed., Chapter 9 ("Root Finding and Nonlinear Sets of Equations"). The practitioner's reference. `rtsafe` and `rtflsp` listings.
- **Burden & Faires**, *Numerical Analysis*, 10th ed., Chapter 2. The textbook proof of quadratic convergence.
- **Goldberg**, "What Every Computer Scientist Should Know About Floating-Point Arithmetic" (1991). The float background you need to understand Newton's precision behaviour.
- **Brent**, *Algorithms for Minimization Without Derivatives* (1973). Brent's method — the safe Newton.
- **Lomont**, "Fast Inverse Square Root" (2003). The definitive analysis of the Quake III code, including the optimal magic constant.
- **Knuth**, *TAOCP* Volume 2, Section 4.3.3 — Newton's method on arbitrary-precision integers.
- Continue with `middle.md` for damped Newton, secant method, Newton for optimization, and the comparison with bisection.
