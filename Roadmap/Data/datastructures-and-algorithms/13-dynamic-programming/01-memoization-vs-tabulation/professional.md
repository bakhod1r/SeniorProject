# Memoization vs Tabulation — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. Optimal Substructure and Overlapping Subproblems
3. The Subproblem Dependency DAG
4. Memoization Computes the Recurrence (Correctness Proof)
5. Tabulation Computes the Recurrence (Correctness Proof)
6. Equivalence of the Two Strategies
7. Complexity: States × Transition Cost
8. Why Acyclicity Is Necessary and Sufficient
9. Space Lower Bounds and Rolling-Array Validity
10. Worked Foundations: Fibonacci, Climbing Stairs, Grid Paths
11. Quantifying the Overlap: The Call-Tree Recurrence
12. Amortized Analysis of the Memo Cache
13. Pseudo-Polynomiality and the Role of the Encoding
14. Topological Orders, Antichains, and Parallel Tabulation
14b. A Fully Worked Proof Instance: Grid Paths
15b. Worked Proof Instance: Fibonacci End to End
15c. The Generating-Function View and Why It Confirms the DP
15. Relationship to Divide-and-Conquer and Greedy
16. Lower Bounds and What DP Cannot Beat
16b. Correctness Is Preserved Under a Ring Homomorphism
16d. Referential Transparency Is the Precondition for Memoization
16c. DAG-Shortest-Path Equivalence
16e. The Space–Time Frontier of a DP
16f. Notation Recap and Master Complexity Derivation
17. Summary

---

## 1. Formal Definitions

We model a dynamic-programming problem abstractly so that statements about memoization and tabulation are precise.

**Definition 1.1 (State space).** A DP is specified over a finite **state space** `S`, a set whose elements `s ∈ S` are the subproblems. For Fibonacci `S = {0, 1, …, n}`; for the `R×C` grid `S = {0,…,R−1} × {0,…,C−1}`.

**Definition 1.2 (Value function).** The object we want to compute is a function `f : S → V`, where `V` is a value set (the integers, the integers mod `p`, `ℝ ∪ {±∞}` for optimization, `{0,1}` for feasibility).

**Definition 1.3 (Dependency relation).** A relation `D ⊆ S × S` where `(s, s') ∈ D` (written `s → s'`) means "the value `f(s)` is defined in terms of `f(s')`." The set `dep(s) = { s' : s → s' }` is the **dependency set** of `s`.

**Definition 1.4 (Base states).** `B = { s ∈ S : dep(s) = ∅ }`, the states with no dependencies. Each `b ∈ B` has a directly given value `f(b) = base(b)`.

**Definition 1.5 (Transition).** For every non-base `s`, a function `g_s` and the recurrence

```
f(s) = g_s( (f(s'))_{s' ∈ dep(s)} ).
```

`g_s` is the **transition** (combine) function; evaluating it given the dependency values costs `T(s)` time. We write `T = max_s T(s)`.

**Definition 1.6 (DP instance).** A DP instance is the tuple `(S, V, D, B, base, (g_s))`. The **answer** is `f(t)` for a designated target `t ∈ S` (or a contraction over several states).

**Remark.** Nothing here mentions recursion or arrays. Memoization and tabulation are two *algorithms* that compute `f` from this data; the next sections prove both compute the same `f` and analyze their cost.

---

## 2. Optimal Substructure and Overlapping Subproblems

The two textbook prerequisites for DP have crisp formal content.

**Definition 2.1 (Optimal substructure).** A problem has **optimal substructure** when `f(s)` is determined by the values `f(s')` of strictly smaller subproblems via a transition `g_s` — i.e. the recurrence of Definition 1.5 exists and is *correct* (its right-hand side equals the true value of the subproblem). For optimization problems this is the statement that an optimal solution to `s` contains optimal solutions to its subproblems; substituting a suboptimal sub-solution could only worsen (for min) or not improve (for max) the whole.

**Lemma 2.2 (Cut-and-paste for optimization DPs).** If `g_s = min` over `dep(s)` of `f(s') + w(s,s')`, then an optimal solution to `s` uses an optimal solution to whichever `s'` attains the minimum. *Proof.* Suppose an optimal solution to `s` decomposes through `s'` but uses a sub-solution of cost `> f(s')`. Replace it with one of cost `f(s')` (which exists by definition of `f(s')`); the total cost does not increase, contradicting strict suboptimality of the replacement, and yielding a solution of cost `f(s') + w(s,s') ≥ f(s)`. Equality must hold at the minimizing `s'`. ∎

**Definition 2.3 (Overlapping subproblems).** Let `N(s)` be the number of distinct calls to subproblem `s` made by the *unmemoized* recursion that naively unfolds the recurrence from the target. The problem has **overlapping subproblems** when `Σ_s N(s) ≫ |S|`, i.e. the unmemoized recursion revisits states asymptotically more often than there are states. Equivalently, the **call tree** (unfolding) is asymptotically larger than the **call DAG** (sharing equal subproblems).

**Proposition 2.4.** Memoization reduces the work from `Θ(Σ_s N(s))` (call-tree size) to `Θ(Σ_s (1 + |dep(s)|))` (DAG size), because each distinct state is evaluated once and thereafter served from the cache. The speedup factor is exactly the overlap ratio `Σ_s N(s) / |S|` (up to transition-cost weighting).

For Fibonacci, `N(s)` grows like Fibonacci itself (the unmemoized tree has `Θ(φ^n)` nodes) while `|S| = n+1`, so the overlap ratio — and the speedup — is exponential.

---

## 3. The Subproblem Dependency DAG

**Definition 3.1.** The **dependency graph** `G_D = (S, D)` has the states as vertices and a directed edge `s → s'` for each `s' ∈ dep(s)`.

**Theorem 3.2 (Acyclicity).** For the recurrence of Definition 1.5 to define `f` uniquely, `G_D` must be a **DAG** (no directed cycle).

*Proof.* (⇐) If `G_D` is acyclic, a topological order `s_1, …, s_m` exists with every edge pointing from later to earlier. Define `f` along this order: base states first (no out-edges in the dependency sense are unresolved), then each `s_i` from already-defined predecessors. This is well-defined and unique because each `f(s_i)` is a deterministic function of values fixed before it. (⇒) If `G_D` had a cycle `s_{i_1} → s_{i_2} → … → s_{i_1}`, then `f(s_{i_1})` would depend (transitively) on itself; the recurrence gives no terminating definition and no consistent value need exist. ∎

