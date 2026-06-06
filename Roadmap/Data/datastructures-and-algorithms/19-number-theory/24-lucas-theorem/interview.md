# Lucas' Theorem — Interview Preparation

Lucas' theorem is a favourite because it rewards one crisp insight — *"write `n` and `k` in base `p`, multiply the small digit-binomials `C(n_i, k_i) mod p`, and short-circuit to `0` if any `k_i > n_i`"* — and then probes whether you can (a) explain *why* it works (Frobenius), (b) pick it over the plain factorial table by reasoning about the sizes of `n` and `p`, (c) extend it to composite moduli via CRT, and (d) avoid the trap of applying it to a non-prime modulus. This file is a tiered question bank plus a full coding challenge in Go, Java, and Python.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| `C(n,k) mod p`, `p` prime, huge `n` | Lucas: `∏ C(n_i,k_i)` over base-`p` digits | `O(p + log_p n)` |
| Any digit `k_i > n_i`? | short-circuit | answer `0` |
| Small `C(a,b) mod p`, `a,b<p` | `fact[a]·invFact[b]·invFact[a-b]` | `O(1)` |
| `C(n,k) mod 2` | `(k & n) == k` ? odd : even | `O(1)` |
| `C(n,k) mod M`, `M` square-free | Lucas per prime + CRT | `O(Σ p_i + log n)` |
| `C(n,k) mod p^e` | Granville / Andrew factorial | `O(p^e + e log_p n)` |
| `v_p(C(n,k))` | Kummer: #carries in `k+(n-k)` base `p` | `O(log_p n)` |
| Plain factorial method | `fact[n]·invFact[k]·invFact[n-k]` | `O(n)` setup, `O(1)` query |

Key facts:
- **Lucas requires `p` prime.** Composite → CRT (square-free) or Granville (prime power).
- Build `invFact` with **one** Fermat inverse + backward recurrence: `O(p)`.
- The per-digit factorials are never `0 mod p` because all arguments are `< p`.
- `p ∤ C(n,k)` **iff** every base-`p` digit `k_i ≤ n_i` (Lucas) **iff** no carries adding `k + (n-k)` (Kummer).
- Use Lucas when `n` is huge and `p` is *small*; use the `O(n)` table when `p` is large and `n` is moderate.

Core routine:

```text
lucas(n, k, p):                      # O(p + log_p n)
    build fact, invFact of size p    # once
    res = 1
    while n > 0 or k > 0:
        ni, ki = n % p, k % p
        if ki > ni: return 0         # short-circuit
        res = res * fact[ni]*invFact[ki]*invFact[ni-ki] % p
        n //= p; k //= p
    return res
```

---

## Junior Questions (12 Q&A)

### J1. State Lucas' theorem.
For a prime `p`, if `n = Σ n_i p^i` and `k = Σ k_i p^i` are the base-`p` expansions, then `C(n, k) ≡ ∏_i C(n_i, k_i) (mod p)`, with each factor `0` if `k_i > n_i`.

### J2. What problem does Lucas solve that the factorial method cannot?
Computing `C(n, k) mod p` when `n` is astronomically large (e.g. `10^18`). The factorial method needs an array of size `n`, which is impossible; Lucas needs only a size-`p` table.

### J3. How do you get the base-`p` digits of a number?
Repeatedly take `digit = x % p` and `x //= p` until `x = 0`. The digits come out least-significant first.

### J4. What is the short-circuit rule?
If at any digit position `k_i > n_i`, then `C(n_i, k_i) = 0`, so the whole product is `0`. You can return `0` immediately.

### J5. Why does Lucas require `p` to be prime?
The proof relies on `(1+x)^p ≡ 1 + x^p (mod p)`, which holds only for prime `p` (the interior binomials `C(p,j)` are divisible by `p`). For composite moduli the digit factorization is invalid.

