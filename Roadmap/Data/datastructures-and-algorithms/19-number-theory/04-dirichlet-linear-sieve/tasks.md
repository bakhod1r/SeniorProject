# Linear Sieve & Multiplicative Functions — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec and starter code. Implement the sieving logic and validate against the evaluation criteria.
> **Always validate sieved functions against a brute-force factorizer for all `x ≤ 1000` (and against the Dirichlet identities `Σ_{d∣n}φ(d)=n`, `Σ_{d∣n}μ(d)=[n=1]`) before trusting your sieve.**

---

## Beginner Tasks (5)

### Task 1 — Smallest Prime Factor table

**Problem.** Implement `spf(n)` returning an array where `spf[x]` is the smallest prime factor of `x` for `2 ≤ x ≤ n`, using the linear sieve. `spf[prime] = prime`.

**Input / Output spec.**
- Input: one integer `n` (`2 ≤ n ≤ 10^6`).
- Output: `spf[2] spf[3] … spf[n]`, space-separated on one line.

**Constraints.** Must be `O(n)`. Include the `i % p == 0: break`.

**Hint.** Maintain a growing `primes` list; for each `i`, mark `i·p` for `p ≤ spf[i]`.

**Starter — Go.**
```go
package main

import "fmt"

func spfSieve(n int) []int {
	// TODO: linear sieve filling spf[0..n]
	return nil
}

func main() {
	var n int
	fmt.Scan(&n)
	s := spfSieve(n)
	for x := 2; x <= n; x++ {
		if x > 2 {
			fmt.Print(" ")
		}
		fmt.Print(s[x])
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int[] spfSieve(int n) {
        // TODO
        return new int[n + 1];
    }
    public static void main(String[] args) {
        int n = new Scanner(System.in).nextInt();
        int[] s = spfSieve(n);
        StringBuilder sb = new StringBuilder();
        for (int x = 2; x <= n; x++) { if (x > 2) sb.append(' '); sb.append(s[x]); }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
def spf_sieve(n):
    # TODO
    return [0] * (n + 1)

if __name__ == "__main__":
    n = int(input())
    s = spf_sieve(n)
    print(" ".join(str(s[x]) for x in range(2, n + 1)))
```

- **Expected (n=10):** `2 3 2 5 2 7 2 3 2`
- **Evaluation:** correctness, `O(n)`, presence of the break.

---

### Task 2 — Factorize using SPF

**Problem.** Build the SPF table up to `n`, then for each query `x` print its prime factorization with exponents, e.g. `360 = 2^3 * 3^2 * 5^1`.

**Constraints.** `x ≤ n ≤ 10^6`. Each query must run in `O(log x)`.

**Hint.** Repeatedly take `p = spf[x]`, count how many times `p` divides `x`, divide it out.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	// TODO: build spf, read x, print "x = p1^e1 * p2^e2 * ..."
	_ = fmt.Sprint
}
```

**Starter — Java.**
```java
public class Task2 {
    public static void main(String[] args) {
        // TODO: build spf, factor each query in O(log x)
    }
}
```

**Starter — Python.**
```python
def main():
    # TODO: build spf, factor each query in O(log x)
    pass

if __name__ == "__main__":
    main()
```

- **Expected:** `360 = 2^3 * 3^2 * 5^1`
- **Evaluation:** correct exponents, `O(log x)` per query, handles `x = 1` (empty factorization).

---

### Task 3 — Euler's totient table

**Problem.** Fill `phi[x]` for all `x ≤ n` in the linear sieve. Print `phi[1..n]`.

**Constraints.** `n ≤ 10^6`, `O(n)`.

**Hint.** Coprime case: `phi[i·p] = phi[i]·(p−1)`. Square case: `phi[i·p] = phi[i]·p`. Seed `phi[1]=1`.

**Starter — Go.**
```go
package main

import "fmt"

func phiSieve(n int) []int {
	// TODO
	return nil
}

