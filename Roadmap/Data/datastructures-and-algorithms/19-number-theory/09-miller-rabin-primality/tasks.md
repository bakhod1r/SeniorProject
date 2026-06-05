# Miller-Rabin Primality Testing — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the Miller-Rabin logic and validate against the evaluation criteria.
> **Always test against a trial-division oracle on small inputs and the Carmichael battery (`561, 1105, 1729, 2465, 2821, 6601, 8911`) before trusting the Miller-Rabin result.**

---

## Beginner Tasks (5)

### Task 1 — Overflow-safe mulmod

**Problem.** Implement `mulmod(a, b, n)` returning `a·b mod n` for `0 ≤ a, b < n < 2^63` without overflowing 64-bit integers. Use either a 128-bit intermediate or the doubling (Russian-peasant) trick.

**Input / Output spec.**
- Read three integers `a`, `b`, `n`.
- Print `(a·b) mod n`.

**Constraints.**
- `0 ≤ a, b < n`, `2 ≤ n < 2^63`.
- The naive `a*b` overflows — you must avoid it.

**Hint.** Doubling: accumulate `a` for each set bit of `b`, reducing mod `n` after every `+` and every `a = (a+a) % n`.

**Starter — Go.**
```go
package main

import "fmt"

func mulmod(a, b, n uint64) uint64 {
	// TODO: doubling trick OR math/bits.Mul64 + Div64
	return 0
}

func main() {
	var a, b, n uint64
	fmt.Scan(&a, &b, &n)
	fmt.Println(mulmod(a, b, n))
}
```

**Starter — Java.**
```java
import java.util.*;
import java.math.BigInteger;

public class Task1 {
    static long mulmod(long a, long b, long n) {
        // TODO: doubling trick OR BigInteger
        return 0;
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
    # Python ints never overflow, but implement the doubling trick anyway
    # to mirror the Go/Java logic.
    return 0


def main():
    a, b, n = map(int, sys.stdin.read().split())
    print(mulmod(a, b, n))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct for `a, b` near `2^62` (no overflow).
- Matches `(a*b) % n` computed with big integers / `__int128`.
- Doubling version reduces mod `n` after each step.

---

### Task 2 — The `n - 1 = d·2^s` decomposition

**Problem.** Implement `decompose(n)` that returns `(d, s)` with `n - 1 = d·2^s` and `d` **odd**, for odd `n > 2`.

**Input / Output spec.**
- Read `n`. Print `d` and `s` separated by a space.

**Constraints.** `3 ≤ n < 2^63`, `n` odd.

**Hint.** Strip trailing zero bits of `n - 1`: `s` counts them, `d = (n-1) >> s`.

**Worked check.** `n = 561 → 560 = 35·2^4 → d=35, s=4`. `n = 13 → 12 = 3·2^2 → d=3, s=2`.

**Reference oracle (Python).**
```python
def decompose_ref(n):
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    assert d % 2 == 1 and d * (1 << s) == n - 1
    return d, s
```

**Evaluation criteria.**
- `d` is always odd; `s ≥ 1` for odd `n > 1`.
- Matches the worked checks.
- The invariant `d · 2^s == n - 1` holds.
- `O(log n)`.

---

### Task 3 — Single-base Miller-Rabin witness test

**Problem.** Implement `isComposite(n, a)` returning `True` iff base `a` is a **witness** that odd `n > 3` is composite (`a^d ≢ ±1` and no `-1` appears in the `s-1` squarings).

**Input / Output spec.**
- Read `n` and `a`. Print `witness` or `passes`.

**Constraints.** `5 ≤ n < 2^63`, `2 ≤ a < n - 1`.

**Hint.** Compute `x = a^d mod n` with fast modular exponentiation (use your `mulmod`). Then square `x` up to `s-1` times checking for `n-1`.

**Reference oracle (Python) — use this to validate.**
```python
def is_composite_ref(n, a):
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    x = pow(a, d, n)
    if x in (1, n - 1):
        return False
    for _ in range(s - 1):
        x = x * x % n
        if x == n - 1:
            return False
    return True
