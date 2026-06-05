# Fermat's Little Theorem & Euler's Theorem — Middle Level

> **Focus:** Euler's theorem and the totient function in depth — computing `φ` for one number and **sieving** it for all, the modular inverse via Fermat *and* Euler, **exponent reduction mod `φ(m)`**, the **order** of an element, and exactly when each tool is the right one.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [The Totient: Computing and Sieving](#the-totient-computing-and-sieving)
6. [Order of an Element](#order-of-an-element)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was two facts: `a^(p-1) ≡ 1 (mod p)` (Fermat) and `a^(φ(m)) ≡ 1 (mod m)` (Euler). At middle level you turn those facts into reliable engineering decisions:

- When do you invert via **Fermat** (`a^(p-2)`), via **Euler** (`a^(φ(m)-1)`), or via **extended Euclid**? Each has a precondition.
- How do you compute `φ(m)` for a single `m` in `O(√m)`, and how do you **sieve** `φ(1..n)` for *all* `n` in `O(n log log n)`?
- Why is `φ` **multiplicative**, and how does that justify the product formula?
- How do you reduce a huge exponent `e` to `e mod φ(m)` — and what breaks when `gcd(a, m) ≠ 1`?
- What is the **order** of an element, why does it divide `φ(m)`, and how do you find it?

These questions separate "I memorized two congruences" from "I can pick the correct modular tool and prove it terminates with the right answer."

---

## Deeper Concepts

### Euler's theorem restated and specialized

Let `(ℤ/mℤ)^*` be the set of residues coprime to `m` under multiplication mod `m`. It has exactly `φ(m)` elements and is a **group** (every element has an inverse). Euler's theorem is the statement that raising any group element to the size of the group gives the identity:

```
a^(φ(m)) ≡ 1 (mod m)        for every a with gcd(a, m) = 1.
```

Fermat is the prime case: `(ℤ/pℤ)^*` has `φ(p) = p - 1` elements, so `a^(p-1) ≡ 1`. The full group-theoretic justification (Lagrange's theorem: element order divides group order) is in [`professional.md`](./professional.md); the practical takeaway is that **`φ(m)` is the universal exponent that always lands you on `1`.**

### Three ways to compute a modular inverse

| Method | Precondition | Cost | Formula |
|--------|--------------|------|---------|
| **Fermat** | `m = p` prime, `gcd(a,p)=1` | `O(log p)` | `a^(p-2) mod p` |
| **Euler** | `gcd(a,m)=1`, `φ(m)` known | `O(log m)` + factoring | `a^(φ(m)-1) mod m` |
| **Extended Euclid** | `gcd(a,m)=1` | `O(log m)` | solve `a·x ≡ 1` directly (sibling `06`) |

Fermat is the clean default under a prime modulus. Euler generalizes it but needs `φ(m)` (hence the factorization of `m`). Extended Euclid (sibling `06-extended-euclidean-modular-inverse`) needs *no* factorization and works for any coprime `(a, m)` — so for a single composite-modulus inverse it is usually the best choice. Use Euler's `a^(φ(m)-1)` mainly when you already have `φ(m)` for other reasons.

### Exponent reduction mod `φ(m)`

The key operational consequence of Euler's theorem:

```
gcd(a, m) = 1   ⟹   a^e ≡ a^(e mod φ(m)) (mod m).
```

Because the powers of `a` cycle with a period dividing `φ(m)`, any two exponents congruent mod `φ(m)` give the same residue. For a prime modulus this is `e mod (p-1)`. This is how `a^(b^c) mod m` (an exponent tower) becomes tractable: reduce the *inner* exponent `b^c` mod `φ(m)` first.

> **Critical caveat:** the reduction `a^e ≡ a^(e mod φ(m))` requires `gcd(a, m) = 1`. If the base shares a factor with `m`, use the **generalized Euler / lifting rule** (covered next and in `senior.md`): for `e ≥ log₂ m`, `a^e ≡ a^((e mod φ(m)) + φ(m)) (mod m)`.

### The generalized rule for `gcd(a, m) ≠ 1` (preview)

When the base is *not* coprime to `m`, the cycle of powers is not "purely periodic" — there is a short non-repeating tail before it settles. The fix is:

```
a^e ≡ a^( (e mod φ(m)) + φ(m) ) (mod m),    valid whenever e ≥ log₂ m.
```

Adding `φ(m)` keeps the exponent past the non-periodic tail (length at most `log₂ m`). This single formula works whether or not `gcd(a, m) = 1`, which makes it the safe default for exponent towers. The proof and edge analysis are in `professional.md`/`senior.md`.

---

## Comparison with Alternatives

### Inverse method selection

| Situation | Best tool | Why |
|-----------|-----------|-----|
| One inverse, prime modulus `p` | Fermat `a^(p-2)` | one line, no extra state |
| Many inverses, prime modulus | batch inverse (prefix-product trick) | `O(n + log p)` for `n` inverses |
| One inverse, composite `m`, `φ` unknown | extended Euclid | no factorization needed |
| One inverse, composite `m`, `φ` known | Euler `a^(φ-1)` | reuses known `φ` |
| Modulus not coprime to `a` | **no inverse exists** | `gcd ≠ 1` ⟹ no solution |

The **batch inverse** trick deserves a mention: to invert `a_1, …, a_n` mod a prime, compute prefix products `P_i = a_1…a_i`, invert only `P_n` once via Fermat, then unwind. That gives all `n` inverses in `O(n + log p)` instead of `O(n log p)`.

### `φ` for one value vs all values

| Need | Method | Cost |
|------|--------|------|
| `φ(m)` for one `m` | trial-division factor + product formula | `O(√m)` |
| `φ(m)` for one *huge* `m` with known factorization | product formula directly | `O(r)` (r distinct primes) |
| `φ(1), …, φ(n)` for all | sieve (Eratosthenes-style or linear) | `O(n log log n)` / `O(n)` |
| `φ(m)` for one huge `m`, factorization hard | Pollard's rho first (`09-...`) | sub-exponential factoring |

The crossover: if you need totients for a *range*, sieve them once; if you need a *single* totient, trial-divide.

---

## Advanced Patterns

### Pattern: Inverse via Fermat and via Euler, side by side

#### Go

```go
package main

import "fmt"

func powMod(a, e, m int64) int64 {
	a %= m
	if a < 0 {
		a += m
	}
	r := int64(1) % m
	for e > 0 {
		if e&1 == 1 {
			r = r * a % m
		}
		a = a * a % m
		e >>= 1
	}
	return r
}

func totient(m int64) int64 {
	res := m
	for p := int64(2); p*p <= m; p++ {
		if m%p == 0 {
			for m%p == 0 {
				m /= p
			}
			res -= res / p
		}
	}
	if m > 1 {
		res -= res / m
	}
	return res
}

// Inverse mod prime p via Fermat.
func invFermat(a, p int64) int64 { return powMod(a, p-2, p) }

// Inverse mod any m (gcd(a,m)=1) via Euler.
func invEuler(a, m int64) int64 { return powMod(a, totient(m)-1, m) }

func main() {
	fmt.Println(invFermat(3, 7))  // 5
	fmt.Println(invEuler(3, 10))  // 7  (3*7 = 21 ≡ 1 mod 10); φ(10)=4
	fmt.Println(invEuler(7, 12))  // 7  (7*7 = 49 ≡ 1 mod 12); φ(12)=4
}
```

#### Java

```java
public class Inverses {
    static long powMod(long a, long e, long m) {
        a %= m; if (a < 0) a += m;
        long r = 1 % m;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % m;
            a = a * a % m;
            e >>= 1;
        }
        return r;
    }

    static long totient(long m) {
        long res = m;
        for (long p = 2; p * p <= m; p++)
            if (m % p == 0) {
                while (m % p == 0) m /= p;
                res -= res / p;
            }
        if (m > 1) res -= res / m;
        return res;
    }

    static long invFermat(long a, long p) { return powMod(a, p - 2, p); }
    static long invEuler(long a, long m)  { return powMod(a, totient(m) - 1, m); }

    public static void main(String[] args) {
        System.out.println(invFermat(3, 7)); // 5
        System.out.println(invEuler(3, 10)); // 7
        System.out.println(invEuler(7, 12)); // 7
    }
}
```

#### Python

```python
def pow_mod(a, e, m):
    a %= m
    r = 1 % m
    while e > 0:
        if e & 1:
            r = r * a % m
        a = a * a % m
        e >>= 1
    return r


def totient(m):
    res, p = m, 2
    while p * p <= m:
        if m % p == 0:
            while m % p == 0:
                m //= p
            res -= res // p
        p += 1
    if m > 1:
        res -= res // m
    return res


def inv_fermat(a, p):
    return pow_mod(a, p - 2, p)


def inv_euler(a, m):
    return pow_mod(a, totient(m) - 1, m)


if __name__ == "__main__":
    print(inv_fermat(3, 7))  # 5
    print(inv_euler(3, 10))  # 7
    print(inv_euler(7, 12))  # 7
```

### Pattern: Exponent tower `a^(b^c) mod m`

Reduce the inner exponent mod `φ(m)`. When coprimality is not guaranteed, use the generalized `+φ` rule.

```python
def tower_coprime(a, b, c, m):
    """a^(b^c) mod m assuming gcd(a, m) = 1."""
    phi = totient(m)
    inner = pow(b, c, phi)          # b^c mod φ(m)
    return pow(a, inner, m)


def tower_general(a, b, c, m):
    """a^(b^c) mod m for ANY a (generalized Euler with +φ guard)."""
    phi = totient(m)
    inner = pow(b, c, phi)
    # add φ(m) to clear the non-periodic tail (safe since b^c is large)
    return pow(a, inner + phi, m)
```

### Pattern: Multiplicativity of `φ`

Because `gcd(a, b) = 1 ⟹ φ(ab) = φ(a)φ(b)`, you can build `φ(m)` from its prime-power factors:

```
φ(p₁^{e₁} ⋯ p_r^{e_r}) = ∏_i φ(p_i^{e_i}) = ∏_i (p_i^{e_i} − p_i^{e_i − 1}).
```

This is exactly what the trial-division loop computes implicitly: each distinct prime contributes a `(1 − 1/p)` factor.

---

## The Totient: Computing and Sieving

### Single-value computation (`O(√m)`)

Factor `m` by trial division; for each distinct prime `p` dividing `m`, multiply the running result by `(1 − 1/p)`. The implementation in the code section subtracts `result / p` per distinct prime — algebraically identical and integer-safe (no fractions).

### Sieving `φ(1..n)` for all `n`

To get every totient up to `n`, do **not** call the `O(√k)` routine `n` times. Instead, run a modified Sieve of Eratosthenes. Initialize `phi[i] = i`, then for each prime `p` (a value still equal to its initial self when reached), sweep its multiples and apply the `(1 − 1/p)` factor:

```
phi[i] = i for all i
for p = 2 .. n:
    if phi[p] == p:          # p is prime (untouched)
        for multiple = p, 2p, 3p, … ≤ n:
            phi[multiple] -= phi[multiple] / p
```

This is `O(n log log n)` — the same complexity as the prime sieve itself (sibling `03-prime-sieves`). A **linear** `O(n)` variant interleaves with the smallest-prime-factor sieve; both are standard.

### Why the sieve is correct

When the outer loop hits a prime `p`, every multiple of `p` gets its `(1 − 1/p)` factor applied exactly once (because we only enter the inner loop for *prime* `p`, and each multiple is visited once per distinct prime divisor). After all primes ≤ `n` are processed, each `phi[i]` has accumulated exactly the product `i · ∏_{p|i}(1 − 1/p)`.

### Useful totient identities

- `Σ_{d | n} φ(d) = n` (the totients of divisors of `n` sum to `n`).
- `φ(p) = p − 1`, `φ(p^e) = p^{e-1}(p − 1)`.
- `φ(2m) = 2φ(m)` if `m` is even; `φ(2m) = φ(m)` if `m` is odd.
- `φ(n)` is even for all `n > 2`.

### Worked sieve trace

Sieve `φ(1..6)`. Initialize `phi = [0, 1, 2, 3, 4, 5, 6]` (index 0..6). Processing prime `2` (`phi[2] == 2`), sweep multiples `2, 4, 6`: `phi[2] -= 1 → 1`, `phi[4] -= 2 → 2`, `phi[6] -= 3 → 3`. Processing prime `3` (`phi[3] == 3`), sweep `3, 6`: `phi[3] -= 1 → 2`, `phi[6] -= 1 → 2`. Processing prime `5` (`phi[5] == 5`), sweep `5`: `phi[5] -= 1 → 4`. The composites `4, 6` were never "prime" when reached (already reduced), so the result is `phi[1..6] = [1, 1, 2, 2, 4, 2]` — matching the single-value totient for each. Note `phi[6]` got two reductions (by `2` then `3`), reflecting its two distinct prime factors.

---

## Order of an Element

### Definition and the divisibility law

The **order** of `a` mod `m` (with `gcd(a, m) = 1`) is the smallest `d > 0` with `a^d ≡ 1 (mod m)`. The central theorem:

```
ord_m(a)  divides  φ(m).
```

(For prime `m = p`, the order divides `p − 1`.) This is why Euler's theorem holds: `φ(m)` is a multiple of the order, so `a^(φ(m)) = (a^(ord))^(φ(m)/ord) ≡ 1`. Proof in `professional.md`.

### Computing the order efficiently

Naively scanning `d = 1, 2, …` is `O(φ(m))` — too slow. The fast method uses the divisibility law: the order must be a **divisor of `φ(m)`**.

1. Compute `t = φ(m)`.
2. Factor `t`.
3. Start with `ord = t`. For each prime `q | t`, while `ord/q` is still a valid exponent (`a^(ord/q) ≡ 1`), divide `ord` by `q`.
4. The remaining `ord` is the true order.

This is `O(√m + log² m · log m)`-ish — dominated by factoring `φ(m)` and a logarithmic number of fast powers.

### Connection to primitive roots

An element whose order equals `φ(m)` exactly is a **primitive root** — it generates the whole group `(ℤ/mℤ)^*`. Primitive roots exist only for `m ∈ {1, 2, 4, p^k, 2p^k}`. This is the gateway to discrete logarithms (sibling `12-primitive-root-discrete-root`).

---

## Code Examples

### Sieve of totients `φ(1..n)`

#### Python

```python
def sieve_totient(n):
    """Return phi[0..n] with phi[i] = φ(i), in O(n log log n)."""
    phi = list(range(n + 1))        # phi[i] = i initially
    for p in range(2, n + 1):
        if phi[p] == p:             # p is prime
            for multiple in range(p, n + 1, p):
                phi[multiple] -= phi[multiple] // p
    return phi


if __name__ == "__main__":
    phi = sieve_totient(12)
    print(phi[1:])  # [1, 1, 2, 2, 4, 2, 6, 4, 6, 4, 10, 4]
```

#### Go

```go
package main

import "fmt"

func sieveTotient(n int) []int {
	phi := make([]int, n+1)
	for i := range phi {
		phi[i] = i
	}
	for p := 2; p <= n; p++ {
		if phi[p] == p { // p is prime
			for m := p; m <= n; m += p {
				phi[m] -= phi[m] / p
			}
		}
	}
	return phi
}

func main() {
	phi := sieveTotient(12)
	fmt.Println(phi[1:]) // [1 1 2 2 4 2 6 4 6 4 10 4]
}
```

#### Java

```java
import java.util.Arrays;

public class SieveTotient {
    static int[] sieveTotient(int n) {
        int[] phi = new int[n + 1];
        for (int i = 0; i <= n; i++) phi[i] = i;
        for (int p = 2; p <= n; p++)
            if (phi[p] == p)               // p is prime
                for (int m = p; m <= n; m += p)
                    phi[m] -= phi[m] / p;
        return phi;
    }

    public static void main(String[] args) {
        int[] phi = sieveTotient(12);
        System.out.println(Arrays.toString(Arrays.copyOfRange(phi, 1, 13)));
        // [1, 1, 2, 2, 4, 2, 6, 4, 6, 4, 10, 4]
    }
}
```

### Order of an element (Python)

```python
def totient(m):
    res, p = m, 2
    while p * p <= m:
        if m % p == 0:
            while m % p == 0:
                m //= p
            res -= res // p
        p += 1
    if m > 1:
        res -= res // m
    return res


def factorize(t):
    factors, p = set(), 2
    while p * p <= t:
        while t % p == 0:
            factors.add(p)
            t //= p
        p += 1
    if t > 1:
        factors.add(t)
    return factors


def multiplicative_order(a, m):
    """Smallest d>0 with a^d ≡ 1 (mod m); requires gcd(a, m) = 1."""
    from math import gcd
    assert gcd(a, m) == 1
    order = totient(m)
    for q in factorize(order):
        while order % q == 0 and pow(a, order // q, m) == 1:
            order //= q
    return order


if __name__ == "__main__":
    print(multiplicative_order(3, 7))  # 6  (3 is a primitive root mod 7)
    print(multiplicative_order(2, 7))  # 3  (2^3 = 8 ≡ 1 mod 7)
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Inverse with composite `m` via Fermat | `a^(m-2)` is not the inverse. | Use `a^(φ(m)-1)` or extended Euclid. |
| `gcd(a, m) ≠ 1` | No inverse exists; order undefined. | Check `gcd` first; return "no inverse". |
| Exponent reduced mod `φ(m)` with non-coprime base | Wrong residue (ignored the non-periodic tail). | Use the generalized `+φ` rule. |
| Totient counts repeated primes | Applied `(1 − 1/p)` per power, not per distinct prime. | Strip all copies of `p`, apply factor once. |
| Order scan `O(φ(m))` | Too slow for large `φ(m)`. | Reduce from divisors of `φ(m)` only. |
| Overflow in `a*a` (Go/Java) | Product overflows 64-bit for `m` near `2^32`. | Use 128-bit multiply or `__int128`/big.Int. |

---

## Performance Analysis

| Task | `m`/`n` scale | Cost |
|------|---------------|------|
| One `a^e mod m` | any | `O(log e)` |
| One `φ(m)` (trial division) | `m ≤ 10^14` | `O(√m)` ≈ `10^7` ops |
| `φ(1..n)` sieve | `n ≤ 10^7` | `O(n log log n)` — well under a second |
| Order of `a` mod `m` | `φ(m)` factorable | `O(√m + log m · #divisors)` |
| Inverse via extended Euclid | any | `O(log m)` |
| Batch `n` inverses mod prime | `n ≤ 10^6` | `O(n + log p)` |

The two dominant costs are `O(log e)` per exponentiation and `O(√m)` to factor a single `m`. For ranges, the `O(n log log n)` totient sieve amortizes far better than per-value trial division. If `m` is huge and hard to factor, totient computation inherits the difficulty of factoring (sibling `09-pollard-rho-factorization`).

```python
import time

def benchmark_sieve(n):
    start = time.perf_counter()
    _ = sieve_totient(n)
    return time.perf_counter() - start

# Typical: n = 10^7 sieves all totients in well under 1s in CPython.
```

---

## Best Practices

- **Match the inverse method to the modulus:** Fermat for prime, extended Euclid for composite, Euler only when `φ(m)` is already known.
- **Reduce exponents mod `φ(m)`** (or `p−1`), never mod `m`; use the `+φ` generalized rule when the base may share a factor with `m`.
- **Sieve totients for ranges**, trial-divide for single values; never loop per-value over a range.
- **Find orders from divisors of `φ(m)`** — never scan all exponents.
- **Always check `gcd(a, m) = 1`** before inverting or reducing — it is the precondition every theorem here shares.
- **Test the totient formula** against the brute-force coprime-counter on small `m`, and the sieve against the single-value routine.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The cyclic sequence `a^1, a^2, …` mod `m` returning to `1` after `ord(a)` steps.
> - How `ord(a)` divides `φ(m)` (the cycle length is a clean fraction of the totient).
> - The highlighted set of residues coprime to `m`, whose count is `φ(m)`.
> - Editable `a, m` so you can watch the order change while it always divides `φ(m)`.

---

## Summary

Euler's theorem `a^(φ(m)) ≡ 1 (mod m)` (for `gcd(a, m) = 1`) is the general form of Fermat's `a^(p-1) ≡ 1`, and the **totient** `φ(m)` — the count of coprime residues, factoring as `m · ∏(1 − 1/p)` — is the universal exponent. The totient is **multiplicative**, computable in `O(√m)` for one value and **sieved** in `O(n log log n)` for a whole range (sibling `03-prime-sieves`). Modular inverses come from Fermat (`a^(p-2)`, prime), Euler (`a^(φ(m)-1)`), or extended Euclid (composite, no factoring). The operational payoff is **exponent reduction**: `a^e ≡ a^(e mod φ(m))` for coprime bases, with the generalized `+φ` rule for non-coprime bases — the key to exponent towers. Finally, the **order** of an element always divides `φ(m)`, which both explains Euler's theorem and powers primitive-root and discrete-log machinery (sibling `12-primitive-root-discrete-root`). Master the totient and the order, and the two theorems become a single coherent toolkit.
