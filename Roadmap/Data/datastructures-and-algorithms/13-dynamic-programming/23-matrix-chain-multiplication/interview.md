# Matrix Chain Multiplication (MCM) — Interview Preparation

Matrix Chain Multiplication is a favourite interview topic because it rewards a single crisp insight — *"the last multiply splits the chain at some `k`, so `dp[i][j] = min_k dp[i][k] + dp[k+1][j] + p[i-1]·p[k]·p[j]`"* — and then tests whether you can (a) get the dimension indexing exactly right, (b) fill the table in the correct order (by chain length), (c) reconstruct the actual parenthesization from a split table, and (d) recognize the same interval-DP skeleton behind polygon triangulation and join ordering. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Minimum scalar multiplications for a chain | interval DP `dp[i][j]` | `O(n³)` time, `O(n²)` space |
| Print the optimal parenthesization | split table + DFS walk | `O(n)` reconstruction |
| Number of parenthesizations | Catalan `C(n-1)` | `Θ(4ⁿ/n^{1.5})` |
| Minimum-weight convex polygon triangulation | same DP (isomorphic) | `O(n³)`, or `O(n log n)` Hu-Shing |
| Optimal binary search tree | same skeleton + Knuth | `O(n²)` with QI |
| Top-down version | memoized recursion | `O(n³)` |
| **MCM in `O(n log n)`** | **Hu-Shing triangulation** | `O(n log n)` |

Core recurrence:

```text
dp[i][i] = 0
dp[i][j] = min over k in [i, j-1] of ( dp[i][k] + dp[k+1][j] + p[i-1]·p[k]·p[j] )
split[i][j] = argmin k     # record for reconstruction
answer = dp[1][n]          # p has n+1 entries; matrix Aᵢ is p[i-1] x p[i]
```

Fill order (critical):

```text
for L = 2..n:              # chain length, shortest first
  for i = 1..n-L+1:
    j = i+L-1
    for k = i..j-1: ...    # try every split
```

Key facts:
- Matrix `Aᵢ` has shape `p[i-1] × p[i]`; multiplying `p×q` by `q×r` costs `p·q·r`.
- Associativity → same result, wildly different cost.
- Always store the **split table** if you must print the grouping.
- Use **64-bit** for the cost; `p·q·r` overflows 32-bit for big dimensions.
- The DP is `O(n³)`; Knuth's generic `O(n²)` does **not** apply (split-dependent cost), but Hu-Shing gives `O(n log n)`.

---

## Junior Questions (12 Q&A)

### J1. What does MCM actually optimize?
The total number of scalar multiplications to compute a chain `A₁·⋯·Aₙ`. The final matrix is identical for every parenthesization (associativity); only the work differs. MCM finds the cheapest grouping.

### J2. How much does multiplying two matrices cost?
Multiplying a `p × q` matrix by a `q × r` matrix costs `p·q·r` scalar multiplications and yields a `p × r` matrix. The shared inner dimension `q` is summed over.

### J3. What is the dimension array `p`?
An array of `n+1` numbers where matrix `Aᵢ` has shape `p[i-1] × p[i]`. Adjacent matrices share a dimension, so `n` matrices need only `n+1` numbers. Example: `[40,20,30,10,30]` encodes four matrices.

### J4. What is the recurrence?
`dp[i][j] = min over k in [i,j-1] of (dp[i][k] + dp[k+1][j] + p[i-1]·p[k]·p[j])`, with `dp[i][i] = 0`. The `k` is the split where the last multiply happens.

### J5. Why `dp[i][i] = 0`?
A single matrix requires no multiplication, so its cost is zero. These are the base cases of the DP.

### J6. Why must you fill the table by chain length?
`dp[i][j]` depends on shorter sub-chains `dp[i][k]` and `dp[k+1][j]`. Filling by increasing length ensures those are already computed. Looping `i,j` directly would read uncomputed values.

### J7. What is the time and space complexity?
`O(n³)` time (three nested loops: length, left endpoint, split) and `O(n²)` space (the `dp` table, plus an optional split table).

### J8. Why not just try every parenthesization?
There are `Catalan(n-1)` parenthesizations, which grows like `4ⁿ`. For 20 matrices that is over a billion. DP collapses this to `O(n³)`.

