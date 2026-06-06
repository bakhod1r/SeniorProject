# Tonelli-Shanks — Interview Preparation

Modular square roots are a favourite number-theory interview topic because they reward a few crisp insights — *"a quadratic residue has exactly two roots, `x` and `p − x`"*, *"Euler's criterion `n^((p-1)/2) ≡ ±1` decides solvability in one exponentiation"*, *"`p ≡ 3 (mod 4)` gives a one-line root `n^((p+1)/4)`"*, and *"the general algorithm splits `p − 1 = Q·2^S` and halves the order of `t` each round until it hits `1`"* — and then test whether you can (a) implement the loop, (b) reason about its `O(log² p)` cost and termination, (c) extend to prime powers and composites, and (d) connect it to elliptic-curve cryptography. This file is a curated question bank by seniority, behavioral prompts, and three end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Does `n` have a √ mod prime `p`? | Euler's criterion `n^((p-1)/2) ≡ 1` | `O(log p)` |
| Legendre symbol `(n/p)` | Euler's criterion result | `O(log p)` |
| √ when `p ≡ 3 (mod 4)` | `n^((p+1)/4)` | `O(log p)` |
| √ when `p ≡ 5 (mod 8)` | closed form (Atkin) | `O(log p)` |
| √ general odd prime | Tonelli-Shanks | `O(log² p)` (avg), `O(S² log p)` |
| √ general, large `S` | Cipolla (`F_{p²}`) | `O(log p)`, `S`-independent |
| The other root | `p − x` | `O(1)` |
| √ mod `p^k` | Tonelli-Shanks + Hensel lift | `O(log² p + log k)` |
| √ mod composite `m` | factor + per-prime-power + CRT | factoring-bound |
| # roots mod prime | `2` (QR), `0` (QNR) | — |
| # roots mod composite (`r` odd primes) | `2^r` | — |

```text
euler:        n^((p-1)/2) ≡ +1 (QR) | ≡ -1 (QNR) | ≡ 0 (p|n)
easy case:    p ≡ 3 (mod 4)  ⇒  x = n^((p+1)/4)
decompose:    p - 1 = Q·2^S, Q odd, S = v2(p-1)
init:         M=S, c=z^Q (z a QNR), t=n^Q, R=n^((Q+1)/2)
invariant:    R² ≡ t·n ; loop while t≠1, halving ord(t) each round
both roots:   {x, p-x}
```

Key facts:
- **A QR has exactly two roots** `x` and `p − x`; a QNR has none.
- **Exactly half** the units are QRs, so a random `z` is a non-residue with probability `1/2`.
- The `p ≡ 3 (mod 4)` shortcut is **Tonelli-Shanks with `S = 1`** (zero loop rounds).
- The loop terminates because the **2-adic valuation of `ord(t)` strictly decreases** each round.
- Tonelli-Shanks needs **neither a factorization of `p − 1` nor a discrete log** — unlike the general primitive-root method.

---

## Junior Questions (13 Q&A)

### J1. What does Tonelli-Shanks compute?
A modular square root: a value `x` with `x² ≡ n (mod p)` for an odd prime `p`. It is the modular analogue of `√n`.

### J2. What is a quadratic residue?
A value `n` (coprime to `p`) that *has* a square root mod `p` — i.e. `n = x²` for some `x`. Values with no square root are quadratic non-residues.

### J3. How many square roots does a number have mod a prime?
Exactly two if it is a QR (`x` and `p − x`), and zero if it is a non-residue. `0` has the single root `0`.

### J4. What is Euler's criterion?
For an odd prime `p` and `n ≢ 0`: `n^((p-1)/2) ≡ +1 (mod p)` if `n` is a QR, and `≡ −1` if it is a non-residue. One modular exponentiation decides solvability.

### J5. Why are there only two outcomes (`±1`) for Euler's criterion?
Let `y = n^((p-1)/2)`. By Fermat `y² = n^(p-1) ≡ 1`, so `y² ≡ 1`, meaning `y ≡ +1` or `y ≡ −1` (a field has no other square roots of 1).

