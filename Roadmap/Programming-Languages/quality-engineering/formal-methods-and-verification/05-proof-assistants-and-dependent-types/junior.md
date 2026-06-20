# Proof Assistants & Dependent Types — Junior Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → Proof Assistants & Dependent Types
> *A test asks "does it work for this example?" A proof assistant asks "can you convince a machine it works for **every** example, **forever**?" — and refuses to believe you until you can.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — A Proof Assistant Checks Reasoning, Not Examples](#core-concept-1--a-proof-assistant-checks-reasoning-not-examples)
5. [Core Concept 2 — Test → Property Test → Proof: The Coverage Ladder](#core-concept-2--test--property-test--proof-the-coverage-ladder)
6. [Core Concept 3 — Dependent Types: When a Type Depends on a Value](#core-concept-3--dependent-types-when-a-type-depends-on-a-value)
7. [Core Concept 4 — Curry–Howard: A Proof Is a Program](#core-concept-4--curryhoward-a-proof-is-a-program)
8. [Core Concept 5 — The Cost: This Is Heavy Artillery](#core-concept-5--the-cost-this-is-heavy-artillery)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is a proof assistant, what is a dependent type, and why would anyone pay the enormous price to use them?**

You already trust some tools to be *certain*. When the type checker says "you passed a `String` where an `int` was required," it is not guessing — it has *proven*, by inspecting your whole program, that the mismatch exists, and no amount of running the code will change its mind. A **proof assistant** (also called an **interactive theorem prover**) takes that same idea — a machine that mechanically checks a precise claim — and turns the dial all the way up.

Here is the move. You write a precise *statement* about your code: "this sorting function always returns a list that is sorted **and** is a permutation of its input." Then you write a **proof** — an argument, built step by step — and the machine **checks** every step. If it accepts the proof, the statement is true with *mathematical certainty*: for all inputs, on every machine, forever. Not "we ran a thousand cases." *All* cases, established by reasoning rather than by execution.

The famous tools, named gently so you recognise them later: **Coq** (recently renamed **Rocq**), **Isabelle/HOL**, **Lean**, and **Agda**. They look like a strange hybrid of a programming language and a logic notebook, because that is exactly what they are.

Two real achievements make this concrete rather than academic. **CompCert** is a C compiler whose core is *proven* never to miscompile — a celebrated study fuzzed many production C compilers and found bugs in all of them *except* CompCert's verified core. **seL4** is an operating-system microkernel that ships with a full machine-checked proof that the code does what its specification says — the kind of guarantee you want when failure means a plane falls out of the sky. Neither of these is "well-tested." Both are *proven*.

This page is a tour, not a tutorial. You will not write a proof here. You will leave knowing what these tools *are*, what they have *achieved*, what a **dependent type** is, why a **proof is like a program**, and — most importantly for a junior — *why you will almost never reach for them*, and how to recognise the rare case when you should.

> **Mindset shift:** stop thinking "I'll write some tests to be confident it works." Start thinking "tests *sample* behaviour; a proof *covers* it." Most of the time, sampling is the right, cheap engineering choice. But for a tiny, critical slice of software — a compiler, a kernel, a crypto primitive — "we sampled and found nothing" is not good enough, and someone is willing to pay years of effort to replace *confidence* with *certainty*. Knowing that this rung of the ladder exists, and what it costs, is itself the lesson.

---

## Prerequisites

- **Required:** You can write and read code, and you have seen **types** — you know what it means that a function takes an `int` and returns a `String`.
- **Required:** You have written at least one **test** and watched it pass or fail.
- **Helpful:** You have met **property-based testing** (QuickCheck / Hypothesis style) — "run this on hundreds of random inputs." If not, [04 — Property & Contract Verification](../04-property-and-contract-verification/junior.md) introduces it; this page treats it as the rung *just below* proof.
- **Helpful:** You have hit a `NullPointerException` / "index out of range" in production and wished the language had simply *stopped you* from writing the bug. (Dependent types are partly about exactly that.)
- **Not required:** Any mathematics beyond "a statement can be true or false, and an argument can establish it." No prior logic, no Coq, no Lean.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Proof assistant** | A tool where you state a claim and build a proof the *machine* checks step by step. Synonym: **interactive theorem prover**. |
| **Theorem / proposition** | A precise statement you want to be true (e.g. "sort returns a sorted list"). |
| **Proof** | A step-by-step argument that the statement holds. The machine verifies it; it does not trust you. |
| **Tactic** | A command that builds part of a proof ("do induction," "simplify," "this follows from that"). How you *interact* with the assistant. |
| **Specification (spec)** | The precise description of what code *should* do — the thing you prove the code *matches*. |
| **Dependent type** | A type that can *depend on a value* — e.g. "a list of exactly `N` elements," where `N` is a number, not just `List`. |
| **Total function** | A function proven to return a valid result for *every* input — no crashes, no infinite loops, no "undefined." |
| **Curry–Howard correspondence** | The deep idea that *a proposition is like a type* and *a proof is like a program* of that type. |
| **Verified software** | Software shipped with a machine-checked proof that it meets its spec (e.g. CompCert, seL4). |
| **Trusted base** | The small part you must believe without proof (the proof checker, the hardware). Everything else is checked. |

---

## Core Concept 1 — A Proof Assistant Checks Reasoning, Not Examples

Take a function and a claim about it: *"`double(n)` is always even."* How do you become sure?

- **A test** picks a case: `double(3) == 6`, and `6` is even. Passes. You have checked *one* input.
- **A property test** picks many random cases: it tries `double` on hundreds of random `n` and checks each result is even. You have checked *hundreds* of inputs — strong evidence, but `n` has infinitely many values, so it is still sampling.
- **A proof** does not run `double` at all. It *argues*: "`double(n)` is `n + n`; `n + n` is divisible by 2 for any integer `n`; therefore the result is even — for **every** `n`, with no exceptions." A proof assistant checks that this argument is airtight.

That is the entire difference, and it is worth saying slowly: **a test executes the code on chosen inputs; a proof reasons about all inputs without executing anything.** Running can only ever visit the cases you (or your random generator) supply. Reasoning can cover the whole infinite space at once — *if* you can construct an argument the machine accepts.

What does "the machine accepts" mean? You don't type prose. You drive the assistant with **tactics** — small commands that each justify a step. Roughly, in Coq-flavoured pseudocode:

```coq
(* claim: for every natural number n, double n is even *)
Theorem double_is_even : forall n, even (double n).
Proof.
  intro n.        (* "take an arbitrary n"                       *)
  unfold double.  (* "double n means n + n"                      *)
  (* ... a few more tactics establishing n + n is divisible by 2 *)
Qed.              (* the machine checks every step; only then accepted *)
```

You do not need to read the tactics. The point is the shape: a *statement* (`Theorem ...`), a *proof script* (the tactics), and a *final stamp* (`Qed.`) the machine only prints when it has verified every step. If a single step doesn't follow, the assistant *refuses* — there is no "looks fine to me," no flaky pass. That refusal is the whole value: it is impossible to fool it into accepting a wrong proof (short of a bug in the tiny checker itself — see *trusted base* later).

> **Key insight:** a passing test says "no bug *on the inputs I tried*." A completed proof says "no bug *on any input, ever*." The first is cheap and almost always enough. The second is expensive and reserved for the rare code where "the inputs I tried" is an unacceptable hedge.

---

## Core Concept 2 — Test → Property Test → Proof: The Coverage Ladder

This whole section of the roadmap is a *ladder*, and proof assistants sit at the very top. Each rung makes a stronger claim for a higher price. Seeing the ladder is more useful than memorising any one tool.

| Rung | What it actually does | What it can claim | Cost |
|---|---|---|---|
| **Example test** | Runs code on *one* hand-picked input | "Correct on *this* case" | Tiny |
| **Property test** | Runs code on *many random* inputs, checks an invariant | "No counterexample found in *N tries*" | Low |
| **Contract / runtime check** | Asserts conditions *while running* | "We'll *catch* a violation if it happens at runtime" | Low |
| **Model checking** | Explores *all reachable states* of a *model* | "No violation in the model's whole state space" | Medium |
| **Proof assistant** | *Reasons* about *all inputs* of the *real definitions* | "Proven correct for **all** inputs, forever" | **Very high** |

Read top to bottom and the trade is always the same: **more coverage, more cost.** A property test that runs `sort` on a thousand random lists is *vastly* cheaper than proving `sort` correct, and for almost every program it is the smarter buy — it finds the bug you actually have at a fraction of the effort.

So why ever climb to the top rung? Because a property test that finds nothing in a thousand tries has still *only tried a thousand*. For a C compiler used to build a flight-control system, "we fuzzed it hard and found no miscompilation" is genuinely not good enough — a single miscompiled instruction, on a single unlucky input, could be fatal. There, and only there, the price of a proof is worth paying.

> **Key insight:** the rungs are not rivals; they are a *budget decision*. Proof assistants do not replace testing — almost all software stays on the low rungs forever. You climb only as high as the *cost of being wrong* forces you to. For most code, that is the bottom of the ladder.

---

## Core Concept 3 — Dependent Types: When a Type Depends on a Value

Here is the idea that makes these tools feel like programming languages with superpowers.

A normal type describes a *shape* of value: `int` ("this is an integer"), `String` ("this is text"), `List<int>` ("this is a list of integers, of *some* length"). The type system checks these for you already, which is why you can't accidentally add a number to a function.

A **dependent type** lets a type *depend on a value*. The classic example is a list that carries its **length** *in the type itself*:

- `List int` — a list of integers, length unknown to the type system.
- `Vector int 3` — a list of integers of *exactly 3 elements*. The number `3` is *part of the type*.

Why does that matter? Because now the type can *forbid* whole classes of bug at compile time. Consider "get the first element of a list." On an ordinary list, the first element might not exist — the list could be empty — so this operation is a classic source of crashes (`IndexError`, `head of empty list`, the null-pointer family). With dependent types you can give the operation this signature, in Lean-flavoured pseudocode:

```lean
-- "first" requires a Vector whose length is (n + 1):
-- a length that is *provably at least 1*, i.e. NOT empty.
def first (v : Vector α (n + 1)) : α := ...
```

The type `Vector α (n + 1)` says, at the type level, *"this vector has at least one element."* So if you try to call `first` on a vector that *might* be empty, the program **does not type-check** — it won't even compile. The bug "first element of an empty list" is no longer a runtime crash you discover in production; it is a *type error* you discover the moment you write it.

That is the slogan to take away: **dependent types let you push facts that were once runtime invariants up into the type, so the compiler enforces them.** "This list is non-empty," "these two matrices have compatible dimensions," "this index is in bounds" — all become things the type checker simply will not let you get wrong.

```text
Ordinary type:   List<int>            "some integers, some length"
Dependent type:  Vector int 3         "exactly 3 integers — length is in the type"
Payoff:          first(emptyVector)   ← won't even COMPILE
```

Dependent types are the bridge between "programming" and "proving": once a type can *say* "this list has at least one element," writing a program of that type is, in effect, *proving* the list is non-empty. Which leads straight to the big idea.

> **Key insight:** ordinary types catch "you used the wrong *kind* of thing." Dependent types can catch "you used the wrong *thing*" — wrong length, out-of-bounds index, empty-when-it-must-not-be. The bug becomes a *type error*, the cheapest and earliest place any bug can possibly be caught.

---

## Core Concept 4 — Curry–Howard: A Proof Is a Program

This is the single most beautiful idea in the area, and you can grasp the *gist* without any maths. It is called the **Curry–Howard correspondence**, and it says:

> **A proposition is like a type, and a proof is like a program of that type.**

Unpack it gently. When you write a function

```text
toUpper : String → String
```

you are making a kind of promise: "give me a `String`, and I will give you back a `String`." Writing the *body* of the function — actual code that takes a string and returns a string — is what *fulfils* the promise. The body is the **evidence** that the promise can be kept.

Now read a logical statement the same way. "**If** it is raining **then** the ground is wet" has the shape `Raining → GroundWet` — exactly the shape of a function type, "give me a proof it's raining, and I'll give you a proof the ground is wet." And a **proof** of that statement is precisely a *function*: something that, handed evidence of rain, produces evidence the ground is wet. The proof *is* a program; the theorem *is* its type.

That is why proof assistants like Coq, Lean, and Agda look like programming languages: in them, **to prove a theorem is literally to write a program whose type is that theorem.** The machine checks your proof the very same way a compiler type-checks your program — by checking the "program" really does have the stated "type." Proving and programming stop being two activities and become one.

```text
PROGRAMMING                         PROVING
-----------                         -------
a TYPE          String → String     a PROPOSITION   Raining → GroundWet
a PROGRAM       the function body    a PROOF         the argument
"does it type-check?"                "is the proof valid?"
        ... and they are the SAME check.
```

You do not need to *use* this idea yet. You need to recognise it, because it explains the whole strange character of these tools: there is no separate "proof language" bolted onto a "programming language." It is one language, where building a value of a type and proving a theorem are the same act. That unity is what dependent types (Concept 3) made possible — types rich enough to *be* propositions.

> **Key insight:** in a proof assistant, you don't "write code, then separately prove it correct" in two different worlds. The proof and the program are the same kind of object. That elegance is also why it's hard: every claim must be made fully precise enough to be a *type*, with no hand-waving the machine would reject.

---

## Core Concept 5 — The Cost: This Is Heavy Artillery

A junior who walks away thinking "proofs give certainty, so I should prove my code" has learned the wrong lesson. The *defining* feature of this rung, for practical purposes, is its **price**. Be honest about it.

**Proofs are hard and slow to write.** A property test for `sort` is a few lines and an afternoon. A *proof* that `sort` returns a sorted permutation — making "sorted" and "permutation" fully precise, then constructing an argument the machine accepts for every input, handling every case the machine insists you handle — can be days of expert work, and `sort` is one of the *easy* examples. The tools demand total precision: there is no "you know what I mean." Every gap you would wave away in conversation is a step the machine refuses to skip.

The headline numbers make the scale concrete:

- **seL4** — the verified microkernel — took on the order of **20 person-years** of effort, with a proof many times larger than the kernel's actual code.
- **CompCert** — the verified C compiler — was a multi-year effort by formal-methods experts, not a side project.

| | Test / property test | Proof assistant |
|---|---|---|
| Effort to cover a function | Minutes to hours | Hours to **person-years** |
| Skill required | Any developer | Specialist (formal methods) |
| What it proves | "No bug found *yet*" | "No bug, *ever*, on any input" |
| Maintenance when code changes | Update a few tests | **Re-do affected proofs** |
| Right for a CRUD web app? | **Yes** | Almost never |
| Right for a flight-control compiler? | Necessary but *not sufficient* | **Yes — worth the years** |

This is why proof assistants are reserved for the rare, critical core where a bug is genuinely *unacceptable*: **compilers, operating-system kernels, cryptographic primitives, aerospace and medical control systems, smart contracts holding large sums.** In those domains the *cost of a single bug* — a crashed aircraft, a leaked key, a halted reactor, a drained treasury — dwarfs even 20 person-years of proof effort. Everywhere else, that effort buys you certainty you didn't need, at the expense of the features you did.

> **Key insight:** the question is never "could we prove this?" (almost anything *could* be proven, given enough years). The question is "**is a bug here catastrophic enough to justify the cost of proof, instead of testing?**" For the overwhelming majority of software, the honest answer is *no* — and choosing the cheaper rung is the *correct* engineering call, not a cop-out. Knowing *when* the answer flips is the real skill, and it's the whole subject of [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/junior.md).

---

## Real-World Examples

**1. CompCert — the C compiler that doesn't miscompile.** Every compiler is itself a program, and like any program it can have bugs — bugs that silently turn *correct* source code into *wrong* machine code. A widely cited study (the "Csmith" fuzzing work) generated random valid C programs and fed them to many production compilers; it found miscompilation bugs in *all* of them — except that it found *none* in the verified core of **CompCert**, the compiler whose translation is *proven* in Coq to preserve the meaning of the program. That is the payoff of proof made tangible: where fuzzing found bugs everywhere else, the proven core stood.

**2. seL4 — a kernel you can actually trust.** The **seL4** microkernel ships with a machine-checked proof, in Isabelle/HOL, that its C implementation matches its specification — and further proofs about security properties. It is deployed where failure is catastrophic (defence, aviation, autonomous vehicles). The cost — roughly **20 person-years** — is enormous, and it is *worth it* precisely because the thing it protects is worth far more. No amount of testing could buy the same guarantee.

**3. Dependent types stopping a real bug class.** Languages with dependent types (Agda, Idris, Lean) can give array indexing a type that *requires a proof the index is in bounds*. The result: "index out of range" — one of the most common crashes in all of software — becomes a *compile-time type error*. You cannot ship the bug, because the program containing it will not build. This is the same idea as `Vector n` from Concept 3, applied to a bug you have almost certainly hit yourself.

**4. The CRUD app that should *not* use any of this.** A team building a typical web app — user signup, a database, some forms — would be making a serious mistake to reach for Coq. The cost of a proof would sink the project, and the *cost of a bug* (a re-deploy, an apology) is low. The right tools here are unit tests, integration tests, and maybe a property test for one tricky function. Recognising this is as important as knowing proof assistants exist.

---

## Mental Models

- **Test = a witness; proof = the law of physics.** A passing test is one witness saying "I saw it work once." A property test is a thousand witnesses. A *proof* is a law: it doesn't report observations, it guarantees the outcome can't be otherwise — for every case, including the ones nobody observed.

- **Dependent types = a type that carries a fact.** An ordinary type is a label on a box ("contains integers"). A dependent type is a label that also states a *fact about the contents* ("contains *exactly three* integers," "is *non-empty*"). The compiler then refuses any operation that would violate the stated fact.

- **Curry–Howard = proving is programming.** Don't picture two rooms — a "coding room" and a "proving room." Picture *one* room. The type you write is the theorem; the program you write to fit it is the proof. Same room, same tools, same check.

- **Heavy artillery, not a sidearm.** You don't carry artillery on a walk to the shop. Proof assistants are wheeled out for the rare, fortified target — the compiler, the kernel, the key. For everyday work you carry the light, cheap weapons (tests), and that is the correct loadout.

- **The trusted base = the one thing you still believe.** A proof is only as trustworthy as the small checker that verifies it (and the hardware it runs on). You move *almost* everything from "trust me" to "checked" — but a tiny core remains trusted. Certainty is near-total, not literally infinite. (And, per Knuth's joke: a proof is only as good as the *spec* it proves against — prove the wrong statement and the machine will happily certify it.)

---

## Common Mistakes

1. **Thinking a proof can be "mostly done."** A test suite at 80% is useful. A proof with a gap proves *nothing* — the machine will not print `Qed`. Verification is all-or-nothing in a way testing is not, which is part of why it is so costly.

2. **Believing "proven correct" means "bug-free."** It means "**matches its specification**." If the *spec* is wrong (you proved the wrong thing) or incomplete (you didn't state the property that actually matters), the proof is worthless. *Beware of bugs in the spec; I have only proved the code matches it.*

3. **Reaching for a proof assistant on ordinary software.** The single most common mistake of newcomers thrilled by certainty. For a CRUD app, a proof costs more than the whole project and buys certainty you don't need. Match the rung to the cost of being wrong.

4. **Confusing dependent types with "stronger generics."** Generics let a type take *another type* as a parameter (`List<T>`). Dependent types let a type take a *value* as a parameter (`Vector T 3`). The leap is from "depends on a type" to "depends on a *value*," and that leap is what lets types encode facts like length and bounds.

5. **Assuming these tools are purely academic.** CompCert and seL4 are *shipping, deployed* systems, and dependent-type ideas are leaking into mainstream languages (refinement types, ever-richer type systems). It is niche, not fictional — and the *thinking* it teaches improves ordinary design.

6. **Forgetting the maintenance cost.** A proof is not write-once. Change the code and you must *re-prove* the affected parts — sometimes a large undertaking. The 20 person-years for seL4 is not just the initial proof; living with a proof is an ongoing commitment.

---

## Test Yourself

1. In one sentence each, state the difference between what a *test*, a *property test*, and a *proof* establish about a function.
2. A proof assistant accepts your proof that `reverse(reverse(xs)) == xs`. For how many lists `xs` is this now guaranteed to hold?
3. What is a **dependent type**, and how does it differ from an ordinary type like `List<int>`? Give the `Vector` example.
4. Why won't `first(v)` compile if `first` requires a `Vector α (n + 1)` and `v` might be empty? Why is that a *good* thing?
5. State the Curry–Howard correspondence in one line, and explain why it makes proof assistants look like programming languages.
6. Name two real systems that carry machine-checked proofs, and one reason the (very large) cost was justified for each.
7. Your team is building a standard e-commerce site. Should you verify it with Coq? Defend your answer in one sentence.

<details>
<summary>Answers</summary>

1. A **test** establishes correctness on *one chosen input*; a **property test** finds no counterexample across *N random inputs*; a **proof** establishes correctness for *all inputs, forever*, by reasoning rather than running.
2. For **all** lists `xs` — infinitely many, with no exceptions. That total coverage is exactly what a proof buys over a test.
3. A **dependent type** is a type that depends on a *value*. `List<int>` says "integers, some length"; the dependent type `Vector int 3` says "integers, *exactly 3 of them*" — the value `3` is part of the type, so the compiler can enforce the length.
4. The type `Vector α (n + 1)` means "length is at least 1," i.e. *provably non-empty*. A possibly-empty vector does not have that type, so the call doesn't type-check. It's good because "first element of an empty list" — a classic runtime crash — becomes a *compile-time error* you can't ship.
5. **A proposition is like a type and a proof is like a program of that type.** Because proving a theorem *is* writing a program with the theorem as its type, the same language and the same type-checking mechanism handle both — so a proof assistant *is* a programming language.
6. **CompCert** (a C compiler proven not to miscompile — justified because a compiler bug could silently corrupt safety-critical software) and **seL4** (a microkernel proven to match its spec — justified because it runs where failure is catastrophic, e.g. aviation/defence). Either of these, with its reason, is a correct answer.
7. **No.** The cost of proof would dwarf the project and a bug's cost is low (a re-deploy); tests and property tests are the right, proportionate rung for ordinary web software.

</details>

---

## Cheat Sheet

```
THE COVERAGE LADDER (cheap → expensive, weak claim → strong claim)
  example test      → "works on THIS input"                    (tiny cost)
  property test     → "no counterexample in N random inputs"   (low)
  contract/assert   → "we CATCH a violation at runtime"        (low)
  model checking    → "no violation in all model states"       (medium)
  PROOF ASSISTANT   → "correct for ALL inputs, FOREVER"        (VERY high)

WHAT A PROOF ASSISTANT IS
  you state a theorem  →  you build a proof (via tactics)  →  the MACHINE checks it
  if accepted: true with mathematical certainty (matches the spec)
  tools: Coq/Rocq · Isabelle/HOL · Lean · Agda

DEPENDENT TYPES (a type that depends on a VALUE)
  List<int>        "integers, length unknown"
  Vector int 3     "exactly 3 integers — length is in the type"
  payoff:          empty-list / out-of-bounds bugs → COMPILE errors

CURRY–HOWARD
  a PROPOSITION  ≈  a TYPE
  a PROOF        ≈  a PROGRAM of that type
  → proving = programming = the same type-check

PROVEN-IN-THE-WILD
  CompCert  = C compiler proven not to miscompile
  seL4      = OS microkernel proven to match its spec (~20 person-years)

WHEN TO USE IT
  bug is CATASTROPHIC (compiler, kernel, crypto, aerospace, $$$ contract)? → maybe
  bug means a re-deploy and an apology (CRUD, most apps)?                  → NO, test it
```

---

## Summary

- A **proof assistant** (interactive theorem prover) lets you state a precise claim about code and build a **proof** the *machine* checks step by step. If accepted, the claim is true with mathematical certainty — **for all inputs, forever** — because it is established by *reasoning*, not by *running*.
- This is the **top of the verification ladder**: example test → property test → contract → model checking → **proof**. Each rung trades more coverage for more cost. Proof has the strongest claim and by far the highest price.
- **Dependent types** let a type *depend on a value* — `Vector n` is "a list of exactly `n` elements." This pushes runtime invariants (non-empty, in-bounds) up into the type, turning whole classes of bug into *compile-time errors*.
- **Curry–Howard** is the unifying idea: *a proposition is like a type, a proof is like a program of that type.* Proving and programming become one activity — which is why these tools look like programming languages with extraordinarily expressive types.
- The cost is the headline. Proofs are **hard, slow, specialist, and need re-doing when code changes** — seL4 took roughly **20 person-years**. So proof assistants are reserved for the rare, critical core (compilers like **CompCert**, kernels like **seL4**, crypto, aerospace) where a bug is genuinely unacceptable.
- Junior takeaway: proof assistants give **absolute certainty for a tiny, critical slice of software, at a very high cost**. Know they exist, know what they've achieved (CompCert, seL4), know it is the **heavy artillery you rarely need** — and know that choosing a cheaper rung for ordinary software is the *correct* engineering call.

---

## Further Reading

- *Software Foundations* (Pierce et al.) — the gold-standard, free, online course that teaches logic, proof, and Coq together from zero. The gentlest serious on-ramp.
- *Theorem Proving in Lean 4* — the official Lean book; and the **Natural Number Game** (an interactive browser game) — the single friendliest first taste of building a proof, no install required.
- **CompCert** project overview page and the *Csmith* / "Finding and Understanding Bugs in C Compilers" paper — the source of "found bugs in every compiler except CompCert's verified core."
- **seL4** project overview ("the world's first verified OS kernel") — a readable summary of *what* was proven and *what it cost*.
- The [middle.md](middle.md) of this topic, which moves from this conceptual tour to actually reading proof scripts, the role of tactics and the SMT-backed middle ground, and how proof effort is structured in practice.

---

## Related Topics

- [01 — Formal Specification](../01-formal-specification/junior.md) — the *spec* is the thing you prove the code matches; a proof is only as good as the spec behind it.
- [04 — Property & Contract Verification](../04-property-and-contract-verification/junior.md) — the rung *just below* proof: "for all inputs" thinking at a fraction of the cost.
- [02 — Model Checking](../02-model-checking/junior.md) — the other exhaustive technique: checks *all states of a model* rather than reasoning about all inputs of the code.
- [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/junior.md) — the cost/benefit judgement: when "verify the core, test the rest" justifies this heavy artillery.
- [Testing](../../testing/) — where almost all software lives: the cheap, sampling-based rungs you'll use every day.
