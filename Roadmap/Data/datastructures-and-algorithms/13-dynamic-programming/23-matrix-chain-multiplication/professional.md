# Matrix Chain Multiplication — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Cost of a Parenthesization
3. Optimal Substructure (Proof)
4. Correctness of the Recurrence
5. Complexity of the Bottom-Up DP
6. Counting Parenthesizations: The Catalan Numbers
7. The Polygon-Triangulation Equivalence
7.5. A Fully Worked DP Table with Proof Annotations
8. The Quadrangle Inequality and Knuth's Optimization
9. Hu-Shing: Optimal Triangulation in O(n log n)
10. Lower Bounds and the Limits of the DP
10.5. The Commutative Jump in Detail
11. Generalizations
12. The Recurrence as a Pseudocode Invariant
13. Summary

---

## 1. Formal Definitions

Let `A₁, A₂, …, Aₙ` be a chain of matrices that are *conformable* for multiplication in order: `Aᵢ` has dimensions `p[i-1] × p[i]` for a fixed **dimension array** `p[0..n] ∈ ℤ₊^{n+1}`. The product `A₁ A₂ ⋯ Aₙ` is well-defined and has shape `p[0] × p[n]`.

This document establishes, with proofs, why the interval-DP recurrence is correct (optimal substructure), why it costs `Θ(n³)`, why brute force is infeasible (Catalan growth), how MCM relates to convex-polygon triangulation, why the generic Knuth `O(n²)` speedup does *not* apply, how Hu-Shing nonetheless reaches `O(n log n)`, and where the problem sits in the broader complexity landscape. Each claim is a numbered result with a proof or proof sketch, so the file doubles as a reference and a self-contained derivation from first principles.

**Definition 1.1 (Parenthesization).** A **full parenthesization** of the chain is either a single matrix `Aᵢ`, or a product `(P · Q)` of two full parenthesizations `P` (over a contiguous prefix sub-chain) and `Q` (over the complementary contiguous suffix sub-chain). Formally it is a full binary tree with `n` leaves labeled `A₁, …, Aₙ` left-to-right; each internal node is a multiply.

**Definition 1.2 (Conformability invariant).** Because matrix multiply requires matching inner dimensions and is associative, *every* full parenthesization of a conformable chain is itself conformable and yields the identical `p[0] × p[n]` result matrix. Order affects only the *work*, never the *result*.

**Definition 1.3 (Scalar-multiplication cost).** Multiplying a `p × q` matrix by a `q × r` matrix with the standard (schoolbook) algorithm performs exactly `p·q·r` scalar multiplications and yields a `p × r` matrix.

**Definition 1.4 (Subproblem `dp[i][j]`).** For `1 ≤ i ≤ j ≤ n`, let `m[i][j]` (written `dp[i][j]`) be the minimum number of scalar multiplications over all full parenthesizations of `Aᵢ ⋯ Aⱼ`. The target is `dp[1][n]`.

**Notation conventions.** Throughout, `n` is the number of matrices, `p[0..n]` the dimension array, `[i, j]` a contiguous sub-chain, `k ∈ [i, j-1]` a split point, and `C_m` the `m`-th Catalan number. The shape of the sub-product `Aᵢ⋯Aⱼ` is always `p[i-1] × p[j]`, a fact used repeatedly. "Parenthesization" and "full binary tree on the leaves" are interchangeable.

**Definition 1.5 (The objective, formally).** The problem `MCM` is: given `p[0..n] ∈ ℤ₊^{n+1}`, output

```
OPT(p) = min over full parenthesizations T of A₁⋯Aₙ of cost(T),
```

together with (optionally) a minimizer `T*`. The decision version "is `OPT(p) ≤ B`?" is in `P` (the DP decides it in polynomial time), distinguishing MCM sharply from the NP-hard commutative generalizations of Section 10.

**Definition 1.6 (Full binary tree correspondence).** A full parenthesization of `n` matrices is a *full* binary tree (every internal node has exactly two children) with `n` ordered leaves. Such trees number `C_{n-1}` (Section 6), have exactly `n - 1` internal nodes, and `n - 1` is therefore the invariant number of pairwise multiplies — independent of the tree's shape. This correspondence is the combinatorial backbone of the whole analysis: counting (Section 6), optimal substructure (Section 3), and the triangulation isomorphism (Section 7) all phrase facts about parenthesizations as facts about these trees.

---

## 2. The Cost of a Parenthesization

Fix a full parenthesization `T` of `Aᵢ ⋯ Aⱼ`. Its **total cost** `cost(T)` is the sum of `p·q·r` over all internal nodes (multiplies). We make the shape claim explicit.

**Lemma 2.1 (Sub-product shape).** Any full parenthesization of `Aᵢ ⋯ Aⱼ` produces a matrix of shape `p[i-1] × p[j]`, independent of the parenthesization.

**Proof.** Induction on `j - i`. Base `i = j`: `Aᵢ` is `p[i-1] × p[i] = p[i-1] × p[j]`. Step: the root of `T` splits at some `k`, with left subtree over `Aᵢ⋯A_k` (shape `p[i-1] × p[k]` by IH) and right subtree over `A_{k+1}⋯Aⱼ` (shape `p[k] × p[j]` by IH). Their inner dimensions match (`p[k]`), so the product is conformable and has shape `p[i-1] × p[j]`. ∎

**Corollary 2.2 (Cost decomposition).** If `T` splits at `k`, then

```
cost(T) = cost(T_left) + cost(T_right) + p[i-1]·p[k]·p[j],
```

where `T_left`, `T_right` are the subtrees and the last term is the root multiply of a `p[i-1]×p[k]` by a `p[k]×p[j]` matrix (Lemma 2.1). This additive decomposition is the entire basis for the DP.

**Proof.** The total scalar-multiplication count of `T` is the sum of `p·q·r` over all its internal nodes. Partition the internal nodes of `T` into three groups: those entirely within the left subtree, those entirely within the right subtree, and the single root. The first group sums to `cost(T_left)`, the second to `cost(T_right)`, and the root contributes `p[i-1]·p[k]·p[j]` by Lemma 2.1 (the left subtree yields a `p[i-1]×p[k]` matrix, the right a `p[k]×p[j]` matrix). Since these three groups are disjoint and exhaust the internal nodes, their costs add. ∎

**Remark 2.3 (Worked decomposition).** For `((A₁(A₂A₃))A₄)` on `p = [40,20,30,10,30]`, the internal nodes are: `(A₂A₃)` costing `20·30·10 = 6000`, `(A₁(A₂A₃))` costing `40·20·10 = 8000`, and the root `(…A₄)` costing `40·10·30 = 12000`. Their sum `6000 + 8000 + 12000 = 26000` is exactly `dp[1][4]`, illustrating Corollary 2.2 with the root split at `k = 3`.

**Remark 2.4 (Order-invariant result, order-variant work).** Two parenthesizations of the same chain produce the identical `p[0] × p[n]` matrix (Lemma 2.1 at `i=1, j=n`) but may have different `cost` (Corollary 2.2 with different splits). This separation — invariant *result*, variant *work* — is precisely what makes MCM a pure optimization with no correctness consequence to the chosen order, unlike problems where the order changes the output and "optimizing the order" is therefore not free.

---

## 3. Optimal Substructure (Proof)