```

**Evaluation criteria.**
- `isComposite(561, 2)` is `True` (witness).
- `isComposite(13, 2)` is `False` (passes).
- Matches `is_composite_ref` for all `5 ≤ n ≤ 100000`, `a = 2`.

---

### Task 4 — Fermat test and a Carmichael counterexample

**Problem.** Implement `fermat(n, a) = (a^(n-1) mod n == 1)` and show, in code, that the Carmichael number `561` passes the Fermat test for *every* base coprime to it, while Miller-Rabin (Task 3) catches it.

**Input / Output spec.**
- Read `n`. Print two lines: the count of bases `a ∈ [2, n-2]` with `gcd(a,n)=1` that pass Fermat, and whether Miller-Rabin base 2 reports a witness.

**Constraints.** `n = 561` (and try `1105`, `1729`).

**Hint.** Iterate `a` from `2` to `n-2`; count Fermat passes among coprime bases. For `561` the count equals `φ(561) = 320` (all coprime bases pass).

**Evaluation criteria.**
- For `561`, all `320` coprime bases pass Fermat (demonstrating the weakness).
- Miller-Rabin base 2 reports a witness for `561`.
- Code clearly separates the Fermat check from the Miller-Rabin check.

---

### Task 5 — Deterministic isPrime for 32-bit numbers

**Problem.** Implement `isPrime(n)` exact for all `n < 2^32` using the proven base set `{2, 3, 5, 7}` (valid below `3,215,031,751 > 2^32`). Handle small `n` and even `n`.

**Input / Output spec.**
- Read `n`. Print `true` or `false`.

**Constraints.** `0 ≤ n < 2^32`.

**Hint.** Small-prime pre-filter, then the witness loop over `{2,3,5,7}`. `mulmod` overflow is not a concern below `2^32` (`a*b < 2^64`), but use 64-bit products.

**Reference oracle (Python).**
```python
def sieve_is_prime(limit):
    p = [True] * (limit + 1)
    p[0] = p[1] = False
    for i in range(2, int(limit ** 0.5) + 1):
        if p[i]:
            for j in range(i * i, limit + 1, i):
                p[j] = False
    return p   # p[n] == is_prime(n); compare for n <= 10**7
```

**Evaluation criteria.**
- Matches a sieve of Eratosthenes for all `n ≤ 10^7`.
- `isPrime(561) == false`, `isPrime(2147483647) == true`.
- `O(log³ n)`.

---

## Intermediate Tasks (5)

### Task 6 — Deterministic isPrime for all 64-bit numbers

**Problem.** Implement `isPrime(n)` exact for all `0 ≤ n < 2^64`, using the 12-prime base set `{2,3,5,7,11,13,17,19,23,29,31,37}` (or the 7-base Sinclair set) and an overflow-safe `mulmod` (`__int128` / `bits.Mul64` / BigInteger).

**Constraints.** `0 ≤ n < 2^64` (treat as unsigned).

**Hint.** The squaring step `x = mulmod(x, x, n)` is where overflow strikes for `n` near `2^64`. Test the largest 64-bit prime `18446744073709551557`.

**Reference oracle (Python) — small-range cross-check.**
```python
def sieve_primes(limit):
    is_p = [True] * (limit + 1)
    is_p[0] = is_p[1] = False
    for i in range(2, int(limit**0.5) + 1):
        if is_p[i]:
            for j in range(i * i, limit + 1, i):
                is_p[j] = False
    return is_p
