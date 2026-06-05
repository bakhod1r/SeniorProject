# Miller-Rabin Primality Testing — Interview Preparation

Miller-Rabin is a favourite interview topic because it rewards one crisp insight — *"a prime modulus has no nontrivial square roots of 1, so watch the squaring chain `a^d, a^(2d), …` for `1` and `-1`"* — and then tests whether you can (a) explain why the plain Fermat test fails (Carmichael numbers), (b) write the `n-1 = d·2^s` decomposition and witness loop correctly, (c) state the `≤ 1/4` error bound and the deterministic 64-bit base sets, and (d) implement an **overflow-safe mulmod**. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Is `n` prime, quickly? | Miller-Rabin witness loop | `O(k log³ n)` |
| Is `n` prime, exactly, `n < 2^64`? | deterministic MR, proven base set | `O(log³ n)` |
| Why is the Fermat test not enough? | Carmichael numbers fool it | — |
| What proves `n` composite? | a witness base `a` | `a^d ≠ ±1` and no `-1` after `s-1` squarings |
| Error per random base | Rabin's bound | `≤ 1/4` |
| `k` random bases | independent trials | `≤ (1/4)^k` |
| Avoid 64-bit overflow | `__int128` / doubling / Montgomery mulmod | — |

The witness loop (the heart of everything):

```text
isComposite(n, a):                 # returns True if a is a WITNESS
    write n-1 = d·2^s   (d odd)
    x = a^d mod n
    if x == 1 or x == n-1: return False     # passes this base
    repeat s-1 times:
        x = x*x mod n              # overflow-safe!
        if x == n-1: return False  # saw -1, passes
    return True                    # witness -> n composite
```

Deterministic 64-bit base sets:

```text
n < 2047               : {2}
n < 1373653            : {2, 3}
n < 3215031751         : {2, 3, 5, 7}
n < 3825123056546413051: {2,3,5,7,11,13,17,19,23}
n < 2^64               : {2,3,5,7,11,13,17,19,23,29,31,37}   (or 7-base Sinclair set)
```

Key facts:
- **A witness proves composite; "prime" is certain only with a proven base set.**
- `n - 1 = d·2^s` with `d` **odd**; square exactly `s-1` times after `a^d`.
- Counts/products overflow near `2^64` → use an overflow-safe `mulmod`.
- Miller-Rabin is **strictly stronger** than Fermat (catches Carmichael numbers).

---

## Junior Questions (12 Q&A)

### J1. What does Miller-Rabin decide?
Whether an integer `n` is prime. When it reports "composite" it is certain (it found a witness); when it reports "prime" it is certain only if a proven base set was used (otherwise it is "probably prime").

### J2. What is Fermat's Little Theorem and the Fermat test?
For prime `n` and `gcd(a,n)=1`, `a^(n-1) ≡ 1 (mod n)`. The Fermat test computes `a^(n-1) mod n`; if it is not `1`, `n` is composite. The weakness is that some composites pass for some (or all) bases.

### J3. What is a Carmichael number and why does it matter?
A composite `n` that passes the Fermat test for *every* base coprime to it (smallest is `561`). It defeats the plain Fermat test entirely, which is the reason Miller-Rabin exists.

### J4. What is the key idea that makes Miller-Rabin stronger?
Modulo a prime, the only square roots of `1` are `+1` and `-1`. Miller-Rabin watches the squaring chain `a^d, a^(2d), …` and if it reaches `1` from a value other than `±1`, it found a nontrivial square root of `1` — impossible for a prime — so `n` is composite.

### J5. What is the `n - 1 = d·2^s` decomposition?
Pull all factors of 2 out of `n-1`: `d` is odd, `s ≥ 1` is the count of factors of 2. Example: `560 = 35·2^4`, so `d=35, s=4`.

### J6. What is a witness?
A base `a` whose Miller-Rabin check proves `n` is composite: `a^d ≢ ±1` and none of the `s-1` squarings produces `-1`.

### J7. What is the error probability per random base?
At most `1/4` for a composite. So `k` random bases give error at most `(1/4)^k`.

### J8. How fast is Miller-Rabin compared to trial division?
Trial division is `O(√n)`; Miller-Rabin is `O(k log³ n)`. For `n ≈ 10^18`, that is a billion operations vs a few hundred — vastly faster.

### J9. Why must `mulmod` be overflow-safe?
For `n` near `2^64`, `a*b` can be near `2^128` and overflow a 64-bit register, corrupting the result. Use `__int128`, a doubling trick, or Montgomery multiplication.

