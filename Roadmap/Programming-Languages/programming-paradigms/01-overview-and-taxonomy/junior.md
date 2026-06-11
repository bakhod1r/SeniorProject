# Overview & Taxonomy — Junior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Overview & Taxonomy
> *A paradigm is not a language and not a feature — it's a way of thinking about what a program* is*.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What a Paradigm Actually Is](#core-concept-1--what-a-paradigm-actually-is)
5. [Core Concept 2 — The Imperative ↔ Declarative Spectrum](#core-concept-2--the-imperative--declarative-spectrum)
6. [Core Concept 3 — The Four You'll Meet First](#core-concept-3--the-four-youll-meet-first)
7. [The Same Problem in Four Paradigms](#the-same-problem-in-four-paradigms)
8. [Where OOP and FP Fit](#where-oop-and-fp-fit)
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

> Focus: **What is it, and why does it matter?**

You already know how to write code. You can declare variables, write loops, call functions, maybe define classes. So here is a question that sounds simple but isn't:

> **When you write a program, what do you think the program *is*?**

A list of steps the computer follows in order? A set of objects sending each other messages? A description of *what answer you want*, leaving the *how* to the machine? Each of those answers is a **paradigm** — a different mental model of what a program fundamentally is. None of them is "the real one." They are different lenses, and each lens makes some problems easy and others awkward.

Most people learn exactly one paradigm by accident — usually imperative-with-some-objects, because that's what their first language pushed them toward — and then assume that's just *what programming is*. This page exists to break that assumption. By the end you'll be able to look at a piece of code and name the paradigm it's written in, and you'll understand the single most important axis along which paradigms differ: **how much you say about *how*, versus how much you say about *what*.**

> **The mindset shift:** stop seeing "programming" as one thing. Start seeing it as a small set of fundamentally different ways to structure computation — and start noticing which one a given piece of code is using.

---

## Prerequisites

- **Required:** You can read basic code in at least one language (variables, loops, functions). Examples use **Python**, **SQL**, and a little **Go**.
- **Required:** You've written a loop that builds up a result (a sum, a filtered list).
- **Helpful:** You've written an SQL query, or used `map`/`filter`, or defined a class — any of these is a hook for a paradigm you'll see named here.
- **Not required:** Any prior theory. This is the entry point of the whole roadmap; everything else builds on the map drawn here.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Paradigm** | A fundamental style of structuring computation — what the building blocks are and how state and control are handled. |
| **Imperative** | You write the **steps**: do this, then that, change this variable. The program is a sequence of commands. |
| **Declarative** | You write the **goal**: describe the result you want; let the system figure out the steps. |
| **Procedural** | Imperative code organized into reusable procedures (functions). |
| **Object-oriented (OOP)** | Structure the program as objects that bundle data with the behavior that acts on it. |
| **Functional (FP)** | Structure the program as the evaluation of functions over values, avoiding shared mutable state. |
| **State** | Data that can change over time as the program runs (e.g., the value of a variable in a loop). |
| **Control flow** | The order in which things happen — loops, branches, calls, returns. |
| **Multiparadigm** | A language (Python, Rust, Scala) that supports several paradigms at once. |

> The two words to lock in now are **imperative** ("how") and **declarative** ("what"). Almost every distinction in this roadmap is a variation on that one axis.

---

## Core Concept 1 — What a Paradigm Actually Is

A paradigm answers three questions about a program:

1. **What are the basic building blocks?** Statements? Objects? Pure functions? Logical rules? Streams of values?
2. **How is state handled?** Do you mutate variables in place, or produce new values and never change old ones?
3. **How does control flow?** Explicit loops and branches you write by hand, or implicit flow the runtime manages for you (a query engine, an event loop, a solver)?

Two things a paradigm is **not**:

- **A paradigm is not a language.** Python can be written in an imperative style, an OO style, or a functional style. The language permits several; *you* choose one (or mix them) when you write.
- **A paradigm is not a syntax feature.** Having `class` keyword doesn't make code object-oriented, and using a `lambda` doesn't make it functional. Paradigm is about *how you structure the whole solution*, not which keywords appear.

```python
# Same task — sum the even numbers — written two ways in ONE language.

# Imperative style: describe the steps, mutate a running total.
total = 0
for n in numbers:
    if n % 2 == 0:
        total += n

# Functional/declarative style: describe what the result IS.
total = sum(n for n in numbers if n % 2 == 0)
```

Same language, same answer, **two paradigms**. The first says *how to compute it step by step*; the second says *what the result is* and lets Python handle the stepping. That difference — not the syntax — is the paradigm.

---

## Core Concept 2 — The Imperative ↔ Declarative Spectrum

The single most useful idea in this whole topic is that paradigms live on a **spectrum**, not in separate boxes:

```
  IMPERATIVE  ─────────────────────────────────────►  DECLARATIVE
  "how, step by step"                                 "what I want"

  assembly   procedural   OOP        FP        SQL / logic / constraints
  raw loops  functions    objects    pipelines  "find rows where…", "solve for x"
```

- On the **left**, *you* are in charge of every step. You move data, increment counters, decide the exact order. Maximum control, maximum detail, maximum chance to make a mistake in the bookkeeping.
- On the **right**, you describe the *result* and hand the *how* to a system — a SQL engine, a constraint solver, a stream runtime. Less control over the exact steps, far less bookkeeping, often far less code.

Most real paradigms sit *somewhere along* this line, not at the extremes:

| Paradigm | Leans | Why |
|---|---|---|
| Procedural | Imperative | You write the steps, grouped into procedures. |
| OOP | Imperative-ish | Objects still mutate state and you call methods in order. |
| Functional | Toward declarative | You describe transformations (`map`/`filter`), not loop mechanics. |
| SQL / Logic / Constraint | Declarative | You state the goal; an engine finds the path. |

> **Key insight:** "declarative" doesn't mean magic — it means *somebody else wrote the imperative steps once* (the database engine, the solver) so you don't have to write them every time. Declarative code is imperative code that's been hidden behind a good abstraction.

---

## Core Concept 3 — The Four You'll Meet First

Hundreds of paradigms exist, but four account for most code written today. Know these cold:

**1. Imperative / Procedural** — *Do steps in order; group them into procedures.*
The default of C, early Pascal, shell scripts, and the inside of almost every function you've written. State changes as you go.

**2. Object-Oriented (OOP)** — *Bundle data with the behavior that operates on it; model the problem as interacting objects.*
Java, C#, and most "enterprise" code. Has its own full roadmap.

**3. Functional (FP)** — *Compute by applying and composing functions over immutable values; avoid shared mutable state.*
Haskell, Elixir, and the `map`/`filter`/`reduce` style available in nearly every modern language. Has its own full roadmap.

**4. Declarative (incl. logic & query)** — *Describe the desired result; let an engine produce it.*
SQL, HTML/CSS, Prolog, build files, infrastructure-as-code.

These four aren't rivals fighting for the "best" title. They're **tools for different shapes of problem**. A UI layout is naturally declarative (HTML). A tight numeric loop is naturally imperative. A business domain with many entities is often natural in OOP. A data-transformation pipeline is natural in FP. The skill you're starting to build is *recognizing which shape you're looking at*.

---

## The Same Problem in Four Paradigms

> Task: **from a list of orders, get the total revenue of completed orders.**

```python
# 1. IMPERATIVE / PROCEDURAL — write every step, mutate a total.
total = 0
for order in orders:
    if order.status == "completed":
        total += order.amount
```

```python
# 2. FUNCTIONAL — describe the transformation as a pipeline of values.
total = sum(o.amount for o in orders if o.status == "completed")
```

```python
# 3. OBJECT-ORIENTED — ask an object that owns the data to answer.
class OrderBook:
    def __init__(self, orders): self._orders = orders
    def completed_revenue(self):
        return sum(o.amount for o in self._orders if o.status == "completed")

total = OrderBook(orders).completed_revenue()
```

```sql
-- 4. DECLARATIVE (SQL) — state WHAT you want; the engine finds HOW.
SELECT SUM(amount) FROM orders WHERE status = 'completed';
```

Look at what changes across the four:

- **Imperative**: you can see the running total being built, step by step.
- **Functional**: there is no visible loop and no mutable total — just a description of the result.
- **OOP**: the data and the question live together inside an object; you ask the object.
- **Declarative**: you didn't say *how to scan the rows at all* — the database decides (and might use an index you never see).

Every one returns the same number. Choosing between them is a choice about *clarity, control, and who does the bookkeeping* — that's what paradigm selection is.

---

## Where OOP and FP Fit

You'll hear OOP and FP talked about as if they were *the* two paradigms — sometimes even as enemies. Two things to get straight early:

1. **They are two paradigms among many.** This roadmap covers fifteen more — reactive, logic, dataflow, actor-based, array-oriented, and so on. OOP and FP are the most *common*, not the only ones. (They're big enough to have their own dedicated roadmaps: [Object-Oriented Programming](../../object-oriented-programming/) and [Functional Programming](../../code-craft/functional-programming/).)

2. **They are not opposites.** OOP's real axis is *organizing code around data + behavior bundled together*. FP's real axis is *avoiding shared mutable state and computing by composing functions*. You can do both at once — modern Scala, Rust, and Kotlin code routinely bundles data into types (an OO-ish move) while keeping that data immutable and transforming it with pure functions (an FP move). The "OOP vs FP" framing is mostly a culture-war leftover, not a technical law.

> **For now:** slot OOP and FP into your mental map as *two important, widely-used paradigms* — one leaning toward modeling-with-objects, one toward computing-with-pure-functions — and remember the map has many more countries on it.

---

## Real-World Examples

| Thing you've used | Paradigm it's built on |
|---|---|
| A SQL `SELECT` query | Declarative (query) |
| The HTML/CSS of a web page | Declarative (markup) |
| A spreadsheet formula | Declarative / dataflow |
| A `for` loop summing a list | Imperative / procedural |
| `array.map(x => x * 2)` | Functional |
| A `Dockerfile` or `docker-compose.yml` | Declarative |
| A game's update loop moving sprites | Imperative |
| React's "describe the UI for this state" | Declarative |

Notice you already *use* several paradigms daily without naming them. This roadmap's job is mostly to make the implicit explicit, so you can choose on purpose instead of by habit.

---

## Mental Models

- **The recipe vs the order.** Imperative is the *recipe* — every step to make the dish. Declarative is the *order at a restaurant* — "I'll have the salmon"; the kitchen knows the steps. Both get you fed; one makes you do the cooking.
- **The map of countries.** Paradigms are countries on a map. Most engineers grow up in one country and think it's the whole world. Learning the map doesn't mean emigrating — it means knowing where else you *could* go when your home country makes a problem hard.
- **The dial, not the switch.** Imperative ↔ declarative is a dial you turn, not a switch you flip. Real code lands at many points along it, and good engineers turn the dial to fit the problem.

---

## Common Mistakes

- **Thinking a language = a paradigm.** "Python is object-oriented" is wrong; Python *supports* OOP and several others. You pick the paradigm in how you write.
- **Thinking syntax = paradigm.** A `class` keyword doesn't make code OO if it's really one big procedure; a `lambda` doesn't make code functional if it mutates shared state.
- **Treating declarative as magic.** It isn't — the imperative steps still run; someone else (the engine) wrote them. Declarative trades *control* for *brevity*, and that trade isn't always worth it.
- **Believing there's a "best" paradigm.** There's only a best *fit* for a given problem shape. The argument "OOP vs FP, which wins?" has no answer because it's the wrong question.
- **Mixing paradigms by accident instead of on purpose.** Half-imperative, half-functional code that mutates state inside a `map` is usually the worst of both. Choose, then be consistent within a section.

---

## Test Yourself

1. In your own words: what three questions does a paradigm answer about a program?
2. Where does SQL sit on the imperative ↔ declarative spectrum, and *why*?
3. Rewrite this imperative loop in a functional style: `r=[]\nfor x in xs:\n  if x>0: r.append(x*x)`.
4. Is "Python is a functional language" a correct statement? Explain.
5. Give one problem shape that's naturally declarative and one that's naturally imperative.
6. Why is "OOP vs FP" considered the wrong question? What's a better one?

> Try each before reading on. If #2 or #4 is fuzzy, re-read [The Spectrum](#core-concept-2--the-imperative--declarative-spectrum) and [What a Paradigm Is](#core-concept-1--what-a-paradigm-actually-is).

---

## Cheat Sheet

```
PARADIGM = a way of thinking about what a program IS.
It answers:  building blocks?  state handling?  control flow?

THE MAIN AXIS:
  imperative  ── you write HOW (the steps) ──►  declarative (you write WHAT)
  loops/mutation        objects        pipelines        SQL / solvers

THE FIRST FOUR:
  Procedural   steps grouped into functions          (imperative)
  OOP          data + behavior bundled as objects     (own roadmap)
  Functional   compose pure functions, no mutation    (own roadmap)
  Declarative  state the goal, engine finds the path  (SQL, Prolog, IaC)

REMEMBER:
  language ≠ paradigm        syntax ≠ paradigm
  declarative ≠ magic (it's hidden imperative)
  no "best" paradigm — only best FIT for the problem shape
```

---

## Summary

A **paradigm** is a fundamental way of structuring computation — defined by what the building blocks are, how state is handled, and how control flows. The most important axis is **imperative** ("I write the steps") versus **declarative** ("I write the goal"), and most paradigms sit somewhere along that spectrum rather than at its ends. The four you'll meet first are **procedural**, **object-oriented**, **functional**, and **declarative**; they're not rivals but tools matched to different *shapes* of problem. OOP and FP are two important paradigms among many — not opposites, and not the whole map. The skill this roadmap builds is recognizing a problem's shape and reaching for the paradigm that fits, instead of forcing every problem into the one style you happened to learn first.

---

## Further Reading

- Robert W. Floyd, *The Paradigms of Programming* (1978 Turing Award lecture) — the talk that put the word into our vocabulary.
- Peter Van Roy, *Programming Paradigms for Dummies* — a famous one-chapter map of dozens of paradigms and how they relate.
- *Structure and Interpretation of Computer Programs* (SICP), Ch. 1–3 — paradigms taught by building them.
- The [README of this roadmap](../README.md) — the full list of paradigms covered here.

---

## Related Topics

- [02 — Imperative & Procedural](../02-imperative-and-procedural/) — the substrate everything else compiles down to.
- [03 — Declarative Programming](../03-declarative-programming/) — the "what, not how" end of the spectrum, in depth.
- [17 — Multiparadigm in Practice](../17-multiparadigm-in-practice/) — how real languages blend these.
- [Object-Oriented Programming](../../object-oriented-programming/) · [Functional Programming](../../code-craft/functional-programming/) — the two big dedicated roadmaps.
