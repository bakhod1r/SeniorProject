# Modular Arithmetic — Interview Preparation

Modular arithmetic is one of the most reliable interview topics because it tests a small set of crisp facts — *congruence, the negative-mod fix, overflow-safe multiplication, fast exponentiation, and the modular inverse* — and then probes whether you can compose them into real solutions (`a^b mod m`, `a⁻¹ mod m`, `nCr mod p`, overflow-safe sums and products). It also separates candidates who know *why* a prime modulus is special (`Z/pZ` is a field) from those who only memorized `a^(m−2)`. This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Reduce any `x` to `[0, m)` | `((x % m) + m) % m` | `O(1)` |
| `(a − b) mod m` (negative-safe) | `((a − b) % m + m) % m` | `O(1)` |
| `(a · b) mod m`, `m ≈ 10^9` | `(a*b) % m` (64-bit product) | `O(1)` |
| `(a · b) mod m`, `m ≈ 10^18` | `__int128` / Russian-peasant | `O(1)` / `O(log b)` |
| `a^b mod m` | binary exponentiation | `O(log b)` |
| `a⁻¹ mod m`, `m` prime | `a^(m−2) mod m` (Fermat) | `O(log m)` |
| `a⁻¹ mod m`, any coprime `m` | extended Euclid | `O(log m)` |
| `a / b mod m` | `a · b⁻¹ mod m` | `O(log m)` |
| `nCr mod p` after `O(n)` precompute | `fact·invfact·invfact` | `O(1)` / query |

Key facts to lead with:

```text
- a ≡ b (mod m)  ⟺  m | (a − b)  ⟺  same remainder
- + , − , × all respect congruence: reduce mod m at ANY time.
- Negatives: ((x % m) + m) % m   (Go/Java/C/C++ % keeps the sign of the dividend).
- Inverse exists  ⟺  gcd(a, m) = 1.   0 is never invertible.
- m prime ⟹ Z/pZ is a field: every nonzero element invertible, Fermat applies.
```

Core algorithms:

```text
powMod(a, b, m):
    r = 1; a %= m
    while b > 0:
        if b & 1: r = r*a % m
        a = a*a % m
        b >>= 1
    return r

inv(a, m) = powMod(a, m-2, m)        # Fermat, prime m only
```

---

## Junior Questions (12 Q&A)

### J1. What does `a ≡ b (mod m)` mean?
`a` and `b` leave the same remainder when divided by `m`; equivalently `m` divides `a − b`. They lie in the same residue class — the same "slot" on a clock of `m` positions.

### J2. Why can we reduce mod `m` in the middle of a computation?
Because congruence is *compatible* with `+`, `−`, `×`: if you replace any operand by a congruent value, the final result stays in the same residue class. So `(a·b) mod m = ((a mod m)·(b mod m)) mod m`, which keeps numbers small.

### J3. What is the modulus typically chosen in problems, and why?
Usually a prime like `10^9 + 7` or `998244353`. Primes make `Z/pZ` a field (every nonzero element invertible), so Fermat's inverse `a^(p−2)` always works and division never fails except by 0.

### J4. What is the negative-mod pitfall?
In Go/Java/C/C++, `%` returns a result with the sign of the dividend, so `(-7) % 5 = -2`, not `3`. If you expect a value in `[0, m)`, normalize with `((x % m) + m) % m`. Python's `%` already returns non-negative for positive `m`.

### J5. How do you compute `(a − b) mod m` safely?
`((a − b) % m + m) % m`. The subtraction can go negative; adding `m` then taking `% m` brings it back into `[0, m)`.

### J6. When can `(a * b) % m` overflow?
When the product `a·b` exceeds the integer width before the `%`. Two values near `10^9` multiply to ~`10^18`, which fits in signed 64-bit. But if `m` is near `10^18`, the product can reach `10^36` and overflows — then you need `__int128` or a Russian-peasant `mulmod`.

### J7. What is a modular inverse?
`a⁻¹` is the value with `a · a⁻¹ ≡ 1 (mod m)`. It lets you "divide": `a / b ≡ a · b⁻¹`. It exists exactly when `gcd(a, m) = 1`.

