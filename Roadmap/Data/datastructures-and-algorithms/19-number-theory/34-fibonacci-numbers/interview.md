# Fibonacci Numbers — Interview Preparation

Fibonacci is a perennial interview topic because it rewards a single arc of insight — *"naive recursion is `O(φ^n)`; memoization or a two-variable loop makes it `O(n)`; matrix exponentiation or fast doubling makes it `O(log n)`"* — and then tests whether you can (a) avoid the exponential trap, (b) compute `F(n) mod m` without overflow, (c) derive or apply the **fast-doubling** identities, and (d) reason about identities like Cassini and `gcd(F(m), F(n)) = F(gcd(m,n))`. This file is a tiered question bank, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Need | Method | Complexity |
|------|--------|------------|
| Understand the recurrence | naive recursion | `O(φ^n)` — teaching only |
| `F(n)`, small/medium `n` | two-variable loop | `O(n)` time, `O(1)` space |
| Keep recursive shape | memoization | `O(n)` time, `O(n)` space |
| `F(n) mod m`, huge `n` | **fast doubling** | `O(log n)` |
| General linear recurrence | matrix exponentiation | `O(k³ log n)` |
| Batch of `F(n_i) mod m`, fixed `m` | Pisano period + table | `O(π(m) + Q)` |
| Exact huge value | fast doubling (bignum) / CRT | `O(M(n))` |
| Size estimate | Binet `0.694 n` bits | `O(1)` |

Core identities:

```
F(n) = F(n-1) + F(n-2),  F(0)=0, F(1)=1
M = [[1,1],[1,0]],  M^n = [[F(n+1),F(n)],[F(n),F(n-1)]]
F(2k)   = F(k)*(2*F(k+1) - F(k))      # fast doubling
F(2k+1) = F(k)^2 + F(k+1)^2
F(n+1)F(n-1) - F(n)^2 = (-1)^n        # Cassini
gcd(F(m), F(n)) = F(gcd(m, n))
sum_{i=0}^{n} F(i) = F(n+2) - 1
```

Key facts:
- Naive recursion is **exponential** — `~2F(n+1) − 1` calls.
- `F(47)` overflows int32; `F(93)` overflows int64.
- Modular Fibonacci needs **no division** — any modulus `m` works.
- Binet (`round(φ^n/√5)`) is **wrong past `n ≈ 70`** in `double`.

---

## Junior Questions (12 Q&A)

### J1. Define the Fibonacci sequence.
`F(0) = 0`, `F(1) = 1`, and `F(n) = F(n-1) + F(n-2)` for `n ≥ 2`: `0, 1, 1, 2, 3, 5, 8, 13, …`. Each term is the sum of the two before it.

### J2. Why is naive recursion slow?
It recomputes the same subproblems exponentially many times — `fib(n)` calls `fib(n-1)` and `fib(n-2)`, which overlap massively. The number of calls is `2F(n+1) − 1 = Θ(φ^n) ≈ Θ(1.618^n)`, so `fib(50)` is infeasible.

### J3. How do you make it `O(n)`?
Either **memoize** the recursion (cache each `F(i)`), or use a **bottom-up loop** keeping only the last two values: `a, b = b, a + b`, repeated `n` times. The loop is `O(n)` time and `O(1)` space.

### J4. Why keep only two variables?
Each term needs only the previous two, so storing the whole array is unnecessary. Carry `a = F(i-1)` and `b = F(i)`; each step slides the window forward.

### J5. What are the base cases and why do they matter?
`F(0) = 0` and `F(1) = 1`. Without them the recursion never stops, and getting them wrong shifts every later value (off-by-one).

### J6. When does Fibonacci overflow?
`F(47)` exceeds a signed 32-bit integer; `F(93)` exceeds signed 64-bit. Use 64-bit by default, big integers for exact large values, or compute `F(n) mod m`.

### J7. How do you compute `F(n) mod m`?
Reduce inside the loop: `b = (a + b) % m`. Never compute the giant number first — it overflows. Modular reduction commutes with addition, so the result is exact.

