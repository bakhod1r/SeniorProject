# Rod Cutting — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. Optimal Substructure (Proof)
3. Correctness of the Recurrence (Proof by Induction)
4. The First-Cut Decomposition and Why It Is Exhaustive
5. Complexity Analysis: O(n^2) and O(n·m)
6. Equivalence to Unbounded Knapsack
7. The Cost-Per-Cut Variant: Analysis
8. The Bounded Variant and Pseudo-Polynomiality
9. Reconstruction Correctness
10. Generating-Function and Counting Note
11. Relation to Coin Change
12. Summary

---

## 1. Formal Definitions

Let the rod length be `n ∈ ℕ` and let `price : {0, 1, …, n} → ℤ` be a price function with `price[0] = 0` (an empty piece earns nothing). Prices are typically non-negative integers but the analysis below needs only that they are real and finite.

**Definition 1.1 (Composition).** A **cutting plan** for a rod of length `len` is an ordered sequence of positive integers `(c_1, c_2, …, c_m)` with `Σ_{i=1}^m c_i = len`. Each `c_i` is a piece length; the sequence is a *composition* of `len`. The plan's **revenue** is `Σ_{i=1}^m price[c_i]`.

**Definition 1.2 (Optimal revenue).** Define

```
dp[len] = max over all cutting plans (c_1, …, c_m) of len of  Σ_i price[c_i],
dp[0]   = 0   (the empty plan, m = 0).
```

We will prove `dp` satisfies the recurrence `dp[len] = max_{1 ≤ c ≤ len} ( price[c] + dp[len - c] )`.

**Definition 1.3 (Number of plans).** The number of compositions of `len ≥ 1` is `2^{len-1}` (each of the `len - 1` internal gaps is independently cut or not). Brute force over all plans is therefore `Θ(2^n)`.

**Proof of the `2^{len-1}` count.** A length-`len` rod has `len - 1` *internal integer positions* where a cut may or may not be placed. Each subset of these positions yields a distinct composition (the cut positions partition the rod into consecutive integer-length pieces), and every composition arises from exactly one such subset. There are `2^{len-1}` subsets, hence `2^{len-1}` compositions. ∎ This combinatorial fact is *why* brute force is hopeless: the search space doubles with each added unit of length.

**Definition 1.3b (Restricted parts).** When only a subset `S ⊆ {1, …, n}` of lengths is *offered* (sellable), plans use only parts in `S`. The unrestricted case is `S = {1, …, n}`; restricting `S` to the `m` quoted lengths gives the `O(n·m)` algorithm (Section 5). All theorems below hold verbatim with `c` ranging over `S` instead of `{1, …, len}`, by interpreting `price[c] = -∞` for `c ∉ S`.

**Notation.** Throughout, `n` is the rod length, `m` the number of *distinct offered* lengths (for the restricted loop), `c` a first-cut length, and `dp[·]` the optimal-revenue function of Definition 1.2. The Iverson bracket `[P]` is `1` if `P` holds, else `0`. "Unbounded" means each piece length may appear any number of times in a plan; "bounded" caps the multiplicity. We write `P = max_ℓ price[ℓ]` for the largest price, used in magnitude bounds (Section 5.3), and `Λ` for a stock-rod length in the cutting-stock connection. The semiring symbols `⊕` (combine) and `⊗` (extend) appear in Sections 10–11 when unifying the optimization with its counting cousins.

**Remark.** The crux of the topic is that the exponentially many compositions (Definition 1.3) collapse to a polynomial DP because of *optimal substructure* (Section 2) — the same phenomenon that powers all of dynamic programming.

**Compositions vs partitions.** A *composition* is **ordered** (`1+2 ≠ 2+1`); a *partition* is **unordered** (`{1,2}`). Rod cutting's revenue is order-independent (a sum of part prices), so the optimum is the same whether we think in compositions or partitions — but the *recurrence* enumerates compositions (by first part), because that yields a clean strictly-smaller subproblem. The `2^{n-1}` count is the *composition* count; the partition count `p(n)` is sub-exponential but still super-polynomial, so neither admits brute force. Only the DP's reuse of subproblems makes the problem tractable, regardless of which combinatorial object we count.

---

## 2. Optimal Substructure (Proof)

**Theorem 2.1 (Optimal substructure).** Let `(c_1, …, c_m)` be an optimal cutting plan for a rod of length `len ≥ 1`, with first piece `c_1`. Then `(c_2, …, c_m)` is an optimal cutting plan for the rod of length `len - c_1`.

**Proof (cut-and-paste / exchange argument).** The plan's revenue is `price[c_1] + Σ_{i≥2} price[c_i]`, where `Σ_{i≥2} price[c_i]` is the revenue of the sub-plan `(c_2, …, c_m)` on a rod of length `len - c_1`. Suppose, for contradiction, that `(c_2, …, c_m)` is *not* optimal for `len - c_1`; then there is a plan `Q` for `len - c_1` with strictly greater revenue, `rev(Q) > Σ_{i≥2} price[c_i]`. Prepend the piece `c_1` to `Q` to obtain a valid plan for `len` (it sums to `c_1 + (len - c_1) = len`). Its revenue is `price[c_1] + rev(Q) > price[c_1] + Σ_{i≥2} price[c_i]` = the revenue of the original optimal plan — contradicting optimality of `(c_1, …, c_m)`. Hence `(c_2, …, c_m)` is optimal for `len - c_1`. ∎

**Interpretation.** Optimal substructure says the tail of an optimal plan is itself optimal, which is exactly what licenses writing `dp[len - c]` for the remainder. This is the property every DP needs; rod cutting is its canonical illustration.

**Corollary 2.2 (No overlap of decisions across first cuts).** Two distinct first cuts `c ≠ c'` decompose `len` into *different* subproblems `len - c ≠ len - c'`; the recurrence's `max` over `c` therefore ranges over genuinely distinct sub-decisions, and selecting the best does not double-count any plan because each plan has a unique first piece.

### 2.1 The Two CLRS Criteria, Verified

CLRS frames dynamic programming as requiring two properties, both of which rod cutting exhibits:

