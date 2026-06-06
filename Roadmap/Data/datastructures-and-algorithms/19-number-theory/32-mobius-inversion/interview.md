# Möbius Function & Möbius Inversion — Interview Preparation

> Tiered Q&A from "what is `μ`" to "prove inversion and scale a coprime-count query to `n = 10^9`," followed by a full coding challenge in Go, Java, and Python. Each answer is concise but complete — say the key fact, then the one-line justification.

---

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Define the Möbius function `μ(n)`. | `μ(1)=1`; `0` if a square divides `n`; `(-1)^k` for `k` distinct primes (squarefree). |
| 2 | What is `μ(12)`, `μ(30)`, `μ(1)`? | `μ(12)=0` (2²·3), `μ(30)=-1` (2·3·5, three primes), `μ(1)=1`. |
| 3 | What does "squarefree" mean? | No prime appears more than once in the factorization; equivalently no `p²` divides `n`. |
| 4 | State the identity `Σ_{d\|n} μ(d)`. | Equals `1` if `n=1`, else `0` — the defining "killer" identity. |
| 5 | What is the Möbius inversion formula? | If `g(n)=Σ_{d\|n}f(d)` then `f(n)=Σ_{d\|n}μ(n/d)g(d)`. |
| 6 | In inversion, is the weight `μ(d)` or `μ(n/d)`? | `μ(n/d)` — the *complementary* divisor. |
| 7 | Why is `μ(p)=-1` for a prime `p`? | One distinct prime, `(-1)^1=-1`. |
| 8 | How do you compute `μ(n)` for one `n`? | Trial-divide in `O(√n)`; return `0` on a repeated prime, else `(-1)^{#primes}`. |
| 9 | How do you compute `μ` for all `n ≤ N`? | A sieve: Eratosthenes-style `O(N log log N)` or linear `O(N)`. |
| 10 | What is `μ(p²)` for prime `p`? | `0` — a square divides it. |
| 11 | Give the formula for `φ(n)` via `μ`. | `φ(n)=Σ_{d\|n}μ(d)·(n/d)` (since `φ = μ * Id`). |
| 12 | Count integers `≤ n` coprime to `n` using `μ`. | `Σ_{d\|n}μ(d)⌊n/d⌋`, which equals `φ(n)`. |

**Q5 detail — why care?** Inversion lets you *recover* a hidden function `f` from its divisor totals `g`. Whenever a quantity is naturally "summed over divisors," inversion undoes the sum.

**Q8 detail — the routine:**
```python
def mobius(n):
    if n == 1: return 1
    primes = 0; p = 2
    while p*p <= n:
        if n % p == 0:
            n //= p
            if n % p == 0: return 0   # repeated prime
            primes += 1
        p += 1
    if n > 1: primes += 1
    return 1 if primes % 2 == 0 else -1
```

**Q1 detail — say it crisply.** "μ tags an integer by its prime structure. It is `1` for `n=1`; `0` if any prime appears squared (non-squarefree); and `(-1)^k` if `n` is a product of `k` distinct primes. So μ is `0`, `+1`, or `-1` — never anything else."

**Q4 detail — why this identity is *the* one.** This identity, `Σ_{d|n} μ(d) = [n=1]`, is the reason μ exists: it makes μ act like a perfect cancelling agent, equalling `1` at the very start and `0` everywhere after. Everything else (the inversion formula, coprime counting) is a consequence.

**Q6 detail — the classic slip.** Interviewers love this. In `f(n) = Σ_{d|n} μ(n/d) g(d)`, the μ is evaluated at the *complementary* divisor `n/d`, not at `d`. Writing `μ(d)` instead silently produces wrong answers. A quick mnemonic: "the two arguments `d` and `n/d` must multiply back to `n`."

