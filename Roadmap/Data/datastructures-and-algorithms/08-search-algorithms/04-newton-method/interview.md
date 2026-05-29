# Newton's Method — Interview Questions & Coding Challenges

> **Audience:** Anyone preparing for a software engineering interview at companies that ask numerical-methods or systems-programming questions. Includes conceptual questions across levels and 7 coding challenges with full Go / Java / Python solutions.

---

## Section A — Conceptual Questions

### Junior level

**Q1. What problem does Newton's method solve?**
Find a root `r` of a differentiable function `f`, i.e., a value with `f(r) = 0`. It's an iterative method that starts from a seed `x_0` and refines it.

**Q2. What's the update rule?**
`x_{n+1} = x_n − f(x_n) / f'(x_n)`. Geometrically: slide down the tangent line at `x_n` until you hit the x-axis; that's `x_{n+1}`.

**Q3. Where does the formula come from?**
The tangent line at `(x_n, f(x_n))` is `y = f(x_n) + f'(x_n) · (x − x_n)`. Setting `y = 0` and solving for `x` gives the update. It's the **linearization** of `f` at `x_n`.

**Q4. What is the convergence order of Newton's method at a simple root?**
**Quadratic** — `|x_{n+1} − r| ≈ C · |x_n − r|²`. The number of correct digits roughly doubles every iteration.

**Q5. How many iterations does it take to reach `double` precision (~16 digits) from a good seed?**
**4–6 iterations**, because the error sequence is roughly `0.01 → 10⁻⁴ → 10⁻⁸ → 10⁻¹⁶`.

**Q6. What's required to apply Newton's method?**
A differentiable `f`, a way to evaluate `f(x)` and `f'(x)`, and a seed `x_0` reasonably close to a root.

**Q7. What's the Babylonian / Heron square root formula and how is it related to Newton?**
`x' = (x + n/x) / 2` for `√n`. It's Newton applied to `f(x) = x² − n`. Known since ~1600 BC, derived independently from Newton's principles ~3500 years later.

**Q8. What's a stopping criterion?**
A rule to halt the iteration. Common choices: `|x_{n+1} − x_n| < eps` (step), `|f(x_n)| < eps` (residual), and an **iteration cap** as a safety net. Production code uses all three.

### Middle level

**Q9. What is the secant method, and how is it different from Newton?**
The secant method replaces `f'(x_n)` with the finite-difference estimate `(f(x_n) − f(x_{n−1})) / (x_n − x_{n−1})`. No analytical derivative needed. Convergence order is `(1 + √5)/2 ≈ 1.618` — slower than Newton's 2, but faster than bisection's 1.

**Q10. How is bisection different from Newton on convergence and reliability?**
Bisection: linear convergence (1 bit per step), but **guaranteed** given a sign-change bracket. Newton: quadratic, but **not guaranteed** — can diverge, oscillate, or converge to the wrong root.

**Q11. When does Newton's method fail?**
Three classic modes:
- `f'(x_n) = 0` → division blow-up.
- Bad seed → divergence (e.g., `arctan(x)` from `x_0 = 2`).
- Oscillation (e.g., `f(x) = x³ − 2x + 2` from `x_0 = 0` cycles forever between 0 and 1).
- At a multiple root, convergence drops to linear.

**Q12. What's Brent's method and why is it preferred in production?**
A hybrid combining Newton (or secant / inverse quadratic interpolation) with bisection fallback. Maintains a bracket; takes a Newton step when it stays inside and looks productive, else bisects. Combines Newton's speed with bisection's reliability. Used in `scipy.optimize.brentq`, MATLAB `fzero`, GSL `gsl_root_fsolver_brent`.

**Q13. Derive the formula for computing `1/n` without using division.**
Solve `f(x) = 1/x − n = 0`. Then `f'(x) = −1/x²`, and the Newton update simplifies to `x' = x · (2 − n·x)`. Two multiplies, one subtract. This is Goldschmidt division — used in hardware FPUs since the Pentium 4.

**Q14. How does Newton's method generalize to optimization?**
Optimization wants `∇g(x) = 0` (stationary points). Apply Newton-root-finding to `∇g`. The iteration becomes `x' = x − H^{−1} · ∇g`, where `H` is the Hessian (second-derivative matrix). Convergence is quadratic near a minimum where `H` is positive-definite.

### Senior level

