# Newton's Method — Middle Level

> **Audience:** Engineers comfortable with the basic Newton iteration who want the variant family used in real numerical libraries and competitive programming. Prerequisite: `junior.md`.

This document covers the **family of root-finding algorithms built around the Newton update**: the **secant method** (Newton without an explicit derivative), **damped Newton** for robust convergence from bad seeds, **Newton's method for optimization** (zeros of `f'`), the **bracketed Newton with bisection fallback** template that every production library uses, **k-th root** generalizations, **complex Newton** for finding complex roots (and the Newton-fractals that result), and a clear-eyed comparison with bisection so you know which to reach for.

---

## Table of Contents

1. [Secant Method — Newton Without a Derivative](#secant)
2. [Damped Newton for Bad Seeds](#damped)
3. [Newton's Method for Optimization](#optimization)
4. [Bracketed Newton with Bisection Fallback (Brent's Idea)](#bracketed)
5. [K-th Root via Newton](#kth-root)
6. [Complex Newton and Newton Fractals](#complex)
7. [Comparison with Bisection and the Secant Method](#vs-bisection)

---

<a name="secant"></a>
## 1. Secant Method — Newton Without a Derivative

Newton needs `f'(x)`. What if you only have `f` — say, `f` is the result of a costly simulation, or a black-box library call, and you have no closed-form derivative? The **secant method** replaces the analytical derivative with a **finite-difference approximation** using the two most recent iterates:

```
f'(x_n) ≈ (f(x_n) − f(x_{n−1})) / (x_n − x_{n−1})
```

Substituting into Newton's update:

```
x_{n+1} = x_n − f(x_n) · (x_n − x_{n−1}) / (f(x_n) − f(x_{n−1}))
```

Geometrically: instead of drawing the tangent at `x_n`, you draw the **secant** through `(x_{n−1}, f(x_{n−1}))` and `(x_n, f(x_n))`. The secant's x-intercept becomes `x_{n+1}`.

### Implementation (Python):

```python
def secant(f, x0, x1, eps=1e-12, max_iter=100):
    f0, f1 = f(x0), f(x1)
    for _ in range(max_iter):
        if f1 == f0:
            raise ZeroDivisionError("flat secant — cannot proceed")
        x2 = x1 - f1 * (x1 - x0) / (f1 - f0)
        if abs(x2 - x1) < eps:
            return x2
        x0, x1, f0, f1 = x1, x2, f1, f(x2)
    raise RuntimeError("did not converge")
```

### Implementation (Go):

```go
func Secant(f func(float64) float64, x0, x1, eps float64, maxIter int) (float64, error) {
    f0, f1 := f(x0), f(x1)
    for i := 0; i < maxIter; i++ {
        if f1 == f0 {
            return x1, errors.New("flat secant")
        }
        x2 := x1 - f1*(x1-x0)/(f1-f0)
        if math.Abs(x2-x1) < eps {
            return x2, nil
        }
        x0, x1, f0, f1 = x1, x2, f1, f(x2)
    }
    return x1, errors.New("did not converge")
}
```

### Implementation (Java):

```java
public static double secant(DoubleUnaryOperator f, double x0, double x1,
                            double eps, int maxIter) {
    double f0 = f.applyAsDouble(x0), f1 = f.applyAsDouble(x1);
    for (int i = 0; i < maxIter; i++) {
        if (f1 == f0) throw new ArithmeticException("flat secant");
        double x2 = x1 - f1 * (x1 - x0) / (f1 - f0);
        if (Math.abs(x2 - x1) < eps) return x2;
        x0 = x1; x1 = x2; f0 = f1; f1 = f.applyAsDouble(x2);
    }
    throw new IllegalStateException("did not converge");
}
```

### Convergence order

The secant method converges with order `φ = (1 + √5) / 2 ≈ 1.618` — the **golden ratio**. This is between linear (1) and quadratic (2). One iteration is cheaper than Newton (one `f` evaluation per step instead of `f` + `f'`), so in practice the **cost-per-digit** of secant is competitive with Newton when `f'` is expensive to compute.

