# Extended Euclidean Algorithm & Modular Inverse — Middle Level

> **Focus:** the iterative extended Euclidean algorithm, inverse via extended Euclid vs Fermat (and when each applies), the `O(n)` inverse table for `1..n`, solving the general linear congruence `a·x ≡ b (mod m)` (when it is solvable, and *all* its solutions), and the comparisons that let you pick the right tool.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [The O(n) Inverse Table](#the-on-inverse-table)
6. [Solving Linear Congruences](#solving-linear-congruences)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was a chain of three facts: extended Euclid returns `(g, x, y)` with `a·x + b·y = g`; reducing mod `m` turns `x` into the inverse `a⁻¹` when `g = 1`; and the inverse exists exactly when `a` and `m` are coprime. At middle level you start asking the engineering and mathematical questions that decide whether your solution is correct, fast, and general:

- How do you write extended Euclid **iteratively** so there is no recursion stack and the coefficient updates are explicit?
- Inverse via **extended Euclid** vs inverse via **Fermat** (`a^(p-2)`): which is faster, which is more general, and when must you use one over the other?
- How do you compute the inverses of **all** of `1..n` mod a prime in `O(n)` total — not `O(n log m)` — using a single recurrence?
- The general linear congruence `a·x ≡ b (mod m)`: when does it have a solution, **how many**, and what is the complete solution set?
- How do these tools combine in CRT and linear Diophantine equations?

These are the questions that separate "I can invert one number" from "I can solve a family of congruences and pick the optimal method for the constraints in front of me."

---

## Deeper Concepts

### Extended Euclid, restated as a matrix recurrence

Each Euclidean step `(r_{k-1}, r_k) → (r_k, r_{k-1} - q_k r_k)` is a linear map. Track, alongside each remainder `r`, a pair `(s, t)` of coefficients such that the invariant

```
r = s·a + t·b
```

holds at every step. Initialize the first two rows as `r₀ = a` with `(s₀, t₀) = (1, 0)` and `r₁ = b` with `(s₁, t₁) = (0, 1)`. Then the update `r_{k+1} = r_{k-1} - q_k r_k` (with `q_k = r_{k-1} / r_k`) is applied identically to `r`, `s`, and `t`. When `r` reaches `0`, the **previous** row holds `(g, x, y)`. This invariant is the entire correctness argument and the reason the iterative form works.

### Why `x` is the inverse, precisely

From `a·x + m·y = 1`, reduce mod `m`: the `m·y` term is `≡ 0`, so `a·x ≡ 1 (mod m)`. The Bezout `x` is therefore a multiplicative inverse. It is **unique mod `m`**: if both `x` and `x'` satisfy `a·x ≡ a·x' ≡ 1`, then `a(x - x') ≡ 0`, and since `a` is invertible we get `x ≡ x' (mod m)`. So there is one canonical inverse in `[0, m)`.

### The matrix view of the iteration

Each Euclidean step is a left-multiplication by an elementary matrix. If you stack `[a, b]` as a column and apply `[[0, 1], [1, -q_k]]` repeatedly, the product of these matrices is a `2×2` integer matrix `T` with `det(T) = ±1` (unimodular) such that `T·[a, b]ᵀ = [g, 0]ᵀ`. The first row of `T` is exactly `(x, y)`. This is why tracking two coefficient columns through the iteration recovers Bezout: you are accumulating the unimodular transform that diagonalizes the input. It also explains the bound `|x| ≤ m/2` — a unimodular transform cannot blow up the coefficients arbitrarily.

### Inverse existence is *iff* coprimality

This is worth restating as the governing law: `a` has an inverse mod `m` **if and only if** `gcd(a, m) = 1`. The forward direction is Bezout (coprime → inverse exists). The reverse: if `gcd(a, m) = d > 1`, then every multiple `a·x` is divisible by `d`, so `a·x mod m` always lands in the sublattice of multiples of `d`, which excludes `1`. No inverse can exist. Every algorithm in this file checks `g == 1` (or `g | b` for the general congruence) as its first correctness gate.

### The family of Bezout coefficients

Extended Euclid returns *one* pair `(x, y)`, but there are infinitely many. If `a·x + m·y = g`, then for any integer `k`:

```
a·(x + k·(m/g)) + m·(y - k·(a/g)) = g
```

is also valid (the added terms cancel). So the coefficient `x` is determined only **modulo `m/g`**. For the inverse case (`g = 1`), this means `x` is determined mod `m` — which is exactly why the *inverse* (a residue mod `m`) is unique even though the integer `x` is not. The algorithm returns the "small" representative; you normalize it into `[0, m)`. Understanding this family explains why two correct implementations can return different raw `x` values that nonetheless give the same inverse after reduction.

---

## Comparison with Alternatives

### Extended Euclid inverse vs Fermat inverse

| Aspect | Extended Euclid | Fermat (`a^(m-2)`) |
|--------|-----------------|--------------------|
| Modulus requirement | any `m` with `gcd(a, m) = 1` | `m` must be **prime** |
| Formula | solve `a·x + m·y = 1`, take `x mod m` | `a⁻¹ ≡ a^(m-2) mod m` |
| Complexity | `O(log m)` | `O(log m)` (fast power) |
| Detects "no inverse" | yes — returns `g ≠ 1` | no — silently wrong if `gcd ≠ 1` |
| Constant factor | a few divisions per step | `~log m` modular multiplications |
| Best when | composite modulus, need Bezout coeffs, CRT, Diophantine | known prime modulus, only need the inverse |

Both are logarithmic. Extended Euclid is strictly more general (works for any coprime `m`) and *tells you* when no inverse exists. Fermat is a clean one-liner when `m` is a known prime, and it composes nicely with an existing fast-power routine. **Rule of thumb:** prime modulus and just an inverse → Fermat; anything else → extended Euclid. For *many* inverses, neither — use the table below.

**Worked side-by-side.** Compute `7⁻¹ mod 13` both ways:

```
Extended Euclid: 13 = 1·7 + 6; 7 = 1·6 + 1; back: 1 = 7 - 6 = 7 - (13 - 7) = 2·7 - 13.
  so 7·2 ≡ 1 (mod 13)  →  7⁻¹ = 2.
Fermat: 7^(13-2) = 7^11 mod 13. Since 7^2 = 49 ≡ 10, 7^4 ≡ 100 ≡ 9, 7^8 ≡ 81 ≡ 3,
  7^11 = 7^8·7^2·7^1 ≡ 3·10·7 = 210 ≡ 2 (mod 13).  →  7⁻¹ = 2. ✓
```

Both give `2`. Extended Euclid took 2 divisions; Fermat took ~4 multiplications (the squarings for `7^11`). On a *composite* modulus (say `12`), the Fermat line would compute `7^10 mod 12 = 1` — wrong, because `12` is not prime. That single failure mode is why you must know which method the modulus permits.

### Euler's theorem generalization

Fermat is the prime case of **Euler's theorem**: if `gcd(a, m) = 1`, then `a^φ(m) ≡ 1 (mod m)`, so `a⁻¹ ≡ a^(φ(m)-1) (mod m)`. This works for composite `m` *if you know `φ(m)`* (Euler's totient). But computing `φ(m)` requires factoring `m`, which is often harder than just running extended Euclid. So Euler-based inversion is mostly of theoretical interest; extended Euclid remains the practical general tool.

### Comparison table: choosing an inverse method

| Situation | Method | Why |
|-----------|--------|-----|
| One inverse, prime modulus | Fermat `a^(p-2)` | simplest, reuses fast power |
| One inverse, composite modulus | extended Euclid | Fermat does not apply |
| One inverse, modulus may not be coprime | extended Euclid | only it detects `g ≠ 1` |
| All of `1..n` mod prime `p > n` | O(n) table trick | linear, beats `n` separate calls |
| Need Bezout coefficients too | extended Euclid | Fermat gives only the inverse |
| Inside CRT / Diophantine | extended Euclid | those *are* Bezout applications |

---

## Advanced Patterns

### Pattern: Iterative extended Euclid (production form)

This is the recommended default — no recursion, explicit invariant, easy to read.

```python
def extgcd(a, b):
    old_r, r = a, b
    old_s, s = 1, 0
    old_t, t = 0, 1
    while r != 0:
        q = old_r // r
        old_r, r = r, old_r - q * r
        old_s, s = s, old_s - q * s
        old_t, t = t, old_t - q * t
    return old_r, old_s, old_t      # (g, x, y) with a*x + b*y = g
```

### Pattern: Safe modular inverse with existence check

```python
def mod_inverse(a, m):
    g, x, _ = extgcd(a % m, m)
    if g != 1:
        return None                 # no inverse: gcd(a, m) != 1
    return x % m
```

### Pattern: Inverse as modular division helper

```python
def mod_div(a, b, m):
    """Compute a / b mod m = a * b^{-1} mod m, or None if b not invertible."""
    inv = mod_inverse(b, m)
    if inv is None:
        return None                 # b has no inverse mod m
    return a * inv % m
```

This is the everyday "division mod a prime": you never literally divide, you multiply by the inverse. It is correct only when `gcd(b, m) = 1`; for the more general `b·x ≡ a (mod m)` (which can have solutions even when `b⁻¹` does not exist), use the full congruence solver instead.

### Pattern: Fermat inverse for a prime modulus

```python
def inv_fermat(a, p):               # p prime, a % p != 0
    return pow(a, p - 2, p)
```

### Worked iterative trace

Run the iterative form on `(a, m) = (3, 11)` to find `3⁻¹ mod 11`. Each row is `(r, s, t)` with `r = 3s + 11t`:

```
row  r    s    t      q = floor(prev_r / r)
 0   3    1    0      (init: 3 = 1·3 + 0·11)
 1   11   0    1      q = 3 / 11 = 0
 2   3    1    0      ... after first step (swap)  -- 3 = 1·3
 3   ...  (continues) eventually r = 1 with s = 4
```

More cleanly, since `3 < 11` the algorithm effectively runs on `(11, 3)`: `11 = 3·3 + 2`, `3 = 1·2 + 1`, `2 = 2·1 + 0`. Back-tracking the coefficients gives `3·4 + 11·(-1) = 1`, so the row with `r = 1` has `s = 4`. Thus `3⁻¹ ≡ 4 (mod 11)`. The invariant `r = 3s + 11t` holds on every row — the single fact that makes the iterative form correct and easy to debug: print the rows and check the invariant.

---

## The O(n) Inverse Table

A frequent need (e.g., precomputing factorials and their inverses for binomial coefficients) is **the inverse of every integer `1..n` modulo a prime `p`** (with `p > n`, so every `i` is coprime to `p`). Doing `n` separate `O(log p)` inversions costs `O(n log p)`. There is a beautiful `O(n)` recurrence.

### Derivation

Fix `i` with `1 < i < p`. Write `p = q·i + r` where `q = p / i` (floor) and `r = p mod i`, so `0 < r < i`. Reduce mod `p`:

```
q·i + r ≡ 0 (mod p)
```

Multiply both sides by `i⁻¹ · r⁻¹` (both exist since `i, r < p` are coprime to the prime `p`):

```
q·r⁻¹ + i⁻¹ ≡ 0 (mod p)
i⁻¹ ≡ -q·r⁻¹ (mod p)
i⁻¹ ≡ -(p/i) · (p mod i)⁻¹ (mod p)
```

Because `r = p mod i < i`, the value `(p mod i)⁻¹` was **already computed** earlier in the pass. So each `inv[i]` is one multiply and one negate, given the base case `inv[1] = 1`. Total: `O(n)`.

```
inv[1] = 1
for i in 2..n:
    inv[i] = -(p / i) * inv[p % i] % p     # normalize into [0, p)
```

### Why the modulus must be prime (and `> n`)

The recurrence multiplies by `(p mod i)⁻¹`, which must exist for every `i ≤ n`. That holds when `p` is prime and `p > n`, guaranteeing `gcd(i, p) = 1` for all `1 ≤ i ≤ n`. For a composite modulus, some `i` may share a factor with `m` and have no inverse, breaking the table. Use a prime modulus larger than `n`.

### Worked check

For `p = 11`, the recurrence yields `inv[1..10] = [1, 6, 4, 3, 9, 2, 8, 7, 5, 10]`. Verify a couple: `2·6 = 12 ≡ 1`, `3·4 = 12 ≡ 1`, `7·8 = 56 = 55 + 1 ≡ 1`. All correct, and produced in a single linear pass.

### Factorial inverses: the companion trick

A close cousin precomputes inverse *factorials* for binomial coefficients `C(n, k) = n! / (k!(n-k)!) mod p`. Instead of inverting each factorial separately, invert only `fact[n]` once, then sweep backward:

```
fact[0] = 1; for i in 1..n: fact[i] = fact[i-1]·i % p
invfact[n] = inverse(fact[n], p)            # ONE inversion (Fermat or extgcd)
for i in n..1: invfact[i-1] = invfact[i]·i % p
```

This gives all `n+1` factorial inverses in `O(n)` with a single inversion, because `invfact[i-1] = 1/(i-1)! = (1/i!)·i = invfact[i]·i`. The everyday competitive-programming pattern: precompute `fact` and `invfact` once, answer each `C(n, k)` in `O(1)`. Element inverses `inv[i] = invfact[i]·fact[i-1]` fall out of the same tables.

---

## Solving Linear Congruences

The general problem: solve `a·x ≡ b (mod m)` for `x`. This is the workhorse behind CRT, Diophantine equations, and countless "find `x`" problems.

### Solvability

Let `g = gcd(a, m)`. The congruence `a·x ≡ b (mod m)` has a solution **if and only if `g | b`** (`g` divides `b`). The reason: `a·x` and `m` together can only produce multiples of `g` (Bezout: the set `{a·x mod m}` is exactly the multiples of `g` in `[0, m)`), so `b` must be such a multiple.

### Number of solutions

When solvable, there are **exactly `g` distinct solutions modulo `m`**, and they are evenly spaced `m/g` apart. So:

- `g = 1`: a **unique** solution mod `m` (the common, clean case — `a` is invertible).
- `g > 1` and `g | b`: **`g` solutions**, namely `x₀, x₀ + m/g, x₀ + 2m/g, …, x₀ + (g-1)m/g` (mod `m`).
- `g ∤ b`: **no** solution.

### The algorithm

1. Compute `g = gcd(a, m)` via extended Euclid, also getting `x'` with `a·x' + m·y' = g`.
2. If `g ∤ b`, report **no solution**.
3. Otherwise, scale: a particular solution is `x₀ = x' · (b / g) mod (m / g)`. Reduce into `[0, m/g)`.
4. The full set is `{ x₀ + t·(m/g) : t = 0, 1, …, g-1 }` mod `m`.

### Worked example

Solve `6·x ≡ 8 (mod 10)`. Here `g = gcd(6, 10) = 2`, and `2 | 8`, so there are **2 solutions**. Extended Euclid on `(6, 10)` gives `6·2 + 10·(-1) = 2`, so `x' = 2`. Scale: `b/g = 4`, `m/g = 5`, `x₀ = 2·4 mod 5 = 8 mod 5 = 3`. The solutions mod `10` are `3` and `3 + 5 = 8`. Check: `6·3 = 18 ≡ 8 (mod 10)` ✓ and `6·8 = 48 ≡ 8 (mod 10)` ✓.

Contrast `6·x ≡ 7 (mod 10)`: `g = 2` does not divide `7`, so **no solution** — no multiple of `6` is ever `≡ 7 (mod 10)`, because `6·x mod 10` is always even.

### Cleaner approach: reduce to the coprime case

The scaling step `x₀ = x'·(b/g) mod (m/g)` is a little fiddly. A cleaner equivalent is to *divide out `g` first*:

```
a·x ≡ b (mod m),  g = gcd(a, m),  require g | b
   ⟹  (a/g)·x ≡ (b/g)  (mod m/g)        # now gcd(a/g, m/g) = 1
   ⟹  x₀ = (a/g)⁻¹ · (b/g)  mod (m/g)   # unique inverse exists
   ⟹  solutions = x₀ + t·(m/g), t = 0..g-1   (mod m)
```

Dividing through by `g` lands you in a *coprime* congruence with a unique inverse, which you solve cleanly, then lift to the `g` solutions mod `m`. This avoids reasoning about scaled Bezout coefficients and is the recommended production form.

### Worked reduction

`8·x ≡ 6 (mod 14)`: `g = gcd(8, 14) = 2`, `2 | 6` ✓. Reduce: `4·x ≡ 3 (mod 7)`. Now `4⁻¹ mod 7 = 2` (`4·2 = 8 ≡ 1`), so `x₀ = 2·3 = 6 mod 7 = 6`. Lift: solutions mod `14` are `6` and `6 + 7 = 13`. Check: `8·6 = 48 ≡ 6 (mod 14)` ✓, `8·13 = 104 = 7·14 + 6 ≡ 6 (mod 14)` ✓.

---

## Code Examples

### Solve `a·x ≡ b (mod m)` returning all solutions

#### Go

```go
package main

import "fmt"

func extgcd(a, b int64) (int64, int64, int64) {
	if b == 0 {
		return a, 1, 0
	}
	g, x1, y1 := extgcd(b, a%b)
	return g, y1, x1 - (a/b)*y1
}

// solveCongruence returns all solutions of a*x ≡ b (mod m) in [0, m), or nil if none.
func solveCongruence(a, b, m int64) []int64 {
	a = ((a % m) + m) % m
	b = ((b % m) + m) % m
	g, x, _ := extgcd(a, m)
	if b%g != 0 {
		return nil // no solution
	}
	step := m / g
	x0 := ((x*(b/g))%step + step) % step // particular solution mod m/g
	sols := make([]int64, 0, g)
	for t := int64(0); t < g; t++ {
		sols = append(sols, (x0+t*step)%m)
	}
	return sols
}

func main() {
	fmt.Println(solveCongruence(6, 8, 10)) // [3 8]
	fmt.Println(solveCongruence(6, 7, 10)) // [] (no solution)
	fmt.Println(solveCongruence(3, 1, 11)) // [4] (the inverse of 3)
}
```

#### Java

```java
import java.util.*;

public class LinearCongruence {
    static long[] extgcd(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extgcd(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }

    static List<Long> solve(long a, long b, long m) {
        a = ((a % m) + m) % m;
        b = ((b % m) + m) % m;
        long[] r = extgcd(a, m);
        long g = r[0], x = r[1];
        List<Long> sols = new ArrayList<>();
        if (b % g != 0) return sols;             // no solution
        long step = m / g;
        long x0 = ((x * (b / g)) % step + step) % step;
        for (long t = 0; t < g; t++) sols.add((x0 + t * step) % m);
        return sols;
    }

    public static void main(String[] args) {
        System.out.println(solve(6, 8, 10)); // [3, 8]
        System.out.println(solve(6, 7, 10)); // []
        System.out.println(solve(3, 1, 11)); // [4]
    }
}
```

#### Python

```python
def extgcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = extgcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


def solve_congruence(a, b, m):
    """All solutions of a*x ≡ b (mod m) in [0, m); empty list if none."""
    a %= m
    b %= m
    g, x, _ = extgcd(a, m)
    if b % g != 0:
        return []                       # no solution
    step = m // g
    x0 = (x * (b // g)) % step          # particular solution mod m/g
    return [(x0 + t * step) % m for t in range(g)]


if __name__ == "__main__":
    print(solve_congruence(6, 8, 10))   # [3, 8]
    print(solve_congruence(6, 7, 10))   # []
    print(solve_congruence(3, 1, 11))   # [4]  (= 3^-1 mod 11)
```

### The O(n) inverse table (counting semiring, prime modulus)

```python
def inverse_table(n, p):
    """inv[i] = i^{-1} mod p for i in 1..n, in O(n). Requires p prime and p > n."""
    inv = [0] * (n + 1)
    inv[1] = 1
    for i in range(2, n + 1):
        inv[i] = (-(p // i) * inv[p % i]) % p
    return inv


if __name__ == "__main__":
    print(inverse_table(10, 11))  # [0, 1, 6, 4, 3, 9, 2, 8, 7, 5, 10]
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Fermat on composite modulus | `a^(m-2)` is not the inverse | use extended Euclid for non-prime `m` |
| No existence check | returns a number when `gcd ≠ 1` | gate on `g == 1` (inverse) or `g | b` (congruence) |
| Negative result | raw Bezout `x` or scaled `x0` is negative | normalize: `((x % step) + step) % step`, then into `[0, m)` |
| Overflow in `x * (b/g)` | product exceeds 64-bit | use 128-bit product, or reduce factors mod `step` first |
| O(n) table on composite mod | some `i` not invertible → wrong table | require prime `p > n` |
| Solving with `m = 0` | division by zero | reject `m ≤ 0`; modulus must be positive |
| Dropping extra solutions | reported only `x0` when `g > 1` | emit all `g` solutions spaced `m/g` apart |
| Confusing `x` and `y` | returned `y` as the inverse | the inverse is `x` (coefficient of `a`) |
| `inv[0]` accessed in table | index `0` left as junk | never query `inv[0]`; start at `inv[1] = 1` |

### Worked overflow scenario

For `m = 1_000_000_007` and a mid-run coefficient `s ≈ 5·10^8` with quotient `q ≈ 2`, the product `q*s ≈ 10^9` fits in 64 bits — but for `m` near `2^31` with larger quotients, `q*s` can approach `m²  ≈ 10^18`, which still fits `int64` (max `≈ 9.2·10^18`) but the *post-inversion* multiply `value * inv` with both near `10^9` gives `10^18`, also borderline. For `m` near `2^63`, both overflow; use 128-bit products. The safe habit: any `(big * big) % m` uses a `mulmod` helper.

---

## Performance Analysis

| Task | Naive | Optimized | When optimized matters |
|------|-------|-----------|------------------------|
| One inverse | `O(log m)` extended Euclid | same | always fine |
| `n` inverses (separate) | `O(n log m)` | — | acceptable for small `n` |
| `n` inverses (table) | — | **`O(n)`** | precomputing factorials/binomials |
| Solve `a·x ≡ b (mod m)` | `O(log m)` | same | always fine |
| Many congruences, same `m` | `O(q log m)` | precompute `a⁻¹` once if `a` fixed | repeated divisions by the same `a` |

The two big wins at this level: the **O(n) table** turns `O(n log m)` into `O(n)` (a `log m ≈ 30–60×` speedup at scale), and choosing **Fermat vs extended Euclid** correctly avoids both wrong answers (Fermat on composite) and unnecessary generality.

```python
import time

def bench(n, p):
    start = time.perf_counter()
    inverse_table(n, p)           # O(n)
    t_table = time.perf_counter() - start
    start = time.perf_counter()
    [pow(i, p - 2, p) for i in range(1, n + 1)]  # O(n log p)
    t_loop = time.perf_counter() - start
    return t_table, t_loop
# For n = 10^6, p = 998244353: the table is roughly 20-40x faster than n Fermat calls.
```

---

## Connections: CRT and Linear Diophantine

The extended Euclidean algorithm is not a standalone trick — it is the shared engine of two sibling topics you will meet next.

### Linear Diophantine equations (sibling `07`)

The equation `a·x + b·y = c` (find *integers* `x, y`) is solvable **iff `gcd(a, b) | c`** — the same divisibility gate as the congruence. The base solution comes straight from Bezout: if `a·x₀ + b·y₀ = g` and `g | c`, then `(x₀·(c/g), y₀·(c/g))` is a particular solution, and the general solution adds multiples of `(b/g, -a/g)`. So solving `a·x ≡ b (mod m)` is *the same problem* as the Diophantine `a·x - m·y = b`. Master one and you have the other.

### Chinese Remainder Theorem (sibling `08`)

CRT merges congruences `x ≡ r₁ (mod m₁)`, `x ≡ r₂ (mod m₂)` (coprime moduli) into a single `x mod (m₁·m₂)`. The merge formula is

```
x = r₁ + m₁ · ((r₂ - r₁) · m₁⁻¹ mod m₂)   (mod m₁·m₂),
```

and the crucial ingredient `m₁⁻¹ mod m₂` is a **modular inverse** — exactly what extended Euclid produces. CRT is "one inverse per modulus, then a weighted sum." Every modular-inverse skill in this file is a prerequisite for CRT.

### Worked CRT merge

Merge `x ≡ 2 (mod 3)` and `x ≡ 3 (mod 5)`. Here `m₁⁻¹ mod m₂ = 3⁻¹ mod 5 = 2` (since `3·2 = 6 ≡ 1`). Then `x = 2 + 3·((3 - 2)·2 mod 5) = 2 + 3·2 = 8`. Check: `8 mod 3 = 2` ✓, `8 mod 5 = 3` ✓. The unique answer mod `15` is `8`.

The single inverse `3⁻¹ mod 5` is the only "hard" part — everything else is multiplication and addition. This is the recurring shape: inverses are the scarce, expensive primitive, so you compute each one once and reuse it.

---

## Best Practices

- **Default to iterative extended Euclid** — no stack, explicit invariant, detects non-existence.
- **Use the O(n) table** whenever you need inverses of a contiguous range mod a prime; never loop `n` separate inversions.
- **Pick Fermat only for a single inverse mod a known prime**, reusing an existing fast-power.
- **Always emit the full solution set** of `a·x ≡ b (mod m)`: `g` solutions when `g | b`, none otherwise.
- **Normalize everything** into the canonical residue range before returning.
- **Test with `(a * inv) % m == 1`** and, for congruences, plug each solution back into `a·x ≡ b`.
- **Reduce `a` mod `m` first** so the algorithm runs on the smallest representative and products stay small.
- **Wrap big multiplications in a `mulmod` helper** so a forgotten overflow never silently corrupts results.
- **Prefer the coprime-reduction form** of the congruence solver over scaled Bezout coefficients — fewer sign traps.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level view highlights:
> - The forward Euclidean table of quotients `q` and remainders `r`
> - The back-substitution assembling `x, y` with `a·x + b·y = g`
> - Reading the inverse `x mod m` when `g = 1`, and editable `a`, `m`

---

## Decision Guide

| You have… | Use | Why |
|-----------|-----|-----|
| one inverse, prime modulus | Fermat `a^(p-2)` | one `modpow`, clean |
| one inverse, composite modulus | extended Euclid | Fermat invalid |
| modulus possibly non-coprime | extended Euclid | only it detects `g ≠ 1` |
| inverses of `1..n` mod prime | O(n) table | linear, no inversions |
| factorial inverses for `C(n,k)` | one inversion + backward sweep | `O(n)` total |
| solve `a·x ≡ b (mod m)` | extended Euclid + reduce by `g` | full solution set |
| merge two congruences | CRT (needs an inverse) | unique result mod product |

## Summary

The iterative extended Euclidean algorithm maintains the invariant `r = s·a + t·b` at every step, so when `r` hits `0` the previous row is exactly `(g, x, y)` with `a·x + b·y = g`. Reducing `a·x + m·y = 1` mod `m` gives the modular inverse `x`, which exists **iff** `gcd(a, m) = 1`. Compared with **Fermat's `a^(p-2)`** (prime modulus only), extended Euclid is more general and detects non-existence. For inverses of all of `1..n` mod a prime, the recurrence `inv[i] = -(m/i)·inv[m%i] % m` runs in **`O(n)`**. The general congruence `a·x ≡ b (mod m)` is solvable **iff `gcd(a, m) | b`**, and then has exactly `gcd(a, m)` solutions spaced `m/gcd(a, m)` apart — cleanest to solve by dividing out `g` into a coprime congruence and lifting. These pieces — Bezout, inverse, congruence solving — are the building blocks of CRT (sibling `08`) and linear Diophantine equations (sibling `07`).

Key takeaways to carry into senior and professional study:

- The Bezout coefficient `x` is unique only mod `m/g`; the *inverse* (residue mod `m`) is unique. Normalize.
- "Inverse exists" and "coprime" are the same statement — always gate on `gcd(a, m) = 1`.
- Fermat is a prime-only shortcut; extended Euclid is the universal tool and the only one that reports non-existence.
- The `O(n)` table and the factorial-inverse sweep both turn `O(n log m)` into `O(n)` with structure-specific recurrences.
- "No inverse" (`gcd > 1`) is not "no solution": the congruence may still have `g` solutions if `g | b`.
