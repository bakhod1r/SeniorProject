---
layout: default
title: Error Propagation in Pipelines
parent: Error Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/01-error-propagation/
---

# Error Propagation in Pipelines

[← Back](../)

A pipeline is a chain of concurrent stages where data flows downstream through channels. The hardest part is not the happy path — it is what happens when one stage fails. Errors must travel across goroutine boundaries, cancel sibling stages, unwind partially completed work, and surface in a form the caller can reason about. This subsection covers `errgroup`, sentinel errors, multi-stage rollback, error wrapping, `errors.Join`, and the trade-off between surfacing the first error versus all of them.

## Sub-pages

- [junior.md](junior.md) — Why pipeline errors are special, the first-error pattern with `errgroup`, basic wrapping with `fmt.Errorf` and `%w`
- [middle.md](middle.md) — Sentinel errors, `errors.Is`/`errors.As`, fan-out error coordination, draining and goroutine lifetime
- [senior.md](senior.md) — Multi-stage rollback, compensating actions, aggregating partial failures, `errors.Join`, panic recovery in stages
- [professional.md](professional.md) — Structured concurrency primitives, error contexts across distributed pipelines, observability, idempotency budgets, design trade-offs
- [specification.md](specification.md) — `errors`, `context`, `golang.org/x/sync/errgroup` API surface and guarantees
- [interview.md](interview.md) — Interview questions and model answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises building error-propagating pipelines
- [find-bug.md](find-bug.md) — Bug-finding exercises with swallowed errors, lost cancellations, double-close panics
- [optimize.md](optimize.md) — Optimization exercises for fast-fail latency, error allocation cost, and aggregation overhead