| Algorithm | Convergence order | Evaluations per iter | "Speed" (digits per evaluation) |
|---|---|---|---|
| Bisection | 1 (linear, factor 0.5) | 1 | ~0.301 digits/eval |
| Secant | 1.618 | 1 `f` | log₁₀(1.618) ≈ 0.209 digits per eval, but doubles when ramped up |
| Newton | 2 (quadratic) | 1 `f` + 1 `f'` | up to 16 digits in 4 steps |
| Brent | 2 (typically), 1 worst case | 1 `f` | combines safety with speed |

In practice **secant** is the default when derivatives are unavailable or untrustworthy (machine-learning gradient hooks, finite-difference Jacobians of expensive simulators). The MATLAB `fzero` and SciPy `brentq` both rely on secant-style updates inside their hybrid logic.

### Caveat: numerical cancellation

When `f(x_n) ≈ f(x_{n−1})` near convergence, the difference `f(x_n) − f(x_{n−1})` suffers **catastrophic cancellation**: most of the digits agree, so the subtraction loses precision. The secant iteration can lose its quadratic-ish behavior in the last few steps. Newton doesn't have this issue — `f'(x)` is computed analytically.

This is why production root-finders often **switch** from secant to bisection in the final iterations to nail down the last bits cleanly.

---

<a name="damped"></a>
## 2. Damped Newton for Bad Seeds

If your seed is far from the root, the full Newton step `Δx = −f(x)/f'(x)` can overshoot wildly. **Damped Newton** scales the step:

```
x_{n+1} = x_n − α · f(x_n) / f'(x_n),   0 < α ≤ 1
```

Pick `α < 1` to take a smaller, safer step. You lose quadratic convergence (it becomes linear for `α < 1`), but you gain robustness.

### Line-search damping (the smart version)

A fixed `α` is crude. The standard practice is a **backtracking line search**: try `α = 1`; if `|f(x_new)| > |f(x_old)|` (or some Armijo-style criterion), halve `α` and try again. Repeat until you find a step that decreases `|f|`. Then take that step and increase `α` back toward 1.

```python
def damped_newton(f, fprime, x0, eps=1e-12, max_iter=100):
    x = x0
    for _ in range(max_iter):
        fx, dfx = f(x), fprime(x)
        if dfx == 0: raise ZeroDivisionError
        step = -fx / dfx
        alpha = 1.0
        while alpha > 1e-10:
            x_new = x + alpha * step
            if abs(f(x_new)) < abs(fx):       # decreased — accept
                break
            alpha *= 0.5                      # backtrack
        else:
            raise RuntimeError("line search failed")
        if abs(x_new - x) < eps: return x_new
        x = x_new
```

### When damping matters

- **High-dimensional problems**: in Newton for systems (using a Jacobian), the full Newton step can wildly overshoot. Damping is **essential**, not optional.
- **Non-convex problems**: full Newton may step toward a saddle point or a different root. Damping keeps you near the descent direction.
- **Numerical optimization**: every modern solver (BFGS, trust-region, sequential quadratic programming) damps Newton steps.
- **Stiff systems**: ODEs solved by implicit Newton methods always damp; the full step can leave the region of stability.

### Damping vs Quadratic Convergence

There's a trade-off: full Newton (`α = 1`) is fastest **when it works**; damped Newton is slower but more reliable. The standard heuristic: **damp far from the root; switch to full Newton when in the basin.** Modern solvers detect "the basin" by monitoring whether the previous step decreased `|f|` by enough — if yes, raise `α` toward 1.

---

<a name="optimization"></a>
## 3. Newton's Method for Optimization

So far we've been **root-finding**: solve `f(x) = 0`. What about **optimization**: find `x` that minimizes (or maximizes) some smooth function `g(x)`?

