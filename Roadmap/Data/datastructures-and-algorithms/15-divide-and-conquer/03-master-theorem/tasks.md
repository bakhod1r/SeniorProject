# The Master Theorem — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec and starter code in all three languages. Implement the Master-Theorem (or Akra–Bazzi) logic and validate against the evaluation criteria.
> **Always cross-check the closed-form answer against a recursion-tree summation on small `n` before trusting it.**

---

## Beginner Tasks (5)

### Task 1 — Compute the critical exponent

**Problem.** Given integers `a ≥ 1` and `b > 1`, compute the critical exponent `log_b a` and print it to 4 decimal places.

**Input / Output spec.**
- Read `a`, `b`.
- Print `log_b a` rounded to 4 decimals.

**Constraints.**
- `1 ≤ a ≤ 10^6`, `2 ≤ b ≤ 10^6`.
- Use `ln(a)/ln(b)`, not a custom log base.

**Hint.** Change-of-base: `log_b a = math.Log(a)/math.Log(b)`. Verify `b^(log_b a) ≈ a`.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

func critExp(a, b float64) float64 {
	// TODO: return log_b a
	_ = math.Log
	return 0
}

func main() {
	var a, b float64
	fmt.Scan(&a, &b)
	fmt.Printf("%.4f\n", critExp(a, b))
}
```

**Starter — Java.**
```java
import java.util.Scanner;

public class Task1 {
    static double critExp(double a, double b) {
        // TODO: return log_b a
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        double a = sc.nextDouble(), b = sc.nextDouble();
        System.out.printf("%.4f%n", critExp(a, b));
    }
}
```

**Starter — Python.**
```python
import math


def crit_exp(a, b):
    # TODO: return log_b a
    return 0.0


if __name__ == "__main__":
    a, b = map(float, input().split())
    print(f"{crit_exp(a, b):.4f}")
```

---

### Task 2 — Classify into one of the three cases

**Problem.** Given `a`, `b`, and the exponent `c` of `f(n) = n^c`, print `1`, `2`, or `3` for the Master-Theorem case.

**Input / Output spec.**
- Read `a`, `b`, `c`.
- Print the case number.

**Constraints.**
- Compare `c` to `log_b a` with an epsilon of `1e-9`.

**Hint.** `c < p` → 1, `c ≈ p` → 2, `c > p` → 3.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

func caseOf(a, b, c float64) int {
	p := math.Log(a) / math.Log(b)
	// TODO: return 1, 2, or 3
	_ = p
	return 0
}

func main() {
	var a, b, c float64
	fmt.Scan(&a, &b, &c)
	fmt.Println(caseOf(a, b, c))
}
```

**Starter — Java.**
```java
import java.util.Scanner;

public class Task2 {
    static int caseOf(double a, double b, double c) {
        double p = Math.log(a) / Math.log(b);
        // TODO: return 1, 2, or 3
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(caseOf(sc.nextDouble(), sc.nextDouble(), sc.nextDouble()));
    }
}
```

**Starter — Python.**
```python
import math


def case_of(a, b, c):
    p = math.log(a) / math.log(b)
    # TODO: return 1, 2, or 3
    return 0


if __name__ == "__main__":
    a, b, c = map(float, input().split())
    print(case_of(a, b, c))
```

---

### Task 3 — Print the closed-form `T(n)`

**Problem.** Given `a`, `b`, `c` for `T(n) = a T(n/b) + n^c`, print the closed-form `T(n)` string (e.g. `Theta(n^1.0000 log n)`).

**I/O spec.** Read `a, b, c`; print the `Theta(...)` string.

**Constraints.** Handle all three cases; Case 2 must include the `log n` factor.

**Hint.** Reuse Task 2's classifier, then format per case.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

func closedForm(a, b, c float64) string {
	p := math.Log(a) / math.Log(b)
	_ = p
	// TODO: return the Theta(...) string for the right case
	return ""
}

func main() {
	var a, b, c float64
	fmt.Scan(&a, &b, &c)
	fmt.Println(closedForm(a, b, c))
}
```

**Starter — Java.**
```java
import java.util.Scanner;

