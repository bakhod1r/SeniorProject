# Linear Diophantine Equations — Interview Preparation

Linear Diophantine equations are a favourite interview topic because they reward one crisp insight — *"`a*x + b*y = c` is solvable iff `gcd(a, b) | c`, and all solutions are `x = x0 + (b/g)t`, `y = y0 − (a/g)t`"* — and then test whether you can (a) build one solution with extended Euclid, (b) characterize *all* solutions, (c) **count** the constrained ones in `O(1)`, and (d) recognize the same idea behind the coin/Frobenius and Chicken McNugget problems. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Is `a*x + b*y = c` solvable? | `gcd(a,b) | c` | `O(log min(a,b))` |
| One solution | extended Euclid + scale by `c/g` | `O(log min(a,b))` |
| All solutions | `x = x0 + (b/g)t`, `y = y0 − (a/g)t` | `O(1)` to describe |
| Count `x, y ≥ 0` | intersect two `t`-bounds | `O(1)` |
| Count `x, y` in a box | intersect four `t`-bounds | `O(1)` |
| Smallest positive `x` | reduce `x0` mod `b/g` | `O(1)` |
| Largest `c` not non-neg representable (coprime) | Frobenius `a·b − a − b` | `O(1)` |
| # non-representable (coprime) | `(a−1)(b−1)/2` | `O(1)` |
| Modular eq `a·x ≡ c (mod m)` | Diophantine `a·x − m·y = c` | `O(log)` |

Core algorithm:

```text
solve(a, b, c):
    (g, x', y') = extGCD(a, b)        # a*x' + b*y' = g
    if a==0 and b==0: return c==0      # degenerate
    if c % g != 0: return NO_SOLUTION  # solvability condition
    x0 = x' * (c/g);  y0 = y' * (c/g)  # particular (scale Bezout)
    step = (b/g, -a/g)                 # family generator
    return x0, y0, step
```

Key facts:
- **Solvable iff `gcd(a,b)` divides `c`.**
- Step by `(b/g, −a/g)` — divide by `g` or you skip solutions.
- Counting constrained solutions = counting integers in a `t`-interval.
- Solvable over ℤ ≠ solvable with `x, y ≥ 0` (that gap is Frobenius).

---

## Junior Questions (10 Q&A)

### J1. What is a linear Diophantine equation?
An equation `a*x + b*y = c` with integer coefficients where we require **integer** solutions `x, y`. The integrality is the whole point — over the reals it is just a line with infinitely many trivial points.

### J2. When does `a*x + b*y = c` have a solution?
Exactly when `g = gcd(a, b)` divides `c`. Every value of `a*x + b*y` is a multiple of `g`, so if `g ∤ c` no combination reaches `c`; if `g | c`, scaling Bezout coefficients reaches it.

### J3. How do you find one solution?
Run the extended Euclidean algorithm to get `x', y'` with `a*x' + b*y' = g`. Multiply through by `c/g`: `x0 = x'·(c/g)`, `y0 = y'·(c/g)`.

### J4. What is the general solution?
`x = x0 + (b/g)t`, `y = y0 − (a/g)t` for every integer `t`. Adding the step vector `(b/g, −a/g)` keeps `a*x + b*y` unchanged.

### J5. Why divide the step by `g`?
Because `(b/g, −a/g)` is the *primitive* (shortest) homogeneous solution. Stepping by `(b, −a)` jumps over `g − 1` valid solutions between each one.

### J6. What does the step vector solve?
The homogeneous equation `a*x + b*y = 0`. Its integer solutions are exactly the multiples of `(b/g, −a/g)`.

### J7. Give a concrete unsolvable example.
`6x + 9y = 7`: `gcd(6, 9) = 3`, and `3 ∤ 7`, so there is no integer solution.

### J8. What if `c = 0`?
Always solvable; `(0, 0)` works, and all solutions are `((b/g)t, −(a/g)t)`.

