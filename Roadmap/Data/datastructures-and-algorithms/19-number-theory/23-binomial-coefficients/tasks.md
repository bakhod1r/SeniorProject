# Binomial Coefficients C(n, k) — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Each task ships with a precise spec and starter code or a hint in all three languages.
> **Always test against an oracle on small inputs** — compare with `math.comb` (Python), a hand-built Pascal's triangle, or a known table before trusting your code on large inputs.

---

## Beginner Tasks (5)

### Task 1 — Pascal's triangle (full table)

**Problem.** Build Pascal's triangle for rows `0 … n` using only addition, where `tri[i][k] = C(i, k)`. Print row `n`.

**Input / Output.** Read `n`. Print the `n+1` numbers of row `n`, space-separated.

**Constraints.** `0 ≤ n ≤ 60` (so all values fit in 64-bit). Use the recurrence `C(i,k)=C(i−1,k−1)+C(i−1,k)`.

**Expected.** For `n = 5`: `1 5 10 10 5 1`.

**Starter — Go.**
```go
package main

import "fmt"

func pascal(n int) [][]int64 {
	// TODO: tri[i][0]=tri[i][i]=1; tri[i][k]=tri[i-1][k-1]+tri[i-1][k]
	return nil
}

func main() {
	var n int
	fmt.Scan(&n)
	fmt.Println(pascal(n)[n])
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long[][] pascal(int n) {
        // TODO
        return null;
    }
    public static void main(String[] args) {
        int n = new Scanner(System.in).nextInt();
        System.out.println(Arrays.toString(pascal(n)[n]));
    }
}
```

**Starter — Python.**
```python
def pascal(n):
    # TODO: build with addition only
    pass

if __name__ == "__main__":
    n = int(input())
    print(pascal(n)[n])
```

**Evaluation.** Correct values, addition only (no division), boundaries `C(i,0)=C(i,i)=1`.

---

### Task 2 — Single C(n, k) via multiplicative formula

**Problem.** Compute one exact `C(n, k)` (no modulus) in `O(min(k, n−k))`, multiplying before dividing so each step is integer-exact.

**Input / Output.** Read `n`, `k`. Print `C(n, k)`, or `0` if `k < 0` or `k > n`.

**Constraints.** `0 ≤ n ≤ 62`, `0 ≤ k ≤ n` (fits 64-bit). Use `k = min(k, n−k)`.

**Expected.** `C(10,3)=120`, `C(20,10)=184756`.

**Hint (all langs).** `r = 1; for i in 1..k: r = r * (n-k+i) / i` — multiply then divide.

**Evaluation.** Uses `min(k,n−k)`; integer-exact; handles out-of-range `k`.

---

### Task 3 — One-row Pascal in O(n) space

**Problem.** Return just row `n` of Pascal's triangle using a **single array** updated right-to-left.

**Input / Output.** Read `n`. Print row `n`.

**Constraints.** `0 ≤ n ≤ 60`. Update `row[k] += row[k-1]` iterating `k` from high to low.

**Expected.** `n=6` → `1 6 15 20 15 6 1`.

**Hint.** Right-to-left is required so `row[k-1]` is still the *old* value when read.

**Starter — Python.**
```python
def pascal_row(n):
    row = [1] * (n + 1)
    # TODO: for i in 1..n: for k in i-1..1 (descending): row[k] += row[k-1]
    return row
```

**Evaluation.** `O(n)` space; correct right-to-left update.

---

### Task 4 — Verify symmetry

**Problem.** For given `n`, verify `C(n, k) == C(n, n−k)` for all `0 ≤ k ≤ n`. Print `OK` if all hold, else the first failing `k`.

**Input / Output.** Read `n`. Print `OK` or the first `k` where it fails.

**Constraints.** `0 ≤ n ≤ 60`. Reuse Task 2's `choose`.

**Expected.** Always `OK` for valid `C` — the task is to confirm your `choose` respects symmetry.

**Evaluation.** Correct loop over all `k`; uses an exact `choose`.

---

### Task 5 — Row sum equals 2^n

**Problem.** Compute `∑_{k=0}^{n} C(n, k)` and confirm it equals `2ⁿ`.

**Input / Output.** Read `n`. Print the sum and `2ⁿ`; they must match.

**Constraints.** `0 ≤ n ≤ 60`.

**Expected.** `n=5` → `32 32`.

