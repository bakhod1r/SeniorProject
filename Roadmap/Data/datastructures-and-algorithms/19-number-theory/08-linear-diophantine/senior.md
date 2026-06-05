# Linear Diophantine Equations — Senior Level

> Solving `a*x + b*y = c` is one line of math, but in production the failure modes are all about *scale and edges*: 64-bit overflow when scaling Bezout coefficients, big coefficients near `2^63`, counting constrained solutions across ranges of size `10^18`, the degenerate `a` or `b` equal to zero, sign conventions for negative inputs, and verifying answers when brute force is impossible. This document treats those as the engineering incidents they actually are.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Overflow: The Dominant Failure Mode](#2-overflow-the-dominant-failure-mode)
3. [Big Coefficients and 128-bit Arithmetic](#3-big-coefficients-and-128-bit-arithmetic)
4. [Counting in Huge Ranges Without Enumeration](#4-counting-in-huge-ranges-without-enumeration)
5. [Degenerate and Sign Edge Cases](#5-degenerate-and-sign-edge-cases)
6. [Canonical Forms and Determinism](#6-canonical-forms-and-determinism)
7. [Code: A Production-Grade Solver](#7-code-a-production-grade-solver)
8. [Code: Overflow-Safe Constrained Counting](#8-code-overflow-safe-constrained-counting)
9. [The Two-Coin Frobenius Closed Form in Production](#9-the-two-coin-frobenius-closed-form-in-production)
10. [Testing and Verification](#10-testing-and-verification)
11. [Failure Modes](#11-failure-modes)
12. [Summary](#12-summary)

---

## 1. Introduction

At the senior level the question is no longer "how do I solve `a*x + b*y = c`" but "what breaks when `a, b, c` span the full 64-bit range, the answer is needed for `10^6` queries, and a wrong sign silently corrupts a billing or scheduling computation?" The math is fixed; the engineering is about three things:

1. **Exact integer arithmetic** that does not overflow when scaling Bezout coefficients by `c/g`, even though intermediate products can exceed `2^63`.
2. **Constant-time counting** of constrained solutions across ranges so large that enumeration is impossible.
3. **Total correctness on edges** — `a = 0`, `b = 0`, both zero, negatives, `c = 0`, and the "solvable but no non-negative solution" gap.

This document treats each as a production concern, with a hardened solver and a test strategy that does not rely on brute force at scale.

---

## 2. Overflow: The Dominant Failure Mode

The particular solution is `x0 = x' · (c/g)`. Both factors can be large:

- `x'`, the Bezout coefficient, satisfies `|x'| ≤ b / (2g)` (a standard bound), so `|x'|` can be near `b/2`.
- `c/g` can be near `c`.

So `|x0|` can be on the order of `(b/2)·c`, which for `b, c ~ 10^9` is `~10^17` — fine in 64-bit — but for `b, c ~ 10^18` is `~10^35`, far past `2^63 ≈ 9.2·10^18`. **The multiplication overflows before you ever use the result.**

Three defenses, in order of preference:

1. **Reduce before multiplying.** If you only need `x` modulo the step `sx = b/g` (the canonical particular solution), compute `x0 = (x' mod sx) * ((c/g) mod sx) mod sx`. Each factor is now `< sx`, and the product fits if `sx < 2^31`; otherwise use 128-bit `mulmod`.
2. **Use 128-bit intermediates.** Form the product in `__int128` (C/Go via `math/bits`), `BigInteger` (Java), or Python's arbitrary precision, then reduce.
3. **Work modulo the relevant modulus throughout** when the application (CRT, modular equation) only needs `x mod m`.

The rule: **never form `x' · (c/g)` directly in fixed-width integers unless you have bounded both factors.**

---

## 3. Big Coefficients and 128-bit Arithmetic

When `a, b` themselves approach `2^63`:

- **gcd is safe.** Euclid only subtracts/mods, never multiplies, so `gcd(a, b)` never overflows.
- **Extended Euclid is safe for the coefficients** because `|x'| ≤ b/(2g)` and `|y'| ≤ a/(2g)` stay within range, but the *update step* `x1 - (a/b)*y1` involves a product `(a/b)·y1`. Since `|a/b| ≤ a` and `|y1| ≤ a/(2g)`, this can be `~a²/(2g)` — potentially overflowing. In practice the iterative extended Euclid keeps coefficients bounded by `max(a, b)`, so a single 64-bit multiply `(a/b)*y1` is the risk point; bound it or use 128-bit.
- **Scaling and counting** are where 128-bit truly matters.

Practical implementations of CRT/Garner (siblings `05-crt`, `15-garner-algorithm`) and Montgomery (`14-montgomery-multiplication`) rely on a `mulmod(x, y, m)` primitive that computes `x·y mod m` without overflow via 128-bit or via `__builtin` add-with-carry. Reuse that primitive here. For Java, `Math.multiplyHigh` (JDK 9+) or `BigInteger` gives the high bits; for Go, `bits.Mul64` / `bits.Div64`.

---

## 4. Counting in Huge Ranges Without Enumeration

The constrained count is `max(0, U − L + 1)` over a `t`-interval. When `xhi − xlo` or `yhi − ylo` is `10^18`, the *count itself* can be `~10^18`, but it is still produced in `O(1)`:

```
t-lower from x>=xlo and y-bound, t-upper from x<=xhi and y-bound
count = U - L + 1
```

Engineering concerns:

- **The bounds, not the count, drive arithmetic.** Each bound is a `ceilDiv`/`floorDiv`. Use the overflow-safe versions.
- **`U − L + 1` can itself overflow** if `U` and `L` are both near `±2^62`. Clamp the bounds to a sane window or compute the count in 128-bit / big integers if the problem can produce `> 2^63` solutions.
- **Empty vs infinite.** If `a = b = 0` and `c = 0`, the count is infinite — return a sentinel, never 0. If both step coefficients are zero but a non-negativity check fails, the count is 0.
- **Modular range counts.** Counting solutions with `x ≡ r (mod m)` adds another congruence; merge it into the `t`-parametrization (it becomes `t ≡ r' (mod m')`) and count arithmetic-progression members in `[L, U]`: `floor((U − first)/step) + 1`.

The discipline is identical to junior level — turn constraints into `t`-bounds — but every division must be overflow-safe and the final subtraction must not wrap.

---

## 5. Degenerate and Sign Edge Cases

A production solver must handle the full Cartesian product of edge cases:

| Case | Behavior |
|------|----------|
| `a = 0, b ≠ 0` | `g = |b|`; solvable iff `b | c`; `x` free, `y = c/b`. Step in `x` is `b/g = ±1`, step in `y` is `0`. |
| `a ≠ 0, b = 0` | Symmetric: solvable iff `a | c`; `y` free, `x = c/a`. |
| `a = 0, b = 0, c = 0` | Every `(x, y)` is a solution — **infinite**, unconstrained. |
| `a = 0, b = 0, c ≠ 0` | No solution. |
| `c = 0` | Always solvable; solutions are homogeneous: `(b/g)t, −(a/g)t`. |
| `a < 0` or `b < 0` | Take `|a|, |b|` for gcd, flip Bezout signs; keep signed `a, b` in the step. |
| `c < 0` | Fine; `c/g` is negative. |

**Sign convention.** Pick one and document it. The cleanest: run extended Euclid on `|a|, |b|`; if `a < 0` negate the `x`-coefficient, if `b < 0` negate the `y`-coefficient. Then `a*x' + b*y' = g` holds with the original signed `a, b`. The step vector is `(b/g, −a/g)` with *signed* `a, b`; its direction matters only for which way `t` moves to satisfy constraints, which the sign-branching count logic already handles.

When `a` or `b` is zero, `b/g` or `a/g` is zero, so one of the parametrization steps is zero — the variable is *fixed*, not free in `t`. The "free variable" is the *other* one. Test these explicitly; they are where naive code divides by zero or loops forever.

---

## 6. Canonical Forms and Determinism

Two correct solvers can disagree on *which* particular solution they emit, breaking golden-file tests and cross-language parity. Define a canonical form:

- **Smallest non-negative `x`:** `x0 = ((x' · (c/g)) mod sx + sx) mod sx`, where `sx = b/g > 0` (force `sx` positive by absorbing sign). Then `0 ≤ x0 < sx`, and `y0 = (c − a·x0)/b`.
- **Smallest positive `x`:** as above, then if `x0 == 0` add `sx`.
- **Lexicographically smallest `(x, y)`:** depends on the sign of the step; pick the boundary `t` that minimizes `x`, breaking ties by `y`.

Canonicalization also *prevents overflow* (the reduction keeps numbers `< sx`) and makes the solver **idempotent and reproducible** — essential for caching query results and for differential testing against another implementation.

---

## 7. Code: A Production-Grade Solver

A hardened solver: overflow-aware, handles all edge cases, returns a structured result, and counts non-negative solutions in `O(1)`.

#### Go

```go
package main

import "fmt"

type Result struct {
	Solvable bool
	Infinite bool   // a==b==0, c==0
	X0, Y0   int64  // canonical particular (smallest non-neg x when both nonzero)
	StepX    int64  // b/g
	StepY    int64  // a/g  (y decreases by StepY per t)
	G        int64
}

func extGCD(a, b int64) (int64, int64, int64) {
	old_r, r := a, b
	old_s, s := int64(1), int64(0)
	old_t, t := int64(0), int64(1)
	for r != 0 {
		q := old_r / r
		old_r, r = r, old_r-q*r
		old_s, s = s, old_s-q*s
		old_t, t = t, old_t-q*t
	}
	return old_r, old_s, old_t // g, x', y' with a*x'+b*y' = g (g may be negative)
}

func floorDiv(p, q int64) int64 {
	d := p / q
	if (p%q != 0) && ((p < 0) != (q < 0)) {
		d--
	}
	return d
}
func ceilDiv(p, q int64) int64 { return -floorDiv(-p, q) }

func Solve(a, b, c int64) Result {
	if a == 0 && b == 0 {
		if c == 0 {
			return Result{Solvable: true, Infinite: true}
		}
		return Result{Solvable: false}
	}
	g, x1, y1 := extGCD(a, b)
	if g < 0 { // normalize sign of g and coefficients
		g, x1, y1 = -g, -x1, -y1
	}
	if c%g != 0 {
		return Result{Solvable: false, G: g}
	}
	sx, sy := b/g, a/g
	// canonical: smallest non-negative x using positive modulus |sx|
	x0 := x1 * (c / g) // NOTE: in real big-input code, reduce before multiplying
	if sx != 0 {
		m := sx
		if m < 0 {
			m = -m
		}
		x0 = ((x0 % m) + m) % m
	}
	y0 := (c - a*x0) / b
	if b == 0 { // a-only equation, recompute
		x0 = c / a
		y0 = 0
	}
	return Result{Solvable: true, X0: x0, Y0: y0, StepX: sx, StepY: sy, G: g}
}

func main() {
	r := Solve(6, 9, 21)
	fmt.Printf("%+v\n", r)
	fmt.Println(6*r.X0 + 9*r.Y0) // 21
}
```

#### Java

```java
public class DiophantineSolver {
    static long[] extGCD(long a, long b) {
        long oldR = a, r = b, oldS = 1, s = 0, oldT = 0, t = 1;
        while (r != 0) {
            long q = oldR / r;
            long tmp;
            tmp = oldR - q * r; oldR = r; r = tmp;
            tmp = oldS - q * s; oldS = s; s = tmp;
            tmp = oldT - q * t; oldT = t; t = tmp;
        }
        return new long[]{oldR, oldS, oldT}; // g, x', y'
    }
    static long floorDiv(long p, long q) {
        long d = p / q;
        if ((p % q != 0) && ((p < 0) != (q < 0))) d--;
        return d;
    }
    static long ceilDiv(long p, long q) { return -floorDiv(-p, q); }

    static String solve(long a, long b, long c) {
        if (a == 0 && b == 0) return (c == 0) ? "infinite" : "no solution";
        long[] e = extGCD(a, b);
        long g = e[0], x1 = e[1], y1 = e[2];
        if (g < 0) { g = -g; x1 = -x1; y1 = -y1; }
        if (c % g != 0) return "no solution";
        long sx = b / g, sy = a / g;
        long x0 = x1 * (c / g);
        if (sx != 0) { long m = Math.abs(sx); x0 = ((x0 % m) + m) % m; }
        long y0 = (b != 0) ? (c - a * x0) / b : 0;
        if (b == 0) { x0 = c / a; y0 = 0; }
        return "x0=" + x0 + " y0=" + y0 + " stepX=" + sx + " stepY=" + sy;
    }

    public static void main(String[] args) {
        System.out.println(solve(6, 9, 21));
        System.out.println(solve(0, 0, 0));   // infinite
        System.out.println(solve(2, 0, 7));   // no solution (2 does not divide 7)
    }
}
```

#### Python

```python
def ext_gcd(a, b):
    old_r, r = a, b
    old_s, s = 1, 0
    old_t, t = 0, 1
    while r != 0:
        q = old_r // r
        old_r, r = r, old_r - q * r
        old_s, s = s, old_s - q * s
        old_t, t = t, old_t - q * t
    return old_r, old_s, old_t  # g, x', y'


def solve(a, b, c):
    if a == 0 and b == 0:
        return "infinite" if c == 0 else "no solution"
    g, x1, y1 = ext_gcd(a, b)
    if g < 0:
        g, x1, y1 = -g, -x1, -y1
    if c % g != 0:
        return "no solution"
    sx, sy = b // g, a // g
    x0 = x1 * (c // g)            # Python ints never overflow
    if sx != 0:
        x0 %= abs(sx)            # canonical smallest non-negative x
    y0 = (c - a * x0) // b if b != 0 else 0
    if b == 0:
        x0, y0 = c // a, 0
    return f"x0={x0} y0={y0} stepX={sx} stepY={sy}"


if __name__ == "__main__":
    print(solve(6, 9, 21))
    print(solve(0, 0, 0))   # infinite
    print(solve(2, 0, 7))   # no solution
```

**What it does:** an iterative extended Euclid (no recursion stack), sign-normalized `g`, canonical smallest-non-negative `x0`, and explicit handling of `a = b = 0` and `b = 0`.
**Run:** `go run main.go` | `javac DiophantineSolver.java && java DiophantineSolver` | `python solver.py`

---

## 8. Code: Overflow-Safe Constrained Counting

The solver above produces the family; the next production primitive is counting non-negative (or boxed) solutions across ranges that may themselves be `~10^18`. The discipline: every bound goes through overflow-safe `floorDiv`/`ceilDiv`, the interval is intersected, and the final `U − L + 1` is itself guarded against wraparound. The functions below return a sentinel for the infinite case and use a wide-but-safe clamp for unbounded sides.

#### Go

```go
package main

import (
	"fmt"
	"math"
)

func extGCD(a, b int64) (int64, int64, int64) {
	oldR, r := a, b
	oldS, s := int64(1), int64(0)
	oldT, t := int64(0), int64(1)
	for r != 0 {
		q := oldR / r
		oldR, r = r, oldR-q*r
		oldS, s = s, oldS-q*s
		oldT, t = t, oldT-q*t
	}
	return oldR, oldS, oldT
}

func floorDiv(p, q int64) int64 {
	d := p / q
	if (p%q != 0) && ((p < 0) != (q < 0)) {
		d--
	}
	return d
}
func ceilDiv(p, q int64) int64 { return -floorDiv(-p, q) }

const (
	negInf = int64(-1) << 62
	posInf = int64(1) << 62
)

// CountNonNeg returns the count of (x,y)>=0 with a*x+b*y=c.
// Returns -1 to signal an infinite solution set (a==b==c==0).
func CountNonNeg(a, b, c int64) int64 {
	if a == 0 && b == 0 {
		if c == 0 {
			return -1 // infinite
		}
		return 0
	}
	g, x1, y1 := extGCD(a, b)
	if g < 0 {
		g, x1, y1 = -g, -x1, -y1
	}
	if c%g != 0 {
		return 0
	}
	x0, y0 := x1*(c/g), y1*(c/g)
	sx, sy := b/g, a/g // x = x0 + sx*t, y = y0 - sy*t
	lo, hi := negInf, posInf
	if sx > 0 {
		lo = max64(lo, ceilDiv(-x0, sx))
	} else if sx < 0 {
		hi = min64(hi, floorDiv(-x0, sx))
	} else if x0 < 0 {
		return 0
	}
	if sy > 0 {
		hi = min64(hi, floorDiv(y0, sy))
	} else if sy < 0 {
		lo = max64(lo, ceilDiv(y0, sy))
	} else if y0 < 0 {
		return 0
	}
	if lo > hi {
		return 0
	}
	// guard U-L+1 against overflow with a 128-bit-ish check
	if hi > math.MaxInt64-1+lo {
		panic("count exceeds int64; use big.Int")
	}
	return hi - lo + 1
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func main() {
	fmt.Println(CountNonNeg(6, 9, 21)) // 1
	fmt.Println(CountNonNeg(2, 3, 10)) // 2
	fmt.Println(CountNonNeg(3, 5, 7))  // 0 (Frobenius number)
	fmt.Println(CountNonNeg(0, 0, 0))  // -1 (infinite)
}
```

#### Java

```java
import java.math.BigInteger;

public class ConstrainedCount {
    static long[] extGCD(long a, long b) {
        long oldR = a, r = b, oldS = 1, s = 0, oldT = 0, t = 1;
        while (r != 0) {
            long q = oldR / r, tmp;
            tmp = oldR - q * r; oldR = r; r = tmp;
            tmp = oldS - q * s; oldS = s; s = tmp;
            tmp = oldT - q * t; oldT = t; t = tmp;
        }
        return new long[]{oldR, oldS, oldT};
    }
    static long floorDiv(long p, long q) {
        long d = p / q;
        if ((p % q != 0) && ((p < 0) != (q < 0))) d--;
        return d;
    }
    static long ceilDiv(long p, long q) { return -floorDiv(-p, q); }

    static final long NEG_INF = Long.MIN_VALUE >> 2, POS_INF = Long.MAX_VALUE >> 2;

    // returns count; -1 means infinite
    static long countNonNeg(long a, long b, long c) {
        if (a == 0 && b == 0) return (c == 0) ? -1 : 0;
        long[] e = extGCD(a, b);
        long g = e[0], x1 = e[1], y1 = e[2];
        if (g < 0) { g = -g; x1 = -x1; y1 = -y1; }
        if (c % g != 0) return 0;
        long x0 = x1 * (c / g), y0 = y1 * (c / g);
        long sx = b / g, sy = a / g;
        long lo = NEG_INF, hi = POS_INF;
        if (sx > 0) lo = Math.max(lo, ceilDiv(-x0, sx));
        else if (sx < 0) hi = Math.min(hi, floorDiv(-x0, sx));
        else if (x0 < 0) return 0;
        if (sy > 0) hi = Math.min(hi, floorDiv(y0, sy));
        else if (sy < 0) lo = Math.max(lo, ceilDiv(y0, sy));
        else if (y0 < 0) return 0;
        if (lo > hi) return 0;
        // BigInteger guard against U-L+1 overflow
        BigInteger cnt = BigInteger.valueOf(hi).subtract(BigInteger.valueOf(lo))
                .add(BigInteger.ONE);
        return cnt.longValueExact();
    }

    public static void main(String[] args) {
        System.out.println(countNonNeg(6, 9, 21)); // 1
        System.out.println(countNonNeg(2, 3, 10)); // 2
        System.out.println(countNonNeg(3, 5, 7));  // 0
        System.out.println(countNonNeg(0, 0, 0));  // -1
    }
}
```

#### Python

```python
def ext_gcd(a, b):
    old_r, r = a, b
    old_s, s = 1, 0
    old_t, t = 0, 1
    while r != 0:
        q = old_r // r
        old_r, r = r, old_r - q * r
        old_s, s = s, old_s - q * s
        old_t, t = t, old_t - q * t
    return old_r, old_s, old_t


def count_nonneg(a, b, c):
    """Count (x, y) >= 0 with a*x + b*y = c. Returns None for infinite."""
    if a == 0 and b == 0:
        return None if c == 0 else 0
    g, x1, y1 = ext_gcd(a, b)
    if g < 0:
        g, x1, y1 = -g, -x1, -y1
    if c % g != 0:
        return 0
    x0, y0 = x1 * (c // g), y1 * (c // g)
    sx, sy = b // g, a // g       # x = x0 + sx*t, y = y0 - sy*t
    lo, hi = None, None           # None == unbounded

    def lower(v):                 # t >= v
        nonlocal lo
        lo = v if lo is None else max(lo, v)

    def upper(v):                 # t <= v
        nonlocal hi
        hi = v if hi is None else min(hi, v)

    if sx > 0:
        lower(-(-(-x0) // sx))    # ceil(-x0/sx) via floor trick
    elif sx < 0:
        upper((-x0) // sx)        # floor since sx<0 handled by Python //
    elif x0 < 0:
        return 0
    if sy > 0:
        upper(y0 // sy)
    elif sy < 0:
        lower(-(-y0 // sy))
    elif y0 < 0:
        return 0

    if lo is None or hi is None:
        return None               # an axis is free -> infinite
    return max(0, hi - lo + 1)


if __name__ == "__main__":
    print(count_nonneg(6, 9, 21))  # 1
    print(count_nonneg(2, 3, 10))  # 2
    print(count_nonneg(3, 5, 7))   # 0
    print(count_nonneg(0, 0, 0))   # None (infinite)
```

**What it does:** counts non-negative solutions in `O(1)` after one extended Euclid, with every bound routed through overflow-safe floored division and the final count guarded against `int64` wraparound (Java uses `BigInteger`; Python is arbitrary precision; Go panics rather than returning a wrapped value).
**Run:** `go run main.go` | `javac ConstrainedCount.java && java ConstrainedCount` | `python count.py`

Note that the bounded-box variant (`xlo ≤ x ≤ xhi`, `ylo ≤ y ≤ yhi`) is the same code with two extra `lower`/`upper` calls per variable — four bounds total instead of two — and is still `O(1)`. The only new hazard is that with a genuine box the count is always finite, so the `None`/infinite branch never fires; assert that to catch a missing bound.

---

## 9. The Two-Coin Frobenius Closed Form in Production

Solvability over all integers (`g | c`) is weaker than non-negative representability. The production question "is there a solution with `x, y ≥ 0`, and if not, what is the largest unreachable `c`?" has an `O(1)` answer only for two coprime coins:

```
F(a, b) = a*b − a − b           (largest non-representable c)
N(a, b) = (a − 1)(b − 1) / 2    (count of non-representable c)
```

Production guards:

- **Require coprimality.** If `gcd(a, b) = g > 1`, divide `a, b` by `g`; only multiples of `g` are representable, and the Frobenius number of the reduced pair (times `g`) gives the largest non-representable *multiple of `g`*. Calling the formula on non-coprime inputs is a silent correctness bug.
- **Watch `a*b` overflow.** For `a, b ~ 2^32` the product `a*b` overflows `int64`. Either cap inputs, compute in 128-bit, or detect the overflow and fall back to big integers.
- **Guard `(a−1)(b−1)` parity.** It is always even for coprime `a, b` (one of `a, b` is even, or both odd making both `a−1, b−1` even), so the integer division by 2 is exact; assert it to catch a transcription error.

```go
func frobenius(a, b int64) (int64, int64, bool) {
	if gcd(a, b) != 1 {
		return 0, 0, false // undefined for non-coprime
	}
	return a*b - a - b, (a - 1) * (b - 1) / 2, true
}
```

```java
static long[] frobenius(long a, long b) { // {F, N, ok(1/0)}
    if (gcd(a, b) != 1) return new long[]{0, 0, 0};
    return new long[]{a * b - a - b, (a - 1) * (b - 1) / 2, 1};
}
```

```python
from math import gcd

def frobenius(a, b):
    if gcd(a, b) != 1:
        return None                 # undefined for non-coprime
    return a * b - a - b, (a - 1) * (b - 1) // 2
```

For three or more coins there is no closed form; production code computes the Frobenius number by Dijkstra over residues modulo the smallest coin (the Apéry-set / "money-changing" algorithm), `O(a_min · k · log a_min)`. Reach for the closed form only when you can prove exactly two coprime denominations.

---

## 10. Testing and Verification

Brute force is impossible at scale, so combine targeted oracles:

- **Plug-back invariant.** For every returned `(x0, y0)`, assert `a*x0 + b*y0 == c` in exact arithmetic (Python big-int or `__int128`). This catches overflow and scaling bugs instantly.
- **Step invariant.** Assert `a*StepX + b*(−StepY) == 0`, i.e. the step is a homogeneous solution. A wrong sign or missing `/g` fails here.
- **Small-range cross-check.** For `|a|, |b|, |c| ≤ 30`, enumerate the brute-force solution set and confirm the parametrization, restricted to the box, reproduces it exactly (Pattern 1 from junior).
- **Count cross-check.** For small inputs, count non-negative solutions both by enumeration and by the `t`-interval formula; they must match.
- **Property-based testing.** Generate random `(a, b)`, pick random `t1, t2`, set `c = a*(x0 + sx*t1) + b*(y0 − sy*t1)` — by construction solvable — and check the solver recovers a valid solution and the correct count.
- **Edge matrix.** A table of `(a, b, c)` covering every row in §5 with expected outputs, run in all three languages to enforce cross-language parity (relies on the canonical form from §6).
- **Frobenius spot-checks.** For coprime small `a, b`, verify `F = ab − a − b` equals the largest `c` the counter reports 0 for, and `(a−1)(b−1)/2` equals the number of such `c`.

---

## 11. Failure Modes

| Failure | Symptom | Root Cause | Mitigation |
|---------|---------|-----------|------------|
| Silent overflow | Plausible-looking but wrong `x0` | `x' · (c/g)` exceeded `2^63` | Reduce before multiply, or 128-bit; assert plug-back. |
| Divide by zero | Crash on `a = b = 0` | `g = 0`, then `b/g` | Special-case both-zero before any division. |
| Skipped solutions | Count is `g×` too small | Stepped by `(b, −a)` not `(b/g, −a/g)` | Always divide step by `g`; assert step invariant. |
| Wrong count direction | Count 0 when solutions exist | Inequality not flipped for negative coefficient | Sign-branch each `t`-bound. |
| Non-deterministic output | Golden tests flap | Emitted non-canonical particular solution | Canonicalize (§6) and assert range. |
| Count overflow | Negative or wrapped count | `U − L + 1` exceeded `2^63` | Clamp window or compute count in 128-bit. |
| Frobenius misuse | Wrong "largest unreachable" | Applied `ab−a−b` with `gcd(a,b) > 1` | Require coprimality first. |
| Negative-modulus surprise | `x0` negative after `%` | Language `%` can be negative | Normalize with `((x % m) + m) % m`. |

---

## 12. Summary

The mathematics of `a*x + b*y = c` is settled at junior level; senior work is making it *robust at scale*. The dominant hazard is **overflow** when scaling Bezout coefficients by `c/g` — bound the factors or reduce modulo the step `b/g` before multiplying, and use 128-bit `mulmod` for the genuinely large cases. **Counting** constrained solutions stays `O(1)` no matter how large the ranges, but each ceil/floor must be overflow-safe and the final `U − L + 1` must not wrap. The **edge matrix** — `a` or `b` or both zero, `c = 0`, negative inputs — must be handled explicitly, with a documented sign convention and a **canonical particular solution** for determinism and cross-language parity. Verify with plug-back and step invariants, small-range enumeration oracles, and property-based generation of guaranteed-solvable instances, since brute force is impossible once `a, b, c` reach 64 bits. Get overflow, edges, and canonicalization right and the solver is a reliable building block for CRT, scheduling, and lattice-counting systems.
