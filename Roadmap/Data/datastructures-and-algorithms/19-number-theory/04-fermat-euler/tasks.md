# Fermat's Little Theorem & Euler's Theorem — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the modular-arithmetic logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle on small inputs** — count coprime residues directly for `φ`, and compare reduced exponents against a small materialized power.

---

## Beginner Tasks (5)

### Task 1 — Modular fast power

**Problem.** Implement `powMod(a, e, m)` returning `a^e mod m` in `O(log e)` using binary exponentiation. Reduce after every multiply so nothing overflows.

**Input / Output spec.**
- Read three integers `a`, `e`, `m`.
- Print `a^e mod m`.

**Constraints.**
- `0 ≤ a, e ≤ 10^18`, `1 ≤ m ≤ 10^9`.
- Reduce the base first (`a %= m`); handle `m = 1` (answer `0`).

**Hint.** `r = 1 % m`; loop while `e > 0`: if `e` odd, `r = r*a % m`; then `a = a*a % m`; `e >>= 1`.

**Starter — Go.**
```go
package main

import "fmt"

func powMod(a, e, m int64) int64 {
	// TODO: binary exponentiation, reduce mod m each step
	return 0
}

func main() {
	var a, e, m int64
	fmt.Scan(&a, &e, &m)
	fmt.Println(powMod(a, e, m))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long powMod(long a, long e, long m) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), e = sc.nextLong(), m = sc.nextLong();
        System.out.println(powMod(a, e, m));
    }
}
```

**Starter — Python.**
```python
import sys


def pow_mod(a, e, m):
    # TODO
    return 0


def main():
    a, e, m = map(int, sys.stdin.read().split())
    print(pow_mod(a, e, m))


if __name__ == "__main__":
    main()
```

**Evaluation.** Matches built-in `pow(a, e, m)` for random inputs; `powMod(x, 0, m) == 1 % m`.

---

### Task 2 — Modular inverse via Fermat

**Problem.** Given a prime `p` and `a` with `1 ≤ a < p`, print `a^(-1) mod p` using `a^(p-2) mod p`.

**Input / Output spec.**
- Read `a`, `p`.
- Print the inverse.

**Constraints.**
- `2 ≤ p ≤ 10^9` (prime), `1 ≤ a < p`.

**Hint.** Reuse `powMod` from Task 1: `inverse = powMod(a, p-2, p)`.

**Starter — Go.**
```go
package main

import "fmt"

func powMod(a, e, m int64) int64 { /* from Task 1 */ return 0 }

func inverseFermat(a, p int64) int64 {
	// TODO: return a^(p-2) mod p
	return 0
}

func main() {
	var a, p int64
	fmt.Scan(&a, &p)
	fmt.Println(inverseFermat(a, p))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task2 {
    static long powMod(long a, long e, long m) { /* from Task 1 */ return 0; }

    static long inverseFermat(long a, long p) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), p = sc.nextLong();
        System.out.println(inverseFermat(a, p));
    }
}
```

**Starter — Python.**
```python
import sys


def inverse_fermat(a, p):
    # TODO: return pow(a, p-2, p)
    return 0


def main():
    a, p = map(int, sys.stdin.read().split())
    print(inverse_fermat(a, p))


if __name__ == "__main__":
    main()
```

**Evaluation.** `(a * answer) % p == 1` for every test.

---

### Task 3 — Totient of a single number

**Problem.** Given `n`, print `φ(n)` using the product formula over distinct primes.

**Input / Output spec.**
- Read `n`. Print `φ(n)`.

**Constraints.**
- `1 ≤ n ≤ 10^12`.

**Hint.** `res = n`; trial-divide; for each distinct prime `p | n`: strip all copies, then `res -= res/p`. Handle a leftover prime `> √n`.

**Starter — Go.**
```go
package main

import "fmt"

func totient(n int64) int64 {
	// TODO: trial-divide, apply (1 - 1/p) per distinct prime
	return 0
}

func main() {
	var n int64
	fmt.Scan(&n)
	fmt.Println(totient(n))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task3 {
    static long totient(long n) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(totient(sc.nextLong()));
    }
}
```

