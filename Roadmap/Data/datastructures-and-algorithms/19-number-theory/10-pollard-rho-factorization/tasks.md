# Pollard's Rho Factorization — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the rho iteration + cycle detection + gcd, and validate against the evaluation criteria.
> **Always test against a trial-division oracle (`O(√n)`) on small inputs before trusting the rho-based result. Always use an overflow-safe `mulmod` for any `n` beyond ~`2^{31}`.**

---

## Beginner Tasks (5)

### Task 1 — Overflow-safe modular multiply

**Problem.** Implement `mulmod(a, b, n)` returning `(a · b) mod n` correctly even when `a · b` exceeds 64 bits (i.e. `n` near `2^{63}`). This is the foundation of every later task.

**Input / Output spec.**
- Read `a`, `b`, `n` (three integers).
- Print `(a · b) mod n`.

**Constraints.**
- `0 ≤ a, b < n < 2^{63}`.
- A naive `(a*b) % n` must NOT be used (it overflows).

**Hint.** Use a 128-bit product: `__int128` (C/C++), `bits.Mul64` + `bits.Div64` (Go), `BigInteger` or `Math.multiplyHigh` (Java); Python's big ints make `(a*b) % n` automatically correct.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

func mulmod(a, b, n uint64) uint64 {
	// TODO: 128-bit product then reduce
	hi, lo := bits.Mul64(a, b)
	_, r := bits.Div64(hi%n, lo, n)
	return r
}

func main() {
	var a, b, n uint64
	fmt.Scan(&a, &b, &n)
	fmt.Println(mulmod(a, b, n))
}
```

**Starter — Java.**
```java
import java.math.BigInteger;
import java.util.*;

public class Task1 {
    static long mulmod(long a, long b, long n) {
        // TODO: BigInteger or Math.multiplyHigh
        return BigInteger.valueOf(a).multiply(BigInteger.valueOf(b))
                .mod(BigInteger.valueOf(n)).longValue();
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong(), n = sc.nextLong();
        System.out.println(mulmod(a, b, n));
    }
}
```

**Starter — Python.**
```python
import sys


def mulmod(a, b, n):
    return (a * b) % n   # Python big ints never overflow


def main():
    a, b, n = map(int, sys.stdin.read().split())
    print(mulmod(a, b, n))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct for `a = b = n − 1` with `n` near `2^{63}` (the overflow-prone case).
- No silent wraparound; cross-check against a BigInteger / big-int reference.
- `O(1)` per call.

---

### Task 2 — Pollard's rho, one factor (Floyd)

**Problem.** Given a composite `n`, return one nontrivial factor using Floyd's tortoise-and-hare rho. Handle even `n` by returning `2`.

**Input / Output spec.**
- Read `n`.
- Print one nontrivial factor `d` with `1 < d < n` and `n mod d == 0`.

**Constraints.** `n` composite, `2 ≤ n < 2^{63}`. Use the `mulmod` from Task 1.

**Hint.** `f(x) = (mulmod(x, x, n) + c) % n`; tortoise `x = f(x)`, hare `y = f(f(y))`; `d = gcd(|x−y|, n)`. If `d == n`, retry with `c + 1`.

**Reference oracle (Python) — validate against this.**
```python
def trial_factor(n):
    d = 2
    while d * d <= n:
        if n % d == 0:
            return d
        d += 1
    return n   # prime; rho should never be called here
```

**Evaluation criteria.**
- Returns a true divisor (`n % d == 0`, `1 < d < n`).
- Matches a divisor found by `trial_factor` on small `n`.
- Restarts with a new `c` when the gcd hits `n`.

---

### Task 3 — Trial-division factorization oracle

**Problem.** Implement `factor_trial(n)` returning the sorted multiset of prime factors of `n` by trial division up to `√n`. This is the ground-truth oracle for all later tasks.

**Input / Output spec.**
- Read `n`. Print the prime factors space-separated, ascending.

**Constraints.** `1 ≤ n ≤ 10^{12}` (so `√n ≤ 10^6`, fast enough).

**Hint.** Divide out each `d` fully (`while n % d == 0`) before incrementing; append the leftover `n > 1` as a prime.

**Worked check.** `factor_trial(360) == [2, 2, 2, 3, 3, 5]`; `factor_trial(97) == [97]`.

**Evaluation criteria.**
- Correct multiset (with multiplicity) for `360`, `97`, `1000000`.
- Product of returned factors equals `n`.
- Handles `n = 1` (empty list) and prime `n`.