### J8. What is the difference between memoization and the loop?
Both are `O(n)` time. Memoization keeps the recursive shape but uses `O(n)` memory (cache + stack); the loop uses `O(1)` memory. Prefer the loop when you only need `F(n)`.

### J9. What does "linear recurrence" mean?
The next term is a fixed linear combination of previous terms — here `1·F(n-1) + 1·F(n-2)`. No squares, no products of terms, constant coefficients. This linearity is what enables the `O(log n)` methods.

### J10. What is the golden ratio's role?
`F(n)` grows roughly like `φ^n` where `φ = (1+√5)/2 ≈ 1.618`, and `F(n+1)/F(n) → φ`. It is why Fibonacci grows fast and why naive recursion is `Θ(φ^n)`.

### J11. How would you test your Fibonacci function?
Check against the known table `0,1,1,2,3,5,8,13,21,34,55`, including the base cases `F(0)=0, F(1)=1`. For modular versions, diff against a slow loop on small `n`.

### J12 (analysis). What is the time and space of the bottom-up loop?
`O(n)` time (one pass) and `O(1)` space (two variables). If you need *all* `F(0..n)`, an array makes it `O(n)` space.

---

## Middle Questions (12 Q&A)

### M1. How do you compute `F(n)` in `O(log n)`?
Two ways: **matrix exponentiation** of `M = [[1,1],[1,0]]` by binary squaring (`F(n)` is `M^n[0][1]`), or **fast doubling** using `F(2k) = F(k)(2F(k+1) − F(k))` and `F(2k+1) = F(k)² + F(k+1)²`. Both are `O(log n)`.

### M2. State the matrix identity.
`M^n = [[F(n+1), F(n)],[F(n), F(n-1)]]` for `M = [[1,1],[1,0]]`. So powering `M` computes Fibonacci numbers, with `F(n)` at entry `[0][1]`.

### M3. Why is fast doubling preferred over the matrix?
Both are `O(log n)`, but fast doubling does ~3 multiplications per bit versus the matrix's ~8 for squaring alone (plus up to 8 more for the conditional step). Since multiplications (with modular reductions) dominate, fast doubling is ~2× faster for plain Fibonacci.

### M4. Where do the fast-doubling identities come from?
From `M^{2k} = (M^k)²`: square the matrix form of `M^k` and match entries against `M^{2k}`. The full derivation is in `professional.md`.

### M5. What is the modular subtraction trap in fast doubling?
`2·F(k+1) − F(k)` can go negative after a modular reduction; `%` is negative in Go/Java for negative operands. Normalize: `((2*b - a) % m + m) % m`. This is the most common modular-Fibonacci bug.

### M6. Does the modulus have to be prime?
No. Fibonacci uses only `+, −, ×` (no modular inverse), so `F(n) mod m` works for any `m` — prime, prime power, or arbitrary composite. Only normalize the subtraction.

### M7. What is the Pisano period?
The period of `F(n) mod m`. The sequence repeats because there are only `m²` possible state pairs `(F(n), F(n+1)) mod m`. `π(m) ≤ 6m`. So `F(n) mod m = F(n mod π(m)) mod m`.

### M8. State Cassini's identity and prove it quickly.
`F(n+1)F(n-1) − F(n)² = (−1)^n`. Proof: take determinants of `M^n`; `det(M^n) = (det M)^n = (−1)^n`, and the determinant of the matrix form is exactly the left side.

### M9. How do you avoid recursion in fast doubling?
Scan the bits of `n` most-significant-first in a loop, maintaining `(F(k), F(k+1))`: double each bit, conditionally add one. No recursion stack.

### M10. When is the `O(n)` loop still the right choice?
When `n` is small (up to a few million). The loop is simpler and has no `log n` machinery. Reach for `O(log n)` only when `n` is large (billions to `10^18`).

### M11. How do you compute the sum `F(0) + … + F(n)` fast?
Use the identity `Σ_{i=0}^{n} F(i) = F(n+2) − 1`: one fast-doubling call for `F(n+2)`, subtract 1. `O(log n)`.

