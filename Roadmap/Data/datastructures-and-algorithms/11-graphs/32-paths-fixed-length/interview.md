# Paths of Fixed Length (Matrix Exponentiation on Graphs) — Interview Preparation

Fixed-length path counting is a favourite interview topic because it rewards a single crisp insight — *"`(A^k)[i][j]` counts walks of length `k`"* — and then tests whether you can (a) make it fast with binary exponentiation, (b) keep it correct with modular arithmetic, (c) recognize the same skeleton behind shortest-exact-`k` paths, knight moves, and linear recurrences, and (d) avoid the classic trap of confusing walks with simple paths. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Walks of length exactly `k`, `i → j` | `(A^k)[i][j]`, counting semiring | `O(V³ log k)` |
| Walks of length `≤ k` | augmented matrix, then one power | `O(V³ log k)` |
| Shortest walk of exactly `k` edges | min-plus `(min, +)` power | `O(V³ log k)` |
| Longest walk of exactly `k` edges | max-plus `(max, +)` power | `O(V³ log k)` |
| Reachable in exactly `k` steps? | Boolean `(OR, AND)` power | `O(V³ log k)` |
| `n`-th term of order-`r` linear recurrence | companion matrix power (or Kitamasa) | `O(r³ log n)` (or `O(r² log n)`) |
| Markov distribution after `k` steps | real `(+, ×)` power of `P` | `O(V³ log k)` |
| **Count *simple* paths of length `k`** | **#P-hard — no fast method** | — |

Semiring table (the multiply changes; the power skeleton does not):

```text
semiring     add    mul    zero(0̄)   one(1̄)     A^k means
counting     +      ×      0         1           # length-k walks (mod p)
min-plus     min    +      +∞        0           shortest exact-k walk
max-plus     max    +      −∞        0           longest exact-k walk
boolean      OR     AND    false     true        reachable in exactly k steps
```

Core algorithm:

```text
matPow(A, k):
    R = I            # identity of the chosen semiring
    while k > 0:
        if k & 1:  R = R · A
        A = A · A
        k >>= 1
    return R         # O(V^3 log k); reduce mod p in the counting semiring
```

Key facts:
- **Length = number of edges** (`k` edges, `k+1` vertices).
- `A^0 = I`; `A^1 = A`.
- Counts overflow fast → take entries **mod p**.
- Diagonal `(A^k)[i][i]` = closed walks of length `k`; trace = all closed walks.

---

## Junior Questions (12 Q&A)

### J1. What does `(A^k)[i][j]` represent?
The number of **walks** of length exactly `k` from vertex `i` to vertex `j`, where `A` is the adjacency matrix. A walk is an edge-sequence that may revisit vertices and reuse edges. Length means the number of edges (`k`), so the walk passes through `k+1` vertices.

### J2. Why does `A²` count length-2 walks?
A length-2 walk `i → t → j` needs edge `i→t` and edge `t→j`. The number of choices for the middle vertex `t` is `Σ_t A[i][t]·A[t][j]`, which is exactly the definition of `(A·A)[i][j]`. So squaring the matrix counts walks with one intermediate step.

### J3. What is `A^0`?
The identity matrix `I`. A length-0 walk from `i` to `j` exists only when `i == j` (stay put), and `I[i][j] = 1` exactly when `i == j`. It is also the starting accumulator for binary exponentiation.

### J4. How do you compute `A^k` fast?
Binary exponentiation (exponentiation by squaring): repeatedly square `A` to get `A^1, A^2, A^4, …` and multiply together the powers whose bit is set in `k`. This is `O(log k)` matrix multiplies, each `O(V³)`, so `O(V³ log k)` total.

### J5. Why take the entries modulo a prime?
Walk counts grow exponentially in `k` and overflow 64-bit integers quickly. Problems therefore ask for the count modulo a prime like `10^9 + 7`. You reduce after every addition and multiplication inside the matrix multiply.

### J6. What is the difference between a walk and a simple path?
A walk may repeat vertices and edges. A simple path visits each vertex at most once. `(A^k)[i][j]` counts **walks**. Counting simple paths of a given length is #P-hard, so matrix exponentiation does not solve it.

### J7. What does the diagonal of `A^k` mean?
`(A^k)[i][i]` is the number of closed walks of length `k` starting and ending at `i`. The trace (sum of the diagonal) counts all closed walks of length `k` in the graph.

### J8. Is this for directed or undirected graphs?
Both. For an undirected graph `A` is symmetric, and so is every power `A^k`. For a directed graph, `A` need not be symmetric, and `(A^k)[i][j]` may differ from `(A^k)[j][i]`.

### J9. What is the time complexity, and what dominates it?
`O(V³ log k)`. The `V³` per matrix multiply dominates; `log k` is at most ~60 even for `k = 10^18`. So the method is fast for small/medium `V` and *any* `k`.