**Theorem 3.1 (Optimal substructure).** Let `T*` be an optimal (minimum-cost) parenthesization of `Aᵢ ⋯ Aⱼ` splitting at `k*`. Then its left subtree is an optimal parenthesization of `Aᵢ ⋯ A_{k*}` and its right subtree is an optimal parenthesization of `A_{k*+1} ⋯ Aⱼ`.

**Proof (cut-and-paste exchange argument).** Suppose, for contradiction, the left subtree `T_left` of `T*` is *not* optimal for `Aᵢ ⋯ A_{k*}`. Then there exists `T_left′` with `cost(T_left′) < cost(T_left)`. By Lemma 2.1, `T_left′` produces the same `p[i-1] × p[k*]` shape, so replacing `T_left` by `T_left′` inside `T*` yields a valid parenthesization `T′` of `Aᵢ⋯Aⱼ` splitting at the same `k*`. By Corollary 2.2,

```
cost(T′) = cost(T_left′) + cost(T_right) + p[i-1]·p[k*]·p[j]
         < cost(T_left)  + cost(T_right) + p[i-1]·p[k*]·p[j] = cost(T*),
```

contradicting optimality of `T*`. The same argument applies to the right subtree. Hence both subtrees are optimal. ∎

This is the defining property that licenses dynamic programming: an optimal solution is composed of optimal solutions to subproblems, so we may solve subproblems once and combine.

**Remark 3.2 (Why the shapes must match for the exchange).** The cut-and-paste argument crucially relies on Lemma 2.1: `T_left′` produces the *same* `p[i-1] × p[k*]` shape as `T_left`, so substituting it leaves the root multiply (and everything in the right subtree) unchanged. If the substitution could change the intermediate shape, the root cost `p[i-1]·p[k*]·p[j]` might change too, and the inequality would not follow. Optimal substructure here is therefore not a generic platitude — it depends on the specific fact that all parenthesizations of a sub-chain share an output shape. In problems lacking this shape-invariance, naive subproblem substitution can be invalid, which is why some superficially similar problems do *not* admit a clean interval DP.

**Remark 3.3 (Independence of subproblems).** A second requirement, often left implicit, is that the left and right subproblems are *independent*: choosing the optimal parenthesization of `[i, k*]` places no constraint on the parenthesization of `[k*+1, j]` (and vice versa), because they operate on disjoint sets of matrices and the only interface is the fixed shared dimension `p[k*]`. This independence is what lets us minimize the two subtree costs *separately* and add them. When subproblems interact (e.g., share a resource budget), the additive recurrence breaks; MCM's subproblems are cleanly independent.

---

## 4. Correctness of the Recurrence

**Theorem 4.1.** For all `1 ≤ i ≤ j ≤ n`,

```
dp[i][i] = 0,
dp[i][j] = min over k ∈ [i, j-1] of ( dp[i][k] + dp[k+1][j] + p[i-1]·p[k]·p[j] )   for i < j.
```

**Proof.** *Base case.* `Aᵢ` alone requires no multiplication, so `dp[i][i] = 0`.

*Recurrence (`i < j`).* Every parenthesization `T` of `Aᵢ⋯Aⱼ` has a root split at some `k ∈ [i, j-1]`; conversely every `k` in that range is the root split of some parenthesization. Partition the set of all parenthesizations by their root split `k`. Among those with root `k`, the minimum cost is (Corollary 2.2 and Theorem 3.1):

```
min over (T with root k) cost(T) = dp[i][k] + dp[k+1][j] + p[i-1]·p[k]·p[j],
```

because the cheapest such `T` uses optimal subtrees, whose costs are `dp[i][k]` and `dp[k+1][j]` by definition. Taking the minimum over all root choices `k`:

```
dp[i][j] = min over k of ( dp[i][k] + dp[k+1][j] + p[i-1]·p[k]·p[j] ).
```

Since the partition by `k` is exhaustive and disjoint (every parenthesization has exactly one root split), the minimum over the union equals the minimum over the per-`k` minima. ∎

**Corollary 4.2 (Reconstruction correctness).** Recording `split[i][j] = argmin_k(...)` and recursively expanding (`split[i][j]` as the root, then recurse on `[i, k]` and `[k+1, j]`) yields a parenthesization whose cost equals `dp[1][n]`. By Theorem 4.1 each recorded split achieves its interval's optimum, and Corollary 2.2 sums these to `dp[1][n]`.

**Proof of Corollary 4.2.** By induction on interval length. For `i = j` the reconstruction emits the leaf `Aᵢ` with cost `0 = dp[i][i]`. For `i < j`, let `k = split[i][j]`. The reconstruction builds `(L · R)` where `L` is the reconstruction of `[i, k]` and `R` of `[k+1, j]`; by IH these have costs `dp[i][k]` and `dp[k+1][j]` respectively. By Corollary 2.2 the total cost is `dp[i][k] + dp[k+1][j] + p[i-1]·p[k]·p[j]`, which equals `dp[i][j]` because `k` was chosen as the argmin (Theorem 4.1). Hence the reconstructed tree's cost equals `dp[1][n]` at the root. ∎

