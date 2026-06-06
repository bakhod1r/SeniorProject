# Catalan Numbers — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle on small inputs** — enumerate balanced parentheses (or binary trees) directly and confirm the count equals `C_n`.

---

## Beginner Tasks (5)

### Task 1 — Catalan via the recurrence

**Problem.** Implement `catalanDP(n)` returning `C_n` using the convolution recurrence `C_{n+1} = Σ_{i=0}^{n} C_i · C_{n-i}` with `C_0 = 1`, in `O(n²)`.

**Input / Output spec.**
- Read one integer `n` (`0 ≤ n ≤ 30`).
- Print `C_n`.

**Constraints.**
- Use `int64`; valid for `n ≤ 35` before overflow.
- Build a table `c[0..n]`; the convolution for `c[k]` uses indices summing to `k-1`.

**Hint.** `c[k] = Σ_{i=0}^{k-1} c[i]·c[k-1-i]`.

**Starter — Go.**
```go
package main

import "fmt"

func catalanDP(n int) int64 {
	// TODO: build c[0..n] via convolution
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	fmt.Println(catalanDP(n))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long catalanDP(int n) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(catalanDP(sc.nextInt()));
    }
}
```

**Starter — Python.**
```python
import sys


def catalan_dp(n):
    # TODO
    return 0


if __name__ == "__main__":
    print(catalan_dp(int(sys.stdin.read().split()[0])))
```

**Evaluation.** Outputs `1, 1, 2, 5, 14, 42, 132` for `n = 0..6`; matches the closed form.

---

### Task 2 — Catalan via the closed form

**Problem.** Implement `catalanClosed(n) = C(2n,n)/(n+1)` building the binomial multiplicatively (interleave `*` and `/`) so intermediates stay small. `O(n)`.

**Input / Output spec.**
- Read `n` (`0 ≤ n ≤ 30`). Print `C_n`.

**Constraints.** No precomputed factorials; build `C(2n,n)` step by step.

**Hint.** `result = 1; for i in 0..n-1: result = result*(2n-i)/(i+1); return result/(n+1)`.

**Starter — Go.**
```go
package main

import "fmt"

func catalanClosed(n int) int64 {
	// TODO: multiplicative binomial, then / (n+1)
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	fmt.Println(catalanClosed(n))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task2 {
    static long catalanClosed(int n) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        System.out.println(catalanClosed(new Scanner(System.in).nextInt()));
    }
}
```

**Starter — Python.**
```python
import sys


def catalan_closed(n):
    # TODO
    return 0


if __name__ == "__main__":
    print(catalan_closed(int(sys.stdin.read().split()[0])))
```

**Evaluation.** Agrees with Task 1 for all `n ≤ 30`.

---

### Task 3 — Brute-force balanced-parentheses oracle

**Problem.** Implement `countBalanced(n)` that counts balanced strings of `n` pairs by recursive enumeration, and confirm `countBalanced(n) == C_n` for `n = 0..8`.

**Input / Output spec.**
- Read `n` (`0 ≤ n ≤ 12`). Print the count.

**Constraints.** Enumeration only — exponential, but a correctness oracle for the formulas.

**Hint.** Track `(open_left, close_left, balance)`; place `)` only when `balance > 0`.

**Starter — Go.**
```go
package main

import "fmt"

func countBalanced(n int) int64 {
	var rec func(o, c, bal int) int64
	rec = func(o, c, bal int) int64 {
		// TODO
		return 0
	}
	return rec(n, n, 0)
}

func main() {
	var n int
	fmt.Scan(&n)
	fmt.Println(countBalanced(n))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task3 {
    static long rec(int o, int c, int bal) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        int n = new Scanner(System.in).nextInt();
        System.out.println(rec(n, n, 0));
    }
}
```

**Starter — Python.**
```python
import sys
sys.setrecursionlimit(10000)


def count_balanced(n):
    def rec(o, c, bal):
        # TODO
        return 0
    return rec(n, n, 0)


if __name__ == "__main__":
    print(count_balanced(int(sys.stdin.read().split()[0])))
```

**Evaluation.** Matches `C_n` for every `n ≤ 8` (`1, 1, 2, 5, 14, 42, 132, 429, 1430`).

---

### Task 4 — Catalan number mod a prime

**Problem.** Implement `catalanMod(n, p)` returning `C_n mod p` using factorials and a Fermat modular inverse for `/(n+1)`. `O(n)`.

**Input / Output spec.**
- Read `n` and prime `p` (`0 ≤ n ≤ 10^5`, `2n < p`). Print `C_n mod p`.

**Constraints.** Use a modular inverse; integer division of the residue is a wrong answer.

**Hint.** `C_n = fact[2n]·inv(n!)·inv((n+1)!) mod p`; one Fermat inverse plus a downward sweep builds all inverse factorials.

