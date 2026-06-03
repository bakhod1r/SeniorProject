# Interval DP — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. Optimal Substructure for Intervals (Proof)
3. Why Increasing-Length Order Is Valid
4. The General Interval-DP Recurrence and Its Complexity
5. Matrix Chain Multiplication: Correctness
6. Optimal Binary Search Tree: Correctness
7. The Last-Operated-Element Decomposition (Burst Balloons)
8. The Quadrangle Inequality and Knuth's Optimization
9. Monotonicity of the Optimal Split Point (Proof)
10. Divide-and-Conquer Optimization: The Sibling Condition
11. Counting Subproblems and Lower-Bound Intuition
12. Worked QI Verification and Knuth Trace
13. Palindrome Partitioning: Formal Treatment
14. The Stone Game as a Min-Max Interval DP
15. Removing Boxes: Why Two Dimensions Fail
16. Polygon Triangulation and the Catalan Bijection
17. Relationship to Tree DP and the Interval-as-Subtree View
18. A Catalog of Interval-DP Transition Costs
19. Yao's Exchange Argument in Detail
20. Summary

---

## 1. Formal Definitions

Let `S = (s_0, s_1, …, s_{n-1})` be a finite sequence of `n` elements.

**Definition 1.1 (Interval).** An **interval** (or range) `[i..j]` with `0 ≤ i ≤ j ≤ n-1` is the contiguous sub-sequence `(s_i, …, s_j)`. Its **length** is `ℓ(i, j) = j - i + 1`. There are `\binom{n}{2} + n = n(n+1)/2 = Θ(n²)` intervals.

**Definition 1.2 (Interval objective).** Let `f : {intervals} → ℝ` (or a totally ordered set) assign to each interval its **optimal value** under the problem's objective. We seek `f(0, n-1)`, the optimum over the whole sequence.

**Definition 1.3 (Split).** A **split point** of `[i..j]` (with `i < j`) is an index `k` with `i ≤ k < j`, partitioning `[i..j]` into the adjacent sub-intervals `[i..k]` and `[k+1..j]`. A **last-element index** of the open interval `(i, j)` is an index `k` with `i < k < j`.

**Definition 1.4 (General interval recurrence).** The **split-point interval DP** is

```
f(i, j) = opt_{i ≤ k < j} ( f(i, k) ⊕ f(k+1, j) ⊕ cost(i, k, j) ),     i < j,
f(i, i) = base(i),
```

where `opt ∈ {min, max}`, `⊕` is an associative combine (usually `+`), and `cost(i, k, j)` is the merge cost. We prove this computes `f` correctly under the optimal-substructure hypothesis (Section 2).

**Notation conventions.** Throughout, `n = |S|`, `ℓ = j - i + 1` is interval length, `opt[i][j]` (or `K(i,j)`) is the smallest split index attaining the optimum at `(i,j)`, `w(i, j)` denotes a *weight*/cost function depending only on the endpoints, and `QI` abbreviates the quadrangle inequality. "Split-point" framing partitions a closed interval; "last-element" framing fixes the last operation on an open interval. The Iverson bracket `[P]` is `1` if `P` holds else `0`.

---

## 2. Optimal Substructure for Intervals (Proof)

The recurrence of Definition 1.4 is correct precisely when the problem has **optimal substructure decomposable along splits**.

**Definition 2.1 (Split-decomposable optimal substructure).** The objective has split-decomposable optimal substructure if, for every interval `[i..j]` with `i < j`, there exists a split `k` such that an optimal solution `OPT(i, j)` consists of an optimal solution `OPT(i, k)` of the left sub-interval, an optimal solution `OPT(k+1, j)` of the right, and a merge whose cost `cost(i, k, j)` depends only on `i, k, j` (not on the internal structure of the two optimal sub-solutions).

**Theorem 2.2 (Correctness of the recurrence).** Under Definition 2.1, the recurrence of Definition 1.4 computes `f(i, j) = value(OPT(i, j))` for all intervals.

**Proof (induction on interval length `ℓ`).**

*Base `ℓ = 1`.* `f(i, i) = base(i)` by definition; a single-element interval has no split, and its optimum is the base value.

*Inductive step.* Assume the recurrence is correct for all intervals of length `< ℓ`, and let `[i..j]` have length `ℓ ≥ 2`. We show two inequalities.

(≤) For the optimal split `k*` guaranteed by Definition 2.1, `value(OPT(i,j)) = value(OPT(i,k*)) ⊕ value(OPT(k*+1,j)) ⊕ cost(i,k*,j)`. By the inductive hypothesis the two sub-values equal `f(i,k*)` and `f(k*+1,j)`, so `value(OPT(i,j))` equals the term the recurrence evaluates at `k = k*`. Since the recurrence takes the `opt` over **all** `k`, we get (for `opt = min`) `f(i,j) ≤ value(OPT(i,j))`.

(≥) Conversely, take any `k` and consider the candidate built by gluing an optimal left solution and an optimal right solution with the merge of cost `cost(i,k,j)`. This is a **feasible** solution of `[i..j]` (the merge cost depends only on `i,k,j`, by Definition 2.1, so the glue is always valid), hence its value is `≥ value(OPT(i,j))` (for `min`). By the inductive hypothesis this candidate's value is exactly the recurrence term at `k`. Taking the min over `k`, `f(i,j) ≥ value(OPT(i,j))`.

Both directions give `f(i,j) = value(OPT(i,j))`. The `max` case is symmetric. ∎

**Remark (cut-and-paste).** The (≥) direction is the standard **cut-and-paste** argument: if a sub-solution inside the optimum were sub-optimal, replacing it with the optimal sub-solution would not increase (for `min`) the total — because the merge cost is independent of sub-solution internals — contradicting optimality. The independence of `cost(i,k,j)` from internal structure is the **load-bearing hypothesis**: when it fails (removing boxes, where the merge value depends on boxes attached from outside), the 2D recurrence is *incorrect* and an extra state dimension is required (Section 7 remark).

---

## 3. Why Increasing-Length Order Is Valid

**Definition 3.1 (Dependency relation).** Write `[a..b] ≺ [i..j]` if the recurrence for `[i..j]` reads `f(a, b)`. By Definition 1.4 every such `[a..b]` is a proper sub-interval of `[i..j]`, hence `ℓ(a, b) < ℓ(i, j)`.

**Theorem 3.2 (Topological validity).** Filling the table in nondecreasing order of interval length computes every `f(i, j)` only after all intervals it depends on are computed.

**Proof.** If `[a..b] ≺ [i..j]` then `ℓ(a, b) < ℓ(i, j)` (Definition 3.1). Processing intervals in nondecreasing `ℓ` order therefore processes `[a..b]` strictly before `[i..j]`. Thus when `f(i, j)` is evaluated, every `f(a, b)` it reads is already final. The order is a topological sort of the (acyclic) dependency DAG. ∎