### J6. How do you compute a small binomial `C(a, b) mod p` with `a, b < p`?
`C(a, b) ≡ fact[a] · invFact[b] · invFact[a-b] (mod p)`, using precomputed factorial and inverse-factorial tables of size `p`.

### J7. What is the time complexity of one Lucas query?
`O(p + log_p n)`: `O(p)` to build the table once, then `O(log_p n)` digits, each handled in `O(1)`.

### J8. What is `C(n, k) mod 2` in one line?
`C(n, k)` is odd iff `(k & n) == k` (every set bit of `k` is also set in `n`); otherwise it is even (`0 mod 2`).

### J9. Why are the per-digit factorials never zero mod `p`?
Because all digit arguments are `< p`, and the smallest factorial containing the factor `p` is `p!`. So `fact[i]` for `i < p` is coprime to `p` and invertible.

### J10. What does Lucas give you when `k = 0`?
All `k_i = 0`, every factor is `C(n_i, 0) = 1`, so the product is `1` — matching `C(n, 0) = 1`.

### J11. How does Lucas handle a composite modulus like `6`?
Plain Lucas does not apply to `6`. Since `6 = 2·3` is square-free, compute `C(n,k) mod 2` and `mod 3` with Lucas, then combine via CRT.

### J12 (analysis). Why is one query `O(log_p n)` and not `O(n)`?
Because the number of base-`p` digits of `n` is `⌊log_p n⌋ + 1`, and we process one digit per iteration. `n` only appears under a logarithm.

---

## Middle Questions (12 Q&A)

### M1. Sketch why Lucas is true.
`(1+x)^n = ∏_i ((1+x)^{p^i})^{n_i} ≡ ∏_i (1 + x^{p^i})^{n_i} (mod p)` by the Frobenius identity. The coefficient of `x^k` (using uniqueness of base-`p` representation) is `∏_i C(n_i, k_i)`, which equals `C(n,k)`.

### M2. State the Frobenius identity and why it holds.
`(1+x)^p ≡ 1 + x^p (mod p)`. Every interior coefficient `C(p,j)` for `0<j<p` is divisible by `p` because `p | p!` but `p ∤ j!(p-j)!`.

### M3. When do you prefer the factorial table over Lucas?
When the modulus is a *large* prime (like `10^9+7`) and `n` is moderate (`≤ 10^7`). Then the `O(n)` table with `O(1)` queries beats a size-`10^9` Lucas table (infeasible).

### M4. When do you prefer Lucas over the factorial table?
When `n` is huge (`≫ 10^8`) and the prime `p` is small enough that a size-`p` table fits (say `p ≤ 10^6`).

### M5. How do you handle a square-free modulus `M = p_1 … p_r`?
Run Lucas mod each distinct prime to get residues `r_i`, then CRT-combine them into the answer mod `M`. The per-prime queries are independent and parallelizable.

### M6. Why can't you apply Lucas mod `4`?
`4 = 2^2` is not prime, and `(1+x)^2 ≡ 1 + x^2` does *not* hold mod 4. You need the Granville/Andrew prime-power extension.

### M7. How do you build `invFact` efficiently?
Compute one Fermat inverse `invFact[p-1] = fact[p-1]^(p-2)`, then walk down with `invFact[i-1] = invFact[i] * i (mod p)`. Total `O(p)`, one exponentiation.

### M8. What is the corollary of Lucas about divisibility?
`p ∤ C(n, k)` iff every base-`p` digit of `k` is `≤` the corresponding digit of `n`. Equivalently, the number of `k ∈ [0,n]` with `p ∤ C(n,k)` is `∏_i (n_i + 1)`.

### M9. How does the choice of prime `p` trade off cost?
Larger `p` → fewer digits (`log_p n` smaller) but a bigger `O(p)` table. Pick the largest `p` whose table fits in your memory budget to minimize digit count.

### M10. How would you count odd entries in Pascal's row `n`?
By the mod-2 Lucas rule, row `n` has `2^(popcount(n))` odd entries (each set bit of `n` independently allows the corresponding `k`-bit to be 0 or 1).

