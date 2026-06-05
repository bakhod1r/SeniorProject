# SMAWK Algorithm and Monge Matrices — Interview Preparation

SMAWK and Monge matrices are an advanced interview topic that rewards one crisp insight — *"a totally monotone matrix has a non-decreasing staircase of row minima, so you can find all of them in `O(n + m)` instead of `O(n·m)`"* — and then tests whether you can (a) state the Monge / total-monotonicity condition, (b) explain REDUCE and INTERPOLATE and why each is correct, (c) reduce a layered DP to row minima of an implicit Monge matrix, and (d) place SMAWK among its siblings: divide-and-conquer optimization (topic `12`), Knuth optimization (topic `14`), CHT (topic `10`), and the online LARSCH. This file is a tiered question bank with one full coding challenge in Go, Java, and Python.

---

## Quick-Reference Cheat Sheet

| Question | Answer |
|----------|--------|
| What does SMAWK compute? | All row minima of an `n×m` matrix. |
| How fast? | `O(n + m)` — optimal. |
| Precondition? | Matrix is **totally monotone** (Monge ⟹ TM). |
| Monge / QI | `A[i][j] + A[i'][j'] ≤ A[i][j'] + A[i'][j]`, `i<i'`, `j<j'`. |
| Total monotone | `A[i][j'] ≤ A[i][j] ⟹ A[i'][j'] ≤ A[i'][j]`. |
| Key consequence | argmins form a non-decreasing **staircase**. |
| Two steps | **REDUCE** (drop dead columns) + **INTERPOLATE** (recurse even rows, fill odd). |
| Recurrence | `T(n, m) = T(n/2, n) + O(n + m) = O(n + m)`. |
| Simpler cousin | divide-and-conquer optimization, `O((n+m) log n)` (topic `12`). |
| DP payoff | one layer in `O(n)` instead of `O(n²)`. |
| Matrix storage | **implicit** — `O(1)` cost function, never materialized. |
| Online variant | **LARSCH** (online SMAWK), `O(n)` amortized. |
| Failure mode | not totally monotone ⟹ **silent wrong answer**. |

The Monge / quadrangle inequality and its local form:

```text
A[i][j] + A[i'][j']  ≤  A[i][j'] + A[i'][j]        for all i < i', j < j'
local form:  A[i][j] + A[i+1][j+1] ≤ A[i][j+1] + A[i+1][j]
```

SMAWK skeleton:

```text
SMAWK(rows, cols):
    cols = REDUCE(rows, cols)          # ≤ #rows survive, O(#cols)
    if one row: return argmin over cols
    recurse on EVEN rows with cols      # INTERPOLATE part 1
    for each ODD row:                   # INTERPOLATE part 2
        scan only [argmin(prev even), argmin(next even)]
# total: O(n + m)
```

Key facts:
- Monge ⟹ totally monotone ⟹ monotone argmin staircase ⟹ SMAWK correct.
- Break ties toward the **smallest column**.
- Keep entries `O(1)` (prefix sums); the matrix is **implicit**.
- If the matrix is not totally monotone, the answer is **silently wrong**.
- Default to the simpler `O(n log n)` divide-and-conquer; reach for SMAWK when the `log` factor is decisive.

---

## Junior Questions (12 Q&A)

### J1. What problem does SMAWK solve?
Finding the **row minimum of every row** of an `n × m` matrix — for each row, the column where its smallest value sits.

### J2. How fast is SMAWK, and what is the brute force?
Brute force scans every cell: `O(n·m)`. SMAWK is `O(n + m)` — linear in the dimensions, not the area.

### J3. What is the precondition for SMAWK to be correct?
The matrix must be **totally monotone** (equivalently, it suffices that it is Monge). Otherwise SMAWK returns a wrong answer.

### J4. State the Monge condition.
`A[i][j] + A[i'][j'] ≤ A[i][j'] + A[i'][j]` for all `i < i'`, `j < j'`. Nested pairs cost no more than crossing pairs.