### J9. What is the split table for?
It records `split[i][j] = k`, the split that achieved the minimum for each interval. You walk it recursively to reconstruct the actual optimal parenthesization.

### J10. Does MCM change the final answer matrix?
No. Every parenthesization yields the identical result. MCM only changes the amount of arithmetic, never the output.

### J11. What's a common indexing bug?
Using `p[i]` instead of `p[i-1]` in the cost term. The cost is `p[i-1]·p[k]·p[j]`: the left endpoint contributes `p[i-1]`, the split `p[k]`, the right endpoint `p[j]`.

### J12 (analysis). Why does the order matter so much?
Each grouping produces different-sized intermediate matrices, and the cost `p·q·r` is multiplicative in those sizes. A grouping that builds a small intermediate early can be many times cheaper. For `[40,20,30,10,30]` the best is 26000 and the worst 69000 — same result.

---

## Middle Questions (12 Q&A)

### M1. Prove the recurrence is correct.
Every parenthesization of `Aᵢ⋯Aⱼ` has exactly one outermost multiply, splitting at some `k`. Partition all parenthesizations by `k`. The cheapest with root `k` uses optimal subtrees (optimal substructure), costing `dp[i][k] + dp[k+1][j] + p[i-1]·p[k]·p[j]`. Minimizing over `k` (an exhaustive disjoint partition) gives `dp[i][j]`.

### M2. What is optimal substructure here?
An optimal parenthesization of `[i,j]` contains optimal parenthesizations of `[i,k]` and `[k+1,j]`. Proof by exchange: if a subtree were suboptimal, swapping in a cheaper one (same shape) lowers the total, contradicting optimality.

### M3. How do you reconstruct the parenthesization?
Walk the split table: `printParens(i,j)` prints `Aᵢ` if `i==j`, else prints `(`, recurses on `[i, split[i][j]]` and `[split[i][j]+1, j]`, then `)`. It's a DFS of the implicit binary tree, `O(n)`.

### M4. Top-down vs bottom-up — are they equivalent?
Yes, both are `O(n³)` and solve each interval once. Bottom-up fills by chain length with better cache locality; top-down memoizes the recurrence directly and only touches reached intervals. Prefer bottom-up for large `n`, top-down for clarity.

### M5. What is the intuition for the cost term?
`p[i-1]·p[k]·p[j]` is the cost of the *final* multiply: `p[i-1]` rows of the left intermediate, `p[k]` the shared inner dimension, `p[j]` columns of the right intermediate. A small `p[k]` pinches the chain cheaply.

### M6. How is MCM related to polygon triangulation?
MCM is isomorphic to minimum-weight triangulation of a convex polygon with `n+1` weighted vertices (weights `p[0..n]`). Each triangle `(a,b,c)` weighs `p[a]·p[b]·p[c]`, one per multiply. Minimizing triangulation weight = MCM.

### M7. Can Knuth's optimization make MCM `O(n²)`?
Not directly. Knuth's `O(n²)` requires a split-*independent* per-node weight satisfying the quadrangle inequality. MCM's cost `p[i-1]·p[k]·p[j]` depends on the split `k`, so the generic argument fails. OBST does qualify; MCM does not.

### M8. So can MCM beat `O(n³)` at all?
Yes — Hu & Shing (1982/1984) give `O(n log n)` via the polygon-triangulation view and a fan decomposition around minimum-weight vertices. It's intricate and rarely implemented, but it proves the cubic DP isn't optimal for the problem.

### M9. How do you avoid integer overflow?
Use 64-bit (`long`/`int64`) for both the cost term and the `dp` entries. For dimensions in the thousands, `p·q·r` exceeds `2³¹`; long chains can even strain 64-bit, so estimate magnitude.

### M10. How many multiplies does the optimal plan use?
Always exactly `n-1`, regardless of order — a full binary tree with `n` leaves has `n-1` internal nodes. MCM optimizes the *cost* of those `n-1` multiplies, not their count.

### M11. Where does MCM appear in real systems?
Database join-order optimization (associative joins, intermediate sizes vary) and tensor-contraction ordering (einsum, tensor trains). The cost model differs (estimated rows, FLOPs) but the interval-DP structure is the same.

