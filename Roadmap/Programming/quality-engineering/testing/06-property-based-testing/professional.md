# Property-Based Testing — Professional Level

> **Roadmap:** [Testing](../README.md) → Property-Based Testing

*PBT as an executable specification, adopted across a team, validated by mutation testing, and justified by ROI. The organizational and architectural view.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — PBT as executable specification](#core-concept-1--pbt-as-executable-specification)
5. [Core Concept 2 — Teaching teams to find properties](#core-concept-2--teaching-teams-to-find-properties)
6. [Core Concept 3 — Validating properties with mutation testing](#core-concept-3--validating-properties-with-mutation-testing)
7. [Core Concept 4 — PBT and the relationship to formal methods](#core-concept-4--pbt-and-the-relationship-to-formal-methods)
8. [Core Concept 5 — Integrating PBT into a suite at scale](#core-concept-5--integrating-pbt-into-a-suite-at-scale)
9. [Core Concept 6 — ROI, cost, and the skill investment](#core-concept-6--roi-cost-and-the-skill-investment)
10. [Core Concept 7 — Anti-patterns and governance](#core-concept-7--anti-patterns-and-governance)
11. [Real-World Examples](#real-world-examples)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **PBT as a specification artifact, the organizational mechanics of adoption, validating it with mutation testing, and making the ROI case.**

A senior engineer can write excellent property tests. A principal/staff engineer makes property-based thinking *land across a team* — turning it from a clever trick one person uses into a durable engineering practice that raises the floor of the codebase. That requires three shifts: treating properties as **specifications** (the most precise, executable statement of what code must do), **validating** that those properties are actually strong (not vacuously passing), and making an honest **cost/benefit** argument so the investment survives contact with deadlines. This level is about leadership and architecture, not new syntax.

---

## Prerequisites

- Senior level: stateful PBT, seeds, determinism, ecosystem tools.
- Familiarity with mutation testing (`../07-mutation-testing/`) and basic formal methods (`../../formal-methods-and-verification/`).
- Experience shepherding a testing strategy across more than one team.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Executable specification** | A property that states *what must always be true*, runnable and machine-checked. |
| **Vacuous property** | A property that passes for all inputs even when the code is wrong (tests nothing). |
| **Mutation testing** | Inject faults into code; a good test suite "kills" (detects) them. |
| **Mutation score** | Fraction of injected faults detected — a measure of test strength. |
| **Property coverage** | Which behaviors/branches are actually exercised by generated inputs. |
| **Light formal methods** | Specs/invariants checked by testing rather than full proof. |
| **ROI** | Bugs prevented and design clarity gained, weighed against authoring and runtime cost. |

---

## Core Concept 1 — PBT as executable specification

The deepest framing of PBT: **a property is a specification.** "Decode is the inverse of encode," "the queue is always FIFO," "merging two replicas converges regardless of order" — these are not test cases, they are *statements of intent*, written in code, checked by machine against thousands of inputs.

This matters organizationally because specifications are usually the missing artifact. Requirements docs rot; the property test does not, because it fails the build when it diverges from the code. When you express the contract as properties:

- **The spec is executable and verified continuously**, not a stale wiki page.
- **Reviewers read the properties to understand intent.** A PR's properties tell you what the author believes must hold — often clearer than the implementation.
- **The spec drives the design.** Articulating "what must always be true" before coding (property-first, akin to TDD) exposes ambiguous requirements early: "wait, *should* merge be commutative? what happens on conflict?"

```python
# This reads as the specification of a money type, not as three examples.
@given(money(), money())
def test_addition_is_commutative(a, b):
    assert a + b == b + a

@given(money(), money(), money())
def test_addition_is_associative(a, b, c):
    assert (a + b) + c == a + (b + c)

@given(money())
def test_zero_is_identity(a):
    assert a + Money.zero(a.currency) == a

@given(money(), st.integers())
def test_scaling_distributes(a, n):
    assert a * n == sum([a] * n, Money.zero(a.currency)) if n >= 0 else True
```

Those four properties *are* the algebraic spec of money. Anyone reading them knows the contract; any implementation that violates it fails CI. That is what "PBT as specification" means in practice.

---

## Core Concept 2 — Teaching teams to find properties

Adoption fails for one reason: people can't find properties and conclude "PBT doesn't fit our code." Your job is to make property-finding a *learnable, repeatable* skill, not a flash of insight.

**Concrete tactics that work:**

- **Hand out the pattern checklist** (round-trip, invariant, idempotence, commutativity, oracle, metamorphic, equivalence) as a literal review step: "for this function, which rows of the table apply?" Reference the `property-based-testing` skill so the catalogue lives somewhere durable.
- **Run property-storming sessions.** Put a function on the screen; the team brainstorms every rule that must hold, no filtering. Most functions yield 3–5 once the room warms up.
- **Start where it's free.** The first PBT in a codebase should be a round-trip on an existing serializer — guaranteed value, near-zero effort, an instant win that converts skeptics.
- **Pair PBT with the oracle pattern for migrations.** When rewriting a component, the old implementation is a free oracle for the new one. This is the single most persuasive on-ramp: "we found three behavior differences before shipping the rewrite."
- **Codify the "find with PBT, pin with `@example`" loop** so discovered bugs visibly accrue value.

The leadership outcome is cultural: engineers reach for "what's always true here?" reflexively, the way they reach for "what's the edge case?" today.

---

## Core Concept 3 — Validating properties with mutation testing

A property that *passes* tells you little — it might be **vacuous** (always true regardless of correctness). The acid test for property strength is **mutation testing**: deliberately inject faults into the production code and confirm your properties *fail*.

```text
Original:   if a <= b: ...
Mutant 1:   if a <  b: ...      # off-by-one boundary
Mutant 2:   if a >  b: ...      # inverted comparison
Mutant 3:   if True:   ...      # condition removed
```

Run the mutation tool (mutmut/Cosmic Ray for Python, PIT for Java, Stryker for JS). For each mutant it reruns your tests; a mutant that survives is a fault your properties *can't see*. A surviving mutant on code your PBT supposedly covers means one of:

- the property is **vacuous** (e.g., `assert len(out) >= 0`),
- the **generator never reaches** the relevant input region (distribution gap), or
- the property is **too weak** (checks length but not ordering).

This pairing is powerful precisely because PBT and mutation testing are complementary: PBT generates *inputs*, mutation testing generates *faults*. Together they answer "do strong checks meet thorough inputs?" A high mutation score on PBT-covered code is the strongest evidence you can produce that your specification actually constrains behavior. Make "mutation-test the PBT-covered modules" part of the definition of done for critical logic. See `../07-mutation-testing/`.

---

## Core Concept 4 — PBT and the relationship to formal methods

PBT sits on a spectrum between example tests and full formal verification:

```
example tests  →  property-based tests  →  model checking (TLA+)  →  proof (Coq/Lean)
 (some inputs)     (many random inputs)     (all states, bounded)     (all inputs, proven)
   cheap                cheap-ish              moderate                 expensive
```

PBT is **lightweight formal methods**: you write a specification (the property) and check it against a large *sample* of the input space, not the whole space. It will not *prove* correctness — a property can pass a million inputs and still fail on the one you didn't generate — but it captures most of the value of a formal spec at a fraction of the cost, and it does so in the language and CI your team already uses.

The professional judgment: use PBT as the default rigor for invariant-heavy code; escalate to model checking or proof only where the cost of a missed bug justifies it (consensus protocols, cryptography, safety-critical control). Often the same invariant is *expressed* in a property test and *also* in a TLA+ spec — the property test guards the implementation, the model checks the design. See `../../formal-methods-and-verification/` for where to draw that line.

---

## Core Concept 5 — Integrating PBT into a suite at scale

Running PBT across a large codebase without slowing teams down or adding flakiness requires deliberate placement (building on the senior-level CI mechanics):

- **Tier the runs.** Fast, fixed-seed, low-`max_examples` PBT on the PR gate (must stay green and quick); high-`max_examples`, random-seed exploratory PBT nightly with seeds reported. New bugs surface nightly with a reproducible seed; gates stay stable.
- **Budget runtime explicitly.** PBT is slower than example tests. Set per-property example counts by *value*: 1000+ for codecs and core data structures, 50–100 for cheaper checks. Use deadlines to prevent slow generated inputs from causing timeout flakiness.
- **Persist the example database deliberately.** Decide whether the framework's failing-example store (Hypothesis `.hypothesis/`, proptest regressions file) is cached in CI (remembers past failures) or not (fully independent runs). Commit the *regressions file* where the framework supports it so discovered counterexamples are shared and reviewed.
- **Centralize domain generators.** A shared module of `Arbitrary`/strategy builders for your core types (User, Money, Order, Event) is the highest-leverage shared asset — it makes every new PBT cheap to write and keeps distributions realistic.
- **Standardize the regression loop.** "Find with PBT, pin with `@example`, commit it" as a documented, enforced practice so bug knowledge accumulates in source control.

---

## Core Concept 6 — ROI, cost, and the skill investment

Make the case honestly; PBT is not free.

**Costs:**

- **Skill ramp.** Finding properties is a genuine new skill; expect a few weeks before a team is fluent. This is the dominant cost.
- **Runtime.** Hundreds of inputs per property are slower than one example. Manageable with tiering, but real.
- **Generator maintenance.** Custom generators are code that must evolve with your types.
- **Cultural friction.** "Random tests scare me" must be answered with the seed/determinism discipline from the senior level, or adoption stalls.

**Benefits:**

- **Finds the bug class humans skip** — boundary, unicode, ordering, overflow, lifecycle — exactly the bugs that reach production.
- **One property replaces dozens of example tests**, and keeps finding *new* cases as code changes.
- **The property doubles as living specification** — design clarity and onboarding value beyond bug-finding.
- **Shrinking slashes debugging time** — failures arrive as minimal reproductions.

**Where to invest first** (the senior-level ROI map applies): parsers, serializers, codecs, data structures, financial/date/encoding logic, protocols and state machines. **Where to decline:** invariant-free glue, thin CRUD, UI look-and-feel. The principal-level move is to *target* PBT at the high-invariant, high-cost-of-failure modules rather than mandating it everywhere — a blanket mandate produces vacuous properties and resentment; a focused deployment produces caught bugs and converts.

---

## Core Concept 7 — Anti-patterns and governance

- **Vacuous-property theater.** Teams under a PBT mandate write `assert result is not None` to tick a box. Governance: require mutation testing on PBT-covered critical modules so vacuous properties are exposed.
- **Re-implementing the SUT in the property.** The property duplicates the production algorithm, so both share the same bug. Enforce independent reasoning (structure, oracle, metamorphic) in review.
- **Distribution blind spots.** Generators that never reach the interesting region (e.g., dates always in 2024) give false confidence. Review generator distributions; mutation survivors flag the gaps.
- **Flaky PBT on the gate.** Random seed on a blocking gate without reproduction discipline erodes trust in the whole suite. Fixed seed on the gate, random nightly.
- **PBT-everywhere mandates.** Forcing properties onto code with no invariant wastes effort and discredits the practice. Govern by *targeting* high-value modules.

---

## Real-World Examples

- **A payments ledger.** Properties encode the algebra (commutativity, associativity, identity, conservation of total). Mutation testing on the ledger module confirms the properties kill boundary and sign mutants. The properties *are* the reviewed spec of the money type.
- **A protocol rewrite.** Old implementation is the oracle for the new one; stateful PBT generates operation sequences and finds three behavior differences pre-launch. Each is pinned as `@example`.
- **A serialization library team.** Centralized generators for every wire type; round-trip properties per type; nightly exploratory run with reported seeds; PR gate fixed-seed. Discovered counterexamples committed to the regressions file and shared.
- **A safety-critical scheduler.** Invariants expressed *both* as PBT (guards the code) and as a TLA+ model (checks the design) — PBT for the implementation, model checking for the protocol.

---

## Mental Models

- **A property is a specification you can run.** Treat it as the executable, continuously-verified statement of intent.
- **PBT generates inputs; mutation testing generates faults.** Use both to prove your checks meet your inputs.
- **PBT is formal methods on a budget.** Most of the spec value, a fraction of the proof cost — escalate only where misses are catastrophic.
- **Target, don't mandate.** Focus PBT on high-invariant, high-cost modules; blanket mandates breed vacuous properties.

---

## Common Mistakes

- **Mandating PBT everywhere**, producing box-ticking vacuous properties instead of caught bugs.
- **Never validating property strength** — passing properties are assumed strong; without mutation testing they may be vacuous.
- **Letting generators drift from reality**, so whole input regions are never tested.
- **Treating PBT as a proof.** It samples the input space; it does not exhaust it. Don't oversell certainty.
- **Skipping the spec framing**, so PBT stays a niche trick instead of becoming the team's contract language.
- **No shared generator library**, making every new property expensive and inconsistently distributed.

---

## Test Yourself

1. Argue why a property is better characterized as a specification than as a test.
2. A PBT-covered module has surviving mutants. List three causes and how you'd distinguish them.
3. Place PBT on the spectrum from example tests to proof; when do you escalate beyond PBT?
4. Make the ROI case for introducing PBT to a payments team — costs and benefits.
5. How would you roll out PBT across five teams without producing vacuous-property theater?
6. Why is a centralized domain-generator module the highest-leverage shared PBT asset?

---

## Cheat Sheet

```text
PBT as spec        : properties = executable, continuously-verified intent
Validate strength  : mutation-test PBT-covered critical modules; survivors = weak/vacuous/distribution gap
Formal spectrum    : examples < PBT < model checking < proof ; escalate by cost-of-miss
Scale the suite    : fixed-seed PR gate (fast) + random-seed nightly (deep, seed reported)
Shared assets      : central domain generators; committed regressions file; @example regression loop
Govern by targeting: parsers/codecs/data-structures/money/dates/protocols — not glue or CRUD
Adoption           : pattern checklist + property-storming + oracle-for-migrations as the on-ramp
```

---

## Summary

At the professional level, PBT becomes a *specification practice*: properties are executable, continuously-verified statements of intent that reviewers read and that drive design. Validate property strength with mutation testing — PBT generates inputs, mutation testing generates faults, and together they prove your checks actually constrain behavior. PBT is lightweight formal methods: most of a spec's value at a fraction of the cost, to be escalated to model checking or proof only where misses are catastrophic. Adopt it by teaching property-finding as a repeatable skill, centralizing domain generators, tiering CI runs, and *targeting* high-invariant, high-cost modules rather than mandating it everywhere. Done well, PBT raises the floor of an entire codebase; done as a mandate, it degrades into vacuous-property theater.

---

## Further Reading

- John Hughes, "Experiences with QuickCheck: Testing the Hard Stuff and Staying Sane."
- "Property-Based Testing with PropEr, Erlang, and Elixir" (Fred Hebert) — practical adoption.
- Hillel Wayne, writing on PBT vs. formal methods and where each pays.
- The `property-based-testing` and `unit-testing-patterns` skills.

---

## Related Topics

- [Property-Based Testing — Senior](./senior.md) — stateful testing, seeds, CI mechanics.
- [Mutation Testing](../07-mutation-testing/) — validating that your properties actually catch bugs.
- [Formal Methods and Verification](../../formal-methods-and-verification/) — properties as light specs; when to escalate.
- [Unit Testing](../02-unit-testing/) — the foundation PBT builds on.
- [Flaky Tests and Reliability](../12-flaky-tests-and-reliability/) — keeping randomized suites trustworthy.