### M11. How do you test a Lucas implementation?
Compare against a Pascal's-triangle oracle for all small `n, k, p`; that catches digit-loop and short-circuit bugs.

### M12 (analysis). Why is the digit loop's stopping condition `n > 0 OR k > 0`?
If you stop at `n > 0` only, you drop high digits of `k` — missing a short-circuit when `k`'s high digits exceed `n`'s (zero) digits. The OR is required.

---

## Senior Questions (10 Q&A)

### S1. Design a service answering `C(n,k) mod M` for many `M`.
A modulus router factors `M`, dispatches each prime to a Lucas kernel (small prime), Granville kernel (prime power), or CRT combiner (square-free / general). Shared immutable factorial tables, a result cache for zero short-circuits, and stateless horizontally-scaled workers.

### S2. How do you share factorial tables across workers?
Build once, mark immutable, then replicate or memory-map. Reads need no locks because the tables never change. Warm them in the readiness probe to avoid cold-start latency spikes.

### S3. What is the DoS risk in a Lucas service?
A user-supplied large prime triggers an `O(p)` multi-GB table build. Mitigate by whitelisting supported primes and routing large-prime requests to the factorial-table kernel with an `n` bound.

### S4. How do you parallelize a composite-modulus query?
The per-prime (or per-prime-power) Lucas/Granville queries are independent — fan them out across cores, then reduce with CRT. Wall-clock latency is the `max`, not the sum.

### S5. Why is a shadow validator essential?
Lucas bugs are *silent* — a wrong digit loop returns a plausible integer, not an exception. A background check against a bignum/Pascal oracle on random small inputs catches regressions.

### S6. How do you precompute CRT coefficients for a fixed `M`?
The `M_i = M / p_i` and their inverses depend only on `M`, not on `(n,k)`. Compute them once when `M` is registered, so each query's CRT step is cheap.

### S7. What invariant must the modulus router enforce?
Never send a non-prime (or prime power) to the plain Lucas kernel, and ensure CRT moduli are pairwise coprime. Classify each factor at factorization time.

### S8. How do you choose between many small primes vs one larger prime for a fixed huge `n`?
Larger prime → fewer digits but bigger table. Under a memory budget, the largest fitting prime minimizes per-query digit count; the one-time table build dominates, so size the prime to the memory ceiling.

### S9. What metrics would you alert on?
`table_memory_bytes` vs budget, `table_build_seconds` (too large), `crt_combine_errors` and `oracle_mismatch_total` (any > 0 is a bug), `result_cache_hit_ratio`, `query_latency_p99`.

### S10. How do you avoid a cache stampede building a hot table?
Single-flight: one goroutine/thread builds the table while others wait, via a per-prime lock (e.g. `computeIfAbsent` / a mutex-guarded map). The senior `TableCache` does this.

---

## Professional Questions (8 Q&A)

### P1. Prove Lucas via generating functions.
In `𝔽_p[x]`, `(1+x)^n = ∏_i ((1+x)^{p^i})^{n_i} ≡ ∏_i (1+x^{p^i})^{n_i}` by iterated Frobenius. The coefficient of `x^k` requires picking digit `k_i` from each factor (uniqueness of base-`p` representation), giving `∏_i C(n_i,k_i)`. Comparing to the coefficient `C(n,k)` proves the theorem.

### P2. State and prove the one-digit peel lemma.
With `n = pN + a`, `k = pK + b`, `0 ≤ a,b < p`: `C(n,k) ≡ C(N,K)·C(a,b) (mod p)`. Proof: `(1+x)^n ≡ (1+x^p)^N (1+x)^a`; forming `x^{pK+b}` forces `x^{pK}` from the first factor and `x^b` from the second, so the coefficient is `C(N,K)C(a,b)`.

