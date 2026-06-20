# When Formal Methods Pay Off — Senior Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → When Formal Methods Pay Off
> *The middle page gave you the ladder of techniques. This page is about the decision: how to price assurance as risk reduction, where the diminishing-returns knee actually sits for each rung, why "verify the core, test the rest" is the only architecture that scales, and why the spec — not the proof — is almost always the thing that bites you.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Assurance as Priced Risk Reduction](#core-concept-1--assurance-as-priced-risk-reduction)
5. [Core Concept 2 — The Full Spectrum, With Honest Cost Data](#core-concept-2--the-full-spectrum-with-honest-cost-data)
6. [Core Concept 3 — Diminishing Returns and Where the Knee Is](#core-concept-3--diminishing-returns-and-where-the-knee-is)
7. [Core Concept 4 — Verify the Core, Test the Rest](#core-concept-4--verify-the-core-test-the-rest)
8. [Core Concept 5 — The Spec Is the Weak Link](#core-concept-5--the-spec-is-the-weak-link)
9. [Core Concept 6 — Assurance Cases and Certification Credit](#core-concept-6--assurance-cases-and-certification-credit)
10. [Core Concept 7 — Cost-Effective FM in Practice](#core-concept-7--cost-effective-fm-in-practice)
11. [Core Concept 8 — The Decision Model and When to Stop](#core-concept-8--the-decision-model-and-when-to-stop)
12. [Real-World Examples](#real-world-examples)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The economics and architecture of choosing assurance — how a senior engineer decides which rung of the verification ladder a given artifact deserves, and defends that choice with numbers.**

By the middle level you can climb the ladder: write a property test, model a protocol in TLA+, annotate a function for Dafny, read a Coq script. That makes you capable. The senior jump is different — you now allocate the *budget*. You decide that the consensus state machine gets a TLA+ spec and the REST handlers around it get property tests; that the crypto field arithmetic is machine-verified and generated, while the TLS state machine is fuzzed; that proving the build system correct is gold-plating you will not pay for.

Each of those is a risk-and-cost decision with second-order effects: assurance bought in the wrong place is wasted money *and* false confidence, and assurance skipped in the wrong place is a recall, a CVE, or a 35-step replication bug found in production instead of in a model. To choose well you need a real model of what assurance *costs* and what it *buys* — the published seL4 and CompCert numbers, the AWS experience report, the certification standards that grant FM credit — because that is where the tradeoffs actually live. This page is that layer: the assurance economy, priced honestly.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — the verification ladder, safety vs liveness, "for all inputs," and the difference between sampling and proof.
- **Required:** You can read the section's tooling pages well enough to picture the *effort* each rung demands — a property test vs a TLA+ spec vs a Dafny annotation burden vs a Coq proof script.
- **Helpful:** You've owned a system through a real incident and can name its blast radius — who is harmed, how reversibly, at what cost.
- **Helpful:** A working sense of expected value: `P(event) × cost(event)`, and why low-probability/high-cost tails dominate that product.

---

## Glossary

- **Assurance** — justified confidence that a system has a property. Not binary; a *quantity* you buy with engineering effort.
- **TCB (Trusted Computing Base)** — everything a proof's validity *depends on but does not itself prove*: the spec, the axioms, the solver, the compiler, the extraction step, the hardware model. Bugs here defeat the proof silently.
- **Sound / unsound** — a sound analysis never says "safe" when it isn't (no false negatives for the property); an unsound one may miss real bugs to stay fast and quiet. Most everyday linters are deliberately unsound.
- **Bounded** — a result that holds only up to some limit (≤ N steps, ≤ K-element data structures). Bounded model checking finds shallow bugs cheaply but proves nothing beyond the bound.
- **Deductive verification** — proving code meets a spec via logical inference, typically discharging *verification conditions* to an SMT solver (Dafny, SPARK, Frama-C, Verus).
- **Interactive / proof assistant** — a tool where a human guides a machine-checked proof (Coq/Rocq, Isabelle/HOL, Lean, Agda). Highest assurance, highest cost.
- **Proof:code ratio** — lines of proof/annotation per line of verified code; the headline cost metric for heavyweight FM.
- **Assurance case** — a structured, auditable argument (claim → sub-claims → evidence) that a system is acceptably safe/secure. FM supplies *some* of the evidence; it is never the whole case.
- **Blast radius** — the scope and reversibility of a failure: who/what is harmed and whether it can be undone.

---

## Core Concept 1 — Assurance as Priced Risk Reduction

The entire field reduces to one inequality. The expected loss from a defect is:

```
expected_loss = P(failure) × cost(failure)
```

Every quality technique is a purchase that lowers `P(failure)` by raising the *cost of engineering*. A technique is worth buying only when the **reduction in expected loss exceeds its cost**:

```
buy FM  ⇔  [ P_before − P_after ] × cost(failure)  −  amortized_cost(FM)  >  0
```

Two consequences fall straight out of this, and they govern every sensible FM decision.

**First: the calculus is dominated by `cost(failure)`, not by `P(failure)`.** Formal methods do not drive `P(failure)` to zero — they drive it *low*, and so does a good test suite. The difference FM buys over testing on the `P` axis is real but bounded. What makes the *product* swing is the magnitude of `cost(failure)`. When failure is **catastrophic** (lives), **unrecoverable** (a deployed satellite, a shipped silicon mask, an immutable smart contract holding \$200M), or **irreversible** (a leaked signing key, a corrupted ledger), `cost(failure)` is enormous and even a small `P` reduction pays for itself many times over. When failure is cheap and reversible — a web form that you can hotfix in ten minutes — the product is small no matter how low FM drives `P`, and FM loses to testing on cost.

> **Key insight:** Formal methods are not a tool for *correctness*; they are a tool for *reducing the probability of catastrophe*. If a failure is cheap to detect, cheap to recover from, and reversible, you almost never need a proof — you need fast feedback. FM earns its keep precisely where recovery is *not* an option.

**Second: the cost side is dominated by the artifact's stability and size.** `amortized_cost(FM)` is not the one-time cost of writing the proof — it is that cost *spread over the artifact's lifetime, minus the re-proof tax every change imposes*. A proof is a liability that must be re-discharged whenever the code or spec moves. So FM amortizes well only over artifacts that are **small** (less to prove) and **stable** (the proof is written once and stays valid). A 2,000-line consensus core that hasn't changed its protocol in three years amortizes a proof beautifully. A 50,000-line feature surface that churns weekly will spend more on proof maintenance than the bugs ever cost.

This is why the canonical FM targets — a crypto primitive, a parser, a bytecode verifier, a consensus protocol, a hypervisor's address-space logic — share a profile: **small, stable, high blast-radius, behind a clean interface.** That profile is not a coincidence; it is the solution to the inequality.

---

## Core Concept 2 — The Full Spectrum, With Honest Cost Data

"Formal methods" is not one thing with one price. It is a spectrum spanning four orders of magnitude in cost. A senior's first move is to locate the *cheapest rung that buys the assurance the risk demands*.

| Rung | Representative tools | What it claims | Cost (effort) | Soundness / limits |
|---|---|---|---|---|
| **Types & static analysis** | Rust borrow checker, TypeScript, clang-tidy, CodeQL, Infer | "These classes of bug are absent (or flagged)" | Near-zero (you already pay it) | Sound *for the property modeled*; SAST is usually deliberately *unsound* (misses bugs to avoid noise) |
| **Contracts + property-based testing** | Hypothesis, QuickCheck, jqwik, `assert`/`require` | "No counterexample found in *N* sampled inputs satisfying preconditions" | Low (hours–days) | **Sampling** — finds bugs, never proves absence; shrinking gives minimal counterexamples |
| **Bounded MC / lightweight modeling** | TLA+/TLC, Alloy, SPIN, CBMC | "No violation in *all reachable states* of the model (≤ bound)" | Medium (days–weeks) | Finds *design* bugs; bounded or finite-state; models the design, not the code |
| **Deductive verification (SMT)** | Dafny, SPARK/Ada, Frama-C/WP, Verus, Why3 | "Code meets its spec on *all* inputs" | High (annotation burden; weeks–months) | Solver timeouts/incompleteness; spec is yours to get right; loops need invariants |
| **Interactive proof** | Coq/Rocq, Isabelle/HOL, Lean, Agda | "Machine-checked proof of *arbitrary* theorems" | Very high (**10–20:1** proof:code; person-years) | Highest assurance; brutal maintenance; TCB = kernel + spec + extraction |

The cost column is the part most engineers underweight. Some published anchors to calibrate against:

- **seL4** (verified microkernel): roughly **\$200–400 per line** of verified C at the time, on the order of **20–25 person-years** for ~8,700 lines of C, with a **proof:code ratio around 20:1** (Isabelle/HOL). Klein et al. estimate the proof cost at a *fraction* of what a traditional high-assurance (Common Criteria EAL6/7) certification would have cost for comparable evidence — that is the comparison that made it rational.
- **CompCert** (verified C compiler): years of effort in Coq; the payoff is concrete — Csmith fuzzing found *hundreds* of bugs in GCC and Clang but **zero miscompilation bugs in CompCert's verified middle/back end**. The unverified parts (frontend, runtime) did have bugs, which is itself a lesson about TCB.
- **Property-based testing**: a Hypothesis or QuickCheck suite is *hours* of work and routinely finds bugs example tests never would. This is the rung most teams skip and shouldn't.

> **Key insight:** The rungs differ in cost by ~10⁴×. Treating "use formal methods" as a single yes/no decision is the most common and most expensive mistake — it makes people either reject the whole spectrum (and skip the cheap rungs that always pay) or reach for Coq (and bankrupt a project that needed a property test). The decision is *which rung*, never *whether*.

---

## Core Concept 3 — Diminishing Returns and Where the Knee Is

Plot assurance gained against effort spent and you get a curve that rises steeply, then flattens hard. The first property test on an untested parser removes a fistful of real bugs for an afternoon's work. The deductive proof that the parser never reads out of bounds removes a smaller, rarer set for ten times the effort. The interactive proof that it *exactly* implements the grammar removes a smaller set still for another order of magnitude. Each rung buys *less marginal assurance per unit effort* than the one below it.

The **knee** — where you should stop — is not a fixed point. It moves with `cost(failure)`:

| Risk level (cost of failure) | Rational knee — stop climbing at | Rationale |
|---|---|---|
| Reversible, cheap (typical web feature) | **Types + property tests** | A hotfix is cheaper than a proof; fast feedback wins |
| Costly but recoverable (payments, data integrity) | **Contracts + bounded model checking of the tricky core** | Model the protocol, fuzz the rest; design bugs are the expensive ones |
| Catastrophic / unrecoverable (avionics, kernels, crypto, on-chain) | **Deductive or interactive proof of the core** | The tail loss is so large that 10–20:1 proof cost is still positive EV |
| Adversarial + immutable (smart contracts, signing logic) | **Proof of the core + extensive testing of the boundary** | No patch path; the attacker searches the *whole* input space, so must you |

The higher `cost(failure)`, the further right the knee sits — because the value axis is stretched, the curve stays above the break-even line for longer. For a web form the knee is at "types + property tests"; pushing to a proof is pure gold-plating. For a flight control law the knee is far to the right; stopping at unit tests is negligence. Same curve, different intersection with the cost-of-failure line.

> **Key insight:** "Diminishing returns" does not mean "stop early everywhere." It means *stop at the rung where the next rung's marginal cost exceeds its marginal risk reduction* — and that crossover point is a function of blast radius, not a property of the technique. The skill is locating your own knee, not having a fixed opinion about FM.

---

## Core Concept 4 — Verify the Core, Test the Rest

You almost never verify a whole system; the economics forbid it. The dominant architecture is to **isolate a small, stable, high-value core behind a clean interface, verify it heavily, and surround it with cheaper methods.** This is how every real-world deployment of heavyweight FM is structured.

```
        ┌───────────────────────────────────────────┐
        │      Outer system: handlers, I/O, UI       │   ← tests + property tests + types
        │   (large, churny, low individual blast)    │     (fast feedback, cheap)
        │                                            │
        │      ┌──────────────────────────────┐      │
        │      │   INTERFACE / CONTRACT        │      │   ← the assumption boundary
        │      │   (preconditions, invariants) │      │     EVERYTHING hinges here
        │      │                               │      │
        │      │   ┌───────────────────────┐   │      │
        │      │   │   VERIFIED CORE       │   │      │   ← proof / model checking
        │      │   │  crypto primitive,    │   │      │     (small, stable, high blast)
        │      │   │  parser, consensus    │   │      │
        │      │   │  state machine,       │   │      │
        │      │   │  bytecode verifier    │   │      │
        │      │   └───────────────────────┘   │      │
        │      └──────────────────────────────┘      │
        └───────────────────────────────────────────┘
```

Good cores share a shape: a crypto primitive (small, math-heavy, catastrophic if wrong), a parser or deserializer (the classic memory-safety and injection surface), a consensus or replication state machine (subtle, design-bug-prone, hard to test exhaustively), a bytecode/IR verifier (the gatekeeper the whole sandbox's safety rests on). They are small enough to prove and stable enough that the proof stays valid.

**The interface is where it all lives or dies.** A proof of the core establishes "the core is correct *given* its preconditions and *given* the assumptions about its environment." Those preconditions and assumptions are a contract the *unverified* surroundings must honor. Violate the contract and the proof tells you nothing:

- **seL4's assumptions** are explicit and instructive: the proof assumes the C compiler is correct (later partly closed by verifying down to binary), assumes the hardware behaves per its model, assumes correct boot code, correct cache/TLB management, and *assumes no DMA from devices bypasses the MMU*. Each is a real-world hole the proof does not cover — and an attacker who finds one defeats a machine-checked kernel.
- **The spec↔code gap**: deductive tools prove the code matches *your spec*. If the spec is wrong, the proof faithfully certifies wrong behavior (Concept 5).
- **The extraction TCB**: when you prove an algorithm in Coq and *extract* it to OCaml/Haskell to run, the extraction step and its runtime join the TCB. CompCert sidesteps this by being the verified compiler; most projects do not have that luxury.

> **Key insight:** A verified core is a sealed vault with a door. The proof guarantees the vault's walls — it says nothing about whether the door's contract is honored by the people outside. Most "the proof didn't help" stories are interface-violation stories: an unchecked input crossed the boundary, an environmental assumption was false, or the spec at the door didn't say what everyone thought it said.

---

## Core Concept 5 — The Spec Is the Weak Link

Knuth's quip — *"Beware of bugs in the above code; I have only proved it correct, not tried it"* — is funny because it is rigorous. Every formal result has the exact shape:

```
PROVEN:  code  ⊨  SPEC      given AXIOMS,  modulo TCB
```

The proof is a sealed deduction. But three of its four inputs are *human-supplied and unproven*: the **spec** (does it say what you meant?), the **axioms** (are your assumptions about the world true?), and the **TCB** (solver, compiler, extraction, hardware model). A flaw in any of them passes straight through the proof, certified.

The dominant failure mode is the **wrong or incomplete spec**. You can prove a sort function returns a sorted permutation — and still ship a bug if your spec forgot to say "permutation" and the function returns a sorted list of zeros. You can verify a cache "never returns stale data" against a spec that quietly assumed single-threaded access. The proof is valid; the spec was a lie.

The second failure mode is **unmodeled reality**. A proof reasons about the model you wrote, not the silicon you run on:

- **Timing side channels**: a constant-time-*looking* algorithm proven functionally correct can still leak the key through timing. The functional spec says nothing about cycle counts.
- **Power / EM side channels**: the proof models bits, not watts.
- **Spectre / microarchitecture**: speculative execution leaks across boundaries the architectural model treats as airtight. Years of verified isolation said nothing about it, because the ISA-level model didn't include the microarchitecture.
- **Violated environmental assumptions**: seL4's "no MMU-bypassing DMA," a contract's "the oracle is honest," a protocol's "the clock drift is bounded."

> **Key insight:** A proof converts "is the code correct?" into "is the *spec* correct, are the *axioms* true, and is the *TCB* sound?" — three usually-easier questions, but not zero questions. The proof never eliminates doubt; it *relocates* it to the spec and the assumptions, where it is smaller and more visible.

And here is the lesson that flips most engineers' intuition: **the largest single benefit of formal methods is usually the specification discipline and the design-time bug-finding, not the proof.** Writing a precise spec forces you to answer questions ("what happens on a concurrent retry during reconfiguration?") that prose design docs let you dodge — and answering them surfaces design bugs before any code exists. This is the explicit AWS finding (Concept 7 of Newcombe et al.): most of their value came from *modeling the design in TLA+ and running TLC*, frequently **without ever attempting a full proof**. The model checker found the bugs; the act of specifying found the rest. The proof, where they even wanted one, was the smaller prize.

---

## Core Concept 6 — Assurance Cases and Certification Credit

In regulated domains, FM is never sold as "we proved it correct, ship it." It is one strand of evidence in a structured **assurance case** (or **safety case**): a documented argument that descends from a top-level claim through sub-claims to evidence, designed to convince an auditor and survive scrutiny.

A sketch of how a fragment of such a case is shaped:

| Element | Example content |
|---|---|
| **Top claim** | "The flight-control function is acceptably safe for its DAL." |
| **Sub-claim A** | "The control law meets its requirements." → *evidence:* requirements review + **formal verification of the model** (DO-333 credit) |
| **Sub-claim B** | "The code implements the model." → *evidence:* model-based dev + **formal property proofs** replacing some test objectives |
| **Sub-claim C** | "Unverified assumptions hold." → *evidence:* hardware qualification, integration test, environmental analysis |
| **Sub-claim D** | "The TCB (compiler/tools) is trustworthy." → *evidence:* qualified tools (DO-330) |
| **Counter-evidence** | Known gaps: side-channel exposure, unmodeled fault modes — argued residual-risk-acceptable |

How the major standards actually treat FM:

- **DO-178C / DO-333** (avionics software). DO-178C is the baseline; **DO-333 is the Formal Methods supplement** that, for the first time, lets formal verification *substitute for certain testing objectives* at the higher Design Assurance Levels (DAL A/B). FM earns **certification credit** — it is recognized evidence, not a curiosity — but it does not exempt you from the rest of the lifecycle, and you must qualify the FM tools (DO-330).
- **Common Criteria EAL1–7**. The higher Evaluation Assurance Levels demand increasing formality: **EAL5+ expects semiformal** design/specification, **EAL6–7 expect formal** models of the security policy and formally verified design. seL4's economic argument was precisely that a *proof* was cheaper than assembling EAL6/7-grade evidence the traditional way.
- **ISO 26262 (automotive ASIL A–D)** and **EN 50128 (rail SIL 0–4)**. Both *recommend* or *highly recommend* formal methods at the top integrity levels (ASIL D, SIL 3/4). The wording is "highly recommended," not "mandatory" — FM is a strongly-blessed option within a structured safety case, weighed against other techniques.

> **Key insight:** In every regulated domain, formal methods are a *tool inside an assurance case*, never a silver bullet that replaces it. The proof discharges specific sub-claims and earns specific, bounded certification credit; the case still has to argue the assumptions, the TCB, the residual risks, and everything FM didn't touch. "We have a proof" is a sentence in the argument, not the argument.

---

## Core Concept 7 — Cost-Effective FM in Practice

The research-vs-industry gap has narrowed enough that several FM patterns are now genuinely cheap — cheap enough to be defaults. A senior should reach for these *before* anything heavyweight.

**Generate-and-verify.** Instead of writing code and then proving it, generate the code from a verified specification so correctness is by construction. **Fiat-Crypto** is the landmark: it generates the field-arithmetic code for elliptic-curve crypto, *proven correct*, and that generated code now runs in **BoringSSL / Chrome's TLS stack** (e.g., Curve25519 / P-256 field ops). You get machine-checked correctness *and* hand-tuned performance, with no per-platform proof rewrite.

**Push-button and bounded tools in CI.** Tools that need no proof scripts and run unattended:
- **CBMC** (bounded model checking for C/C++) — used in AWS's continuous verification of low-level code; it runs in the pipeline and either passes or hands you a concrete counterexample trace.
- **TLA+/TLC** as a CI check on a protocol spec — re-runs the model on every spec change, catching regressions in the *design*.
- These are the rungs that fit a normal engineering cadence: no person-years, just a job in the build.

**Lightweight / refinement types as everyday FM.** A type system is a proof system you already run on every commit. **Refinement types** (Liquid Haskell, F\*, refinement-typed Rust efforts) let you attach lightweight predicates (`{v:Int | v >= 0}`) and have them *checked by SMT* with little ceremony. Rust's borrow checker is the most successful deployment of lightweight FM in history — it proves memory- and data-race-safety for millions of engineers who never think of it as "formal methods."

**The "find a bug fast" adoption pattern.** The reliable way to get organizational buy-in is not a manifesto about correctness — it is *modeling a known-tricky component and surfacing a real bug within the first week*. AWS, MongoDB, and others adopted TLA+ this way: a concrete, embarrassing, expensive-to-have-shipped design bug, found cheaply, before code. Lead with the bug, not the theory.

> **Key insight:** The cheapest, highest-ROI formal methods barely look like formal methods: a type checker, a property test, a bounded model check in CI, a generated-and-verified primitive you adopt off the shelf. Exhaust the rungs that fit your existing pipeline before you budget a single person-month of proof.

---

## Core Concept 8 — The Decision Model and When to Stop

Make the decision explicit. For each component, score five dimensions; the higher the score, the further right on the spectrum it earns.

| Dimension | Question | Pushes toward heavyweight FM when… |
|---|---|---|
| **Blast radius** | Who/what is harmed if it's wrong? | Lives, large irreversible money, foundational security |
| **Reversibility** | Can you patch and recover after a failure? | No — deployed silicon, satellites, immutable contracts |
| **Artifact stability** | How often does it change? | Rarely — a protocol/primitive frozen for years (proof amortizes) |
| **Artifact size** | How big is the thing to verify? | Small — a few thousand lines behind a clean interface |
| **Team capability** | Can the team write and *maintain* the spec/proof? | Yes — or you'll get an abandoned proof that rots |

Run each candidate through this and map it to a rung:

```
risk register entry  ×  blast radius  ×  reversibility  ×  stability  ×  team capability
        │
        ├─ low blast / reversible / churny      → types + property tests           (stop here)
        ├─ high blast / recoverable / stable    → contracts + bounded MC of core   (model, then fuzz)
        ├─ catastrophic / irreversible / stable → deductive or interactive proof of core
        └─ low everything                       → tests; do NOT formalize          (gold-plating)
```

**When to STOP** is as much a skill as when to start. Stop when:
- The next rung's marginal cost exceeds its marginal risk reduction (the knee — Concept 3).
- You're **proving trivia** — verifying code whose failure is cheap and reversible, or re-proving what the type system already guarantees.
- The artifact churns faster than you can re-discharge the proof; the maintenance tax now exceeds the bug cost.
- The spec has become *more complex than the code* — a sign you're modeling the wrong thing, and the spec itself is now the bug farm.
- The team can't maintain it; an abandoned proof gives false confidence, the worst of both worlds.

The trend is your friend here: usable FM is improving fast — **Lean 4 + mathlib** making proof more tractable, **Dafny** and **Verus** lowering the deductive-verification barrier, **Rust verification** efforts, and steady **SMT solver** advances (Z3, cvc5) that shrink the annotation burden. The knee is slowly moving right as the cost of each rung falls. But the decision model doesn't change: price the risk, find the cheapest rung that covers it, and refuse to climb past it.

> **Key insight:** The mark of senior judgement is not enthusiasm for proofs — it is knowing *when not to*. Spending a person-year proving a component whose failure costs an afternoon's hotfix is the same error as shipping a flight-control law with only unit tests, just inverted. Both ignore the `P(failure) × cost(failure)` math.

---

## Real-World Examples

- **AWS — DynamoDB, S3, EBS (TLA+).** Newcombe et al. report TLA+ finding bugs that "would have surfaced only as rare production failures," including a **35-step counterexample** in a DynamoDB replication/fault-tolerance design and subtle bugs in S3 and EBS. The crucial economic detail: most value came from *specifying the design and running TLC*, often **without full proofs** — design-time bug-finding, at the bounded-model-checking rung, not the interactive-proof rung. The cheap rung paid the bills.

- **seL4 (interactive proof, Isabelle/HOL).** ~8,700 lines of C verified with a ~20:1 proof:code ratio, ~20–25 person-years — and an explicit, published list of assumptions (compiler, hardware model, DMA, boot). The rational case wasn't "proofs are good"; it was that the proof was *cheaper than EAL6/7-grade evidence* for a kernel small and stable enough to amortize it. The textbook "verify the core" target.

- **CompCert (interactive proof, Coq).** A C compiler whose optimizing middle/back end is proven to preserve program semantics. Csmith fuzzing found **hundreds of bugs in GCC/Clang and zero miscompilations in CompCert's verified part** — while finding bugs in its *unverified* frontend and runtime. A clean demonstration of both the payoff and the TCB boundary in one project.

- **Fiat-Crypto (generate-and-verify).** Proven-correct field-arithmetic code, generated, now shipping in **BoringSSL / Chrome's TLS**. The model for cost-effective heavyweight FM: pay the proof once, generate fast code for every platform, never rewrite the proof per target.

- **Smart contracts (adversarial + immutable).** The DAO (\$60M, 2016) and Parity multisig (~\$280M frozen, 2017) are the canonical "no patch path + adversary searches the whole input space" case. The blast radius is total and irreversible, which is why formal verification (Certora, K-framework, SMT-based checkers) moved from academic to *table-stakes* for high-value contracts — exactly where the cost-of-failure math demands the right end of the spectrum.

---

## Mental Models

- **Assurance is a purchase, not a property.** You buy `P(failure)` reduction with engineering cost. The question is never "is it correct?" but "is the next increment of assurance worth its price *given this failure's cost*?"

- **Cost of failure sets the knee; the technique doesn't.** Same diminishing-returns curve everywhere; what moves the stop-point is blast radius and reversibility. A web form and a flight computer sit on the same curve at wildly different points.

- **Verify the core, test the rest — and watch the door.** Proofs live in small, stable, high-blast cores behind clean interfaces. The interface is the contract the unverified world must honor; most "the proof didn't help" stories are door-contract violations.

- **The spec is the weak link, and the spec is also the prize.** Every result is "code ⊨ spec, given axioms, modulo TCB." The spec can lie — and the *act of writing it* is where most of the value (design bugs found, ambiguities forced) actually comes from, often before any proof.

- **The cheapest FM doesn't look like FM.** Types, property tests, a bounded check in CI, a verified primitive off the shelf. Exhaust those before budgeting a proof. Reach for Coq only when the cost-of-failure tail is genuinely catastrophic and the artifact is small and frozen.

---

## Common Mistakes

1. **Treating FM as one yes/no decision.** The rungs span ~10⁴× in cost. "Should we use formal methods?" is the wrong question; "which rung does this component's risk justify?" is the right one. The binary framing makes people either reject the cheap-and-always-worth-it rungs or reach for proofs that bankrupt the project.

2. **Optimizing `P(failure)` while ignoring `cost(failure)`.** Verifying a component whose failure is cheap and reversible. The product is small; the proof is gold-plating. Spend the budget where the tail loss is catastrophic.

3. **Trusting the proof and forgetting the spec.** A proof certifies code against *your* spec. A wrong, incomplete, or unstated-assumption spec passes straight through, certified. The proof relocates doubt to the spec; it does not remove it.

4. **Ignoring the TCB and the interface.** Side channels (timing, power, Spectre), unmodeled hardware, a violated environmental assumption (seL4's DMA), an unchecked input crossing the door — any of these defeats a machine-checked proof. The proof's guarantee stops at its assumptions.

5. **Proving what churns.** A proof is a liability re-discharged on every change. Formalizing a fast-moving feature surface spends more on proof maintenance than the bugs ever cost. FM amortizes only over small, stable artifacts.

6. **Selling FM as "we proved it correct."** In regulated domains it's one strand of an assurance case earning bounded certification credit (DO-333, EAL, ASIL/SIL); the case still argues assumptions, TCB, and residual risk. The proof is a sentence in the argument, not the argument.

7. **Skipping the cheap rungs.** The team that won't write property tests or run a bounded model checker in CI — but debates whether to learn Coq — has the spectrum upside down. The cheapest rungs have the best ROI and always pay; exhaust them first.

---

## Test Yourself

1. Write the assurance-economics inequality and explain why the FM decision is dominated by `cost(failure)` rather than `P(failure)`.
2. Two artifacts have identical failure cost: one is 2,000 lines and unchanged for three years, the other is 50,000 lines and churns weekly. Which is the better FM candidate, and which term in the cost model decides it?
3. Name the rungs of the spectrum from cheapest to most expensive, with the claim each makes and one honest limitation of each.
4. The diminishing-returns knee is "the same curve, a different intersection." What moves the intersection, and where does the knee sit for (a) a web form and (b) an avionics control law?
5. Explain "verify the core, test the rest." Why is the *interface* the thing that most often defeats a verified core? Give the seL4 example.
6. State the exact logical shape of any formal result. Which inputs are human-supplied and unproven, and what is the dominant failure mode?
7. AWS got most of its FM value *without full proofs*. From what, then — and what does that say about where FM's value actually lives?
8. Give three concrete "stop" signals — situations where continuing to formalize is the wrong call.

<details>
<summary>Answers</summary>

1. `expected_loss = P(failure) × cost(failure)`; buy FM iff `[P_before − P_after] × cost(failure) − amortized_cost(FM) > 0`. FM lowers `P` but not to zero, and a good test suite also lowers `P` — so the *difference* FM buys on the `P` axis is bounded. What swings the product is `cost(failure)`: when failure is catastrophic/unrecoverable/irreversible, even a small `P` reduction pays many times over; when failure is cheap and reversible, the product is small regardless. Hence the calculus is dominated by cost-of-failure.

2. The **2,000-line, stable** artifact. The deciding term is `amortized_cost(FM)` — proof cost spread over the artifact's life *minus the re-proof tax on every change*. A small, stable artifact amortizes a proof; a large, churny one spends more on proof maintenance than the bugs cost. Size and stability, not failure cost, separate them here.

3. **Types/static analysis** — "these bug classes are absent/flagged"; limit: SAST is usually deliberately unsound (misses bugs). **Contracts + property-based testing** — "no counterexample in N sampled inputs"; limit: sampling, never proves absence. **Bounded MC / lightweight modeling** — "no violation in all reachable model states ≤ bound"; limit: bounded, models the *design* not the code. **Deductive verification (SMT)** — "code meets spec on all inputs"; limit: solver incompleteness/timeouts, spec is yours to get right, loops need invariants. **Interactive proof** — "machine-checked arbitrary theorems"; limit: 10–20:1 cost, brutal maintenance, TCB = kernel + spec + extraction.

4. The intersection moves with **`cost(failure)`** (blast radius + reversibility): the bigger it is, the further right the value axis is stretched and the longer the curve stays above break-even. (a) A web form's knee is at **types + property tests** — a hotfix beats a proof; going further is gold-plating. (b) An avionics control law's knee is far right at **deductive/interactive proof of the core** — the tail loss is catastrophic and irreversible, so proof cost is still positive EV; stopping at unit tests is negligence.

5. Isolate a small, stable, high-blast core (crypto primitive, parser, consensus state machine, bytecode verifier) behind a clean interface, prove it heavily, and surround it with cheaper methods (tests, property tests, types). The interface defeats it because the proof only guarantees the core *given its preconditions and environmental assumptions* — a contract the unverified surroundings must honor. **seL4** assumes a correct compiler, a correct hardware model, correct boot, and *no MMU-bypassing DMA*; an attacker who finds a DMA path defeats a machine-checked kernel without touching the proof.

6. `code ⊨ SPEC, given AXIOMS, modulo TCB`. Three of the four inputs are human-supplied and unproven: the **spec**, the **axioms**, and the **TCB** (solver, compiler, extraction, hardware model). The dominant failure mode is a **wrong or incomplete spec** — the proof faithfully certifies behavior against a spec that didn't say what you meant (plus unmodeled reality: timing/power/Spectre side channels).

7. From **modeling the design in TLA+ and running TLC** — design-time bug-finding at the bounded-model-checking rung — and from the **specification discipline** itself (writing a precise spec forces answers to questions prose lets you dodge). It says FM's value lives largely in the *spec and the design-time bugs it surfaces*, not in the proof; the cheap rung captured most of the benefit.

8. Any three: (a) the next rung's marginal cost exceeds its marginal risk reduction (past the knee); (b) you're proving trivia — failure is cheap/reversible, or re-proving what the type system already guarantees; (c) the artifact churns faster than you can re-discharge the proof (maintenance tax > bug cost); (d) the spec has grown more complex than the code (you're modeling the wrong thing); (e) the team can't maintain the proof (an abandoned proof gives false confidence).

</details>

---

## Cheat Sheet

```
THE MODEL
  expected_loss = P(failure) × cost(failure)
  buy FM ⇔ [P_before − P_after]×cost(failure) − amortized_cost(FM) > 0
  → dominated by cost(failure) [catastrophic/irreversible] and by artifact size+stability

THE SPECTRUM (cheapest → dearest; ~10^4× span)
  types / SAST .............. bug classes absent/flagged   | ~free (often unsound)
  contracts + property tests  no counterexample in N inputs | low (SAMPLING)
  bounded MC / TLA+ / Alloy   no violation, all states ≤ N  | medium (DESIGN bugs)
  deductive (Dafny/SPARK/..)  code ⊨ spec, all inputs       | high (annotation burden)
  interactive (Coq/Isa/Lean)  machine-checked theorems      | very high (10–20:1, person-yrs)

RISK → RUNG
  reversible / cheap / churny      → types + property tests      (STOP)
  costly / recoverable / stable    → contracts + bounded MC core (model, then fuzz)
  catastrophic / irreversible      → proof of the core
  low everything                   → tests only (proving it = gold-plating)

EVERY PROOF =  code ⊨ SPEC,  given AXIOMS,  modulo TCB
  spec can be wrong • axioms can be false • TCB = solver+compiler+extraction+hw model
  unmodeled: timing/power/Spectre side channels, env assumptions (seL4 DMA)

CHEAP FM FIRST
  generate-and-verify (Fiat-Crypto → BoringSSL) • CBMC/TLC in CI
  refinement/lightweight types (Rust borrow check, Liquid Haskell)
  adoption: find a real bug fast, lead with the bug not the theory

STOP WHEN
  past the knee • proving trivia • artifact churns • spec > code in complexity • team can't maintain
```

---

## Summary

- Assurance is **priced risk reduction**: `expected_loss = P(failure) × cost(failure)`, and FM is worth buying only when the expected-loss reduction beats its amortized cost. The decision is dominated by **cost(failure)** (catastrophic / unrecoverable / irreversible) and by the artifact's **size and stability** (proof amortization).
- "Formal methods" is a **spectrum spanning ~10⁴× in cost** — types → property tests → bounded model checking → deductive verification → interactive proof — and the real decision is always *which rung*, never *whether*. seL4 (~20:1 proof:code, ~20+ person-years) and CompCert (zero miscompilations under fuzzing) anchor the expensive end; property tests anchor the cheap.
- **Diminishing returns** flatten every rung; the **knee** (where to stop) moves right as cost-of-failure rises. Same curve, different intersection — a web form stops at property tests, an avionics law climbs to proof.
- **Verify the core, test the rest**: prove a small, stable, high-blast core behind a clean interface; surround it with cheaper methods. The **interface/assumption contract** is where proofs most often fail in practice — seL4's DMA, the spec↔code gap, the extraction TCB.
- **The spec is the weak link**: every result is `code ⊨ spec, given axioms, modulo TCB`, and the spec/axioms/TCB are human-supplied and unproven. The largest benefit is usually the **specification discipline and design-time bug-finding** — the AWS lesson: most value from *modeling*, before and often without full proof.
- In regulated domains FM is **one strand of an assurance case** earning bounded certification credit (DO-333, EAL6–7, ASIL D, SIL 3/4) — never a silver bullet. And the cheapest, highest-ROI FM (types, property tests, CBMC/TLC in CI, generated-and-verified primitives) barely looks like FM; exhaust it first, and know when to stop.

You can now allocate the assurance budget — price the risk, find the cheapest rung that covers it, and refuse to climb past it. The next layer — [professional.md](professional.md) — is about institutionalizing that judgement: building the assurance case, choosing tools across an organization, and operating verified components in production.

---

## Further Reading

- **Newcombe, Rath, Zhang, Munteanu, Brooker, Deardeuff — *"How Amazon Web Services Uses Formal Methods"*** (CACM, 2015). The industrial ROI report: TLA+ at scale, the 35-step DynamoDB bug, and the finding that most value came from modeling the design — often without full proofs.
- **Klein et al. — *"seL4: Formal Verification of an OS Kernel"*** (SOSP 2009) and the comprehensive journal version (with **cost data** and the explicit assumptions list). The canonical "verify the core" case and the EAL-cheaper-by-proof economic argument.
- **Leroy — *"Formal Verification of a Realistic Compiler"* / CompCert** (CACM 2009). A verified C compiler; pair it with the Csmith fuzzing results (Yang et al., PLDI 2011) for the payoff-and-TCB lesson in one project.
- **DO-178C and DO-333 (Formal Methods supplement)** — RTCA/EUROCAE. How avionics certification grants *credit* for formal verification in place of certain test objectives at high DALs; read alongside DO-330 (tool qualification).
- **Hillel Wayne — *"Why Don't People Use Formal Methods?"*** A clear, honest survey of the adoption barriers, the lightweight-vs-heavyweight split, and where the field is genuinely usable today.
- For the next rung of judgement — institutionalizing assurance decisions, tooling at org scale, and operating verified components — see **[professional.md](professional.md)**.

---

## Related Topics

- [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/senior.md) — the bounded-model-checking rung where AWS found most of its value, before any proof.
- [04 — Property & Contract Verification](../04-property-and-contract-verification/senior.md) — the cheap-and-medium rungs: property tests, contracts, and SMT-backed deductive verification.
- [05 — Proof Assistants & Dependent Types](../05-proof-assistants-and-dependent-types/senior.md) — the expensive end (Coq/Isabelle/Lean), its true cost, and the seL4/CompCert milestones.
- [Testing](../../testing/) — the rung below the ladder; "test the rest" is most of every system, and where fast feedback beats proof.
- [Static Analysis & Linting](../../static-analysis/) — lightweight, everyday formal methods: a type system *is* a proof system on the same spectrum.