public class Task3 {
    static String closedForm(double a, double b, double c) {
        double p = Math.log(a) / Math.log(b);
        // TODO
        return "";
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(closedForm(sc.nextDouble(), sc.nextDouble(), sc.nextDouble()));
    }
}
```

**Starter — Python.**
```python
import math


def closed_form(a, b, c):
    p = math.log(a) / math.log(b)
    # TODO
    return ""


if __name__ == "__main__":
    a, b, c = map(float, input().split())
    print(closed_form(a, b, c))
```

---

### Task 4 — Recursion-tree leaf count

**Problem.** Given `a`, `b`, `n` (with `n` a power of `b`), compute the number of leaves `a^(log_b n)` and confirm it equals `n^(log_b a)`. Print both.

**I/O spec.** Read `a, b, n`; print leaf count via both formulas (should match).

**Constraints.** `n` is a power of `b`; use floating point and round.

**Hint.** `levels = log_b n`; `leaves = a^levels`. Separately `n^(log_b a)`.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

func main() {
	var a, b, n float64
	fmt.Scan(&a, &b, &n)
	// TODO: levels = log_b n; print a^levels and n^(log_b a)
	_ = math.Log
}
```

**Starter — Java.**
```java
import java.util.Scanner;

public class Task4 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        double a = sc.nextDouble(), b = sc.nextDouble(), n = sc.nextDouble();
        // TODO
    }
}
```

**Starter — Python.**
```python
import math

if __name__ == "__main__":
    a, b, n = map(float, input().split())
    # TODO: print a^(log_b n) and n^(log_b a)
```

---

### Task 5 — Sum one recursion-tree level

**Problem.** Given `a`, `b`, level index `i`, and `n`, compute the total work at level `i`: `a^i · f(n/b^i)` for `f(n) = n`.

**I/O spec.** Read `a, b, i, n`; print `a^i * (n / b^i)`.

**Constraints.** `0 ≤ i ≤ 60`.

**Hint.** This single term is the geometric-series term; for merge sort (`a=b=2`, `f=n`) every level equals `n`.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

func levelWork(a, b, i, n float64) float64 {
	// TODO: a^i * (n / b^i)
	return math.Pow(a, i) * 0
}

func main() {
	var a, b, i, n float64
	fmt.Scan(&a, &b, &i, &n)
	fmt.Printf("%.4f\n", levelWork(a, b, i, n))
}
```

**Starter — Java.**
```java
import java.util.Scanner;

public class Task5 {
    static double levelWork(double a, double b, double i, double n) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.printf("%.4f%n", levelWork(sc.nextDouble(), sc.nextDouble(), sc.nextDouble(), sc.nextDouble()));
    }
}
```

**Starter — Python.**
```python
def level_work(a, b, i, n):
    # TODO: a**i * (n / b**i)
    return 0.0


if __name__ == "__main__":
    a, b, i, n = map(float, input().split())
    print(f"{level_work(a, b, i, n):.4f}")
```

---

## Intermediate Tasks (4)

### Task 6 — Extended Master-Theorem classifier (with `k`)

**Problem.** Given `a`, `b`, `c`, `k` for `f(n) = n^c log^k n`, print the closed-form `T(n)` including extended Case 2 (`log^(k+1) n`).

**I/O spec.** Read `a, b, c, k`; print the `Theta(...)` string.

**Constraints.** Support `k ≥ 0` for the extended Case 2; for Case 2 with `k=0` the result is `n^p log n`.

**Hint.** When `c == log_b a`, the answer is `n^p log^(k+1) n`.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

func extended(a, b, c, k float64) string {
	p := math.Log(a) / math.Log(b)
	_ = p
	// TODO: Case 1 -> n^p ; Case 2 -> n^p log^(k+1) n ; Case 3 -> n^c log^k n
	return ""
}

func main() {
	var a, b, c, k float64
	fmt.Scan(&a, &b, &c, &k)
	fmt.Println(extended(a, b, c, k))
}
```

**Starter — Java.**
```java
import java.util.Scanner;

public class Task6 {
    static String extended(double a, double b, double c, double k) {
        double p = Math.log(a) / Math.log(b);
        // TODO
        return "";
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(extended(sc.nextDouble(), sc.nextDouble(), sc.nextDouble(), sc.nextDouble()));
    }
}
```