This DAG is the central object: **tabulation is a linear scan of a topological order of `G_D`; memoization is a depth-first traversal of `G_D` with caching.** Both visit each vertex once.

**Definition 3.3 (Longest dependency chain).** `L = ` length of the longest directed path in `G_D`. This equals the **recursion depth** of memoization and the **number of layers** in a layered tabulation. For Fibonacci `L = n`; for the grid `L = R + C − 2`.

---

## 4. Memoization Computes the Recurrence (Correctness Proof)

We prove the top-down algorithm computes exactly the function `f` of Definition 1.5.

**Algorithm M (memoization).**
```
cache ← empty
M(s):
    if s ∈ B:               return base(s)
    if s ∈ cache:           return cache[s]
    v ← g_s( (M(s'))_{s' ∈ dep(s)} )
    cache[s] ← v
    return v
```

**Theorem 4.1.** For every `s ∈ S`, `M(s)` terminates and returns `f(s)`.

*Proof (induction on the longest dependency chain length `ℓ(s)` of `s`).* Define `ℓ(s)` = length of the longest path from `s` in `G_D`; this is finite by Theorem 3.2 (acyclicity).

*Base `ℓ(s) = 0`.* Then `dep(s) = ∅`, so `s ∈ B`, and `M(s)` returns `base(s) = f(s)` by Definition 1.4–1.5. Terminates immediately.

*Inductive step `ℓ(s) = ℓ > 0`.* Every `s' ∈ dep(s)` has `ℓ(s') ≤ ℓ − 1` (any path from `s'` extends a path from `s` by one edge, so paths from `s'` are shorter). By the induction hypothesis each `M(s')` terminates and returns `f(s')`, regardless of whether the value came from a fresh computation or the cache: a cache entry `cache[s']` is written only as `v = f(s')` (by IH at the point it was written), so a cache hit also returns `f(s')`. Therefore `M(s)` computes `v = g_s((f(s'))_{s'∈dep(s)}) = f(s)` by Definition 1.5, stores it, and returns it. Termination follows because the recursion strictly decreases `ℓ`. ∎

**Corollary 4.2 (each state computed once).** The line `v ← g_s(…)` executes for a given `s` at most once across the whole run: after the first execution `cache[s]` is set, and every subsequent entry to `M(s)` returns at the cache check before recomputing. Hence the total number of transition evaluations is at most `|S|`.

---

## 5. Tabulation Computes the Recurrence (Correctness Proof)

**Algorithm T (tabulation).** Let `s_1, …, s_m` be a topological order of `G_D` (exists by Theorem 3.2): every edge `s_i → s_j` has `j < i`.
```
for i = 1 … m:
    if s_i ∈ B:  dp[s_i] ← base(s_i)
    else:        dp[s_i] ← g_{s_i}( (dp[s_j])_{s_j ∈ dep(s_i)} )
return dp[t]
```

**Theorem 5.1.** After Algorithm T finishes, `dp[s] = f(s)` for every `s ∈ S`.

*Proof (induction on the loop index `i`).*

*Base `i = 1`.* `s_1` has no predecessors earlier than itself; since all of `dep(s_1)` must appear before `s_1` in the order but none can, `dep(s_1) = ∅`, so `s_1 ∈ B` and `dp[s_1] ← base(s_1) = f(s_1)`.

*Step.* Assume `dp[s_j] = f(s_j)` for all `j < i`. If `s_i ∈ B`, then `dp[s_i] = base(s_i) = f(s_i)`. Otherwise every `s' ∈ dep(s_i)` equals some `s_j` with `j < i` (topological property), so by IH `dp[s'] = f(s')`. Thus `dp[s_i] = g_{s_i}((f(s'))_{s'∈dep(s_i)}) = f(s_i)` by Definition 1.5. ∎

**Corollary 5.2.** Algorithm T evaluates each transition exactly once, so it performs exactly `|S| − |B|` transition evaluations plus `|B|` base assignments — the same count (up to base cases) as memoization (Corollary 4.2).

**Remark on order.** Theorem 5.1 *requires* the loop to follow a topological order. Any order in which some `s_i` is processed before a dependency `s' ∈ dep(s_i)` would read an unset (or stale) `dp[s']` and the proof's inductive step fails. This is the formal statement of "tabulation's fill order must respect dependencies." Practically, one chooses a state encoding whose natural index order *is* a topological order (e.g. increasing `n` for Fibonacci; increasing `(r,c)` for the grid), so no explicit sort is needed.

---

## 6. Equivalence of the Two Strategies

**Theorem 6.1 (Functional equivalence).** For every target `t`, Algorithm M (memoization) and Algorithm T (tabulation) return the same value, namely `f(t)`.

*Proof.* By Theorem 4.1, `M(t) = f(t)`. By Theorem 5.1, `dp[t] = f(t)`. Hence both equal `f(t)` and therefore each other. ∎

This is the formal backing for the junior/middle claim "both styles produce identical answers." They are two correct algorithms for the same mathematical function; any observed disagreement is an implementation defect (wrong base case, incomplete state key, non-topological fill order, or overflow), not a property of the strategies.

**Theorem 6.2 (Reachability difference).** Let `R(t) ⊆ S` be the set of states reachable from `t` in `G_D`. Algorithm M evaluates transitions only for states in `R(t)`; Algorithm T (as written, over all `s_1…s_m`) evaluates transitions for all of `S`.

*Proof.* M is a DFS from `t`; it only enters `M(s)` for `s ∈ R(t)` by definition of reachability. T's loop ranges over all states. ∎

**Corollary 6.3.** When `|R(t)| ≪ |S|` (a sparse reachable set), memoization does asymptotically less work. When `R(t) = S` (the dense case, as in Fibonacci and the full grid) the two do the same number of transition evaluations and differ only by constant factors (call/cache overhead vs array indexing) and by the additive `O(L)` stack of memoization.

---

## 7. Complexity: States × Transition Cost

**Theorem 7.1 (Time).** Both algorithms run in time

```
Θ( Σ_{s ∈ S'} (1 + T(s)) )  =  Θ(|S'| · T̄)   in the uniform-cost case,
```

where `S' = R(t)` for memoization and `S' = S` for full tabulation, `T(s)` is the transition cost at `s`, and `T̄` the average. With `|dep(s)|` bounded by `d`, `T(s) = O(d)` and the bound is `Θ(|S'| · d)`.