### J5. What is total monotonicity?
If an upper row weakly prefers a right column, every lower row does too: `A[i][j'] ≤ A[i][j] ⟹ A[i'][j'] ≤ A[i'][j]` for `i < i'`, `j < j'`.

### J6. What is the "staircase" property?
The column of each row's minimum is **non-decreasing** as the row index grows: `argmin(i) ≤ argmin(i+1)`. The minima never move left going down.

### J7. What are the two steps of SMAWK?
**REDUCE** — discard columns that can't be any row's minimum (leaving `≤ #rows`). **INTERPOLATE** — recurse on even rows, then fill odd rows from their even neighbors.

### J8. What does REDUCE accomplish?
It removes columns that are provably never a row minimum, shrinking the column count to at most the number of rows, in `O(#columns)` via a stack.

### J9. What does INTERPOLATE do for the odd rows?
Each odd row's minimum lies between the minima of its two even neighbors (by the staircase), so a short local scan finds it.

### J10. Why is the matrix usually "implicit"?
A large matrix (e.g. `10^5 × 10^5`) has `10^{10}` cells — too many to store. Instead an `O(1)` cost function computes any entry on demand; SMAWK touches only `O(n + m)` of them.

### J11. How do you break ties among equal entries?
Keep the **smallest column** (strict `<` when comparing). This keeps the argmin staircase non-decreasing.

### J12 (analysis). What happens if the matrix is not totally monotone?
SMAWK prunes columns/rows that may contain the true minimum, so you get a wrong answer — with **no crash**. You must verify total monotonicity before applying it.

---

## Middle Questions (14 Q&A)

### M1. Why does Monge imply totally monotone?
From QI, rearrange `A[i'][j'] − A[i'][j] ≤ A[i][j'] − A[i][j]`. If the upper row prefers `j'` (`A[i][j'] − A[i][j] ≤ 0`), then the lower row does too. So QI ⟹ TM.

### M2. Why does total monotonicity give a non-decreasing argmin?
Suppose `argmin(i) = p` and `argmin(i+1) = q < p`. Since `p` minimizes row `i`, `A[i][p] ≤ A[i][q]`; TM then forces `A[i+1][p] ≤ A[i+1][q]`, so `p` is at least as good as `q` in row `i+1`, contradicting `q` being the *smallest* minimizer. Hence `argmin(i+1) ≥ p`.

### M3. Explain the "dead-column lemma" behind REDUCE.
If column `c'` beats column `c` (`c < c'`) at some row `r`, then by total monotonicity `c'` beats `c` at every row `≥ r`. So `c` can never be a row minimum from row `r` onward — REDUCE discards it.

### M4. How does the REDUCE stack work?
Walk columns left to right; the stack holds incumbents, where position `h` is the incumbent for row `h`. A new column pops the top while it beats the top *at the top's row* (the top is now dead), then is pushed if a row slot remains (`size < #rows`).

### M5. Why does REDUCE leave at most `#rows` columns?
Each surviving column occupies one row slot (it is the incumbent of one row), and we only push while `size < #rows`. So survivors `≤ #rows`.

### M6. Why is INTERPOLATE's odd-row scan cheap overall?
Odd row `2t+1` scans `[argmin(2t), argmin(2t+2)]`; the window lengths telescope (`Σ (p_{2t+2} − p_{2t}) = p_last − p_first ≤ m`), so total odd-row work is `O(n + m)`, not quadratic.

### M7. Write SMAWK's recurrence and solve it.
`T(n, m) = T(n/2, n) + O(n + m)`. REDUCE leaves `≤ n` columns; the recursion halves rows; odd-row fill is `O(n + m)`. Unrolling, `m` appears once and the rest is geometric in `n`: `T = O(n + m)`.

### M8. How do you turn a DP into a row-minima problem?
For `dp[j] = min_{k<j} ( g(k) + cost(k, j) )`, set `A[j][k] = g(k) + cost(k, j)` (`+∞` for `k ≥ j`). Then `dp[j] = rowmin(j)` and the optimal split is `argmin(j)`.

