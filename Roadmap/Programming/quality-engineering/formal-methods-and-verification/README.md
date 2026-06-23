# Formal Methods & Verification

> *"Beware of bugs in the above code; I have only proved it correct, not tried it."* — Donald Knuth. The joke is the whole discipline in one line: a proof is only as good as the spec it proves against.

This roadmap is about the strongest claim software engineering can make: not "we tested it and found no bugs," but "we **proved** this property holds on **every** input / **every** reachable state." Testing samples the input space; formal methods reason about all of it. That power is real — it is how Amazon found 35-step bugs in DynamoDB's replication, how the seL4 microkernel and the CompCert C compiler carry machine-checked correctness proofs, how TLA+ catches distributed-systems design flaws *before a line of code exists*. It is also expensive, and the engineering judgement of **where it pays off and where a property test is enough** matters more than any single tool.

> Looking for *property-based testing* (QuickCheck/Hypothesis-style) — the gateway drug that gives you "for all inputs" thinking without a proof obligation? It lives partly here in [04](04-property-and-contract-verification/) and partly in **[Testing](../testing/)**; this section frames it as the cheapest rung on the verification ladder.
>
> Looking for *type-checkers and SAST* — lightweight formal methods you already use every day? See **[Static Analysis & Linting](../static-analysis/)**; a type system *is* a proof system, and this roadmap places it on the same spectrum as Dafny and Coq.
>
> Looking to *catch* violations at runtime rather than prove their absence? See **[Dynamic Analysis & Sanitizers](../dynamic-analysis-and-sanitizers/)**.

---

## Why a Dedicated Roadmap

Most engineers meet formal methods as an academic curiosity and conclude "not for my job" — which is the wrong lesson twice over. First, the **lightweight** end of the spectrum (a TLA+ spec of a tricky protocol, an Alloy model of a permissions scheme, a Dafny-verified parser, refinement types) is increasingly practical and is *already* used at AWS, Azure, MongoDB, and in blockchain and aerospace. Second, the *thinking* the field teaches — precise specification, the difference between safety and liveness, invariants, what "correct" even means — makes you better at ordinary design, review, and debugging even if you never run a model checker. This roadmap demystifies the ladder from "write down the invariant" to "machine-checked proof," and — crucially — teaches the cost/benefit judgement of **when to climb it**.

| Approach | Claim it makes | Cost |
|---|---|---|
| [Testing](../testing/) | "No bug on *these* inputs" | Low |
| Property-based testing | "No bug found in *N random* inputs satisfying invariants" | Low–medium |
| Model checking (TLA+, SPIN) | "No violation in *all reachable states* of the model" | Medium |
| Deductive verification (Dafny, Frama-C) | "Code meets its spec on *all* inputs" | High |
| Proof assistants (Coq, Isabelle, Lean) | "Machine-checked proof of *arbitrary* theorems" | Very high |

---

## Sections

Each topic ships the full five-tier set — **junior / middle / senior / professional / interview**.

| # | Topic | Focus |
|---|---|---|
| [01](01-formal-specification/) | Formal Specification | What a spec *is* and why it's the hard part; Z / Alloy / B; specs vs tests; refinement; the spec–implementation gap; lightweight FM |
| [02](02-model-checking/) | Model Checking | Exhaustive state-space exploration; safety vs liveness; the state-explosion problem; BMC and SAT/SMT; SPIN & Alloy; reading counterexamples |
| [03](03-tla-plus-and-temporal-logic/) | TLA+ & Temporal Logic | TLA+, PlusCal, the TLC checker; LTL/CTL; invariants vs temporal properties; specifying concurrent & distributed systems; the Amazon experience |
| [04](04-property-and-contract-verification/) | Property & Contract Verification | The practical middle: property-based testing, design by contract, refinement types, SMT-backed verification (Dafny, Why3, Frama-C) |
| [05](05-proof-assistants-and-dependent-types/) | Proof Assistants & Dependent Types | Coq/Rocq, Isabelle/HOL, Lean, Agda; dependent types; Curry–Howard; CompCert & seL4; proof engineering and its true cost |
| [06](06-when-formal-methods-pay-off/) | When Formal Methods Pay Off | The ROI decision: aerospace, crypto, kernels, distributed protocols, hardware; lightweight vs heavyweight; "verify the core, test the rest" |

---

## Sources & Vocabulary

Grounded in: **Leslie Lamport** — *Specifying Systems* / TLA+ / temporal logic; **Newcombe et al.** — *"How Amazon Web Services Uses Formal Methods"* (CACM 2015); **Daniel Jackson** — *Software Abstractions* / Alloy; **Holzmann** — SPIN / *The SPIN Model Checker*; **Clarke, Grumberg & Peled** — *Model Checking*; **Rustan Leino** — Dafny; the **Coq/Rocq**, **Isabelle/HOL**, **Lean**, and **Agda** communities; the **CompCert** (Leroy) and **seL4** (Klein et al.) verified-systems milestones; **Bertrand Meyer** — design by contract; **Hillel Wayne** — *Practical TLA+* / *Learn TLA+*; the **Curry–Howard correspondence**.

---

## Status

✅ **Content-complete.** All 6 topics are written across the full five-tier set (junior / middle / senior / professional / interview): 30 topic files in total.

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place. Sits in [Quality Engineering](../) as the most rigorous rung above [Testing](../testing/), the proof-based complement to [Static Analysis & Linting](../static-analysis/) and [Dynamic Analysis & Sanitizers](../dynamic-analysis-and-sanitizers/). Its model-checking techniques apply directly to [Backend → Distributed Systems](../../../Backend/distributed-systems/).
