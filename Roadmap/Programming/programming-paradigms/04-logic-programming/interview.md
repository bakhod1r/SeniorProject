# Logic Programming — Interview Q&A

> **Roadmap:** [Programming Paradigms](../README.md) → Logic Programming
>
> *Logic programming is "state facts and rules, ask a query, let an engine search for a proof." Two mechanisms do everything: **unification** (two-way pattern matching that binds variables) and **backtracking** (rewind and retry on failure). The whole interview lives in the gap between the declarative reading (what's true) and the operational reading (how the engine searches) — and in knowing why **Datalog**, not Prolog, is what production actually ships.*

A bank of 45+ interview questions spanning definitions, the execution model, control (cut, negation), Prolog vs Datalog, when to reach for the paradigm, and code-reading. Each answer models the reasoning a strong candidate gives — including the trade-offs and the runtime reality underneath. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

Examples are in **Prolog** and **Datalog**, with **SQL** and **Python** for contrast where it clarifies.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [The Execution Model / Middle](#the-execution-model--middle)
3. [Control: Cut, Negation, Closed-World / Middle–Senior](#control-cut-negation-closed-world--middlesenior)
4. [Trade-offs & When to Use It / Senior](#trade-offs--when-to-use-it--senior)
5. [Prolog vs Datalog & Production / Senior–Staff](#prolog-vs-datalog--production--seniorstaff)
6. [Code-Reading](#code-reading)
7. [Curveballs](#curveballs)
8. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
9. [How to Talk About Logic Programming in Interviews](#how-to-talk-about-logic-programming-in-interviews)
10. [Summary](#summary)
11. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Definitions, the core distinctions, and the "why does this matter" reasoning.

**Q1. What is logic programming, in one sentence?**

<details><summary>Answer</summary>

You declare **facts** and **rules** (logical statements about what's true), then pose a **query**, and an engine answers it by **searching for a proof** that follows from those statements. You describe *what* is true, not *how* to compute the answer — there are no loops or search code; the engine's unification and backtracking do the finding. The program is a logical theory, and running it asks "what follows from these axioms?"
</details>

**Q2. Distinguish a fact, a rule, and a query.**

<details><summary>Answer</summary>

- **Fact** — an unconditional truth: `parent(tom, bob).` ("tom is a parent of bob").
- **Rule** — a conditional truth, head *if* body: `grandparent(X,Z) :- parent(X,Y), parent(Y,Z).` (`:-` reads "if", `,` reads "and").
- **Query** — a question to the engine: `?- grandparent(tom, W).` ("is this provable, and for which `W`?").

Facts and rules together are called **clauses** and make up the program; the query is what you run against it.
</details>

**Q3. In Prolog, what's the difference between `tom` and `Tom`?**

<details><summary>Answer</summary>

Case is semantic. **Lowercase `tom` is an atom** — a specific, fixed constant. **Capitalized `Tom` is a variable** — a placeholder the engine fills in during unification. So `parent(tom, X)` asks "tom's children?" while `parent(Tom, X)` makes *both* arguments variables ("all parent pairs"). Getting this backward is the most common beginner bug, because the program stays syntactically valid but means something entirely different.
</details>

**Q4. What is unification?**

<details><summary>Answer</summary>

Unification is **two-way pattern matching**: making two terms identical by finding a substitution (variable→value bindings) for their variables. Rules: same atom matches; different atoms fail; a variable matches anything and binds to it; compound terms match if their functors agree and all arguments unify recursively. It's "two-way" because variables on *either* side can get bound:

```prolog
?- point(X, b) = point(a, Y).
% X = a, Y = b.
```

Neither side is privileged as "the pattern" — that symmetry is exactly why one relation runs in multiple directions.
</details>

**Q5. What is backtracking?**

<details><summary>Answer</summary>

When the engine hits a dead end (a goal it can't prove) — or when you ask for another answer — it **rewinds to the most recent choice point, undoes the variable bindings made since then, and tries the next alternative**. It's a depth-first search over a tree of choices. Combined with unification, it's how a logic program computes: unification decides whether the current step matches; backtracking decides what to try when it doesn't. Crucially, **bindings are undone on backtrack** — a variable bound to `bob` on a failed branch becomes unbound again.
</details>

**Q6. How is this different from how you'd solve the same thing imperatively?**

<details><summary>Answer</summary>

Imperatively you write the *search itself* — loops, conditionals, a result accumulator. For grandparents you'd write two nested loops and a join condition. In logic programming you write one rule defining what "grandparent" *means* (`grandparent(X,Z) :- parent(X,Y), parent(Y,Z).`) and the engine supplies the search: the shared variable `Y` *is* the join, and backtracking *is* the nested loop. You never wrote a loop or a search. The leverage is that a rule is a *definition*, not a procedure — add a fact and all derived relations update with no code change.
</details>

**Q7. Why can the same predicate answer multiple different questions?**

<details><summary>Answer</summary>

Because a relation has **no fixed inputs or outputs** — "input" and "output" are just which arguments you leave bound vs unbound. With `parent/2`:

```prolog
?- parent(tom, X).   % tom's children   (X is "output")
?- parent(X, ann).   % ann's parents    (X is now "output")
?- parent(X, Y).     % all parent pairs
```

Unification doesn't care which side is given. This multi-directionality is the headline feature — `append/3` famously serves as concatenate, split, *and* prefix-remove, all from one two-clause definition.
</details>

**Q8. What's a Horn clause, and why does it matter here?**

<details><summary>Answer</summary>

A **Horn clause** is a logical implication with *at most one positive literal*: "H is true if B1 and B2 and … Bn." It's exactly the shape of a Prolog rule (`H :- B1, B2, ..., Bn`) and a fact (a Horn clause with an empty body). Horn clauses matter because resolution over them (**SLD resolution**) is efficient and well-behaved — it's what makes logic programming computationally tractable rather than requiring full first-order theorem proving. Prolog and Datalog are both "definite-clause" (Horn) languages.
</details>

---

## The Execution Model / Middle

> How the engine actually runs — the part that separates "I read about Prolog" from "I understand it."

**Q9. Describe SLD resolution in operational terms.**

<details><summary>Answer</summary>

To prove a list of goals: take the **leftmost** goal, scan clauses **top to bottom** for one whose head **unifies** with it, replace that goal with the matched clause's body (applying the bindings), and repeat. Succeed when the goal list is empty; on failure, **backtrack** to the last clause choice and try the next. The two fixed conventions — *leftmost goal*, *top-to-bottom clauses* — pin the entire execution order. They're not part of the logical meaning (logically "A and B" = "B and A"), but they completely determine how Prolog runs.
</details>

**Q10. What is the most general unifier (MGU)?**

<details><summary>Answer</summary>

The MGU is the unifying substitution that **commits to as little as possible** — it binds only what's forced and links the rest. For `f(X, b)` and `f(a, Y)`, the MGU is `X = a, Y = b`. For `point(X, Y) = point(3, Z)`, it's `X = 3, Y = Z` — it does *not* invent a value for `Y`; it links `Y` and `Z` and leaves them open. "Most general" = "leaves the most freedom," which is exactly what lets later goals further constrain those variables and what makes relations run in many directions.
</details>

**Q11. What is the occurs check, and why does standard Prolog skip it?**

<details><summary>Answer</summary>

The occurs check verifies that a variable isn't bound to a term *containing itself* (e.g., `X = f(X)`), which would create an infinite term. Logically, such a unification should fail. Standard Prolog **skips the check by default for speed** — so `X = f(X)` "succeeds" and may later loop or crash. It's rarely hit in normal code, but you should know `unify_with_occurs_check/2` is the safe variant. (This same issue appears in type inference, which is unification under the hood.)
</details>

**Q12. Why is goal order within a rule body significant?**

<details><summary>Answer</summary>

Because Prolog executes goals **strictly left-to-right and never reorders them** — there's no query optimizer. Putting a selective or recursion-consuming goal first can mean the difference between milliseconds and an infinite loop:

```prolog
near(A,B) :- city(A), city(B), distance(A,B,D), D < 10.  % generate all pairs, then filter — slow
near(A,B) :- city(A), distance(A,B,D), D < 10, city(B).  % constrain B early — fast
```

Same logic, same answers, wildly different cost. This is "Algorithm = Logic + Control": your clauses are the logic, the *order* is the control, and Prolog mixes them in one syntax.
</details>

**Q13. Why does the order of *clauses* matter?**

<details><summary>Answer</summary>

Clauses are tried top-to-bottom, so clause order determines **answer order**, and — combined with a cut — can determine the answer *set*. The classic trap is left recursion: `ancestor(X,Z) :- ancestor(X,Y), parent(Y,Z).` recurses before consuming any fact and loops forever, while the logically-identical `ancestor(X,Z) :- parent(X,Y), ancestor(Y,Z).` terminates. Putting the base/non-recursive clause *first* also matters for getting answers out in a sensible order.
</details>

**Q14. How do you do iteration in a language with no loops?**

<details><summary>Answer</summary>

**Recursion is the only iteration**, almost always over lists split into head/tail `[H|T]`. The pattern is "base case for `[]`, recursive case peeling off the head":

```prolog
len([], 0).
len([_|T], N) :- len(T, N0), N is N0 + 1.
```

Note `is` *evaluates* arithmetic — `N is N0 + 1` computes a number, whereas `N = N0 + 1` would unify `N` with the unevaluated term `+(N0, 1)`. Forgetting `is` is a top recurring bug, and `is` requires its right side fully bound (the one directional spot in an otherwise relational language).
</details>

**Q15. Walk through `append/3` running "backwards."**

<details><summary>Answer</summary>

```prolog
append([], L, L).
append([H|T], L, [H|R]) :- append(T, L, R).
```

One definition, many directions depending on which args are bound:

```prolog
?- append([a,b],[c,d],R).      % R=[a,b,c,d]              (concatenate)
?- append([a,b],X,[a,b,c,d]).  % X=[c,d]                  (remove known prefix)
?- append(F,B,[a,b,c]).        % enumerate ALL splits via backtracking
```

The split mode is the gem: "find a front and back such that <property>," and let backtracking try every division. In an imperative language each mode is a separate function; here it's one relation.
</details>

---

## Control: Cut, Negation, Closed-World / Middle–Senior

> The features that separate people who *use* Prolog from people who *fight* it.

**Q16. What does the cut (`!`) do?**

<details><summary>Answer</summary>

`!` is a goal that always succeeds but with a side effect: it **commits to all choices made since entering the current clause**. Specifically it discards (a) the choice of *which clause* was selected for this predicate, and (b) the choice points for goals *to its left* in the current body. Backtracking can no longer undo those. You use it to prune branches you know are pointless — preventing duplicate answers, wrong extra answers, or wasted search.

```prolog
max(X, Y, X) :- X >= Y, !.   % committed: don't also try clause 2
max(_, Y, Y).
```
</details>

**Q17. Distinguish a green cut from a red cut.**

<details><summary>Answer</summary>

- **Green cut** — removes choice points that could only fail or duplicate anyway. It's pure efficiency; the program's *answer set is unchanged* with or without it. Safe.
- **Red cut** — *changes* the set of answers; the program now depends on the cut for correctness. The `max` example above is slightly red, because clause 2 has no guard: remove the cut and `?- max(5,3,M)` wrongly also offers `M=3`.

Red cuts break the clean logical reading of your code and make the operational behavior diverge from the declarative meaning. Rule of thumb: prefer green cuts; treat red cuts as a code smell to isolate and comment.
</details>

**Q18. What is the closed-world assumption (CWA)?**

<details><summary>Answer</summary>

The CWA says **anything not provable from the stated facts and rules is taken to be false**. The database is assumed complete — absence of proof *is* proof of absence. So `?- parent(tom, jim).` returns `false` not because tom isn't jim's parent in reality, but because no clause derives it. The consequence: **your facts must be complete**, because every gap becomes a confident `false`, not an "unknown" and not an error. (This is the opposite of the open-world assumption used by RDF/OWL on the semantic web, where absent means unknown.)
</details>

**Q19. What is negation as failure, and what's its famous pitfall?**

<details><summary>Answer</summary>

Logic programming has no true logical "not"; it has **negation as failure** (`\+ Goal`): `\+ Goal` succeeds if `Goal` *cannot be proved*, and fails if it *can*. It's negation defined operationally, built on the CWA.

The pitfall is using it with **unbound variables**. `\+ parent(X, _)` does *not* mean "find an X that isn't a parent" — with `X` unbound, `parent(X,_)` *is* provable (e.g. `X=tom`), so the negation fails and you get `false`. NAF can only *test* whether a ground goal is underivable; it **cannot generate** the things that don't hold. The fix is to bind the variable from a known set first, then negate: `non_parent(X) :- person(X), \+ parent(X,_).` The slogan: `\+` means "not provable," not "false in the world."
</details>

**Q20. Why isn't `\+ \+ Goal` the same as `Goal`?**

<details><summary>Answer</summary>

Because negation as failure **throws away bindings**. `\+ Goal` proves `Goal` only far enough to decide success/failure, then discards any variables it bound. So `\+ \+ Goal` acts as a pure *test* — "is `Goal` provable?" — that succeeds when `Goal` does but leaves *no* variables bound. `Goal` itself, run directly, would bind its variables. Double negation is a useful idiom precisely *because* it tests provability without committing to a particular solution's bindings — but it is not logically equivalent to the goal.
</details>

**Q21. What is stratified negation and why does Datalog require it?**

<details><summary>Answer</summary>

**Stratification** means you may negate a relation only if it's *fully computed in an earlier layer (stratum)* than the rule using the negation. It bans cycles through negation — rules like "p if not p," which have no well-defined meaning under the CWA. Datalog enforces stratification at load time (rejecting non-stratified programs) so that negation stays well-defined and the bottom-up fixpoint is deterministic. Prolog, by contrast, lets you write any `\+` and leaves the semantics to you — another reason Datalog is the safer choice for production rule sets.
</details>

---

## Trade-offs & When to Use It / Senior

> The judgment questions — where the paradigm wins, where it's a trap.

**Q22. Explain "Algorithm = Logic + Control."**

<details><summary>Answer</summary>

Kowalski's formula: a program's *logic* (what it computes — your clauses) is separable from its *control* (how the engine searches — clause order, goal order, cut). Prolog mixes both in one syntax, so editing "the logic" can silently edit "the control." The clearest demonstration: reordering a rule body's goals is logically a no-op (conjunction commutes) but can turn a fast query into an infinite loop. The senior implication: in real logic programs you are *always also* programming the engine, and "just write declarative logic, ignore the engine" only holds for toy examples.
</details>

**Q23. Why is a Prolog program's performance hard to predict?**

<details><summary>Answer</summary>

Performance is the **size and shape of the search tree**, which isn't visible in the clauses. Three reasons: (1) the tree blows up combinatorially with each choice point, and Prolog **won't reorder goals** for you — there's no optimizer, so you hand-tune goal order like a manual query planner; (2) plain SLD **re-derives subgoals** with no memoization (exponential recomputation) unless you add **tabling**; (3) indexing is shallow (often first-argument only), so queries on later arguments linear-scan. You can't count loops the way you do imperatively — you have to reason about the tree.
</details>

**Q24. Does a logic program always terminate?**

<details><summary>Answer</summary>

**No — Prolog is Turing-complete**, so by Rice's theorem termination is undecidable. Left recursion, recursion through generated structures, and cyclic data under a naive transitive-closure rule all loop forever despite being *logically correct*. Mitigations: order goals so recursion consumes input, use **tabling** (which detects repeated subgoals and recovers termination for many cases), bound the search (`call_with_depth_limit`), or — best when applicable — use **Datalog**, which restricts the language precisely to *guarantee* termination.
</details>

**Q25. When does logic programming genuinely win?**

<details><summary>Answer</summary>

When the problem is **rules over relations and you care about relationships, not control flow** — and you'd otherwise hand-write search, joins, or transitive closures. Strong fits: **static analysis** (code as facts, analyses as rules), **type inference** (unification + constraints), **deductive databases** and recursive relationships, **policy / authorization** (inheritance as transitive closure), **knowledge graphs**, and **combinatorial/constraint** problems. The tell: if you're writing nested loops to compute a transitive closure or "all combinations satisfying these conditions," you're hand-implementing what a logic engine does in one rule.
</details>

**Q26. When is it the wrong tool?**

<details><summary>Answer</summary>

Sequential, side-effectful workflows (I/O pipelines, request handlers — Prolog's state and I/O are awkward bolt-ons); performance-critical numeric/tight-loop code (the search machinery is pure overhead); problems with a direct algorithm and no real inference; and any long-lived codebase owned by a team without logic-programming fluency, where order-sensitivity and search-debugging cost compound. The mature move is almost always **embed a logic engine for the inference subproblem** inside an otherwise conventional system — not adopt a logic *language* for the whole app.
</details>

**Q27. Why is debugging a logic program different?**

<details><summary>Answer</summary>

You're debugging a *search*, not a sequence of state mutations. The standard tool is the **4-port box model**: every goal has **Call / Exit / Redo / Fail** ports, and you read the trace of that stream. Failure is silent and ambiguous — a `false` could be a missing fact, a wrong argument order, a `\+` that fired, or an unbound variable — so you bisect by querying sub-goals in isolation. There's also **declarative debugging** (ask "is this clause's claim true?" independent of execution), which has no imperative analog. The cognitive load — holding the proof tree, binding trail, and backtracking order at once — is a real adoption cost.
</details>

---

## Prolog vs Datalog & Production / Senior–Staff

> The questions that show you know where this paradigm actually ships.

**Q28. Prolog vs Datalog — what's the difference and why does it matter?**

<details><summary>Answer</summary>

Datalog is a *restricted* Prolog: Horn clauses, **no function symbols building unbounded terms**, and **range restriction** (head variables must appear in a positive body goal). Those restrictions buy: **guaranteed termination**, **bottom-up fixpoint evaluation** (vs Prolog's top-down/backtracking), **set-at-a-time** answers with natural deduplication, **order-insensitivity** (true declarative semantics), and an engine that can **reorder, index, and parallelize**. It matters because **Datalog is what production actually deploys** — static analyzers, deductive databases, authorization — while Prolog stays niche. You trade expressiveness for decidability and scale, which for pure relational inference is almost always the right trade.
</details>

**Q29. Explain bottom-up vs top-down evaluation.**

<details><summary>Answer</summary>

**Top-down (Prolog/SLD):** start from the query goal and work *backward* through rules to facts, one solution at a time via backtracking. **Bottom-up (Datalog):** start from the base facts and repeatedly apply rules to derive *all* new facts until nothing new appears (least fixpoint), then answer the query from the materialized set. Bottom-up deduplicates naturally, terminates (finite domain), and parallelizes; **semi-naïve evaluation** makes it efficient by using only facts derived in the previous round each iteration, avoiding re-derivation. That's why a tool ingesting millions of facts (a whole codebase) chooses bottom-up Datalog.
</details>

**Q30. How is logic programming used in static analysis?**

<details><summary>Answer</summary>

**Treat the program under analysis as a fact database, and the analysis as logic rules.** A front-end emits relations (`assign/3`, `call/2`, `alloc/2`); an analysis is rules over them, and "run the analysis" = "compute the fixpoint." A points-to analysis that's pages of imperative worklist code becomes a handful of mutually-recursive Datalog rules. **Soufflé** compiles Datalog to parallel C++ for industrial scale (it's the engine behind Doop's Java points-to analysis); **CodeQL** has Datalog evaluation semantics under its query language and runs taint/reachability queries across millions of GitHub repos. The fit is perfect: analyses *are* recursive relations, the fact set is large but finite, and you want the complete deduplicated result with guaranteed termination on adversarial input.
</details>

**Q31. Where else does a logic engine live inside systems you've used?**

<details><summary>Answer</summary>

Type inference (Hindley–Milner is unification + constraints; Rust's trait solver `chalk` is Prolog-like); **deductive databases** (Datomic uses Datalog; recursive SQL `WITH RECURSIVE` CTEs are Datalog in disguise); **authorization/IAM** (recursive group/role permissions as transitive-closure rules under deny-by-default CWA — Zanzibar-style systems); **network/policy verification** (reachability as recursive rules); **business rule engines** (Drools, forward-chaining via Rete); **knowledge graphs/SPARQL** (triple pattern-matching + rule inference). You've almost certainly depended on a logic engine this week without writing Prolog.
</details>

**Q32. Forward vs backward chaining — define and map to tools.**

<details><summary>Answer</summary>

**Backward chaining** starts from a *goal* and works toward facts (Prolog, SLD) — best when you have a specific thing to prove. **Forward chaining** starts from *facts* and derives forward to whatever fires (Datalog bottom-up, and rule engines like Drools via the Rete algorithm) — best when many facts change incrementally and you want to know what's now true (pricing, fraud rules, eligibility). Picking the wrong direction means fighting the engine: a "many facts, what fires?" workload on a backward-chaining tool re-proves everything from scratch.
</details>

**Q33. CWA vs OWA — and why must a professional never confuse them?**

<details><summary>Answer</summary>

**Closed-world (Prolog, Datalog, most policy systems):** absent ⇒ **false** (deny by default, complete database). **Open-world (RDF/OWL, semantic web):** absent ⇒ **unknown** (no one has all the facts). They're opposite defaults, so "negation" behaves completely differently: NAF in Datalog concludes false from absence; an OWA reasoner refuses to. Confusing them produces subtly, dangerously wrong reasoning — e.g., treating "no record of a deny rule" as "allowed" in an open-world store that simply hadn't loaded the rule yet. Always know which assumption your system makes.
</details>

**Q34. What does Constraint Logic Programming add, and when do you reach for it?**

<details><summary>Answer</summary>

CLP replaces blind generate-and-test backtracking with **constraint propagation**: the engine maintains the feasible domain of each variable and *prunes* impossible values as constraints are posted, *before* searching. In CLP(FD), `X in 1..9, Y in 1..9, X+Y #= 10, X #< Y, label([X,Y])` narrows the domains so `label` enumerates a tiny remaining space instead of 81 combinations — turning exponential brute force into guided search. You reach for it for **scheduling, timetabling, resource allocation, configuration** — any problem that's really a constraint-satisfaction search. It's the on-ramp from logic programming to solvers (SAT/SMT/MILP); see [13 — Constraint Programming](../13-constraint-programming/).
</details>

**Q35. What are the operational concerns of deploying a Datalog engine?**

<details><summary>Answer</summary>

It behaves like an **analytics workload**: (1) **fact extraction often dominates cost** — parsing source and emitting relations is usually more work than the evaluation; (2) **memory** — bottom-up materializes derived facts, and a transitive closure over a dense graph can explode quadratically, so engines invest heavily in compact indexes; (3) **incrementality** — recomputing the whole fixpoint on every small input change is wasteful, so differential/incremental evaluation matters for IDE and CI use; (4) **determinism** — bottom-up is deterministic (great for auditable security results); (5) **guaranteed termination is a *safety* property** on untrusted/unbounded input, which is what disqualifies raw Prolog for analyzing arbitrary user code.
</details>

---

## Code-Reading

> Given the code, say what it does — and why.

**Q36. What does this query return, and in what order?**

```prolog
sibling(A, B) :- parent(P, A), parent(P, B), A \= B.
% facts: parent(joe, ann). parent(joe, bob). parent(joe, cas).
?- sibling(ann, X).
```

<details><summary>Answer</summary>

`X = bob ; X = cas.` The engine binds `A = ann`, finds `P = joe` (the only parent of ann), then enumerates `parent(joe, B)`: `B = ann` is rejected by `ann \= ann`, then `B = bob` succeeds, then `B = cas` succeeds. Order follows the fact order. Note `\=` means "does not unify" and is what excludes ann being her own sibling. (If you ran `sibling(X, Y)` fully unbound you'd also see each pair in *both* orders — `(bob,ann)` and `(ann,bob)` — a classic "duplicate-looking" result of relational symmetry.)
</details>

**Q37. Why does this loop forever?**

```prolog
ancestor(X, Z) :- ancestor(X, Y), parent(Y, Z).
ancestor(X, Z) :- parent(X, Z).
?- ancestor(a, W).
```

<details><summary>Answer</summary>

**Left recursion.** The first clause's leftmost goal is `ancestor(X, Y)` — the engine recurses into `ancestor` *before* consuming any `parent` fact, so the search tree's leftmost branch descends infinitely (`ancestor(a,Y)` → `ancestor(a,Y')` → …) and never reaches the base clause. The logic is correct; the *control* is broken. Fix: put the fact-consuming goal first — `ancestor(X,Z) :- parent(X,Y), ancestor(Y,Z).` with the base clause `ancestor(X,Z) :- parent(X,Z).` Order is termination-critical.
</details>

**Q38. What does `?- \+ member(d, [a,b,c]).` return, and `?- \+ member(X, [a,b,c]).`?**

<details><summary>Answer</summary>

The first returns **true**: `member(d, [a,b,c])` cannot be proved, so its negation-as-failure succeeds. The second returns **false**: with `X` unbound, `member(X, [a,b,c])` *is* provable (`X = a`), so `\+` fails — it does **not** search for an element that isn't in the list. This is the canonical NAF trap: `\+` tests provability of a (preferably ground) goal; it cannot *generate* non-members.
</details>

**Q39. What's wrong with `count_up(N) :- N1 = N + 1, write(N1).`?**

<details><summary>Answer</summary>

It uses `=` instead of `is`. `N1 = N + 1` **unifies** `N1` with the *unevaluated term* `+(N, 1)` — so for `N = 3` it prints `3+1`, not `4`. To evaluate the arithmetic you need `N1 is N + 1`. And `is` requires its right side fully bound, so `N` must already have a numeric value. Confusing `=` (unify) with `is` (evaluate) is one of the most common Prolog beginner bugs.
</details>

**Q40. Reading this Datalog, what does `r` compute?**

```prolog
r(X, Y) :- edge(X, Y).
r(X, Y) :- edge(X, Z), r(Z, Y).
```

<details><summary>Answer</summary>

**Transitive closure (reachability)** of the `edge` relation: `r(X, Y)` holds iff there's a directed path of one or more edges from `X` to `Y`. Base clause: a direct edge. Recursive clause: an edge to some `Z` from which `Y` is reachable. In Datalog this is evaluated **bottom-up to a fixpoint** with guaranteed termination and deduplication — the same query that SQL needed `WITH RECURSIVE` to express, in two lines. This is the single most representative Datalog idiom.
</details>

---

## Curveballs

> Questions that test depth, not memorization.

**Q41. "Logic programming is purely declarative." Push back.**

<details><summary>Answer</summary>

Only the *logical reading* is declarative; the *operational behavior* is thoroughly imperative. Goal order changes performance and termination, clause order changes answer order, the cut changes the answer set, and arithmetic (`is`) is directional. Prolog literally lets you write a "correct program that doesn't work" — logically right, operationally non-terminating. **Datalog** gets much closer to the declarative ideal (order-insensitive, terminating, optimizer-reordered), which is exactly *why* it restricted the language. So "purely declarative" is aspirational for Prolog and roughly true for Datalog — the distinction is the whole point.
</details>

**Q42. How is a Prolog rule related to a SQL JOIN?**

<details><summary>Answer</summary>

A rule body with a shared variable *is* a join, and the shared variable is the join key. `grandparent(X,Z) :- parent(X,Y), parent(Y,Z).` corresponds exactly to a self-join `... FROM parent a JOIN parent b ON a.child = b.parent`. Facts are rows; predicates are tables; a query with variables is a `SELECT`. The deep connection is real — Datalog is essentially "SQL plus clean recursion," and recursive SQL CTEs were added to express the transitive closures Datalog always had. If you understand SQL self-joins, you already half-understand logic programming.
</details>

**Q43. If unification is so central, where else have you seen it outside Prolog?**

<details><summary>Answer</summary>

**Type inference.** Hindley–Milner (ML, Haskell, and the core of inference in Rust/Scala/TypeScript) works by generating type *constraints* and solving them by **unification** — the exact algorithm, including the occurs check (which catches infinite types like `t = t -> t`). Rust's trait resolver `chalk` is explicitly a Prolog-like engine. Pattern matching in functional languages is one-directional unification. So the mechanism you learned for Prolog is quietly running inside the type checker of nearly every language you use.
</details>

**Q44. Could you implement backtracking search in Python instead? Why use a logic language?**

<details><summary>Answer</summary>

Yes — generators, recursion, and explicit choice can replicate backtracking, and for a one-off you should. The case for a logic language (or embedded engine) is when the problem is *pervasively* rules-over-relations: you'd be reimplementing unification, backtracking, indexing, tabling, and fixpoint evaluation by hand, repeatedly, with bugs. A mature Datalog engine gives you guaranteed termination, deduplication, indexing, and parallel bottom-up evaluation that you will not casually rebuild. The decision is the same as "could I write my own query planner?" — yes, but you reach for Postgres. Reach for the engine when the inference is the core of the problem, not incidental.
</details>

**Q45. A teammate "cleaned up" a Prolog predicate by reordering its body goals. CI now hangs. Explain to them what happened.**

<details><summary>Answer</summary>

In their mental model, reordering `a, b` to `b, a` is a no-op because "and" commutes — and *logically* it is. But Prolog executes goals **strictly left-to-right with no reordering**, so the new order put a recursive or unconstrained goal first, creating an infinite (or huge) leftmost branch in the search tree before any constraining goal could prune it. The lesson: in Prolog, **goal order is load-bearing control, not cosmetic** — it determines performance and termination. Reordering goals is a behavior change, not a refactor, and the operational contract ("`distance` must bind B before `city(B)`") should be a comment so nobody "cleans it up" again.
</details>

---

## Rapid-Fire / One-Liners

> One-sentence answers; know them cold.

<details><summary>Expand</summary>

- **Fact vs rule?** Fact = unconditional truth; rule = head true *if* body true (`:-` = if).
- **`:-`, `,`, `;`?** "if", "and", "or".
- **Atom vs variable?** lowercase = fixed constant; Capitalized = engine-filled placeholder.
- **Unification in 5 words?** Two-way matching that binds variables.
- **Backtracking in 5 words?** Rewind, undo bindings, try next.
- **What does `!` do?** Commit to choices made so far in this clause; prune.
- **Green vs red cut?** Green = same answers (efficiency); red = changes answers.
- **`\+`?** Negation as failure = "not provable," not "false in the world."
- **CWA?** Unprovable ⇒ false; the database is assumed complete.
- **OWA?** Unprovable ⇒ unknown (RDF/OWL); opposite of CWA.
- **`=` vs `is`?** `=` unifies (term); `is` evaluates arithmetic (number).
- **Iteration in Prolog?** Recursion over `[H|T]` lists; no loops.
- **MGU?** The unifier that commits to the least.
- **SLD resolution?** Leftmost goal, top-to-bottom clauses, unify, replace with body, backtrack on fail.
- **Why does Prolog not always terminate?** It's Turing-complete; left recursion/cycles loop.
- **Prolog vs Datalog in one line?** Datalog = restricted Prolog with guaranteed termination, bottom-up evaluation, and dedup.
- **Top-down vs bottom-up?** Prolog from the goal backward; Datalog from facts forward to a fixpoint.
- **Tabling?** Memoize subgoal results — fixes recomputation and many infinite loops.
- **Where is Datalog deployed?** Static analysis (Soufflé, CodeQL), deductive DBs, authorization.
- **Rule = SQL ___?** JOIN; the shared variable is the join key.
- **Forward vs backward chaining?** Facts→conclusions (Drools/Datalog) vs goal→facts (Prolog).
- **CLP adds what?** Constraint propagation that prunes domains before search.
</details>

---

## How to Talk About Logic Programming in Interviews

A few framing moves that signal seniority:

1. **Lead with the two mechanisms.** "It's facts and rules, and the engine answers queries via **unification** and **backtracking**." Naming both immediately shows you understand the model, not just the syntax.
2. **Name the declarative/operational gap unprompted.** Saying "the logic reading and the search reading are different, and that gap is where the bugs live" is the single clearest senior signal — it shows you've actually fought a Prolog program.
3. **Pivot to Datalog for "production" questions.** If asked where this is used in real systems, *correct the premise*: "Prolog is niche; the technology that scaled is **Datalog** — static analysis, deductive databases, authorization — because it guarantees termination and evaluates bottom-up." This shows current, practical knowledge.
4. **Have one concrete win ready.** "Static analysis: code becomes facts, analyses become rules; a points-to analysis that's pages of worklist code is a handful of Datalog rules — that's CodeQL and Soufflé." Concrete beats abstract.
5. **Be honest about the trade-offs.** Performance unpredictability, termination, goal-order sensitivity, and the debugging cost. Acknowledging the downsides makes your "when it wins" credible.
6. **Use the SQL bridge.** "A rule is a named JOIN; Datalog is SQL with clean recursion." It anchors an unfamiliar paradigm to something the interviewer knows.

> The strongest candidates don't just define unification — they explain *why* a relation runs in multiple directions, *why* clause order can change termination, and *why* Datalog (not Prolog) is what production ships. Definitions are table stakes; the *judgment* is the differentiator.

---

## Summary

Logic programming is **facts + rules + a query**, answered by an engine that **searches for a proof** using **unification** (two-way pattern matching that binds variables to their most general unifier) and **backtracking** (rewind, undo bindings, retry). The execution model is **SLD resolution**: leftmost goal, top-to-bottom clauses — conventions that fix the operational behavior even though they're invisible in the logical reading, which is why **goal and clause order are load-bearing** (they control performance and termination). Control comes from the **cut** (green = efficiency, red = changes answers) and **negation as failure** (`\+` = "not provable," with the unbound-variable trap), both resting on the **closed-world assumption** (absent ⇒ false). The senior judgment is the **declarative ideal vs operational reality** gap, the lack of guaranteed termination (Prolog is Turing-complete), and recognizing the "rules over relations / transitive closure / constraint search" shape. The production reality is **Datalog, not Prolog** — restricted to win guaranteed termination, bottom-up fixpoint evaluation, and dedup, which is why it's the engine inside static analysis (Soufflé, CodeQL), deductive databases, and authorization. Know the two mechanisms cold, name the declarative/operational gap, pivot to Datalog for "real-world" questions, and bridge to SQL — that's the interview.

---

## Related Topics

- [junior.md](junior.md) — facts, rules, queries, unification, backtracking (the foundation).
- [middle.md](middle.md) — SLD resolution, the cut, recursion, closed-world assumption, negation as failure (the mechanics).
- [senior.md](senior.md) — declarative-vs-operational trade-offs, termination, when logic programming wins.
- [professional.md](professional.md) — Datalog, Soufflé/CodeQL, deductive databases, policy/authz, knowledge graphs in production.
- [13 — Constraint Programming](../13-constraint-programming/) · [03 — Declarative Programming](../03-declarative-programming/) · [15 — Symbolic Programming](../15-symbolic-programming/) — neighboring paradigms.
