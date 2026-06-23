# Proof Assistants & Dependent Types — Professional Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → Proof Assistants & Dependent Types
> *The earlier tiers taught you what a dependent type is and how a tactic discharges a goal. This page is about the only question a staff engineer actually faces: is machine-checked proof EVER worth it for us, and if so, for exactly which 200 lines — because this is the heaviest, most expensive, most maintenance-hungry tool in the entire verification kit, and reaching for it by default is a career-defining mistake in the wrong direction.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Honest Default Is "No"](#core-concept-1--the-honest-default-is-no)
5. [Core Concept 2 — The Economics: Proof-to-Code Ratios and the Maintenance Tax](#core-concept-2--the-economics-proof-to-code-ratios-and-the-maintenance-tax)
6. [Core Concept 3 — Verify the Core, Test the Rest](#core-concept-3--verify-the-core-test-the-rest)
7. [Core Concept 4 — Generate-and-Prove Beats Hand-Prove](#core-concept-4--generate-and-prove-beats-hand-prove)
8. [Core Concept 5 — The TCB: What the Proof Does NOT Guarantee](#core-concept-5--the-tcb-what-the-proof-does-not-guarantee)
9. [Core Concept 6 — Hiring, Tooling, and CI for Proofs](#core-concept-6--hiring-tooling-and-ci-for-proofs)
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

> Focus: **The judgment call of taking on machine-checked proof — when the catastrophe-times-immutability math justifies a 15:1 proof-to-code ratio and a perpetual maintenance bill, and the discipline of communicating honestly what "proven" does and does not buy.**

The theory tiers showed you the Curry–Howard correspondence, that a type can encode a proposition, and that Coq, Isabelle/HOL, Lean, and Agda let a machine check that a proof is airtight. None of that is the professional problem. The professional problem is that proof assistants are extraordinarily expensive, and almost every team that reaches for one should not have.

For roughly 99% of software, a proof assistant is the *wrong* tool: property-based testing, design-by-contract, a TLA+ model of the concurrency, and a fuzzer with sanitizers will deliver far more assurance per engineer-hour than a Coq development ever could. The 1% where machine-checked proof pays is narrow and specific — a bug must be **catastrophic** *and* **unrecoverable** *and* the artifact must be **small, stable, and high-value**. Compilers (CompCert), OS kernels and hypervisors (seL4), cryptographic primitives (Fiat-Crypto in BoringSSL, HACL\*/EverCrypt in Firefox and in cloud crypto stacks), some aerospace and rail control, smart contracts that are immutable and hold money, and hardware. Outside that envelope, the proof effort is assurance you could have bought far more cheaply elsewhere.

This page assumes you already know how proofs work. It's about the staff/principal decision: whether to take on a proof at all, exactly which sliver to verify, which lighter-weight cousin to try first, and — the issue that sinks more verification efforts than any other — how to budget for **proof maintenance**, because a proof is not a one-time cost. It's a standing obligation that breaks every time the code or spec changes.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — dependent types, the Curry–Howard correspondence, tactics, how Coq/Lean/Isabelle/Agda check a proof, extraction.
- **Required:** [04 — Property & Contract Verification](../04-property-and-contract-verification/professional.md) — the cheaper assurance tools that are the *correct* default and the baseline you must beat.
- **Helpful:** You've owned a system where a defect was genuinely unrecoverable (shipped firmware, a deployed smart contract, a released compiler).
- **Helpful:** You've made a build-vs-buy or invest-vs-defer call on a multi-person-year engineering bet and lived with the consequences.

---

## Glossary

| Term | Meaning |
|---|---|
| **Proof assistant** | An interactive tool (Coq, Isabelle/HOL, Lean, Agda) where a human guides the construction of a proof that a machine then mechanically checks. |
| **Proof-to-code ratio** | Lines of proof/spec per line of verified executable code. 10:1 to 20:1 is typical for full functional-correctness proofs. |
| **Proof engineer** | A scarce, expensive specialist fluent in both the domain and a proof assistant. Closer to a PhD-level hire than a generalist SWE. |
| **Proof maintenance / proof rot** | The ongoing cost of repairing proofs that break when code, specs, libraries, or the prover change. The dominant lifecycle cost. |
| **TCB (Trusted Computing Base)** | Everything you must trust for the guarantee to hold but did *not* prove: the spec, the prover's kernel, axioms, the extraction step, the compiler, the hardware. |
| **Extraction gap** | The trust hole between the verified model and the actually-executing artifact (e.g., Coq → OCaml extraction, or proving a C-like spec while linking unverified C). |
| **Functional correctness** | A proof that code meets a *full behavioral specification*, not just that it's memory-safe or crash-free. The expensive end of the spectrum. |
| **Generate-and-prove** | Producing code from a high-level spec together with its proof (Fiat-Crypto), instead of writing code by hand and proving it after the fact. |
| **Lighter-weight verifier** | Dafny, F\*, Liquid Haskell — tools with heavy automation (SMT-backed) that prove *weaker* properties at a *fraction* of the cost of full Coq/Isabelle. |

---

## Core Concept 1 — The Honest Default Is "No"

The single most valuable thing a staff engineer can contribute to a "should we formally verify this?" conversation is the courage to say **no** for the right reasons. Proof assistants have a gravitational pull on smart engineers: the math is beautiful, the guarantee is absolute, and "we proved it correct" is intoxicating. That pull is precisely why the default answer must be skeptical.

Compare what a fixed engineering budget buys:

| Method | Effort to deploy | Assurance it buys | Catches |
|---|---|---|---|
| Property-based testing | Hours–days | High, cheap | Logic bugs across huge input spaces |
| Design-by-contract + runtime checks | Hours | Medium, continuous | Precondition/invariant violations in prod |
| Fuzzing + sanitizers (ASan/UBSan) | Days | High for memory/UB | Crashes, overflows, UB, the bug classes that actually ship |
| TLA+ / model checking | Days–weeks | High for concurrency/protocol | Deadlocks, race conditions, lost updates |
| **Proof assistant (full functional correctness)** | **Person-years** | **Total — within the spec** | **Everything the spec rules out — at 10–20× the cost** |

For a typical web service, mobile app, internal tool, or data pipeline, the bottom row is absurd. A bug there is *recoverable*: you roll back, hotfix, redeploy in minutes. The blast radius is bounded and the cost of being wrong is low. Spending person-years to prove a CRUD handler correct is not diligence; it's a misallocation that the four cheaper rows would have served better.

The honest framing for stakeholders: a proof assistant is not "more testing." It is a categorically different, categorically more expensive instrument that earns its keep only when *both* of the following hold — the failure is catastrophic and unrecoverable, *and* the artifact is small, stable, and valuable enough that amortizing person-years across its lifetime makes sense. If you can't say yes to both halves, the answer is the cheaper toolbox.

> **The principal's filter:** before anyone writes a line of Coq, ask "what happens when this component has a bug?" If the answer is "we roll back and ship a fix by lunch," you do not need a proof assistant — you need the tools in [04 — Property & Contract Verification](../04-property-and-contract-verification/professional.md). Reserve machine-checked proof for the components where "ship a fix" is not on the table.

---

## Core Concept 2 — The Economics: Proof-to-Code Ratios and the Maintenance Tax

The numbers from real verified-software projects are the antidote to romanticism. They are public, and they are sobering.

- **seL4** — the verified microkernel — is roughly **8,700 lines of C**, proven correct against an abstract specification. The proof effort was on the order of **20+ person-years**, and the proof artifact (Isabelle/HOL) ran to **hundreds of thousands of lines** — proof-to-code ratios cited in the **~20:1** range for the functional-correctness layer. The team estimated that a comparable assurance via traditional means (e.g., Common Criteria EAL7) would have cost *more* — but the absolute number was still tens of person-years.
- **CompCert** — the verified C compiler — represents many person-years from a small expert team, with the correctness proof (in Coq) dwarfing the compiler source.
- **Fiat-Crypto** and **HACL\***/EverCrypt show the ratio can be bent dramatically with the right approach (Concept 4), but the *underlying* hand-proof techniques carry the same 10:1–20:1 tax.

Two consequences follow, and the second is the one that kills projects:

**1. The up-front cost is multi-person-year and the talent is scarce.** Proof engineers who can drive Isabelle or Coq on a real artifact are rare and expensive — closer to a specialized PhD hire than a generalist you can backfill. You cannot staff this from your existing team next sprint. Budget years and a hiring or academic-partnership pipeline, not a quarter.

**2. Proof maintenance is the real bill, and it never stops.** This is the issue that gets hidden in the excitement of the first proof. A proof is a rigid object bolted to a specific version of the code and the spec. *Every* change can break it:

- Refactor a verified function's internals → the tactic proof that depended on its old shape fails, and you re-prove.
- Add a feature to the spec → invariants ripple, and proofs across the development break.
- Upgrade the prover (Coq 8.x → 8.y) or a proof library → tactics behave differently and proofs rot.

```text
Lifecycle cost of a verified component (the part teams forget)

  Year 0:  ████████████████  initial proof effort (the part you budgeted)
  Year 1:  ████              every code/spec change re-breaks proofs
  Year 2:  ████              prover/library upgrades rot brittle tactics
  Year 3:  ████              "we can't change X because re-proving costs a month"
                              ↑ proof maintenance becomes a permanent tax
                                AND a drag on the velocity of the verified part
```

The second-order effect is worse than the cost line: a heavily-proven component becomes **expensive to change**, so it ossifies. That's *fine* for a stable artifact (a finished crypto primitive, a frozen kernel API) — stability is exactly why those are good candidates. It is poison for anything still evolving. The maintenance tax is the single best predictor of whether a verification effort survives contact with a real, changing codebase.

> **The lesson that recurs in every failed effort:** you are not buying a proof. You are signing up for a *proof-engineering practice* — a standing obligation to keep proofs green as the artifact and the prover evolve. Budget the perpetuity, not the purchase. If the artifact won't hold still, the perpetuity will bankrupt the effort.

---

## Core Concept 3 — Verify the Core, Test the Rest

The strategy that actually ships in industry is **not** "prove the system." It is **prove a tiny, stable, critical kernel, and surround it with cheaper methods.** Every successful real-world deployment of proof assistants is an instance of this pattern.

The shape:

```text
        ┌─────────────────────────────────────────────┐
        │  Everything else: UI, I/O, glue, config,     │
        │  orchestration                                │
        │  → property tests, contracts, fuzzing, review │
        │   (cheap assurance, ~90% of the LOC)          │
        │                                               │
        │     ┌───────────────────────────────────┐    │
        │     │  THE CORE: tiny, stable, critical  │    │
        │     │  a crypto routine, a serializer,   │    │
        │     │  a state machine, a parser          │    │
        │     │  → machine-checked proof            │    │
        │     │   (expensive assurance, ~1% LOC)    │    │
        │     └───────────────────────────────────┘    │
        └─────────────────────────────────────────────┘
```

Why this works and "prove everything" doesn't:

- **The core is where catastrophe lives.** A field-arithmetic routine in elliptic-curve crypto, a kernel's capability-enforcement logic, a smart contract's settlement math — a bug here is unrecoverable. The UI around it is recoverable. Spend the expensive tool only where the cost of being wrong justifies it.
- **The core is small and stable.** Crypto primitives don't change once correct. A finalized serialization format is frozen. That stability is what makes the proof-maintenance tax (Concept 2) affordable — there's little to re-prove because there's little churn.
- **The boundary is where you concentrate `defensive` effort.** The proof guarantees the core's behavior *given its preconditions*. The surrounding code's job is to *establish* those preconditions — validate inputs, enforce the contract at the boundary — using contracts and property tests. The proof and the tests meet at the interface.

Concretely, picking the slice is the hard, high-leverage decision:

- **Good slices:** a constant-time field-arithmetic routine; a parser/serializer for a wire format (round-trip + no-crash); a state machine with a safety invariant; an authorization-decision function; a fixed-point or saturating-arithmetic primitive.
- **Bad slices:** "the payment service" (too big, too much I/O, changes weekly); "our API" (an evolving surface); anything whose spec you can't write down crisply (if you can't specify it, you can't prove it).

> **The strategy in one sentence:** find the *smallest* component whose failure is catastrophic and that will *hold still*, prove exactly that, and use property tests, contracts, and fuzzing for everything else — including the boundary that feeds the verified core. Trying to push the proof boundary outward into the changing parts is how teams drown.

---

## Core Concept 4 — Generate-and-Prove Beats Hand-Prove

When proof *is* justified, the next staff-level decision is *how* to obtain it — and the most important lever for the maintenance tax is **generate-and-prove** over hand-prove.

The canonical example is **Fiat-Crypto** (Erbsen et al.). Hand-writing constant-time, carry-correct big-integer field arithmetic for elliptic curves is a notorious source of subtle, exploitable bugs — and hand-proving each implementation is enormous, per-curve work. Fiat-Crypto instead takes a *high-level specification* of the field arithmetic and *generates* optimized C code **together with a Coq proof of its correctness**, automatically, per curve and per platform. The output is in **BoringSSL** (and thus Chrome) and elsewhere — generated, proven code running in one of the most security-critical paths on the internet.

Why this is the superior posture when it's available:

- **The maintenance unit changes.** You maintain the *generator and the high-level spec*, not thousands of lines of hand-tuned, hand-proven C. Want a new curve or a new platform? Re-run the generator; the proof comes with the output. The proof-rot problem (Concept 2) largely evaporates because humans aren't editing the proven artifact.
- **It scales across instances.** One proven generator yields proven code for *many* targets. Hand-proof gives you one proven artifact for one target.
- **It eliminates a whole bug class at the source.** Carry-propagation and constant-time bugs in field arithmetic are *designed out*, not found-and-fixed.

The sibling lesson is **HACL\***/EverCrypt: a verified cryptographic library (written and proven in **F\***, an SMT-backed dependent-type language) that provides verified implementations of mainstream primitives (ChaCha20-Poly1305, Curve25519, SHA-2/3, etc.), shipped in **Firefox**'s NSS and used in cloud crypto stacks. Note the tool choice — F\* with SMT automation, not raw Coq tactics — which is the bridge to the next decision.

So the ordering for a justified proof effort:

1. **Can you generate-and-prove?** (Fiat-Crypto-style.) If yes, strongly prefer it — you trade hand-proof for spec+generator maintenance.
2. **Can a lighter, automated tool do it?** (F\*/Dafny/Liquid Haskell — Decision Frameworks below.) Heavy SMT automation can be an order of magnitude less labor than tactic-driven Coq/Isabelle for many properties.
3. **Only then, hand-proof in Coq/Isabelle/Lean** — for the properties too deep or too bespoke for automation (CompCert and seL4 live here, and they earned it).

> **The principal's preference order:** generate-and-prove > automated lightweight verifier > hand-proof in a full proof assistant. Each step down is roughly an order of magnitude more human labor *and* more proof-maintenance exposure. Reach for raw Coq/Isabelle last, not first.

---

## Core Concept 5 — The TCB: What the Proof Does NOT Guarantee

The most dangerous failure mode of a verification program is not a broken proof — it's a *correct* proof that everyone misreads as a stronger guarantee than it is. "Proven correct" lands in a non-specialist's ear as "cannot ever fail." It means no such thing. Communicating the boundary honestly is a core staff responsibility.

A machine-checked proof guarantees exactly one thing: **the code satisfies the specification, assuming the Trusted Computing Base is sound.** Everything in that TCB is trusted, not proven:

| You proved | You are still trusting (the TCB) |
|---|---|
| Code meets the spec | **The spec is right.** A wrong/incomplete spec is proven-correct nonsense — Knuth's *"Beware of bugs in the above code; I have only proved it correct, not tried it."* |
| The proof type-checks | **The prover's kernel** is sound (small and battle-tested in Coq/Isabelle, but still trusted). |
| Theorems follow from axioms | **The axioms** you assumed (e.g., classical logic, function extensionality, any `Axiom` you `admit`ted). |
| The *model* is correct | **Extraction/compilation** preserves it — Coq→OCaml extraction, or proving a C spec then compiling with an *unverified* compiler. The **extraction gap**. |
| Functional behavior | **Hardware** behaves as modeled — no Rowhammer, no faults, no microarchitectural surprises. |
| The modeled behavior | **What you didn't model** — most notoriously **side channels** (timing, power, cache). A functionally-correct crypto routine can still leak keys via timing if constant-time wasn't *in the spec*. |

This is why the precise claim matters. seL4's famous result is *functional correctness* of the C implementation against its abstract spec — plus, later, integrity and confidentiality properties — but it is explicitly *conditional* on the C compiler, the assembly, the hardware behaving as assumed, and the spec capturing what "secure" means. CompCert proves the *compiler* preserves semantics, which is why pairing it with seL4 (or proving the seL4 C with assumptions a verified compiler discharges) tightens the chain — each verified layer shrinks someone else's TCB. The discipline is to write the TCB down explicitly and tell stakeholders what's *outside* it.

> **The Knuth caveat, made operational:** when you tell a stakeholder "we proved X," immediately follow with "...which means: *given that our spec correctly captures what we want, and trusting the prover, our axioms, the extraction step, and the hardware*, the code meets that spec. It does **not** mean the spec is what you actually need, and it does **not** cover anything we didn't model — including side channels." The teams that get burned are the ones who let "proven" stand unqualified and then ship a proven-correct implementation of the *wrong* spec, or one that leaks through a channel they never modeled.

---

## Core Concept 6 — Hiring, Tooling, and CI for Proofs

If you decide to take on machine-checked proof, you are standing up a small, specialized engineering practice, and it has operational requirements most teams underestimate.

**Hiring and skills.** The talent pool is thin. People who can drive a proof assistant on a *real* artifact — not a textbook exercise — are scarce, and the supply is heavily concentrated in academia and a handful of industrial labs. Three realistic paths:

- **Partner with academia.** seL4 (NICTA/Data61/UNSW), CompCert (INRIA), Fiat-Crypto and HACL\* (MIT, Microsoft Research, INRIA, university collaborations) all came out of or alongside academic groups. Sponsored research, joint appointments, and hiring from these groups is the well-trodden route.
- **Grow internally, slowly.** A strong functional programmer can become productive in Lean/Coq over *quarters*, not weeks. Budget the ramp and pair them with someone experienced.
- **Scope to lighter tools.** Dafny and F\* have meaningfully shorter ramps than raw Coq/Isabelle because SMT automation hides much of the manual proof — sometimes the right answer is to lower the tool, not raise the hiring bar.

**Tooling reality.** Expect a steep, idiosyncratic toolchain: prover versions matter intensely (a minor bump can rot proofs), proof libraries (Coq's stdlib/`mathcomp`, Isabelle's AFP, Lean's `mathlib`) are dependencies you pin like any other, and IDE/editor integration (CoqIDE, Proof General, VS Code extensions, Lean's interactive mode) is non-negotiable for productivity. `mathlib`'s scale (Lean) shows the ecosystem maturing, but it's nothing like a mainstream language's tooling.

**Build and CI for proofs.** Proofs must be checked in CI like tests — but they are *slow* and *resource-hungry*:

```yaml
# Proof CI is non-negotiable but has its own character
proof-check:
  # Checking a large development can take many minutes to hours
  # Pin the prover version EXACTLY — a minor bump rots brittle proofs
  prover: coq-8.18.0          # never "latest"
  steps:
    - build_dependencies       # mathcomp/AFP/mathlib, version-pinned
    - check_all_proofs         # `coqc` / `isabelle build` / `lake build`
    - fail_on_admit            # reject `admit`/`sorry`/`Admitted` — unfinished proofs
    - fail_on_new_axiom        # `Print Assumptions`: catch axioms creeping into the TCB
  caching: aggressive          # proof artifacts are expensive to recompute
```

Two CI gates are specific to proofs and easy to forget: **fail on `admit`/`sorry`/`Admitted`** (an unfinished proof that type-checks but proves nothing), and **fail on new axioms** (`Print Assumptions` in Coq) so nobody silently widens the TCB to make a proof go through. Both are the proof-world equivalent of failing on a skipped test — and both are the kind of hole that turns "we proved it" into a lie.

> **The operational truth:** a verification program is a *staffed, tooled, CI-gated practice*, not a heroic one-off. If you can't commit to the hiring pipeline, the pinned toolchain, and the proof-CI gates (including no-`admit` and no-new-axiom), you can't sustain the proofs — they'll rot, an `admit` will sneak in, and the guarantee quietly evaporates while everyone still believes it holds.

---

## War Stories

**CompCert: the compiler CSmith couldn't crash.** CSmith is a random C-program generator built to find compiler bugs by differential testing; it has found *hundreds* in GCC and LLVM. When researchers (Yang et al., "Finding and Understanding Bugs in C Compilers") turned it on CompCert, the verified middle-end stood out: the bugs they found were essentially confined to CompCert's *unverified* parts (the front-end/elaboration and runtime) — the formally verified optimization and code-generation core, the thing the proof actually covered, held. The lesson is the whole strategy in miniature: *the verified core delivered on its guarantee; the bugs lived exactly where the proof didn't reach.* Verify the core, and know precisely where the core ends.

**seL4: what 20 person-years actually bought.** The seL4 functional-correctness proof took on the order of 20+ person-years for ~8,700 lines of C — a staggering ratio by ordinary standards. But the artifact is a microkernel: tiny, stable, and sitting at the root of trust for high-assurance systems (defense, avionics, critical infrastructure). For *that* artifact, the math works: the kernel changes rarely, a bug in it is unrecoverable and catastrophic for everything above it, and the proof is reused across every deployment for years. The same 20 person-years spent proving a business application would have been indefensible. The candidate, not the technique, is what made it worth it.

**Fiat-Crypto: a bug class deleted from BoringSSL's hot path.** Hand-written elliptic-curve field arithmetic had a long, ugly history of carry-propagation and constant-time bugs — subtle, exploitable, and hard to catch by testing. Fiat-Crypto's generate-and-prove approach produced field-arithmetic code *with* Coq correctness proofs, automatically, per curve, and that generated code shipped in BoringSSL (and thus Chrome). The win wasn't "we found the bugs" — it was "this bug class can no longer occur in this code, and we maintain a spec+generator instead of hand-proving each curve." That's the maintenance-tax problem solved by construction.

**The team that tried to "prove the whole system."** A recurring and avoidable failure: a team, sold on the guarantee, scopes a proof effort at an entire evolving service instead of a frozen core. The first proofs land. Then product needs a feature, the spec shifts, and proofs across the development break; a prover upgrade rots more. Velocity on the "verified" component collapses because every change costs a re-proof, and the proof obligations grow faster than the team can discharge them. The effort is quietly abandoned, leaving a half-proven artifact that *looks* assured but isn't. The boundary was drawn around something that wouldn't hold still — the cardinal sin of Concept 3.

**Proven correct, still broke — the spec was wrong.** The Knuth caveat made real: a component carries a machine-checked proof, ships, and *still fails in the field* — because the specification didn't capture the real requirement. A serializer proven to round-trip correctly that nonetheless interoperates badly because the *spec of the wire format* was subtly wrong; or a function proven correct under an assumption (a precondition, an environmental invariant) that the surrounding system silently violated; or a crypto routine proven functionally correct that leaks via a timing side channel never present in the model. In every case the proof was *valid* and the system *failed* — because "proven" only ever meant "meets this spec, within this TCB." The failure was outside the boundary everyone forgot to draw.

---

## Decision Frameworks

**Should we use a proof assistant AT ALL?** Machine-checked proof is justified only when *all four* lean yes. Any "no" pushes you to the cheaper toolbox in [04 — Property & Contract Verification](../04-property-and-contract-verification/professional.md).

| Dimension | Proof assistant justified | Use cheaper tools (tests/contracts/TLA+/fuzzing) |
|---|---|---|
| **Catastrophic?** | Failure is severe: lost funds, lost lives, breached crypto, broken kernel | Failure is an inconvenience or a bounded outage |
| **Unrecoverable?** | Can't roll back/hotfix: immutable contract, shipped firmware, released compiler | Roll back and redeploy in minutes |
| **Small & stable?** | Tiny, frozen artifact: crypto primitive, kernel, fixed format | Large or changing weekly |
| **High-value?** | Worth amortizing person-years across its lifetime | Budget doesn't survive a 15:1 ratio |

**Lighter-weight alternative first — try the cheaper cousin before full Coq/Isabelle.** (Cross-link: [04 — Property & Contract Verification](../04-property-and-contract-verification/professional.md).)

| Tool | Strength | Reach for it when | Reach past it (to Coq/Isabelle/Lean) when |
|---|---|---|---|
| **Dafny** | SMT-automated; familiar imperative syntax; verifies pre/post/invariants | Algorithms, data structures, contract-style correctness with a short ramp | Properties need deep induction/abstraction SMT can't discharge |
| **F\*** | Dependent types + SMT; extracts to C/OCaml/Wasm; HACL\* proven in it | Verified systems/crypto code with automation (HACL\*/EverCrypt model) | You need full general-purpose proof power or a different ecosystem |
| **Liquid Haskell** | Refinement types bolted onto real Haskell; lightweight | Adding strong invariants to *existing* Haskell incrementally | Properties exceed what refinement types + SMT can express |
| **Coq / Isabelle / Lean** | Full higher-order proof; total expressiveness | Deep, bespoke proofs: compilers, kernels (CompCert, seL4) | — (this is the heavy end; you're already here) |

**What slice to verify — pick the core, not the system.**

| Candidate slice | Verify? | Why |
|---|---|---|
| Crypto primitive (field arithmetic, AEAD) | **Yes** | Catastrophic + unrecoverable + tiny + frozen; generate-and-prove fits |
| Parser/serializer for a fixed wire format | **Yes** | Round-trip + no-crash on adversarial input; small, stable spec |
| State machine with a safety invariant | **Yes** | Invariant is specifiable; core is small |
| Authorization-decision function | **Often** | Small, critical, specifiable — if it's stable |
| "The payment service" | **No** | Too big, too much I/O, changes weekly — verify its *core* math only |
| Evolving public API | **No** | Spec moves constantly; proofs would rot faster than you fix them |
| Anything you can't crisply specify | **No** | No spec → no proof; if you can't write it down, you can't prove it |

**What the proof does and does NOT guarantee — the TCB checklist.** Walk this every time before saying "proven" to a stakeholder.

| Question | If unaddressed, the guarantee is hollow |
|---|---|
| Is the **spec** validated against the real requirement? | Proven-correct implementation of the wrong thing (Knuth) |
| Are all **axioms** known and minimal? (`Print Assumptions`) | A hidden axiom can prove anything; the TCB silently widened |
| Are there zero `admit`/`sorry`/`Admitted`? | An unfinished proof proves nothing |
| Is the **extraction/compilation** trusted or verified? | The extraction gap — the running artifact ≠ the verified model |
| Are **side channels** (timing/power/cache) in the model? | Functionally correct, still leaks keys |
| Is the **hardware/environment** assumption stated? | Faults, Rowhammer, broken assumptions outside the model |
| Do stakeholders know what's **outside** the TCB? | "Proven" misread as "cannot ever fail" |

---

## Mental Models

- **Proof assistants are the heaviest tool in the kit — reach for them last, not first.** Property tests, contracts, TLA+, and fuzzing are the default and beat proof on assurance-per-dollar for ~99% of software. The proof assistant is the specialist instrument for the catastrophic-and-unrecoverable 1%.

- **"Catastrophic × unrecoverable × small × stable × valuable" is the gate.** All five, or you don't open the door. A bug you can hotfix by lunch never justifies person-years of proof, no matter how elegant.

- **You're not buying a proof — you're adopting a proof-maintenance perpetuity.** The up-front cost is the part everyone budgets. The standing obligation to keep proofs green through code, spec, and prover changes is the part that bankrupts the unprepared. Pick artifacts that hold still.

- **Verify the core, test the rest.** Prove the tiny stable kernel where catastrophe lives; surround it with cheap methods that also feed it valid inputs. Pushing the proof boundary into the changing parts is how teams drown.

- **Prefer generate-and-prove, then automation, then hand-proof.** Fiat-Crypto > Dafny/F\*/Liquid Haskell > raw Coq/Isabelle/Lean. Each step down is ~10× more human labor and more proof rot.

- **"Proven" means "meets this spec, within this TCB" — nothing more.** The spec can be wrong (Knuth), the extraction can gap, the side channel can leak, the hardware can fault. Draw the TCB explicitly and say what's outside it, or "proven" becomes a dangerous half-truth.

---

## Common Mistakes

1. **Reaching for a proof assistant by default because it's rigorous.** It's the most expensive tool you have, and for almost everything the cheaper toolbox ([04](../04-property-and-contract-verification/professional.md)) gives more assurance per dollar. Justify it against the four-part gate before writing a line of Coq.

2. **Budgeting the initial proof but not the maintenance.** The perpetual cost of keeping proofs green through code/spec/prover changes is the real bill and the top killer of verification efforts. If the artifact won't hold still, don't start.

3. **Scoping the proof at "the whole system."** Evolving, I/O-heavy, large surfaces rot proofs faster than you can repair them. Verify a *small, stable core*; test everything around it.

4. **Hand-proving when you could generate-and-prove.** Fiat-Crypto-style generation maintains a spec+generator instead of hand-proven artifacts and deletes bug classes by construction. Check for that path before committing to tactic-by-tactic Coq.

5. **Skipping the lighter cousins.** Dafny/F\*/Liquid Haskell can do with SMT automation in days what raw Coq/Isabelle does in weeks. Try the automated, lower-ramp tool before the heaviest one.

6. **Letting "proven" stand unqualified.** Stakeholders hear "cannot ever fail." Always state the TCB — spec correctness, axioms, extraction gap, side channels, hardware. A proven-correct implementation of the wrong spec still ships a bug.

7. **No proof-CI, or CI without the proof-specific gates.** Proofs must be checked in CI, with a pinned prover version and gates that **fail on `admit`/`sorry`/`Admitted`** and **fail on new axioms**. Otherwise an unfinished proof or a silently-widened TCB makes "we proved it" untrue while everyone still trusts it.

---

## Test Yourself

1. A team proposes formally verifying a new internal web service "to eliminate bugs." Give the staff-level response and the four-part gate you'd apply.
2. seL4 cost ~20+ person-years for ~8,700 lines of C. Explain *why that was a defensible investment there* and why the same effort on a typical business application would not be.
3. What is "proof maintenance," why is it usually the dominant lifecycle cost, and what property of the *chosen artifact* most reduces it?
4. State the "verify the core, test the rest" strategy. How do you choose the slice, and what is the surrounding code's job?
5. Why is Fiat-Crypto's generate-and-prove approach preferable to hand-proving each curve, in terms of both bug classes and maintenance?
6. A component carries a machine-checked correctness proof and still fails in production. List three distinct ways this can happen, all consistent with the proof being valid.
7. Name two CI gates specific to proofs (beyond "the proofs check") and explain what each prevents.

<details>
<summary>Answers</summary>

1. The response is a skeptical default: for ~99% of software a proof assistant is the *wrong* tool — property tests, contracts, TLA+, and fuzzing give far more assurance per engineer-hour, and a web-service bug is *recoverable* (roll back, hotfix). Apply the gate: **catastrophic? unrecoverable? small & stable? high-value?** A typical service fails most of these, so the answer is the cheaper toolbox in [04](../04-property-and-contract-verification/professional.md), not Coq.
2. seL4 is a *microkernel*: tiny (~8,700 LOC), **stable** (changes rarely), at the **root of trust** (a bug is unrecoverable and catastrophic for everything above it), and **reused across many high-assurance deployments** for years — so person-years amortize. A business app is large, changes weekly, and its bugs are recoverable, so the same effort buys far less and rots immediately. *The candidate, not the technique, makes it worth it.*
3. **Proof maintenance** is the ongoing cost of repairing proofs that break when code, specs, libraries, or the prover change. It dominates because a proof is rigidly bolted to a specific code/spec version and *every* change can break it (refactors, new features, prover upgrades), forever. The property that most reduces it is **stability** — a small, frozen artifact has little to re-prove (and generate-and-prove reduces it further by moving maintenance to a spec+generator).
4. **Prove a tiny, stable, critical core; test everything else** (property tests, contracts, fuzzing). Choose the slice as the *smallest component whose failure is catastrophic/unrecoverable and that will hold still*, with a spec you can write crisply (crypto primitive, serializer, state machine). The surrounding code's job is to **establish the core's preconditions** — validate inputs and enforce the contract at the boundary — since the proof only guarantees behavior *given* those preconditions.
5. Generate-and-prove (a) **deletes the bug class by construction** — carry/constant-time errors in hand-written field arithmetic can't occur in generated, proven code — and (b) **changes the maintenance unit**: you maintain a high-level spec and a generator, not thousands of lines of hand-proven C, and you get proven code for *each* new curve/platform by re-running the generator. Hand-proof gives one proven artifact per target and re-incurs proof rot on every edit.
6. (a) **The spec was wrong** — proven correct against a specification that didn't capture the real requirement (Knuth). (b) **A modeled-out side channel** — functionally correct but leaks via timing/power/cache because constant-time wasn't in the spec. (c) **A violated assumption / extraction gap** — a precondition or environmental invariant the surrounding system broke, or the extracted/compiled artifact differing from the verified model (or a hardware fault). All are *outside the TCB*, so the proof stays valid while the system fails.
7. **Fail on `admit`/`sorry`/`Admitted`** — prevents an unfinished proof that type-checks but proves nothing from passing as "done." **Fail on new axioms** (e.g., `Print Assumptions` in Coq) — prevents someone silently widening the TCB by adding an axiom to force a proof through, which could make the proof unsound. (Also: pin the exact prover version so a minor upgrade doesn't rot proofs.)

</details>

---

## Cheat Sheet

```text
SHOULD WE USE A PROOF ASSISTANT AT ALL?  (need ALL of:)
  catastrophic  ×  unrecoverable  ×  small & stable  ×  high-value
  any "no"  →  property tests / contracts / TLA+ / fuzzing  (the right default for ~99%)

THE 1% WHERE IT PAYS
  compilers (CompCert)   OS kernels/hypervisors (seL4)
  crypto primitives (Fiat-Crypto→BoringSSL, HACL*/EverCrypt→Firefox)
  safety-critical control   immutable smart contracts   hardware

THE ECONOMICS
  proof-to-code ratio   10:1 – 20:1   (seL4 ~20+ person-years, ~8,700 LOC C)
  proof engineers       scarce, expensive (PhD-adjacent hire)
  PROOF MAINTENANCE     the real bill — proofs rot on every code/spec/prover change
                        budget the PERPETUITY, not the purchase

STRATEGY:  VERIFY THE CORE, TEST THE REST
  prove the tiny, stable, critical kernel  (~1% of LOC)
  property tests + contracts + fuzzing for everything else  (~90%)
  surrounding code establishes the core's preconditions

TOOL ORDER (each step up = ~10× more labor + more proof rot)
  generate-and-prove (Fiat-Crypto)  >  Dafny / F* / Liquid Haskell  >  Coq / Isabelle / Lean

WHAT "PROVEN" DOES NOT GUARANTEE  (the TCB)
  spec correctness (Knuth)   axioms   admit/sorry   extraction gap
  side channels (timing/power)   hardware/environment
  → always say what's OUTSIDE the TCB; "proven" ≠ "cannot fail"

PROOF CI
  pin prover version (never "latest")   fail on admit/sorry/Admitted
  fail on new axioms (Print Assumptions)   cache aggressively (proofs are slow)
```

---

## Summary

- **The honest default is "no."** For ~99% of software, a proof assistant is the wrong tool — property tests, contracts, TLA+, and fuzzing give far more assurance per dollar. The staff contribution is the courage to say so. See [04 — Property & Contract Verification](../04-property-and-contract-verification/professional.md) for the correct default toolbox.
- **The 1% where it pays is narrow:** catastrophic *and* unrecoverable failure on a *small, stable, high-value* artifact — compilers (CompCert), kernels (seL4), crypto primitives (Fiat-Crypto, HACL\*), safety-critical control, immutable smart contracts, hardware.
- **The economics are brutal:** 10:1–20:1 proof-to-code ratios, multi-person-year efforts (seL4 ~20+), scarce specialist talent, and — the project-killer — **perpetual proof maintenance**: proofs rot on every code, spec, or prover change. Budget the perpetuity.
- **Verify the core, test the rest.** Prove a tiny, stable kernel where catastrophe lives; surround it with cheaper methods that also feed it valid inputs. Pushing the proof boundary into changing code is how teams drown.
- **Prefer generate-and-prove, then automated lightweight verifiers, then hand-proof.** Fiat-Crypto-style generation deletes bug classes and moves maintenance to a spec+generator; Dafny/F\*/Liquid Haskell automate much of what raw Coq/Isabelle does by hand.
- **"Proven" means "meets this spec, within this TCB" — and nothing more.** The spec can be wrong (Knuth), the extraction can gap, side channels can leak, hardware can fault. State the TCB explicitly, gate proof-CI on no-`admit` and no-new-axiom, and never let "proven" be misread as "cannot ever fail."

The next tier — [interview.md](interview.md) — distills this topic into the questions that reveal whether a candidate can make the *judgment* call, not just write a tactic.

---

## Further Reading

- **Xavier Leroy, "Formal verification of a realistic compiler"** (CompCert) — the canonical verified-compiler result, and the source of the "CSmith couldn't crash the verified core" story.
- **Klein et al., "seL4: Formal Verification of an OS Kernel"** (SOSP 2009) and follow-ups — the cost, the ratios, and exactly what the functional-correctness proof does and does not claim.
- **Erbsen et al., "Simple High-Level Code for Cryptographic Arithmetic — With Proofs, Without Compromises"** (Fiat-Crypto) — generate-and-prove in production crypto (BoringSSL/Chrome).
- **Appel, "Verified Software Toolchain"** — connecting source-level proofs to compiled machine code, and the discipline of shrinking the TCB across layers.
- **HACL\*/EverCrypt papers** (Zinzindohoué et al.; Protzenko et al.) — a verified crypto library in F\* shipping in Firefox; the automation-over-tactics posture.
- **Yang et al., "Finding and Understanding Bugs in C Compilers"** (CSmith) — the differential-testing study whose results made CompCert's verified core stand out.
- [interview.md](interview.md) — the same material as the questions that probe real judgment about when machine-checked proof is worth it.

---

## Related Topics

- [04 — Property & Contract Verification](../04-property-and-contract-verification/professional.md) — the cheaper assurance tools (property tests, contracts, refinement types, F\*/Dafny/Liquid Haskell) that are the correct default and the baseline a proof must beat.
- [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/professional.md) — the broader cost/benefit framing this topic's "should we prove it at all?" gate feeds into.
- [01 — Formal Specification](../01-formal-specification/professional.md) — writing the spec a proof checks against; the Knuth caveat lives or dies here.
- [Testing](../../testing/) — property-based testing, fuzzing, and the assurance methods that surround the verified core.
- [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — ASan/UBSan and fuzzing that catch the memory/UB bug classes far more cheaply than proof.
