# Minimax and Alpha-Beta Pruning — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Minimax Value (Existence and Determinacy)
3. Negamax Equivalence
4. Alpha-Beta: Algorithm and Loop Invariants
5. Soundness of Cutoffs (Proof Alpha-Beta Returns the Minimax Value)
6. The Best-Case Bound O(b^(d/2)) Under Perfect Ordering
7. Average-Case and the Random-Ordering Bound
8. Game-Tree Complexity and Lower Bounds
9. Transposition Tables and the DAG View
10. Depth-Limited Search and Evaluation-Function Semantics
11. Connections: Zero-Sum Games, Determinacy, and DP
12. Summary

---

## 1. Formal Definitions

Let a finite, two-player, perfect-information, deterministic, zero-sum game be modeled by a **game tree** `T`.

**Definition 1.1 (Game tree).** `T = (N, E)` is a finite rooted tree. The root `r ∈ N` is the current position. Internal nodes are labeled by the player to move, alternating between **MAX** and **MIN** along every root-to-leaf path (a node at even depth from the root is MAX-to-move, at odd depth MIN-to-move, by convention). The children of a node `v`, written `children(v)`, correspond to the legal moves from `v`. **Leaves** are terminal positions (game over) or positions cut off by a depth limit.

**Definition 1.2 (Utility / evaluation).** A function `u : leaves(T) → ℝ` assigns each leaf a real value **from MAX's perspective**: larger is better for MAX, smaller for MIN. For a terminal leaf `u` is the exact game outcome (e.g. `+1` win / `0` draw / `−1` loss); for a depth-limited leaf `u` is a heuristic *estimate* `eval(·)`.

**Definition 1.3 (Branching factor and depth).** `b = max_v |children(v)|` is the maximum branching factor; `d` is the height of `T` (maximum leaf depth). The number of leaves is at most `b^d`.

**Definition 1.4 (Zero-sum).** The two players' payoffs sum to a constant; equivalently MIN's payoff is `−u`. This is what justifies a *single* value per node: a gain for one is exactly a loss for the other, so one number suffices to describe the contested outcome.

**Definition 1.5 (Strategy and value).** A **strategy** for a player is a function assigning, to each node where that player moves, a child (a move). Given strategies `σ_MAX, σ_MIN` for both players, play is deterministic and reaches a unique leaf `ℓ(σ_MAX, σ_MIN)`; its payoff is `u(ℓ(·))`. The **value** of the game is `max_{σ_MAX} min_{σ_MIN} u(ℓ) = min_{σ_MIN} max_{σ_MAX} u(ℓ)` — the two are equal for finite perfect-information zero-sum games (Theorem 2.3), which is *why* a single number `V(r)` is well-defined.

**Definition 1.6 (Principal variation).** The **principal variation (PV)** is the unique (modulo ties) root-to-leaf path obtained by following an optimal move at every node under `(σ_MAX*, σ_MIN*)`. Its leaf has value `V(r)`, and its first edge is the optimal move to play from the root. Production engines compute and report the PV, not just the scalar `V(r)`.

**Notation.** `V(v)` denotes the minimax value of node `v`. `[P]` is the Iverson bracket. We write `αβ(v, α, β)` for the value the alpha-beta procedure returns at node `v` with window `(α, β)`. "Perfect ordering" means at every node the first child searched is one attaining the node's minimax value.

**Standing assumptions.** Unless stated otherwise we assume the game is (i) **finite** (the tree has bounded height, enforced in practice by a depth limit or a repetition rule), (ii) **deterministic** (no chance nodes), (iii) **perfect-information** (no hidden state), and (iv) **two-player zero-sum** (so a single scalar `V` describes the contested outcome). Each assumption is load-bearing: chance nodes require *expectiminimax* (an expectation layer replaces some `max`/`min`), hidden information breaks the single-value model, and `n > 2` players require vector-valued payoffs (`max^n`). The clean theory below — determinacy, the `√b` bound, lossless pruning — is exactly the theory of this restricted but enormously important class.

---

## 2. The Minimax Value (Existence and Determinacy)

**Definition 2.1 (Minimax value).** Define `V : N → ℝ` recursively:

```
V(v) = u(v)                          if v is a leaf,
V(v) = max_{c ∈ children(v)} V(c)    if v is a MAX node,
V(v) = min_{c ∈ children(v)} V(c)    if v is a MIN node.
```

**Theorem 2.2 (Existence and uniqueness).** On a finite game tree, `V(v)` is well-defined and unique for every node `v`.

**Proof.** Induction on the height `h(v)` of the subtree at `v`. *Base* (`h = 0`): `v` is a leaf and `V(v) = u(v)` is given. *Step:* every child `c` has `h(c) < h(v)`, so by the inductive hypothesis each `V(c)` exists and is unique; `max`/`min` over the finite, nonempty set `{V(c)}` exists and is unique. By induction `V` is defined and unique on all of `N`. ∎

**Theorem 2.3 (Determinacy — the value is achievable).** `V(r)` is the payoff under optimal play: MAX has a strategy guaranteeing payoff `≥ V(r)`, and MIN has a strategy guaranteeing payoff `≤ V(r)`. Hence the game has a determined value, and `V(r)` is it.

**Proof sketch.** This is Zermelo's theorem specialized to a finite zero-sum tree. Construct MAX's strategy by always moving to a child attaining the `max` at MAX nodes; by induction the resulting leaf has value `≥ V(r)` regardless of MIN's play, because at each MIN node the actual outcome is `≥ min = V` of that node and MAX's choices preserve the bound. The symmetric construction gives MIN a strategy forcing `≤ V(r)`. The two bounds coincide, so the value is exactly `V(r)`. ∎

The practical content of Theorem 2.3: the number minimax computes is not a heuristic — when the tree is searched to true terminals, it is the **game-theoretic value** of the position, and each player has a concrete optimal strategy realizing it.

**Corollary 2.4 (Tic-tac-toe is a draw).** The minimax value of the empty tic-tac-toe position is `0`. By Theorem 2.3, neither player can force a win: the first player has a strategy guaranteeing at least a draw (value `≥ 0`) and the second has one guaranteeing at most a draw (value `≤ 0`), and the two bounds meet at `0`. This is why every correct tic-tac-toe engine returns `0` from the empty board — it is a theorem about the game, not an artifact of the search.

This corollary also serves as the canonical *correctness oracle*: any minimax/alpha-beta/negamax implementation that returns a nonzero value from the empty tic-tac-toe board has a bug, full stop. It is the cheapest, most decisive sanity check in the entire topic, which is why every code example and task in this topic family uses it.

**On strategy extraction.** The proof of Theorem 2.3 is *constructive*: at each MAX node take an argmax child, at each MIN node accept any child (the opponent chooses). Following the argmax pointers from the root yields the **principal variation** — the sequence of optimal moves under best play by both sides. Production engines store the first move of the PV at each node (the TT `best_move`) both to play it and to order the next iteration's search (Section 9). Thus the same data structure that records the *value* also records the optimal *strategy*.

### 2.1 Worked Value Computation