**Q15. Explain the Quake III fast inverse square root.**
Compute `1/√x` via:
1. Bit-cast `x` to integer.
2. Apply the magic update `i = 0x5f3759df − (i >> 1)` — a clever exponent-and-mantissa trick using IEEE 754 layout.
3. Bit-cast back to float.
4. Apply **one Newton iteration** on `f(y) = 1/y² − x`: `y = y · (1.5 − 0.5·x·y²)`.

The bit hack gives ~3 correct mantissa bits; one Newton iteration boosts to ~7. Enough for 1999 graphics.

**Q16. Why does the CPU not have a hardware divider?**
Division can be computed by Newton's method on `1/n` using only multiplications. A few Goldschmidt iterations from a small lookup-table seed produce IEEE 754 division at full hardware speed — without the silicon cost of a dedicated divider, which would be huge and rarely used.

**Q17. What's IRLS in statistics?**
**Iteratively Reweighted Least Squares**. It's Newton's method applied to the gradient of the log-likelihood in logistic regression and other GLMs. Each iteration is a weighted linear least-squares solve. Converges in 5–10 iterations vs thousands for gradient descent. Standard in R `glm()`, statsmodels, scikit-learn `LogisticRegression(solver='newton-cg')`.

**Q18. How would you detect that Newton has converged to a wrong root?**
Compute `|f(x_final)|`. If it's not tiny, you've converged to a non-root (numerical noise, multiple root, divergence stalled). Production code **always** checks the residual, not just the step size.

**Q19. What's a "Newton fractal"?**
The set of seeds in the complex plane colored by which root Newton converges to. For polynomials with ≥ 2 roots, the basin boundaries are fractal (Julia sets) — arbitrarily close points can map to different basins. Demonstrates that there's no general "globally convergent" Newton.

### Professional level

**Q20. State and explain the Kantorovich theorem.**
Given seeds `x_0` and bounds `β = |1/f'(x_0)|`, `η = |f(x_0)/f'(x_0)|`, `M = sup|f''|` near `x_0`, if `h := βηM ≤ 1/2`, then Newton converges quadratically from `x_0`. This is a **verifiable** sufficient condition — no knowledge of the root needed.

**Q21. Why is Newton "affine invariant" and why does that matter?**
A linear change of variables `y = B·x + c` transforms Newton on `f(x)` into Newton on `g(y) = A·f(B⁻¹(y − c))` with the same iteration pattern. Consequence: Newton's convergence rate is **independent of the problem's condition number**. Gradient descent doesn't have this; Newton does. That's why Newton is unbeatable on ill-conditioned smooth optimization.

**Q22. Why does Newton lose quadratic convergence at a multiple root?**
At a multiple root `r` with multiplicity `m`, `f(r) = f'(r) = … = f^{(m−1)}(r) = 0`. The leading-order Taylor terms that cancel in the simple-root analysis no longer fully cancel, and the iteration becomes linear with constant `(m−1)/m`. Use **modified Newton** `x' = x − m · f/f'` to recover quadratic convergence.

---

## Section B — Coding Challenges

### Challenge 1 — Integer Square Root (LeetCode 69)

> Given a non-negative integer `x`, return `⌊√x⌋` without using `sqrt`.

**Strategy:** Babylonian iteration — `x' = (x + n/x) / 2` — with integer arithmetic. Stop when the iterate stops decreasing.

**Go:**
```go
func mySqrt(x int) int {
    if x < 2 { return x }
    r := x
    for {
        next := (r + x/r) / 2
        if next >= r { return r }
        r = next
    }
}
```

**Java:**
```java
public int mySqrt(int x) {
    if (x < 2) return x;
    long r = x;
    while (true) {
        long next = (r + x / r) / 2;
        if (next >= r) return (int) r;
        r = next;
    }
}
```

**Python:**
```python
def mySqrt(x: int) -> int:
    if x < 2: return x
    r = x
    while True:
        nxt = (r + x // r) // 2
        if nxt >= r: return r
        r = nxt
```

**Complexity:** `O(log log x)` iterations to converge, each `O(1)` arithmetic.

---

### Challenge 2 — Real Square Root to 1e-12

> Compute `√x` for `x >= 0` accurate to `1e-12` without using `math.sqrt`.

**Go:**
```go
func sqrtReal(x float64) float64 {
    if x < 0 { return math.NaN() }
    if x == 0 { return 0 }
    r := x
    for i := 0; i < 100; i++ {
        next := 0.5 * (r + x/r)
        if math.Abs(next-r) < 1e-12*math.Abs(next) {
            return next
        }
        r = next
    }
    return r
}
```