**Hint.** Use a Pascal row (Task 3) and sum it; compare to `1 << n` (Go/Java) or `2**n` (Python).

**Evaluation.** Sum matches `2ⁿ`; no overflow for `n ≤ 60`.

---

## Intermediate Tasks (5)

### Task 6 — C(n, k) mod p with precompute (single inverse)

**Problem.** Precompute `fact` and `invFact` up to `N` mod `p = 10⁹+7` using **one** Fermat inverse, then answer `q` queries `C(n,k) mod p` in `O(1)` each.

**Input / Output.** Read `N`, then `q`, then `q` pairs `(n, k)`. Print each `C(n,k) mod p`.

**Constraints.** `1 ≤ N ≤ 10⁶`, `0 ≤ n ≤ N`, `1 ≤ q ≤ 10⁵`. Reduce mod `p` after every multiply.

**Expected.** `C(5,2) mod p = 10`; `C(1000000,1) mod p = 1000000`.

**Starter — Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

var fact, invFact []int64

func powMod(a, e, m int64) int64 { /* TODO */ return 0 }

func build(n int) {
	// TODO: fact, then invFact[n]=powMod(fact[n],MOD-2,MOD), sweep down
}

func C(n, k int) int64 {
	if k < 0 || k > n {
		return 0
	}
	return fact[n] * invFact[k] % MOD * invFact[n-k] % MOD
}

func main() {
	var N, q int
	fmt.Scan(&N)
	build(N)
	fmt.Scan(&q)
	for ; q > 0; q-- {
		var n, k int
		fmt.Scan(&n, &k)
		fmt.Println(C(n, k))
	}
}
```

**Starter — Python.**
```python
MOD = 1_000_000_007
def build(n):
    # TODO: fact[], invfact[] with ONE pow(fact[n], MOD-2, MOD)
    ...
```

**Evaluation.** Exactly one modular inverse; `O(1)` per query; correct boundaries.

---

### Task 7 — Hockey-stick identity

**Problem.** Given `r` and `n`, compute `∑_{i=r}^{n} C(i, r)` directly and verify it equals `C(n+1, r+1)`.

**Input / Output.** Read `r`, `n`. Print the running sum and `C(n+1, r+1)`; they must match.

**Constraints.** `0 ≤ r ≤ n ≤ 60` (exact), or do it mod `p` for larger `n`.

**Expected.** `r=2, n=5` → `20 20`.

**Hint.** Loop `i = r … n` accumulating `C(i, r)`; compare to `C(n+1, r+1)`.

**Evaluation.** Both sides computed independently; they agree.

---

### Task 8 — Vandermonde's identity

**Problem.** Given `m, n, r`, verify `C(m+n, r) == ∑_{k=0}^{r} C(m, k)·C(n, r−k)`.

**Input / Output.** Read `m`, `n`, `r`. Print the convolution sum and `C(m+n, r)`; they must match.

**Constraints.** `0 ≤ m, n ≤ 40`, `0 ≤ r ≤ m+n`. Terms with `k > m` or `r−k > n` contribute `0`.

**Expected.** `m=2,n=2,r=2` → `6 6`; `m=5,n=4,r=3` → `84 84`.

**Evaluation.** Correct convolution range; zero-handling for impossible terms.

---

### Task 9 — Single C(n, k) mod p without a table

**Problem.** Compute one `C(n, k) mod p` for large `n` (with `n < p`) but small `k`, in `O(k + log p)` and `O(1)` memory.

**Input / Output.** Read `n`, `k`, `p`. Print `C(n,k) mod p`.

**Constraints.** `0 ≤ k ≤ 10⁶`, `k ≤ n < p`, `p` prime up to `10⁹+7`. Use `min(k, n−k)`.

**Expected.** `C(1000000000, 2) mod (10⁹+7)` = a specific residue.

**Hint.** numerator `= ∏_{i=0}^{k−1}(n−i) mod p`; denominator `= k! mod p`; answer `= num · pow(den, p−2, p) mod p`.

**Evaluation.** No precompute table; one Fermat inverse; correct for large `n`.

---

### Task 10 — Catalan numbers from C(n, k)

**Problem.** Compute the `n`-th Catalan number `Cat(n) = C(2n, n) / (n+1)` mod `p`, using your modular `C` and a modular inverse of `(n+1)`.

**Input / Output.** Read `n`, `p` (prime). Print `Cat(n) mod p`.

**Constraints.** `0 ≤ n ≤ 10⁶`, `p = 10⁹+7`. Precompute factorials up to `2n`.

**Expected.** `Cat(0..5) = 1, 1, 2, 5, 14, 42`.

**Hint.** `Cat(n) = C(2n,n) · inverse(n+1) mod p`. (See sibling `25-catalan-numbers`.)

**Evaluation.** Correct sequence; uses modular inverse for the `/(n+1)`.

---

## Advanced Tasks (5)

### Task 11 — Lucas' theorem for huge n

**Problem.** Compute `C(n, k) mod p` for a **small prime** `p` and **huge** `n, k` (where `n ≥ p`), using Lucas' theorem on base-`p` digits.

**Input / Output.** Read `n`, `k`, `p`. Print `C(n,k) mod p`.

**Constraints.** `0 ≤ k ≤ n ≤ 10¹⁸`, `p` prime, `2 ≤ p ≤ 10⁵`. Precompute factorials to `p−1`.

**Expected.** `C(1000, 500) mod 13` — verify against a brute `math.comb(1000,500) % 13`.

**Hint.** `C(n,k) ≡ ∏ C(nᵢ, kᵢ) (mod p)` over base-`p` digits; each digit uses the factorial method (valid since digits `< p`). Cross-link sibling `24-lucas-theorem`.

**Starter — Python.**
```python
def lucas(n, k, p):
    fact = [1] * p
    for i in range(1, p):
        fact[i] = fact[i - 1] * i % p
    def small_C(a, b):
        if b < 0 or b > a:
            return 0
        return fact[a] * pow(fact[b], p - 2, p) % p * pow(fact[a - b], p - 2, p) % p
    res = 1
    while n > 0 or k > 0:
        res = res * small_C(n % p, k % p) % p   # TODO: confirm digit loop
        n //= p
        k //= p
    return res