**Starter — Python.**
```python
import sys


def totient(n):
    # TODO
    return 0


def main():
    print(totient(int(sys.stdin.read())))


if __name__ == "__main__":
    main()
```

**Evaluation.** Matches the brute-force `sum(gcd(a,n)==1 for a in 1..n)` for all `n ≤ 1000`; `φ(prime) == prime-1`, `φ(1) == 1`.

---

### Task 4 — Verify Fermat's little theorem

**Problem.** Given a prime `p` and `a` with `gcd(a, p) = 1`, print `1` if `a^(p-1) ≡ 1 (mod p)` and `0` otherwise (it should always be `1` for valid input — a self-check).

**Input / Output spec.**
- Read `a`, `p`. Print `1` or `0`.

**Constraints.**
- `2 ≤ p ≤ 10^9` prime, `1 ≤ a < p`.

**Hint.** Compute `powMod(a, p-1, p)` and compare to `1`.

**Starter — Go.**
```go
package main

import "fmt"

func powMod(a, e, m int64) int64 { /* from Task 1 */ return 0 }

func main() {
	var a, p int64
	fmt.Scan(&a, &p)
	if powMod(a, p-1, p) == 1 {
		fmt.Println(1)
	} else {
		fmt.Println(0)
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task4 {
    static long powMod(long a, long e, long m) { /* from Task 1 */ return 0; }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), p = sc.nextLong();
        System.out.println(powMod(a, p - 1, p) == 1 ? 1 : 0);
    }
}
```

**Starter — Python.**
```python
import sys


def main():
    a, p = map(int, sys.stdin.read().split())
    print(1 if pow(a, p - 1, p) == 1 else 0)


if __name__ == "__main__":
    main()
```

**Evaluation.** Prints `1` for all valid (prime `p`, coprime `a`) inputs.

---

### Task 5 — Reduce a huge exponent mod (p-1)

**Problem.** Given a prime `p`, base `a` (coprime to `p`), and a huge exponent `e`, print `a^e mod p` by reducing `e mod (p-1)` first.

**Input / Output spec.**
- Read `a`, `e`, `p`. Print `a^e mod p`.

**Constraints.**
- `2 ≤ p ≤ 10^9` prime, `1 ≤ a < p`, `0 ≤ e ≤ 10^18`.

**Hint.** `er = e % (p-1)`; answer `= powMod(a, er, p)`. (Equivalently `powMod(a, e, p)` directly — both must agree.)

**Starter — Go.**
```go
package main

import "fmt"

func powMod(a, e, m int64) int64 { /* from Task 1 */ return 0 }

func main() {
	var a, e, p int64
	fmt.Scan(&a, &e, &p)
	// TODO: reduce e mod (p-1), then power
	fmt.Println(powMod(a, e%(p-1), p))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task5 {
    static long powMod(long a, long e, long m) { /* from Task 1 */ return 0; }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), e = sc.nextLong(), p = sc.nextLong();
        System.out.println(powMod(a, e % (p - 1), p));
    }
}
```

**Starter — Python.**
```python
import sys


def main():
    a, e, p = map(int, sys.stdin.read().split())
    print(pow(a, e % (p - 1), p))


if __name__ == "__main__":
    main()
```

**Evaluation.** Reduced and unreduced (`pow(a, e, p)`) results agree for all tests.

---

## Intermediate Tasks (4)

### Task 6 — Sieve all totients `φ(1..n)`

**Problem.** Print `φ(1), φ(2), …, φ(n)` space-separated, computed by a single `O(n log log n)` sieve.

**Input / Output spec.**
- Read `n`. Print `n` values on one line.

**Constraints.**
- `1 ≤ n ≤ 10^7`.

**Hint.** `phi[i] = i`; for `p` from 2: if `phi[p] == p` (prime), sweep multiples `m += p` doing `phi[m] -= phi[m]/p`.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
)

