# Divisor Functions — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec and starter code in all three languages. Implement the divisor logic and validate against the evaluation criteria.
> **Always validate against the closed-form formulas or a brute-force divisor walk on small inputs before trusting your sieve. Use 64-bit for σ everywhere.**

---

## Beginner Tasks (5)

### Task 1 — `d(n)` and `σ(n)` for a single number

**Problem.** Implement `dSigma(n)` returning the number of divisors `d(n)` and the sum of divisors `σ(n)`, computed by factorizing `n` with trial division. Do **not** list all divisors.

**Input / Output spec.**
- Input: one integer `n`.
- Output: two integers `d(n)` and `σ(n)` on one line, space-separated.

**Constraints.** `1 ≤ n ≤ 10^{12}`.

**Hint.** For each prime factor `p` with exponent `a`, multiply `d` by `(a+1)` and `σ` by `(1 + p + … + p^a)` (accumulate the geometric sum with integer addition). Do not forget the leftover prime when the trial loop ends with `n > 1`.

**Starter — Go.**
```go
package main

import "fmt"

func dSigma(n int64) (int64, int64) {
	// TODO: trial-division factorization; build d and sigma
	return 0, 0
}

func main() {
	var n int64
	fmt.Scan(&n)
	d, s := dSigma(n)
	fmt.Println(d, s)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long[] dSigma(long n) {
        // TODO
        return new long[]{0, 0};
    }
    public static void main(String[] args) {
        long n = new Scanner(System.in).nextLong();
        long[] r = dSigma(n);
        System.out.println(r[0] + " " + r[1]);
    }
}
```

**Starter — Python.**
```python
def d_sigma(n):
    # TODO: trial-division factorization
    return 0, 0


if __name__ == "__main__":
    d, s = d_sigma(int(input()))
    print(d, s)
```

**Evaluation.** `dSigma(12) = (6, 28)`; `dSigma(360) = (24, 1170)`; `dSigma(97) = (2, 98)`; `dSigma(1) = (1, 1)`.

---

### Task 2 — Naive divisor walk (`√n` pairing)

**Problem.** Implement `dSigma(n)` *without* factorization, by walking `i` from `1` to `√n` and using divisor pairs `(i, n/i)`. Count the square root only once for perfect squares.

**Input / Output spec.** Input `n`; output `d(n)` and `σ(n)`.

**Constraints.** `1 ≤ n ≤ 10^{12}`.

**Hint.** When `i*i == n`, add `i` once. Otherwise add both `i` and `n/i`.

**Starter — Go.**
```go
package main

import "fmt"

func dSigma(n int64) (int64, int64) {
	// TODO: loop i while i*i <= n
	return 0, 0
}

func main() {
	var n int64
	fmt.Scan(&n)
	d, s := dSigma(n)
	fmt.Println(d, s)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task2 {
    static long[] dSigma(long n) { /* TODO */ return new long[]{0, 0}; }
    public static void main(String[] args) {
        long n = new Scanner(System.in).nextLong();
        long[] r = dSigma(n);
        System.out.println(r[0] + " " + r[1]);
    }
}
```

**Starter — Python.**
```python
def d_sigma(n):
    # TODO: i*i <= n pairing
    return 0, 0


if __name__ == "__main__":
    d, s = d_sigma(int(input()))
    print(d, s)
```

**Evaluation.** Must match Task 1 for `n = 12, 36, 360, 49`. Note `36` is a perfect square: `d(36)=9`, `σ(36)=91`.

---

### Task 3 — Divisor sieve for all `m ≤ N`

**Problem.** Build `d[m]` and `σ[m]` for all `m ≤ N` with the `O(N log N)` divisor sieve, then answer `q` queries returning `d(x)` and `σ(x)`.

**Input / Output spec.** Input `N`, `q`, then `q` values `x` (`1 ≤ x ≤ N`). For each, output `d(x)` and `σ(x)`.

**Constraints.** `1 ≤ N ≤ 10^6`, `1 ≤ q ≤ 10^5`.