### P3. State Kummer's theorem and its relation to Lucas.
`v_p(C(n,k))` equals the number of carries when adding `k` and `n−k` in base `p`. Lucas's "`p ∤ C(n,k)`" is the zero-carry case `v_p = 0`, equivalently `k_i ≤ n_i` for all `i`.

### P4. Why does plain Lucas fail mod `p^e`?
Because `(1+x)^p ≡ 1 + x^p` holds mod `p` but not mod `p^2`; the interior terms are divisible by `p` but not by `p^2`. The digit factorization breaks.

### P5. Outline the Granville/Andrew extension mod `p^e`.
Use Andrew's factorial `(m!)_p` = product of integers `≤ m` coprime to `p`. Separate `m! = p^{⌊m/p⌋} ⌊m/p⌋! (m!)_p`; the `p`-powers sum to `v_p(C(n,k))` (Kummer), and the coprime parts are evaluated mod `p^e` via Wilson-style `±1` periodicity over blocks of `p^e`. Assemble `p^μ · ∏ (N_i!)_p / ((K_i!)_p (N_i−K_i)!)_p)`.

### P6. How do you compute `C(n,k)` mod a general composite `M`?
Factor `M = ∏ q_j^{e_j}`. Compute each `C(n,k) mod q_j^{e_j}` (Lucas if `e_j=1`, Granville if `e_j≥2`), then CRT-combine. CRT works because the prime powers are pairwise coprime.

### P7. What is the optimal complexity, and is the `log_p n` term tight?
Plain Lucas is `O(p + log_p n)`. The `log_p n` term is optimal in the digit-streaming model: any method must read the `Θ(log_p n)` base-`p` digits of `n`. The `O(p)` table can be traded for `O(log p)` per digit (on-the-fly inverses), giving `O(log p · log_p n)` time, `O(1)` space.

### P8. Derive the count of nonzero binomials in row `n` mod `p`.
By Lucas, `C(n,k) ≢ 0` iff each `k_i ≤ n_i`. For each digit position there are `n_i + 1` valid choices of `k_i`, independently, so the count is `∏_i (n_i + 1)`.

---

## Rapid-Fire Round (8 short Q&A)

### R1. `C(n, n) mod p`?
Always `1` — every digit `k_i = n_i`, so each factor is `C(n_i, n_i) = 1`.

### R2. `C(10, 3) mod 5`?
`10 = (20)_5`, `3 = (03)_5`. Pairs: `C(2,0)=1`, `C(0,3)=0` → short-circuit → `0`. (Check: `C(10,3)=120`, `120 mod 5 = 0`.)

### R3. Can Lucas use a non-prime that "looks fine"?
No. Even if a composite happens to give a correct answer for one input, the digit factorization is not valid in general. Always factor and route.

### R4. What table sizes make Lucas impractical?
When `p` exceeds your memory budget for an `O(p)` array — practically around `p > 10^6`–`10^7`.

### R5. Does Lucas need modular inverses?
Only inside the per-digit small binomial (`fact[a]·invFact[b]·invFact[a-b]`). The inverse-factorial table is built once with a single Fermat inverse.

### R6. How many digits does `n = 10^18` have in base `1009`?
`log_1009(10^18) ≈ 18 / 3.0 ≈ 6` digits — so ~6 iterations per query.

### R7. Is `C(n, k) = C(n, n-k)` reflected in Lucas?
Yes — it holds digit-wise where there are no carries; more cleanly, both sides reduce to the same product of small symmetric binomials when valid. Use whichever `k` is smaller in practice.

### R8. What's the relationship between Lucas and Kummer?
Kummer gives `v_p(C(n,k))` = #carries adding `k + (n-k)` in base `p`; Lucas's nonzero condition is the zero-carry boundary of Kummer.

---

## Common Traps Checklist