Take the depth-2 tree (root MAX over MIN nodes `A, B, C`; leaves from MAX's view):

```
            MAX root
        /      |      \
      A(MIN)  B(MIN)  C(MIN)
     /|\      /|\      /|\
    3 5 6    1 2 0    9 7 8
```

Bottom-up by Definition 2.1: `V(A) = min(3,5,6) = 3`, `V(B) = min(1,2,0) = 0`, `V(C) = min(9,7,8) = 7`, and `V(root) = max(3,0,7) = 7`. The principal variation is `root → C → (the leaf valued 7)`: MAX moves to `C`, MIN replies with the `7`-leaf (its minimizing choice). By Theorem 2.3, MAX can guarantee `≥ 7` (by choosing `C`) and MIN can guarantee `≤ 7` (by replying optimally in `C`), so `7` is the game value of this position — achievable, not estimated. This is the same tree alpha-beta processes in Section 5.1, where it reaches the identical `7` while skipping two leaves.

---

## 3. Negamax Equivalence

Negamax rewrites the MAX/MIN recursion as a single maximization using values measured **from the side to move**.

**Definition 3.1 (Side-relative value).** For a node `v` with side-to-move `s ∈ {MAX, MIN}`, define `N(v) = V(v)` if `s = MAX` and `N(v) = −V(v)` if `s = MIN`. Equivalently, `N(v)` is the value of the position from the perspective of whoever is about to move.

**Theorem 3.2 (Negamax recurrence).** For every internal node `v`,

```
N(v) = max_{c ∈ children(v)} ( − N(c) ).
```

**Proof.** Two cases. If `v` is a MAX node, `N(v) = V(v) = max_c V(c)`. Each child `c` is a MIN node, so `N(c) = −V(c)`, i.e. `V(c) = −N(c)`. Thus `N(v) = max_c (−N(c))`. If `v` is a MIN node, `N(v) = −V(v) = −min_c V(c) = max_c (−V(c))`; each child `c` is a MAX node with `N(c) = V(c)`, so `N(v) = max_c (−N(c))`. Both cases give the same formula. ∎

The identity `min(a, b) = −max(−a, −b)` is the algebraic heart: negating values turns minimization into maximization, so one branch handles both players. The corresponding window transform is `(α, β) ↦ (−β, −α)`: the child reports a negated value, so its useful window is the negated, swapped interval. This is exactly the `−negamax(child, −β, −α)` of the implementation, and Theorem 3.2 proves it computes the same `V` as Definition 2.1.

### 3.1 Worked Negamax Verification

Take the depth-2 tree of the junior walkthrough: a MAX root over three MIN nodes `A, B, C` with leaf values `A = {3,5,6}`, `B = {1,2,0}`, `C = {9,7,8}` (from MAX's perspective). In the MAX/MIN formulation `V(A) = 3`, `V(B) = 0`, `V(C) = 7`, and `V(root) = max(3,0,7) = 7`.

Now in negamax. The root is MAX so `N(root) = V(root)`; the MIN nodes have `N(A) = −V(A) = −3`, `N(B) = 0`, `N(C) = −7`; and the leaves, being MAX-side from their own (about-to-move) perspective at depth 2... here it is cleaner to track the *negated* values the recurrence manipulates. The negamax recurrence `N(v) = max_c(−N(c))` gives, at each MIN node, the side-relative value `N(A) = max(−3, −5, −6) = −3` (the leaves' utilities are already side-relative at the frontier with the sign convention that a leaf reports its value from the mover's view). At the root, `N(root) = max(−N(A), −N(B), −N(C)) = max(3, 0, 7) = 7`. The number matches `V(root) = 7` exactly, confirming Theorem 3.2: the single maximizing branch with negation reproduces the MAX/MIN value. The bookkeeping difference is purely a sign convention; the computed root value is invariant.

### 3.2 Why Negamax Is Less Error-Prone

The MAX/MIN form duplicates the loop body with inverted comparisons (`max` vs `min`), inverted bound updates (`α := max(α, g)` vs `β := min(β, g)`), and inverted cutoff tests (`α ≥ β` vs `β ≤ α`). Each inversion is an independent opportunity for a sign or comparison bug, and the two branches can drift out of sync during edits. Negamax collapses all of this into one branch whose only "trick" is the `−negamax(child, −β, −α)` call. The formal guarantee (Theorem 3.2) means the collapse is *not* an approximation or a special case — it is an exact rewriting, valid for every game tree. Production engines universally adopt it for exactly this reason: fewer code paths, fewer sign bugs, identical values.

---

## 4. Alpha-Beta: Algorithm and Loop Invariants

**Algorithm (fail-soft, MAX/MIN form).**

```
ALPHABETA(v, α, β):
  if v is leaf: return u(v)
  if v is MAX:
    g := −∞
    for c in children(v):
      g := max(g, ALPHABETA(c, α, β))
      α := max(α, g)
      if α ≥ β: break            # beta cutoff
    return g
  else  # v is MIN:
    g := +∞
    for c in children(v):
      g := min(g, ALPHABETA(c, α, β))
      β := min(β, g)
      if β ≤ α: break            # alpha cutoff
    return g
```

The window `(α, β)` is an *interval of relevance*. The key claim is that the value returned is either the exact minimax value (when it lies in the open window) or a *correct bound* (when it lies outside), and that the root value with window `(−∞, +∞)` is exact.

**Lemma 4.1 (Window semantics).** Let `g = ALPHABETA(v, α, β)`. Then:
- if `α < V(v) < β`, then `g = V(v)` (exact);
- if `V(v) ≤ α`, then `g ≤ α` and `g ≤ V(v)` is a valid upper bound (`g ≥ V(v)` need not hold, but `g` certifies `V(v) ≤ α`);
- if `V(v) ≥ β`, then `g ≥ β` and `g` certifies `V(v) ≥ β`.

(For the fail-soft variant the returned `g` additionally satisfies `g ≤ V(v)` when failing low and `g ≥ V(v)` when failing high, giving tighter usable bounds. The classical fail-hard variant clamps `g` to `[α, β]`.)

**Loop invariant (MAX node).** At the top of each iteration of the `for c in children(v)` loop, with `g` the running best and `α'` the running alpha:
1. `α' = max(α, g)` — alpha tracks the best MAX has secured so far at this node (never below the inherited `α`).
2. `g` equals the max of the (in-window or bounded) values of the children processed so far.
3. If the loop has not cut off, `α' < β` still holds (the window is open).

When a child is searched with `(α', β)` and returns a value `≥ β`, invariant (1) pushes `α'` to `≥ β`, the loop tests `α' ≥ β` and breaks — this is the beta cutoff. The dual invariant governs MIN nodes with `β'` decreasing. These invariants are what the soundness proof (Section 5) formalizes into the exactness guarantee.

**Fail-hard vs fail-soft, formally.** Both variants are correct (return `V(r)` at the root) but differ in what they report on a fail:
- *Fail-hard* returns `α` on a fail-low and `β` on a fail-high — values clamped to the window. Simpler, classic.
- *Fail-soft* returns the actual extreme value found (which may be `< α` or `> β`). This is a *tighter* bound: a fail-soft fail-low returning `g < α` certifies `V(v) ≤ g ≤ α`, strictly more information than fail-hard's `V(v) ≤ α`.

The extra tightness matters for transposition tables (a tighter stored bound prunes more on reuse) and aspiration windows (a tighter fail tells you how far to widen). Strong engines use fail-soft for exactly this reason; the correctness proof (Theorem 5.1) covers both, since the *in-window* case is identical and only the *out-of-window* return value differs, never affecting the root.

We prove the central case (exactness in-window) next, which is what makes alpha-beta a correct minimax solver.

---

## 5. Soundness of Cutoffs (Proof Alpha-Beta Returns the Minimax Value)

**Theorem 5.1 (Correctness of alpha-beta).** For every node `v` and every window with `α < β`, if `α < V(v) < β` then `ALPHABETA(v, α, β) = V(v)`. In particular `ALPHABETA(r, −∞, +∞) = V(r)`: the root value equals the true minimax value.

**Proof.** Induction on the height `h(v)`.

*Base (`h = 0`).* `v` is a leaf; the procedure returns `u(v) = V(v)` regardless of the window. ∎(base)

*Inductive step.* Assume the claim for all nodes of smaller height. Take a MAX node `v` with `α < V(v) < β` (the MIN case is symmetric, or follows from negamax). Let `c_1, …, c_m` be its children in search order, and recall `V(v) = max_i V(c_i)`. The procedure maintains a running `g` and a running `α' ≥ α` (it only ever increases). We track two facts as the loop runs:

1. **`g` never exceeds `V(v)` and equals the best child value seen so far in the relevant sense.** Initially `g = −∞`. After processing child `c_i`, `g = max(g_prev, ALPHABETA(c_i, α', β))`.

2. **No cutoff discards a child that would change `V(v)`.** Suppose a beta cutoff fires at child `c_i`: this means after updating, `α' ≥ β`, i.e. the value returned by `c_i` is `≥ β > V(v)`. We claim this can only happen when `V(c_i) ≥ β`. Indeed, by the inductive hypothesis applied to `c_i` with window `(α'_{prev}, β)`: if `V(c_i)` were `< β`, the recursive call would return either `V(c_i)` (if also `> α'_{prev}`) or a value `≤ α'_{prev} < β`, neither of which can push `α'` to `≥ β`. So a cutoff implies `V(c_i) ≥ β > V(v)`. But `V(v) = max_j V(c_j) ≥ V(c_i) ≥ β`, contradicting `V(v) < β`. **Therefore, under the hypothesis `V(v) < β`, no beta cutoff occurs at `v`** — every child is examined.

Since every child is examined and each is searched with a window whose lower end `α'` never exceeds `V(v)` (we show `α' < β` throughout, so the windows stay open around the eventual maximum), consider the child `c*` attaining `V(c*) = V(v)`. When `c*` is searched, its window `(α'_{at c*}, β)` satisfies `α'_{at c*} < V(v) = V(c*) < β` (lower end is some value `< V(v)` since no earlier child reached `V(v)` strictly above, and `V(v) < β` by assumption). By the inductive hypothesis, the call returns exactly `V(c*) = V(v)`, so `g` attains `V(v)`. No child returns more than `V(v)` that survives as the max (any child with `V(c_i) ≥ β` would have triggered the impossible cutoff; all others have `V(c_i) ≤ V(v)`). Hence `g = V(v)` at loop end, and the procedure returns `V(v)`.

The MIN case is identical with the roles of `α`/`β`, `max`/`min`, and the inequalities reversed (or invoke Theorem 3.2 to reduce MIN to MAX).

Spelling out the MIN dual for completeness: at a MIN node `v` with `α < V(v) < β`, a cutoff (`β' ≤ α`) would require a child returning `≤ α`, implying `V(c_i) ≤ α`, hence `V(v) = min_j V(c_j) ≤ α`, contradicting `α < V(v)`. So no alpha cutoff fires, every child is examined, the minimizing child `c*` with `V(c*) = V(v)` is searched in an open window and returns exactly `V(v)`, and `min` produces `V(v)`. By induction the theorem holds for all nodes, and applying it at the root with `(−∞, +∞)` — which trivially satisfies `−∞ < V(r) < +∞` — gives `ALPHABETA(r, −∞, +∞) = V(r)`. ∎

**Why the open-window assumption at the root is automatic.** The root call uses `(−∞, +∞)`. Since `V(r)` is a finite real (a leaf utility, by Theorem 2.2), `−∞ < V(r) < +∞` holds vacuously, so the in-window case of Theorem 5.1 applies and the root value is exact. Sub-calls may receive *narrow* windows that do *not* contain their node's value — those return bounds, not exact values — but the root, with the maximal window, always returns the exact minimax value. This asymmetry (exact at the root, bounds within) is the precise sense in which alpha-beta "computes the value while only bounding most internal nodes," and it is what makes bound-storage in transposition tables both necessary and sound.

**Corollary 5.2 (Lossless pruning).** Alpha-beta and plain minimax compute identical root values for every game tree and every leaf labeling. Pruning removes only nodes whose values cannot affect `V(r)`; it never changes the answer. This is the formal guarantee behind the engineering claim "alpha-beta is a speedup, not an approximation."

**Corollary 5.3 (Order-independence of the value).** The root value `ALPHABETA(r, −∞, +∞)` is independent of the order in which children are searched at every node. Different orders examine different *sets* of nodes (and prune different branches), but all yield the same `V(r)` by Theorem 5.1. This is why move ordering is purely a *performance* lever: it changes how much is pruned, never what is computed. An engineer can therefore reorder moves freely (TT move, killers, history) with zero risk to correctness — a rare and valuable guarantee, and the reason ordering heuristics can be aggressive and heuristic without endangering the result.

**Remark (what a cutoff certifies).** A beta cutoff at a MAX node `v` does **not** establish `V(v)`; it establishes the *bound* `V(v) ≥ β`. That bound is exactly enough information for `v`'s MIN parent: the parent is taking a `min`, already has an option valued `≤ β` (that is what set `β`), and so will never select `v`. The unexamined children of `v` are irrelevant precisely because the parent's decision is already determined. This is why bound-only returns (and their storage in transposition tables, Section 9) are sound.

### 5.1 Worked Cutoff Trace

Run `ALPHABETA(root, −∞, +∞)` on the `A = {3,5,6}`, `B = {1,2,0}`, `C = {9,7,8}` tree of Section 3.1 (root MAX, children MIN), left to right:

```
root (MAX, α=−∞, β=+∞)
  → A (MIN, α=−∞, β=+∞)
      leaf 3 → β=3 ;  leaf 5 (≥β? no) ;  leaf 6 (no) → A returns 3
    root: best=3, α=max(−∞,3)=3
  → B (MIN, α=3, β=+∞)
      leaf 1 → β=1 ;  now β=1 ≤ α=3  →  ALPHA-CUTOFF
      skip leaves 2, 0 ;  B returns 1   (a bound: V(B) ≤ 1)
    root: best=max(3,1)=3, α=3
  → C (MIN, α=3, β=+∞)
      leaf 9 → β=9 ;  leaf 7 → β=7 ;  leaf 8 (no) → C returns 7
    root: best=max(3,7)=7, α=7
root returns 7
```

The cutoff at `B` fired because once MIN there forced the value to `1 ≤ α = 3`, MAX (root) would never prefer `B` over the `3` already secured from `A`. Leaves `2` and `0` were never evaluated, and the value `B` returned (`1`) is merely an *upper bound* on `V(B) = 0` — yet the root value `7` is exactly the plain-minimax value (Theorem 5.1). This trace instantiates the soundness proof: the unexamined leaves cannot raise `V(B)` above `1`, and `1 < 3 ≤ V(root)`, so they are provably irrelevant to the root decision.

**Counting saved work.** This tree has `9` leaves; the search evaluated `7` (it skipped `2` and `0`). With `b = 3, d = 2`, the Knuth-Moore best case is `3^1 + 3^1 − 1 = 5` leaves — we did not hit it because the ordering was not perfect (had `C` been searched second and yielded a higher first child, more could prune). The gap between `5` (optimal) and `7` (this run) is exactly the cost of imperfect ordering, the phenomenon Section 7 quantifies in expectation.

---

## 6. The Best-Case Bound O(b^(d/2)) Under Perfect Ordering

We now derive Knuth and Moore's classical result: with optimal move ordering, alpha-beta examines on the order of `b^{⌈d/2⌉} + b^{⌊d/2⌋} − 1` leaves — the square root of the full `b^d`.

**The complexity measure.** We count *leaf evaluations*, the dominant cost (each leaf calls the evaluation function or returns a terminal score). Internal-node bookkeeping is `O(1)` per node and proportional to the leaves examined, so leaf count is the right metric. Plain minimax always pays `b^d` (every leaf); Theorem 6.2 quantifies how few a perfectly-ordered, correctly-pruning search can get away with.

**Setup.** Assume a uniform tree: every internal node has exactly `b` children, all leaves at depth `d`. "Perfect ordering" means at every node the first child searched attains the node's minimax value (for a MAX node, a maximizing child; for a MIN node, a minimizing child).

**Definition 6.1 (Node types, Knuth-Moore).** Classify nodes by their role in the minimal proof tree:
- **Type 1 (PV nodes):** the root and, recursively, the *first* child of every Type-1 node. These lie on the principal variation; all their children must be examined.
- **Type 2 (CUT nodes):** the non-first children of Type-1 nodes, and the first child of every Type-3 node. At a Type-2 node, examining the *first* child suffices to produce a cutoff (it provably fails high/low against the inherited bound).
- **Type 3 (ALL nodes):** the non-first children of Type-2 nodes. At a Type-3 node, *all* children must be examined (each is a CUT node that needs only its first child).

**Theorem 6.2 (Knuth-Moore).** With perfect ordering on a uniform `(b, d)` tree, the number of leaves examined is

```
L(b, d) = b^{⌈d/2⌉} + b^{⌊d/2⌋} − 1.
```

**Proof (recurrence over the type structure).** Let `L1(h)`, `L2(h)`, `L3(h)` be the leaves examined in a height-`h` subtree rooted at a Type-1, Type-2, Type-3 node respectively (with perfect ordering). Reading off Definition 6.1:

- A **Type-1** node examines all `b` children: its first child is Type-1, the remaining `b−1` are Type-2 (CUT, refuting alternatives to the PV). So
  `L1(h) = L1(h−1) + (b−1)·L2(h−1).`
- A **Type-2** (CUT) node needs only its first child, which is a Type-3 node (with perfect ordering the best refutation comes first and causes the cutoff):
  `L2(h) = L3(h−1).`
- A **Type-3** (ALL) node examines all `b` children, each a Type-2 (CUT) node:
  `L3(h) = b·L2(h−1).`

Combining the last two: `L2(h) = L3(h−1) = b·L2(h−2)`, so `L2` grows by a factor `b` every **two** levels:
`L2(h) = b^{⌊h/2⌋}` (with `L2(0) = 1`, a single leaf).

Substitute into `L1`: the PV contributes one Type-1 chain plus, at each level, `(b−1)` CUT subtrees whose sizes are powers of `b^{1/2}`. Summing the geometric contributions over the `d` levels and collecting terms yields the closed form
`L1(d) = b^{⌈d/2⌉} + b^{⌊d/2⌋} − 1.` ∎

**The recurrence solved step by step.** Unrolling `L2(h) = b·L2(h−2)` from `L2(0)=1, L2(1)=L3(0)=1`:

```
L2(0)=1,  L2(1)=1,  L2(2)=b,  L2(3)=b,  L2(4)=b²,  L2(5)=b²,  …  →  L2(h)=b^{⌊h/2⌋}.
L3(h)=b·L2(h−1)=b·b^{⌊(h−1)/2⌋}=b^{⌈h/2⌉}.
L1(h)=L1(h−1)+(b−1)·L2(h−1):  this telescopes; substituting L2(h−1)=b^{⌊(h−1)/2⌋}
      and summing the geometric series in √b yields L1(d)=b^{⌈d/2⌉}+b^{⌊d/2⌋}−1.
```

The key arithmetic fact is `L2`'s **two-level periodicity**: a CUT node needs one child (an ALL node), which needs `b` children (CUT nodes), so the population multiplies by `b` only every *second* level. That single structural fact — one cheap level per expensive level — is the entire reason the exponent halves to `d/2`.

**Corollary 6.3 (Effective branching factor).** `L(b, d) = Θ(b^{d/2})`, so the *effective* branching factor with perfect ordering is `√b`. The number of leaves searched to depth `d` equals (asymptotically) the number a full search would reach at depth `d/2`: **good ordering doubles the searchable depth** for a fixed leaf budget.

For chess (`b ≈ 35`), `√b ≈ 5.9`: a well-ordered engine effectively branches by ~6, not 35, per ply — the difference between reaching depth 8 and depth 16 in the same node budget. This single factor, more than any constant-factor optimization, is why move-ordering research (TT move, killers, history, captures-first) has dominated practical engine work for decades. The `√b` law is not a microscopic tuning gain; it is the macroscopic reason alpha-beta engines can see twice as far as their raw node count would suggest.

**A note on the assumptions.** Theorem 6.2 assumes a *uniform* tree (constant `b`, all leaves at depth `d`) and *perfect* ordering. Real trees have variable branching and imperfect ordering, so the bound is an idealized lower envelope, not a guarantee. Its value is as a *target*: an engine whose measured effective branching factor approaches `√b` is ordering near-optimally; one stuck near `b` has an ordering bug or a hard position. The bound also assumes distinct leaf values; with ties, the `≥` vs `>` choice in the cutoff test (`α ≥ β`) determines whether equal-valued branches prune, a constant-factor effect.

**Interpretation.** The mechanism is the asymmetry between CUT and ALL nodes. On the principal-variation skeleton, half the levels are "cheap" (CUT nodes resolved by a single child) and half are "expensive" (ALL nodes examining all `b`). The cheap and expensive levels alternate, so the product of branching factors over a root-to-leaf path is `b · 1 · b · 1 · … ≈ b^{d/2}`.

### 6.1 Worked Best-Case Count

Take `b = 3, d = 4` (so the full tree has `3^4 = 81` leaves). Knuth-Moore predicts
`L(3, 4) = 3^{⌈4/2⌉} + 3^{⌊4/2⌋} − 1 = 3^2 + 3^2 − 1 = 9 + 9 − 1 = 17` leaves under perfect ordering.

Contrast: plain minimax examines all `81`; alpha-beta with perfect ordering examines `17` — about `21%`. The effective branching factor is `81^{1/4} = 3` for full search but `17 ≈ 3^{1.3} ≈ (√3)^{4} · const`, i.e. the per-level multiplier is `√3 ≈ 1.73` rather than `3`. Doubling the depth budget: a depth-8 perfectly-ordered search costs `L(3, 8) = 3^4 + 3^4 − 1 = 161` leaves, fewer than the `81` leaves of a *depth-4 full* search would suggest is impossible — the point being that for the same leaf budget you reach roughly twice the depth.

### 6.2 The CUT/ALL Skeleton Made Concrete

For the `b = 3, d = 4` tree, label the root Type-1. Its first child (Type-1) continues the PV; its other two children are Type-2 (CUT). Each Type-2 node examines only its first child, a Type-3 (ALL) node, which examines all 3 of its Type-2 children, and so on. Tracing the recursion:

```
Type-1 chain:  root → c0 → c00 → c000   (4 PV nodes, the principal variation)
At each PV level, (b−1)=2 CUT siblings branch off.
A CUT node spawns 1 ALL child; an ALL node spawns b=3 CUT children.
```

Counting leaves reached by this structure yields exactly the 17 of Section 6.1. The "every other level is free" intuition is literally the alternation `CUT (1 child) → ALL (b children) → CUT (1 child) → …` along non-PV paths.

**Why the cost measure is leaf evaluations.** Each leaf triggers an evaluation-function call (or a terminal-score lookup), the dominant per-node cost in any real engine. Internal nodes do `O(1)` bookkeeping (a `max`/`min` update, a bound comparison) per child examined, and the number of internal-node operations is proportional to the leaf count. So the runtime is `Θ(leaves) × (eval cost) + Θ(leaves) × (move-gen + bookkeeping)`, i.e. `Θ(leaves)` up to a constant. The whole game is therefore to *minimize the leaf count* — precisely what Theorem 6.2 quantifies and what move ordering (Section 7) delivers in practice.

### 6.3 Aspiration Windows and the Bound

The `b^{d/2}` count assumes a *full* window `(−∞, +∞)` at the root. **Aspiration search** starts the root with a *narrow* window `(v₀ − δ, v₀ + δ)` centered on the previous iteration's value `v₀`. If `V(r)` lands inside, the narrow window prunes even more aggressively than a full window (the bounds are tighter from the start, so cutoffs fire sooner). If `V(r)` lands outside (a fail), the search must re-run with a widened window, wasting the first attempt. The expected payoff is positive when `v₀` is a good predictor of `V(r)` — which iterative deepening makes true, since consecutive depths usually yield similar values. Formally, aspiration does not change the *worst-case* `b^{d/2}` bound but improves the *constant* in the common case, and it composes with the proof tree of Theorem 8.1: a correct narrow-window search still examines a superset of the proof tree, just with smaller windows on the CUT nodes.

---

## 7. Average-Case and the Random-Ordering Bound

Perfect ordering is unattainable in practice; how does alpha-beta behave with *random* move ordering?

**Theorem 7.1 (Random ordering, asymptotic).** If children are searched in uniformly random order, the expected number of leaves examined on a uniform `(b, d)` tree grows like `Θ((b / log b)^d)` for large `b` (Pearl 1980), and a commonly cited engineering approximation for moderate `b` is `O(b^{3d/4})`.

**Proof idea (Pearl).** Model the tree with i.i.d. continuous leaf values. A node causes a cutoff when an early child's value crosses the inherited bound. The probability that the `i`-th child is the first to exceed a threshold, integrated over the value distribution, yields a branching recurrence whose solution is the `b/ln b` effective branching factor. The detailed analysis uses the theory of the "expected number of probes until a record" and order statistics of the leaf values. ∎

**Practical reading.** Even *random* ordering already beats plain minimax substantially (`(b/log b)^d ≪ b^d`). Good ordering heuristics (transposition-table move, killers, history; see [`middle.md`](./middle.md)) push the observed effective branching factor from `b` toward the `√b` ideal. Engines measure the **effective branching factor** `EBF = nodes(d)/nodes(d−1)` and the **first-move cutoff rate**; an `EBF` near `√b` indicates near-optimal ordering.

### 7.1 Quantifying the Three Regimes

For a uniform `(b, d)` tree, the three orderings give leaf counts spanning two orders of magnitude even at modest depth. With `b = 8`:

| `d` | Full / worst `b^d` | Random ~`b^{3d/4}` | Perfect `b^{d/2}` |
|-----|--------------------|--------------------|-------------------|
| 4 | 4 096 | 512 | 64 |
| 6 | 262 144 | 11 585 | 512 |
| 8 | 16 777 216 | 262 144 | 4 096 |
| 10 | 1 073 741 824 | 5 931 642 | 32 768 |

The random column uses the engineering approximation `b^{3d/4}`; Pearl's exact `(b/ln b)^d` is slightly smaller for large `b`. The decisive observation is that the *exponent*, not the base, is what good ordering attacks: moving from `b^d` to `b^{d/2}` halves the exponent, and no constant-factor optimization (faster eval, better data layout) can compete with that asymptotic shift. This is the formal justification for the engineering maxim "invest in move ordering before anything else."

### 7.1b Worked Random-Ordering Outcome

Return to the `A={3,5,6}`, `B={1,2,0}`, `C={9,7,8}` tree. The Section 5.1 trace used the order `A, B, C` and evaluated 7 of 9 leaves. Now permute the root's children to `B, A, C`:

```
root → B (MIN, α=−∞,β=+∞): leaves 1,2,0 → β bottoms at 0 → B returns 0; root α=0
     → A (MIN, α=0,β=+∞):  leaf 3 → β=3 ; leaf 5; leaf 6 → A returns 3; root α=3
     → C (MIN, α=3,β=+∞):  leaf 9 → β=9 ; leaf 7 → β=7 ; leaf 8 → C returns 7; root α=7
root returns 7.
```

This order evaluated **all 9** leaves — no cutoff fired, because `B`'s low value `0` set a weak `α=0` that pruned nothing. The order `C, A, B` would instead establish `α=7` early and prune hard. Same value (`7`) in every order; the *work* ranges from 5 (perfect) to 9 (worst) leaves on this single 9-leaf tree. Averaged over all `3! = 6` root orderings (times the orderings within each MIN node), the expected leaf count is what Theorem 7.1 estimates asymptotically — and it sits strictly between the perfect `5` and the worst `9`, exactly as `b^{3d/4}` sits between `b^{d/2}` and `b^d`.

### 7.2 Where the Random Bound Comes From (sketch)

Model each leaf value as an independent draw from a continuous distribution. At a CUT node, the search stops as soon as a child's value crosses the inherited bound. The expected number of children examined before the first crossing is governed by the order statistics of the value distribution: if the bound is at quantile `q`, the expected index of the first child exceeding it is `1/(1−q)`. Integrating this over the recursive structure (the bound itself is a random variable determined by deeper play) yields a fixed-point equation whose solution is the `b/ln b` effective branching factor. The `ln b` denominator is the signature of "the first success among `b` independent trials arrives after `O(b/ln b)` expected probes when the success probability is shaped by order statistics." Pearl's full treatment formalizes this with the theory of minimax trees over random leaf assignments.

---

## 8. Game-Tree Complexity and Lower Bounds

**Theorem 8.1 (Optimality of alpha-beta among directional algorithms).** Among algorithms that examine the tree left-to-right without storing results of separate subtrees ("directional" algorithms), alpha-beta is optimal: no directional algorithm examines fewer leaves in the worst case. Moreover, the minimal set of leaves any correct algorithm must examine to *prove* the value `V(r)` — the **critical tree** or **proof tree** — has exactly `b^{⌈d/2⌉} + b^{⌊d/2⌋} − 1` leaves, matching Theorem 6.2.

**Proof sketch.** Any algorithm certifying `V(r) = x` must (i) exhibit a strategy for MAX achieving `≥ x` (one child per MAX node, all children per MIN node along it) and (ii) exhibit a strategy for MIN achieving `≤ x` (the dual). The union of these two strategy subtrees is the proof tree; counting its leaves on a uniform tree gives the Knuth-Moore bound. An algorithm examining fewer leaves leaves some leaf of the proof tree unevaluated, so an adversary can set that leaf's value to change `V(r)` — contradiction. ∎

This optimality is worth dwelling on: alpha-beta is not merely "a good heuristic that usually prunes a lot" — under perfect ordering it provably examines the *minimum possible* set of leaves any correct directional algorithm must examine. The proof tree is a hard information-theoretic floor, and perfect-ordering alpha-beta hits it exactly. The only way to do better is to abandon the directional (left-to-right, no cross-subtree memoization) model — which is exactly what transposition tables (Section 9) do, attacking the *redundancy across subtrees* that the directional model cannot exploit.

**The two half-strategies, concretely.** To prove `V(r) = x`:
- The **lower-bound strategy** (MAX achieves `≥ x`): pick one specific move at each MAX node (the one realizing `x`), but consider *all* opponent replies at each MIN node (MAX must handle every response). This subtree has `1` branch at MAX levels and `b` branches at MIN levels.
- The **upper-bound strategy** (MIN holds to `≤ x`): the dual — `b` branches at MAX levels, `1` at MIN levels.

Each half-strategy alone has `≈ b^{d/2}` leaves (branching `b` at half the levels). Their union, the proof tree, has `b^{⌈d/2⌉} + b^{⌊d/2⌋} − 1` leaves — the `−1` accounting for the shared root-to-first-leaf path. This is simultaneously alpha-beta's best case (Theorem 6.2) and the information-theoretic minimum, so perfect-ordering alpha-beta is *optimal*, not merely good.

### 8.1 The Tree-vs-Graph Gap, Quantified

| Game | State-space (legal positions) | Game-tree size (leaf sequences) | Ratio |
|------|-------------------------------|----------------------------------|-------|
| Tic-tac-toe | `5 478` (`765` up to symmetry) | `255 168` distinct games (`≤ 9!`) | ~`47×` |
| Connect Four (7×6) | `≈ 4.5 × 10^{12}` | `≈ 10^{14}`–`10^{16}` | large |
| Checkers | `≈ 5 × 10^{20}` | `≈ 10^{31}` | huge |
| Chess | `≈ 10^{43}` (Shannon) | `≈ 10^{120}` (Shannon number) | astronomical |
| Go (19×19) | `≈ 2 × 10^{170}` | `> 10^{360}` | beyond comprehension |

The **state-space / game-tree gap** is exactly what transposition tables (Section 9) monetize: the search visits positions (the smaller number), not move sequences (the larger number), when memoization merges transpositions. Checkers was *solved* (proven a draw, Schaeffer 2007) by combining alpha-beta, massive transposition/endgame databases, and the relatively small `10^{20}` state space — a milestone impossible without exploiting this gap.

**Game-tree size taxonomy.** Two standard measures:
- **State-space complexity:** number of legal positions reachable (tic-tac-toe ≈ `5478` legal positions, or `765` up to symmetry; chess ≈ `10^{44}`).
- **Game-tree complexity:** number of leaf nodes in the full search tree from the start (tic-tac-toe ≤ `9! = 362880` move sequences, `255168` distinct games; chess ≈ `10^{123}`, the Shannon number).

The gap between the two is exactly what transposition tables exploit (Section 9): the game *graph* is far smaller than the game *tree* because many move orders reach the same position.

**Complexity classes.** Deciding the value of a sufficiently general game (e.g. generalized chess/Go on `n × n` boards) is **PSPACE-complete** or **EXPTIME-complete** depending on the rules — far beyond polynomial. Alpha-beta does not change this asymptotic intractability; it improves the *constant in the exponent* (`d/2` vs `d`), which is decisive in practice but not in complexity-class terms.

**Why the two complexities differ.** Bounded-length games (a polynomial move limit, e.g. via a 50-move rule) are typically **PSPACE-complete** — the alternating quantifiers `∃ move ∀ reply ∃ move …` over a polynomial number of plies define exactly the alternating-polynomial-time class APTIME = PSPACE. Games whose natural play length is exponential (no short move bound, positions can recur) climb to **EXPTIME-complete**. Generalized chess (with the 50-move rule dropped) is EXPTIME-complete; generalized Go under Japanese rules is EXPTIME-complete; many puzzle-like one-player or bounded games are PSPACE-complete. The takeaway for an engineer: the *exact* class is a property of the rule set's move-length bound, but in every case the value computation is super-polynomial, so alpha-beta's role is to push the *reachable depth* as far as the time budget allows, never to make the problem tractable in the complexity-theoretic sense.

**Practical numbers.** The Shannon number (~`10^{43}` legal chess positions, ~`10^{120}` game-tree size) and Go's ~`10^{170}` legal positions dwarf any conceivable search. This is precisely why depth-limited search with an evaluation function (Section 10), not full-tree minimax, is mandatory for these games — and why the *quality of the evaluation function* dominates engine strength once the tree cannot be exhausted.

**The dividing line.** Tic-tac-toe (game-tree `≤ 9!`) and even checkers (solved, 2007) sit below the feasibility frontier when alpha-beta is combined with transposition tables and endgame databases; chess and Go sit far above it, so they are *played well* but not *solved*. The role of every technique in this topic — pruning, ordering, TT, quiescence, selective search — is to push the reachable depth as far past the frontier as the time budget permits, never to cross from "played well" to "solved" for the large games. That crossing is a complexity-theoretic impossibility for the foreseeable future, which is why modern top engines blend alpha-beta with learned evaluation functions rather than seeking exhaustive search.

---

## 9. Transposition Tables and the DAG View

When positions repeat across the tree, the true search space is a **directed acyclic graph** (the game graph), not a tree.

**Definition 9.1 (Game graph).** Merge tree nodes that correspond to identical positions (same board, same side to move, same auxiliary state). The result is a DAG; `V` is well-defined on it by the same recurrence, since merged nodes have identical subtrees.

**Proposition 9.2 (TT soundness).** Memoizing `V(v)` (or a valid bound on it) keyed by position, and reusing it when the same position recurs at sufficient depth, preserves correctness.

**Proof.** A transposition table stores, per position, a triple `(value, depth, flag)` with `flag ∈ {EXACT, LOWER, UPPER}`. By Lemma 4.1 / Corollary 5.2, an EXACT entry is `V(v)` and may be returned whenever the stored search depth is `≥` the current requirement (a deeper or equal search subtree certifies the value for any shallower requirement). A LOWER entry certifies `V(v) ≥ value` and may only *raise* `α`; an UPPER entry certifies `V(v) ≤ value` and may only *lower* `β`. These are exactly the sound operations of Lemma 4.1, so the search result is unchanged; only redundant subtree exploration is removed. The depth guard is necessary: a value certified by a shallow search does not certify the same position to a deeper requirement, because the deeper subtree may reveal a different (more accurate) value. ∎

**Complexity impact.** On a game with many transpositions, the TT reduces the searched nodes from the tree size toward the (much smaller) DAG size — a reduction that is *game-dependent* and not captured by `b^d`. Combined with iterative deepening (whose earlier iterations seed the TT with best-move ordering information), the TT both prunes duplicate work and *improves move ordering*, pushing the effective branching factor toward the `√b` ideal of Theorem 6.2.

**Hash-collision caveat.** Practical TTs key on a 64-bit Zobrist hash and store a verification field. A full-key collision (two distinct positions, identical 64-bit key) violates the hypothesis of Proposition 9.2 and can return a wrong value. The probability is `≈ n²/2^{65}` for `n` distinct positions (birthday bound); engines accept this as negligible and rely on the search's tendency to self-correct on subsequent iterations.

### 9.1 Worked Transposition Example

Consider tic-tac-toe. The sequences `X@4, O@0, X@8` and `X@8, O@0, X@4` reach the **identical** board (X on cells 4 and 8, O on cell 0, X to... actually O to move). In a naive tree search these are two separate subtrees, each fully re-searched. The game *tree* counts them twice; the game *DAG* (Definition 9.1) counts the merged position once.

Quantitatively, tic-tac-toe has at most `9! = 362 880` move sequences (tree leaves) but only `5 478` legal positions (DAG nodes), and just `765` up to the 8-fold board symmetry. A transposition table keyed by the packed board collapses the `362 880`-leaf search toward the `5 478`-node DAG — a reduction of roughly `66×` before any symmetry exploitation. This gap *is* the value of memoization, and it is exactly the gap Proposition 9.2 proves is sound to exploit.

### 9.1b Worked TT-Flag Example

Suppose searching position `p` with window `(α=2, β=5)` produces a beta cutoff at value `7` (a child returned `≥ 5`, pushing the running value to `7 ≥ β`). We store:

```
TT[p] = { value: 7, depth: d, flag: LOWERBOUND, best_move: m }   // V(p) ≥ 7
```

Later we revisit `p` with a *different* window `(α=0, β=10)` at depth `≤ d`. The stored `LOWERBOUND 7` lets us set `α := max(0, 7) = 7`, immediately tightening the window to `(7, 10)`. If instead we revisit with `(α=8, β=10)`, the bound `7` gives `α := max(8, 7) = 8` (no change) but does *not* let us return — `7` only certifies `V(p) ≥ 7`, not the exact value, and `7 < 8 = α` so no cutoff. Had the flag been EXACT (the original search had returned strictly inside its window), we could return `7` directly whenever the depth sufficed. This is the operational content of Proposition 9.2: LOWER/UPPER bounds *tighten*, only EXACT *returns*.

### 9.2 Soundness of the Depth Guard, Restated

Why must we store and check `depth`? Suppose a position `p` was searched to depth `2` (a shallow look-ahead) and stored EXACT value `v₂`, then later we require `p` to depth `6`. Returning `v₂` would substitute a 2-ply estimate for a 6-ply answer — and `V_2(p)` (depth-limited, Section 10) generally differs from `V_6(p)`. The guard `stored.depth ≥ required.depth` forbids this: a deep entry certifies any shallower requirement (a depth-6 search subsumes the information of a depth-2 search of the same node), but never the reverse. In a fully-searched-to-terminal game (no depth limit, as in tic-tac-toe) every EXACT entry is the *true* value `V(p)` regardless of when it was computed, so the guard is vacuous there; it becomes essential only with depth-limited search.

---

## 10. Depth-Limited Search and Evaluation-Function Semantics

**Definition 10.1 (Depth-limited minimax).** Replace `u` at depth-limited leaves by a heuristic `eval`. Define `V_d(v)` by the minimax recurrence truncated at depth `d`, using `eval` at the frontier.

**Proposition 10.2 (No optimality guarantee).** `V_d(r)` equals the true value `V(r)` only if `eval` coincides with `V` on the frontier; in general `V_d(r)` is a heuristic estimate, and the move it selects need not be optimal.

This is the formal statement of why evaluation-function quality dominates engine strength once the tree cannot be searched to terminals. Two structural facts:

- **Stability under depth.** A desirable (rarely-achieved) property is `V_d(r) → V(r)` as `d → ∞`; for finite games with `d ≥` the tree height this holds exactly because the frontier reaches true terminals and `eval` is never consulted. For depth-limited search of large games, convergence is empirical, not guaranteed.
- **Monotonic consistency.** If `eval` is a *lower bound* on `V` for MAX-frontier nodes and an *upper bound* for MIN-frontier nodes uniformly, then `V_d(r)` is correspondingly bounded — but real evals are not monotone, so no clean bound transfers.
- **The horizon effect (formalized).** Let `v` be a frontier node whose true value differs sharply from `eval(v)` because a forced sequence just beyond depth `d` changes the outcome. Then `V_d` misvalues `v`, and an adversary can exploit the difference. **Quiescence search** (see [`senior.md`](./senior.md)) addresses this by extending the frontier along forcing moves until `eval` is applied only to *quiet* positions, where the heuristic's static assumptions hold. There is no general theorem that quiescence eliminates the error; it provably reduces it on the class of "tactical" misvaluations (capture sequences) by searching them to resolution.

**Pathology (Nau, Beal).** Counterintuitively, for *some* artificial games with independent random leaf values, deeper minimax search yields *worse* play (**game-tree pathology**) because errors compound through the min/max operators. Real games are non-pathological because positions are correlated (a good position tends to stay good), which is why deeper search helps in practice. The formal point: "deeper is better" is an empirical property of real evaluation functions and game structure, not a theorem about minimax.

### 10.1 Worked Horizon-Effect Illustration

Imagine a chess-like position where the static evaluation counts material. At depth 4 the search ends on a position where MAX has just captured a knight — `eval = +3` (a knight up). But on move 5 (just past the horizon) the opponent recaptures with a pawn, so the true value is `eval = +3 − 3 = 0` (even material, or worse if MAX's pawn structure suffered). The depth-4 search reports `+3`; the truth is `0`. MAX, trusting `+3`, may walk into the line and be disappointed.

Quiescence search fixes this by, at the depth-4 leaf, *not* returning `eval = +3` directly but instead searching the available captures: it sees the recapture, plays it out to the quiet position, and returns the corrected `0`. Formally, quiescence replaces the frontier evaluation `eval(v)` with `qsearch(v)`, which equals `eval` on quiet positions and the resolved value on positions with pending captures — provably eliminating the *capture-sequence* class of horizon errors, though not errors that hinge on quiet positional drift beyond the horizon.

### 10.2 The "Deeper Is Better" Caveat, Formalized

Let `err_d = |V_d(r) − V(r)|` be the depth-`d` evaluation error. For *real* games the empirical observation is `err_{d+1} < err_d` on average — extra depth reduces error. But this is not implied by the minimax recurrence: Nau exhibited families where `err` is *non-monotone* or even increasing in `d`. The distinguishing property is **correlation of leaf values** with the true value: when sibling leaves and parent values are positively correlated (good positions cluster), the min/max operators concentrate signal; when leaves are independent (Nau's pathological games), the operators amplify noise. Engine designers rely on the correlation being strong enough — verified empirically by self-play (Section 9 of [`senior.md`](./senior.md)), never assumed from theory.

---

## 11. Connections: Zero-Sum Games, Determinacy, and DP

**Minimax theorem (von Neumann) vs game-tree minimax.** Von Neumann's minimax theorem concerns *simultaneous-move* zero-sum games and mixed strategies: `max_x min_y x^T A y = min_y max_x x^T A y`. Game-tree minimax is the *sequential, perfect-information* special case, where pure strategies suffice and the value is achieved without randomization (Theorem 2.3). The shared name reflects the shared `max-min` structure; the perfect-information setting is the easier, determined one.

To see why pure strategies suffice in the sequential case but not the simultaneous one: in rock-paper-scissors (simultaneous, hidden choice) any *pure* strategy is exploitable, so the value `0` is achieved only by the *mixed* strategy "uniform random" — von Neumann's theorem guarantees a mixed equilibrium exists. In tic-tac-toe (sequential, fully observed) the second player sees the first player's move *before* responding, so no randomization is needed; a deterministic optimal reply exists at every node (Zermelo). The order-of-information difference — simultaneous vs sequential — is exactly what separates "needs mixed strategies, solved by linear programming / the minimax theorem" from "pure strategies suffice, solved by backward induction / minimax search." Both bear the name "minimax" because both compute `max-min`, but they are different theorems about different game classes.

**Minimax as dynamic programming.** The recurrence of Definition 2.1 is a DP over the game tree/DAG: the value of a node depends only on the values of its children (optimal substructure), and the TT is precisely memoization of overlapping subproblems (positions reached by multiple move orders). This places adversarial search squarely in the `13-dynamic-programming` family — the twist over ordinary DP is the *alternation* of `max` and `min` (or the single `max` of negamax over negated children), reflecting the adversary. Sibling `17-game-dp` treats the DP framing directly; `14-nim` and `15-sprague-grundy` give closed-form values for impartial games where no tree search is needed; `26-games-on-graphs` handles cyclic position graphs (where the acyclicity assumed in Section 9 fails and one needs retrograde analysis / fixed-point iteration instead of a simple DFS).

**Beyond zero-sum perfect information.** Relaxing the standing assumptions of Section 1 changes the recurrence:
- **Chance nodes (expectiminimax).** Insert *chance* layers that take an *expectation* over outcomes: `V(chance) = Σ_o P(o)·V(child_o)`. This models dice/cards. Pruning is weaker here because an expectation cannot be cut off as cleanly as a `max`/`min` (a single bad outcome does not bound the average); `*-minimax` variants recover some pruning under bounded leaf values.
- **`n > 2` players (max^n).** Each node stores a *vector* of payoffs and the player to move maximizes *their own* component. Alpha-beta-style pruning largely breaks because there is no single scalar to bound; only weak "shallow/deep" pruning survives.
- **Hidden information.** No single game tree captures it; one needs information sets and techniques like counterfactual regret minimization (poker). Minimax-on-a-tree does not apply.

The clean theory of this topic — determinacy, `√b`, lossless pruning — is precisely the payoff of staying inside the zero-sum perfect-information deterministic two-player box.

**Search vs tabulation.** Ordinary DP fills a table over *all* subproblems bottom-up; adversarial search instead does a *top-down* DFS that visits only the subproblems reachable (and not pruned) from the root. The two are duals — memoized top-down DFS is exactly tabulation with lazy evaluation — but for games the search realization is preferred because (i) the state space is usually far too large to tabulate fully, (ii) alpha-beta can *prune* subproblems that tabulation would needlessly compute, and (iii) we typically want only the root value and its principal variation, not the value of every position. This is the same memoization-vs-tabulation trade-off discussed in sibling `01-memoization-vs-tabulation`, specialized to the adversarial, prunable setting.

**Why alpha-beta has no clean tabulation analog.** Pruning depends on the *order* in which subproblems are visited and on bounds inherited from ancestors — information a bottom-up table does not have, since it computes every cell unconditionally. You cannot "prune a table cell" because the table has no notion of which cells an as-yet-unknown ancestor will need. Thus alpha-beta is intrinsically a *search* optimization, available to top-down memoized DFS but not to bottom-up tabulation — one more reason the search realization dominates for large games.

**Retrograde analysis (cyclic games).** When the position graph has cycles (positions can repeat, e.g. with draw-by-repetition), the simple recursion is ill-defined (a node can depend on itself). The value is then the fixed point of the min/max operator, computed by backward induction from terminal positions (retrograde analysis) — the technique behind endgame tablebases. Alpha-beta assumes a finite acyclic search (enforced by a depth limit or a repetition/50-move rule), sidestepping the fixed-point subtlety.

### 11.1 Worked DP Framing: the Subtraction Game

Consider the take-away game of `interview.md` Challenge 4: a pile of `n` stones, remove `1`, `2`, or `3` per turn, last stone wins. Define `W(n) = +1` if the player to move wins, `−1` if they lose (the negamax side-relative value). The DP recurrence is

```
W(0) = −1                                  (no move: the mover just lost)
W(n) = max_{t ∈ {1,2,3}, t ≤ n} ( −W(n−t) )    (negamax form)
```

This is the negamax recurrence of Theorem 3.2 specialized to a linear position graph. Solving: `W(1) = −W(0) = +1`, `W(2) = +1`, `W(3) = +1`, `W(4) = max(−W(3), −W(2), −W(1)) = max(−1,−1,−1) = −1`, `W(5) = +1`, … The pattern `W(n) = −1 ⟺ n ≡ 0 (mod 4)` emerges. This closed form is the **fixed point of the min/max operator** on the (acyclic, since `n` strictly decreases) position graph — exactly the DP that minimax computes, here admitting an `O(1)` solution because the recurrence is periodic. The lesson: minimax on a game tree, game DP, and (when structure permits) a closed form are three views of the same operator; recognizing the closed form (as Sprague-Grundy does for `14-nim`/`15-sprague-grundy`) replaces an exponential tree search with arithmetic.

### 11.2 Optimal Substructure and Overlapping Subproblems

The two hallmarks of dynamic programming both hold for adversarial search:

- **Optimal substructure.** `V(v)` depends only on `{V(c)}` for children `c` (Definition 2.1); an optimal strategy is composed of optimal sub-strategies in each subtree. The adversarial twist is the alternation of `max`/`min`, but the substructure property is unaffected.
- **Overlapping subproblems.** The same position recurs across the tree (Section 9), so the subproblems overlap — and the transposition table is precisely the memoization table that ordinary DP uses to avoid recomputation.

This places adversarial search squarely as a *member* of the `13-dynamic-programming` family rather than a separate technique: minimax is "DP with an adversary", alpha-beta is "DP with provably-prunable branches", and the TT is "DP memoization keyed by game state". Sibling `17-game-dp` develops the explicit DP-table formulation; the present topic emphasizes the *search* (DFS + pruning) realization of the same recurrence, which is preferred when the state space is too large to tabulate exhaustively but a single root value (and its principal variation) is wanted.

---

## 12. Summary

- **Minimax value.** On a finite zero-sum perfect-information tree, `V(v)` is defined by `max` at MAX nodes, `min` at MIN nodes, leaf utilities at the frontier; it exists and is unique (Theorem 2.2) and equals the game-theoretic value achievable by both players (Zermelo determinacy, Theorem 2.3).
- **Negamax.** The MAX/MIN recursion equals a single `N(v) = max_c (−N(c))` over side-relative values (Theorem 3.2); the window transform is `(α, β) ↦ (−β, −α)`. One branch, proven equivalent.
- **Alpha-beta correctness.** With window `(α, β)`, the procedure returns the exact value when `α < V(v) < β`, and a valid bound otherwise; at the root with `(−∞, +∞)` it returns exactly `V(r)` (Theorem 5.1). Pruning is therefore **lossless** (Corollary 5.2): a cutoff certifies a bound that already determines the parent's choice, so the unexamined children are provably irrelevant.
- **Best case.** Under perfect ordering on a uniform `(b, d)` tree, alpha-beta examines `b^{⌈d/2⌉} + b^{⌊d/2⌋} − 1 = Θ(b^{d/2})` leaves (Knuth-Moore, Theorem 6.2): effective branching factor `√b`, doubling searchable depth. This matches the minimal proof tree, so alpha-beta is optimal among directional algorithms (Theorem 8.1).
- **Average case.** Random ordering already gives `Θ((b/log b)^d)` (Pearl); good heuristics push the observed effective branching factor toward `√b`.
- **Transposition tables.** The real space is a DAG; memoizing positions with `(value, depth, flag)` is sound (Proposition 9.2) under a depth guard, reducing tree size toward DAG size and improving ordering.
- **Depth limits.** With an evaluation function, the result is a heuristic (Proposition 10.2); the horizon effect is a formal misvaluation that quiescence search mitigates. "Deeper is better" is an empirical property of real (non-pathological) games, not a theorem.
- **Placement.** Minimax is DP with adversarial alternation; the TT is its memoization. Sibling topics cover the closed-form (`14-nim`, `15-sprague-grundy`), DP framing (`17-game-dp`), and cyclic/graph games (`26-games-on-graphs`).
- **Order-independence.** The root value is invariant to move order (Corollary 5.3); ordering changes only *which* nodes are pruned, never the answer — which is exactly why ordering heuristics can be heuristic without risking correctness.
- **Generalizations cost the clean theory.** Chance nodes (expectiminimax) weaken pruning, `n>2` players (max^n) break the scalar-bound structure, and hidden information leaves the game-tree model entirely. Determinacy, `√b`, and lossless pruning are the dividend of the zero-sum perfect-information deterministic two-player setting.

### Complexity Cheat Table

| Quantity | Value | Reference |
|----------|-------|-----------|
| Plain minimax leaves | `b^d` | Definition 2.1 |
| Alpha-beta, perfect ordering | `b^{⌈d/2⌉}+b^{⌊d/2⌋}−1 = Θ(b^{d/2})` | Theorem 6.2 |
| Alpha-beta, random ordering | `Θ((b/log b)^d)` ≈ `O(b^{3d/4})` | Theorem 7.1 |
| Alpha-beta worst case | `b^d` (no pruning) | adversarial ordering |
| Space (recursion stack) | `O(d)` | DFS |
| Minimal proof tree | `Θ(b^{d/2})` | Theorem 8.1 |
| Effective branching factor (good ordering) | `√b` | Corollary 6.3 |
| Deciding generalized game value | PSPACE/EXPTIME-complete | Section 8 |
| Tic-tac-toe state space | `5478` legal (`765` up to symmetry) | Section 8.1 |
| Tic-tac-toe game-tree | `255168` distinct games (`≤ 9!`) | Section 8.1 |

**Reading the table.** Every row except the last two is exponential in `d`; the `√b` row is the *best achievable* effective branching factor and equals the information-theoretic lower bound (the proof tree). The PSPACE/EXPTIME row is about *deciding the value* of a parameterized game family and is orthogonal to the per-instance `b^d` count — alpha-beta improves the latter's exponent (`d/2`) but cannot touch the former's complexity class.

### Closing Notes

- **Determinacy** (Section 2): the value minimax computes is achievable by an explicit pure strategy for each side — it is the game's value, not an estimate, when searched to terminals.
- **Lossless pruning** (Section 5): the soundness proof rests on the observation that a cutoff certifies a *bound* that already fixes the parent's decision; this single fact also justifies storing bounds in transposition tables.
- **The `√b` law** (Section 6): the alternation of CUT and ALL nodes on the proof-tree skeleton is the structural reason perfect ordering halves the exponent; it is simultaneously the *best case* and the *information-theoretic lower bound* (the proof tree), so alpha-beta with perfect ordering is optimal.
- **Heuristic boundary** (Section 10): once the depth limit bites, optimality is gone and evaluation quality plus quiescence determine strength; "deeper helps" is empirical, and pathological games prove it is not automatic.
- **DP membership** (Section 11): minimax is dynamic programming with adversarial `max`/`min` alternation; the transposition table is its memoization; alpha-beta is a *search*-only optimization with no bottom-up tabulation analog, because pruning needs ancestor-supplied bounds and visit order.
- **Two minimaxes** (Section 11): von Neumann's minimax theorem (simultaneous moves, mixed strategies, LP duality) and game-tree minimax (sequential, pure strategies, backward induction) share the `max-min` form but are distinct theorems for distinct game classes; the difference is whether a player sees the opponent's move before replying.

Foundational references: Knuth & Moore, "An Analysis of Alpha-Beta Pruning" (1975) for the type structure and the `b^{d/2}` bound; Pearl, "Asymptotic properties of minimax trees and game-searching procedures" (1980) for the random-ordering analysis and the `b/log b` branching factor; Zermelo (1913) and von Neumann (1928) for determinacy and the minimax theorem; Nau and Beal for game-tree pathology; Russell & Norvig for the modern synthesis. Sibling topics: `14-nim`, `15-sprague-grundy`, `17-game-dp`, `26-games-on-graphs`.