**Q10 detail — prime powers.** `μ(p^k) = -1` only when `k = 1`; for `k ≥ 2` a square divides `p^k`, so `μ(p^k) = 0`. This is why `4, 8, 9, 16, 25, 27, …` all have μ = 0.

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is Dirichlet convolution? | `(f*g)(n)=Σ_{d\|n}f(d)g(n/d)`; commutative, associative, identity `ε`. |
| 2 | Express "sum over divisors" as a convolution. | `g = f * 1`, where `1(n)=1`. |
| 3 | Why is `μ` "the inverse of `1`"? | `μ * 1 = ε` (the killer identity), so `μ = 1^{-1}` in the convolution ring. |
| 4 | Derive inversion from `μ*1=ε`. | `g=f*1 ⟹ g*μ = f*(1*μ)=f*ε=f`. |
| 5 | How do you count coprime pairs `≤ n`? | `Σ_{d=1}^{n} μ(d)⌊n/d⌋²` (from `[gcd=1]=Σ_{d\|gcd}μ(d)` + swap). |
| 6 | How do you compute `Σ_{i,j≤n} gcd(i,j)`? | `Σ_{d=1}^{n} φ(d)⌊n/d⌋²` (using `Id=φ*1`). |
| 7 | When is the weight `μ` vs `φ`? | `μ` for coprime *counts*, `φ` for gcd-*sums*. |
| 8 | How is `μ` related to inclusion-exclusion? | It IS inclusion-exclusion over the prime divisors; signs `(-1)^k` match `(-1)^{|S|}`. |
| 9 | Why is `μ` multiplicative, and why does it matter? | `μ(ab)=μ(a)μ(b)` for coprime `a,b`; lets the linear sieve compute it in `O(n)`. |
| 10 | What does the linear sieve do on `i%p==0`? | Sets `μ(i·p)=0` (since `p²\|i·p`) and breaks. |
| 11 | Show `φ = μ * Id` follows from `φ*1=Id`. | Convolve `φ*1=Id` by `μ`: `φ = Id*μ`. |
| 12 | Count pairs with `gcd(a,b)=g` exactly. | Coprime pairs in `{1..⌊n/g⌋}²` = `Σ_d μ(d)⌊n/(gd)⌋²`. |

**Q5 derivation (say this out loud):**
```
Σ_{a,b≤n}[gcd(a,b)=1] = Σ_{a,b} Σ_{d|gcd(a,b)} μ(d)
                      = Σ_{d≤n} μ(d) · #{(a,b): d|a, d|b}
                      = Σ_{d≤n} μ(d) ⌊n/d⌋².
```

**Q8 detail:** Counting "coprime to `n`" by subtracting multiples of each prime, adding back multiples of each pair, etc., is inclusion-exclusion over the events "divisible by `pᵢ`." `μ` packages those `±1` signs into one function and zeroes the impossible (non-squarefree) terms.

**Q1 detail — full story.** "Dirichlet convolution is a multiplication on arithmetic functions: `(f*g)(n) = Σ_{d|n} f(d)g(n/d)`. It is commutative and associative with identity `ε(n) = [n=1]`. It turns 'sum over divisors' into 'convolve with the constant-1 function `1`'. This makes arithmetic functions a commutative ring, where Möbius inversion is just multiplying by an inverse element."

**Q3 detail — the cleanest way to state it.** "`μ` is the Dirichlet inverse of `1` because `μ * 1 = ε` — that is exactly the identity `Σ_{d|n} μ(d) = [n=1]`. Once you know μ is `1`'s inverse, inversion is one line: `g = f*1` implies `g*μ = f*(1*μ) = f*ε = f`."

**Q9 detail — why multiplicativity enables `O(n)`.** A multiplicative function is fully determined by its values on prime powers. The linear sieve assigns each composite `i·p` (with `p` its smallest prime) a value from `i` and `p` in `O(1)`, visiting each number once — hence `O(n)` total. Without multiplicativity you would have to factor each number separately.

**Q11 detail — the derivation.** Start from the well-known `Σ_{d|n} φ(d) = n`, i.e. `φ * 1 = Id`. Convolve both sides by μ: `φ * 1 * μ = Id * μ`, and since `1 * μ = ε`, the left side is `φ`. So `φ = μ * Id`, i.e. `φ(n) = Σ_{d|n} μ(d)·(n/d)`. This is a model "convolve by μ to invert" move.

