---
layout: default
title: error interface
parent: Error Handling
grand_parent: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/05-error-handling/02-error-interface/
---

# error interface

[← Back](../)

We dive deep into Go's predeclared `error` interface — its single method `Error() string`, what it means to "be" an error, how to write custom error types, and the runtime mechanics behind interface satisfaction.

## Sub-pages

- [junior.md](junior.md) — The interface, a single method, your first custom error
- [middle.md](middle.md) — Pointer vs value receivers, embedded errors, interface satisfaction
- [senior.md](senior.md) — Designing error type hierarchies, behavioral interfaces, advanced patterns
- [professional.md](professional.md) — Itab layout, method dispatch, interface conversion
- [specification.md](specification.md) — Spec text on interfaces, the predeclared error
- [interview.md](interview.md) — Questions on interface mechanics and custom errors
- [tasks.md](tasks.md) — Build custom error types from scratch
- [find-bug.md](find-bug.md) — Bugs hiding in custom error type implementations
- [optimize.md](optimize.md) — Pointer vs value receivers, sentinel reuse, allocation control
