# Game DP — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Score-Difference Theorem (Proof by Induction)
3. Equivalence to Minimax and Negamax
4. Optimal Substructure for Interval Game DP
5. The Zero-Sum Reduction: Why One Number Suffices
6. Complexity Analysis: O(n²) and Its Tightness
7. The Boolean (Win/Loss) Specialization
8. Reconstruction of Optimal Play
9. Beyond Zero-Sum: Per-Player Payoff Vectors
10. Relation to Grundy Theory and the Scoring/Impartial Divide
11. Generalized State Spaces and DAG Game DP
12. Worked End-to-End Derivation
13. Summary

---

## 1. Formal Definitions

We formalize a deterministic, finite, two-player, perfect-information, alternating-move game with additive numeric payoffs.

**Definition 1.1 (Game state and moves).** A game is a tuple `(Γ, →, π, T)` where `Γ` is a finite set of **states**, `→ ⊆ Γ × Γ` is the legal-move relation (with each edge `S → S'` carrying an immediate **gain** `g(S, S') ∈ ℝ` for the player to move), `π : Γ → {1, 2}` is the player-to-move function (alternating along any play), and `T ⊆ Γ` is the set of **terminal** states (no outgoing moves).

**Definition 1.2 (Pick-from-ends instance).** For an array `a[0..n-1]`, the state set is `Γ = { (i, j) : 0 <= i <= j+1 <= n }`, where `(i, j)` with `i <= j` denotes the remaining sub-array `a[i..j]` and `(i, i-1)` denotes the empty interval (terminal). Moves from `(i, j)` with `i <= j`: take-left `(i, j) → (i+1, j)` with gain `a[i]`, and take-right `(i, j) → (i, j-1)` with gain `a[j]`.

**Definition 1.3 (Strategy and play).** A **strategy** for a player is a function selecting, at each state where it is that player's turn, one legal move. A pair of strategies determines a unique finite **play** `S_0 → S_1 → ... → S_m` ending at a terminal state. Player `p`'s total payoff is the sum of gains on moves where `π(S_t) = p`.

**Definition 1.4 (Score difference / game value).** Define `D : Γ → ℝ` by
```
D(S) = (optimal total of the player to move at S)
       − (optimal total of the other player),
```
under optimal play by **both** players from `S` onward. We will prove `D` satisfies a recurrence and is well-defined (Section 2).

**Definition 1.5 (Zero-sum, additive).** The game is **zero-sum additive** when, along every play, `payoff₁ + payoff₂` equals the fixed total `Σ` of all gains collected (no gain is created or destroyed by the choice of moves; only *who* collects it varies). For pick-from-ends, `Σ = Σ_k a[k]` regardless of play.

**Remark.** The whole theory rests on Definition 1.5: because the total is conserved, the *difference* carries the same information as the pair of scores, and a single scalar `D(S)` suffices (Section 5). Without it, one needs the vector of Section 9.

**Notation.** Throughout, `n = |a|` is the array length, `S, S'` are states, `m` indexes legal moves, `g(m)` the gain of move `m`, `Σ(S)` the sum of all gains remaining from `S` to any terminal (for pick-from-ends, `Σ((i,j)) = Σ_{k=i}^{j} a[k]`), and `[P]` the Iverson bracket (`1` if `P` holds, else `0`).

**Definition 1.6 (Perfect information, deterministic, finite).** The games considered are **perfect-information** (each player observes the full state), **deterministic** (no chance moves), and **finite** (finitely many states and a bound on play length). These three properties are exactly what license backward induction: perfect information removes the need for mixed strategies, determinism removes expectation, and finiteness guarantees termination. Relaxing any one of them moves the problem outside plain game DP — chance moves require *expectimax* (expectation layers), imperfect information requires belief states / game-theoretic solvers, and infinite/cyclic play requires the fixed-point machinery of Section 11.2.

**Definition 1.7 (Optimal-substructure prerequisite).** A game admits the DP of this topic iff its state graph `(Γ, →)` is a finite DAG and the value of a state depends only on the state (not on the path taken to reach it). The pick-from-ends game satisfies this because the remaining coins form an interval regardless of move order, so `(i, j)` is a *complete* description of the future.

---

## 2. The Score-Difference Theorem (Proof by Induction)

**Theorem 2.1 (Optimal-play recurrence).** For every non-terminal state `S`,
```
D(S) = max over legal moves m: S → S' of  [ g(m) − D(S') ],
```
and for every terminal state `S`, `D(S) = 0`. In particular, for pick-from-ends,
```
D(i, j) = max( a[i] − D(i+1, j),  a[j] − D(i, j−1) ),    D(i, i−1) = 0,
```
equivalently with the single-coin base `D(i, i) = a[i]`.

**Proof (induction on the number of remaining moves `r`, i.e., the length of the longest play from `S`).**

*Base case `r = 0` (terminal).* No player moves; both collect `0` from here, so the difference is `0 = D(S)`. For pick-from-ends, the empty interval `(i, i−1)` has `D = 0`. The single-coin case `r = 1`: the mover takes `a[i]`, the opponent gets nothing, difference `a[i] = D(i, i)`, consistent with `D(i,i) = a[i] − D(i, i−1) = a[i] − 0`.

