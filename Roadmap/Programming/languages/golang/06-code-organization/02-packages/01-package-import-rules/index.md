---
layout: default
title: Package Import Rules
parent: Packages
grand_parent: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/06-code-organization/02-packages/01-package-import-rules/
---

# Package Import Rules

[← Back](../)

We explore how Go resolves and uses imports: import paths, named and blank/dot aliases, the `internal/` visibility boundary, the prohibition of cyclic dependencies, and the deterministic `init` order. These rules shape every Go program's compile graph and runtime startup.

## Sub-pages

- [junior.md](junior.md) — Beginner walk-through of import paths, aliases, blank/dot, and `internal/`
- [middle.md](middle.md) — Resolution algorithm, `init` order, vendor mode, build tags, `goimports`
- [senior.md](senior.md) — Design-level concerns: cycles, layering, blast radius, future-proofing
- [professional.md](professional.md) — Toolchain internals, type-checker view, plugin patterns, programmatic AST manipulation
- [specification.md](specification.md) — Language spec text on imports plus `cmd/go` conventions
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken-import scenarios
- [optimize.md](optimize.md) — Compile-time and workflow optimization exercises
