# The Master Theorem — Interview Preparation

The Master Theorem is one of the highest-leverage interview topics in all of algorithms: a single crisp comparison — *"is `f(n)` polynomially smaller than, equal to, or larger than the watershed `n^(log_b a)`?"* — lets you solve almost any divide-and-conquer recurrence in seconds. Interviewers love it because it tests (a) whether you can *extract* a recurrence from an algorithm, (b) whether you remember the three cases and the regularity condition, (c) whether you recognize the gap cases and reach for the extended form or Akra–Bazzi, and (d) whether you can avoid the classic trap of quoting `n log n` for every `2T(n/2)+...`. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Recurrence | `log_b a` | Case | `T(n)` |
|------------|-----------|------|--------|
| `2T(n/2) + n` (merge sort) | 1 | 2 | `Θ(n log n)` |
| `T(n/2) + 1` (binary search) | 0 | 2 | `Θ(log n)` |
| `3T(n/2) + n` (Karatsuba) | 1.585 | 1 | `Θ(n^1.585)` |
| `7T(n/2) + n²` (Strassen) | 2.807 | 1 | `Θ(n^2.807)` |
| `8T(n/2) + n²` (naive matmul) | 3 | 1 | `Θ(n³)` |
| `4T(n/2) + n²` | 2 | 2 | `Θ(n² log n)` |
| `2T(n/2) + n²` | 1 | 3 | `Θ(n²)` |
| `2T(n/2) + n log n` | 1 | gap → ext.2 | `Θ(n log² n)` |
| `T(n/3) + T(2n/3) + n` | — | Akra–Bazzi | `Θ(n log n)` |
| `T(n/5) + T(7n/10) + n` | — | Akra–Bazzi | `Θ(n)` |

The three-step procedure:

```text
1. read off a, b, f(n)
2. watershed = n^(log_b a)
3. compare f(n) to watershed:
     polynomially smaller → Case 1 → Θ(n^log_b a)
     same growth          → Case 2 → Θ(n^log_b a · log n)
     polynomially larger  → Case 3 → Θ(f(n))   [check regularity!]
```

Key facts:
- **Length of the difference matters:** Cases 1/3 need an `n^ε` factor, not a `log` factor.
- **Case 2 is not always `n log n`** — it's `n^(log_b a) log n`.
- **Case 3 requires regularity** `a·f(n/b) ≤ c·f(n)`, `c < 1`.
- **Two different subproblem sizes ⇒ Akra–Bazzi**, not the Master Theorem.

---

## Rapid-Fire: Solve These Recurrences (Junior)

> **Q1.** `T(n) = 2T(n/2) + n`.
> **A.** `log_2 2 = 1`, `f = n = Θ(n^1)` → Case 2 → `Θ(n log n)`. (Merge sort.)

> **Q2.** `T(n) = T(n/2) + O(1)`.
> **A.** `log_2 1 = 0`, watershed `n^0 = 1`, `f = Θ(1)` → Case 2 → `Θ(log n)`. (Binary search.)

> **Q3.** `T(n) = 4T(n/2) + n`.
> **A.** `log_2 4 = 2`, watershed `n²`, `f = n = O(n^{2−ε})` → Case 1 → `Θ(n²)`.

> **Q4.** `T(n) = 4T(n/2) + n²`.
> **A.** `log_2 4 = 2`, `f = n² = Θ(n²)` → Case 2 → `Θ(n² log n)`. (Not `n log n`!)

> **Q5.** `T(n) = 4T(n/2) + n³`.
> **A.** `log_2 4 = 2`, `f = n³ = Ω(n^{2+ε})`, regularity `4(n/2)³ = n³/2 = (1/2)f` ✓ → Case 3 → `Θ(n³)`.

> **Q6.** `T(n) = 3T(n/2) + n`.
> **A.** `log_2 3 ≈ 1.585`, `f = n = O(n^{1.585−ε})` → Case 1 → `Θ(n^{log_2 3})`. (Karatsuba.)

> **Q7.** `T(n) = 2T(n/4) + 1`.
> **A.** `log_4 2 = 1/2`, watershed `n^{1/2} = √n`, `f = Θ(1)` → Case 1 → `Θ(√n)`.