### M12 (analysis). What breaks if you allow commutativity?
For matrices, order is fixed (non-commutative), so only contiguous sub-chains combine — an `O(n³)` interval DP. Joins are commutative, allowing any subset to combine ("bushy" plans), which needs an `O(3ⁿ)` subset DP. Commutativity enlarges the plan space exponentially.

---

## Senior Questions (10 Q&A)

### S1. How would you handle `n` in the thousands?
The `O(n³)` DP may be too slow and the `O(n²)` tables too large. Options: triangular table packing to halve memory; cost-only mode (drop split table) if the grouping isn't needed; Hu-Shing `O(n log n)` for the literal chain; or a greedy heuristic if a near-optimal plan suffices.

### S2. The cost model isn't `p·q·r` — now what?
Parameterize the DP by a `combineCost(leftShape, rightShape)` function. Plug in Strassen FLOPs, estimated join cardinalities, or bytes moved. The recurrence, fill order, and reconstruction are unchanged; only the cost term varies. This single abstraction reuses one tested skeleton across matrices, joins, and tensors.

### S3. How do you verify correctness when you can't eyeball it?
Brute-force oracle on `n ≤ 12`. Crucially, a **replay check**: independently re-sum the `p·q·r` of each multiply in the reconstructed order and assert it equals `dp[1][n]`. This catches a split table that drifted from the cost table (usually from setting `split` outside the `if cost < best` guard).

### S4. Min-FLOPs vs min-peak-memory — when do they differ?
On GPUs the binding constraint is often peak memory (the largest intermediate must fit in VRAM), a different objective than total FLOPs. Replace the `min-sum` recurrence with `min over k of max(dp[i][k], dp[k+1][j], result_size)`. The two optima generally differ, so choose the objective deliberately.

### S5. How does MCM generalize to query optimization?
A join chain is associative *and* commutative, so the plan space includes bushy trees, not just contiguous sub-chains. The System R / Selinger subset DP (`O(3ⁿ)`) handles this. The literal-MCM interval DP is the special case where reordering is forbidden — applying it to commutative joins leaves better plans unexplored.

### S6. When is a greedy heuristic acceptable?
When `n` exceeds the DP's feasibility limit and a near-optimal plan suffices. Repeatedly performing the currently cheapest adjacent multiply is `O(n log n)` with a heap and typically within a small factor of optimal. Validate against the DP on small instances.

### S7. Why cache the computed plan?
The optimal order is computed once and reused across every evaluation of the chain (e.g., millions of forward passes in ML). The `O(n³)` planning cost amortizes to zero. Recomputing the plan per execution is a common, avoidable regression — cache it keyed by the dimension signature.

### S8. What are the main correctness pitfalls?
Wrong fill order (read uncomputed sub-intervals), wrong dimension indexing (`p[i]` vs `p[i-1]`), forgetting the split table, integer overflow, and split/cost disagreement. The replay check and a brute-force oracle catch nearly all of them.

### S9. How would you reconstruct without blowing the stack?
For huge `n`, a deeply left-leaning split tree overflows recursive reconstruction. Use an explicit stack: push `(i, j, closing)` tuples, emit `(`, leaves, and deferred `)` in the right order. Same `O(n)` work, bounded stack.

### S10 (analysis). Is the `O(n³)` complexity inherent to the problem?
No. `O(n³)` is a property of the *standard DP algorithm*, not the *problem*. Hu-Shing solves the same problem in `O(n log n)`, within a log factor of the trivial `Ω(n)` read-the-input bound. Unusual among textbook DPs — many are optimal for their problem; MCM's cubic DP is not.

---

## Professional Questions (8 Q&A)

### P1. Design a planner that optimizes a fixed matrix chain reused millions of times.
Compute the optimal order once with the `O(n³)` DP (or `O(n log n)` if `n` is huge), cache it keyed by the dimension signature, and reuse across all executions. The planning cost amortizes to nothing. Expose the cost model as a pluggable function so a Strassen-based or GPU-based runtime can supply its real per-multiply cost.

### P2. How do you make one DP serve matrices, joins, and tensors?
Abstract the combine cost: `combineCost(leftShape, rightShape) -> cost`. For matrices it's `p·q·r`; for joins, estimated `|S ⋈ T|`; for tensors, the product of involved index dimensions. The interval-DP skeleton, fill order, and reconstruction never change. Keep the cost function and the DP separately tested.

