# Binary Exponentiation (Fast Power) — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Each task ships with a precise spec and starter scaffolding. Implement the fast-power logic and validate against the evaluation criteria.
> **Always test against a brute-force `O(n)` loop oracle on small `n` before trusting the fast-power result on huge `n`.**

---

## Beginner Tasks (5)

### Task 1 — Plain fast power `a^n`

**Problem.** Implement `power(a, n)` returning the exact integer `a^n` using square-and-multiply (no modulus). Assume the result fits in 64-bit for Go/Java; Python is unbounded.

**Constraints.** `0 ≤ n ≤ 62`, `0 ≤ a ≤ 10`. Must run in `O(log n)` multiplications. Handle `n = 0` (return `1`) and `a = 0` (`0^0 = 1`, `0^n = 0` for `n > 0`).

**Expected.** `power(2, 10) = 1024`, `power(3, 0) = 1`, `power(0, 5) = 0`.

**Starter — Go.**
```go
func power(a, n int64) int64 {
	// TODO: square-and-multiply, start result at 1
	return 0
}
```
**Starter — Java.**
```java
static long power(long a, long n) {
    // TODO
    return 0;
}
```
**Starter — Python.**
```python
def power(a, n):
    # TODO
    pass
```
**Evaluation:** correctness, `O(log n)`, edge cases `n=0`, `a=0`.

---

### Task 2 — Modular fast power `a^n mod m`

**Problem.** Implement `powmod(a, n, m)` returning `a^n mod m`. Reduce the base first and reduce after every multiply.

**Constraints.** `0 ≤ a, n ≤ 10^18`, `1 ≤ m ≤ 10^9 + 7`. Handle `m = 1` (return `0`) using `result = 1 % m`.

**Expected.** `powmod(3, 13, 100) = 23`, `powmod(2, 1_000_000_000, 1_000_000_007)` is instant, `powmod(7, 5, 1) = 0`.

**Hint.** This is Task 1 with `% m` after each `*`.

**Evaluation:** correctness vs the naive `O(n)` loop on small inputs; no overflow; `m = 1` handled.

---

### Task 3 — Count squarings and multiplies

**Problem.** Modify `powmod` to also return the number of squarings and the number of multiply-into-result operations performed. Verify the multiply count equals `popcount(n)` and the squaring count equals `⌊log₂ n⌋` (or `+1` if you do the final unused squaring).

**Constraints.** `1 ≤ n ≤ 10^9`.

**Expected.** For `n = 15` (`1111₂`): 4 multiplies, ~4 squarings. For `n = 16` (`10000₂`): 1 multiply.

**Evaluation:** counts match the bit structure of `n`.

---

### Task 4 — Recursive fast power

**Problem.** Implement the left-to-right recursive form: `power(a, n) = (power(a, n/2))² ` for even `n`, `a · power(a, n-1)` for odd `n`. Compute the half *once* (do not call twice).

**Constraints.** `0 ≤ n ≤ 10^9`, modulus `10^9 + 7`. Recursion depth must be `O(log n)`.

**Expected.** Matches the iterative `powmod` on all inputs.

**Pitfall to avoid.** Calling `power(a, n/2) * power(a, n/2)` makes it `O(n)` — compute the half once.

**Evaluation:** correctness, `O(log n)` depth, agreement with iterative version.

---

### Task 5 — Last digit of `a^n`

**Problem.** Return the last decimal digit of `a^n` using `powmod(a, n, 10)`.

**Constraints.** `0 ≤ a ≤ 10^9`, `0 ≤ n ≤ 10^18`.

**Expected.** `lastDigit(7, 4) = 1` (`7^4 = 2401`), `lastDigit(2, 10) = 4` (`1024`), `lastDigit(5, 1) = 5`.

**Evaluation:** correct use of modulus `10`; handles `n = 0` (digit `1`).

---

## Intermediate Tasks (5)

### Task 6 — Modular inverse via Fermat

**Problem.** Given a prime `p` and `a` with `gcd(a, p) = 1`, return `a^(-1) mod p = a^(p-2) mod p` using fast power. Reject `a ≡ 0 (mod p)`.

**Constraints.** `p` prime, `p ≤ 10^9 + 7`, `1 ≤ a < p`.

**Expected.** `inv(7, 13) = 2` (since `7·2 = 14 ≡ 1`), `inv(3, 1_000_000_007)` returns the valid inverse.

**Evaluation:** `(a * inv(a, p)) % p == 1` for all test inputs; correct rejection of `a ≡ 0`.

---

### Task 7 — `C(n, k) mod p`