A minimum of `g` (away from boundaries) satisfies `g'(x) = 0`. So **apply Newton's root-finding to `g'`**:

```
x_{n+1} = x_n − g'(x_n) / g''(x_n)
```

Now you need the **second derivative** `g''`. In multivariate optimization, `g'` is the gradient and `g''` is the **Hessian matrix** — and the update becomes:

```
x_{n+1} = x_n − H⁻¹ · ∇g
```

This is **Newton's method for optimization**. It is the gold standard for unconstrained smooth optimization — when you can afford the Hessian.

### Newton vs gradient descent

Gradient descent uses **first-order** information only: `x_{n+1} = x_n − η · ∇g`. Step size `η` is a tuning knob; convergence is **linear**.

Newton uses **second-order** information: the Hessian scales the step direction. Convergence is **quadratic** near a minimum where `H` is positive-definite. The Hessian's inverse acts as an "optimal step size" — no `η` tuning needed.

The price: you need to compute and invert a Hessian. For `d`-dimensional problems, that's `O(d²)` storage and `O(d³)` flops per step. For `d ~ millions` (deep learning), this is infeasible — hence quasi-Newton (BFGS, L-BFGS) and first-order methods (Adam, SGD).

### Concrete example: maximize `g(x) = x · e^{−x²}`

```
g'(x)  = e^{−x²} (1 − 2x²)
g''(x) = e^{−x²} (−6x + 4x³)
```

```python
def maximize_g(x0, eps=1e-12, max_iter=50):
    import math
    def g_prime(x):  return math.exp(-x*x) * (1 - 2*x*x)
    def g_dprime(x): return math.exp(-x*x) * (-6*x + 4*x*x*x)
    x = x0
    for _ in range(max_iter):
        gp, gpp = g_prime(x), g_dprime(x)
        if gpp == 0: raise ZeroDivisionError
        x_new = x - gp / gpp
        if abs(x_new - x) < eps: return x_new
        x = x_new
```

True maximum: `x = 1/√2 ≈ 0.7071`. From `x_0 = 1`, Newton converges in ~5 iterations.

### Saddle points are a trap

If you're at a **saddle point** (where `g' = 0` but `H` is indefinite — some eigenvalues positive, some negative), Newton "converges" right there. Modern deep-learning theory (Dauphin et al. 2014) suggests saddle points are the dominant issue for large neural nets — not local minima. **Cubic-regularized Newton** and **trust-region methods** explicitly handle this; vanilla Newton does not.

### Use cases

- **Logistic regression** (`statsmodels`, R `glm()`, scikit-learn `solver='newton-cg'`).
- **MLE for parametric distributions** (`scipy.stats` and SAS `PROC NLMIXED`).
- **Interior-point methods** for linear programming (CPLEX, Gurobi, MOSEK) — each iteration is a damped Newton step.
- **Bundle adjustment** in computer vision (camera-pose refinement) — sparse Hessian, Levenberg–Marquardt (a damped Gauss-Newton variant).
- **Optimal control / model-predictive control** — every step of MPC is a (sequential) Newton-like solve.

---

<a name="bracketed"></a>
## 4. Bracketed Newton with Bisection Fallback (Brent's Idea)

The single most useful pattern in production root-finding. The idea: **maintain a bracket `[a, b]` with `f(a)·f(b) < 0`** at all times. Try a Newton step. If the step lands inside the bracket and looks productive, accept it. Otherwise, fall back to **bisection** for that step. Always update the bracket after each accepted step.

This gives you **the quadratic speed of Newton when possible and the global safety of bisection when needed**. It is the basis of:

- `scipy.optimize.brentq` (Python)
- `gsl_root_fsolver_brent` (GNU Scientific Library)
- `BrentSolver` in Apache Commons Math
- MATLAB's `fzero`
- `cppopt::brent` in production C++ scientific code

### Pseudocode

```
function safe_root(f, fprime, a, b, eps, max_iter):
    assert f(a) * f(b) < 0          # bracket has sign change
    x = (a + b) / 2                 # start at midpoint
    for i in 1..max_iter:
        if |f(x)| < eps:
            return x
        # try Newton step
        x_newton = x - f(x) / fprime(x)
        if x_newton in (a, b) and |x_newton - x| < (b - a) / 2:
            x = x_newton              # take Newton
        else:
            x = (a + b) / 2           # bisect instead
        # update bracket so it still contains the root
        if f(a) * f(x) < 0:
            b = x
        else:
            a = x
    return x
