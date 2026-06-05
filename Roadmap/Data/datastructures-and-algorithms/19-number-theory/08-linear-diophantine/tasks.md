# Linear Diophantine Equations — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec and starter code in all three languages. Implement the extended-Euclid + parametrization logic and validate against the evaluation criteria.
> **Always test against a brute-force search oracle on small inputs before trusting the closed-form result.**

---

## Beginner Tasks (5)

### Task 1 — Extended Euclidean Algorithm

**Problem.** Implement `extGCD(a, b)` returning `(g, x, y)` with `a*x + b*y = g = gcd(a, b)`.

**Input / Output spec.**
- Read two integers `a b`.
- Print `g x y` such that `a*x + b*y == g`.

**Constraints.** `0 ≤ a, b ≤ 10^9`, not both zero.

**Hint.** Recurse on `(b, a mod b)`; base case `b == 0` returns `(a, 1, 0)`.

**Starter — Go.**
```go
package main

import "fmt"

func extGCD(a, b int64) (int64, int64, int64) {
	// TODO: base case b==0; else recurse and back-substitute
	return 0, 0, 0
}

func main() {
	var a, b int64
	fmt.Scan(&a, &b)
	g, x, y := extGCD(a, b)
	fmt.Println(g, x, y)
}
```

**Starter — Java.**
```java
import java.util.Scanner;

public class Task1 {
    static long[] extGCD(long a, long b) {
        // TODO
        return new long[]{0, 0, 0};
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong();
        long[] r = extGCD(a, b);
        System.out.println(r[0] + " " + r[1] + " " + r[2]);
    }
}
```

**Starter — Python.**
```python
def ext_gcd(a, b):
    # TODO
    return 0, 0, 0


a, b = map(int, input().split())
print(*ext_gcd(a, b))
```

**Evaluation.** For 1000 random `(a, b)`, assert `a*x + b*y == g` and `g == math.gcd(a, b)`.

---

### Task 2 — Solvability Check

**Problem.** Given `a, b, c`, print `YES` if `a*x + b*y = c` has an integer solution, else `NO`.

**Input / Output spec.** Read `a b c`; print `YES`/`NO`.

**Constraints.** `0 ≤ |a|, |b|, |c| ≤ 10^18`.

**Hint.** Solvable iff `gcd(a, b) | c`. Handle `a == b == 0` (solvable iff `c == 0`).

**Starter — Go.**
```go
package main

import "fmt"

func gcd(a, b int64) int64 {
	if a < 0 { a = -a }
	if b < 0 { b = -b }
	for b != 0 { a, b = b, a%b }
	return a
}
func main() {
	var a, b, c int64
	fmt.Scan(&a, &b, &c)
	// TODO: print YES/NO
}
```

**Starter — Java.**
```java
import java.util.Scanner;
public class Task2 {
    static long gcd(long a, long b) {
        a = Math.abs(a); b = Math.abs(b);
        while (b != 0) { long t = a % b; a = b; b = t; }
        return a;
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong(), c = sc.nextLong();
        // TODO
    }
}
```

**Starter — Python.**
```python
from math import gcd
a, b, c = map(int, input().split())
# TODO: print YES/NO
```

**Evaluation.** Test `(6,9,21)->YES`, `(6,9,7)->NO`, `(0,0,0)->YES`, `(0,0,5)->NO`.

---

### Task 3 — One Particular Solution

**Problem.** Given solvable `a, b, c`, print any `(x, y)` with `a*x + b*y = c`.

**Input / Output spec.** Read `a b c`; print `x y`.

**Constraints.** `1 ≤ a, b ≤ 10^6`, `|c| ≤ 10^9`, guaranteed solvable.

**Hint.** `x = x'·(c/g)`, `y = y'·(c/g)` from extended Euclid.

**Starter — Go.**
```go
package main

import "fmt"

func extGCD(a, b int64) (int64, int64, int64) {
	if b == 0 { return a, 1, 0 }
	g, x1, y1 := extGCD(b, a%b)
	return g, y1, x1 - (a/b)*y1
}
func main() {
	var a, b, c int64
	fmt.Scan(&a, &b, &c)
	// TODO: scale Bezout coefficients by c/g
}
```

**Starter — Java.**
```java
import java.util.Scanner;
public class Task3 {
    static long[] extGCD(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extGCD(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong(), c = sc.nextLong();
        // TODO
    }
}
```

