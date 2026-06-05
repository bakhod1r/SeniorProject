# Linear Diophantine Equations — Middle Level

> **Focus:** The general-solution parametrization in full, turning constraints (`x, y ≥ 0` or ranges) into a `t`-interval and **counting** the solutions in `O(1)`, the Frobenius / coin-problem connection, the water-jug puzzle, and how this all compares to CRT and brute force.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [The General Solution, Carefully](#the-general-solution-carefully)
4. [Constrained Solutions and Counting](#constrained-solutions-and-counting)
5. [The Frobenius / Coin Problem](#the-frobenius--coin-problem)
6. [Water-Jug and Scheduling Applications](#water-jug-and-scheduling-applications)
7. [Comparison with Alternatives](#comparison-with-alternatives)
8. [A Fully Worked Counting Example](#a-fully-worked-counting-example)
9. [Code Examples](#code-examples)
10. [Error Handling](#error-handling)
11. [Performance Analysis](#performance-analysis)
12. [Common Pitfalls at This Level](#common-pitfalls-at-this-level)
13. [Best Practices](#best-practices)
14. [Visual Animation](#visual-animation)
15. [Summary](#summary)

---

## Introduction

At junior level the message was three facts: solvable iff `gcd(a, b) | c`, one solution by scaling Bezout coefficients, and the family `x = x0 + (b/g)t`, `y = y0 − (a/g)t`. At middle level you start asking the questions that make the technique *useful* in contests and real code:

- How do I get a *canonical* particular solution (e.g. the one with the smallest non-negative `x`) so my answers are reproducible?
- Given `x ≥ 0` and `y ≥ 0`, how many solutions are there — without listing them?
- What if `x ∈ [xlo, xhi]` and `y ∈ [ylo, yhi]` simultaneously?
- What is the **largest** `c` that *cannot* be written with non-negative `x, y` (the coin/Frobenius problem), and why is the two-coin answer `a·b − a − b`?
- Where does this show up — water-jug puzzles, scheduling, CRT — and when should I reach for CRT instead?

These are the questions that separate "I can find *a* solution" from "I can characterize and *count* the solutions a problem actually wants."

The middle-level mindset shift is this: at junior level the goal was *one* solution; here the goal is the *shape* of the solution set and the ability to answer aggregate questions about it (how many, which is smallest, which fit a budget) without ever materializing the set. Every such question reduces to manipulating the single parameter `t`. Once you see the entire solution set as "an arithmetic progression indexed by `t`," counting and optimization become arithmetic on the bounds of `t`, and the apparent difficulty evaporates. The rest of this file drills that reduction until it is automatic.

---

## Deeper Concepts

### The particular + homogeneous decomposition

Every solution set of `a*x + b*y = c` (when non-empty) has the shape

```
{ particular solution } + { all solutions of a*x + b*y = 0 }.
```

The homogeneous equation `a*x + b*y = 0` has solution set exactly the integer multiples of the **primitive** step vector `d = (b/g, −a/g)`. Primitive means `gcd(b/g, a/g) = 1`, so `d` cannot be shortened — that is precisely why dividing by `g` matters. Geometrically, the solutions are the lattice points where the line `a*x + b*y = c` meets the integer grid, and consecutive lattice points are exactly `d` apart. The spacing along the line is constant, which is why everything reduces to arithmetic on the single parameter `t`.

### Canonical particular solution

The raw `x0 = x' · (c/g)` can be huge or negative. For reproducibility, reduce it into a canonical window using the step `sx = b/g`:

```
x0 ← ((x0 mod sx) + sx) mod sx      # smallest non-negative x of the family
y0 ← (c − a · x0) / b               # recompute matching y
```

Now `x0 ∈ [0, sx)`. (Handle `b = 0` separately.) This canonical form makes "smallest non-negative `x`", "smallest positive `x`", and counting all start from a known reference and avoids overflow from an unreduced `x' · c/g`.

Why does reducing `x0` modulo `sx = b/g` keep it a valid solution? Because shifting `x0` by a multiple of `sx` is exactly stepping along the family by an integer number of `t`-steps, and every member of the family is a solution. Concretely, `x0 − k·sx` corresponds to `t = −k`, so the reduced `x0` is just the family member whose `x`-coordinate lands in `[0, sx)`. The matching `y` is recovered by `y0 = (c − a·x0)/b`, which is an exact integer division precisely because `(x0, y0)` solves the equation. This is the single most useful preprocessing step at the middle level: it gives every downstream query a small, deterministic starting point.

---

## The General Solution, Carefully

Let `g = gcd(a, b)` and assume `g | c` and `a, b` not both zero. With a particular `(x0, y0)`:

```
x(t) = x0 + (b/g) · t
y(t) = y0 − (a/g) · t      (t ∈ ℤ)
```

Three facts you should be able to prove on demand (full proofs in `professional.md`):

1. **Closure.** Substituting, the `t`-terms cancel: `a·(b/g) + b·(−a/g) = 0`. So every `t` gives a valid solution.
2. **Completeness.** If `(x, y)` solves it, then `a(x−x0) + b(y−y0) = 0`, so `(a/g)(x−x0) = −(b/g)(y−y0)`. Since `gcd(a/g, b/g) = 1`, `(b/g) | (x−x0)`, giving `x − x0 = (b/g)t`.
3. **Uniqueness of `t`.** Distinct `t` give distinct `x` (because `b/g ≠ 0` when `b ≠ 0`), so the parametrization is a bijection `ℤ → solutions`.

The bijection is the load-bearing fact for everything that follows. Because each integer `t` corresponds to exactly one solution and vice versa, counting solutions equals counting feasible `t`, and finding the extreme (smallest/largest) `x` equals evaluating the family at the boundary `t`. Without the bijection you could not equate "number of solutions" with "number of integers in an interval" — there would be a risk of double-counting or missing solutions. Establishing it once, here, is what licenses every `O(1)` count later in the file.

**Sign care.** If you computed extended Euclid on `|a|, |b|`, flip the Bezout coefficient signs to match the signs of `a, b`. Keep `a, b` *signed* in the step `(b/g, −a/g)`; the formula stays correct, but the *direction* `t` must move to satisfy a constraint depends on the signs (covered next).

---

## Constrained Solutions and Counting

The central middle-level skill: convert each constraint on `x` or `y` into a half-line of `t`, intersect, and count integers. Let `sx = b/g` (the `x` step) and `sy = a/g` (so `y` step is `−sy`).

### Non-negativity `x ≥ 0`, `y ≥ 0`

```
x0 + sx·t ≥ 0
y0 − sy·t ≥ 0
```

Each inequality, after dividing by the (possibly negative) coefficient, yields `t ≥ L` or `t ≤ U`. **Dividing by a negative flips the inequality.** Use integer ceil/floor:

- For `t ≥ value`: lower bound `L = ceil(value)`.
- For `t ≤ value`: upper bound `U = floor(value)`.

The count is `max(0, U − L + 1)`. The `max(0, …)` guard is essential: when the two constraints are incompatible (an upper bound below a lower bound), `U − L + 1` goes negative, and the guard correctly reports zero solutions rather than a nonsensical negative count.

### Range constraints `x ∈ [xlo, xhi]`, `y ∈ [ylo, yhi]`

A two-sided box on `x` gives two `t`-bounds; same for `y`. Intersect **all four**:

```
xlo ≤ x0 + sx·t ≤ xhi      → t in [La, Ua]
ylo ≤ y0 − sy·t ≤ yhi      → t in [Lb, Ub]
answer t-range = [max(La, Lb), min(Ua, Ub)]
count = max(0, min(Ua,Ub) − max(La,Lb) + 1)
```

Each bound is one ceil or floor; the whole thing is `O(1)`. This is how you count, for example, "ways to buy exactly `c` worth using between 0 and 100 of coin `a` and between 0 and 50 of coin `b`."

### Why integer ceil/floor, not float

For large inputs, `value = −x0 / sx` as a float loses precision. Use **floored division** that rounds toward −∞ and derive ceil from it: `ceil(p/q) = −floor(−p/q)` with a floor-division operator. Python's `//` already floors; Go and Java need a helper because their `/` truncates toward zero.

A concrete trap: in Go and Java, `-7 / 2` evaluates to `-3` (truncation toward zero), but the mathematical floor of `-3.5` is `-4`. If you needed `floor(-7/2)` for an upper `t`-bound and used the language `/`, you would compute `-3`, including one `t` value too many and overcounting. The `floorDiv` helper corrects exactly this case by decrementing when the operands have opposite signs and the division is inexact. Always route every bound computation through `floorDiv`/`ceilDiv`; never use the bare `/` operator for a `t`-bound when negatives are possible.

### Direction of the bound depends on the sign

One more subtlety the code handles via sign-branching: when `sx > 0`, the constraint `x0 + sx·t ≥ 0` gives a *lower* bound on `t`; when `sx < 0`, dividing by the negative `sx` flips the inequality and it becomes an *upper* bound. If you computed extended Euclid on signed `a, b` (or your `b` is negative), `sx = b/g` can be negative, and a hard-coded "this is the lower bound" assumption silently produces an empty or infinite interval. The branch on `sign(sx)` and `sign(sy)` in the example code is not optional defensiveness — it is correctness for the general signed case.

---

## The Frobenius / Coin Problem

Solvability over **all** integers (`g | c`) does *not* mean a solution with `x, y ≥ 0` exists. The **Frobenius (coin) problem** asks: for non-negative counts, which `c` are representable, and what is the **largest non-representable** `c`?

### Two coins, coprime: the closed form

For two coprime positive integers `a, b` (`gcd(a, b) = 1`):

- The **Frobenius number** (largest `c` with *no* non-negative solution) is

```
F(a, b) = a·b − a − b.
```

- The **count of non-representable** non-negative integers is exactly

```
(a − 1)(b − 1) / 2.
```

For example `a = 6/3 = 2`… wait — these require coprime inputs. Take `a = 3, b = 5`: `F = 15 − 3 − 5 = 7`. Indeed 1, 2, 4, 7 are not representable (four of them), and `(3−1)(5−1)/2 = 8/2 = 4`. ✓ The largest unreachable amount is 7; every `c ≥ 8` is reachable with non-negative `3x + 5y`.

This is the classic **Chicken McNugget theorem**: with 6- and 9- and 20-piece boxes the largest unbuyable count is famously 43, but that is the *three*-coin version. For two coprime coins the formula above is exact and `O(1)`.

### If `gcd(a, b) = g > 1`

Then only multiples of `g` are representable at all; there are *infinitely many* non-representable numbers (everything not a multiple of `g`), so the Frobenius number is undefined unless you restrict to multiples of `g` and divide through by `g` first.

### A second Frobenius worked example

Take `a = 4, b = 9` (coprime, `gcd = 1`). The Frobenius number is `F = 4·9 − 4 − 9 = 36 − 13 = 23`: 23 is the largest amount you cannot pay with non-negative counts of 4s and 9s. The number of non-representable amounts is `(4−1)(9−1)/2 = 3·8/2 = 12`. Listing them confirms it: `1, 2, 3, 5, 6, 7, 10, 11, 14, 15, 19, 23` — twelve numbers, the largest being 23. Every integer `≥ 24` is representable. You can verify a few by hand: `24 = 4·6`, `25 = 4·4 + 9·1`, `26 = 4·2 + 9·2`, `27 = 9·3`, and from there add 4s. This is the canonical "Chicken McNugget" structure: once you clear the Frobenius number, an unbroken run of representable integers begins.

### Why the count formula is symmetric

The `(a−1)(b−1)/2` formula has a beautiful explanation: among the integers `0, 1, …, F`, exactly half are representable and half are not, paired by the involution `c ↦ F − c`. For any `c` in `[0, F]`, exactly one of `c` and `F − c` is representable. So the count of non-representables is half of `F + 1 = ab − a − b + 1 = (a−1)(b−1)`, giving `(a−1)(b−1)/2`. The professional file proves this (Sylvester's symmetry); at middle level it is enough to remember the pairing as the *reason* the formula is an exact integer.

### Three or more coins

No simple closed form exists for the Frobenius number with three or more coin values; it is computed by dynamic programming / shortest-path on residues (the "coin problem" / "money-changing problem"), which is a separate topic. The two-coin closed form is the one you must know cold.

---

## Water-Jug and Scheduling Applications

### Water-jug puzzle

You have jugs of capacity `a` and `b` litres and want exactly `c` litres. Each fill/empty/pour sequence changes the measured amount by multiples of `a` and `b`, so the reachable amounts are exactly the `c` with `gcd(a, b) | c` and `0 ≤ c ≤ max(a, b)`. The Diophantine equation `a·x + b·y = c` models it: `x` is net fills of the `a`-jug, `y` net fills of the `b`-jug (signs encode pouring out). The classic *Die Hard* "4 litres from a 3 and a 5" works because `gcd(3, 5) = 1` divides 4; a concrete solution `3·3 + 5·(−1) = 4` says "fill the 3-jug three times, empty the 5-jug once" in net terms.

### Two-resource scheduling

"A task of length `c` is to be tiled by blocks of length `a` and `b`." Solvable iff `gcd(a, b) | c`; non-negative solutions are the actual schedules (you cannot use a negative number of blocks). Counting the schedules is the `t`-interval count above. The smallest-positive-`x` query answers "minimum number of `a`-blocks in any valid schedule."

### Lattice points on a line

The integer solutions of `a*x + b*y = c` are precisely the lattice points the line passes through. The number of such points inside an axis-aligned rectangle is the range-constrained count. This connects to Pick's theorem and to counting visible lattice points, but the core is the same `t`-interval.

### CRT connection

A single congruence `a·x ≡ c (mod m)` is the Diophantine equation `a·x − m·y = c` (rename `−y`). Solving it for the smallest non-negative `x` is exactly the CRT merge step. The Chinese Remainder Theorem (sibling `05-crt`) chains several such merges; each one is a linear Diophantine solve. So mastering this topic is a prerequisite for implementing CRT by hand.

### A worked coin framing

Concretely: a cashier has only 6-cent and 9-cent tokens and must make exactly 21 cents *handing out tokens of each kind*, i.e. non-negative `x, y` with `6x + 9y = 21`. From junior level we found the unique non-negative solution `(2, 1)` — two 6s and one 9. Now ask the counting question for 45 cents: `6x + 9y = 45`. Here `g = 3 | 45`, `c/g = 15`, family `x = x0 + 3t, y = y0 − 2t`. Canonicalize to the smallest non-negative `x`: `x0 = 0, y0 = 5` (since `6·0 + 9·5 = 45`). Bounds: `x ≥ 0 ⇒ t ≥ 0`; `y ≥ 0 ⇒ 5 − 2t ≥ 0 ⇒ t ≤ 2.5 ⇒ t ≤ 2`. So `t ∈ {0, 1, 2}` — **three** ways: `(0, 5)`, `(3, 3)`, `(6, 1)`. The cashier has exactly three token combinations for 45 cents, and we computed it with one gcd and two divisions, no scanning.

### Frobenius framing of the same coins

Reduce the non-coprime pair `(6, 9)` by `g = 3` to the coprime pair `(2, 3)`. The Frobenius number of `(2, 3)` is `2·3 − 2 − 3 = 1`, so every integer `≥ 2` is representable as `2u + 3v` with `u, v ≥ 0`. Scaling back by `3`: every multiple of `3` that is `≥ 6` is representable as `6x + 9y` with non-negative counts, and the largest *multiple of 3* that is **not** is `3·1 = 3`. Amounts not divisible by 3 (like 7, 8, 10) are never representable at all because `gcd(6, 9) = 3` divides every value of `6x + 9y`. This is the precise sense in which the Frobenius formula only applies after dividing out the gcd — a subtlety the senior file revisits as a failure mode.

---

## Comparison with Alternatives

| Approach | When it wins | Cost | Notes |
|----------|--------------|------|-------|
| Extended Euclid + family | Two-variable `a*x+b*y=c`, any size | `O(log min(a,b))` | The default; gives existence, one solution, all solutions. |
| Brute-force search box | Tiny `a, b, c`; sanity checks | `O(R²)` | Only as a test oracle. |
| CRT primitive | System of congruences | `O(k log M)` | Built *on top of* Diophantine solves. |
| DP / shortest path on residues | Frobenius with ≥3 coins | `O(a · k)` | No closed form for 3+ coins. |
| Two-coin Frobenius formula | Coprime `a, b`, non-neg count question | `O(1)` | `F = ab − a − b`, count `(a−1)(b−1)/2`. |
| Floating-point line solve | Never for integer answers | — | Loses the integrality that defines the problem. |

The crossover logic: for the *existence and parametrization* of integer solutions, nothing beats extended Euclid. For *non-negative representability* with two coins, use the Frobenius formula; with three or more, fall back to DP.

### Capability comparison at a glance

A second table, organized by the *question you are asking* rather than the technique, makes the decision mechanical:

| Question you are asking | Right tool | Output | Cost |
|-------------------------|-----------|--------|------|
| "Does any integer solution exist?" | gcd divisibility test | yes/no | `O(log)` |
| "Give me one solution." | extended Euclid + scale | `(x0, y0)` | `O(log)` |
| "Describe all solutions." | step vector `(b/g, −a/g)` | family in `t` | `O(1)` after gcd |
| "How many with `x, y ≥ 0`?" | two `t`-bounds | a count | `O(1)` after gcd |
| "How many with `x, y` in a box?" | four `t`-bounds | a count | `O(1)` after gcd |
| "Smallest positive `x`?" | reduce `x0` mod `b/g` | one pair | `O(1)` after gcd |
| "Largest unreachable amount (2 coins)?" | Frobenius `ab − a − b` | one number | `O(1)` |
| "Largest unreachable amount (≥3 coins)?" | Apéry-set DP | one number | `O(a_min · k)` |
| "Solve a congruence `ax ≡ c (mod m)`?" | Diophantine `ax − my = c` | residues | `O(log)` |

The single most common mistake at this level is reaching for enumeration when a `t`-interval answers the counting questions in constant time. Whenever the prompt says "how many", think "interval of `t`", not "loop".

---

## A Fully Worked Counting Example

Nothing cements the `t`-interval method like grinding one example end to end. Count the non-negative solutions of

```
4x + 6y = 18.
```

**Step 1 — gcd and solvability.** `g = gcd(4, 6) = 2`, and `2 | 18` (`18/2 = 9`), so the equation is solvable. Note `g = 2 > 1`, so this is *not* the coprime case; the step coefficients will be `b/g = 3` and `a/g = 2`.

**Step 2 — a particular solution.** Extended Euclid on `(4, 6)` gives `4·(−1) + 6·1 = 2`, so `x' = −1, y' = 1`. Scale by `c/g = 9`:

```
x0 = −1 · 9 = −9,   y0 = 1 · 9 = 9.
```

Check: `4·(−9) + 6·9 = −36 + 54 = 18`. ✓

**Step 3 — the family.** With `sx = b/g = 3` and `sy = a/g = 2`:

```
x(t) = −9 + 3t,   y(t) = 9 − 2t.
```

**Step 4 — turn `x ≥ 0` and `y ≥ 0` into `t`-bounds.** Both step coefficients are positive, so:

```
x(t) ≥ 0:  −9 + 3t ≥ 0  ⇒  t ≥ 9/3 = 3        (lower bound L = ceil(3) = 3)
y(t) ≥ 0:   9 − 2t ≥ 0  ⇒  t ≤ 9/2 = 4.5       (upper bound U = floor(4.5) = 4)
```

**Step 5 — count.** The feasible `t` are `{3, 4}`, so `N = U − L + 1 = 4 − 3 + 1 = 2`. Read them off:

```
t = 3:  x = 0, y = 3   →  4·0 + 6·3 = 18  ✓
t = 4:  x = 3, y = 1   →  4·3 + 6·1 = 18  ✓
```

Two non-negative solutions, found without enumerating a single value of `x` or `y` directly — only two divisions and a subtraction. A brute-force scan of `x ∈ {0, 1, 2, 3, 4}` would confirm exactly these two, but the interval method scales to `c = 10^18` unchanged.

**A canonicalization remark.** The raw `x0 = −9` is negative and ugly. Reducing it modulo `sx = 3` gives `x0 = ((−9) mod 3 + 3) mod 3 = 0`, the smallest non-negative `x` in the family — which is exactly the `t = 3` solution. Starting from the canonical `(0, 3)` makes the lower bound fall out as `t ≥ 0` and keeps every intermediate number small, the habit senior code relies on to dodge overflow.

---

## Code Examples

### Example: Count Non-Negative Solutions and the Full Constrained Range

#### Go

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

// floorDiv and ceilDiv handle negatives correctly (round toward -inf / +inf).
func floorDiv(p, q int64) int64 {
	d := p / q
	if (p%q != 0) && ((p < 0) != (q < 0)) {
		d--
	}
	return d
}
func ceilDiv(p, q int64) int64 { return -floorDiv(-p, q) }

// countNonNeg returns the number of (x,y) with x>=0, y>=0 solving a*x+b*y=c.
func countNonNeg(a, b, c int64) int64 {
	g, x1, y1 := extGCD(a, b)
	if g == 0 {
		if c == 0 {
			return -1 // infinite (all pairs) — caller decides
		}
		return 0
	}
	if c%g != 0 {
		return 0
	}
	x0, y0 := x1*(c/g), y1*(c/g)
	sx, sy := b/g, a/g // x = x0 + sx*t, y = y0 - sy*t
	lo, hi := int64(-1<<62), int64(1<<62)
	// x0 + sx*t >= 0
	if sx > 0 {
		lo = max64(lo, ceilDiv(-x0, sx))
	} else if sx < 0 {
		hi = min64(hi, floorDiv(-x0, sx))
	} else if x0 < 0 {
		return 0
	}
	// y0 - sy*t >= 0  ->  sy*t <= y0
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
	return hi - lo + 1
}

func max64(a, b int64) int64 { if a > b { return a }; return b }
func min64(a, b int64) int64 { if a < b { return a }; return b }

func main() {
	fmt.Println(countNonNeg(6, 9, 21)) // 1  -> (2,1)
	fmt.Println(countNonNeg(2, 3, 10)) // 2  -> (5,0),(2,2)
	fmt.Println(countNonNeg(3, 5, 7))  // 0  (Frobenius number)
}
```

#### Java

```java
public class CountDiophantine {
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

    static long countNonNeg(long a, long b, long c) {
        long[] e = extGCD(a, b);
        long g = e[0];
        if (g == 0) return (c == 0) ? -1 : 0;
        if (c % g != 0) return 0;
        long x0 = e[1] * (c / g), y0 = e[2] * (c / g);
        long sx = b / g, sy = a / g;
        long lo = Long.MIN_VALUE / 4, hi = Long.MAX_VALUE / 4;
        if (sx > 0) lo = Math.max(lo, ceilDiv(-x0, sx));
        else if (sx < 0) hi = Math.min(hi, floorDiv(-x0, sx));
        else if (x0 < 0) return 0;
        if (sy > 0) hi = Math.min(hi, floorDiv(y0, sy));
        else if (sy < 0) lo = Math.max(lo, ceilDiv(y0, sy));
        else if (y0 < 0) return 0;
        return (lo > hi) ? 0 : hi - lo + 1;
    }

    public static void main(String[] args) {
        System.out.println(countNonNeg(6, 9, 21)); // 1
        System.out.println(countNonNeg(2, 3, 10)); // 2
        System.out.println(countNonNeg(3, 5, 7));  // 0
    }
}
```

#### Python

```python
import math


def ext_gcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = ext_gcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


def count_nonneg(a, b, c):
    g, x1, y1 = ext_gcd(a, b)
    if g == 0:
        return -1 if c == 0 else 0   # -1 means infinite
    if c % g != 0:
        return 0
    x0, y0 = x1 * (c // g), y1 * (c // g)
    sx, sy = b // g, a // g           # x = x0 + sx*t, y = y0 - sy*t
    lo, hi = -math.inf, math.inf
    # x0 + sx*t >= 0
    if sx > 0:
        lo = max(lo, math.ceil(-x0 / sx))
    elif sx < 0:
        hi = min(hi, math.floor(-x0 / sx))
    elif x0 < 0:
        return 0
    # y0 - sy*t >= 0
    if sy > 0:
        hi = min(hi, math.floor(y0 / sy))
    elif sy < 0:
        lo = max(lo, math.ceil(y0 / sy))
    elif y0 < 0:
        return 0
    return max(0, int(hi) - int(lo) + 1) if lo <= hi else 0


if __name__ == "__main__":
    print(count_nonneg(6, 9, 21))  # 1
    print(count_nonneg(2, 3, 10))  # 2
    print(count_nonneg(3, 5, 7))   # 0
```

**What it does:** counts non-negative solutions in `O(1)` by reducing both `x ≥ 0` and `y ≥ 0` to a single `t`-interval.
**Run:** `go run main.go` | `javac CountDiophantine.java && java CountDiophantine` | `python count.py`

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Count off by one | Mixed up `ceil`/`floor` or used `<` vs `≤`. | Lower bound → `ceil`; upper bound → `floor`; non-negativity is inclusive. |
| Wrong direction of bound | Divided an inequality by a negative `sx`/`sy` without flipping. | Branch on the sign of the coefficient (the code does this explicitly). |
| Float rounding on huge inputs | Used `/` floats for `ceil`/`floor`. | Use integer `floorDiv`/`ceilDiv` helpers. |
| Reported finite for infinite | `a = b = 0, c = 0` has *all* pairs. | Detect `g == 0` and signal "infinite" separately. |
| Frobenius formula on non-coprime | `gcd(a,b) > 1` has no Frobenius number. | Require `gcd(a, b) = 1` before using `ab − a − b`. |
| Overflow in `a*b` for Frobenius | Large `a, b`. | Use 64-bit; watch that `a*b` fits. |

---

## Performance Analysis

- **Solve + parametrize:** one extended Euclid, `O(log min(a, b))`. Everything downstream is `O(1)`.
- **Counting constrained solutions:** `O(1)` — four ceil/floor operations and a subtraction. Never enumerate to count.
- **Enumerating solutions:** `O(m)` where `m` is the count, unavoidable if you must output them.
- **Two-coin Frobenius / non-representable count:** `O(1)` closed form.
- **Three-plus-coin Frobenius:** `O(a_min · k)` DP over residues modulo the smallest coin; no closed form.
- **CRT of `k` congruences:** `k` Diophantine merges, `O(k · log M)` overall.

The practical lesson: the only logarithmic cost is the gcd; budget everything else as constant time, which is what makes Diophantine counting feasible even when the solution count itself is astronomically large.

### Why counting is cheaper than enumerating

It is worth internalizing *why* counting can be `O(1)` while listing is `O(m)`. The solutions form an arithmetic progression in `t`: equally spaced, with no gaps and no irregularity. For an arithmetic progression, "how many terms lie in `[L, U]`?" is pure arithmetic — `U − L + 1` — because the structure is fully determined by the first term and the common step. There is nothing to discover by walking the sequence. Contrast this with, say, counting primes in a range, where each candidate must be tested: there the count genuinely requires work proportional to the range. Linear Diophantine solutions are the easy case precisely because the step vector makes them perfectly regular. This is the same reason summing `1 + 2 + ⋯ + n` is `O(1)` via `n(n+1)/2` rather than `O(n)`: regular structure collapses a loop into a formula.

### When you *do* have to enumerate

Enumeration is only required when the *output* is the list of solutions — for example, "print every way to pay 45 cents with 6- and 9-cent tokens." Then you genuinely produce `m` lines and pay `O(m)`. Even then, you should first compute the count to *size the output buffer* and to reject pathological queries (a range that yields `10^18` solutions should be refused, not enumerated). Count first, enumerate only if the count is small and the caller actually wants the list.

---

## Common Pitfalls at This Level

These are the mistakes that turn a correct idea into a wrong answer, drawn from contest post-mortems:

1. **Counting with `(b, −a)` instead of `(b/g, −a/g)`.** If you forget to divide by `g`, your `t`-interval has the wrong step and you undercount by a factor of `g`. The worked `4x + 6y = 18` example would report 1 instead of 2.
2. **Floating-point bounds on large inputs.** `math.ceil(-x0 / sx)` is fine for small numbers but silently wrong once `x0` exceeds `2^53` and float precision degrades. Switch to integer `floorDiv`/`ceilDiv` (the Go and Java code above does exactly this).
3. **Inclusive vs exclusive bounds.** `x ≥ 0` is inclusive, so the lower bound uses `ceil` and the count uses `U − L + 1`, not `U − L`. A single `<` where you meant `≤` drops the boundary solution.
4. **Assuming a non-negative solution exists because the equation is solvable.** `3x + 5y = 7` is solvable over ℤ but has zero non-negative solutions. Always run the count; do not assume.
5. **Applying the Frobenius formula to non-coprime coins.** `F = ab − a − b` is meaningless unless `gcd(a, b) = 1`. Divide out the gcd first (and remember only multiples of `g` are representable at all).
6. **Forgetting the `a = b = 0, c = 0` infinite case** when writing a generic counter — it must return a sentinel for "infinite", never silently `0`.

### Sanity-check routine

Before trusting any counting answer, run this three-line mental check: (1) is `gcd(a, b) | c`? if not, the count is 0; (2) did I divide the step by `g`? (3) are my bounds inclusive with `ceil` below and `floor` above? Getting these three right covers the overwhelming majority of bugs at the middle level.

---

## Best Practices

- Canonicalize the particular solution (reduce `x0` mod `b/g`) before counting or comparing — it makes outputs deterministic and avoids overflow.
- Always branch on the sign of the step coefficients when forming `t`-bounds; do not assume `a, b > 0`.
- Use integer `floorDiv`/`ceilDiv`, never floats, for the bounds.
- Keep the "infinite solutions" case (`a = b = 0, c = 0`) explicit so callers do not silently get 0.
- For non-negative representability with two coins, prefer the closed form; reserve DP for three or more.
- Validate counts against the brute-force oracle on random small inputs.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - The line `a*x + b*y = c` and the lattice points on it
> - Stepping between consecutive solutions by `(b/g, −a/g)`
> - The non-negative solutions in the first quadrant highlighted as the constrained window
> - Editable `a, b, c` so you can watch solvability appear/disappear as `gcd(a,b) | c` changes

---

## Summary

> **In one line:** see the whole solution set as an arithmetic progression indexed by `t`, and every counting or optimization question becomes arithmetic on the endpoints of a `t`-interval.

The general solution `x = x0 + (b/g)t`, `y = y0 − (a/g)t` is a bijection from the integers `t` to all solutions, with consecutive solutions spaced by the primitive step `(b/g, −a/g)`. Constraints — non-negativity or two-sided ranges on `x` and `y` — turn into bounds on `t`, and **counting** the constrained solutions is counting integers in an interval, an `O(1)` operation after one gcd. Solvability over all integers (`gcd(a,b) | c`) is *weaker* than non-negative representability: the gap is the Frobenius / coin problem, whose two-coin closed form is `F = ab − a − b` with `(a−1)(b−1)/2` non-representable numbers (coprime case). The same equation models water-jug puzzles, two-resource scheduling, lattice points on a line, and the merge step of CRT. Master the `t`-interval counting trick and the two-coin Frobenius formula and you can answer existence, construction, and counting questions for two-variable linear Diophantine problems in essentially constant time.
