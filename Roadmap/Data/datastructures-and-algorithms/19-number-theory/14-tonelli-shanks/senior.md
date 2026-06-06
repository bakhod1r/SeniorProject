# Tonelli-Shanks — Senior Level

> A square root mod a prime is a five-line routine — until the modulus is a 256-bit curve prime where `a*a % p` overflows and Cipolla beats the `S = 96` Tonelli-Shanks loop; until the modulus is a prime *power* needing Hensel lifting; until it is a *composite* needing factorization, per-factor roots, and CRT recombination with `2^k` solution sets; or until the root is on the hot path of elliptic-curve point decompression and a constant-time, side-channel-aware implementation is a security requirement. At that point overflow-safe `mulmod`, algorithm selection by `S`, the prime-power/composite extension, and ECC integration all become correctness or security incidents.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Finding Non-Residues at Scale](#2-finding-non-residues-at-scale)
3. [Tonelli-Shanks vs Cipolla: Choosing by S](#3-tonelli-shanks-vs-cipolla-choosing-by-s)
4. [Square Roots in Elliptic-Curve Cryptography](#4-square-roots-in-elliptic-curve-cryptography)
5. [Prime Powers: Hensel Lifting](#5-prime-powers-hensel-lifting)
6. [Composite Moduli: Factor + CRT](#6-composite-moduli-factor--crt)
7. [Big Primes and Overflow-Safe Arithmetic](#7-big-primes-and-overflow-safe-arithmetic)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is not "how does the loop work" but "what system am I building, and what breaks when I scale it?" Modular square roots show up in four production guises that share one engine:

1. **Elliptic-curve point decompression** — recovering `y` from a compressed point `(x, sign)` requires `y = √(x³ + ax + b) mod p`. This is on the hot path of every TLS handshake using EC keys; it must be fast, correct, and ideally constant-time.
2. **Cryptographic primitives** — Rabin cryptosystem, BLS signatures (hash-to-curve), quadratic residue PRGs, and Goldwasser-Micali all need square roots or QR tests mod a prime (or a product of primes).
3. **Solving `x² ≡ a (mod m)` for composite `m`** — factor `m`, root each prime power (Tonelli-Shanks + Hensel), recombine with CRT. The solution count multiplies across factors.
4. **The `k = 2` case of the discrete-root pipeline** (sibling `13`) — Tonelli-Shanks is preferred over the primitive-root method for square roots because it needs neither a factorization of `p − 1` nor a discrete log.

All four reduce to: *establish solvability (Euler/Jacobi), compute one root mod each prime power, and recombine.* The senior decisions are: how to find non-residues robustly, when Cipolla beats Tonelli-Shanks, how to extend to prime powers and composites, how to stay overflow-safe and (for crypto) side-channel-resistant.

---

## 2. Finding Non-Residues at Scale

Tonelli-Shanks needs one quadratic non-residue `z`. Three facts shape the production approach.

### 2.1 It is a coin flip

Exactly half the units are non-residues, so trying `z = 2, 3, 5, …` and testing `(z/p) = −1` succeeds in ≈ 2 tries expected. The smallest non-residue is conjectured `O(log² p)` under GRH and is tiny in practice — single digits for almost all primes. There is **no known efficient deterministic** algorithm to produce a non-residue (the problem is tied to GRH); the trial search is the standard and is negligible in cost.

### 2.2 Use Euler vs Jacobi deliberately

| Test | Cost | Works when |
|------|------|------------|
| Euler's criterion `n^((p-1)/2)` | `O(log p)` exponentiation | `p` prime (the QR/QNR answer is exact) |
| Jacobi symbol (reciprocity) | `O(log² p)` but no exponentiation | any odd modulus; `(n/p) = −1` ⇒ non-residue |

For finding a non-residue you can use the **Jacobi symbol** (a generalization computed by quadratic reciprocity, like a binary gcd) which avoids modular exponentiation entirely and is often faster for the small candidates `2, 3, 5, …`. A Jacobi value of `−1` guarantees a non-residue; `+1` is inconclusive for composite moduli but exact for primes.

### 2.3 Constant-time caveat

In cryptographic code, a *data-dependent* loop length (how many `z` you try) can leak. But the non-residue search depends only on the **public prime `p`**, never on the secret `n`, so the leak is benign — the loop count is a function of `p` alone. The secret-dependent part (the tweak loop on `t = n^Q`) is what must be made constant-time; see §4.4.

---

## 3. Tonelli-Shanks vs Cipolla: Choosing by S

Both algorithms solve the identical problem; the deciding factor is `S` from `p − 1 = Q · 2^S`.

### 3.1 The cost split

| Algorithm | Cost | Dependence on `S` |
|-----------|------|-------------------|
| Tonelli-Shanks | `O(S² · log p)` worst (`O(S)` rounds × `O(S)` inner squarings) | quadratic in `S` |
| Cipolla | `O(M(p) · log p)` where `M(p)` is `F_{p²}` mult cost (≈ 3–4 `F_p` mults) | none |

For random primes `S` is small (the probability that `2^k | (p−1)` decays like `2^{-k}`), so Tonelli-Shanks is the default. But **constructed** primes can have huge `S`:

| Prime | `p − 1` | `S` | Better algorithm |
|-------|---------|-----|------------------|
| `998244353` (NTT) | `2^{23}·7·17` | 23 | Cipolla (≈530 `F_{p²}` mults vs ≈529 inner Tonelli steps — close; both fine) |
| `2^{255} − 19` (Curve25519 field) | `2 · (…)` | `S = 2` | Tonelli-Shanks (and a special `p ≡ 5 (mod 8)` form is even faster) |
| Proth primes `c·2^e + 1`, large `e` | `c·2^e` | up to `e` (e.g. 96) | Cipolla decisively |

### 3.2 The decision rule

```
choose_sqrt_algorithm(p):
  if p % 4 == 3: return "lagrange formula n^((p+1)/4)"     # S = 1, O(log p)
  S = v2(p - 1)                                            # 2-adic valuation
  if S is small (say <= 8): return "tonelli-shanks"
  else: return "cipolla"                                   # S-independent
```

Curve25519's field prime `2^255 − 19` is `≡ 5 (mod 8)`, so it uses a *closed-form* root (`n^((p+3)/8)` with a correction factor) — neither Tonelli-Shanks nor Cipolla, just a formula. Always check for a closed form before reaching for a loop.

### 3.3 Cipolla in `F_{p²}`

Cipolla picks `a` with `a² − n` a non-residue, then works in `F_{p²} = F_p[√w]` where `w = a² − n`. The root is `(a + √w)^((p+1)/2)`, whose `√w`-component is provably zero. Each `F_{p²}` multiplication is a handful of `F_p` multiplications; the single exponentiation is `O(log p)` of them — flat in `S`. This is why Cipolla wins on high-`S` primes.

---

## 4. Square Roots in Elliptic-Curve Cryptography

### 4.1 Point decompression

An elliptic curve over `F_p` is `y² = x³ + ax + b`. A **compressed** point stores `x` plus one bit of `y`. To decompress:

```
1. compute RHS = x³ + ax + b (mod p)
2. y = sqrt_mod(RHS, p)         ← Tonelli-Shanks / Cipolla / closed form
3. if y's parity ≠ stored sign bit: y = p - y
```

If `RHS` is a non-residue, the `x` does **not** lie on the curve — a validation failure (reject the point). So the Legendre/Euler check doubles as **on-curve validation**. This runs on every ECDH/ECDSA public-key import; correctness and speed both matter.

### 4.2 Hash-to-curve

BLS signatures and many modern protocols hash a message to a curve point. "Try-and-increment" hashing repeatedly sets `x = hash(msg ‖ ctr)` and checks whether `x³ + ax + b` is a QR (Euler's criterion), incrementing `ctr` until it is, then takes the square root. Modern standards (RFC 9380, SWU map) avoid the variable-time loop, but the underlying primitive is still "is this a QR, and if so what is its root."

### 4.3 Which prime, which algorithm

Most standardized curves use primes `≡ 3 (mod 4)` *precisely so* the cheap `n^((p+1)/4)` formula applies (e.g. secp256k1's field prime `2^256 − 2^32 − 977 ≡ 3 (mod 4)`; the P-256 prime is `≡ 3 (mod 4)` as well). This is a deliberate engineering choice: pick a curve prime where the square root is one exponentiation, no loop, naturally constant-time.

### 4.4 Constant-time requirements

For secret inputs, a branch- or memory-access pattern that depends on the secret leaks via timing/cache side channels. The `p ≡ 3 (mod 4)` formula `n^((p+1)/4)` is naturally constant-time (a fixed exponentiation). The full Tonelli-Shanks loop is **not** constant-time (the round count and inner order-search depend on the secret `t`), so it is avoided in production crypto for secret data — another reason curve primes are chosen `≡ 3 (mod 4)`. If you must use Tonelli-Shanks on secret data, you need a fixed-iteration, branchless rewrite, which is error-prone; prefer a curve with a closed-form root.

---

## 5. Prime Powers: Hensel Lifting

To solve `x² ≡ n (mod p^k)` for odd prime `p`:

1. Find a root `x₁` mod `p` (Tonelli-Shanks).
2. **Lift** it from mod `p^j` to mod `p^{j+1}` using Hensel's lemma / Newton iteration.

For `f(x) = x² − n`, `f'(x) = 2x`, and since `gcd(2x₁, p) = 1` (for odd `p`, `n ≢ 0`), the lift is unique:

```
given x_j with x_j² ≡ n (mod p^j):
  x_{j+1} = x_j - f(x_j) · (2 x_j)^{-1}   (mod p^{j+1})
```

Equivalently, a Newton step `x ← (x + n·x^{-1})/2` doubling precision each iteration, so `k` is reached in `O(log k)` lifts. There are still exactly two roots mod `p^k` (`±x`), as for primes. The special case `p = 2` is different: `x² ≡ n (mod 2^k)` has `0, 1, 2, or 4` solutions depending on `n mod 8` (`n ≡ 1 (mod 8)` ⇒ four roots for `k ≥ 3`), and needs its own handling.

```
sqrt_prime_power(n, p, k):           # p odd prime
  x = tonelli_shanks(n % p, p)
  if x is None: return None
  mod = p
  while mod < p^k:
    mod *= p   (capped at p^k)
    inv = modinv(2*x, mod)
    x = (x - (x*x - n) * inv) % mod   # Hensel lift
  return x                            # other root: p^k - x
```

---

## 6. Composite Moduli: Factor + CRT

Tonelli-Shanks alone is wrong for composite `m`. The pipeline:

```
factor m → for each prime power p_i^{e_i}: root via Tonelli-Shanks + Hensel
        → CRT-combine all combinations → solution set
```

### 6.1 The solution count multiplies

Each prime-power factor contributes **2** roots (for an odd `p_i` and `n` a QR there, `n ≢ 0`). With `r` distinct odd prime factors, there are `2^r` square roots mod `m` (times the `2^k` complication if `m` is even). This is why composite square roots are the basis of the Rabin cryptosystem and the hardness of factoring: finding *all* four roots of a square mod `pq` lets you factor `pq` via `gcd(x − y, n)`.

### 6.2 Worked composite solve

Solve `x² ≡ 4 (mod 35)`. `35 = 5·7`:

```
mod 5:  x² ≡ 4  →  x ≡ 2 or 3     (2 roots)
mod 7:  x² ≡ 4  →  x ≡ 2 or 5     (2 roots)
```

CRT-combine the `2·2 = 4` tuples:

```
(2,2) → 2     (2,5) → 12
(3,2) → 23    (3,5) → 33
```

So `x ∈ {2, 12, 23, 33}` mod `35`. The total count `4 = 2·2` is the **product** of per-factor counts — never the sum. Note `2` and `33 = 35 − 2` are the "obvious" pair; `12` and `23 = 35 − 12` are the "hidden" pair that exists only because `35` is composite, and `gcd(12 − 2, 35) = gcd(10, 35) = 5` recovers a factor — the Rabin/factoring link.

### 6.3 The factoring prerequisite

Solving `x² ≡ n (mod m)` for composite `m` *requires factoring `m`* (and indeed is computationally equivalent to it). For cryptographic `m = pq` you cannot do it without the factorization — which is exactly the Rabin trapdoor. Use Pollard-Rho / ECM (sibling factorization topics) to factor when feasible.

---

## 7. Big Primes and Overflow-Safe Arithmetic

For `p` of a few hundred bits:

- **`a*a % p` overflows 64 bits for `p > 2^32`.** Use 128-bit intermediate products (`bits.Mul64`/`Div64` in Go, `Math.multiplyHigh` or `BigInteger` in Java, native in Python), or **Montgomery multiplication** for repeated mults in the exponentiation. Every modular multiply in the loop and in `power` must be overflow-safe.
- **Use a bignum library for crypto-size primes.** Java `BigInteger` has `modPow` and even `BigInteger.sqrt` (integer sqrt, not modular); Python ints are arbitrary precision. Go needs `math/big`.
- **Montgomery form** keeps the whole exponentiation in Montgomery space, converting once in and once out — the standard for performance-critical modular exponentiation.
- **Closed forms first.** For curve primes `≡ 3 (mod 4)` or `≡ 5 (mod 8)`, the closed-form root avoids the loop entirely and is the fastest, constant-time option.

---

## 8. Code Examples

### 8.1 Go — overflow-safe Tonelli-Shanks with 128-bit mulmod

```go
package main

import (
	"fmt"
	"math/bits"
)

func mulmod(a, b, m uint64) uint64 {
	hi, lo := bits.Mul64(a, b)
	_, rem := bits.Div64(hi%m, lo, m)
	return rem
}

func powmod(a, e, m uint64) uint64 {
	a %= m
	var r uint64 = 1
	for e > 0 {
		if e&1 == 1 {
			r = mulmod(r, a, m)
		}
		a = mulmod(a, a, m)
		e >>= 1
	}
	return r
}

func legendre(n, p uint64) int {
	r := powmod(n, (p-1)/2, p)
	if r == p-1 {
		return -1
	}
	return int(r)
}

func tonelli(n, p uint64) (uint64, bool) {
	n %= p
	if n == 0 {
		return 0, true
	}
	if legendre(n, p) != 1 {
		return 0, false
	}
	if p%4 == 3 {
		return powmod(n, (p+1)/4, p), true
	}
	Q, S := p-1, uint64(0)
	for Q%2 == 0 {
		Q /= 2
		S++
	}
	z := uint64(2)
	for legendre(z, p) != -1 {
		z++
	}
	M := S
	c := powmod(z, Q, p)
	t := powmod(n, Q, p)
	R := powmod(n, (Q+1)/2, p)
	for t != 1 {
		i, tmp := uint64(0), t
		for tmp != 1 {
			tmp = mulmod(tmp, tmp, p)
			i++
		}
		b := c
		for j := uint64(0); j < M-i-1; j++ {
			b = mulmod(b, b, p)
		}
		R = mulmod(R, b, p)
		c = mulmod(b, b, p)
		t = mulmod(t, c, p)
		M = i
	}
	return R, true
}

func main() {
	// a 64-bit prime ≡ 1 (mod 4): 1000000000000000003 is not; use a known one.
	p := uint64(998244353) // S = 23 — Tonelli still works, Cipolla would be flatter
	x, ok := tonelli(2, p)
	fmt.Printf("sqrt(2) mod %d = %d (ok=%v); check %d\n", p, x, ok, mulmod(x, x, p))
}
```

### 8.2 Java — point decompression and Hensel lift to prime power

```java
import java.math.BigInteger;

public class EcSqrt {
    static final BigInteger TWO = BigInteger.TWO;

    // square root mod prime p via BigInteger (uses p ≡ 3 mod 4 fast path, else Tonelli)
    static BigInteger sqrtMod(BigInteger n, BigInteger p) {
        n = n.mod(p);
        if (n.signum() == 0) return BigInteger.ZERO;
        if (n.modPow(p.subtract(BigInteger.ONE).divide(TWO), p).equals(p.subtract(BigInteger.ONE)))
            return null; // non-residue
        if (p.testBit(0) && p.testBit(1)) // p ≡ 3 (mod 4): low two bits both 1
            return n.modPow(p.add(BigInteger.ONE).divide(BigInteger.valueOf(4)), p);
        return tonelli(n, p);
    }

    static BigInteger tonelli(BigInteger n, BigInteger p) {
        BigInteger Q = p.subtract(BigInteger.ONE);
        int S = Q.getLowestSetBit();
        Q = Q.shiftRight(S);
        BigInteger z = TWO;
        BigInteger pm1over2 = p.subtract(BigInteger.ONE).divide(TWO);
        while (!z.modPow(pm1over2, p).equals(p.subtract(BigInteger.ONE))) z = z.add(BigInteger.ONE);
        int M = S;
        BigInteger c = z.modPow(Q, p);
        BigInteger t = n.modPow(Q, p);
        BigInteger R = n.modPow(Q.add(BigInteger.ONE).divide(TWO), p);
        while (!t.equals(BigInteger.ONE)) {
            int i = 0;
            BigInteger tmp = t;
            while (!tmp.equals(BigInteger.ONE)) { tmp = tmp.multiply(tmp).mod(p); i++; }
            BigInteger b = c;
            for (int j = 0; j < M - i - 1; j++) b = b.multiply(b).mod(p);
            R = R.multiply(b).mod(p);
            c = b.multiply(b).mod(p);
            t = t.multiply(c).mod(p);
            M = i;
        }
        return R;
    }

    // decompress: recover y from x with chosen parity bit
    static BigInteger decompress(BigInteger x, BigInteger a, BigInteger b,
                                 BigInteger p, boolean yOdd) {
        BigInteger rhs = x.modPow(BigInteger.valueOf(3), p)
                          .add(a.multiply(x)).add(b).mod(p);
        BigInteger y = sqrtMod(rhs, p);
        if (y == null) return null;        // x not on curve
        if (y.testBit(0) != yOdd) y = p.subtract(y);
        return y;
    }

    public static void main(String[] args) {
        BigInteger p = BigInteger.valueOf(17);
        System.out.println(sqrtMod(BigInteger.valueOf(2), p)); // 6 (or 11)
    }
}
```

### 8.3 Python — composite square root via factor + Tonelli + CRT

```python
from math import gcd
from itertools import product


def legendre(n, p):
    r = pow(n % p, (p - 1) // 2, p)
    return -1 if r == p - 1 else r


def tonelli(n, p):
    n %= p
    if n == 0:
        return 0
    if legendre(n, p) != 1:
        return None
    if p % 4 == 3:
        return pow(n, (p + 1) // 4, p)
    Q, S = p - 1, 0
    while Q % 2 == 0:
        Q //= 2
        S += 1
    z = 2
    while legendre(z, p) != -1:
        z += 1
    M, c, t, R = S, pow(z, Q, p), pow(n, Q, p), pow(n, (Q + 1) // 2, p)
    while t != 1:
        i, tmp = 0, t
        while tmp != 1:
            tmp = tmp * tmp % p
            i += 1
        b = pow(c, 1 << (M - i - 1), p)
        R, c, t, M = R * b % p, b * b % p, t * b * b % p, i
    return R


def crt(rem, mod):
    R, M = 0, 1
    for r, m in zip(rem, mod):
        g = gcd(M, m)
        assert (r - R) % g == 0
        lcm = M // g * m
        # combine R (mod M) and r (mod m)
        diff = (r - R) // g
        inv = pow((M // g) % (m // g), -1, m // g)
        R = (R + M * (diff * inv % (m // g))) % lcm
        M = lcm
    return R % M


def sqrt_composite(n, factors):
    """factors: list of (prime, exponent). Returns all roots mod product."""
    mods, root_sets = [], []
    for p, e in factors:
        pe = p ** e
        x = tonelli(n % p, p)
        if x is None:
            return []  # no root in this factor ⇒ none overall
        # Hensel lift to p^e
        mod = p
        while mod < pe:
            mod *= p
            inv = pow(2 * x % mod, -1, mod)
            x = (x - (x * x - n) * inv) % mod
        mods.append(pe)
        root_sets.append(sorted({x % pe, (pe - x) % pe}))
    roots = set()
    for combo in product(*root_sets):
        roots.add(crt(list(combo), mods))
    return sorted(roots)


if __name__ == "__main__":
    print(sqrt_composite(4, [(5, 1), (7, 1)]))  # [2, 12, 23, 33] mod 35
    print(tonelli(2, 17))                        # 6 (or 11)
```

---

## 9. Observability and Testing

A wrong square root is silent: a "root" that does not square back to `n` corrupts a curve point or a CRT recombination downstream. Build in checks.

| Check | Why |
|-------|-----|
| Re-square: `x² ≡ n (mod m)` | The cheapest, most reliable correctness check — always do it. |
| Root count equals `2` (prime) / `2^r` (composite) | Detects missing roots in the CRT product. |
| Euler/Jacobi gate before computing | Prevents running the loop on a non-residue. |
| On-curve validation in decompression | `RHS` non-residue ⇒ reject the point. |
| `z` is a genuine non-residue (`legendre == -1`) | A residue silently breaks `c`'s order. |
| Hensel: `x² ≡ n (mod p^j)` after each lift | Catches inverse/precision bugs in the lift. |
| Brute force vs algorithm on small `p` | Catches off-by-one in the tweak loop. |

The single most valuable test is **re-substitution**: for every returned root `x`, assert `x² ≡ n (mod m)`, and assert the *number* of roots equals `2^r`. This catches nearly every bug without an independent oracle.

```text
property battery:
  for random small prime p, random n in [1, p-1]:
    x = tonelli(n, p)
    qr = (pow(n, (p-1)//2, p) == 1)
    assert (x is not None) == qr
    if x is not None:
      assert x*x % p == n
      assert {x, p-x} == set(brute_roots(n, p))
  for random odd m = p*q, n a QR mod m:
    roots = sqrt_composite(n, factor(m))
    assert all(r*r % m == n for r in roots)
    assert len(roots) in {0, 4}
```

---

## 10. Failure Modes

### 10.1 Running the loop on a non-residue
The inner order-search assumes `t`'s order is `≤ 2^(M-1)`; a non-residue breaks this, hanging or returning junk. Mitigation: Euler/Jacobi gate before the loop.

### 10.2 Using a residue as `z`
`c = z^Q` then has order `≤ 2^(S-1)`, too small to cancel `t`, and the loop misbehaves. Mitigation: assert `legendre(z, p) == -1`.

### 10.3 Overflow in modular multiply
`a*a % p` overflows `int64`/`long` for `p > 2^32`. Mitigation: 128-bit `mulmod`, Montgomery, or BigInteger.

### 10.4 Treating composite `m` as prime
Tonelli-Shanks on composite `m` gives nonsense (and misses roots). Mitigation: factor `m`, root each prime power, CRT-combine; the count is `2^r`, not `2`.

### 10.5 Summing instead of multiplying root counts
After CRT, the total root count is the **product** of per-factor counts. Mitigation: enumerate the Cartesian product of per-factor root sets.

### 10.6 Wrong parity in decompression
Returning `y` instead of `p − y` (or vice versa) for the stored sign bit yields the wrong point. Mitigation: compare `y`'s parity to the sign bit, flip if needed.

### 10.7 Non-constant-time root on secret data
Using the variable-time Tonelli-Shanks loop on secret inputs leaks via timing. Mitigation: choose curve primes `≡ 3 (mod 4)` (closed-form, constant-time), or a constant-time rewrite.

### 10.8 Forgetting `p = 2` and `p ≡ 2^k` cases
`x² ≡ n (mod 2^k)` has a different root count (`0/1/2/4` by `n mod 8`) and is not covered by odd-prime logic. Mitigation: special-case the power-of-two factor in the composite pipeline.

### 10.9 Hensel lift with a non-invertible derivative
For odd `p`, `2x` is invertible; but if `n ≡ 0 (mod p)` the derivative vanishes and the lift formula divides by a non-unit. Mitigation: handle `p | n` separately (root may be `0` or require lifting at a shifted valuation).

### 10.10 Assuming Cipolla is always faster
Cipolla's `F_{p²}` arithmetic has overhead; for small `S` plain Tonelli-Shanks is faster. Mitigation: select by `S` (rule in §3.2), and check for a closed form first.

---

## 11. Summary

- A modular square root is **five lines until it is a production incident**: overflow at crypto scale, a high-`S` prime where Cipolla wins, a prime power needing Hensel lifting, a composite needing factor + CRT, or a secret-data path needing constant-time.
- **Euler's criterion / Jacobi symbol** gates everything — it decides solvability, validates on-curve points, and guarantees the tweak loop's order invariant. Use Euler for primes, Jacobi (reciprocity, exponentiation-free) for fast non-residue hunting.
- **Choose by `S`** (`p − 1 = Q·2^S`): `p ≡ 3 (mod 4)` → closed form `n^((p+1)/4)`; small `S` → Tonelli-Shanks; large `S` → Cipolla (`S`-independent `F_{p²}` exponentiation). Always check for a curve-specific closed form (e.g. `p ≡ 5 (mod 8)`) first.
- **ECC point decompression** is the dominant production use; curves pick primes `≡ 3 (mod 4)` so the root is one constant-time exponentiation, doubling as on-curve validation.
- **Prime powers** lift a base root via Hensel/Newton in `O(log k)` steps (`p` odd; `p = 2` is special). **Composites** factor, root each prime power, CRT-combine — the root count is `2^r`, the product of per-factor counts, and the "extra" roots are the basis of Rabin/factoring.
- **Overflow-safe arithmetic** (128-bit `mulmod`, Montgomery, BigInteger) is mandatory beyond `2^32`; **constant-time** roots are mandatory on secret data.

### Anti-patterns to flag in review

- A square-root call with no Euler/Jacobi gate — hangs or lies on non-residues.
- `a*a % p` without overflow-safe `mulmod` for `p > 2^32`.
- Tonelli-Shanks applied to a composite modulus — wrong and incomplete.
- Summing instead of multiplying per-factor root counts after CRT.
- Variable-time Tonelli-Shanks on secret data in crypto.
- Defaulting to Cipolla for small `S`, or ignoring an available closed form.

### Decision summary

- **`p ≡ 3 (mod 4)`** → `n^((p+1)/4)`; one exponentiation, constant-time.
- **`p ≡ 5 (mod 8)` (e.g. Curve25519)** → closed-form with a correction; faster than any loop.
- **`p ≡ 1 (mod 4)`, small `S`** → Tonelli-Shanks.
- **`p ≡ 1 (mod 4)`, large `S` (Proth/NTT primes)** → Cipolla.
- **Prime power `p^k`** → root mod `p`, then Hensel-lift.
- **Composite `m`** → factor, root per prime power, CRT-combine (product of counts).
- **Secret-data crypto path** → closed-form root on a `≡ 3 (mod 4)` curve prime; never the variable-time loop.

References to study further: Cipolla's algorithm and `F_{p²}` arithmetic, Hensel's lemma / Newton's method for `p`-adic lifting, the Jacobi symbol via quadratic reciprocity, Montgomery multiplication, RFC 9380 (hash-to-curve), the Rabin cryptosystem and its factoring equivalence, and sibling topics `05-fermat-euler`, `06-crt`, `09-miller-rabin-primality`, and `13-primitive-root-discrete-root`.

---

Next step: [`professional.md`](./professional.md) — formal correctness proof of the order-halving invariant, the 2-adic valuation argument for termination, and the `O(log² p)` expected complexity.