### J9. What if `a = 0`?
`b*y = c`: solvable iff `b | c`, with `y = c/b` and `x` free (any integer).

### J10. Does a solution over ℤ guarantee one with `x, y ≥ 0`?
No. `3x + 5y = 7` is solvable over ℤ but has no non-negative solution (7 is the Frobenius number of {3, 5}).

---

## Middle Questions (8 Q&A)

### M1. How do you count solutions with `x ≥ 0` and `y ≥ 0`?
Write `x = x0 + (b/g)t ≥ 0` and `y = y0 − (a/g)t ≥ 0`. Each becomes a bound on `t` (sign of the coefficient decides direction). Intersect the two intervals; the count is `max(0, U − L + 1)`.

### M2. How do you count solutions with `x, y` in a box?
Two-sided constraints give four `t`-bounds total. Intersect all four; count integers in the resulting interval. Still `O(1)`.

### M3. Why must you use integer ceil/floor, not floats?
For large inputs floating-point division loses precision, putting a bound off by one and corrupting the count. Use floored integer division and derive ceil as `ceil(p/q) = −floor(−p/q)`.

### M4. What is the Frobenius number of two coprime coins?
`F(a, b) = a·b − a − b` — the largest amount not representable with non-negative `x, y`. Example: `F(3, 5) = 7`.

### M5. How many amounts are non-representable (coprime two coins)?
Exactly `(a − 1)(b − 1)/2`. For {3, 5}: `2·4/2 = 4`, namely {1, 2, 4, 7}.

### M6. What is the Chicken McNugget theorem?
The popular name for the two-coin Frobenius result: with nuggets sold in coprime box sizes `a, b`, the largest number you cannot buy exactly is `a·b − a − b`.

### M7. How is a modular equation a Diophantine equation?
`a·x ≡ c (mod m)` is `a·x − m·y = c`. Solvable iff `gcd(a, m) | c`, with `gcd(a, m)` solutions mod `m`. Solving for the smallest non-negative `x` is the CRT merge step.

### M8. How does the water-jug puzzle relate?
Measuring `c` litres with jugs `a, b` is solvable iff `gcd(a, b) | c` (and `c ≤ max(a,b)`); a concrete solution `a·x + b·y = c` gives the net fills/empties.

---

## Senior Questions (7 Q&A)

### S1. Where does overflow strike and how do you prevent it?
In `x0 = x'·(c/g)`, where `|x'|` can be `~b/2` and `c/g ~ c`, so the product can reach `~10^35` for 64-bit inputs. Fix: reduce `x'` and `c/g` modulo the step `b/g` before multiplying (when you only need the canonical `x`), or use 128-bit `mulmod`.

### S2. How do you handle `a = 0`, `b = 0`, or both?
`a=0`: solvable iff `b | c`, `y = c/b`, `x` free. `b=0`: symmetric. Both zero: solvable iff `c = 0`, and then *every* pair works (infinite, unconstrained) — return a sentinel, never 0.

### S3. How do you make the output deterministic across languages?
Canonicalize: emit the solution with `x ∈ [0, |b/g|)` via `x0 = ((x'·c/g) mod |b/g| + |b/g|) mod |b/g|`. This also bounds the magnitude and prevents overflow.

### S4. How do you count when ranges are size `10^18`?
The count is still `O(1)` (a `t`-interval), but the count *value* may exceed `2^63`; compute `U − L + 1` in 128-bit or big integers, and use overflow-safe ceil/floor for the bounds.

### S5. How do you test a solver when brute force is infeasible?
Plug-back invariant `a*x0 + b*y0 == c`; step invariant `a*(b/g) + b*(−a/g) == 0`; property-based generation of guaranteed-solvable instances by choosing `t` and setting `c`; small-range enumeration cross-check; an edge matrix run in all languages.

### S6. Negative `%` bites you where?
When normalizing `x0 mod (b/g)` in Go/Java/C, `%` may return a negative; use `((x % m) + m) % m`. Also when deriving `t`-bounds with truncating division — use a floored-division helper.

