---
layout: default
title: errors.Join — Multi-Errors
parent: Error Handling
grand_parent: Go
nav_order: 11
has_children: false
permalink: /roadmap/programming-languages/golang/05-error-handling/11-errors-join/
---

# errors.Join — Multi-Errors in Go (1.20+)

[← Back](../)

Before Go 1.20 there was no idiomatic way to return many errors from one operation — every project rolled its own "multi-error" type or pulled in `hashicorp/multierror` or `uber-go/multierr`. Go 1.20 fixed that with two small additions: the function `errors.Join`, and the convention that an error type may implement `Unwrap() []error` so the rest of the standard library (`errors.Is`, `errors.As`, `fmt.Errorf` with multiple `%w`) can walk the tree of joined errors. Together they make multi-error handling a first-class part of the language.

This topic covers what `Join` is, what it is *not*, how `Unwrap() []error` interacts with the rest of the error machinery, where you should reach for `Join` (and where you should not), how to migrate from older multi-error libraries, and the cost model for joining many errors in tight code paths.

## Sub-pages

- [junior.md](junior.md) — What `Join` does, the basic shape, when to use it
- [middle.md](middle.md) — `Unwrap() []error`, custom multi-error types, validation patterns
- [senior.md](senior.md) — Concurrent error collection, batched operations, library design
- [professional.md](professional.md) — `joinError` internals, allocation profile, tree-walk DFS
- [specification.md](specification.md) — Stable API surface, `errors.Is`/`As` walk semantics
- [interview.md](interview.md) — Interview questions and answers
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken multi-error code
- [optimize.md](optimize.md) — Optimization exercises for join-heavy paths

## Why This Matters

Multi-error handling is the kind of feature that looks tiny in the docs but reshapes how libraries publish their errors. Validation frameworks, batch jobs, parallel orchestrators, and cleanup paths all benefit. Knowing `errors.Join` well means writing less third-party-flavored code and more standard-library code.
