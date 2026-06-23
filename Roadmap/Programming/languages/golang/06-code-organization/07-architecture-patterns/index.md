---
layout: default
title: Architecture Patterns
parent: Code Organization
grand_parent: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/06-code-organization/07-architecture-patterns/
---

# Architecture Patterns

[← Back](../)

This is the **organization-level** introduction to architecture patterns: layered, hexagonal (ports and adapters), clean, and onion. The focus here is *how each pattern shapes your Go folders, packages, and import graph* — not the theory behind them. For the deeper, dedicated treatment with full case studies, jump to [`19-architecture-patterns/`](../../19-architecture-patterns/).

The goal is for a Go engineer to look at a `cmd/`, `internal/`, and `pkg/` layout and recognise which architectural style it follows, why those rules exist, and when ignoring them is the right call.

## Sub-pages

- [junior.md](junior.md) — What "architecture pattern" means at the file/folder level; tour of layered, hexagonal, clean, and onion with simple Go layouts
- [middle.md](middle.md) — Choosing between styles, mapping each to `cmd/`/`internal/`/`pkg/`, common starter layouts you can copy
- [senior.md](senior.md) — Architecting medium-to-large Go codebases, dependency-direction rules, evolving from layered to hexagonal, knowing when patterns become overhead
- [professional.md](professional.md) — Static analysis enforcement (`go-arch-lint`, `depguard`, custom analyzers), how Go's package system interacts with these patterns, build-time vs runtime checks
- [specification.md](specification.md) — Reference summaries of the original sources: Cockburn's hexagonal, Martin's clean, Palermo's onion, and the layered tradition
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on refactoring exercises, easy → hard
- [find-bug.md](find-bug.md) — Layouts that violate their declared pattern; spot and fix
- [optimize.md](optimize.md) — Simplifying over-architected layouts; deleting indirection that earns nothing