**Starter — Python.**
```python
def ext_gcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = ext_gcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


a, b, c = map(int, input().split())
# TODO: scale and print x y
```

**Evaluation.** Assert `a*x + b*y == c` for 1000 random solvable inputs.

---

### Task 4 — Print the General Family

**Problem.** Given solvable `a, b, c`, print `x0 y0 dx dy` describing `x = x0 + dx*t`, `y = y0 − dy*t`.

**Input / Output spec.** Read `a b c`; print four integers `x0 y0 dx dy` where `dx = b/g`, `dy = a/g`.

**Constraints.** `1 ≤ a, b ≤ 10^9`, `|c| ≤ 10^9`, solvable.

**Hint.** Remember to divide the step by `g`.

**Starter — Go.**
```go
package main

import "fmt"

func extGCD(a, b int64) (int64, int64, int64) {
	if b == 0 { return a, 1, 0 }
	g, x1, y1 := extGCD(b, a%b)
	return g, y1, x1 - (a/b)*y1
}
func main() {
	var a, b, c int64
	fmt.Scan(&a, &b, &c)
	// TODO: print x0 y0 (b/g) (a/g)
}
```

**Starter — Java.**
```java
import java.util.Scanner;
public class Task4 {
    static long[] extGCD(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extGCD(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong(), c = sc.nextLong();
        // TODO
    }
}
```

**Starter — Python.**
```python
def ext_gcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = ext_gcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


a, b, c = map(int, input().split())
# TODO: print x0 y0 (b//g) (a//g)
```

**Evaluation.** For random `t`, assert `a*(x0+dx*t) + b*(y0−dy*t) == c`.

---

### Task 5 — Brute-Force Oracle

**Problem.** Implement a brute-force solver over `x, y ∈ [−50, 50]` returning any solution or "none", to validate later tasks.

**Input / Output spec.** Read `a b c`; print `x y` of the first solution found, or `none`.

**Constraints.** `|a|, |b|, |c| ≤ 100`.

**Hint.** Double loop; this is the oracle, not the production method.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var a, b, c int64
	fmt.Scan(&a, &b, &c)
	// TODO: scan x,y in [-50,50]
}
```

**Starter — Java.**
```java
import java.util.Scanner;
public class Task5 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong(), c = sc.nextLong();
        // TODO
    }
}
```

**Starter — Python.**
```python
a, b, c = map(int, input().split())
# TODO: nested loop over [-50, 50]
```

**Evaluation.** Cross-check against Task 3's closed-form solution reduced into the box.

---

## Intermediate Tasks (4)

### Task 6 — Count Non-Negative Solutions

**Problem.** Given positive `a, b, c`, count `(x, y)` with `x ≥ 0`, `y ≥ 0`, `a*x + b*y = c`.

**Input / Output spec.** Read `a b c`; print the count.

**Constraints.** `1 ≤ a, b ≤ 10^9`, `1 ≤ c ≤ 10^18`.

**Hint.** Turn `x ≥ 0` and `y ≥ 0` into a `t`-interval; count integers in it. Use floored division.

**Starter — Go.**
```go
package main

import "fmt"

func extGCD(a, b int64) (int64, int64, int64) {
	if b == 0 { return a, 1, 0 }
	g, x1, y1 := extGCD(b, a%b)
	return g, y1, x1 - (a/b)*y1
}
func floorDiv(p, q int64) int64 {
	d := p / q
	if (p%q != 0) && ((p < 0) != (q < 0)) { d-- }
	return d
}
func ceilDiv(p, q int64) int64 { return -floorDiv(-p, q) }
func main() {
	var a, b, c int64
	fmt.Scan(&a, &b, &c)
	// TODO: lo = ceil(-x0/sx), hi = floor(y0/sy), count = hi-lo+1
}
```

**Starter — Java.**
```java
import java.util.Scanner;
public class Task6 {
    static long[] extGCD(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extGCD(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }
    static long floorDiv(long p, long q) {
        long d = p / q;
        if ((p % q != 0) && ((p < 0) != (q < 0))) d--;
        return d;
    }
    static long ceilDiv(long p, long q) { return -floorDiv(-p, q); }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong(), c = sc.nextLong();
        // TODO
    }
}
```

**Starter — Python.**
```python
import math


def ext_gcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = ext_gcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


