# Modular Arithmetic — Middle Level

> **Focus:** The working algorithms you reach for daily — overflow-safe `mulmod`, modular exponentiation, modular **inverse** by both Fermat (prime modulus) and extended Euclid (any coprime modulus), modular **division**, and precomputed factorials + inverse factorials for `nCr mod p` in O(1) per query. Plus a clear-eyed account of why **prime** moduli are so much friendlier than composite ones.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Overflow-Safe Multiplication](#overflow-safe-multiplication)
4. [Modular Exponentiation](#modular-exponentiation)
5. [Modular Inverse: Fermat vs Extended Euclid](#modular-inverse-fermat-vs-extended-euclid)
6. [Modular Division](#modular-division)
7. [Binomial Coefficients nCr mod p](#binomial-coefficients-ncr-mod-p)
8. [Comparison with Alternatives](#comparison-with-alternatives)
9. [Code Examples](#code-examples)
10. [Error Handling](#error-handling)
11. [Performance Analysis](#performance-analysis)
12. [Best Practices](#best-practices)
13. [Visual Animation](#visual-animation)
14. [Summary](#summary)

---

## Introduction

At junior level the message was: keep numbers in `[0, m)` and respect the three pitfalls (negatives, overflow, division). At middle level you assemble those primitives into the **toolkit** that real problems demand:

- How do I multiply two near-`m` values when `m` itself is near `10^18` and the product overflows 64 bits?
- How do I raise a number to a huge power mod `m` without computing the (astronomical) exact power?
- How do I "divide" mod `m` — and what is a **modular inverse**, when does it exist, and which of the two standard ways to compute it should I use?
- How do I compute binomial coefficients `nCr mod p` for `n` up to `10^6` and answer thousands of queries in `O(1)` each?

The unifying theme is the **modular inverse**: it is what makes division possible, what powers `nCr mod p`, and the place where the prime-vs-composite distinction bites hardest. We cover both standard inverse algorithms — Fermat's little theorem (a one-line modpow, but **prime modulus only**) and the extended Euclidean algorithm (works for **any** coprime modulus) — and explain exactly when to use each.

---

## Deeper Concepts

### Why a prime modulus is so friendly

When `m = p` is prime, **every** nonzero residue is coprime to `p`, so **every** nonzero element has an inverse. The structure `Z/pZ` is then a **field** (sibling `professional.md` proves this): you can add, subtract, multiply, and divide freely, exactly like rational arithmetic, with the single exception that you cannot divide by `0`. This is why `10^9 + 7` and `998244353` are the canonical competitive-programming moduli — both are prime, so Fermat's little theorem gives inverses in one modpow and nothing ever lacks an inverse except `0`.

When `m` is **composite**, `Z/mZ` is only a ring. The invertible elements (the **units**) are exactly those coprime to `m`, and there are `φ(m)` of them (Euler's totient). Any element sharing a factor with `m` — like `2` mod `4`, or `6` mod `9` — has **no inverse**. You cannot divide by it, and Fermat's formula `a^(m−2)` is simply wrong (it relies on `m` being prime). For composite `m` you must use the extended Euclidean inverse, and even then only for coprime `a`.

**Concrete contrast.** Mod the prime `7`: every nonzero element `{1,2,3,4,5,6}` has an inverse (`1↔1, 2↔4, 3↔5, 6↔6`), so any "fraction" mod 7 is well-defined. Mod the composite `8`: only `{1,3,5,7}` (the odds, coprime to 8) are units — `φ(8) = 4` — while `2, 4, 6` have no inverse. Trying `2⁻¹ mod 8` fails: no `x` gives `2x ≡ 1 (mod 8)`, because `2x` is always even and `1` is odd. This is the single most important practical difference between prime and composite moduli, and the reason competitive problems almost always pick a prime.

### The inverse as the engine of division

Modular **division** `a / b (mod m)` is defined as `a · b⁻¹ (mod m)`, where `b⁻¹` is the modular inverse of `b`. There is no other notion of division here — you never use the `/` operator on residues. Everything reduces to: *can I invert `b`?* (yes iff `gcd(b, m) = 1`), and *how do I invert it?* (Fermat for prime `m`, extended Euclid otherwise).

### Fermat's little theorem (the prime shortcut)

For a **prime** `p` and any `a` with `p ∤ a`:

```
a^(p−1) ≡ 1 (mod p)        (Fermat's little theorem)
⟹  a · a^(p−2) ≡ 1 (mod p)
⟹  a⁻¹ ≡ a^(p−2) (mod p)
```

So the inverse is a single modular exponentiation, `O(log p)`. Sibling `04-fermat-euler` proves this; here we just use it. (The generalization to composite `m` is **Euler's theorem**: `a^(φ(m)) ≡ 1 (mod m)` for coprime `a`, giving `a⁻¹ ≡ a^(φ(m)−1)`, but you need `φ(m)`, i.e. `m`'s factorization.)

**Worked Fermat inverse.** Invert `2` mod the prime `p = 10^9 + 7`. By Fermat, `2⁻¹ ≡ 2^(p−2) (mod p)`. There is a shortcut for inverting `2`: since `p` is odd, `(p+1)/2` is an integer and `2·(p+1)/2 = p+1 ≡ 1 (mod p)`, so `2⁻¹ = (p+1)/2 = 500 000 004`. Check via modpow: `2^(p−2) mod p` also yields `500 000 004`, and `2·500 000 004 = 1 000 000 008 ≡ 1 (mod p)`. Both routes agree, illustrating that the Fermat formula and the closed form give the same unique inverse (a useful unit test).

### Extended Euclid (the general method)

The extended Euclidean algorithm finds integers `x, y` with `a·x + m·y = gcd(a, m)`. When `gcd(a, m) = 1`, reducing `a·x ≡ 1 (mod m)` shows `x` (normalized to `[0, m)`) is the inverse. This works for **any** modulus, prime or composite, as long as `a` is coprime to `m`. Full derivation in sibling `06-extended-euclidean-modular-inverse`.

**Worked extended-Euclid inverse.** Invert `a = 3` mod `m = 26` (composite, so Fermat does not apply). Run the gcd tracking coefficients:

| step | equation | gcd-of |
|------|----------|--------|
| 1 | `26 = 8·3 + 2` | `(26, 3)` |
| 2 | `3 = 1·2 + 1` | `(3, 2)` |
| 3 | `2 = 2·1 + 0` | `gcd = 1` |

Back-substitute: `1 = 3 − 1·2 = 3 − 1·(26 − 8·3) = 9·3 − 1·26`. So `9·3 ≡ 1 (mod 26)`, and the inverse is `9`. Check: `3·9 = 27 = 26 + 1 ≡ 1 (mod 26)`. Because `26` is composite, only extended Euclid (not Fermat) gives this — a concrete reason to keep the general algorithm in your toolkit.

---

## Overflow-Safe Multiplication

`mulmod(a, b, m)` must return `(a·b) mod m` even when `a·b` exceeds the integer width. Three production-grade strategies:

1. **`__int128` (C/C++ only):** `(__int128)a * b % m`. One instruction-level 128-bit multiply, then reduce. Fastest and cleanest for `m < 2^63`. Go and Java lack a native 128-bit int, so they use the alternatives below (or `math/bits.Mul64` in Go, `Math.multiplyHigh` in Java 9+).
2. **Russian-peasant (binary) `mulmod`:** double-and-add. `O(log b)` additions mod `m`, each safe because a sum of two values `< m` is `< 2m < 2^63`. Works in any language, for any `m < 2^62`.
3. **Floating-point trick (`mulmod` à la Schrage):** compute `a*b - floor(a*b/m)*m` using `long double` to estimate the quotient. Fast but needs careful rounding analysis; used in some Miller-Rabin / Pollard-rho implementations (siblings `08`, `09`).

For the everyday `m = 10^9 + 7`, none of this is needed — a 64-bit `(a*b) % m` is exact because the product is `< 10^18 < 2^63`. The machinery matters when `m` approaches `10^18`.

**Worked overflow check.** With `m = 10^9 + 7`, the largest operands are `m − 1 ≈ 10^9`, so `(m−1)² ≈ 10^18`, safely below `2^63 − 1 ≈ 9.2 × 10^18`. A plain `(a*b) % m` is correct. Now take `m ≈ 5 × 10^18`: operands up to `5 × 10^18` give a product up to `2.5 × 10^37`, which overflows 64-bit by 18+ orders of magnitude — the naive multiply silently wraps. Russian-peasant trace for `(3·5) mod 7` shows the safe path: start `result = 0, a = 3, b = 5 = 101₂`; bit0=1 → `result = 3`, double `a = 6`; bit1=0 → skip, double `a = 12 ≡ 5`; bit2=1 → `result = (3 + 5) % 7 = 1`. And `15 mod 7 = 1` ✓. Every intermediate stayed below `2m`.

---

## Modular Exponentiation

Computing `a^b mod m` by multiplying `a` into an accumulator `b` times is `O(b)` — hopeless for `b = 10^18`. **Binary exponentiation** (square-and-multiply) does it in `O(log b)` by reading the bits of `b`:

```
powMod(a, b, m):
    result = 1
    a = a mod m
    while b > 0:
        if b is odd: result = (result · a) mod m
        a = (a · a) mod m        # square
        b = b >> 1
    return result
```

Each squaring doubles the exponent represented; multiplying in when a bit is set assembles `a^b` from `a^(2^0), a^(2^1), …`. This is the workhorse behind Fermat inverses and is treated fully in sibling `26-binary-exponentiation`. Note: use a safe `mulmod` inside if `m` is large.

**Worked modpow.** Compute `2^10 mod 1000`. Binary: `10 = 1010₂`. Powers: `2^1=2, 2^2=4, 2^4=16, 2^8=256` (all mod 1000). Bits set at positions `1` and `3` (value `2` and `8`): `result = 2^2 · 2^8 = 4 · 256 = 1024 ≡ 24 (mod 1000)`. Indeed `2^10 = 1024`, and `1024 mod 1000 = 24`. The loop did 3 squarings and 2 multiplies — `O(log b)` — versus 10 multiplications for the naive approach. For `b = 10^18` this is ~60 operations instead of a quintillion.

---

## Modular Inverse: Fermat vs Extended Euclid

| Aspect | Fermat (`a^(m−2)`) | Extended Euclid |
|--------|--------------------|-----------------|
| Modulus requirement | `m` must be **prime** | any `m` with `gcd(a, m) = 1` |
| Method | one modpow, `O(log m)` | one gcd run, `O(log m)` |
| Code size | tiny (reuses `powMod`) | a bit longer (recursion/loop) |
| Fails when | `m` composite, or `a ≡ 0` | `gcd(a, m) ≠ 1` |
| Typical use | competitive `nCr mod p`, prime moduli | CRT, composite moduli, RSA key math |
| Constant factor | `log m` multiplications | `~log m` divisions (often a touch faster) |

**Decision rule:** if the modulus is a known prime, Fermat is the one-liner. If the modulus is composite, unknown, or you cannot guarantee primality, use extended Euclid. For inverting *many* numbers `1..n` mod a prime, neither beats the **batch inverse-factorial trick** below (`O(n)` total).

---

## Modular Division

```
a / b (mod m) = a · inv(b) (mod m)
```

Two ways to get `inv(b)`:

- `inv(b) = powMod(b, m−2, m)` when `m` is prime (Fermat).
- `inv(b) = extgcd-based inverse` for any coprime `m`.

Always guard `b ≢ 0 (mod m)` first — `0` has no inverse, and dividing by it is undefined. If `b` is *non-coprime* to a composite `m`, division is genuinely undefined (no unique answer); that is a modeling error, not something to paper over.

**Worked modular division.** Compute `(7 / 3) mod 11`. First `3⁻¹ mod 11`: by Fermat `3⁻¹ = 3^9 mod 11 = 4` (since `3·4 = 12 ≡ 1`). Then `7/3 ≡ 7·4 = 28 ≡ 6 (mod 11)`. Sanity: `6·3 = 18 ≡ 7 (mod 11)`, confirming `6` is indeed `7/3`. Note that `7/3` is not an integer in ordinary arithmetic, yet modulo a prime it has a perfectly well-defined value — because every nonzero element of `Z/11Z` is invertible. This is the field property at work: "fractions" become concrete residues.

### Linear inverses of 1..n in O(n)

When you need the inverses of *all* of `1, 2, …, n` mod a prime `p`, neither Fermat-per-element (`O(n log p)`) nor extended-Euclid-per-element is optimal. A linear recurrence computes them all in `O(n)`:

```
inv[1] = 1
inv[i] = (p − (p / i) * inv[p mod i]) % p     for i = 2..n
```

The recurrence comes from writing `p = (p/i)·i + (p mod i)`, reducing mod `p` to `0 ≡ (p/i)·i + (p mod i)`, and multiplying through by `inv[i]·inv[p mod i]`. This is the batch trick behind fast inverse-factorial *alternatives* and any problem needing many small inverses at once — `O(n)` total instead of `O(n log p)`.

---

## Binomial Coefficients nCr mod p

The classic application that ties everything together. We want `C(n, r) = n! / (r! (n−r)!) mod p` for a **prime** `p`, possibly for many `(n, r)` pairs. You cannot divide factorials directly — you multiply by inverse factorials.

**Precompute (once, `O(n)`):**

```
fact[0] = 1
fact[i] = fact[i−1] · i            mod p        for i = 1..N
invfact[N] = powMod(fact[N], p−2, p)            # one Fermat inverse
invfact[i] = invfact[i+1] · (i+1)  mod p        for i = N−1 .. 0
```

The clever step is computing `invfact` **backwards** from `invfact[N]` using the identity `invfact[i] = invfact[i+1] · (i+1)`. This needs only **one** modular inverse for the whole table, not `N` of them — turning `O(N log p)` into `O(N)`.

**Why the backward identity holds.** By definition `invfact[i] = (i!)⁻¹` and `invfact[i+1] = ((i+1)!)⁻¹`. Since `(i+1)! = (i+1)·i!`, taking inverses gives `((i+1)!)⁻¹ = (i+1)⁻¹·(i!)⁻¹`, i.e. `invfact[i+1] = (i+1)⁻¹·invfact[i]`. Multiplying both sides by `(i+1)`: `invfact[i+1]·(i+1) = invfact[i]`. So each step multiplies by the integer `(i+1)` — no inverse needed after the first. This is the single most important micro-optimization in competitive combinatorics: it removes a factor of `log p` from the precompute and makes million-query `nCr` solutions feasible.

**Each query (`O(1)`):**

```
C(n, r) = fact[n] · invfact[r] · invfact[n−r]   mod p     (0 ≤ r ≤ n ≤ N)
```

This is the standard combinatorics-mod-p engine; see also sibling `21-binomial-coefficients`. (For `n` larger than the prime, you need **Lucas' theorem** — out of scope here, covered in sibling `21`.)

**Worked `nCr` trace.** Compute `C(5, 2) mod (10^9 + 7)`. Precomputed: `fact[5] = 120`, `fact[2] = 2`, `fact[3] = 6`. Inverse factorials: `invfact[5] = 120⁻¹`, and via the backward pass `invfact[2]` and `invfact[3]`. The query is `fact[5]·invfact[2]·invfact[3] = 120·(2⁻¹)·(6⁻¹) mod p`. Since `120/(2·6) = 120/12 = 10`, the modular product collapses to `10` — matching `C(5,2) = 10`. Concretely, `2⁻¹ = 500 000 004`, `6⁻¹ = 166 666 668`, and `120·500000004·166666668 ≡ 10 (mod 10^9+7)`. The factorials and inverse factorials were each computed once; this query touched three array slots and did two multiplies — `O(1)`.

**Validation tip.** Always cross-check `nCr mod p` against an exact big-integer `comb(n, r) % p` (Python `math.comb`, Java `BigInteger`) for small `(n, r)`. A mismatch usually means a missing `% p` in the factorial loop, an off-by-one in the table size `N`, or a forgotten `r > n → 0` guard.

---

## Comparison with Alternatives

### Inverting one number vs many

| Need | Best tool | Cost |
|------|-----------|------|
| One inverse, prime `m` | Fermat `a^(m−2)` | `O(log m)` |
| One inverse, composite coprime `m` | extended Euclid | `O(log m)` |
| Inverses of `1..n`, prime `m` | linear-sieve inverse recurrence `inv[i] = −(m/i)·inv[m mod i] mod m` | `O(n)` total |
| Inverse factorials `0..n` | one Fermat inverse + backward pass | `O(n)` total |

The "invert everything in `O(n)`" tricks (the `inv[i]` recurrence and the inverse-factorial backward pass) are the reason `nCr mod p` queries are `O(1)` after an `O(n)` precompute, rather than `O(log p)` per query.

### Prime vs composite modulus

| Property | Prime `p` | Composite `m` |
|----------|-----------|---------------|
| Every nonzero element invertible? | yes (field) | no (only the `φ(m)` units) |
| Inverse method | Fermat or extended Euclid | extended Euclid only (Fermat invalid) |
| `nCr mod m` directly | yes | needs CRT over prime-power factors (sibling `05-crt`) |
| Division by any nonzero | always defined | only when coprime to `m` |

---

## Code Examples

### Example: modpow, both inverses, division, and nCr mod p

#### Go

```go
package main

import "fmt"

const MOD = 1_000_000_007

func powMod(a, b, m int64) int64 {
	a %= m
	if a < 0 {
		a += m
	}
	var result int64 = 1
	for b > 0 {
		if b&1 == 1 {
			result = result * a % m
		}
		a = a * a % m
		b >>= 1
	}
	return result
}

// Fermat inverse: requires prime modulus.
func invFermat(a, p int64) int64 {
	return powMod(a, p-2, p)
}

// Extended Euclid inverse: any coprime modulus. Returns inverse in [0, m).
func invEuclid(a, m int64) int64 {
	g, x := extgcd(((a%m)+m)%m, m)
	if g != 1 {
		panic("no inverse: a and m not coprime")
	}
	return ((x % m) + m) % m
}

func extgcd(a, b int64) (g, x int64) {
	if b == 0 {
		return a, 1
	}
	g, x1 := extgcd(b, a%b)
	return g, x1 - (a/b)*xHelper(b, a%b)
}

// helper to keep extgcd readable: recompute the y coefficient
func xHelper(a, b int64) int64 {
	if b == 0 {
		return 0
	}
	_, x1 := extgcd(b, a%b)
	return x1
}

func divMod(a, b, m int64) int64 {
	return a % m * invFermat(b, m) % m
}

func main() {
	fmt.Println(powMod(3, 13, 7))        // 3
	fmt.Println(invFermat(2, MOD))       // (MOD+1)/2
	fmt.Println(invEuclid(3, 26))        // 9, since 3*9 = 27 ≡ 1 (mod 26)
	fmt.Println(divMod(10, 2, MOD))      // 5
	fmt.Println(nCr(10, 3))              // 120
}

const N = 1000
var fact, invfact [N + 1]int64

func initFact() {
	fact[0] = 1
	for i := 1; i <= N; i++ {
		fact[i] = fact[i-1] * int64(i) % MOD
	}
	invfact[N] = invFermat(fact[N], MOD)
	for i := N - 1; i >= 0; i-- {
		invfact[i] = invfact[i+1] * int64(i+1) % MOD
	}
}

func nCr(n, r int) int64 {
	if fact[1] == 0 {
		initFact()
	}
	if r < 0 || r > n {
		return 0
	}
	return fact[n] * invfact[r] % MOD * invfact[n-r] % MOD
}
```

#### Java

```java
public class ModToolkit {
    static final long MOD = 1_000_000_007L;
    static final int N = 1000;
    static long[] fact = new long[N + 1], invfact = new long[N + 1];

    static long powMod(long a, long b, long m) {
        a %= m; if (a < 0) a += m;
        long result = 1;
        while (b > 0) {
            if ((b & 1) == 1) result = result * a % m;
            a = a * a % m;
            b >>= 1;
        }
        return result;
    }

    static long invFermat(long a, long p) { return powMod(a, p - 2, p); }

    // Extended Euclid: returns {gcd, x, y} with a*x + b*y = gcd.
    static long[] extgcd(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extgcd(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }

    static long invEuclid(long a, long m) {
        a = ((a % m) + m) % m;
        long[] r = extgcd(a, m);
        if (r[0] != 1) throw new ArithmeticException("no inverse");
        return ((r[1] % m) + m) % m;
    }

    static long divMod(long a, long b, long m) {
        return a % m * invFermat(b, m) % m;
    }

    static void initFact() {
        fact[0] = 1;
        for (int i = 1; i <= N; i++) fact[i] = fact[i - 1] * i % MOD;
        invfact[N] = invFermat(fact[N], MOD);
        for (int i = N - 1; i >= 0; i--) invfact[i] = invfact[i + 1] * (i + 1) % MOD;
    }

    static long nCr(int n, int r) {
        if (r < 0 || r > n) return 0;
        return fact[n] * invfact[r] % MOD * invfact[n - r] % MOD;
    }

    public static void main(String[] args) {
        initFact();
        System.out.println(powMod(3, 13, 7));   // 3
        System.out.println(invEuclid(3, 26));    // 9
        System.out.println(divMod(10, 2, MOD));  // 5
        System.out.println(nCr(10, 3));          // 120
    }
}
```

#### Python

```python
MOD = 1_000_000_007


def pow_mod(a, b, m):
    return pow(a % m, b, m)  # Python's built-in 3-arg pow is binary exponentiation


def inv_fermat(a, p):
    return pow(a, p - 2, p)  # prime p only


def ext_gcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = ext_gcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


def inv_euclid(a, m):
    a %= m
    g, x, _ = ext_gcd(a, m)
    if g != 1:
        raise ValueError("no inverse: not coprime")
    return x % m


def div_mod(a, b, m):
    return a % m * inv_fermat(b, m) % m


N = 1000
fact = [1] * (N + 1)
for i in range(1, N + 1):
    fact[i] = fact[i - 1] * i % MOD
invfact = [1] * (N + 1)
invfact[N] = inv_fermat(fact[N], MOD)
for i in range(N - 1, -1, -1):
    invfact[i] = invfact[i + 1] * (i + 1) % MOD


def nCr(n, r):
    if r < 0 or r > n:
        return 0
    return fact[n] * invfact[r] % MOD * invfact[n - r] % MOD


if __name__ == "__main__":
    print(pow_mod(3, 13, 7))     # 3
    print(inv_euclid(3, 26))     # 9
    print(div_mod(10, 2, MOD))   # 5
    print(nCr(10, 3))            # 120
```

**Run:** `go run main.go` | `javac ModToolkit.java && java ModToolkit` | `python toolkit.py`

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| `invFermat` on composite `m` | `a^(m−2)` is not the inverse. | Use extended Euclid for composite `m`. |
| Inverting `a` with `gcd(a, m) ≠ 1` | No inverse exists; extgcd returns `g ≠ 1`. | Check the gcd and raise/handle. |
| `nCr` with `r > n` or `r < 0` | Out-of-range factorial index. | Return `0` for invalid `(n, r)`. |
| `powMod` with negative base | `a % m` negative in Go/Java. | Normalize `a` to `[0, m)` first. |
| `mulmod` overflow for big `m` | `a*b` exceeds 64 bits. | Use `__int128` or Russian-peasant. |
| Forgetting to precompute `fact` | `nCr` reads zeros. | Initialize the tables once at startup. |

---

## Performance Analysis

| Operation | Cost | Notes |
|-----------|------|-------|
| `powMod(a, b, m)` | `O(log b)` mults | ~60 iterations for `b = 10^18`. |
| Fermat inverse | `O(log m)` | one `powMod(a, m−2, m)`. |
| Extended Euclid inverse | `O(log m)` | often a slightly smaller constant. |
| Precompute `fact` + `invfact` `0..N` | `O(N)` | **one** inverse total (backward pass). |
| Each `nCr` query | `O(1)` | three table lookups + two mults. |
| Russian-peasant `mulmod` | `O(log b)` adds | only when `__int128` unavailable and `m` large. |

The decisive optimization is the **single-inverse factorial table**: inverting `fact[N]` once and walking backwards gives all inverse factorials in `O(N)`, so a million `nCr` queries cost a million `O(1)` lookups, not a million modpows.

```python
# Quick sanity benchmark sketch
import time
def bench(num_queries=10**6):
    start = time.perf_counter()
    s = 0
    for i in range(num_queries):
        s = (s + nCr(1000, i % 1001)) % MOD
    return time.perf_counter() - start
# Typically well under a second: each query is O(1).
```

---

## Best Practices

- **Pick a prime modulus** when you control it — Fermat inverses and field structure simplify everything.
- **One inverse for the whole factorial table** — never invert each factorial separately.
- **Guard coprimality** before any inverse; `gcd ≠ 1` means no inverse, full stop.
- **Use a safe `mulmod`** (or `__int128`) whenever `m` can exceed ~`3 × 10^9`.
- **Reuse `powMod`** for Fermat inverses; keep `mulmod`, `powMod`, `inv` as small tested units.
- **Validate against brute force** on small inputs (compute `nCr` exactly with big integers and compare mod `p`).
- **Handle the `r > n` and `r < 0` cases** in `nCr` by returning `0`, before indexing the factorial tables.
- **Normalize negative bases** in `powMod` (`a %= m; if (a < 0) a += m;`) so Go/Java do not feed a negative into the loop.
- **Prefer the `O(n)` inverse recurrence** over per-element modpow when you need many small inverses at once.

### Common middle-level bugs and their tells

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `nCr` off by a huge amount | missing `% p` in factorial loop | reduce every multiply |
| `nCr` returns 0 unexpectedly | tables not initialized | call `initFact()` once at startup |
| inverse wrong for composite `m` | used Fermat on composite modulus | switch to extended Euclid |
| `mulmod` wrong for big `m` | product overflowed 64-bit | use `__int128` / Russian-peasant |
| negative result in Go/Java | base or subtraction went negative | normalize with `((x % m) + m) % m` |

These five account for the overwhelming majority of middle-level modular bugs; the brute-force oracle catches every one.
A good habit is to keep a tiny exact-arithmetic checker (Python `pow(a, -1, m)`, `math.comb`) beside the modular code and assert agreement on random small inputs in tests.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-relevant parts of the animation show:
> - The **square-and-multiply** ladder of `a^b mod m`, with each squaring and each "multiply-in" highlighted as the bits of `b` are read.
> - The **wrap-around** of products on the number wheel, motivating why `mulmod` must reduce as it goes.
> - Editable `a`, `b`, `m` so you can watch a Fermat inverse `a^(m−2)` assemble step by step.

---

## Summary

The middle-level modular toolkit is built on the **modular inverse**. Division is multiplication by an inverse; binomial coefficients are products of factorials and inverse factorials; and the inverse itself comes from either **Fermat's little theorem** (`a^(m−2)`, a single `O(log m)` modpow, valid only for **prime** `m`) or the **extended Euclidean algorithm** (valid for any coprime `m`). Overflow in `mulmod` is handled by `__int128` or a Russian-peasant loop; exponentiation is always binary (`O(log b)`). For `nCr mod p`, precompute factorials and — with a single inverse plus a backward pass — inverse factorials in `O(n)`, then answer each query in `O(1)`. The recurring lesson: **prime moduli make `Z/pZ` a field** where everything nonzero is invertible, while composite moduli leave non-invertible elements that break Fermat and forbid division.

### Quick decision guide

- **Need one inverse, prime modulus** → Fermat `a^(p−2)`, one `powMod`.
- **Need one inverse, composite/unknown modulus** → extended Euclid (check `gcd = 1`).
- **Need inverses of `1..n` mod a prime** → the `O(n)` linear recurrence.
- **Need `nCr mod p` for many queries** → precompute `fact` + `invfact` (one inverse), `O(1)` per query.
- **Large modulus (≈ `10^18`)** → overflow-safe `mulmod` (`__int128` or Russian-peasant) inside every multiply.
- **Composite modulus, need division/`nCr`** → factor and use CRT (senior level), not the prime recipe.

Internalize these six cases and you can route almost any middle-level modular task to the right tool without rederiving it each time.
