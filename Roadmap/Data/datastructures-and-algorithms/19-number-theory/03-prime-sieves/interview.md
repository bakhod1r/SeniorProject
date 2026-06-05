# Prime Sieves — Interview Preparation

Prime sieves are a staple interview topic because they reward a single crisp insight — *"cross out the multiples of each prime and whatever survives is prime"* — and then test whether you can (a) make it fast with the `p²`-start and `√n`-stop optimizations, (b) upgrade to the linear sieve with smallest-prime-factor for `O(log x)` factorization, (c) handle a range `[L, R]` with a huge upper bound via the segmented sieve, and (d) know when to *stop* sieving and reach for Miller-Rabin (topic `08`). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Task | Tool | Complexity |
|------|------|------------|
| All primes up to `n` | Sieve of Eratosthenes | `O(n log log n)` |
| Primality of many `x ≤ n` | precomputed `isPrime[]` | `O(1)` per query |
| Smallest prime factor of every `x ≤ n` | linear (Euler) sieve | `O(n)` |
| Factor `x ≤ n` after SPF sieve | divide out `spf[x]` repeatedly | `O(log x)` |
| Primes in `[L, R]`, huge `R` | segmented sieve | `O((R−L)log log R + √R)` |
| `φ`/`μ`/`τ`/`σ` for all `x ≤ n` | linear sieve recurrences | `O(n)` |
| Primality of one huge `x` | Miller-Rabin (topic `08`) | `O(k log³ x)` |
| Factor one huge `x` | Pollard's rho (topic `09`) | `~O(x^{1/4})` |

Core algorithm (Eratosthenes):

```text
sieve(n):
    isPrime[0..n] = true; isPrime[0]=isPrime[1]=false
    for p = 2; p*p <= n; p++:
        if isPrime[p]:
            for m = p*p; m <= n; m += p: isPrime[m] = false
    return isPrime
```

Key facts:
- **Start the inner loop at `p²`**, stop the outer loop at `√n`.
- `0` and `1` are **not** prime; `2` is the only even prime.
- The sieve is for *ranges up to `n`*, not a single huge number.
- The linear sieve gives **SPF** (factorization) for free, in `O(n)`.
- `π(10)=4, π(100)=25, π(1000)=168, π(10^6)=78498` — memorize a couple for sanity checks.

---

## Junior Questions (12 Q&A)

### J1. What does the Sieve of Eratosthenes compute?
All prime numbers up to a bound `n`, by marking the multiples of each prime as composite. Whatever remains unmarked is prime. It runs in `O(n log log n)` and lets you answer "is `x` prime?" in `O(1)` afterward.

### J2. Why do we start crossing out at `p²` instead of `2p`?
Any multiple `k·p` with `k < p` has a smaller prime factor (a prime dividing `k`) and was already crossed out when we processed that smaller prime. The first multiple of `p` not already handled is `p·p`. Starting at `p²` skips redundant work without losing correctness.

### J3. Why does the outer loop stop at `√n`?
Every composite `≤ n` has a prime factor `≤ √n`. Once all primes up to `√n` have crossed out their multiples, every composite is already marked. Primes above `√n` simply survive — no need to sieve with them.

### J4. Why are `0` and `1` not prime, and why does it matter?
A prime is an integer `> 1` with exactly two divisors. `1` has only one divisor; `0` is divisible by everything. Forgetting to mark them `false` is the single most common sieve bug — it reports `1` as prime.