**Q12 detail — gcd buckets.** Pairs with `gcd(a,b)=g` are exactly pairs `(ga', gb')` with `gcd(a',b')=1` and `a',b' ≤ ⌊n/g⌋`. So the count is the coprime-pair count up to `⌊n/g⌋`, namely `Σ_d μ(d)⌊n/(gd)⌋²`.

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | `n = 10^9`, answer "coprime pairs ≤ n." How? | Divisor blocking: `⌊n/d⌋` has `O(√n)` values; sum `q²·(M(r)−M(l−1))`. |
| 2 | What is the Mertens function? | `M(x)=Σ_{d≤x}μ(d)`; the prefix sum that each block needs. |
| 3 | How do you compute `M(x)` beyond the sieved range? | Recurrence `M(x)=1−Σ_{i≥2}M(⌊x/i⌋)`, blocked + memoized. |
| 4 | Complexity of sublinear Mertens, and threshold? | `O(n^{2/3})` with sieve up to `T≈n^{2/3}`. |
| 5 | Why are there only `O(√n)` distinct `⌊n/d⌋`? | For `d ≤ √n`, `O(√n)` values of `d`; for `d > √n`, `⌊n/d⌋ < √n` so `O(√n)` quotients. |
| 6 | What overflow risk exists at `n=10^9`? | `q²≈10^{18}` near 64-bit limit; cubes need 128-bit. |
| 7 | How do you key the Mertens memo? | By the argument *value* `⌊n/k⌋`, not by `k` — only `O(√n)` distinct. |
| 8 | Sieve `μ` and `φ` together — why? | Both multiplicative; one linear `O(n)` sieve yields both (and `d`, `σ`). |
| 9 | How to count squarefree numbers ≤ n? | `Σ_{d≤√n} μ(d)⌊n/d²⌋` — block over `d²`, not `d`. |
| 10 | The block-end formula? | `q=⌊n/l⌋`, `r=⌊n/q⌋`, next `l=r+1`. |
| 11 | What is `C(n)/n²` as `n→∞`? | `6/π² ≈ 0.6079` (density of coprime pairs). |
| 12 | Memory for `μ(1..10^7)`? | ~10 MB if stored as `int8` (values in `{-1,0,1}`). |

**Q1 full plan:** Precompute `M` (Mertens prefix sums); iterate divisor blocks `l→q→r`; accumulate `q²·(M[r]−M[l−1])`; total `O(√n)` per query after `O(n)` (or `O(n^{2/3})`) precompute.

**Q9 detail:** A number is squarefree iff `Σ_{d²|n}μ(d)=1` (else 0). Summing over `n≤N` and swapping gives `Σ_d μ(d)⌊N/d²⌋`, where `d` ranges to `√N`.

**Q2 detail — what the Mertens function is for.** "`M(x) = Σ_{d≤x} μ(d)` is the prefix sum of μ. In a divisor-blocked sum `Σ_d μ(d)⌊n/d⌋²`, each block `[l,r]` shares a quotient `q`, so its contribution is `q²·(M(r)−M(l−1))`. So the whole query is a walk over `O(√n)` blocks, each needing a difference of Mertens values."

**Q3 detail — the recurrence.** "Sum `μ*1 = ε` over `n ≤ x`: `Σ_{n≤x} Σ_{d|n} μ(d) = 1`. Group by the quotient `i = n/d`: `Σ_{i=1}^{x} M(⌊x/i⌋) = 1`. Pull out the `i=1` term, which is `M(x)`: `M(x) = 1 − Σ_{i≥2} M(⌊x/i⌋)`. The arguments take `O(√x)` distinct values, so with blocking and memoization it is sublinear."

**Q4 detail — the balance.** "Sieve μ up to `T`, costing `O(T)`. Each large argument needs `O(√n)` work and there are `O(n/T)` of them, giving `O(T + n^{1.5}/T)`, minimized near `T = n^{2/3}` for the careful `O(n^{2/3})` bound. The memo keyed by argument value keeps the distinct-argument count at `O(√n)`."

**Q7 detail — the memo trap.** "If you memoize `M` by the loop index `k`, you lose the guarantee that only `O(√n)` distinct arguments appear, and the memo (and runtime) blow up. Always key by the *value* `⌊n/k⌋`."

**Q11 detail — the density.** "As `n → ∞`, the fraction of coprime ordered pairs tends to `1/ζ(2) = 6/π² ≈ 0.6079`. It comes from `Σ μ(d)/d² = 1/ζ(2)`. A good sanity check: your computed `C(n)/n²` should approach `0.6079`."

