# Linear Sieve & Multiplicative Functions — Interview Preparation

The linear sieve is a favorite interview topic because it rewards one crisp insight — *"mark each composite exactly once, by its smallest prime factor"* — and then tests whether you can (a) state why that gives `O(n)`, (b) explain the `i % p == 0: break` and what breaks without it, (c) extend the pass to compute multiplicative functions (`φ`, `μ`, `τ`, `σ`) via the coprime/square-factor split, and (d) place it all in the Dirichlet-convolution framework and apply Möbius inversion. This file is a tiered question bank (52 Q&A across junior/middle/senior/professional), behavioral prompts, and two end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Task | Tool | Complexity |
|------|------|------------|
| `spf[x]` + primes up to `n` | linear (Euler) sieve | `O(n)` |
| Factor `x ≤ n` after sieve | divide out `spf[x]` | `O(log x)` |
| `φ`/`μ`/`τ`/`σ` for all `x ≤ n` | sieve recurrences | `O(n)` build, `O(1)` query |
| Just primality, large `n` | bitset Eratosthenes | `O(n log log n)` |
| One huge number | Miller-Rabin / Pollard | topics `08`, `09` |

Core loop:

```text
for i = 2..n:
    if spf[i] == 0: spf[i]=i; phi[i]=i-1; mu[i]=-1; primes += i
    for p in primes:
        if p > spf[i] or i*p > n: break
        spf[i*p] = p
        if i % p == 0: phi[i*p]=phi[i]*p;     mu[i*p]=0;       break
        else:          phi[i*p]=phi[i]*(p-1); mu[i*p]=-mu[i]
```

Key facts:
- Each composite is marked **exactly once**, by its smallest prime factor → `O(n)`.
- The `i % p == 0: break` is mandatory for *both* linearity and correctness.
- Coprime case (`p ∤ i`) uses multiplicativity; square case (`p ∣ i`) uses the prime-power rule.
- `τ` needs a `cnt` (exponent) array; `σ` needs a `low` (geometric-sum) array.
- Convolution identities: `τ=1*1`, `σ=id*1`, `φ*1=id`, `μ*1=ε`.

---

## Junior Questions (15 Q&A)

### J1. What does the linear sieve compute?
The smallest prime factor (`spf`) of every number up to `n`, plus the list of primes. From `spf` you can factor any `x ≤ n` in `O(log x)`. It runs in `O(n)`.

### J2. What is the smallest prime factor (SPF) array?
`spf[x]` is the smallest prime dividing `x` (with `spf[p] = p` for a prime). Knowing it lets you factor `x` by repeatedly dividing out `spf[x]`.

### J3. Why is the linear sieve `O(n)`?
Because every composite is marked exactly once — by its smallest prime factor. The total number of markings equals the number of composites, which is `O(n)`.

### J4. What is the role of `i % p == 0: break`?
It stops the inner loop once `p` divides `i`. This guarantees `i·p` is only ever produced when `p` is its smallest prime factor, so each composite is marked once. Without it the sieve double-marks and the function tables go wrong.

### J5. How do you factor a number using `spf`?
`while x > 1: p = spf[x]; record p; while x % p == 0: x /= p`. Each step removes a prime; `x` shrinks to 1 in `O(log x)`.

### J6. What is a multiplicative function?
A function `f` with `f(a·b) = f(a)·f(b)` whenever `gcd(a,b) = 1`, and `f(1) = 1`. Examples: `φ`, `μ`, `τ`, `σ`.

### J7. What does Euler's totient `φ(n)` count?
The number of integers in `[1, n]` that are coprime to `n` (share no common factor). E.g. `φ(12) = 4` (the coprime numbers are 1, 5, 7, 11).

### J8. What is the Möbius function `μ(n)`?
`μ(1)=1`; `μ = (−1)^k` for a product of `k` distinct primes; `μ = 0` if any prime appears squared. E.g. `μ(6) = 1`, `μ(30) = −1`, `μ(12) = 0`.