### S7. Why does `|x'| ≤ b/(2g)` matter?
It bounds the Bezout coefficient, which lets you reason about overflow precisely and is the reason the canonical reduction keeps everything in range. It comes from the continued-fraction convergent bound.

---

## More Middle Questions (4 Q&A)

### M9. How do you find the smallest positive `x` solution?
Take the canonical `x0 = (x'·c/g) mod (b/g)`, normalized to `(0, b/g]` (add the step if it lands on 0). Then `y = (c − a·x0)/b`. This is the standard CRT-merge primitive and runs in `O(1)` after the gcd.

### M10. A box constraint `0 ≤ x ≤ X`, `0 ≤ y ≤ Y` — how many solutions?
Four `t`-bounds: `x ≥ 0` and `x ≤ X` (two), `y ≥ 0` and `y ≤ Y` (two). Intersect all four into `[L, U]`; the count is `max(0, U − L + 1)`. Still `O(1)`; only the number of bounds grows, not the complexity.

### M11. Why is the count an arithmetic-progression count rather than a search?
Because solutions are equally spaced in `t` with no gaps. "How many terms of an arithmetic progression lie in `[L, U]`?" is `U − L + 1`, pure arithmetic — there is nothing to discover by walking the sequence, which is why counting is `O(1)` while *listing* is `O(m)`.

### M12. How does `gcd(a, b) > 1` change the Frobenius question?
Only multiples of `g` are representable at all, so there are infinitely many non-representable integers and `F` is undefined. Divide `a, b` by `g` first; the reduced coprime pair's Frobenius number times `g` gives the largest non-representable *multiple of `g`*.

---

## More Senior Questions (3 Q&A)

### S8. Your counter returns a negative number. What happened?
The final `U − L + 1` overflowed `int64` because the count itself exceeds `2^63` (huge ranges), or you forgot the `max(0, …)` guard so an empty interval produced a negative. Fix: guard with `max(0, …)`, and compute the count in 128-bit / big integers when Corollary-style bounds show it can exceed `2^63`.

### S9. How do you guarantee two language implementations produce identical output?
Define a canonical particular solution (`x ∈ [0, |b/g|)`), run a shared edge-case matrix (`a`/`b`/both zero, negatives, `c = 0`) across all languages, and add property-based differential tests that construct guaranteed-solvable instances by choosing `t` and setting `c`.

### S10. When is plain 64-bit arithmetic provably safe, and how do you know?
When the box width satisfies `xhi − xlo < 2^63·(b/g)`, the count is `< 2^63` (consecutive solutions differ by `b/g` in `x`), so 64-bit suffices. Check this precondition once at the boundary and escalate to big integers only on violation, keeping the common path fast.

---

## Behavioral Prompts

- **"Describe a time you used a closed-form formula instead of brute force."** Talk about replacing an `O(R²)` search with the `gcd`-based `O(log)` solve, and how you validated it against the brute-force oracle on small inputs before trusting it.
- **"How do you guard a numeric routine against overflow in production?"** Discuss bounding factors, 128-bit intermediates, reducing before multiplying, and plug-back assertions in tests.
- **"How do you ensure two implementations agree?"** Canonical forms, a shared edge-case matrix, and property-based differential testing.
- **"How do you explain solvability to a non-mathematician?"** Use the vending-machine analogy: 6- and 9-cent buttons can only ever total multiples of 3.
- **"A teammate's counter is off by one. How do you debug?"** Check ceil-vs-floor, inclusive bounds, and whether they flipped the inequality for a negative step coefficient; reproduce with the smallest failing case.

---

## Coding Challenge 1: Solve `a*x + b*y = c`

**Problem.** Given `a, b, c`, output any integer solution `(x, y)` or report "no solution".