1. **Optimal substructure** — proved above (Theorem 2.1): an optimal solution is built from optimal solutions to subproblems.
2. **Overlapping subproblems** — the *same* subproblem `dp[r]` is needed by many larger lengths. For example, `dp[2]` is consulted when computing `dp[3]` (via `c = 1`), `dp[4]` (via `c = 2`), `dp[5]` (via `c = 3`), and so on. A naive recursion would recompute `dp[2]` an exponential number of times; memoization or tabulation computes it **once**. There are exactly `n + 1` distinct subproblems `dp[0..n]`, which is why the DP is polynomial.

The contrast with divide-and-conquer is instructive: merge sort's subproblems are *disjoint* (the two halves never share work), so there is nothing to memoize and no DP speedup to gain. Rod cutting's subproblems *overlap heavily*, which is precisely the regime where caching pays off.

### 2.2 A Subtlety: Substructure Holds for *Any* Designated Piece

The exchange argument in Theorem 2.1 was stated for the leftmost piece, but it holds for *any* designated piece by symmetry of composition revenue (revenue is the sum of part prices, which is order-independent). We single out the *first* piece only because it yields the cleanest strictly-smaller subproblem (`len - c`) and a unique decomposition (Proposition 4.1). Choosing the *last* piece, or the *largest* piece, would also give a valid recurrence, but the bookkeeping (avoiding double counting) is messier. The first-piece convention is a modeling choice, not a mathematical necessity.

---

## 3. Correctness of the Recurrence (Proof by Induction)

**Theorem 3.1.** For all `len ≥ 0`,

```
dp[len] = max_{1 ≤ c ≤ len} ( price[c] + dp[len - c] ),   with dp[0] = 0,
```

where `dp` is the optimal revenue of Definition 1.2 (and the `max` over an empty range, at `len = 0`, is taken to be `0`).

**Proof (induction on `len`).**

*Base case `len = 0`.* The only plan is the empty plan with revenue `0`; `dp[0] = 0` by definition. ✓

*Inductive step.* Assume the formula holds for all lengths `< len`, in particular that `dp[len - c]` equals the optimal revenue for `len - c` for every `1 ≤ c ≤ len`.

(≥) For any fixed first cut `c`, take the optimal plan for `len - c` (revenue `dp[len - c]` by hypothesis) and prepend a piece of length `c`. This is a valid plan for `len` with revenue `price[c] + dp[len - c]`. Since `dp[len]` is the max over *all* plans, `dp[len] ≥ price[c] + dp[len - c]` for every `c`, hence `dp[len] ≥ max_c ( price[c] + dp[len - c] )`.

(≤) Conversely, let `(c_1, …, c_m)` be an optimal plan for `len` (so its revenue is `dp[len]`). It has a first piece `c_1` with `1 ≤ c_1 ≤ len`. By Theorem 2.1 the tail is optimal for `len - c_1`, so its revenue is `dp[len - c_1]`, giving `dp[len] = price[c_1] + dp[len - c_1] ≤ max_c ( price[c] + dp[len - c] )`.

Combining (≥) and (≤), `dp[len] = max_c ( price[c] + dp[len - c] )`. By induction the formula holds for all `len ≥ 0`. ∎

**Remark (why both inequalities are needed).** (≥) shows the recurrence's right-hand side is *achievable* (no overcount); (≤) shows it is an *upper bound* (no undercount, via optimal substructure). Together they pin `dp[len]` exactly. Skipping (≤) is the subtle gap that lets a buggy "try only some cuts" heuristic look plausible while being wrong.

### 3.1 Worked Inductive Trace

Take `price = [_, 1, 5, 8, 9]` and verify the induction explicitly for `len = 1..4`.

```
dp[0] = 0                                              (base)
dp[1] = price[1] + dp[0] = 1 + 0 = 1                   (only c=1)
dp[2] = max( price[1]+dp[1], price[2]+dp[0] )
      = max( 1+1, 5+0 ) = 5                            (c=2 wins)
dp[3] = max( price[1]+dp[2], price[2]+dp[1], price[3]+dp[0] )
      = max( 1+5, 5+1, 8+0 ) = 8                       (c=3 wins)
dp[4] = max( price[1]+dp[3], price[2]+dp[2], price[3]+dp[1], price[4]+dp[0] )
      = max( 1+8, 5+5, 8+1, 9+0 ) = 10                 (c=2 wins)
```

Each `dp[len]` is computed strictly from earlier entries (the inductive hypothesis), and the maximum over first cuts realizes both inequalities of Theorem 3.1: the chosen `c` achieves the bound (≥), and no other `c` exceeds it (≤). The optimum `dp[4] = 10` (two length-2 pieces) is reached by a value that *recombines* two previously optimal subproblems (`dp[2] + dp[2]`), illustrating overlapping subproblems in action.

**Counter-check against brute force.** Enumerating all `2^3 = 8` compositions of `4` and summing prices gives revenues `{9 (whole), 9 (1+3), 10 (2+2), 6 (1+1+2 perms), 4 (1+1+1+1), …}`; the maximum is `10`, matching `dp[4]`. The DP examined `1 + 2 + 3 + 4 = 10` candidate additions instead of enumerating all 8 compositions — a small saving here, but the gap is `Θ(n^2)` vs `Θ(2^n)` asymptotically.

---

## 4. The First-Cut Decomposition and Why It Is Exhaustive

The recurrence enumerates plans by their *first piece*. We make the bijection explicit.

**Proposition 4.1.** For `len ≥ 1`, the set of cutting plans of `len` is in bijection with the disjoint union over `c ∈ {1, …, len}` of `{c} × {plans of len - c}`:

```
{plans of len}  ≅  ⊎_{c=1}^{len}  ( {c} × {plans of len - c} ).
```

**Proof.** A plan `(c_1, …, c_m)` maps to `(c_1, (c_2, …, c_m))`, with `c_1` its first piece and `(c_2, …, c_m)` a plan of `len - c_1`. This map is a bijection: it is injective because the first piece and the tail are recovered uniquely from the plan, and surjective because for any `c` and any plan `Q` of `len - c`, prepending `c` to `Q` yields a plan of `len` mapping back to `(c, Q)`. The union is disjoint because the first piece `c` is determined by the plan, so no plan lies in two summands. ∎

**Consequence.** Maximizing revenue over `{plans of len}` equals maximizing over the disjoint union, i.e. `max_c ( price[c] + max_{plans Q of len-c} rev(Q) ) = max_c ( price[c] + dp[len - c] )`. The decomposition is *exhaustive* (every plan appears) and *non-redundant* (each plan appears once), which is exactly why trying only first cuts suffices — there is no need to consider cutting "in the middle," because a middle cut is just the first cut of some recursively handled remainder.