### J5. What is the time complexity and why `log log n`?
`O(n log log n)`. For each prime `p`, the inner loop does `~n/p` work; summed over primes, `Σ 1/p ≈ ln ln n` (Mertens' theorem). Since `log log n` grows extremely slowly, the sieve is nearly linear in practice.

### J6. How much memory does the sieve use?
`O(n)` — one boolean per number. For `n = 10^7` that is ~10 MB as bytes. For larger `n` you bit-pack (one bit each, 8× less) or use an odd-only sieve.

### J7. How do you list the primes after sieving?
Scan the array: collect every index `x` from 2 to `n` where `isPrime[x]` is `true`.

### J8. What is `π(n)`?
The prime-counting function: the number of primes `≤ n`. After sieving you compute it by counting `true` entries. It is approximately `n / ln n` (the Prime Number Theorem).

### J9. Can the sieve tell you if 999999999999 (about 10^12) is prime?
Not directly — you cannot allocate `10^12` cells. For a single large number use trial division up to `√x` or Miller-Rabin (topic `08`). The sieve is for ranges up to a memory-fittable `n`.

### J10. What is a common off-by-one bug?
Sizing the array `n` instead of `n+1`, so index `n` is out of bounds or silently dropped. Always allocate `n+1` and use `<= n`.

### J11. Why might `p*p` cause a bug for large `n`?
In Go/Java, `p*p` can overflow 32-bit `int` before being compared to `n`. Compute it in 64-bit so the loop bound is correct.

### J12. Is the sieve faster than testing each number individually?
Yes, dramatically. Testing each `x ≤ n` by trial division is `O(n√n)`; the sieve is `O(n log log n)` — roughly a `√n`-factor faster because it never re-tests the same divisor.

---

## Mid-Level Questions (10 Q&A)

### M1. What does the linear (Euler) sieve add over Eratosthenes?
It runs in true `O(n)` (each composite struck exactly once) and records the **smallest prime factor** of every number, enabling `O(log x)` factorization. It also computes multiplicative functions (`φ`, `μ`, `τ`, `σ`) in the same pass.

### M2. Why is the linear sieve `O(n)` while Eratosthenes is `O(n log log n)`?
In Eratosthenes a composite is crossed out once per distinct prime factor (the source of the `log log n`). The linear sieve's rule — mark `i·p` only for primes `p ≤ spf[i]` and break when `p` divides `i` — guarantees each composite is struck exactly once, by its smallest prime factor.

### M3. How do you factor a number using the SPF table?
Repeatedly take `p = spf[x]`, record it, and divide all factors of `p` out of `x`. Each step removes a prime; `x` shrinks to 1 in `O(log x)` steps.

### M4. How does the segmented sieve work?
To find primes in `[L, R]` with huge `R`: sieve base primes up to `√R`, allocate an array for the window `[L, R]`, and for each base prime cross out its multiples in the window starting at `max(p², ⌈L/p⌉·p)`. Survivors are the primes. Memory is `O(R−L+√R)`, independent of `R`'s magnitude.

### M5. Where does the first in-window multiple of `p` start, and why?
At `max(p², ⌈L/p⌉·p)`. The `⌈L/p⌉·p` is the first multiple of `p` that is `≥ L`; the `p²` floor ensures we never cross out `p` itself (when `p` lies in the window).

### M6. How do you sieve Euler's totient `φ`?
In the linear sieve: `φ(prime p) = p−1`; when `p ∤ i` (coprime), `φ(i·p) = φ(i)·(p−1)`; when `p ∣ i` (square factor), `φ(i·p) = φ(i)·p`. This matches `φ(n) = n·Π(1−1/p)`.

### M7. How do you sieve the Möbius function `μ`?
`μ(prime) = −1`; when `p ∤ i`, `μ(i·p) = −μ(i)` (a new distinct prime flips the sign); when `p ∣ i`, `μ(i·p) = 0` (a repeated prime means a square factor).

### M8. What memory optimizations exist?
Odd-only (skip evens, 2× saving), wheel factorization (skip multiples of 2,3,5 — mod-30 wheel stores 8/30), and bitset packing (1 bit per number, 8× saving). They reduce the constant, not the asymptotics.

### M9. When is Eratosthenes faster wall-clock than the linear sieve?
For pure primality at large `n`: an odd-only bitset Eratosthenes is cache-friendly and often beats the linear sieve, which writes a larger SPF array with less local access. Use the linear sieve when you actually need SPF or a multiplicative function.

### M10. How do you count primes in a far-away window like `[10^12, 10^12+10^6]`?
Segmented sieve: base primes up to `√(10^12+10^6) ≈ 10^6`, sieve the `10^6`-wide window, count survivors. You cannot count *all* primes up to `10^12` this way (too many cells) — that needs sublinear prime-counting methods.

---

## Senior Questions (8 Q&A)

### S1. Walk me through choosing sieve vs trial-division vs Miller-Rabin.
Many numbers up to a RAM-fittable bound → sieve once, `O(1)` queries. One moderate number (`≤ ~10^12`) → trial division to `√x`. One huge number's primality → Miller-Rabin (topic `08`). Factor one huge number → Pollard's rho (topic `09`). The discriminant is cardinality and magnitude: dense range vs single big number.

### S2. How do you make a large sieve cache-efficient?
Block it: process `[2, n]` in L2-sized windows, iterating all base primes within each window. The window stays in cache while you stride the primes, cutting DRAM traffic and giving a 2–5× speedup. The naive sieve is memory-bandwidth-bound for large `n`.

### S3. How do you parallelize a sieve?
By window, never by prime. Sieve base primes up to `√n` once (sequential), then hand disjoint windows to threads, each with its own private buffer (avoid false sharing) and reading the shared read-only base primes. Scales near-linearly until memory bandwidth saturates.

### S4. What is the memory footprint of sieving to 10^9?
1 GB as a byte array (risky), 125 MB as a bitset, ~62 MB odd-only bitset. Beyond that you segment and stream rather than holding the whole array.

### S5. How do you test a sieve?
Assert known prime lists for small `n`; cross-check `π(n)` against references (`π(10^6)=78498`); compare against an independent Miller-Rabin over a dense prefix; property-test that listed primes fail trial division; check segmented-vs-whole parity. A sieve fails silently on one value among millions.

### S6. What is the right integer width for the SPF table?
`spf[x] ≤ √x ≤ √n`, so SPF values fit in the bit-width of `√n`. For `n = 10^8`, `√n = 10^4` fits in 16 bits, halving the table vs 32-bit. Size from `√n`, not `n`.

### S7. What failure modes have you seen in production sieves?
Config-driven OOM (bound bumped without a cap), `p*p` overflow corrupting the bound, segmented-sieve wrong `start`, re-sieving per request, and parallel false sharing. Each maps to a mitigation: cap the bound, use 64-bit products, test segmented parity, build-once-share-immutable, per-thread buffers.

### S8. Why is sieving exponential in the input size for a single number?
The sieve cost is `Θ(n)` in the *magnitude* `n`, but a single number is written in `log n` bits, so `Θ(n) = Θ(2^{log n})` is exponential in the bit-length. That is why one huge number needs Miller-Rabin (polynomial in bit-length), not a sieve.

---

## Behavioral / Communication Prompts

- **"Explain a prime sieve to a non-technical stakeholder."** Use the light-bulbs analogy: switch all on, then for each prime switch off every multiple; the bulbs still glowing are primes. Emphasize "compute once, reuse many times."
- **"Describe a time you optimized a hot precomputation."** Walk through replacing per-number primality tests with a single sieve, the `√n`/`p²` optimizations, and the cache-blocking win — with before/after numbers.
- **"How would you defend a sieve in code review?"** Point to the `0`/`1` handling, the `<= n` bounds, the 64-bit `p*p`, and the reference-`π(n)` tests. Acknowledge the bound/memory cap as the operational risk.
- **"When did you choose *not* to use a sieve?"** A single primality check near `10^{18}` — explain why Miller-Rabin was correct and a sieve would have OOM'd.
- **"How do you decide the sieve bound?"** Derive it from the problem constraints (max value to factor / query), then cap it against available memory; never guess.

---

## Coding Challenge 1 — Count primes up to n (`π(n)`)

**Problem.** Given `n`, return the number of primes `≤ n`. Constraints: `0 ≤ n ≤ 5·10^6`. Use a sieve.

### Go

```go
package main

import "fmt"

func countPrimes(n int) int {
	if n < 2 {
		return 0
	}
	isComposite := make([]bool, n+1)
	count := 0
	for p := 2; p <= n; p++ {
		if !isComposite[p] {
			count++
			for m := p * p; m <= n; m += p {
				isComposite[m] = true
			}
		}
	}
	return count
}

func main() {
	fmt.Println(countPrimes(10))       // 4
	fmt.Println(countPrimes(100))      // 25
	fmt.Println(countPrimes(1_000_000)) // 78498
}
```

### Java

```java
public class CountPrimes {
    static int countPrimes(int n) {
        if (n < 2) return 0;
        boolean[] isComposite = new boolean[n + 1];
        int count = 0;
        for (int p = 2; p <= n; p++) {
            if (!isComposite[p]) {
                count++;
                for (long m = (long) p * p; m <= n; m += p) {
                    isComposite[(int) m] = true;
                }
            }
        }
        return count;
    }

    public static void main(String[] args) {
        System.out.println(countPrimes(10));        // 4
        System.out.println(countPrimes(100));       // 25
        System.out.println(countPrimes(1_000_000)); // 78498
    }
}
```

### Python

```python
def count_primes(n):
    if n < 2:
        return 0
    is_comp = bytearray(n + 1)
    count = 0
    for p in range(2, n + 1):
        if not is_comp[p]:
            count += 1
            is_comp[p * p :: p] = b"\x01" * len(range(p * p, n + 1, p))
    return count


if __name__ == "__main__":
    print(count_primes(10))        # 4
    print(count_primes(100))       # 25
    print(count_primes(1_000_000)) # 78498
```

---

## Coding Challenge 2 — Fast factorization via SPF

**Problem.** Precompute smallest prime factors up to `n`, then factor any `x ≤ n` into prime-power form in `O(log x)`. Return factors as `(prime, exponent)` pairs.

### Go

```go
package main

import "fmt"

func buildSPF(n int) []int {
	spf := make([]int, n+1)
	var primes []int
	for i := 2; i <= n; i++ {
		if spf[i] == 0 {
			spf[i] = i
			primes = append(primes, i)
		}
		for _, p := range primes {
			if p > spf[i] || i*p > n {
				break
			}
			spf[i*p] = p
		}
	}
	return spf
}

func factor(x int, spf []int) [][2]int {
	var res [][2]int
	for x > 1 {
		p, e := spf[x], 0
		for x%p == 0 {
			x /= p
			e++
		}
		res = append(res, [2]int{p, e})
	}
	return res
}

func main() {
	spf := buildSPF(1000)
	fmt.Println(factor(360, spf)) // [[2 3] [3 2] [5 1]]
	fmt.Println(factor(97, spf))  // [[97 1]]
}
```

### Java

```java
import java.util.*;

public class SPFFactor {
    static int[] buildSPF(int n) {
        int[] spf = new int[n + 1];
        List<Integer> primes = new ArrayList<>();
        for (int i = 2; i <= n; i++) {
            if (spf[i] == 0) { spf[i] = i; primes.add(i); }
            for (int p : primes) {
                if (p > spf[i] || (long) i * p > n) break;
                spf[i * p] = p;
            }
        }
        return spf;
    }

    static List<int[]> factor(int x, int[] spf) {
        List<int[]> res = new ArrayList<>();
        while (x > 1) {
            int p = spf[x], e = 0;
            while (x % p == 0) { x /= p; e++; }
            res.add(new int[]{p, e});
        }
        return res;
    }

    public static void main(String[] args) {
        int[] spf = buildSPF(1000);
        for (int[] pe : factor(360, spf)) System.out.print(Arrays.toString(pe) + " ");
        System.out.println(); // [2, 3] [3, 2] [5, 1]
    }
}
```

### Python

```python
def build_spf(n):
    spf = [0] * (n + 1)
    primes = []
    for i in range(2, n + 1):
        if spf[i] == 0:
            spf[i] = i
            primes.append(i)
        for p in primes:
            if p > spf[i] or i * p > n:
                break
            spf[i * p] = p
    return spf


def factor(x, spf):
    res = []
    while x > 1:
        p, e = spf[x], 0
        while x % p == 0:
            x //= p
            e += 1
        res.append((p, e))
    return res


if __name__ == "__main__":
    spf = build_spf(1000)
    print(factor(360, spf))  # [(2, 3), (3, 2), (5, 1)]
    print(factor(97, spf))   # [(97, 1)]
```

---

## Coding Challenge 3 — Segmented sieve for `[L, R]`

**Problem.** Print all primes in `[L, R]` where `1 ≤ L ≤ R ≤ 10^12` and `R − L ≤ 10^6`. Use base primes up to `√R`.

### Go

```go
package main

import (
	"fmt"
	"math"
)

func segmented(L, R int64) []int64 {
	limit := int64(math.Sqrt(float64(R))) + 1
	isComp := make([]bool, limit+1)
	var base []int64
	for p := int64(2); p <= limit; p++ {
		if !isComp[p] {
			base = append(base, p)
			for m := p * p; m <= limit; m += p {
				isComp[m] = true
			}
		}
	}
	size := R - L + 1
	mark := make([]bool, size)
	for _, p := range base {
		start := p * p
		if start < L {
			start = ((L + p - 1) / p) * p
		}
		for m := start; m <= R; m += p {
			mark[m-L] = true
		}
	}
	var primes []int64
	for i := int64(0); i < size; i++ {
		v := L + i
		if v >= 2 && !mark[i] {
			primes = append(primes, v)
		}
	}
	return primes
}

func main() {
	fmt.Println(segmented(10, 30)) // [11 13 17 19 23 29]
}
```

### Java

```java
import java.util.*;

public class Segmented {
    static List<Long> segmented(long L, long R) {
        int limit = (int) Math.sqrt(R) + 1;
        boolean[] isComp = new boolean[limit + 1];
        List<Long> base = new ArrayList<>();
        for (int p = 2; p <= limit; p++) {
            if (!isComp[p]) {
                base.add((long) p);
                for (int m = p * p; m <= limit; m += p) isComp[m] = true;
            }
        }
        int size = (int) (R - L + 1);
        boolean[] mark = new boolean[size];
        for (long p : base) {
            long start = p * p;
            if (start < L) start = ((L + p - 1) / p) * p;
            for (long m = start; m <= R; m += p) mark[(int) (m - L)] = true;
        }
        List<Long> primes = new ArrayList<>();
        for (int i = 0; i < size; i++) {
            long v = L + i;
            if (v >= 2 && !mark[i]) primes.add(v);
        }
        return primes;
    }

    public static void main(String[] args) {
        System.out.println(segmented(10, 30)); // [11, 13, 17, 19, 23, 29]
    }
}
```

### Python

```python
import math


def segmented(L, R):
    limit = int(math.isqrt(R)) + 1
    is_comp = bytearray(limit + 1)
    base = []
    for p in range(2, limit + 1):
        if not is_comp[p]:
            base.append(p)
            for m in range(p * p, limit + 1, p):
                is_comp[m] = 1
    size = R - L + 1
    mark = bytearray(size)
    for p in base:
        start = max(p * p, (L + p - 1) // p * p)
        for m in range(start, R + 1, p):
            mark[m - L] = 1
    return [L + i for i in range(size) if (L + i) >= 2 and not mark[i]]


if __name__ == "__main__":
    print(segmented(10, 30))  # [11, 13, 17, 19, 23, 29]
```

---

## Coding Challenge 4 — Sum of Euler's totient up to n

**Problem.** Compute `Σ_{i=1}^{n} φ(i)` using a linear sieve. Constraints: `1 ≤ n ≤ 5·10^6`. Return the sum (use 64-bit).

### Go

```go
package main

import "fmt"

func sumPhi(n int) int64 {
	phi := make([]int, n+1)
	phi[1] = 1
	spf := make([]int, n+1)
	var primes []int
	for i := 2; i <= n; i++ {
		if spf[i] == 0 {
			spf[i] = i
			phi[i] = i - 1
			primes = append(primes, i)
		}
		for _, p := range primes {
			if p > spf[i] || i*p > n {
				break
			}
			spf[i*p] = p
			if i%p == 0 {
				phi[i*p] = phi[i] * p
			} else {
				phi[i*p] = phi[i] * (p - 1)
			}
		}
	}
	var sum int64
	for i := 1; i <= n; i++ {
		sum += int64(phi[i])
	}
	return sum
}

func main() {
	fmt.Println(sumPhi(10)) // 1+1+2+2+4+2+6+4+6+4 = 32
}
```

### Java

```java
public class SumPhi {
    static long sumPhi(int n) {
        int[] phi = new int[n + 1];
        int[] spf = new int[n + 1];
        phi[1] = 1;
        int[] primes = new int[n];
        int cnt = 0;
        for (int i = 2; i <= n; i++) {
            if (spf[i] == 0) { spf[i] = i; phi[i] = i - 1; primes[cnt++] = i; }
            for (int j = 0; j < cnt; j++) {
                int p = primes[j];
                if (p > spf[i] || (long) i * p > n) break;
                spf[i * p] = p;
                phi[i * p] = (i % p == 0) ? phi[i] * p : phi[i] * (p - 1);
            }
        }
        long sum = 0;
        for (int i = 1; i <= n; i++) sum += phi[i];
        return sum;
    }

    public static void main(String[] args) {
        System.out.println(sumPhi(10)); // 32
    }
}
```

### Python

```python
def sum_phi(n):
    phi = [0] * (n + 1)
    spf = [0] * (n + 1)
    phi[1] = 1
    primes = []
    for i in range(2, n + 1):
        if spf[i] == 0:
            spf[i] = i
            phi[i] = i - 1
            primes.append(i)
        for p in primes:
            if p > spf[i] or i * p > n:
                break
            spf[i * p] = p
            phi[i * p] = phi[i] * p if i % p == 0 else phi[i] * (p - 1)
    return sum(phi[1 : n + 1])


if __name__ == "__main__":
    print(sum_phi(10))  # 32
```

---

## Final Tips

- **State the optimizations out loud:** "start at `p²`, stop at `√n`" signals you know the fast version, not the naive one.
- **Clarify the regime first:** ask whether it is a *range up to `n`* (sieve) or a *single huge number* (Miller-Rabin). Picking the wrong one is the biggest red flag.
- **Mention SPF unprompted** when factorization is involved — it shows you know the linear sieve, not just Eratosthenes.
- **Guard `0`, `1`, and `n < 2`** in your code; interviewers watch for these.
- **Sanity-check with `π(n)`** values to demonstrate you validate, not just write, sieves.
- **Know the boundary:** segmented sieve enumerates a window; counting *all* primes up to `10^12` needs sublinear methods (Lucy/LMO), a great senior-level aside.
