# Fermat's Little Theorem & Euler's Theorem — Interview Preparation

Fermat and Euler are favourite interview topics because they reward a single crisp insight — *"`a^(p-1) ≡ 1 (mod p)`, so `a^(p-2)` is the inverse, and exponents reduce mod `φ(m)`"* — and then test whether you can (a) compute a modular inverse correctly under prime *and* composite moduli, (b) compute and sieve the totient `φ`, (c) collapse exponent towers `a^(b^c) mod m`, and (d) avoid the classic trap of reducing the exponent when the base is not coprime to the modulus. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| `a^(p-1) mod p`, `p` prime, `gcd(a,p)=1` | Fermat ⟹ `1` | — |
| Inverse of `a` mod prime `p` | `a^(p-2) mod p` (Fermat) | `O(log p)` |
| Inverse of `a` mod composite `m` | extended Euclid, or `a^(φ(m)-1)` | `O(log m)` (+ factoring) |
| `a^(φ(m)) mod m`, `gcd(a,m)=1` | Euler ⟹ `1` | — |
| `φ(m)` for one `m` | factor + `m·∏(1−1/p)` | `O(√m)` |
| `φ(1..n)` for all | modified Eratosthenes sieve | `O(n log log n)` |
| `a^e mod m`, `e` huge, `gcd(a,m)=1` | `a^(e mod φ(m)) mod m` | `O(log e)` |
| `a^(b^c) mod m` (any base) | reduce inner `mod φ(m)`, `+φ` guard | `O(log m + log c)` |
| order of `a` mod `m` | scan divisors of `φ(m)` | `O(√m + log m · #div)` |

Key facts:
- **`φ(p) = p − 1`**, `φ(p^e) = p^{e-1}(p−1)`, `φ` is **multiplicative**.
- Exponents reduce **mod `φ(m)`**, never mod `m`.
- The `mod φ(m)` shortcut needs **`gcd(a, m) = 1`**; else use `(e mod φ(m)) + φ(m)`.
- The **order** of any element **divides** `φ(m)` (and `p−1` for prime).
- Fermat-only primality test is fooled by **Carmichael numbers** — use Miller-Rabin.

Core routine:

```text
powMod(a, e, m):                 # O(log e)
    r = 1
    while e > 0:
        if e & 1: r = r*a % m
        a = a*a % m
        e >>= 1
    return r

inv_prime(a, p) = powMod(a, p-2, p)        # p prime, a ≢ 0
totient(m): r=m; for distinct prime q|m: r -= r/q
```

---

## Junior Questions (12 Q&A)

### J1. State Fermat's little theorem.
For a prime `p` and any `a` with `gcd(a, p) = 1`, `a^(p-1) ≡ 1 (mod p)`. Equivalently, for *every* integer `a`, `a^p ≡ a (mod p)`.

### J2. How do you compute a modular inverse with Fermat?
The inverse of `a` mod a prime `p` is `a^(p-2) mod p`, because `a · a^(p-2) = a^(p-1) ≡ 1`. One binary exponentiation, `O(log p)`.

### J3. What is Euler's totient `φ(m)`?
The count of integers in `{1, …, m}` coprime to `m`. For a prime `p`, `φ(p) = p − 1`. For example `φ(12) = 4` (the residues `1, 5, 7, 11`).

### J4. State Euler's theorem and how it generalizes Fermat.
For `gcd(a, m) = 1`, `a^(φ(m)) ≡ 1 (mod m)`. When `m = p` is prime, `φ(p) = p − 1`, so it becomes Fermat's `a^(p-1) ≡ 1`.

### J5. Why can you reduce a huge exponent mod `φ(m)`?
Because `a^(φ(m)) ≡ 1`, the powers of `a` cycle with a period dividing `φ(m)`. So `a^e ≡ a^(e mod φ(m)) (mod m)` when `gcd(a, m) = 1` — turning `3^1000000 mod 7` into `3^(1000000 mod 6) = 3^4 = 4`.