### J9. What are the two cases when marking `i·p`?
Coprime (`p ∤ i`): use multiplicativity, `f(i·p) = f(i)·f(p)`. Square factor (`p ∣ i`): use the prime-power rule for `f`.

### J10. What must you seed before the loop?
`f(1)` for every function: `φ(1) = μ(1) = τ(1) = σ(1) = 1`. The loop starts at `i = 2` and never sets index 1.

### J11. Why is `μ(12) = 0`?
Because `12 = 2²·3` has a squared prime factor. The Möbius function is `0` for any non-squarefree number.

### J12. Can the linear sieve test if `10^18` is prime?
No — it cannot allocate `10^18` cells. For one huge number use Miller-Rabin (topic `08`). The sieve is for dense ranges up to a memory-fittable `n`.

### J13. What does `σ(n)` mean, and what is `σ(6)`?
`σ(n)` is the sum of all positive divisors of `n`. `σ(6) = 1 + 2 + 3 + 6 = 12`.

### J14. What does `τ(n)` mean, and what is `τ(12)`?
`τ(n)` (also written `d(n)`) is the number of positive divisors of `n`. `12` has divisors `{1,2,3,4,6,12}`, so `τ(12) = 6`.

### J15. Why does the loop start at `i = 2` and not `i = 1`?
`1` has no prime factors and is the multiplicative identity; it is *seeded* before the loop (`f(1) = 1`). Starting the marking loop at `2` means the first composite handled is `4`.

---

## Mid-Level Questions (14 Q&A)

### M1. How does the linear sieve differ from Eratosthenes?
Eratosthenes crosses out each composite once per distinct prime factor (`O(n log log n)`); the linear sieve marks each composite exactly once (`O(n)`) and records `spf`. Eratosthenes uses bits; the linear sieve uses integer arrays.

### M2. Is the linear sieve always faster than Eratosthenes in practice?
No. `log log n` is tiny (< 5), so the constant factor decides. A bitset odd-only Eratosthenes is often faster wall-clock for *pure primality* because its writes are cache-friendly. Use the linear sieve when you need `spf` or a multiplicative function.

### M3. Give the `φ` recurrence in both cases.
Coprime: `φ(i·p) = φ(i)·(p−1)`. Square factor: `φ(i·p) = φ(i)·p`.

### M4. Give the `μ` recurrence in both cases.
Coprime: `μ(i·p) = −μ(i)`. Square factor: `μ(i·p) = 0`.

### M5. How do you sieve `τ` (divisor count)?
Keep `cnt[x]` = exponent of `spf(x)`. Coprime: `τ(i·p)=τ(i)·2`, `cnt=1`. Square: `cnt[i·p]=cnt[i]+1`, `τ(i·p)=τ(i)/(cnt[i]+1)·(cnt[i]+2)`.

### M6. How do you sieve `σ` (divisor sum)?
Keep `low[x] = 1+p+…+p^{cnt}` for `p = spf(x)`. Coprime: `σ(i·p)=σ(i)·(p+1)`, `low=p+1`. Square: `low[i·p]=low[i]·p+1`, `σ(i·p)=σ(i)/low[i]·low[i·p]`.

### M7. Why are the `τ`/`σ` integer divisions exact?
`(cnt+1)` is a genuine factor of `τ(i)` (the divisor-count contribution of the smallest prime), and `low[i]` exactly divides `σ(i)`. So the division leaves no remainder over the integers.

### M8. What is Dirichlet convolution?
`(f*g)(n) = Σ_{d∣n} f(d) g(n/d)`. It is commutative, associative, with identity `ε`. Convolving two multiplicative functions gives a multiplicative function.

### M9. Express `τ` and `σ` as convolutions.
`τ = 1 * 1` and `σ = id * 1`, where `1(n)=1` and `id(n)=n`.

### M10. What is Möbius inversion and why is it useful?
If `g = f * 1` (i.e. `g(n)=Σ_{d∣n} f(d)`), then `f = g * μ`. It turns "sum over divisors" definitions into closed forms — and the linear sieve gives you `μ` for free.

