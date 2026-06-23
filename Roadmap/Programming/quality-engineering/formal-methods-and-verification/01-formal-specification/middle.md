# Formal Specification — Middle Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → Formal Specification
> *The junior page said a formal spec is "math instead of prose." This page makes that concrete: the notation families you'll actually meet, how to state a property so a tool can check it, what "the implementation refines the spec" means — and the uncomfortable truth that a verified spec does not, by itself, make your code correct.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Notation Families](#core-concept-1--the-notation-families)
5. [Core Concept 2 — State-Based Specs: Pre/Postconditions over State](#core-concept-2--state-based-specs-prepostconditions-over-state)
6. [Core Concept 3 — Relational Specs in Alloy](#core-concept-3--relational-specs-in-alloy)
7. [Core Concept 4 — Properties: Invariant, Safety, Liveness](#core-concept-4--properties-invariant-safety-liveness)
8. [Core Concept 5 — Refinement and the Spec–Implementation Gap](#core-concept-5--refinement-and-the-specimplementation-gap)
9. [Core Concept 6 — Lightweight Formal Methods](#core-concept-6--lightweight-formal-methods)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do I write a specification a machine can analyze, and what does a "correct" spec actually buy me?**

At the junior level a formal spec is "a precise, math-based description of what a system should do." True, but it can't yet answer the questions that decide whether the effort pays off: *which* notation do I reach for, *how* do I phrase "the cache is never stale" so a tool can refute it, and — the one that surprises people — *why* a fully checked spec still leaves your shipped code potentially broken.

The answers come from four ideas the junior page only gestured at. **Notation families** give you state-based (Z, VDM, B), relational (Alloy), and temporal (TLA+) styles, each suited to different problems. **Properties** split into *invariant/safety* (checkable by looking at states) and *liveness* (needs reasoning about infinite behaviours). **Refinement** is the formal link from an abstract spec to concrete code. And **lightweight formal methods** — partial specs plus bounded automated analysis — are the pragmatic on-ramp that finds real bugs without a single hand proof. This page makes all four concrete with actual Alloy you can run and pre/postconditions you can read.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can say what a formal spec is and why prose underspecifies.
- **Required:** Basic predicate logic — `∀` (for all), `∃` (there exists), `∧`/`∨`/`¬`, implication.
- **Helpful:** You've written a few assertions or invariants in real code (`assert balance >= 0`).
- **Helpful:** A rough sense of sets and relations (a relation is a set of pairs).

---

## Glossary

| Term | One-line meaning |
|---|---|
| **State** | The values of a system's variables at one instant. |
| **Invariant** | A predicate true in *every* reachable state. |
| **Precondition** | What must hold *before* an operation runs for it to be defined. |
| **Postcondition** | What the operation guarantees *after*, relating new state to old. |
| **Safety property** | "Nothing bad happens" — a violation is witnessed by a finite trace. |
| **Liveness property** | "Something good eventually happens" — needs reasoning over infinite traces. |
| **Fairness** | An assumption that an enabled action is not starved forever. |
| **Refinement** | A concrete spec/code "implements" an abstract one, preserving its behaviour. |
| **Model finding** | Searching for an instance (or counterexample) satisfying a logical formula. |
| **Small scope hypothesis** | Most bugs show up in small instances, so bounded checks find a lot. |
| **Underspecification** | Deliberately leaving choices open (nondeterminism) the spec doesn't fix. |

---

## Core Concept 1 — The Notation Families

There is no single "formal spec language." There are *families*, each modelling a system through a different lens. Picking the right lens is most of the skill.

| Family | Examples | Models the system as… | Analyzed by | Best for |
|---|---|---|---|---|
| **State-based** | Z, VDM, B / Event-B | Typed state variables + operations with pre/postconditions | Proof (B has provers), some animation | Data-rich systems; stepwise refinement to code |
| **Relational / model-finding** | Alloy | Relations + first-order logic | Bounded model finding (SAT) | Structural/data-model designs; quick what-ifs |
| **Behavioural / temporal** | TLA+ | States + actions evolving over time | Model checking (TLC) | Concurrent/distributed protocols |
| **Algebraic** | OBJ, CASL, Maude | Sorts + operations defined by equations | Term rewriting | Abstract data types, pure semantics |

The split that matters most in practice: **state-based and relational specs describe *what states are valid*; temporal specs describe *how states evolve over time*.** A bank-account invariant ("balance ≥ 0") is naturally state-based. A protocol property ("every request eventually gets a reply") is inherently temporal — it's about sequences of states, so it lives in TLA+ ([03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/middle.md)).

> **Key insight:** The family is a *modelling decision*, not a syntax preference. Asking "valid state?" pulls you toward Z/Alloy; asking "valid behaviour over time?" pulls you toward TLA+. Choosing the wrong family means fighting the notation to express the property you actually care about.

This page focuses on the two families you'll most likely write first: **state-based** (because pre/postconditions are how you already think about functions) and **relational** (because Alloy's instant feedback is the highest-ROI starting point).

---

## Core Concept 2 — State-Based Specs: Pre/Postconditions over State

A state-based spec models the system as a set of typed **state variables** plus **operations** that transform them. Each operation is specified not by *how* it works but by a **precondition** (what must be true to run it) and a **postcondition** (what it guarantees afterward, relating the after-state to the before-state).

Consider a fixed-capacity user registry. In a Z/VDM-flavoured style:

```text
STATE
  users   : set of UserId          # who is registered
  capacity: nat                    # max allowed
INVARIANT
  #users ≤ capacity                # never over capacity   (# = cardinality)

OPERATION register(u: UserId)
  pre   u ∉ users  ∧  #users < capacity
  post  users' = users ∪ {u}       # users' is the AFTER state
        capacity' = capacity       # capacity unchanged

OPERATION deregister(u: UserId)
  pre   u ∈ users
  post  users' = users \ {u}
```

Read this precisely. The **primed** variables (`users'`) denote the state *after* the operation; unprimed is *before*. The postcondition is a *relation* between the two states, not a procedure. `register` says nothing about hash tables, locking, or order — only that the after-set is the before-set plus `u`. That silence is the point: the spec fixes *what*, leaving *how* fully open.

Two things this style forces you to confront that prose hides:

1. **Partiality.** What does `register` do when `u` is already present, or the registry is full? The precondition says: *it's undefined there* — the spec makes no promise. You must consciously decide whether to (a) keep it partial, (b) strengthen the postcondition to define the error behaviour, or (c) add a separate `registerFull` error operation. Prose lets you skip this; a formal spec makes the gap visible.
2. **The invariant as a proof obligation.** `#users ≤ capacity` must hold in every state. So for *each* operation you owe a small argument: *if the invariant held before and the precondition held, does it still hold after?* For `register`: before, `#users < capacity`; after, `#users' = #users + 1 ≤ capacity`. ✓ This per-operation check — "preserves the invariant" — is the heart of state-based verification.

> **Key insight:** A pre/postcondition pair is a *contract on state transitions*. The precondition is the caller's obligation; the postcondition is the spec's guarantee. The invariant is a global promise every operation must preserve. This is exactly the model behind design-by-contract ([04 — Property & Contract Verification](../04-property-and-contract-verification/middle.md)) — contracts are state-based specs scoped to a single function.

---

## Core Concept 3 — Relational Specs in Alloy

Alloy models a system as **signatures** (sets of atoms, like types) related by **relations** (fields), constrained by first-order logic. You then ask Alloy's analyzer to either *find an instance* satisfying your constraints or *find a counterexample* to a claimed property — by exhaustively searching all instances up to a bounded size. No proof, no theorem; just a relentless finite search.

Here is a complete, runnable spec of a filesystem where directories must form a tree (no cycles, single root):

```alloy
sig Name {}

abstract sig Node {
  name: one Name              // every node has exactly one name
}
sig File extends Node {}
sig Dir  extends Node {
  contents: set Node          // a directory points at its children
}

one sig Root extends Dir {}   // exactly one root directory

// Every node except Root has exactly one parent (it's contained once)
fact singleParent {
  all n: Node - Root | one d: Dir | n in d.contents
  no d: Dir | Root in d.contents     // nothing contains Root
}

// The property we WANT to be true: no directory contains itself, transitively
assert acyclic {
  no d: Dir | d in d.^contents        // ^ = transitive closure
}

check acyclic for 6        // search all instances with ≤ 6 atoms per sig
```

Run this and Alloy reports **no counterexample found** for scope 6 — within six atoms, the constraints genuinely force a tree. Now *delete* the `singleParent` fact and re-run: Alloy instantly produces a counterexample — a small instance where a directory sits inside its own subtree — and *draws it*. That visual counterexample, found in milliseconds, is the entire value proposition.

The syntax to internalize:

- `sig` declares a set of atoms; `extends` is subtyping; `one`/`some`/`no`/`lone` are multiplicities (exactly one / at least one / zero / at most one).
- A **field** like `contents: set Node` is a *relation* — a set of `(Dir, Node)` pairs.
- `fact` = a constraint that *always* holds (an axiom of your model).
- `assert` = a property you *claim* follows; `check` tries to *refute* it within a scope.
- `pred` = a named reusable formula; `run` asks Alloy to *find* an instance satisfying it.
- `.` is relational join, `^` is transitive closure, `*` is reflexive-transitive closure.

A second tiny example — checking that a "friend" relation is symmetric:

```alloy
sig Person { friends: set Person }

fact symmetricFriends {
  all p, q: Person | q in p.friends => p in q.friends
}

assert noSelfFriend { no p: Person | p in p.friends }
check noSelfFriend for 5
```

Here `noSelfFriend` *fails* — symmetry doesn't forbid `p ∈ p.friends`, and Alloy shows you a one-person counterexample. The fix (add `no p: Person | p in p.friends` as a fact, or fold it in) is now obvious *because you saw the bug*.

> **Key insight:** Alloy inverts the usual workflow. Instead of proving a property holds, you *dare the tool to break it* within a bounded universe. Because you get instant, concrete, *drawn* counterexamples, the loop "claim → refute → fix → re-check" runs in seconds — and that speed is why lightweight FM finds design bugs that prose review sails past.

---

## Core Concept 4 — Properties: Invariant, Safety, Liveness

Not all properties are checkable the same way. The single most useful distinction in all of verification is **safety vs liveness**, and it controls *what kind of analysis you even need*.

- An **invariant** is a predicate that must hold in **every reachable state** (e.g., `balance ≥ 0`). It's a property of *single states*.
- A **safety** property says **"nothing bad ever happens."** Formally `□ Good` ("always Good"). Crucially, *if* it's violated, the violation is witnessed by a **finite trace**: some specific step crosses the line. Every invariant is a safety property. So is "the door never opens while the train is moving."
- A **liveness** property says **"something good eventually happens."** Formally `◇ Good` ("eventually Good"). A violation is *only* witnessed by an **infinite trace** — to show "the request is never answered," you must exhibit an infinite run where it stays unanswered forever. "Every request eventually gets a response" is liveness.

Why the asymmetry matters operationally:

| Aspect | Safety (`□`) | Liveness (`◇`) |
|---|---|---|
| Intuition | "Nothing bad" | "Something good eventually" |
| Counterexample shape | **Finite** trace to a bad state | **Infinite** trace (a "lasso" — path + cycle) |
| Checkable by | Examining reachable **states** | Reasoning about **infinite behaviours** |
| Needs fairness? | No | **Usually yes** |
| Examples | `balance ≥ 0`; no two locks held; no deadlock-state | termination; every message delivered; no starvation |

Safety is "easy" in the sense that you can refute it by *reaching one bad state* — exactly what Alloy and a state-exploring model checker do. Liveness is harder because "eventually" is a claim about the *infinite future*: a system that keeps doing irrelevant work forever, never reaching the good state, violates liveness without ever reaching a "bad" state. To even state most liveness properties sensibly you need **fairness** assumptions — e.g., "an enabled action is eventually taken" — otherwise the trivial counterexample is "the scheduler just never runs this thread."

> **Key insight:** Safety = "you can point at the exact step where it broke" (finite witness). Liveness = "it never gets around to the good thing" (infinite witness, needs fairness). Most bugs people *write specs to catch* are safety bugs — which is why state-based and bounded relational tools (Alloy) are so productive. Liveness is where temporal logic and TLA+ ([03](../03-tla-plus-and-temporal-logic/middle.md)) earn their keep.

A practical consequence: an Alloy `check` is fundamentally a **safety** check — it searches *states/instances* for a violation. Alloy is not your tool for "every request eventually answered." That's a temporal property, and you'd reach for TLA+.

---

## Core Concept 5 — Refinement and the Spec–Implementation Gap

You've written an abstract spec. Your code is concrete. **Refinement** is the formal relationship that says the concrete thing faithfully *implements* the abstract thing.

Two flavours, both intuitive:

- **Data refinement** — replace an abstract data type with a concrete one. The spec says `users : set of UserId`; the code uses a `HashSet<UserId>` (or a sorted array, or a bloom-filter-plus-list). You define an **abstraction relation** mapping concrete states to abstract ones (e.g., "the abstract set = the keys present in the hash table"), and show every concrete operation *simulates* the abstract one through that mapping.
- **Operation refinement** — replace an abstract operation with a more deterministic / more concrete one. The classic rule: a refinement may **weaken the precondition** (accept more inputs) and **strengthen the postcondition** (promise more / be more deterministic), never the reverse. An implementation is allowed to *do more and demand less* than its spec — never less and demand more.

The slogan, due to the **refinement calculus** (Back; Morgan), is: **an implementation is correct iff it refines the spec.** You can, in principle, start from an abstract spec and apply refinement steps — each provably correctness-preserving — until you reach executable code. That's the dream of *correct-by-construction* development (the B method does exactly this for safety-critical software).

Now the part that trips up newcomers — **the spec–implementation gap**:

```text
   ┌─────────────┐   refinement?    ┌──────────────┐
   │  SPEC (Z/    │ ───────────────▶ │   CODE        │
   │  Alloy/TLA+) │   ??? unproven   │  (Java/Go/…)  │
   └─────────────┘                  └──────────────┘
        ▲                                  │
        │ checked: properties hold         │ what actually runs
        └──────────────────────────────────┘
              the gap nobody automatically closes
```

**A checked, even fully proven, spec does not make your code correct.** The spec lives in one artifact; the code in another. Checking the spec tells you the *design* is sound. It says nothing about whether the code matches the design. To actually connect them you must do one of:

1. **Verify the refinement / the code** — prove the code refines the spec (B method, or a deductive verifier like Dafny/Frama-C). Highest assurance, highest cost.
2. **Generate code from the spec** — derive the implementation so it's correct by construction (B's code generators). Shifts trust to the generator.
3. **Test conformance** — run the code against the spec's properties (property-based testing encodes spec properties as executable checks — see [Testing](../../testing/)). Cheapest, no soundness guarantee, but catches a lot. Model-based testing even *derives* test cases from the spec.

If you do *none* of these, the spec's value is real but bounded: **design-time bug-finding** (you found bugs just by writing and checking it) and **precise, non-rotting documentation** (a spec, unlike prose, can be re-checked and won't silently drift into fiction).

> **Key insight:** Verifying the spec and verifying the code are *two separate jobs*. Conflating them is the most expensive misconception in formal methods. A green spec means "the design has no bug *I asked about*." Closing the gap to running code requires refinement proof, code generation, or conformance testing — pick deliberately based on how much assurance the system actually needs.

---

## Core Concept 6 — Lightweight Formal Methods

If full refinement proofs are so costly, why does anyone bother? Because you don't have to go all the way. **Lightweight formal methods** (Daniel Jackson's term, embodied by Alloy) means: write a **partial** spec of the part you're unsure about, and use **fully automated, bounded analysis** to find bugs — skipping proof entirely.

The engine underneath is the **small scope hypothesis**:

> Most bugs have small counterexamples. If a design is flawed, a *small* instance — a handful of atoms — usually already exhibits the flaw.

So instead of proving a property for *all* possible sizes (hard, often undecidable), Alloy exhaustively checks *all* instances up to a small bound (e.g. 6 atoms). This is decidable, fast, and — empirically — catches the overwhelming majority of design errors. It can never *prove* absence of bugs (a counterexample might lurk at size 7), but it converts "formal methods" from a months-long proof effort into a *minutes-long* feedback loop.

Why this is the pragmatic on-ramp:

- **Partial, not total.** Spec only the tricky invariant or the gnarly state machine — not the whole system. The spec is a *probe*, not a complete model.
- **Push-button.** No interactive theorem prover, no manual induction. You write constraints; the SAT-backed analyzer does the rest.
- **Concrete counterexamples.** Failures come back as *drawn instances*, not failed proof goals — far easier to diagnose and to take to a design review.
- **High ROI.** The famous effect: teams find serious design bugs *just from writing the spec*, before any checking, because the act of formalizing forces the questions prose let them dodge.

This is the same philosophy as a strong type system or a property-based test suite: **trade completeness for automation and speed.** You give up "proven for all inputs" and get back "automatically refuted on the inputs that matter, in seconds."

> **Key insight:** Lightweight FM reframes the goal from *proving correctness* to *efficiently finding bugs*. The small scope hypothesis is the bet that makes it work — and it's a bet that pays off so reliably that bounded analysis (Alloy, and bounded model checking — see [02 — Model Checking](../02-model-checking/middle.md)) is the formal technique most engineers should reach for first.

---

## Real-World Examples

- **AWS uses TLA+ to specify and check core distributed systems** (S3, DynamoDB). Engineers reported that writing the spec alone surfaced subtle concurrency bugs in designs that had passed human review — and the model checker found edge cases reachable only after many steps. The payoff was almost entirely *design-time* bug-finding, exactly the spec-as-artifact effect.

- **Amazon's "Use of Formal Methods at AWS"** paper is the canonical industry case for *lightweight* specification: partial specs of the trickiest protocols, automatically checked, no full code proof. They explicitly note the spec doubled as living, precise documentation that didn't rot.

- **The B method built the Paris Métro Line 14 signalling** (and later automated lines) correct-by-construction: an abstract safety spec refined, with proof, down to generated code. This is the *other* end of the spectrum — full refinement proof — justified because a signalling bug kills people.

- **A symmetric-relation bug in a real social-graph model:** teams modelling "block" and "friend" relations in Alloy routinely discover, via instant counterexamples, that their constraints allow nonsense states (A blocks B but B still sees A's posts). The bug is in the *design*; Alloy surfaces it before a line of code exists.

- **Chord (the DHT) had its published correctness invariants refuted by a TLA+/Alloy-style analysis** years after publication — the small instances violating the claimed invariants were tiny. A textbook demonstration of the small scope hypothesis: the bug was small all along.

---

## Mental Models

- **A spec is a contract; checking is an interrogation.** State-based specs write the contract as pre/postconditions; Alloy interrogates a relational contract by daring it to break. Either way you're pinning down obligations prose left vague.

- **Safety is a tripwire; liveness is a deadline.** Safety: did we ever cross the line? (finite, point-at-it). Liveness: did the good thing happen *by some point in the infinite future*? (needs fairness, or "never" is trivially achievable by stalling).

- **Refinement is a "does-everything-it-promised, and more" relation.** A correct implementation may accept more inputs (weaker pre) and behave more precisely (stronger post) than its spec — never the reverse. "Do more, demand less."

- **The spec and the code are two documents.** Checking one says nothing about the other until you bridge them (prove, generate, or test). A green spec is a green *design*, not green code.

- **The small scope hypothesis is the type checker's bargain.** Like types and property tests, bounded analysis trades "proven for all" for "automatically refuted fast." You lose completeness; you gain a feedback loop measured in seconds.

---

## Common Mistakes

1. **Believing a checked spec means correct code.** The most expensive error. Checking the spec validates the *design*; the code is a separate artifact. Close the gap deliberately (refinement proof, codegen, or conformance/property tests) or accept the spec's value is design-time only.

2. **Reaching for Alloy to check a liveness property.** An Alloy `check` searches *states/instances* — it's a safety tool. "Every request eventually answered" is temporal; you need TLA+. Using the wrong family means you can't even *express* the property faithfully.

3. **Writing an invariant but never checking each operation preserves it.** Declaring `#users ≤ capacity` is half the job. You owe the per-operation argument that every operation keeps it true. An invariant nobody verifies is just a comment.

4. **Forgetting fairness when stating liveness.** Without a fairness assumption, "the thread eventually runs" has a trivial counterexample: the scheduler never picks it. Unfair liveness properties are vacuously false; state the fairness you assume.

5. **Over-specifying — fixing choices the spec should leave open.** Pinning down iteration order, exact data structure, or error-handling the design doesn't care about turns a spec into pseudo-code and rules out valid implementations. Deliberate **underspecification** (nondeterminism) is a feature; it grants implementers freedom.

6. **Checking too small a scope and declaring victory.** `check ... for 3` passing is weak evidence. The small scope hypothesis says *small* bugs are common, not that scope-3 is enough. Push the scope up until the analyzer slows down; absence of a counterexample is never a proof.

7. **Confusing precondition strength direction in refinement.** Refinement *weakens* preconditions and *strengthens* postconditions. Getting this backwards (demanding more inputs, promising less) is *not* a valid refinement — the implementation would reject inputs the spec accepted.

---

## Test Yourself

1. Name the three notation families and the single question that pulls you toward each.
2. In a pre/postcondition spec, what does the primed variable `users'` mean, and why is a postcondition a *relation* rather than a procedure?
3. In Alloy, what's the difference between a `fact`, an `assert`, and what `check` does to an `assert`?
4. State the safety-vs-liveness distinction in terms of *counterexample shape*. Which one usually needs fairness?
5. You wrote a TLA+/Z invariant and an Alloy `check` passes at scope 5. Is your *code* now correct? Why or why not?
6. In refinement, which direction may a valid implementation move the precondition and the postcondition?
7. What is the small scope hypothesis, and what does it let you *give up* in exchange for speed?

<details>
<summary>Answers</summary>

1. **State-based** (Z/VDM/B) — "what is a valid *state*?"; **relational/model-finding** (Alloy) — "what *structures* satisfy these constraints, and is there a counterexample?"; **behavioural/temporal** (TLA+) — "what is a valid *behaviour over time*?".
2. `users'` is the state *after* the operation (unprimed = before). A postcondition *relates* the before- and after-states — it specifies *what changes*, not *how* — leaving the implementation free to achieve it any way.
3. A `fact` is an axiom that always holds in your model; an `assert` is a property you *claim* follows from the facts; `check` tries to *refute* the assert by searching all instances within the given scope and reports any counterexample (or "none found" up to that bound).
4. Safety violations have a **finite** counterexample (a trace to a bad state — you can point at the step). Liveness violations have an **infinite** counterexample (a run where the good thing never happens). Liveness usually needs **fairness**, otherwise "the action is never taken" is a trivial counterexample.
5. **No.** Checking the spec validates the *design*, not the code. The spec and code are separate artifacts; you'd need to prove the code refines the spec, generate the code from the spec, or test the code's conformance to the spec's properties. Also, scope 5 isn't a proof — a counterexample could exist at a larger size.
6. A valid refinement may **weaken** the precondition (accept more inputs) and **strengthen** the postcondition (promise more / be more deterministic). "Do more, demand less."
7. The hypothesis that most bugs have *small* counterexamples, so exhaustively checking all instances up to a small bound finds most design errors. You give up **completeness** (proof for all sizes) in exchange for full **automation** and a fast feedback loop.

</details>

---

## Cheat Sheet

```
NOTATION FAMILIES (pick by the question you're asking)
  state-based   Z, VDM, B      "valid STATE?"     pre/post over typed vars
  relational    Alloy          "counterexample?"  relations + FOL, bounded check
  temporal      TLA+           "valid BEHAVIOUR?" states + actions over time
  algebraic     OBJ, Maude     ADT semantics      equations + rewriting

PRE/POST (state-based)
  pre   = caller's obligation (when is the op defined?)
  post  = spec's guarantee (relates after-state ' to before-state)
  invariant = true in EVERY reachable state; each op must PRESERVE it

ALLOY KEYWORDS
  sig / extends   set of atoms / subtyping
  fact            always-true constraint (axiom)
  pred + run      named formula + FIND an instance
  assert + check  claimed property + try to REFUTE within a scope
  one some no lone   multiplicities   |   .  ^  *   join, trans-closure, refl-trans

PROPERTIES
  invariant   single-state predicate
  safety  □   "nothing bad"    finite counterexample   states-checkable   (Alloy)
  liveness ◇  "eventually good" INFINITE counterexample  needs FAIRNESS    (TLA+)

REFINEMENT
  impl correct  iff  impl REFINES spec
  weaken precondition, strengthen postcondition  ("do more, demand less")
  data refinement: abstract set → concrete hash table (via abstraction relation)

THE GAP (a checked spec ≠ correct code) — close it via:
  (a) prove the code refines the spec   (b) generate code from spec
  (c) test conformance / property-based tests
  else: value = design-time bug-finding + non-rotting documentation

LIGHTWEIGHT FM
  partial spec + bounded automated check, no proof
  small scope hypothesis: most bugs have small counterexamples
  trade completeness → automation + seconds-long feedback loop
```

---

## Summary

- There is no single spec language; there are **families**. State-based (Z/VDM/B) describe *valid states* via pre/postconditions; relational (Alloy) describe *structures* checked by bounded model finding; temporal (TLA+) describe *behaviour over time*. Choose by the question you're asking.
- A **state-based** spec models typed state variables and operations as pre/postcondition contracts. Primed variables are the after-state; postconditions are *relations*, not procedures; every operation must **preserve the invariant**.
- **Alloy** inverts proof: you declare `fact`s, `assert` a property, and `check` dares the analyzer to refute it within a bounded scope — getting instant, *drawn* counterexamples.
- The key property split is **safety vs liveness**. Safety ("nothing bad", `□`) has finite counterexamples and is state-checkable; liveness ("eventually good", `◇`) has infinite counterexamples and usually needs **fairness**. An Alloy `check` is a safety check.
- **Refinement** is the formal "implements" relation: a valid implementation *weakens preconditions and strengthens postconditions*. An implementation is correct *iff* it refines the spec — but **checking the spec does not make the code correct**. Close the gap by proving refinement, generating code, or testing conformance; otherwise the spec's value is design-time bug-finding and non-rotting documentation.
- **Lightweight formal methods** — partial specs plus bounded automated analysis, justified by the **small scope hypothesis** — trade completeness for a seconds-long feedback loop. It's the highest-ROI on-ramp, and the technique most engineers should reach for first.

---

## Further Reading

- *Software Abstractions: Logic, Language, and Analysis* — Daniel Jackson. The Alloy book; the definitive case for lightweight formal methods and the small scope hypothesis. Start here.
- *The Z Notation: A Reference Manual* — J. M. Spivey. The authoritative reference for state-based specification with Z's schema calculus.
- *Specifying Systems* — Leslie Lamport. TLA+ from its creator; the deep treatment of state/action/temporal specs (preview for [03](../03-tla-plus-and-temporal-logic/middle.md)).
- **Hillel Wayne** — *Practical TLA+* and his essays/newsletter; the most accessible modern on-ramp to formal specs for working engineers.
- *Programming from Specifications* — Carroll Morgan. The refinement calculus: deriving correct code from specs, step by provable step.
- *Use of Formal Methods at Amazon Web Services* — Newcombe et al. The industry case study for lightweight specs at scale.
- [senior.md](senior.md) — refinement proofs in depth, the refinement calculus formally, mechanized specs, and how specs feed deductive verification.

---

## Related Topics

- [02 — Model Checking](../02-model-checking/middle.md) — automatically checks a spec's properties by exploring its state space; the engine behind bounded analysis.
- [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/middle.md) — the temporal family in depth, where liveness and fairness properties actually live.
- [04 — Property & Contract Verification](../04-property-and-contract-verification/middle.md) — contracts as function-level specs; pre/postconditions scoped to a single operation.
- [05 — Proof Assistants & Dependent Types](../05-proof-assistants-and-dependent-types/middle.md) — when bounded checking isn't enough and you need full proof.
- [Testing](../../testing/) — property-based testing encodes a spec's properties as executable conformance checks, one way to close the spec–code gap.
