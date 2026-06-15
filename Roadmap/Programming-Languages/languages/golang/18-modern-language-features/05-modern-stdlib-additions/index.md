---
layout: default
title: Modern Standard-Library Additions
parent: Modern Language Features
grand_parent: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/18-modern-language-features/05-modern-stdlib-additions/
---

# Modern Standard-Library Additions

[← Back](../)

Between Go 1.21 and 1.24 the standard library absorbed years of community-tested ideas: structured logging (`log/slog`), generic `slices`/`maps`/`cmp` helpers, a clean-slate `math/rand/v2`, value interning (`unique`), iterator-based collection APIs, and a substantially smarter `net/http.ServeMux`. This topic is a precise, version-tagged survey of what landed, what each API signature actually is, and when to reach for it.

## Sub-pages

- [junior.md](junior.md) — Beginners' tour of `slog`, `slices`, `maps`, `cmp`, and the new `http.ServeMux` routing, with runnable examples
- [middle.md](middle.md) — Handlers, attributes, iterator funcs, `math/rand/v2`, and migration mechanics
- [senior.md](senior.md) — What changed and *why it matters*; design rationale, performance, and adoption strategy
- [professional.md](professional.md) — Internals: `slog` handler contract, `unique` canonicalization, allocation behaviour, library-author concerns
- [specification.md](specification.md) — Version-by-version cheat sheet with exact signatures and release-note citations
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises across the new APIs
- [optimize.md](optimize.md) — Performance and ergonomics wins from adopting the modern stdlib
