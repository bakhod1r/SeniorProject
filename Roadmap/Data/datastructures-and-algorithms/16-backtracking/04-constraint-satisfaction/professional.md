# Constraint Satisfaction Problems — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definition of a CSP
2. Backtracking Search: Soundness and Completeness
3. The Consistency Hierarchy (Node / Arc / Path / k-Consistency)
4. Arc Consistency and AC-3 Correctness
5. AC-3 Complexity: The O(e·d³) Bound
6. Why Heuristics Help: Expected Branching and Fail-First
7. NP-Completeness of CSP
8. Relation to SAT and the Dichotomy Theorem
9. Tractable Islands: Structure and Language Restrictions
10. Reformulation: Dual and Hidden-Variable Encodings
11. Local Consistency vs Global Consistency
12. Formalizing the Canonical CSPs
13. Path Consistency Mechanics
14. Complexity Reference
15. The Algebraic View: Polymorphisms
16. Phase Transitions and Average-Case Hardness
17. Summary
18. Further Reading

---

## 1. Formal Definition of a CSP

**Definition 1.1 (CSP).** A constraint satisfaction problem is a triple `P = (X, D, C)` where:

- `X = {x₁, …, xₙ}` is a finite set of **variables**.
- `D = {D₁, …, Dₙ}`, where `Dᵢ` is the finite **domain** of `xᵢ`.
- `C = {c₁, …, c_m}` is a set of **constraints**. Each constraint `c_j` is a pair `(S_j, R_j)` where `S_j ⊆ X` is the **scope** (the variables it involves) and `R_j ⊆ ∏_{xᵢ ∈ S_j} Dᵢ` is the **relation** — the set of tuples permitted on that scope.

**Definition 1.2 (Assignment).** A *partial assignment* is a function `a` from a subset `Y ⊆ X` to values with `a(xᵢ) ∈ Dᵢ`. It is *complete* when `Y = X`.

**Definition 1.3 (Satisfaction).** A complete assignment `a` **satisfies** constraint `(S, R)` iff the tuple `a|_S` (the restriction of `a` to scope `S`) belongs to `R`. `a` is a **solution** iff it satisfies every constraint in `C`.

**Definition 1.4 (Consistency of a partial assignment).** A partial assignment is **consistent** iff it violates no constraint *all of whose variables are assigned*. (A constraint with an unassigned variable is neither satisfied nor violated yet.)

**Arity.** A constraint of scope size 1 is **unary**, size 2 is **binary**, size `k` is `k`-ary. Any CSP can be converted to an equivalent **binary CSP** (via the dual or hidden-variable encoding), so the theory of binary CSPs is essentially general; this is why arc consistency (a binary notion) is so central.

The decision problem is: *does `P` have a solution?* This is the question we analyze for complexity.

**Worked instance.** A 3-coloring CSP on the path `A – B – C`:

```
X = {A, B, C}
D = { D_A = D_B = D_C = {R, G, B} }
C = { c₁ = ({A,B}, R≠),  c₂ = ({B,C}, R≠) }
where R≠ = { (R,G),(R,B),(G,R),(G,B),(B,R),(B,G) }   (the "different" relation)
```

A complete assignment such as `a = {A↦R, B↦G, C↦R}` satisfies both constraints (`(R,G)∈R≠` and `(G,R)∈R≠`), so `a` is a solution. The partial assignment `{A↦R, B↦R}` is *inconsistent* because constraint `c₁` is fully assigned and `(R,R)∉R≠`. The partial assignment `{A↦R}` is *consistent* (no fully-assigned constraint is violated) even though it is not yet a solution. These three states — solution, inconsistent partial, consistent-but-incomplete partial — are exactly the cases the backtracking termination conditions distinguish.

**Why the relation form matters.** Writing constraints as explicit tuple-sets `R_j` (an *extensional* representation) is fully general but can be exponentially large; most solvers store constraints *intensionally* as a predicate (e.g. the function `λ(x,y). x ≠ y`) and only materialize tuples when a `table` constraint is genuinely arbitrary. The theory uses the extensional view; engineering uses the intensional one. Both define the same relation `R_j`.

**Constraint graph and hypergraph.** The *constraint graph* of a binary CSP has a node per variable and an edge per binary constraint; for general CSPs the *constraint hypergraph* has a hyperedge per constraint scope. Structural complexity results (treewidth, Section 9) are stated on these (hyper)graphs. The same map-coloring instance above has constraint graph `A – B – C`, a path of treewidth 1 — which (Section 11) is exactly why arc consistency decides it.