### J8. How do you compute `a^b mod m` for large `b`?
Binary exponentiation (square-and-multiply): square `a` repeatedly and multiply into the result when the current bit of `b` is set. `O(log b)` multiplications instead of `O(b)`.

### J9. Why not compute `a^b` first and then take mod?
`a^b` is astronomically large — it overflows any fixed-width integer (and is slow even with big integers). Reducing mod `m` after every multiply keeps everything in `[0, m)`.

### J10. Does every element have an inverse mod `m`?
Only the elements coprime to `m`. For a prime `m = p`, every nonzero element is coprime to `p`, so all are invertible. For composite `m`, elements sharing a factor with `m` (and `0`) have no inverse.

### J11. What is `0^0` and `0^b` mod `m`?
By convention `0^0 = 1`; `0^b = 0` for `b > 0`. Decide and document this in your `powMod`.

### J12 (analysis). Why is binary exponentiation `O(log b)`?
Each squaring doubles the exponent represented, so reaching `a^b` takes `⌊log₂ b⌋` squarings plus at most that many multiplies for the set bits of `b`. Naive repeated multiplication is `O(b)` — exponentially worse.

---

## Middle Questions (12 Q&A)

### M1. State and use Fermat's little theorem for inverses.
For prime `p` and `p ∤ a`: `a^(p−1) ≡ 1 (mod p)`, so `a⁻¹ ≡ a^(p−2) (mod p)`. One `powMod`, `O(log p)`. Valid **only** for prime `p`.

### M2. How do you invert a number for a composite modulus?
Use the extended Euclidean algorithm: find `x, y` with `ax + my = gcd(a, m)`. If `gcd = 1`, then `x mod m` is the inverse. Works for any coprime modulus; Fermat does not apply to composite `m`.

### M3. Compute `nCr mod p` for many queries efficiently.
Precompute `fact[0..N]` and `invfact[0..N]` in `O(N)` (one Fermat inverse for `fact[N]`, then a backward pass `invfact[i] = invfact[i+1]·(i+1)`). Each query is `O(1)`: `fact[n]·invfact[r]·invfact[n−r] mod p`.

### M4. Why only one inverse for the whole inverse-factorial table?
Because `invfact[i] = invfact[i+1]·(i+1)`: invert only `fact[N]`, then walk backward multiplying. This turns `O(N log p)` (inverting each) into `O(N)`.

### M5. How does an overflow-safe `mulmod` work without `__int128`?
Russian-peasant: double-and-add. `result = 0`; while `b > 0`, if `b` odd add `a` (mod `m`), then double `a` (mod `m`) and halve `b`. Each intermediate sum is `< 2m`, never overflowing for `m < 2^62`. `O(log b)`.

### M6. What's the difference between Fermat and extended Euclid for inverses?
Fermat: one modpow, **prime modulus only**, tiny code. Extended Euclid: one gcd run, **any coprime modulus**, slightly more code (often a touch faster constant). Use Fermat for known primes, extended Euclid otherwise.

### M7. Why is a prime modulus "nicer" than a composite one?
For prime `p`, `Z/pZ` is a field: every nonzero element is invertible, division is always defined, and there are no zero divisors. Composite `m` has non-invertible elements and zero divisors (`2·3 ≡ 0 mod 6`), so division and `nCr mod m` can fail.

### M8. How do you do modular division `a / b mod m`?
Multiply by the inverse: `a · b⁻¹ mod m`. Guard `b ≢ 0` first. There is no other division — never use the `/` operator on residues.

### M9. Generalize Fermat to composite moduli.
Euler's theorem: `a^(φ(m)) ≡ 1 (mod m)` for `gcd(a, m) = 1`, so `a⁻¹ ≡ a^(φ(m)−1)`. But you need `φ(m)`, i.e. the factorization of `m`. For prime `p`, `φ(p) = p − 1`, recovering Fermat.

