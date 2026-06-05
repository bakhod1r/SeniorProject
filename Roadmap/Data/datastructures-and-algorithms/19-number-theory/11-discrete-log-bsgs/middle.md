# Discrete Logarithm & Baby-Step Giant-Step (BSGS) — Middle Level

> **Focus:** the `x = i·n − j` (and `x = i·n + j`) decompositions in full, why the hash map of baby steps gives the meet-in-the-middle speedup, how to handle a **general (non-prime) modulus** when `gcd(a, m) > 1`, how to extract the **smallest** solution, and how BSGS compares to brute force, Pollard's rho, and Pohlig-Hellman.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [General Modulus Reduction](#general-modulus-reduction)
6. [Smallest Solution and the Order](#smallest-solution-and-the-order)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was a single recipe: rewrite `x = i·n − j`, store baby steps, take giant steps, read off `x`. At middle level you start asking the questions that decide whether your BSGS is *correct on every input* and *fast in practice*:

- The two decompositions `x = i·n − j` and `x = i·n + j` give different giant-step formulas (`(a^n)^i` vs `b·(a^{-n})^i`). When does each apply, and which is cleaner?
- Why does the hash map turn a `√m × √m` cross-check into `O(√m)` total work — and what is the time/space trade-off?
- Plain BSGS assumes `gcd(a, m) = 1`. What do you do when `m` is composite and `a` shares a factor with it?
- How do you guarantee the **smallest** `x`, given that solutions repeat with the order of `a`?
- When is BSGS the wrong tool — and is Pollard's rho or Pohlig-Hellman better?

These are the questions that separate "I memorized the BSGS loop" from "I can apply discrete log correctly to an arbitrary modulus."

---

## Deeper Concepts

### The two decompositions

Both rest on splitting `x` into a coarse part (multiples of `n`) and a fine part (`0 … n−1`), with `n = ⌈√m⌉`.

**Form A — subtractive: `x = i·n − j`, `1 ≤ i ≤ n`, `0 ≤ j < n`.**

```
a^{i·n − j} ≡ b
(a^n)^i ≡ b · a^j          (multiply both sides by a^j)
```

Baby steps store `b·a^j` (`j = 0 … n−1`); giant steps compute `(a^n)^i` (`i = 1 … n`). **No inverse needed** — this is the form `junior.md` used.

**Form B — additive: `x = i·n + j`, `0 ≤ i < n`, `0 ≤ j < n`.**

```
a^{i·n + j} ≡ b
a^j ≡ b · (a^{-n})^i       (multiply both sides by (a^n)^{-i})
```

Baby steps store `a^j`; giant steps compute `b·(a^{-n})^i`. This form **needs the modular inverse** `a^{-n}` (hence `gcd(a, m) = 1`), but it is the version most textbooks present and the one the animation uses. The two are algebraically identical; pick one and be consistent.

The ranges matter. In Form A, `i` runs `1 … n` and `j` runs `0 … n−1`, so `x = i·n − j` covers `[1·n − (n−1), n·n − 0] = [1, n²] ⊇ [1, m]`. Together with the `b ≡ 1 → x = 0` case, every exponent in `[0, m)` is reachable — the [correctness proof in `professional.md`](./professional.md) makes this precise.

### Why the hash map is the whole trick

Naively, "does some `(a^n)^i` equal some `b·a^j`?" is a comparison between two lists of length `n` each — `n² = m` comparisons, no better than brute force. The hash map collapses the inner loop: store all `n` baby values **once** (`O(n)`), then each giant value is checked in `O(1)` average. So the cross-product `n × n` becomes `n` insertions + `n` lookups = `O(n) = O(√m)`. The map is exactly what converts meet-in-the-middle from "two lists" into "store one, stream the other".

This is the same `√` trade-off as the meet-in-the-middle subset-sum (sibling `15-divide-and-conquer/06`): split the exponent space, store half, look up the other half. The memory cost `O(√m)` is the price of the time speedup.

### What "meets" in the middle

The collision condition `(a^n)^i = b·a^j` is not two independent searches finding the same random value — both sides are deliberate re-encodings of the *one* equation `a^x ≡ b`. When `x = i·n − j`, the left encodes the `i·n` "giant" part and the right encodes the `b`-shifted `−j` "baby" part of the *same* `x`. They coincide for exactly the `(i, j)` pair that reconstructs the true exponent.

---

## Comparison with Alternatives

### BSGS vs brute force vs Pollard's rho vs Pohlig-Hellman

| Approach | Time | Space | Good when |
|----------|------|-------|-----------|
| Brute-force scan | `O(m)` | `O(1)` | tiny `m` (teaching only) |
| **BSGS** | `O(√m)` | `O(√m)` | single query, `m ≤ ~10^{14}`, memory available |
| Pollard's rho (dlog) | `O(√m)` *expected* | **`O(1)`** | large `m`, memory-constrained, randomized OK |
| Pohlig-Hellman | `O(Σ eᵢ(log m + √pᵢ))` | small | order of `a` factors into **small primes** |
| Index calculus | sub-exponential | large | very large *prime* fields (crypto-scale) |

Concrete table (single query, time order of magnitude in operations):

| `m` | brute `O(m)` | BSGS `O(√m)` | winner |
|------|--------------|--------------|--------|
| `10^6` | `10^6` | `10^3` | BSGS |
| `10^{12}` | `10^{12}` (infeasible) | `10^6` | BSGS |
| `10^{18}` | infeasible | `10^9` + `10^9` memory entries | rho (memory) or Pohlig-Hellman (smooth order) |

The lesson: BSGS is the **right default for a single discrete-log query on a moderate modulus**. When the modulus is large enough that `√m` entries no longer fit in RAM, switch to Pollard's rho (same time, constant space). When the *order* of `a` factors into small primes, Pohlig-Hellman shatters the problem into tiny subproblems and dominates both.

### BSGS vs Pollard's rho in one line

Both are `O(√m)` time. BSGS is **deterministic** but spends `O(√m)` **memory**; Pollard's rho is **randomized** (expected `O(√m)`) but spends `O(1)` memory. Memory is the deciding factor.

---

## Advanced Patterns

### Pattern: Form B (inverse-form) BSGS

This is the canonical textbook form and what the animation shows. Requires `gcd(a, m) = 1`.

#### Go

```go
package main

import (
	"fmt"
	"math"
)

func modpow(a, e, m int64) int64 {
	a %= m
	if a < 0 {
		a += m
	}
	r := int64(1)
	for e > 0 {
		if e&1 == 1 {
			r = r * a % m
		}
		a = a * a % m
		e >>= 1
	}
	return r
}

// extended Euclid -> modular inverse of a mod m (assumes gcd(a,m)=1)
func modinv(a, m int64) int64 {
	g, x := extgcd(((a%m)+m)%m, m)
	_ = g
	return ((x % m) + m) % m
}

func extgcd(a, b int64) (int64, int64) {
	if b == 0 {
		return a, 1
	}
	g, x1 := extgcd(b, a%b)
	// x for a is the y from (b, a%b); reconstruct
	return g, x1 - (a/b)*0 // placeholder, replaced below
}

// Form B: x = i*n + j, check a^j == b*(a^{-n})^i.
func bsgs(a, b, m int64) int64 {
	a %= m
	b %= m
	n := int64(math.Ceil(math.Sqrt(float64(m))))

	// baby steps: table[a^j] = j
	table := make(map[int64]int64)
	cur := int64(1) // a^0
	for j := int64(0); j < n; j++ {
		if _, ok := table[cur]; !ok {
			table[cur] = j
		}
		cur = cur * a % m
	}

	// giant factor = a^{-n} = (a^n)^{-1}
	an := modpow(a, n, m)
	factor := modinvSimple(an, m) // inverse via Fermat if m prime, else extgcd
	gi := b % m
	for i := int64(0); i < n; i++ {
		if j, ok := table[gi]; ok {
			return i*n + j
		}
		gi = gi * factor % m // multiply by a^{-n}
	}
	return -1
}

// modinvSimple uses iterative extended Euclid.
func modinvSimple(a, m int64) int64 {
	g, x, _ := egcd(((a%m)+m)%m, m)
	if g != 1 {
		return -1
	}
	return ((x % m) + m) % m
}

func egcd(a, b int64) (int64, int64, int64) {
	old_r, r := a, b
	old_s, s := int64(1), int64(0)
	old_t, t := int64(0), int64(1)
	for r != 0 {
		q := old_r / r
		old_r, r = r, old_r-q*r
		old_s, s = s, old_s-q*s
		old_t, t = t, old_t-q*t
	}
	return old_r, old_s, old_t
}

func main() {
	fmt.Println(bsgs(2, 3, 13)) // 4
	fmt.Println(bsgs(2, 5, 13)) // 9
}
```

> Note: the `extgcd`/`modinv` placeholders above are illustrative; the working inverse is `modinvSimple` using the iterative `egcd`. Prefer the iterative version in production.

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public class BsgsFormB {
    static long modpow(long a, long e, long m) {
        a %= m; if (a < 0) a += m;
        long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % m;
            a = a * a % m;
            e >>= 1;
        }
        return r;
    }

    // iterative extended Euclid; returns modular inverse of a mod m or -1.
    static long modinv(long a, long m) {
        long oldR = ((a % m) + m) % m, r = m;
        long oldS = 1, s = 0;
        while (r != 0) {
            long q = oldR / r;
            long tr = oldR - q * r; oldR = r; r = tr;
            long ts = oldS - q * s; oldS = s; s = ts;
        }
        if (oldR != 1) return -1;
        return ((oldS % m) + m) % m;
    }

    static long bsgs(long a, long b, long m) {
        a %= m; b %= m;
        long n = (long) Math.ceil(Math.sqrt((double) m));

        Map<Long, Long> table = new HashMap<>();
        long cur = 1;
        for (long j = 0; j < n; j++) {
            table.putIfAbsent(cur, j);
            cur = cur * a % m;
        }

        long an = modpow(a, n, m);
        long factor = modinv(an, m);  // a^{-n}
        long gi = b % m;
        for (long i = 0; i < n; i++) {
            Long j = table.get(gi);
            if (j != null) return i * n + j;
            gi = gi * factor % m;
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(bsgs(2, 3, 13)); // 4
        System.out.println(bsgs(2, 5, 13)); // 9
    }
}
```

#### Python

```python
import math


def modinv(a, m):
    """Modular inverse via extended Euclid, or None if gcd != 1."""
    old_r, r = a % m, m
    old_s, s = 1, 0
    while r:
        q = old_r // r
        old_r, r = r, old_r - q * r
        old_s, s = s, old_s - q * s
    if old_r != 1:
        return None
    return old_s % m


def bsgs(a, b, m):
    """Form B: x = i*n + j, check a^j == b*(a^{-n})^i. Assumes gcd(a, m) == 1."""
    a %= m
    b %= m
    n = math.isqrt(m - 1) + 1

    table = {}
    cur = 1
    for j in range(n):
        table.setdefault(cur, j)
        cur = cur * a % m

    factor = modinv(pow(a, n, m), m)  # a^{-n}
    gi = b % m
    for i in range(n):
        if gi in table:
            return i * n + table[gi]
        gi = gi * factor % m
    return -1


if __name__ == "__main__":
    print(bsgs(2, 3, 13))  # 4
    print(bsgs(2, 5, 13))  # 9
```

### Pattern: keeping the smallest `j`

Use "insert if absent" (`setdefault` / `putIfAbsent` / the `if not ok` guard) so the map keeps the **smallest** `j` for each value. Combined with scanning `i` from small to large, the **first** collision found yields the smallest `x`. (More in [Smallest Solution](#smallest-solution-and-the-order).)

---

## General Modulus Reduction

Plain BSGS needs `gcd(a, m) = 1` so `a` is invertible. When `m` is composite and `g = gcd(a, m) > 1`, the giant step's inverse does not exist. The standard fix peels off common factors one at a time until the base is coprime to the (shrunken) modulus.

**The reduction.** To solve `a^x ≡ b (mod m)`:

1. Let `g = gcd(a, m)`.
2. If `g = 1`, run ordinary BSGS.
3. If `g ∤ b` (g does not divide `b`): check whether `b ≡ 1 (mod m)` already (then `x = 0`); otherwise **no solution** — stop.
4. Otherwise divide through: the equation `a · a^{x-1} ≡ b` becomes, after dividing `a`, `b`, `m` by `g`,
   ```
   (a/g) · a^{x-1} ≡ (b/g)   (mod m/g).
   ```
   Track how many factors you removed (a counter `add`), reduce, and recurse.
5. After peeling, solve the coprime sub-instance with BSGS, then add back the removed-factor count.

This loop removes at most `O(log m)` factors (each at least halves `m` if `g ≥ 2`), so the reduction is cheap; the dominant cost stays `O(√m)`.

#### Python (general modulus)

```python
import math


def bsgs_coprime(a, b, m):
    """Smallest x >= 0 with a^x ≡ b (mod m), gcd(a, m) == 1; -1 if none."""
    a %= m
    b %= m
    n = math.isqrt(m - 1) + 1
    table = {}
    cur = b % m
    for j in range(n):            # baby steps b*a^j (Form A)
        table.setdefault(cur, j)
        cur = cur * a % m
    G = pow(a, n, m)
    gi = 1
    for i in range(1, n + 1):     # giant steps (a^n)^i
        gi = gi * G % m
        if gi in table:
            x = i * n - table[gi]
            if x >= 0:
                return x
    return -1


def discrete_log(a, b, m):
    """General modulus: solve a^x ≡ b (mod m) for the smallest x >= 0, or -1."""
    a %= m
    b %= m
    # handle small x directly (covers b ≡ 1 -> x = 0 and the peeled prefix)
    k = 1
    add = 0
    for _ in range(64):           # check x = 0..63 directly
        if k == b % m:
            return add
        k = k * a % m
        add += 1
    # peel gcd factors
    g = math.gcd(a, m)
    if g == 1:
        ans = bsgs_coprime(a, b, m)
        return ans
    if b % g != 0:
        return -1                 # no solution
    # divide one factor of g out and recurse on the reduced modulus
    b //= g
    m //= g
    # multiply b by inverse of (a/g) mod m, accounting for one removed factor
    b = b * pow(a // g, -1, m) % m if math.gcd(a // g, m) == 1 else b
    sub = discrete_log(a, b, m)
    if sub == -1:
        return -1
    return sub + add


if __name__ == "__main__":
    print(discrete_log(2, 3, 13))   # 4 (coprime path)
    print(discrete_log(4, 8, 12))   # general modulus, gcd(4,12)=4
```

> The "check small `x` directly" prefix is important: it both catches `b ≡ 1 → x = 0` and absorbs the few exponents the peeling can shift. Production-grade versions (cp-algorithms) implement the peel-and-add loop iteratively; the recursive sketch above conveys the idea.

The crucial correctness point: every time you divide `a`, `b`, `m` by `g`, the smallest solution of the reduced equation is `1` less than the smallest solution of the original (you "used up" one factor of `a`), so you add `1` per peel. If at any peel `g ∤ b` and `b ≢ 1`, the original equation is unsolvable.

---

## Smallest Solution and the Order

Discrete logs are unique only modulo `d = ord_m(a)`, the **order** of `a` (smallest `d > 0` with `a^d ≡ 1`). If `x₀` is a solution, so is `x₀ + t·d` for every integer `t ≥ 0`. BSGS naturally finds *a* solution; to find the *smallest*:

1. **Keep the smallest `j`** in the baby map (insert-if-absent), so each map value records the earliest exponent that produces it.
2. **Scan `i` upward** (`i = 1, 2, …` in Form A; `i = 0, 1, …` in Form B). The first collision encountered corresponds to the smallest valid `x` because giant steps increase the coarse part monotonically.

For Form A specifically, `x = i·n − j`: as `i` increases by 1, `x` jumps by `n`; within a block, larger `j` *decreases* `x`. Storing the smallest `j` and taking the first matching `i` gives the minimal `x` in `[1, m]` (plus the explicit `x = 0` check for `b ≡ 1`).

If you need **all** solutions in a range, find the smallest `x₀` and the order `d`, then enumerate `x₀, x₀ + d, x₀ + 2d, …`. Computing `d` itself can be done by factoring the group order and testing divisors (related to sibling `12-primitive-roots`).

---

## Code Examples

### A reusable, well-factored Form-A BSGS (counting the smallest x)

#### Python

```python
import math


def bsgs(a, b, m):
    """
    Smallest x >= 0 with a^x ≡ b (mod m), or -1 if no solution.
    Assumes gcd(a, m) == 1. Form A: x = i*n - j.
    """
    a %= m
    b %= m
    if b == 1 % m:
        return 0                      # a^0 = 1
    n = math.isqrt(m - 1) + 1

    table = {}                        # baby steps: b * a^j
    cur = b
    for j in range(n):
        table.setdefault(cur, j)      # smallest j wins
        cur = cur * a % m

    G = pow(a, n, m)                  # giant factor a^n
    gi = 1
    best = -1
    for i in range(1, n + 1):
        gi = gi * G % m               # (a^n)^i
        if gi in table:
            x = i * n - table[gi]
            if x >= 0:
                best = x
                break                 # first hit (smallest i) -> smallest x
    return best


if __name__ == "__main__":
    assert bsgs(2, 3, 13) == 4
    assert bsgs(3, 1, 13) == 0
    assert bsgs(2, 1, 13) == 12       # order of 2 mod 13 is 12
    print("ok")
```

This is the same engine as `junior.md` but factored cleanly: explicit `b ≡ 1 → 0`, smallest-`j` baby steps, first-hit giant scan. Swap the baby/giant formulas to get Form B; parameterize the modular inverse to handle the general modulus.

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| `gcd(a, m) > 1` in Form B | `a^{-n}` does not exist; `modinv` returns `-1` and giant steps are garbage. | Use Form A (no inverse) or the general-modulus reduction. |
| Overflow on `cur * a` | Product exceeds 64-bit before `% m`. | Reduce every multiply; use 128-bit for `m` near `2^{63}`. |
| Non-smallest `x` returned | Stored largest `j`, or scanned `i` downward. | Insert-if-absent (smallest `j`); scan `i` upward; take first hit. |
| Misses `x = 0` | No explicit `b ≡ 1` check, and `j = 0` block missing. | Add `if b ≡ 1: return 0` up front. |
| Infinite recursion in reduction | `g` stuck at 1 but still no solution found. | Bound the small-`x` prefix and only recurse when `g > 1`. |
| Floating `sqrt` rounds down | `n = ⌊√m⌋` misses the last block. | Use integer `isqrt` and `n = ⌈√m⌉`. |

---

## Performance Analysis

| `m` | baby steps `√m` | giant steps `√m` | hash entries `√m` | feasible? |
|-----|-----------------|-------------------|--------------------|-----------|
| `10^6` | `10^3` | `10^3` | `10^3` | trivial |
| `10^{10}` | `10^5` | `10^5` | `10^5` | instant |
| `10^{12}` | `10^6` | `10^6` | `10^6` (~tens of MB) | fast |
| `10^{14}` | `10^7` | `10^7` | `10^7` (~hundreds of MB) | borderline memory |
| `10^{16}` | `10^8` | `10^8` | `10^8` (GBs) | memory-bound → use rho |

The dominant cost is the `√m` baby-step insertions and `√m` giant-step lookups; each modular multiply and each map operation is `O(1)` amortized. So total time is `O(√m)`. The decisive constraint at scale is **memory**: the hash map holds `√m` entries. Once `√m` exceeds available RAM (around `m ≈ 10^{14}`–`10^{16}` on a typical machine), switch to Pollard's rho, which is also `O(√m)` time but `O(1)` space.

```python
import time, math, random

def bench(m):
    a = random.randrange(2, m)
    while math.gcd(a, m) != 1:
        a = random.randrange(2, m)
    x = random.randrange(0, m)
    b = pow(a, x, m)
    t = time.perf_counter()
    _ = bsgs(a, b, m)
    return time.perf_counter() - t
# Typical: m = 10**12 solves in well under a second; m = 10**16 is memory-bound.
```

The single biggest constant-factor win is reserving the hash map to size `√m` up front and computing giant steps incrementally (`gi = gi * G`) rather than re-exponentiating.

---

## Best Practices

- **Pick one decomposition** (Form A `i·n − j` *or* Form B `i·n + j`) and keep the baby/giant formulas consistent with it.
- **Use Form A when you want to avoid the inverse**; use Form B (the textbook form) when `gcd(a, m) = 1` is guaranteed.
- **Always check `gcd(a, m)`** if the modulus may be composite; fall back to the general-modulus reduction.
- **Return the smallest `x`** by storing the smallest `j` and taking the first giant-step hit; document if "any `x`" is acceptable instead.
- **Reserve the map** to `√m` and reduce mod `m` after every multiply.
- **Test against the brute-force oracle** on random small `(a, b, m)` — including unsolvable cases that must return `-1`.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level relevant highlights:
> - The baby-step table filling with `j → a^{j}` (Form B) or `b·a^{j}` (Form A).
> - Giant steps `b·(a^{-n})^{i}` (Form B) probing the table for a collision.
> - The collision cell lighting up and the reconstruction `x = i·n + j`.
> - Editable `a`, `b`, `m` so you can watch the two `√m` phases on different inputs.

---

## Summary

BSGS solves `a^x ≡ b (mod m)` in `O(√m)` time and space by splitting `x` into a coarse and a fine part — either `x = i·n − j` (Form A, giant step `(a^n)^i`, no inverse) or `x = i·n + j` (Form B, giant step `b·(a^{-n})^i`, needs `a^{-n}`). The **hash map of baby steps** is what collapses the `√m × √m` cross-check into `O(√m)`: store one half, stream the other. A **general modulus** with `gcd(a, m) > 1` is handled by peeling common factors (dividing `a`, `b`, `m` by `g` and adding 1 to the answer per peel) until the base is coprime, then running ordinary BSGS. The **smallest** solution comes from keeping the smallest `j` and taking the first giant-step collision, remembering that solutions repeat with the order of `a`. Among alternatives, BSGS is the deterministic `O(√m)`-memory choice; Pollard's rho matches its time with `O(1)` memory (randomized), and Pohlig-Hellman wins when the order of `a` is smooth. Master the decomposition, the map, and the coprime reduction, and you can apply discrete log to any modulus within memory reach.