| Trap | Symptom | Fix |
|------|---------|-----|
| Non-prime modulus to plain Lucas | wrong answers, no error | factor `M`; CRT (square-free) or Granville (prime power) |
| Loop `while n > 0` only | drops high `k` digits | loop `while n > 0 OR k > 0` |
| Rebuild table per call | slow, `O(p)` each query | build once, reuse |
| Big prime → huge table | OOM | use factorial table if `n` small; whitelist primes in a service |
| Forgot short-circuit | garbage product | return `0` when `k_i > n_i` |
| `invFact` via `p` separate inversions | slow setup | one Fermat inverse + backward recurrence |
| Prime power via CRT with plain Lucas | wrong for `p^e` | use Granville for repeated prime factors |

---

## Behavioral / Communication Prompts

- *Explain Lucas to a teammate who knows binomials but not number theory.* Lead with the base-`p` digit picture and the "multiply small binomials" rule before any algebra.
- *You shipped a counting service and results are subtly wrong for some moduli.* Walk through: is the modulus prime? square-free? a prime power? Did a non-prime reach the Lucas kernel?
- *Justify choosing `p = 1009` over `p = 10^9+7` for a problem with `n = 10^18`.* Table size vs digit count trade-off.

---

## Coding Challenge (3 Languages)

### Challenge: Lucas Binomial Queries

> **Problem.** You are given a prime `p` (`2 ≤ p ≤ 10^5`) and `Q` queries, each a pair `(n, k)` with `0 ≤ k ≤ n ≤ 10^18`. For each query output `C(n, k) mod p`. Build the size-`p` factorial table **once**; answer each query in `O(log_p n)`. Use the short-circuit to return `0` as soon as a base-`p` digit `k_i > n_i`.
>
> Total complexity must be `O(p + Q · log_p n)`.

#### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func powMod(a, e, m int64) int64 {
	a %= m
	if a < 0 {
		a += m
	}
	r := int64(1) % m
	for e > 0 {
		if e&1 == 1 {
			r = r * a % m
		}
		a = a * a % m
		e >>= 1
	}
	return r
}

type Lucas struct {
	p             int64
	fact, invFact []int64
}

func NewLucas(p int64) *Lucas {
	f := make([]int64, p)
	inv := make([]int64, p)
	f[0] = 1 % p
	for i := int64(1); i < p; i++ {
		f[i] = f[i-1] * i % p
	}
	inv[p-1] = powMod(f[p-1], p-2, p)
	for i := p - 1; i > 0; i-- {
		inv[i-1] = inv[i] * i % p
	}
	return &Lucas{p, f, inv}
}

func (l *Lucas) C(n, k int64) int64 {
	if k < 0 || k > n {
		return 0
	}
	res := int64(1) % l.p
	for n > 0 || k > 0 {
		ni, ki := n%l.p, k%l.p
		if ki > ni {
			return 0
		}
		res = res * l.fact[ni] % l.p * l.invFact[ki] % l.p * l.invFact[ni-ki] % l.p
		n /= l.p
		k /= l.p
	}
	return res
}

func main() {
	reader := bufio.NewReader(os.Stdin)
	writer := bufio.NewWriter(os.Stdout)
	defer writer.Flush()
	var p int64
	var q int
	fmt.Fscan(reader, &p, &q)
	l := NewLucas(p)
	for ; q > 0; q-- {
		var n, k int64
		fmt.Fscan(reader, &n, &k)
		fmt.Fprintln(writer, l.C(n, k))
	}
}
```

#### Java

```java
import java.io.*;
import java.util.*;

public class Solution {
    static long p;
    static long[] fact, invFact;

    static long powMod(long a, long e, long m) {
        a %= m; if (a < 0) a += m;
        long r = 1 % m;
        while (e > 0) { if ((e & 1) == 1) r = r * a % m; a = a * a % m; e >>= 1; }
        return r;
    }

    static void build(long prime) {
        p = prime;
        fact = new long[(int) p];
        invFact = new long[(int) p];
        fact[0] = 1 % p;
        for (int i = 1; i < p; i++) fact[i] = fact[i - 1] * i % p;
        invFact[(int) p - 1] = powMod(fact[(int) p - 1], p - 2, p);
        for (int i = (int) p - 1; i > 0; i--) invFact[i - 1] = invFact[i] * i % p;
    }

