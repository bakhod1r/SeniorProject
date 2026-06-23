---
layout: default
title: Interface Anti-Patterns
parent: Methods & Interfaces
grand_parent: Go
nav_order: 14
has_children: false
permalink: /roadmap/programming-languages/golang/03-methods-and-interfaces/14-interface-anti-patterns/
---

# Interface Anti-Patterns

[← Back](../)

A catalog of **what NOT to do** with Go interfaces. While the previous section described idiomatic interface design, this one collects the recurring mistakes that quietly damage Go codebases: typed-nil bugs, premature abstraction, mock-driven design, header interfaces, pointer-to-interface, interface bloat, and OOP imports from Java/C#. Every section follows the same shape — the bad pattern, why it hurts, and how to refactor it back to idiomatic Go.

## Sub-pages

- [junior.md](junior.md) — The famous typed-nil gotcha, premature abstraction, and over-eager interfaces
- [middle.md](middle.md) — Mock-driven design, header interfaces, pointer-to-interface, interface bloat
- [senior.md](senior.md) — Architectural smells, leaky abstractions, performance cost of bad interfaces
- [professional.md](professional.md) — Damage in large codebases, refactoring strategies, governance
- [specification.md](specification.md) — Formal rules behind the typed-nil gotcha, citing the Go FAQ and Effective Go
- [interview.md](interview.md) — 30+ Q&As, including the mandatory typed-nil deep-dive
- [tasks.md](tasks.md) — Refactor anti-pattern code into idiomatic Go (12-20 exercises)
- [find-bug.md](find-bug.md) — Hunt typed-nil panics, mock explosions, and abstraction debt
- [optimize.md](optimize.md) — How interface anti-patterns hurt performance and how to fix them
