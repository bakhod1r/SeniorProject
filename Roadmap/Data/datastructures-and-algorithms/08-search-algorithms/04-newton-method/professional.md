# Newton's Method — Professional Level

> **Audience:** Numerical analysts, algorithm designers, and researchers. Prerequisites: real analysis (Taylor's theorem, contraction mapping), basic linear algebra (norms, Jacobians), comfort with asymptotic analysis.

This document gives the **formal mathematical treatment** of Newton's method: a precise statement, a rigorous proof of **quadratic convergence**, the **Kantorovich theorem** giving sufficient conditions for global convergence, the **basin-of-attraction** analysis explaining Newton fractals, the **rate of convergence at multiple roots** (linear, not quadratic), and the **affine-invariance** property that explains why Newton is the "right" generalization of bisection.

---

## Table of Contents

1. [Formal Definition](#definition)
2. [Quadratic Convergence Theorem](#quadratic-convergence)
3. [Kantorovich Theorem — Sufficient Conditions for Convergence](#kantorovich)
4. [Basin of Attraction and Newton Fractals](#basin)
5. [Multiple Roots and the Modified Newton Iteration](#multiple-roots)
6. [Affine Invariance and Higher-Dimensional Newton](#affine)

---

<a name="definition"></a>
## 1. Formal Definition

### Problem

Let `f : U → ℝ` be a continuously differentiable function on an open set `U ⊆ ℝ`. A **root** of `f` is a point `r ∈ U` with `f(r) = 0`. The Newton iteration produces a sequence `{x_n} ⊂ U` defined by

```
x_{n+1} = g(x_n),   g(x) := x − f(x) / f'(x),   (1)
```

starting from a chosen seed `x_0 ∈ U`. Iteration (1) is **well-defined** as long as `f'(x_n) ≠ 0` and `x_{n+1} ∈ U`.

### Higher dimensions

For `F : U → ℝ^d` with `U ⊆ ℝ^d` open and `F` continuously differentiable, the Newton iteration becomes

```
x_{n+1} = x_n − [J_F(x_n)]^{−1} · F(x_n),   (2)
```

where `J_F` is the Jacobian matrix. The inverse exists as long as `J_F(x_n)` is non-singular.

### Fixed-point view

Iteration (1) is the **fixed-point iteration** for `g`. A fixed point of `g` is exactly a root of `f` (since `g(r) = r ⟺ f(r) = 0`, assuming `f'(r) ≠ 0`). Newton's method is therefore a special case of the Banach fixed-point theorem when `g` is a contraction.

The non-trivial content of Newton's method is that `g'(r) = 0` at a simple root (we'll show this below), so the iteration is not merely a contraction but a **superattracting** fixed point — neighboring points are pulled in **quadratically** fast, not just linearly.

---

<a name="quadratic-convergence"></a>
## 2. Quadratic Convergence Theorem

### Theorem (Quadratic convergence of Newton's method at a simple root)

Let `f : U → ℝ` be twice continuously differentiable on a neighborhood `U` of a root `r`, and suppose `f'(r) ≠ 0` (**simple root**). Then there exists `δ > 0` such that for every `x_0 ∈ (r − δ, r + δ)`, the Newton iterates `{x_n}` are well-defined, converge to `r`, and satisfy

```
|x_{n+1} − r| ≤ C · |x_n − r|²,   (3)
```

where `C = ½ · |f''(r) / f'(r)|`.

### Proof

Let `e_n := x_n − r`. By Taylor's theorem with Lagrange remainder, for some `ξ_n` between `x_n` and `r`,

```
f(x_n) = f(r) + f'(r) e_n + ½ f''(ξ_n) e_n²
       = f'(r) e_n + ½ f''(ξ_n) e_n²,        (4)
```

since `f(r) = 0`. Similarly, for some `η_n`,

```
f'(x_n) = f'(r) + f''(η_n) e_n.              (5)
```

Substituting (4) and (5) into the Newton update,

```
e_{n+1} = e_n − f(x_n)/f'(x_n)
        = e_n − [f'(r) e_n + ½ f''(ξ_n) e_n²] / [f'(r) + f''(η_n) e_n]
        = [e_n · (f'(r) + f''(η_n) e_n) − f'(r) e_n − ½ f''(ξ_n) e_n²] / [f'(r) + f''(η_n) e_n]
        = [f''(η_n) e_n² − ½ f''(ξ_n) e_n²] / [f'(r) + f''(η_n) e_n]
        = e_n² · [f''(η_n) − ½ f''(ξ_n)] / [f'(r) + f''(η_n) e_n].   (6)
```

By continuity of `f''` near `r`, both `f''(ξ_n)` and `f''(η_n)` approach `f''(r)`. Therefore, as `e_n → 0`,

```
[f''(η_n) − ½ f''(ξ_n)] / [f'(r) + f''(η_n) e_n] → ½ f''(r) / f'(r).
```

So

```
lim_{n→∞} |e_{n+1}| / |e_n|² = ½ |f''(r) / f'(r)| =: C.
```

This is the asymptotic constant. For finite `n` with `e_n` small enough, `|e_{n+1}| ≤ (C + ε) |e_n|²`, which gives (3). ∎

### Number-of-digits interpretation

Let `d_n := −log₁₀ |e_n|` be the number of correct decimal digits at step `n`. Inequality (3) gives

```
d_{n+1} ≥ 2 · d_n − log₁₀ C.
```

So **the number of correct digits roughly doubles** at each step, with a small constant correction. For `f(x) = x² − a` with `f''/f' = 1/x ≈ 1/√a`, `C ≈ 1/(2√a)`, and the constant is negligible after a few iterations.

### Sharpness

Inequality (3) is **tight**: equality holds asymptotically. You cannot get cubic convergence from the plain Newton iteration on a simple root — you'd need to use second derivatives (Halley's method, see Note below).

### Note: Halley's method achieves cubic convergence

Halley's update,

```
x_{n+1} = x_n − 2 f(x_n) f'(x_n) / [2 f'(x_n)² − f(x_n) f''(x_n)],
```

converges with order 3 at a simple root (correct digits **triple** per step). It requires `f''` per iteration, which is usually too expensive — Newton's order-2 is the sweet spot.

---

<a name="kantorovich"></a>
## 3. Kantorovich Theorem — Sufficient Conditions for Convergence

The quadratic convergence theorem (§2) is **local** — it requires `x_0` "close enough" to `r`, without quantifying "close enough". The **Kantorovich theorem** (1948) provides quantitative sufficient conditions that can be checked **without knowing `r`**.

### Theorem (Kantorovich, simplified univariate form)

Let `f : I → ℝ` be twice continuously differentiable on a closed interval `I = [x_0 − R, x_0 + R]`. Suppose

(i) `|1/f'(x_0)| ≤ β`,
(ii) `|f(x_0)/f'(x_0)| ≤ η`,
(iii) `|f''(x)| ≤ M` for all `x ∈ I`,
(iv) `h := β · η · M ≤ 1/2`,
(v) `R ≥ R*` where `R* := (1 − √(1 − 2h)) / (β · M)`.

Then:
1. The Newton iterates `{x_n}` are well-defined and stay in `I`.
2. They converge to a root `r* ∈ I` of `f`.
3. The convergence is **at least quadratic**, satisfying

```
|x_n − r*| ≤ R* · (2h)^(2^n − 1) / 2^n.
```

### What it means in practice

Kantorovich gives you a **constructive certificate**: compute three numbers (`β`, `η`, `M`) using only `f`, `f'`, `f''` at and near `x_0` — no knowledge of `r` required. If `h ≤ 1/2`, Newton **will** converge from `x_0`. This is the basis of rigorous numerical-analysis libraries (CAPD in Poland, INTLAB) that **prove** their numerical results.

### The constant `h = 1/2` is sharp

`h > 1/2` is not sufficient: there exist functions and seeds with `h` slightly above `1/2` from which Newton diverges. The boundary `h = 1/2` is where the parabola of the Taylor remainder "just" tangents the line whose root we seek — a delicate geometric balance.

### Multidimensional Kantorovich

For `F : ℝ^d → ℝ^d`, the conditions become:

(i) `‖J_F(x_0)^{−1}‖ ≤ β`,
(ii) `‖J_F(x_0)^{−1} F(x_0)‖ ≤ η`,
(iii) `‖H_F(x)‖ ≤ M` for all `x` in the ball (where `H_F` is the bilinear Hessian),
(iv) `h = β η M ≤ 1/2`.

Same conclusion: Newton converges quadratically. This is the workhorse theorem used to prove existence and uniqueness of solutions to nonlinear PDEs computationally.

---

<a name="basin"></a>
## 4. Basin of Attraction and Newton Fractals

### Definition

For a function `f` with roots `r_1, r_2, …, r_k`, the **basin of attraction** of `r_i` under Newton's method is

```
B(r_i) := { x_0 ∈ ℝ (or ℂ) : Newton from x_0 converges to r_i }.
```

For a polynomial with `k` simple roots, ℝ (or ℂ) decomposes as the disjoint union of the `k` basins plus a measure-zero "boundary" set (the **Julia set**) plus points where Newton fails to converge.

### Local structure (boring)

By the quadratic convergence theorem, each `r_i` has an open neighborhood entirely contained in `B(r_i)`. So basins have **open interiors** containing their target root.

### Global structure (wild)

Globally, basin boundaries can be **fractal**. For `f(z) = z³ − 1` over `ℂ`, the three basins for the cube roots of unity have a strikingly intricate boundary:

- The boundary is **the Julia set of the rational map `g(z) = (2z + 1/z²)/3`**.
- The Julia set has **Hausdorff dimension > 1** (fractal).
- Near any boundary point, all three basins are **arbitrarily close together** — a property called **"Wada"** (after the Wada sets in topology). For three or more roots, every boundary point is a boundary point of **every** basin simultaneously.

### Why this matters in practice

You cannot reliably "guess" which root Newton converges to from a generic seed. Near the boundary, a perturbation of 1 ULP can switch you from one basin to another. Production code that needs a specific root (not "any root") must either:

1. **Pre-locate** the desired root with bisection or grid search.
2. Use **deflation** (find one root, factor it out, recurse) for polynomials.
3. Use **continuation** (perturb the problem so all roots are separated, then deform back).

### Black-spot phenomenon

Some seeds never converge — they hit periodic orbits of Newton's iteration. For `f(z) = z³ − 1`, the seed `z_0 = 0` is undefined (`f'(0) = 0`), and seeds near `0` enter a long period-3 cycle before eventually escaping. These "black spots" form a Cantor-like set of measure zero but non-empty interior.

### The Newton-fractal painting

Color each pixel by which root Newton converges to from that pixel's `(real, imag)` coordinate. The result is a marbled, multicolored image with fractal boundaries. This is **the** classic Newton fractal. For `z³ − 1` you get three swirling basins; for `z⁵ − 1`, five; for arbitrary polynomials, arbitrarily complex.

### Theoretical implications

The Newton fractal demonstrates an important limit: **there is no general-purpose "globally convergent" version of Newton's method** that converges to a chosen root from any seed. The basin structure is intrinsic to the function. Practical robustness comes from **safeguards** (bracket maintenance, trust regions, basin-hopping), not from a magic fix to Newton itself.

---

<a name="multiple-roots"></a>
## 5. Multiple Roots and the Modified Newton Iteration

### What changes at a multiple root

Suppose `r` is a root of multiplicity `m`, meaning `f(x) = (x − r)^m · h(x)` with `h(r) ≠ 0`. Then `f(r) = f'(r) = … = f^{(m−1)}(r) = 0` and `f^{(m)}(r) ≠ 0`.

Near `r`, Newton's iteration behaves differently. Compute:

```
g(x) = x − f(x)/f'(x) = x − (x − r)^m h(x) / [m (x − r)^{m−1} h(x) + (x − r)^m h'(x)]
     = x − (x − r) · h(x) / [m h(x) + (x − r) h'(x)].
```

At `x_n` near `r`,

```
g(x_n) − r = (x_n − r) − (x_n − r) · h(x_n) / [m h(x_n) + (x_n − r) h'(x_n)]
           = (x_n − r) · [1 − h(x_n) / (m h(x_n) + (x_n − r) h'(x_n))]
           = (x_n − r) · [m h + (x_n − r) h' − h] / [m h + (x_n − r) h']  (suppressing args)
           = (x_n − r) · [(m − 1) h + O(e_n)] / [m h + O(e_n)]
           ≈ (x_n − r) · (m − 1) / m   as e_n → 0.
```

So:

```
e_{n+1} ≈ ((m − 1)/m) · e_n.
```

**Linear** convergence with constant `(m − 1)/m`. For `m = 2`, that's `0.5` — the same as bisection. For `m = 10`, it's `0.9` — terribly slow (each step buys only `−log₁₀(0.9) ≈ 0.046` digits).

### The modified Newton iteration

If the multiplicity `m` is known, the **modified Newton update**

```
x_{n+1} = x_n − m · f(x_n) / f'(x_n)
```

restores quadratic convergence. The constant `m` cancels the `(m − 1)/m` linear factor.

### Estimating multiplicity

If `m` is unknown, you can estimate it by watching consecutive errors. If `e_{n+1} ≈ ρ · e_n` with `ρ` near a value of the form `(m−1)/m`, then `m ≈ 1/(1 − ρ)`. Round to the nearest integer and switch to modified Newton.

Alternative: use the **damped relative gradient** form

```
x_{n+1} = x_n − f(x_n) · f'(x_n) / [f'(x_n)² − f(x_n) · f''(x_n)],
```

which is **always quadratic** at a multiple root (this is essentially Schroeder's method). It requires `f''`, like Halley's, but doesn't need to know `m`.

### Practical advice

If you suspect a multiple root (e.g., the function is `(x − a)² · something`), and Newton seems slow, switch to:

1. **Modified Newton** with the right `m`.
2. **Schroeder's method** (no `m` required, but needs `f''`).
3. **Compute on a perturbed function** `f(x) + ε` so the multiple root splits into nearby simple roots.

For competitive programming and standard interview problems, multiple roots are rare — most "find root of polynomial" problems have simple roots. For symbolic-computation systems (Mathematica, Sage), multiple roots show up constantly and the systems have built-in detection.

---

<a name="affine"></a>
## 6. Affine Invariance and Higher-Dimensional Newton

### Affine invariance

**Property.** Newton's method is **affine-invariant**: if you replace `f(x)` with `g(y) = A · f(B · y + c)` for any invertible matrices `A`, `B` and vector `c`, the Newton iteration on `g` from `y_0 = B^{−1}(x_0 − c)` produces the sequence `y_n = B^{−1}(x_n − c)` corresponding to Newton on `f` from `x_0`.

In words: **Newton is unchanged by linear changes of coordinates in either the input or the output**. Bisection has no such property — it depends on the choice of coordinates.

This is a deep theoretical reason why Newton "feels right": it ignores cosmetic differences in problem formulation.

### Consequence: condition number doesn't slow Newton down

For poorly scaled problems (where `f'` ranges over many orders of magnitude), gradient descent is destroyed by ill-conditioning. Newton's convergence rate is **independent** of the condition number, by affine invariance. The Hessian (in optimization) automatically rescales the gradient to the "right" coordinate system.

This is why **Newton is the gold standard for non-trivial smooth convex optimization** — it adapts to whatever weird-shaped landscape you give it.

### Higher-dimensional iteration

For `F : ℝ^d → ℝ^d`, the Newton iteration is

```
x_{n+1} = x_n − J_F(x_n)^{−1} · F(x_n).
```

You **do not** form the matrix inverse explicitly. Instead, solve the linear system `J_F(x_n) · Δ = −F(x_n)` for `Δ`, then `x_{n+1} = x_n + Δ`. This is one **`dgesv`** (LAPACK general solve) per iteration — `O(d³)` for dense `J_F`, less for sparse.

### Quadratic convergence in higher dimensions

The theorem from §2 generalizes: if `r` is a simple root (`J_F(r)` is nonsingular), Newton converges quadratically from any seed in some open neighborhood. The constant `C` involves operator norms of `J_F^{−1}` and the second-derivative tensor.

### Quasi-Newton methods

For very large `d` (say, `d = 10⁶`), forming and factoring `J_F` is infeasible. **Quasi-Newton** methods approximate `J_F^{−1}` by a low-rank update each iteration:

- **BFGS** (Broyden-Fletcher-Goldfarb-Shanno) — rank-2 update.
- **L-BFGS** — limited-memory BFGS, stores only the last `m` updates. Standard for deep learning hyperparameter tuning.
- **Broyden's method** — analog for root-finding rather than optimization.

Convergence becomes **superlinear** (order between 1 and 2) — slower per iteration than full Newton, but each iteration is `O(d²)` or even `O(md)`, vs `O(d³)` for full Newton.

### Newton-Krylov methods

Replace the linear solve with an iterative method (GMRES, CG). You only need **matrix-vector products** `J_F · v`, which can be computed by automatic differentiation in time comparable to a single `F` evaluation. This gives Newton-like convergence for problems with millions of variables — used in PDE solvers (Fluent, OpenFOAM, COMSOL).

---

## Summary of Bounds and Properties

| Quantity | Value / Property |
|---|---|
| Order of convergence (simple root) | **2** (quadratic) |
| Asymptotic constant `C` | `½ \|f''(r) / f'(r)\|` |
| Iterations to `eps` precision | `O(log log(1/eps))` once in basin |
| Iterations for `double` (1e-16) from good seed | 4–6 |
| Order at multiplicity-`m` root (vanilla Newton) | 1 (linear), factor `(m − 1)/m` |
| Order at multiplicity-`m` root (modified Newton with `m`) | 2 (quadratic) |
| Order with Halley's method (cubic) | 3 |
| Sufficient global condition | Kantorovich: `h = β η M ≤ 1/2` |
| Affine invariance | Yes |
| Robust to ill-conditioning? | Yes (because of affine invariance) |
| Guaranteed to converge globally? | No |
| Basin boundary structure | Fractal (Julia set) for polynomials with ≥ 2 roots |
| Higher-dim cost per iter | `O(d³)` Jacobian solve; less for sparse / Krylov |

These properties are **tight** in the comparison-and-arithmetic model. To go faster than quadratic, use Halley (`f''`); to go robust without a derivative, use Brent or trust-region.

---

## Further Reading

- **Kantorovich**, "Functional Analysis and Applied Mathematics" (1948) — original statement of the convergence theorem.
- **Ortega & Rheinboldt**, *Iterative Solution of Nonlinear Equations in Several Variables* (1970, reprinted SIAM 2000). The encyclopedic reference for higher-dimensional Newton.
- **Deuflhard**, *Newton Methods for Nonlinear Problems: Affine Invariance and Adaptive Algorithms* (2004). Modern treatment, emphasizes affine invariance.
- **Smale**, "Newton's Method Estimates from Data at One Point" (1986). The α-theory for verifiable convergence certificates.
- **Tatham**, "Fractal images of formal systems" (1995) — accessible writeup of Newton fractals.
- **Press et al.**, *Numerical Recipes* — §9.4 (rtsafe), §9.7 (Broyden's method), §10.7 (Levenberg-Marquardt).
- **Nocedal & Wright**, *Numerical Optimization* (2nd ed., 2006), Chapters 6, 11 — quasi-Newton, Newton-Krylov.
