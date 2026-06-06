# Simpson's Rule and Numerical Integration — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Each task ships with a precise spec or starter code in all three languages. Implement the integration logic and validate against the evaluation criteria.
> **Always cross-check your result against (a) a known closed-form value, (b) the trapezoidal rule on the same points, and (c) a library oracle (`scipy.integrate.quad`) on small inputs before trusting it. Remember the answer is approximate — compare within a tolerance, never with `==`.**

---

## Beginner Tasks (5)

### Task 1 — Composite Simpson's rule

**Problem.** Implement `simpson(f, a, b, n)` returning the composite Simpson estimate of `∫_a^b f(x) dx` with `n` (even) subintervals, using the `1-4-2-...-4-1` weighting.

**Constraints.**
- Force `n` even (bump up by one if odd).
- `h = (b−a)/n`; endpoints weight 1, odd indices 4, even interior indices 2; multiply the sum by `h/3`.

**Hint.** `s = f(a)+f(b); for i in 1..n-1: s += (i odd?4:2)*f(a+i*h); return s*h/3`.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

func simpson(f func(float64) float64, a, b float64, n int) float64 {
	// TODO: composite Simpson
	return 0
}

func main() {
	fmt.Printf("%.7f\n", simpson(math.Sin, 0, math.Pi, 100)) // expect ~2.0000000
}
```

**Starter — Java.**
```java
import java.util.function.DoubleUnaryOperator;

public class Task1 {
    static double simpson(DoubleUnaryOperator f, double a, double b, int n) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        System.out.printf("%.7f%n", simpson(Math::sin, 0, Math.PI, 100)); // ~2.0
    }
}
```

**Starter — Python.**
```python
import math

def simpson(f, a, b, n):
    # TODO
    return 0.0

if __name__ == "__main__":
    print(f"{simpson(math.sin, 0, math.pi, 100):.7f}")  # ~2.0000000
