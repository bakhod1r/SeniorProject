# Formal Specification — Senior Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → Formal Specification
> *The middle page taught you to write a precise spec. This page is about the decisions: what to leave out, how to know a spec proves something rather than nothing, why a safety violation is a finite counterexample but a liveness violation is an infinite trace, and how a spec stays honest after the code it describes has moved on.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Abstraction Problem](#core-concept-1--the-abstraction-problem)
5. [Core Concept 2 — State-Based Modeling and the Framing Problem](#core-concept-2--state-based-modeling-and-the-framing-problem)
6. [Core Concept 3 — Safety vs Liveness, Rigorously](#core-concept-3--safety-vs-liveness-rigorously)
7. [Core Concept 4 — Fairness, and Why Liveness Needs It](#core-concept-4--fairness-and-why-liveness-needs-it)
8. [Core Concept 5 — Refinement Theory](#core-concept-5--refinement-theory)
9. [Core Concept 6 — Model-Finding vs Model-Checking vs Proving](#core-concept-6--model-finding-vs-model-checking-vs-proving)
10. [Core Concept 7 — Specification Smells and Failure Modes](#core-concept-7--specification-smells-and-failure-modes)
11. [Core Concept 8 — Property Patterns as Reusable Templates](#core-concept-8--property-patterns-as-reusable-templates)
12. [Core Concept 9 — Conformance: Keeping Spec and Code in Sync](#core-concept-9--conformance-keeping-spec-and-code-in-sync)
13. [Real-World Examples](#real-world-examples)
14. [Mental Models](#mental-models)
15. [Common Mistakes](#common-mistakes)
16. [Test Yourself](#test-yourself)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)
20. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The judgement a senior engineer brings to specification — choosing the abstraction, proving the spec means something, and keeping it honest over time.**

By the middle level you can write a state schema, state an invariant, and express a property in temporal logic. That makes you useful in a design review. The senior jump is different: you now decide *what a spec is for* and *whether it earns its keep*. You choose the level of abstraction — the single decision that determines whether the spec is a sharp tool or a second, buggy implementation. You can tell a vacuously-true assertion from a real guarantee, a safety property from a liveness property, and an over-specified design from one that actually leaves room to implement.

Each of those judgements has consequences that outlast the spec document. Pick the wrong abstraction and you spend weeks modeling byte layout while the consistency bug you were chasing slips through untouched. State a property without checking it has a model and you "prove" something about a world that can't exist. Write a liveness property without a fairness assumption and the model checker dutifully reports a counterexample that no real scheduler would ever produce. To navigate this you have to understand specification *as an engineering discipline* — the abstraction tradeoff, the safety/liveness/refinement theory, and the failure modes — because that is where the value, and the wasted effort, actually live. This page is that layer.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — state, operations, invariants, pre/postconditions, and basic temporal operators (□ always, ◇ eventually).
- **Required:** Comfort with first-order logic and set theory: quantifiers, relations as sets of pairs, function vs relation, domain/range.
- **Helpful:** You've written at least one spec in Alloy or TLA+ and watched a checker hand you a counterexample you didn't expect.
- **Helpful:** A working memory of the difference between a *model* (an instance satisfying the spec) and a *property* (a claim about all behaviors) — the distinction this page leans on constantly.

---

## Glossary

| Term | Meaning |
|---|---|
| **Abstraction** | The deliberate choice of which state and operations to represent and which to discard; the spec's level of detail. |
| **State schema** | A named declaration of state variables plus an invariant constraining them (Z's central construct). |
| **Invariant** | A predicate true in every reachable state; the system's "always" guarantee. |
| **Frame condition** | An explicit statement of what an operation leaves *unchanged* (Z's Ξ/Δ, `UNCHANGED` in TLA+). |
| **Safety property** | "Nothing bad ever happens" — refuted by a finite prefix; a closed set in the trace topology. |
| **Liveness property** | "Something good eventually happens" — refuted only by an infinite trace; a dense set. |
| **Fairness** | An assumption that a continuously/repeatedly enabled action eventually fires (weak vs strong). |
| **Refinement** | A relation showing a concrete spec correctly implements an abstract one (every concrete behavior is allowed by the abstract). |
| **Simulation relation** | A relation between abstract and concrete states proving one can mimic the other step for step. |
| **Retrieve/abstraction relation** | The mapping from concrete state back to abstract state in data refinement. |
| **Small-scope hypothesis** | The empirical claim that most spec bugs surface in small instances, justifying bounded analysis (Alloy). |
| **Vacuous truth** | An assertion that holds only because its premise is never satisfiable — true but meaningless. |
| **Conformance** | Evidence that the running code actually satisfies the spec (proof, generated code, monitor, or test). |

---

## Core Concept 1 — The Abstraction Problem

This is *the* skill of specification, and everything else is downstream of it. A specification is not a description of a system; it is a description of *what about the system matters*. The entire value proposition collapses if you get the level wrong in either direction.

Push the abstraction too low and you have written a second implementation — one with all the detail of the real code, the same opportunity for bugs, and none of the benefit. If your cache spec models the eviction list's pointer manipulation and the slab allocator's free-list, you have re-implemented the cache in your spec language; a bug in the spec is now as likely as a bug in the code, and proving the spec correct tells you nothing about whether *the spec itself* is right.

Push it too high and you have proved something true but useless. A spec that says "a cache returns values" admits a cache that returns stale or wrong values; it has abstracted away the only property anyone cares about.

> **Key insight:** A spec captures *what matters* by encoding the property you fear violating and abstracting away everything else. For a cache, that is almost never the byte layout — it is the *consistency model*: does a read after a write see the write? The right state is `store: Key → Value` and a `dirty`/`valid` marker, not the memory arena. Choosing the state *is* choosing the spec.

Two heuristics make the choice tractable:

1. **Model the observable behavior, not the mechanism.** A queue's spec is a sequence with `enqueue`/`dequeue`; whether the implementation uses a ring buffer or a linked list is below the abstraction line. You model what a *client* can observe.
2. **Let the property you want to prove pick the state.** Want to prove "no lost updates"? Then the state must include enough to express a lost update (a version, or the value plus a write-count) and nothing more. The property is the filter.

A useful test: if you can change the implementation strategy without changing the spec, your abstraction line is probably in the right place. If a refactor that preserves observable behavior forces a spec rewrite, the spec has leaked implementation detail.

```alloy
// A cache spec at the RIGHT level: model consistency, not bytes.
sig Key, Value {}
sig Cache {
  store: Key -> lone Value,   // partial function: each key maps to at most one value
  fresh: set Key              // keys whose cached value is known up-to-date
}
// The property that matters: a fresh key reads back the value last written.
// (eviction, hashing, memory layout: all deliberately absent)
```

---

## Core Concept 2 — State-Based Modeling and the Framing Problem

The state-based tradition — **Z**, **VDM**, **B**, and **Event-B** — models a system as *state plus operations on that state*. The state is a set of typed variables constrained by an **invariant**; an operation is a *relation* between the pre-state and the post-state, written with predicates over unprimed (before) and primed (after) variables.

```
// Z-style schema for a bounded key/value store
┌─ Store ─────────────────────────────────────────
│ contents : Key ⇸ Value        // partial function
│ capacity : ℕ
├─────────────────────────────────────────────────
│ #contents ≤ capacity          // the INVARIANT
└─────────────────────────────────────────────────

┌─ Put ───────────────────────────────────────────
│ ΔStore                        // this op MAY change Store
│ k? : Key;  v? : Value         // inputs (decorated with ?)
├─────────────────────────────────────────────────
│ #contents < capacity                       // precondition
│ contents' = contents ⊕ {k? ↦ v?}           // postcondition (override)
│ capacity' = capacity                        // FRAME: capacity unchanged
└─────────────────────────────────────────────────
```

Three things in that schema are where the real engineering lives:

**The framing problem — what does *not* change.** The hard part of a state-based operation is rarely the postcondition for what it touches; it is stating everything it *leaves alone*. Omit `capacity' = capacity` and the spec permits `Put` to silently resize the store — a behavior you never intended but never forbade. Z formalizes this with two conventions: **Δ** (delta) announces an operation may change the schema's state, and **Ξ** (xi) announces an operation that reads but changes *nothing* (`ΞStore` ≡ `ΔStore` plus `contents' = contents ∧ capacity' = capacity`). TLA+ makes the same idea explicit with `UNCHANGED ⟨capacity⟩`. Underspecified frames are one of the most common and most dangerous spec bugs precisely because the omission is invisible — nothing in the text is wrong; something is merely *missing*.

> **Key insight:** A postcondition says what becomes true; a **frame condition** says what stays the same. Both are part of the spec's meaning. A specification that lists only what changes is not "mostly right" — it permits every behavior on the variables it forgot to pin down.

**Totalization of partial operations.** `Put` above has a precondition (`#contents < capacity`). What happens when it is violated? An operation with a precondition is a *partial* relation — undefined outside its domain. Real systems can't have undefined behavior, so you **totalize**: extend the partial operation with an explicit error case. In Z this is the schema-calculus idiom `Put ≙ PutOk ∨ PutFull`, where `PutFull` reports an error and leaves state unchanged. Skipping totalization leaves a spec that says nothing about the failure path — exactly the path that bites in production.

**Initialization.** A spec is incomplete without an `Init` predicate establishing the invariant in the starting state. The proof obligation is then inductive: `Init ⇒ Invariant`, and for every operation `Op`, `Invariant ∧ Op ⇒ Invariant'`. If both hold, the invariant is true in every reachable state — by induction over the sequence of operations. **Event-B** builds its whole method around discharging exactly these proof obligations, generated mechanically by the Rodin toolset.

---

## Core Concept 3 — Safety vs Liveness, Rigorously

Engineers use "safety" and "liveness" loosely; the precise definitions are worth internalizing because they determine *how a property can fail* and therefore how a tool reports a violation.

Treat a system behavior as an infinite sequence (trace) of states, σ = s₀, s₁, s₂, …. A *property* is a set of such traces — the traces it permits. Two classes partition the interesting cases:

- **Safety: "some bad thing never happens."** Formally, a property *P* is safety if every trace *not* in *P* has a *finite prefix* such that no extension of that prefix is in *P*. In words: once you've gone wrong, you've irrevocably gone wrong — there is a finite, identifiable point of failure. Mutual exclusion ("two processes are never in the critical section at once") is safety: the bad thing is a single state where both are inside, and you can point at the exact step it occurred.

- **Liveness: "some good thing eventually happens."** Formally, *P* is liveness if *every* finite prefix can be extended to a trace in *P*. In words: you can never *finitely* rule out success — there's always still a way to satisfy it. Termination ("the program eventually halts") and starvation-freedom ("a waiting process eventually proceeds") are liveness: at no finite point can you declare failure, because the good thing might still happen next.

The operational consequence is sharp and is the thing to remember:

> **Key insight:** A **safety** violation is a *finite counterexample* — a model checker hands you a concrete trace of N steps ending in the bad state, and you can replay it. A **liveness** violation is an *infinite counterexample* — necessarily a *lasso*: a finite stem leading into a cycle the system loops forever without ever doing the good thing. This is why liveness checking needs cycle detection and why its counterexamples are harder to read.

The deep result that ties it together is the **Alpern–Schneider theorem**: *every* trace property is the intersection of a safety property and a liveness property. Any requirement decomposes into "nothing bad happens" ∩ "something good eventually happens." This is not academic trivia — it is a *checklist*. When you specify a system, ask both questions explicitly: what is the safety part (the invariant, the never-violate), and what is the liveness part (the progress, the eventually)? Most real specs over-invest in safety (invariants are easy and intuitive) and under-invest in liveness — and a system that is safe but never makes progress (it deadlocks, immaculately preserving every invariant) is useless. The decomposition forces you to write down the progress requirements you'd otherwise forget.

```tla+
\* Safety: a single bad state is forbidden. Refuted by a finite trace.
MutualExclusion == [](~(pc[p1] = "crit" /\ pc[p2] = "crit"))

\* Liveness: progress must eventually happen. Refuted only by an infinite (lasso) trace.
Progress == \A p \in Procs : (pc[p] = "wait") ~> (pc[p] = "crit")
\*           ~>  is "leads to": []((pc[p]="wait") => <>(pc[p]="crit"))
```

---

## Core Concept 4 — Fairness, and Why Liveness Needs It

Here is the trap that catches everyone the first time. You write a perfectly reasonable liveness property — "a waiting process eventually enters its critical section" — run the model checker, and it reports a counterexample: a trace where the scheduler simply *never selects* the waiting process. The process is forever ready to proceed; the scheduler forever ignores it. The property is "violated," but the counterexample is absurd — no real scheduler is that adversarial.

The problem is not the property; it is that **liveness is meaningless without a fairness assumption**. A liveness property says "if the system keeps getting chances, the good thing happens." If you allow behaviors where the system gets infinitely many chances and takes none of them, every liveness property fails trivially. Fairness rules out those pathological schedules — it is the formal statement of "the system doesn't starve actions forever."

Two strengths, and the difference matters:

- **Weak fairness (WF):** if an action is *continuously* enabled from some point on, it eventually fires. Formally `WF_v(A) ≜ ◇□(enabled ⟨A⟩) ⇒ □◇⟨A⟩`. Use this when an action, once possible, *stays* possible until taken — e.g., a process that remains ready to run.
- **Strong fairness (SF):** if an action is *repeatedly* enabled (infinitely often, possibly with gaps), it eventually fires. Formally `SF_v(A) ≜ □◇(enabled ⟨A⟩) ⇒ □◇⟨A⟩`. Use this when an action flickers in and out of being enabled — e.g., acquiring a lock that is sometimes held by others. Strong fairness is *stronger*: SF implies WF, and SF is needed when enabledness is intermittent.

```tla+
\* Spec with fairness: the next-state relation PLUS a fairness assumption.
Spec == Init /\ [][Next]_vars
          /\ \A p \in Procs : WF_vars(EnterCrit(p))   \* weak fairness per process
\* Without the WF conjunct, Progress above is refuted by the "never scheduled" trace.
```

But fairness is a *double-edged* tool, and the senior skill is calibrating it:

> **Key insight:** Too little fairness and your liveness properties fail vacuously on schedules no real system exhibits. Too much fairness and you've *assumed away* the very bug you were hunting — a spec with an over-strong fairness assumption can "prove" progress that the real, less-fair system never delivers. Fairness assumptions are *part of the spec's claim*: you are asserting the implementation provides at least this much fairness. If the real scheduler doesn't, your proof is about a different system.

The discipline: state the *weakest* fairness that makes your liveness properties hold, then ask "does the real system actually guarantee this?" If you needed strong fairness on a lock acquire, your implementation needs a fair lock (a queue, a ticket lock) — not a `compareAndSwap` spin loop that can starve. The fairness assumption in the spec becomes a *requirement on the implementation*. That traceability is the whole point.

---

## Core Concept 5 — Refinement Theory

A spec is rarely written at one level. You write an abstract spec (the contract: "a sequence with FIFO order"), then a more detailed design (the mechanism: "a ring buffer with head/tail indices"), and you want a *proof* that the design correctly implements the contract. That proof is **refinement**, and its theory is what makes stepwise development rigorous rather than hopeful.

The core definition: **a concrete spec C refines an abstract spec A if every behavior C permits is also permitted by A.** The design may do *less* than the abstract spec allows (it makes choices the abstract spec left open) but never *more* (it never exhibits a behavior the abstract spec forbids). Refinement is *behavior inclusion*: `Behaviors(C) ⊆ Behaviors(A)`.

**Simulation relations** are how you prove that inclusion without enumerating behaviors:

- **Forward simulation:** a relation *R* between abstract and concrete states such that (a) initial concrete states relate to initial abstract states, and (b) for every concrete step `c → c'`, if `c R a`, there exists an abstract step `a → a'` with `c' R a'`. The concrete system can be "tracked" by the abstract one, step for step. This is the common case and what most refinement proofs use.
- **Backward simulation:** the dual, needed when the concrete system *resolves nondeterminism later* than the abstract one (the concrete step doesn't yet "know" which abstract state it corresponds to until the future plays out). Rarer, but forward simulation is *incomplete* — some genuine refinements are only provable with backward simulation, or a combination.

**Data refinement** is the most useful instance. The abstract and concrete states have *different shapes* — abstract `seq` vs concrete ring buffer — so the simulation relation is a **retrieve (abstraction) relation** that maps each concrete state back to the abstract state it represents:

```
// retrieve relation: ring buffer  →  abstract sequence
retrieve(buf, head, tail) ==
   IF head <= tail
   THEN buf[head .. tail-1]                       // contiguous slice
   ELSE buf[head .. N-1] \o buf[0 .. tail-1]       // wrapped: concatenate
```

You then prove each concrete operation *simulates* the abstract one *through* the retrieve relation: applying concrete `enqueue` then retrieving equals retrieving then applying abstract `enqueue`. This is the famous **commuting diagram** — the two paths from concrete-before to abstract-after agree.

**Operation refinement** has two halves that are worth stating precisely, because they're counter-intuitive at first:

- The concrete operation's **precondition is weakened** (it must work in at least as many states as the abstract — refusing to be *more* demanding on the client).
- The concrete operation's **postcondition is strengthened** (when it does act, it must be at least as decisive — refusing to be *more* nondeterministic than promised).

In short: *promise no less, deliver no surprises.* A refined `pop` can't suddenly require a non-empty stack the abstract spec served on, and can't return a value the abstract spec wouldn't have.

> **Key insight:** Refinement is **transitive and compositional** — if C refines B and B refines A, then C refines A, so you can build through many layers; and refining a component refines any system that uses it, so you can verify pieces independently. This is what makes top-down development sound: prove each step, compose the steps.

The honest caveat a senior must hold onto: refinement proves *the design refines the spec*. It says **nothing** about whether the *code* implements the design. There is always a final, irreducible gap between the lowest formal model and the executing program. You close that gap with one of: code generation from the lowest model (B and Event-B generate code from refined machines), a code-level verifier (topics 04/05), or conformance testing. A clean tower of refinement proofs that ends in hand-written code with no link to the bottom machine has a hole exactly where it matters most.

---

## Core Concept 6 — Model-Finding vs Model-Checking vs Proving

The same spec can be analyzed three fundamentally different ways, and conflating them is a senior-level error with real consequences. The distinction is *what guarantee you walk away with*.

**Model-finding (Alloy).** Alloy's analyzer doesn't prove anything universally. It does **bounded analysis**: you give it a *scope* (e.g., "up to 5 of each signature"), it translates the spec and the negation of your assertion into a boolean satisfiability (SAT) problem, and the SAT solver searches *exhaustively within that scope* for a counterexample. If it finds one, you have a real bug. If it finds none, you have learned only that *no counterexample exists up to that scope* — emphatically **not** a proof.

```alloy
sig Node { next: lone Node }            // each node points to at most one next
fact { all n: Node | n not in n.^next } // FACT: no cycles (^ = transitive closure)

pred reachable[from, to: Node] { to in from.*next }   // *next = reflexive-transitive

assert Connected {                      // claim: every node reaches every node
  all disj a, b: Node | reachable[a, b] or reachable[b, a]
}
check Connected for 6                   // BOUNDED check: scope ≤ 6 nodes
run reachable for 4                      // find an INSTANCE — proves the spec is satisfiable
```

Alloy rests on the **small-scope hypothesis**: empirically, *most* design flaws manifest in small instances, so exhaustive checking of small scopes catches the overwhelming majority of bugs cheaply. This is a superb engineering bet — fast, fully automatic, brilliant counterexamples — but it is a *bet*, not a theorem. A flaw that only appears with 7 nodes survives a `check ... for 6`. **Bounded ≠ proof**, and treating a clean Alloy check as a proof is the single most common misunderstanding of the tool.

**Model-checking (TLC, for TLA+).** If you write the same system in TLA+, **TLC** explores the *entire reachable state space* — exhaustively, but only when that space is *finite* (you must bound the system: 3 processes, queue depth 4, etc.). Within those bounds it is exhaustive over *all reachable states*, and crucially it checks *temporal* properties (liveness, fairness) that Alloy's relational, snapshot-oriented analysis doesn't naturally express. The catch is the **state-space explosion**: the reachable states grow combinatorially, so TLC is bounded by *what fits in memory and time*, not by a scope you pick on signatures.

**Proving (TLAPS, Isabelle, Coq, B/Event-B's prover).** A deductive proof discharges the proof obligations *symbolically*, for *all* values — unbounded. This is the only path to "correct for every N," and the only honest answer when the property must hold at production scale (millions of keys, arbitrary process counts). The cost is human: proofs require expertise and effort that bounded checking does not.

> **Key insight:** One spec, three guarantees. Alloy's bounded model-finding says "no bug up to scope k" — cheap, automatic, *not* a proof. TLC's model-checking says "no bug in this finite instance" — exhaustive over reachable states, includes liveness, limited by state explosion. A proof assistant says "no bug, ever, for all N" — unbounded, but expensive. The senior choice is matching the guarantee to the stakes: bounded checking to *find* bugs fast, proof to *establish* correctness where the cost of being wrong is unbounded.

The practical workflow uses all three as a pipeline: model-find first (cheapest, finds the embarrassing bugs in minutes), model-check the temporal properties, and reserve deductive proof for the core invariant of a system where bounded confidence isn't enough.

---

## Core Concept 7 — Specification Smells and Failure Modes

A spec can be *valid* — type-checks, the tool runs — and still be *wrong* in ways that are uniquely insidious because they're invisible to a casual read. These are the failure modes a senior actively hunts for.

**Over-specification (encoding the implementation).** Covered in Concept 1, but it recurs as a *smell*: if your spec mentions data structures, loop indices, or ordering that a client can't observe, you've leaked the mechanism. The spec is now coupled to one implementation and rejects valid alternatives.

**Under-specification that is actually a bug.** Leaving a behavior unconstrained is sometimes deliberate (you genuinely don't care, and you want implementation freedom) and sometimes a *defect* (you forgot a case, and the spec now silently permits garbage). The frame problem (Concept 2) is the classic instance. The tell: under-specification is a *feature* only when you can articulate *why* you don't care; otherwise it's a hole.

**Inconsistency — a spec with no model.** This is the most dangerous, because it produces *false confidence*. If your spec's facts contradict each other, no instance satisfies them — the spec is unsatisfiable. And here is the trap: in such a spec, *every assertion is vacuously true*. The model checker reports "no counterexample found" for *everything*, including assertions that are nonsense, because there are no instances in which to find a counterexample. You walk away believing you've verified your design when you've actually verified nothing about an empty world.

> **Key insight:** Always check that your spec has a model *before* trusting any assertion about it. In Alloy, `run {} for N` (or `run` a meaningful predicate) must produce an instance — if it can't, your facts are contradictory and every `check` is vacuously, uselessly "passing." A spec you can't satisfy is worse than no spec, because it lies with the authority of a green checkmark.

```alloy
// Smell: vacuously-true assertions. Run this FIRST.
run { some Cache } for 4        // must find an instance; if "No instance found", facts conflict
// Only AFTER confirming satisfiability are these meaningful:
assert Consistency { ... }
check Consistency for 4
```

**Spec rot (divergence from code).** The spec was right the day it was written; then the code changed and the spec didn't. Now it describes a system that no longer exists, and worse, it's *trusted* because it once was accurate. Spec rot is to formal methods what stale comments are to code — and far more harmful, because the spec carries more authority. The only defenses are *conformance* mechanisms (Concept 9) that *break* when spec and code diverge.

**Specifying the easy 80% and missing the risky 20%.** The path of least resistance is to formalize the well-understood happy path — the part you already understand and least need a spec for — and to wave away the concurrent, partial-failure, edge-case 20% where the actual bugs live. A spec that models the normal case in loving detail and leaves crash-recovery "as an exercise" has spent its effort on the wrong fifth. The discipline: spec the part you're *afraid* of, not the part you're comfortable with.

---

## Core Concept 8 — Property Patterns as Reusable Templates

Specifiers re-derive the same temporal-logic shapes constantly, and getting the temporal operators right by hand is error-prone (the `~>` vs `=>`, the nesting of □ and ◇). The **Dwyer et al. specification patterns** are to property-writing what design patterns are to code: a catalogued vocabulary of the recurring shapes, each with a *scope* (globally, before R, after Q, between Q and R, after Q until R) and a vetted temporal-logic translation.

The core patterns:

| Pattern | Plain English | Example |
|---|---|---|
| **Absence** | "P never happens" (in scope) | The error state is never reached |
| **Universality** | "P always holds" (in scope) | The invariant holds throughout |
| **Existence** | "P happens at least once" | The system eventually initializes |
| **Precedence** | "S must be preceded by P" | A read is preceded by an open |
| **Response** | "S must be followed by P" | Every request eventually gets a response |

```tla+
\* Response pattern, global scope (the workhorse of liveness specs):
\*   "every request is eventually followed by a response"
Response == [](req => <>resp)        \*  equivalently  req ~> resp

\* Precedence pattern, global scope:
\*   "a grant is always preceded by a request"  (no spontaneous grants)
Precedence == (~grant) W req         \*  W = weak until: ~grant holds until req (or forever)
```

The value is twofold. First, *correctness*: the patterns' translations are reviewed and well-known, so you stop subtly mis-nesting operators. **Response** is the canonical example — "every request is eventually answered" is `□(req ⇒ ◇resp)`, and people routinely write `□req ⇒ □◇resp` (a different, weaker claim) by accident. Second, *communication*: naming a property "a Response pattern with global scope" is instantly legible to anyone who knows the catalogue, the way "that's a Visitor" communicates a design.

> **Key insight:** Most real properties are one of a handful of patterns — absence, universality, existence, precedence, response — composed with a scope. Reaching for the catalogue instead of hand-rolling temporal logic eliminates a whole class of "my property says something subtly different from what I meant" bugs, which are the hardest spec bugs to notice because the property still type-checks and the checker still runs.

---

## Core Concept 9 — Conformance: Keeping Spec and Code in Sync

A spec that diverges from its code (Concept 7's spec rot) decays into a lie. **Conformance** is the set of mechanisms that tie the spec to the running system so divergence is *detected* rather than silently tolerated. There is no single right answer; there is a spectrum trading rigor against cost.

**Refinement proof (strongest, most expensive).** Prove the code refines the spec (Concept 5). Gives the highest assurance and is fully static, but requires a code-level formalism and the expertise to drive it. Reserved for the highest-stakes cores (crypto, kernels, avionics).

**Code generation (rigor by construction).** Instead of writing code and proving it matches, *generate* code from the lowest refined model. B and Event-B do exactly this: you refine the abstract machine down to an implementable one, and the toolset emits C/Ada. Conformance is then by construction — the code *is* the model, compiled. The catch is you must trust the generator and the runtime, and you give up hand-tuning the generated code. This is the Paris Métro Line 14 / B-method story (Real-World Examples).

**Runtime conformance (monitors and contracts).** Translate the spec's invariants and properties into runtime checks — assertions, contracts, or a monitor that observes the execution trace and flags a violation when the system leaves the spec's permitted behaviors. This catches divergence *in production* on real inputs, at the cost of runtime overhead and the fact that it only checks the paths actually exercised. This is exactly where specification meets [04 — Property & Contract Verification](../04-property-and-contract-verification/senior.md): a spec invariant becomes a contract; a temporal property becomes a runtime monitor.

**Model-based test generation (the pragmatic mainstream).** Treat the spec as an oracle and *generate tests* from it: derive input sequences from the operations, and check the implementation's outputs against the spec's predicted outputs. You get automated, spec-derived test suites that re-fail the moment the code drifts from the spec — far cheaper than proof, far stronger than hand-written examples, and it directly connects to [property-based testing](../../testing/) where the spec's invariants become the properties under test.

> **Key insight:** Conformance is a *gradient*, not a binary. Refinement proof → code generation → runtime monitors → model-based tests trade decreasing rigor for decreasing cost. The senior decision is matching the mechanism to the blast radius: a proof for the consensus core, generated code for safety-critical control, monitors for the operationally risky paths, and model-based tests as the baseline that keeps *every* spec honest. A spec with *no* conformance mechanism will rot — guaranteed — because nothing forces it to track the code.

---

## Real-World Examples

- **Amazon Web Services — TLA+ on core services.** AWS specified S3, DynamoDB, and other foundational services in TLA+ and found subtle, deep bugs that had survived design review and testing — including a bug requiring a 35-step trace that no human reviewer or test would plausibly have hit. The reported lesson maps exactly to this page: the value was in choosing the right *abstraction* (the consistency protocol, not the storage engine) and in model-checking *liveness under fairness*, not just safety. Their writeup explicitly notes that the spec found "errors that would not have been caught by any other technique we know of."

- **Paris Métro Line 14 — the B-method.** The driverless Line 14 safety-critical control software was developed with the **B-method**: an abstract spec refined through provable steps down to an implementable machine, from which code was *generated*. Conformance was by construction — tens of thousands of proof obligations discharged, and the generated safety code shipped with no unit-test-discovered bugs in the formally developed portion. This is Concept 5 (refinement) plus Concept 9 (code generation) in production, where the cost of a safety violation is human life.

- **Alloy modeling of a flash file system / Chord.** Alloy has been used to find flaws in published, peer-reviewed designs — including bugs in the Chord distributed hash table's stabilization protocol and in proposed file-system designs — by *bounded* analysis that surfaced counterexamples within a small scope. The lesson is the small-scope hypothesis in action: designs believed correct by their authors broke at three or four nodes. And the corollary lesson is its limit — Alloy *found* the bugs but a clean Alloy check would not have *proven* their absence.

- **TLA+ on a consensus protocol (e.g., Raft-style).** Specifying a consensus algorithm forces the safety/liveness split to the surface: *safety* (no two leaders in the same term; committed entries never lost) is the invariant set, while *liveness* (a leader is eventually elected; a request eventually commits) requires explicit *fairness* on message delivery and timers. Specifiers routinely discover their liveness property fails without a fairness assumption — and then discover their *implementation* doesn't actually provide that fairness, which is the spec doing its job: turning an implicit assumption into an explicit, checkable requirement.

---

## Mental Models

- **A spec is a lossy compression chosen to preserve the property you fear violating.** Compression that's too aggressive (over-abstract) discards the bug; compression that's too faithful (over-specified) reproduces the bug. The art is keeping exactly the bits that matter — the consistency model, not the byte layout.

- **Safety fails finitely; liveness fails infinitely.** A safety counterexample is a finite trace you can point at; a liveness counterexample is a lasso — a loop the system runs forever without ever doing the good thing. This single contrast tells you how each kind of property breaks and why liveness is harder to check.

- **Liveness is a conditional promise, and fairness is the condition.** "Eventually good" means "given fair chances, eventually good." Without fairness, every liveness property fails on the adversarial schedule. Fairness is part of the *claim*, not background — and asserting it is asserting something the implementation must provide.

- **Refinement is a one-way valve on behaviors.** The concrete system may do *less* than the abstract spec allows but never *more*. Prove inclusion with a simulation relation through a retrieve map, and it composes through every layer — but it stops at the bottom model, and code below that needs its own conformance evidence.

- **Bounded analysis finds bugs; proof establishes correctness.** Alloy's green check means "no counterexample up to scope k," not "correct." Knowing which guarantee you hold — and whether the stakes demand the stronger one — is the senior judgement.

- **A spec with no model is a green checkmark that means nothing.** Inconsistency makes every assertion vacuously true. Confirm satisfiability *first*; only then does any `check` carry information.

---

## Common Mistakes

1. **Specifying the mechanism instead of the behavior.** Modeling the ring buffer's indices when the client only observes a FIFO sequence. The spec becomes a second implementation — as buggy as the first, and coupled to one design. Model what a client can observe; let a behavior-preserving refactor leave the spec untouched.

2. **Omitting frame conditions.** Stating what an operation changes but not what it leaves unchanged, so the spec silently permits arbitrary changes to the "forgotten" variables. Use Z's Ξ/Δ or TLA+'s `UNCHANGED` explicitly; an unframed operation is not "mostly specified," it's wide open.

3. **Trusting assertions without checking for a model.** An inconsistent spec makes *every* assertion vacuously true, so the checker reports "passed" for everything — including nonsense. Always `run` a satisfying instance first; a spec you can't satisfy verifies nothing.

4. **Treating a bounded Alloy check as a proof.** `check P for 6` means "no counterexample with ≤ 6 atoms," not "P holds." A flaw that needs 7 atoms survives. Use bounded checking to *find* bugs cheaply; reach for a proof assistant when you need correctness for all N.

5. **Writing liveness without fairness.** The checker reports a "violation" that is just the scheduler never selecting your process. State the *weakest* fairness (WF or SF) that makes the liveness property hold — then verify the implementation actually provides it.

6. **Over-strong fairness assuming the bug away.** Adding strong fairness to make a liveness proof go through, when the real system is only weakly fair (or unfair), proves progress the production system never delivers. Fairness is a claim about the implementation; calibrate it to reality.

7. **Mis-nesting temporal operators by hand.** Writing `□req ⇒ □◇resp` when you meant `□(req ⇒ ◇resp)` (the Response pattern). The property still type-checks and the checker still runs — it just verifies the wrong claim. Use the Dwyer patterns instead of re-deriving temporal logic.

8. **Letting the spec rot.** Writing a spec, shipping it, changing the code, and leaving the spec — now an authoritative description of a system that no longer exists. Tie the spec to the code with a conformance mechanism (monitor, model-based tests, refinement) so divergence *breaks* something.

---

## Test Yourself

1. You're asked to spec a write-through cache. What state do you include and what do you deliberately leave out, and how does the property you want to prove drive that choice?
2. What is a frame condition, why is omitting one dangerous, and how do Z and TLA+ each express "this stays unchanged"?
3. Give the precise distinction between safety and liveness in terms of how each is *refuted*. What shape does a liveness counterexample always take?
4. State the Alpern–Schneider theorem and explain why it's a useful checklist when writing a spec.
5. Your liveness property fails with a counterexample where a ready process is never scheduled. What's wrong, and what are weak vs strong fairness?
6. What does it mean for spec C to refine spec A? What is a retrieve relation, and what happens to preconditions and postconditions under operation refinement?
7. Contrast the guarantee you get from an Alloy `check ... for 6`, a TLC model-check, and a TLAPS proof. When is each the right tool?
8. Why is an *inconsistent* spec more dangerous than no spec, and what single check defends against it?

<details>
<summary>Answers</summary>

1. Include the observable consistency state: a map `Key → Value`, plus per-key `dirty`/`valid` (or `fresh`) markers, and for write-through, whether the write reached the backing store. Leave out byte layout, hashing, eviction-list pointers, slab allocation — anything a client can't observe. The property "a read after a write sees the write" (and write-through's "the backing store reflects every committed write") *picks* the state: you include exactly enough to express it and nothing more. If a refactor of the eviction strategy would force a spec change, the spec has leaked the mechanism.
2. A frame condition states what an operation leaves *unchanged*. Omitting it permits the operation to alter the unmentioned variables arbitrarily — an invisible bug, because nothing in the text is wrong, something is merely missing. Z uses **Δ** (may change) and **Ξ** (changes nothing) schema decorations and explicit `x' = x` clauses; TLA+ uses `UNCHANGED ⟨x⟩`.
3. **Safety** is refuted by a *finite prefix*: there's an identifiable finite point after which no extension can satisfy the property (the bad thing has happened). **Liveness** is refuted only by an *infinite trace*: every finite prefix can still be extended to success, so failure can never be declared finitely. A liveness counterexample is always a **lasso** — a finite stem leading into a cycle the system loops forever without ever doing the good thing.
4. **Alpern–Schneider:** every trace property is the intersection of a safety property and a liveness property. As a checklist, it forces you to ask both questions when specifying: what is the *safety* part (the invariant, never-violate) and what is the *liveness* part (the progress, eventually)? It catches the common failure of writing rich invariants and forgetting progress — a system that's safe but deadlocks satisfies every invariant and is still useless.
5. Liveness is meaningless without **fairness**: the counterexample is an unfair schedule (the process is forever ready but forever ignored), which no real scheduler exhibits. **Weak fairness (WF):** an action *continuously* enabled from some point eventually fires. **Strong fairness (SF):** an action *repeatedly* (infinitely often, with gaps) enabled eventually fires. SF is stronger (SF ⇒ WF) and is needed when enabledness is intermittent (e.g., a contended lock). Add the *weakest* fairness that makes the property hold, then check the implementation provides it.
6. C refines A iff `Behaviors(C) ⊆ Behaviors(A)` — every behavior C permits is allowed by A (C may do *less*, never *more*). A **retrieve (abstraction) relation** maps each concrete state to the abstract state it represents, used in data refinement when the two states have different shapes. Under operation refinement the precondition is *weakened* (works in at least as many states) and the postcondition is *strengthened* (at least as decisive — no new nondeterminism). "Promise no less, deliver no surprises."
7. **Alloy `check ... for 6`:** bounded model-finding — "no counterexample with ≤ 6 atoms," automatic and fast, *not* a proof (a 7-atom flaw survives). **TLC model-check:** exhaustive over *all reachable states* of a *finite* instance, includes temporal/liveness properties, limited by state-space explosion. **TLAPS proof:** unbounded — correct for *all* N — but expensive in human effort. Use Alloy to find bugs cheaply, TLC for temporal properties on bounded instances, a proof when the cost of being wrong is unbounded.
8. An inconsistent (unsatisfiable) spec has *no model*, which makes *every* assertion **vacuously true** — the checker reports "no counterexample" for everything, including nonsense, giving false confidence with the authority of a green check. The defense: `run` a satisfying instance *first* (e.g., `run { some Cache } for 4`); if no instance is found, the facts contradict and every `check` is meaningless until you fix them.

</details>

---

## Cheat Sheet

```
THE ABSTRACTION PROBLEM
  too detailed  → a 2nd buggy implementation (you re-coded it in the spec language)
  too abstract  → proves nothing useful (admits the very bug you fear)
  rule of thumb → let the property you fear violating pick the state; model
                  observable behavior, not the mechanism

STATE-BASED MODELING (Z / VDM / B / Event-B)
  state schema + INVARIANT;  operation = relation on (pre, post) state
  FRAME problem: state what does NOT change  (Z: Ξ/Δ ;  TLA+: UNCHANGED ⟨v⟩)
  totalize partial ops (PutOk ∨ PutFull);  Init must establish the invariant
  proof obligation:  Init ⇒ Inv   and   Inv ∧ Op ⇒ Inv'   (induction)

SAFETY vs LIVENESS
  safety   = "bad never happens"      → refuted by a FINITE prefix
  liveness = "good eventually happens"→ refuted only by an INFINITE (lasso) trace
  Alpern–Schneider: every property = safety ∩ liveness  (check BOTH)

FAIRNESS (liveness needs it)
  WF_v(A): continuously enabled ⇒ eventually fires
  SF_v(A): repeatedly  enabled ⇒ eventually fires   (SF ⇒ WF)
  too little → vacuous liveness failures;  too much → assumes the bug away

REFINEMENT
  C refines A  ⟺  Behaviors(C) ⊆ Behaviors(A)   (C does LESS, never MORE)
  prove via forward/backward SIMULATION through a RETRIEVE relation
  op refinement: precondition WEAKENED, postcondition STRENGTHENED
  transitive + compositional;  but stops at the lowest model (code needs its own check)

ANALYSIS: three different guarantees
  Alloy  check ... for k   bounded, automatic, "no bug ≤ k"  (NOT a proof)
  TLC    model-check       exhaustive over reachable states; temporal/liveness; finite
  TLAPS/Coq  proof         unbounded "for all N"; expensive (human)

SPEC SMELLS
  over-spec (encodes impl) · under-spec that's a bug · INCONSISTENT (no model →
  vacuously-true asserts) · spec rot · easy-80%-missing-risky-20%
  ALWAYS:  run {} for N   to confirm a model exists BEFORE trusting any check

ALLOY SKELETON
  sig … {}              declare types + relations
  fact { … }           always-true constraint
  pred p[…] { … }       reusable named formula
  assert A { … }        claim to be checked
  check A for k         bounded counterexample search
  run p for k           find an instance (proves satisfiability)

PROPERTY PATTERNS (Dwyer)   scope × {absence, universality, existence, precedence, response}
  Response:  [](req => <>resp)   (NOT  []req => []<>resp )
  Precedence: (~grant) W req

CONFORMANCE (rigor ↓, cost ↓)
  refinement proof → code generation (B/Event-B) → runtime monitor/contract → model-based tests
```

---

## Summary

- **Choosing the abstraction is the whole game.** A spec captures *what matters* by encoding the property you fear violating and discarding everything else. Too detailed and it's a second buggy implementation; too abstract and it proves nothing. Let the property pick the state; model observable behavior, not the mechanism.
- **State-based specs are state + invariant + operations as pre/post relations**, and the hard, often-omitted part is the **frame condition** — what *doesn't* change (Z's Ξ/Δ, TLA+'s `UNCHANGED`). Totalize partial operations and establish the invariant in `Init`; correctness is then induction over the operations.
- **Safety fails finitely, liveness fails infinitely.** Safety is refuted by a finite prefix; liveness only by an infinite lasso. By **Alpern–Schneider** every property decomposes into both — a checklist that forces you to specify progress, not just invariants.
- **Liveness is meaningless without fairness**, and fairness (weak vs strong) is part of the claim: too little and liveness fails vacuously, too much and you assume the bug away. The fairness you need becomes a requirement on the implementation.
- **Refinement is behavior inclusion** proved by simulation through a retrieve relation, with preconditions weakened and postconditions strengthened; it's transitive and compositional but stops at the lowest model — code below still needs conformance evidence.
- **One spec, three guarantees:** Alloy's bounded check *finds* bugs (not a proof), TLC model-checks finite instances including liveness, a proof assistant establishes correctness for all N. Match the guarantee to the stakes, and always confirm the spec has a *model* — an inconsistent spec makes every assertion vacuously true.

You now reason about specification as an engineering discipline with measurable failure modes, not as a transcription exercise. The next layer — [professional.md](professional.md) — is about operating specs across teams: where they pay off, how to introduce them without stalling delivery, and how to keep a living spec honest under real organizational pressure.

---

## Further Reading

- *Software Abstractions: Logic, Language, and Analysis* — Daniel Jackson. The definitive treatment of Alloy, the small-scope hypothesis, and lightweight modeling; the source for the abstraction discipline at the heart of this page.
- *Specifying Systems* — Leslie Lamport. TLA+, temporal logic, refinement, and fairness from the field's primary source; the canonical reference for the safety/liveness/fairness machinery.
- *The B-Book* and *Modeling in Event-B* — Jean-Raymond Abrial. State-based specification, the framing discipline, refinement-to-code, and the proof-obligation method behind the B/Event-B toolchains.
- *Defining Liveness* — Bowen Alpern & Fred Schneider. The original paper proving every property is the intersection of a safety property and a liveness property — the theorem underpinning Concept 3.
- *Patterns in Property Specifications for Finite-State Verification* — Dwyer, Avrunin & Corbett. The specification-pattern catalogue (absence, universality, existence, precedence, response) with vetted temporal-logic translations.
- For the team-and-process view of all of this, continue to [professional.md](professional.md).

---

## Related Topics

- [02 — Model Checking](../02-model-checking/senior.md) — how TLC and friends exhaustively explore the finite state space your spec defines, and where state explosion bites.
- [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/senior.md) — the temporal operators, fairness, and refinement notation this page leans on, in full.
- [04 — Property & Contract Verification](../04-property-and-contract-verification/senior.md) — turning spec invariants into runtime contracts and monitors (the conformance gradient's middle).
- [05 — Proof Assistants & Dependent Types](../05-proof-assistants-and-dependent-types/senior.md) — discharging proof obligations for *all* N when bounded confidence isn't enough.
- [Testing](../../testing/) — model-based and property-based test generation, the pragmatic baseline that keeps every spec honest.