a, b, c = map(int, input().split())
# TODO: t-interval count
```

**Evaluation.** Cross-check against enumeration for `c ≤ 10^4`; expect `(6,9,21)->1`, `(2,3,10)->2`, `(3,5,7)->0`.

---

### Task 7 — Smallest Positive `x`

**Problem.** Given solvable `a, b, c`, output the smallest **positive** `x` and matching `y`.

**Input / Output spec.** Read `a b c`; print `x y`.

**Constraints.** `1 ≤ a, b ≤ 10^9`, `|c| ≤ 10^18`.

**Hint.** Reduce `x0` modulo `b/g`; if `≤ 0`, add the step. Then `y = (c − a*x)/b`.

**Starter — Go.**
```go
package main

import "fmt"

func extGCD(a, b int64) (int64, int64, int64) {
	if b == 0 { return a, 1, 0 }
	g, x1, y1 := extGCD(b, a%b)
	return g, y1, x1 - (a/b)*y1
}
func main() {
	var a, b, c int64
	fmt.Scan(&a, &b, &c)
	// TODO: x = (x'*(c/g)) mod (b/g), force positive
}
```

**Starter — Java.**
```java
import java.util.Scanner;
public class Task7 {
    static long[] extGCD(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extGCD(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong(), c = sc.nextLong();
        // TODO
    }
}
```

**Starter — Python.**
```python
def ext_gcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = ext_gcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


a, b, c = map(int, input().split())
# TODO: smallest positive x
```

**Evaluation.** Assert `a*x + b*y == c`, `x > 0`, and `x − (b/g) ≤ 0` (minimality).

---

### Task 8 — Range-Constrained Count

**Problem.** Count `(x, y)` with `a*x + b*y = c`, `xlo ≤ x ≤ xhi`, `ylo ≤ y ≤ yhi`.

**Input / Output spec.** Read `a b c xlo xhi ylo yhi`; print the count.

**Constraints.** `1 ≤ a, b ≤ 10^9`, all bounds in `[−10^18, 10^18]`.

**Hint.** Each two-sided box gives two `t`-bounds; intersect all four.

**Starter — Go.**
```go
package main

import "fmt"

func extGCD(a, b int64) (int64, int64, int64) {
	if b == 0 { return a, 1, 0 }
	g, x1, y1 := extGCD(b, a%b)
	return g, y1, x1 - (a/b)*y1
}
func main() {
	var a, b, c, xlo, xhi, ylo, yhi int64
	fmt.Scan(&a, &b, &c, &xlo, &xhi, &ylo, &yhi)
	// TODO: four t-bounds, intersect, count
}
```

**Starter — Java.**
```java
import java.util.Scanner;
public class Task8 {
    static long[] extGCD(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extGCD(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong(), c = sc.nextLong();
        long xlo = sc.nextLong(), xhi = sc.nextLong();
        long ylo = sc.nextLong(), yhi = sc.nextLong();
        // TODO
    }
}
```

**Starter — Python.**
```python
def ext_gcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = ext_gcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


a, b, c, xlo, xhi, ylo, yhi = map(int, input().split())
# TODO: range-constrained count
```

**Evaluation.** Cross-check against enumeration when ranges are small.

---

## Advanced Tasks (3)

### Task 9 — Two-Coin Frobenius Number

**Problem.** Given coprime `a, b`, output the Frobenius number and the count of non-representable non-negative integers.

**Input / Output spec.** Read `a b`; print `frobenius count`.

**Constraints.** `2 ≤ a, b ≤ 10^9`, `gcd(a, b) = 1`.

**Hint.** `F = a*b − a − b`, count `= (a−1)(b−1)/2`. Beware overflow in `a*b`.

**Starter — Go.**
```go
package main

import "fmt"

func gcd(a, b int64) int64 { for b != 0 { a, b = b, a%b }; return a }
func main() {
	var a, b int64
	fmt.Scan(&a, &b)
	// TODO: verify coprime, then formulas
}
```

**Starter — Java.**
```java
import java.util.Scanner;
public class Task9 {
    static long gcd(long a, long b) { return b == 0 ? a : gcd(b, a % b); }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong();
        // TODO
    }
}
```

**Starter — Python.**
```python
from math import gcd
a, b = map(int, input().split())
# TODO: Frobenius number and count
```

**Evaluation.** Verify against a DP "smallest representable in each residue class mod a" for small `a, b`.

---

### Task 10 — Overflow-Safe Particular Solution

**Problem.** Given `a, b, c` up to `10^18`, output the canonical solution with `x ∈ [0, b/g)` **without** 64-bit overflow.

**Input / Output spec.** Read `a b c`; print `x y` (canonical) or `no solution`.

**Constraints.** `1 ≤ a, b ≤ 10^18`, `|c| ≤ 10^18`.

**Hint.** Reduce `x'` and `c/g` modulo `b/g` before multiplying, using a 128-bit `mulmod`, or use big integers.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math/big"
)