# compare is_prime(n) against sieve for n <= 10**6
```

**Evaluation criteria.**
- Matches the sieve for all `n ≤ 10^6`.
- Correct on the Carmichael battery and the largest 64-bit prime.
- No overflow (the largest-prime test passes).

---

### Task 7 — Probabilistic isPrime with k random bases

**Problem.** Implement `isProbablePrime(n, k)` using `k` random bases drawn from `[2, n-2]`, with error `≤ (1/4)^k`. Report the empirical accuracy against trial division over a range.

**Constraints.** `n < 2^63`, `1 ≤ k ≤ 40`.

**Hint.** Use a seeded RNG for reproducibility across languages in testing, but document that crypto use needs a CSPRNG. Reuse your `decompose` and witness loop.

**Evaluation criteria.**
- Agrees with trial division on all `n ≤ 10^6` for `k ≥ 5` (no observed error).
- Returns `False` for the Carmichael battery even at `k = 1` with base 2 chosen.
- `O(k log³ n)`.

---

### Task 8 — Count primes in a range

**Problem.** Given `lo` and `hi`, count the primes in `[lo, hi]` using your deterministic 64-bit `isPrime`. (Numbers may be large; per-number testing is intended.)

**Input / Output spec.**
- Read `lo`, `hi`. Print the count.

**Constraints.** `2 ≤ lo ≤ hi`, `hi - lo ≤ 10^6`, values up to `2^63`.

**Hint.** Skip even candidates after testing `2`. For a window high in the 64-bit range, the deterministic test is essential (a sieve would need too much memory).

**Worked check.** `countPrimes(10, 20) = 4` (`11,13,17,19`). `countPrimes(10^9, 10^9+100) = 5`.

**Evaluation criteria.**
- Matches a sieve when the whole range fits in memory.
- Correct for a high-64-bit window (e.g. `[10^18, 10^18 + 1000]`).
- Even-number skipping is correct.

---

### Task 9 — Next prime ≥ n

**Problem.** Implement `nextPrime(n)` returning the smallest prime `≥ n`. Use Miller-Rabin to test candidates, skipping evens.

**Input / Output spec.**
- Read `n`. Print the next prime `≥ n`.

**Constraints.** `0 ≤ n`, result `< 2^63`.

**Hint.** Handle `n ≤ 2 → 2`. Make `n` odd, then step by `2`. By the prime gap bounds, the loop runs only a handful of iterations on average.

**Worked check.** `nextPrime(14) = 17`, `nextPrime(20) = 23`, `nextPrime(1000000) = 1000003`.

**Evaluation criteria.**
- Matches the worked checks.
- Correct for `n` just below a large prime.
- Average iterations small (prime gaps are `O(log n)` typically).

---

### Task 10 — Smallest strong pseudoprime per base set

**Problem.** Given a base set `B`, find the smallest odd composite `n` that is a strong pseudoprime to *every* base in `B` (a "liar set" demonstration). Verify the published thresholds for small `B`.

**Constraints.** `B ⊆ {2,3,5,7}`, search `n` up to the known threshold.

**Hint.** For `B = {2}` the answer is `2047 = 23·89`. For `B = {2,3}` it is `1373653`. Iterate odd composites, test against all bases in `B`, report the first that passes all.

**Reference values.**
```text
B = {2}        -> 2047
B = {2,3}      -> 1373653
B = {2,3,5}    -> 25326001
B = {2,3,5,7}  -> 3215031751
```

**Evaluation criteria.**
- Reproduces the published `ψ_m` thresholds for `B = {2}` and `{2,3}`.
- Correctly identifies `n` as composite (factor it) and as a strong pseudoprime to all of `B`.
- Demonstrates why a larger base set is needed for a larger range.

---

## Advanced Tasks (5)

### Task 11 — Montgomery multiplication mulmod

**Problem.** Implement Montgomery modular multiplication for odd `n < 2^64` and use it inside `powMod`. Compare its speed against the `__int128`/doubling `mulmod` on a large batch.

**Constraints.** `n` odd, `< 2^64`; benchmark over `≥ 10^6` tests.

**Hint.** Precompute `n' = -n^{-1} mod 2^64` (Newton iteration on 64-bit words) and `R² mod n` with `R = 2^64`. The REDC step replaces division with a multiply, an add, and a shift. Convert operands into Montgomery form once per test.

**REDC reference (pseudocode).**
```text
# n odd, R = 2^64, n' = -n^{-1} mod R
REDC(T):                  # T < n*R, returns T*R^{-1} mod n
    m = ((T mod R) * n') mod R     # low 64 bits * n', keep low 64 bits
    t = (T + m*n) >> 64            # exact divide by R
    if t >= n: t -= n              # one conditional subtraction
    return t

to_mont(x)   = REDC(x * (R^2 mod n))   # x -> x*R mod n
from_mont(x) = REDC(x)                 # x*R mod n -> x
mont_mul(a,b)= REDC(a * b)             # both in Montgomery form
```

**Evaluation criteria.**
- `powMod` using Montgomery matches the reference `powMod` on random inputs.
- Measurable speedup (often 2-4×) over division-based `mulmod` on the batch.
- Correct handling of the final conditional subtraction in REDC.
- `n'` computed correctly (verify `n * n' ≡ -1 mod 2^64`).