**Java:**
```java
public double sqrtReal(double x) {
    if (x < 0) return Double.NaN;
    if (x == 0) return 0;
    double r = x;
    for (int i = 0; i < 100; i++) {
        double next = 0.5 * (r + x / r);
        if (Math.abs(next - r) < 1e-12 * Math.abs(next)) return next;
        r = next;
    }
    return r;
}
```

**Python:**
```python
def sqrt_real(x: float) -> float:
    if x < 0: return float('nan')
    if x == 0: return 0.0
    r = x
    for _ in range(100):
        nxt = 0.5 * (r + x / r)
        if abs(nxt - r) < 1e-12 * abs(nxt):
            return nxt
        r = nxt
    return r
```

**Complexity:** `O(log log(1/eps))` — 5–6 iterations in practice.

---

### Challenge 3 — Cube Root of a Real Number

> Compute `∛x` for any real `x` (including negative) to precision `1e-12`.

**Strategy:** Solve `f(y) = y³ − x = 0`. Update: `y' = (2y + x/y²) / 3`.

**Python:**
```python
def cbrt(x: float) -> float:
    if x == 0: return 0.0
    sign = 1 if x > 0 else -1
    x = abs(x)
    y = x ** (1/3)        # crude seed
    for _ in range(50):
        nxt = (2*y + x/(y*y)) / 3
        if abs(nxt - y) < 1e-15 * abs(nxt): return sign * nxt
        y = nxt
    return sign * y
```

**Go:**
```go
func cbrtNewton(x float64) float64 {
    if x == 0 { return 0 }
    sign := 1.0
    if x < 0 { sign = -1; x = -x }
    y := math.Cbrt(x)     // seed
    for i := 0; i < 50; i++ {
        next := (2*y + x/(y*y)) / 3
        if math.Abs(next-y) < 1e-15*math.Abs(next) { return sign * next }
        y = next
    }
    return sign * y
}
```

**Java:**
```java
public double cbrtNewton(double x) {
    if (x == 0) return 0;
    double sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    double y = Math.cbrt(x);
    for (int i = 0; i < 50; i++) {
        double next = (2*y + x/(y*y)) / 3;
        if (Math.abs(next - y) < 1e-15 * Math.abs(next)) return sign * next;
        y = next;
    }
    return sign * y;
}
```

**Complexity:** quadratic; ~5 iterations to `double` precision.

---

### Challenge 4 — Fixed Point: solve `cos(x) = x`

> Find the value of `x` where `cos(x) = x` (root ≈ 0.7390851332151607).

**Strategy:** Solve `f(x) = cos(x) − x = 0`. `f'(x) = −sin(x) − 1`.

**Python:**
```python
import math
def cos_eq_x(x0: float = 0.5) -> float:
    x = x0
    for _ in range(50):
        f  = math.cos(x) - x
        fp = -math.sin(x) - 1
        nxt = x - f / fp
        if abs(nxt - x) < 1e-15: return nxt
        x = nxt
    return x
```

**Go:**
```go
func cosEqX(x0 float64) float64 {
    x := x0
    for i := 0; i < 50; i++ {
        f  := math.Cos(x) - x
        fp := -math.Sin(x) - 1
        next := x - f/fp
        if math.Abs(next-x) < 1e-15 { return next }
        x = next
    }
    return x
}
```

**Java:**
```java
public double cosEqX(double x0) {
    double x = x0;
    for (int i = 0; i < 50; i++) {
        double f  = Math.cos(x) - x;
        double fp = -Math.sin(x) - 1;
        double next = x - f / fp;
        if (Math.abs(next - x) < 1e-15) return next;
        x = next;
    }
    return x;
}
```

**Complexity:** 4–5 iterations from any reasonable seed.

---

### Challenge 5 — Fast Inverse Square Root (Quake III)

> Implement `1/√x` for `float`, using the Quake III magic constant + one Newton iteration. Show the bit-level cast.

**Python (via `struct` for bit-cast):**
```python
import struct

def fast_inv_sqrt(x: float) -> float:
    x32 = struct.pack('f', x)          # 4-byte float
    i = struct.unpack('I', x32)[0]
    i = 0x5f3759df - (i >> 1)
    y = struct.unpack('f', struct.pack('I', i))[0]
    y = y * (1.5 - 0.5 * x * y * y)    # one Newton step
    return y
```

**Go:**
```go
import "math"

func fastInvSqrt(x float32) float32 {
    i := math.Float32bits(x)
    i = 0x5f3759df - (i >> 1)
    y := math.Float32frombits(i)
    y = y * (1.5 - 0.5*x*y*y)
    return y
}
```