### Go
```go
package main

import "fmt"

func extGCD(a, b int64) (int64, int64, int64) {
	if b == 0 {
		return a, 1, 0
	}
	g, x1, y1 := extGCD(b, a%b)
	return g, y1, x1 - (a/b)*y1
}

func main() {
	var a, b, c int64
	fmt.Scan(&a, &b, &c)
	g, x1, y1 := extGCD(a, b)
	if g == 0 {
		if c == 0 {
			fmt.Println("0 0")
		} else {
			fmt.Println("no solution")
		}
		return
	}
	if c%g != 0 {
		fmt.Println("no solution")
		return
	}
	fmt.Println(x1*(c/g), y1*(c/g))
}
```

### Java
```java
import java.util.Scanner;

public class SolveDiophantine {
    static long[] extGCD(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extGCD(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong(), c = sc.nextLong();
        long[] e = extGCD(a, b);
        long g = e[0];
        if (g == 0) { System.out.println(c == 0 ? "0 0" : "no solution"); return; }
        if (c % g != 0) { System.out.println("no solution"); return; }
        System.out.println(e[1] * (c / g) + " " + e[2] * (c / g));
    }
}
```

### Python
```python
def ext_gcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = ext_gcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


def main():
    a, b, c = map(int, input().split())
    g, x1, y1 = ext_gcd(a, b)
    if g == 0:
        print("0 0" if c == 0 else "no solution")
        return
    if c % g != 0:
        print("no solution")
        return
    print(x1 * (c // g), y1 * (c // g))


main()
```

---

## Coding Challenge 2: Count Non-Negative Solutions

**Problem.** Given positive `a, b, c`, count pairs `(x, y)` with `x ≥ 0`, `y ≥ 0` and `a*x + b*y = c`.

### Go
```go
package main

import "fmt"

func extGCD(a, b int64) (int64, int64, int64) {
	if b == 0 {
		return a, 1, 0
	}
	g, x1, y1 := extGCD(b, a%b)
	return g, y1, x1 - (a/b)*y1
}
func floorDiv(p, q int64) int64 {
	d := p / q
	if (p%q != 0) && ((p < 0) != (q < 0)) {
		d--
	}
	return d
}
func ceilDiv(p, q int64) int64 { return -floorDiv(-p, q) }

func main() {
	var a, b, c int64
	fmt.Scan(&a, &b, &c)
	g, x1, y1 := extGCD(a, b)
	if c%g != 0 {
		fmt.Println(0)
		return
	}
	x0, y0 := x1*(c/g), y1*(c/g)
	sx, sy := b/g, a/g // x=x0+sx*t, y=y0-sy*t
	// x0+sx*t>=0 -> t>=ceil(-x0/sx); y0-sy*t>=0 -> t<=floor(y0/sy)
	lo := ceilDiv(-x0, sx)
	hi := floorDiv(y0, sy)
	if lo > hi {
		fmt.Println(0)
	} else {
		fmt.Println(hi - lo + 1)
	}
}
```

### Java
```java
import java.util.Scanner;

public class CountNonNeg {
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
        long[] e = extGCD(a, b);
        long g = e[0];
        if (c % g != 0) { System.out.println(0); return; }
        long x0 = e[1] * (c / g), y0 = e[2] * (c / g);
        long sx = b / g, sy = a / g;
        long lo = ceilDiv(-x0, sx), hi = floorDiv(y0, sy);
        System.out.println(lo > hi ? 0 : hi - lo + 1);
    }
}
```

### Python
```python
import math


def ext_gcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = ext_gcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


def main():
    a, b, c = map(int, input().split())
    g, x1, y1 = ext_gcd(a, b)
    if c % g != 0:
        print(0)
        return
    x0, y0 = x1 * (c // g), y1 * (c // g)
    sx, sy = b // g, a // g
    lo = math.ceil(-x0 / sx)
    hi = math.floor(y0 / sy)
    print(max(0, hi - lo + 1) if lo <= hi else 0)


main()
```

---

## Coding Challenge 3: Smallest Positive `x`