### J6. What is the Legendre symbol?
A name for the Euler-criterion result: `(n/p) = +1` (QR), `−1` (QNR), `0` (`p | n`). It is multiplicative: `(ab/p) = (a/p)(b/p)`.

### J7. What is the easy case and its formula?
When `p ≡ 3 (mod 4)`, a QR `n` has root `x = n^((p+1)/4) (mod p)` — a single exponentiation. `(p+1)/4` is an integer exactly because `p ≡ 3 (mod 4)`.

### J8. Why does `n^((p+1)/4)` work?
`x² = n^((p+1)/2) = n^((p-1)/2) · n ≡ 1 · n = n`, using Euler's criterion (`n^((p-1)/2) ≡ 1` for a QR).

### J9. What is `p − 1 = Q · 2^S`?
The decomposition of `p − 1` into an odd part `Q` and a power of two `2^S`. `S` is the number of times `2` divides `p − 1`. It is the core of the general algorithm.

### J10. What is `S` for a prime `p ≡ 3 (mod 4)`?
`S = 1` (only one factor of two in `p − 1`). That is why those primes use the trivial shortcut and skip the loop.

### J11. What is the second root, given one root `x`?
`p − x`. Because `(p − x)² = p² − 2px + x² ≡ x² ≡ n`.

### J12. How would you check a result is correct?
Square it back: confirm `x · x ≡ n (mod p)`. It is cheap and catches almost any bug.

### J13 (analysis). Why not just try every `x` from `0` to `p − 1`?
That brute force is `O(p)` — fine for `p = 7`, but hopeless for a 256-bit prime. Tonelli-Shanks finds the same root in roughly `O(log² p)` steps.

---

## Middle Questions (13 Q&A)

### M1. Walk through the four working values of Tonelli-Shanks.
`M = S` (current 2-group exponent), `c = z^Q` (generator of the 2-Sylow subgroup, `z` a non-residue), `t = n^Q` (the "error" to drive to `1`), `R = n^((Q+1)/2)` (running guess, with invariant `R² ≡ t·n`).

### M2. Why does the algorithm need a quadratic non-residue `z`?
`c = z^Q` must *generate* the 2-Sylow subgroup (order `2^S`). Only a non-residue gives `z^Q` full order `2^S`; a residue would give order `≤ 2^(S-1)`, too small to cancel `t`.

### M3. How do you find a non-residue?
Try `z = 2, 3, 5, …` and test `(z/p) = −1` with Euler's criterion. Half of all residues are non-residues, so you expect to succeed within two tries.

### M4. What is the loop invariant?
`R² ≡ t · n (mod p)`. When the loop ends with `t = 1`, this becomes `R² ≡ n` — the answer. Each update preserves it: `(Rb)² = R²b² = (tn)b² = (tb²)n`.

### M5. What does each round of the loop do?
Find the least `i` with `t^(2^i) ≡ 1` (the order of `t` is `2^i`); compute correction `b = c^(2^(M-i-1))`; then `R ← Rb`, `c ← b²`, `t ← tb²`, `M ← i`. This lowers `ord(t)` by one factor of two.

### M6. Why does the loop terminate?
The 2-adic valuation of `ord(t)` strictly decreases by one each round, starting at most `S − 1`. So the loop runs at most `S − 1` times before `t = 1`.

### M7. What is the time complexity?
`O(S² · log p)` worst case (up to `S` rounds, each with an `O(S)`-squaring inner search and correction). For random primes `E[S] = O(1)`, so the expected cost is `O(log p)` modular multiplications — the standard quote is `O(log² p)`.

### M8. How does the `p ≡ 3 (mod 4)` shortcut relate to the full algorithm?
It is the `S = 1` case: `t = n^Q = n^((p-1)/2) ≡ 1` immediately, so the loop never runs and `R = n^((p+1)/4)`.

### M9. Tonelli-Shanks vs Cipolla — when to use each?
Both solve the same problem. Tonelli-Shanks is `O(S² log p)`; Cipolla is `O(log p)` independent of `S` (it works in `F_{p²}`). Use Tonelli-Shanks for small `S` (most primes), Cipolla when `S` is large.

