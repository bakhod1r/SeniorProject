# Documentation Roadmap

> *"Documentation is a love letter that you write to your future self."* — Damian Conway

This roadmap is about **engineering documentation as a craft** — the docs an engineer writes and maintains as part of building software: docstrings, READMEs, API references, ADRs, design docs, runbooks, and the tooling that keeps them all alive. It is the *how-to-document-your-work* discipline, not a writing career.

> Not what you're looking for?
> - The **technical-writing career** (content strategy, marketing, distribution) → [Soft-Skills → Technical Writer](../../../Soft-Skills/technical-writer/).
> - **Measuring** doc quality (coverage, freshness metrics, gates) → [Quality Engineering → Documentation Quality](../../quality-engineering/documentation-quality/).
> - In-code **comments** specifically → [Clean Code → Comments](../clean-code/03-comments/).

---

## Why a Dedicated Roadmap

Code says *what* it does; documentation says *why it exists, how to use it, and what we decided and rejected*. That second layer is what lets a team scale past the people who wrote the code. Yet documentation is the most consistently neglected engineering skill — not because engineers can't write, but because nobody taught them *what* to document, *where* it belongs, and *how* to keep it from rotting. This roadmap is that missing curriculum.

| Roadmap | Question it answers |
|---|---|
| [Clean Code → Comments](../clean-code/03-comments/) | When should code explain itself in a comment? |
| [Soft-Skills → Technical Writer](../../../Soft-Skills/technical-writer/) | How do I build a career and audience as a writer? |
| **Documentation** (this) | What does an engineer document, where, and how do I keep it alive? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-why-and-what-to-document/) | Why & What to Document | The documentation spectrum, audiences, the cost of too much vs too little |
| [02](02-code-comments-and-docstrings/) | Code Comments & Docstrings | Intent over mechanics, API docstrings, doc generators (cross-links Clean Code → Comments) |
| [03](03-readmes-and-onboarding-docs/) | READMEs & Onboarding | The README as a front door; getting-started, setup, contribution guides |
| [04](04-api-and-reference-documentation/) | API & Reference Docs | Reference vs guides, OpenAPI, generated docs, examples that run |
| [05](05-architecture-decision-records-adrs/) | Architecture Decision Records | Capturing *why* — ADR format, when to write one, superseding decisions |
| [06](06-design-docs-and-rfcs/) | Design Docs & RFCs | Pre-build alignment, the design-doc template, the RFC review process |
| [07](07-runbooks-and-operational-docs/) | Runbooks & Ops Docs | On-call runbooks, incident playbooks, operational knowledge that saves the 3 a.m. page |
| [08](08-diagrams-as-code/) | Diagrams as Code | Mermaid, C4, PlantUML — version-controlled, reviewable diagrams |
| [09](09-changelogs-and-release-notes/) | Changelogs & Release Notes | Keep a Changelog, semver, human vs machine notes, conventional commits |
| [10](10-docs-as-code-and-tooling/) | Docs as Code & Tooling | Docs in the repo, linting, link-checking, versioned docs sites, CI for docs |
| [11](11-keeping-docs-alive-and-doc-rot/) | Keeping Docs Alive | Fighting doc rot, single source of truth, docs that live next to the code they describe |

---

## Scope & Deduplication

| Looks similar to | But here we cover | Lives in |
|---|---|---|
| `05-architecture-decision-records-adrs` | ADRs as an engineering practice | supersedes the stub at [Clean Code → 24](../clean-code/24-documentation-and-adrs/) |
| `02-code-comments-and-docstrings` | docstrings & doc generation | inline comment *style* → [Clean Code → Comments](../clean-code/03-comments/) |
| `04-api-and-reference-documentation` | reference docs as a craft | API-doc *tooling* → [Backend → API Documentation Tools](../../../Backend/api-design/05-api-documentation-tools/) |
| whole roadmap | the engineer's documentation practice | the *writing career* → [Soft-Skills → Technical Writer](../../../Soft-Skills/technical-writer/) |

> **Note:** [Clean Code → 24 Documentation & ADRs](../clean-code/24-documentation-and-adrs/) is a single stub topic that this section supersedes. Recommend converting it to a pointer here (left as-is for now to preserve clean-code numbering).

---

## Status

Skeleton — topic folders are scaffolded; content is written per topic following the Code Craft file convention. All content in **English**.
