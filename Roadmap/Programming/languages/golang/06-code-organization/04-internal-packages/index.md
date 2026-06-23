---
layout: default
title: Internal Packages
parent: Code Organization
grand_parent: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/06-code-organization/04-internal-packages/
---

# Internal Packages

[← Back](../)

We explore Go's compiler-enforced `internal/` directory rule — the only language-level mechanism Go provides for hiding code from outside consumers. Knowing how `internal/` interacts with import paths, multi-level trees, and module boundaries is what lets you ship a stable public API without leaking your implementation details.

## Sub-pages

- [junior.md](junior.md) — Beginner intro to `internal/`, what's importable, common patterns
- [middle.md](middle.md) — When to use `internal/`, multi-level trees, refactoring, gotchas
- [senior.md](senior.md) — Architecture, public-API surface, import-graph design, monorepos
- [professional.md](professional.md) — How `cmd/go` enforces the rule, algorithm, history
- [specification.md](specification.md) — The rule from the cmd/go reference, precise wording
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken `internal/` imports
- [optimize.md](optimize.md) — Optimization exercises for visibility and coupling
