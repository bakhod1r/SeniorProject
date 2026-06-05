# Primitive Roots & Discrete Root — Senior Level

> Finding a primitive root is a five-line routine — until `p − 1` does not factor cheaply, the modulus turns out to have no generator, the prime is cryptographically large, or you are choosing a prime *specifically* so that its primitive root powers an NTT. At that point factoring `φ`, validating the existence form `{1, 2, 4, p^k, 2p^k}`, selecting an NTT prime, and avoiding the discrete-log trap all become correctness or performance incidents.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Factoring φ: The Real Cost Center](#2-factoring-φ-the-real-cost-center)
3. [When Primitive Roots Do Not Exist](#3-when-primitive-roots-do-not-exist)
4. [Primitive Roots mod Prime Powers and 2p^k](#4-primitive-roots-mod-prime-powers-and-2pk)
5. [NTT Prime Selection](#5-ntt-prime-selection)
6. [The Discrete Root Pipeline in Production](#6-the-discrete-root-pipeline-in-production)
7. [Big Primes and Cryptographic Scale](#7-big-primes-and-cryptographic-scale)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "how do I test a candidate `g`" but "what system am I building, and what breaks when I scale it?" Primitive roots and discrete roots show up in four production guises that share one engine:

1. **NTT prime selection** — you *design* a prime `p = c·2^e + 1` so that a primitive root `g` yields a primitive `2^e`-th root of unity `ω = g^{(p-1)/2^e}` for fast convolution (sibling `13-ntt`). Here you choose the modulus, then derive the root.
2. **Solving `x^k ≡ a`** at scale — a discrete-root pipeline whose cost is dominated by factoring `p − 1` and a discrete log (sibling `11`).
3. **Diffie-Hellman / parameter generation** — pick a safe prime `p = 2q + 1` and a generator of the order-`q` subgroup; correctness hinges on the existence form and on order, not the full primitive root.
4. **Deterministic test-data / PRNG generation** — a primitive root gives a full-period multiplicative sequence (a Lehmer generator) cycling through every nonzero residue.

All four reduce to: *establish that the group of units is cyclic, find or derive a generator (or a generator of a needed subgroup), and use the index map to linearize a multiplicative problem.* The senior decisions are: how to factor `φ` when it is hard, how to handle moduli with no primitive root, how to pick an NTT prime, and how to verify when `p` is too large to brute-force.

---

## 2. Factoring φ: The Real Cost Center

Everything about finding a primitive root mod `p` is cheap **except** factoring `φ = p − 1`. The generator test is `O(ω(p−1) · log p)` modular exponentiations; the search for the smallest `g` terminates in a handful of candidates. So the practical complexity of "find a primitive root" *equals* the complexity of factoring `p − 1`.

### 2.1 Factoring strategy ladder

| `p − 1` size | Method | Cost |
|--------------|--------|------|
| ≤ `10^{12}` | trial division to `√(p−1)` | `O(√p)` |
| up to `~10^{18}` | Pollard-Rho + Miller-Rabin (siblings `09`, `08`) | `O((p−1)^{1/4})` expected per factor |
| `p − 1` has a known smooth form (NTT primes) | the factorization is *given* (`c · 2^e`) | `O(1)` |
| cryptographic `p` (hundreds of bits) | only feasible if `p − 1` is smooth or factorization is published | generally infeasible |

The crucial engineering move: **if you control the prime, pick one whose `p − 1` factorization you already know.** NTT primes (`p − 1 = c · 2^e`) and safe primes (`p − 1 = 2q`, `q` prime) are chosen precisely so that factoring is trivial, which is why finding their generator is instant.

### 2.2 The smallest-generator heuristic

For random primes the smallest primitive root is conjectured to be `O(log^6 p)` (and is almost always a tiny single- or double-digit number in practice). So the search `g = 2, 3, 5, …` finds a generator after a handful of tries. There is no need to randomize the search; iterating small integers is both fast and reproducible. Skipping perfect powers (`4, 8, 9, …`) as candidates is a minor, optional optimization since a perfect power `g = h^2` can only be a generator when `gcd(2, p−1) = 1`, which fails for odd primes.

### 2.3 Reusing the factorization

If you compute orders for *many* elements mod the same `p`, factor `p − 1` once and pass the distinct primes into every `order()` and every generator test. Recomputing the factorization per call is the single most common avoidable slowdown in this topic.

### 2.4 Caching layers for a service

A service answering many `(p, a)` order or generator queries should cache three tiers: (1) the prime factorization of `p − 1` keyed by `p` (the expensive tier), (2) the smallest generator `g` per `p` (cheap once the factorization is cached), and (3) optionally an index table per small `p` for `O(1)` discrete logs. Tier (1) is the one worth persisting across requests; rebuilding it per call turns an `O(ω log p)` query into an `O(√p)` one. For a fixed prime used throughout (a common case — one global NTT modulus), compute all three once at startup and treat them as immutable shared state.

---

## 3. When Primitive Roots Do Not Exist

The group `Z/mZ*` is cyclic — equivalently a primitive root exists — **iff** `m ∈ {1, 2, 4, p^k, 2p^k}` for an odd prime `p`. For every other modulus the group is a *product* of two or more cyclic groups, and no single element generates it.

### 3.1 The validation gate

Before searching, validate the form. A misapplied search either loops forever (none exists) or, worse, returns an element of maximal *element* order that is **not** a true generator, silently corrupting any index computation that follows.

```
hasPrimitiveRoot(m):
  if m in {1, 2, 4}: return true
  write m = 2^a * rest
  if a >= 2: return false              # 8,16,... and 4·odd have no generator
  # now m is odd, or 2·odd
  odd = (a == 1) ? m/2 : m
  return odd is a prime power p^k       # p odd prime, k >= 1
```

### 3.2 What to do instead: CRT decomposition

For `m = p₁^{e₁} · … · p_r^{e_r}`, the unit group factors as

```
Z/mZ*  ≅  Z/p₁^{e₁}Z*  ×  …  ×  Z/p_r^{e_r}Z*
```

(Chinese Remainder Theorem, sibling `05`). Each factor `Z/p_i^{e_i}Z*` *is* cyclic (for odd `p_i`), with its own primitive root. To solve `x^k ≡ a (mod m)`:

1. Factor `m`.
2. Solve `x^k ≡ a (mod p_i^{e_i})` in each cyclic factor via that factor's primitive root.
3. Recombine the per-factor solution sets with CRT — the total solution count is the *product* of the per-factor counts.

The `2^a` factor for `a ≥ 3` is the special case: `Z/2^aZ*  ≅  Z/2Z × Z/2^{a-2}Z` (generated by `−1` and `3`), so it needs the explicit two-generator structure rather than a single primitive root.

### 3.3 Worked CRT solve for a non-cyclic modulus

Solve `x² ≡ 4 (mod 15)`. `15 = 3·5` has no primitive root, so split:

```
mod 3:  x² ≡ 1  →  x ≡ 1 or 2   (2 solutions)
mod 5:  x² ≡ 4  →  x ≡ 2 or 3   (2 solutions)
```

CRT-combine the `2·2 = 4` tuples `(x mod 3, x mod 5)`:

```
(1,2) → 7    (1,3) → 13
(2,2) → 2    (2,3) → 8
```

So `x ∈ {2, 7, 8, 13}` mod `15`, and indeed `2²=4, 7²=49≡4, 8²=64≡4, 13²=169≡4`. The total solution count `4` is the *product* of the per-factor counts (`2·2`), never their sum — a frequent off-by-error when first implementing the composite case. Had either factor been unsolvable, the whole product would be `0`.

---

## 4. Primitive Roots mod Prime Powers and 2p^k

The junior/middle focus is the prime case; production code that handles `p^k` and `2p^k` needs two lifting facts (proved in [`professional.md`](./professional.md)):

### 4.1 Lifting a generator from `p` to `p^k`

If `g` is a primitive root mod the odd prime `p`, then `g` is *also* a primitive root mod `p^k` for all `k ≥ 1` **provided** `g^{p-1} ≢ 1 (mod p²)`. If the rare failure `g^{p-1} ≡ 1 (mod p²)` occurs, then `g + p` is a primitive root mod `p^k`. So the recipe is: find `g` mod `p`, test the one condition mod `p²`, and adjust by `+p` if needed.

### 4.2 From `p^k` to `2p^k`

If `g` is a primitive root mod `p^k`, then the **odd** one of `{g, g + p^k}` is a primitive root mod `2p^k`. (Units mod `2p^k` must be odd, and the group has the same size `φ(2p^k) = φ(p^k)`.)

```
primitiveRootPrimePower(p, k):     # p odd prime
  g = primitiveRoot(p)
  if power(g, p-1, p*p) == 1: g += p   # the rare lift correction
  return g                              # works mod p^k for all k

primitiveRootTwicePrimePower(p, k):
  g = primitiveRootPrimePower(p, k)
  if g is even: g += p^k                # ensure odd
  return g
```

These two liftings cover the entire existence list `{p^k, 2p^k}` beyond the base prime case.

---

## 5. NTT Prime Selection

The Number Theoretic Transform (sibling `13-ntt`) needs a prime `p` admitting a primitive `N`-th root of unity for `N = 2^e` a power of two ≥ the transform length. That requires `2^e | (p − 1)`, i.e. a prime of the form:

```
p = c · 2^e + 1     with c odd, e large enough
```

Given such a prime and any primitive root `g`, the element

```
ω = g^{(p-1)/2^e} = g^{c}   (mod p)
```

is a primitive `2^e`-th root of unity: `ω^{2^e} ≡ 1` and `ω^{2^{e-1}} ≡ −1` (the order is exactly `2^e`). This `ω` is what the butterfly recursion of the NTT uses.

### 5.1 The standard NTT primes

| Prime `p` | `p − 1` factorization | primitive root `g` | max NTT size `2^e` |
|-----------|------------------------|--------------------|--------------------|
| `998244353` | `2^{23} · 7 · 17` | `3` | `2^{23}` |
| `469762049` | `2^{26} · 7` | `3` | `2^{26}` |
| `167772161` | `2^{25} · 5` | `3` | `2^{25}` |
| `1004535809` | `2^{21} · 479` | `3` | `2^{21}` |

All four have primitive root `3` and a `p − 1` that is `2^e ·` (small odd), so factoring is free and `ω = 3^{(p-1)/N}` is computed in one exponentiation. This is why `998244353` is the default competitive-programming NTT modulus.

### 5.2 Deriving the root of unity safely

```python
def ntt_root_of_unity(p, g, N):
    # N must be a power of two dividing p-1
    assert (p - 1) % N == 0, "N must divide p-1"
    w = pow(g, (p - 1) // N, p)
    assert pow(w, N, p) == 1 and pow(w, N // 2, p) == p - 1, "w not a primitive N-th root"
    return w
```

The two asserts are the production guardrails: `ω^N ≡ 1` (it is an `N`-th root) and `ω^{N/2} ≡ −1` (it is *primitive*, not a lower-order root). If `g` were not actually a primitive root, or `N` did not divide `p − 1`, these catch it immediately.

### 5.3 Worked NTT root derivation

For `p = 998244353 = 119·2^{23} + 1`, generator `g = 3`, and transform length `N = 8 = 2^3`:

```
ω = 3^{(p-1)/8} = 3^{124780544} mod p
```

Check primitivity: `ω^8 ≡ 1` (it is an `8`-th root) and `ω^4 ≡ p − 1 ≡ −1` (so its order is exactly `8`, not `1, 2, or 4`). The inverse root for the inverse transform is `ω^{-1} = ω^{N-1} = ω^7`, and the `1/N` scaling uses `N^{-1} mod p`. Because `2^{23} | (p − 1)`, any `N = 2^t` with `t ≤ 23` works, so this single prime supports transforms up to `2^{23} ≈ 8.4` million points — the reason `998244353` is the default. The whole derivation is two modular exponentiations plus two asserts; there is no search.

### 5.4 Multi-prime NTT and CRT

When product coefficients can exceed one prime's range, run the NTT under several NTT-friendly primes (`998244353`, `469762049`, `167772161`, all root `3`) and reconstruct exact coefficients via CRT / Garner (sibling `15-garner-algorithm`). Each prime gives its own `ω = 3^{(p-1)/N}`; the transforms are independent and parallelizable. The number of primes needed is set by the maximum coefficient magnitude `≈ n · maxA · maxB` for length-`n` convolution — a back-of-envelope `log` estimate picks how many of the three primes to use.

---

## 6. The Discrete Root Pipeline in Production

Solving `x^k ≡ a (mod m)` at scale is a pipeline whose stages have very different costs.

```
factor m → per prime power p^e: find generator → discrete log of a → solve linear congruence → enumerate roots → CRT-combine across prime powers
```

### 6.1 Cost profile

- **Factor `m`** and each `φ(p^e) = p^{e-1}(p−1)`: the dominant precondition.
- **Discrete log** of `a` base the generator: `O(√p)` by BSGS (sibling `11`), or Pohlig-Hellman `O(Σ e_i(log + √p_i))` when `p − 1` is smooth — much faster on smooth-order groups.
- **Linear congruence** `kY ≡ A (mod φ)`: `O(log φ)` via extended Euclid; produces `gcd(k, φ)` solutions per factor.
- **CRT recombine**: the total root count is the product of per-factor counts; enumerate the Cartesian product.

### 6.2 Pohlig-Hellman synergy

When `p − 1` is smooth (which NTT and many constructed primes guarantee), the discrete log via **Pohlig-Hellman** reduces to discrete logs in each small prime-power subgroup, each solvable by tiny BSGS. This makes the whole discrete-root pipeline fast precisely on the primes you would choose deliberately — and intractable on cryptographic primes where `p − 1` has a large prime factor (the basis of DH security).

### 6.2b Worked pipeline cost split

For a realistic `p ≈ 10^9` with `p − 1 = 2·3·q` (`q ≈ 1.6·10^8` prime) solving `x^k ≡ a`: factoring `p − 1` is `O(√q) ≈ 10^4` (trial division to `q`), or instant with Pollard-Rho; the generator search is a few `IS-GENERATOR` calls; the discrete log via Pohlig-Hellman is dominated by `√q ≈ 1.3·10^4` in the order-`q` subgroup; the linear congruence and enumeration are `O(log)`. So the visible cost is two `√q`-sized steps. Profiling a slow service almost always points to one of these two; everything else is noise. The fast path below removes the discrete log entirely when only solvability is asked.

### 6.3 Existence fast path

If the caller only needs *whether* a root exists (not the roots themselves), skip the entire pipeline:

```
solvable  ⇔  a^{φ / gcd(k, φ)} ≡ 1 (mod p^e)   per prime power, AND across CRT factors
```

One exponentiation per factor, no generator, no discrete log. Always offer this fast path; many callers only need the boolean.

---

## 7. Big Primes and Cryptographic Scale

For `p` of a few hundred bits:

- **Modular multiplication overflows 64 bits.** Use 128-bit intermediate products, Montgomery multiplication (sibling `14`), or a bignum library. Every `a*a % p` in the generator test must be overflow-safe.
- **Factoring `p − 1` is generally infeasible** unless `p` was chosen with a smooth or published `p − 1`. This is a *feature* for cryptography (DH/DSA pick primes where `p − 1 = 2q`, `q` a large prime, so the only nontrivial factor is `q` itself) and a *blocker* for ad-hoc primitive-root finding.
- **You usually want a subgroup generator, not a full primitive root.** Diffie-Hellman works in the order-`q` subgroup of `Z/pZ*` for a large prime `q | (p−1)`; a generator `h` of that subgroup is `h = g₀^{(p-1)/q}` for any non-residue `g₀`, and `h ≠ 1` is the only check needed. You never need the full `(p−1)`-order primitive root.
- **The discrete log is the security assumption.** Finding a generator is easy; inverting `g^x` is the hard problem. Never assume you can compute a discrete log mod a cryptographic prime.

---

## 8. Code Examples

### 8.1 Go — overflow-safe order and generator for 64-bit primes (mulmod)

```go
package main

import (
	"fmt"
	"math/bits"
)

// mulmod via 128-bit product to stay safe for p up to ~2^63
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

func distinctPrimes(n uint64) []uint64 {
	var fs []uint64
	for d := uint64(2); d*d <= n; d++ {
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

func primitiveRoot(p uint64) uint64 {
	if p == 2 {
		return 1
	}
	phi := p - 1
	primes := distinctPrimes(phi)
	for g := uint64(2); g < p; g++ {
		ok := true
		for _, q := range primes {
			if powmod(g, phi/q, p) == 1 {
				ok = false
				break
			}
		}
		if ok {
			return g
		}
	}
	return 0
}

func main() {
	fmt.Println("generator mod 998244353 =", primitiveRoot(998244353)) // 3
	// NTT primitive 2^23-th root of unity
	p := uint64(998244353)
	g := primitiveRoot(p)
	N := uint64(1) << 23
	w := powmod(g, (p-1)/N, p)
	fmt.Println("w^N mod p =", powmod(w, N, p), " (want 1)")
}
```

### 8.2 Java — existence test, generator lift to prime power

```java
public class GeneratorLift {
    static long power(long a, long e, long mod) {
        a %= mod; long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = Math.floorMod(r * a, mod);
            a = Math.floorMod(a * a, mod);
            e >>= 1;
        }
        return r;
    }

    static java.util.List<Long> distinctPrimes(long n) {
        java.util.List<Long> fs = new java.util.ArrayList<>();
        for (long d = 2; d * d <= n; d++)
            if (n % d == 0) { fs.add(d); while (n % d == 0) n /= d; }
        if (n > 1) fs.add(n);
        return fs;
    }

    static long primitiveRoot(long p) {
        long phi = p - 1;
        var primes = distinctPrimes(phi);
        for (long g = 2; g < p; g++) {
            boolean ok = true;
            for (long q : primes) if (power(g, phi / q, p) == 1) { ok = false; break; }
            if (ok) return g;
        }
        return -1;
    }

    // primitive root mod p^k for odd prime p (works for all k via the lift test)
    static long primitiveRootPrimePower(long p) {
        long g = primitiveRoot(p);
        if (power(g, p - 1, p * p) == 1) g += p;  // rare correction
        return g;
    }

    // is x^k ≡ a (mod p) solvable? — no discrete log needed
    static boolean isKthResidue(long a, long k, long p) {
        long d = java.math.BigInteger.valueOf(k)
                   .gcd(java.math.BigInteger.valueOf(p - 1)).longValue();
        return power(Math.floorMod(a, p), (p - 1) / d, p) == 1;
    }

    public static void main(String[] args) {
        System.out.println("gen mod 7 = " + primitiveRoot(7));               // 3
        System.out.println("gen mod 9 = " + primitiveRootPrimePower(3));     // 2 (mod 3^k)
        System.out.println("is 5 a cube mod 13? " + isKthResidue(5, 3, 13)); // true
        System.out.println("is 2 a cube mod 13? " + isKthResidue(2, 3, 13)); // false
    }
}
```

### 8.3 Python — full-period Lehmer PRNG from a primitive root

```python
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
    phi = p - 1
    primes = distinct_primes(phi)
    for g in range(2, p):
        if all(pow(g, phi // q, p) != 1 for q in primes):
            return g
    return -1


def lehmer_sequence(p, seed=1, count=None):
    """Full-period multiplicative generator: x_{n+1} = g * x_n mod p.
    Because g is a primitive root, this visits every nonzero residue
    exactly once over a full period of p-1 before repeating."""
    g = primitive_root(p)
    count = count if count is not None else p - 1
    x = seed % p
    out = []
    for _ in range(count):
        x = x * g % p
        out.append(x)
    return out


if __name__ == "__main__":
    seq = lehmer_sequence(7)            # one full period mod 7
    print("period length:", len(set(seq)), "of", 7 - 1)  # 6 of 6
    print(seq)                          # a permutation of 1..6
```

The Lehmer (multiplicative congruential) generator is full-period exactly because the multiplier is a primitive root — a clean production use for deterministic, repeatable test data covering every residue.

---

## 9. Observability and Testing

A wrong primitive root is silent: indices computed from it are simply incorrect, and downstream `x^k ≡ a` answers look plausible but are wrong. Build in checks.

| Check | Why |
|-------|-----|
| `ord(g) == φ(m)` via full-cycle scan (small `m`) | Confirms `g` truly generates the whole group. |
| Brute-force order oracle vs fast order | Catches dedupe/factorization bugs in the order routine. |
| `gcd(g, m) == 1` assertion | A non-unit is never a generator. |
| Existence gate `m ∈ {1,2,4,p^k,2p^k}` before search | Prevents infinite loops on no-generator moduli. |
| NTT root asserts `ω^N ≡ 1`, `ω^{N/2} ≡ −1` | Validates the derived root of unity is primitive. |
| Discrete-root solutions re-substituted: `x^k ≡ a` | The cheapest correctness check — plug roots back in. |
| Count of roots equals `gcd(k, φ)` | Detects missing or duplicate shifts. |

The single most valuable test is **re-substitution**: for every returned root `x`, assert `x^k ≡ a (mod m)`, and assert the *number* of roots equals `gcd(k, φ)` (when solvable). This catches nearly every bug in the linear-congruence and enumeration steps without needing an independent oracle.

### 9.1 A property-test battery

```text
for random small prime p, random g in [2, p-1]:
    assert is_generator(g, p) == (order_bruteforce(g, p) == p - 1)
for the smallest generator g0 = primitive_root(p):
    assert order_bruteforce(g0, p) == p - 1
    assert {g0^x mod p : x in 0..p-2} == {1..p-1}      # full cycle
for random a, k:
    roots = solve_kth_root(k, a, p)
    assert all(pow(x, k, p) == a % p for x in roots)
    if roots: assert len(roots) == gcd(k, p - 1)
    assert (len(roots) > 0) == (pow(a, (p-1)//gcd(k,p-1), p) == 1)  # existence form
```

---

## 10. Failure Modes

### 10.1 Searching mod a modulus with no primitive root
A search loop mod `m = 8` or `m = 15` either never finds a generator or returns a maximal-element-order value that is not a true generator. Mitigation: gate on `m ∈ {1,2,4,p^k,2p^k}` first; otherwise CRT-decompose.

### 10.2 Forgetting the factorization is the bottleneck
Calling `primitiveRoot(p)` for a large `p` whose `p − 1` does not factor cheaply hangs in trial division. Mitigation: choose primes with known/smooth `p − 1`, or use Pollard-Rho (sibling `09`); never trial-divide a 18-digit `p − 1`.

### 10.3 Overflow in modular multiply
`g*g % p` overflows `int64` for `p > 2^31`. Mitigation: 128-bit products, `mulmod`, or Montgomery (sibling `14`).

### 10.4 Fermat inverse in the exponent ring
Solving `kY ≡ A (mod p−1)` with `k^{p-3}` (Fermat) is wrong because `p − 1` is composite. Mitigation: extended Euclid, after dividing the congruence by `gcd(k, p−1)`.

### 10.5 Treating the discrete log as easy
Assuming `solve_kth_root` is cheap mod a cryptographic prime. The discrete log is the hard step; it is intractable unless `p − 1` is smooth. Mitigation: use the existence fast path when only solvability is needed; never promise a discrete log mod a large safe prime.

### 10.6 Non-primitive NTT root
Using `ω = g^{(p-1)/N}` when `g` is not actually a primitive root (or `N ∤ p−1`) yields an `ω` of order *less* than `N`, silently corrupting the NTT. Mitigation: the two asserts `ω^N ≡ 1` and `ω^{N/2} ≡ −1`.

### 10.7 Wrong root count after CRT
For composite `m`, the number of roots is the *product* of per-prime-power counts, not their sum or max. Mitigation: enumerate the Cartesian product and CRT-combine each tuple.

### 10.8 Confusing element order with group order
Reporting the largest *element* order as if it were the group size `φ(m)`. For non-cyclic groups (e.g. `Z/8Z*`) the max element order (`2`) is strictly less than `φ` (`4`); there is no generator. Mitigation: a generator must have order exactly `φ(m)`, and that only exists for the cyclic moduli. The Carmichael function `λ(m)` is the true max element order; `λ(m) = φ(m)` iff a generator exists.

### 10.9 Fermat inverse where the ring is not a field
Computing `k^{-1}` mod `p − 1` via `k^{p-3}` (Fermat) silently returns garbage because `p − 1` is composite, so `Z/(p−1)Z` has zero divisors. Symptom: roots that fail re-substitution only for certain `k`. Mitigation: always use extended Euclid for inverses in the exponent ring, and only after dividing the congruence by `gcd(k, p−1)` so the remaining `k/d` is coprime to `(p−1)/d`.

### 10.10 Not deduplicating prime factors of φ
Passing `[2, 2, 3]` instead of `[2, 3]` for `φ = 12` re-runs the `q = 2` test, harmless for correctness but a code smell that often co-occurs with using prime *powers* (`4`) instead of primes (`2`) — which *is* a correctness bug (testing `g^{φ/4}` is wrong). Mitigation: the factorization routine must return distinct primes, asserted in tests.

---

## 11. Summary

- The whole cost of finding a primitive root is the cost of **factoring `φ = p − 1`**; the generator test and search are negligible. Control the prime (NTT prime, safe prime) so `p − 1` is smooth/known, and finding `g` is instant.
- A primitive root exists **iff** `m ∈ {1, 2, 4, p^k, 2p^k}`. Gate on this before searching; for other moduli, CRT-decompose into cyclic prime-power factors (sibling `05`).
- Lift a prime generator to `p^k` by checking `g^{p-1} ≢ 1 (mod p²)` (else use `g + p`); to `2p^k` by choosing the odd one of `{g, g + p^k}`.
- **NTT** needs a prime `p = c·2^e + 1`; then `ω = g^{(p-1)/2^e}` is a primitive `2^e`-th root of unity. Standard primes (`998244353`, root `3`) make this turnkey. Guard with `ω^N ≡ 1` and `ω^{N/2} ≡ −1` (sibling `13`).
- The **discrete root** pipeline (`x^k ≡ a`) is bottlenecked by factoring `φ` and the discrete log (sibling `11`); Pohlig-Hellman makes it fast on smooth-order groups. Offer the existence fast path `a^{φ/gcd(k,φ)} ≡ 1` whenever only solvability is needed.
- At cryptographic scale you want a **subgroup generator**, not a full primitive root; the discrete log being hard is the *security assumption*, and modular multiply must be overflow-safe (Montgomery, sibling `14`).
- Test by **re-substitution** (`x^k ≡ a`) and by the **root count** `gcd(k, φ)`; gate, assert orders, and never report a max-element-order value as a generator on a non-cyclic group.

### Anti-patterns to flag in review

- A generator search with no existence gate (`m ∈ {1,2,4,p^k,2p^k}`) — hangs or lies on non-cyclic `m`.
- `pow(k, mod-2, mod)` used to invert `k` mod `p − 1` — wrong, `p − 1` is composite.
- Refactoring `p − 1` inside a per-element order loop — turns `O(ω log p)` into `O(√p)` per call.
- A derived NTT root used without the `ω^N ≡ 1`, `ω^{N/2} ≡ −1` asserts — silent transform corruption.
- Summing instead of multiplying per-factor root counts after a CRT split — wrong total count.
- Treating a discrete log as cheap mod a large safe prime — it is the hard problem.

### Decision summary

- **Need a generator, you choose the prime** → pick an NTT or safe prime so `p − 1` is smooth; finding `g` is `O(1)`.
- **Need a generator, prime is given, `p − 1` factors cheaply** → trial division / Pollard-Rho then the small-`g` search.
- **Need only "does `x^k ≡ a` have a root"** → existence form `a^{φ/gcd(k,φ)} ≡ 1`; no generator, no discrete log.
- **Need the actual roots** → generator + discrete log (BSGS / Pohlig-Hellman) + linear congruence + enumerate `gcd(k,φ)` shifts.
- **Composite or non-cyclic modulus** → CRT-decompose, solve per prime power, recombine (product of counts).
- **Cryptographic prime** → subgroup generator only; assume the discrete log is intractable.

References to study further: Pohlig-Hellman discrete log on smooth groups, Montgomery multiplication (sibling `14`), Pollard-Rho factorization (sibling `09`), Tonelli-Shanks for the `k = 2` case, the structure theorem for `Z/mZ*`, NTT-friendly prime tables, and sibling topics `04-fermat-euler`, `05-crt`, `11-discrete-log-bsgs`, and `13-ntt`.