### P3. Your join optimizer must handle 15 relations. Interval DP isn't enough — why?
Joins are commutative, so the plan space is all subsets (bushy plans), not contiguous sub-chains. That needs the `O(3ⁿ)` subset DP (DPccp), and `3¹⁵ ≈ 14M` is feasible. Past ~15–20 relations even that explodes, so cap `n` and fall back to greedy or genetic search, validating against the DP on small queries.

### P4. How do you debug "the optimizer picked a bad plan" in production?
First check whether the *cost estimates* are wrong (bad cardinality estimation), not the DP — for joins this is the usual culprit. Replay the plan's per-step costs and confirm they sum to `dp[1][n]`. Run the brute-force oracle on a shrunk instance. Verify dimension/cardinality indexing. A perfect DP over bad estimates still yields bad plans.

### P5. When is the min-plus/peak-memory objective the right one?
When execution is memory-bound (large tensors on a GPU). Minimizing FLOPs can produce a plan whose largest intermediate OOMs. Switch to the min-max DP that minimizes peak intermediate size. State explicitly which objective the planner targets, since the optima differ.

### P6. How would you parallelize MCM planning?
The DP itself has sequential dependencies (longer intervals need shorter ones), but within one chain length `L`, all `dp[i][i+L-1]` are independent and can be computed in parallel across `i`. For batches of *different* chains, each chain is an independent job. The plan, once computed, is read-only and trivially shareable.

### P7. Explain the polygon-triangulation equivalence and why it matters.
Map the chain to a convex `(n+1)`-gon with vertex weights `p[0..n]`; matrix `Aᵢ` is side `v_{i-1}v_i`. Triangulations biject with parenthesizations, triangle weight `p[a]·p[b]·p[c]` = a multiply's cost. This reframing exposes geometric structure the matrix view hides and is exactly what enables the Hu-Shing `O(n log n)` algorithm.

### P8 (analysis). Why doesn't Knuth's optimization give MCM `O(n²)`?
Knuth's speedup needs a per-node weight `w(i,j)` independent of the split `k`, satisfying the quadrangle inequality, which makes the optimal split monotone. MCM's cost term `p[i-1]·p[k]·p[j]` *depends on `k`*, so the optimal split is not guaranteed monotone and restricting the inner loop can give wrong answers. Beating `O(n³)` requires the specialized triangulation argument (Hu-Shing), not the generic QI shortcut.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an exponential search with a polynomial algorithm.
Look for a concrete story: a task whose naive solution enumerated combinatorially many options (orderings, groupings), the recognition of optimal substructure, the DP formulation, and the measured speedup. Strong answers mention validating the DP against the brute force on small inputs and handling overflow.

### B2. A teammate hard-coded `p·q·r` but the runtime uses Strassen. How do you handle it?
Explain that the optimal order depends on the cost model: under a sub-cubic kernel, `p·q·r` is the wrong cost and the chosen plan may be suboptimal. Propose parameterizing the DP by the kernel's actual cost function. Frame it as a design improvement (pluggable cost) rather than blame.

### B3. Design a feature that picks the cheapest join order for a reporting query.
This is generalized MCM with commutativity: a subset DP (Selinger) over join sub-results, cost = estimated cardinality. Discuss cardinality estimation quality, capping `n` with a heuristic fallback, bushy vs left-deep plans, and runtime re-optimization when estimates prove wrong. Mention that the literal interval DP is the non-commutative special case.

### B4. How would you explain MCM to a junior engineer?
Start from the recipe analogy: same dish, but combining the small piles first saves total work. Show the `p·q·r` cost and one concrete pair of orderings whose costs differ. Then introduce "the last multiply splits the chain" and the DP. Lead with the two gotchas: dimension indexing and filling by chain length.

### B5. Your planning step is slow for very long chains. How do you investigate?
Profile to confirm it's the `O(n³)` DP, not I/O. Check whether `n` ballooned. Options: triangular table packing (memory), cost-only mode (drop split table), Hu-Shing `O(n log n)` for the literal chain, or a greedy heuristic. Verify you're not recomputing the plan when the chain shape is unchanged — cache it.

---

## Coding Challenges

### Challenge 1: Minimum Cost of a Matrix Chain