### 4.1 Worked Bijection Example

For `len = 3`, the `2^2 = 4` compositions and their first-piece decomposition:

```
(1,1,1)  ->  first piece 1, tail (1,1) of length 2
(1,2)    ->  first piece 1, tail (2)   of length 2
(2,1)    ->  first piece 2, tail (1)   of length 1
(3)      ->  first piece 3, tail ()    of length 0
```

Grouping by first piece `c`: `c=1` covers `{(1,1),(2)}` (the 2 compositions of `len-1=2`), `c=2` covers `{(1)}` (the 1 composition of `len-2=1`), `c=3` covers `{()}` (the 1 composition of `len-3=0`). The counts `2 + 1 + 1 = 4` match `2^{len-1} = 2^2 = 4` (Definition 1.3), and every composition lands in exactly one group — the disjoint-union bijection of Proposition 4.1 made concrete. The optimization simply picks the best group rather than counting all.

### 4.2 Why Greedy by Price Density Fails

A tempting heuristic: repeatedly cut the length `ℓ` maximizing *price density* `price[ℓ]/ℓ`. This is **not** optimal in general. Counterexample with `price = [_, 1, 5, 8, 9]`, `n = 4`: densities are `1/1=1, 5/2=2.5, 8/3≈2.67, 9/4=2.25`, so density-greedy picks length `3` first (revenue 8), leaving length `1` (revenue 1), total `9`. But the DP optimum is `2 + 2 = 10`. Greedy fails because the highest-density piece (`3`) leaves an *awkward remainder* (`1`) that cannot be used well; the DP, by contrast, evaluates the remainder's true optimal value `dp[len - c]` rather than a myopic density estimate. This is the structural reason rod cutting needs DP, not greedy: the value of a cut depends on the *optimally solved* remainder, a global quantity greedy ignores. (Greedy *is* optimal for special tables — e.g. when one length strictly dominates in density and divides `n` — but never assume it without proof; verify against the DP, Task 15 in [`tasks.md`](./tasks.md).)

---

## 5. Complexity Analysis: O(n^2) and O(n·m)

**Theorem 5.1 (Dense complexity).** The bottom-up evaluation of Theorem 3.1 over all cut lengths runs in `Θ(n^2)` time and `Θ(n)` space.

**Proof.** The outer loop runs for `len = 1, …, n`. For each `len`, the inner loop tries `c = 1, …, len`, i.e. `len` iterations of `O(1)` work (an add, a compare, a possible store). Total work is `Σ_{len=1}^n len = n(n+1)/2 = Θ(n^2)`. Space is one `dp[0..n]` array (and an optional `choice[0..n]`), `Θ(n)`. ∎

**Theorem 5.2 (Sparse / offered-lengths complexity).** If only `m` distinct lengths are offered, restricting the inner loop to those lengths runs in `Θ(n·m)` time, `Θ(n)` space.

**Proof.** The outer loop is `n` iterations; the inner loop is `m` iterations of `O(1)` work. Total `Θ(n·m)`. ∎

**Comparison to brute force.** Brute force enumerates all `Θ(2^n)` compositions (Definition 1.3). The DP's polynomial cost is the payoff of optimal substructure plus *overlapping subproblems*: the value `dp[len - c]` is reused across many larger lengths, so each of the `n + 1` distinct subproblems is solved once rather than re-derived exponentially often. This pair — optimal substructure (Section 2) and overlapping subproblems — is the precise hypothesis under which dynamic programming applies.

**Pseudo-polynomiality.** `n` is a *numeric value*, not an input *size* in bits; the input (a price table) has size `Θ(m)` numbers, and the runtime `Θ(n·m)` is polynomial in `n` but *exponential* in the bit-length of `n` (`log n`). Rod cutting, like knapsack, is therefore **pseudo-polynomial**, not polynomial in the strict (binary-encoding) sense. This matters when `n` is given in binary and is astronomically large relative to `m`.

### 5.1 The Recursion Tree and Memoization Savings

Consider the *unmemoized* recursion `solve(len) = max_c (price[c] + solve(len - c))`. Let `T(len)` count the calls. Then `T(0) = 1` and `T(len) = 1 + Σ_{c=1}^{len} T(len - c) = 1 + Σ_{r=0}^{len-1} T(r)`. Solving, `T(len) = 2^len` (since `T(len) - T(len-1) = T(len-1)`, giving `T(len) = 2·T(len-1)`). So the naive recursion makes `Θ(2^n)` calls — exponential.

Memoization changes the count: once `solve(r)` is computed, subsequent calls return in `O(1)`. There are `n + 1` distinct subproblems, each doing `O(len) = O(n)` first-cut work on its first (and only) full evaluation, so total work is `Σ_{len=0}^{n} O(len) = O(n^2)`. The recursion *tree* still has exponentially many *nodes*, but all but `n + 1` of them are cache hits — the precise mechanism by which overlapping subproblems convert exponential to polynomial.

### 5.2 Space Lower Bound

The `dp[0..n]` array uses `Θ(n)` space, and this is necessary if you want `O(1)` queries for *every* length up to `n`. If you only need `dp[n]` (not the whole table) *and* the offered lengths are bounded by `L = max offered length`, you can keep only the last `L` entries in a sliding window, reducing space to `Θ(L)`. Reconstruction, however, needs either the full `choice[0..n]` array (`Θ(n)`) or a re-derivation pass (`O(n·m)` time, `O(1)` extra space) — a classic time-space tradeoff.

### 5.3 Magnitude of the Optimum and Overflow Bound

**Proposition 5.3.** With non-negative integer prices bounded by `P = max_ℓ price[ℓ]`, the optimum satisfies `0 ≤ dp[n] ≤ n · P`.

**Proof.** Lower bound: the empty-then-unit plan (if length 1 is offered) gives `≥ 0`; with no offered length, `dp[n] = 0`. Upper bound: any plan has at most `n` pieces (each of length `≥ 1`), each worth `≤ P`, so total `≤ n · P`. ∎