### M11. What goes wrong if you compute `τ`/`σ` recurrences under a modulus?
The integer-division trick fails — `(cnt+1)` may not be invertible mod `M`. Use the modular-safe form: keep per-prime factors (`low`, count factor) and multiply, never divide.

### M12. How do you choose the sieve bound `n`?
Sieve up to exactly the largest `x` you must answer for. Oversizing wastes memory (a common memory-limit cause) and build time.

### M13. The `cnt`/`low` columns "reset" on one branch and "accumulate" on the other — explain.
On the *coprime* branch the smallest prime of `i·p` is the brand-new `p`, so `cnt` resets to `1` and `low` resets to `p+1`. On the *square* branch `p` is already the smallest prime, so `cnt` increments and `low` grows to `low[i]·p + 1`. Reset = "new smallest prime"; accumulate = "same smallest prime, higher power."

### M14. Why does a *prime* index `i` run the inner loop longer than a composite index?
A prime `i` has `spf(i) = i`, so the guard `p > spf[i]` does not fire until `p` reaches `i` itself, and no smaller prime divides `i` to trigger the `i % p == 0` break. So it marks `i·2, i·3, …` up to `i·i`. A composite with a small `spf` breaks almost immediately (often after one marking).

---

## Senior Questions (13 Q&A)

### S1. How wide should each table column be?
`spf` fits in `√n` bits (smallest factor of `x` is `≤ √x`); `μ` is one byte (`int8`); `φ` needs the width of `n`; `σ` needs 64 bits (it exceeds `n`). Size each column to its range.

### S2. Why is the linear sieve memory-bound, and slower than a bitset Eratosthenes?
Its inner loop scatters writes to `i·p` for growing `p`, an irregular stride across several integer arrays that does not fit in cache. Eratosthenes writes single bits in one fixed stride, far more cache-friendly.

### S3. How do you sieve a multiplicative function when `n` exceeds RAM?
Plain segmentation does not carry the recurrence across blocks (it needs `f(x/spf(x))`). Use a block factorization sieve: factor each `x` in a cache-sized block against base primes `≤ √R`, compute `f` from the closed form locally, stream/sum, discard. Memory `O(√n + block)`.

### S4. How would you build these tables as a shared service?
A batch job runs the sieve to the contracted `N`, writes narrow-typed column files, verifies a sample + checksum, and publishes versioned artifacts. Consumers memory-map them read-only (shared page cache). Build once `O(N)`, serve `O(1)` forever.

### S5. What parallelizes and what does not?
The block factorization variant parallelizes (independent blocks, read-only base primes) and so do the prefix-sum/transform passes. The monolithic linear sieve does *not* — the `f(i)→f(i·p)` dependency and shared-array writes prevent it. Partition by block, not by prime.

### S6. Sieve vs on-demand factorization — when each?
Sieve when there are many queries over a range `≤ N` that fits RAM. Factor on demand when queries are few, or `x` is unbounded/huge. Match the tool to query-density × range-size.

### S7. How do you test a table with a billion entries?
Exhaustively verify `x ≤ 10^4` against brute force; random spot-check at scale; validate Dirichlet identities (`Σ_{d∣n}φ(d)=n`, `Σ_{d∣n}μ(d)=[n=1]`) across the small range; checksum columns; and assert the inner loop runs exactly `n − π(n)` times.

### S8. What is the cheapest guard that the linearity-critical break is correct?
Instrument an iteration counter and assert total inner-loop markings equal `n − π(n)`. Any mismatch means a composite was marked more than once — the break is wrong.

### S9. Name three production failure modes.
Overflow in `σ`/`φ` at scale (use 64-bit); `spf` column too narrow (a prime stored as its own spf can exceed `√n`); and silently dropping the break during a refactor (re-marks composites, corrupts tables).

### S10. Why memory-map the tables instead of loading them?
mmap lets the kernel page-cache the columns and share physical pages across processes; cold pages fault in lazily, hot pages stay resident — no per-process copy, no rebuild.

