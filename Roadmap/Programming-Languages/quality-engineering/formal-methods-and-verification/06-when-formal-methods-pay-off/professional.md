# When Formal Methods Pay Off — Professional Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → When Formal Methods Pay Off
> *The earlier tiers taught you the tools — TLA+, Dafny, Coq, property tests. This page is about the meeting where you decide whether to use any of them, on which component, sold to which skeptic, with what rollout — and how to keep the whole thing from becoming an abandoned proof nobody trusts. This is the capstone: assurance as a portfolio you manage across an org, not a technique you admire.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Assurance Is a Portfolio, Not a Technique](#core-concept-1--assurance-is-a-portfolio-not-a-technique)
5. [Core Concept 2 — Risk → Rung: Where Each Component Lands](#core-concept-2--risk--rung-where-each-component-lands)
6. [Core Concept 3 — The Adoption Playbook That Actually Works](#core-concept-3--the-adoption-playbook-that-actually-works)
7. [Core Concept 4 — Selling It Up and Sideways](#core-concept-4--selling-it-up-and-sideways)
8. [Core Concept 5 — Where It Pays, Across Industries](#core-concept-5--where-it-pays-across-industries)
9. [Core Concept 6 — Keeping It Alive: Living Specs and the Conformance Bridge](#core-concept-6--keeping-it-alive-living-specs-and-the-conformance-bridge)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Deciding where (if anywhere) formal methods fit in an org, selling it, rolling it out, and avoiding the failure modes — as the staff/principal who owns that call.**

Every earlier tier answered "how does this method work?" This one answers the question a staff engineer actually gets paid for: *given finite budget, a skeptical org, and a delivery clock, where do you spend rigor?* The honest default answer for almost every component is "not formal methods" — types, code review, tests, and fuzzing carry the load. The skill is not advocacy; it is **triage**. Knowing that a TLA+ model is two days well spent on a new consensus protocol *and* that a Coq proof of your CRUD service is malpractice are the same skill, pointed in opposite directions.

The trap at this level is bimodal. One failure mode is the engineer who dismisses formal methods wholesale because "academia," and ships the replication bug that a two-day model would have surfaced for free. The other is the convert who decides the codebase will be Verified, picks Coq, and burns a quarter producing a proof of something that didn't need proving while the spec quietly drifts from the code it claims to describe. Both are the same mistake — failing to match the rung to the risk — and avoiding both is the whole job. This page gives you the portfolio model, the rollout that wins teams over, the pitch that survives a VP, and the failure-mode tripwires that tell you a verification effort is rotting. It is the synthesis of everything in this section.

---

## Prerequisites

- **Required:** [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/professional.md), [04 — Property & Contract Verification](../04-property-and-contract-verification/professional.md), and at least the shape of [05 — Proof Assistants & Dependent Types](../05-proof-assistants-and-dependent-types/junior.md). You should know what each rung *claims* and roughly what it *costs*.
- **Required:** You've shipped systems and run at least one design review or RFC process. This is a decision-maker's page; the decisions are organizational.
- **Helpful:** You've been on an incident postmortem for a *design* bug — a race, a split-brain, a permissions hole — not just a typo. That experience is what makes the economics here visceral.
- **Helpful:** You've owned a budget or a headcount conversation and had to defend why effort went where it did.

---

## Glossary

| Term | Meaning |
|---|---|
| **Assurance portfolio** | The org-wide allocation of verification effort across rungs (types → linters → property tests → fuzzing → model checking → deductive proof → full proof), matched to each component's risk. |
| **Rung** | One level on the cost/strength ladder. Higher rungs make stronger claims at higher cost; you climb only as far as the risk justifies. |
| **TCB (Trusted Computing Base)** | Everything a proof *assumes* rather than proves — the spec, the compiler, the hardware model, the SMT solver, unverified glue. "Proven correct" is always *relative to the TCB*. |
| **Spec rot** | A model or contract that has drifted out of sync with the code it describes, so it now certifies a system that no longer exists — false confidence. |
| **Conformance bridge** | The mechanism that keeps code faithful to its spec: property tests, model-based test generation, runtime monitors, refinement proofs. Without it, a spec is just a document. |
| **Living spec** | A specification re-checked in CI as the system evolves; the opposite of a *one-shot* design aid used once and shelved. |
| **Blast radius** | How much breaks, and how badly, if this component is wrong — data loss, money, safety, vs a recoverable glitch. |
| **Reversibility** | How cheaply a defect can be undone after the fact — a rollback vs corrupted data that can't be reconstructed. |

---

## Core Concept 1 — Assurance Is a Portfolio, Not a Technique

The single most important reframe at this level: stop asking "should we adopt formal methods?" and start asking "what is the right *mix* of assurance across our systems?" Verification lives on a ladder of increasing cost and strength (the table in the [section README](../README.md) lays out the rungs), and a mature org spends at **every** rung — but in radically different proportions.

The proportions follow a power law. Almost everything you own gets the cheap rungs, because they're nearly free and catch the bulk of defects:

- **Types** — a type checker *is* a proof system (see [Static Analysis & Linting](../../static-analysis/)); making illegal states unrepresentable is the cheapest formal method there is, and it runs on every save.
- **Linters / SAST** — pattern-level proofs of absence (no null deref here, no SQL injection there) at zero marginal cost.
- **Property-based testing** — "for all inputs satisfying this invariant" without a proof obligation; the gateway drug, and the highest-leverage rung most teams under-use.
- **Fuzzing** — adversarial input generation for parsers, decoders, and anything touching untrusted bytes.

A *thin* slice of components — the ones where a bug is expensive *and* the design is genuinely hard to reason about — justifies climbing higher:

- **Model checking (TLA+/Alloy)** — for the occasional gnarly *design*: a new replication or consensus protocol, a permissions model, a stateful migration. This is the sweet spot for most software orgs, and the AWS story is the proof.
- **Deductive verification (Dafny/Frama-C/Why3)** — for a small set of *core* components where the implementation, not just the design, must meet its spec on all inputs: a crypto primitive, a serializer, a critical state machine.

And a *tiny* set — often zero in a typical product org — justifies the top rung:

- **Full machine-checked proof (Coq/Lean/Isabelle)** — kernels, compilers, crypto libraries that the entire world depends on. seL4 and CompCert, not your billing service.

```
                       components       effort/component
  Types               ████████████████  ▏        ← everything, near-free
  Linters / SAST      ████████████████  ▏
  Property tests      ████████████░░░░  ▎        ← most things; under-used
  Fuzzing             ██████░░░░░░░░░░  ▎        ← anything parsing untrusted input
  TLA+ / Alloy        ██░░░░░░░░░░░░░░  ███      ← the gnarly designs
  Dafny / Frama-C     ▏░░░░░░░░░░░░░░░  ██████   ← the rare core
  Coq / Lean          ·                 ██████████████  ← almost never
```

> **The portfolio principle:** rigor is a budget, and the budget is dominated by the cheap rungs because they have the best ROI. Formal methods *proper* (model checking and up) are a deliberate, sparing investment in the few places where the cheap rungs can't reach — exhaustive reasoning about a state space no test suite can sample. A staff engineer's job is not to maximize rigor; it's to *allocate* it.

---

## Core Concept 2 — Risk → Rung: Where Each Component Lands

How do you decide which rung a given component earns? Three properties, multiplied, predict it better than any gut feel: **blast radius**, **reversibility**, and **stability**.

- **Blast radius** — what's the worst outcome if this is wrong? A rendering glitch is recoverable; *silent data loss* or *money moved twice* or *a patient dosed wrong* is not. The further toward catastrophe, the higher the rung is worth.
- **Reversibility** — can you undo a defect cheaply? A bug behind a feature flag you can roll back in seconds is low-stakes; a bug that **corrupts persistent state you can't reconstruct** is the opposite. Irreversible damage is the strongest argument for design-time proof, because design-time is the only time you can still prevent it.
- **Stability** — does this component change weekly or live untouched for years? A frozen consensus core amortizes a verification investment across its whole lifetime; a UI flow rewritten every sprint will out-churn any heavyweight spec, and the spec will rot (Concept 6).

The combination matters more than any single axis. *High blast radius + irreversible + stable* — a replication protocol, a ledger, a permissions kernel — is the textbook case for climbing past the cheap rungs. *High blast radius but reversible and fast-changing* — say, a checkout UI — is better served by excellent tests and fast rollback than by a model that can't keep up. The decision table in [Decision Frameworks](#decision-frameworks) makes the mapping concrete.

> **The asymmetry that drives the whole field:** formal methods earn their keep precisely where bugs are **expensive to fix late and impossible to fix after the fact**. A design bug found in a TLA+ model costs an afternoon of re-modeling; the same bug found in production costs an outage, a postmortem, possibly corrupted data, and the rewrite anyway. This is the design-time-bug economics that underwrites the entire pitch (Concept 4): you're not buying correctness, you're buying it *early*, when it's cheapest.

---

## Core Concept 3 — The Adoption Playbook That Actually Works

Most formal-methods adoptions fail the same way: a champion announces a Coq initiative, demands a proof obligation on a service nobody finds confusing, and the effort collapses under its own ceremony. The adoptions that *stick* — AWS being the canonical example — follow an almost opposite script. Here it is, in order, because the order is the whole point.

**1. Start lightweight and spec-only.** Begin with TLA+ or Alloy — a *model*, not a code proof. You are reasoning about a *design*, before or alongside the code, with no obligation to prove the implementation. This is the rung with by far the best ROI for a first effort, and it sidesteps the maintenance trap of heavyweight proof entirely.

**2. Pick a real, upcoming, high-risk design.** Not a toy, not a retro of something already shipped and stable. Choose something on the roadmap *right now* whose failure would be expensive and whose correctness is genuinely hard to see by inspection: a new replication scheme, a leader-election change, a multi-tenant permissions model, a tricky online migration. High blast radius + you don't already trust it = where a model earns its first win.

**3. Train on a past incident the method would have caught.** Nothing teaches "we need this" like modeling last quarter's split-brain outage and watching the checker spit out the exact 14-step interleaving that caused it. A real scar makes the abstract concrete and converts skeptics faster than any tutorial.

**4. Get a fast, visible win — find a real bug in week one.** This is the AWS pattern: their teams found *serious* bugs in DynamoDB, S3, and lock services that had survived design review, deep testing, and senior scrutiny. A model that surfaces a genuine design defect in the first week pays for itself immediately and gives you the artifact you need for the pitch. Optimize ruthlessly for that early win.

**5. Keep models small.** A model is a deliberate *abstraction*, not a transcription of the code. Model the protocol, not the JSON. Small models check fast, stay readable, and resist rot. The instinct to model everything is the instinct that kills adoption.

**6. Embed in design review and RFCs.** Make a TLA+ model a normal, expected artifact for *high-risk designs* — a section in the RFC template, not a heroic side quest. Normalization is what turns a one-person enthusiasm into an org capability that outlives the champion.

**7. Escalate to proof only for the rare core.** *After* lightweight modeling is paying off, and *only* for the handful of components that genuinely need implementation-level guarantees, consider Dafny or Frama-C — and reserve Coq/Lean for the near-mythical case of a kernel or compiler or crypto primitive. Escalation is the exception you earn, not the plan.

```
LIGHTWEIGHT, SPEC-ONLY  →  real high-risk design  →  find a bug week 1
        →  keep models small  →  embed in RFCs  →  (rarely) escalate to proof
```

> **Why this order beats "let's prove everything":** it front-loads value (a real bug, fast), minimizes cost (modeling, not proving), and builds the political capital you need before asking anyone to fund the expensive rungs. The "prove everything in Coq" plan front-loads *cost*, delivers value late if ever, and burns the org's patience before producing a single shipped win. One of these scripts has a decade of AWS evidence behind it; the other has a graveyard of abandoned `.v` files.

---

## Core Concept 4 — Selling It Up and Sideways

A staff engineer doesn't just decide; they *fund* the decision by convincing managers, peers, and skeptics. Four arguments do the work.

**The design-time-bug economics.** This is the foundation. The cost of fixing a defect rises by orders of magnitude the later it's caught: a flaw caught in a model is an afternoon; caught in code review, a day; caught in production, an outage plus a postmortem plus the fix plus possibly unrecoverable data. Formal methods are the *earliest* place to catch *design* bugs — earlier than any test, because there's no code yet. Frame the spend as "buying the cheapest bugs," and the economics sell themselves.

**The courage to optimize safely.** This is the AWS argument that surprises people. Newcombe et al. report that the biggest *unexpected* benefit of TLA+ wasn't finding bugs — it was the **confidence to make aggressive optimizations** to complex code without fear of subtly breaking it, because the model told them whether the optimized design still held its invariants. A formal model is a *safety net for change*, not just a bug net. Teams move *faster* on hard systems with it. That reframes FM from "slow and careful" to "fast and bold, safely."

**Risk management, not academic purity.** Drop the words "proof" and "correctness" in the executive room; speak in the language of risk, blast radius, and incident cost. Formal methods are an insurance instrument: you pay a known, bounded premium (engineering days) to buy down a low-probability, high-severity tail risk (a data-loss-class design bug). That framing lands with people who allocate budget; "mathematical rigor" does not.

**Honesty about "proven."** This is the integrity test, and getting it wrong poisons trust for years. *Never* let a stakeholder walk away believing "proven = infallible." Every guarantee is **relative to its TCB** — the spec, the compiler, the solver, the assumptions, the unverified glue. seL4 is proven *assuming* its hardware model and a small assembly TCB; CompCert's proof covers the compiler *given* the semantics it's stated against. The honest pitch is: *"This eliminates an entire class of design bugs, with these explicit assumptions; it does not make the system magically bug-free, and here's exactly what we're still trusting."* Overselling is how a verification program loses its credibility the first time a bug slips through the TCB — and one such incident can end the program.

> **The pitch in one breath:** "For our handful of highest-stakes, hardest-to-reason-about components, a small modeling investment buys down catastrophic-class design risk *and* gives us the confidence to keep optimizing them aggressively — for the price of a couple of engineer-days, with assumptions we'll state plainly." That sentence is risk management, it's honest about the TCB, and it's fundable.

---

## Core Concept 5 — Where It Pays, Across Industries

Abstract ROI arguments convince no one; concrete precedent does. Here is where formal methods *demonstrably* earn their keep in industry, organized by the rung each domain reaches for.

**Distributed protocols — model checking (TLA+/Alloy).** The flagship, most-replicable case for ordinary software orgs. **AWS** uses TLA+ across DynamoDB, S3, EBS, and internal lock services; their CACM paper documents finding subtle, serious bugs — including multi-step interleavings — that had survived every other form of review. **Azure Cosmos DB** specifies its consistency levels in TLA+. **MongoDB** models its replication and consensus. The common thread: *concurrent and distributed designs whose bug-space no test suite can enumerate.* If your org builds replication, consensus, leader election, or distributed transactions, this is your entry point.

**Kernels, compilers, crypto — full proof (Coq/F\*/Lean).** The rare top rung, reserved for foundational software the world stands on. **seL4** (Klein et al.) is a microkernel with a machine-checked proof of functional correctness down to the C, plus security properties. **CompCert** (Leroy) is a C compiler proven to preserve program semantics — no miscompilation. **Fiat-Crypto** generates *proven-correct* field-arithmetic code that ships in BoringSSL and curve25519 implementations. **HACL\*** (Project Everest) is a verified crypto library deployed in Firefox and the Linux kernel. You will almost certainly *consume* these rather than produce one — but they're the existence proof that the top rung is real and shipping.

**Regulated assurance — aerospace, rail, automotive, medical.** Here formal methods are often *mandated*, not optional. DO-178C (avionics) credits formal methods as a verification means under DO-333; EN 50128 (rail) and ISO 26262 (automotive) recognize them for the highest integrity levels; IEC 62304 governs medical-device software. Paris Métro Line 14 and other transit signaling were built with the **B-method**. In these domains the deliverable is an *assurance case* — an auditable argument that the system meets its safety requirements — and formal proof is one of the strongest pieces of evidence you can put in it.

**Smart contracts — deductive verification and SMT.** Money-on-chain is irreversible by construction, which makes design-time verification unusually compelling. **Certora** verifies contract properties for major DeFi protocols; the **Move Prover** verifies Move modules; **K-framework** semantics underpin EVM verification. Reversibility is near-zero and blast radius is denominated directly in dollars — exactly the risk profile (Concept 2) that justifies climbing the ladder.

> **Read the pattern, not the logos:** every one of these is *high blast radius × low reversibility × high stability* — distributed correctness you can't test exhaustively, foundational code the world depends on, regulated safety, or irreversible money. That's the signature. When *your* component matches it, you have precedent; when it doesn't, the cheap rungs are almost certainly the right answer.

---

## Core Concept 6 — Keeping It Alive: Living Specs and the Conformance Bridge

A verification effort can be technically successful and still fail, because the artifact decays or was never connected to the code in the first place. Two questions decide whether your investment keeps paying or quietly turns into a liability.

**Living spec vs one-shot design aid.** Be explicit, up front, about which one you're building — they have opposite economics:

- A **one-shot design aid** is a TLA+ model written to vet a design *before* implementation, then deliberately retired once the design is settled. Its value is fully realized at design time; nobody is expected to maintain it, and that's fine. Most TLA+ models should be this. Say so, so no one mistakes the shelved model for a living guarantee.
- A **living spec** is re-checked in CI as the system evolves — appropriate for a *core protocol that keeps changing* and must stay correct across versions (a consensus implementation under active development, a permissions model that grows). It needs an **owner**, a CI hook, and a budget for upkeep. Living specs are powerful and *expensive*; reserve them for the rare component whose churn *and* stakes both stay high.

The catastrophic middle case is the **accidental zombie**: a model written as a one-shot, never retired, never maintained, that the org starts treating as a living guarantee. It now certifies a system that no longer exists — **spec rot** — and it's *worse than no spec*, because it manufactures false confidence. Decide the model's lifecycle deliberately; don't let it default into a zombie.

**The conformance bridge.** A proof or model guarantees something about *the spec*; it says nothing about whether your *code* still matches that spec. Closing that gap is the conformance bridge, and without it even a perfect proof is just a nicely typeset document:

- **Property-based tests** derived from the spec's invariants — the spec's properties, checked against the real implementation (see [04](../04-property-and-contract-verification/professional.md) and [Testing](../../testing/)).
- **Model-based testing** — generate test sequences from the TLA+/model state machine and run them against the code, so divergence shows up as a failing test.
- **Runtime monitors / assertions** — encode spec invariants as runtime checks that fire in staging or production when reality violates the model.
- **Refinement proofs** — the heavyweight bridge: prove the implementation *refines* the spec (the seL4 approach), so conformance is itself machine-checked.

> **The line that should be on a sticker:** *"We have a spec" is not "we are safe."* Safety requires the spec to be (a) the *right* spec — it verifies the property that actually matters — (b) *connected* to the code via a conformance bridge, and (c) *kept current* if the system evolves. A spec without those three is decoration, and a *drifted* spec is an active hazard. The bridge is what turns a verification artifact into an ongoing guarantee.

---

## War Stories

**The week-one model that won the team over.** A platform team was building a new multi-region replication scheme and a senior engineer spent two days writing a small TLA+ model of the protocol — over mild eye-rolling from peers who'd "already reviewed the design." TLC found a data-loss interleaving on the third run: under a specific failover-during-reconfiguration sequence, an acknowledged write could be dropped. It was a handful of steps no one had pictured at the whiteboard, and it would have been near-impossible to reproduce in a test. The fix was a design change made *before any code shipped*. The eye-rolling stopped; a TLA+ section became standard in the team's RFC template. This is the AWS pattern in miniature — small model, real design bug, fast visible win, normalization.

**The heavyweight proof that stalled on maintenance.** A team, energized by seL4, decided a critical-but-actively-evolving service would be *verified in Coq*. The initial proof took a quarter and was genuinely impressive. Then the service kept changing — as services do — and every feature broke the proof, forcing days of proof repair for changes that took hours to code. The proof-maintenance tax dwarfed the feature work. Within two quarters the proof was marked "temporarily skipped," then silently abandoned; the `.v` files rotted in the repo as a monument. The lesson wasn't "Coq is bad" — it was that **heavyweight proof on a fast-churning component is a maintenance commitment nobody had budgeted**, and the component's *instability* (Concept 2) doomed it from the start. Dafny on a small frozen core, or TLA+ as a one-shot, would have delivered most of the value at a fraction of the upkeep.

**The "verified" component that failed because the spec was wrong.** A serializer carried a verified round-trip property — `deserialize(serialize(x)) == x` — and the team trusted it completely. A nasty production bug landed anyway: the spec said nothing about *backward compatibility across schema versions*, and an old consumer choked on a new producer's output. The proof was sound; it just **proved the wrong thing**. The verified property was real but *insufficient*, and "it's verified" had shut down the very design scrutiny that would have caught the missing requirement. The lesson: verifying the wrong property is its own failure mode, and a green proof can *suppress* the questioning that finds the gap. Honesty about what a proof does and doesn't cover (Concept 4) is the antidote.

**The two-day model that nobody wrote.** A team shipped a consensus-adjacent change on a tight deadline. A staff engineer suggested a quick TLA+ model first; it was waved off as "we don't have two days." The change had a leader-election edge case — two nodes could briefly both consider themselves leader under a particular partition-and-rejoin timing — that caused a split-brain and a multi-hour production outage, data reconciliation, and a postmortem whose top action item was, verbatim, "model state-machine changes to consensus before shipping." The two days they didn't spend cost far more than two days. The asymmetry of Concept 2, paid in full.

**Dafny on the core over a doomed prove-everything plan.** A crypto-handling team wanted assurance and the loudest voice wanted *everything* proven in Coq. The staff engineer scoped it down hard: identify the one genuinely critical primitive — a small, *stable* state machine handling key material — and verify *just that* in Dafny, while everything around it leaned on property tests and fuzzing. The Dafny effort fit in a sprint, found two real edge-case bugs via the SMT solver, and — crucially — was *maintainable* because the core didn't churn. The prove-everything plan would have consumed the quarter and shipped nothing. Right rung, right component, right tool: the whole discipline in one decision.

---

## Decision Frameworks

**The assurance portfolio — which rung for which component:**

| Component profile | Rung to reach for | Why |
|---|---|---|
| Ordinary CRUD / UI / glue | Types + linters + tests + (some) property tests | Cheap rungs dominate ROI; higher rungs are waste here |
| Anything parsing untrusted input | Add fuzzing | Adversarial inputs find what examples miss |
| New distributed/concurrent *design* (replication, consensus, locking) | TLA+ / Alloy model (one-shot) | Exhaustive design-time reasoning over a state space tests can't sample |
| Permissions / authorization model | Alloy or TLA+ | Subtle reachability of "who can do what" |
| Small, *stable*, critical implementation (crypto, serializer, core state machine) | Dafny / Frama-C / Why3 | Implementation-level guarantee on a component that won't churn |
| Foundational software the world depends on (kernel, compiler, crypto lib) | Coq / Lean / Isabelle / F\* | Only the top stakes justify the top cost — almost never *you* |

**Risk → rung mapping (blast radius × reversibility × stability):**

| Blast radius | Reversible? | Stable? | Recommended rung |
|---|---|---|---|
| Low (recoverable glitch) | Yes | Any | Tests + types; stop here |
| High (data loss / money / safety) | Yes (fast rollback) | Churns fast | Excellent tests + fast rollback; *not* heavyweight FM |
| High | No (irreversible) | Stable | TLA+ model at minimum; consider Dafny on the core |
| Catastrophic (world-class dependency) | No | Frozen | Full proof (the seL4/CompCert tier) |

**Adoption playbook checklist:**

| Step | Done when |
|---|---|
| Start lightweight, spec-only | First artifact is a TLA+/Alloy *model*, not a code proof |
| Pick a real, upcoming, high-risk design | Target is on the roadmap *now*, high blast radius, hard to reason about |
| Train on a past incident | Modeled last quarter's outage and reproduced its counterexample |
| Get a fast, visible win | Found a *real* design bug in roughly week one |
| Keep models small | Model abstracts the protocol, not the implementation detail |
| Embed in design review | TLA+ section is in the RFC template for high-risk designs |
| Escalate to proof only for the rare core | Dafny/Coq used *only* on the handful that need implementation guarantees |

**Living spec vs one-shot — decide before you start:**

| Question | One-shot design aid | Living spec (CI-checked) |
|---|---|---|
| Purpose | Vet a design before/during build | Guard an evolving core across versions |
| Lifecycle | Retired once design settles | Maintained for the component's life |
| Owner needed? | No (retire it) | **Yes** — named owner + CI hook + upkeep budget |
| Right for | Most TLA+ models | The rare high-churn *and* high-stakes core |
| Failure mode | Becoming an unmaintained *zombie* mistaken for a guarantee | Upkeep cost exceeding its value as stakes/churn change |

**FM failure-mode early-warning signs:**

| Tripwire | The failure it signals | Action |
|---|---|---|
| Proof repair takes longer than the feature it follows | Heavyweight proof on a churning component | Drop to TLA+/Dafny or make it one-shot |
| The model hasn't been touched in months but is cited as a guarantee | Spec rot / zombie spec | Retire it explicitly or fund its upkeep |
| "It's verified" ends a design discussion | Verifying the wrong thing; suppressed scrutiny | Re-ask *what property* is proven and what's assumed |
| You're modeling JSON fields / implementation minutiae | Gold-plating; model too big | Abstract up to the protocol |
| Someone reached for Coq on a typical service | Wrong rung / wrong tool | Property tests or Dafny instead |
| No property test / monitor connects spec to code | Missing conformance bridge | Add the bridge or admit it's just a document |

---

## Mental Models

- **Rigor is a budget, allocated by risk.** Your job isn't to maximize verification; it's to spend it where blast radius × irreversibility × stability is highest. Almost everything gets the cheap rungs; a precious few earn the expensive ones.

- **Formal methods buy *early* bugs, the cheapest kind.** You're not purchasing correctness so much as purchasing it at design time, before code exists, when a fix is an afternoon instead of an outage.

- **A model is a safety net for *change*, not just a bug net.** The AWS surprise: the biggest payoff was the courage to optimize hard systems aggressively, because the model said whether the change still held. FM makes you faster on the hard stuff.

- **"Proven" is always relative to the TCB.** Every guarantee assumes a spec, a compiler, a solver, and some glue. Overselling "infallible" is how a verification program loses the room the first time a bug slips through the assumptions.

- **A drifted spec is worse than no spec.** No spec means honest uncertainty; a rotted spec manufactures false confidence. Decide a model's lifecycle deliberately, or it becomes a zombie.

- **"We have a spec" is not "we are safe."** Safety needs the *right* property, a *conformance bridge* to the code, and *currency* as the system evolves. Without all three, the spec is decoration.

---

## Common Mistakes

1. **Treating FM as all-or-nothing.** It's a portfolio, not a religion. The right answer for most components is the cheap rungs; the right answer for a few is a model; the right answer for almost none is Coq. Dismissing it wholesale and adopting it wholesale are the same error.

2. **Verifying the wrong thing.** A green proof of an insufficient property (the round-trip serializer that ignored schema versioning) gives false confidence *and* shuts down the scrutiny that would find the gap. Always re-ask: is *this* the property that actually matters, and what does it leave out?

3. **Gold-plating — proving trivia.** Effort spent proving the easy or unimportant parts is effort stolen from the cheap rungs that protect everything else. Model the protocol, not the JSON; verify the core, test the rest.

4. **Spec rot / the zombie spec.** A model that drifts from the code certifies a system that no longer exists. Decide *one-shot vs living* up front; retire one-shots explicitly; give living specs an owner and a CI hook.

5. **The heavyweight-maintenance surprise.** A Coq proof on a fast-churning component is an unbudgeted maintenance commitment that will be abandoned. Match tool weight to the component's *stability*, not your enthusiasm.

6. **Choosing Coq when Dafny or property tests would do.** Tool weight should track the strength of guarantee the component actually needs. SMT-backed Dafny or a good property-test suite covers the vast majority of cases the convert reaches for Coq to solve.

7. **Skipping the cheap two-day model and shipping the bug.** The most expensive verification is the one you didn't do on a high-risk design. "We don't have two days" routinely costs far more than two days. The asymmetry is real; respect it.

8. **Mistaking "we have a spec" for "we're safe."** Without the *right* property, a conformance bridge, and ongoing upkeep, a spec is a document, not a guarantee — and a stale one is a hazard.

---

## Test Yourself

1. Explain why "should we adopt formal methods?" is the wrong question, and what the right question is. Sketch the rough proportions of the assurance portfolio across rungs.
2. Give the three properties that decide which rung a component earns, and describe the component profile that most clearly justifies climbing past the cheap rungs.
3. Walk the adoption playbook in order. Why does "start lightweight and find a real bug in week one" beat "let's prove everything in Coq"?
4. You're pitching a TLA+ effort to a skeptical VP. Give the four arguments, and state the one thing you must *not* let them believe.
5. Name a concrete industry use of FM at each of three rungs (model checking, deductive verification, full proof), and state the risk signature common to all of them.
6. Distinguish a one-shot design aid from a living spec. What is the "zombie spec," and why is it worse than having no spec at all?
7. A team proudly says a component is "verified." What three follow-up questions do you ask before you believe it's actually safe?

<details>
<summary>Answers</summary>

1. "Adopt FM?" is binary and wrong because assurance is a **portfolio**: the right question is *what mix of rungs across our systems matches each component's risk?* Proportions follow a power law — **everything** gets types/linters/tests, **most** things get property tests, **anything parsing untrusted input** gets fuzzing, a **thin slice** of gnarly designs get TLA+, a **rare core** gets Dafny/Frama-C, and **almost nothing** gets Coq/Lean.
2. **Blast radius** (how bad if it's wrong — irreversible data loss / money / safety at the high end), **reversibility** (can a defect be undone cheaply, or is it corrupted-state-class), and **stability** (frozen core that amortizes the investment vs fast-churning code that will out-run any heavy spec). The clearest case to climb the ladder is **high blast radius × irreversible × stable** — e.g., a replication protocol, a ledger, a permissions kernel.
3. Order: lightweight & spec-only → pick a real upcoming high-risk design → train on a past incident the method would've caught → get a fast visible win (real bug ~week one, the AWS pattern) → keep models small → embed in RFCs/design review → escalate to proof only for the rare core. It beats "prove everything in Coq" because it **front-loads value and minimizes cost**, building political capital before asking for expensive-rung funding; the prove-everything plan front-loads cost, delivers late if ever, and burns patience first.
4. (a) **Design-time-bug economics** — FM catches the cheapest (earliest) bugs, before code exists; (b) **courage to optimize safely** — the model is a safety net that lets you change hard systems aggressively (the AWS surprise benefit); (c) **risk management, not academic purity** — bounded premium in engineer-days to buy down a high-severity tail risk; (d) **honesty about the TCB**. The thing you must NOT let them believe: **"proven = infallible."** Every guarantee is relative to its spec, compiler, solver, and assumptions.
5. **Model checking:** AWS/Azure Cosmos/MongoDB TLA+ for distributed protocols. **Deductive verification:** Certora / Move Prover for smart contracts (also Dafny/Frama-C on critical cores). **Full proof:** seL4 (kernel), CompCert (compiler), Fiat-Crypto / HACL\* (crypto). Common signature: **high blast radius × low reversibility × high stability** — correctness you can't test exhaustively, foundational/regulated/irreversible-money software.
6. A **one-shot** vets a design then is deliberately retired — value realized at design time, no upkeep expected (most TLA+ models). A **living spec** is re-checked in CI as the system evolves and needs an **owner + CI hook + upkeep budget** (the rare high-churn, high-stakes core). The **zombie spec** is a one-shot that was never retired and gets treated as a living guarantee while it rots out of sync — worse than no spec because it manufactures **false confidence** about a system that no longer exists.
7. (a) *What property did you verify — and is it the one that actually matters?* (guards against verifying the wrong thing); (b) *What's the conformance bridge — what keeps the code matching the spec?* (property tests / model-based tests / runtime monitors / refinement); (c) *Is the spec current, and is it one-shot or maintained?* (guards against spec rot). Only "yes" to all three makes "verified" mean "safe."

</details>

---

## Cheat Sheet

```
THE PORTFOLIO (allocate rigor by risk; cheap rungs dominate)
  everything            → types + linters
  most things           → property tests
  untrusted input       → fuzzing
  gnarly DESIGNS        → TLA+ / Alloy   (the FM sweet spot)
  rare stable core      → Dafny / Frama-C / Why3
  world-class dep       → Coq / Lean / Isabelle   (almost never you)

RISK → RUNG  (climb when ALL three are high)
  blast radius (irreversible data/money/safety)
    × reversibility (can't undo)
    × stability (won't churn)

ADOPTION PLAYBOOK (the AWS script)
  lightweight & spec-only → real upcoming high-risk design
    → train on a PAST incident → find a real bug WEEK 1
    → keep models small → embed in RFCs → escalate to proof only for the core

THE PITCH (4 arguments)
  1 design-time bugs are the cheapest bugs
  2 courage to optimize safely (the model is a change safety net)
  3 risk management, not academic purity
  4 HONESTY: "proven" = relative to the TCB, never "infallible"

KEEP IT ALIVE
  decide ONE-SHOT vs LIVING up front (living = owner + CI + budget)
  beware the ZOMBIE SPEC (rotted, mistaken for a guarantee — worse than none)
  build the CONFORMANCE BRIDGE: property tests / model-based tests /
    runtime monitors / refinement  (spec ≠ code without it)

FAILURE MODES (tripwires)
  proof repair > feature work          → wrong rung / churning component
  model untouched but "trusted"        → spec rot
  "it's verified" ends the discussion  → wrong property / suppressed scrutiny
  modeling JSON fields                 → gold-plating
  Coq on a normal service              → wrong tool
  no test/monitor links spec to code   → no conformance bridge
```

---

## Summary

- **Assurance is a portfolio, not a technique.** Stop asking "adopt FM?" and start *allocating rigor by risk*: everything gets the cheap rungs (types, linters, property tests, fuzzing), a thin slice of gnarly designs gets a model, a rare core gets deductive verification, and almost nothing gets full proof.
- **Risk decides the rung.** Multiply **blast radius × reversibility × stability**. *High blast radius × irreversible × stable* is the signature that justifies climbing the ladder; *reversible and fast-changing* is better served by great tests and fast rollback.
- **The adoption playbook that works** is the AWS script: start lightweight and spec-only, pick a real upcoming high-risk design, train on a past incident, *get a real bug in week one*, keep models small, embed in RFCs, and escalate to proof only for the rare core. "Prove everything in Coq" is the anti-pattern.
- **Sell it as risk management.** Lead with design-time-bug economics and the *courage to optimize safely*; speak the language of risk, not purity; and be **honest that "proven" is relative to the TCB** — overselling infallibility is how the program loses trust.
- **Where it pays is a recognizable pattern:** AWS/Azure/MongoDB TLA+ for distributed protocols; seL4/CompCert/Fiat-Crypto/HACL\* for kernels, compilers, and crypto; aerospace/rail/automotive/medical assurance cases; smart-contract verification — all *high blast radius × low reversibility × high stability*.
- **Keep it alive or it becomes a liability.** Decide *one-shot vs living* deliberately, fear the **zombie spec** (a rotted model mistaken for a guarantee — worse than none), and build the **conformance bridge** (property tests, model-based tests, runtime monitors, refinement) that keeps code faithful to spec — see [04](../04-property-and-contract-verification/professional.md) and [Testing](../../testing/). *"We have a spec" is not "we are safe."*

This closes the Formal Methods & Verification section. The earlier topics gave you the ladder — specification, model checking, TLA+, contracts, proof assistants. This capstone gives you the judgment that makes the ladder pay: **match the rung to the risk, win the org with a fast lightweight victory, sell it honestly as insurance, and keep the spec connected to the code.** Used that way, formal methods stop being an academic curiosity and become what they are at AWS and seL4 — a sharp, sparing, high-leverage tool for the few places where being *almost* right is catastrophic.

---

## Further Reading

- Newcombe, Rath, Zhang, Munteanu, Brooker, Deardeuff — [*How Amazon Web Services Uses Formal Methods*](https://www.amazon.science/publications/how-amazon-web-services-uses-formal-methods) (CACM 2015). The foundational industrial case study: real bugs found, and the "courage to optimize" benefit.
- Hillel Wayne — [*Why Don't People Use Formal Methods?*](https://www.hillelwayne.com/post/why-dont-people-use-formal-methods/). The clearest survey of the adoption barriers and where lightweight FM actually fits.
- Klein et al. — [*seL4: Formal Verification of an OS Kernel*](https://sel4.systems/) (SOSP 2009). The top rung, shipped: a machine-checked kernel and an honest account of its TCB and cost.
- Leroy — [*Formal Verification of a Realistic Compiler*](https://compcert.org/) (CompCert, CACM 2009). A C compiler proven to preserve semantics — the canonical verified-compiler milestone.
- For the rung-by-rung detail behind these decisions, revisit [03 — TLA+](../03-tla-plus-and-temporal-logic/professional.md), [04 — Contracts & Property Verification](../04-property-and-contract-verification/professional.md), and [05 — Proof Assistants](../05-proof-assistants-and-dependent-types/junior.md).
- Then consolidate the whole section for hiring and design-review conversations in [interview.md](interview.md).

---

## Related Topics

- [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/professional.md) — the model-checking rung that anchors most successful adoptions; the AWS sweet spot.
- [04 — Property & Contract Verification](../04-property-and-contract-verification/professional.md) — the practical middle and the property-test half of the conformance bridge.
- [05 — Proof Assistants & Dependent Types](../05-proof-assistants-and-dependent-types/professional.md) — the top rung, its real cost, and why you escalate to it only for the rare core.
- [Testing](../../testing/) — the cheap rungs that carry most of the portfolio and bridge specs to code.
- [Static Analysis & Linting](../../static-analysis/) — types and SAST as the lightweight formal methods you already run on every save.