    static long binom(long n, long k) {
        if (k < 0 || k > n) return 0;
        long res = 1 % p;
        while (n > 0 || k > 0) {
            long ni = n % p, ki = k % p;
            if (ki > ni) return 0;
            res = res * fact[(int) ni] % p * invFact[(int) ki] % p
                      * invFact[(int) (ni - ki)] % p;
            n /= p; k /= p;
        }
        return res;
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringBuilder sb = new StringBuilder();
        StringTokenizer st = new StringTokenizer(br.readLine());
        build(Long.parseLong(st.nextToken()));
        int q = Integer.parseInt(st.nextToken());
        while (q-- > 0) {
            st = new StringTokenizer(br.readLine());
            long n = Long.parseLong(st.nextToken());
            long k = Long.parseLong(st.nextToken());
            sb.append(binom(n, k)).append('\n');
        }
        System.out.print(sb);
    }
}
```

#### Python

```python
import sys


def build(p):
    fact = [1] * p
    for i in range(1, p):
        fact[i] = fact[i - 1] * i % p
    inv_fact = [1] * p
    inv_fact[p - 1] = pow(fact[p - 1], p - 2, p)
    for i in range(p - 1, 0, -1):
        inv_fact[i - 1] = inv_fact[i] * i % p
    return fact, inv_fact


def lucas(n, k, p, fact, inv_fact):
    if k < 0 or k > n:
        return 0
    res = 1 % p
    while n > 0 or k > 0:
        ni, ki = n % p, k % p
        if ki > ni:
            return 0
        res = res * fact[ni] % p * inv_fact[ki] % p * inv_fact[ni - ki] % p
        n //= p
        k //= p
    return res


def main():
    data = sys.stdin.read().split()
    idx = 0
    p = int(data[idx]); idx += 1
    q = int(data[idx]); idx += 1
    fact, inv_fact = build(p)
    out = []
    for _ in range(q):
        n = int(data[idx]); k = int(data[idx + 1]); idx += 2
        out.append(str(lucas(n, k, p, fact, inv_fact)))
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
```

**Sample input**

```
3 3
13 4
5 3
1000000000000 500000000000
```

**Sample output**

```
1
1
... (the third line is C(10^12, 5*10^11) mod 3)
```

> **Test ideas:** verify against a Pascal's-triangle oracle for all `n, k ≤ 30` and small primes; check `C(n,0)=1`, `C(n,n)=1`, `k>n → 0`; check the `p=2` answers against `(k & n) == k`; stress with `n = 10^18` to confirm `O(log_p n)` per query.

---

## Coding Challenge 2 — Square-Free Modulus via Lucas + CRT

> **Problem.** Given a list of **distinct** primes `p_1, …, p_r` (each `≤ 10^4`) whose product `M` fits in 64-bit, and a query `(n, k)` with `0 ≤ k ≤ n ≤ 10^18`, output `C(n, k) mod M`. Compute `C(n,k) mod p_i` with Lucas for each prime, then combine via CRT.
>
> Complexity: `O(Σ p_i + r · log n)`.

#### Go

```go
package main

import "fmt"

func powMod(a, e, m int64) int64 {
	a %= m
	if a < 0 {
		a += m
	}
	r := int64(1) % m
	for e > 0 {
		if e&1 == 1 {
			r = r * a % m
		}
		a = a * a % m
		e >>= 1
	}
	return r
}

func lucas(n, k, p int64) int64 {
	if k < 0 || k > n {
		return 0
	}
	fact := make([]int64, p)
	fact[0] = 1 % p
	for i := int64(1); i < p; i++ {
		fact[i] = fact[i-1] * i % p
	}
	res := int64(1) % p
	for n > 0 || k > 0 {
		ni, ki := n%p, k%p
		if ki > ni {
			return 0
		}
		denom := fact[ki] * fact[ni-ki] % p
		res = res * (fact[ni] * powMod(denom, p-2, p) % p) % p
		n /= p
		k /= p
	}
	return res
}