**Hint.** For each divisor `div` from `1` to `N`, iterate multiples `m = div, 2div, …` and do `cnt[m]++`, `sum[m] += div`. Use 64-bit for `σ`.

**Starter — Go.**
```go
package main

import "fmt"

func sieve(N int) ([]int, []int64) {
	// TODO
	return nil, nil
}

func main() {
	var N, q int
	fmt.Scan(&N, &q)
	d, s := sieve(N)
	for ; q > 0; q-- {
		var x int
		fmt.Scan(&x)
		fmt.Println(d[x], s[x])
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task3 {
    static int[] d;
    static long[] s;
    static void sieve(int N) { /* TODO */ }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int N = sc.nextInt(), q = sc.nextInt();
        sieve(N);
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) { int x = sc.nextInt(); sb.append(d[x]).append(' ').append(s[x]).append('\n'); }
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
import sys


def sieve(N):
    # TODO
    return [], []


def main():
    data = sys.stdin.read().split()
    i = 0
    N, q = int(data[i]), int(data[i + 1]); i += 2
    d, s = sieve(N)
    out = []
    for _ in range(q):
        x = int(data[i]); i += 1
        out.append(f"{d[x]} {s[x]}")
    print("\n".join(out))


main()
```

**Evaluation.** Queries `6, 12, 360` return `(4,12)`, `(6,28)`, `(24,1170)`.

---

### Task 4 — Classify perfect / abundant / deficient

**Problem.** For each query `x ≤ N`, print whether `x` is `perfect`, `abundant`, or `deficient`, using a sieved `σ` array.

**Input / Output spec.** Input `N`, `q`, then `q` values `x`. Output one classification per query.

**Constraints.** `1 ≤ N ≤ 10^6`, `1 ≤ q ≤ 10^5`.

**Hint.** Let `s = σ(x) − x`. Perfect if `s == x`, abundant if `s > x`, else deficient.

**Starter — Go.**
```go
package main

import "fmt"

func sigmaSieve(N int) []int64 {
	// TODO
	return nil
}

func main() {
	var N, q int
	fmt.Scan(&N, &q)
	sig := sigmaSieve(N)
	for ; q > 0; q-- {
		var x int
		fmt.Scan(&x)
		s := sig[x] - int64(x)
		switch {
		case s == int64(x):
			fmt.Println("perfect")
		case s > int64(x):
			fmt.Println("abundant")
		default:
			fmt.Println("deficient")
		}
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task4 {
    static long[] sigmaSieve(int N) { /* TODO */ return new long[N + 1]; }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int N = sc.nextInt(), q = sc.nextInt();
        long[] sig = sigmaSieve(N);
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) {
            int x = sc.nextInt();
            long s = sig[x] - x;
            sb.append(s == x ? "perfect" : (s > x ? "abundant" : "deficient")).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
import sys


def sigma_sieve(N):
    # TODO
    return [0] * (N + 1)


def main():
    d = sys.stdin.read().split()
    i = 0
    N, q = int(d[0]), int(d[1]); i = 2
    sig = sigma_sieve(N)
    out = []
    for _ in range(q):
        x = int(d[i]); i += 1
        s = sig[x] - x
        out.append("perfect" if s == x else ("abundant" if s > x else "deficient"))
    print("\n".join(out))


main()
```

**Evaluation.** `6 → perfect`, `12 → abundant`, `16 → deficient`, `28 → perfect`.

---

### Task 5 — Sum of divisors over a range (prefix sums)

**Problem.** Sieve `σ`, build a prefix-sum array, then answer `q` queries "sum of `σ(i)` for `i ∈ [a, b]`" each in `O(1)`.

**Input / Output spec.** Input `N`, `q`, then `q` pairs `a b`. Output the sum per query (64-bit; may need bigger for very large ranges, but stay within 64-bit for these constraints).

**Constraints.** `1 ≤ N ≤ 2·10^6`, `1 ≤ q ≤ 10^5`, `1 ≤ a ≤ b ≤ N`.