**Starter — Python.**
```python
import math


def extended(a, b, c, k):
    p = math.log(a) / math.log(b)
    # TODO
    return ""


if __name__ == "__main__":
    a, b, c, k = map(float, input().split())
    print(extended(a, b, c, k))
```

---

### Task 7 — Recursion-tree summation vs closed form

**Problem.** Sum the full recursion tree `Σ a^i f(n/b^i)` plus leaves for `f(n) = n^c`, then divide by the predicted closed form and verify the ratio is within `[0.1, 10]` (constant factor).

**I/O spec.** Read `a, b, c, n`; print the tree sum, the closed form, and the ratio.

**Constraints.** `n` up to `2^20`.

**Hint.** Loop while `size >= 1`, accumulating `nodes * size^c`; `nodes *= a`, `size /= b`.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

func treeSum(a, b, c, n float64) float64 {
	total, size, nodes := 0.0, n, 1.0
	for size >= 1 {
		// TODO: total += nodes * size^c ; update size, nodes
		_ = math.Pow
		break
	}
	return total
}

func main() {
	var a, b, c, n float64
	fmt.Scan(&a, &b, &c, &n)
	fmt.Printf("%.3e\n", treeSum(a, b, c, n))
}
```

**Starter — Java.**
```java
import java.util.Scanner;

public class Task7 {
    static double treeSum(double a, double b, double c, double n) {
        double total = 0, size = n, nodes = 1;
        while (size >= 1) {
            // TODO
            break;
        }
        return total;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.printf("%.3e%n", treeSum(sc.nextDouble(), sc.nextDouble(), sc.nextDouble(), sc.nextDouble()));
    }
}
```

**Starter — Python.**
```python
def tree_sum(a, b, c, n):
    total, size, nodes = 0.0, float(n), 1.0
    while size >= 1:
        # TODO: total += nodes * size**c ; size /= b ; nodes *= a
        break
    return total


if __name__ == "__main__":
    a, b, c, n = map(float, input().split())
    print(f"{tree_sum(a, b, c, n):.3e}")
```

---

### Task 8 — Regularity-condition checker

**Problem.** For Case-3 candidates (`c > log_b a`), verify the regularity condition by computing the ratio `a·f(n/b)/f(n) = a/b^c` and confirming it is `< 1`. Print `OK` or `FAIL`.

**I/O spec.** Read `a, b, c`; print `OK` if `a/b^c < 1`, else `FAIL`.

**Constraints.** Only meaningful when `c > log_b a`; print `N/A` otherwise.

**Hint.** For `f(n) = n^c`, regularity reduces to `a/b^c < 1`, equivalent to `c > log_b a`.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

func regularity(a, b, c float64) string {
	p := math.Log(a) / math.Log(b)
	if c <= p {
		return "N/A"
	}
	// TODO: ratio = a/b^c ; return OK if < 1 else FAIL
	return ""
}

func main() {
	var a, b, c float64
	fmt.Scan(&a, &b, &c)
	fmt.Println(regularity(a, b, c))
}
```

**Starter — Java.**
```java
import java.util.Scanner;

public class Task8 {
    static String regularity(double a, double b, double c) {
        double p = Math.log(a) / Math.log(b);
        if (c <= p) return "N/A";
        // TODO
        return "";
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(regularity(sc.nextDouble(), sc.nextDouble(), sc.nextDouble()));
    }
}
```

**Starter — Python.**
```python
import math


def regularity(a, b, c):
    p = math.log(a) / math.log(b)
    if c <= p:
        return "N/A"
    # TODO: ratio = a / b**c ; "OK" if < 1 else "FAIL"
    return ""


if __name__ == "__main__":
    a, b, c = map(float, input().split())
    print(regularity(a, b, c))
```

---

### Task 9 — Empirical asymptotic verifier

**Problem.** Given a recursive op-count function `T(n) = a·T(n/b) + n^c` (with `T(1)=0`), evaluate it at doubling sizes and divide by the predicted closed form; print the ratios (they should converge to a constant).