### M12 (analysis). Why can't matrix exponentiation handle `F(n) = F(n-1)·F(n-2)`?
That recurrence is *non-linear* (a product of terms). The `O(log n)` methods require a fixed *linear* advance `state_n = M·state_{n-1}`; a product breaks linearity, so no constant matrix advances it.

---

## Senior Questions (10 Q&A)

### S1. How do you compute `F(10^18) mod m`?
Fast doubling, reducing mod `m` every operation and normalizing the subtraction: `O(log n)`, ~60 doubling steps. The modulus can be any `m` (no division needed).

### S2. You have 10^5 queries `F(n_i) mod m` for a fixed `m`. Optimize.
Compute the Pisano period `π(m)` once (`O(6m)`), tabulate one full period `F(0..π(m)-1) mod m`, then answer each query as `table[n_i mod π(m)]` in `O(1)`. Total `O(π(m) + Q)` instead of `O(Q log n)`.

### S3. How do you compute the period `π(m)`?
Iterate the modular recurrence until the pair `(0, 1)` returns; the number of steps is `π(m) ≤ 6m`. For large `m`, factor `m`, compute `π(p^k)` per prime power, and `lcm` them (Pisano is multiplicative on coprime factors).

### S4. The answer must be the exact (non-modular) `F(n)`. What changes?
The exact value has `Θ(0.694 n)` bits, so arithmetic is no longer `O(1)`. Use fast doubling with big integers (`O(M(n))`, only `O(log n)` big multiplies), or run modular fast doubling under several coprime primes and CRT-reconstruct (parallelizable).

### S5. Why never use Binet's formula for exact values?
`F(n) = (φ^n − ψ^n)/√5` uses the irrational `φ`. In `double` (53-bit mantissa) it loses precision and is wrong past `n ≈ 70`; `F(n)` exceeds `2^53` near `n = 78`. And you cannot reduce an irrational mod `m`. Use Binet only for size estimates.

### S6. How do you handle overflow when `m` is near `2^62`?
The product `a*b` of two residues overflows `int64` *before* the `% m`. Use a `mulmod` (128-bit intermediate). Python is immune (bignums); Go/Java need it. See `19-number-theory/11-matrix-exponentiation` §2.5.

### S7. How does Fibonacci generalize to other recurrences?
Any constant-coefficient linear recurrence is `state_n = M^n · state_0` with a `k × k` companion matrix (`O(k³ log n)`). Fast doubling generalizes to **Kitamasa** (`O(k² log n)`) for higher order. Lucas numbers share Fibonacci's matrix and identities.

### S8. Prove `gcd(F(m), F(n)) = F(gcd(m, n))` at a high level.
Two facts: consecutive Fibonacci numbers are coprime (`gcd(F(n), F(n+1)) = 1`), and the addition formula gives `gcd(F(m), F(n)) = gcd(F(m), F(n-m))`. The index pair reduces exactly like the Euclidean algorithm, ending at `F(gcd(m,n))`.

### S9. How do you verify a Fibonacci implementation at scale?
Diff against a naive `O(n)` loop for `n` up to a few thousand; spot-check known values (`F(100) mod 10^9+7 = 687995182`); test identities (Cassini, gcd property, `F(2k)` formula); and verify `F(n) mod m == F(n mod π(m)) mod m`.

### S10 (analysis). How many CRT primes for an exact `F(n)`?
`F(n)` has ~`0.694 n` bits. Divide by each prime's bit-width (~30 for a 32-bit prime) and add one: ~`0.694 n / 30 + 1` primes. Each modular run is independent and parallelizable.

---

## Professional Questions (8 Q&A)

### P1. Derive the fast-doubling identities from the matrix.
`M^{2k} = (M^k)²`. With `M^k = [[F(k+1),F(k)],[F(k),F(k-1)]]`, squaring gives top-left `F(k+1)² + F(k)² = F(2k+1)` and top-right `F(k)(F(k+1)+F(k-1))`. Using `F(k-1) = F(k+1) − F(k)`, the latter is `F(k)(2F(k+1) − F(k)) = F(2k)`.