**Hint.** `pref[i] = pref[i-1] + σ(i)`; answer `= pref[b] − pref[a-1]`.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var N, q int
	fmt.Scan(&N, &q)
	// TODO: sieve sigma, build pref []int64
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

public class Task5 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int N = sc.nextInt(), q = sc.nextInt();
        // TODO: sieve sigma into long[], build long[] pref
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
    N, q = int(next(d)), int(next(d))
    # TODO: sieve sigma, build prefix sums
    out = []
    for _ in range(q):
        a, b = int(next(d)), int(next(d))
        # TODO: out.append(str(pref[b] - pref[a-1]))
    print("\n".join(out))


main()
```

**Evaluation.** Sum of `σ` over `[1,10]` is `1+3+4+7+6+12+8+15+13+18 = 87`; over `[1,1]` is `1`; over `[6,6]` is `12`.

---

## Intermediate Tasks (5)

### Task 6 — Linear sieve for `d` and `σ` (`O(N)`)

**Problem.** Compute `d[m]` and `σ[m]` for all `m ≤ N` using the **linear sieve** with exponent tracking (true `O(N)`), then answer `q` queries.

**Input / Output spec.** Input `N`, `q`, then `q` values `x`. Output `d(x)` and `σ(x)`.

**Constraints.** `1 ≤ N ≤ 5·10^6`, `1 ≤ q ≤ 10^5`.

**Hint.** Track `cnt[n]` (exponent of smallest prime) and `spp[n] = σ(p^{cnt})`. Coprime case: `d=2·d[i]`, `σ=(p+1)·σ[i]`. Exponent-raise case: `d = d[i]/(cnt+1)*(cnt+2)`, `spp = p·spp[i]+1`, `σ = σ[i]/spp[i]*spp`.

**Starter — Go.**
```go
package main

import "fmt"

func linearDSigma(N int) ([]int, []int64) {
	// TODO: linear sieve with cnt[] and spp[]
	return nil, nil
}

