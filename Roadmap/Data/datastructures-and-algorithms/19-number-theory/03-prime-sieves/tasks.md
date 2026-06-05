# Prime Sieves — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec and starter code in all three languages. Implement the sieving logic and validate against the evaluation criteria.
> **Always validate against known `π(n)` values or a brute-force primality oracle on small inputs before trusting your sieve.**

---

## Beginner Tasks (5)

### Task 1 — Basic Sieve of Eratosthenes

**Problem.** Implement `sieve(n)` returning the list of all primes `≤ n`. Mark `0` and `1` as non-prime, start cross-outs at `p²`, stop the outer loop at `√n`.

**Input / Output spec.**
- Input: one integer `n`.
- Output: the primes `≤ n`, space-separated on one line.

**Constraints.** `0 ≤ n ≤ 10^6`.

**Hint.** Allocate `n+1` slots; use `m <= n` consistently. For `n < 2` print nothing.

**Starter — Go.**
```go
package main

import "fmt"

func sieve(n int) []int {
	// TODO: boolean array, cross out from p*p, collect survivors
	return nil
}

func main() {
	var n int
	fmt.Scan(&n)
	for i, p := range sieve(n) {
		if i > 0 {
			fmt.Print(" ")
		}
		fmt.Print(p)
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static List<Integer> sieve(int n) {
        // TODO
        return new ArrayList<>();
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        System.out.println(String.join(" ",
            sieve(n).stream().map(String::valueOf).toArray(String[]::new)));
    }
}
```

**Starter — Python.**
```python
def sieve(n):
    # TODO: bytearray, cross out from p*p, collect survivors
    return []


if __name__ == "__main__":
    n = int(input())
    print(" ".join(map(str, sieve(n))))
```

**Evaluation.** `sieve(30) == [2,3,5,7,11,13,17,19,23,29]`; `len(sieve(10**6)) == 78498`.

---

### Task 2 — Count primes `π(n)`

**Problem.** Return the number of primes `≤ n` without storing the full list (just count `true` entries).

**Input / Output spec.** Input `n`; output a single integer `π(n)`.

**Constraints.** `0 ≤ n ≤ 5·10^6`.

**Hint.** Increment a counter when you confirm a prime in the outer loop; no need to build a list.

**Starter — Go.**
```go
package main

import "fmt"

func countPrimes(n int) int {
	// TODO
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	fmt.Println(countPrimes(n))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task2 {
    static int countPrimes(int n) {
        // TODO
        return 0;
    }
    public static void main(String[] a) {
        System.out.println(countPrimes(new Scanner(System.in).nextInt()));
    }
}
```

**Starter — Python.**
```python
def count_primes(n):
    # TODO
    return 0


if __name__ == "__main__":
    print(count_primes(int(input())))
```

**Evaluation.** `π(100)=25`, `π(1000)=168`, `π(10^6)=78498`.

---

### Task 3 — Primality queries

**Problem.** Sieve up to a max bound once, then answer `q` queries "is `x` prime?" each in `O(1)`.

**Input / Output spec.** Input: `maxN`, then `q`, then `q` values `x` (each `≤ maxN`). Output: `YES`/`NO` per query.

**Constraints.** `2 ≤ maxN ≤ 10^6`, `1 ≤ q ≤ 10^5`.

**Hint.** Build `isPrime[]` once; each query is a single array read.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var maxN, q int
	fmt.Scan(&maxN)
	// TODO: build isPrime up to maxN
	fmt.Scan(&q)
	for ; q > 0; q-- {
		var x int
		fmt.Scan(&x)
		// TODO: print YES/NO
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task3 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int maxN = sc.nextInt();
        // TODO: build isPrime
        int q = sc.nextInt();
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) {
            int x = sc.nextInt();
            // TODO: sb.append(isPrime[x] ? "YES" : "NO").append('\n');
        }
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
import sys


def main():
    data = sys.stdin.read().split()
    idx = 0
    max_n = int(data[idx]); idx += 1
    # TODO: build is_prime up to max_n
    q = int(data[idx]); idx += 1
    out = []
    for _ in range(q):
        x = int(data[idx]); idx += 1
        # TODO: out.append("YES" if is_prime[x] else "NO")
    print("\n".join(out))