### S11. How do you handle a query for `x > N`?
Fall back to on-demand factorization plus the closed-form formula. Surface `N` in the manifest and error messages so the boundary is explicit, and keep the fallback path warm.

### S12. Why structure-of-arrays instead of array-of-structs for the tables?
SoA (one contiguous array per function) keeps the frequent *sequential* post-passes — prefix-summing `φ`, scanning `μ` — perfectly linear and prefetchable. AoS mixes widths (`int8` `μ` next to `int64` `σ`), padding to the largest member and dragging unrelated bytes into cache on every access.

### S13. Walk through a capacity-planning sizing for a 10 GB table budget.
Pick the kept columns and sum their widths: e.g. `φ` (4B) + `μ` (1B) + `σ` (8B) = 13 B/element, so `N ≈ 10 GB / 13 ≈ 7.5 × 10^8`. The 64-bit `σ` dominates; dropping it roughly triples reachable `N`. Record `N` in the manifest and route `x > N` to the on-demand fallback.

---

## Professional / Theory Questions (10 Q&A)

### P1. Prove the linear sieve marks each composite exactly once.
The map `c ↦ (c/spf(c), spf(c))` is a bijection between composites `≤ n` and the `(i,p)` pairs the sieve marks. Validity: with `q=spf(c)`, `i=c/q`, the cofactor inequality `q ≤ spf(i)` and "no prime `< q` divides `i`" mean the inner loop reaches `p=q` without breaking and sets `spf[c]=q`. Injective: `spf(c)` and `c/spf(c)` determine `c`. Surjective: any marking `spf[i·p]=p` reached without breaking has `p = spf(i·p)`. Hence one marking per composite → `O(n)`.

### P2. Why is the break necessary for correctness (not just speed)?
If `p ∣ i` and you continue to a larger prime `p'`, you set `spf[i·p']=p'`, but `spf(i·p')=p<p'` since `p∣i∣i·p'`. That is a wrong assignment and a double-mark. The break prevents it.

### P3. Prove `φ(p^a) = p^{a-1}(p-1)`.
Among `1..p^a`, exactly the `p^{a-1}` multiples of `p` are not coprime to `p^a`. So `φ(p^a) = p^a − p^{a-1} = p^{a-1}(p-1)`.

### P4. Prove the coprime `φ` recurrence.
If `gcd(i,p)=1`, multiplicativity gives `φ(i·p) = φ(i)φ(p) = φ(i)(p-1)`.

### P5. Prove `μ * 1 = ε`.
For `n = Π p_i^{a_i} > 1`, `Σ_{d∣n} μ(d) = Σ_{S⊆{p_i}} (−1)^{|S|} = (1−1)^{ω(n)} = 0`; at `n=1` the sum is `μ(1)=1`. So `Σ_{d∣n} μ(d) = [n=1] = ε(n)`.

### P6. State and prove Möbius inversion.
If `g = f * 1` then `f = g * μ`. Proof: convolve `g = f*1` with `μ`: `g*μ = f*(1*μ) = f*ε = f`, using associativity and `1*μ=ε`.

### P7. Derive the closed form `φ = id * μ`.
From `φ * 1 = id` (since `Σ_{d∣n}φ(d)=n`), invert: `φ = id * μ`, i.e. `φ(n) = Σ_{d∣n} μ(d)(n/d) = n Π(1−1/p)`.

### P8. Prove convolution of multiplicative functions is multiplicative.
For `gcd(m,n)=1`, each `d∣mn` splits uniquely as `d=d_1 d_2`, `d_1∣m`, `d_2∣n`, coprime; expanding `(f*g)(mn)` factors into `(f*g)(m)(f*g)(n)`.

### P9. Why is `τ = 1 * 1`?
`(1*1)(n) = Σ_{d∣n} 1·1 = Σ_{d∣n} 1 =` number of divisors `= τ(n)`.

### P10. Which identity check is the strongest validator of a sieved table, and why?
`Σ_{d∣n} φ(d) = n` and `Σ_{d∣n} μ(d) = [n=1]`. They validate the *relationships* across the whole range, catching errors that point checks at a few values would miss.

