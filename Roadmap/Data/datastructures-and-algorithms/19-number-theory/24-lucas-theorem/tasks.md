# Lucas' Theorem — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Each task ships with a precise spec and (for the first in each tier) starter code in all three languages.
> **Always test against a brute-force oracle on small inputs** — use Pascal's triangle mod `p` to validate every fast Lucas implementation before trusting it on huge `n`.

---

## Beginner Tasks (5)

### Task 1 — Base-`p` digit decomposition

**Problem.** Write `digits(x, p)` returning the base-`p` digits of `x` (least-significant first). This is the core primitive for Lucas.

**Input / Output spec.** Read integers `x` and `p`; print the digits low→high, space-separated. For `x = 0` print `0`.

**Constraints.** `0 ≤ x ≤ 10^18`, `2 ≤ p ≤ 10^9`.

**Hint.** Loop `while x > 0`: append `x % p`, then `x //= p`.

**Starter — Go.**
```go
package main

import "fmt"

func digits(x, p int64) []int64 {
	// TODO: return base-p digits, least significant first
	return nil
}

func main() {
	var x, p int64
	fmt.Scan(&x, &p)
	fmt.Println(digits(x, p)) // e.g. 13 3 -> [1 1 1]
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static List<Long> digits(long x, long p) {
        // TODO: return base-p digits, least significant first
        return new ArrayList<>();
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(digits(sc.nextLong(), sc.nextLong()));
    }
}
```

**Starter — Python.**
```python
def digits(x, p):
    # TODO: return base-p digits, least significant first
    return []

if __name__ == "__main__":
    x, p = map(int, input().split())
    print(digits(x, p))  # e.g. 13 3 -> [1, 1, 1]
```

- **Expected Output:** `13 3` → `1 1 1`; `4 3` → `1 1`; `0 5` → `0`.
- **Evaluation:** correctness for `x = 0`, single-digit `x < p`, and large `x`.

### Task 2 — Small binomial mod `p` from a factorial table

**Problem.** Build `fact`/`invFact` of size `p` and implement `smallC(a, b, p)` for `0 ≤ a, b < p` returning `C(a, b) mod p` in `O(1)`. Return `0` if `b > a`.
- Constraints: `p` prime, `2 ≤ p ≤ 10^6`. Build `invFact` with one Fermat inverse + backward recurrence.

### Task 3 — Full Lucas query

**Problem.** Implement `lucas(n, k, p)` returning `C(n, k) mod p` for prime `p` and `0 ≤ k ≤ n ≤ 10^18`. Use the digit loop with the short-circuit.
- Constraints: build the table once; per-query `O(log_p n)`. Return `0` for `k > n`.

### Task 4 — `C(n, k) mod 2` via bitmask

**Problem.** Implement `binomMod2(n, k)` returning `1` if `C(n, k)` is odd, else `0`, using only `(k & n) == k`. No table.
- Constraints: `0 ≤ k ≤ n ≤ 10^18`. Verify against `lucas(n, k, 2)` from Task 3.

### Task 5 — Validate Lucas against Pascal's triangle

**Problem.** Write a test that, for all `0 ≤ k ≤ n ≤ 40` and primes `p ∈ {2, 3, 5, 7, 11}`, asserts `lucas(n, k, p) == pascal(n, k, p)`, where `pascal` builds the triangle mod `p`.
- Constraints: the test must fail loudly on any mismatch. This is your safety net for every later task.

---

## Intermediate Tasks (5)

### Task 6 — Many queries, one table

**Problem.** Read a prime `p` and `Q` queries `(n, k)`; answer each `C(n, k) mod p`. Build the table once; total cost `O(p + Q log_p n)`.
- Provide starter code in all 3 languages.
- Constraints: `2 ≤ p ≤ 10^5`, `Q ≤ 10^6`, `n ≤ 10^18`. Use fast I/O.

**Starter — Python.**
```python
import sys

def build(p):
    # TODO: fact, inv_fact of size p
    ...

def lucas(n, k, p, fact, inv_fact):
    # TODO: digit loop with short-circuit
    ...

def main():
    data = sys.stdin.read().split()
    # TODO: parse p, Q, then Q pairs; print each lucas result
    ...

if __name__ == "__main__":
    main()
```

### Task 7 — Lucas + CRT for a square-free modulus

**Problem.** Given distinct primes `p_1, …, p_r` and a query `(n, k)`, compute `C(n, k) mod (p_1·…·p_r)` by running Lucas per prime and combining with CRT.
- Constraints: primes distinct, product fits in 64-bit. Verify against Python `math.comb(n, k) % M` for small `n`.

### Task 8 — Count nonzero binomials in row `n` mod `p`

**Problem.** Given `n` and prime `p`, output how many `k ∈ [0, n]` have `C(n, k) ≢ 0 (mod p)`. Use the formula `∏_i (n_i + 1)` over base-`p` digits.
- Constraints: `n ≤ 10^18`. For `p = 2` this is `2^(popcount(n))`; check both ways.

### Task 9 — `p`-adic valuation via Kummer