### M10. What is Cipolla's algorithm in one sentence?
Pick `a` with `a² − n` a non-residue, then compute `(a + √(a²−n))^((p+1)/2)` in `F_{p²}`; its `F_p` part is the root (the imaginary part is provably zero).

### M11. What happens if you run the loop on a non-residue?
The inner order-search fails its assumption (`ord(t) ≤ 2^(M-1)`), causing `i = M` and a negative shift `M − i − 1`, or an infinite/garbage loop. Always gate with Euler's criterion first.

### M12. What is the relationship between this and the discrete-root problem?
It is the `k = 2` case of `x^k ≡ a (mod p)` (sibling `13`). But Tonelli-Shanks is preferred for `k = 2` because it needs no factorization of `p − 1` and no discrete log.

### M13 (analysis). Why is `−1` a QR exactly when `p ≡ 1 (mod 4)`?
`(−1/p) = (−1)^((p-1)/2)`, which is `+1` iff `(p−1)/2` is even iff `p ≡ 1 (mod 4)`. This is the line dividing the easy and hard cases.

---

## Senior Questions (11 Q&A)

### S1. How do you compute a square root mod a prime power `p^k`?
Find a root mod `p` (Tonelli-Shanks), then **Hensel-lift** it: `x ← x − (x² − n)(2x)^{-1} (mod p^{j+1})`, doubling precision Newton-style, reaching `p^k` in `O(log k)` steps. `p = 2` is a special case with `0/1/2/4` roots by `n mod 8`.

### S2. How do you solve `x² ≡ n` mod a composite `m`?
Factor `m`, root each prime power (Tonelli-Shanks + Hensel), then CRT-combine all combinations. The total root count is the **product** of per-factor counts (`2^r` for `r` distinct odd primes).

### S3. Where does Tonelli-Shanks appear in cryptography?
Elliptic-curve point decompression (recover `y` from `x`), Rabin cryptosystem, hash-to-curve (BLS), and quadratic-residue PRGs. Point decompression runs on every EC public-key import.

### S4. Why do many curves use primes `≡ 3 (mod 4)`?
So the square root is the one-line constant-time formula `n^((p+1)/4)` — no loop, naturally side-channel safe. secp256k1 and P-256 field primes are `≡ 3 (mod 4)`.

### S5. What is the constant-time concern with Tonelli-Shanks?
Its round count and inner order-search depend on the secret `t`, so it is **not** constant-time and leaks via timing/cache on secret data. Crypto code uses closed-form roots (curve primes `≡ 3 (mod 4)` or `≡ 5 (mod 8)`) instead.

### S6. How does the square root validate an elliptic-curve point?
Computing `y = √(x³ + ax + b)`: if the RHS is a non-residue, `x` is not on the curve — reject. So Euler's criterion doubles as on-curve validation during decompression.

### S7. How do you stay overflow-safe for large primes?
`a*a % p` overflows 64 bits for `p > 2^32`. Use 128-bit `mulmod` (`bits.Mul64`/`Div64` in Go), Montgomery multiplication, or `BigInteger`/Python ints. Every modular multiply must be safe.

### S8. Why is finding all composite square roots equivalent to factoring?
Two roots `x, y` with `x ≢ ±y` give `gcd(x − y, m)` a nontrivial factor. So computing all roots mod `pq` factors `pq` — the Rabin trapdoor and a reason the problem is hard without the factorization.

### S9. How do you find a non-residue without modular exponentiation?
Use the **Jacobi symbol** via quadratic reciprocity (a binary-gcd-like `O(log² p)` computation, no exponentiation). A Jacobi value `−1` guarantees a non-residue; it is often faster for small candidates `2, 3, 5`.

### S10. Is the non-residue search a side-channel risk?
No — it depends only on the public prime `p`, never on the secret `n`. The secret-dependent part (the loop on `t = n^Q`) is the side-channel concern.

### S11 (analysis). For an NTT prime like `998244353` (`S = 23`), which algorithm?
Tonelli-Shanks does up to `~23²` inner steps; Cipolla is `S`-independent. Cipolla (or a careful Tonelli-Shanks) is the safer choice; for the field of an EC curve, prefer a `≡ 3 (mod 4)` prime so neither is needed.

