# Binomial Coefficients C(n, k) — Interview Preparation

Binomial coefficients are an interview favourite because they sit at the crossroads of combinatorics, dynamic programming, and modular arithmetic. A strong candidate can (a) state and use **Pascal's identity** and the **multiplicative formula**, (b) compute `C(n,k) mod p` via **precomputed factorials + modular inverse** with the **single-inverse** trick, (c) reason about **overflow** and when to use DP vs the factorial method, and (d) know the boundary where **Lucas' theorem** and **CRT** become necessary. This file is a tiered question bank (45 Q&A) plus a multi-part coding challenge with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Count `k`-subsets of `n` | `C(n,k)` | — |
| Closed form | `n!/(k!(n−k)!)` | — |
| One value, no modulus | multiplicative `∏(n−k+i)/i`, use `min(k,n−k)` | `O(min(k,n−k))` |
| All small values | Pascal DP `C(n,k)=C(n−1,k−1)+C(n−1,k)` | `O(n²)` |
| Symmetry | `C(n,k)=C(n,n−k)` | — |
| `C(n,k) mod p`, `p` prime, many queries | `fact[n]·invFact[k]·invFact[n−k]` | `O(N)` setup, `O(1)`/query |
| Inverse of `a` mod prime `p` | Fermat `a^(p−2)` | `O(log p)` |
| All inverse factorials | `invFact[i−1]=invFact[i]·i` from one inverse | `O(N + log p)` |
| Huge `n`, small prime `p` | Lucas' theorem (sibling `24`) | `O(p + log_p n)` |
| Composite modulus | prime-power + CRT (`33`, `06`) | varies |

Key facts:
- **`C(n,0)=C(n,n)=1`**; `C(n,k)=0` if `k<0` or `k>n`.
- Pascal DP uses **addition only** — valid for *any* modulus, no inverse needed.
- The factorial method needs a **prime** modulus **and** `n < p`.
- Compute all inverse factorials from **one** Fermat inverse.
- Row sum `∑C(n,k)=2ⁿ`; hockey-stick `∑_{i=r}^n C(i,r)=C(n+1,r+1)`; Vandermonde `C(m+n,r)=∑C(m,k)C(n,r−k)`.

Core routine:

```text
build(N):                              # O(N)
    fact[0]=1; for i 1..N: fact[i]=fact[i-1]*i % p
    invFact[N]=pow(fact[N], p-2, p)    # one inverse
    for i N..1: invFact[i-1]=invFact[i]*i % p

C(n,k): if k<0 or k>n: 0
        else fact[n]*invFact[k]%p*invFact[n-k]%p   # O(1)
```

---

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What does `C(n, k)` count? | Number of ways to choose `k` items from `n`, order ignored. |
| 2 | What is `C(n, 0)` and `C(n, n)`? | Both `1` — one way to pick nothing / everything. |
| 3 | What is `C(n, k)` for `k < 0` or `k > n`? | `0` — impossible selections. |
| 4 | State the factorial formula. | `C(n,k) = n!/(k!(n−k)!)`. |
| 5 | What is Pascal's identity? | `C(n,k) = C(n−1,k−1) + C(n−1,k)`. |
| 6 | What is the symmetry identity? | `C(n,k) = C(n,n−k)`. |
| 7 | How big is row `n` of Pascal's triangle? | `n+1` entries: `C(n,0)…C(n,n)`. |
| 8 | What does row `n` sum to? | `2ⁿ` (total subsets). |
| 9 | Why prefer `min(k, n−k)` in the multiplicative form? | Fewer multiplies; symmetry makes them equal. |
| 10 | Time to build the full triangle to row `n`? | `O(n²)`. |
| 11 | Difference between a combination and a permutation? | Combination ignores order (`C`); permutation counts it (`P=n!/(n−k)!`). |
| 12 | Why does Pascal DP avoid overflow from division? | It uses **addition only** — no division at all. |