---

### Task 4 — Full factorization with rho + Miller-Rabin

**Problem.** Return the sorted prime factorization of `n` (up to 64-bit), combining trial division (strip small primes), Miller-Rabin (sibling `08`), and Pollard's rho. Recurse until every piece is prime.

**Input / Output spec.**
- Read `n`. Print prime factors space-separated, ascending.

**Constraints.** `1 ≤ n < 2^{63}`.

**Hint.** `factor(n)`: strip small primes; then `rec(m)`: if `m == 1` return; if `isPrime(m)` record; else `d = rho(m)`, recurse on `d` and `m/d`. Use deterministic Miller-Rabin with bases `{2,3,5,7,...,37}`.

**Evaluation criteria.**
- Product of factors equals `n`; every factor passes Miller-Rabin.
- Matches `factor_trial` (Task 3) on all `n ≤ 10^{12}`.
- Terminates (no infinite loop on primes or prime powers).

---

### Task 5 — Smallest prime factor

**Problem.** Given a composite `n`, return its smallest prime factor using the full factorizer (or rho directly, then verifying primality of the result).

**Input / Output spec.**
- Read `n`. Print the smallest prime factor.

**Constraints.** `2 ≤ n < 2^{63}`.

**Hint.** Either return `min(factor(n))`, or strip small primes first (the smallest factor is usually found there) and only invoke rho for the hard remainder.