### J6. What is the formula for `φ(m)`?
If `m = p_1^{e_1} ⋯ p_r^{e_r}`, then `φ(m) = m · ∏_i (1 − 1/p_i)`. You apply `(1 − 1/p)` once per **distinct** prime.

### J7. What is `φ(p^e)`?
`φ(p^e) = p^e − p^{e-1} = p^{e-1}(p − 1)` — you remove the multiples of `p`.

### J8. Does the Fermat inverse work for any modulus?
No. `a^(p-2)` is the inverse only when `p` is **prime**. For composite `m`, use extended Euclid or `a^(φ(m)-1)`.

### J9. When does a modular inverse exist?
Exactly when `gcd(a, m) = 1`. If `a` and `m` share a factor, no inverse exists.

### J10. What is the order of an element?
The smallest `d > 0` with `a^d ≡ 1 (mod m)`. The powers of `a` repeat with period `d`, and `d` always divides `φ(m)`.

### J11. Why `φ(7) = 6` and what does it tell you about powers of any base mod 7?
All of `1..6` are coprime to the prime `7`, so `φ(7) = 6`. Hence `a^6 ≡ 1 (mod 7)` for every `a` not divisible by 7 — powers cycle with a period dividing 6.

### J12 (analysis). Why is computing `a^(p-2)` `O(log p)` and not `O(p)`?
Binary exponentiation squares the base, doubling the exponent each step, so reaching exponent `p-2` needs only `⌊log₂(p-2)⌋` squarings plus the set-bit multiplies. Naively multiplying `a` by itself `p-2` times would be `O(p)`.

---

## Middle Questions (12 Q&A)

### M1. Prove Fermat's little theorem (rearrangement).
The map `x ↦ ax` permutes `{1, …, p-1}` (since `a` is invertible mod the prime `p`). So `∏(a·x) ≡ ∏x`, i.e. `a^(p-1)·(p-1)! ≡ (p-1)!`. Cancel `(p-1)!` (coprime to `p`): `a^(p-1) ≡ 1`.

### M2. How do you compute `φ(m)` in `O(√m)`?
Trial-divide `m`. For each distinct prime `p` found, multiply the running result by `(1 − 1/p)` (implemented as `result -= result/p`). Strip all copies of `p` so each distinct prime contributes once. Handle a leftover prime `> √m` at the end.

### M3. How do you sieve `φ(1..n)`?
Initialize `phi[i] = i`. For each prime `p` (detected as `phi[p] == p`), sweep its multiples and do `phi[mult] -= phi[mult]/p`. This is `O(n log log n)`, like the prime sieve.

### M4. Why is `φ` multiplicative?
For `gcd(a, b) = 1`, CRT gives `ℤ/abℤ ≅ ℤ/aℤ × ℤ/bℤ`, an isomorphism that maps units to units, so `φ(ab) = φ(a)φ(b)`. The product formula follows from this plus `φ(p^e) = p^{e-1}(p-1)`.

### M5. Inverse via Fermat vs Euler vs extended Euclid — when each?
Fermat (`a^(p-2)`) for prime modulus. Euler (`a^(φ(m)-1)`) when `φ(m)` is already known. Extended Euclid for composite modulus with no factorization — it is `O(log m)` and needs no `φ`.

### M6. How do you reduce the exponent in `a^e mod m`?
If `gcd(a, m) = 1`, `a^e ≡ a^(e mod φ(m)) (mod m)`. For a prime modulus, `e mod (p-1)`. Never reduce mod `m` itself.

### M7. What breaks when `gcd(a, m) ≠ 1` and you reduce mod `φ(m)`?
The powers of `a` are no longer purely periodic — there is a non-repeating tail. Reducing mod `φ(m)` can land inside that tail and give a wrong answer. Use the generalized rule `a^e ≡ a^((e mod φ(m)) + φ(m))` for `e ≥ log₂ m`.

### M8. Why does the order of an element divide `φ(m)`?
The powers `⟨a⟩` form a subgroup of `(ℤ/mℤ)^*` of size `ord_m(a)`. By Lagrange's theorem the subgroup order divides the group order `φ(m)`.