```

- **Expected Output:** `∫_0^π sin = 2.0`.
- **Evaluation:** correctness, even-`n` handling, `h/3` factor.

### Task 2 — Trapezoidal rule (baseline)

**Problem.** Implement `trapezoid(f, a, b, n)` with the `1-2-...-2-1` weighting. Print the error of both trapezoid and Simpson against the true value of `∫_0^1 e^{-x^2} dx ≈ 0.7468241328` for `n = 8`.

**Constraints.** Any `n ≥ 1` allowed for the trapezoid.

**Evaluation:** Simpson's error should be roughly 100× smaller than the trapezoid's on the same `n`.

### Task 3 — Estimate π via integration

**Problem.** Use composite Simpson to estimate `π` from `∫_0^1 4/(1+x^2) dx = π`. Find the smallest even `n` for which your estimate is within `1e-9` of `math.Pi`.

**Constraints.** Loop over `n = 2, 4, 8, ...` and stop at the first that meets the tolerance; print `n` and the estimate.

**Evaluation:** correct π to 9 digits; reasonable `n` (should be small, a few hundred at most).

### Task 4 — Verify degree of precision 3

**Problem.** Write a test that confirms composite Simpson integrates `1, x, x^2, x^3` **exactly** (to within `1e-9`) over `[0, 2]` for `n = 2`, but is *not* exact for `x^4`.

**Constraints.** Compare against the closed-form integrals (`∫_0^2 x^k = 2^{k+1}/(k+1)`).

**Evaluation:** prints PASS for `k = 0..3`, FAIL (nonzero error) for `k = 4`.

### Task 5 — Refine until converged

**Problem.** Implement `simpson_until(f, a, b, eps)` that doubles `n` (starting at 2) until two successive Simpson estimates differ by less than `eps`, then returns the latest. Test on `∫_0^1 e^{-x^2} dx`.

**Constraints.** Reuse is optional here; just double `n` and compare.

**Evaluation:** returns a value within `eps` of the truth; report how many doublings it took.

---

## Intermediate Tasks (5)

### Task 6 — Adaptive Simpson

**Problem.** Implement adaptive Simpson `integrate(f, a, b, eps)` using the `|S2 − S| < 15·eps` criterion, the Richardson return `S2 + (S2−S)/15`, sample reuse (thread `fa, fb, fm`), and a depth cap of 50.

**Constraints.** Each recursion must add only **two** new function evaluations (`flm`, `frm`).

**Evaluation:** matches the library to `eps` on `sin` over `[0,π]`, `e^{-x^2}` over `[0,1]`, and `1/(1+x^2)` over `[0,1]`.

### Task 7 — Count function evaluations

**Problem.** Extend Task 6 to also return the number of function evaluations. Compare evaluation counts of adaptive Simpson vs fixed-`n` Simpson (matched to the same final accuracy) on `f(x) = 1/(x^2 + 0.001)` over `[-1, 1]` (a sharp spike at 0).

**Constraints.** Wrap `f` in a counter; report both counts.

**Evaluation:** adaptive should use far fewer evaluations than uniform Simpson for the same accuracy on the spiky integrand.

### Task 8 — Arc length of a curve

**Problem.** Compute the arc length of `y = sin(x)` from `0` to `π`, i.e. `∫_0^π sqrt(1 + cos^2 x) dx`, using adaptive Simpson to 10 digits.

**Constraints.** Define `g(x) = sqrt(1 + cos(x)^2)`.

**Evaluation:** result ≈ `3.8201977`; verify against a library `quad`.

### Task 9 — Normal CDF (probability integral)

**Problem.** Implement `normal_cdf(z)` = `0.5 + (1/sqrt(2π))·∫_0^z e^{-t^2/2} dt` using composite or adaptive Simpson. Validate `normal_cdf(0)=0.5`, `normal_cdf(1.96)≈0.975`, `normal_cdf(-1.96)≈0.025`.

**Constraints.** Handle negative `z` by symmetry; integrate from 0 to `|z|`.

**Evaluation:** all three checks within `1e-6`.

### Task 10 — Simpson 3/8 vs 1/3

**Problem.** Implement the basic **Simpson 3/8 rule** `(3h/8)(f0 + 3f1 + 3f2 + f3)` (4 nodes, 3 panels) and compare its error to Simpson 1/3 on `∫_0^1 e^{-x^2} dx` using a matched number of evaluations.

**Constraints.** Both are `O(h^4)`; note 3/8 has a slightly larger error constant.

**Evaluation:** both `O(h^4)`; 1/3 is marginally more accurate per evaluation.

---

## Advanced Tasks (5)

### Task 11 — Endpoint singularity via substitution

**Problem.** Compute `∫_0^1 1/sqrt(x) dx` (true value `2`). Direct Simpson fails (`f(0)=Inf`). Apply the substitution `x = t^2` to get `∫_0^1 2 dt = 2`, and verify Simpson now nails it. Generalize to `∫_0^1 cos(x)/sqrt(x) dx`.

**Constraints.** Show the naive attempt returns `Inf`/`NaN`; the substituted attempt converges.

**Evaluation:** substituted result within `1e-9` of the true value; library `quad` agrees.

### Task 12 — Infinite domain transform

**Problem.** Compute `∫_0^∞ e^{-x^2} dx = sqrt(π)/2 ≈ 0.8862269`. Map `[0, ∞)` to `[0, 1)` via `x = t/(1−t)`, `dx = dt/(1−t)^2`, then integrate with adaptive Simpson.

**Constraints.** Guard the `t → 1` endpoint (where the transformed integrand → 0 but `1/(1−t)^2 → ∞` is tamed by the faster `e^{-x^2}` decay).

**Evaluation:** within `1e-6` of `sqrt(π)/2`; cross-check `scipy.integrate.quad(f, 0, inf)`.

### Task 13 — Romberg integration

**Problem.** Implement Romberg integration: build a table `R[i][j]` where `R[i][0]` is the trapezoid with `2^i` panels and `R[i][j] = (4^j·R[i][j-1] − R[i-1][j-1])/(4^j − 1)`. Show `R[i][1]` equals composite Simpson, and that higher columns converge faster.

**Constraints.** Reuse trapezoid samples across rows (each row halves `h`).

**Evaluation:** `R[i][1] == Simpson` to round-off; the table reaches `1e-12` on `∫_0^1 e^{-x^2}` in few rows.

### Task 14 — Adaptive Simpson with error reporting

**Problem.** Extend adaptive Simpson to return `(value, estimated_error, evals, converged)` honoring **both** `epsabs` and `epsrel` and a `max_evals` budget. Return a `converged=false` status (not an exception) when the budget is exhausted.

**Constraints.** Accept a leaf when `error ≤ max(epsabs, epsrel·|leaf_value|)`. Sum leaf error estimates for the reported total error.

**Evaluation:** correct value + error bar on smooth cases; graceful non-converged status on `1/x` over `[0,1]`.

### Task 15 — Gauss–Legendre comparison

**Problem.** Implement 5-point Gauss–Legendre quadrature on `[a,b]` (hard-code the 5 nodes/weights on `[-1,1]` and remap). Compare its accuracy-per-evaluation against composite Simpson on `∫_0^1 e^{-x^2} dx` and on a high-degree polynomial `x^9` (which 5-point Gauss integrates exactly: degree `2·5−1 = 9`).

**Constraints.** Nodes/weights for `n=5` on `[-1,1]`: `x = ±0.9061798459, ±0.5384693101, 0`; `w = 0.2369268851, 0.4786286705, 0.5688888889` (symmetric).

**Evaluation:** Gauss is exact on `x^9`; Simpson is not. On `e^{-x^2}`, 5-point Gauss beats Simpson with far fewer evaluations.

---

## Benchmark Task

> Compare error vs work across all 3 languages: how fast does each rule's error fall as you double `n`?

#### Go

```go
package main