### J10. What is the identity matrix and why does it matter here?
`I[i][j] = 1` if `i == j`, else `0`. It is the multiplicative identity (`A·I = A`), it equals `A^0`, and it is the correct starting value in the power loop. Returning `A` instead of `I` for `k=0` is a common bug.

### J11. Can you handle parallel edges (multigraph)?
Yes. Set `A[i][j]` to the number of parallel edges from `i` to `j`. The multiplication then correctly multiplies the number of choices at each step.

### J12 (analysis). Why is binary exponentiation `O(log k)` and not `O(k)`?
Each squaring doubles the exponent, so reaching `A^k` needs only `⌊log₂ k⌋` squarings, plus at most `log₂ k` extra multiplies for the set bits of `k`. Naively multiplying `A` by itself `k` times would be `O(k)` multiplies — exponentially worse for large `k`.

---

## Middle Questions (12 Q&A)

### M1. Prove that `A^k` counts length-`k` walks.
Induction on `k`. Base: `A^0 = I` counts the trivial length-0 walks (only `i→i`). Step: a length-`k` walk is a length-`(k-1)` walk `i ⇝ t` plus a final edge `t → j`, so `W_k[i][j] = Σ_t W_{k-1}[i][t]·A[t][j] = (A^{k-1}·A)[i][j] = (A^k)[i][j]`. Each multiply appends one edge.

### M2. When is layered DP better than matrix exponentiation?
When `k` is small. Layered DP over `k` steps from a single source is `O(V²·k)`, with no `V³` per step. For small `k` (say `k ≤ 1000`) it is simpler and often faster. Matrix exponentiation wins only when `k` is large enough that `log k ≪ k`.

### M3. How do you find the shortest walk of exactly `k` edges?
Use the min-plus (tropical) semiring: replace `+` with `min` and `×` with `+`. `A[i][j]` is the edge weight (`+∞` if absent). The `k`-th min-plus power gives the minimum total weight over all length-`k` walks. The identity has `0` on the diagonal and `+∞` off-diagonal.

### M4. What is a semiring and why does it matter here?
A set with an "add" `⊕` and "multiply" `⊗`, each associative, with `⊗` distributing over `⊕`. Matrix multiplication only uses these two operations, so swapping them changes what `A^k` computes: `(+,×)` counts, `(min,+)` finds shortest, `(max,+)` longest, `(OR,AND)` reachability — all with the same power code.

### M5. How do you count walks of length **at most** `k`?
Matrix power gives *exactly* `k`. For "≤ k", augment `A` with a sink vertex (an extra row/column) that absorbs and accumulates running totals via a self-loop, then take one power of the `(V+1)×(V+1)` matrix. Still `O(V³ log k)`.

### M6. How is Fibonacci a fixed-length walk problem?
The state `(F_n, F_{n-1})` transforms by the matrix `T = [[1,1],[1,0]]`, so `(F_{n+1},F_n)ᵀ = T^n (F_1,F_0)ᵀ`. Powering the `2×2` `T` by binary exponentiation gives `F_n` in `O(log n)`. The "graph" has 2 states; `(T^n)[0][1]` is a weighted walk count.

### M7. What is the right identity matrix for the min-plus semiring?
`0` on the diagonal, `+∞` off-diagonal — NOT the all-zeros matrix. Using the counting identity (zeros everywhere off-diagonal) for min-plus is a classic bug: it injects free `0`-cost diagonal jumps and makes distances too small.

### M8. How do you avoid overflow in the counting semiring?
Reduce mod `p` after every accumulation. In Go/Java, cast operands to 64-bit before multiplying so `a*b` does not overflow `int` before the `% MOD`. Optionally defer reductions using a 128-bit accumulator if you bound the number of terms.

### M9. How does this relate to Floyd-Warshall?
Floyd-Warshall (sibling `06-floyd-warshall`) computes all-pairs shortest distances over walks of *any* length using the same min-plus algebra, in `O(V³)`. Min-plus matrix *power* instead pins the walk to exactly `k` edges. Use Floyd-Warshall for unconstrained shortest paths; use min-plus power when the edge count is itself a constraint.

### M10. How do you count strings of length `k` avoiding a forbidden substring?
Build a small automaton whose states are matched-prefix lengths of the pattern, with transitions on each character that do not complete the pattern. The transition-count matrix `T` has `(T^k)[start][·]` summing to the number of valid length-`k` strings. This is automaton path counting via matrix power.

### M11. Why can't you use this for counting simple paths?
The walk recurrence is memoryless — appending an edge needs only the current endpoint. Simple paths require tracking the set of visited vertices, which blows the state up to `2^V` subsets. Counting simple paths of length `k` is #P-hard; matrix power is fast *because* it counts the easier walk quantity.

