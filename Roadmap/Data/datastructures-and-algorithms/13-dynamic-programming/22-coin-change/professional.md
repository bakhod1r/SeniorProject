# Coin Change — Mathematical Foundations and Complexity Theory

## Table of Contents
0. Overview and Reading Guide
1. Formal Definitions
2. Optimal Substructure of Min-Coins (Proof)
   - 2.1 Counting the Overlap
3. Correctness of the Min-Coins DP (Proof)
   - 3.1 Worked Min-Coins Trace
   - 3.2 The INF Sentinel Choice, Formally
   - 3.3 Correctness of Reconstruction
4. Why Coin-Outer Counts Combinations (Proof)
   - 4.1 Worked Combinations Trace
   - 4.2 Why the Forward Sweep Is Essential
5. Why Amount-Outer Counts Permutations (Proof)
   - 5.1 Worked Permutations Trace
   - 5.2 The Boolean (Reachability) Specialization
6. Generating-Function View of Counting Change
   - 6.1 Partial Fractions and the Two-Coin Closed Form
   - 6.2 The Two GFs Are Equal Only for One Coin
7. Bounded Change and Partition Generating Functions
   - 7.1 Worked Bounded-GF Example
   - 7.2 Idempotency: Why Min Saturates but Count Grows
8. Canonical Coin Systems and Greedy Optimality (Pearson)
   - 8.1 Worked Canonicity Window Check
9. The Frobenius Number and Reachability
   - 9.1 Worked Frobenius Example
   - 9.2 The General n-Coin Picture
10. Complexity, Pseudo-Polynomiality, and Hardness
    - 10.1 Asymptotic Magnitude of the Counts
    - 10.2 The Decision-Problem Reduction
11. Link to Unbounded Knapsack and Linear Recurrences
    - 11.1 Worked Recurrence Derivation
    - 11.3 End-to-End Worked Example
12. Summary

---

## 0. Overview and Reading Guide

This document proves, from first principles, every claim the junior/middle/senior files assert about coin change:

