# Documentation Quality Roadmap

> *"Documentation is a love letter that you write to your future self." — Damian Conway*

This roadmap is about **docs as an engineering artifact**: docs that get tested, get versioned, get read, and pay back the time spent writing them. The discipline of writing, structuring, and maintaining documentation so it stays correct as the code beneath it changes.

> Looking for *source-level commenting discipline* (when to comment, when not to, comment smells)? See [Clean Code → Comments](../../code-craft/clean-code/03-comments/) and the `code-comments-documentation` skill.
>
> Looking for *technical writing as a soft skill* (clarity, audience, narrative)? See [Soft Skills](../../../Soft-Skills/).
>
> Looking for *API design itself* (resource modelling, status codes, versioning)? Pair this roadmap with the `rest-api-design` skill.

---

## Why a Dedicated Roadmap

Most engineers treat documentation as something they do *after* the real work — and then are surprised when nobody reads it, or worse, when readers act on docs that lie. The fix is to treat docs the same way you treat code: with a structure (Diataxis), a build pipeline (doc-as-code), a test suite (doc tests, link checks), and a review process. This roadmap covers the genres of documentation each project needs, and the tooling that keeps them honest.

| Roadmap | Question it answers |
|---|---|
| [Testing](../testing/) | Does my code work? |
| [Code Review](../code-review/) | Is my code understandable to another human? |
| **Documentation Quality** (this) | Will my code still be understandable, operable, and changeable six months from now? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-docs-as-engineering-discipline/) | Why Docs Are an Engineering Discipline | Docs that aren't tested, drift; treating docs as a code artifact with reviewers, CI, and lifecycle |
| [02](02-diataxis-framework/) | The Diataxis Framework | Tutorial / how-to / reference / explanation — the four kinds, each with its own audience and structure |
| [03](03-code-documentation/) | Code Documentation | Docstrings, javadoc, godoc, rustdoc; when a comment is the right tool, when it is a smell |
| [04](04-api-documentation/) | API Documentation | OpenAPI / Swagger, AsyncAPI, GraphQL schema docs, gRPC reflection, generated SDKs |
| [05](05-runbooks/) | Runbooks | On-call docs, "if this alert fires, do this"; the genre most teams skip until the first 3 AM page |
| [06](06-architecture-decision-records/) | Architecture Decision Records (ADRs) | Capturing *why* a decision was made; the lightweight Nygard format and the ADR log |
| [07](07-readme-driven-development/) | README-Driven Development | Write the README first; the design discipline behind starting with the user-facing story |
| [08](08-doc-testing/) | Doc Testing | `pytest --doctest-modules`, Rust doc tests, executable examples; preventing rot at the example level |
| [09](09-doc-as-code/) | Doc-as-Code | Markdown in repo, MkDocs / Docusaurus / Sphinx; CI builds, link checks, Vale lint, preview deploys |
| [10](10-internal-vs-external-docs/) | Internal vs External Docs | Different audiences, different threat models, different update cadence; what to publish and what to gate |
| [11](11-onboarding-docs/) | Onboarding Docs | The meta-doc; what every new engineer reads in week one and how to keep it true |
| [12](12-anti-patterns/) | Anti-patterns | "The code is self-documenting," doc drift, write-once-never-read README, ADRs degraded into a task tracker, undocumented operational knowledge |

---

## Languages

The discipline is cross-cutting, but each ecosystem ships its own conventions and toolchain:

- **Go** — `godoc` and the Go doc-comment conventions; the `Example` test pattern that doubles as doc and test.
- **Java** — Javadoc, the standard tag vocabulary (`@param`, `@throws`, `@since`), and how doclets compose with the build.
- **Python** — Sphinx, reStructuredText vs Markdown via MyST, Google / NumPy / reST docstring styles, Read the Docs hosting.
- **Rust** — `rustdoc` with executable examples; doc tests run as part of `cargo test`, making rot expensive.
- **JS / TS** — JSDoc as a portable annotation language, TypeDoc for emitting reference sites, TSDoc as the standard tag set.
- **Tooling-agnostic** — Markdown as the universal substrate, MkDocs and Docusaurus for static sites, Vale for prose lint, Mermaid for diagrams in source.

---

## Status

⏳ **Structure defined; content pending.**

---

## References

- *Diataxis* — Daniele Procida ([diataxis.fr](https://diataxis.fr/)) — the framework that gives this roadmap its spine.
- *Docs for Developers: An Engineer's Field Guide to Technical Writing* — Bhatti, Corleissen, Lambourne, Nunez, Waters.
- *The Architecture of Open Source Applications* — Brown & Wilson (eds.) — long-form architectural explanation done well.
- *Google Developer Documentation Style Guide* — the public reference for voice, tone, and tag conventions.
- *Documenting Architecture Decisions* — Michael Nygard (2011) — the original ADR post.
- *README-Driven Development* — Tom Preston-Werner (2010) — the essay that named the practice.

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