### M9. When is that DP matrix totally monotone?
Exactly when `cost` is Monge: the `g` terms cancel in the QI for `A`, leaving the QI on `cost`. So a Monge cost makes the DP matrix TM, and SMAWK runs the layer in `O(n)`.

### M10. How is SMAWK different from divide-and-conquer optimization (topic 12)?
Both find minima of a totally monotone matrix. Divide-and-conquer resolves the middle row and recurses with narrowed windows: `O(n log n)`, simple. SMAWK uses REDUCE + even-row recursion to remove the `log`: `O(n + m)`, intricate.

### M11. How is it different from Knuth optimization (topic 14)?
Knuth optimizes the *interval* DP `dp[i][k] + dp[k][j] + C` with a *two-sided* argmin bound, `O(n²)`. SMAWK (and divide-and-conquer) optimize the *layered* DP `g(k) + C(k, j)` with a one-sided staircase.

### M12. How is it different from the Convex Hull Trick (topic 10)?
CHT requires the cost to factor into **lines** `dp[k] + a[k]·x[j] + b[k]` and uses a line envelope. SMAWK works for *any* Monge cost (including non-linear convex-of-length costs) but does not get below `O(n + m)` per layer.

### M13. Why must forbidden cells be `+∞`?
The DP matrix is upper-triangular (`k < j` only). Padding `k ≥ j` with `+∞` keeps the matrix totally monotone (an `+∞` entry never wins a minimum) so SMAWK stays correct.

### M14. Why must the cost function be `O(1)`?
SMAWK makes `O(n + m)` entry accesses. An `O(c)` cost makes the layer `O((n+m)·c)`. Prefix sums keep `c = O(1)` so the layer is truly linear.

---

## Senior Questions (12 Q&A)

### S1. When should you choose SMAWK over divide-and-conquer optimization?
Only when the `log n` factor is decisive: `n` enormous, many layers, an expensive cost, or a tight time limit. Otherwise the `O(n log n)` divide-and-conquer is far simpler and less bug-prone — it is the right default.

### S2. How do you verify total monotonicity in production?
Three levels: (1) prove `cost` satisfies the local quadrangle inequality; (2) CI oracle equality — SMAWK vs brute-force `O(n·m)` row minima, entrywise; (3) assert the argmin staircase is non-decreasing. Fuzz negatives/ties because the property is fragile at boundaries.

### S3. The squared cost `(P[j] − P[k])²` is Monge — under what condition?
Only when `P` is non-decreasing (non-negative array entries). The LQI reduces to `(P[a+1]−P[a])(P[c+1]−P[c]) ≥ 0`; negative entries can make `P` non-monotone and break it. Fuzz signed inputs.

### S4. Give a real DP that SMAWK accelerates.
Optimal partition into `K` segments minimizing a Monge per-segment cost; and 1-D k-means (cluster-SSE on sorted points), the optimal `Ckmeans.1d.dp` — both `O(K·n)`.

### S5. Why is cluster-SSE Monge, and why does sorting matter?
SSE on sorted, contiguous clusters satisfies the quadrangle inequality (extending a sorted interval raises SSE by a non-decreasing increment). On unsorted data, index-contiguity ≠ value-contiguity, the cost is not Monge, and the optimal clustering is not a contiguous partition.

### S6. What is the online / 1D/1D problem, and why does offline SMAWK fail?
`dp[j] = min_{k<j} ( dp[k] + w(k, j) )` — the matrix entry references `dp[k]`, not yet known. Offline SMAWK would read undefined entries. You need LARSCH (online SMAWK) or an online-CHT / monotone-pointer scheme.

### S7. What is LARSCH?
The online version of SMAWK (Larmore–Schieber, 1991): it produces row minima in row order, finalizing `dp[j]` before later rows need it, in amortized `O(1)` per row. Used for least-weight subsequence / concave 1D/1D DPs.

### S8. How do you reconstruct the optimal partition?
Store the argmin column (optimal split) at each `(layer, j)` and backtrack from `(K, n)`, following recorded splits. Costs `O(K·n)` extra memory.

