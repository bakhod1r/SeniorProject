# Factorial modulo a Prime — Interview Preparation

Factorial-mod-p is a staple of any interview that touches combinatorics under a modulus. The single crisp insight interviewers look for is: *"precompute `fact[i] = i! mod p` forward, build `invfact[i] = (i!)^(-1) mod p` from **one** Fermat inverse via a **backward** recurrence, then `C(n, k) = fact[n]·invfact[k]·invfact[n-k]` in O(1)."* On top of that they probe whether you know **when it breaks** (`n ≥ p` makes `n! ≡ 0`), the supporting theory (**Wilson**, **Legendre**, **Kummer**), and the generalizations (**Lucas** for `n ≥ p`, **Granville** for prime powers). This file is a tiered question bank, behavioral prompts, and a runnable coding challenge in Go, Java, and Python.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Build `fact[0..N] mod p` | forward loop `fact[i]=fact[i-1]·i` | O(N) |
| Build `invfact[0..N] mod p` | one inverse + backward recurrence | O(N + log p) |
| `C(n, k) mod p`, `n < p` | `fact[n]·invfact[k]·invfact[n-k]` | O(1) |
| `n! mod p`, `n ≥ p` | `0` | O(1) |
| Inverse of `a` mod prime `p` | `a^(p-2) mod p` (Fermat) | O(log p) |
| `(p-1)! mod p` | `-1` (Wilson) | — |
| Exponent of `p` in `n!` | `Σ ⌊n/p^i⌋` (Legendre) | O(log_p n) |
| Is `C(n, k) ≡ 0 (mod p)`? | carry in base-`p` add of `k`+`n-k` (Kummer) | O(log_p n) |
| `C(n, k) mod p`, `n ≥ p` | Lucas (digit-wise product) | O(log_p n) |
| `C(n, k) mod p^e` | Granville (gen. Wilson) | O(p^e + e·log_p n) |

Key facts:
- The inverse-factorial table needs **one** inverse, built **backward** (`invfact[i-1] = invfact[i]·i`).
- `n! ≡ 0 (mod p)` for `n ≥ p`; the table method requires **`n < p`** and **prime `p`**.
- **Wilson:** `(p-1)! ≡ -1 (mod p)` — a free table self-check.
- **Legendre:** `v_p(n!) = Σ ⌊n/p^i⌋ = (n - s_p(n))/(p-1)`.
- **Kummer:** `v_p(C(n,k))` = number of carries adding `k` and `n-k` in base `p`.

Core routine:

```text
precompute(N, p):
    fact[0] = 1
    for i in 1..N: fact[i] = fact[i-1]*i % p          # forward
    invfact[N] = pow(fact[N], p-2, p)                 # ONE inverse
    for i in N..1: invfact[i-1] = invfact[i]*i % p    # backward

binom(n, k) = fact[n]*invfact[k]%p*invfact[n-k]%p     # if 0<=k<=n else 0
```

---

## Junior Questions (13 Q&A)

### J1. How do you compute `C(n, k) mod p` for a prime `p`?
Precompute `fact[i] = i! mod p` and `invfact[i] = (i!)^(-1) mod p`, then `C(n, k) ≡ fact[n]·invfact[k]·invfact[n-k] (mod p)` for `0 ≤ k ≤ n`. Each query is O(1) after O(N) precompute.