```

### Python implementation

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
        x_newton = x - fx / dfx if dfx != 0 else None

        # accept Newton if (i) it's defined, (ii) it stays in [a, b],
        # (iii) it shrinks the bracket by at least half
        if (x_newton is not None
                and a < x_newton < b
                and abs(x_newton - x) < 0.5 * (b - a)):
            x = x_newton
        else:
            x = 0.5 * (a + b)         # bisection fallback

        # maintain bracket
        if f(x) * fa < 0:
            b = x
        else:
            a, fa = x, f(x)
    return x
```

### Why "Newton step shrinks bracket by at least half"

Without this guard, a "good but tiny" Newton step can starve the bisection of progress, and a degenerate case can cause exponentially slow convergence. By requiring `|x_new − x| < (b − a) / 2`, you ensure each iteration cuts the bracket by **at least half** in the worst case — recovering bisection's guarantee while still benefiting from Newton speed.

This is the **safety contract** that makes Brent's method nearly unbreakable in practice. SciPy's `brentq` has been used to solve **hundreds of billions** of root-finding problems across the scientific computing world without a single reported "infinite loop" bug — because of this contract.

### Brent's actual method

Brent's method goes one step further: instead of plain bisection as the fallback, it uses **inverse quadratic interpolation** when three iterates are available. Inverse quadratic fits a parabola through `(f, x)` triples (note: `x` as a function of `f`, not the other way around) and uses its root. When that fails the safety check, it falls back to secant, then to bisection. Three-tier fallback, monotonically decreasing safety, monotonically increasing speed.

---

<a name="kth-root"></a>
## 5. K-th Root via Newton

Generalize the Babylonian sqrt: compute `√[k]{n}` = `n^(1/k)`. Solve `f(x) = x^k − n = 0`. Derivative: `f'(x) = k·x^{k−1}`. Update:

```
x' = x − (x^k − n) / (k · x^{k−1})
   = ((k − 1)·x + n / x^{k−1}) / k
   = (1 − 1/k)·x + n / (k · x^{k−1})
```

For `k = 2`: `x' = x/2 + n/(2x) = (x + n/x)/2`. The Babylonian formula falls out.
For `k = 3` (cube root): `x' = (2x + n/x²) / 3`.

### Python implementation:

```python
def kth_root(n: float, k: int, eps=1e-15, max_iter=100) -> float:
    if n < 0 and k % 2 == 0:
        return float('nan')
    sign = 1 if n >= 0 else -1
    n = abs(n)
    if n == 0: return 0.0
    x = n ** (1 / k)            # crude FP seed
    for _ in range(max_iter):
        x_new = ((k - 1) * x + n / x**(k - 1)) / k
        if abs(x_new - x) < eps * abs(x_new):
            return sign * x_new
        x = x_new
    return sign * x
```

### Go implementation:

```go
func KthRoot(n float64, k int) float64 {
    if n < 0 && k%2 == 0 {
        return math.NaN()
    }
    sign := 1.0
    if n < 0 { sign = -1.0; n = -n }
    if n == 0 { return 0 }
    x := math.Pow(n, 1.0/float64(k))
    kf := float64(k)
    for i := 0; i < 100; i++ {
        next := ((kf-1)*x + n/math.Pow(x, kf-1)) / kf
        if math.Abs(next-x) < 1e-15*math.Abs(next) {
            return sign * next
        }
        x = next
    }
    return sign * x
}
```