**Java:**
```java
public float fastInvSqrt(float x) {
    int i = Float.floatToRawIntBits(x);
    i = 0x5f3759df - (i >> 1);
    float y = Float.intBitsToFloat(i);
    y = y * (1.5f - 0.5f * x * y * y);
    return y;
}
```

**Discussion:** the seed has ~3.5 correct bits; one Newton iteration boosts to ~7. Carmack's constant `0x5f3759df` was empirically slightly off — the optimum is `0x5f375a86` (Lomont, 2003).

---

### Challenge 6 — Divide Without `/`

> Compute `a / b` (positive floats) using only multiplication, addition, and subtraction. Use Newton on `1/b`.

**Strategy:** Compute `1/b` by Newton: `x' = x · (2 − b·x)`. Then `a/b = a · (1/b)`.

**Python:**
```python
def divide(a: float, b: float) -> float:
    if b <= 0: raise ValueError("b must be positive")
    # crude seed: scale b so it's near 1
    import math
    scale = 2.0 ** -math.floor(math.log2(b))
    bs    = b * scale
    x     = 1.5            # rough; bs ∈ [0.5, 1.0]
    for _ in range(30):
        x = x * (2 - bs * x)
    inv_b = x * scale      # 1/b
    return a * inv_b
```

**Go:**
```go
func divide(a, b float64) float64 {
    if b <= 0 { panic("b must be positive") }
    scale := math.Pow(2, -math.Floor(math.Log2(b)))
    bs := b * scale
    x := 1.5
    for i := 0; i < 30; i++ {
        x = x * (2 - bs*x)
    }
    return a * x * scale
}
```

**Java:**
```java
public double divide(double a, double b) {
    if (b <= 0) throw new IllegalArgumentException();
    double scale = Math.pow(2, -Math.floor(Math.log(b)/Math.log(2)));
    double bs = b * scale;
    double x = 1.5;
    for (int i = 0; i < 30; i++) {
        x = x * (2 - bs * x);
    }
    return a * x * scale;
}
```

**Discussion:** the scaling step is crucial — Newton's reciprocal converges quickly only when the input is in `[0.5, 1.0]`. The classic FPU trick is to peel off the exponent bits and operate on the mantissa only. This is **Goldschmidt division** simplified.

---

### Challenge 7 — Bracketed Newton with Bisection Fallback

> Given a bracket `[a, b]` with `f(a) · f(b) < 0`, find a root using Newton when it stays in the bracket and looks productive, else bisect.

**Python:**
```python
def safe_newton(f, fprime, a, b, eps=1e-12, max_iter=100):
    fa, fb = f(a), f(b)
    if fa == 0: return a
    if fb == 0: return b
    if fa * fb > 0:
        raise ValueError("[a, b] does not bracket a root")
    x = 0.5 * (a + b)
    for _ in range(max_iter):
        fx = f(x)
        if abs(fx) < eps: return x
        dfx = fprime(x)
        x_new = (x - fx/dfx) if dfx != 0 else None
        # accept Newton only if it stays in [a, b] AND shrinks the bracket by half
        if x_new is not None and a < x_new < b and abs(x_new - x) < 0.5 * (b - a):
            x = x_new
        else:
            x = 0.5 * (a + b)
        # update bracket so root remains inside
        if f(x) * fa < 0:
            b = x
        else:
            a, fa = x, f(x)
    return x
```

**Go:**
```go
func safeNewton(f, fp func(float64) float64, a, b, eps float64, maxIter int) float64 {
    fa, fb := f(a), f(b)
    if fa == 0 { return a }
    if fb == 0 { return b }
    if fa*fb > 0 { panic("[a, b] does not bracket a root") }
    x := 0.5 * (a + b)
    for i := 0; i < maxIter; i++ {
        fx := f(x)
        if math.Abs(fx) < eps { return x }
        var xNew float64
        used := false
        if dfx := fp(x); dfx != 0 {
            cand := x - fx/dfx
            if cand > a && cand < b && math.Abs(cand-x) < 0.5*(b-a) {
                xNew = cand
                used = true
            }
        }
        if !used { xNew = 0.5 * (a + b) }
        x = xNew
        if f(x)*fa < 0 { b = x } else { a = x; fa = f(x) }
    }
    return x
}
```

