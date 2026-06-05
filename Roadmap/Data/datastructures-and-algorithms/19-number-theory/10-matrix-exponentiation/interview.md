# Matrix Exponentiation for Linear Recurrences — Interview Preparation

Matrix exponentiation for recurrences is a favourite interview topic because it rewards a single crisp insight — *"a linear recurrence is `state_n = M · state_{n-1}`, so `state_n = M^n · state_0`, computed in `O(k³ log n)` by binary exponentiation"* — and then tests whether you can (a) **build the companion matrix** from an arbitrary recurrence, (b) keep it correct with **modular arithmetic**, (c) **augment** the matrix for an added constant or a prefix sum, and (d) know when to reach for **Kitamasa** instead. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| `n`-th Fibonacci term mod `p` | `2×2` matrix `[[1,1],[1,0]]` power | `O(log n)` |
| `n`-th term, order-`k` recurrence | companion matrix power | `O(k³ log n)` |
| Recurrence with added constant `+b` | augmented `(k+1)×(k+1)` matrix | `O(k³ log n)` |
| Running prefix sum of terms | augmented matrix with sum row | `O(k³ log n)` |
| Count tilings / restricted strings | recurrence → matrix power | `O(k³ log n)` |
| Single term, large order `k` | Kitamasa (Cayley-Hamilton) | `O(k² log n)` |
| Exact non-modular huge term | CRT across primes | `O(k³ log n · #primes)` |
| Walks of length `k` in a graph | adjacency-matrix power (sibling topic) | `O(V³ log k)` |

The companion matrix template (top row = coefficients, sub-diagonal = identity shift):

```text
M = [ c_1  c_2  …  c_k ]      state_0 = ( f(k-1), …, f(0) )ᵀ
    [  1    0   …   0  ]
    [  0    1   …   0  ]      f(n) = ( M^{n-(k-1)} · state_0 )[0]
    [        ⋱          ]
    [  0    0   1   0  ]
```

Core algorithm:

```text
matPow(M, n):
    R = I            # identity = M^0
    while n > 0:
        if n & 1:  R = R · M
        M = M · M
        n >>= 1
    return R         # O(k^3 log n); reduce mod p everywhere
```

Key facts:
- **`M^0 = I`**; **`M^1 = M`**.
- The matrix is `k × k` where `k` is the recurrence **order**, not anything larger.
- Terms overflow fast → take entries **mod p**.
- Top row = coefficients; sub-diagonal of `1`s = the shift.
- A `+constant` or prefix sum needs an **augmented** (larger) matrix.

---

## Junior Questions (12 Q&A)

### J1. How do you express a linear recurrence as a matrix?
Stack the last `k` terms into a state vector `(f(n), …, f(n-k+1))ᵀ`. The transition matrix `M` is the unique matrix with `M · state_{n-1} = state_n`. Its top row is the coefficient list, and its sub-diagonal is `1`s (a shift). Then `state_n = M^n · state_0`.

### J2. What is the transition matrix for Fibonacci?
`M = [[1,1],[1,0]]`. The top row `(1,1)` is the recurrence `F_n = F_{n-1}+F_{n-2}`; the bottom row `(1,0)` copies `F_{n-1}` down so the window slides. Then `(F_{n+1},F_n)ᵀ = M (F_n,F_{n-1})ᵀ`.

### J3. What is `M^0`?
The identity matrix `I`. Applying the transition zero times leaves the state unchanged, and `I·v = v`. It is also the starting accumulator for binary exponentiation.

### J4. How do you compute `M^n` fast?
Binary exponentiation: repeatedly square `M` to get `M^1, M^2, M^4, …` and multiply together the powers whose bit is set in `n`. That is `O(log n)` matrix multiplies, each `O(k³)`, so `O(k³ log n)` total.

### J5. Why take entries modulo a prime?
Recurrence terms grow exponentially and overflow 64-bit integers fast (Fibonacci overflows by index ~90). Problems ask for the answer mod a prime like `10^9 + 7`; reduce after every `+` and `*` inside the matrix multiply.

### J6. What is the complexity, and what dominates?
`O(k³ log n)`. The `k³` per matrix multiply dominates; `log n` is at most ~60 even for `n = 10^18`. For Fibonacci (`k = 2`) it is just `O(log n)`.