*Proof.* By Corollaries 4.2 and 5.2 each state's transition is evaluated once. Summing the per-state cost `Θ(1 + T(s))` over the evaluated states gives the bound. Memoization adds `O(1)` cache operations per state (amortized `O(1)` for a hash map, true `O(1)` for an array), which does not change the asymptotics. ∎

**Applications.**

| DP | `|S|` | `T(s)` | Time |
|----|-------|--------|------|
| Fibonacci | `n+1` | `O(1)` (two reads, one add) | `Θ(n)` |
| Climbing stairs, steps `Σ` | `n+1` | `O(|Σ|)` | `Θ(n·|Σ|)` |
| Grid paths | `R·C` | `O(1)` | `Θ(R·C)` |

**Theorem 7.2 (Space).** Tabulation uses `Θ(|S|)` cells for the full table, reducible (Section 9) to `Θ(W)` for a dependency window `W`. Memoization uses `Θ(|R(t)|)` cache cells **plus** `Θ(L)` call-stack frames, where `L` is the longest dependency chain (Definition 3.3). The additive `Θ(L)` stack term is the formal source of the stack-overflow failure mode.

---

## 8. Why Acyclicity Is Necessary and Sufficient

We isolate the structural condition for *any* DP strategy to work.

**Theorem 8.1.** A recurrence over `(S, D, B, base, g)` is computable by memoization (Algorithm M) **and** by tabulation (Algorithm T) **if and only if** `G_D` is a DAG.

*Proof.*
(⇐, sufficiency) Theorem 3.2 (⇐) gives a topological order, so Algorithm T applies (Theorem 5.1); Theorem 4.1 already established M terminates because `ℓ(s)` is finite, which holds iff there is no cycle reachable from `s`.
(⇒, necessity) If `G_D` contains a directed cycle reachable from the target `t`, then for some `s` on the cycle `ℓ(s)` is infinite; Algorithm M recurses without a strictly decreasing measure and does not terminate (no base case is reached along the cycle). Algorithm T has no valid topological order (a cycle has none), so its precondition fails. ∎

**Consequence.** "Designing a DP" is exactly "imposing an acyclic dependency structure on the subproblems." When a problem's natural recurrence is cyclic (e.g. shortest paths with arbitrary self-influence), DP does *not* directly apply; one must either break the cycle (layering by step count, as in matrix-exponentiation walk DP) or use a different algorithm (Bellman-Ford / Dijkstra), which is why those live outside this topic.

---

## 9. Space Lower Bounds and Rolling-Array Validity

**Definition 9.1 (Dependency window).** Suppose states are indexed by an integer `i` (a topological coordinate) and `dep(s_i) ⊆ { s_{i-1}, …, s_{i-w} }` for a fixed window width `w`. Then the recurrence has a **bounded window** `w`.

**Theorem 9.2 (Rolling-array correctness).** For a bounded-window recurrence, tabulation that retains only the last `w` computed values (a buffer of size `w`, indices taken modulo `w` or shifted) computes the same `dp[t]` as the full table, provided the buffer slot for `s_{i-w-1}` is overwritten only *after* the last read that needs it.

*Proof.* By Theorem 5.1 the only values read when computing `dp[s_i]` are `dp[s_{i-1}], …, dp[s_{i-w}]`, all within the retained window. Once `dp[s_i]` is computed, `dp[s_{i-w}]` is no longer in the window of any `s_j` with `j ≥ i+1` (their windows start at `s_{i-w+1}` or later), so overwriting it after computing `dp[s_i]` cannot affect any future read. Hence every read returns the same value as in the full-table run, and by induction the outputs coincide. ∎

- Fibonacci/climbing stairs: window `w = 2` ⇒ two variables, `Θ(1)` space.
- Grid: row `r` depends on rows `r` and `r−1` ⇒ window of one row, `Θ(C)` space.

**Theorem 9.3 (When rolling fails).** If the problem requires reconstructing an optimal *witness* (the actual path/choices), the scalar table is insufficient: reconstruction needs either the full table or stored parent pointers of size `Θ(|S|)`. The rolling array discards exactly the information needed to trace back. *Proof sketch.* Reconstruction is a walk backward through the argmax/argmin choices at each state; those choices reference states outside the retained window, which the rolling buffer has overwritten. ∎

This is the formal trade-off: rolling arrays achieve the space lower bound for *computing the value* but violate the requirement for *exhibiting the solution*.

---

## 10. Worked Foundations: Fibonacci, Climbing Stairs, Grid Paths

**Fibonacci.** `S = {0,…,n}`, `f(i) = f(i−1)+f(i−2)`, `B = {0,1}`, `base(0)=0, base(1)=1`. `G_D` edges `i → i−1, i → i−2`; topological order is `0,1,…,n`. `|S| = n+1`, `T = O(1)` ⇒ `Θ(n)` time; window `w=2` ⇒ `Θ(1)` space. Growth: `f(n) = Θ(φ^n)` with `φ = (1+√5)/2`, so the unmemoized tree has `Θ(φ^n)` nodes — the overlap ratio of Proposition 2.4, hence the exponential speedup.

**Climbing stairs (steps `{1,2}`).** Identical DAG to Fibonacci with `base(0)=base(1)=1`; the value function is `f(n) = f_{Fib}(n+1)`. This is a *bijection of recurrences*: climbing-stairs counts equal shifted Fibonacci numbers, a fact provable by the same induction (both satisfy the order-2 recurrence with matching seeds).

**Grid paths.** `S = [R]×[C]`, `f(r,c) = f(r−1,c) + f(r,c−1)` with off-grid `= 0` and `f(0,0)=1`. Closed form: `f(r,c) = C(r+c, r)` (binomial), provable by induction — the recurrence is Pascal's rule `C(m,k) = C(m−1,k−1) + C(m−1,k)`. So `f(R−1,C−1) = C(R+C−2, R−1)`. The DAG is a grid poset; any order with `r,c` nondecreasing is topological. `|S| = R·C`, `T=O(1)` ⇒ `Θ(R·C)` time; window of one row ⇒ `Θ(C)` space.

These three show the spectrum: a closed form may exist (binomial / matrix power for Fibonacci), but the DP derivation is uniform and mechanical, and the memo/table equivalence (Theorem 6.1) holds for each.

---

## 11. Quantifying the Overlap: The Call-Tree Recurrence

We make Definition 2.3's "overlap" exact for Fibonacci, the canonical case.

**Proposition 11.1.** Let `C(n)` be the number of calls the *unmemoized* recursion `fib(n) = fib(n-1) + fib(n-2)` makes (counting the top call). Then

