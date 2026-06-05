# Fermat's Little Theorem & Euler's Theorem — Senior Level

> Fermat and Euler are rarely the bottleneck on a textbook exercise — but the moment you build RSA, evaluate an exponent tower mod a composite, or rely on `a^(p-2)` as a hot-path inverse, every precondition (primality of the modulus, coprimality of the base, the non-periodic tail when `gcd(a,m) > 1`) becomes a correctness or security incident. This document treats those failure surfaces in production terms.

## Table of Contents
1. [Introduction](#1-introduction)
2. [RSA and the Cryptographic Context](#2-rsa-and-the-cryptographic-context)
3. [Exponent Towers and Generalized Euler](#3-exponent-towers-and-generalized-euler)
4. [When the Fermat Inverse Fails](#4-when-the-fermat-inverse-fails)
5. [Carmichael's Function: The Tighter Exponent](#5-carmichaels-function-the-tighter-exponent)
6. [Performance Engineering of Modular Exponentiation](#6-performance-engineering-of-modular-exponentiation)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is no longer "why does `a^(p-1) ≡ 1`" but "what system am I building on top of it, and what breaks at scale or under adversarial input?" Fermat and Euler show up in three production guises that share one engine — modular exponentiation:

1. **Public-key cryptography** — RSA encrypts `c = m^e mod N` and decrypts `m = c^d mod N`, where `e·d ≡ 1 (mod φ(N))`. Euler's theorem is *exactly* the reason decryption recovers the message.
2. **Fast modular division** — under a prime modulus (`10^9 + 7`, `998244353`), `a^(p-2)` is the standard inverse in competitive and numeric code; on a hot path it must be cheap and unconditionally correct.
3. **Huge-exponent evaluation** — exponent towers `a^(b^c) mod m` and recurrence-index reductions, where the exponent must be folded mod `φ(m)` (or `λ(m)`) before powering.

All three reduce to: *establish coprimality / primality, reduce the exponent in the right modulus, and run an overflow-safe `O(log e)` power.* The senior decisions are: how to keep the inverse correct when the modulus is composite, how to handle `gcd(a, m) > 1` in exponent reduction, which exponent (`φ` vs Carmichael `λ`) to fold by, and how to make the multiply fast and side-channel-aware.

---

## 2. RSA and the Cryptographic Context

### 2.1 Why RSA works (Euler's theorem in one move)

RSA picks two large primes `p, q`, sets `N = p·q`, computes `φ(N) = (p-1)(q-1)`, chooses a public exponent `e` with `gcd(e, φ(N)) = 1`, and derives the private exponent `d = e^(-1) mod φ(N)`. Encryption is `c = m^e mod N`; decryption is `c^d = m^(ed) mod N`. Because `ed ≡ 1 (mod φ(N))`, write `ed = 1 + k·φ(N)`. Then by Euler's theorem (for `gcd(m, N) = 1`):

```
c^d = m^(ed) = m^(1 + k·φ(N)) = m · (m^(φ(N)))^k ≡ m · 1^k = m (mod N).
```

So decryption recovers the message. The security rests on the difficulty of computing `φ(N)` without knowing the factorization `N = pq` — recovering `φ(N)` is equivalent to factoring `N`.

### 2.2 The `gcd(m, N) > 1` corner

The clean derivation assumed `gcd(m, N) = 1`. For RSA, `N = pq`, so a message `m` divisible by `p` or `q` breaks coprimality. RSA still decrypts correctly even then: by CRT, `m^(ed) ≡ m (mod p)` and `(mod q)` *individually* (each follows from Fermat on the prime, including the `m ≡ 0` case where both sides are `0`), so `m^(ed) ≡ m (mod N)`. This is why RSA uses the **CRT decomposition** for correctness *and* speed — but a message that leaks a factor of `N` is a catastrophic event in practice, mitigated by padding (OAEP) that randomizes `m`.

### 2.3 CRT-RSA for performance

Production RSA never computes `c^d mod N` directly. It computes `m_p = c^(d mod (p-1)) mod p` and `m_q = c^(d mod (q-1)) mod q` (Fermat-reduced exponents on each prime), then recombines via CRT (sibling `05-crt`). This is ~4× faster because exponentiation cost is cubic in the modulus bit-length and each prime is half the bits. The exponent reductions `d mod (p-1)` and `d mod (q-1)` are *direct applications of Fermat's little theorem*.

### 2.3a A concrete toy-RSA trace

Use the textbook `N = 3233 = 61 · 53`, `e = 17`, `φ(N) = 60·52 = 3120`, `d = e^{-1} mod 3120 = 2753`. Encrypt `m = 65`:

```
c = 65^17 mod 3233 = 2790.
```

Decrypt directly: `m = 2790^2753 mod 3233 = 65`. Now decrypt via CRT, the production path:

```
d_p = d mod (p-1) = 2753 mod 60 = 53,   m_p = 2790^53 mod 61 = 4
d_q = d mod (q-1) = 2753 mod 52 = 49,   m_q = 2790^49 mod 53 = 12
CRT recombine (m ≡ 4 mod 61, m ≡ 12 mod 53)  ⟹  m = 65.
```

The two per-prime exponentiations use exponents of half the bit-length, and the CRT glue is a couple of multiplies — the ~4× win. The exponent reductions `d mod (p-1)` and `d mod (q-1)` are Fermat's theorem applied on each prime field; without them you would power by the full `d = 2753`.

### 2.4 Diffie-Hellman and discrete-log siblings

The same group `(ℤ/pℤ)^*` underlies Diffie-Hellman key exchange: a primitive root `g` (order `p-1`) generates the group, and security rests on the discrete-log problem (sibling `11-discrete-log-bsgs`, `12-primitive-root-discrete-root`). The order of an element — always a divisor of `p-1` — determines the size of the subgroup an attacker must search; small-subgroup attacks exploit elements of small order, which is why DH parameters use safe primes `p = 2q + 1`.

### 2.5 Why safe primes block small-subgroup attacks

For a safe prime `p = 2q + 1` (`q` also prime), `p - 1 = 2q`, so by Theorem "order divides `p-1`", every element's order is one of `{1, 2, q, 2q}`. The only *small* orders are `1` (just the identity) and `2` (just `−1`). Any element other than `±1` therefore has order `q` or `2q` — a *large* prime-order subgroup, where the discrete-log attacker's Pohlig-Hellman reduction cannot decompose the problem into small pieces. Concretely with `p = 23 = 2·11 + 1`, `q = 11`: the element `2` has `ord_23(2) = 11 = q` (a generator of the large subgroup), so a DH exchange using `g = 2` lives in an 11-element prime-order subgroup, immune to small-subgroup confinement. Validating that a received public value `Y` satisfies `Y^q ≡ 1` (lies in the prime-order subgroup) and `Y ∉ {1, −1}` is the standard defense — a direct application of element-order reasoning from Euler's theorem.

---

## 3. Exponent Towers and Generalized Euler

### 3.1 The problem

Evaluate `a^(b^c) mod m`, or a tower `a^(a^(a^...)) mod m`, where the exponent is astronomically large. You cannot form the exponent; you must reduce it. Euler gives `a^e ≡ a^(e mod φ(m))` — but **only when `gcd(a, m) = 1`.**

### 3.2 The generalized Euler theorem (lifting past the tail)

For *any* `a` (coprime or not) and `e ≥ log₂ m`:

```
a^e ≡ a^( (e mod φ(m)) + φ(m) )  (mod m).
```

The intuition: write `m = (factors sharing a prime with a) · (coprime part)`. On the coprime part the powers are purely periodic with period dividing `φ(m)`. On the shared part, `a^e ≡ 0` once `e` is large enough (the prime power in `m` is exhausted), and "large enough" means `e ≥ log₂ m`. Adding `φ(m)` to the reduced exponent guarantees we are past this non-periodic tail while preserving the residue mod the periodic part. This `+φ` guard is the single most important trick for towers, because it removes the need to test `gcd(a, m)` at every level.

### 3.3 Recursive tower evaluation

A tower `a_1 ^ (a_2 ^ (a_3 ^ …)) mod m` is evaluated by recursing on the modulus: compute the exponent mod `φ(m)`, that exponent's exponent mod `φ(φ(m))`, and so on. The chain `m, φ(m), φ(φ(m)), …` reaches `1` in `O(log m)` steps (the **iterated totient** shrinks fast), so towers of any height collapse. Each level applies the generalized rule with its `+φ` guard.

### 3.4 Why `φ(φ(φ(…)))` terminates quickly

`φ(m) < m` for `m > 1`, and `φ(m)` is even for `m > 2`, so the iterated totient at least halves every two steps — the chain `m → φ(m) → φ(φ(m)) → … → 1` has length `O(log m)`. This bounds tower recursion depth regardless of tower height; a height-1000 tower mod a 64-bit `m` still terminates in ~60 totient evaluations.

### 3.5 Worked tower: `2^(3^4) mod 100`

`m = 100 = 4·25`, `φ(100) = φ(4)·φ(25) = 2·20 = 40`, `gcd(2, 100) = 2 ≠ 1` (non-coprime — the `+φ` guard matters).

```
inner = 3^4 mod φ(100) = 81 mod 40 = 1
naive (wrong): 2^1 = 2
generalized:   2^(1 + 40) = 2^41 mod 100 = 52.
```

Direct check: `3^4 = 81`, and `2^81 mod 100`. Since `2^81` is divisible by `4` and `2^81 mod 25` cycles with period `ord_25(2) = 20` so `2^81 ≡ 2^(81 mod 20) = 2^1 = 2 (mod 25)`; CRT `(0 mod 4, 2 mod 25)` gives `52`. The generalized rule nailed it; the naive `2` is wrong because the reduced exponent `1` fell inside the tail on the `4`-part of the modulus. This is the single most instructive senior worked example: **the non-coprime base on a composite modulus is exactly where the `+φ` guard is load-bearing.**

### 3.6 Recursive tower with the iterated totient

For a tower `2^(3^(4^5)) mod 100`, recurse: the outer exponent `3^(4^5)` is needed mod `φ(100) = 40`; that needs `4^5` mod `φ(40) = 16`; `4^5 = 1024 ≡ 0 (mod 16)`, but with the `+φ` guard on each level since bases may share factors. The modulus chain `100 → 40 → 16 → 8 → 4 → 2 → 1` has length 6, bounding the recursion regardless of how tall the tower grows — a height-million tower mod `100` still recurses 6 levels.

---

## 4. When the Fermat Inverse Fails

### 4.1 Composite modulus

`a^(m-2) mod m` is the inverse **only** when `m` is prime. For composite `m`, the exponent `m-2` is meaningless; the correct Euler exponent is `φ(m) - 1`, and even that requires `gcd(a, m) = 1`. The silent danger: `a^(m-2) mod m` returns *some* number for composite `m`, just not the inverse — no exception, just a wrong result. Mitigation: gate the Fermat path behind a primality assertion, or default to extended Euclid (sibling `06-extended-euclidean-modular-inverse`), which needs no primality and no factorization.

### 4.2 Non-coprime base

If `gcd(a, m) ≠ 1`, **no inverse exists** — period. `a^(p-2)` returns `0` when `a ≡ 0 (mod p)`, which is not an inverse. Always verify `gcd(a, m) = 1` (or `a mod p ≠ 0` for prime `p`) before claiming an inverse.

### 4.3 The decision matrix

| Modulus | `gcd(a, m)` | Correct inverse | Wrong choice (silent bug) |
|---------|-------------|-----------------|----------------------------|
| prime `p` | `= 1` | `a^(p-2) mod p` (Fermat) | — |
| prime `p` | `≠ 1` (`a ≡ 0`) | **none exists** | `a^(p-2) = 0` looks like an answer |
| composite `m` | `= 1` | extended Euclid, or `a^(φ(m)-1)` | `a^(m-2)` — not the inverse |
| composite `m` | `≠ 1` | **none exists** | any power — garbage |

### 4.4 Carmichael numbers and the FLT test trap

A senior must know that `a^(n-1) ≡ 1 (mod n)` does **not** prove `n` prime. **Carmichael numbers** (561, 1105, 1729, …) satisfy this for *every* `a` coprime to `n` despite being composite. A primality routine built on Fermat alone accepts them. The fix is Miller-Rabin (sibling `08-miller-rabin-primality`), which also checks for nontrivial square roots of 1 and has no composite that fools all bases. Never ship a Fermat-only primality test in security-sensitive code.

### 4.5 A real-world incident shape

The classic production failure: a service computes modular inverses with `pow(a, mod-2, mod)` where `mod` came from configuration. It works for years because `mod` was always the prime `10^9 + 7`. Then someone reuses the helper with `mod = 2^32` (a power of two) for a hashing context — `2^32` is composite, `a^(2^32 − 2)` is not the inverse, and the results are subtly wrong only for *some* inputs (those where the bogus value happens to differ). No exception fires. The fix that would have prevented it: a one-line postcondition `assert (a * inv) % mod == 1` at the call site, which converts a silent data-corruption bug into a loud, immediate failure. This is why senior code asserts the *defining property* of an inverse rather than trusting the formula's precondition to hold.

---

## 5. Carmichael's Function: The Tighter Exponent

### 5.0 Why a tighter exponent is worth the trouble

The universal exponent you fold by determines both correctness margins and performance. `φ(m)` always works, but `λ(m)` is the *minimal* one, and in non-cyclic groups the gap is real (`λ(8) = 2` vs `φ(8) = 4`, a factor of 2; `λ(2^e)` vs `φ(2^e)` grows to a factor of 2 always; products of primes amplify it via lcm-vs-product). Smaller reduction modulus means smaller post-reduction exponents means fewer squarings. In RSA it directly shrinks the private exponent `d`, and a smaller `d` is fewer big-integer multiplies per decryption — measurable at TLS-handshake scale.

### 5.1 `λ(m)` ≤ `φ(m)`

Euler says `a^(φ(m)) ≡ 1`. But `φ(m)` is not always the *smallest* universal exponent. **Carmichael's function** `λ(m)` is the smallest exponent such that `a^(λ(m)) ≡ 1 (mod m)` for *all* `a` coprime to `m`. It satisfies `λ(m) | φ(m)`, with:

```
λ(p^e) = φ(p^e) = p^{e-1}(p-1)   for odd prime p (and for 2, 4)
λ(2^e) = 2^{e-2}                  for e ≥ 3   (NOT φ(2^e) = 2^{e-1})
λ(m)   = lcm of λ over prime-power factors of m.
```

### 5.2 Why it matters

Using `λ(m)` instead of `φ(m)` for exponent reduction gives a **smaller** exponent and, more importantly, is sometimes *necessary*: the generalized exponent rule and certain RSA optimizations key off `λ(N) = lcm(p-1, q-1)`, which can be much smaller than `φ(N) = (p-1)(q-1)`. The standardized RSA private exponent in PKCS#1 uses `λ(N)`, not `φ(N)`, precisely to allow the smallest valid `d`. For exponent reduction the `+λ` lifting rule is the tightest correct form. The catch: the famous `2^e` case (`λ(2^e) = 2^{e-2}`, half of `φ`) trips up implementations that assume `λ = φ`.

### 5.3 Worked `λ` vs `φ` divergence

Take `N = 8 · 9 · 5 = 360`. `φ(360) = φ(8)φ(9)φ(5) = 4·6·4 = 96`, but `λ(360) = lcm(λ(8), λ(9), λ(5)) = lcm(2, 6, 4) = 12`. So Euler's `a^96 ≡ 1` is valid but loose — *every* coprime `a` already satisfies `a^12 ≡ 1`, an eight-fold tighter exponent. For an RSA-like modulus this directly shrinks the private exponent: `d = e^{-1} mod 12` instead of `mod 96`, fewer bits to exponentiate by. The trap is `λ(8) = 2` (not `φ(8) = 4`): an implementation that uses `φ` on the power-of-2 factor would compute `lcm(4, 6, 4) = 12` here *by coincidence* (since `12 = lcm(4,6,4)` too), but for `N = 16·3 = 48`, `λ(48) = lcm(λ(16), λ(3)) = lcm(4, 2) = 4` whereas the buggy `lcm(φ(16), φ(3)) = lcm(8, 2) = 8` is wrong — `a^4 ≡ 1` holds for all coprime `a` mod 48, so `8` is not minimal. Always special-case `λ(2^e) = 2^{e-2}`.

### 5.4 Practical guidance

- For **exponent reduction** of coprime bases, either `φ(m)` or `λ(m)` works; `λ(m)` is tighter.
- For the **generalized `+φ`/`+λ` rule**, use whichever you computed; both are valid past the tail.
- For **RSA key generation**, follow the standard and use `λ(N) = lcm(p-1, q-1)`.
- Computing `λ(m)` needs the factorization of `m`, same as `φ(m)`.

---

## 6. Performance Engineering of Modular Exponentiation

### 6.1 The multiply is the cost

`a^e mod m` does `⌊log₂ e⌋ + popcount(e)` modular multiplies. For a 2048-bit RSA modulus, each multiply is a big-integer operation, and there are ~3000 of them. The levers:

- **Montgomery multiplication** (sibling `14-montgomery-multiplication`): replaces the expensive `mod` (division) with cheap shifts/adds, the standard for crypto-grade exponentiation.
- **Sliding-window / k-ary exponentiation**: precompute small odd powers `a^1, a^3, a^5, …` to cut the number of multiplies by ~20–30% versus plain binary.
- **CRT-RSA** (Section 2.3): halve the modulus bit-length, ~4× speedup.
- **Barrett reduction**: an alternative to Montgomery when the modulus is fixed across many operations.

### 6.2 Overflow safety (fixed-width moduli)

For `m < 2^31` and `int64`, `a*b` of two reduced residues is `< 2^62` — safe. For `m` near `2^63`, the product overflows `int64`; use `__int128` (C/C++), `math/bits.Mul64` (Go), `Math.multiplyHigh` / `BigInteger` (Java), or Montgomery form. Python integers are unbounded, so overflow is a non-issue there, at the cost of slower big-int multiplies.

**The exact safe-modulus boundary.** With signed `int64` (max `≈ 9.22·10^18 = 2^63 − 1`), `a*b` for reduced residues `< m` is at most `(m-1)^2`. That stays in range when `(m-1)^2 < 2^63`, i.e. `m ≤ 3037000499 ≈ 3.04·10^9`. So for the common `10^9 + 7` and `998244353` you are safe with a single `int64` multiply; for moduli above ~`3·10^9` you must use a 128-bit intermediate. A subtle deferred-reduction variant accumulates `t` products before reducing — safe only while `t·(m-1)^2 < 2^63`, so for `m = 10^9` you may accumulate at most `⌊2^63/10^18⌋ ≈ 9` products between reductions; exceeding that silently overflows.

### 6.2a Montgomery vs Barrett at a glance

| Reduction | Best when | Mechanism | Cost per multiply |
|-----------|-----------|-----------|-------------------|
| Schoolbook `% m` | small `m`, few ops | hardware divide | 1 divide (slow) |
| **Montgomery** | many ops, same `m` | work in Montgomery form, divides by `2^k` via shifts | ~2 multiplies, no divide |
| **Barrett** | fixed `m`, occasional ops | precompute `⌊2^{2k}/m⌋`, replace divide with multiply-shift | ~2 multiplies |

For an RSA exponentiation (~3000 multiplies under one fixed modulus), Montgomery wins decisively: the one-time conversion into Montgomery form amortizes, and every inner multiply avoids the expensive division. For a *single* modular multiply, the conversion overhead makes plain `% m` faster. The rule: **Montgomery/Barrett pay off precisely when the same modulus is hit many times** — which is exactly the exponentiation loop and the batched-query service. Sibling `14-montgomery-multiplication` covers the mechanics.

### 6.3 Constant-time and side channels

In cryptographic code, the `if e_bit == 1` branch and data-dependent `mod` leak timing. Constant-time exponentiation (Montgomery ladder, fixed-window with conditional moves) is mandatory for secret exponents (`d` in RSA, private keys in DH). A textbook square-and-multiply is fine for competitive programming but a *vulnerability* in a TLS stack. This is the single most common way Fermat/Euler math becomes a security bug rather than a correctness bug.

### 6.4 Batch inversion

When inverting many residues mod a prime (e.g., normalizing a batch of fractions mod `10^9+7`), do not call `a^(p-2)` per element. Use the **prefix-product trick**: one Fermat inverse plus `O(n)` multiplies inverts all `n` values — turning `O(n log p)` into `O(n + log p)`.

### 6.5 Cost comparison: per-element vs batch inverse

For `n = 10^6` inverses mod `p = 10^9 + 7` (so `log₂ p ≈ 30`):

| Approach | Modular multiplies | Notes |
|----------|--------------------|-------|
| `a^(p-2)` per element | `≈ n · 2·30 = 6·10^7` | one fast power each |
| Prefix-product batch | `≈ 3n + 60 ≈ 3·10^6` | prefix + one inverse + unwind |

The batch approach is ~20× fewer multiplies — the difference between a noticeable pause and an imperceptible one in a hot loop. The "all of `1..n` mod `p`" special case is even cheaper: the linear recurrence `inv[i] = (p − (p/i)·inv[p mod i]) mod p` computes every inverse in `O(n)` total with *no* exponentiation at all, exploiting that `p = (p/i)·i + (p mod i)` rearranges to express `inv[i]` from a smaller already-known inverse.

### 6.6 Choosing `φ` vs `λ` for the reduction modulus at scale

When folding a huge exponent in a hot path, the reduction modulus determines the post-reduction exponent's size and thus the multiply count. Using `λ(m)` over `φ(m)` shaves `log₂(φ/λ)` squarings per exponentiation — small per call, but multiplied across millions of calls it matters. For a fixed modulus reused across requests, precompute `λ(m)` once at startup (it needs the factorization of `m`, an `O(√m)` or Pollard-rho job done a single time) and cache it; never recompute the totient or Carmichael value per request.

---

## 7. Code Examples

Each example below is intentionally small enough to trace by hand against the worked numerics in Sections 2–5, yet structured the way production code is: a guarded inverse, a `+φ`-guarded tower, and a Carmichael-aware batch routine. Read them as templates, not just demos.

### 7.1 Go — generalized Euler exponent reduction (towers, any base)

```go
package main

import "fmt"

func gcd(a, b int64) int64 {
	for b != 0 {
		a, b = b, a%b
	}
	return a
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

// powModBig computes a^E mod m where E is given as a big "value-or-huge" via a
// reducer: here we show the tower a^(b^c) mod m with the +φ generalized rule.
func tower(a, b, c, m int64) int64 {
	if m == 1 {
		return 0
	}
	phi := totient(m)
	inner := powMod(b, c, phi) // b^c mod φ(m)
	// generalized Euler: add φ to clear the non-periodic tail when not coprime
	if gcd(a, m) != 1 {
		return powMod(a, inner+phi, m)
	}
	return powMod(a, inner, m)
}

func main() {
	fmt.Println(tower(2, 3, 4, 1000000007)) // 2^(3^4)=2^81 mod p
	fmt.Println(tower(6, 2, 100, 9))        // base shares factor with 9
}
```

### 7.2 Java — Fermat vs extended-Euclid inverse with a guard

```java
public class SafeInverse {
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

    // Extended Euclid: returns x with a*x ≡ 1 (mod m), or throws if no inverse.
    static long invEuclid(long a, long m) {
        long g = m, x = 0, x1 = 1, r = ((a % m) + m) % m;
        while (r != 0) {
            long q = g / r;
            long tmp = g - q * r; g = r; r = tmp;
            tmp = x - q * x1; x = x1; x1 = tmp;
        }
        if (g != 1) throw new ArithmeticException("no inverse: gcd != 1");
        return ((x % m) + m) % m;
    }

    static long invFermat(long a, long p) { // ASSUMES p prime, a % p != 0
        if (a % p == 0) throw new ArithmeticException("no inverse: a ≡ 0");
        return powMod(a, p - 2, p);
    }

    public static void main(String[] args) {
        System.out.println(invFermat(3, 7));   // 5  (prime)
        System.out.println(invEuclid(3, 10));  // 7  (composite, gcd=1)
        // invFermat(3, 10) would be WRONG — 10 is not prime.
    }
}
```

### 7.3 Python — Carmichael function and batch inverse

```python
from math import gcd
from functools import reduce


def factorize(n):
    f, p = {}, 2
    while p * p <= n:
        while n % p == 0:
            f[p] = f.get(p, 0) + 1
            n //= p
        p += 1
    if n > 1:
        f[n] = f.get(n, 0) + 1
    return f


def lcm(a, b):
    return a // gcd(a, b) * b


def carmichael(m):
    """Carmichael's λ(m): smallest universal exponent (λ | φ)."""
    result = 1
    for p, e in factorize(m).items():
        if p == 2 and e >= 3:
            lam = 1 << (e - 2)          # λ(2^e) = 2^(e-2), NOT 2^(e-1)
        else:
            lam = (p - 1) * p ** (e - 1)  # = φ(p^e)
        result = lcm(result, lam)
    return result


def batch_inverse(vals, p):
    """Invert all vals mod prime p in O(n + log p) via prefix products."""
    n = len(vals)
    prefix = [1] * (n + 1)
    for i, v in enumerate(vals):
        prefix[i + 1] = prefix[i] * v % p
    inv_all = pow(prefix[n], p - 2, p)        # one Fermat inverse
    inv = [0] * n
    for i in range(n - 1, -1, -1):
        inv[i] = inv_all * prefix[i] % p
        inv_all = inv_all * vals[i] % p
    return inv


if __name__ == "__main__":
    print(carmichael(8))    # 2  (φ(8)=4 but λ(8)=2: every odd^2 ≡ 1 mod 8)
    print(carmichael(561))  # 80 (Carmichael number: λ(561) | 560)
    print(batch_inverse([2, 3, 4], 7))  # [4, 5, 2]
```

---

## 8. Observability and Testing

A modular-exponentiation result is opaque — one wrong residue looks like any other number. Build in checks from day one.

| Check | Why |
|-------|-----|
| `pow(a, p-1, p) == 1` for random `a` coprime to prime `p` | Confirms Fermat and the power routine. |
| `pow(a, φ(m), m) == 1` for random coprime `a` | Confirms Euler and the totient. |
| `a * inv(a) % m == 1` | Validates any inverse routine. |
| `totient(m)` vs brute-force coprime count | Catches the distinct-prime bug. |
| `λ(m)` divides `φ(m)`; `a^λ(m) ≡ 1` for all coprime `a` | Validates the Carmichael function. |
| Tower vs direct power on small `m` | `a^(b^c) mod m == pow(a, b**c, m)` when `b^c` is small enough to form. |
| Determinism across Go/Java/Python | Same inputs → identical residues. |

The single most valuable test is comparing the **generalized tower** against a direct `pow(a, b**c, m)` for inputs small enough to materialize `b**c` — it catches the `+φ` guard mistakes and the coprimality misjudgments that account for most tower bugs.

### 8.0a A regression that only the oracle catches

Suppose a refactor "optimizes" the tower by dropping the `+φ` guard whenever `inner != 0` (a plausible-looking shortcut, reasoning that only `inner == 0` is dangerous). It passes for coprime bases and for most random inputs. The oracle exposes it on `a = 6, b = 6, c = 2, m = 9`: `inner = 36 mod φ(9)=6 = 0`... that one is caught. But try `a = 12, b = 2, c = 3, m = 8`: `inner = 8 mod φ(8)=4 = 0` — also caught. The subtle survivor is `a = 6, b = 4, c = 1, m = 9`: `inner = 4 mod 6 = 4 ≠ 0`, buggy path returns `6^4 mod 9 = 0`, and the correct `6^(4+6) mod 9 = 6^10 mod 9 = 0` — *agrees by luck*. The genuinely failing case needs `inner` small but nonzero *and* a base sharing a factor: `a = 6, b = 7, c = 1, m = 9` gives `inner = 7 mod 6 = 1`, buggy `6^1 = 6`, correct `6^(1+6) = 6^7 mod 9 = 0` — **mismatch**. Only a randomized oracle over many `(a,b,c,m)` reliably surfaces it; hand-picked cases miss it. Lesson: keep the `+φ` guard unconditional, and let property tests, not intuition, certify shortcuts.

### 8.1 Property-test battery

```text
for random m in [2, 10^6], random a with gcd(a, m) = 1:
    assert pow(a, totient(m), m) == 1                 # Euler
    assert (a * pow(a, totient(m) - 1, m)) % m == 1   # Euler inverse
for random prime p, random a in [1, p-1]:
    assert pow(a, p - 1, p) == 1                      # Fermat
    assert (a * pow(a, p - 2, p)) % p == 1            # Fermat inverse
for random m, random base a (possibly non-coprime), small b, c:
    assert tower(a, b, c, m) == pow(a, b**c, m)       # generalized rule
```

These invariants, run on a few thousand random instances per CI build, give high confidence. The non-coprime tower assertion is the strongest: it is the case textbook code most often gets wrong.

### 8.2 Production guardrails

For a service exposing modular-arithmetic primitives at scale, add:

- **Inverse postcondition.** After every inverse computation, assert `(a * inv) % m == 1` (cheap, catches composite-modulus and `a ≡ 0` bugs at the call site). Log and reject rather than return a wrong inverse.
- **Coprimality gate.** Reject inverse/reduction requests where `gcd(a, m) != 1` with a clear error rather than silently returning garbage.
- **Cached totient/Carmichael.** Compute `φ(m)` / `λ(m)` once per distinct modulus and cache; recomputing per request both wastes the `O(√m)` factoring and risks divergence if the factorization code changes.
- **Magnitude sanity for exact (CRT) results.** When reconstructing a large exact value across primes, log the expected bit-length so an off-by-a-prime reconstruction stands out.
- **Constant-time flag.** Tag code paths handling secret exponents and route them through the constant-time exponentiation, with a CI check that the variable-time `powMod` is never called on a secret.

### 8.3 The single most valuable end-to-end check

Across Go, Java, and Python implementations, feed the *same* randomized `(a, e, m)` and `(a, b, c, m)` vectors and diff the outputs byte-for-byte. A divergence almost always pinpoints a language-specific overflow (Go/Java `int64` wrap vs Python's bignums) or a `% ` sign difference on negative operands — the two portability bugs that property tests within a single language can miss. This cross-language determinism harness is the cheapest high-coverage test for a multi-language numeric library.

---

## 9. Failure Modes

### 9.1 Fermat inverse on a composite modulus
`a^(m-2) mod m` returns a plausible number that is **not** the inverse. Silent. Mitigation: assert primality, or use extended Euclid by default.

### 9.2 Reducing exponents mod `m` instead of `φ(m)`
A pervasive bug: exponents fold mod the *totient*, never mod the modulus. Mitigation: name the reduction modulus explicitly (`e % phi`), never `e % m`.

### 9.3 Forgetting the `+φ` tail for non-coprime towers
`a^(e mod φ(m))` is wrong when `gcd(a, m) > 1` and `e < φ(m)` after reduction. Mitigation: use `(e mod φ(m)) + φ(m)` whenever `e ≥ log₂ m` and coprimality is not guaranteed.

### 9.4 `λ` vs `φ` for `2^e`
Assuming `λ(2^e) = φ(2^e) = 2^{e-1}` is wrong; `λ(2^e) = 2^{e-2}` for `e ≥ 3`. Mitigation: special-case the power of 2 in the Carmichael routine and unit-test `λ(8) = 2`.

### 9.5 Carmichael numbers fooling a Fermat primality test
`a^(n-1) ≡ 1 (mod n)` for all coprime `a` does not imply `n` prime. Mitigation: use Miller-Rabin (sibling `08`).

### 9.6 Overflow in the multiply
`a*b` overflows `int64` when `m` exceeds ~`2^31.5`. Mitigation: 128-bit multiply, Montgomery form, or big integers.

### 9.7 Timing side channels with secret exponents
Square-and-multiply branches on secret exponent bits, leaking the key. Mitigation: constant-time Montgomery ladder for cryptographic exponents.

### 9.8 Treating `a ≡ 0 (mod p)` as invertible
`pow(0, p-2, p) = 0` is returned without error. Mitigation: guard `a % p != 0` (and generally `gcd(a, m) == 1`) before claiming an inverse.

### 9.9 Computing `φ(m)` by counting per-prime occurrences
A totient routine that applies `(1 − 1/p)` once per *power* of `p` instead of once per *distinct* prime silently halves (or worse) the result for non-squarefree `m`. E.g. `φ(8)`: correct is `4` (one factor `(1 − 1/2)`), the buggy version applies it three times giving `8·½·½·½ = 1`. Mitigation: strip *all* copies of each prime before applying its factor; unit-test on a prime power like `φ(8) = 4`, `φ(27) = 18`.

### 9.10 Using `φ(N)` where `λ(N)` is required, or vice versa
For RSA `d`, the standard mandates `λ(N)`; using `φ(N)` still *works* (yields a valid, larger `d`) but is non-standard and can fail interop with implementations that validate `d < λ(N)`. Conversely, using `λ(m)` for the `+λ` tower guard is fine, but mixing — reducing by `λ` while guarding with `+φ` — is incoherent. Mitigation: pick one universal exponent per computation and use it consistently for both the `mod` and the `+` guard.

### 9.11 Forgetting `e ≥ log₂ m` in the generalized rule
The generalized `a^e ≡ a^((e mod φ(m)) + φ(m))` requires the *true* exponent `e` to be at least `log₂ m` (so the tail is cleared). For genuinely small exponents (e.g. `a^3 mod m` with `m` large), do **not** apply the `+φ` lift — compute `a^3` directly. In tower contexts the exponent is astronomically large so the condition holds automatically, but a guard `if e < some_threshold: direct power` belongs in any general-purpose routine. Mitigation: only lift when the exponent is provably large (towers), else power directly.

---

## 10. Summary

- **RSA is Euler's theorem applied to `N = pq`:** `m^(ed) ≡ m (mod N)` because `ed ≡ 1 (mod φ(N))`; security is the hardness of computing `φ(N)` (equivalently, factoring `N`). Production uses CRT-RSA with Fermat-reduced per-prime exponents for a ~4× speedup.
- **Exponent towers** fold the exponent mod `φ(m)` (coprime) or via the **generalized `+φ` rule** (any base, `e ≥ log₂ m`), recursing through the iterated-totient chain `m → φ(m) → … → 1` of length `O(log m)`.
- **The Fermat inverse `a^(p-2)` fails silently for composite moduli** and for `a ≡ 0`. Use extended Euclid as the unconditional default; gate Fermat behind a primality assertion.
- **Carmichael's `λ(m) | φ(m)`** is the tightest universal exponent; the `2^e` case (`λ = 2^{e-2}`, half of `φ`) is the classic trap, and standardized RSA uses `λ(N) = lcm(p-1, q-1)`.
- **Performance lives in the multiply:** Montgomery/Barrett reduction, sliding-window exponentiation, CRT splitting, and batch inversion; for *secret* exponents, constant-time evaluation is mandatory.
- **Carmichael numbers defeat the Fermat primality test** — never use it alone; use Miller-Rabin.
- **Always keep an oracle:** brute-force totient counts and direct `pow(a, b**c, m)` on small inputs catch nearly every real bug (distinct-prime totient errors, `+φ` tail mistakes, wrong reduction modulus).

### Decision summary

- **Inverse, prime modulus** → Fermat `a^(p-2)` (guard `a ≢ 0`).
- **Inverse, composite modulus** → extended Euclid (no factoring), or `a^(φ(m)-1)` if `φ(m)` known.
- **Exponent reduction, coprime base** → `e mod φ(m)` (or `e mod λ(m)`, tighter).
- **Exponent tower / non-coprime base** → generalized `(e mod φ(m)) + φ(m)`.
- **RSA key generation** → `d = e^(-1) mod λ(N)`, `λ(N) = lcm(p-1, q-1)`; decrypt via CRT.
- **Primality** → Miller-Rabin, never Fermat alone.
- **Secret exponents** → constant-time, side-channel-resistant exponentiation.

### Worked-example index

| Section | Numeric example | Lesson |
|---------|-----------------|--------|
| 2.3a | Toy RSA `N=3233`, direct vs CRT decrypt | CRT-RSA ~4× speedup |
| 2.5 | Safe prime `p=23`, `ord(2)=11` | small-subgroup defense |
| 3.5 | `2^(3^4) mod 100 = 52` | `+φ` guard for non-coprime tower |
| 5.3 | `φ(360)=96` vs `λ(360)=12`; `λ(48)` bug | use `λ`, special-case `2^e` |
| 6.5 | `10^6` inverses: 6·10^7 vs 3·10^6 mults | batch inversion |
| 8.0a | Tower regression surfacing case | unconditional `+φ` guard |
| 4.5 | Inverse helper reused with `mod = 2^32` | assert `a·inv ≡ 1` always |
| 6.2 | Safe-modulus boundary `m ≤ 3.04·10^9` | overflow-free single multiply |

Treat this table as the senior's mental checklist: each row is a place where the clean theorem meets a sharp production edge, and where a missing precondition turns into a silent incident.

References to study further: PKCS#1 / RSA standard (use of `λ(N)`), Montgomery and Barrett reduction (sibling `14-montgomery-multiplication`), CRT (sibling `05-crt`), Miller-Rabin (sibling `08-miller-rabin-primality`), discrete log and primitive roots (siblings `11`, `12`), and extended Euclid inverses (sibling `06`).