### M10. Why does `(a*b) % m` work for `m = 10^9 + 7` but not `m = 10^18`?
Two values `< m` multiply to `< m²`. For `m ≈ 10^9`, `m² ≈ 10^18 < 2^63`, fits 64-bit. For `m ≈ 10^18`, `m² ≈ 10^36 ≫ 2^63`, overflows — need a 128-bit intermediate.

### M11. What is the safest way to handle subtraction in a tight modular loop?
Wrap it in a `subMod` helper that applies `((a − b) % m + m) % m`, so the negative-fix is impossible to forget. Or, knowing both operands are in `[0, m)`, use `r = a − b; if (r < 0) r += m;` which avoids a `%`.

### M12 (analysis). What's the complexity of computing `nCr mod p` with precompute?
`O(N)` to build factorials and inverse factorials (one inverse + linear passes), then `O(1)` per query. Total for `Q` queries: `O(N + Q)`.

---

## Senior Questions (10 Q&A)

### S1. How do you choose a `mulmod` strategy by modulus size?
`m < 2^31.5 ≈ 3.04×10^9`: plain 64-bit `(a*b) % m`. `2^31.5 ≤ m < 2^63`: `__int128` (C/C++), `bits.Mul64` (Go), `Math.multiplyHigh` (Java), or Montgomery/Barrett. Arbitrary precision: big integers.

### S2. When and why use Montgomery or Barrett reduction?
When a modulus is fixed and reused millions of times (modpow, NTT, RSA), the hardware `%` (20-40 cycles) dominates. Montgomery (odd modulus) and Barrett (any modulus) replace `%` with multiplies and shifts. They pay off only after amortizing setup over many reductions.

### S3. What breaks when the modulus is composite?
Non-coprime elements have no inverse; zero divisors exist (`2·3 ≡ 0 mod 6`); cancellation fails; Fermat is invalid. Division, `nCr mod m`, and Gaussian elimination can all hit non-invertible pivots and must handle them explicitly.

### S4. How do you compute mod a composite `m` using CRT?
Factor `m = ∏ p_i^{e_i}` (pairwise coprime). By CRT, `Z/mZ ≅ ∏ Z/p_i^{e_i}Z`; compute independently in each component and recombine. RSA uses this (CRT mod `p`, `q`) for a ~4× speedup.

