# Inclusion-Exclusion Principle (PIE) — Middle Level

> **Focus:** *why* PIE works and *when* to choose it — the **complement form** ("none of the properties"), the **bitmask loop over `n` sets**, and the workhorse applications: counting integers **coprime to** a value (linking to Euler's totient and Möbius), counting integers **divisible by at least one** of a set via LCM, **derangements**, and **surjection counting**. You also learn when `2ⁿ` is acceptable and when to switch to the Möbius/divisor view.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Counting Coprime and Divisible-By](#counting-coprime-and-divisible-by)
6. [Derangements and Surjections](#derangements-and-surjections)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was the alternating formula: `+` singles, `−` pairs, `+` triples. At middle level you turn that formula into reliable engineering decisions:

- **Why** does the alternation produce exactly-once counting? (Every element is counted once in the union; the proof is a tiny binomial identity.)
- **When** is the **complement form** ("none of the properties") cleaner than the direct union?
- **How** do you iterate the `2ⁿ` subsets efficiently with a **bitmask**, and how do you know `2ⁿ` is affordable?
- **How** does PIE compute the count of integers **coprime** to `m` — and how is that the same object as Euler's totient `φ(m)` and a Möbius sum?
- **How** do **derangements** (permutations with no fixed point) and **surjection counts** fall out of PIE in one line each?

These questions separate "I can plug into the formula" from "I can recognize a PIE problem, pick the direct-or-complement form, and bound its cost."

---

## Deeper Concepts

### Why every element is counted exactly once

Take an element `x` that lies in **exactly `t` of the sets** (`t ≥ 1`, so it *is* in the union and should contribute `1`). How many PIE terms contain `x`? A term is an intersection of some subset `S` of the sets; `x` is in that intersection iff `S` is a subset of the `t` sets containing `x`. The number of size-`k` such subsets is `C(t, k)`, and each contributes with sign `(−1)^(k+1)`. So `x`'s total contribution is:

```
Σ_{k=1}^{t} (−1)^(k+1) C(t, k)
  = −Σ_{k=1}^{t} (−1)^k C(t, k)
  = −[ (Σ_{k=0}^{t} (−1)^k C(t, k)) − 1 ]
  = −[ (1 − 1)^t − 1 ]
  = −[ 0 − 1 ] = 1.
```

The binomial theorem `(1 − 1)^t = 0` makes all the over-counts cancel, leaving exactly `1`. An element in **zero** sets appears in no term and contributes `0`. So the signed sum counts each union member exactly once — that is the entire correctness argument, and the full proof lives in [`professional.md`](./professional.md).

### The complement form as the natural starting point

The "none of the properties" count is:

```
#(none) = Σ_{S ⊆ {1..n}} (−1)^|S| |⋂_{i∈S} Aᵢ|,
```

where the empty subset `S = ∅` contributes `(−1)^0 |whole universe| = +N`. This is the *same* alternating sum as the union, just folded so it begins at the universe. Many problems are *stated* as "none" — count numbers coprime to `m` (divisible by none of its primes), count permutations with no fixed point (derangements), count colorings avoiding all forbidden patterns. Reaching for the complement form first often makes the sets `Aᵢ` (the "bad" events) easier to describe than the union.

### The bitmask correspondence

Each subset `S ⊆ {0, …, n−1}` is encoded by an integer `mask ∈ [0, 2ⁿ)` where bit `i` is set iff `i ∈ S`. Then:

- `mask = 0` ↔ empty subset (the universe term in the complement form).
- `popcount(mask)` = `|S|` = the number of sets in this intersection → drives the sign.
- Looping `mask` from `1` to `2ⁿ − 1` enumerates every **non-empty** subset (the union form); from `0` includes the universe (the complement form).

This is the single most important implementation idiom for PIE: **the whole principle is one `for mask` loop**.

### When the term is zero — pruning

If an intersection is empty (or its count is 0, e.g. `⌊N/lcm⌋ = 0` once `lcm > N`), the term contributes nothing. Recognizing and skipping such subtrees is the basis of pruning the `2ⁿ` blowup (covered in `senior.md`): once a partial LCM exceeds `N`, **every superset** of that subset also has a zero term, so you can prune the entire branch.

---

## Comparison with Alternatives

### Choosing how to count "at least one / none"

| Method | Best when | Cost | Notes |
|--------|-----------|------|-------|
| **PIE (bitmask)** | few properties (`n ≤ ~20`), huge universe `N` | `O(2ⁿ · n)` | exact, independent of `N` |
| **Brute force** | small universe `N`, any `n` | `O(N · n)` | the correctness oracle |
| **Möbius over prime factors** | "coprime / divisible by primes of `m`" | `O(2^ω(m))` or `O(√m)` to factor | PIE specialized to divisors (sibling `32`) |
| **Sieve** (e.g. linear sieve of `φ`) | totients of a whole *range* | `O(n log log n)` | when you need many answers at once (sibling `04`) |
| **Direct DP / recurrence** | structured constraints (derangements) | `O(n)` | once PIE *derives* the recurrence |

The crossover is clear: PIE wins when `n` (number of properties) is small and `N` is large; brute force wins when `N` is small; sieve/Möbius win when you need answers for an entire range or when the "sets" are the prime factors of a single number.

### Direct union vs complement

| | Direct union (`|A₁ ∪ … ∪ Aₙ|`) | Complement (`#none`) |
|--|---------------------------------|----------------------|
| Loop range | `mask = 1 .. 2ⁿ−1` | `mask = 0 .. 2ⁿ−1` (or `N −` union) |
| First term | `+Σ|Aᵢ|` | `+N` (universe) |
| Natural for | "how many satisfy at least one?" | "how many satisfy none?" (coprime, derangement) |
| Sign of `k`-set term | `(−1)^(k+1)` | `(−1)^k` |

They are algebraically identical (`#none = N − union`); pick whichever matches the problem statement to minimize setup mistakes.

### Same-size collapse vs full bitmask

| | Full bitmask (`2ⁿ`) | Same-size collapse (`n+1`) |
|--|--------------------|----------------------------|
| When valid | always | only when `\|A_S\|` depends *only* on `\|S\|=k` |
| Term count | `2ⁿ − 1` (or `2ⁿ`) | `n + 1` (one per `k`) |
| Sign source | `popcount(mask)` | `(−1)^k` per group |
| Examples | divisible-by, dedup over distinct sets | derangements `(n−k)!`, surjections `(m−k)^n` |
| Cost | `O(2ⁿ · n)` | `O(n)` |

The collapse is the single most important `2ⁿ → n` optimization at this level: when every size-`k` subset has the *same* intersection size, the `C(n,k)` identical terms merge into one `C(n,k)·(−1)^k·|term|` summand. Derangements and surjections are exactly this case; divisible-by-at-least-one is *not* (each subset has a different LCM), so it stays `2ⁿ`.

---

## Advanced Patterns

### Pattern: Generic PIE over `n` sets via a callback

#### Go

```go
package main

import "fmt"

// pie computes the inclusion-exclusion sum where countIntersection(mask)
// returns |⋂ of the sets selected by mask|. Pass includeEmpty=true for the
// complement ("none") form, false for the union ("at least one") form.
func pie(n int, includeEmpty bool, countIntersection func(mask int) int64) int64 {
	start := 1
	if includeEmpty {
		start = 0
	}
	var total int64
	for mask := start; mask < (1 << n); mask++ {
		bits := popcount(mask)
		term := countIntersection(mask)
		if bits%2 == 0 {
			total += term // even (incl. empty): + in complement form
		} else {
			total -= term
		}
	}
	return total
}

func popcount(x int) int {
	c := 0
	for x != 0 {
		x &= x - 1
		c++
	}
	return c
}

func main() {
	// Count integers in [1,30] coprime to 30 = none divisible by 2,3,5.
	primes := []int64{2, 3, 5}
	N := int64(30)
	gcd := func(a, b int64) int64 {
		for b != 0 {
			a, b = b, a%b
		}
		return a
	}
	res := pie(len(primes), true, func(mask int) int64 {
		l := int64(1)
		for i := 0; i < len(primes); i++ {
			if mask&(1<<i) != 0 {
				l = l / gcd(l, primes[i]) * primes[i]
			}
		}
		return N / l
	})
	fmt.Println(res) // 8 = φ(30)
}
```

#### Java

```java
public class GenericPIE {
    interface Counter { long count(int mask); }

    static long pie(int n, boolean includeEmpty, Counter c) {
        long total = 0;
        int start = includeEmpty ? 0 : 1;
        for (int mask = start; mask < (1 << n); mask++) {
            int bits = Integer.bitCount(mask);
            long term = c.count(mask);
            if (bits % 2 == 0) total += term; // even (incl. empty)
            else total -= term;
        }
        return total;
    }

    static long gcd(long a, long b) { while (b != 0) { long t = a % b; a = b; b = t; } return a; }

    public static void main(String[] args) {
        long[] primes = {2, 3, 5};
        long N = 30;
        long res = pie(primes.length, true, mask -> {
            long l = 1;
            for (int i = 0; i < primes.length; i++)
                if ((mask & (1 << i)) != 0) l = l / gcd(l, primes[i]) * primes[i];
            return N / l;
        });
        System.out.println(res); // 8 = φ(30)
    }
}
```

#### Python

```python
from math import gcd


def pie(n, include_empty, count_intersection):
    """Generic inclusion-exclusion driver. count_intersection(mask) -> |⋂ chosen|."""
    total = 0
    start = 0 if include_empty else 1
    for mask in range(start, 1 << n):
        bits = bin(mask).count("1")
        term = count_intersection(mask)
        if bits % 2 == 0:          # even subset (incl. empty) -> +
            total += term
        else:
            total -= term
    return total


if __name__ == "__main__":
    primes, N = [2, 3, 5], 30

    def count(mask):
        l = 1
        for i, p in enumerate(primes):
            if mask & (1 << i):
                l = l // gcd(l, p) * p
        return N // l

    print(pie(len(primes), include_empty=True, count_intersection=count))  # 8 = φ(30)
```

### Pattern: Möbius-flavored sign from squarefree divisors

When the sets are the **distinct prime factors** of `m`, each subset corresponds to a **squarefree divisor** `d` (the product of the chosen primes), and the sign `(−1)^(number of primes)` is exactly the **Möbius function** `μ(d)`. So the complement (coprime) count becomes:

```
#(x ∈ [1,N] coprime to m) = Σ_{d | rad(m)} μ(d) · ⌊N/d⌋,
```

where `rad(m)` is the product of distinct primes of `m`. This is PIE rewritten as a Möbius sum — the bridge to sibling `32-mobius-inversion`.

---

## Counting Coprime and Divisible-By

### Coprime to `m` in `[1, N]`

"Coprime to `m`" means "divisible by none of `m`'s prime factors". Let the distinct primes of `m` be `p₁, …, p_r`. By the complement form:

```
#(coprime to m in [1,N]) = Σ_{S ⊆ {p₁..p_r}} (−1)^|S| ⌊ N / (∏_{p∈S} p) ⌋.
```

When `N = m`, this is precisely **Euler's totient** `φ(m)` — the inclusion-exclusion derivation of the totient formula `φ(m) = m ∏(1 − 1/p)`:

```
φ(m) = m − Σ⌊m/pᵢ⌋ + Σ⌊m/(pᵢpⱼ)⌋ − … = m ∏ (1 − 1/pᵢ).
```

So **the totient *is* a PIE computation** over the prime factors. (See sibling `05-fermat-euler` for the totient in depth.)

### Divisible by at least one of `k₁, …, kₙ`

The direct union form, with each pairwise (and higher) intersection counted via the **LCM** of the chosen `kᵢ`:

```
#(divisible by ≥1) = Σ_{∅≠S} (−1)^(|S|+1) ⌊ N / lcm(S) ⌋.
```

The only subtlety versus the coprime case: the `kᵢ` need not be primes, so intersections use `lcm`, not the product. If `kᵢ` are pairwise coprime, `lcm = product` and the two formulas coincide.

### Worked numeric: coprime to 12 in [1, 12]

`12 = 2² · 3`, distinct primes `{2, 3}`:

```
φ(12) = 12 − ⌊12/2⌋ − ⌊12/3⌋ + ⌊12/6⌋
      = 12 − 6 − 4 + 2 = 4.
```

The coprime residues are `{1, 5, 7, 11}` — exactly 4, confirming PIE = totient.

---

## Derangements and Surjections

### Derangements: permutations with no fixed point

A **derangement** of `{1, …, n}` is a permutation where no element stays in its own position. Let `Aᵢ` = permutations fixing position `i`. We want permutations in **none** of the `Aᵢ`. There are `n!` permutations total; `|⋂_{i∈S} Aᵢ| = (n − |S|)!` (fix the `|S|` chosen positions, permute the rest freely). By the complement form:

```
D(n) = Σ_{k=0}^{n} (−1)^k C(n, k) (n − k)! = n! Σ_{k=0}^{n} (−1)^k / k!.
```

That tidy alternating sum gives `D(0)=1, D(1)=0, D(2)=1, D(3)=2, D(4)=9, D(5)=44`, and `D(n)/n! → 1/e ≈ 0.3679`. PIE turns a messy "avoid all fixed points" question into a one-line sum.

### Surjections (onto functions) and Stirling numbers

How many functions from an `n`-element set onto an `m`-element set are **surjective** (hit every output)? Let `Aᵢ` = functions that **miss** output `i`. We want functions in none of the `Aᵢ`. There are `m^n` functions total; `|⋂_{i∈S} Aᵢ| = (m − |S|)^n` (functions avoiding the `|S|` chosen outputs). By PIE:

```
Surj(n, m) = Σ_{k=0}^{m} (−1)^k C(m, k) (m − k)^n.
```

Dividing by `m!` gives the **Stirling number of the second kind** `S(n, m) = Surj(n,m)/m!`, the count of ways to partition `n` items into `m` non-empty unlabeled groups. So PIE is the standard derivation of the surjection count and Stirling numbers.

### Comparison: which PIE setup for which problem

| Problem | Universe | "Bad" set `Aᵢ` | Intersection size |
|---------|----------|----------------|-------------------|
| Coprime to `m` | `[1, N]` | divisible by prime `pᵢ` | `⌊N / ∏ pᵢ⌋` |
| Divisible by ≥1 of `kᵢ` | `[1, N]` | divisible by `kᵢ` | `⌊N / lcm(kᵢ)⌋` |
| Derangements | all `n!` perms | fixes position `i` | `(n − |S|)!` |
| Surjections onto `m` | all `m^n` funcs | misses output `i` | `(m − |S|)^n` |
| Forbidden positions | placements | uses forbidden cell `i` | problem-specific (rook polynomial) |

---

## Code Examples

### Derangements via PIE

#### Python

```python
from math import comb, factorial


def derangements(n):
    """D(n) = sum_{k=0}^{n} (-1)^k C(n,k) (n-k)! via inclusion-exclusion."""
    return sum((-1) ** k * comb(n, k) * factorial(n - k) for k in range(n + 1))


if __name__ == "__main__":
    print([derangements(n) for n in range(7)])  # [1, 0, 1, 2, 9, 44, 265]
```

#### Go

```go
package main

import "fmt"

func factorial(n int) int64 {
	r := int64(1)
	for i := int64(2); i <= int64(n); i++ {
		r *= i
	}
	return r
}

func comb(n, k int) int64 {
	if k < 0 || k > n {
		return 0
	}
	r := int64(1)
	for i := 0; i < k; i++ {
		r = r * int64(n-i) / int64(i+1)
	}
	return r
}

func derangements(n int) int64 {
	var total int64
	for k := 0; k <= n; k++ {
		term := comb(n, k) * factorial(n-k)
		if k%2 == 0 {
			total += term
		} else {
			total -= term
		}
	}
	return total
}

func main() {
	for n := 0; n <= 6; n++ {
		fmt.Print(derangements(n), " ") // 1 0 1 2 9 44 265
	}
	fmt.Println()
}
```

#### Java

```java
public class Derangements {
    static long factorial(int n) {
        long r = 1;
        for (int i = 2; i <= n; i++) r *= i;
        return r;
    }

    static long comb(int n, int k) {
        if (k < 0 || k > n) return 0;
        long r = 1;
        for (int i = 0; i < k; i++) r = r * (n - i) / (i + 1);
        return r;
    }

    static long derangements(int n) {
        long total = 0;
        for (int k = 0; k <= n; k++) {
            long term = comb(n, k) * factorial(n - k);
            if (k % 2 == 0) total += term; else total -= term;
        }
        return total;
    }

    public static void main(String[] args) {
        for (int n = 0; n <= 6; n++) System.out.print(derangements(n) + " ");
        // 1 0 1 2 9 44 265
        System.out.println();
    }
}
```

### Surjection count via PIE (Python)

```python
from math import comb


def surjections(n, m):
    """Onto functions from n-set to m-set: sum_{k} (-1)^k C(m,k) (m-k)^n."""
    return sum((-1) ** k * comb(m, k) * (m - k) ** n for k in range(m + 1))


def stirling2(n, m):
    return surjections(n, m) // (1 if m == 0 else __import__("math").factorial(m))


if __name__ == "__main__":
    print(surjections(4, 2))  # 14  (2^4 = 16 functions, minus 2 constant)
    print(surjections(3, 3))  # 6   (= 3! permutations)
    print(stirling2(4, 2))    # 7
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Coprime count uses all factors of `m` | Repeated primes (e.g. `2²`) add duplicate terms. | Use only the **distinct** primes (the radical). |
| Divisible-by uses product not LCM | "both `4` and `6`" miscounted. | Intersection size is `⌊N/lcm⌋`. |
| Sign wrong in complement form | Used `(−1)^(k+1)` instead of `(−1)^k`. | Complement: empty/even subsets `+`, odd `−`. |
| Surjection with `m > n` | Should be 0 (can't be onto). | PIE naturally yields 0; verify it does. |
| Overflow in `(m−k)^n` or `lcm` | Large exponent/LCM overflows 64-bit. | Use bignum (Python), 128-bit, or mod arithmetic. |
| `2ⁿ` loop too large | `n` (number of properties) too big. | Switch to Möbius/divisor structure or DP. |

---

## Performance Analysis

| Task | Scale | Cost |
|------|-------|------|
| PIE over `n` properties (bitmask) | `n ≤ 20` | `O(2ⁿ · n)` ≈ `2·10^7` ops — fast |
| Divisible-by-at-least-one, `N` huge | `N ≤ 10^18`, `n ≤ 20` | `O(2ⁿ · n)` — independent of `N` |
| Coprime count over `ω(m)` distinct primes | `ω(m) ≤ 15` | `O(2^ω(m))` — `ω(m)` is tiny in practice |
| Derangements / surjections | `n, m ≤ 10^6` | `O(n)` (linear sum, not `2ⁿ`!) |
| Brute-force oracle | `N ≤ 10^6` | `O(N · n)` |

Note the contrast: **set-based** PIE (divisible-by, coprime) costs `2ⁿ` in the number of *sets*, but **the derangement/surjection sums are only `O(n)`** because their intersection sizes depend only on `|S| = k`, so the `C(n,k)` identical-size subsets collapse into a single `k`-indexed term. Recognizing when subsets of the same size are interchangeable is the key optimization — it turns `2ⁿ` into `n+1`.

```python
import time

def benchmark(n):
    start = time.perf_counter()
    total = 0
    for mask in range(1 << n):
        total += bin(mask).count("1")
    return time.perf_counter() - start

# n = 22 (~4M masks) runs in well under a second in CPython.
```

---

## Best Practices

- **Pick direct vs complement to match the problem statement** — "at least one" → direct union; "none / coprime / no fixed point" → complement. It minimizes setup errors.
- **Collapse same-size subsets** when the intersection size depends only on `|S|` (derangements, surjections) — turns `O(2ⁿ)` into `O(n)`.
- **Use distinct primes (the radical)** for coprime counts; repeated prime powers add nothing.
- **Use `lcm`, not the product**, for divisible-by intersections unless the values are pairwise coprime.
- **Always validate against the brute-force oracle** on small inputs; PIE sign bugs are silent.
- **Recognize the Möbius restatement** for prime-factor sets — it is the same sum and links to sibling `32-mobius-inversion`.

---

## Visual Animation

> See [`animation.html`](./animation.html) for interactive visualization.
>
> The middle-level animation highlights:
> - The Venn regions of two/three sets, each lit as its `+`/`−` term is applied, showing how over-counts cancel to count each region once.
> - A **bitmask subset enumeration** for "divisible by at least one", displaying each mask, its chosen numbers, the LCM, `⌊N/lcm⌋`, the sign, and the running total.
> - Toggle between the **direct union** and **complement** views to see the same answer reached from both ends.
> - Editable `N` and number list so you can watch the totient emerge when the inputs are the prime factors of `N`.

---

## Summary

PIE is correct because every element in exactly `t` sets contributes `Σ_{k=1}^{t} (−1)^(k+1) C(t,k) = 1` (a binomial cancellation), and `0` if in no set. The **complement form** `#none = Σ (−1)^|S| |⋂ Aᵢ|` starts from the universe and is the natural shape for "coprime / no fixed point" problems. Computationally the whole principle is **one bitmask loop** over `2ⁿ` subsets, with the sign driven by `popcount`. The marquee applications: counting integers **coprime to `m`** (which *is* Euler's totient `φ(m) = m∏(1−1/p)`, and rewrites as a **Möbius sum** over squarefree divisors — sibling `32`), counting integers **divisible by at least one** of several values via `⌊N/lcm⌋`, **derangements** `D(n) = n!Σ(−1)^k/k!`, and **surjections / Stirling numbers** `Σ(−1)^k C(m,k)(m−k)^n`. Set-based PIE is `O(2ⁿ)` in the number of properties (fine for `n ≤ 20`, independent of `N`), but collapses to `O(n)` when same-size subsets are interchangeable. Choose direct-or-complement to fit the question, use LCM for intersections, and switch to Möbius/structure when `n` grows.

Next step: continue to [`senior.md`](./senior.md) for large-scale counting (analytics, dedup), pruning the `2ⁿ` blowup, and combining PIE with sieves and Möbius inversion.
