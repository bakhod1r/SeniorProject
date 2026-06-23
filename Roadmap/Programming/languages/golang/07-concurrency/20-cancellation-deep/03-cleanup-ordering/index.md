---
layout: default
title: Cleanup Ordering
parent: Cancellation Deep
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/03-cleanup-ordering/
---

# Cleanup Ordering

[← Back](../)

When a Go program shuts down a workflow, the order in which resources are released matters as much as whether they are released at all. Closing a transaction before its prepared statement, draining a buffer after closing its writer, or running an `AfterFunc` callback before the parent has had a chance to flush — each of these is a bug that compiles, type-checks, and only surfaces under load. This sub-topic studies `defer` stack semantics (LIFO), cleanup that must run *after* context cancellation, the `context.AfterFunc` hook introduced in Go 1.21, errors returned from deferred closes, and the design of resource hierarchies that compose without leaks.

## Sub-pages

- [junior.md](junior.md) — How `defer` runs in LIFO order, the basic `defer file.Close()` idiom, and the first mistakes around order and timing
- [middle.md](middle.md) — Cleanup that must outlive context cancellation, propagating errors from deferred `Close`, and nesting cleanups across helpers
- [senior.md](senior.md) — Designing resource hierarchies, using `context.AfterFunc` for cleanup that survives the parent goroutine, and coordinating shutdown across packages
- [professional.md](professional.md) — Runtime internals of `defer` (open-coded vs heap defers), `AfterFunc` implementation, panic-during-cleanup recovery, and large-scale shutdown choreography
- [specification.md](specification.md) — Formal language-spec rules for `defer` evaluation, panic/recover interaction, and the `context.AfterFunc` contract
- [interview.md](interview.md) — Interview questions on defer order, cleanup errors, AfterFunc semantics, and shutdown design
- [tasks.md](tasks.md) — Hands-on exercises for ordering cleanups correctly across goroutines, contexts, and panics
- [find-bug.md](find-bug.md) — Bug-finding exercises with reversed defers, swallowed close errors, and AfterFunc races
- [optimize.md](optimize.md) — Optimization exercises for defer overhead, AfterFunc registration cost, and shutdown latency