### S9. How do you manage memory across layers?
Roll two arrays (`g = dp[i-1]`, write `dp[i]`) for `O(n)` memory; keep the `O(K·n)` argmin table only when reconstruction is required.

### S10. What overflow concerns arise?
Squared/variance costs grow quadratically. Use 64-bit, keep `∞ < MAX/2`, and skip `∞` predecessors before adding so `∞ + cost` never wraps.

### S11. What is the single most valuable test?
Oracle equality on random small inputs (SMAWK vs brute-force row minima, entrywise) — it catches both implementation bugs and non-monotone costs, the otherwise-invisible failures.

### S12. Engineering the implicit-entry hot path?
Prefix sums in contiguous arrays; in Java a primitive interface (`long at(int,int)`) over a boxed `BiFunction`; inline the `∞`/staircase short-circuit; reuse buffers across layers.

---

## Professional Questions (10 Q&A)

### P1. Prove Monge ⟹ totally monotone.
From QI `A[i][j] + A[i'][j'] ≤ A[i][j'] + A[i'][j]`, rearrange to `A[i'][j'] − A[i'][j] ≤ A[i][j'] − A[i][j]`. If `A[i][j'] ≤ A[i][j]` (RHS `≤ 0`), then LHS `≤ 0`, i.e. `A[i'][j'] ≤ A[i'][j]` — the TM conclusion.

### P2. Prove the monotone-argmin staircase from TM.
With `p = argmin(i)` and any `q < p`: `A[i][p] ≤ A[i][q]` (p minimizes row i), so TM forces `A[i+1][p] ≤ A[i+1][q]`. Hence no `q < p` strictly beats `p` in row `i+1`, so `argmin(i+1) ≥ p = argmin(i)`.

### P3. State and prove the dead-column lemma.
If `A[r][c] > A[r][c']` for `c < c'`, then for all rows `r' ≥ r`, `A[r'][c] ≥ A[r'][c']`. Proof: TM with rows `r < r'`, columns `c < c'`, premise `A[r][c'] < A[r][c]` gives `A[r'][c'] ≤ A[r'][c]`. So `c` is never minimal from row `r` on — REDUCE discards it.

### P4. Why does REDUCE preserve all row minima?
A column is popped only when dominated from its row onward (dead-column lemma) and skipped only when it lost to the top incumbent (also dominated onward). No column that is some row's argmin is ever discarded. Each column is pushed/popped once → `O(#cols)`.

### P5. Why is INTERPOLATE correct?
By the staircase, `argmin(2t) ≤ argmin(2t+1) ≤ argmin(2t+2)`, so each odd row's true argmin is in the window between its even neighbors' argmins — scanning that window suffices. The even argmins come from the recursive call (induction).

### P6. Derive SMAWK's `O(n + m)`.
`T(n, m) = T(n/2, n) + O(n + m)`. REDUCE: `O(m)`, `≤ n` survivors. Recurse on `n/2` rows, `≤ n` cols. Odd fill: `O(n + m)` by telescoping. Unroll: `m` once, geometric `n + n/2 + … = O(n)`. Total `O(n + m)`.

### P7. Why is the odd-row work linear, not quadratic?
Window lengths `p_{2t+2} − p_{2t} + 1` telescope: `Σ = (p_last − p_first) + #odd ≤ m + n/2 = O(n + m)`. Consecutive windows share endpoints, so no cell is rescanned across windows beyond the shared boundary.

### P8. Prove the squared-segment-sum cost is Monge.
LQI for `(P[j] − P[k])²` expands (squares cancel) to `(P[a+1] − P[a])(P[c+1] − P[c]) ≥ 0`, true when entries are non-negative (so `P` is non-decreasing). LQI ⟹ QI (telescoping local inequalities over the rectangle).

### P9. State the lower bound and SMAWK's optimality.
Any all-row-minima algorithm is `Ω(n + m)`: it outputs `n` answers and an adversary can hide a minimum among `m` columns. SMAWK's `O(n + m)` matches it — optimal. Divide-and-conquer's `O((n+m) log n)` is a `log` factor above.