**Problem.** Given a dimension array `p` of length `n+1` (matrix `Aᵢ` is `p[i-1] × p[i]`), return the minimum number of scalar multiplications to compute `A₁·⋯·Aₙ`.

**Example.**
```text
p = [40, 20, 30, 10, 30]  ->  26000
p = [10, 20, 30]          ->  6000   (single multiply, 10*20*30)
```

**Constraints.** `1 ≤ n ≤ 1000`, dimensions up to `10⁴`.

**Optimal.** Interval DP, `O(n³)` time, `O(n²)` space.

**Go.**
```go
package main

import (
	"fmt"
	"math"
)

func minCost(p []int) int64 {
	n := len(p) - 1
	dp := make([][]int64, n+1)
	for i := range dp {
		dp[i] = make([]int64, n+1)
	}
	for L := 2; L <= n; L++ {
		for i := 1; i+L-1 <= n; i++ {
			j := i + L - 1
			dp[i][j] = math.MaxInt64
			for k := i; k < j; k++ {
				c := dp[i][k] + dp[k+1][j] +
					int64(p[i-1])*int64(p[k])*int64(p[j])
				if c < dp[i][j] {
					dp[i][j] = c
				}
			}
		}
	}
	return dp[1][n]
}

func main() {
	fmt.Println(minCost([]int{40, 20, 30, 10, 30})) // 26000
	fmt.Println(minCost([]int{10, 20, 30}))         // 6000
}
```

**Java.**
```java
public class MinCost {
    static long minCost(int[] p) {
        int n = p.length - 1;
        long[][] dp = new long[n + 1][n + 1];
        for (int L = 2; L <= n; L++) {
            for (int i = 1; i + L - 1 <= n; i++) {
                int j = i + L - 1;
                dp[i][j] = Long.MAX_VALUE;
                for (int k = i; k < j; k++) {
                    long c = dp[i][k] + dp[k + 1][j]
                            + (long) p[i - 1] * p[k] * p[j];
                    if (c < dp[i][j]) dp[i][j] = c;
                }
            }
        }
        return dp[1][n];
    }

    public static void main(String[] args) {
        System.out.println(minCost(new int[]{40, 20, 30, 10, 30})); // 26000
        System.out.println(minCost(new int[]{10, 20, 30}));         // 6000
    }
}
```

**Python.**
```python
import math


def min_cost(p):
    n = len(p) - 1
    dp = [[0] * (n + 1) for _ in range(n + 1)]
    for L in range(2, n + 1):
        for i in range(1, n - L + 2):
            j = i + L - 1
            dp[i][j] = math.inf
            for k in range(i, j):
                c = dp[i][k] + dp[k + 1][j] + p[i - 1] * p[k] * p[j]
                if c < dp[i][j]:
                    dp[i][j] = c
    return dp[1][n]


if __name__ == "__main__":
    print(min_cost([40, 20, 30, 10, 30]))  # 26000
    print(min_cost([10, 20, 30]))          # 6000
```

---

### Challenge 2: Print the Optimal Parenthesization

**Problem.** Given `p`, return the optimal parenthesization as a string like `((A1(A2A3))A4)`, using the split table.

**Example.**
```text
p = [40, 20, 30, 10, 30]  ->  ((A1(A2A3))A4)
```

**Optimal.** Same DP, plus a split table and an `O(n)` reconstruction.

**Go.**
```go
package main

import (
	"fmt"
	"math"
	"strconv"
)

func solve(p []int) (int64, [][]int) {
	n := len(p) - 1
	dp := make([][]int64, n+1)
	split := make([][]int, n+1)
	for i := range dp {
		dp[i] = make([]int64, n+1)
		split[i] = make([]int, n+1)
	}
	for L := 2; L <= n; L++ {
		for i := 1; i+L-1 <= n; i++ {
			j := i + L - 1
			dp[i][j] = math.MaxInt64
			for k := i; k < j; k++ {
				c := dp[i][k] + dp[k+1][j] +
					int64(p[i-1])*int64(p[k])*int64(p[j])
				if c < dp[i][j] {
					dp[i][j] = c
					split[i][j] = k
				}
			}
		}
	}
	return dp[1][n], split
}

func parens(split [][]int, i, j int) string {
	if i == j {
		return "A" + strconv.Itoa(i)
	}
	k := split[i][j]
	return "(" + parens(split, i, k) + parens(split, k+1, j) + ")"
}

func main() {
	p := []int{40, 20, 30, 10, 30}
	_, split := solve(p)
	fmt.Println(parens(split, 1, len(p)-1)) // ((A1(A2A3))A4)
}
```

