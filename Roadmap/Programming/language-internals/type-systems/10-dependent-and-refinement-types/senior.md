# Dependent & Refinement Types — Senior Level

> **Topic:** [Dependent & Refinement Types](README.md)
> **Focus:** Curry–Howard taken all the way — programs *are* proofs; totality as the price of soundness; interactive proof in Coq/Lean/Agda vs. SMT-automated proof in Liquid Haskell/F\*; and how verified systems are actually built.

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

> Focus: **The deep idea that makes dependent types a foundation for mathematics and verified software: a type is a proposition, a program of that type is a proof, and the compiler is the proof-checker.**

The middle tier showed you Pi and Sigma and the two checking regimes. This tier reveals *why* dependent types matter beyond clever vectors: they are a foundation for **machine-checked proof**. Under the **Curry–Howard correspondence**, propositions *are* types and proofs *are* programs. `A -> B` is the proposition "A implies B"; a function of that type is a constructive proof of the implication. Pi types are universal quantifiers (`∀`), Sigma types are existentials (`∃`), the empty type is falsehood, the unit type is truth. Run this all the way and a dependently typed language becomes a **proof assistant**: write a type that states a theorem, write a program (a "proof term") inhabiting it, and the type checker *verifies the theorem*. This is how Coq verifies the CompCert C compiler, how Isabelle/seL4 verifies an OS kernel, and how Lean's `mathlib` accumulates tens of thousands of machine-checked mathematical theorems.

But Curry–Howard has a sharp edge: **the correspondence only holds if your language is total.** A non-terminating program can inhabit *any* type — a function `loop : A` that recurses forever "proves" `A` for every `A`, including `False`. If you could write that, your proof system would be inconsistent: you could prove anything. So proof assistants enforce **totality**: every function must be *total* (defined on all inputs) and *provably terminating*, and every pattern match must be *exhaustive*. **Totality checking is therefore not a nicety — it is what keeps the logic sound.** Understanding that is the difference between using these tools and *trusting* them.

The other axis this tier sharpens is the **proof-automation spectrum.** At one end, *interactive proof* (Coq, Lean, Agda): you build proofs by hand, often with tactics, expressing arbitrarily deep theorems but paying in human effort. At the other, *SMT-automated refinement* (Liquid Haskell, F\*, Dafny): you state pre/postconditions and a solver discharges them, scaling to large codebases but only within decidable theories. Real verified systems live somewhere on this line, and choosing where is an architectural decision with multi-year consequences.

> 🎓 **Why this matters at the senior level:** When someone says "we proved this code correct," you should immediately ask *three* questions: correct against *what* specification? Proved in *what* trusted base (what must you still trust)? And is the development *total*, or are there axioms/`admit`s/`assume`s holding it up? This tier equips you to interrogate verification claims instead of taking them on faith.

---

## Prerequisites

- **Required:** Middle tier — Pi/Sigma, indices, VC/SMT pipeline, definitional vs. propositional equality.
- **Required:** Comfort with recursion, induction, and structural reasoning over data types.
- **Required:** Basic logic — implication, quantifiers, what a "proof" is informally.
- **Helpful:** Having read or written a non-trivial induction proof on paper.
- **Helpful:** Exposure to a proof assistant's "goal/tactic" interaction (even a tutorial).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Curry–Howard correspondence** | Propositions ≅ types; proofs ≅ programs; proof normalization ≅ evaluation. |
| **Proof term** | A program whose *type* is a proposition; the program *is* the proof. |
| **Proof assistant** | A tool (Coq, Lean, Agda, Isabelle) for writing and machine-checking proofs. |
| **Tactic** | A command that builds a proof term incrementally by transforming proof goals (Coq/Lean). |
| **Totality** | A function being total: defined on all inputs **and** provably terminating, with exhaustive matching. |
| **Termination checking** | Proving recursion is well-founded (a metric strictly decreases), e.g. structural recursion. |
| **Coverage / exhaustiveness** | Every constructor pattern is handled; no missing cases. |
| **Soundness (of a logic)** | You cannot prove a false proposition. Requires totality in CH-based systems. |
| **`Type` / universe / `Prop`** | Types-of-types, stratified to avoid paradoxes; `Prop` is the universe of propositions. |
| **Propositional equality (`x = y`)** | A type asserting equality, proved by `Refl` only when both sides reduce to the same value. |
| **Trusted computing base (TCB)** | The code you must trust for the proof to mean anything (kernel of the checker, axioms, specs). |
| **Axiom** | An assumed-true proposition with no proof; expands the TCB and can introduce unsoundness. |
| **`admit` / `sorry` / `assume`** | Escape hatches that accept an unproved goal — convenient, dangerous, must be audited. |
| **Extraction** | Compiling a verified development to runnable code (Coq → OCaml/C; F\* → C/Wasm). |
| **Tactic vs. term mode** | Building a proof via tactic scripts vs. writing the proof term directly. |
| **Refinement reflection** | Lifting function definitions into the logic so SMT can reason about them (Liquid Haskell). |

