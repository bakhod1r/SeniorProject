# Montgomery Multiplication (and Barrett Reduction) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the Montgomery/Barrett logic and validate against the evaluation criteria.
> **Always test against the plain `(a*b) % n` oracle (and the built-in `pow(a, b, n)` for modpow) on small inputs before trusting the fast version.**

---

## Beginner Tasks (5)

### Task 1 — Compute `n' = -n^{-1} mod R`

**Problem.** Given an odd modulus `n` and `R = 2^k`, compute `n' = (-n^{-1}) mod R` two ways: Newton iteration and extended Euclid. Verify they agree and that `n·n' ≡ R - 1 (mod R)`.

**Input / Output spec.**
- Read `n` (odd) and `k`.
- Print `n'` and `OK` if `(n * n') mod R == R - 1`, else `FAIL`.

**Constraints.**
- `n` odd, `1 ≤ k ≤ 64`, `R = 2^k > n`.

**Hint.** Newton: start `inv = n` (correct mod 8), repeat `inv = inv*(2 - n*inv) mod R` until stable. Then `n' = (-inv) mod R`.

**Starter — Go.**
```go
package main

import "fmt"

func nPrime(n uint64, k uint) uint64 {
	// TODO: Newton iteration for n^{-1} mod 2^k, then negate mod 2^k.
	return 0
}

func main() {
	var n uint64
	var k uint
	fmt.Scan(&n, &k)
	np := nPrime(n, k)
	mask := (uint64(1) << k) - 1
	fmt.Println(np)
	if (n*np)&mask == mask {
		fmt.Println("OK")
	} else {
		fmt.Println("FAIL")
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long nPrime(long n, int k) {
        // TODO: Newton iteration mod 2^k, then negate
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long n = sc.nextLong();
        int k = sc.nextInt();
        long np = nPrime(n, k);
        long mask = (1L << k) - 1;
        System.out.println(np);
        System.out.println(((n * np) & mask) == mask ? "OK" : "FAIL");
    }
}
```

**Starter — Python.**
```python
def n_prime(n, k):
    # TODO: Newton iteration for n^{-1} mod 2^k, then negate
    return 0


def main():
    n, k = map(int, input().split())
    R = 1 << k
    np = n_prime(n, k)
    print(np)
    print("OK" if (n * np) % R == R - 1 else "FAIL")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Newton and extended-Euclid results match.
- `n·n' ≡ -1 (mod R)` holds.
- Rejects even `n` (no inverse mod `2^k`).

---

### Task 2 — Implement REDC

**Problem.** Implement `REDC(T)` for `0 ≤ T < n·R` returning `T·R^{-1} mod n`, using `n'` from Task 1. Use only mask (mod R), shift (÷ R), multiplies, and one conditional subtraction.

**Input / Output spec.**
- Read `n` (odd), `k`, and `T`.
- Print `REDC(T)`.

**Constraints.** `n` odd, `R = 2^k > n`, `0 ≤ T < n·R`.

**Hint.** `m = (T mod R)·n' mod R`; `t = (T + m·n) / R`; `if t >= n: t -= n`. Verify `T + m·n` is divisible by `R`.

**Reference oracle (Python).**
```python
def redc_oracle(T, n, k):
    R = 1 << k
    Rinv = pow(R, -1, n)        # slow reference using a real inverse
    return (T * Rinv) % n
```

**Evaluation criteria.**
- Matches `redc_oracle` for many random `T`.
- The division by `R` is exact (`(T + m·n) % R == 0`).
- Output in `[0, n)`.

---

### Task 3 — Convert in and out of Montgomery form

**Problem.** Using REDC, implement `to_mont(x) = x·R mod n` (via `REDC(x·(R² mod n))`) and `from_mont(x̄) = REDC(x̄)`. Verify `from_mont(to_mont(x)) == x` for all `x in [0, n)`.

**Input / Output spec.**
- Read `n` (odd), `k`. For each `x` in `0..min(n,1000)-1`, check the round-trip.
- Print `OK` if all round-trips hold, else the first failing `x`.

**Constraints.** `n` odd, `R = 2^k > n`.

**Hint.** Precompute `R² mod n` once. `to_mont(1)` must equal `R mod n` (the Montgomery identity).