**Java.**
```java
public class PrintParens {
    static long[][] dp;
    static int[][] split;

    static void solve(int[] p) {
        int n = p.length - 1;
        dp = new long[n + 1][n + 1];
        split = new int[n + 1][n + 1];
        for (int L = 2; L <= n; L++) {
            for (int i = 1; i + L - 1 <= n; i++) {
                int j = i + L - 1;
                dp[i][j] = Long.MAX_VALUE;
                for (int k = i; k < j; k++) {
                    long c = dp[i][k] + dp[k + 1][j]
                            + (long) p[i - 1] * p[k] * p[j];
                    if (c < dp[i][j]) {
                        dp[i][j] = c;
                        split[i][j] = k;
                    }
                }
            }
        }
    }

    static String parens(int i, int j) {
        if (i == j) return "A" + i;
        int k = split[i][j];
        return "(" + parens(i, k) + parens(k + 1, j) + ")";
    }

    public static void main(String[] args) {
        int[] p = {40, 20, 30, 10, 30};
        solve(p);
        System.out.println(parens(1, p.length - 1)); // ((A1(A2A3))A4)
    }
}
```

**Python.**
```python
import math


def solve(p):
    n = len(p) - 1
    dp = [[0] * (n + 1) for _ in range(n + 1)]
    split = [[0] * (n + 1) for _ in range(n + 1)]
    for L in range(2, n + 1):
        for i in range(1, n - L + 2):
            j = i + L - 1
            dp[i][j] = math.inf
            for k in range(i, j):
                c = dp[i][k] + dp[k + 1][j] + p[i - 1] * p[k] * p[j]
                if c < dp[i][j]:
                    dp[i][j] = c
                    split[i][j] = k
    return split


def parens(split, i, j):
    if i == j:
        return f"A{i}"
    k = split[i][j]
    return "(" + parens(split, i, k) + parens(split, k + 1, j) + ")"


if __name__ == "__main__":
    p = [40, 20, 30, 10, 30]
    print(parens(solve(p), 1, len(p) - 1))  # ((A1(A2A3))A4)
```

---

### Challenge 3: Minimum-Weight Convex Polygon Triangulation

**Problem.** Given the weights of `m` vertices of a convex polygon (`w[0..m-1]`), find the minimum total weight of a triangulation, where each triangle `(a,b,c)` weighs `w[a]·w[b]·w[c]`. This is MCM in disguise (`w` plays the role of `p`, `m = n+1`).

**Example.**
```text
w = [40, 20, 30, 10, 30]  ->  26000   (same as the matrix chain)
```

**Optimal.** Interval DP over vertex ranges, `O(m³)`.

**Go.**
```go
package main

import (
	"fmt"
	"math"
)

func minTriangulation(w []int) int64 {
	m := len(w)
	// dp[i][j] = min weight to triangulate the polygon on vertices i..j
	dp := make([][]int64, m)
	for i := range dp {
		dp[i] = make([]int64, m)
	}
	for gap := 2; gap < m; gap++ {
		for i := 0; i+gap < m; i++ {
			j := i + gap
			dp[i][j] = math.MaxInt64
			for k := i + 1; k < j; k++ {
				c := dp[i][k] + dp[k][j] +
					int64(w[i])*int64(w[k])*int64(w[j])
				if c < dp[i][j] {
					dp[i][j] = c
				}
			}
		}
	}
	return dp[0][m-1]
}

func main() {
	fmt.Println(minTriangulation([]int{40, 20, 30, 10, 30})) // 26000
}
```