### M12 (analysis). What is the growth rate of the number of length-`k` walks?
For a strongly connected aperiodic graph, the count grows like `λ_max^k`, where `λ_max` is the largest eigenvalue (spectral radius / Perron-Frobenius eigenvalue). If `λ_max > 1` the counts explode, which is why a modulus is needed. The growth rate `log λ_max` is the graph's topological entropy.

---

## Senior Questions (10 Q&A)

### S1. How would you compute the answer for `k = 10^18` exactly?
Take the count modulo a prime and run binary exponentiation: ~60 matrix multiplies, `O(V³ log k)`. If the true (non-modular) value is needed and exceeds one prime's range, run under several coprime primes and reconstruct via CRT. Pure big-integer arithmetic would lose the `log k` advantage because the answer itself has `Θ(k)` digits.

### S2. When would you use Kitamasa instead of matrix exponentiation?
When you need a *single* term of an order-`r` linear recurrence with `r` large. Kitamasa (polynomial exponentiation modulo the characteristic polynomial, via Cayley-Hamilton) runs in `O(r² log k)` (or `O(r log r log k)` with FFT/NTT), beating the `O(r³ log k)` matrix power by a factor of `r` when you do not need the full matrix.

### S3. How do you model a layered DP as matrix exponentiation?
If the DP has a small fixed state set, a layer-independent transition, and a huge number of layers `k`, encode the transition as a constant matrix `T` and compute `T^k`. This collapses an `O(|S|²·k)` DP into `O(|S|³ log k)`. Minimizing the state count is the key lever since cost is cubic in it.

### S4. How does the technique apply to Markov chains?
With a row-stochastic transition matrix `P`, `(P^k)[i][j]` is the probability of being in state `j` after `k` steps from `i`, and `π_k = π_0 P^k` evolves the distribution. Binary exponentiation gives the `k`-step distribution for huge `k`. Beware floating-point drift; for `k → ∞` solve the stationary distribution directly instead of powering.

### S5. How do you make one implementation serve all the semiring variants?
Parameterize `matPow` by a semiring object carrying `add`, `mul`, `zero`, and `one`. The power skeleton never changes; only the element type and operations do. Crucially, store the identity inside the semiring so you can never mismatch it (the off-diagonal must be `0̄`, which is `+∞` for min-plus, not `0`).

### S6. Can fast matrix multiplication (Strassen) speed this up?
Yes for the counting/ring semiring: `O(V^ω log k)` with `ω < 2.372`, because Strassen needs subtraction. It does **not** apply to min-plus/max-plus, which lack additive inverses; the best known min-plus multiply is barely subcubic, and the APSP hypothesis conjectures no truly subcubic algorithm exists. For practical `V`, cache-tuned schoolbook is usually fastest.

### S7. How do you verify correctness when `k` is too large to brute-force?
Keep a brute-force layered-DP oracle for small `V` and small `k` and compare entrywise. Add property tests: `A^0 == I`, `A^a · A^b == A^{a+b}`, `A · I == A` per semiring, and a geometric-growth sanity check (counts should grow ≈ `λ_max^k`). Determinism across languages with the same seed and modulus is another strong check.

### S8. What are the main performance levers in the matrix multiply?
Loop order `i, t, j` (cache-friendly contiguous reads of `b[t]`), zero-skip on sparse matrices, flat single-array storage instead of arrays-of-arrays, blocking/tiling for cache, and BLAS/SIMD for the real-valued case. Parallelize across output rows; the power loop itself is sequential, so parallelism lives inside the multiply.

### S9. How would you compute the shortest path with *at most* `k` edges?
Two options: (1) min-plus power of the augmented matrix that allows "parking" at the destination via a `0`-weight self-loop, giving "≤ k" in one power; (2) Bellman-Ford with at most `k` relaxation rounds, which is `O(kE)` and naturally bounds the edge count — usually cheaper than the `O(V³ log k)` matrix approach for sparse graphs.

### S10 (analysis). Why is min-plus matrix power well-defined even with negative cycles?
Because the edge count is fixed at `k`, you can only traverse a negative cycle as many times as the `k`-edge budget allows — the total weight stays finite. Unconstrained shortest path with a reachable negative cycle is `−∞`, but the fixed-length min-plus power is bounded. This makes it the right tool when the exact number of edges is a hard constraint.

---

## Professional Questions (8 Q&A)

### P1. Design a service that answers "number of length-`k` itineraries" for arbitrary `k` over a fixed flight graph.
Precompute nothing per query if `V` is small: each query is one `O(V³ log k)` matrix power. If many queries share the graph but differ in `k`, cache the squared powers `A^{2^0}, A^{2^1}, …, A^{2^{60}}` once (`O(V³ · 60)` precompute), then each query multiplies the relevant cached powers in `O(V³ · popcount(k))`. Take everything mod the required prime; shard across CRT primes if the exact value is needed.

