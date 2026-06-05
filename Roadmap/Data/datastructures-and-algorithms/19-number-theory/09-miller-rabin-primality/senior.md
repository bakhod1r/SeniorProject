# Miller-Rabin Primality Testing — Senior Level

> Miller-Rabin is rarely the bottleneck on one small number — but the moment you generate cryptographic primes, test billions of candidates, run inside a constant-time security boundary, or must guarantee an exact verdict for every 64-bit input, every detail (mulmod overflow, Montgomery speed, base-set provenance, side channels, BPSW fallback, failure modes) becomes a correctness or security incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Deterministic vs Probabilistic in Production](#2-deterministic-vs-probabilistic-in-production)
3. [Montgomery Multiplication for Speed](#3-montgomery-multiplication-for-speed)
4. [Cryptographic Prime Generation](#4-cryptographic-prime-generation)
5. [Side-Channel and Constant-Time Notes](#5-side-channel-and-constant-time-notes)
6. [BPSW: The Stronger Alternative](#6-bpsw-the-stronger-alternative)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is no longer "how does the witness loop work" but "what system am I building, and what breaks when I scale or harden it?". Miller-Rabin shows up in three production guises that share one engine:

1. **Exact 64-bit testing at volume** — a hot path that classifies billions of candidates (factoring pre-filters, number-theoretic search, competitive judges). The answer must be exact and the per-call cost in the tens of nanoseconds.
2. **Cryptographic prime generation** — producing 1024/2048/3072-bit primes for RSA/DH key generation. Here `n` exceeds any finite proven base set, so the test is probabilistic, the error budget is a security parameter, and timing leaks matter.
3. **Library primality APIs** — a general `isPrime(n)` that must be correct across all input sizes, composing deterministic sets for small `n` and BPSW or many-round MR for large `n`.

All three reduce to: *decompose `n-1 = d·2^s`, run the witness loop over a chosen base set with an overflow-safe, ideally Montgomery, modular multiply, and pick the base policy (fixed-proven vs random) by the input range and threat model.* This document treats those decisions in production terms.

The four senior-level decisions, recurring across all three guises:

1. **Base policy** — fixed proven set (exact, `n < 2^64`) vs random bases (unbounded `n`) vs BPSW (robust default).
2. **mulmod implementation** — `__int128` (simple), doubling (portable, `n < 2^63`), or Montgomery (fastest for volume).
3. **Pre-filtering** — small-prime sieve to reject most composites before any exponentiation.
4. **Threat model** — is `n` public (early-exit fine) or secret/adversarial (constant-time, random bases, vetted library)?

Get these four right and Miller-Rabin is correct, fast, and safe across all three production guises; get any wrong and you have a silent correctness or security bug.

---

## 2. Deterministic vs Probabilistic in Production

### 2.1 The decision rule

| Input range | Policy | Why |
|-------------|--------|-----|
| `n < 2^64` | **deterministic**, fixed proven base set | exact, no RNG, no error; the 12-base or 7-base set is provably complete |
| `n ≥ 2^64` (crypto sizes) | **probabilistic**, `k` random bases (or BPSW) | no finite proven set exists for unbounded `n`; choose `k` for a security-grade error bound |
| mixed library API | branch on `bitlen(n)` | small `n` deterministic, large `n` random/BPSW |

For `n < 2^64` there is *never* a reason to be probabilistic: the proven base sets (Section in `middle.md` and `professional.md`) make it exact at the same cost. Randomness only enters when `n` is unbounded.

### 2.4 A unified library shape

A robust general-purpose `isPrime` composes the policies by size:

```text
isPrime(n):
    if n < 2: return false
    small-prime sieve (trial-divide by primes < ~1000)   # handles tiny n and most composites
    if n < 2^64:
        return deterministic MR with the 7- or 12-base proven set   # exact, no RNG
    else:
        return BPSW (MR base 2 + strong Lucas)                       # or many random MR rounds
                  [+ extra random MR rounds for paranoia]
```

This single function is exact below `2^64` and extremely reliable above it, with no caller-visible randomness for the common (64-bit) case. The branch on `bitlen(n)` is the senior's idiom: pay for randomness/Lucas only when the input range forces it.

### 2.2 Choosing the random base set carefully

A classic production bug: using *fixed small* bases (`2,3,5,…`) for arbitrary large `n`. Adversaries can construct composites that are strong pseudoprimes to any *published, fixed* small base set (Arnault's constructions). For unbounded `n`, **draw bases uniformly at random** from `[2, n-2]` per test, so no attacker can predict or precompute a fooling `n`. The `≤ (1/4)^k` bound assumes *random* bases; it does not protect a fixed-base test against adversarial inputs.

### 2.3 Error budget for crypto

For random `n` of cryptographic size, the *average-case* error after `k` rounds is far below the worst-case `(1/4)^k` (Damgård-Landrock-Pomerance bounds: for a random 1024-bit candidate, even a handful of rounds gives error `< 2^{-80}`). Standards (FIPS 186-4/186-5) prescribe round counts by bit length (e.g. 5 rounds for 1024-bit, 4 for 1536-bit, plus a Lucas test for BPSW-style assurance). The senior move is to follow the standard's table, not to hand-pick `k`.

---

## 3. Montgomery Multiplication for Speed

### 3.1 Why `% n` is the cost

In `powMod`, the dominant cost is the modular reduction `x % n` after each multiply — a hardware division, far slower than the multiply itself. **Montgomery multiplication** replaces every `% n` in the inner loop with multiplications and shifts, eliminating division from the hot path. For repeated multiplication modulo a *fixed* `n` — exactly Miller-Rabin's pattern — this is the single biggest speedup, often 2-4×.

### 3.2 The idea

Work in **Montgomery form**: represent `x` as `x̄ = x · R mod n`, where `R = 2^64` (a power of two ≥ `n`). The Montgomery product

```
REDC(x̄ · ȳ) = x·y·R mod n = (xy)‾
```

computes the modular product in Montgomery form using only multiplications, additions, and shifts by 64 bits (`R` is a power of two, so "divide by `R`" is a shift, and "mod `R`" is a mask). The one-time setup per `n` computes `n' = -n^{-1} mod 2^64` and `R² mod n`. Conversion in/out of Montgomery form is itself a REDC.

### 3.3 When it pays

| Situation | Use Montgomery? |
|-----------|------------------|
| One-off test of a single small `n` | no — `__int128` mulmod is simpler and fine |
| Hot loop testing billions of `n` | yes — amortize the per-`n` setup across many muls |
| Crypto prime generation (big `n`) | yes — multi-precision Montgomery is standard in GMP/OpenSSL |
| `n < 2^63` portable, no wide type | doubling trick or Montgomery; Montgomery wins on volume |

The per-`n` setup (computing `n'`) is a few operations, so it amortizes after just a few multiplications — and a single Miller-Rabin test already does dozens.

### 3.4 The REDC step in detail

Montgomery reduction `REDC(T)` for `T < n·R` computes `T·R^{-1} mod n` without division:

```
REDC(T):
    m = (T mod R) · n' mod R      # n' = -n^{-1} mod R; both are mask + multiply
    t = (T + m·n) / R             # exact division by R = right shift by 64
    if t >= n: t -= n             # single conditional subtraction
    return t
```

Every operation is a 64-bit multiply, an add, a mask, or a shift — no hardware division. A Montgomery multiply is `REDC(x̄ · ȳ)`. The only branch is the final conditional subtraction, which can be made constant-time (subtract `n` and conditionally add it back via a mask) when side channels matter.

### 3.5 When NOT to use Montgomery

Montgomery requires **odd** `n` (it inverts `n` mod a power of two), which is fine since all primality candidates past `2` are odd. But for a *single* test of a *small* `n`, the setup and form-conversion overhead is not worth it — a plain `__int128` mulmod is simpler and competitive. Montgomery wins decisively only when many multiplications share one modulus: one full Miller-Rabin test (dozens of muls), and especially batched/crypto workloads (millions).

---

## 4. Cryptographic Prime Generation

### 4.1 The generate-and-test loop

To produce a `b`-bit prime:

```
loop:
    n = random odd b-bit integer with top bit set
    if n passes small-prime sieve (trial divide by primes < ~2000):
        if MillerRabin(n, k rounds) (optionally + Lucas for BPSW):
            return n
```

By the prime number theorem, about `1 / ln(2^b) ≈ 1/(0.69·b)` of `b`-bit numbers are prime, so for 1024-bit you expect ~`710` candidates; the **small-prime sieve** rejects the vast majority cheaply (a number with a tiny factor never reaches the expensive MR rounds). This sieve is the performance backbone of key generation.

Concretely, restricting to *odd* candidates halves the field (only ~`355` odd candidates expected), and sieving by the primes up to a few thousand removes another large fraction (a random number is divisible by 3 with probability `1/3`, by 5 with `1/5`, etc.), so only a handful of candidates per generated prime ever reach the costly Miller-Rabin rounds. The expensive big-integer exponentiations therefore dominate the *successful* path but run rarely on the rejected path — which is why the cheap sieve is disproportionately valuable.

### 4.2 Safe and strong primes

RSA/DH sometimes require **safe primes** (`p` such that `(p-1)/2` is also prime) or **strong primes** (constraints on `p±1` factorizations). Generation then nests two primality tests, or uses incremental sieving over an arithmetic progression. Each candidate still bottoms out in Miller-Rabin (or BPSW), so a fast, correct MR is the foundation.

### 4.4 Incremental sieving for speed

A faster generate-and-test variant: pick one random odd base `n_0`, then test `n_0, n_0+2, n_0+4, …` until a prime is found, using a **precomputed sieve of residues** modulo small primes. Maintain an array of `n_0 mod p` for each small prime `p`; stepping by 2 updates these residues in `O(1)` each, and any candidate with a zero residue is skipped without a modular exponentiation. This amortizes the small-prime trial division across the whole window and is how OpenSSL/GMP generate primes efficiently. The first survivor goes to Miller-Rabin.

### 4.5 Validating an externally supplied prime

A different scenario: a peer hands you a "prime" `p` (e.g. DH group parameters) and you must verify it. Treat `p` as **adversarial** — do not trust a fixed small base set beyond its bound. Use BPSW (no known counterexample) and/or many *random* MR rounds with a CSPRNG. If the value is a standardized group (RFC-published), prefer a known-good constant over re-validating. The threat model differs from generation: here you did not choose `p`, so an attacker may have crafted it to pass a predictable test.

### 4.3 Round count as a security parameter

The number of MR rounds `k` trades speed for assurance. For *random* candidates the average error is tiny, but key generation is one-shot and high-stakes, so standards over-provision (e.g. FIPS tables). For *externally supplied* primes (e.g. validating a peer's DH parameters), treat the input as adversarial: use BPSW or a large number of *random* bases, never a fixed small set.

---

## 5. Side-Channel and Constant-Time Notes

### 5.1 Why timing matters

In key generation the *value* `n` is secret. A naive `powMod` whose branch pattern, memory access, or early-exit depends on the bits of `n` (or of a base) can leak information through timing or cache side channels. The early-exit in the witness loop (`return false` as soon as `-1` is seen) is data-dependent — fine for public inputs, a potential leak for secret ones.

### 5.2 Mitigations

- **Constant-time modular exponentiation:** Montgomery ladder or fixed-window exponentiation with no secret-dependent branches; always perform the same multiply sequence.
- **Avoid secret-dependent early exits** in code paths handling secret `n`; for public `n` (e.g. judging a competitive-programming input) early exit is fine and faster.
- **Blinding:** randomize bases (already standard) so the operation sequence is not attacker-controlled.
- **Use vetted libraries** (OpenSSL `BN_is_prime_ex`, GMP `mpz_probab_prime_p`, Go `math/big.ProbablyPrime`) for crypto, rather than hand-rolling — they have had the side-channel work done.

The senior judgment: a competitive-programming or analytics MR can early-exit freely; a *cryptographic* MR over secret `n` must be constant-time and is best delegated to an audited library.

### 5.3 The two threat models, contrasted

| Aspect | Public `n` (judge, analytics) | Secret `n` (key generation) |
|--------|-------------------------------|------------------------------|
| Early exit in witness loop | fine, faster | leaks via timing — avoid |
| Base selection | any (fixed proven set) | random/blinded, CSPRNG |
| Exponentiation | plain fast power | constant-time ladder |
| mulmod | `__int128`/Montgomery | constant-time Montgomery |
| Implementation | hand-rolled OK | audited library preferred |

Conflating the two is a classic mistake: shipping a fast, branchy, early-exiting MR into a key generator leaks bits of the secret prime through timing. The cost of constant-time operation (no secret-dependent branches, always the full operation sequence) is a modest slowdown — acceptable because key generation is one-shot, not a hot loop.

---

## 6. BPSW: The Stronger Alternative

### 6.1 What BPSW is

The **Baillie-PSW** test combines **one** Miller-Rabin test to base 2 with a **strong Lucas probable prime** test (a different recurrence-based check). The two tests have "orthogonal" failure modes, and:

> **No composite is known to pass BPSW**, and it is proven there are none below `2^64`.

So BPSW is, in practice, a deterministic test for 64-bit numbers using only *two* checks instead of twelve, and it remains extremely reliable beyond `2^64` (no counterexample has ever been found, though none is proven for all `n`).

### 6.2 Why combine MR with Lucas

Miller-Rabin pseudoprimes (composites passing MR for a given base) and Lucas pseudoprimes are believed to be disjoint in the relevant range — a number fooling one almost never fools the other. BPSW exploits this. The cost is one MR round plus one Lucas test, both `O(log³ n)`.

### 6.3 When to choose what

| Goal | Recommendation |
|------|----------------|
| Exact, `n < 2^64`, simplest code | deterministic MR, 7- or 12-base set |
| Exact, `n < 2^64`, fewest operations | BPSW (MR base 2 + Lucas) |
| Unbounded `n`, high assurance | BPSW + extra random MR rounds |
| Crypto key gen | standard-prescribed MR rounds (+ optionally Lucas) |

BPSW is the senior's default for a general-purpose library because it is fast, has no known counterexample, and avoids the "fixed small base is adversarially fooled" pitfall.

### 6.4 What libraries actually do

Surveying production implementations clarifies the consensus:

- **Python `sympy.isprime`** uses BPSW (MR + strong Lucas) plus a few extra MR bases — effectively exact for all practical inputs.
- **Java `BigInteger.isProbablePrime(certainty)`** runs MR rounds and, for larger numbers, adds a Lucas-Lehmer-style test (a BPSW-like combination) so it resists the MR-only adversarial pseudoprimes.
- **Go `math/big.ProbablyPrime(n)`** runs `n` MR rounds *and* one Baillie-PSW (a strong Lucas test) — the docs explicitly note no known composite passes BPSW, so it is effectively deterministic in practice.
- **GMP `mpz_probab_prime_p`** runs trial division then MR rounds (recent versions add BPSW).

The pattern is universal: a small-prime sieve, MR, and a Lucas component for robustness. Hand-rolling MR is fine for `n < 2^64` with a proven base set; for anything larger or adversarial, defer to these.

### 6.5 BPSW's cost relative to 12-base MR

A 12-base deterministic MR does twelve full exponentiation+squaring passes. BPSW does **one** MR pass (base 2) plus **one** strong Lucas pass. The Lucas pass is comparable in cost to one MR pass (a base computation plus `s'` doublings on the Lucas recurrence), so BPSW is roughly `2/12 ≈ 1/6` the work of 12-base MR while being at least as reliable below `2^64`. This is why BPSW is attractive for high-throughput exact 64-bit testing — fewer operations, same exactness.

---

## 7. Code Examples

### 7.1 Go — deterministic 64-bit MR with `bits`-based mulmod and Montgomery option

```go
package main

import (
	"fmt"
	"math/bits"
)

// mulMod computes a*b mod n using a 128-bit product (no overflow, full 2^64 range).
func mulMod(a, b, n uint64) uint64 {
	hi, lo := bits.Mul64(a, b)
	_, rem := bits.Div64(hi%n, lo, n) // hi%n keeps the high word < n for Div64
	return rem
}

func powMod(a, e, n uint64) uint64 {
	res := uint64(1) % n
	a %= n
	for e > 0 {
		if e&1 == 1 {
			res = mulMod(res, a, n)
		}
		a = mulMod(a, a, n)
		e >>= 1
	}
	return res
}

func isComposite(n, a uint64) bool {
	if a%n == 0 {
		return false
	}
	d, s := n-1, 0
	for d&1 == 0 {
		d >>= 1
		s++
	}
	x := powMod(a, d, n)
	if x == 1 || x == n-1 {
		return false
	}
	for r := 0; r < s-1; r++ {
		x = mulMod(x, x, n)
		if x == n-1 {
			return false
		}
	}
	return true
}

func IsPrime(n uint64) bool {
	if n < 2 {
		return false
	}
	small := []uint64{2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37}
	for _, p := range small {
		if n%p == 0 {
			return n == p
		}
	}
	// 7-base set proven sufficient for all n < 2^64 (Sinclair).
	for _, a := range []uint64{2, 325, 9375, 28178, 450775, 9780504, 1795265022} {
		if isComposite(n, a) {
			return false
		}
	}
	return true
}

func main() {
	fmt.Println(IsPrime(561))                  // false
	fmt.Println(IsPrime(2147483647))           // true
	fmt.Println(IsPrime(3825123056546413051))  // false (strong pseudoprime to many small bases)
	fmt.Println(IsPrime(18446744073709551557)) // largest prime < 2^64
}
```

### 7.2 Java — generate-and-test for a probable prime (crypto-style loop)

```java
import java.math.BigInteger;
import java.security.SecureRandom;

public class PrimeGen {
    static final SecureRandom RNG = new SecureRandom();

    // Trial-divide by small primes as a cheap sieve.
    static boolean passesSieve(BigInteger n) {
        int[] small = {3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47};
        for (int p : small) {
            BigInteger P = BigInteger.valueOf(p);
            if (n.mod(P).signum() == 0) return n.equals(P);
        }
        return true;
    }

    // BigInteger.isProbablePrime runs MR (+ Lucas for larger n) internally.
    static BigInteger generatePrime(int bits, int certainty) {
        while (true) {
            BigInteger n = new BigInteger(bits, RNG).setBit(bits - 1).setBit(0); // odd, top bit set
            if (!passesSieve(n)) continue;
            if (n.isProbablePrime(certainty)) return n;
        }
    }

    public static void main(String[] args) {
        BigInteger p = generatePrime(512, 40); // error < 2^-40
        System.out.println("prime: " + p);
        System.out.println("verified: " + p.isProbablePrime(64));
    }
}
```

### 7.3 Python — Montgomery-free deterministic test plus a BPSW-style Lucas check

```python
def _is_composite(n, a, d, s):
    x = pow(a, d, n)
    if x in (1, n - 1):
        return False
    for _ in range(s - 1):
        x = x * x % n
        if x == n - 1:
            return False
    return True


def miller_rabin(n, bases):
    if n < 2:
        return False
    for p in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        if n % p == 0:
            return n == p
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    return all(not _is_composite(n, a, d, s) for a in bases)


# Deterministic for all n < 2^64 with the 7-base set.
DET64 = (2, 325, 9375, 28178, 450775, 9780504, 1795265022)


def is_prime_64(n):
    return miller_rabin(n, DET64)


def _lucas_strong_prp(n):
    """Strong Lucas probable-prime test (the second half of BPSW)."""
    if n % 2 == 0 or _is_square(n):
        return n == 2
    # Selfridge parameter D: first D in 5,-7,9,... with Jacobi(D,n) = -1
    D, sign = 5, 1
    while True:
        if _jacobi(D * sign, n) == -1:
            D *= sign
            break
        sign = -sign
        D += 2
    P, Q = 1, (1 - D) // 4
    d, s = n + 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    U, V, Qk = _lucas_uv(d, P, Q, n)
    if U == 0 or V == 0:
        return True
    for _ in range(s - 1):
        V = (V * V - 2 * Qk) % n
        Qk = Qk * Qk % n
        if V == 0:
            return True
    return False


def bpsw(n):
    if n < 2:
        return False
    if not miller_rabin(n, (2,)):
        return False
    return _lucas_strong_prp(n)
```

(`_jacobi`, `_is_square`, `_lucas_uv` are standard helpers; the point is the *composition* — MR base 2 plus a strong Lucas test, with no known counterexample.)

---

## 8. Observability and Testing

A primality verdict is opaque — one wrong "prime" looks like any other boolean. Build in checks.

| Check | Why |
|-------|-----|
| Cross-check vs trial division for all `n ≤ 10^6` | catches witness-loop, decomposition, and mulmod bugs |
| Carmichael battery (`561, 1105, 1729, 2465, 2821, 6601, 8911, 10585, 15841`) | must all report **composite** |
| Strong-pseudoprime battery (`2047`, `1373653`, `25326001`, `3215031751`, `3825123056546413051`) | the exact numbers each small base set fails on — confirms your base set is large enough |
| Largest 64-bit prime `18446744073709551557` | exercises the full-range mulmod (no overflow) |
| `IsPrime(2) == true`, `IsPrime(1) == false`, even `n` | boundary handling |
| Determinism across languages | same `n` → identical Go/Java/Python verdict |
| Random cross-check vs a reference (`gmpy2`, `BigInteger`) on millions of `n` | high-volume confidence |

The single most valuable test is the **trial-division oracle on `n ≤ 10^6` plus the Carmichael battery**: it catches the Fermat-only mistake (Carmichael passing) and the off-by-one in the squaring loop, which together account for most real bugs.

### 8.0 The mulmod overflow test, specifically

The most insidious bug — a `mulmod` that overflows only for `n` near `2^64` — passes every small-number test silently. Pin a dedicated test:

```text
assert IsPrime(18446744073709551557) == True    # largest prime < 2^64
assert IsPrime(18446744073709551615) == False    # 2^64 - 1 = 3·5·17·257·641·65537·6700417
assert IsPrime(18446744073709551533) == True
```

If `mulmod` overflows, the largest-prime test flips to `False`. This single assertion is the difference between a correct full-range 64-bit test and one that works only on small inputs — run it in CI on every build.

### 8.1 A property-test battery

```text
for random n in a range with a known reference:
    assert IsPrime(n) == reference_is_prime(n)
for each Carmichael number c:
    assert IsPrime(c) == False
for each strong-pseudoprime threshold value v:
    assert IsPrime(v) == reference(v)        # base set must be large enough
assert IsPrime(largest_prime_below_2^64) == True   # mulmod overflow guard
```

### 8.2 Production guardrails

For a service classifying numbers at scale, add: a **range assertion** routing `n < 2^64` to the deterministic path and `n ≥ 2^64` to BPSW/random-MR; a **counter** of how many candidates die in the small-prime sieve vs reach MR (a sieve hit-rate far from ~80% on random inputs signals a bug); and, for crypto, a **second independent verification** of any generated prime with a different library before use.

---

## 9. Failure Modes

### 9.1 mulmod overflow

`a*b` overflowing 64 bits silently corrupts every downstream value, producing plausible-but-wrong verdicts (often "composite" for primes, sometimes the reverse). Mitigation: `__int128`/`bits.Mul64`/`BigInteger`/Montgomery, and the largest-prime test that exercises the full range.

### 9.2 Fixed small bases on adversarial input

Using `{2,3,5,7,…}` for unbounded `n` lets an attacker craft a composite that passes (Arnault). Mitigation: random bases (or BPSW) for `n ≥ 2^64`; proven fixed sets *only* within their certified bound.

### 9.3 Fermat-only logic

Shipping `a^(n-1) ≡ 1` without the `-1` chain check lets Carmichael numbers pass. Mitigation: the Carmichael battery in CI.

### 9.4 Off-by-one in `s`

Squaring `s` times instead of `s-1` (or testing the wrong values for `-1`) misclassifies some primes/composites. Mitigation: trial-division cross-check on small `n`.

### 9.5 Wrong base set for the range

Using `{2,3}` (valid only `< 1373653`) on larger `n` lets composites slip through deterministically — no randomness to save you. Mitigation: pick the base set from the *proven* table by your guaranteed bound, and assert the bound.

### 9.6 Non-constant-time over secret `n`

A crypto key generator whose timing depends on the secret candidate leaks bits. Mitigation: constant-time exponentiation, random base blinding, or a vetted library.

### 9.7 Treating "probable prime" as "certified prime"

For `n ≥ 2^64`, MR (and BPSW) is probabilistic/heuristic; calling the result a *certificate* is wrong. Mitigation: if a re-verifiable certificate is required, use ECPP or a Pratt/Pocklington certificate, not MR alone.

### 9.8 RNG misuse in probabilistic mode

Seeding the base RNG predictably (or with a non-cryptographic RNG in a security context) makes the `(1/4)^k` bound meaningless against an adversary. Mitigation: `SecureRandom`/CSPRNG for crypto; document that the analytics path uses a fast PRNG only because inputs are non-adversarial.

---

## 10. Summary

- For `n < 2^64`, choose **deterministic** Miller-Rabin with a *proven* base set (12-prime or 7-base); it is exact at the same cost as probabilistic — randomness is only for unbounded `n`.
- For unbounded `n`, use **random** bases (never fixed small ones, which adversaries fool) and size the round count to a standard-prescribed error bound; or use **BPSW** (MR base 2 + strong Lucas), which has no known counterexample.
- **Montgomery multiplication** removes the division from the hot `powMod` loop and is the dominant speedup for high-volume or big-integer testing; a simple `__int128` mulmod suffices for one-off small `n`.
- **Cryptographic prime generation** is a sieve-then-MR generate-and-test loop; the small-prime sieve does most of the rejecting, and the round count is a security parameter set by standards.
- **Side channels** matter only when `n` is secret (key gen): then exponentiation must be constant-time and bases blinded — prefer an audited library.
- **Testing** lives in the trial-division oracle, the Carmichael battery, the strong-pseudoprime thresholds, and the largest-64-bit-prime mulmod check; these catch nearly every real bug.

### Decision summary

- **`n < 2^64`, exact, simple** → deterministic MR, 7-base set, `__int128` mulmod.
- **`n < 2^64`, fewest ops** → BPSW (MR base 2 + Lucas).
- **High-volume 64-bit classification** → deterministic MR + Montgomery mulmod + small-prime sieve.
- **Crypto prime generation** → sieve + standard-round MR (+ Lucas), CSPRNG bases, constant-time, vetted library.
- **Unbounded / adversarial `n`** → BPSW and/or many random MR rounds; never fixed small bases.
- **Need a re-verifiable certificate** → ECPP / Pratt, not MR.

### Production checklist

- [ ] Small-prime sieve before any modular exponentiation.
- [ ] Range branch: deterministic proven set for `n < 2^64`, BPSW/random for larger.
- [ ] Overflow-safe mulmod, with the largest-64-bit-prime test in CI.
- [ ] Montgomery form on hot/high-volume paths.
- [ ] Random (CSPRNG) bases for unbounded/adversarial `n`; never fixed small bases past their bound.
- [ ] Constant-time exponentiation and a vetted library when `n` is secret.
- [ ] Carmichael battery + strong-pseudoprime thresholds + cross-language determinism in tests.

References to study further: Pomerance-Selfridge-Wagstaff (pseudoprime tables), Jaeschke and Sorenson-Webster (deterministic 64-bit base sets), Baillie-Wagstaff (BPSW / Lucas), Damgård-Landrock-Pomerance (average-case error bounds), Montgomery (1985, modular multiplication), FIPS 186-5 (round-count tables), and sibling topic `10-matrix-exponentiation` (`19-number-theory`) for the fast-power machinery.