**Java.**
```java
public class Triangulation {
    static long minTriangulation(int[] w) {
        int m = w.length;
        long[][] dp = new long[m][m];
        for (int gap = 2; gap < m; gap++) {
            for (int i = 0; i + gap < m; i++) {
                int j = i + gap;
                dp[i][j] = Long.MAX_VALUE;
                for (int k = i + 1; k < j; k++) {
                    long c = dp[i][k] + dp[k][j]
                            + (long) w[i] * w[k] * w[j];
                    if (c < dp[i][j]) dp[i][j] = c;
                }
            }
        }
        return dp[0][m - 1];
    }

    public static void main(String[] args) {
        System.out.println(minTriangulation(new int[]{40, 20, 30, 10, 30})); // 26000
    }
}
```

**Python.**
```python
import math


def min_triangulation(w):
    m = len(w)
    dp = [[0] * m for _ in range(m)]
    for gap in range(2, m):
        for i in range(m - gap):
            j = i + gap
            dp[i][j] = math.inf
            for k in range(i + 1, j):
                c = dp[i][k] + dp[k][j] + w[i] * w[k] * w[j]
                if c < dp[i][j]:
                    dp[i][j] = c
    return dp[0][m - 1]


if __name__ == "__main__":
    print(min_triangulation([40, 20, 30, 10, 30]))  # 26000
```

---

### Challenge 4: Top-Down Memoized MCM

**Problem.** Solve MCM with memoized recursion (top-down) instead of the bottom-up table. Return the minimum cost.

**Example.**
```text
p = [40, 20, 30, 10, 30]  ->  26000
```

**Optimal.** Memoized recursion, `O(n³)`.

**Go.**
```go
package main

import "fmt"

var p []int
var memo [][]int64
var done [][]bool

func solve(i, j int) int64 {
	if i == j {
		return 0
	}
	if done[i][j] {
		return memo[i][j]
	}
	best := int64(-1)
	for k := i; k < j; k++ {
		c := solve(i, k) + solve(k+1, j) +
			int64(p[i-1])*int64(p[k])*int64(p[j])
		if best < 0 || c < best {
			best = c
		}
	}
	memo[i][j] = best
	done[i][j] = true
	return best
}

func main() {
	p = []int{40, 20, 30, 10, 30}
	n := len(p) - 1
	memo = make([][]int64, n+1)
	done = make([][]bool, n+1)
	for i := range memo {
		memo[i] = make([]int64, n+1)
		done[i] = make([]bool, n+1)
	}
	fmt.Println(solve(1, n)) // 26000
}
```

**Java.**
```java
public class MemoMCM {
    static int[] p;
    static long[][] memo;
    static boolean[][] done;

    static long solve(int i, int j) {
        if (i == j) return 0;
        if (done[i][j]) return memo[i][j];
        long best = -1;
        for (int k = i; k < j; k++) {
            long c = solve(i, k) + solve(k + 1, j)
                    + (long) p[i - 1] * p[k] * p[j];
            if (best < 0 || c < best) best = c;
        }
        memo[i][j] = best;
        done[i][j] = true;
        return best;
    }

    public static void main(String[] args) {
        p = new int[]{40, 20, 30, 10, 30};
        int n = p.length - 1;
        memo = new long[n + 1][n + 1];
        done = new boolean[n + 1][n + 1];
        System.out.println(solve(1, n)); // 26000
    }
}
```

**Python.**
```python
import functools


def min_cost_memo(p):
    n = len(p) - 1

    @functools.lru_cache(maxsize=None)
    def solve(i, j):
        if i == j:
            return 0
        return min(solve(i, k) + solve(k + 1, j) + p[i - 1] * p[k] * p[j]
                   for k in range(i, j))

    return solve(1, n)


if __name__ == "__main__":
    print(min_cost_memo([40, 20, 30, 10, 30]))  # 26000
```

---

## Final Tips

- Lead with the one-liner: *"The last multiply splits the chain at `k`, so `dp[i][j] = min_k dp[i][k] + dp[k+1][j] + p[i-1]·p[k]·p[j]`, filled by increasing chain length, `O(n³)`."*
- Immediately flag the two gotchas: **dimension indexing** (`p[i-1]·p[k]·p[j]`) and **fill by chain length** (not `i, j` directly).
- If asked to print the grouping, reach for the **split table** and the `O(n)` DFS reconstruction.
- Know the **polygon-triangulation equivalence** and that **Hu-Shing** gives `O(n log n)` while the generic **Knuth** `O(n²)` does *not* apply (split-dependent cost).
- Always offer to verify against a brute-force oracle and a replay check on small inputs.
