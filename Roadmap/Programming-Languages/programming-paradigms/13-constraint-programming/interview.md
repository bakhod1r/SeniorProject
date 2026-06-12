# Constraint Programming — Interview Q&A

> **Roadmap:** [Programming Paradigms](../README.md) → Constraint Programming
>
> *Constraint programming is the paradigm where you describe a problem as **variables**, their **domains**, and **constraints** relating them — and hand it to a **solver** that searches for an assignment satisfying all of them (and optionally optimizes an objective). You write what must be true about the answer; the solver writes the search. The hard, interview-worthy part is that the solver's cost is a property of how you model, not of the problem itself — so the questions probe whether you understand the machinery (propagation, search), the family (CP/SAT/SMT/MILP), and the engineering judgment around when a solver wins and when it never returns.*

A bank of 45+ interview questions spanning definitions, the solver's internals, the SAT/SMT/CP/MILP family, modeling judgment, real-world solver deployments, and code-reading. Each answer models the reasoning a strong candidate gives — including the trade-offs and the runtime reality underneath. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

Examples are in **MiniZinc**, **OR-Tools CP-SAT (Python)**, and **Z3 (Python)**, with hand-written backtracking shown for contrast.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle — Propagation, Search, the Family](#intermediate--middle--propagation-search-the-family)
3. [Senior — Modeling Judgment & Tool Selection](#senior--modeling-judgment--tool-selection)
4. [Professional / Staff — Solvers in Production](#professional--staff--solvers-in-production)
5. [Code-Reading — What Does This Model Mean / Return?](#code-reading--what-does-this-model-mean--return)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. [How to Talk About Constraint Programming in Interviews](#how-to-talk-about-constraint-programming-in-interviews)
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Definitions, the core distinctions, and the "why does this matter" reasoning.

**Q1. What is constraint programming, in one or two sentences?**

<details><summary>Answer</summary>

Constraint programming is a **declarative** paradigm where you state a problem as **variables**, their **domains** (allowed values), and **constraints** relating them, then a **solver** searches for an assignment of values that satisfies every constraint — and optionally one that minimizes or maximizes an objective. You describe *what must be true about the answer*, not *how to search for it*; the solver does the trying and backtracking. It's the same "describe what, not how" idea as SQL, pushed to combinatorial search problems like puzzles, schedules, and assignments.
</details>

**Q2. What is a CSP? Define it precisely.**

<details><summary>Answer</summary>

A **Constraint Satisfaction Problem** is a triple `⟨X, D, C⟩`:

- **X** — a finite set of **variables** `{x₁, …, xₙ}`.
- **D** — a **domain** `Dᵢ` for each variable: the finite set of values it may take.
- **C** — a set of **constraints**, each restricting the allowed *combinations* of values over some subset of variables.

A **solution** assigns each variable a value from its domain such that *every* constraint holds. The basic CSP question is satisfaction: does *any* solution exist, and if so produce one. The optimization variant (a COP) adds an objective and asks for the *best* solution. CSPs are NP-complete in general.
</details>

**Q3. What's the difference between a constraint variable and an ordinary program variable?**

<details><summary>Answer</summary>

An ordinary program variable is a storage cell *you* assign a value to (`x = 5`). A constraint variable is an **unknown the solver must assign** — you declare its domain (`var 1..9: x`), and the solver picks a value satisfying the constraints. You never write `x = 5`; you write the *rules* `x` must obey and let the solver choose. This trips up everyone at first: `var 1..9: x` doesn't set `x`, it declares the set of legal values and defers the choice. The mental model is "x is a slot the solver fills," not "x is a box I fill."
</details>

**Q4. Walk through modeling Sudoku as a CSP.**

<details><summary>Answer</summary>

- **Variables:** one per cell, 81 of them.
- **Domains:** each cell's domain is `1..9` (givens are pinned to their single value).
- **Constraints:** each row's nine cells are `all_different`; each column's nine are `all_different`; each 3×3 box's nine are `all_different`; each given clue fixes its cell.

That's the whole model — three families of `all_different` plus the clues. There's **no search code**: you don't pick cells, try numbers, or undo. The solver propagates (fixing one cell removes that value from its row/column/box peers) and backtracks where needed. Adding a variant rule (e.g., a diagonal constraint) is one more `all_different` line, versus editing search machinery in a hand-written solver.
</details>

**Q5. Contrast the constraint model with hand-written backtracking for N-Queens or Sudoku.**

<details><summary>Answer</summary>

Hand-written backtracking is *you writing the search*: find an empty slot, loop over candidate values, check validity, recurse, and undo on failure — plus all the helper code (`find_empty`, `is_valid`). The problem's rules are buried inside `is_valid`. The constraint model *is* the rules — `all_different(queen)` for rows, `all_different([queen[c]+c])` and `all_different([queen[c]-c])` for diagonals — and contains **no search at all**. Both produce the same answer; the difference is who writes the search engine. With backtracking you rebuild a one-off search engine per problem; with CP you describe the problem and rent a world-class, reusable one.
</details>

**Q6. What does it mean for a model to be "infeasible," and why is that a useful result?**

<details><summary>Answer</summary>

**Infeasible** (UNSAT) means *no* assignment satisfies all the constraints simultaneously — the requirements contradict each other. It's a genuine, useful answer, not a failure: the solver is telling you "what you asked for is impossible." If you over-constrain (e.g., `x` must be `5` and `x` must be even with domain `{1,3,5}`), infeasible is correct. Critically, a good solver *proves* infeasibility and reports it rather than looping forever, and the best systems also produce an **unsatisfiable core** — a minimal subset of conflicting constraints — so you can see *which* requirements clash.
</details>

**Q7. Satisfaction vs optimization — what's the difference?**

<details><summary>Answer</summary>

**Satisfaction** asks "is there *any* solution?" and stops at the first one found (`solve satisfy`). **Optimization** asks "what's the *best* solution?" against an objective (`solve minimize cost`) — and that's much harder, because finding the optimum requires *proving no better solution exists*, which means exploring or pruning the entire remaining space, not just hitting one success. You often get a great solution quickly but spend most of the runtime *proving* it's optimal. In practice you frequently settle for "within X% of optimal within a time budget" rather than paying for proven optimality.
</details>

**Q8. If a solver returns an answer that violates a rule you care about, whose bug is it?**

<details><summary>Answer</summary>

Almost always **yours** — a *missing constraint*. The solver honors exactly the constraints you wrote and nothing else. If your scheduler double-books a room, you forgot the "no two tasks in one room at once" constraint; the solver found a valid solution to the *under-constrained* problem you actually posed. The discipline: a surprising solution means "what rule did I forget to state?", not "the solver is broken." (The dual mistake — *over*-constraining — gives spurious infeasibility, also your model, not the solver.)
</details>

**Q9. Why use a solver instead of just writing nested loops?**

<details><summary>Answer</summary>

Because the solver searches *far* more cleverly than nested loops and you write *far* less code. A naive nested-loop brute force enumerates every combination — astronomically many. A solver constantly **propagates** (deletes values that can't be in any solution) before and during search, pruning huge swaths of the space without ever visiting them, and it backtracks automatically. You also get correctness and maintainability: the model reads as the rules, adding a rule is one line, and you can't introduce off-by-one or forgotten-undo bugs in search machinery you didn't write. The trade-off is loss of *predictable* runtime control — covered in the senior questions.
</details>

**Q10. Name three real systems that are constraint/SAT/SMT problems under the hood.**

<details><summary>Answer</summary>

- **Package managers** (DNF/libsolv, Zypper, PubGrub-based resolvers): "which package versions can coexist" is a Boolean satisfiability problem.
- **Schedulers/rosters** (hospitals, airlines, call centers, manufacturing): assign people/jobs to shifts/machines respecting coverage, hours, and no-overlap rules — CP/MILP.
- **Program verifiers, symbolic execution, type checkers** (Z3 inside Dafny, KLEE, angr; type inference): "is there an input violating this assertion?" or "do these type constraints have a solution?" — SMT.

The throughline: anywhere a system asks *"is there a valid (or best) assignment, and if not, why?"*, there's likely a solver.
</details>

---

## Intermediate / Middle — Propagation, Search, the Family

> The machinery: how the solver actually works, and the SAT/SMT/CP/MILP family.

**Q11. How does a modern constraint solver actually work? Name the two cooperating mechanisms.**

<details><summary>Answer</summary>

It interleaves **constraint propagation** and **backtracking search**. *Propagation* is deduction without guessing: use the constraints to delete values that can't be in any solution, shrinking domains. *Search* kicks in only when propagation stalls: pick a variable, guess a value, propagate again, and undo (backtrack) if the guess leads to a dead end (an empty domain). The crucial ordering is that propagation runs **first and constantly** — at every search node — so search only guesses when reasoning has run out of road. Most of a solver's power is in the propagation, not the search; that's why it isn't brute force.
</details>

**Q12. What is constraint propagation, and what is arc consistency?**

<details><summary>Answer</summary>

**Propagation** removes values from domains that provably can't appear in any solution. **Arc consistency (AC)** is the workhorse notion: a directed arc `xᵢ → xⱼ` (from a binary constraint) is consistent when *for every* value `a` in `Dᵢ` there exists *some* value `b` in `Dⱼ` such that `(a,b)` satisfies the constraint. If some `a` has no supporting `b`, `a` can never be in a solution, so we delete it from `Dᵢ`. A CSP is arc-consistent when every arc is. **AC-3** enforces it with a worklist: revise each arc, and whenever a domain shrinks, re-enqueue the arcs pointing *into* the shrunken variable, because its neighbors may have just lost support. Propagation runs to a *fixpoint* — keep deleting until nothing more can be deleted. A value deleted by propagation is a whole subtree search never visits.
</details>

**Q13. What's the search loop, and what are the variable- and value-ordering heuristics?**

<details><summary>Answer</summary>

The loop: propagate; if a domain is empty, fail (backtrack); if every variable is fixed, return the solution; otherwise pick an unassigned variable and try its values one at a time, recursing with each guess and propagating again. It's hand-written backtracking *plus a propagate step at every node* — that addition is transformative, because each guess triggers a cascade that often empties a domain immediately (disproving the guess without exploring its subtree). Two heuristics matter:

- **Variable ordering — "fail first":** branch on the variable with the **smallest remaining domain** (minimum-remaining-values, MRV). Detecting dead ends near the top of the tree is where pruning is cheapest.
- **Value ordering — "succeed first":** try the value **least likely to fail** (least-constraining-value), so the first solution is found faster.
</details>

**Q14. What is a global constraint, and why does `all_different` beat pairwise `≠`?**

<details><summary>Answer</summary>

A **global constraint** captures a common pattern over many variables as a single named constraint *and ships a specialized propagation algorithm* far stronger than the equivalent decomposition. `all_different([x₁…xₙ])` means all variables take distinct values. You *could* write `n(n−1)/2` pairwise `≠` constraints, but those propagate weakly — pairwise `≠` only deletes a value from a peer once a variable is *fixed*. The global `all_different` propagator reasons about the whole group at once (Régin's algorithm, via bipartite matching / Hall's theorem): if `k` variables share a domain of only `k` values, those values are exhausted and can be removed from everyone else — a deduction pairwise constraints can't make until much later. Global constraints (`all_different`, `cumulative`, `circuit`, `element`, `table`, `bin_packing`) are the single biggest reason CP solvers are practical. **Always prefer the named global constraint over a hand-decomposition.**
</details>

**Q15. Explain SAT. Why is it interesting that it's NP-complete yet solvers handle millions of variables?**

<details><summary>Answer</summary>

**SAT** is constraint solving stripped to the bone: every variable is Boolean, and constraints are clauses (ORs of possibly-negated variables) combined in **Conjunctive Normal Form** (an AND of ORs). The question: is there a true/false assignment making every clause true? SAT was the *first* problem proven NP-complete (Cook–Levin, 1971) — the archetype of intractability — yet modern solvers routinely solve instances with millions of variables. The reason is **CDCL** (Conflict-Driven Clause Learning): on top of DPLL's backtracking + **unit propagation** (a clause with one unassigned literal forces it), CDCL *analyzes why* a conflict happened, **learns a new clause** forbidding that exact dead end forever, and **backjumps** non-chronologically past the irrelevant guesses. Clause learning means the solver never repeats a mistake — that's what made SAT practical. NP-completeness is a *worst-case* statement; real instances are structured, and CDCL exploits that structure ferociously.
</details>

**Q16. SAT vs SMT — what's the difference?**

<details><summary>Answer</summary>

**SAT** is Boolean-only: variables are true/false, constraints are CNF clauses. **SMT — Satisfiability Modulo Theories** — adds **theory solvers** on top of a SAT core so you can write constraints in richer domains directly: linear arithmetic (`2x + 3y ≤ 7`), **bit-vectors** (fixed-width machine integers with overflow — exactly C semantics), **arrays** (model memory/maps), uninterpreted functions, strings, datatypes. Internally (the **DPLL(T)** architecture) the SAT core handles the Boolean structure while theory solvers check the arithmetic/array/bitvector facts, exchanging information. Mentally: **SMT = SAT + theories**, so it speaks the language of real programs directly instead of forcing you to hand-encode arithmetic into painful, explosive CNF. Z3 is the dominant SMT solver.
</details>

**Q17. How do CP, SAT, SMT, and LP/MILP relate? Give the one-line distinction.**

<details><summary>Answer</summary>

They're cousins — all "declare constraints, search for a satisfying assignment" — differing in what constraints they accept:

- **Finite-domain CP:** integer/enum variables over finite domains, arbitrary constraints *including global constraints*, satisfaction + optimization. (OR-Tools CP-SAT, Gecode.)
- **SAT:** Boolean variables only, CNF clauses. (CaDiCaL, Kissat.)
- **SMT:** Booleans + theory terms (ints, reals, bitvectors, arrays). (Z3, CVC5.)
- **LP/MILP:** continuous (LP) or mixed-integer (MILP) variables, **linear** (in)equalities and a **linear** objective, solved by simplex + branch-and-bound from the operations-research tradition. (Gurobi, CPLEX, HiGHS.)

One line: **CP** for combinatorial/scheduling logic with global constraints; **SAT** for pure Boolean; **SMT** for program-level theories; **MILP** for linear numeric optimization.
</details>

**Q18. What's the relationship between CP and logic programming?**

<details><summary>Answer</summary>

They're closely related branches of the **declarative** family, and they merge in **Constraint Logic Programming (CLP)**: Prolog's resolution and unification extended so that constraints over a domain are handled by a constraint solver instead of plain unification — CLP(FD) for finite domains, CLP(R) for reals. Systems like SWI-Prolog's `clpfd`, SICStus, and ECLiPSe let you write logic rules *and* post constraints, getting backtracking search and propagation together. **Answer Set Programming** (clingo) is a nearby sibling — declarative logic programs whose stable models are computed by a SAT-like solver. So: declarative is the umbrella, logic programming supplies rules + search, constraint programming supplies domains + propagation + optimization, and CLP/ASP are where they fuse.
</details>

**Q19. Why does domain size matter? What's the harm in `var 0..1000000: start` when the horizon is 200?**

<details><summary>Answer</summary>

A domain is the set of values the solver may consider for a variable; a needlessly wide domain makes the solver reason over a vastly larger space than necessary. Tight domains are **free pruning** — they encode real bounds the solver would otherwise have to discover (or never discover). `var 0..200: start` versus `var 0..1000000: start` describes the same problem if the horizon is 200, but the latter forces propagation and search over millions of impossible values. Pinning domains as tightly as the problem allows is one of the cheapest, highest-value modeling habits.
</details>

**Q20. What's the difference between bounds consistency and full arc consistency, and why choose the weaker one?**

<details><summary>Answer</summary>

**Full arc / generalized arc consistency (GAC)** reasons about *every* value in the domains and deletes any without support — strongest pruning, but potentially expensive to enforce. **Bounds consistency** reasons only about the *min and max* of each domain (treating it as an interval), which is much cheaper but weaker: it can miss deletions of interior values. You choose bounds consistency when the per-node propagation cost of full GAC outweighs the search it saves — common for arithmetic constraints over large integer domains, where maintaining full GAC is costly and bounds reasoning prunes enough. It's a propagation-strength-vs-propagation-cost trade-off, decided empirically per constraint.
</details>

---

## Senior — Modeling Judgment & Tool Selection

> Why modeling dominates, and the calls a senior makes under uncertainty.

**Q21. Why is "a correct model" not the same as "a finished model"?**

<details><summary>Answer</summary>

Because a constraint solver's performance is a property of the **model, not the problem** — two formulations with *identical solution sets* can differ by a factor of a million in solve time. Correctness is table stakes; the actual deliverable is correct *and* solvable within your time budget. A model that's logically right but hangs forever is a failed deliverable. So the senior job isn't done at "the constraints capture the rules" — it's done at "the constraints capture the rules *and* the solver can dispatch realistic instances in time," which usually requires modeling for propagation: tight domains, the right global constraints, symmetry broken, implied constraints added.
</details>

**Q22. Why can a one-line change to a model explode runtime with no change to the answer?**

<details><summary>Answer</summary>

Because solve cost is **emergent**: it's the size of the search tree *after* propagation prunes it, which depends on subtle interactions between constraints, encodings, and heuristics — not on the solution set. Swapping `all_different` for pairwise `≠`, widening a domain, or changing a variable's encoding leaves the *answers* identical but changes the **propagation strength** and **search shape**, often by orders of magnitude. There are also **phase transitions** — near a critical constraint-to-variable ratio, problems are exponentially harder, and adding one requirement can slide a model into that peak — and **heavy-tailed runtimes**, where one unlucky early branching decision sends the solver down a giant fruitless subtree. You can't read solve cost off the model by inspection; you measure it.
</details>

**Q23. What is symmetry, and why is symmetry breaking one of the highest-value techniques?**

<details><summary>Answer</summary>

**Symmetry** exists when many distinct assignments are *essentially the same solution* — and the solver, not knowing they're equivalent, explores all of them, re-exploring the symmetric copies of every dead end. The classic source is **interchangeable objects/values**: with `k` identical machines, every solution has `k!` relabelings, so the solver wastes exponential effort proving each symmetric dead end independently. Coloring has value symmetry (colors are interchangeable); N-Queens has geometric symmetry (rotations/reflections). **Symmetry-breaking constraints** forbid all but one representative of each symmetry class — e.g., fixing the first region's color, or imposing a lexicographic/ordering constraint on the interchangeable objects. A few lines that change *which* solutions are valid not at all can shrink the search by `k!` and turn a non-terminating solve into an instant one. The art is breaking symmetry *without removing real solutions* and choosing breaks that *propagate well*.
</details>

**Q24. Why would adding a redundant constraint — one already implied — make solving faster?**

<details><summary>Answer</summary>

Because a redundant (implied) constraint removes no solutions but gives the propagator a **new angle of attack** to prune domains *earlier*. Example: in a scheduling model, the no-overlap constraints are correct, but adding a redundant "total work" bound (`makespan ≥ Σ durations / capacity`) lets the solver prune branches that violate the *aggregate* long before it discovers a specific overlap. This inverts ordinary-engineering "DRY/no-redundancy" intuition: here a well-chosen redundant constraint is **free deduction** — it costs a little propagation time per node but can cut node count by orders of magnitude. The discipline is to add redundancy that's genuinely implied (verify it removes no solutions) *and* actually propagates early (otherwise it's pure overhead). Symmetry breaking and implied constraints are the two highest-value "same answer, now fast" levers.
</details>

**Q25. How do you choose between CP, SAT, SMT, and MILP for a given problem?**

<details><summary>Answer</summary>

Match the engine to the problem's structure:

- **CP** when the problem is combinatorial — scheduling, rostering, sequencing, assignment — and there's a **global constraint** that names your pattern (`all_different`, `cumulative`).
- **MILP** when the model is naturally a system of **linear** inequalities with a **linear** objective — blending, network flow, facility location, large assignment/transport — where decades of LP-relaxation + branch-and-cut give excellent bounds and proven optimality at scale.
- **SAT** when everything reduces cleanly to **Boolean** clauses — circuit equivalence, feature-model/dependency consistency.
- **SMT** when variables are **program-level** — bitvectors, arrays, equalities mixed with arithmetic — i.e., verification, symbolic execution, type checking.

The lines blur (CP-SAT uses a SAT engine internally; CP and MILP overlap on assignment), so the mark of seniority is **benchmarking more than one on a representative instance** rather than committing to the first that comes to mind.
</details>

**Q26. When should you *not* use a solver, and what do you reach for instead?**

<details><summary>Answer</summary>

Fall back from an exact solver when it won't return a usable answer within your limits of size, time, or softness:

- **Scale beyond reach** — routing 10,000 stops or rostering thousands of staff often exceeds what branch-and-bound can prove optimal in acceptable time. (OR-Tools' own routing library is a metaheuristic engine, not the exact CP solver, for this reason.)
- **Hard real-time deadlines** — a 50ms dispatch decision can't tolerate a solver's heavy-tailed worst case; a fast heuristic with bounded, predictable latency wins.
- **Soft, fuzzy, or shifting objectives** — when "good" is a vague human judgment that changes faster than you can re-model, a tunable heuristic is more honest.
- **"Good, not optimal" on huge instances** — local search delivers a 5%-from-optimal answer far faster.

You reach for **heuristics** (greedy construction) and **metaheuristics** (simulated annealing, tabu search, large-neighborhood search, genetic algorithms). The mature architecture is often **hybrid** — a solver on the small hard core, a heuristic for the rest, or a heuristic that warm-starts the solver. Avoid dogmatism either way.
</details>

**Q27. "If these problems are NP-hard, why do solvers work at all?" Reconcile it.**

<details><summary>Answer</summary>

NP-hardness is a **worst-case** statement: it says *some* instances are exponentially hard, not that *every* one is. Real-world instances carry structure — locality, near-decomposability, redundancy, symmetry — that solvers exploit, and the pathological worst cases are rare in practice (though they exist, and a phase transition can summon one). Mechanically, **propagation deletes most of the search space without visiting it**, and **clause/no-good learning** ensures the solver never re-discovers the same dead end, so the *effective* search is a tiny, heavily-pruned fraction of the nominal space. But "practical" is **empirical, not guaranteed** — solvers come with no runtime bound; they work *usually*, on *structured* instances, *often* fast, and occasionally fall off the cliff. The senior stance is calibrated optimism: lean on solvers because they're shockingly effective on real problems, but architect as if any instance *might* be the worst case (time limit + fallback).
</details>

**Q28. The choice of decision variables is called the most consequential modeling decision. Why?**

<details><summary>Answer</summary>

Because the variables determine *what propagation and which global constraints are available*. A sequencing problem modeled with **interval** variables and `no_overlap`/`cumulative` propagates far better than the same problem encoded as raw `start[i]+dur[i] ≤ start[j] OR start[j]+dur[j] ≤ start[i]` disjunctions — even though both are correct and have identical solution sets. Likewise, modeling a problem with start-time integers vs predecessor Booleans vs interval variables enables completely different deductions. Related senior levers: **viewpoints and channeling** (model two natural variable sets — e.g., "which slot does each task occupy" vs "which task is in each slot" — and link them with channeling constraints so each viewpoint's constraints propagate), and **encoding granularity** (direct/order/log Boolean encodings of a finite choice trade clause count against propagation strength). There's no formula — it's *model, measure, reformulate, measure again*.
</details>

**Q29. How do you debug a solver that hangs? Why can't you just read the model?**

<details><summary>Answer</summary>

You can't read solve cost off the model because cost is **emergent** — it's the post-propagation search-tree size, not anything visible by inspection. So you debug it like a mysterious performance bug: **instrument and measure**. Turn on **search statistics** (nodes explored, propagations, conflicts, restarts); set a **time limit** so it returns the best-so-far instead of hanging; read the **search log**; and **bisect the model** by removing constraints to find which one wrecks propagation (or which combination triggers a phase transition). Check for unbroken **symmetry** (the most common reason a "reasonable" model is mysteriously slow — `k!` relabelings multiplying the search) and overly wide domains. Treat solve time as an experimental quantity you measure, never one you derive.
</details>

**Q30. What's an optimality gap, and how does branch-and-bound use it?**

<details><summary>Answer</summary>

**Branch-and-bound** is how CP/MILP solvers prove optimality: maintain the best solution found so far (the **incumbent**) and a **bound** (the best value still theoretically achievable in the current subtree), and prune any subtree whose bound can't beat the incumbent. The **optimality gap** is the distance between the incumbent (best found) and the best still possible (the bound) — when it reaches zero, the incumbent is provably optimal. The practical leverage: you often get a near-optimal incumbent quickly and then spend most of the time *closing the gap* to prove optimality. So set a **relative gap tolerance** ("stop within 1% of optimal") and a **time limit**, and exploit the solver's **anytime** behavior — ask for the best solution available by your deadline rather than *the* optimum. "Optimal" is frequently a vanity requirement; a 1%-gap solution in a tenth of the time usually ships.
</details>

---

## Professional / Staff — Solvers in Production

> Where solvers ship, and how to operate one without it taking down the service.

**Q31. Where does a SAT solver run that an everyday developer has already depended on?**

<details><summary>Answer</summary>

**Package/dependency resolution.** "Which versions of which packages can coexist given everyone's requirements" is formally a SAT problem: each *(package, version)* is a Boolean ("installed?"), "exactly one version of `libfoo`" is an at-most-one + at-least-one clause, "A depends on B≥2.0" is a clause `A → (B2.0 ∨ B2.1 ∨ …)`, "A conflicts with C" is `¬(A ∧ C)`. Resolving an install asks SAT whether all clauses are satisfiable. Real implementations: **Fedora's DNF uses libsolv** (a real SAT solver), **openSUSE's Zypper** pioneered SAT-based resolution, and **PubGrub** (Dart's pub, Python's `uv`/Poetry-style) uses a CDCL-inspired algorithm engineered specifically to produce **good error messages** — because the killer feature of a resolver isn't finding a solution, it's *explaining why none exists* via a minimal unsatisfiable core ("A needs B≥2 but C needs B<2"). SAT/SMT also runs the entire EDA/chip-design pipeline (equivalence checking, place-and-route, ATPG).
</details>

**Q32. Where do SMT solvers (Z3) show up in the toolchain?**

<details><summary>Answer</summary>

Everywhere programs are reasoned about, because SMT speaks the theories programs are made of (bitvectors, arrays, arithmetic, equality):

- **Formal verification** — Dafny, F\*, Frama-C, Boogie compile program + spec into SMT; "verify this never reads out of bounds" becomes "is there an input making this assertion false?"
- **Symbolic execution** — KLEE, angr, SAGE, Manticore treat inputs as symbolic variables and ask the solver "is this path feasible? what concrete input reaches it?" — auto-generating crash-triggering tests and exploits (whitebox fuzzing).
- **Type checking & inference** — type inference *is* constraint solving (Hindley–Milner unification is the classic case); refinement/liquid types and Rust's trait/borrow resolution are constraint problems.
- **Compilers** — register allocation is graph coloring (a CSP); Alive2 uses SMT to prove LLVM optimizations are semantics-preserving.

A canonical taste: `s.add(x + 1 < x)` over a 32-bit `BitVec` returns **sat** with `x = 0x7fffffff` — the solver finds the overflow case that breaks a "fact" true only for mathematical integers.
</details>

**Q33. Describe a robust solver-in-the-loop architecture.**

<details><summary>Answer</summary>

The solver is *one box*; production reliability lives in the others:

1. **Data ingestion & validation** — pull live inputs and validate *before* modeling; garbage-in produces garbage solutions or spurious infeasibility (most "solver is broken" tickets are bad data).
2. **Model generation** — transform validated data into variables/constraints; keep this layer thin and isolated (a rules layer or DSL), because the rules-to-constraints mapping changes most.
3. **Bounded solve** — call with a **time limit**, **gap tolerance**, and **parallel workers**, capturing status (optimal/feasible/infeasible/timed-out); never an unbounded blocking call in a request path.
4. **Result extraction & post-validation** — read the assignment back and *independently re-validate it against the original rules* (cheap guard against modeling bugs).
5. **Explanation / fallback** — on infeasible, surface an **unsatisfiable core** or relaxation; on timeout, return the best incumbent; otherwise invoke the heuristic fallback.

Cross-cutting: run solves **asynchronously** (job queue, not sync API); make them **reproducible** (pin seed/version) for auditability; version the model+solver as an artifact.
</details>

**Q34. What's the single most important operational rule for running a solver in production?**

<details><summary>Answer</summary>

**Always bound the solve and have a fallback** — a time limit, a gap tolerance, and a plan for what happens when it doesn't finish. A bare, unbounded solve call will eventually hang a service on one pathological input (heavy-tailed runtimes guarantee that some instance is the worst case). Take the **anytime incumbent** when the limit hits. Beyond that: run **asynchronously** (solves take seconds to minutes, not request-latency), make solves **reproducible** (pin solver version + random seed, or yesterday's schedule can't be audited and an upgrade silently changes outputs), and **isolate** them (separate worker pool with resource limits, so a pathological instance can't starve the rest of the service). Operating a solver is closer to operating a database than calling a library.
</details>

**Q35. Why is explainability — not just finding a solution — a recurring professional requirement?**

<details><summary>Answer</summary>

Because in production the *interesting* output is often "no solution," and a bare "infeasible" is useless to an operator or user. The system must say *which* requirements conflict — via an **unsatisfiable core** (a minimal subset of constraints that's still contradictory) or a **relaxation** ("drop or loosen this constraint to make it solvable"). This is exactly why dependency resolvers invested so heavily in it: PubGrub exists largely to turn an UNSAT core into a human sentence ("A needs B≥2 but C needs B<2"). The same need recurs everywhere — a roster that can't be built must tell the manager *why* (e.g., "coverage requires 5 nurses Tuesday night but only 4 are available"), or the model is unusable. Turning UNSAT cores into human explanations is a core production skill.
</details>

**Q36. What is a warm start, and when is it essential?**

<details><summary>Answer</summary>

A **warm start** feeds a known good solution (yesterday's schedule, or a heuristic's output) to the solver as a starting **incumbent**, so branch-and-bound has a good bound immediately and can return quickly if interrupted. It's essential for **re-optimization**: when inputs change only slightly (a few new orders, one staff swap), re-solving from scratch wastes enormous time, whereas warm-starting from the previous solution lets the solver repair it. It also improves anytime behavior — if you're cut off early, you're guaranteed at least the warm-start quality. Not warm-starting re-optimization is a classic production performance bug.
</details>

**Q37. How do solvers and ML combine in practice?**

<details><summary>Answer</summary>

The pragmatic split most teams ship: **ML predicts the uncertain inputs** (demand, travel time, no-show probability), and the **solver makes the decision** subject to hard constraints. This separates "estimate the world" (ML's strength, no feasibility guarantees) from "choose a valid, good action" (the solver's strength, with guarantees), and keeps the hard rules enforceable — which a pure ML model can't promise. Other patterns: **ML guides the solver** (learned variable/value ordering, branching, or algorithm selection — the solver still guarantees feasibility, ML just makes search smarter); **the solver constrains ML** (a projection/repair layer snapping ML output to the nearest feasible assignment, "predict-then-optimize"/"decision-focused learning"); and **differentiable optimization** (embedding a relaxed solver as a neural-net layer, OptNet). The recurring theme: solver guarantees feasibility, ML handles uncertainty or guidance.
</details>

**Q38. Beyond modeling, what performance tuning does a production solver expose?**

<details><summary>Answer</summary>

- **Parallel portfolios** — run several search strategies concurrently across cores; first to finish wins (cheap, large multicore speedups). Tune worker count and watch memory.
- **Presolve / model reduction** — solvers simplify models before searching; a cleaner model (dominated variables removed, bounds tightened at build time) presolves better and compounds.
- **Parameter tuning** — hundreds of knobs (search strategy, restart policy, cut generation); automated tuners (Gurobi's, CP-SAT presets) help, but the **senior modeling levers** (symmetry breaking, redundant constraints, encodings) usually beat parameter fiddling.
- **Observability** — log nodes, conflicts, restarts, the gap-over-time, and solve-time distributions; alert on solves trending toward the time limit (early warning that input scale crossed a threshold); track *which* inputs hit the heavy tail.

The rule of thumb: spend your modeling effort before your parameter-tuning effort — formulation wins dominate knob-twiddling wins.
</details>

---

## Code-Reading — What Does This Model Mean / Return?

> You're shown a model or snippet; say what it expresses and what the solver returns.

**Q39. MiniZinc — what does this model find, and where is the search?**

```minizinc
int: n = 8;
array[1..n] of var 1..n: queen;
constraint all_different(queen);
constraint all_different([queen[c] + c | c in 1..n]);
constraint all_different([queen[c] - c | c in 1..n]);
solve satisfy;
```

<details><summary>Answer</summary>

It solves **8-Queens**: `queen[c]` is the row of the queen in column c (so exactly one queen per column by construction). `all_different(queen)` forbids two queens sharing a row; the second and third `all_different` forbid sharing a `/` and `\` diagonal respectively (two queens are on the same diagonal iff `row+col` or `row−col` collide). `solve satisfy` returns *any* valid board. The trick-question part: **there is no search in this code.** The model states three properties of a valid board; the solver supplies the search (propagation + backtracking). That absence of search *is* the paradigm.
</details>

**Q40. OR-Tools CP-SAT — what does `status` tell you, and what's wrong if it's `UNKNOWN`?**

```python
solver = cp_model.CpSolver()
solver.parameters.max_time_in_seconds = 10.0
status = solver.solve(m)   # OPTIMAL / FEASIBLE / INFEASIBLE / UNKNOWN
```

<details><summary>Answer</summary>

The status is the solver's verdict: **OPTIMAL** (found a solution and proved no better exists), **FEASIBLE** (found a solution but didn't prove optimality — typically because the time limit hit while the optimality gap was still open), **INFEASIBLE** (proved no solution satisfies all constraints), or **UNKNOWN** (it *neither* found a solution *nor* proved infeasibility within the time limit). `UNKNOWN` isn't an error — it means the 10-second budget expired before the solver could decide. Nothing is "wrong" with the model per se; the instance was too hard for the budget. You'd respond by raising the time limit, improving the model (symmetry breaking, global constraints, tighter domains), warm-starting, or falling back to a heuristic. Reading `FEASIBLE` vs `OPTIMAL` matters: `FEASIBLE` means "good answer, optimality unproven," which is often exactly what you want to ship.
</details>

**Q41. Z3 (SMT) — what does this print, and why is it surprising?**

```python
from z3 import BitVec, Solver
x = BitVec('x', 32)
s = Solver()
s.add(x + 1 < x)
print(s.check())   # ?
print(s.model())   # ?
```

<details><summary>Answer</summary>

`sat`, with a model like `x = 2147483647` (`0x7fffffff`). It's surprising because `x + 1 < x` is *impossible for mathematical integers* — but `x` is a **32-bit bit-vector**, so addition wraps on overflow: `0x7fffffff + 1` becomes the most-negative value `0x80000000`, which is indeed `< 0x7fffffff` under signed comparison. The SMT solver reasons in the **theory of bitvectors** (exact machine-integer semantics including overflow), not over mathematical integers, so it finds the overflow witness. This is precisely the kind of query verifiers and symbolic-execution tools run by the millions to catch real overflow bugs. (Had `x` been an SMT `Int`, the same constraint would be `unsat`.)
</details>

**Q42. Z3 — `x, y = Int('x'), Int('y'); s.add(x+y==10, x*2==y)`. What does `check()` return?**

```python
from z3 import Int, Solver
x, y = Int('x'), Int('y')
s = Solver()
s.add(x + y == 10, x * 2 == y)
print(s.check())   # ?
```

<details><summary>Answer</summary>

It returns **unsat**. Substituting `y = 2x` into `x + y = 10` gives `3x = 10`, so `x = 10/3` — *not an integer*. Over the theory of **integer** arithmetic (`Int`), no assignment satisfies both constraints, so the solver correctly proves unsatisfiability. The teaching point: **the theory matters**. Over `Real`, the same constraints are `sat` (`x = 10/3, y = 20/3`); over `Int`, they're `unsat`. An "unsat" here means "no *integer* fits," not "no answer exists in any sense" — conflating the theory's domain with mathematics generally is a common slip.
</details>

**Q43. What's wrong with this `all_different` decomposition, performance-wise?**

```minizinc
% Instead of all_different(xs):
constraint forall(i, j in 1..n where i < j)( xs[i] != xs[j] );
```

<details><summary>Answer</summary>

It's *correct* — it does forbid duplicates — but it throws away the strong specialized propagator. The pairwise `≠` decomposition only deletes a value from a peer once a variable is **fixed** to a single value; it cannot make the *group* deduction that `all_different` can (Hall-set reasoning: if `k` variables share only `k` candidate values, remove those values from everyone else). Concretely, with `Da=Db={1,2}` and `Dc={1,2,3}`, pairwise `≠` deduces nothing yet, while `all_different` immediately forces `Dc={3}`. The fix is to write `all_different(xs)` and let the global propagator do the group reasoning — often the difference between seconds and never finishing.
</details>

---

## Curveballs

> The questions designed to catch glib answers.

**Q44. "Declarative means the solver is magic and I don't need to understand it." True?**

<details><summary>Answer</summary>

False, in the way that matters. The *interface* is declarative — you state what's true, not how to search — but the **cost is not magic**: it's the emergent size of the post-propagation search tree, and it's exquisitely sensitive to *how you model*. Two equivalent models can differ a millionfold; a one-line change can fall off a cliff. So while you don't write the search, you absolutely must understand propagation, global constraints, symmetry, and the satisfy-vs-optimize gap to model so the solver can win. "Declarative" buys you brevity and correctness of *expression*; it does not buy you freedom from understanding *performance*. The senior framing: the model is your real program, the solver is a volatile runtime.
</details>

**Q45. Is a constraint solver just a fancy brute force?**

<details><summary>Answer</summary>

No. Brute force *enumerates* the space; a solver *reasons the space smaller, then searches what's left*. The defining mechanism is **propagation** — at every node, the solver deletes values that provably can't be in any solution (arc consistency and its relatives), so it never visits those subtrees. On an easy Sudoku, propagation alone often solves it with **zero** guessing. Add **clause/no-good learning** (in SAT/CP-SAT) and the solver never re-explores the same dead end. So the *effective* search is a tiny, heavily-pruned fraction of the nominal space. Calling it brute force misses the entire reason an NP-hard problem is tractable in practice.
</details>

**Q46. SAT is NP-complete — doesn't that make SAT solvers useless in practice?**

<details><summary>Answer</summary>

No, and this is the classic miscalibration. NP-completeness is a **worst-case** statement: it guarantees *some* instances are exponentially hard, not that *typical* ones are. Real instances are structured, and **CDCL** (conflict-driven clause learning + unit propagation + non-chronological backjumping) exploits that structure so effectively that modern SAT solvers routinely dispatch instances with **millions** of variables — which is why SAT runs inside package managers, chip-design tools, and verifiers you use daily. The honest caveat: there's no runtime *guarantee*; a pathological instance can blow up. So you ship SAT/SMT with a time limit and a fallback, leaning on the empirical reality that structured instances solve fast.
</details>

**Q47. You're asked for the "optimal" schedule. Is that always the right requirement?**

<details><summary>Answer</summary>

Usually not — "optimal" is frequently a **vanity requirement**. Finding *any* feasible solution stops at the first success; proving *optimality* requires showing no better solution exists, which often consumes the vast majority of runtime closing the optimality gap. A solution within 1–2% of optimal found in 10 seconds almost always beats a provably optimal one found in 3 hours. The right move is to frame the requirement with stakeholders as a product decision: set a **relative gap tolerance** and a **time limit**, exploit the solver's **anytime** behavior, and accept the incumbent. Demanding proven optimality by reflex is a top cause of solver projects that "don't scale."
</details>

**Q48. Two models have identical solution sets. Can one be production-ready and the other useless?**

<details><summary>Answer</summary>

Absolutely — that's the central senior insight. Solve cost is a property of the **model, not the problem**; identical solution sets can have wildly different **propagation strength** and **search shape**. One model uses `all_different` and interval variables, breaks symmetry, and adds an implied total-work bound, and solves in 50ms; the equivalent model uses pairwise `≠`, raw disjunctions, leaves `k!` machine-relabeling symmetry unbroken, and never finishes. Same answers, opposite outcomes. This is why "correct" isn't "done" and why modeling is closer to performance engineering than to ordinary programming.
</details>

**Q49. If you can't predict solve time, how do you give an SLA?**

<details><summary>Answer</summary>

You don't promise *solve-to-optimality* time — you can't, because runtimes are heavy-tailed and unbounded. Instead you make the SLA about **bounded, anytime behavior**: cap every solve with a **time limit** and a **gap tolerance**, return the best incumbent (or a heuristic fallback) when the limit hits, and run solves **asynchronously** off the request path. The SLA is then "you get the best solution we found within N seconds," which *is* bounded and predictable, rather than "you get the optimum," which isn't. You also add **observability** to alert when solves trend toward the limit (input scale drifting), and an isolated worker pool so a pathological instance can't breach latency for other requests. The trick is converting an unpredictable quantity into a bounded one by design.
</details>

**Q50. "Adding constraints can only slow a solver down." Agree?**

<details><summary>Answer</summary>

Disagree — it's a common but wrong intuition. Adding a **redundant/implied constraint** (one already entailed, removing no solutions) frequently *speeds* solving dramatically, because it hands the propagator a new way to prune domains earlier — free deduction. The redundant "total work ≥ Σ durations / capacity" bound lets a scheduler prune aggregate-infeasible branches long before discovering a specific overlap. Likewise, a **symmetry-breaking** constraint removes only *redundant* (symmetric) solutions and can shrink search by `k!`. The intuition "more constraints = slower" comes from per-node propagation cost, which is real but usually dwarfed by the node-count reduction. The discipline: add constraints that are genuinely implied (or only remove symmetric copies) *and* actually propagate early.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q51. The three ingredients of any constraint model?**

<details><summary>Answer</summary>

Variables (the unknowns), domains (their allowed values), and constraints (the rules every solution must satisfy).
</details>

**Q52. CSP vs COP in one line?**

<details><summary>Answer</summary>

A CSP asks for *any* assignment satisfying all constraints; a COP (optimization) asks for the *best* one against an objective — which additionally requires proving no better exists.
</details>

**Q53. Propagation in one sentence?**

<details><summary>Answer</summary>

Deleting, without guessing, the values that can't appear in any solution — shrinking domains so search never visits those subtrees.
</details>

**Q54. Why prefer `all_different` over pairwise `≠`?**

<details><summary>Answer</summary>

The global `all_different` has a specialized propagator (Hall-set/matching reasoning) that prunes far more, far earlier, than pairwise `≠`, which only acts once a variable is fixed.
</details>

**Q55. SAT vs SMT in one line?**

<details><summary>Answer</summary>

SAT is Boolean-only (CNF clauses); SMT is SAT plus theories (arithmetic, bitvectors, arrays), so it speaks the language of real programs.
</details>

**Q56. CP vs MILP — pick which when?**

<details><summary>Answer</summary>

CP for combinatorial/scheduling logic with global constraints; MILP for linear numeric optimization with a linear objective.
</details>

**Q57. The #1 reason a "reasonable" model is mysteriously slow?**

<details><summary>Answer</summary>

Unbroken symmetry — `k!` relabelings of interchangeable objects/values multiplying the search.
</details>

**Q58. What does "infeasible" mean, and what makes it explainable?**

<details><summary>Answer</summary>

No assignment satisfies all constraints; an **unsatisfiable core** — a minimal conflicting subset — makes it explainable.
</details>

**Q59. One package manager that uses a real SAT solver?**

<details><summary>Answer</summary>

Fedora's DNF (via libsolv); openSUSE's Zypper pioneered it; PubGrub-based resolvers use a CDCL-inspired algorithm.
</details>

**Q60. The non-negotiable operational rule for a production solver?**

<details><summary>Answer</summary>

Always bound the solve (time limit + gap), take the anytime incumbent, and have a fallback — never an unbounded blocking call.
</details>

**Q61. Why does Z3 say `x + 1 < x` is `sat` for a 32-bit bitvector?**

<details><summary>Answer</summary>

Bitvector arithmetic wraps on overflow, so `0x7fffffff + 1` becomes negative — the solver finds that overflow witness.
</details>

---

## How to Talk About Constraint Programming in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the three ingredients and the "what, not how" shift.** Variables, domains, constraints → a solver searches. Then immediately note the catch: you give up *predictable* runtime control. That one-two shows you understand both the power and the cost.
- **Say "the solver isn't brute force — it propagates."** Propagation deleting subtrees before search reaches them is *the* idea that explains why an NP-hard problem is practical. Connect it to global constraints (`all_different` ≫ pairwise `≠`).
- **Keep the family straight.** CP / SAT / SMT / MILP — what each accepts and where each wins. Naming Z3 for verification, libsolv/PubGrub for package managers, and CP-SAT for scheduling signals real exposure.
- **Make the senior point: cost is a property of the model, not the problem.** Equivalent models can differ a millionfold; symmetry breaking and implied constraints are "same answer, now fast." This is the single most credibility-building thing you can say.
- **Distinguish feasibility from optimization, and resist "optimal."** Proving optimality is far harder than finding any solution; a bounded gap within a time limit usually ships. Demanding the optimum by reflex is a calibration tell.
- **Know when *not* to use a solver.** Scale, hard real-time deadlines, soft/shifting objectives → heuristics/metaheuristics, often hybrid. Dogmatism in either direction is the failure mode.
- **Talk production, not just modeling.** Bounded asynchronous solves, anytime incumbents, unsatisfiable-core explanations, warm starts, reproducibility (pinned seed/version), observability. "The solver is one box; the system around it is the hard part."
- **Reconcile NP-hardness honestly.** Worst-case ≠ typical-case; real instances are structured; propagation + learning prune ferociously; but there's no guarantee, so ship with a time limit and fallback. Calibrated optimism, not absolutism.

---

## Summary

- **Constraint programming** = declare **variables**, **domains**, and **constraints**; a **solver** searches for an assignment satisfying all of them (a CSP) and optionally optimizing an objective (a COP). You write *what must be true*, not *how to search* — the declarative idea pushed to combinatorial problems.
- A solver isn't brute force: it interleaves **propagation** (delete impossible values — arc consistency / AC-3 and stronger forms) with **backtracking search** (fail-first variable ordering, succeed-first value ordering). **Global constraints** like `all_different` and `cumulative` carry specialized propagators far stronger than hand-decompositions, and are the chief reason CP is practical.
- The family: **CP** (finite domains, global constraints, combinatorial/scheduling), **SAT** (Boolean CNF, conquered by DPLL/CDCL — unit propagation + clause learning + backjumping), **SMT** (SAT + theories: arithmetic, bitvectors, arrays — the engine of verification, symbolic execution, type checking; Z3), **LP/MILP** (linear optimization from operations research; Gurobi/CPLEX). They merge with logic programming in **CLP** and **ASP**.
- The senior bar is **modeling judgment**: solve cost is a property of the *model, not the problem* (equivalent models differ a millionfold; runtimes are heavy-tailed; phase transitions and the one-line cliff are real). The high-value levers are **tight domains**, **the right decision variables/encodings**, **symmetry breaking** (`k!` relabelings), and **redundant/implied constraints** (free deduction). Distinguish **feasibility** from **optimization**, settle for a bounded **optimality gap** within a **time limit**, and **fall back to heuristics/metaheuristics** when the problem is too big, too real-time, or too soft.
- The professional bar is **operating a solver in production**: it runs inside package managers (SAT/libsolv/PubGrub), verifiers and type checkers (SMT/Z3), schedulers/routers (CP/MILP), and config/policy validation (SAT/SMT, AWS Zelkova). Production reliability is the *system around the solver* — input validation, a maintainable rules layer, **bounded asynchronous** solves with **anytime** results, **explainability** (unsatisfiable cores) for infeasibility, **warm starts** for re-optimization, **reproducibility** (pinned version/seed), and **observability**.
- The strongest answers reconcile **NP-hardness with reality** (worst-case ≠ typical; propagation + learning prune most of the space; no guarantee, so time-limit + fallback), resist purism (no single best engine — benchmark; optimal is often a vanity requirement), and frame the solver as *a volatile runtime whose performance you control by modeling*.

---

## Related Topics

- [`junior.md`](junior.md) — variables, domains, constraints, and the solve-vs-search intuition; the Sudoku/N-Queens model vs hand-written backtracking.
- [`middle.md`](middle.md) — CSPs formally, propagation and arc consistency, backtracking + heuristics, global constraints, and the SAT/SMT/MILP family.
- [`senior.md`](senior.md) — the solver-as-black-box risk, modeling for propagation, symmetry breaking, implied constraints, feasibility vs optimization, tool selection, and when to fall back.
- [`professional.md`](professional.md) — real deployments (rostering, routing, EDA, package managers, verification), solver-in-the-loop architecture, tuning, and ML hybridization.
- [01 — Overview & Taxonomy](../01-overview-and-taxonomy/) — where constraint programming sits on the imperative ↔ declarative spectrum.
- [03 — Declarative Programming](../03-declarative-programming/) — the umbrella paradigm: state the goal, let an engine find the path.
- [04 — Logic Programming](../04-logic-programming/) — Prolog/Datalog; CLP and ASP are where logic and constraints merge.
- **Backtracking search, branch-and-bound, metaheuristics, NP-completeness** (DSA / Algorithms) — the exact and approximate search techniques underneath solvers and their fallbacks.