---

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Prove `Σ_{d\|n}μ(d)=[n=1]`. | Squarefree divisors = subsets of prime set; `Σ_k C(r,k)(-1)^k=(1-1)^r=0`. |
| 2 | Prove the Möbius inversion theorem. | In the ring: `g=f*1 ⟹ f=g*μ` via `1*μ=ε`. |
| 3 | Show the convolution ring is associative. | Both `(f*g)*h` and `f*(g*h)` equal the triple sum `Σ_{abc=n}f(a)g(b)h(c)`. |
| 4 | When does `f∈A` have a Dirichlet inverse? | Iff `f(1)≠0`; build inverse by the forced recurrence. |
| 5 | Prove convolution preserves multiplicativity. | Factor `d\|mn` uniquely as `d₁d₂`, split the double sum into a product. |
| 6 | What is the Möbius function of a poset? | Inverse of `ζ` in the incidence algebra: `μ_P*ζ=δ`. |
| 7 | How is inclusion-exclusion a special case? | Boolean lattice `μ_P(S,T)=(-1)^{|T|-|S|}`; Theorem yields inclusion-exclusion. |
| 8 | Why is `μ_P(a,b)=μ(b/a)` for divisibility? | Interval `[a,b]≅` divisor lattice of `b/a`, a product of prime chains. |
| 9 | Prove the Mertens recurrence. | `Σ_{n≤x}Σ_{d\|n}μ(d)=1`; group by `n/d`: `Σ_i M(⌊x/i⌋)=1`, isolate `M(x)`. |
| 10 | Justify linear-sieve `O(n)`. | Each composite generated once from smallest prime factor; multiplicative recurrence. |
| 11 | Derive `φ = μ * Id`. | Convolve `φ*1=Id` by `μ`. |
| 12 | Multiplicative-form inversion? | `g=∏_{d\|n}f(d) ⟺ f=∏ g(d)^{μ(n/d)}` (take logs). |

**Q1 model answer:** For `n>1` with distinct primes `p₁..p_r`, only squarefree divisors have nonzero `μ`; these are products of subsets `S⊆{p₁..p_r}` with `μ=(-1)^{|S|}`. So `Σ_{d|n}μ(d)=Σ_{S}(-1)^{|S|}=Σ_{k=0}^{r}C(r,k)(-1)^k=(1-1)^r=0`. For `n=1`, the sum is `μ(1)=1`. ∎

**Q2 model answer:** `μ*1=ε` (Q1). Given `g=f*1`, convolve by `μ`: `g*μ=(f*1)*μ=f*(1*μ)=f*ε=f`. So `f(n)=Σ_{d|n}μ(n/d)g(d)`. The converse convolves by `1`. ∎

**Q3 model answer:** Both `(f*g)*h` and `f*(g*h)` expand to the symmetric triple sum `Σ_{abc=n} f(a)g(b)h(c)` over ordered factorizations `n = abc`. Since the same sum results regardless of grouping, `*` is associative.

**Q5 model answer:** Let `gcd(m,n)=1`. Each divisor `d | mn` factors uniquely as `d = d₁d₂` with `d₁|m`, `d₂|n`, `gcd(d₁,d₂)=1`. Then `(f*g)(mn) = Σ_{d₁|m,d₂|n} f(d₁d₂)g((m/d₁)(n/d₂)) = Σ f(d₁)f(d₂)g(m/d₁)g(n/d₂) = (f*g)(m)·(f*g)(n)`, using multiplicativity of `f, g` on the coprime splits. ∎

**Q6 model answer:** In the incidence algebra of a locally finite poset, the zeta function `ζ(x,y)=1` for `x ≤ y` represents "sum over the down-interval." The Möbius function `μ_P` is its convolution inverse: `μ_P * ζ = δ` (the diagonal identity). It is computed by `μ_P(x,x)=1` and `μ_P(x,y) = -Σ_{x≤z<y} μ_P(x,z)`.

**Q8 model answer:** When `a | b`, the interval `[a,b]` in the divisibility poset is order-isomorphic to the divisor lattice of `b/a` (divide everything by `a`). The Möbius function depends only on the interval's structure, so `μ_P(a,b) = μ_P(1, b/a) = μ(b/a)`, the classical Möbius function.

**Q9 model answer:** Sum the identity `Σ_{d|n} μ(d) = [n=1]` over `n ≤ x`: the right side totals `1`. The left side, grouped by `i = n/d`, is `Σ_{i≤x} Σ_{d≤x/i} μ(d) = Σ_{i≤x} M(⌊x/i⌋)`. So `Σ_{i≤x} M(⌊x/i⌋) = 1`, and isolating `i=1` gives `M(x) = 1 − Σ_{i≥2} M(⌊x/i⌋)`. ∎