*Inductive step.* Assume the formula holds for all states with fewer than `r` remaining moves, and let `S` have `r` remaining moves (`r >= 1`). The player to move, call them `P`, chooses some legal move `m : S → S'`. After `m`, it is the opponent's turn at `S'`, which has at most `r − 1` remaining moves, so by the inductive hypothesis `D(S')` is the difference *the opponent* (now the mover at `S'`) can force in their own favor. Decompose `P`'s eventual advantage:
```
(P's total − opponent's total starting from S, given P plays m)
   = g(m)  +  (P's total − opponent's total over the rest of the game from S')
   = g(m)  −  (opponent's total − P's total over the rest from S')
   = g(m)  −  D(S'),
```
because at `S'` the opponent is the player-to-move, so `D(S')` is measured *(opponent − P)*, and negating flips it to *(P − opponent)*. `P` will pick the move maximizing their own advantage, hence
```
D(S) = max_{m : S → S'} [ g(m) − D(S') ].
```
The `max` is over a finite, nonempty set (non-terminal `S` has ≥ 1 move), so `D(S)` is well-defined. By induction the theorem holds for all `S`. ∎

**Corollary 2.2 (Winner).** Player 1 (the mover at the initial state `S_0`) wins or ties under optimal play iff `D(S_0) >= 0`; ties occur iff `D(S_0) = 0`. The optimal play is *guaranteed*: `P` can secure at least `D(S_0)` against **any** opponent, and exactly `D(S_0)` against an optimal one (it is the game's minimax value).

**Corollary 2.3 (Raw scores).** With conserved total `Σ`, the mover's optimal total is `(Σ + D(S_0)) / 2` and the opponent's is `(Σ − D(S_0)) / 2`. Both are integers when gains are integers, since `Σ` and `D` share parity (their sum is `2 ·` (mover's total)).

**Corollary 2.4 (Strategy guarantee, both directions).** The value `D(S_0)` is simultaneously:
- a **lower bound** the mover can *guarantee* against *any* opponent (by playing the maximizing branch at each state, the mover secures at least `D` regardless of opponent play), and
- an **upper bound** the opponent can *hold the mover to* by playing optimally (the opponent, playing the minimizing-of-the-mover response — equivalently their own maximizing branch — prevents the mover from exceeding `D`).

These two facts together say `D(S_0)` is the *exact* value of the game, not merely an estimate. The proof is the standard pair of strategy-stealing arguments: the maximin strategy achieves `>= D`, the minimax strategy holds `<= D`, and they meet at `D` by the recurrence. This is why "optimal play" is unambiguous here — there is a single well-defined value both players can force toward.

### 2.1 Worked Verification

For `a = [5, 3, 7, 10]` (the junior running example), the recurrence gives `D(0,0)=5, D(1,1)=3, D(2,2)=7, D(3,3)=10`; then `D(0,1)=2, D(1,2)=4, D(2,3)=3`; then `D(0,2)=5, D(1,3)=6`; finally `D(0,3)=max(5−6, 10−5)=max(−1,5)=5`. By Corollary 2.2, `D = 5 >= 0` ⇒ player 1 wins; by Corollary 2.3 with `Σ = 25`, raw scores are `15` and `10`. A brute-force enumeration of all `2^3 = 8` play orders confirms `15` is the best player 1 can force and `10` the best player 2 can force against it — the empirical anchor for the inductive proof.

### 2.2 The Decomposition Bijection, Made Explicit

The inductive step rests on a **bijection** between plays of the length-`r` game and (first-move, continuation) pairs:

```
{ optimal-value plays of S }  ≅  ⊎_{m : S → S'} ( {move m} × {optimal plays of S'} ),
```

a disjoint union over the legal first moves `m`. Disjointness holds because the first move `m` is recovered unambiguously from any play. The product structure holds because, *after* fixing the first move, the continuation is an independent sub-game on `S'`. Taking the mover's value of each side and applying "the mover banks `g(m)` then loses `D(S')` relative to the opponent" yields `g(m) − D(S')`; maximizing over `m` selects the mover's best first move. This combinatorial decomposition is the semantic content of Theorem 2.1; the `max` is the algebra of "rational mover picks the best branch," and the minus sign is the algebra of "the opponent is also rational." Every variant in this topic re-instantiates this same bijection with a different move set.

### 2.3 On the Convention `D(terminal) = 0`

Some treatments fret over the empty-game value, but `D(\varnothing) = 0` is forced: with no coins left, both players collect `0`, so the difference is `0`. Any other choice would break the single-coin base (`D(i,i) = a[i] − D(i, i−1)` requires `D(i, i−1) = 0`) and the inductive step simultaneously. The value `0` is also the additive identity of the difference algebra, so combinatorics and algebra agree — exactly as `A^0 = I` is forced for walk-counting in the sibling matrix-exponentiation topic.

---

## 3. Equivalence to Minimax and Negamax

**Definition 3.1 (Minimax value).** Let `V₁(S)` be the value to player 1 under optimal play, with player 1 maximizing and player 2 minimizing player 1's payoff (a zero-sum convention where player 2's payoff is `Σ − V₁`). Then
```
V₁(S) = max_{m} [ g(m) + V₁(S') ]   if it is player 1's turn,
V₁(S) = min_{m} [ −g(m) + V₁(S') ]  if it is player 2's turn (gain g(m) goes to player 2, reducing player 1's relative value),
```
with `V₁(terminal) = 0`.

**Theorem 3.2 (Negamax equivalence).** Define `D(S)` from the *mover's* perspective as in Definition 1.4. Then for all `S`,
```
D(S) = ± (V₁(S) − V₂(S)) ,
```
with sign `+` when it is player 1's turn at `S` and `−` when it is player 2's turn, and `D` satisfies the single uniform recurrence `D(S) = max_m [ g(m) − D(S') ]` regardless of whose turn it is.

