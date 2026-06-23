---
layout: default
title: Custom Error Types
parent: Error Handling
grand_parent: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/05-error-handling/10-custom-error-types/
---

# Custom Error Types

[← Back](../)

Built-in `errors.New` and `fmt.Errorf` carry only a message. Real systems need more: an error code, a path, an operation name, the offending value, a wrapped cause, a kind tag for control flow, sometimes a stack. This is the job of **custom error types** — concrete Go types that implement the `error` interface and add structure that callers can inspect, log, marshal, and translate to HTTP/gRPC responses. Done well, they make programs easier to debug and APIs easier to evolve. Done badly, they leak internals, break `errors.Is`/`errors.As`, and accidentally turn `nil` into a non-nil error.

## Sub-pages

- [junior.md](junior.md) — Implementing `error`, struct fields, sentinel vs custom, basic `Unwrap`
- [middle.md](middle.md) — `Is`, `As`, error categories, the Op/Kind pattern, formatting with `%+v`
- [senior.md](senior.md) — Public API design, versioning, JSON marshalling, redaction, registries
- [professional.md](professional.md) — Allocation cost, pointer-vs-value receivers at scale, codegen
- [specification.md](specification.md) — Exact contracts of `error`, `Unwrap`, `Is`, `As`, `Format`
- [interview.md](interview.md) — Interview questions and answers
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken custom error code
- [optimize.md](optimize.md) — Optimization exercises for error allocation and formatting