**Problem.** Implement `vp(n, k, p)` returning `v_p(C(n, k))` = the number of carries when adding `k` and `n−k` in base `p`. Equivalently `(s_p(k) + s_p(n−k) − s_p(n)) / (p−1)`.
- Constraints: `n ≤ 10^18`. Cross-check: `vp(n,k,p) == 0` iff `lucas(n,k,p) != 0`.

### Task 10 — Largest prime under a memory budget

**Problem.** Given a memory budget `B` bytes and huge `n`, choose the largest prime `p` whose size-`p` `fact`+`invFact` tables (`2p` int64 = `16p` bytes) fit in `B`, then report the resulting digit count `⌊log_p n⌋ + 1`.
- Constraints: demonstrate the trade-off — print `(p, digits)` for a few budgets and observe digit count shrinking as `p` grows.

---

## Advanced Tasks (5)

### Task 11 — `C(n, k) mod p^e` (Granville / Andrew)

**Problem.** Implement `binomPrimePower(n, k, p, e)` returning `C(n, k) mod p^e` using Andrew's factorial `(m!)_p` and Kummer's valuation `μ`. Return `0` when `μ ≥ e`.
- Provide starter code in all 3 languages.
- Constraints: `p^e ≤ 10^6`, `n ≤ 10^18`. Validate against `math.comb(n, k) % (p**e)` for `n ≤ 200`.

**Starter — Python.**
```python
def binom_prime_power(n, k, p, e):
    pe = p ** e
    if k < 0 or k > n:
        return 0
    # TODO: precompute g[r] = (r!)_p mod p^e
    # TODO: mu = v_p(n!) - v_p(k!) - v_p((n-k)!)
    # TODO: if mu >= e: return 0
    # TODO: assemble p^mu * andrew_fact(n) / (andrew_fact(k)*andrew_fact(n-k)) mod p^e
    ...
```

### Task 12 — General composite modulus

**Problem.** Compute `C(n, k) mod M` for an arbitrary `M`: factor `M = ∏ q_j^{e_j}`, use Lucas for `e_j = 1` and Granville for `e_j ≥ 2`, then CRT-combine.
- Constraints: `M ≤ 10^12`, `n ≤ 10^18`. Validate against `math.comb(n, k) % M` for `n ≤ 100`.

### Task 13 — Lattice paths mod a small prime

**Problem.** Count monotone lattice paths from `(0,0)` to `(a, b)` modulo prime `p` — the answer is `C(a+b, a) mod p`. Handle `a, b` up to `10^18`.
- Constraints: reuse `lucas`. Add a variant counting paths that stay weakly below the diagonal (Catalan-style) via `C(a+b,a) − C(a+b,a+1)` mod `p` — cross-link sibling `25-catalan-numbers`.

### Task 14 — Stress test and oracle harness

**Problem.** Build a randomized harness: for random `(n, k)` up to `10^6` and random small primes, compare `lucas` and `binomPrimePower` against `math.comb(n, k) % m`. Report the first mismatch with full state.
- Constraints: run ≥ 10^5 random cases; the harness must be deterministic given a seed.

### Task 15 — Benchmark Lucas vs factorial table

**Problem.** For a fixed small prime `p` and varying `n`, benchmark per-query Lucas time and confirm logarithmic growth; then compare with the `O(n)`-setup factorial table for the regime where both are feasible, showing the crossover.
- Provide starter code in all 3 languages (see Benchmark Task below).

---

## Benchmark Task

> Compare per-query Lucas latency as `n` grows (table prebuilt). Expect logarithmic growth in `n`.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func main() {
	const p = int64(1009)
	l := NewLucas(p) // from interview.md / junior.md
	ns := []int64{1e6, 1e9, 1e12, 1e15, 1e18}
	for _, n := range ns {
		start := time.Now()
		for i := 0; i < 1_000_000; i++ {
			_ = l.C(n, n/2)
		}
		fmt.Printf("n=%-20d %.4f us/query\n", n, float64(time.Since(start).Microseconds())/1e6)
	}
}
```

#### Java

```java
public class Benchmark {
    public static void main(String[] args) {
        build(1009); // from interview.md Solution
        long[] ns = {1_000_000L, 1_000_000_000L, 1_000_000_000_000L,
                     1_000_000_000_000_000L, 1_000_000_000_000_000_000L};
        for (long n : ns) {
            long start = System.nanoTime();
            for (int i = 0; i < 1_000_000; i++) binom(n, n / 2);
            double us = (System.nanoTime() - start) / 1_000_000.0 / 1000.0;
            System.out.printf("n=%-20d %.4f us/query%n", n, us);
        }
    }
}
```

#### Python

```python
import timeit

p = 1009
fact, inv_fact = build(p)  # from interview.md
for n in [10**6, 10**9, 10**12, 10**15, 10**18]:
    t = timeit.timeit(lambda: lucas(n, n // 2, p, fact, inv_fact), number=100_000)
    print(f"n={n:<20} {t/100_000*1e6:.4f} us/query")
```