**Proof.** The classical minimax alternates `max` (mover maximizes own value) and `min` (opponent minimizes the mover's value). The **negamax identity** rewrites the `min` layer: minimizing the mover's value is the same as maximizing the *opponent's* value, because the game is zero-sum (`value_to_mover = −value_to_opponent` up to the conserved constant). Substituting "value always measured from the player-to-move's own perspective" turns the alternating `max`/`min` into a single recurrence with a sign flip on the recursive term:
```
value_to_mover(S) = max_m [ g(m) − value_to_mover(S') ].
```
This is exactly `D(S)`. The sign flip `−` is the negamax negation; it replaces the explicit `min` layer. Thus `D` is the negamax value, and the pick-from-ends recurrence `max(a[i] − D(i+1,j), a[j] − D(i,j−1))` is a verbatim instance. ∎

**Consequence.** Game DP **is** memoized minimax (in its negamax form) applied to a game whose state space is small and overlapping enough to tabulate. Topic `16` treats minimax/negamax with alpha-beta pruning for large, sparse game trees; this topic is the special case where the subproblem DAG has only `O(n²)` (or `O(n)`) distinct nodes, so memoization yields a polynomial algorithm. Alpha-beta pruning offers no asymptotic improvement here because every state must be evaluated to fill the table, but it remains valuable in the unbounded-tree regime of topic `16`.

### 3.1 The Negamax Sign Bookkeeping in Full

To make the sign flip rigorous, define `value(S)` as "the payoff the player to move at `S` will end with, minus the payoff the other player will end with, under optimal play." Classical minimax instead fixes a *reference* player (say player 1) and computes `V₁(S)`. The two are related by `value(S) = V₁(S)` when it is player 1's turn and `value(S) = −V₁(S) + ` (a state-dependent constant from already-banked scores) otherwise. The negamax formulation eliminates the bookkeeping of "whose turn" by always measuring from the mover's own perspective, at the cost of inserting a single `−` on the recursive call:

```
minimax (player 1's view):   V(S) = max_m [ +g(m) + V(S') ]   on player-1 nodes
                             V(S) = min_m [ −g(m) + V(S') ]   on player-2 nodes
negamax (mover's view):      D(S) = max_m [  g(m) − D(S') ]   on every node
```

The equivalence `min_m f = −max_m (−f)` is exactly what converts the `min` line into the `max`-with-negation line. This is why a *single* code path (no turn parameter) computes the value for both players — the most error-resistant way to implement game DP, and the reason the recurrence in this topic never references "whose turn it is."

### 3.2 Why the Game Value Is Well-Defined and Unique

**Proposition 3.3.** For a finite acyclic perfect-information zero-sum game, the value `D(S₀)` exists, is unique, and equals both the maximin (best the mover can guarantee against any opponent) and the minimax (best against an optimal opponent).

**Proof.** Backward induction (Zermelo 1913) terminates because the game is finite and acyclic: every state reaches a terminal in boundedly many moves. At each state the `max` over a finite move set is attained, so `D` is single-valued. The maximin = minimax equality is the finite zero-sum case of the minimax theorem: with perfect information there is an optimal *pure* strategy (no randomization needed), so the guaranteed value and the against-optimal value coincide. ∎

### 3.3 Contrast with Imperfect-Information Games

The pure-strategy guarantee of Proposition 3.3 is special to *perfect* information. In imperfect-information zero-sum games (poker, simultaneous-move games) the von Neumann minimax theorem still gives a value, but it generally requires *mixed* (randomized) strategies, and computing it is a linear program, not a DP. Game DP's correctness is therefore tightly coupled to the perfect-information assumption: a single deterministic best move exists at every state because the mover sees everything and the opponent's future is itself determined by a deterministic optimal policy. Drop perfect information and the `max_m` over deterministic moves is no longer the right operator — you would need to optimize over probability distributions on moves, leaving the DP framework entirely. This is the precise theoretical reason the topic restricts to perfect-information games.

---

## 4. Optimal Substructure for Interval Game DP

**Theorem 4.1 (Optimal substructure).** The optimal value `D(i, j)` of the pick-from-ends game on `a[i..j]` is composed from the optimal values of the strictly smaller sub-games `D(i+1, j)` and `D(i, j−1)`; no suboptimal solution to a sub-interval can be part of an optimal solution to a containing interval.

**Proof.** Suppose, for contradiction, that an optimal play of `(i, j)` whose first move is take-left induces play on `(i+1, j)` that is *not* optimal for the player to move there (the opponent). Then the opponent could deviate to their optimal strategy on `(i+1, j)`, strictly improving *their* difference `D(i+1, j)`, which by the recurrence `D(i,j) = a[i] − D(i+1,j)` strictly *decreases* the original mover's value — contradicting that the original play was optimal for them. The symmetric argument holds for take-right. Hence each sub-game must be played optimally, establishing optimal substructure. ∎

**Theorem 4.2 (Overlapping subproblems).** The naive game tree for `a[0..n-1]` has `Θ(2^n)` leaves (each of the `n` moves branches two ways down to length-1 intervals), but only `Θ(n²)` *distinct* states `(i, j)` exist. Therefore memoization reduces the exponential tree to a polynomial DAG.

**Proof.** Distinct states are pairs `(i, j)` with `0 <= i <= j < n`, of which there are `n(n+1)/2 = Θ(n²)`. The unmemoized recursion revisits each many times: the number of root-to-leaf paths is `Σ` over interleavings of left/right choices, which is `Θ(2^n)`. The ratio `2^n / n²` is the speedup memoization provides. ∎

These two properties — **optimal substructure** (Theorem 4.1) and **overlapping subproblems** (Theorem 4.2) — are precisely the two hallmarks that license dynamic programming. Their conjunction is what makes the `O(n²)` table both correct and efficient.

**Theorem 4.3 (DAG topological order).** The dependency relation `(i, j) ≻ (i+1, j)` and `(i, j) ≻ (i, j−1)` is a partial order whose every chain decreases interval length. Hence filling states by increasing interval length `L = j − i + 1` is a valid topological order: when `D(i, j)` is computed, both `D(i+1, j)` and `D(i, j−1)` (length `L−1`) are already final. ∎

### 4.1 Counting the Distinct States Precisely

The states are pairs `(i, j)` with `0 <= i <= j <= n−1`, of which there are exactly `\binom{n+1}{2} = n(n+1)/2`. Of these, `n` are the length-1 base cells and `n(n−1)/2` are filled by the recurrence. Each non-base cell does a `max` of two reads, so the exact operation count is `2 · n(n−1)/2 = n(n−1)` subtractions plus `n(n−1)/2` comparisons — `Θ(n²)` with a small constant. Compare the unmemoized recursion: the number of leaf evaluations equals the number of distinct sequences of `n` left/right choices that reach a single coin, which is `Θ(2^n)`. The exact memoization speedup is therefore `Θ(2^n / n²)`, super-polynomial — a vivid quantification of why caching is not optional but transformative.

### 4.2 The Exchange Argument in Full

The exchange argument of Theorem 4.1 deserves a precise statement because it is the *only* nontrivial step in proving correctness. Suppose play `P` of `(i, j)` opens with take-left and then plays `(i+1, j)` according to some strategy `σ`. Let `σ*` be the optimal strategy for the mover at `(i+1, j)`, achieving `D(i+1, j)`. If `σ ≠ σ*` in value (i.e., `σ` achieves a difference `< D(i+1, j)` for the mover at `(i+1, j)`), then the mover at `(i+1, j)` — who is the *opponent* of the original mover — can deviate to `σ*`, *increasing* their own difference, which by `D(i, j) = a[i] − D(i+1, j)` *decreases* the original mover's value. Since the original mover assumed an optimal (worst-case) opponent, they must have planned for `σ*`, contradicting `σ ≠ σ*`. Hence every sub-game is played optimally — the essence of optimal substructure. The symmetric argument covers the take-right opening. ∎

---

## 5. The Zero-Sum Reduction: Why One Number Suffices

**Theorem 5.1 (Sufficiency of the difference).** For a zero-sum additive game (Definition 1.5), the scalar `D(S)` together with the conserved remaining total `Σ(S)` determines both players' optimal totals; conversely the pair of optimal totals determines `D(S)`. Thus storing `D(S)` alone (one number per state) loses no information needed to compute the optimal value or winner.

**Proof.** Let `u(S)` be the mover's optimal total and `v(S)` the opponent's. By conservation `u(S) + v(S) = Σ(S)` and by definition `u(S) − v(S) = D(S)`. This `2×2` linear system has the unique solution `u = (Σ + D)/2`, `v = (Σ − D)/2`. Since `Σ(S)` is a function of the state alone (sum of remaining gains, independent of play), it need not be stored in the DP — it is recomputable or trackable in `O(1)`. Therefore `D(S)` is a sufficient statistic for the state's value. ∎

**Theorem 5.2 (Necessity of zero-sum for the reduction).** If the game is *not* zero-sum — i.e., the total collected can depend on the moves chosen — then `D(S)` alone is **not** sufficient: two states with equal difference but different totals can have different optimal continuations, so a scalar cannot encode the value. The per-player payoff vector (Section 9) is then required.

**Proof (counterexample schema).** Construct a game where move `m₁` from `S` yields difference `D` with total `Σ₁` and move `m₂` yields the same difference `D` with total `Σ₂ ≠ Σ₁`, and where a *later* decision's optimality depends on the running total (e.g., a bonus triggered at a threshold). A scalar `D(S)` cannot distinguish the two, so it cannot drive the optimal later choice. Hence sufficiency fails without conservation. ∎

This pair of theorems is the formal justification for the senior-level decision rule: **use the difference scalar exactly when the game is zero-sum; otherwise use the vector.**

### 5.1 The Parity Invariant

**Proposition 5.3.** For integer gains, `Σ(S)` and `D(S)` have the same parity, so `(Σ ± D)/2` is always an integer.

**Proof.** `Σ = u + v` and `D = u − v` give `Σ + D = 2u` and `Σ − D = 2v`, both even. Hence `Σ` and `D` are congruent mod 2 (their sum and difference are even), and the two reconstructed scores `u = (Σ + D)/2`, `v = (Σ − D)/2` are integers. ∎

This is more than a curiosity: a *fractional* reconstructed score is a definitive signal of a bug — either a mis-signed recurrence or a wrong total `Σ` — and makes a cheap, always-on assertion in production code. It is the algebraic backbone of the senior-level "sum/parity invariant" test.

### 5.2 The Conserved Total as a Free Variable

Note that `Σ(S)` need never be *stored* in the DP table: for pick-from-ends, `Σ((i, j)) = prefix[j+1] − prefix[i]` from a prefix-sum array, an `O(1)` lookup. So the difference DP carries one number per state while the second degree of freedom (the total) lives entirely in a separate `O(n)` prefix-sum structure shared across all states. This factorization — *variable part in the table, conserved part in a side structure* — is the precise mechanism by which the zero-sum reduction saves a dimension, and it generalizes: whenever a quantity is a state-determined function (not play-dependent), it belongs in a side structure, not the DP state.

---

## 6. Complexity Analysis: O(n²) and Its Tightness

**Theorem 6.1 (Time and space).** The interval game DP for pick-from-ends runs in `Θ(n²)` time and `Θ(n²)` space (or `Θ(n)` space if only the value, not the play, is required).

**Proof.** There are `Θ(n²)` states (Theorem 4.2). Each state evaluates a `max` of two `O(1)` expressions, so per-state work is `Θ(1)`. Total time `Θ(n²)`. The table stores one number per state: `Θ(n²)` space. For the value alone, the rolling-diagonal reduction (each length-`L` value depends only on length-`(L−1)` values) keeps two `O(n)` arrays, giving `Θ(n)` space. ∎

**Theorem 6.2 (Lower bound for the table approach).** Any algorithm that, like the DP, must output the optimal first-move value for *every* sub-interval (e.g., to answer arbitrary sub-game queries) requires `Ω(n²)` time, since there are `Θ(n²)` distinct answers to produce.

**Theorem 6.3 (Rolling-array space is optimal for value-only).** Computing only `D(0, n−1)` (not the full table or the play) requires `Θ(n)` working space and this is optimal.

**Proof.** Upper bound: the length-`L` diagonal depends only on the length-`(L−1)` diagonal, so two `O(n)` buffers suffice, and the value emerges in the final (length-`n`) diagonal of size 1. Lower bound: to combine two length-`(n−1)` sub-results you must retain at least the `Θ(n)` distinct shorter-interval values simultaneously, since each contributes to a distinct longer interval; no `o(n)` summary of the diagonal preserves enough information (an adversary argument over the `Θ(n)` independent shorter values). ∎

**Remark on move-set-dependent complexity.** The `Θ(n²)` is specific to the two-move (take-ends) structure. The general bound is `Θ(#states × moves-per-state)`:

| Game | States | Moves/state | Time |
|------|--------|-------------|------|
| Predict the Winner / Stone Game I | `Θ(n²)` | `2` | `Θ(n²)` |
| Stone Game III (take 1/2/3 front) | `Θ(n)` | `3` | `Θ(n)` |
| Stone Game II (take 1..2M front) | `Θ(n²)` (`i × M`) | `O(M) = O(n)` | `O(n³)` |
| Coins-in-a-row | `Θ(n²)` | `2` | `Θ(n²)` |
| Divisor game (integer `N`) | `Θ(N)` | `O(#divisors)` | `O(N log N)` amortized |

**Stone Game II complexity, derived.** The state is `(i, M)` with `0 <= i <= n` and `1 <= M <= n` (since taking more than `n` piles is impossible, `M` is clamped to `n`). That is `O(n²)` states. From `(i, M)` the mover tries `x = 1, …, 2M` moves, `O(M) = O(n)` of them, each an `O(1)` suffix-sum lookup. Summing `O(M)` work over all `O(n)` values of `M` for each of the `O(n)` indices `i` gives `Σ_i Σ_M O(M) = O(n) · O(n²) = O(n³)` in the worst case. In practice the reachable `(i, M)` pairs are far fewer (`M` only grows when large takes occur), so the empirical cost is well below `n³`, but the worst-case bound is `O(n³)`. This derivation illustrates the universal rule `time = #states × moves-per-state` on a non-trivial state space.

**Remark (closed-form shortcut, Stone Game I).** For LeetCode 877 with an *even* number of piles and an *odd* total, the first player can always win without any DP: a parity/coloring argument shows player 1 can guarantee either all even-indexed or all odd-indexed piles, one of which has the larger sum. This `O(1)` shortcut is a reminder that the `O(n²)` DP, while general, is sometimes dominated by problem-specific structure — but the DP remains the correct fallback whenever such structure is absent (e.g., odd pile count, even total, or general "predict the winner").

**Theorem 6.4 (The parity strategy, proved).** In pick-from-ends with an *even* number `n = 2t` of coins, the first player can guarantee the larger of (sum of even-indexed coins) and (sum of odd-indexed coins).

**Proof.** Color positions alternately black (even index) and white (odd index); there are `t` of each. Initially the two exposed ends `0` (black) and `n−1` (white, since `n` even) have *different* colors. The first player commits to one color class, say the one with the larger sum, and always takes the end of that color. Crucially, after the first player takes a coin of their chosen color, the *new* pair of ends again has one of each color (the two ends of any even-length interval differ in parity, and removing one end of length-even leaves length-odd whose ends share parity — but the first player's move re-establishes the invariant on their next turn). A careful induction shows the second player can never "steal" a coin of the first player's chosen color, so the first player collects an entire color class. Choosing the larger class wins. ∎

This is a clean instance where a *combinatorial* argument supersedes the DP — but note it relies on `n` being even; for odd `n` no such guarantee exists and the full `O(n²)` DP is necessary. Knowing when structure replaces computation is a hallmark of theoretical maturity.

---

## 7. The Boolean (Win/Loss) Specialization

When the game has no payoff and only a win/loss outcome (last player to move wins, or the player who cannot move loses), the value collapses to a boolean.

**Definition 7.1.** `W(S) = true` iff the player to move at `S` can force a win.

**Theorem 7.2 (Boolean recurrence).** For a "normal-play" game (no move ⇒ lose),
```
W(S) = OR over legal moves m: S → S'  of  [ NOT W(S') ],
W(S) = false  if S is terminal (no move available).
```

**Proof.** The mover wins iff there exists a move to a state `S'` from which the *opponent* (now the mover) loses, i.e., `W(S') = false`. If every move leads to a state where the opponent wins, the mover loses. Terminal (no move) is a loss under normal play. This is the classic P-position/N-position recurrence. ∎

**Theorem 7.3 (Relation to the scored value).** The boolean game is the scored game with all gains `0` except a terminal `±∞` reward, or equivalently the indicator `W(S) = [D'(S) > 0]` where `D'` is the difference DP of a `+1`-per-win scoring. For a *single* game, `W(S) = [Grundy(S) > 0]` (Section 10), tying the boolean DP to Sprague-Grundy theory. ∎

**Worked P/N trace (Divisor Game, `N = 1..6`).** Label P-positions (previous player wins ⇒ mover loses) and N-positions (next/mover wins):

```
N=1: no move        → P (mover loses)
N=2: move to 1 (P)  → N (mover wins: leave opponent at losing 1)
N=3: only move →2(N)→ P (all moves go to N, mover loses)
N=4: move to 3 (P)  → N
N=5: only move →4(N)→ P
N=6: move to 5 (P)  → N
```

The pattern `P, N, P, N, P, N` for `N = 1, 2, 3, 4, 5, 6` confirms `W(N) = [N even]`. The boolean DP computes exactly this P/N labeling by the recurrence; the closed form is the *output*, not an assumption. This trace is the concrete realization of Theorem 7.2 and the standard combinatorial-game-theory P/N analysis.

**Worked example (Divisor Game, LeetCode 1025).** State `N`; move: choose `x` with `0 < x < N`, `N % x = 0`, go to `N − x`; no move (`N = 1`) loses. `W(1) = false`; `W(N) = OR_{x | N, x < N} [NOT W(N − x)]`. Induction proves `W(N) = [N even]`: if `N` is even, take `x = 1` (always a divisor) leaving odd `N−1`, and odd numbers are losing; if `N` is odd, every divisor `x` is odd, so `N − x` is even (winning for the opponent), leaving the mover no escape. The DP rediscovers this closed form mechanically.

**Theorem 7.4 (Misère and last-move conventions).** Under the **misère** convention (the player who makes the last move *loses*), the boolean recurrence becomes `W(S) = OR_m [NOT W(S')]` with the terminal flipped to `W(terminal) = true` (no move ⇒ you did not make the last move ⇒ you win). The structural recurrence is identical; only the base case changes. This sensitivity of the base case — not the recurrence — to the win convention is a common source of off-by-one outcome bugs, and is precisely why the senior-level checklist insists on writing the terminal case explicitly before the recurrence.

**Proof.** The interior logic ("I win iff some move puts the opponent in a losing state") is convention-independent; it only reroutes the meaning of "losing." Flipping which terminal is a win propagates the flip upward by the same induction as Theorem 7.2. ∎

---

## 8. Reconstruction of Optimal Play

**Theorem 8.1 (Move reconstruction).** Given the filled table `D`, an optimal move at state `(i, j)` is take-left iff `a[i] − D(i+1, j) >= a[j] − D(i, j−1)` (and take-right otherwise); following the achieving branch at each step yields an optimal play in `O(n)` time after the `O(n²)` fill.

**Proof.** By Theorem 2.1, `D(i, j)` equals the larger of the two branch values; the branch attaining the maximum is, by definition, a value-optimal move. Optimal substructure (Theorem 4.1) guarantees that continuing optimally from the resulting sub-state extends to an optimal play of the whole interval. Each reconstruction step shrinks the interval by one, so the walk has length `n`. Ties (`=`) may be broken arbitrarily; all maximizing branches are equally optimal. ∎

**Corollary 8.2 (Self-play consistency).** Simulating the game where both players follow the reconstructed optimal moves produces a final score difference exactly equal to `D(0, n−1)`. This is the basis of the senior-level self-play validation test (`senior.md` §6.2): a discrepancy localizes a reconstruction or fill bug.

**Theorem 8.3 (Multiplicity of optimal plays).** When `a[i] − D(i+1, j) = a[j] − D(i, j−1)` at some reachable state, both moves are optimal, and the set of optimal plays is a tree whose branching occurs exactly at such ties. All optimal plays attain the same value `D(0, n−1)` but may produce different *raw* per-player score breakdowns only if the game were non-zero-sum; for the zero-sum case the difference is invariant and (by conservation) so are the raw scores.

**Proof.** Each tie offers two value-equal continuations (both attain the `max`), so the optimal-play set branches there. Value invariance is immediate from the recurrence (both branches equal `D`). For zero-sum games, equal difference plus conserved total forces equal raw scores by Proposition 5.3, so the tie does not change the score breakdown — only the *sequence* of moves. ∎

This justifies the senior-level guidance that tie-breaking in reconstruction is arbitrary: any maximizing branch yields an optimal play, and for zero-sum games the reported scores are unaffected by the choice.

---

## 9. Beyond Zero-Sum: Per-Player Payoff Vectors

When the game is not zero-sum, the value of a state is a **vector** of optimal payoffs, one coordinate per player, under perfect-information best response.

**Definition 9.1.** For a `p`-player game, `V(S) ∈ ℝ^p` where `V(S)[q]` is player `q`'s optimal payoff from `S` assuming all players play best responses.

**Theorem 9.2 (Vector recurrence).** Let `π(S)` be the player to move. Then `V(S) = V(S* )+ e(m*)` where the mover chooses
```
m* = argmax_{m : S → S'} ( g(m) accruing to π(S)  +  V(S')[π(S)] ),
```
i.e., the move maximizing the mover's *own* coordinate, and `V(S)` is `V(S')` plus the move's gain added to the mover's coordinate. Terminal `V = 0`.

**Proof.** Under perfect information and rational self-interest, the mover selects the move that maximizes their own final payoff, anticipating that all subsequent movers do likewise (subgame-perfect equilibrium, solvable by backward induction in finite games — Zermelo/Kuhn). The recurrence is exactly this backward induction on the game DAG. ∎

**Remark.** When `p = 2` and the game is zero-sum, `V(S)[1] + V(S)[2] = Σ(S)` collapses the vector to the scalar `D(S) = V[π(S)] − V[other]`, recovering Theorem 2.1. The vector formulation is the strict generalization required when conservation fails (Theorem 5.2) — at the cost of storing `p` numbers per state. Subgame-perfect equilibrium is unique here because finite perfect-information games with no ties in payoffs have a unique backward-induction solution (Kuhn's theorem); ties are broken by a fixed rule.

### 9.1 Worked Non-Zero-Sum Instance

Consider pick-from-ends on `a = [4, 1]` with a bonus `B = 10` awarded to whoever takes the *last* coin. This breaks zero-sum: the total payoff is `4 + 1 + 10 = 15` only if the bonus is collected, but *who* collects it depends on play, so the difference is not a conserved-total split.

- Player 1 takes the right coin `1`: player 2 then takes `4` **and** the last-coin bonus `10`. Payoffs `(1, 14)`.
- Player 1 takes the left coin `4`: player 2 then takes `1` and the bonus `10`. Payoffs `(4, 11)`.

Player 1 maximizes their *own* coordinate, so takes `4`, ending `(4, 11)`. The difference scalar would have stored only `D = −7` in the first branch and `D = −7` in the second (both `−7`!), making the two branches indistinguishable — yet player 1 strictly prefers the second. This concretely demonstrates Theorem 5.2: equal differences, different totals, different optimal continuations, so the scalar is insufficient and the vector `(4, 11)` is mandatory.

### 9.2 Multi-Player Caveat: No Minimax Theorem

For `p >= 3` players the clean maximin = minimax guarantee (Proposition 3.3) is lost: a coalition of opponents could play to harm one player in ways no single "opponent" would, and equilibria need not be unique without a tie-breaking convention. Backward induction (Theorem 9.2) still yields *a* subgame-perfect equilibrium under a fixed deterministic tie-break, but the value is no longer a robust guarantee against arbitrary opponents — only against opponents who follow the same backward-induction logic. This is a theoretical boundary of the technique, not a bug; it is why the vast majority of "game DP" problems are stated for exactly two zero-sum players.

---

## 10. Relation to Grundy Theory and the Scoring/Impartial Divide

**Definition 10.1 (Impartial game).** A game is **impartial** if the set of legal moves from any state depends only on the state, not on which player is to move (both players have identical options). Nim is the archetype. Scoring games like Predict the Winner are *partisan* in payoff (each player accumulates their own score) even when the move set is symmetric.

**Theorem 10.2 (Sprague-Grundy, stated).** Every impartial normal-play game state `S` has a **Grundy number** `Grundy(S) = mex{ Grundy(S') : S → S' }`, and `W(S) = [Grundy(S) > 0]`. A **sum** of independent impartial games has Grundy value equal to the XOR of the components' Grundy values, and is a first-player win iff that XOR is nonzero. (Proof and full treatment: topic `15`.)

**Theorem 10.3 (Why scoring games do not decompose by XOR).** The XOR decomposition of Theorem 10.2 relies on the *outcome* (win/loss) being determined by parity-of-options structure (`mex`/XOR), which is invariant only for impartial, payoff-free games. A scoring game's value `D(S)` is a real number that does **not** satisfy `D(S₁ ⊕ S₂) = f(D(S₁), D(S₂))` for any fixed combinator `f` — the optimal interleaving of moves across two scoring subgames depends on the *magnitudes* of gains, not just per-game summaries.

**Proof (sketch / counterexample).** Consider two independent pick-from-ends games. The optimal global strategy may interleave moves between them (take the biggest available end across both), and the resulting global difference is generally not any fixed function of the two per-game differences `D(S₁), D(S₂)`: a large coin in game 1 can change whether the mover prefers a move in game 2. Hence no XOR-like (or other fixed) combinator exists, in contrast to the impartial case where `mex`/XOR is exact. The scoring game's lack of an outcome-only summary is precisely why it needs the full numeric DP and cannot be reduced to Grundy values. ∎

**The divide, summarized.**

| Property | Scoring game (this topic) | Impartial win/loss (topic `15`) |
|----------|---------------------------|---------------------------------|
| State value | Real difference `D(S)` | Grundy number (a nimber) |
| Combining independent games | No fixed combinator | XOR of Grundy values |
| Single-game outcome | `D(S) >= 0` ⇒ mover wins/ties | `Grundy(S) > 0` ⇒ mover wins |
| Underlying algorithm | Negamax DP (Section 3) | mex + XOR (Sprague-Grundy) |

The boolean win DP (Section 7) is the bridge: for a *single* game it equals `[Grundy > 0]`, but only Grundy theory generalizes it to *sums* of games, and only the scored DP captures numeric payoffs.

### 10.1 Why Greedy Fails: A Formal Statement

**Proposition 10.4.** The greedy "take the larger end" strategy is *not* optimal for the pick-from-ends game in general.

**Proof (counterexample).** On `a = [1, 5, 233, 7]`, greedy player 1 takes the right end `7` (since `7 > 1`), leaving `[1, 5, 233]`; player 2 then takes the right end `233`. Player 1's optimal-by-DP move is to take the *left* end `1`, leaving `[5, 233, 7]`, which forces player 2 into a position where, whatever they take, player 1 secures `233` next. The DP gives `D(0,3) > 0` (player 1 wins) while greedy yields a loss. Hence greedy is suboptimal. ∎

The deeper reason is that greedy is a *single-decision-maker* heuristic; it ignores that the opponent will respond adversarially. The DP's `max(... − D(...))` bakes the adversary into every decision. This is the formal content behind the senior-level insistence on keeping `[1,5,233,7]` as a regression test: it is a minimal witness separating greedy from optimal.

### 10.2 The Scoring/Impartial Boundary as a Modeling Decision

In practice the classification is made by inspecting two features of the game:

1. **Is there a numeric payoff that accumulates?** If yes → scoring game → numeric DP (this topic). If the only outcome is who makes the last move → win/loss → boolean DP or Grundy.
2. **Does the game split into independent sub-games whose moves do not interact?** If yes and it is win/loss → Grundy/XOR (topic `15`). If it is a single evolving game (one interval, one integer) → boolean DP suffices.

Misclassification is the most expensive theoretical error: applying XOR of "Grundy numbers" to a scoring game produces a number with no game-theoretic meaning, and modeling a scoring game as boolean throws away the payoff the problem asked for. The two features above resolve the classification deterministically.

### 10.3 A Tractability Landscape

The family of "optimal play" problems spans a sharp tractability boundary, governed entirely by the size of the minimal state:

| Problem | Minimal state | Complexity | Tool |
|---------|---------------|-----------|------|
| Pick-from-ends scoring | interval `(i, j)` | `O(n²)` | game DP (this topic) |
| Prefix-take scoring (Stone Game III) | front index `i` | `O(n)` | game DP |
| Single impartial win/loss game | game state | `O(\|Γ\|)` | boolean DP `= [Grundy>0]` |
| Sum of impartial win/loss games | per-component Grundy | `O(Σ \|Γ_c\|)` | Grundy + XOR (topic `15`) |
| Two-player game on a general graph, no revisits | `(vertex, visited-set)` | `O(2^V · V)` | exponential; outside DP regime |
| Large positional game (chess) | board configuration | exponential | minimax + alpha-beta (topic `16`) |

The first three rows are polynomial because the state is a bounded structured summary of the past; the last two are exponential because the state must encode an unbounded set (visited vertices) or an astronomically large configuration space. This boundary — *bounded structured state ⇒ polynomial; set-valued or configuration state ⇒ exponential* — is the single most important practical fact for deciding whether game DP even applies, and it mirrors the walk-vs-simple-path boundary in the matrix-exponentiation topic. The memoryless property (Definition 1.7) is exactly the formal condition that keeps a game on the polynomial side.

---

## 11. Generalized State Spaces and DAG Game DP

**Theorem 11.1 (DAG game DP).** Theorem 2.1's recurrence holds verbatim for *any* finite acyclic game (states `Γ`, move DAG `→`): `D(S) = max_{S → S'} [ g(S, S') − D(S') ]`, `D(terminal) = 0`, computed by reverse-topological order in `Θ(|Γ| + |→|)` time.

**Proof.** Acyclicity guarantees a topological order; processing states in reverse order ensures every `D(S')` is final before `D(S)` is computed. Correctness is the induction of Theorem 2.1 with "remaining moves" replaced by "longest path to a terminal," which is finite by acyclicity. ∎

**Cyclic games.** When the move graph has cycles (a state can recur), the value can be undefined (infinite play) unless a rule forces termination (e.g., a finite resource decreasing each move, or draw-by-repetition). Then one needs the theory of *games on graphs* — retrograde analysis / fixed-point iteration over win/draw/loss labels (for the boolean case) — which is beyond plain DP and lives in the broader game-on-graphs literature. The interval and prefix games of this topic are always acyclic (every move strictly shrinks the array), so Theorem 11.1 applies directly and the DP is well-defined.

**Complexity for the general DAG.** `Θ(|Γ| + |→|)` — linear in the size of the explicit game graph. The interval game's `Θ(n²)` is this bound with `|Γ| = Θ(n²)` states and `|→| = Θ(n²)` edges (two per state). This unifies all the variants: the only thing that changes between Predict the Winner, Stone Game II/III, and the divisor game is the size and shape of `(Γ, →)`.

### 11.1 Why Visited-Set Games Escape the DP Regime

The reason interval/prefix games stay polynomial is that their state is **memoryless** in the right sense: the optimal continuation depends only on the current interval (or front index), not on the order in which earlier coins were taken. If a game's legal moves or payoffs depend on the *set* of positions already used (e.g., a game on a general graph where you cannot revisit a vertex), the minimal state must encode that visited set — `Θ(2^V)` states — and the DAG is exponential. This is the same structural wall that separates polynomial walk-counting from #P-hard simple-path counting in the matrix-exponentiation topic: a non-local "no repeats" constraint destroys the small-state property that DP relies on. The diagnostic question for any new game is therefore: *does the optimal future depend on more than a bounded, structured summary of the past?* If yes, plain game DP does not apply.

### 11.2 Cyclic Games and Fixed-Point Iteration

When the move graph has cycles, `D` may be undefined (a player could loop forever), and one shifts from backward induction to **fixed-point** computation over the lattice of win/draw/loss labels (retrograde analysis):

```
label every terminal; then repeatedly:
  a state is a WIN if some move leads to a LOSS (for the opponent),
  a state is a LOSS if every move leads to a WIN,
  otherwise (cycle with no forced win/loss) it is a DRAW.
iterate to a fixed point.
```

This computes the boolean (win/draw/loss) outcome for cyclic perfect-information games in `Θ(|Γ| + |→|)` via a reverse-BFS (counting outgoing moves), and is the standard tool for endgame tablebases (e.g., chess endgames). Scored cyclic games require additional structure (a strictly decreasing potential, or a discount factor) to be well-defined. The acyclic games of this topic never need this machinery — but knowing where the boundary lies is what separates a senior practitioner from someone who applies plain DP where it silently fails.

---

### 11.3 The Universal Reduction, Restated

Every game in this topic is an instance of one template instantiated on a different finite acyclic `(Γ, →, g)`:

| Game | `Γ` (states) | moves from a state | `g(move)` | terminal |
|------|--------------|--------------------|-----------|----------|
| Predict the Winner / Stone Game I | intervals `(i, j)` | take left, take right | `a[i]` or `a[j]` | empty interval, `D = 0` |
| Stone Game III | front index `i` | take 1/2/3 front stones | sum of taken | `i = n`, `D = 0` |
| Stone Game II | `(i, M)` | take `1..2M` front piles | sum of taken | `i = n`, value `= 0` |
| Divisor game | integer `N` | `N → N − x`, `x ∣ N`, `x < N` | (boolean) | `N = 1`, lose |
| Coins-in-a-row | intervals `(i, j)` | take left, take right | `a[i]` or `a[j]` | empty interval |

Reading the table top to bottom is the senior modeling skill: identify `Γ`, the moves, the gains, and the terminal, then mechanically instantiate `D(S) = max_m [g(m) − D(S')]`. Nothing else changes. The proofs of Sections 2–8 apply verbatim because they were stated for an abstract `(Γ, →, g)`, not for the coin game specifically.

### 11.4 Relationship to Other Interval DPs

The score-difference recurrence is a member of the broader **interval-DP** family (matrix-chain multiplication, optimal BST, palindrome partitioning), all of which fill a triangular table by increasing interval length. The distinguishing feature of the *game* member is the **minus sign**: matrix-chain combines sub-intervals additively (`dp[i][k] + dp[k+1][j] + cost`), optimizing for a single decision-maker, whereas the game version *subtracts* the sub-interval's value because the sub-interval is played by the adversary. This single algebraic difference — additive (cooperative) vs subtractive (adversarial) combination — is what turns a one-player optimization into a two-player game, while leaving the `O(n²)` table structure and fill order untouched. Recognizing this lets you port any interval-DP scaffolding to a game by flipping the sign on the recursive term.

## 12. Worked End-to-End Derivation

To consolidate the theory, we derive the full solution of a fresh game from first principles, exercising every major theorem.

**Game.** Coins `a = [3, 9, 1, 2]`. Players alternate taking an end; both maximize their own total; player 1 first. Find the value, the winner, the raw scores, and an optimal play.

**Step 1 — Model `(Γ, →, g)` (Section 1, Table 11.3).** States are intervals `(i, j)`; moves take-left (gain `a[i]`) and take-right (gain `a[j]`); terminal is the empty interval with `D = 0`. This is a finite acyclic perfect-information zero-sum game, so Theorem 2.1 and Proposition 3.3 apply: a unique value exists.

**Step 2 — Fill the table by increasing length (Theorem 4.3).**

```
length 1 (base, Cor. of Thm 2.1):
  D(0,0)=3  D(1,1)=9  D(2,2)=1  D(3,3)=2
length 2:
  D(0,1)=max(3−9, 9−3)=max(−6,6)=6
  D(1,2)=max(9−1, 1−9)=max(8,−8)=8
  D(2,3)=max(1−2, 2−1)=max(−1,1)=1
length 3:
  D(0,2)=max(a0−D(1,2), a2−D(0,1))=max(3−8, 1−6)=max(−5,−5)=−5
  D(1,3)=max(a1−D(2,3), a3−D(1,2))=max(9−1, 2−8)=max(8,−6)=8
length 4:
  D(0,3)=max(a0−D(1,3), a3−D(0,2))=max(3−8, 2−(−5))=max(−5,7)=7   (take right)
```

**Step 3 — Read the value (Corollary 2.2, 2.4).** `D(0,3) = 7 > 0`, so player 1 wins, and `7` is the exact value player 1 can guarantee and the opponent can hold them to.

**Step 4 — Raw scores (Corollary 2.3, Proposition 5.3).** `Σ = 3+9+1+2 = 15`. Player 1 `= (15+7)/2 = 11`; player 2 `= (15−7)/2 = 4`. Parity check: `15` and `7` are both odd, so the halves are integers. ✓

**Step 5 — Reconstruct play (Theorem 8.1).** At `(0,3)`, take-right wins (`7 > −5`): P1 takes `a[3]=2`, banking `2`, interval `(0,2)`. At `(0,2)`, `D = −5`; both branches tie at `−5`, take left (tie-break): P2 takes `a[0]=3`, interval `(1,2)`. At `(1,2)`, `D = 8`, take-left: P1 takes `a[1]=9`, interval `(2,2)`. At `(2,2)`: P2 takes `a[2]=1`. Final: P1 `= 2+9 = 11`, P2 `= 3+1 = 4`. Self-play difference `11−4 = 7 = D(0,3)` (Corollary 8.2). ✓

**Step 6 — Note the greedy failure (Proposition 10.4).** Greedy P1 would take the larger end `a[1]`? No — greedy compares only the *current* ends `a[0]=3` vs `a[3]=2` and takes `3`, leaving `[9,1,2]`; P2 then grabs `9`. Greedy P1 ends with `3 + 2 = 5 < 11`. The DP's look-ahead (take the `2` to deny P2 the `9` on the wrong line) is what secures `11`. This single derivation exercises modeling (§1, §11.3), the recurrence and its base (§2), the fill order (§4.3), the value/score corollaries (§2.2–2.4, §5), reconstruction and self-play (§8), and the greedy contrast (§10.1).

## 13. Summary

- **Score-difference theorem (Section 2).** `D(S) = max_m [ g(m) − D(S') ]`, `D(terminal) = 0`, proved by induction on remaining moves. The mover's gain minus the opponent's optimal forced difference; player 1 wins iff `D(S₀) >= 0`, with raw scores `(Σ ± D)/2`.
- **Minimax/negamax equivalence (Section 3).** Game DP is memoized negamax: the alternating `max`/`min` of minimax becomes one recurrence with a sign flip, valid because the game is zero-sum. Topic `16` is the unbounded-tree version with alpha-beta; this topic is the polynomial-DAG special case.
- **Optimal substructure + overlapping subproblems (Section 4).** The two DP hallmarks: optimal sub-interval play is forced (exchange argument), and only `Θ(n²)` distinct states underlie a `Θ(2^n)` tree, so memoization gives polynomial time. Fill by increasing interval length (a valid topological order).
- **Zero-sum reduction (Section 5).** `D` plus the conserved total `Σ` determines both scores (`u,v = (Σ ± D)/2`), so one scalar suffices — and *only* under conservation; otherwise the per-player vector (Section 9) is necessary.
- **Complexity (Section 6).** `Θ(n²)` time/space for two-move interval games (`Θ(n)` space value-only); general bound `Θ(#states × moves/state)`, giving `Θ(n)` for Stone Game III and `O(n³)` for Stone Game II. Sometimes a closed form (Stone Game I parity) dominates.
- **Boolean specialization (Section 7).** Win/loss games use `W(S) = OR_m [NOT W(S')]`; for a single game `W = [Grundy > 0]`.
- **Reconstruction (Section 8).** Optimal moves are read off the table in `O(n)`; self-play must reproduce `D(0, n−1)` (validation).
- **Scoring vs impartial divide (Section 10).** Scoring games need the full numeric DP and do **not** decompose by XOR; Grundy theory (topic `15`) is for impartial win/loss games and their sums. The boolean DP is the bridge for a single game.
- **DAG generalization (Section 11).** The recurrence holds for any finite acyclic game in `Θ(|Γ| + |→|)`; interval/prefix games are always acyclic, so the DP is always well-defined.

### Complexity Cheat Table

| Task | Value type | Complexity | Notes |
|------|-----------|------------|-------|
| Predict the Winner / Stone Game I | difference scalar | `O(n²)` time, `O(n)`–`O(n²)` space | parity shortcut sometimes `O(1)` |
| Stone Game III | difference scalar | `O(n)` | 1-D state |
| Stone Game II | own-score / difference | `O(n³)` | clamp `M <= n` |
| Coins-in-a-row | difference scalar | `O(n²)` | same as Predict the Winner |
| Divisor / boolean win game | boolean | `O(N log N)` | `= [Grundy > 0]` single game |
| Non-zero-sum / >2 players | payoff vector | `Θ(|Γ| + |→|)` | subgame-perfect backward induction |
| Sum of impartial win/loss games | Grundy / XOR | per topic `15` | not this topic |

### Closing Notes

- **The subtraction is the theorem.** Every result here flows from `D(S) = max_m [g(m) − D(S')]`; the minus sign is the negamax negation that encodes the adversary. It is also exactly what distinguishes the *game* interval DP from cooperative interval DPs like matrix-chain (Section 11.4), which add rather than subtract sub-results.
- **Conservation is the license for one number.** Section 5 makes precise when the scalar suffices (zero-sum) and when the vector is mandatory (non-zero-sum, Section 9.1's worked counterexample), with the parity invariant (Proposition 5.3) doubling as a production assertion.
- **Optimal substructure rests on an exchange argument** (Section 4.2), and overlapping subproblems give a `Θ(2^n / n²)` memoization speedup (Section 4.1) — together the two DP hallmarks.
- **The scoring/impartial divide (Section 10) is the most consequential classification.** Scored ⇒ numeric DP (this topic); impartial win/loss ⇒ Grundy (topic `15`); large irregular tree ⇒ minimax + pruning (topic `16`); cyclic ⇒ retrograde fixed-point (Section 11.2); visited-set state ⇒ exponential, outside the DP regime (Section 11.1).
- **Closed forms sometimes dominate the DP** (Theorem 6.4's parity strategy for even `n`), but the `O(n²)` DP is the always-correct fallback when no such structure exists.
- **Perfect information is the silent prerequisite** (Section 3.3): it is what permits a single deterministic optimal move per state and hence a pure-strategy DP. Imperfect information forces mixed strategies and an LP, leaving the DP framework entirely.
- **The tractability boundary (Section 10.3) is governed by the minimal state.** Bounded structured state (interval, prefix, small integer) ⇒ polynomial game DP; set-valued or configuration state ⇒ exponential, where one falls back to Grundy decomposition (topic `15`), minimax with pruning (topic `16`), or accepts intractability. The memoryless property of Definition 1.7 is the formal gatekeeper.
- **The worked derivation of Section 12** ties the chain together end to end: model → fill → value → scores → reconstruct → contrast with greedy, each step invoking a specific theorem, demonstrating that the abstract machinery reduces to a mechanical procedure on any concrete instance.

### One-Sentence Takeaway

The entire theory of scored two-player optimal-play games collapses to: *measure value from the mover's perspective, take the best move's gain minus the adversary's forced response* — a single negated interval-DP recurrence whose correctness (induction), efficiency (overlapping subproblems), sufficiency (zero-sum conservation), and boundaries (perfect information, bounded state) are each a theorem proved above, and whose practical realization is a triangular table filled by increasing interval length.

Every other result in this document — negamax equivalence, the parity invariant, reconstruction, the scoring/impartial divide, the DAG generalization, the complexity bounds — is a corollary or a careful delineation of where that one sentence applies and where it does not. Mastering the boundary (zero-sum, perfect-information, finite-acyclic, bounded-state) is what separates correct application from silent misuse.

### Pointers to Sibling Theory

- **Topic `15` (Grundy / Sprague-Grundy):** the impartial-win/loss counterpart. The boolean specialization of Section 7 is the single-game bridge; Grundy's XOR is the multi-game generalization that scoring games provably lack (Theorem 10.3).
- **Topic `16` (Minimax):** the unbounded-tree counterpart. The negamax equivalence of Section 3 shows game DP *is* minimax; topic `16` adds alpha-beta pruning, iterative deepening, and heuristic evaluation for state spaces too large to tabulate.
- **Interval DP (within `13`):** matrix-chain multiplication, optimal BST, and palindrome partitioning share the triangular table and length-ordered fill (Theorem 4.3); they differ only in combining sub-results *additively* (cooperative) rather than *subtractively* (adversarial), as Section 11.4 makes precise.

These three sit at the corners of the design space — scored vs win/loss, single game vs sum of games, tabulable vs tree — and knowing which corner a problem occupies is the first and most consequential modeling decision.

### Theorem Index

For quick reference, the load-bearing results proved above:

- **Theorem 2.1** — the score-difference recurrence `D(S) = max_m [g(m) − D(S')]`, by induction on remaining moves.
- **Corollaries 2.2–2.4** — winner test, raw-score reconstruction, and the maximin = minimax value guarantee.
- **Theorem 3.2 / Proposition 3.3** — negamax equivalence to minimax, and existence/uniqueness of the value.
- **Theorems 4.1–4.3** — optimal substructure (exchange argument), overlapping subproblems (`2^n / n²` speedup), and the topological fill order.
- **Theorems 5.1–5.2 / Proposition 5.3** — sufficiency and necessity of the difference scalar (zero-sum), and the parity invariant.
- **Theorems 6.1–6.4** — `Θ(n²)` time/space, the `Θ(n)` space lower bound, move-set-dependent complexity, and the even-`n` parity strategy.
- **Theorems 7.2–7.4** — boolean win recurrence, its `[Grundy > 0]` identity, and misère/last-move conventions.
- **Theorems 8.1–8.3** — move reconstruction, self-play consistency, and multiplicity of optimal plays.
- **Theorem 9.2** — the per-player vector recurrence for non-zero-sum / multi-player games.
- **Theorems 10.2–10.4 / Proposition 10.4** — Sprague-Grundy statement, the no-XOR-for-scoring result, and the formal greedy-failure counterexample.
- **Theorem 11.1** — the general finite-acyclic DAG game DP in `Θ(|Γ| + |→|)`.

Foundational references: Zermelo (1913) and Kuhn (1953) on backward induction in finite perfect-information games; von Neumann (1928) for the minimax theorem (mixed strategies in the imperfect-information case); the negamax formulation of minimax (Knuth-Moore 1975 for alpha-beta); Sprague (1935) and Grundy (1939) for impartial games (topic `15`); Berlekamp-Conway-Guy, *Winning Ways for Your Mathematical Plays*, for the partisan/scoring vs impartial theory; CLRS for interval DP (matrix-chain multiplication, optimal BST). Sibling topics: `15-grundy-numbers`, `16-minimax`, and the other interval-DP problems within `13-dynamic-programming`.
