# Code Quality Metrics

> *"Not everything that can be counted counts, and not everything that counts can be counted."* — often attributed to William Bruce Cameron

This roadmap is about the **numbers people attach to code quality** — cyclomatic and cognitive complexity, maintainability index, coupling and cohesion, churn and hotspots, duplication — what each one actually measures, how it's computed, where the threshold should sit, and the ways every one of them lies if you stare at it too hard.

> Looking for *what to DO about a bad number*? See [Technical Debt Management](../technical-debt-management/) (prioritizing and paying down) and [Code Craft → Refactoring](../../code-craft/refactoring/) (the mechanics of fixing it).
>
> Looking for *coverage* specifically? It has its own roadmap: [Code Coverage](../code-coverage/).
>
> Looking for *team/delivery* metrics (lead time, deploy frequency)? See [Engineering Metrics & DORA](../engineering-metrics-and-dora/) — this roadmap is about the *code*, not the *process*.

---

## Why a Dedicated Roadmap

Every quality tool ships a dozen metrics, every dashboard graphs them, and almost nobody can say precisely what cyclomatic complexity counts, why the maintainability index has a magic constant of 171 in it, or why a file with low complexity can still be the worst code in the system. The metrics are useful — as *diagnostics that point at risk* — and dangerous — as *targets that get gamed*. Treating them as a discipline forces three separate questions: **what does this number measure**, **how is it computed**, and **what decision should it actually drive** (usually: "go look at this file," never "your grade is a B").

| Roadmap | Question it answers |
|---|---|
| [Code Coverage](../code-coverage/) | Which code did my tests exercise? |
| [Technical Debt Management](../technical-debt-management/) | Which problems do I fix, when, and how do I justify it? |
| **Code Quality Metrics** (this) | How do I *measure* the internal quality of the code itself — and what do those numbers really mean? |

---

## Sections

Each topic ships the full five-tier set — **junior / middle / senior / professional / interview**.

| # | Topic | Focus |
|---|---|---|
| [01](01-cyclomatic-and-cognitive-complexity/) | Cyclomatic & Cognitive Complexity | McCabe's V(G), basis paths, decision points; SonarSource cognitive complexity (nesting penalties); thresholds and where each metric misleads |
| [02](02-maintainability-index/) | Maintainability Index | The Halstead + cyclomatic + LOC composite, the `171` formula and VS's 0–100 rescale; why composite indices are seductive and weak |
| [03](03-coupling-and-cohesion-metrics/) | Coupling & Cohesion Metrics | Afferent/efferent coupling, instability, abstractness, the main sequence (Martin metrics); LCOM cohesion; fan-in/fan-out |
| [04](04-code-churn-and-hotspots/) | Code Churn & Hotspots | Churn from version control, the churn × complexity hotspot, change/temporal coupling; why history predicts defects better than a static snapshot |
| [05](05-duplication-and-similarity/) | Duplication & Similarity | Clone types 1–4, token/AST detection (CPD, jscpd, Simian), the duplication %, DRY vs the rule of three vs AHA |
| [06](06-code-health-dashboards/) | Code Health Dashboards | Aggregating metrics into SonarQube ratings / CodeScene / Code Climate views; trends over absolutes, risk-weighting, and not turning the dashboard into a target |

---

## Sources & Vocabulary

Grounded in the literature: **Thomas McCabe** (cyclomatic complexity, 1976), **Maurice Halstead** (software science / volume & effort), **G. Ann Campbell / SonarSource** (cognitive complexity), **Robert C. Martin** (package coupling/cohesion metrics, the main sequence), **Chidamber & Kemerer** (the CK OO metrics suite, LCOM), **Nagappan & Ball** (churn predicts defect density, Microsoft Research), **Adam Tornhill** — *Your Code as a Crime Scene* / *Software Design X-Rays* (behavioral hotspots), and the **SQALE** model behind SonarQube's ratings.

---

## Status

✅ **Content-complete.** All 6 topics are written across the full five-tier set (junior / middle / senior / professional / interview): 30 topic files in total.

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place. Sits in [Quality Engineering](../) alongside [Code Coverage](../code-coverage/), [Technical Debt Management](../technical-debt-management/), [Performance](../performance/), and [Build Systems](../build-systems/).