**Starter — Go.**
```go
package main

import "fmt"

func powMod(a, e, m int64) int64 {
	// TODO: binary exponentiation
	return 0
}

func catalanMod(n int, p int64) int64 {
	// TODO: factorials + inverse factorials
	return 0
}

func main() {
	var n int
	var p int64
	fmt.Scan(&n, &p)
	fmt.Println(catalanMod(n, p))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task4 {
    static long powMod(long a, long e, long m) { /* TODO */ return 0; }
    static long catalanMod(int n, long p) { /* TODO */ return 0; }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(catalanMod(sc.nextInt(), sc.nextLong()));
    }
}
```

**Starter — Python.**
```python
import sys


def catalan_mod(n, p):
    # TODO: pow(x, p-2, p) for the inverse
    return 0


if __name__ == "__main__":
    n, p = map(int, sys.stdin.read().split())
    print(catalan_mod(n, p))
```

**Evaluation.** For `p = 1_000_000_007`: `catalanMod(10, p) == 16796`, `catalanMod(100, p) == 558488487`. Assert `(n+1)·C_n ≡ C(2n,n) (mod p)`.

---

### Task 5 — Generate all balanced parentheses

**Problem.** Implement `generate(n)` returning every balanced string of `n` pairs (LeetCode 22). Confirm there are exactly `C_n`.

**Input / Output spec.**
- Read `n` (`1 ≤ n ≤ 8`). Print the count and the strings.

**Constraints.** Backtracking: add `(` while `open < n`, add `)` while `close < open`.

**Hint.** The count returned must equal `C_n` from Task 1.

**Starter — Go.**
```go
package main

import "fmt"

func generate(n int) []string {
	// TODO: backtracking
	return nil
}

func main() {
	var n int
	fmt.Scan(&n)
	g := generate(n)
	fmt.Println(len(g), g)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task5 {
    static List<String> generate(int n) {
        // TODO
        return new ArrayList<>();
    }

    public static void main(String[] args) {
        List<String> g = generate(new Scanner(System.in).nextInt());
        System.out.println(g.size() + " " + g);
    }
}
```

**Starter — Python.**
```python
import sys


def generate(n):
    # TODO
    return []


if __name__ == "__main__":
    g = generate(int(sys.stdin.read().split()[0]))
    print(len(g), g)
```

**Evaluation.** `len(generate(n)) == C_n` for `n = 1..8`; every string is balanced.

---

## Intermediate Tasks (5)

### Task 6 — Count unique binary search trees

**Problem.** Return the number of structurally distinct BSTs storing keys `1…n` (LeetCode 96) via the Catalan DP `dp[k] = Σ dp[root-1]·dp[k-root]`. Confirm it equals `C_n`.
- Provide starter code in all three languages.
- **Constraints.** `1 ≤ n ≤ 19` (fits `int64`). Compare to `catalanClosed(n)`.

### Task 7 — Catalan table mod p, O(N)

**Problem.** Precompute `C_0…C_N mod p` in `O(N)` total using factorial / inverse-factorial tables. Answer `Q` queries `C_n` in `O(1)` each.
- Provide starter code in all three languages.
- **Constraints.** `N ≤ 10^6`, `Q ≤ 10^6`, `p` prime with `2N < p`. Reject `n > N`.

### Task 8 — Count triangulations of a polygon

**Problem.** Given the number of sides `s` of a convex polygon (`s ≥ 3`), return the number of triangulations `C_{s-2}`. Verify a pentagon gives `5` and a hexagon gives `14`.
- Provide starter code in all three languages.
- **Constraints.** `3 ≤ s ≤ 35` (exact, `int64`). Mind the `s-2` index mapping.

### Task 9 — Validate the Catalan identities

**Problem.** Given `n` and prime `p`, compute `C_n` by the division form and the subtraction form `C(2n,n) − C(2n,n+1)` (mod p) and assert they agree, and also assert `(n+1)·C_n ≡ C(2n,n) (mod p)`.
- Provide starter code in all three languages.
- **Constraints.** `0 ≤ n ≤ 10^5`, `2n < p`. Both forms must match for all tested `n`.

### Task 10 — Monotonic lattice paths below the diagonal

**Problem.** Count monotonic paths in an `n × n` grid from `(0,0)` to `(n,n)` that never rise above the main diagonal (only right/up moves, staying weakly below). The answer is `C_n`. Implement a DP `paths[i][j]` and confirm against `catalanClosed(n)`.
- Provide starter code in all three languages.
- **Constraints.** `1 ≤ n ≤ 30`. The DP fills only cells with `j ≤ i`.

---

## Advanced Tasks (5)

### Task 11 — Fuss–Catalan (k-ary trees)

**Problem.** Compute the number of `k`-ary trees with `n` internal nodes mod `p`: `(1/((k-1)n+1))·C(kn, n)`. Verify `k = 2` reproduces the ordinary Catalan numbers.
- Provide starter code in all three languages.
- **Constraints.** `1 ≤ k ≤ 5`, `0 ≤ n ≤ 10^5`, `kn < p`. Use precomputed factorials.