### Java implementation:

```java
public static double kthRoot(double n, int k) {
    if (n < 0 && k % 2 == 0) return Double.NaN;
    double sign = n < 0 ? -1 : 1;
    n = Math.abs(n);
    if (n == 0) return 0;
    double x = Math.pow(n, 1.0 / k);
    for (int i = 0; i < 100; i++) {
        double next = ((k - 1) * x + n / Math.pow(x, k - 1)) / k;
        if (Math.abs(next - x) < 1e-15 * Math.abs(next))
            return sign * next;
        x = next;
    }
    return sign * x;
}
```

### Integer k-th root

When `n` is a large integer and you want `⌊n^(1/k)⌋` exactly (e.g., perfect-power detection in number theory), use integer arithmetic — same iteration, integer division. Stop when the iterate stops decreasing. Python 3.11+ ships `math.isqrt` for `k = 2`; for arbitrary `k`, write the loop yourself.

---

<a name="complex"></a>
## 6. Complex Newton and Newton Fractals

Newton's method works on any field where division is defined — including the **complex numbers**. To find complex roots of `f(z) = 0` (where `z ∈ ℂ`):

```
z_{n+1} = z_n − f(z_n) / f'(z_n)
```

Same formula, complex arithmetic. From a complex seed, you converge to a complex root.

### Example: roots of `z³ − 1 = 0`

The three roots are `1`, `e^{2πi/3}`, `e^{4πi/3}` — the cube roots of unity. The update:

```
z' = z − (z³ − 1) / (3z²) = (2z + 1/z²) / 3
```

### Python (using `complex`):

```python
def complex_newton(z0: complex, eps=1e-12, max_iter=100) -> complex:
    z = z0
    for _ in range(max_iter):
        if z == 0: return None     # avoid 1/z² blowup
        z_new = (2*z + 1/(z*z)) / 3
        if abs(z_new - z) < eps:
            return z_new
        z = z_new
    return z
```

Try `z0 = 1 + 1j`. Converges to `1.0`.
Try `z0 = −1 − 0.5j`. Converges to one of the complex cube roots.

### Newton fractals

Color each point `z₀` in the complex plane by **which root** Newton converges to from that seed. The result is a **fractal** with intricate, self-similar boundaries. The image looks like a marbled, multi-colored Mandelbrot.

```python
import numpy as np

def newton_fractal(width=400, height=400, max_iter=30):
    re = np.linspace(-2, 2, width)
    im = np.linspace(-2, 2, height)
    Z = re[None, :] + 1j * im[:, None]
    roots = np.array([1, np.exp(2j*np.pi/3), np.exp(4j*np.pi/3)])
    for _ in range(max_iter):
        Z = Z - (Z**3 - 1) / (3 * Z**2)
    # color by nearest root
    dist = np.abs(Z[..., None] - roots)
    return np.argmin(dist, axis=-1)
```

Plot with `plt.imshow(newton_fractal())` — you get the classic Newton-fractal portrait. Beautiful, and a vivid illustration of how sensitive Newton's basin of attraction is to the seed.

### Practical uses of complex Newton

- **Polynomial root-finding** for all roots: combine Newton with **deflation** — find one root, divide out the factor, find the next.
- **Numerical solution of complex transcendental equations** (e.g., dispersion relations in physics).
- **Argument-principle root counting** for analytic functions.
- **Stability analysis of linear systems** — eigenvalues are roots of the characteristic polynomial.

The lesson: Newton is a **field-agnostic** algorithm. Wherever you can do arithmetic and differentiation, Newton applies.

---

<a name="vs-bisection"></a>
## 7. Comparison with Bisection and the Secant Method