```

**Evaluation.** Correct base-`p` digit decomposition; matches brute force.

---

### Task 12 — Grid lattice paths

**Problem.** Count monotone lattice paths from `(0,0)` to `(a, b)` (only right/up moves) mod `p`. The answer is `C(a+b, a)`.

**Input / Output.** Read `a`, `b`, `p`. Print the number of paths mod `p`.

**Constraints.** `0 ≤ a, b ≤ 10⁶`, `p = 10⁹+7`. Precompute to `a+b`.

**Expected.** `a=2, b=2` → `6`; `a=3, b=3` → `20`.

**Hint.** A path is a sequence of `a` rights and `b` ups; choose positions for the rights: `C(a+b, a)`.

**Evaluation.** Correct mapping to `C(a+b, a)`; handles large grids mod `p`.

---

### Task 13 — Stars and bars

**Problem.** Count the number of ways to place `n` identical balls into `k` distinct boxes (boxes may be empty) mod `p`. The answer is `C(n + k − 1, k − 1)`.

**Input / Output.** Read `n`, `k`, `p`. Print the count mod `p`.

**Constraints.** `0 ≤ n ≤ 10⁶`, `1 ≤ k ≤ 10⁶`, `p = 10⁹+7`. Precompute to `n+k`.

**Expected.** `n=3, k=2` → `4` (i.e. `C(4,1)=4`).

**Hint.** Stars-and-bars: `C(n+k−1, k−1)`. Cross-link sibling `28-stars-and-bars`.

**Evaluation.** Correct formula; precompute sized to `n+k`.

---

### Task 14 — Composite modulus via CRT

**Problem.** Compute `C(n, k) mod M` where `M` is a **product of distinct small primes** (square-free composite). Compute `C(n,k) mod pᵢ` for each prime (Lucas), then CRT-combine.

**Input / Output.** Read `n`, `k`, then the count `t` of primes, then the `t` distinct primes whose product is `M`. Print `C(n,k) mod M`.

**Constraints.** `0 ≤ k ≤ n ≤ 10¹⁸`, primes `< 10⁵`, `t ≤ 6`, `M` square-free.

**Expected.** Verify against `math.comb(n,k) % M` for small `n,k`.

**Hint.** Per-prime Lucas (Task 11) → residues `rᵢ mod pᵢ` → CRT (sibling `06-crt`). For prime *powers* see sibling `33-factorial-mod-p`.

**Evaluation.** Correct per-prime residues; correct CRT recombination.

---

### Task 15 — Exact big C(n, k) with BigInt

**Problem.** Compute the **exact** `C(n, k)` (no modulus) for values far exceeding 64-bit, using arbitrary-precision integers and the multiplicative formula with `min(k, n−k)`.

**Input / Output.** Read `n`, `k`. Print the exact decimal value.

**Constraints.** `0 ≤ k ≤ n ≤ 10000`. Use `math/big` (Go), `BigInteger` (Java), native int (Python).

**Expected.** `C(100, 50) = 100891344545564193334812497256` (29 digits).

**Hint.** Multiply by `(n−k+i)` then divide by `i` (exact each step) to keep intermediates small.

**Evaluation.** Exact value; uses `min(k,n−k)` to bound intermediate size.

---

## Benchmark Task

> Compare precompute + query throughput across all 3 languages.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

const MOD = 1_000_000_007

func main() {
	sizes := []int{1000, 10000, 100000, 1000000}
	for _, N := range sizes {
		start := time.Now()
		fact := make([]int64, N+1)
		invFact := make([]int64, N+1)
		fact[0] = 1
		for i := 1; i <= N; i++ {
			fact[i] = fact[i-1] * int64(i) % MOD
		}
		powMod := func(a, e, m int64) int64 {
			r := int64(1)
			for e > 0 {
				if e&1 == 1 {
					r = r * a % m
				}
				a = a * a % m
				e >>= 1
			}
			return r
		}
		invFact[N] = powMod(fact[N], MOD-2, MOD)
		for i := N; i > 0; i-- {
			invFact[i-1] = invFact[i] * int64(i) % MOD
		}
		// run 10^6 queries
		var acc int64
		for q := 0; q < 1_000_000; q++ {
			n := q % (N + 1)
			k := (q * 7) % (n + 1)
			acc = (acc + fact[n]*invFact[k]%MOD*invFact[n-k]) % MOD
		}
		fmt.Printf("N=%8d: %.3f ms (checksum %d)\n",
			N, float64(time.Since(start).Microseconds())/1000.0, acc)
	}
}
```

