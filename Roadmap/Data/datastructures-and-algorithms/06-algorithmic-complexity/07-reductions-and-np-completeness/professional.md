# Reductions and NP-Completeness — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [The Six-Step Workflow for Proving Your Problem Hard](#the-six-step-workflow-for-proving-your-problem-hard)
3. [The Source-Problem Cheat Sheet](#the-source-problem-cheat-sheet)
4. [Worked Example: Feature Scheduling with Conflicts Is NP-Hard](#worked-example-feature-scheduling-with-conflicts-is-np-hard)
5. [The Payoff: What Knowing It's NP-Complete Buys You](#the-payoff-what-knowing-its-np-complete-buys-you)
6. [Weak vs Strong NP-Hardness in Production](#weak-vs-strong-np-hardness-in-production)
7. [Encoding Your Problem for a Solver Is Itself a Reduction](#encoding-your-problem-for-a-solver-is-itself-a-reduction)
8. [Reduction Bugs and How to Test a Reduction](#reduction-bugs-and-how-to-test-a-reduction)
9. [Communicating the Result to the Team](#communicating-the-result-to-the-team)
10. [Decision Framework](#decision-framework)
11. [Research Pointers](#research-pointers)
12. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

The earlier tiers teach the machinery: a many-one reduction `A ≤ₚ B` is a poly-time map `f` with `x ∈ A ⇔ f(x) ∈ B`; you prove NP-hardness by reducing a known-hard problem *into* yours; gadgets carry the structure; Cook–Levin anchors the whole web ([`./senior.md`](./senior.md)). That tier is about *why* reductions work and the refined notions — log-space, parsimonious, approximation-preserving, weak vs strong.

This tier is about **doing it on the job**. Two questions dominate a practitioner's encounter with NP-completeness:

> **When a problem lands in your design doc and smells hard — how do you *prove* it, defensibly, with a citation?**
>
> **Once you know it's NP-complete — what changes about the code you ship?**

The answers are concrete and repeatable. Proving hardness is a disciplined six-step ritual with a small cheat sheet of source problems; you don't reinvent the reduction, you pattern-match your problem to the nearest of Karp's 21 and adapt a known gadget. Knowing it's hard is not a dead end — it *redirects* you: stop hunting for an exact polynomial algorithm, and instead pick deliberately among exact-exponential solvers, approximation with a guarantee, heuristics, and tractable special cases. The reduction you built often *tells you* which special case buys tractability.

The companion file [`../06-complexity-classes-p-np/professional.md`](../06-complexity-classes-p-np/professional.md) covers the response menu (solvers, FPT, metaheuristics) in depth and the "it's-NP-hard-now-what" playbook. This file focuses on the **proof workflow** and on two practitioner-critical refinements: weak-vs-strong hardness as a *production decision*, and encoding-for-a-solver as a reduction you write by hand. For inapproximability — when even approximation is provably hard — see [`../08-approximation-and-hardness/professional.md`](../08-approximation-and-hardness/professional.md).

---

## The Six-Step Workflow for Proving Your Problem Hard

You suspect a problem is intractable and want to write it down so that a skeptical reviewer signs off and the team stops asking "did you try harder?" Here is the disciplined workflow. Skipping a step is how design docs end up with reductions that prove nothing.

### Step 1 — State your decision problem precisely

NP-completeness is a property of **decision problems** (yes/no), not optimization problems. Your real task is probably "minimize X" or "find the best Y"; the first move is to carve out the decision version:

```text
Optimization:  "Pack items into the fewest bins."
Decision:      "Given items, bin capacity, and an integer k —
                can all items fit into at most k bins?"   (YES / NO)
```

Be ruthlessly precise about inputs, the question, and what counts as a YES. Imprecision here silently changes the problem and invalidates the reduction. If the optimization version is what you ship, prove the decision version hard; the optimization version is then NP-hard *a fortiori* (a poly-time optimizer would answer the decision question by comparing the optimum to `k`).

### Step 2 — Show your problem is in NP (exhibit a verifier)

NP-*completeness* = NP-hardness **plus** membership in NP. Membership is usually the easy half, and easy to forget. Exhibit a **certificate** and a **poly-time verifier**:

```text
Claim: BIN-DECISION ∈ NP.
Certificate: an assignment of each item to a bin (≤ k bins).
Verifier: check (a) every item is assigned, (b) ≤ k bins used,
          (c) each bin's load ≤ capacity. O(n) time. ✓
```

If you cannot write a poly-time verifier, your problem might be *harder* than NP (NP-hard but not in NP — e.g., PSPACE-complete game/quantifier problems, or co-NP-flavored "for all" questions). That itself is a finding worth surfacing: it means even a SAT solver won't directly express it as a single satisfiability query.

### Step 3 — Pick the right known NP-complete source problem

This is the craft step. You reduce **FROM a known NP-complete problem `H` TO your problem `X`** (`H ≤ₚ X`), proving *yours* is at least as hard. Pick the `H` whose **shape matches yours** — the closer the structural fit, the simpler the gadgets. The [cheat sheet below](#the-source-problem-cheat-sheet) maps problem shapes to source problems. Get this wrong and you'll fight the gadgets; get it right and the reduction is often nearly an identity map.

### Step 4 — Construct a poly-time reduction with gadgets

Define a map `f` from instances of `H` to instances of `X`. A **gadget** is a small, reusable sub-construction that translates one feature of `H` (a variable, a clause, a conflict) into a piece of an `X`-instance. Two non-negotiables:

- **`f` runs in polynomial time**, and the output instance has **polynomial size** in the input. A reduction that produces an exponentially large instance — or numbers with exponentially many digits when the target counts them in *unary* — is not a poly-time reduction and proves nothing. This is the single most common reduction bug.
- **`f` maps instances to instances**, blindly, *without solving `H`*. If your map needs to know `H`'s answer to build `f(x)`, it is not a reduction.

### Step 5 — Prove both directions of correctness

The reduction is correct iff `x ∈ H ⇔ f(x) ∈ X`. You must prove **both** arrows:

```text
(⇒)  x is a YES for H   ⟹   f(x) is a YES for X
(⇐)  f(x) is a YES for X ⟹   x is a YES for H
```

The forward direction shows your construction *can* represent a solution; the backward direction shows it can't be gamed — that a YES for `X` could *only* have come from a YES for `H`. Reviewers (and reductions) almost always fail on the **backward** direction: the gadget admits a "cheating" `X`-solution that doesn't correspond to any `H`-solution. Prove `(⇐)` with the same rigor as `(⇒)`; it is where reductions are won or lost.

### Step 6 — Conclude

State the chain explicitly:

> `H` is NP-complete (cite Karp 1972 / Garey & Johnson). We exhibited a poly-time reduction `H ≤ₚ X` (Steps 4–5) and a poly-time verifier for `X` (Step 2). Therefore `X` is **NP-hard**, and since `X ∈ NP`, `X` is **NP-complete**. We will not pursue an exact polynomial-time algorithm for the general case.

That paragraph converts "this feels hard" into "this is *provably* hard, here is the citation, here is why we are pivoting." It is the deliverable.

```text
  state decision   ──▶  in NP?        ──▶  pick source H    ──▶  build f
  problem (Step 1)      (Step 2)           (Step 3)              (Step 4)
                                                                   │
            conclude  ◀──  prove both  ◀───────────────────────────┘
            (Step 6)       directions (Step 5)
```

---

## The Source-Problem Cheat Sheet

You almost never reduce from Cook–Levin's tableau directly. You reduce from one of a handful of "anchor" problems whose hardness is established, choosing by **structural shape**. Internalize this table; it is the working vocabulary of hardness proofs.

| Your problem's shape | Reduce FROM | Why it fits |
|---|---|---|
| Arbitrary **logical / Boolean structure**, "satisfy these constraints" | **3-SAT** | The universal source; clauses encode any combinatorial constraint. Use when nothing more specific fits. |
| **Selection under pairwise conflict** — pick a set, no two chosen items conflict (or *cover* every conflict) | **Independent Set / Vertex Cover / Clique** | Conflicts are edges; the three are complements of each other, so pick whichever phrases your objective most directly. |
| **Numeric packing / balancing** — hit a target sum, split a multiset evenly, fit within a budget | **Subset-Sum / Partition / Knapsack** | Hardness lives in number *magnitude*; ideal when your constraints are arithmetic equalities/inequalities over weights. |
| **Sequencing / ordering / routing** — visit everything once, find a cheap tour or order | **Hamiltonian Cycle/Path / TSP** | Gadgets force a single traversal; use for "order N things subject to adjacency rules." |
| **Conflict-graph assignment into k categories** — color/label so adjacent things differ | **3-Coloring** | Categories are colors, "can't share" is an edge. The canonical model for register allocation, frequency assignment, exam timetabling. |
| **Covering** — choose fewest sets whose union covers a universe | **Set Cover** | Direct model for "minimum probes / sensors / tests covering all targets." |
| **Scheduling / packing where you need *strong* hardness** (rule out pseudo-poly DP) | **3-Partition** | Strongly NP-complete *with unary numbers* — the only way to prove no pseudo-polynomial algorithm exists. |

Two practitioner notes that save hours:

- **Independent Set, Vertex Cover, and Clique are the same problem in three costumes.** A set `S` is independent in `G` iff `V \ S` is a vertex cover iff `S` is a clique in the complement `Ḡ`. If your problem is "selection avoiding conflicts," all three are available — pick the one whose objective (maximize the kept set vs minimize the removed set) matches yours, so the reduction is an identity rather than a complement.
- **Reach for 3-Partition *only* when you specifically need to forbid pseudo-polynomial DP.** It is fiddly to reduce from. For ordinary "is this NP-hard?" a Subset-Sum or 3-SAT reduction is cleaner — but it only proves *weak* hardness, which (as we'll see) is often the *wrong* answer for a number-laden problem.

### Mapping common engineering problems to the cheat sheet

The table earns its keep when you recognize *your* system problem inside one of its rows. A field guide to the matches you'll actually meet:

| Engineering problem | Recognized as | Source / status |
|---|---|---|
| **Register allocation** (compilers) | Color the interference graph with `R` registers | 3-COLORING — NP-hard; chordal/SSA forms are tractable |
| **Dependency / package version resolution** | Satisfy version constraints = Boolean SAT | 3-SAT — NP-complete; modern resolvers (pubgrub, SAT-based apt/dnf) attack it as SAT |
| **Test-suite minimization** | Fewest tests covering all requirements | SET COVER — NP-hard; greedy gives `ln d`-approx, provably best possible |
| **Sensor / probe / cache placement** | Fewest locations covering all targets | SET COVER — same as above |
| **Shard / bin placement onto fixed hosts** | Pack items into `k` capacitated bins | BIN-PACKING — **strongly** NP-hard; value-DP useless, use FFD/solver |
| **Even load split across replicas** | Balance a multiset into equal halves | PARTITION — **weakly** NP-hard; DP wins if sizes are small |
| **Conflict-free scheduling / timetabling** | Assign into `k` slots, conflicts differ | 3-COLORING — NP-hard; interval structure is tractable |
| **Delivery / crawl ordering** | Cheapest tour visiting all nodes | TSP — **strongly** NP-hard; Christofides 1.5-approx (metric) |

The recognition skill is the real deliverable. "Version resolution is just SAT" or "test minimization is just Set Cover" is the sentence that both proves hardness *and* hands you the mature toolchain (a SAT solver, a greedy approximation with a tight bound) in one move.

---

## Worked Example: Feature Scheduling with Conflicts Is NP-Hard

A realistic system problem, taken end to end through the six steps. The setting: a release-planning service must schedule feature rollouts into time slots. Some features **conflict** — they touch the same subsystem and cannot ship in the same slot. We have `k` slots in the release window. *Can every feature be scheduled into one of `k` slots with no two conflicting features sharing a slot?* This is a real product question; let's prove it's hard.

### Step 1 — Precise decision problem

```text
FEATURE-SCHEDULE (decision):
  Input:  a set F of features; a set of conflict pairs E ⊆ F×F; an integer k.
  Question: is there an assignment slot: F → {1,…,k} such that
            slot(a) ≠ slot(b) for every conflict {a,b} ∈ E?
```

### Step 2 — Membership in NP

Certificate: the assignment `slot: F → {1,…,k}`. Verifier: iterate the conflict pairs, check `slot(a) ≠ slot(b)` for each, and check every slot index is in `{1,…,k}`. That is `O(|F| + |E|)` — polynomial. So FEATURE-SCHEDULE ∈ NP. ✓

### Step 3 — Pick the source problem

The shape is *conflict-graph assignment into k categories*: features are things, conflicts are "can't be together," slots are categories. The cheat sheet points straight at **GRAPH k-COLORING** (specifically **3-COLORING**, which is NP-complete). The fit is so tight that the reduction will be nearly an identity.

### Step 4 — The reduction (3-COLORING ≤ₚ FEATURE-SCHEDULE)

Given a graph `G = (V, E_G)`, the question "is `G` 3-colorable?" maps to FEATURE-SCHEDULE by:

```text
f(G) :  F  := V          (each vertex becomes a feature)
        E  := E_G        (each graph edge becomes a conflict pair)
        k  := 3          (three slots = three colors)
```

This is computable in linear time and the output has the same size as the input — clearly polynomial. No gadget is even required; the structural match is exact (an *identity-style* reduction).

### Step 5 — Both directions

- **(⇒)** If `G` has a proper 3-coloring `c: V → {1,2,3}`, set `slot := c`. Every edge `{u,v} ∈ E_G` is a conflict `{u,v} ∈ E`, and properness gives `c(u) ≠ c(v)`, so `slot(u) ≠ slot(v)`. The schedule is valid. ✓
- **(⇐)** If `f(G)` has a valid schedule `slot: V → {1,2,3}`, read it as a coloring. Every conflict `{u,v} ∈ E` is an edge `{u,v} ∈ E_G`, and validity gives `slot(u) ≠ slot(v)`, so adjacent vertices get different colors — a proper 3-coloring. ✓

Both directions hold because the map preserves the structure exactly; there is no slack for a cheating solution to sneak in.

### Step 6 — Conclude

> 3-COLORING is NP-complete (Karp 1972). We gave a poly-time reduction 3-COLORING ≤ₚ FEATURE-SCHEDULE and a poly-time verifier for FEATURE-SCHEDULE. Therefore FEATURE-SCHEDULE is **NP-complete**. We will not seek an exact polynomial-time scheduler for the general conflict graph.

### What the reduction *tells us* about the way forward

A good reduction is not just a tombstone — it is a map of where tractability hides. Because our problem *is* graph coloring, every structural result about coloring transfers for free:

- If conflict graphs are **interval graphs** (features model time intervals that conflict when overlapping), coloring is solvable in `O(n log n)` by a greedy sweep — **polynomial**. Many real conflict structures *are* interval-shaped.
- If the conflict graph is **bipartite** (two-sided conflicts only), 2-coloring is linear, and "can we use 2 slots?" is trivial.
- If `k = 2`, the decision is just bipartiteness — polynomial — and the hardness only bites at `k ≥ 3`.

So the very act of proving hardness pinned the exact knob (chromatic structure of the conflict graph, and the value of `k`) that separates the easy instances from the hard ones. This is the recurring payoff: *the reduction reveals the special case.* Register allocation (= coloring the interference graph) lives the same way — Chaitin's heuristic exploits that real interference graphs are usually near-chordal, and the hard core only surfaces under high register pressure.

### A second example with a real gadget: shard balancing

The coloring reduction above was an *identity* — no gadget needed because the shapes matched perfectly. Most reductions aren't that lucky; you build a gadget that *encodes* one problem's features in another's vocabulary. Here is a contrasting numeric case.

The setting: a storage layer must split `n` shards (each with a known byte-size `wᵢ`) across **two replica hosts** so the two hosts carry **exactly equal** total bytes — a perfectly balanced split for symmetric failover. *Is an exactly-balanced split possible?* This is **PARTITION**, and proving it hard shows the numeric-gadget flavor.

- **Decision form.** Given sizes `w₁,…,wₙ`, is there a subset `A` with `Σ_{i∈A} wᵢ = Σ_{i∉A} wᵢ` (each side = half the total)?
- **In NP.** Certificate: the subset `A`. Verifier: sum both sides, check equality. `O(n)`. ✓
- **Source problem.** The cheat sheet says *numeric balancing* → **SUBSET-SUM** (or PARTITION directly). We reduce SUBSET-SUM ≤ₚ PARTITION to show ours is hard.
- **The gadget.** Given a SUBSET-SUM instance (multiset `S` with sum `Σ`, target `t`), we want a PARTITION instance that balances iff some subset of `S` hits `t`. The gadget is **two extra padding elements** that force the partition boundary to land at `t`:

```text
Build PARTITION instance S' = S ∪ { p₁ , p₂ }  where
    p₁ = 2Σ − t        p₂ = Σ + t
Total of S' = Σ + (2Σ − t) + (Σ + t) = 4Σ,  so each balanced side must sum to 2Σ.
The two pads can't share a side (p₁ + p₂ = 3Σ > 2Σ), so they split.
The side holding p₁ needs 2Σ − p₁ = t more from S  ⇔  some subset of S sums to t.
```

A subset of `S` sums to `t` **iff** `S'` splits evenly — both directions follow from the arithmetic above, and `f` is clearly linear-time. That two-element pad *is* the gadget: it translates "hit target `t`" into "balance the whole multiset." PARTITION is therefore NP-complete.

The practitioner lesson sharpens here: PARTITION is only **weakly** NP-complete (the hardness sits in number *magnitude*), so if your shard sizes are bounded — bytes rounded to MB, say `wᵢ ≤ 10⁶` — the `O(n·Σ)` pseudo-polynomial DP finds the exact balanced split in production. The gadget needed large numbers; your inputs don't have them; you win. This is the [weak-vs-strong](#weak-vs-strong-np-hardness-in-production) diagnostic in action, and it is *visible in the gadget*.

---

## The Payoff: What Knowing It's NP-Complete Buys You

The single most valuable consequence of a hardness proof is **permission to stop**. You stop burning sprints chasing a polynomial exact algorithm that, if it existed, would resolve `P vs NP`. NP-completeness is a redirect, not a verdict — it points you at a small, well-understood menu. Choose deliberately:

### (a) Exact-but-exponential — when `n` is small

If production instances are small (often `n ≤ 30–40`, sometimes into the thousands depending on structure), *just solve it exactly*. Reach for an industrial solver — ILP (Gurobi/CPLEX), SAT/SMT (Z3, CaDiCaL), or CP (OR-Tools CP-SAT) — or a tailored **branch-and-bound** / subset DP. A provably optimal answer from a mature solver beats a heuristic you'll spend a quarter tuning. "NP-hard but `n` is tiny" is the most under-exploited situation in industry. (Depth: [`../06-complexity-classes-p-np/professional.md`](../06-complexity-classes-p-np/professional.md).)

### (b) Approximation with a guarantee

When you need scale *and* a defensible quality bound, use an approximation algorithm with a **proven ratio** — a 1.5-approx tour (Christofides), an `H(d) ≈ ln d`-approx set cover (greedy). The value is the guarantee: you can write it into an SLA. But approximation is not always free — some problems are NP-hard to approximate beyond a threshold. Always pair the algorithm with its **inapproximability ceiling** before promising a ratio: [`../08-approximation-and-hardness/professional.md`](../08-approximation-and-hardness/professional.md).

### (c) Heuristics and metaheuristics

When the instance is large, structure is weak, and a proven bound isn't required, "demonstrably near-optimal in practice" beats "provably within 2× but too slow." Local search, simulated annealing, genetic algorithms, tabu search, LKH for routing. No guarantee — measure on real data and report the gap to a bound when you can compute one.

### (d) Exploit a tractable special case

Often the best move: notice your instances aren't the adversarial worst case at all. The reduction usually reveals **which restriction buys tractability** — because the gadgets it needed are exactly the features your inputs lack:

- **2-SAT, Horn-SAT, XOR-SAT** — if your Boolean constraints are naturally ≤ 2 literals, Horn (rules of "these imply that"), or XOR, satisfiability is *linear time*, no compromise.
- **Interval / chordal graphs** — coloring, independent set, and clique are polynomial; common when conflicts come from time intervals or nested scopes.
- **Bounded treewidth** — dependency graphs, structured control flow, and series-parallel workflows admit `O(f(w)·n)` DP for many NP-hard problems.
- **Planarity** — road networks and physical layouts admit PTASs (Baker) and faster exact algorithms.

The professional reflex: before conceding hardness, ask whether *your* instances fall into a polynomial island. The reduction told you where to look.

---

## Weak vs Strong NP-Hardness in Production

This distinction is not academic trivia — for a number-laden problem it **determines your production architecture**. The question is whether hardness survives when the numbers in the input are small.

### The two regimes

- **Weakly NP-complete** — NP-complete, but admits a **pseudo-polynomial** algorithm running in time polynomial in `n` *and the numeric value* `W` (not its bit-length). KNAPSACK and SUBSET-SUM are the canonical cases: the `O(n·W)` DP is pseudo-polynomial.
- **Strongly NP-complete** — stays NP-complete even when every number is written in **unary** (polynomially bounded). For these, **no pseudo-polynomial algorithm exists unless P = NP**. 3-PARTITION, BIN-PACKING, and general TSP are the workhorses.

### Why it changes what you ship

```text
Your problem is WEAKLY NP-complete (e.g., Knapsack / Subset-Sum):
   Are the numbers (weights, capacities, values) bounded by poly(n) in production?
      ├── YES  ──▶ the O(n·W) DP IS polynomial for your inputs. Ship it.
      │           Provably optimal, exact, fast. The NP-completeness never bites.
      └── NO   ──▶ numbers are huge → DP table is astronomical. Use FPTAS / ILP.

Your problem is STRONGLY NP-complete (e.g., Bin-Packing / 3-Partition scheduling):
   The DP-on-the-value won't save you, EVEN with small numbers.
      └──▶ go straight to approximation / solver / heuristic. Don't build the DP.
```

A concrete example: a budget-allocation feature is a Subset-Sum / Knapsack variant. If budgets are integer cents and bounded (say `W ≤ 10⁶`), the `O(n·W)` DP returns the *exact optimum* in milliseconds — a legitimate, production-grade, provably-optimal solution to an "NP-complete" problem. Reviewers who reflexively reject the DP "because it's NP-hard" are wrong; the weak hardness means the DP is the *correct* tool when numbers are small.

Contrast bin-packing of variable-size tasks onto fixed-capacity workers. It is *strongly* NP-complete — making the sizes small buys nothing, because the hardness is combinatorial (distributing items), not numeric. Here a value-DP is hopeless and you go directly to First-Fit-Decreasing (an `11/9·OPT + 1` approximation) or a solver.

**The diagnostic to run before despairing over a number-laden problem:** *is it weakly or strongly NP-complete, and are my numbers polynomially bounded?* The answer picks your algorithm. (The mechanism — number-magnitude vs combinatorial gadgets, and the no-FPTAS consequence of strong hardness — is in [`./senior.md`](./senior.md).)

---

## Encoding Your Problem for a Solver Is Itself a Reduction

When you decide to "throw it at a SAT/ILP solver," you are doing exactly what this topic studies: **reducing your problem to a universal NP-complete problem** that decades of engineering have made fast to attack. The encoding *is* a reduction — and like any reduction it can be wrong, so model it with the same discipline.

### Reducing to CNF-SAT

Express your decision problem as a Boolean formula in conjunctive normal form; a satisfying assignment is a solution. The art is choosing variables and clauses that capture your constraints exactly.

Take graph `k`-coloring (our FEATURE-SCHEDULE from above). Variables `x[v,c]` = "vertex `v` gets color `c`":

```text
At least one color per vertex:   for each v:  (x[v,1] ∨ x[v,2] ∨ … ∨ x[v,k])
At most one color per vertex:     for each v, c<c':  (¬x[v,c] ∨ ¬x[v,c'])
Adjacent vertices differ:         for each edge {u,v}, each color c:
                                      (¬x[u,c] ∨ ¬x[v,c])
```

Hand the conjunction to a CDCL solver; SAT ⇔ the graph is `k`-colorable. That is a textbook reduction *to* SAT, written by you, executed by the solver.

### Reducing to ILP

The same problem as a 0/1 integer program — variables `x_{v,c} ∈ {0,1}`:

```text
minimize    0                       (pure feasibility; or an objective if optimizing)
subject to  Σ_c x_{v,c} = 1         for every vertex v   (exactly one color)
            x_{u,c} + x_{v,c} ≤ 1   for every edge {u,v}, color c  (no clash)
            x_{v,c} ∈ {0,1}
```

Hand it to Gurobi/CPLEX. For *optimization* (minimize bins, maximize value), the ILP objective and bounds make this the natural target — solvers run to a small **optimality gap** rather than provable optimality, a disciplined production compromise.

### Modeling pitfalls (the reduction bugs of encoding)

- **Encoding size blowup.** A naive "at most one" over `k` colors needs `O(k²)` clauses per vertex; for large domains use a *sequential / commander* encoding to keep it linear. An encoding that is poly *in theory* but quadratic-or-worse *in your constants* can OOM the solver. Count clauses/variables as a function of your real sizes.
- **Symmetry.** Colors `1…k` are interchangeable, so the solver wastes effort exploring `k!` equivalent assignments. Add **symmetry-breaking** constraints (e.g., fix vertex 1 to color 1) — often a 10× speedup.
- **Weak relaxations (ILP).** A correct model can still have a loose LP relaxation that makes branch-and-bound crawl. "Big-M" constraints are the classic offender; tighten `M`, or reformulate with indicator constraints.
- **Wrong objective sense / off-by-one in bounds.** The model is satisfiable but answers a *slightly different* question. Test it (next section) against brute force on tiny instances exactly as you would test a hand-written reduction — because it *is* one.

### Choosing the target: SAT vs ILP vs CP

The "universal NP-complete problem" you reduce to isn't unique — pick by the *shape* of your constraints, just like the cheat sheet:

- **CNF-SAT** when constraints are purely **logical/Boolean** (configuration, dependency resolution, bounded model checking). CDCL solvers (CaDiCaL, Kissat) excel; add cardinality encodings for "at most `k`" counting.
- **ILP** when you have a **linear objective** and linear constraints with integer decisions (packing, assignment, routing with costs). Branch-and-cut plus the optimality gap gives you tunable "how optimal" control.
- **SMT** (Z3, CVC5) when constraints mix Booleans with **arithmetic, bit-vectors, or arrays** — you avoid manually bit-blasting integers into clauses; the theory solver handles it.
- **CP-SAT** (OR-Tools) for **scheduling/rostering** with global constraints (`AllDifferent`, `Cumulative`, `NoOverlap`) that prune far more powerfully than the equivalent raw clauses, while still lowering onto a SAT core underneath.

Encoding `k`-coloring into SAT (shown above) is the same problem as encoding it into ILP (shown above) — *different reductions to different universal problems*, and the better-fitting target solves an order of magnitude faster. Choosing the target wisely is itself a modeling decision worth a benchmark.

The professional default holds: **model for a mature solver before hand-rolling a heuristic.** A good CNF/ILP/CP model plus a decades-tuned solver beats most custom code at the sizes industry faces. The exception that proves the rule: when a benchmark shows the solver provably can't keep up with your latency budget on real instances, *then* you fall back to a heuristic or a special-case algorithm — and the hardness proof is what told you that fallback is principled, not lazy.

---

## Reduction Bugs and How to Test a Reduction

A reduction is *code-shaped logic*, and like code it has characteristic bugs. Treat it as a testable artifact, not a one-shot proof.

### The three recurring bugs

1. **Non-polynomial blowup.** The map produces an exponentially large instance, or — the subtle one — emits numbers that are exponential in *value* fed to a target that counts size in *unary*. A reduction with numbers of `Θ(2ⁿ)` magnitude is fine for proving *weak* hardness of a number problem but is **not a valid poly-time reduction** if the target's input size is measured in unary. Always confirm: output size = poly(input size), *including digit counts*.
2. **Wrong direction.** Reducing `X ≤ₚ H` (your problem into a known-hard one) proves your problem is *no harder than* `H` — the opposite of what you want, and usually trivially true and useless. You must reduce `H ≤ₚ X`. This error is shockingly common in design docs; the giveaway is a reduction that "uses a solver for the hard problem" inside `f`.
3. **Missing/false backward direction.** The construction admits a YES-solution on the `X` side that does not correspond to any YES on the `H` side — the gadget is *too permissive*. The forward direction looks fine, so the bug hides until someone finds the cheating solution. This is the most dangerous bug because the reduction *looks* complete.

### How to test a reduction empirically

You can't prove correctness by testing, but you can *refute* a broken reduction cheaply — and in practice this catches most real errors before they reach a reviewer.

- **Brute-force equivalence on small instances.** Implement `f`, plus a brute-force oracle for *both* `H` and `X`. Enumerate all small `H`-instances and assert `bruteforce_H(x) == bruteforce_X(f(x))`. A single counterexample exposes the bug, usually pointing at the failing direction.

```python
# Refute a candidate reduction f: instances of H -> instances of X.
def check_reduction(f, solve_H, solve_X, small_instances):
    for x in small_instances:                 # exhaustive over tiny inputs
        if solve_H(x) != solve_X(f(x)):       # YES/NO must agree
            return ("BROKEN", x, solve_H(x), solve_X(f(x)))
    return ("ok (not refuted on tested instances)",)
```

- **Property-based testing.** Generate random small `H`-instances and check the YES/NO agreement as an invariant. A generator that can produce both satisfiable and unsatisfiable instances is essential — a reduction that's only ever tested on YES-instances will never catch a broken **backward** direction (the one that fails on NO-instances mapping to YES). Bias the generator toward edge cases: empty inputs, single elements, all-conflict and no-conflict graphs.
- **Witness round-tripping.** Beyond YES/NO, check that a *solution* on one side maps to a valid solution on the other (and back). This tests the constructive content of both directions, not just the decision bit, and localizes which direction is broken.
- **Size assertions.** Add a runtime check that `|f(x)|` (and the bit-length of any numbers) grows polynomially across your test sizes. A reduction that passes correctness but fails the size budget is still invalid — and silently catastrophic in practice.

### A refutation in action

Suppose a colleague's design doc claims FEATURE-SCHEDULE is hard via this map: "each feature → a vertex; add an edge between two features iff they are in conflict; ask if the graph is **2-colorable**." Run the test harness over small instances and it fails immediately: take a triangle of three mutually-conflicting features. The brute-force coloring oracle says *not* 2-colorable (a triangle needs 3 colors), but the brute-force *schedule* oracle says it *is* schedulable with `k=3` slots. The YES/NO disagree — the reduction conflated "2-colorable" with the actual `k`-slot question. The harness pinpoints the off-by-`k` bug on the first odd cycle. That is the value of brute-force equivalence: a 3-node counterexample, found in milliseconds, refutes a plausible-looking but wrong reduction before it ships in a doc.

The mindset: a reduction in a design doc deserves the same skepticism as a merge request. Prove both directions on paper, then *try to break it* with brute-force equivalence and property tests before you cite it as the reason to abandon the exact algorithm.

---

## Communicating the Result to the Team

The deliverable of a hardness analysis is rarely code — it is a *decision communicated to non-specialists*, and "it's NP-complete" announced as a full stop is an anti-pattern. It should *start* the right conversation, not end it. A reliable structure:

1. **State the result plainly, with a citation.** "Optimal conflict-free release scheduling is NP-complete — it's graph coloring (Karp 1972)." The citation pre-empts "did you just not try hard enough?"
2. **Translate what it does and does *not* mean.** "This does *not* mean it's unsolvable or that our instances are slow. It means no algorithm is known that finds the *provably optimal* answer in polynomial time for *every* input, and finding one would resolve a famous open problem. Our instances are small/interval-structured, so we have good options."
3. **Present the viable paths with trade-offs.** A small *optimality × speed × instance-size* table — exact solver (optimal, small `n`), approximation (proven ratio, fast), heuristic (no guarantee, often best in practice), special-case (free when inputs are interval/bounded) — beats prose.
4. **Recommend, and own the guarantee.** "For our sizes: ILP exact under `n=40`; interval-greedy above, which is *optimal* on interval conflict graphs. Reported quality: optimal." Make the call and stand behind it.

The hardness proof is what gives this conversation its authority — without it, "let's just use a heuristic" sounds like giving up; with it, the same recommendation is the disciplined, defensible engineering choice.

---

## Decision Framework

| Situation | Reach for |
|---|---|
| Problem smells hard; need a defensible hardness claim | The **six-step workflow**: decision form → in NP → pick source → build `f` → both directions → conclude with citation |
| Choosing a source problem | The **cheat sheet** by shape: 3-SAT (logic), Ind.Set/VC/Clique (conflict selection), Subset-Sum/Partition/Knapsack (numeric), Ham/TSP (sequencing), 3-Coloring (conflict assignment), Set Cover (covering) |
| Need to rule out a **pseudo-polynomial** algorithm | Reduce from **3-Partition** (strongly NP-complete); a Subset-Sum reduction only proves *weak* hardness |
| Number-laden problem, before despairing | Classify **weak vs strong**; if weak and numbers are poly-bounded, the `O(n·value)` **DP is your production solution** |
| Strongly NP-complete (bin-packing, 3-partition) | Skip the value-DP entirely; go to approximation / solver / heuristic |
| Decided to use a solver | The **encoding IS a reduction** — model carefully in CNF-SAT or ILP; mind size blowup, symmetry, weak relaxations |
| Hardness proven; small `n` | **Exact** solver or branch-and-bound — ship the provably optimal answer |
| Hardness proven; need scale + a bound | **Approximation** with a proven ratio (and its inapproximability ceiling: [`../08-approximation-and-hardness/professional.md`](../08-approximation-and-hardness/professional.md)) |
| Hardness proven; large, unstructured, no bound needed | **Metaheuristic** (local search, annealing, tabu, LKH) |
| Want a free win | Check whether your instances live in a **tractable special case** the reduction revealed (2-SAT, Horn, interval, bounded treewidth, planar) |
| Built a reduction | **Test it**: brute-force equivalence + property tests on small instances, generating both YES and NO cases to exercise the *backward* direction |

---

## Research Pointers

- **Garey, M., & Johnson, D. (1979). *Computers and Intractability: A Guide to the Theory of NP-Completeness.*** The practitioner's bible — the reduction catalogue, the source-problem zoo, and the definitive treatment of strong vs weak NP-completeness and 3-PARTITION. If you keep one book on this shelf, it is this one.
- **Karp, R. (1972). "Reducibility Among Combinatorial Problems."** The original 21 NP-complete problems and the many-one reduction technique — your starter kit of source problems.
- **Cook, S. (1971). "The Complexity of Theorem-Proving Procedures."** SAT is NP-complete; the master reduction every later proof rides on.
- **Cormen, Leiserson, Rivest, Stein. *Introduction to Algorithms*, NP-completeness chapter.** Clean worked reductions (3-SAT ≤ CLIQUE ≤ VERTEX-COVER, SUBSET-SUM) at exactly the level you write in a design doc.
- **Kleinberg, J., & Tardos, É. *Algorithm Design*, ch. 8.** The best modern pedagogy on *how to choose* a source problem and structure a reduction — the "spirit of reductions" framing.
- **Williamson, D., & Shmoys, D. (2011). *The Design of Approximation Algorithms.*** Where to go once you've proven hardness — greedy Set Cover, LP rounding, ratios, and the link to inapproximability.
- **Biere, Heule, van Maaren, Walsh (eds.). *Handbook of Satisfiability.*** Practical CNF encodings (cardinality, at-most-one, symmetry breaking) — the reference for reducing your problem *to* SAT well.
- **Gurobi / OR-Tools modeling guides.** Idiomatic ILP/CP formulations, big-M pitfalls, and the optimality-gap discipline for the encoding-as-reduction path.

---

## Key Takeaways

1. **Proving hardness is a disciplined ritual, not inspiration.** Six steps: (1) state the *decision* problem precisely, (2) exhibit a poly-time verifier (membership in NP), (3) pick the source problem whose *shape* matches yours, (4) build a poly-time gadget reduction `H ≤ₚ X`, (5) prove *both* directions, (6) conclude with a citation. Skipping a step is how reductions end up proving nothing.
2. **Pick the source problem by shape.** 3-SAT for arbitrary logic; Independent Set / Vertex Cover / Clique for selection-under-conflict; Subset-Sum / Partition / Knapsack for numeric packing; Hamiltonian / TSP for sequencing; 3-Coloring for conflict-graph assignment; Set Cover for covering; **3-Partition only when you must rule out pseudo-polynomial DP**.
3. **The backward direction is where reductions are won or lost.** Forward shows your gadget *can* represent a solution; backward shows it *can't be cheated*. Reviewers and reductions fail on `(⇐)` — prove it with equal rigor.
4. **Knowing it's NP-complete is a redirect, not a dead end.** Stop chasing a polynomial exact algorithm; choose deliberately among exact-exponential solvers (small `n`), approximation with a guarantee, heuristics, and — often best — a **tractable special case the reduction itself revealed** (the gadgets it needed are the features your inputs lack).
5. **Weak vs strong NP-hardness decides your production architecture.** Weakly NP-complete (Knapsack, Subset-Sum) + poly-bounded numbers ⟹ the `O(n·value)` **pseudo-polynomial DP is a legitimate, provably-optimal production solution**. Strongly NP-complete (3-Partition, bin-packing) ⟹ the value-DP won't save you; go straight to approximation or a solver.
6. **Encoding for a solver is a reduction you write by hand.** Expressing your problem as CNF-SAT or ILP reduces it to a universal NP-complete problem solvers attack well. Model with discipline — watch encoding-size blowup, symmetry, and weak relaxations — and *test the encoding* like any reduction.
7. **Treat a reduction as testable code.** The three classic bugs are non-poly blowup (including unary-number magnitude), wrong direction (`X ≤ₚ H` proves nothing), and a missing/false backward direction. Refute broken reductions cheaply with brute-force equivalence and property-based tests that generate **both YES and NO instances** to exercise `(⇐)`.

---

> **See also:** [`./senior.md`](./senior.md) for Cook–Levin in full, the reduction taxonomy, and weak-vs-strong mechanics · [`../06-complexity-classes-p-np/professional.md`](../06-complexity-classes-p-np/professional.md) for the full response menu (solvers, FPT, metaheuristics) · [`../08-approximation-and-hardness/professional.md`](../08-approximation-and-hardness/professional.md) for when even approximation is provably hard