### Task 12 — Narayana numbers and their sum

**Problem.** Compute `N(n,k) = (1/n)·C(n,k)·C(n,k-1)` for all `k`, and verify `Σ_{k=1}^{n} N(n,k) = C_n` (the Narayana refinement of Catalan).
- Provide starter code in all three languages.
- **Constraints.** `1 ≤ n ≤ 10^4`. Exact (big int) or mod `p`; the row sum must equal `C_n`.

### Task 13 — Exponent tower of the answer count? No — large-n modular pipeline

**Problem.** Build a service that, given a stream of up to `10^6` queries `n_i` (`0 ≤ n_i ≤ 10^6`), answers `C_{n_i} mod p` in `O(1)` per query after a single `O(10^6)` precompute. Measure total time.
- Provide starter code in all three languages.
- **Constraints.** `p = 998244353` (NTT-friendly). Precompute factorials to `2·10^6`. Assert each query bound.

### Task 14 — Count non-crossing chord diagrams

**Problem.** Given `2n` points on a circle, count the ways to connect them with `n` non-crossing chords. The answer is `C_n`. Implement via the convolution DP (a chord from point 1 splits the rest into two independent arcs) and verify against `catalanClosed(n)`.
- Provide starter code in all three languages.
- **Constraints.** `0 ≤ n ≤ 30`. The split is `Σ_i C_i·C_{n-1-i}` — re-derive the Catalan recurrence from the geometry.

### Task 15 — Stack-sortable permutations (231-avoidance)

**Problem.** Given `n`, count permutations of `1…n` that are stack-sortable (avoid the pattern `231`). The answer is `C_n`. Implement a brute-force checker (try a single-stack sort) for `n ≤ 9` and confirm the count equals `C_n`.
- Provide starter code in all three languages.
- **Constraints.** `1 ≤ n ≤ 9` for the brute-force; cross-check with `catalanClosed(n)`.

---

## Benchmark Task

> Compare performance across all 3 languages: precompute factorials and answer `10^6` Catalan-mod-p queries.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

const MOD = 998244353

func main() {
	N := 1_000_000
	sz := 2*N + 2
	fact := make([]int64, sz)
	invf := make([]int64, sz)
	start := time.Now()
	fact[0] = 1
	for i := 1; i < sz; i++ {
		fact[i] = fact[i-1] * int64(i) % MOD
	}
	// invf[sz-1] via Fermat, then sweep down
	inv := int64(1)
	{
		a, e := fact[sz-1], int64(MOD-2)
		a %= MOD
		r := int64(1)
		for e > 0 {
			if e&1 == 1 {
				r = r * a % MOD
			}
			a = a * a % MOD
			e >>= 1
		}
		inv = r
	}
	invf[sz-1] = inv
	for i := sz - 1; i > 0; i-- {
		invf[i-1] = invf[i] * int64(i) % MOD
	}
	var sum int64
	for n := 0; n <= N; n++ {
		sum += fact[2*n] * invf[n] % MOD * invf[n+1] % MOD
	}
	fmt.Printf("checksum=%d in %v\n", sum%MOD, time.Since(start))
}
```

#### Java

```java
public class Benchmark {
    static final long MOD = 998244353L;

    public static void main(String[] args) {
        int N = 1_000_000, sz = 2 * N + 2;
        long[] fact = new long[sz], invf = new long[sz];
        long start = System.nanoTime();
        fact[0] = 1;
        for (int i = 1; i < sz; i++) fact[i] = fact[i - 1] * i % MOD;
        long a = fact[sz - 1] % MOD, e = MOD - 2, r = 1;
        while (e > 0) { if ((e & 1) == 1) r = r * a % MOD; a = a * a % MOD; e >>= 1; }
        invf[sz - 1] = r;
        for (int i = sz - 1; i > 0; i--) invf[i - 1] = invf[i] * i % MOD;
        long sum = 0;
        for (int n = 0; n <= N; n++) sum += fact[2 * n] * invf[n] % MOD * invf[n + 1] % MOD;
        long elapsed = System.nanoTime() - start;
        System.out.printf("checksum=%d in %.3f ms%n", sum % MOD, elapsed / 1_000_000.0);
    }
}
```

#### Python

```python
import time

MOD = 998244353


def main():
    N = 1_000_000
    sz = 2 * N + 2
    start = time.perf_counter()
    fact = [1] * sz
    for i in range(1, sz):
        fact[i] = fact[i - 1] * i % MOD
    invf = [1] * sz
    invf[sz - 1] = pow(fact[sz - 1], MOD - 2, MOD)
    for i in range(sz - 1, 0, -1):
        invf[i - 1] = invf[i] * i % MOD
    total = 0
    for n in range(N + 1):
        total += fact[2 * n] * invf[n] % MOD * invf[n + 1] % MOD
    print(f"checksum={total % MOD} in {(time.perf_counter() - start) * 1000:.3f} ms")


if __name__ == "__main__":
    main()
```