### J10. How do you make Miller-Rabin deterministic for 64-bit numbers?
Use a fixed, proven base set — e.g. `{2,3,5,7,11,13,17,19,23,29,31,37}` — that is mathematically guaranteed to catch every composite below `2^64`.

### J11. What small cases must you handle specially?
`n < 2` (not prime), `n = 2` and `n = 3` (prime), and even `n > 2` (composite). The decomposition assumes odd `n > 3`.

### J12 (analysis). Why does a witness *prove* compositeness rather than just suggest it?
Because every prime satisfies the strong condition for every base (provable from the square-root-of-1 lemma). So if some base fails the condition, `n` cannot be prime — it is a logical certificate, not a heuristic.

---

## Middle Questions (12 Q&A)

### M1. Walk through the witness loop step by step.
Compute `x = a^d mod n`. If `x` is `1` or `n-1`, the base passes. Otherwise square `x` up to `s-1` times; if any square equals `n-1` (i.e. `-1`), the base passes. If we finish without seeing `-1`, `a` is a witness and `n` is composite.

### M2. Why exactly `s-1` squarings and not `s`?
We already inspected `x_0 = a^d`. The legitimate `-1` could appear at `x_0, x_1, …, x_{s-1}`. We test `x_0` directly and then square `s-1` times to reach (and test) `x_1` through `x_{s-1}`. Squaring `s` times would compute `a^(n-1)` and over-loop.

### M3. Show how `561` is caught by base 2.
`560 = 35·2^4`, `d=35, s=4`. `2^35 mod 561 = 263` (not `±1`). Squaring: `263²→166`, `166²→67`, `67²→1`. We reached `1` from `67`, never seeing `-1`, so `2` is a witness — `561` is composite, even though `2^560 ≡ 1` fooled Fermat.

### M4. Why is Miller-Rabin strictly stronger than Fermat?
Every Fermat witness is a Miller-Rabin witness (if `a^(n-1) ≢ 1`, the strong condition also fails). But Miller-Rabin also catches Carmichael numbers via nontrivial square roots of 1, which Fermat cannot. So the strong-liar set is a subset of the Fermat-liar set.

### M5. State and justify the `≤ 1/4` bound.
For odd composite `n > 9`, at most `φ(n)/4` bases are strong liars (Rabin/Monier), so at least `3/4` are witnesses. Hence a random base catches a composite with probability `≥ 3/4`, and `k` bases give error `≤ (1/4)^k`.

### M6. Give a deterministic base set for `n < 3.2·10^9`.
`{2, 3, 5, 7}` is proven to correctly classify every `n < 3,215,031,751`.

### M7. How do you implement overflow-safe `mulmod` without a 128-bit type?
Use the doubling (Russian-peasant) trick: accumulate `a` into the result by binary digits of `b`, reducing mod `n` after each `+` and each doubling. Requires `n < 2^63` so `a + a` does not overflow. Otherwise use `__int128` or Montgomery.

### M8. Why prefer deterministic over probabilistic for 64-bit?
Same cost, but zero error and no RNG. Randomness is only needed when `n` can exceed `2^64`, where no finite proven base set exists.

### M9. How does Miller-Rabin relate to Solovay-Strassen?
Solovay-Strassen has error `≤ (1/2)^k` (Euler liars `≤ φ(n)/2`), weaker than Miller-Rabin's `(1/4)^k`. Strong liars ⊆ Euler liars, so Miller-Rabin is strictly stronger; there is no reason to use Solovay-Strassen today.

### M10. What is the small-prime pre-filter and why use it?
Trial-divide `n` by the first several primes before any exponentiation. It rejects most composites instantly (cheap), handles even `n`, and correctly reports `n == p` when `n` equals a base prime.

### M11. Can you adversarially fool a fixed small base set?
Yes, beyond its certified bound — Arnault constructed composites that are strong pseudoprimes to all bases in a chosen small list. So fixed small bases are safe only below their proven threshold; for unbounded/adversarial `n`, use random bases or BPSW.

### M12 (analysis). What is AKS and how does it compare?
AKS (2002) is a deterministic, unconditional, polynomial-time primality test (`Õ(log^6 n)`), proving `PRIMES ∈ P`. It is theoretically landmark but far slower in practice than Miller-Rabin, so it is rarely used for actual testing.

---

## Senior Questions (10 Q&A)

