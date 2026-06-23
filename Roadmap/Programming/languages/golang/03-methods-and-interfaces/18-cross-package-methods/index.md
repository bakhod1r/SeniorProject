---
layout: default
title: Cross-Package Methods
parent: Methods & Interfaces
grand_parent: Go
nav_order: 18
has_children: false
permalink: /roadmap/programming-languages/golang/03-methods-and-interfaces/18-cross-package-methods/
---

# Cross-Package Methods

[← Back](../)

In Go, **a method can only be declared on a type that lives in the same package as the method itself**. You cannot reach into `time`, `net`, `sql`, `http`, or any other package and add a new method to a foreign type. This single rule shapes a wide family of Go patterns: **wrapper types**, **free functions**, and **struct embedding**. This file is the entry point for the topic.

The rule is small but consequential. It dictates how you extend `time.Time` with domain semantics, how you decorate `*http.Client`, how you add `Scan`/`Value` behavior to library structs for `database/sql`, and how you bring foreign types into your interface contracts. Three workarounds, one decision tree, and a careful handful of pitfalls — that is the full picture.

## Sub-pages

- [junior.md](junior.md) — Why the restriction exists and the first workarounds
- [middle.md](middle.md) — Wrapper type pattern in depth, embedding alternative
- [senior.md](senior.md) — Interface satisfaction, marshal forwarding, generics interaction
- [professional.md](professional.md) — API design with wrappers, migration strategies, multi-package architecture
- [specification.md](specification.md) — Formal Go spec rule for receiver base types
- [interview.md](interview.md) — 30+ interview questions and answers
- [tasks.md](tasks.md) — Exercises (wrap `time.Time`, `http.Client`, `net.IP`, etc.)
- [find-bug.md](find-bug.md) — Bug-finding exercises (alias vs defined type, broken Marshaler)
- [optimize.md](optimize.md) — Zero-cost wrappers, conversion semantics, allocation control