- **Why the min-coins DP is correct** (optimal substructure, Sections 2–3).
- **Why coin-outer counts combinations and amount-outer counts permutations** (Sections 4–5), with the generating-function explanation that makes the loop order an *algebraic* fact (Section 6).
- **Why bounded change truncates each GF factor** (Section 7).
- **When greedy is provably optimal** (canonical systems, Pearson's test, Section 8).
- **When amounts are reachable** (gcd and the Frobenius number, Section 9).
- **Why the whole thing is pseudo-polynomial and weakly NP-hard** (Section 10), and **how huge `V` is rescued by linear recurrences** (Sections 6, 11).

Each section pairs a theorem with a worked numeric instance so the algebra never floats free of a concrete computation. The recurring instance `{1,2}` (and occasionally `{1,2,5}`) threads through as a running example, culminating in the end-to-end table of Section 11.3.

## 1. Formal Definitions

Let `C = {c_1, c_2, …, c_n}` be a set of positive integer **denominations** with `c_1 < c_2 < … < c_n`, and let `V ∈ ℕ` be the **target amount**. Unless stated otherwise, supply is **unbounded** (each `c_i` usable any number of times).

**Definition 1.1 (Representation).** A *representation* of `V` is a tuple of non-negative integers `(a_1, …, a_n)` with `Σ_i a_i c_i = V`, where `a_i` is the number of coins of denomination `c_i` used. A representation is precisely a **multiset** of coins.

**Definition 1.2 (Min-coins).** `M(V) = min { Σ_i a_i : (a_1,…,a_n) is a representation of V }`, with `M(V) = +∞` if no representation exists (V is *unreachable*).

**Definition 1.3 (Count of combinations).** `N(V) = | { (a_1,…,a_n) : Σ_i a_i c_i = V } |`, the number of distinct representations (multisets). By convention `N(0) = 1` (the empty multiset).

**Definition 1.4 (Count of permutations / compositions).** `P(V) = | { (b_1,…,b_m) : b_j ∈ C, Σ_j b_j = V, m ≥ 0 } |`, the number of **ordered sequences** of coins summing to `V`. `P(0) = 1` (the empty sequence).

**Remark.** The distinction between `N` (Definition 1.3, unordered multisets) and `P` (Definition 1.4, ordered sequences) is the crux of the counting variant: the loop order of the DP decides which one you compute. `P(V) ≥ N(V)` always, with equality only in degenerate cases.

**Notation conventions.** Throughout, `n = |C|` is the number of denominations, `V` the target (an integer given in `Θ(log V)` bits), `c_max = c_n` the largest coin, `M` the min-coins function, `N` the combination count, `P` the permutation count, `[x^k] F(x)` the coefficient of `x^k` in the formal power series `F`, and the Iverson bracket `[Q]` is `1` if predicate `Q` holds else `0`. We assume `c_1 = 1` exactly when we need every amount reachable; otherwise reachability is governed by `gcd(C)` (Section 9).

**Worked instance.** Coins `C = {1, 2, 5}`, `V = 6`. The representations (Definition 1.1) are the tuples `(a_1, a_2, a_3)` with `a_1 + 2a_2 + 5a_3 = 6`: `(6,0,0), (4,1,0), (2,2,0), (0,3,0), (1,0,1)` — so `N(6) = 5` (Definition 1.3). The minimum cardinality `Σ a_i` over these is `2`, achieved by `(1,0,1)` = `1 + 5` (Definition 1.2), so `M(6) = 2`. The ordered sequences `P(6)` (Definition 1.4) is larger: e.g. the multiset `(4,1,0)` = `{1,1,1,1,2}` alone has `5` orderings (choices of where the `2` sits). These three numbers — `N(6)=5`, `M(6)=2`, `P(6) > 5` — are the three quantities the rest of this document characterizes and proves correct.

---

## 2. Optimal Substructure of Min-Coins (Proof)

**Theorem 2.1 (Optimal substructure).** For `V > 0`, if `(a_1,…,a_n)` is an optimal (minimum-cardinality) representation of `V` and `a_k > 0` for some `k`, then `(a_1,…,a_k - 1,…,a_n)` is an optimal representation of `V - c_k`.

**Proof (cut-and-paste / exchange argument).** The reduced tuple is a valid representation of `V - c_k` since `Σ_i a_i c_i - c_k = V - c_k`, and its cardinality is `M(V) - 1`. Suppose, for contradiction, it were **not** optimal for `V - c_k`: then there is a representation `r'` of `V - c_k` with cardinality `< M(V) - 1`. Append one coin `c_k` to `r'` to obtain a representation of `V` with cardinality `< M(V)`, contradicting the optimality of the original. Hence the reduced tuple is optimal for `V - c_k`. ∎

**Corollary 2.2 (Bellman recurrence).** For `V > 0`,

```
M(V) = 1 + min { M(V - c_k) : c_k ≤ V },     M(0) = 0,
```

with the convention that the min over an empty set (no `c_k ≤ V` yields a finite `M(V-c_k)`) is `+∞`.

**Proof.** Any optimal representation of `V` uses at least one coin; let `c_k` be (say) the last coin placed. By Theorem 2.1 the remaining `V - c_k` is solved optimally, contributing `M(V - c_k)`, plus `1` for `c_k`. Taking the minimum over all valid last coins `c_k ≤ V` yields the formula. The base `M(0) = 0` is the empty representation. ∎

This is the optimal-substructure half of the two DP requirements; the overlapping-subproblems half is immediate since each `M(w)` for `w < V` is referenced by many larger amounts.

### 2.1 Counting the Overlap

The naive recursion `M(V) = 1 + min_c M(V-c)` has a recursion tree with branching factor `n` and depth up to `V`, giving `O(n^V)`-ish blowup. But the *distinct* arguments `M(0), M(1), …, M(V)` number only `V+1`. The ratio of recursive calls to distinct subproblems is the overlap, and it is enormous — e.g. for `{1,2,5}` and `V = 30`, the unmemoized tree has millions of nodes resolving just `31` distinct values. Memoization (or bottom-up tabulation) computes each of the `V+1` values once, each in `O(n)` work, giving the `O(V·n)` total. This is the textbook illustration of why coin change is a *dynamic-programming* problem and not merely a recursive one: optimal substructure makes the recurrence correct; overlapping subproblems make memoization a polynomial-in-`V` speedup. (See sibling `01-memoization-vs-tabulation` for the top-down framing of this exact recursion.)

---

## 3. Correctness of the Min-Coins DP (Proof)

**Algorithm (bottom-up).**
```
dp[0] = 0; dp[v>0] = +∞
for c in C:
    for v in c .. V:
        dp[v] = min(dp[v], dp[v-c] + 1)
return dp[V]
```

**Theorem 3.1.** After the algorithm terminates, `dp[V] = M(V)` for every `V`.

**Proof.** We show `dp[v] = M(v)` for all `v` at termination. First, `dp[v] ≥ M(v)` is an invariant throughout: every update `dp[v] = min(dp[v], dp[v-c]+1)` corresponds to an actual representation (extend a representation of `v - c` by one coin `c`), so `dp[v]` is always the cardinality of *some* representation (or `+∞`), hence `≥ M(v)`.

For `dp[v] ≤ M(v)`: induct on `M(v)`. If `M(v) = 0` then `v = 0` and `dp[0] = 0`. If `M(v) = m > 0`, an optimal representation uses some coin `c_k` with `M(v - c_k) = m - 1` (Corollary 2.2). By the induction hypothesis the algorithm sets `dp[v - c_k] = m - 1` at some point. We must ensure the relaxation `dp[v] = min(dp[v], dp[v-c_k]+1)` runs *after* `dp[v-c_k]` reaches `m-1`. In the unbounded forward sweep, when coin `c_k`'s pass processes amount `v`, it reads `dp[v - c_k]` which has already been finalized to `M(v - c_k)` by that coin's pass over the smaller amount `v - c_k < v` (forward order) and by earlier coins. More carefully: because `M` is achieved by *some* coin and the forward sweep lets a coin be reused, the relaxation chain `0 → c_k → 2c_k → …` propagates the optimum; combined over all coins, every optimal last-coin choice is eventually applied. Thus `dp[v] ≤ m = M(v)`. Both inequalities give equality. ∎

**Remark (loop-order independence for min).** Unlike counting, the **min** variant is correct under *either* coin-outer or amount-outer loop order, because `min` is idempotent and order-insensitive: re-relaxing an already-optimal cell does nothing. Only the **counting** variant is loop-order sensitive (Sections 4–5).

### 3.1 Worked Min-Coins Trace

Coins `{1, 4, 5}`, target `V = 8`. We sweep coins in the outer loop.

```
init:        dp = [0, ∞, ∞, ∞, ∞, ∞, ∞, ∞, ∞]
coin 1:      dp = [0, 1, 2, 3, 4, 5, 6, 7, 8]   (only 1s)
coin 4:      dp[4]=min(4,dp[0]+1)=1
             dp[5]=min(5,dp[1]+1)=2
             dp[6]=min(6,dp[2]+1)=3
             dp[7]=min(7,dp[3]+1)=4
             dp[8]=min(8,dp[4]+1)=2          // 4+4
             dp = [0, 1, 2, 3, 1, 2, 3, 4, 2]
coin 5:      dp[5]=min(2,dp[0]+1)=1          // single 5
             dp[6]=min(3,dp[1]+1)=2
             dp[7]=min(4,dp[2]+1)=3
             dp[8]=min(2,dp[3]+1)=2          // 4+4 still wins (5+?3 needs 3 more)
             dp = [0, 1, 2, 3, 1, 1, 2, 3, 2]
```

`M(8) = 2` (`4 + 4`). Note the greedy choice `5 + ?` would take `5` then need `3 = 1+1+1`, giving 4 coins — but `{1,4,5}` happens to be non-canonical at `V = 8`, and the DP correctly finds `4+4`. This trace also confirms Theorem 3.1's claim that the optimum propagates through the forward sweep regardless of which coin achieves it.

### 3.2 The `INF` Sentinel Choice, Formally

The recurrence reads `dp[v-c] + 1`. If `dp[v-c] = +∞` (unreachable), the `+1` must remain `+∞` and lose the `min`. Using a finite machine sentinel `INF` (e.g. `amount + 1` or `1<<30`), the addition `INF + 1` must not (a) overflow the integer type, nor (b) accidentally beat a legitimate finite value. Choosing `INF = amount + 1` satisfies both: any reachable amount needs at most `amount` coins (all of value 1 if `1 ∈ C`), so a true answer is `≤ amount < INF`, and `INF + 1 = amount + 2` does not overflow. The guard `if dp[v-c] != INF` (or `dp[v-c] + 1 < dp[v]` with `INF` large) preserves the algebra of `+∞` exactly. This is the formal reason the junior/middle files insist on `INF = amount + 1` rather than `MAX_INT`.

### 3.3 Correctness of Reconstruction

**Proposition 3.4.** Maintaining `parent[v] = c` whenever the relaxation `dp[v] = dp[v-c] + 1` strictly improves `dp[v]`, and then walking `v ← v - parent[v]` from `V` down to `0`, recovers an optimal multiset of cardinality `M(V)`.

**Proof.** At termination, `parent[v]` records a coin `c*` with `dp[v] = dp[v - c*] + 1 = M(v)` (the last improving relaxation set it, and `dp` only decreases, so the final `parent` is consistent with the final `dp`). Thus `M(v - c*) = M(v) - 1`. Repeatedly following `parent` strictly decreases the amount (each step subtracts a positive coin) and strictly decreases the optimal cost by exactly `1`, so after `M(V)` steps we reach amount `0`, having emitted exactly `M(V)` coins summing to `V`. The emitted multiset is therefore an optimal representation. Termination is guaranteed because the amount is a strictly decreasing non-negative integer. ∎

This is why the `parent[]`-array reconstruction (middle file) is correct, not merely heuristic: the chain of `parent` pointers is precisely the cut-and-paste decomposition of Theorem 2.1 applied repeatedly.

---

## 4. Why Coin-Outer Counts Combinations (Proof)

Index the coins `c_1 < … < c_n`. Define `f_i(v)` = number of representations of `v` using only coins from `{c_1, …, c_i}` (a multiset over the first `i` denominations).

**Lemma 4.1 (Layered recurrence).** `f_i(v) = f_{i-1}(v) + f_i(v - c_i)` for `v ≥ c_i`, with `f_i(v) = f_{i-1}(v)` for `0 ≤ v < c_i`, `f_0(0) = 1`, `f_0(v>0) = 0`.

**Proof.** Partition the representations of `v` over `{c_1,…,c_i}` by whether they use coin `c_i` zero times or at least once. Those using `c_i` zero times are exactly the representations over `{c_1,…,c_{i-1}}`, counted by `f_{i-1}(v)`. Those using `c_i` at least once are in bijection with representations of `v - c_i` over `{c_1,…,c_i}` (remove one `c_i`; the inverse adds one back), counted by `f_i(v - c_i)`. The two classes are disjoint and exhaustive, so the counts add. ∎

**Theorem 4.2 (Coin-outer correctness).** The coin-outer DP
```
dp[0]=1; dp[v>0]=0
for i in 1..n:           # OUTER
    for v in c_i..V:     # forward
        dp[v] += dp[v - c_i]
```
computes `dp[V] = N(V)`, the number of **combinations** (each multiset counted exactly once).

**Proof.** We claim that after the outer iteration for coin `c_i` completes, `dp[v] = f_i(v)` for all `v`. Induct on `i`. Base `i = 0` (before any coin): `dp[0] = 1`, `dp[v>0] = 0`, which is `f_0`. Inductive step: entering iteration `i`, `dp[v] = f_{i-1}(v)` by hypothesis. The inner forward sweep computes, in increasing `v`, the in-place update `dp[v] ← dp[v] + dp[v - c_i]`. Because the sweep is **forward**, when we update `dp[v]` the cell `dp[v - c_i]` has *already* been updated in this same pass (for `v - c_i ≥ c_i`), so it already equals `f_i(v - c_i)`; for `v - c_i < c_i` it equals `f_{i-1}(v-c_i) = f_i(v-c_i)` (no `c_i` usable below `c_i`). Hence the update realizes exactly `f_i(v) = f_{i-1}(v) + f_i(v - c_i)` of Lemma 4.1. By induction, after coin `c_n`, `dp[V] = f_n(V) = N(V)`. ∎

**The combinatorial meaning.** Processing coins one at a time and never returning to an earlier coin imposes a **canonical order** (non-decreasing denomination) on every multiset's "construction". Each multiset has exactly one such canonical construction, so it is counted once. This is the precise reason coin-outer counts unordered multisets.

### 4.1 Worked Combinations Trace

Coins `{1, 2, 3}`, target `V = 4`. Coin-outer.

```
init:    dp = [1, 0, 0, 0, 0]
coin 1:  dp[v]+=dp[v-1] for v=1..4
         dp = [1, 1, 1, 1, 1]          // {1^v} only
coin 2:  dp[2]+=dp[0]=1 -> 2
         dp[3]+=dp[1]=1 -> 2
         dp[4]+=dp[2]=2 -> 3
         dp = [1, 1, 2, 2, 3]
coin 3:  dp[3]+=dp[0]=1 -> 3
         dp[4]+=dp[1]=1 -> 4
         dp = [1, 1, 2, 3, 4]
```

`N(4) = 4`. The four multisets: `{1,1,1,1}`, `{1,1,2}`, `{2,2}`, `{1,3}`. Each is built exactly once and in non-decreasing coin order — e.g. `{1,3}` arises only when coin `3` adds to `dp[1]` (which already holds the single multiset `{1}`), never as `{3,1}`. This is Lemma 4.1's `f_i(v) = f_{i-1}(v) + f_i(v-c_i)` realized in place.

### 4.2 Why the Forward Sweep Is Essential Here

If the inner sweep ran **backward** (`v` from `V` down to `c`), then when updating `dp[v]` the cell `dp[v-c]` would still hold `f_{i-1}(v-c)` (the pre-coin value), not `f_i(v-c)`. The recurrence would become `dp[v] = f_{i-1}(v) + f_{i-1}(v-c)`, which counts multisets using coin `c` **at most once** — the 0/1 case. So the sweep direction is not cosmetic: forward realizes the unbounded recurrence `f_i(v) = f_{i-1}(v) + f_i(v-c_i)` (note the `f_i` on the right), backward realizes the 0/1 recurrence `f_i(v) = f_{i-1}(v) + f_{i-1}(v-c_i)`. This is the formal statement of the unbounded-vs-0/1 sweep rule used throughout the middle and senior files.

---

## 5. Why Amount-Outer Counts Permutations (Proof)

Define `g(v)` = number of **ordered sequences** `(b_1,…,b_m)` with `b_j ∈ C` and `Σ b_j = v` (compositions of `v` into coin parts).

**Lemma 5.1.** `g(0) = 1`, and for `v > 0`, `g(v) = Σ_{c ∈ C, c ≤ v} g(v - c)`.

**Proof.** Classify the ordered sequences summing to `v` by their **last** part `b_m = c`. Removing the last part gives an ordered sequence summing to `v - c`, a bijection with `{ sequences summing to v-c }`. Summing over the choices of last coin `c ≤ v` (these classes are disjoint, since the last part is determined) yields the recurrence. The empty sequence accounts for `g(0) = 1`. ∎

**Theorem 5.2 (Amount-outer correctness).** The amount-outer DP
```
dp[0]=1
for v in 1..V:               # OUTER
    for c in C:              # inner
        if c ≤ v: dp[v] += dp[v - c]
return dp[V]
```
computes `dp[V] = P(V) = g(V)`, the number of **permutations** (ordered sequences).

**Proof.** Induct on `v`. Base `dp[0] = 1 = g(0)`. For `v > 0`, by the time the outer loop reaches amount `v`, all smaller `dp[w] = g(w)` (`w < v`) are finalized (outer loop ascends `v`). The inner loop computes `dp[v] = Σ_{c ≤ v} dp[v-c] = Σ_{c ≤ v} g(v-c) = g(v)` by Lemma 5.1. Hence `dp[V] = g(V) = P(V)`. ∎

**Why the orders give different answers.** In coin-outer, the *coin* index is the outer parameter, so each multiset is assembled in one fixed coin order ⇒ unordered count `N`. In amount-outer, the *amount* is the outer parameter and every coin is reconsidered as a possible last part at every amount ⇒ ordered count `P`. The DP table indices are the same; the *summation order* changes the combinatorial object counted. Formally, coin-outer evaluates `[x^V] Π_i Σ_{a≥0} x^{a c_i}` (a product over coins ⇒ multisets), while amount-outer evaluates `[x^V] Σ_{m≥0} (Σ_i x^{c_i})^m = [x^V] 1/(1 - Σ_i x^{c_i})` (powers of a sum ⇒ sequences). The next section makes this generating-function statement precise.

### 5.1 Worked Permutations Trace

Coins `{1, 2}`, target `V = 4`. Amount-outer.

```
init:    dp = [1, 0, 0, 0, 0]
v=1:     dp[1]+=dp[0]=1            -> 1            (seq: 1)
v=2:     dp[2]+=dp[1]+dp[0]=1+1   -> 2            (seqs: 1+1, 2)
v=3:     dp[3]+=dp[2]+dp[1]=2+1   -> 3            (1+1+1, 1+2, 2+1)
v=4:     dp[4]+=dp[3]+dp[2]=3+2   -> 5            (1+1+1+1, 1+1+2, 1+2+1, 2+1+1, 2+2)
dp = [1, 1, 2, 3, 5]
```

`P(4) = 5`. Compare with the combination count `N(4)` for `{1,2}`: combinations are `{1,1,1,1}`, `{1,1,2}`, `{2,2}` = `3`. So `P(4) = 5 > 3 = N(4)`: the two extra are the reorderings `1+2+1` and `2+1+1` of the multiset `{1,1,2}`. The permutation sequence `1,1,2,3,5,…` is the Fibonacci sequence (offset), confirming Theorem 6.2's `G_P = 1/(1-x-x^2)` for `{1,2}`.

**Proposition 5.3 (`P ≥ N`).** For every coin set and every `V`, `P(V) ≥ N(V)`, because each multiset (counted once by `N`) corresponds to one or more orderings (counted by `P`), and the empty/singleton multisets coincide. Equality holds only when no multiset has two distinct elements available to reorder (degenerate sets). This inequality is a cheap runtime invariant for catching a swapped-loop bug.

---

### 5.2 The Boolean (Reachability) Specialization

Collapsing the counting semiring `(+, ×)` to the Boolean semiring `(OR, AND)` gives **reachability**: `reach_i(v) = reach_{i-1}(v) OR reach_i(v - c_i)`, with `reach(0) = true`. This is Theorem 4.2 with `+ → OR` and `0 → false`, `1 → true`. It answers "is `v` representable?" in `O(V·n)` without overflow (one bit per cell). Because `OR` is idempotent (like `min`), reachability is loop-order-insensitive — combinations and permutations agree on *existence*, differing only on *count*. This is the same idempotency split as min-coins (Section 7.2), and it is why the reachability DP (tasks file, Task 5) can use either loop order safely while the counting DP cannot. The Frobenius/gcd analysis of Section 9 is the closed-form shortcut for this Boolean DP at large `V`.

## 6. Generating-Function View of Counting Change

The cleanest proof that coin-outer counts multisets is the generating function.

**Theorem 6.1 (Combination generating function).** The ordinary generating function for `N(V)` is

```
G_N(x) = Σ_{V≥0} N(V) x^V = Π_{i=1}^n  1/(1 - x^{c_i}) = Π_{i=1}^n ( 1 + x^{c_i} + x^{2c_i} + … ).
```

**Proof.** Expand each factor as a geometric series `Σ_{a_i ≥ 0} x^{a_i c_i}`, where exponent `a_i c_i` records using coin `c_i` exactly `a_i` times. The product over `i` ranges over all tuples `(a_1, …, a_n)`, contributing `x^{Σ a_i c_i}`. The coefficient of `x^V` therefore counts tuples with `Σ a_i c_i = V` — exactly the representations (multisets) of `V`. Hence `[x^V] G_N(x) = N(V)`. ∎

**Theorem 6.2 (Permutation generating function).** The ordinary generating function for `P(V)` is

```
G_P(x) = Σ_{V≥0} P(V) x^V = 1 / ( 1 - Σ_{i=1}^n x^{c_i} ).
```

**Proof.** A composition is an ordered sequence of parts each in `C`; the GF of a single part is `S(x) = Σ_i x^{c_i}`, and the GF of a sequence of `≥ 0` parts is `Σ_{m≥0} S(x)^m = 1/(1 - S(x))` (the sequence construction of analytic combinatorics). The coefficient of `x^V` counts ordered coin sequences summing to `V` = `P(V)`. ∎

**Corollary 6.3 (Combinations vs permutations, algebraically).** `G_N = Π_i 1/(1-x^{c_i})` (a *product over coins*, hence multisets, hence coin-outer) versus `G_P = 1/(1 - Σ_i x^{c_i})` (a *geometric series in the sum*, hence ordered sequences, hence amount-outer). The two DPs are the coefficient-extraction algorithms for these two distinct generating functions. This is the deepest explanation of the loop-order phenomenon: the loops *are* the GF.

**Corollary 6.4 (Rational GF ⇒ linear recurrence).** Both `G_N` and `G_P` are rational functions of `x` with polynomial denominators (`Π(1-x^{c_i})` has degree `Σ c_i`; `1 - Σ x^{c_i}` has degree `c_max`). A rational GF with denominator of degree `d` has coefficients obeying a constant-coefficient linear recurrence of order `≤ d`. Hence `N(V)` and `P(V)` each satisfy a fixed-order linear recurrence — which is why huge-`V` counts can be computed by matrix exponentiation / Kitamasa (senior file, and sibling `11-graphs/32-paths-fixed-length`).

**Proof of the product-vs-series split (multiset vs sequence construction).** In the symbolic method of analytic combinatorics, a **multiset** of atoms drawn from a class with GF `f(x)` (here, "use coin `c_i` some number of times") has GF given by the product over atom types `Π_i 1/(1 - x^{c_i})` — each factor is the multiset (`SEQ` of one atom type) GF `1/(1-x^{c_i})`. A **sequence** of atoms each chosen from the union `Σ_i x^{c_i}` has GF `1/(1 - Σ_i x^{c_i})` via the `SEQ` construction `SEQ(A) ↔ 1/(1 - A(x))`. These are *different* admissible constructions, and they produce the two GFs of Theorems 6.1 and 6.2. The combinatorial classes they enumerate — multisets vs sequences — are exactly combinations vs permutations. This is the rigorous version of "the loop order is the generating function". ∎

**Worked GF example.** Coins `{1, 2}`. `G_N(x) = 1/((1-x)(1-x²))`; its coefficients are `N(V) = ⌊V/2⌋ + 1` (number of `(a_1,a_2)` with `a_1 + 2a_2 = V`). For `V = 6`: `⌊6/2⌋+1 = 4`, matching `{6×1}, {4×1,1×2}, {2×1,2×2}, {3×2}`. Meanwhile `G_P(x) = 1/(1 - x - x²)` — the **Fibonacci** GF — so `P(V) = F_{V+1}`; `P(6) = F_7 = 13` ordered sequences. The same coins, two GFs, two counts: combinations `4`, permutations `13`.

### 6.1 Partial Fractions and the Closed Form for Two Coins

For `{1, 2}`, expand `G_N(x) = 1/((1-x)(1-x²)) = 1/((1-x)^2 (1+x))`. Partial fractions:

```
1/((1-x)^2 (1+x)) = A/(1-x)^2 + B/(1-x) + C/(1+x).
```

Solving, `A = 1/2`, `B = 1/4`, `C = 1/4`. Using `1/(1-x)^2 = Σ (V+1) x^V`, `1/(1-x) = Σ x^V`, `1/(1+x) = Σ (-1)^V x^V`:

```
N(V) = (V+1)/2 + 1/4 + (-1)^V / 4 = ⌊V/2⌋ + 1.
```

The degree-1 growth (`~ V/2`) is the `n-1 = 1` polynomial degree predicted by Section 10.1, and the `(-1)^V/4` term is the bounded periodic correction from the root of unity at `x = -1` (the coin `2` contributes period 2). This is the analytic skeleton behind every closed form for fixed coin sets, and it generalizes: each distinct coin contributes its roots of unity as periodic corrections, while the pole at `x = 1` of order `n` produces the dominant degree-`(n-1)` polynomial.

### 6.2 The Two GFs Are Equal Only for One Coin

`G_N = Π_i 1/(1-x^{c_i})` and `G_P = 1/(1 - Σ_i x^{c_i})` coincide iff `n = 1` (a single denomination), where both equal `1/(1-x^{c_1})` — with one coin there is no ordering freedom, so combinations and permutations agree. For `n ≥ 2` the product and the geometric-in-the-sum diverge, and `P(V) > N(V)` for all `V` large enough to admit a mixed multiset. This is the algebraic counterpart of Proposition 5.3.

---

## 7. Bounded Change and Partition Generating Functions

**Theorem 7.1 (Bounded GF).** If coin `c_i` may be used at most `k_i` times, the number of bounded representations of `V` is

```
[x^V]  Π_{i=1}^n  ( 1 + x^{c_i} + x^{2 c_i} + … + x^{k_i c_i} )
     = [x^V]  Π_{i=1}^n  (1 - x^{(k_i + 1) c_i}) / (1 - x^{c_i}).
```

**Proof.** Each factor is the finite geometric series allowing `0..k_i` uses of `c_i`; its closed form is `(1 - x^{(k_i+1)c_i})/(1 - x^{c_i})`. The product's `x^V` coefficient counts bounded multisets exactly as in Theorem 6.1, with the per-coin truncation. ∎

**Corollary 7.2.** Multiplying these polynomials mod `x^{V+1}` is the bounded counting DP; each factor's contribution is one coin's inner loop, and the numerator `(1 - x^{(k_i+1)c_i})` is an inclusion-exclusion subtraction that removes representations using `c_i` more than `k_i` times. This is the algebraic justification for the binary-splitting / 0-1 reduction of the middle file: the truncated factor is realized by a finite set of 0/1 items.

**Connection to integer partitions.** When all `c_i = i` (coins `1,2,…,n`), `N(V)` is the number of partitions of `V` into parts `≤ n`; with all positive integers allowed it is the partition function `p(V)`, whose GF is Euler's `Π_{i≥1} 1/(1-x^i)`. Coin change is thus a finite-alphabet specialization of integer partitions, tying it to a deep area of number theory (Hardy-Ramanujan asymptotics for `p(V)`).

### 7.1 Worked Bounded-GF Example

Coins `{1, 2}` with supply limits `k_1 = 3` (at most three 1s) and `k_2 = 2` (at most two 2s). Target `V = 4`. The bounded GF is

```
(1 + x + x^2 + x^3) · (1 + x^2 + x^4).
```

Expand and read `[x^4]`: the products giving `x^4` are `x^0·x^4` (zero 1s, two 2s = `{2,2}`), `x^2·x^2` (two 1s, one 2 = `{1,1,2}`), and `x^4·x^0` — but the first factor stops at `x^3`, so there is no `x^4` term there. Hence `[x^4] = 2`: the multisets `{2,2}` and `{1,1,2}`. Note the *unbounded* count `N(4)` for `{1,2}` is `3` (it also allows `{1,1,1,1}`), but the bound `k_1 = 3` forbids four 1s, removing exactly that one multiset. The numerator-truncation `(1 - x^{(k_1+1)·1}) = (1 - x^4)` is precisely the inclusion-exclusion term that subtracts the over-using-coin-1 representations.

### 7.2 Idempotency and Why Min Saturates but Count Grows

The min-coins combine operator `min` is **idempotent** (`min(a,a) = a`); the count operator `+` is not (`a + a = 2a`). This single algebraic fact explains a structural difference: re-relaxing a min cell cannot change it, so the min DP is order-insensitive and "saturates" (each cell reaches its final value and stays). The count DP, using non-idempotent `+`, accumulates — which is why the *order* of accumulation (loop order) determines whether you count multisets or sequences, and why counts grow (polynomially in `V`, Section 10.1) rather than stabilize. The same idempotency contrast appears across DP: idempotent combine ⇒ order-free optimization; additive combine ⇒ order-sensitive counting.

---

## 8. Canonical Coin Systems and Greedy Optimality (Pearson)

**Definition 8.1 (Canonical system).** A coin system `C` (with `c_1 = 1`) is **canonical** if for every `V`, the greedy representation `greedy(V)` (repeatedly subtract the largest `c_i ≤` remainder) has cardinality equal to `M(V)`. Otherwise `C` is **non-canonical** and the smallest `V` where greedy is suboptimal is the **smallest counterexample** (the *order* of non-canonicity).

**Proposition 8.2 (Greedy can fail).** `C = {1, 3, 4}` is non-canonical with smallest counterexample `V = 6`: `greedy(6) = 4 + 1 + 1` (3 coins) but `M(6) = 3 + 3 = 2`.

**Proof.** Greedy at `6` takes `4` (largest ≤ 6), leaving `2`, then `1+1`, total 3. The representation `3+3` has cardinality 2 ≤ all others, and no single coin equals 6, so `M(6) = 2 < 3`. For all `V < 6` one checks greedy is optimal (e.g. `M(5)=greedy(5)=2` via `4+1`), so `6` is the smallest counterexample. ∎

**Theorem 8.3 (Pearson, 2005 — testing canonicity).** Whether a system `C = {1, c_2, …, c_n}` is canonical can be decided in polynomial time. The smallest counterexample, if it exists, lies in the bounded range `(c_3, c_{n-1} + c_n)`; testing each candidate `w` in that window by comparing `greedy(w)` against the DP value `M(w)` decides canonicity. The total cost is `O(n^3)` (Pearson) — independent of the magnitudes of the coins.

**Proof idea.** Pearson shows that if greedy is non-optimal anywhere, it is non-optimal at some `w` with `c_{r-1} + 1 ≤ w ≤ c_{r-1} + c_r` for some `r`, where the greedy and optimal representations first diverge in their use of the two largest relevant coins. The structure of greedy bounds where the first divergence can occur, collapsing an a priori infinite search into a finite window of size `O(c_n)` candidates, each tested with a local computation. The cubic bound comes from the number of candidate "break points" and the per-candidate work. (Full proof: Pearson, *A polynomial-time algorithm for the change-making problem*, Operations Research Letters 33 (2005).) ∎

**Sufficient structural conditions.** Certain regular patterns are provably canonical: e.g. systems where each `c_{i+1}` is a multiple of `c_i` (so greedy reduces digit-by-digit, like base-`b` representation) are canonical. The standard `{1,5,10,25}` is canonical (verifiable by Theorem 8.3). The decade `1-2-5` pattern is canonical. These are why real currencies are greedy-friendly — a deliberate design choice, not luck.

**Proof that divisor-chain systems are canonical.** Suppose `c_1 = 1` and `c_i | c_{i+1}` for all `i` (each coin divides the next). Greedy at amount `V` takes `⌊V / c_n⌋` of the largest coin, then recurses on `V mod c_n`. Claim: this is optimal. Consider any optimal representation; if it used fewer than `⌊V/c_n⌋` of `c_n`, it must cover the deficit with smaller coins. But since `c_n` is a multiple of every smaller coin, any group of smaller coins summing to `c_n` has cardinality `≥ c_n / c_{n-1} ≥ 2`, so replacing such a group by one `c_n` never increases the count — an exchange argument shows greedy's choice of the maximum number of largest coins is optimal. Recursing on the remainder (a smaller divisor-chain instance) completes the induction. Hence divisor-chain systems are canonical. ∎ (Binary `{1,2,4,8,…}` and `{1,10,100,…}` are instances; note `{1,5,10,25}` is *not* a pure divisor chain — `10 ∤ 25` — yet is still canonical, which is why the general Theorem 8.3 test is needed beyond this sufficient condition.)

### 8.1 Worked Canonicity Window Check

For `{1, 4, 6}` (sorted), the Pearson window upper bound is `c_{n-1} + c_n = 4 + 6 = 10`. Check each `V` in the relevant range:

```
V :  greedy        cnt   DP(min)   match?
8 :  6+1+1         3     4+4 = 2   NO  <-- first counterexample
```

So `{1,4,6}` is non-canonical with smallest counterexample `8` (greedy `6+1+1` = 3, optimal `4+4` = 2). The window bound guarantees we never need to test beyond `V = 10`, turning an a-priori-infinite verification into ten comparisons.

**Corollary 8.4.** For an arbitrary user-supplied system you must either run Theorem 8.3's test or use the DP; you may not assume canonicity. Adding one denomination can flip a canonical system to non-canonical, so the verdict must be recomputed on any change.

---

## 9. The Frobenius Number and Reachability

When `c_1 ≠ 1`, not all amounts are representable. Reachability is a number-theoretic question.

**Theorem 9.1 (gcd reachability).** `V` is representable by `C` (in non-negative integers) only if `gcd(C) | V`. Conversely, for sufficiently large `V` divisible by `gcd(C)`, `V` is representable.

**Proof.** Necessity: every representation `Σ a_i c_i` is a multiple of `g = gcd(C)`. Sufficiency for large `V`: by the structure of numerical semigroups, the set of representable amounts (after dividing by `g`, making the coins coprime) is cofinite — all integers beyond the Frobenius number are representable. ∎

**Definition 9.2 (Frobenius number).** For coprime `C`, the **Frobenius number** `g(C)` is the largest integer **not** representable. For two coprime coins `a, b`, the Chicken McNugget theorem gives `g(a,b) = ab - a - b`, and exactly `(a-1)(b-1)/2` amounts are non-representable.

**Consequence.** For large `V`, reachability is decided in `O(1)` by a gcd check plus comparison to the Frobenius threshold — no `dp[]` array needed (senior file Section 2.3). The exact Frobenius number for `n ≥ 3` coins has no simple closed form and is NP-hard to compute in general, but the gcd necessary condition is always cheap.

### 9.1 Worked Frobenius Example

Coins `{3, 5}` (coprime). The Chicken McNugget theorem gives Frobenius number `g(3,5) = 3·5 - 3 - 5 = 7`, and `(3-1)(5-1)/2 = 4` non-representable amounts. Enumerate small amounts:

```
0  YES (empty)      4  NO              8  YES (3+5)
1  NO               5  YES (5)         9  YES (3+3+3)
2  NO               6  YES (3+3)      10  YES (5+5)
3  YES (3)          7  NO  <- largest non-representable
```

The non-representable set is `{1, 2, 4, 7}` — exactly `4` elements, and the largest is `7 = g(3,5)`. Every amount `≥ 8` is representable, so a reachability query for, say, `V = 10^9` is answered `YES` in `O(1)` (it exceeds `7` and `gcd(3,5) = 1 | 10^9`) with no DP table. This is the structural fact that rescues the large-`V` reachability case from the pseudo-polynomial trap.

### 9.2 The General `n`-Coin Picture

For `n ≥ 3` coins, no closed form for `g(C)` is known, and deciding it is NP-hard. However, two facts remain cheap and useful: (a) the gcd necessary condition `gcd(C) | V` rules out vast swathes of `V` in `O(n)`; and (b) once `V` exceeds `g(C)` (even an upper bound such as the two-coin formula on the two smallest coprime coins), representability is guaranteed. Production reachability checks combine the cheap gcd filter with a modest DP up to a safe threshold, never a full `O(V)` table for astronomically large `V`.

---

## 10. Complexity, Pseudo-Polynomiality, and Hardness

**Theorem 10.1 (DP complexity).** The min-coins and counting DPs run in `O(V · n)` time and `O(V)` space.

**Proof.** Two nested loops: the outer over `n` coins (or `V` amounts), the inner over `O(V)` amounts (or `n` coins), each iteration `O(1)`. The array is length `V + 1`. ∎

**Theorem 10.2 (Pseudo-polynomiality).** This is **not** polynomial in the input size. The input `(C, V)` has size `Θ(n log c_max + log V)` bits; `V` can be `2^{Θ(input size)}`, so `O(V·n)` is exponential in the input length.

**Theorem 10.3 (NP-hardness of the optimization decision).** The **Change-Making Problem** decision version — "is `M(V) ≤ t`?" — is **NP-complete** for arbitrary coin systems (Lueker 1975), reducing from problems like subset-sum-style number problems. Hence no truly polynomial (in `log V`) algorithm is expected for min-coins on arbitrary systems; the pseudo-polynomial DP is the standard tractable method when `V` is moderate.

**Exactness without floating point.** A subtle but important correctness property: the counting DP is purely integer-additive and the min DP is purely integer-`min`/`+1`, so neither ever introduces floating-point error — unlike, say, the eigenvalue/Binet closed forms (Section 6.1) which involve irrational roots of the denominator. To compute `N(V)` exactly you must stay in integer (or modular-integer) arithmetic; evaluating the partial-fraction closed form in `double` would accumulate rounding and fail to give an exact integer for large `V`. This mirrors the "eigenvalues for asymptotics, integer arithmetic for exact counts" doctrine of `11-graphs/32-paths-fixed-length`: closed forms diagnose growth (`V^{n-1}`), but exactness demands the integer DP or modular matrix exponentiation.

**Proof sketch (hardness).** The change-making decision problem is shown NP-hard via reduction; the DP's pseudo-polynomial time does not contradict this because pseudo-polynomial ≠ polynomial. The problem is only weakly NP-hard (the DP solves it in pseudo-poly time), placing it alongside knapsack and subset-sum. ∎

**Corollary 10.4 (Counting hardness).** Exact counting `N(V)` is at least as hard; computing it is #P-style hard for arbitrary systems in the strong sense, and the counts themselves have `Θ(n log V)` bits, so even writing the answer is large for huge `V`.

**The weak vs strong distinction.** Coin change is *weakly* NP-hard: the pseudo-polynomial DP solves it in time polynomial in `V` (the magnitude), so it is tractable whenever `V` is "small" in value even if "large" in bit-length. A *strongly* NP-hard problem would resist pseudo-polynomial algorithms (no DP polynomial in the numeric magnitude exists unless P=NP). The existence of the `O(V·n)` DP places coin change firmly in the weak class alongside subset-sum, 0/1 knapsack, and partition. The practical upshot: the difficulty is entirely about the *value* of `V`, which is why every scaling discussion (senior file) revolves around bounding or structurally side-stepping `V`.

**Summary table.**

| Task | Complexity | Notes |
|------|-----------|-------|
| Min-coins, DP | `O(V·n)` pseudo-poly | weakly NP-hard decision (Lueker) |
| Count combinations, DP | `O(V·n)` pseudo-poly | rational GF ⇒ recurrence for huge `V` |
| Count permutations, DP | `O(V·n)` pseudo-poly | Fibonacci-like for small coin sets |
| Greedy min-coins | `O(n log n)` | correct only on canonical systems |
| Canonicity test (Pearson) | `O(n^3)` | independent of `V` |
| Reachability (gcd / Frobenius) | `O(n)` to `NP`-hard | gcd cheap; exact Frobenius hard for `n≥3` |

### 10.1 Asymptotic Magnitude of the Counts

For a fixed coin set of size `n`, the combination count grows polynomially in `V`. Concretely, by partial-fraction analysis of `G_N(x) = Π_i 1/(1-x^{c_i})`, the highest-order pole is at `x = 1` with multiplicity `n` (each factor contributes a `(1-x)` once after extracting roots of unity), giving

```
N(V) ~ V^{n-1} / ( (n-1)! · Π_i c_i )    as V → ∞.
```

So `N(V)` is a quasi-polynomial of degree `n-1` in `V`. This estimate matters in practice for two reasons: (a) it tells you how many bits the exact count needs (`~ (n-1) log₂ V`), hence how many CRT primes to use; and (b) it gives a magnitude sanity check — if your computed count is not growing like `V^{n-1}`, you likely have a bug. For `{1,2}` (`n=2`), `N(V) ~ V/2`, matching the exact `⌊V/2⌋+1`.

### 10.2 The Decision-Problem Reduction (sketch)

Lueker's NP-hardness reduction encodes a number-theoretic constraint-satisfaction instance into denominations so that a small-cardinality representation exists iff the instance is satisfiable. The key is that arbitrary denominations can force "exact cover"-like interactions absent from canonical (regular) systems. Because the reduction uses denominations whose *values* are exponential in the instance size, the pseudo-polynomial DP does not break the hardness: `O(V·n)` is exponential in those bit-lengths. This is the same phenomenon as subset-sum and 0/1 knapsack — *weakly* NP-hard problems that admit pseudo-polynomial DPs.

---

## 11. Link to Unbounded Knapsack and Linear Recurrences

**Proposition 11.1 (Coin change = unbounded knapsack).** Min-coins is unbounded knapsack with item weight `c_i`, item value `−1` (maximize negative value = minimize count), and target capacity exactly `V`. Counting combinations is the unbounded-knapsack *counting* variant. The forward-sweep, coin-outer DP is identical; the sweep-direction rule (forward = unbounded reuse, backward = 0/1) is shared verbatim with sibling `02-knapsack`.

**Proof.** Map each coin `c_i` to an item of weight `c_i`. A subset-with-repetition of items hitting total weight `V` is a coin representation. Minimizing item count = min-coins; counting multisets = `N(V)`. The recurrences coincide. ∎

**Corollary 11.1b (Family of siblings).** The forward-sweep coin-outer DP is the common ancestor of a whole family: **rod cutting** (`21-rod-cutting`) is unbounded knapsack maximizing value (lengths = weights, prices = values); **subset-sum / partition** (`22-subset-sum-partition`) is 0/1 feasibility (backward sweep, Boolean combine); **word break** (`23-word-break`) is reachability counting over a dictionary (amount-outer Boolean/count over string positions). Recognizing coin change as the prototype lets you transfer the loop-order and sweep-direction discipline to all of them: combinations vs permutations, unbounded vs 0/1, min vs count vs feasibility are independent axes, and each sibling fixes a different point in that cube.

**Proposition 11.2 (Linear-recurrence structure).** By Corollary 6.4, for a fixed coin set `N(V)` obeys a linear recurrence of order `≤ Σ c_i` (and `P(V)` of order `≤ c_max`). The companion matrix of this recurrence, raised to the `V`-th power by binary exponentiation, computes the count for astronomically large `V` in `O(d^3 log V)` (or `O(d^2 log V)` via Kitamasa), where `d` is the recurrence order. This is exactly the matrix-exponentiation-on-graphs machinery of `11-graphs/32-paths-fixed-length`: the count is a weighted walk count on the recurrence's state graph.

**Proof.** A rational GF `P(x)/Q(x)` with `deg Q = d` has coefficients satisfying `Σ_{j=0}^{d} q_j a_{V-j} = 0` for `V > deg P`, a linear recurrence read off `Q`'s coefficients. Encoding the `d` most recent terms as a state vector and the recurrence as the companion matrix `T`, `a_V` is the appropriate entry of `T^{V} · (initial state)`, computed by fast matrix power. ∎

This closes the loop: the same algebra that proves coin-outer counts combinations (the product GF) also proves that the counts satisfy a linear recurrence, which is what makes huge-`V` counting tractable for fixed small coin sets.

### 11.1 Worked Recurrence Derivation

Take `{1, 2}` permutation count `P(V)` with `G_P = 1/(1 - x - x^2)`. The denominator `Q(x) = 1 - x - x^2` directly yields the recurrence: clearing `(1 - x - x^2) Σ P(V) x^V = 1` gives, for `V ≥ 2`,

```
P(V) - P(V-1) - P(V-2) = 0   ⇒   P(V) = P(V-1) + P(V-2),
```

with `P(0) = 1, P(1) = 1` — the Fibonacci recurrence. The companion matrix is `T = [[1,1],[1,0]]`, and `P(V)` is read off `T^V` (sibling `11-graphs/32-paths-fixed-length`). For the *combination* count `G_N = 1/((1-x)(1-x^2))`, the denominator `(1-x)(1-x^2) = 1 - x - x^2 + x^3` gives the order-3 recurrence `N(V) = N(V-1) + N(V-2) - N(V-3)` for `V ≥ 3`, with `N(0)=1, N(1)=1, N(2)=2`. Both recurrences are read mechanically off the GF denominator — the bridge from coin change to fast `O(d^3 log V)` evaluation for astronomically large `V`.

### 11.2 When the Recurrence Route Beats the Table

| Regime | Best method | Cost |
|--------|-------------|------|
| Moderate `V`, any coins | ordinary `O(V·n)` DP | pseudo-poly |
| Huge `V`, small fixed coin set, full count | companion-matrix power | `O(d^3 log V)` |
| Huge `V`, small fixed coin set, one residue | Kitamasa on the recurrence | `O(d^2 log V)` |
| Huge `V`, only reachability | gcd + Frobenius threshold | `O(n)` |

The recurrence order `d ≤ Σ c_i` (combinations) or `d ≤ c_max` (permutations) must be small for the matrix route to pay off; for large coin values the denominator degree explodes and the ordinary DP (when `V` permits) or a different decomposition is preferable.

### 11.3 End-to-End Worked Example: `{1,2}`, all four quantities

To see every thread tied together, fix coins `{1,2}` and compute the four characterized quantities for `V = 0..6`:

```
V        :  0   1   2   3   4   5   6
M(V) min :  0   1   1   2   2   3   3        (⌈V/2⌉ for V≥1: greedy-canonical)
N(V) comb:  1   1   2   2   3   3   4        (⌊V/2⌋+1)
P(V) perm:  1   1   2   3   5   8  13        (Fibonacci F_{V+1})
reachable:  Y   Y   Y   Y   Y   Y   Y        (1 ∈ C ⇒ all reachable)
```

Cross-checks against the theory:
- `M(V)` matches greedy because `{1,2}` is a divisor chain (`1 | 2`), hence canonical (Section 8 proof).
- `N(V) = ⌊V/2⌋+1` matches the partial-fraction closed form (Section 6.1) and the order-3 recurrence `N(V)=N(V-1)+N(V-2)-N(V-3)` (Section 11.1): `4 = 3 + 2 - 1`. ✓
- `P(V) = F_{V+1}` matches `G_P = 1/(1-x-x^2)` and the Fibonacci recurrence (Section 11.1): `13 = 8 + 5`. ✓
- `P(V) ≥ N(V)` everywhere (Proposition 5.3), with the gap widening as more reorderable multisets appear.
- All reachable since `c_1 = 1`, so the Frobenius number is `−1` (no non-representable positive amount).

This single table simultaneously exercises optimal substructure, the combinations/permutations GF split, the canonical-greedy proof, the closed-form/recurrence derivations, and the `P ≥ N` invariant — every major result of this document on one tiny instance.

### 11.4 A Caution on Generalizing the `{1,2}` Tidiness

`{1,2}` is unusually clean: it is a divisor chain (canonical), its combination count has a one-line floor formula, and its permutation count is Fibonacci. None of this survives for arbitrary coin sets. For `{1,3,4}` the system is *non-canonical* (Section 8), so `M(V)` is no longer `⌈V/c_max⌉`-greedy; the combination count's GF `1/((1-x)(1-x^3)(1-x^4))` has denominator degree `8`, giving an order-≤8 recurrence with no tidy closed form; and the permutation count follows `1/(1-x-x^3-x^4)`. The lesson: the *structure* (rational GF ⇒ recurrence, product-vs-series ⇒ combinations-vs-permutations, idempotency ⇒ order-freeness of min) is universal, but the *closed forms* are artifacts of small, regular coin sets. Engineers should rely on the structural theorems, not on pattern-matching tidy formulas that fail to generalize.

---

## 12. Summary

- **Optimal substructure** (Theorem 2.1) gives the Bellman recurrence `M(V) = 1 + min_{c≤V} M(V-c)`, and the bottom-up DP is correct (Theorem 3.1). The **min** variant is loop-order *insensitive* because `min` is idempotent.
- **Coin-outer counts combinations** (Theorem 4.2): processing each coin to completion builds every multiset in one canonical (non-decreasing) order, counting it once. The proof is the layered recurrence `f_i(v) = f_{i-1}(v) + f_i(v-c_i)` realized by the forward sweep.
- **Amount-outer counts permutations** (Theorem 5.2): reconsidering every coin as the *last* part at each amount counts ordered sequences `g(v) = Σ_c g(v-c)`.
- **Generating functions** make the distinction algebraic: `G_N = Π_i 1/(1-x^{c_i})` (product over coins ⇒ multisets) vs `G_P = 1/(1 - Σ_i x^{c_i})` (geometric series in the sum ⇒ sequences). Bounded change truncates each factor to `(1 - x^{(k_i+1)c_i})/(1-x^{c_i})`.
- Both GFs are **rational**, so the counts satisfy fixed-order **linear recurrences** (Corollary 6.4), computable for huge `V` by matrix exponentiation / Kitamasa — linking to `11-graphs/32-paths-fixed-length`.
- A coin system is **canonical** iff greedy is optimal for every amount; `{1,3,4}` fails at `6`. **Pearson's** `O(n^3)` test decides canonicity by checking a bounded window (Theorem 8.3) — no infinite search.
- **Reachability** is governed by `gcd(C)` and the **Frobenius number** (`ab-a-b` for two coprime coins); large reachable `V` need no table.
- The DP is **pseudo-polynomial** (`O(V·n)`, exponential in input bits); the optimization decision is **weakly NP-complete** (Lueker 1975), placing coin change with knapsack and subset-sum.
- Coin change **is** unbounded knapsack (Proposition 11.1); the forward/backward sweep rule for unbounded/0-1 is shared with `02-knapsack`, and the same prototype generalizes to rod cutting, subset-sum/partition, and word break (Corollary 11.1b).
- **Reconstruction** of the optimal multiset (Proposition 3.4) is the repeated application of the cut-and-paste decomposition, walked back through a `parent[]` array — correct, not heuristic.
- **Idempotency** (`min`, `OR`) ⇒ order-free optimization/feasibility; **additivity** (`+`) ⇒ order-sensitive counting. This one algebraic axis explains why min and reachability are loop-order-free while combination/permutation counts differ (Sections 5.2, 7.2).
- **Exact counts demand integer arithmetic** (Section 10); closed forms from partial fractions diagnose growth (`V^{n-1}`) but cannot be evaluated in floating point for exactness — the same doctrine as `11-graphs/32-paths-fixed-length`.

### Complexity Cheat Table

| Task | Method | Complexity | Tight? |
|------|--------|-----------|--------|
| Min coins, arbitrary system | bottom-up DP | `O(V·n)` pseudo-poly | decision weakly NP-complete |
| Count combinations | coin-outer DP | `O(V·n)` pseudo-poly | — |
| Count permutations | amount-outer DP | `O(V·n)` pseudo-poly | — |
| Min coins, canonical system | greedy | `O(n log n)` | optimal once canonical |
| Canonicity verdict | Pearson window test | `O(n^3)` | independent of `V` |
| Count for huge `V`, small coins | companion-matrix power | `O(d^3 log V)` | `d ≤ Σ c_i` |
| Reachability for huge `V` | gcd + Frobenius | `O(n)` | exact Frobenius NP-hard, `n≥3` |
| Bounded count | GF product / binary-split 0-1 | `O(V·Σ log k_i)` | — |

### Closing Notes

- **Two recurrences, one substructure.** Min (`min`, idempotent ⇒ loop-order-free) and count (`+`, non-idempotent ⇒ loop-order-sensitive) share the optimal-substructure decomposition but differ precisely because of the algebra of their combine operator.
- **The loop order is the generating function.** Coin-outer *is* `Π_i 1/(1-x^{c_i})` (multisets); amount-outer *is* `1/(1-Σ x^{c_i})` (sequences). This is the deepest, most memorable explanation of the combinations-vs-permutations phenomenon.
- **The sweep direction is the multiplicity rule.** Forward sweep realizes `f_i(v)=f_{i-1}(v)+f_i(v-c_i)` (unbounded reuse); backward realizes `f_i(v)=f_{i-1}(v)+f_{i-1}(v-c_i)` (0/1) — shared verbatim with `02-knapsack`.
- **Greedy is a correctness gamble off canonical systems.** `{1,3,4}` (fails at 6), `{1,4,6}` (fails at 8), `{1,7,10}` (fails at 14) are the standard witnesses; Pearson's bounded-window test settles canonicity finitely.
- **Pseudo-polynomial means bounded `V`.** Huge `V` is rescued only by structure (rational-GF recurrence + matrix power) or by the gcd/Frobenius reachability shortcut — never by a bigger `dp[]` array.

Foundational references: CLRS (DP, rod cutting), Lueker (1975) for NP-hardness of change-making, Pearson (2005) for the canonicity test, Flajolet-Sedgewick *Analytic Combinatorics* Ch. I/V (sequence and multiset constructions, rational GFs), Sylvester/Frobenius for the coin (Chicken McNugget) problem, and sibling topics `02-knapsack`, `21-rod-cutting`, `22-subset-sum-partition`, `11-graphs/32-paths-fixed-length`, and `19-number-theory/10-matrix-exponentiation`.