```
C(0) = 1,  C(1) = 1,  C(n) = 1 + C(n-1) + C(n-2)   (n ≥ 2).
```

*Proof.* Computing `fib(n)` makes one call (itself) plus all calls generated by its two children. ∎

**Theorem 11.2.** `C(n) = 2·F(n+1) − 1`, where `F` is the standard Fibonacci sequence (`F(1)=F(2)=1`). Hence `C(n) = Θ(φ^n)`.

*Proof (induction).* Base: `C(0) = 1 = 2·F(1) − 1 = 2·1 − 1`. `C(1) = 1 = 2·F(2) − 1`. Step: assume the formula for `n-1, n-2`. Then
```
C(n) = 1 + C(n-1) + C(n-2)
     = 1 + (2F(n) − 1) + (2F(n-1) − 1)
     = 2(F(n) + F(n-1)) − 1
     = 2F(n+1) − 1.
```
Since `F(n+1) = Θ(φ^n)` with `φ = (1+√5)/2 ≈ 1.618`, the call count is exponential. ∎

**Corollary 11.3 (exact speedup).** The overlap ratio is `C(n) / |S| = (2F(n+1) − 1) / (n+1) = Θ(φ^n / n)`. Memoization (or tabulation) collapses `Θ(φ^n)` work to `Θ(n)`, a speedup of exactly that ratio. For `n = 50`: `C(50) = 2·F(51) − 1 = 2·20{,}365{,}011{,}074 − 1 ≈ 4.07 × 10^{10}` calls unmemoized, versus `51` evaluations memoized — a factor of ~`8 × 10^8`. This is why naive `fib(50)` hangs and the cached version is instant.

**Generalization.** For an order-`r` linear recurrence with all coefficients contributing, the unmemoized call count grows like `θ^n` where `θ > 1` is the dominant root of the characteristic polynomial. The number of distinct states is still `n+1`. Thus *every* linear-recurrence DP exhibits exponential overlap, and DP is mandatory.

---

## 12. Amortized Analysis of the Memo Cache

The time bound of Theorem 7.1 assumed `O(1)` cache operations. We justify this and the subtlety of hash-map vs array backing.

**Array-backed cache.** When states inject into a contiguous integer range `[0, S)`, the cache is an array; read and write are worst-case `O(1)`. The total cache work is `Θ(S)` — exactly one write and `O(1)` reads per state. No amortization needed; the bound is tight and worst-case.

**Hash-map-backed cache.** When states are tuples or sparse, a hash map gives *expected amortized* `O(1)` per operation under simple uniform hashing, with `O(S)` resizes amortized across `S` insertions (the standard doubling argument: total copying work over all resizes is `S + S/2 + S/4 + … < 2S`). Therefore:

**Theorem 12.1.** With a hash-map cache, memoization runs in `O(Σ_s (1 + T(s)))` *expected* time, matching Theorem 7.1 up to the expectation. The worst case (adversarial hash collisions) degrades to `O(S²)` for the cache operations unless a collision-resistant or balanced-tree fallback is used (as in modern hash maps that treeify long chains, giving `O(S log S)` worst case).

**Why this matters for the memo-vs-table choice.** Tabulation over a dense integer-indexed table never pays hashing cost; its constant factor is a single array index. A memoized solver over a tuple state pays the hash each access. On equal asymptotics, this constant gap (often 3–10×) is a real reason to convert hot memoized code to tabulation once the recurrence is validated — formalizing the senior-level guidance.

**Lemma 12.2 (no recomputation under a stable cache).** If no entry is evicted during a single top-down evaluation, each transition is evaluated exactly once (Corollary 4.2), so the number of `g_s` evaluations is independent of the cache backing. Eviction breaks this: evicting an entry that is later requested forces a re-evaluation, and a pathological eviction schedule can reintroduce the exponential call-tree of Section 11. This is the formal reason senior practice forbids evicting states on the active dependency path.

---

## 13. Pseudo-Polynomiality and the Role of the Encoding

A subtle but interview-relevant point: the complexity `Θ(|S| · T)` is polynomial in `|S|`, but `|S|` itself may be exponential in the *input size in bits*.

**Definition 13.1 (input size).** The input size `|x|` is the number of bits to encode the instance. For Fibonacci, the input is the integer `n`, encoded in `Θ(log n)` bits.

**Observation 13.2.** The Fibonacci DP has `|S| = n + 1` states, hence runs in `Θ(n)` arithmetic operations — but `n = 2^{Θ(|x|)}`, so it is *exponential in the input size* `|x| = Θ(log n)`. This is **pseudo-polynomial**: polynomial in the *numeric value* `n`, exponential in its *bit-length*. (It is also worse than pseudo-polynomial once big-integer arithmetic is counted, since `F(n)` has `Θ(n)` digits.)

**Consequence.** This is exactly why matrix exponentiation matters: it computes `F(n)` in `Θ(log n)` matrix multiplies = `Θ(log n)` operations on `Θ(n)`-digit numbers, *polynomial in the input bit-length*. The same phenomenon appears in 0/1 knapsack (`O(n·W)` is pseudo-polynomial in the capacity `W`), which is why knapsack is NP-hard despite a "polynomial-looking" DP.

**Theorem 13.3.** A DP whose state space size is polynomial in the numeric value of an input integer (not its bit-length) yields a pseudo-polynomial algorithm; it is genuinely polynomial only when `|S|` is polynomial in `|x|`. Memoization and tabulation share this property identically — the strategy does not change the complexity class, only the constants, stack usage, and which states are touched.

This places the memo-vs-table distinction precisely: it is an *implementation* choice within a fixed complexity class, never a route to a better class. Improving the class requires changing the *state design* (fewer/structured states) or switching tools (matrix power, FFT, convex-hull trick), topics layered on top of this one.

---

## 14. Topological Orders, Antichains, and Parallel Tabulation

Tabulation's correctness (Theorem 5.1) requires *a* topological order; it does not require a *unique* one. The freedom in choosing the order has both correctness and performance consequences.

**Definition 14.1 (level / antichain).** Partition `S` by longest-path distance from the base set: `level(s) = ℓ` iff the longest dependency chain from `s` to a base state has length `ℓ` (Definition 3.3). Each level is an **antichain** of `G_D`: no two states in the same level depend on each other.

**Theorem 14.2 (level-order is topological).** Processing states in nondecreasing `level` is a valid topological order, and within a level the states may be processed in *any* order — including *simultaneously*.