### S5. How do you recover an exact answer larger than one prime?
Run the whole computation under several coprime primes and CRT-combine (or Garner's incremental form, sibling `15`). Each prime's run is independent — embarrassingly parallel — and the combined result is exact below the product of the primes.

### S6. What makes modular code in cryptography different?
The modulus and exponents are secret, so timing/cache behavior must not depend on them. Use the Montgomery ladder (constant-time exponentiation), constant-time conditional selects instead of branches, data-independent reductions, and possibly input blinding — never variable-time `%` on secret operands.

### S7. Why are modular bugs especially dangerous?
They are silent: an overflowed multiply or a negative remainder still produces a value in `[0, m)`, so nothing crashes — the answer is just wrong. The defense is a big-integer oracle and property tests (`a·inv(a) ≡ 1`), run on both prime and composite moduli.

### S8. How do you test a modular library?
Big-integer oracle on small inputs; `a·inv(a) ≡ 1` for units, expect failure for non-units; `mulmod` vs `__int128` reference; Fermat vs extended-Euclid agreement on primes; CRT round-trip; negative-input round-trip. Run on randomized prime and composite moduli in CI.

### S9. How is `nCr mod m` handled when `m` is a prime power or composite?
Direct factorial inverses fail (`r!` may share a factor with `m`). Use Granville's / Lucas-for-prime-powers techniques per prime-power factor, then CRT-combine. Much more involved than the prime case.

### S10 (analysis). Prove `a^(p−2)` is the inverse of `a` mod prime `p`.
Fermat: `a^(p−1) ≡ 1 (mod p)` for `p ∤ a`. Then `a · a^(p−2) = a^(p−1) ≡ 1`, so `a^(p−2)` is the inverse by definition. (Fermat itself is Lagrange's theorem applied to the group `(Z/pZ)*` of order `p − 1`.)

---

## Professional Questions (8 Q&A)

### P1. Design a service computing `nCr mod p` for millions of queries.
Precompute `fact` and `invfact` up to `N` once at startup (`O(N)`, one inverse). Each query is `O(1)`. Pin `p` as a prime constant; validate `0 ≤ r ≤ n ≤ N`. For `n > p`, switch to Lucas' theorem. Share the read-only tables across threads.

### P2. Your modulus jumped from `10^9 + 7` to a `10^18` prime. What changes?
`(a*b) % m` now overflows 64-bit. Replace every multiply with `__int128`/`bits.Mul64`, or switch the hot loop to Montgomery reduction. Re-audit every place a product is formed; re-run the big-integer oracle. Fermat inverse still works (still prime).

### P3. How do you make modular exponentiation constant-time for crypto?
Use the Montgomery ladder: every step does both a square and a multiply regardless of the exponent bit, with a constant-time select choosing the result. No secret-dependent branch or memory access. Combine with Montgomery reduction for data-independent timing.

### P4. A teammate used Fermat's inverse on `m = 2^32`. Why is it wrong?
`2^32` is composite, so `a^(m−2)` is not the inverse, and even elements coprime to `m` are not handled by Fermat (which requires a prime modulus). Use extended Euclid; note odd `a` are units mod `2^32` but even `a` are non-invertible.

### P5. How do you debug "the modular answer is wrong" in production?
Recompute the same expression with a big-integer oracle on the failing small input and diff. Check the three suspects: a negative remainder (missing `+m`), an overflowed multiply (`m` too large for 64-bit), and a wrong/mismatched modulus constant. Verify `a·inv(a) ≡ 1`.

### P6. When is the modular inverse genuinely undefined, and how do you handle it?
When `gcd(a, m) ≠ 1` (including `a ≡ 0`). There is no value to return; surface an error rather than emit garbage. In modular Gaussian elimination, a non-invertible pivot must trigger a pivot swap or a CRT decomposition, not a silent divide.

### P7. How does CRT speed up RSA decryption?
Instead of one exponentiation mod `n = pq`, compute mod `p` and mod `q` separately (each operand and exponent halved in size) and CRT-combine. Since modular exponentiation is roughly cubic in operand size, two half-size exponentiations cost about `2·(1/8) = 1/4` of the full one — a ~4× speedup.

### P8 (analysis). Why is `Z/pZ` a field but `Z/mZ` (composite `m`) only a ring?
For prime `p`, every nonzero residue is coprime to `p`, hence a unit (invertible). For composite `m = ab` with `1 < a, b < m`, `a` is a nonzero non-unit (and a zero divisor, `a·b ≡ 0`). A field requires every nonzero element invertible, which fails exactly when `m` is composite.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time a subtle integer bug caused a wrong result.
Look for a concrete overflow or negative-mod story: a product that exceeded 64-bit, or a `%` that returned negative and corrupted an index. Strong answers describe the silent nature of the bug, the big-integer oracle that exposed it, and the `subMod`/`__int128` fix plus a regression test.

### B2. A colleague's `nCr mod p` is slow — `O(log p)` per query. How do you help?
Show the precomputed inverse-factorial table: one Fermat inverse plus linear forward/backward passes give `O(1)` per query. Frame it as a teaching moment about amortizing the single expensive inverse, and add a test comparing against exact big-integer `nCr`.

### B3. Design a feature needing exact huge counts (beyond `10^18`).
Use multi-prime CRT: run the modular computation under several coprime primes and recombine for the exact value. Discuss choosing enough primes to cover the magnitude, parallelizing across primes, and falling back to big integers (sibling `27`) when the count is unbounded.

### B4. How would you explain modular inverses to a junior?
Start from clock arithmetic and "undo": the inverse is the rotation that brings you back to 1. Then: it exists only when `a` shares no factor with `m`; for a prime modulus, `a^(p−2)` gives it in one fast-power; division is just multiplying by it. Lead with the two gotchas: it needs coprimality, and `0` has none.

### B5. A crypto code review shows `if (bit) result = result*a`. What's your concern?
That branch is secret-dependent: its timing leaks the exponent's bits (a timing side channel). Recommend the Montgomery ladder or a constant-time select that performs identical work regardless of the bit, plus data-independent reduction. Never hand-roll crypto modular arithmetic without constant-time discipline.

---

## Coding Challenges

### Challenge 1: Modular Exponentiation

**Problem.** Compute `a^b mod m` for `0 ≤ a < m`, `0 ≤ b ≤ 10^18`, `1 ≤ m ≤ 10^9`. Return the result in `[0, m)`.

**Example.**
```text
a=3, b=13, m=7   -> 3      (3^13 ≡ 3 mod 7)
a=2, b=10, m=1000 -> 24     (1024 mod 1000)
```

**Optimal.** Binary exponentiation, `O(log b)`.

**Go.**
```go
package main

import "fmt"

func powMod(a, b, m int64) int64 {
	a %= m
	if a < 0 {
		a += m
	}
	var r int64 = 1 % m
	for b > 0 {
		if b&1 == 1 {
			r = r * a % m
		}
		a = a * a % m
		b >>= 1
	}
	return r
}

func main() {
	fmt.Println(powMod(3, 13, 7))     // 3
	fmt.Println(powMod(2, 10, 1000))  // 24
}
```

**Java.**
```java
public class ModPow {
    static long powMod(long a, long b, long m) {
        a %= m; if (a < 0) a += m;
        long r = 1 % m;
        while (b > 0) {
            if ((b & 1) == 1) r = r * a % m;
            a = a * a % m;
            b >>= 1;
        }
        return r;
    }

    public static void main(String[] args) {
        System.out.println(powMod(3, 13, 7));    // 3
        System.out.println(powMod(2, 10, 1000)); // 24
    }
}
```

**Python.**
```python
def pow_mod(a, b, m):
    return pow(a % m, b, m)  # built-in 3-arg pow is binary exponentiation


if __name__ == "__main__":
    print(pow_mod(3, 13, 7))     # 3
    print(pow_mod(2, 10, 1000))  # 24
```

---

### Challenge 2: Modular Inverse (Two Methods)

**Problem.** Given `a` and `m`, return `a⁻¹ mod m` if it exists (i.e. `gcd(a, m) = 1`), else report "no inverse". Provide both a Fermat path (assume prime `m`) and an extended-Euclid path (any coprime `m`).

**Example.**
```text
a=3, m=11 (prime)  -> 4    (3*4 = 12 ≡ 1 mod 11)
a=3, m=26          -> 9    (3*9 = 27 ≡ 1 mod 26)
a=2, m=4           -> no inverse
```

**Go.**
```go
package main

import "fmt"

func powMod(a, b, m int64) int64 {
	a %= m
	if a < 0 {
		a += m
	}
	var r int64 = 1 % m
	for b > 0 {
		if b&1 == 1 {
			r = r * a % m
		}
		a = a * a % m
		b >>= 1
	}
	return r
}

func invFermat(a, p int64) int64 { return powMod(a, p-2, p) }

func extgcd(a, b int64) (g, x, y int64) {
	if b == 0 {
		return a, 1, 0
	}
	g, x1, y1 := extgcd(b, a%b)
	return g, y1, x1 - (a/b)*y1
}

func invEuclid(a, m int64) (int64, bool) {
	a = ((a % m) + m) % m
	g, x, _ := extgcd(a, m)
	if g != 1 {
		return 0, false
	}
	return ((x % m) + m) % m, true
}

func main() {
	fmt.Println(invFermat(3, 11)) // 4
	v, ok := invEuclid(3, 26)
	fmt.Println(v, ok)            // 9 true
	_, ok = invEuclid(2, 4)
	fmt.Println(ok)              // false
}
```

**Java.**
```java
public class ModInverse {
    static long powMod(long a, long b, long m) {
        a %= m; if (a < 0) a += m;
        long r = 1 % m;
        while (b > 0) { if ((b&1)==1) r=r*a%m; a=a*a%m; b>>=1; }
        return r;
    }

    static long invFermat(long a, long p) { return powMod(a, p - 2, p); }

    static long[] extgcd(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extgcd(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }

    static Long invEuclid(long a, long m) {
        a = ((a % m) + m) % m;
        long[] r = extgcd(a, m);
        if (r[0] != 1) return null; // no inverse
        return ((r[1] % m) + m) % m;
    }

    public static void main(String[] args) {
        System.out.println(invFermat(3, 11)); // 4
        System.out.println(invEuclid(3, 26)); // 9
        System.out.println(invEuclid(2, 4));  // null (no inverse)
    }
}
```

**Python.**
```python
def inv_fermat(a, p):
    return pow(a, p - 2, p)  # prime p


def ext_gcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = ext_gcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


def inv_euclid(a, m):
    a %= m
    g, x, _ = ext_gcd(a, m)
    if g != 1:
        return None  # no inverse
    return x % m


if __name__ == "__main__":
    print(inv_fermat(3, 11))  # 4
    print(inv_euclid(3, 26))  # 9
    print(inv_euclid(2, 4))   # None
```

---

### Challenge 3: Binomial Coefficient nCr mod p

**Problem.** Given a prime `p = 10^9 + 7`, answer `Q` queries each `(n, r)` with `0 ≤ r ≤ n ≤ N` (`N ≤ 10^6`), returning `C(n, r) mod p`. Precompute so each query is `O(1)`.

**Example.**
```text
C(10, 3) = 120
C(5, 2)  = 10
C(0, 0)  = 1
```

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007
const N = 1_000_000

var fact, invfact [N + 1]int64

func powMod(a, b int64) int64 {
	a %= MOD
	var r int64 = 1
	for b > 0 {
		if b&1 == 1 {
			r = r * a % MOD
		}
		a = a * a % MOD
		b >>= 1
	}
	return r
}

func initFact() {
	fact[0] = 1
	for i := 1; i <= N; i++ {
		fact[i] = fact[i-1] * int64(i) % MOD
	}
	invfact[N] = powMod(fact[N], MOD-2)
	for i := N - 1; i >= 0; i-- {
		invfact[i] = invfact[i+1] * int64(i+1) % MOD
	}
}

func nCr(n, r int) int64 {
	if r < 0 || r > n {
		return 0
	}
	return fact[n] * invfact[r] % MOD * invfact[n-r] % MOD
}

func main() {
	initFact()
	fmt.Println(nCr(10, 3)) // 120
	fmt.Println(nCr(5, 2))  // 10
	fmt.Println(nCr(0, 0))  // 1
}
```

**Java.**
```java
public class NcrModP {
    static final long MOD = 1_000_000_007L;
    static final int N = 1_000_000;
    static long[] fact = new long[N + 1], invfact = new long[N + 1];

    static long powMod(long a, long b) {
        a %= MOD; long r = 1;
        while (b > 0) { if ((b&1)==1) r=r*a%MOD; a=a*a%MOD; b>>=1; }
        return r;
    }

    static void initFact() {
        fact[0] = 1;
        for (int i = 1; i <= N; i++) fact[i] = fact[i-1] * i % MOD;
        invfact[N] = powMod(fact[N], MOD - 2);
        for (int i = N - 1; i >= 0; i--) invfact[i] = invfact[i+1] * (i+1) % MOD;
    }

    static long nCr(int n, int r) {
        if (r < 0 || r > n) return 0;
        return fact[n] * invfact[r] % MOD * invfact[n-r] % MOD;
    }

    public static void main(String[] args) {
        initFact();
        System.out.println(nCr(10, 3)); // 120
        System.out.println(nCr(5, 2));  // 10
        System.out.println(nCr(0, 0));  // 1
    }
}
```

**Python.**
```python
MOD = 1_000_000_007
N = 1_000_000

fact = [1] * (N + 1)
for i in range(1, N + 1):
    fact[i] = fact[i - 1] * i % MOD
invfact = [1] * (N + 1)
invfact[N] = pow(fact[N], MOD - 2, MOD)
for i in range(N - 1, -1, -1):
    invfact[i] = invfact[i + 1] * (i + 1) % MOD


def nCr(n, r):
    if r < 0 or r > n:
        return 0
    return fact[n] * invfact[r] % MOD * invfact[n - r] % MOD


if __name__ == "__main__":
    print(nCr(10, 3))  # 120
    print(nCr(5, 2))   # 10
    print(nCr(0, 0))   # 1
```

---

### Challenge 4: Overflow-Safe Sum and Product Under a Large Modulus

**Problem.** Given an array of up to `10^6` values and a **large** modulus `m` (up to `2^62`), compute both `Σ a_i mod m` and `Π a_i mod m` without overflow. Each multiply must be overflow-safe.

**Example.**
```text
a = [10^18, 10^18, 10^18], m = 9_000_000_000_000_000_037
sum  = (3 * 10^18) mod m
prod = (10^54) mod m   (via overflow-safe mulmod)
```

**Go.** (uses `math/bits` for a full 128-bit product)
```go
package main

import (
	"fmt"
	"math/bits"
)

func mulMod(a, b, m uint64) uint64 {
	hi, lo := bits.Mul64(a%m, b%m)
	_, rem := bits.Div64(hi%m, lo, m)
	return rem
}

func sumProd(a []uint64, m uint64) (uint64, uint64) {
	var s uint64 = 0
	var p uint64 = 1 % m
	for _, x := range a {
		s = (s + x%m) % m
		p = mulMod(p, x, m)
	}
	return s, p
}

func main() {
	m := uint64(9_000_000_000_000_000_037)
	a := []uint64{1_000_000_000_000_000_000, 1_000_000_000_000_000_000, 1_000_000_000_000_000_000}
	s, p := sumProd(a, m)
	fmt.Println(s, p)
}
```

**Java.** (Russian-peasant `mulmod`, no 128-bit type needed)
```java
public class SafeSumProd {
    static long mulMod(long a, long b, long m) {
        a = ((a % m) + m) % m;
        b = ((b % m) + m) % m;
        long r = 0;
        while (b > 0) {
            if ((b & 1) == 1) r = (r + a) % m;
            a = (a + a) % m;
            b >>= 1;
        }
        return r;
    }

    static long[] sumProd(long[] a, long m) {
        long s = 0, p = 1 % m;
        for (long x : a) {
            s = (s + x % m) % m;
            p = mulMod(p, x, m);
        }
        return new long[]{s, p};
    }

    public static void main(String[] args) {
        long m = 9_000_000_000_000_000_037L;
        long[] a = {1_000_000_000_000_000_000L, 1_000_000_000_000_000_000L, 1_000_000_000_000_000_000L};
        long[] r = sumProd(a, m);
        System.out.println(r[0] + " " + r[1]);
    }
}
```

**Python.** (arbitrary precision; plain `*` is already exact)
```python
def sum_prod(a, m):
    s = 0
    p = 1 % m
    for x in a:
        s = (s + x) % m
        p = (p * x) % m  # Python ints never overflow
    return s, p


if __name__ == "__main__":
    m = 9_000_000_000_000_000_037
    a = [10**18, 10**18, 10**18]
    print(sum_prod(a, m))
```

---

## Final Tips

- Lead with the one-liner: *"reduce mod `m` at any time; `+`, `−`, `×` all respect congruence."*
- Immediately flag the gotchas: **negative mod** (`((x%m)+m)%m`), **multiply overflow** (size-check `m`), and **division = multiply by inverse**.
- For inverses, state the rule: exists iff `gcd(a, m) = 1`; **Fermat `a^(p−2)` for prime `m`**, extended Euclid otherwise.
- For `nCr mod p`, show the `O(n)` precompute with a **single** inverse and `O(1)` queries.
- For large `m`, mention `__int128`/`bits.Mul64`/Montgomery; for crypto, mention **constant-time** and the Montgomery ladder.
- Always offer to verify against a big-integer oracle on small inputs.