### M9. How do you find the order of `a` mod `m` efficiently?
Compute `φ(m)`, factor it, start with `ord = φ(m)`, and for each prime `q | φ(m)` divide `ord` by `q` while `a^(ord/q) ≡ 1`. The remaining `ord` is the true order — `O(log m · #divisors)` powers.

### M10. What is a primitive root?
A unit `g` whose order equals `φ(m)` exactly — it generates the whole group `(ℤ/mℤ)^*`. Primitive roots exist only for `m ∈ {1, 2, 4, p^k, 2p^k}`.

### M11. How do you compute an exponent tower `a^(b^c) mod m`?
Reduce the inner exponent: `inner = b^c mod φ(m)`, then `a^inner mod m`. If the base may share a factor with `m`, use `a^(inner + φ(m)) mod m`. Recurse on `φ(m)` for taller towers.

### M12 (analysis). How fast does the iterated totient `m → φ(m) → φ(φ(m)) → …` reach 1?
`O(log m)` steps: `φ(m)` is even for `m > 2`, so the value at least halves every two iterations. This bounds the recursion depth of tower evaluation regardless of tower height.

---

## Senior Questions (10 Q&A)

### S1. Why does RSA decryption work?
`ed ≡ 1 (mod φ(N))`, so `ed = 1 + kφ(N)` and `c^d = m^(ed) = m·(m^(φ(N)))^k ≡ m (mod N)` by Euler's theorem. Security is the hardness of computing `φ(N) = (p-1)(q-1)` without factoring `N = pq`.

### S2. When does the Fermat inverse `a^(p-2)` fail?
When the modulus is composite (it returns a non-inverse silently) or when `a ≡ 0 (mod p)` (no inverse exists; it returns `0`). Default to extended Euclid, which needs no primality and surfaces `gcd ≠ 1`.

### S3. What is Carmichael's function `λ(m)` and why use it?
The least universal exponent with `a^(λ(m)) ≡ 1` for all coprime `a`; `λ(m) | φ(m)`. It is the group's exponent and gives a tighter exponent reduction. The trap: `λ(2^e) = 2^{e-2}`, half of `φ(2^e)`. RSA uses `d = e^(-1) mod λ(N) = lcm(p-1, q-1)`.

### S4. State the generalized Euler theorem.
For any `a` and `e ≥ log₂ m`: `a^e ≡ a^((e mod φ(m)) + φ(m)) (mod m)`. The `+φ` term clears the non-periodic tail from the part of `m` sharing a factor with `a`. It is the safe default for towers since it does not need a coprimality test.

### S5. Why is a Fermat-only primality test unsafe?
Carmichael numbers (561, 1105, …) satisfy `a^(n-1) ≡ 1 (mod n)` for *all* coprime `a` despite being composite. By Korselt's criterion they are squarefree with `(p-1) | (n-1)` for each prime factor. Use Miller-Rabin, which adds a square-root-of-1 check.

### S6. How do you make modular exponentiation fast and secure in crypto?
Montgomery or Barrett reduction (avoid division), sliding-window exponentiation (fewer multiplies), and CRT-RSA (per-prime exponents, ~4× faster). For *secret* exponents, use constant-time evaluation (Montgomery ladder) to avoid timing side channels.

### S7. How do you invert a whole batch of numbers mod a prime?
Prefix-product trick: compute prefix products, invert only the last one via Fermat (`a^(p-2)`), then unwind. `O(n + log p)` for `n` inverses instead of `O(n log p)`.

### S8. How does CRT speed up RSA decryption?
Compute `m_p = c^(d mod (p-1)) mod p` and `m_q = c^(d mod (q-1)) mod q` (Fermat-reduced exponents), then recombine via CRT. Each exponentiation is on a half-size modulus, and exponentiation cost is roughly cubic in bit-length, so ~4× faster overall.

### S9. Why can RSA still decrypt a message `m` with `gcd(m, N) > 1`?
By CRT, `m^(ed) ≡ m` holds mod `p` and mod `q` individually (Fermat on each prime covers the `m ≡ 0` case since both sides are 0), so it holds mod `N`. But such a message leaks a factor of `N` — padding (OAEP) randomizes `m` to prevent it.

