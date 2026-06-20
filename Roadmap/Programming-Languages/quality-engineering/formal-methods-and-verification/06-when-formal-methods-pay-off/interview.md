# When Formal Methods Pay Off — Interview Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → When Formal Methods Pay Off
> *A formal-methods interview rarely asks "prove this theorem." It asks "you have two weeks and a new consensus protocol — what assurance do you apply?" and watches whether you reach for the right rung of the ladder, or reflexively try to prove everything (or nothing). This is the capstone question bank: it synthesizes the whole roadmap into the single skill that matters in industry — **judgement about where rigor pays.***

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Introduction](#introduction)
3. [Prerequisites](#prerequisites)
4. [The Ladder & The Choice](#the-ladder--the-choice)
5. [Where It Pays Off](#where-it-pays-off)
6. [The Design-Time Argument](#the-design-time-argument)
7. [Limits & Honesty](#limits--honesty)
8. [Judgement & Scenarios](#judgement--scenarios)
9. [Rapid-Fire](#rapid-fire)
10. [Red Flags / Green Flags](#red-flags--green-flags)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). This is the section *capstone*, so the questions deliberately cut across the whole roadmap — specification, model checking, TLA+, contracts, proof assistants — and the recurring thread is one judgement skill:

- **match the tool to the risk** (cheap rung for cheap blast radius, expensive rung for catastrophic-and-unrecoverable)
- **the spec is the product** (the biggest ROI is finding design bugs, not proving code)
- **"proven correct" is a scoped claim** (correct *modulo* spec, axioms, and TCB — not omnipotent)
- **verify the core, test the rest** (rigor is a budget you spend on the small high-value heart of the system)

Don't memorize answers — internalize those four. Nearly every question below is one of them in a costume, and the candidates who do well *name the judgement* before naming a tool.

---

## Introduction

By this point in the roadmap you can write a spec, run a model checker, read a TLA+ counterexample, discharge a Dafny proof obligation, and explain Curry–Howard. The interview for a senior or staff role does not test whether you *can* do those things — it tests whether you know **when to** and, just as important, **when not to**. Formal methods are a cost/assurance ladder, not a religion. The valuable engineer is the one who can look at a system, locate its small dangerous core, pick the cheapest rung that retires the real risk, and articulate the tradeoff to a skeptical VP without overselling. That judgement — not proof mechanics — is what this page rehearses.

A reframing worth carrying into the room: the question "did you formally verify it?" is junior. The senior question is "**what assurance does this part of the system need, and what is the cheapest way to get it?**" Sometimes the answer is a proof. More often it is a 200-line TLA+ model, a property test, or a stronger type — and knowing that *is* the expertise.

---

## Prerequisites

To answer these well you should be comfortable with:

- **The ladder itself** — types/linters, property-based testing, lightweight modeling (TLA+/Alloy), deductive verification (Dafny/SPARK), proof assistants (Coq/Isabelle/Lean) — and what each *costs* and *assures*. Build it from [01 — Formal Specification](../01-formal-specification/interview.md) through [05 — Proof Assistants & Dependent Types](../05-proof-assistants-and-dependent-types/interview.md).
- **Safety vs liveness**, **invariant vs temporal property**, and **counterexample reading** — from [02 — Model Checking](../02-model-checking/interview.md) and [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/interview.md).
- **What a proof actually claims** — the spec/axioms/TCB framing from [04 — Property & Contract Verification](../04-property-and-contract-verification/interview.md) and [05](../05-proof-assistants-and-dependent-types/interview.md).
- The landmark case studies as *evidence*: AWS/TLA+, seL4, CompCert, Fiat-Crypto / HACL\*, smart-contract verification.

---

## The Ladder & The Choice

### Q: Name the cost/assurance ladder of formal methods, bottom to top, and say what each rung buys.

> **Testing:** Whether you carry a structured mental model, or treat "formal methods" as one undifferentiated expensive thing.

**A.** Five rungs, each costing more and claiming more:

| Rung | Examples | What it assures | Rough cost |
|---|---|---|---|
| **Types & linters** | A type checker, `clippy`, a SAST tool | A class of errors *can't be written*; checked on every build, free at scale | ~0 (you already pay it) |
| **Property-based testing** | QuickCheck, Hypothesis, `proptest` | "No counterexample found in *N* generated inputs satisfying invariants" — for-all *thinking* without a proof | Low |
| **Lightweight modeling** | TLA+/TLC, Alloy, SPIN | "No violation in *all reachable states of the model*" — finds design bugs before code exists | Medium |
| **Deductive verification** | Dafny, SPARK, Frama-C, Why3 | "*This code* meets *this spec* on all inputs," discharged by an SMT solver | High |
| **Proof assistants** | Coq/Rocq, Isabelle/HOL, Lean, Agda | "Machine-checked proof of arbitrary theorems," foundationally trustworthy | Very high |

The unifying idea is that a **type system is already a proof system** — the bottom rung and the top rung are points on one spectrum, differing in expressive power and price. The judgement the ladder forces is **match the tool to the risk**: don't bring Coq to a CRUD app, and don't bring a unit test to a microkernel's access-control model.

### Q: Distinguish "lightweight" from "heavyweight" formal methods. Why does the distinction matter commercially?

> **Testing:** Whether you know the practical/academic split that determines whether FM is adoptable.

**A.** **Heavyweight** FM proves a *program* correct against a spec with a machine-checked proof — deductive verification and proof assistants (the top two rungs). It is the seL4/CompCert end: enormous assurance, person-*years* of effort, rare skills. **Lightweight** FM models and checks a *design* or an *abstraction* rather than the production code — TLA+, Alloy, property testing, contracts (the middle and lower rungs). It is push-button-ish, learnable in weeks, and finds most of the bugs for a fraction of the cost.

Commercially the distinction is everything, because lightweight FM has a **return on investment an ordinary team can realize**, while heavyweight FM is justified only for a small set of catastrophic-risk cores. AWS's whole adoption story is lightweight: engineers learned TLA+ in a couple of weeks and found deep bugs in production systems — *without* proving a single line of Java. The interview-grade insight is that "should we use formal methods?" usually decomposes into "should we use the *lightweight* rungs?" — and the answer there is far more often yes than people assume.

### Q: Most software will never see a proof assistant. So why should a normal engineer care about this ladder at all?

> **Testing:** Whether you can defend FM's relevance without overclaiming — the maturity tell.

**A.** Two reasons, and neither requires running a prover. First, the **cheap rungs are pure upside and you should already be on them**: stronger types, exhaustiveness checks, a SAST gate, and property-based tests for any pure/serializable/invariant-bearing code retire whole bug classes for near-zero ongoing cost. Most teams under-use these, not over-use them. Second, the **thinking transfers**: learning to state an invariant, to separate safety ("nothing bad happens") from liveness ("something good eventually happens"), and to ask "what does correct even mean here?" makes you measurably better at design, code review, and debugging *even if you never write a spec file*. So the honest pitch isn't "verify everything" — it's "climb the cheap rungs reflexively, reserve the expensive ones for the rare core that earns them, and let the discipline sharpen how you think everywhere else."

### Q: A peer says "we have 95% test coverage, we don't need formal methods." What's the precise gap they're missing?

> **Testing:** The testing-vs-proof distinction stated rigorously, not as a slogan.

**A.** Coverage measures **which lines ran**, not **which states or inputs you reasoned about**. Testing samples the input/interleaving space; formal methods quantify over it. 95% line coverage can still miss the one 14-step interleaving where two nodes commit conflicting values — a path no example test happens to construct, and one coverage will never flag because the *lines* execute fine on the happy path. The canonical evidence is Amazon: systems with heavy testing and code review still had subtle replication bugs that surfaced only when TLA+ explored *all reachable states* and produced a 35-step counterexample no human would have written by hand. So coverage and FM answer different questions — "did my examples execute the code?" vs "does the property hold over the whole space?" — and for concurrency and protocols, the second is the one that bites.

---

## Where It Pays Off

### Q: Give me the criteria for *when* formal methods are worth the cost.

> **Testing:** Whether you have an explicit decision rubric or just vibes.

**A.** The spend is justified when the risk is high **and** rigor is the cheapest way to retire it. Concretely, FM pays when several of these hold:

- **Catastrophic *and* unrecoverable failure** — lives, irreversible money, or a breach you can't roll back. A web page that can be redeployed in 30 seconds rarely qualifies; an avionics controller or an on-chain contract does.
- **Concurrency / distributed protocols** — the bug class where human intuition is worst and tests are weakest: consensus, replication, cache coherence, locking, leader election.
- **A security or cryptographic boundary** — where one flaw is exploited adversarially, on purpose, at scale.
- **A small, stable, high-value core** — the heart of the system is little code, changes rarely, and everything depends on it (a kernel, a crypto primitive, a scheduler).
- **Regulated / safety-critical** — DO-178C (avionics), EN 50128 (rail), IEC 61508, ISO 26262 (automotive) where certification *demands* evidence FM is well-suited to produce.

The shorthand is to look at **code *shape*, not domain**: high **blast radius**, **concurrency**, a **security boundary**, and a **small/stable/high-value** footprint. When several stack up, climb the ladder; when none do, a property test or a strong type is the right answer.

### Q: Walk me through the canonical industry success stories and what each *kind* of system they validate.

> **Testing:** Whether your conviction rests on real evidence, mapped to the criteria above.

**A.** Each maps to one of the criteria:

- **AWS + TLA+** (distributed protocols, lightweight). Engineers specified DynamoDB, S3, and other services in TLA+ and found bugs needing 35-step traces — design flaws in replication and fault-tolerance no test caught. Validates *concurrency/distributed* via the *cheap* rung.
- **seL4** (OS kernel, heavyweight). A microkernel with a machine-checked proof, in Isabelle/HOL, that the C implementation refines its abstract spec and is free of whole classes of bugs. Validates *small/stable/high-value core* via the *top* rung — ~20 person-years for ~10k lines.
- **CompCert** (compiler, heavyweight). A C compiler proven in Coq to preserve program semantics — so its output is trustworthy where a normal compiler's miscompilation is invisible. The Csmith fuzzing study famously found bugs in GCC and Clang but **none in CompCert's verified core**. Validates a *high-blast-radius foundation*.
- **Fiat-Crypto / HACL\*** (cryptography). Verified crypto primitives — Fiat-Crypto-generated field arithmetic ships in BoringSSL and is used in Chrome; HACL\* code runs in Firefox and the Linux kernel. Validates the *security/crypto boundary*.
- **Smart-contract verification** (irreversible money). Tools like Certora and the Move prover check invariants on contracts where a bug is an immediate, **unrecoverable** drain — the purest "catastrophic + unrecoverable" case.

The pattern across all five: a **small, dangerous, high-value artifact** — kernel, compiler, crypto routine, protocol, contract — not a big sprawling application.

### Q: I hand you a 2-million-line enterprise app. Where, if anywhere, would formal methods go?

> **Testing:** "Verify the core, test the rest" applied to a realistic, mostly-mundane system — the staff judgement call.

**A.** Almost none of it, and that's the correct answer. I'd hunt for the **small dangerous cores** hiding inside the sprawl and verify *those*, leaving the 99% of CRUD, glue, and UI to ordinary testing:

- A **distributed coordination** mechanism (a custom leader-election, a saga/2-phase commit, a dedup protocol) → a **TLA+** model of the design.
- A **money or entitlement** calculation where an off-by-one is a real loss → **property-based tests** for the invariants ("balance never negative," "debits == credits"), maybe Dafny if it's both small and critical.
- A **permissions / access-control** model → **Alloy**, which is built for exactly "can any sequence of grants produce an unauthorized read?"
- A **parser/serializer** on a trust boundary → **property tests** (round-trip, no-crash on arbitrary bytes) as the cheap, high-value rung.

The framing I'd give leadership is **verify the core, test the rest**: rigor is a budget, and you spend it on the small high-value heart of the system where a bug is catastrophic and hard to find by testing — not uniformly across two million lines, which would bankrupt the team and verify mostly trivia.

---

## The Design-Time Argument

### Q: This is the differentiator — what's the single most under-appreciated way formal methods pay off?

> **Testing:** Whether you understand that the ROI is usually in *modeling the design*, not *proving the code*.

**A.** **The biggest return is finding bugs while you write the spec, before any code exists** — not the proof at the end. When you formalize a design in TLA+ or Alloy, the *act of being precise* forces you to confront the edge cases, race conditions, and "what happens if this message is lost / reordered / duplicated?" questions that prose design docs and whiteboards gloss over. A huge fraction of the bugs are caught **in the modeling**, often before you've even run the checker, simply because ambiguity that hides in English cannot hide in a formal spec.

This matters because **design-time bugs are the cheapest bugs there are**. The cost of a defect rises by orders of magnitude from design → code → test → production. A flaw caught while modeling a protocol costs an afternoon; the same flaw discovered as data corruption in production costs an incident, a postmortem, and possibly customer trust. So even teams that *never prove a line of their implementation* get enormous value from modeling the design — the spec is a **bug-finding and thinking tool**, and that's where most of the money is.

### Q: AWS reported a benefit beyond catching bugs — "the courage to optimize." Explain it.

> **Testing:** A deep, specific signal that you've read the source material and grasped a second-order payoff.

**A.** Once you have a model checker that exhaustively verifies your design's correctness properties, you gain the **confidence to make aggressive optimizations you'd otherwise be too scared to ship**. The AWS engineers described this directly: a precise, checkable spec let them attempt complex performance optimizations to a production system, because they could **re-check the optimized design** and *know* it still satisfied the safety and liveness properties — rather than fearing that a clever change had quietly introduced a subtle race.

So the spec isn't only a defensive bug-catcher; it's an **enabler of bold change**. Without it, complex correctness-sensitive code calcifies — nobody dares touch it because nobody can prove a change is safe, so it ossifies and accrues workarounds. With a checkable model, the team can keep optimizing aggressively. That's a recurring, compounding payoff that a one-time bug count badly understates: the spec lowers the *future* cost and risk of change, which is often where a long-lived system's real money is.

### Q: If the design-time win is so large, when would you still bother proving the *implementation*?

> **Testing:** Whether you know the boundary of the cheap rung — that a verified *design* doesn't mean a correct *program*.

**A.** A model checker validates the **design/abstraction**, not the code that ships — there's a gap between the TLA+ spec and the Java, and bugs can live in that gap (the implementation can diverge from the model). You climb to **deductive verification or a proof assistant** when that gap itself is intolerable: when even a correct design implemented slightly wrong is catastrophic. That's exactly the seL4/CompCert/crypto regime — a microkernel where a single C-level deviation breaks isolation, a compiler whose miscompilation silently corrupts every program it builds, a crypto routine whose constant-time property must hold in the *actual* machine code. There, you prove the implementation refines the spec because the blast radius of the abstraction gap is unbounded. For the other 95% of systems, validating the design and *testing* the implementation against it is the right, affordable tradeoff — you don't pay person-years to close a gap whose worst case is a redeployable bug.

---

## Limits & Honesty

### Q: A component is labeled "formally verified" but it failed in production. How is that possible?

> **Testing:** The single most important honesty question — whether you understand what "proven correct" actually scopes to.

**A.** Entirely possible, because **"proven correct" means "the code provably meets *its specification*, modulo the *axioms* and the *trusted computing base*"** — not "this can never fail." Each clause is a real escape hatch:

1. **The spec can be wrong or incomplete.** You proved the code matches what you *said* you wanted, but what you said wasn't what you *needed*. Knuth's quip — *"I have only proved it correct, not tried it"* — is exactly this: the proof inherits every flaw of the spec. If the spec never mentioned a case, the proof says nothing about it.
2. **Unmodeled reality.** Side channels (timing, power, Spectre-style speculation), hardware faults, cosmic-ray bit flips, a clock that runs backwards — anything outside the model is outside the proof. A constant-time-*proven* routine can still leak via a microarchitectural channel the model didn't include.
3. **The TCB.** The proof trusts the prover/checker, the compiler (unless it's CompCert), the OS, the hardware, and any `assume`/axiom in the development. A bug in *those* can sink a "verified" component.
4. **Spec rot.** The code or its environment evolved and the spec didn't — the proof now certifies an obsolete contract.

So the correct mental model is **conditional, not absolute**: "verified" relocates trust from "the whole implementation" to "the spec + the axioms + the TCB." That's a *much* smaller, *much* more auditable surface — which is the whole point — but it is emphatically not "cannot fail." A senior engineer states the scope before claiming the assurance.

### Q: Given those limits, isn't a wrong-but-proven system *worse* than an unproven one — false confidence?

> **Testing:** Whether you can steelman the critique and answer it without dogma.

**A.** It's a real failure mode, not a strawman: a "verified" sticker can manufacture **false confidence** that suppresses the testing and skepticism the team would otherwise apply, and if the *spec* is wrong, the proof launders a bug into a guarantee. But the fix isn't to abandon verification — it's to be precise about what it bought you. Verification's genuine value is that it **shrinks where bugs can hide** from "anywhere in the implementation" down to "the spec, the axioms, and the TCB," and then lets you concentrate review on *that small surface*. The mature posture is to verify *and* keep validating the spec against reality — review the spec harder than you reviewed the code, fuzz the boundaries the model abstracts, and treat side channels and the TCB as explicit residual risks. False confidence comes from forgetting the modulo clause, not from the proof itself. Used honestly, verification redirects scrutiny to where it's most leveraged; used as a talisman, it backfires.

### Q: If formal methods are so powerful, why isn't all critical software formally verified today?

> **Testing:** Whether you understand the real-world adoption barriers beyond "it's hard."

**A.** Because the barriers are economic and human, not just technical:

- **Skills.** The people who can drive Coq or Isabelle are scarce and expensive; even TLA+, far easier, needs deliberate training most teams haven't done.
- **Tooling & ergonomics.** Proof assistants have steep learning curves and brittle automation; counterexamples can be cryptic; integration with mainstream toolchains is improving but immature.
- **Cost & ROI.** Heavyweight proof can be person-*years* (seL4: ~20 for ~10k lines). For software that ships weekly and whose worst bug is a fast rollback, that math never closes.
- **Maintenance.** Specs and proofs are **living artifacts** — every requirement change can break a proof, so verified code is *more* expensive to evolve, which collides with fast-moving products.
- **Culture.** Most orgs are optimized for shipping speed; FM is perceived (often wrongly, for the lightweight rungs) as an academic luxury.

The nuance is that these barriers are *high for the top rungs and low for the bottom ones*. Lightweight FM (TLA+, Alloy, property testing) clears most of them, which is why it's diffusing into industry while heavyweight proof stays niche. "Not everywhere" is rational triage, not ignorance — and the lightweight end is *under*-adopted relative to its ROI.

---

## Judgement & Scenarios

### Q: Scenario — you have **2 weeks** and a team has designed a **new consensus protocol**. What assurance do you apply?

> **Testing:** The flagship judgement question — can you pick the right rung under a real constraint?

**A.** **TLA+, and only TLA+ — model the design, don't prove the code.** The shape screams for it: consensus is *distributed and concurrent* (worst-case for human intuition and testing), and it's a *small, high-value core* everything depends on. In two weeks I cannot prove an implementation, but I can absolutely write a TLA+ spec of the protocol and run TLC.

Concretely: state the **safety** properties first (agreement — no two nodes decide different values; validity — a decided value was proposed) and a key **liveness** property (termination — some value is eventually decided under fairness). Model the adversary the protocol claims to tolerate — message loss, reordering, duplication, node crashes. Run the checker on a small bounded configuration (3–5 nodes, bounded messages) to dodge state explosion. The expected, high-probability payoff is a **counterexample**: a specific interleaving — say, a stale leader and a network partition that lets two values commit — that the team would never have constructed by hand. That's precisely the AWS playbook: weeks of TLA+ on the *design* catches deep protocol bugs cheaply. Proving the eventual Go/Rust code is a *later, separate* decision — out of scope for two weeks, and probably not worth it unless this is a kernel-grade core.

### Q: Scenario — leadership read about seL4 and now wants **everything formally verified**. What do you advise?

> **Testing:** Whether you can redirect misplaced enthusiasm into a sane strategy without killing the initiative.

**A.** I'd channel the energy, not crush it. The advice in order:

1. **Reframe the goal.** "Formally verify everything" would cost person-years for assurance most of our code doesn't need — a redeployable web bug doesn't justify a proof. The right goal is **verify the core, test the rest**: find the few small, catastrophic-and-unrecoverable, concurrency- or security-critical cores and apply rigor *there*.
2. **Start lightweight, not heavyweight.** seL4 is the *top* rung — wrong starting point. Begin with **TLA+ or property-based testing** on one high-value target. Lightweight FM gets most of the bugs for a fraction of the cost and is learnable in weeks; that's the AWS path, and it's the one with realizable ROI.
3. **Prove the value on a real wound.** Pick a system that recently had a nasty concurrency/distributed incident, model it, and let the checker rediscover (or improve on) the bug. A concrete win on a *past production incident* converts skeptics far better than a slide on Curry–Howard.
4. **Be honest about the modulo clause.** Even seL4's proof is "correct modulo spec + axioms + TCB." Set expectations that verification *relocates and shrinks* risk; it doesn't grant invulnerability.

Net: yes to rigor, targeted at the cores, starting lightweight, justified by a fast win — not a blanket mandate that would burn credibility and budget.

### Q: When would you explicitly *not* use formal methods, even lightweight ones?

> **Testing:** Whether you'll say "no" — the inverse judgement that separates engineers from enthusiasts.

**A.** When the cost clears nothing. I'd *not* reach past ordinary testing when **all** of these hold: the **blast radius is small and recoverable** (a bug is a quick rollback, not lives or irreversible money); the code is **simple and sequential** (no concurrency, no protocol, no adversary); it's **churning fast** (early-stage product, requirements changing weekly) so any spec rots before it pays; and it sits **outside any security/safety/regulatory boundary**. A typical CRUD feature, an internal dashboard, a marketing page, a throwaway script — testing and types are the correct, sufficient, *economical* answer; modeling them would be pure gold-plating. I'd also decline *heavyweight* proof specifically when a *lightweight* rung already retires the real risk — proving an implementation that a TLA+ model and property tests have already de-risked is effort better spent elsewhere. The discipline isn't "use FM"; it's "spend assurance where it pays," and sometimes the honest answer is "a unit test is enough."

### Q: How do you actually *choose a rung* for a given component? Give me a procedure.

> **Testing:** Whether your judgement is a repeatable rubric, not case-by-case intuition.

**A.** A short decision procedure:

1. **Score the risk.** Rate blast radius (recoverable → catastrophic), concurrency (none → distributed protocol), security exposure (internal → adversarial boundary), and core-ness (peripheral → small-stable-everything-depends-on-it).
2. **Low across the board?** Stop at **types + tests** (+ a SAST gate). Don't gold-plate.
3. **Concurrency or a tricky protocol?** Model the **design** — **TLA+** (temporal/distributed) or **Alloy** (structural/permissions). This is the highest-ROI rung and where most teams should land for hard design problems.
4. **A small, critical, *algorithmic* unit** (parser, crypto, money math)?** Property-based tests first; **Dafny/SPARK** if it's both small and the abstraction gap is intolerable.
5. **Catastrophic, unrecoverable, foundational core, and even a design-correct-but-code-wrong bug is unacceptable?** Only then **prove the implementation** (Coq/Isabelle/Lean) — kernel/compiler/crypto regime.
6. **Always** climb the **cheapest rung that retires the *actual* risk**, and re-evaluate as the component's risk profile changes.

The rule of thumb threaded through it: **match the tool to the risk**, prefer lightweight, and reserve heavyweight for the rare core that genuinely earns person-years.

### Q: What are the classic *failure modes* of teams adopting formal methods?

> **Testing:** Whether you can name the anti-patterns — the sign you've seen FM go wrong, not just right.

**A.** Three dominate:

- **Gold-plating / "prove everything."** Applying rigor uniformly, including to trivial recoverable code, which blows the budget and verifies mostly nothing-burgers. The fix is *verify the core, test the rest*.
- **Verifying the wrong thing.** Proving the code matches a **wrong or incomplete spec** — effort spent certifying a bug. This is the Knuth trap; the antidote is to review the *spec* at least as hard as the code and validate it against reality.
- **Mistaking the rung.** Starting at proof assistants (the seL4 rung) for a problem a TLA+ model would crack in a week, or conversely shipping a hairy consensus protocol with only unit tests. Both are tool/risk mismatches.

A fourth, subtler one: **treating "verified" as final** and dropping the testing, fuzzing, and spec-maintenance that keep the *modulo* clause honest as the system evolves. Naming these is the tell that you've watched FM both succeed and fail — and know the difference is judgement, not tooling.

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: Name the five rungs of the ladder.** A: Types/linters → property-based testing → lightweight modeling (TLA+/Alloy) → deductive verification (Dafny/SPARK) → proof assistants (Coq/Isabelle/Lean).
- **Q: Lightweight vs heavyweight FM in one line?** A: Lightweight checks the *design/abstraction* cheaply (TLA+, Alloy, property tests); heavyweight proves the *implementation* against a spec at person-year cost (seL4, CompCert).
- **Q: Where's the biggest ROI, usually?** A: Modeling the **design** — finding bugs while writing the spec, before code exists — not proving the code.
- **Q: One phrase for the spend strategy?** A: "Verify the core, test the rest."
- **Q: What does "proven correct" actually mean?** A: Code meets *its spec* modulo the *axioms* and the *TCB* — not "cannot fail."
- **Q: Whose quip captures the spec limit?** A: Knuth — "Beware of bugs in the above code; I have only proved it *correct*, not tried it."
- **Q: Two weeks, new distributed protocol — what tool?** A: TLA+ on the design; expect a counterexample.
- **Q: Verified component failed in prod — likeliest cause?** A: The spec was wrong/incomplete, or an unmodeled side channel / TCB bug.
- **Q: When NOT to use FM?** A: Small recoverable blast radius, sequential, fast-churning, outside any security/safety boundary — test it.
- **Q: One unexpected AWS benefit of TLA+?** A: "Courage to optimize" — a checkable model let them make aggressive changes confidently.
- **Q: A verified crypto example shipping in real browsers?** A: Fiat-Crypto (BoringSSL/Chrome) and HACL\* (Firefox, Linux kernel).
- **Q: Why is verified code *more* expensive to maintain?** A: Specs and proofs are living artifacts — requirement changes can break the proof.
- **Q: Best way to sell FM to a skeptical org?** A: Start lightweight, model a *past incident*, show a fast concrete win.
- **Q: Alloy vs TLA+ at a glance?** A: Alloy for structural/relational properties (permissions, schemas); TLA+ for temporal/concurrent/distributed behavior.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**

- "Just formally verify it" with no mention of cost, rung, or which *part*.
- Reflexively reaching for a proof assistant (seL4 rung) for a problem TLA+ would solve in a week.
- Treating "verified" as "cannot fail" — missing the spec/axioms/TCB modulo clause.
- Believing the payoff is the *proof*, not the *design-time* bug-finding.
- Never saying "no" — wanting rigor everywhere, including recoverable CRUD (gold-plating).
- Equating high test coverage with proof, or proof with omniscience.
- No real examples — can't ground conviction in AWS/seL4/CompCert.

**Green flags:**

- Naming the *judgement* ("match the tool to the risk," "verify the core, test the rest") before naming a tool.
- Reaching for the **cheapest rung that retires the real risk** — usually lightweight.
- Stressing **design-time modeling** as the main ROI, with the AWS "courage to optimize" payoff.
- Stating the **modulo spec/axioms/TCB** scope unprompted when saying "verified."
- Knowing **when not to** — and saying so plainly.
- Grounding claims in case studies mapped to *criteria* (concurrency, blast radius, security boundary, small core).
- Treating spec review and continued testing as part of verification, not afterthoughts.

---

## Cheat Sheet

| Situation | Right move | Why |
|---|---|---|
| CRUD feature, recoverable bug, sequential | Types + tests (+ SAST) | Cheapest rung clears the risk; rigor would be gold-plating |
| Pure function with invariants / round-trips | Property-based testing | "For all inputs" without a proof obligation |
| New consensus / replication / locking design | **TLA+** model the design | Concurrency + small high-value core; expect a counterexample |
| Permissions / access-control / schema | **Alloy** | Built for "can any sequence reach an illegal state?" |
| Small critical algorithm (parser, money math) | Property tests → Dafny if gap intolerable | Match cost to how unrecoverable a wrong result is |
| Kernel / compiler / crypto primitive | **Proof assistant** (Coq/Isabelle/Lean) | Catastrophic, unrecoverable, design-correct-but-code-wrong is fatal |
| Skeptical org, want buy-in | Lightweight + model a past incident | Fast concrete win beats theory |
| Someone says "verified, can't fail" | Restate: correct *modulo* spec + axioms + TCB | Relocates and shrinks risk; doesn't eliminate it |

**The four judgements, distilled:** match the tool to the risk · the spec is the product · "proven" is scoped (spec/axioms/TCB) · verify the core, test the rest.

---

## Summary

- The bank reduces to four judgements in costumes: **match the tool to the risk**, **the spec is the product** (design-time bug-finding is the main ROI), **"proven correct" is scoped** (modulo spec, axioms, TCB), and **verify the core, test the rest**. Name the judgement before the tool.
- **The ladder** climbs from near-free (types/linters), through low-cost for-all *thinking* (property testing), to design-level modeling (TLA+/Alloy), to proving code (Dafny/SPARK), to proving arbitrary theorems (Coq/Isabelle/Lean). Cost and assurance rise together; most software belongs on the cheap rungs, which are *under*-used, not over-used.
- **Where it pays:** catastrophic-and-unrecoverable failure, concurrency/distributed protocols, security/crypto boundaries, small/stable/high-value cores, and regulated/safety-critical domains — judged by code *shape* (blast radius, concurrency, boundary, footprint), evidenced by AWS/TLA+, seL4, CompCert, Fiat-Crypto/HACL\*, and smart-contract verification.
- **The design-time argument** is the differentiator: the biggest return is finding bugs *while writing the spec*, before code exists, because design-time bugs are the cheapest — plus the second-order "courage to optimize" a checkable model grants.
- **Limits & honesty:** a verified component can still fail because the *spec* can be wrong, reality can be *unmodeled* (side channels), the *TCB* is trusted, and specs *rot*. Verification relocates and shrinks risk; it doesn't abolish it. FM isn't everywhere because of skills, tooling, cost, maintenance, and culture — rational triage, with the lightweight rungs clearing most barriers.
- **Scenarios:** two weeks + a new protocol → TLA+ on the design; "verify everything" mandate → reframe to *verify the core*, start lightweight, win on a past incident; *not* using FM is correct for small/recoverable/sequential/fast-churning code; a verified-but-failed component is the modulo clause biting. The failure modes are gold-plating, verifying the wrong (spec) thing, and mistaking the rung.

---

## Further Reading

- **Newcombe, Rath, Zhang, Munteanu, Brooker & Deardeuff — *"How Amazon Web Services Uses Formal Methods"* (CACM, 2015).** The definitive industry case for *lightweight* FM: TLA+ on designs, the 35-step bugs, and the "courage to optimize" payoff. Read this first.
- **Hillel Wayne — *"Why Don't People Use Formal Methods?"*** A clear-eyed survey of the real adoption barriers — skills, tooling, maintenance, culture — and where the lightweight rungs change the calculus.
- **Pierce et al. — *Software Foundations*.** The on-ramp to mechanized proof (Coq/Rocq) for when you genuinely need the top rung — and to understand what "machine-checked" actually entails.
- *Specifying Systems* (Lamport) for TLA+, *Software Abstractions* (Jackson) for Alloy, and the **seL4** and **CompCert** papers as the heavyweight milestones the scenarios reference.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — this interview bank is grounded in the framing and case studies developed there.

---

## Related Topics

- [01 — Formal Specification](../01-formal-specification/interview.md) — what a spec *is* and why it's the hard part; the design-time argument starts here.
- [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/interview.md) — the lightweight workhorse behind the "two weeks, new protocol" answer.
- [04 — Property & Contract Verification](../04-property-and-contract-verification/interview.md) — the practical middle rungs: property tests, contracts, Dafny.
- [05 — Proof Assistants & Dependent Types](../05-proof-assistants-and-dependent-types/interview.md) — the top rung; seL4/CompCert and what "machine-checked" really costs and claims.
- [Testing](../../testing/) — the rung below FM; "verify the core, **test** the rest" leans on it.
