# Proof Assistants & Dependent Types — Middle Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → Proof Assistants & Dependent Types
> *The junior page promised that a proof can be machine-checked. This page shows the machinery that makes that promise real: a proof is a program, a proposition is its type, and checking the proof is just type-checking — so the only thing you have to trust is a tiny kernel that even a buggy tactic cannot fool.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Curry–Howard Correspondence](#core-concept-1--the-curryhoward-correspondence)
5. [Core Concept 2 — Dependent Types: Types That Depend on Values](#core-concept-2--dependent-types-types-that-depend-on-values)
6. [Core Concept 3 — Constructive Logic and Why Excluded Middle Is Optional](#core-concept-3--constructive-logic-and-why-excluded-middle-is-optional)
7. [Core Concept 4 — Tactics vs Term Mode: How You Actually Write a Proof](#core-concept-4--tactics-vs-term-mode-how-you-actually-write-a-proof)
8. [Core Concept 5 — Automation: What the Machine Closes and What You Must](#core-concept-5--automation-what-the-machine-closes-and-what-you-must)
9. [Core Concept 6 — The Trusted Computing Base and the de Bruijn Criterion](#core-concept-6--the-trusted-computing-base-and-the-de-bruijn-criterion)
10. [Core Concept 7 — The Tools and Their Flavors](#core-concept-7--the-tools-and-their-flavors)
11. [Real-World Examples](#real-world-examples)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Why is a proof the same thing as a program, and how do I write and trust one?**

At the junior level you learned the slogan — a proof assistant lets you state a theorem and have a computer confirm the proof leaves no gaps. That model is correct but it leaves the central mystery untouched: *how* does a computer check a mathematical proof at all? Mathematicians use intuition, diagrams, "clearly," and "without loss of generality." None of that is mechanically checkable.

The resolution is one of the deepest ideas in computer science: the **Curry–Howard correspondence**. A proposition is a *type*. A proof of that proposition is a *term* (a program) of that type. Checking the proof is *type-checking* the term — a decidable, mechanical procedure. "Theorem proving" and "writing a well-typed program" are literally the same activity viewed through two vocabularies.

This page makes that concrete. We will write real (small) proofs in Coq and Lean, see how **dependent types** let a function's *signature* forbid calling `head` on an empty list, separate the **tactics** you type from the **proof term** they build, and pin down exactly what you have to trust — a few thousand lines of **kernel**, not the millions of lines of tactics and libraries on top. Then we look at what this machinery has actually achieved: a verified C compiler, a verified OS kernel, and crypto code shipping in your browser right now.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can state, informally, what a proof assistant does.
- **Required:** Comfort with a typed functional language (types, functions, pattern matching, recursion). Haskell, OCaml, or even TypeScript generics are enough.
- **Helpful:** You've seen the basic logical connectives (∧, ∨, →, ¬, ∀, ∃) and induction over the natural numbers.
- **Helpful:** A rough sense of [Formal Specification](../01-formal-specification/middle.md) — a proof assistant is where the hardest specs get *proven*, not just stated.

---

## Glossary

| Term | One-line definition |
|---|---|
| **Term** | A program/expression; under Curry–Howard, also a *proof*. |
| **Type** | A classification of terms; under Curry–Howard, also a *proposition*. |
| **Inhabitant** | A term *of* a given type; a proof of the corresponding proposition. |
| **Dependent type** | A type that mentions a *value* (e.g. `Vec A n` — vectors of length `n`). |
| **Π-type (Pi)** | Dependent *function* type; the type of `∀`. |
| **Σ-type (Sigma)** | Dependent *pair* type; the type of `∃`. |
| **Tactic** | A command (`intro`, `induction`, `rewrite`…) that transforms a proof goal. |
| **Goal** | The proposition currently to be proved, plus the hypotheses in scope. |
| **Kernel** | The small, trusted type-checker that certifies finished proof terms. |
| **TCB** | Trusted Computing Base — the code whose correctness you must assume. |
| **Decision procedure** | An algorithm that *always* settles a class of goals (e.g. linear arithmetic). |
| **Hammer** | A tactic that fires the goal at external automated provers (SMT/ATP). |

---

## Core Concept 1 — The Curry–Howard Correspondence

Logic and typed programming are not analogous — they are *the same structure* with two names for every part. This is the Curry–Howard correspondence (also "propositions as types"), and it is the engine under every proof assistant.

| Logic | Type theory | Read as |
|---|---|---|
| proposition `P` | type `P` | "the set of proofs of `P`" |
| proof of `P` | term `t : P` | "`t` witnesses `P`" |
| `P → Q` (implies) | function type `P → Q` | a proof of `P` *transformed into* a proof of `Q` |
| `P ∧ Q` (and) | product / pair `P × Q` | a proof of `P` *and* a proof of `Q` |
| `P ∨ Q` (or) | sum / `Either P Q` | a proof of `P` *or* a proof of `Q`, tagged with which |
| `∀x. P x` | dependent function `Π(x:A). P x` | a *function* yielding a proof for every `x` |
| `∃x. P x` | dependent pair `Σ(x:A). P x` | a witness `x` *paired with* a proof of `P x` |
| `True` | unit type (one inhabitant) | trivially provable |
| `False` | empty type (no inhabitants) | unprovable; from it, anything |
| proof-checking | type-checking | the *decidable* mechanical step |

Read the table as a dictionary. To prove an *implication* `P → Q`, you write a *function* that takes a proof of `P` and returns a proof of `Q`. To prove a *conjunction*, you build a *pair*. To prove `False`, you would need an inhabitant of the empty type — there are none, which is exactly why falsehood is unprovable.

> **Key insight:** "To prove `P`, construct a term of type `P`." Proving is programming. The proposition is the *spec*, the proof is the *implementation*, and the type-checker is the *test that cannot be faked* — it accepts the term only if it genuinely inhabits the type, i.e. only if the proof is complete and correct.

The payoff is profound: proof-checking inherits the properties of type-checking. It is **mechanical**, **decidable** (for the type systems these tools use), and **local** — to certify the whole proof the checker only re-verifies that each term has the type it claims. Mathematical rigor becomes a `typecheck` command.

---

## Core Concept 2 — Dependent Types: Types That Depend on Values

In an ordinary language, types and values live in separate worlds: `List A` is a type, `[1,2,3]` is a value, and the type cannot mention how *long* the list is. A **dependent type** demolishes that wall — a type may be *indexed by a value*.

The canonical example is the length-indexed vector. `Vec A n` is the type of vectors holding exactly `n` elements of `A`; the natural number `n` is *part of the type*.

```agda
data Vec (A : Set) : Nat → Set where
  []   : Vec A zero
  _::_ : {n : Nat} → A → Vec A n → Vec A (suc n)
```

Now watch what the *signature* of `head` can promise:

```agda
head : {A : Set} {n : Nat} → Vec A (suc n) → A
head (x :: xs) = x
```

The argument type is `Vec A (suc n)` — a vector whose length is the *successor* of something, i.e. *provably non-empty*. There is no `[]` case to write, and the type-checker will not let you *call* `head` on an empty vector, because `[]` has type `Vec A zero`, which does not match `Vec A (suc n)`. The classic runtime crash — `head` of an empty list — is now a **compile-time type error**. The illegal state is *unrepresentable*.

Other workhorse dependent types:

- **`Fin n`** — the type of natural numbers *strictly less than `n`*. Use it as an array index and out-of-bounds access becomes ill-typed: an index into `Vec A n` must be a `Fin n`, so it provably cannot run off the end.
- **The equality type `a = b`** — yes, *equality itself is a type*. Its only inhabitant (`refl`) exists exactly when `a` and `b` are the same. A *proof* that two values are equal is a *term* of type `a = b`. This is what makes `rewrite` possible: rewriting is "apply an equality proof to transform a goal."

> **Key insight:** Dependent types let you encode invariants *in the signature*, where the type-checker enforces them on every call site for free. "Balanced tree," "sorted list," "matrix of conforming dimensions," "state-machine in a legal state" stop being comments and runtime checks and become *part of the type*. If it type-checks, the invariant holds — there is no path around it.

**The trade-off** (full detail in [senior.md](senior.md)): expressiveness has a price. When types contain values, type-checking must *evaluate* and *compare* those values, so type inference gets harder and full inference becomes undecidable in general. You write more type annotations, sometimes carry around equality proofs explicitly, and occasionally fight the checker to convince it two expressions are equal. The expressiveness that makes illegal states unrepresentable is the same expressiveness that makes the checker need your help.

---

## Core Concept 3 — Constructive Logic and Why Excluded Middle Is Optional

There is a quiet consequence of "proofs are programs." If a proof of `∃x. P x` is a *pair* `(x, proof)`, then **every existence proof carries an actual witness** — you can run it and *extract the `x`*. Likewise a proof of `P ∨ Q` tells you *which* disjunct holds, because it is a tagged value. This is **constructive** (or **intuitionistic**) logic: to prove something exists, you must *build* it.

Classical logic is looser. It accepts the **law of excluded middle** (`P ∨ ¬P` for *every* `P`) and proof by contradiction even when neither disjunct can be exhibited. "There exists an `x` with property `P`, because assuming none leads to absurdity" is a valid *classical* proof that hands you *no `x`*. Constructively, that is not a complete proof — there is no term to return.

Proof assistants are constructive *by default* (their core type theories are), but excluded middle is not *false* there — it is simply *not assumed*. You can **add it as an axiom** when you want classical reasoning:

```coq
(* Coq: excluded middle is available, but you opt in *)
Require Import Classical.
(* now `classic : forall P:Prop, P \/ ~P` is in scope *)
```

The cost of opting in is honest and visible: a proof that uses `classic` is marked as depending on that axiom (Coq's `Print Assumptions` will tell you), and such a proof generally *cannot* be run to extract a witness. Most large developments stay constructive where they can — partly for the extractable-program payoff, partly because fewer axioms means a smaller thing to trust.

> **Key insight:** In a proof assistant, classical axioms are *opt-in dependencies*, not free ambient truths. Constructive proofs double as executable programs (an existence proof *is* an algorithm that produces the witness); classical proofs trade that away for convenience. The system makes the choice explicit and auditable.

---

## Core Concept 4 — Tactics vs Term Mode: How You Actually Write a Proof

By Curry–Howard, a proof *is* a term, so in principle you could write proofs by typing out terms directly — **term mode**:

```coq
(* Term mode: the proof of (P -> P) is just the identity function *)
Definition trivial : forall P : Prop, P -> P :=
  fun P (p : P) => p.
```

That is elegant for tiny proofs and unbearable for real ones — the terms for serious theorems are enormous. So proof assistants give you an **interactive tactic mode**: instead of writing the term, you *manipulate the goal* with **tactics**, and the system *constructs the term for you* behind the scenes.

A **goal** is the proposition you currently owe, shown with the hypotheses in scope. Each tactic is a goal transformer:

| Tactic (Coq / Lean) | What it does to the goal |
|---|---|
| `intro` / `intros` | move a `∀`-bound variable or the hypothesis of a `→` into context |
| `apply f` | reduce goal `Q` to the premises of a known `f : P → Q` |
| `induction n` | split into base case + inductive case (with an induction hypothesis) |
| `rewrite H` | use an equality `H : a = b` to replace `a` with `b` in the goal |
| `simpl` / `simp` | simplify by computation / by a set of rewrite lemmas |
| `reflexivity` / `rfl` | close a goal of the form `x = x` |
| `auto` / `lia` / `omega` | automatically discharge the goal (general / linear arithmetic) |

Here is a **real, complete** proof: `0 + n = n` in Coq, where `+` is defined by recursion on its *first* argument so this is true *by computation*:

```coq
Theorem zero_plus_n : forall n : nat, 0 + n = n.
Proof.
  intro n.        (* goal: 0 + n = n, with n : nat in context        *)
  simpl.          (* 0 + n computes to n, so goal becomes: n = n     *)
  reflexivity.    (* x = x closes the goal                           *)
Qed.
```

Now a proof that genuinely needs **induction**, because the recursion is on the *wrong* side. `app_nil_r` says appending the empty list on the *right* leaves a list unchanged — `l ++ [] = l`:

```coq
Theorem app_nil_r : forall (A : Type) (l : list A), l ++ [] = l.
Proof.
  intros A l.
  induction l as [| x xs IH].   (* split: l is [] or x :: xs          *)
  - simpl. reflexivity.         (* base:  [] ++ [] = []   (computes)   *)
  - simpl. rewrite IH.          (* step:  x :: (xs ++ []) ; IH: xs++[]=xs *)
    reflexivity.                (*        becomes x :: xs = x :: xs    *)
Qed.
```

The same theorem in **Lean 4**, to show the family resemblance:

```lean
theorem app_nil_r (l : List α) : l ++ [] = l := by
  induction l with
  | nil        => rfl                  -- [] ++ [] = []  by computation
  | cons x xs ih => simp [ih]          -- rewrite with the IH, then close
```

Read the `app_nil_r` proof slowly, because it is the shape of *almost every* inductive proof you will ever write. `induction l` produces two goals. The base case (`[]`) is true by computation. The step case gets an **induction hypothesis** `IH : xs ++ [] = xs` for the smaller list, and the whole game is to massage the goal until that hypothesis applies. `simpl` exposes the recursive structure, `rewrite IH` plugs in what we already know, and `reflexivity` finishes.

> **Key insight:** Tactics are a *human-friendly front-end that builds the proof term*. You think in goal transformations; the system records the corresponding term and hands it to the kernel. Crucially, *the tactics are not trusted* — only the term they produce is checked (Core Concept 6). This separation is what lets proof assistants offer powerful, heuristic, possibly-buggy automation **without** ever risking soundness.

---

## Core Concept 5 — Automation: What the Machine Closes and What You Must

A common misconception is that a proof assistant proves theorems *for* you. It does not — it *checks* your proof, and *assists* with the boring parts. The dividing line is sharp and worth internalizing.

**The machine is excellent at decidable, "grind-it-out" goals:**

- **Decision procedures.** `lia` / `omega` settle goals in *linear integer arithmetic* (`3*x + 1 <= 5*x → x >= ...`) completely and automatically — the problem is decidable, so the tactic *always* succeeds or fails definitively. Similar procedures exist for other decidable fragments.
- **Simplification sets.** `simp` (Lean/Isabelle) repeatedly applies a curated set of rewrite lemmas until the goal stops changing — great for normalizing algebraic and definitional clutter.
- **Hammers.** `sledgehammer` (Isabelle) and `CoqHammer` (Coq) fire the goal, plus thousands of library lemmas, at external **automated theorem provers** and **SMT solvers**, then *reconstruct* any proof they find inside the kernel. They routinely close goals you'd spend ten minutes on by hand — and when they fail, they fail cheaply.

**The machine is helpless at the parts that need a mathematical idea:**

- **Choosing the induction.** Which variable, and in what order? The wrong choice gives an induction hypothesis too weak to use.
- **Generalizing the goal.** Very often a theorem is *not* directly provable by induction, but a *stronger, more general* statement *is* (and then implies the original). Finding that generalization — strengthening the induction hypothesis — is the quintessential human move.
- **Inventing the key lemma / loop invariant / measure.** The structural insight that makes the rest fall out.

> **Key insight:** Automation collapses the *mechanical* distance between your insight and a finished proof; it does not supply the insight. A 5-line Lean proof can hide an hour of thought spent finding the *right generalization* — and then `simp` and `lia` close everything that remains in seconds. Knowing *what* to prove is the engineer's job; *grinding it out* is increasingly the machine's.

---

## Core Concept 6 — The Trusted Computing Base and the de Bruijn Criterion

Here is the property that makes proof assistants worth believing. A proof assistant is a big program — tactics, parsers, elaborators, libraries, an IDE — and big programs have bugs. So *why trust the result*?

Because of an architectural commitment called the **de Bruijn criterion**: the system is split into a vast, *untrusted* outer layer (everything that *finds* and *manipulates* proofs) and a tiny, *trusted* inner layer — the **kernel** — whose only job is to *check* that a finished proof term genuinely has the type it claims. Every proof, no matter how it was produced, must pass the kernel.

```
  YOU + tactics + automation + hammers + libraries   ← LARGE, UNTRUSTED
        |  emit a candidate proof term
        v
  ┌──────────────────────────┐
  │   KERNEL (type-checker)   │  ← SMALL, TRUSTED (the entire TCB for proofs)
  └──────────────────────────┘
        |  accepts only genuinely well-typed terms
        v
   "Theorem certified"
```

The consequences are exactly what you want:

- **A buggy tactic cannot prove a false theorem.** Suppose `auto` has a bug and "proves" something false. It can only do that by emitting a *term*, and that term must type-check against the false proposition's type. A false proposition's type is *empty* — there is no inhabitant — so the kernel rejects the term. The worst a broken tactic can do is *fail* or *produce a term the kernel refuses*. Soundness survives.
- **You audit a few thousand lines, not a few million.** The Coq/Lean kernels are small enough to be studied, re-implemented, and cross-checked. Everything else can be as clever, fast, and bug-ridden as it likes.
- **You can replay the certificate elsewhere.** Independent checkers exist precisely because the proof term is a self-contained object that any conforming kernel can re-verify.

> **Key insight:** Trust does not scale with the *size* of the system; it concentrates in the **kernel**. The de Bruijn criterion is why a million-line proof development rests on a *few-thousand-line* trusted base. When evaluating *any* verification claim, the first question a senior engineer asks is: *what exactly is in the TCB?* (Here: the kernel, plus a few axioms, plus the compiler/hardware running them — see [senior.md](senior.md).)

---

## Core Concept 7 — The Tools and Their Flavors

The major systems share the Curry–Howard core but differ sharply in logic, automation style, and ergonomics. Pick by the job.

| Tool | Logic / foundation | Style | Notable for |
|---|---|---|---|
| **Coq / Rocq** | Calculus of Inductive Constructions (dependent) | Tactic-based (Ltac); terms in Gallina | CompCert, Four Color Theorem, Fiat-Crypto |
| **Isabelle/HOL** | Higher-order logic (simpler than full dependent) | Tactics + structured **Isar** proofs | *Sledgehammer* automation; seL4 |
| **Lean 4** | Dependent type theory (CIC-like) | Tactic + term; **real programming language** | `mathlib`; modern tooling; teaching |
| **Agda** | Dependent type theory (Martin-Löf) | *Term mode*, dependently-typed programming | Programs-as-proofs; little tactic use |
| **F\*** | Dependent types + effects + SMT | Verification-oriented; heavy SMT | Verified systems/crypto (Project Everest) |
| **ACL2** | First-order, total recursive functions | Highly *automated* | Industrial HW/SW; used at **AMD** |

A few orienting contrasts:

- **Coq/Rocq vs Agda — tactics vs terms.** Coq leans on interactive *tactic scripts* (`intro`, `induction`, `rewrite`) and is the classic choice for verified systems software. Agda makes you write the *proof term* almost like ordinary dependently-typed code; many people find it the clearest window into "proofs *are* programs."
- **Isabelle/HOL — automation and readability.** Its logic is plain higher-order logic (no full dependent types), which buys *enormous* automation: `sledgehammer` is the gold standard, and **Isar** lets you write proofs that read like prose. seL4 was verified here.
- **Lean 4 — proof assistant *and* language.** Lean is a genuine, efficiently-compiled programming language *and* a proof assistant, with the fast-growing `mathlib` formalizing a huge swath of mathematics. It has become a default recommendation for newcomers.
- **F\* and ACL2 — automation-forward.** F\* pushes obligations to an SMT solver (Z3) and targets *verified systems and cryptography* at scale. ACL2 is first-order and aggressively automated, with a long industrial track record in hardware verification.

> **Key insight:** There is no single "best" tool — there is a frontier. More dependent types (Coq, Agda, Lean) buy *expressiveness*; simpler logic (Isabelle/HOL, ACL2) buys *automation*. SMT-backed tools (F\*) buy *throughput* on decidable obligations at the cost of a larger TCB (you now trust the SMT integration). Choose for the proof obligations you actually have.

---

## Real-World Examples

These are not toy results — they are the reason this field matters, and each one is a *machine-checked* artifact, not a paper proof.

- **CompCert** — a C compiler *proven in Coq* to preserve the semantics of the source program: the compiled assembly behaves exactly as the C standard says the source should. The famous Csmith study that found bugs in every other tested C compiler found *zero* miscompilation bugs in CompCert's verified core. A verified compiler closes the gap between "my verified source" and "the binary that actually runs."
- **seL4** — a general-purpose OS *microkernel* whose C implementation was *proven in Isabelle/HOL* to satisfy its specification, with no buffer overflows, no null-dereferences, and (further proofs) integrity and confidentiality guarantees. The first such result for a real, deployable kernel.
- **Fiat-Crypto** — verified field-arithmetic code, generated and *proven correct in Coq*, that **ships in BoringSSL and therefore in Chrome and Android**. The elliptic-curve arithmetic protecting a large fraction of internet traffic is machine-verified. This is formal methods in your pocket *right now*.
- **CakeML** — a verified compiler for an ML-family language, proven down to machine code, with a verified runtime — a verified toolchain you can build verified programs *on*.
- **The Four Color Theorem** (Gonthier, in Coq) and the **Feit–Thompson odd-order theorem** (Gonthier et al., a 6-year Coq formalization) — landmark *mathematics* whose proofs were too large or too case-heavy for confident human checking, now machine-certified end to end.
- **The Kepler Conjecture / Flyspeck** (Hales et al.) — the optimal-sphere-packing proof, originally so computational that referees could not fully verify it, *completely formalized* in HOL Light and Isabelle. Formal proof rescued a result the traditional process *could not finish refereeing*.

The common thread: each of these is a domain where a subtle error is *catastrophic* (a compiler bug poisons every program; a kernel bug breaks every guarantee above it; a crypto bug breaks secrecy) or where the proof is simply *too big for humans to check by hand*. That is exactly where the cost of formal proof pays off — see [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/middle.md).

---

## Mental Models

- **A proof is a program; its proposition is the program's type.** Stop thinking "prove the theorem" and start thinking "write a value of this type." The type-checker is the grader, and it cannot be bluffed.

- **A type is a set; a proof is an element of it.** `True` is a one-element set (trivially inhabited). `False` is the *empty* set (no element exists, so it's unprovable). `P → Q` is the set of functions from `P`'s proofs to `Q`'s proofs. Existence (`∃`) is a *pair*: a witness plus a proof about it.

- **Tactics are a recipe; the proof term is the cake.** You type the recipe (`intro`, `induction`, `rewrite`); the system bakes the term. Only the *cake* gets inspected by the kernel — a sloppy recipe that somehow yields a bad cake is simply rejected.

- **The kernel is a customs officer who only checks passports, not stories.** It does not care *how* you arrived at the proof (which clever tactic, which hammer). It checks one thing: does this term *actually* have the type it claims? No valid passport, no entry — and a false theorem has no valid passport to issue.

- **Dependent types move invariants from comments to compiler errors.** "This list is non-empty" / "this index is in bounds" / "these matrices conform" stop being hopes you test for and become facts the type-checker enforces at every call.

---

## Common Mistakes

1. **Believing the tool "proves theorems for you."** It *checks* your proof and *automates the tedium*. The induction, the generalization, the key lemma — those are yours. Expecting `auto`/`simp` to find the mathematical idea leads only to frustration.

2. **Trusting the tactics instead of the kernel.** Newcomers worry "what if `lia` has a bug?" The answer: it cannot prove a falsehood, because its output term must pass the kernel. Trust is in the *kernel*, not the tactic library — internalize the de Bruijn criterion and this anxiety dissolves.

3. **Trying to prove the un-generalized statement by induction.** A theorem frequently needs a *stronger* induction hypothesis than the goal provides. If `induction` leaves you stuck with a too-weak hypothesis, the fix is usually to *generalize* the goal first, not to find a cleverer tactic.

4. **Confusing `Prop` and `Type` / proof-irrelevance.** In Coq, propositions (`Prop`) are often *proof-irrelevant* (all proofs of a `Prop` are interchangeable and *erased* from extracted code), while data (`Type`) is not. Mixing them up — e.g. trying to *compute with* a `Prop`-level proof — produces confusing errors.

5. **Adding classical axioms reflexively.** Reaching for `classic` (excluded middle) to "just get unstuck" enlarges your assumptions and forfeits witness extraction. Stay constructive when you can; opt into classical reasoning deliberately, and check `Print Assumptions` before you ship a result.

6. **Underestimating the cost — or overestimating where it applies.** These proofs are expensive (the senior page quantifies it). Verifying a CRUD endpoint is almost never worth it; verifying a compiler, a kernel, or crypto primitives can be. Matching the technique to the stakes is the whole game ([06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/middle.md)).

---

## Test Yourself

1. Under Curry–Howard, what *is* a proof of an implication `P → Q`? What is a proof of a conjunction `P ∧ Q`?
2. Why is `False` unprovable in terms of *types*? What does that have to do with the kernel rejecting buggy tactics?
3. What does the type of `head : Vec A (suc n) → A` guarantee that an ordinary `head : List A → A` cannot, and *when* is that guarantee enforced?
4. You wrote a tactic script with `induction`, `simpl`, `rewrite`, `reflexivity`. What artifact does that script actually *produce*, and which part of the system *trusts* it?
5. A colleague says "we use a hammer that calls an SMT solver, so we're trusting Z3." Are they right? What is and isn't in the TCB here?
6. Give an example of something automation (`lia`, `simp`, `sledgehammer`) handles well and something it cannot do for you.
7. Why are constructive existence proofs special compared to classical ones?

<details>
<summary>Answers</summary>

1. A proof of `P → Q` is a **function** that turns any proof of `P` into a proof of `Q`. A proof of `P ∧ Q` is a **pair** containing a proof of `P` and a proof of `Q`.
2. `False` corresponds to the **empty type**, which has *no inhabitants*. Since a proof is a term *of* the type, there is no term to construct — so it's unprovable. A buggy tactic that "proves" a false `P` must still emit a term of type `P`; if `P` is uninhabited, the **kernel** finds no valid term and rejects it. Soundness is preserved.
3. The argument type `Vec A (suc n)` is *provably non-empty* (its length is a successor), so the function *cannot be called* on an empty vector — there is no `Vec A zero` that matches, and there's no `[]` case to handle. The guarantee is enforced at **type-check (compile) time**, at every call site, not as a runtime check.
4. The script produces a **proof term** (a program). The tactics are *untrusted*; only the **kernel** that type-checks the resulting term is trusted.
5. Partly. With an SMT-backed hammer, *what's in the TCB depends on the design*: Isabelle/Coq hammers **reconstruct** the found proof inside the kernel, so Z3 is just an untrusted *oracle* — a Z3 bug only risks a failed reconstruction, not a false theorem. In tools that trust the solver's verdict directly (some F\* usage), the **SMT solver is in the TCB**. Always ask which mode is in use.
6. *Handles well:* linear arithmetic goals (`lia`/`omega`), algebraic simplification (`simp`), closing routine goals against a big lemma library (`sledgehammer`/`CoqHammer`). *Cannot do for you:* choosing the right variable/order for induction, **generalizing** the goal to strengthen the induction hypothesis, and inventing the key lemma or invariant.
7. A constructive proof of `∃x. P x` *is* a pair `(x, proof)` — it **contains the witness**, so it doubles as an algorithm that produces `x`. A classical existence proof (via excluded middle / contradiction) can establish existence while exhibiting **no witness**, and generally cannot be run to extract one.

</details>

---

## Cheat Sheet

```
CURRY–HOWARD DICTIONARY
  proposition  = type            proof        = term (program)
  P -> Q       = function type   P /\ Q       = pair / product
  P \/ Q       = sum / Either    forall x.Px  = Pi (dependent function)
  exists x.Px  = Sigma (pair)    False        = empty type (unprovable)
  proof-check  = TYPE-CHECK      "prove P"    = "build a term of type P"

DEPENDENT TYPES (invariants in the signature)
  Vec A n   vectors of exactly n     head : Vec A (suc n) -> A   (no empty case)
  Fin n     naturals < n             use as index -> no out-of-bounds
  a = b     equality is a TYPE       refl inhabits it -> powers `rewrite`

TACTICS (transform the goal; build the term for you)
  intro/intros   move forall-var / hypothesis into context
  apply f        reduce goal to premises of f
  induction n    base case + step case (+ induction hypothesis)
  rewrite H      use equality H : a = b in the goal
  simpl / simp   simplify by computation / rewrite-set
  reflexivity/rfl close  x = x
  lia / omega    decide linear arithmetic        auto  general search

AUTOMATION
  decision proc  lia/omega       always settle a decidable class
  simp set       normalize via curated rewrite lemmas
  hammer         sledgehammer / CoqHammer -> external ATP/SMT, reconstruct
  human-only     pick the induction, GENERALIZE the goal, invent the lemma

TRUST (de Bruijn criterion)
  untrusted: tactics, automation, hammers, libraries, IDE
  TRUSTED  : the KERNEL (type-checker) + axioms + compiler/HW
  => a buggy tactic CANNOT prove a false theorem (kernel rejects it)

TOOLS
  Coq/Rocq   dependent, tactics      CompCert, 4-color, Fiat-Crypto
  Isabelle   HOL, sledgehammer, Isar seL4
  Lean 4     dependent + real lang   mathlib
  Agda       dependent, term-mode    proofs-as-programs
  F*         dep types + SMT         Project Everest
  ACL2       first-order, automated  AMD hardware

PROVEN: CompCert (C compiler) | seL4 (kernel) | Fiat-Crypto (in Chrome)
        CakeML (ML compiler)  | Four Color & Feit-Thompson | Kepler/Flyspeck
```

---

## Summary

- The **Curry–Howard correspondence** identifies propositions with types and proofs with terms: to prove `P` you *construct a term of type `P`*, and *proof-checking is type-checking* — decidable and mechanical. Implication ↔ function, conjunction ↔ pair, disjunction ↔ sum, `∀` ↔ Π-type, `∃` ↔ Σ-type.
- **Dependent types** let types depend on values (`Vec A n`, `Fin n`, `a = b`), so invariants live *in the signature* and the type-checker forbids illegal states (`head` can't be called on an empty vector). The cost is harder inference and more annotations.
- Proof assistants are **constructive by default** — existence proofs carry witnesses and double as programs — and let you *opt into* classical axioms like excluded middle, visibly and at a price.
- You write proofs as **tactic scripts** (`intro`, `induction`, `rewrite`, `simpl`, `reflexivity`) that transform goals; the system *builds the proof term* for you. Real induction proofs (like `app_nil_r`) hinge on using the induction hypothesis.
- **Automation** (decision procedures like `lia`, simp-sets, hammers like `sledgehammer`/`CoqHammer`) closes the mechanical parts; *humans* still pick the induction, **generalize** the goal, and invent the key lemma.
- Trust concentrates in a tiny **kernel** (the **de Bruijn criterion**): a buggy tactic *cannot* prove a false theorem because its output term must type-check. The TCB is a few thousand lines, not millions.
- The tools trade *expressiveness* for *automation* (Coq/Agda/Lean vs Isabelle/ACL2; F\* pushes SMT). The payoff is real: **CompCert, seL4, Fiat-Crypto (shipping in Chrome), CakeML**, the Four Color and Feit–Thompson theorems, and the Kepler conjecture are all machine-checked.

---

## Further Reading

- *Software Foundations* (Pierce et al.) — the standard, hands-on Coq introduction to Curry–Howard, induction, and proof tactics. Start here if you want to *do* it.
- *Theorem Proving in Lean 4* (Avigad et al.) — the official Lean 4 text; modern, free, and paired with the `mathlib` ecosystem.
- *Certified Programming with Dependent Types* (Adam Chlipala) — dependent types and *proof automation* in Coq, from someone who builds large verified systems.
- *Concrete Semantics* (Nipkow & Klein) — Isabelle/HOL through the lens of programming-language semantics; excellent on structured **Isar** proofs.
- [senior.md](senior.md) — the full **cost** picture, the precise contents of the **TCB** (axioms, extraction, compiler/hardware), proof engineering at scale, and how these results were actually built.

---

## Related Topics

- [01 — Formal Specification](../01-formal-specification/middle.md) — where the specs that proof assistants *prove* are written down precisely.
- [04 — Property & Contract Verification](../04-property-and-contract-verification/middle.md) — lighter-weight ways to check the same kinds of properties without full proof.
- [02 — Model Checking](../02-model-checking/middle.md) — the *automatic* end of formal methods; complements interactive proof for finite-state systems.
- [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/middle.md) — deciding when the cost of proof is justified by the stakes.
- [Testing](../../testing/) — the empirical counterpart: proof shows *absence* of bugs in a model; testing samples *presence* in the real system.