---

## Core Concepts

### 1. Curry–Howard: the dictionary

The correspondence is a precise dictionary between logic and programming:

| Logic | Type theory |
|-------|-------------|
| proposition `P` | type `P` |
| proof of `P` | program (term) of type `P` |
| `P → Q` (implies) | function type `P -> Q` |
| `P ∧ Q` (and) | pair / product `(P, Q)` |
| `P ∨ Q` (or) | sum / `Either P Q` |
| `∀x. P(x)` | Pi type `(x : A) -> P x` |
| `∃x. P(x)` | Sigma type `(x : A ** P x)` |
| `True` | unit type (one trivial inhabitant) |
| `False` | empty type (no inhabitants) |
| `¬P` | `P -> False` |

To *prove* `P` is to *construct* a term of type `P`. To prove `∀ n. P n` is to write a (total) function taking `n` and producing a proof `P n`. To prove `∃ n. P n` is to produce a concrete `n` paired with evidence. **Proof = program** is not a metaphor here; it's the operational reality. Lean and Coq are literally programming environments where the things you build are proofs.

### 2. Equality as a type, and how you prove it

Propositional equality `x = y` is itself a type (a proposition). Its single constructor is `Refl : x = x` — reflexivity. You can build `Refl : a = b` only when `a` and `b` are *definitionally equal* (reduce to the same normal form). To prove a non-definitional equality (say `n + 0 = n`, which doesn't auto-reduce for variable `n`), you do **induction**: write a function that recurses on `n`, producing a proof in each case, using the inductive hypothesis. That function *is* the inductive proof. This is the bridge from the middle tier's "definitional equality runs out" to "so you write a proof by induction" — and that proof is just a total recursive program returning an equality term.

### 3. Totality is the load-bearing wall

Here is the crux that separates "fancy type system" from "trustworthy logic." Consider:

```idris
loop : a
loop = loop      -- typechecks if totality is OFF; "inhabits" EVERY type a
```

If `loop` is accepted, then `loop : False` — you've "proved" falsehood, and from `False` anything follows. Your entire proof system is now worthless. Therefore proof assistants **require totality**:

- **Termination.** Recursion must be well-founded — typically *structural*: each recursive call is on a structurally smaller argument. When that's not obvious, you supply a decreasing metric (well-founded recursion) or the checker rejects the function.
- **Coverage.** Pattern matches must be exhaustive; a missing case is a partial function, which is a hole in the logic.

Idris, Agda, Coq, and Lean all ship totality checkers. In Idris you can mark a function `total` and the compiler *verifies* it. **Soundness of the whole edifice rests on this.** When you "trust a Coq proof," part of what you're trusting is that nothing snuck a non-terminating term or an incomplete match past the checker. This is also why these languages feel restrictive: the same discipline that makes them sound makes general recursion and partiality awkward.

### 4. The trusted computing base, axioms, and escape hatches

A machine-checked proof is only as meaningful as what you must still *trust*. The **trusted computing base (TCB)** typically includes:

- The **kernel** of the proof checker (the small, audited core that validates proof terms).
- Any **axioms** you assumed (e.g. functional extensionality, classical logic, `UIP`). Each axiom you add is a promise you're not proving — and a *wrong* axiom makes the system unsound.
- The **specification** itself. A proof shows the code meets the spec; if the spec is wrong, the proof is worthless. *"Verified" means "verified against this spec,"* never "verified against your intentions."
- **Escape hatches** — Coq's `admit`/`Admitted`, Lean's `sorry`, F\*'s `assume` — which accept a goal *without* proof. Indispensable during development, catastrophic if they survive into a "complete" proof. Auditing a verified codebase means grepping for these.

A senior engineer evaluating a verification claim asks: *what's in the TCB, which axioms, any open `sorry`s, and is the spec the right one?* Those four questions separate real assurance from theater.

### 5. The proof-automation spectrum, concretely

```text
  interactive proof                                   SMT-automated refinement
  (Coq / Lean / Agda)                                 (Liquid Haskell / F* / Dafny)
        |                                                       |
  arbitrary theorems, deep math,                        pre/postconditions, invariants;
  full control; proofs by hand                          solver discharges VCs
  (tactics or terms)                                    automatically
        |                                                       |
  effort: high   power: unbounded                       effort: low   power: bounded
                                                         (decidable theories only)
```

- **Coq / Lean**: tactic-driven interactive proving. Used for CompCert (Coq), parts of mathlib (Lean), and deep mathematics. You pay in expert-hours; you can prove essentially anything.
- **Agda**: dependently typed programming with proofs-as-programs in *term* mode (less tactic automation, very direct).
- **F\***: dependent + refinement, with SMT (Z3) discharging most obligations and an interactive fallback for the rest. Powers HACL\* and miTLS.
- **Liquid Haskell**: refinement types bolted onto Haskell; SMT does the work; *refinement reflection* lets you reason about your own functions in the logic.
- **Dafny**: imperative verification with SMT; AWS uses it for critical components.

The architectural choice: **how much can the solver carry, and how much must humans prove?** More SMT = more scale, less depth. More interactive proof = more depth, less scale. Hybrid tools (F\*) try to get both, falling back to manual proof exactly where SMT gives up.

### 6. How verified systems are really built

Real-world verified software is not "write code, then prove it." It's **co-design**: the spec, the code, and the proof evolve together, often with significant restructuring to make proofs tractable.

- **CompCert** (Coq): a C compiler with a machine-checked proof of *semantic preservation* — the generated assembly behaves exactly as the C source specifies, for every program. The CSmith fuzzing study famously found bugs in GCC and Clang but *none* in CompCert's verified core. The compiler is *extracted* from Coq to OCaml.
- **seL4** (Isabelle/HOL): a microkernel with a refinement proof from abstract spec down to C, plus binary-level verification. ~10k lines of C, person-years of proof.
- **HACL\*** (F\*): a verified crypto library (used in Firefox, the Linux kernel, mozilla NSS). Proves memory safety, functional correctness against a math spec, and (some) side-channel resistance; extracted to C.
- **AWS** uses Dafny and F\* for critical components (e.g. cryptographic and authorization logic), where a single flaw is a fleet-wide security incident.

The recurring lesson: verification cost is dominated not by the code but by the **proof and spec engineering**, and it's justified only when a bug's cost is extreme — compilers, kernels, crypto, avionics.

---

## Real-World Analogies

**Curry–Howard = a contract whose fulfillment *is* the deliverable.** A proposition is a contract ("for any order, produce a valid invoice"). A proof is a *machine* that fulfills it for every input. You don't separately "prove the machine works" — building a total machine of the right type *is* the proof. Run it backwards: the deliverable and the guarantee are the same artifact.

**Totality = a referee who voids the game if a player can stall forever.** If one move lets a player loop indefinitely, the entire rulebook collapses (any outcome becomes "reachable"). The totality referee forbids non-terminating moves and incomplete rule coverage, precisely so that "winning" still means something.

**TCB = the foundation you don't inspect because you trust the surveyor.** You verified the building's structure, but you trusted the surveyor's measurements and the physics textbook. Axioms are assumptions in that textbook; a wrong one quietly undermines everything above it, no matter how careful the visible work.

**SMT vs. interactive = autopilot vs. hand-flying.** Autopilot (SMT) handles routine flight envelopes effortlessly and at scale, but disengages in conditions outside its model. Hand-flying (tactics) can handle anything, demands a trained pilot, and doesn't scale to a thousand simultaneous flights. Verified systems fly mostly on autopilot and hand-fly the edges.

---

## Mental Models

**1. To prove is to construct.** A proof is not an argument you narrate; it's a *value you build* of the proposition's type. "Can I prove P?" becomes "can I inhabit the type P?" — a programming question.

**2. Falsehood is the empty type; soundness is its emptiness.** `False` has no constructors. The whole game is keeping it uninhabited. Non-termination and incomplete matches are the two doors through which an inhabitant of `False` could sneak in — totality bolts both.

**3. Always ask "verified against what, trusting what?"** Every verification claim has a spec and a TCB. The proof connects code to spec *relative to* the TCB. Move the spec or shrink the TCB and the claim changes meaning.

**4. Automation trades depth for scale.** Picture a dial from "all SMT" to "all tactics." Turning toward SMT buys you throughput on routine obligations and costs you the ability to express deep theorems; turning toward tactics is the reverse. There's no free lunch; there's a chosen point.

**5. Erasure and extraction make proofs free *and* runnable.** The proof effort is compile-time; extraction yields ordinary OCaml/C/Wasm with no proof baggage. You ship fast code that happens to come with a theorem.

---

## Code Examples

### Example 1: A proof as a program (Idris/Agda flavor)

```idris
-- Proposition: for all n, n + 0 = n.  Proof: induction on n.
-- The function IS the proof; its type IS the theorem.

plusZeroRight : (n : Nat) -> n + 0 = n
plusZeroRight Z     = Refl                       -- 0 + 0 = 0 holds definitionally
plusZeroRight (S k) = cong S (plusZeroRight k)    -- use IH: (k+0=k) => (S k + 0 = S k)
```

`Refl` proves the base case (both sides reduce to `Z`). The inductive step transports the hypothesis `k + 0 = k` through `S` via `cong`. The totality checker confirms the recursion is structural (on `k`), so this is a *sound* proof, not a `loop` in disguise.

### Example 2: From `False`, anything (why totality matters)

```idris
-- If we COULD inhabit False, we could prove any P:
exFalso : False -> a
exFalso x = absurd x      -- absurd : False -> a ; valid BECAUSE False is empty

-- The danger: a non-total `loop : False` would feed exFalso and "prove" everything.
-- Totality checking rejects `loop`, keeping False uninhabited and the logic sound.
```

### Example 3: A verified, total `head` with an explicit non-empty witness (Coq-ish)

```coq
(* head requires a proof that the list is non-empty; impossible to call otherwise *)
Definition head {A} (l : list A) (pf : l <> nil) : A :=
  match l return l <> nil -> A with
  | nil       => fun pf => match pf eq_refl with end   (* nil case is impossible *)
  | cons x _  => fun _  => x
  end pf.
```

The `nil` branch derives a contradiction from `pf` (a proof that `l <> nil`) and is thus eliminated — exhaustiveness satisfied without a runtime check.

### Example 4: SMT-discharged correctness with reflection (Liquid Haskell)

```haskell
{-@ reflect fac @-}             -- lift fac into the logic so Z3 can reason about it
fac :: Int -> Int
fac n = if n <= 0 then 1 else n * fac (n - 1)

-- A theorem proved by SMT + a tiny proof combinator, not by hand induction:
{-@ facPos :: n:Nat -> { fac n >= 1 } @-}
facPos :: Int -> Proof
facPos n
  | n <= 0    = trivial
  | otherwise = facPos (n - 1)   -- structural recursion; Z3 closes each step
```

Contrast with Example 1: here the *solver* discharges the arithmetic, and your "proof" is a recursion skeleton that guides it. Less control, far less effort — when the property stays in Z3's reach.

### Example 5: F\* — refinement + dependent + SMT, with a fallback

```fsharp
// A division whose type forbids a zero denominator; Z3 discharges the precondition.
let divide (a:int) (b:int{b <> 0}) : int = a / b

// A lemma F* proves automatically via SMT:
let rec sum_upto (n:nat) : nat = if n = 0 then 0 else n + sum_upto (n - 1)

val sum_formula (n:nat) : Lemma (sum_upto n == n * (n + 1) / 2)
let rec sum_formula n =
  if n = 0 then () else sum_formula (n - 1)   // induction; Z3 closes the arithmetic
```

F\* sits in the middle of the spectrum: SMT does most of the work, and when it can't, you drop into interactive proof — the model HACL\* uses at scale.

---

## Pros & Cons

### Pros

| Benefit | Why it matters |
|---------|----------------|
| **Machine-checked truth** | Theorems and program correctness verified by a small trusted kernel. |
| **One language for code + proof** | Curry–Howard unifies them; proofs live next to the code they justify. |
| **Foundations for verified systems** | CompCert, seL4, HACL\* exist because of this. |
| **Extraction to fast code** | Verified developments compile to OCaml/C/Wasm with no proof overhead. |
| **Spectrum of automation** | Choose SMT scale or tactic depth (or hybrid) per obligation. |

### Cons

| Cost | Why it hurts |
|------|--------------|
| **Totality straitjacket** | General recursion/partiality must be encoded carefully; soundness demands it. |
| **Proof engineering dominates cost** | Person-years for kernels; specs and proofs dwarf the code. |
| **TCB and axioms are subtle** | A wrong axiom or stray `sorry` silently voids assurance. |
| **Spec risk** | "Verified" only against the spec you wrote — which may be wrong. |
| **Scarce expertise** | The people who can do this are few and expensive. |

---

## Use Cases

- **Verified compilers and toolchains** (CompCert; semantic preservation).
- **Verified OS kernels / hypervisors** (seL4; full functional correctness).
- **Verified cryptography** (HACL\*, EverCrypt, fiat-crypto; correctness + memory + side channels).
- **Formalized mathematics** (Lean `mathlib`; the Liquid Tensor Experiment; four-color and Feit–Thompson in Coq).
- **High-assurance cloud components** (AWS Dafny/F\* for crypto and authorization).
- **Avionics / safety-critical control** where certification (DO-178C) rewards formal evidence.

---

## Coding Patterns

**1. Spec → code → proof co-design.** Don't bolt proofs on; shape the code so the proofs are tractable from the start.

**2. Keep functions total and structurally recursive.** Reach for accumulators and well-founded measures so the termination checker stays happy.

**3. Push obligations to SMT, escalate to tactics at the gap.** In F\*/Liquid Haskell, let Z3 carry routine arithmetic; hand-prove only the residue.

**4. Minimize the TCB.** Avoid axioms where possible; isolate and document the ones you accept; treat every `admit`/`sorry`/`assume` as a tracked debt.

**5. Extract and test the boundary.** Verified core, but the I/O shell and FFI are unverified — keep that boundary thin and audited.

---

## Best Practices

- **Audit for soundness holes.** Grep for `admit`, `Admitted`, `sorry`, `assume`, `believe_me`, and every `Axiom` before trusting a development.
- **Write the spec as carefully as the proof.** Most "verified but wrong" outcomes are spec bugs, not proof bugs. Validate the spec independently (tests, review, redundant statements).
- **State the TCB explicitly.** A verification claim should ship with "what you must trust." If it doesn't, distrust it.
- **Prefer SMT for breadth, tactics for depth.** Match the tool to the obligation; don't hand-prove what Z3 closes in milliseconds, and don't ask Z3 to do deep induction.
- **Track proof-maintenance cost.** Proofs are brittle under refactoring; budget for re-proving when the code changes.
- **Erase and extract deliberately.** Confirm the runtime artifact carries no proof baggage and that extraction's TCB (the extractor itself) is accounted for.

---

## Edge Cases & Pitfalls

- **The `loop : False` trap.** Disabling totality (or using an unsound escape) collapses the logic — you can "prove" anything. Never trust a non-total proof artifact.
- **Inconsistent axioms.** Combining classical logic, impredicativity, and certain choice principles can yield inconsistency; adding axioms is not free.
- **Coverage holes that look exhaustive.** A match that *seems* complete but relies on an unproven impossibility can hide a partial function; the checker must *confirm* impossibility.
- **Spec drift.** Code and spec evolve; an out-of-date spec means the proof now guarantees the wrong thing.
- **SMT incompleteness mistaken for code bugs.** Z3 may fail on true nonlinear/quantified goals; the fix is reformulation or a manual lemma, not changing correct code.
- **TCB creep via extraction/FFI.** The extractor, the C compiler, and unverified glue are all in the real TCB even if the core is verified.
- **"Verified" marketing.** A proof of memory safety is not a proof of functional correctness is not a proof of side-channel resistance. Ask *which* property was proved.

---

## Summary

Run Curry–Howard to its conclusion and a dependently typed language becomes a **proof assistant**: propositions are types, proofs are programs, and the type checker verifies theorems. Equality is a type proved by `Refl` (definitional) or by **induction** (a total recursive program) when it isn't. The non-negotiable price is **totality** — every function must be total and provably terminating with exhaustive matching — because a single non-terminating term inhabits `False` and collapses the logic into inconsistency. Trust in any verified artifact reduces to its **trusted computing base**: the checker's kernel, the **axioms** assumed, the **specification** proved against, and any surviving `admit`/`sorry`/`assume`. Tools span an **automation spectrum** from interactive proof (Coq, Lean, Agda — unbounded power, high effort) to SMT-automated refinement (Liquid Haskell, F\*, Dafny — bounded power, high scale), with hybrids (F\*) covering both. This machinery is what makes **CompCert**, **seL4**, **HACL\***, and **mathlib** possible — and why verified software's cost is dominated by spec-and-proof engineering, justified only where a bug is catastrophic. The senior reflex: when told "it's verified," ask *against which spec, trusting what, and is it really total?*

---

## Further Reading

- *Software Foundations* (Pierce et al.) — Coq, proofs-as-programs, the canonical course.
- *Certified Programming with Dependent Types* (Chlipala) — engineering large Coq proofs.
- *Theorem Proving in Lean 4* — Curry–Howard and tactics in Lean.
- *Programming Language Foundations in Agda* — totality and proofs in term mode.
- Leroy, *"Formal Verification of a Realistic Compiler"* (CompCert) and the CSmith study.
- Klein et al., *"seL4: Formal Verification of an OS Kernel."*
- Zinzindohoué et al., *"HACL\*: A Verified Modern Cryptographic Library"* (F\*).
- Vazou et al., *"Refinement Reflection"* (Liquid Haskell) — proving in an SMT setting.
