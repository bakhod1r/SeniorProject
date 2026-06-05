# GCD and LCM (The Euclidean Algorithm) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the Euclidean / LCM logic and validate against the evaluation criteria.
> **Always verify against a trusted reference (the standard-library `gcd`, or a slow list-all-divisors GCD) on small inputs before trusting your implementation on large ones.**

---

## Beginner Tasks (5)

### Task 1 — Iterative GCD

**Problem.** Implement `gcd(a, b)` for non-negative integers using the iterative Euclidean loop `a, b = b, a mod b`. Return `a` when `b` reaches `0`.

**Input / Output spec.**
- Read two integers `a`, `b`.
- Print `gcd(a, b)`.

**Constraints.**
- `0 ≤ a, b ≤ 10^18`.
- Must be iterative (no recursion) and `O(log min(a, b))`.

**Hint.** Loop while `b != 0`; the remainder strictly decreases so it always terminates. Remember `gcd(a, 0) = a` and `gcd(0, 0) = 0`.

**Starter — Go.**
```go
package main

import "fmt"

func gcd(a, b int64) int64 {
	// TODO: iterative Euclidean loop
	return 0
}

func main() {
	var a, b int64
	fmt.Scan(&a, &b)
	fmt.Println(gcd(a, b))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long gcd(long a, long b) {
        // TODO: iterative Euclidean loop
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong();
        System.out.println(gcd(a, b));
    }
}
```

**Starter — Python.**
```python
import sys


def gcd(a, b):
    # TODO: iterative Euclidean loop
    return 0


def main():
    a, b = map(int, sys.stdin.read().split())
    print(gcd(a, b))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct for `gcd(48, 18) = 6`, `gcd(0, 9) = 9`, `gcd(0, 0) = 0`.
- Logarithmic step count (no subtraction-only loop).
- Matches the standard-library `gcd` on random inputs.

---

### Task 2 — Overflow-safe LCM

**Problem.** Implement `lcm(a, b)` using `a / gcd(a, b) * b`. Handle zero operands (`lcm(_, 0) = 0`) and order the operations so the intermediate does not overflow needlessly.

**Input / Output spec.**
- Read `a`, `b`. Print `lcm(a, b)`.

**Constraints.** `0 ≤ a, b ≤ 10^9` (so the LCM fits in signed 64-bit).

**Hint.** Divide by the GCD *before* multiplying. `a * b / gcd` would overflow; `a / gcd * b` does not (the division is exact because `gcd | a`).

**Worked check.** `lcm(4, 6) = 12`, `lcm(48, 18) = 144`, `lcm(7, 0) = 0`. Verify `gcd(a,b) * lcm(a,b) == a*b` for non-zero inputs.

**Evaluation criteria.**
- Divides before multiplying.
- `lcm(_, 0) = 0` handled.
- Satisfies `gcd * lcm == a * b` on random non-zero pairs.

---

### Task 3 — Coprimality test

**Problem.** Given `a` and `b`, print `YES` if they are coprime (`gcd(a, b) == 1`) and `NO` otherwise.

**Input / Output spec.**
- Read `a`, `b`. Print `YES` or `NO`.

**Constraints.** `1 ≤ a, b ≤ 10^18`.

**Hint.** Coprime means `gcd == 1`. This is also the existence test for a modular inverse of `a` mod `b`.

**Worked check.** `coprime(17, 5) = YES`, `coprime(48, 18) = NO` (gcd 6), `coprime(1, 999) = YES`.

**Evaluation criteria.**
- Correct for the worked cases.
- `O(log)` per query.

---

### Task 4 — GCD of an array

**Problem.** Given `n` positive integers, output the GCD of all of them. Fold the pairwise GCD and exit early once the running GCD hits `1`.

**Input / Output spec.**
- Read `n`, then `n` integers. Print their GCD.

**Constraints.** `1 ≤ n ≤ 10^5`, `1 ≤ a_i ≤ 10^9`.

**Hint.** Start the accumulator at `0` (since `gcd(0, x) = x`). Break as soon as the running GCD equals `1` — it can never decrease further.

**Evaluation criteria.**
- `gcd([12, 18, 24]) = 6`, `gcd([7, 13, 1]) = 1`.
- Early exit on `1` implemented.
- `O(n log max)`.

---

### Task 5 — Reduce a fraction

**Problem.** Given a fraction `a/b` (`b != 0`, possibly negative), output it in lowest terms with a positive denominator.

**Input / Output spec.**
- Read `a`, `b`. Print the reduced numerator and denominator.

**Constraints.** `-10^18 ≤ a, b ≤ 10^18`, `b != 0`.

**Hint.** `g = gcd(|a|, |b|)`; divide both by `g`; if the denominator came out negative, flip both signs so the denominator is positive.

**Worked check.** `48 / -18 → -8 / 3`, `6 / 4 → 3 / 2`, `0 / 5 → 0 / 1`.

**Starter — Go.**
```go
package main