*Proof.* Every edge `s → s'` has `level(s') < level(s)` (a chain from `s` extends one from `s'`), so processing by increasing level places every dependency before its dependent. Within a fixed level there are no edges (antichain), so order is irrelevant and the values do not interfere. ∎

**Corollary 14.3 (parallel tabulation).** The states of one level can be evaluated in parallel; the DP's *parallel depth* equals the number of levels `= L + 1` (the longest chain), and its *work* equals `|S| · T`. For the grid, level `= r + c`, so the `R×C` grid has `R + C − 1` levels (anti-diagonals), each independently fillable — the basis of the classic anti-diagonal wavefront parallelization. Fibonacci has `L = n` levels of one state each, so it is inherently sequential (parallel depth `Θ(n)`): no parallelism is available, which is itself a structural fact about the recurrence.

**Remark on memoization.** Memoization fixes the order to the DFS discovery order; it cannot exploit antichain parallelism without becoming, in effect, a parallel tabulation. The bottom-up form exposes the dependency structure explicitly, which is why high-performance DP engines tabulate and schedule by level.

---

## 14b. A Fully Worked Proof Instance: Grid Paths

To ground the abstract machinery, we carry the grid-path DP through every theorem.

**Setup.** `S = {0,…,R−1} × {0,…,C−1}`, `V = ℕ`. Dependencies `(r,c) → (r−1,c)` and `(r,c) → (r,c−1)` (omit those with a negative coordinate). Base set `B = {(0,0)}` with `base(0,0)=1`; cells with a negative coordinate are treated as the additive identity `0`. Transition `g_{(r,c)}(a,b) = a + b`.

**Acyclicity (Theorem 3.2).** Define the potential `Φ(r,c) = r + c`. Every edge strictly decreases `Φ` (by exactly 1). A directed cycle would return to its start with the same `Φ`, impossible if every edge decreases it. Hence `G_D` is a DAG. ∎

**A valid topological order.** Order states by nondecreasing `Φ = r + c`, breaking ties arbitrarily. By the edge property every dependency has strictly smaller `Φ`, so it precedes its dependent. Row-major order (`r` outer, `c` inner, both increasing) is a refinement of this and is therefore also topological — which is why the simple double loop works.

**Tabulation correctness (Theorem 5.1) specialized.** Induct on `Φ`. Base `Φ=0`: only `(0,0)`, set to `1`. Step: for `Φ=φ>0`, each `(r,c)` with `r+c=φ` reads `(r−1,c)` and `(r,c−1)`, both with `Φ=φ−1`, already correct by IH; so `dp[r][c] = dp[r−1][c] + dp[r][c−1]`, which equals the true number of monotone paths to `(r,c)` because every such path's last step is either from above or from the left, partitioning the paths into the two summed sets. ∎

**Closed form via the recurrence.** Claim `f(r,c) = \binom{r+c}{r}`. Base `f(0,0)=\binom{0}{0}=1`. Inductive step: `\binom{r+c}{r} = \binom{r+c−1}{r−1} + \binom{r+c−1}{r}` is Pascal's identity, and the two terms are exactly `f(r−1,c)` and `f(r,c−1)`. Hence the DP computes a binomial coefficient; the answer is `\binom{R+C−2}{R−1}`. This is a case where a closed form exists, yet the DP derivation is uniform and the memo/table equivalence still holds.

**Complexity (Theorem 7.1).** `|S| = R·C`, each transition is one addition, `T = O(1)`, so time `Θ(R·C)`. Memoization touches only `R(target) = S` here (every cell is on some monotone path to the corner), so both styles do `Θ(R·C)` work; memoization additionally uses `Θ(R+C)` stack (the longest chain has length `R+C−2`).

**Rolling array (Theorem 9.2).** `dep((r,c)) ⊆ {(r−1,c), (r,c−1)}`; in row-major order both lie within "the previous row plus the current partial row," a window of one row. Retaining one length-`C` array and updating `row[c] += row[c−1]` left-to-right satisfies the overwrite condition of Theorem 9.2: when `row[c]` is overwritten it still holds the old (previous-row) value as the "up" term, and `row[c−1]` already holds the new (current-row) value as the "left" term. Space drops to `Θ(C)`. Reconstruction of an actual path, however, needs the full `Θ(R·C)` table (Theorem 9.3), since backtracking from the corner consults cells outside the retained row.

This single example exercises Definitions 1.1–1.6, Theorems 3.2, 5.1, 7.1, 9.2, and 9.3 — a complete trace from definition to optimized implementation.

---

## 15. Relationship to Divide-and-Conquer and Greedy

**Divide-and-conquer** is the special case where `G_D` is a *tree* (no shared subproblems): `Σ_s N(s) = |S|`, the overlap ratio is 1, and caching saves nothing (Proposition 2.4). Merge sort's subproblems are disjoint halves; memoizing them is pure overhead.

**Memoized divide-and-conquer** sits between the two: if the divide step *does* create overlapping subproblems (as in many interval DPs), caching converts an exponential D&C into a polynomial DP. The boundary between "D&C" and "DP" is precisely whether `G_D` is a tree or a genuine DAG with sharing.

**Greedy** applies a stronger structural property than optimal substructure: the **greedy-choice property**, that a single locally optimal choice is part of *some* global optimum, so one does not need to explore (and combine over) all of `dep(s)` — only the greedy branch. When the greedy-choice property holds, the DP's `min/max` over `dep(s)` collapses to a single deterministic edge, reducing `T(s)` from `O(|dep(s)|)` to `O(1)` and often `|S|` from exponential to linear. Where it fails (e.g. 0/1 knapsack), one must keep the full DP. Formally, greedy is DP whose dependency DAG degenerates to a single chain of forced choices.

---

## 15b. Worked Proof Instance: Fibonacci End to End

We carry Fibonacci through the same theorems, highlighting where it differs from the grid.

**Setup.** `S = {0,…,n}`, `V = ℤ`. Dependencies `i → i−1`, `i → i−2` (for `i ≥ 2`). Base `B = {0,1}`, `base(0)=0`, `base(1)=1`. Transition `g_i(a,b) = a + b`.

**Acyclicity (Theorem 3.2).** Potential `Φ(i) = i` strictly decreases along every edge, so `G_D` is a DAG; the natural integer order `0,1,…,n` is topological.

**Memoization correctness (Theorem 4.1) traced.** `ℓ(i) = i` (the longest chain from `i` is `i → i−1 → … → 0`). Induction on `ℓ`: `M(0)=0`, `M(1)=1` (base); for `i ≥ 2`, `M(i)` recurses into `M(i−1)` and `M(i−2)`, which by IH return `F(i−1)` and `F(i−2)`; the first request for each computes and caches it, later requests hit the cache (Corollary 4.2), so `M(i) = F(i−1)+F(i−2) = F(i)`.

