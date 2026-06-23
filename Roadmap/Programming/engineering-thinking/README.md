# Engineering Thinking Roadmap

> *"The hardest part of software is not writing code. It is deciding what to write, why, and whether the idea in your head survives contact with reality."*

This roadmap is about **the thinking that happens before, around, and between the keystrokes** — the cognitive disciplines that separate someone who can write code from someone who can solve problems with it. Where [Code Craft](../code-craft/README.md) teaches you how to *write* code well, this teaches you how to *reason* well about the problem the code is meant to solve.

> Looking for the *craft* of clean code, refactoring, and patterns? See [Code Craft](../code-craft/README.md).
>
> Looking for *algorithms* themselves (not the thinking behind choosing them)? See [Data Structures & Algorithms](../../Data/datastructures-and-algorithms/).
>
> Looking for *object-oriented* modeling thought (tell-don't-ask, CRC cards)? That now lives here as [08 — Object Thinking](08-object-thinking/). For the broader OO paradigm see [Object-Oriented Programming](../object-oriented-programming/).

---

## Why a Dedicated Roadmap

Most engineering failures are not failures of typing — they are failures of thought: the wrong problem solved correctly, a confident decision built on an unexamined assumption, a local optimization that broke the system, a "rare" edge case that was never rare. None of these are fixed by knowing another language or framework. They are fixed by sharper thinking.

These disciplines are cross-cutting and language-agnostic. They apply equally to a one-line bug fix and a multi-year platform migration, and they compound: an engineer who thinks in feedback loops, base rates, and first principles makes better decisions *every single day*, not just in interviews.

| Roadmap | Question it answers |
|---|---|
| [Code Craft](../code-craft/README.md) | How do I write code that doesn't smell? |
| [Data Structures & Algorithms](../../Data/datastructures-and-algorithms/) | What is the efficient way to compute this? |
| **Engineering Thinking** (this) | How do I reason about the problem before I reach for a solution? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-computational-thinking/) | Computational Thinking | Decomposition, pattern recognition, abstraction, modeling a problem in code |
| [02](02-problem-solving/) | Problem-Solving | Pólya's method — understand, plan, execute, reflect; debugging as inquiry; getting unstuck |
| [03](03-systems-thinking/) | Systems Thinking | Emergence, feedback loops, second-order effects, tradeoffs, leverage points |
| [04](04-critical-thinking/) | Critical Thinking | Claims vs evidence, logical fallacies, cognitive biases, objective tradeoff evaluation |
| [05](05-first-principles-thinking/) | First-Principles Thinking | Reasoning from fundamentals, questioning assumptions, rebuilding from scratch |
| [06](06-probabilistic-thinking/) | Probabilistic Thinking | Reasoning under uncertainty, base rates, expected value, risk and estimation |
| [07](07-creative-and-lateral-thinking/) | Creative & Lateral Thinking | Divergent vs convergent, inversion, analogy, constraint-driven creativity |
| [08](08-object-thinking/) | Object Thinking | Behavior-first mindset, tell-don't-ask, responsibility-driven design, CRC cards, anthropomorphism, when it fails |

---

## How the Sections Relate

The seven disciplines are not a strict sequence — you use them in combination — but they form a rough progression from *narrow* to *broad*:

- **01–02** are about a single problem in front of you: break it down (computational), then work it through (problem-solving).
- **03** widens the lens to the *system* the problem lives in, where parts interact and consequences ripple.
- **04–07** are the *quality controls and idea generators* you apply across all of the above: think critically so you don't fool yourself (04), reason from first principles so you don't cargo-cult (05), reason probabilistically so you don't mistake the likely for the certain (06), and think laterally so you don't miss the better solution entirely (07).

```mermaid
flowchart LR
    P[A problem] --> CT[01 Computational]
    CT --> PS[02 Problem-Solving]
    PS --> ST[03 Systems]
    subgraph cross[Applied across all stages]
        CR[04 Critical]
        FP[05 First-Principles]
        PR[06 Probabilistic]
        CL[07 Creative / Lateral]
    end
    cross -.-> CT
    cross -.-> PS
    cross -.-> ST
```

---

## Scope & Deduplication

This roadmap deliberately stays in the *thinking* lane and defers technique to its proper home:

| Looks similar to | But here we cover | The technique lives in |
|---|---|---|
| `01/03-abstraction-and-generalization` | abstraction *as a way of thinking* | [Clean Code → Abstraction & Information Hiding](../code-craft/clean-code/22-abstraction-and-information-hiding/) |
| `01/04-algorithmic-thinking` | seeing a problem *as* a sequence of steps | [Data Structures & Algorithms](../../Data/datastructures-and-algorithms/) |
| `02/05-debugging-as-problem-solving` | the *mindset* of inquiry under failure | (systematic debugging practice — craft side) |
| `03/05-thinking-in-tradeoffs` | reasoning about competing forces | [Software Architecture](../../Architecture/) decisions |

---

## Status

Skeleton — topic folders are scaffolded; content is written per topic following the Code Craft file convention (`junior.md` → `middle.md` → `senior.md` → `professional.md`, plus practice files). All content in **English**.