**Q12 model answer:** Take logs of `g(n)=∏_{d|n} f(d)`: `log g = (log f) * 1`. Apply additive inversion: `log f = (log g) * μ`, i.e. `log f(n) = Σ_{d|n} μ(n/d) log g(d)`. Exponentiate: `f(n) = ∏_{d|n} g(d)^{μ(n/d)}`.

---

## Coding Challenge (3 Languages)

### Challenge: Coprime Pairs Up To N

> **Problem.** Given `n` (up to `10^7` for this challenge), return the number of **ordered** pairs `(a, b)` with `1 ≤ a, b ≤ n` and `gcd(a, b) = 1`.
>
> **Approach.** Linear-sieve `μ(1..n)`, then compute `Σ_{d=1}^{n} μ(d)·⌊n/d⌋²`. `O(n)` time, `O(n)` space. (For `n` up to `10^9`, switch to divisor blocking + sublinear Mertens — see `senior.md`.)
>
> **Examples.** `n=1 → 1`; `n=2 → 3` (all of (1,1),(1,2),(2,1) coprime; (2,2) not); `n=6 → 23`; `n=10 → 63`.

#### Go

```go
package main

import "fmt"

func coprimePairs(n int) int64 {
	mu := make([]int8, n+1)
	comp := make([]bool, n+1)
	var primes []int
	if n >= 1 {
		mu[1] = 1
	}
	for i := 2; i <= n; i++ {
		if !comp[i] {
			primes = append(primes, i)
			mu[i] = -1
		}
		for _, p := range primes {
			if i*p > n {
				break
			}
			comp[i*p] = true
			if i%p == 0 {
				mu[i*p] = 0
				break
			}
			mu[i*p] = -mu[i]
		}
	}
	var total int64
	for d := 1; d <= n; d++ {
		if mu[d] == 0 {
			continue
		}
		q := int64(n / d)
		total += int64(mu[d]) * q * q
	}
	return total
}

func main() {
	fmt.Println(coprimePairs(1))  // 1
	fmt.Println(coprimePairs(2))  // 3
	fmt.Println(coprimePairs(6))  // 23
	fmt.Println(coprimePairs(10)) // 63
}
```

#### Java

```java
import java.util.ArrayList;
import java.util.List;

public class CoprimePairs {
    static long coprimePairs(int n) {
        byte[] mu = new byte[n + 1];
        boolean[] comp = new boolean[n + 1];
        List<Integer> primes = new ArrayList<>();
        if (n >= 1) mu[1] = 1;
        for (int i = 2; i <= n; i++) {
            if (!comp[i]) { primes.add(i); mu[i] = -1; }
            for (int p : primes) {
                if ((long) i * p > n) break;
                comp[i * p] = true;
                if (i % p == 0) { mu[i * p] = 0; break; }
                mu[i * p] = (byte) (-mu[i]);
            }
        }
        long total = 0;
        for (int d = 1; d <= n; d++) {
            if (mu[d] == 0) continue;
            long q = n / d;
            total += (long) mu[d] * q * q;
        }
        return total;
    }

    public static void main(String[] args) {
        System.out.println(coprimePairs(1));  // 1
        System.out.println(coprimePairs(2));  // 3
        System.out.println(coprimePairs(6));  // 23
        System.out.println(coprimePairs(10)); // 63
    }
}
```

#### Python

```python
def coprime_pairs(n):
    mu = [0] * (n + 1)
    comp = [False] * (n + 1)
    primes = []
    if n >= 1:
        mu[1] = 1
    for i in range(2, n + 1):
        if not comp[i]:
            primes.append(i)
            mu[i] = -1
        for p in primes:
            if i * p > n:
                break
            comp[i * p] = True
            if i % p == 0:
                mu[i * p] = 0
                break
            mu[i * p] = -mu[i]
    total = 0
    for d in range(1, n + 1):
        if mu[d]:
            q = n // d
            total += mu[d] * q * q
    return total


if __name__ == "__main__":
    print(coprime_pairs(1))   # 1
    print(coprime_pairs(2))   # 3
    print(coprime_pairs(6))   # 23
    print(coprime_pairs(10))  # 63

    # Brute-force cross-check for small n.
    from math import gcd
    for n in range(1, 60):
        brute = sum(1 for a in range(1, n + 1) for b in range(1, n + 1) if gcd(a, b) == 1)
        assert brute == coprime_pairs(n), n
    print("ok")
```