### J7. What does the "order" of a recurrence mean?
The number of previous terms it depends on. Fibonacci is order 2; tribonacci `T_n = T_{n-1}+T_{n-2}+T_{n-3}` is order 3. The matrix is `k × k` where `k` is the order.

### J8. Where does `F_n` sit in `M^n`?
With `M = [[1,1],[1,0]]`, the identity `M^n = [[F_{n+1}, F_n],[F_n, F_{n-1}]]` holds, so `F_n` is at entry `[0][1]`. Equivalently, multiply `M^n` by `(F_1,F_0)ᵀ` and read the top entry.

### J9. Why is binary exponentiation `O(log n)` and not `O(n)`?
Each squaring doubles the exponent, so reaching `M^n` needs only `⌊log₂ n⌋` squarings plus at most `log₂ n` extra multiplies for the set bits. Multiplying `M` by itself `n` times would be `O(n)` — exponentially worse.

### J10. What is the identity matrix and why does it matter?
`I[i][j] = 1` if `i == j`, else `0`. It is the multiplicative identity (`M·I = M`), it equals `M^0`, and it is the correct starting value in the power loop. Returning `M` for `n = 0` is a common bug.

### J11. When is matrix exponentiation overkill?
When `n` is small. A plain `O(k·n)` loop is simpler and fast enough for `n` up to about `10^6`. Matrix exponentiation wins only when `n` is large enough that `log n ≪ n`.

### J12 (analysis). Why does the same matrix solve tilings of a 2×n board?
The number of domino tilings satisfies `D(n) = D(n-1) + D(n-2)` — the same recurrence as Fibonacci. Many counting problems collapse to a linear recurrence, and then the same companion-matrix power evaluates them at huge `n`.

---

## Middle Questions (12 Q&A)

### M1. Prove that powering the companion matrix gives `f(n)`.
By construction `M · state_{n-1} = state_n` (the top row is the recurrence, the sub-diagonal shifts). By induction `state_n = M^{n-(k-1)} · state_{k-1}`, so `f(n)` is the top entry. Each multiply advances the recurrence one step.

### M2. How do you build the companion matrix for a general order-`k` recurrence?
Top row = the coefficients `(c_1,…,c_k)`. Sub-diagonal: `M[i][i-1] = 1` for `i = 1..k-1`. Everything else `0`. The initial state is `(f(k-1),…,f(0))ᵀ` — newest term on top.

### M3. How do you handle a recurrence with an added constant, like `f(n) = 2f(n-1) + 5`?
Augment the matrix: carry an extra state component pinned to `1`. State `(f(n),1)ᵀ`, matrix `[[2,5],[0,1]]`. The bottom row keeps the constant slot `=1`; the `5` injects `5·1` each step. The matrix grows by one dimension.

### M4. How do you also track a running prefix sum `S(n) = Σ f(m)`?
Add a state component for the sum. For order-2 `f`, state `(S(n),f(n),f(n-1))ᵀ` with the top row `(1, c_1, c_2)` carrying the old sum forward and adding the new term. Powering the `3×3` matrix gives both `f(n)` and `S(n)`.

### M5. Why is the sub-diagonal made of `1`s?
Because every state component except the top is just an old component copied down one slot — that "shift" is exactly an identity placed below the diagonal. The top row does the linear combination; the sub-diagonal does the bookkeeping.

### M6. When does layered/naive DP beat matrix exponentiation?
When `n` is small. A loop is `O(k·n)` with no `k³` per step, so for `n ≤ ~10^6` it is simpler and often faster. Matrix exponentiation is for large `n`.

### M7. How do you avoid overflow in the modular power?
Reduce mod `p` after every accumulation. In Go/Java cast operands to 64-bit before multiplying so `a*b` does not overflow `int` before the `% MOD`. If coefficients can be negative, normalize with `((x%p)+p)%p`.

### M8. What is the characteristic polynomial of the companion matrix?
`χ_M(x) = x^k - c_1 x^{k-1} - … - c_k`, exactly the recurrence's auxiliary equation. Its roots are the characteristic roots that control growth — for Fibonacci, `x²-x-1` with root the golden ratio `φ`.

### M9. How does Kitamasa relate to the matrix power?
Both are `O(log n)` iterations. Kitamasa works with the characteristic polynomial (a degree-`<k` "pointer") instead of the full `k²`-entry matrix, costing `O(k²)` per step versus `O(k³)`. For a single term at large order it wins; below `k ≈ 64` the matrix is simpler.