**Corollary 3.3 (Alternative valid orders).** Any linear extension of `≺` is valid. Two practical ones besides increasing length: (a) `i` descending from `n-1` to `0`, `j` ascending from `i` to `n-1` (then `f(i,k)` with `k ≥ i` is in the same or later `i`-row but earlier `j`; `f(k+1,j)` has `k+1 > i`, an already-finished row); (b) memoized recursion, which realizes a valid order implicitly via the call stack. The naive `for i ascending: for j ascending` is **not** a linear extension and is incorrect, because it evaluates `f(i,j)` before `f(k+1, j)` for `k+1 > i`.

**Acyclicity.** The dependency relation is a strict partial order (sub-interval containment with strictly smaller length), hence its transitive closure is irreflexive — there are no cycles, so a topological order exists. This is why interval DP terminates and is well-defined: there is no circular dependency among the `f(i,j)`.

---

## 4. The General Interval-DP Recurrence and Its Complexity

**Theorem 4.1 (Baseline complexity).** Computing `f(0, n-1)` by the recurrence of Definition 1.4, filling by increasing length with `O(1)`-evaluable `cost`, takes `Θ(n³)` time and `Θ(n²)` space.

**Proof.** There are `Θ(n²)` intervals. For interval `[i..j]` the `opt` ranges over `k ∈ [i, j-1]`, i.e. `ℓ - 1` choices. Summing the work over all intervals:

```
Σ_{i ≤ j} (ℓ(i,j) - 1) = Σ_{ℓ=1}^{n} (n - ℓ + 1)(ℓ - 1)
                       = Σ_{ℓ=1}^{n} (n - ℓ + 1)(ℓ - 1).
```

The dominant term is `Σ_ℓ (n)(ℓ) ≈ n · Σ_ℓ ℓ = n · Θ(n²)/... ` — more precisely the double sum evaluates to `\binom{n}{3} = Θ(n³/6)`. Each of these inner iterations is `O(1)` (table reads plus an `O(1)` cost). Hence `Θ(n³)` time. The table stores one value per interval: `Θ(n²)` space. ∎

**Remark (the `O(1)` cost requirement).** Theorem 4.1 assumes `cost(i,k,j)` is `O(1)`. If `cost` is a range aggregate (e.g. `Σ_{t=i}^{j} w_t`) computed naively, each evaluation is `O(n)` and the total becomes `Θ(n⁴)`. Precomputing prefix sums `P_t = Σ_{<t} w` makes `Σ_{i}^{j} w = P_{j+1} - P_i` an `O(1)` operation, restoring `Θ(n³)`. This is not an optimization but a *correctness-of-complexity* requirement.

**Exact constant.** The number of `(interval, split)` pairs is exactly `\sum_{ℓ=2}^{n} (n-ℓ+1)(ℓ-1) = \binom{n+1}{3} = \frac{(n+1)n(n-1)}{6}`, so the baseline does `≈ n³/6` core iterations — useful for back-of-envelope latency budgeting.

---

## 5. Matrix Chain Multiplication: Correctness

**Setup.** Matrices `M_0, …, M_{n-1}` with `M_t` of shape `r_t × r_{t+1}` (dimension array `r` of length `n+1`). Let `m(i, j)` = minimum scalar multiplications to compute `M_i ⋯ M_j`.

**Theorem 5.1.** `m(i, j) = min_{i ≤ k < j} ( m(i, k) + m(k+1, j) + r_i r_{k+1} r_{j+1} )`, with `m(i, i) = 0`.

**Proof.** Any parenthesization of `M_i ⋯ M_j` (for `i < j`) has a unique **outermost** product, splitting the chain at some `k`: `(M_i ⋯ M_k)(M_{k+1} ⋯ M_j)`. The left factor is `r_i × r_{k+1}`, the right factor is `r_{k+1} × r_{j+1}`, and multiplying them costs `r_i · r_{k+1} · r_{j+1}` scalar multiplications (standard matrix-multiply cost). The total cost is the cost of the left sub-product plus the right sub-product plus this final multiply. By the multiplication-cost additivity (no shared work between independent sub-products) and Theorem 2.2, the optimum over all parenthesizations equals the min over `k` of the recurrence. The base `m(i,i)=0` reflects that a single matrix needs no multiplication. ∎

**Optimal substructure check.** The merge cost `r_i r_{k+1} r_{j+1}` depends only on `i, k, j` (the boundary dimensions), **not** on how the sub-products were parenthesized internally — confirming Definition 2.1. Hence cut-and-paste applies: any sub-optimal sub-parenthesization can be swapped out without affecting the final multiply's cost. This is exactly why matrix chain is a clean 2D interval DP.

**Complexity.** `Θ(n³)` by Theorem 4.1; reducible to `Θ(n²)` by Knuth (Section 8), since the cost satisfies the quadrangle inequality.

---

## 6. Optimal Binary Search Tree: Correctness

**Setup.** Sorted keys `K_0 < K_1 < ⋯ < K_{n-1}` with access probabilities (or frequencies) `p_0, …, p_{n-1}`. The cost of a BST is `Σ_t p_t · (depth(K_t) + 1)` (expected number of comparisons). Let `e(i, j)` be the minimum cost over all BSTs on keys `K_i, …, K_j`, and `W(i, j) = Σ_{t=i}^{j} p_t`.

**Theorem 6.1.** `e(i, j) = min_{i ≤ k ≤ j} ( e(i, k-1) + e(k+1, j) + W(i, j) )`, with `e(i, i-1) = 0` (empty subtree).

**Proof.** In any BST on `K_i, …, K_j`, some key `K_k` is the **root**. Its left subtree holds `K_i, …, K_{k-1}` and its right subtree `K_{k+1}, …, K_j` (BST ordering forces this contiguous split). When `K_k` becomes the root, every key in the left and right subtrees is **one level deeper** than it would be as a standalone tree, so each contributes one extra comparison weighted by its probability — totaling `W(i, j)` extra cost (the root itself sits at depth 0, contributing `p_k · 1`, which is included in `W(i,j)` as the `+1` baseline distributes uniformly). Formally,

```
cost(tree rooted at k) = [ e(i,k-1) + W(i,k-1) ] + [ e(k+1,j) + W(k+1,j) ] + p_k
                       = e(i,k-1) + e(k+1,j) + W(i,j),
```

since `W(i,k-1) + p_k + W(k+1,j) = W(i,j)`. Minimizing over the root choice `k` and invoking Theorem 2.2 gives the recurrence. The empty-subtree base `e(i,i-1)=0` is forced (no keys, no cost). ∎

**Why `W(i, j)` is the merge cost.** The `+W(i, j)` term is the canonical "every element in the range pays one more unit" pattern. It depends only on the endpoints, so prefix sums make it `O(1)` and the DP is `Θ(n³)`. Crucially, `W` is a **monotone, quadrangle-convex** weight (Section 8), which is exactly why Knuth's 1971 result reduces optimal BST to `Θ(n²)`.

**Historical note.** This is the problem for which Knuth originally discovered the monotone-split optimization (1971); Yao (1980) later abstracted the sufficient condition to the quadrangle inequality on the weight `W`.

### 6.1 Worked numeric example

Keys with frequencies `(p_0, p_1, p_2) = (34, 8, 50)`. Compute `e` bottom-up.

