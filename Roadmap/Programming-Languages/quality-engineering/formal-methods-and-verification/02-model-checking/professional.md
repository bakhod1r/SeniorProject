# Model Checking — Professional Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → Model Checking
> *The senior page taught you Kripke structures, the product automaton, and why BDDs tamed the state explosion. This page is about deciding — in an RFC review, with a deadline and a skeptical staff engineer across the table — whether a protocol is worth modeling at all, how big to make the model, and what to do when the checker hands you a 35-step counterexample at 2 a.m. that no test on Earth would have produced.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Is This Even a Model-Checking Problem?](#core-concept-1--is-this-even-a-model-checking-problem)
5. [Core Concept 2 — Abstraction Is the Job](#core-concept-2--abstraction-is-the-job)
6. [Core Concept 3 — Bounding the Model and the Small-Model Bet](#core-concept-3--bounding-the-model-and-the-small-model-bet)
7. [Core Concept 4 — The AWS Pattern: Check the Design, Not the Code](#core-concept-4--the-aws-pattern-check-the-design-not-the-code)
8. [Core Concept 5 — Reading and Triaging Counterexamples](#core-concept-5--reading-and-triaging-counterexamples)
9. [Core Concept 6 — Where Model Checking Is Industrial-Standard (and Where It Isn't)](#core-concept-6--where-model-checking-is-industrial-standard-and-where-it-isnt)
10. [Core Concept 7 — Living Models in the Engineering Process](#core-concept-7--living-models-in-the-engineering-process)
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

> Focus: **Applying model checking on real systems and real teams — where the bug is an interleaving, the constraint is engineer-time, and the headline risk is that the model passed but it was the wrong model.**

The senior page framed model checking as an algorithm: build the state graph, explore it exhaustively, report a violating path. At the professional level the algorithm is a commodity — TLC, SPIN, NuSMV, and CBMC all do the exploration for you. What is *not* a commodity is the judgment around it. The questions that decide whether model checking earns its keep are: *Which* of our designs has the kind of bug a checker finds that tests cannot? *What* do we model, at *what* level of abstraction, so the state space stays tractable and the result still means something? *How big* a model is big enough to trip the bug but small enough to terminate this week? And when the checker prints a counterexample, can the engineer reading it tell "real design flaw" from "I mis-specified the property"?

The industrial high-water mark is Amazon's. Newcombe et al. report that TLA+ with the TLC model checker found a bug in DynamoDB's replication and group-membership design that required a **35-step** trace to trigger — a sequence of crashes, retries, and message reorderings that no integration test would ever have stumbled into, and that the designers, who were experienced and careful, had not seen by inspection. AWS now model-checks the *design* of S3, DynamoDB, EBS, and other services *before and during* implementation. That is the whole pitch in one example: a design bug caught in a model is the cheapest bug you will ever fix, because no code, no data, and no customer has touched it yet.

But the same body of experience contains the cautionary half. A model is a *map*, not the territory; it can pass for the wrong reason — the property was vacuous, the bound was too small to reach the bug, the abstraction elided the exact detail that breaks in production. "The model passed but prod broke" is not a failure of model checking; it is a failure of *modeling*, and avoiding it is the craft this page is about. This is the pragmatic, battle-tested layer: model checking as an engineering practice you can defend in a design review, budget for, and integrate into how your team ships protocols.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — Kripke structures, safety vs liveness, LTL/CTL, the product-automaton construction, state explosion, BDDs and partial-order reduction.
- **Required:** You've designed or operated a concurrent or distributed system and debugged at least one bug that only appeared under a specific timing or ordering.
- **Helpful:** You've reviewed an RFC/design doc for a protocol (consensus, replication, leader election, a distributed lock) and had to reason about failure modes by hand.
- **Helpful:** Exposure to TLA+ or property-based testing — even just having read the AWS paper. [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/professional.md) is the natural companion.

---

## Glossary

- **Counterexample (trace):** the concrete sequence of states/steps a checker emits when a property fails — the most valuable output of the whole exercise. A *witness* is the dual: a trace showing a property *can* hold.
- **Abstraction:** deliberately modeling fewer details than reality so the state space is finite and tractable, while preserving the behaviors relevant to the property. The central skill.
- **Bound / model size:** the finite limits you impose — number of processes (`N=3`), queue depth, value domain, BMC unrolling depth `k`. Determines both tractability and what bugs are reachable.
- **Small-model hypothesis (small-scope):** the empirical bet that *most* design bugs manifest in small instances (few processes, small data), so checking a small model catches them despite not being a proof for all sizes. Daniel Jackson's framing for Alloy.
- **Vacuous truth:** a temporal property that "passes" only because its precondition is never satisfied (e.g., `[](req -> <>resp)` when `req` never occurs). A green check that proves nothing.
- **Explicit-state model checking:** enumerate reachable states one at a time, hashing visited states (TLC, SPIN). Great for asynchronous/distributed designs; memory-bound by reachable-state count.
- **Symbolic model checking:** represent *sets* of states symbolically (BDDs, or SAT/SMT formulas) rather than one-by-one (NuSMV/nuXmv). Tames certain combinatorial blowups, dominant in hardware.
- **BMC (bounded model checking):** search for a counterexample of length ≤ `k` by encoding the unrolled transition relation as a SAT/SMT query (CBMC). Push-button, finds shallow bugs fast; says nothing beyond depth `k` unless you prove completeness.
- **Liveness / fairness:** liveness = "something good eventually happens" (progress, termination). It is only meaningful under an explicit **fairness** assumption about which enabled actions eventually run — and unstated fairness is a classic source of false "passes."
- **State explosion:** the exponential growth of reachable states with concurrent components; the perennial enemy and the reason abstraction and bounding matter.

---

## Core Concept 1 — Is This Even a Model-Checking Problem?

The first professional skill is *triage*: recognizing the small class of problems where a model checker finds bugs your other tools structurally cannot, and *not* reaching for it elsewhere. Model checking earns its keep when the bug is **an interleaving or a rare ordering** — a defect that exists only on a specific path through the space of concurrent events.

Tests, even good ones, sample executions. With `N` concurrent actors each able to crash, retry, or have messages delayed/reordered, the number of distinct interleavings is astronomical, and the dangerous one is often *adversarial* — exactly the schedule a fuzzer or a load test is unlikely to hit by chance. A model checker is exhaustive over the model: it tries **every** interleaving up to the bound. That is the entire value proposition. If your bug lives on one path in a billion, exhaustive beats sampling categorically.

The canonical fits:

- **Concurrent/distributed protocols** — consensus (Paxos/Raft variants), replication, leader election, group membership, cache coherence, two-phase commit, distributed locks. The bugs are crash-at-the-wrong-moment, message-reordering, split-brain.
- **State machines with subtle invariants** — a connection/session lifecycle, a payment or order state machine, a lease/expiry mechanism, where "can we ever reach an illegal state combination?" is the question.
- **Security/access protocols** — authn/authz handshakes, token issuance/revocation, capability passing, where an attacker controls ordering and you need "no reachable state grants access without the credential."

The canonical *non*-fits, where you should reach for something else: pure computational correctness on data (use property-based testing or deductive verification), performance, anything dominated by floating-point or rich data values, and UI/CRUD logic whose bugs are not orderings. Reaching for a model checker on a sequential data-transformation function is using a state-space explorer where an assertion or a property test is faster and clearer.

> **The triage instinct:** before modeling anything, ask "is the bug I'm worried about an *interleaving* or a *rare ordering*?" If yes, model checking is in play. If the bug is "wrong output for some input," it almost never is. The second filter is **blast radius**: an interleaving bug in a replication protocol can silently corrupt durable data — that is where exhaustiveness is worth expert weeks; an interleaving bug in a best-effort cache may not be.

---

## Core Concept 2 — Abstraction Is the Job

At scale, the algorithm is free and the *abstraction is the entire skill*. A model is a deliberately impoverished description of your system: you choose what to represent and — far more importantly — what to throw away. Get this wrong in one direction and the state space explodes and the checker never terminates. Get it wrong in the other and the model passes while omitting the very detail that breaks in production. The craft is **modeling the right thing at the right level**: tractable *and* meaningful.

Concretely, abstracting a replication protocol means decisions like these:

- **Model the protocol, not the payload.** Replace actual record bytes with an abstract value (a small set `{v1, v2}` or even a single "the latest write"). The bug you're hunting — a lost or reordered update — does not depend on the bytes; it depends on the *control flow* of writes, acks, and crashes.
- **Model the channel's adversary, not the network stack.** Don't model TCP. Model the *assumptions*: can messages be reordered? duplicated? dropped? Can a node crash between "wrote to log" and "sent ack"? Those choices *are* your threat model, and they're what determines which counterexamples exist.
- **Collapse irrelevant detail.** Timeouts become a nondeterministic "timeout fires" action; wall-clock time rarely belongs in the model. Retries become "send again." A heartbeat interval becomes "node may be suspected."
- **Keep the invariant honest.** The abstraction must still be expressive enough to *state* the property you care about — "every acknowledged write is durable," "no two leaders in the same term." If your abstraction can't even express the bad state, it can't catch it.

The failure mode this guards against is the most dangerous one in the whole discipline: **the model passed because it was wrong.** If you abstracted away crashes, the model will never find a crash-induced bug — and it will smugly report success. A passing model is only as trustworthy as the fidelity of its abstraction to the behaviors that matter.

```
THE ABSTRACTION DIAL
  too concrete                         just right                        too abstract
  ┌──────────────┐              ┌────────────────────┐            ┌──────────────────┐
  │ models bytes,│  state       │ protocol control-  │  passes &  │ elided crashes / │
  │ TCP, real    │  explosion;  │ flow + crash/      │  meaning-  │ reordering; green│
  │ time         │  never ends  │ reorder adversary  │  ful       │ check proves NIL │
  └──────────────┘              └────────────────────┘            └──────────────────┘
```

> **The principle:** *model the behaviors that can produce the bug, abstract everything else to the coarsest form that still lets you state the property.* The art is knowing which details are load-bearing. That judgment — which crash points matter, which orderings the network can produce — is exactly the senior engineer's domain knowledge of the system, encoded. Model checking doesn't replace that expertise; it *amplifies* it by exhaustively exploring the consequences.

---

## Core Concept 3 — Bounding the Model and the Small-Model Bet

Explicit-state checking is finite by construction, which means you must impose **bounds**: how many processes (`N`), how deep a message queue, how large a value domain, for BMC how many steps `k`. These numbers decide two things at once — whether the checker *terminates this week*, and whether the bug is even *reachable* in the model. Both matter, and they pull against each other.

The empirical lifeline is the **small-model hypothesis** (Daniel Jackson's "small-scope" claim for Alloy, echoed throughout the model-checking world): *most* design bugs manifest in *small* instances. If a replication protocol has a lost-update bug, you will usually see it with 3 nodes and 2 in-flight writes — you rarely need 100 nodes to expose a *design* flaw, because the flawed *interaction* involves only a handful of participants. This is what makes bounded, exhaustive checking practical: small models are tractable, and small models catch a surprising fraction of real bugs.

How the numbers actually go in practice:

| Knob | Typical starting point | Why |
|---|---|---|
| Processes `N` | 3 | 2 often can't express the bug (no "third party" to be inconsistent); 3 exposes most asymmetric/split-brain interactions; 4+ explodes state fast for marginal gain. |
| Queue / channel depth | 1–2 | Reordering and in-flight effects appear at depth 2; deeper rarely adds new *design* bugs. |
| Value / key domain | 2–3 distinct values | Enough to express "lost update," "stale read," "two different values" without combinatorial blowup. |
| BMC depth `k` | as deep as the SAT solver tolerates | Finds bugs ≤ `k` steps; the AWS 35-step bug is a warning that *real* bugs can be deep. |

The bet has a sharp edge, and the professional must hold both ideas at once: small models catch most bugs, **and** some bugs only appear at larger scale or longer traces. The DynamoDB bug needed 35 steps — short enough for explicit-state TLC to reach, but a reminder that "I bounded it to 10 steps and it passed" can be a false comfort. The honest stance: a passing bounded model is *strong evidence*, not a *proof*. When the blast radius justifies it, push `N` and `k` until the checker chokes, and *know* that everything beyond the bound is unverified.

> **The discipline:** start small (`N=3`, queue 2) to get a fast, exhaustive answer; that catches most design bugs cheaply. Then, for high-blast-radius protocols, scale up until the tool's limit and document the bound you achieved — "verified exhaustively for N≤4, queue≤3, depth≤40" is a precise, defensible claim. "We model-checked it" without the bound is hand-waving.

---

## Core Concept 4 — The AWS Pattern: Check the Design, Not the Code

The most important industrial lesson from Amazon's experience is *where in the lifecycle* model checking pays: you model the **design**, in the **RFC/spec stage**, *before and during* implementation — not the shipped code after the fact. This is why TLA+/TLC is the canonical industrial tool for distributed systems and why it shows up in AWS's S3, DynamoDB, and EBS work (cross-link [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/professional.md) for the language itself).

The reasoning is pure economics. A design bug found in a model has touched no code, no data, no customer; fixing it means editing a spec. The *same* bug found after launch means an incident, a forensic investigation across a 35-step interleaving you have to reconstruct from logs, a data-corruption blast radius, and a fix that now has to be retrofitted into running systems with migration concerns. Newcombe et al.'s central claim is that this front-loading is *cheaper*, not more expensive, for the class of protocols where subtle concurrency bugs are likely — the modeling effort is paid back many times over by the bugs that never reach production.

This reframes model checking from "an expensive verification step" to "a design tool." The TLA+ spec *is* the precise version of the RFC. Writing it forces the designer to make the protocol exact — and that act alone, before the checker runs, surfaces ambiguities and unstated assumptions. Then TLC explores consequences the human can't: the 35-step interleaving, the crash-at-the-worst-moment, the message that arrives after the node that sent it has been declared dead.

> **The pattern, concretely:** in the design-review stage for a new replication/consensus/membership protocol, the deliverable is not just a prose RFC — it's a spec a model checker has chewed on. The reviewer's question shifts from "does this look right?" to "what invariants did you check, with what bound, and what counterexamples did you fix?" That is a categorically stronger review than reading prose and reasoning about failure modes in your head. Model the design; let the checker find what inspection misses.

---

## Core Concept 5 — Reading and Triaging Counterexamples

A model checker's most valuable output is not "PASS." It's the **counterexample**: a concrete, step-by-step trace of how the property breaks. The professional skill is *reading* that trace — and, critically, triaging whether it's a real bug in the design or a bug in your *model or property*.

A counterexample is a sequence of states with the actions that connect them. For an asynchronous protocol it reads like a debugging session you never had to run: "node A writes, crashes before acking; client retries to node B; A recovers with stale state; B and A now disagree on the committed value." TLC and SPIN both give you this trace; SPIN can even replay it in a guided simulation. Learning to read it is learning to read the *story* of the bug.

The triage is the part juniors skip. A counterexample means one of three things:

1. **A real design bug.** The protocol genuinely admits a bad behavior. Fix the design, re-check.
2. **A modeling bug — the model is wrong.** You modeled an ordering the real system can't actually produce, or an action that can't really happen, so the "bug" is an artifact of an over-permissive model. Fix the model, re-check.
3. **A property bug — the spec is wrong.** Your invariant was too strong (it forbids a *legal* behavior) or mis-stated. Fix the property.

Symmetrically, a **PASS** is *also* suspect until you've ruled out the failure modes of success: a **vacuous** property (the precondition never fires, so `[](req -> <>resp)` is trivially true because `req` never happens), a property too *weak* to forbid the bad state, or a **bound too small** to reach the bug. The mature workflow sanity-checks green results: deliberately *inject* a known bug and confirm the checker catches it (your property has teeth), and *check that the antecedent is reachable* (the property isn't vacuous). A green check you haven't interrogated is worth very little.

> **The discipline:** treat every counterexample as a hypothesis with three possible explanations — design bug, model bug, property bug — and don't "fix" the design until you've confirmed it's the first. And treat every PASS as guilty until proven innocent: validate the property has teeth (inject a bug, see it caught) and isn't vacuous (the precondition is reachable). The number of "we proved it correct" claims that were actually "we wrote a property that's always true" is not small.

---

## Core Concept 6 — Where Model Checking Is Industrial-Standard (and Where It Isn't)

A professional needs a calibrated map of where this technique is *table stakes* versus where it's a *narrow specialty*, because that determines whether you can lean on mature tooling and a hiring pool, or whether you're pioneering.

**Hardware / EDA — model checking is industrial-standard.** Since the Pentium FDIV bug (Intel's 1994 floating-point-division defect, a ~$475M write-off), formal verification is *baseline practice* in chip design. **Equivalence checking** (does the gate-level netlist still compute the same function as the RTL after synthesis/optimization?) and **property checking** (assertion-based verification of design properties) are standard steps in every serious silicon flow, with mature commercial tools (Cadence JasperGold, Synopsys VC Formal). Hardware suits symbolic methods (BDDs, SAT) because circuits are finite-state by nature and the cost of a respin or recall dwarfs the verification cost. If you do hardware, model checking is not exotic; it's expected.

**Distributed-systems *design* — model checking (TLA+/TLC) is the established practice at the high end.** AWS, Azure, MongoDB, and others use it for protocols. It's not universal across the industry, but it's a recognized, mature practice for the protocols that justify it, with a real community and literature.

**Software (general code) — narrower, specialized niche.** Software model checking of *implementations* exists and is valuable in critical domains: **CBMC** (bounded model checking of C/C++, used in safety-critical and security contexts, and notably by AWS to verify C code in components like the boot chain) and **CPAchecker** (configurable software verification). The practical pattern is **bounded checks of critical modules**, sometimes wired into CI — not "model-check the whole application." General application code is dominated by data, I/O, and integration concerns where model checking's exhaustiveness over *control state* buys little.

| Domain | Status | Tools / examples |
|---|---|---|
| Hardware (RTL, ASIC, FPGA) | **Industrial-standard** | Equivalence + property checking; JasperGold, VC Formal; post-FDIV baseline |
| Distributed protocol *design* | **Established at the high end** | TLA+/TLC at AWS/Azure/MongoDB; SPIN for protocols |
| Safety/security-critical C/C++ | **Specialized but real** | CBMC, CPAchecker; bounded checks in CI |
| General application/business code | **Rarely worth it** | Prefer property-based testing / assertions / contracts |

> **The map:** if you're in silicon, model checking is the default and the tooling is world-class. If you're designing distributed protocols, it's the proven high-end practice — reach for TLA+. If you're verifying a critical C module, bounded checking (CBMC) in CI is the realistic shape. If you're writing ordinary CRUD/business logic, this is the wrong tool — and knowing that is as professional as knowing when to use it.

---

## Core Concept 7 — Living Models in the Engineering Process

A model checked once and abandoned is a depreciating asset. The protocols that most need model checking — consensus, replication, membership — are exactly the ones that *evolve*: you add a fast path, change a timeout regime, introduce a new role. Each change can reintroduce the class of bug the original model ruled out. The professional integration is a **living model**: a spec that lives next to the design, is re-checked on change, and is treated as part of the protocol's source of truth.

What this looks like in practice:

- **Spec at RFC time.** The design review includes a model and the invariants checked against it (Core Concept 4). The spec is reviewed like code.
- **Re-check on change.** When the protocol changes, the spec changes and is re-run. For bounded checks of critical code (CBMC-style), this can sit in CI as a gate. For design-level TLA+ specs, it's a checklist item on the design-change PR, often run on a beefy machine because explicit-state checking is memory-hungry.
- **Counterexamples become regression cases.** A counterexample the checker found and you fixed is a documented hazard; keep the invariant so a future change can't reintroduce it.
- **Budget the cost honestly.** The cost is *expert time* and *tool learning*, not CPU. TLA+ has a real learning curve; the engineer-hours to build and maintain a faithful model are the actual expense. Weigh that against the payoff: design bugs are the cheapest bugs to fix, and the bug a living model catches *before* a protocol change ships is one you never debug in production.

> **The integration reality:** treat the model as a maintained artifact for *evolving, high-blast-radius* protocols — not a one-off "we model-checked it once in 2019" trophy. The ROI is highest where the protocol changes and the failure is catastrophic. For a stable protocol that never changes, one rigorous check may suffice. The judgment — living model vs one-shot vs not at all — is the staff-level call, and it tracks blast radius × rate-of-change.

---

## War Stories

**The lost update no test could reproduce.** A team built a primary/replica store with a "write to primary, async-replicate, ack on primary durability" path, plus client retries on timeout. Months of integration and chaos tests were green. A TLA+ model of the *design*, with `N=3` and a crash action between "primary persisted" and "ack sent," produced a counterexample in a handful of states: primary persists write `v1`, crashes before acking; client times out and retries `v2` to the newly-elected primary; old primary recovers and its `v1`, never acked, silently overwrites `v2` on re-sync — an **acknowledged write lost**. No test had reproduced it because no test scheduled *exactly* "crash after persist, before ack, then retry, then recover." Exhaustive exploration found it because it tries *every* crash point. The fix was a design change (fence the recovered node / generation numbers); the lesson was that the bug lived on one interleaving in millions, which is precisely model checking's home turf.

**The liveness failure from an unstated fairness assumption.** A distributed lock's safety properties (mutual exclusion — never two holders) checked clean. The team also wanted liveness: "a waiter eventually acquires the lock." The checker reported a counterexample — a cycle where one waiter is *forever* starved while others repeatedly acquire and release. The protocol was *correct* under an assumption nobody had written down: that the scheduler is *fair* to enabled processes. Without an explicit fairness constraint, the model checker — correctly — found the unfair schedule that starves a waiter. This is the textbook liveness trap: liveness is only meaningful under stated fairness, and the discipline of *having to state* the fairness assumption to the checker is itself the value. They added the fairness assumption, re-checked, and — more importantly — now *knew* their liveness guarantee depended on it, a dependency the prose RFC had silently assumed.

**The model that "passed" because the property was vacuous.** A team proudly reported their session-handshake spec verified `[](authenticated => <>access_granted)` — "every authenticated session eventually gets access." Green check, ship it. A reviewer asked the one question that matters: *is `authenticated` ever reachable in your model?* It wasn't — a modeling slip meant the `authenticate` action's guard could never fire, so the implication was **vacuously true** for every state, proving exactly nothing. The model had been a no-op the whole time. The fix was trivial; the lesson was permanent: a green check is worthless until you confirm the property has teeth (inject a bug, watch it fail) and the antecedent is actually reachable. "We proved it" was really "we wrote a tautology."

**The cache-coherence bug found at N=3 that would've been silent data corruption.** A service used a coherence protocol across replicas with an invalidate-on-write scheme. With two replicas, every hand-modeled scenario looked fine. A model with `N=3` and reordered invalidate/ack messages found a 9-step trace where replica C serves a *stale* read because its invalidate arrived after it had already re-fetched and cached the old value — a coherence violation that, in production, would have been intermittent stale reads, i.e., silent data corruption surfacing as "impossible" support tickets. Two replicas literally could not express the bug (no third party to be inconsistent); `N=3` could. It's the concrete case for "start at `N=3`, not `N=2`" — and for exhaustiveness over the message orderings a human reviewer cannot enumerate.

---

## Decision Frameworks

**Is this a model-checking problem? (bug shape × blast radius)**

| Bug shape ↓ / Blast radius → | Low (best-effort, recoverable) | High (durable data, security, money) |
|---|---|---|
| **Interleaving / ordering / crash-timing** | Maybe — assertions + a property test may suffice | **Yes — model-check the design.** This is the sweet spot. |
| **Wrong output for some input** | No — property-based testing | No — property-based testing or deductive verification |
| **Performance / resource** | No — benchmarks, profiling | No — load tests, capacity modeling |
| **Sequential business/CRUD logic** | No — unit/integration tests | No — tests + careful review |

**Explicit-state vs symbolic vs BMC, by problem shape**

| Technique | Best for | Tools | Watch out for |
|---|---|---|---|
| **Explicit-state** | Asynchronous/distributed designs; protocols; rich nondeterminism | TLA+/TLC, SPIN | Memory-bound by reachable states; needs aggressive abstraction |
| **Symbolic (BDD/SAT)** | Finite-state hardware; synchronous designs; large but regular state spaces | NuSMV/nuXmv, JasperGold | BDD blowup on the wrong variable ordering; less natural for async |
| **BMC (bounded)** | Critical code modules; "is there a bug within `k` steps?"; CI gates | CBMC, CPAchecker | Says nothing beyond depth `k` unless you prove completeness |

**How big a model / what bound**

| Question | Default | Escalate when… |
|---|---|---|
| Processes `N` | 3 | high blast radius → push to 4–5 until the tool chokes; document the max reached |
| Queue / channel depth | 2 | the protocol's bug plausibly needs deeper in-flight state |
| Value domain | 2–3 | the property distinguishes more than 3 values |
| BMC depth `k` | as deep as the solver tolerates | remember the 35-step AWS bug: real bugs can be deep |
| When to stop | tool exhausts memory/time | always *record the achieved bound* as the precise claim |

**Model checking vs property-based testing vs proof**

| | Property-based testing | Model checking | Deductive proof |
|---|---|---|---|
| Claim | "no bug found in *N random* inputs" | "no violation in *all reachable states of the model* (bounded)" | "holds for *all* inputs/states, unbounded" |
| Effort | Low | Medium (expert time, tool learning) | High–very high |
| Push-button? | Mostly | Yes, but **bounded** | No — interactive proof |
| Best at | data/value correctness, round-trips | **interleavings, orderings, protocols** | the verified core where cost is justified |
| Blind spot | the input it didn't sample | beyond the bound; the wrong abstraction | the spec being wrong; sheer cost |

> **The "push-button but bounded" trade-off vs proof:** model checking is *automatic* (you don't write a proof) but *bounded* (it checks a finite model). A proof is *unbounded* (all sizes, forever) but *manual* (you discharge proof obligations by hand). For most engineering, "automatic but bounded, with a documented bound" is the right point on the curve — you get exhaustive coverage of the small instances where bugs hide, without the cost of a full proof. Reserve proof for the core where even the small-model bet isn't enough.

---

## Mental Models

- **Model checking is exhaustive where tests are samples.** Its entire edge is trying *every* interleaving up to the bound. Use it precisely when the bug is an ordering a sampler won't hit — and don't use it when the bug isn't.

- **The abstraction is the engineer; the checker is the intern.** Your domain knowledge — which crash points matter, what the network can reorder — *is* the model. The checker just explores the consequences exhaustively. Garbage abstraction in, confident garbage out.

- **A green check is guilty until proven innocent.** A pass can mean "correct," but it can also mean vacuous property, too-weak property, or too-small bound. Validate teeth (inject a bug, watch it fail) and reachability (the precondition fires) before you trust it.

- **A counterexample is a hypothesis, not a verdict.** It means design bug *or* model bug *or* property bug. Diagnose which before you "fix" anything — three teams in ten "fix" a design that was fine and a model that was wrong.

- **Check the design at RFC time — it's the cheapest bug you'll ever fix.** The whole AWS pattern: a bug in a spec has touched no data and no customer. Model the design before the code exists, not the code after the incident.

- **Liveness is meaningless without stated fairness.** "Eventually acquires the lock" only holds under an assumption about the scheduler. Having to *write that assumption down* for the checker is half the value.

- **Bound it, then say the bound out loud.** "We model-checked it" is hand-waving. "Exhaustive for N≤4, queue≤3, depth≤40" is a claim you can defend — and it makes the unverified region explicit.

---

## Common Mistakes

1. **Reaching for a model checker when the bug isn't an interleaving.** It's a state-space explorer; on sequential data-transformation logic a property test or an assertion is faster and clearer. Triage first: *is the bug an ordering?*

2. **Modeling at the wrong level — too concrete or too abstract.** Too concrete (bytes, TCP, wall-clock time) and it never terminates; too abstract (crashes elided) and it passes while omitting the bug. Model the protocol control-flow plus the crash/reorder adversary; abstract the rest.

3. **Trusting a green check without interrogating it.** Vacuous properties, too-weak properties, and too-small bounds all produce a meaningless PASS. Inject a known bug to confirm the property has teeth; confirm the antecedent is reachable.

4. **Starting at `N=2`.** Two participants often can't express the bug — no third party to be inconsistent. Start at `N=3`; many split-brain and coherence bugs are invisible below it.

5. **Forgetting to state fairness, then "proving" liveness.** Without an explicit fairness assumption the checker correctly finds starvation schedules — or, worse, you assume fairness implicitly and "pass" something that only holds under an unstated condition. Make fairness explicit.

6. **Treating the model as a one-off trophy.** The protocols worth modeling are the ones that *evolve*. A spec checked once in 2019 doesn't cover last quarter's fast-path change. Keep living models for evolving, high-blast-radius protocols and re-check on change.

7. **Confusing "model-checked" with "proved."** A bounded model is strong evidence, not a proof. The AWS 35-step bug is the standing reminder that real bugs can be deep — record the bound you achieved and know everything beyond it is unverified.

8. **"Fixing" the design when the counterexample is a modeling artifact.** If you modeled an ordering reality can't produce, the "bug" is in your model. Confirm the trace is *physically possible* before you change the protocol.

---

## Test Yourself

1. Your team is reviewing an RFC for a new leader-election protocol. Make the case (or against) for model-checking it, in terms of *bug shape* and *blast radius*. What's the deliverable you'd want in the review?
2. Explain the "the model passed but prod broke" failure in terms of abstraction. Give a concrete example of an abstraction choice that would cause it.
3. You set `N=3`, queue depth 2, and the checker reports PASS in seconds. Name three distinct reasons this PASS might be worthless, and how you'd rule each one out.
4. Why is `N=2` a poor default for a replication or coherence protocol? What does `N=3` buy you?
5. A checker reports a liveness counterexample (a waiter never acquires a lock). Before changing the protocol, what's the *first* thing you check, and why?
6. Compare explicit-state model checking, symbolic (BDD/SAT) model checking, and BMC by the problem shape each fits best. Which dominates hardware, and which is the realistic shape for critical C code in CI?
7. A counterexample appears. Walk through your triage: what are the three things it could mean, and how do you decide which?
8. What does it mean that model checking is "push-button but bounded," and when does that trade-off favor it over a deductive proof?

<details>
<summary>Answers</summary>

1. Leader election is a **concurrent protocol** whose bugs are **interleavings/orderings** (split-brain, two leaders in a term, crash-at-the-wrong-moment) — the exact shape model checking finds and tests miss — and its blast radius is **high** (two leaders can corrupt durable state). So it's squarely in the sweet spot. The deliverable: a spec (TLA+/PlusCal) with the invariants checked (e.g., "≤1 leader per term"), the **bound** achieved (e.g., `N≤4`), and the counterexamples found and fixed — a categorically stronger review than reasoning about failure modes in prose.
2. A model is an abstraction; if the abstraction *omits the behavior that produces the bug*, the model passes while the real system breaks. Example: abstracting away the **crash point between "persisted" and "acked"** — the model never crashes there, so it never finds the lost-acknowledged-write bug, and reports a confident, wrong PASS. The pass is only as trustworthy as the abstraction's fidelity to the behaviors that matter.
3. (a) **Vacuous property** — the precondition never fires (e.g., `authenticated` unreachable), so the implication is trivially true; rule out by confirming the antecedent is *reachable*. (b) **Too-weak property** — it doesn't actually forbid the bad state; rule out by **injecting a known bug** and confirming the checker catches it (teeth). (c) **Bound too small** — the bug needs more steps/processes than you allowed (cf. the 35-step AWS bug); rule out by pushing `N`/`k` until the tool's limit and documenting it.
4. With `N=2` there's often **no third party to be inconsistent**, so split-brain and coherence bugs literally can't be expressed (e.g., a stale read on a *third* replica). `N=3` exposes asymmetric and split-brain interactions that 2 can't, while staying tractable; 4+ explodes state for marginal gain. Start at 3.
5. **Check whether you stated a fairness assumption.** Liveness is only meaningful under fairness; without it the checker correctly finds an unfair schedule that starves the waiter — that's not a protocol bug, it's a missing assumption. Decide whether the real scheduler is fair, encode that, and re-check. (And now you *know* your liveness guarantee depends on fairness.)
6. **Explicit-state** (TLA+/TLC, SPIN) fits asynchronous/distributed designs with rich nondeterminism. **Symbolic/BDD-SAT** (NuSMV, JasperGold) fits finite-state, synchronous designs — it **dominates hardware** (equivalence + property checking). **BMC** (CBMC, CPAchecker) — "is there a bug within `k` steps?" — is the realistic shape for **critical C code in CI**, finding shallow bugs fast (and saying nothing beyond `k`).
7. A counterexample means one of: (a) a **real design bug** (the protocol admits a bad behavior — fix the design); (b) a **modeling bug** (you modeled an ordering reality can't produce — fix the model); or (c) a **property bug** (the invariant is too strong/mis-stated and forbids a legal behavior — fix the property). Decide by checking whether the trace is *physically possible* (rules in/out a modeling bug) and whether the final state is *genuinely* bad (rules in/out a property bug). Don't change the design until you've confirmed it's (a).
8. **Push-button** = automatic; you don't write a proof, the tool explores the state space. **Bounded** = it only checks a finite model (`N`, `k`, domains), so it says nothing beyond the bound. The trade-off favors model checking when "exhaustive over the small instances where bugs hide, with a documented bound" is good enough — which is most engineering — and you'd rather spend medium effort than the high cost of a full deductive proof. Reserve proof for the core where unbounded, all-sizes correctness is genuinely required.

</details>

---

## Cheat Sheet

```
IS IT A MODEL-CHECKING PROBLEM?
  bug = interleaving / ordering / crash-timing  → YES (esp. high blast radius)
  bug = wrong output for some input             → property-based testing
  bug = performance / resource                  → benchmarks, load tests
  bug = sequential business/CRUD logic          → unit/integration tests

ABSTRACTION (the actual job)
  model: protocol control-flow + crash/reorder adversary + the invariant
  abstract away: payload bytes, TCP, wall-clock time, retries→"send again"
  too concrete → never terminates ; too abstract → passes & proves nil

BOUNDS (start small, then say the bound out loud)
  processes N      = 3      (N=2 can't express split-brain/coherence)
  queue depth      = 1–2    (reordering shows at 2)
  value domain     = 2–3
  BMC depth k      = as deep as the solver tolerates (AWS bug = 35 steps!)
  claim = "exhaustive for N≤4, queue≤3, depth≤40", NOT "we model-checked it"

TECHNIQUE BY SHAPE
  explicit-state (TLA+/TLC, SPIN)   async/distributed designs, protocols
  symbolic BDD/SAT (NuSMV, Jasper)  finite-state HARDWARE (equiv + property)
  BMC (CBMC, CPAchecker)            critical C modules; bounded checks in CI

A GREEN CHECK IS GUILTY UNTIL PROVEN INNOCENT
  vacuous?  confirm the antecedent is REACHABLE
  teeth?    INJECT a known bug, confirm the checker catches it
  bound?    too small to reach the bug? push N/k, record the max

A COUNTEREXAMPLE = HYPOTHESIS (diagnose before "fixing")
  design bug   → fix the design        (trace is physically possible & state truly bad)
  model bug    → fix the model         (you modeled an impossible ordering)
  property bug → fix the property      (invariant too strong / mis-stated)

WHERE IT'S STANDARD
  hardware           → industrial-standard (post-FDIV)
  distributed design → established high-end (AWS/Azure/MongoDB, TLA+)
  critical C/C++     → specialized but real (CBMC in CI)
  general app code   → rarely worth it
```

---

## Summary

- **Triage first.** Model checking earns its keep when the bug is an **interleaving or rare ordering** — the path a sampler won't hit — and the **blast radius** is high (durable data, security, money). On sequential/data bugs, reach for property-based testing or assertions instead.
- **Abstraction is the job.** The algorithm is a commodity; modeling the *right thing at the right level* — protocol control-flow plus the crash/reorder adversary, abstracting the payload and the clock — is the skill. Too concrete never terminates; too abstract passes and proves nothing. *The model passed but prod broke* is a modeling failure, not a model-checking one.
- **Bound it, then say the bound.** Start at `N=3`, queue 2, small value domains — the **small-model hypothesis** says most design bugs show up small. Scale up for high-blast-radius protocols until the tool chokes, and record the achieved bound as your precise claim. The 35-step AWS bug warns that real bugs can be deep.
- **Check the design, not the code.** The AWS pattern: model the protocol in the **RFC stage**, before/during implementation, with TLA+/TLC. A design bug found in a spec is the cheapest bug you'll ever fix — see [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/professional.md).
- **Interrogate every result.** A **counterexample** is a hypothesis — design bug, model bug, or property bug; diagnose before you fix. A **green check** is guilty until proven innocent — rule out vacuity (antecedent reachable) and toothlessness (inject a bug, watch it fail). Liveness means nothing without stated fairness.
- **Calibrate where it's standard.** Hardware: industrial baseline (post-FDIV, equivalence + property checking). Distributed design: the proven high-end practice (TLA+). Critical C: bounded checks (CBMC) in CI. General app code: usually the wrong tool.
- **Keep living models** for evolving, high-blast-radius protocols; re-check on change; turn fixed counterexamples into regression invariants. The cost is expert time, not CPU — and it's paid back by the bugs that never reach production.

You can now wield model checking as an engineering practice — choosing the problem, the abstraction, and the bound, and reading what the checker hands back. The remaining tier — [interview.md](interview.md) — consolidates the topic into the questions that probe whether someone actually understands all of this.

---

## Further Reading

- Newcombe, Rath, Zhang, Munteanu, Brooker, Deardeuff — ["How Amazon Web Services Uses Formal Methods"](https://www.amazon.science/publications/how-amazon-web-services-uses-formal-methods) (CACM, 2015) — the canonical industrial case study; the 35-step DynamoDB bug, the "check the design" pattern, and the honest cost/benefit.
- Holzmann — *The SPIN Model Checker: Primer and Reference Manual* — the explicit-state checker, Promela, and reading/replaying counterexamples; the protocol-verification mindset.
- Lamport — *Specifying Systems* (TLA+) and the TLA+ Hyperbook — the language and logic behind the AWS practice; abstraction, invariants, and temporal properties for concurrent/distributed designs.
- Daniel Jackson — *Software Abstractions* (Alloy) — the **small-scope hypothesis** made concrete; modeling at the right level and bounded exhaustive checking.
- Clarke, Henzinger, Veith, Bloem (eds.) — *Handbook of Model Checking* — the authoritative reference on explicit-state, symbolic, BMC, and abstraction.
- CBMC and CPAchecker documentation — the realistic shape of *software* model checking: bounded checks of critical modules, including AWS's use of CBMC on C components.
- [interview.md](interview.md) — the same material distilled into interview questions that test judgment, not algorithm recall.

---

## Related Topics

- [01 — Formal Specification](../01-formal-specification/professional.md) — writing the precise spec the checker explores; the abstraction and invariants are the same skill, one level up.
- [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/professional.md) — the language and logic behind the AWS practice; PlusCal, TLC, and specifying concurrent/distributed systems.
- [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/professional.md) — the ROI decision this page's triage feeds into; lightweight vs heavyweight, "verify the core, test the rest."
- [Backend → Distributed Systems](../../../../Backend/distributed-systems/) — the protocols (consensus, replication, membership) that are model checking's home turf.
- [Testing](../../testing/) — the sampling techniques model checking complements; property-based testing as the cheaper rung on the same ladder.