**Consequence for word size.** To store `dp[n]` without overflow you need `⌈log_2(n·P + 1)⌉` bits. For `n = 10^6` and `P = 10^4`, that is `⌈log_2(10^{10})⌉ ≈ 34` bits — beyond 32-bit `int`, mandating 64-bit. The bound also informs the *number of CRT primes* if an exact count is required modulo several primes: enough primes so their product exceeds `n·P`. This is the rod-cutting analogue of the spectral-radius magnitude bound used in matrix-exponentiation walk counting — a cheap a-priori estimate of how many bits the answer needs.

### 5.4 Comparison of Evaluation Strategies

| Strategy | Time | Space | Stack | Notes |
|----------|------|-------|-------|-------|
| Brute-force recursion | `Θ(2^n)` | `O(n)` | `O(n)` | enumerates all compositions; oracle only |
| Memoized recursion | `O(n^2)` | `O(n)` | `O(n)` | lazy; risks deep stack for large `n` |
| Bottom-up, dense | `Θ(n^2)` | `Θ(n)` | none | the textbook default |
| Bottom-up, `m` offered | `Θ(n·m)` | `Θ(n)` | none | production; `m ≪ n` |
| Sliding window (value only) | `Θ(n·m)` | `Θ(L)` | none | `L = max offered length`; no reconstruction |

All polynomial strategies share the same `Θ(n^2)` (or `Θ(n·m)`) work; they differ in space, stack safety, and whether they support the per-length query and reconstruction needs.

---

## 6. Equivalence to Unbounded Knapsack

**Theorem 6.1.** Rod cutting is the special case of the **unbounded (integer) knapsack** problem in which the item set is `{(weight_i, value_i) = (i, price[i]) : 1 ≤ i ≤ n}` and the capacity is `W = n`, and in which the optimal solution fills the capacity exactly.

**Proof.** Unbounded knapsack seeks `max Σ_i x_i · value_i` subject to `Σ_i x_i · weight_i ≤ W`, `x_i ∈ ℤ_{≥0}` (each item usable any number of times). Its DP is `K[w] = max_{i : weight_i ≤ w} ( value_i + K[w - weight_i] )`, `K[0] = 0`. Substitute `weight_i = i`, `value_i = price[i]`, `W = n`:

```
K[w] = max_{i : i ≤ w} ( price[i] + K[w - i] ) = max_{c=1}^{w} ( price[c] + K[w - c] ),
```

which is exactly the rod-cutting recurrence (Theorem 3.1) with `K = dp`. Two structural facts specialize it: (i) there is exactly one item per integer weight `1, …, n`; (ii) the `≤` capacity constraint is met with equality at the optimum, because item `1` (weight `1`, value `price[1]`) lets any leftover capacity be converted to revenue (assuming `price[1] ≥ 0`), so no optimal solution leaves capacity idle when a non-negative unit price exists. Hence the rod is fully cut and `dp[n] = K[n]`. ∎

**Corollary 6.2.** Any algorithm or hardness result for unbounded knapsack transfers to rod cutting and vice versa, modulo the two structural specializations. In particular both are pseudo-polynomial (Section 5) and both admit the same `O(n·m)` DP.

**Remark (when capacity is not filled).** If `price[1] < 0` (a length-1 piece is a liability) or length 1 is *not offered*, the "fill exactly" property can fail — the optimum may leave a stub. The general unbounded-knapsack `≤` formulation handles this by also allowing `K[w] = K[w-1]` (carry capacity forward); plain rod cutting assumes a sellable, non-negative unit length so that exact filling holds.

### 6.1 Worked Equivalence

Map `price = [_, 1, 5, 8, 9]`, `n = 4` to unbounded knapsack with items `(weight, value)`:

```
item 1: (w=1, v=1)    item 2: (w=2, v=5)    item 3: (w=3, v=8)    item 4: (w=4, v=9)
capacity W = 4
K[0]=0
K[1]=max( v1+K[0] )                         = 1
K[2]=max( v1+K[1], v2+K[0] )                = max(2,5)   = 5
K[3]=max( v1+K[2], v2+K[1], v3+K[0] )       = max(6,6,8) = 8
K[4]=max( v1+K[3], v2+K[2], v3+K[1], v4+K[0] ) = max(9,10,9,9) = 10
```

`K[4] = 10 = dp[4]`. The knapsack table is *identical* to the rod-cutting table because the recurrences coincide under the mapping. The only conceptual difference is framing: knapsack "selects items to fill a capacity," rod cutting "cuts a rod into pieces" — but the arithmetic is the same. This is why a single tested `matPow`-style engine (here, a single `dp` fill) serves both, and why mastering one immediately yields the other.

### 6.2 The Exact-Fill Argument, Formally

**Proposition 6.3.** If length `1` is offered with `price[1] ≥ 0`, then the unbounded-knapsack `≤`-optimum at capacity `n` equals the exact-fill rod-cutting optimum.

**Proof.** Let `K_≤[n]` be the knapsack optimum allowing leftover capacity, and `dp[n]` the rod optimum (exact fill). Clearly `dp[n] ≤ K_≤[n]` (every exact-fill plan is a valid `≤` plan). Conversely, take an optimal `≤` plan using total weight `w ≤ n`; append `n - w` copies of the length-1 piece (each adding `price[1] ≥ 0`). This yields an exact-fill plan of value `≥ K_≤[n]`, so `dp[n] ≥ K_≤[n]`. Hence `dp[n] = K_≤[n]`. ∎ The hypothesis `price[1] ≥ 0` is essential: if `price[1] < 0`, padding with unit pieces *lowers* value and the equality breaks.

---

## 7. The Cost-Per-Cut Variant: Analysis

Charge a fixed fee `q ≥ 0` for each saw cut. An `m`-piece plan makes `m - 1` cuts.

**Definition 7.1.** The profit of a plan `(c_1, …, c_m)` is `Σ_i price[c_i] - q·(m - 1)`. Let `g[len]` be the optimal profit, `g[0] = 0`.

**Theorem 7.2.** For `len ≥ 1`,

```
g[len] = max_{1 ≤ c ≤ len} ( price[c] + g[len - c] - q·[c < len] ),
```

where `[c < len]` is `1` when a remainder is severed and `0` when selling whole.

