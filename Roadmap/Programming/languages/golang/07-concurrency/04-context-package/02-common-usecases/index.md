---
layout: default
title: Common Usecases
parent: context Package
grand_parent: Concurrency
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/04-context-package/02-common-usecases/
---

# Common Usecases

[← Back](../)

We catalogue how `context.Context` shows up in production Go: per-request cancellation in `net/http`, deadline propagation through `database/sql` and gRPC, request-scoped values for trace IDs, graceful shutdown via `srv.Shutdown(ctx)`, table-driven tests with timeouts, worker pools, fan-out pipelines, and middleware that decorates the context as it flows.

## Sub-pages

- [junior.md](junior.md) — `r.Context()`, `req.WithContext`, `db.QueryContext`, first WithValue
- [middle.md](middle.md) — Server shutdown, middleware decoration, type-safe value keys, test timeouts
- [senior.md](senior.md) — Deadline budgeting, gRPC propagation, OpenTelemetry, combined contexts
- [professional.md](professional.md) — Production patterns: SaaS API, payment, file upload, worker pools
- [specification.md](specification.md) — Formal rules for value lookup, request-scoped data, and propagation
- [interview.md](interview.md) — Interview questions on real-world context usage
- [tasks.md](tasks.md) — Hands-on exercises building HTTP servers, DB queries, and pipelines
- [find-bug.md](find-bug.md) — Bug-finding exercises with WithValue misuse, missing propagation, type panics
- [optimize.md](optimize.md) — Avoiding Value abuse, single-derivation patterns, AfterFunc cleanup
