# Documentation Quality

> *"Documentation is a love letter that you write to your future self."* — Damian Conway

This roadmap is the **quality-engineering view of documentation**: not *how to write* a runbook or an ADR, but how to tell whether your docs are actually **good, current, complete, readable, and worth the time** — and how to measure and defend those properties the way you measure code quality.

> Looking for *how to write each genre* — Diátaxis, code comments, API/reference docs, ADRs, runbooks, docs-as-code tooling, fighting doc rot? That's a whole roadmap of its own: **[Code Craft → Documentation](../../code-craft/documentation/)**. This section is its quality-measurement complement — it assumes you can write docs and asks *are they any good, and how would you know?*
>
> Looking for *source-level commenting discipline* (when a comment is a smell)? See [Clean Code → Comments](../../code-craft/clean-code/) and the `code-comments-documentation` skill.

---

## Why a Dedicated Roadmap

Teams pour effort into docs and then have no idea whether it paid off. Is the tutorial actually usable? Are half the code snippets silently broken? What fraction of the public API is undocumented? Is the page nobody reads dead weight or a latent landmine? "We have docs" is not a quality statement — and "90% docstring coverage" is as gameable as 90% code coverage. This roadmap treats documentation the way the rest of [Quality Engineering](../) treats code: with **explicit quality attributes, measurable signals, automated checks, and an honest account of what the numbers do and don't mean.**

| Roadmap | Question it answers |
|---|---|
| [Code Craft → Documentation](../../code-craft/documentation/) | *How* do I write a good README / ADR / runbook / reference? |
| [Code Coverage](../code-coverage/) | Which code did my tests exercise? |
| **Documentation Quality** (this) | Are my docs *good* — accurate, fresh, complete, readable, valuable — and how do I measure it? |

---

## Sections

Each topic ships the full five-tier set — **junior / middle / senior / professional / interview**.

| # | Topic | Focus |
|---|---|---|
| [01](01-what-makes-docs-good/) | What Makes Docs Good | The quality attributes — accuracy, completeness, findability, clarity, audience-fit, currency; quality criteria *per doc type* (the Diátaxis lens) |
| [02](02-testable-and-executable-docs/) | Testable & Executable Docs | Docs that can't lie because they run in CI — doctests, Go testable examples, Rust doc tests, executed snippets, spec-generated API docs |
| [03](03-freshness-and-rot-metrics/) | Freshness & Rot Metrics | Measuring drift — staleness age, review-by dates, broken links, snippets that no longer compile, doc-vs-code divergence; the half-life of a doc |
| [04](04-docs-coverage-and-gaps/) | Docs Coverage & Gaps | Docstring/API coverage tools (interrogate, godoc, JSDoc), coverage of doc *types*, gap analysis — and why "documented" ≠ "good" (the coverage trap again) |
| [05](05-readability-and-information-architecture/) | Readability & Information Architecture | Readability scores (Flesch-Kincaid, Gunning fog) and their limits; plain language; findability, navigation, progressive disclosure, minimalism |
| [06](06-measuring-docs-roi/) | Measuring Docs ROI | The hard one — ticket deflection, time-to-first-success, search-success, self-service rate; attribution, leading vs lagging, and not gaming page views |

---

## Sources & Vocabulary

Grounded in: **Daniele Procida** — Diátaxis ([diataxis.fr](https://diataxis.fr/), the quality-per-genre lens); **Bhatti, Corleissen, Lambourne, Nunez & Waters** — *Docs for Developers*; the **Google Developer Documentation Style Guide** and **Google's "measuring documentation quality"** work; **John Carroll** — minimalism / *The Nurnberg Funnel*; **Rudolf Flesch** / **Robert Gunning** — readability formulas (and their limits on technical prose); the **Write the Docs** community; tooling — **Vale** (prose lint), **interrogate** (Python docstring coverage), **doctest / rustdoc / Go examples** (executable docs), link checkers.

---

## Status

✅ **Content-complete.** All 6 topics are written across the full five-tier set (junior / middle / senior / professional / interview): 30 topic files in total.

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place. Sits in [Quality Engineering](../) alongside [Code Coverage](../code-coverage/), [Code Quality Metrics](../code-quality-metrics/), and [Technical Debt Management](../technical-debt-management/); its writing-craft sibling is [Code Craft → Documentation](../../code-craft/documentation/).
