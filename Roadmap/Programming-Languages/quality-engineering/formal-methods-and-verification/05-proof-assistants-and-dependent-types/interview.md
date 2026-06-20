# Proof Assistants & Dependent Types — Interview Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → Proof Assistants & Dependent Types
> *A proof-assistant interview rarely asks "what is a theorem prover." It asks "your boss read about seL4 and wants everything formally verified — what do you say," and then watches whether you can separate a proof from a test, a spec from the code, and "worth it" from "almost never." This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Introduction](#introduction)
3. [Prerequisites](#prerequisites)
4. [Fundamentals](#fundamentals)
5. [Curry–Howard & Dependent Types](#curryhoward--dependent-types)
6. [How Proofs Work](#how-proofs-work)
7. [Achievements & Cost](#achievements--cost)
8. [Judgement & Scenarios](#judgement--scenarios)
9. [Rapid-Fire](#rapid-fire)
10. [Red Flags / Green Flags](#red-flags--green-flags)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **proof vs test** (true for *all* inputs vs true for the inputs you tried)
- **spec vs code** (you prove the code matches the spec; the spec can still be wrong)
- **automation vs insight** (the machine grinds the algebra; the human supplies the induction)
- **theorem vs trust** (a checked proof is only as trustworthy as the kernel, axioms, and TCB beneath it)
- **"worth it" vs "almost never"** (catastrophic + unrecoverable + small + stable, or skip it)

Nearly every question in this bank is one of those distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a tool name.

---

## Introduction

A **proof assistant** (interactive theorem prover) is a tool where you state a mathematical proposition, build a proof step by step, and a machine **checks** that proof is airtight. The payoff is categorical: where a test says "correct for the 10,000 inputs I ran," a machine-checked proof says "correct for *every* input, forever." That guarantee is also expensive — proof-to-code ratios of 10:1 to 20:1 and person-years of effort are normal — so the entire interview is really about *judgement*: knowing the few places that guarantee is worth the bill, and the many places it is not.

This page spans junior ("what *is* a proof assistant?") to staff ("talk your VP out of verifying the CRUD app"). The connective tissue is **Curry–Howard** — the idea that a proposition *is* a type and a proof *is* a program — because it explains both how dependent types make illegal states unrepresentable and why a non-terminating program would be a *false proof*.

> If you remember one sentence from this page: **a proof tells you the code matches the spec; it does not tell you the spec is right, the axioms are sound, or the trusted base is bug-free.** That caveat is the difference between a junior and a staff answer.

---

## Prerequisites

You will sound much stronger if you are fluent with these before the interview:

- **What a type is**, and the difference between a *value* and the *type* that constrains it.
- **The [01 — Formal Specification](../01-formal-specification/interview.md) distinction**: a spec is *what* correct means; the proof connects code to that spec.
- **Why testing is incomplete** — Dijkstra's "testing shows the presence, never the absence, of bugs." Proof assistants are the tool that targets *absence*.
- **Induction** as a proof technique (the workhorse of every proof over lists, trees, naturals, and program loops).
- A rough sense of the **[02 — Model Checking](../02-model-checking/interview.md)** alternative — exhaustively exploring a finite state space — so you can contrast "push-button, bounded" with "interactive, unbounded."

You do *not* need to have written a Coq or Lean proof to interview well at most levels, but you must be able to read a `Theorem ... Proof ... Qed.` block and say what each part does.

---

## Fundamentals

### Q: What is a proof assistant, and what does it actually buy you over tests?

> **Testing:** The junior baseline — do you understand the "all inputs vs some inputs" leap, or do you think it's "fancy tests"?

**A.** A proof assistant (interactive theorem prover) is a program where you *state a proposition* and *construct a proof* that the tool mechanically **checks** for soundness. The flagship tools are **Coq** (now **Rocq**), **Isabelle/HOL**, **Lean** (Lean 4), and **Agda**.

What it buys you over tests is **universal quantification, machine-checked.** A test asserts a property for the specific inputs you ran — `reverse(reverse(xs)) == xs` for a handful of lists. A proof asserts `∀ xs. reverse(reverse(xs)) == xs` for *every* list of every length, including the ones you'd never think to write. The "machine-checked" part matters because human-written paper proofs have *bugs* — the four-colour theorem and Kepler conjecture both had flawed published proofs that stood for years. A proof assistant won't accept a step that doesn't follow.

The honest caveat, which separates a real answer from marketing: a proof guarantees the **code matches the spec**. It says nothing about whether the spec is the *right* spec.

### Q: Proof vs property-based test vs example test — line them up.

> **Testing:** Whether you can place proof on a spectrum rather than treating it as magic.

**A.** They sit on a ladder of confidence and cost:

| Technique | Covers | Confidence | Cost |
|---|---|---|---|
| **Example test** | The inputs you wrote | The cases you imagined | Minutes |
| **Property-based test** | Hundreds–thousands of *random* inputs | High for sampled space; misses rare cases | Hours |
| **Model checking** | *All* states of a *finite/bounded* model | Total within the bound | Days |
| **Proof assistant** | *All* inputs, unbounded, mathematically | Total (modulo spec + TCB) | Weeks–years |

The key insight is that **property-based testing is the gateway drug to proofs**: you write the *same property* (`∀ xs. sorted(sort(xs))`), but the test *samples* the space while the proof *covers* it. If you can already articulate a property for QuickCheck, you've done the hardest conceptual half of writing the theorem — see [04 — Property & Contract Verification](../04-property-and-contract-verification/interview.md).

### Q: What does "machine-checked" mean, and why is it stronger than "an expert reviewed it"?

> **Testing:** Whether you grasp that the trust shifts from a fallible human to a small checker.

**A.** "Machine-checked" means the final proof is a formal object that a **proof checker** validates against a fixed set of inference rules — every step must be a legal application of a rule, with no gaps and no hand-waving. An expert review trusts the *expert*: a tired reviewer who nods at "the rest is obvious" can pass a subtly broken proof. The checker never gets tired and never accepts "obviously."

The deeper reason it's stronger: the thing you have to trust shrinks to a **small kernel** (covered below). You don't have to trust the thousands of lines of tactics and automation that *found* the proof — you only have to trust the tiny checker that *verifies* it. Trust concentrated in a small, auditable place beats trust spread across a large, fallible one.

### Q: Name the major proof assistants and one differentiator each.

> **Testing:** Breadth — have you actually looked at the landscape, or memorized "Coq"?

**A.**

- **Coq / Rocq** — the workhorse for *verified software*; CompCert and the Four Colour Theorem live here. Tactic-driven, `Gallina` term language, extracts to OCaml/Haskell.
- **Isabelle/HOL** — classical higher-order logic with the best *automation* (the `sledgehammer` hammer); seL4's proof is in Isabelle.
- **Lean (Lean 4)** — the modern entrant; doubles as a real programming language *and* a prover, and powers **Mathlib**, the largest unified formal-math library.
- **Agda** — dependently typed *programming* first; proofs are written as ordinary (total) programs, so it's the clearest lens on Curry–Howard.

A good signal is knowing they split on a fault line: **classical** (Isabelle/HOL assumes the law of excluded middle) vs **constructive** (Coq/Agda are intuitionistic by default — a proof of existence must *build* the witness).

---

## Curry–Howard & Dependent Types

### Q: Explain the Curry–Howard correspondence. Why should an engineer care?

> **Testing:** The single most important concept on this page — the bridge between logic and programming.

**A.** Curry–Howard says **propositions are types** and **proofs are programs.** A proposition like "A implies B" *is* the type of functions `A → B`; a *proof* of it *is* a function that turns evidence of `A` into evidence of `B`. The logical connectives line up exactly:

| Logic | Type |
|---|---|
| `A ⇒ B` (implication) | `A → B` (function) |
| `A ∧ B` (and) | `(A, B)` (pair / product) |
| `A ∨ B` (or) | `Either A B` (sum) |
| `∀x. P(x)` (for all) | `Π(x:T). P(x)` (dependent function) |
| `∃x. P(x)` (exists) | `Σ(x:T). P(x)` (dependent pair) |
| `True` / `False` | unit type / empty type |

Why an engineer cares: it means **type-checking *is* proof-checking.** When the compiler accepts your dependently typed program, it has *proved a theorem*. The richer your types, the more your "does it compile?" becomes "is it correct?" That's the whole game — pushing correctness conditions into the type so the checker enforces them for free.

### Q: What is a dependent type? Give the canonical example.

> **Testing:** The core differentiator. A type that depends on a *value* is the leap from ordinary type systems.

**A.** A **dependent type** is a type that *depends on a value.* In ordinary languages, `List<Int>` is a type but the *length* is just runtime data. With dependent types you can write `Vec Int 3` — a vector of *exactly three* integers — where the `3` is a value living inside the type.

The canonical payoff is a **total, safe `head`**. In most languages `head []` either crashes or returns an `Option`. With a length-indexed vector you give `head` the type:

```
head : Vec A (n + 1) -> A
```

It only accepts vectors whose length is `n + 1` — i.e. *provably non-empty.* Calling `head` on an empty vector isn't a runtime error; it **doesn't type-check.** The bug is eliminated at compile time, for all programs, with no test and no runtime guard. Likewise `append : Vec A m -> Vec A n -> Vec A (m + n)` makes "the output length is the sum of the inputs" a *compiler-enforced* fact.

### Q: What does "make illegal states unrepresentable" mean here, concretely?

> **Testing:** Whether you can connect the slogan to a real engineering outcome.

**A.** It means encoding an invariant *into the type* so that a value violating the invariant **cannot be constructed** — there is no syntax that produces one. Examples that move from slogan to substance:

- A **non-empty list** type so `head`/`max` take no `Option` and need no empty-check.
- A **sorted vector** type where the only way to build one is via insertion that preserves order, so "is it sorted?" is unaskable — it always is.
- A **balanced red-black tree** whose colour/height invariants are type indices, so an unbalanced tree literally won't compile (Okasaki's classic result).
- A matrix-multiply `mul : Mat m k -> Mat k n -> Mat m n` where **dimension mismatch is a type error**, not a runtime exception.

The engineering payoff: a whole category of bug stops being something you *test for* and becomes something the compiler *rejects*. You delete the defensive code *and* the tests that guarded it.

### Q: What is totality / termination checking, and why does non-termination break soundness?

> **Testing:** The subtle one. Most candidates miss that an infinite loop is a *logical* catastrophe, not just a hang.

**A.** Under Curry–Howard, a *program of type `P`* is a *proof of `P`.* Now consider a function that loops forever:

```
loop : P
loop = loop      -- type-checks, runs forever
```

This "inhabits" *every* type — including `False`. If `loop : False` is accepted, you've "proved" falsehood, and from `False` you can prove **anything** (*ex falso quodlibet*). Your whole logic collapses: every theorem is provable, so no theorem means anything.

That's why proof assistants enforce **totality**: every function must (1) **terminate** on all inputs and (2) be **defined for all inputs** (no missing cases, no partial pattern matches). Coq/Agda/Lean check this with a *structural-recursion* or *well-founded-recursion* analysis — each recursive call must be on a *strictly smaller* argument. Non-termination isn't a performance bug here; it's a soundness bomb. This is also why these languages are *not* general-purpose: a verified prover deliberately can't express an arbitrary `while(true)` server loop in the proof fragment.

### Q: Constructive vs classical logic — what's the practical difference?

> **Testing:** Whether you understand why "exists" sometimes forces you to *build* the thing.

**A.** **Constructive (intuitionistic)** logic — Coq/Agda's default — rejects the law of excluded middle (`P ∨ ¬P`) and double-negation elimination as *free* axioms. The practical consequence: to prove `∃x. P(x)` you must **exhibit a concrete witness** `x` and a proof `P(x)` — you can't prove existence by showing non-existence is contradictory. The upside is that constructive proofs are **executable**: a proof that "a sorting function exists" *is* a sorting function you can run and extract.

**Classical** logic — Isabelle/HOL — assumes excluded middle, matching ordinary mathematics, which makes some proofs shorter but can yield *non-constructive* existence proofs (the thing exists, but the proof doesn't tell you what it is). In Coq you can *add* classical axioms when you need them — at the cost of losing the "proof = runnable program" guarantee for those parts.

> Interview-grade nuance: "constructive" is *why* dependent-type provers double as programming languages — a proof that builds a witness is, literally, a program that produces the answer.

---

## How Proofs Work

### Q: Tactics vs term-mode — what's the difference?

> **Testing:** Whether you've seen how proofs are actually *written*, not just theorized about.

**A.** A **term-mode** proof writes the proof *object* directly — you literally construct the program/value that inhabits the proposition's type. It's precise but tedious for anything non-trivial.

A **tactic** proof is a *script of commands* that builds that object for you. You start with a goal, and tactics transform it: `intro` moves a hypothesis in, `induction n` splits into base/step cases, `rewrite H` substitutes using an equality, `simpl` reduces, `apply lemma` uses a prior result. The tactic engine generates the underlying proof term behind the scenes, then the kernel checks *that term*.

```coq
Theorem plus_n_O : forall n : nat, n + 0 = n.
Proof.
  intros n.
  induction n as [| n' IH].
  - reflexivity.            (* base: 0 + 0 = 0 *)
  - simpl. rewrite IH. reflexivity.  (* step: uses the inductive hypothesis *)
Qed.
```

The thing to say in an interview: **tactics are how you *find* the proof; the kernel-checked term is what you *trust*.** A buggy tactic can fail to find a proof, or find a clumsy one, but it can't make the kernel accept a *wrong* one.

### Q: How much can automation do, and where is a human still required?

> **Testing:** The "automation vs insight" distinction — and whether you over-claim what tools do.

**A.** Automation handles the *mechanical* and *decidable* parts extremely well:

- **Arithmetic/linear-integer goals** — Coq's `lia`/`omega`, which just *discharge* "obvious" inequalities and linear equations.
- **Simplification/rewriting** — `simp` (Isabelle) / `simpl` + rewrite databases.
- **Hammers** — `sledgehammer` (Isabelle), CoqHammer: they fire the goal at external SMT/first-order provers and *reconstruct* a checkable proof if one is found. These can close a large fraction of routine goals automatically.

What a human still supplies is the **insight that isn't searchable**: choosing the *right induction* (which variable? sometimes a different one entirely), the *right generalization* (you often must prove a *stronger* statement so the inductive hypothesis is usable), the *lemmas to factor out*, and the *invariant* for a loop or data structure. Automation explores a huge but *shallow* space fast; the human provides the *deep, creative* leap — the loop invariant, the clever measure, the strengthened lemma. That gap is exactly why "the prover can't just do it for you," covered in the scenarios.

### Q: What is the Trusted Computing Base / kernel, and why can't a buggy tactic prove a false theorem?

> **Testing:** The crown-jewel concept — *de Bruijn criterion* / small-kernel architecture.

**A.** The **Trusted Computing Base (TCB)** is the set of components that must be correct for a "proved" theorem to actually be true. The architectural trick — the **de Bruijn criterion** — is to make the TCB *tiny*: a small **kernel** (Coq's is on the order of a few thousand lines) that implements only the core inference rules, plus a *checker* that re-validates the final proof term against them.

Everything else — the tactic language, `lia`, `sledgehammer`, the IDE, your 50,000-line proof script — lives **outside** the TCB. Here's the payoff and the exact thing to say: a tactic is just a *proof-term generator*. No matter how buggy it is, the term it emits is **re-checked by the kernel**. If a buggy tactic emits a malformed or unsound term, the kernel *rejects* it — `Qed` fails. So a buggy tactic can waste your time, but it **cannot** make the system accept a proof of a false theorem. Trust is concentrated in the small, stable, heavily-audited kernel, not in the large, fast-moving automation around it.

The boundary of trust is the kernel **plus**: the **axioms** you added, the **specification** you wrote, and the **extraction/compiler** that turns the verified term into running code. Those are the gaps, not the tactics.

### Q: What kinds of axioms might you add, and what's the risk?

> **Testing:** Whether you know axioms expand the TCB and can make the system *unsound* if reckless.

**A.** Common additions: **excluded middle** and **choice** (to work classically), **functional extensionality** (two functions are equal if they agree on all inputs), **proof irrelevance**, and **`Axiom`-asserted** external facts you don't want to prove (e.g. a hardware model). Each axiom is a proposition you've declared true *without proof*, so it joins the TCB.

The risk is twofold. First, a *false* axiom — or even two individually-reasonable axioms that are jointly inconsistent — lets you prove `False`, and then everything. Second, an axiom can make proofs **non-computational** (you can no longer extract a runnable program from a proof that leans on it). The disciplined practice is to keep axioms few, well-known-sound, and to run `Print Assumptions my_theorem` to see *exactly* which axioms a theorem depends on before you trust it.

---

## Achievements & Cost

### Q: Name landmark verified systems and what each proves is *possible*.

> **Testing:** Whether you know this is real engineering with shipped results, not an academic toy.

**A.** Four canonical results, each making a different point:

- **CompCert** — a C compiler *proved* (in Coq) to preserve the semantics of the source program: the compiled code does what the C says, no miscompilation. The Csmith fuzzing study found bugs in GCC and LLVM but **zero** miscompilation bugs in CompCert's verified core. Point: *verification can match production-grade artifacts.*
- **seL4** — an OS microkernel with a *machine-checked* proof (in Isabelle/HOL) that the C implementation refines its spec, plus proofs of integrity and confidentiality. ~8,700 lines of C, on the order of *200,000+ lines of proof*. Point: *systems software at the trust root can be verified — at a cost.*
- **Fiat-Crypto / HACL\*** — *verified cryptographic primitives* (field arithmetic, Curve25519, etc.) that ship in **Chrome (BoringSSL) and Firefox**, proven free of the bugs that plague hand-written crypto. Point: *verification is in your browser right now.*
- **Four Colour Theorem** — a famous math result whose proof relied on un-reviewable computer enumeration; the Coq formalization made it *fully* machine-checked. Point: *proofs too big for humans can still be made rigorous.*

### Q: What does verification actually *cost*?

> **Testing:** The honesty check. A candidate who can't quote the bill will recommend it everywhere.

**A.** The numbers are sobering and you should know them:

- **Proof-to-code ratio of roughly 10:1 to 20:1.** seL4 was ~8,700 LoC of C against ~200k+ lines of proof; the *spec + proof* dwarfs the implementation.
- **Person-years.** seL4's initial verification was on the order of 20+ person-years; CompCert is the multi-year work of a small expert team.
- **Scarce, expensive talent.** Engineers who can drive Coq/Isabelle productively are rare and costly.
- **Proof maintenance / brittleness** — the under-appreciated killer. Change one line of code or one definition and dozens of downstream proofs can break; you re-prove, not just re-test. Proofs are *coupled* to the code in a way tests are not. The *ongoing* cost can exceed the initial one.

So the cost isn't a one-time tax — it's a permanent multiplier on every change to the verified core.

### Q: What is extraction, and what's the spec/TCB gap it leaves?

> **Testing:** Whether you understand that "verified" stops at a boundary — the running binary may not be the proved object.

**A.** **Extraction** turns a verified Coq/Agda development into runnable code in a mainstream language — typically OCaml or Haskell — by erasing the proof parts and keeping the computational content. CompCert is partly built this way.

The gap: you proved properties about the *formal object inside the prover*, but you *run* the extracted code, which goes through an *unverified* path: the **extraction mechanism** itself, the **OCaml/Haskell compiler and runtime**, the **OS and hardware**. None of those were in your proof. So even a perfect proof leaves a **spec-to-reality gap**: the proof guarantees the model is correct; the binary's correctness additionally rests on the extractor and toolchain being faithful. CompCert narrows this by being a *verified* compiler, but the chain is never zero-trust — which is the whole point of the next question.

### Q: Knuth said "Beware of bugs in the above code; I have only proved it correct, not tried it." What did he mean?

> **Testing:** The staff-level humility check — what "proven correct" does *not* guarantee.

**A.** He meant a proof is only as good as **what you proved and what you trusted.** "Proven correct" guarantees the code matches the **spec** — and nothing more. It does *not* guarantee:

1. **The spec is right.** You can flawlessly prove the wrong requirement. A money-transfer proof that forgot to forbid negative balances is *correct* and *useless*.
2. **The axioms are sound.** A false or inconsistent axiom poisons everything downstream.
3. **The TCB is bug-free.** The kernel, extractor, compiler, OS, and hardware are all trusted, not proved.
4. **The model matches the world.** Your proof assumed 64-bit ints don't overflow, or that the network behaves a certain way; reality may disagree.

The mature framing: proof moves the risk from "is the implementation buggy?" (which it crushes) to "is the spec/axioms/TCB right?" (which it can't). That residual risk is small and *concentrated* — far better than diffuse implementation risk — but it is never zero. Saying this unprompted is the clearest staff signal in the whole bank.

---

## Judgement & Scenarios

### Q: When is a proof assistant genuinely worth it — and when is it almost never?

> **Testing:** The whole point of the topic. Can you draw the line, or are you a true believer?

**A.** Reach for a proof assistant only when the cost-benefit clears a high bar — roughly, when failure is **catastrophic, unrecoverable, and the artifact is small, stable, and high-value**:

**Worth it:**
- **Compilers / toolchains** (CompCert) — a miscompilation silently corrupts *every* program built with it.
- **OS kernels / hypervisors** (seL4) — the trust root; a bug undermines everything above.
- **Cryptographic primitives** (HACL\*, Fiat-Crypto) — small, stable, brutally hard to get right by hand, catastrophic if wrong.
- **Smart contracts** — immutable once deployed, directly hold money, *cannot be patched* (the literal definition of unrecoverable).
- **Avionics / medical / nuclear** — regulated domains where human life and standards (DO-178C) justify the cost.

**Almost never:**
- A CRUD web app, an internal dashboard, a typical microservice — requirements change weekly (so proofs rot constantly), bugs are recoverable with a hotfix, and tests/types/reviews give *enough* assurance for a fraction of the cost.

The discriminators are: **blast radius** (catastrophic?), **patchability** (can you fix it after ship?), **stability** (will the spec hold still long enough to amortize the proof?), and **value density** (is the core small enough to verify and important enough to justify it?).

### Q: Your boss read about seL4 and wants *everything* formally verified. What do you say?

> **Testing:** The signature scenario. Do you push back with judgement, or salute, or sneer?

**A.** I'd agree with the *instinct* and redirect the *scope*. Something like:

> "seL4 is a fantastic result — and it cost 20+ person-years for ~8,700 lines of kernel, with a 10–20:1 proof-to-code ratio and proofs that must be re-done whenever the code changes. We have a 200k-line service that changes weekly. Verifying *all* of it would cost more than the company and the proofs would rot faster than we wrote them.
>
> But the *idea* is right where the stakes are right. Let's apply **'verify the core, test the rest.'** Identify the small, stable, catastrophic-if-wrong pieces — say our crypto, our payment-settlement invariant, or our access-control logic — and consider verifying *those*. For everything else we get most of the value from cheaper tools: a model checker for the concurrency, property-based tests for the algorithms, types and contracts for the rest.
>
> And before we touch a proof assistant, let's try the **lighter cousins** — Dafny, F\*, or Liquid Haskell — which give strong guarantees at a fraction of the cost."

The structure that scores: **validate the motivation, quantify the cost, scope it to the catastrophic core, and offer the cheaper ladder first.**

### Q: What's the difference between a passing test and a proof?

> **Testing:** The cleanest articulation of "some inputs vs all inputs" — and the spec caveat.

**A.** A passing test says: *"for the specific inputs I ran, the code produced the expected output."* A proof says: *"for **every** possible input — including the ones no one will ever write — the code satisfies the property, and a machine has verified the argument has no gaps."*

Two corollaries make it a senior answer. First, **a test can only find bugs, never prove their absence** (Dijkstra); a proof targets *absence* directly. Second, **both are only as good as what you assert** — a test with a wrong assertion passes wrongly, and a proof of a wrong spec is correct and useless. The proof eliminates *implementation* uncertainty far more thoroughly than any test, but neither eliminates *specification* uncertainty. So the leap is "some inputs → all inputs," with the asterisk "still bounded by the spec you wrote."

### Q: Why can't the prover just find the loop invariant / the right induction for me?

> **Testing:** Whether you understand the fundamental limit — this is *search in an infinite space*, not laziness.

**A.** Because finding an invariant or the right induction is, in general, **undecidable** — there's no algorithm that always succeeds. Concretely:

- **A loop invariant** is a property that holds before the loop, is preserved by each iteration, and is strong enough to imply what you want *after*. The space of candidate invariants is *infinite*, and the right one often must be *creatively strengthened* beyond the obvious — automation can guess simple ones but routinely fails on the deep ones.
- **The right induction** isn't mechanical either: sometimes you must induct on a *different* variable, or first **generalize the goal** (prove a *stronger* theorem) so the inductive hypothesis is actually usable. A machine searching the literal goal can loop forever or stall; the human reframes the problem.

So it's not that tools are lazy — it's that this is *open-ended mathematical insight*, the part of proof that resists search. Automation discharges the *consequences* of your insight (the algebra, the case-bash); it can't manufacture the insight itself. That division of labour — human supplies the invariant, machine checks it relentlessly — is the essence of *interactive* theorem proving.

### Q: Before a full proof assistant, what lighter tools should you try, and why?

> **Testing:** Whether you know the cost ladder — full Coq is the *last* resort, not the first.

**A.** The middle ground gives a large share of the assurance at a fraction of the cost, because it leans on **SMT automation** instead of hand-written proofs:

- **Dafny** — an imperative language with built-in pre/post-conditions and invariants; an SMT solver (Z3) discharges most proof obligations *automatically*. You write `requires`/`ensures`, it verifies. Used in real Microsoft/AWS work.
- **F\*** — dependently typed *and* SMT-backed; the verified crypto in HACL\* is written in F\*.
- **Liquid Haskell** — refinement types bolted onto Haskell: annotate `{v:Int | v > 0}` and the solver checks it, no separate proof.

Why try these first: they're **push-button where they work** (the solver does the grind), they integrate with *real* programming languages, and the developer writes *specs*, not *proofs*. You escalate to Coq/Lean only when you need guarantees the SMT solver can't reach (deep inductive arguments, properties beyond decidable theories) or a TCB small enough to satisfy a certifier. "Reach for Dafny before Coq" is a strong, cost-aware instinct — and it ties directly to [04 — Property & Contract Verification](../04-property-and-contract-verification/interview.md).

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: One-sentence definition of a proof assistant?** A: A tool where you build a proof that a machine checks, giving certainty for *all* inputs rather than the few a test tries.
- **Q: Coq's new name?** A: Rocq.
- **Q: Which prover backs Mathlib?** A: Lean (Lean 4).
- **Q: Which prover verified seL4?** A: Isabelle/HOL.
- **Q: Which compiler is verified in Coq?** A: CompCert.
- **Q: Curry–Howard in five words?** A: Propositions are types, proofs programs.
- **Q: ∀ corresponds to which type?** A: A dependent function (Π) type.
- **Q: ∃ corresponds to which type?** A: A dependent pair (Σ) type.
- **Q: What's a dependent type?** A: A type that depends on a *value* (e.g. `Vec A 3`).
- **Q: Why does `head` on a length-indexed vector need no `Option`?** A: Its type only accepts a provably non-empty vector, so the empty case can't be passed.
- **Q: Why must proof-assistant functions terminate?** A: A non-terminating term inhabits any type, including `False`, which makes the logic unsound.
- **Q: Tactics vs term-mode?** A: Tactics are a script that *generates* the proof term; term-mode writes the term directly.
- **Q: What does `lia` do?** A: Automatically discharges linear-integer-arithmetic goals.
- **Q: What is `sledgehammer`?** A: Isabelle's hammer that fires goals at external provers and reconstructs a checkable proof.
- **Q: What is the TCB?** A: The components you must trust for a proof to mean anything — kernel + axioms + spec + toolchain.
- **Q: Why can't a buggy tactic prove a false theorem?** A: The kernel re-checks the emitted term and rejects any unsound one.
- **Q: Constructive vs classical, one line?** A: Constructive demands a built witness for ∃ and rejects free excluded-middle; classical assumes it.
- **Q: Typical proof-to-code ratio?** A: Roughly 10:1 to 20:1.
- **Q: What is extraction?** A: Turning a verified development into runnable OCaml/Haskell by erasing proof content.
- **Q: Knuth's caveat in one line?** A: "Proved correct" means matches-the-spec, not spec-is-right or TCB-is-bug-free.
- **Q: Name a lighter cousin to try first.** A: Dafny (or F\*, or Liquid Haskell) — SMT-backed, push-button.
- **Q: One place verification is almost always worth it?** A: Smart contracts — immutable, hold money, unpatchable.
- **Q: One place it almost never is?** A: A typical CRUD app — recoverable bugs, churning spec, cheaper tools suffice.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Calling a proof assistant "just fancy/exhaustive testing" — missing the all-inputs-and-checked leap.
- Claiming "proven correct" means bug-free — ignoring spec, axioms, and TCB.
- Thinking the prover should "just find" the invariant or induction — not grasping it's undecidable search.
- Believing a buggy tactic could prove a false theorem — not understanding the small-kernel re-check.
- Recommending full formal verification for a normal web service — no cost awareness.
- Not knowing a single real verified system, or quoting no cost numbers.
- Conflating dependent types with generics (`List<T>`) — missing the *type-depends-on-value* point.

**Green flags:**
- Naming the *distinction* (proof/test, spec/code, automation/insight, theorem/trust) before any tool name.
- Quoting the **10–20:1 ratio** and person-years unprompted.
- Stating Knuth's caveat — proof guarantees code-matches-spec, not spec-correctness — without being asked.
- Explaining the **small kernel / de Bruijn criterion** as why automation needn't be trusted.
- Reaching for the **lighter ladder** (property tests → Dafny/F\* → Coq) instead of jumping to a proof assistant.
- Scoping to "**verify the core, test the rest**" in the seL4 scenario.
- Knowing termination is a *soundness* requirement, not a performance one.
- Caveating tradeoffs ("a proof is total *but* only as good as the spec and the trusted base").

---

## Cheat Sheet

| Concept | One-liner |
|---|---|
| **Proof assistant** | You build a proof; a machine checks it → certainty for *all* inputs. |
| **vs test** | Test: some inputs. Proof: all inputs, mechanically verified. |
| **Tools** | Coq/Rocq, Isabelle/HOL, Lean 4, Agda. |
| **Curry–Howard** | Propositions = types, proofs = programs; type-check = proof-check. |
| **∀ / ∃** | Π (dependent function) / Σ (dependent pair). |
| **Dependent type** | Type that depends on a *value* (`Vec A 3`); makes illegal states unrepresentable. |
| **Totality** | All functions must terminate + be total, or `False` becomes provable. |
| **Constructive** | ∃ requires a built witness; proofs are runnable programs. |
| **Tactics** | A script that *generates* the proof term (vs writing the term by hand). |
| **Automation** | `lia`, `simp`, hammers do the grind; humans supply invariant/induction. |
| **TCB / kernel** | Small re-checking kernel + axioms + spec + toolchain = what you must trust. |
| **Why kernel matters** | A buggy tactic emits a term the kernel rejects → can't prove a falsehood. |
| **Achievements** | CompCert, seL4, Fiat-Crypto/HACL\*, Four Colour Theorem. |
| **Cost** | ~10–20:1 proof:code, person-years, brittle proof maintenance. |
| **Extraction gap** | Run the extracted binary, not the proved term — extractor/compiler unverified. |
| **Knuth's caveat** | "Proved correct" ≠ spec-right, axioms-sound, or TCB-clean. |
| **Worth it** | Catastrophic + unrecoverable + small + stable: compilers, kernels, crypto, contracts. |
| **Lighter first** | Dafny / F\* / Liquid Haskell (SMT-backed) before a full proof assistant. |
| **Mantra** | Verify the core, test the rest. |

---

## Summary

- The bank reduces to a few distinctions in costumes: **proof vs test** (all inputs vs some), **spec vs code** (you prove the match, not the spec), **automation vs insight** (machine grinds, human supplies the invariant), **theorem vs trust** (kernel + axioms + spec + TCB), and **"worth it" vs "almost never."** Name the distinction first.
- **Fundamentals:** a proof assistant gives machine-checked, universal correctness; the tools are Coq/Rocq, Isabelle/HOL, Lean, Agda; "machine-checked" beats expert review because trust shrinks to a small kernel.
- **Curry–Howard & dependent types:** propositions are types and proofs are programs, so type-checking *is* proof-checking; dependent types (`Vec A n`) make illegal states unrepresentable (a total, guard-free `head`); non-termination would prove `False`, so totality is a *soundness* requirement; constructive logic forces you to *build* witnesses, which is why these provers double as languages.
- **How proofs work:** tactics generate the proof term, the kernel checks it; automation (`lia`, `simp`, hammers) handles the decidable grind while humans supply the induction/invariant; the **small kernel** means a buggy tactic can waste time but never prove a falsehood; added axioms expand the TCB.
- **Achievements & cost:** CompCert, seL4, HACL\*/Fiat-Crypto, and the Four Colour Theorem are real, shipped results — at ~10–20:1 proof-to-code, person-years, and brittle proof maintenance; extraction leaves an unverified spec-to-binary gap.
- **Judgement:** verify only the catastrophic-if-wrong, unrecoverable, small, stable core (compilers, kernels, crypto, smart contracts); for everything else, **verify the core, test the rest**, and try the lighter cousins (Dafny/F\*/Liquid Haskell) first. And always remember Knuth: "proven correct" never means the spec, axioms, or trusted base are right.

---

## Further Reading

- *Software Foundations* — Benjamin Pierce et al. The canonical, free, Coq-based introduction; if you do one thing, work the first volume.
- *Theorem Proving in Lean 4* — the official Lean tutorial; the best on-ramp to the modern Lean/Mathlib world.
- *Formal Verification of a Realistic Compiler* — Xavier Leroy (CompCert). The paper that proved a production-grade compiler is achievable.
- *seL4: Formal Verification of an OS Kernel* — Gerwin Klein et al. (SOSP 2009). The landmark systems-verification result, with the real cost numbers.
- *Certified Programming with Dependent Types* (CPDT) — Adam Chlipala. Deeper on dependently typed proof engineering.
- The [junior](junior.md) and [senior](senior.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [01 — Formal Specification](../01-formal-specification/interview.md) — you prove the code matches *this*; the spec is the thing a proof can't validate.
- [04 — Property & Contract Verification](../04-property-and-contract-verification/interview.md) — the lighter, SMT-backed ladder (Dafny/F\*) to climb before a full proof assistant.
- [02 — Model Checking](../02-model-checking/interview.md) — the push-button, bounded alternative; contrast "exhaustive but finite" with "interactive but unbounded."
- [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/interview.md) — the cost-benefit framework behind every "worth it / almost never" answer here.
- [Testing](../../testing/) — the "some inputs" baseline that proofs and property tests extend toward "all inputs."
