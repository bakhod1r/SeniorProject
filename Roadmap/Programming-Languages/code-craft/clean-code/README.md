# Clean Code Roadmap

> **Source:** *Clean Code: A Handbook of Agile Software Craftsmanship* (2008) — Robert C. Martin ("Uncle Bob"), with chapters by Michael Feathers, Tim Ottinger, Jeff Langr, Brett L. Schuchert, James Grenning, Kevin Dean Wampler. Extended with modern topics not in the original book.

> *"Clean code reads like well-written prose. It should be elegant, efficient, focused, and free of unnecessary complexity."* — Robert C. Martin

> ⚠️ Read [Criticisms of Clean Code](00-criticisms.md) first if you're a senior reader — *Clean Code* is influential but not unchallenged. Apply the rules with judgement, not reflex.

---

## Why This Roadmap

*Refactoring* answers **"how do I fix existing bad code?"** — *Clean Code* answers **"how do I avoid writing it in the first place?"** Together with [Design Patterns](../design-patterns/README.md) (proven structural solutions) and [Refactoring](../refactoring/README.md) (smells + cures), this completes the trio of post-language craftsmanship.

| Roadmap | Question it answers |
|---|---|
| [Design Patterns](../design-patterns/README.md) | What structure should I reach for? |
| [Refactoring](../refactoring/README.md) | How do I fix code that already smells? |
| **Clean Code** (this) | How do I write code that doesn't smell in the first place? |

---

## Core Chapters (from the book)

| # | Chapter | Focus |
|---|---|---|
| [01](01-meaningful-names/README.md) | Meaningful Names | Intention-revealing, pronounceable, searchable, unambiguous |
| [02](02-functions/README.md) | Functions | Small, one level of abstraction, few arguments, no side effects |
| [03](03-comments/README.md) | Comments | When they help, when they lie, what to delete |
| [04](04-formatting/README.md) | Formatting | Vertical density, horizontal limits, team rules |
| [05](05-objects-and-data-structures/README.md) | Objects & Data Structures | Tell-don't-ask, Law of Demeter, DTOs, hybrids |
| [06](06-error-handling/README.md) | Error Handling | Exceptions over codes, no nulls, wrap third-party APIs |
| [07](07-boundaries/README.md) | Boundaries | Isolating third-party code, learning tests |
| [08](08-unit-tests/README.md) | Unit Tests | F.I.R.S.T., one assert per test, the TDD rhythm |
| [09](09-classes/README.md) | Classes | SRP at class scope, cohesion, organizing for change |
| [10](10-emergence/README.md) | Emergent Design | Kent Beck's four rules: tests pass, no duplication, expressive, minimal |
| [11](11-concurrency/README.md) | Concurrency | SRP for threads, limit shared scope, copy-on-write, server-thread independence |

> Chapters 12–17 of the original book (successive refinement, JUnit internals, case studies, *Smells and Heuristics*) are intentionally **not** duplicated — the smells catalog already lives in [Refactoring → Code Smells](../refactoring/01-code-smells/README.md), and the case studies are a learning vehicle rather than a reference topic.

---

## Modern Extension Chapters (beyond the book)

*Clean Code* was written in 2008. These chapters cover topics it pre-dates or under-treats — kept consistent with the same 8-file-suite style.

| # | Chapter | Focus |
|---|---|---|
| [12](12-async-and-functional/README.md) | Async & Functional | async/await, promises, functional pipelines, backpressure |
| [13](13-generics-and-types/README.md) | Generics & Types | Type expressiveness, "make illegal states unrepresentable" |
| [14](14-immutability/README.md) | Immutability | Value objects, persistent data structures, mutability as the new goto |
| [15](15-pure-functions/README.md) | Pure Functions | Referential transparency, side-effect quarantine |
| [16](16-defensive-vs-offensive/README.md) | Defensive vs Offensive | Assertions, contracts, fail-fast vs fail-safe |
| [22](22-abstraction-and-information-hiding/README.md) | Abstraction & Information Hiding | Deep vs shallow modules, information leakage, "complexity = dependencies + obscurity" |
| [23](23-configuration-and-feature-flags/README.md) | Configuration, Constants & Feature Flags | Named constants, single source of truth, fail-fast config, retiring flags |

---

## Practice & Meta Chapters

*Clean code is not only about code shape — it is also about the disciplines that produce and preserve it.* These chapters cover the **practice** of clean code: how teams enforce it, observe it, structure it, measure it, and maintain it over time.

| # | Chapter | Focus |
|---|---|---|
| [17](17-code-reviews/README.md) | Code Reviews | Reviewer/author etiquette, nits vs blockers, review tempo, small-PR culture, discipline of clean reviews |
| [18](18-logging-and-diagnostics/README.md) | Logging & Diagnostics | Structured logging, log levels, PII scrubbing, "log once at the boundary" |
| [19](19-modules-and-packages/README.md) | Modules & Packages | Public/private boundary, circular deps, layering, package-by-feature |
| [20](20-cognitive-load/README.md) | Cognitive Load | Cyclomatic/cognitive complexity metrics, rule of 7±2, measuring "clean" |
| [21](21-boy-scout-rule/README.md) | Boy Scout Rule | "Leave it cleaner than you found it" — incremental, continuous cleanup as habit |
| 24 | Documentation & ADRs → *moved* | Now its own section: [code-craft/documentation](../documentation/README.md) |
| [25](25-clean-commits-and-version-control/README.md) | Clean Commits & VCS Hygiene | Atomic commits, intent-revealing messages, bisectable history |