**Evaluation criteria.**
- For `n = 8051`, returns `83`; for a prime `n`, returns `n` itself.
- Matches trial division's smallest factor on small `n`.
- Fast even when `n` has only large factors (rho's `√(smallest p)`).

---

## Intermediate Tasks (5)

### Task 6 — Brent's rho with batched gcd

**Problem.** Implement Brent's cycle detection with a batched gcd (accumulate `Q ← Q · |x − y| mod n` over ~128 steps, one gcd per batch), with collapse recovery (`gcd == n` → re-walk the batch step-by-step).

**Constraints.** `n` composite, `2 ≤ n < 2^{63}`.

**Hint.** Keep the batch start `ys`; on `gcd(Q, n) == n`, rewind to `ys` and take per-step gcds until one is `> 1`. Compare iteration counts to Floyd from Task 2 — Brent should use ~25% fewer `f` evaluations.

**Starter — Go.**
```go
func brentRho(n uint64) uint64 {
	if n%2 == 0 {
		return 2
	}
	// TODO: Brent's reference reset at power-of-two boundaries;
	// accumulate q = mulmod(q, |x-y|, n) over a batch of 128;
	// d = gcd(q, n); on d==n rewind to ys and step gcd; on 1<d<n return d.
	return n
}
```

**Starter — Java.**
```java
static long brentRho(long n) {
    if (n % 2 == 0) return 2;
    // TODO: reference y reset at 2^i boundaries; batched product q;
    // gcd(q, n) per batch; collapse recovery from ys; return 1 < d < n.
    return n;
}
```

**Starter — Python.**
```python
from math import gcd


def brent_rho(n):
    if n % 2 == 0:
        return 2
    # TODO: Brent reference reset; batch q = (q * abs(x - y)) % n over 128;
    # d = gcd(q, n) per batch; recover from collapse via ys; return 1 < d < n.
    return n
```

**Evaluation criteria.**
- Returns a true divisor; matches Task 2's result set.
- Recovers from collapse without spuriously returning `n`.
- Measurably fewer `f` evaluations than Floyd on the same `n`.

---

### Task 7 — Pollard's p−1 method

**Problem.** Implement `pollard_p_minus_1(n, B)` that finds a factor `p` of `n` when `p − 1` is `B`-smooth, using `a^M mod n` with `M = lcm(1..B)` and `gcd(a^M − 1, n)`.

**Constraints.** `n` composite, `2 ≤ n < 2^{63}`; `B` up to `10^5`.

**Hint.** For each prime `q ≤ B`, raise `a` to the highest `q^k ≤ B`: `a = pow(a, q^k, n)`. Take `gcd(a − 1, n)` periodically; return the first `1 < g < n`. Return `None` if no smooth factor is found (caller falls back to rho).

**Reference oracle (Python).**
```python
def has_smooth_minus1(n, B):
    # true if some prime factor p of n has (p-1) B-smooth
    from sympy import factorint  # or reuse trial factorization
    for p in factorint(n):
        m = p - 1
        ok = True
        d = 2
        while d * d <= m:
            while m % d == 0:
                if d > B:
                    ok = False
                m //= d
            d += 1
        if m > B:
            ok = False
        if ok:
            return True
    return False
```

**Evaluation criteria.**
- Finds a factor when `p − 1` is smooth (e.g. construct `n = p·q` with smooth `p − 1`).
- Returns `None` (gracefully) when no factor has smooth `p ± 1` (e.g. safe-prime product).
- Caller falls back to rho on `None`.

---

### Task 8 — Count the divisors of a big number

**Problem.** Compute `τ(n)`, the number of positive divisors of `n` (up to 64-bit). If `n = ∏ pᵢ^{eᵢ}`, then `τ(n) = ∏ (eᵢ + 1)`.

**Constraints.** `1 ≤ n < 2^{63}`.

**Hint.** Fully factor with rho + Miller-Rabin (Task 4), tally exponents, multiply `(eᵢ + 1)`. Handle `n = 1 → 1`.

**Reference oracle (Python).**
```python
def tau_brute(n):
    return sum(1 for d in range(1, int(n ** 0.5) + 1)
               if n % d == 0) * 2 - (1 if int(n ** 0.5) ** 2 == n else 0)
# only for small n
```

**Evaluation criteria.**
- `τ(360) == 24`, `τ(prime) == 2`, `τ(1) == 1`, `τ(p²) == 3`.
- Matches `tau_brute` for `n ≤ 10^8`.
- Fast for 64-bit `n` with large prime factors.

---

### Task 9 — Sum of divisors and Euler's totient

**Problem.** From the prime factorization, compute both `σ(n) = ∏ (pᵢ^{eᵢ+1} − 1)/(pᵢ − 1)` (sum of divisors) and `φ(n) = n · ∏ (1 − 1/pᵢ)` (Euler's totient), for `n` up to 64-bit.

**Constraints.** `1 ≤ n < 2^{63}` (σ may need 128-bit / big-int accumulation).

**Hint.** Factor once with rho; loop over distinct primes. For `φ`: `φ = n; for p in distinct primes: φ -= φ // p`. For `σ`: multiply the geometric-series term per prime. Watch overflow on `σ`.

**Evaluation criteria.**
- `φ(360) == 96`, `σ(360) == 1170`.
- `φ(p) == p − 1`, `σ(p) == p + 1` for prime `p`.
- Matches brute-force `Σ divisors` / `count coprimes` for `n ≤ 10^7`.

---

### Task 10 — Perfect-power detection before rho

**Problem.** Implement `perfect_power(n)` returning `(b, k)` with `b^k == n` and `k ≥ 2` maximal, or `None`. Integrate it into `factor`: if `n = b^k`, factor `b` and multiply multiplicities by `k`.

**Constraints.** `2 ≤ n < 2^{63}`.

**Hint.** For each `k` from `log2(n)` down to `2`, compute `b = round(n^{1/k})` and test `b^k == n` (check `b−1, b, b+1` to dodge float error). rho stalls on prime powers, so this check both speeds up and de-risks factoring.

**Evaluation criteria.**
- `perfect_power(1024) == (2, 10)`, `perfect_power(8051) == None`, `perfect_power(729) == (3, 6)`.
- Integrated `factor(p^k)` returns `[p] * k`.
- No false positives from floating-point rounding.

---

## Advanced Tasks (5)

### Task 11 — Montgomery-multiplication rho

**Problem.** Replace the 128-bit-divide `mulmod` with **Montgomery multiplication** in the rho hot loop. Precompute `n' = −n^{−1} mod 2^{64}` (Newton iteration) and `R² mod n`; convert in/out of Montgomery form.

**Constraints.** `n` odd composite, `2 ≤ n < 2^{63}`.

**Hint.** `montMul(a,b) = redc(a*b)` where `redc(t) = (t + (t·n' mod R)·n) / R` with a conditional subtract. Five Newton steps reach 64 correct bits of the inverse. Benchmark against the divide-based rho — Montgomery should be ~2–3× faster.

**Starter — Go.**
```go
func montInverse(n uint64) uint64 {
	inv := n
	for i := 0; i < 5; i++ {
		inv *= 2 - n*inv // Newton lift of n^{-1} mod 2^64
	}
	return -inv // n' = -n^{-1} mod 2^64
}
// TODO: redc(t_hi, t_lo) and montMul; convert in/out with R^2 mod n.
```

**Starter — Java.**
```java
static long montInverse(long n) {
    long inv = n;
    for (int i = 0; i < 5; i++) inv *= 2 - n * inv;
    return -inv; // n' = -n^{-1} mod 2^64 (use Math.multiplyHigh for redc)
}
// TODO: redc via Math.multiplyHigh; montMul; conversion with R^2 mod n.
```

**Starter — Python.**
```python
def mont_inverse(n):
    inv = n
    for _ in range(5):
        inv = (inv * (2 - n * inv)) & ((1 << 64) - 1)
    return (-inv) & ((1 << 64) - 1)
# TODO: redc(t) = (t + ((t * nprime) & MASK) * n) >> 64, conditional subtract.
# Note: Python big ints make this educational rather than faster.
```

**Evaluation criteria.**
- Returns the same factors as the divide-based rho (cross-validated).
- Correct on `n` near `2^{63}` (no overflow, correct redc).
- Measurably faster in the hot loop than the 128-bit-divide version.

---

### Task 12 — Robust factorizer with restarts and guardrails

**Problem.** Build a production-grade `factor(n)`: small-prime strip → Miller-Rabin → perfect-power check → rho with randomized `(c, seed)` restarts and a bounded restart count → recurse. Add a self-check that re-multiplies the factors and asserts the product equals `n`.

**Constraints.** `1 ≤ n < 2^{63}`; must never hang.

**Hint.** Wrap rho in a loop that retries with fresh random `c` and seed on `gcd ∈ {1, n}`; bound attempts (e.g. 200) and escalate/error rather than loop forever. Assert `product(factors) == n` and `all(isPrime(f))` before returning.

**Evaluation criteria.**
- Never hangs, even on primes, prime powers, or adversarial semiprimes.
- Self-check passes on all outputs (product == `n`, all prime).
- Restart count stays low (single digits) on typical 64-bit inputs.

---

### Task 13 — Factor a batch of numbers fast

**Problem.** Given `Q` queries each a 64-bit integer, output the prime factorization of each. Optimize for throughput by sharing the small-prime sieve and parallelizing across queries.

**Constraints.** `1 ≤ Q ≤ 10^5`, each `n < 2^{63}`.

**Hint.** Precompute a small-prime list once. Process queries independently (embarrassingly parallel across goroutines/threads). For each, strip small primes from the shared list, then rho-recurse. Do not rebuild the sieve per query.

**Evaluation criteria.**
- Small-prime sieve built exactly once, reused across all queries.
- Each factorization verified (product == `n`).
- Parallel version matches the serial version's outputs; throughput scales with cores.

---

### Task 14 — Largest prime factor under a time budget

**Problem.** Given `n` (up to 64-bit) and a wall-clock budget, return its largest prime factor. If rho exceeds the budget on a hard semiprime, report the best partial result and which part remains unfactored.

**Constraints.** `2 ≤ n < 2^{63}`; budget in milliseconds.

**Hint.** Fully factor with rho + Miller-Rabin; track elapsed time. The largest prime factor is the max of the prime leaves. For a hard balanced semiprime, rho needs `~n^{1/4}` steps — measure and confirm it fits the budget (a few ms for 64-bit).

**Evaluation criteria.**
- `largest_prime_factor(600851475143) == 6857`.
- Returns the true max of the prime factors.
- For 64-bit inputs, completes well within a small (e.g. 50 ms) budget; reports cleanly if a (constructed) harder input would exceed it.

---

### Task 15 — Decide when rho is the wrong tool

**Problem.** Implement `classify(n_bits, smallest_factor_bits)` (or a short analysis) returning one of: `TRIAL_DIVISION`, `POLLARD_RHO`, `POLLARD_P_MINUS_1`, `ECM`, `GNFS`, or `ALREADY_PRIME`, with justification. Encode the size/structure boundaries.

**Constraints / cases to handle.**
- `n` prime → `ALREADY_PRIME` (Miller-Rabin first).
- tiny `n` or small smallest factor → `TRIAL_DIVISION`.
- 64-bit `n`, no small factor → `POLLARD_RHO`.
- a factor `p` with smooth `p − 1` → `POLLARD_P_MINUS_1`.
- factor in the 20–40 digit range → `ECM`.
- balanced semiprime, crypto-size → `GNFS` (rho infeasible: `≈ 2^{(n_bits)/4}`).

**Hint.** Encode the escalation ladder from `senior.md` §6.4 and `professional.md` §10. The trap is assuming rho cracks RSA — its `O(n^{1/4})` is exponential in bit-length.

**Evaluation criteria.**
- Correctly classifies all six canonical cases.
- The `GNFS` branch cites rho's `≈ 2^{(bitlen)/4}` infeasibility for 2048-bit.
- Justification references the right cost (`O(√n)`, `O(n^{1/4})`, smoothness, `L_n[1/3]`).

---

## Benchmark Task

### Task B — Trial division vs Pollard's rho crossover

**Problem.** Empirically find the `n` size at which Pollard's rho overtakes trial division for finding one factor. Implement two workloads on hard semiprimes (a product of two equal-size random primes, fixed seed):

- **(a) Trial division:** scan `d` from `2` upward — `O(smallest factor)` ≈ `O(√n)` for a balanced semiprime.
- **(b) Pollard's rho:** Brent + batched gcd + safe mulmod — `O(n^{1/4})` expected.

Measure wall-clock time for semiprimes with smallest prime of bit-length `b ∈ {12, 16, 20, 24, 28, 32}` (so `n ≈ 2^{2b}`). Report a table and identify the crossover.

**Starter — Python.**
```python
import random
import time
from math import gcd, isqrt


def random_prime(bits, rng):
    while True:
        x = rng.randrange(1 << (bits - 1), 1 << bits) | 1
        if is_prime(x):  # reuse Miller-Rabin
            return x


def make_semiprime(bits, seed):
    rng = random.Random(seed)
    p = random_prime(bits, rng)
    q = random_prime(bits, rng)
    return p * q


def trial_one_factor(n):
    # TODO: scan d from 2; O(sqrt(n)); return first divisor
    d = 2
    while d * d <= n:
        if n % d == 0:
            return d
        d += 1
    return n


def rho_one_factor(n):
    # TODO: Brent + batched gcd + safe mulmod; O(n^{1/4})
    return n


def bench(fn, n, reps=3):
    best = float("inf")
    for _ in range(reps):
        start = time.perf_counter()
        fn(n)
        best = min(best, time.perf_counter() - start)
    return best * 1000.0


def main():
    print("bits   n_approx        trial_ms     rho_ms")
    for b in [12, 16, 20, 24, 28, 32]:
        n = make_semiprime(b, seed=42 + b)
        tr = bench(trial_one_factor, n) if b <= 28 else float("nan")
        rh = bench(rho_one_factor, n)
        print(f"{b:<6d} ~2^{2*b:<10d} {tr:<12.3f} {rh:<10.3f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same semiprimes across Go, Java, and Python.
- Trial division (a) wins for tiny factors; rho (b) wins as the smallest prime grows. Report the crossover bit-length.
- rho completes for `b = 32` (`n ≈ 2^{64}`) in milliseconds; trial division is infeasible there.
- Report includes the best of ≥ 3 runs and excludes prime-generation time.
- Writeup: a short note comparing the measured crossover to the theoretical `√p` (trial) vs `√p`-iterations-of-cheap-steps (rho), i.e. rho wins once `√p` trial steps exceed `n^{1/4}` rho iterations.

---

## General Guidance for All Tasks

- **Always validate against the trial-division oracle first.** Every factoring task above ships with (or references) a slow `O(√n)` oracle. Run it on small `n`, diff the multiset, and only then trust the rho version on large `n`.
- **Use an overflow-safe `mulmod` everywhere.** `__int128` / `bits.Mul64` / `BigInteger` / Python big ints; Montgomery in the hot loop. Never write `(a*b) % n` for `n` beyond ~`2^{31}`.
- **Run Miller-Rabin before every rho call.** It is the recursion base case and the loop-forever guard. Use the deterministic witness set for 64-bit.
- **Strip small primes first.** Handles the even case and rho's small-factor weakness; leaves rho the one hard split.
- **Handle the `gcd == n` collapse.** Restart with a fresh random `c` (and seed); with batching, re-walk the batch step-by-step. Never return `n` as a factor.
- **Detect perfect powers.** rho stalls on `p^k`; check `n = b^k` up front and scale multiplicities.
- **Verify by re-multiplying.** Assert `product(factors) == n` and every factor passes Miller-Rabin — a self-certifying check that catches nearly every bug.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