main()
```

**Evaluation.** Queries `2,4,17,1,1000003`-style return `YES,NO,YES,NO,...` correctly.

---

### Task 4 — Sum of primes up to n

**Problem.** Return the sum of all primes `≤ n` (use 64-bit accumulation).

**Input / Output spec.** Input `n`; output the sum.

**Constraints.** `0 ≤ n ≤ 2·10^6`.

**Hint.** Reuse your sieve; accumulate `p` for each survivor into a `long`/`int64`.

**Starter — Go.**
```go
package main

import "fmt"

func sumPrimes(n int) int64 {
	// TODO
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	fmt.Println(sumPrimes(n))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task4 {
    static long sumPrimes(int n) {
        // TODO
        return 0;
    }
    public static void main(String[] a) {
        System.out.println(sumPrimes(new Scanner(System.in).nextInt()));
    }
}
```

**Starter — Python.**
```python
def sum_primes(n):
    # TODO
    return 0


if __name__ == "__main__":
    print(sum_primes(int(input())))
```

**Evaluation.** `sumPrimes(10)=17` (2+3+5+7), `sumPrimes(100)=1060`.

---

### Task 5 — Smallest prime factor table

**Problem.** Build the `spf[]` table up to `n` with the linear sieve, then answer "what is the smallest prime factor of `x`?" for `q` queries.

**Input / Output spec.** Input `n`, `q`, then `q` values `x` (`2 ≤ x ≤ n`). Output `spf[x]` per query.

**Constraints.** `2 ≤ n ≤ 10^6`, `1 ≤ q ≤ 10^5`.

**Hint.** Linear sieve: `spf[i]==0` means prime; mark `spf[i*p]=p` for `p ≤ spf[i]`.

**Starter — Go.**
```go
package main

import "fmt"

func buildSPF(n int) []int {
	// TODO: linear sieve filling spf
	return nil
}

func main() {
	var n, q int
	fmt.Scan(&n, &q)
	spf := buildSPF(n)
	for ; q > 0; q-- {
		var x int
		fmt.Scan(&x)
		fmt.Println(spf[x])
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task5 {
    static int[] buildSPF(int n) {
        // TODO
        return new int[n + 1];
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), q = sc.nextInt();
        int[] spf = buildSPF(n);
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) sb.append(spf[sc.nextInt()]).append('\n');
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
def build_spf(n):
    # TODO
    return [0] * (n + 1)


if __name__ == "__main__":
    import sys
    d = sys.stdin.read().split()
    n, q = int(d[0]), int(d[1])
    spf = build_spf(n)
    print("\n".join(str(spf[int(d[2 + i])]) for i in range(q)))
```

**Evaluation.** `spf[24]=2`, `spf[35]=5`, `spf[97]=97`.

---

## Intermediate Tasks (4)

### Task 6 — Full factorization via SPF

**Problem.** Using the `spf[]` table, factor each query `x` into `prime^exp` form. Output factors in increasing prime order.

**Input / Output spec.** Input `n`, `q`, then `q` values `x ≤ n`. For each, output `p1^e1 p2^e2 ...`.

**Constraints.** `2 ≤ n ≤ 10^6`, `1 ≤ q ≤ 10^5`.

**Hint.** Repeatedly take `p = spf[x]`, count its exponent by dividing it out, recurse on the cofactor — `O(log x)` per query.

**Starter — Go.**
```go
package main

import "fmt"

func buildSPF(n int) []int { /* TODO */ return nil }

func factor(x int, spf []int) string {
	// TODO: build "p^e p^e ..." string
	return ""
}

func main() {
	var n, q int
	fmt.Scan(&n, &q)
	spf := buildSPF(n)
	for ; q > 0; q-- {
		var x int
		fmt.Scan(&x)
		fmt.Println(factor(x, spf))
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task6 {
    static int[] buildSPF(int n) { /* TODO */ return new int[n + 1]; }
    static String factor(int x, int[] spf) {
        StringBuilder sb = new StringBuilder();
        // TODO
        return sb.toString().trim();
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), q = sc.nextInt();
        int[] spf = buildSPF(n);
        while (q-- > 0) System.out.println(factor(sc.nextInt(), spf));
    }
}
```

**Starter — Python.**
```python
def build_spf(n):  # TODO
    return [0] * (n + 1)


def factor(x, spf):
    parts = []
    # TODO
    return " ".join(parts)


if __name__ == "__main__":
    import sys
    d = iter(sys.stdin.read().split())
    n, q = int(next(d)), int(next(d))
    spf = build_spf(n)
    for _ in range(q):
        print(factor(int(next(d)), spf))
```

**Evaluation.** `factor(360) = "2^3 3^2 5^1"`; `factor(97) = "97^1"`.

---

### Task 7 — Segmented sieve over `[L, R]`

**Problem.** Print all primes in `[L, R]` using base primes up to `√R`.

**Input / Output spec.** Input `L R`; output primes in `[L, R]` space-separated.

**Constraints.** `1 ≤ L ≤ R ≤ 10^12`, `R − L ≤ 10^6`.

**Hint.** First multiple of `p` in window is `max(p², ⌈L/p⌉·p)`. Clear `0`/`1` when `L ≤ 1`. Use 64-bit.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

func segmented(L, R int64) []int64 {
	_ = math.Sqrt
	// TODO: base sieve up to sqrt(R), then window sieve
	return nil
}

func main() {
	var L, R int64
	fmt.Scan(&L, &R)
	for i, p := range segmented(L, R) {
		if i > 0 {
			fmt.Print(" ")
		}
		fmt.Print(p)
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task7 {
    static List<Long> segmented(long L, long R) {
        // TODO
        return new ArrayList<>();
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long L = sc.nextLong(), R = sc.nextLong();
        System.out.println(String.join(" ",
            segmented(L, R).stream().map(String::valueOf).toArray(String[]::new)));
    }
}
```

**Starter — Python.**
```python
import math


def segmented(L, R):
    # TODO: simple sieve to isqrt(R), then window
    return []


if __name__ == "__main__":
    L, R = map(int, input().split())
    print(" ".join(map(str, segmented(L, R))))
```

**Evaluation.** `segmented(10, 30) = [11,13,17,19,23,29]`; `segmented(10**12, 10**12+50)` includes `1000000000039` (the first prime &ge; 10^12, at offset 39).

---

### Task 8 — Sieve Euler's totient `φ`

**Problem.** Compute `φ(i)` for all `i ≤ n` with the linear sieve; answer `q` queries `φ(x)`.

**Input / Output spec.** Input `n`, `q`, then `q` values `x`. Output `φ(x)` per query.

**Constraints.** `1 ≤ n ≤ 5·10^6`, `1 ≤ q ≤ 10^5`.

**Hint.** `φ(prime)=p−1`; coprime: `φ(i·p)=φ(i)(p−1)`; square factor (`p∣i`): `φ(i·p)=φ(i)·p`.

**Starter — Go.**
```go
package main

import "fmt"

func sievePhi(n int) []int {
	// TODO: linear sieve filling phi
	return nil
}

func main() {
	var n, q int
	fmt.Scan(&n, &q)
	phi := sievePhi(n)
	for ; q > 0; q-- {
		var x int
		fmt.Scan(&x)
		fmt.Println(phi[x])
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task8 {
    static int[] sievePhi(int n) { /* TODO */ return new int[n + 1]; }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), q = sc.nextInt();
        int[] phi = sievePhi(n);
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) sb.append(phi[sc.nextInt()]).append('\n');
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
def sieve_phi(n):  # TODO
    return [0] * (n + 1)


if __name__ == "__main__":
    import sys
    d = iter(sys.stdin.read().split())
    n, q = int(next(d)), int(next(d))
    phi = sieve_phi(n)
    print("\n".join(str(phi[int(next(d))]) for _ in range(q)))
```

**Evaluation.** `φ(1)=1`, `φ(12)=4`, `φ(36)=12`, `φ(97)=96`.

---

### Task 9 — Sieve the Möbius function `μ`

**Problem.** Compute `μ(i)` for all `i ≤ n`; then output the count of squarefree numbers in `[1, n]` (those with `μ ≠ 0`).

**Input / Output spec.** Input `n`; output the count of squarefree numbers in `[1, n]`.

**Constraints.** `1 ≤ n ≤ 5·10^6`.

**Hint.** `μ(prime)=−1`; coprime: `μ(i·p)=−μ(i)`; square factor: `μ(i·p)=0`. Squarefree ⟺ `μ ≠ 0`.

**Starter — Go.**
```go
package main

import "fmt"

func sieveMu(n int) []int {
	// TODO
	return nil
}

func main() {
	var n int
	fmt.Scan(&n)
	mu := sieveMu(n)
	cnt := 0
	for i := 1; i <= n; i++ {
		if mu[i] != 0 {
			cnt++
		}
	}
	fmt.Println(cnt)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task9 {
    static int[] sieveMu(int n) { /* TODO */ return new int[n + 1]; }
    public static void main(String[] args) {
        int n = new Scanner(System.in).nextInt();
        int[] mu = sieveMu(n);
        int cnt = 0;
        for (int i = 1; i <= n; i++) if (mu[i] != 0) cnt++;
        System.out.println(cnt);
    }
}
```

**Starter — Python.**
```python
def sieve_mu(n):  # TODO
    return [0] * (n + 1)


if __name__ == "__main__":
    n = int(input())
    mu = sieve_mu(n)
    print(sum(1 for i in range(1, n + 1) if mu[i] != 0))
```

**Evaluation.** For `n=10` the squarefree count is 7 (`1,2,3,5,6,7,10` are squarefree; `4,8,9` are not).

---

## Advanced Tasks (3)

### Task 10 — Count primes with a cache-blocked segmented sieve

**Problem.** Count primes `≤ n` using a segmented sieve that processes `[2, n]` in fixed-size blocks, holding only base primes up to `√n` plus one block buffer. Memory must be `O(√n + block)`.

**Input / Output spec.** Input `n`; output `π(n)`.

**Constraints.** `2 ≤ n ≤ 10^9` (so a full array would be too large for a byte sieve).

**Hint.** Sieve base primes up to `√n`. For each block `[lo, hi]`, reset the buffer, cross out base-prime multiples starting at `max(p², ⌈lo/p⌉·p)`, count survivors.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

func basePrimes(limit int) []int { /* TODO */ return nil }

func countPrimesSeg(n int) int64 {
	_ = math.Sqrt
	const BLOCK = 1 << 18
	// TODO: blocked segmented count
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	fmt.Println(countPrimesSeg(n))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task10 {
    static int[] basePrimes(int limit) { /* TODO */ return new int[0]; }
    static long countPrimesSeg(int n) {
        final int BLOCK = 1 << 18;
        // TODO
        return 0;
    }
    public static void main(String[] a) {
        System.out.println(countPrimesSeg(new Scanner(System.in).nextInt()));
    }
}
```

**Starter — Python.**
```python
import math


def base_primes(limit):  # TODO
    return []


def count_primes_seg(n):
    BLOCK = 1 << 18
    # TODO
    return 0


if __name__ == "__main__":
    print(count_primes_seg(int(input())))
```

**Evaluation.** `π(10^7)=664579`, `π(10^8)=5761455`, `π(10^9)=50847534`. Memory stays bounded by `O(√n + BLOCK)`.

---

### Task 11 — Sum of `φ` over `[1, n]` with prefix sums

**Problem.** Precompute `φ` with the linear sieve, build a prefix-sum array, then answer `q` range queries "sum of `φ(i)` for `i ∈ [a, b]`" each in `O(1)`.

**Input / Output spec.** Input `n`, `q`, then `q` pairs `a b`. Output the sum per query (64-bit).

**Constraints.** `1 ≤ n ≤ 5·10^6`, `1 ≤ q ≤ 10^5`, `1 ≤ a ≤ b ≤ n`.

**Hint.** `pref[i] = pref[i−1] + φ(i)`; answer is `pref[b] − pref[a−1]`.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var n, q int
	fmt.Scan(&n, &q)
	// TODO: sieve phi, build pref[] as []int64
	for ; q > 0; q-- {
		var a, b int
		fmt.Scan(&a, &b)
		// TODO: print pref[b] - pref[a-1]
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task11 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), q = sc.nextInt();
        // TODO: sieve phi, build long[] pref
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) {
            int a = sc.nextInt(), b = sc.nextInt();
            // TODO: sb.append(pref[b] - pref[a-1]).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
import sys


def main():
    d = iter(sys.stdin.read().split())
    n, q = int(next(d)), int(next(d))
    # TODO: sieve phi, build prefix sums
    out = []
    for _ in range(q):
        a, b = int(next(d)), int(next(d))
        # TODO: out.append(str(pref[b] - pref[a-1]))
    print("\n".join(out))


main()
```

**Evaluation.** Sum of `φ` over `[1,10]` is 32; over `[1,1]` is 1; over `[5,5]` is `φ(5)=4`.

---

### Task 12 — Number of divisors via sieve

**Problem.** Compute the divisor count `τ(i)` for all `i ≤ n` (you may use a simple `O(n log n)` divisor sieve or the linear-sieve exponent-tracking method), and report the value(s) of `i ≤ n` with the maximum number of divisors (a "highly composite" probe).

**Input / Output spec.** Input `n`; output the smallest `i ≤ n` achieving the maximum `τ(i)`, and that maximum.

**Constraints.** `1 ≤ n ≤ 10^6`.

**Hint.** Simple divisor sieve: for `d = 1..n`, for each multiple `m` of `d`, `tau[m]++`. Then scan for the max.

**Starter — Go.**
```go
package main

import "fmt"

func sieveTau(n int) []int {
	tau := make([]int, n+1)
	// TODO: for d=1..n, add 1 to every multiple of d
	return tau
}

func main() {
	var n int
	fmt.Scan(&n)
	tau := sieveTau(n)
	bestI, bestT := 1, 0
	for i := 1; i <= n; i++ {
		if tau[i] > bestT {
			bestT, bestI = tau[i], i
		}
	}
	fmt.Println(bestI, bestT)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task12 {
    static int[] sieveTau(int n) {
        int[] tau = new int[n + 1];
        // TODO
        return tau;
    }
    public static void main(String[] args) {
        int n = new Scanner(System.in).nextInt();
        int[] tau = sieveTau(n);
        int bi = 1, bt = 0;
        for (int i = 1; i <= n; i++) if (tau[i] > bt) { bt = tau[i]; bi = i; }
        System.out.println(bi + " " + bt);
    }
}
```

**Starter — Python.**
```python
def sieve_tau(n):
    tau = [0] * (n + 1)
    # TODO: for d in 1..n, increment every multiple of d
    return tau


if __name__ == "__main__":
    n = int(input())
    tau = sieve_tau(n)
    best_i, best_t = 1, 0
    for i in range(1, n + 1):
        if tau[i] > best_t:
            best_t, best_i = tau[i], i
    print(best_i, best_t)
```

**Evaluation.** For `n=10`, the max `τ` is 4, first achieved at `i=6` (divisors 1,2,3,6). For `n=100`, the answer is `i=60` with `τ=12`.

---

## Evaluation Criteria (All Tasks)

- **Correctness on small inputs first.** Validate against the listed expected outputs and a brute-force oracle before scaling up.
- **Edge cases.** Handle `n < 2`, `L ≤ 1`, `a = 1`, and queries at the bounds. These are where most submissions fail.
- **Integer width.** Use 64-bit for sums and for `p*p`/`i*p` products when `n` or `R` is large; 32-bit overflow silently corrupts results.
- **Complexity.** Beginner/intermediate tasks should hit `O(n log log n)` or `O(n)`; advanced tasks must respect the stated memory bound (segmented) and per-query `O(1)`/`O(log x)` targets.
- **Optimizations.** Start cross-outs at `p²`, stop the outer loop at `√n`, and prefer the linear sieve where SPF or a multiplicative function is needed.
- **Validation.** Cross-check `π(n)` and function values (`φ`, `μ`, `τ`) against the reference numbers given; a sieve can be wrong on a single value among millions.

Work through the tasks in order: Tasks 1–5 cement the core sieve and SPF, Tasks 6–9 add factorization, segmentation, and multiplicative functions, and Tasks 10–12 push into bounded-memory and prefix-sum techniques used in real contests and systems.