### P10. TM vs plain monotonicity — what is the gap and who needs what?
Plain monotonicity: argmins non-decreasing, *without* the closed `2×2` implication. Divide-and-conquer needs only this; SMAWK's REDUCE needs full TM. Monge gives TM, so when the cost is Monge both apply; the gap explains why divide-and-conquer is the more robust default.

### P11. How does SMAWK handle maximization?
For `max` DPs the relevant condition is the **inverse** Monge inequality (`≥` instead of `≤`), which makes the matrix totally monotone *for row maxima*. SMAWK runs unchanged with the comparison reversed and `−∞` as the identity, finding all row maxima in `O(n + m)`. Costs that are concave in segment length are inverse Monge.

### P12. Why must the entry oracle be pure and consistent?
SMAWK may query the same `(i, j)` from different recursion branches. If the oracle returned different values (stateful/randomized), the total-monotonicity reasoning — and hence REDUCE's dead-column lemma — would break. The entry function must be a pure, deterministic function of `(i, j)`.

---

## Behavioral / Communication Prompts

- **B1.** Explain SMAWK to someone who only knows nested loops, in three sentences. *(Lead with the staircase of minima; then REDUCE drops dead columns; then INTERPOLATE recurses on half the rows.)*
- **B2.** A teammate's partition DP "gives a slightly wrong number sometimes." How do you debug? *(Suspect a non-Monge cost or tie-break drift; add the brute-force oracle and the staircase assertion; fuzz negatives.)*
- **B3.** You proposed SMAWK; a reviewer says "just use divide-and-conquer." When do you concede, when do you push back? *(Concede unless `n` is huge / cost expensive / log factor measured to matter; SMAWK's implementation risk usually loses.)*
- **B4.** How would you make a SMAWK implementation maintainable for a team? *(Single convention — row minima, smallest-column ties; an `O(1)` entry interface; CI oracle + staircase test; documented Monge precondition with input validation.)*

---

## Coding Challenge (3 Languages)

### Challenge: Minimum-Cost K-Partition via SMAWK

> Given an array `a` of `n` non-negative integers and an integer `K`, partition `a` into exactly `K` contiguous segments minimizing the sum over segments of `(segment sum)²`. Solve each DP layer with SMAWK (row minima of the implicit Monge matrix `A[j][k] = dp[i-1][k] + (P[j] − P[k])²`). Return the minimum total cost.
>
> Example: `a = [1, 3, 2, 4]`, `K = 2` → split `[1,3] | [2,4]`, cost `4² + 6² = 52`.

#### Go

```go
package main

import "fmt"

const INF = int64(1) << 62

func smawk(rows, cols []int, f func(i, j int) int64, argmin []int) {
	cols = reduce(rows, cols, f)
	if len(rows) == 1 {
		r := rows[0]
		best, bc := f(r, cols[0]), cols[0]
		for _, c := range cols[1:] {
			if v := f(r, c); v < best {
				best, bc = v, c
			}
		}
		argmin[r] = bc
		return
	}
	even := make([]int, 0, (len(rows)+1)/2)
	for i := 0; i < len(rows); i += 2 {
		even = append(even, rows[i])
	}
	smawk(even, cols, f, argmin)
	pos := map[int]int{}
	for idx, c := range cols {
		pos[c] = idx
	}
	for i := 1; i < len(rows); i += 2 {
		r := rows[i]
		lo := pos[argmin[rows[i-1]]]
		hi := len(cols) - 1
		if i+1 < len(rows) {
			hi = pos[argmin[rows[i+1]]]
		}
		best, bc := f(r, cols[lo]), cols[lo]
		for t := lo + 1; t <= hi; t++ {
			if v := f(r, cols[t]); v < best {
				best, bc = v, cols[t]
			}
		}
		argmin[r] = bc
	}
}

func reduce(rows, cols []int, f func(i, j int) int64) []int {
	st := []int{}
	for _, c := range cols {
		for len(st) > 0 {
			i := len(st) - 1
			if f(rows[i], st[i]) <= f(rows[i], c) {
				break
			}
			st = st[:len(st)-1]
		}
		if len(st) < len(rows) {
			st = append(st, c)
		}
	}
	return st
}

func minKPartition(a []int, K int) int64 {
	n := len(a)
	P := make([]int64, n+1)
	for i := 0; i < n; i++ {
		P[i+1] = P[i] + int64(a[i])
	}
	g := make([]int64, n+1)
	for j := range g {
		g[j] = INF
	}
	g[0] = 0
	rows := make([]int, n)
	cols := make([]int, n)
	for i := 0; i < n; i++ {
		rows[i] = i + 1
		cols[i] = i
	}
	argmin := make([]int, n+1)
	for layer := 0; layer < K; layer++ {
		gg := g
		f := func(j, k int) int64 {
			if k >= j || gg[k] >= INF {
				return INF
			}
			s := P[j] - P[k]
			return gg[k] + s*s
		}
		smawk(rows, cols, f, argmin)
		ng := make([]int64, n+1)
		for jj := range ng {
			ng[jj] = INF
		}
		for _, j := range rows {
			ng[j] = f(j, argmin[j])
		}
		g = ng
	}
	return g[n]
}

func main() {
	fmt.Println(minKPartition([]int{1, 3, 2, 4}, 2)) // 52
	fmt.Println(minKPartition([]int{1, 3, 2, 4}, 1)) // 100
	fmt.Println(minKPartition([]int{1, 3, 2, 4}, 4)) // 30
}
```

#### Java

```java
import java.util.*;

public class SmawkChallenge {
    static final long INF = 1L << 62;
    interface Cost { long at(int i, int j); }

    static void smawk(List<Integer> rows, List<Integer> cols, Cost f, int[] argmin) {
        cols = reduce(rows, cols, f);
        if (rows.size() == 1) {
            int r = rows.get(0), bc = cols.get(0);
            long best = f.at(r, bc);
            for (int c : cols) { long v = f.at(r, c); if (v < best) { best = v; bc = c; } }
            argmin[r] = bc;
            return;
        }
        List<Integer> even = new ArrayList<>();
        for (int i = 0; i < rows.size(); i += 2) even.add(rows.get(i));
        smawk(even, cols, f, argmin);
        Map<Integer, Integer> pos = new HashMap<>();
        for (int idx = 0; idx < cols.size(); idx++) pos.put(cols.get(idx), idx);
        for (int i = 1; i < rows.size(); i += 2) {
            int r = rows.get(i);
            int lo = pos.get(argmin[rows.get(i - 1)]);
            int hi = (i + 1 < rows.size()) ? pos.get(argmin[rows.get(i + 1)]) : cols.size() - 1;
            int bc = cols.get(lo);
            long best = f.at(r, bc);
            for (int t = lo + 1; t <= hi; t++) {
                long v = f.at(r, cols.get(t));
                if (v < best) { best = v; bc = cols.get(t); }
            }
            argmin[r] = bc;
        }
    }

    static List<Integer> reduce(List<Integer> rows, List<Integer> cols, Cost f) {
        List<Integer> st = new ArrayList<>();
        for (int c : cols) {
            while (!st.isEmpty()) {
                int i = st.size() - 1;
                if (f.at(rows.get(i), st.get(i)) <= f.at(rows.get(i), c)) break;
                st.remove(st.size() - 1);
            }
            if (st.size() < rows.size()) st.add(c);
        }
        return st;
    }

    static long minKPartition(int[] a, int K) {
        int n = a.length;
        long[] P = new long[n + 1];
        for (int i = 0; i < n; i++) P[i + 1] = P[i] + a[i];
        long[] g = new long[n + 1];
        Arrays.fill(g, INF);
        g[0] = 0;
        List<Integer> rows = new ArrayList<>(), cols = new ArrayList<>();
        for (int i = 0; i < n; i++) { rows.add(i + 1); cols.add(i); }
        int[] argmin = new int[n + 1];
        for (int layer = 0; layer < K; layer++) {
            final long[] gg = g;
            Cost f = (j, k) -> {
                if (k >= j || gg[k] >= INF) return INF;
                long s = P[j] - P[k];
                return gg[k] + s * s;
            };
            smawk(rows, cols, f, argmin);
            long[] ng = new long[n + 1];
            Arrays.fill(ng, INF);
            for (int j : rows) ng[j] = f.at(j, argmin[j]);
            g = ng;
        }
        return g[n];
    }

    public static void main(String[] args) {
        System.out.println(minKPartition(new int[]{1, 3, 2, 4}, 2)); // 52
        System.out.println(minKPartition(new int[]{1, 3, 2, 4}, 1)); // 100
        System.out.println(minKPartition(new int[]{1, 3, 2, 4}, 4)); // 30
    }
}
```

#### Python

```python
import sys

INF = 1 << 62


def smawk(rows, cols, f, argmin):
    cols = reduce_cols(rows, cols, f)
    if len(rows) == 1:
        r = rows[0]
        argmin[r] = min(cols, key=lambda c: f(r, c))
        return
    even = rows[::2]
    smawk(even, cols, f, argmin)
    pos = {c: idx for idx, c in enumerate(cols)}
    for i in range(1, len(rows), 2):
        r = rows[i]
        lo = pos[argmin[rows[i - 1]]]
        hi = pos[argmin[rows[i + 1]]] if i + 1 < len(rows) else len(cols) - 1
        bc = cols[lo]
        best = f(r, bc)
        for t in range(lo + 1, hi + 1):
            v = f(r, cols[t])
            if v < best:
                best, bc = v, cols[t]
        argmin[r] = bc


def reduce_cols(rows, cols, f):
    st = []
    for c in cols:
        while st:
            i = len(st) - 1
            if f(rows[i], st[i]) <= f(rows[i], c):
                break
            st.pop()
        if len(st) < len(rows):
            st.append(c)
    return st


def min_k_partition(a, K):
    n = len(a)
    P = [0] * (n + 1)
    for i in range(n):
        P[i + 1] = P[i] + a[i]
    g = [INF] * (n + 1)
    g[0] = 0
    rows = list(range(1, n + 1))
    cols = list(range(n))
    argmin = [0] * (n + 1)
    for _ in range(K):
        gg = g

        def f(j, k, gg=gg):
            if k >= j or gg[k] >= INF:
                return INF
            s = P[j] - P[k]
            return gg[k] + s * s

        smawk(rows, cols, f, argmin)
        ng = [INF] * (n + 1)
        for j in rows:
            ng[j] = f(j, argmin[j])
        g = ng
    return g[n]


if __name__ == "__main__":
    sys.setrecursionlimit(1 << 20)
    print(min_k_partition([1, 3, 2, 4], 2))  # 52
    print(min_k_partition([1, 3, 2, 4], 1))  # 100
    print(min_k_partition([1, 3, 2, 4], 4))  # 30
```

**Complexity:** `O(K·n)` time (one SMAWK row-minima pass per layer), `O(n)` space (rolled rows). The matrix is implicit via `f(j, k)`.

**Test it:** validate against a brute-force `O(K·n²)` DP on random small inputs and assert the per-layer argmins are non-decreasing.

---

## Final Tips

- Lead with the one-liner: *"A totally monotone matrix has a non-decreasing staircase of row minima, so SMAWK finds all of them in `O(n + m)` via REDUCE (drop dead columns) + INTERPOLATE (recurse even rows, fill odd)."*
- Immediately flag the precondition: **it only works if the matrix is totally monotone**, and the answer is *silently wrong* otherwise.
- State the Monge inequality and note Monge ⟹ totally monotone ⟹ monotone argmin.
- Distinguish the siblings: **divide-and-conquer** (`O(n log n)`, simpler, topic 12), **Knuth** (interval DP, topic 14), **CHT** (linear cost, topic 10), **LARSCH** (online).
- Be honest about engineering: SMAWK is intricate; reach for divide-and-conquer unless the `log` factor is measured to matter.
- Remember the details: implicit `O(1)` cost, `∞`-padded staircase, smallest-column tie-break, 64-bit overflow discipline, and a brute-force oracle in CI.
