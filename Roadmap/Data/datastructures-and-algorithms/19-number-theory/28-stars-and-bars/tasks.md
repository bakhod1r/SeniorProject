# Stars and Bars — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Verify every answer against a brute-force enumerator for small inputs — the `k − 1` exponent and the inclusion–exclusion sign are the two bugs that hide from inspection.

---

## Beginner Tasks (5)

### Task 1 — Non-negative solution count

Implement `count(n, k)` returning the number of non-negative integer solutions of `x₁ + … + x_k = n`, i.e. `C(n + k − 1, k − 1)`, using a multiplicative loop (no factorials, no library `comb`).

#### Go

```go
package main

import "fmt"

func binom(m, r int64) int64 {
	// implement: C(m, r) via multiplicative loop, smaller index, exact division
	return 0
}

func count(n, k int64) int64 {
	// return binom(n+k-1, k-1)
	return 0
}

func main() {
	fmt.Println(count(5, 3)) // expected 21
}
```

#### Java

```java
public class Task1 {
    static long binom(long m, long r) {
        // implement
        return 0;
    }
    static long count(long n, long k) {
        // return binom(n+k-1, k-1)
        return 0;
    }
    public static void main(String[] args) {
        System.out.println(count(5, 3)); // expected 21
    }
}
```

#### Python

```python
def binom(m, r):
    # implement via multiplicative loop
    return 0

def count(n, k):
    return binom(n + k - 1, k - 1)

if __name__ == "__main__":
    print(count(5, 3))  # expected 21
```

- **Constraints:** `0 ≤ n ≤ 60`, `1 ≤ k ≤ 60`; result fits in 64-bit.
- **Expected Output:** `count(5, 3) = 21`, `count(0, 4) = 1`, `count(10, 1) = 1`.
- **Evaluation:** correct formula, exact division, smaller-index optimization.

### Task 2 — Positive solution count

Implement `countPositive(n, k)` returning the number of solutions with each `xᵢ ≥ 1`, i.e. `C(n − 1, k − 1)`, returning `0` when `n < k`.

- Provide starter code in all 3 languages (reuse `binom`).
- **Constraints:** `0 ≤ n ≤ 60`, `1 ≤ k ≤ 60`.
- **Expected Output:** `countPositive(5, 3) = 6`, `countPositive(2, 3) = 0`, `countPositive(7, 1) = 1`.
- **Evaluation:** correct `n ≥ k` guard.

### Task 3 — Lower-bound substitution

Implement `countWithLowerBounds(n, lows)` where `lows[i]` is the minimum value of `xᵢ`. Subtract `Σlows` from `n`, return `0` if negative, else the non-negative count over `len(lows)` boxes.

- Provide starter code in all 3 languages.
- **Constraints:** lower bounds may be `0`; `n ≤ 60`.
- **Expected Output:** `countWithLowerBounds(20, [2,5,0,1]) = C(15,3) = 455`; `countWithLowerBounds(3, [2,2]) = 0`.
- **Evaluation:** correct substitution and negative-`n` guard.

### Task 4 — Brute-force enumerator (oracle)

Write `bruteCount(n, k)` that recursively enumerates all non-negative tuples summing to `n` across `k` boxes and returns the count. This is your test oracle for Tasks 1–3.

- Provide starter code in all 3 languages.
- **Constraints:** `n ≤ 15`, `k ≤ 6` (exponential).
- **Expected Output:** `bruteCount(5, 3) = 21`; must equal `count(5, 3)` for all small `n, k`.
- **Evaluation:** matches the closed-form count on every small input.

### Task 5 — Inequality via slack variable

Implement `countAtMost(n, k)` returning the number of non-negative solutions of `x₁ + … + x_k ≤ n`. Add a slack box and return `C(n + k, k)`.

- Provide starter code in all 3 languages.
- **Constraints:** `n ≤ 60`, `k ≤ 60`.
- **Expected Output:** `countAtMost(3, 2) = C(5,2) = 10`; verify it equals `Σ_{m=0}^{n} count(m, k)`.
- **Evaluation:** correct slack-box reduction; cross-check against the summation identity.

---

## Intermediate Tasks (5)

### Task 6 — Uniform upper bound via inclusion–exclusion

Implement `countCapped(n, k, c)` returning the number of solutions with each `0 ≤ xᵢ ≤ c`, using the PIE sum `Σ_{t} (−1)^t C(k,t) C(n − t(c+1) + k − 1, k − 1)`. Break the loop once the inner top goes negative.

