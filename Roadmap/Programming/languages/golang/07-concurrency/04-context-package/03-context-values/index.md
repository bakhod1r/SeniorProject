---
layout: default
title: Context Values
parent: Context Package
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/04-context-package/03-context-values/
---

# Context Values

[← Back](../)

We dissect `context.WithValue` as a narrow, deliberately constrained mechanism for carrying request-scoped data through a call tree: how the unexported key type idiom prevents collisions, why `Value` lookup is O(depth) by design, when a parameter is better than a context value, and how `valueCtx` chains together a linked list of (key, value) cells without any global goroutine-local storage.

## Sub-pages

- [junior.md](junior.md) — First contact with `WithValue`, request IDs, the unexported key idiom
- [middle.md](middle.md) — Type-safe accessors, middleware patterns, OpenTelemetry-style trace contexts
- [senior.md](senior.md) — When *not* to use values, parameter-vs-context decisions, leakage and lifetime risks
- [professional.md](professional.md) — `valueCtx` internals, linear lookup cost, allocation profile, no goroutine-local storage by design
- [specification.md](specification.md) — Formal contract for `Value`, key comparability rules, panic conditions
- [interview.md](interview.md) — Interview questions from junior to staff on context values and key design
- [tasks.md](tasks.md) — Hands-on exercises adding values, building accessors, replacing globals
- [find-bug.md](find-bug.md) — Bug-finding exercises with stringly-typed keys, type assertions, lifetime leaks
- [optimize.md](optimize.md) — Lookup cost, chain flattening, alternatives like struct injection