### S10 (analysis). Why is computing `φ(N)` as hard as factoring `N = pq`?
Knowing `φ(N) = (p-1)(q-1) = N - (p+q) + 1` gives `p + q` (from `N` and `φ(N)`), and `p·q = N`; then `p, q` are roots of `x² - (p+q)x + N = 0`, recoverable by the quadratic formula. So `φ(N) ⟹` factorization, and factorization `⟹ φ(N)` trivially — they are computationally equivalent.

---

## Professional Questions (8 Q&A)

### P1. Design a service that answers many modular-inverse queries mod a fixed prime.
Precompute nothing for one-off queries: each is `a^(p-2) mod p`, `O(log p)`. For a batch arriving together, use the prefix-product batch inverse (`O(n + log p)`). For inverses of *all* of `1..n` mod `p`, use the recurrence `inv[i] = -(p/i)·inv[p mod i] mod p` in `O(n)`. Cache by modulus; never recompute `p-2` exponentiation in a tight loop unnecessarily.

### P2. You must evaluate a tower `a₁^(a₂^(a₃^…)) mod m` of height up to 10^5. How?
Recurse on the modulus chain `m, φ(m), φ(φ(m)), …`, which has length `O(log m)`, so recursion depth is bounded by ~60 for 64-bit `m` regardless of tower height. At each level apply the generalized rule with the `+φ` guard so non-coprime bases are handled. Stop recursing when the modulus reaches 1 (everything is `0`).

### P3. Your `a^(p-2)` inverse "sometimes returns wrong values" in production. Debug it.
Check the three usual suspects: (1) the modulus is actually composite (Fermat invalid — verify primality), (2) `a ≡ 0 (mod p)` (no inverse, returns 0), (3) overflow in `a*a` before reduction (use 64-bit/128-bit). Add an assertion `(a * inv) % p == 1` at every call site to fail loudly.

### P4. When do you prefer `λ(m)` over `φ(m)` for exponent reduction?
Whenever you want the *tightest* exponent or are following the RSA standard (which mandates `λ(N)`). Both are correct for reduction; `λ(m) | φ(m)` so `λ` is smaller. Watch the `λ(2^e) = 2^{e-2}` special case — assuming `λ = φ` for powers of 2 is a classic bug.

### P5. How do you compute `φ(m)` when `m` is a 30-digit number?
Trial division is infeasible. Factor `m` with Pollard's rho (sibling `09-pollard-rho-factorization`) and Miller-Rabin for primality testing of factors, then apply the product formula over the distinct primes. Computing `φ(m)` is exactly as hard as factoring `m`.

### P6. How do automata / counting connect to Euler's theorem?
Indirectly through *order* and *period*: the multiplicative order of `a` mod `m` is the period of the sequence `a^k mod m`, which is the cycle length in the functional graph of "multiply by `a`". Reducing huge exponents is the same as finding your position within that cycle — `e mod ord_m(a)`.

### P7. How do you verify a modular-exponentiation library?
Property tests: `a^(p-1) ≡ 1` (Fermat) and `a^(φ(m)) ≡ 1` (Euler) for random coprime `a`; `a · inv(a) ≡ 1`; `totient(m)` vs brute-force coprime count; and the generalized tower against direct `pow(a, b**c, m)` for small `b^c`. Cross-language determinism (Go/Java/Python) on shared inputs is a strong end-to-end check.

### P8 (analysis). Why does the order of an element bound subgroup attacks in Diffie-Hellman?
An element of order `d` generates a subgroup of size `d`, and a discrete-log attacker in that subgroup works in `O(√d)` (Pohlig-Hellman + baby-step giant-step). If `d = ord_m(g)` is small (a divisor of `φ(m)`), the attack is cheap. Safe primes `p = 2q + 1` force the generator's order to be the large prime `q`, blocking small-subgroup attacks.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced a slow exponent loop with a logarithmic one.
Look for a concrete story: a modular-power or inverse computed in a hot loop, a profile showing the linear power dominating, the insight to use binary exponentiation (or to reduce the exponent mod `φ(m)`), and a measured speedup. Strong answers mention the overflow care and a correctness check against the old version.