---

## Behavioral / Communication Prompts

- *Explain the linear sieve to someone who only knows Eratosthenes.* Lead with "each composite marked once, by its smallest prime factor," then the break rule, then the `O(n)` consequence.
- *You inherited a sieve that gives wrong `μ` for some numbers. How do you debug?* Check the square-factor branch (`μ=0` when `p∣i`) and that the break is present; validate against brute force for `x ≤ 1000`; use the `μ*1=ε` identity.
- *A teammate removed `i % p == 0: break` to "simplify." What do you tell them?* It is not a simplification — it is required for both `O(n)` and correctness; demonstrate the double-marking and the wrong `spf` it causes.
- *When would you push back on building a giant precompute table?* When queries are sparse or `x` is unbounded — on-demand factorization is cheaper than `O(N)` memory and build time.

---

## Coding Challenge (3 Languages)

### Challenge: Sum of Euler's totient with squarefree count

> Given `n`, build the linear sieve and return two values:
> 1. `S = Σ_{x=1}^{n} φ(x)` (the totient summatory function), and
> 2. `Q = ` the count of squarefree integers in `[1, n]` (those with `μ(x) ≠ 0`).
>
> Constraints: `1 ≤ n ≤ 10^7`. Must run in `O(n)` time. Validate: for `n = 100`, `S = 3045` and `Q = 61`.

#### Go

```go
package main

import "fmt"

func solve(n int) (int64, int) {
	spf := make([]int, n+1)
	phi := make([]int, n+1)
	mu := make([]int8, n+1)
	if n >= 1 {
		phi[1], mu[1] = 1, 1
	}
	primes := make([]int, 0, 1024)
	for i := 2; i <= n; i++ {
		if spf[i] == 0 {
			spf[i], phi[i], mu[i] = i, i-1, -1
			primes = append(primes, i)
		}
		for _, p := range primes {
			if p > spf[i] || i*p > n {
				break
			}
			ip := i * p
			spf[ip] = p
			if i%p == 0 {
				phi[ip] = phi[i] * p
				mu[ip] = 0
				break
			}
			phi[ip] = phi[i] * (p - 1)
			mu[ip] = -mu[i]
		}
	}
	var sum int64
	q := 0
	for x := 1; x <= n; x++ {
		sum += int64(phi[x])
		if mu[x] != 0 {
			q++
		}
	}
	return sum, q
}

func main() {
	s, q := solve(100)
	fmt.Println(s, q) // 3045 61
}
```

#### Java

```java
public class Solution {
    public static long[] solve(int n) {
        int[] spf = new int[n + 1];
        int[] phi = new int[n + 1];
        byte[] mu = new byte[n + 1];
        if (n >= 1) { phi[1] = 1; mu[1] = 1; }
        int[] primes = new int[Math.max(16, n)];
        int pc = 0;
        for (int i = 2; i <= n; i++) {
            if (spf[i] == 0) { spf[i] = i; phi[i] = i - 1; mu[i] = -1; primes[pc++] = i; }
            for (int k = 0; k < pc; k++) {
                int p = primes[k];
                if (p > spf[i] || (long) i * p > n) break;
                int ip = i * p;
                spf[ip] = p;
                if (i % p == 0) { phi[ip] = phi[i] * p; mu[ip] = 0; break; }
                phi[ip] = phi[i] * (p - 1); mu[ip] = (byte) -mu[i];
            }
        }
        long sum = 0; long q = 0;
        for (int x = 1; x <= n; x++) { sum += phi[x]; if (mu[x] != 0) q++; }
        return new long[]{sum, q};
    }

    public static void main(String[] args) {
        long[] r = solve(100);
        System.out.println(r[0] + " " + r[1]); // 3045 61
    }
}
```

#### Python