**The overlap that makes caching essential.** Without the cache, `M(i)` would spawn `C(i) = 2F(i+1)−1 = Θ(φ^i)` calls (Theorem 11.2) — the call tree. With the cache, the call *DAG* has `i+1` nodes. This is the single starkest illustration of Definition 2.3: the tree-to-DAG collapse is exponential.

**Tabulation correctness (Theorem 5.1) traced.** `dp[0]=0`, `dp[1]=1`; for `i` from `2` to `n`, `dp[i]=dp[i−1]+dp[i−2]`, both already correct by the loop invariant. The order `2,3,…,n` is exactly the topological order, so no read precedes its write.

**Complexity and space.** `|S|=n+1`, `T=O(1)` (one addition), so `Θ(n)` time — but pseudo-polynomial in the input bit-length (Theorem 13.3), since `n` is given in `log n` bits. Rolling window `w=2` (Theorem 9.2): `dep(i) ⊆ {i−1, i−2}`, so two variables suffice, `Θ(1)` space. The two variables `(prev2, prev1)` are precisely the retained window; overwriting `prev2` after computing `cur` is safe because `prev2` (= `F(i−2)`) is never read again once `F(i)` is formed.

**Parallel depth (Theorem 14.2).** Each level is a single state (`level(i)=i`), so the parallel depth is `Θ(n)` — Fibonacci is inherently sequential. Contrast the grid, whose anti-diagonals give parallel depth `Θ(R+C)` with `Θ(min(R,C))` width. This is a structural fact the bottom-up view exposes and the recursive view hides.

---

## 15c. The Generating-Function View and Why It Confirms the DP

A linear-recurrence DP has an equivalent algebraic description that independently confirms the values the DP computes and exposes the asymptotics.

**Definition 15c.1.** The ordinary generating function of `(F(n))_{n≥0}` is `G(x) = Σ_{n≥0} F(n) x^n`.

**Proposition 15c.2.** For Fibonacci, `G(x) = x / (1 − x − x²)`.

*Proof.* From `F(n) = F(n−1) + F(n−2)` for `n ≥ 2`, multiply by `x^n` and sum:
```
Σ_{n≥2} F(n)x^n = x Σ_{n≥2} F(n−1)x^{n−1} + x² Σ_{n≥2} F(n−2)x^{n−2}
G(x) − F(0) − F(1)x = x(G(x) − F(0)) + x² G(x)
G(x) − x = x·G(x) + x²·G(x)        (using F(0)=0, F(1)=1)
G(x)(1 − x − x²) = x.
```
∎

