# The Master Theorem — Middle Level

> **Focus:** The three cases derived from the recursion tree as a geometric series, a large bank of worked examples (merge sort, binary search, Karatsuba, Strassen, median-of-medians, and the gap cases), the extended Case 2 with `log^k n`, and how the Master Theorem compares with the substitution and recursion-tree methods.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Deriving the Three Cases from the Recursion Tree](#deriving-the-three-cases-from-the-recursion-tree)
4. [A Bank of Worked Examples](#a-bank-of-worked-examples)
5. [The Extended Master Theorem (Case 2 with k)](#the-extended-master-theorem-case-2-with-k)
6. [Comparison with the Substitution Method](#comparison-with-the-substitution-method)
7. [The Three Methods Side by Side on One Recurrence](#the-three-methods-side-by-side-on-one-recurrence)
8. [Variants and How They Shift the Case](#variants-and-how-they-shift-the-case)
9. [Code Examples](#code-examples)
10. [Error Handling](#error-handling)
11. [Performance Analysis](#performance-analysis)
12. [Best Practices](#best-practices)
13. [Visual Animation](#visual-animation)
14. [Summary](#summary)

---

## Introduction

At junior level the Master Theorem was a three-row lookup table: compute `log_b a`, compare `f(n)` to `n^(log_b a)`, read off the case. At middle level you need to understand *where those three rows come from*, so that when a recurrence falls outside the table you know what to do instead.

The key realization is that the Master Theorem is **the recursion-tree method, pre-solved for the special case `f(n) = n^c`**. When you draw the recursion tree and sum the per-level work, you always get a geometric series. A geometric series has exactly three behaviors depending on its ratio — and those three behaviors are exactly the three cases. Once you see this, the cases stop being arbitrary and become inevitable.

This file answers the engineering-level questions:

- How does the geometric series `Σ a^i · f(n/b^i)` collapse into each of the three cases?
- What is the *ratio* of the series, and why does `ratio = a/b^c` decide everything?
- How do I handle `f(n) = n log n` and other log-factor cases the basic theorem can't touch?
- When should I *not* use the Master Theorem and reach for substitution or the raw recursion tree instead?

---

## Deeper Concepts

### The watershed, restated as a balance point

The critical exponent `log_b a` is the value of `c` at which the leaves and the root do *equal* total work. Define the per-level work ratio:

```
ratio r = (work at level i+1) / (work at level i)
        = [a^(i+1) · f(n/b^(i+1))] / [a^i · f(n/b^i)]
        = a · f(n/b^(i+1)) / f(n/b^i)
```

For `f(n) = n^c`, `f(n/b) = (n/b)^c = f(n)/b^c`, so:

```
r = a / b^c
```

This single number `r = a/b^c` controls the whole theorem:

| Condition on `r` | Equivalent condition on `c` | Series dominated by | Case |
|------------------|------------------------------|---------------------|------|
| `r > 1` | `c < log_b a` | last level (leaves) | Case 1 |
| `r = 1` | `c = log_b a` | all levels equally | Case 2 |
| `r < 1` | `c > log_b a` | first level (root) | Case 3 |

`r > 1` ⇔ `a > b^c` ⇔ `log_b a > c`. That algebra is why "compare `c` to `log_b a`" is the same as "compare `f(n)` to the watershed."

### Why "polynomially" is non-negotiable

Cases 1 and 3 require the difference between `f(n)` and the watershed to be a factor of `n^ε` for some constant `ε > 0`. This is because the geometric series only converges *cleanly* (to its first or last term within a constant factor) when the ratio `r` is bounded away from 1 by a constant. A `log n` factor makes `r → 1` as `n → ∞`, so the series does *not* collapse to a single term — it accumulates a `log` factor across all `Θ(log n)` levels. That is precisely the gap case, and why we need the extended Case 2.

### Leaf count is the asymptotic floor

No matter what `f(n)` is, the recursion always produces `Θ(n^(log_b a))` leaves, each costing `Θ(1)`. So `T(n) = Ω(n^(log_b a))` *always*. The three cases differ only in whether the internal-node work (the `f` contributions) adds nothing extra (Case 1), a `log` factor (Case 2), or dominates entirely (Case 3).

---

## Deriving the Three Cases from the Recursion Tree

Unroll `T(n) = a·T(n/b) + f(n)`. The tree has `log_b n + 1` levels. At level `i` (root = level 0) there are `a^i` nodes, each of size `n/b^i`, each paying `f(n/b^i)`. Total work:

```
T(n) = Σ_{i=0}^{log_b n − 1}  a^i · f(n / b^i)   +   Θ(n^(log_b a))
       └─────── internal-node work ────────┘       └── leaf work ──┘
```

Now specialize to `f(n) = n^c`:

```
a^i · (n/b^i)^c = a^i · n^c / b^(ic) = n^c · (a/b^c)^i = n^c · r^i
```

So the internal sum is a **geometric series** `n^c · Σ_{i=0}^{L−1} r^i` with `L = log_b n` levels.

### Case 1: `r > 1` (leaves dominate)

A geometric series with ratio `r > 1` is dominated by its **last** term: `Σ r^i = Θ(r^(L−1))`. Plugging `L = log_b n`:

```
n^c · r^(log_b n) = n^c · (a/b^c)^(log_b n) = n^c · a^(log_b n) / b^(c·log_b n)
                  = n^c · n^(log_b a) / n^c = n^(log_b a)
```

The internal work equals the leaf work, `Θ(n^(log_b a))`, so `T(n) = Θ(n^(log_b a))`. **Leaves win.**

### Case 2: `r = 1` (all levels equal)

When `r = 1`, every term of the series is the same: `Σ_{i=0}^{L−1} r^i = L = log_b n`. So:

```
T(n) = n^c · log_b n + Θ(n^(log_b a))
```

Since `c = log_b a` here, `n^c = n^(log_b a)`, giving `T(n) = Θ(n^(log_b a) · log n)`. **Every level ties.**

### Case 3: `r < 1` (root dominates)

A geometric series with ratio `r < 1` converges to a **constant** times its **first** term: `Σ r^i = Θ(1)`. So the internal work is `Θ(n^c) = Θ(f(n))`, and since `c > log_b a` this dominates the leaf term:

```
T(n) = Θ(f(n))
```

**Root wins.** The regularity condition `a·f(n/b) ≤ c·f(n)` is exactly the statement "the geometric series of `f`-contributions has ratio bounded below 1," which is what makes the sum collapse to the top term even for general (non-pure-power) `f`.

---

## A Bank of Worked Examples

### Example 1 — Merge sort: `2T(n/2) + n` → Case 2

`log_2 2 = 1`, watershed `n`, `f(n) = n = Θ(n^1)`. Match → Case 2 → `Θ(n log n)`. Ratio `r = a/b^c = 2/2^1 = 1`. ✓

### Example 2 — Binary search: `T(n/2) + 1` → Case 2

`log_2 1 = 0`, watershed `n^0 = 1`, `f(n) = Θ(1) = Θ(n^0)`. Match → Case 2 → `Θ(n^0 log n) = Θ(log n)`. ✓

### Example 3 — Karatsuba: `3T(n/2) + n` → Case 1

`log_2 3 ≈ 1.585`, watershed `n^1.585`, `f(n) = n = O(n^(1.585−0.5))`. Polynomially smaller → Case 1 → `Θ(n^(log_2 3)) ≈ Θ(n^1.585)`. Ratio `r = 3/2 > 1`, leaves win. ✓

### Example 4 — Strassen: `7T(n/2) + n²` → Case 1

`log_2 7 ≈ 2.807`, watershed `n^2.807`, `f(n) = n² = O(n^(2.807−0.3))`. Polynomially smaller → Case 1 → `Θ(n^(log_2 7)) ≈ Θ(n^2.807)`. Beats naive `Θ(n³)`. ✓

### Example 5 — Naive D&C matmul: `8T(n/2) + n²` → Case 1

`log_2 8 = 3`, watershed `n³`, `f(n) = n² = O(n^(3−1))`. Case 1 → `Θ(n³)`. (Strassen's `a=7` vs this `a=8` is the entire improvement.) ✓

### Example 6 — `4T(n/2) + n²` → Case 2

`log_2 4 = 2`, watershed `n²`, `f(n) = n² = Θ(n²)`. Match → Case 2 → `Θ(n² log n)`. Note Case 2 is **not** always `n log n`. ✓

### Example 7 — `2T(n/2) + n²` → Case 3

`log_2 2 = 1`, watershed `n`, `f(n) = n² = Ω(n^(1+1))`. Polynomially larger → check regularity: `a·f(n/b) = 2·(n/2)² = n²/2 = (1/2)·f(n)`, so `c = 1/2 < 1` ✓. Case 3 → `Θ(n²)`. ✓

### Example 8 — `2T(n/2) + n³` → Case 3

`log_2 2 = 1`, `f = n³ = Ω(n^(1+2))`. Regularity: `2·(n/2)³ = n³/4 = (1/4) f(n)` ✓. Case 3 → `Θ(n³)`. ✓

### Example 9 — `9T(n/3) + n` → Case 1

`log_3 9 = 2`, watershed `n²`, `f = n = O(n^(2−1))`. Case 1 → `Θ(n²)`. ✓

### Example 10 — `T(n/2) + n` → Case 3

`log_2 1 = 0`, watershed `n^0 = 1`, `f = n = Ω(n^(0+1))`. Regularity: `1·(n/2) = (1/2)n` ✓. Case 3 → `Θ(n)`. (A single recursive call with linear combine, e.g. one-sided quickselect's best case shape.) ✓

### Example 11 (gap) — `2T(n/2) + n log n` → extended Case 2

`log_2 2 = 1`, watershed `n`, `f = n log n`. This is `> n` but only by a `log` factor, **not** `n^ε`. Basic Case 3 fails. Extended Case 2 with `k = 1` → `Θ(n log² n)`. ✓

### Example 12 (gap) — `2T(n/2) + n / log n` → Master Theorem N/A

`f = n/log n` is *smaller* than `n` but only by a `log` factor, so not `O(n^(1−ε))`. Basic Case 1 fails, and the extended form only covers `log^k n` with `k ≥ 0`, not negative powers. The Akra–Bazzi method (see `professional.md`) gives `Θ(n log log n)`. ✓

### Example 13 (median-of-medians, unequal sizes) — `T(n/5) + T(7n/10) + n`

Two *different* subproblem sizes → Master Theorem does not apply. Substitution / Akra–Bazzi gives `Θ(n)`. (The sum of the size fractions `1/5 + 7/10 = 9/10 < 1` is what makes it linear.) ✓

Summary table:

| Recurrence | `log_b a` | `f(n)` | Case | `T(n)` |
|------------|-----------|--------|------|--------|
| `2T(n/2)+n` | 1 | n | 2 | `Θ(n log n)` |
| `T(n/2)+1` | 0 | 1 | 2 | `Θ(log n)` |
| `3T(n/2)+n` | 1.585 | n | 1 | `Θ(n^1.585)` |
| `7T(n/2)+n²` | 2.807 | n² | 1 | `Θ(n^2.807)` |
| `8T(n/2)+n²` | 3 | n² | 1 | `Θ(n³)` |
| `4T(n/2)+n²` | 2 | n² | 2 | `Θ(n² log n)` |
| `2T(n/2)+n²` | 1 | n² | 3 | `Θ(n²)` |
| `9T(n/3)+n` | 2 | n | 1 | `Θ(n²)` |
| `T(n/2)+n` | 0 | n | 3 | `Θ(n)` |
| `2T(n/2)+n log n` | 1 | n log n | ext. 2 | `Θ(n log² n)` |
| `2T(n/2)+n/log n` | 1 | n/log n | N/A | `Θ(n log log n)` |
| `T(n/5)+T(7n/10)+n` | — | n | N/A | `Θ(n)` |

---

## The Extended Master Theorem (Case 2 with k)

The basic theorem has a blind spot: `f(n) = n^(log_b a) · log^k n`. The watershed times a polylog factor. The **extended Case 2** patches it:

> If `f(n) = Θ(n^(log_b a) · log^k n)` for some constant `k ≥ 0`, then
> ```
> T(n) = Θ(n^(log_b a) · log^(k+1) n)
> ```

The intuition: each of the `Θ(log n)` levels contributes work `n^(log_b a) · log^k n`, and summing `log^k` over `log n` levels yields one extra power of `log`, giving `log^(k+1) n`.

| Recurrence | `f(n)` | `k` | `T(n)` |
|------------|--------|-----|--------|
| `2T(n/2) + n` | `n log^0 n` | 0 | `Θ(n log n)` (the ordinary Case 2) |
| `2T(n/2) + n log n` | `n log^1 n` | 1 | `Θ(n log² n)` |
| `2T(n/2) + n log² n` | `n log^2 n` | 2 | `Θ(n log³ n)` |
| `4T(n/2) + n² log n` | `n² log^1 n` | 1 | `Θ(n² log² n)` |

For `k < 0` (e.g. `f = n/log n`, which is `n · log^(−1) n`) the extended theorem is also stated: if `−1 < k < 0` then `T(n) = Θ(n^(log_b a) log log n)`, and if `k = −1` exactly then `T(n) = Θ(n^(log_b a) log log n)` as well; for `k ≤ −1` the leaf term may dominate. These negative-`k` corners are subtle — most courses just say "use Akra–Bazzi" and move on, which we do in `professional.md`.

---

## Comparison with the Substitution Method

The Master Theorem is fast but rigid. The **substitution method** (guess a bound, prove it by induction) and the **recursion-tree method** (draw and sum) are slower but universal. Know when to use which.

| Aspect | Master Theorem | Recursion Tree | Substitution |
|--------|----------------|----------------|--------------|
| Speed | Instant (one comparison) | Medium (draw + sum) | Slow (guess + induct) |
| Generality | Only `a·T(n/b)+f(n)`, polynomial `f` | Any recurrence | Any recurrence |
| Gives | Tight `Θ` | Tight `Θ` (if summed carefully) | Whatever you can prove (often `O`) |
| Unequal sizes | No | Yes | Yes |
| Log-factor gaps | Only with extended form | Yes | Yes |
| Best for | Standard D&C recurrences | Getting a *guess* / handling oddballs | *Proving* a guess rigorously |

**Worked substitution example.** Prove `T(n) = 2T(n/2) + n` is `O(n log n)`. Guess `T(n) ≤ c·n log n`. Inductive step:

```
T(n) ≤ 2 · (c · (n/2) log(n/2)) + n
     = c·n·(log n − 1) + n
     = c·n log n − c·n + n
     ≤ c·n log n        (whenever c ≥ 1)
```

The induction closes for `c ≥ 1`, confirming `O(n log n)` — the same answer the Master Theorem gave in one line via Case 2. Substitution shines when the Master Theorem is silent: you *guess* the answer (often from a recursion tree) and *prove* it by induction.

---

## The Three Methods Side by Side on One Recurrence

To cement when to use which tool, solve `T(n) = 3T(n/4) + n²` three ways and watch them agree.

First identify: `a = 3`, `b = 4`, `f(n) = n²`. Critical exponent `log_4 3 ≈ 0.792`, watershed `n^0.792`.

**Method 1 — Master Theorem.** `f(n) = n² = Ω(n^{0.792 + ε})` for `ε ≈ 1.2`, so it is polynomially larger → Case 3 candidate. Regularity: `a·f(n/b) = 3·(n/4)² = 3n²/16 = (3/16)·f(n)`, and `3/16 < 1` ✓. Case 3 → `T(n) = Θ(n²)`.

**Method 2 — Recursion tree.** Level `i` has `3^i` nodes of size `n/4^i`, work `3^i·(n/4^i)² = n²·(3/16)^i`. The geometric ratio is `r = 3/16 < 1`, so the series is dominated by level 0:
```
T(n) = n² · Σ_{i≥0} (3/16)^i = n² · 1/(1 − 3/16) = n² · 16/13 = Θ(n²).
```
The exact leading constant `16/13` even falls out — the root does ~`16/13 ≈ 1.23` times the top-level work in total.

**Method 3 — Substitution.** Guess `T(n) ≤ c·n²`. Inductive step:
```
T(n) ≤ 3·c·(n/4)² + n² = (3c/16)·n² + n² = (3c/16 + 1)·n².
```
This is `≤ c·n²` whenever `3c/16 + 1 ≤ c`, i.e. `1 ≤ c·(1 − 3/16) = (13/16)c`, i.e. `c ≥ 16/13`. The induction closes for `c ≥ 16/13`, confirming `O(n²)`; the lower bound `Ω(n²)` comes from the root term `f(n) = n²` alone. So `T(n) = Θ(n²)`.

All three methods land on `Θ(n²)`, and methods 2 and 3 even agree on the constant `16/13`. The Master Theorem is fastest; the recursion tree shows *why*; substitution *proves* it rigorously. Use the Master Theorem to get the answer, and keep the other two for recurrences it cannot touch.

---

## Variants and How They Shift the Case

Small changes to `a`, `b`, or `f` flip the dominating term. Internalizing these sensitivities is what makes the theorem second nature.

### Changing `a` (branching factor)

Fix `b = 2`, `f(n) = n`. Vary `a`:

| `a` | `log_2 a` | watershed vs `f=n` | Case | `T(n)` |
|-----|-----------|--------------------|------|--------|
| 1 | 0 | `1 < n` | 3 | `Θ(n)` |
| 2 | 1 | `n = n` | 2 | `Θ(n log n)` |
| 3 | 1.585 | `n^1.585 > n` | 1 | `Θ(n^1.585)` |
| 4 | 2 | `n² > n` | 1 | `Θ(n²)` |

Raising `a` past the point where `log_b a = c` flips you from root-dominated (Case 3) through the balanced tie (Case 2) into leaf-dominated (Case 1). The threshold is `a = b^c`: with `b=2, c=1` that is `a=2`, exactly merge sort's tie.

### Changing `b` (shrink factor)

Fix `a = 2`, `f(n) = n`. Vary `b`:

| `b` | `log_b 2` | Case | `T(n)` |
|-----|-----------|------|--------|
| 1.5 | 1.71 | 1 | `Θ(n^1.71)` |
| 2 | 1 | 2 | `Θ(n log n)` |
| 4 | 0.5 | 3 | `Θ(n)` |

Larger `b` shrinks subproblems faster, lowering `log_b a`, moving you toward root-domination. Smaller `b` does the opposite.

### Changing `f(n)` (combine cost)

Fix `a = 2`, `b = 2` (watershed `n`). Vary `f`:

| `f(n)` | vs watershed `n` | Case | `T(n)` |
|--------|------------------|------|--------|
| `1` | smaller (poly) | 1 | `Θ(n)` |
| `√n` | smaller (poly) | 1 | `Θ(n)` |
| `n / log n` | smaller (log) | gap | `Θ(n log log n)` |
| `n` | equal | 2 | `Θ(n log n)` |
| `n log n` | larger (log) | ext.2 | `Θ(n log² n)` |
| `n^1.5` | larger (poly) | 3 | `Θ(n^1.5)` |
| `n²` | larger (poly) | 3 | `Θ(n²)` |

Notice the two log-factor rows (`n/log n` and `n log n`) are the *gap* cases that the basic theorem cannot classify — they sit just inside the watershed boundary where the geometric ratio `r → 1`.

### Deriving an extended-case answer from scratch

To see *why* `2T(n/2) + n log n` gives `Θ(n log² n)`, unroll the tree. Level `i` has `2^i` nodes of size `n/2^i`, each paying `f(n/2^i) = (n/2^i)·log(n/2^i)`. Level work:
```
2^i · (n/2^i) · log(n/2^i) = n · log(n/2^i) = n · (log n − i).
```
Sum over `i = 0 … L−1` with `L = log₂ n`:
```
Σ_{i=0}^{L−1} n·(log n − i) = n · Σ_{i=0}^{L−1} (log n − i)
                           = n · (log n + (log n − 1) + … + 1)
                           = n · (L(L+1)/2) = n · Θ(log² n) = Θ(n log² n).
```
The arithmetic series `Σ (log n − i)` is the discrete analogue of `∫_0^{log n} u\,du = (log n)²/2`, the integral that the extended-Case-2 proof in `professional.md` evaluates. This is exactly the "one extra power of log" the extended theorem promises: the level work is `n log^1`, and summing `log^1` over `log n` levels yields `log^2`.

---

## A Reference of Common Recurrence Families

Memorizing these families lets you classify most recurrences on sight without recomputing `log_b a` each time.

| Family | Shape | Watershed | Typical result | Example |
|--------|-------|-----------|----------------|---------|
| Halving, no branch | `T(n/b) + Θ(1)` | `n^0 = 1` | `Θ(log n)` (Case 2) | binary search |
| Halving, linear combine | `T(n/b) + Θ(n)` | `1` | `Θ(n)` (Case 3) | one-sided select |
| Balanced binary | `2T(n/2) + Θ(n)` | `n` | `Θ(n log n)` (Case 2) | merge sort, FFT |
| Wide branch, linear | `aT(n/2) + Θ(n)`, `a > 2` | `n^{log₂ a}` | `Θ(n^{log₂ a})` (Case 1) | Karatsuba (a=3) |
| Square branch, quadratic | `aT(n/2) + Θ(n²)` | `n^{log₂ a}` | depends on `a` vs 4 | Strassen (a=7), naive (a=8) |
| Heavy combine | `2T(n/2) + Θ(n^c)`, `c > 1` | `n` | `Θ(n^c)` (Case 3) | costly merge step |
| Polylog combine | `2T(n/2) + Θ(n log^k n)` | `n` | `Θ(n log^{k+1} n)` (ext. 2) | repeated-sort merges |

The decision within the "square branch, quadratic" family is the cleanest illustration of the watershed: `log₂ a` vs `2`. With `a < 4` the combine `n²` wins (Case 3); with `a = 4` it ties (Case 2, `n² log n`); with `a > 4` the leaves win (Case 1, `n^{log₂ a}`). Strassen (`a=7`) and naive (`a=8`) both sit in Case 1, which is why both are determined entirely by their leaf count `n^{log₂ a}`, and why dropping `a` from 8 to 7 is the whole game.

---

## Code Examples

### Example: Master-Theorem Solver with Extended Case 2

This solver handles `f(n) = n^c · log^k n` and reports the case and `T(n)`.

#### Go

```go
package main

import (
	"fmt"
	"math"
)

// solve handles T(n) = a T(n/b) + n^c * log^k n.
func solve(a, b, c, k float64) string {
	crit := math.Log(a) / math.Log(b) // log_b a
	const eps = 1e-9
	switch {
	case c < crit-eps:
		return fmt.Sprintf("Case 1: T(n) = Theta(n^%.4f)", crit)
	case math.Abs(c-crit) <= eps:
		if k >= 0 {
			return fmt.Sprintf("Case 2 (k=%.0f): T(n) = Theta(n^%.4f log^%.0f n)", k, crit, k+1)
		}
		return "Gap (k<0): use Akra-Bazzi"
	default:
		return fmt.Sprintf("Case 3: T(n) = Theta(n^%.4f log^%.0f n)", c, k)
	}
}

func main() {
	fmt.Println("2T(n/2)+n       ", solve(2, 2, 1, 0)) // Case 2 k=0 -> n log n
	fmt.Println("2T(n/2)+n log n ", solve(2, 2, 1, 1)) // Case 2 k=1 -> n log^2 n
	fmt.Println("4T(n/2)+n^2 logn", solve(4, 2, 2, 1)) // Case 2 k=1 -> n^2 log^2 n
	fmt.Println("3T(n/2)+n       ", solve(3, 2, 1, 0)) // Case 1 -> n^1.585
	fmt.Println("2T(n/2)+n^2     ", solve(2, 2, 2, 0)) // Case 3 -> n^2
}
```

#### Java

```java
public class MasterSolver {

    // T(n) = a T(n/b) + n^c * log^k n
    static String solve(double a, double b, double c, double k) {
        double crit = Math.log(a) / Math.log(b);
        final double eps = 1e-9;
        if (c < crit - eps) {
            return String.format("Case 1: T(n) = Theta(n^%.4f)", crit);
        } else if (Math.abs(c - crit) <= eps) {
            if (k >= 0) {
                return String.format("Case 2 (k=%.0f): T(n) = Theta(n^%.4f log^%.0f n)", k, crit, k + 1);
            }
            return "Gap (k<0): use Akra-Bazzi";
        } else {
            return String.format("Case 3: T(n) = Theta(n^%.4f log^%.0f n)", c, k);
        }
    }

    public static void main(String[] args) {
        System.out.println("2T(n/2)+n       " + solve(2, 2, 1, 0));
        System.out.println("2T(n/2)+n log n " + solve(2, 2, 1, 1));
        System.out.println("4T(n/2)+n^2 logn" + solve(4, 2, 2, 1));
        System.out.println("3T(n/2)+n       " + solve(3, 2, 1, 0));
        System.out.println("2T(n/2)+n^2     " + solve(2, 2, 2, 0));
    }
}
```

#### Python

```python
import math


def solve(a, b, c, k):
    """T(n) = a T(n/b) + n^c * log^k n."""
    crit = math.log(a) / math.log(b)
    eps = 1e-9
    if c < crit - eps:
        return f"Case 1: T(n) = Theta(n^{crit:.4f})"
    elif abs(c - crit) <= eps:
        if k >= 0:
            return f"Case 2 (k={k:.0f}): T(n) = Theta(n^{crit:.4f} log^{k + 1:.0f} n)"
        return "Gap (k<0): use Akra-Bazzi"
    else:
        return f"Case 3: T(n) = Theta(n^{c:.4f} log^{k:.0f} n)"


if __name__ == "__main__":
    print("2T(n/2)+n       ", solve(2, 2, 1, 0))
    print("2T(n/2)+n log n ", solve(2, 2, 1, 1))
    print("4T(n/2)+n^2 logn", solve(4, 2, 2, 1))
    print("3T(n/2)+n       ", solve(3, 2, 1, 0))
    print("2T(n/2)+n^2     ", solve(2, 2, 2, 0))
```

**What it does:** classifies a recurrence with `f(n) = n^c log^k n`, including the extended Case 2 that produces the extra `log` factor.
**Run:** `go run main.go` | `javac MasterSolver.java && java MasterSolver` | `python solver.py`

### Example: Numerically Verify the Geometric Series

This sums the recursion tree numerically and compares against the closed form, confirming the case.

#### Python

```python
import math


def tree_sum(a, b, c, n):
    """Sum a^i * (n/b^i)^c over all levels until size < 1."""
    total, size, nodes = 0.0, float(n), 1.0
    while size >= 1:
        total += nodes * (size ** c)
        size /= b
        nodes *= a
    return total


def closed_form(a, b, c, n):
    crit = math.log(a) / math.log(b)
    if c < crit:
        return n ** crit                 # Case 1
    if abs(c - crit) < 1e-9:
        return (n ** crit) * math.log2(n)  # Case 2
    return n ** c                        # Case 3


for (a, b, c) in [(2, 2, 1), (3, 2, 1), (2, 2, 2)]:
    n = 1 << 20
    print(a, b, c, "tree=", f"{tree_sum(a,b,c,n):.3e}",
          "closed=", f"{closed_form(a,b,c,n):.3e}")
```

The `tree=` and `closed=` columns agree up to a constant factor, the empirical proof of each case.

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Case 2 gives wrong power of `log` | Ignored the `log^k n` factor in `f(n)`. | Use extended Case 2: result is `log^(k+1) n`. |
| Forced Case 1/3 on a `log`-gap | Treated a `log` factor as a polynomial difference. | A `log` factor is not `n^ε`; it's a gap → extended form. |
| Geometric-series ratio miscomputed | Used `a/b` instead of `a/b^c`. | The ratio is `r = a/b^c`; the `c` exponent matters. |
| Regularity skipped, Case 3 wrong | Didn't verify `a·f(n/b) ≤ c·f(n)`. | Always check; for pure powers it holds, for odd `f` it may not. |
| Substitution induction "almost" works | Off-by-a-lower-order-term in the inductive step. | Strengthen the hypothesis (subtract a lower-order term). |

---

## Performance Analysis

The Master Theorem is an *analysis* tool, not an algorithm, so "performance" means: which method to reach for, and how the resulting `T(n)` behaves.

- **The leaf floor.** Every `a·T(n/b)+f(n)` recurrence is `Ω(n^(log_b a))`. You can never beat the leaf count by improving `f`; to go faster you must lower `a` (fewer subproblems) or raise `b` (smaller subproblems). Strassen beats naive matmul precisely by dropping `a` from 8 to 7.
- **The cost of the combine.** In Case 3 the whole cost *is* `f(n)`; optimizing the combine step directly improves `T(n)`. In Case 1 the combine is irrelevant asymptotically — a constant-factor combine speedup is wasted effort.
- **Case 2 sweet spot.** Merge sort and FFT-style algorithms live here: balanced trees where every level matters and the `log n` factor is unavoidable.
- **Crossover with iteration.** For small `n`, recursion overhead dominates; production sorts switch to insertion sort below a threshold. The Master Theorem describes the *asymptotic* regime only.

---

## Best Practices

- Derive the ratio `r = a/b^c` mentally; it tells you the case faster than computing `log_b a` and the watershed separately.
- When `f(n)` carries a `log` factor, jump straight to the extended Case 2 — don't waste time trying Cases 1/3.
- Use a recursion tree to *guess*, then substitution to *prove*, whenever the Master Theorem is silent.
- For unequal subproblem sizes, recognize immediately that the Master Theorem is out and Akra–Bazzi is in.
- Keep the famous-results table in your head; most interview recurrences are a famous result in disguise.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - Entering `a`, `b`, and `f(n) = n^c` and watching the recursion tree grow level by level
> - The per-level work `a^i · f(n/b^i)` plotted as bars, revealing whether they grow, stay flat, or shrink
> - The geometric ratio `r = a/b^c` displayed live, with the dominating level highlighted
> - Which case wins (leaves / balanced / root) announced as the series is summed

---

## Summary

The Master Theorem is the recursion-tree method pre-solved for `f(n) = n^c`. Unrolling the recurrence gives a geometric series `n^c · Σ (a/b^c)^i` whose ratio `r = a/b^c` has three behaviors: `r > 1` (leaves dominate → Case 1, `Θ(n^(log_b a))`), `r = 1` (all levels tie → Case 2, `Θ(n^(log_b a) log n)`), and `r < 1` (root dominates → Case 3, `Θ(f(n))`, given regularity). The word "polynomially" in Cases 1 and 3 exists because the series only collapses to one term when the ratio is bounded away from 1 by a constant — a `log` factor leaves it stuck in the gap, handled by the **extended Case 2** that adds one power of `log`. A bank of worked examples (merge sort, binary search, Karatsuba, Strassen, naive matmul, median-of-medians) shows the cases in action, and the comparison with substitution and recursion-tree methods shows what to do when the theorem is silent. Master the ratio `r = a/b^c` and the geometric series, and every case becomes obvious.