**Evaluation criteria.**
- `from_mont(to_mont(x)) == x` for all tested `x`.
- `to_mont(1) == R mod n`.
- `to_mont` uses no division by `n` (only REDC).

---

### Task 4 — Montgomery multiplication

**Problem.** Implement `mont_mul(ā, b̄) = REDC(ā·b̄)` and verify that for `a, b in [0, n)`, `from_mont(mont_mul(to_mont(a), to_mont(b))) == (a*b) % n`.

**Input / Output spec.**
- Read `n` (odd), `k`, `a`, `b`.
- Print `(a*b) mod n` computed via Montgomery, and `OK`/`FAIL` against `(a*b) % n`.

**Constraints.** `n` odd, `0 ≤ a, b < n`, `R = 2^k > n`.

**Hint.** Stay in Montgomery form: `a` and `b` go in, the product stays in form, convert out at the end.

**Evaluation criteria.**
- Matches `(a*b) % n` for random `a, b`.
- Correct on the boundary `a = b = n-1`.
- No division by `n` in `mont_mul`.

---

### Task 5 — Montgomery modular exponentiation

**Problem.** Implement `modpow(base, exp) = base^exp mod n` entirely in Montgomery form, converting in/out only at the boundaries. Read `n` (odd), `base`, `exp`.

**Input / Output spec.**
- Read `n`, `base`, `exp`. Print `base^exp mod n`.

**Constraints.** `n` odd, `0 ≤ base < 2^63`, `0 ≤ exp ≤ 10^18`.

**Hint.** Accumulator starts at `to_mont(1)`. `(F: result = mont_mul(result, b))` on set bits; square `b` each step. Convert out at the end.

**Starter — Python.**
```python
class Mont:
    def __init__(self, n, k=64):
        assert n % 2 == 1
        self.n, self.k = n, k
        self.R, self.mask = 1 << k, (1 << k) - 1
        self.np = (-pow(n, -1, self.R)) % self.R
        self.r2 = (self.R * self.R) % n

    def redc(self, t):
        # TODO: m = (t & mask)*np & mask; u = (t + m*n) >> k; subtract if u >= n
        return t % self.n  # placeholder

    def mul(self, a, b): return self.redc(a * b)
    def into(self, x):   return self.mul(x % self.n, self.r2)
    def outof(self, x):  return self.redc(x)

    def modpow(self, base, exp):
        # TODO: res = into(1); b = into(base); binary exponentiation with mul; outof(res)
        return pow(base, exp, self.n)  # placeholder oracle


if __name__ == "__main__":
    m = Mont(1_000_000_007)
    assert m.modpow(2, 10) == 1024
    assert m.modpow(3, 10**18) == pow(3, 10**18, 1_000_000_007)
    print("OK")
```

**Evaluation criteria.**
- Matches the built-in / plain `pow(base, exp, n)`.
- `O(log exp)` Montgomery multiplies; instant for `exp = 10^18`.
- `modpow(base, 0) == 1`.

---

## Intermediate Tasks (5)

### Task 6 — Barrett reduction

**Problem.** Implement Barrett reduction for an arbitrary modulus `n` (even allowed): precompute `μ = ⌊2^{2k}/n⌋` with `2^k > n`, then reduce `x < n²` via `q = (x·μ) >> 2k`, `r = x - q·n`, with at most two corrections.

**Constraints.** `1 ≤ n < 2^32` (so `x < n²` fits in 64 bits), `0 ≤ x < n²`.

**Hint.** Use `k = bitlen(n)` so `2^k > n`, and reduce with the `2k` shift. Assert the correction loop runs ≤ 2 times.

**Reference oracle (Python).**
```python
def barrett_oracle(x, n):
    return x % n
```

**Starter — Python.**
```python
class Barrett:
    def __init__(self, n):
        self.n = n
        self.k = 2 * n.bit_length() + 1
        self.mu = (1 << self.k) // n   # one-time division

    def reduce(self, x):               # 0 <= x < n^2
        # TODO: q = (x * mu) >> 2k; r = x - q*n; while r >= n: r -= n
        return x % self.n              # placeholder; replace with Barrett


if __name__ == "__main__":
    import random
    for n in (1_000_000_006, 1_000_000_007):   # even and odd
        b = Barrett(n)
        for _ in range(10000):
            x = random.randrange(n * n)
            assert b.reduce(x) == x % n
    print("OK")
```

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math/big"
)

