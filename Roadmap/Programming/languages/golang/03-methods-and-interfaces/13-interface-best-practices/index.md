---
layout: default
title: Interface Best Practices
parent: Methods & Interfaces
grand_parent: Go
nav_order: 13
has_children: false
permalink: /roadmap/programming-languages/golang/03-methods-and-interfaces/13-interface-best-practices/
---

# Interface Best Practices

[← Back](../)

This section concentrates the **positive guidance** on interfaces in Go: how to design them so the resulting code is small, decoupled, and easy to evolve. The guiding ideas are *"accept interfaces, return concrete types"*, *small interfaces win*, and *let the abstraction emerge from real usage*. The standard library's `io.Reader`, `io.Writer`, and `sort.Interface` are the canonical examples.

This file is the entry point. The companion section `14-interface-anti-patterns/` covers what NOT to do; here we focus only on what TO do.

## Sub-pages

- [junior.md](junior.md) — Naming, small interfaces, first usage rules
- [middle.md](middle.md) — Consumer-side definition, compile-time checks, optional interfaces
- [senior.md](senior.md) — Composition, generics vs interfaces, library API design
- [professional.md](professional.md) — DDD ports, hexagonal arch, governance at scale
- [specification.md](specification.md) — Spec, Effective Go, CodeReviewComments references
- [interview.md](interview.md) — Interview questions on interface design rationale
- [tasks.md](tasks.md) — Refactoring exercises that apply each best practice
- [find-bug.md](find-bug.md) — Cases where missing a best practice caused real issues
- [optimize.md](optimize.md) — Performance side-effects of well-designed interfaces