```python
def solve(n):
    spf = [0] * (n + 1)
    phi = [0] * (n + 1)
    mu = [0] * (n + 1)
    if n >= 1:
        phi[1] = mu[1] = 1
    primes = []
    for i in range(2, n + 1):
        if spf[i] == 0:
            spf[i], phi[i], mu[i] = i, i - 1, -1
            primes.append(i)
        for p in primes:
            if p > spf[i] or i * p > n:
                break
            ip = i * p
            spf[ip] = p
            if i % p == 0:
                phi[ip] = phi[i] * p
                mu[ip] = 0
                break
            phi[ip] = phi[i] * (p - 1)
            mu[ip] = -mu[i]
    s = sum(phi[1:])
    q = sum(1 for x in range(1, n + 1) if mu[x] != 0)
    return s, q


if __name__ == "__main__":
    print(solve(100))  # (3045, 61)
```

**Discussion points the interviewer looks for:** the `i % p == 0: break` (correctness + `O(n)`), seeding `φ(1)=μ(1)=1`, using a byte for `μ`, 64-bit accumulation for the sum, and recognizing that "squarefree" ⇔ `μ ≠ 0`. A strong candidate also notes that `Σφ` could overflow 32-bit for large `n` and validates against the `n=100` reference values.

---

## Coding Challenge 2 (3 Languages)

### Challenge: Divisor count and divisor sum with the auxiliary arrays

> Given `n`, build the linear sieve maintaining `τ` (divisor count) and `σ` (divisor sum) via the `cnt` and `low` auxiliary arrays. Return:
> 1. `maxTau` = the maximum `τ(x)` over `x ∈ [1, n]` (a "highly composite" indicator), and
> 2. `sumSigma = Σ_{x=1}^{n} σ(x)`.
>
> Constraints: `1 ≤ n ≤ 10^6`. Must run in `O(n)`. Validate: for `n = 12`, `maxTau = 6` (at `x = 12`) and `sumSigma = 1 + 3 + 4 + 7 + 6 + 12 + 8 + 15 + 13 + 18 + 12 + 28 = 127`.

This challenge specifically exercises the square-factor branch's exact integer division — the part candidates most often get wrong. Watch for: maintaining `cnt`/`low`, the exact `/(cnt+1)*(cnt+2)` order for `τ`, the `/low*low_new` order for `σ`, and 64-bit accumulation for `sumSigma`.

#### Go

```go
package main

import "fmt"

func solve2(n int) (int, int64) {
	spf := make([]int, n+1)
	tau := make([]int, n+1)
	sigma := make([]int64, n+1)
	cnt := make([]int, n+1)
	low := make([]int64, n+1)
	if n >= 1 {
		tau[1], sigma[1] = 1, 1
	}
	primes := make([]int, 0, 1024)
	for i := 2; i <= n; i++ {
		if spf[i] == 0 {
			spf[i] = i
			tau[i], cnt[i] = 2, 1
			sigma[i] = int64(i) + 1
			low[i] = int64(i) + 1
			primes = append(primes, i)
		}
		for _, p := range primes {
			if p > spf[i] || i*p > n {
				break
			}
			ip := i * p
			spf[ip] = p
			if i%p == 0 { // square factor
				cnt[ip] = cnt[i] + 1
				tau[ip] = tau[i] / (cnt[i] + 1) * (cnt[i] + 2)
				low[ip] = low[i]*int64(p) + 1
				sigma[ip] = sigma[i] / low[i] * low[ip]
				break
			}
			cnt[ip] = 1
			tau[ip] = tau[i] * 2
			low[ip] = int64(p) + 1
			sigma[ip] = sigma[i] * (int64(p) + 1)
		}
	}
	maxTau := 0
	var sumSigma int64
	for x := 1; x <= n; x++ {
		if tau[x] > maxTau {
			maxTau = tau[x]
		}
		sumSigma += sigma[x]
	}
	return maxTau, sumSigma
}

func main() {
	t, s := solve2(12)
	fmt.Println(t, s) // 6 127
}
```

#### Java