type Barrett struct {
	N, MU *big.Int
	k     uint
}

func newBarrett(n uint64) Barrett {
	N := new(big.Int).SetUint64(n)
	k := uint(2*N.BitLen() + 1)
	MU := new(big.Int).Lsh(big.NewInt(1), k)
	MU.Div(MU, N)
	return Barrett{N: N, MU: MU, k: k}
}

func (b Barrett) reduce(x *big.Int) *big.Int {
	// TODO: q = (x*MU) >> k ; r = x - q*N ; correct while r >= N
	return new(big.Int).Mod(x, b.N) // placeholder
}

func main() {
	b := newBarrett(1_000_000_006)
	fmt.Println(b.reduce(big.NewInt(999_999_999_999)))
}
```

**Evaluation criteria.**
- Matches `x % n` for random `x < n²`, including **even** `n`.
- Correction loop runs at most twice (assert it).
- No division by `n` in the hot path (only the one-time `μ`).

---

### Task 7 — Montgomery vs Barrett vs plain `%` cross-check

**Problem.** For a fixed odd prime modulus, implement all three `mulmod`s (plain, Montgomery, Barrett) and assert they agree on a large batch of random `(a, b)` pairs. Report which has the fewest division-like operations.

**Constraints.** `n` odd prime `< 2^31`, at least `10^5` random pairs.

**Hint.** Plain uses one `% n`; Montgomery uses REDC (no `÷ n`); Barrett uses two multiplies + shift + ≤2 subtracts.

**Evaluation criteria.**
- All three agree on every pair.
- A short writeup: Montgomery has the cheapest per-multiply but needs conversions; Barrett needs none but costs an extra multiply; plain needs a division.

---

### Task 8 — Montgomery-based Miller-Rabin

**Problem.** Implement deterministic Miller-Rabin for `n < 2^64` using witnesses `{2,3,5,7,11,13,17,19,23,29,31,37}`, with the witness loop running in Montgomery form (the candidate `n` is odd after the small-prime screen).

**Constraints.** `2 ≤ n < 2^64`.

**Hint.** Build the Montgomery context once per `n`. Precompute `one = to_mont(1)` and `minus_one = to_mont(n-1)` to compare against without converting out.

**Reference oracle (Python).**
```python
def is_prime_oracle(n):
    if n < 2:
        return False
    i = 2
    while i * i <= n:
        if n % i == 0:
            return False
        i += 1
    return True