**Problem.** Compute the binomial coefficient `C(n, k) mod p` using factorials and Fermat inverses (fast power).

**Constraints.** `0 ≤ k ≤ n ≤ 10^6`, `p = 10^9 + 7`. Precompute factorials and inverse factorials (one Fermat inverse + backward pass).

**Expected.** `C(10, 3) = 120`, `C(5, 0) = 1`, `C(4, 5) = 0`.

**Hint.** `invFact[n] = inv(fact[n], p)` once; then `invFact[i] = invFact[i+1] * (i+1) % p` backward.

**Evaluation:** correctness for edge `k = 0`, `k > n`; `O(n)` precompute + `O(1)` per query.

---

### Task 8 — Large-modulus power (overflow-safe)

**Problem.** Compute `a^n mod m` where `m` can be up to `10^18`, so `a*b` overflows 64-bit. Implement a 128-bit (or Russian-peasant) `mulmod` for Go/Java; Python's `pow` suffices.

**Constraints.** `0 ≤ a, n ≤ 10^18`, `1 ≤ m ≤ 10^18`.

**Expected.** Matches Python's `pow(a, n, m)` on all inputs.

**Hint.** Go: `math/bits.Mul64` + `Div64`. Java: `BigInteger` or `Math.multiplyHigh`.

**Evaluation:** no overflow; agreement with a big-integer reference.

---

### Task 9 — Fast Fibonacci by matrix power

**Problem.** Return `F_n mod p` for `n` up to `10^18` by powering `[[1,1],[1,0]]` with the *same* binary-exponentiation loop (matrix multiply instead of scalar).

**Constraints.** `0 ≤ n ≤ 10^18`, `p = 10^9 + 7`.

**Expected.** `fib(0) = 0`, `fib(10) = 55`, `fib(1_000_000_000_000)` instant.

**Hint.** Start the accumulator at the identity matrix `I`; read `F_n` from entry `[0][1]`.

**Evaluation:** correctness vs the `O(n)` Fibonacci loop on small `n`; `O(log n)`.

---

### Task 10 — `a^(-n) mod p`

**Problem.** Compute `a^(-n) mod p` for prime `p`: first the inverse via Fermat, then raise to `n`. Handle `n = 0` (return `1`).

**Constraints.** `p` prime, `0 ≤ n ≤ 10^18`, `1 ≤ a < p`.

**Expected.** `(a^n * negpow(a, n, p)) % p == 1` for all inputs.

**Hint.** `a^(-n) = (a^(p-2))^n mod p`, or equivalently `(a^n)^(p-2)`.

**Evaluation:** correctness; both formulations agree.

---

## Advanced Tasks (5)

### Task 11 — Generic monoid fast power

**Problem.** Write a single generic `fastPow(x, identity, n, multiply)` that powers *any* monoid given a `multiply` function and an `identity`. Demonstrate it with (a) integers mod `m`, (b) `2×2` matrices, and (c) string repetition (`"ab"^3 = "ababab"`, identity `""`).

**Constraints.** `0 ≤ n ≤ 10^9` (use small `n` for the string case).

**Expected.** `fastPow(3, 1, 13, mulModM) = 3^13 mod m`; `fastPow("ab", "", 3, concat) = "ababab"`.

**Hint.** Go: pass a `func(a, b T) T`. Java: a generic functional interface. Python: a callable.

**Evaluation:** one bit-loop reused across all three monoids; correctness for each.

---

### Task 12 — Constant-time Montgomery ladder

**Problem.** Implement the two-register Montgomery powering ladder: process bits MSB→LSB, doing exactly one multiply and one square per bit. Verify it returns the same value as the variable-time loop, and argue why its operation count is independent of the exponent's bit values.

**Constraints.** `0 ≤ n < 2^63`, modulus `≤ 10^9 + 7`.

**Expected.** `ladder(3, 13, m) == powmod(3, 13, m)` for all inputs; operation count is exactly `2 · bitlength`.

**Hint.** Maintain `R0 = a^prefix`, `R1 = a^(prefix+1)`; on bit 0 square `R0`, on bit 1 square `R1`, always cross-multiply the other.

**Evaluation:** correctness; uniform per-bit work (count multiplies and confirm constant per bit).

---

### Task 13 — Tetration / power tower mod m