### S1. How do you test a 1024-bit number for cryptography?
`n` exceeds any finite proven base set, so use probabilistic Miller-Rabin with random bases (round count per FIPS, e.g. ~5 rounds for 1024-bit since average-case error is tiny), or BPSW. Use a CSPRNG for bases and an overflow-safe big-integer mulmod (Montgomery in practice).

### S2. Why Montgomery multiplication?
It replaces the costly modular reduction `% n` in the inner `powMod` loop with shifts and multiplies, eliminating division from the hot path — typically 2-4× faster for repeated multiplication modulo a fixed `n`, exactly Miller-Rabin's pattern. The per-`n` setup amortizes after a few multiplications.

### S3. What is BPSW and why might you prefer it?
Baillie-PSW = one Miller-Rabin base-2 test + one strong Lucas test. No composite is known to pass, and none exists below `2^64`. It is a fast, two-check, effectively-deterministic 64-bit test and resists the fixed-small-base adversarial weakness.

### S4. How do you generate a cryptographic prime?
Generate-and-test: draw a random odd `b`-bit candidate with the top bit set, run a small-prime sieve (trial-divide by primes up to a few thousand) to reject most candidates cheaply, then run Miller-Rabin (and/or Lucas). Repeat until one passes. About `0.69·b` candidates are expected.

### S5. What are the side-channel concerns?
When `n` is secret (key generation), data-dependent branches or early exits in `powMod` leak bits via timing/cache. Mitigate with constant-time exponentiation (Montgomery ladder), random base blinding, and audited libraries. For public `n` (e.g. judging input), early exit is fine and faster.

### S6. How do you choose the base set for a given range?
Look up the proven `ψ_m` thresholds: `{2,3,5,7}` below `3.2·10^9`, the first 12 primes (or the 7-base Sinclair set) below `2^64`. Use the smallest set that provably covers your guaranteed maximum `n`, and assert that bound.

### S7. How do you verify a Miller-Rabin implementation?
Cross-check against trial division for all `n ≤ 10^6`, run the Carmichael battery (`561,1105,1729,…` must be composite) and the strong-pseudoprime thresholds (the exact numbers each base set fails on), and test the largest 64-bit prime to exercise the full-range mulmod. Cross-language determinism is another check.

### S8. What are the main performance levers?
Small-prime sieve, smallest proven base set, `__int128`/Montgomery mulmod (avoid the slow doubling trick when a wide type exists), and reusing the `d,s` decomposition across bases. For big integers, Montgomery and an efficient big-int multiply dominate.