**Proof.** Decompose by first piece `c` (Proposition 4.1). If `c = len`, the plan is the single whole piece, `0` cuts, profit `price[len]`; the term is `price[len] + g[0] - 0 = price[len]`. If `c < len`, the plan is "piece `c`" plus an optimal sub-plan of `len - c`; this introduces exactly **one** cut separating piece `c` from the remainder, beyond the cuts already counted inside the sub-plan's profit `g[len - c]`. Thus the profit is `price[c] + g[len - c] - q`. Taking the max over `c` and applying optimal substructure (the analogue of Theorem 2.1, where the exchange argument carries the `-q` term unchanged because cut counts are additive across the split) gives the formula. ∎

**Why the `[c < len]` guard is necessary.** Counting `m - 1` cuts requires charging one fee *per split*, and a split occurs exactly when a remainder is created (`c < len`). If you charge `q` on every branch including `c = len`, you count `m` cuts for an `m`-piece plan — one too many — penalizing the whole-rod option (`m = 1`, which should incur `0` cuts) and corrupting the decision. Formally, the recursion bottoms out at `g[0]`, and the number of `-q` terms accrued along the recursion equals the number of `c < len` splits, which is `m - 1`. ∎ (sub-claim)

**Complexity.** Identical to plain rod cutting: `Θ(n^2)` (or `Θ(n·m)`), since the only change is an `O(1)` conditional subtraction per inner iteration.

### 7.1 Worked Cost-Per-Cut Trace

`price = [_, 1, 5, 8, 9]`, `q = 1`, `len = 4`:

```
g[0] = 0
g[1] = price[1] + g[0] - 0       = 1            (c=1=len, whole, no cut)
g[2] = max( price[1]+g[1]-1,  price[2]+g[0]-0 )
     = max( 1+1-1,  5 )          = 5            (c=2, whole, no cut)
g[3] = max( price[1]+g[2]-1, price[2]+g[1]-1, price[3]+g[0]-0 )
     = max( 1+5-1, 5+1-1, 8 )    = 8            (c=3, whole, no cut)
g[4] = max( price[1]+g[3]-1, price[2]+g[2]-1, price[3]+g[1]-1, price[4]+g[0]-0 )
     = max( 1+8-1, 5+5-1, 8+1-1, 9 ) = max(8, 9, 8, 9) = 9
```

Two plans tie at profit `9`: selling whole (`c = 4`, zero cuts, profit `9`) and `2+2` (`c = 2`, one cut, profit `5 + 5 - 1 = 9`). Note how the fee turned the *unique* plain-rod winner (`2+2`, revenue 10) into a *tie* with the whole rod — the per-cut cost shifted the decision boundary. Had we (wrongly) charged the fee on the whole-rod branch too, `c = 4` would have scored `9 - 1 = 8`, and we would have lost the correct optimum.

### 7.2 Generalization to Per-Cut and Per-Piece Costs

The same scheme extends to a fixed cost `s` charged *per sold piece* (e.g., a handling fee): subtract `s` whenever a piece is finalized. Since each plan of `m` pieces incurs `m` piece-fees and `m - 1` cut-fees, the combined recurrence is

```
g[len] = max_c ( price[c] - s + g[len - c] - q·[c < len] ).
```

The `- s` is charged on every branch (every `c` finalizes one piece); the `- q` only on `c < len`. This decomposition cleanly separates *per-piece* costs (always charged) from *per-cut* costs (charged per split), and both are `O(1)` additions to the inner loop, preserving `Θ(n^2)`.

---

## 8. The Bounded Variant and Pseudo-Polynomiality

Cap the multiplicity of each length: at most `b_ℓ` copies of length `ℓ`.

**Definition 8.1.** A bounded plan uses each length `ℓ` at most `b_ℓ` times. Let `h[len]` be the optimal revenue under these caps.

This is **bounded knapsack** (multiple knapsack). The unbounded recurrence is invalid because `dp[len - ℓ]` may already use `ℓ` to its cap. The correct formulation processes lengths one at a time:

```
h^{(0)}[w] = 0 for all w   (no lengths available)
for each offered length ℓ with cap b_ℓ:
    h^{(t)}[w] = max_{0 ≤ q ≤ b_ℓ,  q·ℓ ≤ w} ( q·price[ℓ] + h^{(t-1)}[w - q·ℓ] )
answer = h^{(M)}[n]
```

**Theorem 8.2 (Correctness).** `h^{(t)}[w]` is the optimal revenue for capacity `w` using only the first `t` lengths within their caps. *Proof:* induction on `t`; the inner `max` over `q ∈ {0, …, b_ℓ}` enumerates how many copies of the `t`-th length to use, and `h^{(t-1)}` (which excludes length `t`) prevents exceeding the cap. ∎

**Theorem 8.3 (Complexity).** The naive form is `O(n · Σ_ℓ b_ℓ)`. **Binary splitting** — decomposing the cap `b_ℓ` into pieces `1, 2, 4, …, 2^{k}, b_ℓ - (2^{k+1}-1)` and running 0/1 knapsack over the `O(log b_ℓ)` pseudo-items — reduces it to `O(n · Σ_ℓ log b_ℓ)`.

**Proof of binary splitting.** Any integer `q ∈ {0, …, b_ℓ}` is representable as a subset sum of `{1, 2, 4, …, 2^k, r}` with `r = b_ℓ - (2^{k+1} - 1)` and `k = ⌊log_2 b_ℓ⌋` (standard binary decomposition with a remainder term), and conversely every subset sum lies in `{0, …, b_ℓ}`. Hence choosing a subset of the `O(log b_ℓ)` pseudo-items (each a 0/1 item of weight `(copies)·ℓ` and value `(copies)·price[ℓ]`) is equivalent to choosing `q`. Running 0/1 knapsack over all pseudo-items costs `O(n · Σ_ℓ log b_ℓ)`. ∎

**Special case `b_ℓ = 1` for all ℓ.** This is **0/1 knapsack** over lengths — each length usable once — which is a genuinely different problem from plain (unbounded) rod cutting and shares only the table shape.

### 8.1 Worked Binary-Splitting Example

Suppose length `3` has cap `b_3 = 11`. The binary decomposition with remainder uses `k = ⌊log_2 11⌋ = 3`, so the powers are `1, 2, 4` (summing to `7`) and the remainder `r = 11 - 7 = 4`. The pseudo-items are:

```
pseudo-item A: 1 copy  of length 3  -> weight 3,  value price[3]·1
pseudo-item B: 2 copies of length 3 -> weight 6,  value price[3]·2
pseudo-item C: 4 copies of length 3 -> weight 12, value price[3]·4
pseudo-item D: 4 copies (remainder) -> weight 12, value price[3]·4
```

Any quantity `q ∈ {0, …, 11}` is a subset sum: e.g. `q = 9 = 1 + 4 + 4 = A + C + D` or `q = 5 = 1 + 4 = A + C`. Each pseudo-item is a 0/1 item; running 0/1 knapsack (descending capacity) over the `4 = O(log 11)` pseudo-items reproduces every reachable quantity exactly once, confirming Theorem 8.3. Without splitting, enumerating `q = 0..11` per capacity costs `12×` the inner work; with splitting it is `4×` — and the gap widens to `b_ℓ / log b_ℓ` as caps grow.

### 8.2 Why Reading the Pre-`ℓ` Table Enforces the Cap

In the bounded recurrence `h^{(t)}[w] = max_q ( q·price[ℓ] + h^{(t-1)}[w - q·ℓ] )`, the candidate consults `h^{(t-1)}` — the table *before* length `ℓ` was introduced. This guarantees the `h^{(t-1)}[w - q·ℓ]` term contains *no* copies of `ℓ`, so the total count of `ℓ` is exactly the `q` chosen here, never more. If you mistakenly read `h^{(t)}` (the in-progress table), a copy of `ℓ` already counted could be extended by another, silently exceeding the cap — the exact failure mode the snapshot (or descending iteration in the 0/1 reformulation) prevents.

---

## 9. Reconstruction Correctness

**Theorem 9.1.** Recording, for each `len ≥ 1`, a first cut `choice[len] ∈ argmax_c ( price[c] + dp[len - c] )`, the backward walk

```
len ← n; while len > 0: emit choice[len]; len ← len - choice[len]
```

emits a cutting plan whose pieces sum to `n` and whose total revenue equals `dp[n]`.

**Proof.** *Termination and summation:* each iteration decreases `len` by `choice[len] ≥ 1`, so the loop runs at most `n` times and ends at `len = 0`; the emitted lengths sum to the total decrease, `n`. *Revenue:* let the emitted sequence be `c_1 (= choice[n]), c_2, …` with partial remainders `r_0 = n, r_1 = n - c_1, …`. By construction `dp[r_{i-1}] = price[c_i] + dp[r_i]`. Telescoping from `r_0 = n` down to the final `r_k = 0` (with `dp[0] = 0`):

```
dp[n] = price[c_1] + dp[r_1] = price[c_1] + price[c_2] + dp[r_2] = … = Σ_i price[c_i].
```

So the plan's revenue equals `dp[n]`. ∎

**Corollary 9.2 (the testable invariants).** `Σ pieces = n` and `Σ price[pieces] = dp[n]`. A reconstruction failing either invariant has a bug in the `choice[]` recording (typically an index off-by-one or an inconsistent tie rule). These two assertions are the cheapest high-value correctness check for any implementation.

### 9.1 Worked Reconstruction Trace

Using the Section 3.1 tables (`dp = [0,1,5,8,10]`, `choice = [-,1,2,3,2]`) for `n = 4`:

```
len = 4, choice[4] = 2 -> emit piece 2; len = 4 - 2 = 2     (dp[4]=10 = price[2]+dp[2]=5+5 ✓)
len = 2, choice[2] = 2 -> emit piece 2; len = 2 - 2 = 0     (dp[2]=5  = price[2]+dp[0]=5+0 ✓)
len = 0 -> stop.
pieces = [2, 2];  Σ pieces = 4 = n ✓;  Σ price = 5 + 5 = 10 = dp[4] ✓
```

The telescoping of Theorem 9.1 is visible: `dp[4] = price[2] + dp[2] = price[2] + (price[2] + dp[0]) = 5 + 5 + 0 = 10`. Each step "peels off" one optimal piece and reduces to a strictly smaller, already-solved subproblem.

### 9.2 Reconstruction Without `choice[]` (Re-Derivation)

Given only `dp[]` and the offered lengths, the cut at length `len` is *any* `ℓ` with `dp[len] = price[ℓ] + dp[len - ℓ]`. Scanning the `m` offered lengths finds one in `O(m)`; walking the whole reconstruction is `O(len · m)`. This is correct because the equality `dp[len] = price[ℓ] + dp[len - ℓ]` holds *exactly* for an optimal first cut `ℓ` (by Theorem 3.1, the max is attained), and for no suboptimal cut (which gives strictly less). When multiple `ℓ` satisfy the equality, any is a valid optimal cut — the same tie freedom as the `choice[]` approach. This trades the `Θ(n)` `choice[]` array for `O(len · m)` recomputation, useful when memory is the binding constraint.

---

## 10. Generating-Function and Counting Note

The optimization above has a counting shadow that explains *how many* plans exist and connects to compositions.

**Definition 10.1 (Counting compositions by allowed lengths).** Let `S ⊆ {1, 2, …}` be the set of allowed piece lengths and let `C(x) = Σ_{n≥0} a_n x^n` count compositions of `n` using parts in `S`, where `a_n` is the number of ordered plans. Because a nonempty composition is a first part `s ∈ S` followed by a composition of the rest:

```
C(x) = 1 + ( Σ_{s∈S} x^s ) · C(x)   ⇒   C(x) = 1 / ( 1 - Σ_{s∈S} x^s ).
```

**Proposition 10.2 (Unrestricted compositions).** For `S = {1, 2, 3, …}`, `Σ_{s≥1} x^s = x/(1-x)`, so `C(x) = 1/(1 - x/(1-x)) = (1-x)/(1-2x) = 1 + Σ_{n≥1} 2^{n-1} x^n`, recovering `a_n = 2^{n-1}` (Definition 1.3) — the exponential count that brute force must enumerate and that the DP avoids.

**Proposition 10.3 (Parts in {1, 2}).** For `S = {1, 2}`, `C(x) = 1/(1 - x - x^2)`, the Fibonacci generating function: the number of compositions of `n` into parts `1` and `2` is `F_{n+1}`. This is the same rational-generating-function phenomenon seen in the linear-recurrence/transfer-matrix world: restricting allowed parts yields a linear recurrence on the count.

