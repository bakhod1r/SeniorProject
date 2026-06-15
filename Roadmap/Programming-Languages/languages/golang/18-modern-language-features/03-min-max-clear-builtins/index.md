---
layout: default
title: min, max & clear Built-ins
parent: Modern Language Features
grand_parent: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/18-modern-language-features/03-min-max-clear-builtins/
---

# min, max & clear Built-ins

[← Back](../)

We explore the three built-in functions added in Go 1.21: `min` and `max`, which compute the minimum and maximum of one or more values of any ordered type without a function call or generic instantiation, and `clear`, which empties a map or zeroes a slice. Together they replace a decade of hand-rolled helpers, retire a class of NaN-key map bugs, and integrate cleanly with `cmp.Ordered` generics.

## Sub-pages

- [junior.md](junior.md) — What `min`, `max`, and `clear` do, with runnable examples and output
- [middle.md](middle.md) — Type inference, constant folding, NaN/signed-zero edge cases, generics
- [senior.md](senior.md) — Design rationale, math-package contrast, migration, API decisions
- [professional.md](professional.md) — Compiler lowering, spec semantics, performance, tooling
- [specification.md](specification.md) — Formal spec text for `min`, `max`, and `clear`
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken min/max/clear usage
- [optimize.md](optimize.md) — Replacing helpers, reducing allocations, clarity wins