### P2. Why is naive recursion exactly `Θ(φ^n)`?
The call count `T(n) = T(n-1) + T(n-2) + 1` with `T(0)=T(1)=1`. Adding 1: `T(n)+1` is Fibonacci-shaped, so `T(n) = 2F(n+1) − 1 = Θ(φ^n)`.

### P3. Prove `Σ_{i=0}^{n} F(i)² = F(n)F(n+1)`.
Induction. Base `n=0`: `0 = F(0)F(1)`. Step: `Σ_{0}^{n+1} F(i)² = F(n)F(n+1) + F(n+1)² = F(n+1)(F(n)+F(n+1)) = F(n+1)F(n+2)`.

### P4. Formally, why is `F(n) mod m` purely periodic?
The state `(F(n), F(n+1)) mod m` evolves by `M`, and `det M = −1` is a unit mod any `m`, so `M ∈ GL_2(ℤ_m)`, a finite group. `M` has finite order `π(m)`, and invertibility means no pre-period — the period is pure.

### P5. What is the rank of apparition, and why does it exist?
`α(m)` is the least positive `n` with `m | F(n)`. By `F(d) | F(n) ⟺ d | n` (a corollary of the gcd identity), the set `{n : m | F(n)}` is exactly the multiples of `α(m)`, so `α(m)` exists and divides every such `n`.

### P6. State and justify the bit-length of `F(n)`.
`log₂ F(n) = n log₂ φ − ½ log₂ 5 + o(1) ≈ 0.6942 n − 1.16`, from Binet and `|ψ^n| → 0`. This budgets big-integer buffers and CRT prime counts and explains the `double` failure near `n ≈ 78`.

### P7. Give the generating function and what its denominator means.
`Σ F(n) x^n = x / (1 − x − x²)`. The denominator `1 − x − x²` is the reciprocal of the characteristic polynomial `x² − x − 1`; its reciprocal roots are `φ, ψ`, the matrix eigenvalues — the analytic shadow of the operator.

### P8 (analysis). Compare exact-value complexity of the loop vs fast doubling.
The loop does `n` additions on `Θ(n)`-bit numbers: `Θ(n · n) = Θ(n²)` bit operations (schoolbook). Fast doubling does `O(log n)` multiplications, dominated by the last on full-size operands: `O(M(n))`, i.e. `O(n²)` schoolbook but `O(n log n log log n)` with FFT — asymptotically far better.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about replacing an exponential algorithm with a polynomial one.
Look for a concrete story: a recursive computation (Fibonacci-like) that timed out, the insight that subproblems overlapped, the switch to memoization or a loop, and the measured speedup — plus a correctness check against the old slow version on small inputs.

### B2. A teammate shipped Binet's formula in `double` and got wrong large Fibonacci values. How do you respond?
Explain calmly that `φ` is irrational and `double` loses precision past `n ≈ 70`, with `F(n)` exceeding `2^53` near `n = 78`. The fix is integer fast doubling (or the matrix) mod `m`, or bignums for exact values. Frame it as exact-vs-approximate arithmetic, with a quick divergence demo.

### B3. Design a service answering `F(n) mod m` for many queries.
If `m` is fixed, compute the Pisano period once and serve queries from a tabulated period in `O(1)`. If `m` varies, use fast doubling per query (`O(log n)`). Discuss modulus-agnosticism (no division), overflow with large `m` (`mulmod`), and caching.

### B4. How would you explain Fibonacci's `O(log n)` to a junior?
Start from "knowing the last two numbers is enough." Then: "instead of stepping one index at a time, the fast-doubling identities let you *jump* from index `k` to `2k` in a few multiplications, so you only need ~60 steps to reach `10^18`." Lead with the two gotchas: handle base cases, and reduce mod `m`.

### B5. Your Fibonacci batch job uses too much memory. How do you investigate?
Check whether you are storing the whole `F(0..n)` array when two variables suffice, or tabulating an oversized Pisano period (`π(m)` can be up to `6m`). For exact values, recall `F(n)` has `0.694 n` bits — gigabytes for large `n`. Profile allocations; the fix is usually streaming with two variables or switching to a modulus.