func sieveTotient(n int) []int {
	phi := make([]int, n+1)
	// TODO: init phi[i]=i, then sieve
	return phi
}

func main() {
	var n int
	fmt.Scan(&n)
	phi := sieveTotient(n)
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	for i := 1; i <= n; i++ {
		if i > 1 {
			w.WriteByte(' ')
		}
		w.WriteString(strconv.Itoa(phi[i]))
	}
	w.WriteByte('\n')
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task6 {
    static int[] sieveTotient(int n) {
        int[] phi = new int[n + 1];
        // TODO
        return phi;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] phi = sieveTotient(n);
        StringBuilder sb = new StringBuilder();
        for (int i = 1; i <= n; i++) {
            if (i > 1) sb.append(' ');
            sb.append(phi[i]);
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys


def sieve_totient(n):
    phi = list(range(n + 1))
    # TODO: for each prime p, phi[m] -= phi[m]//p over multiples
    return phi


def main():
    n = int(sys.stdin.read())
    phi = sieve_totient(n)
    print(" ".join(map(str, phi[1:])))


if __name__ == "__main__":
    main()
```

**Evaluation.** Each `phi[i]` matches the single-value `totient(i)` from Task 3 for all `i ≤ n`.

---

### Task 7 — Inverse mod composite via Euler

**Problem.** Given `a` and a (possibly composite) modulus `m` with `gcd(a, m) = 1`, print `a^(-1) mod m` using `a^(φ(m)-1) mod m`. If `gcd(a, m) ≠ 1`, print `-1`.

**Input / Output spec.**
- Read `a`, `m`. Print the inverse or `-1`.

**Constraints.**
- `1 ≤ a < m ≤ 10^12`.

**Hint.** Check `gcd(a, m) == 1`. Compute `φ(m)` (Task 3), then `powMod(a, φ(m)-1, m)`.

**Starter — Go.**
```go
package main

import "fmt"

func gcd(a, b int64) int64 { for b != 0 { a, b = b, a%b }; return a }
func totient(n int64) int64 { /* from Task 3 */ return 0 }
func powMod(a, e, m int64) int64 { /* from Task 1 */ return 0 }

func main() {
	var a, m int64
	fmt.Scan(&a, &m)
	if gcd(a, m) != 1 {
		fmt.Println(-1)
		return
	}
	// TODO: return a^(φ(m)-1) mod m
	fmt.Println(powMod(a, totient(m)-1, m))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task7 {
    static long gcd(long a, long b) { return b == 0 ? a : gcd(b, a % b); }
    static long totient(long n) { /* from Task 3 */ return 0; }
    static long powMod(long a, long e, long m) { /* from Task 1 */ return 0; }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), m = sc.nextLong();
        if (gcd(a, m) != 1) { System.out.println(-1); return; }
        System.out.println(powMod(a, totient(m) - 1, m));
    }
}
```

**Starter — Python.**
```python
import sys
from math import gcd


def totient(n):  # from Task 3
    return 0


def main():
    a, m = map(int, sys.stdin.read().split())
    if gcd(a, m) != 1:
        print(-1)
        return
    print(pow(a, totient(m) - 1, m))


if __name__ == "__main__":
    main()
```

**Evaluation.** `(a * answer) % m == 1` when `gcd = 1`; prints `-1` otherwise. Cross-check against extended-Euclid inverse.

---

### Task 8 — Multiplicative order of an element

**Problem.** Given `a` and `m` with `gcd(a, m) = 1`, print the smallest `d > 0` with `a^d ≡ 1 (mod m)`.

**Input / Output spec.**
- Read `a`, `m`. Print the order.

**Constraints.**
- `1 ≤ a < m ≤ 10^12`, `gcd(a, m) = 1`.

**Hint.** Start with `ord = φ(m)`. Factor `φ(m)`. For each prime `q | φ(m)`, while `ord % q == 0` and `powMod(a, ord/q, m) == 1`, set `ord /= q`.

**Starter — Go.**
```go
package main

import "fmt"

func totient(n int64) int64 { /* Task 3 */ return 0 }
func powMod(a, e, m int64) int64 { /* Task 1 */ return 0 }

func order(a, m int64) int64 {
	ord := totient(m)
	t := ord
	// TODO: for each prime q | t, reduce ord while a^(ord/q) ≡ 1
	_ = t
	return ord
}

func main() {
	var a, m int64
	fmt.Scan(&a, &m)
	fmt.Println(order(a, m))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task8 {
    static long totient(long n) { /* Task 3 */ return 0; }
    static long powMod(long a, long e, long m) { /* Task 1 */ return 0; }

    static long order(long a, long m) {
        long ord = totient(m);
        // TODO: factor ord, divide out primes while a^(ord/q) ≡ 1
        return ord;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), m = sc.nextLong();
        System.out.println(order(a, m));
    }
}
```

**Starter — Python.**
```python
import sys


def totient(n):  # Task 3
    return 0


def order(a, m):
    ord_ = totient(m)
    t, p = ord_, 2
    primes = set()
    while p * p <= t:
        while t % p == 0:
            primes.add(p)
            t //= p
        p += 1
    if t > 1:
        primes.add(t)
    for q in primes:
        while ord_ % q == 0 and pow(a, ord_ // q, m) == 1:
            ord_ //= q
    return ord_


def main():
    a, m = map(int, sys.stdin.read().split())
    print(order(a, m))


if __name__ == "__main__":
    main()
```

**Evaluation.** `a^ord ≡ 1` and `a^(ord/q) ≢ 1` for every prime `q | ord`; `ord` divides `φ(m)`. Cross-check by brute force for small `m`.

---

### Task 9 — Sum of GCDs (totient application)

**Problem.** Compute `Σ_{k=1}^{n} gcd(k, n)`. Use the identity `Σ_{k=1}^{n} gcd(k, n) = Σ_{d | n} d · φ(n/d)`.

**Input / Output spec.**
- Read `n`. Print the sum.

**Constraints.**
- `1 ≤ n ≤ 10^12`.

**Hint.** Enumerate divisors `d` of `n` (in `O(√n)`); for each, add `d · φ(n/d)` using the single-value totient.

**Starter — Go.**
```go
package main

import "fmt"

func totient(n int64) int64 { /* Task 3 */ return 0 }

func sumGcd(n int64) int64 {
	var sum int64
	for d := int64(1); d*d <= n; d++ {
		if n%d == 0 {
			// TODO: add d*φ(n/d) and (n/d)*φ(d), avoid double count when d*d==n
		}
	}
	return sum
}

func main() {
	var n int64
	fmt.Scan(&n)
	fmt.Println(sumGcd(n))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task9 {
    static long totient(long n) { /* Task 3 */ return 0; }

    static long sumGcd(long n) {
        long sum = 0;
        for (long d = 1; d * d <= n; d++) {
            if (n % d == 0) {
                // TODO
            }
        }
        return sum;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(sumGcd(sc.nextLong()));
    }
}
```

**Starter — Python.**
```python
import sys


def totient(n):  # Task 3
    return 0


def sum_gcd(n):
    total = 0
    d = 1
    while d * d <= n:
        if n % d == 0:
            total += d * totient(n // d)
            if d != n // d:
                total += (n // d) * totient(d)
        d += 1
    return total


def main():
    print(sum_gcd(int(sys.stdin.read())))


if __name__ == "__main__":
    main()
```

**Evaluation.** Matches the brute-force `sum(gcd(k, n) for k in 1..n)` for all `n ≤ 5000`.

---

## Advanced Tasks (3)

### Task 10 — General exponent tower `a^(b^c) mod m`

**Problem.** Compute `a^(b^c) mod m` for any base (coprime or not) using the generalized Euler rule `a^e ≡ a^((e mod φ(m)) + φ(m))`.

**Input / Output spec.**
- Read `a`, `b`, `c`, `m`. Print the result.

**Constraints.**
- `1 ≤ a, b, c ≤ 10^9`, `1 ≤ m ≤ 10^9`.

**Hint.** `phi = φ(m)`; `inner = powMod(b, c, phi)`; answer `= powMod(a, inner + phi, m)`. Handle `m == 1 → 0`.

**Starter — Python.**
```python
import sys


def totient(m):  # Task 3
    return 0


def tower(a, b, c, m):
    if m == 1:
        return 0
    phi = totient(m)
    inner = pow(b, c, phi)
    # TODO: apply +phi generalized guard
    return pow(a, inner + phi, m)


def main():
    a, b, c, m = map(int, sys.stdin.read().split())
    print(tower(a, b, c, m))


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

func totient(m int64) int64 { /* Task 3 */ return 0 }
func powMod(a, e, m int64) int64 { /* Task 1 */ return 0 }

func tower(a, b, c, m int64) int64 {
	if m == 1 {
		return 0
	}
	phi := totient(m)
	inner := powMod(b, c, phi)
	// TODO: return a^(inner + phi) mod m
	return powMod(a, inner+phi, m)
}

func main() {
	var a, b, c, m int64
	fmt.Scan(&a, &b, &c, &m)
	fmt.Println(tower(a, b, c, m))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task10 {
    static long totient(long m) { /* Task 3 */ return 0; }
    static long powMod(long a, long e, long m) { /* Task 1 */ return 0; }

    static long tower(long a, long b, long c, long m) {
        if (m == 1) return 0;
        long phi = totient(m);
        long inner = powMod(b, c, phi);
        return powMod(a, inner + phi, m);
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong(), c = sc.nextLong(), m = sc.nextLong();
        System.out.println(tower(a, b, c, m));
    }
}
```

**Evaluation.** For inputs where `b^c` is small enough to materialize, the result matches `pow(a, b**c, m)` exactly — including non-coprime bases (e.g. `a=6, m=9`).

---

### Task 11 — Carmichael function `λ(m)`

**Problem.** Compute Carmichael's `λ(m)`, the least universal exponent with `a^(λ(m)) ≡ 1 (mod m)` for all coprime `a`. Use `λ = lcm` over prime-power factors, with the special case `λ(2^e) = 2^{e-2}` for `e ≥ 3`.

**Input / Output spec.**
- Read `m`. Print `λ(m)`.

**Constraints.**
- `1 ≤ m ≤ 10^12`.

**Hint.** Factor `m`. For each `p^e`: `λ = 2^{e-2}` if `p == 2 and e >= 3`, else `(p-1)·p^{e-1}`. Combine with `lcm`.

**Starter — Python.**
```python
import sys
from math import gcd


def carmichael(m):
    def factorize(n):
        f, p = {}, 2
        while p * p <= n:
            while n % p == 0:
                f[p] = f.get(p, 0) + 1
                n //= p
            p += 1
        if n > 1:
            f[n] = f.get(n, 0) + 1
        return f

    res = 1
    for p, e in factorize(m).items():
        if p == 2 and e >= 3:
            lam = 1 << (e - 2)
        else:
            lam = (p - 1) * p ** (e - 1)
        res = res // gcd(res, lam) * lam
    return res


def main():
    print(carmichael(int(sys.stdin.read())))


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

func gcd(a, b int64) int64 { for b != 0 { a, b = b, a%b }; return a }
func lcm(a, b int64) int64 { return a / gcd(a, b) * b }

func carmichael(m int64) int64 {
	res := int64(1)
	// TODO: factor m; for each p^e compute λ(p^e) (special-case 2^e) and lcm in
	_ = m
	return res
}

func main() {
	var m int64
	fmt.Scan(&m)
	fmt.Println(carmichael(m))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task11 {
    static long gcd(long a, long b) { return b == 0 ? a : gcd(b, a % b); }
    static long lcm(long a, long b) { return a / gcd(a, b) * b; }

    static long carmichael(long m) {
        long res = 1;
        // TODO: factor m; per prime-power λ; lcm together
        return res;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(carmichael(sc.nextLong()));
    }
}
```

**Evaluation.** `λ(m)` divides `φ(m)`; `a^(λ(m)) ≡ 1` for every coprime `a` (test a sample); `λ(8) == 2`, `λ(561) == 80`.

---

### Task 12 — Detect Carmichael numbers (Korselt's criterion)

**Problem.** Given a composite `n`, print `1` if `n` is a Carmichael number (squarefree and `(p-1) | (n-1)` for every prime `p | n`), else `0`.

**Input / Output spec.**
- Read `n`. Print `1` or `0`.

**Constraints.**
- `2 ≤ n ≤ 10^12`. (`n` is given composite, or you must reject primes as `0`.)

**Hint.** Factor `n`. Reject if any prime appears with exponent `> 1` (not squarefree) or if `n` is prime. Check `(p-1) | (n-1)` for each distinct prime.

**Starter — Python.**
```python
import sys


def is_carmichael(n):
    if n < 2:
        return False
    m, p = n, 2
    factors = []
    while p * p <= m:
        if m % p == 0:
            cnt = 0
            while m % p == 0:
                m //= p
                cnt += 1
            if cnt > 1:                 # not squarefree
                return False
            factors.append(p)
        p += 1
    if m > 1:
        factors.append(m)
    if len(factors) < 2:               # prime, not composite
        return False
    return all((q - 1) and (n - 1) % (q - 1) == 0 for q in factors)


def main():
    print(1 if is_carmichael(int(sys.stdin.read())) else 0)


if __name__ == "__main__":
    main()
```

**Starter — Go.**
```go
package main

import "fmt"

func isCarmichael(n int64) bool {
	if n < 2 {
		return false
	}
	m := n
	var factors []int64
	for p := int64(2); p*p <= m; p++ {
		if m%p == 0 {
			cnt := 0
			for m%p == 0 {
				m /= p
				cnt++
			}
			if cnt > 1 {
				return false // not squarefree
			}
			factors = append(factors, p)
		}
	}
	if m > 1 {
		factors = append(factors, m)
	}
	if len(factors) < 2 {
		return false
	}
	for _, q := range factors {
		if (n-1)%(q-1) != 0 {
			return false
		}
	}
	return true
}

func main() {
	var n int64
	fmt.Scan(&n)
	if isCarmichael(n) {
		fmt.Println(1)
	} else {
		fmt.Println(0)
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task12 {
    static boolean isCarmichael(long n) {
        if (n < 2) return false;
        long m = n;
        List<Long> factors = new ArrayList<>();
        for (long p = 2; p * p <= m; p++) {
            if (m % p == 0) {
                int cnt = 0;
                while (m % p == 0) { m /= p; cnt++; }
                if (cnt > 1) return false;   // not squarefree
                factors.add(p);
            }
        }
        if (m > 1) factors.add(m);
        if (factors.size() < 2) return false;
        for (long q : factors)
            if ((n - 1) % (q - 1) != 0) return false;
        return true;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(isCarmichael(sc.nextLong()) ? 1 : 0);
    }
}
```

**Evaluation.** Prints `1` for `561, 1105, 1729, 2465, 2821, 6601, …` and `0` for primes and non-Carmichael composites. Cross-check: a true Carmichael `n` passes `a^(n-1) ≡ 1 (mod n)` for all `a` coprime to `n`.

---

## Testing Guidance

- **Brute-force oracle for `φ`:** `sum(1 for a in 1..n if gcd(a,n)==1)`. Run for all `n ≤ 1000`.
- **Inverse check:** `(a * inv) % m == 1` at every call site.
- **Euler/Fermat check:** `pow(a, φ(m), m) == 1 % m` and `pow(a, p-1, p) == 1` for random coprime `a`.
- **Tower check:** compare against `pow(a, b**c, m)` when `b**c` is small enough to form — the strongest test for the `+φ` guard.
- **Order check:** `a^ord ≡ 1` and `a^(ord/q) ≢ 1` for every prime `q | ord`; `ord | φ(m)`.
- **Cross-language determinism:** Go, Java, and Python must produce identical output for shared inputs.
