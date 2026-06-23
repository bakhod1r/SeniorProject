# Code Review

> *"The reviewer's job is not to write the code, but to ensure the code that ships is worth shipping."*

This roadmap is about **the engineering discipline of reading other people's code** — what to look for, in what order, what to flag, what to defer, what to trust the tooling for, and how to give feedback that improves the change without drowning the author. It is the *technical* half of review; its human half lives next door.

> Looking for *the soft-skills and communication side of review* (tone, mentorship, navigating disagreement, the per-aspect review checklists)? See [Soft-Skills → Code Review](../../../Soft-Skills/code-review/). This section assumes you can be kind and asks *what a technically excellent reviewer actually looks at.*
>
> Looking for *style rules that should never be a review comment*? See [Static Analysis & Linting](../static-analysis/) — let the linter own those, so humans review what only humans can.
>
> Looking for *the policy that requires review at all* (required approvals, CODEOWNERS, merge queues)? See [Quality Gates → Branch Protection](../quality-gates/).

---

## Why a Dedicated Roadmap

Code review is the highest-leverage quality activity most teams have, and the one most often done by reflex. A reviewer who knows *what to look at first*, *what to trust the tooling for*, and *what only a human can catch* produces dramatically better outcomes than one who reads top-to-bottom and comments on whatever catches the eye. Done well, review catches defects, spreads knowledge, and keeps the codebase coherent; done badly, it's a latency tax that rubber-stamps bugs while bikeshedding semicolons. This roadmap treats review as a skill with an **order of operations**, a **bug-pattern hunt**, and a **feedback craft** — not a vibe.

| Roadmap | Question it answers |
|---|---|
| [Static Analysis & Linting](../static-analysis/) | What can a machine catch before review even starts? |
| [Testing](../testing/) | Does the code prove it works? |
| [Quality Gates](../quality-gates/) | *Who* must approve, and on what evidence? |
| **Code Review** (this) | Is this the right change, correctly built, that a future maintainer can live with — and how do I say so usefully? |

---

## Sections

Each topic ships the full five-tier set — **junior / middle / senior / professional / interview**.

| # | Topic | Focus |
|---|---|---|
| [01](01-what-to-look-for-and-order/) | What to Look For & In What Order | Review's real goals (defects, design, knowledge) vs what it's *not* (style policing); the order of operations — correctness → design → tests → style; read-the-tests-first; the diff vs the change (when to pull and run the branch) |
| [02](02-pr-scope-and-size/) | PR Scope & Size | Why small PRs review better (the size→defect/latency curve); splitting a large change; stacked PRs/diffs; scope creep; draft PRs; "this PR does too much" feedback |
| [03](03-correctness-and-design-review/) | Correctness & Design Review | The bug-pattern hunt (concurrency hazards, off-by-one, swallowed errors, nil derefs, resource leaks, edge cases) and design feedback — spotting the wrong shape early, before weeks are sunk; API & invariant review |
| [04](04-security-and-performance-review/) | Security & Performance Review | What to flag by reading — input validation, missing authz, injection, secret leakage, unsafe deserialization (security); N+1, hot-loop allocation, accidental O(n²) (performance) — vs what must wait for a tool or benchmark |
| [05](05-feedback-giving-and-receiving/) | Giving & Receiving Feedback | The mechanics of *technically useful* feedback — specific, actionable, severity-labelled (nit/suggestion/blocking), rationale-backed, ask-don't-tell, code suggestions; self-review first; responding to review well |
| [06](06-review-tooling-and-automation/) | Review Tooling & Automation | Let the machine own the mechanical — linters/formatters, CI gates before a human looks, PR templates, CODEOWNERS, suggested changes, preview envs, reviewdog/Danger, coverage bots, AI-assisted review; async vs synchronous review |
| [07](07-review-metrics-and-tempo/) | Review Metrics & Tempo | Time-to-first-review and review latency as flow metrics; reviewer workload (how many/day before quality collapses, the LGTM-without-reading failure); SLAs, WIP, batching — and Goodhart on review metrics |
| [08](08-review-anti-patterns/) | Review Anti-patterns | Bikeshedding (let the linter), rubber-stamping, blocking on personal preference, ego/nitpick comments, scope creep via "could you also…", design feedback that arrives too late, gatekeeping — and the fixes |

---

## Languages

The discipline of review is largely **language-agnostic** — the order of operations and the bug-pattern hunt apply everywhere. What shifts is the *priority list*: memory safety and lifetime correctness dominate C++ and `unsafe` Rust review; error wrapping and context propagation dominate Go review; async cancellation and `Send`/`Sync` correctness dominate Rust-async and Node review; mass assignment and ORM N+1 dominate Ruby/Python web review. The core skill — knowing what to look at first and what to ignore — transfers.

---

## Sources & Vocabulary

Grounded in: **Winters, Manshreck & Wright** — *Software Engineering at Google* (the code-review chapters — the single best published treatment, incl. "LGTM", attention to the *author*, and size data); the **Google Engineering Practices** "Code Review Developer Guide" (what to look for, speed of reviews, how to write comments — public and definitive); **Steve McConnell** — *Code Complete* (collaborative construction, inspection data); **Michael Lynch** — *How to Do Code Reviews Like a Human*; SmartBear/Cisco review-effectiveness data (the ~400-LOC and ~60-min review-fatigue findings); the DORA finding that *lightweight, in-team* review beats heavyweight external approval.

---

## Status

✅ **Content-complete.** All 8 topics are written across the full five-tier set (junior / middle / senior / professional / interview): 40 topic files in total.

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place. Sits in [Quality Engineering](../) as the human-judgement gate above [Static Analysis](../static-analysis/) and [Testing](../testing/); its policy layer is [Quality Gates](../quality-gates/), and its communication half is [Soft-Skills → Code Review](../../../Soft-Skills/code-review/).