func main() {
	var N, q int
	fmt.Scan(&N, &q)
	d, s := linearDSigma(N)
	for ; q > 0; q-- {
		var x int
		fmt.Scan(&x)
		fmt.Println(d[x], s[x])
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task6 {
    static int[] d;
    static long[] s;
    static void linearDSigma(int N) { /* TODO */ }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int N = sc.nextInt(), q = sc.nextInt();
        linearDSigma(N);
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) { int x = sc.nextInt(); sb.append(d[x]).append(' ').append(s[x]).append('\n'); }
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
def linear_d_sigma(N):
    # TODO: linear sieve, O(N)
    return [], []


if __name__ == "__main__":
    import sys
    it = iter(sys.stdin.read().split())
    N, q = int(next(it)), int(next(it))
    d, s = linear_d_sigma(N)
    print("\n".join(f"{d[int(next(it))]} {s[x]}" if False else "" for _ in range(0)))  # replace
    # Correct loop:
    out = []
    for _ in range(q):
        x = int(next(it))
        out.append(f"{d[x]} {s[x]}")
    print("\n".join(out))
```

**Evaluation.** Must match the `O(N log N)` divisor sieve for all `n ≤ N` (cross-check). `d(720)=30`, `σ(720)=2418`.

---

### Task 7 — Amicable pairs up to N

**Problem.** Find all amicable pairs `(a, b)` with `a < b ≤ N`: distinct numbers where `s(a) = b` and `s(b) = a` (with `s(x) = σ(x) − x`).

**Input / Output spec.** Input `N`; output each pair `a b` on its own line, sorted by `a`.

**Constraints.** `1 ≤ N ≤ 10^6`.

**Hint.** Sieve `σ`, compute `s[x] = σ(x) − x`. For each `a`, let `b = s[a]`; report if `b ≤ N`, `b != a`, `s[b] == a`, and `a < b`.

**Starter — Go.**
```go
package main

import "fmt"

func sigmaSieve(N int) []int64 { /* TODO */ return nil }

func main() {
	var N int
	fmt.Scan(&N)
	sig := sigmaSieve(N)
	s := make([]int64, N+1)
	for i := 1; i <= N; i++ {
		s[i] = sig[i] - int64(i)
	}
	// TODO: for each a, check b = s[a]
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task7 {
    static long[] sigmaSieve(int N) { /* TODO */ return new long[N + 1]; }
    public static void main(String[] args) {
        int N = new Scanner(System.in).nextInt();
        long[] sig = sigmaSieve(N);
        long[] s = new long[N + 1];
        for (int i = 1; i <= N; i++) s[i] = sig[i] - i;
        // TODO: report amicable pairs a < b
    }
}
```

**Starter — Python.**
```python
def sigma_sieve(N):
    # TODO
    return [0] * (N + 1)


if __name__ == "__main__":
    N = int(input())
    sig = sigma_sieve(N)
    s = [sig[i] - i for i in range(N + 1)]
    # TODO: for a in range(2, N+1): b = s[a]; check conditions
```

**Evaluation.** For `N = 1500`, output is `220 284` and `1184 1210`.

---

### Task 8 — Highly composite numbers up to N

**Problem.** Output every `n ≤ N` that has strictly more divisors than all smaller positive integers, together with its divisor count.

**Input / Output spec.** Input `N`; output each `n d(n)` on its own line, in increasing `n`.

**Constraints.** `1 ≤ N ≤ 10^6`.

**Hint.** Sieve `d`, scan `n` from `1` to `N`, keep a running max; emit `n` whenever `d[n]` beats the previous max.

**Starter — Go.**
```go
package main

import "fmt"

func dSieve(N int) []int { /* TODO */ return nil }

func main() {
	var N int
	fmt.Scan(&N)
	d := dSieve(N)
	best := 0
	for n := 1; n <= N; n++ {
		if d[n] > best {
			best = d[n]
			fmt.Println(n, d[n])
		}
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task8 {
    static int[] dSieve(int N) { /* TODO */ return new int[N + 1]; }
    public static void main(String[] args) {
        int N = new Scanner(System.in).nextInt();
        int[] d = dSieve(N);
        int best = 0;
        for (int n = 1; n <= N; n++) if (d[n] > best) { best = d[n]; System.out.println(n + " " + d[n]); }
    }
}
```

**Starter — Python.**
```python
def d_sieve(N):
    # TODO
    return [0] * (N + 1)


if __name__ == "__main__":
    N = int(input())
    d = d_sieve(N)
    best = 0
    for n in range(1, N + 1):
        if d[n] > best:
            best = d[n]
            print(n, d[n])
```

**Evaluation.** For `N = 60`: `1 1, 2 2, 4 3, 6 4, 12 6, 24 8, 36 9, 48 10, 60 12`.

---

### Task 9 — `σ_k` sieve

**Problem.** Given `k`, compute `σ_k(m) = Σ_{d∣m} d^k` for all `m ≤ N`, answer `q` queries. Output modulo `1_000_000_007`.

**Input / Output spec.** Input `N`, `k`, `q`, then `q` values `x`. Output `σ_k(x) mod 1e9+7`.

**Constraints.** `1 ≤ N ≤ 10^6`, `0 ≤ k ≤ 5`, `1 ≤ q ≤ 10^5`.

**Hint.** Divisor sieve: `sum[m] = (sum[m] + pow(d, k)) % MOD`. Precompute `pow(d,k)` per `d`. `σ₀ = d`, `σ₁ = σ`.

**Starter — Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func sigmaK(N, k int) []int64 {
	// TODO: divisor sieve accumulating d^k mod MOD
	return nil
}

func main() {
	var N, k, q int
	fmt.Scan(&N, &k, &q)
	sk := sigmaK(N, k)
	for ; q > 0; q-- {
		var x int
		fmt.Scan(&x)
		fmt.Println(sk[x])
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task9 {
    static final long MOD = 1_000_000_007L;
    static long[] sigmaK(int N, int k) { /* TODO */ return new long[N + 1]; }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int N = sc.nextInt(), k = sc.nextInt(), q = sc.nextInt();
        long[] sk = sigmaK(N, k);
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) sb.append(sk[sc.nextInt()]).append('\n');
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
MOD = 1_000_000_007


def sigma_k(N, k):
    # TODO: divisor sieve with d**k % MOD
    return [0] * (N + 1)


if __name__ == "__main__":
    import sys
    it = iter(sys.stdin.read().split())
    N, k, q = int(next(it)), int(next(it)), int(next(it))
    sk = sigma_k(N, k)
    print("\n".join(str(sk[int(next(it))]) for _ in range(q)))
```

**Evaluation.** `σ₀(6)=4`, `σ₁(6)=12`, `σ₂(6)=1+4+9+36=50`, `σ₂(10)=1+4+25+100=130`.

---

### Task 10 — Triangular number with over 500 divisors (Project Euler 12)

**Problem.** Find the first triangular number `T_n = n(n+1)/2` with more than `500` divisors. Use that `gcd(n, n+1)=1`, so `d(T_n)` factors via `d` of the two coprime halves.

**Input / Output spec.** Input a threshold `t`; output the first triangular number with `> t` divisors.

**Constraints.** `1 ≤ t ≤ 1000`.

**Hint.** `T_n = n(n+1)/2`. If `n` is even, `T_n = (n/2)·(n+1)` with coprime factors; else `T_n = n·((n+1)/2)`. Then `d(T_n) = d(a)·d(b)` for the coprime split. Compute `d` of each factor by trial division.

**Starter — Go.**
```go
package main

import "fmt"

func dOf(n int64) int64 {
	// TODO: number of divisors via trial division
	return 0
}

func main() {
	var t int64
	fmt.Scan(&t)
	for n := int64(1); ; n++ {
		var a, b int64
		if n%2 == 0 {
			a, b = n/2, n+1
		} else {
			a, b = n, (n+1)/2
		}
		if dOf(a)*dOf(b) > t {
			fmt.Println(a * b)
			return
		}
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task10 {
    static long dOf(long n) { /* TODO */ return 0; }
    public static void main(String[] args) {
        long t = new Scanner(System.in).nextLong();
        for (long n = 1; ; n++) {
            long a = (n % 2 == 0) ? n / 2 : n;
            long b = (n % 2 == 0) ? n + 1 : (n + 1) / 2;
            if (dOf(a) * dOf(b) > t) { System.out.println(a * b); return; }
        }
    }
}
```

**Starter — Python.**
```python
def d_of(n):
    # TODO: number of divisors via trial division
    return 0


if __name__ == "__main__":
    t = int(input())
    n = 1
    while True:
        a, b = (n // 2, n + 1) if n % 2 == 0 else (n, (n + 1) // 2)
        if d_of(a) * d_of(b) > t:
            print(a * b)
            break
        n += 1
```

**Evaluation.** For `t = 5`, the answer is `28` (`T_7`, divisors `1,2,4,7,14,28`). For `t = 500`, the answer is `76576500`.

---

## Advanced Tasks (5)

### Task 11 — `d`/`σ` for one huge `n` via precomputed base primes

**Problem.** Sieve base primes up to `√(MAX)` once (with `MAX = 10^{14}`), then answer `q` queries computing `d(x)` and `σ(x)` for `x ≤ 10^{14}` by trial-dividing with the base primes. Memory must be `O(√MAX)`.

**Input / Output spec.** Input `q`, then `q` values `x`. Output `d(x)` and `σ(x)` per query.

**Constraints.** `1 ≤ q ≤ 10^4`, `1 ≤ x ≤ 10^{14}`.

**Hint.** Base primes up to `10^7` suffice for `x ≤ 10^{14}`. After dividing out all base primes, a leftover `> 1` is a single prime (since any composite leftover would have a factor `≤ √x ≤ 10^7`). Handle that leftover prime.

**Starter — Go.**
```go
package main

import "fmt"

func basePrimes(limit int) []int { /* TODO: simple sieve */ return nil }

func dSigma(x int64, primes []int) (int64, int64) {
	// TODO: trial-divide by base primes; handle leftover prime
	return 0, 0
}

func main() {
	primes := basePrimes(10_000_000)
	var q int
	fmt.Scan(&q)
	for ; q > 0; q-- {
		var x int64
		fmt.Scan(&x)
		d, s := dSigma(x, primes)
		fmt.Println(d, s)
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task11 {
    static int[] basePrimes(int limit) { /* TODO */ return new int[0]; }
    static long[] dSigma(long x, int[] primes) { /* TODO */ return new long[]{0, 0}; }
    public static void main(String[] args) {
        int[] primes = basePrimes(10_000_000);
        Scanner sc = new Scanner(System.in);
        int q = sc.nextInt();
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) {
            long[] r = dSigma(sc.nextLong(), primes);
            sb.append(r[0]).append(' ').append(r[1]).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
def base_primes(limit):
    # TODO: simple sieve
    return []


def d_sigma(x, primes):
    # TODO: trial-divide by base primes; handle leftover prime
    return 0, 0


if __name__ == "__main__":
    import sys
    primes = base_primes(10_000_000)
    it = iter(sys.stdin.read().split())
    q = int(next(it))
    out = []
    for _ in range(q):
        x = int(next(it))
        d, s = d_sigma(x, primes)
        out.append(f"{d} {s}")
    print("\n".join(out))
```

**Evaluation.** `dSigma(999_999_999_999_989, ...)` (a prime) returns `(2, 999_999_999_999_990)`; `dSigma(100_000_000_000_000, ...) = dSigma(2^14·5^14, ...)` returns `(225, ...)` — verify against the formula.

---

### Task 12 — Count primes' contribution: numbers with exactly `K` divisors

**Problem.** Given `N` and `K`, count how many `n ≤ N` have exactly `K` divisors (`d(n) = K`).

**Input / Output spec.** Input `N`, `K`; output the count.

**Constraints.** `1 ≤ N ≤ 10^7`, `1 ≤ K ≤ 1000`.

**Hint.** Sieve `d` (use the divisor sieve or linear sieve), then count `n` with `d[n] == K`. Note `d(n)=2` ⇔ `n` prime, so this also counts primes when `K=2`.

**Starter — Go.**
```go
package main

import "fmt"

func dSieve(N int) []int { /* TODO */ return nil }

func main() {
	var N, K int
	fmt.Scan(&N, &K)
	d := dSieve(N)
	cnt := 0
	for n := 1; n <= N; n++ {
		if d[n] == K {
			cnt++
		}
	}
	fmt.Println(cnt)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task12 {
    static int[] dSieve(int N) { /* TODO */ return new int[N + 1]; }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int N = sc.nextInt(), K = sc.nextInt();
        int[] d = dSieve(N);
        int cnt = 0;
        for (int n = 1; n <= N; n++) if (d[n] == K) cnt++;
        System.out.println(cnt);
    }
}
```

**Starter — Python.**
```python
def d_sieve(N):
    # TODO
    return [0] * (N + 1)


if __name__ == "__main__":
    N, K = map(int, input().split())
    d = d_sieve(N)
    print(sum(1 for n in range(1, N + 1) if d[n] == K))
```

**Evaluation.** For `N=100, K=2` the count is `25` (primes ≤ 100). For `N=100, K=1` it is `1` (only `n=1`).

---

### Task 13 — Sum of `d(n)` up to N and the Dirichlet hyperbola method

**Problem.** Compute `D(N) = Σ_{n=1}^{N} d(n)` in `O(√N)` using the hyperbola method, *without* a full sieve. Verify it matches `Σ ⌊N/i⌋`.

**Input / Output spec.** Input `N`; output `D(N)`.

**Constraints.** `1 ≤ N ≤ 10^{12}`.

**Hint.** `D(N) = Σ_{i=1}^{N} ⌊N/i⌋ = 2·Σ_{i=1}^{⌊√N⌋} ⌊N/i⌋ − ⌊√N⌋²` (count lattice points under the hyperbola `xy ≤ N`, doubling the region below the diagonal and subtracting the square counted twice).

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

func D(N int64) int64 {
	s := int64(math.Sqrt(float64(N)))
	for s*s > N {
		s--
	}
	for (s+1)*(s+1) <= N {
		s++
	}
	// TODO: 2*sum_{i=1..s} floor(N/i) - s*s
	return 0
}

func main() {
	var N int64
	fmt.Scan(&N)
	fmt.Println(D(N))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task13 {
    static long D(long N) {
        long s = (long) Math.sqrt((double) N);
        while (s * s > N) s--;
        while ((s + 1) * (s + 1) <= N) s++;
        // TODO: 2*sum floor(N/i) - s*s
        return 0;
    }
    public static void main(String[] args) {
        System.out.println(D(new Scanner(System.in).nextLong()));
    }
}
```

**Starter — Python.**
```python
import math


def D(N):
    s = math.isqrt(N)
    # TODO: 2*sum(N//i for i in 1..s) - s*s
    return 0


if __name__ == "__main__":
    print(D(int(input())))
```

**Evaluation.** `D(10)=27`, `D(100)=482`, `D(1000)=7069`. Cross-check small `N` against a brute `Σ d(n)`.

---

### Task 14 — Robin's inequality probe

**Problem.** For all `n` in `[2, N]`, find any `n > 5040` violating Robin's inequality `σ(n) < e^γ · n · ln(ln(n))` (none should exist if RH holds). Report violators or "none".

**Input / Output spec.** Input `N`; output each violating `n`, or `none`.

**Constraints.** `5041 ≤ N ≤ 5·10^6`.

**Hint.** Sieve `σ` (64-bit). Use `e^γ ≈ 1.7810724179901979`. Compare `σ(n)` (as a float) to `EGAMMA * n * math.log(math.log(n))`. Watch float precision near the boundary.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

const eGamma = 1.7810724179901979

func sigmaSieve(N int) []int64 { /* TODO */ return nil }

func main() {
	var N int
	fmt.Scan(&N)
	sig := sigmaSieve(N)
	any := false
	for n := 5041; n <= N; n++ {
		bound := eGamma * float64(n) * math.Log(math.Log(float64(n)))
		if float64(sig[n]) >= bound {
			fmt.Println(n)
			any = true
		}
	}
	if !any {
		fmt.Println("none")
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task14 {
    static final double E_GAMMA = 1.7810724179901979;
    static long[] sigmaSieve(int N) { /* TODO */ return new long[N + 1]; }
    public static void main(String[] args) {
        int N = new Scanner(System.in).nextInt();
        long[] sig = sigmaSieve(N);
        boolean any = false;
        for (int n = 5041; n <= N; n++) {
            double bound = E_GAMMA * n * Math.log(Math.log(n));
            if (sig[n] >= bound) { System.out.println(n); any = true; }
        }
        if (!any) System.out.println("none");
    }
}
```

**Starter — Python.**
```python
import math

E_GAMMA = 1.7810724179901979


def sigma_sieve(N):
    # TODO
    return [0] * (N + 1)


if __name__ == "__main__":
    N = int(input())
    sig = sigma_sieve(N)
    any_viol = False
    for n in range(5041, N + 1):
        bound = E_GAMMA * n * math.log(math.log(n))
        if sig[n] >= bound:
            print(n)
            any_viol = True
    if not any_viol:
        print("none")
```

**Evaluation.** For any `N ≤ 5·10^6`, the output should be `none` (no violator above 5040 is known; `5040` itself is the largest violator). This demonstrates `σ`'s extremal order in practice.

---

### Task 15 — Benchmark: divisor sieve vs linear sieve

**Problem.** Compare the `O(N log N)` divisor sieve against the `O(N)` linear sieve for computing `d`/`σ`, across increasing `N`. Validate both produce identical arrays, then report timings.

**Input / Output spec.** No input; print `N` and the time for each method.

**Constraints.** Test `N ∈ {10^5, 10^6, 5·10^6}`. Both methods must agree on all values.

**Hint.** Build both arrays, assert equality, then time each. Observe where the linear sieve's `O(N)` overtakes the divisor sieve's `O(N log N)` (and note the divisor sieve's better cache behavior at moderate `N`).

**Starter — Go.**
```go
package main

import (
	"fmt"
	"time"
)

func divisorSieve(N int) ([]int, []int64) { /* TODO */ return nil, nil }
func linearSieve(N int) ([]int, []int64)  { /* TODO */ return nil, nil }

func main() {
	for _, N := range []int{100_000, 1_000_000, 5_000_000} {
		t1 := time.Now()
		d1, s1 := divisorSieve(N)
		dt1 := time.Since(t1)
		t2 := time.Now()
		d2, s2 := linearSieve(N)
		dt2 := time.Since(t2)
		ok := true
		for i := 1; i <= N; i++ {
			if d1[i] != d2[i] || s1[i] != s2[i] {
				ok = false
				break
			}
		}
		fmt.Printf("N=%8d  divisor=%v  linear=%v  agree=%v\n", N, dt1, dt2, ok)
	}
}
```

**Starter — Java.**
```java
public class Task15 {
    static int[] d; static long[] s;
    static void divisorSieve(int N) { /* TODO */ }
    static int[] d2; static long[] s2;
    static void linearSieve(int N) { /* TODO */ }
    public static void main(String[] args) {
        for (int N : new int[]{100_000, 1_000_000, 5_000_000}) {
            long t1 = System.nanoTime(); divisorSieve(N); long dt1 = System.nanoTime() - t1;
            long t2 = System.nanoTime(); linearSieve(N);  long dt2 = System.nanoTime() - t2;
            boolean ok = true;
            for (int i = 1; i <= N; i++) if (d[i] != d2[i] || s[i] != s2[i]) { ok = false; break; }
            System.out.printf("N=%8d  divisor=%.1fms  linear=%.1fms  agree=%b%n",
                N, dt1 / 1e6, dt2 / 1e6, ok);
        }
    }
}
```

**Starter — Python.**
```python
import time


def divisor_sieve(N):  # TODO
    return [], []


def linear_sieve(N):  # TODO
    return [], []


if __name__ == "__main__":
    for N in (100_000, 1_000_000, 5_000_000):
        t1 = time.perf_counter(); d1, s1 = divisor_sieve(N); dt1 = time.perf_counter() - t1
        t2 = time.perf_counter(); d2, s2 = linear_sieve(N); dt2 = time.perf_counter() - t2
        ok = d1 == d2 and s1 == s2
        print(f"N={N:8d}  divisor={dt1*1000:.1f}ms  linear={dt2*1000:.1f}ms  agree={ok}")
```

**Evaluation.** Both methods must agree on all values. Report timings; expect the linear sieve to win at large `N`, while the divisor sieve may be competitive (better cache locality) at moderate `N`.

---

## Evaluation Criteria (All Tasks)

- **Correctness on small inputs first.** Validate against the closed-form formulas and a brute-force divisor walk before scaling up.
- **Edge cases.** Handle `n = 1` (`d=σ=1`, empty product), primes, prime powers, and perfect squares (count `√n` once when pairing).
- **Integer width.** Always 64-bit for `σ` and `σ_k`; the leftover-prime tail after trial division is mandatory.
- **Complexity.** Single-number tasks should hit `O(√n)`; all-`n` tasks `O(N log N)` (divisor sieve) or `O(N)` (linear sieve); range sums `O(1)` via prefix sums.
- **Modular care.** Under a modulus, accumulate the geometric sum by addition; do not use the division closed form without a verified modular inverse.
- **Validation.** Cross-check `d(360)=24`, `σ(360)=1170`, `σ(6)=12`, and perfect numbers `6,28,496,8128`; a sieve can be wrong on a single value among millions.

Work through the tasks in order: Tasks 1–5 cement single-number computation and the divisor sieve, Tasks 6–10 add the linear sieve, amicable/highly-composite numbers, `σ_k`, and a classic problem, and Tasks 11–15 push into huge-`n` per-query factorization, the hyperbola method, asymptotics probes, and benchmarking.
