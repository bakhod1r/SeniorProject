# Factorial modulo a Prime — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec or starter code in all three languages. Implement the modular-arithmetic logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle on small inputs** — compare against `math.comb(n, k) % p` (Python) or a Pascal's-triangle build, and verify `fact[i]·invfact[i] ≡ 1 (mod p)`.

---

## Beginner Tasks (5)

### Task 1 — Factorial table mod p

**Problem.** Build `fact[0..N]` with `fact[i] = i! mod p` using one forward loop, and print `fact[N]`.

**Input / Output spec.**
- Read `N`, `p`. Print `N! mod p`.

**Constraints.**
- `0 ≤ N ≤ 10^6`, `2 ≤ p ≤ 10^9` prime, `N < p`.

**Hint.** `fact[0] = 1`; `fact[i] = fact[i-1]*i % p`; reduce after every multiply.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var N int
	var p int64
	fmt.Scan(&N, &p)
	fact := make([]int64, N+1)
	fact[0] = 1
	// TODO: fill fact[i] = i! mod p
	fmt.Println(fact[N])
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int N = sc.nextInt();
        long p = sc.nextLong();
        long[] fact = new long[N + 1];
        fact[0] = 1;
        // TODO
        System.out.println(fact[N]);
    }
}
```

**Starter — Python.**
```python
import sys


def main():
    N, p = map(int, sys.stdin.read().split())
    fact = [1] * (N + 1)
    # TODO
    print(fact[N])


if __name__ == "__main__":
    main()
```

**Evaluation.** Matches a direct `math.factorial(N) % p` for `N ≤ 1000`; `fact[0] == 1`.

---

### Task 2 — Inverse-factorial table (one inverse, backward)

**Problem.** Given `fact[0..N]` (Task 1), build `invfact[0..N]` using one modular inverse and a backward recurrence. Print `invfact[N]` and verify `fact[N]*invfact[N] % p == 1`.

**Input / Output spec.**
- Read `N`, `p`. Print `invfact[N]` then the verification (`1` if correct).

**Constraints.**
- `1 ≤ N ≤ 10^6`, `2 ≤ p ≤ 10^9` prime, `N < p`.

**Hint.** `invfact[N] = pow(fact[N], p-2, p)`; then `invfact[i-1] = invfact[i]*i % p` for `i = N..1`.

**Starter — Go.**
```go
package main

import "fmt"

func powMod(a, e, m int64) int64 { /* binary exponentiation */ return 0 }

func main() {
	var N int
	var p int64
	fmt.Scan(&N, &p)
	fact := make([]int64, N+1)
	fact[0] = 1
	for i := 1; i <= N; i++ {
		fact[i] = fact[i-1] * int64(i) % p
	}
	invfact := make([]int64, N+1)
	// TODO: one inverse then backward recurrence
	fmt.Println(invfact[N], fact[N]*invfact[N]%p)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task2 {
    static long powMod(long a, long e, long m) { /* TODO */ return 0; }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int N = sc.nextInt();
        long p = sc.nextLong();
        long[] fact = new long[N + 1];
        fact[0] = 1;
        for (int i = 1; i <= N; i++) fact[i] = fact[i - 1] * i % p;
        long[] invfact = new long[N + 1];
        // TODO
        System.out.println(invfact[N] + " " + fact[N] * invfact[N] % p);
    }
}
```

**Starter — Python.**
```python
import sys


def main():
    N, p = map(int, sys.stdin.read().split())
    fact = [1] * (N + 1)
    for i in range(1, N + 1):
        fact[i] = fact[i - 1] * i % p
    invfact = [1] * (N + 1)
    # TODO: invfact[N] = pow(...); backward loop
    print(invfact[N], fact[N] * invfact[N] % p)


if __name__ == "__main__":
    main()
```

**Evaluation.** `fact[i]*invfact[i] % p == 1` for all `i` (test a sample); the printed verification is `1`.

---

### Task 3 — Binomial coefficient mod p

**Problem.** After precomputing the tables, answer `C(n, k) mod p`. Return `0` for `k < 0` or `k > n`.

**Input / Output spec.**
- Read `N`, `p`, then `q` queries each `(n, k)`. Print each `C(n, k) mod p`.

**Constraints.**
- `1 ≤ N ≤ 10^6`, `2 ≤ p ≤ 10^9` prime, `0 ≤ n ≤ N < p`, `1 ≤ q ≤ 10^5`.

**Hint.** `binom(n,k) = fact[n]*invfact[k]%p*invfact[n-k]%p` if `0 ≤ k ≤ n` else `0`.

**Starter — Python.**
```python
import sys


