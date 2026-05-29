# Ternary Search — Senior Level

> **Audience:** Engineers who design systems that include online optimization, control loops, autotuning, or geometric algorithms. Prerequisites: `junior.md`, `middle.md`.

This document treats ternary search not as an interview problem but as a **production primitive** for unimodal optimization. We cover where the idea actually appears: camera autofocus, audio AGC, PID and similar control-system tuning, robotics trajectory smoothing, computational geometry (closest point on a convex polygon, "minimum enclosing circle" sub-step), peak finding in time-series anomaly detection, and competitive programming patterns that derive from these. We also discuss when *not* to use it and what tends to replace it in mature production systems.

---

## Table of Contents

1. [Autofocus and Auto-Exposure in Cameras](#autofocus)
2. [Control-System Tuning: PID and Gain Scheduling](#control-tuning)
3. [Robotics Trajectory Smoothing](#robotics)
4. [Computational Geometry — Closest Point on a Convex Curve](#geometry)
5. [Peak Finding in Time-Series Monitoring](#peak-finding)
6. [Competitive Programming Patterns](#cp-patterns)
7. [When Ternary Search Loses in Production](#loses)

---

<a name="autofocus"></a>
## 1. Autofocus and Auto-Exposure in Cameras

Modern digital cameras and smartphones contain a **contrast-detection autofocus** that finds the lens position maximizing image sharpness. Sharpness is computed as a high-pass energy metric (sum of squared differences between adjacent pixels, or a Laplacian-based measure). As the focus motor moves through its range, sharpness **increases, peaks at the in-focus position, then decreases** — the classic unimodal shape.

### 1.1 Why ternary-style search

Each "evaluation" costs a focus-motor step, a sensor read, and an image processing pass — typically 10–50 ms. Reading the entire focus range linearly would take seconds. A few binary-style probes find the peak in 100–200 ms, which is the "fast autofocus" experience users expect.

The actual algorithm is rarely textbook ternary; production code uses a **hybrid**:
1. Coarse "hill climbing" — move the motor a fixed step, sample sharpness, decide direction.
2. Once a peak is bracketed, switch to **golden-section search** to home in on the peak with minimal evaluations.
3. Validate by reading one more sample on each side.

Phase-detection autofocus (PDAF) skips this — it reads phase difference between two sub-pixels and computes the lens-position correction directly. PDAF is faster but more expensive in sensor real estate; contrast-detection (with golden-section underneath) remains the universal fallback.

### 1.2 Auto-exposure analogue

Auto-exposure picks the camera's shutter speed / ISO / aperture combination that maximizes a quality metric (avoiding clipped highlights, retaining shadow detail). The metric is empirically unimodal in exposure value (EV). The same hybrid hill-climb + golden-section pattern applies.

### 1.3 Real implementation note: noise tolerance

A single sharpness reading is noisy (sensor noise, hand shake, scene motion). Production autofocus averages 2–3 readings per probe, and uses a **noise gate**: if `|f(m1) - f(m2)| < noise_threshold`, treat as equal and tie-break with motor-position bias toward the previous best. This is essential — naive ternary on noisy data converges to random places.

---

<a name="control-tuning"></a>
## 2. Control-System Tuning: PID and Gain Scheduling

A **PID controller** has three gains (`Kp`, `Ki`, `Kd`) that determine its response speed and stability. Tuning them is the bane of control engineering. For many systems, performance metrics like "settling time" or "overshoot" are **unimodal** in each gain over a useful range — too low is sluggish, too high oscillates.

### 2.1 The autotuning loop

A common production pattern:
1. Fix two of the three gains at heuristic values (Ziegler-Nichols).
2. **Ternary-search the third** over a bounded range, using a step-response test as the cost function.
3. Pick the optimum, then iterate over the next gain.
4. Optionally repeat the cycle ("coordinate descent" on gains).

Each "cost evaluation" runs a fixed test pattern through the system and measures settling time or integral absolute error (IAE). Often ~5 seconds per evaluation. With ~30 ternary iterations per gain and 3 gains, **autotuning takes a few minutes** — acceptable for offline calibration of robots, motors, and HVAC controllers.

### 2.2 Gain scheduling

In systems whose dynamics change with operating point (e.g., a robot arm whose inertia depends on load), gains are stored as a **lookup table over operating points** and interpolated. Each entry in the table is tuned with ternary search at that operating point. The table is rebuilt periodically or whenever a major load change is detected.

### 2.3 Why not gradient descent?

For 1-D gain tuning, the "function" is a black-box hardware response. You do not have a closed-form gradient. Numerical gradients require differencing two close evaluations, which on noisy hardware is unreliable. Ternary search is **derivative-free** and noise-tolerant (with the smoothing tricks from §1.3) — a better fit than gradient methods.

When gradients ARE available — e.g., model-based control where you have a simulation that emits derivatives — Newton-type methods take over.

---

<a name="robotics"></a>
## 3. Robotics Trajectory Smoothing

A robot arm following a planned trajectory must avoid jerks (abrupt acceleration changes). Trajectory smoothing parameterizes the trajectory's "smoothness factor" (e.g., the time scaling of a Bezier curve) and minimizes a cost like `max(jerk) + λ × tracking_error`. The cost is often **unimodal in the smoothness parameter** — too rigid, max jerk too high; too smooth, tracking error too high; one sweet spot in between.

### 3.1 Online optimization

In real-time motion planning, a quadratic-program (QP) solver re-runs each control cycle. The smoothness parameter cannot be re-tuned in microseconds, so it is **set offline by ternary search** on representative trajectories and held fixed online.

For *online* parameter tuning of slowly-changing quantities (e.g., wheel-slip coefficient on changing terrain), some systems run a low-rate ternary search in the background, updating the parameter every few seconds.

### 3.2 Inverse kinematics

For some redundant manipulators (more joints than task DOF), the choice of "elbow position" is parameterized by an angle `θ`, and the cost (joint-limit violation, singularity proximity, energy) is unimodal in `θ`. Ternary search picks the optimum for each waypoint.

This is closely related to:

---

<a name="geometry"></a>
## 4. Computational Geometry — Closest Point on a Convex Curve

### 4.1 Closest point on a parabola

Given a parabola `y = x²` and a query point `P = (a, b)`, the squared distance from `P` to `(t, t²)` is:

```
d²(t) = (t - a)² + (t² - b)²
```

`d²(t)` is **unimodal in `t`** (it tends to `+∞` as `|t| → ∞` and has a single minimum). Solve analytically: `d/dt d²(t) = 0` ⇒ cubic equation — closed-form via Cardano but ugly. **Ternary search** finds the minimum in 60–100 iterations to floating-point precision, without the cubic.

```python
def closest_on_parabola(a, b):
    def d2(t):
        return (t - a) ** 2 + (t * t - b) ** 2
    lo, hi = -1e9, 1e9
    # Coarse pass: bracket the minimum
    if b > 0:
        lo, hi = -2 * max(abs(a), abs(b) ** 0.5), 2 * max(abs(a), abs(b) ** 0.5)
    else:
        lo, hi = -2 * max(1.0, abs(a)), 2 * max(1.0, abs(a))
    for _ in range(200):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if d2(m1) > d2(m2):
            lo = m1
        else:
            hi = m2
    t = (lo + hi) / 2
    return t, t * t
```

This pattern generalizes to **closest point on any convex curve** that is parameterized in 1-D and convex in the parameter.

### 4.2 Closest point on a convex polygon

A convex polygon's perimeter, parameterized by arc length, has unimodal distance from any external point. Ternary-search the arc length to find the closest point. Run-time `O(log n)` after O(1) per polygon (the unimodality direction depends on which edge contains the projection — handle the wrap-around).

### 4.3 Minimum enclosing circle — Welzl's randomized algorithm

Welzl's classical algorithm doesn't use ternary search directly, but the **sub-routine** "smallest enclosing circle containing 2 fixed points and another from a set" reduces to a 1-D optimization that is unimodal in the parameter "where on the chord-perpendicular bisector to place the center". Ternary search is a clean way to handle it.

### 4.4 Visibility polygons and ray casting

In some 2D visibility problems, the function "fraction of a target visible from observer position along a 1-D path" is unimodal. Ternary search finds the maximum-visibility point. Used in game AI for line-of-sight reasoning.

---

<a name="peak-finding"></a>
## 5. Peak Finding in Time-Series Monitoring

Monitoring systems (Prometheus, Datadog, New Relic) sometimes need to locate **peaks** in metric time-series — the maximum CPU utilization in the last hour, the highest latency spike, the deepest queue. If the time-series window is **known to be unimodal** (e.g., a daily traffic cycle has one rush hour peak), ternary search finds the peak in O(log n) samples instead of O(n).

### 5.1 The data assumption

Most real-world time series are **multimodal** — a CPU graph has spikes from cron jobs, deploys, traffic bursts. **Do not blindly use ternary search.** It applies only when domain knowledge guarantees unimodality.

Examples where unimodality is reasonable:
- **Diurnal traffic patterns** with a single daily peak.
- **A controlled stress test** with a single ramp-up and ramp-down.
- **A trajectory of a single physical event** (a packet's round-trip latency through a measured path).

In each case, "unimodal" is a model, not a guarantee. Add sanity checks (verify that the surrounding values are monotonic).

### 5.2 Hybrid: bracket then ternary

A robust production pattern:
1. **Coarse sampling.** Sample the time-series at `K` equally-spaced points (`K = 10–20`).
2. **Verify** there is exactly one "peak shape" in the samples (a single direction-change).
3. **Bracket** the peak by the two coarse samples adjacent to the maximum.
4. **Ternary-search** within the bracket for the precise peak time.

This combines the safety of coarse scanning with the efficiency of ternary.

### 5.3 Anomaly detection on convex sub-windows

For a window known to be convex (e.g., the latency rise during a known-good deploy validation), a ternary search on the convex region finds the maximum-error point — useful for "when did the regression first appear" debugging.

---

<a name="cp-patterns"></a>
## 6. Competitive Programming Patterns

Beyond textbook problems, ternary search powers a few recurring competitive-programming patterns. Knowing them saves debugging time.

### 6.1 "Minimize the maximum" with a unimodal parameter

Classic setup: place `k` items along a range to minimize the maximum gap, but the "max gap" cost function in the placement parameter is **bitonic** (decreasing then increasing). Ternary search the parameter.

### 6.2 "Function of two unimodal functions"

If `g(x) = f₁(x) + f₂(x)` where both `f₁` and `f₂` are unimodal with the same peak direction (both maxima or both minima), then `g` is unimodal too. Ternary works.

If `f₁` is unimodal with a max and `f₂` is unimodal with a min, then `g = f₁ - f₂` is unimodal with a max. (Easy to forget — sketch first!)

### 6.3 "Sum of distances to a moving point"

`f(t) = ∑ᵢ dist(point_i, p(t))` where `p(t)` moves along a line. Each `distᵢ(t)` is convex; the sum of convex functions is convex; ternary search the minimum.

### 6.4 Geometric mean / "fairness" optimization

`f(x) = √(g₁(x) × g₂(x))` where both `g₁` and `g₂` are convex with the same minimizer is also convex; ternary works.

### 6.5 Game-theory equilibria

In some pursuit-evasion games and minimax problems, the value function `V(strategy_parameter)` is convex on the strategy space. Ternary search picks the optimal mixed strategy.

### 6.6 Beware: "looks unimodal" isn't unimodal

In contests, many wrong-answer submissions come from applying ternary search to a function that **looks** unimodal on the sample inputs but isn't in general. Always sketch or verify analytically. When unsure, fall back to `O(n)` scan and submit; correctness beats elegance.

---

<a name="loses"></a>
## 7. When Ternary Search Loses in Production

Knowing where ternary search fails saves you from using it where binary, gradient, or grid would be better.

### 7.1 Anywhere binary search applies

Sorted-array lookup, parametric "feasible / infeasible" predicate searches, `lower_bound`/`upper_bound` queries — binary search wins on every metric. Use ternary only when the function is unimodal, not when it's monotonic.

### 7.2 Multimodal functions

Most real-world cost functions have multiple local optima. ML loss landscapes, route planning with congestion, scheduling under hard constraints — all multimodal. Ternary converges to *some* local optimum, often the wrong one. Use simulated annealing, genetic algorithms, Bayesian optimization, or basin hopping instead.

### 7.3 Noisy evaluations

If `f` has random noise of magnitude comparable to its "useful" range near the peak, two probes can flip from one iteration to the next, sending ternary the wrong direction. Either smooth the function (average many samples per probe) or use a noise-tolerant optimizer.

### 7.4 Discontinuous functions

A function with discontinuities (a jump at some `x`) is not strictly unimodal even if its envelope looks so. Examples: cost functions with hard constraints (`max(0, ...)` clipping), integer-valued cost functions, anything piecewise.

### 7.5 High-dimensional spaces

Nested ternary scales as `O(log^k n)` for `k` dimensions. Beyond `k = 3` it's slow; beyond `k = 5` it's infeasible. Gradient-based or Bayesian methods are the right tools for high-D.

### 7.6 When you have derivatives

If `f'(x)` is cheap, **bisect `f'` for zero** instead of ternary searching `f` for argmax. Same shrink rate as binary search, half the function calls of ternary.

### 7.7 When `f` is monotonic, not unimodal

Sometimes you're given "find where `f(x) = T` for some target `T`" and the function is monotonic. That is binary search territory; ternary search would just waste comparisons.

### 7.8 Real-time constraints with tight microsecond budgets

In hard real-time systems (motor controllers running at 10 kHz), even golden-section's 30–50 function evaluations per re-tune may exceed the budget. Cache the answer, or pre-tune offline, or use a closed-form approximation. Don't ternary-search inside a fast control loop.

---

## Closing Thoughts

Ternary search is the **gold standard for derivative-free 1-D unimodal optimization** when `f` is cheap and you have no other structure to exploit. It is what you reach for when:

- The problem is unimodal,
- You don't have derivatives,
- 1-D parameter space,
- Function evaluations are not the bottleneck.

When any of those constraints fail, a different tool wins:
- Have derivative? Bisect `f'`, then maybe Newton.
- High-D? Gradient methods or Bayesian opt.
- Expensive `f`? Golden-section instead of ternary; Bayesian opt for very expensive.
- Multimodal? Global optimizers.

Inside that niche, ternary search is foundational — and you'll find variants of it in every camera autofocus, every PID autotuner, every closest-point-on-curve algorithm in computational geometry.

---

## Further Reading

- **Brent**, *Algorithms for Minimization Without Derivatives* (1973). Chapter 5 covers golden-section, Brent's hybrid method (used in scipy's default 1-D minimizer), and the theoretical optimality of golden-section among derivative-free methods.
- **Kushner & Yin**, *Stochastic Approximation and Recursive Algorithms* — for the noise-tolerant variants used in autofocus and adaptive control.
- **De Berg et al.**, *Computational Geometry: Algorithms and Applications*, 3rd ed. — convex-curve closest-point algorithms.
- **Boyd & Vandenberghe**, *Convex Optimization* — Chapter 9 covers 1-D line searches, including their role inside multi-D Newton-type methods.
- **PostgreSQL** doesn't use ternary search anywhere I know of — but **SciPy** does in `scipy.optimize.minimize_scalar(method='golden')`. Skim the source; it's clean.
- **OpenCV** autofocus implementations (open-source). Search for `contrast_detection` + `golden_section`.
- Continue with `professional.md` for the formal complexity proofs, comparison with Fibonacci search, and the information-theoretic lower bound for derivative-free unimodal optimization.