**Problem.** Given `a, b, c` with a solution, output the smallest **positive** `x` and its matching `y`.

### Go
```go
package main

import "fmt"

func extGCD(a, b int64) (int64, int64, int64) {
	if b == 0 {
		return a, 1, 0
	}
	g, x1, y1 := extGCD(b, a%b)
	return g, y1, x1 - (a/b)*y1
}

func main() {
	var a, b, c int64
	fmt.Scan(&a, &b, &c)
	g, x1, _ := extGCD(a, b)
	if c%g != 0 {
		fmt.Println("no solution")
		return
	}
	step := b / g
	if step < 0 {
		step = -step
	}
	x := (x1 * (c / g)) % step
	if x <= 0 {
		x += step
	}
	y := (c - a*x) / b
	fmt.Println(x, y)
}
```

### Java
```java
import java.util.Scanner;

public class SmallestPositiveX {
    static long[] extGCD(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extGCD(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong(), c = sc.nextLong();
        long[] e = extGCD(a, b);
        long g = e[0];
        if (c % g != 0) { System.out.println("no solution"); return; }
        long step = Math.abs(b / g);
        long x = (e[1] * (c / g)) % step;
        if (x <= 0) x += step;
        long y = (c - a * x) / b;
        System.out.println(x + " " + y);
    }
}
```

### Python
```python
def ext_gcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = ext_gcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


def main():
    a, b, c = map(int, input().split())
    g, x1, _ = ext_gcd(a, b)
    if c % g != 0:
        print("no solution")
        return
    step = abs(b // g)
    x = (x1 * (c // g)) % step
    if x <= 0:
        x += step
    y = (c - a * x) // b
    print(x, y)


main()
```

---

## Coding Challenge 4: Two-Coin Frobenius (Chicken McNugget)

**Problem.** Given two **coprime** positive integers `a, b`, output the Frobenius number `a*b − a − b` and the count of non-representable non-negative integers `(a−1)(b−1)/2`.

### Go
```go
package main

import "fmt"

func gcd(a, b int64) int64 {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func main() {
	var a, b int64
	fmt.Scan(&a, &b)
	if gcd(a, b) != 1 {
		fmt.Println("not coprime: Frobenius number undefined")
		return
	}
	frob := a*b - a - b
	cnt := (a - 1) * (b - 1) / 2
	fmt.Println(frob, cnt)
}
```

### Java
```java
import java.util.Scanner;

public class Frobenius {
    static long gcd(long a, long b) { return b == 0 ? a : gcd(b, a % b); }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong();
        if (gcd(a, b) != 1) {
            System.out.println("not coprime: Frobenius number undefined");
            return;
        }
        System.out.println((a * b - a - b) + " " + ((a - 1) * (b - 1) / 2));
    }
}
```

### Python
```python
from math import gcd


def main():
    a, b = map(int, input().split())
    if gcd(a, b) != 1:
        print("not coprime: Frobenius number undefined")
        return
    frob = a * b - a - b
    cnt = (a - 1) * (b - 1) // 2
    print(frob, cnt)


main()
```

**Sample:** input `3 5` → output `7 4` (largest unbuyable is 7; four numbers 1,2,4,7 are unbuyable).

---

## Coding Challenge 5: Count Solutions in a Box

**Problem.** Given `a, b, c` and a box `0 ≤ x ≤ X`, `0 ≤ y ≤ Y`, count integer solutions of `a*x + b*y = c` inside the box. This is the four-bound generalization of Challenge 2 and the most common "real" counting query.