### S9. When is Miller-Rabin the wrong tool?
When you need the *factorization* (use Pollard's rho / trial division for small factors), when you need a re-verifiable *certificate* (use ECPP / Pratt), or when `n` is tiny and trial division is simpler. MR gives only a yes/no primality answer.

### S10 (analysis). Why does no finite base set work for all `n`?
For any fixed finite set `B`, there are infinitely many composites that are strong pseudoprimes to every base in `B`. So `B` can only be deterministic below some bound; beyond it, a composite eventually fools all of `B`. Hence unbounded `n` requires randomization (or BPSW).

---

## Professional Questions (8 Q&A)

### P1. Design a high-throughput service classifying billions of 64-bit numbers.
Route all inputs (`< 2^64`) to a deterministic path: small-prime sieve, then the 7-base proven set with a Montgomery mulmod. Cache nothing per number (each test is `O(1)` machine ops). Parallelize across cores; instrument the sieve hit-rate (~80% on random composites) as a health signal.

### P2. How do you handle externally supplied (possibly adversarial) primes, e.g. peer DH parameters?
Treat them as adversarial: do **not** trust a fixed small base set beyond its bound. Use BPSW (MR base 2 + strong Lucas) and/or many *random* MR rounds with a CSPRNG. Arnault-style constructions can fool fixed small bases, so randomness is mandatory.

### P3. Your `powMod` is the bottleneck in key generation. What do you do?
Switch the inner multiply to Montgomery form to remove division; use a windowed/fixed-window exponentiation to cut multiplications; ensure constant-time behavior if `n` is secret. Profile to confirm the modular reduction (not the multiply) was the cost. The small-prime sieve also reduces how often `powMod` runs at all.

### P4. How do you debug "a known prime is reported composite"?
Check the three usual suspects: mulmod overflow (test the largest 64-bit prime), an off-by-one in the squaring loop (`s` vs `s-1`), and a wrong/too-small base set for the range. Cross-check the exact `n` against trial division and a reference library; diff the intermediate chain `a^d, a^(2d), …`.

### P5. When is BPSW preferable to a 12-base deterministic MR?
When you want the fewest operations for an exact 64-bit test (two checks vs twelve), or a robust general-purpose `isPrime` that stays extremely reliable above `2^64` without trusting a fixed small base set. The trade-off is implementing the Lucas test.

### P6. How would you parallelize testing a huge batch?
Each `n` is independent — shard across workers. Within crypto big-int testing, the rounds are independent given the candidate, and base generation parallelizes. The small-prime sieve is a cheap pre-pass per candidate. No shared mutable state is needed.

### P7. How do automata of correctness checks (CI) protect this code?
Pin a Carmichael battery, the strong-pseudoprime thresholds for each base set, the largest 64-bit prime (mulmod overflow), boundary cases (`0,1,2,3`, even `n`), and a randomized cross-check against a reference (BigInteger/gmpy2) over millions of `n`. These catch the Fermat-only mistake, the off-by-one, and overflow.

### P8 (analysis). Why is the `≤ 1/4` bound tight, and what does that imply?
Some composites attain exactly `φ(n)/4` strong liars (Monier's exact count), so no better worst-case bound than `4^{-k}` exists. Implication: to get *certainty* you cannot just add rounds against an adversary — you need proven base sets (bounded `n`) or BPSW. For *random* `n`, average-case error is far smaller, so few rounds suffice.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about replacing a slow `O(√n)` check with a logarithmic one.
Look for a concrete story: a primality-heavy workload (e.g. a number-theory search or a key-gen path) where trial division dominated a profile, the switch to Miller-Rabin (with a proven base set for exactness), an overflow-safe mulmod added, and the measured speedup — plus validation against trial division on small inputs and the Carmichael battery.

### B2. A teammate shipped a Fermat test and a Carmichael number broke production. How do you handle it?
Explain calmly with a tiny example (`561` passes Fermat for every coprime base) and show that Miller-Rabin's square-root-of-1 check catches it at the same cost. Add a Carmichael battery to CI. Frame it as "Fermat is a known trap; here's the one-line strengthening," not blame.

### B3. Design a feature that generates RSA primes.
Describe the generate-and-test loop: CSPRNG odd candidate with top bit set, small-prime sieve, then standard-round Miller-Rabin (+ optional Lucas/BPSW). Discuss round count as a security parameter, constant-time exponentiation since the candidate is secret, and double-verifying the chosen prime with a second library before use.

### B4. How would you explain Miller-Rabin to a junior engineer?
Start with the guard analogy: Fermat is a quick badge scan that a clever forger (Carmichael number) always passes; Miller-Rabin adds a hologram check (the square-root-of-1 step) that catches the fake. Then show `n-1 = d·2^s` and the witness loop. Lead with the two gotchas: a witness proves composite, and you must use an overflow-safe mulmod.

### B5. Your primality service uses too much CPU. How do you investigate?
Profile: is the small-prime sieve enabled (it rejects most composites before any exponentiation)? Is `mulmod` doing a division per multiply instead of Montgomery? Are you running 12 bases where the 7-base set or BPSW would do? Is the base set larger than the input range requires? The fixes are usually sieve + Montgomery + a minimal proven base set.

---

## Coding Challenges

### Challenge 1: Deterministic Miller-Rabin for 64-bit numbers

**Problem.** Implement `isPrime(n)` that is exact for all `0 ≤ n < 2^64`, using a proven fixed base set and an overflow-safe `mulmod`.

**Example.**
```text
isPrime(561)                  -> false   (Carmichael)
isPrime(2147483647)           -> true    (Mersenne prime)
isPrime(1000000000000000003)  -> true
isPrime(18446744073709551557) -> true    (largest prime < 2^64)
```

**Constraints.** `0 ≤ n < 2^64`.

**Optimal.** Deterministic Miller-Rabin, `O(log³ n)`.

**Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

func mulMod(a, b, n uint64) uint64 {
	hi, lo := bits.Mul64(a, b)
	_, rem := bits.Div64(hi%n, lo, n)
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

func isPrime(n uint64) bool {
	if n < 2 {
		return false
	}
	for _, p := range []uint64{2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37} {
		if n%p == 0 {
			return n == p
		}
	}
	for _, a := range []uint64{2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37} {
		if isComposite(n, a) {
			return false
		}
	}
	return true
}

func main() {
	fmt.Println(isPrime(561))                  // false
	fmt.Println(isPrime(2147483647))           // true
	fmt.Println(isPrime(18446744073709551557)) // true
}
```

**Java.**
```java
import java.math.BigInteger;

public class DetMillerRabin {
    static final long[] B = {2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37};

    static long mulMod(long a, long b, long n) {
        return BigInteger.valueOf(a).multiply(BigInteger.valueOf(b))
                .mod(BigInteger.valueOf(n)).longValue();
    }

    static long powMod(long a, long e, long n) {
        long res = 1 % n;
        a %= n;
        while (e > 0) {
            if ((e & 1) == 1) res = mulMod(res, a, n);
            a = mulMod(a, a, n);
            e >>= 1;
        }
        return res;
    }

    static boolean isComposite(long n, long a) {
        if (a % n == 0) return false;
        long d = n - 1; int s = 0;
        while ((d & 1) == 0) { d >>= 1; s++; }
        long x = powMod(a, d, n);
        if (x == 1 || x == n - 1) return false;
        for (int r = 0; r < s - 1; r++) {
            x = mulMod(x, x, n);
            if (x == n - 1) return false;
        }
        return true;
    }

    static boolean isPrime(long n) {        // n treated as unsigned-positive here
        if (n < 2) return false;
        for (long p : B) if (n % p == 0) return n == p;
        for (long a : B) if (isComposite(n, a)) return false;
        return true;
    }

    public static void main(String[] args) {
        System.out.println(isPrime(561L));        // false
        System.out.println(isPrime(2147483647L)); // true
    }
}
```

**Python.**
```python
def _is_composite(n, a, d, s):
    x = pow(a, d, n)
    if x == 1 or x == n - 1:
        return False
    for _ in range(s - 1):
        x = x * x % n
        if x == n - 1:
            return False
    return True


def is_prime(n):
    if n < 2:
        return False
    bases = (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37)
    for p in bases:
        if n % p == 0:
            return n == p
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    return all(not _is_composite(n, a, d, s) for a in bases)


if __name__ == "__main__":
    print(is_prime(561))                   # False
    print(is_prime(2147483647))            # True
    print(is_prime(18446744073709551557))  # True
```

---

### Challenge 2: Probabilistic Miller-Rabin (random bases)

**Problem.** Implement `isProbablePrime(n, k)` using `k` random bases, returning `True` if `n` is probably prime (error `≤ (1/4)^k`). Use an overflow-safe `mulmod`.

**Example.**
```text
isProbablePrime(561, 20)        -> False
isProbablePrime(1000000007, 20) -> True
```

**Constraints.** `n < 2^63` (so the doubling mulmod is safe), `1 ≤ k ≤ 64`.

**Go.**
```go
package main

import (
	"fmt"
	"math/rand"
)

func mulMod(a, b, n uint64) uint64 {
	var res uint64
	a %= n
	for b > 0 {
		if b&1 == 1 {
			res = (res + a) % n
		}
		a = (a + a) % n
		b >>= 1
	}
	return res
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

func witness(n, a uint64) bool {
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

func isProbablePrime(n uint64, k int) bool {
	if n < 2 {
		return false
	}
	if n%2 == 0 {
		return n == 2
	}
	for i := 0; i < k; i++ {
		a := 2 + uint64(rand.Int63n(int64(n-3)))
		if witness(n, a) {
			return false
		}
	}
	return true
}

func main() {
	fmt.Println(isProbablePrime(561, 20))        // false
	fmt.Println(isProbablePrime(1000000007, 20)) // true
}
```

**Java.**
```java
import java.util.Random;

public class ProbMillerRabin {
    static long mulMod(long a, long b, long n) {
        long res = 0; a %= n;
        while (b > 0) {
            if ((b & 1) == 1) res = (res + a) % n;
            a = (a + a) % n;
            b >>= 1;
        }
        return res;
    }

    static long powMod(long a, long e, long n) {
        long res = 1 % n; a %= n;
        while (e > 0) {
            if ((e & 1) == 1) res = mulMod(res, a, n);
            a = mulMod(a, a, n);
            e >>= 1;
        }
        return res;
    }

    static boolean witness(long n, long a) {
        long d = n - 1; int s = 0;
        while ((d & 1) == 0) { d >>= 1; s++; }
        long x = powMod(a, d, n);
        if (x == 1 || x == n - 1) return false;
        for (int r = 0; r < s - 1; r++) {
            x = mulMod(x, x, n);
            if (x == n - 1) return false;
        }
        return true;
    }

    static boolean isProbablePrime(long n, int k) {
        if (n < 2) return false;
        if (n % 2 == 0) return n == 2;
        Random rnd = new Random(7);
        for (int i = 0; i < k; i++) {
            long a = 2 + Math.floorMod(rnd.nextLong(), n - 3);
            if (witness(n, a)) return false;
        }
        return true;
    }

    public static void main(String[] args) {
        System.out.println(isProbablePrime(561, 20));         // false
        System.out.println(isProbablePrime(1000000007L, 20)); // true
    }
}
```

**Python.**
```python
import random


def witness(n, a, d, s):
    x = pow(a, d, n)
    if x == 1 or x == n - 1:
        return False
    for _ in range(s - 1):
        x = x * x % n
        if x == n - 1:
            return False
    return True


def is_probable_prime(n, k=20):
    if n < 2:
        return False
    if n % 2 == 0:
        return n == 2
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    for _ in range(k):
        a = random.randrange(2, n - 1)
        if witness(n, a, d, s):
            return False
    return True


if __name__ == "__main__":
    print(is_probable_prime(561))         # False
    print(is_probable_prime(1000000007))  # True
```

---

### Challenge 3: Count Primes in a Range

**Problem.** Given `lo` and `hi`, count how many integers in `[lo, hi]` are prime, using Miller-Rabin. (For wide ranges a sieve is faster, but the point here is per-number testing of large values.)

**Example.**
```text
countPrimes(10, 20)                       -> 4   (11,13,17,19)
countPrimes(1000000000, 1000000100)       -> 5
```

**Constraints.** `2 ≤ lo ≤ hi`, values up to `2^63`.

**Go.** (reuses the deterministic `isPrime` from Challenge 1)
```go
func countPrimes(lo, hi uint64) int {
	cnt := 0
	for n := lo; n <= hi; n++ {
		if isPrime(n) {
			cnt++
		}
		if n == hi { // guard against uint wrap at the top
			break
		}
	}
	return cnt
}

// func main() { fmt.Println(countPrimes(10, 20)) } // 4
```

**Java.**
```java
static long countPrimes(long lo, long hi) {
    long cnt = 0;
    for (long n = lo; n <= hi; n++) {
        if (isPrime(n)) cnt++;
    }
    return cnt;
}
// System.out.println(countPrimes(10, 20)); // 4
```

**Python.**
```python
def count_primes(lo, hi):
    return sum(1 for n in range(lo, hi + 1) if is_prime(n))


# print(count_primes(10, 20))  # 4
```

---

### Challenge 4: Next Prime ≥ n

**Problem.** Given `n`, return the smallest prime `p ≥ n`, using Miller-Rabin to test candidates. Skip even numbers after handling `2`.

**Example.**
```text
nextPrime(14)        -> 17
nextPrime(20)        -> 23
nextPrime(1000000)   -> 1000003
```

**Constraints.** Result fits in `2^63`.

**Go.**
```go
func nextPrime(n uint64) uint64 {
	if n <= 2 {
		return 2
	}
	if n%2 == 0 {
		n++
	}
	for !isPrime(n) {
		n += 2
	}
	return n
}

// func main() { fmt.Println(nextPrime(14)) } // 17
```

**Java.**
```java
static long nextPrime(long n) {
    if (n <= 2) return 2;
    if (n % 2 == 0) n++;
    while (!isPrime(n)) n += 2;
    return n;
}
// System.out.println(nextPrime(14)); // 17
```

**Python.**
```python
def next_prime(n):
    if n <= 2:
        return 2
    if n % 2 == 0:
        n += 1
    while not is_prime(n):
        n += 2
    return n


# print(next_prime(14))  # 17
```

---

## Final Tips

- Lead with the one-liner: *"A prime modulus has no nontrivial square roots of 1; Miller-Rabin watches the chain `a^d, a^(2d), …` for `1` and `-1`, catching the Carmichael numbers Fermat misses, in `O(k log³ n)`."*
- Immediately flag the two gotchas: **a witness proves composite** (so "prime" needs a proven base set), and **mulmod must be overflow-safe** near `2^64`.
- For an exact 64-bit test, name a **proven base set** (`{2,3,5,7}` below `3.2·10^9`, the 12-prime or 7-base set below `2^64`); for unbounded `n`, use **random bases or BPSW**.
- Mention **Montgomery multiplication** and the **small-prime sieve** as the production speedups, and **BPSW** as the strongest practical alternative.
- Always offer to validate against trial division and the **Carmichael battery** (`561, 1105, 1729, …`) on small inputs.