```
Length 1:  e(0,0)=34,  e(1,1)=8,  e(2,2)=50
Length 2:
  e(0,1) = min( root=0: 0 + e(1,1) + W(0,1),    # 0 + 8 + 42 = 50
                root=1: e(0,0) + 0 + W(0,1) )    # 34 + 0 + 42 = 76
         = 50   (root 0)
  e(1,2) = min( root=1: 0 + e(2,2) + W(1,2),     # 0 + 50 + 58 = 108
                root=2: e(1,1) + 0 + W(1,2) )     # 8 + 0 + 58 = 66
         = 66   (root 2)
Length 3:  W(0,2) = 92
  e(0,2) = min( root=0: 0 + e(1,2) + 92,         # 0 + 66 + 92 = 158
                root=1: e(0,0) + e(2,2) + 92,     # 34 + 50 + 92 = 176
                root=2: e(0,1) + 0 + 92 )         # 50 + 0 + 92 = 142
         = 142  (root 2)
```

The optimum is `e(0,2) = 142` with root key `2` (the highest-frequency key near the root, as intuition suggests). Note the optimal roots: `K(0,1)=0`, `K(1,2)=2`, `K(0,2)=2`, satisfying the monotonicity `K(0,1)=0 ≤ K(0,2)=2 ≤ K(1,2)=2` of (∗) — the empirical confirmation of Theorem 8.3 on this instance, and exactly the window Knuth's optimization would scan.

---

## 7. The Last-Operated-Element Decomposition (Burst Balloons)

Some interval problems are **not** split-decomposable in the sense of Definition 2.1, because the operation modifies the neighbors of remaining elements. The fix is to decompose by the *last* operation rather than an outermost split.

**Setup (burst balloons).** Values `a_1, …, a_m` padded with `a_0 = a_{m+1} = 1`. Bursting balloon `t` (currently flanked by `L` and `R`) earns `a_L · a_t · a_R`. Let `c(i, j)` = maximum coins from bursting **all balloons strictly inside the open interval `(i, j)`**, with `i, j` remaining (boundaries).

**Theorem 7.1.** `c(i, j) = max_{i < k < j} ( c(i, k) + c(k, j) + a_i · a_k · a_j )`, with `c(i, j) = 0` when `j ≤ i + 1` (no interior).

**Proof.** Consider the **last** balloon `k` burst among the interior `(i, j)`. At the moment `k` is burst, every other interior balloon is already gone, so `k`'s neighbors are exactly `i` and `j` (the surviving boundaries). Hence bursting `k` last earns precisely `a_i · a_k · a_j`. Before that, the balloons in `(i, k)` were all burst (never interacting with `(k, j)`, because `k` separated them and was still present), and likewise `(k, j)`. Thus the two sub-processes are **independent** and optimal sub-values `c(i, k)`, `c(k, j)` apply. The open sub-intervals `(i, k)` and `(k, j)` overlap only at the boundary index `k`, which is *not* burst within either (it is the last, handled by the `a_i a_k a_j` term). Maximizing over the choice of last balloon `k` gives the recurrence. ∎

**Why "last" and not "first" restores substructure.** If we instead split on the *first* balloon burst, the two resulting sub-ranges would still be adjacent through that balloon's removal, and bursting in the left would change the right's boundary — the subproblems would **not** be independent, violating Definition 2.1. Choosing the *last* burst freezes `k`'s neighbors at the stable boundaries `i, j`, making the decomposition split-decomposable in the open-interval formulation. This is the precise mathematical reason the last-element trick works.

**Remark (failure needing a third dimension).** Removing boxes is a harder cousin: even the last-element decomposition is insufficient because the *value* of removing a maximal monochromatic block depends on how many same-colored boxes were attached from **outside** the interval. The merge cost then depends on external context, violating Definition 2.1 for any 2D state. The remedy is to augment the state with a `carry` count, restoring conditional independence given `carry` — at the price of `Θ(n⁴)` time. The lesson: 2D interval DP is correct iff the merge cost is a function of `(i, k, j)` alone; otherwise lift the violating context into the state.

---

## 8. The Quadrangle Inequality and Knuth's Optimization

The `Θ(n³)` baseline reduces to `Θ(n²)` for split-point DPs whose endpoint-only cost is **quadrangle-convex**.

**Definition 8.1 (Quadrangle inequality, QI).** A function `w(i, j)` over intervals satisfies the **quadrangle inequality** if for all `a ≤ b ≤ c ≤ d`:

```
w(a, c) + w(b, d) ≤ w(a, d) + w(b, c).        (QI)
```

Intuitively: the "outer + inner" configuration costs no more than the "crossing" configuration — a discrete convexity / submodularity condition on intervals.

**Definition 8.2 (Monotonicity on intervals, MI).** `w` is monotone if `w(b, c) ≤ w(a, d)` whenever `[b, c] ⊆ [a, d]` (i.e. `a ≤ b ≤ c ≤ d`).

**Theorem 8.3 (Knuth–Yao).** Suppose `f(i, j) = min_{i ≤ k < j} ( f(i, k) + f(k+1, j) ) + w(i, j)` with `f(i,i) = w(i,i)` (or `0`), and `w` satisfies QI and MI. Then `f` itself satisfies QI, and the optimal split `K(i, j) := argmin_k` is **monotone**:

```
K(i, j-1) ≤ K(i, j) ≤ K(i+1, j).        (∗)
```

**Proof sketch.** Two parts. (i) *`f` inherits QI from `w`.* One shows by induction on interval length that if `w` satisfies QI and MI then the DP value `f` satisfies QI; the inductive step is a case analysis on the positions of the optimal splits of the four intervals `[a,c],[b,d],[a,d],[b,c]`, using the QI of `w` and the inductive QI of `f` to exchange split choices (the classic Yao exchange argument). (ii) *QI of `f` implies monotone `K`.* If `f` satisfies QI, then for `i < i'` and `j < j'` the cost-difference `Δ_k = (f(i,k)+f(k+1,j)) - (f(i',k)+f(k+1,j))` is monotone in `k`, so the argmin cannot move left as the interval grows on either side, giving (∗). The full exchange argument is in Yao (1980). ∎

**Theorem 8.4 (Knuth complexity).** Using window (∗) to restrict the `k` loop to `[K(i, j-1), K(i+1, j)]`, the total work is `Θ(n²)`.

**Proof.** Fix interval length `ℓ`. The `k`-loop for `[i, i+ℓ-1]` spans `K(i+1, i+ℓ-1) - K(i, i+ℓ-2) + 1` candidates. Summing over all `i` at this length **telescopes**: the upper endpoints `K(i+1, ·)` and lower endpoints `K(i, ·)` cancel across adjacent `i`, leaving `O(n)` total work per length. Over `n` lengths that is `Θ(n²)`. ∎

**Which classics satisfy QI.** The range-sum weight `w(i, j) = Σ_{t=i}^{j} c_t` (with `c_t ≥ 0`) satisfies QI **with equality** (`w(a,c)+w(b,d) = w(a,d)+w(b,c)` because both sides sum the same multiset of elements) and is monotone — so **stone merging** and **optimal BST** qualify directly. **Matrix chain** also satisfies the required conditions on its cost structure. These three are the textbook Knuth-optimization problems.