**I/O spec.** Read `a, b, c`; for `n = 2^4 … 2^14`, print `n` and `T(n)/closed(n)`.

**Constraints.** Use integer `n//b` in the recursion.

**Hint.** Memoize or just recompute; sizes are small.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

func T(a, b, c, n float64) float64 {
	if n <= 1 {
		return 0
	}
	// TODO: a*T(a,b,c, floor(n/b)) + n^c
	_ = math.Pow
	return 0
}

func main() {
	var a, b, c float64
	fmt.Scan(&a, &b, &c)
	for k := 4; k <= 14; k++ {
		n := math.Pow(2, float64(k))
		fmt.Printf("n=%6.0f T=%g\n", n, T(a, b, c, n))
	}
}
```

**Starter — Java.**
```java
import java.util.Scanner;

public class Task9 {
    static double T(double a, double b, double c, double n) {
        if (n <= 1) return 0;
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        double a = sc.nextDouble(), b = sc.nextDouble(), c = sc.nextDouble();
        for (int k = 4; k <= 14; k++) {
            double n = Math.pow(2, k);
            System.out.printf("n=%6.0f T=%g%n", n, T(a, b, c, n));
        }
    }
}
```

**Starter — Python.**
```python
import math


def T(a, b, c, n):
    if n <= 1:
        return 0
    # TODO: a * T(a, b, c, n // b) + n**c
    return 0


if __name__ == "__main__":
    a, b, c = map(float, input().split())
    for k in range(4, 15):
        n = 2 ** k
        print(f"n={n:6d} T={T(a, b, c, n)}")
```

---

## Advanced Tasks (3)

### Task 10 — Akra–Bazzi exponent by bisection

**Problem.** Given lists `a[]` and subproblem fractions `frac[]` (each `< 1`), solve `Σ a_i · frac_i^p = 1` for `p` via bisection to 6-decimal precision.

**I/O spec.** Read `m`, then `m` pairs `a_i frac_i`; print `p`.

**Constraints.** `phi(p) = Σ a_i frac_i^p` is strictly decreasing; bracket `p ∈ [-10, 50]`.

**Hint.** Standard bisection: if `phi(mid) > 1` raise the lower bound, else lower the upper.

**Starter — Go.**
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
	lo, hi := -10.0, 50.0
	// TODO: 200 bisection iterations on phi(p) == 1
	_ = phi
	return (lo + hi) / 2
}

func main() {
	var m int
	fmt.Scan(&m)
	a := make([]float64, m)
	frac := make([]float64, m)
	for i := 0; i < m; i++ {
		fmt.Scan(&a[i], &frac[i])
	}
	fmt.Printf("%.6f\n", akraBazzi(a, frac))
}
```

**Starter — Java.**
```java
import java.util.Scanner;

public class Task10 {
    static double akraBazzi(double[] a, double[] frac) {
        double lo = -10, hi = 50;
        // TODO: bisection on phi(p)=sum a_i frac_i^p == 1
        return (lo + hi) / 2;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int m = sc.nextInt();
        double[] a = new double[m], frac = new double[m];
        for (int i = 0; i < m; i++) { a[i] = sc.nextDouble(); frac[i] = sc.nextDouble(); }
        System.out.printf("%.6f%n", akraBazzi(a, frac));
    }
}
```

**Starter — Python.**
```python
def akra_bazzi(a, frac):
    def phi(p):
        return sum(ai * (fi ** p) for ai, fi in zip(a, frac))
    lo, hi = -10.0, 50.0
    # TODO: 200 bisection iterations on phi(p) == 1
    return (lo + hi) / 2


if __name__ == "__main__":
    m = int(input())
    a, frac = [], []
    for _ in range(m):
        ai, fi = map(float, input().split())
        a.append(ai)
        frac.append(fi)
    print(f"{akra_bazzi(a, frac):.6f}")
```

---

### Task 11 — Full Akra–Bazzi solver with the integral

**Problem.** After finding `p`, evaluate `∫_1^n g(u)/u^(p+1) du` numerically for `g(u) = u` and classify `T(n)` as `Θ(n^p)` (integral converges), `Θ(n^p log n)` (integral ~ log), or `Θ(n^(integral exponent))`.

