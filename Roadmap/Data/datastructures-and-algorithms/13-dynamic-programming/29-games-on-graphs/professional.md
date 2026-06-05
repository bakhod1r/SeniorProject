# Games on Graphs — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The WIN / LOSE / DRAW Partition
3. Retrograde Analysis as a Least Fixpoint
4. Correctness Proof (Induction on Distance-to-Terminal)
5. Why Cyclic Graphs Need Retrograde Analysis
6. Linear-Time Complexity O(V+E)
7. Distance-to-Mate and Optimal Play
8. The Attractor-Set Formulation
9. Parity Games
10. Contrast with DAG Game DP and Grundy Theory
11. Determinacy and the Big Picture
12. Summary

---

## 1. Formal Definitions

Let `G = (V, E)` be a finite directed graph. Each vertex is a **game position** that encodes the full state of a two-player, perfect-information, deterministic game *including which player is to move*. An edge `(u, v) ∈ E` means the player to move at `u` has a legal move producing position `v` (at which it is the other player's turn).

**Definition 1.1 (Successors and terminals).** The successor set is `succ(u) = { v : (u, v) ∈ E }`. The **out-degree** is `d(u) = |succ(u)|`. A position `u` is **terminal** iff `d(u) = 0`.

**Definition 1.2 (Play).** A **play** from `u₀` is a (finite or infinite) walk `u₀, u₁, u₂, …` with `(u_m, u_{m+1}) ∈ E`. A finite play ends at a terminal. The two players alternate choosing the next edge; the player to move at `u_m` chooses `u_{m+1}`.

**Definition 1.3 (Outcome convention).** Under **normal play**, a player who cannot move (reaches a terminal on their turn) **loses**. An infinite play is a **draw**. (Misère play inverts the terminal verdict; see §10. Explicit terminal labels generalize both.)

**Definition 1.4 (Label).** Each position receives a label `L(u) ∈ {WIN, LOSE, DRAW}` from the viewpoint of the player to move at `u`, under optimal play by both sides, with the preference order **WIN ≻ DRAW ≻ LOSE** (a player forces a win if possible; failing that, forces a draw; only loses if forced).

**Notation.** `n = |V|`, `m = |E|`. We write `W, L, D` for the three label sets partitioning `V`. The Iverson bracket `[P]` is `1` if `P` holds else `0`. "Cycle" means a directed cycle in `G`. A position's **distance-to-terminal** (when defined) is the optimal number of moves to a terminal under the fast-win/slow-loss convention (§7).

**Definition 1.5 (Impartial vs partizan).** A game is **impartial** if at every position both players have the *same* set of legal moves (only the position, not the identity of the mover, determines moves) — e.g. Nim. It is **partizan** if the two players may have different moves (e.g. chess: White moves white pieces). The WIN/LOSE/DRAW labeling of this topic applies to **both** classes uniformly, because we bake "whose turn" into the position and the label is always "outcome for the mover here". Sprague-Grundy theory (§10), by contrast, applies *only to impartial* games. This is a second axis (impartial/partizan) orthogonal to the acyclic/cyclic axis, and the labeling is robust along both.

**Remark on perfect information and determinism.** The whole theory assumes **perfect information** (both players see the full state) and **no chance** (deterministic transitions). With chance nodes the right model is a Markov decision process / stochastic game (expected values, not WIN/LOSE/DRAW); with hidden information the right model is an extensive-form game with information sets, solved by very different techniques. The graph-labeling method is exactly the perfect-information, deterministic, finite case — its scope and its limits.

---

## 2. The WIN / LOSE / DRAW Partition

**Definition 2.1 (Labeling rules).** The labels are characterized by the local consistency conditions:

```
(R-LOSE-term)  d(u) = 0                          ⟹  L(u) = LOSE
(R-WIN)        ∃ v ∈ succ(u) with L(v) = LOSE     ⟹  L(u) = WIN
(R-LOSE)       ∀ v ∈ succ(u): L(v) = WIN          ⟹  L(u) = LOSE
(R-DRAW)       otherwise                          ⟹  L(u) = DRAW
```

**Lemma 2.2 (Exhaustiveness and exclusivity).** Rules (R-WIN) and (R-LOSE) cannot both fire at the same vertex, and (R-DRAW) covers exactly the remaining case. Hence `{W, L, D}` is a partition of `V`.

**Proof.** If (R-WIN) fires, some successor is LOSE, so not *all* successors are WIN, so (R-LOSE) cannot fire (its premise fails). If neither (R-WIN) nor (R-LOSE) fires, then there is no LOSE successor and not all successors are WIN — i.e. there is at least one successor that is DRAW (or the vertex is the special terminal case already covered) — which is precisely (R-DRAW). A terminal satisfies (R-LOSE-term), which is the `d(u)=0` instance of (R-LOSE) (the universal quantifier over the empty successor set is vacuously true). Exclusivity and exhaustiveness follow. ∎

The subtlety the partition hides: the rules are *mutually recursive* and the graph may be cyclic, so it is not obvious that a consistent assignment **exists and is unique**. §3 and §4 establish that the least fixpoint of these rules exists, is unique, and equals the game-theoretic optimal outcome.

### 2.1 Why Local Consistency Is Not Enough Alone

A naive reading of §2.1 might suggest "any assignment satisfying the four rules at every vertex is correct." This is **false** on cyclic graphs. Consider `a → b → a` (a pure 2-cycle, no terminals). The assignment `L(a) = L(b) = DRAW` satisfies the rules (neither has a LOSE successor, neither has all-WIN successors). But so does the assignment `L(a) = WIN, L(b) = LOSE` if we (wrongly) declare it: check — `a` has successor `b = LOSE`, so (R-WIN) is happy with `a = WIN`; `b` has successor `a = WIN`, all successors WIN, so (R-LOSE) is happy with `b = LOSE`. **Two different assignments both satisfy the local rules!** Local consistency admits *multiple* fixpoints; only the **least** one (which leaves the pure cycle as DRAW, never inventing an unforced LOSE) matches game semantics. This is precisely why §3 insists on the *least* fixpoint, not just *a* fixpoint — the spurious "all-decided" assignments are larger fixpoints that do not correspond to optimal play.

---

## 3. Retrograde Analysis as a Least Fixpoint

Model the labeling as a monotone operator on partial assignments. A **partial labeling** assigns each vertex a value in `{WIN, LOSE, ⊥}` (`⊥` = undecided). Order them by `⊥ ⊑ WIN`, `⊥ ⊑ LOSE` (information order: deciding a vertex moves up).

**Definition 3.1 (The labeling operator `Φ`).** Given partial labeling `ℓ`, `Φ(ℓ)` decides additional vertices:

```
Φ(ℓ)(u) = LOSE   if ℓ(u) ≠ ⊥ keeps its value, or [d(u)=0], or [∀v∈succ(u): ℓ(v)=WIN]
Φ(ℓ)(u) = WIN    if ℓ(u) ≠ ⊥ keeps its value, or [∃v∈succ(u): ℓ(v)=LOSE]
Φ(ℓ)(u) = ℓ(u)   otherwise
```

**Lemma 3.2 (Monotonicity).** `Φ` is monotone: `ℓ₁ ⊑ ℓ₂ ⟹ Φ(ℓ₁) ⊑ Φ(ℓ₂)`. Deciding more vertices can only decide more, never un-decide.

**Proof.** Each decision premise — "some successor is LOSE", "all successors are WIN" — is monotone in `ℓ`: making more successors WIN/LOSE preserves or newly satisfies these premises, and decided vertices never revert (the operator copies their value). ∎

**Theorem 3.3 (Least fixpoint exists, by Knaster-Tarski).** The set of partial labelings under `⊑` is a complete lattice (with `⊥` everywhere as bottom). A monotone operator on a complete lattice has a **least fixpoint** `lfp(Φ)`, reached by iterating `Φ` from the bottom element `⊥^V`:

```
ℓ₀ = ⊥^V,   ℓ_{t+1} = Φ(ℓ_t),   lfp(Φ) = ℓ_∞ = ⋃_t ℓ_t.
```

**Definition 3.4 (Final labeling).** Let `ℓ* = lfp(Φ)`. Decided vertices keep their `ℓ*` value (WIN or LOSE); vertices still `⊥` at the fixpoint are labeled **DRAW**.

**Proposition 3.5 (Retrograde analysis computes `lfp(Φ)`).** The backward-BFS algorithm of `middle.md` — seed terminals as LOSE, propagate via reverse edges, decrement out-degree counters, mark a vertex WIN on its first LOSE successor and LOSE when its counter hits 0 — decides exactly the vertices in `lfp(Φ)`, with the identical labels.

**Proof.** The algorithm only ever decides a vertex when a labeling rule premise is satisfied by *already-decided* vertices: a vertex is set WIN exactly when a LOSE successor exists (some `v` already LOSE), and set LOSE exactly when its counter reaches 0, i.e. all `d(u)` successors are already WIN. Thus every decision is a valid `Φ`-step, so the algorithm's output `⊑ lfp(Φ)`. Conversely, the counter mechanism fires a LOSE decision as soon as the last successor becomes WIN, and the queue guarantees every decided vertex's effect is propagated to all predecessors; so no `Φ`-decidable vertex is left `⊥`. Hence the algorithm's decided set `⊒ lfp(Φ)`. Equality follows, and the leftover `⊥` vertices are exactly the DRAW set. ∎

The least-fixpoint choice is essential: it decides a vertex **only when forced**. A *greatest* fixpoint would optimistically decide cycle vertices, contradicting the game semantics (a cycle vertex that can be forced is decided; one that cannot is a genuine draw).

### 3.1 The μ-Calculus Reading

The WIN set has a one-line **modal μ-calculus** characterization. Write `◇X` for "the mover can step into `X`" (∃ a successor in `X`) and `□X` for "every move stays in `X`" (∀ successors in `X`). In the alternating-turn encoding the WIN set is the **least fixpoint**:

```
WIN  =  μX. ( LOSE_terminals  ∨  ⟨can force into X⟩ )
DRAW =  νY. ( ¬LOSE_terminals  ∧  ⟨can avoid leaving Y⟩ )
```

The `μ` (least fixpoint) for WIN matches "force reaching the target eventually" (reachability); the `ν` (greatest fixpoint) for the draw/safety region matches "avoid the target forever" (safety). This is exactly the alternation-depth-1 fragment of the modal μ-calculus, and model checkers evaluate it by the same monotone-iteration / attractor computation. The duality `μ ↔ ν`, `◇ ↔ □`, `target ↔ ¬target` is the formal statement that reachability and safety are dual games — and that retrograde analysis (least fixpoint) and the safety/draw computation (greatest fixpoint) are two faces of one calculus.

### 3.2 Convergence Bound of the Iteration

The fixpoint iteration `ℓ_{t+1} = Φ(ℓ_t)` converges in at most `n` steps (each step decides at least one new vertex or halts), but the *worklist* (queue-based) realization does total work `O(V + E)` rather than `O(n·(V+E))` because it only revisits the predecessors of newly-decided vertices, not the whole graph each round. The naive round-based iteration would be `O(n(V+E))`; retrograde analysis is the event-driven optimization that collapses it to linear by propagating exactly the changed information.

---

## 4. Correctness Proof (Induction on Distance-to-Terminal)

We now prove the computed labels equal the true optimal-play outcomes.

**Definition 4.1 (Game value).** Define `val(u) ∈ {WIN, LOSE, DRAW}` as the outcome under optimal play (the player to move achieves the best result in the order WIN ≻ DRAW ≻ LOSE). Formally, by Zermelo/backward-induction semantics:
- `val(u) = WIN` iff the mover has a strategy forcing a terminal where the opponent is stuck.
- `val(u) = LOSE` iff the opponent has such a strategy against every mover choice.
- `val(u) = DRAW` otherwise (the mover can force at least an infinite play but cannot force a win).

**Definition 4.2 (Rank).** For decided vertices, define `rank(u)` = the iteration index `t` at which `ℓ_t(u)` first becomes non-`⊥` in the fixpoint iteration of §3. Terminals have `rank = 0`. This is exactly the **distance-to-terminal** under fast-win/slow-loss (§7).

**Theorem 4.3 (Soundness and completeness).** For all `u`, `L(u) = val(u)`, where `L` is the retrograde labeling (§3.4).

**Proof (strong induction on `rank` for decided vertices; separate argument for DRAW).**

*Decided vertices, by induction on `rank(u) = t`.*

- **Base `t = 0` (terminals).** `d(u) = 0`: the mover cannot move and loses by Definition 1.3, so `val(u) = LOSE = L(u)`. ✓

- **Inductive step, `u` decided WIN at rank `t`.** Then some `v ∈ succ(u)` was decided LOSE at rank `< t`. By the induction hypothesis `val(v) = LOSE`: the player moving at `v` (the opponent of `u`'s mover) loses. So `u`'s mover plays `u → v`, handing the opponent a losing position, forcing a win. Hence `val(u) = WIN = L(u)`. ✓

- **Inductive step, `u` decided LOSE at rank `t`.** Then *all* `v ∈ succ(u)` were decided WIN at rank `< t` (the counter reached 0). By IH every `val(v) = WIN`: whatever move `u`'s mover makes, the opponent then wins. The mover has no escape, so `val(u) = LOSE = L(u)`. ✓

*Undecided vertices (DRAW).* Suppose `u ∉ lfp(Φ)` (labeled DRAW). We show `val(u) = DRAW`, i.e. the mover can avoid losing forever but cannot force a win.

1. *Cannot force a win.* If `u` could force a win, some successor would be LOSE, but then (R-WIN) would have decided `u` WIN — contradiction. More carefully, a winning strategy reaches a terminal in finitely many moves; by induction on that strategy's depth every position on it is decided, so `u` would be decided. Hence no winning strategy exists.
2. *Can avoid losing.* Since `u` is undecided, `u` is not LOSE, so **not all** successors are WIN, i.e. `u` has a successor `w` that is *not* WIN (it is undecided or LOSE). It cannot be LOSE (that would decide `u` WIN), so `w` is undecided. The mover plays `u → w`, again an undecided vertex, and by the same argument `w` has an undecided successor. Thus the mover maintains an infinite play entirely within the undecided set, never reaching a terminal, never losing.

Therefore `val(u) = DRAW = L(u)`. By the partition (Lemma 2.2) the three cases are exhaustive and exclusive, completing the proof. ∎

**Corollary 4.4.** The labeling is **unique**: it is `lfp(Φ)` plus the DRAW completion, and equals `val`, which is determined by the game. There is no other consistent assignment satisfying the rules of §2.

### 4.1 Worked Verification

Take the 5-position game `moves = {0→1, 0→2, 1→3, 2→1, 2→4, 4→2}` with terminal `3`:

```
out-degrees: d(0)=2, d(1)=1, d(2)=2, d(3)=0, d(4)=1
rev(1)={0,2}, rev(2)={0,4}, rev(3)={1}, rev(4)={2}
```

Fixpoint iteration:

```
ℓ₀ : 3 = LOSE (rank 0; terminal, d=0)
ℓ₁ : 1 = WIN  (rank 1; succ 3 is LOSE)
ℓ₂ : counters decrement at 0 (d:2→1) and 2 (d:2→1) because child 1 is WIN; neither hits 0
ℓ₃ : no new decisions — fixpoint reached
```

Undecided after the fixpoint: `{0, 2, 4}`. By Definition 3.4 they are **DRAW**. Verify against §4's undecided-successor argument:

- `2` has successors `{1 (WIN), 4 (undecided)}`: a non-WIN successor (`4`) exists, so `2` is not LOSE; no LOSE successor, so `2` is not WIN. The mover plays `2 → 4`, staying undecided. DRAW. ✓
- `4`'s only successor is `2` (undecided): same argument, DRAW. ✓
- `0` has successors `{1 (WIN), 2 (DRAW)}`: plays `0 → 2` to avoid losing. DRAW. ✓

The labels `[DRAW, WIN, DRAW, LOSE, DRAW]` match the `middle.md` hand computation and the retrograde algorithm output exactly — the empirical anchor for Theorem 4.3.

### 4.2b Why the DRAW Argument Needs the "Non-WIN Successor"

The crux of the DRAW completeness proof is: an undecided vertex `u` always has an **undecided** successor (not merely a non-LOSE one). Suppose for contradiction every successor of `u` is decided. Each is WIN or LOSE (the only decided values). If some successor is LOSE, (R-WIN) decides `u` WIN — contradiction. If all are WIN, (R-LOSE) decides `u` LOSE — contradiction. So at least one successor is undecided. The mover follows undecided-to-undecided edges forever, producing an infinite play that never reaches a terminal — a draw. This is why the DRAW set is **closed under "stay undecided"**: it is a union of strongly connected, exit-free regions in the residual graph.

---

## 5. Why Cyclic Graphs Need Retrograde Analysis

**Proposition 5.1 (Naive forward DFS fails on cycles).** A memoized DFS that computes `L(u) = WIN ⟺ ∃ v ∈ succ(u): L(v) = LOSE` by recursing into successors does not terminate (or returns an incorrect value) when `G` contains a directed cycle.

**Proof.** Consider a 2-cycle `u → v → u` with no other edges from `u, v`. The DFS computing `L(u)` calls `L(v)`, which calls `L(u)`, already on the stack: infinite recursion. Guarding re-entry by returning a default (say DRAW) is unsound: the same structure with an added edge `u → t`, `t` terminal (LOSE), makes `u` genuinely WIN, yet a re-entry guard that returned DRAW for the `u → v → u` branch could still mislabel depending on visitation order, and in graphs where the cycle has no exit to LOSE the guard must produce DRAW — but *which* cycle vertices draw is a global property (§4's undecided-set argument), not a local "seen again" flag. ∎

**The fixpoint view explains the failure.** Forward DFS implicitly assumes the recursion is **well-founded** (every chain of successor calls terminates), which holds iff `G` is acyclic. The labeling is fundamentally a **least fixpoint** (Theorem 3.3), and on cyclic graphs the least fixpoint is *strictly smaller* than "all vertices decided" — the gap is exactly the DRAW set. Forward DFS has no mechanism to compute "the least set forced by the rules"; backward propagation from terminals does precisely that, because it adds a vertex to `W ∪ L` *only when a rule is satisfied by already-settled vertices*, which is the operational meaning of iterating `Φ` from `⊥`.

**Acyclic special case.** If `G` is a DAG, the well-founded recursion terminates, `lfp(Φ)` decides *every* vertex (no undecided cycle vertices can exist — there are no cycles), so `D = ∅` and forward memoized DFS is correct. This is the formal justification for the "acyclic ⇒ simple memo, no draws" claim.

### 5.1 A Precise Counterexample to the In-Progress-Guard Heuristic

Consider the graph with edges `{a→b, b→a, a→t}` where `t` is terminal:

```
deg(a)=2 (→b, →t),  deg(b)=1 (→a),  deg(t)=0
```

Retrograde analysis: `t` is LOSE (rank 0); `a` has a move to LOSE child `t` ⇒ `a` is WIN (rank 1); `b`'s only move is to WIN child `a`, counter →0 ⇒ `b` is LOSE (rank 2). Final: `a=WIN, b=LOSE, t=LOSE`. **No draws.**

Now run the "in-progress guard returns DRAW" DFS starting at `b`: `solve(b)` → `solve(a)` → explores `a→b` first → `b` is in-progress → returns DRAW for that branch. Depending on whether the implementation then also explores `a→t`, `a` may be (correctly) found WIN or (incorrectly) frozen as DRAW from the premature guard. If it explores `b` before `t` and caches the DRAW, both `a` and `b` are mislabeled. The verdict is **order-dependent and unsound**. The guard cannot know that `a` has an *escape* (`a→t`) until it finishes exploring all of `a`'s moves — but by then it has already returned a value into the cycle. Only the backward least-fixpoint computation, which never assigns a value until a rule fires on settled vertices, is correct. This single example is the rigorous reason the heuristic is rejected.

### 5.2 SCC Condensation Does Not Rescue Forward DFS

A natural fix attempt: condense strongly connected components (SCCs) and process the resulting DAG. This *partially* helps — the SCC DAG is acyclic — but it does **not** reduce the in-SCC labeling to a trivial rule, because within a non-trivial SCC the WIN/LOSE/DRAW labels still depend on the global fixpoint (a vertex in an SCC can be WIN via an out-of-SCC LOSE child, LOSE if forced, or DRAW). You still need retrograde analysis *inside* each SCC, seeded from already-solved downstream SCCs. So SCC condensation reorganizes the work (and is exactly the material-slicing idea of `senior.md` in disguise) but does not eliminate the need for the least-fixpoint propagation. The condensation orders the *seeding*; retrograde analysis does the *labeling*.

---

## 6. Linear-Time Complexity O(V+E)

**Theorem 6.1.** Retrograde analysis runs in `O(V + E)` time and `O(V + E)` space.

**Proof.**
- *Preprocessing.* Building the reverse adjacency `rev` and the out-degree array `d` is one pass over all edges: `O(V + E)`.
- *Seeding.* Scanning for terminals is `O(V)`.
- *Main loop.* Each vertex is enqueued **at most once**: it is enqueued exactly when it transitions from `⊥` to decided, and the `known`/skip check prevents re-enqueue. Each dequeue processes vertex `v` and iterates `rev[v]` — i.e. traverses each reverse edge once. Across all dequeues, total reverse-edge traversals `= Σ_v |rev[v]| = |E|`. Each traversal does `O(1)` work (a label test and possibly a counter decrement). So the loop is `O(V + E)`.
- *Finalization.* Marking undecided vertices DRAW is `O(V)`.

Total `O(V + E)`. Space: `rev` (`O(V+E)`), and `O(V)` arrays for label, counter, known, queue. ∎

**Optimality.** Any algorithm must inspect every position and every move at least once to determine the labeling (an unseen edge could change an outcome), giving an `Ω(V + E)` lower bound. Retrograde analysis matches it; it is asymptotically optimal.

**Counter amortization.** The decrement of `d(u)` happens once per WIN-labeled successor of `u`, summing to `O(E)` decrements total — the same charge as the reverse-edge traversal, confirming no hidden super-linear cost.

### 6.1 Comparison with Naive Re-Scanning

A naive worklist that, on settling `v`, re-scans *all* successors of each predecessor `u` to test the "all WIN" condition would cost `Σ_u d(u)²` in the worst case (each of `u`'s `d(u)` resolutions triggers a `d(u)`-scan), which is `Θ(E·Δ)` for max out-degree `Δ` — super-linear. The out-degree counter replaces the re-scan with a single `O(1)` decrement, recovering `O(V+E)`. This is the precise algorithmic role of the counter: it converts an "all successors satisfy `P`" test from `O(d(u))` per trigger into `O(1)` amortized, by maintaining the count of not-yet-satisfying successors incrementally.

### 6.1b Computing Distances Adds No Asymptotic Cost

Augmenting the labeling with the fast-win/slow-loss distance (§7) keeps the complexity at `O(V + E)`: each vertex stores one integer `dist`, updated `O(1)` per incoming reverse edge (a `min`/`max` and an add). The BFS already settles vertices in non-decreasing distance order, so no separate sort or priority queue is needed — this is why a plain FIFO queue suffices and a Dijkstra-style heap (which would add a `log V` factor) is unnecessary. The distance is a "free" byproduct of the layered structure of the backward wave.

### 6.2 Memory Lower Bound

Storing the labeling requires `Ω(V)` bits (one of three values per vertex, `⌈log₂ 3⌉ = 2` bits) just for the output, plus `Ω(E)` to represent the input edges. The reverse adjacency adds another `Θ(E)`. Hence `Θ(V + E)` space is necessary and sufficient for the explicit-graph algorithm; the senior-level external-memory variants (`senior.md`) reduce *resident* memory below this by streaming, trading passes over disk for RAM.

---

## 7. Distance-to-Mate and Optimal Play

The rank of §4.2 is the optimal distance-to-terminal under the standard convention.

**Definition 7.1 (Fast-win / slow-loss distance).**
```
dist(u) = 0                                   if u terminal LOSE
dist(u) = 1 + min{ dist(v) : v∈succ(u), L(v)=LOSE }   if L(u)=WIN
dist(u) = 1 + max{ dist(v) : v∈succ(u) }              if L(u)=LOSE  (all v are WIN)
```

**Theorem 7.2 (BFS-layer correctness).** Retrograde BFS settles vertices in non-decreasing `dist` order, and the formula above gives the game-theoretically optimal number of moves: the winner mates as fast as possible, the loser delays as long as possible.

**Proof.** Terminals have `dist = 0` and are settled first. Inductively, when a LOSE vertex `v` with `dist(v) = d` is dequeued, every undecided predecessor `u` becomes WIN with `dist(u) = d + 1`; because LOSE vertices are dequeued in non-decreasing `dist`, the *first* (hence minimum-distance) LOSE successor that reaches `u` sets its distance, realizing the min (fast win). A WIN vertex `v` only decrements predecessors' counters and updates their running `max`; the predecessor `u` is settled LOSE when its counter hits 0, at which point `dist(u) = 1 + max_v dist(v)` over all (WIN) successors — the longest the loser can stall (slow loss). Non-decreasing settle order holds because each new distance is one more than an already-settled distance. ∎

**Why the asymmetry.** A WIN player chooses one move and wants the terminal soonest, so `min`. A LOSE player is forced through whichever successor and wants the latest terminal; the *adversary* (the WIN player at the successor) will mate fastest from there, but the LOSE player picks among its own moves the one maximizing delay, so `1 + max`. This min/max alternation is precisely minimax depth, made explicit.

### 7.1 Worked Distance Trace

On the chain `0 → 1 → 2 → 3` with terminal `3`:

```
3 LOSE, dist 0        (terminal)
2 WIN,  dist 1        (succ 3 LOSE; 1 + dist(3))
1 LOSE, dist 2        (only succ 2 is WIN; counter→0; 1 + max{dist(2)} = 1 + 1)
0 WIN,  dist 3        (succ 1 LOSE; 1 + dist(1))
```

Labels alternate WIN/LOSE along the chain (the parity of the distance to the terminal), and the distances are `3, 2, 1, 0` — exactly the number of moves to the mate. A WIN at even distance from a terminal, a LOSE at odd — the classic parity of a forced-march game. BFS settles them in the order `3, 2, 1, 0` (non-decreasing distance), confirming Theorem 7.2.

### 7.2 Strategy Extraction

The labeling and distances yield an explicit **optimal strategy table** with no extra search:

```
strategy(u):
  if L(u) == WIN:  return argmin_{v: L(v)=LOSE} dist(v)   # fastest mate
  if L(u) == DRAW: return any v with L(v) ≠ LOSE          # hold the draw
  if L(u) == LOSE: return argmax_{v} dist(v)              # delay maximally
```

This is `O(d(u))` per move at play time and depends only on the current vertex (positional). In a tablebase it is *not* stored — it is recomputed at query time from the per-position label+distance, because storing the chosen move would multiply table size by `log Δ` bits with no benefit.

### 7.3 Distance Bounds and the Diameter

**Proposition 7.3.** For a decided vertex `u`, `dist(u) ≤ n − 1` (where `n = |V|`), because the optimal play visits no vertex twice — a repeated vertex would mean a cycle, and under fast-win the winner would never lengthen the mate by looping, while under slow-loss the loser, if it could loop indefinitely, would have been DRAW not LOSE. Hence the optimal play is a *simple* path to the terminal, of length at most `n − 1`.

**Proof.** Suppose an optimal play from a decided `u` repeats a vertex `w` at plies `i < j`. The play `…w…w…` contains a cycle `w → … → w`. If `u` is WIN, the winner can excise the cycle to reach the terminal in fewer plies, contradicting `dist`'s minimality (fast win). If `u` is LOSE, the existence of a cycle on *every* continuation would let the loser stay on it forever — but then `u` could avoid the terminal, making it DRAW, not LOSE; contradiction. So no vertex repeats, the play is simple, and its length is `≤ n − 1`. ∎

**Consequence.** The maximum finite `dist` (the "longest forced mate") is bounded by `n − 1`, and is attained on adversarial graphs (a forced march down a long chain, as in §7.1). For chess endgames this bound is enormous in principle but the *observed* longest mates (e.g. 549 plies in a 7-piece endgame) are dramatically smaller than the `~10^14` position count — a reflection of the graph's structure, not the worst-case bound.

---

## 8. The Attractor-Set Formulation

Retrograde analysis is the special case of computing an **attractor set** in a reachability/safety game — the language of formal verification and controller synthesis.

**Definition 8.1 (Controlled and uncontrolled steps).** In the symmetric two-player setting, "the player to move" alternates, but we can phrase WIN as: the set of positions from which the mover can *force* reaching a target set `T` (the LOSE-for-opponent terminals).

**Definition 8.2 (Attractor `Attr(T)`).** Define the increasing sequence
```
Attr₀ = T
Attr_{i+1} = Attr_i ∪ { u : ∃ v∈succ(u), v∈Attr_i }   (mover can step into the attractor)
                   ∪ { u : ∀ v∈succ(u), v∈Attr_i }   (every move stays in the attractor)
Attr(T) = ⋃_i Attr_i.
```

In the alternating-move encoding (turn baked into the position), the two clauses correspond to "this position's mover can choose to enter" vs "all of this position's moves are already attracted" — i.e. the WIN and LOSE propagation rules, respectively. The first clause is the existential (∃ successor in target) step; the second is the universal (∀ successors attracted) step.

**Theorem 8.3 (WIN set is an attractor).** `W = Attr(L_term)` where `L_term` is the set of terminal LOSE positions, computed with the alternation that one player drives toward `T` and the other away. Symmetrically `L` is the dual attractor toward `WIN`. `D = V \ (W ∪ L)` is the set from which the opposing player can keep the play out of the target **forever** — the **safety** region.

**Proof.** The attractor iteration `Attr_i` is exactly the fixpoint iteration `ℓ_i` of §3 restricted to the WIN/LOSE alternation, by the same monotone-operator argument. The complement of the attractor is the largest set with no forced entry — the greatest fixpoint of the safety operator — which is the DRAW set. ∎

**Significance.** This places win/lose/draw labeling inside the standard theory of **infinite games on graphs**: reachability games (force reaching `T`) and safety games (avoid `T` forever) are computed by attractor / co-attractor in linear time `O(V + E)` — the same retrograde analysis. The draw region is the safety region for the player who cannot be forced to lose.

### 8.1 The Two Quantifier Steps, Concretely

In the explicit alternating encoding (turn baked into the vertex), every vertex "belongs" to whichever player is to move there. The attractor's two clauses specialize cleanly:

- At a vertex where the **attracting player** moves (a WIN-seeking position), `u ∈ Attr_{i+1}` iff **∃** a successor already in `Attr_i` — one good move suffices. This is the (R-WIN) rule.
- At a vertex where the **opponent** moves (the position is "good for the attractor" only if the opponent is trapped), `u ∈ Attr_{i+1}` iff **∀** successors are in `Attr_i` — the opponent has no escape. This is the (R-LOSE) rule.

So the WIN/LOSE propagation *is* the existential/universal attractor step under the turn-encoding; the out-degree counter implements the universal step incrementally. The DRAW set is the largest set on which the opponent has, from every vertex, at least one move staying outside the attractor — the **greatest fixpoint** of the dual (safety) operator.

### 8.1b Worked Attractor Computation

On the 5-position graph of §4.1 (`moves = {0→1, 0→2, 1→3, 2→1, 2→4, 4→2}`, terminal `3`), compute `Attr(T)` with `T = {3}` (the LOSE terminal), attracting toward "the opponent is stuck":

```
Attr₀ = {3}                      (the seed)
Attr₁ = {3, 1}                   (1 can step into 3: ∃-step; 1 ∈ WIN)
Attr₂ = {3, 1}                   (no new vertex: 0 and 2 each have a non-attracted
                                  successor — 0→2, 2→4 — so neither is forced in)
Attr(T) = {3, 1}
```

So `W = Attr(T) \ {3} = {1}` (WIN) and `{3}` is the LOSE seed; the complement `{0, 2, 4}` is the safety/DRAW region, where the mover can always pick an edge staying outside `Attr(T)` (`0→2`, `2→4`, `4→2`). This matches the §4.1 labels exactly. The attractor iteration *is* the fixpoint iteration of §3 specialized to the WIN target; the leftover region is the greatest fixpoint of the safety operator (the DRAW set).

### 8.2 Controller Synthesis Reading

In reactive synthesis, one player is the **controller** (it picks control inputs) and the other is the **environment** (adversarial inputs). "From which initial states can the controller guarantee reaching a goal (reachability) or staying safe forever (safety)?" is exactly the WIN/DRAW question on the game graph of system configurations. The attractor computation yields both the winning region *and* a memoryless controller strategy — the formal foundation of tools like reactive LTL synthesis (restricted to reachability/safety fragments). Retrograde analysis is therefore not a game-specific trick but the linear-time kernel of a verification industry.

---

## 9. Parity Games

Win/lose/draw labeling is the simplest member of a hierarchy of graph games distinguished by their **winning condition on infinite plays**.

**Definition 9.1 (Parity game).** A directed graph where each vertex has an integer **priority**, vertices are partitioned between two players (Even and Odd), and on an *infinite* play the winner is determined by the parity of the **highest priority seen infinitely often** (Even wins if it is even, Odd if odd).

- Our win/lose/draw setting is essentially a parity game with priorities in `{0, 1}` where infinite play (the relevant priority occurring forever) is declared a **draw** rather than a win for one side — a "loopy" / draw-augmented reachability game. Reachability and safety games are the 1-priority and "avoid-forever" specializations.

**Theorem 9.2 (Determinacy).** Parity games are **determined** with **memoryless** (positional) optimal strategies: from every vertex exactly one player has a winning strategy that depends only on the current vertex (Emerson-Jutla, Mostowski). Reachability/safety games — our case — are the easy end, solvable in `O(V + E)` by attractor computation.

**Complexity landscape.**

| Game type | Winning condition | Complexity |
|-----------|-------------------|------------|
| Reachability / safety (our WIN/LOSE/DRAW) | reach / avoid a target | `O(V + E)` (attractor) |
| Büchi / co-Büchi | visit a set infinitely often | `O(V·E)` classical |
| Parity (general) | parity of max priority seen i.o. | `NP ∩ co-NP`; quasi-polynomial (Calude et al. 2017) |
| Mean-payoff / energy | long-run average weight | `NP ∩ co-NP`, pseudo-polynomial |

**Why this matters here.** The retrograde / attractor algorithm is the linear-time base case of an entire research area (model checking, reactive synthesis). The crucial structural fact — **positional determinacy** — is what makes "label each position WIN/LOSE/DRAW once, independent of history" *correct*: optimal play needs no memory of how you reached the position, which is exactly why a single label per vertex suffices. For parity games with `≥ 3` priorities, the simple linear algorithm no longer applies, and one needs Zielonka's recursive algorithm or the quasi-polynomial breakthroughs; our two-priority case is the tractable foundation.

### 9.1 Why Memorylessness Is Non-Trivial

It is tempting to assume optimal play is always memoryless, but that is **false** for richer objectives. For a **Muller condition** (the set of infinitely-visited vertices must lie in a prescribed family), optimal strategies provably require memory (a finite automaton tracking visit history). The miracle of reachability/safety/parity is that memorylessness *does* hold — proven by an inductive "strategy-stitching" argument (attractor strategies compose without conflict). Our WIN/LOSE/DRAW setting inherits this miracle, which is the deep justification for the entire tablebase paradigm: you may store **one verdict per position** and reconstruct optimal play locally, rather than storing position-history-indexed strategies (which would be astronomically larger).

### 9.2 Reduction Between Game Types

| From | To | Reduction |
|------|----|-----------| 
| Reachability (reach `T`) | Safety (avoid `T'`) | complement the target; winner of one is loser of the other where defined |
| Win/Lose/Draw (our setting) | Parity with priorities `{0,1}` + draw | LOSE-terminal = priority forcing the opponent's parity; loop = draw |
| Büchi (visit `B` i.o.) | Parity priorities `{1,2}` | assign priority 2 to `B`, 1 elsewhere |
| Mean-payoff threshold | Parity (pseudo-poly) | classical reduction (Jurdziński) |

The hierarchy is strict in difficulty: our linear-time case sits at the bottom, and each generalization climbs the complexity ladder while preserving positional determinacy up to (and including) parity.

### 9.2b Worked Two-Priority Reduction

To see our setting as a parity game concretely, assign priorities so that "the mover gets stuck" forces the right parity:

```
terminal where the mover is stuck  →  give it a priority that makes the *opponent* win
infinite play                       →  declared a draw (third outcome)
```

In a strict 2-priority parity game (priorities `{0, 1}`, no draws), Even wins an infinite play iff the max priority seen infinitely often is even. Our reachability/safety case is the degenerate version where one player is trying to *reach* a terminal (a finite event) rather than control an infinite-play parity — which is why a single attractor pass (not the full Zielonka recursion) solves it. Adding the draw outcome makes it a "loopy reachability game", and the safety (greatest-fixpoint) region is the draw set. The whole point: **more priorities ⇒ more fixpoint alternations ⇒ harder**; we have the minimum, hence linear time.

### 9.3 Practical Parity-Game Algorithms (for Context)

Although our two-priority case is `O(V+E)`, knowing how the general parity solvers work clarifies *why* the simple algorithm stops applying:

- **Zielonka's recursive algorithm.** Recursively computes attractors for the highest priority, removing them and recursing on the rest. Exponential worst case but excellent in practice; degenerates to a *single* attractor computation when there is one effective priority — i.e. our case.
- **Small-progress measures (Jurdziński).** Assigns each vertex a bounded tuple that lifts monotonically toward a fixpoint; the bound is what makes parity `NP ∩ co-NP`.
- **Quasi-polynomial (Calude et al. 2017 and successors).** Encodes the parity condition in a quasi-polynomial-size "statistic", a major theoretical breakthrough that still has not been beaten to polynomial.

The common ancestor of all three is the attractor computation of §8 — our retrograde analysis. The added machinery exists solely to handle the *alternation* of multiple priorities, which the win/lose/draw setting (one round of reach-or-avoid) does not have.

---

## 10. Contrast with DAG Game DP and Grundy Theory

**DAG game DP (acyclic).** If `G` is acyclic, §5 shows `D = ∅` and a memoized DFS / reverse-topological DP computes WIN/LOSE in `O(V + E)`. Every play terminates, so there is no draw. This is the natural setting for subtraction games and finite token games where a monotone potential strictly decreases each move.

**Sprague-Grundy theory (acyclic, sums).** For an acyclic impartial game, the **Grundy value** is
```
g(u) = mex{ g(v) : v ∈ succ(u) },     mex(S) = min(ℕ₀ \ S).
```
**Theorem 10.1 (Sprague-Grundy).** `L(u) = LOSE ⟺ g(u) = 0`, and the Grundy value of a **disjunctive sum** of independent games is the **XOR** of their Grundy values: `g(G₁ + … + G_r) = g(G₁) ⊕ … ⊕ g(G_r)`.

So WIN/LOSE is the **2-valued projection** of the Grundy number: `g(u) = 0 ⟺ LOSE`, `g(u) > 0 ⟺ WIN`. The Grundy number carries *strictly more* information — enough to solve sums of games — but it **requires acyclicity** (the mex recursion is well-founded only on a DAG). On cyclic ("loopy") games the mex has no convergent least value in general, and the correct theory is loopy combinatorial game theory with explicit draw/`∞` values (Conway), of which our WIN/LOSE/DRAW labeling is the outcome-only fragment.

| Setting | Tool | Output | Handles cycles? | Handles sums? |
|---------|------|--------|-----------------|----------------|
| Acyclic single game | DAG DP / Grundy | WIN/LOSE (or `g`) | n/a (no cycles) | Grundy: yes |
| Acyclic sum of games | Sprague-Grundy | XOR of `g` | n/a | yes |
| Cyclic single game | retrograde analysis | WIN/LOSE/DRAW | **yes** | no (Grundy invalid) |
| Cyclic sum of games | (open/loopy theory) | loopy values | yes | partial, non-XOR |

**Theorem 10.2 (Why cycles invalidate XOR).** The Sprague-Grundy XOR rule relies on every component game being a finite, terminating impartial game (an equivalence class of Nim-heaps). A loopy component has no finite Nim-value, so the additive (XOR) structure breaks; draws in one component interact with the others non-additively. Hence retrograde analysis solves the *single* cyclic game's outcome but does not compose across sums the way Grundy does. ∎

### 10.1 Worked Grundy-vs-Outcome Example

Subtraction game: pile of `n` stones, remove `1` or `2`, last to move wins (normal play). Positions are pile sizes; moves go to strictly smaller piles — a DAG.

```
g(0) = mex{} = 0           (LOSE: empty pile, no move)
g(1) = mex{g(0)} = mex{0} = 1     (WIN)
g(2) = mex{g(1), g(0)} = mex{1,0} = 2   (WIN)
g(3) = mex{g(2), g(1)} = mex{2,1} = 0   (LOSE)
g(4) = mex{g(3), g(2)} = mex{0,2} = 1   (WIN)
...
g(n) = 0 ⟺ n ≡ 0 (mod 3)
```

The **outcome** projection: LOSE exactly when `n ≡ 0 (mod 3)`. The retrograde/DAG-DP solver would report exactly this WIN/LOSE pattern. But the **Grundy values** `0,1,2,0,1,2,…` carry more: to solve a *sum* of three such piles `(a, b, c)`, the position is LOSE iff `g(a) ⊕ g(b) ⊕ g(c) = 0` — information the bare WIN/LOSE outcome cannot provide. This is the precise sense in which Grundy is finer; and it works only because the single-pile game is acyclic, so the mex recursion terminates.

### 10.2 Loopy Games and the Draw Value

Conway's theory of **loopy games** assigns values in an extended universe including `∞` (a position from which a player can force the game to continue forever in their favor) and explicit draw outcomes. Our WIN/LOSE/DRAW labeling is the **outcome-class** fragment: it records only which of the three results optimal play yields, discarding the finer ordinal/loopy structure. For impartial loopy games one can define a generalized Grundy-like value, but it lives in a richer codomain than `ℕ₀` and does not XOR-compose in general — confirming that the clean Sprague-Grundy theory is special to the acyclic, terminating world.

### 10.3 The Two Orthogonal Axes, Summarized

The choice of technique is governed by two independent yes/no questions, and getting either wrong leads to a wrong or non-terminating algorithm:

```
            acyclic (DAG)              cyclic (loops)
single   →  memoized DFS / Zermelo  →  retrograde analysis (this topic)
sum      →  Sprague-Grundy (XOR)    →  loopy CGT (no clean composition)
```

The horizontal axis (acyclic/cyclic) decides whether draws can exist and whether forward recursion is well-founded. The vertical axis (single/sum) decides whether a single outcome bit suffices or whether the full Grundy value (composing via XOR) is required. This topic occupies the **(cyclic, single)** cell — the cell where the outcome-only label is exactly what is needed and the only cell with a third outcome.

---

## 11. Determinacy and the Big Picture

**Theorem 11.1 (Zermelo / Borel determinacy, finite case).** Every finite-position, perfect-information, deterministic, two-player game with the win/lose/draw outcome is **determined**: from each position the outcome under optimal play is well-defined and one of WIN/LOSE/DRAW, and optimal strategies are **positional** (memoryless).

**Proof.** Theorem 4.3 constructs the value function `val = L` and exhibits positional strategies: a WIN player's strategy is "move to a LOSE successor of minimum distance"; a LOSE player's is arbitrary (all lose); a DRAW player's is "move to a non-LOSE (undecided) successor" (which exists by §4's argument). Each depends only on the current vertex's label and its successors' labels — no history. Hence positional determinacy. ∎

**The conceptual arc.**
- The labeling is a **least fixpoint** of monotone rules (Knaster-Tarski), computed in linear time by backward propagation.
- Correctness is an induction on **distance-to-terminal**, with the DRAW set characterized as the vertices never forced — the safety region / complement of the attractor.
- **Cycles** are exactly what create the DRAW set and what defeat forward recursion, because the least fixpoint is then strictly partial.
- The whole construction is the linear-time **reachability/safety game** base case of **parity games**, where **positional determinacy** is the deep theorem guaranteeing one label per position suffices.
- It is the **outcome-only, cycle-tolerant** counterpart of Grundy theory, which is finer (full Grundy number, composes via XOR) but **acyclic-only**.

### 11.1 Determinacy Without Draws: The DAG Special Case

When `G` is acyclic, determinacy degenerates to the classical **Zermelo backward induction**: process vertices in reverse topological order; each is WIN iff a successor is LOSE, else LOSE. No fixpoint iteration is needed because the topological order *is* a valid evaluation order — every successor is decided before its predecessor. The DRAW set is provably empty (no infinite plays exist), so the game value is two-valued. This is the historically first determinacy result (Zermelo 1913, for chess assuming termination) and the reason finite, terminating games are "solved" by minimax in principle. Cycles are precisely the feature that upgrades the problem from "backward induction over a topological order" to "least fixpoint over a possibly cyclic graph", introducing the third outcome.

### 11.2 The Role of Finiteness

Both the fixpoint existence (Knaster-Tarski needs a complete lattice — guaranteed by finite `V`) and the distance well-definedness (finite ranks) rely on `V` being finite. For **infinite** game graphs (e.g. games on `ℕ`), the labeling may still be defined by transfinite fixpoint iteration, but the linear-time algorithm and the bounded-distance results fail; one enters descriptive set theory and the Borel determinacy theorem (Martin 1975), which guarantees determinacy for Borel winning conditions on arbitrary graphs but offers no algorithm. The practical games-on-graphs setting is firmly finite, which is what makes everything constructive and `O(V+E)`.

### 11.3 Numerical Summary of the Hierarchy

| Winning condition | Determinacy | Strategy memory | Best known algorithm |
|-------------------|-------------|-----------------|----------------------|
| Reachability / safety (this topic) | yes (Zermelo) | none (positional) | `O(V + E)` attractor |
| Büchi / co-Büchi | yes | none | `O(V·E)` |
| Parity (`d` priorities) | yes (Emerson-Jutla) | none | quasi-poly `V^{O(log d)}` |
| Mean-payoff / energy | yes | none | pseudo-poly |
| Muller | yes | **finite memory required** | exponential (LAR construction) |
| Borel (infinite graphs) | yes (Martin) | possibly none | no general algorithm |

Reading top to bottom: each row generalizes the winning condition; positional determinacy survives all the way to parity, then breaks at Muller, where memory becomes necessary. Our topic is the simplest, fastest, and most widely deployed row.

---

## 12. Summary

- **Formal labeling (§2).** `L(u) = LOSE` at terminals and when all successors are WIN; `WIN` when some successor is LOSE; `DRAW` otherwise. The three sets partition `V`.
- **Least fixpoint (§3).** The labeling is `lfp(Φ)` of a monotone operator (Knaster-Tarski), plus a DRAW completion of the undecided vertices. Retrograde analysis (backward BFS + out-degree counters) computes exactly this least fixpoint — deciding a vertex only when forced.
- **Correctness (§4).** By induction on distance-to-terminal, `L = val` (optimal-play value); the DRAW set is precisely the vertices from which the mover can maintain an infinite play yet cannot force a win — proven via the undecided-successor argument.
- **Cycles (§5).** Forward DFS assumes well-founded recursion (acyclicity); on cyclic graphs the least fixpoint is strictly partial, and the gap is the DRAW set. Only backward least-fixpoint propagation is correct. DAGs have `D = ∅`, validating simple memoization.
- **Complexity (§6).** `O(V + E)` time and space, asymptotically optimal (`Ω(V+E)` lower bound); the counter decrements amortize to `O(E)`.
- **Distance (§7).** BFS layering yields fast-win (`1 + min` over LOSE successors) / slow-loss (`1 + max` over successors) distance-to-mate, settled in non-decreasing distance order.
- **Attractor (§8).** WIN is the attractor of the target terminals; DRAW is the safety (co-attractor) region. This embeds the problem in the theory of infinite games on graphs.
- **Parity games (§9).** Our setting is the reachability/safety (1–2 priority) base case of parity games; positional determinacy (Emerson-Jutla) is what makes a single per-vertex label correct. General parity games are `NP ∩ co-NP`, quasi-polynomial.
- **Grundy contrast (§10).** WIN/LOSE is the 2-valued projection of the Grundy number; Grundy is finer and composes via XOR for sums but requires acyclicity, whereas retrograde analysis tolerates cycles for a single game.
- **Two axes (§10.3).** Acyclic/cyclic decides whether draws exist and whether forward recursion is well-founded; single/sum decides whether one outcome bit suffices or the full Grundy value is needed. This topic is the (cyclic, single) cell.
- **Distance is free (§6.1b, §7).** The fast-win/slow-loss distance-to-mate rides along the same `O(V+E)` backward wave with a plain FIFO queue — no heap, no extra asymptotic cost — bounded by `n − 1` since optimal play is a simple path (§7.3).

- **Distance bound (§7.3).** Optimal play is a simple path to the terminal, so the longest forced mate is `≤ n − 1`; observed mates are far shorter, reflecting graph structure over the worst case.
- **μ-calculus (§3.1) and attractors (§8).** WIN is `μX. (target ∨ ◇X)` (reachability, least fixpoint); the DRAW/safety region is `νY. (¬target ∧ □Y)` (greatest fixpoint). Retrograde analysis is the alternation-free model-checking kernel.

### Complexity Cheat Table

| Task | Setting | Complexity |
|------|---------|------------|
| WIN/LOSE/DRAW labeling | finite game graph (cyclic OK) | `O(V + E)` retrograde |
| Distance-to-mate (DTM) | same | `O(V + E)` layered BFS |
| WIN/LOSE labeling | DAG | `O(V + E)` memoized DFS (no draws) |
| Grundy values | DAG impartial | `O(V + E + Σ mex)` |
| Reachability / safety game | graph game | `O(V + E)` attractor |
| Parity game (≥3 priorities) | graph game | `NP ∩ co-NP`, quasi-poly |

### Closing Notes

- **Least fixpoint, not any fixpoint** (§2.1, §3): cyclic graphs admit multiple locally-consistent assignments; only the least one (leaving unforced cycles as DRAW) is the game value. This single point is the deepest correctness subtlety of the whole topic.
- **Out-degree counter = incremental universal quantifier** (§6.1): it converts "all successors are WIN" from a per-trigger `O(d)` rescan into `O(1)` amortized, recovering linear time.
- **Positional determinacy** (§9.1, §11.3): optimal play needs no history, which is the entire license for one-label-per-position tablebases. It survives up to parity and breaks at Muller.
- **μ-calculus duality** (§3.1): WIN is `μ` (reachability), DRAW/safety is `ν` (greatest fixpoint); retrograde analysis is the alternation-free μ-calculus model-checking kernel.
- **Acyclic ⇒ Zermelo backward induction, `D = ∅`** (§11.1): cycles are precisely what introduce the third outcome and force the fixpoint view.

Foundational references: Zermelo (1913) on determinacy; Knaster-Tarski fixpoint theorem; Sprague (1935) / Grundy (1939); Conway, *On Numbers and Games* (loopy games); Thomas, "On the synthesis of strategies in infinite games"; Emerson-Jutla (1991) on parity-game determinacy; Zielonka's algorithm; Jurdziński small-progress measures; Calude-Jain-Khoussainov-Li-Stephan (2017) quasi-polynomial parity games; Martin (1975) Borel determinacy. Sibling topics: `15` (Sprague-Grundy), `11-graphs/01-representation`, and the broader `13-dynamic-programming` family.
