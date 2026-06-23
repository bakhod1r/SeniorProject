# Constraint Programming — Middle Level

> **Roadmap:** [Programming Paradigms](../README.md) → Constraint Programming
> *A solver isn't magic and it isn't brute force. It interleaves two moves — shrink the domains by reasoning, then guess and backtrack — and most of its power is in the shrinking.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [A CSP, Formally](#a-csp-formally)
4. [Constraint Propagation & Arc Consistency](#constraint-propagation--arc-consistency)
5. [Backtracking Search + Propagation](#backtracking-search--propagation)
6. [Global Constraints](#global-constraints)
7. [Modeling a Problem End to End](#modeling-a-problem-end-to-end)
8. [SAT — Boolean Satisfiability](#sat--boolean-satisfiability)
9. [SMT — SAT Plus Theories](#smt--sat-plus-theories)
10. [The Family at a Glance](#the-family-at-a-glance)
11. [Common Mistakes](#common-mistakes)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does it actually work, and how do I model with it?**

At the junior level you described problems as variables, domains, and constraints, and trusted a solver to find values. Now we open the box. A modern constraint solver is built from two cooperating mechanisms: **constraint propagation** (deduce, without guessing, which values are now impossible and delete them) and **backtracking search** (when deduction stalls, guess a value, propagate again, and undo the guess if it fails). The order matters: propagation runs *first and constantly*, so search only guesses when reasoning has run out of road.

Understanding this loop changes how you write models. You stop treating the solver as an oracle and start treating it as a deduction engine you can help or hinder — because two logically equivalent models can differ by orders of magnitude in solve time depending on how much propagation they enable. This level builds the vocabulary (arc consistency, global constraints, CNF, theories) you need to reason about *why* a model is fast or slow, and introduces the two sibling technologies — **SAT** and **SMT** — that share constraint programming's DNA but specialize for different constraint shapes.

> **The mindset shift:** a solver doesn't "search the whole space." It *reasons the space smaller*, then searches what's left. Good modeling maximizes the reasoning and minimizes the searching.

---

## Prerequisites

- **Required:** The [junior level](junior.md) — variables, domains, constraints, the solve-vs-search distinction.
- **Required:** You've written a recursive backtracking search at least once (N-Queens, subset-sum, maze). We'll map the solver's internals onto that mental model.
- **Helpful:** Comfort with Boolean logic (AND/OR/NOT) and basic set operations (a domain is a set you shrink).
- **Helpful:** You know what "NP-hard" gestures at — these problems are hard in the worst case, which is *why* the clever machinery exists.

---

## A CSP, Formally

A **Constraint Satisfaction Problem** is a precise triple `⟨X, D, C⟩`:

- **X** — a finite set of **variables** `{x₁, x₂, …, xₙ}`.
- **D** — a **domain** `Dᵢ` for each variable: the finite set of values `xᵢ` may take.
- **C** — a set of **constraints**, each restricting the allowed *combinations* of values for some subset of variables.

A constraint over variables `(xᵢ, xⱼ)` is, formally, the set of value-pairs it *permits* — e.g., `x ≠ y` over domain `{1,2,3}` permits `{(1,2),(1,3),(2,1),(2,3),(3,1),(3,2)}` and forbids `(1,1),(2,2),(3,3)`. Constraints come by **arity**: *unary* (one variable, e.g. `x ≠ 3`), *binary* (two, e.g. `x < y`), and *global/n-ary* (many — covered below).

A **solution** is an assignment giving each `xᵢ` a value from `Dᵢ` such that *every* constraint is satisfied. Two distinct questions live here:

- **Satisfaction (CSP):** does *any* solution exist, and if so produce one. (`solve satisfy`)
- **Optimization (COP):** among all solutions, find one that minimizes or maximizes an **objective** function. (`solve minimize cost`)

CSPs are **NP-complete** in general (3-coloring, N-Queens, Sudoku-on-n² boards all reduce to CSP), so there's no known algorithm that's fast on every instance. The entire engineering art is making the *typical* instance fast — and that's what propagation and good modeling buy you.

---

## Constraint Propagation & Arc Consistency

**Propagation** is deduction without guessing: using the constraints to remove values that *cannot* be part of any solution, shrinking domains before and during search. It's the solver's most important trick.

The workhorse notion is **arc consistency** (AC). A directed arc `xᵢ → xⱼ` (from a binary constraint between them) is **consistent** when: *for every* value `a` in `Dᵢ`, there exists *some* value `b` in `Dⱼ` such that `(a, b)` satisfies the constraint. If some `a` in `Dᵢ` has *no* supporting `b`, then `a` can never appear in a solution — so we **delete `a` from `Dᵢ`**. A CSP is arc-consistent when every arc is. The classic algorithm that enforces it is **AC-3**: maintain a queue of arcs, revise each, and whenever a domain shrinks, re-enqueue the arcs pointing *into* the shrunken variable (its neighbors may now have lost support too).

A worked micro-example — variables `x, y ∈ {1,2,3}`, constraint `y = x + 1`:

```
Start:  Dx = {1,2,3}   Dy = {1,2,3}
Revise x → y (need some y = x+1):
  x=1 → y=2 ✓ keep      x=2 → y=3 ✓ keep      x=3 → y=4 ∉ Dy ✗ delete 3 from Dx
  Now Dx = {1,2}
Revise y → x (need some x = y-1):
  y=1 → x=0 ∉ Dx ✗ delete 1     y=2 → x=1 ✓     y=3 → x=2 ✓
  Now Dy = {2,3}
Result (arc-consistent): Dx = {1,2}, Dy = {2,3}  — no search was needed to prune.
```

Two values gone, by pure reasoning. On a Sudoku, fixing one cell to `7` propagates: `7` is removed from every peer's domain; if that leaves some peer with a single value, *that* cell is forced and propagates again — a cascade of deductions that often solves easy puzzles with **zero** guessing. Stronger forms exist: **bounds consistency** (reason only about min/max of domains — cheaper, weaker), and **generalized arc consistency / GAC** (full arc consistency over n-ary constraints — the gold standard for global constraints). Propagation is a *fixpoint* computation: keep deleting until nothing more can be deleted.

> **Why this matters:** a value deleted by propagation is a subtree the search never explores. Propagation prunes *before* you branch; that's why a solver isn't brute force even though the problem is NP-hard.

---

## Backtracking Search + Propagation

When propagation reaches its fixpoint and some variable still has more than one value left, the solver must **guess**. The core loop:

```
solve(domains):
    propagate(domains)                  # shrink everything you can by deduction
    if any domain is empty: return FAIL # a constraint is violated → dead end
    if every variable has one value: return SOLUTION
    x  = choose an unassigned variable  # variable-ordering heuristic
    for v in Dx (in some value order):  # value-ordering heuristic
        result = solve(domains with x := v)   # try the guess (a fresh copy/snapshot)
        if result != FAIL: return result
    return FAIL                         # no value worked → backtrack to caller
```

This is the hand-written backtracking you already know — **plus a propagate step at every node**. That single addition is transformative: each guess triggers a propagation cascade that often empties a domain immediately (proving the guess wrong without exploring its subtree) or forces many other variables for free. Plain backtracking explores a combinatorial tree; backtracking-with-propagation explores a tree that propagation has aggressively pruned.

Two heuristics decide *what* to guess and dramatically affect speed:

- **Variable ordering — "fail first."** Pick the variable with the **smallest remaining domain** (the *minimum-remaining-values* / MRV heuristic). Branching on the most-constrained variable detects dead ends sooner, near the top of the tree, where pruning is cheapest.
- **Value ordering — "succeed first."** Try the value **least likely to fail** (the *least-constraining-value* heuristic) so the first solution is found faster.

The solver also **propagates the failure backward**: when a guess fails, it undoes that guess's deletions (restoring domains) before trying the next value — exactly the "undo / backtrack" step you wrote by hand, managed automatically via trailing or snapshots. (Advanced solvers go further with *conflict-directed backjumping* and *no-good learning* — jumping past irrelevant guesses and remembering why a combination failed. That's the senior/professional territory and the bridge to CDCL in SAT below.)

---

## Global Constraints

A **global constraint** captures a *common pattern over many variables* as a single named constraint — and, crucially, comes with a **specialized propagation algorithm** far stronger than the equivalent pile of binary constraints. They are the single biggest reason CP solvers are practical.

The flagship is **`all_different([x₁,…,xₙ])`** — all the variables take distinct values. You *could* express it as `n(n−1)/2` pairwise `≠` constraints, but those propagate weakly: pairwise `≠` only deletes a value from a peer once a variable is *fixed*. The global `all_different` propagator reasons about the *whole group at once* using a classic result (Régin's algorithm, based on matching in bipartite graphs / Hall's theorem): if `k` variables share a domain of only `k` values, those values are exhausted and can be removed from everyone *else* — a deduction pairwise constraints can't make until much later.

```
3 variables, all_different, domains: Da={1,2}  Db={1,2}  Dc={1,2,3}
Pairwise !=  : deduces nothing yet (no variable is fixed).
Global all_different: {a,b} already need both of {1,2} (Hall set) →
                      delete 1 and 2 from Dc → Dc = {3}.  Solved by propagation.
```

Other heavily used global constraints:

- **`cumulative(starts, durations, demands, capacity)`** — schedule tasks so that, at every instant, the total resource demand of running tasks never exceeds capacity. The bread-and-butter of scheduling (machines, workers, CPUs).
- **`element(index, array, value)`** — `value = array[index]` where `index` is itself a variable (modeling lookups/choices).
- **`table([vars], allowed_tuples)`** — the allowed combinations listed explicitly (an extensional constraint).
- **`circuit` / `cumulative` / `disjunctive` / `bin_packing` / `regular`** — routing, no-overlap scheduling, packing, and pattern (automaton) constraints.

> **The lesson for modelers:** prefer a global constraint over its hand-decomposed equivalent whenever one exists. Same meaning, far stronger propagation, often the difference between seconds and never finishing.

---

## Modeling a Problem End to End

Modeling is the skill that separates a working solver run from a hung one. Walk through **map coloring** (color regions so no two neighbors share a color) and then **scheduling**.

```minizinc
% MAP COLORING — Australia's states, 3 colors, no two neighbors alike.
enum Color = { Red, Green, Blue };
enum State = { WA, NT, SA, Q, NSW, V, T };
array[State] of var Color: col;        % one variable per state, domain = the 3 colors

% one constraint per shared border:
constraint col[WA]  != col[NT];   constraint col[WA]  != col[SA];
constraint col[NT]  != col[SA];   constraint col[NT]  != col[Q];
constraint col[SA]  != col[Q];    constraint col[SA]  != col[NSW];
constraint col[SA]  != col[V];    constraint col[Q]   != col[NSW];
constraint col[NSW] != col[V];

solve satisfy;
```

The model *is* the adjacency graph: variables = regions, domains = colors, constraints = edges. Propagation alone often colors small maps with no search.

For **scheduling** — fit jobs into a timeline with limited machines — the recipe generalizes:

```minizinc
% JOB SCHEDULING — each job has a duration; jobs sharing a machine can't overlap;
% finish everything as early as possible.
int: n;  array[1..n] of int: dur;  int: horizon;
array[1..n] of var 0..horizon: start;          % decision variable: each job's start time
array[1..n] of var 0..horizon: end;

constraint forall(i in 1..n)(end[i] = start[i] + dur[i]);
% jobs that share a machine must not overlap — a disjunctive/no-overlap constraint:
constraint forall(i,j in 1..n where i < j /\ same_machine(i,j))
                 ( end[i] <= start[j] \/ end[j] <= start[i] );

var 0..horizon: makespan;
constraint forall(i in 1..n)(end[i] <= makespan);
solve minimize makespan;                        % OPTIMIZE, not just satisfy
```

The modeling checklist that emerges:

1. **Identify the decision variables** — the unknowns the solver chooses (the *start times*, not the derived `end` times).
2. **Pin their domains tightly** — a smaller domain is less to search. `0..horizon`, not `0..1_000_000`.
3. **State every rule as a constraint**, reaching for **global constraints** (`cumulative`, `all_different`) over hand-decompositions.
4. **Distinguish satisfy from optimize** — `solve satisfy` for "any valid", `solve minimize/​maximize` for "the best", which makes the solver prove optimality (harder).
5. **Add redundant constraints** that don't change the solution set but help propagation (e.g., a known total, a symmetry-breaking order) — a senior topic, but worth flagging now.

---

## SAT — Boolean Satisfiability

**SAT** is constraint solving stripped to its barest core: every variable is a **Boolean** (true/false), and the constraints are clauses combined into **Conjunctive Normal Form (CNF)** — an AND of ORs of (possibly negated) variables:

```
(a ∨ ¬b ∨ c) ∧ (¬a ∨ d) ∧ (b ∨ ¬c ∨ ¬d)
└── clause ──┘  one clause must be true … and every clause must be true (the ∧'s)
```

The SAT question: is there an assignment of true/false to the variables making *every* clause true? It was the **first problem proven NP-complete** (Cook–Levin, 1971) — the archetype of intractable problems. And yet modern SAT solvers routinely dispatch instances with *millions* of variables, because of the **CDCL** algorithm (Conflict-Driven Clause Learning), the descendant of the older **DPLL**:

- **DPLL** = backtracking search + two propagations: **unit propagation** (a clause with one unassigned literal forces that literal — the SAT version of constraint propagation) and **pure-literal elimination**.
- **CDCL** adds the game-changers: when a guess leads to a conflict, it **analyzes *why*** and **learns a new clause** that forbids that exact dead-end combination forever; then it **backjumps** (non-chronologically) past all the irrelevant guesses, not just the last one. Clause learning means the solver never makes the same mistake twice — this is why SAT got practical.

You rarely write CNF by hand; tools and higher-level solvers compile down to it. The point to internalize: **SAT is the fully-Boolean special case of constraint satisfaction**, with a propagation step (unit propagation) and a learning-based search (CDCL) that mirror — and historically inspired — the CP machinery above.

---

## SMT — SAT Plus Theories

Pure Boolean logic is awkward for arithmetic: encoding `x + y ≤ 10` over integers as raw CNF is painful and explosive. **SMT — Satisfiability Modulo Theories** — fixes this by combining a SAT solver's clause reasoning with dedicated **theory solvers** that understand richer domains:

- **Linear arithmetic** (integers/reals): `2x + 3y ≤ 7`.
- **Bit-vectors**: fixed-width machine integers with overflow — exactly C/assembly semantics.
- **Arrays**: `read`/`write` (model memory, hash maps).
- **Uninterpreted functions, strings, datatypes**, and more.

An SMT solver lets you write constraints in those theories directly, and internally a SAT core handles the Boolean structure while theory solvers check the arithmetic/array/bitvector facts, exchanging information (the *DPLL(T)* architecture). The dominant tool is Microsoft's **Z3**:

```python
# Z3 (SMT) — solve directly over integers, no CNF by hand.
from z3 import Int, Solver, sat

x, y = Int('x'), Int('y')
s = Solver()
s.add(x > 0, y > 0)          # constraints in the theory of integer arithmetic
s.add(x + y == 10)
s.add(x * 2 == y)
print(s.check())             # sat
print(s.model())             # [x = 3, y = ...]  — wait: x=3? solve: x+2x=10 → x≈3.33,
                             # over INTEGERS no exact solution to x*2==y & x+y==10 →
                             # check() returns 'unsat' if no integer fits; sat with a model if one does
```

SMT is the technology behind **program verification, symbolic execution, and type checking** (you'll see exactly where at the [professional](professional.md) level). Mentally: **SAT** = Boolean only; **SMT** = SAT + theories (arithmetic, arrays, bitvectors), so it speaks the language of real programs directly.

---

## The Family at a Glance

These four are cousins — all "declare constraints, search for a satisfying assignment" — differing in what constraints they accept and how they search:

| | Variables | Constraints | Solves | Star tool |
|---|---|---|---|---|
| **Finite-domain CP** | Integer/enum, finite domains | Arbitrary, incl. **global** constraints | Satisfaction + optimization | OR-Tools CP-SAT, Gecode, Chuffed |
| **SAT** | Boolean only | CNF clauses | Satisfaction (Boolean) | MiniSat, Glucose, CaDiCaL, Kissat |
| **SMT** | Booleans + theory terms (ints, reals, bitvectors, arrays) | Theory formulas + Boolean structure | Satisfaction (often + optimization) | Z3, CVC5 |
| **LP / MILP** | Continuous (LP) / + integer (MILP) | **Linear** (in)equalities + linear objective | Optimization (proven optimal) | Gurobi, CPLEX, HiGHS, GLPK |

**LP/MILP** (linear / mixed-integer programming) is the close cousin from operations research: constraints must be *linear* and there's always a linear objective to optimize, solved by simplex / branch-and-bound rather than propagation. CP shines on combinatorial structure (scheduling, sequencing, all-different); MILP shines on numeric optimization with linear structure. Choosing among them is a senior decision — the [senior level](senior.md) makes the call concrete.

---

## Common Mistakes

- **Confusing "the solver searches" with "the solver brute-forces."** It doesn't enumerate the space; it propagates (deletes impossible values) and only searches what propagation leaves. Models that "explode" usually do so because they *block* propagation, not because the space is large.
- **Decomposing a global constraint by hand.** Writing pairwise `≠` instead of `all_different`, or hand-rolled overlap checks instead of `cumulative`, throws away the strong specialized propagator. Always prefer the named global constraint.
- **Domains too wide.** `var 0..1000000: start` when the real horizon is 200 makes the solver reason over a needlessly huge space. Tight domains are free pruning.
- **Treating satisfy and optimize as the same cost.** Proving a solution is *optimal* means proving no better one exists — usually far harder than finding *any* feasible one. Don't ask for optimal if "good enough, fast" suffices.
- **Thinking SAT/SMT are academic.** They run inside package managers, compilers, verifiers, and CI you use daily. SAT being NP-complete doesn't make it impractical — CDCL made it routine.
- **Modeling `x*2 == y` and expecting a fractional answer over integer variables.** The *theory* matters: `Int` vs `Real` in SMT, finite integer domains in CP — an "unsat" can mean "no *integer* fits," not "no answer at all."

---

## Summary

A **CSP** is the triple `⟨X, D, C⟩` — variables, domains, constraints — and a solver answers it by interleaving **constraint propagation** (delete values that can't be in any solution, formalized as **arc consistency** / AC-3 and its stronger relatives) with **backtracking search** guided by *fail-first* variable ordering and *succeed-first* value ordering. Propagation is the heart: it prunes subtrees before search ever reaches them, which is why an NP-hard problem is tractable in practice. **Global constraints** like `all_different` and `cumulative` package common patterns with specialized propagators far stronger than hand-decompositions — the chief reason CP solvers work. The cousins specialize the same idea: **SAT** restricts everything to Booleans in CNF and conquers it with **DPLL/CDCL** (unit propagation + conflict-driven clause learning + backjumping); **SMT** adds theory solvers (arithmetic, bitvectors, arrays) on top of a SAT core, speaking the language of real programs; **LP/MILP** handles linear optimization from the OR tradition. Modeling well — tight domains, the right global constraints, satisfy-vs-optimize chosen deliberately — is what makes any of them fast.

---

## Further Reading

- Rina Dechter, *Constraint Processing* — the definitive textbook on consistency, propagation, and search.
- Russell & Norvig, *AIMA*, Constraint Satisfaction chapter — AC-3, MRV/LCV heuristics, and backtracking-with-inference, clearly taught.
- *The MiniZinc Handbook* — global constraints catalog and modeling patterns, with runnable examples.
- *Handbook of Satisfiability* (Biere et al.) — the reference on DPLL, CDCL, and modern SAT engineering.
- Leonardo de Moura & Nikolaj Bjørner, *Z3: An Efficient SMT Solver* (TACAS 2008) — the paper behind the dominant SMT tool.
- The **Global Constraint Catalogue** (sofdem.github.io/gccat) — the encyclopedia of named global constraints.

---

## Related Topics

- [`junior.md`](junior.md) — variables, domains, constraints, and the solve-vs-search intuition.
- [`senior.md`](senior.md) — when CP/SAT/SMT/MILP each win, modeling trade-offs, symmetry breaking, and the solver-as-black-box risk.
- [03 — Declarative Programming](../03-declarative-programming/) — the parent paradigm.
- [04 — Logic Programming](../04-logic-programming/) — unification and resolution; constraint logic programming (CLP) fuses it with constraint solving.
- **Backtracking search & NP-completeness** (DSA) — the search the solver augments, and the complexity class that explains why the machinery exists.