def main():
    data = sys.stdin.read().split()
    idx = 0
    N, p, q = int(data[0]), int(data[1]), int(data[2])
    idx = 3
    fact = [1] * (N + 1)
    for i in range(1, N + 1):
        fact[i] = fact[i - 1] * i % p
    invfact = [1] * (N + 1)
    invfact[N] = pow(fact[N], p - 2, p)
    for i in range(N, 0, -1):
        invfact[i - 1] = invfact[i] * i % p

    def binom(n, k):
        # TODO: return C(n,k) mod p with guards
        return 0

    out = []
    for _ in range(q):
        n, k = int(data[idx]), int(data[idx + 1])
        idx += 2
        out.append(str(binom(n, k)))
    print("\n".join(out))


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

var fact, invfact []int64
var p int64

func binom(n, k int) int64 {
	// TODO
	return 0
}

func main() {
	var N, q int
	fmt.Scan(&N, &p, &q)
	// TODO: precompute fact, invfact
	for ; q > 0; q-- {
		var n, k int
		fmt.Scan(&n, &k)
		fmt.Println(binom(n, k))
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task3 {
    static long[] fact, invfact;
    static long p;

    static long binom(int n, int k) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int N = sc.nextInt();
        p = sc.nextLong();
        int q = sc.nextInt();
        // TODO: precompute
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) {
            int n = sc.nextInt(), k = sc.nextInt();
            sb.append(binom(n, k)).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Evaluation.** Matches `math.comb(n, k) % p` for all queries with small `n`; `C(n, 0) == 1`, `C(n, n) == 1`, `C(n, k>n) == 0`.

---

### Task 4 — Verify Wilson's theorem

**Problem.** Given a prime `p`, print `1` if `(p-1)! ≡ -1 (mod p)` (i.e. `fact[p-1] == p-1`), else `0`.

**Input / Output spec.**
- Read `p`. Print `1` or `0`.

**Constraints.**
- `2 ≤ p ≤ 2·10^6` prime.

**Hint.** Build `fact` up to `p-1` and compare `fact[p-1]` to `p-1` (i.e. `-1 mod p`).

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var p int64
	fmt.Scan(&p)
	f := int64(1)
	for i := int64(2); i <= p-1; i++ {
		f = f * i % p
	}
	// TODO: print 1 if f == p-1 else 0
	_ = f
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task4 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long p = sc.nextLong();
        long f = 1;
        for (long i = 2; i <= p - 1; i++) f = f * i % p;
        // TODO
        System.out.println(f == p - 1 ? 1 : 0);
    }
}
```

**Starter — Python.**
```python
import sys


def main():
    p = int(sys.stdin.read())
    f = 1
    for i in range(2, p):
        f = f * i % p
    print(1 if f == p - 1 else 0)


if __name__ == "__main__":
    main()
```

**Evaluation.** Prints `1` for every prime `p`.

---

### Task 5 — Legendre's formula

**Problem.** Given `n` and a prime `p`, print the exponent of `p` in `n!`, i.e. `v_p(n!) = Σ ⌊n/p^i⌋`.

**Input / Output spec.**
- Read `n`, `p`. Print `v_p(n!)`.

**Constraints.**
- `0 ≤ n ≤ 10^18`, `2 ≤ p ≤ 10^9` prime.

**Hint.** Loop `while n: n //= p; e += n`.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var n, p int64
	fmt.Scan(&n, &p)
	var e int64
	// TODO: e = sum of floor(n / p^i)
	fmt.Println(e)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task5 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long n = sc.nextLong(), p = sc.nextLong(), e = 0;
        // TODO
        System.out.println(e);
    }
}
```

**Starter — Python.**
```python
import sys


def main():
    n, p = map(int, sys.stdin.read().split())
    e = 0
    # TODO
    print(e)


if __name__ == "__main__":
    main()
