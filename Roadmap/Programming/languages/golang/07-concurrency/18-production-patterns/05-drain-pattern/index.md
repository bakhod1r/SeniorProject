---
layout: default
title: Drain Pattern
parent: Drain Pattern
grand_parent: Production Patterns
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/05-drain-pattern/
---

# Drain Pattern

[← Back](../)

The **drain pattern** is how a healthy Go service stops accepting new work, finishes the work it already has, and exits with zero data loss. Instead of slamming workers shut on `SIGTERM`, you quiesce intake, let the in-flight messages complete (or surrender them deliberately at a deadline), and only then close downstream connections. Done right, drain turns a crash-prone shutdown into a quiet handover; done wrong, it deadlocks on a hung consumer or drops a thousand Kafka offsets on the floor.

## Sub-pages

- [junior.md](junior.md) — What "drain" means, why you need it, the difference between hard stop and graceful drain, and a minimal worker example
- [middle.md](middle.md) — Drain implementations with `context`, `sync.WaitGroup`, idle-wait loops, and deadline-bounded drain in HTTP, queue, and worker pool services
- [senior.md](senior.md) — Architecture: drain ordering, two-phase shutdown, supervisor-driven drain, leak detection, and integration with health-check endpoints
- [professional.md](professional.md) — Kafka consumer rebalance hooks, partition revocation drain, exactly-once offset commits, drain across process boundaries, and production war stories
- [specification.md](specification.md) — Drain semantics in Go's `net/http.Server.Shutdown`, signal handling guarantees, and Kafka rebalance protocol references
- [interview.md](interview.md) — Interview questions and answers from junior to staff covering drain design and trade-offs
- [tasks.md](tasks.md) — Hands-on exercises: implement drain for a worker pool, an HTTP server, and a Kafka consumer
- [find-bug.md](find-bug.md) — Bug-finding exercises with drain deadlocks, missed signals, premature close, and lost messages
- [optimize.md](optimize.md) — Optimization exercises for drain throughput, deadline budgets, and idle-detection cost

## What You Will Learn

By the end of this section you will be able to:

- Catch `SIGTERM` and `SIGINT` via `signal.NotifyContext` and translate them into a drain.
- Bound any in-flight wait with `context.WithTimeout` so a hung worker never blocks past the orchestrator's grace period.
- Drain HTTP servers via `Server.Shutdown`, gRPC servers via `GracefulStop`, and Kafka consumers via offset-commit on revoke.
- Order multiple components: ingress first, persistence last.
- Distinguish a graceful drain from a hard stop, and choose the right one per workload.
- Test drain in CI so regressions never reach production.
- Integrate drain with Kubernetes readiness probes, the load balancer's propagation window, and the orchestrator's grace period.
- Reason about exactly-once semantics in Kafka when drain mid-transaction.

## How To Use These Pages

The pages are arranged from foundational to deep:

1. Read **junior.md** to get the recipe and write your first drainable service.
2. Read **middle.md** to coordinate drain across HTTP, workers, and queue consumers.
3. Read **senior.md** to design drain as a system property — supervisor patterns, DAG order, drain budgets.
4. Read **professional.md** for the deepest scenario: Kafka rebalances, exactly-once, production war stories.
5. Use **specification.md** as a quick reference for the underlying APIs.
6. Use **interview.md** to test yourself or to prepare for hiring conversations.
7. Use **tasks.md** for hands-on practice.
8. Use **find-bug.md** and **optimize.md** for code-review exercises.

## Prerequisites

- Go 1.21+ recommended.
- Comfort with goroutines, channels, and `context.Context`.
- Familiarity with `sync.WaitGroup` and the basic patterns of Go concurrency.
- Optional: experience with `net/http`, gRPC, or any message queue.

## Why This Pattern Matters

A service that does not drain cleanly is a service whose every deploy risks dropping in-flight work. The cost is visible in customer-facing 5xx errors during deploy windows, in duplicate side effects from interrupted message processing, and in the engineering time spent debugging "mystery" data loss. Drain is one of the cheapest production-reliability investments available in Go: a few weeks of design and testing pays back across years of clean rollouts.