### J2. Why can't you just "divide mod p"?
Modular division means multiplying by the modular inverse. For a prime `p` and `a ≢ 0`, the inverse is `a^(p-2) mod p` (Fermat's little theorem). So you replace each `/k!` with `·(k!)^(-1)`.

### J3. How do you build the factorial table?
A forward loop: `fact[0] = 1`, then `fact[i] = fact[i-1]·i mod p`. Each value reuses the previous, so it is O(N) total.

### J4. How do you build the inverse-factorial table efficiently?
Compute one inverse `invfact[N] = (fact[N])^(-1)` via Fermat, then walk backward: `invfact[i-1] = invfact[i]·i mod p`. This is O(N) plus one O(log p) inverse, instead of O(N log p) for separate inversions.

### J5. Why does the backward recurrence work?
Because `(i-1)! = i!/i`, so `((i-1)!)^(-1) = (i!)^(-1)·i`. Multiplying `invfact[i]` by `i` gives `invfact[i-1]`.

### J6. Why must you build `invfact` backward, not forward?
The forward step would need `i^(-1)` (an inverse per step, expensive). The backward step needs only multiplication by `i` (cheap). Only backward avoids per-step inversion.

### J7. What is `n! mod p` when `n ≥ p`?
It is `0`, because `n!` then contains the factor `p` (one of `1, 2, …, n` equals `p`). So the table method only works for `n < p`.

### J8. What is `0!` and `C(n, 0)`?
`0! = 1` (empty product), and `C(n, 0) = 1`. The formula handles them because `fact[0] = invfact[0] = 1`.

### J9. What does `C(n, k)` equal when `k > n` or `k < 0`?
`0`, by the combinatorial definition. Always guard `0 ≤ k ≤ n` before using the formula.

### J10. What is Wilson's theorem?
For a prime `p`, `(p-1)! ≡ -1 (mod p)`. For example `4! = 24 ≡ -1 (mod 5)`. It gives a free self-check: `fact[p-1]` must equal `p-1`.

### J11. What modulus is typically used and why?
A large prime like `10^9 + 7` or `998244353`, so inverses always exist and products of two residues (< `p²`) fit in a 64-bit integer.

### J12. How much memory does the precompute use?
Two arrays of size `N+1`. For 64-bit integers that is `16(N+1)` bytes — about 32 MB for `N = 2·10^6`.

### J13 (analysis). Why is the inverse-factorial table O(N) and not O(N log p)?
Because you invert only `fact[N]` once (O(log p)); every other `invfact[i]` comes from a single multiply in the backward loop, giving O(N) for the rest.

---

## Middle Questions (13 Q&A)

### M1. State and prove Wilson's theorem.
`(p-1)! ≡ -1 (mod p)`. Pair each residue in `{1,…,p-1}` with its inverse; all non-self-inverse elements pair to `1`, and the only self-inverse ones are `1` and `p-1` (solutions of `x² ≡ 1`). So `(p-1)! ≡ 1·(p-1) ≡ -1`.

### M2. State Legendre's formula.
The exponent of prime `p` in `n!` is `v_p(n!) = ⌊n/p⌋ + ⌊n/p²⌋ + ⌊n/p³⌋ + ⋯`. It counts multiples of `p`, then `p²`, etc.

### M3. What is the digit-sum form of Legendre's formula?
`v_p(n!) = (n - s_p(n))/(p-1)`, where `s_p(n)` is the sum of the base-`p` digits of `n`. It is O(log n).

### M4. When is `C(n, k) mod p` equal to zero (small `p`)?
When `v_p(n!) > v_p(k!) + v_p((n-k)!)`, equivalently when there is a carry adding `k` and `n-k` in base `p` (Kummer's theorem).

### M5. State Kummer's theorem.
The exponent of `p` in `C(n, k)` equals the number of carries when adding `k` and `n-k` in base `p`. So `p | C(n, k)` iff that addition carries at least once.

### M6. What is the `p`-free factorial?
`(n!)_p` is `n!` with all multiples of `p` removed: the product of `i in 1..n` with `p ∤ i`. It is coprime to `p`, hence invertible mod `p`, and is the building block for `n ≥ p` and prime-power cases.

### M7. Why does `n! ≡ 0 (mod p)` for `n ≥ p`?
By Legendre, `v_p(n!) ≥ ⌊n/p⌋ ≥ 1` once `n ≥ p`, so `p | n!`.

### M8. How do you compute `C(n, k) mod p` when `n ≥ p`?
Use Lucas' theorem: write `n` and `k` in base `p` and take `∏_j C(n_j, k_j) mod p`, with `C(n_j, k_j) = 0` if any digit `k_j > n_j`.

### M9. How does Wilson relate to the `p`-free factorial?
Each full block `1·2·⋯·(p-1)` (skipping the multiple of `p`) contributes `(p-1)! ≡ -1` (Wilson). So the `p`-free factorial picks up a sign `(-1)^(number of full blocks)`.

### M10. What other counts do the factorial tables compute?
Multinomials `n!/∏k_i!`, Catalan numbers `C(2n,n)/(n+1)`, stars-and-bars `C(n+k-1, k-1)` — all are rearrangements of factorials, O(1) after precompute.

### M11. How do you cross-check the tables?
Pascal's recurrence `C(n,k) = C(n-1,k-1) + C(n-1,k)` mod `p`, the inverse self-check `fact[i]·invfact[i] ≡ 1`, and Wilson `fact[p-1] ≡ p-1`.

### M12. What is the index ceiling for Catalan and stars-and-bars?
`2n` for Catalan, `n + k - 1` for stars-and-bars. Size `N` to the largest index any formula reads, not just `n`.

### M13 (analysis). How fast can you decide whether `C(n, k) mod p` is zero?
O(log_p n): add `k` and `n-k` in base `p` and look for a carry (Kummer), without computing the value.

---

## Senior Questions (12 Q&A)

### S1. Design a high-throughput `C(n, k)` service.
Precompute immutable `fact[]`/`invfact[]` once at startup for the configured prime and a documented `N`. Serve lock-free reads (tables are read-only). Guard `0 ≤ k ≤ n`, `n < N`, `n < p`; route `n ≥ p` to Lucas and composite moduli to CRT-Granville. Assert modulus primality at startup.

### S2. How do you size the precompute table?
To the largest *index* any query reads (account for Catalan `2n`, stars-and-bars `n+k-1`), plus a margin. `16(N+1)` bytes for two int64 arrays. Size upfront; if you must grow, swap an atomic pointer (RCU), never mutate in place.

### S3. What happens with a composite modulus?
The Fermat inverse is invalid and every result is silently wrong. Factor `m = ∏ p_i^{e_i}`, solve each prime power (Granville), and recombine via CRT. Assert primality (or enable the CRT path) at startup to avoid silent corruption.

### S4. How do you compute `C(n, k) mod p^e`?
Granville's method: `c = v_p(C(n,k))` by Legendre; if `c ≥ e` the answer is `0`; otherwise `p^c · G(n)·G(k)^(-1)·G(n-k)^(-1) mod p^e`, where `G` is the `p`-free factorial mod `p^e` evaluated via the generalized Wilson theorem (block sign `±1`).

### S5. What is the generalized Wilson theorem?
The product of the units mod `p^e` is `-1` for odd `p` (and for `2, 4`) and `+1` for `2^e` with `e ≥ 3`. It governs the sign each full block contributes in the `p`-free factorial mod `p^e`.

### S6. Why is `998244353` sometimes preferred over `10^9 + 7`?
It is NTT-friendly: `p - 1 = 119·2^23` has a large power-of-two factor, enabling the Number Theoretic Transform for fast polynomial multiplication. For plain binomial queries either prime works.

### S7. How do you make the service thread-safe?
Build the tables during single-threaded startup, then publish them immutably; concurrent readers need no locks. Ensure safe publication (Java `final` fields / memory barrier; Go happens-before via goroutine creation; Python GIL plus build-before-spawn).

### S8. How do you reconstruct an exact (non-modular) `C(n, k)`?
Compute it mod several distinct primes whose product exceeds the value, then CRT-reconstruct the exact integer. Each prime keeps its own tables, and arithmetic stays in machine words.

### S9. Why prefer the backward recurrence over per-element inversion in production?
It is O(N) vs O(N log p) — a ~30× build speedup for `p ≈ 10^9` — and it is the only method that avoids an inverse per element. It is both faster and simpler to prove correct.

### S10. What observability would you add?
Startup modulus-primality check, `precompute_duration`, `table_bytes` vs memory limit, `query_p99`, `n_ge_p_rejections`, and out-of-bounds index errors. The two highest-value alerts: primality failure (silent corruption) and OOB (under-sized table).

### S11. How do you cache tables for multiple moduli?
Key by `(modulus, N)`; build each lazily on first use, then immutable. Never share a table across moduli — residues are modulus-specific.

### S12 (analysis). What is the throughput limit of the table method?
~5 arithmetic ops per query (~10 ns), so one core serves ~10^8 queries/s and `C` cores ~`C·10^8` with no contention (read-only tables). The service is I/O-bound; batch many `(n,k)` per request.

---

## Professional Questions (8 Q&A)

### P1. Prove the inverse-factorial backward recurrence is correct.
By induction: `invfact[N] = (N!)^(-1)` (Fermat). Assuming `invfact[i] = (i!)^(-1)`, then `invfact[i-1] = invfact[i]·i = (i!)^(-1)·i = (i!/i)^(-1)·... = ((i-1)!)^(-1)` since `(i-1)!·i = i!`. The invariant holds down to `i = 0`.

### P2. Prove Legendre's formula.
`v_p(n!) = Σ_{j=1}^n v_p(j) = Σ_{j} Σ_{i≥1}[p^i | j] = Σ_{i≥1} (count of multiples of p^i in 1..n) = Σ_{i≥1} ⌊n/p^i⌋`, by exchanging the order of summation.

### P3. Prove Kummer's theorem from Legendre.
Using the digit-sum form, `v_p(C(n,k)) = (s_p(k) + s_p(n-k) - s_p(n))/(p-1)`. Each base-`p` carry in `k + (n-k) = n` reduces the addend digit sum by `p-1` relative to `s_p(n)`, so the deficit divided by `p-1` is the carry count.

### P4. Prove Wilson's theorem and its converse.
Forward: inverse pairing leaves only the self-inverse `±1`, product `≡ -1`. Converse: if `n` is composite with proper divisor `d`, then `d | (n-1)!` so `(n-1)! ≡ 0 (mod d)`, contradicting `(n-1)! ≡ -1 (mod n)` (which forces `≡ -1 mod d`).

### P5. Explain Granville's algorithm and its correctness.
Factor `n! = p^{v_p(n!)}·G(n)` where `G(n)` is the recursive `p`-free factorial mod `p^e` (Theorem 6.2). Then `C(n,k) = p^c·G(n)/(G(k)G(n-k))` with `c = v_p(C(n,k))`. Each `G` is a unit (coprime to `p`), so invertible mod `p^e`; if `c ≥ e` the `p^c` factor annihilates and the answer is `0`. Full blocks contribute the generalized-Wilson sign.

### P6. Why is the generalized Wilson sign `+1` for `2^e`, `e ≥ 3`?
Because `(ℤ/2^eℤ)^*` is non-cyclic (`≅ ℤ/2 × ℤ/2^{e-2}`) with four square roots of 1 (`±1, 2^{e-1}±1`), whose product is `+1`. For odd `p` (cyclic) there are only two square roots `±1`, product `-1`.

### P7. Derive Lucas' theorem via generating functions.
In `ℤ/pℤ[x]`, `(1+x)^p ≡ 1 + x^p` (Frobenius, since `p | C(p,i)` for `0<i<p`). So `(1+x)^n = ∏_j (1+x)^{n_j p^j} ≡ ∏_j (1+x^{p^j})^{n_j}`. The coefficient of `x^k` gives `∏_j C(n_j, k_j)`.

### P8 (analysis). What is the complexity of each method and how do they relate?
Tables: O(N) build, O(1) query (`n < p`). Lucas: O(p) tables, O(log_p n) query (any `n`). Granville: O(p^e) precompute, O(e·log_p n) query (prime power). CRT-composite: one Granville per prime factor + O(r) merge. Each is a strict generalization of the one above; the table method is the `e=1`, single-digit special case of Granville.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about replacing a slow combinatorics computation.
Look for: a per-call factorial/inverse recomputation in a hot loop, a profile showing it dominating, the move to a one-time `fact[]`/`invfact[]` precompute (and the one-inverse backward recurrence), and a measured speedup with a correctness cross-check against the old code.

### B2. A teammate's `C(n,k)` returns wrong values for large `n`. How do you help?
Diagnose `n ≥ p`: `fact[n] = 0`, so the answer is a wrong `0`. Explain calmly with a tiny example (`p = 7`, `n = 10`), recommend Lucas' theorem, and add a guard plus a test. Frame it as a precondition lesson, not blame.

### B3. Design the math core of a combinatorics microservice.
Discuss startup precompute (sized to the index ceiling), modulus-primality assertion, immutable lock-free tables, fallbacks for `n ≥ p` (Lucas) and composite moduli (CRT-Granville), observability (primality check, OOB errors), and a property-test oracle against `math.comb`.

### B4. Explain the inverse-factorial trick to a junior.
Use the "one master key" analogy: instead of forging `N` separate keys (one inverse each), you cut one master key (`invfact[N]`) and shape every smaller key by walking down a staircase (`invfact[i-1] = invfact[i]·i`). One expensive step, then all cheap.

### B5. Your service occasionally returns subtly wrong counts. How do you investigate?
Check the modulus is prime (composite silently corrupts), check for `n ≥ p` or `n > N` queries (boundary bugs), verify the inverse self-check `fact[i]·invfact[i] ≡ 1`, and diff Go/Java/Python outputs on shared inputs to catch overflow/sign bugs.

---

## Coding Challenges

### Challenge 1: Precompute and Query `C(n, k) mod p`

**Problem.** Precompute factorial and inverse-factorial tables up to `N`, then answer many `C(n, k) mod (10^9 + 7)` queries in O(1).

**Example.**
```text
C(5, 2) = 10
C(10, 3) = 120
C(0, 0) = 1
```

**Constraints.** `0 ≤ k ≤ n ≤ N < 10^9 + 7`.

**Optimal.** O(N + log p) precompute, O(1) per query.

**Go.**
```go
package main

import "fmt"

const MOD = int64(1_000_000_007)

var fact, invfact []int64

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

func precompute(N int) {
	fact = make([]int64, N+1)
	invfact = make([]int64, N+1)
	fact[0] = 1
	for i := 1; i <= N; i++ {
		fact[i] = fact[i-1] * int64(i) % MOD
	}
	invfact[N] = powMod(fact[N], MOD-2, MOD)
	for i := N; i >= 1; i-- {
		invfact[i-1] = invfact[i] * int64(i) % MOD
	}
}

func binom(n, k int) int64 {
	if k < 0 || k > n {
		return 0
	}
	return fact[n] * invfact[k] % MOD * invfact[n-k] % MOD
}

func main() {
	precompute(100)
	fmt.Println(binom(5, 2))  // 10
	fmt.Println(binom(10, 3)) // 120
	fmt.Println(binom(0, 0))  // 1
}
```

**Java.**
```java
public class Binomial {
    static final long MOD = 1_000_000_007L;
    static long[] fact, invfact;

    static long powMod(long a, long e, long m) {
        a %= m; if (a < 0) a += m;
        long r = 1 % m;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % m;
            a = a * a % m;
            e >>= 1;
        }
        return r;
    }

    static void precompute(int N) {
        fact = new long[N + 1];
        invfact = new long[N + 1];
        fact[0] = 1;
        for (int i = 1; i <= N; i++) fact[i] = fact[i - 1] * i % MOD;
        invfact[N] = powMod(fact[N], MOD - 2, MOD);
        for (int i = N; i >= 1; i--) invfact[i - 1] = invfact[i] * i % MOD;
    }

    static long binom(int n, int k) {
        if (k < 0 || k > n) return 0;
        return fact[n] * invfact[k] % MOD * invfact[n - k] % MOD;
    }

    public static void main(String[] args) {
        precompute(100);
        System.out.println(binom(5, 2));  // 10
        System.out.println(binom(10, 3)); // 120
        System.out.println(binom(0, 0));  // 1
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def precompute(N):
    fact = [1] * (N + 1)
    for i in range(1, N + 1):
        fact[i] = fact[i - 1] * i % MOD
    invfact = [1] * (N + 1)
    invfact[N] = pow(fact[N], MOD - 2, MOD)
    for i in range(N, 0, -1):
        invfact[i - 1] = invfact[i] * i % MOD
    return fact, invfact


def binom(n, k, fact, invfact):
    if k < 0 or k > n:
        return 0
    return fact[n] * invfact[k] % MOD * invfact[n - k] % MOD


if __name__ == "__main__":
    fact, invfact = precompute(100)
    print(binom(5, 2, fact, invfact))   # 10
    print(binom(10, 3, fact, invfact))  # 120
    print(binom(0, 0, fact, invfact))   # 1
```

---

### Challenge 2: Lucas' Theorem for `C(n, k) mod p` with `n ≥ p`

**Problem.** Compute `C(n, k) mod p` for a *small* prime `p` and arbitrary `n` (possibly `≥ p`).

**Example.**
```text
n = 1000, k = 13, p = 7   ->  some residue in [0, 7)
n = 5, k = 2, p = 3       ->  1
```

**Constraints.** `2 ≤ p ≤ 10^6` prime, `0 ≤ k ≤ n ≤ 10^18`.

**Optimal.** Lucas: size-`p` tables, then product over base-`p` digits, O(log_p n) per query.

**Go.**
```go
package main

import "fmt"

func powMod(a, e, m int64) int64 {
	a %= m
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
	fact := make([]int64, p)
	fact[0] = 1
	for i := int64(1); i < p; i++ {
		fact[i] = fact[i-1] * i % p
	}
	smallC := func(a, b int64) int64 {
		if b < 0 || b > a {
			return 0
		}
		return fact[a] * powMod(fact[b]*fact[a-b]%p, p-2, p) % p
	}
	res := int64(1)
	for n > 0 || k > 0 {
		res = res * smallC(n%p, k%p) % p
		n /= p
		k /= p
	}
	return res
}

func main() {
	fmt.Println(lucas(1000, 13, 7))
	fmt.Println(lucas(5, 2, 3)) // 1
}
```

**Java.**
```java
public class Lucas {
    static long powMod(long a, long e, long m) {
        a %= m;
        long r = 1 % m;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % m;
            a = a * a % m;
            e >>= 1;
        }
        return r;
    }

    static long lucas(long n, long k, long p) {
        long[] fact = new long[(int) p];
        fact[0] = 1;
        for (int i = 1; i < p; i++) fact[i] = fact[i - 1] * i % p;
        long res = 1;
        while (n > 0 || k > 0) {
            long a = n % p, b = k % p;
            long c = (b < 0 || b > a) ? 0
                : fact[(int) a] * powMod(fact[(int) b] * fact[(int) (a - b)] % p, p - 2, p) % p;
            res = res * c % p;
            n /= p; k /= p;
        }
        return res;
    }

    public static void main(String[] args) {
        System.out.println(lucas(1000, 13, 7));
        System.out.println(lucas(5, 2, 3)); // 1
    }
}
```

**Python.**
```python
def lucas(n, k, p):
    fact = [1] * p
    for i in range(1, p):
        fact[i] = fact[i - 1] * i % p

    def small_c(a, b):
        if b < 0 or b > a:
            return 0
        return fact[a] * pow(fact[b] * fact[a - b] % p, p - 2, p) % p

    res = 1
    while n > 0 or k > 0:
        res = res * small_c(n % p, k % p) % p
        n //= p
        k //= p
    return res


if __name__ == "__main__":
    print(lucas(1000, 13, 7))
    print(lucas(5, 2, 3))  # 1
```

---

### Challenge 3: Exponent of `p` in `n!` and the `C(n, k)` zero test

**Problem.** Given `n`, `k`, and a prime `p`, return `v_p(C(n, k))` — the exponent of `p` in the binomial coefficient — via Legendre's formula. The binomial is divisible by `p` iff this is positive (Kummer).

**Example.**
```text
n = 10, k = 3, p = 2   ->  v_2(C(10,3)) = v_2(120) = 3   (120 = 8·15)
n = 5,  k = 2, p = 5   ->  v_5(C(5,2))  = v_5(10)  = 1
n = 6,  k = 1, p = 5   ->  v_5(C(6,1))  = v_5(6)   = 0
```

**Constraints.** `0 ≤ k ≤ n ≤ 10^18`, `2 ≤ p ≤ 10^9` prime.

**Optimal.** `v_p(C(n,k)) = v_p(n!) − v_p(k!) − v_p((n-k)!)`, each by Legendre in O(log_p n).

**Go.**
```go
package main

import "fmt"

func vpFactorial(n, p int64) int64 {
	var e int64
	for n > 0 {
		n /= p
		e += n
	}
	return e
}

func vpBinom(n, k, p int64) int64 {
	return vpFactorial(n, p) - vpFactorial(k, p) - vpFactorial(n-k, p)
}

func main() {
	fmt.Println(vpBinom(10, 3, 2)) // 3
	fmt.Println(vpBinom(5, 2, 5))  // 1
	fmt.Println(vpBinom(6, 1, 5))  // 0
}
```

**Java.**
```java
public class VpBinom {
    static long vpFactorial(long n, long p) {
        long e = 0;
        while (n > 0) { n /= p; e += n; }
        return e;
    }

    static long vpBinom(long n, long k, long p) {
        return vpFactorial(n, p) - vpFactorial(k, p) - vpFactorial(n - k, p);
    }

    public static void main(String[] args) {
        System.out.println(vpBinom(10, 3, 2)); // 3
        System.out.println(vpBinom(5, 2, 5));  // 1
        System.out.println(vpBinom(6, 1, 5));  // 0
    }
}
```

**Python.**
```python
def vp_factorial(n, p):
    e = 0
    while n:
        n //= p
        e += n
    return e


def vp_binom(n, k, p):
    return vp_factorial(n, p) - vp_factorial(k, p) - vp_factorial(n - k, p)


if __name__ == "__main__":
    print(vp_binom(10, 3, 2))  # 3
    print(vp_binom(5, 2, 5))   # 1
    print(vp_binom(6, 1, 5))   # 0
```

---

## Rapid-Fire One-Liners (10)

Quick recall checks — interviewers often fire these to gauge fluency:

1. **`fact[i]` recurrence?** `fact[i] = fact[i-1]·i mod p` (forward).
2. **`invfact[i]` recurrence?** `invfact[i-1] = invfact[i]·i mod p` (backward).
3. **How many inverses to build `invfact[]`?** Exactly one (for `fact[N]`).
4. **`C(n, k)` formula?** `fact[n]·invfact[k]·invfact[n-k] mod p`.
5. **`n! mod p` for `n ≥ p`?** `0`.
6. **`(p-1)! mod p`?** `-1` (Wilson).
7. **Exponent of `p` in `n!`?** `Σ ⌊n/p^i⌋` (Legendre).
8. **When is `C(n,k) ≡ 0 (mod p)`?** When a base-`p` carry occurs in `k + (n-k)` (Kummer).
9. **`n ≥ p` method?** Lucas' theorem.
10. **Prime-power method?** Granville / generalized Wilson.

---

## Final Tips

- Lead with the one-liner: *"precompute `fact[]` forward, `invfact[]` from one Fermat inverse backward, then `C(n,k)` is three multiplies."*
- Immediately flag the boundary: **`n! ≡ 0 (mod p)` for `n ≥ p`** — the table method needs `n < p` and prime `p`.
- Know the supporting theory on demand: **Wilson** (`(p-1)! ≡ -1`, a self-check), **Legendre** (`Σ ⌊n/p^i⌋`), **Kummer** (carries ⟹ zero).
- For `n ≥ p` reach for **Lucas**; for prime powers, **Granville** (generalized Wilson, block sign `±1`); for composites, **CRT** over prime powers.
- Always offer to verify with the inverse self-check `fact[i]·invfact[i] ≡ 1`, Wilson `fact[p-1] ≡ p-1`, and Pascal's recurrence on small inputs.
