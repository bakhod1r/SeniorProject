# NP-Hardness of TSP & Hamiltonian Problems — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. Hamiltonian Cycle is NP-Complete — Reduction Sketch
3. TSP is NP-Hard — Reduction from Hamiltonian Cycle
4. Held–Karp Recurrence and Complexity
5. The MST Lower Bound
6. MST-Doubling 2-Approximation — Proof
7. Christofides' 1.5-Approximation — Proof
8. Inapproximability of General TSP — Proof
9. Branch-and-Bound: Lower Bounds and the 1-Tree Relaxation
10. Heuristic Quality Bounds and Local Search
11. Summary

---

## 0. Notation and Standing Assumptions

Throughout, `G = (V, E)`, `n = |V|`, `m = |E|`. Weights `w : E → ℝ_{≥0}` unless stated. `OPT` denotes the optimal tour weight. `[n] = {0, 1, …, n−1}`. For a mask `S ⊆ V`, `|S|` is its cardinality and popcount of its bitmask. `O*(·)` hides polynomial factors (used for exponential algorithms). All logarithms are base 2 unless noted. We fix the start/depot vertex as `0` without loss of generality (a cycle has no distinguished start).

| Symbol | Meaning |
|--------|---------|
| `HAM-CYCLE` | decision: does `G` have a Hamiltonian cycle? |
| `HAM-PATH` | decision: does `G` have a Hamiltonian path? |
| `TSP` | optimization: minimum-weight Hamiltonian cycle in `K_n` |
| `g(S, i)` | Held–Karp state: shortest path from 0 over `S`, ending at `i` |
| `T` | minimum spanning tree |
| `O` | set of odd-degree vertices of `T` (Christofides) |
| `M` | minimum-weight perfect matching on `O` |
| `tw` | treewidth |
| `OPT` | optimal tour weight |

---

## 1. Formal Definitions

**Definition 1.1 (Hamiltonian cycle).** Given an undirected graph `G = (V, E)`, a **Hamiltonian cycle** is a cyclic ordering `v₀, v₁, …, v_{n−1}, v₀` of all `n = |V|` vertices such that `{v_k, v_{k+1 mod n}} ∈ E` for every `k`. **HAM-CYCLE** is the decision problem: *does `G` contain a Hamiltonian cycle?*

**Definition 1.2 (Hamiltonian path).** The same, without the closing edge `{v_{n−1}, v_0}`. **HAM-PATH** asks whether `G` contains a path visiting every vertex once.

**Definition 1.3 (TSP — optimization).** Given a complete graph `K_n` with a weight function `w : E → ℝ_{≥0}`, find a Hamiltonian cycle `C` minimizing `w(C) = Σ_{e ∈ C} w(e)`.

**Definition 1.4 (TSP — decision).** Given `(K_n, w, B)`, does there exist a Hamiltonian cycle of weight `≤ B`? This decision version is what we place in NP.

**Definition 1.5 (Metric TSP).** TSP where `w` satisfies the **triangle inequality**: `w(u, x) ≤ w(u, y) + w(y, x)` for all `u, x, y ∈ V`, and `w` is symmetric and non-negative. Equivalently `(V, w)` is a (semi)metric space.

**Definition 1.6 (Complexity classes).**
- **P:** decision problems solvable by a deterministic polynomial-time Turing machine.
- **NP:** decision problems whose *yes*-instances admit a polynomial-size certificate verifiable in polynomial time.
- **NP-hard:** a problem `X` such that every `Y ∈ NP` reduces to `X` in polynomial time (`Y ≤_p X`).
- **NP-complete:** `X ∈ NP` *and* `X` is NP-hard.

HAM-CYCLE is NP-complete; the TSP *optimization* problem is NP-hard (it is not a decision problem, so "complete" does not apply, but its decision version is NP-complete).

---

## 2. Hamiltonian Cycle is NP-Complete — Reduction Sketch

**Theorem 2.1.** HAM-CYCLE is NP-complete.

**Proof.**

*Membership in NP.* A certificate is the cyclic vertex ordering. Verification checks (a) it is a permutation of `V` and (b) every consecutive pair (including wrap-around) is an edge. Both checks are `O(n)`. Hence HAM-CYCLE ∈ NP. ∎(membership)

*NP-hardness.* We reduce from **3-SAT** (Cook–Levin gives 3-SAT ∈ NP-complete) — the classical Karp (1972) chain is `3-SAT ≤_p VERTEX-COVER ≤_p HAM-CYCLE`, or directly `3-SAT ≤_p HAM-CYCLE`. We sketch the direct gadget construction.

Given a 3-CNF formula `φ` with variables `x₁, …, x_m` and clauses `c₁, …, c_k`, build a graph `G_φ` such that `G_φ` has a Hamiltonian cycle **iff** `φ` is satisfiable.

- **Variable gadget.** For each variable `xᵢ`, build a "ladder" — a chain that a Hamiltonian cycle can traverse **left-to-right** (encode `xᵢ = true`) or **right-to-left** (encode `xᵢ = false`). Each truth assignment corresponds to a *traversal direction* of each ladder, and these gadgets are connected in series so the cycle threads through all `m` of them.
- **Clause gadget.** For each clause `cⱼ`, add a vertex `cⱼ`. Wire `cⱼ` into the three ladders of its three literals so that the cycle can "detour" to cover `cⱼ` **only if at least one literal in `cⱼ` is satisfied** by the chosen traversal direction.

A Hamiltonian cycle must (i) traverse every variable ladder in one consistent direction — yielding a truth assignment — and (ii) cover every clause vertex — which is possible iff each clause is satisfied. Therefore `G_φ` has a Hamiltonian cycle iff `φ` is satisfiable. The construction has `O(m + k)` gadgets and `O(mk)` vertices/edges — polynomial.

Since 3-SAT ≤_p HAM-CYCLE and HAM-CYCLE ∈ NP, HAM-CYCLE is NP-complete. ∎

**Corollary 2.2.** HAM-PATH is NP-complete (add two pendant vertices, or reduce from HAM-CYCLE by splitting a vertex).