```java
public class Solution2 {
    public static long[] solve2(int n) {
        int[] spf = new int[n + 1];
        int[] tau = new int[n + 1];
        long[] sigma = new long[n + 1];
        int[] cnt = new int[n + 1];
        long[] low = new long[n + 1];
        if (n >= 1) { tau[1] = 1; sigma[1] = 1; }
        int[] primes = new int[Math.max(16, n)];
        int pc = 0;
        for (int i = 2; i <= n; i++) {
            if (spf[i] == 0) {
                spf[i] = i; tau[i] = 2; cnt[i] = 1;
                sigma[i] = i + 1L; low[i] = i + 1L;
                primes[pc++] = i;
            }
            for (int k = 0; k < pc; k++) {
                int p = primes[k];
                if (p > spf[i] || (long) i * p > n) break;
                int ip = i * p;
                spf[ip] = p;
                if (i % p == 0) { // square factor
                    cnt[ip] = cnt[i] + 1;
                    tau[ip] = tau[i] / (cnt[i] + 1) * (cnt[i] + 2);
                    low[ip] = low[i] * p + 1;
                    sigma[ip] = sigma[i] / low[i] * low[ip];
                    break;
                }
                cnt[ip] = 1;
                tau[ip] = tau[i] * 2;
                low[ip] = p + 1L;
                sigma[ip] = sigma[i] * (p + 1L);
            }
        }
        int maxTau = 0; long sumSigma = 0;
        for (int x = 1; x <= n; x++) {
            if (tau[x] > maxTau) maxTau = tau[x];
            sumSigma += sigma[x];
        }
        return new long[]{maxTau, sumSigma};
    }

    public static void main(String[] args) {
        long[] r = solve2(12);
        System.out.println(r[0] + " " + r[1]); // 6 127
    }
}
```

#### Python

```python
def solve2(n):
    spf = [0] * (n + 1)
    tau = [0] * (n + 1)
    sigma = [0] * (n + 1)
    cnt = [0] * (n + 1)
    low = [0] * (n + 1)
    if n >= 1:
        tau[1] = sigma[1] = 1
    primes = []
    for i in range(2, n + 1):
        if spf[i] == 0:
            spf[i] = i
            tau[i] = 2
            cnt[i] = 1
            sigma[i] = i + 1
            low[i] = i + 1
            primes.append(i)
        for p in primes:
            if p > spf[i] or i * p > n:
                break
            ip = i * p
            spf[ip] = p
            if i % p == 0:  # square factor
                cnt[ip] = cnt[i] + 1
                tau[ip] = tau[i] // (cnt[i] + 1) * (cnt[i] + 2)
                low[ip] = low[i] * p + 1
                sigma[ip] = sigma[i] // low[i] * low[ip]
                break
            cnt[ip] = 1
            tau[ip] = tau[i] * 2
            low[ip] = p + 1
            sigma[ip] = sigma[i] * (p + 1)
    max_tau = max(tau[1:]) if n >= 1 else 0
    sum_sigma = sum(sigma[1:])
    return max_tau, sum_sigma


if __name__ == "__main__":
    print(solve2(12))  # (6, 127)
```

**Discussion points the interviewer looks for:** correct `cnt`/`low` maintenance, the *exact* integer-division order in the square branch (divide-then-multiply keeps it exact because `(cnt+1) ∣ τ` and `low[i] ∣ σ`), 64-bit `σ` to avoid overflow, and the reset-vs-accumulate behavior of the auxiliaries. A candidate who notes that these division tricks would break under a modulus (no integer inverse) and would need the modular-safe per-prime-factor form is demonstrating senior depth.

---

## Further Reading

- Sibling file [`junior.md`](./junior.md) — mechanics of the sieve and the SPF array.
- Sibling file [`middle.md`](./middle.md) — full recurrences and Dirichlet-convolution context.
- Sibling file [`senior.md`](./senior.md) — scaling, memory, batch precompute systems.
- Sibling file [`professional.md`](./professional.md) — the `O(n)` bijection proof and convolution correctness proofs.
- cp-algorithms.com — "Linear Sieve", "Möbius function", "Euler's totient function".
- Sibling topic `03-prime-sieves` — Eratosthenes and segmented sieve.
- Sibling file [`tasks.md`](./tasks.md) — graded practice exercises.