### P2. How do you handle a problem that needs the count exactly, not modulo anything?
If the exact value is large, it has `Θ(k log λ_max)` digits, so big-integer matrix multiply costs grow with `k` and the `log k` advantage erodes. Use CRT across enough primes to cover the value's range, run independent modular matrix exponentiations (embarrassingly parallel), and reconstruct. Estimate the magnitude via `λ_max^k` to choose the number of primes.

### P3. Your matrix is `1000 × 1000`. The `V³ log k` is too slow. What do you do?
First minimize the state space (DFA minimization, drop unreachable/equivalent states); halving `V` is an 8× win. If the matrix is sparse, exploit the zero-skip and consider sparse-matrix power. If only one entry/term is needed, switch to Kitamasa (`O(r² log k)`). For the ring case, Strassen lowers the exponent. If it is a real-valued Markov chain converging to stationarity, stop powering and solve `πP = π` directly.

### P4. How do you debug "the walk count is wrong" in production?
Run the brute-force layered-DP oracle on the exact same small inputs and diff entrywise. Check the three usual suspects: off-by-one (length counts edges, not vertices), wrong `A^0` (must be `I`), and a missing/incorrect modulus (overflow). Verify the semiring identity (`A·I == A`). Add an assertion that counts grow roughly geometrically; a flat or erratic growth curve signals a structural bug.

### P5. When is the min-plus / max-plus variant the wrong choice?
When the question is about *simple* paths (longest simple path is NP-hard; max-plus power gives longest *walk*, which loops through positive cycles). Also when the edge count is not actually constrained — then Dijkstra/Bellman-Ford/Floyd-Warshall are far cheaper than `O(V³ log k)`. State the walk-vs-path distinction explicitly to avoid silently answering the wrong question.

### P6. How would you parallelize a huge batch of fixed-length counting queries?
Precompute the binary-power ladder of `A` once. Each query (a different `(i, j, k)`) reduces to multiplying a subset of cached powers — independent work, so distribute queries across workers. Across multiple CRT primes, each prime is an independent job. The matrix multiply itself parallelizes across output rows for large `V`.

### P7. How do automata and regular languages connect to this technique?
A finite automaton is a labeled graph; `A[i][j]` = number of transitions from state `i` to state `j`. `(A^k)[start][accept]`, summed over accepting states, counts accepted words of length exactly `k`. This is the standard way to count length-`k` strings in a regular language (e.g., strings avoiding a pattern), and underlies generating-function / transfer-matrix methods in combinatorics.

### P8 (analysis). Why does the spectral (eigenvalue) formula fail for exact counts?
`(A^k)[i][j] = Σ_r c_{ijr} λ_r^k`, but the eigenvalues `λ_r` of an integer matrix are generally irrational algebraic numbers. Computing this in floating point gives an approximation, not an exact integer, and reducing an irrational mod `p` is meaningless. The spectral form is for asymptotics and growth rates; exact counts demand integer matrix exponentiation mod a prime.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced a slow `O(k)`-style loop with a logarithmic algorithm.
Look for a concrete story: a counting or recurrence task where `k` was large, a profile that showed the linear loop dominating, the insight that the transition was a fixed linear map (hence a matrix power), and the measured speedup (e.g., from seconds to microseconds). Strong answers cite the correctness check against the old slow version and the modulus/overflow care taken.

### B2. A teammate used `(A^k)[i][j]` to count simple paths and shipped a wrong result. How do you handle it?
Explain the walk-vs-simple-path distinction calmly and with a tiny counterexample (a triangle has length-3 walks that revisit vertices). Note that counting simple paths is #P-hard, so there is no drop-in fast fix; the right move is either to reframe the requirement (do they really need simple paths?) or to use subset-DP / color-coding for small sizes. Frame it as a teaching moment, not a blame moment.

### B3. Design a feature that predicts where a random-walking user will be after `k` clicks.
This is a Markov chain: build the transition matrix `P` from click logs, compute `π_0 P^k`. Discuss data sparsity, smoothing zero-probability transitions, floating-point drift for large `k`, and that for "eventually" (`k → ∞`) you solve the stationary distribution instead. Mention PageRank as the canonical production instance and the need to handle dangling states.

### B4. How would you explain matrix exponentiation for graphs to a junior engineer?
Start from the flight-itinerary analogy: `A` is the direct-flight grid, `A²` counts one-stopover itineraries, `A^k` counts `k`-leg itineraries. Then show binary exponentiation as "precompute 8-leg and 4-leg blocks and snap them together." Emphasize the two gotchas first: it counts walks (revisits allowed), and you must take the count mod `p`. Good mentoring leads with the pitfalls.