| Property | Bisection | Secant | Newton |
|---|---|---|---|
| **Convergence order** | 1 (linear, factor 0.5) | 1.618 | 2 (quadratic) |
| **Iterations to `double`** | ~53 | ~10–15 | 4–6 |
| **Eval per iter** | 1 `f` | 1 `f` | 1 `f` + 1 `f'` |
| **Needs `f'`?** | No | No | **Yes** |
| **Needs bracket?** | **Yes** (sign change) | No (two seeds) | No (one seed) |
| **Guaranteed convergence?** | **Yes** | No | No |
| **Behaves on `NaN`?** | Detects bad bracket | Can diverge | Can diverge |
| **Robust to multiple root?** | Yes (slow) | Yes (slow) | Slow (linear) |
| **Cost on cheap `f'`** | Worst | Middle | **Best** |
| **Cost on expensive `f'`** | Middle | **Best** | Worst |

### When to use each

- **Bisection**: when you want guaranteed convergence and precision matters less than reliability. You have a known bracket. `f` is cheap.
- **Secant**: when you have no derivative, and `f` is expensive enough that you don't want to compute it twice per step (which Newton's finite-difference variant would require).
- **Newton**: when `f'` is cheap (closed-form or cheap to compute via autograd) and you have a good seed. Highest precision per CPU cycle.
- **Brent** (= bracketed Newton/secant with bisection fallback): when you want all of the above. The default in every production library.

### A timing comparison

Solve `cos(x) − x = 0` (root ≈ 0.7390851332151607), starting at `x_0 = 0`:

| Method | Iterations to 1e-15 | Notes |
|---|---|---|
| Bisection on [0, 1] | 50 | Guaranteed |
| Secant from (0, 1) | 8 | No derivative needed |
| Newton (with `f'(x) = −sin(x) − 1`) | 4 | Quadratic, blazing |
| Brent | 5 | Best of all worlds |

For "find a root of a smooth function with a known seed", **Newton wins on speed by a factor of 10+**. For "find a root reliably in a piece of production code I can never debug at 3 AM", **Brent wins on reliability**.

### Decision tree

```
Have a bracket [a, b]?            Want best speed?
   No → Newton or secant            Yes → Newton (if f' available) or Brent
   Yes ↓                            No  → Bisection
   Need guaranteed convergence?
      Yes → Bisection or Brent
      No  → Newton + Brent fallback

Have f' easily?
   Yes → Newton
   No  → Secant or finite-difference Newton

Function noisy / expensive?
   Yes → Secant or Levenberg–Marquardt (if optimization)
   No  → Newton
```

---

## Cheat Sheet — Algorithm Selection

```
Problem                                          Best tool
-------                                          ---------
Smooth f, cheap f', good seed                    Newton
Smooth f, no f' available                        Secant
Smooth f, want guaranteed convergence            Brent
Continuous f, bracket known                      Bisection
Optimization (minimize g)                        Newton on g' (uses g'')
Optimization, large d                            BFGS / L-BFGS / Adam
Polynomial all roots                             Newton + deflation, or Durand-Kerner
Complex roots                                    Complex Newton
Noisy / black-box f                              Brent or Nelder-Mead
Stiff ODE implicit step                          Damped Newton with line search
```

---

## Further Reading

- **Brent**, *Algorithms for Minimization Without Derivatives* (1973). The original Brent's-method paper.
- **Dekker** (1969), "Finding a Zero by Means of Successive Linear Interpolation". Predecessor to Brent.
- **Nocedal & Wright**, *Numerical Optimization* (2nd ed., 2006). Chapter 3 (line search) and Chapter 11 (Newton for nonlinear equations).
- **Press et al.**, *Numerical Recipes* (3rd ed.). Chapter 9: rtsafe (bracketed Newton), zriddr (Ridder's method), rtflsp (false position).
- **Tropp**, "An Introduction to Matrix Concentration Inequalities" — surprisingly contains a nice writeup of Newton in the context of optimization.
- Continue with `senior.md` for the fast inverse square root deep dive, Goldschmidt CPU division, and Newton in production numerical libraries.