**Remark 4.3 (Uniqueness of cost, non-uniqueness of plan).** The optimal *cost* `dp[1][n]` is unique, but the optimal *parenthesization* may not be: ties in the `min` mean several splits achieve the same cost, so different tie-breaking rules yield different (equally optimal) trees. A deterministic tie-break (e.g., smallest `k`) makes the reconstruction reproducible across implementations — important for cross-language testing (the Go/Java/Python versions must agree). The replay check (sum the reconstructed plan's costs) validates any tie-break: every optimal tree replays to the same `dp[1][n]`.

**Remark 4.4 (Forward vs backward formulation).** The recurrence is stated "top-down" (last multiply first), but it can equivalently be read "first multiply": `Aᵢ⋯Aⱼ` could be built by first computing some adjacent pair and recursing on the shortened chain. These views coincide because the *set* of parenthesizations is the same; the split-at-`k` formulation is preferred because it maps directly to the binary-tree root and gives the clean `dp[i][k] + dp[k+1][j]` decomposition with disjoint, independent subproblems (Remark 3.3).

---

## 5. Complexity of the Bottom-Up DP

**Theorem 5.1 (Time).** Computing all `dp[i][j]` by increasing chain length takes `Θ(n³)` time.

**Proof.** There are `Θ(n²)` subproblems (pairs `i ≤ j`). Subproblem `[i, j]` of length `L = j - i + 1` evaluates `L - 1` split points, each in `O(1)`. The total work is

```
Σ_{L=2}^{n} (n - L + 1)(L - 1) = Σ ... = Θ(n³),
```

since the dominant term is `Σ_L (n)(L) ≈ n · Σ L = Θ(n³)` over the `Θ(n²)` subproblems with average `Θ(n)` splits. ∎

**Theorem 5.2 (Space).** The DP uses `Θ(n²)` space for the `dp` (and optional `split`) tables; reconstruction adds `O(n)`.

**Proof.** The tables are `(n+1)×(n+1)`; only the upper triangle is used, so `Θ(n²)`. Reconstruction recurses to depth `O(n)` and emits `O(n)` symbols. ∎

**Remark (dependency DAG).** The subproblem dependency graph is acyclic: `[i, j]` depends only on strictly shorter intervals. Any topological order (e.g., by length, or the call order of memoized recursion) is a valid fill order, and all yield the same `Θ(n³)`.

**Theorem 5.3 (Exact split count).** The total number of split evaluations performed by the bottom-up DP is exactly

```
Σ_{L=2}^{n} (n - L + 1)(L - 1) = C(n+1, 3) = (n+1)n(n-1)/6.
```

**Proof.** For each chain length `L`, there are `n - L + 1` intervals, each evaluating `L - 1` splits. Summing the product over `L = 2..n` and re-indexing with `m = L - 1` gives `Σ_{m=1}^{n-1} (n - m) m`, a standard sum equal to `(n+1)n(n-1)/6 = C(n+1, 3)`. ∎

**Corollary 5.4 (Exact `n = 4`).** For `n = 4`, the DP performs `C(5,3) = 10` split evaluations. The walkthrough in `junior.md` shows `1 + 1 + 1` (length 2) `+ 2 + 2` (length 3) `+ 3` (length 4) `= 10`, matching exactly. This exact count is a useful unit-test assertion: instrument a counter and check it equals `(n+1)n(n-1)/6`.

**Implication for asymptotics.** Since `C(n+1, 3) = (n+1)n(n-1)/6 = Θ(n³)` and each split is `O(1)`, the leading constant of the DP is `1/6` per split evaluation — small enough that the cubic DP is fast in practice up to `n` in the hundreds, even in interpreted languages. The exact-count formula also lets you predict runtime precisely: doubling `n` multiplies the work by `≈ 8`, a clean cubic scaling that benchmarks should reproduce (a deviation signals a bug or a cache effect, not the algorithm).

**Proposition 5.6 (Space lower bound for the standard DP).** Any algorithm that fills the full `dp` table and reconstructs an optimal parenthesization by the split-table method uses `Ω(n²)` space, because the split table has `Θ(n²)` independently-determined entries (different dimension arrays force different split tables, so the information content is `Θ(n²)`). To break the `Θ(n²)` space barrier one must either recompute splits on demand (trading time, Section 6.6 of `senior.md`) or use an entirely different algorithm such as Hu-Shing (which is `O(n)` space). The `Θ(n²)` figure is thus intrinsic to the *tabulation method*, not to the *problem* — paralleling the `Θ(n³)`-vs-`O(n log n)` time story.

**Remark 5.7 (Anti-diagonal parallelism).** Within one chain length `L`, all `dp[i][i+L-1]` entries are mutually independent (each reads only strictly shorter intervals, already finalized). They form an *anti-diagonal* of the table that can be computed fully in parallel. Across lengths there is a strict dependency, so the parallel depth is `Θ(n)` (one synchronization per length) with `Θ(n²)` total work per length-step — a classic example of a DP with limited but real parallelism, exploited on GPUs for very long chains.

**Remark 5.5 (Memoized recursion does the same work).** Top-down memoization with a `(i, j)` cache solves each of the `Θ(n²)` distinct subproblems exactly once, and the first (uncached) evaluation of `[i, j]` performs its `j - i` split trials. Summing over all subproblems gives the *same* `C(n+1, 3)` split evaluations as the bottom-up version. The two approaches differ only in *traversal order* of the dependency DAG, not in total work — a concrete instance of the general fact that tabulation and memoization are computationally equivalent up to constant factors and stack overhead.

---

## 6. Counting Parenthesizations: The Catalan Numbers

**Theorem 6.1.** The number `P(n)` of distinct full parenthesizations of a chain of `n` matrices is the `(n-1)`-th Catalan number:

```
P(n) = C_{n-1} = (1/n) · C(2n-2, n-1) = (2n-2)! / ( (n-1)! · n! ).
```

**Proof.** `P(1) = 1` (a single matrix). For `n ≥ 2`, condition on the root split `k ∈ [1, n-1]`: the left has `k` matrices and the right has `n - k`, independently parenthesized, giving the recurrence

```
P(n) = Σ_{k=1}^{n-1} P(k) · P(n-k),     P(1) = 1.
```

This is exactly the Catalan recurrence `C_m = Σ_{j=0}^{m-1} C_j C_{m-1-j}` under the shift `P(n) = C_{n-1}`. The closed form follows from the standard generating-function solution of the Catalan recurrence. ∎

**Verification of the recurrence.** The Catalan recurrence `P(n) = Σ_{k=1}^{n-1} P(k)P(n-k)` is itself a counting analog of the cost recurrence (Theorem 4.1): where the cost DP *minimizes* over the split `k`, the counting DP *sums* over it, because the number of parenthesizations with a given root split is the product of the counts on each side (independent choices). This `min ↔ Σ`, `+ ↔ ×` correspondence is the same algebra swap that recurs across DP (and across the semiring view of related topics): the *structure* of the recurrence is fixed by the problem's recursive decomposition, while the *combine operation* is fixed by what is being computed (optimize vs count).

**Corollary 6.2 (Brute force is infeasible).** By the asymptotic `C_m ∼ 4^m / (m^{3/2} √π)`, we have `P(n) = Θ(4ⁿ / n^{3/2})`. Enumerating all parenthesizations is exponential: `P(20) = C_{19} = 1{,}767{,}263{,}190`, already over `10⁹`, and `P(50)` exceeds `10²⁶`. The `Θ(n³)` DP collapses this exponential search to a polynomial one — the precise quantitative reason DP is necessary, not merely convenient.

**Worked count.** For `n = 4`: `P(4) = C_3 = 5`. The five parenthesizations of `A₁A₂A₃A₄` are `((A₁A₂)A₃)A₄`, `(A₁(A₂A₃))A₄`, `(A₁A₂)(A₃A₄)`, `A₁((A₂A₃)A₄)`, `A₁(A₂(A₃A₄))`. The DP examines them implicitly via `C(5,3) = 10` split evaluations rather than enumerating all 5 trees — and the gap explodes as `n` grows (DP `~n³` vs Catalan `~4ⁿ`).

**Growth table.** The contrast between the exponential enumeration and the polynomial DP:

| `n` | `P(n) = C_{n-1}` (parenthesizations) | DP splits `C(n+1,3)` |
|-----|--------------------------------------|----------------------|
| 4 | 5 | 10 |
| 8 | 429 | 84 |
| 12 | 58 786 | 286 |
| 16 | 9 694 845 | 680 |
| 20 | 1 767 263 190 | 1330 |
| 30 | ~3.8 × 10¹⁵ | 4495 |

By `n = 30` the DP does fewer than 5000 operations while brute force faces `~10¹⁵` parenthesizations — the difference between instantaneous and geologically slow. This is the quantitative heart of why MCM *requires* dynamic programming: the problem's solution space is exponential, but its *subproblem* space is only quadratic.

**Asymptotic note.** From `C_m ∼ 4^m/(m^{3/2}√π)`, the ratio of consecutive Catalan numbers `C_m/C_{m-1} → 4`, so each additional matrix roughly *quadruples* the number of parenthesizations. The DP's split count, by contrast, grows polynomially (`~n³/6`). No constant-factor cleverness can rescue brute force; only the structural insight of overlapping subproblems does.

**The Catalan bijections.** Catalan numbers count many isomorphic structures, several directly relevant here:

- Full binary trees with `n` leaves (= parenthesizations of `n` factors).
- Triangulations of a convex `(n+1)`-gon (= MCM via Section 7).
- Balanced parenthesis strings of length `2(n-1)`.
- Monotone lattice paths below the diagonal in an `(n-1)×(n-1)` grid.

That parenthesizations and triangulations are *both* counted by `C_{n-1}` is not a coincidence but the combinatorial shadow of the cost-preserving bijection in Theorem 7.2: the two structures are in explicit one-to-one correspondence, side-by-side with the binary-tree encoding. The DP, in effect, navigates this shared Catalan structure efficiently by reusing sub-tree (sub-triangulation) costs.

---

## 7. The Polygon-Triangulation Equivalence

MCM is **isomorphic** to the minimum-weight triangulation of a convex polygon, a fact that both illuminates the structure and enables the sub-cubic algorithm.

**Construction.** Take a convex polygon `P` with `n+1` vertices `v₀, v₁, …, vₙ` in order, and assign weight `p[m]` to vertex `vₘ`. The polygon side `v_{m-1}v_m` corresponds to matrix `A_m` (which has shape `p[m-1] × p[m]`). The remaining side `v₀vₙ` corresponds to the full product (shape `p[0] × p[n]`).

**Definition 7.1 (Triangulation weight).** Triangulate `P` with `n - 2` non-crossing diagonals into `n - 1` triangles. Assign each triangle `(vₐ, v_b, v_c)` the weight `p[a]·p[b]·p[c]`. The triangulation's total weight is the sum over its triangles.

**Theorem 7.2 (Isomorphism).** There is a bijection between full parenthesizations of `A₁⋯Aₙ` and triangulations of `P`, under which the parenthesization's scalar-multiplication cost equals the triangulation's total weight.

**Proof sketch.** A parenthesization is a full binary tree with `n` leaves (the sides `v₀v₁, …, v_{n-1}vₙ`) and `n-1` internal nodes; a triangulation of an `(n+1)`-gon has `n-1` triangles. Map each internal node (a multiply of sub-product `Aᵢ⋯A_k` with `A_{k+1}⋯Aⱼ`, costing `p[i-1]·p[k]·p[j]`) to the triangle `(v_{i-1}, v_k, v_j)` of weight `p[i-1]·p[k]·p[j]`. The recursive structure of parenthesizations matches the recursive subdivision of the polygon by a "root" diagonal `v_{i-1}vⱼ`; both satisfy the same Catalan recurrence and the same additive cost decomposition (Corollary 2.2 ↔ triangle-weight additivity). The bijection is cost-preserving by construction. ∎

This equivalence is why MCM and "minimum weight triangulation of a convex polygon with weighted vertices" are literally the same problem, and why a faster triangulation algorithm immediately gives a faster MCM algorithm.

**Worked correspondence.** For `p = [40,20,30,10,30]` (`n = 4`), build a pentagon with vertices `v₀..v₄` weighted `40, 20, 30, 10, 30`. The matrix sides are `v₀v₁ (A₁)`, `v₁v₂ (A₂)`, `v₂v₃ (A₃)`, `v₃v₄ (A₄)`, and the "result" side is `v₄v₀`. The optimal parenthesization `((A₁(A₂A₃))A₄)` corresponds to the triangulation with triangles `(v₁,v₂,v₃)` of weight `20·30·10 = 6000`, `(v₀,v₁,v₃)` of weight `40·20·10 = 8000`, and `(v₀,v₃,v₄)` of weight `40·10·30 = 12000` — total `26000`, identical to the matrix-chain optimum. Each triangle is one multiply; the diagonals `v₁v₃` and `v₀v₃` mark the two non-root splits.

**Why the convexity matters.** The bijection holds for the *convex* polygon because a convex polygon's triangulations are in one-to-one correspondence with binary trees on its sides (the Catalan bijection). For a non-convex polygon, some diagonals lie outside the polygon and the triangulation structure changes; minimum-weight triangulation of a *non-convex* polygon is a genuinely different (and generally harder) problem. MCM lives precisely in the clean convex case, where the Catalan structure of parenthesizations and triangulations coincide.

---

## 7.5 A Fully Worked DP Table with Proof Annotations

To anchor the abstract recurrence, here is the complete `dp` and `split` computation for `p = [40, 20, 30, 10, 30]`, with each entry justified by Theorem 4.1.

**Length-2 intervals** (each has a single split, so trivially optimal):

```
dp[1][2] = p[0]·p[1]·p[2] = 40·20·30 = 24000,   split[1][2] = 1
dp[2][3] = p[1]·p[2]·p[3] = 20·30·10 =  6000,   split[2][3] = 2
dp[3][4] = p[2]·p[3]·p[4] = 30·10·30 =  9000,   split[3][4] = 3
```

**Length-3 intervals** (two candidate splits each; we take the min):

```
dp[1][3] = min(
    k=1: dp[1][1]+dp[2][3]+p[0]·p[1]·p[3] = 0+6000+8000  = 14000,   ← min
    k=2: dp[1][2]+dp[3][3]+p[0]·p[2]·p[3] = 24000+0+12000 = 36000
) = 14000,   split[1][3] = 1

dp[2][4] = min(
    k=2: dp[2][2]+dp[3][4]+p[1]·p[2]·p[4] = 0+9000+18000 = 27000,
    k=3: dp[2][3]+dp[4][4]+p[1]·p[3]·p[4] = 6000+0+6000  = 12000    ← min
) = 12000,   split[2][4] = 3
```

**Length-4 interval** (the whole chain; three candidate splits):

```
dp[1][4] = min(
    k=1: dp[1][1]+dp[2][4]+p[0]·p[1]·p[4] = 0+12000+24000  = 36000,
    k=2: dp[1][2]+dp[3][4]+p[0]·p[2]·p[4] = 24000+9000+36000 = 69000,
    k=3: dp[1][3]+dp[4][4]+p[0]·p[3]·p[4] = 14000+0+12000  = 26000   ← min
) = 26000,   split[1][4] = 3
```

**Reconstruction (Corollary 4.2).** `split[1][4]=3 → (·)A₄`; `split[1][3]=1 → A₁(·)`; `split[2][3]=2 → (A₂A₃)`. Composing: `((A₁(A₂A₃))A₄)`. Replay (Remark 4.3): `6000 + 8000 + 12000 = 26000 = dp[1][4]`, confirming the split table agrees with the cost table. Note the worst split at the root (`k=2`, cost `69000`) is `2.65×` the optimum — a vivid quantitative demonstration that the `min` in the recurrence is doing real work, not cosmetic.

---

## 8. The Quadrangle Inequality and Knuth's Optimization

A natural question: can the inner (split) loop be sped up? For a class of interval DPs, **Knuth's optimization** reduces `O(n³)` to `O(n²)` by exploiting monotonicity of optimal split points.

**Definition 8.1 (Quadrangle inequality, QI).** A cost function `w(i, j)` satisfies the QI if for `i ≤ i′ ≤ j ≤ j′`:

```
w(i, j) + w(i′, j′) ≤ w(i′, j) + w(i, j′).
```

**Knuth/Yao theorem (informal).** For a DP of the form `dp[i][j] = w(i,j) + min_{i≤k<j} (dp[i][k] + dp[k+1][j])` where `w` satisfies the QI and is monotone on intervals, the optimal split `K(i,j) = argmin_k` is monotone: `K(i, j-1) ≤ K(i, j) ≤ K(i+1, j)`. Restricting the inner loop to `[K(i,j-1), K(i+1,j)]` gives an amortized `O(n²)` total.

**The subtlety for MCM.** In MCM the additive cost term `p[i-1]·p[k]·p[j]` *depends on the split `k`* and is **not** of the pure `w(i,j)` form Knuth's theorem assumes (where the per-node weight is independent of the split). Therefore the standard Knuth `O(n²)` optimization does **not** apply directly to MCM as stated. This is a frequent misconception. The matrix-chain cost is split-dependent, so monotonicity of the optimal `k` is not guaranteed by the generic QI argument, and naively restricting the split range can produce wrong answers.

**Consequence.** Breaking `O(n³)` for MCM requires the *specialized* structure of the polygon-triangulation formulation (Section 9, Hu-Shing), not the generic Knuth speedup. The OBST problem, by contrast, *does* satisfy the QI in the right form and *does* get Knuth's `O(n²)`. The distinction — same interval-DP skeleton, different applicability of Knuth — is exactly the kind of trap that separates a memorized recipe from real understanding.

**Why OBST qualifies but MCM does not.** In OBST, the recurrence is `dp[i][j] = (Σ_{m=i}^{j} freq[m]) + min_k (dp[i][k-1] + dp[k+1][j])`. The added term `Σ freq[m]` is a function `w(i,j)` of the *interval only* — it does not depend on the split `k`. This is exactly the form Knuth's theorem requires, and the frequency-sum `w` satisfies the QI (it is a "Monge-like" interval sum). Hence the optimal root is monotone and the inner loop shrinks, giving `O(n²)`. In MCM the analogous "added term" is `p[i-1]·p[k]·p[j]`, which contains `p[k]` — a *split-dependent* factor. There is no way to factor it into an interval-only `w(i,j)`, so the QI machinery does not engage. This is not a failure to find the right `w`; it is a structural property of the cost.

**Empirical caution.** One sometimes sees blog posts claiming MCM gets `O(n²)` via "the Knuth optimization" by simply restricting `k ∈ [K(i,j-1), K(i+1,j)]`. This can produce *wrong answers* on adversarial dimension arrays precisely because the monotonicity it assumes is not guaranteed for MCM's split-dependent cost. Always test any claimed speedup against the unrestricted `O(n³)` DP on random inputs; for MCM the safe sub-cubic route is Hu-Shing, not Knuth.

**Definition 8.2 (Monge condition).** A matrix `C` is **Monge** if `C[a][c] + C[b][d] ≤ C[a][d] + C[b][c]` for all `a ≤ b`, `c ≤ d`. The QI is the Monge condition applied to the interval-cost function. Monge structure is the abstract reason a variety of DP and assignment problems admit speedups (SMAWK, divide-and-conquer optimization); recognizing whether a given cost is Monge is the senior skill that decides which optimization, if any, applies.

**Why MCM's cost is not Monge in the needed sense.** For Knuth's speedup the relevant object is the *interval weight* `w(i, j)` that is added once per node. MCM has no such single interval weight: the contribution at a node is `p[i-1]·p[k]·p[j]`, a function of three indices including the split. One can ask whether the *full* `dp` matrix happens to be Monge, but even when it is for specific inputs, it is not guaranteed across all dimension arrays, so the monotonicity of the optimal split cannot be assumed in general. The honest statement is: **the generic Knuth/Yao theorem has no hypothesis that MCM provably satisfies**, so its `O(n²)` is unavailable as a guaranteed-correct shortcut, full stop.

---

## 9. Hu-Shing: Optimal Triangulation in O(n log n)

**Theorem 9.1 (Hu-Shing 1982/1984).** The minimum-weight triangulation of a convex polygon with vertex weights — equivalently, MCM — can be solved in `O(n log n)` time.

**Idea.** Reframe via Section 7. The algorithm processes the polygon by repeatedly identifying the vertex of *minimum weight* and reasoning about the triangles incident to it. A key structural lemma is that in an optimal triangulation, the minimum-weight vertex `v_min` is connected to its two smaller neighbors by triangles in a predictable "fan" pattern; this lets the algorithm peel off forced triangles and merge the polygon around `v_min`, recursing on a smaller polygon. Careful amortization with a stack-based sweep (analogous to computing a one-sided "nearest smaller value" structure) yields `O(n log n)` — and `O(n)` in refined analyses for the core merging once vertices are sorted.

**Why it is rarely implemented.** The fan-decomposition case analysis is intricate and error-prone, and for matrix chains `n` is seldom large enough for `O(n³)` to be a bottleneck. The result's importance is conceptual: it proves the textbook `O(n³)` DP is **not optimal**, and it ties MCM to computational geometry. Production systems overwhelmingly use the simple cubic DP; Hu-Shing matters when `n` reaches the thousands (e.g., very long tensor trains) and the cubic cost dominates.

**Concrete crossover.** A rough operation count clarifies when Hu-Shing pays:

| `n` | DP ops `≈ n³/6` | Hu-Shing ops `≈ c·n log n` (c≈4) | Ratio |
|-----|------------------|-----------------------------------|-------|
| 100 | 1.7 × 10⁵ | ~2 600 | ~64× |
| 500 | 2.1 × 10⁷ | ~18 000 | ~1160× |
| 1000 | 1.7 × 10⁸ | ~40 000 | ~4200× |
| 5000 | 2.1 × 10¹⁰ | ~245 000 | ~85000× |

The asymptotic gap is enormous, but the DP's per-operation cost is a trivial multiply-add with excellent locality, whereas Hu-Shing's per-operation cost includes pointer-chasing and stack management. In practice the crossover where Hu-Shing's wall-clock wins is higher than the raw ratio suggests — typically `n` in the high hundreds to low thousands. Below that, the simpler, cache-friendly cubic DP is faster despite the worse asymptotics, a recurring theme: asymptotic superiority does not guarantee practical superiority at modest `n`.

**Relation to the DP.** Both compute the same optimum (Theorem 7.2 guarantees the triangulation optimum equals the parenthesization optimum). Hu-Shing is a different *algorithm* for the same *problem*, exploiting geometry the DP ignores.

**The fan lemma, informally.** The structural engine of Hu-Shing is a claim about the global minimum-weight vertex `v_min`. In an optimal triangulation, `v_min` is joined to a contiguous "fan" of vertices, and the two triangles adjacent to `v_min`'s polygon sides are forced. Intuitively, routing multiplies through the smallest dimension is cheap (the `p[k]` factor is minimized), so the optimum greedily exploits `v_min`. Formalizing exactly which fan is optimal requires comparing the weights of competing local configurations, and the bookkeeping to do this across the whole polygon in near-linear time is what makes the algorithm subtle. The payoff is that after fixing `v_min`'s incident triangles, the polygon decomposes into independent sub-polygons handled recursively, and a stack-based sweep (resembling the computation of nearest-smaller-values) achieves the `O(n log n)` bound.

**Practical verdict.** Implement the `O(n³)` DP. Cite Hu-Shing to demonstrate the cubic bound is not intrinsic and to connect MCM to computational geometry. Implement Hu-Shing itself only under genuine large-`n` pressure with profiling evidence, and validate it exhaustively against the DP — its case analysis is a notorious source of subtle bugs, and a wrong "fast" algorithm is worse than a correct slow one.

---

## 10. Lower Bounds and the Limits of the DP

**Information-theoretic floor.** Any algorithm must read the `n+1` dimensions, so `Ω(n)` is a trivial lower bound. Hu-Shing's `O(n log n)` is within a logarithmic factor of this, and is the best known exact bound for the literal chain.

**The DP is not optimal.** Theorem 5.1 gives `Θ(n³)` for the *standard* DP, but Section 9 shows the *problem* admits `O(n log n)`. So the cubic complexity is a property of the algorithm, not the problem. This is unusual among textbook DPs (many are optimal for their problem) and is worth internalizing: "DP gives `O(n³)`" is a statement about one method, not a hardness result.

**A spectrum of interval-DP complexities.** It is instructive to place MCM against its interval-DP siblings to see how the cost structure dictates the achievable complexity:

| Problem | Cost structure | Best known | Speedup mechanism |
|---------|----------------|-----------|-------------------|
| Matrix chain | split-dependent product `p[i-1]·p[k]·p[j]` | `O(n log n)` | Hu-Shing triangulation (geometric) |
| Optimal BST | interval-only weight `Σ freq` (Monge) | `O(n²)` | Knuth/Yao QI monotonicity |
| Min-cost polygon triangulation (convex, vertex-product) | = MCM | `O(n log n)` | same as MCM (isomorphic) |
| Generic interval DP, Monge cost | `w(i,j)` Monge, split-independent | `O(n²)` | Knuth, or D&C optimization |
| Generic interval DP, arbitrary cost | none | `O(n³)` | none known |

The pattern: **interval-only Monge costs unlock `O(n²)` via Knuth; split-dependent costs do not, and require problem-specific structure (geometry, in MCM's case) to break `O(n³)`.** MCM is the textbook example where the obvious DP is cubic, the generic speedup fails, and a clever reformulation still wins — a richer lesson than the many DPs where the first recurrence is already optimal.

**Overflow as a complexity caveat.** Theorem 5.1's `O(1)` per split assumes arithmetic on machine words. For very long chains with large dimensions, `dp[1][n]` can grow large: each multiply contributes up to `max(p)³`, and there are `n-1` of them, so the optimum can reach `Θ(n · max(p)³)`. This fits comfortably in `int64` for realistic inputs but is worth bounding when `n` and dimensions are both large — past `int64`, each arithmetic operation becomes `O(word-length)` and the `O(n³)` bound acquires a hidden bignum factor. For exact MCM this is rarely an issue (the cost is a count, not astronomically large like Catalan), but the analysis should acknowledge the machine-word assumption.

**Generalization hardness.** While the linear chain is near-linear-time solvable, natural generalizations are hard:

| Problem | Complexity |
|---------|-----------|
| Matrix chain (contiguous, non-commutative) | `O(n log n)` exact (Hu-Shing); `O(n³)` simple DP |
| Minimum-weight triangulation of an *arbitrary* (non-convex weighted) polygon | depends on weights; convex case = MCM |
| Optimal join order with commutativity (bushy plans) | NP-hard in general; `O(3ⁿ)` subset DP |
| General tensor-network contraction order | NP-hard |

The jump from polynomial (chain) to NP-hard (commutative joins, general tensor networks) is driven by the *enlarged plan space*: contiguity restricts parenthesizations to Catalan-many trees solvable by interval DP, whereas commutativity admits exponentially more combinations requiring subset DP.

---

## 10.5 The Commutative Jump in Detail

The transition from polynomial (matrix chain) to NP-hard (commutative join ordering) deserves a precise treatment, because it explains exactly *which* structural feature buys tractability.

**Non-commutative (matrix chain).** The operands have a fixed linear order; only *contiguous* sub-chains may be combined. The set of valid groupings is therefore the set of full binary trees whose leaves are `A₁, …, Aₙ` *in order* — there are `C_{n-1}` of them (Section 6). The DP exploits that a contiguous interval `[i, j]` is described by just two indices, giving `Θ(n²)` subproblems.

**Commutative (joins, addition).** When the operation also commutes, *any* subset of operands may be combined, in any order, including non-contiguous ones (a "bushy" plan). The relevant subproblem is now "the optimal cost to combine an arbitrary subset `S ⊆ {1, …, n}`", of which there are `2ⁿ`. The DP over subsets (Selinger / DPccp) considers, for each subset `S`, every way to split it into two non-empty sub-subsets `S₁ ⊎ S₂`, costing `Σ_S 2^{|S|}` ≈ `3ⁿ` total work.

**The precise complexity boundary.**

| Property | Subproblem space | Subproblems | Standard DP |
|----------|------------------|-------------|-------------|
| Associative only (contiguous) | intervals `[i,j]` | `Θ(n²)` | `O(n³)` interval DP |
| Associative + commutative | subsets `S` | `Θ(2ⁿ)` | `O(3ⁿ)` subset DP |
| + arbitrary join graph / cross products | connected subgraphs | exponential | NP-hard in general |

The single feature that collapses `2ⁿ` subsets down to `n²` intervals is **the fixed linear order forced by non-commutativity**. Matrix multiplication is non-commutative (`AB ≠ BA` in general), so the order is fixed, and MCM enjoys the cheap interval DP. Recognizing this is the most consequential modeling judgment: applying the `O(n³)` interval DP to a commutative problem silently restricts the search to left-to-right contiguous plans and misses the bushy optimum.

**DPccp refinement.** Moerkotte's DPccp enumerates only *connected* subset pairs (csg-cmp-pairs) of the join graph, avoiding cross products, and is provably optimal in the number of pairs it enumerates for the bushy plan space. It is the production-grade descendant of Selinger's algorithm and the practical answer for join ordering up to ~15–20 relations; beyond that, heuristics take over. The conceptual lineage — interval DP → subset DP → connected-subset DP → heuristics — all traces back to the same "combine sub-results, minimize over the split" idea that MCM introduces in its simplest form.

---

## 11. Generalizations

**Optimal binary search tree (OBST).** Same interval-DP shape, cost `= Σ frequencies + dp[i][k] + dp[k+1][j]`; satisfies the QI, so Knuth's `O(n²)` applies (unlike MCM).

The structural comparison is illuminating. Both MCM and OBST are interval DPs of the form `dp[i][j] = (extra term) + min_k (dp[i][k'] + dp[k''][j])`. The decisive difference is the *extra term*:

```
MCM:   extra = p[i-1] · p[k] · p[j]      (depends on the split k)
OBST:  extra = Σ_{m=i}^{j} freq[m]       (depends only on the interval [i,j])
```

Because OBST's extra term is split-independent and forms a Monge/QI-satisfying interval function, the optimal root is monotone in the interval endpoints, and the inner `min` over `k` collapses from `O(n)` amortized to `O(1)` amortized — yielding `O(n²)`. MCM's split-dependent `p[k]` blocks this collapse. The two problems are *syntactically* near-identical interval DPs whose *complexity* diverges (`O(n²)` vs `O(n³)` for the simple algorithm) solely because of where the variable `k` appears in the cost. This is perhaps the cleanest illustration in all of algorithm design that "the recurrence shape" is not the whole story — the *cost's dependence on the split* determines which optimizations are available.

**Polygon triangulation with general weights.** Section 7's construction with arbitrary triangle-weight functions; the convex vertex-weight-product case is MCM. If the triangle weight is instead the *perimeter* or *area* of the triangle (geometric minimum-weight triangulation), the problem is different and, for general point sets, was a long-standing open problem only resolved as NP-hard (Mulzer-Rote, 2006) — a reminder that the *form* of the triangle weight, not just the triangulation structure, determines tractability. MCM's product weight `p[a]·p[b]·p[c]` is the benign case.

**Counting parenthesizations under constraints.** A variant asks not for the cheapest grouping but to *count* groupings satisfying a property (e.g., balanced, or evaluating to a target). The interval DP carries a count (or a count-vector) per cell instead of a min cost, summing over splits rather than minimizing. The Boolean-parenthesization problem (above) and counting balanced trees both fit this mold; they share MCM's `Θ(n²)` states and `Θ(n³)` transitions but a different per-cell algebra.

**Boolean parenthesization / expression evaluation.** Count or optimize parenthesizations of an associative (and possibly non-commutative) operator chain; the same `min/max/count over split k` interval DP applies, varying the combine semantics. Here the DP state at `[i,j]` is not a single scalar but a small tuple (e.g., the number of parenthesizations evaluating to True and to False), and the combine rule at split `k` follows the operator's truth table. The fill-by-length skeleton is unchanged; only the per-cell value type and the combine function differ — a direct illustration that the interval-DP pattern is parameterized by a "semiring-like" combine, much as matrix-power topics are parameterized by a semiring.

**Minimum-cost binary merge / Huffman-adjacency.** When combining is *commutative* and the cost depends only on the two combined sizes (e.g., optimal merge of sorted files where merging sizes `a, b` costs `a + b`), the contiguity restriction lifts and the problem becomes a Huffman-style greedy, *not* an interval DP. This boundary — contiguous non-commutative → interval DP; commutative size-additive → greedy; commutative general → subset DP/NP-hard — is the taxonomy a senior engineer uses to pick the right algorithm, and MCM sits at the contiguous-non-commutative corner.

**Tensor contraction (tree/graph).** The chain generalizes to a network; the linear case is MCM, the general case NP-hard (Section 10).

**Min-max (peak-memory) objective.** Replace the additive `min-sum` recurrence with `min over k of max(dp[i][k], dp[k+1][j], size of result)`; optimizes the largest intermediate rather than total work — a different optimum, relevant for memory-bound execution (developed in `senior.md`).

**Theorem 11.1 (Min-max correctness).** Define `peak[i][j]` as the minimum over all parenthesizations of the maximum intermediate-matrix size produced. Then `peak[i][i] = 0` and `peak[i][j] = min_k max(peak[i][k], peak[k+1][j], p[i-1]·p[j])`, where `p[i-1]·p[j]` is the size of the sub-product `[i,j]`'s result.

**Proof.** Any parenthesization with root split `k` produces three relevant peaks: the largest intermediate in the left subtree (`peak` of `[i,k]` for an optimal left), the largest in the right subtree, and the result of *this* node (size `p[i-1]·p[j]`, fixed by Lemma 2.1). The overall peak is the maximum of these three. Optimal substructure holds because minimizing each subtree's peak independently cannot be improved by a costlier subtree (max is monotone). Minimizing over `k` gives the recurrence. ∎

**Why the two optima differ.** Min-sum and min-max optimize fundamentally different functionals (a sum vs a bottleneck), so their argmins need not coincide. A plan that minimizes total FLOPs may pass through one enormous intermediate; a min-max plan may do slightly more total work to keep every intermediate small. This is the formal underpinning of the senior-level observation that on memory-bound hardware the "optimal" order depends on which objective binds.

**Tree contraction (non-chain).** When the operands form a tree rather than a chain (associative reduction over a tree-structured expression), the interval DP generalizes to a tree DP; when they form a general graph (tensor network), the contraction-order problem is NP-hard (Section 10). The linear chain is the unique tractable-by-simple-DP case, which is exactly why MCM is the canonical teaching example.

**Weighted-interval scheduling is *not* this family.** A common confusion: "weighted interval scheduling" and similar 1-D interval problems are *linear* DPs (`dp[i]` over a single index), fundamentally different from MCM's 2-D interval DP (`dp[i][j]` over a range). MCM's defining feature is that the subproblem is a *contiguous range* combined via an internal split point, producing the `Θ(n²)` states and the cubic transition. Problems whose subproblem is a *prefix* (one index) are simpler `O(n)`–`O(n²)` DPs and do not belong to the matrix-chain / interval-DP family. Correctly classifying a problem as "range with a split" vs "prefix with a choice" is the first step in choosing the recurrence shape.

---

## 12. The Recurrence as a Pseudocode Invariant

To make the proofs concrete, here is the bottom-up algorithm annotated with the loop invariant it maintains.

```
MATRIX-CHAIN-ORDER(p[0..n]):
    n = length(p) - 1
    for i = 1 to n:
        dp[i][i] = 0                       # INV-BASE: leaves cost 0
    for L = 2 to n:                        # chain length
        for i = 1 to n - L + 1:
            j = i + L - 1
            dp[i][j] = +infinity
            for k = i to j - 1:            # try each split
                q = dp[i][k] + dp[k+1][j] + p[i-1]*p[k]*p[j]
                if q < dp[i][j]:
                    dp[i][j] = q
                    split[i][j] = k
    return dp[1][n], split
```

**Loop invariant (INV-L).** *At the start of iteration `L` of the outer loop, `dp[a][b]` holds the optimal cost for every interval `[a,b]` with `b - a + 1 < L`.*

**Maintenance.** INV-L holds initially (`L = 2`) because the base loop set all length-1 intervals optimally (INV-BASE) and there are no shorter intervals. Assume INV-L for some `L`. During iteration `L`, each computed `dp[i][j]` (length exactly `L`) reads only `dp[i][k]` and `dp[k+1][j]`, both of length `< L`, which are optimal by INV-L; by Theorem 4.1 the computed value is optimal for `[i,j]`. Hence at the start of iteration `L+1` all intervals of length `≤ L` are optimal, re-establishing the invariant. **Termination.** After the loop, all intervals up to length `n` are optimal, so `dp[1][n]` is the answer. This invariant argument is the formal version of "fill shortest intervals first", and is the proof obligation any alternative fill order must also satisfy.

**Why a wrong fill order fails the invariant.** If one loops `for i: for j: for k`, then computing `dp[1][n]` reads `dp[2][n]` (length `n-1`) which has not yet been computed — INV-L is violated, and `dp[1][n]` is built from a stale/zero value. The bug is silent (no crash, just a wrong number), which is exactly why the invariant must be respected and why the brute-force oracle is indispensable for catching such errors.

**Equivalence of memoized order.** Memoized recursion computes `solve(i, j)` by recursing into `solve(i, k)` and `solve(k+1, j)` before combining, so by structural induction every recursive call returns only after its strictly-shorter children have returned optimal values. This is the same dependency order as INV-L, traversed depth-first instead of breadth-first by length. Both satisfy the invariant; neither reads an uncomputed interval.

---

## 13. Summary

- **Cost decomposition (Corollary 2.2).** A parenthesization splitting at `k` costs `cost(left) + cost(right) + p[i-1]·p[k]·p[j]`; every sub-product of `Aᵢ⋯Aⱼ` has shape `p[i-1] × p[j]` regardless of order (Lemma 2.1).
- **Optimal substructure (Theorem 3.1).** Proven by cut-and-paste: an optimal tree's subtrees are optimal for their sub-chains, since swapping in a cheaper subtree (same shape) would lower the total.
- **Recurrence correctness (Theorem 4.1).** Partition parenthesizations by root split `k`; the minimum over the exhaustive disjoint partition is the recurrence. Recording the argmin reconstructs the optimal grouping (Corollary 4.2).
- **Complexity (Theorems 5.1–5.2).** `Θ(n³)` time, `Θ(n²)` space for the standard DP, over a DAG of `Θ(n²)` subproblems each with `Θ(n)` splits.
- **Catalan count (Theorem 6.1).** Parenthesizations number `C_{n-1} = Θ(4ⁿ/n^{3/2})`; brute force is infeasible (`P(20) > 10⁹`), the precise reason DP is required.
- **Polygon equivalence (Theorem 7.2).** MCM ≅ minimum-weight triangulation of a convex weighted polygon; a cost-preserving bijection between parenthesizations (binary trees) and triangulations.
- **Knuth caveat (Section 8).** The generic quadrangle-inequality `O(n²)` speedup does **not** apply to MCM because the cost term is split-dependent; OBST does qualify. Breaking `O(n³)` needs the geometric structure.
- **Hu-Shing (Theorem 9.1).** `O(n log n)` exact via fan decomposition of the triangulation — proof that the cubic DP is not optimal for the *problem*, only for that *method*.
- **Limits (Section 10).** Trivial `Ω(n)` floor; the chain is near-linear, but commutative join ordering and general tensor-network contraction are NP-hard due to the exponentially larger plan space.
- **Pseudocode invariant (Section 12).** The fill-by-length correctness is captured by the loop invariant INV-L; any alternative fill order (including memoized recursion) must satisfy the same dependency invariant, and a violated invariant produces silent wrong answers — the formal reason the brute-force oracle is mandatory.
- **Min-max variant (Theorem 11.1).** Swapping the additive objective for a bottleneck (peak-memory) objective changes the optimum; the recurrence shape persists but the combine operation becomes `max`, again illustrating the structure-vs-combine separation.

### Complexity Cheat Table

| Task | Method | Complexity |
|------|--------|-----------|
| MCM min cost (standard) | interval DP | `O(n³)` time, `O(n²)` space |
| MCM min cost (optimal) | Hu-Shing triangulation | `O(n log n)` |
| Reconstruct parenthesization | walk split table | `O(n)` |
| Count parenthesizations | Catalan | `C_{n-1} = Θ(4ⁿ/n^{3/2})` |
| OBST (QI-satisfying) | Knuth optimization | `O(n²)` |
| Commutative join order (bushy) | subset DP (DPccp) | `O(3ⁿ)`, NP-hard in general |
| Count parenthesizations to target value | interval DP (count algebra) | `O(n³)` states×transitions |
| Min-peak-memory order | min-max interval DP | `O(n³)` |
| General tensor contraction | — | NP-hard |

The vertical span of this table — from near-linear (Hu-Shing) to NP-hard (general contraction) — is unusually wide for a single problem family, and tracking *which structural assumption* moves you between rows (split-dependence, commutativity, objective) is the durable takeaway.

### Proof-Technique Summary

The proofs in this file use a small, reusable toolkit worth extracting:

1. **Structural induction on interval length** — base case (leaves), inductive step (combine optimal sub-intervals). Used in Lemma 2.1, Theorems 4.1, 4.2-style results, and the loop invariant (Section 12).
2. **Cut-and-paste exchange** — assume a sub-solution is suboptimal, substitute a cheaper one of the same shape, derive a contradiction. The canonical proof of optimal substructure (Theorem 3.1).
3. **Disjoint exhaustive partition** — partition all solutions by a defining feature (the root split `k`), minimize within each class, then over classes. The proof of the recurrence (Theorem 4.1) and the Catalan recurrence (Theorem 6.1).
4. **Cost-preserving bijection** — map one problem's solutions to another's, preserving the objective, to transfer algorithms. The polygon-triangulation isomorphism (Theorem 7.2).
5. **Counting via recurrence + generating functions** — set up `P(n) = Σ P(k)P(n-k)` and solve. The parenthesization count (Theorem 6.1).

Mastering these five techniques generalizes far beyond MCM to the entire dynamic-programming and combinatorial-optimization literature.

### Closing Notes

- **Optimal substructure** is the linchpin: the exchange argument (Theorem 3.1) is the template for proving *any* DP recurrence correct.
- **The Catalan blow-up** (Section 6) quantifies exactly why polynomial DP beats exponential enumeration.
- **The triangulation isomorphism** (Section 7) is the bridge to the sub-cubic Hu-Shing algorithm and to computational geometry.
- **The Knuth non-applicability** (Section 8) is the subtle, interview-favorite fact: MCM's split-dependent cost blocks the generic `O(n²)` shortcut, which is why a *specialized* `O(n log n)` algorithm exists rather than a trivial QI speedup.

Foundational references: Cormen-Leiserson-Rivest-Stein, *Introduction to Algorithms*, Ch. 15 (the canonical MCM DP and proof); T. C. Hu and M. T. Shing, "Computation of Matrix Chain Products" Parts I & II (SIAM J. Comput., 1982/1984) for the `O(n log n)` triangulation algorithm; Knuth (1971) and Yao (1980, 1982) for the quadrangle inequality and dynamic-programming speedups; Stanley, *Enumerative Combinatorics*, for Catalan numbers; Selinger et al. (1979) and Moerkotte-Neumann (DPccp, 2006) for the commutative join-ordering generalization. Sibling interval-DP topics: optimal binary search trees and polygon triangulation.

### Annotated Theorem Index

For quick reference, the principal results and their roles:

- **Lemma 2.1** — every parenthesization of `[i,j]` yields shape `p[i-1]×p[j]`. *Foundation for everything; makes `dp[i][j]` a well-defined scalar.*
- **Corollary 2.2** — additive cost decomposition at a split. *The recurrence's right-hand side.*
- **Theorem 3.1** — optimal substructure via cut-and-paste. *Licenses DP.*
- **Theorem 4.1** — the recurrence is correct. *The algorithm's core.*
- **Corollary 4.2** — reconstruction from the split table is correct. *Justifies printing the grouping.*
- **Theorems 5.1–5.3** — `Θ(n³)` time, `Θ(n²)` space, exactly `C(n+1,3)` split evaluations. *Complexity.*
- **Theorem 6.1** — parenthesizations number `C_{n-1}`. *Why brute force is infeasible.*
- **Theorem 7.2** — MCM ≅ convex polygon triangulation. *Bridge to geometry and Hu-Shing.*
- **Section 8** — Knuth's `O(n²)` does NOT apply (split-dependent cost). *The subtle non-result.*
- **Theorem 9.1** — Hu-Shing solves MCM in `O(n log n)`. *The DP is not optimal for the problem.*
- **Theorem 11.1** — min-max (peak-memory) variant correctness. *Objective-dependent optimum.*

This index doubles as a study checklist: understanding each line, in order, reconstructs the full theory from definitions to the sub-cubic frontier.

### The Theory in One Paragraph

MCM minimizes the scalar-multiplication cost over the `C_{n-1}` parenthesizations of a fixed matrix chain. Because every sub-chain has a fixed output shape (Lemma 2.1) and costs decompose additively at the root split (Corollary 2.2), the problem has optimal substructure (Theorem 3.1), yielding the correct recurrence `dp[i][j] = min_k dp[i][k] + dp[k+1][j] + p[i-1]·p[k]·p[j]` (Theorem 4.1), solvable in `Θ(n³)` time and `Θ(n²)` space (Theorems 5.1–5.2) — collapsing the exponential `C_{n-1} = Θ(4ⁿ/n^{1.5})` search (Theorem 6.1). MCM is isomorphic to convex-polygon triangulation (Theorem 7.2); the split-dependent cost blocks the generic Knuth `O(n²)` (Section 8) but the geometric Hu-Shing algorithm reaches `O(n log n)` (Theorem 9.1), proving the cubic DP is non-optimal for the *problem*. Adding commutativity (joins) enlarges the plan space to subsets, making the natural generalization NP-hard (Section 10). That single arc — additive substructure → polynomial DP → geometric speedup → commutative hardness — is the complete conceptual map of the topic.