---

## Professional Questions (8 Q&A)

### P1. Prove the order-halving step is correct.
With `ord(c) = 2^M`, `ord(t) = 2^i` (`i < M`), set `b = c^(2^(M-i-1))`, so `ord(b) = 2^(i+1)` and `b^(2^i) = −1`. Also `t^(2^(i-1)) = −1` by minimality of `i`. Then `(tb²)^(2^(i-1)) = t^(2^(i-1))·b^(2^i) = (−1)(−1) = 1`, so `ord(tb²) | 2^(i-1)` — one factor of two removed. And `(Rb)² = (tn)b² = (tb²)n` preserves the invariant.

### P2. Prove termination.
The 2-adic valuation `v₂(ord(t))` starts at most `S − 1` (since `t = n^Q` is a square in the 2-Sylow group) and strictly decreases by one each round (P1). A nonnegative integer strictly decreasing reaches `0` (`t = 1`) in at most `S − 1` rounds.

### P3. Prove Euler's criterion.
`y = n^((p-1)/2)` satisfies `y² = 1` (Fermat), so `y = ±1`. QRs `n = x²` give `y = x^(p-1) = 1`. The polynomial `X^((p-1)/2) − 1` has ≤ `(p−1)/2` roots in the field `F_p`, and the `(p−1)/2` QRs are all of them; QNRs are non-roots, hence map to `−1`.

### P4. Derive the expected complexity for a random prime.
`Pr[v₂(p−1) ≥ k] ≈ 2^{-(k-1)}`, so `E[S] = O(1)` and `E[S²] = O(1)`. The loop is `O(S²)` mults; the exponentiations are `O(log p)` mults. Expected total: `O(log p)` modular multiplications.

### P5. Prove Cipolla's algorithm.
In `F_{p²} = F_p[ω]`, `ω² = w = a² − n` (a non-residue). Frobenius sends `ω ↦ −ω`, so the norm `N(a+ω) = (a+ω)(a−ω) = a² − w = n`. Then `R = (a+ω)^((p+1)/2)` gives `R² = (a+ω)^(p+1) = N(a+ω) = n`, and `R ∈ F_p` since the roots of `X² − n` lie in `F_p`.

### P6. Why is Tonelli-Shanks preferred over the primitive-root method for `k = 2`?
The primitive-root method (sibling `13`) needs a factorization of `p − 1` and a discrete log — both expensive. Tonelli-Shanks needs neither: just a non-residue (a coin flip) and `O(log² p)` work. Cipolla similarly avoids both.

### P7. Derive the composite root count.
By CRT, `x² ≡ n (mod m)` decomposes per prime-power factor. Each odd prime power contributes exactly `2` roots (Hensel-unique lift of `±x`) when `n` is a QR there, `0` otherwise; the `2`-part contributes `c₀ ∈ {0,1,2,4}` by `n mod 8`. The total is the product: `c₀ · 2^r` for `r` distinct odd primes.

### P8 (analysis). When does the worst-case `O(S² log p)` actually bite?
On constructed primes with large `S` — Proth primes `c·2^e + 1`, NTT primes `998244353` (`S = 23`), or any prime engineered for a high power of two in `p − 1`. There the `S²` term dominates and Cipolla's `S`-independent `O(log p)` wins, a genuine `Θ(log² p)` separation.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about replacing a brute-force search with a structured algorithm.
Look for a concrete story: a service computing modular square roots by trying every `x` (`O(p)`), profiled as the bottleneck, then switching to Tonelli-Shanks (`O(log² p)`) with a re-square correctness check against the old version on small inputs and a measured speedup.

### B2. A teammate's square-root job hangs on some inputs. How do you handle it?
Calmly diagnose: they likely ran the loop without Euler's criterion, so on a non-residue the inner order-search never terminates cleanly. Add the criterion gate before the loop, and the `n ≡ 0` / `p = 2` special cases. Frame it as a teaching moment about solvability.

