# Newton's Method — Senior Level

> **Audience:** Engineers building or maintaining production systems where Newton's method is the underlying primitive — numerical libraries, CPU microcode, game engines, statistical solvers, optimization frameworks. Prerequisites: `junior.md`, `middle.md`.

This document treats Newton's method as **infrastructure**, not as a numerical-analysis curiosity. We cover where it actually lives in production: inside the CPU's floating-point division unit (Goldschmidt), inside `glibc`'s `sqrt` and `Math.sqrt`, in the Quake III fast-inverse-square-root with the `0x5f3759df` magic constant, in scikit-learn's logistic regression solver, in interior-point linear programming, and in Levenberg–Marquardt for nonlinear least squares. The senior takeaway: Newton's method runs **trillions of times per second** across the world's silicon and HPC clusters. Knowing its quirks pays dividends.

---

## Table of Contents

1. [Newton in CPU Microcode — Goldschmidt Division](#cpu-division)
2. [`glibc` and JVM `sqrt` Internals](#sqrt-internals)
3. [The Quake III Fast Inverse Square Root — Full Dissection](#quake-rsqrt)
4. [Newton in Statistical Solvers — IRLS, MLE](#stats)
5. [Newton in Optimization — Interior-Point, Levenberg–Marquardt](#optimization)
6. [Production Safeguards — When Newton Goes Wrong in the Real World](#production)

---

<a name="cpu-division"></a>
## 1. Newton in CPU Microcode — Goldschmidt Division

A modern x86 / ARM / RISC-V floating-point unit has **no hardware divider**. There is no `divs` cell as monolithic as the multiplier. Instead, division is computed by Newton's method on `f(x) = 1/x − n`, producing an iteration of pure **multiplies and adds** — operations the FPU already does at full speed.

### The derivation

Solve `f(x) = 1/x − n = 0`. Derivative: `f'(x) = −1/x²`. Newton update:

```
x' = x − (1/x − n) / (−1/x²)
   = x + x² · (1/x − n)
   = x + x − n · x²
   = x · (2 − n · x)
```

**`x * (2 − n * x)`** — two multiplies and one subtract. Zero divisions.

### Iteration count

Each step squares the error. With an 8-bit lookup table seed (so 8 bits of correct mantissa), the iteration goes:

```
8 bits → 16 → 32 → 53 (double mantissa, full IEEE 754 precision)
```

Three iterations suffice for `double`. Two iterations for `float`. One iteration is enough for "graphics float" used in shaders.

### Goldschmidt vs Newton-Raphson

The version used in production silicon is actually **Goldschmidt's algorithm**, which differs from textbook Newton-Raphson in a subtle but important way: Goldschmidt iterates `n*x` and `x` separately, allowing two independent multipliers to run in parallel:

```
r_0 = lookup_table_inverse(n)      # initial reciprocal
e_0 = 1 − n · r_0                   # error term
r_1 = r_0 · (1 + e_0)
e_1 = e_0²
r_2 = r_1 · (1 + e_1)
e_2 = e_1²
...
```

Each iteration doubles the bits, exactly like Newton-Raphson — but the two multipliers (`r` and `e`) can execute on **separate functional units** in the same cycle. Newton-Raphson serializes them. Goldschmidt wins ~30% on pipelined CPUs.

The price: Goldschmidt accumulates rounding error differently. Newton-Raphson is **self-correcting** (the error term shrinks as `x²`); Goldschmidt is not. Production microcode uses Goldschmidt for early iterations and a final Newton-Raphson "cleanup" step to nail down the rounding bits.

### Implementation on actual hardware

- **Intel**: since Pentium 4 (2000), `DIV` and `FDIV` instructions decompose to microcode that runs ~3 Goldschmidt iterations. Total latency: ~10–20 cycles. Compare with `MUL` (3–5 cycles) and `ADD` (1 cycle).
- **AMD Zen**: similar microcode-based Goldschmidt. AMD's instruction `VRCPPS` (reciprocal estimate) returns the lookup-table seed; the application can refine with Newton steps in user code.
- **ARM**: instruction `FRECPE` returns the seed (~8 bits); `FRECPS` computes one Newton-Raphson refinement step (`2 − n·x`). Two `FRECPS` instructions = full `float` reciprocal.
- **NVIDIA GPUs**: similar — `__frcp_rn` is implemented this way. Single-precision reciprocal is one instruction; double-precision uses Newton-Raphson refinement.

### The FDIV bug — what happens when the table is wrong

In 1994, Intel shipped Pentium processors with a defective lookup table for the Goldschmidt seed: a few entries were missing in the silicon ROM. The result: incorrect reciprocal seeds for a tiny fraction of input bit-patterns. Newton's iteration **refined the wrong answer** to high precision — producing an off-by-`10⁻⁴` error in division for ~1 in 9 billion divisions. The bug cost Intel **$475 million** in chip replacements and a public-relations disaster. Lesson: when Newton refines a bad seed, it confidently produces a wrong answer with full precision.

---

<a name="sqrt-internals"></a>
## 2. `glibc` and JVM `sqrt` Internals

When you write `Math.sqrt(n)` in Java or `math.sqrt(n)` in Python, what actually runs?

### On x86, the `SQRT` instruction

x86-64 has a dedicated `SQRTSD` (scalar double square root) instruction. It is implemented in hardware microcode via **Newton-Raphson on `1/√n`** — note: on the *inverse* square root, not on `√n` itself:

```
Update for 1/√n:   y' = y · (1.5 − 0.5 · n · y²)
Then:              √n = n · y_final
```

Why iterate on `1/√n`? Because the update has **no division** — only multiplications. This is exactly the Quake III trick, just inside silicon. After three iterations, `y_final` has ~53 bits of mantissa accuracy. Then `n · y` produces `√n` to `double` precision in one final multiply.

### Total latency

x86 `SQRTSD`: ~14–20 cycles (varies by µarch). The hardware seed comes from a ~12-bit lookup table; two Newton refinements; one final multiply. The latency is dominated by the multiplier pipeline, not the iteration count.

### When the FPU is too slow — `fast_math` shortcuts

For graphics and ML workloads, you don't always need IEEE-754-correct sqrt. Compilers offer flags (`-ffast-math` in GCC, `-Ofast`, `--use_fast_math` in CUDA) that swap `SQRTSD` for:

```c
return n * _mm_rsqrt_ss(n);   // single instruction, ~5 cycles
```

`RSQRTSS` is the IEEE 754 reciprocal-square-root estimate. It returns a 12-bit approximation. You can refine with Newton in user code:

```c
__m128 rsqrt_refined(__m128 n) {
    __m128 y = _mm_rsqrt_ss(n);
    // one Newton step: y = y * (1.5 - 0.5*n*y*y)
    __m128 half_n = _mm_mul_ss(_mm_set_ss(0.5f), n);
    __m128 y2 = _mm_mul_ss(y, y);
    __m128 corr = _mm_sub_ss(_mm_set_ss(1.5f), _mm_mul_ss(half_n, y2));
    return _mm_mul_ss(y, corr);
}
```

One Newton step boosts 12 bits to ~24 bits (single precision). Two steps → full `double`. This is **literally Quake III**, vectorized, running in modern game engines and graphics shaders today.

### The JVM `Math.sqrt` story

`Math.sqrt` in HotSpot compiles to a single x86 `SQRTSD` instruction in JIT-compiled code. No Java-side loops. The JVM trusts the hardware. On platforms without a hardware sqrt (some embedded chips), it falls back to a software Newton implementation in `fdlibm`.

### `fdlibm`'s software sqrt — the portable reference

Sun's `fdlibm` (Freely Distributable Math Library) is the portable, bit-exact reference implementation for IEEE 754 sqrt. Its core is:

1. Extract the IEEE 754 exponent; divide by 2 (bit-shift).
2. Use the mantissa's high bits to look up a seed.
3. Apply **2–3 Newton-Raphson iterations** with carefully chosen rounding to land on the IEEE-754-correctly-rounded result.

You can read the source: it's in the OpenJDK tree at `src/java.base/share/native/libfdlibm/e_sqrt.c`. The implementation is ~200 lines of tight C, dominated by Newton steps and careful rounding.

### Why Newton dominates for transcendentals

Beyond sqrt: `exp`, `log`, `sin`, `cos`, `pow` — these too rely on Newton-flavored iterations inside `glibc`'s `libm` and Intel's `SVML`. The general pattern:

1. **Reduce** the argument to a small canonical range (e.g., `sin` reduces to `[0, π/4]`).
2. **Approximate** with a polynomial (minimax or remez polynomial).
3. **Correct** with one or two Newton iterations on the inverse function (e.g., for `log`, refine using `exp`).

The Newton-refinement step **bounds the error** below ULP — essential for IEEE-754 conformance. Without it, polynomial approximations would routinely produce last-bit-wrong results.

---

<a name="quake-rsqrt"></a>
## 3. The Quake III Fast Inverse Square Root — Full Dissection

The single most famous use of Newton's method outside academia. Let's dissect it line by line.

### The code (id Software, Quake III Arena, 1999)

```c
float Q_rsqrt(float number) {
    long  i;
    float x2, y;
    const float threehalfs = 1.5F;

    x2 = number * 0.5F;
    y  = number;
    i  = *(long *) &y;                    // step 1: bit cast
    i  = 0x5f3759df - (i >> 1);           // step 2: magic
    y  = *(float *) &i;                   // step 3: cast back
    y  = y * (threehalfs - (x2 * y * y)); // step 4: one Newton iteration
//  y  = y * (threehalfs - (x2 * y * y)); // step 5: (omitted; accuracy not needed)

    return y;
}
```

### Step 1 — bit cast

`*(long *) &y` reinterprets the **bit pattern** of the `float` `y` as a `long`. IEEE 754 single-precision float has 1 sign bit, 8 exponent bits, 23 mantissa bits. So `i` is a 32-bit integer holding the float's exponent and mantissa fields contiguously.

### Step 2 — the magic constant `0x5f3759df`

Here's the insight. An IEEE 754 float represents `(1 + M/2^23) · 2^(E−127)`, where `M` is the 23-bit mantissa and `E` is the 8-bit biased exponent. Take the `log₂`:

```
log₂(y) ≈ (E - 127) + M/2^23
```

For floats in `[1, 2)`, `log₂(y)` is `M/2^23` exactly (because `E = 127`).

Now: `log₂(1/√y) = −0.5 · log₂(y)`. The bit pattern of `1/√y`, viewed as a "log-like" integer, is approximately `−0.5 · log₂(y) + 127`, expressed as `(E' − 127) + M'/2^23`. The factor `0.5` is a shift right by 1; the additive constant `127` (and a correction factor to handle the mantissa nonlinearity) is the **magic constant**.

The actual derivation (Lomont, 2003): you want to solve, in the integer representation,

```
i_result = R - (i_y >> 1)
```

where `R` is chosen so that the error after one Newton step is minimized over the range `y ∈ [1, 4)`. Carefully working through the IEEE 754 math, you get `R ≈ 0x5f3759df` — though Lomont's analysis showed `0x5f375a86` is **slightly more accurate** (one ULP better in worst case). Carmack's value has become folklore; mathematically `0x5f375a86` is the optimum.

The result of step 2 is `y_seed` such that `y_seed ≈ 1/√n` with about **3.5 correct mantissa bits**.

### Step 3 — bit cast back

Reinterpret the integer `i` as a float. We're back to a `float` that holds a rough estimate of `1/√n`.

### Step 4 — the Newton refinement

Apply one Newton iteration to `f(y) = 1/y² − n = 0`:

```
f(y)  = 1/y² − n
f'(y) = −2/y³
y_new = y − (1/y² − n)/(−2/y³)
      = y + (y/2)(1 − n·y²)
      = y · (1.5 − 0.5·n·y²)
```

In code: `y * (1.5 - x2 * y * y)` where `x2 = 0.5 * number`. One multiply for `y*y`, one for `x2*y²`, one subtract from 1.5, one final multiply. **Four FLOPs.**

After this step: `y_refined` has ~7 correct bits — enough for 1999 lighting.

### Why one iteration was enough

The Quake renderer normalizes vectors for lighting at 30–60 FPS. Visual accuracy needs ~6 bits — a 1-in-64 vector-length error is invisible on a 320×240 screen. The two-step variant (commented out in the original code) gives ~14 bits — overkill for graphics.

### The legacy

The trick became famous because it was **2–3× faster** than the standard library's `sqrt` on 1999 hardware. On modern CPUs with hardware `RSQRTSS`, the magic-constant version is no longer faster — `RSQRTSS` returns 12 correct bits in one cycle. But the **idea** lives on: bit-level seed + Newton refinement is the universal recipe for fast transcendental functions on hardware without dedicated units.

For more depth: Lomont's paper, the Beyond3D forums archives, and Carmack's own .plan files from 2000 explain the history.

---

<a name="stats"></a>
## 4. Newton in Statistical Solvers — IRLS, MLE

### Logistic regression — IRLS

Logistic regression fits a model `p = σ(Xβ)` by maximizing the log-likelihood:

```
L(β) = Σᵢ [yᵢ · log pᵢ + (1 − yᵢ) · log(1 − pᵢ)]
```

`β̂` satisfies `∇L(β) = 0`. Newton on `∇L`:

```
β_new = β − [∇²L(β)]⁻¹ · ∇L(β)
```

The Hessian is `−Xᵀ W X` where `W` is a diagonal weight matrix with entries `pᵢ(1 − pᵢ)`. The gradient is `Xᵀ(y − p)`. Plugging in:

```
β_new = β + (XᵀWX)⁻¹ · Xᵀ(y − p)
      = (XᵀWX)⁻¹ · XᵀW · z   (where z = Xβ + W⁻¹(y − p))
```

This is exactly a **weighted least squares solve**, with weights changing each iteration. Hence **IRLS** — *Iteratively Reweighted Least Squares*. It is Newton's method, just written in a way that exposes a nice linear-algebra structure.

### Why IRLS is the gold standard

- **Converges in 5–10 iterations** (quadratic in the basin).
- Each iteration is a single linear solve — handled by `LAPACK`'s `dgesv`.
- For sparse `X`, use Cholesky on `XᵀWX`.
- Numerical stability is rock-solid: `XᵀWX` is positive-definite.
- Generalizes to all GLMs: Poisson, gamma, negative binomial — the only thing that changes is the weight formula.

### Who uses IRLS

- **R**: `glm()` uses IRLS by default.
- **Python**: `statsmodels.GLM`, scikit-learn's `LogisticRegression(solver='liblinear')` and `'newton-cg'`.
- **SAS**: `PROC LOGISTIC` and `PROC GENMOD`.
- **Stata**: `logit` command.
- **Spark**: `pyspark.ml.classification.LogisticRegression`, for distributed variants.

For deep-net-scale logistic regression (millions of features), IRLS becomes infeasible (the `XᵀWX` matrix is too large), and L-BFGS or stochastic methods take over.

### MLE for arbitrary distributions

For maximum likelihood with no closed form, **Newton on the score equation** is the textbook recipe:

1. Define log-likelihood `L(θ)`.
2. Compute **score** `U(θ) = ∂L/∂θ` (gradient).
3. Compute **observed information** `I(θ) = −∂²L/∂θ²` (negative Hessian).
4. Iterate `θ_new = θ + I(θ)⁻¹ · U(θ)`.

Variants: **Fisher scoring** replaces observed information with expected information (often easier to compute, equally valid asymptotically). **EM algorithm** uses Newton implicitly in the M-step for many distributions.

### Numerical caveats

- Hessian must be positive-definite for the step to be a descent direction. In practice: if not, **regularize** (`H ← H + λI`) — Levenberg–Marquardt.
- Singular Hessian → use a pseudo-inverse or a damped step.
- For high-dim: store and factor `H` once per iteration; don't form `H⁻¹` explicitly.

---

<a name="optimization"></a>
## 5. Newton in Optimization — Interior-Point, Levenberg–Marquardt

### Interior-point methods for LP / QP / SDP

Linear programming, quadratic programming, and semidefinite programming are all solved in production by **interior-point methods** — and every interior-point method is fundamentally a sequence of Newton solves.

The setup: minimize `cᵀx` subject to `Ax = b`, `x ≥ 0`. The interior-point trick adds a logarithmic **barrier** to enforce `x ≥ 0`:

```
min  cᵀx − μ · Σᵢ log(xᵢ)   subject to Ax = b
```

For each fixed `μ`, this is a smooth, **strictly convex** optimization. Solve it with Newton — KKT conditions become a linear system, which Newton solves in 1 step. Then **decrease `μ`** and re-solve, repeating until `μ → 0`. The path of solutions is the **central path**.

This is how:
- **CPLEX** (IBM), **Gurobi**, **MOSEK** solve LPs.
- **OSQP** solves QPs for model-predictive control.
- **SDPT3** / **SeDuMi** solve SDPs for robust control and machine learning.

Each "barrier iteration" is one Newton step. Total: 30–80 Newton solves for a 10-million-variable LP. The Newton steps themselves are large sparse linear solves — the entire interior-point performance is dominated by sparse Cholesky.

### Levenberg–Marquardt for nonlinear least squares

Fitting nonlinear models `y ≈ m(x; θ)` to data minimizes the sum of squared residuals:

```
S(θ) = Σᵢ (yᵢ − m(xᵢ; θ))²
```

Gauss-Newton applies Newton to `S` and approximates the Hessian by `Jᵀ J` (where `J` is the Jacobian of residuals). This is Newton-flavored without computing second derivatives — works because the residuals are "small" near the optimum.

```
θ_new = θ + (JᵀJ)⁻¹ · Jᵀ · r
```

But Gauss-Newton blows up when `JᵀJ` is singular. **Levenberg–Marquardt** damps it:

```
θ_new = θ + (JᵀJ + λI)⁻¹ · Jᵀ · r
```

`λ` is adapted dynamically — large when far from optimum (effectively gradient descent), small when close (effectively Gauss-Newton with quadratic convergence). It's "damped Newton with a trust region".

Production uses:
- **MINPACK** (Fortran, 1980, still used). The `lmder` routine.
- **SciPy**: `scipy.optimize.least_squares(method='lm')`.
- **Ceres Solver** (Google) — used for Google Street View, photogrammetry, robot SLAM. Levenberg-Marquardt with custom step strategies.
- **g2o** for SLAM (visual-inertial odometry) — every smartphone AR session.
- **Bundle adjustment** in computer vision — 3D reconstruction from photos.

### Trust-region methods — the modern paradigm

Trust-region Newton replaces "take the full Newton step" with "solve a quadratic model within a small region around `x`". If the model agrees with `f`, expand the region; if not, shrink and try a smaller step. This handles non-convexity, indefinite Hessians, and bad seeds — all in a unified framework.

Implementations:
- `scipy.optimize.minimize(method='trust-ncg')`
- `scipy.optimize.minimize(method='trust-krylov')`
- KNITRO (commercial)
- IPOPT (open-source)

All of them are **Newton at heart**, with sophistications to handle the edge cases that vanilla Newton can't.

---

<a name="production"></a>
## 6. Production Safeguards — When Newton Goes Wrong in the Real World

After 50 years of numerical software, the community has accumulated war stories. Here are the patterns every senior engineer should know.

### 6.1 The "great seed, bad function" failure

Story: a SciPy user fits a hazard rate model. The likelihood has two local maxima. Newton converges from `θ_0 = 1.0` to a bad local maximum — not the true MLE. The fit looks "successful" (Newton converged in 6 iterations) but the parameters are wrong.

**Mitigation:** Run Newton from **multiple seeds**; verify the answers agree. Use **basin-hopping** (`scipy.optimize.basinhopping`) for multimodal landscapes. Always plot the likelihood surface when feasible.

### 6.2 Floating-point exception storms

Story: a physics simulation uses Newton to find the equilibrium of a stiff ODE. One particle's position explodes to `1e308`, the Newton step computes `f(1e308)` which is `inf`, the next iterate becomes `NaN`, and **every subsequent computation is `NaN`** until the program eventually displays "energy = NaN" three hours into the run.

**Mitigation:** Trap floating-point exceptions (`feenableexcept(FE_DIVBYZERO | FE_INVALID | FE_OVERFLOW)` in C, `np.errstate(divide='raise', invalid='raise')` in Python). Validate iterate magnitudes. **Reset** to a safe seed if `NaN` detected.

### 6.3 The "convergence too slow" rabbit hole

Story: a logistic regression on 100 features takes 200 IRLS iterations to converge (should take ~10). After two days of debugging: the data has a **separating hyperplane** — perfect classification — and the MLE is at infinity. Newton tries to chase it.

**Mitigation:** Detect separability before fitting. Use a **prior** / **regularization** (`L2`, ridge) to bound the MLE. Modern `LogisticRegression` defaults to `C = 1.0` regularization for this reason.

### 6.4 The unstable Hessian

Story: a portfolio optimization uses Newton with the Hessian of a quadratic form. The Hessian is computed by summing products of returns. Catastrophic cancellation in the sum makes the Hessian **indefinite** when it should be positive definite. Newton steps in the wrong direction; portfolio weights go negative; "you lost $200 million" email at 4 AM.

**Mitigation:** Compute the Hessian in **higher precision** (`long double` or compensated summation). Add a small `λI` (regularization). Verify positive-definiteness via Cholesky factor — if it fails, your Hessian is broken.

### 6.5 Newton converges to a non-root

Story: an iteration runs `x' = x − f(x)/f'(x)` with a bug — `f'` is computed numerically with a step size `h` that's **too small**, causing cancellation in `(f(x+h) − f(x−h))/(2h)`. The derivative estimate is noisy garbage. Newton converges to a point that **isn't a root** — `|f(x_final)|` is `1e-5`, not `1e-15`. The convergence test (`|Δx| < eps`) passes anyway because of the noisy gradient.

**Mitigation:** **Always test the residual `f(x_final)`**, not just the step size. If `|f(x_final)|` is large, the iteration failed even though it "converged".

### 6.6 The clever inline that broke Newton

Story: a compiler with `-O3 -ffast-math` reorders `y * (1.5 - 0.5 * x * y * y)` to `y * 1.5 - 0.5 * x * y * y * y`. Mathematically identical, but **numerically different** by 1 ULP. Newton's quadratic convergence depends on **bit-exact** intermediate values. The "optimized" version oscillates by 1 ULP near the root and never satisfies the convergence test.

**Mitigation:** **Avoid `-ffast-math`** in numerical kernels. Use **fused multiply-add** (`fma`) for critical updates: `fma(-0.5 * x, y * y, 1.5)` is both more accurate and prevents reassociation.

### 6.7 Newton's fractal: the basin shifted under your feet

Story: a robotics inverse-kinematics solver uses Newton. The seed is "the previous joint angles". A new motion plan moves the end-effector across a singularity; the previous angles are now in a **different basin of attraction**. Newton converges to a configuration where the elbow is on the wrong side. Robot arm crashes into the cup it was supposed to grab.

**Mitigation:** Detect basin boundaries — if `|Δθ| > π/2` in a single step, the seed is in the wrong basin. **Re-seed** with a known-safe starting pose. Use damped Newton to "drag" the seed across the boundary.

### The senior takeaway

Newton's method is **not** a black box. It is a careful arrangement of:
- A good seed.
- A correct derivative.
- A correct stopping criterion (step + residual + iteration cap).
- A fallback when any of the above fail.

When you ship Newton's method to production, you ship those four things together. The 5-line Python `while` loop you saw in `junior.md` becomes the 300-line `scipy.optimize._minpack_py.py` because all four corners get hardening, telemetry, and recovery logic.

---

## Closing Thoughts

Newton's method is **infrastructure**, not an algorithm. Every CPU's division unit, every game engine's vector normalize, every logistic regression fit, every interior-point LP solve, every nonlinear curve fit goes through a Newton iteration. The math is 350 years old (Newton 1669, Raphson 1690, Simpson 1740 in modern form); the engineering of "how do you make it actually work in production" is ongoing.

The senior-level takeaway: when you're choosing a numerical method, ask **"can I apply Newton?"** If yes — closed-form derivative, decent seed, in-the-basin — nothing else competes on speed. If no — multimodal, noisy, indefinite Hessian — fall back to Brent / trust-region / Levenberg–Marquardt, all of which are **Newton at heart with safeguards**.

---

## Further Reading

- **Goldschmidt**, *Applications of Division by Convergence* (M.S. thesis, MIT, 1964) — the original division-by-Newton paper for hardware.
- **Lomont**, "Fast Inverse Square Root" (2003) — the definitive `0x5f3759df` analysis. Available at lomont.org.
- **Boyd & Vandenberghe**, *Convex Optimization* (2004), Chapter 9 ("Unconstrained Minimization"). The textbook on Newton in optimization.
- **Wright**, *Primal-Dual Interior-Point Methods* (1997). The interior-point bible.
- **Nocedal & Wright**, *Numerical Optimization* (2nd ed., 2006). Levenberg-Marquardt, trust-region Newton, BFGS.
- **Press et al.**, *Numerical Recipes*, §9.4 (`rtsafe`) and §10.7 (Levenberg-Marquardt). Practical, production-tested code.
- **OpenJDK fdlibm source** (`src/java.base/share/native/libfdlibm/e_sqrt.c`) — read it; the comments are gold.
- **Intel Architecture Reference Manual**, Vol. 1, §3.7.6 — Goldschmidt division microcode flow.
- Continue with `professional.md` for the formal quadratic convergence proof, basin-of-attraction analysis, and the Kantorovich theorem.