**Problem.** Compute `a^(a^(a^...)) mod m` (a power tower of height `k`) using the **lifting-the-exponent / Euler-tower** technique: the exponent is reduced mod `φ(m)` (Euler's totient), recursively. Use fast power for each level.

**Constraints.** `1 ≤ a ≤ 10^9`, `1 ≤ k ≤ 5`, `1 ≤ m ≤ 10^9`.

**Expected.** For `a = 2, k = 4` (`2^(2^(2^2)) = 2^16 = 65536`), `mod 1000 = 536`.

**Hint.** Define `tower(a, k, m)`: if `k == 0` return `1`; else exponent `e = tower(a, k-1, φ(m))` and return `powmod(a, e + φ(m), m)` (the `+φ(m)` handles the generalized Euler theorem when `e ≥ log₂ m`).

**Evaluation:** correctness on small towers verifiable by direct computation; correct totient handling.

---

### Task 14 — Order of an element modulo a prime

**Problem.** Given a prime `p` and `a` coprime to `p`, find the multiplicative **order** of `a` (smallest `d > 0` with `a^d ≡ 1 mod p`). The order divides `p-1`; factor `p-1` and test divisors using fast power.

**Constraints.** `p` prime, `p ≤ 10^9 + 7`, `1 < a < p`.

**Expected.** Order of `2 mod 7` is `3` (`2^3 = 8 ≡ 1`); order of a primitive root equals `p-1`.

**Hint.** Start with `d = p-1`; for each prime factor `q` of `p-1`, while `a^(d/q) ≡ 1`, divide `d` by `q`.

**Evaluation:** correctness; uses `O(log p)` per power and only `O(log p)` divisor tests.

---

### Task 15 — Kitamasa-lite: large-order recurrence by polynomial power (challenge)

**Problem.** For an order-`k` linear recurrence `f(n) = Σ c_i f(n-i)`, evaluate `f(n) mod p` for huge `n` by computing `x^n mod χ(x)` (where `χ(x) = x^k − Σ c_i x^{k-i}`) via binary exponentiation in the polynomial monoid, then dotting the result coefficients with the initial values. Compare its `O(k² log n)` cost to the `O(k³ log n)` matrix method.

**Constraints.** `1 ≤ k ≤ 100`, `0 ≤ n ≤ 10^18`, `p = 10^9 + 7`.

**Expected.** Matches the matrix-exponentiation result (Task 9 generalized) on Fibonacci (`k=2`) and tribonacci (`k=3`); faster for large `k`.

**Hint.** Polynomial `multiply` = convolution then reduce mod `χ(x)` (`O(k²)`); fast-power `x` to the `n`. The result `r(x) = Σ r_i x^i` gives `f(n) = Σ r_i f(i)`.

**Evaluation:** correctness vs matrix method; demonstrated `O(k² log n)` scaling; clean reuse of the generic fast-power loop.

---

## Benchmark Task

> Compare fast power vs the naive `O(n)` loop across all 3 languages, and confirm the `O(log n)` curve (runtime grows with the *number of bits* of `n`, not with `n`).

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func powmod(a, n, m int64) int64 {
	a %= m
	r := int64(1) % m
	for n > 0 {
		if n&1 == 1 {
			r = r * a % m
		}
		a = a * a % m
		n >>= 1
	}
	return r
}

func main() {
	const m = int64(1_000_000_007)
	for _, k := range []uint{10, 20, 30, 40, 50, 60} {
		n := int64(1) << k
		start := time.Now()
		for i := 0; i < 1_000_000; i++ {
			_ = powmod(2, n, m)
		}
		fmt.Printf("n=2^%2d: %v / call\n", k, time.Since(start)/1_000_000)
	}
}
```

#### Java

```java
public class Benchmark {
    static long powmod(long a, long n, long m) {
        a %= m;
        long r = 1 % m;
        while (n > 0) {
            if ((n & 1) == 1) r = r * a % m;
            a = a * a % m;
            n >>= 1;
        }
        return r;
    }

    public static void main(String[] args) {
        long m = 1_000_000_007L;
        for (int k : new int[]{10, 20, 30, 40, 50, 60}) {
            long n = 1L << k;
            long start = System.nanoTime();
            for (int i = 0; i < 1_000_000; i++) powmod(2, n, m);
            long ns = (System.nanoTime() - start) / 1_000_000;
            System.out.printf("n=2^%2d: %d ns/call%n", k, ns);
        }
    }
}
```

#### Python

```python
import timeit

M = 1_000_000_007
for k in (10, 20, 30, 40, 50, 60):
    n = 1 << k
    t = timeit.timeit(lambda: pow(2, n, M), number=1_000_000)
    print(f"n=2^{k:2d}: {t/1_000_000*1e9:.0f} ns/call")
```

**Expected observation:** runtime increases by a roughly *constant* amount each time `k` (the bit length of `n`) grows — the hallmark of `O(log n)`. Doubling `n` adds one iteration, not double the time.