---

## Supplementary Materials

| Resource | What it is |
|---|---|
| [Criticisms of Clean Code](00-criticisms.md) | Counter-arguments — Ousterhout, Muratori, empirical critiques. Read before applying every rule reflexively. |
| [Naming Recipes](01-meaningful-names/naming-recipes.md) | Reusable name templates for booleans, async, collections, domain types, tests, errors, builders, events |
| Per-chapter `README.md` | Chapter index — currently carries the anti-patterns checklist until the full 8-file suite lands (21 files, one per chapter) |
| [Pre-Commit Checklist](checklists/pre-commit.md) | Quick walk-through before staging — distilled from all chapters |
| [PR Review Checklist](checklists/pr-review.md) | Design-level review beyond the line-by-line pre-commit pass |

---

## How to Use This Roadmap

Each chapter is delivered as an **8-file suite**, identical to the [Refactoring](../refactoring/README.md) and [Design Patterns](../design-patterns/README.md) sections, indexed by a chapter `README.md` that also holds the anti-patterns checklist:

| File | Focus | Audience |
|---|---|---|
| `README.md` | Chapter index + anti-patterns checklist (what NOT to do) | Reference |
| `junior.md` | "What is the rule?" "What's a clean example?" | Just learned the language |
| `middle.md` | "Why?" "When does the rule bend?" Trade-offs | 1–3 yr experience |
| `senior.md` | Team scale — style guides, linters, code review heuristics | 3–7 yr experience |
| `professional.md` | Cognitive science of readability, runtime cost of "clean" patterns, exceptions to every rule | 7+ yr / specialist |
| `interview.md` | 50+ Q&A — "what makes a function clean?", "when is a comment justified?" | Job preparation |
| `tasks.md` | 10+ "rewrite this code to be clean" exercises with solutions | Practice |
| `find-bug.md` | 10+ snippets with clean-code violations to spot | Critical reading |
| `optimize.md` | 10+ "clean but slow" pieces to reconcile with performance | Performance practice |

**Recommended order:** `README.md` for the anti-patterns lens → `junior.md` → `middle.md` → `senior.md` → `professional.md` → practice files → `interview.md` for review.

---

## Languages

All examples in three languages — **Go**, **Java**, **Python** — to highlight idiomatic differences:

- **Go** — no exceptions, no classes, `gofmt` enforces formatting — many *Clean Code* rules look different (or vanish)
- **Java** — the canonical *Clean Code* language; rules apply most directly
- **Python** — duck typing and first-class functions simplify several rules; PEP 8 covers formatting

Comparing the same principle across all three shows what is *universal* in clean code (intention, cohesion, simplicity) versus what is *Java-specific* (exception hierarchies, getter/setter discipline).

---

## Status

### ✅ Core Chapters — 11/11 (8-file suites)
- ✅ Meaningful Names
- ✅ Functions
- ✅ Comments
- ✅ Formatting
- ✅ Objects & Data Structures
- ✅ Error Handling
- ✅ Boundaries
- ✅ Unit Tests
- ✅ Classes
- ✅ Emergent Design
- ✅ Concurrency

### 🚧 Modern Extension Chapters — 5/7
- ✅ Async & Functional
- ✅ Generics & Types
- ✅ Immutability
- ✅ Pure Functions
- ✅ Defensive vs Offensive
- ⬜ Abstraction & Information Hiding
- ⬜ Configuration, Constants & Feature Flags

### 🚧 Practice & Meta Chapters — 4/7
- ✅ Code Reviews
- ✅ Logging & Diagnostics
- ✅ Modules & Packages
- ✅ Cognitive Load
- ⬜ Boy Scout Rule
- ⬜ Documentation & ADRs
- ⬜ Clean Commits & Version-Control Hygiene

### ⏳ Supplementary — PENDING
- ⬜ Criticisms of Clean Code
- ⬜ Naming Recipes
- ⬜ Per-chapter README + anti-patterns (25)
- ⬜ Pre-Commit Checklist
- ⬜ PR Review Checklist

---

## References

- **Primary:** *Clean Code: A Handbook of Agile Software Craftsmanship* (2008) — Robert C. Martin
- **Companion:** *The Clean Coder* (2011) — same author, discipline and professionalism rather than code
- **Companion:** *Clean Architecture* (2017) — same author, architectural scale (covered separately in [Software Architecture](../../../Architecture/software-design-architecture/))
- **Counterpoint:** *A Philosophy of Software Design* — John Ousterhout (Stanford) — argues against some of *Clean Code*'s rules (especially short functions); worth reading for balance. See [Criticisms](00-criticisms.md).
- **Companion roadmap:** [Refactoring](../refactoring/README.md) — code smells and the techniques that resolve them
- **Companion roadmap:** [Design Patterns](../design-patterns/README.md) — proven structural solutions

---

## Project Context

This roadmap is part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