import (
	"fmt"
	"math"
)

func main() {
	f := func(x float64) float64 { return math.Exp(-x * x) }
	const truth = 0.7468241328124270
	for _, n := range []int{4, 8, 16, 32, 64, 128, 256} {
		t := math.Abs(trapezoid(f, 0, 1, n) - truth)
		s := math.Abs(simpson(f, 0, 1, n) - truth)
		fmt.Printf("n=%4d  trap=%.2e  simpson=%.2e\n", n, t, s)
	}
}
```

#### Java

```java
import java.util.function.DoubleUnaryOperator;

public class Benchmark {
    public static void main(String[] args) {
        DoubleUnaryOperator f = x -> Math.exp(-x * x);
        final double truth = 0.7468241328124270;
        for (int n : new int[]{4, 8, 16, 32, 64, 128, 256}) {
            double t = Math.abs(Task1.simpson(f, 0, 1, n) - truth); // swap in trapezoid for the first column
            double s = Math.abs(Task1.simpson(f, 0, 1, n) - truth);
            System.out.printf("n=%4d  trap=%.2e  simpson=%.2e%n", n, t, s);
        }
    }
}
```

#### Python

```python
import math

def benchmark():
    f = lambda x: math.exp(-x * x)
    truth = 0.7468241328124270
    for n in (4, 8, 16, 32, 64, 128, 256):
        t = abs(trapezoid(f, 0, 1, n) - truth)
        s = abs(simpson(f, 0, 1, n) - truth)
        print(f"n={n:4d}  trap={t:.2e}  simpson={s:.2e}")

if __name__ == "__main__":
    benchmark()
```

**Expected pattern:** the trapezoid error divides by ~4 per doubling (`O(h^2)`); Simpson divides by ~16 per doubling (`O(h^4)`) until it flatlines near `1e-15` where floating-point round-off dominates.