**Connection to the optimization.** The DP recurrence `dp[len] = max_c(price[c] + dp[len-c])` is the `(max, +)` analogue of the counting recurrence `a_n = Σ_s a_{n-s}`: replace "sum over first parts" with "max over first parts" and "multiply by 1 per part" with "add `price[c]`." The optimization lives in the `(max, +)` semiring; the counting lives in the ordinary `(+, ×)` semiring — the same first-part decomposition (Proposition 4.1) underlies both. This is why rod cutting, composition counting, and coin change (Section 11) are algebraic siblings.

### 10.1 Worked Generating-Function Example

For parts `S = {1, 2}` (Proposition 10.3), `C(x) = 1/(1 - x - x^2)`. Expand the coefficients:

```
C(x) = 1 + x + 2x^2 + 3x^3 + 5x^4 + 8x^5 + 13x^6 + …
a_0=1, a_1=1, a_2=2, a_3=3, a_4=5, a_5=8, …   (a_n = F_{n+1})
```

Check `a_3 = 3` directly: compositions of `3` into parts `{1,2}` are `1+1+1`, `1+2`, `2+1` — exactly 3. The recurrence `a_n = a_{n-1} + a_{n-2}` (Fibonacci) falls out of the denominator `1 - x - x^2`, whose reciprocal-root `φ = (1+√5)/2` is the exponential growth rate of the count. This is the *counting* shadow; the *optimization* version (`max` over the same first parts) would instead track the best revenue, growing not by `φ^n` but bounded by `n · max_price`.

### 10.2 Counting Optimal Plans (a Hybrid)

A practically useful hybrid carries *both* the optimum value `dp[len]` and the *number* of plans achieving it, `cnt[len]`:

```
dp[0] = 0, cnt[0] = 1
for len = 1..n:
    dp[len] = -∞
    for c = 1..len:
        v = price[c] + dp[len - c]
        if v > dp[len]:  dp[len] = v;  cnt[len] = cnt[len - c]      # strictly better: reset
        elif v == dp[len]:  cnt[len] += cnt[len - c]                # tie: accumulate
```

**Correctness.** `cnt[len]` counts ordered first-cut plans realizing `dp[len]`. On a strict improvement the count restarts from the new winner's subproblem count; on a tie the counts add (disjoint by first cut, Corollary 2.2). This is the `(+, ×)`-counting recurrence *restricted to the argmax set* of the `(max, +)` optimization — a clean fusion of Sections 10 and 3, and the basis for Task 8 in [`tasks.md`](./tasks.md). Counts can grow exponentially, so reduce `cnt[]` mod a prime if exact magnitude is not required.

---

## 11. Relation to Coin Change

Coin change uses the *identical* first-part (here, first-coin) decomposition but a different objective and, for one variant, a different loop discipline.

| Problem | Semiring | Recurrence | Loop note |
|---------|----------|------------|-----------|
| Rod cutting (max revenue) | `(max, +)` | `dp[len] = max_c (price[c] + dp[len-c])` | order irrelevant for `max` |
| Coin change — min coins | `(min, +)` | `f[a] = min_c (1 + f[a - coin_c])` | order irrelevant for `min` |
| Coin change — count combinations | `(+, ×)` | `g[a] = Σ_c g[a - coin_c]` (with care) | **coins outermost** to count combinations, not permutations |

**Theorem 11.1 (Why combination counting needs coins outermost).** The unordered-combination count of making amount `a` from coins is *not* `Σ_c g[a - coin_c]` with `a` outermost — that counts ordered sequences (permutations), overcounting. Processing coins in an outer loop and amounts in an inner loop,

```
for each coin: for a = coin..A: g[a] += g[a - coin],
```

ensures each combination is counted once in a canonical (non-decreasing-coin) order. *Proof sketch:* after the loop for coins `{coin_1, …, coin_t}` finishes, `g[a]` counts multisets using only those `t` coin types; adding `coin_{t+1}` in the next outer iteration extends multisets with the new type without reordering, so no multiset is counted under two orders. ∎

For rod cutting and the *min/max* objectives, loop order does not affect correctness (the operator is order-insensitive over the same set of candidate splits), which is why the plain rod-cutting loop can be written either way. The order subtlety is *specific* to combination *counting* — a point worth internalizing because it is the most common coin-change bug, and rod cutting's `max` objective is mercifully immune to it.

### 11.1 Worked Coin-Change Contrast

Coins `{1, 2}`, amount `3`. The three objectives, on the *same* unbounded structure:

```
min coins:   f[0]=0; f[1]=1; f[2]=min(1+f[1], 1+f[0])=1; f[3]=min(1+f[2],1+f[1])=2  -> 2 coins (1+2)
count combos (coins outermost):
   start g=[1,0,0,0]
   coin 1: g=[1,1,1,1]                 (ways using only 1s)
   coin 2: g[2]+=g[0]->2; g[3]+=g[1]->2  -> g=[1,1,2,2]; g[3]=2  ({1,1,1},{1,2})
count perms (amount outermost — WRONG for combos):
   h[0]=1; h[1]=h[0]=1; h[2]=h[1]+h[0]=2; h[3]=h[2]+h[1]=3   (counts {1,1,1},{1,2},{2,1} = 3, overcounts)
```

The combination count is `2` (`{1,1,1}` and `{1,2}`); the permutation count is `3` (it distinguishes `1+2` from `2+1`). Rod cutting's analogue — "max revenue" — is `max(price[1]+dp[2], price[2]+dp[1], price[3]+dp[0])`, and because `max` does not care whether `1+2` and `2+1` are "the same plan," it never confronts this distinction. The lesson: the *objective's algebra* (idempotent `max`/`min` vs additive counting) determines whether order discipline is needed.

### 11.2 A Unifying Template

All four siblings instantiate one template `dp[v] = ⊕_{part p} ( w(p) ⊗ dp[v - p] )` with base `dp[0] = 1̄`:

| Problem | `⊕` | `⊗` | `w(p)` | `1̄` |
|---------|-----|-----|--------|-----|
| Rod cutting (max revenue) | `max` | `+` | `price[p]` | `0` |
| Coin change (min coins) | `min` | `+` | `1` | `0` |
| Coin change (count combos) | `+` | `×` | `1` | `1` |
| Composition count | `+` | `×` | `1` | `1` |