func crt(r, m []int64) int64 {
	M := int64(1)
	for _, mi := range m {
		M *= mi
	}
	x := int64(0)
	for i := range m {
		Mi := M / m[i]
		inv := powMod(Mi%m[i], m[i]-2, m[i])
		x = (x + r[i]%m[i]*(Mi%M)%M*inv) % M
	}
	return (x%M + M) % M
}

func main() {
	primes := []int64{3, 5, 7}
	n, k := int64(1000000000000), int64(500000000000)
	res := make([]int64, len(primes))
	for i, p := range primes {
		res[i] = lucas(n, k, p)
	}
	fmt.Println(crt(res, primes)) // C(n,k) mod 105
}
```

#### Java

```java
public class SolutionCRT {
    static long powMod(long a, long e, long m) {
        a %= m; if (a < 0) a += m;
        long r = 1 % m;
        while (e > 0) { if ((e & 1) == 1) r = r * a % m; a = a * a % m; e >>= 1; }
        return r;
    }

    static long lucas(long n, long k, long p) {
        if (k < 0 || k > n) return 0;
        long[] fact = new long[(int) p];
        fact[0] = 1 % p;
        for (int i = 1; i < p; i++) fact[i] = fact[i - 1] * i % p;
        long res = 1 % p;
        while (n > 0 || k > 0) {
            long ni = n % p, ki = k % p;
            if (ki > ni) return 0;
            long denom = fact[(int) ki] * fact[(int) (ni - ki)] % p;
            res = res * (fact[(int) ni] * powMod(denom, p - 2, p) % p) % p;
            n /= p; k /= p;
        }
        return res;
    }

    static long crt(long[] r, long[] m) {
        long M = 1;
        for (long mi : m) M *= mi;
        long x = 0;
        for (int i = 0; i < m.length; i++) {
            long Mi = M / m[i];
            long inv = powMod(Mi % m[i], m[i] - 2, m[i]);
            x = (x + r[i] % m[i] * (Mi % M) % M * inv) % M;
        }
        return (x % M + M) % M;
    }

    public static void main(String[] args) {
        long[] primes = {3, 5, 7};
        long n = 1_000_000_000_000L, k = 500_000_000_000L;
        long[] res = new long[primes.length];
        for (int i = 0; i < primes.length; i++) res[i] = lucas(n, k, primes[i]);
        System.out.println(crt(res, primes)); // C(n,k) mod 105
    }
}
```

#### Python

```python
def lucas(n, k, p):
    if k < 0 or k > n:
        return 0
    fact = [1] * p
    for i in range(1, p):
        fact[i] = fact[i - 1] * i % p
    res = 1 % p
    while n > 0 or k > 0:
        ni, ki = n % p, k % p
        if ki > ni:
            return 0
        denom = fact[ki] * fact[ni - ki] % p
        res = res * (fact[ni] * pow(denom, p - 2, p) % p) % p
        n //= p
        k //= p
    return res


def crt(residues, mods):
    from math import prod
    M = prod(mods)
    x = 0
    for r, m in zip(residues, mods):
        Mi = M // m
        x = (x + r % m * Mi % M * pow(Mi % m, m - 2, m)) % M
    return x % M


if __name__ == "__main__":
    primes = [3, 5, 7]
    n, k = 10**12, 5 * 10**11
    print(crt([lucas(n, k, p) for p in primes], primes))  # mod 105
```

> **Test ideas:** validate against `math.comb(n, k) % M` for `n ≤ 200`; confirm the primes are distinct (CRT moduli must be coprime); try a prime appearing twice and observe why CRT breaks — that case needs Granville.

---

Next step: drill with [`tasks.md`](./tasks.md) for graded beginner / intermediate / advanced exercises in all three languages.