### B2. A teammate used `a^(m-2)` to invert mod a composite modulus and shipped wrong results. How do you handle it?
Explain calmly that Fermat needs a *prime* modulus, with a tiny counterexample (mod 10, `3^8 mod 10 = 1 ≠ 7 = 3^(-1)`). Recommend extended Euclid as the unconditional default and an assertion `a·inv ≡ 1`. Frame it as a teaching moment about preconditions, not blame.

### B3. Design the math core of an RSA implementation.
Discuss key generation (two large primes via Miller-Rabin, `N = pq`, `e` coprime to `λ(N)`, `d = e^(-1) mod λ(N)`), CRT-RSA for fast decryption, constant-time exponentiation against timing attacks, and OAEP padding. Mention that security rests on factoring hardness and that `φ(N)` must stay secret.

### B4. How would you explain Fermat's little theorem to a junior engineer?
Use the clock analogy: on a 7-hour clock, multiplying by any nonzero `a` reshuffles the hours, and after `p-1 = 6` multiplications you always return to "1 o'clock". Then show the payoff: dividing becomes `a^(p-2)`, and a million-step exponent collapses to `e mod 6`. Lead with the two preconditions: prime modulus and coprime base.

### B5. Your modular-exponentiation service is slow under load. How do you investigate?
Profile the multiply: is it doing per-call `mod` (use Montgomery/Barrett)? Is the exponent un-reduced (fold mod `φ(m)` first)? Are you re-deriving `φ(m)` per request instead of caching it? For inverse-heavy paths, switch to batch inversion. Check for big-integer allocation churn.

---

## Coding Challenges

### Challenge 1: Modular Inverse via Fermat

**Problem.** Given a prime `p` and an integer `a` with `1 ≤ a < p`, return `a^(-1) mod p` using Fermat's little theorem.

**Example.**
```text
a = 3, p = 7   ->  5   (3 * 5 = 15 ≡ 1 mod 7)
a = 2, p = 11  ->  6   (2 * 6 = 12 ≡ 1 mod 11)
```

**Constraints.** `2 ≤ p ≤ 10^18` (prime), `1 ≤ a < p`, `gcd(a, p) = 1`.

**Optimal.** `a^(p-2) mod p` via binary exponentiation, `O(log p)`. (For `p` near `10^18`, use 128-bit multiply.)

**Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

// mulmod computes a*b mod m safely for m up to ~2^63 using 128-bit product.
func mulmod(a, b, m uint64) uint64 {
	hi, lo := bits.Mul64(a, b)
	_, rem := bits.Div64(hi%m, lo, m)
	return rem
}

func powMod(a, e, m uint64) uint64 {
	a %= m
	r := uint64(1) % m
	for e > 0 {
		if e&1 == 1 {
			r = mulmod(r, a, m)
		}
		a = mulmod(a, a, m)
		e >>= 1
	}
	return r
}

func inverseFermat(a, p uint64) uint64 {
	return powMod(a, p-2, p) // a^(p-2) ≡ a^(-1) mod prime p
}

func main() {
	fmt.Println(inverseFermat(3, 7))  // 5
	fmt.Println(inverseFermat(2, 11)) // 6
}
```

**Java.**
```java
import java.math.BigInteger;

public class InverseFermat {
    static long powMod(long a, long e, long m) {
        BigInteger A = BigInteger.valueOf(a).mod(BigInteger.valueOf(m));
        BigInteger R = A.modPow(BigInteger.valueOf(e), BigInteger.valueOf(m));
        return R.longValue();
    }

    static long inverseFermat(long a, long p) {
        return powMod(a, p - 2, p); // requires p prime, a % p != 0
    }

    public static void main(String[] args) {
        System.out.println(inverseFermat(3, 7));  // 5
        System.out.println(inverseFermat(2, 11)); // 6
    }
}
```

**Python.**
```python
def inverse_fermat(a, p):
    """a^(-1) mod prime p via Fermat. Python's pow handles big p natively."""
    return pow(a, p - 2, p)