**Caveat.** QI is a property of the **cost/weight**, and `f`-inherits-QI is a *theorem* given that. If your `w` violates QI, the monotone window (∗) can exclude the true optimum, yielding a wrong (suboptimal) answer with no error raised. Verify QI before applying Knuth (Section 11 of the senior file gives the empirical cross-check).

---

## 9. Monotonicity of the Optimal Split Point (Proof)

We isolate the monotonicity claim because it is the conceptual core of *both* the Knuth and the divide-and-conquer optimizations.

**Lemma 9.1.** Let `g_k(i, j) = f(i, k) + f(k+1, j)` be the split-cost (excluding the endpoint-only `w(i,j)`, which does not affect the argmin over `k`). If `f` satisfies QI, then for fixed `i`, the argmin `K(i, j)` is nondecreasing in `j`; and for fixed `j`, `K(i, j)` is nondecreasing in `i`. Together these give `K(i, j-1) ≤ K(i, j) ≤ K(i+1, j)`.

**Proof.** Define for `k < k'` the gain of choosing `k'` over `k` at interval `(i, j)`:

```
D(k, k'; i, j) = g_{k'}(i,j) - g_k(i,j) = [f(k+1,j) - f(k'+1,j)] - [f(i,k') - f(i,k)] ... 
```

QI of `f` makes `f(k+1, j) - f(k'+1, j)` monotone in `j`: extending `j` to `j+1` cannot make the larger-`k'` choice relatively worse. Formally, QI says `f(k+1, j) + f(k'+1, j+1) ≤ f(k+1, j+1) + f(k'+1, j)` for `k+1 ≤ k'+1 ≤ j ≤ j+1`, i.e. the incremental cost of the right part is "subadditive" in a way that pushes the optimal split rightward as `j` grows. Hence if `k'` beats `k` at `(i, j)`, then `k'` still beats `k` at `(i, j+1)`, so `K(i, j) ≤ K(i, j+1)`. The argument in `i` is symmetric (QI on the left part). Combining yields (∗). ∎

**Consequence.** The optimal split point traces a monotone staircase through the table. The baseline ignores this and scans all `O(n)` splits per cell; the optimizations exploit it. Knuth bounds the per-cell scan by the staircase width and telescopes to `Θ(n²)`; the D&C optimization (next section) uses the same monotonicity differently, recursively halving the search interval.

---

## 10. Divide-and-Conquer Optimization: The Sibling Condition

The D&C optimization (sibling `12`) is a *different* exploitation of split monotonicity, for a *different* DP shape.

**Definition 10.1 (Layered partition DP).** `dp[t][j] = min_{i < j} ( dp[t-1][i] + C(i, j) )`, for `t = 1, …, m` layers (e.g. "partition the prefix `[0..j]` into exactly `t` groups"). Let `A[t][j] = argmin_i`.

**Theorem 10.2 (D&C condition).** If `A[t][j] ≤ A[t][j+1]` (the optimal cut is monotone in `j` within a layer), then layer `t` can be computed in `O(n log n)` by a divide-and-conquer recursion that, to compute `dp[t][·]` on a range of columns `[cl, cr]` with the optimal-`i` known to lie in `[ol, or]`, evaluates the midpoint `cm`, finds its optimal `A[t][cm] = m*`, and recurses on `([cl, cm-1], [ol, m*])` and `([cm+1, cr], [m*, or])`. Total per layer `O((n + (or-ol)) log n) = O(n log n)`; over `m` layers `O(mn log n)`.

**Proof sketch.** Each recursion level processes all `n` columns and, by the monotonicity `A[t][j] ≤ A[t][j+1]`, the union of the candidate `i`-ranges across one level is `O(n)`. There are `O(log n)` levels (the column range halves each time), giving `O(n log n)` per layer. Correctness follows because the monotone argmin guarantees the true optimum for column `cm` lies in `[ol, or]`, and splitting preserves this invariant for the sub-ranges. ∎

**Sufficient condition via QI.** A common sufficient condition for `A[t][j] ≤ A[t][j+1]` is that `C(i, j)` satisfies the quadrangle inequality (Definition 8.1). Thus QI is the shared engine: it implies monotone optimal cuts, which Knuth turns into `Θ(n²)` for the single-table interval DP and D&C turns into `Θ(mn log n)` for the layered partition DP. The two optimizations are siblings precisely because they rest on the same convexity.

**When each wins.** Knuth applies to the `f(i,j) = min_k f(i,k)+f(k+1,j)+w(i,j)` *interval* shape and yields `Θ(n²)`. D&C applies to the `dp[t][j] = min_i dp[t-1][i]+C(i,j)` *layered* shape and yields `Θ(mn log n)`. They are not interchangeable: matrix chain is the former, "split an array into `m` segments minimizing total segment cost" is the latter.

---

## 11. Counting Subproblems and Lower-Bound Intuition

**Subproblem count.** The number of distinct intervals is `\binom{n}{2} + n = Θ(n²)`; the number of `(interval, split)` pairs is `\binom{n+1}{3} = Θ(n³)` (Section 4). So the baseline does asymptotically as much work as there are split decisions — no waste.

**Catalan blow-up of the naive search.** The number of full binary parenthesizations of an `n`-chain is the Catalan number `C_{n-1} = \frac{1}{n}\binom{2(n-1)}{n-1} = Θ(4^n / n^{1.5})`. Brute force over parenthesizations is exponential; the interval DP collapses the overlapping sub-parenthesizations into `Θ(n²)` reusable subproblems, the canonical "overlapping subproblems + optimal substructure → DP" speedup. The exponential-to-polynomial gap is the entire reason the DP exists.

**Why `Θ(n²)` cannot generally be beaten without structure.** Any algorithm that determines `f(i, j)` for the full sequence must, in the worst case, distinguish inputs that differ in `Ω(n²)` interval values, and merely writing the answer for sub-range queries needs `Ω(n²)` outputs. Without a special cost structure (QI), the `Θ(n³)` of trying all splits is the natural bound; *with* QI, monotonicity removes the third factor down to `Θ(n²)`, matching the output/state lower bound up to constants. This is why QI is the pivotal hypothesis — it is exactly the structure that lets the split decision be made without scanning all candidates.

**The 3D barrier.** For removing-boxes-style problems the state is `Θ(n³)` (interval × carry) and the transition `Θ(n)`, giving `Θ(n⁴)`. No general reduction is known, because the carry dimension is genuine context that the merge cost depends on — the QI machinery does not apply to the augmented state in general. This places the 3D variants in a strictly harder regime than the 2D classics.

---

## 12. Worked QI Verification and Knuth Trace

This section makes the abstract QI machinery concrete by verifying the inequality on a small weight and tracing the monotone-split window on optimal BST.

### 12.1 Verifying QI for a range-sum weight