import "fmt"

func gcd(a, b int64) int64 {
	if a < 0 {
		a = -a
	}
	if b < 0 {
		b = -b
	}
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func reduceFraction(a, b int64) (int64, int64) {
	// TODO: divide by gcd, then make denominator positive
	return a, b
}

func main() {
	var a, b int64
	fmt.Scan(&a, &b)
	p, q := reduceFraction(a, b)
	fmt.Println(p, q)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task5 {
    static long gcd(long a, long b) {
        a = Math.abs(a); b = Math.abs(b);
        while (b != 0) { long t = a % b; a = b; b = t; }
        return a;
    }

    static long[] reduce(long a, long b) {
        // TODO: divide by gcd, then make denominator positive
        return new long[]{a, b};
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong();
        long[] r = reduce(a, b);
        System.out.println(r[0] + " " + r[1]);
    }
}
```

**Starter — Python.**
```python
import sys
from math import gcd


def reduce_fraction(a, b):
    # TODO: divide by gcd, then make denominator positive
    return a, b


def main():
    a, b = map(int, sys.stdin.read().split())
    p, q = reduce_fraction(a, b)
    print(p, q)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Denominator always positive.
- `0 / b` reduces to `0 / 1`.
- Reduced fraction equals the original value.

---

## Intermediate Tasks (5)

### Task 6 — Binary GCD (Stein's algorithm)

**Problem.** Implement `binaryGCD(a, b)` using only shifts, subtraction, and comparison — no division or modulo. Pull out the common power of two, then loop on odd values.

**Constraints.** `0 ≤ a, b ≤ 10^18`.

**Hint.** (1) If both even, `gcd = 2·gcd(a/2, b/2)` — track the shift. (2) Strip lone factors of two. (3) For two odds with `a ≤ b`, replace `b` with `(b − a)` (even, then stripped). Use a count-trailing-zeros intrinsic if available.

**Reference oracle.** Compare against the standard-library `gcd` for thousands of random pairs.

**Evaluation criteria.**
- No `%` or `/` (except by powers of two via shifts) in the core loop.
- Matches the standard `gcd` on random inputs including zeros.
- `O(log² max)` bit operations / `O(log)` machine-word operations.

---

### Task 7 — LCM of an array modulo p

**Problem.** Given `n` positive integers, output the LCM of all of them modulo `10^9 + 7`. The exact LCM may be astronomically large, so do **not** fold with division under the modulus.

**Constraints.** `1 ≤ n ≤ 10^5`, `1 ≤ a_i ≤ 10^6`.

**Hint.** Factorize each `a_i` (a smallest-prime-factor sieve up to `10^6` makes this fast). Track the **maximum exponent** of each prime across all numbers. The answer is `∏ prime^maxexp mod p` via modular exponentiation.

**Reference oracle (Python).**
```python
from math import gcd
from functools import reduce

def lcm_array_exact(nums):           # big-int exact LCM for small inputs
    return reduce(lambda x, y: x // gcd(x, y) * y, nums, 1)
# compare (lcm_array_exact(nums) % (10**9 + 7)) against your modular answer
```

**Evaluation criteria.**
- Matches `lcm_array_exact(nums) % p` for small inputs.
- Uses max prime exponents, not division under the modulus.
- `O(n log max + (max) log log max)` for the sieve.

---

### Task 8 — Extended Euclidean and modular inverse

**Problem.** Implement `extGcd(a, b)` returning `(g, x, y)` with `a·x + b·y = g = gcd(a, b)`, and use it to implement `modInverse(a, m)` returning the inverse of `a` modulo `m`, or `-1` if `gcd(a, m) != 1`.

**Constraints.** `1 ≤ a < m ≤ 10^9`.

**Hint.** Recursive: base `extGcd(a, 0) = (a, 1, 0)`; from `extGcd(b, a%b) = (g, x', y')`, return `(g, y', x' − (a/b)·y')`. The inverse is `((x % m) + m) % m` when `g == 1`.

**Reference oracle (Python).**
```python
from math import gcd

def ext_gcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = ext_gcd(b, a % b)
    return g, y1, x1 - (a // b) * y1

def mod_inverse(a, m):
    g, x, _ = ext_gcd(a % m, m)
    return -1 if g != 1 else (x % m + m) % m
# assert a*x + b*y == g for random (a,b); for prime m, mod_inverse(a,m)==pow(a,m-2,m)
```

**Evaluation criteria.**
- `extGcd` satisfies the Bezout identity `a·x + b·y == g` for random `(a, b)`.
- `modInverse(3, 11) = 4`, `modInverse(6, 9) = -1` (no inverse).
- Matches Fermat's inverse `pow(a, m-2, m)` for prime moduli.

---

### Task 9 — Solve a linear Diophantine equation

**Problem.** Given `a`, `b`, `c`, find integers `x`, `y` with `a·x + b·y = c`, or report that none exist. Use the extended Euclidean algorithm.

**Constraints.** `1 ≤ a, b ≤ 10^9`, `-10^18 ≤ c ≤ 10^18`.

**Hint.** A solution exists iff `gcd(a, b)` divides `c`. Find `(x₀, y₀)` with `a·x₀ + b·y₀ = g` via extended GCD, then scale by `c/g`: `x = x₀·(c/g)`, `y = y₀·(c/g)`. (The general solution adds `t·(b/g)` to `x` and subtracts `t·(a/g)` from `y`.)

**Evaluation criteria.**
- Reports "no solution" exactly when `gcd(a, b) ∤ c`.
- Returned `(x, y)` satisfies `a·x + b·y == c`.
- Handles `c = 0` (the trivial `x = y = 0`).

---

### Task 10 — Fibonacci worst-case step counter

**Problem.** Write `gcdSteps(a, b)` that returns the number of division steps the Euclidean algorithm performs. Then, for a given `n`, compute the steps for `(F(n+1), F(n))` and confirm it is the worst case for inputs of that magnitude.

**Constraints.** `1 ≤ n ≤ 80` (Fibonacci numbers fit in 64-bit up to `F(92)`).

**Hint.** Increment a counter each loop iteration. For consecutive Fibonacci numbers every quotient is `1`, so `gcdSteps(F(n+1), F(n)) = n` (peeling one Fibonacci index per step). Compare against random same-magnitude pairs — none should exceed the Fibonacci count.

**Worked check.** `gcdSteps(34, 21) = 7` (that is `F(9), F(8)`); no pair below `34` needs more than 7 steps.

**Evaluation criteria.**
- Step count for Fibonacci pairs equals `n`.
- No random pair of similar magnitude exceeds the Fibonacci step count (Lamé's theorem).
- Counter matches a manual trace on `(48, 18)` (3 steps).

---

## Advanced Tasks (5)

### Task 11 — Range GCD queries (sparse table)

**Problem.** Given a static array of `n` integers and `q` queries `(l, r)`, answer `gcd(a_l, …, a_r)` for each. Precompute a sparse table for `O(1)` queries after `O(n log n)` build (GCD is idempotent: `gcd(x, x) = x`, so overlapping ranges are fine).

**Constraints.** `1 ≤ n, q ≤ 2·10^5`, `1 ≤ a_i ≤ 10^9`.

**Hint.** Sparse table `sp[k][i] = gcd` of the block of length `2^k` starting at `i`. A query `(l, r)` takes `k = floor(log2(r - l + 1))` and returns `gcd(sp[k][l], sp[k][r - 2^k + 1])`. Overlap is harmless because GCD is idempotent (unlike sum).

**Evaluation criteria.**
- Build `O(n log n)`, query `O(1)`.
- Matches a brute `gcd` over each range for small inputs.
- Correct use of idempotency (no double-count concern).

---

### Task 12 — Overflow-checked LCM

**Problem.** Implement `lcmChecked(a, b)` that returns the LCM and a boolean flag, where the flag is `false` if the true LCM overflows the unsigned 64-bit range (instead of silently wrapping).

**Constraints.** `0 ≤ a, b < 2^64`.

**Hint.** Compute `g = gcd(a, b)`, `q = a / g`, `res = q * b`. Detect multiplication overflow by checking `b != 0 && res / b != q`. Return `(res, true)` only if no overflow.

**Reference oracle (Python).**
```python
from math import gcd

def lcm_checked(a, b):
    if a == 0 or b == 0:
        return 0, True
    res = a // gcd(a, b) * b
    return res, res < (1 << 64)   # Python ints are unbounded; emulate the check
```

**Evaluation criteria.**
- Detects overflow for pairs whose true LCM exceeds `2^64 − 1`.
- Returns the correct LCM with `true` when it fits.
- No silent wraparound.

---

### Task 13 — Constant-iteration GCD analysis

**Problem.** Empirically measure the iteration count of the Euclidean algorithm across many random pairs and confirm the `~1.44 log₂ N` worst-case bound (Lamé). Report the maximum, mean, and the Fibonacci-pair count for several magnitudes.

**Constraints.** Sample at least `10^6` random pairs per magnitude bucket.

**Hint.** Bucket inputs by magnitude (`10^3`, `10^6`, `10^9`, `10^18`). For each bucket, track max/mean steps over random pairs and compare the max to `gcdSteps(F(n+1), F(n))` for the largest Fibonacci pair under the bucket cap. The Fibonacci pair should be the maximum.

**Evaluation criteria.**
- Max observed steps ≤ `1.45 · log₂ N` for each bucket.
- The Fibonacci pair attains (or matches) the bucket maximum.
- Mean step count is well below the worst case (typical inputs are fast).

---

### Task 14 — GCD over a sliding window

**Problem.** Given an array and a window size `w`, output the GCD of every contiguous window of length `w`. Because GCD has no inverse (you cannot "remove" the element leaving the window), use a two-stack deque trick or a segment tree, not a naive recompute.

**Constraints.** `1 ≤ w ≤ n ≤ 2·10^5`, `1 ≤ a_i ≤ 10^9`.

**Hint.** The two-stack method maintains a "back" stack with suffix GCDs and a "front" stack with prefix GCDs; the window GCD is `gcd(front_top, back_top)`. When the front empties, transfer the back stack. Amortized `O(1)` per window. Alternatively, a segment tree gives `O(log n)` range GCD.

**Evaluation criteria.**
- Matches a brute `gcd` over each window for small inputs.
- Amortized `O(n)` (two-stack) or `O(n log n)` (segment tree) total — not `O(n·w)`.
- Handles `w = 1` (each window GCD is the element itself).

---

### Task 15 — Decide the right GCD variant

**Problem.** Implement `classify(context)` (or write a short analysis) that, given a context `(input_type, operand_secrecy, operation)`, returns one of: `EUCLIDEAN`, `BINARY_GCD`, `LEHMER_BIGINT`, `CONSTANT_TIME`, or `PRIME_EXPONENT_LCM`. Justify each.

**Constraints / cases to handle.**
- Machine-int GCD, public data → `EUCLIDEAN`.
- Big-integer GCD, division expensive → `BINARY_GCD` (or `LEHMER_BIGINT` for very large).
- Modular inverse of **secret** key material → `CONSTANT_TIME`.
- LCM of a large array modulo `p` → `PRIME_EXPONENT_LCM`.
- Very large (`n`-bit) integer GCD → `LEHMER_BIGINT`.

**Hint.** Encode the decision rules from `senior.md`. The trap is the secret-operand case: a variable-time GCD leaks bits via timing, so it must be constant-time.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `CONSTANT_TIME` branch explicitly cites the timing-leak risk for secret operands.
- The `PRIME_EXPONENT_LCM` branch notes that division under a modulus is invalid.

---

## Benchmark Task

### Task B — Euclidean vs Binary GCD crossover

**Problem.** Empirically compare the mod-based Euclidean algorithm against the (ctz-optimized) binary GCD across input magnitudes and integer widths. Implement three workloads on a fixed-seed set of random pairs:

- **(a) Euclidean (mod):** the standard loop, `O(log)` divisions.
- **(b) Binary GCD (shifts):** Stein's algorithm with count-trailing-zeros.
- **(c) Big-integer GCD:** both variants on `512`-bit operands.

Measure wall-clock time for each on machine-int pairs (up to `10^18`) and on big-integer pairs. Report a table and identify where each wins.

**Starter — Python.**
```python
import random
import time
from math import gcd as stdlib_gcd


def euclid(a, b):
    while b:
        a, b = b, a % b
    return a


def binary_gcd(a, b):
    if a == 0:
        return b
    if b == 0:
        return a
    shift = ((a | b) & -(a | b)).bit_length() - 1
    a >>= (a & -a).bit_length() - 1
    while b:
        b >>= (b & -b).bit_length() - 1
        if a > b:
            a, b = b, a
        b -= a
    return a << shift


def gen_pairs(n, bits, seed):
    r = random.Random(seed)
    hi = 1 << bits
    return [(r.randrange(1, hi), r.randrange(1, hi)) for _ in range(n)]


def bench(fn, pairs):
    start = time.perf_counter()
    for a, b in pairs:
        fn(a, b)
    return (time.perf_counter() - start) * 1000.0


def main():
    for bits in (62, 512):
        pairs = gen_pairs(50_000, bits, 42)
        e = bench(euclid, pairs)
        b = bench(binary_gcd, pairs)
        s = bench(stdlib_gcd, pairs)
        print(f"{bits}-bit: euclid={e:.1f}ms  binary={b:.1f}ms  stdlib={s:.1f}ms")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same pairs across Go, Java, and Python.
- On machine integers, Euclidean is competitive with or faster than binary GCD; on big integers, binary GCD's division-avoidance shows (and the standard library, using Lehmer/half-GCD, beats both).
- Report includes the mean across at least 3 runs and excludes pair-generation time.
- Writeup: a short note on where binary GCD wins (division-poor / big-integer) and where it does not (machine words with fast hardware division).

---

## General Guidance for All Tasks

- **Always validate against a trusted reference first.** The standard library's `gcd`, or a slow list-all-divisors GCD, is the oracle. Run it on small inputs, diff, then trust your version on large ones.
- **Pin constants as named values.** Use `MOD = 10^9 + 7`; never inline magic numbers.
- **Get the zero conventions right.** `gcd(a, 0) = a`, `gcd(0, 0) = 0`, `lcm(_, 0) = 0`. These are conventions, not errors — document them.
- **Divide before multiplying in LCM.** `a / gcd * b`, never `a * b / gcd`. The product overflows; the divide-first form does not.
- **Mind signs.** In Go/Java, `%` of a negative is negative; `abs` the inputs or the result. Push the sign onto a fraction's numerator with a positive denominator.
- **Never use plain subtractive GCD.** It is `O(max)` in the worst case; use mod-based or binary GCD.
- **Array LCM modulo p uses max prime exponents.** You cannot divide by a GCD under a modulus.
- **Reuse the `gcd` / `lcm` pair.** Most bugs live in sign and overflow handling; write the core once, test it hard, and build the rest on top.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.