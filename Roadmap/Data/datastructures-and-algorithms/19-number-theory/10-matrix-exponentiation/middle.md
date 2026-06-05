# Matrix Exponentiation for Linear Recurrences — Middle Level

> **Focus:** Building the **companion matrix** for a general order-`k` recurrence, handling recurrences with an **added constant** or a **prefix sum** by *augmenting* the matrix, doing the whole power **modulo a prime**, and knowing when matrix exponentiation beats a plain DP loop and when the Kitamasa pointer beats matrix exponentiation.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [The General Recipe: Recurrence → Matrix](#the-general-recipe-recurrence--matrix)
4. [Augmentation: Constants and Prefix Sums](#augmentation-constants-and-prefix-sums)
5. [The O(d³ log k) Cost, Broken Down](#the-od³-log-k-cost-broken-down)
6. [The Graph Transfer-Matrix View](#the-graph-transfer-matrix-view)
7. [Comparison with Alternatives](#comparison-with-alternatives)
8. [Worked Examples](#worked-examples)
9. [Code Examples](#code-examples)
10. [Error Handling](#error-handling)
11. [Performance Analysis](#performance-analysis)
12. [Best Practices](#best-practices)
13. [Frequently Asked Questions](#frequently-asked-questions)
14. [Visual Animation](#visual-animation)
15. [Summary](#summary)

---

## Introduction

At junior level the message was a single fact: a linear recurrence is `state_n = M · state_{n-1}`, so `state_n = M^n · state_0`, computed in `O(log n)` for Fibonacci. At middle level you learn to *build* the matrix for **any** recurrence and to bend the construction to cover the cases that show up in real problems:

- How do you write the `k × k` **companion matrix** for an order-`k` recurrence `f(n) = c_1 f(n-1) + … + c_k f(n-k)`?
- What if there is an **added constant**, e.g. `f(n) = 2 f(n-1) + 5`? The plain matrix is wrong — you **augment** it.
- What if you also need the **running sum** `S(n) = f(0) + … + f(n)`? Augment again with a prefix-sum row.
- How do you keep the entire computation **modular** so nothing overflows?
- When is a plain DP loop good enough, and when does the order-`k` **Kitamasa** trick (`O(k² log n)`) beat the matrix power (`O(k³ log n)`)?

These are the questions that separate "I can power the Fibonacci matrix" from "I can turn any linear recurrence I am handed into a `O(k³ log n)` evaluation."

This is the number-theory / linear-recurrence angle. The graph cousin — counting walks of length `k` via `A^k` — is `11-graphs/32-paths-fixed-length`; cross-reference it for the combinatorial interpretation of the same matrix powers.

---

## Deeper Concepts

### The state vector, restated

For an order-`k` recurrence, the **state** that determines the future is the window of the last `k` terms:

```
state_n = ( f(n), f(n-1), f(n-2), …, f(n-k+1) )ᵀ      (a k×1 column)
```

The transition matrix `M` is the unique `k × k` matrix with `M · state_{n-1} = state_n`. Building it correctly is the whole skill, and it always has the same shape.

### Why the companion matrix has its shape

The new top component `f(n)` is the recurrence itself, so the **top row** is the coefficient list `(c_1, c_2, …, c_k)`. Every *other* new component `f(n-1), …, f(n-k+1)` is simply an old component copied down one slot — that "shift" is encoded by an identity block placed just below the diagonal. Hence the companion matrix:

```
      [ c_1  c_2  c_3  …  c_{k-1}  c_k ]   <- the recurrence (top row)
      [  1    0    0   …    0       0  ]   <- copy f(n-1) into slot 2
M  =  [  0    1    0   …    0       0  ]   <- copy f(n-2) into slot 3
      [  …                          …  ]
      [  0    0    0   …    1       0  ]   <- copy f(n-k+1) into slot k
```

The sub-diagonal of `1`s does the shifting; the top row does the linear combination. Memorize this template — it is the answer to "how do I build the matrix" for *every* homogeneous constant-coefficient recurrence.

### The eigenvalue connection (preview)

The companion matrix's **characteristic polynomial** is exactly the recurrence's characteristic equation `λ^k − c_1 λ^{k-1} − … − c_k = 0`. Its roots are the eigenvalues, which control the growth rate (`F_n ∼ φ^n` for Fibonacci, where `φ` is the golden ratio root). This is why the matrix and the recurrence are "the same object" — the full statement is in `professional.md`.

---

## The General Recipe: Recurrence → Matrix

Here is the step-by-step recipe to build the transition matrix from any constant-coefficient linear recurrence.

1. **Identify the order `k`.** It is the number of past terms the recurrence depends on. `f(n) = c_1 f(n-1) + … + c_k f(n-k)` has order `k`.
2. **Define the state** as the column `(f(n), f(n-1), …, f(n-k+1))ᵀ` of length `k`.
3. **Top row = coefficients.** Put `(c_1, c_2, …, c_k)` in row 0 of `M`.
4. **Sub-diagonal = identity shift.** Set `M[i][i-1] = 1` for `i = 1 … k-1`; all other entries are `0`.
5. **Initial state vector.** Build `state_0 = (f(k-1), f(k-2), …, f(0))ᵀ` from the given initial values (note the reverse order: the newest term sits on top).
6. **Compute and read.** `state_n = M^{n-(k-1)} · state_0`; the term `f(n)` is the top entry. (Handle `n < k` by returning the given initial value directly.)

That is the complete recipe. The only place people slip is step 5 (the reversal) and the exponent in step 6 — verify both against the naive loop on small `n`.

---

## Augmentation: Constants and Prefix Sums

The companion matrix only handles **homogeneous** recurrences (no extra constant, no running sum). Two extremely common variations need an **augmented** (larger) matrix.

### Variation A: An added constant

Consider `f(n) = 2 f(n-1) + 5`, with `f(0) = 1`. The `+5` is not a multiple of a previous term, so it cannot live in a plain `1×1` companion matrix. The fix: **carry the constant as an extra state component that always equals 1.** Use state `(f(n), 1)ᵀ` and:

```
[ f(n) ]   [ 2  5 ] [ f(n-1) ]
[  1   ] = [ 0  1 ] [   1    ]
```

The bottom row `(0, 1)` keeps the constant slot equal to `1` forever; the `5` in the top row injects `5·1 = 5` each step. This generalizes: append a row/column whose diagonal entry is `1` (a self-loop on the constant), and place the constant `b` in the top row's new column. The matrix grows from `k × k` to `(k+1) × (k+1)`.

### Variation B: A running prefix sum

Suppose you need `S(n) = f(0) + f(1) + … + f(n)` for a recurrence-defined `f`. Add a state component that accumulates the sum. With state `(S(n), f(n), f(n-1))ᵀ` for an order-2 `f(n) = c_1 f(n-1) + c_2 f(n-2)`:

```
[ S(n)   ]   [ 1  c_1  c_2 ] [ S(n-1) ]
[ f(n)   ] = [ 0  c_1  c_2 ] [ f(n-1) ]
[ f(n-1) ]   [ 0   1    0  ] [ f(n-2) ]
```

The top row carries the old sum forward (the leading `1`) and adds the new term `f(n) = c_1 f(n-1) + c_2 f(n-2)`. The middle and bottom rows are just the ordinary companion block for `f`. Powering this `3×3` matrix gives both `f(n)` and its prefix sum `S(n)` in one shot.

### The augmentation principle

Both variations follow one rule: **anything you want the recurrence to "remember" or "accumulate" becomes an extra component of the state vector, with a corresponding extra row/column in `M`.** Constants get a self-looping `1`; prefix sums get a row that copies its own value forward and adds the new term. This is the same idea as the "sink vertex" augmentation in the graph topic `11-graphs/32-paths-fixed-length` — extra state, extra dimension.

---

## The O(d³ log k) Cost, Broken Down

It is worth pinning down exactly where the cost `O(d³ log k)` comes from, where `d` is the matrix dimension (the recurrence order, possibly after augmentation) and `k` is the index we want (called `n` elsewhere; here we use `k` to match the standard `O(d³ log k)` phrasing). There are three nested costs, and confusing them is a common source of wrong complexity claims in interviews.

1. **One scalar multiply-add is `O(1)`** — over `ℤ_p` with a fixed-width modulus, computing `a·b mod p` is a constant-time machine operation. (This `O(1)` assumption *fails* if you keep exact non-modular big integers; see `senior.md`.)

2. **One matrix multiply `M · N` is `O(d³)`** — the result has `d²` entries, and each entry is a dot product of length `d` (one multiply-add per term). So `d² · d = d³` scalar operations. For `d = 2` that is 8 operations; for `d = 10` it is 1000.

3. **Binary exponentiation does `O(log k)` matrix multiplies** — reading the bits of `k`, we perform one *squaring* per bit (about `log₂ k` of them) plus one *accumulate* per set bit (at most `log₂ k`). So at most `2 log₂ k` matrix multiplies. For `k = 10^18`, `log₂ k ≈ 60`, so under 120 matrix multiplies.

Multiplying the three layers: `O(1) × O(d³) × O(log k) = O(d³ log k)`. The headline is that the dependence on the index `k` is only *logarithmic*, while the dependence on the order `d` is *cubic*. This is the precise trade that decides everything:

| If you increase... | Cost grows by... | Practical effect |
|--------------------|------------------|------------------|
| the index `k` (e.g. `10^9 → 10^18`) | `+1` multiply per extra bit (doubling `k` adds one iteration) | negligible — that is the whole point |
| the order `d` (e.g. `2 → 4`) | `8×` per multiply (`d³`) | the real budget; keep `d` minimal |

So the senior-level mantra "keep the matrix dimension minimal" is just calculus on this formula: shaving one dimension off `d` is far more valuable than any cleverness about `k`. Augmenting for a constant raises `d` from `k` to `k+1` and therefore multiplies the per-step cost by `((k+1)/k)³` — usually negligible, but a reminder that every augmentation has a (small) cubic price.

---

## The Graph Transfer-Matrix View

The same `M^k` machinery has a second, combinatorial reading that is worth recognizing because it unifies a huge family of counting problems with linear recurrences. This is the **transfer-matrix** (or **adjacency-matrix-power**) view, treated in full in `11-graphs/32-paths-fixed-length`; here we only draw the bridge so you see they are the same algebra.

Build a directed graph whose vertices are the possible "local states" of your problem and whose edge `i → j` exists when state `i` can be immediately followed by state `j`. Let `A` be the adjacency matrix (`A[i][j] = 1` if the edge exists, or a weight/count for multigraphs). Then a classic theorem says:

> `(A^k)[i][j]` = the number of distinct walks of length exactly `k` from vertex `i` to vertex `j`.

The proof is the same dot-product unrolling as a recurrence: `(A^k)[i][j] = Σ_t (A^{k-1})[i][t] · A[t][j]` sums over the second-to-last vertex `t`, exactly the way a linear recurrence sums over the previous term. So **counting length-`k` walks and evaluating an order-`d` recurrence are the same operation** — raise a `d × d` matrix to the `k`-th power by binary exponentiation, `O(d³ log k)`.

The connection runs both ways:

- A **linear recurrence** *is* a transfer matrix: the companion matrix's edges encode "the previous window of terms can be followed by this new window." Fibonacci's `[[1,1],[1,0]]` is the adjacency matrix of a tiny 2-vertex graph.
- A **transfer-matrix counting problem** *is* a linear recurrence: the counts `c_k = Σ_{i,j} (A^k)[i][j]` satisfy the recurrence whose characteristic polynomial is that of `A` (Cayley-Hamilton again).

Concrete examples that collapse to a small transfer matrix: counting binary strings of length `k` with no two adjacent `1`s (a 2-state graph, gives Fibonacci), counting tilings of a `2×k` board (also Fibonacci, see the worked example below), or counting paths in a small automaton. Whenever a problem says "count length-`k` configurations subject to a *local* constraint," look for a small state graph; if you find one with `d` states, you get `O(d³ log k)` immediately.

The division of labor in this roadmap: **this** topic is the number-theory / linear-recurrence angle (companion matrices, Fibonacci, mod `p`); `11-graphs/32-paths-fixed-length` is the **graph** angle (adjacency-matrix powers, walk counting). The matrix arithmetic is byte-for-byte identical — only the *interpretation* of the rows and columns differs. Do not duplicate the walk-counting derivation here; cross-reference it.

---

## Comparison with Alternatives

### Naive loop vs matrix exponentiation

| Approach | Time | Good when |
|----------|------|-----------|
| Naive loop `for i in 1..n` | `O(k · n)` | small `n` (say `n ≤ 10^6`) |
| **Matrix exponentiation** | `O(k³ log n)` | large `n`, small order `k` |
| Kitamasa / Cayley-Hamilton | `O(k² log n)` | large `n`, *large* order `k`, single term |
| Closed form (Binet etc.) | `O(1)` per term | only when roots are nice and you can avoid floats |

Concrete table (order `k = 2`, Fibonacci):

| `n` | Naive loop ops | Matrix-exp ops (`k³ log n`) | Winner |
|------|----------------|------------------------------|--------|
| 100 | 100 | ~50 | tie |
| 10⁶ | 10⁶ | ~120 | matrix-exp |
| 10¹² | 10¹² (too slow) | ~160 | matrix-exp |
| 10¹⁸ | impossible | ~240 | matrix-exp |

For **small `n`** the plain loop is simpler and even faster (no `k³` per step). For **large `n`** matrix exponentiation wins by an astronomical margin. Pick based on `n`, not by habit.

### Matrix exponentiation vs Kitamasa

Both compute `f(n)` in `O(log n)` *iterations*; the difference is the per-iteration cost:

| Method | Per iteration | Total | Best when |
|--------|---------------|-------|-----------|
| Matrix power | `O(k³)` matrix multiply | `O(k³ log n)` | order `k` small (≤ ~64) |
| Kitamasa (polynomial) | `O(k²)` polynomial multiply + reduce | `O(k² log n)` | order `k` large |

Kitamasa works with the recurrence's characteristic polynomial directly (a "pointer" of `k` coefficients) instead of the full `k²`-entry matrix, shaving a factor of `k`. The crossover is around `k ≈ 64`. For everyday recurrences (order 2–10) the matrix power's simplicity wins; for order in the hundreds, reach for Kitamasa (detailed in `professional.md` and `senior.md`).

---

## Worked Examples

### Tribonacci (order 3)

`T(n) = T(n-1) + T(n-2) + T(n-3)`, `T(0)=0, T(1)=1, T(2)=1`. Coefficients `(1,1,1)`:

```
M = [ 1  1  1 ]      state_0 = ( T(2), T(1), T(0) )ᵀ = (1, 1, 0)ᵀ
    [ 1  0  0 ]
    [ 0  1  0 ]
```

`state_{n-2} = M^{n-2} · state_0`; the top entry is `T(n)`.

### Counting tilings of a 2×n board with 1×2 dominoes

The number of tilings `D(n)` satisfies `D(n) = D(n-1) + D(n-2)` (place a vertical domino, or two horizontals) with `D(0)=1, D(1)=1`. This is Fibonacci-shaped: the same `2×2` matrix solves it. Many counting problems collapse to a linear recurrence and then to a matrix power — the matrix *is* the compressed transfer rule.

### Recurrence with a constant

`a(n) = 3 a(n-1) + 2`, `a(0) = 0`. Augment to state `(a(n), 1)ᵀ`:

```
M = [ 3  2 ]      state_0 = (0, 1)ᵀ
    [ 0  1 ]
```

`a(n)` is the top entry of `M^n · state_0`. Check: `a(1) = 3·0 + 2 = 2`, `a(2) = 3·2 + 2 = 8`, and the matrix reproduces these.

### Counting binary strings with no two adjacent 1s

Let `B(n)` be the number of length-`n` binary strings with no two consecutive `1`s. A valid string of length `n` either ends in `0` (preceded by any valid length-`n-1` string) or ends in `01` (preceded by any valid length-`n-2` string), giving `B(n) = B(n-1) + B(n-2)` with `B(1)=2, B(2)=3`. This is Fibonacci-shaped again — the *same* `2×2` matrix `[[1,1],[1,0]]`, only the initial vector differs. It is also the cleanest illustration of the transfer-matrix view: the two "states" are *last bit was 0* and *last bit was 1*, the allowed transitions form a 2-vertex graph, and `B(n)` counts the length-`n` walks. The graph derivation lives in `11-graphs/32-paths-fixed-length`.

---

## Code Examples

### General order-`k` linear recurrence solver (counting semiring, mod p)

#### Go

```go
package main

import "fmt"

const MOD = 1_000_000_007

func mul(a, b [][]int64) [][]int64 {
	n, m, p := len(a), len(b), len(b[0])
	c := make([][]int64, n)
	for i := range c {
		c[i] = make([]int64, p)
		for t := 0; t < m; t++ {
			if a[i][t] == 0 {
				continue
			}
			for j := 0; j < p; j++ {
				c[i][j] = (c[i][j] + a[i][t]*b[t][j]) % MOD
			}
		}
	}
	return c
}

func matPow(a [][]int64, n int64) [][]int64 {
	sz := len(a)
	r := make([][]int64, sz)
	for i := range r {
		r[i] = make([]int64, sz)
		r[i][i] = 1 // identity
	}
	for n > 0 {
		if n&1 == 1 {
			r = mul(r, a)
		}
		a = mul(a, a)
		n >>= 1
	}
	return r
}

// nthTerm builds the companion matrix and returns f(n) mod p.
func nthTerm(coeffs, init []int64, n int64) int64 {
	k := len(coeffs)
	if n < int64(k) {
		return init[n] % MOD
	}
	M := make([][]int64, k)
	for i := range M {
		M[i] = make([]int64, k)
	}
	for j := 0; j < k; j++ {
		M[0][j] = coeffs[j] % MOD // top row = coefficients
	}
	for i := 1; i < k; i++ {
		M[i][i-1] = 1 // sub-diagonal shift
	}
	Mn := matPow(M, n-int64(k-1))
	// state_0 = (f(k-1), ..., f(0))ᵀ
	state := make([][]int64, k)
	for i := 0; i < k; i++ {
		state[i] = []int64{init[k-1-i]}
	}
	return mul(Mn, state)[0][0] % MOD
}

func main() {
	fmt.Println(nthTerm([]int64{1, 1}, []int64{0, 1}, 10))    // Fibonacci: 55
	fmt.Println(nthTerm([]int64{1, 1, 1}, []int64{0, 1, 1}, 10)) // Tribonacci
}
```

#### Java

```java
public class LinearRecurrence {
    static final long MOD = 1_000_000_007L;

    static long[][] mul(long[][] a, long[][] b) {
        int n = a.length, m = b.length, p = b[0].length;
        long[][] c = new long[n][p];
        for (int i = 0; i < n; i++)
            for (int t = 0; t < m; t++) {
                if (a[i][t] == 0) continue;
                for (int j = 0; j < p; j++)
                    c[i][j] = (c[i][j] + a[i][t] * b[t][j]) % MOD;
            }
        return c;
    }

    static long[][] matPow(long[][] a, long n) {
        int sz = a.length;
        long[][] r = new long[sz][sz];
        for (int i = 0; i < sz; i++) r[i][i] = 1;
        while (n > 0) {
            if ((n & 1) == 1) r = mul(r, a);
            a = mul(a, a);
            n >>= 1;
        }
        return r;
    }

    static long nthTerm(long[] coeffs, long[] init, long n) {
        int k = coeffs.length;
        if (n < k) return init[(int) n] % MOD;
        long[][] M = new long[k][k];
        for (int j = 0; j < k; j++) M[0][j] = coeffs[j] % MOD;
        for (int i = 1; i < k; i++) M[i][i - 1] = 1;
        long[][] Mn = matPow(M, n - (k - 1));
        long[][] state = new long[k][1];
        for (int i = 0; i < k; i++) state[i][0] = init[k - 1 - i];
        return mul(Mn, state)[0][0] % MOD;
    }

    public static void main(String[] args) {
        System.out.println(nthTerm(new long[]{1, 1}, new long[]{0, 1}, 10));       // 55
        System.out.println(nthTerm(new long[]{1, 1, 1}, new long[]{0, 1, 1}, 10)); // Tribonacci
    }
}
```

#### Python

```python
MOD = 1_000_000_007


def mul(a, b):
    n, m, p = len(a), len(b), len(b[0])
    c = [[0] * p for _ in range(n)]
    for i in range(n):
        ai, ci = a[i], c[i]
        for t in range(m):
            if ai[t]:
                ait, bt = ai[t], b[t]
                for j in range(p):
                    ci[j] = (ci[j] + ait * bt[j]) % MOD
    return c


def mat_pow(a, n):
    sz = len(a)
    r = [[1 if i == j else 0 for j in range(sz)] for i in range(sz)]
    while n > 0:
        if n & 1:
            r = mul(r, a)
        a = mul(a, a)
        n >>= 1
    return r


def nth_term(coeffs, init, n):
    k = len(coeffs)
    if n < k:
        return init[n] % MOD
    M = [[0] * k for _ in range(k)]
    M[0] = [c % MOD for c in coeffs]      # top row = coefficients
    for i in range(1, k):
        M[i][i - 1] = 1                    # sub-diagonal shift
    Mn = mat_pow(M, n - (k - 1))
    state = [[init[k - 1 - i]] for i in range(k)]  # (f(k-1), ..., f(0))ᵀ
    return mul(Mn, state)[0][0] % MOD


if __name__ == "__main__":
    print(nth_term([1, 1], [0, 1], 10))        # Fibonacci: 55
    print(nth_term([1, 1, 1], [0, 1, 1], 10))  # Tribonacci
```

### Augmented matrix for a recurrence with a constant

```python
MOD = 10**9 + 7


def with_constant(a_coeff, b_const, f0, n):
    """f(n) = a_coeff * f(n-1) + b_const, f(0) = f0. Returns f(n) mod p."""
    # state (f(n), 1)ᵀ ; M = [[a, b],[0, 1]]
    M = [[a_coeff % MOD, b_const % MOD], [0, 1]]
    Mn = mat_pow(M, n)
    state = [[f0 % MOD], [1]]
    return mul(Mn, state)[0][0] % MOD


# a(n) = 3 a(n-1) + 2, a(0) = 0  ->  a(1)=2, a(2)=8, a(3)=26
if __name__ == "__main__":
    print(with_constant(3, 2, 0, 1))  # 2
    print(with_constant(3, 2, 0, 3))  # 26
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Forgot mod | 64-bit overflow → garbage. | Reduce after every accumulation in `mul`. |
| Wrong matrix for `+constant` | Used the homogeneous `k×k` matrix; the constant vanishes. | Augment: add a self-looping `1` row and put the constant in the top row. |
| Wrong exponent | Used `M^n` when the offset should be `n-(k-1)`. | Tie the exponent to your state-vector layout; verify on small `n`. |
| State vector reversed | Read a shifted answer. | `state_0 = (f(k-1), …, f(0))ᵀ`, newest on top. |
| `n < k` not handled | Built a matrix when the answer is a given initial value. | Return `init[n]` directly when `n < k`. |
| Non-square or mismatched dims | Multiply produces wrong shape. | Companion is `k×k`; augmented is `(k+1)×(k+1)` or larger — assert dimensions. |

---

## Performance Analysis

| Order `k` | One multiply `O(k³)` | `M^n` for `n = 10^18` (`~60` multiplies) |
|-----------|----------------------|-------------------------------------------|
| 2 (Fibonacci) | 8 ops | ~480 ops — instant |
| 10 | 1 000 ops | ~120 000 ops — instant |
| 50 | 125 000 ops | ~15 M ops — well under a second |
| 100 | 1 M ops | ~120 M ops — under a second |
| 300 | 27 M ops | ~3 G ops — a few seconds; consider Kitamasa |

The dominant cost is `k³` per multiply; `log n ≈ 60` multiplies even for `n = 10^18`. The technique is excellent for `k ≤ ~100`. Beyond that the `k³` factor hurts, and the `O(k² log n)` Kitamasa method (working with the characteristic polynomial instead of the full matrix) becomes the better choice.

```python
import time


def benchmark(k, n):
    coeffs = [1] * k
    init = list(range(k))
    start = time.perf_counter()
    nth_term(coeffs, init, n)
    return time.perf_counter() - start


# Typical: k=50, n=10**18 -> well under 1s with the zero-skip optimization.
```

The single biggest constant-factor win is the `if a[i][t] == 0: continue` skip — companion matrices are mostly zeros (only the top row plus the sub-diagonal are nonzero), so the skip turns a dense `k³` into something much closer to `k²` for the *base* matrix's early powers.

---

## Best Practices

- **Pick `n`-aware:** small `n` → naive loop (`O(kn)`); large `n` → matrix exponentiation; large `n` *and* large `k` → Kitamasa.
- **Build the matrix from the recipe**, not from memory: top row = coefficients, sub-diagonal = identity shift.
- **Augment for non-homogeneous parts:** constants get a self-looping `1`; prefix sums get an accumulator row.
- **Always test against the naive loop** on small `n` before trusting the matrix on huge `n`.
- **Reduce mod consistently** in the counting semiring; never inline the modulus as a magic number.
- **Special-case `n < k`** to return the given initial value directly.

---

## Frequently Asked Questions

**Q: How do I get the initial state vector right? I keep getting answers off by one position.**
The state is `(f(n), f(n-1), …, f(n-k+1))ᵀ` with the *newest* term on top. So `state_0` (the state at index `k-1`, the last index whose value you are given) is `(f(k-1), f(k-2), …, f(0))ᵀ` — the initial values *reversed*. Then `state_n = M^{n-(k-1)} · state_0`. The two off-by-one traps are this reversal and the exponent offset `n-(k-1)`; verify both against a small naive loop.

**Q: My recurrence has zero coefficients in the middle, e.g. `f(n) = f(n-1) + f(n-3)`. Does the companion matrix still apply?**
Yes. The order is the *largest* lag, here `k = 3`, and the missing `f(n-2)` term just gets coefficient `0`. The top row is `(1, 0, 1)`. The sub-diagonal of `1`s is unchanged. Nothing special is needed — zero coefficients are ordinary.

**Q: When exactly should I augment versus build a plain companion matrix?**
Augment whenever the recurrence is *not* a pure linear combination of past terms. The two common cases: an **added constant** (`+ b`) needs a self-looping `1` component, and a **running prefix sum** needs an accumulator component. If the recurrence is purely homogeneous (`f(n) = Σ c_i f(n-i)` with nothing extra), the plain `k × k` companion matrix is enough.

**Q: Is matrix exponentiation ever the *wrong* choice even though `n` is huge?**
Yes — if the recurrence order `d` is large (hundreds) and you need only one term, the `d³` per multiply dominates and Kitamasa's `O(d² log n)` wins. And if the answer is wanted exactly (not mod `p`) the term has `Θ(n)` digits and the `O(1)`-per-op assumption collapses. See the comparison table and `senior.md`.

**Q: Why does the same matrix `[[1,1],[1,0]]` solve both Fibonacci and the `2×n` domino tiling?**
Because both satisfy the *same* recurrence `g(n) = g(n-1) + g(n-2)` — only the initial values differ. The matrix encodes the recurrence's *shape*; the initial state vector encodes the specific problem. This is why one solver handles a whole family of problems.

**Q: Can the coefficients or initial values be negative?**
Yes, but reduce them into `[0, p)` first (`((x % p) + p) % p`), because `%` returns negative results for negative operands in Go and Java. Fibonacci never triggers this, but recurrences like `f(n) = 3f(n-1) − 2f(n-2)` do. See `senior.md` for the full normalization discussion.

**Q: How do I sanity-check that I built `M` correctly before powering it?**
Multiply `M` by the initial state vector once *by hand* and confirm it produces the next term: `M · state_0` should equal `state_1 = (f(k), f(k-1), …, f(1))ᵀ`. If that single step is right, the matrix is right, and any later error is in the power loop or the read-off entry rather than in `M` itself.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The squaring ladder `M → M² → M⁴ → M⁸` and how the binary digits of `n` select which powers to multiply in.
> - The transition (companion) matrix and the running `result` accumulator side by side.
> - The resulting matrix entry read off as the recurrence term `f(n)`.

---

## Summary

The companion matrix turns any constant-coefficient linear recurrence into a matrix power: the **top row holds the coefficients**, the **sub-diagonal is an identity shift**, and `state_n = M^{n-(k-1)} · state_0` gives the `n`-th term in `O(k³ log n)`. Recurrences with an **added constant** or a **running prefix sum** are handled by *augmenting* the matrix — adding an extra state component (a self-looping `1` for constants, an accumulator row for sums) and a matching row/column. Everything runs **modulo a prime** to avoid overflow. Compared to a naive `O(kn)` loop, matrix exponentiation wins for large `n`; compared to it, the `O(k² log n)` Kitamasa method wins for large order `k`. Master the recipe and the augmentation trick, and you can evaluate any linear recurrence at an astronomically large index. The graph cousin — `(A^k)[i][j]` counting walks of length `k` — is `11-graphs/32-paths-fixed-length`.
