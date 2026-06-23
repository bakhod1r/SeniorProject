---
layout: default
title: Deadlines and Cancellations
parent: context Package
grand_parent: Concurrency
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/04-context-package/01-deadlines-and-cancellations/
---

# Deadlines and Cancellations

[← Back](../)

We dissect Go's `context.Context` as a propagation tree for cancellation signals: how `WithCancel`, `WithDeadline`, and `WithTimeout` build derived contexts, how `<-ctx.Done()` and `ctx.Err()` deliver the verdict, why `cancel()` must always be deferred, and how Go 1.20+ added `WithCancelCause`, `WithoutCancel`, and `AfterFunc` to round out the API.

## Sub-pages

- [junior.md](junior.md) — First contact with `Context`, `Done`, `Err`, `WithCancel`, `WithTimeout`
- [middle.md](middle.md) — Propagation trees, `cancel()` discipline, `go vet -lostcancel`, deadline arithmetic
- [senior.md](senior.md) — Internals of `cancelCtx`/`timerCtx`, race-free cancellation, `WithCancelCause`
- [professional.md](professional.md) — Allocation cost, custom Context implementations, AfterFunc, WithoutCancel patterns
- [specification.md](specification.md) — Formal contract of the Context interface and cancellation semantics
- [interview.md](interview.md) — Interview questions from junior to staff on context cancellation
- [tasks.md](tasks.md) — Hands-on exercises building cancelable workers, deadlines, and propagation trees
- [find-bug.md](find-bug.md) — Bug-finding exercises with leaked cancels, ignored Done, and broken propagation
- [optimize.md](optimize.md) — Reducing allocations, avoiding deep derivation chains, and AfterFunc cleanup