**Follow-ups the interviewer may ask:**
- *"Now `n = 10^9`."* → Divisor blocking + Mertens prefix sums; sublinear `M(x)` via the hyperbola recurrence (`senior.md`), `O(n^{2/3})`.
- *"Count coprime triples instead."* → `Σ_d μ(d)⌊n/d⌋³`; watch overflow (`q³` needs 128-bit).
- *"Sum of gcd over all pairs."* → swap `μ` for `φ`: `Σ_d φ(d)⌊n/d⌋²`.
- *"Why does `μ` appear at all?"* → `[gcd=1]=Σ_{d|gcd}μ(d)` (the `μ*1=ε` identity), then swap summation order.

---

### Challenge 2: GCD-Sum

> **Problem.** Given `n` (up to `10^7`), compute `Σ_{i=1}^{n} Σ_{j=1}^{n} gcd(i, j)`.
>
> **Approach.** Use `Id = φ * 1`, so `gcd(i,j) = Σ_{d|gcd(i,j)} φ(d)`. Substituting and swapping: `Σ_{i,j} gcd(i,j) = Σ_{d=1}^{n} φ(d)·⌊n/d⌋²`. Sieve `φ` (linear), then one `O(n)` pass.
>
> **Examples.** `n=1 → 1`; `n=2 → 1+1+1+2 = 5`; `n=6 → 61`.

#### Go

```go
package main

import "fmt"

func gcdSum(n int) int64 {
	phi := make([]int, n+1)
	comp := make([]bool, n+1)
	var primes []int
	if n >= 1 {
		phi[1] = 1
	}
	for i := 2; i <= n; i++ {
		if !comp[i] {
			primes = append(primes, i)
			phi[i] = i - 1
		}
		for _, p := range primes {
			if i*p > n {
				break
			}
			comp[i*p] = true
			if i%p == 0 {
				phi[i*p] = phi[i] * p
				break
			}
			phi[i*p] = phi[i] * (p - 1)
		}
	}
	var total int64
	for d := 1; d <= n; d++ {
		q := int64(n / d)
		total += int64(phi[d]) * q * q
	}
	return total
}

func main() {
	fmt.Println(gcdSum(1)) // 1
	fmt.Println(gcdSum(2)) // 5
	fmt.Println(gcdSum(6)) // 61
}
```

#### Java

```java
import java.util.ArrayList;
import java.util.List;

public class GcdSum {
    static long gcdSum(int n) {
        int[] phi = new int[n + 1];
        boolean[] comp = new boolean[n + 1];
        List<Integer> primes = new ArrayList<>();
        if (n >= 1) phi[1] = 1;
        for (int i = 2; i <= n; i++) {
            if (!comp[i]) { primes.add(i); phi[i] = i - 1; }
            for (int p : primes) {
                if ((long) i * p > n) break;
                comp[i * p] = true;
                if (i % p == 0) { phi[i * p] = phi[i] * p; break; }
                phi[i * p] = phi[i] * (p - 1);
            }
        }
        long total = 0;
        for (int d = 1; d <= n; d++) {
            long q = n / d;
            total += (long) phi[d] * q * q;
        }
        return total;
    }

    public static void main(String[] args) {
        System.out.println(gcdSum(1)); // 1
        System.out.println(gcdSum(2)); // 5
        System.out.println(gcdSum(6)); // 61
    }
}
```

#### Python

```python
def gcd_sum(n):
    phi = [0] * (n + 1)
    comp = [False] * (n + 1)
    primes = []
    if n >= 1:
        phi[1] = 1
    for i in range(2, n + 1):
        if not comp[i]:
            primes.append(i)
            phi[i] = i - 1
        for p in primes:
            if i * p > n:
                break
            comp[i * p] = True
            if i % p == 0:
                phi[i * p] = phi[i] * p
                break
            phi[i * p] = phi[i] * (p - 1)
    return sum(phi[d] * (n // d) ** 2 for d in range(1, n + 1))


if __name__ == "__main__":
    print(gcd_sum(1))  # 1
    print(gcd_sum(2))  # 5
    print(gcd_sum(6))  # 61
    from math import gcd
    for n in range(1, 40):
        brute = sum(gcd(i, j) for i in range(1, n + 1) for j in range(1, n + 1))
        assert brute == gcd_sum(n), n
    print("ok")
```

