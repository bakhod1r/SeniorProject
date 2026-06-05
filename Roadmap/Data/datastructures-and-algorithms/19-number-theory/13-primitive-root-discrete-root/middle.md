# Primitive Roots & Discrete Root — Middle Level

> **Focus:** How to find a primitive root by testing one power per prime factor of `φ`, why there are exactly `φ(φ(m))` of them, and how a primitive root + discrete log turns the multiplicative discrete-root problem `x^k ≡ a (mod m)` into a single linear congruence in the exponent.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [The Discrete Root Problem](#the-discrete-root-problem)
6. [Counting Roots and Residues](#counting-roots-and-residues)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was two definitions and one test: the **order** of `a` is the length of its power-cycle, a **primitive root** is an element of maximal order `φ(m)`, and you test a candidate `g` by checking `g^((p-1)/q) ≢ 1` for each prime `q | (p−1)`. At middle level you turn that into engineering:

- Why is the one-power-per-prime test correct, and why is it so much cheaper than checking every divisor of `φ`?
- Exactly how many primitive roots are there, and why `φ(φ(m))`?
- Given a primitive root `g`, how do you *use* it to solve `x^k ≡ a (mod m)` — the **discrete root** problem — without trial and error?
- When does `x^k ≡ a` have a solution at all, and how many solutions does it have?
- When should you reach for a primitive root versus a more direct method (e.g. Tonelli-Shanks for square roots, or CRT splitting)?

These are the questions that separate "I can find a generator" from "I can solve any `x^k ≡ a` and reason about how many answers there are."

---

## Deeper Concepts

### Order divides `φ`, restated with the divisor structure

For a unit `a` mod `m`, `ord_m(a)` always divides `φ(m)` (Lagrange; proof in [`professional.md`](./professional.md)). More precisely, for a primitive root `g`:

```
ord_m(g^t) = φ(m) / gcd(t, φ(m))
```

So the powers of a generator realize **every** divisor of `φ(m)` as an order. This single formula explains most counting facts in this topic:

- `g^t` is itself a primitive root iff `gcd(t, φ(m)) = 1`. There are `φ(φ(m))` such `t`, hence `φ(φ(m))` primitive roots.
- The number of elements of order exactly `d` (for each `d | φ(m)`) is `φ(d)`. Summing over divisors gives `Σ_{d | φ} φ(d) = φ(m)`, accounting for every unit.

### Why the generator test is correct

Suppose `g^((p-1)/q) ≢ 1` for every prime `q | (p−1)`. Let `e = ord_p(g)`; we know `e | (p−1)`. If `e` were a *proper* divisor of `p−1`, then `(p−1)/e > 1`, so some prime `q` divides `(p−1)/e`, which means `e | (p−1)/q`, hence `g^((p-1)/q) = (g^e)^{((p-1)/(qe))} ≡ 1` — contradiction. Therefore `e = p − 1` and `g` is a generator. The test inspects only `ω(p−1)` powers (one per *distinct* prime), not all `τ(p−1)` divisors. Full proof in [`professional.md`](./professional.md).

### Index (discrete log) tables

Once `g` is fixed, define `ind_g(a)` as the unique `x ∈ [0, φ(m))` with `g^x ≡ a`. Indices satisfy:

```
ind_g(a·b)  ≡ ind_g(a) + ind_g(b)   (mod φ(m))
ind_g(a^k)  ≡ k · ind_g(a)          (mod φ(m))
```

That is exactly the logarithm law, transplanted into modular arithmetic. The map `a ↦ ind_g(a)` is a group isomorphism `Z/mZ*  ≅  (Z/φ(m)Z, +)`. Computing a single index is the **discrete logarithm problem** (sibling `11-discrete-log-bsgs`, solvable in `O(√φ)` by baby-step giant-step); building the whole table costs `O(φ)` by walking `g^0, g^1, …`.

---

## Comparison with Alternatives

### Finding a primitive root: prime-factor test vs naive order

| Approach | Cost per candidate | Notes |
|----------|--------------------|-------|
| List the full cycle, check size `= φ` | `O(φ)` | Correct but linear in `φ`; hopeless for large `p`. |
| Test every divisor `d | φ`: is `g^d ≡ 1`? | `O(τ(φ) · log φ)` | Works; `τ(φ)` divisors. |
| **One power per prime `q | φ`** | `O(ω(φ) · log φ)` | The standard; only `ω(φ)` distinct primes. |

For `φ = 2^a · 3^b · …`, `ω(φ)` is tiny (the number of distinct primes), while `τ(φ)` (total divisors) can be large. The prime-factor test is the clear winner; its only prerequisite is the factorization of `φ`.

### Solving `x^k ≡ a`: primitive root vs specialized methods

| Need | Tool | Why |
|------|------|-----|
| General `x^k ≡ a (mod p)`, any `k` | primitive root + linear congruence | one uniform method, handles all `k` |
| Square root `x² ≡ a (mod p)` | Tonelli-Shanks | no factorization of `p−1` needed; `O(log² p)` |
| `x^k ≡ a (mod m)`, `m` composite | CRT split into prime powers (sibling `05`) | primitive root mod each `p^e`, recombine |
| `m` has no primitive root (`8, 15, …`) | CRT + per-factor structure | the group is a *product* of cyclic groups |

The primitive-root method is the most general: it solves `x^k ≡ a` for *any* exponent `k` at once, whereas Tonelli-Shanks is specialized to `k = 2`. The cost is that you must factor `p − 1` to find the generator.

---

## Advanced Patterns

### Pattern: Find a primitive root (factor `φ` once, test small `g`)

The standard production routine: factor `φ` a single time, then test `g = 2, 3, …` with one modular exponentiation per distinct prime.

#### Go

```go
package main

import "fmt"

func power(a, e, mod int64) int64 {
	a %= mod
	var r int64 = 1
	for e > 0 {
		if e&1 == 1 {
			r = r * a % mod
		}
		a = a * a % mod
		e >>= 1
	}
	return r
}

func distinctPrimes(n int64) []int64 {
	var fs []int64
	for d := int64(2); d*d <= n; d++ {
		if n%d == 0 {
			fs = append(fs, d)
			for n%d == 0 {
				n /= d
			}
		}
	}
	if n > 1 {
		fs = append(fs, n)
	}
	return fs
}

// primitive root mod prime p
func primitiveRoot(p int64) int64 {
	if p == 2 {
		return 1
	}
	phi := p - 1
	primes := distinctPrimes(phi)
	for g := int64(2); g < p; g++ {
		isRoot := true
		for _, q := range primes {
			if power(g, phi/q, p) == 1 {
				isRoot = false
				break
			}
		}
		if isRoot {
			return g
		}
	}
	return -1
}

func main() {
	for _, p := range []int64{7, 13, 17, 23, 998244353} {
		fmt.Printf("primitive root mod %d = %d\n", p, primitiveRoot(p))
	}
}
```

#### Java

```java
public class FindPrimitiveRoot {
    static long power(long a, long e, long mod) {
        a %= mod;
        long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % mod;
            a = a * a % mod;
            e >>= 1;
        }
        return r;
    }

    static java.util.List<Long> distinctPrimes(long n) {
        java.util.List<Long> fs = new java.util.ArrayList<>();
        for (long d = 2; d * d <= n; d++) {
            if (n % d == 0) {
                fs.add(d);
                while (n % d == 0) n /= d;
            }
        }
        if (n > 1) fs.add(n);
        return fs;
    }

    static long primitiveRoot(long p) {
        if (p == 2) return 1;
        long phi = p - 1;
        var primes = distinctPrimes(phi);
        for (long g = 2; g < p; g++) {
            boolean isRoot = true;
            for (long q : primes) {
                if (power(g, phi / q, p) == 1) { isRoot = false; break; }
            }
            if (isRoot) return g;
        }
        return -1;
    }

    public static void main(String[] args) {
        for (long p : new long[]{7, 13, 17, 23, 998244353L}) {
            System.out.println("primitive root mod " + p + " = " + primitiveRoot(p));
        }
    }
}
```

#### Python

```python
def distinct_primes(n):
    fs = []
    d = 2
    while d * d <= n:
        if n % d == 0:
            fs.append(d)
            while n % d == 0:
                n //= d
        d += 1
    if n > 1:
        fs.append(n)
    return fs


def primitive_root(p):
    if p == 2:
        return 1
    phi = p - 1
    primes = distinct_primes(phi)
    for g in range(2, p):
        if all(pow(g, phi // q, p) != 1 for q in primes):
            return g
    return -1


if __name__ == "__main__":
    for p in [7, 13, 17, 23, 998244353]:
        print(f"primitive root mod {p} = {primitive_root(p)}")
```

For `998244353` the answer is `3` — the classic NTT-friendly prime whose primitive root `3` powers the Number Theoretic Transform (sibling `13-ntt`).

### Pattern: Count primitive roots and elements of each order

```python
from math import gcd


def euler_phi(n):
    result, x = n, n
    d = 2
    while d * d <= x:
        if x % d == 0:
            while x % d == 0:
                x //= d
            result -= result // d
        d += 1
    if x > 1:
        result -= result // x
    return result


def num_primitive_roots(m):
    # number of generators = phi(phi(m))  (0 if none exist)
    return euler_phi(euler_phi(m))


def num_elements_of_order(d, phi):
    # for a cyclic group of size phi, #elements of order d (d | phi) is phi(d)
    return euler_phi(d) if phi % d == 0 else 0
```

---

## The Discrete Root Problem

The headline application: **solve `x^k ≡ a (mod m)`** for `x`. We do it for a prime `p` (composite `m` reduces to prime powers via CRT, sibling `05`).

### The reduction to a linear congruence

Let `g` be a primitive root mod `p` (so `φ = p − 1`). Write everything as a power of `g`:

```
x = g^Y    (Y is the unknown index of x)
a = g^A    (A = ind_g(a), found by discrete log, sibling 11)
```

Then `x^k ≡ a` becomes `g^{kY} ≡ g^A`, i.e. equate exponents mod the group order:

```
k · Y ≡ A   (mod p − 1)        ← a LINEAR congruence in Y
```

This linear congruence in `Y` is solved with the extended Euclidean algorithm (sibling `06`):

- Let `d = gcd(k, p − 1)`.
- A solution exists **iff** `d | A`.
- If it exists, there are exactly **`d`** solutions for `Y` mod `p − 1`, namely `Y ≡ (A/d)·(k/d)^{-1} (mod (p−1)/d)` plus the `d` shifts spaced `(p−1)/d` apart.
- Each distinct `Y` gives a distinct root `x = g^Y`.

So the *number of `k`-th roots of `a`* equals `gcd(k, p − 1)` when a root exists, and `0` otherwise.

### The full recipe

```
solve x^k ≡ a (mod p):
  1. g = primitiveRoot(p)
  2. A = discreteLog(g, a, p)          # ind_g(a), via BSGS (sibling 11)
  3. d = gcd(k, p-1)
  4. if A % d != 0: return NO SOLUTION
  5. solve k·Y ≡ A (mod p-1) for one Y0 (extended Euclid)
  6. roots = { g^(Y0 + i·(p-1)/d) mod p : i = 0..d-1 }
```

Steps 2 (discrete log) is the only expensive part; the rest is `O(log)` arithmetic.

### Existence criterion without solving

There is a slicker existence test that avoids the discrete log entirely (proved in [`professional.md`](./professional.md)):

```
x^k ≡ a (mod p) is solvable  ⇔  a^{(p-1)/gcd(k, p-1)} ≡ 1 (mod p)
```

When solvable, the count of solutions is exactly `gcd(k, p − 1)`. This is the modular generalization of "`a` has a square root mod `p` iff `a^{(p-1)/2} ≡ 1`" (Euler's criterion, the `k = 2` case).

---

## Counting Roots and Residues

A value `a` is called a **`k`-th power residue** mod `p` if `x^k ≡ a` is solvable.

| Quantity | Value (mod prime `p`, `d = gcd(k, p−1)`) |
|----------|-------------------------------------------|
| Number of `k`-th roots of a solvable `a` | `d` |
| Number of distinct `k`-th power residues | `(p − 1) / d` |
| Existence test for given `a` | `a^{(p-1)/d} ≡ 1` |
| `k`-th roots of `1` (the `d`-th roots of unity) | exactly `d` values |

**Worked example (`p = 13`, `k = 3`).** `p − 1 = 12`, `d = gcd(3, 12) = 3`.

- Number of cubic residues: `12 / 3 = 4`. (Only `4` of the `12` units are perfect cubes.)
- Each cubic residue has exactly `3` cube roots.
- `a` is a cube iff `a^{12/3} = a^4 ≡ 1`. Check `a = 5`: `5^4 = 625 = 48·13 + 1 ≡ 1`, so `5` is a cube; its three cube roots are `7, 8, 11` (since `7³ = 343 ≡ 5`, etc.). Check `a = 2`: `2^4 = 16 ≡ 3 ≠ 1`, so `2` is *not* a cube and `x³ ≡ 2` has no solution.

When `gcd(k, p − 1) = 1`, every `a` has exactly **one** `k`-th root (the map `x ↦ x^k` is a bijection); the unique root is `a^{k^{-1} mod (p−1)}`. This is the easy, common case — for example cube roots mod a prime `p ≡ 2 (mod 3)`.

---

## Code Examples

### Solve `x^k ≡ a (mod p)` end to end

This finds a primitive root, computes the discrete log via baby-step giant-step, then solves the linear congruence and lists all roots.

#### Python

```python
from math import gcd


def power(a, e, mod):
    return pow(a, e, mod)


def distinct_primes(n):
    fs, d = [], 2
    while d * d <= n:
        if n % d == 0:
            fs.append(d)
            while n % d == 0:
                n //= d
        d += 1
    if n > 1:
        fs.append(n)
    return fs


def primitive_root(p):
    if p == 2:
        return 1
    phi = p - 1
    primes = distinct_primes(phi)
    for g in range(2, p):
        if all(power(g, phi // q, p) != 1 for q in primes):
            return g
    return -1


def discrete_log(g, a, p):
    # baby-step giant-step: smallest x with g^x = a (mod p)
    import math
    n = int(math.isqrt(p)) + 1
    table = {}
    cur = 1
    for j in range(n):              # baby steps: g^j
        table.setdefault(cur, j)
        cur = cur * g % p
    factor = power(g, p - 1 - n, p)  # g^{-n}
    gamma = a % p
    for i in range(n):              # giant steps
        if gamma in table:
            return i * n + table[gamma]
        gamma = gamma * factor % p
    return -1


def solve_kth_root(k, a, p):
    """Return sorted list of all x with x^k ≡ a (mod p)."""
    a %= p
    if a == 0:
        return [0]
    g = primitive_root(p)
    A = discrete_log(g, a, p)        # a = g^A
    phi = p - 1
    d = gcd(k, phi)
    if A % d != 0:
        return []                    # not a k-th power residue
    # solve k·Y ≡ A (mod phi): divide through by d
    k2, A2, phi2 = k // d, A // d, phi // d
    inv = pow(k2 % phi2, -1, phi2)
    Y0 = (A2 * inv) % phi2
    roots = set()
    for i in range(d):
        Y = (Y0 + i * phi2) % phi
        roots.add(power(g, Y, p))
    return sorted(roots)


if __name__ == "__main__":
    print(solve_kth_root(3, 5, 13))   # [7, 8, 11]  (cube roots of 5)
    print(solve_kth_root(3, 2, 13))   # []          (2 is not a cube mod 13)
    print(solve_kth_root(2, 4, 13))   # [2, 11]     (square roots of 4)
```

#### Go

```go
package main

import "fmt"

func power(a, e, mod int64) int64 {
	a %= mod
	var r int64 = 1
	for e > 0 {
		if e&1 == 1 {
			r = r * a % mod
		}
		a = a * a % mod
		e >>= 1
	}
	return r
}

func gcd(a, b int64) int64 {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func distinctPrimes(n int64) []int64 {
	var fs []int64
	for d := int64(2); d*d <= n; d++ {
		if n%d == 0 {
			fs = append(fs, d)
			for n%d == 0 {
				n /= d
			}
		}
	}
	if n > 1 {
		fs = append(fs, n)
	}
	return fs
}

func primitiveRoot(p int64) int64 {
	if p == 2 {
		return 1
	}
	phi := p - 1
	primes := distinctPrimes(phi)
	for g := int64(2); g < p; g++ {
		ok := true
		for _, q := range primes {
			if power(g, phi/q, p) == 1 {
				ok = false
				break
			}
		}
		if ok {
			return g
		}
	}
	return -1
}

func discreteLog(g, a, p int64) int64 {
	var n int64 = 1
	for n*n < p {
		n++
	}
	table := map[int64]int64{}
	var cur int64 = 1
	for j := int64(0); j < n; j++ {
		if _, ok := table[cur]; !ok {
			table[cur] = j
		}
		cur = cur * g % p
	}
	factor := power(g, p-1-n, p)
	gamma := a % p
	for i := int64(0); i < n; i++ {
		if j, ok := table[gamma]; ok {
			return i*n + j
		}
		gamma = gamma * factor % p
	}
	return -1
}

// modular inverse mod m via Fermat is not valid for composite m,
// so use extended Euclid for the linear-congruence step.
func extgcd(a, b int64) (int64, int64, int64) {
	if b == 0 {
		return a, 1, 0
	}
	g, x1, y1 := extgcd(b, a%b)
	return g, y1, x1 - (a/b)*y1
}

func invMod(a, m int64) int64 {
	a = ((a % m) + m) % m
	_, x, _ := extgcd(a, m)
	return ((x % m) + m) % m
}

func main() {
	// demonstrate solving x^3 ≡ 5 (mod 13)
	p, k, a := int64(13), int64(3), int64(5)
	g := primitiveRoot(p)
	A := discreteLog(g, a, p)
	phi := p - 1
	d := gcd(k, phi)
	if A%d != 0 {
		fmt.Println("no solution")
		return
	}
	k2, A2, phi2 := k/d, A/d, phi/d
	inv := invMod(k2, phi2)
	Y0 := (A2 * inv) % phi2
	var roots []int64
	for i := int64(0); i < d; i++ {
		Y := (Y0 + i*phi2) % phi
		roots = append(roots, power(g, Y, p))
	}
	fmt.Println("cube roots of 5 mod 13:", roots) // some order of {7,8,11}
}
```

#### Java

```java
import java.util.*;

public class DiscreteRoot {
    static long power(long a, long e, long mod) {
        a %= mod;
        long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % mod;
            a = a * a % mod;
            e >>= 1;
        }
        return r;
    }

    static long gcd(long a, long b) { return b == 0 ? a : gcd(b, a % b); }

    static List<Long> distinctPrimes(long n) {
        List<Long> fs = new ArrayList<>();
        for (long d = 2; d * d <= n; d++) {
            if (n % d == 0) { fs.add(d); while (n % d == 0) n /= d; }
        }
        if (n > 1) fs.add(n);
        return fs;
    }

    static long primitiveRoot(long p) {
        if (p == 2) return 1;
        long phi = p - 1;
        var primes = distinctPrimes(phi);
        for (long g = 2; g < p; g++) {
            boolean ok = true;
            for (long q : primes) if (power(g, phi / q, p) == 1) { ok = false; break; }
            if (ok) return g;
        }
        return -1;
    }

    static long discreteLog(long g, long a, long p) {
        long n = (long) Math.sqrt(p) + 1;
        Map<Long, Long> table = new HashMap<>();
        long cur = 1;
        for (long j = 0; j < n; j++) { table.putIfAbsent(cur, j); cur = cur * g % p; }
        long factor = power(g, p - 1 - n, p), gamma = a % p;
        for (long i = 0; i < n; i++) {
            Long j = table.get(gamma);
            if (j != null) return i * n + j;
            gamma = gamma * factor % p;
        }
        return -1;
    }

    // modular inverse via extended Euclid (works for any coprime modulus)
    static long inv(long a, long m) {
        long[] r = extgcd(((a % m) + m) % m, m);
        return ((r[1] % m) + m) % m;
    }
    static long[] extgcd(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extgcd(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }

    public static void main(String[] args) {
        long p = 13, k = 3, a = 5;
        long g = primitiveRoot(p), A = discreteLog(g, a, p), phi = p - 1, d = gcd(k, phi);
        if (A % d != 0) { System.out.println("no solution"); return; }
        long k2 = k / d, A2 = A / d, phi2 = phi / d;
        long Y0 = (A2 % phi2) * inv(k2, phi2) % phi2;
        List<Long> roots = new ArrayList<>();
        for (long i = 0; i < d; i++) roots.add(power(g, (Y0 + i * phi2) % phi, p));
        Collections.sort(roots);
        System.out.println("cube roots of 5 mod 13: " + roots); // [7, 8, 11]
    }
}
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| `gcd(k, p−1) ∤ A` | `x^k ≡ a` has no solution but code "finds" one. | Check `A % d == 0`; return empty if not. |
| `a ≡ 0` | Discrete log of `0` is undefined. | Handle `a = 0` separately (only root is `0`, if `k ≥ 1`). |
| Inverse of `k/d` mod `(p−1)/d` fails | Forgot to divide out `d` first, so `k` and `p−1` are not coprime. | Divide congruence by `d = gcd`; then `k/d` is coprime to `(p−1)/d`. |
| Fermat inverse used for the exponent ring | `p − 1` is composite, so Fermat's `a^{m-2}` is invalid. | Use extended Euclid for inverses mod `p − 1`. |
| Missing roots | Generated only one `Y`, not all `d` shifts. | Add `i·(p−1)/d` for `i = 0..d−1`. |
| Slow discrete log | Used linear search instead of BSGS. | Use baby-step giant-step, `O(√p)` (sibling `11`). |

---

## Performance Analysis

| Step | Cost | Dominant for |
|------|------|--------------|
| Factor `φ(m)` | `O(√φ)` trial division, or Pollard-Rho `O(φ^{1/4})` (sibling `09`) | hard-to-factor `φ` |
| Find primitive root | `O(g₀ · ω(φ) · log φ)`, `g₀` = smallest root (tiny) | negligible once `φ` factored |
| Discrete log (BSGS) | `O(√p · log p)` time, `O(√p)` memory | the bottleneck of root-finding |
| Solve linear congruence | `O(log φ)` (extended Euclid) | negligible |
| Enumerate `d` roots | `O(d · log p)` | when `d = gcd(k, p−1)` is large |

The two expensive parts are **factoring `φ`** and the **discrete log**. The generator search and the linear-congruence solve are essentially free. For the existence-only question (does `x^k ≡ a` have *any* root?), skip the discrete log entirely and use `a^{(p-1)/d} ≡ 1` — a single `O(log p)` exponentiation.

```python
def is_kth_residue(a, k, p):
    d = __import__("math").gcd(k, p - 1)
    return pow(a % p, (p - 1) // d, p) == 1
# O(log p): no discrete log, no primitive root needed.
```

---

## Best Practices

- **Factor `φ` exactly once** and reuse the distinct primes for both the generator test and any order computation.
- **Use the existence criterion** `a^{(p-1)/d} ≡ 1` when you only need *whether* a root exists — it skips the costly discrete log.
- **Divide the linear congruence by `d = gcd(k, p−1)` first**, then take a *single* modular inverse mod `(p−1)/d`; never invert `k` directly mod `p−1` (it may not be invertible).
- **Use extended Euclid, not Fermat, for inverses mod `p − 1`** — the exponent ring `Z/(p−1)Z` is generally not a field.
- **Split composite moduli with CRT** (sibling `05`): solve mod each prime power, recombine. Do not look for a primitive root mod a modulus that has none.
- **Always test against a brute-force root finder** (enumerate `x = 0..p−1`, check `x^k ≡ a`) on small `p`.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - Plotting the powers of a candidate `g` around the residue ring and watching them either fill the ring (generator) or trace a smaller sub-cycle.
> - The order of `g` read as the cycle length, compared against `φ(p)`.
> - The order test: which of the powers `g^((p-1)/q)` equal `1` (failing the test) vs `≢ 1` (passing).
> - Editable `g` and `p` so you can hunt for a primitive root yourself.

---

## Summary

A primitive root `g` mod `p` is found by factoring `φ = p − 1` once and testing small candidates with the rule `g^((p-1)/q) ≢ 1` for every prime `q | (p−1)` — only `ω(p−1)` exponentiations, far cheaper than checking all divisors. The order of `g^t` is `φ/gcd(t, φ)`, from which `φ(φ(m))` primitive roots and `φ(d)` elements of each order `d | φ` follow directly. The real payoff is the **discrete root** problem: writing `x = g^Y`, `a = g^A`, the equation `x^k ≡ a` becomes the linear congruence `k·Y ≡ A (mod p−1)`, which has a solution iff `gcd(k, p−1) | A` and then exactly `gcd(k, p−1)` solutions. Equivalently, `a` is a `k`-th power residue iff `a^{(p-1)/gcd(k,p-1)} ≡ 1` — the generalized Euler criterion. The only expensive ingredients are factoring `φ` and the discrete log (sibling `11`); everything else is `O(log)` arithmetic. Master the index trick and any multiplicative equation mod a prime becomes a linear one.