### B5. Your fixed-length counting job is consuming too much memory at scale. How do you investigate?
Each `V × V` `int64` matrix is `8V²` bytes; check whether `V` ballooned (un-minimized states). Confirm you are ping-ponging two scratch matrices, not allocating a fresh one per multiply (GC churn). For batched queries, verify the cached power ladder is shared, not duplicated per request. Profile allocations; the fix is usually state minimization plus buffer reuse.

---

## Coding Challenges

### Challenge 1: Count Paths of Length K (mod p)

**Problem.** Given a directed graph as an adjacency matrix `A` (`n × n`), a length `k`, and source/target `s, t`, return the number of walks of length exactly `k` from `s` to `t`, modulo `10^9 + 7`.

**Example.**
```text
A = [[0,1,1],[0,0,1],[1,0,0]], k = 3, s = 0, t = 0  ->  1   (0→1→2→0)
A = [[0,1,1],[0,0,1],[1,0,0]], k = 2, s = 0, t = 2  ->  1   (0→1→2)
```

**Constraints.** `1 ≤ n ≤ 100`, `1 ≤ k ≤ 10^18`.

**Brute force.** Layered DP over `k` steps, `O(n²·k)` — infeasible for large `k`.

**Optimal.** Matrix exponentiation, `O(n³ log k)`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func mul(a, b [][]int64) [][]int64 {
	n := len(a)
	c := make([][]int64, n)
	for i := range c {
		c[i] = make([]int64, n)
		for t := 0; t < n; t++ {
			if a[i][t] == 0 {
				continue
			}
			for j := 0; j < n; j++ {
				c[i][j] = (c[i][j] + a[i][t]*b[t][j]) % MOD
			}
		}
	}
	return c
}

func matPow(a [][]int64, k int64) [][]int64 {
	n := len(a)
	r := make([][]int64, n)
	for i := range r {
		r[i] = make([]int64, n)
		r[i][i] = 1
	}
	for k > 0 {
		if k&1 == 1 {
			r = mul(r, a)
		}
		a = mul(a, a)
		k >>= 1
	}
	return r
}

func countPaths(A [][]int64, k int64, s, t int) int64 {
	return matPow(A, k)[s][t]
}

func main() {
	A := [][]int64{{0, 1, 1}, {0, 0, 1}, {1, 0, 0}}
	fmt.Println(countPaths(A, 3, 0, 0)) // 1
	fmt.Println(countPaths(A, 2, 0, 2)) // 1
}
```

**Java.**
```java
public class CountPaths {
    static final long MOD = 1_000_000_007L;

    static long[][] mul(long[][] a, long[][] b) {
        int n = a.length;
        long[][] c = new long[n][n];
        for (int i = 0; i < n; i++)
            for (int t = 0; t < n; t++) {
                if (a[i][t] == 0) continue;
                for (int j = 0; j < n; j++)
                    c[i][j] = (c[i][j] + a[i][t] * b[t][j]) % MOD;
            }
        return c;
    }

    static long[][] matPow(long[][] a, long k) {
        int n = a.length;
        long[][] r = new long[n][n];
        for (int i = 0; i < n; i++) r[i][i] = 1;
        while (k > 0) {
            if ((k & 1) == 1) r = mul(r, a);
            a = mul(a, a);
            k >>= 1;
        }
        return r;
    }

    static long countPaths(long[][] A, long k, int s, int t) {
        return matPow(A, k)[s][t];
    }