# Use only for small n to validate the Montgomery version.
```

**Test vectors (use these to validate).**
```text
is_prime(2) = True       is_prime(561) = False  (Carmichael, fools Fermat but not MR)
is_prime(7) = True       is_prime(1_000_000_007) = True
is_prime(1) = False      is_prime(1_000_000_011) = False
is_prime(25) = False     is_prime(2_147_483_647) = True  (Mersenne prime 2^31 - 1)
is_prime(341) = False    is_prime(3_215_031_751) = False (strong pseudoprime base 2,3,5,7)
```

**Evaluation criteria.**
- Matches `is_prime_oracle` for all `n` up to `10^6`.
- Correct on known large primes (`1_000_000_007`) and composites (`561` Carmichael, `1_000_000_011`).
- Even `n > 2` rejected immediately by the small-prime screen.
- The witness loop runs in Montgomery form (no `÷ n` in the squaring loop).

---

### Task 9 — Pollard-rho with Montgomery inner loop

**Problem.** Implement Pollard-rho factorization where the iteration `x ← x² + c (mod n)` runs in Montgomery form. Combine with Montgomery Miller-Rabin (Task 8) to fully factor a composite `n < 2^64`.

**Constraints.** `2 ≤ n < 2^64`, odd composite cofactors.

**Hint.** Keep `x`, `y`, `c` in Montgomery form (addition is free in the form). Use Brent's cycle detection and batch products before a single gcd. Recurse on found factors.

**Evaluation criteria.**
- Correctly factors semiprimes and multi-factor composites.
- Inner loop uses Montgomery `mulmod` (no `÷ n`).
- Matches trial-division factorization for small `n`.

---

### Task 10 — Constant-time conditional subtraction

**Problem.** Replace REDC's branching `if t >= n: t -= n` with a **branchless** masked subtraction, and verify it produces identical results to the branching version across random inputs.

**Constraints.** `n` odd `< 2^63`.

**Hint.** Compute `t2 = t - n` (may wrap), derive `mask` from the borrow (all-ones when `t < n`), and select: `result = (t & mask) | (t2 & ~mask)`. In Go/Java use unsigned comparison to set the mask.

**Evaluation criteria.**
- Branchless and branching REDC agree on all random inputs.
- No data-dependent branch in the hot path (inspect the code).
- Still correct on the boundary `t = n` and `t = 2n-1`.

---

## Advanced Tasks (5)

### Task 11 — 64-bit `R = 2^64` Montgomery with 128-bit products

**Problem.** Implement full 64-bit Montgomery (`R = 2^64`) using the language's 128-bit product primitive (`bits.Mul64`, `Math.multiplyHigh`, `__int128`/big-int), including the carry-aware conditional subtraction. Support odd `n` up to nearly `2^64`.

**Constraints.** `n` odd, `n < 2^64 - 1`.

**Hint.** REDC takes `(hi, lo)`; the low limb cancels to 0 (capture only its carry); add into the high limb; the conditional subtract must account for a carry-out of the high word.

**Evaluation criteria.**
- Matches plain `(a*b) % n` (computed with 128-bit intermediates) for random large `n`.
- Correct for `n` just below `2^64` (carry-out handled).
- `modpow` matches the built-in for large `n`.

---

### Task 12 — Redundant `[0, 2n)` representation (deferred subtraction)

**Problem.** Implement a Montgomery variant that keeps representatives in `[0, 2n)` and **omits** the conditional subtraction in the inner loop, normalizing once at the end. Require `4n ≤ R` so bounds never overflow.

**Constraints.** `n` odd, `4n ≤ R = 2^k`.

**Hint.** Without the subtract, REDC outputs stay in `[0, 2n)` when inputs are in `[0, 2n)` and `4n ≤ R`. Prove the bound, then drop the branch; normalize the final result with one subtract.

**Evaluation criteria.**
- Inner loop has no conditional subtraction.
- Final normalized result matches the standard Montgomery output.
- A short proof/argument that the `[0, 2n)` invariant is maintained.

---

### Task 13 — NTT with Montgomery butterflies

**Problem.** Implement a number-theoretic transform (sibling `13-ntt`) under a fixed NTT-friendly prime (e.g. `998244353`) where every butterfly multiply is a Montgomery multiply. Convert coefficients into Montgomery form once before the transform and out once after.

**Constraints.** Power-of-two transform length up to `2^20`, prime `998244353`.

**Hint.** Precompute twiddle factors in Montgomery form. Addition/subtraction stay in the form for free; only the twiddle multiply uses REDC. The `O(n)` conversions are negligible against `O(n log n)` butterflies.

**Evaluation criteria.**
- Polynomial multiplication via Montgomery NTT matches a naive `O(n²)` convolution mod the prime.
- Conversions happen exactly once each (in/out), not per butterfly.
- Measurable speedup over a `%`-based NTT in a compiled language.

---

### Task 14 — Reducer selection benchmark

**Problem.** For a fixed odd modulus, benchmark plain `%`-modpow, Montgomery modpow, and Barrett-modpow across a range of exponents. Identify where (if at all) Montgomery overtakes plain, and where Barrett sits. Report a table.

**Constraints.** `n` odd `< 2^31`, exponents `∈ {2^8, 2^16, 2^32, 2^60}`, ≥ 3 runs each.

**Hint.** Build each reducer's constants once. Time only the modpow loops (not setup). In compiled languages the division cost makes Montgomery/Barrett win as the exponent grows; report the crossover.

**Evaluation criteria.**
- Same modulus/exponents across Go, Java, Python; results agree numerically.
- Table reports mean over ≥ 3 runs, excluding setup time.
- Writeup: Montgomery wins for large exponents (many multiplies); for tiny exponents plain `%` may tie or win (no conversion to amortize).

---

### Task 15 — Decide the right reducer for a workload

**Problem.** Implement `classify(n_is_odd, modulus_is_constant, multiplies_per_modulus, constant_time_required)` returning one of `PLAIN`, `MONTGOMERY`, `BARRETT`, or `CRT_SPLIT`, with justification.

**Constraints / cases to handle.**
- Odd `n`, many multiplies, runtime modulus → `MONTGOMERY`.
- Even `n`, many multiplies → `BARRETT`.
- One-off multiply, or compile-time-constant modulus → `PLAIN` (compiler strength-reduces `%`).
- Even `n` but Montgomery speed truly required on the odd part → `CRT_SPLIT`.
- Constant-time crypto, odd `n` → `MONTGOMERY` (branchless subtract).

**Hint.** Encode the decision matrix from `senior.md` §3. The trap is the even-modulus case (Montgomery is invalid) and the compile-time-constant case (the compiler already optimized `%`).

**Evaluation criteria.**
- Correctly classifies all listed cases.
- The even-`n` branch never returns `MONTGOMERY`.
- Justification cites amortization, the odd-modulus restriction, and compiler strength-reduction.

---

## Benchmark Task

### Task B — Division-vs-shift micro-benchmark

**Problem.** Empirically demonstrate that the hardware division behind `%` is the bottleneck. Time a tight loop of `(a*b) % n` (division) against a tight loop of a single REDC (shift-based) for the same number of iterations, with a runtime (non-constant) modulus so the compiler cannot strength-reduce.

**Starter — Python.**
```python
import time


