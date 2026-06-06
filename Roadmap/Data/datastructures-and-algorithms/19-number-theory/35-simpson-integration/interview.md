# Simpson's Rule and Numerical Integration — Interview Preparation

Numerical integration is a favourite for roles touching quantitative work, graphics, physics, scientific computing, and competitive programming. The high-leverage insight interviewers probe: *"You approximate an integral by slicing `[a,b]` and fitting simple shapes; the trapezoid uses lines (`O(h^2)`), Simpson uses parabolas (`O(h^4)`), and adaptive Simpson refines only where its own error estimate `|S2−S|/15` is still too large."* They want to see that you can (a) write the composite Simpson formula correctly, (b) reason about *error order* and *degree of precision*, (c) implement and justify **adaptive Simpson**, and (d) know the failure modes (singularities, oscillation) and when Gaussian quadrature or a library is the right call. This file is a tiered question bank plus an end-to-end coding challenge in Go, Java, and Python.

---

## Quick-Reference Cheat Sheet

| Question | Answer | Complexity / Error |
|----------|--------|--------------------|
| Composite Simpson formula | `(h/3)[f0 + 4f1 + 2f2 + ... + 4f_{n-1} + fn]` | `O(n)` evals, error `O(h^4)` |
| Coefficient pattern | endpoints 1, odd 4, even-interior 2 | — |
| Constraint on `n` | must be **even** | — |
| Step size | `h = (b−a)/n` | — |
| Trapezoid error | `−(b−a)h^2 f''(ξ)/12` | `O(h^2)` |
| Simpson error | `−(b−a)h^4 f''''(ξ)/180` | `O(h^4)` |
| Degree of precision | trapezoid 1, midpoint 1, Simpson 3 | Simpson exact for cubics |
| Adaptive criterion | accept if `|S2 − S| < 15ε` | error of `S2 ≈ (S2−S)/15` |
| Simpson from trapezoid | `(4T(h/2) − T(h))/3` | Richardson, kills `h^2` term |
| Gauss `n`-point | exact to degree `2n−1` | optimal node placement |

Skeleton to memorize:

```text
simpson(f, a, b, n):    # n even, h=(b-a)/n
    s = f(a) + f(b)
    for i in 1..n-1: s += (i odd ? 4 : 2) * f(a + i*h)
    return s * h / 3
```

Key facts:
- **Simpson = parabola through 3 points;** trapezoid = line through 2.
- **`n` must be even** (pairs of strips form panels).
- **Error `O(h^4)`:** halve `h` → error /16 (vs trapezoid /4).
- **Degree of precision 3:** exact for any cubic, from a symmetry bonus.
- **Adaptive Simpson** uses `|S(whole) − S(left) − S(right)| < 15ε` and returns `S2 + (S2−S)/15`.
- **Gaussian quadrature** beats Simpson per evaluation on smooth `f`; libraries use Gauss–Kronrod.

---

## Junior Questions (14 Q&A)

### J1. What is numerical integration?
Estimating a definite integral `∫_a^b f(x) dx` (the signed area under the curve) by sampling `f` at chosen points and combining the values, used when `f` has no closed-form antiderivative or you only have sampled data.

### J2. What is the trapezoidal rule?
Approximate each slice of width `h` by a straight line (a trapezoid). Composite form: `(h/2)[f0 + 2f1 + ... + 2f_{n-1} + fn]`. Error `O(h^2)`.

### J3. What is Simpson's 1/3 rule?
Approximate each *pair* of slices by a parabola through three points. Basic form: `(h/3)(f0 + 4f1 + f2)`. Composite: `(h/3)[f0 + 4f1 + 2f2 + ... + 4f_{n-1} + fn]`.

### J4. What is the coefficient pattern in composite Simpson?
`1, 4, 2, 4, 2, ..., 4, 1`: endpoints weight 1, odd-index interior points weight 4, even-index interior points weight 2 — all times `h/3`.

### J5. Why does `n` have to be even for Simpson?
Because each parabola panel spans two subintervals; you need `n/2` whole panels, which requires `n` even. An odd `n` leaves a leftover half-panel that breaks the pattern.

### J6. What is `h`?
The step size, `h = (b − a)/n`. Smaller `h` (more slices) means a more accurate estimate.

### J7. Why is a parabola better than a straight line?
A straight line cannot bend, so it cuts corners wherever `f` curves. A parabola bends to follow the curvature, fitting a smooth `f` far more closely.