---

## Coding Challenges

### Challenge 1: Fibonacci `mod p` in O(log n) (Fast Doubling)

**Problem.** Given `n` (up to `10^18`), return `F(n) mod 10^9 + 7` using fast doubling, `F(0)=0, F(1)=1`.

**Example.** `n = 10 → 55`; `n = 0 → 0`; `n = 1 → 1`.

**Optimal.** Fast doubling, `O(log n)`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func fibPair(n int64) (int64, int64) {
	if n == 0 {
		return 0, 1
	}
	a, b := fibPair(n >> 1)
	twoB := (2*b%MOD - a + MOD) % MOD
	c := a * twoB % MOD          // F(2k)
	d := (a*a%MOD + b*b%MOD) % MOD // F(2k+1)
	if n&1 == 0 {
		return c, d
	}
	return d, (c + d) % MOD
}

func fib(n int64) int64 { f, _ := fibPair(n); return f }

func main() {
	fmt.Println(fib(10))                 // 55
	fmt.Println(fib(0))                  // 0
	fmt.Println(fib(1_000_000_000_000))  // instant
}
```

**Java.**
```java
public class FibFast {
    static final long MOD = 1_000_000_007L;

    static long[] pair(long n) {
        if (n == 0) return new long[]{0, 1};
        long[] p = pair(n >> 1);
        long a = p[0], b = p[1];
        long twoB = ((2 * b % MOD - a) % MOD + MOD) % MOD;
        long c = a * twoB % MOD;
        long d = (a * a % MOD + b * b % MOD) % MOD;
        if ((n & 1) == 0) return new long[]{c, d};
        return new long[]{d, (c + d) % MOD};
    }

    static long fib(long n) { return pair(n)[0]; }