Implementing the template once and parameterizing `(⊕, ⊗, w, 1̄)` yields all four — the dynamic-programming analogue of the semiring abstraction. The only non-uniform wrinkle is the coins-outermost loop discipline for combination counting (Theorem 11.1), which the idempotent `max`/`min` rows do not require.

---

## 12. Summary

- **Optimal substructure** (Theorem 2.1): the tail of an optimal cutting plan is optimal for the remaining rod, proved by a cut-and-paste exchange argument. This is what licenses `dp[len - c]`.
- **Recurrence correctness** (Theorem 3.1): `dp[len] = max_c (price[c] + dp[len-c])`, `dp[0]=0`, proved by two-sided induction — achievability (≥) and optimal-substructure upper bound (≤).
- **First-cut decomposition** (Proposition 4.1): plans of `len` biject with `⊎_c {c} × {plans of len-c}`; the enumeration is exhaustive and non-redundant, so trying only first cuts suffices.
- **Complexity**: `Θ(n^2)` dense, `Θ(n·m)` over `m` offered lengths, `Θ(n)` space. Pseudo-polynomial (polynomial in the value `n`, exponential in `log n`), like knapsack.
- **Equivalence to unbounded knapsack** (Theorem 6.1): rod cutting is unbounded knapsack with `weight_i = i`, `value_i = price[i]`, `W = n`, and exact capacity filling; hardness and algorithms transfer.
- **Cost-per-cut** (Theorem 7.2): subtract the fee only on `c < len`; the recursion accrues exactly `m - 1` fees for an `m`-piece plan, so the whole-rod option is correctly free.
- **Bounded variant** (Theorems 8.2–8.3): bounded knapsack; naive `O(n·Σ b_ℓ)`, binary-split to `O(n·Σ log b_ℓ)`; `b_ℓ = 1` is 0/1 knapsack, a distinct problem.
- **Reconstruction** (Theorem 9.1): the backward `choice[]` walk yields a plan summing to `n` with revenue `dp[n]`; the two invariants are the canonical correctness test.
- **Counting shadow** (Section 10): the same first-part decomposition counts compositions via `C(x) = 1/(1 - Σ_{s∈S} x^s)`, giving `2^{n-1}` unrestricted and Fibonacci for parts `{1,2}` — the `(+,×)` cousin of the `(max,+)` optimization.
- **Coin change** (Section 11): identical decomposition, different semiring; combination counting (uniquely) needs coins outermost, a subtlety the rod-cutting `max` avoids.

### Complexity Cheat Table

| Task | Method | Complexity | Notes |
|------|--------|-----------|-------|
| Max revenue, dense lengths | bottom-up DP | `Θ(n^2)` | textbook |
| Max revenue, `m` offered lengths | unbounded-knapsack loop | `Θ(n·m)` | production |
| Reconstruct cuts | `choice[]` backward walk | `O(n)` | invariants verifiable |
| Cost-per-cut | DP with `[c<len]` fee | `Θ(n^2)` / `Θ(n·m)` | one extra subtraction |
| Bounded (caps `b_ℓ`) | bounded knapsack | `O(n·Σ b_ℓ)` → `O(n·Σ log b_ℓ)` | binary splitting |
| Count compositions | generating function / DP | `O(n·m)` | `C(x)=1/(1-Σ x^s)` |
| Brute force | enumerate compositions | `Θ(2^n)` | the baseline DP beats |

### Closing Notes

- **Pseudo-polynomiality** is the honest complexity statement: rod cutting is polynomial in the rod *value* `n`, not in its bit-length — the same caveat that classifies knapsack.
- **The exchange argument** (Section 2) is the reusable proof technique: it establishes optimal substructure for rod cutting, knapsack, shortest paths, and most greedy/DP correctness proofs.
- **Semiring duality** (Sections 10–11) unifies rod cutting (`max,+`), coin-change min (`min,+`), and composition counting (`+,×`) under one first-part decomposition — recognizing this lets one mental template solve the whole family.
- **Greedy is unsound** (Section 4.2) for arbitrary price tables because the value of a cut depends on the optimally-solved remainder; only DP captures that global dependency.
- **The overflow bound** `dp[n] ≤ n·P` (Section 5.3) is the cheap a-priori magnitude estimate that dictates word size and CRT-prime count.

### One-Page Proof Map

For quick reference, the logical dependency chain of the correctness argument:

```
Composition revenue (Def 1.1)
   │
   ├─► Optimal substructure (Thm 2.1, exchange argument)
   │        │
   │        └─► CLRS criteria: substructure + overlap (§2.1)
   │
   ├─► First-cut bijection (Prop 4.1, §4.1) ── exhaustive & non-redundant
   │
   └─► Recurrence correctness (Thm 3.1: (≥) achievable, (≤) substructure bound)
            │
            ├─► Complexity Θ(n^2)/Θ(n·m), pseudo-polynomial (Thm 5.1–5.2)
            ├─► Equivalence to unbounded knapsack (Thm 6.1, Prop 6.3)
            ├─► Cost-per-cut variant (Thm 7.2)
            ├─► Bounded variant + binary splitting (Thm 8.2–8.3)
            └─► Reconstruction correctness (Thm 9.1, telescoping)
```

Every downstream result rests on Theorem 2.1; if optimal substructure failed, none of the recurrence-based methods would be valid — which is exactly why the exchange argument is the load-bearing proof of the entire topic.

A final observation ties the threads together: the *same* first-cut decomposition that makes the optimization tractable (Sections 2–6) also makes the *counting* version tractable (Section 10) and the *cost-adjusted* version tractable (Section 7). The decomposition is the invariant; the semiring is the dial. Turn the dial to `(max, +)` and you maximize revenue; to `(min, +)` and you minimize coins; to `(+, ×)` and you count plans. This is the deepest reason rod cutting is the canonical first dynamic-programming example — it isolates the one structural idea (optimal substructure under a first-part decomposition) that every later DP reuses.

Foundational references: CLRS, *Introduction to Algorithms*, Ch. 15 (rod cutting as the DP exemplar and the optimal-substructure / overlapping-subproblems criteria); Gilmore & Gomory (1961) for the cutting-stock LP and the knapsack pricing subproblem; Flajolet & Sedgewick, *Analytic Combinatorics*, for composition generating functions; Martello & Toth, *Knapsack Problems*, for bounded-knapsack binary splitting. Sibling topics: `02-unbounded-knapsack`, `19-coin-change`.