- Provide starter code in all 3 languages (reuse `binom`).
- **Constraints:** `n ≤ 60`, `k ≤ 12`, `c ≤ 60`.
- **Expected Output:** `countCapped(10, 3, 4) = 6`; `countCapped(5, 3, 5) = 21` (vacuous caps).
- **Evaluation:** correct signs, early break; cross-check against `bruteCount` with caps.

### Task 7 — Varied per-box caps (subset PIE)

Implement `countCappedVaried(n, caps)` using inclusion–exclusion over subsets of boxes: `Σ_S (−1)^{|S|} C(n − Σ_{i∈S}(caps[i]+1) + k − 1, k − 1)`. Skip subsets whose forced total exceeds `n`.

- Provide starter code in all 3 languages.
- **Constraints:** `n ≤ 40`, `k = len(caps) ≤ 16`.
- **Expected Output:** `countCappedVaried(10, [4,4,4]) = 6`; `countCappedVaried(7, [3,2,5]) = 9`.
- **Evaluation:** correct subset iteration and pruning; matches uniform PIE when caps are equal.

### Task 8 — Modular binomial pipeline

Build a `Comb` type that precomputes `fact[]` and `invFact[]` mod `1_000_000_007` (Fermat inverse, one exponentiation + backward pass), then answers `C(m, r) mod p` in `O(1)`. Use it to compute the non-negative count mod `p`.

- Provide starter code in all 3 languages.
- **Constraints:** precompute up to `N = 2·10^6`; up to `10^5` queries.
- **Expected Output:** `C(7,2) mod p = 21`; for large `n, k` (e.g. `n = 10^6, k = 10^6`) returns a residue in `O(1)` per query.
- **Evaluation:** single Fermat power, correct backward inverse-factorial recurrence, `O(1)` queries.

### Task 9 — Compositions and the `2^{n−1}` identity

Implement `compositions(n, k)` returning `C(n − 1, k − 1)` (compositions of `n` into exactly `k` positive parts) and verify `Σ_{k=1}^{n} compositions(n, k) == 2^(n−1)`.

- Provide starter code in all 3 languages.
- **Constraints:** `n ≤ 60`.
- **Expected Output:** `compositions(5, 3) = 6`; the sum over `k` equals `16 = 2^4` for `n = 5`.
- **Evaluation:** correct positive formula and verified identity.

### Task 10 — Monomial counting

Given degree `d` and number of variables `v`, return the number of distinct monomials of total degree exactly `d`, i.e. `C(d + v − 1, v − 1)`. Also return the number of monomials of degree **at most** `d` (`C(d + v, v)`).

- Provide starter code in all 3 languages.
- **Constraints:** `d ≤ 50`, `v ≤ 50`.
- **Expected Output:** exactly degree `2` in `3` variables → `C(4,2) = 6`; at most degree `2` in `3` variables → `C(5,3) = 10`.
- **Evaluation:** both counts correct; the "at most" version uses the slack-box reduction.

---

## Advanced Tasks (5)

### Task 11 — Mixed lower and upper bounds

Implement `countMixed(n, lows, caps)` where box `i` satisfies `lows[i] ≤ xᵢ ≤ caps[i]`. First substitute lower bounds (shrink `n`, shift each cap by `lows[i]`), then apply varied-cap PIE on the residual problem.

- Provide starter code in all 3 languages.
- **Constraints:** `n ≤ 60`, `k ≤ 16`, `lows[i] ≤ caps[i]`.
- **Expected Output:** `countMixed(50, [3,0,0,0], [20,20,20,20])` matches a brute-force check on a scaled-down instance.
- **Evaluation:** correct order (substitute then PIE), cap shifting, and pruning.

### Task 12 — Modular capped count (combine Tasks 6 and 8)

Implement `countCappedMod(n, k, c)` returning the uniform-cap count **mod `1_000_000_007`** using the precomputed factorial table. Guard against negative residues with `(total − term + MOD) % MOD`.

- Provide starter code in all 3 languages.
- **Constraints:** `n, k, c` up to `10^6`; table sized to `n + k`.
- **Expected Output:** `countCappedMod(10, 3, 4) = 6`; large inputs return a correct residue.
- **Evaluation:** no negative residues, early break, reuse of the `O(1)` binomial.

### Task 13 — Lucas' theorem for small primes

Implement `binomLucas(m, r, p)` computing `C(m, r) mod p` for a **prime `p` that may be smaller than `m`**, by multiplying digit-binomials over the base-`p` digits of `m` and `r`. Use it to compute a stars-and-bars count where `n` exceeds the modulus.