**Key insight to articulate:** the *only* change from the coprime-pair challenge is the weight — `φ(d)` instead of `μ(d)`. Both follow the "express the per-pair quantity as a divisor-sum, swap order, collect ⌊n/d⌋² terms" template. `[gcd=1] = Σ_{d|gcd} μ(d)` gives μ; `gcd = Σ_{d|gcd} φ(d)` gives φ.

---

### Challenge 3: Squarefree Count

> **Problem.** Count squarefree integers in `1..n` (up to `10^{12}`).
>
> **Approach.** `[n squarefree] = Σ_{d²|n} μ(d)`. Summing over `m ≤ n` and swapping: `Q(n) = Σ_{d=1}^{⌊√n⌋} μ(d)·⌊n/d²⌋`. Sieve μ up to `√n`, then `O(√n)` sum.
>
> **Examples.** `n=10 → 7` (only `4,8,9` excluded); `n=100 → 61`.

#### Python (Go/Java mirror the same loop)

```python
def squarefree_count(n):
    import math
    r = int(math.isqrt(n))
    mu = [0] * (r + 1)
    comp = [False] * (r + 1)
    primes = []
    if r >= 1:
        mu[1] = 1
    for i in range(2, r + 1):
        if not comp[i]:
            primes.append(i)
            mu[i] = -1
        for p in primes:
            if i * p > r:
                break
            comp[i * p] = True
            if i % p == 0:
                mu[i * p] = 0
                break
            mu[i * p] = -mu[i]
    return sum(mu[d] * (n // (d * d)) for d in range(1, r + 1))


if __name__ == "__main__":
    print(squarefree_count(10))   # 7
    print(squarefree_count(100))  # 61
```

```go
// Go: same structure — sieve μ up to isqrt(n), then
//   total := 0
//   for d := 1; d*d <= n; d++ { total += mu[d] * (n / (d*d)) }
```

```java
// Java: identical — long total = 0;
//   for (int d = 1; (long) d * d <= n; d++) total += (long) mu[d] * (n / ((long) d * d));
```

**Why blocking is over `d²` here:** the inner quantity is `⌊n/d²⌋`, so `d` only ranges to `√n` (beyond that `d² > n` and the term is 0). This is the squarefree variant interviewers use to test whether you noticed the `d²`.

---

## Rapid-Fire (mental math)

| Prompt | Answer |
|--------|--------|
| `μ(1)` | `1` |
| `μ(7)` | `-1` |
| `μ(49)` | `0` (7²) |
| `μ(2·3·5·7)` | `+1` (four primes) |
| `μ(2·3·5·7·11)` | `-1` (five primes) |
| `Σ_{d\|30} μ(d)` | `0` |
| `Σ_{d\|1} μ(d)` | `1` |
| `φ` via convolution | `μ * Id` |
| inverse of `1` under `*` | `μ` |
| weight for coprime *count* | `μ(d)` |
| weight for gcd-*sum* | `φ(d)` |
| coprime-pair density limit | `6/π² ≈ 0.6079` |
| `μ` of any perfect square `> 1` | `0` |
| sieve cost for `μ(1..n)` | `O(n)` linear |
| distinct values of `⌊n/d⌋` | `O(√n)` |
| `μ(p)` for prime `p` | `-1` |
| `μ(p²)` for prime `p` | `0` |
| `μ * μ`? (is μ idempotent) | no; only `ε` is |
| Dirichlet series of `μ` | `1/ζ(s)` |
| inverse of `Id` under `*` | `n·μ(n)` |
| `d(n) = 1 * 1`? | yes (divisor count) |
| `σ(n) = ?` as convolution | `Id * 1` |
| coprime-triple density | `1/ζ(3) ≈ 0.832` |
| squarefree density | `6/π²` |
| Mertens function | `M(x)=Σ_{d≤x}μ(d)` |
| sublinear Mertens cost | `O(n^{2/3})` |
| inclusion-exclusion lattice | Boolean `2^[k]` |
| Möbius inversion lattice | divisor lattice |

**Closing tip:** the single highest-yield fact to internalize is `μ * 1 = ε`. From it you can re-derive the divisor-sum identity, the inversion formula, `φ = μ*Id`, the Mertens recurrence, and the coprime-count sum — on the spot, without memorizing each separately.