### Go
```go
package main

import "fmt"

func extGCD(a, b int64) (int64, int64, int64) {
	if b == 0 {
		return a, 1, 0
	}
	g, x1, y1 := extGCD(b, a%b)
	return g, y1, x1 - (a/b)*y1
}
func floorDiv(p, q int64) int64 {
	d := p / q
	if (p%q != 0) && ((p < 0) != (q < 0)) {
		d--
	}
	return d
}
func ceilDiv(p, q int64) int64 { return -floorDiv(-p, q) }

func main() {
	var a, b, c, X, Y int64
	fmt.Scan(&a, &b, &c, &X, &Y)
	g, x1, y1 := extGCD(a, b)
	if c%g != 0 {
		fmt.Println(0)
		return
	}
	x0, y0 := x1*(c/g), y1*(c/g)
	sx, sy := b/g, a/g // x = x0 + sx*t, y = y0 - sy*t
	// 0 <= x0+sx*t <= X  and  0 <= y0-sy*t <= Y
	lo := ceilDiv(-x0, sx)          // x >= 0
	hi := floorDiv(X-x0, sx)        // x <= X
	lo = maxi(lo, ceilDiv(y0-Y, sy)) // y <= Y -> sy*t >= y0-Y
	hi = mini(hi, floorDiv(y0, sy))  // y >= 0 -> sy*t <= y0
	if lo > hi {
		fmt.Println(0)
	} else {
		fmt.Println(hi - lo + 1)
	}
}
func maxi(a, b int64) int64 { if a > b { return a }; return b }
func mini(a, b int64) int64 { if a < b { return a }; return b }
```

### Java
```java
import java.util.Scanner;

public class CountInBox {
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
        long X = sc.nextLong(), Y = sc.nextLong();
        long[] e = extGCD(a, b);
        long g = e[0];
        if (c % g != 0) { System.out.println(0); return; }
        long x0 = e[1] * (c / g), y0 = e[2] * (c / g);
        long sx = b / g, sy = a / g;
        long lo = ceilDiv(-x0, sx);
        long hi = floorDiv(X - x0, sx);
        lo = Math.max(lo, ceilDiv(y0 - Y, sy));
        hi = Math.min(hi, floorDiv(y0, sy));
        System.out.println(lo > hi ? 0 : hi - lo + 1);
    }
}
```

### Python
```python
def ext_gcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = ext_gcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


def floor_div(p, q):
    return p // q if q > 0 else -((-p) // (-q))


def ceil_div(p, q):
    return -floor_div(-p, q)


def main():
    a, b, c, X, Y = map(int, input().split())
    g, x1, y1 = ext_gcd(a, b)
    if c % g != 0:
        print(0)
        return
    x0, y0 = x1 * (c // g), y1 * (c // g)
    sx, sy = b // g, a // g
    lo = ceil_div(-x0, sx)
    hi = floor_div(X - x0, sx)
    lo = max(lo, ceil_div(y0 - Y, sy))
    hi = min(hi, floor_div(y0, sy))
    print(max(0, hi - lo + 1) if lo <= hi else 0)


main()
```

**Sample:** input `2 3 12 5 10` (count `2x + 3y = 12` with `0 ≤ x ≤ 5`, `0 ≤ y ≤ 10`) → output `2`. The non-negative solutions of `2x + 3y = 12` are `(0, 4)`, `(3, 2)`, `(6, 0)`; the box `x ≤ 5` excludes `(6, 0)`, leaving `(0, 4)` and `(3, 2)`. The key interview point is that two extra bounds turn Challenge 2 into a box count with no change in complexity. Note the Go/Java code assumes positive `sx, sy` (true for positive `a, b`); for fully general signs, sign-branch each bound as in the senior solver.

---

## Closing Tips

- State the **solvability condition** first in any answer: `gcd(a, b) | c`. It frames everything.
- Always write the general family as `x = x0 + (b/g)t`, `y = y0 − (a/g)t`, and stress dividing by `g`.
- For counting, say "I turn each constraint into a bound on `t` and count integers in the interval" — it signals `O(1)` thinking.
- Distinguish "solvable over ℤ" from "non-negative solution exists"; bring up Frobenius `a·b − a − b` for the two-coin gap.
- Mention overflow and the plug-back check unprompted at senior level — it shows production maturity.