func extGCD(a, b *big.Int) (*big.Int, *big.Int, *big.Int) {
	g := new(big.Int)
	x := new(big.Int)
	y := new(big.Int)
	g.GCD(x, y, a, b)
	return g, x, y // a*x + b*y = g
}
func main() {
	var as, bs, cs string
	fmt.Scan(&as, &bs, &cs)
	a, _ := new(big.Int).SetString(as, 10)
	b, _ := new(big.Int).SetString(bs, 10)
	c, _ := new(big.Int).SetString(cs, 10)
	// TODO: scale, canonicalize x into [0, b/g) using big.Int
	_ = a; _ = b; _ = c
}
```

**Starter — Java.**
```java
import java.math.BigInteger;
import java.util.Scanner;
public class Task10 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        BigInteger a = sc.nextBigInteger(), b = sc.nextBigInteger(), c = sc.nextBigInteger();
        BigInteger g = a.gcd(b);
        if (!c.mod(g.equals(BigInteger.ZERO) ? BigInteger.ONE : g).equals(BigInteger.ZERO)) {
            // TODO: solvability + extended gcd via BigInteger; canonicalize x
        }
        // TODO
    }
}
```

**Starter — Python.**
```python
a, b, c = map(int, input().split())
# Python big ints never overflow; still canonicalize x into [0, b//g)
# TODO
```

**Evaluation.** Assert `a*x + b*y == c` exactly and `0 ≤ x < b/g` for adversarial near-`2^63` inputs.

---

### Task 11 — Linear Congruence Solver (CRT building block)

**Problem.** Solve `a*x ≡ c (mod m)` for all solutions `x` in `[0, m)`.

**Input / Output spec.** Read `a c m`; print the number of solutions then each solution ascending, or `no solution`.

**Constraints.** `1 ≤ a, m ≤ 10^9`, `0 ≤ c < m`.

**Hint.** This is `a*x − m*y = c`. Solvable iff `gcd(a, m) | c`; there are exactly `gcd(a, m)` solutions, `x0 + (m/g)·k` for `k = 0..g−1`.

**Starter — Go.**
```go
package main

import "fmt"

func extGCD(a, b int64) (int64, int64, int64) {
	if b == 0 { return a, 1, 0 }
	g, x1, y1 := extGCD(b, a%b)
	return g, y1, x1 - (a/b)*y1
}
func main() {
	var a, c, m int64
	fmt.Scan(&a, &c, &m)
	// TODO: g=gcd(a,m); if c%g!=0 -> no solution; else g solutions spaced m/g
}
```

**Starter — Java.**
```java
import java.util.Scanner;
public class Task11 {
    static long[] extGCD(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extGCD(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), c = sc.nextLong(), m = sc.nextLong();
        // TODO
    }
}
```

**Starter — Python.**
```python
def ext_gcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = ext_gcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


a, c, m = map(int, input().split())
# TODO: enumerate the g solutions in [0, m)
```

**Evaluation.** Brute-force check: for each printed `x`, assert `(a*x − c) % m == 0`; confirm exactly `gcd(a, m)` solutions for solvable inputs.

---

## Submission Checklist

- [ ] Solvability checked (`gcd(a,b) | c`) before any scaling.
- [ ] Step vector divided by `g` — `(b/g, −a/g)`, never `(b, −a)`.
- [ ] Counting done via `t`-interval, not enumeration.
- [ ] Floored/ceiled division used for bounds (no float rounding).
- [ ] Degenerate cases handled: `a = 0`, `b = 0`, both zero.
- [ ] Overflow guarded for inputs near `10^18` (reduce-before-multiply or big integers).
- [ ] All three languages produce identical results on the shared test set.
- [ ] Each solver validated against the brute-force oracle on small inputs.