    public static void main(String[] args) {
        long[][] A = {{0, 1, 1}, {0, 0, 1}, {1, 0, 0}};
        System.out.println(countPaths(A, 3, 0, 0)); // 1
        System.out.println(countPaths(A, 2, 0, 2)); // 1
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def mul(a, b):
    n = len(a)
    c = [[0] * n for _ in range(n)]
    for i in range(n):
        for t in range(n):
            if a[i][t]:
                ait, bt, ci = a[i][t], b[t], c[i]
                for j in range(n):
                    ci[j] = (ci[j] + ait * bt[j]) % MOD
    return c


def mat_pow(a, k):
    n = len(a)
    r = [[1 if i == j else 0 for j in range(n)] for i in range(n)]
    while k > 0:
        if k & 1:
            r = mul(r, a)
        a = mul(a, a)
        k >>= 1
    return r


def count_paths(A, k, s, t):
    return mat_pow(A, k)[s][t]


if __name__ == "__main__":
    A = [[0, 1, 1], [0, 0, 1], [1, 0, 0]]
    print(count_paths(A, 3, 0, 0))  # 1
    print(count_paths(A, 2, 0, 2))  # 1
```

---

### Challenge 2: Shortest Path with Exactly K Edges

**Problem.** Given a weighted directed graph (`n × n` weight matrix, `INF` = no edge), find the minimum total weight of a walk using exactly `k` edges from `s` to `t`. Return `-1` if none exists.

**Example.**
```text
W = [[INF,2,5],[INF,INF,1],[4,INF,INF]], k = 3, s = 0, t = 2
  0→1→2→0→? ... exactly-3-edge walks; answer is the min-weight one.
```

**Optimal.** Min-plus matrix power, `O(n³ log k)`.

**Go.**
```go
package main

import (
	"fmt"
	"math"
)

const INF = math.MaxInt64 / 4

func minPlusMul(a, b [][]int64) [][]int64 {
	n := len(a)
	c := make([][]int64, n)
	for i := range c {
		c[i] = make([]int64, n)
		for j := range c[i] {
			c[i][j] = INF
		}
		for t := 0; t < n; t++ {
			if a[i][t] >= INF {
				continue
			}
			for j := 0; j < n; j++ {
				if v := a[i][t] + b[t][j]; v < c[i][j] {
					c[i][j] = v
				}
			}
		}
	}
	return c
}

func minPlusPow(a [][]int64, k int64) [][]int64 {
	n := len(a)
	r := make([][]int64, n)
	for i := range r {
		r[i] = make([]int64, n)
		for j := range r[i] {
			if i == j {
				r[i][j] = 0
			} else {
				r[i][j] = INF
			}
		}
	}
	for k > 0 {
		if k&1 == 1 {
			r = minPlusMul(r, a)
		}
		a = minPlusMul(a, a)
		k >>= 1
	}
	return r
}

func main() {
	W := [][]int64{{INF, 2, 5}, {INF, INF, 1}, {4, INF, INF}}
	res := minPlusPow(W, 3)[0][2]
	if res >= INF {
		fmt.Println(-1)
	} else {
		fmt.Println(res)
	}
}
```

**Java.**
```java
public class ShortestKEdges {
    static final long INF = Long.MAX_VALUE / 4;

    static long[][] mul(long[][] a, long[][] b) {
        int n = a.length;
        long[][] c = new long[n][n];
        for (long[] row : c) java.util.Arrays.fill(row, INF);
        for (int i = 0; i < n; i++)
            for (int t = 0; t < n; t++) {
                if (a[i][t] >= INF) continue;
                for (int j = 0; j < n; j++) {
                    long v = a[i][t] + b[t][j];
                    if (v < c[i][j]) c[i][j] = v;
                }
            }
        return c;
    }

    static long[][] pow(long[][] a, long k) {
        int n = a.length;
        long[][] r = new long[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++) r[i][j] = (i == j) ? 0 : INF;
        while (k > 0) {
            if ((k & 1) == 1) r = mul(r, a);
            a = mul(a, a);
            k >>= 1;
        }
        return r;
    }

    public static void main(String[] args) {
        long I = INF;
        long[][] W = {{I, 2, 5}, {I, I, 1}, {4, I, I}};
        long res = pow(W, 3)[0][2];
        System.out.println(res >= INF ? -1 : res);
    }
}
```

**Python.**
```python
INF = float("inf")


def min_plus_mul(a, b):
    n = len(a)
    c = [[INF] * n for _ in range(n)]
    for i in range(n):
        for t in range(n):
            if a[i][t] == INF:
                continue
            ait, bt, ci = a[i][t], b[t], c[i]
            for j in range(n):
                v = ait + bt[j]
                if v < ci[j]:
                    ci[j] = v
    return c


def min_plus_pow(a, k):
    n = len(a)
    r = [[0 if i == j else INF for j in range(n)] for i in range(n)]
    while k > 0:
        if k & 1:
            r = min_plus_mul(r, a)
        a = min_plus_mul(a, a)
        k >>= 1
    return r


if __name__ == "__main__":
    W = [[INF, 2, 5], [INF, INF, 1], [4, INF, INF]]
    res = min_plus_pow(W, 3)[0][2]
    print(-1 if res == INF else res)
```

---

### Challenge 3: Knight Walks of Length K

**Problem.** On an `R × C` chessboard, count the number of distinct knight move-sequences of length exactly `k` that start at cell `s` and end at cell `t`, modulo `10^9 + 7`. Cells are vertices; a knight move is an edge.

**Approach.** Build the `(R·C) × (R·C)` adjacency matrix where `A[u][v] = 1` iff a knight can move from cell `u` to cell `v`. Then the answer is `(A^k)[s][t]` (counting semiring). For small boards this is direct matrix exponentiation.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

var dr = []int{1, 1, -1, -1, 2, 2, -2, -2}
var dc = []int{2, -2, 2, -2, 1, -1, 1, -1}

func buildKnight(R, C int) [][]int64 {
	n := R * C
	A := make([][]int64, n)
	for i := range A {
		A[i] = make([]int64, n)
	}
	for r := 0; r < R; r++ {
		for c := 0; c < C; c++ {
			for d := 0; d < 8; d++ {
				nr, nc := r+dr[d], c+dc[d]
				if nr >= 0 && nr < R && nc >= 0 && nc < C {
					A[r*C+c][nr*C+nc] = 1
				}
			}
		}
	}
	return A
}

func mul(a, b [][]int64) [][]int64 {
	n := len(a)
	c := make([][]int64, n)
	for i := range c {
		c[i] = make([]int64, n)
		for t := 0; t < n; t++ {
			if a[i][t] == 0 {
				continue
			}
			for j := 0; j < n; j++ {
				c[i][j] = (c[i][j] + a[i][t]*b[t][j]) % MOD
			}
		}
	}
	return c
}

func matPow(a [][]int64, k int64) [][]int64 {
	n := len(a)
	r := make([][]int64, n)
	for i := range r {
		r[i] = make([]int64, n)
		r[i][i] = 1
	}
	for k > 0 {
		if k&1 == 1 {
			r = mul(r, a)
		}
		a = mul(a, a)
		k >>= 1
	}
	return r
}

func main() {
	R, C := 3, 3
	A := buildKnight(R, C)
	Ak := matPow(A, 2)
	fmt.Println(Ak[0][0]) // knight walks of length 2 from corner back to corner
}
```

**Java.**
```java
public class KnightWalks {
    static final long MOD = 1_000_000_007L;
    static final int[] dr = {1, 1, -1, -1, 2, 2, -2, -2};
    static final int[] dc = {2, -2, 2, -2, 1, -1, 1, -1};

    static long[][] buildKnight(int R, int C) {
        int n = R * C;
        long[][] A = new long[n][n];
        for (int r = 0; r < R; r++)
            for (int c = 0; c < C; c++)
                for (int d = 0; d < 8; d++) {
                    int nr = r + dr[d], nc = c + dc[d];
                    if (nr >= 0 && nr < R && nc >= 0 && nc < C)
                        A[r * C + c][nr * C + nc] = 1;
                }
        return A;
    }

    static long[][] mul(long[][] a, long[][] b) {
        int n = a.length;
        long[][] c = new long[n][n];
        for (int i = 0; i < n; i++)
            for (int t = 0; t < n; t++) {
                if (a[i][t] == 0) continue;
                for (int j = 0; j < n; j++)
                    c[i][j] = (c[i][j] + a[i][t] * b[t][j]) % MOD;
            }
        return c;
    }

    static long[][] matPow(long[][] a, long k) {
        int n = a.length;
        long[][] r = new long[n][n];
        for (int i = 0; i < n; i++) r[i][i] = 1;
        while (k > 0) {
            if ((k & 1) == 1) r = mul(r, a);
            a = mul(a, a);
            k >>= 1;
        }
        return r;
    }

    public static void main(String[] args) {
        long[][] A = buildKnight(3, 3);
        System.out.println(matPow(A, 2)[0][0]);
    }
}
```

**Python.**
```python
MOD = 1_000_000_007
DR = [1, 1, -1, -1, 2, 2, -2, -2]
DC = [2, -2, 2, -2, 1, -1, 1, -1]


def build_knight(R, C):
    n = R * C
    A = [[0] * n for _ in range(n)]
    for r in range(R):
        for c in range(C):
            for dr, dc in zip(DR, DC):
                nr, nc = r + dr, c + dc
                if 0 <= nr < R and 0 <= nc < C:
                    A[r * C + c][nr * C + nc] = 1
    return A


def mul(a, b):
    n = len(a)
    c = [[0] * n for _ in range(n)]
    for i in range(n):
        for t in range(n):
            if a[i][t]:
                ait, bt, ci = a[i][t], b[t], c[i]
                for j in range(n):
                    ci[j] = (ci[j] + ait * bt[j]) % MOD
    return c


def mat_pow(a, k):
    n = len(a)
    r = [[1 if i == j else 0 for j in range(n)] for i in range(n)]
    while k > 0:
        if k & 1:
            r = mul(r, a)
        a = mul(a, a)
        k >>= 1
    return r


if __name__ == "__main__":
    A = build_knight(3, 3)
    print(mat_pow(A, 2)[0][0])
```

---

### Challenge 4: N-th Term of a Linear Recurrence via Matrix Power

**Problem.** Given a linear recurrence `f(n) = c_1 f(n-1) + c_2 f(n-2) + … + c_r f(n-r)` with initial values `f(0), …, f(r-1)`, compute `f(n) mod 10^9 + 7` for huge `n` (up to `10^18`).

**Approach.** Build the `r × r` companion matrix `T` whose top row is `(c_1, …, c_r)` and whose subdiagonal is the identity shift. Then `(f(n), …, f(n-r+1))ᵀ = T^{n-r+1} (f(r-1), …, f(0))ᵀ`. Powering `T` gives `f(n)` in `O(r³ log n)`.

**Python.**
```python
MOD = 1_000_000_007


def mul(a, b):
    n, m, p = len(a), len(b), len(b[0])
    c = [[0] * p for _ in range(n)]
    for i in range(n):
        for t in range(m):
            if a[i][t]:
                ait, bt, ci = a[i][t], b[t], c[i]
                for j in range(p):
                    ci[j] = (ci[j] + ait * bt[j]) % MOD
    return c


def mat_pow(a, k):
    n = len(a)
    r = [[1 if i == j else 0 for j in range(n)] for i in range(n)]
    while k > 0:
        if k & 1:
            r = mul(r, a)
        a = mul(a, a)
        k >>= 1
    return r


def nth_term(coeffs, init, n):
    r = len(coeffs)
    if n < r:
        return init[n] % MOD
    # companion matrix
    T = [[0] * r for _ in range(r)]
    T[0] = [c % MOD for c in coeffs]
    for i in range(1, r):
        T[i][i - 1] = 1
    Tn = mat_pow(T, n - (r - 1))
    # state vector (f(r-1), ..., f(0))
    state = [[init[r - 1 - i]] for i in range(r)]
    res = mul(Tn, state)
    return res[0][0] % MOD


if __name__ == "__main__":
    # Fibonacci: f(n) = f(n-1) + f(n-2), f(0)=0, f(1)=1
    print(nth_term([1, 1], [0, 1], 10))             # 55
    print(nth_term([1, 1], [0, 1], 100))            # mod p
    # Tribonacci: f(n)=f(n-1)+f(n-2)+f(n-3), f=0,1,1
    print(nth_term([1, 1, 1], [0, 1, 1], 10))
```

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

func matPow(a [][]int64, k int64) [][]int64 {
	n := len(a)
	r := make([][]int64, n)
	for i := range r {
		r[i] = make([]int64, n)
		r[i][i] = 1
	}
	for k > 0 {
		if k&1 == 1 {
			r = mul(r, a)
		}
		a = mul(a, a)
		k >>= 1
	}
	return r
}

func nthTerm(coeffs, init []int64, n int64) int64 {
	r := len(coeffs)
	if n < int64(r) {
		return init[n] % MOD
	}
	T := make([][]int64, r)
	for i := range T {
		T[i] = make([]int64, r)
	}
	for j := 0; j < r; j++ {
		T[0][j] = coeffs[j] % MOD
	}
	for i := 1; i < r; i++ {
		T[i][i-1] = 1
	}
	Tn := matPow(T, n-int64(r-1))
	state := make([][]int64, r)
	for i := 0; i < r; i++ {
		state[i] = []int64{init[r-1-i]}
	}
	return mul(Tn, state)[0][0] % MOD
}

func main() {
	fmt.Println(nthTerm([]int64{1, 1}, []int64{0, 1}, 10)) // 55
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

    static long[][] matPow(long[][] a, long k) {
        int n = a.length;
        long[][] r = new long[n][n];
        for (int i = 0; i < n; i++) r[i][i] = 1;
        while (k > 0) {
            if ((k & 1) == 1) r = mul(r, a);
            a = mul(a, a);
            k >>= 1;
        }
        return r;
    }

    static long nthTerm(long[] coeffs, long[] init, long n) {
        int r = coeffs.length;
        if (n < r) return init[(int) n] % MOD;
        long[][] T = new long[r][r];
        for (int j = 0; j < r; j++) T[0][j] = coeffs[j] % MOD;
        for (int i = 1; i < r; i++) T[i][i - 1] = 1;
        long[][] Tn = matPow(T, n - (r - 1));
        long[][] state = new long[r][1];
        for (int i = 0; i < r; i++) state[i][0] = init[r - 1 - i];
        return mul(Tn, state)[0][0] % MOD;
    }

    public static void main(String[] args) {
        System.out.println(nthTerm(new long[]{1, 1}, new long[]{0, 1}, 10)); // 55
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"`(A^k)[i][j]` counts length-`k` walks; compute `A^k` by binary exponentiation in `O(V³ log k)`."*
- Immediately flag the two gotchas: **walks, not simple paths** and **take it mod `p`**.
- If asked for shortest/longest/reachability with a fixed edge count, reach for the **semiring swap** — same code, different `add`/`mul`/identity.
- For a single recurrence term with large order, mention **Kitamasa** (`O(r² log k)`) as the optimization beyond the plain matrix power.
- Always offer to verify against a brute-force layered-DP oracle on small inputs.