class Mont:
    def __init__(self, n, k=64):
        self.n, self.k = n, k
        self.R, self.mask = 1 << k, (1 << k) - 1
        self.np = (-pow(n, -1, self.R)) % self.R
        self.r2 = (self.R * self.R) % n
    def redc(self, t):
        m = ((t & self.mask) * self.np) & self.mask
        u = (t + m * self.n) >> self.k
        return u - self.n if u >= self.n else u
    def mul(self, a, b): return self.redc(a * b)


def main():
    import random
    n = random.choice([1_000_000_007, 998_244_353])  # runtime modulus
    m = Mont(n)
    a = m.r2  # some Montgomery-form value
    iters = 200_000
    t0 = time.perf_counter()
    acc = 1
    for _ in range(iters):
        acc = (acc * a) % n          # division-based
    td = (time.perf_counter() - t0) * 1000
    t0 = time.perf_counter()
    acc = a
    for _ in range(iters):
        acc = m.mul(acc, a)          # REDC-based (shift)
    tr = (time.perf_counter() - t0) * 1000
    print(f"division loop: {td:.2f} ms   REDC loop: {tr:.2f} ms")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same runtime modulus across Go, Java, Python (so no compiler strength-reduction of `%`).
- In compiled languages, the REDC loop is faster than the division loop; report the ratio.
- Note that CPython's big-int `%` is C-level, so the *shape* (division dominates) matters more than the absolute numbers there; the concrete win is in Go/Java/C.
- Report mean over ≥ 3 runs; exclude setup time.

---

## General Guidance for All Tasks

- **Always validate against the plain oracle first.** Every task references `(a*b) % n` or the built-in `pow(a, b, n)`. Run it on small inputs, diff, then trust the fast version.
- **Assert the modulus is odd for Montgomery.** Fail loudly; route even moduli to Barrett.
- **Verify the magic constant once:** `n·n' ≡ -1 (mod R)` and `from_mont(to_mont(x)) == x`.
- **Never skip the conditional subtraction** (except in the deliberate redundant-representation Task 12, where you prove the bound).
- **Mind the 128-bit product:** in Go/Java/C, `a*b` of two 64-bit values overflows; use `bits.Mul64` / `Math.multiplyHigh` / `__int128`.
- **Don't use Montgomery for a single multiply** — converting in and out costs more than one `%`.
- **Reuse the context.** Compute `n'` and `R² mod n` (or Barrett `μ`) once per modulus, never per operation.
- **Remember the Montgomery identity is `R mod n`, not `1`.** Accumulators in modpow start at `to_mont(1)`.
- **Branchless subtract only where you prove the bound** (Task 12); elsewhere the plain conditional subtraction is correct and clear.
- **The candidate in Miller-Rabin is odd** after the small-prime screen, which is exactly why Montgomery applies in Task 8.

- **Cross-check the magic constant** with `n·n' ≡ R - 1 (mod R)` in every task that computes `n'`.
- **For Barrett, keep inputs `< n²`** — the quotient bound (≤ 2 corrections) assumes it.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same inputs.
