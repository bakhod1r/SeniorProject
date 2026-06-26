# Dependent & Refinement Types — Professional Level

> **Topic:** [Dependent & Refinement Types](README.md)
> **Focus:** When verification actually pays — the economics of proof, the gradient from everyday types to full proofs, building and maintaining verified systems in production, and where mainstream languages are heading.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Summary](#summary)
14. [Further Reading](#further-reading)

---

## Introduction

> Focus: **Verification is a tool with a price tag. This tier is about reading the price tag correctly — when the math works out, how to ship and maintain proofs, and how the ideas reach the 99% of teams who'll never write Agda.**

By now you understand the machinery: Pi/Sigma, SMT discharge vs. interactive proof, totality, the TCB. The professional question is different and harder: **given a real system with a budget and a deadline, where on the spectrum from "ordinary types" to "full machine-checked proof" should you sit — and why do almost all teams correctly sit near the cheap end?**

The honest answer is that full dependent-type verification is *expensive* — measured in person-years for kernels and compilers — and that cost is justified only when a bug's expected cost is extreme: a verified C compiler underpinning aerospace toolchains, a crypto library shipping in a billion browsers, a microkernel running a fighter jet's mission computer. For a CRUD backend, the same effort buys far more reliability spent on tests, types-you-already-have, fuzzing, and observability. **The skill is calibration**, not enthusiasm: knowing the gradient, pricing each rung, and picking the rung that fits the blast radius.

At the same time, the *ideas* are democratizing. You don't need Coq to "make illegal states unrepresentable"; you can do a weak version with TypeScript branded types, Rust const generics and the type-state pattern, or a sliver of refinement via newtypes and smart constructors. Liquid Haskell can be dropped onto an existing Haskell module to catch a bounds bug without rewriting the world. Dafny can verify one gnarly algorithm without your whole service becoming a proof. The professional move is to **harvest the cheap 80% of the benefit** — encode invariants in ordinary types, refine at boundaries, reach for a verifier on the one component where it pays — rather than chase the expensive 100%.

> 🎓 **Why this matters at the professional level:** Your job is allocation of scarce engineering effort against risk. Verification is one line item among many (tests, fuzzing, types, reviews, runtime checks, observability). Knowing its *unit cost* and *unit benefit* — and how both vary with the system — is what lets you make the call credibly when a stakeholder asks "should we formally verify this?" The defensible answer is usually "no, here's why," and occasionally "yes, here's exactly which part and what it'll cost."

---

## Prerequisites

- **Required:** Senior tier — Curry–Howard, totality, TCB, the automation spectrum.
- **Required:** Experience making engineering trade-offs under budget and risk.
- **Helpful:** Exposure to a verified or refinement-typed codebase (Liquid Haskell, Dafny, F\*) even at tutorial scale.
- **Helpful:** Familiarity with how mainstream type systems already encode invariants (sum types, newtypes, Rust ownership, TS literal/template types).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Assurance level** | How strong a correctness guarantee a system needs (tests → fuzzing → refinement → full proof). |
| **Blast radius** | The scope of damage a single defect can cause; drives how much assurance is warranted. |
| **Verification gradient** | The continuum from ordinary types to refinement types to full machine-checked proofs. |
| **Proof burden** | Human effort (person-time, expertise) to produce and maintain proofs. |
| **Proof maintenance** | Cost of keeping proofs valid as code/specs change; proofs are brittle under refactoring. |
| **Specification gap** | The risk that a (proved-correct) implementation meets a *wrong* spec. |
| **Branded / nominal type** | A mainstream trick (TS, newtypes) to make a value's invariant part of its identity. |
| **Type-state** | Encoding an object's protocol state in its type so illegal transitions don't compile (Rust). |
| **Const generics** | Rust's value-level type parameters (`[T; N]`), a sliver of dependent typing. |
| **Smart constructor** | The only sanctioned way to build a refined value, establishing its invariant. |
| **Gradual verification** | Mixing verified and unverified components with explicit, audited boundaries. |
| **Extraction TCB** | The extractor + downstream compiler that turn verified code into a runnable binary; part of real trust. |
| **DO-178C / CC EAL7** | Safety/security certification regimes that credit formal methods as evidence. |

---

## Core Concepts

### 1. The economics: cost vs. avoided cost

Verification pays when **(expected cost of defects avoided) > (cost of verification)**. Both sides vary enormously:

- **Cost of verification** scales with depth (refinement < dependent), with *spec and proof engineering* (usually the dominant term — often far exceeding the code itself), and with *maintenance* as the code evolves. Liquid Haskell on one module might be days; a CompCert-class effort is person-years.
- **Avoided cost** scales with blast radius × defect probability. A crypto bug in a library shipping to a billion endpoints, or a kernel bug in a certified avionics stack, has astronomical expected cost. A bug in an internal dashboard does not.

This is why the same technique is *obviously correct* for HACL\* and *obviously wrong* for a marketing site. The professional doesn't ask "is verification good?" (it's neither good nor bad); they ask "does *this* system's blast radius justify *this* rung's cost?" For the vast majority of software, the answer lands below full proof — and that's the *right* answer, not a failure of nerve.

### 2. The gradient, rung by rung — and what each rung buys

```text
RUNG                              MECHANISM                       TYPICAL COST     TYPICAL FIT
-------------------------------------------------------------------------------------------
1. Ordinary types + tests         compiler + test suite           baseline         almost everything
2. Make-illegal-states-           sum types, newtypes,            low              every serious codebase
   unrepresentable                smart constructors
3. Mainstream "dependent-ish"     TS literal/template/branded     low–moderate     APIs, protocol states
                                  types; Rust const generics,
                                  type-state
4. Refinement types (SMT)         Liquid Haskell, Dafny, F*       moderate         bounds/arith-critical
                                  (one component)                                  modules, crypto helpers
5. Full dependent / proof         Idris, Agda, Coq, Lean, F*      high–very high   compilers, kernels,
   assistant                      (whole-system proof)                             crypto, avionics, math
```

Most teams should *climb to rung 2 or 3 and stop* — that captures a large fraction of the safety with negligible cost. Rung 4 is a targeted tool: drop it on the one module where bounds/arithmetic bugs would be catastrophic. Rung 5 is a multi-year institutional commitment, appropriate for a handful of artifacts on earth. **Knowing which rung a problem deserves is the core professional competency here.**

### 3. Rungs 2–3 in practice: the cheap, high-leverage wins

You don't need a verifier to get most of the *design* benefit. The same discipline — encode invariants in types — works in everyday languages:

- **Make illegal states unrepresentable.** Replace `(status: int, errorCode: int?)` with a sum type where each variant carries exactly the fields valid in that state. The compiler now rejects "success with an error code."
- **Branded / newtype refinement.** A `UserId` distinct from `OrderId` (even though both are `int`) prevents an entire class of argument-swap bugs. A `ValidatedEmail` produced only by a smart constructor means "is this validated?" is answered by the type, not a runtime check.
- **TypeScript literal & template-literal types.** `type Method = "GET" | "POST"` and template types like `\`/users/${string}\`` give a weak refinement flavor — the compiler restricts strings to a shape, catching typos at compile time.
- **Rust const generics & type-state.** `[T; N]` carries length in the type; the type-state pattern (`Connection<Open>` vs `Connection<Closed>`) makes "send on a closed connection" a compile error. These are genuine slivers of dependent/refinement thinking in a mainstream, production language.

These cost almost nothing and pay continuously. They are where 99% of teams should invest, and they're the bridge that makes the heavyweight tools comprehensible.

### 4. Rung 4 in practice: surgical refinement

Refinement types (Liquid Haskell, Dafny, F\*) shine when applied **surgically** to a component where arithmetic/bounds/aliasing bugs are the dominant risk:

- A **parser or codec** where length and offset arithmetic is bug-prone and security-relevant.
- A **ring buffer / allocator / index-heavy data structure** where off-by-one is catastrophic.
- A **crypto primitive** where constant-time and correctness matter.

The win: you keep your language and ecosystem, annotate the dangerous module, and let the SMT solver eliminate a bug class — *without* the person-years of a full proof. Liquid Haskell catching a real out-of-bounds in a `Data.Text`/bytestring-style routine is the archetype: a bounded, automated, high-value intervention. The cost is bounded too — when the solver can't discharge a VC, you strengthen the spec or add an assertion, not write an induction proof.

### 5. Building and *maintaining* verified systems

The cost people forget is **maintenance**. Proofs are brittle: refactor the code and proofs break; tighten the spec and obligations reopen. A verified codebase has a standing tax:

- **Proof CI.** The proof must re-check on every change; broken proofs block merges exactly like failing tests.
- **Spec review as a first-class artifact.** Since "verified" means "verified against the spec," the spec needs independent scrutiny — redundant statements, model-based tests, adversarial review — because a spec bug is invisible to the proof.
- **TCB hygiene.** Track axioms, `assume`s, and the extraction toolchain; a verified core extracted by a buggy extractor and compiled by an unverified C compiler still trusts both. (This is why fiat-crypto and CompCert care so much about the *whole* pipeline.)
- **Expertise concentration.** Few engineers can maintain the proofs; bus-factor and onboarding are real operational risks.

Teams that succeed (Galois, AWS's automated-reasoning group, the seL4 foundation, the HACL\*/Project Everest teams) treat verification as a *sustained capability*, not a one-time effort.

### 6. Where the mainstream is heading

The frontier is **gradual** verification leaking into ordinary languages, so the cheap rungs get cheaper and a bit deeper:

- **Refinement-ish typing in mainstream stacks** (research and tooling around Scala refinement types, Liquid Haskell's maturation, Dafny's adoption at AWS).
- **Richer value-in-type features** (Rust const generics expanding; TypeScript's literal/template/conditional types growing more expressive).
- **SMT-backed assertions and contract checkers** that verify *some* obligations at build time without a full dependent type system.
- **Lean 4 doubling as a real programming language**, narrowing the gap between "proof assistant" and "language you'd ship."

The realistic trajectory is not "everyone writes Agda" but "everyday languages absorb the high-leverage, low-cost rungs (illegal-states-unrepresentable, branded types, const generics, surgical SMT), while full proof stays a specialist tool for catastrophic-blast-radius code." A professional bets on that gradient: invest heavily in the cheap rungs now, watch the expensive rungs get cheaper, and deploy them surgically when the economics flip.

---

## Real-World Analogies

**Insurance underwriting.** You don't buy the maximum policy on everything; you price the premium against the asset's value and the loss probability. Full verification is a very expensive policy — rational only for very valuable, very exposed assets (kernels, crypto). For a bicycle (internal tool), the premium exceeds the bike.

**Aircraft inspection tiers.** A paper plane gets a glance; a commercial jet gets exhaustive, certified inspection (and formal methods credit under DO-178C). The inspection rigor matches the consequence of failure. Mismatch either way is malpractice: under-inspecting the jet, or over-inspecting the paper plane.

**Structural engineering vs. a garden shed.** You hire a structural engineer with stamped calculations for a skyscraper, not for a shed. The shed gets "follow good practice" (rungs 2–3); the skyscraper gets full analysis (rung 5). Same physics, wildly different process, because the blast radius differs by orders of magnitude.

**Seatbelts vs. roll cages.** Seatbelts (illegal-states-unrepresentable, branded types) are cheap, universal, and capture most of the benefit. Roll cages and fire suppression (full proof) go in race cars (crypto, kernels). Putting a roll cage in every commuter car is the mistake teams make when they "verify everything."

---

## Mental Models

**1. Verification is a line item, not a virtue.** It competes with tests, fuzzing, reviews, and observability for the same risk-reduction budget. Spend where the marginal risk reduction per hour is highest — which is usually *not* full proof.

**2. Climb the gradient until marginal benefit drops below marginal cost — then stop.** For most systems that's rung 2–3. Stopping early isn't cutting corners; it's correct allocation.

**3. Blast radius sets the ceiling.** A bug that can crash a kernel fleet or leak a billion users' keys justifies almost any cost. A bug that mildly annoys five internal users justifies almost none. Size the radius first.

**4. The spec is the weakest link.** No proof can save you from proving the wrong thing. As assurance goes up, *spec engineering* becomes the dominant risk and cost — budget for it explicitly.

**5. Harvest the cheap ideas everywhere; deploy the expensive ones surgically.** Make-illegal-states-unrepresentable belongs in every codebase. A full Coq proof belongs in approximately none of them — and the few where it belongs, you know exactly which component and why.

---

## Code Examples

### Example 1: Rung 2 — illegal states unrepresentable (TypeScript, everyday)

```typescript
// BAD: status and error can contradict each other.
type ResultBad = { ok: boolean; data?: User; error?: string };

// GOOD: a discriminated union — "ok with an error" cannot be constructed.
type Result =
  | { kind: "ok"; data: User }
  | { kind: "err"; error: string };

function render(r: Result) {
  switch (r.kind) {
    case "ok":  return r.data.name;     // r.error doesn't exist here
    case "err": return r.error;         // r.data doesn't exist here
  }
}
```

No verifier, no SMT — just ordinary types capturing an invariant. This is rung 2, and it's where most teams get the highest return per hour.

### Example 2: Rung 3 — branded refinement via smart constructor (TypeScript)

```typescript
// A "branded" type: a string the compiler treats as distinct.
type Email = string & { readonly __brand: "Email" };

// The ONLY way to make an Email establishes the invariant:
function parseEmail(s: string): Email | null {
  return /^[^@]+@[^@]+$/.test(s) ? (s as Email) : null;
}

function sendTo(to: Email) { /* ... */ }

sendTo("oops");                 // ❌ compile error: string is not Email
const e = parseEmail(input);
if (e) sendTo(e);               // ✅ refinement established at the boundary
```

### Example 3: Rung 3 — type-state in Rust (compile-time protocol safety)

```rust
struct Open;
struct Closed;
struct Conn<State> { /* ... */ _state: std::marker::PhantomData<State> }

impl Conn<Open> {
    fn send(&self, _msg: &[u8]) { /* only Open conns can send */ }
    fn close(self) -> Conn<Closed> { Conn { _state: std::marker::PhantomData } }
}

// conn.send() after close() does NOT compile — the type changed to Conn<Closed>.
```

The protocol state lives in the type; illegal transitions are compile errors — a sliver of dependent thinking in a production language.

### Example 4: Rung 4 — surgical refinement on a risky routine (Liquid Haskell)

```haskell
-- Verify ONLY this index-heavy function; the rest of the app is untouched.
{-@ slice :: xs:[a]
          -> lo:{v:Int | 0 <= v && v <= len xs}
          -> hi:{v:Int | lo <= v && v <= len xs}
          -> [a] @-}
slice :: [a] -> Int -> Int -> [a]
slice xs lo hi = take (hi - lo) (drop lo xs)

-- A caller with a possible off-by-one is rejected at compile time by Z3,
-- without rewriting the codebase in a dependently typed language.
```

### Example 5: Rung 4 — Dafny verifying one algorithm (AWS-style)

```dafny
method BinarySearch(a: array<int>, key: int) returns (index: int)
  requires forall i, j :: 0 <= i < j < a.Length ==> a[i] <= a[j]  // sorted spec
  ensures 0 <= index ==> index < a.Length && a[index] == key
  ensures index < 0 ==> forall i :: 0 <= i < a.Length ==> a[i] != key
{
  var lo, hi := 0, a.Length;
  while lo < hi
    invariant 0 <= lo <= hi <= a.Length
    invariant forall i :: 0 <= i < lo ==> a[i] != key
    invariant forall i :: hi <= i < a.Length ==> a[i] != key
  {
    var mid := lo + (hi - lo) / 2;       // off-by-one & overflow shape — Dafny checks it
    if a[mid] < key { lo := mid + 1; }
    else if a[mid] > key { hi := mid; }
    else { return mid; }
  }
  return -1;
}
```

One method, fully specified and machine-verified — the surgical pattern AWS uses for critical components, no whole-system proof required.

---

## Pros & Cons

### Pros (of verification *as an option to deploy judiciously*)

| Benefit | Why it matters |
|---------|----------------|
| **Catastrophic-bug elimination** | Where blast radius is huge (crypto, kernels), it's the only sufficient assurance. |
| **Cheap rungs are nearly free** | Illegal-states-unrepresentable and branded types pay continuously at ~no cost. |
| **Surgical applicability** | Refinement/Dafny target one risky module without a rewrite. |
| **Certification credit** | DO-178C / Common Criteria reward formal evidence. |
| **Forces spec clarity** | Even attempting verification surfaces under-specified behavior. |

### Cons

| Cost | Why it hurts |
|------|--------------|
| **Proof cost is enormous at the top** | Person-years for kernels/compilers; rarely justified. |
| **Maintenance tax** | Brittle proofs reopen on refactor; standing CI and expertise cost. |
| **Spec risk grows with assurance** | The thing you must get right (the spec) gets harder as proofs get deeper. |
| **Talent scarcity** | Few engineers can build/maintain it; bus-factor risk. |
| **Misallocation temptation** | Enthusiasts over-verify low-blast-radius code, wasting budget. |

---

## Use Cases

- **Yes, full proof:** verified compilers (CompCert), microkernels (seL4), crypto libraries (HACL\*, fiat-crypto), avionics/spacecraft control, foundational math (mathlib).
- **Yes, surgical refinement:** parsers/codecs, allocators, index-heavy structures, crypto helpers, authorization logic (AWS Dafny/F\*).
- **Yes, always, cheap rungs:** every serious codebase — sum types, newtypes/branded types, smart constructors, type-state, const generics.
- **No:** typical CRUD backends, internal tools, UIs, prototypes — where tests + ordinary types + fuzzing + observability dominate the cost-benefit.

---

## Coding Patterns

**1. Climb-then-stop.** Adopt rungs 2–3 everywhere by default; escalate to rung 4 only on identified high-risk modules; reserve rung 5 for catastrophic blast radius.

**2. Refine at the boundary, trust the interior.** Establish invariants once at I/O/parse boundaries via smart constructors; the verified/refined interior then runs guard-free.

**3. Isolate the verified core behind a thin unverified shell.** Keep FFI/I/O glue small and audited; verify the algorithmic heart.

**4. Treat specs as reviewed artifacts.** Version, review, and independently test specifications; a wrong spec defeats any amount of proof.

**5. Budget proof maintenance.** Put proofs in CI; expect re-proving on refactor; staff for it before committing.

---

## Best Practices

- **Decide by blast radius, not by taste.** Compute the consequence of a defect first; let it set the assurance ceiling.
- **Default to the cheap rungs.** Most reliability gains come from ordinary-type discipline, not proofs. Exhaust those first.
- **Apply heavy verification surgically.** One critical module, fully verified, beats a half-hearted whole-system attempt.
- **Account for the *whole* TCB.** Extraction toolchain, C compiler, axioms, `assume`s — verified core ≠ verified binary.
- **Independently validate the spec.** Redundant statements, model-based tests, adversarial review; the proof can't catch a wrong spec.
- **Sustain it or don't start it.** Verification is a standing capability (CI, expertise, spec review); a one-off proof rots.
- **Communicate honestly.** "We verified memory safety of module X against spec Y, trusting Z" — precise claims, not "it's proven correct."

---

## Edge Cases & Pitfalls

- **Over-verification.** The most common professional failure: pouring proof effort into low-blast-radius code, starving higher-value work. Calibrate.
- **The verified binary illusion.** A verified Coq core extracted and compiled by unverified tools still trusts those tools; the binary is only as trustworthy as the *whole* pipeline.
- **Spec rot.** Code evolves, spec doesn't; the proof now guarantees yesterday's behavior. Treat spec drift like a failing test.
- **Proof-bus-factor.** One person understands the proofs; they leave; the codebase becomes unmaintainable. Spread expertise or don't commit.
- **SMT brittleness in CI.** Refinement VCs can become flaky/slow as code grows; budget solver-tuning and resource limits.
- **Mistaking branded types for proofs.** Rung 3 tricks (TS branded types) are *unenforced at the value level* — a stray cast bypasses them. They're discipline aids, not guarantees.
- **"It's verified" overclaim.** Memory safety ≠ functional correctness ≠ side-channel freedom ≠ liveness. State exactly which property holds.

---

## Summary

Dependent and refinement types are a *tool with a price tag*, and professional skill is reading that tag against **blast radius**. Verification pays only when the expected cost of avoided defects exceeds its cost — which is why full machine-checked proof is right for CompCert, seL4, and HACL\* and wrong for almost everything else, where the same effort buys more reliability through tests, fuzzing, ordinary types, and observability. Think of a **gradient**: rung 1 (types + tests), rung 2 (make illegal states unrepresentable — sum types, newtypes), rung 3 (branded/literal/template types, Rust const generics and type-state), rung 4 (surgical SMT refinement via Liquid Haskell/Dafny/F\* on one risky module), rung 5 (full proof assistants). **Most teams should climb to rung 2–3 and stop** — that captures most of the benefit at near-zero cost — and reach for rung 4 surgically and rung 5 only for catastrophic-blast-radius code. Verified systems carry a real **maintenance tax** (brittle proofs, proof CI, spec review, talent concentration), and the **specification is the dominant risk** as assurance rises — a proof against a wrong spec proves nothing useful. The mainstream is absorbing the cheap rungs (TS literal/template types, Rust const generics, gradual SMT), so the trajectory is "everyday languages get a little more dependent/refinement flavor, full proof stays specialist." The professional reflex: size the blast radius, climb only as far as it justifies, harvest the cheap ideas everywhere, deploy the expensive ones surgically, and never overclaim what a proof guarantees.

---

## Further Reading

- Leroy, *"Formal Verification of a Realistic Compiler"* (CompCert) — the economics and engineering of a flagship proof.
- Klein et al., *"Comprehensive Formal Verification of an OS Microkernel"* (seL4) — cost, structure, maintenance.
- Bhargavan et al., *Project Everest / HACL\*, miTLS* — verified crypto/TLS at production scale.
- Amazon's automated-reasoning publications (Dafny, F\*, SAW) — verification inside a hyperscaler.
- *Programming with Refinement Types* (Liquid Haskell book) — surgical, incremental verification.
- The Dafny documentation and AWS Dafny case studies — rung-4 verification in practice.
- Rust const generics and type-state pattern write-ups — the mainstream slivers.