```

**Evaluation.** For small `n`, matches factoring `n!` directly; `v_2(10!) == 8`, `v_5(100!) == 24`.

---

## Intermediate Tasks (5)

### Task 6 — Kummer carry / zero test

**Problem.** Given `n`, `k`, and a prime `p`, print `v_p(C(n, k))` (the number of carries when adding `k` and `n-k` in base `p`). Print `0` exactly when `C(n, k)` is *not* divisible by `p`.

**Input / Output spec.**
- Read `n`, `k`, `p`. Print `v_p(C(n, k))`.

**Constraints.**
- `0 ≤ k ≤ n ≤ 10^18`, `2 ≤ p ≤ 10^9` prime.

**Hint.** `v_p(C) = v_p(n!) - v_p(k!) - v_p((n-k)!)` (Legendre), or count carries directly.

**Starter — Python.**
```python
import sys


def vp_fact(n, p):
    e = 0
    while n:
        n //= p
        e += n
    return e


def main():
    n, k, p = map(int, sys.stdin.read().split())
    # TODO: return vp(n!) - vp(k!) - vp((n-k)!)
    print(0)


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

func vpFact(n, p int64) int64 {
	var e int64
	for n > 0 {
		n /= p
		e += n
	}
	return e
}

func main() {
	var n, k, p int64
	fmt.Scan(&n, &k, &p)
	// TODO
	fmt.Println(0)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task6 {
    static long vpFact(long n, long p) {
        long e = 0;
        while (n > 0) { n /= p; e += n; }
        return e;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long n = sc.nextLong(), k = sc.nextLong(), p = sc.nextLong();
        // TODO
        System.out.println(0);
    }
}
```

**Evaluation.** For small `n, k`, the carry count equals `v_p(math.comb(n,k))`; the value is `0` iff `C(n,k) % p != 0`.

---

### Task 7 — Lucas' theorem (`n ≥ p`)

**Problem.** Compute `C(n, k) mod p` for a small prime `p` and arbitrary `n` using Lucas' theorem.

**Input / Output spec.**
- Read `n`, `k`, `p`. Print `C(n, k) mod p`.

**Constraints.**
- `2 ≤ p ≤ 10^6` prime, `0 ≤ k ≤ n ≤ 10^18`.

**Hint.** Build size-`p` factorial tables; multiply `C(n_j, k_j)` over base-`p` digits; `0` if any `k_j > n_j`.

**Starter — Python.**
```python
import sys


def lucas(n, k, p):
    fact = [1] * p
    for i in range(1, p):
        fact[i] = fact[i - 1] * i % p

    def small_c(a, b):
        # TODO: C(a,b) mod p for 0<=b<=a<p, else 0
        return 0

    res = 1
    while n or k:
        res = res * small_c(n % p, k % p) % p
        n //= p
        k //= p
    return res


def main():
    n, k, p = map(int, sys.stdin.read().split())
    print(lucas(n, k, p))


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

func powMod(a, e, m int64) int64 { /* TODO */ return 0 }

func lucas(n, k, p int64) int64 {
	// TODO: size-p tables, product over base-p digits
	return 0
}

func main() {
	var n, k, p int64
	fmt.Scan(&n, &k, &p)
	fmt.Println(lucas(n, k, p))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task7 {
    static long powMod(long a, long e, long m) { /* TODO */ return 0; }

    static long lucas(long n, long k, long p) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long n = sc.nextLong(), k = sc.nextLong(), p = sc.nextLong();
        System.out.println(lucas(n, k, p));
    }
}
```

**Evaluation.** Matches `math.comb(n, k) % p` for `n` up to a few thousand and small `p`; `C(5,2) mod 3 == 1`.

---

### Task 8 — Catalan numbers mod p

**Problem.** Print the `n`-th Catalan number `Cat(n) = C(2n, n)/(n+1) mod p`.

**Input / Output spec.**
- Read `n`, `p`. Print `Cat(n) mod p`.

**Constraints.**
- `0 ≤ n ≤ 5·10^5`, `2 ≤ p ≤ 10^9` prime, `2n < p`.

**Hint.** Precompute to `2n`. `Cat(n) = fact[2n]*invfact[n]%p*invfact[n]%p * inv(n+1) % p`, where `inv(n+1) = pow(n+1, p-2, p)`.

**Starter — Python.**
```python
import sys


def main():
    n, p = map(int, sys.stdin.read().split())
    N = 2 * n
    fact = [1] * (N + 1)
    for i in range(1, N + 1):
        fact[i] = fact[i - 1] * i % p
    invfact = [1] * (N + 1)
    invfact[N] = pow(fact[N], p - 2, p)
    for i in range(N, 0, -1):
        invfact[i - 1] = invfact[i] * i % p
    # TODO: Cat(n) = C(2n,n) * inv(n+1) mod p
    print(0)


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

func powMod(a, e, m int64) int64 { /* TODO */ return 0 }

func main() {
	var n int
	var p int64
	fmt.Scan(&n, &p)
	// TODO: precompute to 2n, compute Catalan
	fmt.Println(0)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task8 {
    static long powMod(long a, long e, long m) { /* TODO */ return 0; }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long p = sc.nextLong();
        // TODO
        System.out.println(0);
    }
}
```

**Evaluation.** `Cat(0..6) = 1, 1, 2, 5, 14, 42, 132` (mod `p`); cross-check with the recurrence `Cat(n+1) = Cat(n)·2(2n+1)/(n+2)`.

---

### Task 9 — Multinomial coefficient mod p

**Problem.** Given `r` group sizes `k_1, …, k_r` with `Σ k_i = n`, print the multinomial `n!/(k_1!⋯k_r!) mod p`.

**Input / Output spec.**
- Read `p`, `r`, then `r` sizes. Print the multinomial mod `p`.

**Constraints.**
- `2 ≤ p ≤ 10^9` prime, `1 ≤ r ≤ 10^5`, `Σ k_i = n < p`.

**Hint.** `multinom = fact[n] * ∏_i invfact[k_i] % p`, where `n = Σ k_i`.

**Starter — Python.**
```python
import sys


def main():
    data = list(map(int, sys.stdin.read().split()))
    p, r = data[0], data[1]
    ks = data[2:2 + r]
    n = sum(ks)
    fact = [1] * (n + 1)
    for i in range(1, n + 1):
        fact[i] = fact[i - 1] * i % p
    invfact = [1] * (n + 1)
    invfact[n] = pow(fact[n], p - 2, p)
    for i in range(n, 0, -1):
        invfact[i - 1] = invfact[i] * i % p
    # TODO: fact[n] * product(invfact[k]) mod p
    print(0)


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

func powMod(a, e, m int64) int64 { /* TODO */ return 0 }

func main() {
	var p int64
	var r int
	fmt.Scan(&p, &r)
	ks := make([]int, r)
	n := 0
	for i := range ks {
		fmt.Scan(&ks[i])
		n += ks[i]
	}
	// TODO: precompute to n, compute multinomial
	fmt.Println(0)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task9 {
    static long powMod(long a, long e, long m) { /* TODO */ return 0; }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long p = sc.nextLong();
        int r = sc.nextInt();
        int[] ks = new int[r];
        int n = 0;
        for (int i = 0; i < r; i++) { ks[i] = sc.nextInt(); n += ks[i]; }
        // TODO
        System.out.println(0);
    }
}
```

**Evaluation.** For `r = 2` it equals `C(n, k_1)`; for `(2,1,1)` with `n=4` it is `4!/(2!1!1!) = 12 mod p`.

---

### Task 10 — Number of trailing zeros of `n!` in base b

**Problem.** Given `n` and a base `b`, print the number of trailing zeros of `n!` written in base `b`.

**Input / Output spec.**
- Read `n`, `b`. Print the trailing-zero count.

**Constraints.**
- `0 ≤ n ≤ 10^18`, `2 ≤ b ≤ 10^6`.

**Hint.** Factor `b = ∏ p_i^{a_i}`; answer `= min_i ⌊v_{p_i}(n!)/a_i⌋` (Legendre per prime). For decimal it reduces to `v_5(n!)`.

**Starter — Python.**
```python
import sys


def vp_fact(n, p):
    e = 0
    while n:
        n //= p
        e += n
    return e


def main():
    n, b = map(int, sys.stdin.read().split())
    # TODO: factor b, take min over primes of vp(n!)//exponent
    print(0)


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

func vpFact(n, p int64) int64 {
	var e int64
	for n > 0 {
		n /= p
		e += n
	}
	return e
}

func main() {
	var n, b int64
	fmt.Scan(&n, &b)
	// TODO
	fmt.Println(0)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task10 {
    static long vpFact(long n, long p) {
        long e = 0;
        while (n > 0) { n /= p; e += n; }
        return e;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long n = sc.nextLong(), b = sc.nextLong();
        // TODO
        System.out.println(0);
    }
}
```

**Evaluation.** `100!` has 24 trailing zeros in base 10; `8!` has 7 trailing zeros in base 2 (`v_2(8!) = 7`).

---

## Advanced Tasks (5)

### Task 11 — `C(n, k) mod p^e` via Granville

**Problem.** Compute `C(n, k) mod p^e` for a prime power, handling the `c ≥ e` zero case.

**Input / Output spec.**
- Read `n`, `k`, `p`, `e`. Print `C(n, k) mod p^e`.

**Constraints.**
- `0 ≤ k ≤ n ≤ 10^18`, `2 ≤ p`, `1 ≤ e`, `p^e ≤ 10^7`.

**Hint.** `c = v_p(n!) - v_p(k!) - v_p((n-k)!)`; if `c ≥ e` return `0`; else `p^c · G(n)·G(k)^(-1)·G(n-k)^(-1) mod p^e`, with `G` the `p`-free factorial mod `p^e` (block products + recursion).

**Starter — Python.**
```python
import sys


def vp_fact(n, p):
    e = 0
    while n:
        n //= p
        e += n
    return e


def factmod_pe(n, p, pe):
    if n == 0:
        return 1
    block = 1
    for i in range(1, pe):
        if i % p:
            block = block * i % pe
    res = pow(block, n // pe, pe)
    for i in range(1, n % pe + 1):
        if i % p:
            res = res * i % pe
    return res * factmod_pe(n // p, p, pe) % pe


def binom_pe(n, k, p, e):
    pe = p ** e
    c = vp_fact(n, p) - vp_fact(k, p) - vp_fact(n - k, p)
    if c >= e:
        return 0
    # TODO: p^c * G(n) * inv(G(k)*G(n-k)) mod pe
    return 0


def main():
    n, k, p, e = map(int, sys.stdin.read().split())
    print(binom_pe(n, k, p, e))


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

func vpFact(n, p int64) int64 { /* TODO */ return 0 }
func factmodPe(n, p, pe int64) int64 { /* TODO: blocks + recursion */ return 1 }

func binomPe(n, k, p, e int64) int64 {
	// TODO
	return 0
}

func main() {
	var n, k, p, e int64
	fmt.Scan(&n, &k, &p, &e)
	fmt.Println(binomPe(n, k, p, e))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task11 {
    static long vpFact(long n, long p) { /* TODO */ return 0; }
    static long factmodPe(long n, long p, long pe) { /* TODO */ return 1; }

    static long binomPe(long n, long k, long p, long e) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long n = sc.nextLong(), k = sc.nextLong(), p = sc.nextLong(), e = sc.nextLong();
        System.out.println(binomPe(n, k, p, e));
    }
}
```

**Evaluation.** For small `n`, matches `math.comb(n, k) % p**e`; `C(10,3) mod 27 == 12`, `C(10,3) mod 8 == 0`.

---

### Task 12 — `C(n, k) mod m` for composite m (CRT)

**Problem.** Compute `C(n, k) mod m` for an arbitrary composite `m` by factoring `m`, solving each prime power (Task 11), and combining via CRT.

**Input / Output spec.**
- Read `n`, `k`, `m`. Print `C(n, k) mod m`.

**Constraints.**
- `0 ≤ k ≤ n ≤ 10^18`, `2 ≤ m ≤ 10^7`.

**Hint.** Factor `m = ∏ p_i^{e_i}`; compute `r_i = C(n,k) mod p_i^{e_i}`; CRT-merge `(r_i mod p_i^{e_i})`.

**Starter — Python.**
```python
import sys
from math import gcd


def crt(r1, m1, r2, m2):
    # TODO: combine x ≡ r1 (mod m1), x ≡ r2 (mod m2); assumes gcd(m1,m2)=1
    return 0


def main():
    n, k, m = map(int, sys.stdin.read().split())
    # TODO: factor m, solve each p^e (reuse Task 11), CRT-merge
    print(0)


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var n, k, m int64
	fmt.Scan(&n, &k, &m)
	// TODO: factor m, per-prime-power binom, CRT
	fmt.Println(0)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task12 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long n = sc.nextLong(), k = sc.nextLong(), m = sc.nextLong();
        // TODO
        System.out.println(0);
    }
}
```

**Evaluation.** Matches `math.comb(n, k) % m` for small `n` and any composite `m`; `C(10,3) mod 1000 == 120`.

---

### Task 13 — Batch binomial queries with one shared table

**Problem.** Build the tables once, then answer `q` queries `(n_i, k_i)` for `C(n_i, k_i) mod p`. Maximize throughput.

**Input / Output spec.**
- Read `N`, `p`, `q`, then `q` pairs. Print the `q` results (buffered output).

**Constraints.**
- `1 ≤ N ≤ 2·10^6`, `2 ≤ p ≤ 10^9` prime, `1 ≤ q ≤ 5·10^6`, `0 ≤ n_i ≤ N`.

**Hint.** Precompute once; use buffered I/O; each query is three multiplies. No per-query inversion.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"os"
	"strconv"
)

func main() {
	reader := bufio.NewReader(os.Stdin)
	writer := bufio.NewWriter(os.Stdout)
	defer writer.Flush()
	_ = reader
	_ = strconv.Itoa
	// TODO: read N, p, q; precompute; answer queries with buffered output
}
```

**Starter — Java.**
```java
import java.io.*;
import java.util.*;

public class Task13 {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringBuilder sb = new StringBuilder();
        // TODO: parse N, p, q; precompute; answer queries
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    # TODO: parse, precompute, answer queries; write joined output once
    sys.stdout.write("")


if __name__ == "__main__":
    main()
```

**Evaluation.** All results match `math.comb` on small inputs; the program handles `q = 5·10^6` within time limits (buffered I/O is essential).

---

### Task 14 — Exact `C(n, k)` via multi-prime CRT

**Problem.** Compute the *exact* (non-modular) value of `C(n, k)` for moderate `n` by computing it mod several primes and CRT-reconstructing.

**Input / Output spec.**
- Read `n`, `k`. Print the exact `C(n, k)`.

**Constraints.**
- `0 ≤ k ≤ n ≤ 3000` (so the value fits in the product of ~4 primes near `10^9`).

**Hint.** Pick distinct primes `p_1, …, p_r` with `∏ p_i > C(n,k)`; compute `C mod p_i` (tables); CRT-merge to the exact integer.

**Starter — Python.**
```python
import sys


def binom_mod(n, k, p):
    fact = [1] * (n + 1)
    for i in range(1, n + 1):
        fact[i] = fact[i - 1] * i % p
    invfact = [1] * (n + 1)
    invfact[n] = pow(fact[n], p - 2, p)
    for i in range(n, 0, -1):
        invfact[i - 1] = invfact[i] * i % p
    if k < 0 or k > n:
        return 0
    return fact[n] * invfact[k] % p * invfact[n - k] % p


def main():
    n, k = map(int, sys.stdin.read().split())
    primes = [1_000_000_007, 998_244_353, 1_000_000_009, 1_000_000_021]
    # TODO: CRT-merge binom_mod(n,k,p) over primes into the exact integer
    print(0)


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math/big"
)

func main() {
	var n, k int
	fmt.Scan(&n, &k)
	_ = big.NewInt
	// TODO: per-prime binom, CRT with big.Int reconstruction
	fmt.Println(0)
}
```

**Starter — Java.**
```java
import java.util.*;
import java.math.BigInteger;

public class Task14 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), k = sc.nextInt();
        // TODO: per-prime residues, CRT with BigInteger
        System.out.println(BigInteger.ZERO);
    }
}
```

**Evaluation.** Matches `math.comb(n, k)` exactly (Python big-int) / `BigInteger` for all `n ≤ 3000`; verify `C(3000, 1500)` against a reference.

---

### Task 15 — Sierpiński / odd entries of Pascal's triangle

**Problem.** For a given row `n`, print the number of *odd* entries `C(n, 0), …, C(n, n)` (i.e. those with `C(n, k) mod 2 = 1`).

**Input / Output spec.**
- Read `n`. Print the count of odd entries in row `n`.

**Constraints.**
- `0 ≤ n ≤ 10^18`.

**Hint.** By Kummer/Lucas at `p = 2`, `C(n, k)` is odd iff `k` is a submask of `n` in binary. The count equals `2^(popcount(n))`.

**Starter — Python.**
```python
import sys


def main():
    n = int(sys.stdin.read())
    # TODO: count odd entries = 2^(number of 1-bits in n)
    print(0)


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

func main() {
	var n uint64
	fmt.Scan(&n)
	_ = bits.OnesCount64
	// TODO: print 1 << popcount(n)
	fmt.Println(0)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task15 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long n = sc.nextLong();
        // TODO: print 1L << Long.bitCount(n)
        System.out.println(0);
    }
}
```

**Evaluation.** Row 0 → 1 odd; row 4 (`100`) → 2 odd (`1,1`); row 7 (`111`) → 8 odd (all). Matches a brute-force count of odd `C(n,k)` for `n ≤ 20`.

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

const MOD = int64(1_000_000_007)

func main() {
	sizes := []int{1000, 10000, 100000, 1000000}
	for _, N := range sizes {
		start := time.Now()
		fact := make([]int64, N+1)
		fact[0] = 1
		for i := 1; i <= N; i++ {
			fact[i] = fact[i-1] * int64(i) % MOD
		}
		invfact := make([]int64, N+1)
		r := int64(1)
		a := fact[N]
		for e := MOD - 2; e > 0; e >>= 1 {
			if e&1 == 1 {
				r = r * a % MOD
			}
			a = a * a % MOD
		}
		invfact[N] = r
		for i := N; i >= 1; i-- {
			invfact[i-1] = invfact[i] * int64(i) % MOD
		}
		fmt.Printf("N=%8d: %v\n", N, time.Since(start))
	}
}
```

#### Java

```java
public class Benchmark {
    static final long MOD = 1_000_000_007L;

    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000, 1000000};
        for (int N : sizes) {
            long start = System.nanoTime();
            long[] fact = new long[N + 1];
            fact[0] = 1;
            for (int i = 1; i <= N; i++) fact[i] = fact[i - 1] * i % MOD;
            long[] invfact = new long[N + 1];
            long r = 1, a = fact[N];
            for (long e = MOD - 2; e > 0; e >>= 1) {
                if ((e & 1) == 1) r = r * a % MOD;
                a = a * a % MOD;
            }
            invfact[N] = r;
            for (int i = N; i >= 1; i--) invfact[i - 1] = invfact[i] * i % MOD;
            System.out.printf("N=%8d: %.3f ms%n", N, (System.nanoTime() - start) / 1e6);
        }
    }
}
```

#### Python

```python
import time