**Sample answer (Q5 — Pascal's identity).** "To choose `k` items from `n`, fix one item: either it's *in* the chosen set (then choose `k−1` from the remaining `n−1`) or it's *out* (choose `k` from `n−1`). These cases are disjoint and complete, so `C(n,k) = C(n−1,k−1) + C(n−1,k)`. This recurrence is exactly how Pascal's triangle is built — each cell is the sum of the two above it — using only addition."

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 13 | How do you compute `C(n,k) mod p` for many queries? | Precompute `fact`, `invFact`; query `fact[n]·invFact[k]·invFact[n−k]`. |
| 14 | Why must `p` be prime for the factorial method? | Inverses of factorials must exist; mod a prime every nonzero residue is invertible (Fermat). |
| 15 | How do you get all inverse factorials cheaply? | One Fermat inverse of `N!`, then `invFact[i−1]=invFact[i]·i`. |
| 16 | What is the complexity of the precompute + query? | `O(N)` setup, `O(1)` per query. |
| 17 | When is Pascal DP better than the factorial method? | Small `n`, many `(n,k)` pairs, or a **composite** modulus. |
| 18 | State the hockey-stick identity. | `∑_{i=r}^{n} C(i,r) = C(n+1,r+1)`. |
| 19 | State Vandermonde's identity. | `C(m+n,r) = ∑_k C(m,k)C(n,r−k)`. |
| 20 | Why is the multiplicative form integer-exact each step? | Partial product is `C(n−k+i, i)`, always an integer; multiply before divide. |
| 21 | When does `C(n,k)` overflow 64-bit? | Around `C(67,33) > 2⁶³`; use mod-p or BigInt. |
| 22 | How to compute one `C(n,k) mod p` with no table? | `k` numerator multiplies, `k!`, one Fermat inverse — `O(k+log p)`. |
| 23 | What is the absorption identity and a use? | `k·C(n,k)=n·C(n−1,k−1)`; re-index sums, compute expectations. |
| 24 | Why reduce mod `p` after every multiply? | A product of two residues can exceed 64-bit; chained without reduction it overflows. |
| 25 | How to space-optimize Pascal to a single row? | Keep one array; update **right-to-left** to use old values. |
| 26 | What's the alternating row sum and where used? | `∑(−1)ᵏC(n,k)=0` (`n≥1`); inclusion-exclusion (sibling `26`). |
| 27 | How does symmetry help with `C(10⁹, 2)`? | Compute as `C(10⁹, 2)` directly (small `k`); symmetry irrelevant here but use `min` generally. |

**Sample answer (Q15 — single-inverse trick).** "Computing `n` separate inverses costs `O(n log p)`. Instead compute *one* inverse: `invFact[N] = (N!)^{p−2} mod p`. Then sweep downward using `(i−1)!⁻¹ = i!⁻¹ · i` — because `(i−1)! = i!/i`. That gives every inverse factorial in `O(N + log p)`: one expensive inverse plus `N` cheap multiplies. It's the single most important efficiency trick in modular combinatorics."

**Sample answer (Q17 — DP vs factorial).** "Pascal DP wins when `n` is small (≲5000) and I need many `(n,k)` pairs, or — crucially — when the modulus is **composite**, because the DP uses only addition and needs no modular inverse. The factorial method wins when the modulus is a prime larger than every `n`, `n` is large, and I have many queries: `O(N)` setup then `O(1)` per query beats `O(n²)`."

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 28 | Design a service answering millions of `C(n,k) mod p` queries. | Build `fact`/`invFact` once at startup; immutable, lock-free, `O(1)` queries. |
| 29 | How do you size the precompute `N`? | `N ≥ max_n + 1` (slack for `n+1` identities), within memory budget `16·N` bytes. |
| 30 | The factorial method gives `0` for `C(1000,500) mod 13`. Why? | `n ≥ p`: `fact[n] ≡ 0`. Must use **Lucas** for `n ≥ p`. |
| 31 | When is the factorial method invalid? | Composite modulus, `n > N`, or `n ≥ p`. |
| 32 | How does Lucas' theorem compute `C(n,k) mod p`? | Multiply `C(nᵢ,kᵢ)` over base-`p` digits; each digit `< p`. |
| 33 | How to handle a composite modulus `M`? | Factor `M=∏pᵢ^{eᵢ}`, compute mod each prime power (sibling `33`), CRT-combine (sibling `06`). |
| 34 | Why never use `exp(lgamma(...))` for exact answers? | `double` exact only to `2⁵³`; loses low digits past that. |
| 35 | Is the shared `fact`/`invFact` table thread-safe? | Yes — read-only after build, so no locks needed for concurrent queries. |
| 36 | When does a single multiply overflow even after reduction? | When `p·p > 2⁶³`, i.e. `p ≳ 3·10⁹`; use 128-bit / Montgomery (sibling `16`). |
| 37 | `n` up to `10¹⁸` but `k ≤ 5` — best method? | Single-value `O(k+log p)`; no table possible. |
| 38 | What runtime checks belong in a combinatorics service? | Validate `p` prime at config; guard `n ≤ N`; detect `n ≥ p` and route to Lucas. |
| 39 | How to test a `C(n,k) mod p` implementation? | Oracle vs `math.comb` for small `n,k`; identity tests; modular round-trip `C·k!·(n−k)!≡n!`. |

**Sample answer (Q30 — the `n ≥ p` trap).** "The straight method computes `fact[n]·invFact[k]·invFact[n−k]`. But once `n ≥ p`, the product `n!` contains the factor `p`, so `fact[n] ≡ 0 (mod p)` and the inverse of `0` is undefined — the answer collapses to `0` even when the true `C(n,k) mod p` is nonzero. For `p = 13` and `n = 1000` this happens immediately. The fix is **Lucas' theorem**: decompose `n` and `k` into base-`p` digits and multiply `C(nᵢ,kᵢ)` per digit, where each argument is `< p` and the factorial method is valid."

---

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 40 | Prove Pascal's identity combinatorially. | Fix one element; subsets contain it or not; disjoint sum. |
| 41 | Prove Vandermonde via generating functions. | Coefficient of `xʳ` in `(1+x)^m(1+x)^n=(1+x)^{m+n}`. |
| 42 | Prove the hockey-stick identity. | Telescope `C(i+1,r+1)−C(i,r+1)=C(i,r)`, or classify by largest element. |
| 43 | Prove `C(n,k)` is always an integer. | Counts a finite set (Def 1.1), or `k!` divides `k` consecutive integers (Kummer). |
| 44 | State Kummer's theorem and a consequence. | `v_p(C(n,k))` = carries adding `k,n−k` base `p`; `p∤C(n,k)` iff no carries → Lucas. |
| 45 | Give the loop invariant for the multiplicative formula. | After step `i`, `r = C(n−k+i, i)`, an integer; division exact each step. |

**Sample answer (Q41 — Vandermonde via GF).** "By the binomial theorem `(1+x)^m(1+x)^n = (1+x)^{m+n}`. The coefficient of `xʳ` on the right is `C(m+n,r)`. On the left, multiplying the two polynomials, the coefficient of `xʳ` is the convolution `∑_{k=0}^{r} [x^k](1+x)^m · [x^{r−k}](1+x)^n = ∑_{k=0}^{r} C(m,k)C(n,r−k)`. Equating coefficients gives Vandermonde's identity. The combinatorial proof — count `r`-subsets of `m` reds and `n` blues by number of reds chosen — gives the same result more intuitively."

---

## Rapid-Fire Round (one-line answers)

| # | Question | Answer |
|---|----------|--------|
| 46 | `C(n, 1)` = ? | `n`. |
| 47 | `C(n, 2)` = ? | `n(n−1)/2`. |
| 48 | What is the maximum entry in row `n`? | The central `C(n, ⌊n/2⌋)`. |
| 49 | `C(2n, n)` grows like? | `4ⁿ/√(πn)` (Stirling). |
| 50 | Number of lattice paths `(0,0)→(a,b)` (right/up)? | `C(a+b, a)`. |
| 51 | Ways to put `n` balls in `k` boxes (empty ok)? | `C(n+k−1, k−1)` (stars-and-bars). |
| 52 | `n`-th Catalan number in terms of `C`? | `C(2n,n)/(n+1)`. |
| 53 | `∑ k·C(n,k)` = ? | `n·2^{n−1}`. |
| 54 | Is `C(n,k)` always an integer? | Yes — it counts a finite set. |
| 55 | `C(−1, k)` (generalized) = ? | `(−1)ᵏ`. |

**Sample answer (Q48 — row maximum).** "The consecutive ratio `C(n,k+1)/C(n,k) = (n−k)/(k+1)` exceeds 1 while `k < (n−1)/2` and drops below 1 after, so the row rises to the middle then falls — it's unimodal, peaking at `C(n, ⌊n/2⌋)`. For even `n` there's a single peak; for odd `n` the two middle entries tie."

---

## Deep-Dive Discussion Questions

These are open-ended prompts a senior interviewer uses to probe depth. Bullet the key points you should hit.

**D1. "Walk me through computing `C(n,k) mod 10⁹+7` for `n` up to `10⁶`, `10⁵` queries, time limit 1s."**
- Precompute `fact[0..N]` and `invFact[0..N]` once: `O(N)`.
- One Fermat inverse of `N!`, then sweep `invFact[i−1]=invFact[i]·i`.
- Each query `fact[n]·invFact[k]·invFact[n−k] mod p`: `O(1)`, reduce after every multiply.
- Total `O(N + q)` — easily within 1s.

**D2. "Same problem but the modulus is `12` (composite). What changes?"**
- The factorial method fails — inverses of factors sharing a divisor with `12` don't exist.
- Use **Pascal DP** (addition only, valid mod anything) if `n` is small.
- For large `n`: factor `12 = 4·3 = 2²·3`, compute mod each prime power (sibling `33`), CRT-combine (sibling `06`).

**D3. "Now `n` can be `10¹⁸` and the modulus is a small prime `13`. Method?"**
- Can't precompute `10¹⁸` factorials, and `n ≥ p` breaks the straight method.
- Use **Lucas' theorem**: base-13 digits of `n` and `k`, multiply `C(nᵢ,kᵢ) mod 13` per digit.
- Precompute only `fact[0..12]`; `O(log_13 n)` digits.

**D4. "How would you test all of this?"**
- Oracle against `math.comb` for all `n,k ≤ 50`.
- Property tests: Pascal, symmetry, hockey-stick, Vandermonde on random inputs.
- Modular round-trip: `C(n,k)·k!·(n−k)! ≡ n! (mod p)`.
- Cross-check Lucas vs the straight method where both are valid (`n < p`).

---

## Coding Challenge 2 — Lattice Paths with Obstacles (3 Languages)

> **Problem.** Count monotone lattice paths from `(0,0)` to `(a,b)` (moves right or up only) that **avoid** a single blocked cell `(bx, by)`, modulo `p = 10⁹+7`.
>
> **Insight.** Total paths `= C(a+b, a)`. Paths through the blocked cell `= C(bx+by, bx) · C((a−bx)+(b−by), a−bx)`. Subtract. This uses the **multiplication principle** and the lattice-path interpretation of `C`.

#### Go

```go
package main

import "fmt"

const MOD = 1_000_000_007

var fact, invFact []int64

func powMod(a, e, m int64) int64 {
	a %= m
	r := int64(1)
	for e > 0 {
		if e&1 == 1 {
			r = r * a % m
		}
		a = a * a % m
		e >>= 1
	}
	return r
}

func build(n int) {
	fact = make([]int64, n+1)
	invFact = make([]int64, n+1)
	fact[0] = 1
	for i := 1; i <= n; i++ {
		fact[i] = fact[i-1] * int64(i) % MOD
	}
	invFact[n] = powMod(fact[n], MOD-2, MOD)
	for i := n; i > 0; i-- {
		invFact[i-1] = invFact[i] * int64(i) % MOD
	}
}

func C(n, k int) int64 {
	if k < 0 || k > n {
		return 0
	}
	return fact[n] * invFact[k] % MOD * invFact[n-k] % MOD
}

func paths(a, b, bx, by int) int64 {
	total := C(a+b, a)
	through := C(bx+by, bx) * C((a-bx)+(b-by), a-bx) % MOD
	return (total - through + MOD) % MOD // keep non-negative
}

func main() {
	build(100)
	fmt.Println(paths(2, 2, 1, 1)) // 6 total - 4 through (1,1) = 2
}
```

#### Java

```java
public class LatticePaths {
    static final long MOD = 1_000_000_007L;
    static long[] fact, invFact;

    static long powMod(long a, long e, long m) {
        a %= m; long r = 1;
        while (e > 0) { if ((e & 1) == 1) r = r * a % m; a = a * a % m; e >>= 1; }
        return r;
    }

    static void build(int n) {
        fact = new long[n + 1]; invFact = new long[n + 1];
        fact[0] = 1;
        for (int i = 1; i <= n; i++) fact[i] = fact[i - 1] * i % MOD;
        invFact[n] = powMod(fact[n], MOD - 2, MOD);
        for (int i = n; i > 0; i--) invFact[i - 1] = invFact[i] * i % MOD;
    }

    static long C(int n, int k) {
        if (k < 0 || k > n) return 0;
        return fact[n] * invFact[k] % MOD * invFact[n - k] % MOD;
    }

    static long paths(int a, int b, int bx, int by) {
        long total = C(a + b, a);
        long through = C(bx + by, bx) * C((a - bx) + (b - by), a - bx) % MOD;
        return (total - through + MOD) % MOD;
    }

    public static void main(String[] args) {
        build(100);
        System.out.println(paths(2, 2, 1, 1)); // 2
    }
}
```

#### Python

```python
MOD = 1_000_000_007
_fact, _inv = [], []

def build(n):
    global _fact, _inv
    _fact = [1] * (n + 1)
    for i in range(1, n + 1):
        _fact[i] = _fact[i - 1] * i % MOD
    _inv = [1] * (n + 1)
    _inv[n] = pow(_fact[n], MOD - 2, MOD)
    for i in range(n, 0, -1):
        _inv[i - 1] = _inv[i] * i % MOD


def C(n, k):
    if k < 0 or k > n:
        return 0
    return _fact[n] * _inv[k] % MOD * _inv[n - k] % MOD


def paths(a, b, bx, by):
    total = C(a + b, a)
    through = C(bx + by, bx) * C((a - bx) + (b - by), a - bx) % MOD
    return (total - through) % MOD


if __name__ == "__main__":
    build(100)
    print(paths(2, 2, 1, 1))  # 2
```

**Expected:** for a `2×2` grid blocking `(1,1)`, total paths `C(4,2)=6`, paths through `(1,1)` = `C(2,1)·C(2,1)=4`, so `6−4=2`.

**Follow-up:** *Generalize to multiple obstacles.* Sort obstacles, DP over them with inclusion-exclusion of "first blocked cell hit" — a direct application of the subtract-paths-through-a-cell idea, scaled up.

---

## Behavioral / Communication Prompts

- *Explain Pascal's triangle to someone who only knows addition.* — Each number is the sum of the two above it; the edges are all `1`.
- *A teammate uses `double` for `C(n,k)` and gets wrong large values. How do you explain the bug?* — `double` only holds integers exactly to `2⁵³`; large binomials lose low-order digits; switch to BigInt or modular.
- *Your service returns `0` for some large-`n` queries mod a small prime. Walk through diagnosing it.* — Recognize `n ≥ p` invalidates the factorial method; route to Lucas; add a metric.
- *Justify choosing DP over the factorial method in a code review.* — Composite modulus or small `n` with many pairs; DP needs no inverse and is simpler/safer.

---

## Coding Challenge (3 Languages)

### Challenge: Binomial Coefficient Toolkit

> Implement a small toolkit with three functions and verify they agree on small inputs:
> 1. `pascalRow(n)` — return row `n` of Pascal's triangle (exact integers) using only addition, `O(n)` space.
> 2. `chooseExact(n, k)` — return exact `C(n,k)` (BigInt) via the multiplicative formula with `min(k,n−k)`.
> 3. `combMod(n, k, p)` after `build(N, p)` — return `C(n,k) mod p` in `O(1)` using precomputed factorials and the single-inverse trick.
>
> **Test:** `pascalRow(5) == [1,5,10,10,5,1]`, `chooseExact(20,10) == 184756`, `combMod(1000,500,1_000_000_007)` matches `chooseExact(1000,500) mod p`.

#### Go

```go
package main

import (
	"fmt"
	"math/big"
)

// 1) one-row Pascal, O(n) space, addition only
func pascalRow(n int) []*big.Int {
	row := make([]*big.Int, n+1)
	for i := range row {
		row[i] = big.NewInt(1)
	}
	for i := 1; i <= n; i++ {
		for k := i - 1; k > 0; k-- { // right-to-left
			row[k] = new(big.Int).Add(row[k], row[k-1])
		}
	}
	return row
}

// 2) exact C(n,k) via multiplicative formula, BigInt
func chooseExact(n, k int64) *big.Int {
	if k < 0 || k > n {
		return big.NewInt(0)
	}
	if k > n-k {
		k = n - k
	}
	r := big.NewInt(1)
	for i := int64(1); i <= k; i++ {
		r.Mul(r, big.NewInt(n-k+i))
		r.Div(r, big.NewInt(i)) // exact each step
	}
	return r
}

// 3) modular C(n,k) with precompute and single inverse
const MOD = 1_000_000_007

var fact, invFact []int64

func powMod(a, e, m int64) int64 {
	a %= m
	r := int64(1)
	for e > 0 {
		if e&1 == 1 {
			r = r * a % m
		}
		a = a * a % m
		e >>= 1
	}
	return r
}

func build(n int) {
	fact = make([]int64, n+1)
	invFact = make([]int64, n+1)
	fact[0] = 1
	for i := 1; i <= n; i++ {
		fact[i] = fact[i-1] * int64(i) % MOD
	}
	invFact[n] = powMod(fact[n], MOD-2, MOD) // single inverse
	for i := n; i > 0; i-- {
		invFact[i-1] = invFact[i] * int64(i) % MOD
	}
}

func combMod(n, k int) int64 {
	if k < 0 || k > n {
		return 0
	}
	return fact[n] * invFact[k] % MOD * invFact[n-k] % MOD
}

func main() {
	row := pascalRow(5)
	fmt.Print("pascalRow(5):")
	for _, x := range row {
		fmt.Print(" ", x)
	}
	fmt.Println() // 1 5 10 10 5 1

	fmt.Println("chooseExact(20,10):", chooseExact(20, 10)) // 184756

	build(1000)
	exact := new(big.Int).Mod(chooseExact(1000, 500), big.NewInt(MOD))
	fmt.Println("combMod(1000,500):", combMod(1000, 500), "== exact mod p:", exact)
}
```

#### Java

```java
import java.math.BigInteger;

public class BinomialToolkit {
    // 1) one-row Pascal, O(n) space
    static BigInteger[] pascalRow(int n) {
        BigInteger[] row = new BigInteger[n + 1];
        for (int i = 0; i <= n; i++) row[i] = BigInteger.ONE;
        for (int i = 1; i <= n; i++)
            for (int k = i - 1; k > 0; k--)           // right-to-left
                row[k] = row[k].add(row[k - 1]);
        return row;
    }

    // 2) exact C(n,k), BigInteger
    static BigInteger chooseExact(long n, long k) {
        if (k < 0 || k > n) return BigInteger.ZERO;
        if (k > n - k) k = n - k;
        BigInteger r = BigInteger.ONE;
        for (long i = 1; i <= k; i++) {
            r = r.multiply(BigInteger.valueOf(n - k + i))
                 .divide(BigInteger.valueOf(i));       // exact each step
        }
        return r;
    }

    // 3) modular C(n,k)
    static final long MOD = 1_000_000_007L;
    static long[] fact, invFact;

    static long powMod(long a, long e, long m) {
        a %= m; long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % m;
            a = a * a % m;
            e >>= 1;
        }
        return r;
    }

    static void build(int n) {
        fact = new long[n + 1];
        invFact = new long[n + 1];
        fact[0] = 1;
        for (int i = 1; i <= n; i++) fact[i] = fact[i - 1] * i % MOD;
        invFact[n] = powMod(fact[n], MOD - 2, MOD);   // single inverse
        for (int i = n; i > 0; i--) invFact[i - 1] = invFact[i] * i % MOD;
    }

    static long combMod(int n, int k) {
        if (k < 0 || k > n) return 0;
        return fact[n] * invFact[k] % MOD * invFact[n - k] % MOD;
    }

    public static void main(String[] args) {
        BigInteger[] row = pascalRow(5);
        StringBuilder sb = new StringBuilder("pascalRow(5):");
        for (BigInteger x : row) sb.append(" ").append(x);
        System.out.println(sb);                              // 1 5 10 10 5 1

        System.out.println("chooseExact(20,10): " + chooseExact(20, 10)); // 184756

        build(1000);
        BigInteger exact = chooseExact(1000, 500).mod(BigInteger.valueOf(MOD));
        System.out.println("combMod(1000,500): " + combMod(1000, 500)
                + " == exact mod p: " + exact);
    }
}
```

#### Python

```python
import math

# 1) one-row Pascal, O(n) space, addition only (Python ints are exact)
def pascal_row(n):
    row = [1] * (n + 1)
    for i in range(1, n + 1):
        for k in range(i - 1, 0, -1):   # right-to-left
            row[k] += row[k - 1]
    return row


# 2) exact C(n,k) via multiplicative formula
def choose_exact(n, k):
    if k < 0 or k > n:
        return 0
    k = min(k, n - k)
    r = 1
    for i in range(1, k + 1):
        r = r * (n - k + i) // i        # exact each step
    return r


# 3) modular C(n,k) with precompute + single inverse
MOD = 1_000_000_007
_fact = []
_invfact = []

def build(n):
    global _fact, _invfact
    _fact = [1] * (n + 1)
    for i in range(1, n + 1):
        _fact[i] = _fact[i - 1] * i % MOD
    _invfact = [1] * (n + 1)
    _invfact[n] = pow(_fact[n], MOD - 2, MOD)   # single inverse
    for i in range(n, 0, -1):
        _invfact[i - 1] = _invfact[i] * i % MOD


def comb_mod(n, k):
    if k < 0 or k > n:
        return 0
    return _fact[n] * _invfact[k] % MOD * _invfact[n - k] % MOD


if __name__ == "__main__":
    print("pascal_row(5):", pascal_row(5))             # [1, 5, 10, 10, 5, 1]
    print("choose_exact(20,10):", choose_exact(20, 10))# 184756
    assert choose_exact(20, 10) == math.comb(20, 10)

    build(1000)
    exact = choose_exact(1000, 500) % MOD
    print("comb_mod(1000,500):", comb_mod(1000, 500), "== exact mod p:", exact)
    assert comb_mod(1000, 500) == exact
```

**Expected output (all three):** `pascalRow(5)` = `1 5 10 10 5 1`, `chooseExact(20,10)` = `184756`, and `combMod(1000,500)` equals `chooseExact(1000,500) mod p`.

**Follow-ups the interviewer may ask:**
- *Make `combMod` work for `n ≥ p`.* → switch to Lucas' theorem (sibling `24`).
- *Make it work for a composite modulus.* → prime-power decomposition + CRT (siblings `33`, `06`).
- *Why right-to-left in `pascalRow`?* → to read the old `row[k−1]` before it's overwritten this pass.
- *Why one inverse instead of `n`?* → `invFact[i−1]=invFact[i]·i` turns `O(n log p)` into `O(n+log p)`.
