# Extended Euclidean Algorithm & Modular Inverse — Senior Level

> The modular inverse is rarely the bottleneck on small inputs — but the moment the modulus reaches 64 bits, the numbers become cryptographic, the inverse must be computed in constant time to resist timing attacks, or the inverse simply does not exist on adversarial input, every detail (overflow of intermediate products, sign normalization, big-integer cost, branch-free constant-time variants, and graceful handling of non-coprime inputs) becomes a correctness or security incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Overflow and Sign Care](#2-overflow-and-sign-care)
3. [The Coefficient-Growth Bound](#3-the-coefficient-growth-bound)
4. [Big Integers and Cryptographic Sizes](#4-big-integers-and-cryptographic-sizes)
5. [RSA Key Generation](#5-rsa-key-generation)
6. [Constant-Time and Side-Channel Concerns](#6-constant-time-and-side-channel-concerns)
7. [When the Inverse Does Not Exist](#7-when-the-inverse-does-not-exist)
8. [Batch Inversion at Scale](#8-batch-inversion-at-scale)
9. [Code Examples](#9-code-examples)
10. [A Debugging Walkthrough](#10-a-debugging-walkthrough)
11. [Observability and Testing](#11-observability-and-testing)
12. [Failure Modes](#12-failure-modes)
13. [Summary](#13-summary)

---

## 1. Introduction

At the senior level the question is no longer "why does Bezout give the inverse" but "what system am I building, and what breaks when I scale or harden it?". The extended Euclidean algorithm and the modular inverse show up in three production guises that look different but share one engine:

1. **Modular-arithmetic pipelines** — combinatorics mod a prime, hashing, polynomial arithmetic, where a single forgotten sign or overflow corrupts every downstream result.
2. **Cryptography** — RSA key generation computes the private exponent `d = e⁻¹ mod φ(n)`; the inverse here is over numbers hundreds to thousands of bits long, must be exact, and ideally computed without leaking timing.
3. **Computer algebra** — solving congruences, CRT reconstruction, rational reconstruction, where extended Euclid's *coefficients* (not just the gcd) are the deliverable.

All three reduce to: *run extended Euclid on `(a, m)`, gate on `gcd = 1` (or `gcd | b`), normalize the sign, and return the canonical residue.* The senior-level decisions are: how to keep intermediate products from overflowing, how to handle multi-thousand-bit operands, how to make the routine constant-time when adversaries can measure it, and how to behave correctly when the inverse genuinely does not exist.

This document treats those decisions in production terms.

---

## 2. Overflow and Sign Care

### 2.1 The two coefficient products

The iterative update `old_s, s = s, old_s - q*s` involves the product `q*s`. With 64-bit operands, `q` and `s` can each approach `m`, so `q*s` can reach `~m²`, which overflows `int64` once `m` exceeds `~2^31`. Two defenses:

- **128-bit intermediate:** compute `q*s` in `__int128` (C/C++/Rust), `math/bits.Mul64` plus manual handling (Go), or `BigInteger`/`Math.multiplyHigh` (Java). Python is immune (arbitrary precision).
- **Bounded coefficients:** when you only need the *inverse* (not the raw Bezout `y`), the coefficient `x` stays bounded by `m/2` in absolute value throughout the run (a classical bound), so `q*x` fits if you reduce intermediate `x` mod `m`. But reducing mid-run subtly changes the invariant; the safe, simple choice is a 128-bit product.

### 2.2 Sign normalization

The raw Bezout `x` is frequently negative. Normalize once at the end: `((x % m) + m) % m`. Two senior gotchas:

- In Go and Java, `%` follows the sign of the dividend, so `(-3) % 11 == -3`. The double-mod idiom `((x % m) + m) % m` fixes it; a single `% m` does not.
- When `m` is `int64`-max-adjacent, `(x % m) + m` can itself overflow. Use unsigned arithmetic or a 128-bit add, or branch: `if x < 0 { x += m }` after a single `% m` (valid because one `% m` brings `x` into `(-m, m)`).

### 2.3 The multiplication after inversion

Once you have `inv`, the very next operation is usually `(value * inv) % m`. That product overflows for the same reason. Use `mulmod` (128-bit product then reduce) consistently; a single naive `value * inv` is the most common silent bug in modular pipelines.

### 2.4 A concrete overflow walkthrough

Take `m = 4_000_000_007` (just above `2^31`). Two reduced residues near `m` multiply to nearly `1.6·10^19`, which **exceeds** `int64`'s max of `≈ 9.2·10^18`. So even `(value * inv)` of two valid residues overflows silently, wrapping to a wrong (often negative) value, and `% m` of that garbage is garbage. The fix:

```text
mulmod(a, b, m):           # safe for m up to ~2^63
    return (a as 128-bit) * (b as 128-bit) % m
```

In Go: `new(big.Int).Mul(...)` or `bits.Mul64` + `bits.Div64`. In Java: `Math.multiplyHigh` or `BigInteger`. In Rust/C++: `__int128`. Python: native ints, immune. The rule: in any modular pipeline with `m > 2^31`, *every* product crossing the modulus boundary goes through `mulmod`. Auditing for this single pattern eliminates the most common class of "works for small inputs, wrong for big ones" bugs.

---

## 3. The Coefficient-Growth Bound

The single most important fact for deciding *whether* you can stay in fixed-width arithmetic is the bound on how large the Bezout coefficients ever get. It is not a heuristic — it is a tight theorem, and it tells you exactly when `int64` is safe and when it is not.

### 3.1 The statement

Run extended Euclid on `(a, b)` with `a, b > 0`, `g = gcd(a, b)`. Let `(x, y)` be the coefficients the standard algorithm returns (the *minimal* pair). Then:

```
|x| ≤ b / (2g)        and        |y| ≤ a / (2g)
```

The factor `2` is real: the intermediate coefficients `sᵢ` and `tᵢ` produced by the iteration never exceed `b` and `a` in magnitude, and the *final* pair is bounded by half that. The two sequences `sᵢ` and `tᵢ` also strictly alternate in sign and grow monotonically in absolute value, which is why the *last* nonzero-remainder row holds the largest-but-still-bounded coefficients.

### 3.2 The practical consequence

For a modular inverse you call `extgcd(a, m)`, so the inverse-bearing coefficient `x` satisfies `|x| ≤ m / 2`. That means:

- The *returned* `x` always fits in the same width as `m`. After normalization `((x % m) + m) % m`, the inverse lives in `[0, m)`. So storing the inverse is never the overflow risk.
- The overflow risk is **purely in the intermediate product `q*s`** during the iteration, not in the final coefficients. Since `q` can be as large as `a/b` early on and `s` can approach `m`, the product `q*s` can reach roughly `m²`. *That* is what overflows `int64` for `m > 2³¹`, even though every individual coefficient fits.

This is the key senior insight: the *coefficients* are bounded by `m`, but the *products formed while computing them* are bounded by `~m²`. You can safely store results in 64 bits for `m` up to `2⁶³`, but you must compute the intermediate products in 128 bits once `m > 2³¹`.

### 3.3 Fibonacci is the worst case

The iteration count (and the slow growth of coefficients) is maximized when `a` and `b` are consecutive Fibonacci numbers `F(k+1), F(k)` — the same worst case as plain Euclid (Lamé's theorem: the number of steps is `O(log_φ min(a,b))`, where `φ` is the golden ratio). For such inputs the coefficients climb to roughly `F(k-1)` and `F(k)`, i.e. right up against the `b/2`, `a/2` ceiling. A property test that feeds Fibonacci pairs exercises both the maximum step count and the maximum coefficient magnitude in one shot — a high-value fuzz seed.

### 3.4 Using the bound to pick a type

| Modulus range | Coefficient storage | Intermediate `q*s` product | Verdict |
|---------------|--------------------|----------------------------|---------|
| `m ≤ 2³¹` | `int64` safe | `int64` safe (`< 2⁶²`) | plain `int64` everywhere |
| `2³¹ < m ≤ 2⁶³` | `int64` safe (`|x| ≤ m/2`) | needs 128-bit (`~m²`) | results in `int64`, products in `__int128`/`big` |
| `m > 2⁶³` | needs big integer | needs big integer | full big-integer path |

This table is the decision an engineer actually makes. The bound `|x| ≤ m/2` is what justifies the middle row — it is *safe* to keep the inverse in `int64` for moduli up to `2⁶³`, provided the arithmetic that produces it is done wider.

---

## 4. Big Integers and Cryptographic Sizes

### 3.1 Why fixed-width breaks

RSA moduli are 2048–4096 bits. `int64` is hopeless. You must use a big-integer library (`math/big` in Go, `BigInteger` in Java, native `int` in Python). The extended Euclidean algorithm is unchanged in structure, but each `q = a/b`, `r = a%b`, and `q*s` is now a big-integer operation costing `O(L²)` (schoolbook) or `O(L log L)` (with fast multiplication) for `L`-bit operands.

### 3.2 Complexity at scale

For `L`-bit inputs, extended Euclid does `O(L)` division steps, each `O(L)` to `O(L²)` depending on the divide implementation, giving `O(L²)` to `O(L³)` total in the naive analysis. The **binary GCD (Stein's algorithm)** and its extended variant avoid divisions, using only shifts and subtractions — often faster in practice for big integers because shifts are cheap. For very large `L`, **half-GCD** (a divide-and-conquer recursion) achieves `O(L log² L)` and is what high-performance libraries use.

### 3.3 Library inverse functions exist — use them

`math/big.Int.ModInverse`, `BigInteger.modInverse`, and Python's `pow(a, -1, m)` (3.8+) are battle-tested, handle signs and existence, and are usually faster and safer than a hand-rolled big-integer extended Euclid. **In production, prefer the library inverse** unless you specifically need the Bezout coefficients or a constant-time guarantee the library does not provide. Hand-rolling is for learning and for the constant-time case.

---

## 5. RSA Key Generation

The marquee application of the modular inverse is computing the RSA private exponent.

### 5.1 The role of the inverse

RSA picks two large primes `p, q`, sets `n = p·q`, and `φ(n) = (p-1)(q-1)`. It chooses a public exponent `e` coprime to `φ(n)` (commonly `65537`). The **private exponent** is

```
d = e⁻¹ mod φ(n)
```

— exactly a modular inverse. Encryption is `c = m^e mod n`; decryption is `m = c^d mod n`, correct because `e·d ≡ 1 (mod φ(n))` makes `(m^e)^d ≡ m`. The entire scheme hinges on the inverse existing, which is guaranteed by choosing `e` coprime to `φ(n)`.

### 5.2 Why extended Euclid, not Fermat, here

`φ(n)` is composite (it is `(p-1)(q-1)`), so Fermat's `e^(φ(n)-2)` does **not** apply — there is no prime modulus. Extended Euclid (or the library `modInverse`) is the correct tool. Many textbooks use the **Carmichael function** `λ(n) = lcm(p-1, q-1)` instead of `φ(n)`; the inverse `d = e⁻¹ mod λ(n)` is smaller and equally valid. Either way it is a modular inverse over a composite modulus.

### 5.3 CRT-RSA decryption

Production RSA decryption uses CRT for a ~4× speedup: precompute `dp = d mod (p-1)`, `dq = d mod (q-1)`, and `qinv = q⁻¹ mod p` (another modular inverse). Then decrypt mod `p` and mod `q` separately and recombine via CRT. The inverse `qinv` is computed once at key-setup time with extended Euclid. This is the single most common real-world appearance of the modular inverse on the hot path of a cryptosystem.

### 5.4 Validation at key-gen

After computing `d`, assert `(e * d) % φ(n) == 1`. A key generated with a wrong `d` produces silent decryption failures (or, worse, a subtly broken key). This one-line check belongs in every key generator.

---

## 6. Constant-Time and Side-Channel Concerns

### 6.1 Why extended Euclid leaks

The number of iterations of extended Euclid depends on the *values* of `a` and `m` (worst case when they are consecutive Fibonacci numbers). The quotients `q` vary, and branches like `if x < 0` are data-dependent. An attacker who can measure the *time* of an inverse computation involving a secret can recover information about that secret. This matters when inverting a secret value (e.g., in ECDSA signing, where the nonce inverse `k⁻¹` is computed every signature).

### 6.2 Constant-time alternatives

- **Fermat / Euler exponentiation:** `a⁻¹ = a^(p-2) mod p` (prime) computed with a *constant-time* modular exponentiation (fixed square-and-multiply ladder, no early exit) leaks nothing about `a` through iteration count, because the exponent `p-2` is fixed and public. This is the standard constant-time inverse in cryptographic libraries when the modulus is a fixed prime (e.g., a curve order).
- **Binary GCD with constant-time conditional swaps:** the "safegcd" / Bernstein-Yang algorithm computes a constant-time modular inverse for general moduli, used in modern crypto libraries (e.g., libsecp256k1). It runs a fixed number of iterations regardless of input.

### 6.3 The trade-off

The plain extended Euclid is the *fastest* general inverse but is **variable-time**. For secret operands, accept the constant-factor slowdown of Fermat-exponentiation (prime modulus) or safegcd (general) to close the timing channel. For public operands (e.g., precomputing a public constant's inverse at startup), the leak is irrelevant and plain extended Euclid is fine.

---

## 7. When the Inverse Does Not Exist

### 7.1 The gate

The inverse of `a` mod `m` exists **iff `gcd(a, m) = 1`**. A production inverse function must return a *typed* failure (an `error`, `Optional`, `None`, or a boolean flag) — never a sentinel that could be mistaken for a valid residue. Returning `0` for "no inverse" is a footgun because `0` is a legal residue.

### 7.2 Adversarial and accidental non-coprimality

- In hashing or randomized algorithms, `a` might accidentally share a factor with `m` (especially if `m` is composite). The code must detect `g ≠ 1` and recover (rehash, pick a new `a`, or fail loudly).
- In RSA, if `gcd(e, φ(n)) ≠ 1`, key generation must reject `e` and retry — never proceed with a non-invertible exponent.
- A subtle case: `a ≡ 0 (mod m)` has `gcd(0, m) = m ≠ 1`, so `0` is never invertible. Special-case it for a clear error.

### 7.3 The general congruence fallback

When `gcd(a, m) = g > 1`, the equation `a·x ≡ b (mod m)` may *still* be solvable if `g | b` (then `g` solutions exist; see `middle.md`). A robust solver does not just give up on `g ≠ 1` — it checks divisibility and returns the full solution set. Conflating "no inverse" with "no solution" is a correctness bug: `6·x ≡ 8 (mod 10)` has no *inverse* of `6` but does have solutions `{3, 8}`.

---

## 8. Batch Inversion at Scale

### 8.1 Montgomery's trick: n inverses with one inversion

When you need the inverses of `n` *arbitrary* (not contiguous) field elements `a₁, …, aₙ`, you can do it with **one** modular inversion plus `3(n-1)` multiplications, via **Montgomery's batch inversion**:

```
prefix[0] = a₁
prefix[i] = prefix[i-1] * a_{i+1}        (running products)
inv_all   = (prefix[n-1])^{-1}           (the ONE inversion)
walk back: a_i^{-1} = inv_all * prefix[i-1]; inv_all *= a_i
```

Since modular inversion (`O(log m)`) is far costlier than multiplication (`O(1)` mulmod), this turns `n` inversions into effectively one. It is heavily used in elliptic-curve cryptography (batch point normalization) and FFT-based polynomial arithmetic. This differs from the `O(n)` table of `middle.md`: the table inverts the *contiguous* range `1..n` mod a prime via the `-(m/i)·inv[m%i]` recurrence; Montgomery's trick inverts *arbitrary* elements.

### 8.2 Choosing between the two batch methods

| Need | Method | Cost |
|------|--------|------|
| inverses of `1..n` mod prime `p > n` | table recurrence `-(p/i)·inv[p%i]` | `O(n)`, no inversions |
| inverses of arbitrary `a₁..aₙ` | Montgomery batch trick | `1` inversion + `O(n)` mults |
| factorials' inverses `0!..n!` | invert `n!` once, walk down `inv[(i-1)!] = inv[i!]·i` | `1` inversion + `O(n)` mults |

The factorial-inverse pattern (third row) is the everyday competitive-programming idiom for binomial coefficients mod a prime: one inverse, then a backward sweep.

---

## 9. Code Examples

### 9.1 Go — overflow-safe iterative inverse with `__int128`-style product

```go
package main

import (
	"fmt"
	"math/big"
)

// extgcdSafe uses big.Int internally to avoid 64-bit overflow on q*s products.
func modInverseSafe(a, m int64) (int64, bool) {
	A := big.NewInt(((a % m) + m) % m)
	M := big.NewInt(m)
	inv := new(big.Int).ModInverse(A, M) // nil if gcd(a, m) != 1
	if inv == nil {
		return 0, false
	}
	return inv.Int64(), true
}

func main() {
	inv, ok := modInverseSafe(3, 1_000_000_007)
	fmt.Println("3^-1 mod 1e9+7 =", inv, ok) // 333333336 true
	v, _ := modInverseSafe(3, 11)
	fmt.Println("3^-1 mod 11 =", v) // 4
	_, ok2 := modInverseSafe(4, 6)  // gcd(4,6)=2
	fmt.Println("4^-1 mod 6 exists:", ok2) // false
}
```

### 9.2 Java — RSA key-gen inverse with explicit validation

```java
import java.math.BigInteger;
import java.security.SecureRandom;

public class RsaKeyGen {
    public static void main(String[] args) {
        SecureRandom rnd = new SecureRandom();
        BigInteger p = BigInteger.probablePrime(512, rnd);
        BigInteger q = BigInteger.probablePrime(512, rnd);
        BigInteger n = p.multiply(q);
        BigInteger phi = p.subtract(BigInteger.ONE).multiply(q.subtract(BigInteger.ONE));
        BigInteger e = BigInteger.valueOf(65537);

        // e must be coprime to phi; retry if not (rare for 65537)
        if (!e.gcd(phi).equals(BigInteger.ONE)) {
            throw new IllegalStateException("e not coprime to phi(n); pick another e");
        }
        // private exponent d = e^{-1} mod phi(n) — the modular inverse
        BigInteger d = e.modInverse(phi);

        // VALIDATION: e*d must be ≡ 1 (mod phi)
        if (!e.multiply(d).mod(phi).equals(BigInteger.ONE)) {
            throw new AssertionError("key generation produced a wrong inverse");
        }
        System.out.println("d (private exponent) has " + d.bitLength() + " bits; e*d ≡ 1 mod phi ✓");
    }
}
```

### 9.3 Python — Montgomery batch inversion of arbitrary elements

```python
def batch_inverse(elems, m):
    """Inverse of every element with a SINGLE modular inversion (Montgomery's trick)."""
    n = len(elems)
    prefix = [1] * (n + 1)
    for i in range(n):
        prefix[i + 1] = prefix[i] * elems[i] % m
    inv_all = pow(prefix[n], -1, m)            # the one and only inversion
    result = [0] * n
    for i in range(n - 1, -1, -1):
        result[i] = inv_all * prefix[i] % m
        inv_all = inv_all * elems[i] % m
    return result


if __name__ == "__main__":
    p = 1_000_000_007
    xs = [3, 7, 12, 99, 100000]
    invs = batch_inverse(xs, p)
    for x, ix in zip(xs, invs):
        assert x * ix % p == 1
    print("all", len(xs), "inverses verified with ONE inversion:", invs)
```

### 9.4 Go — Montgomery batch inversion with safe `mulmod`

```go
package main

import (
	"fmt"
	"math/big"
)

func mulmod(a, b, m uint64) uint64 {
	// 128-bit product via big.Int keeps this correct for m up to 2^63.
	res := new(big.Int).Mul(new(big.Int).SetUint64(a), new(big.Int).SetUint64(b))
	return res.Mod(res, new(big.Int).SetUint64(m)).Uint64()
}

func modInverse(a, m uint64) (uint64, bool) {
	inv := new(big.Int).ModInverse(new(big.Int).SetUint64(a), new(big.Int).SetUint64(m))
	if inv == nil {
		return 0, false
	}
	return inv.Uint64(), true
}

// batchInverse: inverses of all elems with ONE modular inversion (Montgomery trick).
func batchInverse(elems []uint64, m uint64) ([]uint64, bool) {
	n := len(elems)
	prefix := make([]uint64, n+1)
	prefix[0] = 1
	for i := 0; i < n; i++ {
		prefix[i+1] = mulmod(prefix[i], elems[i], m)
	}
	invAll, ok := modInverse(prefix[n], m) // the single inversion
	if !ok {
		return nil, false // some element shares a factor with m
	}
	res := make([]uint64, n)
	for i := n - 1; i >= 0; i-- {
		res[i] = mulmod(invAll, prefix[i], m)
		invAll = mulmod(invAll, elems[i], m)
	}
	return res, true
}

func main() {
	const p = uint64(1_000_000_007)
	xs := []uint64{3, 7, 12, 99, 100000}
	invs, ok := batchInverse(xs, p)
	fmt.Println("ok:", ok)
	for i, x := range xs {
		fmt.Printf("%d^-1 = %d  (check %d)\n", x, invs[i], mulmod(x, invs[i], p))
	}
}
```

### 9.5 Java — overflow-safe iterative inverse and the coefficient-bound check

```java
import java.math.BigInteger;

public class SafeInverse {
    // Iterative extended Euclid in long; intermediate q*s done in 128-bit via BigInteger
    // only where it could overflow. Returns {g, x, y} with a*x + b*y = g.
    static long[] extgcd(long a, long b) {
        long oldR = a, r = b;
        long oldS = 1, s = 0;
        long oldT = 0, t = 1;
        while (r != 0) {
            long q = oldR / r;
            long[] next = step(oldR, r, q); oldR = next[0]; r = next[1];
            long[] ns  = step(oldS, s, q); oldS = ns[0];  s = ns[1];
            long[] nt  = step(oldT, t, q); oldT = nt[0];  t = nt[1];
        }
        return new long[]{oldR, oldS, oldT};
    }

    // returns {old, old - q*cur} computing q*cur safely
    static long[] step(long oldV, long cur, long q) {
        long prod = BigInteger.valueOf(q).multiply(BigInteger.valueOf(cur)).longValueExact();
        return new long[]{cur, oldV - prod};
    }

    static long modInverse(long a, long m) {
        long[] r = extgcd(((a % m) + m) % m, m);
        if (r[0] != 1) throw new ArithmeticException("no inverse: gcd != 1");
        long x = r[1];
        // Coefficient-bound check: |x| must be <= m/2 (Section 3 invariant).
        assert Math.abs(x) <= m / 2 + 1 : "coefficient bound violated";
        return ((x % m) + m) % m;
    }

    public static void main(String[] args) {
        long m = 1_000_000_007L;
        long inv = modInverse(3, m);
        System.out.println("3^-1 mod 1e9+7 = " + inv);            // 333333336
        System.out.println("check: " + (3L * inv % m));            // 1
    }
}
```

---

## 10. A Debugging Walkthrough

A modular inverse that is *wrong* almost never crashes — it returns a plausible-looking number that poisons everything downstream. This is a reconstruction of a real failure mode and how to localize it.

### 10.1 The symptom

A combinatorics service computes `C(n, k) mod m` and started returning wrong answers — but only for some inputs, and only after the modulus was changed from `1_000_000_007` to `4_000_000_007` (a larger prime above `2³¹`). Small `n, k` were fine; large ones were garbage. Unit tests with `m = 1e9+7` all passed; production with the new modulus did not.

### 10.2 Step 1 — reproduce with the inverse identity

The first move is **not** to read the binomial code; it is to test the inverse in isolation with its definitional check:

```text
for a in {2, 3, 99, m-1}:
    inv = mod_inverse(a, m)
    assert (a * inv) % m == 1     # FAILS for m = 4_000_000_007
```

The assertion fails. So the bug is in the inverse (or the multiply that checks it), not in the factorial precompute. This immediately cuts the search space in half.

### 10.3 Step 2 — bisect: is it the inverse or the multiply?

Compute `inv` once and inspect it directly. The returned `inv` is in `[0, m)` and *equals* the value `pow(a, -1, m)` from a big-integer oracle. So **the inverse itself is correct.** The failure is in the *checking multiply* `(a * inv) % m`: with `m ≈ 4·10⁹`, the product `a * inv` can reach `~1.6·10¹⁹`, which overflows signed 64-bit (`max ≈ 9.2·10¹⁸`). The overflow wraps to a negative number, and `% m` of that is wrong.

### 10.4 Step 3 — find every unprotected product

The real bug is not one line; it is a *class* of lines. Grep the module for every `*` adjacent to a `% m` and audit each:

```text
fact[i]   = fact[i-1] * i % m          # overflows: fact[i-1] and i both < m
C         = fact[n] * invfact[k] % m   # overflows: two near-m residues
check     = a * inv % m                # overflows (the one we caught first)
```

All three form a product of two values that can each approach `m ≈ 4·10⁹`, so each product can hit `~1.6·10¹⁹` and overflow. The `m = 1e9+7` tests passed because two residues below `10⁹` multiply to below `10¹⁸`, which *fits* in `int64` — the bug was latent and only the larger modulus exposed it.

### 10.5 Step 4 — the fix and the regression guard

Route every cross-modulus product through a `mulmod` (128-bit intermediate). Then add a regression test that pins the failure: run the *same* property battery with a modulus **above** `2³¹` (e.g. `4_000_000_007`), not just `1e9+7`. The lesson is that the test modulus must be chosen to *trigger* overflow; a modulus under `2³¹·... ` that keeps products under `2⁶³` will never catch this class of bug.

### 10.6 The general debugging recipe

1. **Test the inverse in isolation** with `(a*inv) % m == 1` before suspecting any caller.
2. **Separate "inverse wrong" from "multiply wrong"** by comparing against a big-integer oracle (`pow(a,-1,m)`).
3. **Audit the whole class** of unprotected products, not just the first one you find.
4. **Pin the bug with a test whose modulus exceeds `2³¹`** so the overflow actually fires.
5. Prefer the library inverse and a single audited `mulmod` over hand-rolled arithmetic on the hot path.

---

## 11. Observability and Testing

A modular-inverse result is opaque — a wrong residue looks like any other number. Build in checks from day one.

| Check | Why |
|-------|-----|
| `(a * inv) % m == 1` | The definitive inverse test; cheap, foolproof. |
| `gcd(a, m) == 1` gate returns typed failure | Confirms non-existence is handled, not papered over. |
| Bezout identity `a*x + m*y == g` | Property test for extended Euclid itself. |
| Sign normalization `0 <= inv < m` | Catches the missing double-mod. |
| Cross-check Fermat vs extended Euclid (prime mod) | Two independent methods must agree. |
| Congruence solutions plugged back into `a*x ≡ b` | Validates the full solution set, not just `x0`. |
| RSA `e*d ≡ 1 (mod φ)` | Key-gen correctness, prevents silent decryption failure. |

### 11.1 A property-test battery

```text
for random a, m with gcd(a, m) = 1:
    inv = mod_inverse(a, m)
    assert 0 <= inv < m
    assert (a * inv) % m == 1
for random a, m with gcd(a, m) > 1:
    assert mod_inverse(a, m) is None         # non-existence handled
for random a, b, m:
    g, x, y = extgcd(a, m)
    assert a*x + m*y == g                     # Bezout identity holds
    sols = solve_congruence(a, b, m)
    for s in sols: assert (a * s) % m == (b % m)
    assert (len(sols) == 0) == (b % g != 0)   # solvability iff g | b
```

These invariants, run on thousands of random instances, give high confidence. The `(a*inv) % m == 1` test alone catches the overwhelming majority of bugs (sign, overflow, wrong method).

### 11.2 Production guardrails

For a service computing inverses (e.g., a crypto or combinatorics microservice), add: an **assertion** that `(a*inv) % m == 1` on every result in debug builds; an **input validator** rejecting `m <= 0` and `a ≡ 0 (mod m)`; and, for the constant-time path, a **timing test** confirming the inverse routine's runtime is independent of the secret operand.

---

## 12. Failure Modes

### 12.1 Silent overflow in `q*s`

The coefficient product overflows `int64` for `m > 2^31`. Mitigation: 128-bit intermediate products, or use the library big-integer `ModInverse`. Symptom: inverses that fail the `(a*inv) % m == 1` check only for large `m`.

### 12.2 Missing sign normalization

Returning the raw negative Bezout `x` poisons every downstream multiply. Mitigation: `((x % m) + m) % m` at the boundary; never expose a negative residue.

### 12.3 Fermat on a composite modulus

`a^(m-2)` is the inverse *only* for prime `m`. Using it on `φ(n)` or any composite gives a wrong number that passes no check. Mitigation: extended Euclid (or library inverse) for any non-prime modulus; gate Fermat behind a "modulus is prime" precondition.

### 12.4 Treating "no inverse" as "no solution"

`gcd(a, m) > 1` means no *inverse*, but `a·x ≡ b (mod m)` may still have `g` solutions if `g | b`. Mitigation: the general congruence solver checks divisibility and returns all solutions; do not short-circuit on `g ≠ 1`.

### 12.5 Returning `0` for "no inverse"

`0` is a valid residue, so a `0` sentinel is indistinguishable from a legitimate answer in some contexts. Mitigation: return a typed `Optional`/`None`/`error`, never an in-band sentinel.

### 12.6 Timing side channel on secret operands

Plain extended Euclid's iteration count leaks information about secret inputs. Mitigation: constant-time Fermat-exponentiation (prime mod) or safegcd (general) when the operand is secret; plain extended Euclid only for public operands.

### 12.7 Composite-modulus inverse-table corruption

The `O(n)` table recurrence assumes every `i ≤ n` is invertible, which fails for composite `m`. Mitigation: require a prime modulus `p > n`; for composite moduli, fall back to per-element extended Euclid with existence checks.

### 12.8 Off-by-one in the floor quotient

Using truncated-toward-zero division for negative operands breaks the invariant `a = q·b + r` with `0 ≤ r < b`. Mitigation: ensure operands are non-negative before the loop (`a %= m` normalized), or use a floor-division helper. This survives small tests and only bites on negative inputs.

---

## 13. Summary

- The modular inverse is `a⁻¹` with `a·a⁻¹ ≡ 1 (mod m)`, computable from extended Euclid's Bezout `x`; it exists **iff `gcd(a, m) = 1`**, and a production function must return a *typed* failure otherwise — never an in-band sentinel.
- **Overflow** (the `q*s` and post-inversion `value*inv` products) and **sign normalization** (`((x % m) + m) % m`, beware single-`%`) are the two everyday correctness traps for 64-bit moduli; use 128-bit products or a big-integer library.
- At **cryptographic sizes**, use the library big-integer inverse (`ModInverse` / `modInverse` / `pow(a, -1, m)`); it handles signs, existence, and is fast (half-GCD internally). Hand-roll only for learning or constant-time needs.
- **RSA** computes `d = e⁻¹ mod φ(n)` (composite modulus → extended Euclid, not Fermat) and `qinv = q⁻¹ mod p` for CRT decryption; validate `e·d ≡ 1 (mod φ)` at key-gen.
- For **secret operands**, plain extended Euclid leaks via iteration count; switch to constant-time Fermat-exponentiation (prime mod) or safegcd (general). For public operands, plain extended Euclid is fine.
- **Batch inversion**: the `O(n)` table handles the contiguous range `1..n` mod a prime; **Montgomery's trick** inverts arbitrary elements with a single inversion plus `O(n)` multiplications — the everyday idiom for factorial inverses and EC point normalization.
- **Always test `(a*inv) % m == 1`**; it catches the sign, overflow, and wrong-method bugs that account for nearly every real failure.

### Decision summary

- **Single inverse, prime modulus, public operand** → Fermat `a^(p-2)` or extended Euclid.
- **Single inverse, composite modulus** → extended Euclid / library inverse (Fermat does not apply).
- **Single inverse, secret operand** → constant-time Fermat (prime) or safegcd (general).
- **All inverses `1..n` mod prime** → `O(n)` table recurrence.
- **Arbitrary batch of inverses** → Montgomery's one-inversion trick.
- **Solve `a·x ≡ b (mod m)`** → extended Euclid, check `g | b`, return all `g` solutions.
- **Cryptographic sizes** → big-integer library inverse, validated.

References to study further: Bernstein-Yang "safegcd" constant-time inversion, Montgomery batch inversion, the Carmichael function `λ(n)` for RSA, half-GCD and Stein's binary GCD, and sibling topics `05-gcd-lcm-euclidean`, `07-linear-diophantine`, and `08-chinese-remainder-theorem`.