**Notation recap.** Throughout: `n` = number of variables, `d` = maximum domain size, `e` = number of directed binary arcs, `m` = number of constraints, `w` = treewidth of the constraint graph. The two parameters that dominate every bound are `d` (the branching base) and the structural parameter (`w`, or the language's polymorphisms). Keeping `d` small (tight domains via propagation) and `w` small (decomposition) are the two levers that move an instance from intractable toward polynomial.

---

## 2. Backtracking Search: Soundness and Completeness

Backtracking explores the tree of partial assignments depth-first, extending a consistent partial assignment one variable at a time and retracting on dead ends.

**Algorithm (chronological backtracking).**
```
BT(a):
    if a is complete: return a
    x ← an unassigned variable
    for each v ∈ D_x:
        if a ∪ {x=v} is consistent:
            r ← BT(a ∪ {x=v})
            if r ≠ fail: return r
    return fail
```

**Theorem 2.1 (Soundness).** If `BT(∅)` returns an assignment `a`, then `a` is a solution.

*Proof.* `BT` only returns from the base case, where `a` is complete. Every extension step preserves consistency (it is guarded by the consistency test), so by induction the returned complete assignment is consistent, hence (being complete) satisfies every constraint. ∎

**Theorem 2.2 (Completeness).** If `P` has a solution, `BT(∅)` returns one; if `P` has no solution, `BT(∅)` returns `fail`.

*Proof.* The recursion tree contains every consistent partial assignment as a node, because at each node we branch on *all* values of the chosen variable, pruning only inconsistent extensions — and an inconsistent partial assignment cannot be a prefix of any solution. Thus every solution appears as a leaf of the explored tree (no solution-prefix is ever pruned). The search visits leaves until it finds a complete consistent one or exhausts the (finite) tree, returning `fail` only after confirming no leaf is a solution. ∎

**Termination.** The tree has depth `n` and finite branching `≤ d = max|Dᵢ|`, so it is finite; backtracking terminates. The worst-case number of leaves is `O(dⁿ)`.

Crucially, *adding sound propagation (forward checking, AC-3, MAC) preserves soundness and completeness*: propagation only removes values that cannot appear in any solution extending the current assignment, so no solution is lost, and it only prunes — it never accepts an inconsistent leaf.

**Lemma 2.3 (Propagation soundness).** Let `a` be the current partial assignment and let `prune(D)` be a step that removes value `v` from domain `Dₓ` only when no extension of `a` with `x = v` satisfies some constraint. Then every solution extending `a` is preserved.

*Proof.* Suppose `s` is a solution extending `a` with `s(x) = v`, and `v` is pruned. By the pruning condition, no extension of `a` with `x = v` satisfies some constraint `c`; but `s` is such an extension (it extends `a` and sets `x = v`) and, being a solution, satisfies `c` — contradiction. Hence no pruned value participates in a solution extending `a`. ∎

Forward checking, AC-3, and MAC are all instances of `prune` satisfying Lemma 2.3's condition (a removed value provably has no consistent partner), so combining any of them with backtracking yields a sound, complete solver. This modularity — search engine plus an interchangeable propagation oracle — is the architectural reason one solver core handles every CSP.

**Search-tree size.** Let `b̄` denote the *average* effective branching factor after pruning at each level. The number of internal nodes visited is `Θ(b̄ⁿ)` in the worst case but, with strong propagation, `b̄` can collapse toward 1 on structured instances (when propagation forces most variables), which is the empirical reason MAC often visits near-linearly many nodes despite the `O(dⁿ)` bound.

**Worked completeness trace.** Consider three variables `x, y, z` with domains `{1, 2}` and constraints `x ≠ y`, `y ≠ z`, `x = z`. Backtracking with fixed order `x, y, z`:

```
x=1:  y∈{1,2}, y≠x ⇒ y=2:  z: z≠y ⇒ z∈{1}; z=x ⇒ z=1.  ✓ z=1 works → SOLUTION (1,2,1)
```

The very first consistent leaf is a solution, so the search returns immediately — but had `x = z` been `x ≠ z` instead, *every* leaf would fail and the engine would exhaust all `2³ = 8` paths before correctly returning `fail`. This concretely exhibits both halves of Theorem 2.2: a solution is found when one exists (the tree contains it as a leaf), and `fail` is returned only after the entire finite tree is checked.

---

## 3. The Consistency Hierarchy (Node / Arc / Path / k-Consistency)

Local consistency notions characterize "how locally repairable" a CSP is. Let domains be the current (possibly pruned) `Dᵢ`.

**Node consistency (1-consistency).** Every value in every domain satisfies all *unary* constraints on that variable. Enforced trivially by deleting violating values.

**Arc consistency (2-consistency on binary constraints).** For every binary constraint `(xᵢ, xⱼ)` and every `vᵢ ∈ Dᵢ`, there exists `vⱼ ∈ Dⱼ` with `(vᵢ, vⱼ) ∈ R`. We say `vᵢ` has a *support* in `Dⱼ`.

**Path consistency (3-consistency).** For every pair of values `(vᵢ, vⱼ)` consistent on constraint `(xᵢ, xⱼ)`, and every third variable `x_k`, there is a value `v_k ∈ D_k` consistent with both. Path consistency reasons about *pairs* and may tighten the allowed pairs (not just domains), so it is recorded on constraints, not just domains.

**k-consistency.** A CSP is `k`-consistent iff every consistent assignment to any `k−1` variables can be extended to a consistent assignment including any `k`-th variable. Node = 1-consistency, arc = 2-consistency, path = 3-consistency.

**Strong k-consistency.** `j`-consistent for all `j ≤ k`.

**Theorem 3.1.** If a CSP on `n` variables is **strongly `n`-consistent**, it can be solved **without backtracking** (greedily assign variables in any order; each can always be extended).

The hierarchy is a ladder of pruning power vs cost: enforcing `k`-consistency costs `O(nᵏ·dᵏ)` in general and may *add* constraints of arity up to `k−1`. In practice we stop at arc consistency (sometimes path/singleton arc consistency) because the cost grows too fast. This is precisely why arc consistency (AC-3) is the workhorse.

**The consistency levels compared on one instance.** Variables `x, y, z`, domains `{1, 2}`, constraints `x ≠ y`, `y ≠ z`, `x ≠ z` (the triangle):

| Level | Prunes anything? | Concludes |
|-------|------------------|-----------|
| Node (1) | no unary constraints | nothing |
| Arc (2) | no — every value has a differing partner | "looks fine" (but it isn't) |
| Path (3) | yes — pair `(x=1, z=2)` has no `y` differing from both? `y∈{1,2}`, needs `y≠1 ∧ y≠2` → impossible; *every* pair fails | **unsatisfiable** |

This single example is the canonical demonstration that *arc consistency is too weak for triangles* while *path consistency is strong enough* — and simultaneously that path consistency's extra power costs the `O(n³d³)` of reasoning about pairs. The general lesson: the minimum consistency level that *decides* an instance equals `treewidth + 1` (Section 11), and a triangle has treewidth 2.

---

## 4. Arc Consistency and AC-3 Correctness

`REVISE(xᵢ, xⱼ)` deletes from `Dᵢ` every value with no support in `Dⱼ`; it returns whether it deleted anything.

```
AC-3:
    Q ← all directed arcs (xᵢ, xⱼ) with a binary constraint
    while Q ≠ ∅:
        (xᵢ, xⱼ) ← Q.pop()
        if REVISE(xᵢ, xⱼ):
            if Dᵢ = ∅: return INCONSISTENT
            for each x_k ∈ neighbors(xᵢ) \ {xⱼ}:
                Q.add((x_k, xᵢ))
    return CONSISTENT(arc consistent)
```

**Theorem 4.1 (Soundness of value removal).** Any value removed by `REVISE` belongs to no solution.

*Proof.* If `vᵢ ∈ Dᵢ` has no support in `Dⱼ` under constraint `(xᵢ, xⱼ)`, then no complete assignment with `xᵢ = vᵢ` can satisfy that constraint (whatever `xⱼ` takes, the pair is forbidden). Hence `vᵢ` is in no solution and is safely removed. ∎

**Theorem 4.2 (Correctness of AC-3).** AC-3 terminates and, on termination, the CSP is arc consistent (or proven inconsistent via an empty domain).

*Proof.* *Termination:* each `REVISE` that returns true removes at least one value; total values are bounded by `n·d`, and arcs are only re-enqueued after a removal, so the total enqueues are bounded — the loop terminates. *Arc consistency at termination:* suppose some arc `(xᵢ, xⱼ)` is not consistent at the end, i.e. some `vᵢ ∈ Dᵢ` lost its support. Support is lost only when `Dⱼ` shrinks. The last time `Dⱼ` shrank, AC-3 enqueued every arc `(x_k, xⱼ)` with `x_k` a neighbor — including `(xᵢ, xⱼ)`. That arc would have been revised afterward, removing `vᵢ` — contradiction. Hence all arcs are consistent. ∎

**Theorem 4.3 (Confluence).** The fixpoint AC-3 reaches is **unique**: it is the largest arc-consistent sub-domain set contained in the input domains, independent of the order arcs are processed.

*Proof sketch.* `REVISE` is a monotone (inflationary-by-removal) operator; the set of arc-consistent domain-tuples is closed under intersection, so a unique greatest fixpoint exists, and any fair processing order converges to it. ∎

**Order independence in practice.** Confluence (Theorem 4.3) means you may process the arc queue as a stack, FIFO queue, or priority queue and reach the *same* reduced domains — only the *number of REVISE calls* differs. This is what licenses optimizations like the **"revise the cheapest arc first"** ordering (process arcs whose tail domain is smallest) without any risk to correctness; you are merely choosing a faster path to the unique fixpoint. It also means AC-3 can be safely parallelized with eventual-consistency semantics on the queue: as long as every dirtied arc is eventually revised, the result is deterministic.

**Why empty-domain implies global inconsistency.** If `REVISE` empties `Dᵢ`, then *every* value of `xᵢ` lacked support; since each removal was sound (Theorem 4.1), no solution can assign `xᵢ` any value — so the CSP has no solution at all. Thus an empty domain during AC-3 is a *certificate of unsatisfiability*, valid even before search begins. The converse fails (Section 11): a non-empty arc-consistent state does not certify satisfiability.

---

## 5. AC-3 Complexity: The O(e·d³) Bound

Let `e` be the number of directed arcs (`e = 2 ·` number of binary constraints) and `d = max|Dᵢ|`.

**Theorem 5.1.** AC-3 runs in `O(e · d³)` time.

*Proof.* Consider a fixed arc `(xᵢ, xⱼ)`. It is initially enqueued once, and re-enqueued only when `Dᵢ` shrinks (an arc `(xᵢ, xⱼ)` is added when *its tail's* domain `Dᵢ`... — more precisely arc `(x_k, xᵢ)` is enqueued when `Dᵢ` shrinks). Each domain can shrink at most `d` times (one value per shrink). The number of arcs pointing *into* a given variable is at most its degree; summed over all removals, each arc is enqueued `O(d)` times. Each `REVISE(xᵢ, xⱼ)` costs `O(d²)`: for each of the `≤ d` values of `xᵢ`, scan up to `d` values of `xⱼ` for support. Therefore total work is `(number of arcs) × (re-enqueues per arc: d) × (cost per revise: d²) = e · d · d² = O(e·d³)`. ∎

**Tightening to O(e·d²).** AC-4, AC-6, and AC-2001 maintain support counters / last-support pointers so each support is examined `O(1)` amortized times, achieving the optimal `O(e·d²)` worst case. AC-3 is simpler and often faster in practice despite the worse bound, because its constant is small and many `REVISE` calls return immediately.

In terms of variables alone, with `e = O(n²)` for a dense binary CSP, AC-3 is `O(n²·d³)` — polynomial. Arc consistency is *cheap*; the exponential cost is entirely in the search it accelerates.

### Worked AC-3 trace

Take variables `x, y, z`, each with domain `{1, 2, 3}`, and constraints `x < y` and `y < z` (a chain). Directed arcs: `(x,y), (y,x), (y,z), (z,y)`.

```
init queue: [(x,y), (y,x), (y,z), (z,y)]

revise(x,y):  x=3 has no y>3 → remove 3.  Dx={1,2}.  shrank → enqueue (y,x)? (no incoming except y)
revise(y,x):  y=1 has no x<1 → remove 1.  Dy={2,3}.  shrank → enqueue (z,y)
revise(y,z):  y=3 has no z>3 → remove 3.  Dy={2}.    shrank → enqueue (x,y),(z,y)
revise(z,y):  z=1,z=2 have no y<them with y∈{2}? z=2 needs y<2, none in {2} → remove 1,2. Dz={3}.
revise(x,y):  x=2 needs y>2 in {2}? no → remove 2.  Dx={1}.
revise(z,y):  z=3 needs y<3 in {2}? yes → no change.
queue drains.
```

Result: `Dx={1}, Dy={2}, Dz={3}` — arc consistency *solved* this chain outright (all singletons), illustrating that on tree-structured CSPs (Section 9) arc consistency can decide and even solve. The number of `revise` calls (6) is well within the `e·d = 4·3 = 12` re-enqueue budget, each costing `O(d²)`.

---

## 6. Why Heuristics Help: Expected Branching and Fail-First

Model the search tree's size. If the chosen variable at depth `t` has effective branching factor `b_t` (number of consistent values tried before success/exhaustion), the tree size is roughly `∏_t b_t`. Heuristics aim to *minimize this product*.

**MRV / fail-first principle.** Selecting the variable with the **minimum remaining values** minimizes the branching factor *at that node* (you branch on the smallest domain), and — more importantly — front-loads inevitable failures. Formally, if a subtree must fail, doing so at a node with domain size 1 (which MRV prefers) makes that failure cost `O(1)` branches rather than `O(dⁿ⁻ᵗ)` deeper. Under the **kappa (κ) constrainedness** model of Gent et al., the variable with the fewest remaining values is (heuristically) the one most likely to be the bottleneck, so resolving it first prunes the most.

A clean special case: if some unassigned variable has domain size 1, MRV forces it (unit propagation), and a value of 0 is an immediate dead end detected without branching at all — the same reasoning that makes unit propagation dominant in SAT.

**Worked degree tie-break.** On the Australia map at the root, every region's domain is `{R, G, B}`, so MRV ties at size 3. Degree among unassigned neighbors:

```
WA:2   NT:3   SA:5   Q:3   NSW:3   V:2   T:0
```

The degree heuristic picks **SA** (degree 5). Assigning SA immediately prunes one color from each of its 5 neighbors, after which MRV (now discriminating, those neighbors have size 2) takes over. Branching on SA first rather than, say, T (degree 0, which constrains nothing) measurably reduces the tree: the high-degree variable maximizes the *number of domains forward checking can shrink per assignment*, front-loading constraint pressure exactly as the κ argument predicts.

**LCV / least-constraining-value.** Among *value* orderings, LCV maximizes the number of values left in neighbors' domains, i.e. it maximizes the *expected number of solutions* in the resulting subproblem (Haralick & Elliott / Geelen's promise heuristic estimates exactly this product of surviving domain sizes). Choosing the value that maximizes `∏_{neighbors} |surviving domain|` maximizes the chance the branch contains a solution, so for *satisfiable* instances seeking one solution, LCV reaches a leaf faster. For unsatisfiable instances every value is exhausted regardless, so value ordering is irrelevant — matching the empirical observation that LCV helps only on the satisfiable, single-solution case.

**Quantifying the fail-first gain.** Consider a balanced tree where a doomed subtree of `j` further variables would, without good ordering, be fully explored at cost `Θ(d^j)`. If MRV instead surfaces the conflicting variable (domain size 1 or 0) at the top of that subtree, the subtree collapses to `O(1)` or `O(d)`. Across the whole search the expected savings is the ratio of "depth at which the conflict is detected" between blind and MRV orderings; empirically this is the single largest constant-factor improvement available, frequently several orders of magnitude on random and structured instances alike.

**Why both heuristics point opposite ways.** MRV/degree minimize the *variable's* branching (most-constrained-variable), while LCV maximizes the *value's* surviving options (least-constraining-value). They are not contradictory: variable choice is about *which subtree to enter*, value choice is about *which order to enter a subtree's branches*. Optimal play minimizes branching on the dimension you are forced to exhaust (variables) and maximizes flexibility on the dimension where one success suffices (values).

These are *heuristics*, not guarantees: worst-case search remains `O(dⁿ)` (Section 7). They reduce the *expected* and *typical* tree size, which is what matters in practice.

---

## 7. NP-Completeness of CSP

**Theorem 7.1.** CSP (the decision problem "does a solution exist?") is **NP-complete**.

*Proof.*
*In NP:* a complete assignment is a certificate of size `O(n)`; checking it satisfies all `m` constraints takes polynomial time (evaluate each constraint's relation membership), so CSP ∈ NP.

*NP-hardness:* reduce from **3-COLORING**, itself NP-complete. Given a graph `G = (V, E)`, build a CSP with one variable per vertex, domain `{1, 2, 3}` (the three colors), and a binary constraint `xᵤ ≠ x_v` for each edge `(u, v) ∈ E`. A 3-coloring of `G` exists iff this CSP has a solution. The reduction is clearly polynomial. Hence CSP is NP-hard. ∎

Equivalently one can reduce from **3-SAT**: a variable per Boolean with domain `{T, F}` and a (ternary) constraint per clause permitting exactly the satisfying tuples. Either reduction shows the framework is as hard as the hardest problems in NP.

**Consequence.** No polynomial algorithm for general CSP is known (and none exists unless P = NP). All the machinery in this topic — heuristics, propagation, learning — fights the *constant and average-case* battle; it cannot defeat the worst-case exponential. This is why "tractable islands" (Section 9) matter.

**Worked reduction (3-SAT → CSP).** Take the 3-CNF formula `φ = (x₁ ∨ ¬x₂ ∨ x₃) ∧ (¬x₁ ∨ x₂ ∨ x₃)`. Build a CSP:

- Variables `X₁, X₂, X₃`, each domain `{0, 1}` (false/true).
- One ternary constraint per clause whose relation lists exactly the satisfying tuples. For clause `(x₁ ∨ ¬x₂ ∨ x₃)`, the *forbidden* tuple is `(X₁, X₂, X₃) = (0, 1, 0)` (the unique falsifying assignment); the relation permits the other 7 tuples.
- Likewise clause two forbids `(1, 0, 0)`.

Then `φ` is satisfiable iff the CSP has a solution (e.g. `X₁=1, X₂=1, X₃=0` satisfies both). The construction is linear in the formula size, completing the reduction. The symmetric direction (3-COLORING → CSP) was given above; together they show CSP sits squarely at the NP-complete level.

**Counting and beyond.** The *counting* version `#CSP` ("how many solutions?") is `#P`-complete (it generalizes counting graph colorings, the partition function of the Potts model). The *quantified* version `QCSP` (alternating ∀/∃ over variables) is `PSPACE`-complete, mirroring QBF. The plain satisfaction question we solve with backtracking is the NP-complete decision version.

---

## 8. Relation to SAT and the Dichotomy Theorem

**SAT as a CSP.** Boolean satisfiability is the CSP with all domains `{0, 1}` and constraints given by clauses (each clause forbids exactly one tuple — the all-falsifying one for its literals). Conversely a finite-domain CSP encodes into SAT (direct/order encodings, Section 6 of `senior.md`), so CSP and SAT are inter-reducible in polynomial time; both are NP-complete.

**Constraint languages and Schaefer/Bulatov-Zhuk.** Fix a finite set `Γ` of allowed relations (a *constraint language*); `CSP(Γ)` is the family of CSPs whose constraints are drawn only from `Γ`.

- **Schaefer's Dichotomy Theorem (1978)** for Boolean domains: `CSP(Γ)` is in **P** if `Γ` is 0-valid, 1-valid, Horn, dual-Horn, affine, or 2-SAT-like (bijunctive); otherwise it is **NP-complete**. There is *no* intermediate complexity (assuming P ≠ NP).
- **The Feder–Vardi Conjecture**, proved independently by **Bulatov** and **Zhuk (2017)**, generalizes this to *all finite domains*: every `CSP(Γ)` is either in P or NP-complete — a sweeping dichotomy with no intermediate cases. The boundary is characterized algebraically by the presence of a **weak near-unanimity polymorphism**.

This places CSP among the most beautifully understood NP problems: although the *general* problem is NP-complete, the complexity of every fixed-language restriction is pinned down exactly.

**Worked direct encoding (CSP → SAT).** Encode the map-coloring CSP on regions `{A, B}` with adjacency `A–B` and colors `{R, G, B}`:

```
Booleans:  a_R a_G a_B   b_R b_G b_B    (region_color)

At-least-one (each region has a color):
    (a_R ∨ a_G ∨ a_B)
    (b_R ∨ b_G ∨ b_B)

At-most-one (each region has ≤ 1 color), pairwise:
    (¬a_R ∨ ¬a_G) (¬a_R ∨ ¬a_B) (¬a_G ∨ ¬a_B)
    (¬b_R ∨ ¬b_G) (¬b_R ∨ ¬b_B) (¬b_G ∨ ¬b_B)

Edge constraint A ≠ B (forbid same color), one clause per color:
    (¬a_R ∨ ¬b_R) (¬a_G ∨ ¬b_G) (¬a_B ∨ ¬b_B)
```

Any SAT model of this CNF projects back to a proper coloring. For `k` colors and `n` regions the direct encoding uses `n·k` Booleans and `O(n·k²)` at-most-one clauses; for large `k`, *commander* or *sequential* encodings reduce the clause count to `O(n·k)`. **Order encoding** (`a ≥ d` Booleans) is preferred when constraints are inequalities (scheduling), because unit propagation then mimics bounds consistency.

The unit-propagation engine of a CDCL SAT solver, run on this encoding, performs exactly the forward-checking/arc-consistency reasoning a CP solver would — which is why "encode and call a SAT solver" is so often competitive.

---

## 9. Tractable Islands: Structure and Language Restrictions

Two orthogonal sources of tractability:

**(a) Structural (the constraint graph).**
- **Tree-structured CSPs** (the constraint graph is a tree) are solvable in `O(n·d²)`: root the tree, enforce *directional arc consistency* from leaves to root, then assign top-down with no backtracking. This follows because a tree is strongly 2-consistent after the sweep.
- **Bounded treewidth `w`** generalizes this: a CSP whose constraint graph has treewidth `w` is solvable in `O(n·d^{w+1})` via dynamic programming on a tree decomposition — polynomial for fixed `w`.
- **Cutset conditioning**: instantiate a cycle cutset of size `c` to reduce to a tree, giving `O(d^c · (n−c) d²)`.

**(b) Language (the relations).** As in Section 8, restricting which relations may appear (2-SAT, Horn, AllDifferent-only on a tree, etc.) can yield polynomial algorithms.

**Theorem 9.1 (Tree CSP).** A tree-structured binary CSP is solvable in `O(n·d²)` time, and arc consistency *decides* it (arc consistency on a tree implies global consistency).

*Proof sketch.* Order variables so each has at most one parent (tree order). A single backward pass of `REVISE(child, parent)`... actually `REVISE(parent, child)` from leaves to root makes the tree directionally arc consistent in `O(n·d²)`. Then assigning root-to-leaf, each variable always has a supported value by construction — no backtracking, and emptiness during the sweep certifies unsatisfiability. ∎

These results explain *why* practical solvers invest in propagation and decomposition: real instances often have low effective width, where polynomial behavior emerges.

### Solving a tree CSP by dynamic programming

The `O(n·d²)` bound is realized by message passing on the tree (equivalent to the directional-AC sweep). Root the tree at `r`; process leaves to root computing, for each variable `xᵢ` with parent `xₚ`, a table `feasible(xᵢ, vₚ)` = "does `xᵢ` have a value consistent with `xₚ = vₚ` and with all of `xᵢ`'s already-processed children?":

```
for xi in post-order (leaves first):
    for each value vp in domain(parent(xi)):
        feasible(xi, vp) = OR over vi in domain(xi) of
            [ constraint(xi=vi, parent=vp) AND
              (for every child c of xi: child_supports(c, vi)) ]
    prune from domain(parent) every vp with feasible(xi,vp)=false
```

Each variable contributes `O(d²)` work (its own value × parent value), so the sweep is `O(n·d²)`. After it, a top-down assignment pass never backtracks. This is precisely why **arc consistency decides tree CSPs** (Theorem 9.1): the message tables *are* the arc-consistent domains, and on a tree there is no cycle to create the "locally fine, globally impossible" gap.

### Counting solutions on a tree

The same recursion with `OR → sum` and the Boolean test weighted by 1 counts solutions in `O(n·d²)` — a rare case where even `#CSP` is polynomial (the general `#CSP` is `#P`-complete, Section 7). This is the CSP face of the transfer-matrix / belief-propagation method on trees.

### Forward checking vs MAC: node count contrast

On the Australia map (which has a near-tree structure with one cycle through SA), the difference is small. On a hard, near-critical random instance the gap is dramatic. A representative measurement pattern:

```
              nodes explored   propagations   wall-clock
blind BT          1.2M             —             slowest
BT + MRV          48k              —             fast
BT + MRV + FC     9.1k            27k            faster
BT + MRV + MAC    340            210k            fewest nodes, but heavy per node
```

MAC visits ~27× fewer nodes than forward checking but runs ~8× more propagation work *per node*. Whether MAC wins on wall-clock depends entirely on whether the per-node propagation cost is repaid by the avoided nodes — which is why the senior guidance is "measure both." The theory guarantees only that MAC's node set is a *subset* of forward checking's (stronger propagation never explores more nodes), never that it is faster in time.

---

## 10. Reformulation: Dual and Hidden-Variable Encodings

Any non-binary CSP can be converted to an equivalent binary one, which is what lets the (binary) arc-consistency theory cover the general case.

**Dual encoding.** Make each *constraint* a variable whose domain is the set of *tuples* it permits. Two dual-variables that share an original variable get a binary constraint forcing them to agree on that shared variable's value. Solving the dual CSP recovers a solution of the original.

**Hidden-variable encoding.** Keep the original variables *and* add one hidden variable per constraint (domain = permitted tuples), with binary constraints linking each hidden variable to the originals in its scope (the hidden tuple must project to the original's value).

```
original:  AllDifferent(A,B,C) over {1,2,3}
hidden H_ABC domain = { (1,2,3),(1,3,2),(2,1,3),(2,3,1),(3,1,2),(3,2,1) }
binary links:  H_ABC[1]=A,  H_ABC[2]=B,  H_ABC[3]=C
```

These encodings trade a blow-up in domain size (tuples can be exponential in arity) for a uniform binary structure. In practice solvers keep non-binary constraints native and use **generalized arc consistency (GAC)** propagators instead — but the encodings are the theoretical bridge proving binary CSP theory loses no generality, and they explain why arity, not just variable count, drives difficulty.

---

## 11. Local Consistency vs Global Consistency

A subtle but central point: **local consistency does not imply a solution exists.**

**Counterexample.** Three variables `x, y, z`, each domain `{a, b}`, with binary `≠` constraints on all three pairs (a triangle). This CSP is arc consistent — every value of every variable has a differing support in each neighbor — yet it is **unsatisfiable** (you cannot 2-color a triangle). Arc consistency removed nothing, but no solution exists.

This is the formal reason AC-3 (and even path consistency) is a *pruner*, not a *decider*, on general CSPs: it can prove unsatisfiability (by emptying a domain) and can sometimes solve (by reducing all domains to singletons), but in general search is still required.

**When does local consistency decide?**
- On **trees**, arc consistency decides (Theorem 9.1).
- More generally, if a CSP is **strongly `(w+1)`-consistent** where `w` is its treewidth, it is globally consistent and backtrack-free.
- **Global consistency** (every consistent partial assignment extends to a solution) is exactly strong `n`-consistency; achieving it is generally exponential, which is the whole difficulty restated.

The practical discipline: enforce the strongest *affordable* local consistency (usually arc, sometimes singleton-arc or path on the tight sub-structure), then search the residual space — with the theory above telling you exactly when that residual is empty.

---

## 12. Formalizing the Canonical CSPs

The instances solved in sibling topics are all `(X, D, C)` triples. Pinning down each one makes the abstraction concrete and exposes why some need stronger consistency than others.

### N-Queens

- **Variables.** `X = {x₁, …, xₙ}`, one per row.
- **Domains.** `Dᵢ = {1, …, n}` — the column placed in row `i`.
- **Constraints.** For every pair `i ≠ j`:
  - column: `xᵢ ≠ xⱼ`;
  - diagonal: `|xᵢ − xⱼ| ≠ |i − j|`.

All constraints are binary, so plain arc consistency applies directly. The placement of one queen per *row* (rather than a Boolean per cell) is the modeling insight that shrinks the domain from `n²` cells to `n` columns. Arc consistency alone does not solve N-Queens (the constraint graph is the complete graph `Kₙ`, treewidth `n−1`), so search is essential; MRV + forward checking is the standard effective combination.

### Sudoku

- **Variables.** `X = {x_{r,c} : 1 ≤ r, c ≤ 9}`, one per cell.
- **Domains.** `D_{r,c} = {1, …, 9}`, reduced to a singleton for clues.
- **Constraints.** Nine `AllDifferent` constraints over each row, each column, and each 3×3 box. Decomposed, that is `≠` between each cell and its ≤ 20 *peers*.

Sudoku is the showcase for *generalized arc consistency* on `AllDifferent`: with a Régin/matching propagator, most published puzzles are solved by propagation with **zero** search. With only pairwise `≠`, search is needed. This is the cleanest practical demonstration of "modeling with global constraints beats solver tuning."

### Cryptarithmetic (SEND + MORE = MONEY)

- **Variables.** Letters `{S, E, N, D, M, O, R, Y}` plus carries `{c₁, c₂, c₃, c₄}`.
- **Domains.** Letters `{0..9}`, leading letters `{1..9}`, carries `{0, 1}`.
- **Constraints.** `AllDifferent` over the letters, plus per-column sums: `D + E = Y + 10c₁`, `N + R + c₁ = E + 10c₂`, `E + O + c₂ = N + 10c₃`, `S + M + c₃ = O + 10c₄`, `M = c₄`.

The arithmetic constraints are `k`-ary; bounds consistency on them combined with `AllDifferent` propagation prunes the space dramatically (`M = 1` follows instantly from `M = c₄` and `M ≠ 0`). This instance shows that real CSPs mix binary, global, and arithmetic constraints — the general framework absorbs them all behind the same backtracking core.

---

## 13. Path Consistency Mechanics

Path consistency (3-consistency) tightens *pairs* rather than domains. Represent each binary constraint as a 0/1 relation matrix `Rᵢⱼ` over `Dᵢ × Dⱼ`. The PC operator composes relations:

```
Rᵢⱼ ← Rᵢⱼ ∩ (Rᵢ_k ∘ R_kⱼ)    for every intermediate k
```

where `∘` is relational composition (matrix "Boolean product"). A pair `(a, b)` survives only if some `c` in `D_k` is compatible with both `a` (via `Rᵢ_k`) and `b` (via `R_kⱼ`). Iterating to a fixpoint (the PC-2 algorithm) costs `O(n³ d³)` time and `O(n² d²)` space — markedly more than AC-3's `O(e d³)`. Path consistency can prune what arc consistency cannot (it sees the triangle infeasibility *for pairs*), but the cost and the need to store explicit pair-relations make it rare in production except on small, tightly coupled sub-networks. **Singleton arc consistency (SAC)** — "is the CSP still AC after tentatively fixing each value?" — is a popular middle ground stronger than AC, cheaper than PC.

---

## 14. Complexity Reference

| Question | Complexity class | Note |
|----------|------------------|------|
| Does a solution exist? (CSP) | NP-complete | reduction from 3-SAT / 3-COLORING |
| How many solutions? (#CSP) | #P-complete | counting colorings / Potts partition function |
| ∀/∃-quantified CSP (QCSP) | PSPACE-complete | analogue of QBF |
| Enforce node consistency | O(n·d) | delete unary violators |
| Enforce arc consistency (AC-3) | O(e·d³) | O(e·d²) with AC-2001 |
| Enforce path consistency (PC-2) | O(n³·d³) | O(n²·d²) space |
| Tree-structured CSP | O(n·d²) | AC decides |
| Bounded treewidth `w` | O(n·d^{w+1}) | DP on decomposition |
| Cutset of size `c` | O(d^c · n·d²) | condition then tree-solve |

The table is the practitioner's map: pay for the strongest consistency your structure makes cheap, exploit treewidth where it is small, and fall back to search (NP-complete) only on the irreducibly hard core.

**Reading the table for a real instance.** Suppose an exam-scheduling CSP has 200 exams, 10 slots, and a conflict graph that, after analysis, has treewidth 4. The decision question is NP-complete in general, but *this* instance is solvable in `O(n·d^{w+1}) = O(200·10⁵) ≈ 2×10⁷` operations by DP on a tree decomposition — fast and exact. Had the treewidth been 40, that bound `10⁴¹` would be hopeless and you would rely on heuristic search + propagation + restarts, accepting that some inputs may time out. Measuring structural width *before* choosing an approach is the single most informative pre-solve analysis.

---

## 15. The Algebraic View: Polymorphisms

The reason the dichotomy theorem (Section 8) is *true* — and the tool used to prove it — is the algebraic theory of **polymorphisms**.

**Definition 14.1 (Polymorphism).** An operation `f : Dᵏ → D` is a *polymorphism* of relation `R` (of arity `r`) if applying `f` coordinate-wise to any `k` tuples of `R` yields a tuple still in `R`:

```
if t₁, …, t_k ∈ R then ( f(t₁[1],…,t_k[1]), …, f(t₁[r],…,t_k[r]) ) ∈ R.
```

`f` is a polymorphism of a constraint language `Γ` if it is a polymorphism of every relation in `Γ`.

**The dividing line.** Tractability of `CSP(Γ)` is governed *entirely* by which polymorphisms `Γ` admits (the "Galois connection" between relations and operations):

- A language with only the trivial projection polymorphisms is **NP-complete**.
- A language admitting a **weak near-unanimity (WNU)** operation `w` (one satisfying `w(y,x,…,x) = w(x,y,x,…,x) = … = w(x,…,x,y)`) is in **P** — this is exactly the Bulatov–Zhuk characterization.

**Examples.**
- 2-SAT is tractable because its relations are closed under the **majority** operation `maj(x,y,z)` (which is a WNU); majority-closed languages are solvable by establishing path consistency.
- Horn-SAT is tractable because its relations are closed under **min** (a semilattice operation, also WNU).
- Linear equations over a finite field are tractable because they are closed under the **affine** operation `x − y + z`.
- General 3-SAT and 3-COLORING admit only projections → NP-complete.

This is why "which relations may appear" decides everything: the operations preserving those relations determine whether a polynomial algorithm (built from consistency enforcement of the right level) exists.

**Worked polymorphism check.** Is `maj` a polymorphism of the 2-SAT relation `R = {(0,0),(0,1),(1,1)}` (i.e. `x → y`, equivalently `¬x ∨ y`)? Take any three tuples `t₁, t₂, t₃ ∈ R` and apply `maj` coordinate-wise. For example `t₁=(0,0), t₂=(0,1), t₃=(1,1)`:

```
coord 1: maj(0,0,1) = 0
coord 2: maj(0,1,1) = 1
result:  (0,1) ∈ R  ✓
```

Checking all triples confirms closure, so `R` (and hence all of 2-SAT) admits `maj` → 2-SAT is in P, consistent with its well-known linear-time algorithm. By contrast, the 3-COLORING relation `R≠` over `{R,G,B}` admits no WNU operation (only projections), pinning 3-COLORING as NP-complete. This is the dichotomy theorem applied by hand.

---

## 16. Phase Transitions and Average-Case Hardness

Worst-case NP-completeness coexists with the empirical fact that *most* random CSPs are easy. The bridge is the **phase transition**.

Parametrize random binary CSPs by the **constraint tightness** and the **constraint density** (ratio of constraints to variables). As density crosses a critical threshold:

- **Under-constrained** instances (low density) have many solutions; backtracking finds one almost immediately — easy.
- **Over-constrained** instances (high density) have no solution and propagation refutes them fast — also easy.
- **Critically constrained** instances near the threshold are where solutions are rare and hard to find or refute — the famous **"hard region"** where median runtime peaks sharply.

The **constrainedness** parameter `κ` (Gent, MacIntyre, Prosser, Walsh) unifies this: `κ ≈ 1` marks the transition. The MRV heuristic's theoretical justification is that it greedily reduces `κ` of the residual problem fastest, steering search away from the hard region. The heavy-tailed runtime distributions observed near the threshold are exactly what motivate **randomized restarts** (Section 7 of `senior.md`): a restart resamples from the tail, escaping an unlucky early commitment.

**Takeaway for engineers.** "NP-complete" is a worst-case label; the instances you actually face cluster either in the easy regimes or near a measurable threshold. Knowing where your workload sits (by sampling `κ`) tells you whether cheap heuristics suffice or whether you must invest in learning, restarts, and decomposition.

**The constrainedness formula.** For a random binary CSP with `n` variables of uniform domain size `m`, `C` constraints, each forbidding a `p₂` fraction of value-pairs, constrainedness is

```
κ = ( C · log₂(1/(1 − p₂)) ) / ( n · log₂ m ).
```

Read it as "expected number of constraints to falsify, per bit of freedom in the search space." `κ < 1` → under-constrained (solutions abundant); `κ > 1` → over-constrained (likely unsatisfiable); `κ ≈ 1` → the critical hard region. A solver can *measure* `κ` of the residual subproblem at each node and choose to branch on the variable that drives `κ` down fastest — a principled restatement of why MRV (which targets the most-constrained variable) is the right greedy move.

**Backdoors.** Many "hard" structured instances have a small **backdoor**: a set of `b` variables such that, once they are assigned, propagation alone solves the rest. If `b` is small, search effectively costs `d^b · poly`, explaining why industrial SAT/CSP instances with millions of variables solve quickly despite worst-case bounds — they have tiny backdoors that good heuristics + learning find. This is the deepest practical reconciliation of NP-completeness with everyday tractability.

---

## 17. Summary

A CSP is formally `(X, D, C)` with variables, finite domains, and constraints as scope-relation pairs; a solution is a complete consistent assignment. Backtracking search is **sound and complete** because it branches on all values and prunes only inconsistent (non-extendable) prefixes, terminating on the finite depth-`n`, branching-`d` tree. The **consistency hierarchy** (node ⊂ arc ⊂ path ⊂ k-consistency) trades pruning power for cost; **arc consistency** is the sweet spot, enforced by **AC-3** which is correct (unique greatest fixpoint) and runs in `O(e·d³)` (optimally `O(e·d²)` with AC-2001). Heuristics reduce *expected* tree size: **MRV** minimizes branching and fails first (κ-constrainedness), **LCV** maximizes surviving solution density for the single-solution case. CSP is **NP-complete** (reduction from 3-COLORING / 3-SAT), inter-reducible with **SAT**, and governed by the **Bulatov–Zhuk dichotomy**: every fixed constraint language is in P or NP-complete with nothing between, characterized algebraically by polymorphisms. Tractable islands arise from **bounded treewidth** (tree CSPs in `O(n·d²)`, where arc consistency *decides* and even `#CSP` is polynomial) and restricted **constraint languages**. The deep caveat — **local consistency ≠ global consistency** (the arc-consistent-but-unsatisfiable triangle) — is exactly why heuristics and propagation accelerate, but do not eliminate, the worst-case exponential search. Phase-transition and backdoor theory explain why, in practice, the instances we meet are usually far easier than the worst case.

---

## 18. Further Reading

- Russell & Norvig, *Artificial Intelligence: A Modern Approach* — the CSP chapter (backtracking, MRV/LCV, forward checking, AC-3, MAC).
- Mackworth (1977), "Consistency in Networks of Relations" — the original AC-1/AC-3 paper.
- Bessière (2006), "Constraint Propagation" (in the *Handbook of Constraint Programming*) — AC-3/AC-4/AC-6/AC-2001 and complexity.
- Régin (1994), "A filtering algorithm for constraints of difference in CSPs" — GAC for `AllDifferent` via matching.
- Schaefer (1978), "The Complexity of Satisfiability Problems" — the Boolean dichotomy.
- Bulatov (2017) and Zhuk (2017) — the proofs of the Feder–Vardi dichotomy conjecture for all finite domains.
- Gent, MacIntyre, Prosser, Walsh (1996), "The Constrainedness of Search" — the κ parameter and phase transitions.
- Williams, Gomes, Selman (2003), "Backdoors to Typical Case Complexity" — why hard-looking instances solve fast.
- Dechter, *Constraint Processing* — comprehensive textbook on consistency, decomposition, and treewidth.
- Sibling topics `01-n-queens` and `02-sudoku` — concrete instances of the framework formalized in Section 12.
