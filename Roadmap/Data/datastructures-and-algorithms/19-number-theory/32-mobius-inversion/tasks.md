# Möbius Function & Möbius Inversion — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**. Validate every fast routine against a brute-force oracle on small inputs before trusting it on large ones.

## Beginner Tasks

**Task 1: Single Möbius value.** Implement `mobius(n)` returning `μ(n)` by trial division in `O(√n)`. Return `0` on a repeated prime factor, else `(-1)^{#distinct primes}`.

#### Go

```go
package main

import "fmt"

func mobius(n int) int {
	// implement here
	return 0
}

func main() {
	fmt.Println(mobius(1), mobius(6), mobius(12), mobius(30)) // 1 1 0 -1
}
```

#### Java

```java
public class Task1 {
    static int mobius(int n) {
        // implement here
        return 0;
    }

    public static void main(String[] args) {
        System.out.println(mobius(1) + " " + mobius(6) + " " + mobius(12) + " " + mobius(30));
        // 1 1 0 -1
    }
}
```

#### Python

```python
def mobius(n):
    # implement here
    return 0

if __name__ == "__main__":
    print(mobius(1), mobius(6), mobius(12), mobius(30))  # 1 1 0 -1
```

- **Constraints:** `1 ≤ n ≤ 10^{12}`; `O(√n)` per call.
- **Expected Output:** `1 1 0 -1`.
- **Evaluation:** correctness on primes, prime powers, squarefree composites, and `n=1`.

**Task 2: Sieve `μ(1..n)`.** Implement a sieve (Eratosthenes-style or linear) returning the array `μ(0..n)`. Print `μ(1..12)`.
- Provide starter code in all 3 languages.
- Constraints: `n ≤ 10^7`; aim for `O(n)` (linear sieve) or `O(n log log n)`.
- Expected `μ(1..12)`: `[1, -1, -1, 0, -1, 1, -1, 0, 0, 1, -1, 0]`.

**Task 3: Verify the killer identity.** Using your sieve, verify `Σ_{d|n} μ(d) = [n=1]` for all `n ≤ 1000`. Print "ok" if all pass.
- Constraints: brute-force divisor loop per `n` is fine here.
- Evaluation: must assert exactly `1` at `n=1` and `0` elsewhere.

**Task 4: Squarefree check via `μ`.** Implement `is_squarefree(n)` two ways — (a) directly from factorization, (b) as `μ(n) != 0` — and assert they agree for `n ≤ 10^5`.
- Constraints: `O(√n)` for the single-value version.
- Expected: `is_squarefree(30)=true`, `is_squarefree(12)=false`.

**Task 5: Coprime count = totient.** Implement `coprime_count(n) = Σ_{d|n} μ(d)⌊n/d⌋` and assert it equals `φ(n)` (computed independently) for `n ≤ 10^4`.
- Constraints: enumerate divisors in `O(√n)`.
- Expected: `coprime_count(30) = 8`.

## Intermediate Tasks

**Task 6: Möbius inversion round-trip.** Given any function `f`, compute `g(n) = Σ_{d|n} f(d)` (forward) and `f'(n) = Σ_{d|n} μ(n/d) g(d)` (backward). Assert `f'(n) == f(n)` for `n ≤ 1000` with `f(n) = n`, `f(n) = n²`, and a random `f`. Provide starter code in all 3 languages.
- Constraints: divisor enumeration per `n`.
- Evaluation: round-trip must hold for arbitrary `f`.

**Task 7: Recover `φ` by inversion.** Using `Σ_{d|n} φ(d) = n`, compute `φ(n) = Σ_{d|n} μ(n/d)·d` and compare against a totient sieve for `n ≤ 10^5`.
- Constraints: `O(d(n))` per value.
- Expected: matches `φ` exactly.

**Task 8: Coprime pairs up to `n`.** Compute `Σ_{d=1}^{n} μ(d)⌊n/d⌋²` (ordered coprime pairs in `{1..n}²`). Cross-check against an `O(n²)` gcd double loop for `n ≤ 2000`.
- Constraints: sieve `μ` once; `O(n)` for the sum.
- Expected: `n=6 → 23`, `n=10 → 63`, `n=1000 → 608383`.

**Task 9: GCD-sum.** Compute `Σ_{i=1}^{n} Σ_{j=1}^{n} gcd(i,j) = Σ_{d=1}^{n} φ(d)⌊n/d⌋²`. Cross-check against brute force for `n ≤ 1000`.
- Constraints: sieve `φ` once.
- Expected: `n=6 → 61`.

**Task 10: Pairs with a given gcd.** For a fixed `n`, output an array `cnt[g]` = number of pairs `(a,b) ≤ n` with `gcd(a,b)=g`, for all `g`, using `cnt[g] = Σ_d μ(d)⌊n/(gd)⌋²`. Assert `Σ_g cnt[g] = n²`.
- Constraints: total `O(n log n)` via the harmonic bound.
- Expected: the entries sum to `n²`.

## Advanced Tasks