**I/O spec.** Read `m`, the pairs, and `n`; print the closed-form class.

**Constraints.** Use the analytic integral for `g(u)=u`: `∫ u^(−p) du`.

**Hint.** If `p > 1`: integral converges → `Θ(n^p)`. If `p = 1`: → `Θ(n log n)`. If `p < 1`: → `Θ(n)`.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

func classifyAB(p float64) string {
	const eps = 1e-6
	// TODO: g(u)=u case: p>1 -> n^p ; p==1 -> n log n ; p<1 -> n
	_ = math.Abs
	_ = eps
	return ""
}

func main() {
	var p float64
	fmt.Scan(&p)
	fmt.Println(classifyAB(p))
}
```

**Starter — Java.**
```java
import java.util.Scanner;

public class Task11 {
    static String classifyAB(double p) {
        final double eps = 1e-6;
        // TODO
        return "";
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(classifyAB(sc.nextDouble()));
    }
}
```

**Starter — Python.**
```python
def classify_ab(p):
    eps = 1e-6
    # TODO: g(u)=u: p>1 -> n^p ; p==1 -> n log n ; p<1 -> n
    return ""


if __name__ == "__main__":
    p = float(input())
    print(classify_ab(p))
```

---

### Task 12 — Recurrence parser and dispatcher

**Problem.** Parse a recurrence string like `2T(n/2)+n` or `T(n/3)+T(2n/3)+n` and dispatch: single-term → Master Theorem; multi-term → Akra–Bazzi. Print the `Θ` bound.

**I/O spec.** Read a recurrence string; print the closed form.

**Constraints.** Support the `f(n)` forms `1`, `n`, `n^2`, `n*log(n)`. Single and double subproblem terms.

**Hint.** Tokenize the `aT(n/b)` terms with a regex; collect `(a_i, b_i)`; if exactly one term use the Master Theorem, else Akra–Bazzi.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"regexp"
)

func solve(rec string) string {
	re := regexp.MustCompile(`(\d*)T\(n/(\d+(?:\.\d+)?)\)`)
	matches := re.FindAllStringSubmatch(rec, -1)
	_ = matches
	// TODO: collect (a_i, b_i); single -> Master Theorem; multi -> Akra-Bazzi
	return ""
}

func main() {
	var rec string
	fmt.Scan(&rec)
	fmt.Println(solve(rec))
}
```

**Starter — Java.**
```java
import java.util.Scanner;
import java.util.regex.*;

public class Task12 {
    static String solve(String rec) {
        Matcher m = Pattern.compile("(\\d*)T\\(n/(\\d+(?:\\.\\d+)?)\\)").matcher(rec);
        // TODO: collect terms; dispatch Master Theorem vs Akra-Bazzi
        return "";
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(solve(sc.next()));
    }
}
```

**Starter — Python.**
```python
import re


def solve(rec):
    terms = re.findall(r"(\d*)T\(n/(\d+(?:\.\d+)?)\)", rec)
    # TODO: collect (a_i, b_i); single -> Master Theorem; multi -> Akra-Bazzi
    return ""


if __name__ == "__main__":
    print(solve(input().strip()))
```

---

## Evaluation Criteria

| Task group | What graders check |
|------------|--------------------|
| Beginner | Correct `log_b a`, correct case selection, correct closed-form formatting. |
| Intermediate | Extended Case 2 adds exactly one `log`; tree sum matches closed form within a constant; regularity ratio computed as `a/b^c`. |
| Advanced | Akra–Bazzi `p` correct to 6 decimals; integral classification matches the convergent/borderline/divergent rule; parser dispatches single vs multi-term correctly. |

**Test discipline.**
- For every solver, hand-verify against the famous results: merge sort → `Θ(n log n)`, Karatsuba → `Θ(n^1.585)`, Strassen → `Θ(n^2.807)`.
- For Akra–Bazzi, confirm `T(n/3)+T(2n/3)+n` gives `p=1` and `T(n/5)+T(7n/10)+n` gives `p<1` (linear).
- Always sum a small recursion tree as an independent oracle before trusting a closed form.