**Consequence (partial fractions → closed form).** The denominator factors as `(1 − φx)(1 − ψx)` with `φ = (1+√5)/2`, `ψ = (1−√5)/2`. Partial fractions give `F(n) = (φ^n − ψ^n)/√5` (Binet's formula). Since `|ψ| < 1`, `F(n) = round(φ^n/√5)`, confirming `F(n) = Θ(φ^n)` and matching Theorem 11.2's growth. The DP and the generating function agree because both solve the same recurrence with the same seeds — a cross-check entirely independent of the algorithm.

**Why this is relevant to memo vs table.** The generating function tells us the *answer's magnitude* (`Θ(φ^n)`), hence the bit-length (`Θ(n)` digits), hence that any exact integer DP — memoized or tabulated — must do `Θ(n)` big-integer additions of growing-width numbers, i.e. `Θ(n²)` bit operations for the exact value. This bit-complexity is identical for both styles (they perform the same additions) and is the rigorous reason neither implementation choice changes the asymptotic class (Theorem 16.2). It also explains why the modular version (Section 6, senior) is `Θ(n)` machine operations: reducing mod `p` keeps every value `O(log p)` bits.

**Transfer-matrix restatement.** The recurrence is also `[F(n), F(n−1)]ᵀ = M · [F(n−1), F(n−2)]ᵀ` with `M = [[1,1],[1,0]]`, so `[F(n+1), F(n)]ᵀ = M^n · [F(1), F(0)]ᵀ`. The DP computes `M^n` implicitly by `n` matrix-vector products (`Θ(n)`); binary exponentiation computes `M^n` in `Θ(log n)` matrix products. This is the formal bridge from "Fibonacci DP" to "matrix exponentiation accelerator" referenced throughout this topic — and it lives outside the memo-vs-table axis because it changes the *engine*, not the implementation style.

---

## 16. Lower Bounds and What DP Cannot Beat

**Theorem 16.1 (read-the-input lower bound).** Any algorithm that computes `f(t)` and *depends* on every cell of an `R×C` input grid must read all `Θ(R·C)` cells, so `Ω(R·C)` is a time lower bound for the min-cost grid DP. The tabulation `Θ(R·C)` is therefore optimal up to constants for that problem. Neither memoization nor any cleverer order can beat it: the answer genuinely depends on every cell.

*Proof.* If an algorithm never reads cell `(r,c)`, an adversary may set that cell's cost to `0` or `+∞`; for some inputs this changes the optimal path's cost, so the algorithm is wrong on at least one input. Hence every correct algorithm reads every cell. ∎

**Contrast with Fibonacci.** The Fibonacci input is the single integer `n`, of size `Θ(log n)` bits — the algorithm does *not* read `n` cells, it reads `log n` bits. So the `Θ(n)` DP is *not* matched by a read-the-input lower bound; indeed matrix exponentiation achieves `Θ(log n)` operations (Section 13), beating the DP. The lesson: a DP is optimal only when its state count is forced by the input *content*, not merely by an input *value*.

**Theorem 16.2 (state-count is the lever, not the strategy).** For a fixed state space `(S, D)`, both memoization and tabulation are `Θ(|states evaluated| · T)` (Theorem 7.1); no choice between them changes the exponent. The only ways to beat `Θ(|S| · T)` are to (i) shrink `|S|` by a better state encoding, (ii) shrink `T` by exploiting structure (greedy-choice, convex-hull trick, Knuth/Yao monotonicity), or (iii) replace the engine (matrix power, FFT-accelerated convolution for sum-of-products transitions). These are *design* improvements, orthogonal to the memo-vs-table implementation axis.

**Corollary 16.3.** "Make my DP faster" almost never means "switch from memoization to tabulation" (that is a constant-factor or stack/memory fix). It means "reduce the state space or the transition cost." Senior engineers separate these two axes deliberately: the implementation axis (memo vs table) governs constants, stack, and memory; the design axis (state and transition) governs the asymptotic class.

---

## 16b. Correctness Is Preserved Under a Ring Homomorphism

Production DPs frequently compute counts modulo a prime. We justify that this does not change the recurrence's validity.

**Theorem 16b.1.** Let `φ : ℤ → ℤ/pℤ` be the reduction-mod-`p` map. If `f` satisfies the additive/multiplicative recurrence over `ℤ`, then `f̄ = φ ∘ f` satisfies the *same* recurrence over `ℤ/pℤ`, and the DP computing `f̄` (reducing after each operation) returns `φ(f(t))`.

*Proof.* `φ` is a ring homomorphism: `φ(a+b) = φ(a)+φ(b)` and `φ(a·b) = φ(a)·φ(b)` in `ℤ/pℤ`. The transition `g_s` is built from `+` and `·` (counting DPs), so `φ(g_s(…)) = g_s(φ(…))`. By induction over the topological order (Theorem 5.1), the reduced table equals `φ` applied to the exact table at every state. ∎

**Consequence.** Reducing intermediate values mod `p` — required to avoid overflow (Section 6) — provably preserves the answer mod `p`. Memoization and tabulation are equally covered, since both evaluate the identical operations (Theorem 6.1). The homomorphism argument fails for `min`/`max` semirings (those are not ring operations), which is why optimization DPs use saturating sentinels instead of modular reduction.

---

## 16d. Referential Transparency Is the Precondition for Memoization

Memoization silently assumes the transition is a **pure function** of its state. We make this assumption explicit because violating it is a frequent correctness bug.

**Definition 16d.1 (purity / referential transparency).** `g_s` is *pure* if its output depends only on the values of its dependencies, with no observable side effects and no dependence on hidden mutable state (global counters, time, RNG, I/O).

**Theorem 16d.2.** If every transition is pure, then caching is sound: returning a stored value for `s` yields the same result as recomputing it. If a transition is impure (output depends on call order or external state), the cached value may differ from a recomputation, and memoization can return a value inconsistent with the recurrence.

*Proof.* Soundness: purity means `g_s` is a mathematical function of the dependency values; since those values are fixed (the DAG is evaluated once, Corollary 4.2), the output is fixed, so the cached copy equals any recomputation. Unsoundness: if `g_s` reads a mutable global `c` that changes between the first computation (cached) and a later request, the cached value reflects the *old* `c` while a recomputation would reflect the *new* `c`; the two disagree, and which one the program uses depends on cache timing — a nondeterministic bug. ∎

**Practical corollaries.**
- A memoized function must not consume a shared RNG, mutate a counter, or depend on wall-clock time inside the transition; if it does, the cache makes results depend on evaluation order.
- Tabulation has the *same* requirement (each `dp[s]` must be a pure function of earlier cells), but the bug surfaces less because the fill order is fixed and deterministic — masking, not curing, the impurity.
- The safe pattern is to keep the DP transition pure and move any side effect (logging, metrics) to a wrapper that is invoked once per genuine computation (i.e. on a cache miss), never on a hit.

**Relation to the equivalence theorem.** Theorem 6.1 (memo = table) holds *only* under purity; impurity is precisely the loophole through which the two strategies can disagree in practice. So the formal "they always agree" carries the implicit hypothesis "for a pure recurrence," which is why senior code reviews scrutinize DP transitions for hidden state.

---

## 16c. DAG-Shortest-Path Equivalence

A unifying remark: every DP *is* a shortest/longest/count problem on its subproblem DAG.

**Proposition 16c.1.** A counting DP equals the number of source-to-target paths in a weighted DAG; an optimization DP equals the shortest (or longest) source-to-target path. Specifically, build a DAG with a vertex per state, an edge for each dependency, source vertices = base states, and combine `+`→ path-product / `min`→ path-minimum.

*Proof sketch.* The recurrence `f(s) = ⊕_{s'∈dep(s)} (f(s') ⊗ w(s,s'))` is exactly the Bellman relaxation on a DAG in the chosen semiring; evaluating it in topological order is the linear-time DAG shortest-path algorithm. Tabulation *is* that algorithm; memoization is its lazy recursive form. ∎

**Why this matters.** It explains *why* acyclicity is the precondition (Theorem 8.1): DAG shortest paths are linear-time precisely because there are no cycles to relax repeatedly. It also explains the semiring flexibility seen in sibling topics: swap `(+,×)` for `(min,+)` and the same DP machinery computes shortest exact-length structures. The memo-vs-table choice is, in this light, "lazy vs eager DAG relaxation" — two orders of the same relaxation, both correct because the DAG admits a topological order.

---

## 16e. The Space–Time Frontier of a DP

We characterize the achievable `(time, space)` pairs for a fixed DP, which delimits what any implementation can do.

**Theorem 16e.1 (recompute–store trade-off).** Let a DP have `|S|` states, transition cost `T`, and longest chain `L`. Then:

- The minimum *time* is `Θ(|S|·T)` (each state's transition evaluated once); achieved by full caching (memo or table). Space `Θ(|S|)`.
- The minimum *space* for the *value* is `Θ(W)` where `W` is the dependency-window width (Theorem 9.2), at the same time `Θ(|S|·T)` — rolling array.
- Reducing space below the window forces *recomputation*: keeping only every `b`-th layer and recomputing the gaps costs `Θ(L/b)` space and `Θ(b·|S|·T)` time — a tunable trade-off (the basis of checkpointing, used in reverse-mode autodiff over DP-like tapes).

*Proof sketch.* The first two are Theorems 7.1–7.2 and 9.2. For the third, storing one layer per `b` lets you reconstruct any dropped layer by replaying the `b−1` layers above the nearest stored one, multiplying time by `b` and dividing layer-space by `b`. ∎

**Consequence.** The `(time, space)` frontier is `time × space ≳ |S|·T·W` near the rolling-array corner, with checkpointing tracing a hyperbola `space ∝ 1/recompute_factor`. Memoization sits at the high-space, minimum-time corner (full cache, plus `Θ(L)` stack); tabulation can sit anywhere on the value-space axis from `Θ(|S|)` (full table, enables reconstruction) down to `Θ(W)` (rolling, value only). No implementation can leave this frontier without changing the *design* (state/transition), reaffirming Theorem 16.2.

**Where reconstruction lands on the frontier.** Recovering the witness needs information of size `Θ(|S|)` in the worst case (parent pointers), but Hirschberg's method (referenced in `senior.md`) achieves `Θ(W)` *space* for reconstruction at `Θ(|S|·T)` time by a divide-and-conquer replay — a specific, important point on the checkpointing hyperbola where `b = Θ(L)`.

---

## 16f. Notation Recap and Master Complexity Derivation

For reference, the symbols used and the one derivation that subsumes the rest.

| Symbol | Meaning |
|--------|---------|
| `S`, `|S|` | state space and its size |
| `T`, `T(s)` | transition cost (max, per-state) |
| `L` | longest dependency chain = recursion depth = #layers |
| `W` | dependency-window width (rolling-array size) |
| `R(t)` | states reachable from target `t` |
| `B` | base states |
| `φ`, `λ_max` | dominant growth root (e.g. golden ratio for Fibonacci) |

**Master derivation.** Both strategies evaluate each touched state's transition exactly once (Corollaries 4.2, 5.2). Let `U` be the touched set (`R(t)` for memo, `S` for full tabulation). Then

```
Time  = Σ_{s∈U} Θ(1 + T(s))               = Θ(|U|·T̄)
Space = Θ(|stored states|) + Θ(stack)
      = memo:  Θ(|R(t)|) + Θ(L)
        table: Θ(|S|) reducible to Θ(W),  stack 0.
```

Plugging the three running examples:

- Fibonacci: `|U|=n+1`, `T=O(1)`, `L=n`, `W=2` ⇒ time `Θ(n)`; memo space `Θ(n)+Θ(n)`, table space `Θ(n)→Θ(1)`.
- Climbing stairs (steps `Σ`): `T=O(|Σ|)` ⇒ time `Θ(n|Σ|)`; same space profile.
- Grid: `|U|=R·C`, `T=O(1)`, `L=R+C−2`, `W=` one row `=C` ⇒ time `Θ(R·C)`; memo space `Θ(R·C)+Θ(R+C)`, table space `Θ(R·C)→Θ(C)`.

Every quantitative claim in this document is an instance of this single derivation, which is the formal heart of the entire memo-vs-table topic.

---

## 17. Summary

A dynamic program is a value function `f` over a finite state space whose dependency relation forms a **DAG** (Theorem 3.2/8.1 — acyclicity is necessary and sufficient). **Memoization** is a cached depth-first traversal of that DAG; **tabulation** is a linear scan in topological order. Both evaluate each state's transition exactly once (Corollaries 4.2, 5.2) and provably compute the same function `f` (Theorems 4.1, 5.1, 6.1), so they always agree on the answer; they differ only in (i) which states they touch — memoization visits only the reachable set `R(t)` (Theorem 6.2), and (ii) auxiliary cost — memoization carries a `Θ(L)` stack while tabulation needs none. The running time of either is `Θ(|states evaluated| × transition cost)` (Theorem 7.1), the single formula that governs all DP analysis. Space is `Θ(|S|)`, reducible to `Θ(window)` by a rolling array whenever the recurrence has bounded dependency window (Theorem 9.2) — at the cost of losing solution reconstruction (Theorem 9.3). Optimal substructure (Definition 2.1, Lemma 2.2) makes the recurrence correct; overlapping subproblems (Definition 2.3, Proposition 2.4) make caching worthwhile, by exactly the overlap ratio.

---

## 18. Common Formal Pitfalls and Their Theorems

A compact map from a mis-stated DP to the theorem it violates — useful when debugging a "proof that won't close."

| Pitfall | Symptom | Violated result |
|---------|---------|-----------------|
| Recurrence references a not-yet-smaller state | Memo loops, no topological order | Theorem 3.2 / 8.1 (acyclicity) |
| Incomplete state key | Two subproblems collide, wrong cached value | Definition 1.2 (state must determine value) |
| Tabulation order not topological | Reads unset/stale cell | Theorem 5.1 (order precondition) |
| Impure transition under caching | Memo and table disagree | Theorem 16d.2 (purity) |
| Modular reduction on a `min`/`max` DP | Wrong optimum | Theorem 16b.1 (only ring ops) |
| Claiming optimal substructure without cut-and-paste | Greedy-looking but wrong | Lemma 2.2 |
| Expecting a better complexity from tabulation | No speedup | Theorem 16.2 (strategy ≠ class) |
| Rolling array then backtracking | Cannot reconstruct | Theorem 9.3 |

Each row is a concrete instance where the informal intuition outran one of the formal hypotheses; locating the violated theorem is the fastest route to the fix.

---

## 19. Summary of the Formal Picture

The development can be compressed to five load-bearing statements:

1. A DP is a function `f` on a finite state space whose dependency relation is a **DAG** (Theorem 3.2); acyclicity is necessary and sufficient for either strategy (Theorem 8.1).
2. **Memoization** = cached DFS of the DAG; **tabulation** = topological scan. Both evaluate each state once (Corollaries 4.2, 5.2) and compute the same `f` (Theorems 4.1, 5.1, 6.1) — *provided the transition is pure* (Theorem 16d.2).
3. Time is `Θ(|states evaluated| × transition cost)` (Theorem 7.1, master derivation 16f); the strategy choice changes constants, stack, and which states are touched (Theorem 6.2) — never the complexity class (Theorem 16.2).
4. Space ranges from `Θ(|S|)` down to `Θ(window)` via rolling arrays (Theorem 9.2), trading away reconstruction (Theorem 9.3) unless a checkpointing/Hirschberg schedule is used (Theorem 16e.1).
5. Overlapping subproblems (the exponential call-tree-to-DAG collapse, Theorems 11.2, Corollary 11.3) are what make caching worthwhile; optimal substructure (Lemma 2.2) is what makes the recurrence correct.

---

## Further Reading

- CLRS, *Introduction to Algorithms*, Ch. 15 — optimal substructure, overlapping subproblems, and the memoization/bottom-up correspondence.
- Kleinberg & Tardos, *Algorithm Design*, Ch. 6 — formal development of DP and the subproblem dependency structure.
- Cormen et al. — the cut-and-paste argument for optimal substructure (Lemma 2.2).
- Aho, Hopcroft, Ullman — topological ordering of DAGs (the precondition of tabulation).
- Concrete Mathematics (Graham, Knuth, Patashnik) — closed forms for Fibonacci (`φ^n`) and binomial grid paths.
- Sibling `19-number-theory/10-matrix-exponentiation` — linear-recurrence DP accelerated via the companion matrix and `O(log n)` powering.