---

### Task 12 — BPSW test (Miller-Rabin base 2 + strong Lucas)

**Problem.** Implement BPSW: one Miller-Rabin strong-probable-prime test to base 2, plus a strong Lucas probable-prime test with Selfridge parameters. Verify it agrees with deterministic MR for all `n < 10^7`.

**Constraints.** `n < 2^63`.

**Hint.** Selfridge `D`: first value in `5, -7, 9, -11, 13, …` with Jacobi `(D/n) = -1`. Then `P = 1`, `Q = (1-D)/4`. Factor `n+1 = d'·2^{s'}` and run the strong Lucas chain on `U_{d'}, V_{d'}`. Reject perfect squares first.

**Jacobi symbol helper (Python).**
```python
def jacobi(a, n):
    assert n > 0 and n % 2 == 1
    a %= n
    result = 1
    while a != 0:
        while a % 2 == 0:
            a //= 2
            if n % 8 in (3, 5):
                result = -result
        a, n = n, a
        if a % 4 == 3 and n % 4 == 3:
            result = -result
        a %= n
    return result if n == 1 else 0
```

**Evaluation criteria.**
- Agrees with deterministic MR for all `n ≤ 10^7` (including Carmichael numbers).
- Correctly skips perfect squares (use an integer square-root check).
- Documents that no BPSW counterexample is known and none exists below `2^64`.

---

### Task 13 — Cryptographic prime generation

**Problem.** Generate a random `b`-bit probable prime using a generate-and-test loop: random odd candidate with top bit set, small-prime sieve, then `k` Miller-Rabin rounds with random bases.

**Constraints.** `b ∈ {256, 512, 1024}`, `k` per a standard table (e.g. `k = 5` for ≥1024-bit). Use a CSPRNG.

**Hint.** Trial-divide by primes up to ~2000 first; this rejects most candidates before any exponentiation. Expect ~`0.69·b` candidates before success. Use big integers (Go `math/big`, Java `BigInteger`, Python int).

**Evaluation criteria.**
- Output passes an independent reference primality test (`BigInteger.isProbablePrime` / `gmpy2.is_prime`).
- The small-prime sieve measurably reduces the number of MR calls.
- Bases are drawn from a CSPRNG; round count follows the chosen standard.

---

### Task 14 — Pollard's rho factorization gated by Miller-Rabin

**Problem.** Implement `factorize(n)` that fully factors `n < 2^64` by recursively splitting with Pollard's rho, using your deterministic Miller-Rabin to decide when a part is prime (and stop recursing).

**Constraints.** `n < 2^64`.

**Hint.** If `isPrime(n)`, output `n`. Else find a nontrivial factor `g` via Pollard's rho (Brent's variant, with the same overflow-safe `mulmod`), then recurse on `g` and `n/g`. Handle the factor `2` separately.

**Pollard rho reference (Python).**
```python
from math import gcd
import random


def pollard_rho(n):
    if n % 2 == 0:
        return 2
    while True:
        x = random.randrange(2, n)
        y, c, d = x, random.randrange(1, n), 1
        f = lambda v: (v * v + c) % n
        while d == 1:
            x = f(x)
            y = f(f(y))
            d = gcd(abs(x - y), n)
        if d != n:
            return d   # nontrivial factor


def factorize(n):
    if n == 1:
        return []
    if is_prime(n):          # reuse Task 6
        return [n]
    g = pollard_rho(n)
    return factorize(g) + factorize(n // g)
```

**Evaluation criteria.**
- Correctly factors semiprimes (product of two ~32-bit primes) and highly composite numbers.
- Uses Miller-Rabin to avoid recursing into primes.
- Product of returned factors equals `n`; each factor passes `isPrime`.

---

### Task 15 — Decide which primality tool fits a scenario

**Problem.** Implement `classify(scenario)` (or write a short analysis) that, given `(max_n, adversarial, need_certificate, need_factor)`, returns one of: `TRIAL_DIVISION`, `DETERMINISTIC_MR`, `PROBABILISTIC_MR`, `BPSW`, `ECPP_CERTIFICATE`, or `POLLARD_RHO`. Justify each.