MOD = 1_000_000_007

for N in (1000, 10_000, 100_000, 1_000_000):
    start = time.perf_counter()
    fact = [1] * (N + 1)
    for i in range(1, N + 1):
        fact[i] = fact[i - 1] * i % MOD
    invfact = [1] * (N + 1)
    invfact[N] = pow(fact[N], MOD - 2, MOD)
    for i in range(N, 0, -1):
        invfact[i - 1] = invfact[i] * i % MOD
    print(f"N={N:>8}: {(time.perf_counter() - start) * 1000:.3f} ms")
```

---

## Testing Guidance

- **Oracle for `C(n, k)`:** `math.comb(n, k) % p` (Python) or a Pascal's-triangle build for all `n ≤ 200`.
- **Inverse self-check:** `fact[i]·invfact[i] % p == 1` for sampled `i`.
- **Wilson check:** `fact[p-1] == p-1` when the table reaches `p-1`.
- **Pascal recurrence:** `C(n,k) == (C(n-1,k-1) + C(n-1,k)) % p`.
- **Kummer / Legendre:** zero test agrees with `math.comb(n,k) % p == 0`.
- **Granville / Lucas:** compare against `math.comb(n,k) % m` for small `n` across all moduli.
- **Cross-language determinism:** Go, Java, and Python must produce identical output for shared inputs.