Let `c = (c_0, …, c_{n-1})` with `c_t ≥ 0` and `w(i, j) = Σ_{t=i}^{j} c_t`. We check `w(a,c)+w(b,d) ≤ w(a,d)+w(b,c)` for `a ≤ b ≤ c ≤ d`. Expand each side as a sum over the same elements:

```
LHS = w(a,c) + w(b,d) = (Σ_{a}^{c} c) + (Σ_{b}^{d} c)
RHS = w(a,d) + w(b,c) = (Σ_{a}^{d} c) + (Σ_{b}^{c} c)
```

Reindex by counting how many times each element `c_t` appears. On the LHS, `c_t` is counted once if `t ∈ [a,c]` and once if `t ∈ [b,d]`. On the RHS, once if `t ∈ [a,d]` and once if `t ∈ [b,c]`. For any `a ≤ b ≤ c ≤ d`, the element-by-element multiplicities are **identical** (a short case check on the five regions `[a,b), [b,c], (c,d]`, etc.), so `LHS = RHS`. Thus a range-sum weight satisfies QI **with equality** — and equality is enough for Theorem 8.3. This is why stone merging and optimal BST qualify for Knuth.

**Monotonicity (MI).** Since `c_t ≥ 0`, enlarging an interval only adds non-negative terms, so `w(b,c) ≤ w(a,d)` whenever `[b,c] ⊆ [a,d]`. Both Knuth conditions hold.

### 12.2 A non-QI weight, to show the condition bites

Take `w(i, j) = (j - i)²` (squared length). Test `a=0, b=1, c=2, d=3`:

```
w(0,2) + w(1,3) = 4 + 4 = 8
w(0,3) + w(1,2) = 9 + 1 = 10
LHS = 8 ≤ 10 = RHS   ✓  (this quadruple satisfies QI)
```

But QI must hold for **all** quadruples; a convex-in-length weight like `2^{j-i}` fails:

```
a=0,b=1,c=2,d=3:  w(0,2)+w(1,3) = 4 + 4 = 8
                  w(0,3)+w(1,2) = 8 + 2 = 10   ✓
a=0,b=2,c=2,d=4 ... 
```

The point is that QI is a *universal* statement over quadruples; a single violating quadruple invalidates Knuth and, applied anyway, the monotone window can exclude the true optimum. The empirical cross-check (run baseline and Knuth on random instances, assert equality) is the practical guard, since hand-verifying all `O(n⁴)` quadruples is itself the brute-force check.

### 12.3 Tracing the monotone window

For optimal BST with `freq = (a, b, c)` (n=3), the baseline scans `k ∈ [i, j]` for every interval. Knuth instead initializes `opt[i][i] = i` and, for interval `[0,2]`, scans only `k ∈ [opt[0][1], opt[1][2]]`. If `opt[0][1] = 0` and `opt[1][2] = 2`, the window is `[0, 2]` — the full range for this tiny case — but as `n` grows the windows shrink and their *total* length telescopes to `O(n)` per diagonal:

```
Σ_i ( opt[i+1][i+ℓ-1] - opt[i][i+ℓ-2] + 1 )
  = (opt[n-ℓ+1][n-1] - opt[0][ℓ-2]) + (number of intervals at length ℓ)
  = O(n)   per length ℓ,   summing to O(n²) overall.
```

The telescoping is the entire mechanism: consecutive windows share endpoints, so the cumulative scan length across one diagonal is bounded by `opt`'s total rise, which is `O(n)`.

---

## 13. Palindrome Partitioning: Formal Treatment

Palindrome partitioning illustrates an interval table feeding a linear DP — a recurring composite pattern.

**Definition 13.1 (Palindrome predicate).** For a string `s` of length `n`, `pal(i, j) = [s[i..j] is a palindrome]`.

**Theorem 13.2 (Interval recurrence for `pal`).**

```
pal(i, j) = [s[i] = s[j]] · ( [j - i < 2] ∨ pal(i+1, j-1) ).
```

**Proof.** A string `s[i..j]` of length ≥ 1 is a palindrome iff its first and last characters match **and** the inner substring `s[i+1..j-1]` is a palindrome. For lengths 1 and 2 (`j - i < 2`) the inner substring is empty or a single character, vacuously a palindrome, so the condition reduces to `s[i] = s[j]`. The recurrence reads the strictly shorter inner interval `pal(i+1, j-1)`, so increasing-length order (Theorem 3.2) computes it correctly. ∎

**Theorem 13.3 (Min-cut recurrence).** Let `cut(j)` be the minimum number of cuts to partition `s[0..j]` into palindromes. Then

```
cut(j) = 0                                if pal(0, j),
cut(j) = min_{1 ≤ i ≤ j, pal(i,j)} ( cut(i-1) + 1 )   otherwise.
```

**Proof.** The last palindromic block of an optimal partition of `s[0..j]` is some `s[i..j]` with `pal(i, j)`. Removing it leaves `s[0..i-1]`, optimally partitioned with `cut(i-1)` cuts, plus one cut separating the two parts (or zero cuts if `i = 0`, i.e. the whole prefix is itself a palindrome, the first case). Minimizing over the choice of `i` and invoking optimal substructure of the prefix gives the recurrence. ∎

**Complexity.** Filling `pal` is `Θ(n²)` (interval DP), and the cut DP is `Θ(n²)` (each `j` scans `i`), so the whole problem is `Θ(n²)` time and space. This is **better** than the generic `Θ(n³)` interval DP because the cut layer is linear, not split-over-`k` — a reminder that not every range-flavored problem pays the cubic price; the structure (a linear DP on top of a boolean interval table) determines the cost.

**Remark (the composite pattern).** Many string problems factor as "(1) an interval DP computing a boolean or numeric property of every substring, then (2) a linear DP that stitches substrings together." Recognizing the factorization avoids an unnecessary cubic when the stitching layer is genuinely linear.

---

## 14. The Stone Game as a Min-Max Interval DP

The adversarial two-player stone game shows interval DP with a `max`-of-negated-opponent transition rather than a split-sum.

**Setup.** Values `v_0, …, v_{n-1}` in a row. Players alternate; the current player takes either end and adds its value to their score. Let `D(i, j)` be the maximum **score difference** (current player minus opponent) achievable on `[i..j]` under optimal play by both.

**Theorem 14.1.** `D(i, j) = max( v_i − D(i+1, j),  v_j − D(i, j-1) )`, with `D(i, i) = v_i`.