if __name__ == "__main__":
    print(inverse_fermat(3, 7))   # 5
    print(inverse_fermat(2, 11))  # 6
```

---

### Challenge 2: Compute the Totient `φ(n)`

**Problem.** Given `n`, compute Euler's totient `φ(n)` = number of integers in `{1, …, n}` coprime to `n`.

**Example.**
```text
n = 12  ->  4   (1, 5, 7, 11)
n = 7   ->  6   (prime: 1..6)
n = 1   ->  1
```

**Constraints.** `1 ≤ n ≤ 10^12`.

**Optimal.** Trial-divide to factor `n`, apply `n·∏(1 − 1/p)` over distinct primes, `O(√n)`.

**Go.**
```go
package main

import "fmt"

func totient(n int64) int64 {
	res := n
	for p := int64(2); p*p <= n; p++ {
		if n%p == 0 {
			for n%p == 0 {
				n /= p
			}
			res -= res / p // apply (1 - 1/p) once per distinct prime
		}
	}
	if n > 1 { // leftover prime factor > sqrt
		res -= res / n
	}
	return res
}

func main() {
	fmt.Println(totient(12)) // 4
	fmt.Println(totient(7))  // 6
	fmt.Println(totient(1))  // 1
}
```

**Java.**
```java
public class Totient {
    static long totient(long n) {
        long res = n;
        for (long p = 2; p * p <= n; p++) {
            if (n % p == 0) {
                while (n % p == 0) n /= p;
                res -= res / p;
            }
        }
        if (n > 1) res -= res / n;
        return res;
    }

    public static void main(String[] args) {
        System.out.println(totient(12)); // 4
        System.out.println(totient(7));  // 6
        System.out.println(totient(1));  // 1
    }
}
```

**Python.**
```python
def totient(n):
    res, p = n, 2
    while p * p <= n:
        if n % p == 0:
            while n % p == 0:
                n //= p
            res -= res // p
        p += 1
    if n > 1:
        res -= res // n
    return res


if __name__ == "__main__":
    print(totient(12))  # 4
    print(totient(7))   # 6
    print(totient(1))   # 1
```

---

### Challenge 3: Exponent Tower `a^(b^c) mod m`

**Problem.** Compute `a^(b^c) mod m` where `b^c` is far too large to form. Handle any base (coprime or not) via the generalized Euler rule.

**Example.**
```text
a = 2, b = 3, c = 4, m = 1000000007  ->  2^81 mod p
a = 7, b = 5, c = 3, m = 13          ->  7^125 mod 13
```

**Constraints.** `1 ≤ a, b, c ≤ 10^9`, `1 ≤ m ≤ 10^9`.

**Optimal.** `inner = b^c mod φ(m)`; answer `= a^(inner + φ(m)) mod m` (the `+φ` guard makes it correct for non-coprime bases too).

**Go.**
```go
package main

import "fmt"

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

func tower(a, b, c, m int64) int64 {
	if m == 1 {
		return 0
	}
	phi := totient(m)
	inner := powMod(b, c, phi)         // b^c mod φ(m)
	return powMod(a, inner+phi, m)     // +φ generalized Euler guard
}

func main() {
	fmt.Println(tower(2, 3, 4, 1000000007)) // 2^81 mod p
	fmt.Println(tower(7, 5, 3, 13))         // 7^125 mod 13
}
```

**Java.**
```java
public class Tower {
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

    static long tower(long a, long b, long c, long m) {
        if (m == 1) return 0;
        long phi = totient(m);
        long inner = powMod(b, c, phi);
        return powMod(a, inner + phi, m);
    }

    public static void main(String[] args) {
        System.out.println(tower(2, 3, 4, 1000000007L)); // 2^81 mod p
        System.out.println(tower(7, 5, 3, 13));          // 7^125 mod 13
    }
}
```

**Python.**
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


def tower(a, b, c, m):
    if m == 1:
        return 0
    phi = totient(m)
    inner = pow(b, c, phi)          # b^c mod φ(m)
    return pow(a, inner + phi, m)   # +φ generalized Euler guard


if __name__ == "__main__":
    print(tower(2, 3, 4, 1_000_000_007))  # 2^81 mod p
    print(tower(7, 5, 3, 13))             # 7^125 mod 13
```