### M10. Count length-`k` binary strings with no two consecutive 1s — how?
Let `a(k)` be the count; it satisfies `a(k) = a(k-1) + a(k-2)` (append `0`, or `01`), Fibonacci-shaped. Build the `2×2` matrix and power it — `O(log k)`. This is automaton/transfer-matrix counting via a recurrence.

### M11. Why can't matrix exponentiation handle a non-linear recurrence?
The state advance must be a *fixed linear map* for `state_n = M·state_{n-1}` to hold. A recurrence like `f(n) = f(n-1)²` is not linear, so no constant matrix advances it; matrix power does not apply.

### M12 (analysis). What is the growth rate of the terms?
Governed by the dominant characteristic root `λ_max`: `f(n) ≈ C·λ_max^n`. For Fibonacci `λ_max = φ ≈ 1.618`. If `|λ_max| > 1` the terms explode, which is why a modulus is needed.

---

## Senior Questions (10 Q&A)

### S1. How would you compute `f(10^18) mod p` exactly?
Build the companion matrix, run binary exponentiation (~60 multiplies), reduce mod `p` throughout: `O(k³ log n)`. If the true non-modular value is needed and exceeds one prime, run under several coprime primes and reconstruct via CRT. Big-integer arithmetic would lose the `log n` advantage because the term has `Θ(n)` digits.

### S2. When would you use Kitamasa instead of matrix exponentiation?
For a *single* term of a *large-order* recurrence (order in the hundreds). Kitamasa computes `x^n mod χ(x)` by polynomial exponentiation (Cayley-Hamilton), `O(k² log n)` schoolbook or `O(k log k log n)` with NTT, beating the matrix's `O(k³ log n)` by a factor of `k`.

### S3. How do you optimize the common `2×2`/`3×3` cases?
Hard-unroll the multiply into explicit scalar expressions on fixed-size stack arrays — no loops, no bounds checks, no heap allocation. A hand-unrolled `2×2` modular multiply is several times faster than the generic triple loop when `fib(n) mod p` runs in a hot loop.

### S4. How do you handle many `n` queries on one recurrence?
Precompute the squaring ladder `M^{2^0}, …, M^{2^{60}}` once (`O(k³·60)`), store it read-only, and per query push the initial state vector through the ladder entries whose bits are set in `n` — `O(k²·popcount(n))` per query instead of a fresh full power.

