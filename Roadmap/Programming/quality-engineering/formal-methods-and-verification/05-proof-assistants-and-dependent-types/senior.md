# Proof Assistants & Dependent Types — Senior Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → Proof Assistants & Dependent Types
> *Model checkers explore a state space for you. A proof assistant asks you to do the mathematics — and then it checks every step against a kernel of a few thousand lines. This page is about the type theory underneath, the trusted computing base you are actually betting on, and why a 100,000-line Coq proof buys "no miscompilation" for a C compiler that ships in production.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Three Foundations: CIC, Martin-Löf, and HOL](#core-concept-1--three-foundations-cic-martin-löf-and-hol)
5. [Core Concept 2 — The Universe Hierarchy and `Type : Type`](#core-concept-2--the-universe-hierarchy-and-type--type)
6. [Core Concept 3 — `Prop` vs `Type`, Proof Irrelevance, and Erasure](#core-concept-3--prop-vs-type-proof-irrelevance-and-erasure)
7. [Core Concept 4 — Inductive Types and Their Eliminators](#core-concept-4--inductive-types-and-their-eliminators)
8. [Core Concept 5 — Equality, Axiom K, and the Doorway to HoTT](#core-concept-5--equality-axiom-k-and-the-doorway-to-hott)
9. [Core Concept 6 — Dependent Types in Anger](#core-concept-6--dependent-types-in-anger)
10. [Core Concept 7 — Totality: Why Non-Termination Breaks the Logic](#core-concept-7--totality-why-non-termination-breaks-the-logic)
11. [Core Concept 8 — The Trusted Computing Base and the de Bruijn Criterion](#core-concept-8--the-trusted-computing-base-and-the-de-bruijn-criterion)
12. [Core Concept 9 — Proof Engineering: Proofs Are Software](#core-concept-9--proof-engineering-proofs-are-software)
13. [Core Concept 10 — Extraction and Verified Artifacts](#core-concept-10--extraction-and-verified-artifacts)
14. [Real-World Examples](#real-world-examples)
15. [Mental Models](#mental-models)
16. [Common Mistakes](#common-mistakes)
17. [Test Yourself](#test-yourself)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [Further Reading](#further-reading)
21. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The type theory a proof assistant runs on, what you are actually trusting when it says `Qed`, and what verified software costs in person-years.**

A model checker (topic 02) and an SMT-backed contract verifier (topic 04) are *push-button* in spirit: you state a property, a search algorithm decides it, and you get a yes, a no, or a timeout. A proof assistant is the opposite. It will not find the proof for you — it makes *you* (with help from tactics) construct a term whose type is the theorem, and then it re-checks that term against a small **kernel**. The payoff is unmatched expressiveness: you can state and prove "this C compiler never miscompiles a well-defined program," a property no model checker can even phrase, because the property quantifies over all source programs, all inputs, and the entire semantics of two languages.

The price is equally real. Verified artifacts ship with **proof-to-code ratios** measured in single to double digits, demand a scarce skill, and impose a maintenance tax forever after. The senior job is to understand the machinery well enough to (a) know what the `Qed` actually guarantees and what it silently assumes, and (b) judge when the property is valuable enough to pay the price — which is exactly the cost/benefit conversation that topic 06 turns into a decision rule. This page is the machinery: the type theory, the kernel, the proof-engineering reality, and the case studies with their numbers.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — the Curry–Howard correspondence (propositions as types, proofs as programs), what a tactic does, and the difference between checking a proof and finding one.
- **Required:** Comfort with [01 — Formal Specification](../01-formal-specification/senior.md): a proof is only as meaningful as the spec it proves, and the spec is part of your trusted base.
- **Helpful:** You've written a non-trivial proof in Coq, Lean, Isabelle, or Agda and felt a proof break when a definition changed underneath it.
- **Helpful:** Working knowledge of inductive data types and structural recursion in any typed functional language (the substrate of every concept here).

---

## Glossary

| Term | Meaning |
|---|---|
| **CIC** | Calculus of Inductive Constructions — the dependent type theory underlying Coq/Rocq. |
| **MLTT** | Martin-Löf Type Theory — the intensional dependent type theory underlying Agda and (a variant) Lean. |
| **HOL** | Higher-Order Logic — simply-typed λ-calculus + logic; the basis of Isabelle/HOL and HOL Light. |
| **Universe** | A "type of types" (`Type₀ : Type₁ : …`), stratified to avoid paradox. |
| **`Prop`** | The impredicative sort of *propositions*; proof-irrelevant and erased at extraction. |
| **Definitional (judgmental) equality** | Equality the kernel decides by computation/reduction; `≡`. Silent, automatic. |
| **Propositional equality** | The `=` (`Id`/`eq`) type you reason about with `rewrite`; must be proven. |
| **Eliminator / recursor** | The induction principle auto-generated for an inductive type (`nat_rect`, `Vec.rec`). |
| **Positivity condition** | Restriction on inductive definitions that keeps the logic sound (no negative self-reference). |
| **TCB** | Trusted Computing Base — everything whose correctness you must assume, not prove. |
| **de Bruijn criterion** | A system satisfies it if proofs are checkable by a small, independent kernel. |
| **Extraction** | Compiling a proven term to executable OCaml/Haskell/Scheme, erasing proofs. |
| **Hammer** | A tactic (Sledgehammer, CoqHammer) that calls external ATP/SMT and reconstructs a kernel-checkable proof. |

---

## Core Concept 1 — Three Foundations: CIC, Martin-Löf, and HOL

Every proof assistant is a *logic* wearing a *type system*. The three live foundations differ in how much they put into the types, and that choice ripples through everything.

| | **Isabelle/HOL** | **Coq / Rocq (CIC)** | **Agda / Lean (MLTT)** |
|---|---|---|---|
| Foundation | Higher-order logic (STLC + logic) | Calculus of Inductive Constructions | Martin-Löf type theory |
| Types depend on values? | No | Yes | Yes |
| Logic | Classical by default | Constructive by default | Constructive by default |
| Proof style | Mostly automated (Isar, Sledgehammer) | Tactics (Ltac/Ltac2) + terms | Terms first (Agda) / tactics + terms (Lean) |
| Sweet spot | Large classical math/systems proofs | Verified software + extraction | Type-theory research, Lean's `mathlib` |

**HOL** is *not* dependently typed: a type cannot mention a value, so you cannot write "vector of length `n`" as a type. It compensates with mature automation and a clean classical logic — which is why **seL4** is an Isabelle/HOL proof. **CIC** and **MLTT** are dependently typed: types are first-class terms, so `Vec A n` (a vector whose length is part of its type) is expressible, and you can make illegal states unrepresentable.

The constructive-vs-classical axis matters operationally. In a constructive logic, a proof of `∃ x. P x` *contains* a witness you can compute, and a proof of `P ∨ Q` tells you *which* disjunct holds. Excluded middle (`P ∨ ¬P`) and choice are **not** built in — you add them as axioms if you want them, and doing so is exactly where you start trading erasability and computational content for convenience.

> **Key insight:** The foundation is a budget decision. Dependent types buy you "correct by construction" data and the ability to state arbitrarily rich specifications — at the cost of decidable type-checking becoming subtle and inference becoming undecidable in general. HOL gives up that expressiveness and gets back automation and simplicity. There is no free lunch; there is a foundation that fits the proof you have to do.

---

## Core Concept 2 — The Universe Hierarchy and `Type : Type`

A dependent type theory wants types to be values so it can compute with them. The naive move — `Type : Type` (the type of all types is itself a type) — is **inconsistent**: Girard's paradox encodes Russell's paradox inside the system and lets you prove `False`. A system that can prove `False` proves *everything*, which makes every theorem worthless.

The fix is a **stratified hierarchy** of universes:

```coq
(* Coq *)
Check nat.        (* nat  : Set        i.e. Type@{0} *)
Check Set.        (* Set  : Type@{1} *)
Check Type.       (* Type : Type@{i+1}  — each Type lives in a higher Type *)
```

`Type₀ : Type₁ : Type₂ : …`, with no top. Nothing is its own type, so the paradox cannot be built. The cost is annoying duplication: a generic `list` ought to work at every level, but a fixed-level `list : Type₀ → Type₀` cannot hold `list Type₀`. **Universe polymorphism** solves this — a definition is parameterized over universe levels, so `list@{i}` instantiates wherever you use it:

```coq
Polymorphic Definition id {A : Type} (x : A) : A := x.
(* one definition, usable at Set, Type₀, Type₁, … without re-proving *)
```

`mathlib` and the Coq standard library lean hard on universe polymorphism; without it, large libraries would either fix everything at one level (too rigid) or duplicate definitions per level (unmaintainable). Universe *inconsistency* errors ("universe inconsistency: cannot enforce `i < i`") are a real, occasionally maddening, category of proof-engineering failure — the type checker has discovered that your composition of definitions implies a universe must be strictly below itself.

> **Key insight:** `Type : Type` is the type-theory equivalent of an unrestricted set of all sets. Stratification is not pedantry — it is the difference between a consistent logic and one that proves `2 = 3`. When you see universe annotations leaking into error messages, the kernel is defending its own consistency.

---

## Core Concept 3 — `Prop` vs `Type`, Proof Irrelevance, and Erasure

CIC (and Lean) split the universe of *propositions* (`Prop`) from the universe of *data* (`Type`/`Set`). They look similar — both are sorts — but they are governed by different rules with deep practical consequences.

- **`Type` / `Set`** is for *data with computational content*. A `nat`, a `list`, a `Vec A n` — these are values you compute with and that survive to runtime.
- **`Prop`** is for *propositions*, where the only thing that matters is *whether* a proof exists, not *which* proof. This licenses **proof irrelevance**: any two proofs of the same `Prop` are treated as interchangeable, and — crucially — proofs in `Prop` are **erased** during extraction. A proof that an array index is in bounds adds zero bytes and zero instructions to the extracted code.

```coq
(* `even` as a Prop: a *proof* it's even, erased at extraction *)
Inductive even : nat -> Prop := ...

(* `evenb` as data: a *boolean*, survives to runtime *)
Definition evenb (n : nat) : bool := ...
```

`Prop` is also **impredicative** in Coq (`forall (P : Prop), P -> P` is itself a `Prop`, quantifying over the very universe it lives in), which is safe for propositions precisely because they carry no data to make the quantification paradoxical. To preserve erasability and irrelevance, CIC restricts **large elimination**: you generally cannot pattern-match on a `Prop` to *produce* a `Type`-level value, because that would let runtime data depend on an erased proof. (`False_rect`-style "ex falso" elimination is the controlled exception — from a proof of `False` you may produce anything, because there is no such proof to be erased.)

> **Key insight:** `Prop` vs `Type` is the line between "this is a guarantee" and "this is data." Putting your specifications in `Prop` is what makes verified code *as fast as unverified code* — every safety proof vanishes at extraction, leaving only the algorithm. Misplacing the line (data in `Prop`, or a proof you wanted to compute with in `Type`) is one of the most common early design errors.

---

## Core Concept 4 — Inductive Types and Their Eliminators

Inductive definitions are the heart of CIC/MLTT. Declaring one does three things at once: it introduces a new type, its constructors, and — automatically — its **induction principle** (the eliminator/recursor). The recursor *is* induction; tactics like `induction` are sugar over applying it.

```coq
Inductive nat : Type :=
  | O : nat
  | S : nat -> nat.

(* Coq generates, among others: *)
nat_ind : forall P : nat -> Prop,
  P O ->                                   (* base case *)
  (forall n : nat, P n -> P (S n)) ->      (* step case *)
  forall n : nat, P n.                     (* conclusion: P holds for all nat *)
```

Read `nat_ind` as Curry–Howard makes it: it is *exactly* the statement of mathematical induction, and its **type is the theorem** "to prove `P` for all naturals, prove `P O` and the step." A proof by induction is the program that supplies those two arguments.

Here is a real proof — `n + 0 = n` — that exposes the senior reality of dependent proving: you often must **generalize the goal** before induction, because the obvious induction hypothesis is too weak.

```coq
Theorem add_0_r : forall n : nat, n + 0 = n.
Proof.
  induction n as [| n' IHn'].
  - reflexivity.                 (* base: 0 + 0 = 0, by computation *)
  - simpl. rewrite IHn'.         (* step: S n' + 0 = S (n' + 0); IH rewrites the inner term *)
    reflexivity.
Qed.
```

The asymmetry is the lesson: `0 + n` reduces to `n` *definitionally* (it's how `+` is defined by recursion on the *first* argument), but `n + 0` does **not** reduce — it genuinely needs induction. Two propositions that are "obviously equal" can require completely different proofs depending on which argument the recursion peels. This is the daily texture of proof engineering: the prover computes what it can for free (definitional equality) and forces you to prove the rest.

The eliminator also explains the **positivity condition** (Core Concept 7): the generated recursor is only sound if the inductive type is *well-founded*, which constrains how the type may refer to itself.

---

## Core Concept 5 — Equality, Axiom K, and the Doorway to HoTT

Equality is where dependent type theory gets genuinely deep, and a senior should be able to speak about it precisely without overclaiming.

There are **two equalities**:

- **Definitional / judgmental equality** (`≡`): the kernel decides this by reduction. `2 + 2 ≡ 4` is settled by computation — you never prove it; the type checker just *knows* it. This is what makes Coq's `reflexivity` close `2 + 2 = 4` instantly.
- **Propositional equality** (`=`, the `eq`/`Id` inductive type): a *proposition* you must prove, with `refl : x = x` as its only constructor. `n + 0 = n` is propositional — true, but not definitional, hence the induction above.

Dependent pattern matching on equality is where it bites. Because a value's *type* can mention another value, rewriting along an equality (`x = y`) must transport a term from a type indexed by `x` to one indexed by `y` — the `eq_rect`/`transport` operation. When you pattern-match the equality proof itself, you confront a foundational question: **is every proof of `x = x` equal to `refl`?**

- **Axiom K / UIP** (Uniqueness of Identity Proofs): "any two proofs of `a = a` are equal." Agda's `with`/dependent matching historically assumed K; Coq does *not* assume it but lets you. UIP makes dependent pattern matching pleasant and is consistent with a "sets are sets" worldview.
- **Univalence / HoTT**: Homotopy Type Theory reinterprets `a = b` as a *path* (a proof of sameness in a space), and the **univalence axiom** says "equivalent types are equal" (`(A ≃ B) ≃ (A = B)`). Under univalence, types can have higher structure — there can be *genuinely different* proofs of equality — so **UIP is false in general**. HoTT and UIP are *incompatible* foundations; you pick one.

```coq
(* eq is just an inductive type with one constructor: *)
Inductive eq {A} (x : A) : A -> Prop := eq_refl : eq x x.
(* `rewrite H` where H : x = y uses eq's eliminator to transport the goal *)
```

> **Key insight:** "Equality" is two different things wearing one symbol. The kernel hands you definitional equality for free; propositional equality is work. Whether identity proofs are unique (UIP) or carry structure (univalence) is a *foundational choice with consequences*, not a detail — it determines whether dependent pattern matching is straightforward and whether you can use HoTT's transport-based reasoning. For verified-software work you almost always want UIP; HoTT matters when the *mathematics* of equality is the point.

---

## Core Concept 6 — Dependent Types in Anger

The practical superpower of CIC/MLTT is the **indexed inductive family**: a type parameterized by *values*, so invariants live in the type and the checker enforces them by construction. The canonical example is the length-indexed vector.

```coq
Inductive Vec (A : Type) : nat -> Type :=
  | vnil  : Vec A 0
  | vcons : forall n, A -> Vec A n -> Vec A (S n).

(* head is TOTAL — its type forbids the empty case: *)
Definition vhead {A n} (v : Vec A (S n)) : A :=
  match v with vcons _ x _ => x end.   (* no vnil case needed: vnil : Vec A 0 ≠ Vec A (S n) *)
```

`vhead` cannot be called on an empty vector — not "throws at runtime," but **rejected at type-check time**, because `Vec A 0` and `Vec A (S n)` are different types and the kernel knows `0 ≠ S n` definitionally. A whole class of "index out of bounds" bugs is moved from runtime to the type checker. `Fin n` (the type of naturals strictly less than `n`) gives the same guarantee for indexing: a `Fin n` is a *proof-carrying* index that is automatically in range.

The same idea makes **well-typed-by-construction interpreters**. Encode a tiny expression language indexed by the type it evaluates to, and the *only* expressions you can build are well-typed ones; the evaluator is then total and obviously type-preserving:

```coq
Inductive Ty := TNat | TBool.
Inductive Expr : Ty -> Type :=          (* index = the type this Expr evaluates to *)
  | ENat  : nat  -> Expr TNat
  | EBool : bool -> Expr TBool
  | EIf   : forall t, Expr TBool -> Expr t -> Expr t -> Expr t
  | EAdd  : Expr TNat -> Expr TNat -> Expr TNat.

Fixpoint denote (t : Ty) : Type :=      (* meaning of a type *)
  match t with TNat => nat | TBool => bool end.

Fixpoint eval {t} (e : Expr t) : denote t :=   (* total, type-preserving by construction *)
  match e with
  | ENat n      => n
  | EBool b     => b
  | EIf _ c a b => if eval c then eval a else eval b
  | EAdd a b    => eval a + eval b
  end.
```

You cannot construct `EAdd (EBool true) (ENat 1)` — it does not type-check — so `eval` needs no "type error" case. This is **proof-carrying code** in miniature: the artifact carries its own correctness.

The cost is the **expressiveness/decidability trade-off**. The richer your indices, the more the type checker must prove definitional equalities to accept your matches, and the more often you must insert explicit equality rewrites/transports. Type *inference* is undecidable for full dependent types — you supply more annotations. There is also the **"boolean blindness"** argument (Harper): a function returning `bool` throws away *why* it said true. `even_dec n : {even n} + {~ even n}` returns, in each branch, a *proof* you can use; a bare `bool` returns a bit you must re-derive. Prefer decision procedures that return evidence over predicates that return bits — the evidence is what later proofs consume.

> **Key insight:** Dependent types let you push correctness into the type so the kernel checks it once and for all, and erase it so it costs nothing at runtime. The discipline is "make illegal states unrepresentable" taken to its logical extreme — the compiler's type checker becomes a theorem prover working for you.

---

## Core Concept 7 — Totality: Why Non-Termination Breaks the Logic

A proof assistant's logic is sound **only if every function it accepts terminates**. The reason is Curry–Howard: a function of type `A → B` *is* a proof that `A` implies `B`. A non-terminating "function" of type `forall P, P` would be a proof of every proposition — including `False`. So the totality checker is not an ergonomic nicety; it is load-bearing for consistency.

Three mechanisms keep functions total:

1. **Structural recursion.** Every recursive call must be on a *structurally smaller* argument (a sub-term of the input). The checker verifies this syntactically; it is why `Fixpoint` on `nat`/`list` "just works" and why a recursive call on the *same* argument is rejected.
2. **Well-founded recursion.** When recursion isn't structurally decreasing (e.g., merge sort halving a list, Euclid's GCD), you provide a *measure* into a well-founded order and a proof it decreases (`Program Fixpoint`, `Equations`, `Fix`). You are discharging a termination proof obligation.
3. **The positivity condition** for inductive types. A constructor may not take an argument in which the type being defined occurs to the *left* of an arrow (a "negative occurrence"). The classic forbidden type:

```coq
(* REJECTED: Bad occurs negatively (left of ->) *)
Inductive Bad := mk : (Bad -> Bad) -> Bad.
```

Were `Bad` allowed, you could encode the untyped λ-calculus, write a non-terminating term, and prove `False`. Positivity is what guarantees the auto-generated recursor is well-founded.

The practical seam: the checker is **sound but incomplete** — it rejects some functions that *do* terminate but whose termination it can't see structurally. That is the price of decidable checking. You either restructure into obviously-structural form or carry an explicit well-foundedness proof. (Coq's `Function`/`Equations` and Lean's termination tactics exist precisely to automate the common cases.)

> **Key insight:** "It type-checks" in a proof assistant secretly includes "it terminates." Disable termination checking (Agda's `{-# TERMINATING #-}`, Coq's `Admitted`, an `axiom`) and you have punched a hole straight through to `False`. Every consistency guarantee the system makes is downstream of every accepted definition being total.

---

## Core Concept 8 — The Trusted Computing Base and the de Bruijn Criterion

When a proof assistant prints `Qed`, what have you actually proven, and to *whom* should you be skeptical? This is the most important senior-level question, because "machine-checked" is often heard as "certain," and the truth is more disciplined and more interesting.

The architecture that earns the trust is the **de Bruijn criterion**: the system is designed so that all proofs, however they were *found*, are ultimately checked by a **small, fixed kernel** that can be audited (and re-implemented) independently. Coq's kernel is on the order of a few thousand lines; the entire elaborate tactic engine, the standard library, and your custom automation sit *outside* it.

> **Key insight:** **Tactics are untrusted.** A tactic is a (possibly buggy) program that *builds a proof term*. The kernel then re-type-checks that term from scratch. If the tactic is wrong, it produces a term the kernel *rejects* — it cannot sneak a false theorem past the kernel. This is why you can use aggressive, heuristic, even AI-driven automation with no loss of soundness: the kernel is the only judge, and it only believes terms it can verify itself.

So what is genuinely in your **TCB** — the set of things you assume rather than prove?

1. **The kernel implementation** — and the language/compiler it's written in (OCaml for Coq), and ultimately the hardware it runs on. A kernel bug *can* admit a false proof; this is rare but not hypothetical (Coq has had historical kernel soundness bugs, found and fixed).
2. **Axioms you add.** A bare CIC proof assumes only the kernel. The moment you `Axiom` in classical logic (excluded middle), **functional extensionality**, **proof irrelevance**, or **choice**, *those* join your TCB. They are known-consistent with CIC, but they are assumptions, and `Print Assumptions my_theorem` will list exactly which ones a given proof depends on — a command every serious Coq user runs before claiming a result.
3. **The specification itself.** This is the subtle one and ties straight back to [01 — Formal Specification](../01-formal-specification/senior.md): you proved the *implementation* satisfies the *spec*. If the spec is wrong or vacuous, the proof is worthless. "Proved correct" always means "correct *with respect to this spec*."
4. For extracted code: **the extraction mechanism** and the gap between the verified term and the binary that actually runs (Core Concept 10).

```coq
Print Assumptions add_0_r.
(* "Closed under the global context"  — depends on NO axioms (pure CIC). *)
Print Assumptions some_classical_theorem.
(* lists: classic : forall P, P \/ ~ P   ← excluded middle is in this proof's TCB *)
```

This is the precise, honest reading of Knuth's quip — *"Beware of bugs in the above code; I have only proved it correct, not tried it."* Machine-checked proof eliminates the gap between "I argued it correct" and "it is correct *relative to the kernel and the stated axioms and the stated spec*." It does **not** eliminate the spec/TCB/hardware caveats. A senior states the guarantee with those caveats attached, every time.

---

## Core Concept 9 — Proof Engineering: Proofs Are Software

The thing nobody tells you in the tutorials: **a proof is a software artifact, and it must be maintained.** A 200,000-line proof corpus (seL4) or a multi-million-line library (`mathlib`) has all the problems of a large codebase — and one extra: **proof brittleness**. Change a definition, rename a lemma, or tweak a tactic's behavior, and proofs *far away* shatter, because tactic scripts are notoriously sensitive to the exact shape of goals.

The senior disciplines that keep proof corpora alive:

- **Robust tactic style.** Prefer tactics that don't depend on auto-generated hypothesis names (`intros H1 H2` over relying on `H`, `H0`); avoid brittle positional `apply`; use structured combinators. Lean's and Isabelle's communities enforce naming and style conventions partly to bound this fragility.
- **Proof refactoring.** Extracting lemmas, generalizing statements (recall `add_0_r`'s need to generalize), and abstracting repeated patterns — the same hygiene as code refactoring, with `git` diffs that are just as reviewable.
- **CI for proofs.** Large projects run the *entire* proof corpus in CI on every change, because the only way to know a refactor didn't silently break proof #4,012 is to re-check all of them. Build times become a first-class concern — `mathlib` checks take a build farm; seL4's proof is a substantial CI job.
- **Custom automation.** **Ltac/Ltac2** (Coq), **Lean metaprogramming** (Lean tactics are Lean programs with full access to the elaborator), and **Isar** (Isabelle's structured proof language) let you write domain-specific tactics that absorb the brittleness — a good custom tactic survives definition changes that would break a hand-written script.
- **Hammers.** **Sledgehammer** (Isabelle) and **CoqHammer** bridge to external **ATP/SMT** solvers: they ship the goal to E/Vampire/Z3/CVC4, get a proof *outline*, and then **reconstruct a kernel-checkable proof** locally. This is the de Bruijn criterion in action — the powerful-but-untrusted external solver only *suggests*; the kernel still certifies. Sledgehammer is a large part of why Isabelle proofs are as productive as they are.

> **Key insight:** The headline cost of formal verification is not writing the first proof — it is *keeping it true* as the specification and implementation evolve. Treat proofs as code: name things, factor lemmas, automate the repetitive parts, and run everything in CI. A proof corpus with no automation and no naming discipline becomes unmaintainable at exactly the scale where it would have been most valuable.

---

## Core Concept 10 — Extraction and Verified Artifacts

A proof that an algorithm is correct is only useful if you can *run* the algorithm. **Extraction** compiles a CIC/MLTT term into executable code — Coq extracts to **OCaml, Haskell, or Scheme**; Lean and Agda compile directly. Crucially, everything in `Prop` is **erased**: all the safety proofs evaporate, leaving code as efficient as if you'd hand-written it.

```coq
Require Extraction.
Extraction Language OCaml.
Recursive Extraction eval.   (* emits OCaml: the algorithm only, proofs gone *)
```

But extraction *adds to the TCB* in two ways, and a senior names both:

1. **The extraction mechanism itself** is (largely) unverified code translating CIC to OCaml. A bug there could, in principle, produce OCaml that doesn't match the verified term.
2. **The spec↔extracted-code gap** plus the downstream **OCaml/Haskell compiler and runtime**. You proved a property of the *term*; the bytes that execute went through a GC'd runtime you did not verify.

This is why the strongest results push the verified boundary *outward*:

- **CompCert** extracts a verified C compiler from ~100,000 lines of Coq; the *theorem* covers the translation from C to assembly. (See Real-World Examples.)
- **Fiat-Crypto** *generates* C code for field arithmetic and *proves it correct*, then that C is compiled normally — verified down to the arithmetic, with the C compiler in the TCB.
- **CakeML** closes the loop: a verified ML compiler whose correctness is proven *down to the machine code*, with the verification covering the compiler's own bootstrapping — eliminating the "trust the OCaml/HOL extraction-and-compile step" caveat that plain extraction leaves open.

> **Key insight:** Extraction trades "trust the kernel only" for "trust the kernel + the extractor + the target toolchain." That is still a *dramatically* smaller and better-understood TCB than testing-based assurance — but it is not zero, and projects like CakeML exist precisely to verify the parts extraction leaves trusted. State what's in your verified core and what's downstream of it.

---

## Real-World Examples

**CompCert — a verified C compiler.** Xavier Leroy's CompCert is a moderately-optimizing C compiler whose correctness is *proven in Coq*: ≈100,000 lines of Coq encode the semantics of the source (a large C subset, "Clight") and the target assembly, and prove a **semantic preservation** theorem — any observable behavior of the compiled program is an allowed behavior of the source. The practical payoff: **no miscompilation bugs.** The Csmith random-differential-testing campaign found *hundreds* of bugs in GCC and Clang and **zero** in CompCert's verified core. The honest caveat — the senior part — is the boundary: the *frontend* parsing/preprocessing and the *unverified* runtime/linking sit outside the verified theorem, as does the gap between the C standard and CompCert's formal C semantics. The guarantee is precise: the *verified middle* never miscompiles.

**seL4 — a verified OS microkernel.** seL4 is ≈**10,000 lines of C**, verified in **Isabelle/HOL** with ≈**200,000+ lines of proof** at a cost of roughly **20+ person-years**. The original result (2009) was **functional correctness**: the C implementation refines an abstract specification. Later work added **integrity and confidentiality** (information-flow) proofs and **binary-level verification** — proving the *compiled binary* refines the C, which removes the C compiler from the TCB for that property. The assumptions are stated explicitly: correctness of the (small) assembly stubs, the hardware model, and the boot code. seL4 is the canonical demonstration that *full functional correctness of real systems code is achievable* — and the canonical illustration of its **cost**: ≈20 person-years for 10k lines is a proof-to-code ratio that only makes sense for a security-critical kernel.

**Fiat-Crypto — verified cryptographic primitives in production.** Fiat-Crypto *generates and proves correct* the field-arithmetic code underlying elliptic-curve cryptography (e.g., Curve25519, P-256), then emits C. That generated, *proven* C is **deployed in BoringSSL** and ships in Chrome and Android — verified math running on billions of devices. It is the strongest counterexample to "formal methods don't ship": the hottest, most bug-prone, hand-optimized-assembly-traditionally code (big-integer modular arithmetic) is exactly where machine-checked proof has displaced hand-tuned code *in production*.

**The great mathematics proofs.** The **Four Color Theorem** (Gonthier, fully formalized in Coq, 2005) settled a result whose original proof relied on an unverified computer enumeration; the **Feit–Thompson odd-order theorem** (Gonthier et al., Coq, 2012) formalized a ~250-page proof; **Flyspeck** (Hales et al., 2014, Isabelle/HOL + HOL Light) verified the Kepler conjecture's proof, which referees had been unable to fully check by hand. These are the demonstrations that proof assistants scale to mathematics humans cannot reliably check unaided.

**Lighter-weight cousins.** Not every assurance problem warrants CIC. **Liquid Haskell** (refinement types on Haskell) and **F\*** (a dependently-typed language with SMT automation, used in **Project Everest**'s verified TLS stack, **HACL\***) push proof obligations to an SMT solver, trading some expressiveness and some TCB (now including the SMT solver) for *far* lower proof effort. This is the bridge to [04 — Property & Contract Verification](../04-property-and-contract-verification/senior.md): SMT-backed verification is the same idea with the proof burden largely automated.

---

## Mental Models

- **The kernel is the only judge; everyone else is a lawyer.** Tactics, hammers, and AI assistants *argue* — they construct candidate proof terms. The kernel *rules* — it re-checks every term. This single separation is why you can trust the output of untrusted, heuristic automation.

- **A type is a proposition; a program is its proof; running the checker is verifying the proof.** Curry–Howard isn't a metaphor here — it's the implementation. "Does this program type-check?" and "is this theorem proven?" are literally the same question.

- **"Proved correct" is a sentence with three silent clauses:** *…relative to this specification, …assuming these axioms, …trusting this kernel and toolchain.* A senior never drops the clauses. Most disagreements about "but it's verified!" are really disagreements about an unstated spec or TCB.

- **Definitional equality is what the machine knows for free; propositional equality is what you have to teach it.** The entire difficulty of dependent proving is the gap between the two — `0 + n` is free, `n + 0` is work.

- **Verification cost scales with the gap between the code and the spec, not the size of the code.** 10k lines of subtle kernel C cost 20 person-years; 100k lines of straightforward CRUD would cost less to verify and be pointless to. You verify where a bug is catastrophic and the property is hard to test, which is exactly topic 06's calculus.

---

## Common Mistakes

1. **Hearing "machine-checked" as "certain."** It means "certain *relative to the spec, the axioms, and the kernel/hardware.*" Run `Print Assumptions` and read the spec before you claim a result; a vacuous or wrong spec produces a true-but-worthless `Qed`.

2. **Trusting tactics for soundness.** Tactics are untrusted by design — a buggy tactic produces a term the kernel rejects, not a false theorem. Conversely, don't *distrust* aggressive automation on soundness grounds; distrust it on *brittleness* grounds.

3. **Putting data in `Prop` (or proofs you need to compute with in `Type`).** `Prop` is erased and proof-irrelevant; if you needed the witness at runtime, it's gone. Choose the sort by whether the thing has computational content.

4. **Writing brittle, name-dependent tactic scripts.** Relying on auto-generated hypothesis names (`H`, `H0`) guarantees breakage on the next refactor. Name what you introduce; factor lemmas; lean on structured proof languages (Isar) and custom tactics.

5. **Forgetting that the spec and the extractor are in the TCB.** A perfect proof against the wrong spec, or extracted through a buggy extractor onto an unverified runtime, is not end-to-end correct. CakeML/CompCert exist to shrink exactly these gaps — know which gaps your project leaves open.

6. **Fighting the totality/positivity checker instead of understanding it.** A rejected recursion or a rejected inductive type is usually the checker defending soundness. Restructure to structural recursion or supply a well-foundedness proof; do *not* reach for `Admitted`/`{-# TERMINATING #-}` to "make it compile" — that punches a hole to `False`.

7. **Reaching for a full proof assistant when an SMT-backed tool would do.** If Liquid Haskell, F\*, or an SMT contract verifier can discharge your obligations automatically, the order-of-magnitude lower proof effort is usually worth the slightly larger TCB. Reserve CIC/HOL for the cases that genuinely need its expressiveness.

---

## Test Yourself

1. Why is `Type : Type` inconsistent, and what mechanism do CIC/MLTT use instead? What problem does universe *polymorphism* then solve on top of that?
2. A colleague says "we machine-checked it, so it's correct." State the three silent caveats that claim carries, and name the command that reveals which axioms a Coq proof depends on.
3. Explain why proving `n + 0 = n` needs induction while `0 + n = n` does not. Use the words *definitional* and *propositional* equality.
4. Tactics can be buggy or AI-generated. Why does that not threaten soundness? What part of the system makes this safe?
5. You define `Inductive Bad := mk : (Bad -> Bad) -> Bad.` and Coq rejects it. What condition is violated, and what disaster does the rejection prevent?
6. What is erased during extraction, and why does that make verified code as fast as unverified code? What two things does extraction *add* to your trusted computing base?
7. seL4 is ~10k lines of C and ~200k lines of proof at ~20 person-years. CompCert is ~100k lines of Coq. Why are these ratios acceptable for these projects but absurd for a typical web service?

<details>
<summary>Answers</summary>

1. `Type : Type` lets you encode Girard's paradox (a type-theoretic Russell's paradox) and prove `False`, collapsing the logic. CIC/MLTT use a **stratified universe hierarchy** (`Type₀ : Type₁ : …`, nothing is its own type). **Universe polymorphism** then lets one definition (e.g., `list`, `id`) be parameterized over universe levels so it works at every level without duplication — solving the rigidity/duplication that fixed-level definitions would impose.

2. The caveats: it's correct **(a) relative to the specification you wrote**, **(b) assuming the axioms you added** (classical logic, funext, choice, proof irrelevance), and **(c) trusting the kernel's implementation, its compiler, and the hardware**. `Print Assumptions <thm>` lists the axioms a given proof depends on ("Closed under the global context" = none).

3. `+` is defined by recursion on its *first* argument, so `0 + n` reduces to `n` by computation — the kernel settles it as a **definitional** equality (`reflexivity` closes it). `n + 0` cannot reduce (the recursion is stuck on the variable `n`), so the equality is only **propositional** — true but requiring an induction on `n` to prove.

4. A tactic merely *constructs a proof term*; the **kernel re-type-checks that term independently**. A buggy/AI tactic that builds an ill-typed (false) term produces something the kernel **rejects** — it cannot certify a false theorem. The small, trusted kernel (de Bruijn criterion) is what makes untrusted automation safe.

5. The **positivity condition** is violated: `Bad` occurs to the *left* of an arrow (a negative occurrence) in `mk`'s argument. Allowing it would let you encode the untyped λ-calculus, write a non-terminating term, and thereby **prove `False`** — destroying consistency. The rejection keeps the auto-generated recursor well-founded.

6. Everything in **`Prop` is erased** — all safety/correctness proofs vanish, leaving only the `Type`-level algorithm, so the extracted code carries zero proof overhead and runs as fast as hand-written code. Extraction *adds* to the TCB: **(a) the extraction mechanism** (largely unverified CIC→OCaml translation) and **(b) the target toolchain/runtime** (the OCaml/Haskell compiler and GC) plus the spec↔code gap. (CakeML eliminates much of (a)/(b) by verifying down to machine code.)

7. The cost of verification scales with the **gap between code and spec and the cost of a bug**, not raw line count. An OS kernel and a C compiler are tiny, security/safety-critical, brutally hard to test exhaustively, and sit beneath *everything* — a single miscompilation or kernel bug is catastrophic and affects all software above. A typical web service has cheap bugs (ship a fix), an unstable spec (requirements churn weekly), and effective lighter assurance (tests, types, monitoring), so a 20:1 proof-to-code ratio buys almost nothing. This is precisely the [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/senior.md) decision.

</details>

---

## Cheat Sheet

```
FOUNDATIONS
  Isabelle/HOL   higher-order logic, NOT dependent, classical, heavy automation (seL4)
  Coq / Rocq     CIC, dependent, constructive, tactics + extraction (CompCert, Fiat-Crypto)
  Agda / Lean    MLTT, dependent, constructive; Lean's mathlib, metaprogrammed tactics

UNIVERSES
  Type:Type is INCONSISTENT (Girard's paradox) → stratify  Type0:Type1:Type2:...
  universe polymorphism = one def usable at every level (no duplication)

SORTS
  Type/Set   data, computational content, survives extraction
  Prop       propositions, proof-irrelevant, ERASED at extraction, impredicative (Coq)

EQUALITY
  definitional (≡)   kernel decides by reduction; free; closes 2+2=4
  propositional (=)  inductive eq, refl is its only ctor; must be proven; needs rewrite
  UIP/axiom K vs univalence/HoTT — incompatible foundations; pick one

TOTALITY (soundness depends on it)
  structural recursion | well-founded recursion (measure + proof) | positivity condition
  non-termination ⇒ proof of False ⇒ logic worthless

TRUST (the de Bruijn criterion)
  kernel = small, audited, the ONLY judge        tactics/hammers = untrusted (kernel re-checks)
  TCB = kernel + its compiler + hardware + AXIOMS you add + the SPEC (+ extractor + runtime)
  Print Assumptions <thm>   ← see which axioms a proof depends on

DEPENDENT TYPES IN ANGER
  Vec A n / Fin n        length-/range-indexed: out-of-bounds rejected at type-check
  well-typed interp      Expr : Ty -> Type ⇒ eval total & type-preserving by construction
  boolean blindness      return evidence ({P}+{~P}) not a bare bool

EXTRACTION / VERIFIED ARTIFACTS
  Coq → OCaml/Haskell/Scheme (Prop erased)   Lean/Agda compile directly
  CompCert (C compiler, no miscompilation) | Fiat-Crypto (→C in BoringSSL) | CakeML (→ machine code)
```

---

## Summary

- The three live foundations — **HOL** (Isabelle, not dependent, classical, automated), **CIC** (Coq/Rocq), and **MLTT** (Agda/Lean) — differ in how much they put in the types; dependent types buy "correct by construction" at the cost of undecidable inference and subtle checking.
- `Type : Type` is **inconsistent**; stratified **universes** (plus **universe polymorphism**) keep the logic sound. The `Prop`/`Type` split separates erasable, proof-irrelevant *propositions* from runtime *data* — which is why verified code is as fast as unverified code.
- **Inductive types** generate their own induction principle (the eliminator); real proofs routinely require **generalizing the goal** first. **Equality** is two things — free *definitional* and effortful *propositional* — and whether identity proofs are unique (**UIP**) or structured (**univalence/HoTT**) is a foundational choice.
- **Totality** (structural/well-founded recursion + the **positivity condition**) is load-bearing for consistency: non-termination would prove `False`.
- The **de Bruijn criterion** is the whole trust story: a tiny **kernel** is the only judge, **tactics are untrusted**, and your real **TCB** is kernel + compiler + hardware + the **axioms you add** + the **specification** (+ extractor and runtime for extracted code). "Proved correct" always means "relative to that spec and TCB."
- Proofs are **software that must be maintained** — brittle under change, demanding naming discipline, custom automation (Ltac2/Lean meta/Isar), hammers, and CI. **Extraction** and projects like **CompCert** (~100k LoC Coq, no miscompilation), **seL4** (~10k LoC C / ~200k LoC proof / ~20 person-years), and **Fiat-Crypto** (verified crypto in BoringSSL) show both the power and the price.

You now understand the type theory, the kernel, and the honest cost. The next layer — [professional.md](professional.md) — is about choosing a tool, scoping a verified core, and running a proof corpus across a team and a release cycle.

---

## Further Reading

- *Software Foundations* — Benjamin Pierce et al. The standard hands-on introduction to Coq, logic, and programming-language semantics, built as machine-checked Coq itself.
- *Certified Programming with Dependent Types* (CPDT) — Adam Chlipala. The senior text on dependently-typed *proof engineering* and serious tactic automation in Coq.
- *Homotopy Type Theory: Univalent Foundations of Mathematics* (the "HoTT Book") — the Univalent Foundations Program. The accurate source on identity types, univalence, and why UIP is not forced.
- *Formal verification of a realistic compiler* — Xavier Leroy (CompCert). The paper on what the "no miscompilation" theorem covers and what it assumes.
- *seL4: Formal Verification of an OS Kernel* — Klein et al. The canonical case study in full functional correctness of systems code, with the cost and assumptions stated.
- *Type Theory and Formal Proof* — Nederpelt & Geuvers, and the Coq/Lean/Isabelle reference manuals for the kernel, universes, and tactic languages.

---

## Related Topics

- [01 — Formal Specification](../01-formal-specification/senior.md) — the spec is part of your TCB; a proof is only as meaningful as what it proves against.
- [04 — Property & Contract Verification](../04-property-and-contract-verification/senior.md) — SMT-backed verification: the same idea with the proof burden automated (Liquid Haskell, F\*).
- [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/senior.md) — the cost/benefit calculus that decides when a proof-to-code ratio like seL4's is justified.
- [02 — Model Checking](../02-model-checking/senior.md) — the push-button complement: automatic state-space search where proof assistants demand manual construction.
- [Testing](../../testing/) — the assurance most software actually relies on, and what verification replaces only at the highest-assurance core.
