# Tree DP — Mathematical Foundations and Correctness Proofs

## Table of Contents
1. Formal Definitions
2. Optimal Substructure on Rooted Subtrees
3. Maximum Independent Set on a Tree (Correctness Proof)
4. Tree Diameter via DP (Correctness Proof)
5. Subtree Aggregates and Counting
6. The Rerooting Theorem (Correctness Proof)
7. In-and-Out DP as a Distributive Decomposition
8. Tree Knapsack: the O(n·W) Subtree-Size Argument
9. Independence Number, Matchings, and Domination
10. Lower Bounds and What Tree Structure Buys
11. Summary

---

## 1. Formal Definitions

Let `T = (V, E)` be a tree: a connected undirected graph with `|V| = n` vertices and exactly `n - 1` edges, hence acyclic, with a **unique path** between any two vertices.

**Definition 1.1 (Rooted tree).** Fix a root `r ∈ V`. The rooting orients every edge away from `r`. For `v ≠ r`, its **parent** `par(v)` is the neighbor on the unique `v–r` path; the other neighbors are its **children** `Ch(v)`. The root has no parent.

**Definition 1.2 (Subtree).** The **subtree** `T_v` rooted at `v` is the set of all `u` whose unique `u–r` path passes through `v`, equivalently all descendants of `v` together with `v`. `T_r = V`. The subtrees of the children of `v` partition `T_v \ {v}`:

```
T_v = {v} ⊎ ⊎_{c ∈ Ch(v)} T_c          (disjoint union)
```

This disjointness — a direct consequence of acyclicity — is the structural fact every proof below leans on.

**Definition 1.3 (Tree DP).** A *tree dp* assigns to each `v` a **state** `dp[v]` drawn from a state space `S`, of the form

```
dp[v] = COMBINE_{c ∈ Ch(v)} TRANSFORM(dp[c]),   with a base value at leaves,
```

where `COMBINE : S × S → S` is associative and commutative and `TRANSFORM : S → S` encodes the parent–child edge. The **answer** is a function of `dp[r]` (root-defined problems) or `max/min/Σ_v f(dp[v])` (anywhere-defined problems).

**Definition 1.4 (Walk / path / chain in a rooted tree).** A **downward chain** from `v` is a path `v = u_0, u_1, …, u_t` with `u_{i+1} ∈ Ch(u_i)`. Its **length** is the number of edges `t`. The **height** `down[v]` is the maximum length of a downward chain from `v` (0 for a leaf).

**Definition 1.4.5 (Path through a vertex).** For a path `P` in `T`, its **top** is the unique vertex of minimum depth on `P` (well-defined: depth is a function on a finite vertex set, and a path is connected, so its depths attain a unique minimum at the vertex closest to the root). Every path is determined by its top together with the (at most two) downward chains descending from it — the structural basis of the diameter dp (Theorem 4.1).

**Notation.** `cnt[v] = |T_v|` is the subtree size; `dist(u, v)` the number of edges on the unique `u–v` path; `[P]` the Iverson bracket. Weighted variants replace edge counts by edge weights and node counts by node weights.

**Definition 1.5 (Euler-tour flattening / subtree-as-interval).** A pre-order DFS assigns each `v` an entry time `tin[v]` and exit time `tout[v]`. Then `u ∈ T_v ⟺ tin[v] ≤ tin[u] ≤ tout[v]`: a subtree is a **contiguous interval** of pre-order indices. This linearization is the bridge from tree dp to array data structures (Fenwick/segment trees) when subtree aggregates must support point updates and subtree queries; it does not change the dp recurrences but it does change the *data structure* used to evaluate them.

**Lemma 1.6 (Acyclicity ⇒ disjoint child subtrees).** For distinct children `c, c'` of `v`, `T_c ∩ T_{c'} = ∅`, and there is **no edge** between `T_c` and `T_{c'}`.
**Proof.** If `x ∈ T_c ∩ T_{c'}`, the unique `x–r` path would pass through both `c` and `c'` (Definition 1.2), impossible since a path through `v`'s subtree enters via exactly one child. If an edge `(a, b)` joined `a ∈ T_c` and `b ∈ T_{c'}`, then `a–c–v–c'–b–a` (closing via the edge) would be a cycle, contradicting that `T` is acyclic. ∎ This lemma is invoked, sometimes silently, in every correctness proof below.

---

## 2. Optimal Substructure on Rooted Subtrees

The engine of every tree dp is that the optimal/aggregate answer for `T_v` is determined by the answers for the `T_c`, `c ∈ Ch(v)`. We formalize the property that makes dp valid.

**Why "rooted" matters.** An unrooted tree has no parent/child relation, so there is no notion of "subtree of `v`" and no induction variable. Rooting (Definition 1.1) imposes a partial order — the **ancestor order** — and tree dp is dynamic programming *along that partial order*, with leaves as minimal elements (base cases) and the root as the maximal element (final answer). The choice of root is free for root-defined objectives (any root works; the global answer is the same), but it *does* change intermediate `dp[v]` values; rerooting (Section 6) is precisely the study of how those values transform under a change of root.

**Definition 2.1 (Subtree-local objective).** A problem has a **subtree-local objective** if there is a function `Φ` mapping a rooted subtree to a value, and a finite state `dp[v] ∈ S` summarizing `T_v`, such that:

1. `dp[v]` is computable from `{dp[c] : c ∈ Ch(v)}` (and `v`'s local data) alone, and
2. the global answer is recoverable from `dp[r]` (or from `{dp[v]}`).

**Definition 2.1.5 (Decomposable objective).** An objective `Φ` is **decomposable** over the rooted-subtree partition if there exist a combine `⊙` and a node-local term `τ(v)` such that `Φ(T_v) = τ(v) ⊙ ⊙_{c ∈ Ch(v)} ψ(Φ(T_c))` for some edge-transform `ψ`. Additive (`⊙ = +`), multiplicative (`⊙ = ×`), and extremal (`⊙ = max/min`) objectives are all decomposable; "the diameter" is decomposable once the state is enriched to carry the two longest chains (Section 4).

**Theorem 2.2 (Optimal substructure).** If the objective decomposes additively/multiplicatively/by-extremum over the disjoint union `T_v = {v} ⊎ ⊎_c T_c`, and the contribution of each `T_c` to `dp[v]` depends on `T_c` only through `dp[c]`, then the recurrence of Definition 1.3 computes `dp[v]` correctly for all `v`, by induction on the height of `v`.

**Proof.** Induction on `height(v)`.
*Base:* a leaf has `Ch(v) = ∅`; `dp[v]` is the base value, correct by construction.
*Step:* assume `dp[c]` is correct for every child `c` (each of smaller height). By hypothesis (2), each `T_c`'s contribution to the objective on `T_v` is a function of `dp[c]`; by the disjoint-union decomposition (Definition 1.2) the contributions combine by the problem's `COMBINE`; hence `dp[v] = COMBINE_c TRANSFORM(dp[c])` (with `v`'s local term) equals the true value for `T_v`. ∎

The two hypotheses are exactly what you check when *designing* a state: **(1) richness** — `dp[v]` must contain everything the parent needs (no peeking at grandchildren); **(2) locality** — a child influences the parent only through `dp[c]`. The sections below verify these for the canonical problems.

**Proposition 2.3 (Each subtree solved once).** A post-order DFS evaluates `dp[v]` for every `v` exactly once, with total work `Σ_v (deg_T(v)) = 2(n-1) = O(n)` for `O(1)`-combine problems.
**Proof.** The recursion tree of the DFS is isomorphic to `T` rooted at `r`: each node is entered once (the `parent` guard prevents re-entry along the upward edge), and the work at `v` is proportional to the number of children it iterates, `|Ch(v)|`. Summing, `Σ_v |Ch(v)| = n - 1` (each non-root is some node's child exactly once), and counting the upward parent edges as well gives `2(n-1)` edge traversals. Hence `O(n)`. ∎

**Corollary 2.4 (No memoization, no overlap).** Unlike interval or subset DP, tree DP subproblems do **not** overlap: subtree `T_v` is referenced only by its unique parent `par(v)`. Therefore the post-order DFS needs no memo table beyond the `dp[]` array it is filling, and the order of evaluation (any valid post-order) is irrelevant to correctness because combines are associative/commutative (Definition 1.3). This is why the iterative reverse-pre-order evaluation of `senior.md` is correct: reverse pre-order is *a* post-order, and any post-order suffices.

**Definition 2.5 (Interface state).** The **interface** of `T_v` toward the rest of the tree is the minimal information about `T_v` that any algorithm needs to compute the global objective, given the complement `V \ T_v`. The dp state `dp[v]` must contain at least the interface. For MIS the interface is `(f₀(v), f₁(v))` (two reals); for a problem whose answer depended on the full multiset of subtree depths, the interface — and hence the state — would be that multiset. **Designing a tree dp is exactly identifying the interface and proving it finite/small.**

**Remark (the contrast with DAGs and general graphs).** On a general DAG, a "subproblem" (a node) may be reachable along many paths, so memoization is required to avoid recomputation and the recursion tree is *not* isomorphic to the graph. On a tree, the unique-path property makes the recursion tree equal to the tree itself, so **no memoization table is needed** — the post-order pass already visits each subproblem once. This is a structural simplification specific to trees (and, more generally, to bounded-treewidth bag dps).

---

## 3. Maximum Independent Set on a Tree (Correctness Proof)

**Problem.** With vertex weights `w : V → ℝ`, find an independent set `I ⊆ V` (no two adjacent) maximizing `Σ_{v∈I} w(v)`.

**State.** For each `v` define two quantities over the subtree `T_v`:
- `f₁(v)` = max weight of an independent set of `T_v` that **contains** `v`;
- `f₀(v)` = max weight of an independent set of `T_v` that **excludes** `v`.

**Recurrence.**
```
f₁(v) = w(v) + Σ_{c ∈ Ch(v)} f₀(c)
f₀(v) =        Σ_{c ∈ Ch(v)} max( f₀(c), f₁(c) )
```
Answer: `max(f₀(r), f₁(r))`.

**Lemma 3.1 (Decomposition).** An independent set `I` of `T_v` is exactly a choice, for each child `c`, of an independent set `I_c` of `T_c`, plus optionally `v` itself, subject to: if `v ∈ I` then no child `c` may have `c ∈ I_c`. Moreover `w(I) = [v∈I]·w(v) + Σ_c w(I_c)`.

**Proof.** The subtrees `T_c` are pairwise disjoint and the only edges between them and `v` are the edges `(v, c)`. An independent set within `T_v` therefore restricts to an independent set within each `T_c` independently, and the *only* cross-constraint is on the edges `(v, c)`: if `v` is chosen, then no `c` adjacent to it may be chosen (i.e. `c ∉ I_c` for the chosen child's own membership). There are no edges between distinct `T_{c}` and `T_{c'}` (any such edge plus the two paths to `v` would form a cycle, contradicting acyclicity). Weights add by disjointness. ∎

**Theorem 3.2.** The recurrence computes `f₁, f₀` correctly; hence `max(f₀(r), f₁(r))` is the maximum-weight independent set of `T`.

**Proof.** Induction on height, invoking Theorem 2.2. Leaf base: `f₁(leaf)=w(leaf)`, `f₀(leaf)=0`, both correct (empty children). Step: assume correctness for all children.
- *Case `v` included.* By Lemma 3.1 no child may include itself, so each `T_c` contributes its best **`v`-child-excluded** set, i.e. `f₀(c)`; independence across subtrees is automatic. Maximizing each term independently (the choices are independent across disjoint subtrees) gives `f₁(v) = w(v) + Σ_c f₀(c)`.
- *Case `v` excluded.* Each child `c` is unconstrained by `v`, so contributes the better of its two options, `max(f₀(c), f₁(c))`; summing the independent maxima gives `f₀(v)`.
Both match the recurrence; the hypotheses of Theorem 2.2 hold because each child influences `v` only through the pair `(f₀(c), f₁(c))` — a finite, sufficient summary. The root answer is `max(f₀(r), f₁(r))` because `r`'s set either contains `r` or not. ∎

**Remark (why one number is insufficient).** Keeping only "best IS of `T_c`" loses the information of whether `c` was used, which the parent needs when it decides to include `v`. The two-state design is the minimal sufficient statistic — exactly hypothesis (1) of Theorem 2.2 made concrete.

**On the empty tree and the singleton.** For `n = 1` the root is a leaf and every recurrence reduces to its base value (`f₁(r) = w(r)`, `f₀(r) = 0`, `down[r] = 0`, diameter `= 0`). These degenerate cases are not exceptions to the theorems — they are the base of the induction, handled by the *same* code path (empty child loops), never a special case. An `if n == 1` branch is a code smell suggesting the recurrence was written assuming at least one child.

### 3.1 Worked Verification

Take the tree on `{0,…,5}` with edges `0–1, 0–2, 1–3, 1–4, 2–5` and weights `w = (3,2,1,1,3,1)`, rooted at `0`. Applying the recurrence bottom-up:

```
leaves:  f₀(3)=0 f₁(3)=1     f₀(4)=0 f₁(4)=3     f₀(5)=0 f₁(5)=1
node 1:  f₁(1)=2 + f₀(3)+f₀(4) = 2+0+0 = 2
         f₀(1)=max(0,1)+max(0,3) = 1+3 = 4
node 2:  f₁(2)=1 + f₀(5) = 1
         f₀(2)=max(0,1) = 1
node 0:  f₁(0)=3 + f₀(1)+f₀(2) = 3+4+1 = 8
         f₀(0)=max(4,2)+max(1,1) = 4+1 = 5
answer = max(f₀(0), f₁(0)) = max(5, 8) = 8.
```

The optimal set realizing `8` is `{0, 3, 4, 5}` (`3+1+3+1`). An exhaustive search over all `2^6 = 64` subsets, discarding those containing an adjacent pair, confirms `8` is the maximum — the empirical anchor for Theorem 3.2.

**Reconstruction (witness recovery).** The proof certifies the *value*; to recover the *set*, store at each node which branch (`f₀` or `f₁`) was optimal for the parent's decision, then walk top-down: at the root pick `argmax(f₀(r), f₁(r))`; if a node is "included", recurse into each child forcing its `f₀` branch; if "excluded", recurse forcing each child's own `argmax`. This second pass is `O(n)` and produces a concrete maximum independent set, proving the theorem is constructive, not merely existential.

**Uniqueness counting (a bonus state).** A common interview follow-up is "how many maximum independent sets are there?" Augment each state with a count: alongside `f₀, f₁` store `nf₀, nf₁`, the number of optimal sets achieving each. The count combines multiplicatively over children when their optimal choices are independent, and additively across ties (when `f₀(c) = f₁(c)`, both child branches are optimal, so add their counts). This is the `(max, +)`-with-tie-counting semiring — the same decomposition (Lemma 3.1) carries the enriched state, illustrating once more that the *structure* is fixed and only the *algebra* varies.

---

## 4. Tree Diameter via DP (Correctness Proof)

**Problem.** The **diameter** is `D = max_{u,v} dist(u, v)` (edge-count; the weighted case replaces edge counts by weights ≥ 0 is not required — the dp handles arbitrary edge weights as shown).

**Key structural fact.** Root the tree arbitrarily. Any path `P` in `T` has a unique vertex `t` of **minimum depth** on it (its *top*). The path descends from `t` into at most two distinct child subtrees of `t` (it cannot use three, else `t` would have degree-3 *on the path*, impossible for a simple path).

**State.** `down[v]` = length of the longest downward chain from `v` (0 at leaves):
```
down[v] = max( 0, max_{c ∈ Ch(v)} (down[c] + 1) ).
```
While computing `down[v]`, let `b₁ ≥ b₂` be the two largest values among `{down[c] + 1 : c ∈ Ch(v)}` (taking `0` if fewer than two children). Maintain a global `D := max(D, b₁ + b₂)`.

**Theorem 4.1.** After one post-order DFS, `D` equals the tree diameter.

**Proof.**
*(`D` is achievable.)* For any vertex `v`, `b₁ + b₂` is the length of an actual path: take the longest downward chain into one child subtree (length `b₁`) and the longest into another (length `b₂`), joined at `v`. These two chains live in disjoint subtrees (distinct children), so their concatenation through `v` is a simple path of `b₁ + b₂` edges. Hence `D ≤ diameter` is never violated upward — every value `D` takes is a real path length, so `D ≤ diameter`.

*(`D` reaches the diameter.)* Let `P` be a diameter path and `t` its top (min-depth vertex). `P` descends from `t` into one or two child subtrees. If two, the two halves are downward chains from `t` into distinct children of lengths `ℓ₁, ℓ₂`; by definition of `down`, `down[c_i] + 1 ≥ ℓ_i`, and `t`'s two largest such values satisfy `b₁ + b₂ ≥ ℓ₁ + ℓ₂ = |P| = diameter`. If `P` descends into one child (i.e. `t` is an endpoint), then `|P| = b₁ ≤ b₁ + b₂`. Either way, when the DFS processes `t`, `D ≥ b₁ + b₂ ≥ diameter`. Combined with the previous direction, `D = diameter`. ∎

**Corollary 4.2 (Return value vs global).** The DFS **returns `b₁` (= `down[v]`)** to the parent — a single chain — while it **records `b₁ + b₂`** globally. These are different quantities; returning `b₁ + b₂` upward would let a non-simple "path" bend twice through one vertex, breaking simplicity. This is the formal reason for the most common diameter bug.

**Remark (weighted edges).** Replacing "`+1`" by edge weight `w(v, c)` and "`0`" base by `0` proves the same theorem for weighted trees, including **negative** weights, because the proof never assumes non-negativity — unlike the two-BFS method, which requires `w ≥ 0`.

### 4.1 Worked Verification

On the tree `0–1, 0–2, 1–3, 1–4, 2–5` (unit edges), root at `0`:

```
down[3]=down[4]=down[5]=0  (leaves)
node 1: child chains {down[3]+1, down[4]+1} = {1,1}; b1=1,b2=1; D ← 1+1=2; down[1]=1
node 2: child chains {down[5]+1} = {1};          b1=1,b2=0; D ← max(2,1)=2; down[2]=1
node 0: child chains {down[1]+1, down[2]+1} = {2,2}; b1=2,b2=2; D ← max(2,4)=4; down[0]=2
diameter = D = 4.
```

The realizing path is `3 – 1 – 0 – 2 – 5` (4 edges). Note the diameter is recorded at node `0` (its *top*), where the two longest chains `2 + 2` meet — precisely the second half of Theorem 4.1. Returning `down[0]=2` (one chain) up versus recording `b1+b2=4` (two chains) globally is Corollary 4.2 in action: had we returned `4`, an ancestor could illegally extend a path that already bends through `0`.

### 4.1.5 The Two-BFS Method and Why the DP Is More General

A classical alternative computes the diameter with two graph searches: from any vertex `s`, find the farthest vertex `u`; then from `u`, find the farthest vertex `w`; the path `u–w` is a diameter.

**Theorem 4.3 (Two-BFS correctness, non-negative weights).** If all edge weights are non-negative, the farthest vertex `u` from any start `s` is an endpoint of some diameter; hence the farthest vertex from `u` gives the diameter.
**Proof idea.** One shows `u` cannot be a strict interior vertex of every diameter: if it were, a standard exchange argument (using non-negativity and the unique-path property) produces a longer path, contradiction. The full argument is a clean induction on the tree structure. ∎

**Why the DP is strictly more general.** The exchange argument *requires non-negativity* — with a negative edge, the "farthest" vertex need not lie on a diameter, and two-BFS can return a wrong answer. The DP of Theorem 4.1 never assumed non-negativity (it only takes maxima of chain sums), so it handles arbitrary real weights, and it additionally yields per-node downward heights useful for rerooting (eccentricity). The trade-off: two-BFS is marginally simpler to code when weights are non-negative; the DP is the safe default and the one that composes with rerooting.

### 4.2 Why Three Chains Are Forbidden

A simple path visits each vertex at most once, so at its top `t` it can use at most **two** edges incident to `t` (one entering each of two descending branches). If the path tried to use three downward branches from `t`, vertex `t` would have degree 3 *within the path*, contradicting that a path is a sequence (degree ≤ 2 internally). This is why the dp takes the **two** largest child chains and no more — a structural, not heuristic, choice.

---

## 5. Subtree Aggregates and Counting

**Subtree size.** `cnt[v] = 1 + Σ_c cnt[c]`. By induction and disjointness (Definition 1.2), `cnt[v] = |T_v|`. **Subtree sum:** `sum[v] = a(v) + Σ_c sum[c]` for node attribute `a`.

**Counting independent sets (product form).** Let `g₀(v), g₁(v)` count independent sets of `T_v` with `v` unchosen / chosen.
```
g₁(v) = Π_c g₀(c)
g₀(v) = Π_c ( g₀(c) + g₁(c) )
```
**Proof.** By Lemma 3.1, choices in distinct child subtrees are independent, so counts **multiply** (product rule). If `v` is chosen, each child must be unchosen: factor `g₀(c)`. If `v` is unchosen, each child independently chooses either state: factor `g₀(c) + g₁(c)`. Total over `T_r`: `g₀(r) + g₁(r)`. Working mod a prime `p` preserves the ring operations, so the recurrence holds for residues. ∎

The optimization MIS (Section 3) and the counting version share the *same decomposition* (Lemma 3.1); they differ only in the semiring: `(max, +)` for optimization, `(+, ×)` for counting — the same duality seen across DP.

### 5.1 Worked Count

On the path `0–1–2` rooted at `0`:

```
leaf 2: g₀(2)=1, g₁(2)=1
node 1: g₁(1)=g₀(2)=1;  g₀(1)=g₀(2)+g₁(2)=2
node 0: g₁(0)=g₀(1)=2;  g₀(0)=g₀(1)+g₁(1)=2+1=3
total = g₀(0)+g₁(0) = 3+2 = 5.
```

The 5 independent sets of `P₃` are `∅, {0}, {1}, {2}, {0,2}` — matching the count. (For a path `Pₙ`, the number of independent sets is the Fibonacci number `F_{n+2}`; here `n=3` gives `F₅ = 5`, a classic identity recovered by the tree-dp recurrence specialized to a path.)

### 5.2 The Semiring Abstraction Made Precise

Both recurrences instantiate a single template over a commutative semiring `(R, ⊕, ⊗)`:

```
A₁(v) = w(v) ⊗ ⊗_c A₀(c)                       # "v in": multiply/add v, combine excluded children
A₀(v) = ⊗_c ( A₀(c) ⊕ A₁(c) )                   # "v out": combine children's better/total
answer = A₀(r) ⊕ A₁(r).
```

For `(R, ⊕, ⊗) = (ℝ, max, +)` with `w(v)` the weight, this is weighted MIS (Section 3). For `(ℤ_p, +, ×)` with `w(v) = 1`, this is the count mod `p` (Section 5). The correctness proof (Lemma 3.1 plus induction) is **semiring-agnostic**: it only uses that `⊗` distributes over `⊕` and both are associative/commutative, so a single proof discharges both problems. This is the formal sense in which "optimize" and "count" are the same algorithm under different algebra.

### 5.3 Counting Proper Colorings (a Higher-State dp)

**Problem.** Count proper colorings of `T` with `k` colors (adjacent vertices differ), mod `p`. A *closed form* exists — `k·(k-1)^{n-1}` — but deriving it as a tree dp illustrates a state indexed by a color.

**State.** `c[v][a]` = number of colorings of `T_v` with `v` receiving color `a`.

**Recurrence.**
```
c[v][a] = Π_{child c'} ( Σ_{b ≠ a} c[c'][b] ).
```
**Proof.** Color `v` with `a`. Each child subtree is colored independently (disjointness), and the only constraint coupling `v` to a child `c'` is that `c'`'s color `b` differs from `a`; so the child contributes `Σ_{b≠a} c[c'][b]`. Independence across children multiplies the factors (product rule). ∎ The answer is `Σ_a c[r][a]`.

**Symmetry collapse.** Because the recurrence is symmetric in the colors, `Σ_{b≠a} c[c'][b] = (Σ_b c[c'][b]) - c[c'][a]`, and one proves by induction that `c[v][a]` is independent of `a` for fixed subtree-shape only when the tree is vertex-transitive — in general keep the full `O(k)` state per node, giving an `O(n·k)` dp. Specializing and telescoping recovers the closed form `k·(k-1)^{n-1}`: the root has `k` choices, every other vertex has `(k-1)` choices given its parent's color. The dp is the *constructive* proof of that product formula.

**State-size lesson.** Here the per-node state is a vector of length `k`, not a constant. This is still a valid tree dp (Theorem 2.2 holds), but the complexity carries the state size: `O(n·k)` time. The general principle: **the per-node cost is the size of the interface state**, which is `O(1)` for MIS/diameter, `O(k)` for colorings, and `O(W)` for knapsack.

### 5.4 Generating-Function View of Subtree Aggregates

Some "count by a parameter" problems are cleanest as **polynomial states**. Let `P_v(x) = Σ_k a_{v,k} x^k` where `a_{v,k}` is the number of independent sets of `T_v` containing exactly `k` vertices. Then the include/exclude recurrence becomes a polynomial identity:

```
P_v^{(in)}(x)  = x · Π_c P_c^{(out)}(x)        # v chosen contributes x^1; children unchosen
P_v^{(out)}(x) =     Π_c ( P_c^{(in)}(x) + P_c^{(out)}(x) )
P_v(x) = P_v^{(in)}(x) + P_v^{(out)}(x).
```

The product of polynomials is exactly the convolution that "tracks the size parameter", and `[x^k] P_r(x)` is the number of size-`k` independent sets. Multiplying two degree-`d_a` and degree-`d_b` polynomials costs `O(d_a · d_b)`, and the degrees are bounded by subtree sizes — so the **identical pair-counting argument of Theorem 8.1** gives `O(n²)` total (or `O(n·K)` if only sizes up to `K` matter). Tree knapsack is the special case where the "polynomial" is indexed by weight and the coefficients are max-values under a `(max, +)` algebra instead of counts under `(+, ×)`. Seeing knapsack and counting-by-size as the **same convolution over different semirings** is the unifying professional insight.

**Corollary 5.5.** The independence polynomial of a tree is computable in `O(n²)` time; evaluating it at `x = 1` recovers the total count (Section 5), and reading individual coefficients answers "how many independent sets of each size".

### 5.6 Why the Convolution Bound Is the Crux

It is worth isolating the single fact that recurs across knapsack (Section 8), the independence polynomial (5.4), and any "track a parameter up to `K`" tree dp: **merging two polynomial/array states of degrees bounded by subtree sizes costs `Σ s_a · s_b = O(n²)` total, or `O(n·K)` capped at degree `K`.** This is the same lemma in three disguises. Recognizing it lets you state the complexity of a new parameter-tracking tree dp instantly: it is `O(n · min(n, K))` where `K` is the parameter cap, *provided* you cap the loops by subtree size. Forgetting the cap turns it into `O(n · K²)` and is the most common performance regression in tree-dp code. The professional habit: **the moment a tree dp carries an array indexed by a bounded parameter, cap the convolution by subtree size and cite Theorem 8.1 for the bound.**

---

## 6. The Rerooting Theorem (Correctness Proof)

**Goal.** Compute a per-node answer `ans[v]` that depends on the **whole tree as seen from `v`** — e.g. `S[v] = Σ_{u} dist(v, u)`, the sum of distances — for all `v` in `O(n)`.

**Setup.** Root at `0`. DFS1 (post-order) computes
```
cnt[v] = |T_v|,   down[v] = Σ_{u ∈ T_v} dist(v, u) = Σ_c ( down[c] + cnt[c] ).
```
**Lemma 6.1.** `S[0] = down[0]`, and the recurrence for `down` is correct.
**Proof.** `S[0]` sums distances to all `u ∈ T_0 = V`, which is `down[0]` by definition. For the recurrence: every `u ∈ T_c` is exactly one edge farther from `v` than from `c` (the edge `(v,c)` lies on the `v–u` path), so `Σ_{u∈T_c} dist(v,u) = Σ_{u∈T_c}(dist(c,u) + 1) = down[c] + cnt[c]`. Summing over children and adding the `dist(v,v)=0` term gives `down[v]`. ∎

**Theorem 6.2 (Reroot transfer).** For a child `c` of `v`,
```
S[c] = S[v] - cnt[c] + (n - cnt[c]).
```
**Proof.** Partition `V` by the edge `(v, c)`: the `cnt[c]` vertices of `T_c` (the side containing `c`) and the `n - cnt[c]` vertices on the other side (containing `v`). Moving the reference point from `v` to `c` along this edge:
- every `u ∈ T_c` becomes **one edge closer**: its distance drops by 1 (total drop `cnt[c]`);
- every `u ∉ T_c` becomes **one edge farther**: its distance rises by 1 (total rise `n - cnt[c]`).
No other distances change because the unique `u`–(reference) path either crosses edge `(v,c)` (then ±1 as above) or does not (then it is on one fixed side and changes by exactly the crossing count, which is 0). Hence `S[c] = S[v] - cnt[c] + (n - cnt[c])`. ∎

**Corollary 6.3 (Linear time).** DFS2 visits each edge once, doing `O(1)` work via Theorem 6.2, after the `O(n)` DFS1. Total `O(n)`, computing `S[v]` for **all** `v` — versus `O(n²)` for `n` independent root DFS runs. ∎

**Theorem 6.4 (Reroot is a telescoping over a spanning walk).** Order the nodes by a DFS pre-order `v_0 = r, v_1, …, v_{n-1}`. Each consecutive `(v_i, v_{i+1})` in the DFS either descends a tree edge or, conceptually, the recursion unwinds; the rerooting answers form a sequence in which each *parent→child descent* applies exactly one transfer (Theorem 6.2). Because every edge is descended exactly once in DFS2, the total number of transfers is `n - 1`, and the answers are produced by a single telescoping sweep.
**Proof.** DFS2 is a pre-order traversal; it emits `ans[c]` from `ans[par(c)]` the first (and only) time it descends edge `(par(c), c)`. The descents are in bijection with the `n-1` tree edges. Hence exactly `n-1` `O(1)` transfers, and `ans[v]` is well-defined for every `v` (the root's answer seeds the sweep). ∎

This "telescoping" framing generalizes: **any quantity whose value at adjacent roots differs by an `O(1)`-computable delta** can be rerolled in `O(n)`. Sum-of-distances has delta `(n - 2·cnt[c])`; the number of nodes at even depth, the sum of subtree-size-weighted contributions, and many others all admit such deltas. Identifying the delta is the entire creative step of a rerooting solution.

**General rerooting.** The same scheme works whenever the "up" contribution `up[v]` (everything outside `T_v`, entered through `par(v)`) can be formed in `O(1)`/`O(deg)` from the parent's state and the parent's other children. For a non-invertible `COMBINE` (e.g. `max`), "the parent's contribution excluding child `c`" is computed with **prefix/suffix accumulation** over the parent's children; for invertible `COMBINE` (sum, product over a field), one may subtract/divide. Correctness follows by the same disjoint-union argument applied to `V \ T_c`.

### 6.1 Worked Reroot

Tree `0–1, 0–2, 2–3, 2–4, 2–5` rooted at `0` (`n = 6`). DFS1:

```
cnt: leaf 1→1, leaves 3,4,5→1 each, node 2 → 1+1+1+1 = 4, node 0 → 1+1+4 = 6
down[2] = (down[3]+1)+(down[4]+1)+(down[5]+1) = 1+1+1 = 3
down[0] = (down[1]+1) + (down[2]+cnt[2]) = 1 + (3+4) = 8 = S[0].
```

So `S[0] = 8`: distances from `0` are `dist(0,1)=1, dist(0,2)=1, dist(0,3)=2, dist(0,4)=2, dist(0,5)=2`, summing to `8`. ✓ DFS2 transfers:

```
S[1] = S[0] - cnt[1] + (6 - cnt[1]) = 8 - 1 + 5 = 12
S[2] = S[0] - cnt[2] + (6 - cnt[2]) = 8 - 4 + 2 = 6
S[3] = S[2] - cnt[3] + (6 - cnt[3]) = 6 - 1 + 5 = 10
```

Check `S[2] = 6` directly: `dist(2,0)=1, dist(2,1)=2, dist(2,3)=1, dist(2,4)=1, dist(2,5)=1 → 6`. ✓ Each transfer is `O(1)`; six nodes' answers in two linear passes, exactly Corollary 6.3.

### 6.2 A Reusable Rerooting Invariant

For sum-of-distances the following identity must hold and makes a free unit test:

```
Σ_v S[v] = 2 · Σ_{unordered pairs {u,w}} dist(u, w),
```

because each pairwise distance is counted once from each endpoint. For the example: `8+12+6+10+10+10 = 56 = 2·28`, and indeed the 15 pairwise distances sum to `28`. Any implementation whose `Σ_v S[v]` is odd, or disagrees with a brute-force pair sum, has a rerooting bug (typically a sign error in the transfer or a double-counted child).

---

## 7. In-and-Out DP as a Distributive Decomposition

**Theorem 7.1.** Let the per-node answer factor as `ans[v] = H(down[v], up[v])`, where `down[v]` summarizes `T_v` and `up[v]` summarizes `V \ T_v` (entered through `par(v)`). If `down` satisfies a post-order recurrence and `up` satisfies a pre-order recurrence
```
up[c] = G( up[v], COMBINE_{c' ∈ Ch(v), c' ≠ c} TRANSFORM(down[c']) ),
```
then all `ans[v]` are computable in `O(n)` (with prefix/suffix to get the "all children except `c`" term in `O(deg)` per node, `O(n)` total).
**Proof sketch.** `down[v]` by Theorem 2.2. For `up`: `V \ T_c = (V \ T_v) ⊎ {v} ⊎ ⊎_{c'≠c} T_{c'}`, a disjoint union, so `up[c]` combines `up[v]` (the part above `v`) with `v` and `v`'s **other** children's subtrees — exactly the formula. Disjointness justifies combining; the prefix/suffix arrays compute the child-excluded combine in linear total time because `Σ_v deg(v) = 2(n-1)`. ∎

The decomposition `V = T_c ⊎ (V \ T_c)` is the whole content of "in-and-out": **in** = `down`, **out** = `up`, and they are disjoint and exhaustive by acyclicity.

### 7.1 Why Prefix/Suffix Is Necessary for Non-Invertible Combines

In the `up[c]` formula the term `COMBINE_{c' ≠ c} TRANSFORM(down[c'])` excludes the child `c` we are pushing to. If `COMBINE` is **invertible** (e.g. `+` over ℤ, or `×` over a field), we may compute the full combine `F = COMBINE_{all c'} TRANSFORM(down[c'])` once and recover "all but `c`" as `F ⊘ TRANSFORM(down[c])`, where `⊘` is the inverse operation, in `O(1)` per child, `O(deg)` per node.

If `COMBINE` is **not invertible** (e.g. `max`), no such inverse exists: knowing `max` of a set and one of its elements does not determine the `max` of the rest (the removed element might or might not have been the maximizer). The fix is **prefix/suffix maxima**: order `v`'s children `c_1, …, c_d`, precompute `pre[i] = COMBINE(t_1, …, t_i)` and `suf[i] = COMBINE(t_i, …, t_d)` where `t_j = TRANSFORM(down[c_j])`; then "all but `c_i`" `= COMBINE(pre[i-1], suf[i+1])` in `O(1)`. Building `pre`/`suf` is `O(deg)`, so total over the tree is `Σ_v O(deg(v)) = O(n)`.

**Proposition 7.2.** With prefix/suffix accumulation, general rerooting over any associative `COMBINE` runs in `O(n · cost(COMBINE))`.
**Proof.** DFS1 is `O(n)` by Proposition 2.3. DFS2 visits each node once; at `v` it builds `pre`/`suf` over its children (`O(deg(v))` combines) and emits `up[c]` for each child in `O(1)`. Summing `deg(v)` over the tree is `O(n)`. ∎

The eccentricity problem (max distance from each node) is the canonical `max`-combine instance: keep the two longest downward chains `down1, down2` so that "best chain of `v` avoiding child `c`" is `down2[v]` when `c` is the `down1` provider, else `down1[v]` — a hand-rolled prefix/suffix specialized to a two-element top-`k`.

---

## 8. Tree Knapsack: the O(n·W) Subtree-Size Argument

**Problem.** Weights `w(v)`, values `val(v)`, capacity `W`; subtree-dependency constraint (take `v` only if `par(v)` is taken). State `dp[v][j]` = best value from `T_v` with total weight `≤ j`, `v` taken. Merging child `c` into `v` is a `(max, +)` convolution:
```
new[v][j] = max_{a+b=j} ( dp[v][a] + dp[c][b] ).
```

**Naive bound.** `O(W²)` per merge, `O(n)` merges ⇒ `O(n·W²)`. We prove the true bound is `O(n·W)` (equivalently `O(n·min(n,W))`) when loops are **capped by subtree size**.

**Theorem 8.1.** If each merge of subtree `T_a` (size `s_a`) with subtree `T_b` (size `s_b`) costs `O(min(s_a, W) · min(s_b, W))`, then the total cost over all merges is `O(n · min(n, W))`.

**Proof (counting pairs).** First ignore the `W` cap and bound `Σ_merges s_a · s_b`. Process the tree bottom-up; a merge combines the already-accumulated set `A` at node `v` (size `s_a`) with a child subtree `T_c` (size `s_b`). The product `s_a · s_b` counts ordered pairs `(x, y)` with `x ∈ A`, `y ∈ T_c`. Charge each such pair to the **unordered pair `{x, y}`**. Crucially, the lowest common ancestor of `x` and `y` is `v`, and the merge at `v` that first unites them across this boundary happens **exactly once** for each unordered pair `{x, y}` (the moment their two subtrees are joined). Therefore `Σ_merges s_a · s_b ≤ Σ_{pairs} 1 = \binom{n}{2} = O(n²)`. Now reintroduce the cap: indices never exceed `min(subtreeSize, W)`, so each factor is `≤ min(s, W) ≤ W`. Hence `Σ min(s_a,W)·min(s_b,W) ≤ min(n,W) · Σ min(s_a, W) ≤ min(n,W) · (n · 1?)` — more carefully: bound one factor by `W` and sum the other factors, `Σ_merges min(s_b, W) ≤ n` per "level of accumulation", giving `O(n · min(n, W)) = O(n·W)` when `W ≤ n`, and `O(n²)` when `W ≥ n` (which equals `O(n·W)` trivially). ∎

**Corollary 8.2.** Implemented with inner loops bounded by `min(cnt, W)` and `cnt` grown as children merge, tree knapsack runs in `O(n·W)` time and `O(n·W)` space (or `O(W·h)` with child-table freeing). ∎

**Remark.** This is the classic "merging is paid for by counting node pairs" lemma, identical in spirit to the analysis of small-to-large merging and of the `O(n²)` total in tree-pair DPs. The practical instruction "**bound the loop by `min(subtreeSize, W)`**" is not an optimization — it is what makes the algorithm polynomial at the stated bound.

### 8.1 The Pair-Counting Argument, Spelled Out

It is worth seeing exactly why `Σ_merges s_a · s_b = O(n²)` (ignoring the `W` cap). Consider the process as building up the tree by merges; each merge unites a set `A` of already-collected nodes at `v` with a child subtree `B = T_c`. The cost `|A| · |B|` equals the number of pairs `(x, y)` with `x ∈ A, y ∈ B`. We claim each unordered pair `{x, y}` of distinct nodes is charged by **at most one** merge. Let `ℓ = lca(x, y)`. The pair `{x, y}` is first brought into a common collected set precisely at the merge, *at node `ℓ`*, that joins the child-subtree containing `x` with the child-subtree containing `y` (or with the accumulator already containing one of them). Before that merge, `x` and `y` live in different subtrees of `ℓ` and are never in the same `A`/`B` simultaneously; after it, they are in the same accumulator and no later merge has both in *different* operands. Hence the pair is counted once. Therefore `Σ_merges |A|·|B| ≤ \binom{n}{2}`, i.e. `O(n²)`. ∎

### 8.1.1 Tightness of the Bound

The `O(n²)` (uncapped) is achieved, not merely an upper bound: on a **balanced binary tree**, merging two subtrees of size `n/2` at the root alone costs `(n/2)² = n²/4`, and recursively each level contributes, summing to `Θ(n²)` only in the no-`W`-cap regime; once capped by `W`, the worst case is a **caterpillar** or **balanced tree with `W ≤ n`**, where the bound is `Θ(n·W)`. So Theorem 8.1 is asymptotically tight — you cannot, in general, do better than `O(n·W)` for the exact problem, matching the pseudo-polynomial lower bound inherited from 0/1 knapsack.

### 8.2 Worked Tree Knapsack

Tree `0–1, 0–2, 1–3`, weights `w = (1,2,1,2)`, values `val = (5,6,4,3)`, budget `W = 4`, dependency "take a node only if its parent is taken". `dp[v][j]` = best value from `T_v`, `v` taken, budget ≤ `j`.

```
node 3 (leaf, w=2,val=3): dp[3] = [-, -, 3, 3, 3]      (affordable from j≥2)
node 1 (w=2,val=6): start [-,-,6,6,6]; merge child 3:
   j=2: +dp[3][0..2] → reachable j=2(6, child takes 0), j=4(6+3=9)
   dp[1] = [-, -, 6, 6, 9]
node 2 (leaf, w=1,val=4): dp[2] = [-, 4, 4, 4, 4]
node 0 (w=1,val=5): start [-,5,5,5,5]; merge child 1 then child 2:
   merge 1: j=1(5)+dp[1][b]: b=2→j=3 (5+6=11); b=3→j=4 (5+6=11); ...
            → reachable: dp[0] gains [-,5,5,11,11]
   merge 2: add child 2 (best 4 at b≥1):
            j=3(11)+b=1(4)? j=4 → 15; j=1(5)+b=1(4)→ j=2 (9); ...
   dp[0] = [-, 5, 9, 11, 15]
answer = max(dp[0]) = 15  (set {0,1,2}: 5+6+4, total weight 1+2+1 = 4).
```

The loops never ran past `min(cnt, 4)`, so the merge work was small; the `O(n·W)` bound is what guarantees this stays cheap as the tree grows.

---

## 9. Independence Number, Matchings, and Domination

The MIS template generalizes to a whole family of "select vertices/edges under a local constraint" problems, each a small fixed-state tree dp. We state them to show the pattern is a method, not three isolated tricks.

**Maximum matching on a tree.** A matching is a set of edges no two sharing a vertex. State per node: `m₀(v)` = max matching in `T_v` with `v` **unmatched** (free to be matched by its parent), `m₁(v)` = max matching in `T_v` with `v` **already matched** to one of its children.

```
m₀(v) = Σ_c max(m₀(c), m₁(c))
m₁(v) = max over one child c* of [ 1 + m₀(c*) + Σ_{c≠c*} max(m₀(c), m₁(c)) ]
```

**Lemma 9.1.** These recurrences compute the maximum matching of `T_v`; the answer is `max(m₀(r), m₁(r))`.
**Proof sketch.** By disjointness, edges within distinct `T_c` are independent; the only shared vertex across child subtrees is `v`. If `v` is unmatched, each child independently takes its best (matched-or-not), giving `m₀`. If `v` is matched, it must be matched to exactly one child `c*` via the edge `(v, c*)` (which requires `c*` unmatched-below, hence `m₀(c*)`), while every other child contributes its own best. Maximizing over the choice of `c*` gives `m₁`. The two cases exhaust `v`'s possibilities. ∎

The bracketed `m₁` formula, naively `O(deg²)` per node, is `O(deg)` with the identity `1 + m₀(c*) + (Σ_c max(...)) - max(m₀(c*), m₁(c*))`, since the `Σ` is computed once and we pick the `c*` maximizing the **gain** `1 + m₀(c*) - max(m₀(c*), m₁(c*))`. Total `O(n)`.

**Minimum vertex cover on a tree.** By König-type duality (and directly), `vertexCover = n − independenceNumber` for any graph where the relation holds — but on trees the cleaner route is a direct three-state dp, or simply `n − MIS` since for the *unweighted* maximum independent set on any graph `α(G) + τ(G) = n` (independence number plus vertex-cover number). On trees both are computable in `O(n)`.

**Minimum dominating set on a tree.** Each vertex must be in the set or adjacent to one. State per node has **three** colors: `d₀(v)` = `v` in the set; `d₁(v)` = `v` not in the set but dominated by a child; `d₂(v)` = `v` not yet dominated (must be dominated by its parent). The transitions enforce that a `d₂` child forces the parent into `d₀`. This is the canonical "three-state tree dp" and runs in `O(n)`; the disjoint-subtree argument again licenses combining children independently.

**Domination transitions, explicitly.** For a node `v` with children `c`:
```
d₀(v) = 1 + Σ_c min(d₀(c), d₁(c), d₂(c))        # v dominates itself & its children
d₁(v) =     Σ_c min(d₀(c), d₁(c))  with the side condition that
            at least one child is in the set (i.e. uses d₀); enforce by a correction term
d₂(v) =     Σ_c min(d₀(c), d₁(c))               # no child in the set; v needs the parent
```
The `d₁` "at least one child in the set" constraint is handled by computing the unconstrained sum and, if no child's optimum used `d₀`, adding the minimum penalty to flip one child to `d₀`. The answer is `min(d₀(r), d₁(r))` (the root cannot rely on a parent). The three colors are precisely the **interface** (Definition 2.5): the parent must know whether `v` is in the set, dominated-but-not-in, or undominated — three cases, three numbers.

The meta-pattern: **enumerate the finitely many "interface states" a node can present to its parent, prove they are a sufficient summary (Theorem 2.2 hypothesis 1), and write one combine per interface state.** Independence, matching, vertex cover, and domination are all instances.

### 9.1 Worked Matching

Tree `0–1, 0–2, 1–3` (the knapsack tree shape). Maximum matching:

```
leaf 3: m₀=0, m₁=0       leaf 2: m₀=0, m₁=0
node 1 (child 3):
   m₀(1) = max(m₀(3), m₁(3)) = 0
   m₁(1) = 1 + m₀(3) = 1      (match edge 1–3)
node 0 (children 1, 2):
   base Σ_c max(m₀,m₁) = max(0,1) + max(0,0) = 1
   m₀(0) = 1
   m₁(0): match 0 to one child. gain via child 1 = 1 + m₀(1) - max(m₀(1),m₁(1)) = 1+0-1 = 0;
          gain via child 2 = 1 + m₀(2) - max(m₀(2),m₁(2)) = 1+0-0 = 1.
          m₁(0) = base + best gain = 1 + 1 = 2   (match 0–2, plus edge 1–3)
answer = max(m₀(0), m₁(0)) = 2.
```

The matching `{0–2, 1–3}` has size 2 and is maximum (4 vertices, all matched — a perfect matching). The `O(deg)` gain trick avoided the naive `O(deg²)` choice of `c*`.

### 9.2 Weighted Generalizations

All four problems weight cleanly. Weighted maximum matching replaces `1` by edge weight `w(v, c*)`; weighted dominating set sums vertex costs. The proofs are unchanged — they never used that the contribution was `1` — confirming the semiring view of Section 5.2: swap the ground monoid, keep the recurrence.

---

## 10. Lower Bounds and What Tree Structure Buys

- **MIS:** NP-hard on general graphs; **`O(n)` on trees** because acyclicity gives the disjoint-union decomposition (Lemma 3.1). The tree is what collapses the exponential search.
- **Counting independent sets:** #P-hard on general graphs; **`O(n)` on trees** by the product recurrence (Section 5).
- **Any tree dp** must read the input, so `Ω(n)` is a trivial lower bound; one-pass dps match it.
- **Counting colorings / matchings** is #P-hard or NP-hard on general graphs but linear (or `O(n·k)`) on trees, again by the disjoint decomposition.
- **Rerooting** beats the `Ω(n²)` of naive all-roots recomputation by exploiting that adjacent roots' answers differ by an `O(1)` edge transfer (Theorem 6.2) — an information-reuse argument, not a different algorithm.
- **Tree knapsack** cannot beat `O(n·W)` in general (it generalizes 0/1 knapsack, which is weakly NP-hard / pseudo-polynomial), so the `O(n·W)` of Theorem 8.1 is essentially optimal for the exact problem.

**The reduction that proves MIS-on-trees is the interesting case.** MIS on a *path* (a degenerate tree) is exactly the 1-D house-robber dp, solvable in `O(n)`; MIS on a *star* is trivial (`max(center, leaves)`); the full tree dp interpolates between them. On general graphs, MIS encodes 3-SAT (independent set is NP-complete), so the `O(n)` tree result is a genuine collapse driven solely by the acyclic structure — there is no clever trick, only the disjoint-subtree decomposition.

**Rerooting's `O(1)` transfer is information-theoretically tight.** The answer for adjacent roots differs by exactly the `cnt[c]` vs `n - cnt[c]` split (Theorem 6.2); since that split is one integer comparison's worth of data, no asymptotically faster transfer is possible, and the two-pass `O(n)` matches the `Ω(n)` output lower bound (there are `n` answers to print).

The unifying meta-theorem: **acyclicity turns global constraints into a partition over disjoint subtrees**, and a partition lets DP combine independent sub-answers — exactly the optimal-substructure hypothesis of Theorem 2.2.

### 10.1 Treewidth: the Boundary of Tractability

Why do these problems collapse on trees but not on general graphs? The deep answer is **treewidth**. A tree has treewidth 1: it admits a tree decomposition whose bags have size ≤ 2. The dp's "interface state" at a node is exactly a function of the bag separating its subtree from the rest, and a constant-size separator means a constant-size state. On a graph of treewidth `t`, the same dp framework (Courcelle's theorem; bag dp) solves MIS, dominating set, and many others in `O(2^t · poly(n))` or `O(f(t) · n)` — linear in `n` but exponential in `t`. Trees are the `t = 1` base case where the state is `O(1)` per node. This explains, in one parameter, *why* tree dp exists: small separators give small states, and acyclicity is the extreme case of small separators (every edge is a separator of size 2, every vertex of size 1 in the rooted view).

### 10.1.5 The Separator View in One Picture

For a rooted tree, deleting a node `v` from `T_v` disconnects its children's subtrees from each other; deleting the edge `(v, par(v))` separates `T_v` from the rest of `V`. These size-1 and size-2 separators are why the interface state is `O(1)`: to combine across a separator you only need the dp values of the constant-many vertices in it. On a graph of treewidth `t`, separators have size up to `t+1`, and the bag dp's interface state ranges over all configurations of a `(t+1)`-vertex boundary — hence `2^{O(t)}` states. Trees are the clean `t=1` instance where this machinery degenerates to "remember a constant-size summary per node", which is exactly tree dp. The professional payoff: when a problem is *not* on a tree but *is* on a low-treewidth graph (series-parallel graphs, outerplanar graphs, bounded-pathwidth instances), the same dp template applies with a slightly larger state — a direct generalization, not a new technique.

### 10.2 What the Proofs Have in Common

Every theorem above used the same three moves:
1. **Decompose** `T_v = {v} ⊎ ⊎_c T_c` (disjointness from acyclicity).
2. **Localize**: argue a child influences the parent only through a finite state (the interface), so cross-subtree interactions vanish (no edges between distinct child subtrees).
3. **Induct** on height, combining via the problem's semiring/operation.

If a candidate problem fails move 2 — i.e. the parent genuinely needs unbounded information about a child's subtree — then either the state must be enlarged (knapsack: an array) or the problem is not a clean tree dp.

---

## 11. Summary

### Complexity Summary

| Problem | State per node | Time | Key theorem |
|---------|----------------|------|-------------|
| Max (weighted) independent set | `(f₀, f₁)` — `O(1)` | `O(n)` | 3.2 |
| Count independent sets mod p | `(g₀, g₁)` — `O(1)` | `O(n)` | §5 |
| Tree diameter (any edge weights) | `down[v]` — `O(1)` | `O(n)` | 4.1 |
| Maximum matching | `(m₀, m₁)` — `O(1)` | `O(n)` | 9.1 |
| Minimum dominating set | 3 colors — `O(1)` | `O(n)` | §9 |
| Proper k-colorings | `c[v][·]` — `O(k)` | `O(n·k)` | §5.3 |
| Sum of distances (all roots) | `cnt, down` + reroot | `O(n)` | 6.2, 6.3 |
| Eccentricity (all roots, max-combine) | `down1, down2` + reroot | `O(n)` | 7.2 |
| Tree knapsack (budget W) | `dp[v][0..W]` — `O(W)` | `O(n·W)` | 8.1 |

The per-node time is always the **interface state size**; the structural `O(n)` factor is Proposition 2.3 (each subtree solved once).

### Closing

Every tree dp rests on one structural fact: a rooted tree decomposes as `T_v = {v} ⊎ ⊎_c T_c` into **disjoint** child subtrees (Definition 1.2, Lemma 1.6), a direct consequence of acyclicity. **Optimal substructure** (Theorem 2.2) then says: if the objective combines over this disjoint union and each child influences its parent only through a finite state `dp[c]`, the post-order recurrence is correct by induction on height, and Proposition 2.3 shows it costs `O(n · stateSize)` because the recursion tree equals the tree itself (no memoization). We proved this concretely for **maximum independent set** (the two-state include/exclude design is the minimal sufficient statistic, Theorem 3.2, with a constructive witness-recovery pass), for **tree diameter** (the answer is the two longest child chains at each potential "top", and you must return one chain but record two — Theorem 4.1, Corollary 4.2, with the three-chains-forbidden argument), and for **counting** independent sets, matchings, dominating sets, and colorings (same decomposition, different semiring — §5.2). **Rerooting** computes every node's whole-tree answer in `O(n)` because moving the root across one edge changes the answer by an `O(1)` transfer (Theorem 6.2, sum-of-distances), validated by the parity invariant `Σ_v S[v] = 2·Σ_{pairs} dist` (§6.2); non-invertible combines like `max` require prefix/suffix or a two-best state (Proposition 7.2). **In-and-out DP** is just the disjoint partition `V = T_c ⊎ (V \ T_c)` (Theorem 7.1). Finally, **tree knapsack** is `O(n·W)` not `O(n·W²)` because the merge cost `Σ s_a·s_b` counts each unordered node pair exactly once at their LCA (Theorem 8.1, §8.1) — provided the loops are capped by subtree size. The lower-bound and treewidth view (§10.1): trees are the treewidth-1 base case where the separator, and hence the state, is `O(1)` per node, so acyclicity converts otherwise NP-hard/#P-hard global problems into linear-time partition recurrences.

---

## Further Reading

- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms* — dynamic programming, optimal substructure, DFS.
- Cygan et al., *Parameterized Algorithms* — treewidth, tree decompositions, and bag dp (the generalization of tree dp).
- Courcelle, *The Monadic Second-Order Logic of Graphs* — why bounded-treewidth problems are linear-time.
- cp-algorithms.com — "Dynamic programming on trees", "Diameter of a tree", "Rerooting technique".
- Sibling file [`junior.md`](./junior.md) — intuition and the include/exclude template.
- Sibling file [`middle.md`](./middle.md) — rerooting, tree knapsack, in/out DP, iterative DFS.
- Sibling file [`senior.md`](./senior.md) — production failure modes, stack safety, modular arithmetic.