### S5. Why must you avoid floating-point for exact terms?
Closed forms (Binet's `F_n = (φ^n-ψ^n)/√5`) involve irrational characteristic roots. `double` loses precision well before `n = 80`, and you cannot reduce an irrational mod `p`. Floats are only for asymptotics / CRT prime budgeting; exact terms require integer matrices mod a prime.

### S6. Can fast matrix multiplication (Strassen) help?
Yes for the full matrix at large order — the recurrence semiring is a ring (it has subtraction), so Strassen/`ω`-algorithms give `O(k^ω log n)`. But for a *single term* Kitamasa's `O(k² log n)` already beats any `k^ω` (since `ω > 2`), and is simpler. Strassen matters only when you need the whole `M^n` at large `k`.

### S7. How do you verify correctness when `n` is too large to loop?
Keep a naive `O(n)` loop oracle for small `n` and diff. Add property tests: `M^0 == I`, `M^a·M^b == M^{a+b}`, residues stay in `[0,p)`, and a geometric-growth sanity check (`f(n) ≈ λ_max^n`). Spot-check known values (`F_10 = 55`, `F_20 = 6765`).

### S8. How does augmentation prove correct for a constant term?
The augmented state pins an extra component to `1` via a self-loop row `(0,…,0,1)`. The top row's new entry `b` then contributes `b·1 = b` each step, reproducing `f(n) = …+ b`. The augmented matrix's characteristic polynomial gains the factor `(x-1)`, the constant particular solution's root.

### S9. What goes wrong with negative coefficients?
Products can be negative, and `%` is negative in Go/Java for negative operands, poisoning later steps. Normalize with `((x%p)+p)%p` after every signed operation. Fibonacci never hits this; recurrences derived from characteristic polynomials often do.

### S10 (analysis). How many CRT primes do you need for an exact term?
The term has about `n·log₂(λ_max)` bits. Divide by the bit-width of each prime (~30 for a 32-bit prime) and add one. For Fibonacci, `F_n` has ~`0.694n` bits, so ~`0.694n/30 + 1` primes — each an independent, parallelizable matrix-exponentiation job.

---

## Professional Questions (8 Q&A)

### P1. Design a service answering "`n`-th term of a fixed recurrence" for arbitrary `n`.
If the order `k` is small, each query is one `O(k³ log n)` power. For many queries, cache the squaring ladder of `M` once (`O(k³·60)`) and push the state vector through it per query (`O(k²·popcount(n))`). Take everything mod the required prime; shard across CRT primes if exact values are needed. Share the ladder read-only across workers.

### P2. The answer must be exact, not modular. How?
The exact term has `Θ(n·log λ_max)` digits, so big-integer matrix multiply costs grow with `n` and erode the `log n` advantage. Run independent modular powers under enough coprime primes to cover the value's range (estimated from `λ_max`), then CRT-reconstruct. The per-prime jobs are embarrassingly parallel.

### P3. The recurrence has order 500. The `k³ log n` is too slow. What do you do?
Switch to Kitamasa: `O(k² log n)` (or `O(k log k log n)` with NTT on an NTT-friendly prime like `998244353`). It computes one term via polynomial exponentiation mod the characteristic polynomial — a factor of `k` cheaper, justified by Cayley-Hamilton. If zero coefficients make the order effectively smaller, minimize first.

### P4. How do you debug "the `n`-th term is wrong" in production?
Run the naive loop oracle on the same small `n` and diff. Check the usual suspects: wrong `M^0` (must be `I`), reversed state vector, off-by-one in the exponent (`M^{n-(k-1)}` vs `M^n`), missing modulus, and un-normalized negative residues. A geometric-growth assertion catches structural matrix errors.

### P5. When is augmentation the wrong tool?
When the forcing term is *not* itself linearly recurrent (e.g. `f(n) = f(n-1) + n!` — factorial is not C-finite), augmentation cannot fold it in, because only sequences obeying a constant-coefficient recurrence can be embedded as extra state. Such forcing terms need a different approach entirely.

### P6. How do you parallelize a huge batch of term queries?
Precompute the binary-power ladder of `M` once. Each query reduces to multiplying the cached powers (or pushing a state vector through them) whose bits are set in `n` — independent work, distribute across workers. Across CRT primes, each prime is an independent job. The matrix multiply itself parallelizes across output rows at large `k`.

### P7. How do automata / restricted-string counts connect to this?
Counting length-`n` strings under a regular constraint (e.g. avoiding a substring) gives a linear recurrence whose order is the automaton's state count; the companion matrix is the automaton's transfer matrix. This is the same machinery as walk-counting in `11-graphs/32-paths-fixed-length`, viewed through the recurrence lens.

### P8 (analysis). Why does the spectral (eigenvalue) formula fail for exact terms?
`f(n) = Σ_r α_r λ_r^n`, but the `λ_r` of an integer companion matrix are generally irrational algebraic numbers. Floating-point evaluation gives an approximation, not an exact integer, and reducing an irrational mod `p` is meaningless. The spectral form is for asymptotics; exactness demands integer matrix exponentiation mod a prime.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about replacing an `O(n)` recurrence loop with a logarithmic one.
Look for a concrete story: a counting or recurrence task where `n` was large, a profile showing the linear loop dominating, the insight that the advance was a fixed linear map (hence a matrix power), and the measured speedup. Strong answers cite the correctness check against the old slow loop and the modulus/overflow care taken.

### B2. A teammate used Binet's formula in `double` and shipped wrong large Fibonacci values. How do you handle it?
Explain calmly that `φ` is irrational and `double` loses precision past `n ≈ 80`, so the closed form is only for asymptotics. The fix is integer matrix exponentiation (or fast doubling) mod `p`. Frame it as a teaching moment about exact-vs-approximate arithmetic, with a quick demonstration of the divergence.

### B3. Design a feature predicting a metric that follows a linear recurrence far into the future.
Identify the recurrence order and coefficients from the model, build the companion matrix, and evaluate at the target horizon `n` via matrix power. Discuss whether a constant/seasonal forcing term needs augmentation, whether the answer should be modular or exact, and the overflow/precision trade-offs. Mention validating against a short simulated loop.

### B4. How would you explain matrix exponentiation for recurrences to a junior?
Start from Fibonacci: "knowing the last two numbers is enough to get the next, and that step is a fixed multiplication — a `2×2` matrix." Then show binary exponentiation as "prebuild 8-step and 4-step jumps and snap them together." Lead with the two gotchas: `M^0 = I`, and take it mod `p`.

### B5. Your recurrence-evaluation job uses too much memory at scale. How do you investigate?
Check whether the matrix order `k` ballooned (un-minimized augmentation, redundant states); each `k×k int64` matrix is `8k²` bytes. Confirm you ping-pong two scratch matrices rather than allocating per multiply (GC churn). For batched queries, verify the cached ladder is shared, not duplicated per request. Profile allocations; the fix is usually order minimization plus buffer reuse.

---

## Coding Challenges

### Challenge 1: Fibonacci mod p in O(log n)

**Problem.** Given `n` (up to `10^18`), return `F(n) mod 10^9 + 7` using the `2×2` companion matrix, where `F(0)=0, F(1)=1`.

**Example.** `n = 10 → 55`; `n = 0 → 0`; `n = 1 → 1`.

**Constraints.** `0 ≤ n ≤ 10^18`.

**Optimal.** `2×2` matrix exponentiation, `O(log n)`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func mul2(a, b [2][2]int64) [2][2]int64 {
	var c [2][2]int64
	for i := 0; i < 2; i++ {
		for j := 0; j < 2; j++ {
			for t := 0; t < 2; t++ {
				c[i][j] = (c[i][j] + a[i][t]*b[t][j]) % MOD
			}
		}
	}
	return c
}

func fib(n int64) int64 {
	result := [2][2]int64{{1, 0}, {0, 1}}
	base := [2][2]int64{{1, 1}, {1, 0}}
	for n > 0 {
		if n&1 == 1 {
			result = mul2(result, base)
		}
		base = mul2(base, base)
		n >>= 1
	}
	return result[0][1]
}

func main() {
	fmt.Println(fib(10))                 // 55
	fmt.Println(fib(1_000_000_000_000))  // instant
}
```

**Java.**
```java
public class FibModP {
    static final long MOD = 1_000_000_007L;

    static long[][] mul(long[][] a, long[][] b) {
        long[][] c = new long[2][2];
        for (int i = 0; i < 2; i++)
            for (int j = 0; j < 2; j++)
                for (int t = 0; t < 2; t++)
                    c[i][j] = (c[i][j] + a[i][t] * b[t][j]) % MOD;
        return c;
    }

    static long fib(long n) {
        long[][] r = {{1, 0}, {0, 1}};
        long[][] b = {{1, 1}, {1, 0}};
        while (n > 0) {
            if ((n & 1) == 1) r = mul(r, b);
            b = mul(b, b);
            n >>= 1;
        }
        return r[0][1];
    }

    public static void main(String[] args) {
        System.out.println(fib(10));               // 55
        System.out.println(fib(1_000_000_000_000L)); // instant
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def mul(a, b):
    return [[sum(a[i][t] * b[t][j] for t in range(2)) % MOD
             for j in range(2)] for i in range(2)]


def fib(n):
    r = [[1, 0], [0, 1]]
    b = [[1, 1], [1, 0]]
    while n > 0:
        if n & 1:
            r = mul(r, b)
        b = mul(b, b)
        n >>= 1
    return r[0][1]


if __name__ == "__main__":
    print(fib(10))                  # 55
    print(fib(1_000_000_000_000))   # instant
```

---

### Challenge 2: N-th Term of a General Linear Recurrence

**Problem.** Given `f(n) = c_1 f(n-1) + … + c_k f(n-k)` with initial values `f(0..k-1)`, compute `f(n) mod 10^9 + 7` for huge `n`.

**Approach.** Build the `k × k` companion matrix (top row coefficients, sub-diagonal `1`s), power it, apply to the reversed initial vector. `O(k³ log n)`.

**Go.**
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
		r[i][i] = 1
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
		M[0][j] = ((coeffs[j] % MOD) + MOD) % MOD
	}
	for i := 1; i < k; i++ {
		M[i][i-1] = 1
	}
	Mn := matPow(M, n-int64(k-1))
	state := make([][]int64, k)
	for i := 0; i < k; i++ {
		state[i] = []int64{init[k-1-i] % MOD}
	}
	return mul(Mn, state)[0][0] % MOD
}

func main() {
	fmt.Println(nthTerm([]int64{1, 1}, []int64{0, 1}, 10))       // 55
	fmt.Println(nthTerm([]int64{1, 1, 1}, []int64{0, 1, 1}, 10)) // tribonacci
}
```

**Java.**
```java
public class NthTerm {
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
        for (int j = 0; j < k; j++) M[0][j] = ((coeffs[j] % MOD) + MOD) % MOD;
        for (int i = 1; i < k; i++) M[i][i - 1] = 1;
        long[][] Mn = matPow(M, n - (k - 1));
        long[][] state = new long[k][1];
        for (int i = 0; i < k; i++) state[i][0] = init[k - 1 - i] % MOD;
        return mul(Mn, state)[0][0] % MOD;
    }

    public static void main(String[] args) {
        System.out.println(nthTerm(new long[]{1, 1}, new long[]{0, 1}, 10));       // 55
        System.out.println(nthTerm(new long[]{1, 1, 1}, new long[]{0, 1, 1}, 10)); // tribonacci
    }
}
```

**Python.**
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
    M[0] = [c % MOD for c in coeffs]
    for i in range(1, k):
        M[i][i - 1] = 1
    Mn = mat_pow(M, n - (k - 1))
    state = [[init[k - 1 - i] % MOD] for i in range(k)]
    return mul(Mn, state)[0][0] % MOD


if __name__ == "__main__":
    print(nth_term([1, 1], [0, 1], 10))        # 55
    print(nth_term([1, 1, 1], [0, 1, 1], 10))  # tribonacci
```

---

### Challenge 3: Count Tilings / Restricted Strings via Matrix Power

**Problem.** Count binary strings of length `n` with no two consecutive `1`s, mod `10^9 + 7`. (Equivalently: tilings of a `1×n` strip; the count is `F(n+2)`.)

**Approach.** The count satisfies `a(n) = a(n-1) + a(n-2)` with `a(1)=2, a(2)=3`. Use the `2×2` Fibonacci-shaped matrix; transfer-matrix counting.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func mul2(a, b [2][2]int64) [2][2]int64 {
	var c [2][2]int64
	for i := 0; i < 2; i++ {
		for j := 0; j < 2; j++ {
			for t := 0; t < 2; t++ {
				c[i][j] = (c[i][j] + a[i][t]*b[t][j]) % MOD
			}
		}
	}
	return c
}

func countNo11(n int64) int64 {
	// transfer matrix on states (last char 0, last char 1)
	// answer = F(n+2). Use the Fibonacci matrix.
	if n == 0 {
		return 1
	}
	result := [2][2]int64{{1, 0}, {0, 1}}
	base := [2][2]int64{{1, 1}, {1, 0}}
	e := n + 2
	for e > 0 {
		if e&1 == 1 {
			result = mul2(result, base)
		}
		base = mul2(base, base)
		e >>= 1
	}
	return result[0][1] // F(n+2)
}

func main() {
	fmt.Println(countNo11(1)) // 2
	fmt.Println(countNo11(2)) // 3
	fmt.Println(countNo11(3)) // 5
}
```

**Java.**
```java
public class CountNo11 {
    static final long MOD = 1_000_000_007L;

    static long[][] mul(long[][] a, long[][] b) {
        long[][] c = new long[2][2];
        for (int i = 0; i < 2; i++)
            for (int j = 0; j < 2; j++)
                for (int t = 0; t < 2; t++)
                    c[i][j] = (c[i][j] + a[i][t] * b[t][j]) % MOD;
        return c;
    }

    static long countNo11(long n) {
        if (n == 0) return 1;
        long[][] r = {{1, 0}, {0, 1}};
        long[][] b = {{1, 1}, {1, 0}};
        long e = n + 2;
        while (e > 0) {
            if ((e & 1) == 1) r = mul(r, b);
            b = mul(b, b);
            e >>= 1;
        }
        return r[0][1]; // F(n+2)
    }

    public static void main(String[] args) {
        System.out.println(countNo11(1)); // 2
        System.out.println(countNo11(2)); // 3
        System.out.println(countNo11(3)); // 5
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def mul(a, b):
    return [[sum(a[i][t] * b[t][j] for t in range(2)) % MOD
             for j in range(2)] for i in range(2)]


def count_no_11(n):
    if n == 0:
        return 1
    r = [[1, 0], [0, 1]]
    b = [[1, 1], [1, 0]]
    e = n + 2
    while e > 0:
        if e & 1:
            r = mul(r, b)
        b = mul(b, b)
        e >>= 1
    return r[0][1]  # F(n+2)


if __name__ == "__main__":
    print(count_no_11(1))  # 2
    print(count_no_11(2))  # 3
    print(count_no_11(3))  # 5
```

---

### Challenge 4: Recurrence with an Added Constant

**Problem.** Given `f(n) = a·f(n-1) + b` with `f(0)` provided, compute `f(n) mod 10^9 + 7` for huge `n`. Use an augmented matrix.

**Approach.** State `(f(n), 1)ᵀ`, matrix `[[a, b],[0, 1]]`. Power it, apply to `(f(0), 1)ᵀ`, read the top entry. `O(log n)`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func mul2(a, b [2][2]int64) [2][2]int64 {
	var c [2][2]int64
	for i := 0; i < 2; i++ {
		for j := 0; j < 2; j++ {
			for t := 0; t < 2; t++ {
				c[i][j] = (c[i][j] + a[i][t]*b[t][j]) % MOD
			}
		}
	}
	return c
}

func affine(a, b, f0, n int64) int64 {
	result := [2][2]int64{{1, 0}, {0, 1}}
	base := [2][2]int64{{a % MOD, b % MOD}, {0, 1}}
	for n > 0 {
		if n&1 == 1 {
			result = mul2(result, base)
		}
		base = mul2(base, base)
		n >>= 1
	}
	// (f(n),1) = M^n (f0,1) -> f(n) = M[0][0]*f0 + M[0][1]*1
	return (result[0][0]*(f0%MOD) + result[0][1]) % MOD
}

func main() {
	// f(n) = 3 f(n-1) + 2, f(0) = 0 -> 0,2,8,26,...
	fmt.Println(affine(3, 2, 0, 1)) // 2
	fmt.Println(affine(3, 2, 0, 3)) // 26
}
```

**Java.**
```java
public class Affine {
    static final long MOD = 1_000_000_007L;

    static long[][] mul(long[][] a, long[][] b) {
        long[][] c = new long[2][2];
        for (int i = 0; i < 2; i++)
            for (int j = 0; j < 2; j++)
                for (int t = 0; t < 2; t++)
                    c[i][j] = (c[i][j] + a[i][t] * b[t][j]) % MOD;
        return c;
    }

    static long affine(long a, long b, long f0, long n) {
        long[][] r = {{1, 0}, {0, 1}};
        long[][] base = {{a % MOD, b % MOD}, {0, 1}};
        while (n > 0) {
            if ((n & 1) == 1) r = mul(r, base);
            base = mul(base, base);
            n >>= 1;
        }
        return (r[0][0] * (f0 % MOD) + r[0][1]) % MOD;
    }

    public static void main(String[] args) {
        System.out.println(affine(3, 2, 0, 1)); // 2
        System.out.println(affine(3, 2, 0, 3)); // 26
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def mul(a, b):
    return [[sum(a[i][t] * b[t][j] for t in range(2)) % MOD
             for j in range(2)] for i in range(2)]


def affine(a, b, f0, n):
    r = [[1, 0], [0, 1]]
    base = [[a % MOD, b % MOD], [0, 1]]
    while n > 0:
        if n & 1:
            r = mul(r, base)
        base = mul(base, base)
        n >>= 1
    return (r[0][0] * (f0 % MOD) + r[0][1]) % MOD


if __name__ == "__main__":
    # f(n) = 3 f(n-1) + 2, f(0) = 0 -> 0, 2, 8, 26, ...
    print(affine(3, 2, 0, 1))  # 2
    print(affine(3, 2, 0, 3))  # 26
```

---

## Final Tips

- Lead with the one-liner: *"A linear recurrence is `state_n = M·state_{n-1}`; compute `M^n` by binary exponentiation in `O(k³ log n)`."*
- Immediately flag the two gotchas: **`M^0 = I`** and **take it mod `p`**.
- Build the companion matrix from the recipe: **top row = coefficients, sub-diagonal = identity shift**.
- For a `+constant` or prefix sum, reach for the **augmentation** trick (extra state component, larger matrix).
- For a single term at large order, mention **Kitamasa** (`O(k² log n)`) as the optimization beyond the plain matrix power.
- Never use **floating-point / Binet** for an exact term — irrational roots break it.
- Always offer to verify against a brute-force `O(n)` loop on small inputs. The graph cousin is `11-graphs/32-paths-fixed-length`.