### J8. What is the error order of Simpson vs trapezoid?
Simpson is `O(h^4)`, trapezoid is `O(h^2)`. Halving `h` cuts Simpson's error by 16 but the trapezoid's by only 4.

### J9. What's a common implementation bug?
Multiplying by `h/2` (the trapezoid factor) instead of `h/3` (Simpson's), or swapping the 4 and 2 coefficients.

### J10. How many function evaluations does composite Simpson need?
`n + 1` evaluations (at `x_0` through `x_n`). The cost is `O(n)`, dominated by the function calls.

### J11. Can the integral be negative?
Yes — area below the x-axis counts as negative. The integral is *signed* area, so it can be negative or zero.

### J12. What is the midpoint rule?
Approximate each slice by a rectangle whose height is `f` at the slice midpoint: `h·Σ f(midpoint_i)`. Error `O(h^2)`; it never samples the endpoints.

### J13. Give an example where you'd need numerical integration.
`∫_0^1 e^(-x^2) dx` — the bell curve has no elementary antiderivative, so you cannot evaluate it symbolically; Simpson gives a fast accurate estimate (≈ 0.7468).

### J14 (analysis). If `n = 2`, what does composite Simpson reduce to?
Exactly one basic Simpson panel: `(h/3)(f0 + 4f1 + f2)` with `h = (b−a)/2`, which equals `((b−a)/6)(f(a) + 4f((a+b)/2) + f(b))`.

---

## Middle Questions (14 Q&A)

### M1. Write the Simpson error formula and explain each factor.
`I − S_n = −((b−a)/180) h^4 f''''(ξ)` for some `ξ ∈ (a,b)`. `(b−a)` is interval length, `h^4` is what you control, `f''''(ξ)` measures how non-cubic `f` is, `1/180` is the rule's constant.

### M2. What is "degree of precision" and what is Simpson's?
The highest-degree polynomial the rule integrates exactly. Simpson's is **3** — it nails every cubic, even though it interpolates with a parabola.

### M3. Why is Simpson exact for cubics?
Its error term is proportional to `f''''`, and the fourth derivative of any cubic is zero. Equivalently, the rule's symmetry makes it integrate odd functions (like `x^3` about the midpoint) exactly.

### M4. How is Simpson related to the trapezoid via Richardson extrapolation?
`Simpson = (4·T(h/2) − T(h))/3`. The trapezoid error is `c·h^2 + ...`; this combination cancels the `h^2` term, leaving `O(h^4)` — that combination *is* composite Simpson.

### M5. What is adaptive Simpson?
A method that recursively bisects a panel only when its own error estimate is too large, concentrating function evaluations where `f` is hard (sharp curvature) and using few where `f` is flat.

### M6. State and justify the adaptive acceptance criterion.
Accept when `|S(a,m) + S(m,b) − S(a,b)| < 15ε`. Because Simpson's error scales as `h^4`, bisecting cuts the error 16×, so the gap `S2 − S ≈ 15·(error of S2)`; the error of `S2` is therefore `(S2 − S)/15`.

### M7. Why the factor 15?
`15 = 2^4 − 1`, the drop ratio for an order-4 method on bisection. An adaptive trapezoid (order 2) would use `2^2 − 1 = 3`; Boole (order 6) would use `63`.

### M8. What does adaptive Simpson return after accepting?
`S2 + (S2 − S)/15` — adding the estimated error back (Richardson correction) yields an `O(h^6)` estimate essentially for free.

### M9. How do you guarantee the *global* error in adaptive Simpson?
Give each half tolerance `ε/2` when recursing, so the per-leaf tolerances sum to `ε`; by the triangle inequality the total error is bounded by `ε`.

### M10. When does adaptive Simpson fail to terminate, and how do you prevent it?
On a discontinuity the criterion can never be met. Prevent runaway recursion with a depth cap and/or a minimum panel width; return the best estimate at the cap with a warning.

### M11. Compare Simpson, trapezoid, and midpoint.
All `O(n)` time. Trapezoid and midpoint are `O(h^2)` (degree 1); Simpson is `O(h^4)` (degree 3). Midpoint avoids the endpoints (good for endpoint singularities); Simpson is most accurate for smooth `f` on an even grid.

### M12. How do you choose `n` for a target accuracy?
Either a-priori from the error bound (needs a `|f''''| ≤ M` bound: `n ≥ (b−a)·((b−a)^4 M/(180·tol))^{1/4}`) or, more practically, double `n` until successive estimates agree to tolerance.

### M13. Why is `f''''` smoothness needed for the `O(h^4)` rate?
The error formula uses `f''''(ξ)`; if the fourth derivative is unbounded (e.g. near `x^{3.5}` at 0), the rate degrades below `O(h^4)`.

### M14 (analysis). Show `Simpson = (2·Midpoint + Trapezoid)/3` on one panel.
`(2M + T)/3 = (1/3)[2(b−a)f(c) + ((b−a)/2)(f(a)+f(b))] = ((b−a)/6)(f(a)+4f(c)+f(b)) = S`. The blend cancels the `−2:1` ratio of midpoint/trapezoid `f''` errors, lifting the order to 4.

---

## Senior Questions (12 Q&A)

### S1. How do you integrate a function with an endpoint singularity like `1/sqrt(x)` at 0?
Substitute it away (`x = t^2` smooths `g(x)/sqrt(x)`), use an open rule that never samples the endpoint (midpoint/Gauss), subtract the singular part, or use the tanh–sinh transform.

### S2. How do you integrate over an infinite domain like `[0, ∞)`?
Map to a finite interval: `x = t/(1-t)`, `dx = dt/(1-t)^2`, sends `t ∈ [0,1)` to `x ∈ [0,∞)`. The tanh–sinh (double-exponential) transform is the robust choice.

### S3. What goes wrong with oscillatory integrands and what fixes it?
Rapid `sin(ωx)` aliases unless `h ≲ 1/ω`, killing the `O(h^4)` rate and exploding the evaluation count. Use Filon's or Levin's method, which handle the oscillation analytically.

### S4. What's the production contract for an integrator?
Return `(value, estimated_error, evaluations, converged_flag)` — never a bare number. Honor both `epsabs` and `epsrel`, cap evaluations and recursion depth.

### S5. Why both absolute and relative tolerances?
Absolute matters when the integral is near zero (relative is meaningless there); relative matters when the integral is huge (absolute `1e-9` is absurdly tight on `1e12`). Accept if *either* is met.

### S6. What is Gaussian quadrature and why is it better than Simpson?
It chooses both nodes (Legendre roots) and weights optimally, achieving degree of precision `2n−1` from `n` nodes — double any equal-node Newton–Cotes rule. For smooth `f` with costly evaluations, it wins decisively.

### S7. What is Gauss–Kronrod and why do libraries use it?
It extends a Gauss rule with extra nodes so the Gauss-vs-Kronrod difference gives a free error estimate. It's the engine inside QUADPACK and `scipy.integrate.quad`.

### S8. When would you NOT hand-roll an integrator?
Almost always in production — use `scipy.integrate.quad`, Apache Commons Math, GSL, or Boost. They handle singularities, infinite domains, and error estimation, and are extensively validated. Hand-roll only for embedded/dependency-free contexts or a known-smooth hot loop.

### S9. How do you integrate in high dimensions?
Grid rules (Simpson, Gauss) suffer the curse of dimensionality (`n^d` nodes). Above ~4 dimensions use Monte Carlo or quasi-Monte Carlo (Sobol/Halton), with error `O(1/sqrt(N))` independent of dimension.

### S10. What limits accuracy at very small `h`?
Floating-point round-off. Once panels approach machine epsilon, `|S2 − S|` is dominated by noise; further refinement stops helping and can hurt. Clamp tolerance to a few × machine epsilon × scale.

### S11. How would you handle a discontinuity inside `[a, b]`?
Split the interval at the discontinuity so each piece is smooth; the depth cap is a backstop if you don't know where it is.

### S12. What would you monitor in a deployed integrator?
Function evaluations vs budget, max recursion depth, `estimated_error/tolerance` ratio, the `converged` flag, NaN/Inf counts, and the worst-offending subinterval for diagnostics.

---

## Professional Questions (8 Q&A)

### P1. Derive the basic Simpson error term `−(h^5/90) f''''(ξ)`.
Use the Peano kernel: since Simpson annihilates cubics, `E[f] = ∫ K(t) f''''(t) dt` with `K(t) = (1/6)E_x[(x−t)_+^3]`. `K` is single-signed on the panel, so the weighted MVT gives `E[f] = f''''(ξ)∫K = −(h^5/90)f''''(ξ)`, where `∫K = E[x^4]/4! = −1/90` on `[-1,1]`.

### P2. Derive the composite error `−((b−a)/180) h^4 f''''(ξ)`.
Sum `n/2` panel errors `−(h^5/90)f''''(ξ_j)`. Factor `−(h^5/90)(n/2)·avg(f''''(ξ_j))`; the average equals `f''''(ξ)` for some `ξ` by the IVT. With `nh = b−a` this becomes `−((b−a)/180)h^4 f''''(ξ)`.

### P3. Why does Simpson get degree of precision 3 from a degree-2 interpolant?
Symmetry: nodes/weights are symmetric about the midpoint, so the rule integrates every function odd about the center exactly — including `x^3`. Any symmetric odd-node Newton–Cotes rule gains one degree this way.

### P4. Prove `(4T(h/2) − T(h))/3` cancels the `h^2` error term.
By Euler–Maclaurin, `T(h) = I + c_1 h^2 + c_2 h^4 + ...`. Then `4T(h/2) − T(h) = 3I + (c_1 h^2 − c_1 h^2) + (c_2 h^4/4 − c_2 h^4) + ...`; dividing by 3 gives `I − (c_2/4)h^4 + O(h^6)`. The `h^2` term cancels exactly.

### P5. Why does Euler–Maclaurin matter for Romberg integration?
It shows the trapezoid error is an *even* power series in `h`. So each Richardson step kills one whole power (`h^2`, then `h^4`, ...), letting Romberg reach arbitrarily high order from trapezoid samples alone.

### P6. Fully justify the `15ε` adaptive criterion.
Let `c = I − S2`. Order-4 scaling gives `I − S ≈ 16c`. Subtract: `S2 − S = (I−S)−(I−S2) ≈ 15c`, so `c = I − S2 ≈ (S2−S)/15`. To ensure `|I − S2| ≤ ε`, require `|S2−S| ≤ 15ε`. Tolerance halving on recursion keeps `Σε_i = ε`, bounding the global error by `ε`.

### P7. Prove Gaussian quadrature reaches degree `2n−1` but not `2n`.
For `deg q ≤ 2n−1`, write `q = P_n s + r` (`deg s,r ≤ n−1`); orthogonality kills `∫P_n s`, and `q(x_i) = r(x_i)` at the Legendre roots, so the interpolatory rule is exact. For `2n`: `p = Π(x−x_i)^2 ≥ 0` has `Q[p]=0 < I[p]`, so no `n`-node rule reaches degree `2n`.

### P8. When does Simpson's advertised `O(h^4)` rate fail?
When `f ∉ C^4` (e.g. an algebraic singularity making `f''''` unbounded), or across discontinuities. The error formula's `f''''(ξ)` no longer exists/is unbounded, so the rate degrades; restore it with substitution or by splitting the interval.

---

## Rapid-Fire Round (12 short Q&A)

### R1. Simpson's coefficient on the first interior point?
4 (it's index 1, odd).

### R2. Trapezoid weight on an interior point?
2 (×`h/2`), or equivalently 1 with the `h` factored as full weight.

### R3. What's `h` for `[2, 10]` with `n = 8`?
`(10−2)/8 = 1`.

### R4. Is Simpson exact for `f(x) = 5`? For `x^2`? For `x^4`?
Yes; yes; no (degree of precision 3).

### R5. Halving `h` improves Simpson's error by what factor?
16 (= `2^4`).

### R6. Minimum `n` for composite Simpson?
2 (one panel).

### R7. Adaptive Simpson's acceptance threshold uses which constant?
15 (= `2^4 − 1`).

### R8. What does Simpson multiply the weighted sum by?
`h/3`.

### R9. Which rule never samples the endpoints?
Midpoint (and Gauss) — open rules.

### R10. Best method for a 10-dimensional integral?
Monte Carlo / quasi-Monte Carlo.

### R11. `n`-point Gauss is exact up to degree?
`2n − 1`.

### R12. What library function would you call in Python?
`scipy.integrate.quad`.

## Common Pitfalls Interviewers Test

| Pitfall | The trap | Correct response |
|---------|----------|------------------|
| `h/2` vs `h/3` | candidate writes trapezoid factor for Simpson | Simpson uses `h/3` |
| 4/2 swap | weights odd=2, even=4 | odd interior = 4, even interior = 2 |
| odd `n` | uses any `n` | Simpson 1/3 needs even `n`; use 3/8 for the odd leftover |
| `==` on floats | compares result to exact | compare within tolerance |
| ignoring singularity | runs Simpson on `1/√x` | substitute / open rule / split |
| trusting one estimate | returns without refinement | refine until converged + report error |
| hand-rolling in prod | reinvents QUADPACK | use a validated library unless constrained |

## Whiteboard Walk-Through: Deriving the (S2−S)/15 Estimate

Interviewers love asking you to *derive* the adaptive constant live. The clean four-line argument:

```text
1. Simpson error scales as h^4. S uses step H/2; S2 uses step H/4 (one bisection).
2. So  error(S) ≈ 16·error(S2).         [(H/2)^4 / (H/4)^4 = 16]
3. error(S) − error(S2) = (I−S) − (I−S2) = S2 − S ≈ 15·error(S2).
4. Therefore error(S2) ≈ (S2 − S)/15, and accept when |S2 − S| < 15·ε.
```

Say it in that order; the interviewer is checking that you understand the `16`/`15` distinction (error *ratio* vs the *difference*) and that the corrected return is `S2 + (S2−S)/15`.

## Behavioral / Discussion Prompts

- *Tell me about a time you had to trade accuracy for speed.* Frame it around choosing `n`/tolerance: enough slices for the required precision, no more, with an error estimate to justify the choice.
- *How would you debug a numerical result that's "slightly off"?* Cross-check against the trapezoid and a library oracle, test on polynomials with known integrals, watch for the `h/2`-vs-`h/3` bug and the parity of `n`.
- *How do you decide between writing your own integrator and using a library?* Default to the library (QUADPACK/`quad`) for correctness and singularity handling; hand-roll only with a hard constraint (no deps, embedded, known-smooth hot loop).

---

## Coding Challenge (3 Languages)

### Challenge: Adaptive Simpson Integrator

> Implement `integrate(f, a, b, eps)` that returns `∫_a^b f(x) dx` accurate to absolute tolerance `eps`, using **adaptive Simpson** with the `|S2 − S| < 15·eps` criterion, sample reuse, and a recursion-depth cap. It must integrate `sin` over `[0, π]` to `2.0` and `e^(-x^2)` over `[0, 1]` to `≈ 0.7468241328`.

#### Go

```go
package main

import (
	"fmt"
	"math"
)

func simp(fa, fb, fm, a, b float64) float64 {
	return (b - a) / 6 * (fa + 4*fm + fb)
}

func aux(f func(float64) float64, a, b, eps, whole, fa, fb, fm float64, depth int) float64 {
	m := (a + b) / 2
	flm, frm := f((a+m)/2), f((m+b)/2)
	left := simp(fa, fm, flm, a, m)
	right := simp(fm, fb, frm, m, b)
	if depth <= 0 || math.Abs(left+right-whole) <= 15*eps {
		return left + right + (left+right-whole)/15
	}
	return aux(f, a, m, eps/2, left, fa, fm, flm, depth-1) +
		aux(f, m, b, eps/2, right, fm, fb, frm, depth-1)
}

func integrate(f func(float64) float64, a, b, eps float64) float64 {
	m := (a + b) / 2
	fa, fb, fm := f(a), f(b), f(m)
	return aux(f, a, b, eps, simp(fa, fb, fm, a, b), fa, fb, fm, 50)
}

func main() {
	fmt.Printf("%.10f\n", integrate(math.Sin, 0, math.Pi, 1e-12))                       // 2.0000000000
	fmt.Printf("%.10f\n", integrate(func(x float64) float64 { return math.Exp(-x * x) }, 0, 1, 1e-12)) // 0.7468241328
}
```

#### Java

```java
import java.util.function.DoubleUnaryOperator;

public class AdaptiveSimpson {
    static double simp(double fa, double fb, double fm, double a, double b) {
        return (b - a) / 6 * (fa + 4 * fm + fb);
    }

    static double aux(DoubleUnaryOperator f, double a, double b, double eps,
                      double whole, double fa, double fb, double fm, int depth) {
        double m = (a + b) / 2;
        double flm = f.applyAsDouble((a + m) / 2), frm = f.applyAsDouble((m + b) / 2);
        double left = simp(fa, fm, flm, a, m), right = simp(fm, fb, frm, m, b);
        if (depth <= 0 || Math.abs(left + right - whole) <= 15 * eps) {
            return left + right + (left + right - whole) / 15;
        }
        return aux(f, a, m, eps / 2, left, fa, fm, flm, depth - 1)
             + aux(f, m, b, eps / 2, right, fm, fb, frm, depth - 1);
    }

    static double integrate(DoubleUnaryOperator f, double a, double b, double eps) {
        double m = (a + b) / 2;
        double fa = f.applyAsDouble(a), fb = f.applyAsDouble(b), fm = f.applyAsDouble(m);
        return aux(f, a, b, eps, simp(fa, fb, fm, a, b), fa, fb, fm, 50);
    }

    public static void main(String[] args) {
        System.out.printf("%.10f%n", integrate(Math::sin, 0, Math.PI, 1e-12));            // 2.0000000000
        System.out.printf("%.10f%n", integrate(x -> Math.exp(-x * x), 0, 1, 1e-12));      // 0.7468241328
    }
}
```

#### Python

```python
import math


def _simp(fa, fb, fm, a, b):
    return (b - a) / 6 * (fa + 4 * fm + fb)


def _aux(f, a, b, eps, whole, fa, fb, fm, depth):
    m = (a + b) / 2
    flm, frm = f((a + m) / 2), f((m + b) / 2)
    left = _simp(fa, fm, flm, a, m)
    right = _simp(fm, fb, frm, m, b)
    if depth <= 0 or abs(left + right - whole) <= 15 * eps:
        return left + right + (left + right - whole) / 15
    return (_aux(f, a, m, eps / 2, left, fa, fm, flm, depth - 1) +
            _aux(f, m, b, eps / 2, right, fm, fb, frm, depth - 1))


def integrate(f, a, b, eps=1e-12):
    m = (a + b) / 2
    fa, fb, fm = f(a), f(b), f(m)
    return _aux(f, a, b, eps, _simp(fa, fb, fm, a, b), fa, fb, fm, 50)


if __name__ == "__main__":
    print(f"{integrate(math.sin, 0, math.pi):.10f}")               # 2.0000000000
    print(f"{integrate(lambda x: math.exp(-x * x), 0, 1):.10f}")   # 0.7468241328
```

**Test cases:**

| `f` | `[a,b]` | Expected |
|-----|---------|----------|
| `sin x` | `[0, π]` | `2.0` |
| `e^{-x^2}` | `[0, 1]` | `0.7468241328` |
| `x^3` | `[0, 2]` | `4.0` (exact — degree 3) |
| `1/(1+x^2)` | `[0, 1]` | `π/4 ≈ 0.7853981634` |
| `4/(1+x^2)` | `[0, 1]` | `π ≈ 3.1415926536` |

**Follow-ups the interviewer may ask:**
- *Why divide by 15?* (Order-4 bisection error ratio; see M6/M7.)
- *Why reuse `fa, fb, fm`?* (Function evaluations dominate cost; each panel's three samples become its children's inputs.)
- *What if `f` has a singularity at `a`?* (Substitute, use an open rule, or split — adaptive Simpson alone will recurse to the depth cap.)
- *How would you make it return an error estimate?* (Track and sum `|left+right−whole|/15` over accepted leaves.)

### Challenge 2: Composite Simpson + Error-Order Verification

> Implement `simpson(f, a, b, n)` (composite, even `n`) and a harness that doubles `n` and prints the ratio of successive errors against a known truth. For a smooth `f`, the ratio should approach **16** (the `O(h^4)` signature). Demonstrate on `∫_0^1 e^{-x^2} dx` (truth `0.7468241328124270`).

#### Go

```go
package main

import (
	"fmt"
	"math"
)

func simpson(f func(float64) float64, a, b float64, n int) float64 {
	if n%2 != 0 {
		n++
	}
	h := (b - a) / float64(n)
	s := f(a) + f(b)
	for i := 1; i < n; i++ {
		if i%2 == 1 {
			s += 4 * f(a+float64(i)*h)
		} else {
			s += 2 * f(a+float64(i)*h)
		}
	}
	return s * h / 3
}

func main() {
	f := func(x float64) float64 { return math.Exp(-x * x) }
	const truth = 0.7468241328124270
	var prev float64
	for _, n := range []int{2, 4, 8, 16, 32, 64} {
		e := math.Abs(simpson(f, 0, 1, n) - truth)
		ratio := 0.0
		if prev != 0 {
			ratio = prev / e
		}
		fmt.Printf("n=%3d  err=%.3e  ratio=%.1f\n", n, e, ratio)
		prev = e
	}
}
```

#### Java

```java
import java.util.function.DoubleUnaryOperator;

public class SimpsonOrder {
    static double simpson(DoubleUnaryOperator f, double a, double b, int n) {
        if (n % 2 != 0) n++;
        double h = (b - a) / n, s = f.applyAsDouble(a) + f.applyAsDouble(b);
        for (int i = 1; i < n; i++)
            s += (i % 2 == 1 ? 4 : 2) * f.applyAsDouble(a + i * h);
        return s * h / 3;
    }

    public static void main(String[] args) {
        DoubleUnaryOperator f = x -> Math.exp(-x * x);
        final double truth = 0.7468241328124270;
        double prev = 0;
        for (int n : new int[]{2, 4, 8, 16, 32, 64}) {
            double e = Math.abs(simpson(f, 0, 1, n) - truth);
            double ratio = prev == 0 ? 0 : prev / e;
            System.out.printf("n=%3d  err=%.3e  ratio=%.1f%n", n, e, ratio);
            prev = e;
        }
    }
}
```

#### Python

```python
import math


def simpson(f, a, b, n):
    if n % 2 != 0:
        n += 1
    h = (b - a) / n
    s = f(a) + f(b)
    for i in range(1, n):
        s += (4 if i % 2 == 1 else 2) * f(a + i * h)
    return s * h / 3


if __name__ == "__main__":
    f = lambda x: math.exp(-x * x)
    truth = 0.7468241328124270
    prev = None
    for n in (2, 4, 8, 16, 32, 64):
        e = abs(simpson(f, 0, 1, n) - truth)
        ratio = prev / e if prev else 0.0
        print(f"n={n:3d}  err={e:.3e}  ratio={ratio:.1f}")
        prev = e
```

**Expected:** the `ratio` column climbs toward **16.0** as `n` grows — empirical proof of `O(h^4)`. (Doing the same with the trapezoid yields a ratio approaching **4.0**.) An interviewer may ask why the ratio eventually *falls below* 16 at large `n`: round-off error has reached the floor, so the error is no longer purely truncation.

**Follow-up:** *How would you adapt this to estimate the error order of an unknown rule?* Fit `log(error)` vs `log(h)`; the slope is the order. The ratio test is the discrete version of that slope.

---

## System-Design-Style Discussion: "Design an Integration Service"

A senior interview may pose an open-ended design: *"Build a service that evaluates user-supplied definite integrals at scale."* A strong answer covers:

- **API contract:** accept `f` (as an expression to parse/JIT, or a callback), `[a, b]` (possibly infinite), and tolerances; return `value`, `error_estimate`, `evaluations`, and a `status`.
- **Method routing:** classify the integrand (dimension, singularity hints, oscillation) and dispatch to adaptive Simpson / Gauss–Kronrod / tanh–sinh / Monte Carlo — exactly the senior-level decision tree.
- **Safety:** sandbox user expressions; cap evaluations and wall-clock per request to prevent a malicious or pathological integrand from exhausting resources.
- **Caching:** memoize results for repeated identical requests; for a fixed `f` queried at many endpoints, precompute a cumulative table.
- **Observability:** emit evaluations, depth, and error/tolerance ratio; alert on non-convergence rates.
- **Correctness:** validate against a library oracle on a golden suite in CI; property checks (linearity, additivity) on every deploy.

The interviewer is checking whether you treat numerical integration as an *engineered system with failure modes and SLAs*, not just a formula.

## Closing Tips

- **Lead with the one-liner:** "slice the interval, fit parabolas, error `O(h^4)`." It signals you understand the *why*, not just the formula.
- **Always mention degree of precision 3** when asked why Simpson beats the trapezoid — it's the crisp, quotable fact.
- **Know the two constants cold:** `h/3` (the formula) and `15` (the adaptive criterion). Mixing up `h/2`/`h/3` is the classic tell of someone who memorized without understanding.
- **When stuck on a hard integrand, say "classify, then route, and validate against `quad`"** — it shows production maturity even if you don't recall the exact specialist method.