**Constraints / cases to handle.**
- `max_n < 2^64`, not adversarial, no certificate → `DETERMINISTIC_MR`.
- `max_n` unbounded, adversarial → `BPSW` (or `PROBABILISTIC_MR` with random bases).
- `need_certificate` → `ECPP_CERTIFICATE`.
- `need_factor` → `POLLARD_RHO` (gated by MR).
- tiny `max_n` (`< 10^6`) → `TRIAL_DIVISION` is simplest.

**Hint.** Encode the decision rules from `senior.md` and `professional.md`. The adversarial case is the trap: fixed small bases are unsafe beyond their proven bound.

**Evaluation criteria.**
- Correctly classifies all canonical cases.
- The adversarial branch explicitly avoids fixed small bases (cites Arnault / proven-bound limits).
- Justification references the right complexity and guarantee (`O(log³ n)`, `≤ (1/4)^k`, deterministic bounds).

---

## Benchmark Task

### Task B — Trial division vs Miller-Rabin crossover

**Problem.** Empirically find the `n` at which Miller-Rabin overtakes trial division. Implement three workloads:

- **(a) Trial division:** test primality by dividing up to `√n` — `O(√n)`.
- **(b) Deterministic Miller-Rabin:** the proven base-set witness loop — `O(log³ n)`.
- **(c) Probabilistic Miller-Rabin (`k` bases):** `O(k log³ n)`.

Measure wall-clock time for testing single numbers of increasing size (`n ∈ {10^6, 10^9, 10^12, 10^15, 10^18}`) and for batches.

**Starter — Python.**
```python
import random
import time

def is_prime_trial(n):
    if n < 2:
        return False
    i = 2
    while i * i <= n:
        if n % i == 0:
            return False
        i += 1
    return True


def is_prime_mr(n):
    # TODO: deterministic Miller-Rabin (reuse Task 6)
    return False


def bench(fn, n, repeats=5):
    start = time.perf_counter()
    for _ in range(repeats):
        fn(n)
    return (time.perf_counter() - start) / repeats * 1000.0  # ms


def main():
    print("n              trial_ms        mr_ms")
    for n in [10**6 + 3, 10**9 + 7, 10**12 + 39, 10**15 + 37]:
        t_mr = bench(is_prime_mr, n)
        # trial division only where it finishes in reasonable time
        if n <= 10**12:
            t_trial = bench(is_prime_trial, n, repeats=1)
            print(f"{n:<14d} {t_trial:<15.3f} {t_mr:.4f}")
        else:
            print(f"{n:<14d} {'(skipped)':<15} {t_mr:.4f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same numbers across Go, Java, and Python.
- Trial division (a) wins only for tiny `n`; Miller-Rabin (b)/(c) win as `n` grows.
- Miller-Rabin tests a `10^18` number in microseconds; trial division is infeasible there.
- Report includes the mean across at least 3 runs and excludes setup time.
- Writeup: a short note on the measured crossover and how it compares to the theoretical `√n` vs `log³ n` curves (the crossover is very small — typically `n` in the low thousands to millions).

---

## General Guidance for All Tasks

- **Always validate against the trial-division oracle first.** Run it on all `n ≤ 10^6`, diff against Miller-Rabin, and only then trust the fast test on large `n`.
- **Always include the Carmichael battery** (`561, 1105, 1729, 2465, 2821, 6601, 8911`) in your tests — they must all report composite.
- **Pin the base set and `mulmod` strategy as named constants.** Use a *proven* base set for your range; never invent one.
- **Get `n - 1 = d·2^s` right.** Pull out *all* factors of 2; `d` must be odd. Square exactly `s-1` times after `a^d`.
- **Mind overflow.** In Go/Java use `__int128`/`bits.Mul64`/BigInteger/Montgomery; the doubling trick needs `n < 2^63`. Test the largest 64-bit prime `18446744073709551557`.
- **A witness proves composite; "prime" is certain only with a proven base set.** For unbounded/adversarial `n`, use random bases or BPSW (Task 12, Task 15).
- **Reuse the `mulmod`/`powMod`/witness trio.** Most bugs live in `mulmod`; write it once, test it hard, and parameterize the rest by base set.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same inputs.
