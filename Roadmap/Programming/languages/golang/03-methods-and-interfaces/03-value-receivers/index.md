---
layout: default
title: Value Receivers
parent: Methods & Interfaces
grand_parent: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/03-methods-and-interfaces/03-value-receivers/
---

# Value Receivers

[← Back](../)

Value receiver is a receiver of the form `func (r T)`. A **copy** of the receiver is passed to the method. The original value is not modified. Preferred for immutable value objects and small types.

## Sub-pages

- [junior.md](junior.md) — Value receiver basics
- [middle.md](middle.md) — Immutability, copying semantics, method set
- [senior.md](senior.md) — Hashability, comparability, escape
- [professional.md](professional.md) — Value object pattern, DDD
- [specification.md](specification.md) — Formal spec
- [interview.md](interview.md) — Interview questions
- [tasks.md](tasks.md) — Exercises
- [find-bug.md](find-bug.md) — Bug finding
- [optimize.md](optimize.md) — Performance and cleaner code
