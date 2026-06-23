# TLA+ & Temporal Logic — Professional Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → TLA+ & Temporal Logic
> *The senior page taught you the language — `[]`, `<>`, `WF`, the next-state relation, how TLC explores states. This page is about pulling those levers inside a real organization, under a deadline, against skeptical engineers and a design that ships next quarter — where "what should I model?" stops being a syntax question and becomes a question about your state-space budget, your incident history, and whether the spec will still match the code in eighteen months.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The AWS Story, In Depth](#core-concept-1--the-aws-story-in-depth)
5. [Core Concept 2 — What to Model (and What to Leave Out)](#core-concept-2--what-to-model-and-what-to-leave-out)
6. [Core Concept 3 — Abstraction & Atomicity at Scale](#core-concept-3--abstraction--atomicity-at-scale)
7. [Core Concept 4 — The Lifecycle of a Spec in an Org](#core-concept-4--the-lifecycle-of-a-spec-in-an-org)
8. [Core Concept 5 — Selling It, and Setting Limits](#core-concept-5--selling-it-and-setting-limits)
9. [War Stories](#war-stories)
10. [Decision Frameworks](#decision-frameworks)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Using TLA+ as a practical engineering tool — judgement about what to model, when to keep a spec alive, how to sell it, and where it stops helping.**

The senior page showed you how TLA+ works. At the professional level the questions change: *Is this design even a TLA+ problem? How coarse can my atomicity be before I model a fiction? Do I check this spec once and throw it away, or wire it into CI for the next five years? How do I convince a skeptical staff engineer that two weeks of "writing math" is cheaper than the outage it prevents? And what, precisely, am I NOT proving when TLC says "no errors found"?*

TLA+ has earned its place by being the most industrially-proven formal method we have. It is not a research curiosity; it found 35-step bugs in DynamoDB, validated risky optimizations at AWS before they shipped, and is in production use at Microsoft, MongoDB, Confluent, and Elastic. That track record is exactly why this tier is the pragmatic one — the gap between "I can write a spec" and "I can deploy specs that pay for themselves on a team" is judgement, and judgement is what this page is about.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — TLA+/PlusCal mechanics, the next-state relation, `[]`/`<>`, fairness (`WF`/`SF`), invariants vs temporal properties, how TLC enumerates states and produces counterexamples.
- **Required:** You've worked on a concurrent or distributed system and debugged at least one bug that turned out to be an *ordering* problem (a race, a reordering, a crash-at-the-wrong-moment).
- **Helpful:** You've written or reviewed a design doc / RFC for a protocol with retries, crashes, or replication.
- **Helpful:** You've been on call for an incident whose root cause was a state nobody thought reachable.

---

## Glossary

| Term | Meaning |
|---|---|
| **Spec** | A TLA+ model of a *design* — the legal behaviors (state sequences) of a system, not its code. |
| **TLC** | Lamport's explicit-state model checker; enumerates reachable states by brute force. |
| **Apalache** | A symbolic (SMT-backed) model checker for TLA+; checks bounded behaviors without enumerating every state. |
| **TLAPS** | The TLA+ Proof System; machine-checks deductive proofs for *unbounded* correctness. |
| **PlusCal** | A pseudocode-like front-end that compiles to TLA+; lowers the barrier for imperative-minded engineers. |
| **`CONSTANTS`** | The model's parameters (number of nodes, set of keys, etc.); their *size* dictates state-space size. |
| **Atomicity grain** | How much real-world work one TLA+ step represents; the single most consequential modeling decision. |
| **Safety** | "Nothing bad happens" — an invariant on reachable states (e.g., no two leaders, no lost ack'd write). |
| **Liveness** | "Something good eventually happens" — a temporal property requiring fairness (e.g., every request eventually completes). |
| **Fairness** | An assumption (`WF`/`SF`) that enabled actions eventually fire; required for liveness, dangerous if over-asserted. |
| **Symmetry** | A `Permutations` model-value reduction telling TLC that interchangeable values (e.g., identical clients) needn't be re-explored. |
| **Refinement** | A proof that a detailed spec *implements* an abstract one (the detailed behaviors are a subset). |
| **Spec rot** | The slow divergence between a living spec and the code it once described — false confidence's main cause. |

---

## Core Concept 1 — The AWS Story, In Depth

The canonical industrial reference is Newcombe, Rath, Zhang, Munteanu, Brooker, and Deardeuff, *"How Amazon Web Services Uses Formal Methods,"* CACM, April 2015. It is worth knowing in detail, because every argument you will make to adopt TLA+ is a footnote to this paper.

**Why they started.** AWS builds systems where correctness under concurrency and partial failure is the entire product — S3, DynamoDB, EBS. Their existing arsenal (design review, deep testing, fault injection) caught most bugs but kept missing a specific class: *deep, ordering-dependent bugs that only manifest after a long, improbable sequence of steps.* These are the bugs that survive testing because no test happens to hit the 35th step in the right order, and they surface years later as a rare data-loss event. AWS wanted a way to find them *at design time, before writing code.*

**The DynamoDB result.** The headline: TLC found a bug in a core DynamoDB replication and fault-recovery design that required a sequence of **35 steps** to trigger — a node-failure-and-recovery interleaving no human reviewer had imagined and no test had hit. A bug at that depth is essentially undiscoverable by inspection. The model checker found it because it does not get bored, does not assume "that can't happen," and explores every interleaving the model allows.

**What surprised them.** Two things, beyond "it finds bugs":

1. **TLA+ validated optimizations, not just designs.** Once a system has a checked spec, you can model a *proposed change* — "what if we skip this round-trip?", "what if we relax this lock?" — and let TLC tell you whether the optimization preserves your invariants. AWS reports this gave engineers the *courage to make aggressive optimizations* they'd otherwise have been too scared to attempt, because they could verify safety in the model first. The ROI was not only "fewer bugs"; it was "more performance, taken safely."

2. **Engineers learned it fast.** Working engineers — not formal-methods PhDs — became productive in roughly **2–3 weeks**. **PlusCal lowered the barrier** further: imperative-looking pseudocode that compiles to TLA+, so people who think in `while` loops and `if` statements could start without absorbing all of the temporal-logic notation up front.

> **The principle to extract:** TLA+'s payoff at AWS was *cheap discovery of expensive bugs at design time*, plus the *confidence to optimize*. Both happen before code exists, where a fix costs a sentence instead of an incident. That is the entire economic case, and it is portable to any team building protocols with crashes, retries, and concurrency.

**Beyond AWS.** The same playbook recurs across the industry:

- **Azure Cosmos DB** — TLA+ specs of its consistency levels and replication.
- **MongoDB** — specs of replication, the oplog, and elections; some published openly.
- **Confluent / Apache Kafka** — replication and the `KRaft` consensus layer modeled in TLA+.
- **Elasticsearch** — its cluster-coordination/consensus layer designed with TLA+ after earlier data-loss issues.
- **CockroachDB-style** usage and the broader database world routinely reach for TLA+ on transaction and consensus protocols.

The pattern is unmistakable: the heaviest users are the people building **replication, consensus, and distributed transactions** — exactly where ordering bugs hide and exactly where they are catastrophic.

---

## Core Concept 2 — What to Model (and What to Leave Out)

TLA+ is not a general-purpose verifier you point at "the system." Its sweet spot is sharp, and recognizing it is the first professional skill.

**Model this:** anything where **the bug is an ordering** — concurrency + partial failure + retries, where correctness depends on *what happens in what order across failures.* Concretely:

- **Consensus & leader election** (Raft/Paxos variants, lease-based leadership).
- **Replication protocols** — primary/backup, quorum writes, log replication, catch-up after a crash.
- **Distributed transactions** — two-phase commit, sagas, the commit/abort ordering under coordinator failure.
- **Cache coherence & membership** — gossip, failure detectors, view changes.
- **Lock / lease services** — anything granting mutual exclusion across a network with timeouts.
- **Any "crash + retry + concurrency" protocol** where the dangerous case is a specific interleaving of failure and recovery.

**Do not model with TLA+:**

- **Computation-heavy correctness** (does this numerical routine converge? is this parser right?) — that's a job for property-based testing or a proof assistant, not state exploration.
- **Code-level bugs** — TLA+ verifies a *design*, not your implementation. Off-by-ones, missing `nil` checks, and the line of code that doesn't match the spec are out of scope (see Concept 5).
- **Pure data-structure invariants with no concurrency** — a property test is cheaper and closer to the code.
- **Performance** — TLA+ reasons about correctness, not latency or throughput.

> **The litmus test:** *"Could this break only because two things happened in an order nobody planned, possibly with a crash in the middle?"* If yes, it's a TLA+ problem and you will likely find a bug. If the hard part is an algorithm's *result* rather than an *interleaving*, reach for a different rung of the ladder.

The corollary is that TLA+ is most valuable on the **smallest, most critical core** of a system — the consensus heart, the commit protocol — not the whole service. Spec the part where an ordering bug means data loss; test the rest.

---

## Core Concept 3 — Abstraction & Atomicity at Scale

The two decisions that make or break a real spec are **what to abstract** and **how coarse to make each step**. Get these wrong and you either drown in state explosion or, worse, prove a comforting fiction.

**Atomicity is the dangerous knob.** Each TLA+ step is atomic — it happens with no interleaving inside it. So when you write "read X, then write Y" as *one* step, you have told the model that no other process can act *between* the read and the write. If, in the real system, those are two separate operations that another node *can* interleave, your model has erased exactly the race you're trying to find. **Too-coarse atomicity is how a spec passes while the real bug walks free.** The discipline: model at the grain of the real system's *atomic* operations (a single network message, a single disk write, a single CAS), not at the grain that's convenient to write.

**Abstraction is the survival knob.** You cannot model everything, and you shouldn't. Replace irrelevant detail with abstract representations: a message channel becomes a *set* or *bag* of in-flight messages (a set if duplicates can't matter, a bag if they can); a database becomes a function from key to value; a "timeout" becomes a nondeterministic action that *may* fire. The art is abstracting away what doesn't affect your invariant while keeping every behavior that could violate it.

**The state-space budget.** TLC's reachable-state count explodes combinatorially with `CONSTANTS`. Three nodes and two keys might be thousands of states; five nodes and four keys might be billions and never finish. So you make models **small but adversarial**: the *smallest* configuration that can still exhibit the bug class. Most replication bugs show up with **3 nodes**; most transaction conflicts with **2 transactions and 2 keys**. Going bigger rarely finds new *kinds* of bugs and usually just exhausts your RAM.

When TLC still explodes, the professional toolkit:

| Technique | What it does | When |
|---|---|---|
| **Smaller `CONSTANTS`** | Fewer nodes/keys/clients → fewer states | First resort, always |
| **`SYMMETRY`** | Tells TLC interchangeable values (identical clients) needn't be re-permuted | Many symmetric, identical actors |
| **State constraints** | Caps the explored space (e.g., queue length ≤ 3, clock ≤ 5) | Unbounded counters/queues you can bound safely |
| **`VIEW`** | Collapses states TLC should treat as equivalent | Irrelevant fields blow up the count |
| **Apalache** | Symbolic (SMT) bounded check — no explicit enumeration | TLC explodes but bounded behaviors suffice |
| **TLAPS** | Deductive proof — unbounded, all configurations | You need a guarantee for *all N*, not just N=3 |

> **The hard truth:** a model checker that finishes proves something about the *model you wrote*, at the *atomicity you chose*, for the *`CONSTANTS` you set*. "No errors found" with three nodes does not mean "correct for any number of nodes," and a coarse-atomicity model that's green can still hide the very race you specced it to catch. Calibrate atomicity to reality, keep `CONSTANTS` small-but-adversarial, and *know* what your green check actually covers.

---

## Core Concept 4 — The Lifecycle of a Spec in an Org

A spec is not a one-time artifact by default — its lifecycle depends on what kind of thing you're verifying, and getting that classification right determines whether it pays dividends or becomes a liability.

**Spec *with* the RFC.** The highest-leverage moment is *during design*. Write the spec as part of the RFC for the protocol, so the design review reviews a *checked* design, not prose. This is where TLA+ is cheapest and most valuable: the bug costs a sentence to fix because no code exists yet. AWS's practice is exactly this — model first, then implement against the validated design.

**One-shot design aid vs living artifact.** The fork in the road:

- **One-shot design aid** — you model a design once, find the bugs, fix the design, ship the code, and *retire the spec*. Appropriate for a protocol that, once correct, won't change — a migration plan, a one-time cutover, a settled commit protocol. The spec did its job at design time; keeping it alive would cost more than it returns.
- **Living artifact** — for a *protocol that keeps evolving* (your consensus layer, your replication engine), the spec is a permanent part of the design. Every proposed change is modeled *first*, re-checked, and only then implemented. This is where the "validate optimizations safely" payoff lives — but it only works if the spec stays in sync.

**Ownership.** A living spec needs an owner, exactly like code. Orphaned specs rot. The owner is usually the team that owns the protocol — the spec lives *in the same repo* as the code it describes, reviewed in the same PRs, so a protocol change and its spec change travel together.

**TLC in CI.** For critical *living* specs, wire TLC into CI: a model-check run on every change to the spec (and ideally a reminder/gate when the protocol's code changes). This is what makes "re-check on change" real rather than aspirational. Keep the CI model *small* (the smallest adversarial `CONSTANTS`) so the run finishes in minutes; reserve the big, slow configurations for nightly or pre-release runs.

**The spec-rot risk.** The failure mode unique to living specs: the spec and the code drift apart. Someone changes the protocol in code, doesn't update the spec, and now the green check is verifying a design *you no longer run.* This is worse than no spec, because it manufactures false confidence — the most dangerous output a verification tool can produce. Defenses: co-locate spec and code, require spec updates in protocol-change PRs, run TLC in CI, and periodically *conformance-check* the implementation against the spec (Concept 5).

> **The decision in one line:** *Is the thing you're verifying going to change?* If no → one-shot design aid, retire it. If yes → living artifact, give it an owner, a repo home, and a CI run, and treat spec rot as the primary risk.

---

## Core Concept 5 — Selling It, and Setting Limits

Adoption fails for human reasons more than technical ones. Two skills close the gap: selling it credibly, and stating its limits honestly so nobody over-trusts it.

**Selling it to skeptical engineers.** The objection is always "this is academic / too slow / not worth it." The counters that actually work:

- **Train on a real past incident.** Take a bug your team actually shipped — ideally a nasty ordering bug that cost an outage — and model the design *as it was.* When TLC reproduces the exact incident in seconds, the abstract argument becomes visceral. Nothing sells TLA+ like watching it find the bug you spent three days debugging in prod.
- **Show a fast win.** Pick one tractable, high-stakes protocol; find one real bug; keep the model small enough to finish in minutes. A single concrete "we found *this* before it shipped" outperforms any slide deck.
- **Lean on PlusCal.** For engineers who recoil at temporal-logic syntax, PlusCal's imperative feel is the on-ramp. "It's pseudocode that you can check" is an easier sell than "learn this notation."
- **Quote the ROI honestly.** ~2–3 weeks to productivity (the AWS number), models that find bugs no test reaches, and the *option value* of safely optimizing later.

**Selling it to leadership** is a different pitch: *cost of design-time bug vs cost of production incident.* Frame it as cheap insurance on the most critical, hardest-to-test part of the system, plus the courage-to-optimize upside. Keep the ask small — a few engineer-weeks on one protocol, not a methodology mandate.

**The limits — state these up front:**

1. **You verify the *design*, not the *code*.** A green TLA+ check says the *model* is correct. The implementation can still diverge — a coder fat-fingers the protocol, the spec's atomicity didn't match reality, a library does something the model didn't. **TLA+ does not check your source.** Pair it with conformance testing and property-based testing of the implementation; this is precisely the spec–implementation gap that [04 — Property & Contract Verification](../04-property-and-contract-verification/professional.md) and the [Testing](../../testing/) roadmap exist to close.
2. **Model checking is bounded.** TLC explores the configuration you gave it (3 nodes, 2 keys). "No errors found" is a statement about *that* bounded model, not a proof for all N. For unbounded guarantees you need TLAPS — a much heavier lift.
3. **Liveness is expensive.** Checking `<>` properties requires fairness assumptions and is dramatically more costly than safety; it's also where it's easiest to fool yourself (over-asserting fairness makes a property pass for the wrong reason — see War Stories). Many teams check safety in CI and treat liveness as an occasional, careful exercise.

> **The honest framing that builds trust:** "TLA+ proves our *design* has no ordering bug in this bounded model; it does *not* prove our *code* matches the design." Say that out loud when you present results. Over-claiming ("we proved it correct!") is how a tool that should build credibility instead burns it the first time a code-level bug slips through.

---

## War Stories

**The DynamoDB 35-step bug.** AWS modeled a core DynamoDB replication and fault-recovery design in TLA+. TLC found a defect requiring a precise sequence of **35 steps** — a node-failure-and-recovery interleaving — to trigger a data-loss scenario. No human reviewer had imagined it; no test had hit it. The depth is the whole point: a bug 35 steps deep is invisible to inspection and astronomically unlikely to be reached by random testing, but a model checker finds it because it explores every interleaving without fatigue or assumption. This single result (Newcombe et al., CACM 2015) is the most-cited justification for industrial TLA+ — and the template for "train on the bug that hurt us."

**The replication data-loss window.** A team specced a primary-backup replication protocol they believed was safe. Their first model passed — because they'd modeled acknowledgement and leader change as if they couldn't interleave. When a reviewer pushed them to *split the atomicity* so a leader change could occur *between* a write being applied and its ack being sent, TLC immediately produced a counterexample: a client receives an ack for a write that a subsequent leader, elected during the gap, does not have — a silent data-loss window under leader-change + ack reordering. The bug existed in the design all along; only the corrected atomicity exposed it. The lesson: **the atomicity grain decides whether your model can even see the bug.**

**The too-coarse model that missed a real bug.** Another team modeled a distributed lock service and shipped on the strength of a green TLC run. Months later they hit a real double-grant in production. Post-mortem: their spec had modeled "acquire and update the holder" as a single atomic step, so the model could never represent two acquirers interleaving — the exact race that bit them. The spec wasn't wrong notation; it was *too coarse to be true.* A green check on a fiction is worse than no check, because it bought false confidence.

**The over-asserted fairness liveness "pass."** A team wanted to prove "every submitted request eventually completes." Their liveness property passed — but only because they'd slapped strong fairness (`SF`) on *every* action, including ones that, in reality, could starve. They had effectively assumed away the very starvation the property was meant to catch. The property was green for the wrong reason. The fix was to model fairness honestly (weak fairness only where the real scheduler guarantees it), after which TLC found a genuine starvation behavior. Lesson: **over-asserted fairness turns liveness checks into wishful thinking.**

**The beautiful spec that drifted from the code.** A team wrote an elegant, thorough TLA+ spec of their consensus layer during design, found bugs, fixed them, and shipped. Two years and many protocol tweaks later, the spec hadn't been touched — it lived in a wiki, nobody owned it, and the code had quietly evolved past it. When a new ordering bug appeared in prod, leadership's first reaction was "but we have a TLA+ spec, it's proven correct" — which was now *false*, and worse, had delayed the right investigation. Spec rot had converted a past asset into present false confidence. Lesson: **a living protocol's spec must live with the code, with an owner and a CI run, or it decays into a liability.**

---

## Decision Frameworks

**Is this a TLA+ problem?**

| Signal | TLA+ fit |
|---|---|
| Correctness depends on *ordering* across concurrency/failure | Strong — this is the sweet spot |
| Crashes + retries + recovery interleavings | Strong — model checkers excel here |
| Consensus / replication / distributed txns / leases | Strong — the heaviest industrial use |
| The hard part is an *algorithm's result*, not interleaving | Weak — use property tests or a proof assistant |
| Code-level bugs (null checks, off-by-one) | None — TLA+ verifies design, not code |
| Performance / latency questions | None — TLA+ reasons about correctness only |

**Living spec vs one-shot design aid:**

| Question | One-shot aid | Living artifact |
|---|---|---|
| Will the protocol keep changing? | No | Yes |
| Example | Migration, cutover, settled commit protocol | Consensus engine, replication core |
| After design | Retire the spec | Keep, own, re-check on change |
| Where it lives | Design doc / archive | Same repo as the code |
| CI model-check | No | Yes (small config) |
| Primary risk | — | Spec rot |

**TLC vs Apalache vs TLAPS:**

| Tool | Method | Guarantees | Reach for it when |
|---|---|---|---|
| **TLC** | Explicit-state enumeration | Bounded (your `CONSTANTS`) | Default; great counterexamples; small configs |
| **Apalache** | Symbolic / SMT, bounded | Bounded but no enumeration | TLC explodes; bounded behaviors suffice |
| **TLAPS** | Deductive proof | Unbounded — all configurations | You need a guarantee for *all N*, accept high cost |

**Modeling failures: which faults to include:**

| Fault | Include when | Skip when |
|---|---|---|
| Process crash (fail-stop) | Almost always — it's where ordering bugs live | Truly crash-free single-process logic |
| Crash + recovery (restart with persisted state) | Recovery is part of the protocol | No durable state to recover |
| Message loss | Channel is lossy / uses timeouts | Reliable, ordered channel guaranteed below |
| Message reorder / duplicate | Network can reorder; retries duplicate | In-order exactly-once transport guaranteed |
| Network partition | Quorum/consensus protocols | Single-partition, single-node designs |
| Byzantine (arbitrary) faults | BFT protocols, untrusted participants | Trusted internal fleet (most services) |

**Spec-only vs check-safety vs check-liveness vs refinement:**

| Goal | Effort | Use when |
|---|---|---|
| **Spec-only** (write it, don't check) | Low | Communication / precise design; clarity is the win |
| **Check safety** (invariants) | Medium | The default; "nothing bad happens" is most bugs |
| **Check liveness** (`<>`) | High | "Something good eventually happens" genuinely matters; budget for fairness care |
| **Refinement** (impl-spec implements abstract-spec) | High | Two specs at different levels; prove the detailed one is faithful |

---

## Mental Models

- **TLA+ pays off by finding expensive bugs cheaply at design time.** The bug 35 steps deep costs a sentence to fix before code exists and an outage to fix after. That asymmetry is the entire economic case.

- **Atomicity is the knob that decides what your model can see.** Coarse steps erase the very interleavings you're hunting. Model at the grain of the real system's atomic operations, or your green check is verifying a fiction.

- **Small but adversarial beats big.** Most replication bugs appear with 3 nodes, most transaction bugs with 2 transactions and 2 keys. Bigger `CONSTANTS` rarely find new *kinds* of bugs and usually just exhaust RAM.

- **"No errors found" is bounded, and it's about the model, not the code.** TLC proved something about *your model* at *your atomicity* for *your `CONSTANTS`* — not a universal theorem, and not a statement about your implementation.

- **A living spec rots unless it lives with the code.** A spec in a wiki with no owner decays into false confidence. Co-locate it, own it, re-check it — or retire it honestly as a one-shot aid.

- **Over-asserted fairness is wishful thinking.** Strong fairness everywhere makes liveness pass for the wrong reason. Assume only the fairness the real scheduler actually provides.

---

## Common Mistakes

1. **Modeling the wrong thing.** Pointing TLA+ at computation-heavy correctness, a data-structure invariant, or "the whole service." It shines on *ordering* bugs in the *critical core* — consensus, replication, transactions. Spec the heart, test the rest.

2. **Too-coarse atomicity.** Bundling "read then write" into one atomic step erases the race. Model at the grain of real atomic operations (one message, one disk write, one CAS), or your spec passes while the real bug walks free.

3. **`CONSTANTS` too big to finish — or too small to be adversarial.** Five nodes and four keys may never terminate; one node can't exhibit a race. Use the *smallest configuration that can still show the bug class* (usually 3 nodes, 2 txns, 2 keys), and apply `SYMMETRY`/constraints before going bigger.

4. **Treating every spec as a living artifact.** Not every spec deserves CI and an owner. A migration plan is a one-shot aid — find the bugs, fix the design, retire it. Reserve the living-artifact machinery for protocols that actually keep changing.

5. **Letting living specs rot.** Changing the protocol in code without updating the spec manufactures false confidence — worse than no spec. Co-locate spec and code, update both in the same PR, run TLC in CI.

6. **Over-asserting fairness on liveness checks.** Strong fairness everywhere makes `<>` properties pass for the wrong reason and hides real starvation. Assume only the fairness the scheduler guarantees; prefer weak fairness, applied deliberately.

7. **Over-claiming the result.** Saying "we proved it correct" when you proved a *bounded design* has no ordering bug. The code can still diverge. Say "we verified the design in this bounded model" and pair it with conformance + property testing — or the first code-level slip burns the tool's credibility.

---

## Test Yourself

1. AWS's most-cited TLA+ result is a bug that took 35 steps to trigger. Why is a bug at that depth essentially undiscoverable by code review and unit testing, and why does a model checker find it?
2. AWS reported a *second* major benefit beyond "finding bugs in designs." What was it, and why does it depend on having a checked spec already in place?
3. You model a primary-backup protocol and TLC passes. A reviewer says "split the atomicity so a leader change can happen between applying a write and sending its ack." Why might that change suddenly surface a data-loss counterexample?
4. Your TLC run on a replication spec won't finish — billions of states. List four things you'd try, in order, before giving up.
5. Distinguish a *one-shot design aid* from a *living artifact*. For each, what do you do with the spec after the design ships, and what's the dominant risk?
6. A teammate's liveness property ("every request eventually completes") passes. What's the classic way that pass is *fake*, and how would you check whether the fairness assumptions are honest?
7. Leadership says "we have a TLA+ spec for the consensus layer, so it's proven correct." Give the two distinct reasons that claim can be false.

<details>
<summary>Answers</summary>

1. A 35-step bug requires a precise, improbable *interleaving* of actions (including failures and recovery). Human reviewers don't imagine it because it violates their "that can't happen" intuition; unit tests don't hit it because the odds of randomly reaching step 35 in the exact order are astronomical. TLC finds it because it **exhaustively explores every interleaving the model allows**, without fatigue or assumption — that's its whole advantage over inspection and sampling.
2. **Validating optimizations / "what-if" changes safely.** With a checked spec in hand, you model a *proposed* change (skip a round-trip, relax a lock) and let TLC confirm it preserves your invariants *before* implementing. It depends on already having a trusted spec because the optimization is checked as a delta against it — AWS reported this gave engineers the courage to make aggressive optimizations they'd otherwise avoid.
3. As one atomic step, "apply write, then ack" tells the model no leader change can occur *between* them — erasing the race. Splitting the atomicity lets a new leader be elected *in the gap*; TLC can then construct a behavior where a client gets an ack for a write the new leader never received → silent data loss. The bug was always in the design; only the corrected atomicity let the model represent it.
4. (1) Shrink `CONSTANTS` to the smallest adversarial config (often 3 nodes). (2) Add `SYMMETRY` for interchangeable values (identical clients). (3) Add state constraints / `VIEW` to bound unbounded counters/queues and collapse irrelevant states. (4) Switch to **Apalache** (symbolic, bounded) — or, if you need an unbounded guarantee, accept the cost of **TLAPS**.
5. **One-shot aid:** model once, find bugs, fix the design, ship, and *retire* the spec (e.g., a migration). Dominant risk: minimal — it did its job at design time. **Living artifact:** the protocol keeps changing, so keep the spec, give it an owner, co-locate it with the code, and re-check on every change (TLC in CI). Dominant risk: **spec rot** — the spec drifting from the code and manufacturing false confidence.
6. The fake pass comes from **over-asserted fairness** — e.g., strong fairness (`SF`) on actions that could actually starve, so the model assumes away the starvation the property was meant to catch. Check honesty by asking whether the real scheduler truly guarantees each fairness assumption; downgrade to weak fairness (or none) where it doesn't, then re-run — a genuine starvation behavior often appears.
7. (a) **It verifies the design, not the code** — the implementation can diverge from the spec (coder error, atomicity mismatch), and TLA+ never checked the source. (b) **The check is bounded** — "no errors" holds for the modeled `CONSTANTS` (e.g., 3 nodes), not all N; and if it's a *living* protocol, the spec may have **rotted** out of sync with the current code, making the claim outright false.

</details>

---

## Cheat Sheet

```
THE AWS CASE (Newcombe et al., CACM 2015)
  found a 35-STEP bug in DynamoDB replication/recovery
  ALSO: validated optimizations safely → courage to optimize
  engineers productive in ~2-3 WEEKS; PlusCal lowered the barrier
  industrial users: Cosmos DB, MongoDB, Kafka/Confluent, Elasticsearch

IS IT A TLA+ PROBLEM?
  YES → bug is an ORDERING: concurrency + crash + retry
        consensus, replication, distributed txns, leases, membership
  NO  → code-level bugs, algorithm results, performance

MODELING KNOBS
  atomicity → match the REAL atomic op (1 msg / 1 disk write / 1 CAS)
              too coarse = green check on a FICTION
  CONSTANTS → smallest ADVERSARIAL config (3 nodes / 2 txns / 2 keys)
  explosion → smaller CONSTANTS → SYMMETRY → constraints/VIEW → Apalache → TLAPS

SPEC LIFECYCLE
  spec WITH the RFC (cheapest bug = design time)
  one-shot aid  → retire after ship
  living art/ → own it, co-locate with code, TLC in CI, beware SPEC ROT

TOOL CHOICE
  TLC      explicit, bounded, great counterexamples (default)
  Apalache symbolic/SMT, bounded, when TLC explodes
  TLAPS    deductive proof, unbounded (all N), high cost

LIMITS (say these out loud)
  verifies DESIGN, not CODE → pair w/ conformance + property tests
  model checking is BOUNDED ("no errors" ≠ proof for all N)
  liveness is EXPENSIVE; over-asserted fairness = fake pass
```

---

## Summary

- **The AWS story is the case to know.** TLC found a **35-step** ordering bug in DynamoDB that inspection and testing could never reach, and — just as important — let AWS **validate risky optimizations safely** against a checked spec. Engineers became productive in ~2–3 weeks, and PlusCal lowered the barrier. The same playbook now runs at Cosmos DB, MongoDB, Kafka/Confluent, and Elasticsearch. The payoff is *cheap discovery of expensive bugs at design time, plus the courage to optimize.*
- **Model where the bug is an *ordering*** — consensus, replication, distributed transactions, leases, membership — on the **smallest, most critical core**. Don't point TLA+ at code-level bugs, algorithm results, or performance; those are other rungs of the ladder.
- **Atomicity is the decisive knob.** Steps that are too coarse erase the very interleavings you're hunting, so a green check verifies a fiction. Model at the grain of real atomic operations, and keep `CONSTANTS` **small but adversarial** (3 nodes, 2 txns); when TLC explodes, reach for `SYMMETRY`, constraints, Apalache, or TLAPS.
- **Classify the spec's lifecycle.** A *one-shot design aid* gets retired after the design ships; a *living artifact* for an evolving protocol needs an owner, a home in the code's repo, and TLC in CI — with **spec rot** as its primary risk.
- **Sell it on a real past incident, ship a fast small win, and state the limits honestly.** TLA+ verifies the **design, not the code**; the check is **bounded**; liveness is **expensive** and easy to fake with over-asserted fairness. Pair it with conformance and property testing — see [04 — Property & Contract Verification](../04-property-and-contract-verification/professional.md) and the [Testing](../../testing/) roadmap.

You can now wield TLA+ as a working engineering tool: choose the right problems, model them at honest atomicity, keep the spec alive (or retire it deliberately), and set expectations nobody can later weaponize against you. The final tier — [interview.md](interview.md) — distills this into the questions that reveal whether someone has actually used TLA+ in anger.

---

## Further Reading

- **Newcombe, Rath, Zhang, Munteanu, Brooker, Deardeuff — *"How Amazon Web Services Uses Formal Methods,"* CACM, April 2015.** The single most important industrial-TLA+ reference: the DynamoDB 35-step bug, optimization validation, and the cultural/ROI lessons. Read it before you pitch TLA+ to anyone.
- **Hillel Wayne — *Practical TLA+* (Apress) and [learntla.com](https://learntla.com).** The most pragmatic, engineer-facing path into TLA+ and PlusCal; the right thing to hand a skeptical teammate.
- **Leslie Lamport — the TLA+ Video Course and *Specifying Systems*.** From the source: the language, temporal logic, refinement, and the mental model behind it all.
- **Published specs in the wild** — MongoDB's replication specs, the Kafka/`KRaft` and Raft TLA+ models, and the `tlaplus/Examples` repository — for seeing real, non-toy specs at industrial scale.
- **Apalache and TLAPS documentation** — for when TLC explodes (symbolic checking) or when you need unbounded proofs.
- See **[interview.md](interview.md)** for the questions that probe genuine, hands-on TLA+ judgement.

---

## Related Topics

- [01 — Formal Specification](../01-formal-specification/professional.md) — what a spec *is*, refinement, and the spec–implementation gap that bounds every TLA+ result.
- [02 — Model Checking](../02-model-checking/professional.md) — the state-explosion problem, safety vs liveness, and reading counterexamples — the machinery TLC rides on.
- [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/professional.md) — the ROI decision: where TLA+ earns its keep vs where a property test is enough.
- [Backend → Distributed Systems](../../../../Backend/distributed-systems/) — the consensus, replication, and transaction protocols that are TLA+'s primary target.
- [Testing](../../testing/) — conformance and property-based testing that close the gap TLA+ leaves open between a verified design and the running code.