**Task 11: Divisor-blocked coprime pairs.** Reimplement Task 8 with **divisor blocking** over a precomputed Mertens prefix-sum array `M`: walk blocks `l→q→r`, accumulate `q²·(M[r]−M[l−1])`. Achieve `O(√n)` per query after the sieve. Provide starter code in all 3 languages.
- Constraints: `n ≤ 10^7`; use 64-bit accumulators.
- Evaluation: identical results to Task 8, far fewer iterations.

**Task 12: Sublinear Mertens.** Implement `M(x) = 1 − Σ_{i≥2} M(⌊x/i⌋)` with divisor blocking, sieving small `μ` up to `T ≈ x^{2/3}` and memoizing large arguments. Compute `M(10^9)`.
- Constraints: `O(x^{2/3})`; memo keyed by argument value.
- Expected: `M(10^6) = 212`, `M(10^9) = -222`.

**Task 13: Coprime pairs at `n = 10^9`.** Combine Task 11 and Task 12: answer "coprime pairs ≤ n" for `n` up to `10^9` using divisor blocking with sublinear Mertens. Guard `q²` overflow with 64-bit.
- Constraints: `O(n^{2/3})` per query.
- Evaluation: matches Task 8 on overlapping small `n`.

**Task 14: Squarefree count ≤ n.** Compute `#squarefree ≤ n = Σ_{d=1}^{⌊√n⌋} μ(d)⌊n/d²⌋`. Cross-check against a direct count for `n ≤ 10^6`.
- Constraints: `O(√n)` after sieving `μ(1..√n)`.
- Expected: density `→ 6/π² ≈ 0.6079`; e.g. `n=100 → 61`.

**Task 15: Coprime triples.** Compute the number of ordered triples `(a,b,c) ≤ n` with `gcd(a,b,c)=1` via `Σ_d μ(d)⌊n/d⌋³`. Use 128-bit / big integers to avoid overflow.
- Constraints: `n ≤ 10^6`; reason about the magnitude `n³`.
- Evaluation: cross-check against brute force for `n ≤ 200`.

## Benchmark Task

> Compare performance across all 3 languages: sieve `μ(1..n)` and compute the coprime-pair count.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func coprimePairs(n int) int64 {
	mu := make([]int8, n+1)
	comp := make([]bool, n+1)
	var primes []int
	if n >= 1 {
		mu[1] = 1
	}
	for i := 2; i <= n; i++ {
		if !comp[i] {
			primes = append(primes, i)
			mu[i] = -1
		}
		for _, p := range primes {
			if i*p > n {
				break
			}
			comp[i*p] = true
			if i%p == 0 {
				mu[i*p] = 0
				break
			}
			mu[i*p] = -mu[i]
		}
	}
	var total int64
	for d := 1; d <= n; d++ {
		q := int64(n / d)
		total += int64(mu[d]) * q * q
	}
	return total
}

func main() {
	for _, n := range []int{1000, 10000, 100000, 1000000, 10000000} {
		start := time.Now()
		res := coprimePairs(n)
		fmt.Printf("n=%8d: %12d  %.3f ms\n", n, res, float64(time.Since(start).Microseconds())/1000.0)
	}
}
```

#### Java

```java
import java.util.ArrayList;
import java.util.List;

public class Benchmark {
    static long coprimePairs(int n) {
        byte[] mu = new byte[n + 1];
        boolean[] comp = new boolean[n + 1];
        List<Integer> primes = new ArrayList<>();
        if (n >= 1) mu[1] = 1;
        for (int i = 2; i <= n; i++) {
            if (!comp[i]) { primes.add(i); mu[i] = -1; }
            for (int p : primes) {
                if ((long) i * p > n) break;
                comp[i * p] = true;
                if (i % p == 0) { mu[i * p] = 0; break; }
                mu[i * p] = (byte) (-mu[i]);
            }
        }
        long total = 0;
        for (int d = 1; d <= n; d++) {
            long q = n / d;
            total += (long) mu[d] * q * q;
        }
        return total;
    }

    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000, 1000000, 10000000};
        for (int n : sizes) {
            long start = System.nanoTime();
            long res = coprimePairs(n);
            double ms = (System.nanoTime() - start) / 1_000_000.0;
            System.out.printf("n=%8d: %12d  %.3f ms%n", n, res, ms);
        }
    }
}
```

#### Python

```python
import time


def coprime_pairs(n):
    mu = [0] * (n + 1)
    comp = [False] * (n + 1)
    primes = []
    if n >= 1:
        mu[1] = 1
    for i in range(2, n + 1):
        if not comp[i]:
            primes.append(i)
            mu[i] = -1
        for p in primes:
            if i * p > n:
                break
            comp[i * p] = True
            if i % p == 0:
                mu[i * p] = 0
                break
            mu[i * p] = -mu[i]
    total = 0
    for d in range(1, n + 1):
        if mu[d]:
            q = n // d
            total += mu[d] * q * q
    return total


if __name__ == "__main__":
    for n in [1000, 10000, 100000, 1000000]:
        start = time.perf_counter()
        res = coprime_pairs(n)
        print(f"n={n:>8}: {res:>14}  {(time.perf_counter() - start) * 1000:.3f} ms")
```
