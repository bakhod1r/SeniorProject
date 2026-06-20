# Technical Debt Management

> *"A little debt speeds development so long as it is paid back promptly with a rewriting… The danger occurs when the debt is not repaid. Every minute spent on not-quite-right code counts as interest on that debt."* — Ward Cunningham, who coined the metaphor in 1992.

This roadmap is about the **economics of imperfect code** — naming the gap between the code you have and the code the problem now demands, measuring what that gap costs you, and deciding, deliberately, when to pay it down and when to keep paying the interest.

> Looking for the *mechanics* of cleaning code up? See [Code Craft → Refactoring](../../code-craft/refactoring/) and [Code Craft → Code Smells](../../code-craft/refactoring/01-code-smells/) — this roadmap decides *what* debt to act on and *why*; refactoring is *how*.
>
> Looking for the *gates* that stop debt landing in the first place? See [Quality Gates](../quality-gates/) and [Code Review](../code-review/).
>
> Looking for the *metrics* that make debt visible to leadership? See [Engineering Metrics & DORA](../engineering-metrics-and-dora/).

---

## Why a Dedicated Roadmap

Most engineers can *feel* technical debt — the change that should have taken an hour took three days. Far fewer can **name it precisely, quantify it in money or lead-time, classify it, and argue for paying it down in language a product manager will fund.** That translation — from "this code is gross" to "this debt costs us X and here's the payoff schedule" — is the senior skill this roadmap builds.

The metaphor is also widely *abused*. "Technical debt" has become a label for any code someone dislikes. Cunningham's debt was a **deliberate, well-understood trade-off to ship and learn faster**; treating a tangled mess written out of ignorance as "debt" launders incompetence into a financial decision nobody actually made. Getting the definition right (01) and the quadrant right (03) is what keeps the term meaningful.

| Roadmap | Question it answers |
|---|---|
| [Refactoring](../../code-craft/refactoring/) | *How* do I safely improve this code? |
| [Code Smells](../../code-craft/refactoring/01-code-smells/) | *Where* is the code telling me something's wrong? |
| **Technical Debt Management** (this) | *Which* of those do I fix, *when*, and *how do I justify it*? |

---

## Sections

Each topic ships the full five-tier set — **junior / middle / senior / professional / interview**.

| # | Topic | Focus |
|---|---|---|
| [01](01-what-is-technical-debt/) | What Is Technical Debt | The metaphor done right: principal vs interest, debt vs bugs vs cruft, when debt is rational, what *isn't* debt |
| [02](02-identifying-and-quantifying/) | Identifying & Quantifying | Hotspots (churn × complexity), code smells, SonarQube/SQALE remediation cost, lead-time and defect signals; making the invisible visible |
| [03](03-the-debt-quadrant/) | The Debt Quadrant | Fowler's deliberate/inadvertent × prudent/reckless grid — classifying debt so you respond to each kind differently |
| [04](04-tracking-and-prioritizing/) | Tracking & Prioritizing | Debt registers, the backlog, cost-of-delay / WSJF, paying high-*interest* debt first, "don't fix debt you never touch" |
| [05](05-paying-down-debt/) | Paying Down Debt | The boy-scout rule, strangler fig, dedicated vs continuous vs %-capacity paydown, refactor vs rewrite vs leave, measuring payoff |
| [06](06-preventing-accumulation/) | Preventing Accumulation | Definition of Done, review, quality gates, fitness functions, broken-windows culture, a debt budget that holds the line |

---

## Sources & Vocabulary

Grounded in the canon: **Ward Cunningham** (the original metaphor, OOPSLA '92 and his 2009 clarifying video), **Martin Fowler** (the debt quadrant), **Kruchten, Nord & Ozkaya** — *Managing Technical Debt* (SEI), **Steve McConnell** (debt taxonomy), the **SQALE** method and **SonarQube** debt ratio, **Adam Tornhill** — *Software Design X-Rays* (behavioral hotspots), **Michael Feathers** — *Working Effectively with Legacy Code*, and **Kent Beck** — *Tidy First?*.

---

## Status

✅ **Content-complete.** All 6 topics are written across the full five-tier set (junior / middle / senior / professional / interview): 30 topic files in total.

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place. Sits in [Quality Engineering](../) alongside [Build Systems](../build-systems/) and [Performance](../performance/).