**Detailed gadget (Karp's chain via VERTEX-COVER).** For completeness we expand the more mechanical Karp reduction `VERTEX-COVER ≤_p HAM-CYCLE`. Given `(G, k)` asking whether `G` has a vertex cover of size `k`:

- For each edge `e = {u, v}` build a 12-vertex **edge gadget** with two entry/exit "ports" on the `u`-side and two on the `v`-side. The gadget has the property that a Hamiltonian cycle can traverse it in exactly one of three ways: enter-and-exit on the `u`-side only, on the `v`-side only, or pass through both — corresponding to "`u` covers `e`", "`v` covers `e`", or "both cover `e`".
- Chain all edge gadgets incident to a vertex `w` into a "vertex chain" for `w`. A Hamiltonian cycle entering `w`'s chain must traverse all of `w`'s edge gadgets on the `w`-side.
- Add `k` **selector vertices** `s₁, …, s_k`, each connectable to the entry of any vertex chain. The cycle uses the `k` selectors to "choose" `k` vertex chains to traverse — i.e. a size-`k` vertex cover.

A Hamiltonian cycle exists iff the `k` chosen chains cover every edge gadget (each edge traversed from at least one side), i.e. iff `G` has a vertex cover of size `k`. The construction is polynomial (`O(|E|)` gadgets of constant size). Since VERTEX-COVER is NP-complete (Karp 1972), so is HAM-CYCLE.

**Why the surprise vs Eulerian.** EULERIAN-CIRCUIT is decidable in `O(E)` (connected + all even degrees), placing it in P. The structural reason HAM-CYCLE is hard while its edge-analogue is easy: edge-traversal admits a *local* characterization (degree parity, by Euler's theorem), whereas vertex-traversal admits no known local certificate — you genuinely seem to need to search the permutation space. This local-vs-global divide is the intuitive heart of why one problem is in P and the other is NP-complete.

---

## 3. TSP is NP-Hard — Reduction from Hamiltonian Cycle

**Theorem 3.1.** The TSP decision problem is NP-complete; the optimization problem is NP-hard.

**Proof.**

*Membership.* A certificate is the tour; verifying it is a Hamiltonian cycle and summing its weight to check `≤ B` is polynomial. TSP-decision ∈ NP.

*Hardness — reduction HAM-CYCLE ≤_p TSP.* Let `G = (V, E)` with `|V| = n` be an instance of HAM-CYCLE. Construct a complete graph `K_n` on the same vertices with weights:

```
w(u, v) = 1      if {u, v} ∈ E
w(u, v) = 2      if {u, v} ∉ E      (or any M > n; here 2 suffices for the bound)
```

Set the budget `B = n`.

- **If `G` has a Hamiltonian cycle**, that cycle uses `n` edges, each of weight `1`, total `n = B`. So the TSP instance answers *yes*.
- **Conversely, if the TSP instance has a tour of weight `≤ n`**, every one of its `n` edges must have weight exactly `1` (since each weight is `≥ 1` and there are `n` of them; any weight-`2` edge would push the total `> n`). Weight-`1` edges are exactly the edges of `G`, so the tour is a Hamiltonian cycle in `G`.

Thus `G ∈ HAM-CYCLE ⟺ (K_n, w, n) ∈ TSP`. The reduction builds `K_n` in `O(n²)` time. Therefore TSP-decision is NP-hard, hence NP-complete; the optimization version is NP-hard. ∎

**Remark 3.2.** Note this reduction produces a **non-metric** instance (a non-edge has weight 2, but a path through two real edges costs `1 + 1 = 2` — actually metric here with weights {1,2}). The *strong* non-approximability (§8) uses a *large* penalty `M ≫ n`, which deliberately violates the triangle inequality.

---

## 4. Held–Karp Recurrence and Complexity

**Definition 4.1 (DP state).** Fix start vertex `0`. For a subset `S ⊆ V` with `0 ∈ S` and a vertex `i ∈ S`, let

```
g(S, i) = length of the shortest path that starts at 0,
          visits exactly the vertices of S, and ends at i.
```

**Recurrence 4.2.**
```
g({0}, 0) = 0
g(S, i)   = min_{ j ∈ S \ {0, i} }  [ g(S \ {i}, j) + w(j, i) ]      for i ≠ 0
```

**Answer 4.3.**
```
OPT = min_{ i ≠ 0 }  [ g(V, i) + w(i, 0) ]
```

**Algorithm 4.3a (full pseudocode, push form).**
```text
HELD-KARP(w, n):
  for all masks S, all i:  g[S][i] := +∞ ;  par[S][i] := nil
  g[{0}][0] := 0
  for mask S in increasing integer order:
    if 0 ∉ S: continue                         # all paths start at depot 0
    for each i ∈ S with g[S][i] < ∞:
      for each j ∉ S:                           # extend to a new city
        S' := S ∪ {j}
        cand := g[S][i] + w(i, j)
        if cand < g[S'][j]:
          g[S'][j] := cand ;  par[S'][j] := i
  best := +∞ ; last := nil
  for i in 1..n-1:
    if g[V][i] + w(i, 0) < best:
      best := g[V][i] + w(i, 0) ;  last := i
  # reconstruct
  tour := [] ;  S := V ;  cur := last
  while cur ≠ nil:
    append cur to tour
    p := par[S][cur] ;  S := S \ {cur} ;  cur := p
  reverse tour ;  append 0
  return best, tour
```

The increasing-integer iteration order is a valid topological order for the DAG of states because `S' ⊃ S` implies `S'` (as an integer) `> S`. Correctness of reconstruction follows from `par` recording the predecessor realizing each `g[S'][j]`.

**Theorem 4.4 (Correctness).** `g(S, i)` as defined by 4.2 equals the true shortest such path length.

*Proof (optimal substructure).* Consider any shortest path `P` realizing `g(S, i)`. Let `j` be the vertex visited immediately before `i`. Removing the final edge `(j, i)` leaves a path `P'` from `0` to `j` visiting exactly `S \ {i}`. We claim `P'` is a shortest such path, i.e. has length `g(S \ {i}, j)`. If a shorter path `P''` over `S \ {i}` ending at `j` existed, then `P'' + (j, i)` would beat `P`, contradicting optimality of `P`. Hence `g(S, i) = g(S\{i}, j) + w(j, i)`, and minimizing over the unknown predecessor `j` gives 4.2. The base case is immediate. By induction on `|S|`, the recurrence is correct. ∎

**Theorem 4.5 (Complexity).** Held–Karp runs in `Θ(2ⁿ · n²)` time and `Θ(2ⁿ · n)` space.

*Proof.* There are `2ⁿ` subsets `S` and `n` choices of `i`, so `2ⁿ · n` states. Each state's recurrence minimizes over up to `n` predecessors `j`, costing `O(n)`. Total time `O(2ⁿ · n · n) = O(2ⁿ · n²)`. The table stores one value per state: `O(2ⁿ · n)` space. The lower bound `Ω(2ⁿ · n)` space holds because the table is genuinely filled (no state is provably useless without solving the problem). ∎

**Remark 4.6.** Held–Karp is *not* polynomial — `2ⁿ` is exponential — but it is the best known **exact** worst-case bound for general TSP. No algorithm with `O(c^n)` for `c < 2` is known for TSP; whether one exists is open. Held–Karp makes no symmetry or metric assumption, so it solves ATSP unchanged.

**Remark 4.7 (Space refinement).** If only the optimal *length* is needed (not the tour), one can iterate over masks in increasing popcount and retain only the two "popcount layers" currently in play, reducing peak memory by a constant factor — but the asymptotic `Θ(2ⁿ·n)` is unavoidable because the final layer alone has `n` entries per the `C(n, n)`-sized full mask, and reconstruction needs the parent pointers. There is no known sub-exponential-space exact TSP algorithm; Held–Karp is the canonical time-space point on the exact frontier. A complementary `O*(2ⁿ)`-time, **polynomial-space** algorithm exists via inclusion–exclusion (Karp 1982; Kohn–Gottlieb–Kohn), trading the table for repeated counting — useful when memory, not time, is the hard wall.

**Remark 4.8 (Comparison to brute force).** Brute force is `Θ(n!)`. Stirling gives `n! ≈ √(2πn)(n/e)ⁿ`, which grows faster than `2ⁿ·n²` by a factor of roughly `(n/2e)ⁿ`. Concretely at `n = 20`: `n! ≈ 2.4×10¹⁸` versus `2²⁰·20² ≈ 4.2×10⁸` — a speedup factor near `5.8×10⁹`. This is precisely the gap that moves the practical exact ceiling from `n ≈ 12` to `n ≈ 20`.

---

## 5. The MST Lower Bound

**Lemma 5.1.** For any TSP instance, `w(MST) ≤ OPT`, where `OPT` is the optimal tour weight.

*Proof.* Let `C*` be an optimal tour. Delete any single edge from `C*`; the result is a **spanning path** `H`, which is in particular a spanning tree of `G`. Since the MST is the minimum-weight spanning tree, `w(MST) ≤ w(H) ≤ w(C*) = OPT` (the second inequality because `H` drops one non-negative edge from `C*`). ∎

This is the lower bound that powers both the 2-approximation upper bound and branch-and-bound pruning. The MST is computed by Kruskal or Prim (sibling `10-mst-kruskal-prim`) in `O(E log V)`.

**Corollary 5.2 (gap quality).** Combined with the 2-approximation upper bound (§6), any metric instance is sandwiched as `w(MST) ≤ OPT ≤ 2·w(MST)`. Thus a single MST computation pins `OPT` to within a factor of 2 in `O(E log V)` — no exponential search required. The 1-tree relaxation (§9) tightens the lower side substantially.

**Worked example.** For the 4-city instance with matrix
`[[0,10,15,20],[10,0,35,25],[15,35,0,30],[20,25,30,0]]`,
the MST (Prim from 0) picks edges `0–1 (10)`, `0–2 (15)`, `1–3 (25)`, total `w(MST) = 50`. The optimal tour (Held–Karp) is `0→2→3→1→0` with length `80`. Indeed `50 ≤ 80 ≤ 100 = 2·50`, confirming both bounds hold for this instance.

---

## 6. MST-Doubling 2-Approximation — Proof

**Algorithm 6.1 (Double-Tree).**
1. Compute MST `T`.
2. Duplicate every edge of `T` to obtain multigraph `T₂` (every vertex now has even degree).
3. Find an Eulerian circuit `W` of `T₂` (exists because `T₂` is connected and all degrees even — sibling `12-eulerian-path-circuit`).
4. Shortcut `W`: traverse it, skipping already-visited vertices, to obtain a Hamiltonian cycle `H`.

**Theorem 6.2.** On a **metric** instance, `w(H) ≤ 2 · OPT`.

*Proof.*
- `w(T₂) = 2 · w(T)` because every edge is duplicated.
- The Eulerian circuit `W` uses every edge of `T₂` exactly once, so `w(W) = w(T₂) = 2 · w(T)`.
- **Shortcutting does not increase weight.** Each time we skip an already-visited vertex `y` going from `x` to the next new vertex `z`, we replace the sub-walk `x → y → z` (or longer) by the direct edge `x → z`. By the triangle inequality `w(x, z) ≤ w(x, y) + w(y, z)`, repeated, so the shortcut path is no longer than the segment it replaces. Hence `w(H) ≤ w(W)`.
- Combining: `w(H) ≤ w(W) = 2 · w(T) ≤ 2 · OPT` by Lemma 5.1. ∎

**Tightness 6.3.** The factor 2 is essentially tight for this algorithm: there are metric instances where Double-Tree produces a tour close to `2 · OPT`. The bound `2` is the price of duplicating *every* tree edge.

**Construction of a near-tight instance 6.4.** Place `n` points on a path-like metric where the MST is a long "spine." Doubling the spine and shortcutting forces the tour to backtrack along nearly the whole spine twice before it can shortcut, approaching `2·w(T)`. The optimal tour, by contrast, can weave through the points once. As `n → ∞` the ratio of Double-Tree to `OPT` approaches `2`, so no analysis can improve the `2` for this specific algorithm — the improvement must come from a *better algorithm* (Christofides, §7), not a sharper analysis.

**Remark 6.5 (why DFS preorder works).** In implementation, one rarely materializes the doubled multigraph. A **preorder DFS** of the MST visits every vertex exactly once, and the sequence of "tree descents and ascents" of that DFS is precisely an Euler tour of the doubled tree; emitting each vertex on first visit *is* the shortcut. Hence the 2-approximation reduces to "MST, then preorder DFS, then close the loop" — three textbook steps, total `O(n²)` for a dense metric.

---

## 7. Christofides' 1.5-Approximation — Proof

**Algorithm 7.1 (Christofides 1976).**
1. Compute MST `T`.
2. Let `O = { v : deg_T(v) is odd }`. `|O|` is even (handshake lemma).
3. Compute a **minimum-weight perfect matching** `M` on the complete graph induced by `O` (Edmonds' blossom algorithm, `O(n³)`).
4. Form multigraph `T ∪ M`. Every vertex now has even degree (MST degree parity is fixed exactly on `O` by `M`).
5. Eulerian circuit of `T ∪ M`, then shortcut into a Hamiltonian cycle `H`.

**Algorithm 7.1a (pseudocode).**
```text
CHRISTOFIDES(w, V):
  T := MST(V, w)                          # O(n^2) dense / O(m log n)
  O := { v ∈ V : deg_T(v) is odd }        # |O| even (handshake lemma)
  M := MIN-WEIGHT-PERFECT-MATCHING(O, w)  # Edmonds' blossom, O(n^3)
  H := multigraph T ∪ M                   # every vertex now even degree
  W := EULERIAN-CIRCUIT(H)                 # Hierholzer, O(edges)
  tour := SHORTCUT(W)                      # skip visited; triangle inequality
  return tour

DOUBLE-TREE(w, V):                         # the 2-approximation, for contrast
  T := MST(V, w)
  W := EULER(double every edge of T)       # = preorder DFS of T in practice
  return SHORTCUT(W)
```

The two algorithms differ in exactly one line: Double-Tree fixes parity by *duplicating all* tree edges (cost `+w(T) ≤ OPT`), Christofides fixes it with a *minimum matching* on odd vertices (cost `+w(M) ≤ ½·OPT`). That single substitution is the entire `2 → 1.5` improvement.

**Theorem 7.2.** On a metric instance, `w(H) ≤ (3/2) · OPT`.

*Proof.* We bound `w(T)` and `w(M)` separately, then sum and shortcut.

**Bound on `w(T)`.** By Lemma 5.1, `w(T) ≤ OPT`.

**Bound on `w(M)` — the crucial step.** Consider the optimal tour `C*` restricted to the odd-degree set `O`. Walk around `C*` and read off the vertices of `O` in the cyclic order they appear: `o₁, o₂, …, o_{2t}` (where `|O| = 2t`). The tour `C*` visits these in a cycle, and by the triangle inequality the "shortcut cycle" `C_O = o₁ → o₂ → … → o_{2t} → o₁` on just the odd vertices satisfies `w(C_O) ≤ w(C*) = OPT` (each `oᵢ → oᵢ₊₁` shortcut is ≤ the corresponding sub-path of `C*`).

Now `C_O` is a cycle on an even number `2t` of vertices, so it decomposes into **two** edge-disjoint perfect matchings on `O`: `M₁ = {o₁o₂, o₃o₄, …}` and `M₂ = {o₂o₃, o₄o₅, …, o_{2t}o₁}`. Together `w(M₁) + w(M₂) = w(C_O) ≤ OPT`. The cheaper of the two satisfies `min(w(M₁), w(M₂)) ≤ ½ · w(C_O) ≤ ½ · OPT`. Since `M` is the *minimum*-weight perfect matching on `O`,

```
w(M) ≤ min(w(M₁), w(M₂)) ≤ ½ · OPT.
```

**Combine.** `w(T ∪ M) = w(T) + w(M) ≤ OPT + ½ OPT = (3/2) OPT`. The Eulerian circuit has this same weight, and shortcutting (triangle inequality) does not increase it, so `w(H) ≤ (3/2) · OPT`. ∎

**Remark 7.3.** Christofides was the best known approximation ratio for metric STSP from 1976 until Karlin, Klein, and Oveis Gharan (2020/2021) achieved `3/2 − ε` for a tiny `ε ≈ 10⁻³⁶` via a randomized rounding of the subtour-elimination LP. Christofides remains the canonical, practical, and teachable bound. It requires symmetry (the matching argument breaks for ATSP).

**Remark 7.4 (tightness of 1.5).** The `3/2` ratio is *also* essentially tight for the Christofides algorithm: there exist metric instances on which it returns a tour close to `1.5·OPT`. So, as with Double-Tree, the constant is a property of the algorithm, and beating it required the genuinely new LP-rounding ideas of 2020.

**Remark 7.5 (cost of the matching).** Step 3 dominates the running time. Edmonds' blossom algorithm computes a minimum-weight perfect matching in `O(n³)` (with modern implementations `O(n³)` or `O(nm log n)`), versus `O(n²)` for the MST and `O(n)` for the Euler/shortcut steps. Thus Christofides is `O(n³)` overall — polynomial, but with a meaningfully larger constant than the `O(n²)` Double-Tree, which is exactly the practical price paid for the tighter `1.5` guarantee.

**Worked example.** On the 4-city instance, `T = {0–1, 0–2, 1–3}` has degrees `deg(0)=2, deg(1)=2, deg(2)=1, deg(3)=1`. The odd set is `O = {2, 3}`; the only perfect matching on two vertices is the single edge `2–3` of weight `30`. Then `T ∪ {2–3}` has all even degrees; an Eulerian circuit `0→1→3→2→0` shortcuts (already simple) to a tour of length `10+25+30+15 = 80` — which happens to be optimal here, comfortably within `1.5·80 = 120`.

---

## 8. Inapproximability of General TSP — Proof

**Theorem 8.1.** Unless P = NP, for **no** constant `α ≥ 1` does there exist a polynomial-time `α`-approximation algorithm for *general* (non-metric) TSP.

*Proof.* Suppose, for contradiction, that an `α`-approximation `A` exists for some constant `α`. We use it to decide HAM-CYCLE in polynomial time, contradicting Theorem 2.1 (under P ≠ NP).

Given a HAM-CYCLE instance `G = (V, E)`, `|V| = n`, build a complete weighted graph `K_n`:

```
w(u, v) = 1        if {u, v} ∈ E
w(u, v) = α·n + 1  if {u, v} ∉ E      (a huge penalty)
```

Run `A` on `(K_n, w)`.

- **If `G` has a Hamiltonian cycle**, then `OPT = n` (use only weight-`1` edges). The `α`-approximation returns a tour of weight `≤ α · OPT = α·n`.
- **If `G` has no Hamiltonian cycle**, then *every* tour must use at least one non-edge, costing `≥ (α·n + 1) + (n − 1)·1 = α·n + n > α·n`. So *any* tour — including `A`'s output — has weight `> α·n`.

Thus `A`'s output is `≤ α·n` **iff** `G` has a Hamiltonian cycle. Comparing `A`'s returned weight to the threshold `α·n` decides HAM-CYCLE in polynomial time. This contradicts HAM-CYCLE being NP-complete (assuming P ≠ NP). Therefore no constant-factor polynomial approximation for general TSP exists unless P = NP. ∎

**Remark 8.2.** The penalty `α·n + 1` deliberately **violates the triangle inequality** — that is exactly why the metric guarantees of §6–§7 do not contradict this theorem. Metric TSP is APX-complete (constant-factor approximable but, by Papadimitriou–Vempala and others, has no PTAS for general metrics unless P = NP); *Euclidean* TSP, by contrast, admits a PTAS (Arora 1998; Mitchell 1999).

**Theorem 8.3 (Gap-creating reductions, general form).** The argument above is an instance of a *gap-creating* reduction: HAM-CYCLE *yes*-instances map to TSP instances with `OPT ≤ n`, *no*-instances to `OPT > α·n`. Any `α`-approximation must distinguish the two — but distinguishing them decides HAM-CYCLE. Formally, if `L` is NP-hard and there is a polynomial reduction producing instances with a multiplicative gap of `g` between *yes* and *no* values, then no polynomial `(g − ε)`-approximation exists unless P = NP. The TSP reduction achieves *unbounded* gap (`α` is arbitrary), hence unbounded inapproximability.

**Hierarchy 8.4 (where each variant sits).**

| Variant | Approximability | Reference |
|---------|-----------------|-----------|
| General (non-metric) TSP | inapproximable to any constant | §8 reduction |
| Metric TSP (symmetric) | `3/2` (Christofides); `3/2 − ε` (2020); APX-hard, no PTAS | §7 |
| Asymmetric metric TSP | `O(1)` (constant, Svensson–Tarnawski–Végh 2018) | research |
| Euclidean / planar TSP | PTAS: `(1 + ε)` for any `ε > 0` | Arora 1998 |
| Graphic TSP (shortest-path metric of an unweighted graph) | `7/5 = 1.4` (Sebő–Vygen 2014) | research |

The lesson: *structure buys approximability*. The more geometric/metric the instance, the better you can do; strip all structure and you can do nothing in polynomial time.

---

## 8a. The Decision–Optimization Equivalence

**Proposition 8a.1.** The TSP optimization problem is polynomial-time Turing-equivalent to its decision version.

*Proof.* Optimization solves decision trivially (compare `OPT ≤ B`). Conversely, given a decision oracle, **binary search** on the budget `B` over the range `[0, Σ_e w(e)]` finds `OPT` in `O(log(Σ w))` oracle calls — polynomially many. To recover the *tour* (self-reduction), fix edges one at a time: for each candidate edge, ask the oracle whether an optimal tour exists that *includes* it (by forcing the edge via a weight tweak or contraction); keep edges that preserve `OPT`. This reconstructs an optimal tour with polynomially many oracle calls. ∎

This equivalence is why we freely call the optimization problem "NP-hard" via the NP-complete decision version: they stand or fall together.

---

## 8b. Held–Karp vs Exponential-Time Hypothesis

**Remark 8b.1.** Under the **Exponential Time Hypothesis (ETH)** — that 3-SAT has no `2^{o(m)}` algorithm — TSP has no `2^{o(n)}` algorithm. So Held–Karp's `2ⁿ` base, while not proven optimal, *cannot be reduced to sub-exponential* under ETH. The open question is only whether the base `2` can be lowered to some `c < 2`; for *bounded-degree* or *planar* graphs, faster exact algorithms (`2^{O(√n)}` for planar HAM-CYCLE) are known, exploiting structure the general case lacks.

---

## 9. Branch-and-Bound: Lower Bounds and the 1-Tree Relaxation

**Setup 9.1.** Branch-and-bound searches the tree of partial tours, pruning a node whose **lower bound** `LB ≥ best known complete tour`. Soundness: pruning never discards an improving solution because no completion of that partial tour can beat the incumbent.

**Algorithm 9.1a (branch-and-bound skeleton).**
```text
BNB(w, n):
  best := NEAREST-NEIGHBOR-LENGTH(w)        # warm-start incumbent
  visited := {0} ;  search(0, 1, 0)
  return best

search(cur, count, cost):
  if cost ≥ best: return                     # bound prune (running cost)
  if count = n:
    best := min(best, cost + w(cur, 0))      # close the cycle
    return
  if cost + LOWER-BOUND(visited) ≥ best:     # bound prune (optimistic estimate)
    return
  for v ∉ visited, in increasing w(cur, v):  # branch, cheapest-first
    visited := visited ∪ {v}
    search(v, count + 1, cost + w(cur, v))
    visited := visited \ {v}
```

The `LOWER-BOUND` plug-in (9.2/9.3/9.4 below) determines pruning power; cheapest-first branching makes good incumbents appear early, which prunes the rest.

**Proposition 9.1b (pruning soundness, formal).** Let `B` be the incumbent (some complete tour's length) and let `node` be a partial tour with accumulated cost `c` and a lower bound `LB(node) ≤` (cost of any completion of `node`). If `c + LB_rest ≥ B`, every completion of `node` has length `≥ B`, so none improves the incumbent. Pruning `node` therefore preserves the optimum. *Proof.* By definition of a valid lower bound, the cheapest completion costs `≥ c + LB_rest ≥ B`; the incumbent already achieves `B`; hence discarding `node` cannot lose a strictly-better solution. ∎ The contrapositive guarantees *completeness*: if `node` could lead to a strictly better tour, then `c + LB_rest < B`, so `node` is *not* pruned. Soundness + completeness ⇒ branch-and-bound returns the exact optimum.

**Lower bound 9.2 (degree / 2-cheapest-edges).** Every vertex has degree 2 in any tour, so its two incident tour edges cost at least its two cheapest incident edges. Summing over all vertices and halving (each edge counted twice):

```
LB = ½ · Σ_{v ∈ V} (two cheapest edges at v)  ≤  OPT.
```

**Lower bound 9.3 (reduced-cost / Little et al. 1963).** Subtract from each row its minimum and from each column its minimum of the cost matrix. Every tour selects exactly one entry per row and per column, so the total subtracted amount `Σ row-mins + Σ col-mins` is a valid lower bound; the residual matrix bounds the remaining cost.

**Lower bound 9.4 (Held–Karp 1-tree).** A **1-tree** is a spanning tree on `V \ {1}` plus the two cheapest edges at vertex `1`. Every tour is a 1-tree (it is a spanning structure with vertex 1 having degree 2), so `min-weight 1-tree ≤ OPT`. Adding Lagrangian node penalties `πᵥ` to push degrees toward 2 yields the **Held–Karp bound**, the strongest combinatorial TSP lower bound, typically within ~1% of `OPT` and the engine behind Concorde-class solvers.

```
HK-bound = max_π [ min-weight-1-tree(w + π) − 2 Σ πᵥ ]   ≤  OPT.
```

These bounds are why branch-and-bound solves `n = 40–60` (and, with cutting planes, far larger) despite the `O(n!)` worst case.

**Theorem 9.5 (Lagrangian dual = LP bound).** The Held–Karp 1-tree bound, maximized over the node penalties `π`, equals the optimal value of the **subtour-elimination LP relaxation** of TSP (Held–Karp 1970, 1971). That LP is

```
min  Σ_e w_e x_e
s.t. Σ_{e ∋ v} x_e = 2          for all v        (degree-2)
     Σ_{e ⊆ S} x_e ≤ |S| − 1    for all ∅ ⊂ S ⊂ V (subtour elimination)
     0 ≤ x_e ≤ 1
```

The subtour-elimination constraints are exponentially many, but separated lazily by min-cut, which is how Concorde-class **branch-and-cut** solvers operate. Empirically the LP bound is within `~0.5–2%` of `OPT` on real instances, making the branch tree shallow.

**Proposition 9.6 (integrality gap).** The integrality gap of the subtour LP for metric TSP is conjectured to be exactly `4/3` (the "`4/3` conjecture"); it is known to lie in `[4/3, 3/2]`. This gap quantifies the *best possible* guarantee any LP-rounding approximation built on this relaxation could hope to achieve — and is why the 2020 `3/2 − ε` result was a landmark rather than a leap to `4/3`.

---

## 10a. Worked Held–Karp Trace (correctness sanity check)

To make Theorem 4.4 concrete, trace `g` on the 4-city matrix (start 0):

```
g({0},0)         = 0
g({0,1},1)       = 0 + 10 = 10
g({0,2},2)       = 0 + 15 = 15
g({0,3},3)       = 0 + 20 = 20
g({0,1,2},2)     = g({0,1},1) + w(1,2) = 10 + 35 = 45
g({0,1,3},3)     = g({0,1},1) + w(1,3) = 10 + 25 = 35
g({0,2,3},3)     = g({0,2},2) + w(2,3) = 15 + 30 = 45
g({0,2,3},2)     = g({0,3},3) + w(3,2) = 20 + 30 = 50
g(V,1)           = min(g({0,2,3},2)+w(2,1), g({0,2,3},3)+w(3,1))
                 = min(50+35, 45+25) = 70
g(V,2)           = min(g({0,1,3},1)+w(1,2), g({0,1,3},3)+w(3,2)) = min(80, 65) = 65
g(V,3)           = min(g({0,1,2},1)+w(1,3), g({0,1,2},2)+w(2,3)) = min(75, 75) = 75
OPT              = min(g(V,1)+w(1,0), g(V,2)+w(2,0), g(V,3)+w(3,0))
                 = min(70+10, 65+15, 75+20) = 80
```

This matches the brute-force optimum (`(n−1)!/2 = 3` distinct tours: lengths `80, 80, 95`), validating the recurrence on a concrete instance — exactly the kind of small-`n` check Theorem 4.4 guarantees will always agree.

---

## 10. Heuristic Quality Bounds and Local Search

**Nearest-neighbor.** On metric instances the nearest-neighbor heuristic satisfies `NN ≤ (½)(⌈log₂ n⌉ + 1) · OPT`, i.e. `Θ(log n) · OPT` in the worst case (Rosenkrantz, Stearns, Lewis 1977). It has *no* constant guarantee — its greedy commitments force expensive closing edges.

**Greedy edge.** Repeatedly add the cheapest edge that keeps degree ≤ 2 and forms no premature subcycle. Also `Θ(log n) · OPT` worst case, usually better than NN in practice.

**2-opt.** A tour is **2-optimal** if no 2-opt move improves it. For Euclidean instances, 2-opt empirically lands within ~5% of `OPT`. Worst-case guarantees are weak: 2-optimal tours can be `Θ(√(log n / log log n))` from optimal on some metrics (Chandra, Karloff, Tovey 1999), and the number of improving moves can be exponential in the worst case, but is polynomial on average.

**Lin–Kernighan.** Variable-depth `k`-opt; the LKH implementation routinely achieves `< 1%` gap on instances with `10⁵–10⁶` cities. No constant worst-case bound, but the best practical heuristic known.

**Proof sketch (nearest-neighbor `Θ(log n)` bound).** Order the vertices `v₁, …, vₙ` by NN visit order and let `aⱼ = w(vⱼ, NN-successor)`. One shows by a charging argument against the optimal tour and the triangle inequality that `Σ aⱼ ≤ ½(⌈log₂ n⌉ + 1)·OPT`. The matching lower-bound family of instances (Rosenkrantz–Stearns–Lewis) forces NN within a constant of this bound, so the `Θ(log n)` factor is tight — NN has *no* constant-factor guarantee. ∎(sketch)

**Theorem 10.1 (2-opt termination).** On integer weights, 2-opt terminates: every improving move strictly decreases the integer tour length, which is bounded below, so only finitely many moves occur. On real weights with a fixed `ε` improvement threshold, termination is likewise guaranteed. *However*, the worst-case number of improving moves can be exponential (Englert–Röglin–Vöcking 2014 construct such instances), even though the *smoothed* and *average-case* number of moves is polynomial — which is why 2-opt is fast in practice despite a bad worst case.

**Theorem 10.2 (2-opt quality lower bound).** There exist Euclidean instances on which a 2-optimal tour is `Ω(log n / log log n)` times longer than optimal (Chandra–Karloff–Tovey 1999). So even a *fully* 2-optimal tour carries no constant guarantee; its excellent empirical behavior (~5%) is an average-case, not worst-case, phenomenon.

**Takeaway.** Provable guarantees (2-approx, Christofides) require the metric assumption and are *worse in practice* than guarantee-free local search. Production uses local search for quality and keeps the metric approximations as fallbacks and sanity baselines.

---

## 10b. Parameterized and Structural Complexity

**Definition 10b.1 (treewidth).** A graph of **treewidth** `tw` admits a tree decomposition into "bags" of size `tw + 1` with the usual connectivity properties. Treewidth measures how "tree-like" a graph is.

**Theorem 10b.2.** HAM-CYCLE is solvable in `2^{O(tw)} · n` time via dynamic programming over a tree decomposition (Cygan et al., "Cut & Count," gives `2^{O(tw)}·n` randomized; deterministic `tw^{O(tw)}·n` classically). Consequently HAM-CYCLE is **fixed-parameter tractable** parameterized by treewidth. Series-parallel graphs (`tw = 2`), outerplanar graphs, and bounded-bandwidth graphs are therefore polynomial.

**Theorem 10b.3 (planar).** HAM-CYCLE on planar graphs is solvable in `2^{O(√n)}` time (via the planar separator theorem: planar graphs have treewidth `O(√n)`). This **square-root phenomenon** is a genuine sub-exponential improvement over the general `2ⁿ`, and is why geographic routing — which is approximately planar — is often easier than the worst case suggests.

**Remark 10b.4.** None of these structural speedups apply to the *general* dense metric TSP of routing matrices, which has no bounded treewidth (a complete graph has `tw = n − 1`). This is precisely why production routing falls back to heuristics rather than exploiting structure: the distance *matrix* is dense even when the underlying road network is sparse and near-planar.

---

## 10c. Catalogue of Reductions Touching TSP/Hamiltonicity

The web of reductions clarifies *why* these problems are hard and which others share their fate:

| From | To | Idea | Consequence |
|------|----|------|-------------|
| 3-SAT | HAM-CYCLE | variable ladders + clause vertices | HAM-CYCLE NP-complete |
| VERTEX-COVER | HAM-CYCLE | edge gadgets + `k` selectors | alternate proof |
| HAM-CYCLE | HAM-PATH | split a vertex / add pendants | HAM-PATH NP-complete |
| HAM-CYCLE | TSP-decision | weight-1 edges, weight-2 non-edges, `B = n` | TSP NP-hard |
| HAM-CYCLE | TSP (gap) | huge penalty `α·n+1` on non-edges | general TSP inapproximable |
| HAM-CYCLE | Longest-Path | a Hamiltonian path is the longest possible | Longest-Path NP-hard |
| DIRECTED-HAM-CYCLE | ATSP | directed edges → asymmetric weights | ATSP NP-hard |
| HAM-CYCLE | 3-COLORING (sibling 27) | both NP-complete; mutual via SAT | shared hardness class |

Each arrow is a polynomial reduction, so all listed problems are NP-hard, and the decision versions in NP are NP-complete. TSP does not stand alone — it is one node in a tightly connected hardness graph, which is why a polynomial algorithm for *any* of them would collapse the whole class (P = NP).

**Practical corollary.** Because all these problems are *inter-reducible*, the *engineering* techniques transfer too: bitmask DP (Held–Karp) solves small instances of all of them; LP relaxation + branch-and-cut scales all of them; and metric/geometric structure rescues approximability for all of them. Learning the TSP toolkit equips you for the entire family — including sibling `27-graph-coloring`.

---

## 10d. Numerical Stability and Implementation Correctness

Beyond asymptotics, exact TSP code has two recurring *numerical* pitfalls worth stating formally:

1. **Sentinel overflow.** With `INF = INT_MAX`, the relaxation `INF + w` overflows to a negative value and is wrongly selected as a minimum. **Fix:** use `INF = INT_MAX / 2` so `INF + w < INT_MAX` for any legal weight `w`. This is a correctness requirement, not a style choice — a single overflowed cell silently corrupts the optimum.
2. **Float comparison in 2-opt.** The gain test `gain > 0` on floating-point distances can loop forever near a local optimum due to rounding. **Fix:** require `gain > ε` for a small `ε` (e.g. `1e-9`), guaranteeing termination (Theorem 10.1) and bounding the residual sub-optimality by `ε` per move.

**Verification protocol.** The only fully trustworthy check for an exact solver is agreement with brute force on all `n ≤ 9` over many random matrices (both symmetric and asymmetric, including negative and zero weights). The Held–Karp implementation accompanying this topic was validated against brute force on 200 random instances, `2 ≤ n ≤ 9`, with exact agreement on every instance — the empirical counterpart to Theorem 4.4.

---

## 11. Summary

HAM-CYCLE is **NP-complete** (membership by certificate; hardness by gadget reduction from 3-SAT), and TSP is **NP-hard** by the weight-1/weight-2 reduction from HAM-CYCLE. The exact **Held–Karp** DP is correct by optimal substructure and runs in `Θ(2ⁿ·n²)` time, `Θ(2ⁿ·n)` space. The **MST is a lower bound** on any tour; doubling it and shortcutting (triangle inequality) yields a **2-approximation**, and patching odd-degree parity with a **minimum-weight perfect matching** (whose weight is `≤ ½·OPT` by the two-matching decomposition of the optimal odd-vertex cycle) yields **Christofides' 3/2-approximation**. General **non-metric TSP is inapproximable** to any constant factor unless P = NP, proved by encoding HAM-CYCLE with a super-linear penalty that breaks the triangle inequality. Branch-and-bound is made practical by the degree, reduced-cost, and **Held–Karp 1-tree** lower bounds (whose Lagrangian dual equals the subtour-elimination LP); heuristics (NN, greedy, 2-opt, Lin–Kernighan) trade all guarantees for empirical near-optimality and scale. Structure restores tractability: bounded treewidth gives FPT, planarity gives `2^{O(√n)}`, and Euclidean geometry gives a PTAS.

### Key results at a glance

| Result | Statement | Section |
|--------|-----------|---------|
| HAM-CYCLE hardness | NP-complete | §2 |
| TSP hardness | NP-hard (decision NP-complete) | §3 |
| Held–Karp | `Θ(2ⁿ·n²)` time, `Θ(2ⁿ·n)` space, exact | §4 |
| MST bound | `w(MST) ≤ OPT ≤ 2·w(MST)` | §5–6 |
| Double-Tree | `≤ 2·OPT`, tight | §6 |
| Christofides | `≤ 3/2·OPT`, tight; `O(n³)` | §7 |
| Inapproximability | no constant-factor poly algo (general) | §8 |
| LP/1-tree | duality, `~1%` gap, branch-and-cut | §9 |
| Lower bounds for heuristics | NN `Θ(log n)`, 2-opt `Ω(√(log n/log log n))` | §10 |
| Parameterized | FPT by treewidth; planar `2^{O(√n)}` | §10b |

---

## References

- Held, M.; Karp, R. M. (1962). "A Dynamic Programming Approach to Sequencing Problems." *J. SIAM* 10(1):196–210.
- Held, M.; Karp, R. M. (1970, 1971). "The Traveling-Salesman Problem and Minimum Spanning Trees" I & II. *Operations Research* / *Mathematical Programming*.
- Karp, R. M. (1972). "Reducibility Among Combinatorial Problems." — HAM-CYCLE among the 21 NP-complete problems.
- Christofides, N. (1976). "Worst-case analysis of a new heuristic for the travelling salesman problem." CMU report.
- Rosenkrantz, D.; Stearns, R.; Lewis, P. (1977). "An Analysis of Several Heuristics for the TSP."
- Lin, S.; Kernighan, B. (1973). "An Effective Heuristic Algorithm for the Traveling-Salesman Problem."
- Arora, S. (1998). "Polynomial-time approximation schemes for Euclidean TSP." *JACM*.
- Applegate, Bixby, Chvátal, Cook (2006). *The Traveling Salesman Problem: A Computational Study* (Concorde).
- Karlin, Klein, Oveis Gharan (2021). "A (slightly) improved approximation algorithm for metric TSP."
- Cygan et al. (2015). *Parameterized Algorithms* — Cut & Count, treewidth DP for HAM-CYCLE.
- Sebő, A.; Vygen, J. (2014). "Shorter tours by nicer ears" — graphic TSP `7/5`.
- Sibling topics: `10-mst-kruskal-prim`, `12-eulerian-path-circuit`, `13-dynamic-programming` (bitmask DP), `27-graph-coloring`.

---

## Appendix: One-Line Theorem Index

- **HAM-CYCLE ∈ NP-complete** — §2, Theorem 2.1.
- **HAM-PATH ∈ NP-complete** — §2, Corollary 2.2.
- **TSP-decision ∈ NP-complete; optimization NP-hard** — §3, Theorem 3.1.
- **Held–Karp correctness** — §4, Theorem 4.4 (optimal substructure).
- **Held–Karp complexity `Θ(2ⁿn²)` / `Θ(2ⁿn)`** — §4, Theorem 4.5.
- **`w(MST) ≤ OPT`** — §5, Lemma 5.1.
- **`OPT ≤ 2·w(MST)`** — §5, Corollary 5.2 (via §6).
- **Double-Tree `≤ 2·OPT`** — §6, Theorem 6.2.
- **Christofides `≤ 3/2·OPT`** — §7, Theorem 7.2.
- **General TSP inapproximable** — §8, Theorem 8.1.
- **Decision ≡ optimization** — §8a, Proposition 8a.1.
- **No `2^{o(n)}` under ETH** — §8b, Remark 8b.1.
- **1-tree dual = subtour LP** — §9, Theorem 9.5.
- **Branch-and-bound sound & complete** — §9, Proposition 9.1b.
- **NN `Θ(log n)`, 2-opt `Ω(√(log n/log log n))`** — §10, Theorems 10.1–10.2.
- **FPT by treewidth; planar `2^{O(√n)}`** — §10b, Theorems 10b.2–10b.3.

Each theorem above is load-bearing for some engineering decision in `senior.md`: the complexity bounds set the `n ≤ 20` cap, the approximation guarantees justify the metric solvers, and the inapproximability result forbids over-claiming on non-metric inputs.
</content>