- Provide starter code in all 3 languages (cross-link sibling `24-lucas-theorem`).
- **Constraints:** `p` prime, `p ≤ 50`, `m` up to `10^9`.
- **Expected Output:** `binomLucas(10, 3, 7)` equals `C(10,3) mod 7 = 120 mod 7 = 1`.
- **Evaluation:** correct base-`p` digit extraction and product; matches a big-integer `C(m,r) % p`.

### Task 14 — Non-decreasing sequence count

Count strictly the number of **non-decreasing** sequences `1 ≤ a₁ ≤ a₂ ≤ … ≤ a_m ≤ k` (a multiset of size `m` from `k` values), which equals `C(m + k − 1, m)`. Verify by enumeration for small `m, k`.

- Provide starter code in all 3 languages.
- **Constraints:** `m ≤ 12`, `k ≤ 12`.
- **Expected Output:** `m = 2, k = 3` → `C(4,2) = 6`: `(1,1),(1,2),(1,3),(2,2),(2,3),(3,3)`.
- **Evaluation:** correct multiset reduction; matches the enumerated list.

### Task 15 — Anti-pattern detector

Write a function `classify(itemsDistinct, boxesDistinct, weighted)` that returns which counting tool applies: stars-and-bars `C(n+k−1, k−1)`, power `k^n` (distinct items), integer partitions (identical boxes), or generating-functions/DP (weighted bins). Then implement the correct count for each branch for given small parameters.

- Provide starter code in all 3 languages.
- **Constraints:** small parameters; for the partition branch use a DP `O(n·k)`.
- **Expected Output:** identical items + distinct boxes + unweighted → stars and bars; distinct items + distinct boxes → `k^n`; identical items + identical boxes → partition count `p(n, k)`.
- **Evaluation:** correct classification and correct count per branch (the senior-level recognition skill).

---

## Benchmark Task

> Compare performance of the factorial-precompute pipeline across all 3 languages: build `fact[]` mod `p` up to `N`, then answer many `C(m, r)` queries.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

const MOD = int64(1_000_000_007)

func main() {
	sizes := []int{100000, 500000, 1000000, 2000000}
	for _, N := range sizes {
		start := time.Now()
		fact := make([]int64, N+1)
		fact[0] = 1
		for i := 1; i <= N; i++ {
			fact[i] = fact[i-1] * int64(i) % MOD
		}
		_ = fact[N]
		fmt.Printf("N=%8d: %v\n", N, time.Since(start))
	}
}
```

#### Java

```java
public class Benchmark {
    static final long MOD = 1_000_000_007L;
    public static void main(String[] args) {
        int[] sizes = {100_000, 500_000, 1_000_000, 2_000_000};
        for (int N : sizes) {
            long start = System.nanoTime();
            long[] fact = new long[N + 1];
            fact[0] = 1;
            for (int i = 1; i <= N; i++) fact[i] = fact[i - 1] * i % MOD;
            long use = fact[N];
            System.out.printf("N=%8d: %.1f ms (last=%d)%n", N,
                (System.nanoTime() - start) / 1e6, use);
        }
    }
}
```

#### Python

```python
import timeit

MOD = 1_000_000_007

def build(N):
    fact = [1] * (N + 1)
    for i in range(1, N + 1):
        fact[i] = fact[i - 1] * i % MOD
    return fact

for N in [100_000, 500_000, 1_000_000, 2_000_000]:
    t = timeit.timeit(lambda: build(N), number=1)
    print(f"N={N:>8}: {t*1000:.1f} ms")
```

---

## Testing Guidance

- **Brute-force oracle:** recursive enumeration must match every closed-form count for `n ≤ 15`, `k ≤ 6`, with and without caps.
- **Symmetry check:** `binom(m, r) == binom(m, m − r)` for all small `m, r`.
- **PIE sign check:** the capped count must be non-negative and never exceed the uncapped count.
- **Vacuous-cap check:** `countCapped(n, k, c)` with `c ≥ n` must equal `count(n, k)`.
- **Identity check:** `Σ_{k} compositions(n, k) == 2^(n−1)`; `countAtMost(n, k) == Σ_{m≤n} count(m, k)`.
- **Modular cross-check:** `countCappedMod(...) == countCapped(...) % p` for small inputs.
- **Cross-language determinism:** Go, Java, and Python must produce identical output for shared inputs.