#### Java

```java
public class Benchmark {
    static final long MOD = 1_000_000_007L;
    static long powMod(long a, long e, long m) {
        long r = 1;
        while (e > 0) { if ((e & 1) == 1) r = r * a % m; a = a * a % m; e >>= 1; }
        return r;
    }
    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000, 1000000};
        for (int N : sizes) {
            long start = System.nanoTime();
            long[] fact = new long[N + 1], invFact = new long[N + 1];
            fact[0] = 1;
            for (int i = 1; i <= N; i++) fact[i] = fact[i - 1] * i % MOD;
            invFact[N] = powMod(fact[N], MOD - 2, MOD);
            for (int i = N; i > 0; i--) invFact[i - 1] = invFact[i] * i % MOD;
            long acc = 0;
            for (int q = 0; q < 1_000_000; q++) {
                int n = q % (N + 1), k = (q * 7) % (n + 1);
                acc = (acc + fact[n] * invFact[k] % MOD * invFact[n - k]) % MOD;
            }
            System.out.printf("N=%8d: %.3f ms (checksum %d)%n",
                N, (System.nanoTime() - start) / 1_000_000.0, acc);
        }
    }
}
```

#### Python

```python
import time

MOD = 1_000_000_007

for N in [1000, 10000, 100000, 1000000]:
    start = time.perf_counter()
    fact = [1] * (N + 1)
    for i in range(1, N + 1):
        fact[i] = fact[i - 1] * i % MOD
    inv = [1] * (N + 1)
    inv[N] = pow(fact[N], MOD - 2, MOD)
    for i in range(N, 0, -1):
        inv[i - 1] = inv[i] * i % MOD
    acc = 0
    for q in range(1_000_000):
        n = q % (N + 1)
        k = (q * 7) % (n + 1)
        acc = (acc + fact[n] * inv[k] % MOD * inv[n - k]) % MOD
    print(f"N={N:>8}: {(time.perf_counter()-start)*1000:.3f} ms (checksum {acc})")
```

> **Expected trend:** precompute is `O(N)` (linear in `N`); the 10⁶-query loop is `O(1)` per query and dominates for small `N`. Go and Java run within a few hundred ms; Python is slower per op but the asymptotics match. The checksum must agree across all three languages for the same `N`.