**Java:**
```java
public double safeNewton(DoubleUnaryOperator f, DoubleUnaryOperator fp,
                         double a, double b, double eps, int maxIter) {
    double fa = f.applyAsDouble(a), fb = f.applyAsDouble(b);
    if (fa == 0) return a;
    if (fb == 0) return b;
    if (fa * fb > 0) throw new IllegalArgumentException("no bracket");
    double x = 0.5 * (a + b);
    for (int i = 0; i < maxIter; i++) {
        double fx = f.applyAsDouble(x);
        if (Math.abs(fx) < eps) return x;
        double dfx = fp.applyAsDouble(x);
        boolean used = false;
        double xNew = 0;
        if (dfx != 0) {
            double cand = x - fx / dfx;
            if (cand > a && cand < b && Math.abs(cand - x) < 0.5 * (b - a)) {
                xNew = cand; used = true;
            }
        }
        if (!used) xNew = 0.5 * (a + b);
        x = xNew;
        if (f.applyAsDouble(x) * fa < 0) b = x;
        else { a = x; fa = f.applyAsDouble(x); }
    }
    return x;
}
```

**Discussion:** this is the bones of Brent's method (full Brent adds inverse quadratic interpolation). The key invariant: the bracket `[a, b]` always contains a root, so the worst case is bisection. The Newton speedup kicks in whenever the iterate stays in the bracket.

---

## Section C — Common Interview Pitfalls

### Pitfall 1 — Not handling zero derivative
A single `f'(x_n) = 0` crashes the iteration. Production code checks `|dfx| < threshold` and falls back to bisection.

### Pitfall 2 — Forgetting the iteration cap
`while True:` with a diverging Newton is an infinite loop. **Always** cap iterations.

### Pitfall 3 — Absolute vs relative tolerance
`|Δx| < 1e-12` is meaningless when `x ~ 1e20`. Use **relative** tolerance: `|Δx| < eps · (|x| + tiny)`.

### Pitfall 4 — Confusing root-finding Newton with optimization Newton
Root-finding: solve `f = 0`. Optimization: solve `f' = 0`, which uses **`f''`** in the update. They're related but different — and interviewers love this distinction.

### Pitfall 5 — Trusting Newton on a multiple root
A double root makes Newton converge **linearly** (one bit per step, not doubling). If your iteration is slow, suspect a multiple root.

### Pitfall 6 — Using bisection's loop structure for Newton
Newton has no `lo`/`hi`. It has one variable `x` and updates in place. Mixing the patterns produces buggy code.

### Pitfall 7 — Float comparison `x_new == x_old`
Floating-point rarely settles to exact equality. Use `|x_new − x_old| < eps`.

### Pitfall 8 — Bad seed for vector normalization
For Quake's `1/√x`, if you don't scale the input to `[1, 4]` first, the bit trick's constant `0x5f3759df` is wrong. The trick depends on `x ~ O(1)`.

### Pitfall 9 — Not testing the residual
After convergence by step size, **test `|f(x_final)|`**. If it's not tiny, you converged to a non-root (numerical noise drowning out the gradient).

### Pitfall 10 — Using `pow(x, 2)` instead of `x*x`
`pow` is much slower and (on some libc) less accurate. Inline small powers.

---

## Section D — Mock Interview Drill (15 minutes)

A typical 45-minute numerical-methods interview will combine:

1. **Warmup** (5 min): "Implement integer square root using Newton."
2. **Medium variation** (15 min): "Compute `1/n` without using division" or "Compute `cube_root(x)` to 1e-12".
3. **Harder twist** (15 min): "Implement the Quake III fast inverse square root and explain why one Newton step suffices" or "Write Newton with bisection fallback".
4. **Discussion** (10 min): convergence order, failure modes, why CPUs use Newton for division, when to use bisection / secant / Brent instead.

**Drill questions to practice aloud:**
- *"Walk me through Newton's method on `f(x) = x² − 2` starting at `x_0 = 1`. How many iterations to 1e-15?"*
- *"What's the difference between Newton and the secant method? When would you use each?"*
- *"Why doesn't the FPU have a hardware divider?"*
- *"What happens if I run Newton on `f(x) = x³ − 2x + 2` starting at `x_0 = 0`?"* (Answer: oscillates between 0 and 1 forever.)
- *"Explain the constant `0x5f3759df`."*
- *"Why does Newton's method work for logistic regression (IRLS) but not for deep learning?"* (Answer: Hessian inversion is `O(d³)`; for `d = 10⁶` that's infeasible.)
- *"Could you use Newton's method on a discontinuous function?"* (No — derivative doesn't exist at the jump.)

Memorize the update rule, the quadratic convergence property, the three failure modes, and the bracketed-Newton template. With those four, 80% of Newton-method interview questions become straightforward.
