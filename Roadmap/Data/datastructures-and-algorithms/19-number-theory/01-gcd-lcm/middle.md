# GCD and LCM (The Euclidean Algorithm) — Middle Level

> **Focus:** the division-free **binary GCD (Stein's algorithm)**, computing GCD/LCM of whole arrays without overflow, the overflow-safe LCM ordering, a working preview of the **extended Euclidean algorithm** and **Bezout's identity** (full treatment in sibling `06`), fraction reduction, and how the variants compare.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Array GCD/LCM and Overflow](#array-gcdlcm-and-overflow)
6. [The Extended Euclidean Preview](#the-extended-euclidean-preview)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was one recurrence: `gcd(a, b) = gcd(b, a mod b)`, looped until `b = 0`. At middle level you start asking the questions that decide whether your GCD/LCM code is correct *and* fast in a real program:

- The Euclidean algorithm uses division. Hardware division is comparatively slow — is there a GCD that avoids it? (Yes: **binary GCD**, using only shifts, subtraction, and comparisons.)
- How do you compute the GCD or LCM of an *array* of numbers, and why does the array LCM overflow almost immediately?
- What is the *overflow-safe* way to write LCM, and when does even that fail?
- The extended Euclidean algorithm gives `x, y` with `a·x + b·y = gcd(a, b)`. What is that for, and why does it prove a modular inverse exists exactly when `gcd(a, m) = 1`?
- How do you reduce a fraction to lowest terms, and how do you keep it correct for negative numerators/denominators?

These are the questions that separate "I memorized the loop" from "I can pick the right GCD variant and keep the arithmetic from overflowing in production."

---

## Deeper Concepts

### The recurrence, restated with the quotient

Write `a = q·b + r` with `q = ⌊a / b⌋` and `r = a mod b`, so `0 ≤ r < b`. The Euclidean step replaces `(a, b)` by `(b, r)`. Because any common divisor of `a` and `b` divides `r = a − q·b`, and any common divisor of `b` and `r` divides `a = q·b + r`, the set of common divisors is invariant — so the *greatest* is invariant. This is the entire correctness argument, and it is worth being able to recite.

### Binary GCD (Stein's algorithm)

Stein's algorithm computes the same GCD using only **subtraction, comparison, and bit shifts** — no division or modulo. It rests on three identities:

```
1. gcd(a, a) = a, and gcd(a, 0) = a
2. if a and b are both even:   gcd(a, b) = 2 · gcd(a/2, b/2)
3. if a is even, b is odd:      gcd(a, b) = gcd(a/2, b)        (2 is not a common factor)
4. if both odd, a >= b:         gcd(a, b) = gcd((a-b)/2, b)    (a-b is even)
```

The algorithm pulls out all common factors of `2` up front (counting them as a shift amount `k`), then repeatedly strips lone factors of `2` and subtracts the smaller odd number from the larger. Each step reduces the total bit-length, so it terminates in `O(log² max(a,b))` bit operations (or `O(log)` machine-word operations). The payoff: on CPUs where division is much slower than a shift, binary GCD can beat the Euclidean algorithm by a meaningful constant factor.

### Why "divide before multiply" really matters

The identity `gcd(a,b)·lcm(a,b) = |a·b|` tempts you to write `lcm = a * b / gcd`. But `a * b` is the product of the *full* inputs and overflows long before the LCM does. Since `gcd(a, b)` divides `a` exactly, `a / gcd(a, b)` is an exact integer, and

```
lcm(a, b) = (a / gcd(a, b)) * b
```

multiplies a *smaller* number by `b`. The largest intermediate is the LCM itself, so this overflows only if the true answer does. This single reordering is the most common "why is my LCM negative/wrong?" fix.

### Coprimality, fractions, and the modular-inverse preview

Two numbers are **coprime** when `gcd(a, b) = 1`. Dividing both numerator and denominator of a fraction by their GCD yields lowest terms:

```
reduce(a, b) = (a / g, b / g)   where g = gcd(a, b)
```

The resulting numerator and denominator are coprime by construction. Coprimality is also the existence condition for a **modular inverse**: `a` has an inverse modulo `m` (a number `a⁻¹` with `a·a⁻¹ ≡ 1 mod m`) **iff** `gcd(a, m) = 1`. The *why* is Bezout's identity, previewed below and proved in sibling `06`.

### The distributive property in practice

`gcd(c·a, c·b) = c · gcd(a, b)` is more than a curiosity — it lets you *factor out* a common scale before computing. If you know all your inputs are multiples of `1000` (say, prices in thousandths of a unit), you can divide by `1000`, compute the GCD on the smaller numbers, and multiply back — sometimes avoiding overflow and always working with smaller operands. It is also the reason "simplify a ratio `a : b : c`" works by dividing every part by the *single* array GCD: the common factor pulls out cleanly. Internally, the binary GCD's "factor out the shared power of two" step (`gcd(2a, 2b) = 2·gcd(a, b)`) is exactly this property applied to `c = 2^k`.

---

## Comparison with Alternatives

### Euclidean vs binary GCD vs factorization

| Method | Operations used | Time | Good when |
|--------|----------------|------|-----------|
| Euclidean (mod) | integer division | `O(log min(a,b))` | default; clearest, fewest iterations |
| Binary / Stein | shifts, subtraction, compare | `O(log² max)` bit-ops | division is expensive (some hardware / big integers) |
| Subtractive Euclid | subtraction only | `O(max(a,b))` worst case | almost never — degrades to linear for skewed inputs |
| Factorization (min exponents) | trial division / sieve | `O(√max)` per number | only if you *also* need the factorization |

The plain mod-based Euclidean algorithm is the right default. Binary GCD trades division for more iterations of cheap ops — a constant-factor question. The naive *subtractive* version (`gcd(a, b) = gcd(a - b, b)`) is a trap: for `gcd(10^9, 1)` it subtracts one billion times. Always use mod (or binary), never plain subtraction.

### Concrete iteration counts

| Pair `(a, b)` | Euclidean steps | Note |
|---------------|-----------------|------|
| `(48, 18)` | 3 | typical small case |
| `(1071, 462)` | 4 | classic textbook pair |
| `(F(20), F(19)) = (6765, 4181)` | 18 | Fibonacci worst case for its size |
| `(10^18, 1)` | 1 | trivial; one mod |
| `(10^18, 10^18 - 1)` | 2 | coprime neighbours |

The Fibonacci row is the worst case (Lamé's theorem): consecutive Fibonacci numbers force the maximum number of steps relative to their magnitude — yet still only ~`18` steps for five-digit inputs. The growth is logarithmic.

### When to prefer LCM-via-GCD vs prime-factor LCM

| Need | Tool | Why |
|------|------|-----|
| LCM of two machine-int numbers | `a / gcd * b` | one GCD, overflow-safe ordering |
| LCM of an array, exact, possibly huge | big integers, fold pairwise | machine ints overflow fast |
| LCM of an array **mod p** | combine **prime-factor exponents** (max per prime), then power mod `p` | you cannot divide by a GCD under a modulus directly |

---

## Advanced Patterns

### Pattern: Binary GCD (Stein's algorithm)

Pull out shared powers of two, then loop on odd values with subtraction and a single shift.

#### Go

```go
package main

import "fmt"

func binaryGCD(a, b uint64) uint64 {
	if a == 0 {
		return b
	}
	if b == 0 {
		return a
	}
	// shift = number of common factors of 2
	shift := 0
	for (a|b)&1 == 0 {
		a >>= 1
		b >>= 1
		shift++
	}
	for a&1 == 0 { // remove factors of 2 from a
		a >>= 1
	}
	for b != 0 {
		for b&1 == 0 { // b is even -> 2 is not common, strip it
			b >>= 1
		}
		if a > b { // ensure a <= b
			a, b = b, a
		}
		b -= a // both odd now, difference is even
	}
	return a << uint(shift) // restore the common 2^shift
}

func main() {
	fmt.Println(binaryGCD(48, 18)) // 6
	fmt.Println(binaryGCD(1071, 462)) // 21
	fmt.Println(binaryGCD(17, 5))  // 1
}
```

#### Java

```java
public class BinaryGCD {
    static long binaryGCD(long a, long b) {
        if (a == 0) return b;
        if (b == 0) return a;
        int shift = 0;
        while (((a | b) & 1) == 0) { // both even
            a >>= 1;
            b >>= 1;
            shift++;
        }
        while ((a & 1) == 0) a >>= 1; // strip 2s from a
        while (b != 0) {
            while ((b & 1) == 0) b >>= 1; // strip 2s from b
            if (a > b) { long t = a; a = b; b = t; } // a <= b
            b -= a; // both odd -> difference even
        }
        return a << shift; // restore common factor 2^shift
    }

    public static void main(String[] args) {
        System.out.println(binaryGCD(48, 18));   // 6
        System.out.println(binaryGCD(1071, 462)); // 21
        System.out.println(binaryGCD(17, 5));    // 1
    }
}
```

#### Python

```python
def binary_gcd(a, b):
    if a == 0:
        return b
    if b == 0:
        return a
    shift = 0
    while ((a | b) & 1) == 0:   # both even
        a >>= 1
        b >>= 1
        shift += 1
    while (a & 1) == 0:         # strip 2s from a
        a >>= 1
    while b:
        while (b & 1) == 0:     # strip 2s from b
            b >>= 1
        if a > b:
            a, b = b, a         # keep a <= b
        b -= a                  # both odd -> difference even
    return a << shift           # restore common 2^shift


if __name__ == "__main__":
    print(binary_gcd(48, 18))    # 6
    print(binary_gcd(1071, 462)) # 21
    print(binary_gcd(17, 5))     # 1
```

### Pattern: Fraction reduction (sign-correct)

Reduce `a/b` to lowest terms, keeping the sign on the numerator and the denominator positive.

```python
def reduce_fraction(a, b):
    if b == 0:
        raise ValueError("zero denominator")
    g = gcd(abs(a), abs(b))
    a, b = a // g, b // g
    if b < 0:          # push sign onto the numerator
        a, b = -a, -b
    return a, b
# reduce_fraction(48, -18) -> (-8, 3)
```

### Pattern: GCD of an array with early exit

```python
def gcd_array(nums):
    g = 0                 # identity for gcd
    for x in nums:
        g = gcd(g, x)
        if g == 1:        # cannot get smaller; stop early
            return 1
    return g
```

### Pattern: Compare two fractions without floating point

**Intent:** Decide whether `a/b < c/d` exactly, using cross-multiplication (which the GCD-reduced forms keep small enough to avoid overflow). No `double`, no rounding error.

```python
def fraction_less(a, b, c, d):
    """True if a/b < c/d, assuming b, d > 0. Reduce first to limit overflow."""
    g1 = gcd(abs(a), b); a, b = a // g1, b // g1
    g2 = gcd(abs(c), d); c, d = c // g2, d // g2
    return a * d < c * b     # cross-multiply; both sides bounded after reduction
# fraction_less(1, 3, 2, 5) -> True  (0.333 < 0.4)
```

Reducing each fraction by its GCD first keeps the cross-products `a*d` and `c*b` as small as possible, which is the overflow-aware way to compare rationals exactly. This is the comparison primitive behind exact rational sorting and the Stern-Brocot tree.

### Pattern: Simplify a ratio chain

**Intent:** Reduce a ratio `a : b : c` to lowest terms by dividing all parts by their common GCD.

```python
def simplify_ratio(parts):
    g = gcd_array(parts)
    if g == 0:
        return parts            # all zeros
    return [p // g for p in parts]
# simplify_ratio([12, 18, 24]) -> [2, 3, 4]
```

The whole chain divides by the *single* array GCD, not pairwise — a direct use of the distributive property `gcd(c·a, c·b) = c·gcd(a, b)`.

---

## Array GCD/LCM and Overflow

The GCD of an array is well-behaved: it only *shrinks*, bottoms out at `1`, and never overflows. The LCM is the opposite — it *grows*, and for an array it grows explosively.

```python
def lcm_array_exact(nums):
    """Exact array LCM using big integers (Python ints are unbounded)."""
    result = 1
    for x in nums:
        if x == 0:
            return 0
        result = result // gcd(result, x) * x
    return result
# lcm of [1..10] = 2520; lcm of [1..30] already exceeds 2^32
```

In Go/Java this overflows fixed-width integers quickly, so for exact array LCM you need `big.Int` / `BigInteger`. When the problem wants the LCM **modulo a prime `p`**, you *cannot* do `result = result / gcd * x % p` — division under a modulus needs a modular inverse, and worse, the running LCM mod `p` loses the information needed to compute the next GCD. The correct approach is **prime-factor exponent merging**:

```python
def lcm_array_mod(nums, p):
    """LCM of nums modulo p via max exponent per prime."""
    from collections import defaultdict
    max_exp = defaultdict(int)
    for x in nums:
        f = factorize(x)              # {prime: exponent}
        for prime, e in f.items():
            max_exp[prime] = max(max_exp[prime], e)
    result = 1
    for prime, e in max_exp.items():
        result = result * pow(prime, e, p) % p
    return result
```

The LCM takes the **maximum** exponent of each prime across all numbers (mirroring `max` in the prime-factor view), then raises and multiplies modulo `p`. This is the only correct way to take an array LCM under a modulus.

---

## The Extended Euclidean Preview

The plain algorithm returns `g = gcd(a, b)`. The **extended** version additionally returns integers `x, y` satisfying

```
a·x + b·y = gcd(a, b)          (Bezout's identity)
```

These `x, y` are the **Bezout coefficients**. The full algorithm, proof, and applications live in sibling `06-extended-euclidean`; here is the working preview and *why it matters at middle level*.

#### Python (preview)

```python
def ext_gcd(a, b):
    """Return (g, x, y) with a*x + b*y = g = gcd(a, b)."""
    if b == 0:
        return a, 1, 0
    g, x1, y1 = ext_gcd(b, a % b)
    # back-substitute: a*x + b*y = g
    return g, y1, x1 - (a // b) * y1


if __name__ == "__main__":
    g, x, y = ext_gcd(48, 18)
    print(g, x, y)              # 6 ... and 48*x + 18*y == 6
    assert 48 * x + 18 * y == g
```

**Why this matters:**

- **Modular inverse.** If `gcd(a, m) = 1`, then `a·x + m·y = 1`, so `a·x ≡ 1 (mod m)` — meaning `x mod m` is the inverse of `a` modulo `m`. This is *the* fast way to compute inverses when `m` is not prime (when `m` is prime, Fermat's little theorem also works).
- **Existence condition.** An inverse exists **iff** `gcd(a, m) = 1`. If the GCD is `g > 1`, no `x` can make `a·x ≡ 1 (mod m)`, because `a·x` is always a multiple of `g`.
- **Linear Diophantine equations.** `a·x + b·y = c` has integer solutions **iff** `gcd(a, b)` divides `c`. The extended algorithm builds one solution; the rest follow by adding multiples of `b/g` and `a/g`.

So the plain GCD answers "*does* a solution / inverse exist?" (is the GCD `1`, or does it divide `c`?), and the extended GCD *constructs* it. That is the bridge from this topic to `02-modular-arithmetic`, `06-extended-euclidean`, and the Chinese Remainder Theorem.

---

## Code Examples

### GCD, LCM, and array versions in one place

#### Go

```go
package main

import "fmt"

func gcd(a, b int64) int64 {
	for b != 0 {
		a, b = b, a%b
	}
	if a < 0 {
		return -a // normalize sign
	}
	return a
}

func lcm(a, b int64) int64 {
	if a == 0 || b == 0 {
		return 0
	}
	return a / gcd(a, b) * b
}

func gcdArray(xs []int64) int64 {
	g := int64(0)
	for _, x := range xs {
		g = gcd(g, x)
		if g == 1 {
			return 1
		}
	}
	return g
}

func main() {
	fmt.Println(gcd(48, 18))                 // 6
	fmt.Println(lcm(4, 6))                    // 12
	fmt.Println(gcdArray([]int64{12, 18, 24})) // 6
}
```

#### Python

```python
from functools import reduce
import math


def gcd(a, b):
    while b:
        a, b = b, a % b
    return abs(a)


def lcm(a, b):
    if a == 0 or b == 0:
        return 0
    return a // gcd(a, b) * b


def gcd_array(xs):
    return reduce(gcd, xs, 0)


def lcm_array(xs):
    return reduce(lcm, xs, 1)


if __name__ == "__main__":
    print(gcd(48, 18))            # 6
    print(lcm(4, 6))              # 12
    print(gcd_array([12, 18, 24])) # 6
    print(lcm_array([1, 2, 3, 4, 5])) # 60
    print(math.gcd(48, 18), math.lcm(4, 6)) # 6 12 (stdlib)
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| `a * b / gcd` for LCM | product overflows before division | use `a / gcd * b` (divide first) |
| Negative remainder (Go/Java) | returned GCD is negative | `abs` the final result or the inputs |
| Array LCM overflows | running product exceeds 64-bit | use big integers, or prime-exponent merge mod `p` |
| LCM mod `p` via division | division under a modulus is wrong | take **max prime exponents**, then power mod `p` |
| `gcd(0, 0)` | ambiguous expectation | document convention: returns `0` |
| `lcm(_, 0)` then divide | division by zero GCD | guard: `lcm` with a `0` operand is `0` |
| Subtractive GCD on skewed pair | `O(max)` blowup, looks like a hang | always use mod-based or binary GCD |
| Fraction compared via `double` | rounding makes `1/3 < 0.333...` flip | reduce, then cross-multiply with integers |
| Cross-multiplying without reducing | `a*d` overflows on large operands | divide each fraction by its GCD first |
| Ratio simplified pairwise | inconsistent or partial reduction | divide all parts by the single array GCD |

---

## Performance Analysis

| Pair magnitude | Euclidean steps (approx) | Binary GCD machine-ops | Notes |
|----------------|--------------------------|------------------------|-------|
| up to `10^3` | ≤ 15 | similar | both instant |
| up to `10^9` | ≤ 45 | similar | both well under a microsecond |
| up to `10^18` | ≤ 90 | similar | still trivial |
| Fibonacci `F(90)` pair | ~88 | ~88 | the worst case for the size |

The dominant cost of the Euclidean algorithm is the per-step **division**. Binary GCD replaces each division with several shifts and a subtraction; whether it wins depends entirely on the relative cost of division vs shift on the target hardware (and on big-integer libraries, where division is genuinely expensive and binary GCD shines).

```python
import time, random

def benchmark(method, trials=200000):
    pairs = [(random.randint(1, 10**18), random.randint(1, 10**18)) for _ in range(trials)]
    start = time.perf_counter()
    for a, b in pairs:
        method(a, b)
    return time.perf_counter() - start

# Typical: math.gcd (C-level) is fastest; pure-Python binary_gcd is slower than
# pure-Python Euclidean because Python's % is already a fast C operation.
```

The lesson: on modern hardware with cheap division, the plain Euclidean algorithm is usually as fast as or faster than binary GCD; binary GCD's advantage appears mainly for big integers and division-poor architectures.

---

## Best Practices

- **Default to the mod-based Euclidean algorithm**; reach for binary GCD only when profiling shows division is the bottleneck (typically big integers).
- **Always `a / gcd * b`** for LCM; never `a * b / gcd`.
- **Fold arrays with the correct identity:** `0` for GCD, `1` for LCM; add the `gcd == 1` early exit.
- **Use big integers for exact array LCM**, or prime-exponent merging for array LCM modulo `p`.
- **Normalize signs** explicitly: `gcd = abs(...)`, and for fractions push the sign onto the numerator with a positive denominator.
- **Prefer the standard library** (`math.gcd`/`math.lcm`, `std::gcd`, `BigInteger.gcd`) — they are tested and tuned.
- **Never use plain subtractive GCD** in production; it is `O(max)` in the worst case.
- **Compare fractions by cross-multiplication after reducing** — never convert to floating point, which loses exactness.
- **Reduce before cross-multiplying or chaining ratios** to keep operands small and dodge overflow.
- **Remember the existence conditions**: a modular inverse exists iff `gcd(a, m) = 1`; a Diophantine `a·x + b·y = c` is solvable iff `gcd(a, b) | c`. State these before reaching for the extended algorithm to *construct* the answer.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The Euclidean recurrence `a, b = b, a mod b` with quotient and remainder shown per step.
> - The geometric tiling — peeling off `b × b` squares from an `a × b` rectangle until a perfect square (the GCD) remains.
> - The strictly decreasing remainder sequence that proves termination, and how few steps it takes even for large inputs.

---

## Summary

The Euclidean algorithm is the right default, but a middle-level engineer also knows the **binary GCD** (division-free, shifts and subtraction — useful when division is costly), the **overflow-safe LCM** ordering `a / gcd(a,b) * b`, and how to take GCD/LCM of whole arrays (GCD folds from `0` and never overflows; LCM folds from `1` and overflows almost immediately, requiring big integers or prime-exponent merging modulo `p`). The **extended Euclidean algorithm** turns the plain GCD into the Bezout coefficients `x, y` with `a·x + b·y = gcd(a,b)`, which is exactly what proves a modular inverse exists when `gcd(a, m) = 1` and what solves linear Diophantine equations `a·x + b·y = c` (solvable iff `gcd(a,b) | c`). Those connections — full proofs in sibling `06-extended-euclidean` — are why GCD is the foundation under modular arithmetic, CRT, and fraction reduction.

Beyond the algorithm itself, the **distributive property** `gcd(c·a, c·b) = c·gcd(a, b)` lets you factor out common scales (and is what powers the binary GCD's shift step and ratio simplification), and exact **fraction comparison** via reduce-then-cross-multiply keeps rational arithmetic correct without ever touching floating point. The recurring discipline across all of it: pick the right *identity* for your fold (`0` for GCD, `1` for LCM), order operations to dodge overflow (divide before multiply), and reduce before combining — small habits that turn the textbook recurrence into production-safe code.

### Quick Decision Guide

- **Need a GCD on machine integers?** Mod-based Euclidean loop. Done.
- **Division is the measured bottleneck (big integers)?** Binary GCD (Stein's).
- **Need an LCM that fits?** `a / gcd * b`. **Might not fit?** Big integers or overflow check.
- **Array LCM modulo `p`?** Max prime exponents, then power mod `p` — never division under a modulus.
- **Need to know if an inverse / Diophantine solution exists?** Check the GCD (`= 1` or `| c`). **Need to construct it?** Extended Euclidean (sibling `06`).
- **Comparing fractions?** Reduce, then cross-multiply with integers.

This guide collapses the whole file into the question you are actually trying to answer; when in doubt, start here and follow the branch.