> **Q8.** `T(n) = 2T(n/4) + √n`.
> **A.** `log_4 2 = 1/2`, watershed `√n`, `f = √n = Θ(n^{1/2})` → Case 2 → `Θ(√n log n)`.

---

## Rapid-Fire: Solve These Recurrences (Middle)

> **Q9.** `T(n) = 7T(n/2) + n²`.
> **A.** `log_2 7 ≈ 2.807`, `f = n² = O(n^{2.807−ε})` → Case 1 → `Θ(n^{2.807})`. (Strassen beats naive `n³`.)

> **Q10.** `T(n) = 8T(n/2) + n²`.
> **A.** `log_2 8 = 3`, `f = n²` → Case 1 → `Θ(n³)`. (Naive D&C matmul; `a=8` is the whole difference from Strassen's `a=7`.)

> **Q11.** `T(n) = 2T(n/2) + n log n`. *(The trap.)*
> **A.** `log_2 2 = 1`, watershed `n`. `f = n log n` is bigger than `n` but only by a `log` factor — **not** polynomially, so Case 3 does **not** apply. Extended Case 2 with `k = 1` → `Θ(n log² n)`.

> **Q12.** `T(n) = 2T(n/2) + n / log n`.
> **A.** Watershed `n`; `f` smaller than `n` by only a `log` factor → not Case 1. Extended form has `k = −1` → Akra–Bazzi → `Θ(n log log n)`.

> **Q13.** `T(n) = T(n/2) + n`.
> **A.** `log_2 1 = 0`, watershed `1`, `f = n = Ω(n^{0+1})`, regularity `1·(n/2) = (1/2)n` ✓ → Case 3 → `Θ(n)`.

> **Q14.** `T(n) = 16T(n/4) + n²`.
> **A.** `log_4 16 = 2`, `f = n² = Θ(n²)` → Case 2 → `Θ(n² log n)`.

> **Q15.** `T(n) = 2ⁿ T(n/2) + nⁿ`. *(Trick question.)*
> **A.** `a = 2ⁿ` is **not constant** → the Master Theorem does **not** apply. Don't be fooled by the shape.

---

## Conceptual Questions (Middle / Senior)

> **Q16. Why does Cases 1 and 3 require a *polynomial* difference, not just any difference?**
> Unrolling gives a geometric series with ratio `r = a/b^c`. The series collapses to a single term (leaves or root) only when `r` is bounded away from `1` by a constant. An `n^ε` factor in `f` multiplies `r` by a constant `b^{∓ε} ≠ 1`; a `log` factor leaves `r → 1`, so the series accumulates across all `Θ(log n)` levels instead of collapsing — that's the gap.

> **Q17. What exactly is the regularity condition and why is it needed?**
> `a·f(n/b) ≤ c·f(n)` for some `c < 1`. It guarantees the per-level work decays geometrically going down the tree, so the driving sum collapses to its top term `Θ(f(n))`. Without it, the sum could exceed `Θ(f(n))` and Case 3's conclusion fails. For polynomial `f` it holds automatically.

> **Q18. Is the watershed `n^(log_b a)` the leaf count?**
> Yes. The tree is `log_b n` deep and branches `a` ways, so it has `a^{log_b n} = n^{log_b a}` leaves, each `Θ(1)` — that's the unconditional `Ω(n^{log_b a})` floor. The three cases differ only in how much extra the internal `f`-work adds.

> **Q19. When does the Master Theorem genuinely fail, and what replaces it?**
> Unequal subproblem sizes (`T(n/3)+T(2n/3)+n`), non-constant `a`/`b`, non-polynomial gaps (with negative `k`), and regularity failures. Akra–Bazzi (`Σ a_i b_i^p = 1`, then an integral) handles unequal sizes and log gaps; substitution handles the rest.

> **Q20. State the Akra–Bazzi exponent for `T(n)=T(n/3)+T(2n/3)+n` and the answer.**
> Solve `(1/3)^p + (2/3)^p = 1` → `p = 1`. Integral `∫_1^n u/u² du = log n` → `Θ(n log n)`.

> **Q21. Why is median-of-medians selection `Θ(n)` and not `Θ(n log n)`?**
> Recurrence `T(n/5)+T(7n/10)+n`. Akra–Bazzi exponent `p` solves `(1/5)^p+(7/10)^p=1`; at `p=1` the LHS is `0.9 < 1`, forcing `p < 1`. With `p < 1` the linear driving term dominates: `T(n) = Θ(n)`. The key is `1/5 + 7/10 = 9/10 < 1`.

> **Q22. Merge sort is `2T(n/2)+Θ(n)`. A candidate writes `2T(n/2)+Θ(1)`. What's wrong?**
> They forgot the `O(n)` *merge* (combine) cost — only the split is `O(1)`. Their version gives Case 1 → `Θ(n)`, off by a `log n` factor from the correct Case 2 `Θ(n log n)`.

---

## Rapid-Fire: Tricky and Senior Recurrences

> **Q23.** `T(n) = 2T(n/2) + n / log n`.
> **A.** Watershed `n`; `f` smaller by only a `log` factor → gap, not Case 1. Akra–Bazzi: `p=1`, `∫ 1/(u log u) du = log log n` → `Θ(n log log n)`.

> **Q24.** `T(n) = √2·T(n/2) + log n`.
> **A.** `log_2 √2 = 1/2`, watershed `n^{1/2} = √n`. `f = log n = O(n^{1/2 − ε})` → Case 1 → `Θ(√n)`.

> **Q25.** `T(n) = 3T(n/3) + n/2`.
> **A.** `log_3 3 = 1`, watershed `n`, `f = n/2 = Θ(n)` → Case 2 → `Θ(n log n)`. (Constant `1/2` is irrelevant to the case.)

> **Q26.** `T(n) = 4T(n/2) + n² log n`.
> **A.** `log_2 4 = 2`, watershed `n²`. `f = n² log n = Θ(n² log^1 n)` → extended Case 2 with `k=1` → `Θ(n² log² n)`.

> **Q27.** `T(n) = T(n−1) + n`. *(Not a Master recurrence.)*
> **A.** Subtract-and-conquer, not divide-and-conquer. Sum directly: `Σ i = Θ(n²)`. Master Theorem does not apply.

> **Q28.** `T(n) = 2T(n−1) + 1`. *(Not a Master recurrence.)*
> **A.** Also subtract-and-conquer; unrolls to `2^n − 1 = Θ(2^n)` (Towers of Hanoi). Don't apply the Master Theorem.

> **Q29.** `T(n) = 0.5·T(n/2) + n`. *(Invalid.)*
> **A.** `a = 0.5 < 1` violates the hypothesis `a ≥ 1`. The Master Theorem does not apply; here the recursion does not even spawn a full subproblem.

> **Q30.** `T(n) = 64·T(n/8) − n² log n`. *(Trap: negative `f`.)*
> **A.** `f(n)` must be asymptotically *positive*. A negative driving term violates the hypothesis — the theorem does not apply.

> **Q31.** `T(n) = √n · T(√n) + n`.
> **A.** Non-constant `a` and `b`. Change variables `m = log n`, `S(m) = T(2^m)/2^m`: solves to `Θ(n log log n)`. Master Theorem cannot start.

> **Q32.** Which is asymptotically faster: `5T(n/2)+n²` or `2T(n/2)+n³`?
> **A.** First: `log_2 5 ≈ 2.32 > 2` → Case 1 → `Θ(n^2.32)`. Second: `log_2 2 = 1 < 3` → Case 3 → `Θ(n³)`. The first is faster (`n^2.32 < n³`).

---

## System Design / Applied Prompts

> **D1. You're choosing a sort for a 10-element inner loop run billions of times. Does `Θ(n log n)` matter?**
> No — for `n = 10`, constants dominate and insertion sort (`Θ(n²)` but tiny constant, cache-friendly, branch-predictable) wins. The Master Theorem describes the asymptotic regime; this is below any crossover. Report: "asymptotics irrelevant at n=10; benchmark the constant."

> **D2. A teammate claims their D&C algorithm is `Θ(n)` because "the combine is linear." Audit it.**
> A linear combine gives `f(n) = Θ(n)`, but the result depends on `log_b a`. If `a/b > 1` (e.g. `4T(n/2)+n`), it's Case 1 → `Θ(n²)`, not `Θ(n)`. Ask for `a` and `b` before accepting `Θ(n)`.

> **D3. How would you estimate the runtime of a parallel merge sort?**
> Two recurrences: work `T₁ = 2T₁(n/2)+n = Θ(n log n)`; span `T∞ = T∞(n/2) + (merge depth)`. With serial merge, span is `Θ(n)` (Case 3), parallelism `Θ(log n)`. With parallel merge, span drops to `Θ(log³ n)`, parallelism `Θ(n/log² n)`. Both are Master-Theorem analyses.

> **D4. Your matrix-multiply microservice uses Strassen. A profiler shows it's slower than naive on 256×256 inputs. Explain.**
> Strassen's `Θ(n^2.807)` only beats naive `Θ(n^3)` above a crossover (~512–1000). At 256 the larger constant (18 adds/level, extra allocations, poor cache locality) loses. Fix: set a base-case cutoff that switches to blocked naive below the crossover.

---

## Behavioral Prompts

> **B1. "Tell me about a time you analyzed the complexity of a recursive algorithm."**
> Structure: name the algorithm, extract `a`, `b`, `f(n)` (and explicitly the split vs combine cost), apply the theorem, state the case and the bound, then mention how you *validated* it (e.g. doubling the input and watching the runtime ratio).

> **B2. "How would you explain the Master Theorem to a junior engineer?"**
> Lead with the analogy: a manager splits work into `a` pieces each `1/b` the size, then spends `f(n)` integrating. Compare the integration cost to the total grunt-work of the lowest-level workers (`n^{log_b a}`). Whichever is bigger wins. Avoid the formula until the intuition lands.

> **B3. "Describe a case where you initially got a complexity analysis wrong."**
> Good honest answer: quoting `n log n` for a `2T(n/2)+n²` recurrence by reflex, then realizing `f=n²` dominates → Case 3 → `Θ(n²)`. Lesson: always compute the watershed before naming a case.

> **B4. "When would you choose an algorithm with a worse asymptotic but better constants?"**
> Strassen (`n^2.807`) beats naive matmul (`n³`) only above a crossover (~n≈1000s) because its constant factor and memory traffic are large. Asymptotics describe the limit; production code picks the crossover empirically.

---

## Coding Challenge 1: Master-Theorem Classifier

**Problem.** Given `a`, `b`, and the exponent `c` and log-power `k` of `f(n) = n^c log^k n`, print the case (1, 2, or 3, including extended Case 2) and the resulting `T(n)`.

### Go

```go
package main

import (
	"fmt"
	"math"
)

func classify(a, b, c, k float64) string {
	p := math.Log(a) / math.Log(b) // log_b a
	const eps = 1e-9
	switch {
	case c < p-eps:
		return fmt.Sprintf("Case 1 -> Theta(n^%.4f)", p)
	case math.Abs(c-p) <= eps:
		if k > -1 {
			return fmt.Sprintf("Case 2 -> Theta(n^%.4f log^%.0f n)", p, k+1)
		} else if math.Abs(k+1) <= eps {
			return fmt.Sprintf("Case 2(k=-1) -> Theta(n^%.4f log log n)", p)
		}
		return fmt.Sprintf("gap(k<-1) -> Theta(n^%.4f)", p)
	default:
		return fmt.Sprintf("Case 3 -> Theta(n^%.4f log^%.0f n)", c, k)
	}
}

func main() {
	fmt.Println(classify(2, 2, 1, 0)) // Case 2 -> n^1 log^1 n
	fmt.Println(classify(2, 2, 1, 1)) // Case 2 -> n^1 log^2 n
	fmt.Println(classify(3, 2, 1, 0)) // Case 1 -> n^1.585
	fmt.Println(classify(2, 2, 2, 0)) // Case 3 -> n^2
}
```

### Java

```java
public class Classifier {
    static String classify(double a, double b, double c, double k) {
        double p = Math.log(a) / Math.log(b);
        final double eps = 1e-9;
        if (c < p - eps) return String.format("Case 1 -> Theta(n^%.4f)", p);
        if (Math.abs(c - p) <= eps) {
            if (k > -1) return String.format("Case 2 -> Theta(n^%.4f log^%.0f n)", p, k + 1);
            if (Math.abs(k + 1) <= eps) return String.format("Case 2(k=-1) -> Theta(n^%.4f log log n)", p);
            return String.format("gap(k<-1) -> Theta(n^%.4f)", p);
        }
        return String.format("Case 3 -> Theta(n^%.4f log^%.0f n)", c, k);
    }

    public static void main(String[] args) {
        System.out.println(classify(2, 2, 1, 0));
        System.out.println(classify(2, 2, 1, 1));
        System.out.println(classify(3, 2, 1, 0));
        System.out.println(classify(2, 2, 2, 0));
    }
}
```

### Python

```python
import math


def classify(a, b, c, k):
    p = math.log(a) / math.log(b)
    eps = 1e-9
    if c < p - eps:
        return f"Case 1 -> Theta(n^{p:.4f})"
    if abs(c - p) <= eps:
        if k > -1:
            return f"Case 2 -> Theta(n^{p:.4f} log^{k + 1:.0f} n)"
        if abs(k + 1) <= eps:
            return f"Case 2(k=-1) -> Theta(n^{p:.4f} log log n)"
        return f"gap(k<-1) -> Theta(n^{p:.4f})"
    return f"Case 3 -> Theta(n^{c:.4f} log^{k:.0f} n)"


if __name__ == "__main__":
    print(classify(2, 2, 1, 0))
    print(classify(2, 2, 1, 1))
    print(classify(3, 2, 1, 0))
    print(classify(2, 2, 2, 0))
```

---

## Coding Challenge 2: Recursion-Tree Summation

**Problem.** Given `a`, `b`, a function `f`, and `n`, sum the recursion tree `Σ a^i · f(n/b^i)` over all levels plus the leaf cost, and return the per-level work array so you can see which level dominates.

### Go

```go
package main

import "fmt"

func treeLevels(a, b float64, f func(float64) float64, n float64) []float64 {
	levels := []float64{}
	size, nodes := n, 1.0
	for size >= 1 {
		levels = append(levels, nodes*f(size))
		size /= b
		nodes *= a
	}
	return levels
}

func main() {
	f := func(s float64) float64 { return s } // f(n) = n
	levels := treeLevels(2, 2, f, 16)         // merge sort, n=16
	total := 0.0
	for i, w := range levels {
		fmt.Printf("level %d work = %.0f\n", i, w)
		total += w
	}
	fmt.Printf("total = %.0f  (~ n log n = %.0f)\n", total, 16.0*4)
}
```

### Java

```java
import java.util.function.DoubleUnaryOperator;

public class RecursionTree {
    static double[] treeLevels(double a, double b, DoubleUnaryOperator f, double n) {
        java.util.ArrayList<Double> levels = new java.util.ArrayList<>();
        double size = n, nodes = 1.0;
        while (size >= 1) {
            levels.add(nodes * f.applyAsDouble(size));
            size /= b;
            nodes *= a;
        }
        return levels.stream().mapToDouble(Double::doubleValue).toArray();
    }

    public static void main(String[] args) {
        DoubleUnaryOperator f = s -> s; // f(n) = n
        double[] levels = treeLevels(2, 2, f, 16);
        double total = 0;
        for (int i = 0; i < levels.length; i++) {
            System.out.printf("level %d work = %.0f%n", i, levels[i]);
            total += levels[i];
        }
        System.out.printf("total = %.0f (~ n log n = %.0f)%n", total, 16.0 * 4);
    }
}
```

### Python

```python
def tree_levels(a, b, f, n):
    levels = []
    size, nodes = float(n), 1.0
    while size >= 1:
        levels.append(nodes * f(size))
        size /= b
        nodes *= a
    return levels


if __name__ == "__main__":
    levels = tree_levels(2, 2, lambda s: s, 16)  # merge sort
    for i, w in enumerate(levels):
        print(f"level {i} work = {w:.0f}")
    print(f"total = {sum(levels):.0f}  (~ n log n = {16 * 4})")
```

---

## Coding Challenge 3: Detect Which Case (with Regularity Check)

**Problem.** For `T(n) = a·T(n/b) + f(n)` with polynomial `f(n) = coef·n^c`, decide the case and, for Case 3, *verify* the regularity condition `a·f(n/b) ≤ c'·f(n)` numerically by computing the actual ratio `a/b^c` and confirming it is `< 1`.

### Go

```go
package main

import (
	"fmt"
	"math"
)

func detectCase(a, b, c float64) (int, string) {
	p := math.Log(a) / math.Log(b)
	const eps = 1e-9
	if c < p-eps {
		return 1, fmt.Sprintf("Theta(n^%.4f)", p)
	}
	if math.Abs(c-p) <= eps {
		return 2, fmt.Sprintf("Theta(n^%.4f log n)", p)
	}
	// Case 3: regularity ratio is a/b^c, must be < 1
	ratio := a / math.Pow(b, c)
	if ratio < 1-eps {
		return 3, fmt.Sprintf("Theta(n^%.4f) [regularity ratio=%.3f<1 OK]", c, ratio)
	}
	return 0, "regularity fails — Master Theorem inconclusive"
}

func main() {
	for _, t := range [][3]float64{{2, 2, 1}, {2, 2, 2}, {3, 2, 1}, {4, 2, 2}} {
		cs, res := detectCase(t[0], t[1], t[2])
		fmt.Printf("a=%.0f b=%.0f c=%.0f -> Case %d: %s\n", t[0], t[1], t[2], cs, res)
	}
}
```

### Java

```java
public class DetectCase {
    static String detectCase(double a, double b, double c) {
        double p = Math.log(a) / Math.log(b);
        final double eps = 1e-9;
        if (c < p - eps) return "Case 1: Theta(n^" + String.format("%.4f", p) + ")";
        if (Math.abs(c - p) <= eps) return "Case 2: Theta(n^" + String.format("%.4f", p) + " log n)";
        double ratio = a / Math.pow(b, c);
        if (ratio < 1 - eps)
            return String.format("Case 3: Theta(n^%.4f) [regularity ratio=%.3f<1 OK]", c, ratio);
        return "regularity fails — inconclusive";
    }

    public static void main(String[] args) {
        double[][] tests = {{2, 2, 1}, {2, 2, 2}, {3, 2, 1}, {4, 2, 2}};
        for (double[] t : tests) {
            System.out.printf("a=%.0f b=%.0f c=%.0f -> %s%n", t[0], t[1], t[2], detectCase(t[0], t[1], t[2]));
        }
    }
}
```

### Python

```python
import math


def detect_case(a, b, c):
    p = math.log(a) / math.log(b)
    eps = 1e-9
    if c < p - eps:
        return f"Case 1: Theta(n^{p:.4f})"
    if abs(c - p) <= eps:
        return f"Case 2: Theta(n^{p:.4f} log n)"
    ratio = a / (b ** c)  # regularity ratio a/b^c must be < 1
    if ratio < 1 - eps:
        return f"Case 3: Theta(n^{c:.4f}) [regularity ratio={ratio:.3f}<1 OK]"
    return "regularity fails — inconclusive"


if __name__ == "__main__":
    for a, b, c in [(2, 2, 1), (2, 2, 2), (3, 2, 1), (4, 2, 2)]:
        print(f"a={a} b={b} c={c} -> {detect_case(a, b, c)}")
```

---

## Coding Challenge 4: Akra–Bazzi Exponent Solver

**Problem.** Given lists of `a_i` and subproblem-size fractions `frac_i = 1/b_i` (each `< 1`), numerically solve `Σ a_i · frac_i^p = 1` for the Akra–Bazzi exponent `p` by bisection, then classify the recurrence (with `g(n)=n`) as sublinear-dominated, balanced, or super.

### Go

```go
package main

import (
	"fmt"
	"math"
)

func akraBazzi(a, frac []float64) float64 {
	phi := func(p float64) float64 {
		s := 0.0
		for i := range a {
			s += a[i] * math.Pow(frac[i], p)
		}
		return s
	}
	lo, hi := -10.0, 50.0 // phi is decreasing in p
	for it := 0; it < 200; it++ {
		mid := (lo + hi) / 2
		if phi(mid) > 1 {
			lo = mid
		} else {
			hi = mid
		}
	}
	return (lo + hi) / 2
}

func main() {
	// T(n/3)+T(2n/3)+n : fractions 1/3, 2/3
	fmt.Printf("p=%.4f (expect 1.0) -> Theta(n log n)\n", akraBazzi([]float64{1, 1}, []float64{1.0 / 3, 2.0 / 3}))
	// median-of-medians: fractions 1/5, 7/10
	p := akraBazzi([]float64{1, 1}, []float64{1.0 / 5, 7.0 / 10})
	fmt.Printf("p=%.4f (<1) -> g=n dominates -> Theta(n)\n", p)
}
```

### Java

```java
public class AkraBazzi {
    static double akraBazzi(double[] a, double[] frac) {
        java.util.function.DoubleUnaryOperator phi = p -> {
            double s = 0;
            for (int i = 0; i < a.length; i++) s += a[i] * Math.pow(frac[i], p);
            return s;
        };
        double lo = -10, hi = 50;
        for (int it = 0; it < 200; it++) {
            double mid = (lo + hi) / 2;
            if (phi.applyAsDouble(mid) > 1) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
    }

    public static void main(String[] args) {
        System.out.printf("p=%.4f (expect 1.0) -> Theta(n log n)%n",
                akraBazzi(new double[]{1, 1}, new double[]{1.0 / 3, 2.0 / 3}));
        double p = akraBazzi(new double[]{1, 1}, new double[]{1.0 / 5, 7.0 / 10});
        System.out.printf("p=%.4f (<1) -> Theta(n)%n", p);
    }
}
```

### Python

```python
import math


def akra_bazzi(a, frac):
    def phi(p):
        return sum(ai * (fi ** p) for ai, fi in zip(a, frac))
    lo, hi = -10.0, 50.0  # phi decreasing in p
    for _ in range(200):
        mid = (lo + hi) / 2
        if phi(mid) > 1:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


if __name__ == "__main__":
    p1 = akra_bazzi([1, 1], [1 / 3, 2 / 3])
    print(f"p={p1:.4f} (expect 1.0) -> Theta(n log n)")
    p2 = akra_bazzi([1, 1], [1 / 5, 7 / 10])
    print(f"p={p2:.4f} (<1) -> g=n dominates -> Theta(n)")
```

---

## Interview Tips

- **Always compute the watershed first.** Say "`log_b a = …`, so the watershed is `n^…`" out loud before naming a case. It prevents the reflexive `n log n`.
- **Name the case number.** Interviewers want "Case 2, so `Θ(n log n)`," not just the answer — it shows you know the framework.
- **Mention regularity in Case 3 unprompted.** "`f` is polynomially larger and regularity holds since `a f(n/b) = … = c f(n)` with `c < 1`."
- **Flag the gap cases.** If you see a `log` factor on `f`, say "this is a gap — basic Master Theorem doesn't apply; extended Case 2 gives an extra `log`."
- **Two sizes ⇒ Akra–Bazzi.** The instant you see `T(n/3)+T(2n/3)`, announce that the Master Theorem can't start and set up `Σ a_i b_i^p = 1`.

---

## Summary

The Master Theorem is interview gold because one comparison — `f(n)` vs the watershed `n^(log_b a)` — solves most divide-and-conquer recurrences. Memorize the three cases, the famous results (merge sort `n log n`, Karatsuba `n^1.585`, Strassen `n^2.807`), and the two traps: Case 2 is not always `n log n`, and a `log`-factor difference is a *gap*, not Case 1/3. Always compute the watershed before naming a case, state the regularity check in Case 3, and reach for the extended form (log gaps) or Akra–Bazzi (unequal sizes) when the theorem bows out. The four coding challenges — classifier, recursion-tree summer, case detector with regularity check, and Akra–Bazzi solver — turn the theory into runnable code in Go, Java, and Python.