---

### Challenge 4: Count Integers Coprime to N (and their order check)

**Problem.** Given `n`, count integers in `{1, …, n}` coprime to `n` (that is `φ(n)`), then verify Euler's theorem by checking that a given coprime base `a` satisfies `a^(φ(n)) ≡ 1 (mod n)`.

**Example.**
```text
n = 10, a = 3  ->  φ = 4, and 3^4 = 81 ≡ 1 mod 10  (check passes)
n = 9,  a = 2  ->  φ = 6, and 2^6 = 64 ≡ 1 mod 9   (check passes)
```

**Constraints.** `1 ≤ n ≤ 10^12`, `gcd(a, n) = 1`.

**Optimal.** `φ(n)` by trial division (`O(√n)`), then one `O(log φ)` power to verify Euler's theorem.

**Go.**
```go
package main

import "fmt"

func gcd(a, b int64) int64 {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func totient(n int64) int64 {
	res := n
	for p := int64(2); p*p <= n; p++ {
		if n%p == 0 {
			for n%p == 0 {
				n /= p
			}
			res -= res / p
		}
	}
	if n > 1 {
		res -= res / n
	}
	return res
}

func powMod(a, e, m int64) int64 {
	a %= m
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

func main() {
	checks := [][2]int64{{10, 3}, {9, 2}}
	for _, c := range checks {
		n, a := c[0], c[1]
		phi := totient(n)
		ok := gcd(a, n) == 1 && powMod(a, phi, n) == 1%n
		fmt.Printf("n=%d phi=%d euler holds=%v\n", n, phi, ok)
	}
}
```

**Java.**
```java
public class CoprimeCount {
    static long gcd(long a, long b) { return b == 0 ? a : gcd(b, a % b); }

    static long totient(long n) {
        long res = n;
        for (long p = 2; p * p <= n; p++)
            if (n % p == 0) {
                while (n % p == 0) n /= p;
                res -= res / p;
            }
        if (n > 1) res -= res / n;
        return res;
    }

    static long powMod(long a, long e, long m) {
        a %= m;
        long r = 1 % m;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % m;
            a = a * a % m;
            e >>= 1;
        }
        return r;
    }

    public static void main(String[] args) {
        long[][] checks = {{10, 3}, {9, 2}};
        for (long[] c : checks) {
            long n = c[0], a = c[1], phi = totient(n);
            boolean ok = gcd(a, n) == 1 && powMod(a, phi, n) == 1 % n;
            System.out.printf("n=%d phi=%d euler holds=%b%n", n, phi, ok);
        }
    }
}
```

**Python.**
```python
from math import gcd


def totient(n):
    res, p = n, 2
    while p * p <= n:
        if n % p == 0:
            while n % p == 0:
                n //= p
            res -= res // p
        p += 1
    if n > 1:
        res -= res // n
    return res


if __name__ == "__main__":
    for n, a in [(10, 3), (9, 2)]:
        phi = totient(n)
        ok = gcd(a, n) == 1 and pow(a, phi, n) == 1 % n
        print(f"n={n} phi={phi} euler holds={ok}")
```

---

## Final Tips

- Lead with the one-liner: *"`a^(p-1) ≡ 1 (mod p)`; so `a^(p-2)` is the inverse and exponents reduce mod `φ(m)`."*
- Immediately flag the two gotchas: **Fermat inverse needs a prime modulus**, and **exponent reduction needs `gcd(a, m) = 1`** (else `+φ`).
- For composite-modulus inverses, reach for **extended Euclid** — no primality, no factoring.
- For exponent towers, mention the **generalized `+φ` rule** and recursion through the iterated totient.
- Know that the **order divides `φ(m)`**, and that a **Fermat-only primality test fails on Carmichael numbers** — use Miller-Rabin.
- Always offer to verify with `a · inv(a) ≡ 1` and `a^(φ(m)) ≡ 1` on small inputs.
