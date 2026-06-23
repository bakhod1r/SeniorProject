---
layout: default
title: Partial Cancellation
parent: Cancellation Deep
grand_parent: Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/02-partial-cancellation/
---

# Partial Cancellation

[← Back](../)

Most discussions of `context` treat cancellation as all-or-nothing: a request comes in, a root context is created, and when the request ends every descendant context is cancelled together. Real systems are rarely that simple. Cleanup writers, audit loggers, metric flushers, span exporters, cache repopulation, and detached background work all need to keep running *after* the request that produced them has finished. Go 1.21 introduced `context.WithoutCancel` to express exactly this. Partial cancellation is the discipline of choosing, per subtask, which parts of the context tree to inherit (values, deadline, cancellation signal) and which to discard, so one branch can stop without dragging the others down.

## Sub-pages

- [junior.md](junior.md) — What partial cancellation is, the `context.WithoutCancel` API, and the simplest "let cleanup outlive the request" pattern
- [middle.md](middle.md) — Scoped contexts, detached subtasks, fanout where one branch fails, and the trade-offs between `WithoutCancel`, `WithTimeout`, and `WithDeadline`
- [senior.md](senior.md) — Architecture: graceful shutdown, request-bound vs process-bound lifetimes, supervised detached goroutines, and the interaction with tracing and logging
- [professional.md](professional.md) — Internals of `WithoutCancel`, the `cancelCtxKey` sentinel, the `Cause` propagation rules, and the relationship to `AfterFunc`, `WithCancelCause`, and `WithDeadlineCause`
- [specification.md](specification.md) — Formal API contracts for `context.WithoutCancel`, `Cause`, `AfterFunc`, and the documented interaction with `Done()` and `Err()`
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises for detaching cleanup, scoping cancellation per branch, and building supervised detached workers
- [find-bug.md](find-bug.md) — Bug-finding exercises with leaked detached goroutines, lost deadlines, and cleanup that never runs
- [optimize.md](optimize.md) — Optimization exercises for shrinking detached goroutine fan-out, batching cleanup, and avoiding context-tree allocations
