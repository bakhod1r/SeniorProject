# Formal Specification — Professional Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → Formal Specification
> *The senior page taught you what a spec is and how to write one. This page is about getting a real organization to write one — picking the riskiest 5% of designs worth specifying, choosing Alloy or TLA+ by the shape of the question, timeboxing it inside a design review, and selling the practice on the one thing that actually closes the deal: bugs found before a line of code exists.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Pragmatic Thesis: Spec the 5%, Don't Prove the 100%](#core-concept-1--the-pragmatic-thesis-spec-the-5-dont-prove-the-100)
5. [Core Concept 2 — What to Specify: The Blast-Radius Filter](#core-concept-2--what-to-specify-the-blast-radius-filter)
6. [Core Concept 3 — Choosing the Tool by Problem Shape](#core-concept-3--choosing-the-tool-by-problem-shape)
7. [Core Concept 4 — Introducing It Without a Mandate](#core-concept-4--introducing-it-without-a-mandate)
8. [Core Concept 5 — The Spec Lifecycle: Ownership and Fighting Rot](#core-concept-5--the-spec-lifecycle-ownership-and-fighting-rot)
9. [Core Concept 6 — Conformance at Scale: Connecting Spec to Running Code](#core-concept-6--conformance-at-scale-connecting-spec-to-running-code)
10. [Core Concept 7 — Measuring ROI Without the McNamara Fallacy](#core-concept-7--measuring-roi-without-the-mcnamara-fallacy)
11. [War Stories](#war-stories)
12. [Decision Frameworks](#decision-frameworks)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Introducing specification practice into a real org — the judgment of which designs to spec, which tool to reach for, and how to make it stick — not the syntax of any one language.**

The senior page treated formal specification as a skill: how to model a state machine in TLA+, how to express an invariant in Alloy, how refinement relates a spec to an implementation. At the professional level the question is different and harder, because it is organizational: *given a team that has never written a spec, a backlog that is always on fire, and the cultural reflex that "math is for academics," where do you spend the one or two specs of effort you can realistically get, and how do you prove it was worth it?*

The honest answer most staff engineers converge on is that **the highest-ROI formal-methods practice is lightweight specification of a handful of genuinely hard designs — a replication protocol, a permission model, a state machine, a tricky migration — with no proofs at all.** You are not verifying code; you are writing down the design precisely enough that a model checker can find the cases your prose RFC waved past. The selling point is not rigor for its own sake. It is that *the act of making the design precise enough to check surfaces bugs at design time, which is the cheapest place in the entire lifecycle to find them.* This page is about converting that thesis into adoption: what to spec, which tool, how to start without a mandate, how to keep a spec alive, and how to connect it to running code — and how to measure all of it without fooling yourself.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — what a spec is, Alloy and TLA+ basics, invariants vs temporal properties, refinement, the spec–implementation gap.
- **Required:** You have written and reviewed real design docs / RFCs, and have at least once been burned by a design bug that "looked fine in the doc."
- **Helpful:** You have influence over a design-review process, a team's engineering practices, or how an upcoming hard project gets designed.
- **Helpful:** You have read at least one published spec — the TLA+ examples repo, an Alloy model, or Newcombe et al.'s AWS paper — even if you have not written one in anger.

---

## Glossary

- **Lightweight formal methods** — using formal *specification and automatic checking* (model checking) on a model of the design, deliberately stopping short of proving the implementation correct. The "good enough, cheap enough" rung most orgs should target.
- **Spec-only** — writing the precise model and reading it, without even running a checker. Surprisingly valuable: the act of forcing precision finds bugs by itself.
- **Model checking** — exhaustively (or boundedly) exploring a model's reachable states to find a state that violates a stated property; produces a concrete counterexample trace. (Topic [02](../02-model-checking/professional.md).)
- **Blast radius** — how much breaks, and how badly, if this component is wrong: data loss, security breach, fleet-wide outage, silent corruption.
- **Conformance** — evidence that the *running code* obeys the spec: property-based tests derived from spec invariants, model-based testing, or runtime monitors.
- **Spec rot** — a spec that no longer matches the system it describes because the design moved on and nobody updated it. The default fate of an unowned spec.
- **Living spec** — a spec whose checks run in CI and which is maintained as the design evolves; the opposite of a one-shot design aid.
- **McNamara fallacy** — deciding only what's easily measured matters, ignoring the unmeasured (here: counting "design bugs caught" while ignoring the design clarity and shared understanding a spec produces).

---

## Core Concept 1 — The Pragmatic Thesis: Spec the 5%, Don't Prove the 100%

The single biggest reason formal methods stall in industry is that engineers picture the wrong activity. They imagine Coq, dependent types, and a six-month proof of a sorting routine, conclude "not for my job," and walk away. That picture is real (topic [05](../05-proof-assistants-and-dependent-types/professional.md)), but it is the *expensive far end* of a spectrum, and it is not what you should sell.

What you should sell is the cheap near end: **write a precise model of one hard design and let a model checker poke at it.** Newcombe et al.'s "How Amazon Web Services Uses Formal Methods" is the canonical industrial datapoint, and the part to internalize is not that AWS used TLA+ — it is *what they used it for and how much*. They specified the *designs* of S3, DynamoDB, and EBS components — replication, fault-tolerance, consistency protocols — found bugs that required **35 steps** of state transitions to trigger (no human review or test would have found those), and treated it as a design-time activity measured in **days to weeks per spec**, not a verification of the production C++.

The thesis compresses to three commitments:

1. **Spec, don't prove.** Aim for a checked model of the design. Proving the implementation is a separate, far costlier decision you almost never need to make.
2. **The few, not the many.** One genuinely hard component per quarter, not "all new designs." The ROI is wildly nonuniform — concentrated in a tiny fraction of designs (next concept).
3. **At design time, before code.** A spec written *during* the RFC, in parallel with the design doc, is the cheapest bug-finder you have. The same bug found post-launch costs orders of magnitude more.

> **The principle:** formal specification's industrial value is overwhelmingly *finding design bugs before implementation*, not *guaranteeing implementation correctness*. Optimize your adoption strategy for the first; treat the second as a rare, deliberate escalation. Selling "prove everything" guarantees rejection; selling "let's check the one design that scares us" gets a yes.

---

## Core Concept 2 — What to Specify: The Blast-Radius Filter

The whole game is *selection*. Spec the wrong thing — a CRUD endpoint, a stateless transform — and you have spent a week modeling something a unit test covers, confirming every skeptic's prior that this is academic. Spec the right thing and you find a data-loss window before it ships. The filter is **high blast radius × inherent hardness**, and a few categories light up almost every time:

- **Concurrency and distribution.** Anything with interleavings: replication, leader election, distributed locks, cache coherence, two-phase commit, exactly-once delivery. Humans cannot enumerate interleavings; a model checker does it for free. This is TLA+'s home turf.
- **Security and permission models.** IAM/RBAC/ABAC schemes, capability systems, multi-tenant isolation, sharing/ACL logic. The question "can any sequence of grants produce an unintended access?" is a reachability question — Alloy's home turf.
- **Data invariants across a migration or schema change.** Online migrations with dual-writes, backfills, expand/contract. The question "is there an interleaving of old-writer, new-writer, and backfill that loses or corrupts a record?" is exactly a model-checking question, and exactly the kind humans get wrong.
- **State machines with money, safety, or compliance attached.** Payment/order/refund lifecycles, entitlement state, anything where an "impossible" transition is a financial or legal incident.
- **"We argued in the doc and weren't sure."** The strongest signal of all. If a design review produced a long thread that ended in "I *think* that case can't happen," that uncertainty is the bug the spec will either confirm or refute. Specs convert "I think" into "the checker says."

Equally important is the **negative** filter — what *not* to spec: well-understood CRUD, stateless pure functions (property tests are cheaper, topic [04](../04-property-and-contract-verification/professional.md)), UI flows, anything where the cost of being wrong is a quick rollback. Spending formal-methods budget here is how the practice gets a reputation for ceremony.

> **The judgment call:** before committing a spec, ask "if this component is subtly wrong, what is the worst Monday?" If the answer is "a customer's data is silently corrupted" or "a user sees another tenant's records" or "the fleet deadlocks," spec it. If the answer is "we roll back and ship a fix in an hour," don't. Reserve the scarce, high-skill effort for irreversible, high-blast-radius, interleaving-heavy designs.

---

## Core Concept 3 — Choosing the Tool by Problem Shape

The most common first-week mistake is picking the tool you read a blog post about rather than the one that fits the question. The two workhorses of lightweight specification — **Alloy** and **TLA+** — answer different *shapes* of question, and matching them is most of the battle. (TLA+ gets its own deep treatment in topic [03](../03-tla-plus-and-temporal-logic/professional.md).)

| Question shape | Reach for | Why |
|---|---|---|
| "Is this *structure / data model / relationship* sound? Can any *configuration* violate the invariant?" | **Alloy** | Relational logic + bounded SAT search over structures; built to find a counterexample *instance*. Ideal for schemas, ACL/permission models, ontologies, reference-integrity questions. |
| "Is this *concurrent / temporal / protocol* design correct over *time*? Does any *interleaving* break safety/liveness?" | **TLA+ / PlusCal** | Models state *evolving* via actions; checks invariants and temporal properties (eventually, always) across all interleavings. Ideal for replication, consensus, locks, migrations-over-time. |
| "Does this *one function / module* meet a pre/post contract on all inputs?" | **Pre/post contracts, property tests, or Dafny** | You don't need a system model; you need input-space coverage or a deductive check of one unit. Cheapest rung; topic [04](../04-property-and-contract-verification/professional.md). |

A useful heuristic: **Alloy answers "does a bad *state* exist?"; TLA+ answers "does a bad *sequence of states* exist?"** A permission model is usually the former (find one configuration of grants that leaks access). A replication protocol is usually the latter (find one interleaving of messages that loses a write). Many real designs have both faces — an IAM system has a structural model *and* a temporal grant/revoke story — and it is fine to use both, each on the face it fits.

A second axis is **what your team can absorb**. Alloy's "show me a picture of a counterexample" loop is famously approachable and a great on-ramp for structural questions; TLA+ has a steeper notation but unmatched payoff for concurrency. If the riskiest upcoming design is structural, starting with Alloy lowers the cultural cost (Concept 4). If it is a protocol, TLA+ is worth the ramp — that is precisely the case where prose review fails hardest.

> **The pitfall:** forcing the wrong shape. Modeling a static data invariant in TLA+ buries a simple question under temporal machinery; modeling a multi-step protocol in Alloy strains a structural tool into describing traces it wasn't built for. Pick by the question's shape — *state* vs *sequence* — first, and by team readiness second.

---

## Core Concept 4 — Introducing It Without a Mandate

You will almost never get to mandate specs, and you shouldn't want to — a mandate produces compliance specs that rot. You introduce the practice by *demonstrating value on a real problem*, fast, and letting demand pull it in. A playbook that works:

**1. Pick a real, upcoming design's riskiest component — not a toy.** The credibility of the whole effort depends on speccing something the team actually cares about and is nervous about. The "we argued in the doc and weren't sure" thread from Concept 2 is the perfect target. A toy example proves nothing to a skeptic.

**2. Go spec-only first; no proofs, maybe not even a full check.** Your first deliverable is a precise model and the questions it raises. Often you find a bug *just by being forced to write down the state and transitions precisely* — before you ever run the checker. That is the fastest possible win and the best demo.

**3. Timebox hard — days, not weeks.** Announce "I'll spend three days modeling the replication path and report back." A timebox protects against the rabbit-hole failure mode and makes the cost legible to skeptics who fear formal methods are bottomless.

**4. Pair the spec with the design doc / RFC.** The spec is not a separate artifact in a separate world; it lives *next to* the RFC, answers the RFC's open questions, and its counterexamples go straight into the design review. This is the single most important integration move — it makes the spec part of how design already happens, not a new ritual.

**5. Lead the demo with a found bug.** "Writing the spec, I found that this interleaving loses a write — here's the 9-step trace" beats any abstract argument for rigor. A concrete, surprising, *cheap-to-fix-now* bug is the entire sales pitch.

The cultural barriers are predictable; lower them deliberately:

| Barrier | What it sounds like | How to lower it |
|---|---|---|
| Skills / "math is scary" | "I don't have a formal-methods background." | Start with Alloy's visual counterexamples; train on a *real past incident* re-modeled, so the math attaches to something familiar. |
| Perceived cost | "This will take months." | Timebox to days; show spec-only wins; cite AWS's days-to-weeks-per-spec datapoint. |
| "We don't have time" | "We're shipping; no room for this." | Frame as design-time bug-finding that *saves* time vs a post-launch incident; embed in the review you already do. |
| "It won't match the code anyway" | "The spec and code will drift." | Concede the point honestly: spec the *design* to find design bugs; only promote to a living, conformance-tested spec where the ongoing cost is justified (Concepts 5–6). |

> **The adoption truth:** nobody is converted by an argument that formal methods are rigorous. They are converted by watching a spec find, in three days, a bug that would have been a data-loss incident — on a system they care about. Engineer that moment: real component, timeboxed, spec-only, bug-led demo, attached to the RFC.

---

## Core Concept 5 — The Spec Lifecycle: Ownership and Fighting Rot

A spec is code-shaped: it is written, reviewed, and — if you keep it — maintained. The failure mode that discredits the practice for years is the **beautiful spec nobody owns**, which drifts from the system within a quarter and becomes a confidently-wrong document that misleads the next reader. Deciding the spec's *lifecycle* up front is as important as writing it.

**Two legitimate lifecycles — choose deliberately:**

- **One-shot design aid.** The spec's job was to de-risk *this* design. Once the design is settled and the bugs are fixed, the spec has done its work. Archive it next to the RFC for provenance, and **explicitly retire it** — do not pretend it is still authoritative. The value was extracted at design time; demanding ongoing maintenance of every such spec is how you kill the practice with overhead.
- **Living spec.** The component is so central and long-lived (a core consensus protocol, a permission engine) that the spec earns ongoing maintenance: it is updated as the design evolves and **its checks run in CI** so a regression in the design is caught like a failing test. This costs real, recurring effort — reserve it for the small set of components where it pays.

**Ownership and the rot fight, treated as docs-as-code:**

- **Name an owner** — usually the engineer/team that owns the component. An unowned spec is a rotting spec.
- **Link spec to design review.** Any change to the design that the spec covers should touch the spec, the same way an API change touches the API doc. Make "did the spec change?" a review checklist item for that component.
- **Re-run checks in CI for living specs.** A TLA+ model with the TLC checker, or an Alloy model, run on every change keeps a *living* spec honest. (A one-shot spec doesn't need this; that's the point of choosing.)
- **Version it with the code.** The spec lives in the repo, in the same PR flow, reviewed alongside the change it describes. A spec in a wiki is a spec that will rot.
- **Know when to retire.** When a living spec's maintenance cost exceeds the bug-finding value — the design has stabilized, the interleavings are well understood, no check has failed in a year — demote it to an archived one-shot aid. Retiring a spec on purpose is healthy; a graveyard of stale "authoritative" specs is not.

> **The discipline:** decide a spec's lifecycle the day you write it. Most specs should be honest one-shot design aids — extract the bug-finding value, then retire them cleanly. Promote only the few load-bearing specs to *living* status with CI checks and an owner, and accept the recurring cost knowingly. The unforgivable outcome is the third option: an unowned, unmaintained spec that everyone *believes* is current.

---

## Core Concept 6 — Conformance at Scale: Connecting Spec to Running Code

A spec checks the *design*. The implementation can still diverge from it — the spec–implementation gap is real and permanent. For most specs that gap is acceptable, because the spec already paid for itself by catching design bugs. But for the load-bearing components, you want evidence that the *running code* obeys the spec, and there is a ladder of increasingly strong (and costly) ways to get it. This is where formal specification hands off to [04 — Property & Contract Verification](../04-property-and-contract-verification/professional.md) and to [Testing](../../testing/).

**The conformance ladder, cheap to expensive:**

1. **Spec invariants → property-based tests.** Take the invariants you wrote in the spec and assert them as properties over the real code with QuickCheck/Hypothesis-style tests. The spec told you *what* must always hold; property testing checks it on the real implementation over many generated inputs. Cheapest, highest-leverage link; see [property-based testing](../../testing/).
2. **Model-based testing.** Use the spec (or a state model derived from it) as an oracle: generate sequences of operations against the model and the real system in lockstep, and assert they agree. This directly tests that the implementation refines the spec's behavior, and is how teams catch "the code does something the design never allowed."
3. **Runtime monitors / invariant checks.** Compile the spec's safety invariants into assertions or monitors that run in production (or in a soak environment) and fire when reality violates the model. Catches divergence the tests missed, at the cost of running checks live.

Each rung trades cost for confidence, and you climb only as high as the component's blast radius justifies. A one-shot design spec needs *none* of this — its value was design-time. A core replication protocol might warrant all three: spec to find design bugs, property tests to guard the invariants, model-based tests to check refinement, and a runtime monitor on the one invariant whose violation means data loss.

> **The connection that closes the loop:** a spec that never touches the code is still worth it (design bugs are the prize), but for the components that matter most, derive property/model-based tests *from the spec's invariants* so the same precise statements that found design bugs now guard the implementation. The spec becomes the source of truth that both the design review and the test suite point at. Don't build this for every spec — build it for the few where divergence is catastrophic.

---

## Core Concept 7 — Measuring ROI Without the McNamara Fallacy

You will be asked to justify the time. The strongest, most defensible metric is also the simplest:

- **Design bugs caught pre-implementation.** Count the concrete, would-have-shipped defects the spec found before code existed — ideally with the counterexample trace and a sentence on the incident it would have caused. This is the headline number, and it is genuinely cheap value: a design bug caught at the whiteboard costs a fraction of the same bug caught in code review, a tiny fraction of the same bug caught in QA, and a rounding error compared to the same bug as a production incident. The "found bugs *just by writing the spec*" phenomenon — defects surfaced by the act of forcing precision, before the checker even ran — is the cleanest evidence and the best story.

Supporting signals, used carefully:

- **Incidents avoided / averted near-misses.** Hard to prove a counterfactual, but a spec that found a lost-write window *that a prior incident had also hinted at* is a powerful, concrete argument.
- **Design-review velocity.** A precise model can *shorten* the endless "but what about this case?" thread, because the checker answers it. Faster convergence on hard designs is a real, if soft, benefit.
- **Reuse and onboarding.** A maintained spec is executable documentation; new engineers understand the protocol from it. Genuine value, genuinely hard to quantify.

Now the caution. The **McNamara fallacy** — treating only the easily-counted as real — is a live trap here. If you reduce specs purely to "bugs caught," you will under-value (and eventually cut) the specs whose payoff was *shared understanding, a precise design artifact, and an averted argument* rather than a numbered defect. Some of the most valuable specs catch *zero* bugs because the act of writing them forced the team to design it right the first time — and a pure bug-count metric makes those look worthless. Count the bugs because they are the persuasive lever, but state plainly that the spec's full value includes the design clarity and the confidence that a hard component is actually correct — value you choose not to discard merely because it resists a number.

> **The honest ROI story:** lead with "design bugs caught before implementation," because it is concrete, cheap, and persuasive. But explicitly name the unmeasured value — shared understanding, a precise living design artifact, confidence on a high-blast-radius component — so you don't fall into measuring only what's easy and starving the specs whose payoff was prevention, not a defect count.

---

## War Stories

**The payment state machine with an impossible refund.** A team was designing an order/payment/refund state machine and the RFC had the usual boxes-and-arrows diagram everyone nodded at. A staff engineer spent two days modeling it — states (`pending`, `authorized`, `captured`, `refunded`, `voided`) and the events that transition between them — in a small spec, spec-only, attached to the RFC. The checker found a reachable path that issued a refund against a *captured* charge that had already been *voided* by a concurrent cancel — an "impossible," money-losing transition that the diagram simply didn't show because no human traced that interleaving. It was fixed by adding a guard, in the design, before a line of code. Total cost: two days. The bug, post-launch, would have been a double-refund incident with finance involved.

**The Alloy model that caught a privilege escalation.** An org was rolling out a new sharing model — resources, groups, roles, inherited permissions across a hierarchy. The design *felt* right. A principal engineer modeled it in Alloy: signatures for `User`, `Group`, `Resource`, `Permission`, and the inheritance relations, with an assertion that "no user can reach `admin` on a resource they were never granted, directly or transitively." Alloy returned a counterexample instance within seconds: a user added to a group that was *nested* under an admin group inherited admin on resources the team never intended, via a transitive edge nobody had drawn out by hand. A structural privilege-escalation bug, found by a structural tool answering a structural question — "does a bad *state* exist?" — exactly as the tool-shape rule predicts. The fix was a constraint on inheritance depth, made in the design.

**The migration spec that revealed a lost-write window.** A team planned an online migration from an old store to a new one with the standard dual-write-then-backfill approach. The RFC asserted "no writes are lost." A short TLA+ spec modeled three concurrent actors — the old writer, the new writer, and the backfill job — and checked the invariant "every committed write is present in the new store at the end." The checker produced an interleaving where the backfill read a row, the application then updated that same row in the old store, and the backfill's stale copy overwrote the new value in the new store: a classic lost-update window, found as a concrete trace. Because it was caught at design time, the fix (ordering and a version check) cost a paragraph in the RFC instead of a forensic data-recovery effort weeks after cutover.

**The beautiful spec that rotted.** Counter-example, and the most common failure. A team wrote an excellent, thorough TLA+ spec of a core protocol during its initial design — it found bugs, it was celebrated, it went into the repo. Nobody owned it. Over the next two quarters the protocol gained a new message type and an optimization; the spec was never touched. A year later a new engineer read the spec to understand the protocol, implemented against it, and shipped a bug — because the spec described a system that *no longer existed*. The spec had silently become confidently wrong, worse than no spec at all. The lesson the team took: decide the lifecycle up front. Had they declared it a one-shot design aid and archived it as historical, the new engineer would have known not to trust it; had they made it a living spec with an owner and CI checks, it would have stayed true. The unforgivable middle — an unowned spec everyone believed was current — is the one they landed in.

---

## Decision Frameworks

**Should we spec this? (blast radius × concurrency × novelty)**

| Signal | Strong yes | Strong no |
|---|---|---|
| Blast radius if wrong | Data loss, security breach, fleet outage, financial/legal | Quick rollback, cosmetic, easily reversible |
| Concurrency / distribution | Many interleavings; humans can't enumerate them | Single-threaded, stateless, no ordering concerns |
| Novelty / uncertainty | "We argued in the doc and weren't sure" | Well-trodden CRUD with a known shape |
| Reversibility | Irreversible (migration, on-disk format, external contract) | Trivially revertible behind a flag |
| **Verdict** | **Spec it (spec-only first).** | **Don't — a test or a careful review is cheaper.** |

**Alloy vs TLA+ vs pre/post by problem shape**

| The question is about… | Tool | Tells you |
|---|---|---|
| Structure, data model, relationships, permissions ("does a bad *state* exist?") | **Alloy** | A counterexample *instance* / configuration |
| Concurrency, protocols, temporal behavior over time ("does a bad *sequence* exist?") | **TLA+ / PlusCal** | A counterexample *trace* of state transitions |
| One function/module against a contract on all inputs | **Pre/post contracts, property tests, or Dafny** | Coverage of the input space / a deductive check (topic 04) |

**Spec-only vs check vs prove vs conformance-test**

| Goal | Activity | Cost | When |
|---|---|---|---|
| Force design precision, find obvious bugs | **Spec-only** (write & read the model) | Lowest | Always start here; often enough on its own |
| Find subtle interleaving/structural bugs | **Model-check** (TLC / Alloy SAT) | Low–medium | Concurrency/structure designs; the default add-on |
| Guarantee a property holds on all inputs of *one unit* | **Prove** (Dafny / proof assistant) | High–very high | Rare; a security-critical primitive, a core algorithm |
| Show the *running code* obeys the spec | **Conformance** (property/model-based tests, monitors) | Medium, recurring | Only for load-bearing, long-lived components (Concept 6) |

**Keeping a spec alive vs one-shot design aid**

| Factor | Make it a living spec (CI checks, owner) | Keep it a one-shot aid (extract value, retire) |
|---|---|---|
| Component lifespan | Core, long-lived (consensus, permission engine) | The design is settled and won't churn |
| Cost of design drift | Catastrophic if design regresses unnoticed | Low; design is stable |
| Maintenance budget | A clear owner can fund recurring upkeep | No owner can commit to upkeep |
| Conformance need | Code must be checked against it over time | Design-time value already captured |
| **Default** | The *few* load-bearing specs | **Most specs** — and *explicitly* retire them |

---

## Mental Models

- **Spec the 5%, don't prove the 100%.** The ROI of formal methods is wildly concentrated in a few hard, high-blast-radius designs. Find those; model their design; skip the rest. Selling "prove everything" guarantees a no.

- **The best designs to spec are the ones you argued about and weren't sure.** Uncertainty in a design thread is a flashing sign: the checker will either confirm the worry or refute it, and either answer is worth days.

- **Alloy finds a bad *state*; TLA+ finds a bad *sequence of states*.** Permissions and schemas are usually "does a bad configuration exist?" (Alloy). Protocols and migrations are usually "does a bad interleaving exist?" (TLA+). Match the tool to the shape.

- **The act of writing the spec is half the value.** Bugs surface from being *forced to be precise*, often before the checker runs. That is the cheapest bug-finding in the lifecycle, and the best demo.

- **An unowned spec is a rotting spec.** Decide the lifecycle the day you write it: one-shot aid (extract value, retire honestly) or living spec (owner + CI checks). The deadly middle is an unmaintained spec everyone trusts.

- **A spec finds design bugs; tests and monitors find divergence.** The spec checks the design; property/model-based tests and runtime monitors connect it to the running code — but only build that ladder for components where divergence is catastrophic.

---

## Common Mistakes

1. **Trying to prove everything (or pitching it that way).** The path to rejection. Pitch *spec-only checking of one hard design*, not implementation proofs. Reserve proofs for rare, deliberate, security-critical escalations.

2. **Speccing low-blast-radius things to "practice."** Modeling CRUD or a stateless transform confirms every skeptic's belief that this is academic. Always spec something the team is genuinely nervous about.

3. **Picking the tool you read about instead of the one that fits.** TLA+ for a static data invariant, or Alloy for a multi-step protocol, fights the tool. Choose by question shape — *state* vs *sequence* — first.

4. **Not timeboxing.** An open-ended spec effort confirms the fear that formal methods are bottomless. Announce "three days, then I report back," and protect it.

5. **Treating the spec as a separate artifact from the RFC.** A spec that lives in its own world gets ignored. Pair it with the design doc; route its counterexamples into the design review.

6. **Leaving a spec unowned.** The single most common way the practice gets discredited: a celebrated spec rots into confidently-wrong documentation. Assign an owner and decide one-shot vs living up front.

7. **Building conformance machinery for every spec.** Property tests, model-based tests, and monitors are recurring cost; most specs are one-shot design aids that need none of it. Build the ladder only for load-bearing components.

8. **Measuring only bug count (the McNamara trap).** A pure "bugs caught" metric starves the specs whose payoff was *prevention and shared understanding* — including the valuable ones that caught zero bugs because the team designed it right. Count bugs to persuade; name the unmeasured value explicitly.

---

## Test Yourself

1. A teammate says "formal methods means proving code correct, and we don't have time for that." Reframe the pragmatic thesis in two sentences, and name the single most persuasive selling point.
2. Give the filter for deciding *which* designs are worth speccing, and four categories that almost always pass it. What's the strongest single signal that a design needs a spec?
3. You have two upcoming hard designs: a new multi-tenant permission/sharing model, and a leader-election protocol. Which tool fits each, and what is the one-line rule that decides?
4. You want to introduce specs to a team that has never written one and is wary of "math." Outline the five-step introduction playbook and why each step matters.
5. Distinguish a *one-shot design aid* spec from a *living* spec. For each, state who owns it, whether its checks run in CI, and how it should end.
6. A core replication protocol has a spec that found design bugs. How do you connect that spec to the *running code*, and what's the cheapest first rung of that ladder?
7. Your VP asks for the ROI of the specs program. What's the headline metric, and what's the McNamara-fallacy caution you must voice alongside it?

<details>
<summary>Answers</summary>

1. The highest-ROI practice is **lightweight spec-only checking of the few genuinely hard designs** (a protocol, a permission model, a migration) at *design time* — you model the design and let a checker find bugs, you do **not** prove the implementation. The most persuasive selling point is that **it finds design bugs before a line of code exists**, which is the cheapest place in the lifecycle to find them — often surfaced just by being forced to write the design down precisely.
2. Filter: **high blast radius × inherent hardness** — "if this is subtly wrong, what's the worst Monday?" Categories that pass: **concurrency/distribution** (replication, locks, consensus), **security/permission models** (IAM/ACL/multi-tenant isolation), **data invariants across a migration** (dual-write/backfill lost-write windows), and **money/safety/compliance state machines**. Strongest single signal: **"we argued in the doc and weren't sure"** — design-thread uncertainty is the bug the spec will confirm or refute.
3. Permission/sharing model → **Alloy** (a structural "does a bad *configuration/state* exist?" question — find an instance that leaks access). Leader election → **TLA+/PlusCal** (a temporal "does a bad *interleaving/sequence* exist?" question — find a trace that violates safety/liveness). Rule: **Alloy finds a bad *state*; TLA+ finds a bad *sequence of states*** — match by question shape.
4. (1) **Pick a real, upcoming design's riskiest component** — credibility depends on it mattering. (2) **Spec-only first** — fastest win; bugs often appear from precision alone before any checking. (3) **Timebox to days** — protects against the rabbit hole and makes cost legible. (4) **Pair it with the RFC** — makes it part of how design already happens, not a new ritual. (5) **Lead the demo with a found bug** — a concrete, cheap-to-fix-now bug is the whole sales pitch.
5. **One-shot design aid:** de-risks *this* design; owned (loosely) by whoever ran it; **no** CI checks needed; should be **archived and explicitly retired** once the design settles. **Living spec:** maintained as the design evolves; **named owner** (the component team); **checks run in CI** like tests; ends only when maintenance cost exceeds bug-finding value, at which point demote it to an archived aid. The deadly third option is an **unowned spec everyone believes is current**.
6. Climb the **conformance ladder**: (1) turn the spec's invariants into **property-based tests** over the real code (cheapest first rung), (2) **model-based testing** using the spec as an oracle in lockstep with the system, (3) **runtime monitors** of the safety invariants in production. Build only as high as the blast radius justifies — for a core replication protocol, likely all three.
7. Headline: **design bugs caught pre-implementation** — concrete, cheap, persuasive (ideally with the counterexample trace and the incident it would've caused). Caution: the **McNamara fallacy** — don't reduce specs to bug count alone, or you'll under-value (and cut) the specs whose payoff was **shared understanding and a precise design artifact**, including valuable specs that caught *zero* bugs because the team designed it right the first time.

</details>

---

## Cheat Sheet

```
THE PRAGMATIC THESIS
  spec the 5%, don't prove the 100%
  spec-only > model-check > prove          (climb only as far as needed)
  at DESIGN TIME, before code               (cheapest place to find a bug)
  selling point: "found bugs by writing the spec"

WHAT TO SPEC (high blast radius x inherent hardness)
  ✓ concurrency / distribution (replication, locks, consensus)
  ✓ security / permission models (IAM, ACL, multi-tenant)
  ✓ data invariants across a migration (dual-write / backfill)
  ✓ money / safety / compliance state machines
  ✓ "we argued in the doc and weren't sure"   <- strongest signal
  ✗ CRUD, stateless transforms, UI flows, easily-reversible

TOOL BY PROBLEM SHAPE
  bad STATE exists?     -> Alloy   (structure, data model, permissions)
  bad SEQUENCE exists?  -> TLA+    (protocols, concurrency, migrations)
  one unit vs contract? -> property tests / Dafny  (topic 04)

INTRODUCE IT (no mandate)
  real risky component -> spec-only -> timebox (days)
  -> pair with the RFC -> demo a FOUND BUG

LIFECYCLE (decide it day one)
  one-shot aid : extract value, archive, RETIRE explicitly   (most specs)
  living spec  : named owner + CI checks                      (the few)
  deadly middle: unowned spec everyone trusts -> rots         (avoid)

CONFORMANCE LADDER (only for load-bearing specs)
  spec invariants -> property tests   (cheapest)
  spec as oracle  -> model-based tests
  spec invariants -> runtime monitors (live)

ROI
  headline: design bugs caught pre-implementation
  caution : McNamara fallacy — name the unmeasured value
            (shared understanding; specs that caught 0 bugs by design)
```

---

## Summary

- **The pragmatic thesis:** the highest-ROI formal-methods practice for most orgs is **lightweight spec-only checking of the few genuinely hard designs** — a replication protocol, a permission model, a migration — at *design time*, not proving everything. Sell the bug-finding, not the rigor.
- **What to spec is the whole game:** filter by **high blast radius × inherent hardness**. Concurrency/distribution, security/permission models, data invariants across a migration, and money/safety state machines almost always qualify; "we argued in the doc and weren't sure" is the strongest single signal. Don't spec CRUD.
- **Choose the tool by problem shape:** **Alloy** answers "does a bad *state* exist?" (structure, permissions); **TLA+** answers "does a bad *sequence of states* exist?" (protocols, migrations) — topic [03](../03-tla-plus-and-temporal-logic/professional.md). Pre/post contracts and property tests cover single units (topic [04](../04-property-and-contract-verification/professional.md)).
- **Introduce it without a mandate:** real risky component → spec-only → timebox to days → pair with the RFC → lead the demo with a found bug. Lower the cultural barriers by training on a real past incident and showing a cheap win fast.
- **Decide the lifecycle on day one:** most specs are **one-shot design aids** — extract the bug-finding value and *explicitly retire* them. Promote only the few load-bearing specs to **living** status with an owner and CI checks. The unforgivable outcome is an unowned spec everyone *believes* is current.
- **Connect spec to code only where it pays:** for load-bearing components, derive **property-based tests → model-based tests → runtime monitors** from the spec's invariants (Concept 6, cross-linking [04](../04-property-and-contract-verification/professional.md) and [Testing](../../testing/)).
- **Measure ROI honestly:** lead with **design bugs caught pre-implementation** (concrete and persuasive), but name the unmeasured value — shared understanding, a precise design artifact — to avoid the **McNamara fallacy** of starving the specs whose payoff was prevention.

You can now introduce specification as a real organizational practice — selecting the few designs worth it, matching tool to question, starting without a mandate, keeping specs alive, and proving the value. The [interview.md](interview.md) tier consolidates the whole topic into the questions that probe whether someone has actually done this.

---

## Further Reading

- Newcombe, Rath, Zhang, Munteanu, Brooker, Deardeuff — ["How Amazon Web Services Uses Formal Methods"](https://cacm.acm.org/magazines/2015/4/184701-how-amazon-web-services-uses-formal-methods/fulltext) (CACM 2015) — the canonical industrial datapoint: which designs they specced, the 35-step bugs they found, and the days-to-weeks-per-spec economics.
- Daniel Jackson — *Software Abstractions: Logic, Language, and Analysis* — Alloy and the "find a counterexample instance" mindset for structural/data-model/security questions.
- Hillel Wayne — *Practical TLA+* (and [learntla.com](https://learntla.com)) — the working engineer's on-ramp to TLA+/PlusCal and modeling concurrent/temporal designs.
- Lamport — *Specifying Systems* — the authoritative TLA+ reference; deeper than you need to start, essential if a spec becomes load-bearing.
- The [TLA+ examples repository](https://github.com/tlaplus/Examples) and the [Alloy models](https://alloytools.org/) — published specs to read before writing your own; the fastest way to absorb the idioms.
- [interview.md](interview.md) — the same material distilled into interview questions on judgment, tool selection, adoption, and lifecycle.

---

## Related Topics

- [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/professional.md) — the tool for concurrent/temporal/protocol specs; the "bad sequence of states" half of the tool-shape rule.
- [04 — Property & Contract Verification](../04-property-and-contract-verification/professional.md) — the conformance ladder's first rungs: property-based testing and contracts that connect a spec to running code.
- [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/professional.md) — the broader ROI decision this topic's "spec the 5%" thesis feeds into.
- [Testing](../../testing/) — where model-based testing and the conformance side of specification live.
- [Backend → Distributed Systems](../../../../Backend/distributed-systems/) — the protocols (replication, consensus, migrations) that are the prime candidates for specification.