### B3. Design square-root support for an elliptic-curve library.
Choose curve primes `≡ 3 (mod 4)` for the constant-time `n^((p+1)/4)` formula; use it for point decompression with on-curve validation (reject non-residue RHS). Fall back to Tonelli-Shanks/Cipolla only for non-`≡3` primes, and ensure overflow-safe modular multiply.

### B4. How would you explain modular square roots to a junior engineer?
Use clock arithmetic: "what number, squared on a clock of size `p`, lands on `n`?" Show the two roots `x` and `p − x` as mirror images, the metal-detector analogy for Euler's criterion (`+1` = treasure exists), and the one-button vending machine (`n^((p+1)/4)`) for the easy case. Lead with the two gotchas: non-residues have no root, and the modulus must be prime.

### B5. Your square-root service is slow under load. How do you investigate?
Profile: confirm the `p ≡ 3 (mod 4)` fast path is used when applicable, that Euler's criterion short-circuits non-residues, and that modular multiply is not falling back to bignum unnecessarily. For high-`S` primes, switch to Cipolla. Cache the per-prime non-residue `z`.

---

## Coding Challenges

### Challenge 1: Legendre Symbol

**Problem.** Given an odd prime `p` and integer `n`, return the Legendre symbol `(n/p)`: `+1` if `n` is a QR, `−1` if a non-residue, `0` if `p | n`.

**Example.**
```text
n = 2, p = 7   ->  1   (3² ≡ 2)
n = 3, p = 7   -> -1   (no root)
n = 7, p = 7   ->  0
```

**Constraints.** `3 ≤ p ≤ 10^{12}` (odd prime), any integer `n`.

**Approach.** Euler's criterion: compute `n^((p-1)/2) mod p`; map `p − 1` back to `−1`. `O(log p)`.

**Go.**
```go
package main

import "fmt"

func power(a, e, mod int64) int64 {
	a %= mod
	if a < 0 {
		a += mod
	}
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

func legendre(n, p int64) int64 {
	n %= p
	if n < 0 {
		n += p
	}
	if n == 0 {
		return 0
	}
	r := power(n, (p-1)/2, p)
	if r == p-1 {
		return -1
	}
	return r
}

func main() {
	fmt.Println(legendre(2, 7)) // 1
	fmt.Println(legendre(3, 7)) // -1
	fmt.Println(legendre(7, 7)) // 0
}
```

**Java.**
```java
public class Legendre {
    static long power(long a, long e, long mod) {
        a %= mod; if (a < 0) a += mod;
        long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % mod;
            a = a * a % mod;
            e >>= 1;
        }
        return r;
    }

    static long legendre(long n, long p) {
        n %= p; if (n < 0) n += p;
        if (n == 0) return 0;
        long r = power(n, (p - 1) / 2, p);
        return (r == p - 1) ? -1 : r;
    }

    public static void main(String[] args) {
        System.out.println(legendre(2, 7)); // 1
        System.out.println(legendre(3, 7)); // -1
        System.out.println(legendre(7, 7)); // 0
    }
}
```

**Python.**
```python
def legendre(n, p):
    n %= p
    if n == 0:
        return 0
    r = pow(n, (p - 1) // 2, p)
    return -1 if r == p - 1 else r


if __name__ == "__main__":
    print(legendre(2, 7))  # 1
    print(legendre(3, 7))  # -1
    print(legendre(7, 7))  # 0
```

---

### Challenge 2: Modular Square Root (Tonelli-Shanks)

**Problem.** Given an odd prime `p` and integer `n`, return both square roots of `n` mod `p` (sorted), or an empty result if none exists.

**Example.**
```text
n = 10, p = 13  ->  [6, 7]
n = 2,  p = 17  ->  [6, 11]
n = 5,  p = 13  ->  []      (non-residue)
```

**Constraints.** `3 ≤ p ≤ 10^9` (odd prime, fits 64-bit products), `0 ≤ n < p`.

**Approach.** Euler's criterion to gate; `p ≡ 3 (mod 4)` shortcut; else full Tonelli-Shanks. Return `{R, p − R}`. `O(log² p)`.

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