func main() {
	n := 12
	fmt.Println(phiSieve(n)) // [0 1 1 2 2 4 2 6 4 6 4 10 4]
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task3 {
    static int[] phiSieve(int n) { /* TODO */ return new int[n + 1]; }
    public static void main(String[] args) {
        System.out.println(Arrays.toString(phiSieve(12)));
    }
}
```

**Starter — Python.**
```python
def phi_sieve(n):
    # TODO
    return [0] * (n + 1)

if __name__ == "__main__":
    print(phi_sieve(12))  # [0,1,1,2,2,4,2,6,4,6,4,10,4]
```

- **Evaluation:** matches `φ(n) = n·Π(1−1/p)` for all `x ≤ 1000`.

---

### Task 4 — Möbius table and squarefree check

**Problem.** Fill `mu[x]` for all `x ≤ n`, then answer queries "is `x` squarefree?" (yes iff `mu[x] ≠ 0`).

**Constraints.** `n ≤ 10^6`, `O(n)`.

**Hint.** Coprime: `mu[i·p] = −mu[i]`. Square: `mu[i·p] = 0`. Seed `mu[1]=1`.

**Starter — Go.**
```go
package main

import "fmt"

func muSieve(n int) []int8 {
	// TODO
	return nil
}

func main() {
	m := muSieve(12)
	fmt.Println(m[6], m[12], m[30 > 12]) // careful with bounds
	_ = m
}
```

**Starter — Java.**
```java
public class Task4 {
    static byte[] muSieve(int n) { /* TODO */ return new byte[n + 1]; }
    public static void main(String[] args) {
        byte[] m = muSieve(30);
        System.out.println(m[6] + " " + m[12] + " " + m[30]); // 1 0 -1
    }
}
```

**Starter — Python.**
```python
def mu_sieve(n):
    # TODO
    return [0] * (n + 1)

if __name__ == "__main__":
    m = mu_sieve(30)
    print(m[6], m[12], m[30])  # 1 0 -1
```

- **Evaluation:** `μ(6)=1`, `μ(12)=0`, `μ(30)=−1`; squarefree count for `n=100` is `61`.

---

### Task 5 — Count primes via the sieve

**Problem.** Use the linear sieve's prime list to count and print `π(n)` (number of primes `≤ n`).

**Constraints.** `n ≤ 10^6`.

**Hint.** Primes are exactly the `i` with `spf[i] == 0` at the moment you reach them; collect them in a list.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var n int
	fmt.Scan(&n)
	// TODO: linear sieve, count primes
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task5 {
    public static void main(String[] args) {
        int n = new Scanner(System.in).nextInt();
        // TODO
    }
}
```

**Starter — Python.**
```python
def main():
    n = int(input())
    # TODO: linear sieve, print pi(n)
    pass

if __name__ == "__main__":
    main()
```

- **Expected:** `π(10)=4`, `π(100)=25`, `π(1000)=168`, `π(10^6)=78498`.
- **Evaluation:** matches known `π(n)` values.

---

## Intermediate Tasks (5)

### Task 6 — Divisor count τ in the sieve

**Problem.** Fill `tau[x]` (number of divisors) for all `x ≤ n` in the linear sieve, using a `cnt` auxiliary array. Print `tau[1..n]`.

**Constraints.** `n ≤ 10^6`, `O(n)`. Do *not* factorize each number separately.

**Hint.** Coprime: `tau[i·p]=tau[i]·2`, `cnt=1`. Square: `cnt[i·p]=cnt[i]+1`, `tau[i·p]=tau[i]/(cnt[i]+1)·(cnt[i]+2)`.

**Starter (all three):** extend your linear sieve with `cnt[]` and `tau[]`; seed `tau[1]=1`.

- **Evaluation:** `τ(12)=6`, `τ(360)=24`; matches brute force for `x ≤ 1000`.

---

### Task 7 — Divisor sum σ in the sieve

**Problem.** Fill `sigma[x]` (sum of divisors) for all `x ≤ n` using a `low` auxiliary array. Use 64-bit integers.

**Constraints.** `n ≤ 10^6`, `O(n)`.

**Hint.** Coprime: `sigma[i·p]=sigma[i]·(p+1)`, `low=p+1`. Square: `low[i·p]=low[i]·p+1`, `sigma[i·p]=sigma[i]/low[i]·low[i·p]`.

- **Evaluation:** `σ(6)=12`, `σ(12)=28`, `σ(360)=1170`; matches brute force for `x ≤ 1000`.

---

### Task 8 — Totient summatory + Mertens function

**Problem.** Compute prefix sums `Φ(n)=Σ_{x=1}^{n}φ(x)` and `M(n)=Σ_{x=1}^{n}μ(x)` (the Mertens function) for all `n` up to the bound. Answer range queries `Σ_{x=a}^{b} φ(x)` in `O(1)`.

**Constraints.** `n ≤ 10^7`. Use 64-bit for the totient sum.

**Hint.** Sieve `φ` and `μ`, then one prefix-sum pass each.

- **Evaluation:** `Φ(100)=3045`, `M(100)=1`; range query `Σφ[10..20]` correct.

---

### Task 9 — Distinct vs total prime-factor counts (ω, Ω)

**Problem.** Using the SPF table, compute for each `x ≤ n` the number of distinct prime factors `ω(x)` and the number with multiplicity `Ω(x)`. Answer queries for both.

**Constraints.** `n ≤ 10^6`. Each query `O(log x)` (or precompute both tables in the sieve).

**Hint.** Walk the SPF chain; count distinct primes for `ω`, every division step for `Ω`. Optionally derive both during the sieve from `cnt`.

- **Evaluation:** `ω(360)=3`, `Ω(360)=6` (`360=2³3²5`).

---

### Task 10 — Validate via Dirichlet identities

**Problem.** After sieving `φ`, `μ`, `τ`, `σ`, write a checker that verifies, for all `n ≤ N`: `Σ_{d∣n}φ(d)=n`, `Σ_{d∣n}μ(d)=[n=1]`, `Σ_{d∣n}1=τ(n)`, `Σ_{d∣n}d=σ(n)`. Report the first failing `n` or "all OK".

**Constraints.** `N ≤ 10^4` (the divisor loops are `O(N log N)`).

**Hint.** Enumerate divisors by iterating `d` and adding contributions to multiples `d, 2d, 3d, …`.

- **Evaluation:** prints "all OK" for a correct sieve; pinpoints the bug for a broken one.

---

## Advanced Tasks (5)

### Task 11 — Sieve a custom multiplicative function

**Problem.** Sieve the Jordan totient `J_2(n) = n²·Π(1−1/p²)` for all `x ≤ n`. It is multiplicative with `J_2(p)=p²−1` and `J_2(p^{a+1})=J_2(p^a)·p²`.

**Constraints.** `n ≤ 10^6`. Use 64-bit. Derive the coprime and square-factor recurrences yourself.

**Hint.** Coprime: `J(i·p)=J(i)·(p²−1)`. Square: `J(i·p)=J(i)·p²`. (Mirror the `φ` structure.)

- **Evaluation:** `J_2(6)=(2²−1)(3²−1)=3·8=24`; matches `n²Π(1−1/p²)`.

---

### Task 12 — Modular divisor sum (no integer division)

**Problem.** Compute `σ(x) mod M` for all `x ≤ n` where `M` is a given (possibly non-prime) modulus. The integer-division `σ` recurrence is invalid mod `M` — use the modular-safe form.

**Constraints.** `n ≤ 10^6`. Keep `low[x]` (the geometric-sum factor) and combine multiplicatively without dividing.

**Hint.** Prime: `σ=p+1`, `low=p+1`. Coprime: `σ(i·p)=σ(i)·(p+1) mod M`, `low=p+1`. Square: `low_new=low·p+1`; rebuild `σ(i·p)=σ(i/p^{cnt})·low_new` — track the cofactor sum, never divide.

- **Evaluation:** matches a brute-force `Σ_{d∣x} d mod M` for `x ≤ 1000` and several moduli.

---

### Task 13 — Block factorization sieve for Σφ beyond RAM

**Problem.** Compute `Σ_{x=1}^{N} φ(x)` for `N` up to `10^9` using a block factorization sieve, holding only one cache-sized block at a time. Do not allocate an `N`-sized array.

**Constraints.** Memory `O(√N + block)`. Use 64-bit accumulation.

**Hint.** Sieve base primes `≤ √N`; for each block `[L,R]`, factor each `x` against base primes (track a remaining cofactor), compute `φ` from the closed form, add to the running total; a leftover cofactor `> 1` is a prime `> √N`.

- **Evaluation:** `Σφ` for `N=100` is `3045`; runs within memory budget for `N=10^8`.

---

### Task 14 — Möbius inversion to count coprime-to-m integers

**Problem.** Given `m` and many queries `n`, compute the number of integers in `[1, n]` coprime to `m`, using `Σ_{d∣m} μ(d)⌊n/d⌋`. Precompute `μ` and the divisors of `m` with the sieve.

**Constraints.** `m ≤ 10^6`, up to `10^5` queries; each query `O(τ(m))`.

**Hint.** Factor `m` via SPF, enumerate its divisors, attach `μ(d)`, then answer each query by the inclusion-exclusion sum.

- **Evaluation:** for `m=6`, count coprime in `[1,12]` is `12·(1−½)(1−⅓)=4`; matches direct gcd counting.

---

### Task 15 — Linearity self-check instrumentation

**Problem.** Instrument the linear sieve to count total inner-loop *markings* (assignments to `spf[i·p]`) and assert the count equals `n − π(n)` exactly. Then deliberately remove the `i % p == 0: break` and observe the count blow up and the function tables corrupt; report both counts and the first wrong `μ`.

**Constraints.** `n ≤ 10^6`. Compare counts and first-divergence index with and without the break.

**Hint.** Maintain a `marks` counter; compare to `n − len(primes)`. This is the cheapest production guard for the linearity-critical break.

- **Evaluation:** correct sieve: `marks == n − π(n)`; broken sieve: `marks > n − π(n)` and a wrong `μ` is reported.

---

## Benchmark Task

> Compare linear-sieve build time across all 3 languages for increasing `n`.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func buildPhi(n int) {
	spf := make([]int, n+1)
	phi := make([]int, n+1)
	if n >= 1 {
		phi[1] = 1
	}
	primes := make([]int, 0, 1024)
	for i := 2; i <= n; i++ {
		if spf[i] == 0 {
			spf[i], phi[i] = i, i-1
			primes = append(primes, i)
		}
		for _, p := range primes {
			if p > spf[i] || i*p > n {
				break
			}
			spf[i*p] = p
			if i%p == 0 {
				phi[i*p] = phi[i] * p
				break
			}
			phi[i*p] = phi[i] * (p - 1)
		}
	}
}

func main() {
	for _, n := range []int{100000, 1000000, 5000000, 10000000} {
		start := time.Now()
		buildPhi(n)
		fmt.Printf("n=%9d: %v\n", n, time.Since(start))
	}
}
```

#### Java

```java
public class Benchmark {
    static void buildPhi(int n) {
        int[] spf = new int[n + 1];
        int[] phi = new int[n + 1];
        if (n >= 1) phi[1] = 1;
        int[] primes = new int[Math.max(16, n / 10)];
        int pc = 0;
        for (int i = 2; i <= n; i++) {
            if (spf[i] == 0) { spf[i] = i; phi[i] = i - 1; primes[pc++] = i; }
            for (int k = 0; k < pc; k++) {
                int p = primes[k];
                if (p > spf[i] || (long) i * p > n) break;
                spf[i * p] = p;
                if (i % p == 0) { phi[i * p] = phi[i] * p; break; }
                phi[i * p] = phi[i] * (p - 1);
            }
        }
    }

    public static void main(String[] args) {
        for (int n : new int[]{100000, 1000000, 5000000, 10000000}) {
            long t = System.nanoTime();
            buildPhi(n);
            System.out.printf("n=%9d: %.1f ms%n", n, (System.nanoTime() - t) / 1e6);
        }
    }
}
```

#### Python

```python
import time


def build_phi(n):
    spf = [0] * (n + 1)
    phi = [0] * (n + 1)
    if n >= 1:
        phi[1] = 1
    primes = []
    for i in range(2, n + 1):
        if spf[i] == 0:
            spf[i], phi[i] = i, i - 1
            primes.append(i)
        for p in primes:
            if p > spf[i] or i * p > n:
                break
            spf[i * p] = p
            if i % p == 0:
                phi[i * p] = phi[i] * p
                break
            phi[i * p] = phi[i] * (p - 1)


if __name__ == "__main__":
    for n in (100_000, 1_000_000, 5_000_000, 10_000_000):
        t = time.perf_counter()
        build_phi(n)
        print(f"n={n:>9}: {(time.perf_counter() - t) * 1000:.1f} ms")
```

Observe: Go and Java run the linear sieve in tens of milliseconds at `n = 10^7`; Python is far slower (the per-element loop runs in the interpreter), which is itself a lesson — in Python, prefer NumPy or a bitset Eratosthenes when you only need primality.
