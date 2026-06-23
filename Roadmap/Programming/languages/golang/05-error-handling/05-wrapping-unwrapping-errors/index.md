---
layout: default
title: Wrapping & Unwrapping Errors
parent: Error Handling
grand_parent: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/05-error-handling/05-wrapping-unwrapping-errors/
---

# Wrapping & Unwrapping Errors

[← Back](../)

We explore how Go 1.13's standardized error wrapping turns a flat error into a *chain* of causes. We cover `fmt.Errorf` with `%w`, `errors.Unwrap`, `errors.Is`, `errors.As`, custom `Unwrap`/`Is`/`As` methods on user-defined types, and Go 1.20's `errors.Join` for multi-error trees. The goal: add context as errors propagate without losing the original cause.

## Sub-pages

- [junior.md](junior.md) — `%w`, basic wrap/unwrap, `errors.Is` and `errors.As` for beginners
- [middle.md](middle.md) — Chain semantics, custom error types with `Unwrap`, `errors.Join`
- [senior.md](senior.md) — Designing wrap-aware APIs, multi-cause trees, layered translation
- [professional.md](professional.md) — Internals: `*fmt.wrapError`, walk algorithm, allocation cost
- [specification.md](specification.md) — Spec/stdlib text on `%w`, `Unwrap`, `Is`, `As`, `Join`
- [interview.md](interview.md) — Interview questions and answers
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken wrap/unwrap code
- [optimize.md](optimize.md) — Optimization exercises for wrap-heavy paths