func power(a, e, mod int64) int64 {
	a %= mod
	if a < 0 {
		a += mod
	}
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

func legendre(n, p int64) int64 {
	r := power(n, (p-1)/2, p)
	if r == p-1 {
		return -1
	}
	return r
}

func sqrtMod(n, p int64) []int64 {
	n %= p
	if n == 0 {
		return []int64{0}
	}
	if legendre(n, p) != 1 {
		return nil
	}
	var R int64
	if p%4 == 3 {
		R = power(n, (p+1)/4, p)
	} else {
		Q, S := p-1, int64(0)
		for Q%2 == 0 {
			Q /= 2
			S++
		}
		z := int64(2)
		for legendre(z, p) != -1 {
			z++
		}
		M := S
		c := power(z, Q, p)
		t := power(n, Q, p)
		R = power(n, (Q+1)/2, p)
		for t != 1 {
			i, tmp := int64(0), t
			for tmp != 1 {
				tmp = tmp * tmp % p
				i++
			}
			b := c
			for j := int64(0); j < M-i-1; j++ {
				b = b * b % p
			}
			R = R * b % p
			c = b * b % p
			t = t * c % p
			M = i
		}
	}
	out := []int64{R, (p - R) % p}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	if out[0] == out[1] {
		return out[:1]
	}
	return out
}

func main() {
	fmt.Println(sqrtMod(10, 13)) // [6 7]
	fmt.Println(sqrtMod(2, 17))  // [6 11]
	fmt.Println(sqrtMod(5, 13))  // []
}
```

**Java.**
```java
import java.util.*;

public class SqrtMod {
    static long power(long a, long e, long mod) {
        a %= mod; if (a < 0) a += mod;
        long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % mod;
            a = a * a % mod;
            e >>= 1;
        }
        return r;
    }

    static long legendre(long n, long p) {
        long r = power(n, (p - 1) / 2, p);
        return (r == p - 1) ? -1 : r;
    }

    static List<Long> sqrtMod(long n, long p) {
        n %= p;
        if (n == 0) return List.of(0L);
        if (legendre(n, p) != 1) return List.of();
        long R;
        if (p % 4 == 3) {
            R = power(n, (p + 1) / 4, p);
        } else {
            long Q = p - 1, S = 0;
            while (Q % 2 == 0) { Q /= 2; S++; }
            long z = 2;
            while (legendre(z, p) != -1) z++;
            long M = S, c = power(z, Q, p), t = power(n, Q, p);
            R = power(n, (Q + 1) / 2, p);
            while (t != 1) {
                long i = 0, tmp = t;
                while (tmp != 1) { tmp = tmp * tmp % p; i++; }
                long b = c;
                for (long j = 0; j < M - i - 1; j++) b = b * b % p;
                R = R * b % p; c = b * b % p; t = t * c % p; M = i;
            }
        }
        long other = (p - R) % p;
        TreeSet<Long> set = new TreeSet<>(List.of(R, other));
        return new ArrayList<>(set);
    }

    public static void main(String[] args) {
        System.out.println(sqrtMod(10, 13)); // [6, 7]
        System.out.println(sqrtMod(2, 17));  // [6, 11]
        System.out.println(sqrtMod(5, 13));  // []
    }
}
```

**Python.**
```python
def legendre(n, p):
    r = pow(n % p, (p - 1) // 2, p)
    return -1 if r == p - 1 else r


def sqrt_mod(n, p):
    n %= p
    if n == 0:
        return [0]
    if legendre(n, p) != 1:
        return []
    if p % 4 == 3:
        R = pow(n, (p + 1) // 4, p)
    else:
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
    return sorted({R, (p - R) % p})


if __name__ == "__main__":
    print(sqrt_mod(10, 13))  # [6, 7]
    print(sqrt_mod(2, 17))   # [6, 11]
    print(sqrt_mod(5, 13))   # []
```

---

### Challenge 3: Square Root mod a Composite (factor + Hensel + CRT)

**Problem.** Given `n` and a factorization of `m` as a list of `(prime, exponent)` pairs, return all `x` with `x² ≡ n (mod m)`, sorted.

**Example.**
```text
n = 4, factors = [(5,1), (7,1)]   (m = 35)  ->  [2, 12, 23, 33]
```

**Constraints.** Odd primes; product fits 64-bit.

**Approach.** Root each prime via Tonelli-Shanks, Hensel-lift to `p^e`, take the Cartesian product of per-factor root sets, CRT-combine. Count is the product of per-factor counts.

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

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

func legendre(n, p int64) int64 {
	r := power(n%p, (p-1)/2, p)
	if r == p-1 {
		return -1
	}
	return r
}

func tonelli(n, p int64) (int64, bool) {
	n %= p
	if n == 0 {
		return 0, true
	}
	if legendre(n, p) != 1 {
		return 0, false
	}
	if p%4 == 3 {
		return power(n, (p+1)/4, p), true
	}
	Q, S := p-1, int64(0)
	for Q%2 == 0 {
		Q /= 2
		S++
	}
	z := int64(2)
	for legendre(z, p) != -1 {
		z++
	}
	M, c, t, R := S, power(z, Q, p), power(n, Q, p), power(n, (Q+1)/2, p)
	for t != 1 {
		i, tmp := int64(0), t
		for tmp != 1 {
			tmp = tmp * tmp % p
			i++
		}
		b := c
		for j := int64(0); j < M-i-1; j++ {
			b = b * b % p
		}
		R = R * b % p
		c = b * b % p
		t = t * c % p
		M = i
	}
	return R, true
}

func egcd(a, b int64) (int64, int64, int64) {
	if b == 0 {
		return a, 1, 0
	}
	g, x, y := egcd(b, a%b)
	return g, y, x - (a/b)*y
}

func invMod(a, m int64) int64 {
	_, x, _ := egcd((a%m+m)%m, m)
	return (x%m + m) % m
}

func ipow(a, e int64) int64 {
	r := int64(1)
	for i := int64(0); i < e; i++ {
		r *= a
	}
	return r
}

func main() {
	n := int64(4)
	factors := [][2]int64{{5, 1}, {7, 1}}
	mods := []int64{}
	rootSets := [][]int64{}
	for _, f := range factors {
		p, e := f[0], f[1]
		pe := ipow(p, e)
		x, ok := tonelli(((n%p)+p)%p, p)
		if !ok {
			fmt.Println("no roots")
			return
		}
		mod := p
		for mod < pe {
			mod *= p
			inv := invMod(2*x%mod, mod)
			x = ((x-(x*x-n)%mod*inv)%mod + mod) % mod
		}
		mods = append(mods, pe)
		set := map[int64]bool{x % pe: true, (pe - x) % pe: true}
		var rs []int64
		for k := range set {
			rs = append(rs, k)
		}
		sort.Slice(rs, func(i, j int) bool { return rs[i] < rs[j] })
		rootSets = append(rootSets, rs)
	}
	// CRT over the cartesian product
	combos := [][]int64{{}}
	for _, rs := range rootSets {
		var next [][]int64
		for _, combo := range combos {
			for _, r := range rs {
				c := append(append([]int64{}, combo...), r)
				next = append(next, c)
			}
		}
		combos = next
	}
	results := map[int64]bool{}
	for _, combo := range combos {
		R, Mod := int64(0), int64(1)
		for i, r := range combo {
			m := mods[i]
			diff := ((r-R)%m + m) % m
			R = (R + Mod*(diff*invMod(Mod%m, m)%m)) % (Mod * m)
			Mod *= m
		}
		results[(R%Mod+Mod)%Mod] = true
	}
	var out []int64
	for k := range results {
		out = append(out, k)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	fmt.Println(out) // [2 12 23 33]
}
```

**Java.**
```java
import java.util.*;

public class SqrtComposite {
    static long power(long a, long e, long m) {
        a %= m; long r = 1;
        while (e > 0) { if ((e & 1) == 1) r = r * a % m; a = a * a % m; e >>= 1; }
        return r;
    }
    static long legendre(long n, long p) {
        long r = power((n % p + p) % p, (p - 1) / 2, p);
        return (r == p - 1) ? -1 : r;
    }
    static long tonelli(long n, long p) {
        n = (n % p + p) % p;
        if (n == 0) return 0;
        if (legendre(n, p) != 1) return -1;
        if (p % 4 == 3) return power(n, (p + 1) / 4, p);
        long Q = p - 1, S = 0; while (Q % 2 == 0) { Q /= 2; S++; }
        long z = 2; while (legendre(z, p) != -1) z++;
        long M = S, c = power(z, Q, p), t = power(n, Q, p), R = power(n, (Q + 1) / 2, p);
        while (t != 1) {
            long i = 0, tmp = t; while (tmp != 1) { tmp = tmp * tmp % p; i++; }
            long b = c; for (long j = 0; j < M - i - 1; j++) b = b * b % p;
            R = R * b % p; c = b * b % p; t = t * c % p; M = i;
        }
        return R;
    }
    static long[] egcd(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = egcd(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }
    static long inv(long a, long m) { long x = egcd((a % m + m) % m, m)[1]; return (x % m + m) % m; }
    static long ipow(long a, long e) { long r = 1; for (long i = 0; i < e; i++) r *= a; return r; }

    public static void main(String[] args) {
        long n = 4;
        long[][] factors = {{5, 1}, {7, 1}};
        List<Long> mods = new ArrayList<>();
        List<List<Long>> rootSets = new ArrayList<>();
        for (long[] f : factors) {
            long p = f[0], e = f[1], pe = ipow(p, e);
            long x = tonelli(n % p, p);
            long mod = p;
            while (mod < pe) { mod *= p; long iv = inv(2 * x % mod, mod);
                x = ((x - (x * x - n) % mod * iv) % mod + mod) % mod; }
            mods.add(pe);
            rootSets.add(new ArrayList<>(new TreeSet<>(List.of(x % pe, (pe - x) % pe))));
        }
        List<long[]> combos = new ArrayList<>(); combos.add(new long[0]);
        for (List<Long> rs : rootSets) {
            List<long[]> next = new ArrayList<>();
            for (long[] combo : combos) for (long r : rs) {
                long[] c = Arrays.copyOf(combo, combo.length + 1); c[combo.length] = r; next.add(c);
            }
            combos = next;
        }
        TreeSet<Long> results = new TreeSet<>();
        for (long[] combo : combos) {
            long R = 0, Mod = 1;
            for (int i = 0; i < combo.length; i++) {
                long m = mods.get(i), diff = ((combo[i] - R) % m + m) % m;
                R = (R + Mod * (diff * inv(Mod % m, m) % m)) % (Mod * m);
                Mod *= m;
            }
            results.add((R % Mod + Mod) % Mod);
        }
        System.out.println(results); // [2, 12, 23, 33]
    }
}
```

**Python.**
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


def crt_pair(r1, m1, r2, m2):
    g = gcd(m1, m2)
    assert (r2 - r1) % g == 0
    lcm = m1 // g * m2
    inv = pow((m1 // g) % (m2 // g), -1, m2 // g)
    return (r1 + m1 * (((r2 - r1) // g * inv) % (m2 // g))) % lcm, lcm


def sqrt_composite(n, factors):
    mods, root_sets = [], []
    for p, e in factors:
        pe = p ** e
        x = tonelli(n % p, p)
        if x is None:
            return []
        mod = p
        while mod < pe:
            mod *= p
            x = (x - (x * x - n) * pow(2 * x % mod, -1, mod)) % mod
        mods.append(pe)
        root_sets.append(sorted({x % pe, (pe - x) % pe}))
    out = set()
    for combo in product(*root_sets):
        R, M = 0, 1
        for r, m in zip(combo, mods):
            R, M = crt_pair(R, M, r, m)
        out.add(R)
    return sorted(out)


if __name__ == "__main__":
    print(sqrt_composite(4, [(5, 1), (7, 1)]))  # [2, 12, 23, 33]
```

---

Next step: [`tasks.md`](./tasks.md) — graded practice tasks (beginner, intermediate, advanced) in Go, Java, and Python.