**Proof.** The current player chooses an end. If they take `v_i`, the opponent then plays optimally on `[i+1..j]`, achieving difference `D(i+1, j)` *in the opponent's favor*; from the current player's perspective the resulting difference is `v_i − D(i+1, j)` (the opponent's advantage is subtracted). Symmetrically for taking `v_j`. The player maximizes over the two choices. The base `D(i, i) = v_i` is the single-pile case. The negation encodes the zero-sum alternation: one player's gain in difference is the other's loss. ∎

**Why this is still interval DP.** The state is the contiguous range `[i..j]` of remaining piles, and the transition reduces to strictly shorter ranges (`[i+1..j]` or `[i..j-1]`). It is filled by increasing length like any interval DP, but the transition is `O(1)` (two choices) rather than `O(n)` (all splits), so the total cost is `Θ(n²)`, not `Θ(n³)`. The "take from an end" structure replaces the "split anywhere" structure — a degenerate interval DP where the only splits are at the two boundaries.

**Corollary 14.2.** The first player wins iff `D(0, n-1) > 0`, ties iff `= 0`, loses iff `< 0`. For the classic even-length equal-parity variant `D(0, n-1) ≥ 0` always (a known parity argument), but the general DP handles arbitrary values and odd lengths uniformly.

**Min-max vs sum framing.** This problem highlights that "interval DP" names the *state space* (contiguous ranges, increasing-length fill), not a fixed transition. Transitions range from `O(n)` split-sums (matrix chain) to `O(1)` end-choices (stone game) to `O(n)` last-element picks (burst balloons). The unifying invariant is: the optimum for `[i..j]` is determined by optima of strictly shorter sub-ranges.

---

## 15. Removing Boxes: Why Two Dimensions Fail

Removing boxes is the canonical example where the load-bearing hypothesis of Theorem 2.2 (merge cost independent of sub-solution internals) fails for a 2D state, forcing a third dimension.

**Setup.** A row of colored boxes `b_0, …, b_{n-1}`. A move removes a maximal contiguous run of `c` equal-colored boxes, scoring `c²`; the remaining boxes close up (so previously separated runs of the same color may merge). Maximize total score.

**Theorem 15.1 (2D failure).** No state `dp[i][j]` depending only on the sub-array `[i..j]` correctly computes the optimum.

**Proof (counterexample).** Consider `[A, B, A]` (colors). Treated as an isolated interval, removing the middle `B` (score `1`) then the two `A`s — which have now closed up into a run of 2 — scores `1 + 4 = 5`. But if this `[A, B, A]` sits inside a larger context `[A, B, A, A]`, the optimal play *defers* removing the first `A` so it can merge with the trailing `A`s, scoring differently. The value of the interval `[0..2]` therefore depends on how many `A`s are attached **outside** `[0..2]` — information absent from any 2D state `dp[0][2]`. Hence a function of `[i..j]` alone cannot be correct. ∎

**The augmenting dimension.** Define `dp[i][j][c]` = maximum score for `[i..j]` given that `c` boxes of color `b_i` are glued to the **left** of `i` (waiting to merge). The transition:

```
dp[i][j][c] = max(
    (c+1)² + dp[i+1][j][0],                              # cash in box i with its carry now
    max_{i < m ≤ j, b_m = b_i} dp[i+1][m-1][0] + dp[m][j][c+1]   # defer i to merge with m
)
```

**Theorem 15.2 (3D correctness).** `dp[i][j][c]` correctly computes the optimum, and the answer is `dp[0][n-1][0]`.

**Proof sketch.** The state `(i, j, c)` captures *all* external context the interval needs: the only way the outside affects `[i..j]` is through same-colored boxes attached at the left boundary, summarized by `c` (boxes to the right of `j` are handled when those intervals are processed, by symmetry of the recursion that always anchors on the left box). Given `c`, the optimal play for `[i..j]` is determined: either remove `b_i`'s run now (paying `(c+1)²` for the `c` carried plus `b_i` itself) and solve the rest, or find a later same-colored box `m`, clear the gap `[i+1..m-1]` first (so `b_i` slides next to `b_m`), and recurse with the carry increased. Optimal substructure holds *conditioned on `c`*, restoring Theorem 2.2 in the augmented state. ∎

**Complexity.** `Θ(n³)` states × `Θ(n)` transition = `Θ(n⁴)` time, `Θ(n³)` space. The carry `c ≤ n`, but in practice `c` is bounded by the count of `b_i`-colored boxes, often `≪ n`, so a memoized top-down realization touches far fewer states. **General lesson:** when a 2D interval DP is provably wrong (find a context-dependence counterexample), identify the *minimal external summary* the interval needs and lift it into the state — the QI/Knuth machinery does not apply to the augmented state in general, so expect `Θ(n⁴)`.

---

## 16. Polygon Triangulation and the Catalan Bijection

Polygon triangulation makes the Catalan blow-up of Section 11 concrete and exhibits a clean interval DP with a geometric interpretation.

**Setup.** A convex polygon with vertices `v_0, …, v_{n-1}` in order. A **triangulation** partitions its interior into `n - 2` triangles using non-crossing diagonals. Assign each triangle `(i, k, j)` a score (e.g. `v_i · v_k · v_j` or the perimeter); minimize total score.

**Theorem 16.1.** Let `t(i, j)` be the minimum triangulation score of the sub-polygon on vertices `i, i+1, …, j` (closed by the edge `i–j`). Then

```
t(i, j) = min_{i < k < j} ( t(i, k) + t(k, j) + score(i, k, j) ),    t(i, i+1) = 0.
```

**Proof.** In any triangulation of the sub-polygon `[i..j]`, the boundary edge `i–j` belongs to exactly **one** triangle `(i, k, j)` for some `k` strictly between `i` and `j` (the third vertex of that triangle). This triangle splits the sub-polygon into two smaller sub-polygons: `[i..k]` (closed by edge `i–k`) and `[k..j]` (closed by edge `k–j`), triangulated independently. The score is the two sub-scores plus the triangle's own `score(i, k, j)`. Minimizing over `k` and applying optimal substructure (the two sub-polygons share only the vertex `k` and the diagonals do not cross) gives the recurrence. The base `t(i, i+1) = 0` is a degenerate "polygon" of one edge (no triangle). ∎

**Bijection with parenthesizations.** Triangulations of a convex `(n+1)`-gon are in **bijection** with full binary parenthesizations of an `n`-term product — the classic Catalan-number correspondence. The triangle containing the base edge corresponds to the outermost product; recursing on the two sub-polygons mirrors recursing on the two factors. This is *why* polygon triangulation and matrix chain have the identical `t(i,j) = min_k t(i,k)+t(k,j)+score` shape: they are the same combinatorial object viewed geometrically vs algebraically. The number of triangulations is `C_{n-1} = Θ(4ⁿ/n^{1.5})`, matching the parenthesization count of Section 11.

**Complexity.** `Θ(n²)` sub-polygons × `Θ(n)` apex choices = `Θ(n³)`. Like matrix chain, the score `v_i v_k v_j` permits Knuth-style analysis when it satisfies QI, though the geometric scores do not always; verify before optimizing.

**Why the bijection matters pedagogically.** Recognizing that matrix chain, polygon triangulation, and binary-tree-shaped problems (optimal BST) are all Catalan-structured interval DPs lets you transfer intuition and optimizations across them. The "outermost operation = the structure containing the boundary" insight is the unifying combinatorial principle behind the entire split-point family.

---

## 17. Relationship to Tree DP and the Interval-as-Subtree View

Interval DP is, for many problems, **tree DP on an implicit binary tree** whose leaves are the sequence elements.

**Observation 17.1.** A split-point recurrence `f(i,j) = opt_k f(i,k) + f(k+1,j) + cost` is exactly a recursion over all binary trees with leaves `i, …, j`: choosing `k` chooses the root's left/right subtree partition. The optimal `f(0,n-1)` is the optimal binary tree over the leaf sequence, and the `split[i][j]` table *is* that tree's shape.

**Corollary 17.2.** Optimal BST is literally a tree-DP (the tree is the search tree); matrix chain's optimal `split` table is the expression tree of the cheapest parenthesization; polygon triangulation's apex choices form the dual tree of the triangulation. The Catalan count (Section 11, 16) counts these binary trees.

**Why this matters.** The interval-DP `Θ(n³)` is the cost of choosing the optimal binary tree by trying every root for every contiguous leaf-range. When the cost is QI-convex, the optimal root is monotone (Section 9), which is the tree-shaped statement of Knuth's optimization: the root of `[i..j]` lies between the roots of `[i..j-1]` and `[i+1..j]`. This monotone-root property is what Knuth originally proved for BSTs and Yao abstracted to QI.

**Contrast with genuine tree DP.** When the tree is *given* (a rooted tree input, not chosen), tree DP is `O(n)` or `O(n²)` — there is no root to optimize over. Interval DP is the harder case where the tree *structure itself* is the optimization variable, ranging over `Θ(4ⁿ/n^{1.5})` shapes, collapsed to `Θ(n³)` (or `Θ(n²)`) by overlapping subproblems and (optionally) monotonicity.

---

## 18. A Catalog of Interval-DP Transition Costs

The unifying recurrence `f(i,j) = opt_k g(f(i,k), f(k+1,j)) ⊕ cost(i,k,j)` instantiates to a wide family; cataloguing the `(opt, combine, cost)` triples clarifies the design space.

| Problem | `opt` | combine of halves | `cost(i,k,j)` | complexity |
|---------|-------|-------------------|---------------|-----------|
| Matrix chain | min | `+` | `r_i r_{k+1} r_{j+1}` | `Θ(n³)`/`Θ(n²)` |
| Optimal BST | min | `+` | `W(i,j)` (range freq sum) | `Θ(n³)`/`Θ(n²)` |
| Stone merging (adjacent) | min | `+` | `sum(i..j)` | `Θ(n³)`/`Θ(n²)` |
| Polygon triangulation | min | `+` | `score(i,k,j)` | `Θ(n³)` |
| Burst balloons | max | `+` | `a_i a_k a_j` (last) | `Θ(n³)` |
| Count BSTs / triangulations | (sum) | `×` then `+` | `1` | `Θ(n²)` (Catalan) |
| Boolean parenthesization | (sum) | combine truth-counts | operator at `k` | `Θ(n³)` |
| Stone game (take ends) | max | negate-opponent | `v_i` or `v_j` | `Θ(n²)` |
| Palindrome min-cut | min | linear cut layer | `[pal(i,j)]` | `Θ(n²)` |
| Removing boxes | max | `+` (3D) | `(c+1)²` | `Θ(n⁴)` |

**Reading the catalog.** The `opt` column is min/max for optimization, "sum" for counting. The combine is almost always `+` (additive costs) but `×`-then-`+` for counting (multiplication principle over independent sub-structures). The cost column carries the problem identity. The complexity column shows that transition cost (`O(n)` splits vs `O(1)` end-choices vs linear cut layer) and state dimension (2D vs 3D) jointly set the asymptotics. This table is the practical distillation of Sections 5–16: one skeleton, many instantiations, with `Θ(n²)`/`Θ(n³)`/`Θ(n⁴)` determined by the structure, not the problem's surface description.

---

## 19. Yao's Exchange Argument in Detail

Section 8 stated that QI on the weight `w` implies QI on the DP value `f` (the harder half of Theorem 8.3). Here is the structure of Yao's induction, the engine behind every Knuth-optimized interval DP.

**Goal.** Show `f(a,c) + f(b,d) ≤ f(a,d) + f(b,c)` for `a ≤ b ≤ c ≤ d`, assuming `w` satisfies QI + MI and `f(i,j) = min_{i ≤ k < j}(f(i,k)+f(k+1,j)) + w(i,j)`.

**Induction on `d − a`** (the size of the outer interval).

*Base.* When `b = c` the inequality reduces to `f(a,c)+f(c,d) ≤ f(a,d)+f(c,c)`; with `f(c,c)` the base value this follows from QI of `w` and the single-split structure.

*Step.* Let `y = K(b,d)` and `z = K(a,c)` be the optimal splits of the two "inner" intervals. Two cases by the relative order of `y, z`:

- **Case `z ≤ y`.** Split `f(a,d)` at `y` and `f(b,c)` at `z` (both feasible splits, not necessarily optimal, so they give *upper* bounds on `f(a,d)`, `f(b,c)`'s complements — actually lower-bounding the RHS appropriately). Apply the inductive QI of `f` on the sub-intervals `[a,y],[b,y]` and `[z+1,c],[z+1,d]`, plus QI of `w`, and recombine. The cross terms cancel by the exchange.
- **Case `z > y`.** Symmetric, splitting at the other indices.

In each case the inequality for the larger interval follows from the inductive hypothesis on strictly smaller intervals plus QI of `w`. ∎ (sketch)

**Why it is delicate.** The argument hinges on choosing *feasible (not optimal)* splits for the RHS intervals so the recurrence gives an upper bound, then using the optimal splits of the LHS intervals and the inductive QI to dominate. Getting the inequality directions right is the entire subtlety — which is why practitioners verify QI empirically (Section 12.2) rather than re-deriving Yao's argument per problem.

**Yao's generalization.** Yao (1980) showed the same QI⇒monotone-argmin⇒`O(n²)` chain works for *any* DP of the shape `c(i,j) = min_{i<k≤j}(c(i,k-1)+c(k,j)) + w(i,j)` with `w` QI-convex and monotone — not just BSTs. This is the precise theorem sibling `11-knuth-optimization` operationalizes, and the reason a single condition (QI) certifies the speedup across matrix chain, optimal BST, stone merging, and any other range-sum-cost interval DP.

---

## 19b. Lower Bounds and the Limits of Optimization

It is worth being precise about *what cannot be improved*, to avoid chasing impossible speedups.

**Proposition 19b.1 (State lower bound).** Any algorithm that must report `f(i,j)` for all intervals (e.g. to answer arbitrary sub-range queries) requires `Ω(n²)` time and space, simply to produce the `Θ(n²)` outputs.

**Proof.** There are `Θ(n²)` distinct intervals; writing each answer is one operation; storing them is one cell each. Hence `Ω(n²)` for both, regardless of cleverness. ∎

**Consequence.** Knuth's `Θ(n²)` is *optimal up to constants* for the all-intervals version of QI-convex problems — you cannot beat the output size. For the single-answer version `f(0,n-1)`, the lower bound is weaker (`Ω(n)` to read the input), and whether `o(n²)` is achievable for, say, matrix chain's single answer under QI is a more delicate question; the known algorithms are `Θ(n²)`.

**Proposition 19b.2 (No general subcubic without structure).** For interval DPs whose cost `cost(i,k,j)` genuinely depends on `k` in an unstructured way (not endpoint-only, not QI-convex), no `o(n³)` algorithm is known, and the `Θ(n³)` of trying all splits per cell is the natural bound. The dependence on `k` is what blocks the monotone-split window.

**Why removing-boxes resists.** The 3D variant's `Θ(n⁴)` has no known general reduction because the carry dimension is *essential context* (Theorem 15.1), and QI does not lift to the augmented state. Conjecturally, problems requiring genuine cross-split context occupy a strictly harder regime than the 2D QI-convex classics. This places the interval-DP family on a spectrum: `Θ(n²)` (QI-convex, or `O(1)`-transition like stone game), `Θ(n³)` (general split), `Θ(n⁴)` (context-carrying 3D) — with the structural property of the cost, not the surface problem, determining the tier.

**Practical takeaway.** Before optimizing, locate your problem on this spectrum: (1) Is the transition `O(1)` (end-choice) or linear-cut? Then it is already `Θ(n²)`. (2) Is the cost endpoint-only and QI-convex? Then Knuth gives `Θ(n²)`. (3) Otherwise it is `Θ(n³)` and the lever is constants/parallelism. (4) Does the merge need external context? Then it is `Θ(n⁴)` and the lever is bounding the extra dimension. No amount of micro-optimization moves a problem between tiers — only a change in the cost's structure does.

---

## 20. Summary

- **State = interval, transition = split (or last element).** The recurrence `f(i,j) = opt_k f(i,k) ⊕ f(k+1,j) ⊕ cost(i,k,j)` is correct under split-decomposable optimal substructure (Theorem 2.2), proved by induction on interval length with a cut-and-paste exchange; the load-bearing hypothesis is that the merge cost depends only on `(i,k,j)`, not on sub-solution internals.
- **Increasing-length order is a topological sort** of the sub-interval dependency DAG (Theorem 3.2); the naive ascending-`i`-ascending-`j` order is *not* valid.
- **Baseline complexity is `Θ(n³)` time, `Θ(n²)` space** (Theorem 4.1), with exactly `\binom{n+1}{3} ≈ n³/6` core iterations; an `O(1)` cost (via prefix sums for range aggregates) is required to avoid a hidden `Θ(n⁴)`.
- **Matrix chain** (Theorem 5.1) and **optimal BST** (Theorem 6.1) are the canonical split-point DPs; the optimal-BST `+W(i,j)` "everyone goes one level deeper" term is the prototypical endpoint-only cost.
- **Burst balloons** (Theorem 7.1) requires the **last-operated-element** decomposition: fixing the last burst freezes its neighbors at the stable boundaries, restoring subproblem independence that a first-element split would destroy.
- **The quadrangle inequality** `w(a,c)+w(b,d) ≤ w(a,d)+w(b,c)` plus monotonicity forces the **optimal split to be monotone** `K(i,j-1) ≤ K(i,j) ≤ K(i+1,j)` (Theorems 8.3, Lemma 9.1); a range-sum weight satisfies QI with equality, so stone merging, optimal BST, and matrix chain qualify.
- **Knuth's optimization** uses that monotonicity to telescope the per-cell scan to `Θ(n²)` (Theorem 8.4); the **divide-and-conquer optimization** uses the *same* monotonicity for the layered partition shape `dp[t][j] = min_i dp[t-1][i] + C(i,j)` to get `Θ(mn log n)` (Theorem 10.2). QI is the shared convexity behind both siblings (`11`, `12`).
- **The 3D barrier:** when the merge cost depends on external context (removing boxes), no 2D state is correct; lifting the context into a `carry` dimension restores correctness at `Θ(n⁴)`, a strictly harder regime with no general QI reduction.

### Complexity Cheat Table

| DP shape | Condition | Complexity |
|----------|-----------|-----------|
| Interval `f(i,j)=min_k f(i,k)+f(k+1,j)+cost(i,k,j)` | general `O(1)` cost | `Θ(n³)` |
| Interval, endpoint-only `w(i,j)` | `w` satisfies QI + MI | `Θ(n²)` (Knuth) |
| Layered `dp[t][j]=min_i dp[t-1][i]+C(i,j)` | monotone argmin (e.g. `C` QI) | `Θ(mn log n)` (D&C) |
| Last-element (burst balloons) | merge depends on `(i,k,j)` | `Θ(n³)` |
| 3D interval (removing boxes) | merge needs external carry | `Θ(n⁴)` |
| Naive parenthesization search | — | `Θ(4^n / n^{1.5})` (Catalan) |

### Closing Notes

- **Optimal substructure** (Section 2) is *the* correctness hypothesis; its failure (external-context merge cost) is exactly what forces extra state dimensions.
- **Increasing-length order** (Section 3) is the canonical topological sort; understanding the dependency DAG explains why the naive loop order is wrong.
- **The quadrangle inequality** (Section 8) is the single most important structural condition in interval DP: it unifies Knuth and D&C optimization through monotonicity of the optimal split (Section 9), and it is a property to *verify*, never assume.
- **The Catalan blow-up** (Section 11) quantifies the exponential-to-polynomial gain that makes interval DP worthwhile.

Foundational references: Knuth, *Optimum binary search trees* (Acta Informatica, 1971); Yao, *Efficient dynamic programming using quadrangle inequalities* (STOC 1980); CLRS, *Introduction to Algorithms*, Ch. 15 (matrix chain, optimal BST); the divide-and-conquer optimization literature in competitive-programming references; and sibling topics `11-knuth-optimization` and `12-divide-and-conquer-optimization`.

### Theorem Index

For quick reference, the load-bearing results proved above:

| Result | Statement | Section |
|--------|-----------|---------|
| Thm 2.2 | Recurrence correct under split-decomposable optimal substructure | 2 |
| Thm 3.2 | Increasing-length order is a valid topological fill | 3 |
| Thm 4.1 | Baseline is `Θ(n³)` time, `Θ(n²)` space | 4 |
| Thm 5.1 | Matrix-chain recurrence and its correctness | 5 |
| Thm 6.1 | Optimal-BST recurrence with `+W(i,j)` | 6 |
| Thm 7.1 | Burst-balloons last-element decomposition | 7 |
| Thm 8.3 | QI ⇒ `f` inherits QI ⇒ monotone split | 8 |
| Lem 9.1 | Optimal split is monotone under QI | 9 |
| Thm 10.2 | D&C optimization condition and `Θ(mn log n)` | 10 |
| Thm 13.2/13.3 | Palindrome interval table + linear cut DP, `Θ(n²)` | 13 |
| Thm 14.1 | Stone game min-max recurrence, `Θ(n²)` | 14 |
| Thm 15.1/15.2 | Removing boxes needs 3D state, `Θ(n⁴)` | 15 |
| Thm 16.1 | Polygon triangulation = Catalan-structured interval DP | 16 |
| Prop 19b.1 | `Ω(n²)` lower bound for all-intervals output | 19b |

The throughline: every theorem is a consequence of one of three ideas — optimal substructure (correctness), the sub-interval dependency order (validity of the fill), and quadrangle convexity (the speedups). Master those three and the entire interval-DP theory follows.