    public static void main(String[] args) {
        System.out.println(fib(10));               // 55
        System.out.println(fib(0));                // 0
        System.out.println(fib(1_000_000_000_000L)); // instant
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def pair(n):
    if n == 0:
        return (0, 1)
    a, b = pair(n >> 1)
    c = a * ((2 * b - a) % MOD) % MOD   # F(2k)
    d = (a * a + b * b) % MOD           # F(2k+1)
    return (c, d) if n & 1 == 0 else (d, (c + d) % MOD)


def fib(n):
    return pair(n)[0]


if __name__ == "__main__":
    print(fib(10))                  # 55
    print(fib(0))                   # 0
    print(fib(1_000_000_000_000))   # instant
```

---

### Challenge 2: Fibonacci via Matrix Exponentiation

**Problem.** Same as Challenge 1, but use the `2×2` matrix `[[1,1],[1,0]]`.

**Approach.** Power the matrix by binary exponentiation; `F(n) = M^n[0][1]`. `O(log n)`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func mul(a, b [2][2]int64) [2][2]int64 {
	var c [2][2]int64
	for i := 0; i < 2; i++ {
		for j := 0; j < 2; j++ {
			for t := 0; t < 2; t++ {
				c[i][j] = (c[i][j] + a[i][t]*b[t][j]) % MOD
			}
		}
	}
	return c
}

func fib(n int64) int64 {
	r := [2][2]int64{{1, 0}, {0, 1}}
	b := [2][2]int64{{1, 1}, {1, 0}}
	for n > 0 {
		if n&1 == 1 {
			r = mul(r, b)
		}
		b = mul(b, b)
		n >>= 1
	}
	return r[0][1]
}

func main() { fmt.Println(fib(10)); fmt.Println(fib(1_000_000_000_000)) }
```

**Java.**
```java
public class FibMat {
    static final long MOD = 1_000_000_007L;

    static long[][] mul(long[][] a, long[][] b) {
        long[][] c = new long[2][2];
        for (int i = 0; i < 2; i++)
            for (int j = 0; j < 2; j++)
                for (int t = 0; t < 2; t++)
                    c[i][j] = (c[i][j] + a[i][t] * b[t][j]) % MOD;
        return c;
    }

    static long fib(long n) {
        long[][] r = {{1, 0}, {0, 1}};
        long[][] b = {{1, 1}, {1, 0}};
        while (n > 0) {
            if ((n & 1) == 1) r = mul(r, b);
            b = mul(b, b);
            n >>= 1;
        }
        return r[0][1];
    }

    public static void main(String[] args) {
        System.out.println(fib(10));               // 55
        System.out.println(fib(1_000_000_000_000L));
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def mul(a, b):
    return [[sum(a[i][t] * b[t][j] for t in range(2)) % MOD
             for j in range(2)] for i in range(2)]


def fib(n):
    r = [[1, 0], [0, 1]]
    b = [[1, 1], [1, 0]]
    while n > 0:
        if n & 1:
            r = mul(r, b)
        b = mul(b, b)
        n >>= 1
    return r[0][1]


if __name__ == "__main__":
    print(fib(10))                  # 55
    print(fib(1_000_000_000_000))   # instant
```

---

### Challenge 3: Pisano Period and Batched Queries

**Problem.** Given a modulus `m` and `Q` queries `n_1, …, n_Q` (each up to `10^18`), return all `F(n_i) mod m`. Use the Pisano period.

**Approach.** Compute `π(m)`, tabulate one period, answer each query as `table[n_i mod π(m)]`. `O(π(m) + Q)`.

**Go.**
```go
package main

import "fmt"

func pisano(m int) int {
	if m == 1 {
		return 1
	}
	a, b := 0, 1
	for i := 1; i <= 6*m; i++ {
		a, b = b, (a+b)%m
		if a == 0 && b == 1 {
			return i
		}
	}
	return -1
}

func batch(m int, qs []int64) []int {
	p := pisano(m)
	tab := make([]int, p)
	if p > 1 {
		tab[1] = 1 % m
	}
	for i := 2; i < p; i++ {
		tab[i] = (tab[i-1] + tab[i-2]) % m
	}
	out := make([]int, len(qs))
	for i, n := range qs {
		out[i] = tab[int(n%int64(p))]
	}
	return out
}

func main() {
	fmt.Println(pisano(10)) // 60
	fmt.Println(batch(10, []int64{10, 1_000_000_000_000_000_000})) // [55%10=5, ...]
}
```

**Java.**
```java
import java.util.*;

public class Pisano {
    static int pisano(int m) {
        if (m == 1) return 1;
        int a = 0, b = 1;
        for (int i = 1; i <= 6 * m; i++) {
            int t = (a + b) % m; a = b; b = t;
            if (a == 0 && b == 1) return i;
        }
        return -1;
    }

    static int[] batch(int m, long[] qs) {
        int p = pisano(m);
        int[] tab = new int[p];
        if (p > 1) tab[1] = 1 % m;
        for (int i = 2; i < p; i++) tab[i] = (tab[i - 1] + tab[i - 2]) % m;
        int[] out = new int[qs.length];
        for (int i = 0; i < qs.length; i++) out[i] = tab[(int) (qs[i] % p)];
        return out;
    }

    public static void main(String[] args) {
        System.out.println(pisano(10)); // 60
        System.out.println(Arrays.toString(batch(10, new long[]{10, 1_000_000_000_000_000_000L})));
    }
}
```

**Python.**
```python
def pisano(m):
    if m == 1:
        return 1
    a, b = 0, 1
    for i in range(1, 6 * m + 1):
        a, b = b, (a + b) % m
        if a == 0 and b == 1:
            return i


def batch(m, qs):
    p = pisano(m)
    tab = [0] * p
    if p > 1:
        tab[1] = 1 % m
    for i in range(2, p):
        tab[i] = (tab[i - 1] + tab[i - 2]) % m
    return [tab[n % p] for n in qs]


if __name__ == "__main__":
    print(pisano(10))  # 60
    print(batch(10, [10, 10**18]))  # [5, ...]
```

---

### Challenge 4: Verify the GCD Property

**Problem.** Given `m` and `n`, verify that `gcd(F(m), F(n)) == F(gcd(m, n))` for exact (big-integer) Fibonacci numbers, for all pairs up to small `m, n`.

**Approach.** Compute exact `F` via fast doubling (bignums), compute `gcd` of the values, and compare with `F(gcd(m,n))`.

**Go.**
```go
package main

import (
	"fmt"
	"math/big"
)

func fib(n int64) *big.Int {
	// fast doubling, exact
	var pair func(k int64) (*big.Int, *big.Int)
	pair = func(k int64) (*big.Int, *big.Int) {
		if k == 0 {
			return big.NewInt(0), big.NewInt(1)
		}
		a, b := pair(k >> 1)
		// c = a*(2b - a)
		t := new(big.Int).Lsh(b, 1)
		t.Sub(t, a)
		c := new(big.Int).Mul(a, t)
		// d = a^2 + b^2
		d := new(big.Int).Add(new(big.Int).Mul(a, a), new(big.Int).Mul(b, b))
		if k&1 == 0 {
			return c, d
		}
		return d, new(big.Int).Add(c, d)
	}
	f, _ := pair(n)
	return f
}

func gcdI(a, b int64) int64 {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func main() {
	ok := true
	for m := int64(0); m <= 30; m++ {
		for n := int64(0); n <= 30; n++ {
			lhs := new(big.Int).GCD(nil, nil, fib(m), fib(n))
			rhs := fib(gcdI(m, n))
			if lhs.Cmp(rhs) != 0 {
				ok = false
			}
		}
	}
	fmt.Println("gcd property holds:", ok) // true
}
```

**Java.**
```java
import java.math.BigInteger;

public class FibGcd {
    static BigInteger[] pair(long k) {
        if (k == 0) return new BigInteger[]{BigInteger.ZERO, BigInteger.ONE};
        BigInteger[] p = pair(k >> 1);
        BigInteger a = p[0], b = p[1];
        BigInteger c = a.multiply(b.shiftLeft(1).subtract(a)); // a*(2b-a)
        BigInteger d = a.multiply(a).add(b.multiply(b));       // a^2+b^2
        if ((k & 1) == 0) return new BigInteger[]{c, d};
        return new BigInteger[]{d, c.add(d)};
    }

    static BigInteger fib(long n) { return pair(n)[0]; }

    static long gcd(long a, long b) { return b == 0 ? a : gcd(b, a % b); }

    public static void main(String[] args) {
        boolean ok = true;
        for (long m = 0; m <= 30; m++)
            for (long n = 0; n <= 30; n++)
                if (!fib(m).gcd(fib(n)).equals(fib(gcd(m, n)))) ok = false;
        System.out.println("gcd property holds: " + ok); // true
    }
}
```

**Python.**
```python
from math import gcd


def pair(k):
    if k == 0:
        return (0, 1)
    a, b = pair(k >> 1)
    c = a * (2 * b - a)   # exact, no mod
    d = a * a + b * b
    return (c, d) if k & 1 == 0 else (d, c + d)


def fib(n):
    return pair(n)[0]


if __name__ == "__main__":
    ok = all(gcd(fib(m), fib(n)) == fib(gcd(m, n))
             for m in range(31) for n in range(31))
    print("gcd property holds:", ok)  # True
```

---

## Final Tips

- Lead with the arc: *"naive `O(φ^n)` → DP `O(n)` → matrix / fast doubling `O(log n)`."*
- Flag the two universal gotchas: **handle base cases** and **reduce mod `m`** (normalizing the `2b − a` subtraction).
- For plain Fibonacci at large `n`, reach for **fast doubling** (fewest multiplies); mention the matrix as the general-recurrence tool.
- For a **batch** on one modulus, mention the **Pisano period** table.
- Never use **Binet in floating point** for exact values — it breaks past `n ≈ 70`.
- Know the headline identities: matrix form, fast doubling, **Cassini**, the **gcd property**, and the prefix sum `F(n+2) − 1`.
- Always offer to verify against a brute-force loop on small `n`. The general machinery is `19-number-theory/11-matrix-exponentiation`.
